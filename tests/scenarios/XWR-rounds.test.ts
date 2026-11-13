/**
 * XWR acceptance rows R1, R2, R4 (lead rulings 11-13 "XWR 主包"; start rulings §3): B's Workflow sends a round to a
 * main-workspace line. XWS2A memory world (`waitCoarseAnswered`, as XWR0-consume); the message lives in the main
 * workspace A (its line's), its Query and candidate in B (the Goal's, X-1). The real message ref comes from the line's
 * public `messages/inbox`; the B refs are hand-made per X-1: today's ids of that ref, the workspace B.
 * Red today: R1 at (a) and R2 at its refine (B's `queries/read` not_found: the Host reads B's Goal with A's ctx and
 * writes nothing); R4 at (a) (no Query ran, so no notice).
 * Named mutations: R1 ① `planOnIdleLine` without the Goal's workspace → (a) (the submit is refused,
 * `query-job-service.ts:670-673`); ② the `initial-plan-answer.ts:93` workspace comparison back → (b); ③ `workflow.ts:2666`
 * reads the source body with the Goal's ctx → (c) (the advance is rejected); ④ the `mailbox-commands.ts:214` comparison
 * back → (d). R2 ① `plan-lineage.ts` reads the parent candidate in the message's workspace → (b) (the planfix Query's
 * lineage fails); ② `planFixRead` judges "sent" by the composed ref → (d) (the same planfix is selected again);
 * ③ the plan review finds its line only in the Goal's workspace → (a) (`no_review_line`). R4 ① `planOnIdleLine` reads
 * the ended Query at the message's workspace (`intervention.ts:416-419`) → (a) (no `no_answer` ending).
 * The draft's R4 mutation (`mailbox-identity.ts:604`) is not on this path: the Host withdraws as its own actor
 * (`host.ts:2692`), which needs no system-actor exception (`mailbox-commands.ts:481-488`).
 * Shown on today's tree with the one-workspace twin (same steps, B = A): R1 ③ → (c), ④ → (d), R2 ② → (d) red.
 * R5, R6 (lead ruling "Astra 审 XWR", Rule W: an executor line never runs another workspace's Task): a person's
 * `messages/send` from A to A's executor line names B — R5 B's Goal without `taskRef` after the line ran one A Work
 * (the line's newest Work gives way to the named Goal), R6 a ready B Task. The line answers through B's Query and
 * keeps no B claim (B's `sessions/executions` of the line; a claim lives with its Task's Goal). Mutation: the
 * `intervention.ts:174` `planningOnly` back to `planning` → R5 the post-adoption claim, R6 the existing-Task claim.
 * X1 (XWR-ON): the joined workspace's Goal is the main adviser's responsibility; its second same-module Work opens the
 * module gate, whose note request must reach that adviser in A while the planning Query and the module note stay in B.
 * Red today at (a): the gate's recipient read runs in the Goal's workspace (`create-platform.ts:3637-3639`), where no
 * role line lives, so the gate saves `noteRequest: 'none'` and no round starts. After the package the recipient is
 * L35's Goal adviser (`lateRecipients.resolveResponsibilityRecipient`), the Host offers the system action_request to
 * the idle main line, the null-answer-shape Query reads the source message across the two workspaces, and
 * `record_note` writes the `second-mod` convention. Mutations ①-④ are listed at X1's own comment.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { SessionRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import type { WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import type { ModuleOverlapGateV1 } from '../../src/core/work-graph/persistence/module-overlap-gate-codecs.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import { sessionMessageRefKey } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { planProposalIdFor } from '../../src/core/work-graph/tasks/plan-service.js';
import * as mailboxModule from '../../src/core/work-graph/communication/mailbox-service.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { heartbeatUntil, lineFacts, notices, readPlanningQuery } from '../helpers/IV-host-fixture.js';
import { adoptPLMixedPlan } from '../helpers/PL-consumption-fixture.js';
import { S6A_SCRIBE_ROLE, S6A_SCOPE, S6A_WORK_ROLE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { withS6AWorkProfile } from '../helpers/S7B2-consumable-sessions.js';
import { refinementPlanFrom } from '../helpers/S7B-V-fixture.js';
import { withConfiguredHost } from '../helpers/S7C-member-fixture.js';
import { linkS7D2Scopes, runS7D2Work } from '../helpers/S7D2-role-line-world.js';
import { openS9ReviewLine, s9ReviewerBinding } from '../helpers/S9-review-fixture.js';
import {
  adoptSecondPlan, driveSecondWorkflow, openXWS2AOtherProject, openXWS2AWorld, refineRound, sendRoundOf,
  XWS2A_MODULE_ID, xws2aModuleInProject, type XWS2AWorld,
} from '../helpers/XWS2A-world.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.allSettled(closers.splice(0).map(close => close())); });
/** `work`: the Host also consumes A's Work lines (the Work role's Query profile, R5/R6). */
async function joined(reviewer = false, work = false, scribe = false): Promise<XWS2AWorld> {
  const openJoined = () => openXWS2AWorld({ backend: 'memory', extraHostOptions: { scribeReminderPeriodMs: 25 },
    ...(reviewer ? { extraBindings: [s9ReviewerBinding()] } : {}), ...(scribe ? { scribe: true } : {}) });
  const world = work ? await withConfiguredHost(openJoined, withS6AWorkProfile) : await openJoined();
  closers.push(() => world.close());
  await world.waitCoarseAnswered();
  return world;
}

