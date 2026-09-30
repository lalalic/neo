import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { connect } from '@nats-io/transport-node';
import { safeJobId, safeTaskId } from '../mcp/validation.mjs';
import { resolveRuntimeConfig } from './config.mjs';

export const MAX_MEMORY_EVENTS = 20_000;
export const MAX_WAIT_MS = 30_000;
const PROCESS_CHECK_INTERVAL_MS = 500;
const PROCESS_EXIT_GRACE_MS = 500;
const TERMINAL_JOB_TYPES = new Set(['job.completed','job.failed','job.blocked','job.cancelled']);
const EVENT_STATUSES = new Set(['queued','running','waiting','blocked','succeeded','failed','cancelled']);
const EVENT_VISIBILITIES = new Set(['user','orchestrator','debug']);
const EVENT_LEVELS = new Set(['debug','info','warning','error']);

export function safeType(value) { return typeof value === 'string' && /^[A-Za-z0-9_.-]+$/.test(value); }
function nonEmptyString(value) { return typeof value === 'string' && value.trim().length > 0; }

export function normalizePublishEvent(input, source = { agent: 'events-bus', host: os.hostname() }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'event must be an object' };
  if (!safeJobId(input.job_id)) return { error: 'invalid event.job_id' };
  if (!safeTaskId(input.task_id)) return { error: 'invalid event.task_id' };
  if (!safeType(input.type)) return { error: 'invalid event.type' };
  if (!EVENT_STATUSES.has(input.status)) return { error: 'invalid event.status' };
  if (!EVENT_VISIBILITIES.has(input.visibility)) return { error: 'invalid event.visibility' };
  if (!nonEmptyString(input.message)) return { error: 'event.message is required' };
  if (input.level !== undefined && !EVENT_LEVELS.has(input.level)) return { error: 'invalid event.level' };
  if (input.version !== undefined && input.version !== 1) return { error: 'event.version must be 1' };
  if (input.event_id !== undefined && !nonEmptyString(input.event_id)) return { error: 'invalid event.event_id' };
  if (input.timestamp !== undefined && (!nonEmptyString(input.timestamp) || Number.isNaN(Date.parse(input.timestamp)))) return { error: 'invalid event.timestamp' };
  return { event: {
    ...input, version: 1, event_id: input.event_id ?? crypto.randomUUID(), timestamp: input.timestamp ?? new Date().toISOString(), level: input.level ?? 'info',
    source: input.source && typeof input.source === 'object' && !Array.isArray(input.source) ? input.source : source,
    data: input.data && typeof input.data === 'object' && !Array.isArray(input.data) ? input.data : {},
  } };
}

