import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as acquire } from '../agents/.shortcut/distribution-acquirer.agent.mjs';
import { run as transcribe } from '../agents/.shortcut/distribution-transcriber.agent.mjs';
import { run as resolveSpeaker } from '../agents/.shortcut/distribution-speaker-resolver.agent.mjs';

const projectSource=dirname(dirname(fileURLToPath(import.meta.url)));
const sha=b=>createHash('sha256').update(b).digest('hex');

function fixture(t) {
  const tmp=mkdtempSync(join(tmpdir(),'distribution-shortcut-synthetic-'));
  t.after(()=>rmSync(tmp,{recursive:true,force:true}));
  const project=join(tmp,'content-distribution');
  const run=join(project,'runs','2026-11-03-fixture');
  for(const folder of ['assets','evidence','analysis/speech']) mkdirSync(join(run,folder),{recursive:true});
  mkdirSync(join(project,'scripts'),{recursive:true});
  for(const file of ['speaker-vtt.mjs','check-story-context.mjs'])
    cpSync(join(projectSource,'scripts',file),join(project,'scripts',file));
  const put=(path,content)=>{const full=join(run,path);mkdirSync(dirname(full),{recursive:true});
    writeFileSync(full,content);return full;};
  put('evidence/rights.md','Synthetic fixture: source rights have already been reviewed (NOT public authorization)');
  const sourcePath=put('assets/episode.mp4','synthetic fixture bytes, not video');
  const sourceSha=sha(readFileSync(sourcePath));
  put('evidence/original-source.json',JSON.stringify({
    kind:'provider_original',provider_id:'rs-boost',episode_number:1,path:'assets/episode.mp4',
    source_url:'https://cps.reelshort.com/resource-square/detail/012345678901234567abcdef',
    acquisition_method:'authenticated_rsboost_content_hub',sha256:sourceSha,bytes:readFileSync(sourcePath).length,duration_s:1
  }));
  const campaign={campaign_id:'fixture-1',provider_id:'rs-boost',rights_evidence_path:'evidence/rights.md',
    target_account_ids:['tiktok-primary'],original_source_path:'evidence/original-source.json',
    story_context_path:'evidence/story-context.json'};
  put('campaign.json',JSON.stringify(campaign));
  put('evidence/story-context.json',JSON.stringify({title:'Synthetic drama',provider_id:'rs-boost',synopsis:'Alice objects',
    sources:[{kind:'official_web',url:'https://example.com/drama',observed_at:'2026-11-03T10:00:00Z'}],
    characters:[{name:'Alice',description:'Protagonist',relationships:[]}]}));
  const raw=JSON.stringify({audio_duration_secs:3.1,words:[
    {type:'word',speaker_id:'speaker_1',start:0,end:0.5,text:'Hello'},
    {type:'word',speaker_id:'speaker_1',start:0.65,end:1.2,text:'there'},
    {type:'word',speaker_id:'speaker_1',start:2,end:2.5,text:'Alice'},
  ]});
  put('analysis/speech/scribe.json',raw);
  const provenance={schema:'content-distribution.scribe-source.v1',
    source_sha256:sourceSha,source_path:sourcePath,scribe_sha256:sha(Buffer.from(raw)),
    transcription_engine:'video-use-scribe',observed_at:'2026-11-03T10:00:00Z'};
  const provenanceFile=put('analysis/speech/scribe-source.json',JSON.stringify(provenance));
  const calls=[];
  const runCommand=async (args,cwd)=>{
    calls.push(args);
    if(args.includes('check-original-source.mjs') || args[1]?.endsWith('/check-original-source.mjs'))
      return {code:0,stdout:JSON.stringify({ok:true,source_sha256:sourceSha,source_path:sourcePath})};
    if(args[0]==='npx'&&args.includes('artifact')&&args.includes('validate'))
      return {code:0,stdout:JSON.stringify({valid:true})};
    const result=spawnSync(args[0],args.slice(1),{cwd,encoding:'utf8',timeout:5000});
    return {code:result.status??-1,stdout:result.stdout||'',stderr:result.stderr||''};
  };
  return {project,run,sourceSha,sourcePath,put,provenanceFile,provenance,campaign,calls,
    context:{input:{projectPath:project,runPath:run},runCommand}};
}

test('three project shortcuts reuse validated source, derive VTT and verify named VTT via existing CLI',async t=>{
  const f=fixture(t);
  const first=await acquire(f.context);
  assert.equal(first.status,'COMPLETED');
  assert.equal(first.output.source_sha256,f.sourceSha);
  assert.equal(first.artifacts.length,5);
  const derived=await transcribe(f.context);
  assert.equal(derived.status,'COMPLETED');
  assert.equal(derived.artifacts.length,4);
  const vttPath=join(f.run,'analysis/speech/speaker-id.vtt');
  const content=readFileSync(vttPath,'utf8');
  assert.match(content,/WEBVTT/);
  assert.match(content,/<v speaker_1>/);
  assert.ok(JSON.parse(readFileSync(join(f.run,'analysis/speech/boundaries.json'))).gaps.length>0);
  f.put('analysis/speech/speaker-name.vtt',content.replaceAll('<v speaker_1>','<v Alice>'));
  const resolved=await resolveSpeaker(f.context);
  assert.equal(resolved.status,'COMPLETED');
  assert.equal(resolved.output.cues,2);
  assert.equal(resolved.artifacts.length,3);
  const before=f.calls.length;
  const again=await transcribe(f.context);
  assert.equal(again.status,'COMPLETED');
  assert.equal(f.calls.slice(before).some(args=>args.includes('from-scribe')),false,'cached export must not re-run bridge');
  assert.equal(readFileSync(vttPath,'utf8'),content);
});

