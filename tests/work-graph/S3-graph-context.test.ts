/**
 * Slice 3 §5.4: `views/graph-context-reader.ts` behavior contract (GR01–GR19).
 *
 * Every row reaches the code under test ONLY through the real view entry
 * `createGraphContextReader(deps)` and its four methods; nothing about the view
 * is mocked. The 19 rows run on both real RecordStore backends (memory and
 * SQLite), matching the service-test style of `R4c-execution-history-index` and
 * `R3g-role-spec`.
 *
 * Part 1 of the slice leaves the four methods as stubs, so these rows are RED
 * with `not implemented: GraphContextReadPort.<method>`; part 2 implements the
 * reader without editing this file. The fixture below fixes the exact §5.1
 * values (scope `p/w`, Goal `g`, Plan `p1`, stage `s`, Tasks `tA`/`tB`,
 * obligation `oB`, verification `vB/static`, legacy artifact `old-A`, Workspace
 * revision 7, edge requirement `{kind:'artifact', label:'A.out'}`, workspace
 * `w2`, the GR05/GR06 modules M1/M2, Rounds `ra`/`rb` and Sessions `sa`/`sb`).
 *
 * The two work Runs are NOT bare `RunSnapshot` records: the real execution
 * reader only ever returns `ready` for a claim-linked Run plus its TaskAttempt,
 * dispatch outbox, Lease and Session (`run-state-service.ts`). The fixture
 * therefore drives the runs through the real `TaskClaimPort`; the ended
 * upstream run is rewritten to `ended/completed` after its claim. One legal
 * QueryRun submission is written by the real `QueryJobPort`/`QueryExecution`
 * owners (Session `sq`) so the Query session bridge has a canonical
 * QueryJobSubmitted event and a persisted Session binding.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdoptedArchitecture, ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ModuleRef, SessionRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RoleBindingRefV1, RunRef, SourceRefV1, TaskTriple } from '../../src/contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { ArchitectureBaselinePin } from '../../src/contracts/governance.js';
import type { ContextExtensionsV1 } from '../../src/contracts/graph-context.js';
import type { GoalRef, WorkspaceRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import type { RoundSnapshot, VerificationRoundRef } from '../../src/contracts/verification.js';
import type { EncodedRecord, GoalRecordTransactionPort, PreparedCommit, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { LookupValue, RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { createInMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../../src/core/record-store/sqlite-record-store.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import { encodeProjectSnapshot, encodeWorkspaceSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { PLAN_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { PLAN_GOVERNANCE_RECORD_SCHEMAS, PLAN_STATE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-record-codecs.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import type { ArchitectureCatalogPort } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import { EVIDENCE_RECORD_SCHEMAS, encodeVerificationRoundSnapshot } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { materialRecordSchemas } from '../../src/core/work-graph/materials/record-readers.js';
import { SESSION_RECORD_SCHEMAS, encodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { SESSION_MESSAGE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createTaskContextInputService } from '../../src/core/work-graph/tasks/context-input-service.js';
import { TASK_CLAIM_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { ROLE_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/role-record-codecs.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import { createQueryExecution } from '../../src/core/work-graph/queries/query-execution.js';
import type { MaterialPort } from '../../src/core/work-graph/model/material-contracts.js';
import { createGraphContextReader } from '../../src/core/work-graph/views/graph-context-reader.js';
import type { ExecutionReadPort } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type {
  ContextReadRequestV1, GraphContextReadPort, GraphFindRequestV1, GraphLookRequestV1,
} from '../../src/core/work-graph/model/graph-context-contracts.js';

// -------------------------------------------------------------------------- //
// §5.1 exact fixture values                                                   //
// -------------------------------------------------------------------------- //

/** §5.1: `H(s)=sha256Hex(s)`. */
const H = (s: string): string => sha256Hex(s);
/** §5.1: `B(s)=Buffer.byteLength(s,'utf8')`. */
const B = (s: string): number => Buffer.byteLength(s, 'utf8');

const AT = '2026-09-24T00:00:00.000Z';
const HOST_ACTOR = Object.freeze({ kind: 'system' as const, id: 's3-graph-host' });

const scope: WorkspaceScope = { projectId: 'p', workspaceId: 'w' };
const goalRef: GoalRef = { aggregateType: 'Goal', projectId: 'p', goalId: 'g' };
const goalTwoRef: GoalRef = { aggregateType: 'Goal', projectId: 'p', goalId: 'g2' };
const planRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: 'p', planId: 'p1' };
const planRefTwo: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: 'p', planId: 'p2' };
const planTwoGoalRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: 'p', planId: 'p2g' };
const stageId = 's';
const taskA: TaskTriple = { projectId: 'p', goalId: 'g', taskId: 'tA' };
const taskB: TaskTriple = { projectId: 'p', goalId: 'g', taskId: 'tB' };
const runA: RunRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'runA' };
const runB: RunRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'runB' };
const sessionA: SessionRef = { projectId: 'p', sessionId: 'sa' };
const sessionB: SessionRef = { projectId: 'p', sessionId: 'sb' };
/** §5.4 GR17: the QueryRun's persisted Session binding (distinct so `sb` stays free for the work Run). */
const sessionQ: SessionRef = { projectId: 'p', sessionId: 'sq' };
const roundA: VerificationRoundRef = { aggregateType: 'VerificationRound', projectId: 'p', workspaceId: 'w', goalId: 'g', taskId: 'tA', runId: 'runA', roundId: 'ra' };
const roundB: VerificationRoundRef = { aggregateType: 'VerificationRound', projectId: 'p', workspaceId: 'w', goalId: 'g', taskId: 'tB', runId: 'runB', roundId: 'rb' };
const workspaceTwo: WorkspaceRef = { aggregateType: 'Workspace', projectId: 'p', workspaceId: 'w2' };
/** §5.1: legacy artifact body `old-A`, contentType, digest H('old-A'), sizeBytes 5, canonical owner runA. */
const oldA: ArtifactRef = {
  kind: 'artifact', contentType: 'text/plain', digest: H('old-A'), sizeBytes: B('old-A'),
  source: { kind: 'artifact', refId: 'old-A', revision: '1' },
};
const edgeRequirement = { kind: 'artifact', label: 'A.out' } as const;

/** §5.1 GR06 modules: M1 `B` responsibility `Build B` paths ['src/b']; M2 `Utility` responsibility `Utilities` paths ['src/shared']. */
const moduleM1: ModuleDefinition = {
  ref: { projectId: 'p', moduleId: 'M1' }, name: 'B', responsibility: 'Build B',
  paths: ['src/b'], interfaces: [],
};
const moduleM2: ModuleDefinition = {
  ref: { projectId: 'p', moduleId: 'M2' }, name: 'Utility', responsibility: 'Utilities',
  paths: ['src/shared'], interfaces: [],
};

