import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

test('graph declares ordered source → STT → speaker-name VTT → Vision → Producer DAG', () => {
  const graph = read('graph.mmd').trim().split('\n');
  assert.equal(graph.shift(), 'flowchart TD');
  const agents = [...graph.join('\n').matchAll(/\[agent:([a-z-]+)\]/g)].map((m) => m[1]);
  const order = [...new Set(agents)];
  assert.deepEqual(order, [
    'distribution-rights', 'distribution-acquirer', 'distribution-planner',
    'distribution-transcriber', 'distribution-speaker-resolver', 'distribution-visioner',
    'distribution-producer', 'distribution-operator', 'distribution-analyst',
  ]);
  assert.equal((graph.join('\n').match(/-->/g) || []).length, order.length - 1);
  for (const agent of order) {
    const filename = `agents/${agent}.agent.md`;
    assert.ok(existsSync(join(root, filename)), filename);
    assert.match(read(filename), new RegExp(`^name: ${agent}$`, 'm'));
  }
});

test('persistent account registry is project-level, indexed and referenced from execution docs', () => {
  const accounts = read('accounts.md');
  for (const [id, publicUrl] of [
    ['tiktok-primary', 'https://www.tiktok.com/@lalalic001'],
    ['youtube-primary', 'https://www.youtube.com/@lalalic7595'],
  ]) {
    assert.ok(accounts.includes(`\`${id}\``));
    assert.ok(accounts.includes(publicUrl));
  }
  for (const path of ['README.md', 'AGENTS.md', 'agents/distribution-planner.agent.md', 'agents/distribution-operator.agent.md']) {
    assert.match(read(path), /accounts\.md/, path);
  }
  assert.match(accounts, /Pending Update/);
  assert.match(accounts, /no permission to publish/i);
});

test('provider config owns portals, not a series-specific campaign', () => {
  const config = JSON.parse(read('config/providers.json'));
  const provider = config.providers.find((p) => p.id === 'rs-boost');
  assert.ok(provider);
  assert.equal(provider.content_hub, 'https://cps.reelshort.com/resource-square');
  assert.equal(provider.resource_reference, undefined);
  assert.ok(provider.official_agreement);
});

test('campaign format references project account IDs and gates approved or published revisions', () => {
  const schema = JSON.parse(read('contracts/campaign-plan.schema.json'));
  assert.ok(schema.required.includes('target_account_ids'));
  assert.ok(!schema.properties.target_channels);
  assert.equal(schema.properties.creatives.items.allOf.length, 1);
  assert.ok(schema.properties.creatives.items.properties.status.enum.includes('qa_passed'));
  assert.ok(!schema.properties.creatives.items.properties.owner_approval_evidence_path);
  assert.ok(schema.properties.creatives.items.allOf.some((c) => c.then.required.includes('publication_evidence_path')));
});

test('campaign-scope owner permission replaces per-video review; platform safety stays', () => {
  assert.match(read('AGENTS.md'), /explicit owner \*\*Campaign\*\* publication authorization/);
  assert.match(read('AGENTS.md'), /Automated QA may label `qa_passed`/);
  assert.match(read('docs/commercial-readiness.md'), /One owner signature for that Campaign permission/);
  assert.match(read('agents/distribution-operator.agent.md'), /PRIVATE HOLD/);
  assert.match(read('README.md'), /\*\*Ignored, private\*\*/);
});

test('producer consumes named VTT and Vision evidence, not Video Use EDL', () => {
  const transcriber = read('agents/distribution-transcriber.agent.md');
  const resolver = read('agents/distribution-speaker-resolver.agent.md');
  const visioner = read('agents/distribution-visioner.agent.md');
  const producer = read('agents/distribution-producer.agent.md');
  assert.match(transcriber, /Video Use/);
  assert.match(transcriber, /speaker-id\.vtt/);
  assert.match(resolver, /speaker-name\.vtt/);
  assert.match(resolver, /scripts\/speaker-vtt\.mjs validate/);
  assert.match(visioner, /Markcut Vision/);
  assert.match(visioner, /original episode/);
  assert.match(producer, /speech boundaries/);
  assert.match(producer, /Do not repeat Video Use STT/);
  assert.doesNotMatch(producer, /update .*speaker_map/);
  assert.match(read('README.md'), /speaker-name\.vtt/);
});
