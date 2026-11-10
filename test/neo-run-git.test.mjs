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
  const rules = readFileSync(join(sourceRoot, 'vlog', 'run-template', '.gitignore'), 'utf8');
  writeFileSync(join(template, '.gitignore'), rules);
  const declaration = {schemaVersion:1,input:{type:'path',path:{base:'runs',datedRunDirectory:true}},
    versioning:{mode:'local-git',template:'run-template',trackedArtifacts:['story.md','video.md','production-receipt.json']}};
  for(const [file,text] of [['AGENTS.md','project policy'],['README.md','project readme'],['graph.mmd','flowchart TD\n  a[agent:a] --> b[agent:b]\n'],['project.run.json',JSON.stringify(declaration)]])
    writeFileSync(join(project,file),text);
  git(project,'init','-q');
  return {base,workspaceRoot,neoRoot,project,run,declaration,config:loadRunGitConfig(project,declaration)};
}

test('Run repo preserves paths, ignores media/private inputs, commits only allowlisted text and tags immutable SHA', () => {
  const f=fixture();
  try {
    writeFileSync(join(f.run,'source-reference.json'),JSON.stringify({sourceUrl:'https://example.test/?secret=yes'}));
    writeFileSync(join(f.run,'story.md'),'r1');
    writeFileSync(join(f.run,'video.md'),'r1');
    mkdirSync(join(f.run,'output')); writeFileSync(join(f.run,'output','video.mp4'),'original private video');
    ensureRunGit(f.run,f.config);
    assert.equal(realpathSync(git(f.run,'rev-parse','--show-toplevel')),realpathSync(f.run));
    assert.equal(git(f.run,'remote'),'');
    assert.equal(statSync(join(f.run,'.git')).mode&0o777,0o700);
    assert.deepEqual(git(f.run,'ls-files').split('\n'),['.gitignore']);
    assert.equal(spawnSync('git',['-C',f.run,'check-ignore','-q','output/video.mp4']).status,0);
    const first=commitRunStage(f.run,f.config,'editor','exec-editor');
    assert.equal(first.changed,true);
    assert.deepEqual(git(f.run,'ls-files').split('\n'),['.gitignore','story.md','video.md']);
    assert.equal(git(f.run,'cat-file','-p','HEAD').includes('secret=yes'),false);
    const noChange=commitRunStage(f.run,f.config,'producer','exec-01');
    assert.equal(noChange.changed,false);
    assert.notEqual(noChange.commitSha,first.commitSha,'a successful no-file-change Stage still has its own Commit');
    const replay=commitRunStage(f.run,f.config,'producer','exec-01');
    assert.equal(replay.reused,true);
    assert.equal(replay.commitSha,noChange.commitSha);
    const preview={status:'review_requested',requestId:'req-r1',commitSha:noChange.commitSha};
    assert.deepEqual(tagRunReview(f.run,f.config,preview),{tag:'review/r1',commitSha:noChange.commitSha,reused:false});
    assert.equal(tagRunReview(f.run,f.config,preview).reused,true);
    assert.equal(tagRunReview(f.run,f.config,{...preview,requestId:'retry-1'}).reused,true);
    writeFileSync(join(f.run,'video.md'),'r2');
    writeFileSync(join(f.run,'production-receipt.json'),JSON.stringify({videoSha256:hash('b')}));
    writeFileSync(join(f.run,'output','video.mp4'),'second private video');
    const second=commitRunStage(f.run,f.config,'producer');
    assert.notEqual(second.commitSha,first.commitSha);
    assert.equal(tagRunReview(f.run,f.config,{...preview,requestId:'req-r2',commitSha:second.commitSha}).tag,'review/r2');
    assert.equal(git(f.run,'rev-list','-n','1','review/r1'),noChange.commitSha);
    assert.equal(git(f.run,'rev-list','-n','1','review/r2'),second.commitSha);
    assert.equal(git(f.run,'tag','--list','review/*').split('\n').length,2);
    assert.equal(git(f.run,'ls-files').includes('.mp4'),false);
    assert.equal(git(f.run,'ls-files').includes('source-reference.json'),false);
    assert.equal(git(f.run,'status','--porcelain','--untracked-files=all').includes('output/video.mp4'),false);
    // Updating the template later never overwrites an existing run's ignore rules.
    writeFileSync(join(f.project,'run-template','.gitignore'), '# new project template\n');
    ensureRunGit(f.run,loadRunGitConfig(f.project,f.declaration));
    assert.match(readFileSync(join(f.run,'.gitignore'),'utf8'),/Originals/);
  } finally {rmSync(f.base,{recursive:true,force:true});}
});

