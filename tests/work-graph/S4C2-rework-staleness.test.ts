/**
 * Slice 4C-2 session B rework (verifier §1, §2, "What Codex missed" M1):
 *
 * - item 1: a failed saved-answer-body read after step ① must leave the card
 *   answered-pending, never treated as "the user wrote no condition";
 * - item 2: `readSource` answers `source_stale` when the card is gone or when
 *   the REQUEST's pins no longer equal the fresh card's pins (a moved head, a
 *   moved pointer or a new pointer), and the adapter maps the owner's
 *   `revision_conflict` to the same `source_stale`;
 * - M1: the card's Goal must equal the request source's Goal.
 *
 * Everything is driven through the real `platform.workflow.resolveDecision`
 * against a real `createS4ANoteFixture` (memory and SQLite). The only double is
 * the allowed one-shot read fault: `createDecisionMessageService` is wrapped
 * while the platform is composed, so the production `readDecisionAnswer` can be
 * made to fail once; the spy is restored immediately after composition.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import {
  createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind,
} from '../helpers/S4A-note-fixture.js';
import * as decisionServiceModule from '../../src/core/work-graph/communication/decision-service.js';

const OPERATOR = { kind: 'human' as const, id: 's4a-operator' };

/** One-shot injected failure on the NEXT production `readDecisionAnswer`. */
let injectedReads = 0;
const armSavedBodyFault = (): void => { injectedReads = 1; };

type DecisionMessages = ReturnType<typeof decisionServiceModule.createDecisionMessageService>;

async function openFixture(kind: S4ANoteFixtureKind): Promise<S4ANoteFixture> {
  injectedReads = 0;
  const original = decisionServiceModule.createDecisionMessageService;
  const spy = vi.spyOn(decisionServiceModule, 'createDecisionMessageService').mockImplementation(deps => {
    const service = original(deps);
    const wrapped: DecisionMessages = {
      ...service,
      async readDecisionAnswer(ctx, input) {
        if (injectedReads > 0) {
          injectedReads -= 1;
          return { status: 'rejected', code: 'unavailable',
            reason: 'injected: the saved answer body could not be opened' };
        }
        return service.readDecisionAnswer(ctx, input);
      },
    };
    return wrapped;
  });
  try {
    return await createS4ANoteFixture(kind, { operatorActor: OPERATOR });
  } finally {
    spy.mockRestore();
  }
}

async function withFixture(kind: S4ANoteFixtureKind, body: (f: S4ANoteFixture) => Promise<void>): Promise<void> {
  const f = await openFixture(kind);
  try { await body(f); } finally { await f.close(); }
}

function general(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return {
    kind: 'preference', topic: 'default', conclusion: 'default', anchor: { kind: 'goal', goalId: 's4a-goal' },
    extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [],
    coexistWith: [], body: 'body', ...overrides,
  } as NoteDraftV1;
}

function understanding(conclusion: string, overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return {
    kind: 'understanding', topic: 'u', conclusion, anchor: { kind: 'goal', goalId: 's4a-goal' },
    extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [],
    coexistWith: [], sections: { status: 's', decided: 'd', open: 'o', next: 'n', risks: 'r' },
    ...overrides,
  } as NoteDraftV1;
}

function idOf(result: { status: string }): string {
  return (result as unknown as { noteId: string }).noteId;
}

/** ONE user-confirmed note and ONE pending agent note that replaces it. */
async function seedReplace(f: S4ANoteFixture): Promise<{ userId: string; agentId: string }> {
  const mine = await f.write(f.ctx(), general({ conclusion: 'user conclusion' }), f.goalRef.goalId);
  const userId = idOf(mine);
  const run = await f.claimRun('rework');
  const agent = await f.write(f.workCtx(run), general({ kind: 'decision', conclusion: 'agent conclusion',
    replaces: [userId] }), f.goalRef.goalId);
  expect(agent).toMatchObject({ status: 'pending_review', reasons: ['user_note_replaced'] });
  return { userId, agentId: idOf(agent) };
}

