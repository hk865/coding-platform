/**
 * RL-16 (`7d2-start-rulings.v4.md:8854`, read per `later-rows-merged.md:207–:210`; book §3.9 `:625–:661`, `:1319`;
 * write-tests brief `tests-7d2-o3b.txt:79–:90`): what is left of the row after the merge — (1) the person's open
 * executes directly; (3) the agent's split of two goals is one project `role_line_change` card that waits, and its
 * “不执行” answer (card supplement T3 `:346–:351`); (6) `create_member` is a card under every-step and a notice
 * after plan confirmation; (8) the policy's layers 1–3 as a pure table (layer 4 is O3a's, `S5-decision-policy`);
 * T5, the four adjustments' card options (card supplement §3.4 `:285–:297`). (2) runs on the queue world, (4) C1's RL-23, (5) and
 * the caller half of (7) are deleted (brief `:81`, lead Q17).
 *
 * World of (1), (3), (6): `openS7D2CapacityWorld` (tests/helpers/S7D2-capacity-world.ts), memory. Goals come from
 * `goals/create` (default `after_plan_confirmation`), every-step through `goals/settings/set`; L is the person's
 * `role-lines/open` of an adviser on `[G1, G2, region docs]` (`keep` after the move is `[docs]`); a split is a real
 * Work Run of L calling `propose_role_split`; `create_member` is the opening adviser's Work Run (`askS7D2Member`) for
 * an unlinked member Task of the world's Work role in the same adopted Plan. Project id: the world's (brief `:36`).
 * Notice items carry no operation (`project-notice-notices.ts` `objects: []`), so “no notice of this operation” is
 * read as “the project notices are the same list as before the step”.
 *
 * Expected (by hand from the frozen lines): the split tool answers `success` with `needs_decision`, `cardKey` and
 * `operation` (C7 `:60`), the card's identity `{kind:'role_line_change', operationRef}` (C7 `:61`), subject project
 * (two goals, C5 `:51`, §2.2 `:119`), options v4 `:3787–:3790` (§2.2 `:120`); waiting is record `accepted`, action
 * `waiting`, `result {waiting, null}` (C6 `:53`), still so after a Host idle pass (C8 `:63–:69`); “不执行” is `failed`
 * with `{failed, decision_rejected}` (C11 `:81`), the card `answered_no_application`/`source_resolved` (C12 `:86`), no
 * line, link or seat changed; the same move again answers the JSON block `{rejected, cancelled,
 * decision_rejected}` (C9 `:74`, §2.2 `:122`; the outer tool status is not read, lead ruling on reply 7.5).
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { AutonomyRuleV1, RoleLineAllocationReportV1, RoleScopeV1 } from '../../src/contracts/role-lines.js';
import { roleLineChangeOptionsOf } from '../../src/core/work-graph/communication/decision-source-facts.js';
import type {
  DecisionCardV1, DecisionQueueReadV1, NoticeItemV1, ResolveDecisionReadV1,
} from '../../src/core/work-graph/model/decision-contracts.js';
import type { RoleLineOperationV1, SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import type { RoleLineLineV1 } from '../../src/core/work-graph/sessions/role-line-operations.js';
import { decisionActionPolicy } from '../../src/core/work-graph/state/decision-policy.js';
import type { RoleLineOperationReadV1 } from '../../src/core/work-graph/views/role-line-operations-read.js';
import { adoptPLMixedPlan, PL_ADVISER_ROLE } from '../helpers/PL-consumption-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { openS7D2CapacityWorld, type S7D2CapacityWorld } from '../helpers/S7D2-capacity-world.js';
import { openS7D2QueueWorld, type S7D2QueueWorld } from '../helpers/S7D2-queue-world.js';
import { askS7D2Member, openTargetsOf } from '../helpers/S7D2-role-line-world.js';
import { waitFor } from '../scenarios/harness.js';

const worlds: S7D2CapacityWorld[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

const ALL = ['waiting_answer', 'answered_pending_application', 'history'] as const;

async function openWorld(): Promise<S7D2CapacityWorld> {
  const handle = await openS7D2CapacityWorld({ backend: 'memory' });
  worlds.push(handle);
  return handle;
}

/** The cards of `kind` in every card section of the queue. */
const cardsOf = (queue: DecisionQueueReadV1, kind: string): DecisionCardV1[] =>
  [...queue.waitingAnswer, ...queue.answeredPendingApplication, ...queue.history]
    .filter(card => card.source.kind === kind);
