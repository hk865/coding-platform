/**
 * Slice 1 §4.2 / §5.4 IT06–IT11, IT31, IT33, IT34: the Workflow's bounded
 * one-page Session maintenance step (`createWorkflow().maintainSessions`).
 *
 * Real memory/SQLite backends and the owner services the Workflow composes:
 * Session facts, the responsibility write owner (with the REAL
 * `createSessionResponsibilityBasisReader` as its trusted basis), the anomaly
 * owner and the Session lifecycle. `SessionDutyResolver` is the trusted Host
 * callback, so the rows use a test double for it (spec §2.8). The production
 * maintenance body is still a stub, so the target assertions are RED at the
 * specified `not implemented: WorkflowPort.maintainSessions`, while a
 * given that only a new slice-1 owner can produce (terminal responsibility
 * close, archived copy) is RED at that owner's own `not implemented:` step.
 *
 * Fixed clock: `t0='2026-10-08T00:00:00.000Z'`, `t1='2026-10-09T00:00:00.000Z'`.
 * Owners with an injected clock get `t0`/`t1`; owners reading `new Date()` get
 * `vi.setSystemTime`.
 */
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRecordDraft } from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef, SessionWorkLinkRef, VersionPin, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { SessionRecord, SessionWorkLink } from '../../src/contracts/core/session.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { PlatformDutyV1 } from '../../src/contracts/platform-duty.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { GraphWrite } from '../../src/core/work-graph/model/session-contracts.js';
import type { SessionMailboxPort } from '../../src/core/work-graph/model/communication-contracts.js';
import type { LinkSessionWorkInput } from '../../src/core/work-graph/sessions/lifecycle-contracts.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { decodeSessionWorkLink, sessionWorkLinkRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS, sessionResponsibilityChangedEventFromEvent } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { SESSION_MESSAGE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { createSessionResponsibilityService, type SessionResponsibilityPort } from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import { createSessionResponsibilityBasisReader } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createSessionAnomalyService, type SessionAnomalyPort } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { SESSION_ANOMALY_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { DEFAULT_SESSION_ARCHIVE_POLICY, type SessionArchivePolicyV1, type SessionDutyResolver, type WorkflowDependencies } from '../../src/business/workflow/ports.js';
import type { SessionMaintenancePort } from '../../src/business/workflow/session-maintenance.js';
import { createB2ExecutionFixture, type B2ExecutionFixture, type B2Records } from '../helpers/S1-workflow-archive-fixture.js';
import { beginConsultation, completeWork, interruptWork, retireSession, unknownWork, workflowForFixture } from '../helpers/S1-workflow-archive-fixture.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import type { HostTakeoverProofV1, UnknownCallReviewDraftV1, UnknownCallReviewRef } from '../../src/contracts/unknown-call-review.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import type { AutoCleanupCandidateV1 } from '../../src/core/work-graph/tasks/run-reconcile-contracts.js';
import { createSessionHealthService } from '../../src/core/work-graph/sessions/session-health.js';
import type { TurnClosureDependencies } from '../../src/core/agent-runtime/execution-contracts.js';
import { KernelTurnRecords } from '../helpers/S2B-kernel-records-fixture.js';

const T0 = '2026-10-08T00:00:00.000Z';
const T1 = '2026-10-09T00:00:00.000Z';
const T1_MINUS_ONE_MS = '2026-10-08T23:59:59.999Z';
const T0_NOON = '2026-10-08T12:00:00.000Z';
const T2 = '2026-10-10T00:00:00.000Z';
const DAY_MS = 86_400_000;

/** The real Kernel store the B2 / task-claim fixture pins. */
const KERNEL_ADAPTER = 'r4c-claim-kernel';
const KERNEL_STORE = 'r4c-claim-kernel-store';
const DEFAULT_ROLE: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };

/**
 * G2: every record/event/lookup bundle the real path this file drives writes or
 * reads. `linkSessionWork` emits `SessionWorkLinkChanged`; the mailbox writes a
 * `SessionMessage` plus its events; the anomaly owner (part 2) writes
 * `SessionAnomalyAnchor` and emits `SessionAnomalyRecorded`.
 */
const ADDITIONAL_SCHEMAS: RecordBackendSchemas = {
  records: [
    ...SESSION_LIFECYCLE_RECORD_SCHEMAS.records,
    ...SESSION_ANOMALY_RECORD_SCHEMAS.records,
    ...SESSION_MESSAGE_RECORD_SCHEMAS.records,
    ...QUERY_JOB_RECORD_SCHEMAS.records,
    ...CONTROL_RECORD_SCHEMAS.records,
    ...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.records,
    ...COMPLETION_RECORD_SCHEMAS.records,
  ],
  events: [
    ...SESSION_LIFECYCLE_RECORD_SCHEMAS.events,
    ...SESSION_ANOMALY_RECORD_SCHEMAS.events,
    ...SESSION_MESSAGE_RECORD_SCHEMAS.events,
    ...QUERY_JOB_RECORD_SCHEMAS.events,
    ...CONTROL_RECORD_SCHEMAS.events,
    ...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.events,
    ...COMPLETION_RECORD_SCHEMAS.events,
  ],
  lookups: [
    ...(SESSION_LIFECYCLE_RECORD_SCHEMAS.lookups ?? []),
    ...(SESSION_ANOMALY_RECORD_SCHEMAS.lookups ?? []),
    ...(SESSION_MESSAGE_RECORD_SCHEMAS.lookups ?? []),
    ...(QUERY_JOB_RECORD_SCHEMAS.lookups ?? []),
    ...(CONTROL_RECORD_SCHEMAS.lookups ?? []),
    ...(UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.lookups ?? []),
  ],
};