const NO_ANSWER_NOTICE = '这次规划已结束，没有留下可用的回答，这条消息已撤回。请补充要求后重新发送。';
/** The adviser's `submit_plan_round`: the goal-level placeholder `task` becomes executable work (PL-18's answer). */
const submitPlanRound = (task: string, tag: string) => ({ kind: 'calls' as const, calls: [{ callId: tag,
  name: 'submit_plan_round', args: { answerKind: 'plan', summary: tag, reason: { text: tag, affectedTaskIds: [task] },
    plan: { stages: [], tasks: [{ taskId: task, title: task, requirementLevel: 'required', taskKind: 'work',
      disposition: 'active', scope: { kind: 'goal' }, executionIntent: 'request_execution', sizeClass: 'small',
      estimatedLines: 10 }], assignments: [{ taskId: task, role: S6A_WORK_ROLE.templateId, instruction: tag }],
    obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [],
    inputRequirements: [] } } }] });
const goalSelectWork = (goal: GoalRef, flowId: string) =>
  ({ schemaVersion: 1, goalRef: goal, flowId, sessionHint: null, kind: 'select_work' });

/** X-1: the Query and the candidate of `message` in the Goal's workspace: today's ids, that workspace. */
const queryIn = (message: SessionMessageRef, scope: WorkspaceScope) =>
  ({ ...interventionPlanningQueryRefs(message).queryJobRef, workspaceId: scope.workspaceId });
const proposalIn = (message: SessionMessageRef, goal: GoalRef, scope: WorkspaceScope) => ({
  aggregateType: 'PlanProposal' as const, projectId: scope.projectId, workspaceId: scope.workspaceId,
  proposalId: planProposalIdFor({ projectId: scope.projectId, workspaceId: scope.workspaceId, goalId: goal.goalId,
    requestId: `intervention:${sessionMessageRefKey(message)}:propose` }) });

/** The Host system rounds on `line` whose first body line starts with `head` (the line's public inbox). */
async function roundsOn(world: XWS2AWorld, line: { ref: SessionRef }, head: string): Promise<SessionMessage[]> {
  const found: SessionMessage[] = [];
  for (const message of await world.inbox(line)) {
    if (message.sender.kind === 'host' && message.sender.actor.kind === 'system'
      && (await world.messageText(message)).startsWith(head)) found.push(message);
  }
  return found;
}
/** Host passes until the round is replied or withdrawn (at most `passes`; the one-workspace round takes 8–11). */
const settled = async (world: XWS2AWorld, line: { ref: SessionRef }, ref: SessionMessageRef, passes = 24) =>
  await heartbeatUntil(world.base.world, async () => (await world.inbox(line)).find(message =>
    message.ref.messageId === ref.messageId)!, message => message.response !== null || message.withdrawnAt !== null, passes);
/** B's claims on `line` (B's `sessions/executions`): a claim is kept in its Task's Goal's workspace. */
const bClaimsOn = async (world: XWS2AWorld, line: S6ASession) => valueOf<{ items: TaskClaim[] }>(
  await world.second.workspace.route('sessions/executions', { sessionRef: line.ref, page: { limit: 20 } }),
  'ready', 'B\'s claims on the line').items;
