/**
 * The one shared world of slice 9's execution review (rulings §5.2; book 1299-1305): G1 wrote it, G3 lands it
 * (lead 11-12: moved to G3 at G1's merge), G5 only reads it. It builds the world through public steps only and
 * asserts nothing.
 *
 * - `openS9ReviewWorld` (`W-exec`, rulings §4.1): a real Host (`openS6AHostWorld`, memory by default), the governance
 *   seed with a completion policy that admits `reviewer`, one Goal with one adopted Plan (`adoptPLPlanDraft`): the
 *   required work Task `s9-work` carries a required `static` requirement (covered by the Host's one registered echo
 *   check) and a required `kind:'reviewer'` requirement `s9-review`; a Work line responsible for the Task; and, unless
 *   `reviewLine: 'none'`, one reviewer line opened only through `role-lines/open({duty:'reviewer'})` (never
 *   `sessions/create`). The reviewer binding and its Query profile are Host input (`lineBinding`, as the PL worlds
 *   give theirs, with the built-in reviewer's read set `read`/`look_graph`/`find_graph`, `host.ts`
 *   `LOCAL_REVIEWER_TOOL_NAMES`), so the Host consumes the line's system rounds. `checks: 'none'` leaves the work
 *   Task without a command requirement (only the review item).
 * - `openS9ReviewRound` (`W-open`): the subject Run runs to its normal end on the public `workflow/advance`, the
 *   command check runs, and the drive stops before the review step (G3's `send_system_round`) and before any
 *   `finalize_checks`, or earlier before `stopBefore`; the unperformed step is returned as `next`.
 * - `openS9ReviewQuery` (`W-open` → the Query of `W-sent`): from that round the drive performs the review send and
 *   stops before any `finalize_checks`; the send names the message, the Host consumes it (a `beforeEnd` runs at the
 *   Query's claim, before the pass that prepares, runs and ends it), and the prepared Query's refs and manifest are
 *   returned. The caller scripts the reviewer line (`world.scripted.script(review.reviewLine,
 *   …)`) before calling it; the fixture never answers, books or finalizes.
 */
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { EvidenceRef } from '../../src/contracts/evidence.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { CompletionPolicyContentV1 } from '../../src/contracts/governance.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { VerificationRoundRef } from '../../src/contracts/verification.js';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import type {
  WorkflowAdvanceInput, WorkflowAdvanceResult, WorkflowStepReceipt,
} from '../../src/business/workflow/contracts.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { advanceUntil, driveWorkflow } from './A2-restart-fixture.js';
import { plain } from './AG2b-collaboration-fixture.js';
import { heartbeatUntil, readPlanningQuery } from './IV-host-fixture.js';
import { lineBinding } from './PL-taskbook-fixture.js';
import { adoptPLPlanDraft } from './PL-workflow-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld, type S6AReply } from './S6A-host-fixture.js';
import {
  OPERATOR, S6A_SCOPE, S6A_WORK_ROLE, type S6ABackend, type S6AExtraBinding, type S6ASession,
} from './S6A-request-fixture.js';
import { createS6BLine, governS6B } from './S6B1-fixture.js';
import { bindingOf, checkConfiguration, claimedRunOf, ready, receiptOf, sessionOf } from './S7A-fixture.js';
import { readS7BMessage } from './S7B-fixture.js';
import type { S7BVWorkProfile } from './S7B-V-fixture.js';
import {
  addS7D2SecondWorkspace, lineOfS7D2, openS7D2Line, type S7D2SecondWorkspace,
} from './S7D2-role-line-world.js';

const REVIEWER_BINDING_ID = 's9-reviewer-binding';
/** The subject Run's answer; G3's P5 finds the subject Run's history by this marker. */
export const S9_HISTORY_MARKER = 's9-history-marker';

export type S9ReviewWorld = {
  readonly world: S6AHostWorld;
  readonly main: S6ACardsWorkspace;
  readonly goal: GoalRef;
  readonly task: TaskTriple;
  readonly workLine: S6ASession;
  /** The reviewer line from `role-lines/open`; `null` for `reviewLine: 'none'`. */
  readonly reviewLine: S6ASession | null;
  close(): Promise<void>;
};

