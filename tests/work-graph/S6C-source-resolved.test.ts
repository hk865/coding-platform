/**
 * 6C S5 (book §2.4, `7d2-drill-rulings.md` binding): an answered initialization card reads as "source resolved"
 * once its governance pointer exists, and only for the two `missing_initial_*` Goal causes.
 *
 * The world is the real SE2 request world. The card is answered through `decisions/answer`, the pointer is
 * adopted through the public governance owner, and both reads are `decisions/card` / `decisions/queue`. The one
 * storage-boundary double is `commitBarrier.failReads` (rule sheet A2) at the pointer read of S5-3.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { seedS6AMemory, type S6AGovernance } from '../helpers/S6A-memory-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { waitFor } from '../scenarios/harness.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];

afterAll(async () => {
  const left = commitBarrier.reset();
  const open = worlds.splice(0);
  await Promise.allSettled(open.map(world => world.close()));
  expect(left).toEqual([]);
});

type CauseIdentity = { kind: 'goal_cause'; goalRef: typeof S6A_GOAL_1; code: string; affected: unknown[] };

const identityOf = (card: DecisionCardV1): CauseIdentity =>
  JSON.parse(card.source.key) as CauseIdentity;

/** One `decisions/card` read; the body is asserted as returned, not unpacked by a helper. */
async function cardRead(world: S6AHostWorld, card: DecisionCardV1): Promise<unknown> {
  return (await world.post('decisions/card', plain(S6A_SCOPE, { source: card.source }))).body;
}

async function queueOf(world: S6AHostWorld): Promise<DecisionQueueReadV1> {
  return ready<DecisionQueueReadV1>(await world.post('decisions/queue', plain(S6A_SCOPE, {
    workspace: S6A_SCOPE, goalRef: S6A_GOAL_1,
    sections: ['waiting_answer', 'answered_pending_application', 'history'], page: { limit: 100 },
  })), 'the decision queue');
}

/** The goal's one `missing_initial_*` card, from the queue. */
async function initialCauseCard(world: S6AHostWorld,
  code: 'missing_initial_architecture' | 'missing_initial_completion_policy'): Promise<DecisionCardV1> {
  const queue = await queueOf(world);
  const card = [...queue.waitingAnswer, ...queue.answeredPendingApplication, ...queue.history]
    .find(entry => entry.source.kind === 'goal_cause' && identityOf(entry).code === code);
  if (card === undefined) throw new Error(`no ${code} goal cause card in the queue`);
  return card;
}

/** Answer a cause card as the person (`{kind:'other'}` is legal for every source but the option-required kinds). */
async function answerCause(world: S6AHostWorld, card: DecisionCardV1, requestId: string) {
  return await world.post('decisions/answer', graphWrite(S6A_SCOPE, {
    source: card.source, selection: { kind: 'other' }, text: '', annotations: [],
  }, requestId, card.source.pins));
}

async function missingPointersWorld(): Promise<{ world: S6AHostWorld; governance: S6AGovernance }> {
  const world = await openS6AHostWorld({ backend: 'memory' });
  worlds.push(world);
  const governance = (await seedS6AMemory(world, { architecture: false, policy: false, notes: false })).governance;
  const current = await governance.read();
  expect(current).toEqual({ architecture: null, policy: null });
  return { world, governance };
}

/** The shared lifecycle: no pointer, the answered card, the pointer adopted, a failing read, then recovery. */
async function adoptedCardLifecycle() {
  const { world, governance } = await missingPointersWorld();
  const card = await initialCauseCard(world, 'missing_initial_architecture');
  const answered = await answerCause(world, card, 's6c-s5-1-answer');
  const beforePointer = await cardRead(world, card);
  await governance.adoptArchitecture({ settle: true });
  expect((await governance.read()).architecture).not.toBeNull();
  const first = await cardRead(world, card);
  const second = await cardRead(world, card);
  // The queue shows the same closed card in history, not in the waiting sections.
  const queue = await waitFor(async () => await queueOf(world),
    value => value.history.some(entry => entry.source.key === card.source.key), 'the resolved card in history');
  // Every active-pointer read the S5 helper makes fails at the store boundary (the card path reads it twice:
  // the live source first, then the answered-card resolution), so neither may fold the failure into resolved.
  const fault = commitBarrier.failReads(canonicalJson({
    aggregateType: 'ProjectArchitectureBaselineActive', projectId: S6A_SCOPE.projectId,
  } as never), 'throw-always');
  const failed = await cardRead(world, card);
  const faultCalls = fault.calls();
  fault.release();
  const recovered = await cardRead(world, card);
  return { world, card, answered, beforePointer, first, second, queue, failed, faultCalls, recovered };
}