const projectNotices = (items: readonly NoticeItemV1[]): NoticeItemV1[] =>
  items.filter(item => item.category === 'project_notice');
const holderIds = (allocation: RoleLineAllocationReportV1): string[] =>
  allocation.duties.adviser.holders.map(holder => holder.session.sessionId).sort();
const openGoalIds = (card: SessionCard): string[] =>
  openTargetsOf(card).flatMap(target => target.kind === 'goal' ? [target.ref.goalId] : []).sort();

/** G1 (every-step) and G2 (default), and L's scope `[G1, G2, region docs]`. */
async function goalsAndScope(handle: S7D2CapacityWorld, label: string):
  Promise<{ g1: GoalRef; g2: GoalRef; scope: RoleScopeV1[] }> {
  const g1 = await handle.newGoal(`${label}-g1`);
  const g2 = await handle.newGoal(`${label}-g2`);
  await handle.autonomy(g1, 'every_step', `${label}-g1-every-step`);
  return { g1, g2, scope: [{ kind: 'goal', goalRef: g1 }, { kind: 'goal', goalRef: g2 },
    { kind: 'region', moduleRef: handle.modules.other }] };
}

describe('RL-16 (1): the person opens L', () => {
  /* Named mutation (card supplement C2 :31; v4 :8854 (1)): the person's `role-lines/open` is judged like the
     platform's automatic add -> every-step G1 makes a `role_line_change` card: the "no role_line_change card"
     assertion turns red; judged with its scope's goals but saved as `open`, it waits with no card and no line: the
     `completed` row assertion turns red. */
  it('RL-16 (1) (memory): the person\'s open of L on G1, G2 and a region executes directly: no card, no notice',
    async () => {
      const handle = await openWorld();
      const { scope } = await goalsAndScope(handle, 'rl16-1');
      const before = projectNotices(await handle.notices());
      const opened = await handle.open({ duty: 'adviser', scope, requestId: 'rl16-1-l' });
      expect(opened.result).toMatchObject({ status: 'committed' });
      expect(cardsOf(await handle.queue(ALL), 'role_line_change')).toEqual([]);
      await handle.idle();
      expect(projectNotices(await handle.notices())).toEqual(before);
      // The open really executes (v4 :8854 (1) “executes directly”; lead 11-04 after the mutation check): its
      // operation ends `completed`/`done` and the new line is an adviser holder.
      const value = valueOf<RoleLineLineV1>(opened.result, 'committed', 'the person’s open of L');
      const row = await waitFor(async () => (await handle.operations())
        .find(entry => entry.operation.operationId === value.operation.operationId),
      entry => entry?.phase === 'completed' || entry?.phase === 'failed', 'the person’s open of L to end');
      expect(row).toMatchObject({ phase: 'completed', actionPhase: 'done', result: { status: 'done' } });
      expect(holderIds(await handle.allocation())).toContain(value.session?.sessionId);
    }, 300_000);
});

