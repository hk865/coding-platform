/**
 * Slice 8 L8 / K1-10 (rework-2 row A; B§2 ruling 8, B§4 capacity, B§9 rows 1-4).
 *
 * The observed file-graph chunk is content addressed by the record store, so
 * before the chunk carried its capture scope two workspaces (or two projects)
 * with IDENTICAL files shared one stored chunk body and the second capture or
 * read was rejected on the stored body's foreign origin. These rows reach that
 * regression through public steps only:
 *
 * - one real `createTargetPlatform` with one real temporary root per workspace
 *   and an explicit Host read authorization for the files that really exist;
 * - Project/Workspace/CompletionPolicy/catalog/Goal/Plan/Session/claim are all
 *   produced by their public writers (`runtime` is the accepted A8/T14 Host
 *   binding; the hand-written Plan draft is the public `plans/propose` body);
 * - captures are the real `architecture.captureSourceChanges`, automatic
 *   triggers are the real `createAutoCaptureDriver` wired to the platform's
 *   `onArchitectureCaptureTrigger`;
 * - preparation is W3's ONE H4 helper: `runtime.prepareExecution` then
 *   `materials.openArtifact` (`usage: 'historical_explanation'`).
 *
 * Expected literals are hand-computed from the 4-hour clock below; no value is
 * copied from a `src` constant and no internal chunk ref is asserted.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { ArchitectureObservationStateV1 } from '../../src/contracts/architecture-observation.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PersistedSourceCaptureRef } from '../../src/contracts/core/source.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type { RoleBindingRefV1, RunRef, TaskBudgetV1 } from '../../src/contracts/dispatch.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { AUTO_CAPTURE_ACTOR, createAutoCaptureDriver, type AutoCaptureDriver } from '../../src/app/auto-capture-driver.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { prepareExecutionAndArtifact } from '../helpers/S8A-L8-prepare.js';

const FIRST_AT = '2026-10-17T00:00:00.000Z';
/** The world clock, advanced only where a row hand-computes its reminder time. */
const at = (minutes: number): string => new Date(Date.parse(FIRST_AT) + minutes * 60_000).toISOString();
const OPERATOR = { kind: 'human' as const, id: 's8a-l8-chunk-operator' };
const ROLE = { kind: 'legacy_template' as const, templateId: 'builder', templateRevision: '1' };
const ROLE_BINDING: RoleBindingRefV1 = { schemaVersion: 1, bindingId: 's8a-l8-chunk-binding',
  templateId: 'builder', templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
const BUDGET: TaskBudgetV1 = { tokenBudget: 100000, deadline: null };
/** 320 bytes: every node body keeps its own scoped chunk, so an unchanged node is
 * really reused across captures and two nodes can never share one. The 89-byte
 * fixed envelope plus both short ASCII ids (B§4) leaves each hand-written node
 * well under the cap and keeps the empty envelope under it too. */
const CHUNK_BYTES = 320;

/** The two workspaces `a` and `b` of the first project are byte-identical. */
const AB_FILES: Record<string, string> = {
  'src/core/one.ts': 'export const one = 1;\n',
  'lib/b.ts': 'export const b = 2;\n',
  'src/notes.md': '# Notes\n',
};
/** The same content under the same workspace id `main` in two projects. */
const MAIN_FILES: Record<string, string> = {
  'src/index.ts': 'export const index = 1;\n',
  'notes.md': '# Main notes\n',
};
const REUSE_FILES: Record<string, string> = {
  'src/core/keep.ts': 'export const keep = 1;\n',
  'src/core/change.ts': 'export const change = 1;\n',
};

type Backend = 'memory' | 'sqlite';
type Platform = Awaited<ReturnType<typeof createTargetPlatform>>;
type TriggerEvent = { kind: 'catalog_adopted' | 'catalog_revised' | 'check_passed'; projectId: string };
type CatalogModule = { id: string; paths: string[] };
type ProjectSpec = { projectId: string; workspaces: { workspaceId: string; files: Record<string, string> }[] };

const PROJECTS: readonly ProjectSpec[] = [
  { projectId: 's8a-l8-a', workspaces: [
    { workspaceId: 'a', files: AB_FILES },
    { workspaceId: 'b', files: AB_FILES },
    { workspaceId: 'main', files: MAIN_FILES },
    { workspaceId: 'reuse', files: REUSE_FILES },
  ] },
  { projectId: 's8a-l8-b', workspaces: [{ workspaceId: 'main', files: MAIN_FILES }] },
  { projectId: 's8a-l8-empty', workspaces: [{ workspaceId: 'empty', files: {} }] },
];

const keyOf = (scope: WorkspaceScope): string => `${scope.projectId}/${scope.workspaceId}`;
const A: WorkspaceScope = { projectId: 's8a-l8-a', workspaceId: 'a' };
const B: WorkspaceScope = { projectId: 's8a-l8-a', workspaceId: 'b' };
const A_MAIN: WorkspaceScope = { projectId: 's8a-l8-a', workspaceId: 'main' };
const B_MAIN: WorkspaceScope = { projectId: 's8a-l8-b', workspaceId: 'main' };
const REUSE: WorkspaceScope = { projectId: 's8a-l8-a', workspaceId: 'reuse' };
const EMPTY: WorkspaceScope = { projectId: 's8a-l8-empty', workspaceId: 'empty' };

type World = {
  platform: Platform;
  driver: AutoCaptureDriver;
  setNow(minutes: number): void;
  setNowIso(value: string): void;
  ctx(scope: WorkspaceScope): CoreCallContext;
  write(scope: WorkspaceScope, path: string, body: string): Promise<void>;
  capture(scope: WorkspaceScope, requestId: string,
    options?: { mappings?: { id: string; kind: 'module'; paths: string[] }[]; previous?: PersistedSourceCaptureRef | null }):
    Promise<Extract<Awaited<ReturnType<Platform['architecture']['captureSourceChanges']>>, { status: 'committed' }>>;
  state(scope: WorkspaceScope): Promise<ArchitectureObservationStateV1>;
  waitFor(scope: WorkspaceScope, predicate: (state: ArchitectureObservationStateV1) => boolean): Promise<ArchitectureObservationStateV1>;
  listFiles(scope: WorkspaceScope, captureRef: NonNullable<ArchitectureObservationStateV1['current']>['captureRef']):
    Promise<Awaited<ReturnType<Platform['architecture']['listFiles']>>>;
  adopt(scope: WorkspaceScope, modules: CatalogModule[]): Promise<void>;
  revise(scope: WorkspaceScope, requestId: string): Promise<void>;
  /** Goal/Plan/Session/claim through the public owners; returns the claimed Run. */
  prepareClaim(scope: WorkspaceScope, goalId: string, planId: string, moduleId: string | null): Promise<{
    runRef: RunRef; goalRef: GoalRef; planId: string;
  }>;
  close(): Promise<void>;
};

function commit<T>(result: { status: string }): T {
  if (result.status !== 'committed') throw new Error(`a public write did not commit: ${JSON.stringify(result)}`);
  return (result as unknown as { value: T }).value;
}

/** The scripted Host the preparation reads; the model client is never called. */
function runtimeHost(): RuntimeHostBindings {
  return {
    async resolveConfiguration() {
      return { status: 'ready', value: {
        configurationRevision: 's8a-l8-chunk-host@1',
        model: { configuration: { revision: 's8a-l8-chunk-model@1', provider: 'scripted',
          model: 's8a-l8-chunk', baseUrl: 'http://127.0.0.1' },
        client: {} as never, inputCounter: { count: () => ({ tokens: 128,
          method: 'model_tokenizer' as const, tokenizer: 's8a-l8-chunk-counter' }) } },
        budget: { contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
          maxRequests: 4, maxToolCalls: 8, timeoutMs: null, perResponseTokens: 512 },
        hostTemplate: { templateId: 'builder', revision: '1', digest: sha256Hex('s8a-l8-chunk-template') },
        tools: ['read'], writeScope: [], skills: { resourceRoot: 'resources/skills', enabledIds: [] },
        systemInstruction: 'Stop before the model.', deniedPrefixes: [],
        processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
}

/** One Plan Task (module-scoped for row 1, goal-scoped for the empty graph) plus
 * the Goal gate, as the public `plans/propose` body real callers send. */
function planDraft(goalId: string, planId: string, moduleId: string | null): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId, planRevision: 1, goalId, stages: [{ stageId: 'stage-a', title: 'A' }],
    tasks: [
      { taskId: 'task-a', stageId: 'stage-a', title: 'Chunk scope work', requirementLevel: 'required',
        taskKind: 'work', disposition: 'active', phase: 'pending',
        scope: moduleId === null ? { kind: 'goal' }
          : { kind: 'module', stageId: 'stage-a', moduleRef: moduleId } },
      { taskId: 'task-gate', stageId: 'stage-a', title: 'Goal gate', requirementLevel: 'required',
        taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } },
    ],
    assignments: [{ taskId: 'task-a', role: 'builder', instruction: 'Do the work' }],
    obligations: [{ obligationId: `${planId}-obligation`, title: 'Deliver the work',
      requirementLevel: 'required', taskIds: ['task-a', 'task-gate'],
      verificationRequirements: [{ requirementId: `${planId}-check`, requirementLevel: 'required',
        kind: 'test', description: 'The work check passes' }] }],
    taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] },
  };
}

