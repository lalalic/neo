import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const graph = await readFile(new URL('../templates/cinematic-vlog/GRAPH.md', import.meta.url), 'utf8');
const research = await readFile(new URL('../templates/cinematic-vlog/RESEARCH.md', import.meta.url), 'utf8');
test('durable cinematic template includes every gate and canonical output', () => {
  for (const needle of ['flowchart TD', 'source-manifest.json', 'analysis/observations.md', 'story.md', 'visual-brief.md', 'video.md', 'execution/timeline-audio.md', 'assets/', 'reviews/video-director.md', 'reviews/market.md', 'reviews/creative-approval.json', 'reviews/human-approval.json', 'output/final.mp4', 'publish/receipt.json', 'Changes requested', 'Both PASS', 'post-agent']) assert.ok(graph.includes(needle), needle);
  assert.match(graph, /Human approves creative direction/);
  assert.match(graph, /Separate publishing authorization/);
  assert.match(graph, /one top-level durable episode Task/i);
});
test('external references preserve license and deployment boundaries', () => {
  for (const needle of ['lemomo-ai/lemo-opuscar', 'Ding200602/video-shotcraft', 'MIT', 'Apache-2.0', 'Remotion', 'not', 'Markcut']) assert.ok(research.includes(needle), needle);
});
