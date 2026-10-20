/**
 * Slice 5 scenario support (SPEC §5.4 SC01/SC02, §6.3 F74) shared by
 * `tests/scenarios/S5-two-request-decisions.test.ts` and
 * `tests/scenarios/S5-goal-conflict-rework.test.ts`.
 *
 * It is built on the real scenario harness (`../harness.ts`: `openPlatformScenario`,
 * `openHostScenario`) and the real SQLite composition/Host. It only uses real
 * owner ports and real codecs to build a possible world; it never writes a
 * fabricated MessageDecision / PASS and never touches the harness.
 *
 * A9: the harness's seeded scope and Goal stay Goal A; Q1/Q2 are two real root
 * QueryJobs on that same Goal. Every source is built from the canonical
 * `decisionSourceKey` identity and every annotation object key comes from
 * `canonicalJson(object)` — never a hand-written literal.
 *
 * Part 1 leaves the slice-5 owners and read model as stubs, so each
 * scenario stops at the first stubbed entry with its `not implemented:` throw.
 */
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { artifactBodyDigest } from '../../../src/contracts/artifact.js';
import type { RunRef } from '../../../src/contracts/dispatch.js';
import type { TaskEnvelopeV1 } from '../../../src/contracts/task-envelope.js';
import { createSqliteRecordBackend } from '../../../src/core/record-store/sqlite-record-store.js';
import { createSqliteRawArtifactStore } from '../../../src/core/record-store/sqlite-body-store.js';
import { createRoleConfigurationService } from '../../../src/core/work-graph/configuration/role-memory-service.js';
import type { AuthorizeConfiguration, KernelExecutionBinding } from '../../../src/core/work-graph/model/execution-entry-contracts.js';
import { createExecutionEntryService } from '../../../src/core/work-graph/tasks/execution-entry-service.js';
import { createRunStateReader } from '../../../src/core/work-graph/tasks/run-state-service.js';
import { createTaskRequeueService } from '../../../src/core/work-graph/tasks/requeue-service.js';
import { plainSessionRefToAggregate } from '../../../src/core/work-graph/sessions/session-record-codecs.js';
import { VerificationWorkspaceReader } from '../../../src/core/workspace/verification-workspace-reader.js';
import { decodePlanRevisionAcceptedEvent } from '../../../src/core/work-graph/persistence/plan-record-codecs.js';
import type { EncodedDomainEvent } from '../../../src/core/record-store/ports.js';
import { platformRecordSchemas } from '../../state/invariants.js';
import type { HostScenario, Platform, PlatformScenario } from '../harness.js';
import { hostCtx, readSqlite, workRunCtx, ag2bWorkspaceBindings } from '../harness.js';
import type { CommitCursor } from '../../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../../src/contracts/core/call-context.js';
import type { ModuleRef, VersionPin, WorkspaceScope } from '../../../src/contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../../src/contracts/core/results.js';
import type { SessionMessageRef } from '../../../src/contracts/core/session-message.js';
import { canonicalJson, type JsonValue } from '../../../src/contracts/fingerprint.js';
import {
  decisionSourceKey, type DecisionAnnotationV1, type DecisionObjectV1, type DecisionSelectionV1,
  type DecisionSourceV1, type NoticeCategoryV1, type NoticePositionV1,
} from '../../../src/contracts/goal-decisions.js';
import type { GoalRef } from '../../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../../../src/contracts/plan.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../../src/contracts/query-job.js';
import type { PlanProposal } from '../../../src/core/work-graph/model/plan-contracts.js';
import type { GraphWrite } from '../../../src/core/work-graph/model/task-contracts.js';
import type { SubmitQueryJobInput } from '../../../src/core/work-graph/queries/contracts.js';
import type { ScriptedReply } from '../../helpers/B2-runtime-fixture.js';
import { AG2B_GOAL_REF, AG2B_QUERY_ROLE_BINDING, AG2B_RUNTIME_BUDGET, AG2B_SCOPE, AG2B_WORK_TASK_ID,
  AG2B_WORK_ROLE, AG2B_WORK_ROLE_BINDING, ag2bPlanDraft, permissionRevision } from '../../helpers/AG2b-collaboration-fixture.js';
import { draftFrom } from './common.js';
import { preparationHost, prepareTaskForReal } from '../../helpers/task-claim-fixture.js';

/**
 * SC02's three business Runs. Run 2 really writes a new source basis before
 * the second requeue; an unchanged read-only retry would hit no_new_basis.
 * The auxiliary Agent admission below makes no model call.
 */