const queryRunRef: QueryRunRef = {
  aggregateType: 'QueryRun', projectId: 'p', workspaceId: 'w', queryJobId: 'qj', runId: 'qr',
};
const queryJobRef: QueryJobRef = {
  aggregateType: 'QueryJob', projectId: 'p', workspaceId: 'w', queryJobId: 'qj',
};
const runtimeBudget: RuntimeBudget = {
  contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
  maxRequests: 4, maxToolCalls: 8, timeoutMs: null, perResponseTokens: 512,
};
const roleBinding: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 's3-graph-binding', templateId: 'builder', templateRevision: '1',
  bindingVersion: 1, policyRevision: 'legacy-template',
};

// -------------------------------------------------------------------------- //
// Fixture                                                                     //
// -------------------------------------------------------------------------- //

type Records = GoalRecordTransactionPort & RecordLookupPort;

type RecordSpy = {
  readMany: string[][];
  commits: number;
  lookups: number;
  lookupCommits: number;
  eventAt: number;
};

type FixtureOptions = {
  sharedModulePaths?: boolean;
  corruptCatalog?: boolean;
  withExtensions?: boolean;
  /** GR07: flip every searched lowercase `b` to `B`, so a case-sensitive `find b` is provably empty. */
  uppercaseB?: boolean;
};

/** Per-fixture strings that GR07 flips to uppercase. */
type FixtureVariant = {
  roleTemplateId: string;
  modulePaths: string[];
  sessionB: SessionRef;
  roundB: VerificationRoundRef;
};

type MaterialSpy = { openArtifactCalls: number; storeArtifactCalls: number };
type BodySpy = { reads: number };
type SessionSpy = { findSessionsCalls: number; readSessionCalls: number; contexts: CoreCallContext[] };
type ExecutionSpy = { readExecutionCalls: number; listExecutionsCalls: number; contexts: CoreCallContext[] };

type S3GraphFixture = {
  kind: 'memory' | 'sqlite';
  directory: string;
  records: Records;
  spy: RecordSpy;
  graph: GraphContextReadPort;
  ctx: CoreCallContext;
  queryCtx: CoreCallContext;
  workCtx: CoreCallContext;
  scope: WorkspaceScope;
  goalRef: GoalRef;
  goalTwoRef: GoalRef;
  planRef: PlanRevisionRef;
  planRefTwo: PlanRevisionRef;
  planTwoGoalRef: PlanRevisionRef;
  stageTwoId: string;
  tasks: { a: TaskTriple; b: TaskTriple };
  runs: { a: RunRef; b: RunRef };
  sessions: { a: SessionRef; b: SessionRef; q: SessionRef };
  rounds: { a: VerificationRoundRef; b: VerificationRoundRef };
  workspaceTwo: WorkspaceRef;
  oldA: ArtifactRef;
  catalog: AdoptedArchitecture;
  materialSpy: MaterialSpy;
  bodySpy: BodySpy;
  sessionSpy: SessionSpy;
  executionSpy: ExecutionSpy;
  switchToPlanTwo(): Promise<void>;
  close(): Promise<void>;
};

const fixtures: S3GraphFixture[] = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

function emptySpy(): RecordSpy {
  return { readMany: [], commits: 0, lookups: 0, lookupCommits: 0, eventAt: 0 };
}

/** "记录读取次数" (GR08/GR15/GR16) is every record read, not only `readMany`. */
function recordReads(spy: RecordSpy): number {
  return spy.readMany.length + spy.lookups + spy.lookupCommits + spy.eventAt;
}

function wrapRecords(target: Records, spy: RecordSpy): Records {
  return {
    async readMany(refKeys) {
      spy.readMany.push([...refKeys]);
      return target.readMany(refKeys);
    },
    async lookup(request) {
      spy.lookups += 1;
      return target.lookup(request);
    },
    async lookupCommit(input) {
      spy.lookupCommits += 1;
      return target.lookupCommit(input);
    },
    async commit(input) {
      spy.commits += 1;
      return target.commit(input);
    },
    async eventAt(cursor) {
      spy.eventAt += 1;
      return target.eventAt(cursor);
    },
  };
}

/** GR14: a real damaged record at its exact catalog key, not a port that answers `unavailable`. */
function corruptRecordReads(target: Records, refKey: string): Records {
  return {
    ...target,
    async readMany(refKeys) {
      const result = await target.readMany(refKeys);
      if (result.status !== 'ready') return result;
      return {
        status: 'ready',
        value: {
          ...result.value,
          records: result.value.records.map(record =>
            record.refKey === refKey ? { ...record, json: '{"broken":' } : record),
        },
      };
    },
  };
}

/** A material/body double only so the real input owner can be constructed; the
 * reading rows must never reach it (GR11 counts exactly zero calls). */
function materialDouble(spy: MaterialSpy): MaterialPort {
  return {
    async storeArtifact() {
      spy.storeArtifactCalls += 1;
      return { status: 'rejected', code: 'unsupported', reason: 'S3 graph fixture does not store materials' };
    },
    async openArtifact() {
      spy.openArtifactCalls += 1;
      return { status: 'rejected', code: 'unsupported', reason: 'S3 graph fixture does not open materials' };
    },
  };
}

function backendSchemas(): RecordBackendSchemas {
  const materials = materialRecordSchemas();
  return {
    records: [
      ...materials.records,
      ...PLAN_RECORD_SCHEMAS.records,
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records,
      ...PLAN_STATE_RECORD_SCHEMAS.records,
      ...ARCHITECTURE_CATALOG_SCHEMAS.records,
      ...EVIDENCE_RECORD_SCHEMAS.records,
      ...SESSION_RECORD_SCHEMAS.records,
      ...SESSION_MESSAGE_RECORD_SCHEMAS.records,
      ...TASK_CLAIM_RECORD_SCHEMAS.records,
      ...ROLE_RECORD_SCHEMAS.records,
      ...QUERY_JOB_RECORD_SCHEMAS.records,
    ],
    events: [
      ...materials.events,
      ...PLAN_RECORD_SCHEMAS.events,
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.events,
      ...PLAN_STATE_RECORD_SCHEMAS.events,
      ...ARCHITECTURE_CATALOG_SCHEMAS.events,
      ...EVIDENCE_RECORD_SCHEMAS.events,
      ...SESSION_RECORD_SCHEMAS.events,
      ...SESSION_MESSAGE_RECORD_SCHEMAS.events,
      ...TASK_CLAIM_RECORD_SCHEMAS.events,
      ...ROLE_RECORD_SCHEMAS.events,
      ...QUERY_JOB_RECORD_SCHEMAS.events,
      { eventType: 'S3GraphSeeded', schemaVersion: 1, validate: event => ({ status: 'decoded', value: event }) },
    ],
    lookups: [
      ...(materials.lookups ?? []),
      ...(PLAN_RECORD_SCHEMAS.lookups ?? []),
      ...(PLAN_GOVERNANCE_RECORD_SCHEMAS.lookups ?? []),
      ...(PLAN_STATE_RECORD_SCHEMAS.lookups ?? []),
      ...(ARCHITECTURE_CATALOG_SCHEMAS.lookups ?? []),
      ...(EVIDENCE_RECORD_SCHEMAS.lookups ?? []),
      ...(SESSION_RECORD_SCHEMAS.lookups ?? []),
      ...(SESSION_MESSAGE_RECORD_SCHEMAS.lookups ?? []),
      ...(TASK_CLAIM_RECORD_SCHEMAS.lookups ?? []),
      ...(ROLE_RECORD_SCHEMAS.lookups ?? []),
      ...(QUERY_JOB_RECORD_SCHEMAS.lookups ?? []),
    ],
  };
}