export class EventsBusCore {
  constructor(options = {}) {
    this.config = options.config || resolveRuntimeConfig(options.env);
    this.name = options.name || 'events-bus-core';
    this.recordNats = Boolean(options.recordNats);
    this.events = [];
    this.nextCursor = 1;
    this.waiters = new Set();
    this.nc = null;
    this.subscription = null;
    this.historyStat = null;
    fs.mkdirSync(this.config.dataDir, { recursive: true, mode: 0o700 });
    this.refreshHistory(true);
  }
  async connection() {
    if (!this.nc) this.nc = await connect({ servers: this.config.natsUrl, name: this.name });
    return this.nc;
  }
  refreshHistory(force = false) {
    let stat;
    try { stat = fs.statSync(this.config.historyFile); } catch { return; }
    if (!force && this.historyStat && stat.mtimeMs === this.historyStat.mtimeMs && stat.size === this.historyStat.size) return;
    const rows = [];
    const lines = fs.readFileSync(this.config.historyFile, 'utf8').split(/\r?\n/).filter(Boolean).slice(-MAX_MEMORY_EVENTS);
    let nextCursor = 1;
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (!Number.isInteger(row.cursor) || !row.event || !row.subject) continue;
        rows.push(row); nextCursor = Math.max(nextCursor, row.cursor + 1);
      } catch {}
    }
    this.events = rows; this.nextCursor = nextCursor; this.historyStat = stat;
  }
  appendEvent(subject, event) {
    const row = { cursor: this.nextCursor++, subject, event };
    this.events.push(row);
    if (this.events.length > MAX_MEMORY_EVENTS) this.events.splice(0, this.events.length - MAX_MEMORY_EVENTS);
    fs.appendFileSync(this.config.historyFile, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: 0o600 });
    try { this.historyStat = fs.statSync(this.config.historyFile); } catch {}
    for (const waiter of [...this.waiters]) waiter(row);
    return row;
  }
  async startRecorder() {
    if (this.subscription) return;
    const nc = await this.connection();
    const decoder = new TextDecoder();
    this.subscription = nc.subscribe(`${this.config.subjectPrefix}.>`);
    void (async () => {
      for await (const msg of this.subscription) {
        try {
          const event = JSON.parse(decoder.decode(msg.data));
          if (!safeJobId(event?.job_id) || !safeType(event?.type)) continue;
          this.appendEvent(msg.subject, event);
        } catch {}
      }
    })();
  }
  rowsForJob(jobId, afterCursor = 0, limit = 100, taskId = null) {
    this.refreshHistory();
    return this.events.filter(row => row.cursor > afterCursor && row.event?.job_id === jobId && (!taskId || row.event?.task_id === taskId)).slice(0, Math.max(1, Math.min(500, limit)));
  }
  latestWorkerForJob(jobId) {
    this.refreshHistory();
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const row = this.events[i]; if (row.event?.job_id !== jobId) continue;
      const worker = row.event?.data?.worker; if (worker && typeof worker === 'object' && !Array.isArray(worker)) return worker;
    }
    return null;
  }
  processLiveness(jobId) {
    const worker = this.latestWorkerForJob(jobId);
    if (!worker) return { state: 'unknown', reason: 'worker_not_registered' };
    if (worker.kind !== 'process') return { state: 'unknown', reason: 'worker_kind_not_process', worker };
    if (worker.host && worker.host !== os.hostname()) return { state: 'unknown', reason: 'worker_on_other_host', worker };
    const pid = Number(worker.pid); if (!Number.isInteger(pid) || pid <= 0) return { state: 'unknown', reason: 'invalid_worker_pid', worker };
    try { process.kill(pid, 0); return { state: 'alive', pid, worker }; }
    catch (error) { if (error?.code === 'EPERM') return { state: 'alive', pid, worker, reason: 'permission_denied_but_process_exists' }; if (error?.code === 'ESRCH') return { state: 'dead', pid, worker }; return { state: 'unknown', pid, worker, reason: error?.code || String(error) }; }
  }
  latestTerminalForJob(jobId, afterCursor = 0) {
    this.refreshHistory();
    for (let i = this.events.length - 1; i >= 0; i -= 1) { const row = this.events[i]; if (row.cursor <= afterCursor) break; if (row.event?.job_id === jobId && TERMINAL_JOB_TYPES.has(row.event?.type)) return row; }
    return null;
  }
  async health() {
    const nc = await this.connection(); await nc.flush(); this.refreshHistory();
    return { ok: true, server: nc.getServer(), buffered_events: this.events.length, next_cursor: this.nextCursor, config: { natsUrl: this.config.natsUrl, apiUrl: this.config.apiUrl, dataDir: this.config.dataDir, subjectPrefix: this.config.subjectPrefix } };
  }
  async publish(input, source) {
    const normalized = normalizePublishEvent(input, source); if (normalized.error) throw new Error(normalized.error);
    const event = normalized.event; const subject = `${this.config.subjectPrefix}.${event.job_id}.${event.type}`; const nc = await this.connection();
    nc.publish(subject, new TextEncoder().encode(JSON.stringify(event))); await nc.flush(); return { published: true, subject, event };
  }
  async watch(jobId) {
    if (!safeJobId(jobId)) throw new Error('job_id must contain only letters, digits, _ or -');
    const nc = await this.connection(); await nc.flush(); await new Promise(resolve => setImmediate(resolve)); this.refreshHistory();
    const rows = this.events.filter(row => row.event?.job_id === jobId);
    return { job_id: jobId, watch_established: true, after_cursor: rows.at(-1)?.cursor ?? 0, buffered_event_count: rows.length, worker_liveness: this.processLiveness(jobId) };
  }
  history(jobId, afterCursor = 0, limit = 100, taskId = null, order = 'asc') {
    if (!safeJobId(jobId)) throw new Error('job_id must contain only letters, digits, _ or -');
    if (order !== 'asc' && order !== 'desc') throw new Error('order must be asc or desc');
    let matching = [];
    try {
      for (const line of fs.readFileSync(this.config.historyFile, 'utf8').split(/\r?\n/)) {
        if (!line) continue;
        try {
          const row = JSON.parse(line);
          if (Number.isInteger(row.cursor) && row.cursor > afterCursor && row.event?.job_id === jobId && (!taskId || row.event?.task_id === taskId)) matching.push(row);
        } catch {}
      }
    } catch { /* empty history */ }
    const bounded = Math.max(1, Math.min(500, limit));
    const rows = order === 'desc' ? matching.slice(-bounded).reverse() : matching.slice(0, bounded);
    const nextCursor = order === 'desc' ? (rows[0]?.cursor ?? afterCursor) : (rows.at(-1)?.cursor ?? afterCursor);
    return { job_id: jobId, events: rows, next_cursor: nextCursor, order };
  }
  status(jobId) {
    const rows = this.rowsForJob(jobId, 0, 500); const latest = rows.at(-1) ?? null;
    const terminal = [...rows].reverse().find(row => ['succeeded','failed','cancelled','blocked'].includes(row.event?.status)) ?? null;
    return { job_id: jobId, latest, terminal, event_count: rows.length, worker_liveness: this.processLiveness(jobId) };
  }
  progress(jobId) {
    const rows = this.rowsForJob(jobId, 0, 500); const latest = rows.at(-1)?.event ?? null; const terminal = this.latestTerminalForJob(jobId)?.event ?? null;
    const visible = rows.map(row => row.event).filter(event => event?.visibility === 'user').slice(-8).map(event => ({ event_id:event.event_id, task_id:event.task_id, type:event.type, status:event.status, timestamp:event.timestamp, level:event.level, message:event.message, ...(event.progress && typeof event.progress === 'object' ? { progress:event.progress } : {}) }));
    const progressEvent = [...rows].reverse().map(row => row.event).find(event => event?.progress && typeof event.progress === 'object');
    return { job_id:jobId, status:terminal?.status ?? latest?.status ?? 'queued', terminal:Boolean(terminal), latest_message:latest?.message ?? 'No event received yet.', updated_at:latest?.timestamp ?? null, event_count:rows.length, worker_liveness:this.processLiveness(jobId), progress:progressEvent?.progress ?? null, milestones:visible };
  }
  async wait(jobId, afterCursor = 0, timeoutMs = 25_000, limit = 100) {
    if (!safeJobId(jobId)) throw new Error('job_id must contain only letters, digits, _ or -');
    const existing = this.rowsForJob(jobId, afterCursor, limit); if (existing.length > 0 || timeoutMs <= 0) return this.waitResult(jobId, afterCursor, existing, false);
    const initial = this.processLiveness(jobId); if (initial.state === 'dead' && !this.latestTerminalForJob(jobId, afterCursor)) return this.waitResult(jobId, afterCursor, [], true);
    const deadline = Date.now() + Math.min(MAX_WAIT_MS, Math.max(0, timeoutMs)); let deadSince = null;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, PROCESS_CHECK_INTERVAL_MS));
      const rows = this.rowsForJob(jobId, afterCursor, limit); if (rows.length) return this.waitResult(jobId, afterCursor, rows, false);
      const live = this.processLiveness(jobId); if (live.state !== 'dead') { deadSince = null; continue; }
      if (this.latestTerminalForJob(jobId, afterCursor)) return this.waitResult(jobId, afterCursor, [], false);
      if (deadSince === null) deadSince = Date.now(); else if (Date.now() - deadSince >= PROCESS_EXIT_GRACE_MS) return this.waitResult(jobId, afterCursor, [], true);
    }
    return this.waitResult(jobId, afterCursor, [], false);
  }
  waitResult(jobId, afterCursor, rows, processExited) {
    const terminal = this.latestTerminalForJob(jobId, afterCursor);
    return { job_id:jobId, events:rows, next_cursor:rows.at(-1)?.cursor ?? afterCursor, timed_out:rows.length === 0 && !processExited, worker_liveness:this.processLiveness(jobId), process_exited_without_terminal:processExited && !terminal, stop_wait_loop:Boolean(terminal) || processExited, end_reason:terminal ? 'terminal_event' : (processExited ? 'worker_exited' : null), terminal_event:terminal };
  }
  async close() { try { this.subscription?.unsubscribe(); } catch {} this.subscription = null; if (this.nc) { try { await this.nc.close(); } catch {} this.nc = null; } }
}

export function createEventsBusCore(options = {}) { return new EventsBusCore(options); }
