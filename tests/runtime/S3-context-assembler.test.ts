/**
 * Slice 3 CA01–CA15 (spec §5.5): the context assembler of
 * `src/core/agent-runtime/context-assembler.ts`.
 *
 * The pure formatting/budget rows (CA01, CA02, CA05–CA08, CA12) reach
 * `renderContext`/`renderContinuationBriefZh` directly. The prepare/binding rows
 * (CA03, CA04, CA15) run on the real WP2 memory composition root (T2-034): the
 * public Project/Workspace/policy/architecture/Goal/Plan set-up, the Session
 * `runtime.createSession` creates, the real claim, and the public
 * `runtime.prepareExecution`/`runtime.startRun`. Their counters are delegating
 * wrappers that return the real result unchanged. The remaining assembler rows
 * (CA09–CA11, CA13, CA14) reach the assembler entry the row names with the
 * §5.1 execution record, role resolution, Host configuration, permissions, and
 * narrow `graphContext`/`taskInputs` ports.
 *
 * One `it` per case row. `H(s)=sha256Hex(s)` and `B(s)=Buffer.byteLength(s,'utf8')`
 * are written as those exact expressions (§5.1). Part 1 of the slice leaves the
 * assembler a stub, so the assembler rows are red with
 * `not implemented: …`; that is the expected part-1 state.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleConfigurationRef } from '../../src/contracts/core/identity.js';
import type { SessionRecord } from '../../src/contracts/core/session.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { ContinuationBriefV1, ContinuationToolCallV1 } from '../../src/contracts/continuation-brief.js';
import { continuationBriefDigest, renderContinuationBriefZh } from '../../src/contracts/continuation-brief.js';
import type {
  DispatchOutboxRef, RoleBindingRefV1, RunRef, RunSnapshot, SourceRefV1, TaskAttemptRef, TaskAttemptSnapshot,
  TaskBudgetV1, TaskTriple,
} from '../../src/contracts/dispatch.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type {
  ContextExtensionsV1, InputDeclarationV1, InputSelectionV1, TaskInputPageV1,
} from '../../src/contracts/graph-context.js';
import type { GoalRef, GoalSnapshot, WorkspaceRef, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import type { RoleSpecContentV1, RoleSpecRevisionRef } from '../../src/contracts/role-spec.js';
import type { RoleSpecResolutionV1 } from '../../src/contracts/role-spec-materials.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import type { ContextAssemblerDependencies } from '../../src/core/agent-runtime/context-assembler.js';
import type { ResolvedRuntimeConfiguration } from '../../src/core/agent-runtime/execution-contracts.js';
import type { RawArtifactPut, RawArtifactRecord } from '../../src/core/record-store/body-ports.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import type { StoreResult } from '../../src/core/record-store/ports.js';
import type { TaskClaimOutbox } from '../../src/core/work-graph/model/claim-contracts.js';
import type { TaskContextInputPort } from '../../src/core/work-graph/model/context-input-contracts.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { GraphContextFactsV1, GraphContextReadPort } from '../../src/core/work-graph/model/graph-context-contracts.js';
import type { MaterialPort } from '../../src/core/work-graph/model/material-contracts.js';
import type { QueryPreparationFacts } from '../../src/core/work-graph/queries/contracts.js';
import { createWP2Platform, preparedBundle, type WP2PlatformFixture } from '../helpers/WP2-platform-support.js';
import {
  CONTEXT_FORMAT_VERSION, CONTEXT_SECTION_ORDER,
  createContextAssembler, renderAttentionChanges, renderContext,
} from '../../src/core/agent-runtime/context-assembler.js';

void renderAttentionChanges;

// Literal values of the platform pack that the production constants no longer
// publish (J-07): the Work and Query context preludes.
const WORK_CONTEXT_PRELUDE = '# Verified runtime task input\n\nThis is the current task context assembled from formal platform facts; it is not a transcript.';
const QUERY_CONTEXT_PRELUDE = '# Verified read-only Query input\n\nThis is the current bounded Query context assembled from formal platform facts; it is not a transcript.';

const H = (s: string): string => sha256Hex(s);
const B = (s: string): number => Buffer.byteLength(s, 'utf8');

// -------------------------------------------------------------------------- //
// §5.1 unified fixture values                                                 //
// -------------------------------------------------------------------------- //

const AT = '2026-09-24T00:00:00.000Z';
const HOST_ACTOR = { kind: 'human' as const, id: 's3-ca-operator' };

const GOAL_REF: GoalRef = { aggregateType: 'Goal', projectId: 'p', goalId: 'g' };
const PLAN_REF: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: 'p', planId: 'p1' };
const WORKSPACE_REF: WorkspaceRef = { aggregateType: 'Workspace', projectId: 'p', workspaceId: 'w' };
const TASK_A: TaskTriple = { projectId: 'p', goalId: 'g', taskId: 'tA' };
const TASK_B: TaskTriple = { projectId: 'p', goalId: 'g', taskId: 'tB' };
const TASK_F: TaskTriple = { projectId: 'p', goalId: 'g', taskId: 'tF' };
const RUN_A_REF: RunRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'runA' };

/** §5.1: legacy artifact body `old-A`, digests/size derived from the body. */
const OLD_A: ArtifactRef = {
  kind: 'artifact', contentType: 'text/plain', digest: H('old-A'), sizeBytes: B('old-A'),
  source: { kind: 'artifact', refId: 'old-A', revision: '1' },
};

const ROLE_BINDING: RoleBindingRefV1 = {
  schemaVersion: 1, bindingId: 's3-ca-binding', templateId: 'builder', templateRevision: '1',
  bindingVersion: 1, policyRevision: 'legacy-template',
};
const TASK_BUDGET: TaskBudgetV1 = { tokenBudget: 4096, deadline: null };
const HOST_CONFIGURATION_REVISION = 's3-ca-host@1';
const CA_PERMISSIONS: TaskEnvelopeV1['permissions'] = {
  policyRevision: 'legacy-template', tools: ['read'], writeScope: [],
};

const GOAL_SNAPSHOT: GoalSnapshot = {
  ref: GOAL_REF, workspaceRef: WORKSPACE_REF, objective: 'Ship platform', desiredState: 'active',
  desiredStateRevision: 1, desiredStateRequestedBy: null, activePlanRevision: PLAN_REF, revision: 1,
  settings: { schemaVersion: 1, autonomy: 'after_plan_confirmation', order: 0, waitForGoalRef: null, parallelRisks: [] },
  continuedFrom: null, copiedInterventions: [],
  since: 'c0000000001' as GoalSnapshot['since'],
};
const WORKSPACE_SNAPSHOT: WorkspaceSnapshot = { ref: WORKSPACE_REF, revision: 7 };

const ROLE_SPEC_REF: RoleSpecRevisionRef = {
  aggregateType: 'RoleSpecRevision', projectId: 'p', roleId: 'builder', revision: 1,
};
const SESSION_ROLE: RoleConfigurationRef = {
  kind: 'role_spec', pin: { ref: ROLE_SPEC_REF, digest: H('builder-role-spec-content') },
};