type MaintenanceOptions = {
  duty?: SessionDutyResolver; policy?: SessionArchivePolicyV1;
  /** Additive maintenance-only Plans override; absent leaves the fixture's own store. */
  plans?: WorkflowDependencies['plans'];
  /** Additive: publish the real Runtime `closeOpenTurn` seam for a real closure. */
  turnClosure?: TurnClosureDependencies;
};

type Opened = {
  b2: B2ExecutionFixture;
  base: B2ExecutionFixture['base'];
  records: B2Records;
  ctx: CoreCallContext;
  scope: WorkspaceScope;
  goalRef: GoalRef;
  /** S: the first fixture Session, which the real claim already bound to r0. */
  session: SessionRef;
  /** D: a second, independent Session that never ran Task A. */
  target: SessionRef;
  taskA: TaskTriple;
  taskB: TaskTriple;
  run: RunRef;
  anomalies: SessionAnomalyPort;
  responsibilities: SessionResponsibilityPort;
  mailbox: SessionMailboxPort;
  service(options?: MaintenanceOptions): SessionMaintenancePort;
  dutyOf(duty: PlatformDutyV1 | 'unknown'): SessionDutyResolver;
  record(ref?: SessionRef): Promise<SessionRecord>;
  sessionPin(ref: SessionRef): Promise<VersionPin>;
  goalPin(): Promise<VersionPin>;
  currentPlan(): PlanRevisionSnapshot;
  adoptPlan(at: string, edit: (draft: PlanRevisionDraft) => PlanRevisionDraft): Promise<PlanRevisionSnapshot>;
  /** The formal terminal responsibility close at `at` (a new slice-1 entry). */
  closeTerminal(ref: SessionRef, task: TaskTriple, at: string): Promise<void>;
  /** Creation that writes the initial responsible link to `task` (S1-SES-01). */
  createSessionWithInitialLink(requestId: string, task: TaskTriple, role?: RoleConfigurationRef): Promise<SessionRef>;
  /** A real readonly copy whose original inquiry already carries a formal answer. */
  createAnsweredCopy(requestId: string, from: SessionRef): Promise<SessionRef>;
  responsibleLink(ref: SessionRef, task: TaskTriple): Promise<SessionWorkLink | null>;
  openResponsibility(ref: SessionRef, task: TaskTriple): Promise<SessionWorkLink>;
  retire(ref: SessionRef, options?: { releaseOccupancy?: boolean }): Promise<void>;
  readRevision(refKey: string): Promise<number | null>;
  markRunOutcomeUnknown(run: RunRef): Promise<void>;
  setClock(at: string): void;
  finishTask(task: TaskTriple, at: string): Promise<void>;
  modelCalls(): number;
  invariantsHold(label: string): Promise<void>;
};

const opened: Opened[] = [];

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); });
afterEach(async () => {
  vi.useRealTimers();
  for (const fixture of opened.splice(0)) await fixture.b2.close();
});

/** A committed write's value; a failing step fails the row with its own message. */
function committed<T>(result: unknown, label: string): T {
  if (result === null || typeof result !== 'object'
    || (result as { status?: string }).status !== 'committed') {
    throw new Error(`${label}: expected a committed write, got ${JSON.stringify(result)}`);
  }
  return (result as { value: T }).value;
}

/**
 * A future-only revision draft (spec §4.2 "后来的Task定义/无关计划变化不会重置
 * 已做完的时钟"). The real adoption entry requires a schema-2 draft with a new
 * `planId`; the plan service rejects a raw full draft (schema 1) and a revision
 * that reuses the source `planId`.
 */
function draftOf(plan: PlanRevisionSnapshot): PlanRevisionDraft {
  return {
    schemaVersion: 2,
    planId: `${plan.planId}-r${plan.planRevision + 1}`,
    planRevision: plan.planRevision + 1, goalId: plan.goalRef.goalId,
    stages: structuredClone(plan.stages), tasks: structuredClone(plan.tasks),
    assignments: structuredClone(plan.assignments ?? []), obligations: structuredClone(plan.obligations),
    taskHierarchy: structuredClone(plan.taskHierarchy), executionDag: structuredClone(plan.executionDag),
    taskRelations: plan.schemaVersion === 2 ? structuredClone(plan.taskRelations ?? []) : [],
    inputRequirements: plan.schemaVersion === 2 ? structuredClone(plan.inputRequirements ?? []) : [],
  };
}

function cancelTask(draft: PlanRevisionDraft, taskId: string): PlanRevisionDraft {
  return { ...draft, tasks: draft.tasks.map((task) => task.taskId === taskId
    ? { ...task, disposition: 'cancelled' as const } : task) };
}

