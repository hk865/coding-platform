/**
 * Slice 3, §5.3: the exact task-input owner (`TaskContextInputPort`) behaviour.
 *
 * IN01–IN19 run on BOTH real backends (`memory`, `sqlite`). Every case starts
 * from an independent §5.1 fixture built over the real RecordStore backends and
 * the real Goal/Plan services, and reaches the code under test ONLY through
 * `createTaskContextInputService(...)` and its `readTaskInputs` /
 * `readTaskInputPage`. The fixture's material port is the real
 * `createMaterialService`, wrapped only to count `openArtifact` calls; the owner
 * itself is never mocked.
 *
 * The case-specific facts the rows name (a legacy declaration projection, a
 * canonical owner that answers a different Run, a finalized PASS round chain, a
 * replied formal Message with a `decisionApplications` answer, a canonical
 * QueryRun) are produced by the REAL owners: claim/entry/Runtime for the Runs,
 * the evidence service for the round and the mailbox for the Message.
 * In part 1 every method throws `not implemented: …`, so the cases are RED by
 * design; this file must still compile and run all 32 cases.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type {
  RoleBindingRefV1, RunRef, SourceRefV1, TaskBudgetV1, TaskTriple,
} from '../../src/contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { GoalRef, WorkspaceRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type { QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import type {
  RegisteredCommandCheck, TrustedCheckConfiguration, VerificationRoundRef,
} from '../../src/contracts/verification.js';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { createRegisteredCheckRunner } from '../../src/core/agent-runtime/check-execution.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type {
  GoalRecordTransactionPort, RecordBackendSchemas,
} from '../../src/core/record-store/ports.js';
import { createSqliteRawArtifactStore } from '../../src/core/record-store/sqlite-body-store.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { createLineSettingsService } from '../../src/core/work-graph/configuration/line-settings-service.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import type { MaterialAuthorityReads } from '../../src/core/work-graph/materials/record-ports.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { MaterialPort } from '../../src/core/work-graph/model/material-contracts.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { EXECUTION_ENTRY_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/execution-entry-codecs.js';
import { LINE_SETTINGS_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/line-settings-codecs.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import { SESSION_MESSAGE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import {
  createTaskContextInputService, type TaskContextInputDependencies, type TaskContextInputPort,
} from '../../src/core/work-graph/tasks/context-input-service.js';
import { MODEL_REQUEST_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/model-request-codecs.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { SESSION_ANOMALY_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
import { B2_HOST } from '../helpers/B2-execution-fixture.js';
import { createS2BRuntimeSteps } from '../helpers/S2B-runtime-steps-fixture.js';
import { createTaskClaimFixture, type TaskClaimFixture } from '../helpers/task-claim-fixture.js';

// --------------------------------------------------------------------------
// §5.1 fixture constants
// --------------------------------------------------------------------------

const AT = '2026-09-24T00:00:00.000Z';
const PROJECT_ID = 'p';
const WORKSPACE_ID = 'w';
const OTHER_WORKSPACE_ID = 'w2';
const GOAL_ID = 'g';
const PLAN_ID = 'p1';
const STAGE_ID = 's';
const TASK_A = 'tA';
const TASK_B = 'tB';
const GATE_TASK = 'gate';
const OBLIGATION_ID = 'oB';
const CHECK_ID = 'vB';
const LEGACY_BODY = 'old-A';
const NEW_BODY = 'new-A';
const WORKSPACE_REVISION = 7;

const scope: WorkspaceScope = { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID };
const projectRef = { aggregateType: 'Project' as const, projectId: PROJECT_ID };
const workspaceRef: WorkspaceRef = { aggregateType: 'Workspace', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID };
const otherWorkspaceRef: WorkspaceRef = { aggregateType: 'Workspace', projectId: PROJECT_ID, workspaceId: OTHER_WORKSPACE_ID };
const goalRef: GoalRef = { aggregateType: 'Goal', projectId: PROJECT_ID, goalId: GOAL_ID };
const planRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: PROJECT_ID, planId: PLAN_ID };
const tA: TaskTriple = { projectId: PROJECT_ID, goalId: GOAL_ID, taskId: TASK_A };
const tB: TaskTriple = { projectId: PROJECT_ID, goalId: GOAL_ID, taskId: TASK_B };
const gateTask: TaskTriple = { projectId: PROJECT_ID, goalId: GOAL_ID, taskId: GATE_TASK };
const roleBinding: RoleBindingRefV1 = { schemaVersion: 1, bindingId: 's3-binding',
  templateId: 'builder', templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const budget: TaskBudgetV1 = { tokenBudget: 100000, deadline: null };
const artifactSource: SourceRefV1 = { kind: 'workspace', refId: WORKSPACE_ID, revision: String(WORKSPACE_REVISION) };

const oldRef: ArtifactRef = { kind: 'artifact', contentType: 'text/plain',
  digest: sha256Hex(LEGACY_BODY), sizeBytes: 5, source: artifactSource };
const newRef: ArtifactRef = { kind: 'artifact', contentType: 'text/plain',
  digest: sha256Hex(NEW_BODY), sizeBytes: 5, source: artifactSource };

const artifactEdge = { kind: 'artifact' as const, label: 'A.out' };
const edgeDeclarationId = (
  consumerTaskId: string, dependsOnId: string, requires: { kind: string; label: string },
): string => 'edge:' + sha256Hex(canonicalJson({
  planRef, consumerTaskId, dependsOnId, requires,
} as unknown as JsonValue));

const candidateKey = (source: unknown): string => sha256Hex(canonicalJson(source as JsonValue));

/** The registered runtime budget the canonical Query is submitted under (IN19). */
const queryRuntimeBudget: RuntimeBudget = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
  maxRequests: 1, maxToolCalls: null, timeoutMs: null, perResponseTokens: 4096 };

/**
 * IN14: the public Session creation route derives
 * `session-<sha256(canonicalJson({actor,projectId,requestId}))>`; this is that
 * literal for actor `{kind:'human',id:'s3-operator'}`, project `p` and
 * requestId `s3-session-sa`. Written by hand (the input JSON is in the comment).
 */
const DECISION_SENDER_SESSION_ID =
  'session-20b96b90c57b8de3f90f3c702330b4a1eca98d75a201f195e66b99a6b74f2a97';
/**
 * IN14: a first claim occupies the fresh Session (revision 1) and its
 * generation is `revision + 1`; the mailbox's sender identity carries that
 * generation.
 */
const DECISION_SENDER_GENERATION = 2;
const DECISION_SEND_REQUEST_ID = 's3-send-decision';
/**
 * IN14: the mailbox derives
 * `session-message-<sha256(canonicalJson({projectId,workspaceId,sender,requestId}))>`.
 * The hand-worked input is project `p`, workspace `w`, requestId
 * `s3-send-decision` and sender
 * `{kind:'work_run',sessionRef:{projectId:'p',sessionId:DECISION_SENDER_SESSION_ID},runRef:runA,generation:2}`.
 * This literal is the one the owner must post.
 */
const DECISION_MESSAGE_ID =
  'session-message-66ca4e44a5c1869536b0cbbee954fd534c8e82e6650e79b1628f69464acca4a4';


// --------------------------------------------------------------------------
// Fixture types
// --------------------------------------------------------------------------

type Records = GoalRecordTransactionPort & RecordLookupPort;

type RecordSpy = { readMany: number; lookup: number; lookupCommit: number; commit: number; eventAt: number };
type MaterialSpy = { openArtifactCalls: number };
type BodySpy = { read: number };

