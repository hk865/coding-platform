/**
 * WP1 group H, memory owners; wiring-1-SPEC §0 L10-L17 overrides the body.
 * Export -> rows -> history (the test, never a builder, advances the Workflow):
 * createHandoverWorkflow -> all -> S1 workflowForFixture composition with selectable
 *   configuration/responsibility seam and the IT13 one-shot final-commit fault.
 * createInterruptedHandoverFixture -> HO01/02/06/08/10/12 -> claim/link, enter,
 *   unknown reconciliation, HUMAN attestation, HUMAN requeue (L15).
 * createRoleMismatchHandoverFixture -> HO03/07/13 -> claim under binding Y,
 *   observed terminal crash, requeue, second Workflow with binding X on SAME store.
 * createOtherResponsibilityFixture -> HO04 -> above plus fresh T2 claimed/linked/ended in P.
 * createOccupiedPredecessorFixture -> HO05 -> above plus fresh T2 claimed/linked/entered in P.
 * createArchivedPredecessorFixture -> HO09 -> stopped/requeued T, operator archive/drop.
 * createReusablePredecessorFixture -> HO11 -> observed crash/requeue, original P reusable.
 * createHandedOverRetiredFixture -> HM01 -> attested retired P, real continuation C, T transfer.
 * createStillResponsibleRetiredFixture -> HM02 -> attested retired P, continuation C, T retained.
 * createUnknownOccupiedRetiredFixture -> HM03 -> entered/unknown/retired P, continuation C.
 * createModuleOnlyRetiredFixture -> HM04 -> module link before retirement, C, T transfer.
 * bumpSessionRevision -> HO08 -> public participates link to the existing fx3-work module.
 *
 * HO02/06/08/12 start with the HO01 builder; HO07 starts with HO03. The test
 * performs create_session, keeps its actual returned next operation and stops
 * there for the crash/stale-pin/replay boundary. No future step is fabricated.
 *
 * Scope/IDs are inherited from S1-workflow-archive-fixture, not p/w:
 * r4c-claim-project / r4c-claim-workspace. t0/t1 are the spec timestamps.
 * Kernel observations follow the existing B2 trusted observation boundary;
 * no records, events, revisions or prepared bindings are patched into the store.
 * Current claim-service writes no SessionWorkLink: as in S1-archive-flow's
 * openResponsibility, linkSessionWork establishes P->T after the real claim.
 * Lifecycle owners use Date directly: builders freeze Date only and close restores it.
 */
import { join } from 'node:path';
import { vi } from 'vitest';
import * as kernelApi from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef, SessionRef, SessionWorkLinkRef, VersionPin,
  WorkLinkRelation, WorkLinkTarget, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { SessionWorkLink } from '../../src/contracts/core/session.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { TaskRequeueSnapshotV1 } from '../../src/contracts/task-requeue.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createExecutionHistoryReader } from '../../src/core/agent-runtime/observation-recovery.js';
