#!/usr/bin/env node
// Create an allowlisted, local distribution of the Neo command surface.
// No credentials, personal data, Git worktrees, build output or runtime state.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), 'neo-cli-dist-'));
if (out === root || root.startsWith(out + '/') || out.startsWith(root + '/')) throw Error('Output must be outside the Neo source checkout');
const allow = [
  '.bin/neo.mjs', '.bin/neo-control.mjs', 'skills/daemon-service-manage/bin/serviceman.mjs',
  '.bin/package-web-chatgpt-skill',
  'agents/escalation.agent.md', 'agents/escalation-needs-user.md', 'agents/escalation-result.schema.json',
  'skills/xchat-orchestrator/scripts/list-xchat-projects',
  'skills/xchat-orchestrator/scripts/list-xchat-skills',
];
mkdirSync(out, {recursive:true});
for(const file of allow) {
  const source=join(root,file), dest=join(out,file);
  mkdirSync(dirname(dest),{recursive:true});
  cpSync(source,dest,{dereference:true});
}
// Preserve the complete tracked skill source contract, not just SKILL.md.
// Use committed Git blobs: never bundle unrelated dirty worktrees, untracked
// credentials, personal media or developer-generated runtime files.
const manifest = spawnSync('git',['-C',root,'ls-files','-s','-z','--','skills'],{encoding:'buffer'});
if (manifest.status !== 0) throw Error('Unable to resolve committed skill manifest');
for (const entry of manifest.stdout.toString('utf8').split('\0').filter(Boolean)) {
  const tab=entry.indexOf('\t');
  if (tab < 0) throw Error('Invalid tracked Git entry');
  const mode=entry.slice(0,tab).split(' ')[0], rel=entry.slice(tab+1);
  if (!['100644','100755'].includes(mode)) throw Error(`Non-file skill entry: ${rel}`);
  if (!/^skills\/[a-zA-Z0-9._/-]+$/.test(rel) || rel.includes('..')) throw Error(`Unsafe tracked skill path: ${rel}`);
  const dst=join(out,rel);
  if (existsSync(dst)) continue; // Explicit installed compatibility entrypoints win.
  const blob=spawnSync('git',['-C',root,'show',`HEAD:${rel}`],{encoding:'buffer',maxBuffer:10*1024*1024});
  if (blob.status !== 0) throw Error(`Unable to load committed skill asset: ${rel}`);
  mkdirSync(dirname(dst),{recursive:true});writeFileSync(dst,blob.stdout);
  chmodSync(dst,mode==='100755'?0o755:0o644);
}
writeFileSync(join(out,'package.json'),JSON.stringify({
  name:'@lalalic/neo', version:'1.0.2', type:'module',
  description:'Neo CLI and deterministic service management commands',
  engines:{node:'>=22'},bin:{neo:'.bin/neo.mjs',serviceman:'skills/daemon-service-manage/bin/serviceman.mjs'},
  repository:{type:'git',url:'git+https://github.com/lalalic/neo.git'}, publishConfig:{access:'public'}, scripts:{},
},null,2)+'\n');
writeFileSync(join(out,'README.md'),'# Neo CLI distribution candidate\n\nLocally staged CLI from lalalic/neo. No application runtime or user data is bundled.\n');
process.stdout.write(out+'\n');
