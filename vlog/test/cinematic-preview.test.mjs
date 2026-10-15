import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../templates/cinematic-preview-demo.md', import.meta.url), 'utf8');
const headerLines = script.split(/\r?\n/).filter(line => line.startsWith('## '));

test('synthetic cinematic preview uses Markcut-parsable scene header tokens', () => {
  assert.ok(headerLines.length >= 5, 'expected hook, motion, payoff, route and cinematic scenes');
  // Markcut scene DSL parses a header as a single scene identifier; unquoted
  // additional words (previously "Route interlude ...") trigger a DslError.
  for (const header of headerLines) assert.match(header, /^## [a-zA-Z][a-zA-Z0-9_-]*$/);
});

test('native route and cinematic map scenes use labelled synthetic waypoints', () => {
  const mapLeaves = script.split(/\r?\n/).filter(line => /^- map /.test(line));
  assert.equal(mapLeaves.length, 2);
  assert.ok(mapLeaves.some(line => /view:route\b/.test(line)));
  assert.ok(mapLeaves.some(line => /view:cinematic\b/.test(line)));
  for (const line of mapLeaves) {
    assert.match(line, /Demo A/);
    assert.match(line, /Demo B/);
    assert.doesNotMatch(line, /travelMode:/, 'do not claim observed mode of transport');
  }
  assert.match(script, /Route-inferred-navigation/, 'calculated route must be distinguishable from observed movement');
  assert.match(script, /<video src=/, 'map interlude must preserve original moving footage');
  assert.match(script, /subtitle:/, 'retain story subtitle track');
  assert.match(script, /- audio src:/, 'retain a native synthetic audio node');
});