export const S5_SC02_REPLIES: readonly ScriptedReply[] = [1, 2, 3].flatMap(n => [
  { kind: 'calls' as const, calls: [n === 2
    ? { callId: 's5-new-basis', name: 'edit', args: { mode: 'create', path: 'src/s5-rework-basis.ts',
      newText: 'export const s5ReworkBasis = 2;\n' } }
    : { callId: `s5-run-${n}-read`, name: 'read', args: { path: 'src/module.ts' } }] },
  { kind: 'text' as const, text: `S5 automatic run ${n}` },
]);

// ---------------------------------------------------------------------------
// Frozen SC01/SC02 identities (code-built refs, never bare strings)
// ---------------------------------------------------------------------------

export const S5_SCOPE: WorkspaceScope = { projectId: AG2B_SCOPE.projectId, workspaceId: AG2B_SCOPE.workspaceId };
export const S5_OPERATOR = { kind: 'human' as const, id: 'operator' };
/** Goal A of both scenarios: the harness's already seeded AG2b Goal. */
export const S5_GOAL_A: GoalRef = { ...AG2B_GOAL_REF };
/** Goal B of SC02, created through the real `goals.createGoal` owner. */
export const S5_GOAL_B: GoalRef = { aggregateType: 'Goal', projectId: S5_SCOPE.projectId, goalId: 's5-goal-b' };
/** Module M of the frozen fixture: the AG2b adopted catalog module (`src`). */
export const S5_MODULE_M: ModuleRef = { projectId: S5_SCOPE.projectId, moduleId: 'ag2b-work' };
/** File `fm` the annotation names. */
export const S5_FILE_FM = 'src/m/a.ts';

export const S5_Q1: QueryJobRef = { aggregateType: 'QueryJob', ...S5_SCOPE, queryJobId: 's5-q1' };
export const S5_Q2: QueryJobRef = { aggregateType: 'QueryJob', ...S5_SCOPE, queryJobId: 's5-q2' };
export const s5QueryRun = (queryJobId: string, runId: string): QueryRunRef =>
  ({ aggregateType: 'QueryRun', ...S5_SCOPE, queryJobId, runId });

export const S5_WORK_TASK_A = AG2B_WORK_TASK_ID;
/** Auxiliary Task of Goal A, admitted through the owners with a requeue_task grant. */
export const S5_WORK_TASK_A2 = 's5-a-work-2';
export const S5_WORK_TASK_B = 's5-b-work';
const S5_STAGE = 's5-stage-m';

/** The unchanged free text and annotation body the user stores (SPEC §2.3). */
export const S5_ANSWER_TEXT = 'Q2: adopt the second option and fix fm first\n';
export const S5_ANNOTATION_TEXT = '先处理这里';

// ---------------------------------------------------------------------------
// Canonical sources, card keys, objects and receipts (A9, SPEC §3.3 line 629)
// ---------------------------------------------------------------------------

/**
 * Natural identity only. The scenario obtains the complete source (including
 * pins and Goal bases) from the real queue/card reader.
 */
export function s5CandidateKey(goalRef: GoalRef, requestRef: QueryJobRef): string {
  return decisionSourceKey({ kind: 'candidate', goalRef, requestRef });
}

/**
 * Conflict identity only: the unordered Goal pair and both active pointers.
 * CAS pins and the complete source always come from the real conflict reader.
 */
export function s5ConflictKey(plans: readonly [
  { goalRef: GoalRef; planRef: PlanRevisionRef | null },
  { goalRef: GoalRef; planRef: PlanRevisionRef | null },
]): string {
  const [left, right] = plans;
  return decisionSourceKey({ kind: 'goal_conflict', pair: [
    { goalRef: left.goalRef, activePlanRef: left.planRef },
    { goalRef: right.goalRef, activePlanRef: right.planRef },
  ] });
}

/** One annotation whose object key is `canonicalJson(object)` (SPEC §2.3 line 221), never a literal. */
export function s5Annotation(object: DecisionObjectV1, text: string): DecisionAnnotationV1 {
  return { objectKey: canonicalJson(object as JsonValue), text };
}

/** The card object a scenario annotates: the listed `fm` file when present, else the first object. */
export function s5AnnotatedObject(objects: readonly DecisionObjectV1[]): DecisionObjectV1 {
  const file = objects.find(object => object.kind === 'file' && object.path === S5_FILE_FM);
  const object = file ?? objects[0];
  if (object === undefined) throw new Error('the card lists no object to annotate');
  return object;
}

/**
 * The real identity/fingerprint of one formal commit, read from the ledger's own
 * idempotency row at `cursor` (the `DecisionApplicationReceiptV1` identity).
 */
export function s5CommitReceipt(database: string, cursor: CommitCursor):
  { identityKey: string; fingerprint: string; cursor: CommitCursor } {
  const row = readSqlite(join(database, 'ledger.sqlite'), ledger => ledger
    .prepare('SELECT identity_key, fingerprint FROM idempotency WHERE commit_cursor = ?')
    .get(cursor) as { identity_key: string; fingerprint: string } | undefined, undefined);
  if (row === undefined) throw new Error(`no formal commit receipt is stored at cursor ${cursor}`);
  return { identityKey: row.identity_key, fingerprint: row.fingerprint, cursor };
}

