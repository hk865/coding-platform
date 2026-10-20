/**
 * Slice 3 §5.6 `S3-prepared-context-admission` (AD01–AD08), on the real
 * Memory/SQLite backend and the real WorkGraph owners.
 *
 * AD01–AD06/AD08 reach the trusted admission through
 * `createExecutionEntryService().authorizeRuntimeEntry` (spec §3.6). AD07 reaches
 * the Query bind owner through `createQueryExecution().bindPreparedQuery`.
 *
 * The §5.1 unified fixture (scope p/w, Goal g "Ship platform", Plan p1, stage s
 * "Main" with tA/tB, obligation oB/vB, legacy artifact old-A, Workspace@7, edge
 * `A.out`) is built on the real RecordStore with the real Goal/Plan/Session/claim
 * services. No successful port result is mocked; the Host configuration callback
 * is the same trusted test double the frozen B2 fixture uses.
 */
import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { VersionPin, SessionRef } from '../../src/contracts/core/identity.js';
import type { RoleConfigurationRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RunRef, RunSnapshot } from '../../src/contracts/dispatch.js';
import type { GoalRef, ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type { PreparedQueryManifestV1, PreparedTaskExecution, PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { RoleBindingRefV1 } from '../../src/contracts/dispatch.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type {
  ContextAssemblyBindingV1, ContextSectionNameV1, ContextSourceV1, InputDeclarationV1, InputSelectionV1,
} from '../../src/contracts/graph-context.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import {
  canonicalRefKey, encodeProjectSnapshot, encodeWorkspaceSnapshot,
} from '../../src/core/work-graph/persistence/record-codecs.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { EXECUTION_ENTRY_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/execution-entry-codecs.js';
import { createQueryExecution } from '../../src/core/work-graph/queries/query-execution.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import type {
  AuthorizeConfiguration, ExecutionEntryDependencies, ExecutionEntryPort,
} from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { AuthorizeQueryConfiguration, QueryExecutionPort } from '../../src/core/work-graph/queries/contracts.js';
import type { RoleBindingFactsPort } from '../../src/core/work-graph/model/configuration-contracts.js';
import {
  createTaskClaimFixture, preparationHost, prepareQueryForReal, prepareTaskForReal,
  type ClaimFixtureKind, type TaskClaimFixture,
} from '../helpers/task-claim-fixture.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { LINE_SETTINGS_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/line-settings-codecs.js';
import { createLineSettingsService } from '../../src/core/work-graph/configuration/line-settings-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createTaskContextInputService } from '../../src/core/work-graph/tasks/context-input-service.js';
import { createArchitectureCatalogService, ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-service.js';
import {
  createGraphContextReader, type GraphContextReaderDependencies,
} from '../../src/core/work-graph/views/graph-context-reader.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSessionHistoryCursorOwner, createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import { reconcileRunAtStartup } from '../../src/core/agent-runtime/run-reconcile.js';
import { createS2BRuntimeSteps } from '../helpers/S2B-runtime-steps-fixture.js';
import { MODEL_REQUEST_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/model-request-codecs.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';

const AT = '2026-09-24T00:00:00.000Z';
const H = (value: string): string => sha256Hex(value);
const B = (value: string): number => Buffer.byteLength(value, 'utf8');

const PROJECT_ID = 'p';
const WORKSPACE_ID = 'w';
const SCOPE: WorkspaceScope = { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID };
const GOAL_REF: GoalRef = { aggregateType: 'Goal', projectId: PROJECT_ID, goalId: 'g' };
const PLAN_REF: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: PROJECT_ID, planId: 'p1' };
const PROJECT_REF: ProjectSnapshot['ref'] = { aggregateType: 'Project', projectId: PROJECT_ID };
const WORKSPACE_REF: WorkspaceSnapshot['ref'] = { aggregateType: 'Workspace', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID };
const TA = { projectId: PROJECT_ID, goalId: GOAL_REF.goalId, taskId: 'tA' };
const TB = { projectId: PROJECT_ID, goalId: GOAL_REF.goalId, taskId: 'tB' };
const OLD_A: ArtifactRef = {
  kind: 'artifact', contentType: 'text/plain', digest: H('old-A'), sizeBytes: B('old-A'),
  source: { kind: 'artifact', refId: 'old-A', revision: '1' },
};
const HOST_TEMPLATE_DIGEST = H('trusted builder template revision 1');
const HOST_CONFIG_REVISION = 's3-host-config@1';
const HOST_PERMISSIONS: TaskEnvelopeV1['permissions'] = {
  policyRevision: 'legacy-template', tools: ['read'], writeScope: [],
};
const HOST_TEMPLATE = { templateId: 'builder', revision: '1', digest: HOST_TEMPLATE_DIGEST };
const WORK_PRELUDE = '# Verified runtime task input\n\nThis is the current task context assembled from formal platform facts; it is not a transcript.';

const actor = { kind: 'human' as const, id: 's3-admission-operator' };
function ctxFor(projectId: string, workspaceId: string): CoreCallContext {
  return {
    projectId, workspaceId, principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId, workspaceId, actor }, signal: new AbortController().signal,
  };
}

function key(ref: object): string { return canonicalJson(ref as unknown as JsonValue); }

function notImplementedExtension() { return 'not_implemented' as const; }

/** The five optional extension seams are unassembled in this slice. */
function emptyExtensions(): ContextAssemblyBindingV1['extensions'] {
  return { notes: notImplementedExtension(), anomalies: notImplementedExtension(),
    footprint: notImplementedExtension(), goalSettings: notImplementedExtension(), decisions: notImplementedExtension() };
}

/** Byte ranges of the frozen `##` headers, excluding the `\n\n` separators (§4.3/§4.4). */
function requiredSections(input: string): ContextAssemblyBindingV1['sections'] {
  const headers: { name: ContextSectionNameV1; header: string }[] = [
    { name: 'role', header: '## Runtime context' },
    { name: 'goal', header: '## Goal' },
    { name: 'task', header: '## Accepted task' },
  ];
  const present = headers.filter(entry => input.includes(entry.header));
  return present.map((entry, index) => {
    const start = input.indexOf(entry.header);
    const rawEnd = index + 1 < present.length ? input.indexOf(present[index + 1]!.header) : input.length;
    const end = rawEnd === input.length ? rawEnd : rawEnd - 2;
    return { name: entry.name, startByte: B(input.slice(0, start)), endByte: B(input.slice(0, end)), omitted: 0 };
  });
}