type S3InputFixtureOptions = {
  /** Store the legacy body at all; `false` models a missing body (IN06). */
  storeLegacyBody?: boolean;
  /** Owner Run the legacy body is stored under (IN05). */
  ownerRun?: 'runA' | 'runA2';
  /**
   * IN05: the canonical-owner load for the stored body's owner answers with this
   * OTHER Run's canonical snapshot, so the ref check must reject.
   */
  ownerLoadReturnsRun?: 'runA';
  /** Provenance of the stored legacy body (IN17). */
  legacyOrigin?: 'run' | 'platform_operation';
  /**
   * Legacy declarations: `none` = only r1, `old` = r1+r2 both old-A (IN09),
   * `new` = r1 old-A, r2 new-A (IN10).
   */
  r2?: 'none' | 'old' | 'new';
  /** Seed the real finalized VerificationRound chain for the gate (IN11). */
  seedRounds?: 'pass';
  /** Provide the `decisionApplications` dependency answering "not applied" (IN14). */
  decisionApplications?: boolean;
  /** Create the canonical QueryJob/QueryRun through the real query owner (IN19). */
  seedQuery?: boolean;
};

type S3InputFixture = {
  kind: 'memory' | 'sqlite';
  ctx: CoreCallContext;
  service: TaskContextInputPort;
  records: Records;
  recordSpy: RecordSpy;
  materialsSpy: MaterialSpy;
  bodiesSpy: BodySpy;
  materials: MaterialPort;
  bodies: RawArtifactStorePort;
  tA: TaskTriple;
  tB: TaskTriple;
  gateTask: TaskTriple;
  planRef: PlanRevisionRef;
  goalRef: GoalRef;
  runA: RunRef;
  runB: RunRef;
  oldRef: ArtifactRef;
  newRef: ArtifactRef;
  edgeArtifactDeclarationId: string;
  edgeGateDeclarationId: string;
  edgeEnvironmentDeclarationId: string;
  edgeDecisionDeclarationId: string;
  legacyDeclarationId: string;
  secondLegacyDeclarationId: string;
  /** The real finalized chain head seeded by `seedRounds` (IN11), else null. */
  gateRoundPassRef: VerificationRoundRef | null;
  /** The real report Artifact of the finalized gate check (IN11), else null. */
  gateReportRef: ArtifactRef | null;
  /** The Message id the real send posted (IN14). */
  decisionMessageId: string;
  /** The canonical Query seeded by `seedQuery` (IN19), else null. */
  query: { jobRef: QueryJobRef; runRef: QueryRunRef } | null;
  /** Tamper what a body read returns (IN07). */
  tamperBody(value: string | null): void;
  /** The Message status read through the real mailbox (IN14). */
  messageStatus(): Promise<string | null>;
  /** The stored revisions of the canonical QueryJob/QueryRun (IN19), or null. */
  queryVersions(): Promise<{ job: number; run: number } | null>;
  planPhase(taskId: string): Promise<string>;
  workCtx(run: RunRef): CoreCallContext;
  close(): Promise<void>;
};

// --------------------------------------------------------------------------
// Fixture construction
// --------------------------------------------------------------------------

const fixtures: S3InputFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

async function openFixture(
  kind: 'memory' | 'sqlite', options: S3InputFixtureOptions = {},
): Promise<S3InputFixture> {
  const fixture = await createInputFixture(kind, options);
  fixtures.push(fixture);
  return fixture;
}

const INPUT_EXTRA_SCHEMAS: RecordBackendSchemas = {
  records: [...EVIDENCE_RECORD_SCHEMAS.records, ...EXECUTION_ENTRY_RECORD_SCHEMAS.records,
    ...MODEL_REQUEST_RECORD_SCHEMAS.records, ...CONTROL_RECORD_SCHEMAS.records,
    ...SESSION_MESSAGE_RECORD_SCHEMAS.records, ...QUERY_JOB_RECORD_SCHEMAS.records,
    ...LINE_SETTINGS_RECORD_SCHEMAS.records, ...SESSION_ANOMALY_RECORD_SCHEMAS.records],
  events: [...EVIDENCE_RECORD_SCHEMAS.events, ...EXECUTION_ENTRY_RECORD_SCHEMAS.events,
    ...MODEL_REQUEST_RECORD_SCHEMAS.events, ...CONTROL_RECORD_SCHEMAS.events,
    ...SESSION_MESSAGE_RECORD_SCHEMAS.events, ...QUERY_JOB_RECORD_SCHEMAS.events,
    ...LINE_SETTINGS_RECORD_SCHEMAS.events, ...SESSION_ANOMALY_RECORD_SCHEMAS.events],
  lookups: [...(EVIDENCE_RECORD_SCHEMAS.lookups ?? []), ...(EXECUTION_ENTRY_RECORD_SCHEMAS.lookups ?? []),
    ...(MODEL_REQUEST_RECORD_SCHEMAS.lookups ?? []), ...(CONTROL_RECORD_SCHEMAS.lookups ?? []),
    ...(SESSION_MESSAGE_RECORD_SCHEMAS.lookups ?? []), ...(QUERY_JOB_RECORD_SCHEMAS.lookups ?? []),
    ...(LINE_SETTINGS_RECORD_SCHEMAS.lookups ?? []), ...(SESSION_ANOMALY_RECORD_SCHEMAS.lookups ?? [])],
};