/** A Work line of A that ran one A Work through A's own Workflow: its newest Work is A's. */
async function aWorkLine(world: XWS2AWorld, label: string): Promise<S6ASession> {
  const host = world.base.world;
  const goal = world.base.goal;
  const { tasks: [task] } = await adoptPLMixedPlan(host, { goal, label,
    tasks: [{ taskId: `${label}-a`, role: S6A_WORK_ROLE.templateId }] });
  const line = await world.base.createWorkLine(`${label}-exec`);
  await linkS7D2Scopes(host, { line, targets: [{ kind: 'task', ref: task! }], label: `${label}-task` });
  await runS7D2Work(host, { line, goal, task: task!, label, replies: [{ kind: 'text', text: `${label}: A done` }] });
  return line;
}

it('R1 refine across workspaces: the Query and candidate are B\'s, the main adviser\'s one round is replied', async () => {
  const world = await joined();
  const b = world.second.workspace;
  const goal = world.second.goal;
  await world.base.world.scripted.script(world.adviser, [submitPlanRound('xwr-r1', 'xwr-r1-plan')]);
  expect((await refineRound(b, goal, 'xwr-r1'))?.sessionId).toBe(world.adviser.ref.sessionId);
  const round = (await roundsOn(world, world.adviser, 'refine:'))[0]!.ref;
  const closed = await settled(world, world.adviser, round);
  expect(await b.route('queries/read', queryIn(round, b.scope))).toMatchObject({ status: 'ready',
    value: { job: { job: { status: 'answered' } } } });
  expect(await world.base.main.route('queries/read', interventionPlanningQueryRefs(round).queryJobRef))
    .toMatchObject({ status: 'not_found' });
  expect(await b.route('plans/proposal', proposalIn(round, goal, b.scope))).toMatchObject({ status: 'ready',
    value: { status: 'candidate', sourceMessageRef: round } });
  // No reviewer line in the project: the candidate's wait (workflow.ts attachRefinement joins it after the refine's).
  expect(await b.route('workflow/advance', goalSelectWork(goal, 'xwr-r1-after'))).toMatchObject({ status: 'ready',
    value: { state: 'waiting', reason: expect.stringContaining('plan_candidate_waiting: no_review_line') } });
  expect((await roundsOn(world, world.adviser, 'refine:')).map(message => message.ref)).toEqual([round]);
  expect(closed.response).not.toBeNull();
}, 240_000);