describe('S6C S5: an answered initialization card after the pointer exists', () => {
  let shared: Awaited<ReturnType<typeof adoptedCardLifecycle>>;
  beforeAll(async () => { shared = await adoptedCardLifecycle(); }, 180_000);

  it('S5-1: answering the missing-architecture card and adopting the architecture makes the card closed/source_resolved/readOnly with no actions, twice the same and no write', async () => {
    const { answered, first, second, queue, card } = shared;
    expect(answered.body).toMatchObject({ status: 'ready', value: { application: null, state: 'answered' } });
    expect(first).toMatchObject({ status: 'ready', value: {
      state: 'closed', closedReason: 'source_resolved', readOnly: true, actions: [],
    } });
    expect(second).toEqual(first);
    expect(queue.waitingAnswer.some(entry => entry.source.key === card.source.key)).toBe(false);
    expect(queue.history.find(entry => entry.source.key === card.source.key))
      .toMatchObject({ state: 'closed', closedReason: 'source_resolved', readOnly: true, actions: [] });
  }, 120_000);

  it('S5-2: without the pointer the answered card stays answered_pending_application with the same actions', async () => {
    const { answered, beforePointer } = shared;
    expect(answered.body).toMatchObject({ status: 'ready', value: { application: null, state: 'answered' } });
    expect(beforePointer).toMatchObject({ status: 'ready', value: {
      state: 'answered_pending_application', closedReason: null, readOnly: false,
      actions: ['apply', 'record_application'],
    } });
  }, 120_000);

  it('S5-3: a failing pointer read is `unavailable`, never folded into source_resolved', async () => {
    const { failed, faultCalls, recovered } = shared;
    expect(faultCalls).toBeGreaterThan(0);
    expect(failed).toMatchObject({ status: 'rejected', code: 'unavailable' });
    // The failure was not a resolved card and wrote nothing: after the fault lifts the same closed projection reads.
    expect(recovered).toMatchObject({ status: 'ready', value: {
      state: 'closed', closedReason: 'source_resolved',
    } });
  }, 120_000);

  it('S5-4: another goal cause and a rework card keep their own states after the pointer exists', async () => {
    const { world, governance } = await missingPointersWorld();
    const policyCard = await initialCauseCard(world, 'missing_initial_completion_policy');
    const answeredPolicy = await answerCause(world, policyCard, 's6c-s5-4-policy-answer');
    expect(answeredPolicy.body).toMatchObject({ status: 'ready', value: { application: null } });
    await governance.adoptArchitecture({ settle: true });
    // The architecture pointer is not the completion-policy pointer: the policy card is unchanged.
    expect(await cardRead(world, policyCard)).toMatchObject({ status: 'ready', value: {
      state: 'answered_pending_application', closedReason: null,
    } });

    // A `change_pending` cause (one pending Plan candidate) is not one of the two initialization codes.
    const goal = ready<{ goal: { revision: number } }>(await world.post('goals/read', plain(S6A_SCOPE, S6A_GOAL_1)), 'goals/read');
    // The plan owner needs the completion policy for the acceptance kinds; the answered policy card is not
    // read again after this point.
    await governance.activatePolicy();
    const proposed = await world.platform.plans.proposePlan(world.humanContext(), {
      input: { goalRef: S6A_GOAL_1, basedOn: null, draft: {
        schemaVersion: 2, planId: 's6c-s5-4-plan', planRevision: 1,
        goalId: S6A_GOAL_1.goalId, stages: [],
        tasks: [
          { taskId: 's6c-s5-4-work', title: 'S5 change pending work', requirementLevel: 'required', taskKind: 'work',
            disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
          { taskId: 's6c-s5-4-gate', title: 'S5 gate', requirementLevel: 'required', taskKind: 'gate',
            disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
        ],
        assignments: [{ taskId: 's6c-s5-4-work', role: 'builder', instruction: 'Do the pending change' }],
        obligations: [{ obligationId: 's6c-s5-4-obligation', title: 'S5 acceptance', requirementLevel: 'required',
          taskIds: ['s6c-s5-4-work', 's6c-s5-4-gate'],
          verificationRequirements: [{ requirementId: 's6c-s5-4-check', requirementLevel: 'required', kind: 'static',
            description: 'S5 static check' }] }],
        taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
      }, reason: { text: 'S5 pending candidate', sources: [] } },
      meta: { requestId: 's6c-s5-4-propose', expected: [{ ref: S6A_GOAL_1, revision: goal.goal.revision }] },
    });
    if (proposed.status !== 'committed') throw new Error(`the pending proposal failed: ${JSON.stringify(proposed)}`);
    const queue = await waitFor(async () => await queueOf(world),
      value => value.waitingAnswer.some(entry => entry.source.kind === 'goal_cause'
        && identityOf(entry).code === 'initial_plan_pending'), 'the initial_plan_pending cause');
    const changePending = queue.waitingAnswer.find(entry => entry.source.kind === 'goal_cause'
      && identityOf(entry).code === 'initial_plan_pending')!;
    const answered = await answerCause(world, changePending, 's6c-s5-4-change-answer');
    expect(answered.body).toMatchObject({ status: 'ready', value: { application: null } });
    expect(await cardRead(world, changePending)).toMatchObject({ status: 'ready', value: {
      state: 'answered_pending_application', closedReason: null,
    } });
  }, 180_000);
});
