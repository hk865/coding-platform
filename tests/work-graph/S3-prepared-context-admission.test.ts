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
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { VersionPin, SessionRef } from '../../src/contracts/core/identity.js';
import type { RoleConfigurationRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RunRef, RunSnapshot, TaskBudgetV1 } from '../../src/contracts/dispatch.js';
import type { GoalRef, ProjectSnapshot, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type { PreparedQueryExecution, PreparedQueryManifestV1, PreparedTaskExecution, PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { RoleBindingRefV1 } from '../../src/contracts/dispatch.js';
import type { RoleSpecResolutionV1 } from '../../src/contracts/role-spec-materials.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';
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
import { QUERY_MANIFEST_CONTENT_TYPE } from '../../src/contracts/no-progress.js';
import { QUERY_CONTEXT_PRELUDE } from '../../src/core/agent-runtime/context-assembler.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import type {
  AuthorizeConfiguration, ExecutionEntryDependencies, ExecutionEntryPort, TaskEntryPermit,
} from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { AuthorizeQueryConfiguration, QueryExecutionPort } from '../../src/core/work-graph/queries/contracts.js';
import type { RoleBindingFactsPort } from '../../src/core/work-graph/model/configuration-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import {
  createTaskClaimFixture, type ClaimFixtureKind, type TaskClaimFixture,
} from '../helpers/task-claim-fixture.js';

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
  pin(): Promise<VersionPin>;
  prepare(options?: PrepareOptions): Promise<PreparedTaskExecution>;
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
  const base = await createTaskClaimFixture(kind, EXECUTION_ENTRY_RECORD_SCHEMAS);
  const records = base.records;
  const myCtx = ctxFor(PROJECT_ID, WORKSPACE_ID);

  // The §5.1 Workspace is seeded at revision 7 (AD08 moves it to 8); Project p is
  // the smallest trusted scope the real Goal/Plan/Session owners need.
  const project: ProjectSnapshot = { ref: PROJECT_REF, revision: 1 };
  const workspace: WorkspaceSnapshot = { ref: WORKSPACE_REF, revision: 7 };
  const seeded = await base.commitRaw(
    [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspace)],
    [{ refKey: canonicalRefKey(PROJECT_REF), expectedRevision: null },
      { refKey: canonicalRefKey(WORKSPACE_REF), expectedRevision: null }]);
  if (seeded.status !== 'committed') throw new Error(`AD scope seed failed: ${JSON.stringify(seeded)}`);

  // Trusted governance for project p: a 'static' verification-kind policy and a baseline.
  const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId: PROJECT_ID, policyId: 's3-policy', revision: 1 };
  const baselineRef = { aggregateType: 'ArchitectureBaselineRevision' as const, projectId: PROJECT_ID, baselineId: 's3-baseline', revision: 1 };
  const policyFixture = { schemaVersion: 1, identity: { policyId: 's3-policy' }, revision: 1,
    content: { schemaVersion: 1, requirementKinds: ['static'], minimumRequiredRequirementsPerObligation: 1 } };
  const baselineFixture = { schemaVersion: 1, identity: { baselineId: 's3-baseline' }, revision: 1,
    content: { schemaVersion: 1, description: 'S3 admission baseline', constraints: [] } };
  const digest = (value: JsonValue) => sha256Hex(canonicalJson(value));
  const activePolicyRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: PROJECT_ID };
  const activeBaselineRef = { aggregateType: 'ProjectArchitectureBaselineActive' as const, projectId: PROJECT_ID };
  const governance = [
    { ref: policyRef, revision: 1, schemaVersion: 1, policyId: policyRef.policyId, contentRevision: 1,
      contentDigest: digest(policyFixture as unknown as JsonValue), content: policyFixture.content },
    { ref: baselineRef, revision: 1, schemaVersion: 1, baselineId: baselineRef.baselineId,
      contentRevision: 1, contentDigest: digest(baselineFixture as unknown as JsonValue), content: baselineFixture.content },
    { ref: activePolicyRef, projectId: PROJECT_ID, revision: 1, activeRevision: policyRef },
    { ref: activeBaselineRef, projectId: PROJECT_ID, revision: 1, activeRevision: baselineRef },
  ];
  const governanceSeed = await base.commitRaw(governance.map(snapshot => ({
    refKey: key(snapshot.ref), schemaId: `${snapshot.ref.aggregateType}Snapshot@1`,
    revision: snapshot.revision, json: JSON.stringify(snapshot),
  })));
  if (governanceSeed.status !== 'committed') throw new Error(`AD governance seed failed: ${JSON.stringify(governanceSeed)}`);

  const createdGoal = await base.goals.createGoal(myCtx, { meta: {
    requestId: 'ad-create-goal',
    expected: [{ ref: PROJECT_REF, revision: 1 }, { ref: WORKSPACE_REF, revision: 7 }] },
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

  // One Run for the upstream task tA: the provenance owner of the legacy body.
  const runARef: RunRef = { aggregateType: 'Run', projectId: PROJECT_ID, goalId: GOAL_REF.goalId, runId: 'runA' };
  const runA: RunSnapshot = { ref: runARef, revision: 1, schemaVersion: 1, task: TA,
    attemptId: 'attemptA', planRef: PLAN_REF, roleBinding: base.roleBinding, budget: base.budget,
    workspaceSnapshot: { workspaceId: WORKSPACE_ID, revision: 7 }, status: 'ended', outcome: 'completed',
    exitCode: 0, lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '', envelope: null,
    startedAt: null, endedAt: null };
  const runASeed = await base.commitRaw([{ refKey: key(runARef), schemaId: 'RunSnapshot@1', revision: 1, json: JSON.stringify(runA) }]);
  if (runASeed.status !== 'committed') throw new Error(`AD runA seed failed: ${JSON.stringify(runASeed)}`);

  const bodies = new RawArtifactBodyStore();
  const storedOldA = await bodies.put({ body: 'old-A', contentType: 'text/plain',
    sourceRefs: [{ kind: 'artifact', refId: 'old-A', revision: '1' }], origin: { kind: 'run', owner: runARef }, requestedAt: AT });
  if (storedOldA.status !== 'ready') throw new Error(`AD legacy body store failed: ${JSON.stringify(storedOldA)}`);

  // A real mapped Session for the §5.1 claim.
  const roleRef: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
  const admitted = await base.sessionsPort.admitSessionCreation(myCtx, { meta: { requestId: 'ad-admit-session', expected: [] },
    input: { workspace: SCOPE, kernelStore: { adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store' },
      role: roleRef, recommendedRefs: [], initialLinks: [] } });
  if (admitted.status !== 'committed') throw new Error(`AD Session admission failed: ${JSON.stringify(admitted)}`);
  const sessionRef: SessionRef = { projectId: admitted.value.action.plannedSessionRef.projectId,
    sessionId: admitted.value.action.plannedSessionRef.sessionId };
  const registered = await base.sessionsPort.recordSessionCreated(myCtx, { meta: { requestId: 'ad-register-session', expected: [] },
    input: { operationRef: admitted.value.ref, sessionRef, adapterId: 'r4c-claim-kernel',
      kernelSessionId: 'ad-kernel-session-b', historyCursor: null, observedAt: AT } });
  if (registered.status !== 'committed') throw new Error(`AD Session registration failed: ${JSON.stringify(registered)}`);
  const sessionCard = await base.sessionsPort.readSession(myCtx, sessionRef);
  if (sessionCard.status !== 'ready') throw new Error(`AD Session read failed: ${JSON.stringify(sessionCard)}`);

  const goalRead = await base.plans.queryGoal(myCtx, GOAL_REF);
  if (goalRead.status !== 'ready') throw new Error(`AD Goal read failed: ${JSON.stringify(goalRead)}`);

  let eventSeq = 0;
  const now = () => AT;
  const eventId = () => `ad-event-${++eventSeq}`;
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
    { ref: { aggregateType: 'Session', projectId: PROJECT_ID, sessionId: sessionRef.sessionId }, revision: sessionCard.value.record.revision },
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

  const rolesForManifest = createRoleConfigurationService({ records, now, eventId });

  async function readRun(): Promise<RunSnapshot> {
    const read = await createRunStateReader({ records }).readExecution(myCtx, runB);
    if (read.status !== 'ready') throw new Error(`AD Run read failed: ${JSON.stringify(read)}`);
    return read.value.run;
  }

  async function pin(): Promise<VersionPin> {
    const run = await readRun();
    return { ref: runB, revision: run.revision };
  }

  async function prepare(options: PrepareOptions = {}): Promise<PreparedTaskExecution> {
    const target = options.claim ?? claim;
    const input = options.input ?? workInput('R', 'G', 'T');
    const inputDigest = options.inputDigest ?? artifactBodyDigest(input);
    const binding = options.binding === undefined
      ? makeBinding([selectedOldA(runARef), missingEdge()], [workspaceSource(options.workspaceRevision ?? 7)], input)
      : options.binding;
    const selectedTaskInputs = options.selectedTaskInputs ?? [{ requirementId: 'legacy-old-a', ref: OLD_A }];
    const workspaceRevision = options.workspaceRevision ?? 7;
    const roleFacts = await rolesForManifest.resolveRoleBindingFacts(myCtx, {
      roleBinding: base.roleBinding, declaredPermissions: HOST_PERMISSIONS });
    if (roleFacts.result.status !== 'ready') throw new Error('AD real role fixture could not resolve');
    const role = roleFacts.result.value;
    const workspaceSnapshot = { workspaceId: WORKSPACE_ID, revision: workspaceRevision };
    const manifest: PreparedTaskManifestV1 = {
      schemaVersion: 1, kind: 'task_execution', claim: target, role, hostTemplate: HOST_TEMPLATE,
      roleBinding: base.roleBinding, hostConfigurationRevision: HOST_CONFIG_REVISION,
      sessionRole: roleRef, workspaceSnapshot, permissions: HOST_PERMISSIONS, budget: base.budget,
      selectedTaskInputs, materialBasis: null, materialAccessRefs: [], additionalMaterialRefs: [], deliveryRefs: [],
      sourceRefs: [{ kind: 'workspace', refId: WORKSPACE_ID, revision: String(workspaceRevision) }],
      ...(binding === null ? {} : { contextAssembly: binding }), input, inputDigest,
    };
    const manifestJson = JSON.stringify(manifest);
    const stored = await bodies.put({ body: manifestJson,
      contentType: 'application/vnd.coding-platform.task-execution-manifest+json;version=1',
      sourceRefs: [{ kind: 'workspace', refId: WORKSPACE_ID, revision: String(workspaceRevision) }],
      origin: { kind: 'run', owner: target.runRef }, requestedAt: now() });
    if (stored.status !== 'ready') throw new Error(`AD manifest store failed: ${JSON.stringify(stored)}`);
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
    goalRevision: goalRead.value.goal.revision, sessionRef, sessionRevision: sessionCard.value.record.revision,
    commitCount: () => commitCount, bodyReads: () => bodyReads, resolverCalls: () => resolverCalls, readRun, pin, prepare,
    close: () => base.close(),
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

  it('AD03: the same requestId with another manifest is an idempotency conflict and commits nothing', async () => {
    const fixture = await open(kind);
    const first = await fixture.prepare({ input: workInput('R', 'G', 'T') });
    const pin = await fixture.pin();
    expect(await authorize(fixture, first, 'ad03', [pin])).toMatchObject({ status: 'committed', replayed: false });
    const commitsBefore = fixture.commitCount();
    const second = await fixture.prepare({ input: workInput('R', 'G', 'T2') });
    const conflict = await authorize(fixture, second, 'ad03', [pin]);
    expect(conflict).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect(fixture.commitCount()).toBe(commitsBefore);
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

  it('AD05: an old manifest without contextAssembly authorizes as before and is not migrated', async () => {
    const fixture = await open(kind);
    const prepared = await fixture.prepare({ binding: null, selectedTaskInputs: [] });
    const result = await authorize(fixture, prepared, 'ad05', [await fixture.pin()]);
    expect(result).toMatchObject({ status: 'committed', replayed: false });
    const stored = await fixture.bodies.read(prepared.envelope.bundleRef);
    expect(stored.status).toBe('ready');
    if (stored.status !== 'ready') throw new Error('AD05 manifest body required');
    expect(stored.value.body.includes('"contextAssembly"')).toBe(false);
  });

  it('AD06: a revoked Run re-authorizes only with the fixed binding; another binding is invalid and the original is kept', async () => {
    const fixture = await open(kind);
    const prepared = await fixture.prepare();
    const pin = await fixture.pin();
    expect(await authorize(fixture, prepared, 'ad06-first', [pin])).toMatchObject({ status: 'committed', replayed: false });
    const before = await fixture.readRun();
    const fixedBinding = before.inputBinding;
    expect(fixedBinding).toBeDefined();
    // RUN-16 (proven not entered) revokes the V2 binding in place; the Run stays `starting`.
    const revoked: RunSnapshot = { ...before, revision: before.revision + 1,
      executionAuthorization: { ...(before.executionAuthorization as Record<string, unknown>), phase: 'revoked' } as never };
    const committedRevoke = await fixture.base.commitRaw([{ refKey: key(before.ref), schemaId: 'RunSnapshot@1',
      revision: revoked.revision, json: JSON.stringify(revoked) }], [{ refKey: key(before.ref), expectedRevision: before.revision }]);
    expect(committedRevoke).toMatchObject({ status: 'committed' });
    const changed = await fixture.prepare({ claim: prepared.claim, input: workInput('R', 'G', 'CHANGED') });
    const result = await authorize(fixture, changed, 'ad06-second', [await fixture.pin()]);
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    const after = await fixture.readRun();
    expect(after.inputBinding).toEqual(fixedBinding);
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
    const prepared = await fixture.prepare({ workspaceRevision: 7 });
    // The assembled binding named Workspace@7; the record now moves to @8.
    const current = await fixture.base.records.readMany([canonicalRefKey(WORKSPACE_REF)]);
    if (current.status !== 'ready') throw new Error('AD08 workspace read failed');
    const record = current.value.records.find(candidate => candidate.refKey === canonicalRefKey(WORKSPACE_REF));
    if (record === undefined) throw new Error('AD08 workspace record absent');
    const moved = await fixture.base.commitRaw([{ refKey: canonicalRefKey(WORKSPACE_REF), schemaId: 'WorkspaceSnapshot@1',
      revision: 8, json: JSON.stringify({ ref: WORKSPACE_REF, revision: 8 }) }],
    [{ refKey: canonicalRefKey(WORKSPACE_REF), expectedRevision: record.revision }]);
    expect(moved).toMatchObject({ status: 'committed' });
    const runBefore = await fixture.readRun();
    const sessionBefore = await fixture.base.sessionsPort.readSession(fixture.ctx, fixture.sessionRef);
    if (sessionBefore.status !== 'ready') throw new Error('AD08 Session read failed');
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

  const facts = await execution.readPreparationFacts(myCtx, queryRunRef);
  if (facts.status !== 'ready') throw new Error(`AD07 preparation facts failed: ${JSON.stringify(facts)}`);
  const state = facts.value.record.run.run.executionState;
  if (state === undefined) throw new Error('AD07 QueryRun has no execution state');
  const input = `${QUERY_CONTEXT_PRELUDE}\n\n## Runtime context\nR\n\n## Goal\nQ`;
  const contextAssembly: ContextAssemblyBindingV1 = {
    schemaVersion: 1, formatVersion: 's3-context-v1', callKind: 'copy', duty: 'executor',
    residentBudgetBytes: 4096, residentBytes: 0, totalBytes: B(input),
    sections: requiredSections(input), sources: [], inputSelections: [], extensions: emptyExtensions(),
  };
  const manifest: PreparedQueryManifestV1 = {
    schemaVersion: 1, kind: 'query_execution', queryRunRef, sessionRef: state.sessionRef,
    sessionGeneration: state.sessionGeneration, roleBinding: state.roleBinding, sessionRole: state.role,
    role: state.roleResolution as Exclude<RoleSpecResolutionV1, { status: 'inadmissible' }>,
    hostTemplate, hostConfigurationRevision: 'ad07-host@1', goal: { ref: facts.value.goal.ref, revision: facts.value.goal.revision },
    workspace: { ref: facts.value.workspace.ref, revision: facts.value.workspace.revision },
    focusPlan: null, permissions: { tools: intersection, writeScope: [] }, runtimeBudget,
    budget: { tokenBudget: 4096, deadline: null }, sourceRefs: [], contextAssembly,
    input, inputDigest: artifactBodyDigest(input),
  };
  const manifestJson = JSON.stringify(manifest);
  const stored = await bodies.put({ body: manifestJson, contentType: QUERY_MANIFEST_CONTENT_TYPE,
    sourceRefs: [{ kind: 'workspace', refId: WORKSPACE_ID, revision: '7' }], origin: { kind: 'run', owner: queryRunRef }, requestedAt: AT });
  if (stored.status !== 'ready') throw new Error(`AD07 manifest store failed: ${JSON.stringify(stored)}`);
  const prepared: PreparedQueryExecution = { queryRunRef, bundleRef: stored.value.ref, inputDigest: manifest.inputDigest };
  return {
    manifest, hostCeiling, roleCeiling, queryCeiling,
    bind: () => execution.bindPreparedQuery(myCtx, { input: { prepared }, meta: { requestId: 'ad07-bind', expected: [
      { ref: queryRunRef, revision: claimed.value.run.revision },
      { ref: { aggregateType: 'Session', projectId: PROJECT_ID, sessionId: sessionRef.sessionId }, revision: claimed.value.session.revision },
    ] } }),
    close: () => base.close(),
  };
}