function workInput(role: string, goal: string, task: string): string {
  return `${WORK_PRELUDE}\n\n## Runtime context\n${role}\n\n## Goal\n${goal}\n\n## Accepted task\n${task}`;
}

type TaskClaimLike = TaskClaim;

export type AdmissionFixture = {
  base: TaskClaimFixture;
  ctx: CoreCallContext;
  bodies: RawArtifactStorePort;
  entry: ExecutionEntryPort;
  roles: RoleBindingFactsPort;
  host: { enabled: boolean; calls: number };
  claim: TaskClaimLike;
  runB: RunRef;
  runA: RunRef;
  goalRevision: number;
  sessionRef: SessionRef;
  sessionRevision: number;
  commitCount(): number;
  bodyReads(): number;
  /** Calls the trusted entry made through the RoleBindingFacts resolver. */
  resolverCalls(): number;
  readRun(): Promise<RunSnapshot>;
  /** The real upstream tA Run (the legacy body's provenance owner). */
  readSecondRun(): Promise<RunSnapshot>;
  pin(): Promise<VersionPin>;
  prepare(options?: PrepareOptions): Promise<PreparedTaskExecution>;
  /** A real second claim (tA) and its real prepared manifest, for the idempotency row. */
  prepareSecond(): Promise<PreparedTaskExecution>;
  /** The pin of that real second claim. */
  secondPin(): Promise<VersionPin>;
  /** The base hand-built preparation: AD08's BLOCKED base path and AD06's one refused input. */
  basePrepare(options: { input: string; workspaceRevision?: number; claim?: TaskClaimLike }): Promise<PreparedTaskExecution>;
  /** A real public Session-pin change at the expected Workspace revision. */
  changePins(add: SessionRef[], remove: SessionRef[], expected: number, requestId: string): Promise<void>;
  close(): Promise<void>;
};

export type PrepareOptions = {
  input?: string;
  binding?: ContextAssemblyBindingV1 | null;
  selectedTaskInputs?: { requirementId: string; ref: ArtifactRef }[];
  inputDigest?: string;
  workspaceRevision?: number;
  claim?: TaskClaimLike;
  consumerId?: string;
};

function makeBinding(selections: InputSelectionV1[], sources: ContextSourceV1[], input: string): ContextAssemblyBindingV1 {
  return {
    schemaVersion: 1, formatVersion: 's3-context-v1', callKind: 'work', duty: 'executor',
    residentBudgetBytes: 4096, residentBytes: 0, totalBytes: B(input),
    sections: requiredSections(input), sources, inputSelections: selections, extensions: emptyExtensions(),
  };
}

function legacyDeclaration(): InputDeclarationV1 {
  return {
    declarationId: 'legacy:legacy-old-a', consumer: TB, planRef: PLAN_REF, upstream: TA,
    requires: { kind: 'artifact', label: 'legacy-old-a' }, legacyArtifactRef: OLD_A,
  };
}

function edgeDeclaration(): InputDeclarationV1 {
  const requires = { kind: 'artifact' as const, label: 'A.out' };
  const declarationId = 'edge:' + sha256Hex(canonicalJson({
    planRef: PLAN_REF, consumerTaskId: TB.taskId, dependsOnId: TA.taskId, requires,
  } as unknown as JsonValue));
  return { declarationId, consumer: TB, planRef: PLAN_REF, upstream: TA, requires, legacyArtifactRef: null };
}

function selectedOldA(runA: RunRef): InputSelectionV1 {
  const declaration = legacyDeclaration();
  const source = { kind: 'artifact' as const, ref: OLD_A, provenance: { kind: 'run' as const, owner: runA } };
  return { declaration, state: 'selected', source, candidates: [source], usage: 'historical_explanation', reason: null, errorCode: null };
}

function missingEdge(): InputSelectionV1 {
  return { declaration: edgeDeclaration(), state: 'missing', source: null, candidates: [],
    usage: 'historical_explanation', reason: 'no_labeled_output', errorCode: null };
}

function workspaceSource(revision: number): ContextSourceV1 {
  return { kind: 'record', ref: { aggregateType: 'Workspace', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID }, revision, digest: null };
}

