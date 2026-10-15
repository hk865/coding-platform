/**
 * Slice 2B row 2B-15 (entry BE2, L6/rule 5) — a lost end-commit receipt retries
 * to exactly ONE activity record.
 *
 * Fixture (built only through public calls, mirrors
 * `tests/runtime/B2-runtime-execution.test.ts`):
 * - `createB2RuntimeFixture` composes the REAL Runtime + frozen Kernel + real
 *   WorkGraph stores and a local scripted model; the scripted Turn makes one
 *   real `read` call and then answers, so the Run ends `completed`.
 * - `rebuild({ entry })` wraps the real `recordRunResult` so the FIRST genuine
 *   terminal commit fails once (the port fault §7 names, like B2 `:553`).
 * Reads go through the public `createActivityReadModel.readRunActivities`
 * (L10), never the database.
 */
import { afterEach, expect, it } from 'vitest';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort, RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { createActivityReadModel } from '../../src/core/work-graph/views/activity-read-model.js';
import { createB2RuntimeFixture, type B2RuntimeFixture } from '../helpers/B2-runtime-fixture.js';

const fixtures: B2RuntimeFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

/** The real backend records (`Records` in the claim fixture) also implement 2A's ordered lookup. */
function activityRecords(fx: B2RuntimeFixture): Parameters<typeof createActivityReadModel>[0]['records'] {
  return fx.claimFixture.records as unknown as Pick<GoalRecordTransactionPort, 'readMany' | 'eventAt'>
    & RecordLookupPort & RecordOrderedLookupPort;
}

it('2B-15 (BE2): a lost end-commit receipt retries to exactly one counted record whose recordedAt does not change', async () => {
  const fx = await createB2RuntimeFixture({ scriptedReplies: [
    { kind: 'calls', calls: [{ callId: 's2b-15-read', name: 'read', args: { path: 'b2-read.txt' } }] },
    { kind: 'text', text: 'S2B 2B-15 done' },
  ] });
  fixtures.push(fx);
  let attempts = 0;
  const runtime = fx.rebuild({ entry: { ...fx.entry,
    async recordRunResult(ctx, request) {
      attempts += 1;
      if (attempts === 1) return { status: 'rejected', code: 'unavailable', reason: 'S2B 2B-15: one transient terminal write failure' };
      return fx.entry.recordRunResult(ctx, request);
    } } });
  const prepared = await runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 's2b-15-prepare' });
  expect(prepared.status).toBe('ready'); if (prepared.status !== 'ready') return;
  const started = await runtime.port.startRun(fx.ctx, { prepared: prepared.value, consumerId: 's2b-15-consumer', requestId: 's2b-15-start' });
  expect(attempts).toBe(1);
  expect(started.status === 'ready' && started.value.run.status === 'ended').toBe(false);

  const retried = await runtime.port.observeRun(fx.ctx, { runRef: fx.claim.runRef });
  expect(retried).toMatchObject({ status: 'ready', value: { run: { status: 'ended' } } });
  expect(attempts).toBe(2);

  const model = createActivityReadModel({ records: activityRecords(fx), now: () => '2026-09-26T00:10:00.000Z' });
  const first = await model.readRunActivities(fx.ctx, { runRefs: [fx.claim.runRef] });
  expect(first.status).toBe('ready'); if (first.status !== 'ready') return;
  expect(first.value).toHaveLength(1);
  expect(first.value[0]).toMatchObject({ runRef: fx.claim.runRef, status: 'counted', error: false,
    recordedBy: 'run_end', totals: { steps: 1, edits: 0, editsUnknown: 0 }, countedThroughTurnEnd: true });
  const recordedAt = first.value[0]!.recordedAt;
  expect(recordedAt).not.toBeNull();

  // A further observation of the already-ended Run writes nothing new and does not change the record.
  await runtime.port.observeRun(fx.ctx, { runRef: fx.claim.runRef });
  const second = await model.readRunActivities(fx.ctx, { runRefs: [fx.claim.runRef] });
  expect(second.status).toBe('ready'); if (second.status !== 'ready') return;
  expect(second.value).toHaveLength(1);
  expect(second.value[0]!.recordedAt).toBe(recordedAt);
  expect(attempts).toBe(2);
}, 60_000);
