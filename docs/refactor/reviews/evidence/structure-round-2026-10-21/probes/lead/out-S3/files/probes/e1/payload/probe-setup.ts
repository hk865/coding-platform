/**
 * Copy-only setup file: tells the probe hook which test is running and resets
 * the per-probe call counter before every test. `expect.getState()` is the only
 * place Vitest exposes the current file and full test name.
 */
import { beforeEach, expect } from 'vitest';
import { resetProbeCounters, setProbeTest } from '../src/probe-hook.js';

beforeEach(() => {
  const state = expect.getState();
  setProbeTest(state.testPath ?? '', state.currentTestName ?? '');
  resetProbeCounters();
});