export async function createAdmissionFixture(kind: ClaimFixtureKind): Promise<AdmissionFixture> {
  const base = await createTaskClaimFixture(kind, {
    records: [...EXECUTION_ENTRY_RECORD_SCHEMAS.records, ...EVIDENCE_RECORD_SCHEMAS.records,
      ...CONTROL_RECORD_SCHEMAS.records, ...LINE_SETTINGS_RECORD_SCHEMAS.records,
      ...ARCHITECTURE_CATALOG_SCHEMAS.records, ...MODEL_REQUEST_RECORD_SCHEMAS.records],
    events: [...EXECUTION_ENTRY_RECORD_SCHEMAS.events, ...EVIDENCE_RECORD_SCHEMAS.events,
      ...CONTROL_RECORD_SCHEMAS.events, ...LINE_SETTINGS_RECORD_SCHEMAS.events,
      ...ARCHITECTURE_CATALOG_SCHEMAS.events, ...MODEL_REQUEST_RECORD_SCHEMAS.events],
    lookups: [...EXECUTION_ENTRY_RECORD_SCHEMAS.lookups ?? [], ...EVIDENCE_RECORD_SCHEMAS.lookups ?? [],
      ...CONTROL_RECORD_SCHEMAS.lookups ?? [], ...LINE_SETTINGS_RECORD_SCHEMAS.lookups ?? [],
      ...ARCHITECTURE_CATALOG_SCHEMAS.lookups ?? [], ...MODEL_REQUEST_RECORD_SCHEMAS.lookups ?? []],
  });
  const records = base.records;
  const myCtx = ctxFor(PROJECT_ID, WORKSPACE_ID);
  let eventSeq = 0;
  let clock = AT;
  const now = () => clock;
  const setClock = (at: string): void => { clock = at; };
  const eventId = () => `ad-event-${++eventSeq}`;

  // The §5.1 Workspace is registered by the public bootstrap owner at @1;
  // six real public Session-pin changes below take it to @7 (AD08 then moves
  // it to @8 the same way). The Project row is the trusted scope seed.
  const project: ProjectSnapshot = { ref: PROJECT_REF, revision: 1 };
  const seeded = await base.commitRaw([encodeProjectSnapshot(project)],
    [{ refKey: canonicalRefKey(PROJECT_REF), expectedRevision: null }]);
  if (seeded.status !== 'committed') throw new Error(`AD scope seed failed: ${JSON.stringify(seeded)}`);
  const bootstrap = createProjectBootstrapServices({ records, now, eventId });
  const registeredWorkspace = await bootstrap.projects.registerWorkspace(myCtx, {
    input: { workspace: SCOPE }, meta: { requestId: 'ad-register-workspace',
      expected: [{ ref: PROJECT_REF, revision: 1 }, { ref: WORKSPACE_REF, revision: 0 }] } });
  if (registeredWorkspace.status !== 'committed') {
    throw new Error(`AD Workspace registration failed: ${JSON.stringify(registeredWorkspace)}`);
  }

  // Trusted governance for project p: the completion policy is the smallest
  // trusted seed; the architecture is adopted through the public owner below.
  const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId: PROJECT_ID, policyId: 's3-policy', revision: 1 };
  const policyFixture = { schemaVersion: 1, identity: { policyId: 's3-policy' }, revision: 1,
    content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } };
  const digest = (value: JsonValue) => sha256Hex(canonicalJson(value));
  const activePolicyRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: PROJECT_ID };
  const governance = [
    { ref: policyRef, revision: 1, schemaVersion: 1, policyId: policyRef.policyId, contentRevision: 1,
      contentDigest: digest(policyFixture as unknown as JsonValue), content: policyFixture.content },
    { ref: activePolicyRef, projectId: PROJECT_ID, revision: 1, activeRevision: policyRef },
  ];
  const governanceSeed = await base.commitRaw(governance.map(snapshot => ({
    refKey: key(snapshot.ref), schemaId: `${snapshot.ref.aggregateType}Snapshot@1`,
    revision: snapshot.revision, json: JSON.stringify(snapshot),
  })));
  if (governanceSeed.status !== 'committed') throw new Error(`AD governance seed failed: ${JSON.stringify(governanceSeed)}`);

  // TQ-091: the baseline/catalog/active rows come from the public adoption
  // owner, never a hand-written catalog row.
  const architecture = createArchitectureCatalogService({ records });
  const adopted = await architecture.adoptInitialArchitecture(myCtx, {
    input: { baselineId: 's3-baseline', description: 'S3 admission baseline', constraints: [],
      catalog: { requireDag: true, dependencies: [], modules: [{ ref: { projectId: PROJECT_ID, moduleId: 's3-admission' },
        name: 'S3 admission', responsibility: 'S3 admission fixture', paths: ['src/s3-admission'], interfaces: [] }] } },
    meta: { requestId: 'ad-adopt-architecture', expected: [
      { ref: PROJECT_REF, revision: 1 }, { ref: WORKSPACE_REF, revision: 1 }] },
  });
  if (adopted.status !== 'committed') throw new Error(`AD architecture adoption failed: ${JSON.stringify(adopted)}`);


  const createdGoal = await base.goals.createGoal(myCtx, { meta: {
    requestId: 'ad-create-goal',
    expected: [{ ref: PROJECT_REF, revision: 1 }, { ref: WORKSPACE_REF, revision: 1 }] },
    input: { goalId: GOAL_REF.goalId, workspace: SCOPE, objective: 'Ship platform' } });
  if (createdGoal.status !== 'committed') throw new Error(`AD Goal creation failed: ${JSON.stringify(createdGoal)}`);

  const draft: PlanRevisionDraft = { schemaVersion: 2, planId: PLAN_REF.planId, planRevision: 1, goalId: GOAL_REF.goalId,
    stages: [{ stageId: 's', title: 'Main' }],
    tasks: [
      { taskId: 'tA', stageId: 's', title: 'A', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
      { taskId: 'tB', stageId: 's', title: 'B', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'request_execution' },
    ],
    assignments: [
      { taskId: 'tA', role: 'builder', instruction: 'Implement A' },
      { taskId: 'tB', role: 'builder', instruction: 'Implement B' },
    ],
    obligations: [{ obligationId: 'oB', title: 'Deliver B', requirementLevel: 'required', taskIds: ['tB'],
      verificationRequirements: [{ requirementId: 'vB', requirementLevel: 'required', kind: 'static',
        description: 'node check-b.js' }] }],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [{ taskId: 'tB', dependsOnId: 'tA', requires: { kind: 'artifact', label: 'A.out' } }] },
    inputRequirements: [{ requirementId: 'legacy-old-a', consumerTaskId: 'tB', kind: 'artifact', artifactRef: OLD_A }],
  };
  const proposed = await base.plans.proposePlan(myCtx, { meta: { requestId: 'ad-propose-plan',
    expected: [{ ref: GOAL_REF, revision: 1 }] },
    input: { goalRef: GOAL_REF, basedOn: null, draft, reason: { text: 'S3 admission plan', sources: [] } } });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
    throw new Error(`AD Plan proposal failed: ${JSON.stringify(proposed)}`);
  }
  const applied = await base.plans.applyPlanChange(myCtx, { meta: { requestId: 'ad-apply-plan',
    expected: [{ ref: GOAL_REF, revision: 1 }] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`AD Plan adoption failed: ${JSON.stringify(applied)}`);

  const bodies = new RawArtifactBodyStore();

  // The main and upstream Sessions are created by the public Session route
  // (`sessions/create` -> sessionOperations.createSession), which admits and
  // registers the mapping as ONE operation and creates the Kernel Session.
  const roleRef: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
  const kernelStores = await createKernelStoreRegistry({ entries: [{ adapterId: 'r4c-claim-kernel',
    storeKey: 'r4c-claim-kernel-store', workspace: SCOPE, databasePath: join(base.directory, 'kernel.sqlite') }] });
  const sessionOperations = createSessionOperations({ sessions: base.sessionsPort, kernelStores });
  async function createPublicSession(requestId: string): Promise<{ ref: SessionRef; revision: number }> {
    const created = await sessionOperations.createSession(myCtx, { workspace: SCOPE, role: roleRef,
      recommendedRefs: [], initialLinks: [], meta: { requestId, expected: [] } });
    if (created.status !== 'completed') throw new Error(`AD public Session creation failed: ${JSON.stringify(created)}`);
    const card = await base.sessionsPort.readSession(myCtx, created.value.ref);
    if (card.status !== 'ready') throw new Error(`AD Session read failed: ${JSON.stringify(card)}`);
    const ref: SessionRef = { projectId: created.value.ref.projectId, sessionId: created.value.ref.sessionId };
    return { ref, revision: card.value.record.revision };
  }
  const mainSession = await createPublicSession('ad-create-session');
  const sessionRef = mainSession.ref;
  const sessionRevision = mainSession.revision;

  const goalRead = await base.plans.queryGoal(myCtx, GOAL_REF);
  if (goalRead.status !== 'ready') throw new Error(`AD Goal read failed: ${JSON.stringify(goalRead)}`);

  // The real graph/materials/input owners, so the real assembler can record the
  // Goal and Workspace sources the admission checks read.
  const materialReads = createMaterialRecordReaders(records);
  const materials = createMaterialService({ bodies, authority: materialReads.authority, now });
  const hostActor: GraphContextReaderDependencies['hostActor'] = { kind: 'system', id: 's3-admission-context-host' };
  const executions = createRunStateReader({ records, bodies });
  const inputs = createTaskContextInputService({ records, materials, bodies, hostActor });
  const graph = createGraphContextReader({ records, goals: base.plans, plans: base.plans, architecture,
    sessions: base.sessionsPort, executions, inputs, hostActor });
  const adHost = preparationHost({ configurationRevision: HOST_CONFIG_REVISION,
    permissions: HOST_PERMISSIONS, hostTemplate: HOST_TEMPLATE });

  // Six real public Session-pin changes take the Workspace from its public
  // registration @1 to @7 (no hand-written @5 row).
  const lineSettings = createLineSettingsService({ records, sessionRead: base.sessionsPort.readSession, now,
    operatorActor: actor });
  async function changePins(expected: number, add: SessionRef[], remove: SessionRef[], requestId: string): Promise<void> {
    const result = await lineSettings.setLinePins(myCtx, { meta: { requestId,
      expected: [{ ref: WORKSPACE_REF, revision: expected }] }, input: { workspace: SCOPE, add, remove } });
    if (result.status !== 'committed') throw new Error(`AD pin change failed: ${JSON.stringify(result)}`);
  }
  for (let revision = 1; revision < 7; revision += 1) {
    const add = revision % 2 === 1 ? [sessionRef] : [];
    const remove = revision % 2 === 1 ? [] : [sessionRef];
    await changePins(revision, add, remove, `ad-pin-${revision}`);
  }

  // AD03's second manifest and the upstream ended Run: a real tA Session,
  // claim, prepare and scripted-model start/end at Workspace@7 (no raw Run
  // seed and no Host-written Session registration).
  const upstreamSession = await createPublicSession('ad-create-upstream-session');
  const secondClaimed = await base.service.claimTask(myCtx, { input: {
    goalRef: GOAL_REF, planRef: PLAN_REF, taskId: TA.taskId, sessionRef: upstreamSession.ref,
    roleBinding: base.roleBinding, budget: base.budget }, meta: { requestId: 'ad-claim-second', expected: [
    { ref: GOAL_REF, revision: goalRead.value.goal.revision },
    { ref: WORKSPACE_REF, revision: 7 },
    { ref: { aggregateType: 'Session', projectId: PROJECT_ID, sessionId: upstreamSession.ref.sessionId },
      revision: upstreamSession.revision },
  ] } });
  if (secondClaimed.status !== 'committed') throw new Error(`AD second claim failed: ${JSON.stringify(secondClaimed)}`);
  const secondClaim = secondClaimed.value;
  const secondPrepared = (await prepareTaskForReal({ records, ctx: myCtx }, {
    bodies, runRef: secondClaim.runRef, now, requestId: 'ad-second-prepare',
    host: adHost, graphContext: graph, taskInputs: inputs })).prepared;

  const runtimeSteps = await createS2BRuntimeSteps({ base, bodies, ctx: myCtx, directory: base.directory, scope: SCOPE,
    now, setClock, eventId, newId: () => `ad-runtime-id-${++eventSeq}`, consumerId: 'runtime-a', workspaceRevision: 7,
    host: { configurationRevision: HOST_CONFIG_REVISION, permissions: HOST_PERMISSIONS, hostTemplate: HOST_TEMPLATE } });
  const upstreamHandle = await runtimeSteps.start(secondClaim, { at: AT,
    replies: [{ kind: 'text', text: 'AD upstream task A completed' }] });
  await upstreamHandle.entered;
  await runtimeSteps.finish(upstreamHandle, AT, 'completed');

  // The ended upstream Run is the provenance owner of the legacy body.
  const runARef: RunRef = secondClaim.runRef;
  const storedOldA = await bodies.put({ body: 'old-A', contentType: 'text/plain',
    sourceRefs: [{ kind: 'artifact', refId: 'old-A', revision: '1' }], origin: { kind: 'run', owner: runARef }, requestedAt: AT });
  if (storedOldA.status !== 'ready') throw new Error(`AD legacy body store failed: ${JSON.stringify(storedOldA)}`);

  // §5.1 fixes tB's only Run to `runB`. The shared claim helper does not expose
  // its `newId`, so the same real claim owner is built here with a deterministic
  // first id (the next two generated ids are the Attempt and the event).
  const claimRoles = createRoleConfigurationService({ records, now, eventId });
  let claimIdSeq = 0;
  const claimService = createTaskClaimService({ records, roles: claimRoles, now,
    newId: () => { claimIdSeq += 1; return claimIdSeq === 1 ? 'runB' : `ad-claim-id-${claimIdSeq}`; } });
  const claimResult = await claimService.claimTask(myCtx, { input: {
    goalRef: GOAL_REF, planRef: PLAN_REF, taskId: TB.taskId, sessionRef,
    roleBinding: base.roleBinding, budget: base.budget }, meta: { requestId: 'ad-claim-tB', expected: [
    { ref: GOAL_REF, revision: goalRead.value.goal.revision },
    { ref: WORKSPACE_REF, revision: 7 },
    { ref: { aggregateType: 'Session', projectId: PROJECT_ID, sessionId: sessionRef.sessionId }, revision: sessionRevision },
  ] } });
  if (claimResult.status !== 'committed') throw new Error(`AD claim failed: ${JSON.stringify(claimResult)}`);
  const claim = claimResult.value;
  const runB = claim.runRef;

  let commitCount = 0;
  let bodyReads = 0;
  const wrappedRecords = { ...records,
    async commit(batch: Parameters<typeof records.commit>[0]) { commitCount += 1; return records.commit(batch); },
    async lookupCommit(input: Parameters<typeof records.lookupCommit>[0]) { return records.lookupCommit(input); } };
  const wrappedBodies: RawArtifactStorePort = {
    put: input => bodies.put(input),
    async read(ref) { bodyReads += 1; return bodies.read(ref); },
  };

  const roles = createRoleConfigurationService({ records: wrappedRecords, now, eventId });
  // The resolver boundary is the trusted RoleBindingFacts port the entry service
  // itself calls; counting it proves a replayed authorize never re-resolves.
  let resolverCalls = 0;
  const entryRoles: RoleBindingFactsPort = {
    async resolveRoleBindingFacts(ctx, input) { resolverCalls += 1; return roles.resolveRoleBindingFacts(ctx, input); },
  };
  const host = { enabled: true, calls: 0 };
  const authorizeConfiguration: AuthorizeConfiguration = async (callCtx, input) => {
    host.calls += 1;
    const expectedRole = roleRef;
    if (!host.enabled || callCtx.projectId !== PROJECT_ID || callCtx.workspaceId !== WORKSPACE_ID
      || input.run.ref.projectId !== PROJECT_ID
      || canonicalJson(input.sessionRole as unknown as JsonValue) !== canonicalJson(expectedRole as unknown as JsonValue)
      || input.configurationRevision !== HOST_CONFIG_REVISION
      || canonicalJson(input.permissions as unknown as JsonValue) !== canonicalJson(HOST_PERMISSIONS as unknown as JsonValue)
      || canonicalJson(input.hostTemplate as unknown as JsonValue) !== canonicalJson(HOST_TEMPLATE as unknown as JsonValue)) {
      return { status: 'rejected', code: 'forbidden', reason: 'the fixed test Host configuration does not authorize this request' };
    }
    return { status: 'ready', value: structuredClone({ configurationRevision: HOST_CONFIG_REVISION,
      permissions: HOST_PERMISSIONS, hostTemplate: HOST_TEMPLATE }) };
  };
  const deps: ExecutionEntryDependencies = {
    records: wrappedRecords, reads: createRunStateReader({ records: wrappedRecords }), roles: entryRoles, bodies: wrappedBodies,
    authorizeConfiguration, now, eventId, newId: () => `ad-id-${++eventSeq}`,
  };
  const entry = createExecutionEntryService(deps);

  async function readRun(): Promise<RunSnapshot> {
    const read = await createRunStateReader({ records }).readExecution(myCtx, runB);
    if (read.status !== 'ready') throw new Error(`AD Run read failed: ${JSON.stringify(read)}`);
    return read.value.run;
  }

  async function pin(): Promise<VersionPin> {
    const run = await readRun();
    return { ref: runB, revision: run.revision };
  }

  let prepareSeq = 0;

  async function prepare(options: PrepareOptions = {}): Promise<PreparedTaskExecution> {
    const target = options.claim ?? claim;
    const real = await prepareTaskForReal({ records, ctx: myCtx }, { bodies, runRef: target.runRef, now,
      requestId: `ad-prepare-${target.runRef.runId}-${++prepareSeq}`,
      host: adHost, graphContext: graph, taskInputs: inputs });
    return real.prepared;
  }

  /** AD03's second content: tA's real Prepared value, a genuinely different
   * manifest from tB's, which the owner must refuse for the same request. */
  async function prepareSecond(): Promise<PreparedTaskExecution> {
    return secondPrepared;
  }

  async function secondPin(): Promise<VersionPin> {
    const read = await createRunStateReader({ records }).readExecution(myCtx, secondClaim.runRef);
    if (read.status !== 'ready') throw new Error(`AD second Run read failed: ${JSON.stringify(read)}`);
    return { ref: secondClaim.runRef, revision: read.value.run.revision };
  }

  async function readSecondRun(): Promise<RunSnapshot> {
    const read = await createRunStateReader({ records }).readExecution(myCtx, secondClaim.runRef);
    if (read.status !== 'ready') throw new Error(`AD second Run read failed: ${JSON.stringify(read)}`);
    return read.value.run;
  }

  // AD08 (Workspace source) stays BLOCKED: the real preparation carries no
  // Workspace source, so that row keeps the base hand-built preparation path,
  // as `t-base` had it (`:383`). AD06 only builds its one refused input here.
  const rolesForManifest = createRoleConfigurationService({ records, now, eventId });
  async function basePrepare(options: { input: string; workspaceRevision?: number; claim?: TaskClaimLike }):
  Promise<PreparedTaskExecution> {
    const target = options.claim ?? claim;
    const input = options.input;
    const inputDigest = artifactBodyDigest(input);
    const binding = makeBinding([selectedOldA(runARef), missingEdge()],
      [workspaceSource(options.workspaceRevision ?? 7)], input);
    const selectedTaskInputs = [{ requirementId: 'legacy-old-a', ref: OLD_A }];
    const workspaceRevision = options.workspaceRevision ?? 7;
    const roleFacts = await rolesForManifest.resolveRoleBindingFacts(myCtx, {
      roleBinding: base.roleBinding, declaredPermissions: HOST_PERMISSIONS });
    if (roleFacts.result.status !== 'ready') throw new Error('AD base role fixture could not resolve');
    const role = roleFacts.result.value;
    const workspaceSnapshot = { workspaceId: WORKSPACE_ID, revision: workspaceRevision };
    const manifest: PreparedTaskManifestV1 = {
      schemaVersion: 1, kind: 'task_execution', claim: target, role, hostTemplate: HOST_TEMPLATE,
      roleBinding: base.roleBinding, hostConfigurationRevision: HOST_CONFIG_REVISION,
      sessionRole: roleRef, workspaceSnapshot, permissions: HOST_PERMISSIONS, budget: base.budget,
      selectedTaskInputs, materialBasis: null, materialAccessRefs: [], additionalMaterialRefs: [], deliveryRefs: [],
      sourceRefs: [{ kind: 'workspace', refId: WORKSPACE_ID, revision: String(workspaceRevision) }],
      contextAssembly: binding, input, inputDigest,
    };
    const stored = await bodies.put({ body: JSON.stringify(manifest),
      contentType: 'application/vnd.coding-platform.task-execution-manifest+json;version=1',
      sourceRefs: [{ kind: 'workspace', refId: WORKSPACE_ID, revision: String(workspaceRevision) }],
      origin: { kind: 'run', owner: target.runRef }, requestedAt: now() });
    if (stored.status !== 'ready') throw new Error(`AD base manifest store failed: ${JSON.stringify(stored)}`);
    const envelope: PreparedTaskExecution['envelope'] = {
      schemaVersion: 1, envelopeId: 'ad-envelope-1', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
      goalId: GOAL_REF.goalId, taskId: TB.taskId, runRef: target.runRef, attemptRef: target.attemptRef,
      planRef: target.planRef, roleBinding: base.roleBinding, workspaceSnapshot,
      permissions: HOST_PERMISSIONS, budget: base.budget, sourceRefs: manifest.sourceRefs, bundleRef: stored.value.ref,
    };
    return { kind: 'task', claim: target, envelope,
      inputBinding: { schemaVersion: 1, inputDigest, manifestDigest: stored.value.ref.digest,
        materialAccessRefs: [], deliveryRefs: [] } };
  }

  return {
    base, ctx: myCtx, bodies, entry, roles: entryRoles, host, claim, runB, runA: runARef,
    goalRevision: goalRead.value.goal.revision, sessionRef, sessionRevision,
    commitCount: () => commitCount, bodyReads: () => bodyReads, resolverCalls: () => resolverCalls, readRun, readSecondRun,
    pin, prepare, prepareSecond, secondPin, basePrepare,
    changePins: (add: SessionRef[], remove: SessionRef[], expected: number, requestId: string) =>
      changePins(expected, add, remove, requestId),
    close: async () => { await runtimeSteps.close(); await base.close(); },
  };
}

function authorize(fixture: AdmissionFixture, prepared: PreparedTaskExecution, requestId: string,
  expected?: readonly VersionPin[]) {
  return fixture.entry.authorizeRuntimeEntry(fixture.ctx, { input: { prepared, consumerId: 'runtime-a' },
    meta: { requestId, expected: expected ?? [] } });
}
const fixtures: AdmissionFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });
async function open(kind: ClaimFixtureKind): Promise<AdmissionFixture> {
  const fixture = await createAdmissionFixture(kind); fixtures.push(fixture); return fixture;
}

