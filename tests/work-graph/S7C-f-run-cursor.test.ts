/**
 * F-run-cursor: the Work Run's `startedSince` is the commit cursor of the
 * commit that first records its entry, required in the current format with no
 * compatibility default, and is restored on the returned Run (book-7c §3.14
 * item 6; A2-02/A2-03). The service half starts a real scripted-model Run
 * through `S2B-runtime-steps-fixture.ts:409` and replays the exact result
 * request the Runtime committed through the production `recordRunResult`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import { compareCursors } from '../../src/contracts/ledger.js';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import type { EncodedRecord } from '../../src/core/record-store/ports.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import type { TaskResultObservation } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import { decodeRun, validateRunSnapshot } from '../../src/core/work-graph/persistence/run-record-codecs.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { withBe2KernelStoreFaults } from '../helpers/S2B-be2-reconcile-support.js';
import { createS2BRuntimeSteps } from '../helpers/S2B-runtime-steps-fixture.js';
import { B2_AT, createB2ExecutionFixture, type B2ExecutionFixture } from '../helpers/B2-execution-fixture.js';
import { runOf } from '../helpers/S2C-line-facts-samples.js';

const RUN = runOf(
  { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'run-1' },
  { status: 'starting', outcome: null, exitCode: null, startedAt: null, endedAt: null },
);

function encoded(value: unknown): EncodedRecord {
  const body = value as RunSnapshot;
  return { refKey: canonicalKey(body.ref), schemaId: 'RunSnapshot@1',
    revision: body.revision, json: JSON.stringify(value) };
}

describe('rejects: a Run record without startedSince', () => {
  it('the Run decoder and the registered schema refuse the missing field, with no default', () => {
    const { startedSince: _omitted, ...withoutField } = RUN;
    const record = encoded(withoutField);
    expect(decodeRun(record)).toEqual({ ok: false, reason: 'Run snapshot startedSince must be a commit cursor or null' });
    expect(validateRunSnapshot(record)).toEqual({ status: 'invalid',
      reason: 'Run snapshot startedSince must be a commit cursor or null' });
  });
});

const fixtures: B2ExecutionFixture[] = [];
async function openFixture(backend: 'memory' | 'sqlite') {
  const fixture = await createB2ExecutionFixture(backend);
  fixtures.push(fixture);
  return fixture;
}
async function openSteps(fixture: B2ExecutionFixture, extra: Partial<Parameters<typeof createS2BRuntimeSteps>[0]> = {}) {
  let sequence = 0;
  const id = (prefix: string) => `${prefix}-${++sequence}`;
  return createS2BRuntimeSteps({
    base: fixture.base, bodies: fixture.bodies, ctx: fixture.ctx, directory: fixture.base.directory,
    scope: fixture.base.scope, now: () => B2_AT, setClock: () => undefined,
    eventId: () => id('f-run-cursor-event'), newId: () => id('f-run-cursor-id'), consumerId: 'runtime-a', ...extra,
  });
}
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

describe.each(['memory', 'sqlite'] as const)('the Run start cursor (%s)', backend => {
  it('the entry commit binds it, a later commit keeps it, and the first success equals its replay', async () => {
    const fixture = await openFixture(backend);
    let committed: { request: GraphWrite<TaskResultObservation>; result: WriteResult<RunSnapshot> } | undefined;
    const firstEntered: { result?: WriteResult<RunSnapshot> } = {};
    const steps = await openSteps(fixture, {
      observeResult: (request, result) => { if (result.status === 'committed') committed = { request, result }; },
      observeEntered: (_request, result) => {
        if (result.status === 'committed' && firstEntered.result === undefined) firstEntered.result = result;
      },
    });
    try {
      const handle = await steps.start(fixture.claim, { at: B2_AT,
        replies: [{ kind: 'text', text: 'F-run-cursor completes the real Run' }] });
      await handle.entered;
      const first = firstEntered.result;
      if (first === undefined || first.status !== 'committed') throw Error('the entered commit must succeed');
      // The returned Run is restored from the SAME commit's receipt cursor.
      expect(first.value.startedSince).toBe(first.cursor);
      const reads = createRunStateReader({ records: steps.records });
      const enteredRead = await reads.readExecution(fixture.ctx, fixture.claim.runRef);
      expect(enteredRead.status).toBe('ready');
      if (enteredRead.status !== 'ready') throw Error('the entered Run must be readable');
      const entered = enteredRead.value.run;
      expect(entered.startedAt).toBe('2026-09-24T00:00:00.000Z');
      expect(typeof entered.startedSince).toBe('string');
      if (entered.startedSince === null) throw Error('the entry commit must bind a real cursor');
      const startedSince = entered.startedSince;

      handle.release();
      await handle.settled;
      if (committed === undefined) throw Error('the Runtime must commit its terminal result');
      const { request, result } = committed;
      if (result.status !== 'committed') throw Error('the terminal result must commit');
      // A non-entry commit never rebinds and never replaces the stored value.
      expect(compareCursors(startedSince, result.cursor)).toBeLessThan(0);
      expect(result.value.startedSince).toBe(startedSince);
      const endedRead = await reads.readExecution(fixture.ctx, fixture.claim.runRef);
      expect(endedRead.status).toBe('ready');
      if (endedRead.status !== 'ready') throw Error('the ended Run must be readable');
      expect(endedRead.value.run.startedSince).toBe(startedSince);

      // The first success and its replay answer the same Run, cursor and value.
      const replay = await fixture.entry.recordRunResult(fixture.ctx, request);
      expect(replay).toMatchObject({ status: 'committed', replayed: true, cursor: result.cursor,
        value: { startedSince } });
      const afterReplay = await reads.readExecution(fixture.ctx, fixture.claim.runRef);
      expect(afterReplay).toEqual(endedRead);
    } finally {
      await steps.close();
    }
  });

  it.each([
    { late: false, finalRow: 'W-09' },
    { late: true, finalRow: 'W-15' },
  ])('the reconcile commit binds the first entry (late evidence: $late)', async ({ late, finalRow }) => {
    const fixture = await openFixture(backend);
    const realKernelStores = late ? await createKernelStoreRegistry({ entries: [{
      adapterId: fixture.kernel.adapterId, storeKey: 'r4c-claim-kernel-store',
      workspace: fixture.base.scope, databasePath: `${fixture.base.directory}/kernel.sqlite`,
    }] }) : undefined;
    let damaged = true;
    const steps = await openSteps(fixture, realKernelStores === undefined ? {} : {
      kernelStores: withBe2KernelStoreFaults(realKernelStores, { get: () => (damaged ? 'corrupt' : 'pass') }),
    });
    try {
      // The legal small budget fails before the entered hook, so the terminal is booked by reconcile.
      const handle = await steps.start(fixture.claim, { at: B2_AT, replies: [],
        budget: { contextWindowTokens: 1, perResponseTokens: 1 } });
      await handle.settled;
      const reads = createRunStateReader({ records: steps.records });
      if (late) {
        // RUN-20(ii): the damaged probe books the unknown end and records no Turn start.
        const unknownReport = await steps.restartAndReconcile(fixture.claim.runRef, 'f-run-cursor-late-host');
        expect(unknownReport).toMatchObject({ row: 'W-06', status: 'reconciled' });
        const unknownRead = await reads.readExecution(fixture.ctx, fixture.claim.runRef);
        expect(unknownRead.status).toBe('ready');
        if (unknownRead.status !== 'ready') throw Error('the unknown-ended Run must be readable');
        expect(unknownRead.value.run.outcome).toBe('outcome_unknown');
        expect(unknownRead.value.run.startedAt).toBeNull();
        expect(unknownRead.value.run.startedSince).toBeNull();
        // The recovered Kernel books the same terminal with the Turn start (L-2).
        damaged = false;
      }
      const report = await steps.restartAndReconcile(fixture.claim.runRef,
        late ? 'f-run-cursor-late-host' : 'f-run-cursor-reconcile-host');
      expect(report).toMatchObject({ row: finalRow, status: 'reconciled' });
      const boundRead = await reads.readExecution(fixture.ctx, fixture.claim.runRef);
      expect(boundRead.status).toBe('ready');
      if (boundRead.status !== 'ready') throw Error('the reconciled Run must be readable');
      expect(boundRead.value.run.startedAt).not.toBeNull();
      expect(typeof boundRead.value.run.startedSince).toBe('string');
    } finally {
      await steps.close();
    }
  });
});
