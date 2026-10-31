/**
 * Shared world for the two L8 rework-2 public test files
 * (`S8A-L8-reminders-public.test.ts`, `S8A-L8-read-counts.test.ts`).
 *
 * Every prior fact is produced by the platform's own code: the Project,
 * Workspace, CompletionPolicy, catalog adoption/revision, Goal, Plan, Session,
 * claim, source captures and automatic-capture requests. The test supplies only
 * Host inputs (the temporary root, its authorization, the runtime binding and
 * the clock/id seams) and the failure it wants to observe.
 *
 * Preparation goes through W3's ONE H4 helper: one
 * `platform.runtime.prepareExecution`, then `platform.materials.openArtifact`
 * with `usage: 'historical_explanation'`. No local body store, no hand-built
 * Role facts and no raw body read exists here.
 */
import { mkdir, mkdtemp, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { PersistedSourceCaptureRef } from '../../src/contracts/core/source.js';
import type { ArchitectureObservationStateV1 } from '../../src/contracts/architecture-observation.js';
import type { ArchitectureReminderReadPort } from '../../src/core/agent-runtime/context-assembler.js';
import type { PreparedTaskExecution } from '../../src/contracts/core/prepared-execution.js';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { DependencyRequirement, PlanRevisionDraft, RuntimeTask } from '../../src/contracts/plan.js';
import type { RoleBindingRefV1, RunRef } from '../../src/contracts/dispatch.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import type { ResolvedRuntimeConfiguration, RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import { AUTO_CAPTURE_ACTOR, createAutoCaptureDriver, type AutoCaptureDriver } from '../../src/app/auto-capture-driver.js';
import { PREPARED_MANIFEST_CONTENT_TYPE } from '../../src/core/agent-runtime/execution-preparation.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import * as reminderFactsModule from '../../src/composition/architecture-reminder-facts.js';
import * as graphContextModule from '../../src/core/work-graph/views/graph-context-reader.js';
import * as inputServiceModule from '../../src/core/work-graph/tasks/context-input-service.js';
import type { GraphContextReadPort } from '../../src/core/work-graph/model/graph-context-contracts.js';
import type { TaskContextInputPort } from '../../src/core/work-graph/model/context-input-contracts.js';
import { prepareExecutionAndArtifact } from './S8A-L8-prepare.js';

export const FIRST_AT = '2026-10-17T00:00:00.000Z';
export const THREE_HOURS_FIVE = 3 * 60 + 5;
const actor = { kind: 'human' as const, id: 's8a-l8-operator' };

type ReminderBackend = 'memory' | 'sqlite';
type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;

type ModuleSpec = { id: string; paths: string[] };
type CatalogSpec = {
  modules: ModuleSpec[];
  dependencies: { from: string; to: string }[];
  taskModule: string;
};
/** One capture stage: remove these files, then write these files, then capture. */
type StageSpec = { write: Record<string, string>; remove?: string[] };

const A03_CATALOG: CatalogSpec = {
  modules: [{ id: 'A', paths: ['src/a/core'] }, { id: 'B', paths: ['src/b'] }],
  dependencies: [{ from: 'A', to: 'B' }],
  taskModule: 'A',
};
export const A03_STAGES: StageSpec[] = [
  { write: {
    'src/a/core/one.ts': 'import { b } from "../../b/lib";\n\nexport const a = b;\n',
    'src/b/lib.ts': 'export const b = 1;\n',
    'src/old.ts': 'export const moved = "d";\n',
  } },
  { remove: ['src/old.ts'], write: {
    'src/a/core/one.ts': 'export const a = 1;\n',
    'src/a/core/util.ts': 'export const util = 2;\n',
    'src/b/extra.ts': 'import { util } from "../a/core/util";\n\nexport const extra = util;\n',
    'src/a/loose.ts': 'export const loose = 3;\n',
    'src/new.ts': 'export const moved = "d";\n',
  } },
];

/** A2 fault at the reminder-reader seam. `gate-*` holds after the REAL read. */
type ReminderFault =
  | { kind: 'throw' }
  | { kind: 'reject' }
  | { kind: 'cancel' }
  | { kind: 'gate-ready' }
  | { kind: 'gate-throw' };

/** A2/A3 fault at the graph-context seam, on the upstream missing-input read only. */
type GraphFault =
  | { kind: 'cancel-upstream' }
  | { kind: 'gate-upstream' };

/** A2/A3 fault at the task-input page owner, after its REAL read. */
type InputPageFault =
  | { kind: 'cancel-page' }
  | { kind: 'gate-page' };

type ReminderGate = {
  /** Resolves once the real reader returned and the wrapper is holding. */
  entered: Promise<void>;
  release(): void;
  /** True when the wrapper is currently holding a real result. */
  held(): boolean;
};

type GateState = ReminderGate & { released: Promise<void>; markEntered(): void };

type ReminderWorldOptions = {
  catalog?: CatalogSpec;
  stages?: StageSpec[];
  fileGraph?: { maxNodes: number; maxEdges: number; chunkBytes?: number };
  reminder?: ReminderFault;
  graph?: GraphFault;
  inputPage?: InputPageFault;
  /** One hard Plan input edge whose upstream has no published output (missing input). */
  planInput?: { upstreamTaskId: string; requires: DependencyRequirement };
  countPreparedManifestPuts?: boolean;
  /** Hold the real prepared-manifest put after it wrote, then return it. */
  gatePreparedPut?: boolean;
};

type ReminderWorld = {
  platform: Platform;
  ctx: CoreCallContext;
  ctxWithSignal(signal: AbortSignal): CoreCallContext;
  scope: WorkspaceScope;
  root: string;
  runRef: RunRef;
  roleBinding: RoleBindingRefV1;
  captureIds: string[];
  driver: AutoCaptureDriver;
  gate: ReminderGate | null;
  graphGate: ReminderGate | null;
  inputPageGate: ReminderGate | null;
  putGate: ReminderGate | null;
  /** A real, non-replayed catalog revision through the public writer. */
  reviseCatalog(requestId: string): Promise<void>;
  /** One public prepare plus the H4 material read. Throws when not ready. */
  prepare(ctx?: CoreCallContext, requestId?: string, now?: string): Promise<{
    prepared: PreparedTaskExecution; bundleRef: ArtifactRef; input: string;
  }>;
  /** Direct public prepare, for rows that assert a rejection. */
  prepareExecution(ctx: CoreCallContext, requestId: string): Promise<Awaited<ReturnType<Platform['runtime']['prepareExecution']>>>;
  /** Write a stage's files and capture them through the public writer. */
  capture(stage: StageSpec, requestId: string): Promise<string>;
  writeFiles(files: Record<string, string>): Promise<void>;
  removeFile(path: string): Promise<void>;
  moveRootAway(): Promise<string>;
  restoreRoot(away: string): Promise<void>;
  /** PREPARED-manifest body puts counted by the A3 wrapper. */
  preparedManifestPuts(): number;
  close(): Promise<void>;
};

async function writeFilesAt(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, body] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), body);
  }
}

