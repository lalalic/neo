#!/usr/bin/env node
/**
 * Visioner preprocessing: approved sources + available STT before full vision.
 * Produce a private, provisional first cut and optional playable proxy.
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { buildInitialCutProposal, loadInitialCutInputs } from '../lib/initial-cut-proposal.mjs';
import { renderInitialCutPreview, visionContextFromProposal } from '../lib/initial-cut-preview.mjs';

function usage() {
  return 'Usage: node vlog/scripts/propose-initial-cut.mjs <canonical run directory> [--context "story background"] [--metadata /absolute/metadata.json] [--wake-phrase "Hey Neo"] [--preview]';
}

const args = process.argv.slice(2);
const runDir = args.shift();
if (!runDir || runDir.startsWith('--')) {
  console.error(usage());
  process.exitCode = 2;
} else {
  let context = '';
  let metadataOverride;
  const wakePhrases = [];
  const preview = args.includes('--preview');
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--preview') continue;
    const value = args[++i];
    if (!value) throw new Error(`Missing value for ${key}\n${usage()}`);
    if (key === '--context') context = value;
    else if (key === '--metadata') {
      if (!isAbsolute(value)) throw new Error('--metadata must be an absolute path');
      metadataOverride = value;
    } else if (key === '--wake-phrase') wakePhrases.push(value);
    else throw new Error(`Unknown option: ${key}\n${usage()}`);
  }
  const directory = resolve(runDir);
  // The caller supplies only a canonical dated run, never a transient worktree
  // or a reusable tracked project folder.
  if (!/\/(?:\d{4}-\d{2}-\d{2}(?:-[^/]+)?)$/.test(directory) || !directory.includes('/vlog/runs/')) {
    throw new Error('Expected a canonical dated Vlog runs/<YYYY-MM-DD[-slug]> directory');
  }
  const evidence = loadInitialCutInputs(directory, metadataOverride);
  const proposal = buildInitialCutProposal({ ...evidence, context, wakePhrases });
  const out = join(directory, 'initial-cut-proposal.json');
  const tmp = `${out}.tmp-${process.pid}`;
  mkdirSync(directory, { recursive: true });
  writeFileSync(tmp, JSON.stringify(proposal, null, 2) + '\n');
  renameSync(tmp, out);
  const contextPath = join(directory, 'vision-context.json');
  const contextTemp = `${contextPath}.tmp-${process.pid}`;
  writeFileSync(contextTemp, visionContextFromProposal(proposal));
  renameSync(contextTemp, contextPath);
  const proxy = preview ? renderInitialCutPreview(proposal, join(directory, 'initial-cut-preview.mp4')) : null;
  console.log(JSON.stringify({
    status: proposal.status, output: out, shots: proposal.proposed_edl.edits.length,
    hey_neo_commands: proposal.hey_neo_commands.length, unresolved: proposal.unresolved.length,
    vision_context: contextPath, preview: proxy,
  }));
}
