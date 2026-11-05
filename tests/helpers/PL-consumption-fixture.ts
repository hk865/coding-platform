/**
 * PL P2 consumption fixture: the real Host consume world plus the few PL-specific steps the five P2 rows need.
 *
 * Every prior state comes from a public step: `openConsumeHostWorld` (the real S7B2 Host world whose consumer is
 * installed for the world's whole life), `sessions/create` (`createS6BLine`), `plans/propose` + `plans/apply`,
 * `workflow/advance` (`driveWorkflow`), the real `send_session_message` tool inside a Work Run, the real
 * `messages/release` route, P1's real `systemRoundContext`/`sendSystemRound` wrapper, and the public reads.
 * Nothing here writes a record or a call context, and no consumption loop is copied.
 *
 * The adviser line is a Host input (A8): one trusted Runtime binding for the platform adviser role, its Workflow
 * binding and its Query profile, added through `S6AExtraBinding.queryProfile`. The platform role profile is the one
 * the real duty reader sees as `adviser`, so the Host's own consume loop picks this line's profile.
 */
import { vi } from 'vitest';
import * as workflowModule from '../../src/business/workflow/workflow.js';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import * as decisionService from '../../src/core/work-graph/communication/decision-service.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { QueryJobRef, QueryRunRef } from '../../src/app/core-http-types.js';
import type { RoleBindingRefV1, RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { RoleConfigurationRef, SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import { systemRoundRequestId, systemRoundContext, systemRoundMessageRef,
  type SystemRoundV1 } from '../../src/contracts/plan-round.js';
import { interventionPlanningQueryRefs, type QueryJobAnswerSnapshot } from '../../src/contracts/query-job.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { WorkbenchQueryProfile } from '../../src/app/runtime-configuration.js';
import { sendSystemRound } from '../../src/app/system-round.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { AG2B_CONSUMER_ID, AG2B_QUERY_BUDGET, AG2B_RUNTIME_BUDGET, ag2bPlanDraft, graphWrite, plain } from
  './AG2b-collaboration-fixture.js';
import { driveWorkflow } from './A2-restart-fixture.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import type { S6AHostWorld } from './S6A-host-fixture.js';
import { openConsumeHostWorld } from './S7B2-consumable-sessions.js';
import { assignGoalAdviserLine } from './S7C-handoff-fixture.js';
import { withConfiguredHost } from './S7C-member-fixture.js';
import type { TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import { checkConfiguration } from './S7A-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE, type S6AExtraBinding, type S6ASession } from './S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from './S6B1-fixture.js';
import { sendS7BWaitingInquiry } from './S7B-fixture.js';
import { approveS7A2Message, readS7A2DispatchBasis } from './S7A2-fixture.js';
import { claimQuery, prepareAttempt, start } from './request-claim-steps.js';
import { bindingOf, committed, ready, sessionOf } from './S7A-fixture.js';

export const PL_ADVISER_ROLE = platformRoleProfile('adviser').template;
export const PL_ADVISER_ROLE_BINDING: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 'pl-adviser-binding', templateId: PL_ADVISER_ROLE.templateId,
  templateRevision: PL_ADVISER_ROLE.templateRevision, bindingVersion: 1, policyRevision: 'legacy-template',
};
export const PL_ADVISER_PROFILE_ID = 'pl-adviser-profile';

const ADVISER_GUIDANCE = 'PL trusted adviser guidance';

const ADVISER_BINDING: S6AExtraBinding = {
  binding: bindingOf('pl-adviser-binding', PL_ADVISER_ROLE, ADVISER_GUIDANCE, ['read', 'send_session_message']),
  workflow: { workspace: S6A_SCOPE, sessionRole: PL_ADVISER_ROLE, roleBinding: PL_ADVISER_ROLE_BINDING,
    budget: { tokenBudget: 1_000_000, deadline: null } },
  queryProfile: {
    id: PL_ADVISER_PROFILE_ID, label: 'PL adviser', scope: S6A_SCOPE,
    runtimeBindingId: 'pl-adviser-binding', sessionRole: PL_ADVISER_ROLE,
    roleBinding: PL_ADVISER_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET, budget: { maxTokens: null, deadline: null },
    consumerId: AG2B_CONSUMER_ID,
  } satisfies WorkbenchQueryProfile,
};

/** The armed fault on the real decision read; `restore` takes the spy off. */
export type PLDecisionReadFault = { arm(): void; readonly fired: boolean; restore(): void };

/**
 * Installed before the world opens, because the platform holds the service it builds and publishes only a wrapper of
 * it: once armed, the next decision-answer read answers `A10_fault` and every later read is the real one.
 */
export function installPLDecisionReadFault(): PLDecisionReadFault {
  const real = decisionService.createDecisionMessageService;
  let armed = false;
  let fired = false;
  const spy = vi.spyOn(decisionService, 'createDecisionMessageService').mockImplementation(dependencies => {
    const service = real(dependencies);
    return { ...service, readDecisionAnswer: async (ctx, input) => {
      if (!armed || fired) return await service.readDecisionAnswer(ctx, input);
      fired = true;
      return { status: 'rejected', code: 'unavailable', reason: 'A10_fault' };
    } };
  });
  return { arm() { armed = true; }, get fired() { return fired; }, restore() { spy.mockRestore(); } };
}

/** The window between one `advanceWork` read and what the driver does with its result. */
export type PLAdvanceHook = {
  after: ((input: WorkflowAdvanceInput, result: WorkflowAdvanceResult) => Promise<void>) | null;
  restore(): void;
};

/**
 * Installs the hook before the world opens, since the Host copies the Workflow's methods at its start. `advanceWork`
 * still does the real read and returns the real result (rule sheet A3); `after` runs between the two.
 */
export function installPLAdvanceHook(): PLAdvanceHook {
  const real = workflowModule.createWorkflow;
  const hook: PLAdvanceHook = { after: null, restore() { spy.mockRestore(); } };
  const spy = vi.spyOn(workflowModule, 'createWorkflow').mockImplementation(dependencies => {
    const workflow = real(dependencies);
    return { ...workflow, advanceWork: async (ctx, input, internal) => {
      const result = await workflow.advanceWork(ctx, input, internal);
      await hook.after?.(input, result);
      return result;
    } };
  });
  return hook;
}

/**
 * The one injectable failing-check seam: the world's real trusted check keeps its
 * configuration and real command runner, and only its command exits non-zero. The
 * caller passes the returned configuration as `openPLConsumptionWorld`'s `checks`;
 * without this call a world keeps the base check, so the default is unchanged.
 */
export function installPLFailingCheck(): TrustedCheckConfiguration {
  const configuration = checkConfiguration({ ...OPERATOR, kind: 'human' });
  return { ...configuration,
    checks: configuration.checks.map(check => ({ ...check, command: 'false' })) };
}

/** The adviser binding on its default window, or on the window a large planning input needs. */
function adviserBindingOf(contextWindowTokens: number | undefined): S6AExtraBinding {
  if (contextWindowTokens === undefined) return ADVISER_BINDING;
  const binding = structuredClone(ADVISER_BINDING);
  binding.binding.grant.budget = { ...binding.binding.grant.budget, contextWindowTokens };
  const profile = binding.queryProfile!;
  return { ...binding, queryProfile: { ...profile, runtimeBudget: { ...profile.runtimeBudget, contextWindowTokens } } };
}

/** The Work binding's tool merge a sender Run needs (send and continue on a reply). */
const WORK_TOOLS: S6AExtraBinding = {
  binding: bindingOf('s6a-work-binding', S6A_WORK_ROLE, 'S6A trusted work guidance', ['read']),
  mergeTools: ['send_session_message', 'respond_session_message'],
};

type HostFactory = typeof import('../../src/app/host.js').createLocalWorkbenchHost;

/** PL-48/PL-51: the readings world's Work grant, installed for one real Host start. */
function writeWorkHostFactory(original: HostFactory): HostFactory {
  return async hostOptions => {
    const work = hostOptions.runtimeConfiguration?.bindings.find(binding => binding.id === 's6a-work-binding');
    if (work === undefined) throw new Error('PL: the Host was opened without its Work binding');
    work.grant = { ...work.grant, tools: [...new Set([...work.grant.tools, 'write', 'shell'])],
      writeScope: ['.'], shellWorkspaceAccess: 'all_except_denied' };
    return await original(hostOptions);
  };
}

/**
 * The real Host consume world with the adviser line's profile installed, one consumer for the scope, and the
 * governance seeded once. `settleHost` (IV) runs the two empty passes before a row sends.
 */
export async function openPLConsumptionWorld(options: {
  backend?: 'memory' | 'sqlite'; label?: string; contextWindowTokens?: number;
  /** PL-48/PL-51: the real write/edit/shell grant on the Work binding (the readings world's rule). */
  write?: boolean;
  /** A normally ended Work Run needs a trusted check configuration; an object replaces the readings default. */
  checks?: boolean | import('../../src/contracts/verification.js').TrustedCheckConfiguration;
} = {}): Promise<S6AHostWorld> {
  const label = options.label ?? 'pl';
  const openWorld = () => openConsumeHostWorld({
    backend: options.backend ?? 'memory',
    extraBindings: [adviserBindingOf(options.contextWindowTokens), WORK_TOOLS],
    extraHostOptions: { ...(options.checks === undefined || options.checks === false ? {}
      : { checks: options.checks === true ? checkConfiguration({ ...OPERATOR, kind: 'human' }) : options.checks }),
      inputConsumers: [{ scope: S6A_SCOPE,
        sessionRef: { projectId: S6A_SCOPE.projectId, sessionId: `${label}-consumer` },
        goalRef: { aggregateType: 'Goal' as const, projectId: S6A_SCOPE.projectId, goalId: `${label}-consumer` },
        queryProfileId: PL_ADVISER_PROFILE_ID, heartbeatMs: 25 }] },
  });
  const world = options.write === true
    ? await withConfiguredHost(openWorld, original => writeWorkHostFactory(original))
    : await openWorld();
  try {
    await governS6B(world, s6aCardsWorkspace(world, S6A_SCOPE), world.goals);
    return world;
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/** One real `sessions/create` with the given role and Task links. */
export async function createPLLine(world: S6AHostWorld, input: {
  label: string; role: RoleConfigurationRef; tasks?: readonly TaskTriple[];
}): Promise<S6ASession> {
  return await sessionOf(world, await createS6BLine(s6aCardsWorkspace(world, S6A_SCOPE),
    { label: input.label, role: input.role, ...(input.tasks === undefined ? {} : { tasks: input.tasks }) }));
}

/** One idle adviser line (the platform adviser role; no Task links) holding the Goal through the platform's assign. */
export async function createPLAdviserLine(world: S6AHostWorld, label: string): Promise<S6ASession> {
  return await assignGoalAdviserLine(world, { goal: world.goals.first, label, requestId: label });
}

/**
 * One Plan whose Tasks are assigned to different roles (the W/A world): the AG2b draft with the caller's role per
 * Task, proposed and adopted through the real `plans/propose` + `plans/apply`.
 */
export async function adoptPLMixedPlan(world: S6AHostWorld, input: {
  goal: GoalRef; label: string; tasks: ReadonlyArray<{ taskId: string; role: string }>;
}): Promise<{ plan: PlanRevisionSnapshot; tasks: readonly TaskTriple[] }> {
  const taskIds = input.tasks.map(task => task.taskId);
  const draft = { ...ag2bPlanDraft(taskIds), planId: `pl-plan-${input.label}`, goalId: input.goal.goalId,
    assignments: input.tasks.map(task => ({ taskId: task.taskId, role: task.role,
      instruction: `PL ${input.label} ${task.taskId}` })) };
  const proposed = committed<{ ref: PlanProposalRef; revision: number }>(await world.post('plans/propose',
    graphWrite(S6A_SCOPE, { goalRef: input.goal, basedOn: null, draft,
      reason: { text: `PL plan ${input.label}`, sources: [] } }, `pl-plan-${input.label}-propose`)),
  `the Plan ${input.label}`);
  committed(await world.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
  }, `pl-plan-${input.label}-apply`)), `the adoption of ${input.label}`);
  const plan = await s6aCardsWorkspace(world, S6A_SCOPE).activePlan(input.goal);
  if (plan === null) throw new Error(`PL: ${input.goal.goalId} has no adopted Plan after ${input.label}`);
  return { plan, tasks: taskIds.map(taskId => ({ projectId: input.goal.projectId, goalId: input.goal.goalId, taskId })) };
}

/** One Work line over a plan the fixture adopts for the work role (the send/reply world of PL-33). */
export async function seedPLSenderPlan(world: S6AHostWorld, input: {
  goal: GoalRef; label: string; taskIds: readonly string[];
}): Promise<{ line: S6ASession; plan: PlanRevisionSnapshot; tasks: readonly TaskTriple[] }> {
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  const { plan, tasks } = await adoptS6BPlan(main, input.goal,
    { label: input.label, taskIds: input.taskIds, role: S6A_WORK_ROLE.templateId });
  const line = await createPLLine(world, { label: `${input.label}-sender`, role: S6A_WORK_ROLE, tasks });
  return { line, plan, tasks };
}

/**
 * One shared "create the adviser line + its peer + really run W and yield" step: the adviser claims W through
 * `workflow/advance`, the Run yields on a waiting inquiry to the unprofiled peer, so this occupancy ends while W
 * stays active. Each caller composes its own Plan inputs and sender line around this step.
 */
async function runAdviserWork(world: S6AHostWorld, input: {
  goal: GoalRef; label: string; adviserTask: TaskTriple;
}): Promise<{ adviser: S6ASession; peer: S6ASession }> {
  const adviser = await createPLLine(world, { label: `${input.label}-adviser`, role: PL_ADVISER_ROLE,
    tasks: [input.adviserTask] });
  const peer = await world.createUnprofiledSecretary(`${input.label}-peer`);
  await sendS7BWaitingInquiry(world, { goal: input.goal, session: adviser, taskId: input.adviserTask.taskId,
    label: `${input.label}-w`, body: { recipient: peer.ref, text: `PL ${input.label} W lets go`,
      intent: 'inquiry', needsReply: true, waitAfterSend: true } });
  return { adviser, peer };
}

/**
 * The PL-05 world: the adviser really runs W (a real claim + Run through `workflow/advance`), the Run yields on a
 * waiting inquiry to an unprofiled peer, so this occupancy ends while W stays active; `sessions/facts` then names W
 * as `latestWork`.
 */
export async function seedPLAdviserWork(world: S6AHostWorld, input: {
  goal: GoalRef; label: string; taskId: string;
}): Promise<{ adviser: S6ASession; peer: S6ASession; plan: PlanRevisionSnapshot; task: TaskTriple }> {
  const { plan, tasks } = await adoptPLMixedPlan(world, { goal: input.goal, label: input.label,
    tasks: [{ taskId: input.taskId, role: PL_ADVISER_ROLE.templateId }] });
  const { adviser, peer } = await runAdviserWork(world, { goal: input.goal, label: input.label,
    adviserTask: tasks[0]! });
  const facts = ready<{ latestWork: { task: { taskId: string } } | null }>(
    await world.post('sessions/facts', plain(S6A_SCOPE, adviser.ref)), `the facts of ${input.label}`);
  if (facts.latestWork?.task.taskId !== input.taskId) {
    throw new Error(`PL: the adviser's latestWork is not ${input.taskId}: ${JSON.stringify(facts.latestWork)}`);
  }
  return { adviser, peer, plan, task: tasks[0]! };
}

/**
 * The PL-45/A-10 world: one Plan with W on the adviser role and the sender's Task on the work role, the adviser
 * really runs W and ends its occupancy while W stays unfinished, and the sender has its own line.
 */
export async function seedPLActionWorld(world: S6AHostWorld, input: {
  goal: GoalRef; label: string; adviserTaskId: string; senderTaskId: string;
}): Promise<{ adviser: S6ASession; sender: S6ASession; peer: S6ASession; plan: PlanRevisionSnapshot;
  adviserTask: TaskTriple; senderTask: TaskTriple }> {
  const { plan, tasks } = await adoptPLMixedPlan(world, { goal: input.goal, label: input.label, tasks: [
    { taskId: input.adviserTaskId, role: PL_ADVISER_ROLE.templateId },
    { taskId: input.senderTaskId, role: S6A_WORK_ROLE.templateId },
  ] });
  const sender = await createPLLine(world, { label: `${input.label}-sender`, role: S6A_WORK_ROLE,
    tasks: [tasks[1]!] });
  const { adviser, peer } = await runAdviserWork(world, { goal: input.goal, label: input.label,
    adviserTask: tasks[0]! });
  return { adviser, sender, peer, plan, adviserTask: tasks[0]!, senderTask: tasks[1]! };
}

/** The `SystemRoundV1` of one refine; the fixture sends it through P1's real wrapper. */
export function plRefineRound(input: { goal: GoalRef; taskId: string; planRevision: number }): SystemRoundV1 {
  return { kind: 'refine', goalRef: input.goal, target: { kind: 'task', taskId: input.taskId },
    planRevision: input.planRevision };
}

/**
 * Sends one real Host system round through `sendSystemRound(systemRoundContext(...), {messages}, input)` and
 * returns its deterministic message ref. This is P1's real send path (the production caller is P4).
 */
export async function sendPLSystemRound(world: S6AHostWorld, input: {
  line: S6ASession; round: SystemRoundV1; text: string; allowReplay?: boolean; followupOf?: SessionMessageRef;
}): Promise<{ requestId: string; messageRef: SessionMessageRef; result: Awaited<ReturnType<typeof sendSystemRound>> }> {
  const requestId = systemRoundRequestId(input.round);
  if (requestId.status !== 'ready') throw new Error(`PL: the round has no request id: ${JSON.stringify(requestId)}`);
  const ref = systemRoundMessageRef(S6A_SCOPE, requestId.value);
  if (ref.status !== 'ready') throw new Error('PL: the round has no message ref');
  const sent = await sendSystemRound(systemRoundContext(S6A_SCOPE, new AbortController().signal),
    { messages: world.platform.messages },
    { round: input.round, recipient: input.line.ref, text: input.text,
      ...(input.followupOf === undefined ? {} : { followupOf: input.followupOf }) });
  const replayed = sent.status === 'skipped' && input.allowReplay === true;
  if (sent.status !== 'committed' && !replayed) {
    throw new Error(`PL: the system round ${requestId.value} did not commit: ${JSON.stringify(sent)}`);
  }
  return { requestId: requestId.value, messageRef: ref.value, result: sent };
}

/**
 * Sends one real `planresume:` through P1's wrapper: the recipient is the real adviser line, `followupOf` is the
 * lineage root read through `queries/read`, and the body is P1's header + `originalQueryRef` + fixed sentence.
 * The production caller is P4's goal loop; A-10 uses the same real send path for its reachable half.
 */
export async function sendPLPlanResume(world: S6AHostWorld, input: {
  line: S6ASession; goal: GoalRef; originalQueryJobId: string; originalMessageRef: SessionMessageRef;
  followupOf: SessionMessageRef; allowReplay?: boolean;
}): Promise<{ requestId: string; messageRef: SessionMessageRef; result: Awaited<ReturnType<typeof sendSystemRound>> }> {
  const round = plPlanResumeRound(input);
  const requestId = systemRoundRequestId(round);
  if (requestId.status !== 'ready') throw new Error('PL: the planresume has no request id');
  return await sendPLSystemRound(world, { line: input.line, round, text: requestId.value,
    followupOf: input.followupOf, ...(input.allowReplay === true ? { allowReplay: true } : {}) });
}

/**
 * The lineage root of one original planning Query, read through the public `queries/read` (the same frozen
 * `sourceMessageRef`/`repliesToMessageRef` the production walk starts from), never hand-made.
 */
export async function readPLPlanResumeRoot(world: S6AHostWorld,
  originalMessageRef: SessionMessageRef): Promise<SessionMessageRef> {
  const refs = interventionPlanningQueryRefs(originalMessageRef);
  const read = (await world.post('queries/read', plain(S6A_SCOPE, refs.queryJobRef))).body as ReadResult<QueryJobRecord>;
  if (read.status !== 'ready') {
    throw new Error(`PL: the original planning Query is not readable: ${JSON.stringify(read)}`);
  }
  const execution = read.value.job.job.intent.execution;
  if (execution.kind !== 'intervention_planning' || execution.sourceMessageRef === undefined) {
    throw new Error('PL: the original planning Query has no executor source');
  }
  return execution.repliesToMessageRef ?? execution.sourceMessageRef;
}

/** One `refine:` to the adviser line, with no `taskRef` (the ruling's world for PL-05). */
export async function sendPLRefine(world: S6AHostWorld, input: {
  goal: GoalRef; line: S6ASession; taskId: string; planRevision: number;
}): Promise<{ requestId: string; messageRef: SessionMessageRef }> {
  const round = plRefineRound(input);
  const requestId = systemRoundRequestId(round);
  if (requestId.status !== 'ready') throw new Error('PL: the refine has no request id');
  return await sendPLSystemRound(world, { line: input.line, round,
    text: `${requestId.value}\nPL refine of ${input.taskId} at plan revision ${String(input.planRevision)}` });
}

/** The `planresume:` round of one original planning Query (the test's replay; production P4 sends it). */
export function plPlanResumeRound(input: {
  goal: GoalRef; originalQueryJobId: string; originalMessageRef: SessionMessageRef;
}): SystemRoundV1 {
  return { kind: 'planresume', goalRef: input.goal, queryJobId: input.originalQueryJobId,
    originalMessageRef: input.originalMessageRef };
}

/** The deterministic `messages/read` result of a system round before it is sent (the caller asserts readiness). */
export async function readSystemRound(world: S6AHostWorld,
  round: SystemRoundV1): Promise<ReadResult<SessionMessage>> {
  const requestId = systemRoundRequestId(round);
  if (requestId.status !== 'ready') throw new Error('PL: the round has no request id');
  const ref = systemRoundMessageRef(S6A_SCOPE, requestId.value);
  if (ref.status !== 'ready') throw new Error('PL: the round has no message ref');
  return (await world.post('messages/read', plain(S6A_SCOPE, ref.value))).body as ReadResult<SessionMessage>;
}

/**
 * The real `send_session_message` step of one sender Work Run: `action_request`, `taskRef` only when asked,
 * `waitAfterSend: true`, the exact `expected` basis read just before, and the real `messages/release` when the
 * mailbox parks it for a person's release. The tool call runs inside the sender's own Run.
 */
export async function sendPLActionWait(world: S6AHostWorld, input: {
  goal: GoalRef; session: S6ASession; sessionTaskId: string; recipient: SessionRef; text: string;
  taskRef?: TaskTriple; label: string;
}): Promise<{ message: SessionMessage; run: RunRef }> {
  const expected = await readS7A2DispatchBasis(world, input.goal);
  await world.scripted.script(input.session, [{ kind: 'calls', calls: [{
    callId: `pl-send-${input.label}`, name: 'send_session_message',
    args: { recipient: input.recipient, text: input.text, intent: 'action_request', needsReply: true,
      waitAfterSend: true, expected, ...(input.taskRef === undefined ? {} : { taskRef: input.taskRef }) },
  }] }]);
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: input.goal, flowId: `pl-send-${input.label}`,
    sessionHint: input.session.ref, kind: 'select_work', taskId: input.sessionTaskId });
  const outbox = ready<{ items: SessionMessage[] }>(await world.post('messages/outbox',
    plain(S6A_SCOPE, { senderSession: input.session.ref, page: { limit: 50 } })), `the ${input.label} outbox`);
  const saved = outbox.items.filter(item => item.sender.kind === 'work_run'
    && item.intent === 'action_request' && item.waitAfterSend === true).at(-1);
  if (saved === undefined) throw new Error(`PL: the ${input.label} action request is not in its outbox`);
  let message = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, saved.ref)),
    `the ${input.label} action request`);
  if (message.release === 'awaiting') message = await approveS7A2Message(world, message, input.label);
  const facts = ready<{ latestWork: { runRef: RunRef } | null }>(
    await world.post('sessions/facts', plain(S6A_SCOPE, input.session.ref)), `the facts of ${input.label}`);
  if (facts.latestWork === null) throw new Error(`PL: the ${input.label} sender has no Work claim`);
  return { message, run: facts.latestWork.runRef };
}

