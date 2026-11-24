/** Catch up on recorded Relay events after a live NATS disconnect.
 * Event history is wakeup evidence only, never the Relay execution authority. */
import { normalizeJobId } from './relay-jobs.mjs';

export function createLiveHistory({apiUrl, fetcher=fetch, timeoutMs=5_000}={}) {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(apiUrl ?? ''))
    throw new Error('Live history endpoint must be an HTTP loopback URL');
  const query = async (jobId,options) => {
    if (normalizeJobId(jobId) !== jobId) throw new Error('Invalid live watch Job ID');
    const url = new URL('/events',apiUrl);
    url.searchParams.set('job',jobId);
    for (const [name,value] of Object.entries(options)) url.searchParams.set(name,String(value));
    const response = await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
    if (!response.ok) throw new Error(`Live history HTTP ${response.status}`);
    const data = await response.json();
    if (data?.job_id !== jobId || !Array.isArray(data.events) ||
        !Number.isSafeInteger(data.next_cursor) || data.next_cursor < 0)
      throw new Error('Invalid live history response');
    return data;
  };
  return {
    async latestCursor(jobId) {
      const page = await query(jobId,{order:'desc',limit:1});
      if (page.events.length && (!Number.isSafeInteger(page.events[0].cursor) || page.events[0].cursor <= 0))
        throw new Error('Invalid latest live history cursor');
      return page.events.length ? page.events[0].cursor : 0;
    },
    async after(jobId,cursor) {
      if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid live history cursor');
      const page = await query(jobId,{order:'asc',limit:60,after:cursor});
      let prev = cursor;
      for (const entry of page.events) {
        if (!Number.isSafeInteger(entry?.cursor) || entry.cursor <= prev ||
            entry.cursor > page.next_cursor || entry.event?.job_id !== jobId) {
          throw new Error('Invalid live history event cursor');
        }
        prev = entry.cursor;
      }
      if (page.events.length && prev !== page.next_cursor)
        throw new Error('Non-advancing live history cursor');
      if (!page.events.length && page.next_cursor !== cursor)
        throw new Error('Empty live history response moved the cursor');
      return page;
    },
  };
}