/** §5.1 scope seed: Project@1, Workspace@7 and the effective CompletionPolicy. */
const policyRef = {
  aggregateType: 'CompletionPolicyRevision' as const, projectId: 'p', policyId: 's3-policy', revision: 1,
};
const policyFixture = {
  schemaVersion: 1, identity: { policyId: 's3-policy' }, revision: 1,
  content: { schemaVersion: 1, requirementKinds: ['test', 'static'], minimumRequiredRequirementsPerObligation: 1 },
};
const POLICY_DIGEST = H(canonicalJson(policyFixture as unknown as JsonValue));

function scopeRecords(): EncodedRecord[] {
  const project = { ref: { aggregateType: 'Project' as const, projectId: 'p' }, revision: 1 };
  const workspace = { ref: { aggregateType: 'Workspace' as const, projectId: 'p', workspaceId: 'w' }, revision: 7 };
  const policySnapshot = {
    ref: policyRef, revision: 1, schemaVersion: 1, policyId: 's3-policy', contentRevision: 1,
    contentDigest: POLICY_DIGEST, content: policyFixture.content,
  };
  const policyActive = {
    ref: { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: 'p' }, projectId: 'p',
    revision: 1, activeRevision: policyRef,
  };
  return [
    encodeProjectSnapshot(project),
    encodeWorkspaceSnapshot(workspace),
    { refKey: canonicalJson(policyRef as unknown as JsonValue), schemaId: 'CompletionPolicyRevisionSnapshot@1',
      revision: 1, json: JSON.stringify(policySnapshot) },
    { refKey: canonicalJson(policyActive.ref as unknown as JsonValue), schemaId: 'ProjectCompletionPolicyActiveSnapshot@1',
      revision: 1, json: JSON.stringify(policyActive) },
  ];
}

function variantOf(options: FixtureOptions): FixtureVariant {
  if (options.uppercaseB === true) {
    return {
      roleTemplateId: 'Builder', modulePaths: ['src/B'],
      sessionB: { ...sessionB, sessionId: 'sB' }, roundB: { ...roundB, roundId: 'rB' },
    };
  }
  return {
    roleTemplateId: 'builder',
    modulePaths: options.sharedModulePaths === true ? ['src/shared'] : ['src/b'],
    sessionB, roundB,
  };
}

/** One shape-valid open VerificationRound record; the round codec keeps the
 * opaque configuration/identity/plan payloads as objects. */
function roundRecord(ref: VerificationRoundRef, subject: TaskTriple): EncodedRecord {
  const snapshot = {
    ref, revision: 1, schemaVersion: 1 as const,
    subject, subjectRunRef: { aggregateType: 'Run' as const, projectId: 'p', goalId: ref.goalId, runId: ref.runId },
    adoptedPlanRef: planRef, taskBasisRef: planRef,
    executor: HOST_ACTOR,
    configuration: {}, configurationDigest: H('s3-round-config'),
    identity: { schemaVersion: 1 }, sourceProof: { kind: 'current-workspace-only' },
    verificationPlan: { schemaVersion: 1 },
    checks: [], status: 'open' as const, outcome: null, gaps: [], evidenceRefs: [],
  };
  return encodeVerificationRoundSnapshot(snapshot as unknown as RoundSnapshot);
}

/** The §5.1 fact records: Goal g objective `Ship platform`, Plan p1@1 with stage
 * `s`/Tasks tA/tB, obligation oB and verification vB/static, Plan p2 (the GR10
 * switch target), the GR09 other Goal g2, Workspace w2, Rounds ra/rb and
 * Sessions sa/sb/sq. The Runs are created by the real claim path afterwards. */
function factRecords(architecturePin: ArchitectureBaselinePin, policyDigest: string, variant: FixtureVariant): EncodedRecord[] {
  const completionPolicyPin = {
    ref: { aggregateType: 'CompletionPolicyRevision' as const, projectId: 'p', policyId: 's3-policy', revision: 1 },
    digest: policyDigest,
  };
  const workspaceRef = { aggregateType: 'Workspace' as const, projectId: 'p', workspaceId: 'w' };
  const goal = {
    ref: goalRef, workspaceRef,
    objective: 'Ship platform', desiredState: 'active' as const, activePlanRevision: planRef, revision: 2,
  };
  const planBody = {
    revision: 1 as const, schemaVersion: 1 as const, goalRef, planId: 'p1', planRevision: 1,
    acceptedAt: AT,
    effectiveCompletionPolicy: completionPolicyPin,
    effectiveArchitectureBaseline: architecturePin,
    stages: [{ stageId, title: 'Main' }],
    tasks: [
      { taskId: 'tA', stageId, title: 'A', requirementLevel: 'required' as const, taskKind: 'work' as const,
        disposition: 'active' as const, phase: 'pending' as const, scope: { kind: 'stage' as const, stageId } },
      { taskId: 'tB', stageId, title: 'B', requirementLevel: 'required' as const, taskKind: 'work' as const,
        disposition: 'active' as const, phase: 'pending' as const, scope: { kind: 'stage' as const, stageId } },
    ],
    assignments: [
      { taskId: 'tA', role: variant.roleTemplateId, instruction: 'Implement A' },
      { taskId: 'tB', role: variant.roleTemplateId, instruction: 'Implement B' },
    ],
    obligations: [{
      obligationId: 'oB', title: 'Deliver B', requirementLevel: 'required' as const, taskIds: ['tA', 'tB'],
      verificationRequirements: [{ requirementId: 'vB', requirementLevel: 'required' as const, kind: 'static',
        description: 'node check-b.js' }],
    }],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [{ taskId: 'tB', dependsOnId: 'tA', requires: edgeRequirement }] },
  };
  const plan = { ...planBody, ref: planRef };
  const planTwo = { ...planBody, ref: planRefTwo, planId: 'p2' };
  const goalTwo = {
    ref: goalTwoRef, workspaceRef,
    objective: 'Ship the other platform', desiredState: 'active' as const,
    activePlanRevision: planTwoGoalRef, revision: 1,
  };
  const planTwoGoal = { ...planBody, ref: planTwoGoalRef, goalRef: goalTwoRef, planId: 'p2g' };
  const sessionRecord = (ref: SessionRef, kernelSessionId: string) => ({
    ref: plainSessionRefToAggregate(ref), revision: 1,
    kernel: { adapterId: 's3-graph-kernel', kernelSessionId },
    lifecycle: 'active' as const, health: 'available' as const,
    role: { kind: 'legacy_template' as const, templateId: variant.roleTemplateId, templateRevision: '1' },
    workspaceId: 'w', lastExecutionRef: null, occupancy: null, historyCursor: null,
    createdAt: AT, archivedAt: null,
  });
  return [
    { refKey: canonicalJson(goalRef as unknown as JsonValue), schemaId: 'GoalSnapshot@1', revision: 2, json: JSON.stringify(goal) },
    { refKey: canonicalJson(planRef as unknown as JsonValue), schemaId: 'PlanRevisionSnapshot@1', revision: 1, json: JSON.stringify(plan) },
    { refKey: canonicalJson(planRefTwo as unknown as JsonValue), schemaId: 'PlanRevisionSnapshot@1', revision: 1, json: JSON.stringify(planTwo) },
    { refKey: canonicalJson(goalTwoRef as unknown as JsonValue), schemaId: 'GoalSnapshot@1', revision: 1, json: JSON.stringify(goalTwo) },
    { refKey: canonicalJson(planTwoGoalRef as unknown as JsonValue), schemaId: 'PlanRevisionSnapshot@1', revision: 1, json: JSON.stringify(planTwoGoal) },
    encodeWorkspaceSnapshot({ ref: workspaceTwo, revision: 1 }),
    encodeSessionRecord(sessionRecord(sessionA, 'kernel-sa')),
    encodeSessionRecord(sessionRecord(variant.sessionB, 'kernel-sb')),
    encodeSessionRecord(sessionRecord(sessionQ, 'kernel-sq')),
    roundRecord(roundA, taskA),
    roundRecord(variant.roundB, taskB),
  ];
}