/** A scripted Host: the preparation reads this configuration and calls no model. */
function hostFor(): RuntimeHostBindings {
  return {
    async resolveConfiguration(): Promise<{ status: 'ready'; value: ResolvedRuntimeConfiguration }> {
      return { status: 'ready', value: {
        configurationRevision: 's8a-l8-host@1',
        model: { configuration: { revision: 's8a-l8-model@1', provider: 'scripted', model: 's8a-l8',
          baseUrl: 'http://127.0.0.1' }, client: {} as unknown as ResolvedRuntimeConfiguration['model']['client'] },
        budget: { contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
          maxRequests: 4, maxToolCalls: 8, timeoutMs: null, perResponseTokens: 512 },
        hostTemplate: { templateId: 'builder', revision: '1', digest: sha256Hex('s8a-l8-template') },
        tools: ['read'], writeScope: [], skills: { resourceRoot: 'resources/skills', enabledIds: [] },
        systemInstruction: 'Stopped before the model.',
        deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
        platformDuty: 'executor', contextResidentBytes: 20000,
      } };
    },
  };
}

function commit<T>(result: { status: string }): T {
  if (result.status !== 'committed') throw new Error(`a public write did not commit: ${JSON.stringify(result)}`);
  return (result as unknown as { value: T }).value;
}