/** Full persisted values, not wrapper call counts: catches same-count rewrites too. */
export function s5StoreSnapshot(ledgerPath: string) {
  const snapshot = readSqlite(ledgerPath, ledger => ({
    records: ledger.prepare('SELECT ref_key, snapshot_json FROM snapshots ORDER BY ref_key').all(),
    events: ledger.prepare('SELECT id, event_json FROM events ORDER BY id').all(),
    claims: ledger.prepare('SELECT claim_key, owner_key FROM identity_claims ORDER BY claim_key').all(),
    receipts: ledger.prepare('SELECT * FROM idempotency ORDER BY identity_key').all(),
  }), null);
  if (snapshot === null) throw new Error(`the observed ledger does not exist: ${ledgerPath}`);
  return snapshot;
}

/** Decode the actual formal events, so Q1/setup accepts cannot count as Q2's change. */
export function s5PlanAcceptances(database: string) {
  return readSqlite(join(database, 'ledger.sqlite'), ledger => ledger
    .prepare("SELECT event_json FROM events WHERE json_extract(event_json, '$.eventType') = 'PlanRevisionAccepted' ORDER BY id")
    .all().map(row => {
      if (typeof row.event_json !== 'string') throw new Error('invalid stored plan event');
      const body = JSON.parse(row.event_json) as { eventId: string; occurredAt: string; schemaVersion: number };
      const encoded: EncodedDomainEvent = { eventId: body.eventId, occurredAt: body.occurredAt,
        eventType: 'PlanRevisionAccepted', schemaVersion: body.schemaVersion, json: row.event_json };
      const decoded = decodePlanRevisionAcceptedEvent(encoded);
      if (decoded.status !== 'decoded') throw new Error(`invalid plan event: ${decoded.reason}`);
      return decoded.value;
    }), []);
}

const S5_PLAIN_SELECTION: DecisionSelectionV1 = { kind: 'other' };

type DraftV2 = Extract<PlanRevisionDraft, { schemaVersion: 2 }>;

// ---------------------------------------------------------------------------
// Real reads, pins and writes shared by both scenarios
// ---------------------------------------------------------------------------

function mustReady<T>(label: string, result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`${label}: ${JSON.stringify(result)}`);
  return result.value;
}

function mustCommit<T>(label: string, result: WriteResult<T>): T {
  if (result.status !== 'committed') throw new Error(`${label}: ${JSON.stringify(result)}`);
  return result.value;
}

/** The real Project/Workspace and Goal pins of `goalRef`, read from the owners. */
export async function s5Pins(platform: Platform, ctx: CoreCallContext,
  goalRef: GoalRef): Promise<{ project: VersionPin; workspace: VersionPin; goal: VersionPin }> {
  const registration = mustReady('S5 workspace registration read',
    await platform.projects.readWorkspaceRegistration(ctx, S5_SCOPE));
  const goal = mustReady('S5 Goal read', await platform.plans.queryGoal(ctx, goalRef));
  return {
    project: { ref: registration.project.ref, revision: registration.project.revision },
    workspace: { ref: registration.workspace.ref, revision: registration.workspace.revision },
    goal: { ref: goal.goal.ref, revision: goal.goal.revision },
  };
}

/** The current Goal pin (SPEC §3.3 line 625: settings/reorder/abandon pin the Goal). */
export async function s5GoalPin(platform: Platform, ctx: CoreCallContext, goalRef: GoalRef): Promise<VersionPin> {
  const goal = mustReady('S5 Goal read', await platform.plans.queryGoal(ctx, goalRef));
  return { ref: goal.goal.ref, revision: goal.goal.revision };
}

/** The full Goal list's current pins (SPEC §3.3 line 625: reorder pins every Goal). */
export async function s5GoalPins(platform: Platform, ctx: CoreCallContext,
  goalRefs: readonly GoalRef[]): Promise<VersionPin[]> {
  return Promise.all(goalRefs.map(goalRef => s5GoalPin(platform, ctx, goalRef)));
}