describe.each(['memory', 'sqlite'] as const)('S3 prepared context admission (%s)', kind => {
  it('AD01: a fresh work Run with a legal selected and a legal missing input commits and stays Authorized; the missing input does not block the claim', async () => {
    const fixture = await open(kind);
    expect(fixture.runB.runId).toBe('runB');
    const prepared = await fixture.prepare();
    const result = await authorize(fixture, prepared, 'ad01', [await fixture.pin()]);
    expect(result).toMatchObject({ status: 'committed', replayed: false });
    const run = await fixture.readRun();
    expect(run.status).toBe('starting');
    expect(run.executionAuthorization).toMatchObject({ phase: 'authorized' });
    const binding = prepared.envelope.bundleRef;
    expect(binding.kind).toBe('artifact');
  });

  it('AD02: the same authorize requestId and content replay the original receipt and never re-resolve inputs', async () => {
    const fixture = await open(kind);
    const prepared = await fixture.prepare();
    const pin = await fixture.pin();
    const first = await authorize(fixture, prepared, 'ad02', [pin]);
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    if (first.status !== 'committed') throw new Error('AD02 first authorize failed');
    const persistedBefore = (await fixture.readRun()).inputBinding;
    // A later upstream material appears; a replay must ignore it.
    await fixture.bodies.put({ body: 'new-A', contentType: 'text/plain',
      sourceRefs: [{ kind: 'artifact', refId: 'new-A', revision: '1' }], origin: { kind: 'run', owner: fixture.runA }, requestedAt: AT });
    const readsBefore = fixture.bodyReads();
    const resolverCallsBefore = fixture.resolverCalls();
    expect(resolverCallsBefore).toBeGreaterThan(0);
    const replay = await authorize(fixture, prepared, 'ad02', [pin]);
    expect(replay).toMatchObject({ status: 'committed', replayed: true });
    if (replay.status !== 'committed') throw new Error('AD02 replay failed');
    expect(replay.cursor).toBe(first.cursor);
    // The persisted Run keeps the exact binding the first authorize committed.
    expect((await fixture.readRun()).inputBinding).toEqual(persistedBefore);
    // The replay returns the recorded receipt: the resolver boundary stays cold.
    expect(fixture.resolverCalls()).toBe(resolverCallsBefore);
    expect(fixture.bodyReads()).toBe(readsBefore);
  });

  describe('rejects: prepared context admission', () => {
    it('AD03: the same requestId with another manifest is an idempotency conflict and commits nothing', async () => {
      const fixture = await open(kind);
      const first = await fixture.prepare();
      const pin = await fixture.pin();
      expect(await authorize(fixture, first, 'ad03', [pin])).toMatchObject({ status: 'committed', replayed: false });
      // A real prepared manifest for the other Task (tA), not the same value
      // with a changed envelope id.
      const second = await fixture.prepareSecond();
      const firstRunBefore = await fixture.readRun();
      const secondRunBefore = await fixture.readSecondRun();
      const commitsBefore = fixture.commitCount();
      const conflict = await authorize(fixture, second, 'ad03', [await fixture.secondPin()]);
      expect(conflict).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
      // A6: the public execution read of BOTH Runs named by the refused request
      // is unchanged, and the owner committed nothing.
      expect(await fixture.readRun()).toEqual(firstRunBefore);
      expect(await fixture.readSecondRun()).toEqual(secondRunBefore);
      expect(fixture.commitCount()).toBe(commitsBefore);
    });

    it('AD06: a revoked Run re-authorizes only with the fixed binding; another binding is invalid and the original is kept', async () => {
      const fixture = await open(kind);
      // A2 fault at a named point: the Kernel store is unreadable for the one
      // boundary read after the real begin. The real Runtime start therefore
      // fails before the entered fact and leaves the Run `Entering` (revoked by
      // the Host reconcile below, as run-reconcile W-05 does).
      const kernelPath = join(fixture.base.directory, 'kernel.sqlite');
      const savedKernelPath = `${kernelPath}.ad06`;
      let kernelSwapped = false;
      const steps = await createS2BRuntimeSteps({ base: fixture.base, bodies: fixture.bodies, ctx: fixture.ctx,
        directory: fixture.base.directory, scope: SCOPE, now: () => AT, setClock: () => undefined,
        eventId: () => 'ad06-event', newId: () => 'ad06-id', consumerId: 'runtime-a', workspaceRevision: 7,
        host: { configurationRevision: HOST_CONFIG_REVISION, permissions: HOST_PERMISSIONS, hostTemplate: HOST_TEMPLATE },
        beforeBegin: async () => {
          await rename(kernelPath, savedKernelPath);
          await writeFile(kernelPath, 'AD06 not a Kernel Store');
          kernelSwapped = true;
        } });
      try {
        const handle = await steps.start(fixture.claim, { at: AT,
          replies: [{ kind: 'text', text: 'AD06 never enters' }] });
        await handle.settled.catch(() => undefined);
      } finally {
        await steps.close();
        if (kernelSwapped) {
          await rm(kernelPath, { force: true });
          await rename(savedKernelPath, kernelPath);
        }
      }
      const entering = await fixture.readRun();
      expect(entering).toMatchObject({ status: 'starting', executionAuthorization: { phase: 'entering' } });
      // The Host reconcile's own probe: the restored Kernel Store is readable and
      // holds no Turn of the fixed identity, so the real classifier reaches W-05
      // and the real write service revokes the Run (run-reconcile W-05).
      const kernelStores = await createKernelStoreRegistry({ entries: [{ adapterId: 'r4c-claim-kernel',
        storeKey: 'r4c-claim-kernel-store', workspace: SCOPE, databasePath: kernelPath }] });
      const owner = createSessionHistoryCursorOwner({ kernelStores });
      const reads = createRunStateReader({ records: fixture.base.records });
      const execution = await reads.readExecution(fixture.ctx, fixture.runB);
      if (execution.status !== 'ready') throw new Error(`AD06 Run record read failed: ${JSON.stringify(execution)}`);
      const hostInstanceId = 'ad06-host';
      const reconcile = createRunReconcileService({ records: fixture.base.records, reads, now: () => AT,
        hostInstance: { hostInstanceId, lease: 'owned' }, eventId: () => 'ad06-reconcile-event' });
      const controls = createRunControlService({ records: fixture.base.records, reads,
        authority: createMaterialRecordReaders(fixture.base.records).authority, now: () => AT,
        eventId: () => 'ad06-control-event' });
      const report = await reconcileRunAtStartup({ owner, controls, entry: fixture.entry, reconcile,
        now: () => AT, newId: () => 'ad06-reconcile-id' }, fixture.ctx, {
        record: execution.value, hostInstanceId,
        probe: await owner.probe({ session: execution.value.session, signal: fixture.ctx.signal }) });
      expect(report).toMatchObject({ status: 'reconciled', row: 'W-05' });
      const before = await fixture.readRun();
      expect(before).toMatchObject({ status: 'starting', executionAuthorization: { phase: 'revoked' } });
      const fixedBinding = before.inputBinding;
      expect(fixedBinding).toBeDefined();
      // The one built refused input: another Prepared binding for the same claim.
      const changed = await fixture.basePrepare({ claim: fixture.claim, input: workInput('R', 'G', 'CHANGED') });
      const commitsBefore = fixture.commitCount();
      const result = await authorize(fixture, changed, 'ad06-second', [await fixture.pin()]);
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(fixture.commitCount()).toBe(commitsBefore);
      const after = await fixture.readRun();
      expect(after.revision).toBe(before.revision);
      expect(after.inputBinding).toEqual(fixedBinding);
      expect(after.envelope).toEqual(before.envelope);
      expect(after.executionAuthorization).toEqual(before.executionAuthorization);
    });

  });

  it('AD04: a tampered saved input body or digest is invalid and commits nothing', async () => {
    const fixture = await open(kind);
    const prepared = await fixture.prepare();
    const tampered: PreparedTaskExecution = { ...prepared,
      inputBinding: { ...prepared.inputBinding, inputDigest: H('tampered') } };
    const commitsBefore = fixture.commitCount();
    const result = await authorize(fixture, tampered, 'ad04', [await fixture.pin()]);
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(fixture.commitCount()).toBe(commitsBefore);
  });

  it('AD07: a new Query with the look/find and read tools binds prepared with the triple intersection equal', async () => {
    const kindFixture = await createQueryAdmissionFixture(kind);
    try {
      const result = await kindFixture.bind();
      expect(result).toMatchObject({ status: 'committed', replayed: false });
      if (result.status !== 'committed') throw new Error(`AD07 bind failed: ${JSON.stringify(result)}`);
      expect(result.value.run.run.executionState).toMatchObject({ phase: 'prepared' });
      const expectedIntersection = kindFixture.hostCeiling.filter(tool =>
        kindFixture.roleCeiling.includes(tool) && kindFixture.queryCeiling.includes(tool));
      expect(kindFixture.manifest.permissions.tools).toEqual(expectedIntersection);
      expect(kindFixture.manifest.permissions.writeScope).toEqual([]);
    } finally { await kindFixture.close(); }
  });

  it('AD08: a Workspace moved from @7 to @8 after assembly is a revision conflict while the write guard still pins @7', async () => {
    const fixture = await open(kind);
    const prepared = await fixture.basePrepare({ input: workInput('R', 'G', 'T'), workspaceRevision: 7 });
    const runBefore = await fixture.readRun();
    const sessionBefore = await fixture.base.sessionsPort.readSession(fixture.ctx, fixture.sessionRef);
    if (sessionBefore.status !== 'ready') throw new Error('AD08 Session read failed');
    // The assembled binding named Workspace@7; a real public pin change now
    // advances the record to @8 (no hand-filled revision).
    await fixture.changePins([fixture.sessionRef], [], 7, 'ad08-pin');
    const result = await authorize(fixture, prepared, 'ad08', [await fixture.pin()]);
    expect(result).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    // A CAS-rejected attempt may still call commit, so compare the durable
    // Run/Session bindings rather than the attempted-commit count.
    const runAfter = await fixture.readRun();
    expect(runAfter.revision).toBe(runBefore.revision);
    expect(runAfter.inputBinding).toEqual(runBefore.inputBinding);
    expect(runAfter.executionAuthorization).toEqual(runBefore.executionAuthorization);
    const sessionAfter = await fixture.base.sessionsPort.readSession(fixture.ctx, fixture.sessionRef);
    if (sessionAfter.status !== 'ready') throw new Error('AD08 Session read failed');
    expect(sessionAfter.value.record.revision).toBe(sessionBefore.value.record.revision);
  });
});

