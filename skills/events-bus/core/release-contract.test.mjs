import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {expandPublishEvent} from './publish-envelope.mjs';
import {releaseSubject} from './release-contract.mjs';
import {EventsBusCore} from './events-core.mjs';

const sha='a'.repeat(40);
const input={type:'package.published',source:'release/agents-relay/'+sha,
  data:{package:'agents-relay',version:'2.0.259',sha,registry:'native'}};
test('native publication has no invented Job or Task; optional Job is observational',()=>{
  const first=expandPublishEvent(input);
  assert.equal(first.job_id,undefined);assert.equal(first.task_id,undefined);
  assert.equal(first.status,'succeeded');
  const withJob=expandPublishEvent({...input,data:{...input.data,jobId:'736'}});
  assert.equal(withJob.job_id,'736');assert.equal(withJob.task_id,undefined);
  assert.equal(first.event_id,withJob.event_id);
  assert.equal(releaseSubject({subjectPrefix:'relay.events.job'},first),'relay.events.release.agents-relay.package.published');
  for(const change of [{sha:'bad'},{package:'wrong'},{jobId:'bad/id'},{registry:'npm'}]){
    assert.throws(()=>expandPublishEvent({...input,data:{...input.data,...change}}));
  }
});
test('release history is durable and optional Job association can be queried',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-release-test-'));
  try {
    const config={dataDir:dir,historyFile:path.join(dir,'events.jsonl'),subjectPrefix:'relay.events.job'};
    const core=new EventsBusCore({config});
    const event=expandPublishEvent({...input,data:{...input.data,jobId:'736'}});
    const subject=releaseSubject(config,event);
    assert.ok(core.appendEvent(subject,event));
    assert.equal(core.appendEvent(subject,event),null);
    const reopened=new EventsBusCore({config});
    assert.equal(reopened.releaseHistory('agents-relay').events.length,1);
    assert.equal(reopened.history('736').events.length,1);
    assert.equal(reopened.history('737').events.length,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('npm artifact and failure use repository-scoped release facts without a synthetic Job',()=>{
  const npm={type:'package.published',source:'release/markcut/'+sha,
    data:{package:'markcut',repository:'lalalic/markcut',artifact:'@lalalic/markcut',
      registry:'npm',version:'3.2.16',sha}};
  const event=expandPublishEvent(npm);
  assert.equal(event.job_id,undefined);
  assert.equal(event.data.artifact,'@lalalic/markcut');
  assert.equal(event.event_id,'release:markcut:'+sha+':package.published');
  const failure=expandPublishEvent({...npm,type:'package.publish_failed',data:{...npm.data,stage:'npm publish'}});
  assert.equal(failure.status,'failed');
  assert.notEqual(event.event_id,failure.event_id);
  assert.throws(()=>expandPublishEvent({...npm,data:{...npm.data,repository:'other/webhelm'}}));
  assert.throws(()=>expandPublishEvent({...npm,data:{...npm.data,artifact:undefined}}));
  assert.throws(()=>expandPublishEvent({...npm,data:{...npm.data,stage:'publish'}}));
});