export type S9ReviewRound = {
  readonly roundRef: VerificationRoundRef;
  readonly subjectRunRef: RunRef;
  /** The unperformed step the drive stopped before; `null` when the drive ended on a wait. */
  readonly next: WorkflowAdvanceInput | null;
};

export type S9ReviewQuery = {
  readonly roundRef: VerificationRoundRef;
  readonly subjectRunRef: RunRef;
  readonly messageRef: SessionMessageRef;
  readonly queryJobRef: QueryJobRef;
  readonly queryRunRef: QueryRunRef;
  readonly manifest: PreparedQueryManifestV1;
};

/** One work Task with a required static and a required reviewer requirement, and the required Goal gate. */
export function s9ReviewDraft(goal: GoalRef, checks: 'command' | 'none' = 'command'): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: 's9-review-plan', planRevision: 1, goalId: goal.goalId, stages: [],
    tasks: [
      { taskId: 's9-work', title: 'S9 reviewed work', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 's9-gate', title: 'S9 Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 's9-work', role: S6A_WORK_ROLE.templateId, instruction: 'Do the S9 reviewed work' }],
    obligations: [
      { obligationId: 's9-obligation', title: 'S9 command acceptance', requirementLevel: 'required',
        taskIds: checks === 'none' ? ['s9-gate'] : ['s9-work', 's9-gate'], verificationRequirements: [{
          requirementId: 's9-static', requirementLevel: 'required', kind: 'static',
          description: 'Registered static command check' }] },
      { obligationId: 's9-review-obligation', title: 'S9 independent review', requirementLevel: 'required',
        taskIds: ['s9-work'], verificationRequirements: [{ requirementId: 's9-review',
          requirementLevel: 'required', kind: 'reviewer', description: 'Independent execution review' }] },
    ],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

/** The reviewer line's Host binding and Query profile (built-in reviewer read set); XWR R2 gives it to XWS2A too. */
export function s9ReviewerBinding(): S6AExtraBinding {
  const reviewer = platformRoleProfile('reviewer').template;
  return { ...lineBinding(REVIEWER_BINDING_ID, reviewer, 'S9 reviewer'),
    binding: bindingOf(REVIEWER_BINDING_ID, reviewer, 'S9 reviewer', ['read', 'look_graph', 'find_graph']) };
}

/**
 * G5 (S9 R2/R3): a caller-supplied, public-shape Plan draft for the one adopted Plan. It receives the Goal the world
 * created; `checks` stays the default draft's switch and is not passed here. The draft must keep the `s9-work` Task
 * (the world's `task` and its Work line) so the recipe's one subject Run stays the caller's.
 */
export async function openS9ReviewWorld(options: {
  backend?: S6ABackend; reviewLine?: 'open' | 'none'; checks?: 'command' | 'none';
  draft?: (goal: GoalRef) => PlanRevisionDraft;
} = {}): Promise<S9ReviewWorld> {
  const world = await openS6AHostWorld({ backend: options.backend ?? 'memory',
    extraBindings: [s9ReviewerBinding()],
    extraHostOptions: {
      checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }),
      inputConsumers: [{ scope: S6A_SCOPE, sessionRef: { projectId: S6A_SCOPE.projectId,
        sessionId: `${REVIEWER_BINDING_ID}-consumer` }, goalRef: { aggregateType: 'Goal' as const,
        projectId: S6A_SCOPE.projectId, goalId: `${REVIEWER_BINDING_ID}-consumer` },
      queryProfileId: REVIEWER_BINDING_ID, heartbeatMs: 25 }],
    } });
  try {
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    await world.setResumeOnStartup(false);
    const governance = await governS6B(world, main, world.goals);
    await governance.activatePolicy({ content: REVIEW_REQUIRED_POLICY });
    const goal = world.goals.first;
    await adoptPLPlanDraft(main, goal, options.draft === undefined
      ? s9ReviewDraft(goal, options.checks) : options.draft(goal), 's9-review');
    const task: TaskTriple = { projectId: goal.projectId, goalId: goal.goalId, taskId: 's9-work' };
    const workLine = await sessionOf(world, await createS6BLine(main, { label: 's9-work-line', role: S6A_WORK_ROLE,
      tasks: [task] }));
    const reviewLine = (options.reviewLine ?? 'open') === 'open' ? await openS9ReviewLine(world) : null;
    return { world, main, goal, task, workLine, reviewLine, close: async () => { await world.close(); } };
  } catch (error) {
    await world.close().catch(() => undefined);
    throw error;
  }
}