it('R2 planreview and planfix across workspaces: A\'s reviewer and adviser answer, B holds the repaired candidate', async () => {
  const world = await joined(true);
  const host = world.base.world;
  const b = world.second.workspace;
  const goal = world.second.goal;
  const reviewer = await openS9ReviewLine(host);
  await host.scripted.script(world.adviser, [submitPlanRound('xwr-r2', 'xwr-r2-p1'), submitPlanRound('xwr-r2', 'xwr-r2-p2')]);
  await host.scripted.script(reviewer, [{ kind: 'calls', calls: [{ callId: 'xwr-r2-review', name: 'submit_plan_review',
    args: { verdict: 'fix', findings: [{ taskId: 'xwr-r2', text: 'XWR R2: name the check' }] } }] }]);
  await refineRound(b, goal, 'xwr-r2');
  const refine = (await roundsOn(world, world.adviser, 'refine:'))[0]!.ref;
  expect((await settled(world, world.adviser, refine)).response, 'R2: the refine is replied (R1)').not.toBeNull();
  const p1 = valueOf<PlanProposal>(await b.route('plans/proposal', proposalIn(refine, goal, b.scope)), 'ready', 'P1');
  // (a) the plan review goes to the project's one reviewer line, in A.
  expect(await sendRoundOf(b, goal, 'xwr-r2-review')).toMatchObject({ round: { kind: 'planreview' },
    recipient: reviewer.ref });
  const review = (await roundsOn(world, reviewer, `planreview:${p1.ref.proposalId}:1`))[0]!.ref;
  expect((await settled(world, reviewer, review)).response).not.toBeNull();
  // (b) the fix goes to A's adviser; its Query is B's.
  expect(await sendRoundOf(b, goal, 'xwr-r2-fix')).toMatchObject({ round: { kind: 'planfix' },
    recipient: world.adviser.ref });
  // (d) right after the send the Goal waits for that fix; it does not select the same planfix again.
  expect(await b.route('workflow/advance', goalSelectWork(goal, 'xwr-r2-wait'))).toMatchObject({ status: 'ready',
    value: { state: 'waiting', reason: expect.stringContaining('plan_fix_sent'), next: null } });
  const fix = (await roundsOn(world, world.adviser, `planfix:${p1.ref.proposalId}:1`))[0]!.ref;
  expect((await settled(world, world.adviser, fix)).response).not.toBeNull();
  expect(await b.route('queries/read', queryIn(fix, b.scope))).toMatchObject({ status: 'ready',
    value: { job: { job: { status: 'answered' } } } });
  expect(await world.base.main.route('queries/read', interventionPlanningQueryRefs(fix).queryJobRef))
    .toMatchObject({ status: 'not_found' });
  // (c) the repaired candidate P2 is B's, on P1's base; the request's one waiting card now stands for it.
  const p2 = proposalIn(fix, goal, b.scope);
  expect(await b.route('plans/proposal', p2)).toMatchObject({ status: 'ready',
    value: { status: 'candidate', basedOn: p1.basedOn, sourceMessageRef: fix } });
  expect((await b.readCards(goal)).filter(card => card.source.kind === 'candidate' && card.state === 'waiting_answer'))
    .toHaveLength(1);
  // (d) the Goal moves on: P2 replaces P1, so P2's own review is the next round.
  expect(await sendRoundOf(b, goal, 'xwr-r2-next')).toMatchObject({ round: { kind: 'planreview',
    proposalId: p2.proposalId }, recipient: reviewer.ref });
}, 300_000);

it('R4 a round of B that ends without an answer is noticed and withdrawn in A; the adviser line goes on', async () => {
  const world = await joined();
  const host = world.base.world;
  await host.scripted.script(world.adviser, [{ kind: 'fail', message: 'XWR R4: the provider fails' }]);
  await refineRound(world.second.workspace, world.second.goal, 'xwr-r4');
  const round = (await roundsOn(world, world.adviser, 'refine:'))[0]!.ref;
  const closed = await settled(world, world.adviser, round);
  expect(await notices(host, world.adviser, NO_ANSWER_NOTICE)).toHaveLength(1);
  expect(closed).toMatchObject({ response: null, withdrawnAt: expect.any(String) });
  const person = await sendS7A2PersonMessage(host, { label: 'xwr-r4-person', recipient: world.adviser.ref,
    goal: host.goals.first });
  expect(await heartbeatUntil(host, () => readPlanningQuery(host, person.ref), query => query !== null, 6))
    .not.toBeNull();
}, 240_000);

it('R5 a person names B\'s Goal to A\'s executor line after an A Work: B plans, the line is replied, no B claim', async () => {
  const world = await joined(false, true);
  const host = world.base.world;
  const b = world.second.workspace;
  const goal = world.second.goal;
  // B has a Plan, so the line's answer is a refinement its default autonomy adopts at once (`refine_future`).
  await adoptSecondPlan(host, b, goal, 'xwr-r5-base', S6A_WORK_ROLE.templateId);
  const line = await aWorkLine(world, 'xwr-r5');
  expect((await lineFacts(host, line)).latestWork?.task.goalId, 'R5: the line\'s newest Work is A\'s')
    .toBe(world.base.goal.goalId);
  await host.scripted.script(line, [{ kind: 'text', text: refinementPlanFrom((await b.activePlan(goal))!, goal,
    { label: 'xwr-r5', taskId: 'xwr-r5-b', role: S6A_WORK_ROLE.templateId }) }]);
  const person = (await sendS7A2PersonMessage(host, { label: 'xwr-r5', recipient: line.ref, goal })).ref;
  const closed = await settled(world, line, person);
  expect(await bClaimsOn(world, line), 'R5: no B Task is claimed on A\'s executor line').toEqual([]);
  expect(await b.route('queries/read', queryIn(person, b.scope))).toMatchObject({ status: 'ready',
    value: { job: { job: { status: 'answered' } } } });
  expect(await world.base.main.route('queries/read', interventionPlanningQueryRefs(person).queryJobRef))
    .toMatchObject({ status: 'not_found' });
  expect(await b.route('plans/proposal', proposalIn(person, goal, b.scope))).toMatchObject({ status: 'ready',
    value: { status: 'candidate', sourceMessageRef: person } });
  expect(closed.response).not.toBeNull();
}, 240_000);