async function open(kind: 'memory' | 'sqlite'): Promise<Opened> {
  let clock = T0;
  const now = () => clock;
  vi.setSystemTime(new Date(clock));
  const b2 = await createB2ExecutionFixture(kind, ADDITIONAL_SCHEMAS, now);
  const base = b2.base;
  const records = base.records;

  let eventSeq = 0;
  let requestSeq = 0;
  let planSeq = 0;
  const eventId = () => `s1-maintenance-event-${++eventSeq}`;
  const sessionFacts = createSessionFactsService({ records });
  // ':83–91' correction: the trusted basis is the real reader, never a fake.
  const responsibilities = createSessionResponsibilityService({
    records, lookups: records, basis: createSessionResponsibilityBasisReader(records), now,
  });
  const sessionAnomalies = createSessionAnomalyService({ records, lookups: records, sessionFacts, now });
  const sessionLifecycle = createSessionLifecycleService({ records, lookups: records, sessionFacts });
  const materialReads = createMaterialRecordReaders(records);
  const mailbox = createSessionMailbox({
    records,
    sessions: base.sessionsPort,
    executions: createRunStateReader({ records }),
    roles: createRoleConfigurationService({ records, now, eventId }),
    materials: createMaterialService({ bodies: b2.bodies, authority: materialReads.authority, now }),
    systemActor: { kind: 'system', id: 's1-maintenance-system' },
    now, newId: () => `s1-maintenance-id-${++eventSeq}`,
  });

  const session: SessionRef = base.sessions.first;
  const target: SessionRef = base.sessions.second;
  const goalRef = base.goalRef;
  const taskA = base.tasks.first;
  const taskB = base.tasks.second;
  const run = b2.claim.runRef;
  let currentPlan = base.plan;

  const executorDuty: SessionDutyResolver = async (role: RoleConfigurationRef) => ({
    status: 'ready',
    value: role.kind === 'legacy_template' && role.templateId === 'builder' ? 'executor' : 'unknown',
  });

  function responsibleLinkRef(ref: SessionRef, task: TaskTriple): SessionWorkLinkRef {
    return { ...ref, aggregateType: 'SessionWorkLink', target: { kind: 'task', ref: task }, relation: 'responsible' };
  }

  async function readRevisionOf(refKey: string): Promise<number | null> {
    const read = await records.readMany([refKey]);
    if (read.status !== 'ready') throw new Error(`maintenance revision read failed: ${JSON.stringify(read)}`);
    return read.value.records.find((record) => record.refKey === refKey)?.revision ?? null;
  }

  async function sessionPin(ref: SessionRef): Promise<VersionPin> {
    return base.sessionPin(ref);
  }

  async function goalPin(): Promise<VersionPin> {
    const read = await base.plans.queryGoal(base.ctx, goalRef);
    if (read.status !== 'ready') throw new Error(`maintenance goal read failed: ${JSON.stringify(read)}`);
    return { ref: goalRef, revision: read.value.goal.revision };
  }

  async function responsibleLink(ref: SessionRef, task: TaskTriple): Promise<SessionWorkLink | null> {
    const key = sessionWorkLinkRefKey(responsibleLinkRef(ref, task));
    const read = await records.readMany([key]);
    if (read.status !== 'ready') throw new Error(`maintenance link read failed: ${JSON.stringify(read)}`);
    const encoded = read.value.records.find((record) => record.refKey === key);
    if (encoded === undefined) return null;
    const decoded = decodeSessionWorkLink(encoded);
    if (decoded.status !== 'decoded') throw new Error(`maintenance link decode failed: ${decoded.reason}`);
    return decoded.value;
  }

  async function openResponsibility(ref: SessionRef, task: TaskTriple): Promise<SessionWorkLink> {
    const existing = await responsibleLink(ref, task);
    if (existing !== null && existing.until === null) return existing;
    const linkRef = responsibleLinkRef(ref, task);
    const linkRevision = (await readRevisionOf(sessionWorkLinkRefKey(linkRef))) ?? 0;
    const request: GraphWrite<LinkSessionWorkInput> = {
      input: { sessionRef: ref, target: { kind: 'task', ref: task }, relation: 'responsible', active: true },
      meta: { requestId: `s1-maintenance-link-${ref.sessionId}-${task.taskId}`, expected: [await sessionPin(ref), { ref: linkRef, revision: linkRevision }] },
    };
    return committed<SessionWorkLink>(await sessionLifecycle.linkSessionWork(base.ctx, request), 'maintenance link setup');
  }

  async function adoptPlan(at: string, edit: (draft: PlanRevisionDraft) => PlanRevisionDraft): Promise<PlanRevisionSnapshot> {
    clock = at;
    vi.setSystemTime(new Date(at));
    const plans = createPlanService({ records, now: () => at, eventId: () => `s1-maintenance-plan-${++planSeq}` });
    const draft = edit(draftOf(currentPlan));
    const affectedTaskIds = draft.tasks.filter(task =>
      JSON.stringify(task) !== JSON.stringify(currentPlan.tasks.find(previous => previous.taskId === task.taskId)))
      .map(task => task.taskId);
    const proposed = await plans.proposePlan(base.ctx, {
      meta: { requestId: `s1-maintenance-propose-${++requestSeq}`, expected: [] },
      input: { goalRef, basedOn: currentPlan.ref, draft,
        reason: { text: 'S1 maintenance given', sources: [], affectedTaskIds } },
    });
    if (proposed.status !== 'committed') throw new Error(`maintenance plan proposal failed: ${JSON.stringify(proposed)}`);
    if (proposed.value.issues.length > 0) throw new Error(`maintenance plan proposal has issues: ${JSON.stringify(proposed.value.issues)}`);
    const applied = await plans.applyPlanChange(base.ctx, {
      meta: { requestId: `s1-maintenance-apply-${++requestSeq}`, expected: [] },
      input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
    });
    if (applied.status !== 'committed') throw new Error(`maintenance plan adoption failed: ${JSON.stringify(applied)}`);
    currentPlan = applied.value;
    return applied.value;
  }

  async function createSessionWithInitialLink(requestId: string, task: TaskTriple,
    role: RoleConfigurationRef = DEFAULT_ROLE): Promise<SessionRef> {
    const admitted = await base.sessionsPort.admitSessionCreation(base.ctx, {
      meta: { requestId: `s1-maintenance-admit-${requestId}`, expected: [] },
      input: { workspace: base.scope, kernelStore: { adapterId: KERNEL_ADAPTER, storeKey: KERNEL_STORE },
        role, recommendedRefs: [], initialLinks: [{ target: { kind: 'task', ref: task }, relation: 'responsible' }] },
    });
    if (admitted.status !== 'committed') throw new Error(`maintenance Session admission failed: ${JSON.stringify(admitted)}`);
    const registered = await base.sessionsPort.recordSessionCreated(base.ctx, {
      meta: { requestId: `s1-maintenance-register-${requestId}`, expected: [] },
      input: { operationRef: admitted.value.ref, sessionRef: admitted.value.action.plannedSessionRef,
        adapterId: KERNEL_ADAPTER, kernelSessionId: `s1-maintenance-kernel-${requestId}`,
        historyCursor: null, observedAt: T0 },
    });
    if (registered.status !== 'committed') throw new Error(`maintenance Session registration failed: ${JSON.stringify(registered)}`);
    return { projectId: registered.value.ref.projectId, sessionId: registered.value.ref.sessionId };
  }

  async function createAnsweredCopy(requestId: string, from: SessionRef): Promise<SessionRef> {
    const query = await beginConsultation(b2, requestId, from, now);
    await query.answer();
    return query.sessionRef;
  }
  async function closeTerminal(ref: SessionRef, task: TaskTriple, at: string): Promise<void> {
    await openResponsibility(ref, task);
    const current = currentPlan.tasks.find((candidate) => candidate.taskId === task.taskId);
    if (current === undefined || current.disposition === 'active') {
      await adoptPlan(at, (draft) => cancelTask(draft, task.taskId));
    }
    clock = at;
    const linkRef = responsibleLinkRef(ref, task);
    const result = await responsibilities.closeTerminalResponsibility(base.ctx, {
      input: { sessionRef: ref, target: { kind: 'task', ref: task } },
      meta: { requestId: `s1-maintenance-terminal-${ref.sessionId}-${task.taskId}`, expected: [
        await sessionPin(ref),
        { ref: linkRef, revision: (await readRevisionOf(sessionWorkLinkRefKey(linkRef))) ?? 0 },
        await goalPin(),
      ] },
    });
    if (result.status !== 'committed') throw new Error(`maintenance terminal close failed: ${JSON.stringify(result)}`);
    expect(result.value.until).toBe(result.cursor);
    const event = await records.eventAt(result.cursor);
    if (event.status !== 'ready') throw new Error(JSON.stringify(event));
    const closed = sessionResponsibilityChangedEventFromEvent(event.value.event);
    if (closed.status !== 'decoded') throw new Error(closed.reason);
    expect({ mode: closed.value.mode, task: closed.value.taskBasis.task, finishedAt: closed.value.taskBasis.finishedAt })
      .toEqual({ mode: 'terminal', task, finishedAt: at });
  }

  const fixture: Opened = {
    b2, base, records, ctx: base.ctx, scope: base.scope, goalRef, session, target, taskA, taskB, run,
    anomalies: sessionAnomalies, responsibilities, mailbox,
    service(options = {}) {
      return { async maintainSessions(ctx, input) {
        const workflow = await workflowForFixture(b2, { now, records,
          ...(options.plans === undefined ? {} : { plans: options.plans }),
          ...(options.turnClosure === undefined ? {} : { turnClosure: options.turnClosure }),
          archivePolicy: options.policy ?? DEFAULT_SESSION_ARCHIVE_POLICY,
          sessionDuty: options.duty ?? executorDuty });
        if (workflow.maintainSessions === undefined) throw new Error('Workflow maintenance is absent');
        return workflow.maintainSessions(ctx, input);
      } };
    },
    dutyOf(duty) {
      return async () => ({ status: 'ready', value: duty });
    },
    async record(ref = session) {
      const card = await base.sessionsPort.readSession(base.ctx, ref);
      if (card.status !== 'ready') throw new Error(`maintenance Session read failed: ${JSON.stringify(card)}`);
      return card.value.record;
    },
    sessionPin,
    goalPin,
    currentPlan() { return currentPlan; },
    adoptPlan,
    closeTerminal,
    createSessionWithInitialLink,
    createAnsweredCopy,
    responsibleLink,
    openResponsibility,
    async retire(ref, options = {}) {
      if (ref.sessionId === session.sessionId && options.releaseOccupancy !== false) {
        await interruptWork(b2, now);
      } else {
        await retireSession(base, ref, now);
      }
    },
    readRevision: readRevisionOf,
    async markRunOutcomeUnknown(targetRun) {
      expect(targetRun).toEqual(run);
      await unknownWork(b2, now);
    },
    setClock(at) { clock = at; vi.setSystemTime(new Date(at)); },
    async finishTask(task, at) {
      fixture.setClock(at);
      let claim = b2.claim;
      if (task.taskId !== taskA.taskId) {
        const result = await base.service.claimTask(base.ctx, await base.buildRequest({
          input: { taskId: task.taskId, planRef: currentPlan.ref, sessionRef: session },
          requestId: `maintenance-claim-${task.taskId}`,
        }));
        if (result.status !== 'committed') throw new Error(`new task claim: ${JSON.stringify(result)}`);
        claim = result.value;
      }
      await openResponsibility(session, task);
      await completeWork(b2, claim);
      await closeTerminal(session, task, at);
      expect((await fixture.record()).occupancy).toBeNull();
    },
    modelCalls() { return base.audit.events().filter(({ event }) => event.eventType === 'ModelRequestAuthorized').length; },
    invariantsHold: (label) => base.audit.check(label),
  };
  opened.push(fixture);
  return fixture;
}