describe('RL-16 (3): the split card and its “不执行” (T3)', () => {
  /* Named mutation (T3 :351): “不执行” still drives the split -> the row is not `failed` (`toMatchObject` after the
     answer) and L's open responsible links to G1 and G2 are moved (`openGoalIds(L)`), red. */
  it('RL-16 (3) (memory): the split of G1+G2 waits on one project card; “不执行” fails it; the same move is cancelled',
    async () => {
      const handle = await openWorld();
      const { g1, g2, scope } = await goalsAndScope(handle, 'rl16-3');
      const l = await handle.line('rl16-3-l', scope);
      const [t1, t2] = await handle.plan(g2, 'rl16-3',
        [{ taskId: 'rl16-3-t1', line: l }, { taskId: 'rl16-3-t2', line: l }]);
      const move: RoleScopeV1[] = [{ kind: 'goal', goalRef: g1 }, { kind: 'goal', goalRef: g2 }];
      const holdersBefore = holderIds(await handle.allocation());
      const noticesBefore = projectNotices(await handle.notices());
      const rowOf = async (operation: OperationRef): Promise<RoleLineOperationReadV1 | undefined> =>
        (await handle.operations()).find(row => row.operation.operationId === operation.operationId);

      await handle.split({ line: l, task: t1!, callId: 'rl16-3-split', move, label: 'rl16-3-split' });
      const tool = await handle.toolResult(l, 'rl16-3-split');
      expect(tool.status).toBe('success');
      expect(tool.json).toMatchObject({ status: 'needs_decision', cardKey: expect.any(String),
        operation: expect.any(Object) });
      const { cardKey, operation } = tool.json as { cardKey: string; operation: OperationRef };
      const cards = cardsOf(await handle.queue(ALL), 'role_line_change');
      expect(cards.map(card => [card.cardKey, card.state])).toEqual([[cardKey, 'waiting_answer']]);
      const card = cards[0]!;
      expect(JSON.parse(card.source.key)).toEqual({ kind: 'role_line_change', operationRef: operation });
      expect(card.subject).toEqual({ kind: 'project', projectRef: { projectId: S6A_SCOPE.projectId } });
      expect(card.options).toEqual([{ id: 'approve', label: '执行', effect: 'apply' },
        { id: 'reject', label: '不执行', effect: 'apply' }]);
      const waiting = { phase: 'accepted', actionPhase: 'waiting', result: { status: 'waiting', reason: null } };
      expect(await rowOf(operation)).toMatchObject(waiting);
      await handle.idle();
      expect(await rowOf(operation)).toMatchObject(waiting);

      valueOf<ResolveDecisionReadV1>(await handle.answer(card, { optionId: 'reject', text: '', annotations: [] },
        'rl16-3-reject'), 'ready', 'the “不执行” answer');
      await handle.idle();
      expect(await rowOf(operation)).toMatchObject({ phase: 'failed', actionPhase: 'failed',
        result: { status: 'failed', reason: 'decision_rejected' } });
      expect(openGoalIds(await handle.readCard(l))).toEqual([g1.goalId, g2.goalId].sort());
      expect(holderIds(await handle.allocation())).toEqual(holdersBefore);
      expect(await handle.card(card.source)).toMatchObject({ state: 'answered_no_application',
        closedReason: 'source_resolved' });
      expect(projectNotices(await handle.notices())).toEqual(noticesBefore);

      // The same move again from another Task's Run: the saved rejection, no second card, no new row.
      const rows = (await handle.operations()).length;
      await handle.split({ line: l, task: t2!, callId: 'rl16-3-again', move, label: 'rl16-3-again' });
      const again = await handle.toolResult(l, 'rl16-3-again');
      // lead ruling 11-04 18:0x on reply 7.5: only the tool output's JSON block (the frozen Kernel rewrites the
      // tool's outer `cancelled` status as `error`), not the outer status.
      expect(again.json).toEqual({ status: 'rejected', code: 'cancelled', reason: 'decision_rejected' });
      expect(cardsOf(await handle.queue(ALL), 'role_line_change').map(entry => entry.cardKey)).toEqual([cardKey]);
      expect(await handle.operations()).toHaveLength(rows);
    }, 300_000);
});

describe('RL-16 (6): create_member by the goal\'s autonomy', () => {
  /* Named mutation (book :638–:639; v4 :3738–:3740): `create_member` ignores the affected goal's autonomy (always a
     card) -> Ga's `toMatchObject({ status: 'created' })` and its one `member_created` notice turn red. */
  it('RL-16 (6) (memory): an every-step goal\'s member is one card; an after-plan goal\'s is created with one notice',
    async () => {
      const handle = await openWorld();
      const ge = await handle.newGoal('rl16-6-ge');
      await handle.autonomy(ge, 'every_step', 'rl16-6-ge-every-step');
      const ga = await handle.newGoal('rl16-6-ga');
      const caller = handle.lines.adviser;
      const ask = async (goal: GoalRef, label: string) => {
        const { tasks } = await adoptPLMixedPlan(handle.world, { goal, label, tasks: [
          { taskId: `${label}-caller`, role: PL_ADVISER_ROLE.templateId },
          { taskId: `${label}-member`, role: S6A_WORK_ROLE.templateId }] });
        return await askS7D2Member(handle.world, { caller, goal, callerTask: tasks[0]!, memberTask: tasks[1]!, label });
      };
      const everyStep = await ask(ge, 'rl16-6-ge');
      expect(everyStep).toMatchObject({ status: 'needs_decision', cardKey: expect.any(String) });
      const afterPlan = await ask(ga, 'rl16-6-ga');
      expect(afterPlan).toMatchObject({ status: 'created' });
      expect(cardsOf(await handle.queue(ALL), 'member_creation')
        .map(card => ({ cardKey: card.cardKey, subject: card.subject })))
        .toEqual([{ cardKey: (everyStep as { cardKey: string }).cardKey, subject: { kind: 'goal', goalRef: ge } }]);
      expect((await handle.notices()).filter(item => item.category === 'member_created').map(item => item.subject))
        .toEqual([{ kind: 'goal', goalRef: ga }]);
    }, 300_000);
});

