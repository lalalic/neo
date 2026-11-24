#!/usr/bin/env node
// Rehearse actual versioned Release installation and atomic rollback in a
// private prefix. Never write the real launcher, user configuration or Git.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const release=join(root,'target/release/neo-rs');
const installed=process.env.NEO_BLACKBOX_INSTALLED_CLI||'/opt/homebrew/bin/neo';
assert(existsSync(release),'Build native release first');
assert(existsSync(installed),'Existing Node launcher required for rollback rehearsal');
const original=realpathSync(installed);
const digest=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const oldDigest=digest(installed),base=mkdtempSync(join(tmpdir(),'neo-release-blackbox-'));
const checks=[];
function run(bin,args,env,cwd=base){const x=spawnSync(bin,args,{env,cwd,encoding:'utf8',timeout:45000,maxBuffer:24*1024*1024});assert.ok(!x.error,'Process launch failed');return x;}
function doc(r){assert.equal(r.status,0,'Nonzero CLI exit');return JSON.parse(r.stdout);}
function test(name,fn){try{fn();checks.push({name,status:'PASS'})}catch(e){checks.push({name,status:'FAIL',reason:e instanceof SyntaxError?'Invalid JSON':String(e.message).slice(0,200)})}}
try{
 const home=join(base,'home'),workspace=join(home,'Workspace'),prefix=join(home,'.local'),bin=join(prefix,'bin'),versions=join(prefix,'share/neo/versions'),target=join(versions,'candidate'),launcher=join(bin,'neo'),tools=join(base,'native-tools');
 for(const p of [workspace,bin,versions,tools,join(home,'.agents'),join(home,'.config/neo'),join(home,'.local/share/agency-agents/integrations/dsh')])mkdirSync(p,{recursive:true});
 writeFileSync(join(home,'.agents/AGENTS.md'),'# Private release rehearsal\n');
 writeFileSync(join(home,'.config/neo/workspace.json'),JSON.stringify({schemaVersion:1,neoRoot:workspace}));
 const env={HOME:home,PATH:bin+':'+process.env.PATH};
 symlinkSync(original,launcher);
 function switchTo(p){const next=join(bin,'neo.next');symlinkSync(p,next);renameSync(next,launcher);}
 const old=doc(run(launcher,['workspace','show'],env));
 test('Existing Node CLI works through disposable launcher',()=>{assert.equal(old.neoRoot,realpathSync(workspace));assert.notEqual(old.harnessRoot,realpathSync(workspace));});
 test('Optimized Rust candidate staged with matching executable and tracked assets',()=>{
  const manifest=doc(run(release,['package','stage',target],{...env,NEO_HARNESS_ROOT:root},root));
  const rev=run('git',['rev-parse','HEAD'],env,root);assert.equal(rev.status,0);assert.equal(manifest.revision,rev.stdout.trim());
  assert.equal(manifest.productionInstall,false);assert.equal(digest(join(target,'bin/neo')),digest(release));assert.ok(manifest.trackedAssets>100);
  assert.ok(!existsSync(join(target,'skills/iphone-helm')));assert.ok(!existsSync(join(target,'skills/neo-use')));assert.ok(!existsSync(join(target,'.git')));assert.ok(!existsSync(join(target,'.bin/neo.mjs')));
 });
 test('Atomic private launcher switch resolves matching versioned bundle',()=>{switchTo(join(target,'bin/neo'));assert.equal(realpathSync(launcher),realpathSync(join(target,'bin/neo')));const roots=doc(run(launcher,['workspace','show'],env));assert.equal(roots.harnessRoot,realpathSync(target));assert.equal(roots.neoRoot,old.neoRoot);});
 // Truly omit Node and Python rather than relying on /usr/bin PATH (macOS can
 // have Python developer-tool launch stubs there). Use only explicit tools.
 symlinkSync('/usr/bin/git',join(tools,'git'));symlinkSync('/usr/bin/curl',join(tools,'curl'));
 const bare={HOME:home,PATH:bin+':'+tools};
 test('Installed release Bootstrap without Node/Python or source-root override',()=>{const boot=doc(run(launcher,['bootstrap','--json'],bare));assert.ok(boot.agentRules.includes('Private release rehearsal'));assert.ok(boot.bootstrap.includes('XChat'));});
 test('Installed release agent, skill and project discovery with minimal PATH',()=>{const skills=doc(run(launcher,['skill','list'],bare));assert.ok(skills.some(x=>x.name==='neo-project'));assert.ok(skills.every(x=>!['iphone-helm','neo-use'].includes(x.name)));assert.ok(Array.isArray(doc(run(launcher,['agent','list','--source','shared'],bare))));assert.deepEqual(doc(run(launcher,['project','list'],bare)),[]);});
 test('Installed release status/doctor treat Node/Python as optional with real gateway',()=>{for(const cmd of ['status','doctor']){const r=doc(run(launcher,[cmd],bare));assert.equal(r.gateway_http,'reachable');assert.equal(r.node,'missing');assert.equal(r.python,'missing');if(cmd==='doctor')assert.ok(r.remediation.every(x=>x.startsWith('Optional:')));}});
 test('Installed release compute diagnostics and no paid side effects',()=>{const r=doc(run(launcher,['compute','doctor'],bare));assert.equal(r.native,'rust');assert.equal(r.hfCli,false);assert.equal(r.vastCli,false);assert.equal(r.localContainerRuntime,false);});
 test('Actual installed Node rollback preserves workspace and old executable',()=>{switchTo(original);assert.equal(realpathSync(launcher),original);assert.equal(digest(launcher),oldDigest);assert.deepEqual(doc(run(launcher,['workspace','show'],env)),old);});
 test('Second Rust activation and repeat rollback are idempotent',()=>{switchTo(join(target,'bin/neo'));assert.equal(doc(run(launcher,['workspace','show'],bare)).harnessRoot,realpathSync(target));switchTo(original);assert.deepEqual(doc(run(launcher,['workspace','show'],env)),old);});
 test('Production launcher and content unchanged',()=>{assert.equal(realpathSync(installed),original);assert.equal(digest(installed),oldDigest);});
}finally{rmSync(base,{recursive:true,force:true})}
const passed=checks.filter(x=>x.status==='PASS').length;console.log(JSON.stringify({scope:'release-private-launcher',passed,total:checks.length,checks,productionCutover:false},null,2));if(passed!==checks.length)process.exitCode=1;