import { createGraphExecutionHistoryReader } from '../../src/core/agent-runtime/graph-execution-history.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { createExecutionHistoryService } from '../../src/core/work-graph/tasks/execution-history-service.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { createSessionAnomalyService } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { createSessionResponsibilityBasisReader, readCanonicalTaskFacts, readGoalPlanWindow } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import { createSessionResponsibilityService } from '../../src/core/work-graph/sessions/session-responsibility-service.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { sessionWorkLinkRefKey, decodeSessionWorkLink }
  from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS, SESSION_ARCHIVED_EVENT, SESSION_ARCHIVE_REQUESTED_EVENT,
  sessionArchiveChangedEventFromEvent } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { SESSION_ANOMALY_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import { SESSION_MESSAGE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import { createWorkflow } from '../../src/business/workflow/workflow.js';
import { DEFAULT_SESSION_ARCHIVE_POLICY, type WorkflowDependencies, type WorkflowHostConfiguration }
  from '../../src/business/workflow/ports.js';
import type { WorkflowAdvanceBase, WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import { createB2ExecutionFixture, unknownWork, retireSession, type B2ExecutionFixture, type B2Records }
  from './S1-workflow-archive-fixture.js';
import { createRuntimeHostDouble, createScriptedModel } from './B2-runtime-fixture.js';

const T0 = '2026-10-08T00:00:00.000Z';
const T1 = '2026-10-09T00:00:00.000Z';
const ROLE_Y: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
const ROLE_X: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'builder', templateRevision: '2' };
const bundles = [SESSION_LIFECYCLE_RECORD_SCHEMAS, SESSION_ANOMALY_RECORD_SCHEMAS,
  SESSION_MESSAGE_RECORD_SCHEMAS, QUERY_JOB_RECORD_SCHEMAS, CONTROL_RECORD_SCHEMAS,
  UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS];
const SCHEMAS: RecordBackendSchemas = {
  records: bundles.flatMap(bundle => bundle.records), events: bundles.flatMap(bundle => bundle.events),
  lookups: bundles.flatMap(bundle => bundle.lookups ?? []),
};

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`WP1 given read: ${JSON.stringify(result)}`);
  return result.value;
}
function committed<T>(result: WriteResult<T>): T {
  if (result.status !== 'committed') throw new Error(`WP1 given write: ${JSON.stringify(result)}`);
  return result.value;
}
function sameSession(a: SessionRef, b: SessionRef): boolean {
  return a.projectId === b.projectId && a.sessionId === b.sessionId;
}
function sameTask(a: TaskTriple, b: TaskTriple): boolean {
  return a.projectId === b.projectId && a.goalId === b.goalId && a.taskId === b.taskId;
}

type HandoverWorkflowOptions = {
  now: () => string;
  configuration: WorkflowHostConfiguration;
  /** HO10 only: omit the Workflow seam, retaining real setup owners. */
  responsibilities?: boolean;
  /** HO13 only; create this composition after setup archives are finished. */
  failFinalArchive?: boolean;
  sessionDuty?: WorkflowDependencies['sessionDuty'];
};