const S1_MAINTENANCE_HOST = 's1-maintenance-host';
const S1_MAINTENANCE_PROOF: HostTakeoverProofV1 = {
  kind: 'hl03_stale_lock', previousInstanceId: 's1-maintenance-previous-host', previousPid: 4242,
};

/**
 * The real RUN-25 owner path: a real `takeover_unresolved` end (a matching
 * Host-takeover proof and an automatic-closure candidate) leaves the Session
 * retired `kernel_turn_open` and creates the open `pending_review` record with
 * `activeRound: null`. The Kernel Turn is appended through the public Kernel
 * store so the real maintenance closure can close it later.
 */
async function createRun25ReviewState(f: Opened): Promise<UnknownCallReviewRef> {
  await f.openResponsibility(f.session, f.taskA);
  await f.b2.enter();
  const kernel = await f.b2.kernelFor(f.b2.claim);
  const turn = new KernelTurnRecords({ kernel, at: T0 });
  turn.runStarted();
  const stores = await createKernelStoreRegistry({ entries: [{ adapterId: kernel.adapterId,
    storeKey: KERNEL_STORE, workspace: f.scope, databasePath: join(f.base.directory, 'kernel.sqlite') }] });
  await stores.withStore(kernel.adapterId, async (store) => {
    const header = await store.get(kernel.kernelSessionId, { signal: f.ctx.signal });
    const drafts = turn.records().map(({ record }) => ({
      recordId: record.recordId, recordType: record.recordType, schemaVersion: record.schemaVersion,
      recordedAt: record.recordedAt, payload: record.payload,
    }) as SessionRecordDraft);
    await store.append(kernel.kernelSessionId, header.revision, drafts, { signal: f.ctx.signal });
  });

  const callId = 's1-maintenance-unresolved-call';
  const workspace = { status: 'unavailable' as const, runBaselineKnown: false,
    reason: 'not_configured' as const, detail: 's1-maintenance' };
  const draft: UnknownCallReviewDraftV1 = {
    inventory: 'complete', inventoryProblem: null, itemsOmitted: 0, workspace,
    items: [{ alias: 1, callId, toolName: 'shell', kind: 'process', contained: true,
      kernel: { adapterId: kernel.adapterId, kernelSessionId: kernel.kernelSessionId,
        kernelRunId: kernel.runId, turnId: kernel.turnId, callId, declaredPosition: 1, startedPosition: 2 },
      argumentsDigest: 'd'.repeat(64),
      summary: { command: 'echo hi', cwd: '/w', mode: null, paths: [], pathsOmitted: 0, truncated: false },
      startedAt: T0, observed: { verdict: 'pending', by: null } }],
  };
  const candidate: AutoCleanupCandidateV1 = {
    proof: S1_MAINTENANCE_PROOF, closure: { status: 'supported', headActiveRunId: kernel.runId },
    workspace, unresolvedCalls: [{ callId, toolName: 'shell' }], draft,
  };
  let seq = 0;
  const reconcile = createRunReconcileService({ records: f.records, reads: createRunStateReader({ records: f.records }),
    hostInstance: { hostInstanceId: S1_MAINTENANCE_HOST, lease: 'owned', takeover: S1_MAINTENANCE_PROOF },
    now: () => T0, eventId: () => `s1-maintenance-reconcile-${++seq}` });
  const marked = await reconcile.reconcileRun(f.ctx, { input: {
    runRef: f.b2.claim.runRef,
    basis: { kind: 'host_instance_takeover', hostInstanceId: S1_MAINTENANCE_HOST },
    probe: 'ready',
    result: { kind: 'unknown', cause: 'tool_calls_unresolved', unresolvedToolCallIds: [callId],
      observedThroughPosition: null,
      turn: { terminal: false, inFlightToolCallIds: [callId], lastPosition: null, kernelPaused: false,
        entered: null, acceptedSteers: [], inputsConfirmed: true },
      autoCleanup: candidate },
  }, meta: { requestId: 's1-maintenance-run25', expected: [await f.b2.pin()] } });
  expect(marked, JSON.stringify(marked)).toMatchObject({ status: 'committed' });

  const run = await f.b2.read();
  expect(run.run).toMatchObject({ status: 'ended', outcome: 'crashed',
    reconciliation: { observation: { kind: 'takeover_unresolved' } } });
  expect(await f.record()).toMatchObject({ lifecycle: 'active', occupancy: null, health: 'unavailable',
    healthConclusion: 'kernel_turn_open' });
  const reviewRef: UnknownCallReviewRef = { aggregateType: 'UnknownCallReview',
    projectId: f.b2.claim.runRef.projectId, goalId: f.b2.claim.runRef.goalId, runId: f.b2.claim.runRef.runId };
  const reviews = createUnknownCallReviewService({ records: f.records });
  const review = await reviews.readReview(f.ctx, { ref: reviewRef });
  expect(review).toMatchObject({ status: 'ready', value: { status: 'pending_review', activeRound: null } });
  return reviewRef;
}