function roleSpec(): RoleSpecContentV1 {
  return {
    schemaVersion: 1, platformDuty: 'executor', label: 'Executor', purpose: 'Execute the assigned task.',
    responsibility: ['execution'], requiredMaterials: [], optionalMaterials: [],
    permissions: { tools: ['read'], writeScope: 'none' },
    budget: { source: 'task-budget', scope: 'assigned-task' },
    requiredOutputs: [],
    exit: { success: 'the task is delivered', stop: 'the task cannot continue', handoff: 'state the facts and next step' },
  };
}

function resolvedRole(): Extract<RoleSpecResolutionV1, { status: 'resolved' }> {
  return { status: 'resolved', roleId: 'builder', revision: ROLE_SPEC_REF, spec: roleSpec() };
}

function roleResolution(): Extract<RoleSpecResolutionV1, { status: 'resolved' }> {
  return resolvedRole();
}

function runtimeConfiguration(): ResolvedRuntimeConfiguration {
  return {
    configurationRevision: HOST_CONFIGURATION_REVISION,
    model: {
      configuration: { revision: 's3-ca-model@1', provider: 'scripted', model: 's3-test', baseUrl: 'http://127.0.0.1' },
      client: {} as unknown as ResolvedRuntimeConfiguration['model']['client'],
    },
    budget: {
      contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
      maxRequests: 4, maxToolCalls: 8, timeoutMs: null, perResponseTokens: 512,
    },
    hostTemplate: { templateId: 'builder', revision: '1', digest: H('builder-template-revision-1') },
    tools: ['read'], writeScope: [],
    skills: { resourceRoot: 'resources/skills', enabledIds: [] },
    systemInstruction: 'Static executor system instruction: platform facts only.',
    deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
    platformDuty: 'executor', contextResidentBytes: 4096,
  };
}

const CTX: CoreCallContext = {
  projectId: 'p', workspaceId: 'w',
  principal: { kind: 'host', actor: HOST_ACTOR },
  materialReader: { kind: 'host', projectId: 'p', workspaceId: 'w', actor: HOST_ACTOR },
  signal: new AbortController().signal,
};

/** The default §5.1 accepted Plan: stage s (Main) with tA/tB, obligation oB/vB, edge A.out. */
function planSnapshot(): PlanRevisionSnapshot {
  return {
    schemaVersion: 2, ref: PLAN_REF, revision: 1, goalRef: GOAL_REF, planId: 'p1', planRevision: 1,
    acceptedAt: AT,
    effectiveCompletionPolicy: {
      ref: { aggregateType: 'CompletionPolicyRevision', projectId: 'p', policyId: 's3-policy', revision: 1 },
      digest: H('s3-policy-content'),
    },
    effectiveArchitectureBaseline: {
      ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: 'p', baselineId: 's3-baseline', revision: 1 },
      digest: H('s3-baseline-content'),
    },
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
    obligations: [{
      obligationId: 'oB', title: 'Deliver B', requirementLevel: 'required', taskIds: ['tB'],
      verificationRequirements: [{
        requirementId: 'vB', requirementLevel: 'required', kind: 'static', description: 'node check-b.js',
      }],
    }],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [{ taskId: 'tB', dependsOnId: 'tA', requires: { kind: 'artifact', label: 'A.out' } }] },
    inputRequirements: [{ requirementId: 'legacy-old-a', consumerTaskId: 'tB', kind: 'artifact', artifactRef: OLD_A }],
  };
}

/** A `plan_only` task with no assignment, obligations or acceptance (CA10). */
function planOnlySnapshot(): PlanRevisionSnapshot {
  const plan = planSnapshot();
  return {
    ...plan,
    tasks: [{
      taskId: 'tF', title: 'Future F', requirementLevel: 'required', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'plan_only',
    }],
    assignments: [],
    obligations: [],
    executionDag: { dependsOn: [] },
    inputRequirements: [],
  } as PlanRevisionSnapshot;
}

function taskRecord(input: {
  task: TaskTriple; runId: string; plan: PlanRevisionSnapshot; sessionId: string;
}): TaskExecutionRecord {
  const runRef: RunRef = { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: input.runId };
  const attemptRef: TaskAttemptRef = {
    aggregateType: 'TaskAttempt', projectId: 'p', goalId: 'g', taskId: input.task.taskId,
    attemptId: `attempt-${input.runId}`,
  };
  const outboxRef: DispatchOutboxRef = {
    aggregateType: 'DispatchOutboxEntry', projectId: 'p', goalId: 'g', taskId: input.task.taskId,
    attemptId: attemptRef.attemptId,
  };
  const claim: TaskClaim = {
    task: input.task, planRef: input.plan.ref, workspaceId: 'w',
    sessionRef: { projectId: 'p', sessionId: input.sessionId }, sessionRevision: 1, generation: 1,
    runRef, previousRun: null, attemptRef, outboxRef, claimedAt: AT,
  };
  const outbox: TaskClaimOutbox = { ref: outboxRef, revision: 1, schemaVersion: 1, status: 'pending', claim };
  const run: RunSnapshot = {
    ref: runRef, revision: 1, schemaVersion: 1, task: input.task, attemptId: attemptRef.attemptId,
    planRef: input.plan.ref, roleBinding: ROLE_BINDING, budget: TASK_BUDGET,
    workspaceSnapshot: { workspaceId: 'w', revision: 7 }, status: 'starting', outcome: null, exitCode: null,
    lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '', envelope: null, startedAt: null, endedAt: null, previousRun: null,
  };
  const attempt: TaskAttemptSnapshot = {
    ref: attemptRef, revision: 1, schemaVersion: 1, runId: input.runId, planRef: input.plan.ref,
    status: 'claimed', startedAt: null, endedAt: null, endOutcome: null,
  };
  const session: SessionRecord = {
    ref: { aggregateType: 'Session', projectId: 'p', sessionId: input.sessionId }, revision: 1,
    kernel: { adapterId: 's3-ca-kernel', kernelSessionId: `ks-${input.sessionId}` },
    lifecycle: 'active', health: 'available', role: SESSION_ROLE, workspaceId: 'w',
    lastExecutionRef: null, occupancy: null, historyCursor: null, createdAt: AT, archivedAt: null,
    provenance: { schemaVersion: 1, kind: 'new' },
  };
  return { run, attempt, outbox, plan: input.plan, session, lease: null, readThrough: null };
}

function workRecord(): TaskExecutionRecord {
  return taskRecord({ task: TASK_B, runId: 'runB', plan: planSnapshot(), sessionId: 'sb' });
}

function endedRecordA(): TaskExecutionRecord {
  const record = taskRecord({ task: TASK_A, runId: 'runA', plan: planSnapshot(), sessionId: 'sa' });
  record.run = { ...record.run, status: 'ended', outcome: 'completed', exitCode: 0, endedAt: AT };
  return record;
}

function assemblerInput(record: TaskExecutionRecord) {
  return { execution: record, role: roleResolution(), configuration: runtimeConfiguration(), permissions: CA_PERMISSIONS,
    toolNames: ['read'], history: { callKind: 'work' as const,
      hasCompletedCursor: false } };
}

const CA_ASSEMBLER_INPUT = assemblerInput(workRecord());

