/**
 * Group L (slice 2C) line-read support (LE3 entry).
 *
 * What it builds and through which public calls:
 *  - A real Memory or SQLite backend through `createTaskClaimFixture`
 *    (governance, roles, the Session directory and the plan), extended with the
 *    Session-lifecycle schemas so responsibility links can be written.
 *  - Sessions through the real `SessionDirectoryPort.admitSessionCreation` +
 *    `recordSessionCreated` (with provenance and role), links through
 *    `SessionLifecyclePort.linkSessionWork`, transfers and terminal closes
 *    through `SessionResponsibilityPort`, archives through
 *    `SessionLifecyclePort.archiveSession`, Runs through the real
 *    `TaskClaimPort.claimTask`, and pins through `setLinePins`.
 *  - The reader is built over the real records port; `plans` is injected so the
 *    task rows (titles, phases, dispositions) come from the real Plan service.
 *
 * Only the storage wrappers inject anything: a named call is made to fail, or
 * one real commit is inserted between two reads (2C-36).
 */
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, WorkLinkRelation, WorkLinkTarget, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { SessionProvenanceV1 } from '../../src/contracts/core/session.js';
import type { TaskTriple, RunRef } from '../../src/contracts/dispatch.js';
import type { ArchiveStepRefV1 } from '../../src/contracts/core/session-archive.js';
import type { GoalRef, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { Disposition, Phase, PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type { LookupValue } from '../../src/core/record-store/lookup-ports.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { EXECUTION_ENTRY_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/execution-entry-codecs.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { LINE_SETTINGS_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/line-settings-codecs.js';
import { SESSION_ANOMALY_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import { MODEL_REQUEST_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/model-request-codecs.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { SESSION_MESSAGE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { SESSION_ACTIVITY_SCHEMAS } from '../../src/core/work-graph/sessions/session-activity.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { createRunSupport, runKey, waitContinuation, yieldedEvent, type RunSupport } from './S2C-L-runs-support.js';
import { createLineCheckSupport, type LineCheckSupport } from './S2C-L-check-support.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { createSessionAnomalyService } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { createGoalDecisionCauseReader } from '../../src/core/work-graph/tasks/goal-decision-reader.js';
import { createDecisionReadModel, createGoalCauseCardSource } from '../../src/core/work-graph/views/decision-read-model.js';
import { createNoticePositionComparator } from '../../src/core/work-graph/views/notice-position.js';
import { createNoticeDisplayToken } from '../../src/core/work-graph/views/notice-display-token.js';
import { createSessionResponsibilityService } from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import { createSessionResponsibilityBasisReader } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createInitializationBindingReader } from '../../src/core/work-graph/tasks/goal-confirm-service.js';
import { DEFAULT_TASK_AUTOMATION_POLICY } from '../../src/contracts/task-requeue.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createLineSettingsService } from '../../src/core/work-graph/configuration/line-settings-service.js';
import { canonicalRefKey, decodeWorkspaceSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import {
  decodeSessionWorkLink, plainSessionRefToAggregate,
} from '../../src/core/work-graph/sessions/session-record-codecs.js';
import type { SessionDutyReadPort, WorkLineReadPort } from '../../src/core/work-graph/model/work-line-contracts.js';
import type { DecisionReadPort, DecisionCardSourcePort } from '../../src/core/work-graph/model/decision-contracts.js';
import type { TaskClaimFixture } from './task-claim-fixture.js';
import { createTaskClaimFixture, type ClaimFixtureKind } from './task-claim-fixture.js';
import {
  createWorkLineReader, type WorkLineReaderDeps, type WorkLineStore,
} from '../../src/core/work-graph/views/work-line-reader.js';

export type LineTaskSpec = {
  taskId: string; title: string; taskKind?: 'work' | 'gate';
  disposition?: Disposition; phase?: Phase; moduleId?: string; stageId?: string;
  dependsOnId?: string; executionIntent?: 'plan_only' | 'request_execution';
};

export type LineGoal = {
  goalRef: GoalRef; planRef: PlanRevisionRef; tasks: Record<string, TaskTriple>;
};

export type LineFixture = {
  kind: ClaimFixtureKind;
  base: TaskClaimFixture;
  records: WorkLineStore;
  ctx: CoreCallContext;
  scope: WorkspaceScope;
  deps: WorkLineReaderDeps;
  reader: WorkLineReadPort;
  /** Real Run/Query phase owners over the same records (LE3). */
  runs: RunSupport;
  /** 2C-10: the real evidence/completion owners over the same records. */
  checks: LineCheckSupport;
  /** A reader over another records surface (the storage wrappers inject here). */
  readerWith(records: WorkLineStore, budget?: number): WorkLineReadPort;
  /** The line reader with the real 2A decision queue wired (2C-03, 2C-12). */
  queueReader(records?: WorkLineStore, budget?: number,
    options?: { decisions?: WorkLineStore; autoReworkLimit?: number;
      duty?: (role: { templateId?: string; roleId?: string }) => 'executor' | 'secretary' | 'unknown' }): WorkLineReadPort;
  /** The real WorkGraph archive step: one archive request, then one anchor per Run (2C-03). */
  writeAnchors(session: SessionRef, runRefs: readonly RunRef[], requestId: string): Promise<void>;
  /** The real public Session creation with provenance and role. */
  createSession(requestId: string, options?: {
    provenance?: SessionProvenanceV1;
    role?: { kind: 'legacy_template'; templateId: string; templateRevision: string };
    workspace?: WorkspaceScope;
  }): Promise<{ ref: SessionRef; record: import('../../src/contracts/core/session.js').SessionRecord;
    cursor: import('../../src/contracts/command-event.js').CommitCursor }>;
  link(session: SessionRef, target: WorkLinkTarget, relation: WorkLinkRelation, active: boolean): Promise<void>;
  transfer(from: SessionRef, to: SessionRef, target: WorkLinkTarget): Promise<void>;
  closeTerminal(session: SessionRef, target: WorkLinkTarget): Promise<void>;
  archive(session: SessionRef, reason?: string): Promise<void>;
  claim(taskId: string, session: SessionRef, goal?: LineGoal): Promise<{ runRef: import('../../src/contracts/dispatch.js').RunRef; generation: number; claim: import('../../src/contracts/core/task-claim.js').TaskClaim }>;
  /** The same real claim with an injected clock and id sequence (2C-18, 2C-37). */
  claimWith(taskId: string, session: SessionRef, options: {
    goal?: LineGoal; now?: () => string; newId?: () => string;
  }): Promise<{ runRef: import('../../src/contracts/dispatch.js').RunRef; generation: number; claim: import('../../src/contracts/core/task-claim.js').TaskClaim }>;
  addGoal(goalId: string, tasks: readonly LineTaskSpec[]): Promise<LineGoal>;
  /** 2C-10: a schemaVersion-2 Goal/Plan with one `static` verification requirement. */
  addCheckableGoal(goalId: string, tasks: readonly { taskId: string; title: string }[]): Promise<LineGoal>;
  setGoalDesired(goal: GoalRef, desiredState: 'active' | 'paused' | 'cancelled'): Promise<void>;
  setPins(add: readonly SessionRef[], remove: readonly SessionRef[]): Promise<WorkspaceSnapshot>;
  workspaceSnapshot(): Promise<WorkspaceSnapshot>;
  taskOf(session: SessionRef, relation: 'responsible'): Promise<TaskTriple[]>;
  close(): Promise<void>;
};

const defaultRole = { kind: 'legacy_template' as const, templateId: 'builder', templateRevision: '1' };
const KERNEL_ADAPTER = 'r4c-claim-kernel';
const KERNEL_STORE = 'r4c-claim-kernel-store';

/** The real WorkLine reader over a fixture, with a scripted duty port. */
export function lineReaderOver(base: TaskClaimFixture, records: WorkLineStore,
  duty: (role: { templateId?: string; roleId?: string }) => 'executor' | 'secretary' | 'unknown' = () => 'executor',
  budget?: number): WorkLineReadPort {
  const dutyFor: SessionDutyReadPort = async (role) => ({ status: 'ready',
    value: duty(role as { templateId?: string; roleId?: string }) as 'executor' | 'secretary' | 'unknown' });
  const anomalies = createSessionAnomalyService({ records: base.records, lookups: base.records,
    sessionFacts: createSessionFactsService({ records: base.records }), now: () => new Date().toISOString() });
  const deps: WorkLineReaderDeps = {
    records,
    dutyFor,
    undeliveredRepliesFor: () => undefined,
    sessionAnomaliesFor: () => anomalies,
    plans: base.plans,
    ...(budget === undefined ? {} : { historyReadBudget: budget }),
  };
  return createWorkLineReader(deps);
}

/** The real 2A decision queue over a records surface (2C-03, 2C-12). */
export function decisionReadsOver(base: TaskClaimFixture, records: WorkLineStore,
  options: { autoReworkLimit?: number } = {}): DecisionReadPort {
  const plans = options.autoReworkLimit === undefined ? base.plans
    : createPlanService({ records, bindings: createInitializationBindingReader({ records }),
      materials: { async openArtifact() {
        return { status: 'rejected' as const, code: 'unsupported' as const, reason: 'S2C-L read-only plan service' };
      } },
      now: () => '2026-09-24T00:00:00.000Z', eventId: () => 's2c-l-plan-event',
      automationPolicy: () => ({ ...DEFAULT_TASK_AUTOMATION_POLICY, autoReworkLimit: options.autoReworkLimit! }) });
  const causes = createGoalDecisionCauseReader({ records, plans });
  const emptyGoalConflict: DecisionCardSourcePort = {
    kind: 'goal_conflict',
    serves: ['goal'],
    async readPage() {
      return { status: 'ready', value: { availability: 'available', items: [], nextCursor: null, sourceCursor: null } };
    },
  };
  return createDecisionReadModel({
    records,
    cardSources: [createGoalCauseCardSource(causes), emptyGoalConflict],
    noticeSources: [],
    conflicts: { async queryGoalConflicts() {
      return { status: 'rejected', code: 'unsupported', reason: 'the goal-conflict source is not wired for the line reads' };
    } },
    positions: createNoticePositionComparator(),
    displayTokens: createNoticeDisplayToken(new Uint8Array(32)),
  });
}

export async function openLineFixture(kind: ClaimFixtureKind): Promise<LineFixture> {
  const base = await createTaskClaimFixture(kind, {
    records: [...SESSION_LIFECYCLE_RECORD_SCHEMAS.records, ...COMPLETION_RECORD_SCHEMAS.records,
      ...EXECUTION_ENTRY_RECORD_SCHEMAS.records, ...MODEL_REQUEST_RECORD_SCHEMAS.records,
      ...QUERY_JOB_RECORD_SCHEMAS.records, ...SESSION_MESSAGE_RECORD_SCHEMAS.records,
      ...CONTROL_RECORD_SCHEMAS.records, ...LINE_SETTINGS_RECORD_SCHEMAS.records,
      ...SESSION_ANOMALY_RECORD_SCHEMAS.records, ...EVIDENCE_RECORD_SCHEMAS.records,
      ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.records, ...SESSION_ACTIVITY_SCHEMAS.records],
    events: [...SESSION_LIFECYCLE_RECORD_SCHEMAS.events, ...COMPLETION_RECORD_SCHEMAS.events,
      ...EXECUTION_ENTRY_RECORD_SCHEMAS.events, ...MODEL_REQUEST_RECORD_SCHEMAS.events,
      ...QUERY_JOB_RECORD_SCHEMAS.events, ...SESSION_MESSAGE_RECORD_SCHEMAS.events,
      ...CONTROL_RECORD_SCHEMAS.events, ...LINE_SETTINGS_RECORD_SCHEMAS.events,
      ...SESSION_ANOMALY_RECORD_SCHEMAS.events, ...EVIDENCE_RECORD_SCHEMAS.events,
      ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events],
    lookups: [...(SESSION_LIFECYCLE_RECORD_SCHEMAS.lookups ?? []), ...(COMPLETION_RECORD_SCHEMAS.lookups ?? []),
      ...(EXECUTION_ENTRY_RECORD_SCHEMAS.lookups ?? []), ...(MODEL_REQUEST_RECORD_SCHEMAS.lookups ?? []),
      ...(QUERY_JOB_RECORD_SCHEMAS.lookups ?? []), ...(SESSION_MESSAGE_RECORD_SCHEMAS.lookups ?? []),
      ...(SESSION_ANOMALY_RECORD_SCHEMAS.lookups ?? []), ...(EVIDENCE_RECORD_SCHEMAS.lookups ?? []),
      ...(PROJECT_BOOTSTRAP_RECORD_SCHEMAS.lookups ?? [])],
  });
  const records = base.records as unknown as WorkLineStore;
  const runs = createRunSupport(base);
  const sessionFacts = createSessionFactsService({ records: base.records });
  const lifecycle = createSessionLifecycleService({ records: base.records, lookups: base.records,
    sessionFacts });
  const anomalies = createSessionAnomalyService({ records: base.records, lookups: base.records,
    sessionFacts, now: () => new Date().toISOString() });
  const responsibility = createSessionResponsibilityService({ records: base.records, lookups: base.records,
    basis: createSessionResponsibilityBasisReader(base.records), now: () => new Date().toISOString() });
  const lineSettings = createLineSettingsService({ records: base.records,
    sessionRead: base.sessionsPort.readSession, now: () => new Date().toISOString(),
    ...(base.ctx.principal.kind === 'host' ? { operatorActor: base.ctx.principal.actor } : {}) });
  const { ctx, scope } = base;
  let seq = 0;

  async function readPin(ref: import('../../src/contracts/ledger.js').AggregateRef): Promise<import('../../src/contracts/core/identity.js').VersionPin> {
    const key = canonicalJson(ref as unknown as JsonValue);
    const read = await base.records.readMany([key]);
    if (read.status !== 'ready') throw new Error(`S2C-L pin read failed: ${JSON.stringify(read)}`);
    const record = read.value.records.find((entry) => entry.refKey === key);
    return { ref, revision: record?.revision ?? 0 };
  }

  async function createSession(requestId: string, options: {
    provenance?: SessionProvenanceV1;
    role?: { kind: 'legacy_template'; templateId: string; templateRevision: string };
    workspace?: WorkspaceScope;
  } = {}): Promise<{ ref: SessionRef; record: import('../../src/contracts/core/session.js').SessionRecord;
    /** The commit cursor of the registration, a public setup receipt (2C-18 review item 7b). */
    cursor: import('../../src/contracts/command-event.js').CommitCursor }> {
    const workspace = options.workspace ?? scope;
    const sessionCtx: CoreCallContext = { ...ctx, workspaceId: workspace.workspaceId,
      materialReader: ctx.materialReader.kind === 'host'
        ? { ...ctx.materialReader, workspaceId: workspace.workspaceId } : ctx.materialReader };
    const admitted = await base.sessionsPort.admitSessionCreation(sessionCtx, {
      input: { workspace, kernelStore: { adapterId: KERNEL_ADAPTER, storeKey: KERNEL_STORE },
        role: options.role ?? defaultRole, recommendedRefs: [], initialLinks: [],
        ...(options.provenance === undefined ? {} : { provenance: options.provenance }) },
      meta: { requestId, expected: [] },
    });
    if (admitted.status !== 'committed') throw new Error(`S2C-L session admission failed: ${JSON.stringify(admitted)}`);
    const registered = await base.sessionsPort.recordSessionCreated(sessionCtx, {
      input: { operationRef: admitted.value.ref, sessionRef: admitted.value.action.plannedSessionRef,
        adapterId: KERNEL_ADAPTER, kernelSessionId: `kernel-${requestId}`, historyCursor: null,
        observedAt: new Date().toISOString() },
      meta: { requestId: `${requestId}-register`, expected: [] },
    });
    if (registered.status !== 'committed') throw new Error(`S2C-L session registration failed: ${JSON.stringify(registered)}`);
    return { ref: { projectId: registered.value.ref.projectId, sessionId: registered.value.ref.sessionId },
      record: registered.value, cursor: registered.cursor };
  }

  async function link(session: SessionRef, target: WorkLinkTarget, relation: WorkLinkRelation, active: boolean): Promise<void> {
    const linkRef = { ...session, aggregateType: 'SessionWorkLink' as const, target, relation };
    const refs = [plainSessionRefToAggregate(session), linkRef];
    const read = await base.records.readMany(refs.map((ref) => canonicalJson(ref as unknown as JsonValue)));
    if (read.status !== 'ready') throw new Error('S2C-L cannot build link pins');
    const expected = refs.map((ref) => ({ ref, revision: read.value.records.find((record) =>
      record.refKey === canonicalJson(ref as unknown as JsonValue))?.revision ?? 0 }));
    const result = await lifecycle.linkSessionWork(ctx, { input: { sessionRef: session, target, relation, active },
      meta: { requestId: `s2c-l-link-${++seq}`, expected } });
    if (result.status !== 'committed') throw new Error(`S2C-L link failed: ${JSON.stringify(result)}`);
  }

  async function transfer(from: SessionRef, to: SessionRef, target: WorkLinkTarget): Promise<void> {
    const sourceLinkRef = { ...from, aggregateType: 'SessionWorkLink' as const, target, relation: 'responsible' as const };
    const destinationLinkRef = { ...to, aggregateType: 'SessionWorkLink' as const, target, relation: 'responsible' as const };
    const expected = await Promise.all([
      readPin(plainSessionRefToAggregate(from)), readPin(plainSessionRefToAggregate(to)),
      readPin(sourceLinkRef), readPin(destinationLinkRef),
    ]);
    const result = await responsibility.transferSessionResponsibility(ctx, {
      input: { from, to, target }, meta: { requestId: `s2c-l-transfer-${++seq}`, expected } });
    if (result.status !== 'committed') throw new Error(`S2C-L transfer failed: ${JSON.stringify(result)}`);
  }

  async function closeTerminal(session: SessionRef, target: WorkLinkTarget): Promise<void> {
    const sessionRef = plainSessionRefToAggregate(session);
    const linkRef = { ...session, aggregateType: 'SessionWorkLink' as const, target, relation: 'responsible' as const };
    const expected = [await readPin(sessionRef), await readPin(linkRef)];
    const result = await responsibility.closeTerminalResponsibility(ctx, {
      input: { sessionRef: session, target }, meta: { requestId: `s2c-l-terminal-${++seq}`, expected } });
    if (result.status !== 'committed') throw new Error(`S2C-L terminal close failed: ${JSON.stringify(result)}`);
  }

  async function archive(session: SessionRef, reason = 'S2C-L archive'): Promise<void> {
    const result = await lifecycle.archiveSession(ctx, { input: { sessionRef: session, reason },
      meta: { requestId: `s2c-l-archive-${++seq}`, expected: [await readPin(plainSessionRefToAggregate(session))] } });
    if (result.status !== 'committed') throw new Error(`S2C-L archive failed: ${JSON.stringify(result)}`);
  }

  function buildTaskGoal(goalId: string, planId: string, tasks: readonly LineTaskSpec[], checkable = false): PlanRevisionDraft {
    const effective: LineTaskSpec[] = [...tasks];
    if (!effective.some((task) => (task.taskKind ?? 'work') === 'work' && (task.disposition ?? 'active') === 'active')) {
      effective.push({ taskId: '__active', title: 'Active filler' });
    }
    if (!effective.some((task) => (task.taskKind ?? 'work') === 'gate' && (task.disposition ?? 'active') === 'active')) {
      effective.push({ taskId: '__gate', title: 'Goal gate', taskKind: 'gate' });
    }
    const stages = [...new Set(effective.map((task) => task.stageId ?? 'stage-1'))]
      .map((stageId) => ({ stageId, title: stageId }));
    const draftTasks = effective.map((task) => ({
      taskId: task.taskId, title: task.title, requirementLevel: 'required' as const,
      taskKind: task.taskKind ?? 'work', disposition: task.disposition ?? 'active',
      phase: task.phase ?? 'pending',
      ...(task.executionIntent === undefined ? {} : { executionIntent: task.executionIntent }),
      scope: task.moduleId === undefined ? { kind: 'goal' as const } : { kind: 'module' as const, stageId: task.stageId ?? 'stage-1', moduleRef: task.moduleId },
    }));
    const dependsOn = effective.flatMap((task) => task.dependsOnId === undefined ? []
      : [{ taskId: task.taskId, dependsOnId: task.dependsOnId, requires: { kind: 'output-contract' as const, label: `${task.dependsOnId} output` } }]);
    const needsV2 = checkable || effective.some((task) => task.executionIntent !== undefined);
    return { schemaVersion: 2, planId, planRevision: 1, goalId, stages, tasks: draftTasks,
      ...(needsV2 ? { taskRelations: [], inputRequirements: [] } : {}),
      assignments: draftTasks.filter((entry) => entry.taskKind === 'work').map((entry) => ({
        taskId: entry.taskId, role: 'builder', instruction: entry.title })),
      obligations: [{ obligationId: `${goalId}-obligation`, title: 'Deliver', requirementLevel: 'required',
        taskIds: draftTasks.map((entry) => entry.taskId),
        verificationRequirements: [{ requirementId: `${goalId}-check`, requirementLevel: 'required',
          kind: checkable ? ('static' as const) : ('test' as const),
          description: checkable ? 'The registered static check' : 'Tests pass' }] }],
      taskHierarchy: { parentOf: [] }, executionDag: { dependsOn } };
  }

  async function addGoal(goalId: string, tasks: readonly LineTaskSpec[], options: { checkable?: boolean } = {}): Promise<LineGoal> {
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: scope.projectId, goalId };
    const planRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: scope.projectId, planId: `${goalId}-plan` };
    const created = await base.goals.createGoal(ctx, { meta: { requestId: `s2c-l-goal-${goalId}`,
      expected: [{ ref: base.projectRef, revision: 1 }, { ref: base.workspaceRef, revision: 1 }] },
      input: { goalId, workspace: scope, objective: `S2C-L goal ${goalId}` } });
    if (created.status !== 'committed') throw new Error(`S2C-L goal creation failed: ${JSON.stringify(created)}`);
    const proposed = await base.plans.proposePlan(ctx, { meta: { requestId: `s2c-l-propose-${goalId}`,
      expected: [{ ref: goalRef, revision: 1 }] },
      input: { goalRef, basedOn: null, draft: buildTaskGoal(goalId, planRef.planId, tasks, options.checkable === true),
        reason: { text: 'S2C-L plan', sources: [] } } });
    if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
      throw new Error(`S2C-L plan proposal failed: ${JSON.stringify(proposed)}`);
    }
    const applied = await base.plans.applyPlanChange(ctx, { meta: { requestId: `s2c-l-apply-${goalId}`,
      expected: [{ ref: goalRef, revision: 1 }] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
    if (applied.status !== 'committed') throw new Error(`S2C-L plan adoption failed: ${JSON.stringify(applied)}`);
    const mapped: Record<string, TaskTriple> = {};
    for (const task of tasks) mapped[task.taskId] = { projectId: scope.projectId, goalId, taskId: task.taskId };
    return { goalRef, planRef, tasks: mapped };
  }

  async function claim(taskId: string, session: SessionRef, goal?: LineGoal): Promise<{ runRef: import('../../src/contracts/dispatch.js').RunRef; generation: number; claim: import('../../src/contracts/core/task-claim.js').TaskClaim }> {
    const target: TaskTriple = goal?.tasks[taskId] ?? base.tasks[taskId as 'first' | 'second' | 'gate']
      ?? { projectId: scope.projectId, goalId: base.goalRef.goalId, taskId };
    const goalRef = goal?.goalRef ?? base.goalRef;
    const planRef = goal?.planRef ?? base.planRef;
    const goalRead = await base.plans.queryGoal(ctx, goalRef);
    if (goalRead.status !== 'ready') throw new Error('S2C-L goal read failed');
    const workspaceRead = await base.records.readMany([canonicalRefKey(base.workspaceRef)]);
    const workspaceRevision = workspaceRead.status === 'ready' && workspaceRead.value.records[0] !== undefined
      ? JSON.parse(workspaceRead.value.records[0].json).revision as number : 1;
    const sessionCard = await base.sessionsPort.readSession(ctx, session);
    if (sessionCard.status !== 'ready') throw new Error('S2C-L session read failed');
    const result = await base.service.claimTask(ctx, { input: { goalRef, planRef, taskId: target.taskId,
      sessionRef: session, roleBinding: base.roleBinding, budget: base.budget },
      meta: { requestId: `s2c-l-claim-${++seq}`, expected: [
        { ref: goalRef, revision: goalRead.value.goal.revision }, { ref: base.workspaceRef, revision: workspaceRevision },
        { ref: plainSessionRefToAggregate(session), revision: sessionCard.value.record.revision }] } });
    if (result.status !== 'committed') throw new Error(`S2C-L claim failed: ${JSON.stringify(result)}`);
    return { runRef: result.value.runRef, generation: result.value.generation, claim: result.value };
  }

  async function claimWith(taskId: string, session: SessionRef, options: {
    goal?: LineGoal; now?: () => string; newId?: () => string;
  }): Promise<{ runRef: import('../../src/contracts/dispatch.js').RunRef; generation: number; claim: import('../../src/contracts/core/task-claim.js').TaskClaim }> {
    const goal = options.goal;
    const target: TaskTriple = goal?.tasks[taskId] ?? base.tasks[taskId as 'first' | 'second' | 'gate']
      ?? { projectId: scope.projectId, goalId: base.goalRef.goalId, taskId };
    const goalRef = goal?.goalRef ?? base.goalRef;
    const planRef = goal?.planRef ?? base.planRef;
    const now = options.now ?? (() => '2026-09-24T00:00:00.000Z');
    let ids = 0;
    const newId = options.newId ?? (() => `s2c-l-claimwith-${++ids}`);
    const service = createTaskClaimService({ records: base.records,
      roles: createRoleConfigurationService({ records: base.records, now, eventId: () => `s2c-l-claimwith-event-${++ids}` }),
      now, newId });
    const goalRead = await base.plans.queryGoal(ctx, goalRef);
    if (goalRead.status !== 'ready') throw new Error('S2C-L goal read failed');
    const workspaceRead = await base.records.readMany([canonicalRefKey(base.workspaceRef)]);
    const workspaceRevision = workspaceRead.status === 'ready' && workspaceRead.value.records[0] !== undefined
      ? JSON.parse(workspaceRead.value.records[0].json).revision as number : 1;
    const sessionCard = await base.sessionsPort.readSession(ctx, session);
    if (sessionCard.status !== 'ready') throw new Error('S2C-L session read failed');
    const sessionRole = sessionCard.value.record.role;
    const roleBinding = sessionRole.kind === 'legacy_template'
      ? { ...base.roleBinding, bindingId: `s2c-l-claimwith-binding-${++seq}`,
        templateId: sessionRole.templateId, templateRevision: sessionRole.templateRevision }
      : base.roleBinding;
    const result = await service.claimTask(ctx, { input: { goalRef, planRef, taskId: target.taskId,
      sessionRef: session, roleBinding, budget: base.budget },
      meta: { requestId: `s2c-l-claimwith-${++seq}`, expected: [
        { ref: goalRef, revision: goalRead.value.goal.revision }, { ref: base.workspaceRef, revision: workspaceRevision },
        { ref: plainSessionRefToAggregate(session), revision: sessionCard.value.record.revision }] } });
    if (result.status !== 'committed') throw new Error(`S2C-L claimWith failed: ${JSON.stringify(result)}`);
    return { runRef: result.value.runRef, generation: result.value.generation, claim: result.value };
  }

  async function setGoalDesired(goal: GoalRef, desiredState: 'active' | 'paused' | 'cancelled'): Promise<void> {
    const goalRead = await base.plans.queryGoal(ctx, goal);
    if (goalRead.status !== 'ready') throw new Error('S2C-L goal read failed');
    const control = desiredState === 'paused' ? 'pause' : desiredState === 'cancelled' ? 'cancel' : 'resume';
    const goalPhaseRef = { aggregateType: 'GoalPhase' as const, projectId: scope.projectId, goalId: goal.goalId };
    const phaseRead = await base.records.readMany([canonicalJson(goalPhaseRef as unknown as JsonValue)]);
    const phaseRevision = phaseRead.status === 'ready'
      ? phaseRead.value.records.find((entry) => entry.refKey === canonicalJson(goalPhaseRef as unknown as JsonValue))?.revision ?? 0
      : 0;
    const result = await base.goals.setGoalControl(ctx, { input: { goalRef: goal, control, reason: null },
      meta: { requestId: `s2c-l-goal-control-${++seq}`,
        expected: [{ ref: goal, revision: goalRead.value.goal.revision }, { ref: goalPhaseRef, revision: phaseRevision }] } });
    if (result.status !== 'committed') throw new Error(`S2C-L goal control failed: ${JSON.stringify(result)}`);
  }

  async function setPins(add: readonly SessionRef[], remove: readonly SessionRef[]): Promise<WorkspaceSnapshot> {
    const current = await workspaceSnapshot();
    const result = await lineSettings.setLinePins(ctx, { input: { workspace: scope, add: [...add], remove: [...remove] },
      meta: { requestId: `s2c-l-pins-${++seq}`, expected: [{ ref: base.workspaceRef, revision: current.revision }] } });
    if (result.status !== 'committed') throw new Error(`S2C-L setPins failed: ${JSON.stringify(result)}`);
    return result.value;
  }

  async function workspaceSnapshot(): Promise<WorkspaceSnapshot> {
    const key = canonicalRefKey(base.workspaceRef);
    const read = await base.records.readMany([key]);
    if (read.status !== 'ready') throw new Error(`S2C-L workspace read failed: ${JSON.stringify(read)}`);
    const record = read.value.records.find((entry) => entry.refKey === key);
    if (record === undefined) throw new Error('S2C-L workspace record is absent');
    const decoded = decodeWorkspaceSnapshot(record);
    if (decoded.status !== 'decoded') throw new Error(`S2C-L workspace decode failed: ${decoded.reason}`);
    return decoded.value;
  }

  async function taskOf(session: SessionRef, relation: 'responsible'): Promise<TaskTriple[]> {
    const page = await base.records.lookup({ index: 's2c-open-links-by-session',
      values: [scope.projectId, session.sessionId, relation, null], limit: 100 });
    if (page.status !== 'ready') throw new Error(`S2C-L taskOf failed: ${JSON.stringify(page)}`);
    const result: TaskTriple[] = [];
    for (const record of page.value.records) {
      const decoded = decodeSessionWorkLink(record);
      if (decoded.status !== 'decoded') continue;
      const target = decoded.value.ref.target;
      if (target.kind === 'task') result.push(target.ref);
    }
    return result;
  }

  const deps: WorkLineReaderDeps = {
    records,
    dutyFor: (async () => ({ status: 'ready', value: 'executor' })) as SessionDutyReadPort,
    undeliveredRepliesFor: () => undefined,
    sessionAnomaliesFor: () => anomalies,
    plans: base.plans,
  };

  function queueReader(target: WorkLineStore = records, budget?: number,
    options: { decisions?: WorkLineStore; autoReworkLimit?: number;
      duty?: (role: { templateId?: string; roleId?: string }) => 'executor' | 'secretary' | 'unknown' } = {}): WorkLineReadPort {
    const duty = options.duty ?? (() => 'executor' as const);
    const queueDeps: WorkLineReaderDeps = {
      records: target,
      dutyFor: (async (role) => ({ status: 'ready',
        value: duty(role as { templateId?: string; roleId?: string }) })) as SessionDutyReadPort,
      undeliveredRepliesFor: () => undefined,
      sessionAnomaliesFor: () => anomalies,
      decisions: decisionReadsOver(base, options.decisions ?? target,
        options.autoReworkLimit === undefined ? {} : { autoReworkLimit: options.autoReworkLimit }),
      plans: base.plans,
      ...(budget === undefined ? {} : { historyReadBudget: budget }),
    };
    return createWorkLineReader(queueDeps);
  }

  /** The real archive step `recordSessionAnomaly` for each already-ended claim (2C-03). */
  async function writeAnchors(session: SessionRef, runRefs: readonly RunRef[], requestId: string): Promise<void> {
    const requested = await lifecycle.requestSessionArchive(ctx, {
      input: { sessionRef: session, reason: 'S2C-L archive-step fixture', tasks: [], wait: null,
        confirmUnknownStopped: false },
      meta: { requestId: `${requestId}-request`, expected: [await readPin(plainSessionRefToAggregate(session))] },
    });
    if (requested.status !== 'committed') throw new Error(`S2C-L archive request failed: ${JSON.stringify(requested)}`);
    const request = requested.value.archiveRequest;
    if (request === null || request === undefined) throw new Error('S2C-L archive request is missing');
    for (const runRef of runRefs) {
      const step: ArchiveStepRefV1 = { sessionRef: session, archiveRequestId: request.requestId,
        requestReceipt: request.receipt, step: 'anchor', subjectKey: canonicalJson(runRef as unknown as JsonValue) };
      const result = await anomalies.recordSessionAnomaly(ctx, { step, files: { source: 'kernel', status: 'known',
        confirmed: [], possible: [], omitted: 0, baseCommit: null, runBaselineKnown: false, reason: null } });
      if (result.status !== 'committed') throw new Error(`S2C-L anchor write failed: ${JSON.stringify(result)}`);
    }
  }

  const checks = createLineCheckSupport({
    base, records: base.records, runs, ctx,
    addCheckableGoalInternal: (goalId, tasks) => addGoal(goalId, tasks, { checkable: true }),
  });

  return {
    kind, base, records, ctx, scope, deps, runs,
    reader: createWorkLineReader(deps),
    readerWith: (target, budget) => lineReaderOver(base, target, () => 'executor', budget),
    queueReader, writeAnchors,
    createSession, link, transfer, closeTerminal, archive, claim, claimWith, addGoal, setGoalDesired,
    addCheckableGoal: (goalId, tasks) => addGoal(goalId, tasks, { checkable: true }),
    checks,
    setPins, workspaceSnapshot, taskOf,
    close: async () => { await checks.close(); await base.close(); },
  };
}

/** The line head of one Session among the assembled rows, or undefined. */
export function rowOf<Row extends { key: SessionRef }>(rows: readonly Row[], ref: SessionRef): Row | undefined {
  return rows.find((row) => row.key.projectId === ref.projectId && row.key.sessionId === ref.sessionId);
}

/** Fail the named `lookup` index once. */
export function failingLookup(records: WorkLineStore, index: string):
  { records: WorkLineStore; calls: number } {
  let calls = 0;
  return { get calls() { return calls; }, records: { ...records,
    async lookup(request) {
      if (request.index === index) {
        calls += 1;
        return { status: 'rejected', code: 'unavailable', reason: `injected ${index} read failure` };
      }
      return records.lookup(request);
    } } };
}

/** Fail the named `lookupOrdered` index once (2C-14, rule 3). */
export function failingLookupOrdered(records: WorkLineStore, index: string):
  { records: WorkLineStore; calls: number } {
  let calls = 0;
  let done = false;
  return { get calls() { return calls; }, records: { ...records,
    async lookupOrdered(request) {
      calls += 1;
      if (!done && request.index === index) {
        done = true;
        return { status: 'rejected', code: 'unavailable', reason: `injected ${index} ordered read failure` };
      }
      return records.lookupOrdered(request);
    } } };
}

/** Fail the first `readMany` whose requested keys satisfy `match` (default: any) (2C-14, rule 3). */
export function failingReadMany(records: WorkLineStore,
  match: (refKeys: readonly string[]) => boolean = () => true): { records: WorkLineStore; calls: number } {
  let calls = 0;
  let done = false;
  return {
    get calls() { return calls; },
    records: { ...records,
      async readMany(refKeys) {
        calls += 1;
        if (!done && match(refKeys)) {
          done = true;
          return { status: 'rejected', code: 'unavailable', reason: 'injected readMany failure' };
        }
        return records.readMany(refKeys);
      } },
  };
}

/** Insert one real commit before the named `countLookup` call (2C-36, L5/L11). */
export function commitBefore(
  records: WorkLineStore,
  match: (request: { index: string; values: readonly LookupValue[] }) => boolean,
  commit: () => Promise<void>,
): WorkLineStore {
  let done = false;
  return {
    ...records,
    async countLookup(request) {
      if (!done && match(request)) { done = true; await commit(); }
      return records.countLookup(request);
    },
  };
}

/** Insert real commits before the named `lookupOrdered` call (2C-18, the QA-16 substitute). */
export function commitBeforeLookupOrdered(
  records: WorkLineStore,
  match: (request: { index: string; values: readonly string[] }) => boolean,
  commit: (attempt: number) => Promise<void>,
): { records: WorkLineStore; calls: number } {
  let calls = 0;
  return {
    get calls() { return calls; },
    records: {
      ...records,
      async lookupOrdered(request) {
        if (match(request)) { calls += 1; await commit(calls); }
        return records.lookupOrdered(request);
      },
    },
  };
}

/**
 * The 2C-14 D1 dataset, exported for group W's route test (2C-31). It uses the
 * two Sessions `createTaskClaimFixture` pre-creates as A and B, so the
 * workspace holds exactly the 14 D1 Sessions.
 */
export type D1 = {
  a: SessionRef; b: SessionRef; c: SessionRef; d: SessionRef; e: SessionRef;
  f1: SessionRef; f2: SessionRef; g: SessionRef; gCopy: SessionRef;
  h: SessionRef; i: SessionRef; j: SessionRef; k: SessionRef;
  workGoal: LineGoal; aRunKey: string;
};

const continuationProvenance = (from: SessionRef, task: TaskTriple) =>
  ({ schemaVersion: 1, kind: 'continuation', from, reason: 'interrupted', task } as const);

const copyProvenance = (from: SessionRef, workspaceId: string, messageId: string) =>
  ({ schemaVersion: 1, kind: 'readonly_copy', from,
    messageRef: { aggregateType: 'SessionMessage' as const, projectId: from.projectId, workspaceId, messageId } } as const);

export async function buildD1(f: LineFixture): Promise<D1> {
  const workGoal = await f.addGoal('g14-work', [
    { taskId: 'a', title: 'A task' }, { taskId: 'b', title: 'B task' }, { taskId: 'c', title: 'C task' },
    { taskId: 'e', title: 'E task' }, { taskId: 'h', title: 'H task' },
  ]);
  const taskTarget = (task: TaskTriple) => ({ kind: 'task' as const, ref: task });

  // A: Work running.
  const a = f.base.sessions.first;
  const aClaim = await f.claim('a', a, workGoal);
  await f.runs.enter(aClaim.claim);

  // B: Run starting (claimed, not entered).
  const b = f.base.sessions.second;
  await f.claim('b', b, workGoal);

  // C: yielded waiting reply.
  const c = (await f.createSession('d1-c')).ref;
  const cClaim = await f.claim('c', c, workGoal);
  await f.runs.enter(cClaim.claim);
  await f.runs.recordResult(cClaim.claim, yieldedEvent(cClaim.claim, 'c'),
    waitContinuation(cClaim.claim, { aggregateType: 'SessionMessage', projectId: c.projectId,
      workspaceId: f.base.scope.workspaceId, messageId: 'd1-c-wait' }));

  // D: done (an open responsible link to a cancelled task).
  const dGoal = await f.addGoal('g14-d', [{ taskId: 'd', title: 'D task', disposition: 'cancelled' }]);
  const d = (await f.createSession('d1-d')).ref;
  await f.link(d, taskTarget(dGoal.tasks['d']!), 'responsible', true);

  // E: kernel_turn_open retired, no continuation (reconcile, maintenance not run).
  const e = (await f.createSession('d1-e')).ref;
  const eClaim = await f.claim('e', e, workGoal);
  await f.runs.enter(eClaim.claim);
  await f.runs.reconcileInterrupt(eClaim.claim);

  // F1 retired + its active continuation F2.
  const fGoal = await f.addGoal('g14-f', [{ taskId: 'f', title: 'F task' }]);
  const f1 = (await f.createSession('d1-f1')).ref;
  const f1Claim = await f.claim('f', f1, fGoal);
  await f.runs.enter(f1Claim.claim);
  await f.runs.reconcileInterrupt(f1Claim.claim);
  const f2 = (await f.createSession('d1-f2', { provenance: continuationProvenance(f1, fGoal.tasks['f']!) })).ref;

  // G idle staff + its answering copy G' (a real consultation Query claim on the copy).
  const g = (await f.createSession('d1-g')).ref;
  const gCopy = (await f.runs.beginConsultationCopy(g, 'gcopy')).copy;

  // H: stopped at the safe point.
  const h = (await f.createSession('d1-h')).ref;
  const hClaim = await f.claim('h', h, workGoal);
  await f.runs.enter(hClaim.claim);
  await f.runs.pauseAtSafePoint(hClaim.claim);

  // J archived retired, then I archived done (I's archivedAt is later).
  const j = (await f.createSession('d1-j')).ref;
  await f.runs.retire(j, 'missing');
  await f.archive(j);
  const iGoal = await f.addGoal('g14-i', [{ taskId: 'i', title: 'I task', disposition: 'cancelled' }]);
  const i = (await f.createSession('d1-i')).ref;
  await f.link(i, taskTarget(iGoal.tasks['i']!), 'responsible', true);
  await f.closeTerminal(i, taskTarget(iGoal.tasks['i']!));
  await f.archive(i);

  // K archived copy of G.
  const k = (await f.createSession('d1-k', {
    provenance: copyProvenance(g, f.base.scope.workspaceId, 'd1-k-msg') })).ref;
  await f.archive(k);

  return { a, b, c, d, e, f1, f2, g, gCopy, h, i, j, k, workGoal, aRunKey: runKey(aClaim.runRef) };
}
