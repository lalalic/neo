import { join } from 'node:path';

export const ENV_MODES = Object.freeze(['office', 'home']);

const OFFICE_START_MINUTES = 8 * 60;
const OFFICE_END_MINUTES = 18 * 60;

const isWeekday = (date) => date.getDay() >= 1 && date.getDay() <= 5;

function isOfficeTime(date) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  return isWeekday(date) && minutes >= OFFICE_START_MINUTES && minutes < OFFICE_END_MINUTES;
}

/** Latest weekday 08:00 or 18:00 boundary that is not after `now`. */
function lastBoundary(now) {
  for (let back = 0; back <= 8; back += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    if (!isWeekday(day)) continue;
    for (const hour of [18, 8]) {
      const boundary = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0, 0);
      if (boundary <= now) return boundary;
    }
  }
  return null;
}

/**
 * Resolve the owner's execution environment.
 * Order: owner override, observed signal (none yet), then the weekday 08:00-18:00 heuristic.
 */
export function resolveEnvironment({ override = null, observed = null, now = new Date() } = {}) {
  const phone = { channel: observed?.phoneChannel ?? 'unknown' };
  if (override?.mode && ENV_MODES.includes(override.mode)) {
    return { mode: override.mode, source: 'override', since: override.setAt ?? null, phone };
  }
  if (observed?.mode && ENV_MODES.includes(observed.mode)) {
    return { mode: observed.mode, source: 'observed', since: observed.since ?? null, phone };
  }
  const boundary = lastBoundary(now);
  return {
    mode: isOfficeTime(now) ? 'office' : 'home',
    source: 'heuristic',
    since: boundary ? boundary.toISOString() : null,
    phone,
  };
}

/** The owner override lives in a small private file so the CLI and the service share it. */
export function createEnvStore({ dir, files, now = () => new Date() }) {
  const file = join(dir, 'env.json');
  return {
    file,
    async getOverride() {
      const saved = await files.readJson(file, {});
      return ENV_MODES.includes(saved.override) ? { mode: saved.override, setAt: saved.setAt ?? null } : null;
    },
    /** `mode` is office, home, or auto (clears the override). */
    async setOverride(mode) {
      if (mode === 'auto') {
        await files.writeJsonAtomic(file, { override: null });
        return null;
      }
      if (!ENV_MODES.includes(mode)) throw new Error('Environment mode must be office, home or auto');
      const setAt = now().toISOString();
      await files.writeJsonAtomic(file, { override: mode, setAt });
      return { mode, setAt };
    },
    async resolve() {
      return resolveEnvironment({ override: await this.getOverride(), now: now() });
    },
  };
}
