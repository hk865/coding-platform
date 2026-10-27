/** Rows 33 and 34 (deferred to the wave that publishes `platform.bindings` and `goals/confirm-draft`): each row runs its
 * whole business case on memory through the published owners, and its last statement is the fixture's exact named error. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { QueryJobAnswerRef } from '../../src/contracts/query-job.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_POLICY_CONTENT, s6aInitialCatalog } from '../helpers/S6A-memory-fixture.js';
import { activatePolicy } from '../helpers/S8B-catalog-steps.js';
import {
  callS6B3LateRoute, configureS6B3SecondWorkspace, holdS6B3NeedsDecisionAnswer, holdS6B3RequestAnswer,
  openS6B3World, readS6B3BindingPort, releaseS6B3DraftAnswer, runS6B3PlanningQuery, type S6B3World,
} from '../helpers/S6B3-fixture.js';

/** The A3 counting wrapper around the real memory backend: count the workspace's answered-request lookup and delegate every lookup to the real port unchanged. */
const counted = vi.hoisted(() => {
  /** The workspace's open-Query index and the answered request partition this row observes. */
  const ANSWERED_LOOKUP_INDEX = 's6-query-open-by-workspace';
  const state = { answeredLookups: 0 };
  type LookupRequest = { index: string; values: readonly (string | number | boolean | null)[] };
  type Store = { lookup(request: LookupRequest): Promise<unknown> };
  function wrap<B extends { records: Store }>(backend: B): B {
    const real = backend.records;
    return {
      ...backend,
      records: {
        ...real,
        lookup: (request: LookupRequest) => {
          if (request.index === ANSWERED_LOOKUP_INDEX
            && request.values[2] === 'request' && request.values[3] === 'answered') {
            state.answeredLookups += 1;
          }
          return real.lookup(request);
        },
      },
    } as B;
  }
  return { state, wrap };
});

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const barrier = await (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal);
  return {
    ...barrier,
    createInMemoryRecordBackend: (options: Parameters<typeof barrier.createInMemoryRecordBackend>[0]) =>
      counted.wrap(barrier.createInMemoryRecordBackend(options)),
  };
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

afterEach(() => { commitBarrier.reset(); });

type Scope = { projectId: string; workspaceId: string };

function valueOf<T>(body: unknown, status: 'ready' | 'committed', what: string): T {
  const answer = body as { status?: unknown; value?: unknown } | null | undefined;
  if (answer === null || answer === undefined || answer.status !== status) {
    throw new Error(`S6B3 rows 33 and 34: ${what} is not ${status}: ${JSON.stringify(body)}`);
  }
  return answer.value as T;
}

async function readWaitingPlanningCards(world: S6B3World, scope: Scope): Promise<DecisionCardV1[]> {
  const body = (await world.host.post('decisions/queue', plain(scope, {
    workspace: scope, sections: ['waiting_answer'], page: { limit: 100 },
  }))).body;
  const read = valueOf<DecisionQueueReadV1>(body, 'ready', 'the decision queue');
  expect(read.nextCursor).toBeNull();
  return read.waitingAnswer.filter(card => card.source.kind === 'planning_question');
}

function keyParts(key: string): { questionIndex: number; draftIndex: number } {
  const parsed = JSON.parse(key) as { questionIndex?: unknown; binding?: { draftIndex?: unknown } };
  if (typeof parsed.questionIndex !== 'number' || typeof parsed.binding?.draftIndex !== 'number') {
    throw new Error(`S6B3 rows 33 and 34: the card key ${key} names no question and no binding draft`);
  }
  return { questionIndex: parsed.questionIndex, draftIndex: parsed.binding.draftIndex };
}

function goalOf(card: DecisionCardV1): GoalRef {
  const subject = card.source.subject;
  if (subject.kind !== 'goal') {
    throw new Error(`S6B3 rows 33 and 34: the card ${card.source.key} has no Goal subject`);
  }
  return subject.goalRef;
}

function answerPinOf(card: DecisionCardV1): QueryJobAnswerRef {
  const pin = card.source.pins.find(entry =>
    (entry.ref as { aggregateType?: string }).aggregateType === 'QueryJobAnswer');
  if (pin === undefined) {
    throw new Error(`S6B3 rows 33 and 34: the card ${card.source.key} pins no answer`);
  }
  return pin.ref as QueryJobAnswerRef;
}