describe.each(['memory', 'sqlite'] as const)('S1 Session maintenance goal-read failure (%s)', (kind) => {
  it('IT35 an unreadable Goal read closes nothing; an active Goal defers; a paused Goal closes the dangling Turn', async () => {
    const f = await open(kind);
    const reviewRef = await createRun25ReviewState(f);
    const reviews = createUnknownCallReviewService({ records: f.records });
    const beforeSession = await f.record();
    const beforeRunRevision = (await f.b2.read()).run.revision;
    const beforeReview = await reviews.readReview(f.ctx, { ref: reviewRef });
    if (beforeReview.status !== 'ready') throw new Error(JSON.stringify(beforeReview));
    const beforeReviewRevision = beforeReview.value.revision;
    const beforeEvents = f.base.audit.events().length;
    const beforeTotals = f.base.audit.totals();

    let goalReads = 0;
    let failGoalRead = true;
    let healthSeq = 0;
    const health = createSessionHealthService({ records: f.records,
      hostInstance: { hostInstanceId: S1_MAINTENANCE_HOST, lease: 'owned' },
      now: () => T0, eventId: () => `s1-maintenance-health-${++healthSeq}` });
    const turnClosure: TurnClosureDependencies = { recordSessionHealth: health.recordSessionHealth, lease: 'owned' };
    const plans: WorkflowDependencies['plans'] = {
      ...f.base.plans,
      async queryGoal(ctx, ref) {
        goalReads += 1;
        if (failGoalRead) {
          failGoalRead = false;
          return { status: 'rejected' as const, code: 'unavailable' as const, reason: 'injected goal read failure' };
        }
        return f.base.plans.queryGoal(ctx, ref);
      },
    };

    // Pass 1: the Goal read fails. The unreadable Goal is NOT "inactive": the
    // line is skipped with zero commits, exactly like the other read failures.
    const pass1 = await f.service({ plans, turnClosure }).maintainSessions(f.ctx, { workspace: f.scope, after: null });
    expect(pass1).toMatchObject({ status: 'ready', value: { archived: [] } });
    expect(await f.record()).toEqual(beforeSession);
    expect(await f.record()).toMatchObject({ lifecycle: 'active', health: 'unavailable',
      healthConclusion: 'kernel_turn_open' });
    expect((await f.b2.read()).run.revision).toBe(beforeRunRevision);
    expect((await reviews.readReview(f.ctx, { ref: reviewRef })).status).toBe('ready');
    const reviewAfterPass1 = await reviews.readReview(f.ctx, { ref: reviewRef });
    if (reviewAfterPass1.status !== 'ready') throw new Error(JSON.stringify(reviewAfterPass1));
    expect(reviewAfterPass1.value.revision).toBe(beforeReviewRevision);
    expect(f.base.audit.events().length).toBe(beforeEvents);
    expect(f.base.audit.totals()).toEqual(beforeTotals);
    expect(goalReads).toBe(1);

    // Pass 2: the Goal read succeeds and the Goal is active. The review claim
    // still owns the close, so maintenance defers with zero commits.
    const pass2 = await f.service({ plans, turnClosure }).maintainSessions(f.ctx, { workspace: f.scope, after: null });
    expect(pass2).toMatchObject({ status: 'ready', value: { archived: [] } });
    expect(await f.record()).toEqual(beforeSession);
    expect((await f.b2.read()).run.revision).toBe(beforeRunRevision);
    expect(f.base.audit.events().length).toBe(beforeEvents);
    expect(f.base.audit.totals()).toEqual(beforeTotals);
    expect(goalReads).toBe(2);

    // Pass 3: the paused Goal has no claim left to run, so it is maintenance's
    // close. This proves pass 2 really evaluated an ACTIVE Goal instead of
    // silently skipping like a failed read.
    const paused = await f.base.goals.setGoalControl(f.ctx, { input: {
      goalRef: f.goalRef, control: 'pause', reason: 'no review claim may run now',
    }, meta: { requestId: 's1-maintenance-pause-goal',
      expected: [await f.goalPin(), { ref: { aggregateType: 'GoalPhase' as const,
        projectId: f.scope.projectId, goalId: f.goalRef.goalId }, revision: 0 }] } });
    expect(paused, JSON.stringify(paused)).toMatchObject({ status: 'committed' });
    const pass3 = await f.service({ plans, turnClosure }).maintainSessions(f.ctx, { workspace: f.scope, after: null });
    expect(pass3).toMatchObject({ status: 'ready', value: { archived: [] } });
    expect(await f.record()).toMatchObject({ lifecycle: 'active', occupancy: null, health: 'available',
      healthConclusion: null });
    expect(goalReads).toBe(3);
  }, 60_000);
});