async function createInputFixture(
  kind: 'memory' | 'sqlite', options: S3InputFixtureOptions = {},
): Promise<S3InputFixture> {
  const base = await createTaskClaimFixture(kind, INPUT_EXTRA_SCHEMAS);
  const backend = base;
  const directory = base.directory;
  const rawBodies: RawArtifactStorePort & { close?(): Promise<void> } = kind === 'memory'
    ? new RawArtifactBodyStore()
    : createSqliteRawArtifactStore(join(directory, 'bodies.sqlite'));

  const actor = { kind: 'human' as const, id: 's3-operator' };
  const ctx: CoreCallContext = { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, actor },
    signal: new AbortController().signal };
  let sequence = 0;
  const eventId = () => `s3-event-${++sequence}`;

  // ---- the §5.1 trusted scope through the public bootstrap owners ----------
  // W3-02: the Project and both Workspaces are registered publicly; no raw
  // snapshot is committed. The Project is @1 from `createProject`; each
  // Workspace is @1 from `registerWorkspace` and then taken to @7 by six real
  // public `setLinePins` changes (the same path AD08/W2-15 uses).
  const bootstrap = createProjectBootstrapServices({ records: backend.records, now: () => AT, eventId });
  const createdProject = await bootstrap.projects.createProject(ctx, {
    input: { projectId: PROJECT_ID },
    meta: { requestId: 's3-create-project', expected: [{ ref: projectRef, revision: 0 }] },
  });
  if (createdProject.status !== 'committed') {
    throw new Error(`S3 fixture Project creation failed: ${JSON.stringify(createdProject)}`);
  }
  const registeredWorkspace = await bootstrap.projects.registerWorkspace(ctx, {
    input: { workspace: scope },
    meta: { requestId: 's3-register-workspace', expected: [
      { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] },
  });
  if (registeredWorkspace.status !== 'committed') {
    throw new Error(`S3 fixture Workspace registration failed: ${JSON.stringify(registeredWorkspace)}`);
  }
  const otherScope: WorkspaceScope = { projectId: PROJECT_ID, workspaceId: OTHER_WORKSPACE_ID };
  const otherCtx: CoreCallContext = { projectId: PROJECT_ID, workspaceId: OTHER_WORKSPACE_ID,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: PROJECT_ID, workspaceId: OTHER_WORKSPACE_ID, actor },
    signal: new AbortController().signal };
  const registeredOther = await bootstrap.projects.registerWorkspace(otherCtx, {
    input: { workspace: otherScope },
    meta: { requestId: 's3-register-other-workspace', expected: [
      { ref: projectRef, revision: 1 }, { ref: otherWorkspaceRef, revision: 0 }] },
  });
  if (registeredOther.status !== 'committed') {
    throw new Error(`S3 fixture other Workspace registration failed: ${JSON.stringify(registeredOther)}`);
  }

  // ---- real Sessions through the public creation route (IN14) --------------
  const kernelStores = await createKernelStoreRegistry({ entries: [
    { adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store', workspace: scope,
      databasePath: join(directory, 'kernel.sqlite') },
    { adapterId: 'r4c-claim-other-kernel', storeKey: 'r4c-claim-other-kernel-store', workspace: otherScope,
      databasePath: join(directory, 'kernel-other.sqlite') },
  ] });
  const sessionOperations = createSessionOperations({ sessions: base.sessionsPort, kernelStores });
  const sessionRole = { kind: 'legacy_template' as const, templateId: 'builder', templateRevision: '1' };
  async function createFixtureSession(
    requestId: string, callCtx: CoreCallContext = ctx, workspace: WorkspaceScope = scope,
  ): Promise<{ ref: SessionRef; revision: number }> {
    const created = await sessionOperations.createSession(callCtx, {
      workspace, role: sessionRole, recommendedRefs: [], initialLinks: [],
      meta: { requestId, expected: [] } });
    if (created.status !== 'completed') throw new Error(`S3 fixture Session ${requestId} creation failed: ${JSON.stringify(created)}`);
    const stored = created.value.ref;
    // The mailbox input takes a plain SessionRef; the stored record carries the
    // aggregate tag.
    const ref: SessionRef = { projectId: stored.projectId, sessionId: stored.sessionId };
    const card = await base.sessionsPort.readSession(callCtx, ref);
    if (card.status !== 'ready') throw new Error(`S3 fixture Session ${requestId} read failed: ${JSON.stringify(card)}`);
    return { ref, revision: card.value.record.revision };
  }
  const sessionA = await createFixtureSession('s3-session-sa');
  const sessionB = await createFixtureSession('s3-session-sb');
  const otherSession = await createFixtureSession('s3-session-other', otherCtx, otherScope);
  if (sessionA.ref.sessionId !== DECISION_SENDER_SESSION_ID
    || sessionA.revision + 1 !== DECISION_SENDER_GENERATION) {
    throw new Error('S3 fixture Session derivation disagrees with the IN14 literal');
  }

  // Six real public Session-pin changes take each Workspace from its public
  // registration @1 to the @7 the rows pin (add and then remove one real
  // Session; the final table is empty and the revision is 7).
  const lineSettings = createLineSettingsService({ records: backend.records,
    sessionRead: base.sessionsPort.readSession, now: () => AT, operatorActor: actor });
  async function raiseWorkspace(
    callCtx: CoreCallContext, target: WorkspaceRef, session: SessionRef, requestPrefix: string,
  ): Promise<void> {
    for (let revision = 1; revision < WORKSPACE_REVISION; revision += 1) {
      const result = await lineSettings.setLinePins(callCtx, {
        input: { workspace: { projectId: target.projectId, workspaceId: target.workspaceId },
          add: revision % 2 === 1 ? [session] : [], remove: revision % 2 === 1 ? [] : [session] },
        meta: { requestId: `${requestPrefix}-${revision}`, expected: [{ ref: target, revision }] },
      });
      if (result.status !== 'committed') {
        throw new Error(`S3 fixture pin change ${requestPrefix}@${revision} failed: ${JSON.stringify(result)}`);
      }
    }
  }
  await raiseWorkspace(ctx, workspaceRef, sessionA.ref, 's3-pin-workspace');
  await raiseWorkspace(otherCtx, otherWorkspaceRef, otherSession.ref, 's3-pin-other-workspace');

  // ---- trusted governance through the public owners (IN11) ------------------
  const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId: PROJECT_ID,
    policyId: 's3-policy', revision: 1 };
  const activePolicyRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: PROJECT_ID };
  const policyContent = { schemaVersion: 1 as const, requirementKinds: ['static'],
    minimumRequiredRequirementsPerObligation: 1 };
  const installed = await bootstrap.completionPolicies.installCompletionPolicy(ctx, {
    input: { policyId: policyRef.policyId, contentRevision: 1, content: policyContent },
    meta: { requestId: 's3-install-policy', expected: [
      { ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }] },
  });
  if (installed.status !== 'committed') throw new Error(`S3 fixture policy install failed: ${JSON.stringify(installed)}`);
  const activated = await bootstrap.completionPolicies.activateCompletionPolicy(ctx, {
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } },
    meta: { requestId: 's3-activate-policy', expected: [
      { ref: projectRef, revision: 1 }, { ref: activePolicyRef, revision: 0 }] },
  });
  if (activated.status !== 'committed') throw new Error(`S3 fixture policy activation failed: ${JSON.stringify(activated)}`);
  const adoptedArchitecture = await createArchitectureCatalogService({ records: backend.records })
    .adoptInitialArchitecture(ctx, {
      input: { baselineId: 's3-baseline', description: 'S3 context-input fixture baseline', constraints: [],
        catalog: { requireDag: true, dependencies: [], modules: [{
          ref: { projectId: PROJECT_ID, moduleId: 's3-context-inputs' }, name: 'S3 context inputs',
          responsibility: 'S3 context-input fixture', paths: ['src/s3-context-inputs'], interfaces: [] }] } },
      meta: { requestId: 's3-adopt-architecture', expected: [
        { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: WORKSPACE_REVISION }] },
    });
  if (adoptedArchitecture.status !== 'committed') {
    throw new Error(`S3 fixture architecture adoption failed: ${JSON.stringify(adoptedArchitecture)}`);
  }

  // ---- Goal + accepted Plan through the real services -----------------------
  const goalsService = createGoalService({ records: backend.records, now: () => AT, eventId });
  const planMaterials: Pick<MaterialPort, 'openArtifact'> = {
    async openArtifact() {
      return { status: 'rejected' as const, code: 'unsupported' as const,
        reason: 'S3 fixture setup reads no artifact for a Plan' };
    },
  };
  const plans = createPlanService({ records: backend.records, materials: planMaterials, now: () => AT, eventId });

  const createdGoal = await goalsService.tasks.createGoal(ctx, { meta: {
    requestId: 's3-create-goal',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: WORKSPACE_REVISION }] },
    input: { goalId: GOAL_ID, workspace: scope, objective: 'Ship platform' } });
  if (createdGoal.status !== 'committed') throw new Error(`S3 fixture Goal creation failed: ${JSON.stringify(createdGoal)}`);

  const secondRef = options.r2 === 'new' ? newRef : oldRef;
  const inputRequirements = options.r2 === 'none'
    ? [{ requirementId: 'r1', consumerTaskId: TASK_B, kind: 'artifact' as const, artifactRef: oldRef }]
    : [
        { requirementId: 'r1', consumerTaskId: TASK_B, kind: 'artifact' as const, artifactRef: oldRef },
        { requirementId: 'r2', consumerTaskId: TASK_B, kind: 'artifact' as const, artifactRef: secondRef },
      ];
  const draft: PlanRevisionDraft = { schemaVersion: 2, planId: PLAN_ID, planRevision: 1, goalId: GOAL_ID,
    stages: [{ stageId: STAGE_ID, title: 'Main' }],
    tasks: [
      { taskId: TASK_A, stageId: STAGE_ID, title: 'A', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: STAGE_ID } },
      { taskId: TASK_B, stageId: STAGE_ID, title: 'B', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: STAGE_ID } },
      { taskId: GATE_TASK, title: 'Goal gate', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [
      { taskId: TASK_A, role: 'builder', instruction: 'Implement A' },
      { taskId: TASK_B, role: 'builder', instruction: 'Implement B' },
    ],
    obligations: [{ obligationId: OBLIGATION_ID, title: 'Deliver B', requirementLevel: 'required',
      taskIds: [TASK_A, TASK_B, GATE_TASK],
      verificationRequirements: [{ requirementId: CHECK_ID, requirementLevel: 'required', kind: 'static',
        description: 'node check-b.js' }] }],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [
      { taskId: TASK_B, dependsOnId: TASK_A, requires: artifactEdge },
      { taskId: TASK_B, dependsOnId: GATE_TASK, requires: { kind: 'gate-result', label: CHECK_ID } },
      { taskId: TASK_B, dependsOnId: TASK_A, requires: { kind: 'environment-revision', label: 'workspace' } },
      { taskId: TASK_B, dependsOnId: TASK_A, requires: { kind: 'decision', label: DECISION_MESSAGE_ID } },
    ] },
    inputRequirements };
  const proposed = await plans.proposePlan(ctx, { meta: { requestId: 's3-propose-plan',
    expected: [{ ref: goalRef, revision: 1 }] },
    input: { goalRef, basedOn: null, draft, reason: { text: 'Initial S3 input fixture plan', sources: [] } } });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
    throw new Error(`S3 fixture Plan proposal failed: ${JSON.stringify(proposed)}`);
  }
  const applied = await plans.applyPlanChange(ctx, { meta: { requestId: 's3-apply-plan',
    expected: [{ ref: goalRef, revision: 1 }] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`S3 fixture Plan adoption failed: ${JSON.stringify(applied)}`);
  const plan = applied.value;

  // ---- real claims (public TaskClaimPort), deterministic real Run ids ------
  const claimIds = ['runA', 'attempt-a', 'event-a', 'runB', 'attempt-b', 'event-b',
    'runA2', 'attempt-a2', 'event-a2'];
  let claimExtra = 0;
  const claimRoles = createRoleConfigurationService({ records: backend.records, now: () => AT, eventId });
  const claimService = createTaskClaimService({ records: backend.records, roles: claimRoles, now: () => AT,
    newId: () => claimIds.shift() ?? `s3-claim-id-${++claimExtra}` });
  const goalAtClaim = await plans.queryGoal(ctx, goalRef);
  if (goalAtClaim.status !== 'ready') throw new Error(`S3 fixture Goal read failed: ${JSON.stringify(goalAtClaim)}`);
  const goalRevision = goalAtClaim.value.goal.revision;
  async function claim(task: TaskTriple, sessionRef: SessionRef, sessionRevision: number, requestId: string) {
    const claimed = await claimService.claimTask(ctx, {
      input: { goalRef, planRef: plan.ref, taskId: task.taskId, sessionRef, roleBinding, budget },
      meta: { requestId, expected: [
        { ref: goalRef, revision: goalRevision },
        { ref: workspaceRef, revision: WORKSPACE_REVISION },
        { ref: plainSessionRefToAggregate(sessionRef), revision: sessionRevision },
      ] },
    });
    if (claimed.status !== 'committed') throw new Error(`S3 fixture claim ${task.taskId} failed: ${JSON.stringify(claimed)}`);
    return claimed.value;
  }
  const claimA = await claim(tA, sessionA.ref, sessionA.revision, 's3-claim-a');
  const claimB = await claim(tB, sessionB.ref, sessionB.revision, 's3-claim-b');
  const runA = claimA.runRef;
  const runB = claimB.runRef;
  if (runA.runId !== 'runA' || runB.runId !== 'runB' || claimA.generation !== DECISION_SENDER_GENERATION) {
    throw new Error('S3 fixture claim identity disagrees with the IN14 literal');
  }

  // ---- material writes through the real owner (W3-03) ----------------------
  // old-A/new-A are written by the real `materials.storeArtifact`: a Run context
  // and an execution origin for execution material, the Host context and a
  // platform origin for the platform-material case. The missing-body case writes
  // no old-A at all. The body refs stay the §5.1 literals above.
  const { authority: baseAuthority } = createMaterialRecordReaders(backend.records);
  const writeMaterials = createMaterialService({ bodies: rawBodies, authority: baseAuthority, now: () => AT });
  const workRunCtx = (run: RunRef): CoreCallContext => ({
    projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
    principal: { kind: 'work_run', runRef: run, roleBinding },
    materialReader: { kind: 'run', requester: run },
    signal: new AbortController().signal,
  });

  /**
   * One real verification world: a fresh root with the registered check-b.js
   * script, the real evidence owner and the real Host bindings the registered
   * check runner needs. `script` decides PASS (`process.exitCode` 0) or FAIL.
   */
  async function createCheckWorld(prefix: string, script: string): Promise<{
    evidence: ReturnType<typeof createEvidenceService>;
    workspaceHost: WorkspaceHostBindings;
    checkCtx: CoreCallContext;
  }> {
    const verificationRoot = join(directory, prefix);
    await mkdir(join(verificationRoot, 'src'), { recursive: true });
    await writeFile(join(verificationRoot, 'src', 'a.ts'), 'export const a = 1;\n');
    await writeFile(join(verificationRoot, 'check-b.js'), script);
    const checkHostActor = { kind: 'system' as const, id: 's3-check-host' };
    const checkDefinition = (checkId: string): RegisteredCommandCheck => ({
      checkId, kind: 'static', command: 'node check-b.js', cwd: '.', timeoutMs: 60_000, taskIds: 'all',
    });
    const configuration: TrustedCheckConfiguration = {
      configurationRevision: 's3-checks-config-1', workspace: workspaceRef, executor: checkHostActor,
      permissionRevision: 's3-permission-1', sourceAccess: 'verification_workspace',
      processAccess: 'all_except_denied', deniedPrefixes: ['node_modules'],
      checks: [checkDefinition(CHECK_ID)],
    };
    const workspaceHost: WorkspaceHostBindings = {
      async resolveRoot(requested) {
        if (requested.projectId !== PROJECT_ID || requested.workspaceId !== WORKSPACE_ID) {
          return { status: 'rejected', code: 'forbidden', reason: 'S3 fixture verification root is outside this workspace' };
        }
        return { status: 'ready', value: { root: verificationRoot, workspaceRevision: WORKSPACE_REVISION } };
      },
      async authorize(callCtx, requested) {
        if (callCtx.projectId !== PROJECT_ID || callCtx.workspaceId !== WORKSPACE_ID
          || requested.projectId !== PROJECT_ID || requested.workspaceId !== WORKSPACE_ID) {
          return { status: 'rejected', code: 'forbidden', reason: 'S3 fixture check Host is not bound to this workspace' };
        }
        return { status: 'ready', value: { subjectKey: 'host:s3-check-host',
          permissionRevision: 's3-permission-1', allowsRead: () => true } };
      },
    };
    const checkCtx: CoreCallContext = { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
      principal: { kind: 'host', actor: checkHostActor },
      materialReader: { kind: 'host', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, actor: checkHostActor },
      signal: new AbortController().signal };
    const evidenceMaterials = createMaterialService({ bodies: rawBodies, authority: baseAuthority, now: () => AT });
    let evidenceSeq = 0;
    const evidence = createEvidenceService({ records: backend.records, materials: evidenceMaterials,
      executions: createRunStateReader({ records: backend.records }), workspaceHost,
      source: new VerificationWorkspaceReader(), configuration, now: () => AT,
      newId: () => `s3-evidence-${++evidenceSeq}` });
    return { evidence, workspaceHost, checkCtx };
  }

  // ---- R-7 real Runtime entry/terminal for both Runs (IN14/IN11) ----------
  const runtimeBase: TaskClaimFixture = { ...base, ctx, scope, projectRef, workspaceRef, goalRef,
    planRef: plan.ref, plan, tasks: { first: tA, second: tB, gate: gateTask },
    sessions: { first: sessionA.ref, second: sessionB.ref }, roleBinding, budget,
    records: backend.records, plans, sessionsPort: base.sessionsPort, roleService: base.roleService,
    service: claimService };
  const runtimePermissions = { policyRevision: roleBinding.policyRevision,
    tools: ['read', 'send_session_message', 'respond_session_message'], writeScope: [] as string[] };
  const runtimeHost = { configurationRevision: 's3-runtime-config-1', permissions: runtimePermissions,
    hostTemplate: B2_HOST.hostTemplate };
  let runtimeSeq = 0;
  const runtimeSteps = await createS2BRuntimeSteps({ base: runtimeBase, bodies: rawBodies, ctx,
    directory, scope, now: () => AT, setClock: () => undefined, eventId,
    newId: () => `s3-runtime-${++runtimeSeq}`, consumerId: 'runtime-a', withMailbox: true,
    host: runtimeHost, workspaceRevision: WORKSPACE_REVISION });
  const runtimeMailbox = runtimeSteps.mailbox;
  if (runtimeMailbox === undefined) throw new Error('S3 fixture runtime mailbox is missing');
  const mailbox = runtimeMailbox;
  const handleA = await runtimeSteps.start(claimA, { at: AT, tools: runtimePermissions.tools,
    replies: [{ kind: 'text', text: 'S3 run A completed' }] });
  await Promise.race([handleA.entered, handleA.settled]);
  const sent = await mailbox.sendMessage(workRunCtx(runA), {
    input: { recipient: sessionB.ref, text: 'S3 decision request', intent: 'inquiry', needsReply: true },
    meta: { requestId: DECISION_SEND_REQUEST_ID, expected: [] } });
  if (sent.status !== 'committed') throw new Error(`S3 fixture decision send failed: ${JSON.stringify(sent)}`);
  // The literal is only the frozen Plan label and this check (R-8); the reply,
  // the version pin and the read use the ref the send returned.
  expect(sent.value.ref.messageId).toBe(DECISION_MESSAGE_ID);
  const messageRef: SessionMessageRef = sent.value.ref;
  const handleB = await runtimeSteps.start(claimB, { at: AT, tools: runtimePermissions.tools,
    replies: [{ kind: 'text', text: 'S3 run B completed' }] });
  await Promise.race([handleB.entered, handleB.settled]);
  const responded = await mailbox.respondMessage(workRunCtx(runB), {
    input: { messageRef, text: 'S3 decision reply' },
    meta: { requestId: 's3-respond-decision', expected: [{ ref: messageRef, revision: sent.value.revision }] } });
  if (responded.status !== 'committed' || responded.value.status !== 'responded') {
    throw new Error(`S3 fixture decision respond failed: ${JSON.stringify(responded)}`);
  }
  await runtimeSteps.finish(handleA, AT, 'completed');
  await runtimeSteps.finish(handleB, AT, 'completed');

  // ---- IN05's real second tA Run (W3-01) -----------------------------------
  // runA completed; a real registered-check round fails (check_failed), the
  // public requeue owner accepts it, the second claim carries the returned
  // requeueRef into runA2, and runA2 is really started and finished. Only IN05
  // asks for this owner; every other row keeps its single tA Run.
  async function makeRunA2(): Promise<RunRef> {
    const world = await createCheckWorld('verification-fail-root', 'process.exit(1);\n');
    const opened = await world.evidence.openVerification(world.checkCtx, { input: {
      subjectRunRef: runA, subject: tA, planRef: plan.ref },
      meta: { requestId: 's3-open-fail', expected: [] } });
    if (opened.status !== 'committed') throw new Error(`S3 fixture FAIL round open failed: ${JSON.stringify(opened)}`);
    const roundRef = opened.value.ref;
    const runner = createRegisteredCheckRunner({ evidence: world.evidence,
      workspaceHost: world.workspaceHost, kernel, now: () => AT });
    const ran = await runner.runRegisteredCheck(world.checkCtx, { input: { roundRef, checkId: CHECK_ID },
      meta: { requestId: 's3-run-fail', expected: [{ ref: roundRef, revision: opened.value.revision }] } });
    if (ran.status !== 'ready') throw new Error(`S3 fixture FAIL check run failed: ${JSON.stringify(ran)}`);
    const finalized = await world.evidence.finalizeChecks(world.checkCtx, { input: { roundRef },
      meta: { requestId: 's3-finalize-fail', expected: [{ ref: roundRef, revision: ran.value.revision }] } });
    if (finalized.status !== 'committed') throw new Error(`S3 fixture FAIL finalize failed: ${JSON.stringify(finalized)}`);
    if (finalized.value.outcome !== 'FAIL') {
      throw new Error(`S3 fixture FAIL round did not finalize FAIL: ${finalized.value.outcome}`);
    }
    const runRead = await createRunStateReader({ records: backend.records }).readExecution(ctx, runA);
    if (runRead.status !== 'ready') throw new Error(`S3 fixture FAIL Run read failed: ${JSON.stringify(runRead)}`);
    const goalBefore = await plans.queryGoal(ctx, goalRef);
    if (goalBefore.status !== 'ready') throw new Error(`S3 fixture Goal read failed: ${JSON.stringify(goalBefore)}`);
    const requeueService = createTaskRequeueService({ records: backend.records,
      reads: createRunStateReader({ records: backend.records }), workspaceHost: world.workspaceHost,
      source: new VerificationWorkspaceReader(), materials: writeMaterials,
      messages: mailbox,
      now: () => AT, eventId });
    const requeued = await requeueService.requeueTask(ctx, { input: { taskRef: tA, afterRunRef: runA,
      reason: 'S3 fixture: the selected Run check failed' }, meta: { requestId: 's3-requeue-a', expected: [
      { ref: goalRef, revision: goalBefore.value.goal.revision },
      { ref: runA, revision: runRead.value.run.revision },
    ] } });
    if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') {
      throw new Error(`S3 fixture requeue failed: ${JSON.stringify(requeued)}`);
    }
    const sessionA2 = await createFixtureSession('s3-session-sa2');
    const goalAfter = await plans.queryGoal(ctx, goalRef);
    if (goalAfter.status !== 'ready') throw new Error(`S3 fixture Goal read failed: ${JSON.stringify(goalAfter)}`);
    const claimed = await claimService.claimTask(ctx, { input: { goalRef, planRef: plan.ref, taskId: TASK_A,
      sessionRef: sessionA2.ref, roleBinding, budget: requeued.value.requeue.budget ?? budget,
      requeueRef: requeued.value.requeue.ref }, meta: { requestId: 's3-claim-a2', expected: [
      { ref: goalRef, revision: goalAfter.value.goal.revision },
      { ref: workspaceRef, revision: WORKSPACE_REVISION },
      { ref: plainSessionRefToAggregate(sessionA2.ref), revision: sessionA2.revision },
    ] } });
    if (claimed.status !== 'committed') throw new Error(`S3 fixture runA2 claim failed: ${JSON.stringify(claimed)}`);
    const handle = await runtimeSteps.start(claimed.value, { at: AT, tools: runtimePermissions.tools,
      replies: [{ kind: 'text', text: 'S3 run A2 completed' }] });
    await handle.entered;
    await runtimeSteps.finish(handle, AT, 'completed');
    return claimed.value.runRef;
  }
  const runA2 = options.ownerRun === 'runA2' ? await makeRunA2() : null;
  if (options.ownerRun === 'runA2' && (runA2 === null || runA2.runId !== 'runA2')) {
    throw new Error('S3 fixture runA2 identity is not the deterministic third claim id');
  }
  const bodyOwner: RunRef = runA2 ?? runA;

  // ---- old-A/new-A through the real storeArtifact (W3-03) ------------------
  if (options.storeLegacyBody !== false) {
    const stored = options.legacyOrigin === 'platform_operation'
      ? await writeMaterials.storeArtifact(ctx, { contentType: 'text/plain', body: LEGACY_BODY,
          sources: [artifactSource], origin: { kind: 'platform_operation', projectId: PROJECT_ID,
            workspaceId: WORKSPACE_ID, requestId: 's3-material-request', actor } })
      : await writeMaterials.storeArtifact(workRunCtx(bodyOwner), { contentType: 'text/plain', body: LEGACY_BODY,
          sources: [artifactSource], origin: { kind: 'execution', ref: bodyOwner } });
    if (stored.status !== 'stored') throw new Error(`S3 fixture legacy body store failed: ${JSON.stringify(stored)}`);
  }
  const storedNew = await writeMaterials.storeArtifact(workRunCtx(bodyOwner), { contentType: 'text/plain',
    body: NEW_BODY, sources: [artifactSource], origin: { kind: 'execution', ref: bodyOwner } });
  if (storedNew.status !== 'stored') throw new Error(`S3 fixture new body store failed: ${JSON.stringify(storedNew)}`);

  // ---- canonical QueryJob/QueryRun through the real query owner (IN19) ------
  let query: S3InputFixture['query'] = null;
  if (options.seedQuery === true) {
    const goalNow = await plans.queryGoal(ctx, goalRef);
    if (goalNow.status !== 'ready') throw new Error(`S3 fixture Goal read failed: ${JSON.stringify(goalNow)}`);
    const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID, queryJobId: 'qj1' };
    const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID, queryJobId: 'qj1', runId: 'qr1' };
    const queries = createQueryJobService({ records: backend.records, now: () => AT, eventId });
    const submitted = await queries.submitQueryJob(ctx, {
      meta: { requestId: 's3-query-submit', expected: [
        { ref: projectRef, revision: 1 },
        { ref: workspaceRef, revision: WORKSPACE_REVISION },
        { ref: goalRef, revision: goalNow.value.goal.revision },
        { ref: queryJobRef, revision: 0 },
        { ref: queryRunRef, revision: 0 },
      ] },
      input: { queryJobId: 'qj1', runId: 'qr1', intent: {
        schemaVersion: 1, intentId: 'qj1', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, goalId: GOAL_ID,
        question: 'Read the accepted task inputs for tB', focusTaskRefs: [],
        budget: { maxTokens: 4096, deadline: null }, multiTurn: { maxRounds: 1 },
        correlationId: 's3-query-correlation',
        execution: { kind: 'semantic_query', roleBinding, runtimeBudget: queryRuntimeBudget },
      } },
    });
    if (submitted.status !== 'committed') throw new Error(`S3 fixture Query submit failed: ${JSON.stringify(submitted)}`);
    query = { jobRef: queryJobRef, runRef: queryRunRef };
  }

  // ---- counting records/body ports + real material port (spy openArtifact) --
  const recordSpy: RecordSpy = { readMany: 0, lookup: 0, lookupCommit: 0, commit: 0, eventAt: 0 };
  const records: Records = {
    readMany(keys) { recordSpy.readMany += 1; return backend.records.readMany(keys); },
    lookup(request) { recordSpy.lookup += 1; return backend.records.lookup(request); },
    lookupCommit(input) { recordSpy.lookupCommit += 1; return backend.records.lookupCommit(input); },
    commit(input) { recordSpy.commit += 1; return backend.records.commit(input); },
    eventAt(cursor) { recordSpy.eventAt += 1; return backend.records.eventAt(cursor); },
  };

  let tamperedBody: string | null = null;
  const bodiesSpy: BodySpy = { read: 0 };
  const bodies: RawArtifactStorePort = {
    put: input => rawBodies.put(input),
    async read(ref) {
      bodiesSpy.read += 1;
      if (tamperedBody !== null) {
        return { status: 'ready', value: { ref, body: tamperedBody, sourceRefs: [artifactSource],
          origin: { kind: 'run', owner: bodyOwner } } };
      }
      return rawBodies.read(ref);
    },
  };
  // IN05: the stored body's canonical owner is runA2, but loading that owner
  // answers the runA snapshot (a DIFFERENT Run), so the ref check must reject.
  const authority: MaterialAuthorityReads = options.ownerLoadReturnsRun === undefined
    ? baseAuthority
    : {
        load(ref) {
          const alias = runA2 !== null
            && canonicalJson(ref as unknown as JsonValue) === canonicalJson(runA2 as unknown as JsonValue)
            ? runA : ref;
          return baseAuthority.load(alias);
        },
      };
  const realMaterials = createMaterialService({ bodies, authority, now: () => AT });
  const materialsSpy: MaterialSpy = { openArtifactCalls: 0 };
  const materials: MaterialPort = {
    storeArtifact: (callCtx, input) => writeMaterials.storeArtifact(callCtx, input),
    openArtifact(callCtx, input) {
      materialsSpy.openArtifactCalls += 1;
      return realMaterials.openArtifact(callCtx, input);
    },
  };

  // ---- real registered-check PASS chain for the gate (IN11, W3-05) ---------
  let gateRoundPassRef: VerificationRoundRef | null = null;
  let gateReportRef: ArtifactRef | null = null;
  if (options.seedRounds === 'pass') {
    const world = await createCheckWorld('verification-root',
      'process.stdout.write("S3_CHECK_OK\\n");\n');
    const opened = await world.evidence.openVerification(world.checkCtx, { input: {
      subjectRunRef: runA, subject: gateTask, planRef: plan.ref, gateSubject: 'goal' },
      meta: { requestId: 's3-open-gate', expected: [] } });
    if (opened.status !== 'committed') throw new Error(`S3 fixture gate open failed: ${JSON.stringify(opened)}`);
    const roundRef = opened.value.ref;
    // The registered script really runs through the Kernel sandbox; the runner
    // owns begin and record (revisions 2 then 3), finalize is the fourth commit.
    const runner = createRegisteredCheckRunner({ evidence: world.evidence,
      workspaceHost: world.workspaceHost, kernel, now: () => AT });
    const ran = await runner.runRegisteredCheck(world.checkCtx, { input: { roundRef, checkId: CHECK_ID },
      meta: { requestId: 's3-run-gate', expected: [{ ref: roundRef, revision: opened.value.revision }] } });
    if (ran.status !== 'ready') throw new Error(`S3 fixture gate check run failed: ${JSON.stringify(ran)}`);
    const finishedCheck = ran.value.checks.find(candidate => candidate.checkId === CHECK_ID);
    if (finishedCheck === undefined || finishedCheck.reportRef === null) {
      throw new Error('S3 fixture gate check carries no report');
    }
    const finalized = await world.evidence.finalizeChecks(world.checkCtx, { input: { roundRef },
      meta: { requestId: 's3-finalize-gate', expected: [{ ref: roundRef, revision: ran.value.revision }] } });
    if (finalized.status !== 'committed') throw new Error(`S3 fixture gate finalize failed: ${JSON.stringify(finalized)}`);
    if (finalized.value.outcome !== 'PASS') {
      throw new Error(`S3 fixture gate round did not finalize PASS: ${finalized.value.outcome}`);
    }
    gateRoundPassRef = finalized.value.snapshot.ref;
    gateReportRef = finishedCheck.reportRef;
  }

  const decisionApplications: TaskContextInputDependencies['decisionApplications'] =
    options.decisionApplications === true
      ? async () => ({ status: 'ready', value: [] })
      : undefined;
  const service = createTaskContextInputService({ records, materials, bodies,
    hostActor: ctx.materialReader.kind === 'host' ? ctx.materialReader.actor : actor,
    ...(decisionApplications === undefined ? {} : { decisionApplications }) });

  const edgeArtifactDeclarationId = edgeDeclarationId(TASK_B, TASK_A, artifactEdge);
  const edgeGateDeclarationId = edgeDeclarationId(TASK_B, GATE_TASK, { kind: 'gate-result', label: CHECK_ID });
  const edgeEnvironmentDeclarationId = edgeDeclarationId(TASK_B, TASK_A,
    { kind: 'environment-revision', label: 'workspace' });
  const edgeDecisionDeclarationId = edgeDeclarationId(TASK_B, TASK_A,
    { kind: 'decision', label: DECISION_MESSAGE_ID });

  const fixture: S3InputFixture = {
    kind, ctx, service, records, recordSpy, materialsSpy, bodiesSpy, materials, bodies,
    tA, tB, gateTask, planRef: plan.ref, goalRef, runA, runB, oldRef, newRef,
    edgeArtifactDeclarationId, edgeGateDeclarationId, edgeEnvironmentDeclarationId, edgeDecisionDeclarationId,
    legacyDeclarationId: 'legacy:r1', secondLegacyDeclarationId: 'legacy:r2',
    gateRoundPassRef, gateReportRef, decisionMessageId: sent.value.ref.messageId,
    query,
    tamperBody(value) { tamperedBody = value; },
    async messageStatus() {
      const read = await mailbox.readMessage(ctx, messageRef);
      return read.status === 'ready' ? read.value.status : null;
    },
    async queryVersions() {
      if (query === null) return null;
      const keys = [canonicalJson(query.jobRef as unknown as JsonValue),
        canonicalJson(query.runRef as unknown as JsonValue)];
      const read = await backend.records.readMany(keys);
      if (read.status !== 'ready') return null;
      const job = read.value.records.find(candidate => candidate.refKey === keys[0]);
      const run = read.value.records.find(candidate => candidate.refKey === keys[1]);
      if (job === undefined || run === undefined) return null;
      return { job: job.revision, run: run.revision };
    },
    async planPhase(taskId) {
      const key = canonicalJson(plan.ref as unknown as JsonValue);
      const read = await backend.records.readMany([key]);
      if (read.status !== 'ready') throw new Error(`S3 fixture Plan read failed: ${JSON.stringify(read)}`);
      const record = read.value.records.find(candidate => candidate.refKey === key);
      if (record === undefined) throw new Error('S3 fixture Plan record is absent');
      const planBody = JSON.parse(record.json) as { tasks: { taskId: string; phase: string }[] };
      return planBody.tasks.find(task => task.taskId === taskId)?.phase ?? 'missing';
    },
    workCtx(run) {
      return { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
        principal: { kind: 'work_run', runRef: run, roleBinding },
        materialReader: { kind: 'run', requester: run }, signal: ctx.signal };
    },
    async close() {
      await runtimeSteps.close();
      await rawBodies.close?.();
      await backend.close();
    },
  };
  return fixture;
}