async function createFixture(kind: 'memory' | 'sqlite', options: FixtureOptions = {}): Promise<S3GraphFixture> {
  const directory = await mkdtemp(join(tmpdir(), `next-s3-graph-${kind}-`));
  const schemas = backendSchemas();
  const backend = kind === 'memory'
    ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ path: join(directory, 'ledger.sqlite'), schemas });

  const spy = emptySpy();
  const records = wrapRecords(backend.records, spy);
  const hostActor = HOST_ACTOR;
  const variant = variantOf(options);
  const localRoleBinding: RoleBindingRefV1 = { ...roleBinding, templateId: variant.roleTemplateId };

  const ctx: CoreCallContext = {
    projectId: 'p', workspaceId: 'w', principal: { kind: 'host', actor: { kind: 'human', id: 'u' } },
    materialReader: { kind: 'host', projectId: 'p', workspaceId: 'w', actor: { kind: 'human', id: 'u' } },
    signal: new AbortController().signal,
  };
  const queryCtx: CoreCallContext = {
    projectId: 'p', workspaceId: 'w',
    principal: { kind: 'query_run', queryRunRef, initiator: { kind: 'human', id: 'u' } },
    materialReader: { kind: 'host', projectId: 'p', workspaceId: 'w', actor: { kind: 'human', id: 'u' } },
    signal: new AbortController().signal,
  };
  const workCtx: CoreCallContext = {
    projectId: 'p', workspaceId: 'w',
    principal: { kind: 'work_run', runRef: runB, roleBinding: localRoleBinding },
    materialReader: { kind: 'host', projectId: 'p', workspaceId: 'w', actor: HOST_ACTOR },
    signal: new AbortController().signal,
  };

  const moduleOne: ModuleDefinition = { ...moduleM1, paths: variant.modulePaths };
  const chosenCatalog: AdoptedArchitecture = { modules: [moduleOne, { ...moduleM2 }], dependencies: [], requireDag: true };
  const seedEvent = (id: string) => ({
    eventId: id, eventType: 'S3GraphSeeded', schemaVersion: 1, occurredAt: AT,
    json: JSON.stringify({ eventId: id, eventType: 'S3GraphSeeded', schemaVersion: 1, occurredAt: AT }),
  });
  let seedSeq = 0;
  const seedEventId = () => `s3-graph-seed-${++seedSeq}`;

  // Seed the real scope first (Project/Workspace@7 + CompletionPolicy), so the
  // real catalog owner can adopt M1/M2 as real persisted architecture.
  const scopeSeedRecords = scopeRecords();
  const scopeSeed: PreparedCommit = {
    identityKey: 's3-graph-scope', fingerprint: 's3-graph-scope-v1',
    guards: scopeSeedRecords.map(record => ({ refKey: record.refKey, expectedRevision: null })),
    records: scopeSeedRecords, events: [seedEvent('s3-graph-scope-event')], claims: [], indexGuards: [], indexChanges: [],
  };
  const scoped = await backend.records.commit(scopeSeed);
  if (scoped.status !== 'committed') throw new Error(`S3 graph scope seed failed: ${JSON.stringify(scoped)}`);

  const baseCatalog = createArchitectureCatalogService({ records });
  const adopted = await baseCatalog.adoptInitialArchitecture(ctx, {
    input: { baselineId: 's3-baseline', catalog: chosenCatalog, description: 'S3 graph fixture architecture', constraints: [] },
    meta: {
      requestId: 's3-graph-adopt',
      expected: [
        { ref: { aggregateType: 'Project' as const, projectId: 'p' }, revision: 1 },
        { ref: { aggregateType: 'Workspace' as const, projectId: 'p', workspaceId: 'w' }, revision: 7 },
      ],
    },
  });
  if (adopted.status !== 'committed') throw new Error(`S3 graph catalog adopt failed: ${JSON.stringify(adopted)}`);
  const baselinePin: ArchitectureBaselinePin = {
    ref: adopted.value.baseline.ref, digest: adopted.value.baseline.contentDigest,
  };

  // Seed the §5.1 facts (Goal/Plans/Sessions/Rounds/other Goal) as real persisted records.
  const factSeedRecords = factRecords(baselinePin, POLICY_DIGEST, variant);
  const factSeed: PreparedCommit = {
    identityKey: 's3-graph-facts', fingerprint: 's3-graph-facts-v1',
    guards: factSeedRecords.map(record => ({ refKey: record.refKey, expectedRevision: null })),
    records: factSeedRecords, events: [seedEvent('s3-graph-facts-event')], claims: [], indexGuards: [], indexChanges: [],
  };
  const committed = await backend.records.commit(factSeed);
  if (committed.status !== 'committed') throw new Error(`S3 graph fixture seed failed: ${JSON.stringify(committed)}`);

  // The Runs are produced by the REAL claim path: each claim writes the
  // RunSnapshot + TaskAttempt + dispatch outbox + Lease + occupied Session the
  // real execution reader cross-checks (`run-state-service.ts`).
  const roleService = createRoleConfigurationService({ records, now: () => AT, eventId: seedEventId });
  const claimIds = ['runA', 'attempt-a', 'event-a', 'runB', 'attempt-b', 'event-b'];
  let claimExtra = 0;
  const claimNewId = () => claimIds.shift() ?? `s3-graph-claim-extra-${++claimExtra}`;
  const claimService = createTaskClaimService({ records, roles: roleService, now: () => AT, newId: claimNewId });

  async function claim(task: TaskTriple, sessionRef: SessionRef, requestId: string) {
    const result = await claimService.claimTask(ctx, {
      input: { goalRef, planRef, taskId: task.taskId, sessionRef, roleBinding: localRoleBinding,
        budget: { tokenBudget: 100000, deadline: null } },
      meta: { requestId, expected: [
        { ref: goalRef, revision: 2 },
        { ref: { aggregateType: 'Workspace' as const, projectId: 'p', workspaceId: 'w' }, revision: 7 },
        { ref: plainSessionRefToAggregate(sessionRef), revision: 1 },
      ] },
    });
    if (result.status !== 'committed') throw new Error(`S3 graph claim ${task.taskId} failed: ${JSON.stringify(result)}`);
    return result.value;
  }
  const claimA = await claim(taskA, sessionA, 's3-graph-claim-a');
  const claimB = await claim(taskB, variant.sessionB, 's3-graph-claim-b');
  if (claimA.runRef.runId !== 'runA') throw new Error(`S3 graph fixture expected runA, got ${claimA.runRef.runId}`);
  if (claimB.runRef.runId !== 'runB') throw new Error(`S3 graph fixture expected runB, got ${claimB.runRef.runId}`);

  // §5.1: runA is the ended/completed upstream Run. Its claim-linked records stay.
  const runAKey = canonicalJson(runA as unknown as JsonValue);
  const runARead = await records.readMany([runAKey]);
  if (runARead.status !== 'ready') throw new Error('S3 graph runA read failed');
  const runARecord = runARead.value.records.find(record => record.refKey === runAKey);
  if (runARecord === undefined) throw new Error('S3 graph runA record is absent');
  const runABody = JSON.parse(runARecord.json) as Record<string, unknown>;
  const runAEnded = { ...runABody, revision: runARecord.revision + 1, status: 'ended', outcome: 'completed', exitCode: 0, startedAt: AT, endedAt: AT };
  const ended = await records.commit({
    identityKey: 's3-graph-runA-ended', fingerprint: 's3-graph-runA-ended-v1',
    guards: [{ refKey: runAKey, expectedRevision: runARecord.revision }],
    records: [{ refKey: runAKey, schemaId: 'RunSnapshot@1', revision: runARecord.revision + 1, json: JSON.stringify(runAEnded) }],
    events: [seedEvent('s3-graph-runA-ended-event')], claims: [], indexGuards: [], indexChanges: [],
  });
  if (ended.status !== 'committed') throw new Error(`S3 graph runA end failed: ${JSON.stringify(ended)}`);

  // §5.1 legacy `old-A` body, canonical owner runA, behind a read counter.
  const bodyStore = new RawArtifactBodyStore();
  const bodySpy: BodySpy = { reads: 0 };
  const storedOldA = await bodyStore.put({
    body: 'old-A', contentType: 'text/plain',
    sourceRefs: [{ kind: 'artifact', refId: 'old-A', revision: '1' }],
    origin: { kind: 'run', owner: runA }, requestedAt: AT,
  });
  if (storedOldA.status !== 'ready') throw new Error(`S3 graph old-A body store failed: ${JSON.stringify(storedOldA)}`);
  const bodiesForReader: Pick<RawArtifactStorePort, 'read'> = {
    async read(ref) { bodySpy.reads += 1; return bodyStore.read(ref); },
  };

  // §5.4 GR17/GR18: ONE legal QueryRun submission (actor human/u) by the real
  // owners, with its persisted Session binding (sessionQ) from claimQuery.
  let queryEventSeq = 0;
  const queryEventId = () => `s3-graph-query-event-${++queryEventSeq}`;
  const queryExecution = createQueryExecution({
    records,
    roles: roleService,
    bodies: bodiesForReader,
    authorizeConfiguration: async () => ({
      status: 'ready',
      value: {
        configurationRevision: 's3-graph-host@1',
        permissions: { tools: ['read'], writeScope: [] },
        hostTemplate: { templateId: variant.roleTemplateId, revision: '1', digest: H('s3-graph-builder-template') },
        budget: runtimeBudget,
      },
    }),
    now: () => AT,
    eventId: queryEventId,
  });
  const queryJobs = createQueryJobService({
    records, now: () => AT, eventId: queryEventId,
    execution: { claimQuery: queryExecution.claimQuery, readQueryAnswer: queryExecution.readQueryAnswer },
  });
  const queryIntent: QueryJobIntentV1 = {
    schemaVersion: 1, intentId: 'qj', projectId: 'p', workspaceId: 'w', goalId: 'g',
    question: 'What is the current progress?', focusTaskRefs: [],
    budget: { maxTokens: 4096, deadline: null }, multiTurn: { maxRounds: 1 },
    correlationId: 's3-graph-corr',
    execution: { kind: 'semantic_query', roleBinding: localRoleBinding, runtimeBudget },
  };
  const submitted = await queryJobs.submitQueryJob(ctx, {
    input: { queryJobId: 'qj', runId: 'qr', intent: queryIntent },
    meta: { requestId: 's3-graph-query-submit', expected: [
      { ref: { aggregateType: 'Project' as const, projectId: 'p' }, revision: 1 },
      { ref: { aggregateType: 'Workspace' as const, projectId: 'p', workspaceId: 'w' }, revision: 7 },
      { ref: goalRef, revision: 2 },
      { ref: queryJobRef, revision: 0 },
      { ref: queryRunRef, revision: 0 },
    ] },
  });
  if (submitted.status !== 'committed') throw new Error(`S3 graph Query submit failed: ${JSON.stringify(submitted)}`);
  const queryClaimed = await queryJobs.claimQuery(ctx, {
    input: { queryRunRef, sessionRef: sessionQ },
    meta: { requestId: 's3-graph-query-claim', expected: [
      { ref: queryJobRef, revision: 1 },
      { ref: queryRunRef, revision: 1 },
      { ref: plainSessionRefToAggregate(sessionQ), revision: 1 },
    ] },
  });
  if (queryClaimed.status !== 'committed') throw new Error(`S3 graph Query claim failed: ${JSON.stringify(queryClaimed)}`);

  // GR14: keep the real catalog owner, but damage the stored catalog record at
  // its exact key; the port is never replaced by a fake `unavailable` answer.
  const catalogRef = {
    aggregateType: 'ArchitectureCatalog' as const, projectId: 'p',
    baselineId: adopted.value.baseline.ref.baselineId, revision: adopted.value.baseline.ref.revision,
  };
  const catalogKey = canonicalJson(catalogRef as unknown as JsonValue);
  const readerRecords = options.corruptCatalog === true ? corruptRecordReads(records, catalogKey) : records;

  const architecture: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'> = createArchitectureCatalogService({ records: readerRecords });
  const readerPlans = createPlanService({ records: readerRecords, now: () => AT, eventId: () => 's3-graph-reader-event' });
  const sessionDirectory = createSessionDirectory({ records: readerRecords, lookups: readerRecords });
  const sessionSpy: SessionSpy = { findSessionsCalls: 0, readSessionCalls: 0, contexts: [] };
  const sessions = {
    async findSessions(callCtx: CoreCallContext, input: Parameters<typeof sessionDirectory.findSessions>[1]) {
      sessionSpy.findSessionsCalls += 1;
      sessionSpy.contexts.push(callCtx);
      return sessionDirectory.findSessions(callCtx, input);
    },
    async readSession(callCtx: CoreCallContext, ref: SessionRef) {
      sessionSpy.readSessionCalls += 1;
      sessionSpy.contexts.push(callCtx);
      return sessionDirectory.readSession(callCtx, ref);
    },
  };
  const executionsReal = createRunStateReader({ records: readerRecords });
  const executionSpy: ExecutionSpy = { readExecutionCalls: 0, listExecutionsCalls: 0, contexts: [] };
  const executions: ExecutionReadPort = {
    async readExecution(callCtx, ref, readOptions) {
      executionSpy.readExecutionCalls += 1;
      executionSpy.contexts.push(callCtx);
      return executionsReal.readExecution(callCtx, ref, readOptions);
    },
    async listExecutions(callCtx, request) {
      executionSpy.listExecutionsCalls += 1;
      executionSpy.contexts.push(callCtx);
      const list = executionsReal.listExecutions;
      if (list === undefined) return { status: 'rejected', code: 'unsupported', reason: 'no list reader' };
      return list(callCtx, request);
    },
  };
  const materialSpy: MaterialSpy = { openArtifactCalls: 0, storeArtifactCalls: 0 };
  const inputs = createTaskContextInputService({
    records: readerRecords, materials: materialDouble(materialSpy), bodies: bodiesForReader, hostActor,
  });

  const extensions: ((callCtx: CoreCallContext, request: ContextReadRequestV1) => Promise<ReadResult<ContextExtensionsV1>>) | undefined =
    options.withExtensions === true
      ? async () => ({
          status: 'ready',
          value: {
            notes: { availability: 'available', rows: [{ key: 'note:module:M2', node: { kind: 'module', ref: moduleM2.ref }, text: 'B', sources: [] }] },
            anomalies: { availability: 'not_implemented', rows: [] },
            footprint: { availability: 'not_implemented', rows: [] },
            goalSettings: { availability: 'not_implemented', autonomy: null },
            decisions: { availability: 'not_implemented', rows: [] },
          },
        })
      : undefined;

  const graph = createGraphContextReader({
    records: readerRecords,
    goals: readerPlans,
    plans: readerPlans,
    architecture,
    sessions,
    executions,
    inputs,
    hostActor,
    ...(extensions === undefined ? {} : { extensions }),
  });

  const catalog = adopted.value.catalog?.catalog ?? chosenCatalog;
  const fixture: S3GraphFixture = {
    kind, directory, records: readerRecords, spy, graph, ctx, queryCtx, workCtx, scope, goalRef, goalTwoRef,
    planRef, planRefTwo, planTwoGoalRef, stageTwoId: stageId,
    tasks: { a: taskA, b: taskB }, runs: { a: runA, b: runB },
    sessions: { a: sessionA, b: variant.sessionB, q: sessionQ },
    rounds: { a: roundA, b: variant.roundB }, workspaceTwo, oldA, catalog,
    materialSpy, bodySpy, sessionSpy, executionSpy,
    async switchToPlanTwo() {
      const goalKey = canonicalJson(goalRef as unknown as JsonValue);
      const nextGoal = {
        ref: goalRef, workspaceRef: { aggregateType: 'Workspace' as const, projectId: 'p', workspaceId: 'w' },
        objective: 'Ship platform', desiredState: 'active' as const, activePlanRevision: planRefTwo, revision: 3,
      };
      const switched = await backend.records.commit({
        identityKey: 's3-graph-plan-switch', fingerprint: 's3-graph-plan-switch-v1',
        guards: [{ refKey: goalKey, expectedRevision: 2 }],
        records: [{ refKey: goalKey, schemaId: 'GoalSnapshot@1', revision: 3, json: JSON.stringify(nextGoal) }],
        events: [seedEvent('s3-graph-plan-switch-event')], claims: [], indexGuards: [], indexChanges: [],
      });
      if (switched.status !== 'committed') throw new Error(`S3 graph plan switch failed: ${JSON.stringify(switched)}`);
    },
    async close() {
      await backend.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
  fixtures.push(fixture);
  return fixture;
}

function readRequest(goal: GoalRef, focusTaskIds: string[], plan?: PlanRevisionRef): ContextReadRequestV1 {
  return plan === undefined ? { goalRef: goal, focusTaskIds } : { goalRef: goal, planRef: plan, focusTaskIds };
}

function nodeRequest(
  goal: GoalRef,
  node: GraphLookRequestV1['target'],
  relation: GraphLookRequestV1['relation'],
  limit = 20,
  afterCursor: string | null = null,
): GraphLookRequestV1 {
  return { goalRef: goal, target: node, relation, page: { afterCursor, limit } };
}

function pathRequest(goal: GoalRef, path: string, limit = 20): GraphLookRequestV1 {
  return { goalRef: goal, target: { kind: 'path', path }, relation: 'card', page: { afterCursor: null, limit } };
}

function findRequest(goal: GoalRef, needle: string, limit = 20, afterCursor: string | null = null): GraphFindRequestV1 {
  return { goalRef: goal, needle, page: { afterCursor, limit } };
}

/** Decode the real outer page cursor's `scopeKey` (GR17). */
function cursorScopeKey(cursor: string): string | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { scopeKey?: unknown };
    return typeof parsed.scopeKey === 'string' ? parsed.scopeKey : null;
  } catch {
    return null;
  }
}