// --------------------------------------------------------------------------
// AD07: the Query bind owner over the same real backends.
// --------------------------------------------------------------------------

export type QueryAdmissionFixture = {
  bind(): Promise<Awaited<ReturnType<QueryExecutionPort['bindPreparedQuery']>>>;
  manifest: PreparedQueryManifestV1;
  /** The three independent ceilings the Query bind must intersect (spec §4.4). */
  hostCeiling: string[];
  roleCeiling: string[];
  queryCeiling: string[];
  close(): Promise<void>;
};

export async function createQueryAdmissionFixture(kind: ClaimFixtureKind): Promise<QueryAdmissionFixture> {
  const base = await createTaskClaimFixture(kind, QUERY_JOB_RECORD_SCHEMAS);
  const myCtx = ctxFor(PROJECT_ID, WORKSPACE_ID);
  const project: ProjectSnapshot = { ref: PROJECT_REF, revision: 1 };
  const workspace: WorkspaceSnapshot = { ref: WORKSPACE_REF, revision: 7 };
  const seeded = await base.commitRaw([encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspace)],
    [{ refKey: canonicalRefKey(PROJECT_REF), expectedRevision: null },
      { refKey: canonicalRefKey(WORKSPACE_REF), expectedRevision: null }]);
  if (seeded.status !== 'committed') throw new Error(`AD07 scope seed failed: ${JSON.stringify(seeded)}`);
  const createdGoal = await base.goals.createGoal(myCtx, { meta: { requestId: 'ad07-create-goal',
    expected: [{ ref: PROJECT_REF, revision: 1 }, { ref: WORKSPACE_REF, revision: 7 }] },
    input: { goalId: GOAL_REF.goalId, workspace: SCOPE, objective: 'Ship platform' } });
  if (createdGoal.status !== 'committed') throw new Error(`AD07 Goal creation failed: ${JSON.stringify(createdGoal)}`);

  const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, queryJobId: 'q1' };
  const queryRunRef: QueryRunRef = { ...queryJobRef, aggregateType: 'QueryRun', runId: 'qr1' };
  const roleBinding: RoleBindingRefV1 = { schemaVersion: 1, bindingId: 'ad07-binding', templateId: 'builder',
    templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
  // AD07's expected tool list is derived, never hard-coded: the accepted Query
  // grant is Host ceiling ∩ Role ceiling ∩ read-only Query ceiling (spec §4.4).
  const hostCeiling = ['read', 'look_graph', 'find_graph', 'send'];
  const roleCeiling = ['read', 'look_graph', 'find_graph', 'query_task_graph'];
  const queryCeiling = ['read', 'look_graph', 'find_graph', 'send_session_message'];
  const intersection = hostCeiling.filter(tool => roleCeiling.includes(tool) && queryCeiling.includes(tool));
  const runtimeBudget: RuntimeBudget = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
    maxRequests: 4, maxToolCalls: 8, timeoutMs: null, perResponseTokens: 512 };
  const hostTemplate = { templateId: 'builder', revision: '1', digest: HOST_TEMPLATE_DIGEST };

  const bodies = new RawArtifactBodyStore();
  let eventSeq = 0;
  const now = () => AT;
  const eventId = () => `ad07-event-${++eventSeq}`;
  const roles = createRoleConfigurationService({ records: base.records, now, eventId });
  const authorizeConfiguration: AuthorizeQueryConfiguration = async () => ({ status: 'ready', value: {
    configurationRevision: 'ad07-host@1', permissions: { tools: hostCeiling, writeScope: [] }, hostTemplate, budget: runtimeBudget } });
  const execution = createQueryExecution({ records: base.records, roles, bodies, authorizeConfiguration, now, eventId });
  const queryJobs = createQueryJobService({ records: base.records, now, eventId,
    execution: { claimQuery: execution.claimQuery, readQueryAnswer: execution.readQueryAnswer } });

  const intent: QueryJobIntentV1 = { schemaVersion: 1, intentId: 'q1', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
    goalId: GOAL_REF.goalId, question: 'What is the current progress?', focusTaskRefs: [],
    budget: { maxTokens: 4096, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: 'ad07-corr',
    execution: { kind: 'initial_coordination', roleBinding, runtimeBudget } };
  const submitted = await queryJobs.submitQueryJob(myCtx, { input: { queryJobId: 'q1', runId: 'qr1', intent },
    meta: { requestId: 'ad07-submit', expected: [{ ref: PROJECT_REF, revision: 1 }, { ref: WORKSPACE_REF, revision: 7 },
      { ref: GOAL_REF, revision: 1 }, { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 }] } });
  if (submitted.status !== 'committed') throw new Error(`AD07 submit failed: ${JSON.stringify(submitted)}`);

  const admitted = await base.sessionsPort.admitSessionCreation(myCtx, { meta: { requestId: 'ad07-admit-session', expected: [] },
    input: { workspace: SCOPE, kernelStore: { adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store' },
      role: { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' }, recommendedRefs: [], initialLinks: [] } });
  if (admitted.status !== 'committed') throw new Error(`AD07 Session admission failed: ${JSON.stringify(admitted)}`);
  const sessionRef: SessionRef = { projectId: admitted.value.action.plannedSessionRef.projectId,
    sessionId: admitted.value.action.plannedSessionRef.sessionId };
  const registered = await base.sessionsPort.recordSessionCreated(myCtx, { meta: { requestId: 'ad07-register-session', expected: [] },
    input: { operationRef: admitted.value.ref, sessionRef, adapterId: 'r4c-claim-kernel',
      kernelSessionId: 'ad07-kernel-session', historyCursor: null, observedAt: AT } });
  if (registered.status !== 'committed') throw new Error(`AD07 Session registration failed: ${JSON.stringify(registered)}`);

  const sessionCard = await base.sessionsPort.readSession(myCtx, sessionRef);
  if (sessionCard.status !== 'ready') throw new Error(`AD07 Session read failed: ${JSON.stringify(sessionCard)}`);
  const sessionPinRef = { aggregateType: 'Session' as const, projectId: PROJECT_ID, sessionId: sessionRef.sessionId };
  const claimed = await execution.claimQuery(myCtx, { input: { queryRunRef, sessionRef },
    meta: { requestId: 'ad07-claim', expected: [
      { ref: queryJobRef, revision: 1 }, { ref: queryRunRef, revision: 1 },
      { ref: sessionPinRef, revision: sessionCard.value.record.revision },
    ] } });
  if (claimed.status !== 'committed') throw new Error(`AD07 claim failed: ${JSON.stringify(claimed)}`);

  // A delegating wrapper records the REAL bind result so AD07 can assert it.
  let capturedBind: Awaited<ReturnType<QueryExecutionPort['bindPreparedQuery']>> | undefined;
  const wrappedExecution: QueryExecutionPort = { ...execution,
    async bindPreparedQuery(ctx, request) {
      const result = await execution.bindPreparedQuery(ctx, request);
      capturedBind = result;
      return result;
    } };
  const real = await prepareQueryForReal({ records: base.records, ctx: myCtx }, {
    bodies, queryRunRef, queryExecution: wrappedExecution, now, requestId: 'ad07-prepare',
    host: preparationHost({ configurationRevision: 'ad07-host@1',
      permissions: { tools: intersection, writeScope: [] }, hostTemplate, budget: runtimeBudget }),
  });
  if (capturedBind === undefined) throw new Error('AD07 real Query preparation did not bind');
  return {
    manifest: real.manifest, hostCeiling, roleCeiling, queryCeiling,
    bind: async () => capturedBind!,
    close: () => base.close(),
  };
}
