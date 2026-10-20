/** Slice 5 round 2: real Host driver and Workflow ordering, scripted advances. */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { makeCommitCursor, type GoalRef } from '../../src/contracts/ledger.js';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { CollaborationDriver, CollaborationStartInput } from '../../src/app/collaboration-driver.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import {
  GOAL_A, GOAL_B, T, openS5DecisionFixture, type S5DecisionFixture,
} from '../helpers/S5-decision-fixture.js';
import { ready } from '../helpers/S5-user-message-support.js';
import {
  completedAdvance, deferred, orderedDriver, waitForDriverState,
  type AdvanceScript, type RecordedAdvance,
} from '../helpers/S5R2-d-support.js';

const fixtures: S5DecisionFixture[] = [];
const drivers: CollaborationDriver[] = [];
const releaseCalls: (() => void)[] = [];
afterEach(async () => {
  // Unreturned Workflow calls stay pending through the assertions, then drain.
  for (const release of releaseCalls.splice(0)) release();
  for (const driver of drivers.splice(0)) await driver.close();
  for (const f of fixtures.splice(0)) await f.close();
});

async function fixture() {
  const f = await openS5DecisionFixture('memory');
  fixtures.push(f);
  return f;
}
async function harness(f: S5DecisionFixture, script: AdvanceScript = () => completedAdvance(),
  ordering: 'real' | 'reject' | 'throw' = 'real') {
  const h = await orderedDriver(f, script, ordering);
  drivers.push(h.driver);
  return h;
}
function pendingAdvance() {
  const pending = deferred<WorkflowAdvanceResult>();
  releaseCalls.push(() => pending.resolve(completedAdvance()));
  return pending;
}
function select(goalRef: GoalRef, sessionHint: SessionRef | null): WorkflowAdvanceInput {
  return { schemaVersion: 1, kind: 'select_work', goalRef,
    flowId: `s5r2-d:flow-${goalRef.goalId}`, sessionHint };
}
function startInput(advance: WorkflowAdvanceInput): CollaborationStartInput {
  return { advance, queryProfileIds: [] };
}
function observed(calls: RecordedAdvance[]) {
  return calls.map(({ goalRef, kind, taskId }) => ({ goalRef, kind, taskId }));
}
async function idleSession(f: S5DecisionFixture) {
  const ref = await f.createS5Session('s5r2-d-idle');
  const card = ready(await createSessionDirectory({ records: f.records, lookups: f.records }).readSession(f.ctx, ref));
  expect(card.record).toMatchObject({ lifecycle: 'active', occupancy: null });
  return ref;
}
async function startTogether(f: S5DecisionFixture, driver: CollaborationDriver,
  a: WorkflowAdvanceInput, b: WorkflowAdvanceInput) {
  // One turn: no await between the two starts (the table's batching definition).
  const first = driver.start(f.ctx, startInput(a));
  const second = driver.start(f.ctx, startInput(b));
  const results = await Promise.all([first, second]);
  expect(results).toHaveLength(2);
  expect(results[0]).toMatchObject({ status: 'ready', value: { goalRef: GOAL_A } });
  expect(results[1]).toMatchObject({ status: 'ready', value: { goalRef: GOAL_B } });
}

