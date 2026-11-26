/** The INT rows' shared public steps (run sheet §4): sends, the message/Query/Goal reads, a completed Goal. */
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { MainPageV1 } from '../../src/core/work-graph/views/main-surface-read-model.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { consumeView, heartbeatUntil, readPlanningQuery } from './IV-host-fixture.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import { type S6AHostWorld } from './S6A-host-fixture.js';
import { openConsumeHostWorld } from './S7B2-consumable-sessions.js';
import { S6A_SCOPE, S6A_SECRETARY_PROFILE_ID, S6A_WORK_ROLE, type S6AExtraBinding, type S6ASession } from './S6A-request-fixture.js';
import { adoptS6BPlan, governS6B } from './S6B1-fixture.js';
import { S7A_REPLY_TOOLS, committed, ready } from './S7A-fixture.js';
import { firstPlan } from './S7B-V-fixture.js';
import { secretaryAnswer } from './S6A-history-fixture.js';
import { waitFor } from '../scenarios/harness.js';
import type { GoalConfirmDraftReceiptV1 } from '../../src/contracts/goal-card.js';
import type { PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import { completeS7BGoal } from './S7B-V-fixture.js';
import { runsOf } from './DRV-fixture.js';
import { claimWithSecretaryProfile, prepareAttempt, start } from './request-claim-steps.js';
import { setS7D1Open } from './S7D1-allocation-world.js';

/** The person's line-page send (`entry: 'person_intervention'`), then `messages/read`. */
export async function intSendPerson(world: S6AHostWorld, input: {
  id: string; recipient: SessionRef; text: string; goal?: GoalRef; task?: TaskTriple;
}): Promise<SessionMessage> {
  const sent = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: input.recipient, text: input.text, entry: 'person_intervention', needsReply: true,
    ...(input.goal === undefined ? {} : { goalRef: input.goal }),
    ...(input.task === undefined ? {} : { taskRef: input.task }),
  }, `int-${input.id}`)), `the ${input.id} person message`);
  return await intMessage(world, sent.ref);
}

/** `messages/read` of one saved message. */
export const intMessage = async (world: S6AHostWorld, ref: SessionMessageRef): Promise<SessionMessage> =>
  ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, ref)), `the message ${ref.messageId}`);

/** Bounded polling: the message's planning Query exists (null until the Host commits the pair). */
export const intAwaitPlanning = (world: S6AHostWorld, ref: SessionMessageRef, passes = 12) =>
  heartbeatUntil(world, () => readPlanningQuery(world, ref), query => query !== null, passes);

/** What the consumable view offers the line right now. */
export const intOffer = async (world: S6AHostWorld, line: S6ASession) => await consumeView(world, line);

/** Bounded polling: the no-goal view lists a request the predicate accepts. */
export const intAwaitNoGoalRequest = (world: S6AHostWorld, done: (view: RequestCoreViewV1) => boolean,
  passes = 12): Promise<MainPageV1> => heartbeatUntil(world, async () => ready<MainPageV1>(
    await world.post('main/read', plain(S6A_SCOPE, { goalId: null, cursor: null })), 'main/read'),
  page => page.requests.some(done), passes);

/** The user text of each model request, oldest first (the model input the row reads). */
export const intUserInputs = (requests: readonly ModelRequest[]): string[] => requests.map(request =>
  request.messages.filter(message => message.role === 'user').map(message => message.content).join('\n'));

/** The one consume Host factory both INT worlds use (the openConsumeHostWorld wrapper adds the Work profile). */
function intConsumer(label: string) {
  return { scope: S6A_SCOPE,
    sessionRef: { projectId: S6A_SCOPE.projectId, sessionId: `${label}-consumer` },
    goalRef: { aggregateType: 'Goal' as const, projectId: S6A_SCOPE.projectId, goalId: `${label}-consumer` },
    queryProfileId: S6A_SECRETARY_PROFILE_ID, heartbeatMs: 25 };
}
async function intConsumeHost(label: string, extraBindings: readonly S6AExtraBinding[] = []): Promise<S6AHostWorld> {
  return await openConsumeHostWorld({ backend: 'memory', ...(extraBindings.length === 0 ? {} : { extraBindings }),
    extraHostOptions: { inputConsumers: [intConsumer(label)] } });
}

