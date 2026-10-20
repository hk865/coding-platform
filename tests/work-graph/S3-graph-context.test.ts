/**
 * Slice 3 §5.4: `views/graph-context-reader.ts` behavior contract (GR01–GR19).
 *
 * Every row reaches the code under test ONLY through the real view entry
 * `createGraphContextReader(deps)` and its four methods; nothing about the view
 * is mocked. The 19 rows run on both real RecordStore backends (memory and
 * SQLite), matching the service-test style of `R4c-execution-history-index` and
 * `R3g-role-spec`.
 *
 * The fixture below fixes the §5.1 values (scope `p/w`, Goal `g`, Plans
 * `p1`/`p2`, stage `s`, Tasks `tA`/`tB` plus the required Goal-level `finish`
 * gate, obligation `oB`, verification `vB/static`, legacy artifact `old-A`,
 * edge requirement `{kind:'artifact', label:'A.out'}`, workspace `w2` and the
 * GR05/GR06 modules M1/M2) through the PUBLIC owners only: project/workspace
 * bootstrap and governance, `createGoal` for `g`/`g2`, propose/apply for
 * `p1`/`p2g`, `sessions/create` for A/B/Q, real claims, the shared real
 * Runtime start/finish for both runs, and real `openVerification` rounds.
 * GR10's `p2` is adopted on demand by a propose/apply based on `p1`.
 *
 * The two work Runs are ended through the shared real-Runtime helper (R-7),
 * never by rewriting a claimed Run. One legal QueryRun submission is written by
 * the real `QueryJobPort`/`QueryExecution` owners (Sessions A/B/Q are the
 * public creation results) so the Query session bridge has a canonical
 * QueryJobSubmitted event and a persisted Session binding.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { AdoptedArchitecture, ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RoleBindingRefV1, RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { ContextExtensionsV1 } from '../../src/contracts/graph-context.js';
import type { GoalRef, WorkspaceRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import type { RegisteredCommandCheck, TrustedCheckConfiguration, VerificationRoundRef } from '../../src/contracts/verification.js';
import type { GoalRecordTransactionPort, RecordBackendSchemas } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort } from '../../src/core/record-store/lookup-ports.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import type { ArchitectureCatalogPort } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { createEvidenceService } from '../../src/core/work-graph/evidence/evidence-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { EXECUTION_ENTRY_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/execution-entry-codecs.js';
import { MODEL_REQUEST_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/model-request-codecs.js';
import { SESSION_MESSAGE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { plainSessionRefToAggregate, sessionAggregateRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createTaskContextInputService } from '../../src/core/work-graph/tasks/context-input-service.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import { createQueryExecution } from '../../src/core/work-graph/queries/query-execution.js';
import type { MaterialPort } from '../../src/core/work-graph/model/material-contracts.js';
import { createGraphContextReader } from '../../src/core/work-graph/views/graph-context-reader.js';
import type { ExecutionReadPort } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { VerificationWorkspaceReader } from '../../src/core/workspace/verification-workspace-reader.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import { createTaskClaimFixture, type TaskClaimFixture } from '../helpers/task-claim-fixture.js';
import { createS2BRuntimeSteps } from '../helpers/S2B-runtime-steps-fixture.js';
import { B2_HOST } from '../helpers/B2-execution-fixture.js';
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
/** RW-13 item 4c: the optional third module, present only when `moduleThreePaths` is set. */
const moduleM3: ModuleDefinition = {
  ref: { projectId: 'p', moduleId: 'M3' }, name: 'Extra', responsibility: 'Extra',
  paths: ['lib'], interfaces: [],
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
  /** RW-13: M1 maps the ancestor `src`, M2 the deeper `src/shared`. */
  nestedModulePaths?: boolean;
  /** RW-13 item 4a: M1 declares several paths of one module, e.g. `['src','src/']`. */
  moduleOnePaths?: string[];
  /** RW-13 item 4b: M2's paths, to build a real two-module tie (both `['src']`). */
  moduleTwoPaths?: string[];
  /** RW-13 item 4c: an optional third module M3 (e.g. `['lib']`), omitted when unset. */
  moduleThreePaths?: string[];
  corruptCatalog?: boolean;
  withExtensions?: boolean;
  /** GR07: flip every searched lowercase `b` to `B`, so a case-sensitive `find b` is provably empty. */
  uppercaseB?: boolean;
};