// --------------------------------------------------------------------------------------------------------------- //
// The two pure tables (rule sheet A5): literal inputs, hand-written verdicts and options.                          //
// --------------------------------------------------------------------------------------------------------------- //

type PolicyInput = Parameters<typeof decisionActionPolicy>[0];
type AffectedGoal = NonNullable<PolicyInput['affectedGoals']>[number];
const AT = '2026-10-23T09:00:00.000Z';
const GOAL_A: GoalRef = { aggregateType: 'Goal', projectId: 'p1', goalId: 'ga' };
const GOAL_E: GoalRef = { aggregateType: 'Goal', projectId: 'p1', goalId: 'ge' };
const AFTER_PLAN: AffectedGoal = { goalRef: GOAL_A, autonomy: 'after_plan_confirmation', settingsRevision: 2 };
const EVERY_STEP: AffectedGoal = { goalRef: GOAL_E, autonomy: 'every_step', settingsRevision: 2 };
/** One active project rule (the `AutonomyRule@1` shape, `src/contracts/role-lines.ts`); the policy takes it as matched. */
const RULE: AutonomyRuleV1 = {
  ref: { aggregateType: 'AutonomyRule', projectId: 'p1', ruleId: 'rl16-rule' }, revision: 1, projectRef: { projectId: 'p1' },
  actions: ['role_line_add', 'role_line_split'], scope: [{ kind: 'project' }], limits: null, expiresAt: null,
  approvedBy: { kind: 'human', id: 'u1' }, approvedFrom: null, state: 'active',
};
/** Every row's input but `action`: an agent caller, one after-plan goal and the matching rule. */
const MATCHED: Omit<PolicyInput, 'action'> = {
  actorClass: 'agent', affectedGoals: [AFTER_PLAN],
  affectedScopes: [{ scope: { kind: 'goal', goalRef: GOAL_A }, catalogPin: null }],
  now: AT, ruleSetRevision: 1, matchedRule: RULE, counts: { holders: 2, reservations: 0, open: 8 },
  delegation: { revision: 1, tools: ['read', 'create_member', 'propose_role_split'], writeScope: [], createMember: true,
    policyRevision: 'rl16-policy@1' },
  roleCeiling: [{ kind: 'project' }], createMemberAuthorized: true,
};

describe('RL-16 (8): the policy\'s layers 1–3 (pure)', () => {
  /* Named mutation (v4 :3729–:3732): layer 2 after layer 3 (a new rule releases an action that already has a pending
     card) -> the `pendingCard` row (#10) returns `automatic_notice`, red. */
  it.each<[number, string, PolicyInput, ReturnType<typeof decisionActionPolicy>]>([
    [1, 'confirm_goal (layer 1)', { ...MATCHED, action: 'confirm_goal' }, 'user_only'],
    [2, 'adopt_first_plan (layer 1)', { ...MATCHED, action: 'adopt_first_plan' }, 'user_only'],
    [3, 'remember_user_preference (layer 1)', { ...MATCHED, action: 'remember_user_preference' }, 'user_only'],
    [4, 'structural_patch (layer 1)', { ...MATCHED, action: 'structural_patch' }, 'needs_decision'],
    [5, 'change_goal (layer 1)', { ...MATCHED, action: 'change_goal' }, 'needs_decision'],
    [6, 'exceed_budget (layer 1)', { ...MATCHED, action: 'exceed_budget' }, 'needs_decision'],
    [7, 'escalate (layer 1)', { ...MATCHED, action: 'escalate' }, 'needs_decision'],
    [8, 'long_handoff (layer 1)', { ...MATCHED, action: 'long_handoff' }, 'needs_decision'],
    [9, 'change_duty (layer 1)', { ...MATCHED, action: 'change_duty' }, 'needs_decision'],
    [10, 'role_line_add with a pending card (layer 2)', { ...MATCHED, action: 'role_line_add',
      pendingCard: { cardKey: 'rl16-pending-card' } }, 'needs_decision'],
    [11, 'role_line_split of an every-step goal, no pending card (layer 3)', { ...MATCHED, action: 'role_line_split',
      affectedGoals: [EVERY_STEP], affectedScopes: [{ scope: { kind: 'goal', goalRef: GOAL_E }, catalogPin: null }] },
    'automatic_notice'],
  ])('RL-16 (8) #%s %s', (_n, _layer, input, expected) => {
    expect(decisionActionPolicy(input)).toBe(expected);
  });
});

