/** Relay wakeups for the SAME durable Models Orchestrator. Optional until live
 * cutover: never runs a second listener against the legacy gateway implicitly.
 * Existing Relay/Events Bus types, Job authority and notification policy remain
 * unchanged. Event records are hints, not owner-approved instructions. */
import {join} from 'node:path';
import {createTracker} from './core/tracker.mjs';
import {openLedger} from './core/ledger.mjs';
import {files} from './core/files.mjs';
import {createSubscriber} from './core/subscriber.mjs';
import {createDashboardClient} from './core/dashboard.mjs';
import {createReconciler} from './core/reconcile.mjs';
import {createLiveRegistry,createLiveWatch,decodeLiveEvent} from './core/live-watch.mjs';
import {createLiveHistory} from './core/live-history.mjs';
import {createTerminalDispatcher} from './core/terminal-dispatch.mjs';

export {orchestratorRelayTurn} from './core/relay-turn.mjs';
import {orchestratorRelayTurn} from './core/relay-turn.mjs';

export async function createOrchestratorEventMonitor({
  orchestrator, stateDir, bootstrapWatchDir=null, config, dashboard,
  history, makeSubscriber=createSubscriber, log=()=>{}, now=()=>Date.now(),
}={}) {
  if(!orchestrator || typeof orchestrator.submit!=='function' || !orchestrator.state)
    throw Error('Verified existing Orchestrator head required for Relay monitor');
  if(typeof stateDir!=='string'||!stateDir.startsWith('/'))throw Error('Private Relay monitor state directory required');
  if(!config?.natsUrl||!config?.subject||!config?.subjectPrefix)throw Error('Events Bus config unavailable');
  dashboard??=createDashboardClient({baseUrl:config.dashboardUrl});
  history??=createLiveHistory({apiUrl:config.eventsApiUrl});
  const ledger=await openLedger({dir:stateDir,now});
  const tracker=createTracker({ledger,snapshotFile:join(stateDir,'snapshot.json'),files,now});
  await tracker.load();
  const reconciler=createReconciler({dashboard,tracker,now,log});
  const registry=createLiveRegistry({dir:stateDir,now});
  const watch=createLiveWatch({registry,ledger,dashboard,history,now,renderTurn:orchestratorRelayTurn});
  const submit=async ({requestId})=>{
    const record=ledger.all().find(row=>row.requestId===requestId);
    if(!record)throw Error('Relay event ledger identity missing');
    return orchestrator.submit({requestId,text:record.turnText??orchestratorRelayTurn(record)});
  };
  const dispatcher=createTerminalDispatcher({
    ledger,chat:{head:async()=>({bound:!!orchestrator.state,threadId:orchestrator.state?.threadId,projectId:orchestrator.state?.projectId})},
    submit,now,log,renderTurn:orchestratorRelayTurn,
  });
  let terminal=null,live=null,started=false;
  let timers=[];
  let serialize=Promise.resolve();
  const exclusive=fn=>{
    const next=serialize.then(fn);
    serialize=next.catch(()=>{});
    return next;
  };
  async function start(){
    if(started)return;
    // If Dashboard cannot supply a baseline, NEVER subscribe: old jobs
    // must not create a notification storm merely because the service rebooted.
    await reconciler.run();
    // Copy old watches once, non-destructively, without using the legacy cursor
    // file. Historical events are baselined at the latest durable cursor.
    if(bootstrapWatchDir){
      const seed=createLiveRegistry({dir:bootstrapWatchDir,now});
      const already=await registry.list();
      // Migration is per-watch, not all-or-nothing. After a crash halfway
      // through copying, import remaining watches with fresh historical
      // baselines; never rebaseline existing watches (which could skip
      // events that arrived since the previous copy).
      for(const item of await seed.list()){
        if(already.some(w=>w.jobId===item.jobId&&w.repository===item.repository))continue;
        const cursor=await history.latestCursor(item.jobId);
        await registry.add({repository:item.repository,jobId:item.jobId,
          startCursor:Math.max(item.startCursor??0,cursor)});
      }
    }
    terminal=makeSubscriber({
      natsUrl:config.natsUrl,subject:config.subject,connectionName:'neo-orchestrator-terminal',
      log,onEvent:event=>exclusive(async()=>{if(await tracker.observeEvent(event))await dispatcher.tick()}),
      onReconnect:()=>exclusive(async()=>{await reconciler.run();await dispatcher.tick()}),
    });
    const watches=await registry.list();
    if(watches.length){
      live=makeSubscriber({
        natsUrl:config.natsUrl,subject:config.subjectPrefix+'.*.>',
        connectionName:'neo-orchestrator-watch',decoder:decodeLiveEvent,log,
        onEvent:event=>exclusive(async()=>{if(await watch.observe(event))await dispatcher.tick()}),
        onReconnect:()=>exclusive(async()=>{await reconciler.run();if(await watch.catchup())await dispatcher.tick()}),
      });
    }
    started=true;
    terminal.start();
    live?.start();
    if(live)void exclusive(()=>watch.catchup()).then(count=>{if(count)void dispatcher.tick()})
      .catch(error=>log('orchestrator.watch.catchup_error',{error:String(error.message).slice(0,130)}));
    const periodic=(fn,interval)=>{
      const t=setInterval(()=>{void exclusive(fn).catch(error=>log('orchestrator.reconcile_error',{error:String(error.message).slice(0,130)}));},interval);
      t.unref();timers.push(t);
    };
    periodic(async()=>{await reconciler.run();await dispatcher.tick()},config.reconcileIntervalMs??300_000);
    periodic(()=>dispatcher.tick(),5000);
  }
  async function stop(){
    for(const timer of timers)clearInterval(timer);
    timers=[];
    await terminal?.stop();await live?.stop();
    terminal=null;live=null;started=false;
  }
  return {start,stop,ledger,tracker,registry,watch,dispatcher,reconciler,status:()=>({
    started,baselined:tracker.isBaselined(),terminal:terminal?.status()??null,
    live:live?.status()??null,queue:dispatcher.status(),
  })};
}