test('creative-scoped Run Git tracks only versioned Markcut and QA, never media or secrets',()=>{
  const f=fixture();
  try {
    const rules=readFileSync(join(sourceRoot,'content-distribution','run-template','.gitignore'),'utf8');
    writeFileSync(join(f.project,'run-template','.gitignore'),rules);
    const declaration={...f.declaration,versioning:{...f.declaration.versioning,
      trackedArtifacts:['story.md','creatives/*/video.md','creatives/*/qa.json']}};
    const config=loadRunGitConfig(f.project,declaration);
    const creative=join(f.run,'creatives','open-first');
    mkdirSync(join(creative,'media'),{recursive:true});
    mkdirSync(join(f.run,'analysis'),{recursive:true});
    mkdirSync(join(f.run,'evidence'),{recursive:true});
    writeFileSync(join(creative,'video.md'),'source-safe shot list v1');
    writeFileSync(join(creative,'qa.json'),'\"verified\":true');
    writeFileSync(join(creative,'media','episode.mp4'),'private full original');
    writeFileSync(join(creative,'preview.mp4'),'private rendered video');
    writeFileSync(join(f.run,'analysis','speech.json'),'private dialogue');
    writeFileSync(join(f.run,'evidence','rights.md'),'private account rights');
    writeFileSync(join(f.run,'fixture-policy.json'),'private test policy');
    ensureRunGit(f.run,config);
    const commit=commitRunStage(f.run,config,'edit','unique-exec');
    assert.equal(commit.changed,true);
    assert.deepEqual(commit.files,['creatives/open-first/qa.json','creatives/open-first/video.md']);
    const tracked=git(f.run,'ls-files');
    assert.match(tracked,/creatives\/open-first\/video\.md/);
    assert.match(tracked,/creatives\/open-first\/qa\.json/);
    assert.doesNotMatch(tracked,/preview\.mp4|episode\.mp4|analysis|evidence|fixture-policy/);
    assert.equal(git(f.run,'status','--porcelain','--untracked-files=all'),'');
    writeFileSync(join(creative,'video.md'),'source-safe shot list v2');
    const next=commitRunStage(f.run,config,'edit','second-exec');
    assert.notEqual(next.commitSha,commit.commitSha);
    assert.equal(git(f.run,'show',`${commit.commitSha}:creatives/open-first/video.md`),'source-safe shot list v1');
    // Reject creative path symlinks, even if the attacker hides the target in ignored media.
    rmSync(join(creative,'video.md'));
    symlinkSync(join(f.run,'evidence','rights.md'),join(creative,'video.md'));
    assert.throws(()=>commitRunStage(f.run,config,'edit','third-exec'),/creative artifact not a regular file/);
  } finally {rmSync(f.base,{recursive:true,force:true});}
});

test('creative allowlist permits only exact one-level Markcut text and QA patterns',()=>{
  const f=fixture();
  try {
    for(const pattern of ['creatives/**/video.md','creatives/*/episode.mp4','creatives/*/media/episode.mp4','creatives/*/.env']) {
      assert.throws(()=>loadRunGitConfig(f.project,{...f.declaration,versioning:{...f.declaration.versioning,
        trackedArtifacts:['story.md',pattern]}}),/invalid.*tracked artifact/);
    }
  }finally{rmSync(f.base,{recursive:true,force:true});}
});

test('Run Git rejects remote, unexpected staged files and symlinked artifact data', () => {
  const f=fixture();
  try {
    ensureRunGit(f.run,f.config);
    writeFileSync(join(f.run,'unrelated.txt'),'do not commit');
    git(f.run,'add','--','unrelated.txt');
    assert.throws(()=>commitRunStage(f.run,f.config,'director'),/unexpected staged files/);
    git(f.run,'reset','-q');
    writeFileSync(join(f.base,'secret.txt'),'sensitive');
    symlinkSync(join(f.base,'secret.txt'),join(f.run,'story.md'));
    assert.throws(()=>commitRunStage(f.run,f.config,'director'),/not a regular file/);
    rmSync(join(f.run,'story.md'));
    git(f.run,'remote','add','origin','https://example.org/leak.git');
    assert.throws(()=>ensureRunGit(f.run,f.config),/must have no remotes/);
  } finally {rmSync(f.base,{recursive:true,force:true});}
});

test('Run config rejects missing template and invalid allowlist paths before writing Git', () => {
  const f=fixture();
  try {
    for (const artifact of ['../outside','.git/config','output/../video.md','story.md']) {
      const spec={...f.declaration,versioning:{...f.declaration.versioning,trackedArtifacts:['video.md',artifact]}};
      if(artifact==='story.md')continue;
      assert.throws(()=>loadRunGitConfig(f.project,spec),/invalid.*tracked artifact/);
    }
    rmSync(join(f.project,'run-template','.gitignore'));
    assert.throws(()=>loadRunGitConfig(f.project,f.declaration),/missing or unsafe/);
    assert.equal(statSync(join(f.run,'.git'),{throwIfNoEntry:false}),undefined);
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
