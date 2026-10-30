/**
 * Slice 2B BE4 activity fixture.
 *
 * What it builds and through which public calls:
 *   - one real RecordStore (memory or SQLite) through the accepted
 *     `createB2ExecutionFixture` (real Goal/Plan/Session/claim/execution-entry
 *     services), with `RUN_ACTIVITY_RECORD_SCHEMAS` and `EVIDENCE_RECORD_SCHEMAS`
 *     layered in;
 *   - real Runs claimed by the real `TaskClaimPort` and entered/ended through
 *     the real `ExecutionEntryPort` with a mutable platform clock, so `startedAt`
 *     and `endedAt` are controllable without writing a record directly;
 *   - `RunActivity` records written ONLY through the public
 *     `createRunActivityService` (L-fixtures), and the workspace
 *     `ActivityRecording` created only through `ensureActivityRecording`;
 *   - the calendar/run-activity reads through the public
 *     `createActivityReadModel`;
 *   - a real `requirementKinds: ['static']` completion policy through the public
 *     project-bootstrap install/activate operations, and real `responsible`
 *     SessionWorkLinks / `archiveSession` through `createSessionLifecycleService`.
 *
 * The default activity Goal has the twelve `WORK_TASK_IDS` work tasks; a caller
 * that needs a longer plan (for example the R9 backfill paging row) passes
 * `workTaskIds` to `openS2BActivityFixture` without changing every other world.
 * Nothing here writes a record directly, calls a model or touches the network.
 */
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../src/contracts/core/identity.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { RunActivityFactsV1, RunActivitySnapshot, ActivityQuarterV1 } from '../../src/contracts/run-activity.js';
import type { RunRef, RunSnapshot, RuntimeEventV1 } from '../../src/contracts/dispatch.js';
import type { PlanRevisionDraft, RuntimeTask } from '../../src/contracts/plan.js';
import { DEFAULT_TASK_AUTOMATION_POLICY } from '../../src/contracts/task-requeue.js';
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
import { createRunActivityService, type RunActivityPort } from '../../src/core/work-graph/tasks/run-activity-service.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { SESSION_MESSAGE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { completionPolicyContentDigest } from '../../src/contracts/governance.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import type {
  AuthorizeConfiguration, ExecutionEntryPort, KernelExecutionBinding, TaskResultObservation,
} from '../../src/core/work-graph/model/execution-entry-contracts.js';
import {
  createActivityReadModel,
  type ActivityReadPort, type ActivityCalendarV1, type RunActivityViewV1,
} from '../../src/core/work-graph/views/activity-read-model.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import {
  B2_AT, B2_HOST, createB2ExecutionFixture, type B2ExecutionFixture,
} from './B2-execution-fixture.js';

export type S2BActivityFixtureKind = 'memory' | 'sqlite';

/** The activity Goal's work tasks; each accepts exactly one Run per test. */
export const WORK_TASK_IDS = ['work-1', 'work-2', 'work-3', 'work-4', 'work-5', 'work-6', 'work-7', 'work-8',
  'work-9', 'work-10', 'work-11', 'work-12'] as const;

const ACTIVITY_SCHEMAS: RecordBackendSchemas = {
  // `RunActivity@1`/`ActivityRecording@1` already ride in
  // `EXECUTION_ENTRY_RECORD_SCHEMAS`, which `createB2ExecutionFixture` spreads;
  // the verification-round group (for the check rows), the project-bootstrap
  // EVENTS (the real install/activate completion-policy path below) and the
  // Query group (the calendar's workspace QueryRun index and QueryActivity
  // records) are added here. The bootstrap group carries no records in this
  // baseline.
  records: [...EVIDENCE_RECORD_SCHEMAS.records, ...CONTROL_RECORD_SCHEMAS.records,
    ...QUERY_JOB_RECORD_SCHEMAS.records, ...SESSION_MESSAGE_RECORD_SCHEMAS.records],
  events: [...EVIDENCE_RECORD_SCHEMAS.events, ...CONTROL_RECORD_SCHEMAS.events,
    ...SESSION_LIFECYCLE_RECORD_SCHEMAS.events, ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events,
    ...QUERY_JOB_RECORD_SCHEMAS.events, ...SESSION_MESSAGE_RECORD_SCHEMAS.events],
  lookups: [...(EVIDENCE_RECORD_SCHEMAS.lookups ?? []), ...(CONTROL_RECORD_SCHEMAS.lookups ?? []),
    ...(QUERY_JOB_RECORD_SCHEMAS.lookups ?? []), ...(SESSION_MESSAGE_RECORD_SCHEMAS.lookups ?? [])],
};

