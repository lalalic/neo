import { join } from 'node:path';
import { resolveConfig } from './config.mjs';
import { openLedger } from './ledger.mjs';
import { files } from './files.mjs';
import { createDashboardClient } from './dashboard.mjs';
import { createTracker } from './tracker.mjs';
import { createReconciler } from './reconcile.mjs';
import { createSubscriber } from './subscriber.mjs';
import { createNeoNotifier, createDryRunNotifier } from './notify.mjs';
import { createDelivery } from './delivery.mjs';
import { createReporter } from './report.mjs';
import { createEnvStore } from './env.mjs';
import { createMcpHttpServer } from '../mcp/server.mjs';
import { TOOL_DEFS } from '../mcp/tools.mjs';

const defaultLog = (name, fields = {}) => console.log(JSON.stringify({ name, ...fields }));

/** Standalone service; adapters may be injected for isolated E2E tests. */
export async function createGateway({
  config = resolveConfig(), dryRun = false, log = defaultLog,
  dashboard = createDashboardClient({ baseUrl: config.dashboardUrl }),
  notifier = dryRun ? createDryRunNotifier({ log }) : createNeoNotifier({ endpoint: config.neoMcpEndpoint }),
  makeSubscriber = createSubscriber, now = () => Date.now(),
} = {}) {
  const ledger = await openLedger({ dir: config.stateDir, now });
  const envStore = createEnvStore({ dir: config.stateDir, files, now: () => new Date(now()) });
  const tracker = createTracker({ ledger, snapshotFile: join(config.stateDir, 'snapshot.json'), files, now });
  await tracker.load();

  // Serialize NATS and HTTP reconciliation updates to avoid losing a snapshot transition.
  let writes = Promise.resolve();
  const exclusive = (fn) => {
    const result = writes.then(fn);
    writes = result.catch(() => {});
    return result;
  };
  const reconciler = createReconciler({
    dashboard,
    tracker: { observeJobs: (jobs) => exclusive(() => tracker.observeJobs(jobs)) },
    now, log,
  });
  const subscriber = makeSubscriber({
    natsUrl: config.natsUrl, subject: config.subject,
    onEvent: (event) => exclusive(() => tracker.observeEvent(event)),
    onReconnect: () => reconciler.run(), log,
  });
  const delivery = createDelivery({ ledger, notifier, now, log, settleMs: config.settleMs });
  const reporter = createReporter({ ledger, now });
  let notifyPath = { reachable: false, lastProbeAt: null, error: null };
  const probe = async () => {
    try {
      const result = await notifier.probe();
      notifyPath = { reachable: result.reachable === true, lastProbeAt: new Date(now()).toISOString(), policy: result.policy, error: null };
    } catch (error) {
      notifyPath = { reachable: false, lastProbeAt: new Date(now()).toISOString(), error: String(error.message).slice(0, 150) };
    }
  };
  const health = () => ({
    status: !subscriber.status().connected || !reconciler.status().reachable || !notifyPath.reachable ? 'degraded' : 'ok',
    nats: subscriber.status(), dashboard: reconciler.status(), notify: notifyPath,
    ledger: ledger.counts(), baselined: tracker.isBaselined(),
  });
  const server = createMcpHttpServer({
    port: config.port, tools: TOOL_DEFS, health,
    onCall: async (name, args) => {
      if (name === 'chat_env') {
        if (Object.keys(args).length) throw new Error('chat_env accepts no arguments');
        return envStore.resolve();
      }
      if (name === 'chat_report') {
        const result = await reporter.report(args);
        await delivery.tick();
        return result;
      }
      throw new Error('Unknown tool');
    },
  });
  const timers = [];
  let started = false;
  return {
    ledger, tracker, reporter, delivery, reconciler, subscriber, server, health,
    async start() {
      if (started) return;
      // Baseline before subscribing: historical completed jobs must not send pushes.
      await reconciler.run().catch(() => {});
      await probe();
      const port = await server.listen();
      started = true;
      subscriber.start();
      const periodic = (fn, ms) => {
        const timer = setInterval(() => Promise.resolve(fn()).catch((error) => log('service.tick_error', { error: String(error.message).slice(0, 120) })), ms);
        timer.unref();
        timers.push(timer);
      };
      periodic(() => reconciler.run(), config.reconcileIntervalMs);
      periodic(() => delivery.tick(), config.deliveryTickMs);
      periodic(probe, 60_000);
      periodic(() => ledger.compact({ maxAgeMs: config.retentionMs }), 24 * 60 * 60_000);
      log('service.started', { port, dryRun });
    },
    async stop() {
      for (const timer of timers) clearInterval(timer);
      await subscriber.stop();
      if (started) await server.close();
      started = false;
    },
  };
}
