import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadRunGitConfig, ensureRunGit, commitRunStage } from '../.bin/neo-run-git.mjs';
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
    assert.equal(git(f.run,'tag','--list','review/r*'),'');
    writeFileSync(join(f.run,'other-note.txt'),'new version');
    const third=commitRunStage(f.run,f.config,'editor');
    assert.equal(git(f.run,'show',`${third.commitSha}:other-note.txt`),'new version');
    assert.equal(git(f.run,'show',`${first.commitSha}:other-note.txt`),'included: all nonignored');
    writeFileSync(join(f.project,'run-template','.gitignore'),'# do not replace old Run rules\n');
    ensureRunGit(f.run,loadRunGitConfig(f.project,f.declaration));
  } finally {rmSync(f.base,{recursive:true,force:true});}
});

test('global Neo Run Git excludes ignore ghost files without project template changes',()=>{
 const f=fixture();
 try{
  assert.equal(f.config.rules.includes('.ghost.'),false);
  ensureRunGit(f.run,f.config);
  const ghost=join(f.run,'.ghost.markcut.md');
  writeFileSync(ghost,'transient adapter');
  assert.equal(git(f.run,'check-ignore','-v','.ghost.markcut.md').includes('info/exclude'),true);
  const commit=commitRunStage(f.run,f.config,'editor');
  assert.equal(commit.files.includes('.ghost.markcut.md'),false);
  assert.equal(git(f.run,'ls-files').includes('.ghost.markcut.md'),false);
  const original=readFileSync(join(f.run,'.gitignore'),'utf8');
  ensureRunGit(f.run,f.config);
  assert.equal(readFileSync(join(f.run,'.gitignore'),'utf8'),original);
 }finally{rmSync(f.base,{recursive:true,force:true});}
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

test('Coordinator creation initializes private Run Git without inventing a verified Stage or Review commit', async()=>{
 const f=fixture(),calls=[],jobs=new Map(),tasks=new Map();try{
  const runRelay=args=>{
   calls.push(args);
   const type=args.slice(0,2).join(':');
   if(type==='job:create'){
    const task={id:'coordinator',title:'Coordinator',state:'QUEUED',
      input:readFileSync(args[args.indexOf('--coordinator-input-file')+1],'utf8'),
      agentGraph:readFileSync(args[args.indexOf('--coordinator-graph-file')+1],'utf8'),
      output:{kind:'file',path:args[args.indexOf('--coordinator-output-path')+1]}};
    jobs.set('job-1',{id:'job-1',repository:'local/vlog',projectPath:'.',state:'DRAFT'});
    tasks.set('job-1',[task]);return {job:'job-1',taskId:'coordinator',state:'DRAFT'};
   }
   if(type==='job:show')return jobs.get('job-1');
   if(type==='task:list')return {tasks:tasks.get('job-1')};
   if(type==='job:run'){jobs.get('job-1').state='ACTIVE';return {scheduled:true,state:'ACTIVE'};}
   throw Error('unknown '+type);
  };
  const result=await runProject(['--path',f.run,'--project','vlog'],{
   workspace:{neoRoot:f.neoRoot,harnessRoot:sourceRoot},runRelay,emit(){}
  });
  assert.equal(result,0);
  assert.equal(jobs.get('job-1').state,'ACTIVE');
  assert.equal(tasks.get('job-1').length,1);
  assert.equal(git(f.run,'log','-1','--pretty=%s'),'run: initialize local version history');
  assert.equal(git(f.run,'tag','--list','review/r*'),'');
  assert.equal(calls.filter(a=>a[0]==='task'&&a[1]==='create').length,0);
  assert.equal(calls.filter(a=>a[0]==='job'&&a[1]==='run').length,1);
 }finally{rmSync(f.base,{recursive:true,force:true})}
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


test('verified Stage checkout commits are independent of Coordinator activation',()=>{
 const f=fixture();try{
  ensureRunGit(f.run,f.config);
  writeFileSync(join(f.run,'story.md'),'verified stage content');
  const result=commitRunStage(f.run,f.config,'director','execution-a');
  assert.equal(result.changed,true);
  assert.match(git(f.run,'log','-1','--pretty=%B'),/Run-Stage: director/);
  assert.equal(commitRunStage(f.run,f.config,'director','execution-a').commitSha,result.commitSha);
  assert.equal(git(f.run,'tag','--list','review/r*'),'');
 }finally{rmSync(f.base,{recursive:true,force:true})}
});

test('unsafe Stage changes cannot be auto-committed as review or execution evidence',()=>{
 const f=fixture();try{
  ensureRunGit(f.run,f.config);
  writeFileSync(join(f.run,'unsafe-stage.json'),'private');
  git(f.run,'add','unsafe-stage.json');
  const before=git(f.run,'rev-parse','HEAD');
  assert.throws(()=>commitRunStage(f.run,f.config,'producer','execution-b'),/unexpected staged/);
  assert.equal(git(f.run,'rev-parse','HEAD'),before);
  assert.equal(git(f.run,'tag','--list','review/r*'),'');
 }finally{rmSync(f.base,{recursive:true,force:true})}
});
