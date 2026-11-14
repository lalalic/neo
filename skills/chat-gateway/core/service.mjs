import { join } from 'node:path';
import { resolveConfig } from './config.mjs';
import { openLedger } from './ledger.mjs';
import { files } from './files.mjs';
import { createDashboardClient } from './dashboard.mjs';
import { createTracker } from './tracker.mjs';
import { createReconciler } from './reconcile.mjs';
import { createSubscriber } from './subscriber.mjs';
import { createLiveRegistry, createLiveWatch, decodeLiveEvent } from './live-watch.mjs';
import { createLiveHistory } from './live-history.mjs';
import { createNeoNotifier, createDryRunNotifier } from './notify.mjs';
import { createDelivery } from './delivery.mjs';
import { createReporter } from './report.mjs';
import { createFeed } from './feed.mjs';
import { createChat } from './chat.mjs';
import { createAttachmentStore } from './attachments.mjs';
import { createChatGPTSubmitter } from './chatgpt-client.mjs';
import { createThreadProjectVerifier } from './thread-verifier.mjs';
import { createOrchestratorBootstrap } from './orchestrator.mjs';
import { createTerminalDispatcher } from './terminal-dispatch.mjs';
import { createEnvStore } from './env.mjs';
import { createRelayEventHistoryClient } from './relay-jobs.mjs';
import { validateJobIdentity } from '../mcp/tools.mjs';
import { createMcpHttpServer } from '../mcp/server.mjs';
import { TOOL_DEFS } from '../mcp/tools.mjs';

const defaultLog = (name, fields = {}) => console.log(JSON.stringify({ name, ...fields }));

