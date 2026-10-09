/**
 * Wiring 1 group CE; every domain write goes through an existing owner.
 *
 * Exported builders/actions (all support memory and SQLite):
 * - openGoalContentEntry(kind) [GE01-GE07]: S1 bootstrap/Plan/Session/claim,
 *   then real preparation -> real assembler -> real graph/input owners; UNBOUND.
 * - makeUnboundGoalPrepared(fixture, options) [GE02, GE03, GE06]: save a NEW
 *   hand-made manifest body for that unbound Run, changing only Goal.digest and
 *   optionally adding/replacing Workspace.revision. No record is overwritten.
 * - adoptUnrelatedPlan(fixture) [GE04]: propose/apply P2 = P1 + a plan_only Task.
 * - revokeUnentered(fixture, authorized) [GE05]: begin, omit Kernel entry,
 *   reconcile_not_entered (RUN-16); return the fixed prepared value and next write.
 * - openAnomalyReaderFixture(kind) [AN07]: enter Work, link responsibility,
 *   operator archive/drop -> queued cancel -> real reconcile stop -> continue
 *   archive (real anchor owner); claim a different existing Task in the SAME Goal.
 *   graphReader(extensions) injects only the future provider, never a graph double.
 *
 * t0/t1 are the spec clocks. The reused S1 helper fixes r4c-claim-project /
 * r4c-claim-workspace rather than p/w, and also creates an unused independent
 * second Goal; AN07 deliberately does NOT use its secondClaim as the reader.
 * Date-only fake timers cover existing owners without an injected clock (as in
 * S1-archive-flow); close() restores the caller's clock and removes the S1 temp
 * directory. Keep these fixtures non-concurrent within a test file.
 *
 * Guard audit at the frozen checkout:
 * S1-workflow-archive-fixture.ts:243-474 bootstraps through real writers;
 * :535-596 claims through the real owner; :702-739 authorize/begin/enter.
 * graph-context-reader.ts:690-721 needs EVIDENCE_RECORD_SCHEMAS even for no rounds;
 * :973-988 emits Goal/Plan/baseline/focus-Run sources (NO Workspace source).
 * execution-preparation.ts:145-259 validates the unbound claim/Role/Host/Plan;
 * context-assembler.ts:785-938 obtains real graph facts and builds the binding.
 * execution-entry-service.ts:1100-1157 checks shape, Workspace then declarations;
 * :1175-1202 skips Goal and the subject Run when making source guards;
 * :298-309 requires EXACTLY one Run pin; :1402-1426 includes it in the
 * fingerprint and replays before reading current facts. Cache it per requestId.
 * run-machine.ts:2041-2095 requires Entering, a ready probe and the BEGIN identity
 * for RUN-16; authorize alone is insufficient.
 * S1-archive-flow.test.ts:357-378 supplies the trusted RUN-23 observation used
 * here; session-archive.ts:365-399 queues the stop before returning pending,
 * :450-497 writes the anchor after the stop, :500-517 drops responsibility.
 * eligibility.ts:24-28/30-80 checks hard input dependencies at consumption, not
 * claim time; AN07 can claim existing implement-b before consuming A's output.
 * plan-machine.ts:1244-1253 requires GE04's newly added future Task untraced.
 */