async function queueCards(f: S4ANoteFixture, goalRef: GoalRef = f.goalRef): Promise<DecisionCardV1[]> {
  const queue = await f.platform.decisions.queryDecisionQueue(f.ctx(), {
    workspace: f.scope, goalRef, sections: ['waiting_answer'], page: { limit: 100 } });
  if (queue.status !== 'ready') throw new Error(`queue read failed: ${JSON.stringify(queue)}`);
  return queue.value.waitingAnswer.filter(card => card.source.kind === 'note_review');
}

async function noteCardOf(f: S4ANoteFixture, noteId: string): Promise<DecisionCardV1> {
  const card = (await queueCards(f)).find(candidate =>
    (candidate.source.pins[0]?.ref as { noteId?: unknown }).noteId === noteId);
  if (card === undefined) throw new Error(`the queue has no note_review card for ${noteId}`);
  return card;
}

type Resolve = NonNullable<S4ANoteFixture['platform']['workflow']['resolveDecision']>;
function resolveOf(f: S4ANoteFixture): Resolve {
  const resolve = f.platform.workflow.resolveDecision;
  if (resolve === undefined) throw new Error('the composition publishes no resolveDecision');
  return resolve;
}

function resolveCard(f: S4ANoteFixture, card: DecisionCardV1, optionId: string, requestId: string, text = '') {
  return resolveOf(f)(f.ctx(), {
    input: { source: card.source, selection: { kind: 'option' as const, optionId }, text, annotations: [] },
    meta: { requestId, expected: card.source.pins },
  });
}

