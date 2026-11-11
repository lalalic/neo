import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadRunGitConfig, ensureRunGit, commitRunStage, tagRunReview } from '../.bin/neo-run-git.mjs';
import { runProject } from '../.bin/neo-project-run.mjs';

const sourceRoot = resolve(import.meta.dirname, '..');
const hash = c => c.repeat(64);
const git = (run, ...args) => execFileSync('git', ['-C', run, ...args], {encoding:'utf8'}).trim();
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'neo-run-versioning-'));
  const workspaceRoot = join(base, 'workspace'), neoRoot = join(workspaceRoot, 'neo');
  const project = join(neoRoot, 'vlog'), run = join(project, 'runs', '2026-11-07-walk');
  const template = join(project, 'run-template');
  mkdirSync(template, {recursive:true});mkdirSync(run, {recursive:true});
  const rules = '# Unit Run ignore\n*.mp4\n*.mov\n*.key\noutput/\ninput/\nassets/\nsource-reference.json\nsource-manifest.json\n.neo-project-run.json\nneo-project-run.*\n';
  writeFileSync(join(template, '.gitignore'), rules);
  const declaration = {schemaVersion:1,input:{type:'path',path:{base:'runs',datedRunDirectory:true}},
    versioning:{mode:'local-git',template:'run-template'}};
  for(const [file,text] of [['AGENTS.md','project policy'],['README.md','project readme'],['graph.mmd','flowchart TD\n  a[agent:a] --> b[agent:b]\n'],['project.run.json',JSON.stringify(declaration)]])
    writeFileSync(join(project,file),text);
  git(project,'init','-q');
  return {base,workspaceRoot,neoRoot,project,run,declaration,config:loadRunGitConfig(project,declaration)};
}

test('Run repo commits all nonignored files and never media or private inputs', () => {
  const f=fixture();
  try {
    writeFileSync(join(f.run,'source-reference.json'),'PRIVATE');
    writeFileSync(join(f.run,'story.md'),'r1');
    writeFileSync(join(f.run,'video.md'),'r1');
    writeFileSync(join(f.run,'other-note.txt'),'included: all nonignored');
    mkdirSync(join(f.run,'output')); writeFileSync(join(f.run,'output','video.mp4'),'private media');
    ensureRunGit(f.run,f.config);
    assert.equal(realpathSync(git(f.run,'rev-parse','--show-toplevel')),realpathSync(f.run));
    assert.equal(git(f.run,'remote'),'');
    assert.equal(statSync(join(f.run,'.git')).mode&0o777,0o700);
    const first=commitRunStage(f.run,f.config,'editor','exec-editor');
    assert.deepEqual(first.files,['other-note.txt','story.md','video.md']);
    assert.equal(git(f.run,'ls-files').includes('source-reference.json'),false);
    assert.equal(git(f.run,'ls-files').includes('output/video.mp4'),false);
    const second=commitRunStage(f.run,f.config,'producer','exec-01');
    assert.notEqual(second.commitSha,first.commitSha);
    assert.equal(commitRunStage(f.run,f.config,'producer','exec-01').commitSha,second.commitSha);
    assert.equal(tagRunReview(f.run,f.config,{status:'review_requested',requestId:'r1',commitSha:second.commitSha}).tag,'review/r1');
    writeFileSync(join(f.run,'other-note.txt'),'new version');
    const third=commitRunStage(f.run,f.config,'editor');
    assert.equal(git(f.run,'show',`${third.commitSha}:other-note.txt`),'new version');
    assert.equal(git(f.run,'show',`${first.commitSha}:other-note.txt`),'included: all nonignored');
    writeFileSync(join(f.project,'run-template','.gitignore'),'# do not replace old Run rules\n');
    ensureRunGit(f.run,loadRunGitConfig(f.project,f.declaration));
  } finally {rmSync(f.base,{recursive:true,force:true});}
});