/** The one reviewer line, only through `role-lines/open({duty:'reviewer'})` (a `'none'` world may open it late). */
export async function openS9ReviewLine(world: S6AHostWorld): Promise<S6ASession> {
  const opened = await openS7D2Line(world, { duty: 'reviewer', scope: [{ kind: 'project' }],
    requestId: 's9-review-line-open' });
  return await lineOfS7D2(world, 's9-review-line', opened.result);
}

/**
 * XWR R3's reviewer line in a second workspace of the project (`addS7D2SecondWorkspace`): the Host catalog's model is
 * selected there (`models/select`, so the Host publishes its built-in reviewer binding and Query profile for that
 * workspace and consumes the line), and the line is a `sessions/create` there (`role-lines/open` opens in the main one).
 * The caller removes `second` after the world closes.
 */
export async function openS9SecondReviewLine(review: S9ReviewWorld, label: string):
Promise<{ second: S7D2SecondWorkspace; line: S6ASession }> {
  const second = await addS7D2SecondWorkspace(review.world, label);
  const snapshot = await review.world.settings('snapshot', {});
  const model = snapshot.status === 'ready' ? snapshot.value.models[0] : undefined;
  if (model === undefined) throw new Error('S9: the Host catalog has no model for the second workspace');
  const selected = await review.world.settings('models/select', { scope: { ...second.scope }, modelId: model.id });
  if (selected.status !== 'ready') throw new Error(`S9: the second workspace model: ${JSON.stringify(selected)}`);
  const created = await createS6BLine(second.workspace, { label: `${label}-review`,
    role: platformRoleProfile('reviewer').template });
  const card = ready<SessionCard>(await second.workspace.route('sessions/read', created.ref), 'S9: the second line');
  return { second, line: { label: created.label, ref: created.ref, aggregateRef: card.record.ref,
    role: structuredClone(card.record.role), createdAt: card.record.createdAt } };
}

/** G3's review step after the command checks, or today's finalize: where the subject drive stops. */
const reviewStep = (op: { kind: string }): boolean => op.kind === 'send_system_round' || op.kind === 'finalize_checks';

export async function openS9ReviewRound(input: { review: S9ReviewWorld; stopBefore?: string }): Promise<S9ReviewRound> {
  const { world, goal, task, workLine } = input.review;
  await world.scripted.script(workLine, [{ kind: 'text', text: `S9 subject work done ${S9_HISTORY_MARKER}` }]);
  const claim = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 's9-review-subject',
    sessionHint: workLine.ref, kind: 'select_work', taskId: task.taskId }, 'claim_task');
  const receipts: WorkflowStepReceipt[] = [];
  const steps = await driveWorkflow(world.ag2b, claim, { receipts,
    stopBefore: op => op.kind === input.stopBefore || reviewStep(op) });
  const opened = receiptOf(receipts, 'open_checks')?.result as { value?: { ref?: VerificationRoundRef } } | undefined;
  if (opened?.value?.ref === undefined) {
    throw new Error(`S9: the subject drive opened no round: ${JSON.stringify(receipts.map(receipt => receipt.kind))}`);
  }
  return { roundRef: opened.value.ref, subjectRunRef: claimedRunOf(receipts, task.taskId).run,
    next: steps.at(-1)?.next ?? null };
}