/** Copied from S1 workflowForFixture:1169-1256, with explicit config and now. */
async function createHandoverWorkflow(b2: B2ExecutionFixture, options: HandoverWorkflowOptions) {
  const base = b2.base;
  let finalArchiveConflicts = 0;
  // S1-archive-flow.test.ts:189-203 (IT13): refuse exactly one final commit;
  // no mutation, and responsibility disposal has already committed by this point.
  const records: B2Records = options.failFinalArchive ? {
    ...base.records,
    async commit(batch) {
      if (finalArchiveConflicts === 0 && batch.events.some(event => event.eventType === SESSION_ARCHIVED_EVENT)) {
        finalArchiveConflicts += 1;
        return { status: 'rejected', code: 'revision_conflict', reason: 'the injected final archive conflict', current: [] };
      }
      return base.records.commit(batch);
    },
  } : base.records;
  const now = options.now;
  const prefix = options.configuration.consumerId;
  let sequence = 0;
  const eventId = () => `${prefix}-${++sequence}`;
  const reads = createRunStateReader({ records, bodies: b2.bodies });
  const roles = createRoleConfigurationService({ records, now, eventId });
  const authority = createMaterialRecordReaders(records).authority;
  const materials = createMaterialService({ bodies: b2.bodies, authority, now });
  const messages = createSessionMailbox({ records, sessions: base.sessionsPort, executions: reads, roles, materials,
    systemActor: { kind: 'system', id: prefix }, now, newId: eventId });
  const controls = createRunControlService({ records, authority, reads, now, eventId });
  const workspaceHost = {
    async resolveRoot(scope: WorkspaceScope) {
      if (scope.projectId !== base.scope.projectId || scope.workspaceId !== base.scope.workspaceId) {
        return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'unknown fixture workspace' };
      }
      return { status: 'ready' as const, value: { root: base.directory, workspaceRevision: 1 } };
    },
    async authorize(ctx: CoreCallContext, scope: WorkspaceScope) {
      if (scope.projectId !== ctx.projectId || scope.workspaceId !== ctx.workspaceId) {
        return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'unknown fixture scope' };
      }
      return { status: 'ready' as const, value: { subjectKey: `${prefix}:host`, permissionRevision: prefix,
        allowsRead: () => true } };
    },
  };
  const requeue = createTaskRequeueService({ records, reads, workspaceHost,
    source: { captureDigest: async () => ({ status: 'ready', sourceDigest: sha256Hex('unchanged FX3 workspace') }) },
    materials, messages, now, eventId });
  const claims = { ...base.service, ...requeue };
  const kernelStores = await createKernelStoreRegistry({ entries: [{ adapterId: 'r4c-claim-kernel',
    storeKey: 'r4c-claim-kernel-store', workspace: base.scope, databasePath: join(base.directory, 'kernel.sqlite') }] });
  const sessionOperations = createSessionOperations({ sessions: base.sessionsPort, kernelStores });
  const activity = createExecutionHistoryReader({ history: sessionOperations });
  const scripted = createScriptedModel([{ kind: 'text', text: 'WP1 fixtures stop before model execution' }]);
  const runtime = createAgentRuntime({ claims, executions: reads, entry: b2.entry, modelRequests: b2.model,
    roles, plans: base.plans, messages, sessions: base.sessionsPort, materials, bodies: b2.bodies,
    historyWriter: createExecutionHistoryService({ records, now, eventId }), activity,
    graphHistory: createGraphExecutionHistoryReader({ executions: reads, history: activity }),
    sessionOperations, kernelStores, workspaceHost,
    sourceAuthority: () => createSourceAuthorityReader({ authority }),
    host: createRuntimeHostDouble({ runRefs: new Set<string>(), scripted,
      root: base.directory, skillRoot: join(base.directory, 'skills'), scope: base.scope, role: ROLE_Y }),
    kernel: kernelApi, controls, now, newId: eventId,
  });
  const sessionFacts = createSessionFactsService({ records });
  const responsibilities = createSessionResponsibilityService({ records, lookups: records,
    basis: createSessionResponsibilityBasisReader(records), now });
  const sessionLifecycle = createSessionLifecycleService({ records, lookups: records, sessionFacts });
  const sessionAnomalies = createSessionAnomalyService({ records, lookups: records, sessionFacts, now });
  const forbiddenCheck = async () => { throw new Error('WP1 given must not start a check'); };
  const deps: WorkflowDependencies = {
    tasks: base.goals, plans: base.plans, sessions: base.sessionsPort, claims, executions: reads,
    runtime: { ...runtime.port, createSession: sessionOperations.createSession,
      readSessionHistory: sessionOperations.readSessionHistory },
    evidence: { openVerification: forbiddenCheck, readVerification: forbiddenCheck, beginCheck: forbiddenCheck,
      recordCheckResult: forbiddenCheck, finalizeChecks: forbiddenCheck },
    checks: { runRegisteredCheck: forbiddenCheck }, sourceAuthority: createSourceAuthorityReader({ authority }),
    configuration: options.configuration, sessionLifecycle, sessionFacts, sessionAnomalies, controls,
    ...(options.responsibilities === false ? {} : { responsibilities }),
    archivePolicy: DEFAULT_SESSION_ARCHIVE_POLICY, now, messages,
    records: { async eventAt(cursor) {
      const at = await records.eventAt(cursor);
      return at.status === 'ready'
        ? { status: 'ready' as const, value: { cursor: at.value.cursor, event: at.value.event } }
        : { status: 'rejected' as const, code: 'unavailable' as const, reason: at.reason };
    } },
    sessionDuty: options.sessionDuty ?? (async role => ({ status: 'ready', value:
      role.kind === 'legacy_template' && role.templateId === 'builder' ? 'executor' : 'unknown' })),
  };
  const workflow = createWorkflow(deps);
  const { archiveLine, continueArchiveLine, maintainSessions } = workflow;
  if (archiveLine === undefined || continueArchiveLine === undefined || maintainSessions === undefined) {
    throw new Error('the real Workflow must publish its existing archive/maintenance entries');
  }
  return { workflow: { ...workflow, archiveLine, continueArchiveLine, maintainSessions }, ctx: base.ctx, configuration: options.configuration,
    deps, records, claims, reads, sessionFacts, sessionLifecycle, sessionAnomalies, responsibilities,
    sessionOperations, finalArchiveConflicts: () => finalArchiveConflicts };
}
export type HandoverComposition = Awaited<ReturnType<typeof createHandoverWorkflow>>;

