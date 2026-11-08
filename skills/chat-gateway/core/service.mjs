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
import { createFeed } from './feed.mjs';
import { createChat } from './chat.mjs';
import { createChatGPTSubmitter } from './chatgpt-client.mjs';
import { createOrchestratorBootstrap } from './orchestrator.mjs';
import { createEnvStore } from './env.mjs';
import { createMcpHttpServer } from '../mcp/server.mjs';
import { TOOL_DEFS } from '../mcp/tools.mjs';

const defaultLog = (name, fields = {}) => console.log(JSON.stringify({ name, ...fields }));

/** Standalone service; adapters may be injected for isolated E2E tests. */
export async function createGateway({
  config = resolveConfig(), dryRun = false, log = defaultLog,
  dashboard = createDashboardClient({ baseUrl: config.dashboardUrl }),
  notifier = dryRun ? createDryRunNotifier({ log }) : createNeoNotifier({ endpoint: config.neoMcpEndpoint }),
  makeSubscriber = createSubscriber, now = () => Date.now(), chatSubmit,
  autoPrepareOrchestrator = !dryRun && config.port !== 0, createProject,
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
  const feed = createFeed({ ledger });
  const chat = createChat({
    ledger, files, dir: config.stateDir, now,
    submit: chatSubmit ?? createChatGPTSubmitter({ endpoint: config.neoMcpEndpoint }),
  });
  const orchestrator = createOrchestratorBootstrap({
    chat, log, now, ...(createProject ? { createProject } : {}),
  });
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
    orchestrator: autoPrepareOrchestrator ? orchestrator.status() : { state: 'disabled' },
  });
  const server = createMcpHttpServer({
    port: config.port, tools: TOOL_DEFS, health,
    onCall: async (name, args) => {
      if (name === 'chat_jobs') {
        if (!args || typeof args !== 'object' || Array.isArray(args) ||
            Object.keys(args).some((key) => key !== 'limit') ||
            (args.limit !== undefined &&
             (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100))) {
          throw new Error('chat_jobs accepts optional integer limit (1..100)');
        }
        const limit = args.limit ?? 100;
        const jobs = await dashboard.fetchJobs();
        jobs.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') ||
          a.id.localeCompare(b.id));
        return { jobs: jobs.slice(0, limit), total: jobs.length };
      }
      if (name === 'chat_feed') return feed.list(args);
      if (name === 'chat_head') {
        if (Object.keys(args).length) throw new Error('chat_head accepts no arguments');
        return chat.head();
      }
      if (name === 'chat_bind') return chat.bind(args);
      if (name === 'chat_send') return chat.send(args);
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
    ledger, tracker, reporter, feed, chat, orchestrator, delivery, reconciler, subscriber, server, health,
    async start() {
      if (started) return;
      // Baseline before subscribing: historical completed jobs must not send pushes.
      await reconciler.run().catch(() => {});
      await probe();
      const port = await server.listen();
      started = true;
      subscriber.start();
      // Project creation uses a browser action and can take minutes. Never block
      // NATS notifications or the local MCP listener while it initializes.
      if (autoPrepareOrchestrator) void orchestrator.ensure();
      const periodic = (fn, ms) => {
        const timer = setInterval(() => Promise.resolve(fn()).catch((error) => log('service.tick_error', { error: String(error.message).slice(0, 120) })), ms);
        timer.unref();
        timers.push(timer);
      };
      periodic(() => reconciler.run(), config.reconcileIntervalMs);
      periodic(() => delivery.tick(), config.deliveryTickMs);
      periodic(probe, 60_000);
      if (autoPrepareOrchestrator) periodic(() => orchestrator.ensure(), 5 * 60_000);
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