/** One real root QueryJob submission on `goalRef` (a complete QueryJobRef on commit). */
export async function submitRootQuery(platform: Platform, ctx: CoreCallContext,
  input: { goalRef: GoalRef; queryJobId: string; runId: string; question: string }): Promise<QueryJobRef> {
  const pins = await s5Pins(platform, ctx, input.goalRef);
  const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', ...S5_SCOPE, queryJobId: input.queryJobId };
  const queryRunRef = s5QueryRun(input.queryJobId, input.runId);
  const intent: QueryJobIntentV1 = {
    schemaVersion: 1, intentId: input.queryJobId, projectId: S5_SCOPE.projectId, workspaceId: S5_SCOPE.workspaceId,
    goalId: input.goalRef.goalId, question: input.question, focusTaskRefs: [],
    budget: { maxTokens: null, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: `s5-${input.queryJobId}`,
    execution: { kind: 'semantic_query', roleBinding: AG2B_QUERY_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET },
  };
  const request: GraphWrite<SubmitQueryJobInput> = {
    input: { queryJobId: input.queryJobId, runId: input.runId, intent },
    meta: { requestId: `s5-submit-${input.queryJobId}`,
      expected: [pins.project, pins.workspace, pins.goal, { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }] },
  };
  mustCommit('S5 query submit', await platform.queries.submitQueryJob(ctx, request));
  return queryJobRef;
}

/** The Goal's real active Plan snapshot. */
export async function readActivePlan(platform: Platform, ctx: CoreCallContext, goalRef: GoalRef): Promise<PlanRevisionSnapshot> {
  const graph = mustReady('S5 task graph read', await platform.plans.queryTaskGraph(ctx, { goalRef }));
  return graph.plan;
}

/**
 * The valid v2 draft of the harness seed (`ag2bPlanDraft`: work Task(s) plus the
 * required active gate), with the named work Task narrowed to module M and a
 * matching stage. The gate and obligation stay byte-identical to the seed, so
 * the real plan compiler accepts it.
 */
export function s5ModulePlanDraft(planId: string, planRevision: number, goalRef: GoalRef,
  taskId: string, moduleRef: ModuleRef): PlanRevisionDraft {
  const base = ag2bPlanDraft([taskId]);
  return {
    ...base, planId, planRevision, goalId: goalRef.goalId,
    stages: [{ stageId: S5_STAGE, title: 'S5 module M stage' }],
    tasks: base.tasks.map(task => task.taskId === taskId
      ? { ...task, scope: { kind: 'module' as const, stageId: S5_STAGE, moduleRef: moduleRef.moduleId } }
      : task),
  };
}

/** A copy of the active Plan (`draftFrom`) whose named work Task is scoped to module M. */
export function s5ModuleDraftFrom(plan: PlanRevisionSnapshot, planId: string, taskId: string, moduleRef: ModuleRef): DraftV2 {
  return draftFrom(plan, planId, draft => ({
    ...draft,
    stages: draft.stages.some(stage => stage.stageId === S5_STAGE)
      ? draft.stages : [...draft.stages, { stageId: S5_STAGE, title: 'S5 module M stage' }],
    tasks: draft.tasks.map(task => task.taskId === taskId
      ? { ...task, scope: { kind: 'module' as const, stageId: S5_STAGE, moduleRef: moduleRef.moduleId } }
      : task),
  }));
}

/**
 * One real candidate proposal with the Goal pin (the request slot itself is the
 * owner's job in part 2). `replaces` is the legitimate replacement path of
 * SPEC §2.4: it names the same request's current head revision.
 */
export async function proposeCandidate(platform: Platform, ctx: CoreCallContext,
  input: { goalRef: GoalRef; basedOn: PlanRevisionSnapshot['ref'] | null; draft: PlanRevisionDraft;
    requestRef: QueryJobRef | null; replaces?: { proposalRef: PlanProposal['ref']; revision: number } | null;
    requestId: string }): Promise<PlanProposal> {
  const goalPin = await s5GoalPin(platform, ctx, input.goalRef);
  return mustCommit('S5 plan propose', await platform.plans.proposePlan(ctx, {
    input: { goalRef: input.goalRef, basedOn: input.basedOn, draft: input.draft, requestRef: input.requestRef,
      ...(input.replaces === undefined || input.replaces === null ? {} : { replaces: input.replaces }),
      reason: { text: `S5 candidate for ${input.requestId}`, sources: [] } },
    meta: { requestId: input.requestId, expected: [goalPin] },
  }));
}

/** One real `plans/apply` write, with the optional acknowledgement attribution. */
export function applyCandidate(platform: Platform, ctx: CoreCallContext, proposal: PlanProposal, options: {
  requestId: string; acknowledgementRef?: SessionMessageRef; expected?: VersionPin[];
  /** [lead S5-T3-D8] the answer's response.decision.source: proof data for the acceptance event only. */
  decisionSource?: DecisionSourceV1;
}): ReturnType<Platform['plans']['applyPlanChange']> {
  return platform.plans.applyPlanChange(ctx, {
    input: { proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [],
      ...(options.acknowledgementRef === undefined ? {} : { acknowledgementRef: options.acknowledgementRef }),
      ...(options.decisionSource === undefined ? {} : { decisionSource: options.decisionSource }) },
    meta: { requestId: options.requestId, expected: options.expected ?? [] },
  });
}

/** The real adoption of one candidate (SC01's "adopt Q1"). */
export async function adoptCandidate(platform: Platform, ctx: CoreCallContext, proposal: PlanProposal): Promise<PlanRevisionSnapshot> {
  return mustCommit('S5 plan apply', await applyCandidate(platform, ctx, proposal,
    { requestId: `s5-apply-${proposal.ref.proposalId}` }));
}

/** One real Goal creation (SC02's second goal). */
export async function createGoal(platform: Platform, ctx: CoreCallContext,
  input: { goalRef: GoalRef; objective: string; requestId: string }): Promise<void> {
  const pins = await s5Pins(platform, ctx, S5_GOAL_A);
  mustCommit('S5 goal create', await platform.goals.createGoal(ctx, {
    input: { goalId: input.goalRef.goalId, workspace: S5_SCOPE, objective: input.objective },
    meta: { requestId: input.requestId, expected: [pins.project, pins.workspace] },
  }));
}

/** `goals/control` (decision 29): the Goal and its GoalPhase pins are read first. */
export async function controlGoal(platform: Platform, ctx: CoreCallContext, input: {
  goalRef: GoalRef; control: 'pause' | 'resume' | 'cancel'; requestId: string;
}): ReturnType<Platform['goals']['setGoalControl']> {
  const goal = mustReady('S5 Goal read', await platform.plans.queryGoal(ctx, input.goalRef));
  const graph = mustReady('S5 task graph read', await platform.plans.queryTaskGraph(ctx, { goalRef: input.goalRef }));
  const phaseRevision = graph.completion?.status === 'recorded' ? graph.completion.snapshot.revision : 0;
  return platform.goals.setGoalControl(ctx, {
    input: { goalRef: input.goalRef, control: input.control, reason: `operator ${input.control}` },
    meta: { requestId: input.requestId, expected: [
      { ref: input.goalRef, revision: goal.goal.revision },
      { ref: { aggregateType: 'GoalPhase', projectId: input.goalRef.projectId, goalId: input.goalRef.goalId },
        revision: phaseRevision },
    ] },
  });
}

// ---------------------------------------------------------------------------
// SC01: platform world and stub entries
// ---------------------------------------------------------------------------

export type TwoRequestWorld = {
  platform: Platform;
  ctx: CoreCallContext;
  queries: { Q1: QueryJobRef; Q2: QueryJobRef };
  candidates: { U1: PlanProposal; U2: PlanProposal };
};

/**
 * SC01 setup: two real root QueryJobs Q1/Q2 on the harness Goal A producing two
 * real candidate proposals U1/U2 through `plans.proposePlan` with their
 * `requestRef`. Nothing is fabricated and no model is called.
 */
export async function seedTwoRequestWorld(h: PlatformScenario): Promise<TwoRequestWorld> {
  const platform = h.platform;
  const ctx = h.ctx();
  const before = await readActivePlan(platform, ctx, S5_GOAL_A);
  const Q1 = await submitRootQuery(platform, ctx, { goalRef: S5_GOAL_A, queryJobId: S5_Q1.queryJobId,
    runId: 's5-q1-run', question: 'What is the first question?' });
  const Q2 = await submitRootQuery(platform, ctx, { goalRef: S5_GOAL_A, queryJobId: S5_Q2.queryJobId,
    runId: 's5-q2-run', question: 'What is the second question?' });
  const U1 = await proposeCandidate(platform, ctx, { goalRef: S5_GOAL_A, basedOn: before.ref,
    draft: draftFrom(before, 's5-q1-plan'), requestRef: Q1, requestId: 's5-propose-q1' });
  const U2 = await proposeCandidate(platform, ctx, { goalRef: S5_GOAL_A, basedOn: before.ref,
    draft: draftFrom(before, 's5-q2-plan'), requestRef: Q2, requestId: 's5-propose-q2' });
  return { platform, ctx, queries: { Q1, Q2 }, candidates: { U1, U2 } };
}

/** `plans/request-candidate`: Q2's stale candidate card (candidate@1 until abandon/replace). */
export function readRequestCandidate(platform: Platform, ctx: CoreCallContext, goalRef: GoalRef,
  requestRef: QueryJobRef): ReturnType<Platform['requestCandidates']['readRequestCandidate']> {
  return platform.requestCandidates.readRequestCandidate(ctx, { goalRef, requestRef });
}

/** `decisions/answer`: the finite Workflow coordination entry (free text + annotations). */
export function answerDecision(platform: Platform, ctx: CoreCallContext, input: {
  source: DecisionSourceV1; selection?: DecisionSelectionV1; text: string; annotations: readonly DecisionAnnotationV1[];
  requestId: string;
}): ReturnType<NonNullable<Platform['workflow']['resolveDecision']>> {
  const resolve = platform.workflow.resolveDecision;
  if (resolve === undefined) throw new Error('the composition publishes no finite decision coordinator (resolveDecision)');
  return resolve(ctx, {
    input: { source: input.source, selection: input.selection ?? S5_PLAIN_SELECTION,
      text: input.text, annotations: [...input.annotations] },
    // SPEC §3.3 line 625: a non-message answer pins exactly the captured source pins.
    meta: { requestId: input.requestId, expected: [...input.source.pins] },
  });
}

type DecisionQueueInput = Parameters<Platform['decisions']['queryDecisionQueue']>[1];

/** `decisions/queue`: the read-only card/notice queue (one category, first page, for SC02). */
export function queryDecisionQueue(platform: Platform, ctx: CoreCallContext, input: {
  sections: DecisionQueueInput['sections']; goalRef?: GoalRef; categories?: DecisionQueueInput['categories'];
  page?: DecisionQueueInput['page'];
}): ReturnType<Platform['decisions']['queryDecisionQueue']> {
  return platform.decisions.queryDecisionQueue(ctx, {
    workspace: S5_SCOPE,
    ...(input.goalRef === undefined ? {} : { goalRef: input.goalRef }),
    sections: input.sections,
    ...(input.categories === undefined ? {} : { categories: input.categories }),
    page: input.page ?? { limit: 20 },
  });
}

/** `decisions/card`: one card by its canonical source. */
export function readDecisionCard(platform: Platform, ctx: CoreCallContext,
  source: DecisionSourceV1): ReturnType<Platform['decisions']['readDecisionCard']> {
  return platform.decisions.readDecisionCard(ctx, { source });
}

/** `decisionMessages.readDecisionAnswer`: the original body/selection/annotations, read-only. */
export function readDecisionAnswer(platform: Platform, ctx: CoreCallContext,
  source: DecisionSourceV1): ReturnType<Platform['decisionMessages']['readDecisionAnswer']> {
  return platform.decisionMessages.readDecisionAnswer(ctx, { source });
}

/** `decisions/application`: record the missed application after the restart. */
export function recordDecisionApplication(platform: Platform, ctx: CoreCallContext, input: {
  message: { ref: SessionMessageRef; revision: number };
  receipt: Parameters<Platform['decisionMessages']['recordDecisionApplication']>[1]['input']['receipt'];
}): ReturnType<Platform['decisionMessages']['recordDecisionApplication']> {
  return platform.decisionMessages.recordDecisionApplication(ctx, {
    input: { messageRef: input.message.ref, receipt: input.receipt },
    // SPEC §3.3 line 625: the application pins exactly the original message version.
    meta: { requestId: `s5-application-${input.message.ref.messageId}`,
      expected: [{ ref: input.message.ref, revision: input.message.revision }] },
  });
}

/** `decisions/notices/seen`: the Workspace pin of SPEC §3.3 line 625. */
export async function markNoticesSeen(platform: Platform, ctx: CoreCallContext, input: {
  displayToken: string; seenThrough: Partial<Record<NoticeCategoryV1, NoticePositionV1>>; requestId?: string;
}): ReturnType<Platform['workspaceDecisionSettings']['markNoticesSeen']> {
  const registration = mustReady('S5 workspace registration read',
    await platform.projects.readWorkspaceRegistration(ctx, S5_SCOPE));
  return platform.workspaceDecisionSettings.markNoticesSeen(ctx, {
    input: { workspace: S5_SCOPE, displayToken: input.displayToken, seenThrough: input.seenThrough },
    meta: { requestId: input.requestId ?? 's5-notices-seen',
      expected: [{ ref: registration.workspace.ref, revision: registration.workspace.revision }] },
  });
}

// ---------------------------------------------------------------------------
// SC02: host world and stub entries
// ---------------------------------------------------------------------------

export type ConflictWorld = { platform: Platform; ctx: CoreCallContext; goals: { A: GoalRef; B: GoalRef } };

/**
 * SC02 setup: the harness Goal A gets a new active Plan whose work Task is
 * scoped to module M; Goal B is created and gets the same shape. Both plans are
 * real `plans.proposePlan`/`plans.applyPlanChange` writes on the Host's files.
 */
export async function seedConflictWorld(h: HostScenario): Promise<ConflictWorld> {
  const platform = await h.direct();
  const ctx = hostCtx(h.stepActor());
  await createGoal(platform, ctx, { goalRef: S5_GOAL_B, objective: 'Deliver Goal B in module M', requestId: 's5-create-goal-b' });

  const planA = await readActivePlan(platform, ctx, S5_GOAL_A);
  const uA = await proposeCandidate(platform, ctx, { goalRef: S5_GOAL_A, basedOn: planA.ref,
    draft: s5ModuleDraftFrom(planA, 's5-plan-a', S5_WORK_TASK_A, S5_MODULE_M),
    requestRef: null, requestId: 's5-conflict-propose-a' });
  await adoptCandidate(platform, ctx, uA);

  const uB = await proposeCandidate(platform, ctx, { goalRef: S5_GOAL_B, basedOn: null,
    draft: s5ModulePlanDraft('s5-plan-b', 1, S5_GOAL_B, S5_WORK_TASK_B, S5_MODULE_M),
    requestRef: null, requestId: 's5-conflict-propose-b' });
  await adoptCandidate(platform, ctx, uB);
  return { platform, ctx, goals: { A: S5_GOAL_A, B: S5_GOAL_B } };
}

/** `goals/conflicts`: the one conflict card with the three parallel options. */
export function queryGoalConflicts(platform: Platform, ctx: CoreCallContext): ReturnType<Platform['decisions']['queryGoalConflicts']> {
  return platform.decisions.queryGoalConflicts(ctx, { workspace: S5_SCOPE });
}

/** The real `goals/reorder` write (a note, never a gate); SPEC §3.3 line 625 pins the full Goal list. */
export async function reorderGoals(platform: Platform, ctx: CoreCallContext, input: {
  goalOrder: GoalRef[]; decisionMessageRef?: SessionMessageRef;
}): ReturnType<Platform['goalSettings']['reorderGoals']> {
  const pins = await s5GoalPins(platform, ctx, input.goalOrder);
  return platform.goalSettings.reorderGoals(ctx, {
    input: { workspace: S5_SCOPE, goalOrder: input.goalOrder,
      ...(input.decisionMessageRef === undefined ? {} : { decisionMessageRef: input.decisionMessageRef }) },
    meta: { requestId: 's5-reorder-goals', expected: pins },
  });
}

/** The finite answer entry for SC02's accepted parallel risk (`conflict_parallel`). */
export function acceptParallelRisk(platform: Platform, ctx: CoreCallContext, input: {
  source: DecisionSourceV1; earlier: GoalRef; later: GoalRef; annotations?: readonly DecisionAnnotationV1[];
}): ReturnType<NonNullable<Platform['workflow']['resolveDecision']>> {
  return answerDecision(platform, ctx, { source: input.source,
    selection: { kind: 'conflict_parallel', earlier: input.earlier, later: input.later },
    text: '', annotations: input.annotations ?? [], requestId: `s5-accept-${input.source.key}` });
}

/**
 * Owner-seeded Agent admission, NOT a model-driven tool call. The Host harness
 * deliberately omits Runtime from direct(), so its delegated requeue cannot
 * admit an Agent. Use the same SQLite ledger/body store and production owners,
 * granting requeue_task in the initial manifest (A2-requeue-service pattern).
 * The auxiliary Run is settled before returning and before any Host restart.
 */
export async function s5AgentRequeue(h: HostScenario, afterRunRef: RunRef) {
  const platform = await h.direct();
  const ctx = hostCtx(h.stepActor());
  const pins = await s5Pins(platform, ctx, S5_GOAL_A);
  const created = await platform.runtime.createSession(ctx, { workspace: S5_SCOPE, role: AG2B_WORK_ROLE,
    recommendedRefs: [], initialLinks: [], meta: { requestId: 's5-aux-session', expected: [pins.project, pins.workspace] } });
  if (created.status !== 'completed') throw new Error(`auxiliary Session: ${JSON.stringify(created)}`);
  const sessionRef = { projectId: created.value.ref.projectId, sessionId: created.value.ref.sessionId };
  const plan = await readActivePlan(platform, ctx, S5_GOAL_A);
  const budget = { tokenBudget: 1_000_000, deadline: null };
  const claim = mustCommit('auxiliary claim', await platform.claims.claimTask(ctx, {
    input: { goalRef: S5_GOAL_A, planRef: plan.ref, taskId: S5_WORK_TASK_A2, sessionRef,
      roleBinding: AG2B_WORK_ROLE_BINDING, budget },
    meta: { requestId: 's5-aux-claim', expected: [pins.goal, pins.workspace,
      { ref: plainSessionRefToAggregate(sessionRef), revision: created.value.revision }] },
  }));
  const backend = createSqliteRecordBackend({ path: join(h.database, 'ledger.sqlite'), schemas: platformRecordSchemas() });
  const bodies = createSqliteRawArtifactStore(join(h.database, 'artifacts.sqlite'));
  const now = () => '2026-10-08T00:00:00.000Z';
  const permissions: TaskEnvelopeV1['permissions'] = {
    policyRevision: 'legacy-template', tools: ['read', 'requeue_task'], writeScope: [],
  };
  const hostTemplate = { templateId: AG2B_WORK_ROLE.templateId, revision: AG2B_WORK_ROLE.templateRevision,
    digest: artifactBodyDigest('S5 auxiliary requeue admission') };
  const authorizeConfiguration: AuthorizeConfiguration = async (context, input) => {
    if (context.projectId !== S5_SCOPE.projectId || context.workspaceId !== S5_SCOPE.workspaceId
      || input.configurationRevision !== 's5-aux-host@1'
      || canonicalJson(input.permissions) !== canonicalJson(permissions)
      || canonicalJson(input.hostTemplate) !== canonicalJson(hostTemplate)) {
      return { status: 'rejected', code: 'forbidden', reason: 'not the trusted auxiliary admission grant' };
    }
    return { status: 'ready', value: { configurationRevision: 's5-aux-host@1',
      permissions: structuredClone(permissions), hostTemplate: structuredClone(hostTemplate) } };
  };
  try {
    const records = backend.records;
    const reads = createRunStateReader({ records, bodies });
    const roles = createRoleConfigurationService({ records, now, eventId: randomUUID });
    const prepared = (await prepareTaskForReal({ records, ctx }, {
      bodies, runRef: claim.runRef, now, requestId: 's5-aux-prepare',
      host: preparationHost({ configurationRevision: 's5-aux-host@1', permissions, hostTemplate }),
    })).prepared;
    const entry = createExecutionEntryService({ records, reads, roles, bodies, authorizeConfiguration,
      now, eventId: randomUUID, newId: randomUUID });
    const runPin = async (): Promise<VersionPin> => {
      const read = mustReady('auxiliary Run', await reads.readExecution(ctx, claim.runRef));
      return { ref: claim.runRef, revision: read.run.revision };
    };
    const kernel: KernelExecutionBinding = { ...created.value.kernel,
      runId: 's5-aux-kernel-run', turnId: 's5-aux-kernel-turn' };
    const authorized = mustCommit('auxiliary authorize', await entry.authorizeRuntimeEntry(ctx, {
      input: { prepared, consumerId: 's5-aux-consumer' },
      meta: { requestId: 's5-aux-authorize', expected: [await runPin()] } }));
    const begun = mustCommit('auxiliary begin', await entry.beginRuntimeEntry(ctx, {
      input: { permit: authorized, kernel }, meta: { requestId: 's5-aux-begin', expected: [await runPin()] } }));
    const permit = { ...authorized, authorizationRevision: begun.authorization.revision };
    const entered = mustCommit('auxiliary entered', await entry.recordExecutionEntered(ctx, {
      input: { permit, enteredAt: now(), kernelSource: { ...kernel, position: 3 },
        history: { kernel, startPosition: 2, observedThroughPosition: 3, endPosition: null } },
      meta: { requestId: 's5-aux-entered', expected: [await runPin()] } }));
    if (entered.status !== 'running') throw new Error('auxiliary Run did not enter');
    try {
      const requeue = createTaskRequeueService({ records, reads,
        workspaceHost: ag2bWorkspaceBindings(h.root, { value: pins.workspace.revision },
          permissionRevision(h.stepActor(), S5_SCOPE, ['.'])),
        source: new VerificationWorkspaceReader(), materials: platform.materials, messages: platform.messages,
        delegatedWrites: { reads, roles, bodies, authorizeConfiguration },
        automationPolicy: () => h.automationPolicy(), now, eventId: randomUUID });
      const after = mustReady('failed Run', await reads.readExecution(ctx, afterRunRef));
      return await requeue.requeueTask(workRunCtx(claim.runRef, AG2B_WORK_ROLE_BINDING), {
        input: { taskRef: after.run.task, afterRunRef, reason: 'auxiliary Agent requests another attempt' },
        meta: { requestId: 's5-sc02-agent-requeue', expected: [await s5GoalPin(platform, ctx, S5_GOAL_A),
          { ref: afterRunRef, revision: after.run.revision }] },
      });
    } finally {
      mustCommit('auxiliary completion', await entry.recordRunResult(ctx, {
        input: { claim, entry: { consumerId: permit.consumerId, entryGeneration: permit.entryGeneration },
          event: { eventType: 'run_completed', schemaVersion: 1, eventId: 's5-aux-completed', runRef: claim.runRef,
            sequence: 2, occurredAt: now(), payload: { kind: 'completed', exitCode: 0 } },
          kernelSource: { ...kernel, position: 4 },
          completedHistoryBoundary: { source: { ...kernel, position: 4 }, cursor: 's5-aux-terminal-4' },
          history: { kernel, startPosition: 2, observedThroughPosition: 4, endPosition: 4 } },
        meta: { requestId: 's5-aux-completed', expected: [await runPin()] },
      }));
    }
  } finally {
    await bodies.close();
    await backend.close();
  }
}