function configuration(b2: B2ExecutionFixture, second = false): WorkflowHostConfiguration {
  return { consumerId: second ? 'wp1-config-2' : 'wp1-config-1', bindings: [{ workspace: b2.base.scope,
    sessionRole: second ? ROLE_X : ROLE_Y,
    // Same assignment role (templateId builder); a new revision of its Session role.
    roleBinding: second ? { ...b2.base.roleBinding, templateRevision: '2', bindingVersion: 2 }
      : b2.base.roleBinding, budget: b2.base.budget }] };
}

async function createBase() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(T0));
  let at: string = T0;
  const now = () => at;
  const b2 = await createB2ExecutionFixture('memory', SCHEMAS, now);
  const base = b2.base;
  const composition1 = await createHandoverWorkflow(b2, { now, configuration: configuration(b2) });
  const P = b2.claim.sessionRef;
  const T = b2.claim.task;
  const target: WorkLinkTarget = { kind: 'task', ref: T };
  const moduleTarget: WorkLinkTarget = { kind: 'module', ref: { projectId: base.scope.projectId, moduleId: 'fx3-work' } };
  let requestSequence = 0;
  const requestId = (label: string) => `wp1-given-${label}-${++requestSequence}`;
  const advanceBase: WorkflowAdvanceBase = { schemaVersion: 1, goalRef: base.goalRef,
    flowId: 'wp1-handover', sessionHint: P, taskId: T.taskId };
  const selectInput: WorkflowAdvanceInput = { ...advanceBase, kind: 'select_work' };

  async function session(ref: SessionRef = P): Promise<SessionCard> {
    return ready(await base.sessionsPort.readSession(base.ctx, ref));
  }
  async function link(ref: SessionRef, to: WorkLinkTarget = target,
    relation: WorkLinkRelation = 'responsible'): Promise<SessionWorkLink | null> {
    const linkRef: SessionWorkLinkRef = { ...ref, aggregateType: 'SessionWorkLink', target: to, relation };
    const read = await base.records.readMany([sessionWorkLinkRefKey(linkRef)]);
    if (read.status !== 'ready') throw new Error(`WP1 link read: ${JSON.stringify(read)}`);
    const record = read.value.records[0];
    if (record === undefined) return null;
    const decoded = decodeSessionWorkLink(record);
    if (decoded.status !== 'decoded') throw new Error(decoded.reason);
    return decoded.value;
  }
  async function linkPin(ref: SessionRef, to: WorkLinkTarget = target,
    relation: WorkLinkRelation = 'responsible'): Promise<VersionPin> {
    const found = await link(ref, to, relation);
    return { ref: found?.ref ?? { ...ref, aggregateType: 'SessionWorkLink', target: to, relation },
      revision: found?.revision ?? 0 };
  }
  async function transferPins(from: SessionRef, to: SessionRef, linkedTarget: WorkLinkTarget = target): Promise<VersionPin[]> {
    return [await base.sessionPin(from), await base.sessionPin(to),
      await linkPin(from, linkedTarget), await linkPin(to, linkedTarget)];
  }
  async function addLink(ref: SessionRef, to: WorkLinkTarget, relation: WorkLinkRelation = 'responsible') {
    // session-lifecycle.ts:494-581/589-632: target exists, Session+link pins, public machine.
    return committed(await composition1.sessionLifecycle.linkSessionWork(base.ctx, {
      input: { sessionRef: ref, target: to, relation, active: true },
      meta: { requestId: requestId('link'), expected: [await base.sessionPin(ref), await linkPin(ref, to, relation)] },
    }));
  }
  async function transfer(from: SessionRef, to: SessionRef, linkedTarget: WorkLinkTarget = target) {
    // responsibility-service.ts:359-548: four fresh pins; plan-readers.ts:1749
    // proves THIS target's writer stopped, even if another Task occupies P.
    return committed(await composition1.responsibilities.transferSessionResponsibility(base.ctx, {
      input: { from, to, target: linkedTarget },
      meta: { requestId: requestId('transfer'), expected: await transferPins(from, to, linkedTarget) },
    }));
  }
  async function requeue(claim: TaskClaim = b2.claim): Promise<TaskRequeueSnapshotV1> {
    const goalRef = { aggregateType: 'Goal' as const, projectId: claim.task.projectId, goalId: claim.task.goalId };
    const goal = ready(await base.plans.queryGoal(base.ctx, goalRef)).goal;
    // requeue-service.ts:751-886: human Host, ended known Run, released holder,
    // exact Goal+afterRun pins. FC-9 accepts observed/attested crashed Runs.
    const result = committed(await composition1.claims.requeueTask(base.ctx, {
      input: { taskRef: claim.task, afterRunRef: claim.runRef, reason: 'Person requests another attempt', newInputRefs: [] },
      meta: { requestId: requestId('requeue'), expected: [{ ref: goalRef, revision: goal.revision }, await b2.pin(claim)] },
    }));
    if (result.kind !== 'requeued') throw new Error(`WP1 setup requeue refused: ${JSON.stringify(result)}`);
    return result.requeue;
  }
  async function archive(ref: SessionRef, tasks: Parameters<typeof composition1.workflow.archiveLine>[1]['input']['tasks'] = []) {
    const result = ready(await composition1.workflow.archiveLine(base.ctx, {
      input: { sessionRef: ref, reason: 'WP1 operator archive', tasks, wait: null },
      meta: { requestId: requestId('archive'), expected: [await base.sessionPin(ref)] },
    }));
    if (result.state !== 'archived') throw new Error(`WP1 setup archive incomplete: ${JSON.stringify(result)}`);
    return result;
  }
  // The B2 base creates an unrelated idle builder plus a reserved second claim.
  // Archive the idle builder by the real operator composition. The reserved
  // Session stays occupied, so neither can be an alternative reusable Session.
  // claim-service.ts:claimTask has no SessionWorkLink writer. S1-archive-flow
  // explicitly opens this relation too; do not assume the claim created it.
  await addLink(P, target);
  await archive(base.sessions.second);

  const observations = {
    session, link, linkPin, transferPins,
    async openResponsible(ref: SessionRef, to: WorkLinkTarget = target) {
      const found = await link(ref, to);
      return found?.until === null ? found : null;
    },
    async facts(ref: SessionRef = P) { return ready(await composition1.sessionFacts.readSessionFacts(base.ctx, ref)); },
    async sessions() { return ready(await base.sessionsPort.findSessions(base.ctx,
      { workspace: base.scope, includeArchived: true, page: { limit: 100 } })); },
    async task(task: TaskTriple = T) {
      const graph = ready(await base.plans.queryTaskGraph(base.ctx,
        { goalRef: { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId } }));
      const row = graph.tasks.find(candidate => sameTask(candidate.ref, task));
      if (row === undefined) throw new Error('WP1 given Task not in the graph');
      return row;
    },
    async requeues(task: TaskTriple = T) { return (await base.audit.world()).requeues.filter(item => sameTask(item.task, task)); },
    async anchors() { return (await base.audit.world()).anchors?.filter(item => item.task.goalId === T.goalId) ?? []; },
    archiveRequests(ref: SessionRef = P) {
      return base.audit.events().flatMap(({ cursor, event }) => {
        if (event.eventType !== SESSION_ARCHIVE_REQUESTED_EVENT) return [];
        const decoded = sessionArchiveChangedEventFromEvent(event);
        if (decoded.status !== 'decoded') throw new Error(decoded.reason);
        if (!sameSession(decoded.value.session.ref, ref)) return [];
        const request = decoded.value.session.archiveRequest;
        if (request == null) throw new Error('WP1 archive event has no request');
        return [{ cursor, mode: request.mode, requestId: request.requestId, event: decoded.value }];
      });
    },
    totals: () => base.audit.totals(), events: () => base.audit.events(),
  };
  return { b2, base, P, T, run: b2.claim.runRef, target, moduleTarget, ctx: base.ctx,
    scope: base.scope, goalRef: base.goalRef, advanceBase, selectInput, composition1,
    workflow1: composition1.workflow, observations, addLink, transfer, requeue, archive, requestId, now,
    maintenanceInput: { workspace: base.scope, after: null },
    setClock(value: typeof T0 | typeof T1) { at = value; vi.setSystemTime(new Date(value)); },
    async close() { try { await b2.close(); } finally { vi.useRealTimers(); } },
  };
}
type HandoverBase = Awaited<ReturnType<typeof createBase>>;

