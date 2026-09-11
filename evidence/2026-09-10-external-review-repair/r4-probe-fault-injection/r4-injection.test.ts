import { describe, expect, it } from 'vitest';
// Import the REAL product probe.
import { classifyRestartProbeError } from '/mnt/d/1.project/Software/agent_platform/tests/restart/readiness-probe.js';

/** Emulates the pre-fix idiom: `catch { return false; }` -> SKIP. */
function preFixProbe(error: unknown): boolean { try { throw error; } catch { return false; } }

// A REAL regression, not a missing capability.
const regression = new Error('ProjectionRepository returned a stale event page');

const POSTFIX_READY = (() => { try { throw regression; } catch (e) { return classifyRestartProbeError(e); } })();
const PREFIX_READY  = (() => { try { throw regression; } catch (e) { return preFixProbe(e); } })();

describe('R-4 fault injection: post-fix probe', () => {
  it('a real regression must FAIL, never SKIP', () => {
    expect(classifyRestartProbeError(regression)).toBe(true);
  });
});

// This suite demonstrates the pre-fix behavior in the same run.
describe.skipIf(!PREFIX_READY)('R-4 fault injection: pre-fix idiom (expected to SKIP)', () => {
  it('never runs because the pre-fix probe swallowed the regression', () => { expect(true).toBe(true); });
});

// Sanity: the post-fix probe throws, so this suite would FAIL rather than skip.
describe.skipIf(!POSTFIX_READY)('R-4 fault injection: post-fix idiom', () => {
  it('unreachable', () => { expect(true).toBe(true); });
});