describe.each(['sqlite'] as const)('S1 Session maintenance (%s)', (kind) => {
  it('IT06 an executor one millisecond short of the threshold is not archived; lifecycle stays active', async () => {
    const f = await open(kind);
    // Given: the formal terminal close saved the executor's finished task at t0.
    await f.finishTask(f.taskA, T0);
    await f.invariantsHold('after the terminal close at t0');
    f.setClock(T1_MINUS_ONE_MS);
    const result = await f.service().maintainSessions(f.ctx, { workspace: f.scope, after: null });
    expect(result).toMatchObject({ status: 'ready', value: { archived: [] } });
    expect(await f.record(f.session)).toMatchObject({ lifecycle: 'active' });
    expect(f.modelCalls()).toBe(0);
  });

  it('IT07 an executor idle for the full day archives at t1 with archivedAt=t1 and starts no model', async () => {
    const f = await open(kind);
    await f.finishTask(f.taskA, T0);
    await f.invariantsHold('after the terminal close at t0');
    f.setClock(T1);
    const result = await f.service().maintainSessions(f.ctx, { workspace: f.scope, after: null });
    expect(result).toMatchObject({ status: 'ready', value: { archived: [f.session] } });
    expect(await f.record(f.session)).toMatchObject({ lifecycle: 'archived', archivedAt: T1 });
    // The bounded maintenance step never starts a Kernel/check/model.
    expect(f.modelCalls()).toBe(0);
  });

  it('IT08 a new unfinished Task before the deadline defers the archive; the new Task restarts the full day', async () => {
    const f = await open(kind);
    await f.finishTask(f.taskA, T0);
    // Given: a new unfinished Task was bound to S before the old deadline.
    const newTask: TaskTriple = { projectId: f.taskA.projectId, goalId: f.taskA.goalId, taskId: 'implement-c' };
    await f.adoptPlan(T0_NOON, (draft) => ({
      ...draft,
      tasks: [...draft.tasks, { taskId: newTask.taskId, title: 'New maintenance Task', requirementLevel: 'required',
        taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } }],
      assignments: [...(draft.assignments ?? []), { taskId: newTask.taskId, role: 'builder', instruction: 'New maintenance Task' }],
      obligations: draft.obligations.map((obligation) => obligation.obligationId === 'obligation-1'
        ? { ...obligation, taskIds: [...obligation.taskIds, newTask.taskId] } : obligation),
    }));
    await f.openResponsibility(f.session, newTask);
    await f.invariantsHold('after the new open responsibility');
    f.setClock(T1);
    const beforeNewFinishedAt = await f.service().maintainSessions(f.ctx, { workspace: f.scope, after: null });
    expect(beforeNewFinishedAt).toMatchObject({ status: 'ready', value: { archived: [] } });
    expect(await f.record(f.session)).toMatchObject({ lifecycle: 'active' });

    // The new Task finishes at t1: the due clock restarts at the NEW finishedAt + one day.
    await f.finishTask(newTask, T1);
    f.setClock('2026-10-09T23:59:59.999Z');
    const beforeNewDeadline = await f.service().maintainSessions(f.ctx, { workspace: f.scope, after: null });
    if (beforeNewDeadline.status !== 'ready') throw new Error(JSON.stringify(beforeNewDeadline));
    expect(beforeNewDeadline.value.archived).toEqual([]);
    f.setClock(T2);
    const afterNewFinishedAt = await f.service().maintainSessions(f.ctx, { workspace: f.scope, after: null });
    expect(afterNewFinishedAt).toMatchObject({ status: 'ready', value: { archived: [f.session] } });
    expect(await f.record(f.session)).toMatchObject({ lifecycle: 'archived', archivedAt: T2 });
    expect(f.modelCalls()).toBe(0);
  });

  it('IT09 the four non-executor duties and unknown are never archived by the executor one-day threshold', async () => {
    const f = await open(kind);
    const duties = ['secretary', 'adviser', 'scribe', 'reviewer'] as const;
    const idle: SessionRef[] = [];
    for (const duty of [...duties, 'unknown']) {
      const ref = await f.base.createSession(`it09-${duty}`,
        { kind: 'legacy_template', templateId: duty, templateRevision: '1' });
      // Same idle history as an executor: a formally closed finished task at t0.
      await f.closeTerminal(ref, f.taskB, T0);
      idle.push(ref);
    }
    await f.invariantsHold('after the five non-executor idle histories');
    const resolver: SessionDutyResolver = async (role) => {
      if (role.kind !== 'legacy_template') return { status: 'ready', value: 'unknown' };
      const known = (duties as readonly string[]).includes(role.templateId)
        ? role.templateId as PlatformDutyV1 : 'unknown';
      return { status: 'ready', value: known };
    };
    f.setClock(T1);
    const result = await f.service({ duty: resolver }).maintainSessions(f.ctx, { workspace: f.scope, after: null });
    expect(result).toMatchObject({ status: 'ready', value: { archived: [] } });
    for (const ref of idle) expect(await f.record(ref)).toMatchObject({ lifecycle: 'active' });
    expect(f.modelCalls()).toBe(0);
  });

  it('IT10 a fresh retired line with no continuation and released occupancy archives in the same step, not after a day', async () => {
    const f = await open(kind);
    // Given: S retired, no continuation; an open responsibility to the still
    // unfinished Task A, for which S really ran r0.
    await f.openResponsibility(f.session, f.taskA);
    await f.b2.enter();
    f.setClock(T1);
    await f.retire(f.session, { releaseOccupancy: true });
    await f.invariantsHold('after the retirement');
    f.setClock(T1);
    const result = await f.service().maintainSessions(f.ctx, { workspace: f.scope, after: null });
    expect(result).toMatchObject({ status: 'ready', value: { archived: [f.session] } });
    expect(await f.record(f.session)).toMatchObject({ lifecycle: 'archived', archivedAt: T1 });
    // The unfinished Task is dropped and a retired_archive anchor is recorded.
    const link = await f.responsibleLink(f.session, f.taskA);
    expect(link?.until ?? null).not.toBeNull();
    const listed = await f.anomalies.listSessionAnomalies(f.ctx, { goalRef: f.goalRef, page: { limit: 20 } });
    expect(listed).toMatchObject({ status: 'ready', value: { items: [
      expect.objectContaining({ anchor: expect.objectContaining({ runRef: f.run, cause: 'retired_archive' }) }),
    ] } });
    expect(f.modelCalls()).toBe(0);
  });

  it('IT11 an answered readonly copy archives while its still-running source keeps revision and occupancy', async () => {
    const f = await open(kind);
    // The source is really running, so the copy is a separate line.
    await f.b2.enter();
    const sourceBefore = await f.record(f.session);
    expect(sourceBefore.occupancy).not.toBeNull();
    const copy = await f.createAnsweredCopy('it11', f.session);
    await f.invariantsHold('after the answered copy');
    const queriesBefore = (await f.base.audit.world()).queryRuns;
    expect(queriesBefore).toHaveLength(1);
    expect(queriesBefore[0]?.run.outcome).toBe('answered');
    const modelCallsBefore = f.modelCalls();
    f.setClock(T1);
    const result = await f.service().maintainSessions(f.ctx, { workspace: f.scope, after: null });
    expect(result).toMatchObject({ status: 'ready', value: { archived: [copy] } });
    expect(await f.record(copy)).toMatchObject({ lifecycle: 'archived', archivedAt: T1, occupancy: null, archiveRequest: null });
    const sourceAfter = await f.record(f.session);
    expect(sourceAfter.revision).toBe(sourceBefore.revision);
    expect(sourceAfter.occupancy).toEqual(sourceBefore.occupancy);
    // The Query/provider path is not re-run by maintenance.
    expect((await f.base.audit.world()).queryRuns).toEqual(queriesBefore);
    expect(f.modelCalls()).toBe(modelCallsBefore);
    await f.invariantsHold('after copy maintenance');
  });

  it('IT31 a due executor uses the terminal close event finishedAt=t0 even after a later plan redefinition', async () => {
    const f = await open(kind);
    await f.finishTask(f.taskA, T0);
    // B was assigned to S but cancelled before execution. A's real completion
    // releases the fixture's initial occupancy; both terminal closes occur at t0.
    // Future-only plans may redefine B because it has no execution trace.
    // B is an explicit plan_only intent, so the plan stays admissible once A and B are both cancelled
    // (plan-validation: a work Task with an explicit intent replaces the required+work+active minimum).
    // It does not hand B back to S (lead fix of the frozen test, 2026-10-09).
    await f.adoptPlan(T0, (draft) => ({ ...draft, tasks: draft.tasks.map((task) => task.taskId === f.taskB.taskId
      ? { ...task, executionIntent: 'plan_only' as const } : task) }));
    await f.closeTerminal(f.session, f.taskB, T0);
    // Given: a later plan changed the same Task definition without handing it
    // back to S; the due clock must still be the close event's finishedAt.
    await f.adoptPlan(T1, (draft) => ({ ...draft, tasks: draft.tasks.map((task) => task.taskId === f.taskB.taskId
      ? { ...task, title: 'Task B redefined later' } : task) }));
    expect(f.currentPlan().tasks.find(task => task.taskId === f.taskB.taskId)?.title).toBe('Task B redefined later');
    expect((await f.responsibleLink(f.session, f.taskB))?.until).not.toBeNull();
    await f.invariantsHold('after the later plan redefinition');
    f.setClock(T1);
    const result = await f.service().maintainSessions(f.ctx, { workspace: f.scope, after: null });
    expect(result).toMatchObject({ status: 'ready', value: { archived: [f.session] } });
    expect(await f.record(f.session)).toMatchObject({ lifecycle: 'archived', archivedAt: T1 });
    // The due clock is the close event's finishedAt, not the new plan's acceptedAt.
    expect(DEFAULT_SESSION_ARCHIVE_POLICY.executorArchiveAfterMs).toBe(DAY_MS);
    expect(f.modelCalls()).toBe(0);
  });

  it('IT33 a retired Session with an open initial creation link but no execution for it drops the link and writes no anchor', async () => {
    const f = await open(kind);
    const taskA = f.taskB;
    const beforeWorld = await f.base.audit.world();
    const beforePhase = beforeWorld.taskStates.find(task => task.taskId === taskA.taskId)?.phase;
    expect(beforePhase).toBe('pending');
    // Given: the link is the initial link written by Session creation itself
    // (S1-SES-01), and this Session never ran an execution for Task A.
    const retired = await f.createSessionWithInitialLink('it33', taskA);
    const initial = await f.responsibleLink(retired, taskA);
    expect(initial?.since ?? null).not.toBeNull();
    expect(initial?.until ?? null).toBeNull();
    await f.retire(retired, { releaseOccupancy: true });
    await f.invariantsHold('after the retirement of the initial-link Session');
    f.setClock(T1);
    const result = await f.service().maintainSessions(f.ctx, { workspace: f.scope, after: null });
    expect(result).toMatchObject({ status: 'ready', value: { archived: [retired] } });
    expect(await f.record(retired)).toMatchObject({ lifecycle: 'archived' });
    const link = await f.responsibleLink(retired, taskA);
    if (link === null || link.until === null) throw new Error('IT33 initial responsibility was not closed');
    const closingEvent = await f.records.eventAt(link.until);
    if (closingEvent.status !== 'ready') throw new Error(JSON.stringify(closingEvent));
    const closed = sessionResponsibilityChangedEventFromEvent(closingEvent.value.event);
    if (closed.status !== 'decoded') throw new Error(closed.reason);
    expect(closed.value.closed.ref).toEqual(link.ref);
    expect((await f.base.audit.world()).anchors).toEqual([]);
    expect((await f.base.audit.world()).requeues).toEqual([]);
    const listed = await f.anomalies.listSessionAnomalies(f.ctx, { goalRef: f.goalRef, page: { limit: 20 } });
    expect(listed).toMatchObject({ status: 'ready', value: { items: [] } });
    const archiveState = await f.anomalies.readTaskArchiveState(f.ctx, taskA);
    expect(archiveState).toMatchObject({ status: 'ready', value: { label: null, pending: [] } });
    // The phase is read from the CURRENT records, not the fixture's old plan snapshot.
    const graph = await f.base.plans.queryTaskGraph(f.ctx, { goalRef: f.goalRef });
    if (graph.status !== 'ready') throw new Error(`IT33 task graph read failed: ${JSON.stringify(graph)}`);
    expect(graph.value.tasks.find((task) => task.ref.taskId === taskA.taskId)?.effectivePhase).toBe(beforePhase);
    expect(f.modelCalls()).toBe(0);
  });

  it('IT34 a retired line whose unknown Run still occupies it is skipped with one busy failure and zero commits to S', async () => {
    const f = await open(kind);
    await f.b2.enter();
    await f.markRunOutcomeUnknown(f.run);
    await f.openResponsibility(f.session, f.taskA);
    await f.retire(f.session, { releaseOccupancy: false });
    await f.invariantsHold('after the retired unknown-occupancy line');
    const before = await f.record(f.session);
    const totalsBefore = f.base.audit.totals();
    f.setClock(T1);

    const result = await f.service().maintainSessions(f.ctx, { workspace: f.scope, after: null });
    expect(result).toMatchObject({ status: 'ready', value: {
      archived: [], pending: [], failures: [{ sessionRef: f.session, rejection: { status: 'rejected', code: 'busy' } }],
    } });
    if (result.status !== 'ready') throw new Error(`IT34 maintenance did not return a readable result: ${JSON.stringify(result)}`);
    expect(result.value.failures).toHaveLength(1);
    expect(result.value.failures[0]?.rejection.reason.startsWith('archive_unknown_confirmation_required:')).toBe(true);

    // Zero commits to S: no archive request, no anchor, the link stays open,
    // r0 is still outcome_unknown and S keeps its occupancy.
    const after = await f.record(f.session);
    expect(f.base.audit.totals()).toEqual(totalsBefore);
    expect(after).toEqual(before);
    expect(after.revision).toBe(before.revision);
    expect(after.archiveRequest ?? null).toBeNull();
    expect(after.occupancy).toEqual(before.occupancy);
    const link = await f.responsibleLink(f.session, f.taskA);
    expect(link?.until ?? null).toBeNull();
    const listed = await f.anomalies.listSessionAnomalies(f.ctx, { goalRef: f.goalRef, page: { limit: 20 } });
    expect(listed).toMatchObject({ status: 'ready', value: { items: [] } });
    expect((await f.b2.read()).run.outcome).toBe('outcome_unknown');
    expect(f.modelCalls()).toBe(0);
  });
});