async function revisionOf(records: Records, refKey: string): Promise<number | null> {
  const read = await records.readMany([refKey]);
  if (read.status !== 'ready') throw new Error('S3 graph revision read failed');
  return read.value.records.find(record => record.refKey === refKey)?.revision ?? null;
}

const taskNode = (ref: TaskTriple): GraphLookRequestV1['target'] => ({ kind: 'node', node: { kind: 'task', ref, planRef } });
const stageNode: GraphLookRequestV1['target'] = { kind: 'node', node: { kind: 'stage', planRef, stageId } };

describe.each(['memory', 'sqlite'] as const)('S3 graph context reader (%s)', kind => {
  it('GR01 tB card carries oB/vB/Implement B and the p1@1 source', async () => {
    const fixture = await createFixture(kind);
    const result = await fixture.graph.lookGraph(fixture.ctx, nodeRequest(fixture.goalRef, taskNode(fixture.tasks.b), 'card'));
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    const card = result.value.items[0]!;
    expect(card.task!.obligations[0]!.obligationId).toBe('oB');
    expect(card.task!.obligations[0]!.verificationRequirements[0]!.requirementId).toBe('vB');
    expect(card.task!.assignment!.instruction).toBe('Implement B');
    expect(card.sources).toContainEqual(expect.objectContaining({ kind: 'record', ref: planRef, revision: 1 }));
  });

  it('GR02 stage s children page tA then tB', async () => {
    const fixture = await createFixture(kind);
    const first = await fixture.graph.lookGraph(fixture.ctx, nodeRequest(fixture.goalRef, stageNode, 'children', 1));
    expect(first).toMatchObject({ status: 'ready' });
    if (first.status !== 'ready') return;
    expect(first.value.items).toHaveLength(1);
    expect(first.value.items[0]!.node).toMatchObject({ kind: 'task', ref: taskA });
    expect(first.value.nextCursor).not.toBeNull();
    const second = await fixture.graph.lookGraph(fixture.ctx,
      nodeRequest(fixture.goalRef, stageNode, 'children', 1, first.value.nextCursor));
    expect(second).toMatchObject({ status: 'ready' });
    if (second.status !== 'ready') return;
    expect(second.value.items).toHaveLength(1);
    expect(second.value.items[0]!.node).toMatchObject({ kind: 'task', ref: taskB });
    expect(second.value.nextCursor).toBeNull();
  });

  it('GR03 task neighbours keep the tA dependency edge and not parent/child', async () => {
    const fixture = await createFixture(kind);
    const result = await fixture.graph.lookGraph(fixture.ctx, nodeRequest(fixture.goalRef, taskNode(fixture.tasks.b), 'neighbours'));
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    // The row's exact neighbour set: only the upstream tA dependency edge.
    expect(result.value.items.map(item => item.node)).toEqual([{ kind: 'task', ref: taskA, planRef }]);
    const upstream = result.value.items.find(item => item.node.kind === 'task' && item.node.ref.taskId === 'tA');
    expect(upstream!.task!.downstream).toContainEqual({ consumer: taskB, requires: edgeRequirement });
    expect(result.value.items.map(item => item.node.kind)).not.toContain('stage');
  });

  it('GR04 tB executions are only runB and add no writes', async () => {
    const fixture = await createFixture(kind);
    const before = fixture.spy.commits;
    const result = await fixture.graph.lookGraph(fixture.ctx, nodeRequest(fixture.goalRef, taskNode(fixture.tasks.b), 'executions'));
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value.items.map(item => item.node)).toEqual([{ kind: 'run', ref: runB }]);
    expect(result.value.items.map(item => item.node)).not.toContainEqual({ kind: 'run', ref: runA });
    expect(fixture.spy.commits).toBe(before);
  });

  it('GR05 a path owned by M1 and M2 returns both modules by key order', async () => {
    const fixture = await createFixture(kind, { sharedModulePaths: true });
    expect(fixture.catalog.modules.map(module => module.paths)).toEqual([['src/shared'], ['src/shared']]);
    const result = await fixture.graph.lookGraph(fixture.ctx, pathRequest(fixture.goalRef, 'src/shared'));
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value.items).toHaveLength(2);
    expect(result.value.items.map(item => item.node)).toEqual([
      { kind: 'module', ref: { projectId: 'p', moduleId: 'M1' } },
      { kind: 'module', ref: { projectId: 'p', moduleId: 'M2' } },
    ]);
  });

  it('GR06 find B returns task:tB, module:M1, run:runB and never note-only M2', async () => {
    const fixture = await createFixture(kind, { withExtensions: true });
    const result = await fixture.graph.findGraph(fixture.ctx, findRequest(fixture.goalRef, 'B'));
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value.items.map(item => item.node)).toEqual([
      { kind: 'task', ref: taskB, planRef }, { kind: 'module', ref: moduleM1.ref }, { kind: 'run', ref: runB },
    ]);
    expect(result.value.items.map(item => item.node)).not.toContainEqual({ kind: 'module', ref: moduleM2.ref });
  });

  it('GR07 find b is empty because matching is case-sensitive', async () => {
    // Uppercase-B-only fixture: no searched field (module path, Session name,
    // role JSON, Round name) carries a lowercase `b`.
    const fixture = await createFixture(kind, { uppercaseB: true });
    const result = await fixture.graph.findGraph(fixture.ctx, findRequest(fixture.goalRef, 'b'));
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value.items).toEqual([]);
  });

  it('GR08 find limit 0 is invalid before any record read', async () => {
    const fixture = await createFixture(kind);
    const before = recordReads(fixture.spy);
    const result = await fixture.graph.findGraph(fixture.ctx, findRequest(fixture.goalRef, 'B', 0));
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(recordReads(fixture.spy)).toBe(before);
  });

  it('GR09 a cursor from another Goal is invalid', async () => {
    const fixture = await createFixture(kind);
    const otherStage: GraphLookRequestV1['target'] =
      { kind: 'node', node: { kind: 'stage', planRef: fixture.planTwoGoalRef, stageId: fixture.stageTwoId } };
    const foreign = await fixture.graph.lookGraph(fixture.ctx,
      nodeRequest(fixture.goalTwoRef, otherStage, 'children', 1));
    expect(foreign).toMatchObject({ status: 'ready' });
    if (foreign.status !== 'ready') return;
    expect(foreign.value.nextCursor).not.toBeNull();
    const result = await fixture.graph.findGraph(fixture.ctx,
      findRequest(fixture.goalRef, 'B', 20, foreign.value.nextCursor));
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
  });

  it('GR10 a page started on p1 is rejected after the Plan moved to p2', async () => {
    const fixture = await createFixture(kind);
    const first = await fixture.graph.lookGraph(fixture.ctx, nodeRequest(fixture.goalRef, stageNode, 'children', 1));
    expect(first).toMatchObject({ status: 'ready' });
    if (first.status !== 'ready') return;
    // Require a real first cursor: a non-paginating implementation must not pass.
    expect(first.value.nextCursor).not.toBeNull();
    await fixture.switchToPlanTwo();
    const result = await fixture.graph.lookGraph(fixture.ctx,
      nodeRequest(fixture.goalRef, stageNode, 'children', 1, first.value.nextCursor));
    expect(result).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(fixture.planRefTwo.planId).toBe('p2');
  });

  it('GR11 path ../x is invalid before any file or material read', async () => {
    const fixture = await createFixture(kind);
    const result = await fixture.graph.lookGraph(fixture.ctx, pathRequest(fixture.goalRef, '../x'));
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(fixture.materialSpy.openArtifactCalls).toBe(0);
    expect(fixture.materialSpy.storeArtifactCalls).toBe(0);
    expect(fixture.bodySpy.reads).toBe(0);
  });

  it('GR12 a node outside p/w is forbidden', async () => {
    const fixture = await createFixture(kind);
    const outside: GraphLookRequestV1['target'] = {
      kind: 'node',
      node: { kind: 'module', ref: { projectId: 'other', moduleId: 'M1' } },
    };
    const result = await fixture.graph.lookGraph(fixture.ctx, nodeRequest(fixture.goalRef, outside, 'card'));
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(fixture.workspaceTwo.workspaceId).toBe('w2');
  });

  it('GR13 without extensions all five availabilities are not_implemented', async () => {
    const fixture = await createFixture(kind);
    const result = await fixture.graph.readContextFacts(fixture.ctx, readRequest(fixture.goalRef, ['tB']));
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value.extensions.notes.availability).toBe('not_implemented');
    expect(result.value.extensions.anomalies.availability).toBe('not_implemented');
    expect(result.value.extensions.footprint.availability).toBe('not_implemented');
    expect(result.value.extensions.goalSettings.availability).toBe('not_implemented');
    expect(result.value.extensions.decisions.availability).toBe('not_implemented');
  });

  it('GR14 a damaged catalog codec is unavailable and never a ready empty graph', async () => {
    const fixture = await createFixture(kind, { corruptCatalog: true });
    const before = fixture.spy.commits;
    const result = await fixture.graph.readContextFacts(fixture.ctx, readRequest(fixture.goalRef, ['tB']));
    expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(fixture.spy.commits).toBe(before);
  });

  it('GR15 find limit 101 is invalid before any record read', async () => {
    const fixture = await createFixture(kind);
    const before = recordReads(fixture.spy);
    const result = await fixture.graph.findGraph(fixture.ctx, findRequest(fixture.goalRef, 'B', 101));
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(recordReads(fixture.spy)).toBe(before);
  });

  it('GR16 an empty find needle is invalid before any record read', async () => {
    const fixture = await createFixture(kind);
    const before = recordReads(fixture.spy);
    const result = await fixture.graph.findGraph(fixture.ctx, findRequest(fixture.goalRef, ''));
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(recordReads(fixture.spy)).toBe(before);
  });

  it('GR17 a legal QueryRun reads session sb with the original initiator', async () => {
    const fixture = await createFixture(kind);
    const commitsBefore = fixture.spy.commits;
    const materialBefore = fixture.materialSpy.openArtifactCalls;
    const bodyBefore = fixture.bodySpy.reads;
    const result = await fixture.graph.findGraph(fixture.queryCtx, findRequest(fixture.goalRef, 'sb'));
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value.items).toHaveLength(1);
    expect(result.value.items[0]!.node).toEqual({ kind: 'session', ref: fixture.sessions.b });
    expect(result.value.items[0]!.session!.ref.sessionId).toBe(fixture.sessions.b.sessionId);
    // The Session port receives an internal Host context with the ORIGINAL
    // submission actor human/u, never the query_run principal itself.
    expect(fixture.sessionSpy.contexts.length).toBeGreaterThan(0);
    for (const received of fixture.sessionSpy.contexts) {
      expect(received).toMatchObject({
        projectId: 'p', workspaceId: 'w',
        principal: { kind: 'host', actor: { kind: 'human', id: 'u' } },
        materialReader: { kind: 'host', actor: { kind: 'human', id: 'u' } },
      });
    }
    // The real outer cursor (from a genuinely paginating read) binds the
    // ORIGINAL QueryRun principal, not the internal bridge Host actor.
    const page = await fixture.graph.findGraph(fixture.queryCtx, findRequest(fixture.goalRef, 'b', 1));
    expect(page).toMatchObject({ status: 'ready' });
    if (page.status !== 'ready') return;
    expect(page.value.nextCursor).not.toBeNull();
    const expectedScopeKey = H(canonicalJson({
      projectId: 'p', workspaceId: 'w', goalId: 'g',
      principal: { kind: 'query_run', queryRunRef },
    } as unknown as JsonValue));
    expect(cursorScopeKey(page.value.nextCursor!)).toBe(expectedScopeKey);
    expect(fixture.spy.commits).toBe(commitsBefore);
    expect(fixture.materialSpy.openArtifactCalls).toBe(materialBefore);
    expect(fixture.bodySpy.reads).toBe(bodyBefore);
  });

  it('GR18 a QueryRun whose initiator differs from the submission is forbidden', async () => {
    const fixture = await createFixture(kind);
    const other: CoreCallContext = {
      ...fixture.queryCtx,
      principal: { kind: 'query_run', queryRunRef, initiator: { kind: 'human', id: 'other' } },
    };
    const before = fixture.spy.commits;
    const result = await fixture.graph.findGraph(other, findRequest(fixture.goalRef, 'sb'));
    expect(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
    // The Session port is never reached; this is the row's counter, not a raw
    // RecordStore lookup count.
    expect(fixture.sessionSpy.findSessionsCalls).toBe(0);
    expect(fixture.sessionSpy.readSessionCalls).toBe(0);
    expect(fixture.spy.commits).toBe(before);
  });

  it('GR19 a canonical Work runB executions read keeps the work_run Session context', async () => {
    const fixture = await createFixture(kind);
    const commitsBefore = fixture.spy.commits;
    const runKey = canonicalJson(runB as unknown as JsonValue);
    const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(fixture.sessions.b));
    const leaseKey = canonicalJson({ aggregateType: 'TaskLease', projectId: 'p', goalId: 'g', taskId: 'tB' } as unknown as JsonValue);
    const revisionsBefore = [
      await revisionOf(fixture.records, runKey),
      await revisionOf(fixture.records, sessionKey),
      await revisionOf(fixture.records, leaseKey),
    ];
    const result = await fixture.graph.lookGraph(fixture.workCtx, nodeRequest(fixture.goalRef, taskNode(fixture.tasks.b), 'executions'));
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value.items.map(item => item.node)).toEqual([{ kind: 'run', ref: runB }]);
    // The execution reader gets an internal p/w Host context whose actor is the
    // injected deps.hostActor and whose materialReader uses the same actor.
    expect(fixture.executionSpy.contexts.length).toBeGreaterThan(0);
    for (const received of fixture.executionSpy.contexts) {
      expect(received).toMatchObject({
        projectId: 'p', workspaceId: 'w',
        principal: { kind: 'host', actor: HOST_ACTOR },
        materialReader: { kind: 'host', actor: HOST_ACTOR },
      });
    }
    // The Session reader for a Work read keeps the ORIGINAL work_run context.
    expect(fixture.sessionSpy.contexts.length).toBeGreaterThan(0);
    for (const received of fixture.sessionSpy.contexts) {
      expect(received).toMatchObject({ principal: { kind: 'work_run', runRef: runB } });
    }
    // No Run/Session/lease revision moved and the ledger did not commit.
    expect([
      await revisionOf(fixture.records, runKey),
      await revisionOf(fixture.records, sessionKey),
      await revisionOf(fixture.records, leaseKey),
    ]).toEqual(revisionsBefore);
    expect(fixture.spy.commits).toBe(commitsBefore);
  });
});