/** Per-fixture strings that GR07 flips to uppercase. */
type FixtureVariant = {
  roleTemplateId: string;
  modulePaths: string[];
  moduleTwoPaths: string[];
  /** The id GR07 flips to `rB`; the real openVerification still issues the ref. */
  roundBId: string;
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

/** Additional real owners the GR world writes through (the claim fixture already
 * registers the Goal/Plan/Session/claim/Role schemas). */
const GRAPH_EXTRA_SCHEMAS: RecordBackendSchemas = {
  records: [...EVIDENCE_RECORD_SCHEMAS.records, ...EXECUTION_ENTRY_RECORD_SCHEMAS.records,
    ...MODEL_REQUEST_RECORD_SCHEMAS.records, ...CONTROL_RECORD_SCHEMAS.records,
    ...QUERY_JOB_RECORD_SCHEMAS.records, ...SESSION_MESSAGE_RECORD_SCHEMAS.records],
  events: [...EVIDENCE_RECORD_SCHEMAS.events, ...EXECUTION_ENTRY_RECORD_SCHEMAS.events,
    ...MODEL_REQUEST_RECORD_SCHEMAS.events, ...CONTROL_RECORD_SCHEMAS.events,
    ...QUERY_JOB_RECORD_SCHEMAS.events, ...SESSION_MESSAGE_RECORD_SCHEMAS.events],
  lookups: [...(EVIDENCE_RECORD_SCHEMAS.lookups ?? []), ...(EXECUTION_ENTRY_RECORD_SCHEMAS.lookups ?? []),
    ...(MODEL_REQUEST_RECORD_SCHEMAS.lookups ?? []), ...(CONTROL_RECORD_SCHEMAS.lookups ?? []),
    ...(QUERY_JOB_RECORD_SCHEMAS.lookups ?? []), ...(SESSION_MESSAGE_RECORD_SCHEMAS.lookups ?? [])],
};

/** The trusted completion policy the accepted Plan pins (vB is `static`). */
const POLICY_CONTENT = {
  schemaVersion: 1 as const, requirementKinds: ['test', 'static'], minimumRequiredRequirementsPerObligation: 1,
};

function variantOf(options: FixtureOptions): FixtureVariant {
  if (options.uppercaseB === true) {
    return {
      roleTemplateId: 'Builder', modulePaths: ['src/B'], moduleTwoPaths: ['src/shared'], roundBId: 'rB',
    };
  }
  return {
    roleTemplateId: 'builder',
    modulePaths: options.moduleOnePaths
      ?? (options.nestedModulePaths === true ? ['src']
        : options.sharedModulePaths === true ? ['src/shared'] : ['src/b']),
    moduleTwoPaths: options.moduleTwoPaths ?? ['src/shared'],
    roundBId: 'rb',
  };
}

/** The §5.1 two-task Plan plus the Goal-level `finish` gate the validator
 * requires outside stage `s`; the gate is carried by obligation oB. */
function planDraft(planId: string, goalId: string, variant: FixtureVariant): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId, planRevision: 1, goalId,
    stages: [{ stageId, title: 'Main' }],
    tasks: [
      { taskId: 'tA', stageId, title: 'A', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId } },
      { taskId: 'tB', stageId, title: 'B', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId } },
      { taskId: 'finish', title: 'Finish', requirementLevel: 'required', taskKind: 'gate',
        disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [
      { taskId: 'tA', role: variant.roleTemplateId, instruction: 'Implement A' },
      { taskId: 'tB', role: variant.roleTemplateId, instruction: 'Implement B' },
    ],
    obligations: [{
      obligationId: 'oB', title: 'Deliver B', requirementLevel: 'required', taskIds: ['tA', 'tB', 'finish'],
      verificationRequirements: [{ requirementId: 'vB', requirementLevel: 'required', kind: 'static',
        description: 'node check-b.js' }],
    }],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [{ taskId: 'tB', dependsOnId: 'tA', requires: edgeRequirement }] },
  };
}

/** The next v2 Plan: the accepted Plan's draft fields only, planId replaced. */
function draftFromPlan(plan: PlanRevisionSnapshot, planId: string): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId, planRevision: plan.planRevision + 1, goalId: plan.goalRef.goalId,
    stages: structuredClone(plan.stages), tasks: structuredClone(plan.tasks),
    assignments: structuredClone(plan.assignments ?? []), obligations: structuredClone(plan.obligations),
    taskHierarchy: structuredClone(plan.taskHierarchy), executionDag: structuredClone(plan.executionDag),
    taskRelations: structuredClone(plan.taskRelations ?? []),
    inputRequirements: structuredClone(plan.inputRequirements ?? []),
  };
}

/**
 * GR07: the public Session id is `session-<sha256(canonicalJson(input))>` over
 * `{"actor":{"id":"u","kind":"human"},"projectId":"p","requestId":"…"}`
 * (src/core/work-graph/sessions/session-directory.ts:140). Hand-worked literals:
 *   gr-session-88 {"actor":{"id":"u","kind":"human"},"projectId":"p","requestId":"gr-session-88"}
 *     -> session-2756a7606765207ade5e4a1939f9f49472a6af969cf7910d74a4719cd799ce73
 *   gr-session-92 {"actor":{"id":"u","kind":"human"},"projectId":"p","requestId":"gr-session-92"}
 *     -> session-51c986a1fca760447cad3a47f0786809fd73d20318d8c6c6c439e282d170d79a
 *   gr-session-44 {"actor":{"id":"u","kind":"human"},"projectId":"p","requestId":"gr-session-44"}
 *     -> session-dcf115308e5f3d0062a8d7e00ce65a374476573c8356d8414c43f4d70a3cd3a9
 * None of A/B/Q carries a `b`, so the uppercase fixture's match is only Builder.
 */
const SESSION_IDS: Readonly<Record<string, string>> = {
  'gr-session-88': 'session-2756a7606765207ade5e4a1939f9f49472a6af969cf7910d74a4719cd799ce73',
  'gr-session-92': 'session-51c986a1fca760447cad3a47f0786809fd73d20318d8c6c6c439e282d170d79a',
  'gr-session-44': 'session-dcf115308e5f3d0062a8d7e00ce65a374476573c8356d8414c43f4d70a3cd3a9',
};

