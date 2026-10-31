#!/usr/bin/env node
/**
 * Vlog Visioner preprocess.
 * Step 1: prepare source-bound STT evidence for the Agent.
 * Step 2: consume Agent's semantic edit decisions and render an unapproved proxy.
 * The code never interprets dialogue or decides how to split the story.
 */
import { mkdirSync, renameSync, writeFileSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { loadInitialCutInputs, prepareInitialCutEvidence, buildInitialCutProposal,
  makeInitialCutAgentPrompt } from '../lib/initial-cut-proposal.mjs';
import { renderInitialCutPreview, visionContextFromProposal } from '../lib/initial-cut-preview.mjs';

const usage = 'Usage: node vlog/scripts/propose-initial-cut.mjs <dated-run> [--context TEXT] [--metadata ABS_PATH] [--agent-result ABS_PATH] [--preview]';
const args = process.argv.slice(2);
const run = args.shift();
if (!run || run.startsWith('--')) throw new Error(usage);
let context = '';
let metadataOverride;
let agentPath;
let preview = false;
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (key === '--preview') { preview = true; continue; }
  const value = args[++i];
  if (!value) throw new Error('Missing value for ' + key);
  if (key === '--context') context = value;
  else if (key === '--metadata') metadataOverride = value;
  else if (key === '--agent-result') agentPath = value;
  else throw new Error('Unknown option ' + key + '\n' + usage);
}
const directory = resolve(run);
if (!/\/\d{4}-\d{2}-\d{2}(?:-[^/]+)?$/.test(directory) || !directory.includes('/vlog/runs/')) {
  throw new Error('Expected a canonical dated /vlog/runs/<date>-<name> directory');
}
if (metadataOverride && !isAbsolute(metadataOverride)) throw new Error('--metadata must be absolute');
if (agentPath && !isAbsolute(agentPath)) throw new Error('--agent-result must be absolute');
if (preview && !agentPath) throw new Error('--preview requires --agent-result (the Agent decides splits)');
const evidence = prepareInitialCutEvidence({
  ...loadInitialCutInputs(directory, metadataOverride), context,
});
const save = (filename, contents) => {
  const out = join(directory, filename);
  const tmp = out + '.tmp-' + process.pid;
  writeFileSync(tmp, contents);
  renameSync(tmp, out);
  return out;
};
const evidencePath = save('initial-cut-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
const promptPath = save('initial-cut-agent-prompt.md', makeInitialCutAgentPrompt(evidence) + '\n');
if (!agentPath) {
  console.log(JSON.stringify({ status: evidence.status, evidence: evidencePath,
    agent_prompt: promptPath, unresolved: evidence.unresolved.length }));
} else {
  const agentDecision = JSON.parse(readFileSync(agentPath, 'utf8'));
  const proposal = buildInitialCutProposal({ evidence, agentDecision });
  const out = save('initial-cut-proposal.json', JSON.stringify(proposal, null, 2) + '\n');
  const vision = save('vision-context.json', visionContextFromProposal(proposal));
  const proxy = preview ? renderInitialCutPreview(proposal, join(directory, 'initial-cut-preview.mp4')) : null;
  console.log(JSON.stringify({ status: proposal.status, output: out, vision_context: vision,
    preview: proxy, shots: proposal.proposed_edl.edits.length, commands: proposal.hey_neo_commands.length }));
}