test('Run Git uses .gitignore for creative subfolders; no Stage artifact selection',()=>{
  const f=fixture();
  try {
    mkdirSync(join(f.run,'creatives','c1','media'),{recursive:true});
    writeFileSync(join(f.run,'creatives','c1','video.md'),'one');
    writeFileSync(join(f.run,'creatives','c1','qa.json'),'{}');
    writeFileSync(join(f.run,'creatives','c1','media','clip.mp4'),'private video');
    writeFileSync(join(f.run,'analysis.json'),'not stage-specific');
    const commit=commitRunStage(f.run,f.config,'edit');
    assert.deepEqual(commit.files,['analysis.json','creatives/c1/qa.json','creatives/c1/video.md']);
    assert.equal(git(f.run,'ls-files').includes('clip.mp4'),false);
  } finally {rmSync(f.base,{recursive:true,force:true});}
});

test('Run Git rejects remote, unexpected pre-staging, and symlinks', () => {
  const f=fixture();
  try {
    ensureRunGit(f.run,f.config);
    writeFileSync(join(f.run,'unrelated.txt'),'staged externally');
    git(f.run,'add','--','unrelated.txt');
    assert.throws(()=>commitRunStage(f.run,f.config,'director'),/unexpected staged/);
    git(f.run,'reset','-q');
    writeFileSync(join(f.base,'secret.txt'),'sensitive');
    symlinkSync(join(f.base,'secret.txt'),join(f.run,'story.md'));
    assert.throws(()=>commitRunStage(f.run,f.config,'director'),/unsafe Run artifact/);
    rmSync(join(f.run,'story.md'));
    git(f.run,'remote','add','origin','https://example.org/leak.git');
    assert.throws(()=>ensureRunGit(f.run,f.config),/no remotes/);
  } finally {rmSync(f.base,{recursive:true,force:true});}
});

test('Run config requires a safe ignore template but not a per-Agent trackedArtifacts list',()=>{
  const f=fixture();
  try {
    const decl={...f.declaration,versioning:{mode:'local-git',template:'run-template'}};
    assert.ok(loadRunGitConfig(f.project,decl));
    rmSync(join(f.project,'run-template','.gitignore'));
    assert.throws(()=>loadRunGitConfig(f.project,decl),/missing or unsafe/);
  } finally {rmSync(f.base,{recursive:true,force:true});}
});

test('Project Runner automatically checkpoints verified stage callbacks and review SHA', async () => {
  const f=fixture(), calls=[], jobs=new Map(), tasks=new Map();
  try {
    const runRelay = args => {
      calls.push(args);
      const type=args.slice(0,2).join(':');
      if(type==='job:create'){
        jobs.set('job-1',{id:'job-1',repository:'local/vlog',projectPath:'.',executionMode:'shortcut',contentOnly:true,state:'DRAFT'});
        return {job:'job-1'};
      }
      if(type==='task:create'){
        tasks.set('content-run',{id:'content-run',input:readFileSync(args[args.indexOf('--input-file')+1],'utf8'),
          output:{kind:'file',path:args[args.indexOf('--output-path')+1]},
          agentGraph:readFileSync(args[args.indexOf('--agent-graph-file')+1],'utf8'),state:'QUEUED'});
        return {id:'content-run'};
      }
      if(type==='job:show')return jobs.get('job-1');
      if(type==='task:list')return {tasks:[tasks.get('content-run')]};
      throw new Error('unrecognized Relay call '+type);
    };
    const runRelayJob = async (_args,onNodeEvent) => {
      writeFileSync(join(f.run,'story.md'),'walking by the river');
      onNodeEvent({nodeId:'director',type:'completed',data:{output:{title:'walk'}}});
      writeFileSync(join(f.run,'video.md'),'verified Markcut');
      writeFileSync(join(f.run,'production-receipt.json'),JSON.stringify({videoSha256:hash('c')}));
      const preReview=commitRunStage(f.run,loadRunGitConfig(f.project,f.declaration),'producer');
      onNodeEvent({nodeId:'producer',type:'completed',data:{output:{preview:{
        status:'review_requested',requestId:'req-1',commitSha:preReview.commitSha
      }}}});
      jobs.get('job-1').state='COMPLETED'; tasks.get('content-run').state='SUCCEEDED';
      return 0;
    };
    const lines=[];
    const result=await runProject(['--path',f.run,'--project','vlog'],{
      workspace:{neoRoot:f.neoRoot,harnessRoot:sourceRoot},runRelay,runRelayJob,emit:line=>lines.push(line)
    });
    assert.equal(result,0);
    assert.match(git(f.run,'log','--pretty=%s'),/run: producer verified/);
    assert.match(git(f.run,'log','--pretty=%s'),/run: director verified/);
    assert.equal(git(f.run,'rev-list','-n','1','review/r1'),git(f.run,'rev-parse','HEAD'));
    assert.equal(lines.filter(line=>line.includes('run.git.checkpoint')).length,2);
    assert.equal(calls.some(args=>args[0]==='job'&&args[1]==='run'),false);
  } finally {rmSync(f.base,{recursive:true,force:true});}
});