it('R6 a person names a ready B Task to A\'s executor line: the line answers, the Task is not its claim', async () => {
  const world = await joined(false, true);
  const host = world.base.world;
  const goal = world.second.goal;
  const { taskId } = await adoptSecondPlan(host, world.second.workspace, goal, 'xwr-r6', S6A_WORK_ROLE.templateId);
  const line = await world.base.createWorkLine('xwr-r6-exec');
  await host.scripted.script(line, [{ kind: 'text', text: 'XWR R6: the A line answers about the B Task' }]);
  const person = valueOf<{ ref: SessionMessageRef }>((await host.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: line.ref, text: 'XWR R6 person message', intent: 'action_request', needsReply: true, goalRef: goal,
    taskRef: { projectId: goal.projectId, goalId: goal.goalId, taskId } }, 'xwr-r6-person'))).body,
  'committed', 'the R6 person message').ref;
  const closed = await settled(world, line, person);
  expect(await bClaimsOn(world, line), 'R6: the B Task is not claimed on A\'s executor line').toEqual([]);
  expect(closed.response).not.toBeNull();
}, 240_000);

/**
 * R7 (XWR lead ruling 11-13, the open-duty half of Rule W): the opening SCRIBE line in A is an open-duty role line.
 * A person's message in A names B's Goal and a ready B Task assigned to the scribe role. `intervention.ts:171-177`
 * sees a line outside the Goal's workspace whose duty is in `ROLE_LINE_OPEN_DUTIES` (`role-lines.ts:198-201`), so
 * `planningOnly` stays false and the line takes the ordinary existing-Task claim (`existing_task`); it does not turn
 * into a planning-only round. Observable: B's `sessions/executions` of the line carries the Task claim, and A's
 * `queries/read` names no planning Query for the message.
 * Mutation: `planningOnly` without `!isRoleLineOpenDuty(duty)` → the claim never appears (the round plans instead).
 */
it('R7 an open-duty scribe line in A claims B\'s ready Task; planningOnly does not stop the open duty', async () => {
  const world = await joined(false, false, true);
  const host = world.base.world;
  const goal = world.second.goal;
  const { taskId } = await adoptSecondPlan(host, world.second.workspace, goal, 'xwr-r7', S6A_SCRIBE_ROLE.templateId);
  const line = world.base.lines.scribe;
  const person = valueOf<{ ref: SessionMessageRef }>((await host.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: line.ref, text: 'XWR R7 person message', intent: 'action_request', needsReply: true, goalRef: goal,
    taskRef: { projectId: goal.projectId, goalId: goal.goalId, taskId } }, 'xwr-r7-person'))).body,
  'committed', 'the R7 person message').ref;
  const claims = await heartbeatUntil(host, () => bClaimsOn(world, line),
    items => items.some(claim => claim.task.taskId === taskId), 12);
  expect(claims, 'R7: the open-duty scribe line takes B\'s ready Task').toContainEqual(expect.objectContaining({
    task: expect.objectContaining({ projectId: goal.projectId, goalId: goal.goalId, taskId }),
    sessionRef: line.ref,
  }));
  // The ordinary claim route, not a planning round: the message has its one planning Query nowhere in A.
  expect(await world.base.main.route('queries/read', interventionPlanningQueryRefs(person).queryJobRef))
    .toMatchObject({ status: 'not_found' });
}, 240_000);
/**
 * R8 (the `mailbox-commands.ts:214` project comparison): a Query Answer ref of a SECOND project on the same Host is
 * refused by the published association owner before any Answer or message read; the same project's ref gets past
 * that comparison. The world opens B through the Host's own `workspaces/open` (no `projectId`): one Host, two
 * projects, each with its own scope and platform.
 * Mutation: drop `answerRef.projectId !== owned.projectId` → the foreign call is no longer `forbidden` (its next
 * read is the foreign Answer's `not_found`), so the cell is red.
 */