/** One legal v2 `needs_decision` answer with a non-empty question list. */
export function needsDecisionAnswer(summary: string, questions: readonly string[]): string {
  return JSON.stringify({ schemaVersion: 2, kind: 'needs_decision', summary, questions: [...questions] });
}

/** A printable-ASCII answer of exactly `bytes` UTF-8 bytes (the A-10 cards are 14 KiB each). */
export function asciiAnswerText(prefix: string, bytes = 14 * 1024): string {
  const head = `${prefix} `;
  return head + 'x'.repeat(bytes - head.length);
}

/** The `originalQueryRef` line P1's planresume body writes. */
export function originalQueryRefLine(messageRef: SessionMessageRef): string {
  return `originalQueryRef: ${canonicalJson(messageRef as unknown as JsonValue)}`;
}

/**
 * One historical `initial_coordination` planning Query on the same Goal, with no source from the current loop:
 * real `queries/submit` + `queries/claim` + `queries/prepare` + `queries/start`, and the scripted
 * `needs_decision` answer saved by the real start. The Goal must have no active Plan yet (the Query admission
 * requires that), so this is the history the goal-level read must not reject whole (PLS-08/N27).
 */
export async function seedPLHistoryQuestion(world: S6AHostWorld, input: {
  goal: GoalRef; line: S6ASession; label: string; answer: string;
}): Promise<{ queryJobRef: QueryJobRef; queryRunRef: QueryRunRef; answer: QueryJobAnswerSnapshot }> {
  const registration = ready<{ project: { revision: number }; workspace: { revision: number } }>(
    (await world.post('workspaces/registration', plain(S6A_SCOPE, { ...S6A_SCOPE }))).body,
    `the registration for ${input.label}`);
  const goal = ready<{ goal: { revision: number } }>(
    (await world.post('goals/read', plain(S6A_SCOPE, input.goal))).body, `the Goal for ${input.label}`);
  const suffix = `pl-history-${input.label}`;
  const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', ...S6A_SCOPE, queryJobId: `${suffix}-job` };
  const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', ...S6A_SCOPE,
    queryJobId: queryJobRef.queryJobId, runId: `${suffix}-run` };
  const intent = {
    schemaVersion: 1, intentId: queryJobRef.queryJobId, projectId: S6A_SCOPE.projectId,
    workspaceId: S6A_SCOPE.workspaceId, goalId: input.goal.goalId,
    question: `PL A10 historical question ${input.label}`, focusTaskRefs: [], budget: AG2B_QUERY_BUDGET,
    multiTurn: { maxRounds: 1 }, correlationId: `${suffix}-corr`,
    execution: { kind: 'initial_coordination', roleBinding: PL_ADVISER_ROLE_BINDING,
      runtimeBudget: AG2B_RUNTIME_BUDGET },
  };
  committed((await world.post('queries/submit', graphWrite(S6A_SCOPE,
    { queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent }, `${suffix}-submit`, [
      { ref: { aggregateType: 'Project', projectId: S6A_SCOPE.projectId }, revision: registration.project.revision },
      { ref: { aggregateType: 'Workspace', ...S6A_SCOPE }, revision: registration.workspace.revision },
      { ref: input.goal, revision: goal.goal.revision },
      { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 },
    ]))).body, `the historical question ${input.label}`);
  committed(await claimQuery(world, queryJobRef, input.line, null, `${suffix}-claim`),
    `the claim of the historical question ${input.label}`);
  const prepared = await prepareAttempt(world, queryJobRef, `${suffix}-prepare`);
  await world.scripted.script(input.line, [{ kind: 'text', text: input.answer }]);
  const started = ready<{ answer: QueryJobAnswerSnapshot | null }>(
    await start(world, prepared, `${suffix}-start`), `the start of the historical question ${input.label}`);
  if (started.answer === null) throw new Error(`PL: the historical question ${input.label} saved no answer`);
  return { queryJobRef, queryRunRef, answer: started.answer };
}