async function observedCrash(f: HandoverBase, claim: TaskClaim = f.b2.claim): Promise<void> {
  // Same legal terminal observation as S1-session-facts-fixture.ts:285-305.
  // A Kernel terminal advances history, restores availability and releases
  // occupancy; it does not mark the Task formally terminal (maintenance:249).
  const admitted = await f.b2.enter({ prepared: await f.b2.buildPrepared({ claim }) });
  const kernel = await f.b2.kernelFor(claim);
  committed(await f.b2.entry.recordRunResult(f.ctx, {
    input: { claim, entry: { consumerId: admitted.permit.consumerId, entryGeneration: admitted.permit.entryGeneration },
      event: f.b2.terminalEvent({ runRef: claim.runRef, eventId: f.requestId('terminal'),
        eventType: 'run_crashed', payload: { kind: 'crashed', error: 'ordinary tool failure' } }),
      kernelSource: { ...kernel, position: 4 },
      completedHistoryBoundary: { source: { ...kernel, position: 4 }, cursor: `wp1-terminal-${claim.runRef.runId}` },
      history: { kernel, startPosition: 2, observedThroughPosition: 4, endPosition: 4 } },
    meta: { requestId: f.requestId('result'), expected: [await f.b2.pin(claim)] },
  }));
}

async function attestedStop(f: HandoverBase): Promise<void> {
  await f.b2.enter();
  await unknownWork(f.b2, f.now);
  const reconcile = createRunReconcileService({ records: f.base.records,
    reads: f.composition1.reads, hostInstance: { hostInstanceId: 'fx3-host', lease: 'owned' },
    now: f.now, eventId: () => f.requestId('attestation-event') });
  // run-reconcile-service.ts:512-548; same inputs as S1 archive IT26:596.
  // The human Host owns the instance lease; unknown_attested != interrupted_clean.
  committed(await reconcile.resolveUnknownRun(f.ctx, {
    input: { runRef: f.run, reason: 'Person confirms the old writer has stopped', kernelTurnOpen: true, inputsConfirmed: null,
      review: { inventory: 'incomplete', inventoryProblem: 'kernel_unreadable', items: [], itemsOmitted: 0,
        workspace: { status: 'unavailable', runBaselineKnown: false, reason: 'not_configured', detail: 'WP1' } } },
    meta: { requestId: f.requestId('attest'), expected: [await f.b2.pin()] },
  }));
}

