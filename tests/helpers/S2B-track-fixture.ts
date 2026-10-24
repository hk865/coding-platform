/**
 * Slice 2B BE4 track-bars fixture (L12).
 *
 * What it builds and through which public calls:
 *   - one real RecordStore (memory or SQLite) through the accepted
 *     `createB2ExecutionFixture` (real Goal/Plan/Session/claim/execution-entry
 *     services), registering exactly the schema groups the track read needs:
 *     `EXECUTION_ENTRY_RECORD_SCHEMAS` (RunActivity/ActivityRecording, already
 *     spread by the base) plus `EVIDENCE_RECORD_SCHEMAS`,
 *     `CONTROL_RECORD_SCHEMAS` and `QUERY_JOB_RECORD_SCHEMAS`;
 *   - real Runs claimed by the real `TaskClaimPort`, entered/ended through the
 *     real `ExecutionEntryPort` with a mutable platform clock;
 *   - `RunActivity` records written ONLY through the public
 *     `createRunActivityService`;
 *   - real verification rounds through `createEvidenceService`
 *     (`openVerification` / `beginCheck` / `finalizeChecks`), including a real
 *     Goal-gate round (`gateSubject: 'goal'` with a work producer Run);
 *   - real pause/resume `ControlIntent`s through `createRunControlService`
 *     (`submitControl` + the trusted `recordControlObservation`), so the track
 *     reader sees genuine `applied`/`paused`/`resumed` observations;
 *   - the track read through the public `createTrackReadModel`.
 *
 * The real prepare is wired; entered and end are still handwritten because
 * W1-15 is BLOCKED. No model, no network.
 */
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { withBackendOrderedLookup } from './ordered-lookup-forward.js';
import type { SessionRef, VersionPin, RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import type { ControlObservationV1, ControlIntentRef } from '../../src/contracts/control-intent.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import type { QueryJobRef, QueryRunRef, QueryJobAnswerV1 } from '../../src/contracts/query-job.js';
import { createQueryExecution } from '../../src/core/work-graph/queries/query-execution.js';
import type { QueryEntryIdentity } from '../../src/core/work-graph/queries/contracts.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import type { RunActivityFactsV1, RunActivitySnapshot } from '../../src/contracts/run-activity.js';
import type { ExecutionAuthorizationV2, RunRef, RunSnapshot, RuntimeEventV1 } from '../../src/contracts/dispatch.js';
import type { PlanRevisionDraft, RuntimeTask } from '../../src/contracts/plan.js';
import { DEFAULT_TASK_AUTOMATION_POLICY, type TaskRequeueSnapshotV1 } from '../../src/contracts/task-requeue.js';
import type { RoundSnapshot, TrustedCheckConfiguration } from '../../src/contracts/verification.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { ClaimTaskInput } from '../../src/core/work-graph/model/claim-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createRunActivityService } from '../../src/core/work-graph/tasks/run-activity-service.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { SESSION_ANOMALY_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-service.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { createGoalExecutedFilesReader } from '../../src/core/work-graph/tasks/goal-executed-files-reader.js';
import type { GoalExecutedFilesPort } from '../../src/core/work-graph/model/decision-contracts.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import type {
  AuthorizeConfiguration, ExecutionEntryPort, KernelExecutionBinding, TaskResultObservation,
} from '../../src/core/work-graph/model/execution-entry-contracts.js';
import { createTrackReadModel, type TrackBarsPageV1, type TrackReadPort } from '../../src/core/work-graph/views/track-read-model.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import {
  B2_AT, B2_HOST, createB2ExecutionFixture, type B2ExecutionFixture,
} from './B2-execution-fixture.js';
import { preparationHost, prepareQueryForReal } from './task-claim-fixture.js';
import { installStaticCompletionPolicyFor } from './S2B-runtime-steps-fixture.js';

export type S2BTrackFixtureKind = 'memory' | 'sqlite';

/** The track Goal's work tasks; each accepts exactly one Run per test. */
export const TRACK_WORK_TASK_IDS = ['work-1', 'work-2', 'work-3', 'work-4', 'work-5', 'work-6',
  'work-7', 'work-8', 'work-9', 'work-10', 'work-11', 'work-12'] as const;

const TRACK_SCHEMAS: RecordBackendSchemas = {
  records: [...EVIDENCE_RECORD_SCHEMAS.records, ...CONTROL_RECORD_SCHEMAS.records,
    ...QUERY_JOB_RECORD_SCHEMAS.records, ...ARCHITECTURE_CATALOG_SCHEMAS.records,
    ...COMPLETION_RECORD_SCHEMAS.records, ...SESSION_ANOMALY_RECORD_SCHEMAS.records],
  events: [...EVIDENCE_RECORD_SCHEMAS.events, ...CONTROL_RECORD_SCHEMAS.events,
    ...QUERY_JOB_RECORD_SCHEMAS.events, ...ARCHITECTURE_CATALOG_SCHEMAS.events,
    ...COMPLETION_RECORD_SCHEMAS.events, ...SESSION_ANOMALY_RECORD_SCHEMAS.events,
    ...SESSION_LIFECYCLE_RECORD_SCHEMAS.events,
    ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events],
  lookups: [...(EVIDENCE_RECORD_SCHEMAS.lookups ?? []), ...(CONTROL_RECORD_SCHEMAS.lookups ?? []),
    ...(QUERY_JOB_RECORD_SCHEMAS.lookups ?? []), ...(ARCHITECTURE_CATALOG_SCHEMAS.lookups ?? []),
    ...(COMPLETION_RECORD_SCHEMAS.lookups ?? []), ...(SESSION_ANOMALY_RECORD_SCHEMAS.lookups ?? [])],
};