import { vi } from 'vitest';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, SessionWorkLinkRef, VersionPin } from '../../src/contracts/core/identity.js';
import type { PreparedTaskExecution, PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RunSnapshot, TaskTriple } from '../../src/contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { ContextAssemblyBindingV1, ContextSourceV1 } from '../../src/contracts/graph-context.js';
import type { GoalRef, GoalSnapshot } from '../../src/contracts/ledger.js';
import { MANIFEST_CONTENT_TYPE } from '../../src/contracts/no-progress.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import type { SessionAnomalyAnchorV1, SessionAnomalyViewV1 } from '../../src/contracts/session-anomaly.js';
import { createContextAssembler } from '../../src/core/agent-runtime/context-assembler.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import { createExecutionPreparation, loadPreparedManifest, rehydratePreparedExecution } from '../../src/core/agent-runtime/execution-preparation.js';
import type { RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { ExecutionEntryPort, TaskEntryPermit } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { ContextReadRequestV1, GraphContextReadPort } from '../../src/core/work-graph/model/graph-context-contracts.js';
import type { SessionCard } from '../../src/core/work-graph/model/session-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { executionEntryAuthorizedEventFromEvent, type ExecutionEntryAuthorizedEvent } from '../../src/core/work-graph/persistence/execution-entry-codecs.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { SESSION_MESSAGE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { createSessionLifecycleService } from '../../src/core/work-graph/sessions/session-lifecycle.js';
import { createTaskContextInputService } from '../../src/core/work-graph/tasks/context-input-service.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { SESSION_ANOMALY_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import { createSessionAnomalyService } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import { createSessionFactsService } from '../../src/core/work-graph/tasks/session-facts.js';
import { createGraphContextReader, type GraphContextReaderDependencies } from '../../src/core/work-graph/views/graph-context-reader.js';
import { createRuntimeHostDouble, createScriptedModel } from './B2-runtime-fixture.js';
import { B2_HOST, createB2ExecutionFixture, workflowForFixture,
  type B2ExecutionFixture, type ClaimFixtureKind, type TaskClaimFixture } from './S1-workflow-archive-fixture.js';

export const t0 = '2026-10-08T00:00:00.000Z';
export const t1 = '2026-10-09T00:00:00.000Z';
const now = () => t0;
const CONSUMER = 'runtime-a';
const hostActor: GraphContextReaderDependencies['hostActor'] = { kind: 'system', id: 'wp1-ce-context-host' };

function ready<T>(result: ReadResult<T>, step: string): T {
  if (result.status !== 'ready') throw new Error(`${step}: ${JSON.stringify(result)}`);
  return result.value;
}

function committed<T>(result: WriteResult<T>, step: string): Extract<WriteResult<T>, { status: 'committed' }> {
  if (result.status !== 'committed') throw new Error(`${step}: ${JSON.stringify(result)}`);
  return result;
}

// The same canonical-JSON cast as S1-session-facts-fixture.ts:key; all callers
// supply contract DTOs. This is not a cast between unrelated fixture shapes.
function key(value: object): string { return canonicalJson(value as JsonValue); }

function schemas(groups: readonly RecordBackendSchemas[]): RecordBackendSchemas {
  return { records: groups.flatMap(group => group.records), events: groups.flatMap(group => group.events),
    lookups: groups.flatMap(group => group.lookups ?? []) };
}

function fixedDate(): () => void {
  const wasFake = vi.isFakeTimers();
  const previous = vi.getMockedSystemTime();
  if (!wasFake) vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(t0));
  return () => {
    if (!wasFake) vi.useRealTimers();
    else if (previous !== null) vi.setSystemTime(previous);
  };
}

function graphOwners(b2: B2ExecutionFixture) {
  const { base, bodies } = b2;
  const executions = createRunStateReader({ records: base.records, bodies });
  const materials = createMaterialService({ bodies, authority: createMaterialRecordReaders(base.records).authority, now });
  const inputs = createTaskContextInputService({ records: base.records, materials, bodies, hostActor });
  const architecture = createArchitectureCatalogService({ records: base.records });
  function graphReader(extensions: GraphContextReaderDependencies['extensions']): GraphContextReadPort {
    return createGraphContextReader({ records: base.records, goals: base.plans, plans: base.plans,
      architecture, sessions: base.sessionsPort, executions, inputs, hostActor,
      ...(extensions === undefined ? {} : { extensions }) });
  }
  return { executions, materials, inputs, graphReader };
}

export type GoalPrepared = {
  prepared: PreparedTaskExecution;
  manifest: PreparedTaskManifestV1;
  binding: ContextAssemblyBindingV1;
};
export type EntryAuthorization = Awaited<ReturnType<ExecutionEntryPort['authorizeRuntimeEntry']>>;
export type CommittedEntryAuthorization = Extract<EntryAuthorization, { status: 'committed' }>;
export type GoalBindingOptions = { goalDigest: string | null; workspaceRevision?: number };
export type GoalContentEntryFixture = GoalPrepared & {
  base: TaskClaimFixture;
  b2: B2ExecutionFixture;
  ctx: CoreCallContext;
  claim: TaskClaim;
  goal: GoalSnapshot;
  entry: ExecutionEntryPort;
  graph: GraphContextReadPort;
  preparation: ReturnType<typeof createExecutionPreparation>;
  /** Pins are read once per requestId, so GE07 replays the exact original write. */
  authorize(prepared: PreparedTaskExecution, requestId: string, expected?: readonly VersionPin[]): Promise<EntryAuthorization>;
  readGoal(): Promise<GoalSnapshot>;
  readRun(): Promise<RunSnapshot>;
  runPin(): Promise<VersionPin>;
  readManifest(prepared?: PreparedTaskExecution): Promise<GoalPrepared>;
  authorizedEvents(): ExecutionEntryAuthorizedEvent[];
  activePlanRefs(): Array<PlanRevisionRef | undefined>;
  entryGeneration(): Promise<number | null>;
  modelCalls(): number;
  close(): Promise<void>;
};

/** GE01-GE07: no entry action is performed here. */
export async function openGoalContentEntry(kind: ClaimFixtureKind): Promise<GoalContentEntryFixture> {
  const restoreDate = fixedDate();
  let b2: B2ExecutionFixture | undefined;
  try {
    b2 = await createB2ExecutionFixture(kind, schemas([EVIDENCE_RECORD_SCHEMAS, CONTROL_RECORD_SCHEMAS]), now);
    const execution = b2;
    const { base, ctx, claim, entry, bodies } = execution;
    const owners = graphOwners(execution);
    const graph = owners.graphReader(undefined);
    const scripted = createScriptedModel([]); // Preparation must never stream a reply.
    const hostDouble = createRuntimeHostDouble({ runRefs: new Set([key(claim.runRef)]), scripted,
      root: base.directory, skillRoot: join(base.directory, 'skills'), scope: base.scope,
      role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' } });
    // Match the SAME trusted grant that B2's entry owner verifies. Only Host
    // configuration is a double; the Role/graph/input/preparation ports are real.
    const host: RuntimeHostBindings = {
      async resolveConfiguration(callCtx, input) {
        const configured = await hostDouble.resolveConfiguration(callCtx, input);
        if (configured.status !== 'ready') return configured;
        return { status: 'ready', value: { ...configured.value,
          configurationRevision: B2_HOST.configurationRevision, hostTemplate: structuredClone(B2_HOST.hostTemplate),
          skills: { resourceRoot: join(base.directory, 'skills'), enabledIds: [] } } };
      },
    };
    let sequence = 0;
    // TaskClaimFixture.roleService exposes only the public RoleConfigurationPort;
    // prepare needs the factory's internal RoleBindingFactsPort as well.
    const roles = createRoleConfigurationService({ records: base.records, now,
      eventId: () => `wp1-ce-role-${++sequence}` });
    const assembler = createContextAssembler({ executions: owners.executions, roles,
      materials: owners.materials, bodies, plans: base.plans, sessions: base.sessionsPort,
      graphContext: graph, taskInputs: owners.inputs });
    const preparation = createExecutionPreparation({ executions: owners.executions, roles,
      bodies, host, graphContext: graph, taskInputs: owners.inputs, now,
      newId: () => `wp1-ce-prepare-${++sequence}` }, assembler);
    const prepared = ready(await preparation.prepare(ctx, { runRef: claim.runRef, requestId: 'wp1-ce-prepare' }), 'real preparation');
    async function readManifest(target: PreparedTaskExecution = prepared): Promise<GoalPrepared> {
      const { manifest } = ready(await loadPreparedManifest(bodies, target), 'manifest read');
      const binding = manifest.contextAssembly;
      if (manifest.kind !== 'task_execution' || binding === undefined) throw new Error('prepared context binding is absent');
      return { prepared: target, manifest, binding };
    }
    async function readGoal(): Promise<GoalSnapshot> {
      return ready(await base.plans.queryGoal(ctx, base.goalRef), 'Goal owner read').goal;
    }
    function authorizedEvents(): ExecutionEntryAuthorizedEvent[] {
      return base.audit.events().flatMap(({ event }) => {
        if (event.eventType !== 'ExecutionEntryAuthorized') return [];
        const decoded = executionEntryAuthorizedEventFromEvent(event);
        if (decoded.status !== 'decoded') throw new Error(`authorization audit: ${decoded.reason}`);
        return key(decoded.value.permit.claim.runRef) === key(claim.runRef) ? [decoded.value] : [];
      });
    }
    const authorizationPins = new Map<string, readonly VersionPin[]>();
    let closed = false;
    return { ...await readManifest(), base, b2: execution, ctx, claim, entry, graph, preparation,
      goal: await readGoal(), readGoal, readManifest,
      async authorize(target, requestId, expected) {
        const pins = expected ?? authorizationPins.get(requestId) ?? [await execution.pin(target.claim)];
        authorizationPins.set(requestId, structuredClone(pins));
        return entry.authorizeRuntimeEntry(ctx, {
          input: { prepared: target, consumerId: CONSUMER }, meta: { requestId, expected: pins } });
      },
      readRun: async () => (await execution.read()).run,
      runPin: () => execution.pin(), authorizedEvents,
      activePlanRefs: () => authorizedEvents().map(event => event.activePlanRef),
      async entryGeneration() {
        const authorization = (await execution.read()).run.executionAuthorization;
        return authorization !== undefined && 'generation' in authorization ? authorization.generation : null;
      },
      modelCalls: () => scripted.calls(),
      async close() {
        if (closed) return;
        closed = true;
        try { await execution.close(); } finally { restoreDate(); }
      },
    };
  } catch (error) {
    try { await b2?.close(); } finally { restoreDate(); }
    throw error;
  }
}

/** GE02/GE03/GE06: only this unbound manifest is hand-made; never a Goal write. */
export async function makeUnboundGoalPrepared(fixture: GoalContentEntryFixture, options: GoalBindingOptions): Promise<GoalPrepared> {
  const run = await fixture.readRun();
  if (run.status !== 'starting' || run.inputBinding !== undefined || run.executionAuthorization !== undefined) {
    throw new Error('hand-made context is allowed only on an UNBOUND Run');
  }
  const manifest = structuredClone(fixture.manifest);
  const binding = structuredClone(fixture.binding);
  let foundGoal = false;
  const sources = binding.sources.flatMap<ContextSourceV1>(source => {
    if (source.kind === 'record' && key(source.ref) === key(fixture.goal.ref)) {
      foundGoal = true;
      return [{ ...source, digest: options.goalDigest }];
    }
    if (options.workspaceRevision !== undefined && source.kind === 'record'
      && key(source.ref) === key(fixture.goal.workspaceRef)) return [];
    return [source];
  });
  if (!foundGoal) throw new Error('real graph preparation omitted the claim Goal source');
  // The real graph's baseSources currently does not emit Workspace; GE06 must
  // ADD this source, not silently map over a nonexistent one (:973-988).
  if (options.workspaceRevision !== undefined) sources.push({ kind: 'record', ref: fixture.goal.workspaceRef,
    revision: options.workspaceRevision, digest: null });
  binding.sources = sources.sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  manifest.contextAssembly = binding;
  const stored = await fixture.b2.bodies.put({ body: JSON.stringify(manifest), contentType: MANIFEST_CONTENT_TYPE,
    sourceRefs: manifest.sourceRefs, origin: { kind: 'run', owner: fixture.claim.runRef }, requestedAt: t0 });
  if (stored.status !== 'ready') throw new Error(`hand-made manifest storage: ${JSON.stringify(stored)}`);
  const prepared: PreparedTaskExecution = { ...structuredClone(fixture.prepared),
    envelope: { ...structuredClone(fixture.prepared.envelope), bundleRef: stored.value.ref },
    inputBinding: { ...structuredClone(fixture.prepared.inputBinding), manifestDigest: stored.value.ref.digest } };
  return { prepared, manifest, binding };
}

async function adoptAddedTask(base: TaskClaimFixture, task: RuntimeTask, planId: string): Promise<PlanRevisionSnapshot> {
  const graph = ready(await base.plans.queryTaskGraph(base.ctx, { goalRef: base.goalRef }), 'source Plan read');
  const plan = graph.plan;
  const goalPin = await base.goalPin();
  // Exact C6 host-adoption draft copy; never copy compiler-owned taskStateBasis.
  const draft: PlanRevisionDraft = { schemaVersion: 2, planId, planRevision: plan.planRevision + 1,
    goalId: base.goalRef.goalId, stages: structuredClone(plan.stages), tasks: [...structuredClone(plan.tasks), task],
    assignments: structuredClone(plan.assignments ?? []),
    obligations: structuredClone(plan.obligations), taskHierarchy: structuredClone(plan.taskHierarchy),
    executionDag: structuredClone(plan.executionDag),
    taskRelations: plan.schemaVersion === 2 ? structuredClone(plan.taskRelations ?? []) : [],
    inputRequirements: plan.schemaVersion === 2 ? structuredClone(plan.inputRequirements ?? []) : [] };
  const proposed = committed(await base.plans.proposePlan(base.ctx, {
    input: { goalRef: base.goalRef, basedOn: plan.ref, draft, reason: { text: 'Add an unrelated Task', sources: [] } },
    meta: { requestId: `${planId}-propose`, expected: [goalPin] } }), 'unrelated Plan proposal');
  if (proposed.value.issues.length !== 0) throw new Error(`unrelated Plan issues: ${JSON.stringify(proposed.value.issues)}`);
  return committed(await base.plans.applyPlanChange(base.ctx, {
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
    meta: { requestId: `${planId}-apply`, expected: [goalPin] } }), 'unrelated Plan adoption').value;
}

/** GE04: only the unrelated future Task is added; the prepared Run stays on P1. */
export async function adoptUnrelatedPlan(fixture: GoalContentEntryFixture): Promise<PlanRevisionRef> {
  return (await adoptAddedTask(fixture.base, { taskId: 'wp1-ce-future', title: 'Unrelated future intent',
    requirementLevel: 'optional', taskKind: 'work', disposition: 'active', phase: 'pending',
    scope: { kind: 'goal' }, executionIntent: 'plan_only' }, 'wp1-ce-p2')).ref;
}

export type RevokedGoalEntry = {
  prepared: PreparedTaskExecution;
  run: RunSnapshot;
  runPin: VersionPin;
  request: GraphWrite<{ prepared: PreparedTaskExecution; consumerId: string }>;
};

/** GE05: begin is essential; no Kernel Turn is started, so RUN-16 can revoke it. */
export async function revokeUnentered(fixture: GoalContentEntryFixture, authorized: CommittedEntryAuthorization): Promise<RevokedGoalEntry> {
  const permit: TaskEntryPermit = authorized.value;
  const kernel = await fixture.b2.kernelFor(fixture.claim);
  committed(await fixture.entry.beginRuntimeEntry(fixture.ctx, {
    input: { permit, kernel }, meta: { requestId: 'wp1-ce-ge05-begin', expected: [await fixture.runPin()] },
  }), 'GE05 begin (stop before entering)');
  const reconcile = createRunReconcileService({ records: fixture.base.records,
    reads: createRunStateReader({ records: fixture.base.records, bodies: fixture.b2.bodies }),
    hostInstance: { hostInstanceId: 'wp1-ce-host', lease: 'owned' }, now, eventId: () => 'wp1-ce-ge05-reconciled' });
  const revoked = committed(await reconcile.reconcileRun(fixture.ctx, {
    input: { runRef: fixture.claim.runRef, basis: { kind: 'host_instance_takeover', hostInstanceId: 'wp1-ce-host' },
      probe: 'ready', result: { kind: 'not_entered', kernel } },
    meta: { requestId: 'wp1-ce-ge05-revoke', expected: [await fixture.runPin()] },
  }), 'GE05 real RUN-16');
  const prepared = rehydratePreparedExecution(await fixture.b2.read());
  if (prepared === null) throw new Error('RUN-16 lost the saved prepared execution');
  const runPin = await fixture.runPin();
  return { prepared, run: revoked.value, runPin,
    request: { input: { prepared, consumerId: permit.consumerId },
      meta: { requestId: 'wp1-ce-ge05-reauthorize', expected: [runPin] } } };
}

export type AnomalyReaderFixture = {
  base: TaskClaimFixture;
  b2: B2ExecutionFixture;
  anomalies: ReturnType<typeof createSessionAnomalyService>;
  hostActor: GraphContextReaderDependencies['hostActor'];
  graphReader(extensions: GraphContextReaderDependencies['extensions']): GraphContextReadPort;
  ctx: CoreCallContext;
  hostCtx: CoreCallContext;
  workCtx: CoreCallContext;
  goalRef: GoalRef;
  anchor: SessionAnomalyAnchorV1;
  anchorTask: TaskTriple;
  readerClaim: TaskClaim;
  request: ContextReadRequestV1;
  workflow: Awaited<ReturnType<typeof workflowForFixture>>;
  listAnchors(): Promise<SessionAnomalyViewV1[]>;
  readSession(ref?: SessionRef): Promise<SessionCard>;
  close(): Promise<void>;
};

/** AN07: the new provider is supplied later; this builder never calls it. */
export async function openAnomalyReaderFixture(kind: ClaimFixtureKind): Promise<AnomalyReaderFixture> {
  const restoreDate = fixedDate();
  let b2: B2ExecutionFixture | undefined;
  try {
    b2 = await createB2ExecutionFixture(kind, schemas([EVIDENCE_RECORD_SCHEMAS, CONTROL_RECORD_SCHEMAS,
      SESSION_LIFECYCLE_RECORD_SCHEMAS, SESSION_ANOMALY_RECORD_SCHEMAS,
      SESSION_MESSAGE_RECORD_SCHEMAS, QUERY_JOB_RECORD_SCHEMAS]), now);
    const execution = b2;
    const { base, ctx, claim } = execution;
    const sessionFacts = createSessionFactsService({ records: base.records });
    const anomalies = createSessionAnomalyService({ records: base.records, lookups: base.records, sessionFacts, now });
    const lifecycle = createSessionLifecycleService({ records: base.records, lookups: base.records, sessionFacts });
    await execution.enter();
    const target = { kind: 'task' as const, ref: claim.task };
    const linkRef: SessionWorkLinkRef = { ...claim.sessionRef, aggregateType: 'SessionWorkLink', target, relation: 'responsible' };
    committed(await lifecycle.linkSessionWork(ctx, { input: { sessionRef: claim.sessionRef, target, relation: 'responsible', active: true },
      meta: { requestId: 'wp1-ce-an07-link', expected: [await base.sessionPin(claim.sessionRef), { ref: linkRef, revision: 0 }] } }),
    'AN07 responsible link');
    const workflow = await workflowForFixture(execution, { now });
    if (workflow.archiveLine === undefined || workflow.continueArchiveLine === undefined) throw new Error('existing archive ports absent');
    const pending = ready(await workflow.archiveLine(ctx, {
      input: { sessionRef: claim.sessionRef, reason: 'AN07 operator drops interrupted work',
        tasks: [{ target, disposition: { kind: 'drop' } }], wait: null },
      meta: { requestId: 'wp1-ce-an07-archive', expected: [await base.sessionPin(claim.sessionRef)] },
    }), 'AN07 archive request');
    if (pending.state !== 'pending') throw new Error(`AN07 expected a queued stop: ${JSON.stringify(pending)}`);
    const intentRef = (await execution.read()).run.controlState?.intentRef;
    if (intentRef === undefined) throw new Error('AN07 archive did not submit its cancel');
    const reconcile = createRunReconcileService({ records: base.records,
      reads: createRunStateReader({ records: base.records, bodies: execution.bodies }),
      hostInstance: { hostInstanceId: 'wp1-ce-an07-host', lease: 'owned' }, now, eventId: () => 'wp1-ce-an07-stopped' });
    // The same trusted clean takeover observation as S1-archive-flow:stopArchiveWork.
    // archiveLine has already called Runtime.deliverControl; with no live handle
    // it leaves the durable cancel queued. RUN-23 books the observed stop.
    committed(await reconcile.reconcileRun(ctx, {
      input: { runRef: claim.runRef, basis: { kind: 'host_instance_takeover', hostInstanceId: 'wp1-ce-an07-host' },
        probe: 'ready', result: { kind: 'paused_stop', cancelIntentRef: intentRef, pausedBy: null,
          turn: { terminal: false, inFlightToolCallIds: [], lastPosition: 3, kernelPaused: false,
            entered: null, acceptedSteers: [], inputsConfirmed: true } } },
      meta: { requestId: 'wp1-ce-an07-stop', expected: [await execution.pin()] },
    }), 'AN07 real RUN-23 stop');
    const archived = ready(await workflow.continueArchiveLine(ctx, {
      sessionRef: claim.sessionRef, archiveRequestId: 'wp1-ce-an07-archive',
    }), 'AN07 finish archive');
    if (archived.state !== 'archived') throw new Error(`AN07 incomplete archive: ${JSON.stringify(archived)}`);

    // eligibility.ts:24-28 (LA-11): the A -> B input declaration is checked at
    // consumption, not claim time. B is pending, assigned, unleased and untraced;
    // we only claim it to obtain a canonical same-Goal work_run read principal.
    const readerClaim = committed(await base.service.claimTask(ctx, await base.buildRequest({
      requestId: 'wp1-ce-an07-reader-claim', input: { taskId: base.tasks.second.taskId,
        sessionRef: base.sessions.second },
    })), 'AN07 other Task claim in the same Goal').value;
    const workCtx: CoreCallContext = { projectId: base.scope.projectId, workspaceId: base.scope.workspaceId,
      principal: { kind: 'work_run', runRef: readerClaim.runRef, roleBinding: (await execution.read(readerClaim)).run.roleBinding },
      materialReader: { kind: 'run', requester: readerClaim.runRef }, signal: ctx.signal };
    async function listAnchors(): Promise<SessionAnomalyViewV1[]> {
      const page = ready(await anomalies.listSessionAnomalies(ctx, { goalRef: base.goalRef, page: { limit: 100 } }), 'AN07 anchor owner read');
      if (page.nextCursor !== null) throw new Error('AN07 fixture unexpectedly exceeds one anchor page');
      return page.items;
    }
    const listed = await listAnchors();
    const item = listed[0];
    if (listed.length !== 1 || item === undefined || item.pickedUpBy !== null) throw new Error('AN07 needs one unclaimed anchor');
    const owners = graphOwners(execution);
    let closed = false;
    return { base, b2: execution, anomalies, hostActor, graphReader: owners.graphReader,
      ctx, hostCtx: ctx, workCtx, goalRef: base.goalRef, anchor: item.anchor, anchorTask: item.anchor.task,
      readerClaim, request: { goalRef: base.goalRef, focusTaskIds: [item.anchor.task.taskId] }, workflow, listAnchors,
      readSession: async (ref = claim.sessionRef) => ready(await base.sessionsPort.readSession(ctx, ref), 'AN07 Session owner read'),
      async close() {
        if (closed) return;
        closed = true;
        try { await execution.close(); } finally { restoreDate(); }
      } };
  } catch (error) {
    try { await b2?.close(); } finally { restoreDate(); }
    throw error;
  }
}