const LINE: SessionRef = { projectId: 'p1', sessionId: 'rl16-line' };
/** An accepted operation waiting on its card (C6 :53; the accepted record of `role-line-operations.ts` `openLine`). */
const waitingOperation = (operationId: string, action: RoleLineOperationV1['action']): RoleLineOperationV1 => ({
  ref: { aggregateType: 'CoreOperation', projectId: 'p1', operationId }, revision: 1, workspaceId: 'w1', phase: 'accepted',
  requestedAt: AT, updatedAt: AT, observation: null, failure: null, action,
});
/** The split and reuse card's two answers as frozen (v4 :3787–:3790; card supplement §3.4 :290). */
const PLAIN = [{ id: 'approve', label: '执行', effect: 'apply' }, { id: 'reject', label: '不执行', effect: 'apply' }];

describe('RL-16 T5: the role_line_change card options (pure)', () => {
  /* Named mutation (T5 :359): the add card's `reject` ignores `no_adviser_line` (both print “目标排队，等现有参谋”) ->
     the `no_adviser_line` row (#2) turns red. */
  it.each<[number, string, RoleLineOperationV1, unknown]>([
    [1, 'role_line_add', waitingOperation('rl16-t5-add', { kind: 'role_line', action: 'role_line_add', phase: 'waiting',
      goalRef: GOAL_E, result: { status: 'waiting', reason: null },
      steps: [{ key: 'line', duty: 'adviser', childOperation: null, state: 'pending' }] }),
    [{ id: 'approve', label: '执行：给这个目标新开一条参谋线', effect: 'apply' },
      { id: 'reject', label: '不执行：目标排队，等现有参谋', effect: 'apply' }]],
    [2, 'role_line_add no_adviser_line', waitingOperation('rl16-t5-add-no-line', { kind: 'role_line',
      action: 'role_line_add', phase: 'waiting', goalRef: GOAL_E, result: { status: 'waiting', reason: 'no_adviser_line' },
      steps: [{ key: 'line', duty: 'adviser', childOperation: null, state: 'pending' }] }),
    [{ id: 'approve', label: '执行：给这个目标新开一条参谋线', effect: 'apply' },
      { id: 'reject', label: '不执行：会停在这里，直到你开线或指定参谋', effect: 'apply' }]],
    [3, 'role_line_split', waitingOperation('rl16-t5-split', { kind: 'role_line', action: 'role_line_split',
      phase: 'waiting', goalRef: null, result: { status: 'waiting', reason: null },
      split: { source: LINE, move: [{ kind: 'goal', goalRef: GOAL_E }, { kind: 'goal', goalRef: GOAL_A }],
        keep: [{ kind: 'region', moduleRef: { projectId: 'p1', moduleId: 'docs' } }], reason: 'agent_proposal' },
      steps: [{ key: 'split', duty: 'adviser', childOperation: null, state: 'pending' }] }), PLAIN],
    [4, 'role_line_reuse', waitingOperation('rl16-t5-reuse', { kind: 'role_line', action: 'role_line_reuse',
      phase: 'waiting', goalRef: null, result: { status: 'waiting', reason: null },
      steps: [{ key: 'line', duty: 'adviser', childOperation: null, state: 'pending' }] }), PLAIN],
    [5, 'goal_queue_assign', waitingOperation('rl16-t5-assign', { kind: 'role_line', action: 'goal_queue_assign',
      phase: 'waiting', goalRef: GOAL_E, result: { status: 'waiting', reason: null }, steps: [] }),
    [{ id: 'approve', label: '执行：分给现在有空的参谋', effect: 'apply' },
      { id: 'reject', label: '不执行：留在队里，等你手动分配', effect: 'apply' }]],
  ])('RL-16 T5 #%s %s', (_n, _name, operation, expected) => {
    expect(roleLineChangeOptionsOf(operation)).toEqual(expected);
  });
});