/** A2/A3 gate over the composition root's real reminder reader. */
function faultedReader(real: ArchitectureReminderReadPort, fault: ReminderFault,
  gate: GateState): ArchitectureReminderReadPort {
  let used = false;
  return {
    async read(ctx, workspace) {
      if (used) return real.read(ctx, workspace);
      used = true;
      if (fault.kind === 'throw' || fault.kind === 'reject' || fault.kind === 'cancel') {
        // The real reader runs first; the fault replaces its answer once.
        await real.read(ctx, workspace);
        if (fault.kind === 'throw') throw new Error('injected reminder read failure');
        if (fault.kind === 'cancel') {
          return { status: 'rejected', code: 'cancelled', reason: 'injected cancelled' };
        }
        return { status: 'rejected', code: 'unavailable', reason: 'injected unavailable' };
      }
      if (fault.kind === 'gate-ready' || fault.kind === 'gate-throw') {
        // The REAL read has returned; the wrapper holds its result while the
        // test aborts the prepare context, then returns it (or throws).
        const result = await real.read(ctx, workspace);
        gate.markEntered();
        await gate.released;
        if (fault.kind === 'gate-throw') throw new Error('injected reminder read failure during cancellation');
        return result;
      }
      return real.read(ctx, workspace);
    },
  };
}

/** A2/A3 wrapper over the composition root's real graph-context reader: the
 * upstream missing-input read (`includeInputs` false) is replaced or held once;
 * every other read returns the real result unchanged. */
function faultedGraphReader(real: GraphContextReadPort, fault: GraphFault,
  gate: GateState): GraphContextReadPort {
  let used = false;
  return {
    ...real,
    async readContextFacts(ctx, request) {
      const result = await real.readContextFacts(ctx, request);
      if (used || request.includeInputs === true) return result;
      used = true;
      if (fault.kind === 'cancel-upstream') {
        return { status: 'rejected', code: 'cancelled', reason: 'injected upstream cancellation' };
      }
      gate.markEntered();
      await gate.released;
      return result;
    },
  };
}

/** A2/A3 wrapper over the composition root's real task-input owner: the first
 * page read runs for real, then its answer is replaced or held. */
function faultedInputPageReader<T extends TaskContextInputPort>(real: T, fault: InputPageFault,
  gate: GateState): T {
  let used = false;
  return {
    ...real,
    async readTaskInputPage(ctx, request) {
      const result = await real.readTaskInputPage(ctx, request);
      if (used) return result;
      used = true;
      if (fault.kind === 'cancel-page') {
        return { status: 'rejected', code: 'cancelled', reason: 'injected input page cancellation' };
      }
      gate.markEntered();
      await gate.released;
      return result;
    },
  };
}

function makeGate(): { gate: GateState; entered: Promise<void> } {  let enteredResolve: () => void = () => undefined;
  let releaseResolve: () => void = () => undefined;
  let holding = false;
  const entered = new Promise<void>(resolve => { enteredResolve = resolve; });
  const release = new Promise<void>(resolve => { releaseResolve = resolve; });
  const gateState: GateState = {
    entered, released: release, release: () => releaseResolve(), held: () => holding,
    markEntered: () => { holding = true; enteredResolve(); },
  };
  return { gate: gateState, entered };
}