/** Standalone service; adapters may be injected for isolated E2E tests. */
export async function createGateway({
  config = resolveConfig(), dryRun = false, log = defaultLog,
  dashboard = createDashboardClient({ baseUrl: config.dashboardUrl }),
  eventHistory = createRelayEventHistoryClient({ apiUrl: config.eventsApiUrl }),
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  notifier = dryRun ? createDryRunNotifier({ log }) : createNeoNotifier({ endpoint: config.neoMcpEndpoint }),
  makeSubscriber = createSubscriber, makeLiveSubscriber = createSubscriber, now = () => Date.now(), chatSubmit, verifyProjectThread = createThreadProjectVerifier(),
  autoPrepareOrchestrator = !dryRun && config.port !== 0, createProject,
  liveHistory = createLiveHistory({apiUrl:config.eventsApiUrl}),
} = {}) {
  const ledger = await openLedger({ dir: config.stateDir, now });
  const envStore = createEnvStore({ dir: config.stateDir, files, now: () => new Date(now()) });
  const tracker = createTracker({ ledger, snapshotFile: join(config.stateDir, 'snapshot.json'), files, now });
  await tracker.load();
  const liveRegistry = createLiveRegistry({dir: config.stateDir, now});
  const liveWatch = createLiveWatch({registry:liveRegistry,ledger,dashboard,history:liveHistory,now});
  let liveSubscriber = null;
  let liveWatchCount = 0;

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
  const inFlightCancellations = new Map();
  const subscriber = makeSubscriber({
    natsUrl: config.natsUrl, subject: config.subject,
    onEvent: (event) => exclusive(() => tracker.observeEvent(event)),
    onReconnect: () => reconciler.run(), log,
  });
  const delivery = createDelivery({ ledger, notifier, now, log, settleMs: config.settleMs });
  const reporter = createReporter({ ledger, now });
  const feed = createFeed({ ledger });
  const attachmentStore = createAttachmentStore({ root: config.stateDir });
  const submit = chatSubmit ?? createChatGPTSubmitter();
  const chat = createChat({
    ledger, files, dir: config.stateDir, now, attachmentStore,
    submit, verifyProjectThread,
  });
  const terminalDispatch = createTerminalDispatcher({ ledger, chat, submit, now, log });
  const orchestrator = createOrchestratorBootstrap({
    chat, log, now, ...(createProject ? { createProject } : {}),
  });
  let notifyPath = { reachable: false, lastProbeAt: null, error: null };
  const probe = async () => {
    try {
      const result = await notifier.probe();
      notifyPath = { reachable: result.reachable === true, lastProbeAt: new Date(now()).toISOString(), policy: result.policy, transport: result.transport, targets: result.targets, error: null };
    } catch (error) {
      notifyPath = { reachable: false, lastProbeAt: new Date(now()).toISOString(), error: String(error.message).slice(0, 150) };
    }
  };
  const health = () => ({
    status: !subscriber.status().connected || !reconciler.status().reachable || !notifyPath.reachable ||
      (liveWatchCount > 0 && !liveSubscriber?.status().connected) ? 'degraded' : 'ok',
    nats: subscriber.status(), dashboard: reconciler.status(), notify: notifyPath,
    ledger: ledger.counts(), baselined: tracker.isBaselined(),
    terminalDispatch: terminalDispatch.status(),
    liveWatch: {count:liveWatchCount, ...(liveSubscriber?.status() ?? {connected:false, lastError:null})},
    orchestrator: autoPrepareOrchestrator ? orchestrator.status() : { state: 'disabled' },
  });
  const server = createMcpHttpServer({
    port: config.port, tools: TOOL_DEFS, health,
    onCall: async (name, args) => {
      if (name === 'chat_jobs') {
        if (!args || typeof args !== 'object' || Array.isArray(args) ||
            Object.keys(args).some((key) => key !== 'limit' && key !== 'offset') ||
            (args.limit !== undefined &&
             (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100)) ||
            (args.offset !== undefined &&
             (!Number.isInteger(args.offset) || args.offset < 0 || args.offset > 100000))) {
          throw new Error('chat_jobs accepts limit (1..100) and offset (0..100000)');
        }
        const limit = args.limit ?? 20;
        const offset = args.offset ?? 0;
        const jobs = await dashboard.fetchJobs();
        jobs.sort((a, b) => (Number(b.status !== 'COMPLETED' && b.status !== 'CANCELLED') -
          Number(a.status !== 'COMPLETED' && a.status !== 'CANCELLED')) ||
          (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') ||
          a.id.localeCompare(b.id));
        const page = jobs.slice(offset, offset + limit);
        const nextOffset = Math.min(jobs.length, offset + page.length);
        return { jobs: page.map(job => ({ ...job, cancellable: job.cancellable === true })),
          total: jobs.length, nextOffset, hasMore: nextOffset < jobs.length };
      }
      if (name === 'chat_job_tasks') {
        const identity = validateJobIdentity(args, 'chat_job_tasks');
        return await dashboard.fetchJobTasks(identity.jobId, identity.repository);
      }
      if (name === 'chat_job_activity') {
        const identity = validateJobIdentity(args, 'chat_job_activity');
        const job = await dashboard.fetchJob(identity.jobId, identity.repository);
        let activity;
        try {
          activity = await eventHistory.fetchEvents(identity.jobId);
        } catch {
          throw new Error('Relay activity source is unavailable');
        }
        return {
          jobId: job.id,
          repository: job.repository,
          source: 'events-bus-history',
          events: activity.events,
          truncated: activity.truncated,
        };
      }
      if (name === 'chat_job_cancel') {
        const identity = validateJobIdentity(args, 'chat_job_cancel');
        const key = `${identity.repository}:${identity.jobId}`;
        if (inFlightCancellations.has(key)) throw new Error('Cancellation is already in progress');
        inFlightCancellations.set(key, Promise.resolve());
        let cancellation;
        try {
          const current = await dashboard.fetchJob(identity.jobId, identity.repository);
          if (current.jobState === 'CANCELLED') {
            const { status, jobState, ...job } = current;
            return { status: 'cancelled', ...job };
          }
          if (current.jobState === 'COMPLETED') {
            const { status, jobState, ...job } = current;
            return { status: 'not_cancellable', reason: 'completed', ...job };
          }
          if (current.jobState !== 'DRAFT' && current.jobState !== 'ACTIVE') {
            throw new Error('Job is not cancellable in its current lifecycle');
          }
          cancellation = (async () => {
            await dashboard.requestCancellation(identity.jobId, identity.repository);
            const deadline = now() + 10_000;
            for (;;) {
              const readback = await dashboard.fetchJob(identity.jobId, identity.repository);
              if (readback.jobState === 'CANCELLED') {
                const { status, jobState, ...job } = readback;
                return { status: 'cancelled', ...job };
              }
              if (readback.jobState === 'COMPLETED') throw new Error('Job completed before cancellation readback');
              if (now() >= deadline) break;
              await delay(250);
            }
            throw new Error('Cancellation readback timed out');
          })();
          inFlightCancellations.set(key, cancellation);
          return await cancellation;
        } finally {
          inFlightCancellations.delete(key);
        }
      }
      if (name === 'chat_upload') return attachmentStore.upload(args);
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
    ledger, tracker, reporter, feed, chat, orchestrator, terminalDispatch, delivery, reconciler, subscriber, liveRegistry, liveWatch, server, health,
    async start() {
      if (started) return;
      // Baseline before subscribing: historical completed jobs must not send pushes.
      await reconciler.run().catch(() => {});
      await probe();
      const port = await server.listen();
      started = true;
      subscriber.start();
      const watches = await liveRegistry.list();
      liveWatchCount = watches.length;
      if (watches.length) {
        // A separate wildcard listener preserves the existing production
        // terminal-only subscription without broadening its decoding path.
        liveSubscriber = makeLiveSubscriber({
          natsUrl:config.natsUrl, subject:`${config.subjectPrefix}.*.>`,
          connectionName:'neo-chat-gateway-live-watch', decoder:decodeLiveEvent, log,
          onEvent:async event => {
            const queued = await exclusive(() => liveWatch.observe(event));
            if (queued) await terminalDispatch.tick().catch(error =>
              log('live_watch.dispatch_error',{error:String(error.message).slice(0,120)}));
          },
          onReconnect:async () => {
            await reconciler.run();
            const queued = await exclusive(() => liveWatch.catchup());
            if (queued) await terminalDispatch.tick();
          },
        });
        liveSubscriber.start();
        // Catch up any real events recorded between watch registration and
        // subscription, without sending historical pre-watch notifications.
        void exclusive(() => liveWatch.catchup()).then(count => {
          if (count) return terminalDispatch.tick();
        }).catch(error => log('live_watch.catchup_error',{error:String(error.message).slice(0,140)}));
      }
      // Project creation uses a browser action and can take minutes. Never block
      // NATS notifications or the local MCP listener while it initializes.
      if (autoPrepareOrchestrator) void orchestrator.ensure();
      const periodic = (fn, ms) => {
        const timer = setInterval(() => Promise.resolve(fn()).catch((error) => log('service.tick_error', { error: String(error.message).slice(0, 120) })), ms);
        timer.unref();
        timers.push(timer);
      };
      periodic(() => reconciler.run(), config.reconcileIntervalMs);
      periodic(() => terminalDispatch.tick(), 5_000);
      periodic(() => delivery.tick(), config.deliveryTickMs);
      periodic(probe, 60_000);
      if (autoPrepareOrchestrator) periodic(() => orchestrator.ensure(), 5 * 60_000);
      periodic(() => ledger.compact({ maxAgeMs: config.retentionMs }), 24 * 60 * 60_000);
      log('service.started', { port, dryRun });
    },
    async stop() {
      for (const timer of timers) clearInterval(timer);
      await subscriber.stop();
      await liveSubscriber?.stop();
      if (started) await server.close();
      started = false;
    },
  };
}