it('R8 an answer ref of another project on the same Host is forbidden; the same project gets past the guard', async () => {
  // The association owner has no core route (only `handleIntervention` calls it in production). Capture the real
  // project mailbox as the platform builds it, then call that production owner with the real Answer refs; the
  // capture only reads the owner, it changes no behavior.
  const captured: Array<ReturnType<typeof mailboxModule.createSessionMailbox>> = [];
  const realCreate = mailboxModule.createSessionMailbox;
  const spy = vi.spyOn(mailboxModule, 'createSessionMailbox').mockImplementation(deps => {
    const mailbox = realCreate(deps);
    captured.push(mailbox);
    return mailbox;
  });
  let world: XWS2AWorld;
  try { world = await joined(); } finally { spy.mockRestore(); }
  const mailbox = captured[0];
  if (mailbox === undefined) throw new Error('R8: the project mailbox was not captured');
  const host = world.base.world;
  const other = await openXWS2AOtherProject(world, 'xwr-r8-other');
  closers.push(() => other.remove());
  expect(other.scope.projectId, 'R8: the second project is not A').not.toBe(S6A_SCOPE.projectId);
  // A's real planning Answer: the A Goal's refine round, answered by A's adviser.
  await host.scripted.script(world.adviser, [submitPlanRound('xwr-r8', 'xwr-r8-plan')]);
  expect((await refineRound(world.base.main, host.goals.first, 'xwr-r8'))?.sessionId).toBe(world.adviser.ref.sessionId);
  const round = (await roundsOn(world, world.adviser, 'refine:'))[0]!.ref;
  expect((await settled(world, world.adviser, round)).response).not.toBeNull();
  const query = await readPlanningQuery(host, round);
  if (query === null) throw new Error('R8: the A planning Query is not readable');
  const answerRef = query.job.job.answerRefs.at(-1);
  if (answerRef === undefined) throw new Error('R8: the A planning Query has no formal Answer');
  // A fresh open message in A: the association owner would reply to it.
  const message = await sendS7A2PersonMessage(host, { label: 'xwr-r8', recipient: world.adviser.ref,
    goal: host.goals.first });
  const respond = async (ref: typeof answerRef, requestId: string) =>
    await mailbox.respondFromQueryAnswer(host.humanContext(), {
      input: { messageRef: message.ref, answerRef: ref },
      meta: { requestId, expected: [{ ref: message.ref, revision: message.revision }] },
    });
  const foreign = { ...answerRef, projectId: other.scope.projectId, workspaceId: other.scope.workspaceId };
  expect(await respond(foreign, 'xwr-r8-foreign')).toMatchObject({ status: 'rejected', code: 'forbidden',
    reason: 'the Query answer ref is outside the bound project' });
  // Same project: the project comparison admits the ref; the association's own message/Answer binding is the next
  // refusal (a different reason from the project guard). R1 is the ordinary same-project association's green path.
  expect(await respond(answerRef, 'xwr-r8-same')).not.toMatchObject({
    status: 'rejected', reason: 'the Query answer ref is outside the bound project' });
}, 300_000);

/**
 * X1 (XWR-ON draft §3; MVP-BEHAVIOR:331; O4b, o4b2 ruling 2): a joined workspace's Goal has the main adviser as its
 * responsible adviser, and its second same-module Work Task opens the module gate. The gate asks that adviser, the
 * Host offers the system `action_request` to the main line, the planning Query (whose answer shape is null) reads the
 * source message across the workspaces, the adviser writes the module convention, and the gate stops blocking.
 * Red today at (a): `create-platform.ts:3637-3639` resolves the recipient in the Goal's workspace, where role lines do
 * not live, so the gate saves `noteRequest: 'none'` / `{ recipient: null, reason: 'no_adviser_or_secretary' }` and no
 * round starts. The rest (b)-(e) cannot be reached until the recipient is the Goal's L35 adviser.
 * Named mutations (§3): ① the recipient back to the workspace duty read -> (a) (this is today's state);
 * ② `create-platform.ts:1556` reads the source with the caller's ctx -> (d) (`unavailable`);
 * ③ `query-preparation.ts:465` reads the source with `owned` -> (c); ④ `query-execution.ts:351` likewise -> (c)/(d).
 * ① is today's red; ②③④ were shown on a scratch copy with §2 applied (the row is red at (a) here).
 */