export async function openS9ReviewQuery(input: {
  review: S9ReviewWorld; round?: S9ReviewRound; beforeEnd?: () => Promise<void> | void;
}): Promise<S9ReviewQuery> {
  const { world } = input.review;
  const round = input.round ?? await openS9ReviewRound({ review: input.review });
  const next = round.next;
  const receipts: WorkflowStepReceipt[] = [];
  // Only G3's send is performed here; today's `finalize_checks` stays unperformed (the fixture never finalizes).
  if (next?.kind === 'perform' && next.operation.kind === 'send_system_round') {
    await driveWorkflow(world.ag2b, next, { stopBefore: 'finalize_checks', receipts });
  }
  const sent = receiptOf(receipts, 'send_system_round')?.result as
    { status?: string; value?: { ref?: SessionMessageRef } } | undefined;
  const messageRef = sent?.value?.ref;
  if (messageRef === undefined) {
    throw new Error(`S9: the drive after the command checks sent no exec review round; the next step is ${
      next?.kind === 'perform' ? next.operation.kind : JSON.stringify(next)}`);
  }
  // The Host creates the Query in one pass, claims it in the next, and prepares, runs and ends it in one more: a
  // row's `beforeEnd` runs at the claim, the last point where the Query is taken but not ended.
  if (input.beforeEnd !== undefined) {
    const claimed = await heartbeatUntil(world, () => readPlanningQuery(world, messageRef),
      value => (value?.run.run.executionState ?? null) !== null, 32);
    if (claimed?.run.run.executionState?.phase !== 'claimed') {
      throw new Error(`S9: the review Query of ${messageRef.messageId} was not seen at its claim`);
    }
    await input.beforeEnd();
  }
  const record = await heartbeatUntil(world, () => readPlanningQuery(world, messageRef),
    value => value?.run.run.executionState?.prepared !== null && value?.run.run.executionState?.prepared !== undefined,
    32);
  const prepared = record?.run.run.executionState?.prepared;
  if (record === null || prepared === null || prepared === undefined) {
    throw new Error(`S9: the Host did not prepare the review Query of ${messageRef.messageId}`);
  }
  const bundle = ready<{ body: string }>((await world.post('materials/open', plain(S6A_SCOPE, {
    ref: prepared.bundleRef, usage: 'historical_explanation' }))).body, 'S9: the review Query manifest');
  return { roundRef: round.roundRef, subjectRunRef: round.subjectRunRef, messageRef, queryJobRef: record.job.ref,
    queryRunRef: record.run.ref, manifest: JSON.parse(bundle.body) as PreparedQueryManifestV1 };
}

/** One public `workflow/advance`; without `input`, the subject Task's `select_work` of the subject drive's flow. */
export async function advanceS9Review(review: S9ReviewWorld, input?: WorkflowAdvanceInput): Promise<WorkflowAdvanceResult> {
  return (await review.world.post('workflow/advance', plain(S6A_SCOPE, input ?? { schemaVersion: 1, goalRef: review.goal,
    flowId: 's9-review-subject', sessionHint: review.workLine.ref, kind: 'select_work', taskId: review.task.taskId,
  }))).body as WorkflowAdvanceResult;
}

/** The reviewer's reply: a verdict through the real `submit_exec_review`, `'none'` (text, no verdict), or own replies. */
export type S9ReviewReply = 'pass' | 'fix' | 'none' | readonly S6AReply[];

/**
 * `W-sent`: scripts the reviewer line, sends the review Query and runs `beforeEnd` (a row's observation or armed
 * fault) at its claim, before it ends (`openS9ReviewQuery`), then runs Host passes until the Query has ended and,
 * unless `settle: false`, until the Host has closed the source message (reply or withdraw).
 */
export async function answerS9Review(review: S9ReviewWorld, reply: S9ReviewReply, options: {
  round?: S9ReviewRound; beforeEnd?: () => Promise<void> | void; settle?: false;
} = {}): Promise<S9ReviewQuery> {
  const { world, reviewLine } = review;
  if (reviewLine === null) throw new Error('S9: the world has no reviewer line');
  await world.scripted.script(reviewLine, typeof reply !== 'string' ? reply : reply === 'none'
    ? [{ kind: 'text', text: 'S9 review without a verdict' }]
    : [{ kind: 'calls', calls: [{ callId: `s9-review-${reply}`, name: 'submit_exec_review',
      args: { verdict: reply, basis: `S9 ${reply} basis`, report: `S9 ${reply} report` } }] }]);
  const query = await openS9ReviewQuery({ review, ...(options.round === undefined ? {} : { round: options.round }),
    ...(options.beforeEnd === undefined ? {} : { beforeEnd: options.beforeEnd }) });
  const ended = (value: Awaited<ReturnType<typeof readPlanningQuery>>): boolean => value?.job.job.status === 'answered'
    || value?.run.run.status === 'closed' || value?.run.run.executionState?.phase === 'settled';
  if (!ended(await heartbeatUntil(world, () => readPlanningQuery(world, query.messageRef), ended, 16))) {
    throw new Error(`S9: the review Query of ${query.messageRef.messageId} did not end`);
  }
  if (options.settle !== false) {
    const source = await heartbeatUntil(world, () => readS7BMessage(world, query.messageRef),
      message => message.response !== null || message.withdrawnAt !== null, 16);
    if (source.response === null && source.withdrawnAt === null) {
      throw new Error(`S9: the Host did not close the review message ${query.messageRef.messageId}`);
    }
  }
  return query;
}