// --------------------------------------------------------------------------------------------------------------- //
// RL-16 (2) (O4a; move ruling Q8; card supplement T1, T2 :333–:344, U1; write-tests brief tests-7d2-o4a.txt:100–). //
// --------------------------------------------------------------------------------------------------------------- //

/**
 * The platform's add for an every-step goal with no candidate and free seats waits on its card; “执行” opens a line
 * and assigns the goal to it, “不执行” queues the goal (U1). World: `openS7D2QueueWorld` (o4a Q17), memory, fixed
 * clock, one world for both `it`s (T2 runs between T1 (c) and (d), CARD-R1-05): A (the opening adviser) and B hold
 * three in-progress `small` goals each (no candidate), `open.adviser = 4` (two free seats, T1 `:335`), drafts G1 and
 * G3 every-step and `small`. Expected (by hand): the add card's options and literals card supplement §2.1 `:103–:107`
 * (`reason` null: the project has adviser lines), the waiting operation C6 `:53`, “不执行” C11 `:81` and the queue
 * (§2.1 `:110`), the card closing C12 `:86`, the two notices of G1 C13 `:89` and v4 `:4971`. `role-lines/operations`
 * rows carry `action: 'role_line'`; the stored action name is read from `sessions/operation`.
 */
// The two `it`s below run in order on ONE shared world (opened by the first, closed by `afterAll`, lead 04:1x item 3):
// the second continues from the first's state and its G1 card, so it fails whenever the first did not get that far.
describe('RL-16 (2): the add card\'s “执行” and “不执行” (T1, T2) on the queue world', () => {
  let q: S7D2QueueWorld | null = null;
  let g1Card: DecisionCardV1 | null = null;
  afterAll(async () => { await q?.close(); });
  const world = (): S7D2QueueWorld => { if (q === null) throw new Error('RL-16 (2): no world'); return q; };
  const addOptions = (reject: string) => [{ id: 'approve', label: '执行：给这个目标新开一条参谋线', effect: 'apply' },
    { id: 'reject', label: reject, effect: 'apply' }];
  const operationOf = (card: DecisionCardV1): OperationRef =>
    (JSON.parse(card.source.key) as { operationRef: OperationRef }).operationRef;
  const rowOf = async (card: DecisionCardV1): Promise<RoleLineOperationReadV1 | undefined> =>
    (await world().operations()).find(row => row.operation.operationId === operationOf(card).operationId);
  const addCardsOf = async (goal: GoalRef): Promise<DecisionCardV1[]> =>
    cardsOf(await world().decisions(), 'role_line_change')
      .filter(card => card.subject.kind === 'goal' && card.subject.goalRef.goalId === goal.goalId);
  const lineNoticesOf = async (goal: GoalRef): Promise<string[]> => projectNotices(await world().notices())
    .filter(item => item.subject.kind === 'goal' && item.subject.goalRef.goalId === goal.goalId
      && (item.summary.startsWith('开线：') || item.summary.startsWith('队列分配：'))).map(item => item.summary);

  /*
   * Named mutation (T1 `:338`): the platform's add opens the line without the judgement -> step 2 finds no card and
   * step 3's holders are already three (D exists), red.
   */
  it('RL-16 (2) T1 (a)–(c) (memory): G1 confirmed; its add waits on one goal card; no line, not queued', async () => {
    q = await openS7D2QueueWorld({ backend: 'memory', advisers: true, drafts: [
      { name: 'g1', autonomy: 'every_step' }, { name: 'g3', autonomy: 'every_step' }] });
    const { a, b } = q.advisers!;
    await q.setOpen('adviser', 4, 'rl16-2-cap-4');

    // 1. T1 (a)
    expect(await q.confirm('g1')).toMatchObject({ status: 'committed' });
    const g1 = q.goalOf('g1');
    // 2. T1 (b)
    const cards = cardsOf(await q.decisions(), 'role_line_change');
    expect(cards).toHaveLength(1);
    g1Card = cards[0]!;
    expect(g1Card.subject).toEqual({ kind: 'goal', goalRef: g1 });
    expect(g1Card.options).toEqual(addOptions('不执行：目标排队，等现有参谋'));
    // 3. T1 (c)
    expect(await rowOf(g1Card)).toMatchObject({ phase: 'accepted', actionPhase: 'waiting',
      result: { status: 'waiting', reason: null } });
    expect(await q.operation(operationOf(g1Card))).toMatchObject({ action: { action: 'role_line_add' } });
    expect(holderIds(await q.allocation())).toEqual([a.ref.sessionId, b.ref.sessionId].sort());
    expect(await q.queueIds()).toEqual([]);
  });

  /*
   * Named mutation (T2 `:344`): after “不执行” the goal is not queued -> step 6's `entries` is `[]`, red.
   */
  it('RL-16 (2) T2 (a)–(e) then T1 (d)–(f) (memory): “不执行” queues G3; “执行” opens D for G1, once', async () => {
    const live = world();
    const { a, b } = live.advisers!;
    const card1 = g1Card;
    if (card1 === null) throw new Error('RL-16 (2): T1 (b) found no G1 card');
    const g1 = live.goalOf('g1');

    // 4. T2 (a)–(b)
    expect(await live.confirm('g3')).toMatchObject({ status: 'committed' });
    const g3 = live.goalOf('g3');
    const g3Cards = await addCardsOf(g3);
    expect(g3Cards).toHaveLength(1);
    const card3 = g3Cards[0]!;
    expect(card3.options.find(option => option.id === 'reject')?.label).toBe('不执行：目标排队，等现有参谋');
    // 5. T2 (c)
    expect(await live.answer(card3, 'reject', 'rl16-t2-reject')).toMatchObject({ status: 'ready',
      value: { state: 'answered' } });
    // 6. T2 (d)
    expect(await rowOf(card3)).toMatchObject({ phase: 'failed',
      result: { status: 'failed', reason: 'decision_rejected' } });
    expect(holderIds(await live.allocation())).toEqual([a.ref.sessionId, b.ref.sessionId].sort());
    expect(await live.queueIds()).toEqual([g3.goalId]);
    const read = await live.decisions(ALL);
    expect(read.history.filter(card => card.cardKey === card3.cardKey)).toMatchObject([
      { state: 'answered_no_application', closedReason: 'source_resolved' }]);
    expect([...read.waitingAnswer, ...read.answeredPendingApplication].map(card => card.cardKey))
      .not.toContain(card3.cardKey);
    expect((await lineNoticesOf(g3)).filter(summary => summary.startsWith('开线：'))).toEqual([]);
    // 7. T2 (e): the same requestId and body again
    expect(await live.answer(card3, 'reject', 'rl16-t2-reject')).toMatchObject({ status: 'ready',
      value: { state: 'answered' } });
    expect(await live.queueIds()).toEqual([g3.goalId]);

    // 8. T1 (d)
    expect(await live.answer(card1, 'approve', 'rl16-t1-approve')).toMatchObject({ status: 'ready',
      value: { state: 'answered' } });
    // 9. T1 (e): a third adviser line D holds G1; the operation completed; the card closed; G1's two notices
    const holders = await waitFor(async () => holderIds(await live.allocation()), ids => ids.length === 3,
      'a third adviser line');
    const d = holders.find(id => id !== a.ref.sessionId && id !== b.ref.sessionId);
    expect(await waitFor(() => live.linesOf(g1), lines => lines.length > 0, 'G1 to be assigned')).toEqual([d]);
    expect(await rowOf(card1)).toMatchObject({ phase: 'completed', result: { status: 'done', reason: null } });
    expect(await live.card(card1.source)).toMatchObject({ state: 'answered_no_application',
      closedReason: 'source_resolved' });
    const notices = await waitFor(() => lineNoticesOf(g1), summaries => summaries.length > 1, 'G1\'s two notices');
    expect(notices.filter(summary => summary.startsWith('开线：'))).toHaveLength(1);
    expect(notices.filter(summary => summary.startsWith('队列分配：')))
      .toEqual([`队列分配：${g1.goalId} → 顾问 ${String(d)}（规则：队列顺序；可重排或调高上限）`]);
    // 10. T1 (f): the same requestId again changes no line, link or notice
    await live.answer(card1, 'approve', 'rl16-t1-approve');
    expect(holderIds(await live.allocation())).toEqual(holders);
    expect(await live.linesOf(g1)).toEqual([d]);
    expect(await lineNoticesOf(g1)).toEqual(notices);
  });
});
