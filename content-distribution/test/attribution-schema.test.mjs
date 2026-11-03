import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const schema = JSON.parse(readFileSync(new URL('../contracts/attribution-snapshot.schema.json', import.meta.url)));
test('measurement key is one creative revision, account, post and private affiliate reference', () => {
  for (const k of ['campaign_id', 'creative_revision_id', 'platform_account_id', 'post', 'affiliate_link_ref', 'platform_metrics', 'provider_metrics'])
    assert.ok(schema.required.includes(k), k);
  assert.equal(schema.properties.affiliate_link_ref.description.includes('never the actual tracking URL'), true);
  assert.equal(schema.properties.post.required.includes('id'), true);
});
test('observed zero cannot masquerade as missing provider orders', () => {
  const observation = schema.definitions.nonNegativeObservation;
  assert.equal(observation.properties.value.type.includes('null'), true);
  assert.equal(observation.allOf[0].then.properties.value.type, 'null');
  assert.equal(observation.allOf[1].then.properties.value.type, 'integer');
  assert.ok(schema.properties.provider_metrics.required.includes('qualifying_orders'));
  assert.ok(schema.properties.provider_metrics.required.includes('scope'));
  assert.deepEqual(schema.properties.provider_metrics.properties.scope.enum, ['post','campaign','account','unavailable']);
});
test('operational contract separates publication, attribution and payout', () => {
  const text=readFileSync(new URL('../docs/commercial-readiness.md',import.meta.url),'utf8');
  assert.match(text,/Pending Update/);
  assert.match(text,/submitted_unverified/);
  assert.match(text,/Distinct settlement/i);
  assert.match(text,/not a safe idempotency key/);
});