/** `W-booked`: the platform's one public `recordReviewEvidence` (the round executor is the Host's HTTP actor). */
export async function bookS9Review(review: S9ReviewWorld, roundRef: VerificationRoundRef,
  requestId = 's9-review-book'): Promise<EvidenceRef> {
  const book = review.world.platform.evidence.recordReviewEvidence;
  if (book === undefined) throw new Error('S9: the public evidence object has no recordReviewEvidence (G3 wiring)');
  const booked = await book(review.world.humanContext(), { input: { roundRef }, meta: { requestId, expected: [] } });
  if (booked.status !== 'committed') throw new Error(`S9: the review was not booked: ${JSON.stringify(booked)}`);
  return booked.value.evidenceRef;
}

/** The public `finalizeChecks` at the round's current revision; `reviewerEvidence` absent is the omitted member. */
export async function finalizeS9Review(review: S9ReviewWorld, roundRef: VerificationRoundRef, requestId: string,
  reviewerEvidence?: readonly EvidenceRef[]) {
  const { evidence } = review.world.platform;
  const ctx = review.world.humanContext();
  const round = await evidence.readVerification(ctx, roundRef);
  if (round.status !== 'ready') throw new Error(`S9: the round is not readable: ${JSON.stringify(round)}`);
  return await evidence.finalizeChecks(ctx, { input: { roundRef,
    ...(reviewerEvidence === undefined ? {} : { reviewerEvidence: [...reviewerEvidence] }) },
  meta: { requestId, expected: [{ ref: roundRef, revision: round.value.revision }] } });
}

/** The public `goals.completeTask` of the subject Task on its round (pins: the Goal, the absent TaskReduction). */
export async function completeS9Task(review: S9ReviewWorld, roundRef: VerificationRoundRef, requestId: string) {
  const goal = ready<{ goal: { revision: number } }>((await review.world.post('goals/read',
    plain(S6A_SCOPE, review.goal))).body, 'S9: the Goal');
  const plan = await review.main.activePlan(review.goal);
  if (plan === null) throw new Error('S9: the Goal has no adopted Plan');
  return await review.world.platform.goals.completeTask(review.world.humanContext(), {
    input: { taskRef: review.task, planRef: plan.ref, roundRef },
    meta: { requestId, expected: [{ ref: review.goal, revision: goal.goal.revision },
      { ref: { aggregateType: 'TaskReduction' as const, ...review.task }, revision: 0 }] } });
}

export type S9ToolResult = { status: string; error?: { code: string }; output?: { kind: string; value?: unknown }[] };

/** The tool result the reviewer line's model was served for `callId` (read off the model requests). */
export async function s9ToolResult(review: S9ReviewWorld, callId: string): Promise<S9ToolResult> {
  for (const request of await review.world.scripted.requests(review.reviewLine!)) {
    const message = request.messages.find(candidate => candidate.role === 'tool' && candidate.callId === callId);
    if (message !== undefined && message.role === 'tool') return message.result as unknown as S9ToolResult;
  }
  throw new Error(`S9: no reviewer model request carries the tool result ${callId}`);
}

/** The reviewer Query profile's four intervention members (the Host passes the same for the line). */
export function s9ReviewerProfile(): S7BVWorkProfile {
  const profile = lineBinding(REVIEWER_BINDING_ID, platformRoleProfile('reviewer').template, 'S9 reviewer').queryProfile;
  if (profile === undefined) throw new Error('S9: the reviewer binding has no Query profile');
  return { roleBinding: profile.roleBinding, runtimeBudget: profile.runtimeBudget, budget: profile.budget,
    consumerId: profile.consumerId };
}

/** The completion policy that admits the required independent-review kind (S9's worlds and E3P's P10-1). */
export const REVIEW_REQUIRED_POLICY: CompletionPolicyContentV1 = {
  schemaVersion: 1, requirementKinds: ['static', 'reviewer'], minimumRequiredRequirementsPerObligation: 1,
};
