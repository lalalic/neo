import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLocationEnrichment } from '../lib/episode-evidence.mjs';
const claim={id:'stop-1',category:'event',relation:'nearby_at_time',text:'A market was nearby',event_time:'2026-10-01T15:00:00Z',confidence:.8,source:{url:'https://example.org/market',retrieved_at:'2026-10-14T20:00:00Z'}};
test('location enrichment preserves provenance without inventing attendance',()=>{
 assert.equal(validateLocationEnrichment({schema_version:1,claims:[claim]}).claims.length,1);
 assert.throws(()=>validateLocationEnrichment({schema_version:1,claims:[{...claim,relation:'observed'}]}),/original media/);
 assert.throws(()=>validateLocationEnrichment({schema_version:1,claims:[{...claim,category:'weather',relation:'historical_context'}]}),/historical observation/);
 assert.throws(()=>validateLocationEnrichment({schema_version:1,claims:[{...claim,source:{url:'http://unsafe.test',retrieved_at:'2026-10-14'}}]}),/HTTPS provenance/);
});
