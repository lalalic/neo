import fs from 'node:fs';
import { connect } from '@nats-io/transport-node';
import { resolveRuntimeConfig } from './config.mjs';
import {transportEnvelope,safeType} from './envelope.mjs';
import {routeEvent,recordingBindings,acceptsRecord} from './routing.mjs';
import {compileFilter} from './query-filter.mjs';
export { connect as connectTransport };
export const MAX_MEMORY_EVENTS=20_000;

export class EventsBusCore {
  constructor(options = {}) {
    this.config = options.config || resolveRuntimeConfig(options.env);
    this.name = options.name || 'events-bus-core';
    this.events = [];
    this.seenEventIds = new Map();
    this.nextCursor = 1;
    this.nc = null;
    this.connecting = null;
    this.subscriptions = [];
    this.historyStat = null;
    fs.mkdirSync(this.config.dataDir, { recursive: true, mode: 0o700 });
    this.refreshHistory(true);
  }
  async connection() {
    if (this.nc) return this.nc;
    if (!this.connecting) this.connecting=connect({servers:this.config.natsUrl,name:this.name}).then(nc=>{this.nc=nc;return nc;}).finally(()=>{this.connecting=null;});
    return this.connecting;
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
    this.events = rows;
    this.seenEventIds = new Map();
    for (const row of rows) {
      const id = row.event?.event_id;
      if (id) this.seenEventIds.set(id, (this.seenEventIds.get(id) ?? 0) + 1);
    }
    this.nextCursor = nextCursor; this.historyStat = stat;
  }
  appendEvent(subject, event) {
    // At-least-once transport may redeliver an existing event_id. Keep the
    // first received record and cursor: a replay must never become a new
    // user-visible lifecycle event. The window survives recorder restarts.
    const id = typeof event?.event_id === 'string' ? event.event_id : null;
    if (id && this.seenEventIds.has(id)) return null;
    const received = { ...event, timestamp: new Date().toISOString() };
    const row = { cursor: this.nextCursor, subject, event: received };
    // A failed durable write must not consume a cursor or dedupe identity.
    fs.appendFileSync(this.config.historyFile, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: 0o600 });
    this.nextCursor++;
    this.events.push(row);
    if (id) this.seenEventIds.set(id, (this.seenEventIds.get(id) ?? 0) + 1);
    if (this.events.length > MAX_MEMORY_EVENTS) {
      const removed = this.events.splice(0, this.events.length - MAX_MEMORY_EVENTS);
      for (const old of removed) {
        const oldId = old.event?.event_id;
        if (oldId) {
          const remaining = (this.seenEventIds.get(oldId) ?? 0) - 1;
          if (remaining > 0) this.seenEventIds.set(oldId, remaining);
          else this.seenEventIds.delete(oldId);
        }
      }
    }
    try { this.historyStat = fs.statSync(this.config.historyFile); } catch {}
    return row;
  }

  async startRecorder() {
    if(this.subscriptions.length)return;
    const nc=await this.connection();
    const decoder=new TextDecoder();
    for(const pattern of recordingBindings(this.config)){
      const sub=nc.subscribe(pattern);
      this.subscriptions.push(sub);
      void (async()=>{for await(const msg of sub){
        let event;
        try {event=JSON.parse(decoder.decode(msg.data));} catch {continue;}
        if(!event||!safeType(event.type)||typeof event.event_id!=='string'||!event.event_id||
           !acceptsRecord(msg.subject,event,this.config))continue;
        try {this.appendEvent(msg.subject,event);}
        catch(error){this.recordError=error;console.error('[events-bus] history write failed:',error.message);}

      }})();
    }
    await nc.flush();
  }
  query({source,sourcePrefix,type,subject,filter,after=0,limit=100,order='asc'}={}) {
    if(order!=='asc'&&order!=='desc')throw Error('order must be asc or desc');
    if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1)throw Error('invalid cursor or limit');
    const predicate=compileFilter(filter);
    const max=Math.min(500,limit), rows=[];
    try {
      for(const line of fs.readFileSync(this.config.historyFile,'utf8').split(/\r?\n/)){
        if(!line)continue;
        let row;try{row=JSON.parse(line)}catch{continue}
        const e=row?.event,id=e?.source?.id;
        if(!Number.isSafeInteger(row?.cursor)||row.cursor<=after||!e||
          (source!==undefined&&id!==source)||(sourcePrefix!==undefined&&(typeof id!=='string'||!id.startsWith(sourcePrefix)))||
          (type!==undefined&&e.type!==type)||(subject!==undefined&&row.subject!==subject)||!predicate(row))continue;
        rows.push(row);
        if(order==='asc'&&rows.length===max)break;
        if(order==='desc'&&rows.length>max)rows.shift();
      }
    }catch(error){if(error.code!=='ENOENT')throw error}
    if(order==='desc')rows.reverse();
    return {events:rows,next_cursor:order==='desc'?(rows[0]?.cursor??after):(rows.at(-1)?.cursor??after),order};
  }
  async health() {
    const nc = await this.connection(); await nc.flush(); this.refreshHistory();
    if(this.recordError)throw Error('history recorder failed; inspect service logs and restart after repairing storage');
    return { ok: true, server: nc.getServer(), buffered_events: this.events.length, next_cursor: this.nextCursor, config: { natsUrl: this.config.natsUrl, apiUrl: this.config.apiUrl, dataDir: this.config.dataDir, subjectPrefix: this.config.subjectPrefix } };
  }

  async publish(input,{eventId}={}) {
    const projection=routeEvent(input,this.config);
    const subject=projection.subject;
    const event=transportEnvelope({...projection.event,...(eventId===undefined?{}:{event_id:eventId})});
    const nc=await this.connection();
    nc.publish(subject,new TextEncoder().encode(JSON.stringify(event)));
    await nc.flush();
    return {published:true,subject,event};
  }
  async close() {
    for(const sub of this.subscriptions)try{sub.unsubscribe()}catch{}
    this.subscriptions=[];
    if(this.nc){try{await this.nc.close()}catch{}this.nc=null}
  }
}
export function createEventsBusCore(options={}){return new EventsBusCore(options);}