/** Builds a literal `counted` facts value from an explicit quarter list (test-side expectation source). */
export function countedFacts(input: {
  turnStartedAt: string; lastRecordAt: string; quarters?: ActivityQuarterV1[];
  kernelRunId?: string; kernelTurnId?: string; throughPosition?: number;
  turnTerminal?: boolean; unresolvedCalls?: number;
  changedFiles?: { definite?: string[]; possible?: string[]; possiblyIncomplete?: boolean;
    incompleteBecause?: ('command_ran' | 'edits_unknown' | 'cap')[]; definiteOmitted?: number; possibleOmitted?: number };
  usage?: { requests?: []; omitted?: number; totals?: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
    complete?: boolean };
}): RunActivityFactsV1 {
  const totals = (input.quarters ?? []).reduce((sum, quarter) => ({
    steps: sum.steps + quarter.steps, edits: sum.edits + quarter.edits, editsUnknown: sum.editsUnknown + quarter.editsUnknown,
  }), { steps: 0, edits: 0, editsUnknown: 0 });
  return {
    status: 'counted', ruleVersion: 1,
    window: {
      kernelRunId: input.kernelRunId ?? 's2b-kernel-run', kernelTurnId: input.kernelTurnId ?? 's2b-kernel-turn',
      fromPosition: 1, throughPosition: input.throughPosition ?? 4, bound: 'end_position',
      turnTerminal: input.turnTerminal ?? true, unresolvedCalls: input.unresolvedCalls ?? 0,
      turnStartedAt: input.turnStartedAt, lastRecordAt: input.lastRecordAt,
    },
    quarters: input.quarters ?? [], overflow: null, totals,
    changedFiles: { definite: input.changedFiles?.definite ?? [], possible: input.changedFiles?.possible ?? [],
      definiteOmitted: input.changedFiles?.definiteOmitted ?? 0, possibleOmitted: input.changedFiles?.possibleOmitted ?? 0,
      possiblyIncomplete: input.changedFiles?.possiblyIncomplete ?? false,
      incompleteBecause: input.changedFiles?.incompleteBecause ?? [] },
    usage: { requests: input.usage?.requests ?? [], omitted: input.usage?.omitted ?? 0,
      totals: input.usage?.totals ?? { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      complete: input.usage?.complete ?? true },
  };
}

/** The public activity view of one Run from a `readRunActivities` result. */
export function viewOf(read: ReadResult<RunActivityViewV1[]>, runId: string): RunActivityViewV1 {
  if (read.status !== 'ready') throw new Error(`the activity read was not ready: ${JSON.stringify(read)}`);
  const found = read.value.find(view => view.runRef.runId === runId);
  if (found === undefined) throw new Error(`no activity view for ${runId}`);
  return found;
}

/**
 * TP-071 A3 gate: `completed` resolves when the REAL automatic backfill loop has
 * written its last batch (`done` or `next === null`). The wrapper returns the
 * real `createActivityBackfill` result unchanged; it only signals completion.
 */
let resolveActivityBackfill: (() => void) | null = null;
let activityBackfillCompleted: Promise<void> = new Promise(() => undefined);

export function resetActivityBackfillGate(): Promise<void> {
  activityBackfillCompleted = new Promise<void>(resolve => { resolveActivityBackfill = resolve; });
  return activityBackfillCompleted;
}

/** `vi.mock` factory: wrap the real factory, signal when the real loop finishes. */
export function activityBackfillGateModule<T extends Record<string, unknown>>(actual: T): T {
  const create = actual['createActivityBackfill'];
  if (typeof create !== 'function') return actual;
  return { ...actual, createActivityBackfill: (deps: unknown) => {
    const real = (create as (value: unknown) => Record<string, unknown>)(deps);
    const recent = real['backfillRecentActivity'] as (ctx: unknown, input: unknown) => Promise<unknown>;
    return { ...real, async backfillRecentActivity(ctx: unknown, input: unknown) {
      const result = await recent(ctx, input);
      const batch = result as { status?: string; value?: { done?: boolean; next?: string | null } };
      if (batch.status !== 'ready' || batch.value?.done === true || batch.value?.next === null) {
        resolveActivityBackfill?.();
      }
      return result;
    } };
  } };
}

export type S2BActivityFixture = {
  kind: S2BActivityFixtureKind;
  b2: B2ExecutionFixture;
  ctx: CoreCallContext;
  records: B2ExecutionFixture['base']['records'] & RecordOrderedLookupPort;
  activity: RunActivityPort;
  model: Pick<ActivityReadPort, 'readActivityCalendar' | 'readRunActivities'>;
  /** The mutable platform clock every fixture-owned service reads. */
  setClock(at: string): void;
  clock(): string;
  ensureRecording(at: string): Promise<void>;
  /** The dedicated activity Goal every Run in this fixture belongs to. */
  goalRef: GoalRef;
  /** Claims, enters and ends a real Run; returns its RunRef. */
  runAndEnd(taskId: string, sessionRef: SessionRef, startedAt: string, endedAt: string): Promise<RunRef>;
  /** Claims and enters a real Run but leaves it running. */
  runOpen(taskId: string, sessionRef: SessionRef, startedAt: string): Promise<RunRef>;
  /** Claims a Task and cancels it before entry (RUN-09), so the Run has no history. */
  claimThenCancel(taskId: string, sessionRef: SessionRef, at: string): Promise<RunRef>;
  /** Claims a Task publicly (the real `TaskClaimPort`) without entering it. */
  claimWork(taskId: string, sessionRef: SessionRef): Promise<TaskClaim>;
  writeActivity(runRef: RunRef, facts: RunActivityFactsV1): Promise<RunActivitySnapshot>;
  /** Opens one real verification round on an ended subject Run. */
  openRound(subjectRunRef: RunRef, taskId: string, options?: { gateSubject?: 'goal' | 'stage' | 'module' }): Promise<RoundSnapshot>;
  /** Begins the first `count` configured checks of one round. */
  beginChecks(round: RoundSnapshot, count: number): Promise<RoundSnapshot>;
  /** Opens/closes one real `responsible` SessionWorkLink on the activity Goal's gate task. */
  linkResponsible(sessionRef: SessionRef, taskId: string): Promise<void>;
  closeResponsible(sessionRef: SessionRef, taskId: string): Promise<void>;
  /** Archives a Session through the real `archiveSession` lifecycle owner. */
  archiveSession(sessionRef: SessionRef): Promise<void>;
  readCalendar(input: { goalRef: GoalRef; from: string; to: string; granularity: 'hour' | 'day';
    timeZone: string; sessionRefs?: SessionRef[] }, options?: { readRecordCap?: number }): Promise<ReadResult<ActivityCalendarV1>>;
  readRuns(runRefs: RunRef[], options?: { readRecordCap?: number }): Promise<ReadResult<RunActivityViewV1[]>>;
  /** A read model over a caller-supplied (possibly faulty) records port. */
  readModelWith(records: S2BActivityFixture['records'], readRecordCap?: number):
    Pick<ActivityReadPort, 'readActivityCalendar' | 'readRunActivities'>;
  close(): Promise<void>;
};

export type S2BActivityFixtureOptions = {
  /** The activity Goal's work tasks; default `WORK_TASK_IDS` (twelve). */
  workTaskIds?: readonly string[];
};

export async function openS2BActivityFixture(
  kind: S2BActivityFixtureKind = 'memory',
  options: S2BActivityFixtureOptions = {},
): Promise<S2BActivityFixture> {
  const b2 = await createB2ExecutionFixture(kind, ACTIVITY_SCHEMAS);
  const baseRecords = b2.base.records;
  const records = baseRecords as unknown as B2ExecutionFixture['base']['records'] & RecordOrderedLookupPort;

  let clock = B2_AT;
  let seq = 0;
  const eventId = (): string => `s2b-activity-event-${++seq}`;
  const newId = (): string => `s2b-activity-id-${++seq}`;
  const now = (): string => clock;

  const authorizeConfiguration: AuthorizeConfiguration = async (ctx, config) => {
    if (ctx.projectId !== b2.base.scope.projectId || ctx.workspaceId !== b2.base.scope.workspaceId
      || config.configurationRevision !== B2_HOST.configurationRevision
      || canonicalJson(config.permissions) !== canonicalJson(B2_HOST.permissions)
      || canonicalJson(config.hostTemplate) !== canonicalJson(B2_HOST.hostTemplate)) {
      return { status: 'rejected', code: 'forbidden', reason: 'the S2B activity fixture Host does not authorize this configuration' };
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

  // ---- the real verification-round owner (for the check rows) --------------
  const runReads = createRunStateReader({ records: baseRecords });
  const materialAuthority = createMaterialRecordReaders(baseRecords).authority;
  const controls = createRunControlService({ records: baseRecords, authority: materialAuthority,
    reads: runReads, now, eventId });
  const evidenceConfiguration: TrustedCheckConfiguration = {
    configurationRevision: 's2b-activity-checks', workspace: b2.base.workspaceRef,
    executor: { kind: 'human', id: 'r4c-claim-operator' },
    permissionRevision: 's2b-activity-permission',
    sourceAccess: 'verification_workspace', processAccess: 'all_except_denied', deniedPrefixes: [],
    checks: [1, 2, 3, 4].map((n) => ({ checkId: `check-${String(n)}`, kind: 'static', command: 'fixture-check',
      cwd: '.', timeoutMs: 1000, taskIds: 'all' })),
  };
  const evidence = createEvidenceService({
    records: baseRecords,
    executions: createRunStateReader({ records: baseRecords }),
    materials: createMaterialService({ bodies: b2.bodies, authority: materialAuthority, now }),
    workspaceHost: {
      async resolveRoot() { return { status: 'ready' as const, value: { root: b2.base.directory, workspaceRevision: 1 } }; },
      async authorize() { return { status: 'ready' as const, value: { subjectKey: 's2b-activity-host',
        permissionRevision: 's2b-activity-permission', allowsRead: () => true } }; },
    },
    source: { async capture() { return { status: 'ready' as const, sourceDigest: sha256Hex('s2b-activity-source'),
      sourceProof: { kind: 'current-workspace-only' as const, runBaselineKnown: false },
      changeScope: { diffClass: 'code-change', changedFiles: ['src/s2b/a.ts'], writeSummary: 's2b activity source' },
      gaps: [] }; } },
    configuration: evidenceConfiguration,
    automationPolicy: () => DEFAULT_TASK_AUTOMATION_POLICY,
    now, newId,
  });

  /** Opens one real verification round on an ended subject Run (L11/L12 `since`). */
  async function openRound(subjectRunRef: RunRef, taskId: string,
    options?: { gateSubject?: 'goal' | 'stage' | 'module' }): Promise<RoundSnapshot> {
    const goalRead = await b2.base.plans.queryGoal(b2.ctx, activityGoalRef);
    if (goalRead.status !== 'ready' || goalRead.value.goal.activePlanRevision === null) {
      throw new Error('the S2B activity Goal has no accepted plan');
    }
    const result = await evidence.openVerification(b2.ctx, {
      input: { subjectRunRef,
        subject: { projectId: activityGoalRef.projectId, goalId: activityGoalRef.goalId, taskId },
        planRef: goalRead.value.goal.activePlanRevision,
        ...(options?.gateSubject === undefined ? {} : { gateSubject: options.gateSubject }) },
      meta: { requestId: `s2b-round-${++seq}`, expected: [] },
    });
    if (result.status !== 'committed') throw new Error(`S2B openVerification failed: ${JSON.stringify(result)}`);
    return result.value;
  }

  /** The real Session lifecycle owner (`linkSessionWork`), over the same store. */
  const lifecycle = createSessionLifecycleService({ records: baseRecords, lookups: baseRecords });

  /** Opens or closes one real `responsible` SessionWorkLink on the gate task. */
  async function setResponsible(sessionRef: SessionRef, taskId: string, active: boolean): Promise<void> {
    const target = { kind: 'task' as const, ref: { projectId: b2.base.scope.projectId,
      goalId: activityGoalRef.goalId, taskId } };
    const linkRef = { aggregateType: 'SessionWorkLink' as const, projectId: b2.base.scope.projectId,
      sessionId: sessionRef.sessionId, target, relation: 'responsible' as const };
    const linkKey = canonicalJson(linkRef as unknown as JsonValue);
    const linkRead = await baseRecords.readMany([linkKey]);
    if (linkRead.status !== 'ready') throw new Error(`S2B responsible link read failed: ${JSON.stringify(linkRead)}`);
    const linkRecord = linkRead.value.records.find((record) => record.refKey === linkKey);
    const result = await lifecycle.linkSessionWork(b2.ctx, {
      input: { sessionRef, relation: 'responsible', active, target },
      meta: { requestId: `s2b-responsible-${active ? 'open' : 'close'}-${++seq}`, expected: [
        await b2.base.sessionPin(sessionRef), { ref: linkRef, revision: linkRecord?.revision ?? 0 },
      ] },
    });
    if (result.status !== 'committed') throw new Error(`S2B responsible link failed: ${JSON.stringify(result)}`);
  }
  const linkResponsible = (sessionRef: SessionRef, taskId: string): Promise<void> => setResponsible(sessionRef, taskId, true);
  const closeResponsible = (sessionRef: SessionRef, taskId: string): Promise<void> => setResponsible(sessionRef, taskId, false);

  /** Archives one Session through the real lifecycle owner (the archive flow). */
  async function archiveSession(sessionRef: SessionRef): Promise<void> {
    const result = await lifecycle.archiveSession(b2.ctx, {
      input: { sessionRef, reason: 'S2B activity line finished' },
      meta: { requestId: `s2b-archive-${++seq}`, expected: [await b2.base.sessionPin(sessionRef)] },
    });
    if (result.status !== 'committed') throw new Error(`S2B archive failed: ${JSON.stringify(result)}`);
  }

  /** Begins the first `count` configured checks of one round; returns the updated round. */
  async function beginChecks(round: RoundSnapshot, count: number): Promise<RoundSnapshot> {
    let current = round;
    for (const check of round.checks.slice(0, count)) {
      const ticket = await evidence.beginCheck(b2.ctx, {
        input: { roundRef: current.ref, checkId: check.checkId },
        meta: { requestId: `s2b-begin-check-${++seq}`, expected: [{ ref: current.ref, revision: current.revision }] },
      });
      if (ticket.status !== 'committed') throw new Error(`S2B beginCheck failed: ${JSON.stringify(ticket)}`);
      const read = await evidence.readVerification(b2.ctx, current.ref);
      if (read.status !== 'ready') throw new Error(`S2B round read failed: ${JSON.stringify(read)}`);
      current = read.value;
    }
    return current;
  }

  function setClock(at: string): void { clock = at; }

  async function runPin(claim: TaskClaim): Promise<VersionPin> {
    const read = await createRunStateReader({ records: baseRecords }).readExecution(b2.ctx, claim.runRef);
    if (read.status !== 'ready') throw new Error(`S2B Run read failed: ${JSON.stringify(read)}`);
    return { ref: claim.runRef, revision: read.value.run.revision };
  }

  /**
   * Adopts the INITIAL plan of a fresh activity Goal through the real Plan
   * service (`proposePlan` + `applyPlanChange`, `basedOn: null`). L-fixtures:
   * the public plan path, not a record write.
   */
  async function adoptInitialPlan(goalRef: GoalRef, workTaskIds: readonly string[]): Promise<void> {
    const goalRead = await b2.base.plans.queryGoal(b2.ctx, goalRef);
    if (goalRead.status !== 'ready') throw new Error(`S2B plan goal read failed: ${JSON.stringify(goalRead)}`);
    const tasks: RuntimeTask[] = [
      ...workTaskIds.map((taskId) => ({ taskId, title: `S2B activity ${taskId}`, requirementLevel: 'required',
        taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } } as RuntimeTask)),
      { taskId: 'gate-1', title: 'S2B activity gate', requirementLevel: 'required',
        taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ];
    const draft: PlanRevisionDraft = {
      schemaVersion: 2, planId: `${goalRef.goalId}-plan`, planRevision: 1, goalId: goalRef.goalId,
      stages: [], tasks,
      assignments: workTaskIds.map((taskId) => ({ taskId, role: 'builder', instruction: `Do ${taskId}` })),
      obligations: [{ obligationId: 's2b-activity-obligation', title: 'S2B activity work',
        requirementLevel: 'required', taskIds: [...workTaskIds, 'gate-1'],
        verificationRequirements: [{ requirementId: 's2b-activity-check', requirementLevel: 'required',
          kind: 'static', description: 'S2B activity work is verified' }] }],
      taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
    };
    const proposed = await b2.base.plans.proposePlan(b2.ctx, {
      input: { goalRef, basedOn: null, draft,
        reason: { text: 'S2B activity initial plan', sources: [] } },
      meta: { requestId: `s2b-plan-propose-${++seq}`, expected: [{ ref: goalRef, revision: goalRead.value.goal.revision }] },
    });
    if (proposed.status !== 'committed' || proposed.value.issues.length !== 0) {
      throw new Error(`S2B initial plan proposal failed: ${JSON.stringify(proposed)}`);
    }
    const applied = await b2.base.plans.applyPlanChange(b2.ctx, {
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
      meta: { requestId: `s2b-plan-apply-${++seq}`,
        expected: [{ ref: goalRef, revision: goalRead.value.goal.revision }] },
    });
    if (applied.status !== 'committed') throw new Error(`S2B initial plan apply failed: ${JSON.stringify(applied)}`);
  }

  /**
   * Registers and activates a real `requirementKinds: ['static']` completion
   * policy through the public `createProjectBootstrapServices` install/activate
   * operations, so the activity Goal's plan pins a policy whose kind matches
   * the trusted static command checks below and the compiled round really has
   * checks. This is the accepted governance-seeding step the 2A helper uses;
   * only the public service path is used here.
   */
  async function installStaticCompletionPolicy(): Promise<void> {
    const bootstrap = createProjectBootstrapServices({ records: baseRecords, now, eventId });
    const projectKey = canonicalJson(b2.base.projectRef as unknown as JsonValue);
    const projectRead = await baseRecords.readMany([projectKey]);
    if (projectRead.status !== 'ready') throw new Error(`S2B project revision read failed: ${JSON.stringify(projectRead)}`);
    const project = projectRead.value.records.find((record) => record.refKey === projectKey);
    if (project === undefined) throw new Error('S2B project record is missing');
    const projectRevision = (JSON.parse(project.json) as { revision: number }).revision;
    const policyId = 's2b-activity-policy';
    const content = { schemaVersion: 1 as const, requirementKinds: ['static'],
      minimumRequiredRequirementsPerObligation: 1 };
    const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId: b2.base.scope.projectId,
      policyId, revision: 1 };
    const installed = await bootstrap.completionPolicies.installCompletionPolicy(b2.ctx, {
      input: { policyId, contentRevision: 1, content },
      meta: { requestId: `s2b-install-policy-${++seq}`, expected: [
        { ref: b2.base.projectRef, revision: projectRevision }, { ref: policyRef, revision: 0 },
      ] },
    });
    if (installed.status !== 'committed') throw new Error(`S2B policy install failed: ${JSON.stringify(installed)}`);
    const activeRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: b2.base.scope.projectId };
    const activeRead = await baseRecords.readMany([canonicalJson(activeRef as unknown as JsonValue)]);
    if (activeRead.status !== 'ready') throw new Error(`S2B active policy read failed: ${JSON.stringify(activeRead)}`);
    const active = activeRead.value.records.find((record) => record.refKey === canonicalJson(activeRef as unknown as JsonValue));
    if (active === undefined) throw new Error('S2B active policy pointer is missing');
    const activeRevision = (JSON.parse(active.json) as { revision: number }).revision;
    const activated = await bootstrap.completionPolicies.activateCompletionPolicy(b2.ctx, {
      input: { target: { ref: policyRef, digest: completionPolicyContentDigest({ schemaVersion: 1, policyId,
        contentRevision: 1, content }) } },
      meta: { requestId: `s2b-activate-policy-${++seq}`, expected: [
        { ref: b2.base.projectRef, revision: projectRevision }, { ref: activeRef, revision: activeRevision },
      ] },
    });
    if (activated.status !== 'committed') throw new Error(`S2B policy activate failed: ${JSON.stringify(activated)}`);
  }

  async function claim(taskId: string, sessionRef: SessionRef): Promise<TaskClaim> {
    const goalRead = await b2.base.plans.queryGoal(b2.ctx, activityGoalRef);
    if (goalRead.status !== 'ready') throw new Error(`S2B goal read failed: ${JSON.stringify(goalRead)}`);
    const planRef = goalRead.value.goal.activePlanRevision;
    if (planRef === null) throw new Error('the S2B activity Goal has no accepted plan');
    const request: GraphWrite<ClaimTaskInput> = {
      input: { goalRef: activityGoalRef, planRef, taskId, sessionRef,
        roleBinding: b2.base.roleBinding, budget: b2.base.budget },
      meta: { requestId: `s2b-claim-${++seq}`, expected: [
        { ref: activityGoalRef, revision: goalRead.value.goal.revision },
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
    const prepared = await b2.buildPrepared({ claim });
    // Every Run gets its own Kernel run/turn identity: the accepted B2 fixture
    // hard-codes one, and the kernel-slot unique claim is keyed by it (RUN-04).
    const sessionKernel = await b2.kernelFor(claim);
    const kernel: KernelExecutionBinding = { ...sessionKernel,
      runId: `${claim.runRef.runId}-kernel`, turnId: `${claim.runRef.runId}-turn` };
    const authorized = await entry.authorizeRuntimeEntry(b2.ctx, {
      input: { prepared, consumerId: 's2b-activity-runtime' },
      meta: { requestId: `s2b-authorize-${++seq}`, expected: [await runPin(claim)] },
    });
    if (authorized.status !== 'committed') throw new Error(`S2B authorize failed: ${JSON.stringify(authorized)}`);
    const begun = await entry.beginRuntimeEntry(b2.ctx, {
      input: { permit: authorized.value, kernel },
      meta: { requestId: `s2b-begin-${++seq}`, expected: [await runPin(claim)] },
    });
    if (begun.status !== 'committed') throw new Error(`S2B begin failed: ${JSON.stringify(begun)}`);
    const entered = await entry.recordExecutionEntered(b2.ctx, {
      input: {
        permit: { ...authorized.value, authorizationRevision: begun.value.authorization.revision },
        enteredAt: at, kernelSource: { ...kernel, position: 3 },
        history: { kernel, startPosition: 2, observedThroughPosition: 3, endPosition: null },
      },
      meta: { requestId: `s2b-entered-${++seq}`, expected: [await runPin(claim)] },
    });
    if (entered.status !== 'committed') throw new Error(`S2B entered failed: ${JSON.stringify(entered)}`);
    return kernel;
  }

  function terminalEvent(run: RunSnapshot, at: string): RuntimeEventV1 {
    return { eventType: 'run_completed', schemaVersion: 1, eventId: `s2b-terminal-${++seq}`,
      runRef: run.ref, sequence: run.lastEventSeq + 1, occurredAt: at, payload: { kind: 'completed', exitCode: 0 } };
  }

  async function end(claim: TaskClaim, at: string): Promise<RunSnapshot> {
    clock = at;
    const current = await createRunStateReader({ records: baseRecords }).readExecution(b2.ctx, claim.runRef);
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
      event: terminalEvent(run, at), kernelSource: source,
      completedHistoryBoundary: { source, cursor: `s2b-boundary-${run.ref.runId}-${String(position)}` },
      history: { kernel: history.kernel, startPosition: history.startPosition,
        observedThroughPosition: position, endPosition: position },
    };
    const result = await entry.recordRunResult(b2.ctx, {
      input: observation, meta: { requestId: `s2b-end-${++seq}`, expected: [await runPin(claim)] },
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

  async function runOpen(taskId: string, sessionRef: SessionRef, startedAt: string): Promise<RunRef> {
    const claimed = await claim(taskId, sessionRef);
    await enter(claimed, startedAt);
    return claimed.runRef;
  }

  /** Claims a Task and cancels it before entry (RUN-09): no history, no activity. */
  async function claimThenCancel(taskId: string, sessionRef: SessionRef, at: string): Promise<RunRef> {
    clock = at;
    const claimed = await claim(taskId, sessionRef);
    const read = await runReads.readExecution(b2.ctx, claimed.runRef);
    if (read.status !== 'ready') throw new Error(`S2B not-entered Run read failed: ${JSON.stringify(read)}`);
    const cancelled = await controls.submitControl(b2.ctx, {
      input: { runRef: claimed.runRef, kind: 'cancel', reason: 'S2B activity not-entered cancel' },
      meta: { requestId: `s2b-cancel-not-entered-${++seq}`,
        expected: [{ ref: claimed.runRef, revision: read.value.run.revision }] },
    });
    if (cancelled.status !== 'committed') throw new Error(`S2B not-entered cancel failed: ${JSON.stringify(cancelled)}`);
    return claimed.runRef;
  }

  async function writeActivity(runRef: RunRef, facts: RunActivityFactsV1): Promise<RunActivitySnapshot> {
    const result = await activity.recordRunActivity(b2.ctx, {
      input: { runRef, facts }, meta: { requestId: `s2b-activity-${++seq}`, expected: [] },
    });
    if (result.status !== 'committed') throw new Error(`S2B activity write failed: ${JSON.stringify(result)}`);
    return result.value.snapshot;
  }

  async function ensureRecording(at: string): Promise<void> {
    clock = at;
    const result = await activity.ensureActivityRecording(b2.ctx, {
      input: { workspace: b2.base.scope }, meta: { requestId: `s2b-recording-${++seq}`, expected: [] },
    });
    if (result.status !== 'committed') throw new Error(`S2B recording failed: ${JSON.stringify(result)}`);
  }

  function readModelWith(target: S2BActivityFixture['records'], readRecordCap?: number) {
    return createActivityReadModel({ records: target, now,
      ...(readRecordCap === undefined ? {} : { readRecordCap }) });
  }

  const model = readModelWith(records);

  // A dedicated activity Goal with its own initial plan: every task stays
  // claimable for one Run, so tests can build several Runs in one Goal without
  // touching the accepted B2 goal.
  const activityGoalRef: GoalRef = { aggregateType: 'Goal', projectId: b2.base.scope.projectId,
    goalId: 's2b-activity-goal' };
  const createdGoal = await b2.base.goals.createGoal(b2.ctx, {
    meta: { requestId: `s2b-create-activity-goal-${++seq}`,
      expected: [{ ref: b2.base.projectRef, revision: 1 }, { ref: b2.base.workspaceRef, revision: 1 }] },
    input: { goalId: activityGoalRef.goalId, workspace: b2.base.scope, objective: 'S2B activity reads' },
  });
  if (createdGoal.status !== 'committed') throw new Error(`S2B activity Goal creation failed: ${JSON.stringify(createdGoal)}`);
  await installStaticCompletionPolicy();
  await adoptInitialPlan(activityGoalRef, options.workTaskIds ?? WORK_TASK_IDS);

  return {
    kind, b2, ctx: b2.ctx, records, activity, model, setClock, clock: () => clock,
    goalRef: activityGoalRef,
    claimWork: claim,
    ensureRecording, runAndEnd, runOpen, claimThenCancel, writeActivity, openRound, beginChecks,
    linkResponsible, closeResponsible, archiveSession,
    readCalendar: (input, options) => readModelWith(records, options?.readRecordCap).readActivityCalendar(b2.ctx, {
      scope: { kind: 'goal', goalRef: input.goalRef },
      from: input.from, to: input.to, granularity: input.granularity, timeZone: input.timeZone,
      ...(input.sessionRefs === undefined ? {} : { sessionRefs: input.sessionRefs }),
    }),
    readRuns: (runRefs, options) => readModelWith(records, options?.readRecordCap).readRunActivities(b2.ctx, { runRefs }),
    readModelWith,
    close: () => b2.close(),
  };
}