describe('row 33 (deferred: the question-card reader assembled with the binding port)', () => {
  it('two bindings of one needs_decision answer: two card groups, one answered, the other still waiting',
    async () => {
      const exercise = async () => {
        const world = await openS6B3World({ backend: 'memory' });
        try {
          const scope = world.mainScope;
          // Step 5: the two drafts' real needs_decision answer through the public request path.
          const held = await holdS6B3NeedsDecisionAnswer(world, { scope, drafts: 2 });
          const released = await releaseS6B3DraftAnswer(world, held);
          expect(released.drafts).toHaveLength(2);
          // The answer of two drafts names no plan draft: nothing on this path picks a plan index.
          const answerText = JSON.parse(released.answerText) as { kind?: unknown; questions?: unknown;
            planDraftIndex?: unknown };
          expect(answerText.kind).toBe('needs_decision');
          expect(Array.isArray(answerText.questions) ? answerText.questions.length : -1).toBe(2);
          expect(Object.hasOwn(answerText, 'planDraftIndex')).toBe(false);
          const savedAnswer = valueOf<{ answer: { planDraftIndex: number | null } }>(
            (await world.host.post('queries/answer', plain(scope, released.answerRef))).body, 'ready',
            'the saved needs_decision answer');
          expect(savedAnswer.answer.planDraftIndex).toBeNull();

          // The two Goals the two drafts are confirmed into, through the published confirmation owner.
          const goals: GoalRef[] = [];
          for (const index of [0, 1]) {
            const confirmed = await callS6B3LateRoute(world, 'goals/confirm-draft', '6b3-w3',
              plain(scope, { commandId: `s6b3-row-33-confirm-${String(index)}`, round: held.round, index }));
            goals.push(valueOf<{ goal: { ref: GoalRef } }>(confirmed, 'committed',
              `the draft confirmation ${String(index)}`).goal.ref);
          }
          const goalA = goals[0];
          const goalB = goals[1];
          if (goalA === undefined || goalB === undefined) {
            throw new Error('S6B3 row 33: the two confirmations named fewer than two Goals');
          }

          // One independent queue read: two question cards per bound Goal, each under its own subject.
          const waiting = await readWaitingPlanningCards(world, scope);
          const entries = waiting.map(card => ({ card, ...keyParts(card.source.key) }));
          expect(entries).toHaveLength(4);
          for (const goal of [goalA, goalB]) {
            const own = entries.filter(entry => goalOf(entry.card).goalId === goal.goalId);
            expect(own).toHaveLength(2);
            expect(new Set(own.map(entry => entry.questionIndex)).size).toBe(2);
          }
          // The same question of the two bindings is two different keys.
          for (const questionIndex of [0, 1]) {
            const keys = entries.filter(entry => entry.questionIndex === questionIndex)
              .map(entry => entry.card.source.key);
            expect(keys).toHaveLength(2);
            expect(new Set(keys).size).toBe(2);
          }
          // Each subject is the Goal its own binding names (the confirmations run draft 0 then draft 1).
          const goalByDraft = new Map<number, string>([[0, goalA.goalId], [1, goalB.goalId]]);
          for (const entry of entries) expect(goalOf(entry.card).goalId).toBe(goalByDraft.get(entry.draftIndex));

          // Answer one card through the one finite decision coordinator.
          const target = entries.find(entry => entry.draftIndex === 0 && entry.questionIndex === 0);
          if (target === undefined) throw new Error('S6B3 row 33: the queue lists no draft-0 first question');
          const answerBody = graphWrite(scope, {
            source: target.card.source, selection: { kind: 'other' },
            text: 'S6B3 row 33 answer', annotations: [],
          }, 's6b3-row-33-answer', [...target.card.source.pins]);
          const answered = valueOf<{ answer: { status: string; value: { ref: { messageId: string } } } }>(
            (await world.host.post('decisions/answer', answerBody)).body, 'ready', 'the decision answer');
          expect(answered.answer.status).toBe('committed');

          // The saved answer keeps the original key, subject and pins, the binding at revision 1 among them.
          const read = await world.host.platform.decisionMessages.readDecisionAnswer(world.host.humanContext(),
            { source: target.card.source });
          expect(read.status).toBe('ready');
          if (read.status !== 'ready') throw new Error('S6B3 row 33: the saved answer is not ready');
          const decisionSource = read.value.message?.decision?.source;
          expect(decisionSource).toEqual(target.card.source);
          const bindingPin = decisionSource?.pins.find(pin =>
            (pin.ref as { aggregateType?: string }).aggregateType === 'InitializationBinding');
          if (bindingPin === undefined) {
            throw new Error('S6B3 row 33: the saved source pins no initialization binding');
          }
          expect(bindingPin.revision).toBe(1);
          expect((bindingPin.ref as { draftIndex?: number }).draftIndex).toBe(0);
          expect(read.value.body?.text).toBe('S6B3 row 33 answer');

          // Replaying the same answer writes nothing new, and the other binding's same question is still waiting.
          const replayed = valueOf<{ answer: { status: string; value: { ref: { messageId: string } } } }>(
            (await world.host.post('decisions/answer', answerBody)).body, 'ready', 'the replayed decision answer');
          expect(replayed.answer.status).toBe('committed');
          expect(replayed.answer.value.ref.messageId).toBe(answered.answer.value.ref.messageId);

          const stillWaiting = (await readWaitingPlanningCards(world, scope))
            .map(card => ({ card, ...keyParts(card.source.key) }));
          expect(stillWaiting).toHaveLength(3);
          expect(stillWaiting.some(entry => entry.card.source.key === target.card.source.key)).toBe(false);
          expect(stillWaiting.some(entry => entry.draftIndex === 1 && entry.questionIndex === 0)).toBe(true);
        } finally {
          await world.close();
        }
      };
      await exercise();
    });
});
describe('row 34 (deferred: the answered-round enumeration over the workspace)', () => {
  it('one queue assembly enumerates the answered rounds once and gives each Goal its frozen manifest questions',
    async () => {
      const exercise = async () => {
        const world = await openS6B3World({ backend: 'memory' });
        try {
          const second = await configureS6B3SecondWorkspace(world, { name: 'row-34', goals: 2 });
          const scope = second.scope;
          const goalA = second.goals[0]?.ref;
          const goalB = second.goals[1]?.ref;
          if (goalA === undefined || goalB === undefined) {
            throw new Error('S6B3 row 34: the second workspace named fewer than two Goals');
          }
          const workspace = s6aCardsWorkspace(world.host, scope);
          // The two initialization question answers are frozen while the scope still prepares initial_coordination.
          const reply = (summary: string, asked: string[]) => ({ kind: 'text' as const, text: JSON.stringify({
            schemaVersion: 2, kind: 'needs_decision', summary, questions: asked }) });
          const freeze = async (label: string, goalId: string, summary: string, asked: string[]) => {
            const held = await holdS6B3RequestAnswer(world, { scope, label, goalId,
              executionKind: 'initial_coordination', reply: () => reply(summary, asked) });
            return valueOf<{ answer: { ref: QueryJobAnswerRef } }>(
              await held.release(), 'ready', `the round ${label}`).answer.ref;
          };
          const answerA = await freeze('row-34-goal-a', goalA.goalId, 'S6B3 row 34 Goal A',
            ['S6B3 row 34 A first question', 'S6B3 row 34 A second question']);
          const answerB = await freeze('row-34-goal-b', goalB.goalId, 'S6B3 row 34 Goal B',
            ['S6B3 row 34 B question']);
          const plainQuery = await runS6B3PlanningQuery(world, { scope, goalRef: goalA, label: 'row-34-plain' });
          // Governance makes later preparations semantic_query; it is installed only after the answers above are frozen.
          const registration = valueOf<{ project: { revision: number }; workspace: { revision: number } }>(
            await workspace.route('workspaces/registration', scope), 'ready', 'the registration');
          valueOf(await workspace.post('architecture/adopt-initial', graphWrite(scope, {
            baselineId: 'row-34-baseline', description: 'Row 34 governance', constraints: [],
            catalog: s6aInitialCatalog(scope.projectId),
          }, 'row-34-architecture', [
            { ref: { aggregateType: 'Project', projectId: scope.projectId }, revision: registration.project.revision },
            { ref: { aggregateType: 'Workspace', ...scope }, revision: registration.workspace.revision }])),
          'committed', 'the architecture adoption');
          await world.host.settleDetached();
          await activatePolicy(world.host.platform, workspace.humanContext(), S6A_POLICY_CONTENT, 'row-34-policy');
          // A real semantic request WITH a Goal: its saved body is the question JSON, yet the frozen kind keeps it out.
          const semantic = await holdS6B3RequestAnswer(world, { scope, label: 'row-34-semantic', goalId: goalA.goalId,
            executionKind: 'semantic_query',
            reply: () => ({ kind: 'text', text: JSON.stringify({ schemaVersion: 1,
              body: JSON.stringify({ schemaVersion: 2, kind: 'needs_decision', summary: 'S6B3 row 34 semantic',
                questions: ['S6B3 row 34 semantic question'] }), ideas: [], goalCardDrafts: [] }) }) });
          const semanticAnswer = valueOf<{ answer: { ref: QueryJobAnswerRef } }>(
            await semantic.release(), 'ready', 'the semantic round').answer.ref;
          counted.state.answeredLookups = 0;
          const waiting = await readWaitingPlanningCards(world, scope);
          expect(counted.state.answeredLookups).toBe(1);
          const entries = waiting.map(card => ({ card, answer: answerPinOf(card), goal: goalOf(card) }));
          expect(entries).toHaveLength(4);
          expect([...new Set(entries.map(entry => entry.goal.goalId))].sort())
            .toEqual([goalA.goalId, goalB.goalId].sort());
          const of = (answerRef: QueryJobAnswerRef) =>
            entries.filter(entry => entry.answer.queryJobId === answerRef.queryJobId);
          // Each Goal keeps exactly the questions of its own frozen manifest.
          expect(of(answerA)).toHaveLength(2);
          expect(of(answerB)).toHaveLength(1);
          expect(of(answerA).every(entry => entry.goal.goalId === goalA.goalId)).toBe(true);
          expect(of(answerB).every(entry => entry.goal.goalId === goalB.goalId)).toBe(true);
          // The semantic_query round produces no initialization card.
          expect(of(semanticAnswer)).toHaveLength(0);
          // The plain planning answer's question is one card, not a second copy from the answered partition.
          expect(of(plainQuery.answerRef)).toHaveLength(1);

          // The reader's binding source is the platform's published binding read port.
          readS6B3BindingPort(world);
        } finally {
          await world.close();
        }
      };
      await exercise();
    });
});
