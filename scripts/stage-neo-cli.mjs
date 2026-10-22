#!/usr/bin/env node
// Create an allowlisted, local distribution of the Neo command surface.
// No credentials, personal data, Git worktrees, build output or runtime state.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), 'neo-cli-dist-'));
if (out === root || root.startsWith(out + '/') || out.startsWith(root + '/')) throw Error('Output must be outside the Neo source checkout');
const allow = [
  '.bin/neo.mjs', '.bin/neo-control.mjs', '.bin/neo-queue.mjs',
  '.bin/package-web-chatgpt-skill',
  'agents/escalation.agent.md', 'agents/escalation-needs-user.md', 'agents/escalation-result.schema.json',
  'skills/queue/queue.mjs',
  'skills/xchat-orchestrator/scripts/list-xchat-projects',
  'skills/xchat-orchestrator/scripts/list-xchat-skills',
];
mkdirSync(out, {recursive:true});
for(const file of allow) {
  const source=join(root,file), dest=join(out,file);
  mkdirSync(dirname(dest),{recursive:true});
  cpSync(source,dest,{dereference:true});
}
writeFileSync(join(out,'.bin/list-web-chatgpt-skills'),readFileSync(join(root,'.bin/list-web-chatgpt-skills')));
chmodSync(join(out,'.bin/list-web-chatgpt-skills'),0o755);
// Expose portable SKILL.md catalog; keep implementation-specific references in their repositories.
for(const folder of readdirSync(join(root,'skills'),{withFileTypes:true})) {
  if (!folder.isDirectory()) continue;
  const input=join(root,'skills',folder.name,'SKILL.md');
  try {
    const raw=readFileSync(input);
    const dest=join(out,'skills',folder.name,'SKILL.md');
    mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,raw);
  } catch(error) { if(error.code!=='ENOENT') throw error; }
}
writeFileSync(join(out,'package.json'),JSON.stringify({
  name:'neo', version:'1.0.2-p0.1', type:'module', private:true,
  description:'Neo CLI compatibility and service control distribution candidate',
  engines:{node:'>=22'},bin:{neo:'.bin/neo.mjs','neo-queue':'.bin/neo-queue.mjs'},
  scripts:{},
},null,2)+'\n');
writeFileSync(join(out,'README.md'),'# Neo CLI distribution candidate\n\nLocally staged CLI from lalalic/neo. No application runtime or user data is bundled.\n');
process.stdout.write(out+'\n');