/**
 * K3 L21/L11: the attested record is `needs_decision`; the human resolves it
 * through the same two owner calls the Host routes use (direct "I'll handle it"
 * and "continue") before the human requeue, so the later continuation passes
 * the review gate with `hold: 'released'` and no confirmation card.
 */
async function holdAndReleaseAttested(f: HandoverBase): Promise<void> {
  const reads = createRunStateReader({ records: f.base.records });
  let sequence = 0;
  const reviews = createUnknownCallReviewService({
    records: f.base.records,
    reads,
    readReviewDisplays: async () => ({ status: 'ready', value: new Map() }),
    taskProjection: async (_ctx, task) => {
      const goalRef: GoalRef = { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId };
      const window = await readGoalPlanWindow(f.base.records, goalRef);
      if (window.status !== 'ready') return window;
      if (window.plan === null) {
        return { status: 'rejected', code: 'not_found', reason: 'the Goal has no active Plan' };
      }
      return readCanonicalTaskFacts(f.base.records, goalRef, window.plan, task.taskId);
    },
    now: f.now, eventId: () => `${f.requestId('review-event')}-${String(++sequence)}`,
  });
  const read = await reviews.readReview(f.ctx, { runRef: f.run });
  if (read.status !== 'ready') throw new Error(`WP1 review read failed: ${JSON.stringify(read)}`);
  const expected = [{ ref: read.value.ref, revision: read.value.revision }];
  const held = await reviews.holdReview(f.ctx, { input: { reviewRef: read.value.ref, text: null },
    meta: { requestId: f.requestId('review-hold'), expected } });
  if (held.status !== 'committed') throw new Error(`WP1 review hold failed: ${JSON.stringify(held)}`);
  const released = await reviews.releaseHold(f.ctx, { input: { reviewRef: read.value.ref },
    meta: { requestId: f.requestId('review-release'), expected: [{ ref: read.value.ref, revision: held.value.revision }] } });
  if (released.status !== 'committed' || released.value.disposition?.hold !== 'released') {
    throw new Error(`WP1 review release failed: ${JSON.stringify(released)}`);
  }
}