test('Push guard catches force-added private files and earlier leaking commits', () => {
  const base=mkdtempSync(join(tmpdir(),'neo-guard-private-'));
  const script=join(sourceRoot,'scripts','guard-private-runs.mjs');
  try{
    git(base,'init','-q');
    git(base,'config','user.name','QA');
    git(base,'config','user.email','qa@example.org');
    writeFileSync(join(base,'README.md'),'public');
    git(base,'add','README.md');git(base,'commit','-qm','baseline');
    const baseline=git(base,'rev-parse','HEAD');
    assert.equal(spawnSync(process.execPath,[script],{cwd:base,encoding:'utf8'}).status,0);
    mkdirSync(join(base,'vlog','runs','2026-11-07-leak'),{recursive:true});
    writeFileSync(join(base,'vlog','runs','2026-11-07-leak','video.md'),'sensitive');
    git(base,'add','-f','vlog/runs/2026-11-07-leak/video.md');
    let denied=spawnSync(process.execPath,[script],{cwd:base,encoding:'utf8'});
    assert.notEqual(denied.status,0);assert.match(denied.stderr,/BLOCKED/);
    git(base,'commit','-qm','leak');git(base,'rm','-q','vlog/runs/2026-11-07-leak/video.md');
    git(base,'commit','-qm','remove leak');
    assert.equal(git(base,'ls-files').includes('runs/'),false);
    const current=git(base,'rev-parse','HEAD');
    denied=spawnSync(process.execPath,[script,'--push'],{
      cwd:base,encoding:'utf8',input:`refs/heads/main ${current} refs/heads/main ${baseline}\n`
    });
    assert.notEqual(denied.status,0);assert.match(denied.stderr,/outgoing Git history/);
  } finally {rmSync(base,{recursive:true,force:true});}
});


test('Foreground Relay stderr node events are reassembled across chunks and checkpointed', async () => {
  const f=fixture();
  try {
    ensureRunGit(f.run,f.config);
    const fake=join(f.base,'fake-relay.mjs');
    writeFileSync(fake,`import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(join(f.run,'story.md'))}, 'foreground stage');
process.stderr.write('shortcut.node {"nodeId":"director","type":"com');
setTimeout(()=>{process.stderr.write('pleted","data":{"output":{}}}\\n');process.exit(0);},20);
`);
    const {executeBoundRun}=await import('../.bin/neo-project-run.mjs');
    const stages=[];
    const result=await executeBoundRun({
      relayCli:fake,emit(){},error(){},onNodeEvent:event=>{
        stages.push(event.nodeId);
        commitRunStage(f.run,f.config,event.nodeId);
      }
    },{binding:join(f.run,'.neo-project-run.json')},['job','run']);
    assert.equal(result,0);assert.deepEqual(stages,['director']);
    assert.match(git(f.run,'log','-1','--pretty=%s'),/director verified/);
    assert.match(readFileSync(join(f.run,'neo-project-run.log'),'utf8'),/shortcut.node/);
  }finally{rmSync(f.base,{recursive:true,force:true});}
});

test('A checkpoint failure stops the live Relay child instead of silently continuing', async () => {
  const f=fixture();
  try{
    ensureRunGit(f.run,f.config);
    const fake=join(f.base,'fake-relay.mjs');
    writeFileSync(fake,`process.stderr.write('shortcut.node {"nodeId":"editor","type":"completed","data":{"output":{}}}\\n');
setTimeout(()=>process.exit(0),1500);`);
    const {executeBoundRun}=await import('../.bin/neo-project-run.mjs');
    await assert.rejects(()=>executeBoundRun({
      relayCli:fake,emit(){},error(){},onNodeEvent:()=>{
        throw new Error('checkpoint validation failed');
      }
    },{binding:join(f.run,'.neo-project-run.json')},['job','run']),/checkpoint validation failed/);
  }finally{rmSync(f.base,{recursive:true,force:true});}
});