// --------------------------------------------------------------------------
// Request helpers
// --------------------------------------------------------------------------

async function readInputs(f: S3InputFixture, declarationId?: string, keyValue?: string) {
  return f.service.readTaskInputs(f.ctx, { consumer: f.tB, planRef: f.planRef,
    ...(declarationId === undefined ? {} : { declarationId }),
    ...(keyValue === undefined ? {} : { candidateKey: keyValue }) });
}

async function readPage(f: S3InputFixture, declarationId: string, options: {
  afterCursor?: string | null; maxBytes?: number; candidateKey?: string; callCtx?: CoreCallContext;
} = {}) {
  return f.service.readTaskInputPage(options.callCtx ?? f.ctx, { consumer: f.tB, planRef: f.planRef,
    declarationId, afterCursor: options.afterCursor ?? null, maxBytes: options.maxBytes ?? 2048,
    ...(options.candidateKey === undefined ? {} : { candidateKey: options.candidateKey }) });
}

const KINDS = ['memory', 'sqlite'] as const;

// --------------------------------------------------------------------------
// §5.3 cases
// --------------------------------------------------------------------------

describe.each(KINDS)('S3 exact task inputs (%s backend)', kind => {
  it('IN01 legacy declaration selects the original ref with historical usage', async () => {
    const f = await openFixture(kind, { r2: 'none' });
    const result = await readInputs(f, f.legacyDeclarationId);
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({ state: 'selected', usage: 'historical_explanation',
      source: { kind: 'artifact', ref: f.oldRef } });
    const page = await readPage(f, f.legacyDeclarationId);
    expect(page).toMatchObject({ status: 'ready' });
    if (page.status !== 'ready') return;
    // The projection covers the consumer's selected Artifact selections only.
    expect(page.value.selectedTaskInputs).toEqual([{ requirementId: 'r1', ref: f.oldRef }]);
  });

  it('IN02 a later new-A body does not move the fixed original body', async () => {
    const f = await openFixture(kind);
    const result = await readInputs(f, f.legacyDeclarationId);
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    // What was actually consumed: the original old-A ref, never the later new-A.
    expect(result.value[0]!.source).toMatchObject({ kind: 'artifact', ref: f.oldRef });
    expect(result.value[0]!.source).toMatchObject({ ref: { digest: sha256Hex(LEGACY_BODY) } });
    expect(result.value[0]!.source).not.toMatchObject({ ref: f.newRef });
    const page = await readPage(f, f.legacyDeclarationId);
    expect(page).toMatchObject({ status: 'ready' });
    if (page.status !== 'ready') return;
    expect(page.value.body).toBe(LEGACY_BODY);
    expect(page.value.selection.source).toMatchObject({ kind: 'artifact', ref: f.oldRef });
  });

  it('IN03 a candidate key that is not a declared candidate is forbidden without opening a body', async () => {
    const f = await openFixture(kind);
    const foreign = candidateKey({ kind: 'artifact', ref: f.newRef,
      provenance: { kind: 'run', owner: f.runA } });
    const result = await readInputs(f, f.legacyDeclarationId, foreign);
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(f.materialsSpy.openArtifactCalls).toBe(0);
  });

  it('IN05 an owner ref that resolves to a different Run is forbidden', async () => {
    // The stored body's canonical owner is tA's real second Run, runA2; loading
    // that owner answers the runA snapshot, a DIFFERENT Run (same Task), so the
    // owner ref check must reject.
    const f = await openFixture(kind, { ownerRun: 'runA2', ownerLoadReturnsRun: 'runA' });
    const result = await readInputs(f, f.legacyDeclarationId);
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });

  it('IN06 a missing original body is unavailable and does not block the Task', async () => {
    const f = await openFixture(kind, { storeLegacyBody: false });
    const result = await readInputs(f, f.legacyDeclarationId);
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value[0]).toMatchObject({ state: 'unavailable', errorCode: 'not_found', source: null });
    expect(await f.planPhase(f.tB.taskId)).toBe('pending');
  });

  it('IN07 a tampered raw body is unavailable and returns no body', async () => {
    const f = await openFixture(kind);
    f.tamperBody('bad-A');
    const result = await readInputs(f, f.legacyDeclarationId);
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value[0]).toMatchObject({ state: 'unavailable', errorCode: 'unavailable' });
    const page = await readPage(f, f.legacyDeclarationId);
    expect(page).toMatchObject({ status: 'ready' });
    if (page.status !== 'ready') return;
    expect(page.value.body).toBeNull();
  });

  it('IN08 an artifact edge with only a label is missing and lists the upstream fact', async () => {
    const f = await openFixture(kind);
    const result = await readInputs(f, f.edgeArtifactDeclarationId);
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({ state: 'missing', reason: 'no_labeled_output',
      source: null, candidates: [] });
    expect(result.value[0]!.declaration.upstream).toEqual(f.tA);
  });

  it('IN09 two legacy declarations of one ref stay two selections', async () => {
    const f = await openFixture(kind);
    const result = await readInputs(f);
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    // The unfiltered read returns the two legacy declarations AND the four edge
    // declarations; only the legacy ones are selected Artifact selections.
    expect(result.value).toHaveLength(6);
    const legacy = result.value.filter(selection => selection.declaration.declarationId.startsWith('legacy:'));
    expect(legacy).toHaveLength(2);
    expect(legacy.every(selection => selection.state === 'selected')).toBe(true);
    const page = await readPage(f, f.legacyDeclarationId);
    expect(page).toMatchObject({ status: 'ready' });
    if (page.status !== 'ready') return;
    expect(page.value.selectedTaskInputs).toEqual([
      { requirementId: 'r1', ref: f.oldRef },
      { requirementId: 'r2', ref: f.oldRef },
    ]);
  });

  it('IN10 another declaration source key cannot be used to read r1', async () => {
    const f = await openFixture(kind, { r2: 'new' });
    const foreign = candidateKey({ kind: 'artifact', ref: f.newRef,
      provenance: { kind: 'run', owner: f.runA } });
    const result = await readInputs(f, f.legacyDeclarationId, foreign);
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(f.materialsSpy.openArtifactCalls).toBe(0);
  });

  it('IN11 a gate-result declaration selects the applicable chain head', async () => {
    const f = await openFixture(kind, { seedRounds: 'pass' });
    const round = f.gateRoundPassRef;
    const report = f.gateReportRef;
    if (round === null || report === null) throw new Error('S3 fixture did not finalize the gate round');
    const result = await readInputs(f, f.edgeGateDeclarationId);
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    // The whole selected source: the chain head ref/revision, its checkId and reportRef.
    // Revision working: the real chain commits open@1, begin@2, record@3 and
    // finalize@4, so the finalized head the reader selects is revision 4. The
    // reportRef is the Artifact the registered-check runner's real
    // recordCheckResult stored (a platform-issued value used as returned), not
    // the old seeded new-A ref.
    expect(result.value[0]!.state).toBe('selected');
    expect(result.value[0]!.source).toEqual({ kind: 'check', ref: round, revision: 4,
      checkId: CHECK_ID, reportRef: report });
    // The registered-check-report write fixes the report type (evidence-service.ts
    // storeReport); the literal is hand-written, never imported from src.
    expect(report.contentType)
      .toBe('application/vnd.coding-platform.verification-check-report+json;version=1');
  });

  it('IN13 an environment declaration selects the workspace revision without a current assertion', async () => {
    const f = await openFixture(kind);
    const result = await readInputs(f, f.edgeEnvironmentDeclarationId);
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    // The exact environment source, with no source pin/current assertion added.
    expect(result.value[0]!.source).toEqual({ kind: 'environment', ref: workspaceRef,
      revision: WORKSPACE_REVISION });
    expect(result.value[0]!.source).not.toHaveProperty('applicability');
  });

  it('IN14 a decision with only a reply and no application is missing', async () => {
    const f = await openFixture(kind, { decisionApplications: true });
    // The posted Message carries the id the owner derived from the send
    // request id; the literal is hand-worked above, not read back from src.
    expect(f.decisionMessageId).toBe(DECISION_MESSAGE_ID);
    const result = await readInputs(f, f.edgeDecisionDeclarationId);
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value[0]).toMatchObject({ state: 'missing', reason: 'decision_not_applied' });
    // The read never mutates the already-replied Message (public mailbox read).
    expect(await f.messageStatus()).toBe('responded');
  });

  it('IN15 a pre-aborted call is cancelled before any store or material IO', async () => {
    const f = await openFixture(kind);
    const controller = new AbortController();
    controller.abort();
    const result = await readInputs({ ...f, ctx: { ...f.ctx, signal: controller.signal } }, f.legacyDeclarationId);
    expect(result).toMatchObject({ status: 'rejected', code: 'cancelled' });
    // EVERY injected boundary, not only readMany.
    expect(f.recordSpy.readMany).toBe(0);
    expect(f.recordSpy.lookup).toBe(0);
    expect(f.recordSpy.lookupCommit).toBe(0);
    expect(f.recordSpy.commit).toBe(0);
    expect(f.recordSpy.eventAt).toBe(0);
    expect(f.bodiesSpy.read).toBe(0);
    expect(f.materialsSpy.openArtifactCalls).toBe(0);
  });

  it('IN16 the direct consumer reader is forbidden while the declared bridge is ready', async () => {
    const f = await openFixture(kind);
    const direct = await f.materials.openArtifact(f.workCtx(f.runB),
      { ref: f.oldRef, usage: 'historical_explanation' });
    expect(direct).toMatchObject({ status: 'rejected', code: 'forbidden' });
    const commitsBefore = f.recordSpy.commit;
    // The bridged read runs under the consumer Run's context, then bridges by declaration.
    const bridged = await f.service.readTaskInputs(f.workCtx(f.runB), {
      consumer: f.tB, planRef: f.planRef, declarationId: f.legacyDeclarationId });
    expect(bridged).toMatchObject({ status: 'ready' });
    if (bridged.status !== 'ready') return;
    expect(bridged.value[0]).toMatchObject({ state: 'selected',
      source: { kind: 'artifact', ref: f.oldRef } });
    expect(f.recordSpy.commit).toBe(commitsBefore);
  });

  it('IN17 a same-scope platform_operation origin keeps the stored provenance', async () => {
    const f = await openFixture(kind, { legacyOrigin: 'platform_operation' });
    const result = await readInputs(f, f.legacyDeclarationId);
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value[0]).toMatchObject({ state: 'selected', usage: 'historical_explanation' });
    // The full stored provenance; no fabricated ownerRunRef.
    expect(result.value[0]!.source).toEqual({ kind: 'artifact', ref: f.oldRef,
      provenance: { kind: 'platform_operation', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
        requestId: 's3-material-request', actor: { kind: 'human', id: 's3-operator' } } });
  });

  it('IN19 a canonical QueryRun reads the legacy declaration through the owner', async () => {
    const f = await openFixture(kind, { seedQuery: true });
    const query = f.query;
    if (query === null) throw new Error('S3 fixture did not seed the canonical QueryRun');
    const queryCtx: CoreCallContext = { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
      principal: { kind: 'query_run', queryRunRef: query.runRef, initiator: { kind: 'human', id: 's3-operator' } },
      materialReader: { kind: 'host', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
        actor: { kind: 'human', id: 's3-operator' } },
      signal: new AbortController().signal };
    const commitsBefore = f.recordSpy.commit;
    const result = await readInputs({ ...f, ctx: queryCtx }, f.legacyDeclarationId);
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value[0]).toMatchObject({ state: 'selected', usage: 'historical_explanation',
      source: { kind: 'artifact', ref: f.oldRef } });
    // The canonical Query records carry complete versions.
    expect(await f.queryVersions()).toEqual({ job: 1, run: 1 });
    // A canonical Query is a read principal and adds no ledger commit.
    expect(f.recordSpy.commit).toBe(commitsBefore);
  });
});