export type S2BTrackFixture = {
  kind: S2BTrackFixtureKind;
  b2: B2ExecutionFixture;
  ctx: CoreCallContext;
  records: B2ExecutionFixture['base']['records'] & RecordOrderedLookupPort;
  goalRef: GoalRef;
  setClock(at: string): void;
  clock(): string;
  computeSessionRef(): SessionRef;
  newSession(requestId: string): Promise<SessionRef>;
  /** Creates a fresh Goal in the same workspace and adopts its initial plan. */
  createGoalWithPlan(goalId: string, workTaskIds: readonly string[]): Promise<GoalRef>;
  /** A real readonly-copy Session derived from `source` through the session lifecycle. */
  newReadonlyCopy(source: SessionRef, messageId: string): Promise<SessionRef>;
  /** A real QueryJob/QueryRun on `sessionRef`, claimed, entered and answered. */
  submitAndFinishQuery(sessionRef: SessionRef, goalId: string, suffix: string): Promise<QueryRunRef>;
  runAndEnd(taskId: string, sessionRef: SessionRef, startedAt: string, endedAt: string): Promise<RunRef>;
  /** `runAndEnd` with a `run_crashed` terminal, so the Task is requeueable. */
  runAndFail(taskId: string, sessionRef: SessionRef, startedAt: string, endedAt: string): Promise<RunRef>;
  /** `runAndEnd` against an explicit Goal (for cross-Goal conflict fixtures). */
  runAndEndOn(goalRef: GoalRef, taskId: string, sessionRef: SessionRef,
    startedAt: string, endedAt: string): Promise<RunRef>;
  runOpen(taskId: string, sessionRef: SessionRef, startedAt: string): Promise<RunRef>;
  writeActivity(runRef: RunRef, facts: RunActivityFactsV1): Promise<RunActivitySnapshot>;
  ensureRecording(at: string): Promise<void>;
  claimThenCancel(taskId: string, sessionRef: SessionRef, at: string): Promise<RunRef>;
  /** Opens/closes one real `responsible` SessionWorkLink on the track Goal's gate task. */
  linkResponsible(sessionRef: SessionRef, taskId: string): Promise<void>;
  closeResponsible(sessionRef: SessionRef, taskId: string): Promise<void>;
  /** A real start-up reconcile with the `host_instance_takeover` basis on an open Run. */
  reconcileHostTakeover(runRef: RunRef, at: string): Promise<void>;
  /**
   * A real system `requeueTask` after `afterRunRef`, then a claim that carries
   * the recorded `requeueRef`, entered and ended at the given instants.
   */
  requeueRunAndEnd(taskId: string, sessionRef: SessionRef, afterRunRef: RunRef,
    startedAt: string, endedAt: string): Promise<RunRef>;
  goalExecutedFiles(records?: S2BTrackFixture['records']): GoalExecutedFilesPort;
  openRound(subjectRunRef: RunRef, taskId: string): Promise<RoundSnapshot>;
  openGateRound(producerRunRef: RunRef): Promise<RoundSnapshot>;
  beginChecks(round: RoundSnapshot, count: number): Promise<RoundSnapshot>;
  interruptExecutingChecks(round: RoundSnapshot): Promise<RoundSnapshot>;
  finalize(round: RoundSnapshot): Promise<RoundSnapshot>;
  /** The real pause/resume control pair on an entered Run at the given instants. */
  pauseThenResume(runRef: RunRef, pausedAt: string, resumedAt: string): Promise<{ pause: ControlIntentRef; resume: ControlIntentRef }>;
  readTrack(input: { from: string; to: string; cursor?: string | null; limit?: number; sessionRefs?: SessionRef[] },
    options?: { readRecordCap?: number }): Promise<ReadResult<TrackBarsPageV1>>;
  track(records?: S2BTrackFixture['records'], readRecordCap?: number): TrackReadPort;
  close(): Promise<void>;
};

