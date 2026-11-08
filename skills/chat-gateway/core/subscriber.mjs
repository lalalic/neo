import { connect } from '@nats-io/transport-node';
import { parseRuntimeStatusEvent } from './job-status.mjs';

const decoder = new TextDecoder();
const MAX_EVENT_BYTES = 64 * 1024;

export function decodeEvent(data) {
  if (!(data instanceof Uint8Array) || data.byteLength > MAX_EVENT_BYTES) return null;
  try {
    return parseRuntimeStatusEvent(JSON.parse(decoder.decode(data)));
  } catch {
    return null;
  }
}

/** Core NATS is intentionally non-durable; the dashboard reconciler fills gaps. */
export function createSubscriber({
  natsUrl, subject, onEvent, onReconnect = async () => {},
  connectNats = connect, log = () => {},
  backoff = { baseMs: 1000, capMs: 30_000 },
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  let stopping = false;
  let active = null;
  let connected = false;
  let task = null;
  let lastError = null;

  async function run() {
    let attempt = 0;
    while (!stopping) {
      try {
        active = await connectNats({
          servers: natsUrl, name: 'neo-chat-gateway', maxReconnectAttempts: -1,
          reconnectTimeWait: 1500, timeout: 4000,
        });
        if (stopping) break;
        connected = true;
        attempt = 0;
        lastError = null;
        const connection = active;
        const statuses = (async () => {
          try {
            for await (const status of connection.status()) {
              if (stopping) break;
              if (status.type === 'disconnect') connected = false;
              if (status.type === 'reconnect') {
                connected = true;
                await onReconnect().catch((error) => log('subscriber.reconcile_error', { error: String(error.message).slice(0, 120) }));
              }
            }
          } catch (error) {
            if (!stopping) log('subscriber.status_error', { error: String(error.message).slice(0, 120) });
          }
        })();
        const subscription = connection.subscribe(subject);
        for await (const message of subscription) {
          if (stopping) break;
          const event = decodeEvent(message.data);
          if (event) {
            try { await onEvent(event); }
            catch (error) { log('subscriber.event_error', { error: String(error.message).slice(0, 120) }); }
          }
        }
        await statuses;
      } catch (error) {
        lastError = String(error?.message ?? error).slice(0, 150);
        if (!stopping) log('subscriber.failed', { error: lastError });
      } finally {
        connected = false;
        if (active) {
          await active.close().catch(() => {});
          active = null;
        }
      }
      if (!stopping) {
        attempt += 1;
        await sleep(Math.min(backoff.capMs, backoff.baseMs * 2 ** Math.min(16, attempt - 1)));
      }
    }
  }

  return {
    start() { if (!task) task = run(); return task; },
    async stop() { stopping = true; await active?.close().catch(() => {}); },
    status: () => ({ connected, lastError }),
  };
}