// -------------------------------------------------------------------------- //
// Narrow dependency doubles (the row names what it tests; everything else is a //
// narrow port, never the code under test).                                    //
// -------------------------------------------------------------------------- //

/** The five extension seams are unassembled by default (CA14). */
function notImplementedExtensions(): ContextExtensionsV1 {
  return {
    notes: { availability: 'not_implemented', understanding: { rows: [], norms: [], normsOmitted: 0 }, general: [] },
    anomalies: { availability: 'not_implemented', rows: [] },
    footprint: { availability: 'not_implemented', rows: [] },
    goalSettings: { availability: 'not_implemented', autonomy: null },
    decisions: { availability: 'not_implemented', rows: [] },
  };
}

function graphFacts(overrides: Partial<GraphContextFactsV1> = {}): GraphContextFactsV1 {
  return {
    goal: GOAL_SNAPSHOT, graph: null, architecture: null, executions: [], inputs: [],
    extensions: notImplementedExtensions(), sources: [], readThrough: null, ...overrides,
  };
}

function graphContextOf(facts: GraphContextFactsV1 | (() => GraphContextFactsV1)): GraphContextReadPort {
  return {
    async readContextFacts() {
      return { status: 'ready', value: typeof facts === 'function' ? facts() : facts };
    },
    async lookGraph() { return { status: 'not_found' }; },
    async findGraph() { return { status: 'not_found' }; },
    async readAttentionFacts() { return { status: 'not_found' }; },
  };
}

function taskInputsOf(selections: InputSelectionV1[], page: TaskInputPageV1 | null = null): TaskContextInputPort {
  return {
    async readTaskInputs() { return { status: 'ready', value: selections }; },
    async readTaskInputPage() {
      return page === null ? { status: 'not_found' } : { status: 'ready', value: page };
    },
  };
}

/** A material double so the assembler can be constructed; these rows never open material. */
function materialDouble(): MaterialPort {
  return {
    async storeArtifact() {
      return { status: 'rejected', code: 'unsupported', reason: 'the CA fixture does not store material' };
    },
    async openArtifact() {
      return { status: 'rejected', code: 'unsupported', reason: 'the CA fixture does not open material' };
    },
  };
}

function bodyStore() {
  const records = new Map<string, RawArtifactRecord>();
  return {
    async put(input: RawArtifactPut): Promise<StoreResult<{ ref: ArtifactRef; replayed: boolean }>> {
      const fallbackSource: SourceRefV1 = { kind: 'workspace', refId: 'w', revision: '7' };
      const ref: ArtifactRef = {
        kind: 'artifact', contentType: input.contentType, digest: artifactBodyDigest(input.body),
        sizeBytes: B(input.body), source: input.sourceRefs[0] ?? fallbackSource,
      };
      if (!records.has(ref.digest)) {
        records.set(ref.digest, { ref, body: input.body, sourceRefs: input.sourceRefs, origin: input.origin });
      }
      return { status: 'ready', value: { ref, replayed: false } };
    },
    async read(ref: ArtifactRef): Promise<StoreResult<RawArtifactRecord>> {
      const record = records.get(ref.digest);
      return record === undefined
        ? { status: 'rejected', code: 'not_found', reason: `no body for ${ref.digest}` }
        : { status: 'ready', value: record };
    },
  };
}

function assemblerBase(): ContextAssemblerDependencies {
  return {
    executions: { readExecution: async () => ({ status: 'not_found' }) },
    roles: { resolveRoleBindingFacts: async () => ({ result: { status: 'not_found' }, guards: [] }) },
    materials: materialDouble(),
    bodies: bodyStore(),
  };
}

/** The assembler with only the minimum substitution; every row names its own deps. */
function assemblerWith(deps: {
  graphContext?: GraphContextReadPort;
  taskInputs?: TaskContextInputPort;
} = {}) {
  const base = assemblerBase();
  return createContextAssembler({
    ...base,
    ...(deps.graphContext === undefined ? {} : { graphContext: deps.graphContext }),
    ...(deps.taskInputs === undefined ? {} : { taskInputs: deps.taskInputs }),
  });
}

// -------------------------------------------------------------------------- //
// CA03/CA04/CA15: the real WP2 memory platform (T2-034).                      //
// -------------------------------------------------------------------------- //

type ReadCounts = { graph: number; inputs: number; brief: number };

/**
 * A3: counting wrappers on the platform's one `graphContext`/`taskInputs`
 * owners, the same objects the Runtime's assembler reads through. Each wrapper
 * counts the call and returns the real result unchanged.
 */
function countReads(f: WP2PlatformFixture): ReadCounts {
  const counts: ReadCounts = { graph: 0, inputs: 0, brief: 0 };
  const graph = f.platform.graphContext;
  const readContextFacts = graph.readContextFacts.bind(graph);
  const readAttentionFacts = graph.readAttentionFacts.bind(graph);
  graph.readContextFacts = (...args) => { counts.graph += 1; return readContextFacts(...args); };
  graph.readAttentionFacts = (...args) => { counts.brief += 1; return readAttentionFacts(...args); };
  const inputs = f.platform.taskInputs;
  const readTaskInputs = inputs.readTaskInputs.bind(inputs);
  const readTaskInputPage = inputs.readTaskInputPage.bind(inputs);
  inputs.readTaskInputs = (...args) => { counts.inputs += 1; return readTaskInputs(...args); };
  inputs.readTaskInputPage = (...args) => { counts.inputs += 1; return readTaskInputPage(...args); };
  return counts;
}

/**
 * A3: a delegating counter on the platform's real memory body store. Every
 * `put` runs the real store and returns its result unchanged; the counter only
 * keeps the requests.
 */
function countBodyPuts(): { puts(): RawArtifactPut[]; restore(): void } {
  const spy = vi.spyOn(RawArtifactBodyStore.prototype, 'put');
  return { puts: () => spy.mock.calls.map(([input]) => input), restore: () => { spy.mockRestore(); } };
}

/** CA04: a Goal understanding note, written through the public note owner. */
function goalUnderstandingDraft(goalId: string, conclusion: string): NoteDraftV1 {
  return {
    anchor: { kind: 'goal', goalId }, extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [],
    contradicts: [], coexistWith: [], kind: 'understanding', topic: 'understanding', conclusion,
    sections: { status: 's', decided: 'd', open: 'o', next: 'n', risks: 'r' },
  };
}

/**
 * CA04: a real successor Plan through the public propose/apply owners. The
 * draft is the accepted Plan the public Run read returned, plus one later
 * `plan_only` Task, so adopting it moves the Goal's active plan pointer.
 */
