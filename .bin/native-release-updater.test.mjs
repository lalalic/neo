import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, validateConfig, mergeCandidate, nativeCandidate, reconcile, releaseEnvironment } from './native-release-updater.mjs';
const a='a'.repeat(40), b='b'.repeat(40), c='c'.repeat(40);
const config={repositoryRoot:'/tmp/agents-relay',packageRoot:'/tmp/packages',startAfter:10,autoPublish:true,autoLive:true,livePolicy:'when-idle'};
const merge=(jobId,sha)=>({type:'job.merge.succeeded',job_id:jobId,source:{id:'job/'+jobId+'/task/merge/execution/attempt-0'},data:{mergedCommitSha:sha}});
const pub=sha=>({type:'package.published',source:{id:'release/agents-relay/'+sha},event_id:'release:agents-relay:'+sha+':package.published',data:{registry:'native',package:'agents-relay',version:'2.0.277',sha}});
function fixture(options={}) {
  const conf={...config,...options}, s=initialState(conf), events=[], jobs={}, receipts=new Set([a]), actions=[];
  let head=b, live=a, persisted, busy=false;
  const io={
    save:async v=>{persisted=structuredClone(v);},
    history:async(type,after)=>({order:'asc',events:events.filter(r=>r.cursor>after&&r.event.type===type)}),
    main:async()=>head, live:async()=>live,
    job:async id=>{if(!jobs[id])throw Error('not found');return jobs[id];},
    ancestor:async(x,y)=>[a,b,c].includes(x)&&[a,b,c].includes(y)&&x<=y,
    receipt:async x=>receipts.has(x),
    publish:async(id,x)=>{actions.push(['publish',id,x]); receipts.add(x);},
    activate:async(x,expected)=>{actions.push(['activate',x,expected]);if(busy)throw Error('busy'); live=x;},
  };
  return {conf,s,events,jobs,receipts,actions,io,get saved(){return structuredClone(persisted);}, get live(){return live;},set busy(x){busy=x;},set head(x){head=x;},
    add:(id,sha,state='COMPLETED',repo='agents-relay')=>{jobs[id]={id,state,repository:repo,projectRoot:'/tmp/'+repo,localMerge:{status:'succeeded',targetRef:'refs/heads/main',mergedCommitSha:sha}};},
    event:(event,cursor)=>events.push({event,cursor}),
    run:state=>reconcile(conf,state??s,io)};
}
test('validate strict event shapes and configuration',()=>{
  assert.equal(nativeCandidate(pub(b)),b);
  assert.equal(nativeCandidate({...pub(b),event_id:'fake'}),null);
  assert.equal(nativeCandidate({...pub(b),data:{...pub(b).data,registry:'npm'}}),null);
  assert.equal(mergeCandidate({...merge('765',b),source:{id:123}}),null);
  assert.throws(()=>validateConfig({...config,seedSha:b}));
  assert.throws(()=>validateConfig({...config,autoPublish:'true'}));
});
test('durable merge before completion, missed event, busy activation, restart and duplicate',async()=>{
  const f=fixture(); f.add('765',b,'ACTIVE'); f.event(merge('765',b),11);
  await f.run(); assert.equal(f.saved.mergeCursor,11); assert.deepEqual(f.actions,[]);
  f.add('765',b); f.busy=true;
  await assert.rejects(f.run(f.saved),/busy/);
  assert.deepEqual(f.actions,[['publish','765',b],['activate',b,a]]);
  assert.deepEqual(f.saved.releases,[b]); assert.equal(f.live,a);
  f.busy=false; f.event(pub(b),12); await f.run(f.saved);
  assert.equal(f.live,b); assert.equal(f.actions.filter(x=>x[0]==='publish').length,1);
  f.event(pub(a),13); await f.run(f.saved); assert.equal(f.live,b);
  assert.equal(f.actions.filter(x=>x[0]==='activate').length,2);
});
test('coalesce exact eligible main, reject forged foreign and unrelated commits',async()=>{
  const f=fixture();f.head=c; f.add('1',b);f.add('2',c);f.add('3',c,'COMPLETED','other');
  f.add('4',b); f.event(merge('1',b),11);f.event(merge('2',c),12);f.event(merge('3',c),13);f.event(merge('4',c),14);
  await f.run();assert.deepEqual(f.actions,[['publish','2',c],['activate',c,a]]);
  await f.run(f.saved);assert.deepEqual(f.saved.jobs,{});
});
test('seed only explicitly pinned descendant, refuse arbitrary main',async()=>{
  const f=fixture({seedJobId:'765',seedSha:c});f.add('765',b);f.head=c;
  await f.run();assert.equal(f.live,c);
  const g=fixture({seedJobId:'765'});g.add('765',b);g.head=c;
  await g.run();assert.deepEqual(g.actions,[]);
});
test('native-only autoLive uses verified receipts, not semver or event alone',async()=>{
  const f=fixture({autoPublish:false});f.head=c;f.event(pub(c),11);f.event(pub(b),12);f.receipts.add(b);
  await f.run();assert.equal(f.live,b);assert.deepEqual(f.saved.releases,[c]);
  f.receipts.add(c);await f.run(f.saved);assert.equal(f.live,c);
});
test('publish failure and main change never lose pending job',async()=>{
  const f=fixture();f.add('765',b);f.event(merge('765',b),11);
  f.io.publish=async()=>{throw Error('publish failed');};await assert.rejects(f.run(),/publish failed/);
  assert.equal(f.saved.jobs['765'],b);assert.equal(f.live,a);
  const g=fixture();g.add('765',b);g.event(merge('765',b),11);let calls=0;g.io.main=async()=>++calls===1?b:c;
  await g.run();assert.deepEqual(g.actions,[]);
});

test('non-login daemon can resolve Rustup without discarding existing PATH',()=>{
  assert.equal(releaseEnvironment({PATH:'/usr/bin'},'/home/test').PATH,'/home/test/.cargo/bin:/usr/bin');
  assert.equal(releaseEnvironment({PATH:'/usr/bin',CARGO_HOME:'/opt/rust'},'/home/test').PATH,'/opt/rust/bin:/usr/bin');
  assert.throws(()=>releaseEnvironment({CARGO_HOME:'relative'},'/home/test'));
});
