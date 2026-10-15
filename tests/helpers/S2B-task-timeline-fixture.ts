/**
 * Slice 2B BE4 task-timeline fixture (Group S).
 *
 * What it builds and through which public calls (L-fixtures / spec §7):
 *   - one real RecordStore (memory or SQLite) through the accepted
 *     `createB2ExecutionFixture` (real Goal/Plan/Session/claim/execution-entry
 *     services), layered with `EVIDENCE_RECORD_SCHEMAS`,
 *     `CONTROL_RECORD_SCHEMAS`, `SESSION_ANOMALY_RECORD_SCHEMAS`,
 *     `SESSION_LIFECYCLE_RECORD_SCHEMAS`, `ARCHITECTURE_CATALOG_SCHEMAS` and
 *     `COMPLETION_RECORD_SCHEMAS`;
 *   - the Goal and every Plan revision through the REAL public Plan service
 *     (`goals.createGoal` + `plans.proposePlan` + `plans.applyPlanChange`), so
 *     `acceptedAt`, the current-Plan pointer and C7 `dispositionRecord` are the
 *     product's own; the Goal's desired state through the real
 *     `goals.setGoalControl` (GOAL-04..06);
 *   - real Runs claimed by the real `TaskClaimPort`, entered and ended through
 *     the real `ExecutionEntryPort`, with the real `createRunReconcileService`
 *     for the `outcome_unknown` end and the RUN-24 paused-interrupted crash;
 *   - real verification rounds through `createEvidenceService`
 *     (`openVerification` / `beginCheck` / `recordCheckResult` /
 *     `finalizeChecks`), where PASS/FAIL come from a controlled
 *     `CheckProcessObservation` (no process is launched);
 *   - real pause/resume `ControlIntent`s through `createRunControlService`
 *     (`submitControl` + the trusted `recordControlObservation`) for
 *     observations that fall inside the Run;
 *   - real `TaskRequeue` records through `createTaskRequeueService`;
 *   - real `SessionAnomalyAnchor` records through the real Session archive
 *     request flow (`createSessionLifecycleService.requestSessionArchive`) plus
 *     `createSessionAnomalyService.recordSessionAnomaly`;
 *   - the timeline read through `createTaskStateTimeline` (live store and any
 *     caller-supplied records port for fault/cap rows).
 *
 * The only direct storage-boundary writes this file keeps are the ones L-fixtures
 * names or that a public flow genuinely cannot produce in this fixture:
 *   (a) the §7 legacy round shapes: a round JSON whose top-level `since` is
 *       absent, and a finalized round whose top-level `finalizedAt` is absent
 *       (committed with the real production encoder + commit-time validation);
 *   (b) a `yielded` Run: a real yielded terminal needs a durable wait message
 *       and the mailbox/continuation flow (RD-3), which is outside this read
 *       fixture; and the second Run of that test, because the real claim
 *       service refuses a first claim when a Run already exists and the only
 *       legal successor is a continuation that names that wait message;
 *   (c) a pause/resume observation dated BEFORE the Run entered (2B-32 fold
 *       order (a)); `recordControlObservation` requires the Run's saved V2
 *       entry history, so the observation cannot be produced by the public
 *       control flow.
 * Every direct write uses the real production encoder and commit-time schema
 * validation.
 *
 * Nothing here calls a model or touches the network.
 */
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../src/contracts/core/identity.js';
import type { ArchiveStepRefV1, RequestSessionArchiveInput } from '../../src/contracts/core/session-archive.js';
import type { PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import { continuationBriefDigest, renderContinuationBriefZh } from '../../src/contracts/continuation-brief.js';
import { assembleAnomalySection, assembleContinuationBrief } from '../../src/core/agent-runtime/continuation-brief-assembly.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { ControlObservationV1, ControlIntentRef } from '../../src/contracts/control-intent.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { ExecutionAuthorizationV2, RunOutcome, RunRef, RunSnapshot, RuntimeEventV1 } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import type { RoundSnapshot, CheckProcessObservation, TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import { DEFAULT_TASK_AUTOMATION_POLICY, type TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import { completionPolicyContentDigest } from '../../src/contracts/governance.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { EncodedRecord, RecordBackendSchemas, RecordGuard, StoreCommitReceipt } from '../../src/core/record-store/ports.js';
import type { RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { ClaimTaskInput, RequeueTaskInput } from '../../src/core/work-graph/model/claim-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import type {
  ExecutionEntryPort, AuthorizeConfiguration, KernelExecutionBinding, TaskResultObservation,
} from '../../src/core/work-graph/model/execution-entry-contracts.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { createSessionAnomalyService } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-service.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { EVIDENCE_RECORD_SCHEMAS, encodeVerificationRoundSnapshot } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { CONTROL_RECORD_SCHEMAS, encodeControlIntentSnapshot } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { SESSION_ANOMALY_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import {
  createTaskStateTimeline, type TaskStateTimelinePageV1, type TaskTimelineReadPort,
} from '../../src/core/work-graph/views/task-state-timeline.js';
import {
  B2_HOST, createB2ExecutionFixture, type B2ExecutionFixture,
} from './B2-execution-fixture.js';
import type { ClaimFixtureKind } from './task-claim-fixture.js';

/** One slow timeline file may take up to 1,800 s (spec §7 / L-fixtures). */
export const S2B_SLOW_TIMEOUT_MS = 1_800_000;

const OPERATOR = { kind: 'human' as const, id: 'r4c-claim-operator' };
const HOST_INSTANCE = { hostInstanceId: 's2b-timeline-host', lease: 'owned' as const };

/** The extra schema groups the real seed services write through. */
const TIMELINE_SCHEMAS: RecordBackendSchemas = {
  records: [...EVIDENCE_RECORD_SCHEMAS.records, ...CONTROL_RECORD_SCHEMAS.records,
    ...SESSION_ANOMALY_RECORD_SCHEMAS.records, ...ARCHITECTURE_CATALOG_SCHEMAS.records,
    ...COMPLETION_RECORD_SCHEMAS.records],
  events: [...EVIDENCE_RECORD_SCHEMAS.events, ...CONTROL_RECORD_SCHEMAS.events,
    ...SESSION_ANOMALY_RECORD_SCHEMAS.events, ...ARCHITECTURE_CATALOG_SCHEMAS.events,
    ...COMPLETION_RECORD_SCHEMAS.events, ...SESSION_LIFECYCLE_RECORD_SCHEMAS.events,
    ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events],
  lookups: [...(EVIDENCE_RECORD_SCHEMAS.lookups ?? []), ...(CONTROL_RECORD_SCHEMAS.lookups ?? []),
    ...(SESSION_ANOMALY_RECORD_SCHEMAS.lookups ?? []), ...(ARCHITECTURE_CATALOG_SCHEMAS.lookups ?? []),
    ...(COMPLETION_RECORD_SCHEMAS.lookups ?? [])],
};

export type S2BSeedRunInput = {
  goalRef: GoalRef; runId: string; taskId: string; planRef: PlanRevisionRef;
  startedAt: string | null; endedAt: string | null;
  outcome: RunOutcome | null; status?: RunSnapshot['status']; attemptId?: string;
  /** When set, a `crashed` Run with a paused-interrupted `interrupted_clean` reconciliation. */
  pausedInterrupted?: boolean;
};

export type S2BSeedRoundInput = {
  runRef: RunRef; roundId: string;
  /** `eventAt(since)` reads this instant; omitted = a legacy round without `since`. */
  sinceAt?: string | undefined;
  /** VR-07 finalisation; omitted = an open or pre-2B round. */
  finalizedAt?: string | undefined;
  outcome?: RoundSnapshot['outcome'];
  status?: RoundSnapshot['status'];
};

export type S2BTimelineFixture = {
  kind: ClaimFixtureKind;
  b2: B2ExecutionFixture;
  ctx: CoreCallContext;
  records: B2ExecutionFixture['base']['records'] & RecordOrderedLookupPort;
  /** The mutable platform clock `acceptedAt`/`now` read. */
  setClock(at: string): void;
  clock(): string;
  /** Creates a Goal and its first v2 Plan (real public Plan service). */
  createGoal(input: { goalId: string; workTaskIds: readonly string[] }): Promise<GoalRef>;
  /** The Goal's current active Plan ref. */
  activePlanRef(goalRef: GoalRef): Promise<PlanRevisionRef | null>;
  /** Adopts the next v2 Plan version through `proposePlan` + `applyPlanChange`. */
  adoptVersion(input: {
    goalRef: GoalRef; planId: string; at: string; edit?: (draft: PlanRevisionDraft) => PlanRevisionDraft;
    affectedTaskIds?: readonly string[];
  }): Promise<PlanRevisionSnapshot>;
  /** The Goal's desired state through the real `setGoalControl` (GOAL-04..06). */
  setGoalDesiredState(goalRef: GoalRef, desiredState: 'active' | 'paused' | 'cancelled'): Promise<void>;
  seedRun(input: S2BSeedRunInput): Promise<RunRef>;
  seedRequeue(input: { runRef: RunRef; requestedAt: string }): Promise<void>;
  seedControl(input: { runRef: RunRef; kind: 'pause' | 'resume'; observedAt: string }): Promise<void>;
  seedAnomaly(input: { runRef: RunRef; recordedAt: string }): Promise<void>;
  seedRound(input: S2BSeedRoundInput): Promise<void>;
  timeline(input: { goalRef: GoalRef; cursor?: string | null; limit: number }, options?: { readRecordCap?: number }):
    Promise<ReadResult<TaskStateTimelinePageV1>>;
  timelineWith(records: S2BTimelineFixture['records'], readRecordCap?: number): TaskTimelineReadPort;
  close(): Promise<void>;
};

function runRefOf(goalRef: GoalRef, runId: string): RunRef {
  return { aggregateType: 'Run', projectId: goalRef.projectId, goalId: goalRef.goalId, runId };
}

/** A next v2 draft from the current accepted Plan (test-side only; no product logic). */
function draftOf(plan: PlanRevisionSnapshot, planId: string): PlanRevisionDraft {
  if (plan.schemaVersion !== 2) throw new Error('the S2B timeline fixture needs a v2 active Plan');
  return {
    schemaVersion: 2, planId, planRevision: plan.planRevision + 1, goalId: plan.goalRef.goalId,
    stages: structuredClone(plan.stages), tasks: structuredClone(plan.tasks),
    assignments: structuredClone(plan.assignments ?? []), obligations: structuredClone(plan.obligations),
    taskHierarchy: structuredClone(plan.taskHierarchy), executionDag: structuredClone(plan.executionDag),
    taskRelations: structuredClone(plan.taskRelations ?? []),
    inputRequirements: structuredClone(plan.inputRequirements ?? []),
  };
}

export async function openS2BTimelineFixture(kind: ClaimFixtureKind = 'memory'): Promise<S2BTimelineFixture> {
  const b2 = await createB2ExecutionFixture(kind, TIMELINE_SCHEMAS);
  const baseRecords = b2.base.records;
  const records = baseRecords as unknown as B2ExecutionFixture['base']['records'] & RecordOrderedLookupPort;
  const ctx = b2.ctx;
  let clock = '2026-10-01T00:00:00.000Z';
  let seq = 0;
  const requestId = (label: string): string => `s2b-timeline-${label}-${++seq}`;
  const now = (): string => clock;
  const eventId = (): string => `s2b-timeline-event-${++seq}`;
  const newId = (): string => `s2b-timeline-id-${++seq}`;
  const plans = createPlanService({ records: baseRecords, now, eventId });
  const runReads = createRunStateReader({ records: baseRecords });
  const sessionFacts = createSessionFactsService({ records: baseRecords });
  const lifecycle = createSessionLifecycleService({ records: baseRecords, lookups: baseRecords, sessionFacts });
  const anomalies = createSessionAnomalyService({ records: baseRecords, lookups: baseRecords, sessionFacts, now });
  const authority = createMaterialRecordReaders(baseRecords).authority;
  const materials = createMaterialService({ bodies: b2.bodies, authority, now });

  const authorizeConfiguration: AuthorizeConfiguration = async (authorizeCtx, input) => {
    if (authorizeCtx.projectId !== b2.base.scope.projectId || authorizeCtx.workspaceId !== b2.base.scope.workspaceId
      || input.configurationRevision !== B2_HOST.configurationRevision
      || canonicalJson(input.permissions) !== canonicalJson(B2_HOST.permissions)
      || canonicalJson(input.hostTemplate) !== canonicalJson(B2_HOST.hostTemplate)) {
      return { status: 'rejected', code: 'forbidden',
        reason: 'the S2B timeline fixture Host does not authorize this configuration' };
    }
    return { status: 'ready', value: structuredClone(B2_HOST) };
  };

  const entry: ExecutionEntryPort = createExecutionEntryService({
    records: baseRecords, reads: runReads,
    roles: createRoleConfigurationService({ records: baseRecords, now, eventId }),
    bodies: b2.bodies, authorizeConfiguration, now, eventId, newId,
  });
  const controls = createRunControlService({ records: baseRecords, authority, reads: runReads, now, eventId });
  const reconcile = createRunReconcileService({ records: baseRecords, reads: runReads, hostInstance: HOST_INSTANCE, now, eventId });
  const requeues = createTaskRequeueService({
    records: baseRecords, reads: runReads, materials,
    messages: { readMessage: async () => ({ status: 'rejected' as const, code: 'not_found' as const,
      reason: 'the S2B timeline fixture references no session message' }) } as never,
    workspaceHost: { async resolveRoot() {
      return { status: 'ready' as const, value: { root: b2.base.directory, workspaceRevision: 1 } };
    } },
    source: { async captureDigest() { return { status: 'ready' as const, sourceDigest: sha256Hex('s2b-timeline-source') }; } },
    automationPolicy: () => DEFAULT_TASK_AUTOMATION_POLICY, now, eventId,
  });

  const evidenceConfiguration: TrustedCheckConfiguration = {
    configurationRevision: 's2b-timeline-checks', workspace: b2.base.workspaceRef,
    executor: { kind: 'human', id: OPERATOR.id }, permissionRevision: 's2b-timeline-permission',
    sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: [],
    checks: [{ checkId: 'check-1', kind: 'static', command: 'fixture-check',
      cwd: '.', timeoutMs: 1000, taskIds: 'all' }],
  };
  const evidence = createEvidenceService({
    records: baseRecords, executions: runReads, materials,
    workspaceHost: {
      async resolveRoot() { return { status: 'ready' as const, value: { root: b2.base.directory, workspaceRevision: 1 } }; },
      async authorize() { return { status: 'ready' as const, value: { subjectKey: 's2b-timeline-host',
        permissionRevision: 's2b-timeline-permission', allowsRead: () => true } }; },
    },
    source: { async capture() { return { status: 'ready' as const, sourceDigest: sha256Hex('s2b-timeline-source'),
      sourceProof: { kind: 'current-workspace-only' as const, runBaselineKnown: false },
      changeScope: { diffClass: 'code-change', changedFiles: ['src/s2b/timeline.ts'], writeSummary: 's2b timeline source' },
      gaps: [] }; } },
    configuration: evidenceConfiguration,
    automationPolicy: () => DEFAULT_TASK_AUTOMATION_POLICY, now, newId,
  });

  function setClock(at: string): void { clock = at; }

  async function readRevision(ref: object): Promise<number> {
    const key = canonicalJson(ref as unknown as JsonValue);
    const read = await baseRecords.readMany([key]);
    if (read.status !== 'ready') throw new Error(`S2B timeline revision read failed: ${JSON.stringify(read)}`);
    return read.value.records.find((record) => record.refKey === key)?.revision ?? 0;
  }

  async function goalPin(goalRef: GoalRef): Promise<VersionPin> {
    const read = await plans.queryGoal(ctx, goalRef);
    if (read.status !== 'ready') throw new Error(`S2B timeline Goal read failed: ${JSON.stringify(read)}`);
    return { ref: goalRef, revision: read.value.goal.revision };
  }

  async function runPin(runRef: RunRef): Promise<VersionPin> {
    const read = await runReads.readExecution(ctx, runRef);
    if (read.status !== 'ready') throw new Error(`S2B timeline Run read failed: ${JSON.stringify(read)}`);
    return { ref: runRef, revision: read.value.run.revision };
  }

  async function runOf(runRef: RunRef): Promise<RunSnapshot> {
    const read = await runReads.readExecution(ctx, runRef);
    if (read.status !== 'ready') throw new Error(`S2B timeline Run read failed: ${JSON.stringify(read)}`);
    return read.value.run;
  }

  /**
   * Registers and activates a real `requirementKinds: ['static']` completion
   * policy through the public project-bootstrap install/activate operations, so
   * the plan's `static` requirement is covered by the trusted `static` check
   * configuration and the compiled round really carries checks. Copied from the
   * accepted `S2B-track-fixture.ts`.
   */
  async function installStaticCompletionPolicy(): Promise<void> {
    const bootstrap = createProjectBootstrapServices({ records: baseRecords, now, eventId });
    const projectRevision = await readRevision(b2.base.projectRef);
    const policyId = 's2b-timeline-policy';
    const content = { schemaVersion: 1 as const, requirementKinds: ['static'],
      minimumRequiredRequirementsPerObligation: 1 };
    const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId: b2.base.scope.projectId,
      policyId, revision: 1 };
    const installed = await bootstrap.completionPolicies.installCompletionPolicy(ctx, {
      input: { policyId, contentRevision: 1, content },
      meta: { requestId: requestId('install-policy'), expected: [
        { ref: b2.base.projectRef, revision: projectRevision }, { ref: policyRef, revision: 0 },
      ] },
    });
    if (installed.status !== 'committed') throw new Error(`S2B policy install failed: ${JSON.stringify(installed)}`);
    const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: b2.base.scope.projectId };
    const activeRevision = await readRevision(activeRef);
    const activated = await bootstrap.completionPolicies.activateCompletionPolicy(ctx, {
      input: { target: { ref: policyRef, digest: completionPolicyContentDigest({ schemaVersion: 1, policyId,
        contentRevision: 1, content }) } },
      meta: { requestId: requestId('activate-policy'), expected: [
        { ref: b2.base.projectRef, revision: projectRevision }, { ref: activeRef, revision: activeRevision },
      ] },
    });
    if (activated.status !== 'committed') throw new Error(`S2B policy activate failed: ${JSON.stringify(activated)}`);
  }

  async function createGoal(input: { goalId: string; workTaskIds: readonly string[] }): Promise<GoalRef> {
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: ctx.projectId, goalId: input.goalId };
    const created = await b2.base.goals.createGoal(ctx, {
      meta: { requestId: requestId('create-goal'), expected: [
        { ref: b2.base.projectRef, revision: await readRevision(b2.base.projectRef) },
        { ref: b2.base.workspaceRef, revision: await readRevision(b2.base.workspaceRef) }] },
      input: { goalId: input.goalId, workspace: b2.base.scope, objective: `S2B timeline ${input.goalId}` },
    });
    if (created.status !== 'committed') throw new Error(`S2B timeline Goal creation failed: ${JSON.stringify(created)}`);
    const tasks: RuntimeTask[] = [
      ...input.workTaskIds.map((taskId) => ({ taskId, title: `S2B timeline ${taskId}`, requirementLevel: 'required' as const,
        taskKind: 'work' as const, disposition: 'active' as const, phase: 'pending' as const, scope: { kind: 'goal' as const } })),
      { taskId: 'gate-1', title: 'S2B timeline gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ];
    const draft: PlanRevisionDraft = {
      schemaVersion: 2, planId: `${input.goalId}-plan-1`, planRevision: 1, goalId: input.goalId, stages: [], tasks,
      assignments: input.workTaskIds.map((taskId) => ({ taskId, role: 'builder', instruction: `Do ${taskId}` })),
      obligations: [{ obligationId: `${input.goalId}-obligation`, title: 'S2B timeline work', requirementLevel: 'required',
        taskIds: [...input.workTaskIds, 'gate-1'],
        verificationRequirements: [{ requirementId: `${input.goalId}-check`, requirementLevel: 'required',
          kind: 'static', description: 'S2B timeline work is verified' }] }],
      taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
    };
    const goalRead = await plans.queryGoal(ctx, goalRef);
    if (goalRead.status !== 'ready') throw new Error(`S2B timeline Goal read failed: ${JSON.stringify(goalRead)}`);
    const proposed = await plans.proposePlan(ctx, {
      meta: { requestId: requestId('propose-plan-1'), expected: [{ ref: goalRef, revision: goalRead.value.goal.revision }] },
      input: { goalRef, basedOn: null, draft, reason: { text: 'S2B timeline initial plan', sources: [] } },
    });
    if (proposed.status !== 'committed' || proposed.value.issues.length !== 0) {
      throw new Error(`S2B timeline initial plan proposal failed: ${JSON.stringify(proposed)}`);
    }
    const applied = await plans.applyPlanChange(ctx, {
      meta: { requestId: requestId('apply-plan-1'), expected: [{ ref: goalRef, revision: goalRead.value.goal.revision }] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
    });
    if (applied.status !== 'committed') throw new Error(`S2B timeline initial plan apply failed: ${JSON.stringify(applied)}`);
    return goalRef;
  }

  async function readActivePlan(goalRef: GoalRef): Promise<PlanRevisionSnapshot | null> {
    const graph = await plans.queryTaskGraph(ctx, { goalRef });
    if (graph.status !== 'ready') return null;
    return graph.value.plan;
  }

  async function activePlanRef(goalRef: GoalRef): Promise<PlanRevisionRef | null> {
    const goalRead = await plans.queryGoal(ctx, goalRef);
    if (goalRead.status !== 'ready') throw new Error(`S2B timeline Goal read failed: ${JSON.stringify(goalRead)}`);
    return goalRead.value.goal.activePlanRevision;
  }

  async function adoptVersion(input: {
    goalRef: GoalRef; planId: string; at: string; edit?: (draft: PlanRevisionDraft) => PlanRevisionDraft;
    affectedTaskIds?: readonly string[];
  }): Promise<PlanRevisionSnapshot> {
    const source = await readActivePlan(input.goalRef);
    if (source === null) throw new Error('S2B timeline adoption needs an active Plan');
    clock = input.at;
    let draft = draftOf(source, input.planId);
    if (input.edit !== undefined) draft = input.edit(draft);
    const goalRead = await plans.queryGoal(ctx, input.goalRef);
    if (goalRead.status !== 'ready') throw new Error(`S2B timeline Goal read failed: ${JSON.stringify(goalRead)}`);
    const proposed = await plans.proposePlan(ctx, {
      meta: { requestId: requestId(`propose-${input.planId}`),
        expected: [{ ref: input.goalRef, revision: goalRead.value.goal.revision }] },
      input: { goalRef: input.goalRef, basedOn: source.ref, draft,
        reason: { text: `S2B timeline ${input.planId}`, sources: [],
          ...(input.affectedTaskIds === undefined ? {} : { affectedTaskIds: [...input.affectedTaskIds] }) } },
    });
    if (proposed.status !== 'committed' || proposed.value.issues.length !== 0) {
      throw new Error(`S2B timeline ${input.planId} proposal failed: ${JSON.stringify(proposed)}`);
    }
    const applied = await plans.applyPlanChange(ctx, {
      meta: { requestId: requestId(`apply-${input.planId}`),
        expected: [{ ref: input.goalRef, revision: goalRead.value.goal.revision }] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
    });
    if (applied.status !== 'committed') throw new Error(`S2B timeline ${input.planId} apply failed: ${JSON.stringify(applied)}`);
    return applied.value;
  }

  /** GOAL-04..06 through the real trusted Goal-control port. */
  async function setGoalDesiredState(goalRef: GoalRef, desiredState: 'active' | 'paused' | 'cancelled'): Promise<void> {
    const control = desiredState === 'active' ? 'resume' : desiredState === 'paused' ? 'pause' : 'cancel';
    const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: goalRef.projectId, goalId: goalRef.goalId };
    const result = await b2.base.goals.setGoalControl(ctx, {
      input: { goalRef, control, reason: null },
      meta: { requestId: requestId(`goal-${control}`), expected: [
        { ref: goalRef, revision: await readRevision(goalRef) },
        { ref: phaseRef, revision: await readRevision(phaseRef) },
      ] },
    });
    if (result.status !== 'committed') throw new Error(`S2B timeline Goal control failed: ${JSON.stringify(result)}`);
  }

  // ------------------------------------------------------------------------
  // Real Run seed flows
  // ------------------------------------------------------------------------

  async function newSession(): Promise<SessionRef> {
    return await b2.base.createSession(requestId('session'));
  }

  async function claimTask(goalRef: GoalRef, taskId: string, sessionRef: SessionRef,
    requeueRef?: TaskRequeueRef): Promise<TaskClaim> {
    const goalRead = await plans.queryGoal(ctx, goalRef);
    if (goalRead.status !== 'ready' || goalRead.value.goal.activePlanRevision === null) {
      throw new Error(`S2B timeline claim Goal read failed: ${JSON.stringify(goalRead)}`);
    }
    const request: GraphWrite<ClaimTaskInput> = {
      input: { goalRef, planRef: goalRead.value.goal.activePlanRevision, taskId, sessionRef,
        roleBinding: b2.base.roleBinding, budget: b2.base.budget,
        ...(requeueRef === undefined ? {} : { requeueRef }) },
      meta: { requestId: requestId('claim'), expected: [
        { ref: goalRef, revision: goalRead.value.goal.revision },
        { ref: b2.base.workspaceRef, revision: await readRevision(b2.base.workspaceRef) },
        await b2.base.sessionPin(sessionRef),
      ] },
    };
    const claimed = await b2.base.service.claimTask(ctx, request);
    if (claimed.status !== 'committed') throw new Error(`S2B timeline claim failed: ${JSON.stringify(claimed)}`);
    return claimed.value;
  }

  async function enter(claim: TaskClaim, at: string): Promise<void> {
    clock = at;
    const prepared = await b2.buildPrepared({ claim });
    // C3 (RUN-02): a requeue Run enters with its continuation brief bound.
    const current = await runOf(claim.runRef);
    if (current.requeueRef !== undefined) {
      const basisRead = await runReads.readContinuationBasis?.(ctx, { runRef: claim.runRef });
      if (basisRead === undefined || basisRead.status !== 'ready') {
        throw new Error(`the S2B timeline continuation basis is unavailable: ${JSON.stringify(basisRead)}`);
      }
      const basis = basisRead.value;
      const pending = basis.pendingAnomalies ?? [];
      const anomalies = pending.length === 0 ? null : assembleAnomalySection(pending);
      const brief = assembleContinuationBrief({ basis, factsRecord: basis.previous, factsHops: 0, factsTruncated: false,
        turn: { kernel: 'unavailable', reason: 'the S2B timeline fixture has no prior Kernel store' },
        workspace: { briefCheckpoint: { kind: 'brief', at: clock, workspaceRevision: 1,
          sourceDigest: null, unavailableReason: 'not captured in this fixture' },
          uncommitted: { status: 'unavailable', baseCommit: null, paths: [], omitted: 0,
            reason: 'not captured in this fixture' } }, claimSessionRef: claim.sessionRef, anomalies });
      const digest = continuationBriefDigest(brief);
      const body = await b2.bodies.read(prepared.envelope.bundleRef);
      if (body.status !== 'ready') throw new Error(`the S2B timeline manifest read failed: ${JSON.stringify(body)}`);
      const manifest = JSON.parse(body.value.body) as PreparedTaskManifestV1;
      manifest.continuationBrief = brief;
      manifest.input += `\n\n${renderContinuationBriefZh(brief, digest)}`;
      manifest.inputDigest = sha256Hex(manifest.input);
      const json = JSON.stringify(manifest);
      const stored = await b2.bodies.put({ body: json, contentType: body.value.ref.contentType,
        sourceRefs: body.value.sourceRefs, origin: { kind: 'run', owner: claim.runRef }, requestedAt: clock });
      if (stored.status !== 'ready') throw new Error(`the S2B timeline manifest store failed: ${JSON.stringify(stored)}`);
      prepared.envelope.bundleRef = stored.value.ref;
      prepared.inputBinding = { ...prepared.inputBinding, inputDigest: manifest.inputDigest, manifestDigest: sha256Hex(json),
        continuationBriefDigest: digest,
        ...(brief.anomalies === undefined ? {} : { anomalyAnchorRefs: brief.anomalies.anchors.map((anchor) => anchor.ref) }) };
    }
    const sessionKernel = await b2.kernelFor(claim);
    const kernel: KernelExecutionBinding = { ...sessionKernel,
      runId: `${claim.runRef.runId}-kernel`, turnId: `${claim.runRef.runId}-turn` };
    const authorized = await entry.authorizeRuntimeEntry(ctx, {
      input: { prepared, consumerId: 's2b-timeline-runtime' },
      meta: { requestId: requestId('authorize'), expected: [await runPin(claim.runRef)] },
    });
    if (authorized.status !== 'committed') throw new Error(`S2B timeline authorize failed: ${JSON.stringify(authorized)}`);
    const begun = await entry.beginRuntimeEntry(ctx, {
      input: { permit: authorized.value, kernel },
      meta: { requestId: requestId('begin'), expected: [await runPin(claim.runRef)] },
    });
    if (begun.status !== 'committed') throw new Error(`S2B timeline begin failed: ${JSON.stringify(begun)}`);
    const entered = await entry.recordExecutionEntered(ctx, {
      input: { permit: { ...authorized.value, authorizationRevision: begun.value.authorization.revision },
        enteredAt: at, kernelSource: { ...kernel, position: 3 },
        history: { kernel, startPosition: 2, observedThroughPosition: 3, endPosition: null } },
      meta: { requestId: requestId('entered'), expected: [await runPin(claim.runRef)] },
    });
    if (entered.status !== 'committed') throw new Error(`S2B timeline entered failed: ${JSON.stringify(entered)}`);
  }

  function terminalEvent(run: RunSnapshot, at: string, outcome: RunOutcome): RuntimeEventV1 {
    const base = { schemaVersion: 1 as const, eventId: eventId(), runRef: run.ref,
      sequence: run.lastEventSeq + 1, occurredAt: at };
    switch (outcome) {
      case 'completed':
        return { ...base, eventType: 'run_completed', payload: { kind: 'completed', exitCode: 0 } };
      case 'cancelled':
        return { ...base, eventType: 'run_cancelled', payload: { kind: 'cancelled', reason: 'S2B timeline cancel' } };
      case 'budget_exhausted':
        return { ...base, eventType: 'run_budget_exhausted', payload: { kind: 'budget_exhausted', exhaustedAt: at } };
      case 'crashed':
        return { ...base, eventType: 'run_crashed', payload: { kind: 'crashed', error: 'S2B timeline crash' } };
      default:
        throw new Error(`the S2B timeline fixture has no real terminal event for ${outcome}`);
    }
  }

  async function end(claim: TaskClaim, at: string, outcome: RunOutcome): Promise<void> {
    clock = at;
    const run = await runOf(claim.runRef);
    const authorization = run.executionAuthorization as ExecutionAuthorizationV2 | undefined;
    const history = run.executionHistory;
    if (authorization === undefined || !('schemaVersion' in authorization) || authorization.schemaVersion !== 2
      || history === undefined || history === null) {
      throw new Error('the S2B timeline end requires an entered V2 Run');
    }
    const position = history.observedThroughPosition + 1;
    const source = { ...history.kernel, position };
    const observation: TaskResultObservation = {
      claim, entry: { consumerId: authorization.consumerId, entryGeneration: authorization.generation },
      event: terminalEvent(run, at, outcome), kernelSource: source,
      completedHistoryBoundary: { source, cursor: `s2b-boundary-${run.ref.runId}-${String(position)}` },
      history: { kernel: history.kernel, startPosition: history.startPosition,
        observedThroughPosition: position, endPosition: position },
    };
    const result = await entry.recordRunResult(ctx, {
      input: observation, meta: { requestId: requestId('end'), expected: [await runPin(claim.runRef)] },
    });
    if (result.status !== 'committed') throw new Error(`S2B timeline end failed: ${JSON.stringify(result)}`);
  }

  /** RUN-24: the pointer pause, then the real `interrupted_clean` reconcile. */
  async function pauseInterrupted(claim: TaskClaim, at: string): Promise<void> {
    clock = at;
    const before = await runOf(claim.runRef);
    const paused = await controls.submitControl(ctx, {
      input: { runRef: claim.runRef, kind: 'pause', reason: null },
      meta: { requestId: requestId('pause-intent'), expected: [{ ref: claim.runRef, revision: before.revision }] },
    });
    if (paused.status !== 'committed') throw new Error(`S2B timeline pause intent failed: ${JSON.stringify(paused)}`);
    const reconciled = await reconcile.reconcileRun(ctx, {
      input: { runRef: claim.runRef, basis: { kind: 'host_instance_takeover', hostInstanceId: HOST_INSTANCE.hostInstanceId },
        probe: 'ready', result: { kind: 'interrupted_clean', turn: { terminal: false, inFlightToolCallIds: [],
          lastPosition: 3, kernelPaused: true, entered: null, acceptedSteers: [], inputsConfirmed: true } } },
      meta: { requestId: requestId('reconcile-interrupted'), expected: [await runPin(claim.runRef)] },
    });
    if (reconciled.status !== 'committed') throw new Error(`S2B timeline interrupted reconcile failed: ${JSON.stringify(reconciled)}`);
  }

  /** RUN-20: the real reconcile that ends a Run `outcome_unknown`. */
  async function reconcileUnknown(claim: TaskClaim, at: string): Promise<void> {
    clock = at;
    const reconciled = await reconcile.reconcileRun(ctx, {
      input: { runRef: claim.runRef, basis: { kind: 'host_instance_takeover', hostInstanceId: HOST_INSTANCE.hostInstanceId },
        probe: 'ready', result: { kind: 'unknown', cause: 'continuation_unrebuildable',
          unresolvedToolCallIds: [], observedThroughPosition: null, turn: null } },
      meta: { requestId: requestId('reconcile-unknown'), expected: [await runPin(claim.runRef)] },
    });
    if (reconciled.status !== 'committed') throw new Error(`S2B timeline unknown reconcile failed: ${JSON.stringify(reconciled)}`);
  }

  // ------------------------------------------------------------------------
  // Storage-boundary fallbacks (documented in the header)
  // ------------------------------------------------------------------------

  async function commitRecords(recordsToWrite: readonly EncodedRecord[],
    options: { guards?: readonly RecordGuard[]; occurredAt?: string;
      bindings?: readonly { refKey: string; field: 'since' }[] } = {}): Promise<StoreCommitReceipt> {
    const sequence = ++seq;
    const at = options.occurredAt ?? clock;
    const event = { eventId: `s2b-timeline-event-${sequence}`, eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: at,
      json: JSON.stringify({ eventId: `s2b-timeline-event-${sequence}`, eventType: 'TrustedScopeSeeded',
        schemaVersion: 1, occurredAt: at }) };
    const explicit = new Set((options.guards ?? []).map((guard) => guard.refKey));
    const guards = [...(options.guards ?? []),
      ...recordsToWrite.filter((record) => !explicit.has(record.refKey))
        .map((record) => ({ refKey: record.refKey, expectedRevision: null }))];
    const result = await baseRecords.commit({
      identityKey: `s2b-timeline-${sequence}`, fingerprint: `s2b-timeline-${sequence}`,
      guards, records: [...recordsToWrite], claims: [], indexGuards: [], indexChanges: [], events: [event],
      ...(options.bindings === undefined ? {} : { commitCursorBindings: [...options.bindings] }),
    });
    if (result.status !== 'committed') throw new Error(`S2B timeline seed commit failed: ${JSON.stringify(result)}`);
    return result;
  }

  /** Deviation (b): a `yielded` Run (and its successor) needs the RD-3 mailbox flow. */
  async function seedRunRaw(input: S2BSeedRunInput): Promise<RunRef> {
    const ref = runRefOf(input.goalRef, input.runId);
    const pausedIntentRef = input.pausedInterrupted === true
      ? { aggregateType: 'ControlIntent' as const, projectId: ref.projectId, workspaceId: b2.base.scope.workspaceId,
          intentId: `${input.runId}-paused` }
      : null;
    const snapshot: RunSnapshot = {
      ref, revision: 1, schemaVersion: 1,
      task: { projectId: ref.projectId, goalId: ref.goalId, taskId: input.taskId },
      attemptId: input.attemptId ?? `${input.runId}-attempt`,
      planRef: input.planRef, roleBinding: b2.base.roleBinding, budget: b2.base.budget,
      workspaceSnapshot: { workspaceId: b2.base.scope.workspaceId, revision: 1 },
      status: input.status ?? 'ended', outcome: input.outcome, exitCode: null,
      lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '', envelope: null,
      startedAt: input.startedAt, endedAt: input.endedAt,
      ...(input.pausedInterrupted === true ? {
        reconciliation: {
          status: 'done' as const, recordedAt: input.endedAt ?? clock, basis: { kind: 'live_clean' as const },
          observation: {
            kind: 'interrupted_clean' as const,
            event: { eventType: 'run_crashed' as const, schemaVersion: 1 as const, eventId: `${input.runId}-crash`,
              runRef: ref, sequence: 1, occurredAt: input.endedAt ?? clock, payload: { kind: 'crashed' as const, error: 'host restart' } },
            lastPosition: 3, kernelPaused: true, pausedIntentRef,
          },
        },
      } : {}),
    };
    const record: EncodedRecord = { refKey: canonicalJson(ref as unknown as JsonValue),
      schemaId: 'RunSnapshot@1', revision: 1, json: JSON.stringify(snapshot) };
    await commitRecords([record]);
    return ref;
  }

  /** Deviation (c): a control observation dated before the Run entered. */
  async function seedControlRaw(input: { runRef: RunRef; kind: 'pause' | 'resume'; observedAt: string }): Promise<void> {
    const { runRef, kind, observedAt } = input;
    const snapshot = {
      schemaVersion: 1,
      ref: { aggregateType: 'ControlIntent', projectId: runRef.projectId, workspaceId: b2.base.scope.workspaceId,
        intentId: `${runRef.runId}-${kind}-${observedAt}` },
      runRef, kind, desiredState: kind === 'pause' ? 'paused' : 'running', reason: null,
      requestedAt: observedAt, requestedBy: OPERATOR, revision: 2, status: 'applied',
      observation: { schemaVersion: 1, origin: 'platform_not_entered',
        kind: kind === 'pause' ? 'paused' : 'resumed', runRevision: 2, detail: { entryPhase: 'none' }, observedAt },
    };
    await commitRecords([encodeControlIntentSnapshot(snapshot as never)]);
  }

  /** §7 legacy round shape: no top-level `since` (and optionally no `finalizedAt`). */
  async function seedRoundRaw(input: S2BSeedRoundInput): Promise<void> {
    const runRef = input.runRef;
    const runKey = canonicalJson(runRef as unknown as JsonValue);
    const runRead = await baseRecords.readMany([runKey]);
    if (runRead.status !== 'ready') throw new Error(`S2B timeline Run read failed: ${JSON.stringify(runRead)}`);
    const runRecord = runRead.value.records.find((candidate) => candidate.refKey === runKey);
    if (runRecord === undefined) throw new Error(`S2B timeline Run ${runRef.runId} is missing`);
    const parsedRun = JSON.parse(runRecord.json) as { task: { projectId: string; goalId: string; taskId: string };
      planRef: PlanRevisionRef };
    const triple = parsedRun.task;
    const ref = { aggregateType: 'VerificationRound' as const, projectId: triple.projectId,
      workspaceId: b2.base.scope.workspaceId, goalId: triple.goalId, taskId: triple.taskId, runId: runRef.runId,
      roundId: input.roundId };
    const snapshot = {
      ref, revision: 1, schemaVersion: 1, subject: triple,
      subjectRunRef: runRef, adoptedPlanRef: parsedRun.planRef, taskBasisRef: parsedRun.planRef,
      executor: OPERATOR, configuration: {}, configurationDigest: sha256Hex('s2b-timeline-config'),
      identity: {}, sourceProof: {}, verificationPlan: {}, checks: [],
      status: input.status ?? 'finalized', outcome: input.outcome ?? null, gaps: [], evidenceRefs: [],
    } as unknown as RoundSnapshot;
    const origin = {
      ...(input.sinceAt === undefined ? {} : { since: null }),
      ...(input.finalizedAt === undefined ? {} : { finalizedAt: input.finalizedAt }),
    };
    const encoded = encodeVerificationRoundSnapshot(snapshot, origin);
    const bindings = input.sinceAt === undefined ? undefined : [{ refKey: encoded.refKey, field: 'since' as const }];
    await commitRecords([encoded], {
      occurredAt: input.sinceAt ?? clock,
      ...(bindings === undefined ? {} : { bindings }),
    });
  }

  // ------------------------------------------------------------------------
  // Public seed surface
  // ------------------------------------------------------------------------

  const runsForTask = new Map<string, number>();
  const pendingRequeue = new Map<string, TaskRequeueRef>();
  const runSession = new Map<string, SessionRef>();
  /**
   * A Run whose end is held until the last observation falls inside it, so the
   * real control flow can record pause/resume observations (`submitControl`
   * refuses an already ended Run). Every later seed/read flushes the end first.
   */
  const pendingEnds: { claim: TaskClaim; at: string; outcome: RunOutcome }[] = [];

  async function flushEnds(): Promise<void> {
    for (const pending of pendingEnds.splice(0)) await end(pending.claim, pending.at, pending.outcome);
  }

  async function seedRun(input: S2BSeedRunInput): Promise<RunRef> {
    await flushEnds();
    // Deviation (b): a yielded terminal requires the RD-3 durable wait message.
    if (input.outcome === 'yielded') {
      const ref = await seedRunRaw(input);
      runsForTask.set(input.taskId, (runsForTask.get(input.taskId) ?? 0) + 1);
      return ref;
    }
    const prior = runsForTask.get(input.taskId) ?? 0;
    const requeueRef = pendingRequeue.get(input.taskId);
    if (prior > 0 && requeueRef === undefined) {
      // Deviation (b): a real first claim is refused once a Run exists and the
      // only legal successor is a continuation that names a wait message.
      const ref = await seedRunRaw(input);
      runsForTask.set(input.taskId, prior + 1);
      return ref;
    }
    const session = await newSession();
    const claim = await claimTask(input.goalRef, input.taskId, session, requeueRef);
    runsForTask.set(input.taskId, prior + 1);
    pendingRequeue.delete(input.taskId);
    runSession.set(claim.runRef.runId, session);
    if (input.startedAt === null) return claim.runRef;
    await enter(claim, input.startedAt);
    if (input.pausedInterrupted === true) await pauseInterrupted(claim, input.endedAt ?? clock);
    else if (input.outcome === 'outcome_unknown') await reconcileUnknown(claim, input.endedAt ?? clock);
    else if (input.endedAt !== null && input.outcome !== null) {
      pendingEnds.push({ claim, at: input.endedAt, outcome: input.outcome });
    }
    return claim.runRef;
  }

  async function seedRequeue(input: { runRef: RunRef; requestedAt: string }): Promise<void> {
    await flushEnds();
    clock = input.requestedAt;
    const run = await runOf(input.runRef);
    const taskRef = run.task;
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: taskRef.projectId, goalId: taskRef.goalId };
    const write: GraphWrite<RequeueTaskInput> = {
      input: { taskRef, afterRunRef: input.runRef, reason: 'S2B timeline requeue' },
      meta: { requestId: requestId('requeue'), expected: [await goalPin(goalRef), { ref: input.runRef, revision: run.revision }] },
    };
    const result = await requeues.requeueTask(ctx, write);
    if (result.status !== 'committed') throw new Error(`S2B timeline requeue failed: ${JSON.stringify(result)}`);
    if (result.value.kind !== 'requeued') throw new Error(`S2B timeline requeue refused: ${JSON.stringify(result.value)}`);
    pendingRequeue.set(taskRef.taskId, result.value.requeue.ref);
  }

  async function submitAndObserve(runRef: RunRef, kind: 'pause' | 'resume', at: string): Promise<ControlIntentRef> {
    clock = at;
    const before = await runOf(runRef);
    const submitted = await controls.submitControl(ctx, {
      input: { runRef, kind, reason: null },
      meta: { requestId: requestId(`submit-${kind}`), expected: [{ ref: runRef, revision: before.revision }] },
    });
    if (submitted.status !== 'committed') throw new Error(`S2B timeline submitControl(${kind}) failed: ${JSON.stringify(submitted)}`);
    const intent = submitted.value.intent;
    const after = await runOf(runRef);
    const authorization = after.executionAuthorization as ExecutionAuthorizationV2 | undefined;
    const history = after.executionHistory;
    if (authorization === undefined || !('schemaVersion' in authorization) || authorization.schemaVersion !== 2
      || history === undefined || history === null) {
      throw new Error('the S2B timeline control observation requires a V2 entered Run');
    }
    const observation: ControlObservationV1 = {
      schemaVersion: 1, kind: kind === 'pause' ? 'paused' : 'resumed',
      entry: { consumerId: authorization.consumerId, entryGeneration: authorization.generation,
        sessionGeneration: authorization.sessionGeneration },
      history: { ...history },
      source: { ...history.kernel, position: history.observedThroughPosition },
      kernelEventId: eventId(), kernelEventSequence: ++seq, observedAt: at,
    };
    const observed = await controls.recordControlObservation(ctx, {
      input: { intentRef: intent.ref, runRef, observation },
      meta: { requestId: requestId(`observe-${kind}`),
        expected: [{ ref: intent.ref, revision: intent.revision },
          { ref: runRef, revision: submitted.value.runRevision }] },
    });
    if (observed.status !== 'committed') throw new Error(`S2B timeline recordControlObservation(${kind}) failed: ${JSON.stringify(observed)}`);
    return intent.ref;
  }

  async function seedControl(input: { runRef: RunRef; kind: 'pause' | 'resume'; observedAt: string }): Promise<void> {
    const run = await runOf(input.runRef);
    if (run.startedAt === null || input.observedAt < run.startedAt) {
      // Deviation (c): the observation precedes entry.
      return await seedControlRaw(input);
    }
    await submitAndObserve(input.runRef, input.kind, input.observedAt);
  }

  async function seedAnomaly(input: { runRef: RunRef; recordedAt: string }): Promise<void> {
    await flushEnds();
    const session = runSession.get(input.runRef.runId);
    if (session === undefined) throw new Error(`the S2B timeline fixture has no Session for Run ${input.runRef.runId}`);
    clock = input.recordedAt;
    const sessionPin = await b2.base.sessionPin(session);
    const archiveWrite: GraphWrite<RequestSessionArchiveInput> = {
      input: { sessionRef: session, reason: 'S2B timeline archive interruption', tasks: [], wait: null,
        confirmUnknownStopped: false },
      meta: { requestId: requestId('archive-request'), expected: [sessionPin] },
    };
    const requested = await lifecycle.requestSessionArchive(ctx, archiveWrite);
    if (requested.status !== 'committed') throw new Error(`S2B timeline archive request failed: ${JSON.stringify(requested)}`);
    const request = requested.value.archiveRequest;
    if (request === null || request === undefined) throw new Error('the S2B timeline archive request is absent');
    const step: ArchiveStepRefV1 = { sessionRef: session, archiveRequestId: request.requestId,
      requestReceipt: request.receipt, step: 'anchor', subjectKey: canonicalJson(input.runRef as unknown as JsonValue) };
    const anchored = await anomalies.recordSessionAnomaly(ctx, {
      step,
      files: { source: 'kernel', status: 'known', confirmed: [], possible: [], omitted: 0,
        baseCommit: null, runBaselineKnown: false, reason: null },
    });
    if (anchored.status !== 'committed') throw new Error(`S2B timeline anomaly anchor failed: ${JSON.stringify(anchored)}`);
  }

  function checkObservation(at: string, exitCode: number): CheckProcessObservation {
    return { kind: 'executed', startedAt: at, finishedAt: at, exitCode, signal: null, timedOut: false, cancelled: false,
      stdout: { text: '', totalBytes: 0, truncated: false }, stderr: { text: '', totalBytes: 0, truncated: false },
      effects: { workspaceRevision: 's2b-timeline-source', changedPaths: [] },
      sandboxProfileVersion: 's2b-timeline-v1' };
  }

  async function seedRound(input: S2BSeedRoundInput): Promise<void> {
    await flushEnds();
    // The §7 legacy shapes (no `since`) stay at the storage boundary.
    if (input.sinceAt === undefined) return await seedRoundRaw(input);
    const run = await runOf(input.runRef);
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: run.task.projectId, goalId: run.task.goalId };
    const planRef = await activePlanRef(goalRef);
    if (planRef === null) throw new Error('the S2B timeline round needs an active Plan');
    clock = input.sinceAt;
    const opened = await evidence.openVerification(ctx, {
      input: { subjectRunRef: input.runRef, subject: run.task, planRef },
      meta: { requestId: requestId('open-round'), expected: [] },
    });
    if (opened.status !== 'committed') throw new Error(`S2B timeline openVerification failed: ${JSON.stringify(opened)}`);
    let round = opened.value;
    if (input.outcome === 'PASS' || input.outcome === 'FAIL') {
      const check = round.checks[0];
      if (check === undefined) throw new Error('the S2B timeline round compiled no check');
      const ticket = await evidence.beginCheck(ctx, {
        input: { roundRef: round.ref, checkId: check.checkId },
        meta: { requestId: requestId('begin-check'), expected: [{ ref: round.ref, revision: round.revision }] },
      });
      if (ticket.status !== 'committed') throw new Error(`S2B timeline beginCheck failed: ${JSON.stringify(ticket)}`);
      const afterBegin = await evidence.readVerification(ctx, round.ref);
      if (afterBegin.status !== 'ready') throw new Error(`S2B timeline round re-read failed: ${JSON.stringify(afterBegin)}`);
      round = afterBegin.value;
      const recorded = await evidence.recordCheckResult(ctx, {
        input: { roundRef: round.ref, checkId: check.checkId, invocationId: ticket.value.invocationId,
          observation: checkObservation(input.sinceAt, input.outcome === 'PASS' ? 0 : 1) },
        meta: { requestId: requestId('record-check'), expected: [{ ref: round.ref, revision: round.revision }] },
      });
      if (recorded.status !== 'committed') throw new Error(`S2B timeline recordCheckResult failed: ${JSON.stringify(recorded)}`);
      round = recorded.value;
    }
    if ((input.status ?? 'finalized') === 'open') return;
    clock = input.finalizedAt ?? clock;
    const finalized = await evidence.finalizeChecks(ctx, {
      input: { roundRef: round.ref },
      meta: { requestId: requestId('finalize'), expected: [{ ref: round.ref, revision: round.revision }] },
    });
    if (finalized.status !== 'committed') throw new Error(`S2B timeline finalizeChecks failed: ${JSON.stringify(finalized)}`);
  }

  const timeline = async (input: { goalRef: GoalRef; cursor?: string | null; limit: number },
    options?: { readRecordCap?: number }): Promise<ReadResult<TaskStateTimelinePageV1>> => {
    await flushEnds();
    return await createTaskStateTimeline({ records,
      ...(options?.readRecordCap === undefined ? {} : { readRecordCap: options.readRecordCap }) })
      .readTaskStateTimeline(ctx, { goalRef: input.goalRef, cursor: input.cursor ?? null, limit: input.limit });
  };

  function timelineWith(target: S2BTimelineFixture['records'], readRecordCap?: number): TaskTimelineReadPort {
    return createTaskStateTimeline({ records: target,
      ...(readRecordCap === undefined ? {} : { readRecordCap }) });
  }

  await installStaticCompletionPolicy();

  return {
    kind, b2, ctx, records, setClock, clock: () => clock, createGoal, activePlanRef, adoptVersion,
    setGoalDesiredState, seedRun, seedRequeue, seedControl, seedAnomaly, seedRound,
    timeline, timelineWith,
    close: () => b2.close(),
  };
}
