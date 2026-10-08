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
 * canonical owner that answers a different Run, a finalized PASS/FAIL round
 * chain, a replied formal Message with a `decisionApplications` answer, a
 * canonical QueryRun) are seeded as REAL records through their owning codecs or
 * services. In part 1 every method throws `not implemented: …`, so the cases are
 * RED by design; this file must still compile and run all 38 cases.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type {
  RoleBindingRefV1, RunRef, RunSnapshot, SourceRefV1, TaskBudgetV1, TaskTriple,
} from '../../src/contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { GoalRef, ProjectSnapshot, WorkspaceRef, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef } from '../../src/contracts/plan.js';
import type { QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import type {
  RegisteredCommandCheck, RoundCheckSnapshot, RoundSnapshot, TrustedCheckConfiguration,
  VerificationPlanV1, VerificationRoundRef,
} from '../../src/contracts/verification.js';
import type { VerificationRoundMaterialIdentity } from '../../src/contracts/verification-context.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type {
  EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordBackendSchemas,
} from '../../src/core/record-store/ports.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRawArtifactStore } from '../../src/core/record-store/sqlite-body-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import type { MaterialAuthorityReads } from '../../src/core/work-graph/materials/record-ports.js';
import {
  createMaterialRecordReaders, materialRecordSchemas,
} from '../../src/core/work-graph/materials/record-readers.js';
import type { MaterialPort } from '../../src/core/work-graph/model/material-contracts.js';
import { encodeProjectSnapshot, encodeWorkspaceSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import {
  EVIDENCE_RECORD_SCHEMAS, encodeVerificationRoundSnapshot,
} from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { PLAN_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import {
  SESSION_MESSAGE_RECORD_SCHEMAS, encodeSessionMessageRecord, sessionMessageRefKey,
} from '../../src/core/work-graph/sessions/message-record-codecs.js';
import type { SessionMessageRecord } from '../../src/core/work-graph/state/message-machine.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { PLAN_GOVERNANCE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import { PLAN_STATE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import {
  createTaskContextInputService, type TaskContextInputDependencies, type TaskContextInputPort,
} from '../../src/core/work-graph/tasks/context-input-service.js';

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
const runA: RunRef = { aggregateType: 'Run', projectId: PROJECT_ID, goalId: GOAL_ID, runId: 'runA' };
const runA2: RunRef = { aggregateType: 'Run', projectId: PROJECT_ID, goalId: GOAL_ID, runId: 'runA2' };
const runB: RunRef = { aggregateType: 'Run', projectId: PROJECT_ID, goalId: GOAL_ID, runId: 'runB' };
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
 * IN14: a replied formal Message sent by runA (the decision edge's upstream
 * Run). The reading owner must find the reply, consult `decisionApplications`
 * and, when nothing is applied, report `missing/decision_not_applied` without
 * touching the stored status.
 */
const decisionMessage: SessionMessageRecord = {
  ref: { aggregateType: 'SessionMessage', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, messageId: 'msg-1' },
  schemaVersion: 1, revision: 1,
  sender: { kind: 'work_run', sessionRef: { projectId: PROJECT_ID, sessionId: 'sa' },
    runRef: runA, roleBinding, generation: 1 },
  recipient: { projectId: PROJECT_ID, sessionId: 'sb' },
  bodyRef: oldRef, sourceRef: artifactSource, createdAt: AT,
  status: 'responded', readAt: AT,
  response: { sender: { kind: 'work_run', sessionRef: { projectId: PROJECT_ID, sessionId: 'sa' },
    runRef: runA, roleBinding, generation: 1 },
    bodyRef: newRef, sourceRef: artifactSource, respondedAt: AT },
  intent: 'inquiry', needsReply: true,
};

const gateRoundPassRef: VerificationRoundRef = { aggregateType: 'VerificationRound', projectId: PROJECT_ID,
  workspaceId: WORKSPACE_ID, goalId: GOAL_ID, taskId: GATE_TASK, runId: runA.runId, roundId: 'rGatePass' };
const gateRoundFailRef: VerificationRoundRef = { aggregateType: 'VerificationRound', projectId: PROJECT_ID,
  workspaceId: WORKSPACE_ID, goalId: GOAL_ID, taskId: GATE_TASK, runId: runA.runId, roundId: 'rGateFail' };

// --------------------------------------------------------------------------
// Fixture types
// --------------------------------------------------------------------------

type Records = GoalRecordTransactionPort & RecordLookupPort;

type RecordSpy = { readMany: number; lookup: number; lookupCommit: number; commit: number; eventAt: number };
type MaterialSpy = { openArtifactCalls: number };
type BodySpy = { read: number };

type S3InputFixtureOptions = {
  /** Canonical workspace of the stored legacy artifact's owner Run (IN04). */
  ownerWorkspace?: string;
  /** Store the legacy body at all; `false` models a missing body (IN06). */
  storeLegacyBody?: boolean;
  /** Owner Run the legacy body is stored under (IN05). */
  ownerRun?: 'runA' | 'runA2';
  /**
   * IN05: the canonical-owner load for the stored body's owner answers with this
   * OTHER Run's canonical snapshot, so the ref check must reject.
   */
  ownerLoadReturnsRun?: 'runA';
  /** Provenance of the stored legacy body (IN17/IN18). */
  legacyOrigin?: 'run' | 'platform_operation' | 'owner-less';
  /**
   * Legacy declarations: `none` = only r1, `old` = r1+r2 both old-A (IN09),
   * `new` = r1 old-A, r2 new-A (IN10).
   */
  r2?: 'none' | 'old' | 'new';
  /** Seed the real finalized VerificationRound chain for the gate (IN11/IN12). */
  seedRounds?: 'pass' | 'pass-then-fail';
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
  gateRoundPassRef: VerificationRoundRef;
  gateRoundFailRef: VerificationRoundRef;
  /** The canonical Query seeded by `seedQuery` (IN19), else null. */
  query: { jobRef: QueryJobRef; runRef: QueryRunRef } | null;
  /** Tamper what a body read returns (IN07). */
  tamperBody(value: string | null): void;
  /** The stored SessionMessage status (IN14), or null when none is seeded. */
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

function runSnapshot(run: RunRef, task: TaskTriple, workspaceId: string, status: RunSnapshot['status']): RunSnapshot {
  return { ref: run, revision: 1, schemaVersion: 1, task, attemptId: `attempt-${task.taskId}`,
    planRef, roleBinding, budget, workspaceSnapshot: { workspaceId, revision: WORKSPACE_REVISION },
    status, outcome: status === 'ended' ? 'completed' : null, exitCode: status === 'ended' ? 0 : null,
    lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '', envelope: null,
    startedAt: null, endedAt: null };
}

async function createInputFixture(
  kind: 'memory' | 'sqlite', options: S3InputFixtureOptions = {},
): Promise<S3InputFixture> {
  const directory = await mkdtemp(join(tmpdir(), `next-s3-inputs-${kind}-`));
  const materialSchemas = materialRecordSchemas();
  const schemas: RecordBackendSchemas = {
    records: [...materialSchemas.records, ...PLAN_RECORD_SCHEMAS.records,
      ...PLAN_STATE_RECORD_SCHEMAS.records, ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records,
      ...EVIDENCE_RECORD_SCHEMAS.records, ...SESSION_MESSAGE_RECORD_SCHEMAS.records,
      ...QUERY_JOB_RECORD_SCHEMAS.records],
    events: [...materialSchemas.events, ...PLAN_RECORD_SCHEMAS.events,
      ...PLAN_STATE_RECORD_SCHEMAS.events, ...PLAN_GOVERNANCE_RECORD_SCHEMAS.events,
      ...EVIDENCE_RECORD_SCHEMAS.events, ...SESSION_MESSAGE_RECORD_SCHEMAS.events,
      ...QUERY_JOB_RECORD_SCHEMAS.events,
      { eventType: 'TrustedScopeSeeded', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) }],
    lookups: [...(materialSchemas.lookups ?? []), ...(PLAN_RECORD_SCHEMAS.lookups ?? []),
      ...(PLAN_STATE_RECORD_SCHEMAS.lookups ?? []), ...(PLAN_GOVERNANCE_RECORD_SCHEMAS.lookups ?? []),
      ...(EVIDENCE_RECORD_SCHEMAS.lookups ?? []), ...(SESSION_MESSAGE_RECORD_SCHEMAS.lookups ?? []),
      ...(QUERY_JOB_RECORD_SCHEMAS.lookups ?? [])],
  };
  const backend = kind === 'memory'
    ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ path: join(directory, 'ledger.sqlite'), schemas });
  const rawBodies: RawArtifactStorePort & { close?(): Promise<void> } = kind === 'memory'
    ? new RawArtifactBodyStore()
    : createSqliteRawArtifactStore(join(directory, 'bodies.sqlite'));

  const actor = { kind: 'human' as const, id: 's3-operator' };
  const ctx: CoreCallContext = { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
    principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, actor },
    signal: new AbortController().signal };

  // ---- trusted scope + governance (the real Plan service's fixed pins) ------
  const policyFixture = { schemaVersion: 1, identity: { policyId: 's3-policy' }, revision: 1,
    content: { schemaVersion: 1, requirementKinds: ['static'],
      minimumRequiredRequirementsPerObligation: 1 } };
  const architectureFixture = { schemaVersion: 1, identity: { baselineId: 's3-baseline' }, revision: 1,
    content: { schemaVersion: 1, description: 'S3 context-input fixture baseline', constraints: [] } };
  const digestOf = (value: JsonValue) => sha256Hex(canonicalJson(value));
  const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId: PROJECT_ID,
    policyId: 's3-policy', revision: 1 };
  const architectureRef = { aggregateType: 'ArchitectureBaselineRevision' as const, projectId: PROJECT_ID,
    baselineId: 's3-baseline', revision: 1 };
  const policyPin = { ref: policyRef, digest: digestOf(policyFixture as unknown as JsonValue) };
  const baselinePin = { ref: architectureRef, digest: digestOf(architectureFixture as unknown as JsonValue) };
  const governance = [
    { ref: policyRef, revision: 1, schemaVersion: 1, policyId: policyRef.policyId, contentRevision: 1,
      contentDigest: digestOf(policyFixture), content: policyFixture.content },
    { ref: architectureRef, revision: 1, schemaVersion: 1, baselineId: architectureRef.baselineId,
      contentRevision: 1, contentDigest: digestOf(architectureFixture), content: architectureFixture.content },
    { ref: { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: PROJECT_ID }, projectId: PROJECT_ID,
      revision: 1, activeRevision: policyRef },
    { ref: { aggregateType: 'ProjectArchitectureBaselineActive' as const, projectId: PROJECT_ID }, projectId: PROJECT_ID,
      revision: 1, activeRevision: architectureRef },
  ];
  const encodeGovernance = (snapshot: (typeof governance)[number]): EncodedRecord => ({
    refKey: canonicalJson(snapshot.ref as unknown as JsonValue),
    schemaId: `${snapshot.ref.aggregateType}Snapshot@1`, revision: snapshot.revision, json: JSON.stringify(snapshot),
  });
  const project: ProjectSnapshot = { ref: projectRef, revision: 1 };
  const workspace: WorkspaceSnapshot = { ref: workspaceRef, revision: WORKSPACE_REVISION };
  const otherWorkspace: WorkspaceSnapshot = { ref: otherWorkspaceRef, revision: WORKSPACE_REVISION };
  const scopeEvent = { eventId: 's3-scope-seed', eventType: 'TrustedScopeSeeded', schemaVersion: 1,
    occurredAt: AT, json: JSON.stringify({ eventId: 's3-scope-seed', eventType: 'TrustedScopeSeeded',
      schemaVersion: 1, occurredAt: AT }) };
  const scopeSeed: PreparedCommit = { identityKey: 's3-scope-seed', fingerprint: 's3-scope-seed-v1',
    guards: [{ refKey: canonicalJson(projectRef as unknown as JsonValue), expectedRevision: null },
      { refKey: canonicalJson(workspaceRef as unknown as JsonValue), expectedRevision: null },
      { refKey: canonicalJson(otherWorkspaceRef as unknown as JsonValue), expectedRevision: null },
      ...governance.map(snapshot => ({ refKey: canonicalJson(snapshot.ref as unknown as JsonValue), expectedRevision: null }))],
    records: [encodeProjectSnapshot(project), encodeWorkspaceSnapshot(workspace), encodeWorkspaceSnapshot(otherWorkspace),
      ...governance.map(encodeGovernance)],
    events: [scopeEvent], claims: [], indexGuards: [], indexChanges: [] };
  const seededScope = await backend.records.commit(scopeSeed);
  if (seededScope.status !== 'committed') throw new Error(`S3 fixture scope seed failed: ${seededScope.reason}`);

  // ---- real finalized VerificationRound builders (IN11/IN12) ----------------
  const checkHostActor = { kind: 'system' as const, id: 's3-check-host' };
  const checkDefinition = (checkId: string): RegisteredCommandCheck => ({
    checkId, kind: 'static', command: 'node check-b.js', cwd: '.', timeoutMs: 60_000, taskIds: 'all',
  });
  const roundFor = (roundId: string, outcome: 'PASS' | 'FAIL', predecessor: RoundSnapshot | null): RoundSnapshot => {
    const configuration: TrustedCheckConfiguration = {
      configurationRevision: 's3-checks-config-1', workspace: workspaceRef, executor: checkHostActor,
      permissionRevision: 's3-permission-1', sourceAccess: 'verification_workspace',
      processAccess: 'all_except_denied', deniedPrefixes: ['node_modules'], checks: [checkDefinition(CHECK_ID)],
    };
    const verificationPlan: VerificationPlanV1 = {
      schemaVersion: 1, planId: sha256Hex('s3-verification-plan'), planDigest: sha256Hex('s3-verification-plan'),
      taskRef: gateTask, planRef, planRevision: 1, workspaceRevision: WORKSPACE_REVISION,
      pinnedCompletionPolicy: policyPin, pinnedArchitectureBaseline: baselinePin,
      changeScope: { diffClass: 'code-change', changedFiles: ['src/a.ts'], writeSummary: 'edit src/a.ts' },
      semanticChange: 'semantic', risks: [],
      checks: [{ checkId: CHECK_ID, kind: 'static', satisfiesKind: 'static',
        coverage: [{ obligationId: OBLIGATION_ID, requirementId: CHECK_ID }], satisfactionPath: 'predicate' }],
    };
    const identity: VerificationRoundMaterialIdentity = {
      schemaVersion: 1,
      scope: { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, goalId: GOAL_ID, runId: runA.runId,
        taskId: GATE_TASK, gateSubject: 'goal' },
      runRef: runA, runRevision: 1, runDigest: sha256Hex('s3-run-a'),
      planRef, planRevision: 1, planDigest: sha256Hex('s3-plan'),
      taskDigest: sha256Hex('s3-gate-task'), goalRevision: 2, goalDigest: sha256Hex('s3-goal'),
      workspaceRevision: WORKSPACE_REVISION, workspaceDigest: sha256Hex('s3-workspace'),
      workspaceRoot: '/s3/workspace', policyPin, baselinePin,
      sourceDigest: sha256Hex('s3-source'), sourceProofDigest: sha256Hex('s3-source-proof'),
    };
    const check: RoundCheckSnapshot = {
      checkId: CHECK_ID, definition: checkDefinition(CHECK_ID),
      coverage: [{ obligationId: OBLIGATION_ID, requirementId: CHECK_ID }],
      phase: 'finished', invocationId: `s3-inv-${CHECK_ID}`, outcome, reportRef: newRef, sourceStatus: 'matched',
    };
    const ref: VerificationRoundRef = { aggregateType: 'VerificationRound', projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID, goalId: GOAL_ID, taskId: GATE_TASK, runId: runA.runId, roundId };
    const base: RoundSnapshot = { ref, revision: 1, schemaVersion: 1, subject: gateTask, subjectRunRef: runA,
      adoptedPlanRef: planRef, taskBasisRef: planRef, executor: checkHostActor, configuration,
      configurationDigest: sha256Hex(canonicalJson(configuration as unknown as JsonValue)),
      identity, sourceProof: { kind: 'current-workspace-only', runBaselineKnown: false },
      verificationPlan, checks: [check], status: 'finalized', outcome, gaps: [], evidenceRefs: [] };
    if (predecessor === null) return base;
    return { ...base, chain: { schemaVersion: 1, ordinal: 2,
      predecessorRoundRef: predecessor.ref, predecessorRevision: predecessor.revision,
      supersededEvidenceIds: [], basisDigests: [], autoCount: 0,
      reverify: { requestedBy: checkHostActor, actorClass: 'system', failureClass: 'check_failed', requestedAt: AT,
        basis: { subject: gateTask, subjectRunId: runA.runId, actionKind: 'reverify',
          failure: { checks: [{ checkId: CHECK_ID, phase: 'finished', outcome: 'FAIL', cause: null }], gapCodes: [] },
          source: { workspaceRevision: WORKSPACE_REVISION, sourceDigest: sha256Hex('s3-source') },
          configuration: { configurationRevision: configuration.configurationRevision,
            configurationDigest: base.configurationDigest },
          verificationInputs: { basisPlanRef: planRef, completionPolicyPin: policyPin,
            architectureBaselinePin: baselinePin },
          newInputDigest: null, digest: sha256Hex('s3-reverify-basis') },
        exemption: 'none', sourceChanged: false, newInputRefs: [], reason: 'the registered check failed' } } };
  };

  // ---- legacy raw body + newer body through the real body store -------------
  let sequence = 0;
  const eventId = () => `s3-event-${++sequence}`;
  const storedOrigin = options.legacyOrigin ?? 'run';
  const owner = options.ownerRun === 'runA2' ? runA2 : runA;
  if (options.storeLegacyBody !== false) {
    const origin = storedOrigin === 'platform_operation'
      ? { kind: 'platform_operation' as const, projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
          requestId: 's3-material-request', actor }
      : { kind: 'run' as const, owner };
    const stored = await rawBodies.put({ body: LEGACY_BODY, contentType: 'text/plain',
      sourceRefs: [artifactSource], origin, requestedAt: AT });
    if (stored.status !== 'ready') throw new Error(`S3 fixture legacy body failed: ${JSON.stringify(stored)}`);
  }
  const storedNew = await rawBodies.put({ body: NEW_BODY, contentType: 'text/plain',
    sourceRefs: [artifactSource], origin: { kind: 'run', owner }, requestedAt: AT });
  if (storedNew.status !== 'ready') throw new Error('S3 fixture new body failed');

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
      { taskId: TASK_B, dependsOnId: TASK_A, requires: { kind: 'decision', label: 'msg-1' } },
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

  // ---- Runs so the material applicability reader can resolve provenance -----
  let seedSeq = 0;
  async function commitRaw(recordsToWrite: readonly EncodedRecord[]): Promise<void> {
    const seq = ++seedSeq;
    const event = { eventId: `s3-seed-event-${seq}`, eventType: 'TrustedScopeSeeded', schemaVersion: 1,
      occurredAt: AT, json: JSON.stringify({ eventId: `s3-seed-event-${seq}`, eventType: 'TrustedScopeSeeded',
        schemaVersion: 1, occurredAt: AT }) };
    const receipt = await backend.records.commit({ identityKey: `s3-seed-${seq}`,
      fingerprint: `s3-seed-fingerprint-${seq}`,
      guards: recordsToWrite.map(record => ({ refKey: record.refKey, expectedRevision: null })),
      records: [...recordsToWrite], events: [event], claims: [], indexGuards: [], indexChanges: [] });
    if (receipt.status !== 'committed') throw new Error(`S3 fixture run seed failed: ${JSON.stringify(receipt)}`);
  }
  const ownerWorkspace = options.ownerWorkspace ?? WORKSPACE_ID;
  await commitRaw([
    { refKey: canonicalJson(runA as unknown as JsonValue), schemaId: 'RunSnapshot@1', revision: 1,
      json: JSON.stringify(runSnapshot(runA, tA, ownerWorkspace, 'ended')) },
    { refKey: canonicalJson(runA2 as unknown as JsonValue), schemaId: 'RunSnapshot@1', revision: 1,
      json: JSON.stringify(runSnapshot(runA2, tA, ownerWorkspace, 'ended')) },
    { refKey: canonicalJson(runB as unknown as JsonValue), schemaId: 'RunSnapshot@1', revision: 1,
      json: JSON.stringify(runSnapshot(runB, tB, WORKSPACE_ID, 'starting')) },
  ]);

  // ---- real finalized round chain / replied Message (IN11/IN12/IN14) --------
  const seededFacts: EncodedRecord[] = [];
  if (options.seedRounds === 'pass' || options.seedRounds === 'pass-then-fail') {
    const pass = roundFor(gateRoundPassRef.roundId, 'PASS', null);
    seededFacts.push(encodeVerificationRoundSnapshot(pass));
    if (options.seedRounds === 'pass-then-fail') {
      seededFacts.push(encodeVerificationRoundSnapshot(roundFor(gateRoundFailRef.roundId, 'FAIL', pass)));
    }
  }
  if (options.decisionApplications === true) seededFacts.push(encodeSessionMessageRecord(decisionMessage));
  if (seededFacts.length > 0) await commitRaw(seededFacts);

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
          origin: { kind: 'run', owner } } };
      }
      if (storedOrigin === 'owner-less') {
        return { status: 'ready', value: { ref, body: LEGACY_BODY, sourceRefs: [artifactSource],
          origin: { kind: 'legacy', ownerRunRef: null } } };
      }
      return rawBodies.read(ref);
    },
  };
  const { authority: baseAuthority } = createMaterialRecordReaders(backend.records);
  // IN05: the stored body's canonical owner is runA2, but loading that owner
  // answers the runA snapshot (a DIFFERENT Run), so the ref check must reject.
  const authority: MaterialAuthorityReads = options.ownerLoadReturnsRun === undefined
    ? baseAuthority
    : {
        load(ref) {
          const alias = canonicalJson(ref as unknown as JsonValue) === canonicalJson(runA2 as unknown as JsonValue)
            ? runA : ref;
          return baseAuthority.load(alias);
        },
      };
  const realMaterials = createMaterialService({ bodies, authority, now: () => AT });
  const materialsSpy: MaterialSpy = { openArtifactCalls: 0 };
  const materials: MaterialPort = {
    storeArtifact: (callCtx, input) => realMaterials.storeArtifact(callCtx, input),
    openArtifact(callCtx, input) {
      materialsSpy.openArtifactCalls += 1;
      return realMaterials.openArtifact(callCtx, input);
    },
  };

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
  const edgeDecisionDeclarationId = edgeDeclarationId(TASK_B, TASK_A, { kind: 'decision', label: 'msg-1' });

  const fixture: S3InputFixture = {
    kind, ctx, service, records, recordSpy, materialsSpy, bodiesSpy, materials, bodies,
    tA, tB, gateTask, planRef, goalRef, runA, runB, oldRef, newRef,
    edgeArtifactDeclarationId, edgeGateDeclarationId, edgeEnvironmentDeclarationId, edgeDecisionDeclarationId,
    legacyDeclarationId: 'legacy:r1', secondLegacyDeclarationId: 'legacy:r2',
    gateRoundPassRef, gateRoundFailRef, query,
    tamperBody(value) { tamperedBody = value; },
    async messageStatus() {
      const key = sessionMessageRefKey(decisionMessage.ref);
      const read = await backend.records.readMany([key]);
      if (read.status !== 'ready') return null;
      const record = read.value.records.find(candidate => candidate.refKey === key);
      if (record === undefined) return null;
      return (JSON.parse(record.json) as { status?: string }).status ?? null;
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
      const key = canonicalJson(planRef as unknown as JsonValue);
      const read = await backend.records.readMany([key]);
      if (read.status !== 'ready') throw new Error(`S3 fixture Plan read failed: ${JSON.stringify(read)}`);
      const record = read.value.records.find(candidate => candidate.refKey === key);
      if (record === undefined) throw new Error('S3 fixture Plan record is absent');
      const plan = JSON.parse(record.json) as { tasks: { taskId: string; phase: string }[] };
      return plan.tasks.find(task => task.taskId === taskId)?.phase ?? 'missing';
    },
    workCtx(run) {
      return { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
        principal: { kind: 'work_run', runRef: run, roleBinding },
        materialReader: { kind: 'run', requester: run }, signal: ctx.signal };
    },
    async close() {
      await backend.close();
      await rawBodies.close?.();
      await rm(directory, { recursive: true, force: true });
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

  it('IN04 an owner outside the consumer workspace is forbidden and returns no body', async () => {
    const f = await openFixture(kind, { ownerWorkspace: OTHER_WORKSPACE_ID });
    const result = await readInputs(f, f.legacyDeclarationId);
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(f.materialsSpy.openArtifactCalls).toBe(0);
  });

  it('IN05 an owner ref that resolves to a different Run is forbidden', async () => {
    // The stored body's canonical owner is runA2; loading that owner answers the
    // runA snapshot, a DIFFERENT Run, so the owner ref check must reject.
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
    const result = await readInputs(f, f.edgeGateDeclarationId);
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    // The whole selected source: the chain head ref/revision, its checkId and reportRef.
    expect(result.value[0]!.state).toBe('selected');
    expect(result.value[0]!.source).toEqual({ kind: 'check', ref: f.gateRoundPassRef, revision: 1,
      checkId: CHECK_ID, reportRef: f.newRef });
  });

  it('IN12 a finalized FAIL suppresses an older PASS for the same check', async () => {
    const f = await openFixture(kind, { seedRounds: 'pass-then-fail' });
    const result = await readInputs(f, f.edgeGateDeclarationId);
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    // The chain head is the finalized FAIL: no old PASS is selected.
    expect(result.value[0]).toMatchObject({ state: 'missing' });
    expect(result.value[0]!.source).toBeNull();
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
    const result = await readInputs(f, f.edgeDecisionDeclarationId);
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value[0]).toMatchObject({ state: 'missing', reason: 'decision_not_applied' });
    // The read never mutates the already-replied Message.
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

  it('IN18 an owner-less legacy origin is forbidden and never guessed from the caller scope', async () => {
    const f = await openFixture(kind, { legacyOrigin: 'owner-less' });
    const result = await readInputs(f, f.legacyDeclarationId);
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(result).not.toHaveProperty('value');
    // No body is returned for either read path, and none is even opened.
    const page = await readPage(f, f.legacyDeclarationId);
    expect(page).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(page).not.toHaveProperty('value');
    expect(f.materialsSpy.openArtifactCalls).toBe(0);
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