describe('S5R2 driver ordering safe point (memory)', () => {
  it('R2D07 orders simultaneous selections for the same Session B then A in one pass', async () => {
    const f = await fixture();
    const session = await idleSession(f);
    const h = await harness(f);
    const a = select(GOAL_A, session);
    const b = select(GOAL_B, session);
    await startTogether(f, h.driver, a, b);
    await h.waitForCalls(2);
    await waitForDriverState(f, h.driver, GOAL_A, 'completed');
    await waitForDriverState(f, h.driver, GOAL_B, 'completed');
    expect(observed(h.calls)).toEqual([
      { goalRef: GOAL_B, kind: 'select_work', taskId: null },
      { goalRef: GOAL_A, kind: 'select_work', taskId: null },
    ]);
    expect(h.calls.map(call => call.input)).toEqual([b, a]);
    expect(h.orderCalls).toEqual([[a, b]]);
    expect(h.orderResults).toEqual([{ status: 'ready', value: { advances: [b, a] } }]);
  });

  it('R2D08 includes null Session hints in the same B then A ordering pass', async () => {
    const f = await fixture();
    const h = await harness(f);
    const a = select(GOAL_A, null);
    const b = select(GOAL_B, null);
    await startTogether(f, h.driver, a, b);
    await h.waitForCalls(2);
    await waitForDriverState(f, h.driver, GOAL_A, 'completed');
    await waitForDriverState(f, h.driver, GOAL_B, 'completed');
    expect(observed(h.calls)).toEqual([
      { goalRef: GOAL_B, kind: 'select_work', taskId: null },
      { goalRef: GOAL_A, kind: 'select_work', taskId: null },
    ]);
    expect(h.calls.map(call => call.input)).toEqual([b, a]);
    expect(h.orderCalls).toEqual([[a, b]]);
  });

  it('R2D09 releases both handles in arrival order when ordering returns unsupported', async () => {
    const f = await fixture();
    const session = await idleSession(f);
    const h = await harness(f, () => completedAdvance(), 'reject');
    const a = select(GOAL_A, session);
    const b = select(GOAL_B, session);
    await startTogether(f, h.driver, a, b);
    await h.waitForCalls(2);
    await waitForDriverState(f, h.driver, GOAL_A, 'completed');
    await waitForDriverState(f, h.driver, GOAL_B, 'completed');
    expect(observed(h.calls)).toEqual([
      { goalRef: GOAL_A, kind: 'select_work', taskId: null },
      { goalRef: GOAL_B, kind: 'select_work', taskId: null },
    ]);
    expect(h.calls.map(call => call.input)).toEqual([a, b]);
    expect(h.orderCalls).toEqual([[a, b]]);
    // The real ordering would have reversed them; only the injected refusal did not.
    expect(h.orderResults).toEqual([{ status: 'ready', value: { advances: [b, a] } }]);
  });

  it('R2D10 releases both handles in arrival order when ordering throws', async () => {
    const f = await fixture();
    const session = await idleSession(f);
    const h = await harness(f, () => completedAdvance(), 'throw');
    const a = select(GOAL_A, session);
    const b = select(GOAL_B, session);
    await startTogether(f, h.driver, a, b);
    await h.waitForCalls(2);
    await waitForDriverState(f, h.driver, GOAL_A, 'completed');
    await waitForDriverState(f, h.driver, GOAL_B, 'completed');
    expect(observed(h.calls)).toEqual([
      { goalRef: GOAL_A, kind: 'select_work', taskId: null },
      { goalRef: GOAL_B, kind: 'select_work', taskId: null },
    ]);
    expect(h.calls.map(call => call.input)).toEqual([a, b]);
    expect(h.orderCalls).toEqual([[a, b]]);
    expect(h.orderResults).toEqual([{ status: 'ready', value: { advances: [b, a] } }]);
  });

  it('R2D11 bypasses ordering for the completed Task observation and re-enters at Goal scope', async () => {
    const f = await fixture();
    const a = select(GOAL_A, null);
    const pinned: WorkflowAdvanceInput = { ...a, taskId: 'a-work' };
    // Only advanceWork is scripted: this full typed receipt is consumed by the
    // real driver's complete_task/next recognition, and is never written to Store.
    const completedTask: WorkflowAdvanceResult = { status: 'ready', value: {
      state: 'advance', reason: 'the selected Task was completed', next: pinned,
      receipt: { kind: 'complete_task', result: { status: 'committed', replayed: false,
        cursor: makeCommitCursor(1), value: {
          ref: { aggregateType: 'TaskReduction', projectId: 'P', goalId: 'A', taskId: 'a-work' },
          revision: 1, schemaVersion: 1, planRef: f.plans.A1.ref, planRevision: 1,
          taskKind: 'work', requirementLevel: 'required', disposition: 'active', phase: 'satisfied',
          currentAnchor: { schemaVersion: 1, planRef: f.plans.A1.ref, planRevision: 1, workspaceRevision: 3,
            pinnedCompletionPolicy: f.plans.A1.effectiveCompletionPolicy,
            pinnedArchitectureBaseline: f.plans.A1.effectiveArchitectureBaseline },
          effectiveEvidenceIds: [], blockingEvidenceIds: [], staleEvidenceIds: [], outOfScopeEvidenceIds: [],
          satisfiedObligationIds: ['PA1-obligation'], causes: [], reducedAt: T,
          completion: { schemaVersion: 1,
            roundRef: { aggregateType: 'VerificationRound', projectId: 'P', workspaceId: 'W', goalId: 'A',
              taskId: 'a-work', runId: 'r-a', roundId: 'round-a' },
            roundRevision: 1, taskBasisRef: f.plans.A1.ref,
            verificationPlanRef: { planId: 'vplan-a', planDigest: 'a'.repeat(64) },
            configurationDigest: 'b'.repeat(64), evidenceRefs: [] },
        } } },
    } };
    const h = await harness(f, (_call, index) => index === 0 ? completedTask : completedAdvance());
    expect(await h.driver.start(f.ctx, startInput(a))).toMatchObject({ status: 'ready' });
    await h.waitForCalls(3);
    await waitForDriverState(f, h.driver, GOAL_A, 'completed');
    expect(observed(h.calls)).toEqual([
      { goalRef: GOAL_A, kind: 'select_work', taskId: null },
      { goalRef: GOAL_A, kind: 'select_work', taskId: 'a-work' },
      { goalRef: GOAL_A, kind: 'select_work', taskId: null },
    ]);
    expect(h.calls.map(call => call.input)).toEqual([a, pinned, a]);
    // Capture counts AT each Workflow call, not just after all three finished.
    expect(h.calls.map(call => call.orderCallsAtEntry)).toEqual([1, 1, 2]);
    expect(h.orderCalls).toEqual([[a], [a]]);
  });

  it('R2D12 stops A while it waits for admission and B has an unreturned advance', async () => {
    const f = await fixture();
    const session = await idleSession(f);
    const pendingB = pendingAdvance();
    let driver: CollaborationDriver | undefined;
    let stop: ReturnType<CollaborationDriver['stop']> | undefined;
    let waitingA: ReturnType<CollaborationDriver['read']> | undefined;
    const h = await harness(f, call => {
      if (call.goalRef.goalId === 'B') {
        if (driver === undefined) throw new Error('driver not installed');
        // B has entered advanceWork; A has not been released by the pass yet.
        // Stop synchronously at that observable boundary, before another
        // microtask can admit A. B's promise never resolves during the proof.
        waitingA = driver.read(f.ctx, { goalRef: GOAL_A });
        stop = driver.stop(f.ctx, { goalRef: GOAL_A });
        return pendingB.promise;
      }
      return completedAdvance();
    });
    driver = h.driver;
    const a = select(GOAL_A, session);
    const b = select(GOAL_B, session);
    await startTogether(f, h.driver, a, b);
    await h.waitForCalls(1);
    expect(h.orderCalls).toEqual([[a, b]]);
    expect(h.orderResults).toEqual([{ status: 'ready', value: { advances: [b, a] } }]);
    if (waitingA === undefined || stop === undefined) throw new Error('B did not reach the stop boundary');
    expect(await waitingA).toMatchObject({ status: 'ready', value: { state: 'running', current: a } });
    expect(await stop).toMatchObject({ status: 'ready', value: { state: 'stopping' } });
    await waitForDriverState(f, h.driver, GOAL_A, 'stopped');
    expect(pendingB.settled()).toBe(false);
    expect(await h.driver.read(f.ctx, { goalRef: GOAL_B }))
      .toMatchObject({ status: 'ready', value: { state: 'running', current: b, last: null } });
    expect(observed(h.calls)).toEqual([{ goalRef: GOAL_B, kind: 'select_work', taskId: null }]);
    expect(h.calls.map(call => call.input)).toEqual([b]);
  });

  it('R2D13 admits later B without preempting the already called A advance', async () => {
    const f = await fixture();
    const session = await idleSession(f);
    const pendingA = pendingAdvance();
    const h = await harness(f, call => call.goalRef.goalId === 'A' ? pendingA.promise : completedAdvance());
    const a = select(GOAL_A, session);
    const b = select(GOAL_B, session);
    expect(await h.driver.start(f.ctx, startInput(a))).toMatchObject({ status: 'ready' });
    await h.waitForCalls(1);
    expect(h.calls.map(call => call.input)).toEqual([a]);
    const first = h.calls[0];
    if (first === undefined) throw new Error('A was not called');
    expect(first.signal.aborted).toBe(false);
    expect(pendingA.settled()).toBe(false);
    expect(await h.driver.start(f.ctx, startInput(b))).toMatchObject({ status: 'ready' });
    await h.waitForCalls(2);
    await waitForDriverState(f, h.driver, GOAL_B, 'completed');
    expect(observed(h.calls)).toEqual([
      { goalRef: GOAL_A, kind: 'select_work', taskId: null },
      { goalRef: GOAL_B, kind: 'select_work', taskId: null },
    ]);
    expect(h.calls.map(call => call.input)).toEqual([a, b]);
    expect(h.orderCalls).toEqual([[a], [b]]);
    expect(pendingA.settled()).toBe(false);
    expect(first.signal.aborted).toBe(false);
    expect(await h.driver.read(f.ctx, { goalRef: GOAL_A }))
      .toMatchObject({ status: 'ready', value: { state: 'running', current: a, last: null } });
  });
});
