/** Dashboard-based catch-up, including the silent first-start baseline. */
export function createReconciler({ dashboard, tracker, now = () => Date.now(), log = () => {} }) {
  let inFlight = null;
  let lastSuccessAt = null;
  let lastError = null;
  let reachable = false;

  async function run() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const jobs = await dashboard.fetchJobs();
        const result = await tracker.observeJobs(jobs);
        lastSuccessAt = new Date(now()).toISOString();
        reachable = true;
        lastError = null;
        return result;
      } catch (error) {
        reachable = false;
        lastError = String(error?.message ?? error).slice(0, 150);
        log('reconcile.failed', { error: lastError });
        throw error;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return { run, status: () => ({ reachable, lastSuccessAt, lastError }) };
}