export async function createReminderWorld(kind: ReminderBackend,
  options: ReminderWorldOptions = {}): Promise<ReminderWorld> {
  const catalog = options.catalog ?? A03_CATALOG;
  const stages = options.stages ?? A03_STAGES;
  const directory = await mkdtemp(join(tmpdir(), 's8a-l8-reminder-world-'));
  const root = join(directory, 'workspace');
  await mkdir(root, { recursive: true });
  const scope: WorkspaceScope = { projectId: 's8a-l8-project', workspaceId: 'main' };
  const projectRef = { aggregateType: 'Project' as const, projectId: scope.projectId };
  const workspaceRef = { aggregateType: 'Workspace' as const, ...scope };
  const goalRef = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: 's8a-l8-goal' };
  const planRef = { aggregateType: 'PlanRevision' as const, projectId: scope.projectId, planId: 's8a-l8-plan' };
  let platformNow = FIRST_AT;
  const ctx: CoreCallContext = { projectId: scope.projectId, workspaceId: scope.workspaceId,
    principal: { kind: 'host', actor }, materialReader: { kind: 'host', projectId: scope.projectId,
      workspaceId: scope.workspaceId, actor }, signal: new AbortController().signal };
  const host: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      return requested.projectId === scope.projectId && requested.workspaceId === scope.workspaceId
        ? { status: 'ready', value: { root, workspaceRevision: 1 } }
        : { status: 'rejected', code: 'forbidden', reason: 'unknown workspace' };
    },
    async authorize() {
      return { status: 'ready', value: { subjectKey: 's8a-l8', permissionRevision: 's8a-l8@1',
        allowsRead: () => true } };
    },
  };

  // The A2 gate/fault wraps the composition root's REAL reader: the spy is
  // installed before the platform is built, and the wrapper calls what the
  // composition root itself created.
  let gate: ReminderGate | null = null;
  let graphGate: ReminderGate | null = null;
  let inputPageGate: ReminderGate | null = null;
  let putGate: ReminderGate | null = null;
  const restore: (() => void)[] = [];
  if (options.reminder !== undefined) {
    const made = makeGate();
    gate = made.gate;
    const original = reminderFactsModule.createArchitectureReminderFactsReader;
    const spy = vi.spyOn(reminderFactsModule, 'createArchitectureReminderFactsReader')
      .mockImplementation(deps => faultedReader(original(deps), options.reminder!, made.gate));
    restore.push(() => spy.mockRestore());
  }
  if (options.graph !== undefined) {
    const made = makeGate();
    graphGate = made.gate;
    const original = graphContextModule.createGraphContextReader;
    const spy = vi.spyOn(graphContextModule, 'createGraphContextReader')
      .mockImplementation(deps => faultedGraphReader(original(deps), options.graph!, made.gate));
    restore.push(() => spy.mockRestore());
  }
  if (options.inputPage !== undefined) {
    const made = makeGate();
    inputPageGate = made.gate;
    const original = inputServiceModule.createTaskContextInputService;
    const spy = vi.spyOn(inputServiceModule, 'createTaskContextInputService')
      .mockImplementation(deps => faultedInputPageReader(original(deps), options.inputPage!, made.gate));
    restore.push(() => spy.mockRestore());
  }

  let preparedPuts = 0;
  if (options.countPreparedManifestPuts === true || options.gatePreparedPut === true) {
    let putGateState: GateState | null = null;
    if (options.gatePreparedPut === true) {
      const made = makeGate();
      putGateState = made.gate;
      putGate = made.gate;
    }
    const originalPut = RawArtifactBodyStore.prototype.put;
    const spy = vi.spyOn(RawArtifactBodyStore.prototype, 'put').mockImplementation(async function (
      this: RawArtifactBodyStore, input) {
      if (input.contentType === PREPARED_MANIFEST_CONTENT_TYPE) {
        preparedPuts += 1;
        const result = await originalPut.call(this, input);
        if (putGateState !== null) {
          putGateState.markEntered();
          await putGateState.released;
        }
        return result;
      }
      return originalPut.call(this, input);
    });
    restore.push(() => spy.mockRestore());
  }

  let triggerSink: ((event: { kind: 'catalog_adopted' | 'catalog_revised' | 'check_passed'; projectId: string }) => void) | null = null;
  let platform: Platform;
  try {
    platform = await createTargetPlatform({
      storage: kind === 'memory' ? { kind: 'memory' } : { kind: 'sqlite', directory },
      workspace: host, now: () => platformNow,
      architectureSource: { provider: 'typescript', configPath: null },
      ...(options.fileGraph === undefined ? {} : { fileGraph: options.fileGraph }),
      runtime: hostFor(),
      onArchitectureCaptureTrigger: event => { triggerSink?.(event); },
      kernelStores: { entries: [{ adapterId: 's8a-l8-kernel', storeKey: 's8a-l8-kernel-store',
        workspace: scope, databasePath: join(directory, 'kernel.sqlite') }] },
    });
  } catch (error) {
    for (const undo of restore.splice(0)) undo();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }

  commit(await platform.projects.createProject(ctx, { input: { projectId: scope.projectId },
    meta: { requestId: 's8a-l8-project', expected: [{ ref: projectRef, revision: 0 }] } }));
  commit(await platform.projects.registerWorkspace(ctx, { input: { workspace: scope },
    meta: { requestId: 's8a-l8-workspace', expected: [
      { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] } }));

  // The project needs an effective CompletionPolicy activation before a Goal can
  // be created; both are the product's own writers.
  const policyRef = { aggregateType: 'CompletionPolicyRevision' as const, projectId: scope.projectId,
    policyId: 's8a-l8-policy', revision: 1 };
  const policyActiveRef = { aggregateType: 'ProjectCompletionPolicyActive' as const, projectId: scope.projectId };
  const installed = commit<{ ref: unknown; contentDigest: string }>(
    await platform.completionPolicies.installCompletionPolicy(ctx, {
      input: { policyId: 's8a-l8-policy', contentRevision: 1,
        content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } },
      meta: { requestId: 's8a-l8-policy', expected: [
        { ref: projectRef, revision: 1 }, { ref: policyRef, revision: 0 }] } }));
  commit(await platform.completionPolicies.activateCompletionPolicy(ctx, {
    input: { target: { ref: installed.ref as never, digest: installed.contentDigest } },
    meta: { requestId: 's8a-l8-policy-active', expected: [
      { ref: projectRef, revision: 1 }, { ref: policyActiveRef, revision: 0 }] } }));

  // The active catalog through the public architecture writer (the fixture's
  // initial adoption remains the prior fact; no trigger is wired yet).
  const moduleRefs = new Map(catalog.modules.map(module =>
    [module.id, { projectId: scope.projectId, moduleId: module.id }] as const));
  commit(await platform.architecture.adoptInitialArchitecture(ctx, {
    meta: { requestId: 's8a-l8-adopt', expected: [
      { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] },
    input: { baselineId: 's8a-l8-baseline', description: 'the reminder fixture', constraints: [],
      catalog: { requireDag: true, dependencies: catalog.dependencies.map(dependency => ({
        from: moduleRefs.get(dependency.from)!, to: moduleRefs.get(dependency.to)!, reason: 'declared' })),
      modules: catalog.modules.map(module => ({ ref: moduleRefs.get(module.id)!, name: module.id,
        responsibility: `The ${module.id} module`, paths: [...module.paths], interfaces: [] })) } },
  }));

  commit(await platform.goals.createGoal(ctx, { input: {
    goalId: goalRef.goalId, workspace: scope, objective: 'A-03 reminder fixture' },
    meta: { requestId: 's8a-l8-goal', expected: [
      { ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 1 }] } }));
  // A public Plan draft may carry one hard input edge whose producer has not
  // run yet; the upstream Task exists but publishes no labeled output.
  const planInputTasks: RuntimeTask[] = options.planInput === undefined ? [] : [{
    taskId: options.planInput.upstreamTaskId, stageId: 'stage-a', title: 'Upstream material',
    requirementLevel: 'optional', taskKind: 'work', disposition: 'active', phase: 'pending',
    scope: { kind: 'module', stageId: 'stage-a', moduleRef: catalog.taskModule },
  }];
  const draft: PlanRevisionDraft = { schemaVersion: 2, planId: planRef.planId, planRevision: 1,
    goalId: goalRef.goalId, stages: [{ stageId: 'stage-a', title: 'A' }],
    tasks: [
      { taskId: 'task-a', stageId: 'stage-a', title: 'A work', requirementLevel: 'required',
        taskKind: 'work', disposition: 'active', phase: 'pending',
        scope: { kind: 'module', stageId: 'stage-a', moduleRef: catalog.taskModule } },
      { taskId: 'task-gate', stageId: 'stage-a', title: 'Goal gate', requirementLevel: 'required',
        taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
      ...planInputTasks,
    ],
    assignments: [{ taskId: 'task-a', role: 'builder', instruction: 'Do A' },
      ...(options.planInput === undefined ? []
        : [{ taskId: options.planInput.upstreamTaskId, role: 'builder', instruction: 'Produce the upstream material' }])],
    obligations: [{ obligationId: 's8a-l8-obligation', title: 'Deliver A', requirementLevel: 'required',
      taskIds: ['task-a', 'task-gate'], verificationRequirements: [{ requirementId: 's8a-l8-check',
        requirementLevel: 'required', kind: 'test', description: 'The A check passes' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: options.planInput === undefined
      ? []
      : [{ taskId: 'task-a', dependsOnId: options.planInput.upstreamTaskId,
        requires: options.planInput.requires }] } };
  const proposed = commit<{ ref: unknown; revision: number; issues: unknown[] }>(
    await platform.plans.proposePlan(ctx, { input: { goalRef, basedOn: null, draft,
      reason: { text: 'A-03 plan', sources: [] } },
    meta: { requestId: 's8a-l8-propose', expected: [{ ref: goalRef, revision: 1 }] } }));
  if (proposed.issues.length > 0) throw new Error(`the plan proposal has issues: ${JSON.stringify(proposed.issues)}`);
  commit(await platform.plans.applyPlanChange(ctx, { input: {
    proposalRef: proposed.ref as never, expectedProposalRevision: proposed.revision, decisionRefs: [] },
    meta: { requestId: 's8a-l8-apply', expected: [{ ref: goalRef, revision: 1 }] } }));

  const role = { kind: 'legacy_template' as const, templateId: 'builder', templateRevision: '1' };
  const created = await platform.runtime.createSession(ctx, { workspace: scope, role,
    recommendedRefs: [], initialLinks: [],
    meta: { requestId: 's8a-l8-session', expected: [] } });
  if (created.status !== 'completed') throw new Error(`the real Session creation failed: ${JSON.stringify(created)}`);
  const sessionRef = { projectId: created.value.ref.projectId, sessionId: created.value.ref.sessionId };
  const roleBinding: RoleBindingRefV1 = { schemaVersion: 1 as const, bindingId: 's8a-l8-binding', templateId: 'builder',
    templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
  const budget = { tokenBudget: 100000, deadline: null };
  const goalRead = await platform.plans.queryGoal(ctx, goalRef);
  if (goalRead.status !== 'ready') throw new Error('the Goal read failed');
  const wsRead = await platform.projects.readWorkspaceRegistration(ctx, scope);
  if (wsRead.status !== 'ready') throw new Error('the workspace read failed');
  const claimed = await platform.claims.claimTask(ctx, { input: { goalRef, planRef, taskId: 'task-a',
    sessionRef, roleBinding, budget }, meta: { requestId: 's8a-l8-claim', expected: [
    { ref: goalRef, revision: goalRead.value.goal.revision },
    { ref: workspaceRef, revision: wsRead.value.workspace.revision },
    { ref: created.value.ref, revision: created.value.revision }] } });
  if (claimed.status !== 'committed') throw new Error(`the real claim failed: ${JSON.stringify(claimed)}`);

  // Real captures of real files; each stage is cumulative.
  const mappings = catalog.modules.map(module =>
    ({ id: module.id, kind: 'module' as const, paths: [...module.paths] }));
  const captureIds: string[] = [];
  let previous: PersistedSourceCaptureRef | null = null;
  let captureIndex = 0;
  async function capture(stage: StageSpec, requestId: string): Promise<string> {
    for (const path of stage.remove ?? []) await unlink(join(root, path));
    await writeFilesAt(root, stage.write);
    platformNow = new Date(Date.parse(FIRST_AT) + captureIndex * 3_600_000).toISOString();
    captureIndex += 1;
    const captured = await platform.architecture.captureSourceChanges(ctx, {
      input: { workspace: scope, mappings, previous }, meta: { requestId, expected: [] },
    });
    if (captured.status !== 'committed') throw new Error(`the real capture failed: ${JSON.stringify(captured)}`);
    captureIds.push(captured.value.capture.captureId);
    previous = captured.value;
    return captured.value.capture.captureId;
  }
  for (const [index, stage] of stages.entries()) await capture(stage, `s8a-l8-capture-${String(index + 1)}`);

  // The real Host driver over the same public architecture port. The catalog
  // trigger sink is wired to it AFTER the fixture's initial adoption; later
  // revisions reach it as genuine causes.
  const driver = createAutoCaptureDriver({
    architecture: platform.architecture,
    catalog: platform.architecture,
    boundWorkspaces: () => [scope],
    actor: AUTO_CAPTURE_ACTOR,
  });
  triggerSink = event => { driver.projectChanged(event.projectId, event.kind); };

  const world: ReminderWorld = {
    platform, ctx, scope, root, driver, captureIds, gate, graphGate, inputPageGate, putGate,
    runRef: claimed.value.runRef, roleBinding,
    ctxWithSignal(signal) { return { ...ctx, signal }; },
    async reviseCatalog(requestId) {
      const current = await platform.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
      if (current.status !== 'ready' || current.value.catalog === null) {
        throw new Error(`the current catalog read failed: ${JSON.stringify(current)}`);
      }
      const registration = await platform.projects.readWorkspaceRegistration(ctx, scope);
      if (registration.status !== 'ready') throw new Error('the workspace registration read failed');
      const revisedCatalog = {
        ...current.value.catalog.catalog,
        modules: current.value.catalog.catalog.modules.map((module, index) => index === 0
          ? { ...module, responsibility: `${module.responsibility} (revised by ${requestId})` }
          : module),
      };
      const revised = await platform.architecture.reviseArchitectureCatalog(ctx, {
        meta: { requestId, expected: [
          { ref: projectRef, revision: registration.value.project.revision },
          { ref: workspaceRef, revision: registration.value.workspace.revision }] },
        input: { basedOn: { ref: current.value.baseline.ref, digest: current.value.baseline.contentDigest },
          catalog: revisedCatalog, reason: requestId },
      });
      if (revised.status !== 'committed') throw new Error(`the real catalog revision failed: ${JSON.stringify(revised)}`);
    },
    async prepare(prepareCtx = ctx, requestId = 's8a-l8-prepare', now) {
      if (now !== undefined) platformNow = now;
      return prepareExecutionAndArtifact(platform, prepareCtx, claimed.value.runRef, roleBinding, requestId);
    },
    async prepareExecution(prepareCtx, requestId) {
      return platform.runtime.prepareExecution(prepareCtx, { runRef: claimed.value.runRef, requestId });
    },
    capture,
    writeFiles: files => writeFilesAt(root, files),
    removeFile: path => unlink(join(root, path)),
    async moveRootAway() { const away = `${root}-away`; await rename(root, away); return away; },
    async restoreRoot(away) { await rename(away, root); },
    preparedManifestPuts: () => preparedPuts,
    async close() {
      try { await driver.close(); } catch { /* the test's assertion keeps the failure */ }
      try { await platform.close(); } catch { /* the test's assertion keeps the failure */ }
      for (const undo of restore.splice(0)) undo();
      await rm(directory, { recursive: true, force: true });
      const away = `${root}-away`;
      await rm(away, { recursive: true, force: true });
    },
  };
  return world;
}

/** Bounded polling on the one public read; the wait is the product's own state. */
export async function waitObservationState(world: ReminderWorld,
  predicate: (state: ArchitectureObservationStateV1) => boolean): Promise<ArchitectureObservationStateV1> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const state = await world.platform.architecture.observationState(world.ctx, { workspace: world.scope });
    if (state.status === 'ready' && predicate(state.value)) return state.value;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('the observation state did not reach the expected auto-capture request state');
}

export function architectureRows(input: string): string[] {
  const prefixes = ['声明的依赖没有 import：', 'import 没有声明的依赖：', '新文件没归组：', '可能移动：'];
  return input.split('\n').filter(line => prefixes.some(prefix => line.startsWith(prefix))
    || (line.startsWith('另有 ') && line.endsWith('条架构提醒没列出')));
}

export function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

