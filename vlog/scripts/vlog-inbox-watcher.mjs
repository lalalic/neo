#!/usr/bin/env node
import path from 'node:path';
import { scanOnce, createCliRelayClient, NEOX_ICLOUD_INBOX_RELATIVE } from '../lib/inbox-watcher.mjs';

const env = process.env;
const inboxDir = path.resolve(env.VLOG_ICLOUD_INBOX ?? path.join(env.HOME ?? '.', NEOX_ICLOUD_INBOX_RELATIVE));
const runsDir = path.resolve(env.VLOG_RUNS_DIR ?? path.join(process.cwd(), 'runs'));
const intervalMs = Number(env.VLOG_WATCH_INTERVAL_MS ?? 5000);
const relay = createCliRelayClient();

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    for (const result of await scanOnce({ inboxDir, runsDir, relay })) {
      if (result.status !== 'rejected') console.log(JSON.stringify(result));
      else console.error(JSON.stringify(result));
    }
  } catch (error) {
    console.error(`[vlog-inbox-watcher] ${error.stack ?? error.message}`);
  } finally { running = false; }
}

await tick();
setInterval(tick, intervalMs);