/** A Goal completed through the Workflow and `completeGoal`, plus one used line and a secretary. */
export async function intOpenCompletedGoal(label: string): Promise<{
  world: S6AHostWorld; goal: GoalRef; secretary: S6ASession; workedLine: SessionRef;
}> {
  const world = await intConsumeHost(label);
  try {
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const goal = world.goals.first;
    await governS6B(world, main, world.goals);
    await adoptS6BPlan(main, goal, { label, taskIds: [`${label}-work`], role: S6A_WORK_ROLE.templateId });
    await completeS7BGoal({ world, goalRef: goal });
    const claimed = (await runsOf(world, goal, `${label}-work`)).at(-1)?.outbox.claim.sessionRef;
    if (claimed === undefined) throw new Error(`INT: ${label} has no Run on its work Task`);
    const secretary = await world.createSecretary(`${label}-secretary`);
    const limits = ready<{ revision: number }>(await world.post('projects/role-limits',
      plain(S6A_SCOPE, { projectRef: { projectId: S6A_SCOPE.projectId } })), 'projects/role-limits');
    await setS7D1Open(world, 'secretary', 4, limits.revision, `${label}-secretary-open`);
    return { world, goal, secretary, workedLine: claimed };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/** The first plan of `goal` proposed and adopted (the E3P-6 step the O1/D1 rows share). */
export async function intAdoptFirstPlan(world: S6AHostWorld, goal: GoalRef,
  input: { label: string; taskId: string }): Promise<void> {
  const plan = (JSON.parse(firstPlan({ label: input.label, taskId: input.taskId,
    role: S6A_WORK_ROLE.templateId })) as { plan: Record<string, unknown> }).plan;
  const read = ready<{ goal: { revision: number } }>(await world.post('goals/read', plain(S6A_SCOPE, goal)),
    'goals/read');
  const proposed = committed<{ ref: PlanProposalRef; revision: number }>(await world.post('plans/propose',
    graphWrite(S6A_SCOPE, { goalRef: goal, basedOn: null,
      draft: { ...plan, goalId: goal.goalId, planId: `${input.label}-plan`, planRevision: 1 },
      reason: { text: `INT ${input.label} first plan`, sources: [] } }, `${input.label}-propose`,
    [{ ref: goal, revision: read.goal.revision }])), `${input.label} first plan`);
  committed(await world.post('plans/apply', graphWrite(S6A_SCOPE, { proposalRef: proposed.ref,
    expectedProposalRevision: proposed.revision, decisionRefs: [] }, `${input.label}-apply`)),
  `${input.label} adoption`);
}

/** A completed Goal's line message becomes a request, its card becomes a Goal, and its first plan is adopted. */
export async function intStartNewGoalFromLine(world: S6AHostWorld, input: {
  id: string; line: SessionRef; goal: GoalRef; secretary: S6ASession; label: string; taskId: string;
}): Promise<{ message: SessionMessage; root: QueryJobRef; newGoal: GoalRef; firstTaskId: string }> {
  const message = await intSendPerson(world, { id: `${input.id}-message`, recipient: input.line,
    text: `INT ${input.id}: 再加一个导出功能`, goal: input.goal });
  const page = await intAwaitNoGoalRequest(world, view => view.source?.messageRef?.messageId === message.ref.messageId
    && view.source.goalRef.goalId === input.goal.goalId, 20);
  const request = page.requests.find(view => view.source?.messageRef?.messageId === message.ref.messageId);
  if (request === undefined) throw new Error(`INT: ${input.id} opened no new-goal request`);
  const root = request.requestRoot;
  const first = request.rounds.find(round => round.ref.queryJobId === root.queryJobId)?.ref ?? root;
  if (request.owner === null) {
    const routed = await world.route({ commandId: `${input.id}-route`, round: root, to: input.secretary });
    if (routed.status !== 'routed') throw new Error(`INT: ${input.id} did not route: ${JSON.stringify(routed)}`);
  }
  await world.scripted.script(input.secretary, [{ kind: 'text', text: secretaryAnswer({ body: `INT ${input.id} card`,
    goalCardDrafts: [{ objective: `INT ${input.id} Goal`,
      completion: [`INT ${input.id} done`], autonomy: 'after_plan_confirmation', screening: null }] }) }]);
  if ((await claimWithSecretaryProfile(world, first, input.secretary, `${input.id}-claim`))['status'] !== 'committed') {
    throw new Error(`INT: ${input.id} did not claim the new-goal round`);
  }
  const prepared = await prepareAttempt(world, first, `${input.id}-prepare`);
  if ((await start(world, prepared, `${input.id}-start`))['status'] !== 'ready') {
    throw new Error(`INT: ${input.id} did not start the new-goal round`);
  }
  const answered = await world.waitForRequest(root, view => view.rounds.some(round =>
    round.ref.queryJobId === first.queryJobId && round.status === 'ended'), `${input.id} first round`);
  const card = answered.rounds.find(round => round.ref.queryJobId === first.queryJobId)?.goalCardDrafts[0];
  if (card === undefined) throw new Error(`INT: ${input.id} answered no Goal card`);
  const confirmed = committed<GoalConfirmDraftReceiptV1>(await world.post('goals/confirm-draft', plain(S6A_SCOPE, {
    commandId: `${input.id}-confirm`, round: first, index: card.index })), `${input.id} Goal card`);
  const newGoal = confirmed.goal.ref;
  // This step's coverage is the binding R3 reads (the card-confirmed Goal and the request root that named
  // the completed Goal), not the frozen row's "the same request's first plan": the fixture keeps
  // `requestDriver: 'off'`, the scripted answer offers no selectable idea, and this adoption is a direct
  // `plans/propose` without `requestRef`, so no request candidate is written or read here.
  await intAdoptFirstPlan(world, newGoal, { label: input.id, taskId: input.taskId });
  return { message, root, newGoal, firstTaskId: input.taskId };
}

/** One Host world whose consume loop scans the work profile (the real wait world for R1/U3). */
export async function intOpenWaitWorld(label: string): Promise<S6AHostWorld> {
  const world = await intConsumeHost(label, [S7A_REPLY_TOOLS, { ...S7A_REPLY_TOOLS,
    mergeTools: ['send_session_message'] }]);
  await governS6B(world, s6aCardsWorkspace(world, S6A_SCOPE), world.goals);
  return world;
}