async function readNoteOf(f: S4ANoteFixture, noteId: string) {
  const read = await f.platform.notes.readNote(f.ctx(), { noteId });
  if (read.status !== 'ready') throw new Error(`note ${noteId} is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

describe.each<S4ANoteFixtureKind>(['memory', 'sqlite'])('S4C2 rework item 1 on %s', kind => {
  it('S4C2-rework-1 a failed saved-answer-body read leaves the card answered-pending, then the retry applies', async () => {
    await withFixture(kind, async f => {
      const { agentId } = await seedReplace(f);
      const card = await noteCardOf(f, agentId);
      expect(card.options.map(option => option.id)).toEqual(['supersede', 'coexist', 'reject']);

      armSavedBodyFault();
      const first = await resolveCard(f, card, 'coexist', 's4c2-rework-1-body-fault', '仅适用于旧接口');
      // RED before the fix: the adapter turned the failed read into '' and the
      // coexist committed, so this was `state: 'applied'` with the condition lost.
      expect(first).toMatchObject({ status: 'ready', value: {
        state: 'application_not_recorded',
        action: { status: 'rejected', code: 'unavailable' },
        application: null,
      } });
      // The note was NOT disposed: still the agent's original pending v1.
      expect(await readNoteOf(f, agentId)).toMatchObject({ version: 1, storedState: 'pending_review' });

      // The SAME request again with the fault off replays the saved answer and
      // applies it; the saved text is the coexist condition.
      const second = await resolveCard(f, card, 'coexist', 's4c2-rework-1-body-fault', '仅适用于旧接口');
      expect(second).toMatchObject({ status: 'ready', value: {
        state: 'applied',
        answer: { status: 'committed' },
        action: { status: 'done', noteId: agentId, version: 2, state: 'accepted' },
        application: { status: 'committed' },
      } });
      const history = await f.platform.notes.memoryHistory(f.ctx(), {
        v: 1, op: 'history', noteId: agentId, limit: 10, cursor: null });
      expect(history).toMatchObject({ status: 'ready' });
      if (history.status !== 'ready') return;
      const v2 = history.value.items.find(item => item.version === 2);
      expect(v2?.change).toMatchObject({ kind: 'accept', reason: '仅适用于旧接口' });
    });
  });
});

describe.each<S4ANoteFixtureKind>(['memory', 'sqlite'])('S4C2 rework item 2 on %s', kind => {
  it('S4C2-rework-2 a card whose pins predate a real pointer move is source_stale, nothing recorded', async () => {
    await withFixture(kind, async f => {
      const user = f.ctx();
      // Build a current pointer at revision 3 through three real acceptances.
      const base = await f.write(user, understanding('base'), f.goalRef.goalId);
      expect(base).toMatchObject({ status: 'accepted' });
      const baseId = idOf(base);
      const run = await f.claimRun('rework-pointer');
      const work = f.workCtx(run);
      const a1 = await f.write(work, understanding('a1', { structural: true, contradicts: [baseId] }),
        f.goalRef.goalId, { expectedPointerRevision: 1 });
      const a1Id = idOf(a1);
      expect(await resolveCard(f, await noteCardOf(f, a1Id), 'supersede', 's4c2-rework-2-a1'))
        .toMatchObject({ status: 'ready', value: { state: 'applied' } });
      const a2 = await f.write(work, understanding('a2', { structural: true, contradicts: [a1Id] }),
        f.goalRef.goalId, { expectedPointerRevision: 2 });
      const a2Id = idOf(a2);
      expect(await resolveCard(f, await noteCardOf(f, a2Id), 'supersede', 's4c2-rework-2-a2'))
        .toMatchObject({ status: 'ready', value: { state: 'applied' } });

      // Two pending structural understandings on a second topic, BOTH captured
      // while the shared CurrentPointer is at revision 3.
      const older = await f.write(work, understanding('older pending', { structural: true, topic: 'v' }),
        f.goalRef.goalId, { expectedPointerRevision: 3 });
      const olderId = idOf(older);
      const newer = await f.write(work, understanding('newer pending', { structural: true, topic: 'v' }),
        f.goalRef.goalId, { expectedPointerRevision: 3 });
      const newerId = idOf(newer);
      const staleCard = await noteCardOf(f, newerId);
      const stalePointer = staleCard.source.pins.find(pin =>
        (pin.ref as { aggregateType?: unknown }).aggregateType === 'CurrentPointer');
      expect(stalePointer?.revision).toBe(3);
      expect(staleCard.options.map(option => option.id)).toEqual(['accept', 'reject']);

      // The user accepts the OLDER pending understanding through its card; the
      // pointer moves to revision 4 and the newer card is now stale.
      expect(await resolveCard(f, await noteCardOf(f, olderId), 'accept', 's4c2-rework-2-older'))
        .toMatchObject({ status: 'ready', value: { state: 'applied' } });

      const rejected = await resolveCard(f, staleCard, 'accept', 's4c2-rework-2-stale-pointer');
      // RED before the fix: readSource replaced the request pins with the fresh
      // card's and the answer was committed, so this was `ready` (or `invalid`).
      expect(rejected).toMatchObject({ status: 'rejected', code: 'source_stale' });

      // Nothing was answered: the newer card is still waiting and re-reads with
      // the moved pointer pin; the note is still its original pending v1.
      const fresh = await noteCardOf(f, newerId);
      const freshPointer = fresh.source.pins.find(pin =>
        (pin.ref as { aggregateType?: unknown }).aggregateType === 'CurrentPointer');
      expect(freshPointer?.revision).toBe(4);
      expect(await readNoteOf(f, newerId)).toMatchObject({ version: 1, storedState: 'pending_review' });
    });
  });

  it('S4C2-rework-2 D-02 an owner pin move after the answer commit maps to source_stale', async () => {
    await withFixture(kind, async f => {
      const { agentId } = await seedReplace(f);
      const card = await noteCardOf(f, agentId);
      const requestId = 's4c2-rework-2-d02';
      const answered = await f.platform.decisionMessages.answerDecision(f.ctx(), {
        input: { source: card.source, selection: { kind: 'option', optionId: 'supersede' }, text: '', annotations: [] },
        meta: { requestId: `${requestId}:answer`, expected: card.source.pins },
      });
      expect(answered.status).toBe('committed');
      const moved = await f.platform.notes.withdrawNote(f.ctx(), {
        commandId: 's4c2-rework-2-d02-move', noteId: agentId, expectedVersion: 1, reason: 'the user withdrew it' });
      expect(moved).toMatchObject({ status: 'done', version: 2, state: 'withdrawn' });

      const result = await resolveOf(f)(f.ctx(), {
        input: { source: card.source, selection: { kind: 'option', optionId: 'supersede' }, text: '', annotations: [] },
        meta: { requestId, expected: card.source.pins } });
      // RED before the fix: `code: 'revision_conflict'` with reason 'source_stale'.
      expect(result).toMatchObject({ status: 'ready', value: {
        state: 'application_not_recorded',
        action: { status: 'rejected', code: 'source_stale' },
        application: null,
      } });
    });
  });
});

describe.each<S4ANoteFixtureKind>(['memory', 'sqlite'])('S4C2 rework M1 on %s', kind => {
  it('S4C2-rework-M1 a note card request naming another Goal is invalid, nothing answered', async () => {
    await withFixture(kind, async f => {
      const { agentId } = await seedReplace(f);
      const card = await noteCardOf(f, agentId);
      const ctx = f.ctx();
      // Build a second Goal (and its plan) in the SAME workspace through the
      // public services, copied from the S4A scope fixture.
      const goal2Ref: GoalRef = { aggregateType: 'Goal', projectId: f.scope.projectId, goalId: 's4a-goal-2' };
      const committed = async (label: string, result: { status: string }): Promise<Record<string, unknown>> => {
        if (result.status !== 'committed') throw new Error(`M1 ${label} failed: ${JSON.stringify(result)}`);
        return (result as unknown as { value: Record<string, unknown> }).value;
      };
      await committed('goal2', await f.platform.goals.createGoal(ctx, {
        meta: { requestId: 's4c2-rework-m1-goal2', expected: [
          { ref: f.projectRef, revision: 1 }, { ref: f.workspaceRef, revision: 1 }] },
        input: { goalId: goal2Ref.goalId, workspace: f.scope, objective: 'second goal' } }));
      const plan2Ref = { aggregateType: 'PlanRevision' as const, projectId: f.scope.projectId, planId: 's4a-plan-2' };
      const draft: PlanRevisionDraft = { schemaVersion: 1, planId: plan2Ref.planId, planRevision: 1,
        goalId: goal2Ref.goalId, stages: [{ stageId: 's2', title: 'Stage two' }],
        tasks: [{ taskId: 't9', stageId: 's2', title: 'Other work', requirementLevel: 'required',
          taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
          { taskId: 'g2', title: 'Gate two', requirementLevel: 'required', taskKind: 'gate',
            disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
        assignments: [{ taskId: 't9', role: 'platform-executor', instruction: 'Other work' }],
        obligations: [{ obligationId: 'o2', title: 'Deliver two', requirementLevel: 'required', taskIds: ['t9', 'g2'],
          verificationRequirements: [{ requirementId: 'v2', requirementLevel: 'required', kind: 'test',
            description: 'Tests pass' }] }],
        taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } };
      const proposed = await committed('plan2-propose', await f.platform.plans.proposePlan(ctx, {
        meta: { requestId: 's4c2-rework-m1-plan2-propose', expected: [{ ref: goal2Ref, revision: 1 }] },
        input: { goalRef: goal2Ref, basedOn: null, draft, reason: { text: 'second plan', sources: [] } } }));
      await committed('plan2-apply', await f.platform.plans.applyPlanChange(ctx, {
        meta: { requestId: 's4c2-rework-m1-plan2-apply', expected: [{ ref: goal2Ref, revision: 1 }] },
        input: { proposalRef: proposed['ref'] as never, expectedProposalRevision: proposed['revision'] as number,
          decisionRefs: [] } }));

      // n1's key with g2: before M1 the answer was stored under g2.
      const misrouted = { ...structuredClone(card.source), goalRef: goal2Ref };
      const result = await resolveOf(f)(ctx, {
        input: { source: misrouted, selection: { kind: 'option', optionId: 'coexist' }, text: '', annotations: [] },
        meta: { requestId: 's4c2-rework-m1-misrouted', expected: misrouted.pins } });
      // RED before the fix: readSource used the request's g2 and the answer committed.
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });

      // Nothing answered, the card is still waiting in g1, the note untouched.
      const answer = await f.platform.decisionMessages.readDecisionAnswer(ctx, { source: card.source });
      expect(answer).toMatchObject({ status: 'ready', value: { message: null } });
      expect(await queueCards(f)).toEqual(expect.arrayContaining([
        expect.objectContaining({ source: expect.objectContaining({ goalRef: f.goalRef }) })]));
      expect(await readNoteOf(f, agentId)).toMatchObject({ version: 1, storedState: 'pending_review' });
    });
  });
});