async function adoptSuccessorPlan(f: WP2PlatformFixture, plan: PlanRevisionSnapshot): Promise<PlanRevisionRef> {
  const goal = await f.platform.plans.queryGoal(f.ctx, f.goalRef);
  if (goal.status !== 'ready') throw new Error(`CA04 Goal read: ${JSON.stringify(goal)}`);
  const draft: PlanRevisionDraft = {
    schemaVersion: 2, planId: 'ca04-successor-plan', planRevision: plan.planRevision + 1, goalId: f.goalRef.goalId,
    stages: structuredClone(plan.stages),
    tasks: [...structuredClone(plan.tasks), { taskId: 'ca04-later', title: 'CA04 later work', requirementLevel: 'required',
      taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' }, executionIntent: 'plan_only' }],
    assignments: structuredClone(plan.assignments ?? []), obligations: structuredClone(plan.obligations),
    taskHierarchy: structuredClone(plan.taskHierarchy), executionDag: structuredClone(plan.executionDag),
    taskRelations: structuredClone(plan.taskRelations ?? []),
    inputRequirements: structuredClone(plan.inputRequirements ?? []),
  };
  const expected = [{ ref: f.goalRef, revision: goal.value.goal.revision }];
  const proposed = await f.platform.plans.proposePlan(f.ctx, {
    input: { goalRef: f.goalRef, basedOn: plan.ref, draft, reason: { text: 'CA04 successor plan', sources: [] } },
    meta: { requestId: 'ca04-propose', expected } });
  if (proposed.status !== 'committed' || proposed.value.issues.length > 0) {
    throw new Error(`CA04 successor proposal: ${JSON.stringify(proposed)}`);
  }
  const applied = await f.platform.plans.applyPlanChange(f.ctx, {
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
    meta: { requestId: 'ca04-apply', expected } });
  if (applied.status !== 'committed') throw new Error(`CA04 successor adoption: ${JSON.stringify(applied)}`);
  return applied.value.ref;
}

/** Narrows a `ReadResult` to its ready branch for the prepare rows. */
function ready<T>(result: T): Extract<T, { status: 'ready' }> {
  if ((result as { status?: string }).status !== 'ready') {
    throw new Error(`expected a ready result, got ${String((result as { status?: string }).status)}`);
  }
  return result as Extract<T, { status: 'ready' }>;
}

// -------------------------------------------------------------------------- //
// Pure renderer fixtures (CA01/CA02/CA05–CA08/CA12)                           //
// -------------------------------------------------------------------------- //

const REQUIRED = { role: 'R', goal: 'G', task: 'T' };
const ROWS = {
  footprint: [{ key: 'F', text: 'F' }],
  notes: [{ key: 'N', text: 'N' }],
  reminders: [{ key: 'M', text: 'M' }],
  inputs: [{ key: 'I', text: 'I' }],
};
const CA01_INPUT = `${WORK_CONTEXT_PRELUDE}\n\n## Runtime context\nR\n\n## Goal\nG\n\n## Accepted task\nT`
  + '\n\n## Footprint\nF\n\n## Note index\nN\n\n## Selected inputs\nI\n\n## Reminders\nM';

/** The optional part of CA01, used as the exact CA06 budget and string. */
const OPTIONAL_BILLED = '\n\n## Footprint\nF\n\n## Note index\nN\n\n## Reminders\nM\n\n## Selected inputs\nI';

const MULTI_ROWS = {
  footprint: [{ key: 'F1', text: 'F1' }, { key: 'F2', text: 'F2' }],
  notes: [{ key: 'N1', text: 'N1' }, { key: 'N2', text: 'N2' }],
  reminders: [{ key: 'M1', text: 'M1' }, { key: 'M2', text: 'M2' }],
  inputs: [{ key: 'I1', text: 'I1' }, { key: 'I2', text: 'I2' }],
};
/** The same rows, with the per-section item order and the section insertion order scrambled.
 * §11.4/L20: the `notes` rows keep their source order now, so only the other
 * three optional sections are scrambled here. */
const MULTI_ROWS_SCRAMBLED = {
  inputs: [{ key: 'I2', text: 'I2' }, { key: 'I1', text: 'I1' }],
  reminders: [{ key: 'M2', text: 'M2' }, { key: 'M1', text: 'M1' }],
  notes: [{ key: 'N1', text: 'N1' }, { key: 'N2', text: 'N2' }],
  footprint: [{ key: 'F2', text: 'F2' }, { key: 'F1', text: 'F1' }],
};

/** Returns the text of one frozen section, between its header and the next header. */
function sectionText(input: string, header: string, nextHeader: string): string {
  const start = input.indexOf(header);
  if (start < 0) return '';
  const end = nextHeader === '' ? input.length : input.indexOf(nextHeader, start + header.length);
  return input.slice(start + header.length, end < 0 ? input.length : end);
}

// -------------------------------------------------------------------------- //
// CA12: a complete legal C3 brief, rendered by the real renderer.             //
// -------------------------------------------------------------------------- //

const sha = (character: string): string => character.repeat(64);
function c3RunRef(runId: string): RunRef { return { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId }; }
function c3Artifact(contentType: string, digest = sha('a')): ArtifactRef {
  return { kind: 'artifact', contentType, digest, sizeBytes: 12, source: { kind: 'workspace', refId: 'w', revision: '3' } };
}
function c3ToolCall(callId: string): ContinuationToolCallV1 {
  return { callId, name: 'write_file', target: { text: 'src/a.ts', truncated: false }, result: 'success',
    sideEffect: 'confirmed', changedPaths: ['src/a.ts'], changedPathsOmitted: 0, error: null };
}

/** A complete `check_failed` rework brief continuing in another, seeded Session. */
function c3Brief(): ContinuationBriefV1 {
  const previousRun = c3RunRef('runB');
  const roundRef = { aggregateType: 'VerificationRound' as const, projectId: 'p', workspaceId: 'w', goalId: 'g', taskId: 'tB',
    runId: 'runB', roundId: 'rb' };
  return {
    schemaVersion: 1,
    runRef: c3RunRef('runB2'),
    task: TASK_B,
    requeueRef: { aggregateType: 'TaskRequeue', projectId: 'p', goalId: 'g', taskId: 'tB', afterRunId: 'runB' },
    mode: 'rework',
    failureClass: 'check_failed',
    trigger: { actorClass: 'system', goalResume: false, requeueNumber: 2, autoRework: { count: 1, cap: 3 },
      earlierRequeues: [{ afterRunId: 'runB1', failureClass: 'run_failed' }] },
    previous: {
      runRef: previousRun,
      attemptRef: { aggregateType: 'TaskAttempt', projectId: 'p', goalId: 'g', taskId: 'tB', attemptId: 'attempt-b' },
      sessionRef: { projectId: 'p', sessionId: 'sb' },
      outcome: 'completed', origin: 'observed', interruption: null, cancelledBy: null, error: null, limit: null, budget: null,
      wait: { messageRef: { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'w', messageId: 'm-1' }, status: 'responded' },
      unacceptedSteers: [{ intentRef: { aggregateType: 'ControlIntent', projectId: 'p', workspaceId: 'w', intentId: 'i-1' },
        text: { text: 'use the new helper', truncated: false } }],
      endedAt: AT,
    },
    factsFrom: { runRef: previousRun, hops: 0, truncated: false },
    stoppedAt: { kernel: 'read', reason: null, turnStatus: 'completed', lastPosition: 42,
      lastToolGroup: { sourceMessageId: 'msg-9', calls: 2 }, lastAssistant: { text: 'Done.', truncated: false },
      window: { fromPosition: 1, throughPosition: 42, omittedRecords: 0 } },
    toolCalls: { confirmed: [c3ToolCall('call-1')], notExecuted: [], unknown: [],
      confirmedOmitted: 0, notExecutedOmitted: 0, unknownOmitted: 0 },
    acceptedInputs: { steers: [], steersOmitted: 0,
      messages: [{ messageRef: { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'w', messageId: 'm-1' },
        part: 'response', excerpt: { text: 'answer', truncated: false } }], messagesOmitted: 0 },
    checks: { roundRef, roundOrdinal: 1,
      failing: [{ checkId: 'lint', phase: 'finished', outcome: 'FAIL', cause: null,
        reportRef: c3Artifact('application/vnd.coding-platform.verification-check-report+json;version=1') }],
      gapCodes: [] },
    requeue: { reason: { text: 'auto-rework: check_failed', truncated: false }, reasonAuthor: 'system',
      newInputs: [{ kind: 'artifact', ref: c3Artifact('text/markdown', sha('c')), body: { text: 'diagnosis', truncated: false } }] },
    workspace: {
      selfChanged: { status: 'known', confirmed: ['src/a.ts'], possible: [], omitted: 0 },
      checkpoints: [
        { kind: 'round_open', at: AT, workspaceRevision: 4, sourceDigest: sha('d'), unavailableReason: null },
        { kind: 'requeue', at: AT, workspaceRevision: null, sourceDigest: null, unavailableReason: 'too many files' },
        { kind: 'brief', at: AT, workspaceRevision: 5, sourceDigest: sha('e'), unavailableReason: null },
      ],
      segments: [{ from: 0, to: 1, verdict: 'unknown', reason: 'the later checkpoint has no source digest' },
        { from: 1, to: 2, verdict: 'unknown', reason: 'the earlier checkpoint has no source digest' }],
      unobserved: { from: 'previous_run_end', to: 0, previousEndedAt: AT },
      uncommitted: { status: 'git', baseCommit: 'abc123', paths: ['src/a.ts'], omitted: 0, reason: null },
    },
    session: { continuity: 'other_session_seeded', sessionRef: { projectId: 'p', sessionId: 'sb2' },
      seededFrom: { sessionRef: { projectId: 'p', sessionId: 'sb' }, throughPosition: 40 }, boundaryPosition: null },
    standingInstructionVersion: 1,
  };
}

// -------------------------------------------------------------------------- //
// CA09/CA11: missing and oversized selected inputs.                           //
// -------------------------------------------------------------------------- //

const MISSING_DECLARATION: InputDeclarationV1 = {
  declarationId: 'd1:missing-a', consumer: TASK_B, planRef: PLAN_REF, upstream: TASK_A,
  requires: { kind: 'artifact', label: 'A.out' }, legacyArtifactRef: null,
};
const MISSING_SELECTION: InputSelectionV1 = {
  declaration: MISSING_DECLARATION, state: 'missing', source: null, candidates: [],
  usage: 'historical_explanation', reason: 'no_labeled_output', errorCode: null,
};

const LONG_BODY = 'x'.repeat(5000);
const LONG_REF: ArtifactRef = {
  kind: 'artifact', contentType: 'text/plain', digest: H(LONG_BODY), sizeBytes: B(LONG_BODY),
  source: { kind: 'artifact', refId: 'long-body', revision: '1' },
};
const LONG_DECLARATION: InputDeclarationV1 = {
  declarationId: 'd1:long-body', consumer: TASK_B, planRef: PLAN_REF, upstream: null,
  requires: { kind: 'artifact', label: 'long-body' }, legacyArtifactRef: LONG_REF,
};
const LONG_SELECTION: InputSelectionV1 = {
  declaration: LONG_DECLARATION, state: 'selected', source: { kind: 'artifact', ref: LONG_REF, provenance: { kind: 'run', owner: RUN_A_REF } },
  candidates: [{ kind: 'artifact', ref: LONG_REF, provenance: { kind: 'run', owner: RUN_A_REF } }],
  usage: 'historical_explanation', reason: null, errorCode: null,
};

/** CA13: the formal Query facts, with the §5.1 Goal/Workspace and the original initiator. */
function queryFacts(): QueryPreparationFacts {
  return {
    record: {} as QueryPreparationFacts['record'],
    goal: GOAL_SNAPSHOT,
    workspace: WORKSPACE_SNAPSHOT,
    focusPlan: null,
    initiator: HOST_ACTOR,
  };
}

describe('S3 context assembler CA01-CA15', () => {
  it('CA01 renders the fixed work prelude and all seven sections byte for byte', () => {
    const result = renderContext({
      prelude: WORK_CONTEXT_PRELUDE, required: REQUIRED, optional: ROWS,
      continuationSuffix: null, residentBudgetBytes: 4096,
    });
    expect(result.input).toBe(CA01_INPUT);
    expect(result.totalBytes).toBe(B(CA01_INPUT));
    expect(H(result.input)).toBe(H(CA01_INPUT));
    expect(CONTEXT_FORMAT_VERSION).toBe('s3-context-v1');
    expect(CONTEXT_SECTION_ORDER).toEqual(['role', 'goal', 'task', 'footprint', 'notes', 'inputs', 'continuation', 'unknown_call_review', 'reminders']);
  });

  it('CA02 ignores the insertion order of the optional row arrays', () => {
    const ordered = renderContext({
      prelude: WORK_CONTEXT_PRELUDE, required: REQUIRED, optional: MULTI_ROWS,
      continuationSuffix: null, residentBudgetBytes: 4096,
    });
    const scrambled = renderContext({
      prelude: WORK_CONTEXT_PRELUDE, required: REQUIRED, optional: MULTI_ROWS_SCRAMBLED,
      continuationSuffix: null, residentBudgetBytes: 4096,
    });
    expect(scrambled).toEqual(ordered);
    expect(scrambled.input).toBe(ordered.input);
    expect(scrambled.totalBytes).toBe(ordered.totalBytes);
    expect(scrambled.residentBytes).toBe(ordered.residentBytes);
    expect(scrambled.sections).toEqual(ordered.sections);
  });

  it('CA03 two unbound preparations of the same facts share bytes and ArtifactRefs', async () => {
    const f = await createWP2Platform({ kind: 'memory', duty: 'secretary', ownedHost: true });
    const bodies = countBodyPuts();
    try {
      const first = (await preparedBundle(f, f.runRef!, 'ca03-first')).prepared;
      const second = (await preparedBundle(f, f.runRef!, 'ca03-second')).prepared;
      expect(second.inputBinding.inputDigest).toBe(first.inputBinding.inputDigest);
      expect(second.envelope.bundleRef).toEqual(first.envelope.bundleRef);
      expect(second.envelope.bundleRef.digest).toBe(first.envelope.bundleRef.digest);
      // The identical manifest is the same content-addressed body, never a second
      // body: the two prepares asked the real body store for exactly 1 distinct
      // manifest body (the manifest is the put whose content type the returned
      // bundleRef carries).
      const manifests = bodies.puts().filter(input => input.contentType === first.envelope.bundleRef.contentType);
      expect(new Set(manifests.map(input => input.body)).size).toBe(1);
    } finally {
      bodies.restore();
      await f.close();
    }
  });

  it('CA04 a bound context ignores changed Goal/notes and never rereads graph or inputs', async () => {
    // The real start is cancelled right after its Run entry-authorization
    // commit (the C-03/W-02 path), so the Run stays `starting` with the bound input.
    const controller = new AbortController();
    let armed = false;
    const f = await createWP2Platform({ kind: 'memory', duty: 'secretary', allowAnyRun: true, ownedHost: true,
      onCommit: notice => {
        if (armed && notice.aggregates.some(aggregate => aggregate.aggregateType === 'Run')) controller.abort();
      } });
    try {
      const counts = countReads(f);
      const first = (await preparedBundle(f, f.runRef!, 'ca04-first')).prepared;
      // The counter is live: the unbound assembly read the graph through it.
      expect(counts.graph).toBeGreaterThan(0);
      armed = true;
      const started = await f.platform.runtime.startRun({ ...f.ctx, signal: controller.signal },
        { prepared: first, consumerId: 'ca04-driver', requestId: 'ca04-start' });
      expect(started).toMatchObject({ status: 'rejected', code: 'cancelled' });
      // The entry owner bound the Prepared value; the Run now carries its inputBinding.
      const bound = await f.platform.executions.readExecution(f.ctx, f.runRef!);
      if (bound.status !== 'ready') throw new Error(`CA04 bound run read: ${JSON.stringify(bound)}`);
      expect(bound.value.run).toMatchObject({ status: 'starting', inputBinding: first.inputBinding });

      // Both upstream facts change after the bind: a real successor Plan moves
      // the Goal's plan pointer, and a real note write adds a Goal note.
      const successor = await adoptSuccessorPlan(f, bound.value.plan);
      expect(await f.platform.plans.queryGoal(f.ctx, f.goalRef))
        .toMatchObject({ status: 'ready', value: { goal: { activePlanRevision: successor } } });
      const note = await f.platform.notes.writeNote(f.ctx, { commandId: 'ca04-note',
        note: goalUnderstandingDraft(f.goalRef.goalId, 'changed understanding after bind'),
        expectedPointerRevision: null, goalId: f.goalRef.goalId });
      expect(note.status).toBe('accepted');

      counts.graph = 0;
      counts.inputs = 0;
      counts.brief = 0;
      const second = (await preparedBundle(f, f.runRef!, 'ca04-second')).prepared;
      expect(second).toEqual(first);
      // This world declares no inputs; input reads inside the graph read go
      // through the raw owner and are counted in `counts.graph`; `counts.inputs`
      // only guards a direct page read by the assembler.
      expect(counts.graph).toBe(0);
      expect(counts.inputs).toBe(0);
      expect(counts.brief).toBe(0);
    } finally {
      await f.close();
    }
  });

  it('CA05 obligations, acceptance and the brief are never cut even past 4096 bytes', () => {
    const obligations = 'obligations: Deliver B';
    const acceptance = 'acceptance: vB/static: node check-b.js';
    const brief = `continuation: ${'c'.repeat(5000)}`;
    const longTask = `plan: p1@1\n${obligations}\n${acceptance}\n${'t'.repeat(5000)}`;
    const result = renderContext({
      prelude: WORK_CONTEXT_PRELUDE, required: { role: 'R', goal: 'G', task: longTask },
      optional: {}, continuationSuffix: brief, residentBudgetBytes: 4096,
    });
    expect(result.input).toContain(obligations);
    expect(result.input).toContain(acceptance);
    expect(result.input).toContain(brief);
    expect(result.totalBytes).toBeGreaterThan(4096);
    expect(result.residentBytes).toBe(0);
  });

  it('CA06 a budget equal to the full billed string keeps every row and omits nothing', () => {
    const result = renderContext({
      prelude: WORK_CONTEXT_PRELUDE, required: REQUIRED, optional: ROWS,
      continuationSuffix: null, residentBudgetBytes: B(OPTIONAL_BILLED),
    });
    expect(result.input).toBe(CA01_INPUT);
    expect(result.residentBytes).toBe(B(OPTIONAL_BILLED));
    expect(result.sections.filter((section) => section.omitted > 0)).toEqual([]);
    for (const name of ['footprint', 'notes', 'reminders', 'inputs'] as const) {
      expect(result.sections.find((section) => section.name === name)?.omitted).toBe(0);
    }
  });

  it('CA07 keeps the longest global prefix and omits the rows that would not fit', () => {
    const rowF = 'F'.repeat(100);
    const rowX = 'X'.repeat(200);
    const rowY = 'Y';
    const billed = `\n\n## Footprint\n${rowF}\n另有 2 条，用‘看’读`;
    const result = renderContext({
      prelude: WORK_CONTEXT_PRELUDE, required: REQUIRED,
      optional: { footprint: [{ key: 'F', text: rowF }, { key: 'X', text: rowX }, { key: 'Y', text: rowY }] },
      continuationSuffix: null, residentBudgetBytes: B(billed),
    });
    expect(result.residentBytes).toBe(B(billed));
    expect(result.input).toContain(rowF);
    expect(result.input).not.toContain(rowX);
    expect(result.input).not.toContain(rowY);
    expect(result.sections.find((section) => section.name === 'footprint')?.omitted).toBe(2);
  });

  it('CA08 a zero budget omits all four optional sections and lists them on the task card', () => {
    const omissions = `\n\n## Context omissions\nfootprint: 另有 1 条，用‘看’读\nnotes: 另有 1 条，用‘看’读`
      + `\nreminders: 另有 1 条，用‘看’读\ninputs: 另有 1 条，用‘看’读`;
    const expected = `${WORK_CONTEXT_PRELUDE}\n\n## Runtime context\nR\n\n## Goal\nG\n\n## Accepted task\nT${omissions}`;
    const result = renderContext({
      prelude: WORK_CONTEXT_PRELUDE, required: REQUIRED, optional: ROWS,
      continuationSuffix: null, residentBudgetBytes: 0,
    });
    expect(result.input).toBe(expected);
    expect(result.residentBytes).toBe(0);
    expect(result.totalBytes).toBe(B(expected));
    for (const name of ['footprint', 'notes', 'reminders', 'inputs'] as const) {
      const section = result.sections.find((candidate) => candidate.name === name);
      expect(section?.omitted).toBe(1);
      expect(section?.startByte).toBeNull();
      expect(section?.endByte).toBeNull();
    }
    expect(result.input).not.toContain('## Footprint');
    expect(result.input).not.toContain('## Note index');
    expect(result.input).not.toContain('## Reminders');
    expect(result.input).not.toContain('## Selected inputs');
    expect(result.input).toContain('## Runtime context\nR');
    expect(result.input).toContain('## Goal\nG');
    expect(result.input).toContain('## Accepted task\nT');
  });

  it('CA09 a single 5000-byte input row is omitted whole, never truncated', async () => {
    const assembler = assemblerWith({
      graphContext: graphContextOf(graphFacts({ inputs: [LONG_SELECTION] })),
      taskInputs: taskInputsOf([LONG_SELECTION], {
        selection: LONG_SELECTION, body: LONG_BODY, nextCursor: 'more', selectedTaskInputs: [],
      }),
    });
    const result = ready(await assembler.assembleTask(CTX, CA_ASSEMBLER_INPUT)).value;
    expect(result.input).not.toContain(LONG_BODY);
    expect(result.input).toContain('另有 1 条');
    expect(result.input).not.toContain('bodyExcerpt');
    expect(result.binding.sections.find((section) => section.name === 'inputs')?.omitted).toBe(1);
    // The fixed selection and its exact ArtifactRef version survive the omission.
    expect(result.binding.inputSelections).toEqual([LONG_SELECTION]);
    expect(result.binding.inputSelections[0]?.source).toMatchObject({ kind: 'artifact', ref: LONG_REF });
  });

  it('CA10 a plan-only future task writes obligations: 未定义 and never invents acceptance', async () => {
    const assembler = assemblerWith({});
    const result = ready(await assembler.assembleTask(CTX, assemblerInput(
      taskRecord({ task: TASK_F, runId: 'runF', plan: planOnlySnapshot(), sessionId: 'sf' })))).value;
    expect(result.input).toContain('obligations: 未定义');
    expect(result.input).not.toContain('satisfied');
    expect(result.input).toContain('acceptance: 未定义');
  });

  it('CA11 a legal missing upstream stays ready and reminds with its declaration and tA facts', async () => {
    const assembler = assemblerWith({
      graphContext: graphContextOf(graphFacts({ executions: [endedRecordA()], inputs: [MISSING_SELECTION] })),
      taskInputs: taskInputsOf([]),
    });
    const result = await assembler.assembleTask(CTX, CA_ASSEMBLER_INPUT);
    expect(result.status).toBe('ready');
    const input = ready(result).value.input;
    // The missing declaration and tA's current facts are reminders, not a silent empty section.
    const reminders = sectionText(input, '## Reminders', '');
    expect(reminders).toContain('d1');
    expect(reminders).toContain('tA');
    // Lead fix after the freeze: the fixture's extensions are not_implemented, so spec §4.3
    // (the not-connected wording) and CA14 require the 未接入 reminders here too; the CA11 row
    // asks only for the missing declaration and tA's facts.
  });

  it('CA12 the continuation brief renders and anomaly anchors live in the reminders index', () => {
    const brief = c3Brief();
    const digest = continuationBriefDigest(brief);
    const suffix = renderContinuationBriefZh(brief, digest);
    const anchorKey = 'anomaly:anchor-1';
    const anomaliesProjection: ContextExtensionsV1 = {
      ...notImplementedExtensions(),
      anomalies: {
        availability: 'available',
        rows: [{ key: anchorKey, node: { kind: 'task', ref: TASK_B, planRef: PLAN_REF }, text: `reminder ${anchorKey}`, sources: [] }],
      },
    };
    const reminderRows = anomaliesProjection.anomalies.rows.map((row) => ({ key: row.key, text: row.text }));
    const result = renderContext({
      prelude: WORK_CONTEXT_PRELUDE, required: REQUIRED,
      optional: { reminders: reminderRows }, continuationSuffix: suffix, residentBudgetBytes: 4096,
    });
    // PC-2 ruling 9: the brief is no longer last; the reminders section follows it.
    expect(result.input).toContain(`\n\n${suffix}`);
    expect(result.sections.map(section => section.name)).toContain('continuation');
    expect(result.sections.at(-1)?.name).toBe('reminders');
    expect(sectionText(result.input, '## Reminders', '')).toContain(anchorKey);
    // The brief itself is untouched by the sections after it.
    expect(result.input.slice(result.input.indexOf(suffix) + suffix.length)).toContain('## Reminders');
  });

  it('CA13 a Query question with CRLF and Chinese keeps the question and guide verbatim', async () => {
    const question = '第一行\r\n第二行: keep exactly';
    const assembler = assemblerWith({ graphContext: graphContextOf(graphFacts()), taskInputs: taskInputsOf([]) });
    const result = ready(await assembler.assembleQuery(CTX, {
      facts: queryFacts(),
      role: resolvedRole(),
      configuration: runtimeConfiguration(),
      permissions: { tools: ['read'], writeScope: [] as [] },
      question: `${question}\n\n${INITIAL_COORDINATION_RESPONSE_GUIDE}`,
      toolNames: ['read'],
      history: { callKind: 'query' as const, hasCompletedCursor: false },
    })).value;
    expect(result.input).toContain(question);
    expect(result.input).toContain(INITIAL_COORDINATION_RESPONSE_GUIDE);
    expect(result.input).toContain('Ship platform');
    // Dynamic Goal facts live in the user input, never in the static system prompt.
    expect(runtimeConfiguration().systemInstruction).not.toContain(question);
    expect(runtimeConfiguration().systemInstruction).not.toContain('Ship platform');
    expect(QUERY_CONTEXT_PRELUDE).not.toContain(question);
  });

  it('CA14 without extensions all five availability values are not_implemented', async () => {
    const assembler = assemblerWith({});
    const result = ready(await assembler.assembleTask(CTX, CA_ASSEMBLER_INPUT)).value;
    expect(result.binding.extensions).toEqual({
      notes: 'not_implemented', anomalies: 'not_implemented', footprint: 'not_implemented',
      goalSettings: 'not_implemented', decisions: 'not_implemented',
    });
    // The specific not-connected wording of §4.3, never an empty-but-available section.
    const reminders = sectionText(result.input, '## Reminders', '');
    expect(reminders).toContain('注记索引尚未接入');
    expect(reminders).toContain('异常锚点投影尚未接入');
  });

  it('CA15 a throwing extension reader rejects unavailable instead of an empty array', async () => {
    // A2: the installed Goal-settings extension source (the real production
    // service the composition creates) throws on its read; nothing else changes.
    const f = await createWP2Platform({ kind: 'memory', duty: 'secretary', ownedHost: true, failGoalSettingsRead: true });
    const bodies = countBodyPuts();
    try {
      const result = await f.platform.runtime.prepareExecution(f.ctx, { runRef: f.runRef!, requestId: 'ca15' });
      expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
      expect(bodies.puts()).toHaveLength(0);
    } finally {
      bodies.restore();
      await f.close();
    }
  });
});

// The frozen literal of the platform pack's `initial-planning-answer` guide
// (today's value; its production export was removed by J-07).
const INITIAL_COORDINATION_RESPONSE_GUIDE = `Return exactly one JSON object as your entire final answer, with schemaVersion 2 and kind "plan" or "needs_decision": no preface, no trailing note, no commentary and no markdown or code fences. The platform parses that one object strictly and never extracts or repairs JSON out of surrounding text.
For needs_decision, provide summary and questions (a non-empty array of strings); ask only the real product or authorization decisions the request leaves open. Do not invent authorization.
For plan, provide summary and plan with schemaVersion 2 and the following fields:
- stages: array of {stageId, title, description?}. A task references a stage only through its own stageId.
- tasks: array of {taskId, stageId?, title, requirementLevel, taskKind, disposition, phase, scope, executionIntent?}. requirementLevel is "required" or "optional". taskKind is "work" or "gate". disposition is "active", "deferred", "cancelled" or "superseded". phase is "pending", "ready", "running", "verifying", "blocked", "satisfied" or "failed"; every task of a NEW plan starts "pending". scope is {kind:"goal"}, {kind:"stage",stageId} or {kind:"module",stageId,moduleRef}. Task scope.moduleRef is a non-empty STRING containing the moduleId, NOT the {projectId,moduleId} object used in the architecture catalog. executionIntent is "plan_only" or "request_execution" and may appear on a work task only.
- assignments: array of {taskId, role, instruction}. A work task with executionIntent "request_execution" needs exactly one assignment whose role is one of the AVAILABLE roles/templateId shown in this context; a work task with executionIntent "plan_only" may omit it; a gate task must never carry an assignment or an executionIntent, because a gate conclusion comes from the formal evidence reduction, not from an execution run. A future work task with executionIntent "plan_only" may omit assignment, obligations/acceptance and dependencies; its incompleteness alone is not a reason to return needs_decision.
- obligations: array of {obligationId, title, requirementLevel, taskIds, verificationRequirements}. taskIds lists only work/gate tasks of this same plan. Every verificationRequirements entry is {requirementId, requirementLevel, kind, description}; requirementLevel is "required" or "optional" and kind must be one of the requirementKinds of the effective CompletionPolicy shown in this context. A required obligation needs at least the policy's minimum number of required verification requirements.
- taskHierarchy: {parentOf:[{parentTaskId, childTaskId}]}. It only expresses display grouping.
- executionDag: {dependsOn:[{taskId, dependsOnId, requires:{kind, label}}]}. requires.kind is "output-contract", "artifact", "decision", "environment-revision" or "gate-result"; use a real versioned input/output dependency, keep the DAG acyclic and never make a task depend on itself.
- taskRelations (optional): array of {fromTaskId, toTaskId, kind, note}; kind is "coordination" or "expected_dependency". It is advisory only and never a dispatch prerequisite.
You MAY also add an OPTIONAL top-level "setup" sibling of "plan"; it is a SUGGESTION only and grants no Host/tool permission. It has exactly these three fields:
- architecture: {baselineId, description, constraints:[{name, scope}], catalog:{requireDag:true, dependencies:[{from:{projectId, moduleId}, to:{projectId, moduleId}, reason}], modules:[{ref:{projectId, moduleId}, name, responsibility, paths, interfaces:[{id, description, paths}]}], containment:{parentOf:[{parent:{projectId, moduleId}, child:{projectId, moduleId}}]}}}. Every module ref MUST use the REAL projectId of this request; never guess a project/workspace id. containment is OPTIONAL: give a parent/child pair only when the real sources show that one module contains the other; omit containment when you do not know (an omitted containment means unknown, never flat); an explicit {parentOf:[]} means every module is flat; never derive a parent from paths or dependencies.
- completionPolicy: {schemaVersion:1, requirementKinds:[...], minimumRequiredRequirementsPerObligation:N}. Copy the requirementKinds of the effective CompletionPolicy shown in this context. When no policy is shown, propose the smallest REAL policy this request needs; never emit an empty policy whose vacuously satisfied obligations would auto-PASS.
- checks: array of {checkId, kind, command, cwd, timeoutMs, taskIds}. "kind" is exactly a policy requirement kind ("static" or "dynamic") and maps directly to the requirement.kind it satisfies; there is NO coverage field and never add one. taskIds is "all" or the real task ids. Use only a command that must really run for this request: never assume a test file exists, never copy an unrelated command, and never invent an empty check list to force a PASS.
Omit "setup" entirely when you have no real architecture/policy/check to propose.
Do not include planId, planRevision, goalId or origin: the platform derives identity from the saved Job project/goal/intentId and provenance from the real Goal/Workspace revisions and the actual answer digest.
Choose every stage, task, scope, role, instruction, obligation, verification requirement and dependency from the actual request and the real sources. Never invent a gate, dependency, assignment, acceptance, verification requirement or role binding the request did not ask for, and never fill a genuinely missing decision with a default; ask that decision through needs_decision instead.
The JSON example below is a SHAPE SAMPLE only: it shows the exact field names and legal enum values. It is NOT authorization for any task, role, acceptance, dependency, architecture, policy or check of this request. Do not copy its ids, projectId, role, tasks, obligations or dependencies; replace every value with the real one from this request.
BEGIN_INITIAL_PLAN_EXAMPLE
{
  "schemaVersion": 2,
  "kind": "plan",
  "summary": "Shape sample only: replace every value with the real work of this request.",
  "plan": {
    "schemaVersion": 2,
    "stages": [
      { "stageId": "sample-stage", "title": "Shape sample stage" }
    ],
    "tasks": [
      { "taskId": "sample-work", "stageId": "sample-stage", "title": "Shape sample executable work",
        "requirementLevel": "required", "taskKind": "work", "disposition": "active", "phase": "pending",
        "scope": { "kind": "stage", "stageId": "sample-stage" }, "executionIntent": "request_execution" },
      { "taskId": "sample-gate", "title": "Shape sample goal gate",
        "requirementLevel": "required", "taskKind": "gate", "disposition": "active", "phase": "pending",
        "scope": { "kind": "goal" } },
      { "taskId": "sample-future", "title": "Shape sample optional future intent",
        "requirementLevel": "optional", "taskKind": "work", "disposition": "active", "phase": "pending",
        "scope": { "kind": "goal" }, "executionIntent": "plan_only" }
    ],
    "assignments": [
      { "taskId": "sample-work", "role": "<role-from-available-configuration>",
        "instruction": "Shape sample instruction: replace with the real requested work" }
    ],
    "obligations": [
      { "obligationId": "sample-obligation", "title": "Shape sample acceptance obligation",
        "requirementLevel": "required", "taskIds": ["sample-work", "sample-gate"],
        "verificationRequirements": [
          { "requirementId": "sample-requirement", "requirementLevel": "required", "kind": "static",
            "description": "Shape sample verification: replace with the real check from this request" }
        ] }
    ],
    "taskHierarchy": { "parentOf": [] },
    "executionDag": { "dependsOn": [
      { "taskId": "sample-gate", "dependsOnId": "sample-work",
        "requires": { "kind": "artifact", "label": "Shape sample required input for the gate" } }
    ] }
  },
  "setup": {
    "architecture": {
      "baselineId": "sample-baseline",
      "description": "Shape sample: replace with the real initial boundary of this project",
      "constraints": [],
      "catalog": {
        "requireDag": true,
        "dependencies": [],
        "modules": [
          { "ref": { "projectId": "<real-project-id-from-this-request>", "moduleId": "sample-module" },
            "name": "Shape sample module", "responsibility": "Replace with the real responsibility",
            "paths": ["src"], "interfaces": [] }
        ]
      }
    },
    "completionPolicy": {
      "schemaVersion": 1,
      "requirementKinds": ["static"],
      "minimumRequiredRequirementsPerObligation": 1
    },
    "checks": [
      { "checkId": "sample-check", "kind": "static", "command": "<real-command-that-must-run>",
        "cwd": ".", "timeoutMs": 60000, "taskIds": "all" }
    ]
  }
}
END_INITIAL_PLAN_EXAMPLE`;
