/** Evidence guards for Vlog location enrichment. No network side effects. */
const RELATIONS = new Set(['observed', 'nearby_at_time', 'historical_context', 'future_suggestion']);
const CATEGORIES = new Set(['event', 'activity', 'weather', 'landmark', 'history', 'point_of_interest', 'interesting_fact']);
const isIso = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isHttps = (value) => {
  try { const url = new URL(value); return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password; }
  catch { return false; }
};

export function validateLocationEnrichment(document) {
  if (document?.schema_version !== 1 || !Array.isArray(document.claims)) throw new Error('invalid location enrichment schema');
  const ids = new Set();
  for (const claim of document.claims) {
    if (typeof claim?.id !== 'string' || !claim.id || ids.has(claim.id)) throw new Error('claim ID missing or duplicated');
    ids.add(claim.id);
    if (!CATEGORIES.has(claim.category) || !RELATIONS.has(claim.relation)) throw new Error(`invalid category/relation for ${claim.id}`);
    if (typeof claim.text !== 'string' || !claim.text.trim()) throw new Error(`claim ${claim.id} has no text`);
    if (!isHttps(claim.source?.url) || !isIso(claim.source?.retrieved_at)) throw new Error(`claim ${claim.id} requires citable HTTPS provenance`);
    if (typeof claim.confidence !== 'number' || claim.confidence < 0 || claim.confidence > 1) throw new Error(`claim ${claim.id} requires bounded confidence`);
    if (claim.relation === 'observed' && (!Array.isArray(claim.source_media_ids) || claim.source_media_ids.length === 0)) throw new Error(`observed claim ${claim.id} requires original media evidence`);
    if (claim.category === 'weather' && claim.relation !== 'future_suggestion' && claim.weather_basis !== 'historical_observation') throw new Error(`past weather ${claim.id} requires historical observation`);
    if (['event','activity'].includes(claim.category) && claim.relation === 'nearby_at_time' && !isIso(claim.event_time)) throw new Error(`nearby activity ${claim.id} must be time matched`);
  }
  return document;
}