test('shortcut accepts canonical run from private Relay Task text',async t=>{
  const f=fixture(t);
  const context={...f.context,input:{projectPath:f.project,taskInput:`Process this selected Neo Project run.\n- Canonical run: ${f.run}\n`}};
  assert.equal((await acquire(context)).status,'COMPLETED');
});

test('forged, mismatched or missing Scribe provenance cannot be shortcut-reused',async t=>{
  const f=fixture(t);
  f.provenance.scribe_sha256='0'.repeat(64);
  f.put('analysis/speech/scribe-source.json',JSON.stringify(f.provenance));
  await assert.rejects(transcribe(f.context),/cached_scribe_provenance_mismatch/);
  assert.equal(existsSync(join(f.run,'analysis/speech/speaker-id.vtt')),false);
  f.provenance.scribe_sha256=sha(readFileSync(join(f.run,'analysis/speech/scribe.json')));
  f.provenance.source_sha256='1'.repeat(64);
  f.put('analysis/speech/scribe-source.json',JSON.stringify(f.provenance));
  await assert.rejects(transcribe(f.context),/cached_scribe_provenance_mismatch/);
});

test('partial Scribe export is not overwritten and fails into reconciliation',async t=>{
  const f=fixture(t);
  const original=f.put('analysis/speech/speaker-id.vtt','DO NOT OVERWRITE\n');
  await assert.rejects(transcribe(f.context),/partial_scribe_export_requires_manual_reconciliation/);
  assert.equal(readFileSync(original,'utf8'),'DO NOT OVERWRITE\n');
});

test('resolved VTT changed dialogue fails existing validation; no fabricated character names',async t=>{
  const f=fixture(t);
  await transcribe(f.context);
  f.put('analysis/speech/speaker-name.vtt',readFileSync(join(f.run,'analysis/speech/speaker-id.vtt'),'utf8')
    .replace('Hello there','invented quote'));
  await assert.rejects(resolveSpeaker(f.context),/shortcut_existing_cli_check_failed/);
});

test('missing source/official story or path escapes are rejected before any video processing',async t=>{
  const f=fixture(t);
  await assert.rejects(acquire({...f.context,input:{projectPath:f.project,runPath:dirname(f.run)}}),/run_not_canonically_dated|run_outside_private_project/);
  const bad=join(tmpdir(),'not-in-private-run');
  await assert.rejects(acquire({...f.context,input:{projectPath:f.project,runPath:bad}}));
  f.campaign.story_context_path='../outside.json';
  f.put('campaign.json',JSON.stringify(f.campaign));
  await assert.rejects(acquire(f.context),/unsafe_run_relative_path/);
});

test('exclusive speaker export must refuse an existing output instead of truncating it',t=>{
  const f=fixture(t);
  const input=join(f.run,'analysis/speech/scribe.json');
  const existing=f.put('analysis/speech/speaker-id.vtt','EXISTING\n');
  assert.match(readFileSync(join(f.project,'scripts/speaker-vtt.mjs'),'utf8'),/const exclusive = flags.includes/);
  const output=spawnSync(process.execPath,[join(f.project,'scripts/speaker-vtt.mjs'),
    'from-scribe','--input',input,'--output',existing,'--exclusive'],{encoding:'utf8'});
  assert.notEqual(output.status,0);
  assert.match(output.stderr,/EEXIST/);
  assert.equal(readFileSync(existing,'utf8'),'EXISTING\n');
});


test('actual Relay artifact validator enforces cached Scribe source binding schema',t=>{
  const f=fixture(t);
  const schema=join(projectSource,'contracts/scribe-source.schema.json');
  const cli=(file)=>spawnSync('npx',['agents-relay','artifact','validate',
    '--artifact',file,'--schema',schema],{cwd:projectSource,encoding:'utf8',timeout:15000});
  const accepted=cli(f.provenanceFile);
  assert.equal(accepted.status,0,accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).valid,true);
  f.provenance.source_sha256='invalid';
  f.put('analysis/speech/scribe-source.json',JSON.stringify(f.provenance));
  const rejected=cli(f.provenanceFile);
  assert.equal(rejected.status,1,rejected.stderr);
  assert.equal(JSON.parse(rejected.stdout).valid,false);
});

test('exclusive export checks an existing boundaries file before writing a new VTT',t=>{
  const f=fixture(t);
  const input=join(f.run,'analysis/speech/scribe.json');
  const boundaries=f.put('analysis/speech/boundaries.json','DO NOT OVERWRITE\n');
  const vtt=join(f.run,'analysis/speech/speaker-id.vtt');
  const output=spawnSync(process.execPath,[join(f.project,'scripts/speaker-vtt.mjs'),
    'from-scribe','--input',input,'--output',vtt,'--boundaries',boundaries,'--exclusive'],{encoding:'utf8'});
  assert.notEqual(output.status,0);
  assert.match(output.stderr,/scribe_boundaries_output_exists/);
  assert.equal(existsSync(vtt),false);
  assert.equal(readFileSync(boundaries,'utf8'),'DO NOT OVERWRITE\n');
});
