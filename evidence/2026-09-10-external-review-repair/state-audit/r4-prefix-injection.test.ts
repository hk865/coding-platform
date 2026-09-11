import { describe, expect, it } from 'vitest';

// Isolated historical idiom: the post-fix top-level throw must not prevent
// discovery of this suite. This fixture is excluded from ordinary test runs.
function preFixProbe(error: unknown): boolean { try { throw error; } catch { return false; } }
const regression = new Error('ProjectionRepository returned a stale event page');
const ready = preFixProbe(regression);

it('the old catch-all probe turns a real regression into not-ready', () => {
  expect(ready).toBe(false);
});
describe.skipIf(!ready)('pre-fix readiness gate with a real regression', () => {
  it('would fail if executed; the historical gate suppresses it', () => {
    throw regression;
  });
});