async function createFixture(kind: 'memory' | 'sqlite', options: FixtureOptions = {}): Promise<S3GraphFixture> {
  const variant = variantOf(options);
  const base = await createTaskClaimFixture(kind, GRAPH_EXTRA_SCHEMAS);
  const rawRecords = base.records;
  const directory = base.directory;
  const projectRef = { aggregateType: 'Project' as const, projectId: 'p' };
  const workspaceRef = { aggregateType: 'Workspace' as const, projectId: 'p', workspaceId: 'w' };
  const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId: 'p', policyId: 's3-policy', revision: 1 };
  const activePolicyRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: 'p' };
  const actor = { kind: 'human' as const, id: 'u' };
  const ctx: CoreCallContext = {
    projectId: 'p', workspaceId: 'w', principal: { kind: 'host', actor },
    materialReader: { kind: 'host', projectId: 'p', workspaceId: 'w', actor }, signal: new AbortController().signal,
  };
  const queryCtx: CoreCallContext = {
    projectId: 'p', workspaceId: 'w',
    principal: { kind: 'query_run', queryRunRef, initiator: { kind: 'human', id: 'u' } },
    materialReader: { kind: 'host', projectId: 'p', workspaceId: 'w', actor },
    signal: new AbortController().signal,
  };
  const localRoleBinding: RoleBindingRefV1 = { ...roleBinding, templateId: variant.roleTemplateId };
  const claimBudget = { tokenBudget: 100000, deadline: null };
  let clock = AT;
  const now = (): string => clock;
  const setClock = (at: string): void => { clock = at; };
  let eventSeq = 0;
  const eventId = (): string => `gr-event-${++eventSeq}`;

  // ---- public bootstrap and governance -----------------------------------
  const bootstrap = createProjectBootstrapServices({ records: rawRecords, now, eventId });
  const createdProject = await bootstrap.projects.createProject(ctx, {
    input: { projectId: 'p' },
    meta: { requestId: 'gr-create-project', expected: [{ ref: projectRef, revision: 0 }] },
  });
  if (createdProject.status !== 'committed') throw new Error(`GR project setup failed: ${JSON.stringify(createdProject)}`);
  for (const [workspaceId, requestId] of [['w', 'gr-register-workspace'], ['w2', 'gr-register-w2']] as const) {
    const workspaceCtx: CoreCallContext = workspaceId === 'w' ? ctx : {
      ...ctx, workspaceId,
      materialReader: { kind: 'host', projectId: 'p', workspaceId, actor },
    };
    const registered = await bootstrap.projects.registerWorkspace(workspaceCtx, {
      input: { workspace: { projectId: 'p', workspaceId } },
      meta: { requestId, expected: [
        { ref: projectRef, revision: 1 },
        { ref: { aggregateType: 'Workspace' as const, projectId: 'p', workspaceId }, revision: 0 },
      ] },
    });
    if (registered.status !== 'committed') throw new Error(`GR workspace ${workspaceId} setup failed: ${JSON.stringify(registered)}`);
  }
  const installed = await bootstrap.completionPolicies.installCompletionPolicy(ctx, {
    input: { policyId: 's3-policy', contentRevision: 1, content: POLICY_CONTENT },
    meta: { requestId: 'gr-install-policy', expected: [
      { ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 },
    ] },
  });
  if (installed.status !== 'committed') throw new Error(`GR policy install failed: ${JSON.stringify(installed)}`);
  const activated = await bootstrap.completionPolicies.activateCompletionPolicy(ctx, {
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } },
    meta: { requestId: 'gr-activate-policy', expected: [
      { ref: projectRef, revision: 1 }, { ref: activePolicyRef, revision: 0 },
    ] },
  });
  if (activated.status !== 'committed') throw new Error(`GR policy activation failed: ${JSON.stringify(activated)}`);
  const modules: ModuleDefinition[] = [
    { ...moduleM1, paths: variant.modulePaths }, { ...moduleM2, paths: variant.moduleTwoPaths },
  ];
  if (options.moduleThreePaths !== undefined) modules.push({ ...moduleM3, paths: options.moduleThreePaths });
  const chosenCatalog: AdoptedArchitecture = { modules, dependencies: [], requireDag: true };
  const adopted = await createArchitectureCatalogService({ records: rawRecords }).adoptInitialArchitecture(ctx, {
    input: { baselineId: 's3-baseline', catalog: chosenCatalog, description: 'S3 graph fixture architecture', constraints: [] },
    meta: { requestId: 'gr-adopt-architecture', expected: [
      { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 },
    ] },
  });
  if (adopted.status !== 'committed') throw new Error(`GR architecture adoption failed: ${JSON.stringify(adopted)}`);

  // ---- Goal g + accepted Plan p1, Goal g2 + accepted Plan p2g ------------
  const createdGoal = await base.goals.createGoal(ctx, {
    meta: { requestId: 'gr-create-goal', expected: [
      { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 },
    ] },
    input: { goalId: 'g', workspace: scope, objective: 'Ship platform' },
  });
  if (createdGoal.status !== 'committed') throw new Error(`GR Goal g creation failed: ${JSON.stringify(createdGoal)}`);
  const proposedOne = await base.plans.proposePlan(ctx, {
    meta: { requestId: 'gr-propose-p1', expected: [{ ref: goalRef, revision: 1 }] },
    input: { goalRef, basedOn: null, draft: planDraft('p1', 'g', variant),
      reason: { text: 'S3 graph plan p1', sources: [] } },
  });
  if (proposedOne.status !== 'committed' || proposedOne.value.issues.length > 0) {
    throw new Error(`GR Plan p1 proposal failed: ${JSON.stringify(proposedOne)}`);
  }
  const appliedOne = await base.plans.applyPlanChange(ctx, {
    meta: { requestId: 'gr-apply-p1', expected: [{ ref: goalRef, revision: 1 }] },
    input: { proposalRef: proposedOne.value.ref, expectedProposalRevision: proposedOne.value.revision, decisionRefs: [] },
  });
  if (appliedOne.status !== 'committed') throw new Error(`GR Plan p1 adoption failed: ${JSON.stringify(appliedOne)}`);
  const plan = appliedOne.value;

  const createdGoalTwo = await base.goals.createGoal(ctx, {
    meta: { requestId: 'gr-create-goal-two', expected: [
      { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 },
    ] },
    input: { goalId: 'g2', workspace: scope, objective: 'Ship the other platform' },
  });
  if (createdGoalTwo.status !== 'committed') {
    throw new Error(`GR Goal g2 creation failed: ${JSON.stringify(createdGoalTwo)}`);
  }
  const proposedTwoGoal = await base.plans.proposePlan(ctx, {
    meta: { requestId: 'gr-propose-p2g', expected: [{ ref: goalTwoRef, revision: 1 }] },
    input: { goalRef: goalTwoRef, basedOn: null, draft: planDraft('p2g', 'g2', variant),
      reason: { text: 'S3 graph plan p2g', sources: [] } },
  });
  if (proposedTwoGoal.status !== 'committed' || proposedTwoGoal.value.issues.length > 0) {
    throw new Error(`GR Plan p2g proposal failed: ${JSON.stringify(proposedTwoGoal)}`);
  }
  const appliedTwoGoal = await base.plans.applyPlanChange(ctx, {
    meta: { requestId: 'gr-apply-p2g', expected: [{ ref: goalTwoRef, revision: 1 }] },
    input: { proposalRef: proposedTwoGoal.value.ref, expectedProposalRevision: proposedTwoGoal.value.revision, decisionRefs: [] },
  });
  if (appliedTwoGoal.status !== 'committed') throw new Error(`GR Plan p2g adoption failed: ${JSON.stringify(appliedTwoGoal)}`);

  // ---- Sessions A/B/Q through the public Session creation route ----------
  const roleRef = { kind: 'legacy_template' as const, templateId: variant.roleTemplateId, templateRevision: '1' };
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: 'r4c-claim-kernel', storeKey: 'r4c-claim-kernel-store', workspace: scope,
    databasePath: join(directory, 'kernel.sqlite'),
  }] });
  const sessionOperations = createSessionOperations({ sessions: base.sessionsPort, kernelStores });
  async function createPublicSession(requestId: string): Promise<{ ref: SessionRef; revision: number }> {
    const created = await sessionOperations.createSession(ctx, {
      workspace: scope, role: roleRef, recommendedRefs: [], initialLinks: [],
      meta: { requestId, expected: [] },
    });
    if (created.status !== 'completed') throw new Error(`GR Session ${requestId} creation failed: ${JSON.stringify(created)}`);
    // The operation returns the aggregate record; the SessionRef value itself is
    // the public plain `{projectId, sessionId}` (never the record envelope).
    const ref: SessionRef = { projectId: created.value.ref.projectId, sessionId: created.value.ref.sessionId };
    const expectedSessionId = SESSION_IDS[requestId];
    if (expectedSessionId === undefined) throw new Error(`GR Session ${requestId} has no hand-worked id`);
    // GR07: the real ids carry no `b`, so the uppercase fixture's match is only Builder.
    if (ref.sessionId !== expectedSessionId || ref.sessionId.includes('b')) {
      throw new Error(`GR Session id disagrees with the hand-worked literal for ${requestId}: ${ref.sessionId}`);
    }
    const card = await base.sessionsPort.readSession(ctx, ref);
    if (card.status !== 'ready') throw new Error(`GR Session ${requestId} read failed: ${JSON.stringify(card)}`);
    return { ref, revision: card.value.record.revision };
  }
  const sessionA = await createPublicSession('gr-session-88');
  const sessionB = await createPublicSession('gr-session-92');
  const sessionQ = await createPublicSession('gr-session-44');

  // ---- real claims A/B ---------------------------------------------------
  const claimIds = ['runA', 'attempt-a', 'event-a', 'runB', 'attempt-b', 'event-b'];
  let claimExtra = 0;
  const roleFacts = createRoleConfigurationService({ records: rawRecords, now, eventId });
  const claimService = createTaskClaimService({
    records: rawRecords, roles: roleFacts, now,
    newId: () => claimIds.shift() ?? `gr-claim-extra-${++claimExtra}`,
  });
  async function claim(task: TaskTriple, sessionRef: SessionRef, requestId: string) {
    const goalRead = await base.plans.queryGoal(ctx, goalRef);
    if (goalRead.status !== 'ready') throw new Error(`GR Goal read failed: ${JSON.stringify(goalRead)}`);
    const registration = await bootstrap.projects.readWorkspaceRegistration(ctx, scope);
    if (registration.status !== 'ready') throw new Error(`GR Workspace read failed: ${JSON.stringify(registration)}`);
    const card = await base.sessionsPort.readSession(ctx, sessionRef);
    if (card.status !== 'ready') throw new Error(`GR claim Session read failed: ${JSON.stringify(card)}`);
    const claimed = await claimService.claimTask(ctx, {
      input: { goalRef, planRef: plan.ref, taskId: task.taskId, sessionRef, roleBinding: localRoleBinding, budget: claimBudget },
      meta: { requestId, expected: [
        { ref: goalRef, revision: goalRead.value.goal.revision },
        { ref: workspaceRef, revision: registration.value.workspace.revision },
        { ref: plainSessionRefToAggregate(sessionRef), revision: card.value.record.revision },
      ] },
    });
    if (claimed.status !== 'committed') throw new Error(`GR claim ${task.taskId} failed: ${JSON.stringify(claimed)}`);
    return claimed.value;
  }
  const claimA = await claim(taskA, sessionA.ref, 'gr-claim-a');
  if (claimA.runRef.runId !== 'runA') throw new Error(`GR expected runA, got ${claimA.runRef.runId}`);

  // ---- real Runtime entry/terminal for BOTH runs (R-7) -------------------
  const bodies = new RawArtifactBodyStore();
  const bodySpy: BodySpy = { reads: 0 };
  const bodiesForReader: Pick<RawArtifactStorePort, 'read'> = {
    async read(ref) { bodySpy.reads += 1; return bodies.read(ref); },
  };
  const registrationAtRuntime = await bootstrap.projects.readWorkspaceRegistration(ctx, scope);
  if (registrationAtRuntime.status !== 'ready') {
    throw new Error(`GR runtime Workspace read failed: ${JSON.stringify(registrationAtRuntime)}`);
  }
  const runtimeBase: TaskClaimFixture = {
    ...base, ctx, scope, projectRef, workspaceRef, goalRef, planRef: plan.ref, plan,
    tasks: { first: taskA, second: taskB, gate: { projectId: 'p', goalId: 'g', taskId: 'finish' } },
    sessions: { first: sessionA.ref, second: sessionB.ref }, roleBinding: localRoleBinding, budget: claimBudget,
    records: rawRecords, plans: base.plans, sessionsPort: base.sessionsPort, roleService: base.roleService,
    service: claimService,
  };
  let runtimeSeq = 0;
  const runtimeSteps = await createS2BRuntimeSteps({
    base: runtimeBase, bodies, ctx, directory, scope, now, setClock, eventId,
    newId: () => `gr-runtime-${++runtimeSeq}`, consumerId: 'runtime-a',
    workspaceRevision: registrationAtRuntime.value.workspace.revision,
    // GR07's uppercase variant keeps only `Builder` as the folded `b`; the
    // trusted Host template must name the Session's own legacy template.
    host: {
      configurationRevision: B2_HOST.configurationRevision,
      permissions: B2_HOST.permissions,
      hostTemplate: { ...B2_HOST.hostTemplate, templateId: variant.roleTemplateId },
    },
  });
  const handleA = await runtimeSteps.start(claimA, {
    at: AT, replies: [{ kind: 'text', text: 'GR run A completed' }],
  });
  await handleA.entered;
  await runtimeSteps.finish(handleA, AT, 'completed');
  const claimB = await claim(taskB, sessionB.ref, 'gr-claim-b');
  if (claimB.runRef.runId !== 'runB') throw new Error(`GR expected runB, got ${claimB.runRef.runId}`);
  const handleB = await runtimeSteps.start(claimB, {
    at: AT, replies: [{ kind: 'text', text: 'GR run B completed' }],
  });
  await handleB.entered;
  await runtimeSteps.finish(handleB, AT, 'completed');
  // §5.1 legacy `old-A` body, canonical owner runA, behind a read counter.
  const storedOldA = await bodies.put({
    body: 'old-A', contentType: 'text/plain',
    sourceRefs: [{ kind: 'artifact', refId: 'old-A', revision: '1' }],
    origin: { kind: 'run', owner: claimA.runRef }, requestedAt: AT,
  });
  if (storedOldA.status !== 'ready') throw new Error(`GR old-A body store failed: ${JSON.stringify(storedOldA)}`);


  // ---- real openVerification for runA and runB --------------------------
  const workspaceHost: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      if (requested.projectId !== 'p' || requested.workspaceId !== 'w') {
        return { status: 'rejected', code: 'forbidden', reason: 'GR Workspace is not registered' };
      }
      return { status: 'ready', value: { root: directory,
        workspaceRevision: registrationAtRuntime.value.workspace.revision } };
    },
    async authorize(callCtx, requested) {
      if (callCtx.principal.kind !== 'host' || callCtx.projectId !== 'p' || callCtx.workspaceId !== 'w'
        || requested.projectId !== 'p' || requested.workspaceId !== 'w') {
        return { status: 'rejected', code: 'forbidden', reason: 'GR Host does not authorize verification source' };
      }
      return { status: 'ready', value: {
        subjectKey: 'host:gr-verification', permissionRevision: 'gr-permission@1', allowsRead: () => true,
      } };
    },
  };
  const staticCheck: RegisteredCommandCheck = {
    checkId: 'gr-vB-static', kind: 'static', command: 'echo GR_CHECK_OK', cwd: '.', timeoutMs: 60_000, taskIds: 'all',
  };
  const configuration: TrustedCheckConfiguration = {
    configurationRevision: 'gr-checks@1', workspace: workspaceRef, executor: actor,
    permissionRevision: 'gr-permission@1', sourceAccess: 'verification_workspace',
    processAccess: 'all_except_denied', deniedPrefixes: ['.git'], checks: [staticCheck],
  };
  const evidenceMaterials = createMaterialService({
    bodies, authority: createMaterialRecordReaders(rawRecords).authority, now,
  });
  const evidenceIds = ['ra', 'ra-event', variant.roundBId, `${variant.roundBId}-event`];
  let evidenceSeq = 0;
  const evidence = createEvidenceService({
    records: rawRecords, materials: evidenceMaterials, executions: createRunStateReader({ records: rawRecords }),
    workspaceHost, source: new VerificationWorkspaceReader(), configuration, now,
    newId: () => evidenceIds.shift() ?? `gr-evidence-${++evidenceSeq}`,
  });
  const openedA = await evidence.openVerification(ctx, {
    input: { subjectRunRef: claimA.runRef, subject: claimA.task, planRef: plan.ref },
    meta: { requestId: 'gr-open-a', expected: [] },
  });
  if (openedA.status !== 'committed') throw new Error(`GR openVerification A failed: ${JSON.stringify(openedA)}`);
  const openedB = await evidence.openVerification(ctx, {
    input: { subjectRunRef: claimB.runRef, subject: claimB.task, planRef: plan.ref },
    meta: { requestId: 'gr-open-b', expected: [] },
  });
  if (openedB.status !== 'committed') throw new Error(`GR openVerification B failed: ${JSON.stringify(openedB)}`);
  const roundA = openedA.value.ref;
  const roundB = openedB.value.ref;

  // ---- the QueryJob keeps its real submit/claim -------------------------
  let queryEventSeq = 0;
  const queryEventId = (): string => `gr-query-event-${++queryEventSeq}`;
  const queryExecution = createQueryExecution({
    records: rawRecords, roles: roleFacts, bodies: bodiesForReader,
    authorizeConfiguration: async () => ({
      status: 'ready',
      value: {
        configurationRevision: 'gr-host@1',
        permissions: { tools: ['read'], writeScope: [] },
        hostTemplate: { templateId: variant.roleTemplateId, revision: '1', digest: H('gr-builder-template') },
        budget: runtimeBudget,
      },
    }),
    now, eventId: queryEventId,
  });
  const queryJobs = createQueryJobService({
    records: rawRecords, now, eventId: queryEventId,
    execution: { claimQuery: queryExecution.claimQuery, readQueryAnswer: queryExecution.readQueryAnswer },
  });
  const queryIntent: QueryJobIntentV1 = {
    schemaVersion: 1, intentId: 'qj', projectId: 'p', workspaceId: 'w', goalId: 'g',
    question: 'What is the current progress?', focusTaskRefs: [],
    budget: { maxTokens: 4096, deadline: null }, multiTurn: { maxRounds: 1 },
    correlationId: 'gr-corr',
    execution: { kind: 'semantic_query', roleBinding: localRoleBinding, runtimeBudget },
  };
  const goalAtQuery = await base.plans.queryGoal(ctx, goalRef);
  if (goalAtQuery.status !== 'ready') throw new Error(`GR query Goal read failed: ${JSON.stringify(goalAtQuery)}`);
  const registrationAtQuery = await bootstrap.projects.readWorkspaceRegistration(ctx, scope);
  if (registrationAtQuery.status !== 'ready') {
    throw new Error(`GR query Workspace read failed: ${JSON.stringify(registrationAtQuery)}`);
  }
  const submitted = await queryJobs.submitQueryJob(ctx, {
    input: { queryJobId: 'qj', runId: 'qr', intent: queryIntent },
    meta: { requestId: 'gr-query-submit', expected: [
      { ref: projectRef, revision: registrationAtQuery.value.project.revision },
      { ref: workspaceRef, revision: registrationAtQuery.value.workspace.revision },
      { ref: goalRef, revision: goalAtQuery.value.goal.revision },
      { ref: queryJobRef, revision: 0 },
      { ref: queryRunRef, revision: 0 },
    ] },
  });
  if (submitted.status !== 'committed') throw new Error(`GR Query submit failed: ${JSON.stringify(submitted)}`);
  const querySessionCard = await base.sessionsPort.readSession(ctx, sessionQ.ref);
  if (querySessionCard.status !== 'ready') {
    throw new Error(`GR Query Session read failed: ${JSON.stringify(querySessionCard)}`);
  }
  const queryClaimed = await queryJobs.claimQuery(ctx, {
    input: { queryRunRef, sessionRef: sessionQ.ref },
    meta: { requestId: 'gr-query-claim', expected: [
      { ref: queryJobRef, revision: 1 },
      { ref: queryRunRef, revision: 1 },
      { ref: plainSessionRefToAggregate(sessionQ.ref), revision: querySessionCard.value.record.revision },
    ] },
  });
  if (queryClaimed.status !== 'committed') throw new Error(`GR Query claim failed: ${JSON.stringify(queryClaimed)}`);

  // ---- the graph reader over the real records ---------------------------
  const spy = emptySpy();
  const records = wrapRecords(rawRecords, spy);
  const catalogRef = {
    aggregateType: 'ArchitectureCatalog' as const, projectId: 'p',
    baselineId: adopted.value.baseline.ref.baselineId, revision: adopted.value.baseline.ref.revision,
  };
  const catalogKey = canonicalJson(catalogRef as unknown as JsonValue);
  const readerRecords = options.corruptCatalog === true ? corruptRecordReads(records, catalogKey) : records;

  const architecture: Pick<ArchitectureCatalogPort, 'readArchitectureRevision'> =
    createArchitectureCatalogService({ records: readerRecords });
  const readerPlans = createPlanService({ records: readerRecords, now, eventId });
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
  // The reader now requires `listExecutions` (C4-113): the spy always has the real one.
  const executions: ExecutionReadPort & Required<Pick<ExecutionReadPort, 'listExecutions'>> = {
    async readExecution(callCtx, ref, readOptions) {
      executionSpy.readExecutionCalls += 1;
      executionSpy.contexts.push(callCtx);
      return executionsReal.readExecution(callCtx, ref, readOptions);
    },
    async listExecutions(callCtx, request) {
      executionSpy.listExecutionsCalls += 1;
      executionSpy.contexts.push(callCtx);
      return executionsReal.listExecutions(callCtx, request);
    },
  };
  const materialSpy: MaterialSpy = { openArtifactCalls: 0, storeArtifactCalls: 0 };
  const inputs = createTaskContextInputService({
    records: readerRecords, materials: materialDouble(materialSpy), bodies: bodiesForReader, hostActor: HOST_ACTOR,
  });

  const extensions: ((callCtx: CoreCallContext, request: ContextReadRequestV1) => Promise<ReadResult<ContextExtensionsV1>>) | undefined =
    options.withExtensions === true
      ? async () => ({
          status: 'ready',
          value: {
            notes: {
              availability: 'available',
              understanding: { rows: [], norms: [], normsOmitted: 0 },
              general: [{ anchorKey: 'module:M2', noteId: 'note-m2', version: 1, kind: 'convention',
                conclusion: 'B', freshness: 'fresh', label: 'B' }],
            },
            anomalies: { availability: 'not_implemented', rows: [] },
            footprint: { availability: 'not_implemented', rows: [] },
            goalSettings: { availability: 'not_implemented', autonomy: null },
            decisions: { availability: 'not_implemented', rows: [] },
          },
        })
      : undefined;

  const graph = createGraphContextReader({
    records: readerRecords, goals: readerPlans, plans: readerPlans, architecture,
    sessions, executions, inputs, hostActor: HOST_ACTOR,
    ...(extensions === undefined ? {} : { extensions }),
  });

  const catalog = adopted.value.catalog?.catalog ?? chosenCatalog;
  const fixture: S3GraphFixture = {
    kind, directory, records: readerRecords, spy, graph, ctx, queryCtx,
    workCtx: {
      projectId: 'p', workspaceId: 'w',
      principal: { kind: 'work_run', runRef: claimB.runRef, roleBinding: localRoleBinding },
      materialReader: { kind: 'host', projectId: 'p', workspaceId: 'w', actor: HOST_ACTOR },
      signal: new AbortController().signal,
    },
    scope, goalRef, goalTwoRef, planRef: plan.ref, planRefTwo, planTwoGoalRef, stageTwoId: stageId,
    tasks: { a: taskA, b: taskB }, runs: { a: claimA.runRef, b: claimB.runRef },
    sessions: { a: sessionA.ref, b: sessionB.ref, q: sessionQ.ref },
    rounds: { a: roundA, b: roundB }, workspaceTwo, oldA, catalog,
    materialSpy, bodySpy, sessionSpy, executionSpy,
    async switchToPlanTwo() {
      const goalRead = await base.plans.queryGoal(ctx, goalRef);
      if (goalRead.status !== 'ready') throw new Error(`GR plan-switch Goal read failed: ${JSON.stringify(goalRead)}`);
      const sourceGraph = await base.plans.queryTaskGraph(ctx, { goalRef });
      if (sourceGraph.status !== 'ready') throw new Error(`GR plan-switch graph read failed: ${JSON.stringify(sourceGraph)}`);
      const active = goalRead.value.goal.activePlanRevision;
      if (active === null) throw new Error('GR plan switch requires p1 to be active');
      // GR10: the change is a public propose/apply based on p1, never a raw Goal rewrite.
      const proposed = await base.plans.proposePlan(ctx, {
        meta: { requestId: 'gr-propose-p2', expected: [{ ref: goalRef, revision: goalRead.value.goal.revision }] },
        input: { goalRef, basedOn: active, draft: draftFromPlan(sourceGraph.value.plan, 'p2'),
          reason: { text: 'GR10 switch p1 to p2', sources: [] } },
      });
      if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
        throw new Error(`GR Plan p2 proposal failed: ${JSON.stringify(proposed)}`);
      }
      const applied = await base.plans.applyPlanChange(ctx, {
        meta: { requestId: 'gr-apply-p2', expected: [{ ref: goalRef, revision: goalRead.value.goal.revision }] },
        input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
      });
      if (applied.status !== 'committed') throw new Error(`GR Plan p2 adoption failed: ${JSON.stringify(applied)}`);
    },
    async close() {
      await runtimeSteps.close();
      await base.close();
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
    expect(result.value.items.map(item => item.node)).toEqual([{ kind: 'run', ref: fixture.runs.b }]);
    expect(result.value.items.map(item => item.node)).not.toContainEqual({ kind: 'run', ref: fixture.runs.a });
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
      { kind: 'task', ref: fixture.tasks.b, planRef: fixture.planRef },
      { kind: 'module', ref: moduleM1.ref },
      { kind: 'session', ref: fixture.sessions.a },
      { kind: 'session', ref: fixture.sessions.b },
      { kind: 'session', ref: fixture.sessions.q },
      { kind: 'run', ref: fixture.runs.b },
      { kind: 'round', ref: fixture.rounds.b },
    ]);
    expect(result.value.items.map(item => item.node)).not.toContainEqual({ kind: 'module', ref: moduleM2.ref });
  });

  it('GR07 find b matches the same B/b nodes now that matching is NFC + ASCII-lowercased', async () => {
    // Uppercase-B-only fixture: every searched `b`/`B` (module path, Session
    // role JSON `Builder`, Round name) is case-folded, so `b` is no longer
    // empty. The real Session ids carry no `b`, so their match is only Builder.
    const fixture = await createFixture(kind, { uppercaseB: true });
    const result = await fixture.graph.findGraph(fixture.ctx, findRequest(fixture.goalRef, 'b'));
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value.items.map(item => item.node)).toEqual([
      { kind: 'task', ref: fixture.tasks.b, planRef: fixture.planRef },
      { kind: 'module', ref: moduleM1.ref },
      { kind: 'session', ref: fixture.sessions.a },
      { kind: 'session', ref: fixture.sessions.b },
      { kind: 'session', ref: fixture.sessions.q },
      { kind: 'run', ref: fixture.runs.b },
      { kind: 'round', ref: fixture.rounds.b },
    ]);
  });

  it('RW-13 find a nested path returns only its deepest owner, not the ancestor module', async () => {
    // M1 maps the ancestor `src`, M2 the deeper `src/shared`. A path query for
    // the deeper path must hit M2 alone; the old per-path longest match could
    // still let the shorter `src` claim it through `pathMatches`.
    const fixture = await createFixture(kind, { nestedModulePaths: true });
    const result = await fixture.graph.findGraph(fixture.ctx, findRequest(fixture.goalRef, 'src/shared'));
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    const nodes = result.value.items.map(item => item.node);
    expect(nodes).toContainEqual({ kind: 'module', ref: moduleM2.ref });
    expect(nodes).not.toContainEqual({ kind: 'module', ref: moduleM1.ref });
  });

  it('RW-13 find under an equal-prefix tie returns both tied modules', async () => {
    // M1 and M2 both declare `src/shared`; a deeper query has no single longest
    // owner. Rework 4 item 2(c) (lead ruling): both tied modules are hits, so
    // the reader sees that two modules claim the path.
    const fixture = await createFixture(kind, { sharedModulePaths: true });
    const result = await fixture.graph.findGraph(fixture.ctx, findRequest(fixture.goalRef, 'src/shared/x'));
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    const nodes = result.value.items.map(item => item.node);
    expect(nodes).toContainEqual({ kind: 'module', ref: moduleM1.ref });
    expect(nodes).toContainEqual({ kind: 'module', ref: moduleM2.ref });
  });

  it('RW-13 find keeps module identity when one module lists src and src/', async () => {
    // Item 4a: M1 is ONE module with two raw paths `src` and `src/`. The old
    // per-path candidates made those two equal-length candidates and reported a
    // tie, so a query under `src` (the owner's own directory) found nothing.
    const fixture = await createFixture(kind, { moduleOnePaths: ['src', 'src/'], moduleTwoPaths: ['lib'] });
    expect(fixture.catalog.modules.map(module => module.paths)).toEqual([['src', 'src/'], ['lib']]);
    for (const needle of ['src', 'src/a.ts']) {
      const result = await fixture.graph.findGraph(fixture.ctx, findRequest(fixture.goalRef, needle));
      expect(result).toMatchObject({ status: 'ready' });
      if (result.status !== 'ready') return;
      // Exactly the one owning module; not a tie, and no duplicate hit.
      expect(result.value.items.map(item => item.node)).toEqual([{ kind: 'module', ref: moduleM1.ref }]);
    }
  });

  it('RW-13 find on a real src/src tie returns both tied module hits', async () => {
    // Item 4c ruling: two DIFFERENT modules both list `src`, so the query equals
    // both paths. A tie at the longest prefix owns the query for BOTH modules:
    // the reader sees two claims, and neither is suppressed.
    const fixture = await createFixture(kind, { moduleOnePaths: ['src'], moduleTwoPaths: ['src'] });
    expect(fixture.catalog.modules.map(module => module.paths)).toEqual([['src'], ['src']]);
    const result = await fixture.graph.findGraph(fixture.ctx, findRequest(fixture.goalRef, 'src'));
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value.items.map(item => item.node)).toEqual([
      { kind: 'module', ref: moduleM1.ref },
      { kind: 'module', ref: moduleM2.ref },
    ]);
  });

  it('RW-13 find normalises a Src module path so src/a.ts still finds it', async () => {
    // Item 4a: ownership is decided on normalised paths, so the owner path must
    // be taken from them too. The old raw-path lookup left `Src` ownerless and
    // the query matched nothing.
    const fixture = await createFixture(kind, { moduleOnePaths: ['Src'], moduleTwoPaths: ['lib'] });
    const result = await fixture.graph.findGraph(fixture.ctx, findRequest(fixture.goalRef, 'src/a.ts'));
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value.items.map(item => item.node)).toEqual([{ kind: 'module', ref: moduleM1.ref }]);
  });

  it('RW-13 find on two modules that both declare src/ returns both hits for src', async () => {
    // Item 4b: the stripped `src/` is the query `src` itself, not a directory
    // under it; both equal longest owners are returned.
    const fixture = await createFixture(kind, { moduleOnePaths: ['src/'], moduleTwoPaths: ['src/'] });
    expect(fixture.catalog.modules.map(module => module.paths)).toEqual([['src/'], ['src/']]);
    const result = await fixture.graph.findGraph(fixture.ctx, findRequest(fixture.goalRef, 'src'));
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value.items.map(item => item.node)).toEqual([
      { kind: 'module', ref: moduleM1.ref },
      { kind: 'module', ref: moduleM2.ref },
    ]);
  });

  it('RW-13 find returns both tied src modules and never the shorter lib module', async () => {
    // Item 4c: M1 and M2 tie at the longest prefix `src`; M3 maps `lib` and
    // owns nothing near `src/a.ts`, so it stays out.
    const fixture = await createFixture(kind, {
      moduleOnePaths: ['src'], moduleTwoPaths: ['src'], moduleThreePaths: ['lib'],
    });
    expect(fixture.catalog.modules.map(module => module.paths)).toEqual([['src'], ['src'], ['lib']]);
    const result = await fixture.graph.findGraph(fixture.ctx, findRequest(fixture.goalRef, 'src/a.ts'));
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    const nodes = result.value.items.map(item => item.node);
    expect(nodes).toContainEqual({ kind: 'module', ref: moduleM1.ref });
    expect(nodes).toContainEqual({ kind: 'module', ref: moduleM2.ref });
    expect(nodes).not.toContainEqual({ kind: 'module', ref: moduleM3.ref });
  });

  it('RW-13 find still finds a module src/sub under the query src', async () => {
    // The stripped directory-under branch keeps a deeper path reachable when
    // the query is its ancestor directory.
    const fixture = await createFixture(kind, { moduleOnePaths: ['src/sub'] });
    const result = await fixture.graph.findGraph(fixture.ctx, findRequest(fixture.goalRef, 'src'));
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value.items.map(item => item.node)).toContainEqual({ kind: 'module', ref: moduleM1.ref });
  });

  it('S8A-16 find on a root-only `.` module returns it for any non-empty path', async () => {
    const fixture = await createFixture(kind, { moduleOnePaths: ['.'], moduleTwoPaths: ['lib'] });
    const result = await fixture.graph.findGraph(fixture.ctx, findRequest(fixture.goalRef, 'src/loose.ts'));
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value.items.map(item => item.node)).toEqual([{ kind: 'module', ref: moduleM1.ref }]);
  });

  it('S8A-17 find on two root `.` modules returns both tied modules', async () => {
    const fixture = await createFixture(kind, { moduleOnePaths: ['.'], moduleTwoPaths: ['.'] });
    const result = await fixture.graph.findGraph(fixture.ctx, findRequest(fixture.goalRef, 'src/loose.ts'));
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value.items.map(item => item.node)).toEqual([
      { kind: 'module', ref: moduleM1.ref },
      { kind: 'module', ref: moduleM2.ref },
    ]);
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

  it('GR17 a legal QueryRun reads session SB by its full real id with the original initiator', async () => {
    const fixture = await createFixture(kind);
    const commitsBefore = fixture.spy.commits;
    const materialBefore = fixture.materialSpy.openArtifactCalls;
    const bodyBefore = fixture.bodySpy.reads;
    const result = await fixture.graph.findGraph(fixture.queryCtx,
      findRequest(fixture.goalRef, fixture.sessions.b.sessionId));
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
    const runKey = canonicalJson(fixture.runs.b as unknown as JsonValue);
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
    expect(result.value.items.map(item => item.node)).toEqual([{ kind: 'run', ref: fixture.runs.b }]);
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
      expect(received).toMatchObject({ principal: { kind: 'work_run', runRef: fixture.runs.b } });
    }
    // No Run/Session/lease revision moved and the ledger did not commit.
    expect([
      await revisionOf(fixture.records, runKey),
      await revisionOf(fixture.records, sessionKey),
      await revisionOf(fixture.records, leaseKey),
    ]).toEqual(revisionsBefore);
    expect(fixture.spy.commits).toBe(commitsBefore);
  });

  it('S8A-18 find on `.` returns every module', async () => {
    const fx = await createFixture(kind, { moduleOnePaths: ['.'], moduleTwoPaths: ['src/a'] });
    const result = await fx.graph.findGraph(fx.ctx, findRequest(fx.goalRef, '.'));
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.value.items.map(item => item.node)).toEqual([
      { kind: 'module', ref: moduleM1.ref },
      { kind: 'module', ref: moduleM2.ref },
    ]);
  });
});
