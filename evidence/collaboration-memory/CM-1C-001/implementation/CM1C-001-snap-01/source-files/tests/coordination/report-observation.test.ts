import { expect, it } from 'vitest';
import { AlternativeReportObservation } from '../../src/harness/alternative-report-observation.js';
import type { WaitConditionSnapshot } from '../../src/contracts/coordination.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';

// Only the observation capability lifecycle is under test. No fake domain
// admission is exercised; real Control/SQLite consumers have separate tests.
const wait = { ref: { aggregateType: 'WaitCondition', projectId: 'p', workspaceId: 'w', waitId: 'wait' }, revision: 1 } as WaitConditionSnapshot;
const predecessor = { ref: { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'run' }, revision: 2 } as RunSnapshot;
const observed = { status: 'observed' as const, qualification: { basis: { planRef: null, workspaceRevision: null, sourceDigest: null }, observations: [] } };

it('cannot read another attempt observation using matching versions alone', async () => {
  const store = new AlternativeReportObservation();
  const first = store.record(wait, predecessor, [], observed);
  const second = store.record(wait, predecessor, [], { status: 'unavailable', reason: 'second inspection failed' });
  expect(await store.observe(wait, predecessor, [])).toMatchObject({ status: 'unavailable' });
  expect(await store.observe(wait, predecessor, [], second.token)).toEqual({ status: 'unavailable', reason: 'second inspection failed' });
  expect(await store.observe(wait, predecessor, [], first.token)).toEqual(observed);
  expect(await store.observe(wait, predecessor, [], first.token)).toMatchObject({ status: 'unavailable' });
});

it('cleans an unconsumed observation on early exit and rejects changed versions', async () => {
  const store = new AlternativeReportObservation();
  const early = store.record(wait, predecessor, [], observed);
  early.dispose();
  expect(await store.observe(wait, predecessor, [], early.token)).toMatchObject({ status: 'unavailable' });
  const changed = store.record(wait, predecessor, [], observed);
  expect(await store.observe({ ...wait, revision: 2 }, predecessor, [], changed.token)).toMatchObject({ status: 'unavailable' });
  expect(await store.observe(wait, predecessor, [], changed.token)).toMatchObject({ status: 'unavailable' });
});

it('never restores a pre-restart observation', async () => {
  const old = new AlternativeReportObservation().record(wait, predecessor, [], observed);
  expect(await new AlternativeReportObservation().observe(wait, predecessor, [], old.token)).toMatchObject({ status: 'unavailable' });
});