export async function createInterruptedHandoverFixture(options: { responsibilities?: boolean } = {}) {
  const f = await createBase();
  try {
    await attestedStop(f);
    await holdAndReleaseAttested(f);
    const requeue = await f.requeue();
    const composition = options.responsibilities === false
      ? await createHandoverWorkflow(f.b2, { now: f.now,
        configuration: { ...configuration(f.b2), consumerId: 'wp1-no-responsibilities' }, responsibilities: false })
      : f.composition1;
    return { ...f, composition, workflow: composition.workflow, requeueRecord: requeue, requeueRef: requeue.ref };
  } catch (error) { await f.close(); throw error; }
}

async function claimOtherTask(f: HandoverBase): Promise<TaskClaim> {
  // Same Goal/propose/apply/claim sequence as the B2 independent claim
  // (S1-workflow-archive-fixture.ts:562-609). A FRESH independent Task avoids
  // implement-b's output dependency and the requeue brief guard at entry
  // (execution-entry-service.ts:1242-1258); this Run has no requeueRef.
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: f.scope.projectId, goalId: 'wp1-other-goal' };
  committed(await f.base.goals.createGoal(f.ctx, {
    input: { goalId: goalRef.goalId, workspace: f.scope, objective: 'Independent unfinished responsibility T2' },
    meta: { requestId: f.requestId('other-goal'), expected: [
      { ref: f.base.projectRef, revision: 1 }, { ref: f.base.workspaceRef, revision: 1 }] },
  }));
  const draft: PlanRevisionDraft = { schemaVersion: 2, planId: 'wp1-other-plan', planRevision: 1,
    goalId: goalRef.goalId, stages: [],
    tasks: [
      { taskId: 'wp1-other-task', title: 'T2', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      { taskId: 'wp1-other-gate', title: 'T2 gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 'wp1-other-task', role: 'builder', instruction: 'Independent T2' }],
    obligations: [{ obligationId: 'wp1-other-obligation', title: 'T2 delivery', requirementLevel: 'required',
      taskIds: ['wp1-other-task', 'wp1-other-gate'], verificationRequirements: [
        { requirementId: 'wp1-other-check', requirementLevel: 'required', kind: 'test', description: 'T2 check' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
  };
  const proposed = committed(await f.base.plans.proposePlan(f.ctx, {
    input: { goalRef, basedOn: null, draft, reason: { text: 'Independent T2 fixture', sources: [] } },
    meta: { requestId: f.requestId('other-propose'), expected: [{ ref: goalRef, revision: 1 }] },
  }));
  if (proposed.issues.length !== 0) throw new Error(`WP1 T2 proposal issues: ${JSON.stringify(proposed.issues)}`);
  const plan = committed(await f.base.plans.applyPlanChange(f.ctx, {
    input: { proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [] },
    meta: { requestId: f.requestId('other-apply'), expected: [{ ref: goalRef, revision: 1 }] },
  }));
  const goal = ready(await f.base.plans.queryGoal(f.ctx, goalRef)).goal;
  const claim = committed(await f.composition1.claims.claimTask(f.ctx, {
    input: { goalRef, planRef: plan.ref, taskId: 'wp1-other-task', sessionRef: f.P,
      roleBinding: f.base.roleBinding, budget: f.base.budget },
    meta: { requestId: f.requestId('claim-t2'), expected: [{ ref: goalRef, revision: goal.revision },
      { ref: f.base.workspaceRef, revision: 1 }, await f.base.sessionPin(f.P)] },
  }));
  await f.addLink(f.P, { kind: 'task', ref: claim.task });
  return claim;
}

async function roleMismatch(other: 'none' | 'responsible' | 'occupied', failFinalArchive: boolean) {
  const f = await createBase();
  try {
    await observedCrash(f);
    const requeue = await f.requeue();
    let T2: TaskTriple | null = null;
    let otherClaim: TaskClaim | null = null;
    if (other !== 'none') {
      otherClaim = await claimOtherTask(f);
      T2 = otherClaim.task;
      if (other === 'responsible') await observedCrash(f, otherClaim);
      else await f.b2.enter({ prepared: await f.b2.buildPrepared({ claim: otherClaim }) });
    }
    const composition = await createHandoverWorkflow(f.b2, {
      now: f.now, configuration: configuration(f.b2, true), failFinalArchive,
    });
    return { ...f, composition, workflow: composition.workflow, requeueRecord: requeue, requeueRef: requeue.ref, T2, otherClaim };
  } catch (error) { await f.close(); throw error; }
}
export async function createRoleMismatchHandoverFixture(options: { failFinalArchive?: boolean } = {}) {
  return roleMismatch('none', options.failFinalArchive === true);
}
export async function createOtherResponsibilityFixture() { return roleMismatch('responsible', false); }
export async function createOccupiedPredecessorFixture() { return roleMismatch('occupied', false); }

export async function createReusablePredecessorFixture() {
  const f = await createBase();
  try {
    await observedCrash(f);
    const requeue = await f.requeue();
    return { ...f, composition: f.composition1, workflow: f.workflow1, requeueRecord: requeue, requeueRef: requeue.ref };
  } catch (error) { await f.close(); throw error; }
}

export async function createArchivedPredecessorFixture() {
  const f = await createReusablePredecessorFixture();
  try {
    // session-archive.ts:778-832/drive: execution none, unfinished T explicitly
    // dropped. The existing requeue remains claimable; no execution anchor.
    const archiveResult = await f.archive(f.P, [{ target: f.target, disposition: { kind: 'drop' } }]);
    return { ...f, archiveResult };
  } catch (error) { await f.close(); throw error; }
}

async function retiredContinuation(kind: 'handed_over' | 'responsible' | 'unknown' | 'module') {
  const f = await createBase();
  try {
    // HM04 establishes module responsibility before retirement, then transfers
    // T away; SES-15 (session-availability.ts:854) requires active lifecycle.
    if (kind === 'module') await f.addLink(f.P, f.moduleTarget);
    if (kind === 'unknown') {
      await f.b2.enter();
      await unknownWork(f.b2, f.now);
      await retireSession(f.base, f.P, f.now);
    } else {
      await attestedStop(f);
    }
    // SessionOperations performs admission -> Kernel create -> recordSessionCreated.
    // directory.ts:703-746/848 checks same-scope acyclic provenance; it does not
    // require the predecessor to be idle (HM03). No Workflow maintenance yet.
    const created = await f.composition1.sessionOperations.createSession(f.ctx, {
      workspace: f.scope, role: ROLE_Y, recommendedRefs: [],
      initialLinks: [{ target: f.target, relation: 'responsible' }],
      provenance: { schemaVersion: 1, kind: 'continuation', from: f.P, reason: 'interrupted', task: f.T },
      meta: { requestId: f.requestId('continuation'), expected: [] },
    });
    if (created.status !== 'completed') throw new Error(`WP1 continuation setup: ${JSON.stringify(created)}`);
    const C: SessionRef = { projectId: created.value.ref.projectId, sessionId: created.value.ref.sessionId };
    if (kind === 'handed_over' || kind === 'module') await f.transfer(f.P, C);
    f.setClock(T1);
    return { ...f, composition: f.composition1, workflow: f.workflow1, C, continuationReceipt: created, kind };
  } catch (error) { await f.close(); throw error; }
}
export async function createHandedOverRetiredFixture() { return retiredContinuation('handed_over'); }
export async function createStillResponsibleRetiredFixture() { return retiredContinuation('responsible'); }
export async function createUnknownOccupiedRetiredFixture() { return retiredContinuation('unknown'); }
export async function createModuleOnlyRetiredFixture() { return retiredContinuation('module'); }

/** HO08: invoke only after the test itself performed create_session. */
export async function bumpSessionRevision(f: HandoverBase, C: SessionRef): Promise<number> {
  await f.addLink(C, f.moduleTarget, 'participates');
  return (await f.observations.session(C)).record.revision;
}