export async function openS2BTrackFixture(kind: S2BTrackFixtureKind = 'memory'): Promise<S2BTrackFixture> {
  const b2 = await createB2ExecutionFixture(kind, TRACK_SCHEMAS);
  const baseRecords = b2.base.records;
  const records = baseRecords as unknown as B2ExecutionFixture['base']['records'] & RecordOrderedLookupPort;

  let clock = B2_AT;
  let seq = 0;
  const eventId = (): string => `s2b-track-event-${++seq}`;
  const newId = (): string => `s2b-track-id-${++seq}`;
  const now = (): string => clock;
  const requestId = (prefix: string): string => `s2b-track-${prefix}-${++seq}`;

  const authorizeConfiguration: AuthorizeConfiguration = async (ctx, config) => {
    if (ctx.projectId !== b2.base.scope.projectId || ctx.workspaceId !== b2.base.scope.workspaceId
      || config.configurationRevision !== B2_HOST.configurationRevision
      || canonicalJson(config.permissions) !== canonicalJson(B2_HOST.permissions)
      || canonicalJson(config.hostTemplate) !== canonicalJson(B2_HOST.hostTemplate)) {
      return { status: 'rejected', code: 'forbidden', reason: 'the S2B track fixture Host does not authorize this configuration' };
    }
    return { status: 'ready', value: structuredClone(B2_HOST) };
  };

  const entry: ExecutionEntryPort = createExecutionEntryService({
    records: baseRecords,
    reads: createRunStateReader({ records: baseRecords }),
    roles: createRoleConfigurationService({ records: baseRecords, now, eventId }),
    bodies: b2.bodies,
    authorizeConfiguration, now, eventId, newId,
  });
  const activity = createRunActivityService({ records, now, eventId });
  const runReads = createRunStateReader({ records: baseRecords });

  const materialAuthority = createMaterialRecordReaders(baseRecords).authority;
  const evidenceConfiguration: TrustedCheckConfiguration = {
    configurationRevision: 's2b-track-checks', workspace: b2.base.workspaceRef,
    executor: { kind: 'human', id: 'r4c-claim-operator' },
    permissionRevision: 's2b-track-permission',
    sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: [],
    checks: [1, 2, 3, 4].map((n) => ({ checkId: `check-${String(n)}`, kind: 'static', command: 'fixture-check',
      cwd: '.', timeoutMs: 1000, taskIds: 'all' })),
  };
  const evidence = createEvidenceService({
    records: baseRecords,
    executions: runReads,
    materials: createMaterialService({ bodies: b2.bodies, authority: materialAuthority, now }),
    workspaceHost: {
      async resolveRoot() { return { status: 'ready' as const, value: { root: b2.base.directory, workspaceRevision: 1 } }; },
      async authorize() { return { status: 'ready' as const, value: { subjectKey: 's2b-track-host',
        permissionRevision: 's2b-track-permission', allowsRead: () => true } }; },
    },
    source: { async capture() { return { status: 'ready' as const, sourceDigest: sha256Hex('s2b-track-source'),
      sourceProof: { kind: 'current-workspace-only' as const, runBaselineKnown: false },
      changeScope: { diffClass: 'code-change', changedFiles: ['src/s2b/track.ts'], writeSummary: 's2b track source' },
      gaps: [] }; } },
    configuration: evidenceConfiguration,
    automationPolicy: () => DEFAULT_TASK_AUTOMATION_POLICY,
    now, newId,
  });

  const controls = createRunControlService({
    records: baseRecords,
    authority: materialAuthority,
    reads: runReads,
    now, eventId,
  });

  /** The real Session lifecycle owner (`linkSessionWork`), over the same store. */
  const lifecycle = createSessionLifecycleService({ records: baseRecords, lookups: baseRecords });

  /**
   * The real requeue owner. Its `messages` seam is only reached for a
   * `newInputRefs` request, which this fixture never passes; the source digest
   * seam is a deterministic fixture value the track read does not assert.
   */
  const requeueService = createTaskRequeueService({
    records: baseRecords, reads: runReads,
    workspaceHost: { async resolveRoot() {
      return { status: 'ready' as const, value: { root: b2.base.directory, workspaceRevision: 1 } }; } },
    source: { async captureDigest() {
      return { status: 'ready' as const, sourceDigest: sha256Hex('s2b-track-requeue-source') }; } },
    materials: createMaterialService({ bodies: b2.bodies, authority: materialAuthority, now }),
    messages: { async readMessage() { return { status: 'not_found' as const }; } },
    now, eventId,
  });

  function setClock(at: string): void { clock = at; }

  async function runPin(claim: TaskClaim): Promise<VersionPin> {
    const read = await runReads.readExecution(b2.ctx, claim.runRef);
    if (read.status !== 'ready') throw new Error(`S2B Run read failed: ${JSON.stringify(read)}`);
    return { ref: claim.runRef, revision: read.value.run.revision };
  }

  /** The current revision of any record (0 when absent), for a write's expected pins. */
  async function pinOf(ref: object): Promise<VersionPin> {
    const key = canonicalJson(ref as never);
    const read = await records.readMany([key]);
    if (read.status !== 'ready') throw new Error(`S2B pin read failed: ${JSON.stringify(read)}`);
    const record = read.value.records.find((candidate) => candidate.refKey === key);
    return { ref: ref as VersionPin['ref'], revision: record?.revision ?? 0 };
  }

  /**
   * Registers and activates a real `requirementKinds: ['static']` completion
   * policy through the public project-bootstrap install/activate operations, so
   * the track Goal's plan pins a policy whose kind matches the trusted static
   * command checks and the compiled round really carries checks. Copied from
   * the accepted `S2B-activity-fixture.ts` governance-seeding step.
   */
  async function installStaticCompletionPolicy(): Promise<void> {
    await installStaticCompletionPolicyFor({ base: b2.base, ctx: b2.ctx, records: baseRecords, now, eventId,
      policyId: 's2b-track-policy' });
  }

  async function adoptInitialPlan(goalRef: GoalRef, workTaskIds: readonly string[]): Promise<void> {
    const goalRead = await b2.base.plans.queryGoal(b2.ctx, goalRef);
    if (goalRead.status !== 'ready') throw new Error(`S2B plan goal read failed: ${JSON.stringify(goalRead)}`);
    const tasks: RuntimeTask[] = [
      ...workTaskIds.map((taskId) => ({ taskId, title: `S2B track ${taskId}`, requirementLevel: 'required',
        taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } } as RuntimeTask)),
      { taskId: 'gate-1', title: 'S2B track gate', requirementLevel: 'required',
        taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ];
    const draft: PlanRevisionDraft = {
      schemaVersion: 2, planId: `${goalRef.goalId}-plan`, planRevision: 1, goalId: goalRef.goalId,
      stages: [], tasks,
      assignments: workTaskIds.map((taskId) => ({ taskId, role: 'builder', instruction: `Do ${taskId}` })),
      obligations: [{ obligationId: 's2b-track-obligation', title: 'S2B track work',
        requirementLevel: 'required', taskIds: [...workTaskIds, 'gate-1'],
        verificationRequirements: [{ requirementId: 's2b-track-check', requirementLevel: 'required',
          kind: 'static', description: 'S2B track work is verified' }] }],
      taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
    };
    const proposed = await b2.base.plans.proposePlan(b2.ctx, {
      input: { goalRef, basedOn: null, draft, reason: { text: 'S2B track initial plan', sources: [] } },
      meta: { requestId: requestId('plan-propose'), expected: [{ ref: goalRef, revision: goalRead.value.goal.revision }] },
    });
    if (proposed.status !== 'committed' || proposed.value.issues.length !== 0) {
      throw new Error(`S2B initial plan proposal failed: ${JSON.stringify(proposed)}`);
    }
    const applied = await b2.base.plans.applyPlanChange(b2.ctx, {
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
      meta: { requestId: requestId('plan-apply'), expected: [{ ref: goalRef, revision: goalRead.value.goal.revision }] },
    });
    if (applied.status !== 'committed') throw new Error(`S2B initial plan apply failed: ${JSON.stringify(applied)}`);
  }

  /** Creates a fresh Goal in the same workspace and adopts its initial plan. */
  async function createGoalWithPlan(goalId: string, workTaskIds: readonly string[]): Promise<GoalRef> {
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: b2.base.scope.projectId, goalId };
    const created = await b2.base.goals.createGoal(b2.ctx, {
      meta: { requestId: requestId('create-goal'), expected: [
        { ref: b2.base.projectRef, revision: 1 }, { ref: b2.base.workspaceRef, revision: 1 },
      ] },
      input: { goalId, workspace: b2.base.scope, objective: `S2B track ${goalId}` },
    });
    if (created.status !== 'committed') throw new Error(`S2B Goal ${goalId} creation failed: ${JSON.stringify(created)}`);
    await adoptInitialPlan(goalRef, workTaskIds);
    return goalRef;
  }

  async function claim(taskId: string, sessionRef: SessionRef,
    requeue?: { ref: TaskRequeueSnapshotV1['ref']; budget: TaskRequeueSnapshotV1['budget'] },
    goalRef: GoalRef = trackGoalRef): Promise<TaskClaim> {
    const goalRead = await b2.base.plans.queryGoal(b2.ctx, goalRef);
    if (goalRead.status !== 'ready') throw new Error(`S2B goal read failed: ${JSON.stringify(goalRead)}`);
    const planRef = goalRead.value.goal.activePlanRevision;
    if (planRef === null) throw new Error('the S2B track Goal has no accepted plan');
    const request: GraphWrite<ClaimTaskInput> = {
      input: { goalRef, planRef, taskId, sessionRef,
        roleBinding: b2.base.roleBinding, budget: b2.base.budget,
        ...(requeue === undefined ? {} : { requeueRef: requeue.ref,
          ...(requeue.budget === null ? {} : { budget: requeue.budget }) }) },
      meta: { requestId: requestId('claim'), expected: [
        { ref: goalRef, revision: goalRead.value.goal.revision },
        { ref: b2.base.workspaceRef, revision: 1 },
        await b2.base.sessionPin(sessionRef),
      ] },
    };
    const claimed = await b2.base.service.claimTask(b2.ctx, request);
    if (claimed.status !== 'committed') throw new Error(`S2B claim failed: ${JSON.stringify(claimed)}`);
    return claimed.value;
  }

  async function enter(claim: TaskClaim, at: string): Promise<KernelExecutionBinding> {
    clock = at;
    // The real preparation carries a requeue Run's C3 continuation brief and
    // its byte budget; never append it to a saved manifest a second time.
    const prepared = await b2.buildPrepared({ claim });
    const sessionKernel = await b2.kernelFor(claim);
    const kernel: KernelExecutionBinding = { ...sessionKernel,
      runId: `${claim.runRef.runId}-kernel`, turnId: `${claim.runRef.runId}-turn` };
    const authorized = await entry.authorizeRuntimeEntry(b2.ctx, {
      input: { prepared, consumerId: 's2b-track-runtime' },
      meta: { requestId: requestId('authorize'), expected: [await runPin(claim)] },
    });
    if (authorized.status !== 'committed') throw new Error(`S2B authorize failed: ${JSON.stringify(authorized)}`);
    const begun = await entry.beginRuntimeEntry(b2.ctx, {
      input: { permit: authorized.value, kernel },
      meta: { requestId: requestId('begin'), expected: [await runPin(claim)] },
    });
    if (begun.status !== 'committed') throw new Error(`S2B begin failed: ${JSON.stringify(begun)}`);
    const entered = await entry.recordExecutionEntered(b2.ctx, {
      input: {
        permit: { ...authorized.value, authorizationRevision: begun.value.authorization.revision },
        enteredAt: at, kernelSource: { ...kernel, position: 3 },
        history: { kernel, startPosition: 2, observedThroughPosition: 3, endPosition: null },
      },
      meta: { requestId: requestId('entered'), expected: [await runPin(claim)] },
    });
    if (entered.status !== 'committed') throw new Error(`S2B entered failed: ${JSON.stringify(entered)}`);
    return kernel;
  }

  function terminalEvent(run: RunSnapshot, at: string,
    kind: 'completed' | 'crashed' = 'completed'): RuntimeEventV1 {
    return kind === 'crashed'
      ? { eventType: 'run_crashed', schemaVersion: 1, eventId: eventId(),
        runRef: run.ref, sequence: run.lastEventSeq + 1, occurredAt: at,
        payload: { kind: 'crashed', error: 'S2B fixture run failed' } }
      : { eventType: 'run_completed', schemaVersion: 1, eventId: eventId(),
        runRef: run.ref, sequence: run.lastEventSeq + 1, occurredAt: at, payload: { kind: 'completed', exitCode: 0 } };
  }

  async function end(claim: TaskClaim, at: string, kind: 'completed' | 'crashed' = 'completed'): Promise<RunSnapshot> {
    clock = at;
    const current = await runReads.readExecution(b2.ctx, claim.runRef);
    if (current.status !== 'ready') throw new Error(`S2B end read failed: ${JSON.stringify(current)}`);
    const run = current.value.run;
    const authorization = run.executionAuthorization;
    const history = run.executionHistory;
    if (authorization === undefined || authorization === null || !('schemaVersion' in authorization)
      || authorization.schemaVersion !== 2 || history === undefined || history === null) {
      throw new Error('S2B end requires an entered Run with its saved authorization/history');
    }
    const position = history.observedThroughPosition + 1;
    const source = { ...history.kernel, position };
    const observation: TaskResultObservation = {
      claim, entry: { consumerId: authorization.consumerId, entryGeneration: authorization.generation },
      event: terminalEvent(run, at, kind), kernelSource: source,
      completedHistoryBoundary: { source, cursor: `s2b-boundary-${run.ref.runId}-${String(position)}` },
      history: { kernel: history.kernel, startPosition: history.startPosition,
        observedThroughPosition: position, endPosition: position },
    };
    const result = await entry.recordRunResult(b2.ctx, {
      input: observation, meta: { requestId: requestId('end'), expected: [await runPin(claim)] },
    });
    if (result.status !== 'committed') throw new Error(`S2B end failed: ${JSON.stringify(result)}`);
    return result.value;
  }

  async function runAndEnd(taskId: string, sessionRef: SessionRef, startedAt: string, endedAt: string): Promise<RunRef> {
    const claimed = await claim(taskId, sessionRef);
    await enter(claimed, startedAt);
    const ended = await end(claimed, endedAt);
    return ended.ref;
  }

  /** Claims, enters and ends a Run with a `run_crashed` terminal (requeueable work). */
  async function runAndFail(taskId: string, sessionRef: SessionRef, startedAt: string, endedAt: string): Promise<RunRef> {
    const claimed = await claim(taskId, sessionRef);
    await enter(claimed, startedAt);
    const ended = await end(claimed, endedAt, 'crashed');
    return ended.ref;
  }

  async function runAndEndOn(goalRef: GoalRef, taskId: string, sessionRef: SessionRef,
    startedAt: string, endedAt: string): Promise<RunRef> {
    const claimed = await claim(taskId, sessionRef, undefined, goalRef);
    await enter(claimed, startedAt);
    const ended = await end(claimed, endedAt);
    return ended.ref;
  }

  async function runOpen(taskId: string, sessionRef: SessionRef, startedAt: string): Promise<RunRef> {
    const claimed = await claim(taskId, sessionRef);
    await enter(claimed, startedAt);
    return claimed.runRef;
  }

  async function writeActivity(runRef: RunRef, facts: RunActivityFactsV1): Promise<RunActivitySnapshot> {
    const result = await activity.recordRunActivity(b2.ctx, {
      input: { runRef, facts }, meta: { requestId: requestId('activity'), expected: [] },
    });
    if (result.status !== 'committed') throw new Error(`S2B activity write failed: ${JSON.stringify(result)}`);
    return result.value.snapshot;
  }

  async function ensureRecording(at: string): Promise<void> {
    clock = at;
    const result = await activity.ensureActivityRecording(b2.ctx, {
      input: { workspace: b2.base.scope }, meta: { requestId: requestId('recording'), expected: [] },
    });
    if (result.status !== 'committed') throw new Error(`S2B recording failed: ${JSON.stringify(result)}`);
  }

  /** Claims a Task and cancels it before entry (RUN-09), so the Run has no history. */
  async function claimThenCancel(taskId: string, sessionRef: SessionRef, at: string): Promise<RunRef> {
    clock = at;
    const claimed = await claim(taskId, sessionRef);
    const read = await runReads.readExecution(b2.ctx, claimed.runRef);
    if (read.status !== 'ready') throw new Error(`S2B not-entered Run read failed: ${JSON.stringify(read)}`);
    const cancelled = await controls.submitControl(b2.ctx, {
      input: { runRef: claimed.runRef, kind: 'cancel', reason: 'S2B track not-entered cancel' },
      meta: { requestId: requestId('cancel-not-entered'),
        expected: [{ ref: claimed.runRef, revision: read.value.run.revision }] },
    });
    if (cancelled.status !== 'committed') throw new Error(`S2B not-entered cancel failed: ${JSON.stringify(cancelled)}`);
    return claimed.runRef;
  }

  /** Opens or closes one real `responsible` SessionWorkLink on the given task. */
  async function setResponsible(sessionRef: SessionRef, taskId: string, active: boolean): Promise<void> {
    const target = { kind: 'task' as const, ref: { projectId: b2.base.scope.projectId,
      goalId: trackGoalRef.goalId, taskId } };
    const linkRef = { aggregateType: 'SessionWorkLink' as const, projectId: b2.base.scope.projectId,
      sessionId: sessionRef.sessionId, target, relation: 'responsible' as const };
    const linkKey = canonicalJson(linkRef as never);
    const linkRead = await records.readMany([linkKey]);
    if (linkRead.status !== 'ready') throw new Error(`S2B responsible link read failed: ${JSON.stringify(linkRead)}`);
    const linkRecord = linkRead.value.records.find((record) => record.refKey === linkKey);
    const result = await lifecycle.linkSessionWork(b2.ctx, {
      input: { sessionRef, relation: 'responsible', active, target },
      meta: { requestId: requestId(`responsible-${active ? 'open' : 'close'}`), expected: [
        await b2.base.sessionPin(sessionRef), { ref: linkRef, revision: linkRecord?.revision ?? 0 },
      ] },
    });
    if (result.status !== 'committed') throw new Error(`S2B responsible link failed: ${JSON.stringify(result)}`);
  }

  /**
   * A real start-up reconcile with the `host_instance_takeover` basis on an open
   * Run (RUN-19/24), so the Run carries the reconciliation the track read turns
   * into `hostRestarts`.
   */
  async function reconcileHostTakeover(runRef: RunRef, at: string): Promise<void> {
    clock = at;
    const reconcile = createRunReconcileService({ records: baseRecords, reads: runReads,
      hostInstance: { hostInstanceId: 's2b-track-host', lease: 'owned' }, now, eventId });
    const read = await runReads.readExecution(b2.ctx, runRef);
    if (read.status !== 'ready') throw new Error(`S2B reconcile Run read failed: ${JSON.stringify(read)}`);
    const result = await reconcile.reconcileRun(b2.ctx, {
      input: { runRef, basis: { kind: 'host_instance_takeover', hostInstanceId: 's2b-track-host' },
        probe: 'ready', result: { kind: 'interrupted_clean', turn: { terminal: false, inFlightToolCallIds: [],
          lastPosition: 3, kernelPaused: false, entered: null, acceptedSteers: [], inputsConfirmed: true } } },
      meta: { requestId: requestId('reconcile-takeover'), expected: [{ ref: runRef, revision: read.value.run.revision }] },
    });
    if (result.status !== 'committed') throw new Error(`S2B host takeover reconcile failed: ${JSON.stringify(result)}`);
  }

  async function requeueRunAndEnd(taskId: string, sessionRef: SessionRef, afterRunRef: RunRef,
    startedAt: string, endedAt: string): Promise<RunRef> {
    const goalRead = await b2.base.plans.queryGoal(b2.ctx, trackGoalRef);
    if (goalRead.status !== 'ready') throw new Error(`S2B requeue goal read failed: ${JSON.stringify(goalRead)}`);
    const runRead = await runReads.readExecution(b2.ctx, afterRunRef);
    if (runRead.status !== 'ready') throw new Error(`S2B requeue Run read failed: ${JSON.stringify(runRead)}`);
    const queued = await requeueService.requeueTask(b2.ctx, {
      input: { taskRef: { projectId: b2.base.scope.projectId, goalId: trackGoalRef.goalId, taskId },
        afterRunRef, reason: 'S2B track system requeue' },
      meta: { requestId: requestId('requeue'), expected: [
        { ref: trackGoalRef, revision: goalRead.value.goal.revision },
        { ref: afterRunRef, revision: runRead.value.run.revision },
      ] },
    });
    if (queued.status !== 'committed' || queued.value.kind !== 'requeued') {
      throw new Error(`S2B requeueTask failed: ${JSON.stringify(queued)}`);
    }
    const claimed = await claim(taskId, sessionRef, { ref: queued.value.requeue.ref, budget: queued.value.requeue.budget });
    await enter(claimed, startedAt);
    const ended = await end(claimed, endedAt);
    return ended.ref;
  }

  /**
   * A real readonly-copy Session derived from `source` with a `readonly_copy`
   * provenance naming `messageId`, through the two real lifecycle writers
   * `runtime.createSession` drives (never an overwrite of an existing Session).
   */
  async function newReadonlyCopy(source: SessionRef, messageId: string): Promise<SessionRef> {
    const role: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
    const admitted = await b2.base.sessionsPort.admitSessionCreation(b2.ctx, {
      meta: { requestId: requestId('admit-copy'), expected: [] },
      input: { workspace: b2.base.scope, kernelStore: { adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store' },
        role, recommendedRefs: [], initialLinks: [],
        provenance: { schemaVersion: 1, kind: 'readonly_copy', from: source,
          messageRef: { aggregateType: 'SessionMessage', projectId: b2.base.scope.projectId,
            workspaceId: b2.base.scope.workspaceId, messageId } } },
    });
    if (admitted.status !== 'committed') throw new Error(`S2B copy admission failed: ${JSON.stringify(admitted)}`);
    const registered = await b2.base.sessionsPort.recordSessionCreated(b2.ctx, {
      meta: { requestId: requestId('register-copy'), expected: [] },
      input: { operationRef: admitted.value.ref, sessionRef: admitted.value.action.plannedSessionRef,
        adapterId: 'r4c-claim-kernel', kernelSessionId: `s2b-track-copy-${messageId}`,
        historyCursor: null, observedAt: clock },
    });
    if (registered.status !== 'committed') throw new Error(`S2B copy registration failed: ${JSON.stringify(registered)}`);
    return { projectId: registered.value.ref.projectId, sessionId: registered.value.ref.sessionId };
  }

  /**
   * One real QueryJob/QueryRun pair on `sessionRef` for `goalId`, claimed,
   * entered and answered through the public Query owners. The track read only
   * needs the ended QueryRun and its recorded execution Session.
   */
  async function submitAndFinishQuery(sessionRef: SessionRef, goalId: string, suffix: string): Promise<QueryRunRef> {
    const queryBudget = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
      maxRequests: 4, maxToolCalls: 8, timeoutMs: null, perResponseTokens: 512 };
    const host = { configurationRevision: 's2b-track-query-host',
      permissions: { tools: ['read'], writeScope: [] as [] }, hostTemplate: B2_HOST.hostTemplate, budget: queryBudget };
    const queryRoles = createRoleConfigurationService({ records: baseRecords, now, eventId });
    const owner = createQueryExecution({ records: withBackendOrderedLookup(baseRecords, baseRecords), roles: queryRoles, bodies: b2.bodies,
      authorizeConfiguration: async () => ({ status: 'ready' as const, value: host }), now, eventId });
    const jobs = createQueryJobService({ records: baseRecords, execution: owner, now, eventId });
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: b2.base.scope.projectId, goalId };
    const jobRef: QueryJobRef = { aggregateType: 'QueryJob', ...b2.base.scope, queryJobId: `s2b-track-qj-${suffix}` };
    const runRef: QueryRunRef = { aggregateType: 'QueryRun', ...b2.base.scope,
      queryJobId: jobRef.queryJobId, runId: `s2b-track-qr-${suffix}` };
    const question = `S2B track query ${suffix}`;
    const submitted = await jobs.submitQueryJob(b2.ctx, {
      input: { queryJobId: jobRef.queryJobId, runId: runRef.runId,
        intent: { schemaVersion: 1, intentId: jobRef.queryJobId, ...b2.base.scope, goalId, question,
          focusTaskRefs: [], budget: { maxTokens: null, deadline: null }, multiTurn: { maxRounds: 1 },
          correlationId: `s2b-track-${suffix}`,
          execution: { kind: 'semantic_query', roleBinding: b2.base.roleBinding, runtimeBudget: queryBudget } } },
      meta: { requestId: requestId('query-submit'), expected: [
        await pinOf(b2.base.projectRef), await pinOf(b2.base.workspaceRef), await pinOf(goalRef),
        { ref: jobRef, revision: 0 }, { ref: runRef, revision: 0 },
      ] },
    });
    if (submitted.status !== 'committed') throw new Error(`S2B query submit failed: ${JSON.stringify(submitted)}`);
    let record = await owner.claimQuery(b2.ctx, { input: { queryRunRef: runRef, sessionRef },
      meta: { requestId: requestId('query-claim'), expected: [
        await pinOf(jobRef), await pinOf(runRef), await b2.base.sessionPin(sessionRef),
      ] } });
    if (record.status !== 'committed') throw new Error(`S2B query claim failed: ${JSON.stringify(record)}`);
    const prepared = (await prepareQueryForReal({ records: baseRecords, ctx: b2.ctx }, {
      bodies: b2.bodies, queryRunRef: runRef, queryExecution: owner, now: () => clock,
      requestId: requestId('query-prepare'),
      host: preparationHost({ configurationRevision: host.configurationRevision,
        permissions: host.permissions, hostTemplate: host.hostTemplate, budget: queryBudget }),
    })).prepared;
    const preparedState = await owner.readQueryExecution(b2.ctx, runRef);
    if (preparedState.status !== 'ready') throw new Error(`S2B query read failed: ${JSON.stringify(preparedState)}`);
    const kernel = { adapterId: preparedState.value.session.kernel.adapterId,
      kernelSessionId: preparedState.value.session.kernel.kernelSessionId,
      runId: `${runRef.runId}-kernel`, turnId: `${runRef.runId}-turn` };
    const ticket = await owner.beginQueryEntry(b2.ctx, { input: {
      prepared, consumerId: `s2b-track-query-${suffix}`, kernel },
      meta: { requestId: requestId('query-begin'), expected: [
        { ref: jobRef, revision: preparedState.value.job.revision },
        { ref: runRef, revision: preparedState.value.run.revision },
        { ref: preparedState.value.session.ref, revision: preparedState.value.session.revision },
      ] } });
    if (ticket.status !== 'committed') throw new Error(`S2B query begin failed: ${JSON.stringify(ticket)}`);
    const entry: QueryEntryIdentity = { queryRunRef: runRef, sessionRef: ticket.value.sessionRef,
      sessionGeneration: ticket.value.sessionGeneration, entryGeneration: 1,
      consumerId: ticket.value.consumerId, kernel: ticket.value.kernel };
    const entered = await owner.recordQueryObservation(b2.ctx, { input: { entry,
      history: { schemaVersion: 1, sessionRef: entry.sessionRef, kernel: entry.kernel,
        startPosition: 1, observedThroughPosition: 2, endPosition: null },
      source: { position: 2, cursor: `s2b-track-${suffix}-entered` },
      observation: { kind: 'entered', occurredAt: clock } },
      meta: { requestId: requestId('query-entered'), expected: [await pinOf(runRef)] } });
    if (entered.status !== 'committed') throw new Error(`S2B query entered failed: ${JSON.stringify(entered)}`);
    const answerText = `S2B track answer ${suffix}`;
    const answerBody = await b2.bodies.put({ body: answerText, contentType: 'text/plain; charset=utf-8',
      sourceRefs: [prepared.bundleRef.source],
      origin: { kind: 'run', owner: runRef }, requestedAt: clock });
    if (answerBody.status !== 'ready') throw new Error(`S2B query answer store failed: ${JSON.stringify(answerBody)}`);
    const answer: QueryJobAnswerV1 = { schemaVersion: 1, answerId: `s2b-track-a-${suffix}`, queryJobRef: jobRef,
      runRef, roundIndex: 0, answer: answerText, sources: [], followsAnswerRef: null, stale: false,
      staleReason: null, answeredAt: clock, bodyRef: answerBody.value.ref, ideas: [], goalCardDrafts: [] };
    const done = await owner.recordQueryObservation(b2.ctx, { input: { entry,
      history: { schemaVersion: 1, sessionRef: entry.sessionRef, kernel: entry.kernel,
        startPosition: 1, observedThroughPosition: 3, endPosition: 3 },
      source: { position: 3, cursor: `s2b-track-${suffix}-answered` },
      observation: { kind: 'terminal', occurredAt: clock, outcome: 'answered', answer, reason: null, answerCheck: null } },
      meta: { requestId: requestId('query-answered'),
        expected: [{ ref: runRef, revision: entered.value.run.revision }] } });
    if (done.status !== 'committed') throw new Error(`S2B query answer failed: ${JSON.stringify(done)}`);
    return runRef;
  }

  function goalExecutedFiles(target: S2BTrackFixture['records'] = records): GoalExecutedFilesPort {
    return createGoalExecutedFilesReader({ records: target });
  }

  async function openRoundInternal(
    subjectRunRef: RunRef, taskId: string, gateSubject: 'goal' | 'stage' | 'module' | undefined,
  ): Promise<RoundSnapshot> {
    const goalRead = await b2.base.plans.queryGoal(b2.ctx, trackGoalRef);
    if (goalRead.status !== 'ready' || goalRead.value.goal.activePlanRevision === null) {
      throw new Error('the S2B track Goal has no accepted plan');
    }
    const result = await evidence.openVerification(b2.ctx, {
      input: { subjectRunRef,
        subject: { projectId: trackGoalRef.projectId, goalId: trackGoalRef.goalId, taskId },
        planRef: goalRead.value.goal.activePlanRevision,
        ...(gateSubject === undefined ? {} : { gateSubject }) },
      meta: { requestId: requestId('open-round'), expected: [] },
    });
    if (result.status !== 'committed') throw new Error(`S2B openVerification failed: ${JSON.stringify(result)}`);
    return result.value;
  }

  async function beginChecks(round: RoundSnapshot, count: number): Promise<RoundSnapshot> {
    let current = round;
    for (const check of round.checks.slice(0, count)) {
      const ticket = await evidence.beginCheck(b2.ctx, {
        input: { roundRef: current.ref, checkId: check.checkId },
        meta: { requestId: requestId('begin-check'), expected: [{ ref: current.ref, revision: current.revision }] },
      });
      if (ticket.status !== 'committed') throw new Error(`S2B beginCheck failed: ${JSON.stringify(ticket)}`);
      const read = await evidence.readVerification(b2.ctx, current.ref);
      if (read.status !== 'ready') throw new Error(`S2B round read failed: ${JSON.stringify(read)}`);
      current = read.value;
    }
    return current;
  }

  async function interruptExecutingChecks(round: RoundSnapshot): Promise<RoundSnapshot> {
    let current = round;
    for (const check of round.checks) {
      if (check.invocationId === null) continue;
      const result = await evidence.interruptCheck!(b2.ctx, {
        input: { roundRef: current.ref, checkId: check.checkId, invocationId: check.invocationId,
          cause: 'ticket_invalid', ticketProblem: 'the S2B track fixture freezes the ticket as incomplete' },
        meta: { requestId: requestId('interrupt-check'), expected: [{ ref: current.ref, revision: current.revision }] },
      });
      if (result.status !== 'committed') throw new Error(`S2B interruptCheck failed: ${JSON.stringify(result)}`);
      current = result.value;
    }
    return current;
  }

  async function finalize(round: RoundSnapshot): Promise<RoundSnapshot> {
    const result = await evidence.finalizeChecks(b2.ctx, {
      input: { roundRef: round.ref },
      meta: { requestId: requestId('finalize'), expected: [{ ref: round.ref, revision: round.revision }] },
    });
    if (result.status !== 'committed') throw new Error(`S2B finalize failed: ${JSON.stringify(result)}`);
    return result.value.snapshot;
  }

  /**
   * The real pause then resume: `submitControl` queues the intent and moves the
   * Run pointer; the trusted `recordControlObservation` writes the genuine
   * applied observation at `pausedAt`/`resumedAt`.
   */
  async function pauseThenResume(
    runRef: RunRef, pausedAt: string, resumedAt: string,
  ): Promise<{ pause: ControlIntentRef; resume: ControlIntentRef }> {
    const pause = await submitAndObserve(runRef, 'pause', pausedAt);
    const resume = await submitAndObserve(runRef, 'resume', resumedAt);
    return { pause, resume };
  }

  async function submitAndObserve(runRef: RunRef, kind: 'pause' | 'resume' | 'cancel', at: string): Promise<ControlIntentRef> {
    clock = at;
    const before = await runReads.readExecution(b2.ctx, runRef);
    if (before.status !== 'ready') throw new Error(`S2B control Run read failed: ${JSON.stringify(before)}`);
    const submitted = await controls.submitControl(b2.ctx, {
      input: { runRef, kind, reason: null },
      meta: { requestId: requestId(`submit-${kind}`),
        expected: [{ ref: runRef, revision: before.value.run.revision }] },
    });
    if (submitted.status !== 'committed') throw new Error(`S2B submitControl(${kind}) failed: ${JSON.stringify(submitted)}`);
    const intent = submitted.value.intent;
    const after = await runReads.readExecution(b2.ctx, runRef);
    if (after.status !== 'ready') throw new Error(`S2B control Run re-read failed: ${JSON.stringify(after)}`);
    const run = after.value.run;
    const authorization = run.executionAuthorization as ExecutionAuthorizationV2 | undefined;
    const history = run.executionHistory;
    if (authorization === undefined || authorization === null || !('schemaVersion' in authorization)
      || authorization.schemaVersion !== 2 || history === undefined || history === null) {
      throw new Error('S2B control observation requires a V2 entered Run');
    }
    const observation: ControlObservationV1 = {
      schemaVersion: 1, kind: kind === 'pause' ? 'paused' : kind === 'resume' ? 'resumed' : 'cancelled',
      entry: { consumerId: authorization.consumerId, entryGeneration: authorization.generation,
        sessionGeneration: authorization.sessionGeneration },
      history: { ...history },
      source: { ...history.kernel, position: history.observedThroughPosition },
      kernelEventId: eventId(), kernelEventSequence: seq, observedAt: at,
    };
    const observed = await controls.recordControlObservation(b2.ctx, {
      input: { intentRef: intent.ref, runRef, observation },
      meta: { requestId: requestId(`observe-${kind}`),
        expected: [{ ref: intent.ref, revision: intent.revision },
          { ref: runRef, revision: submitted.value.runRevision }] },
    });
    if (observed.status !== 'committed') throw new Error(`S2B recordControlObservation(${kind}) failed: ${JSON.stringify(observed)}`);
    return intent.ref;
  }

  function track(target: S2BTrackFixture['records'] = records, readRecordCap?: number): TrackReadPort {
    return createTrackReadModel({ records: target, now,
      ...(readRecordCap === undefined ? {} : { readRecordCap }) });
  }

  const trackGoalRef: GoalRef = { aggregateType: 'Goal', projectId: b2.base.scope.projectId,
    goalId: 's2b-track-goal' };
  const createdGoal = await b2.base.goals.createGoal(b2.ctx, {
    meta: { requestId: requestId('create-goal'),
      expected: [{ ref: b2.base.projectRef, revision: 1 }, { ref: b2.base.workspaceRef, revision: 1 }] },
    input: { goalId: trackGoalRef.goalId, workspace: b2.base.scope, objective: 'S2B track reads' },
  });
  if (createdGoal.status !== 'committed') throw new Error(`S2B track Goal creation failed: ${JSON.stringify(createdGoal)}`);
  await installStaticCompletionPolicy();
  await adoptInitialPlan(trackGoalRef, TRACK_WORK_TASK_IDS);

  return {
    kind, b2, ctx: b2.ctx, records, goalRef: trackGoalRef, setClock, clock: () => clock,
    computeSessionRef: () => b2.base.sessions.second,
    newSession: (id) => b2.base.createSession(id),
    newReadonlyCopy, submitAndFinishQuery, createGoalWithPlan,
    runAndEnd, runAndFail, runAndEndOn, runOpen, writeActivity, ensureRecording, claimThenCancel, goalExecutedFiles,
    linkResponsible: (sessionRef, taskId) => setResponsible(sessionRef, taskId, true),
    closeResponsible: (sessionRef, taskId) => setResponsible(sessionRef, taskId, false),
    reconcileHostTakeover, requeueRunAndEnd,
    beginChecks, interruptExecutingChecks, finalize, pauseThenResume,
    openRound: (subjectRunRef, taskId) => openRoundInternal(subjectRunRef, taskId, undefined),
    openGateRound: (producerRunRef) => openRoundInternal(producerRunRef, 'gate-1', 'goal'),
    readTrack: (input, options) => track(records, options?.readRecordCap).readTrackBars(b2.ctx, {
      goalRef: trackGoalRef, from: input.from, to: input.to,
      cursor: input.cursor ?? null, limit: input.limit ?? 100,
      ...(input.sessionRefs === undefined ? {} : { sessionRefs: input.sessionRefs }),
    }),
    track,
    close: () => b2.close(),
  };
}