it('X1 a B Goal\'s overlap-note round reaches the main adviser, whose Query lives in B', async () => {
  const world = await joined(false, false, true);
  const host = world.base.world;
  const b = world.second.workspace;
  const goal = world.second.goal;
  const scribe = world.base.lines.scribe;
  await world.approveCoarse();
  // L35's one read: the main adviser is this Goal's responsible adviser.
  const queue = valueOf<{ revision: number }>(await world.base.main.route('goals/adviser-queue', {}), 'ready',
    'the Goal adviser queue');
  valueOf(await world.base.main.post('goals/adviser-queue/assign', graphWrite(S6A_SCOPE, {
    goalRef: goal, adviser: world.adviser.ref, expectedRevision: queue.revision,
  }, 'xwron-assign')), 'committed', 'the B Goal adviser assignment');
  // Two Work Tasks on second-mod, both assigned to the scribe role (an open-duty line in A, R7).
  const stageId = 'xwron-stage';
  const moduleId = xws2aModuleInProject(b.scope.workspaceId);
  const taskIds = ['xwron-a', 'xwron-b'] as const;
  const draft = {
    schemaVersion: 2, planId: 'xwron-plan', planRevision: 1, goalId: goal.goalId,
    stages: [{ stageId, title: 'XWR-ON stage' }],
    tasks: taskIds.map(taskId => ({ taskId, title: taskId, requirementLevel: 'required', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'module', stageId, moduleRef: XWS2A_MODULE_ID },
      executionIntent: 'request_execution', sizeClass: 'small', estimatedLines: 10 })),
    assignments: taskIds.map(taskId => ({ taskId, role: S6A_SCRIBE_ROLE.templateId,
      instruction: `XWR-ON ${taskId}` })),
    obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [],
    inputRequirements: [],
  };
  const proposed = valueOf<{ ref: unknown; revision: number }>(await b.post('plans/propose',
    graphWrite(b.scope, { goalRef: goal, basedOn: null, draft,
      reason: { text: 'XWR-ON plan', sources: [] } }, 'xwron-propose')), 'committed', 'the XWR-ON plan');
  valueOf(await b.post('plans/apply', graphWrite(b.scope, { proposalRef: proposed.ref,
    expectedProposalRevision: proposed.revision, decisionRefs: [] }, 'xwron-apply')), 'committed',
  'the XWR-ON plan application');
  // a starts on the scribe line through the person's action_request naming the ready B Task (R7's existing-Task
  // claim); the Host's driver then starts its real Work Run, which stops at this model request.
  const heldA = await host.gates.modelRequest(scribe);
  await host.scripted.script(scribe, [{ kind: 'text', text: 'XWR-ON a done' }]);
  valueOf((await host.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: scribe.ref, text: 'XWR-ON a', intent: 'action_request', needsReply: true, goalRef: goal,
    taskRef: { projectId: goal.projectId, goalId: goal.goalId, taskId: taskIds[0] },
  }, 'xwron-a-person'))).body, 'committed', 'the a person message');
  try {
    const claimsA = await heartbeatUntil(host, () => bClaimsOn(world, scribe),
      items => items.some(claim => claim.task.taskId === taskIds[0]), 12);
    expect(claimsA, 'X1: the scribe line claims a').toContainEqual(expect.objectContaining({
      task: expect.objectContaining({ taskId: taskIds[0] }) }));
    await heldA.reached;
    // The adviser's text round writes the module convention the gate is waiting for.
    const conclusion = 'XWR-ON: the second-mod interface';
    await host.scripted.script(world.adviser, [
      { kind: 'calls', calls: [{ callId: 'xwron-note', name: 'record_note', args: {
        op: 'write', kind: 'convention', topic: 'xwron-interface', conclusion,
        anchor: { kind: 'module', moduleId }, extraAnchors: [], facts: [], basisFiles: [],
        replaces: [], contradicts: [], coexistWith: [], structural: false, body: 'XWR-ON interface note',
      } }] },
      { kind: 'text', text: 'XWR-ON interface note written' },
    ]);
    // b shares a's module: its gate opens and sends the one note request. The existing second-workspace drive
    // stops before the retry step today and on the gate wait after the package; the saved gate is the same fact the
    // open receipt reported (`sent` iff the noteRequest carries a recipient and a messageRef).
    await driveSecondWorkflow(b, { schemaVersion: 1, goalRef: goal, flowId: 'xwron-b', sessionHint: null,
      kind: 'select_work', taskId: taskIds[1] }, 'request_overlap_note');
    // (a) the gate names the main adviser (L35) and a message in A.
    const gates = valueOf<{ gates: ModuleOverlapGateV1[] }>(await b.route('goals/overlap-gates', {
      goalRef: goal, page: { limit: 10 } }), 'ready', 'the B overlap gates');
    const gate = gates.gates.find(candidate => candidate.ref.taskId === taskIds[1]);
    if (gate === undefined) throw new Error('X1: the B overlap gate is not listed');
    expect(gate.moduleId).toBe(moduleId);
    expect(gate.noteRequest, 'X1: the gate saved no note request').toMatchObject({
      recipient: { projectId: world.adviser.ref.projectId, sessionId: world.adviser.ref.sessionId },
      duty: 'adviser', messageRef: expect.objectContaining({ workspaceId: S6A_SCOPE.workspaceId }),
    });
    const noteRequest = gate.noteRequest;
    if (noteRequest === null || 'reason' in noteRequest) {
      throw new Error(`X1: the gate saved no note request: ${JSON.stringify(noteRequest)}`);
    }
    const messageRef = noteRequest.messageRef;
    if (messageRef === undefined) throw new Error('X1: the note request names no message');
    // (b) exactly one Host system action_request for B's Goal, with N's body.
    const requests = (await world.inbox(world.adviser)).filter(message => message.intent === 'action_request'
      && message.sender.kind === 'host' && message.sender.actor.kind === 'system'
      && message.goalRef?.goalId === goal.goalId);
    expect(requests, 'X1: the adviser has one note request for B\'s Goal').toHaveLength(1);
    const request = requests[0]!;
    expect(request.sender).toMatchObject({ kind: 'host', actor: { kind: 'system', id: 'workflow:auto-rework' } });
    expect(request.goalRef).toMatchObject({ projectId: goal.projectId, goalId: goal.goalId });
    expect(request.ref).toEqual(messageRef);
    expect(await world.messageText(request)).toBe(`模块被占用，请为这个模块写一条接口注记：${gate.moduleId}`);
    // (c) the Query is B's; the main workspace has no such Query.
    const queryRead = await heartbeatUntil<{ status: string; value?: QueryJobRecord }>(host,
      async () => await b.route('queries/read', queryIn(messageRef, b.scope)) as { status: string; value?: QueryJobRecord },
      read => read.status === 'ready' && read.value?.job.job.status === 'answered', 16);
    expect(queryRead).toMatchObject({ status: 'ready', value: { job: { job: { status: 'answered' } } } });
    const queryRunRef = queryRead.value?.run.ref;
    if (queryRunRef === undefined) throw new Error('X1: the B planning Query has no run ref');
    expect(await world.base.main.route('queries/read', interventionPlanningQueryRefs(messageRef).queryJobRef))
      .toMatchObject({ status: 'not_found' });
    // (d) the note is on the module anchor, sourced from that Query.
    const notes = await heartbeatUntil(host, () => world.notes({ kind: 'module', moduleId: gate.moduleId }),
      items => items.some(item => item.conclusion === conclusion), 16);
    const written = notes.find(item => item.conclusion === conclusion);
    expect(written).toMatchObject({ kind: 'convention', anchor: { kind: 'module', moduleId: gate.moduleId },
      source: { kind: 'agent', duty: 'adviser', queryRunRef } });
    // (e) the gate no longer blocks b.
    const after = await b.route('workflow/advance', { schemaVersion: 1, goalRef: goal, flowId: 'xwron-b-after',
      sessionHint: null, kind: 'select_work', taskId: taskIds[1] }) as WorkflowAdvanceResult;
    expect(after.status).toBe('ready');
    if (after.status === 'ready' && after.value.state === 'waiting') {
      expect(after.value.reason).not.toContain('overlap_gate_pending');
    }
  } finally {
    heldA.release();
  }
});
