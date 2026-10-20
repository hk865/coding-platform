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
 * Every Run is a real claim, prepared and started by the production Runtime
 * through the shared `S2B-runtime-steps-fixture.ts`; a yielded Run comes from
 * the scripted model calling the real `send_session_message`, and its
 * continuation is a real `claimTask` with the saved `consumedWait`. This file
 * writes no Run, event or activity fact at the storage boundary.
 *
 * Nothing here touches the network.
 */
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../src/contracts/core/identity.js';
import type { ArchiveStepRefV1, RequestSessionArchiveInput } from '../../src/contracts/core/session-archive.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { ControlObservationV1, ControlIntentRef } from '../../src/contracts/control-intent.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { ConsumedWaitV1, ExecutionAuthorizationV2, RunOutcome, RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import type { RoundSnapshot, CheckProcessObservation, TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import { DEFAULT_TASK_AUTOMATION_POLICY, type TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { ClaimTaskInput, RequeueTaskInput } from '../../src/core/work-graph/model/claim-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
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
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-service.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { SESSION_MESSAGE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { SESSION_ANOMALY_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import {
  createTaskStateTimeline, type TaskStateTimelinePageV1, type TaskTimelineReadPort,
} from '../../src/core/work-graph/views/task-state-timeline.js';
import { createB2ExecutionFixture, type B2ExecutionFixture } from './B2-execution-fixture.js';
import { createS2BRuntimeSteps, type S2BRunHandle } from './S2B-runtime-steps-fixture.js';
import type { ClaimFixtureKind } from './task-claim-fixture.js';

/** One slow timeline file may take up to 1,800 s (spec §7 / L-fixtures). */
export const S2B_SLOW_TIMEOUT_MS = 1_800_000;

const OPERATOR = { kind: 'human' as const, id: 'r4c-claim-operator' };
const HOST_INSTANCE = { hostInstanceId: 's2b-timeline-host', lease: 'owned' as const };

/** The extra schema groups the real seed services write through. */
const TIMELINE_SCHEMAS: RecordBackendSchemas = {
  records: [...EVIDENCE_RECORD_SCHEMAS.records, ...CONTROL_RECORD_SCHEMAS.records,
    ...SESSION_ANOMALY_RECORD_SCHEMAS.records, ...ARCHITECTURE_CATALOG_SCHEMAS.records,
    ...COMPLETION_RECORD_SCHEMAS.records, ...SESSION_MESSAGE_RECORD_SCHEMAS.records],
  events: [...EVIDENCE_RECORD_SCHEMAS.events, ...CONTROL_RECORD_SCHEMAS.events,
    ...SESSION_ANOMALY_RECORD_SCHEMAS.events, ...ARCHITECTURE_CATALOG_SCHEMAS.events,
    ...COMPLETION_RECORD_SCHEMAS.events, ...SESSION_LIFECYCLE_RECORD_SCHEMAS.events,
    ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events, ...SESSION_MESSAGE_RECORD_SCHEMAS.events],
  lookups: [...(EVIDENCE_RECORD_SCHEMAS.lookups ?? []), ...(CONTROL_RECORD_SCHEMAS.lookups ?? []),
    ...(SESSION_ANOMALY_RECORD_SCHEMAS.lookups ?? []), ...(ARCHITECTURE_CATALOG_SCHEMAS.lookups ?? []),
    ...(COMPLETION_RECORD_SCHEMAS.lookups ?? []), ...(SESSION_MESSAGE_RECORD_SCHEMAS.lookups ?? [])],
};

export type S2BSeedRunInput = {
  goalRef: GoalRef; runId: string; taskId: string; planRef: PlanRevisionRef;
  startedAt: string | null; endedAt: string | null;
  outcome: RunOutcome | null; status?: RunSnapshot['status']; attemptId?: string;
  /** When set, a `crashed` Run with a paused-interrupted `interrupted_clean` reconciliation. */
  pausedInterrupted?: boolean;
  /** A real continuation after a yielded Run: the saved wait message and reply. */
  consumedWait?: ConsumedWaitV1;
};

export type S2BSeedRoundInput = {
  runRef: RunRef; roundId: string;
  /** `eventAt(since)` reads this instant. */
  sinceAt: string;
  /** VR-07 finalisation; omitted = an open round. */
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
  /** The real scripted yield -> formal reply -> consumedWait continuation. */
  seedYieldedPair(input: {
    goalRef: GoalRef; yieldTaskId: string; replyTaskId: string;
    yieldStartedAt: string; yieldedAt: string;
    replyStartedAt: string; replyEndedAt: string;
    resumeStartedAt: string; resumeEndedAt: string;
  }): Promise<void>;
  seedRequeue(input: { runRef: RunRef; requestedAt: string }): Promise<void>;
  seedControl(input: { runRef: RunRef; kind: 'pause' | 'resume'; observedAt: string }): Promise<void>;
  seedAnomaly(input: { runRef: RunRef; recordedAt: string }): Promise<void>;
  seedRound(input: S2BSeedRoundInput): Promise<void>;
  timeline(input: { goalRef: GoalRef; cursor?: string | null; limit: number }, options?: { readRecordCap?: number }):
    Promise<ReadResult<TaskStateTimelinePageV1>>;
  timelineWith(records: S2BTimelineFixture['records'], readRecordCap?: number): TaskTimelineReadPort;
  close(): Promise<void>;
};

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

  const steps = await createS2BRuntimeSteps({ base: b2.base, bodies: b2.bodies, ctx: b2.ctx,
    directory: b2.base.directory, scope: b2.base.scope, now,
    setClock: (at) => { clock = at; }, eventId, newId, consumerId: 's2b-timeline-runtime',
    withMailbox: true });
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
    await steps.installStaticCompletionPolicy('s2b-timeline-policy');
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
    requeueRef?: TaskRequeueRef, consumedWait?: ConsumedWaitV1): Promise<TaskClaim> {
    const goalRead = await plans.queryGoal(ctx, goalRef);
    if (goalRead.status !== 'ready' || goalRead.value.goal.activePlanRevision === null) {
      throw new Error(`S2B timeline claim Goal read failed: ${JSON.stringify(goalRead)}`);
    }
    const request: GraphWrite<ClaimTaskInput> = {
      input: { goalRef, planRef: goalRead.value.goal.activePlanRevision, taskId, sessionRef,
        roleBinding: b2.base.roleBinding, budget: b2.base.budget,
        ...(requeueRef === undefined ? {} : { requeueRef }),
        ...(consumedWait === undefined ? {} : { consumedWait }) },
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

  async function startRun(claim: TaskClaim, input: S2BSeedRunInput): Promise<S2BRunHandle> {
    const handle = await steps.start(claim, { at: input.startedAt!,
      replies: input.outcome === 'budget_exhausted'
        ? [{ kind: 'calls', calls: [{ callId: `s2b-timeline-budget-${claim.runRef.runId}`,
          name: 'read', args: { path: 'b2-read.txt' } }] }]
        : [{ kind: 'text', text: 'S2B timeline Run finished' }],
      ...(input.outcome === 'budget_exhausted' ? { budget: { maxRequests: 1, maxToolCalls: 1 } } : {}) });
    await handle.entered;
    return handle;
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
  const pendingEnds: { handle: S2BRunHandle; at: string; kind: 'completed' | 'crashed' | 'cancelled' | 'budget_exhausted' }[] = [];

  function finishKind(outcome: RunOutcome): 'completed' | 'crashed' | 'cancelled' | 'budget_exhausted' {
    switch (outcome) {
      case 'completed': return 'completed';
      case 'crashed': return 'crashed';
      case 'cancelled': return 'cancelled';
      case 'budget_exhausted': return 'budget_exhausted';
      default: throw new Error(`the S2B timeline fixture has no real terminal for ${outcome}`);
    }
  }

  async function flushEnds(): Promise<void> {
    for (const pending of pendingEnds.splice(0)) await steps.finish(pending.handle, pending.at, pending.kind);
  }

  async function seedRun(input: S2BSeedRunInput): Promise<RunRef> {
    await flushEnds();
    if (input.outcome === 'yielded') {
      throw new Error('a yielded Run must be produced by the real scripted mailbox flow (seedYieldedPair)');
    }
    const prior = runsForTask.get(input.taskId) ?? 0;
    const requeueRef = pendingRequeue.get(input.taskId);
    if (prior > 0 && requeueRef === undefined && input.consumedWait === undefined) {
      throw new Error('a later Run of the same Task needs a real requeue or a saved continuation wait');
    }
    const session = await newSession();
    const claim = await claimTask(input.goalRef, input.taskId, session, requeueRef, input.consumedWait);
    runsForTask.set(input.taskId, prior + 1);
    pendingRequeue.delete(input.taskId);
    runSession.set(claim.runRef.runId, session);
    if (input.startedAt === null) return claim.runRef;
    const handle = await startRun(claim, input);
    if (input.pausedInterrupted === true) await pauseInterrupted(claim, input.endedAt ?? clock);
    else if (input.outcome === 'outcome_unknown') await reconcileUnknown(claim, input.endedAt ?? clock);
    else if (input.endedAt !== null && input.outcome !== null) {
      pendingEnds.push({ handle, at: input.endedAt, kind: finishKind(input.outcome) });
    }
    return claim.runRef;
  }

  /**
   * TP-094: the real RD-3 yielded Run. The scripted model calls the real
   * `send_session_message` with a durable wait; the Runtime itself books the
   * yielded terminal. A second real Run (another Task) writes the formal reply
   * through the real `respond_session_message` tool, and the continuation is a
   * real claim carrying the saved message and response.
   */
  async function seedYieldedPair(input: {
    goalRef: GoalRef; yieldTaskId: string; replyTaskId: string;
    yieldStartedAt: string; yieldedAt: string;
    replyStartedAt: string; replyEndedAt: string;
    resumeStartedAt: string; resumeEndedAt: string;
  }): Promise<void> {
    const mailbox = steps.mailbox;
    if (mailbox === undefined) throw new Error('the S2B timeline yielded flow needs the real Session mailbox');
    const yieldSession = await newSession();
    const replySession = await newSession();
    const yieldClaim = await claimTask(input.goalRef, input.yieldTaskId, yieldSession);
    runsForTask.set(input.yieldTaskId, 1);
    const yieldHandle = await steps.start(yieldClaim, { at: input.yieldStartedAt,
      tools: ['send_session_message'],
      replies: [
        { kind: 'calls', calls: [{ callId: 's2b-timeline-yield-send', name: 'send_session_message',
          args: { recipient: replySession, text: 'Which file should this work use?', intent: 'inquiry',
            needsReply: true, waitAfterSend: true } }] },
        { kind: 'text', text: 'the inquiry is durably saved' },
      ] });
    await yieldHandle.entered;
    clock = input.yieldedAt;
    yieldHandle.release();
    await yieldHandle.settled;
    const yielded = await runOf(yieldClaim.runRef);
    if (yielded.status !== 'ended' || yielded.outcome !== 'yielded' || yielded.continuation === undefined) {
      throw new Error(`the S2B timeline Run did not yield: ${JSON.stringify(yielded)}`);
    }
    const messageRef = yielded.continuation.messageRef;
    const message = await mailbox.readMessage(ctx, messageRef);
    if (message.status !== 'ready') throw new Error(`the saved wait message is unreadable: ${JSON.stringify(message)}`);
    const replyClaim = await claimTask(input.goalRef, input.replyTaskId, replySession);
    runsForTask.set(input.replyTaskId, 1);
    const replyHandle = await steps.start(replyClaim, { at: input.replyStartedAt,
      tools: ['respond_session_message'],
      replies: [
        { kind: 'calls', calls: [{ callId: 's2b-timeline-reply', name: 'respond_session_message',
          args: { messageRef, expectedRevision: message.value.revision, text: 'Use result.txt.' } }] },
        { kind: 'text', text: 'the formal reply is saved' },
      ] });
    await replyHandle.entered;
    clock = input.replyEndedAt;
    replyHandle.release();
    await replyHandle.settled;
    const replied = await mailbox.readMessage(ctx, messageRef);
    if (replied.status !== 'ready' || replied.value.response === null) {
      throw new Error(`the formal reply is absent: ${JSON.stringify(replied)}`);
    }
    const continuationClaim = await claimTask(input.goalRef, input.yieldTaskId, yieldSession, undefined,
      { runRef: yieldClaim.runRef, messageRef, responseRef: replied.value.response.bodyRef });
    runsForTask.set(input.yieldTaskId, 2);
    const resumeHandle = await steps.start(continuationClaim, { at: input.resumeStartedAt,
      replies: [{ kind: 'text', text: 'the continuation is done' }] });
    await resumeHandle.entered;
    clock = input.resumeEndedAt;
    resumeHandle.release();
    await resumeHandle.settled;
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
    setGoalDesiredState, seedRun, seedYieldedPair, seedRequeue, seedControl, seedAnomaly, seedRound,
    timeline, timelineWith,
    close: async () => { await steps.close(); await b2.close(); },
  };
}
