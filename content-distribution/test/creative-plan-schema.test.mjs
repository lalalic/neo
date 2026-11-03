import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const project = new URL('../',import.meta.url);
const schema=JSON.parse(readFileSync(new URL('../contracts/creative-plan.schema.json',import.meta.url),'utf8'));
const manifestSchema=JSON.parse(readFileSync(new URL('../contracts/campaign-plan.schema.json',import.meta.url),'utf8'));
const variant=(id='v1')=>({
  id,episode_reference:'episode-01',angle:'conflict',hypothesis:'Authentic confrontation may increase retention',
  source_evidence:[{start_s:12.1,end_s:19.2,observation:'The subject confronts a guard on screen'}],
  hook:'The guard refuses entry',video_path:`creatives/${id}/video.md`,status:'planned'
});
const angles=['conflict','mystery','empathy','identity-twist','moral-choice'];
const plan=(n=1)=>({schema_version:1,campaign_id:'campaign-1',creatives:Array.from({length:n},(_,i)=>({
  ...variant('v'+(i+1)),angle:angles[i],source_evidence:[{
    start_s:12.1+i*9,end_s:19.2+i*9,observation:'Distinct source-backed '+angles[i]+' beat'
  }]
}))});
function relayValidate(t,value,contract) {
  const dir=mkdtempSync(join(tmpdir(),'creative-plan-schema-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'artifact.json');writeFileSync(file,JSON.stringify(value));
  const output=spawnSync('npx',['agents-relay','artifact','validate','--artifact',file,'--schema',new URL('../contracts/'+contract,import.meta.url).pathname],{encoding:'utf8',timeout:25000});
  assert.ok([0,1].includes(output.status),output.stderr||output.error?.message);
  return {exit:output.status,...JSON.parse(output.stdout)};
}
test('Acquirer campaign manifest has no creative quota; old embedded creative inventory remains valid',t=>{
  assert.equal(manifestSchema.required.includes('creatives'),false);
  const base={campaign_id:'campaign-1',provider_id:'rs-boost',rights_evidence_path:'evidence/rights.json',
    target_account_ids:['tiktok-primary'],original_source_path:'evidence/original-source.json'};
  assert.equal(relayValidate(t,base,'campaign-plan.schema.json').valid,true);
  assert.equal(relayValidate(t,{...base,creatives:[{id:'old-v1',episode_reference:'episode-01',hook:'old',video_path:'creatives/v1/video.md',status:'previewed'}]},'campaign-plan.schema.json').valid,true);
});
test('Editor supports 1, 2 or 5 genuinely distinct creative candidates, not fixed three',t=>{
  assert.deepEqual(schema.required,['schema_version','campaign_id','creatives']);
  for(const count of [1,2,5]){
    const value=plan(count);
    const check=relayValidate(t,value,'creative-plan.schema.json');
    assert.equal(check.valid,true,JSON.stringify(check.errors));
  }
});
test('Editor evidence, hook, hypothesis and planned rendering path are mandatory',t=>{
  const wrong=[plan(0),{...plan(1),creatives:[{...variant(),source_evidence:[]}]},
    {...plan(1),creatives:[{...variant(),hypothesis:''}]},
    {...plan(1),creatives:[{...variant(),video_path:''}]},
    {...plan(1),creatives:[{...variant(),status:'published'}]}];
  for(const [i,value] of wrong.entries()){
    const check=relayValidate(t,value,'creative-plan.schema.json');
    assert.equal(check.valid,false,'invalid candidate '+i+' was accepted');
    assert.equal(check.exit,1);
  }
});
