import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeEvent } from '../core/subscriber.mjs';
import { parseRuntimeStatusEvent, jobKey } from '../core/job-status.mjs';
import { timestamp } from './helpers.mjs';

const data = (input) => new TextEncoder().encode(JSON.stringify(input));
const envelope = (to, extra = {}) => ({ type: 'job.runtime_status.changed', job_id: '19', data: {
  to, updatedAt: timestamp(), repository: 'neo', ...extra,
} });

test('decodes terminal, nonterminal and unknown-field events without leaking envelope data', () => {
  assert.equal(decodeEvent(data(envelope('COMPLETED', { privateField: 'secret' }))).to, 'COMPLETED');
  assert.equal(decodeEvent(data(envelope('CANCELLED'))).to, 'CANCELLED');
  assert.equal(decodeEvent(data(envelope('RUNNING'))).to, 'RUNNING');
  assert.equal(decodeEvent(data(envelope('COMPLETED', { from: 'RUNNING' }))).from, 'RUNNING');
  assert.equal(decodeEvent(data(envelope('COMPLETED'))).privateField, undefined);
  assert.equal(parseRuntimeStatusEvent({ ...envelope('COMPLETED'), type: 'another.event' }), null);
});

test('malformed, oversized or timestamp-less events are ignored', () => {
  assert.equal(decodeEvent(data({ no: 'envelope' })), null);
  assert.equal(decodeEvent(data(envelope('COMPLETED', { updatedAt: 'invalid' }))), null);
  assert.equal(decodeEvent(new Uint8Array(70_000)), null);
  assert.equal(decodeEvent(data(envelope('COMPLETED', { from: null }))).from, undefined);
  assert.equal(decodeEvent(new Uint8Array([123, 34])), null);
  assert.equal(jobKey('19', 'COMPLETED', timestamp()), `job:19:COMPLETED:${timestamp()}`);
});