/** The public page ref the capture write's persisted ref names. */
const observedRef = (scope: WorkspaceScope, persisted: PersistedSourceCaptureRef):
  NonNullable<ArchitectureObservationStateV1['current']>['captureRef'] =>
  ({ aggregateType: 'ObservedArchitecture', projectId: scope.projectId, workspaceId: scope.workspaceId,
    captureId: persisted.capture.captureId });

async function openWorld(backend: Backend): Promise<World> {
  const directory = await mkdtemp(join(tmpdir(), `s8a-l8-chunk-scope-${backend}-`));
  const roots = new Map<string, string>();
  const files = new Map<string, Set<string>>();
  const workspaceRevision = new Map<string, number>();
  for (const project of PROJECTS) {
    for (const workspace of project.workspaces) {
      const scope: WorkspaceScope = { projectId: project.projectId, workspaceId: workspace.workspaceId };
      const root = join(directory, project.projectId, workspace.workspaceId);
      await mkdir(root, { recursive: true });
      for (const [path, body] of Object.entries(workspace.files)) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), body);
      }
      roots.set(keyOf(scope), root);
      files.set(keyOf(scope), new Set(Object.keys(workspace.files)));
      workspaceRevision.set(keyOf(scope), 1);
    }
  }
  const knownActors = new Set([OPERATOR.id, AUTO_CAPTURE_ACTOR.id]);
  const host: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      const revision = workspaceRevision.get(keyOf(requested));
      const root = roots.get(keyOf(requested));
      return revision === undefined || root === undefined
        ? { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered in this Host' }
        : { status: 'ready', value: { root, workspaceRevision: revision } };
    },
    async authorize(bound, requested) {
      const allowed = files.get(keyOf(requested));
      const permitted = allowed !== undefined
        && bound.projectId === requested.projectId && bound.workspaceId === requested.workspaceId
        && bound.principal.kind === 'host' && knownActors.has(bound.principal.actor.id)
        && bound.materialReader.kind === 'host' && knownActors.has(bound.materialReader.actor.id);
      return permitted
        ? { status: 'ready', value: { subjectKey: 's8a-l8-chunk-observer',
            permissionRevision: `s8a-l8-chunk-${backend}@1`, allowsRead: (path: string) => allowed.has(path) } }
        : { status: 'rejected', code: 'forbidden', reason: 'no current Host source grant' };
    },
  };
  // The Host-managed Kernel parent directory exists before its registry opens.
  await mkdir(join(directory, 'kernel'), { recursive: true });
  let now = FIRST_AT;
  let sink: ((event: TriggerEvent) => void) | undefined;
  const platform = await createTargetPlatform({
    storage: backend === 'memory' ? { kind: 'memory' } : { kind: 'sqlite', directory },
    workspace: host, now: () => now,
    architectureSource: { provider: 'typescript', configPath: null },
    fileGraph: { maxNodes: 20_000, maxEdges: 100_000, chunkBytes: CHUNK_BYTES },
    runtime: runtimeHost(),
    kernelStores: { entries: PROJECTS.flatMap(project => project.workspaces.map(workspace => ({
      adapterId: `s8a-l8-chunk-kernel-${project.projectId}-${workspace.workspaceId}`,
      storeKey: `s8a-l8-chunk-store-${project.projectId}-${workspace.workspaceId}`,
      workspace: { projectId: project.projectId, workspaceId: workspace.workspaceId },
      databasePath: join(directory, 'kernel', `${project.projectId}-${workspace.workspaceId}.sqlite`),
    }))) },
    onArchitectureCaptureTrigger: event => { sink?.(event); },
  });
  const ctx = (scope: WorkspaceScope): CoreCallContext => ({
    projectId: scope.projectId, workspaceId: scope.workspaceId,
    principal: { kind: 'host', actor: OPERATOR },
    materialReader: { kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId, actor: OPERATOR },
    signal: new AbortController().signal,
  });
  const projectRef = (projectId: string) => ({ aggregateType: 'Project' as const, projectId });
  const workspaceRef = (scope: WorkspaceScope) => ({ aggregateType: 'Workspace' as const, ...scope });
  const policyRef = (projectId: string) =>
    ({ aggregateType: 'CompletionPolicyRevision' as const, projectId, policyId: `${projectId}-policy`, revision: 1 });
  const activePolicyRef = (projectId: string) =>
    ({ aggregateType: 'ProjectCompletionPolicyActive' as const, projectId });

  // Real bootstrap writers: no Project, Workspace or policy record is hand-made.
  for (const project of PROJECTS) {
    const first = project.workspaces[0]!;
    const firstScope: WorkspaceScope = { projectId: project.projectId, workspaceId: first.workspaceId };
    commit(await platform.projects.createProject(ctx(firstScope), { input: { projectId: project.projectId },
      meta: { requestId: `${project.projectId}-create-project`,
        expected: [{ ref: projectRef(project.projectId), revision: 0 }] } }));
    for (const workspace of project.workspaces) {
      const scope: WorkspaceScope = { projectId: project.projectId, workspaceId: workspace.workspaceId };
      commit(await platform.projects.registerWorkspace(ctx(scope), { input: { workspace: scope },
        meta: { requestId: `${project.projectId}-${scope.workspaceId}-register`,
          expected: [{ ref: projectRef(project.projectId), revision: 1 },
            { ref: workspaceRef(scope), revision: 0 }] } }));
    }
  }
  // A Goal needs an active CompletionPolicy; project one and the empty project
  // also need one for the Plan adoption below (Plan governance pins both).
  for (const project of PROJECTS) {
    if (project.projectId === 's8a-l8-b') continue;
    const scope: WorkspaceScope = { projectId: project.projectId, workspaceId: project.workspaces[0]!.workspaceId };
    const installed = commit<{ ref: unknown; contentDigest: string }>(
      await platform.completionPolicies.installCompletionPolicy(ctx(scope), { input: {
        policyId: `${project.projectId}-policy`, contentRevision: 1,
        content: { schemaVersion: 1, requirementKinds: ['test'], minimumRequiredRequirementsPerObligation: 1 } },
      meta: { requestId: `${project.projectId}-install-policy`, expected: [
        { ref: projectRef(project.projectId), revision: 1 },
        { ref: policyRef(project.projectId), revision: 0 }] } }));
    commit(await platform.completionPolicies.activateCompletionPolicy(ctx(scope), { input: {
      target: { ref: installed.ref as never, digest: installed.contentDigest } },
    meta: { requestId: `${project.projectId}-activate-policy`, expected: [
      { ref: projectRef(project.projectId), revision: 1 },
      { ref: activePolicyRef(project.projectId), revision: 0 }] } }));
  }

  const driver = createAutoCaptureDriver({
    architecture: platform.architecture, catalog: platform.architecture,
    boundWorkspaces: () => [A, B], actor: AUTO_CAPTURE_ACTOR,
  });
  sink = event => { driver.projectChanged(event.projectId, event.kind); };

  const rawCapture: World['capture'] = async (scope, requestId, options = {}) => {
    const result = await platform.architecture.captureSourceChanges(ctx(scope), { input: {
      workspace: scope,
      ...(options.mappings === undefined ? {} : { mappings: options.mappings }),
      ...(options.previous === undefined ? {} : { previous: options.previous }),
    }, meta: { requestId, expected: [] } });
    if (result.status !== 'committed') {
      throw new Error(`captureSourceChanges did not commit: ${JSON.stringify(result)}`);
    }
    return result;
  };
  const state = async (scope: WorkspaceScope): Promise<ArchitectureObservationStateV1> => {
    const read = await platform.architecture.observationState(ctx(scope), { workspace: scope });
    if (read.status !== 'ready') throw new Error(`observationState was not ready: ${JSON.stringify(read)}`);
    return read.value;
  };
  const waitFor: World['waitFor'] = async (scope, predicate) => {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const current = await state(scope);
      if (predicate(current)) return current;
      if (Date.now() >= deadline) {
        throw new Error(`observationState did not reach the expected state: ${JSON.stringify(current)}`);
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  const listFiles: World['listFiles'] = (scope, captureRef) =>
    platform.architecture.listFiles(ctx(scope), { captureRef, cursor: null });
  const adopt: World['adopt'] = async (scope, modules) => {
    const adopted = await platform.architecture.adoptInitialArchitecture(ctx(scope), { input: {
      baselineId: `${scope.projectId}-baseline`, description: 'The chunk-scope module boundary',
      constraints: [],
      catalog: { requireDag: true, dependencies: [], modules: modules.map(module => ({
        ref: { projectId: scope.projectId, moduleId: module.id }, name: module.id,
        responsibility: `The ${module.id} module`, paths: [...module.paths], interfaces: [] })) },
    }, meta: { requestId: `${scope.projectId}-adopt`, expected: [
      { ref: projectRef(scope.projectId), revision: 1 },
      { ref: workspaceRef(scope), revision: workspaceRevision.get(keyOf(scope))! }] } });
    if (adopted.status !== 'committed') throw new Error(`adoptInitialArchitecture failed: ${JSON.stringify(adopted)}`);
  };
  const revise: World['revise'] = async (scope, requestId) => {
    const read = await platform.architecture.readArchitectureRevision(ctx(scope), { selection: { kind: 'current' } });
    if (read.status !== 'ready' || read.value.catalog === null) {
      throw new Error(`the current catalog is not readable: ${JSON.stringify(read)}`);
    }
    const registration = await platform.projects.readWorkspaceRegistration(ctx(scope), scope);
    if (registration.status !== 'ready') throw new Error('the workspace registration read failed');
    const revised = await platform.architecture.reviseArchitectureCatalog(ctx(scope), { input: {
      basedOn: { ref: read.value.baseline.ref, digest: read.value.baseline.contentDigest },
      catalog: { ...read.value.catalog.catalog, modules: read.value.catalog.catalog.modules.map(module => ({
        ...module, responsibility: `${module.responsibility} (${requestId})`,
      })) },
      reason: requestId,
    }, meta: { requestId, expected: [
      { ref: projectRef(scope.projectId), revision: registration.value.project.revision },
      { ref: workspaceRef(scope), revision: registration.value.workspace.revision }] } });
    if (revised.status !== 'committed') throw new Error(`reviseArchitectureCatalog failed: ${JSON.stringify(revised)}`);
  };

  const prepareClaim: World['prepareClaim'] = async (scope, goalId, planId, moduleId) => {
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: scope.projectId, goalId };
    const registration = await platform.projects.readWorkspaceRegistration(ctx(scope), scope);
    if (registration.status !== 'ready') throw new Error('the workspace registration read failed');
    commit(await platform.goals.createGoal(ctx(scope), { input: {
      goalId, workspace: scope, objective: `Chunk scope ${planId}` },
    meta: { requestId: `${planId}-goal`, expected: [
      { ref: projectRef(scope.projectId), revision: 1 },
      { ref: workspaceRef(scope), revision: registration.value.workspace.revision }] } }));
    const proposed = commit<{ ref: never; revision: number; issues: unknown[] }>(
      await platform.plans.proposePlan(ctx(scope), { input: {
        goalRef, basedOn: null, draft: planDraft(goalId, planId, moduleId),
        reason: { text: `Chunk scope ${planId}`, sources: [] } },
      meta: { requestId: `${planId}-propose`, expected: [{ ref: goalRef, revision: 1 }] } }));
    if (proposed.issues.length > 0) throw new Error(`the plan proposal has issues: ${JSON.stringify(proposed.issues)}`);
    commit(await platform.plans.applyPlanChange(ctx(scope), { input: {
      proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [] },
    meta: { requestId: `${planId}-apply`, expected: [{ ref: goalRef, revision: 1 }] } }));
    const created = await platform.runtime.createSession(ctx(scope), { workspace: scope, role: ROLE,
      recommendedRefs: [], initialLinks: [],
      meta: { requestId: `${planId}-session`, expected: [] } });
    if (created.status !== 'completed') throw new Error(`the Session creation failed: ${JSON.stringify(created)}`);
    const goalRead = await platform.plans.queryGoal(ctx(scope), goalRef);
    if (goalRead.status !== 'ready') throw new Error('the Goal read failed');
    const claimed = commit<{ runRef: RunRef }>(await platform.claims.claimTask(ctx(scope), { input: {
      goalRef, planRef: { aggregateType: 'PlanRevision', projectId: scope.projectId, planId },
      taskId: 'task-a', sessionRef: { projectId: created.value.ref.projectId, sessionId: created.value.ref.sessionId },
      roleBinding: ROLE_BINDING, budget: BUDGET },
    meta: { requestId: `${planId}-claim`, expected: [
      { ref: goalRef, revision: goalRead.value.goal.revision },
      { ref: workspaceRef(scope), revision: registration.value.workspace.revision },
      { ref: created.value.ref, revision: created.value.revision }] } }));
    return { runRef: claimed.runRef, goalRef, planId };
  };

  return {
    platform, driver,
    setNow(minutes) { now = at(minutes); },
    setNowIso(value) { now = value; },
    ctx,
    async write(scope, path, body) {
      const root = roots.get(keyOf(scope));
      if (root === undefined) throw new Error(`the workspace ${keyOf(scope)} has no root`);
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), body);
      files.get(keyOf(scope))!.add(path);
    },
    capture: rawCapture,
    state, waitFor, listFiles, adopt, revise, prepareClaim,
    async close() {
      try { await driver.close(); } catch { /* the test keeps its own failure */ }
      await platform.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

const AUTO_READY = (requestSeq: number, trigger: 'catalog_adopted' | 'catalog_revised') =>
  (state: ArchitectureObservationStateV1): boolean => state.autoCapture !== null
    && state.autoCapture.requestSeq === requestSeq && state.autoCapture.pending === false
    && state.autoCapture.trigger === trigger && state.current !== null;

describe.each(['memory', 'sqlite'] as const)('S8A L8 chunk scope [%s]', backend => {
  let world: World;
  let initialA: PersistedSourceCaptureRef;
  let initialB: PersistedSourceCaptureRef;

  beforeAll(async () => {
    world = await openWorld(backend);
    // The first capture of the two identical workspaces happens before any
    // catalog exists (the legal empty module layer), so their content addresses
    // really collide unless the chunk carries the capture scope.
    initialA = (await world.capture(A, 's8a-l8-a-a-initial', { mappings: [], previous: null })).value;
    initialB = (await world.capture(B, 's8a-l8-a-b-initial', { mappings: [], previous: null })).value;
  }, 60_000);

  afterAll(async () => {
    await world?.close();
  }, 60_000);

  it('row 1: two identical workspaces each capture, both auto-triggers commit, and each prepare reads its own observation', async () => {
    // A REAL adoption reaches the wired driver sink; both bound workspaces are
    // requested and captured again with the adopted module mapping.
    world.setNow(10);
    await world.adopt(A, [{ id: 'A', paths: ['src/core'] }, { id: 'B', paths: ['lib'] }]);
    const adoptedA = await world.waitFor(A, AUTO_READY(1, 'catalog_adopted'));
    const adoptedB = await world.waitFor(B, AUTO_READY(1, 'catalog_adopted'));
    expect(adoptedA.current!.captureRef).toMatchObject({ projectId: A.projectId, workspaceId: A.workspaceId });
    expect(adoptedB.current!.captureRef).toMatchObject({ projectId: B.projectId, workspaceId: B.workspaceId });
    expect(adoptedA.current!.captureRef.captureId).not.toBe(initialA.capture.captureId);
    expect(adoptedB.current!.captureRef.captureId).not.toBe(initialB.capture.captureId);
    expect(adoptedB.current!.captureRef.captureId).not.toBe(adoptedA.current!.captureRef.captureId);
    expect(adoptedA.autoCapture!).toMatchObject({ status: 'requested', failure: null });
    expect(adoptedB.autoCapture!).toMatchObject({ status: 'requested', failure: null });
    // Both scoped chunk bodies are readable: neither capture shared the other
    // workspace's stored body.
    expect(await world.listFiles(A, adoptedA.current!.captureRef)).toMatchObject({ status: 'ready' });
    expect(await world.listFiles(B, adoptedB.current!.captureRef)).toMatchObject({ status: 'ready' });

    // The public Goal/Plan/Session/claim facts the two preparations need.
    const claimA = await world.prepareClaim(A, 's8a-l8-a-goal-a', 's8a-l8-a-plan-a', 'A');
    const claimB = await world.prepareClaim(B, 's8a-l8-a-goal-b', 's8a-l8-a-plan-b', 'A');

    // A REAL revision triggers each workspace again.
    world.setNow(70);
    await world.revise(A, 's8a-l8-a-revise-1');
    const revisedA = await world.waitFor(A, AUTO_READY(2, 'catalog_revised'));
    const revisedB = await world.waitFor(B, AUTO_READY(2, 'catalog_revised'));
    expect(revisedA.current!.captureRef.captureId).not.toBe(adoptedA.current!.captureRef.captureId);
    expect(revisedB.current!.captureRef.captureId).not.toBe(adoptedB.current!.captureRef.captureId);
    expect(revisedA.current!.captureRef.captureId).not.toBe(revisedB.current!.captureRef.captureId);

    // The identical-content regression is complete above. One later real capture
    // of A only adds a workspace-specific ungrouped file, so each preparation is
    // shown to read its OWN observation while both still share notes.md. The
    // elapsed literal is hand-computed from the PUBLIC observation time: the
    // preparation clock is set exactly one hour after A's current observedAt.
    await world.write(A, 'src/notes-a.md', '# Notes A\n');
    const onlyA = await world.capture(A, 's8a-l8-a-a-only', { previous: revisedA.current!.persistedRef });
    expect((await world.state(A)).current!.captureRef.captureId).toBe(onlyA.value.capture.captureId);
    expect((await world.state(B)).current!.captureRef.captureId).toBe(revisedB.current!.captureRef.captureId);
    const aObservedAt = (await world.state(A)).current!.observedAt;
    world.setNowIso(new Date(Date.parse(aObservedAt) + 3_600_000).toISOString());
    const preparedA = await prepareExecutionAndArtifact(world.platform, world.ctx(A), claimA.runRef,
      ROLE_BINDING, 's8a-l8-row1-prepare-a');
    const preparedB = await prepareExecutionAndArtifact(world.platform, world.ctx(B), claimB.runRef,
      ROLE_BINDING, 's8a-l8-row1-prepare-b');
    expect(preparedA.input).toContain('新文件没归组：src/notes.md（1 小时前的观测）');
    expect(preparedA.input).toContain('新文件没归组：src/notes-a.md（1 小时前的观测）');
    expect(preparedB.input).toContain('新文件没归组：src/notes.md（1 小时前的观测）');
    expect(preparedB.input).not.toContain('src/notes-a.md');
    expect(preparedA.input).not.toContain('架构提醒不可用');
    expect(preparedB.input).not.toContain('架构提醒不可用');
  }, 60_000);

  it('row 2: the same workspaceId in two projects keeps each project’s own chunk and rows', async () => {
    expect((await world.capture(A_MAIN, 's8a-l8-a-main-1', { mappings: [], previous: null })).value.capture.projectId)
      .toBe(A_MAIN.projectId);
    expect((await world.capture(B_MAIN, 's8a-l8-b-main-1', { mappings: [], previous: null })).value.capture.projectId)
      .toBe(B_MAIN.projectId);
    const stateA = await world.state(A_MAIN);
    const stateB = await world.state(B_MAIN);
    expect(stateA.current!.captureRef).toMatchObject({ projectId: A_MAIN.projectId, workspaceId: 'main' });
    expect(stateB.current!.captureRef).toMatchObject({ projectId: B_MAIN.projectId, workspaceId: 'main' });
    expect(stateA.current!.captureRef.captureId).not.toBe(stateB.current!.captureRef.captureId);

    const pageA = await world.listFiles(A_MAIN, stateA.current!.captureRef);
    const pageB = await world.listFiles(B_MAIN, stateB.current!.captureRef);
    expect(pageA).toMatchObject({ status: 'ready', value: {
      nodes: [{ path: 'notes.md' }, { path: 'src/index.ts' }], complete: true } });
    expect(pageB).toMatchObject({ status: 'ready', value: {
      nodes: [{ path: 'notes.md' }, { path: 'src/index.ts' }], complete: true } });

    // A later real change per project proves each page reads its own rows and
    // never the other project's: the two files exist on one side only.
    world.setNow(310);
    await world.write(A_MAIN, 'only-a.ts', 'export const onlyA = 1;\n');
    await world.write(B_MAIN, 'only-b.ts', 'export const onlyB = 2;\n');
    const changedA = await world.capture(A_MAIN, 's8a-l8-a-main-2', { previous: stateA.current!.persistedRef });
    const changedB = await world.capture(B_MAIN, 's8a-l8-b-main-2', { previous: stateB.current!.persistedRef });
    const latestA = await world.listFiles(A_MAIN, observedRef(A_MAIN, changedA.value));
    const latestB = await world.listFiles(B_MAIN, observedRef(B_MAIN, changedB.value));
    const pathsOf = (page: Awaited<ReturnType<World['listFiles']>>): string[] =>
      page.status === 'ready' ? page.value.nodes.map(node => node.path) : [];
    expect(pathsOf(latestA)).toEqual(['notes.md', 'only-a.ts', 'src/index.ts']);
    expect(pathsOf(latestB)).toEqual(['notes.md', 'only-b.ts', 'src/index.ts']);
    expect(pathsOf(latestA)).not.toContain('only-b.ts');
    expect(pathsOf(latestB)).not.toContain('only-a.ts');
  }, 60_000);

  describe('rejects: a capture ref from another project', () => {
    it('rejects reading B’s ref under A, and both projects’ current observations are unchanged', async () => {
      // A6/A1: both prior observations come from the real public captures.
      await world.capture(A_MAIN, 's8a-l8-a-main-reject-a', { mappings: [], previous: null });
      await world.capture(B_MAIN, 's8a-l8-b-main-reject-b', { mappings: [], previous: null });
      const beforeA = await world.state(A_MAIN);
      const beforeB = await world.state(B_MAIN);
      expect(beforeA.current).not.toBeNull();
      expect(beforeB.current).not.toBeNull();

      // ONE error: B's persisted ref is outside A's Host scope.
      expect(await world.listFiles(A_MAIN, beforeB.current!.captureRef))
        .toMatchObject({ status: 'rejected', code: 'forbidden' });

      // Public read after the refusal: neither project's observation moved.
      const afterA = await world.state(A_MAIN);
      const afterB = await world.state(B_MAIN);
      expect(afterA.current).toEqual(beforeA.current);
      expect(afterB.current).toEqual(beforeB.current);
    });
  });

  it('row 3: a later capture of the same workspace reuses an unchanged chunk and still reads the full graph', async () => {
    world.setNow(400);
    const first = await world.capture(REUSE, 's8a-l8-a-reuse-1', { previous: null });
    world.setNow(410);
    await world.write(REUSE, 'src/core/change.ts', 'export const change = 2;\n');
    const second = await world.capture(REUSE, 's8a-l8-a-reuse-2', { previous: first.value });
    expect(second.value.capture.captureId).not.toBe(first.value.capture.captureId);
    const read = await world.state(REUSE);
    expect(read.current!.captureRef.captureId).toBe(second.value.capture.captureId);
    expect(await world.listFiles(REUSE, observedRef(REUSE, second.value))).toMatchObject({ status: 'ready', value: {
      nodes: [{ path: 'src/core/change.ts' }, { path: 'src/core/keep.ts' }], complete: true } });
  }, 60_000);

  it('row 4: a real root with no source captures an empty graph and prepares without the unavailable row', async () => {
    world.setNow(500);
    await world.adopt(EMPTY, []);
    const claim = await world.prepareClaim(EMPTY, 's8a-l8-empty-goal', 's8a-l8-empty-plan', null);
    const captured = await world.capture(EMPTY, 's8a-l8-empty-capture', { mappings: [], previous: null });
    expect(await world.listFiles(EMPTY, observedRef(EMPTY, captured.value))).toMatchObject({ status: 'ready', value: {
      nodes: [], edges: [], complete: true } });
    world.setNow(560);
    const prepared = await prepareExecutionAndArtifact(world.platform, world.ctx(EMPTY), claim.runRef,
      ROLE_BINDING, 's8a-l8-row4-prepare-empty');
    expect(prepared.prepared.kind).toBe('task');
    expect(prepared.input).not.toContain('架构提醒不可用');
    expect(prepared.input).not.toContain('新文件没归组');
  }, 60_000);
});
