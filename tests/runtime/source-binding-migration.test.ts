import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeSourceCaptureFactory, createQuerySourceCaptureFactory } from '../../src/core/agent-runtime/source-capture-access.js';
import type { SourceRunSpec } from '../../src/core/agent-runtime/source-binding-types.js';
import type { SourceAuthorityReads, SourceCanonicalSnapshot, SourceAuthorityEvent } from '../../src/core/work-graph/source-authority-ports.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { QueryExecutionRequest } from '../../src/contracts/query-execution-context.js';
import type { ReviewerProfileV1 } from '../../src/contracts/reviewer-context.js';
import type { ReviewWorkSnapshot } from '../../src/contracts/reviewer-work.js';
import type { RuntimeSourceCaptureAccess } from '../../src/core/agent-runtime/source-tool-ports.js';
import type { WorkspaceResult } from '../../src/core/workspace/ports.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { WorkspaceHostBindings } from '../../src/core/workspace/access.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import * as inMemoryRecordStore from '../../src/core/record-store/in-memory-record-store.js';
import * as sqliteRecordStore from '../../src/core/record-store/sqlite-record-store.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { EXECUTION_ENTRY_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/execution-entry-codecs.js';
import { MODEL_REQUEST_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/model-request-codecs.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import { createTaskClaimFixture } from '../helpers/task-claim-fixture.js';
import { createS2BRuntimeSteps } from '../helpers/S2B-runtime-steps-fixture.js';
import { createScriptedModel, digestOf } from '../helpers/B2-runtime-fixture.js';
import type { ModelClientPort } from '../../vendor/coding-agent/dist/public-api.js';

const at = '2026-09-24T06:00:00.000Z';
const workspace = { aggregateType: 'Workspace' as const, projectId: 'source-project', workspaceId: 'source-workspace' };
const signal = () => new AbortController().signal;
const roots: string[] = [];
const accesses: RuntimeSourceCaptureAccess[] = [];

afterEach(async () => {
  await Promise.allSettled(accesses.splice(0).map(access => access.close()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function ready<T>(result: WorkspaceResult<T>): T {
  expect(result.status, JSON.stringify(result)).toBe('ready');
  if (result.status !== 'ready') throw Error(result.reason);
  return result.value;
}

async function open(factory: (runSignal: AbortSignal) => Promise<RuntimeSourceCaptureAccess>) {
  const access = await factory(signal());
  accesses.push(access);
  return access;
}

async function read(access: RuntimeSourceCaptureAccess, path = 'src/main.ts', requestSignal = signal(),
  target = workspace) {
  return access.port.readWorkspace(access.context(requestSignal), {
    workspace: target, path, maxBytes: 4096, version: { kind: 'working_tree' },
  });
}

async function directory() {
  const base = await mkdtemp(join(tmpdir(), 'next-source-binding-'));
  roots.push(base);
  const root = join(base, 'workspace');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src/main.ts'), 'export const boundSource = 7;\n');
  await writeFile(join(root, 'src/private.ts'), 'export const privateSource = 9;\n');
  return root;
}

/** A tiny read-only fact source. No command path, StateLedger, or platform harness exists here. */
function facts(initial: SourceCanonicalSnapshot[]) {
  const records = new Map(initial.map(snapshot => [JSON.stringify(snapshot.ref), structuredClone(snapshot)]));
  const history: { cursor: ReturnType<typeof makeCommitCursor>; event: SourceAuthorityEvent }[] = [];
  let scans = 0;
  const authority: SourceAuthorityReads = {
    async load(ref) {
      const snapshot = records.get(JSON.stringify(ref));
      return snapshot ? { status: 'found', snapshot: structuredClone(snapshot) } : { status: 'not_found', ref };
    },
    async readQuerySubmission() {
      return { status: 'rejected' as const, code: 'unsupported' as const,
        reason: 'the binding migration reads no Query submission' };
    },
    async events({ afterCursor, limit }) {
      scans++;
      const start = afterCursor ? history.findIndex(row => row.cursor === afterCursor) + 1 : 0;
      const page = history.slice(start, start + limit);
      return { afterCursor, throughCursor: page.at(-1)?.cursor ?? afterCursor, events: structuredClone(page), hasMore: start + limit < history.length };
    },
  };
  return { authority, records, history, get scans() { return scans; }, set(snapshot: SourceCanonicalSnapshot) { records.set(JSON.stringify(snapshot.ref), structuredClone(snapshot)); } };
}

async function workFixture() {
  const root = await directory();
  const runRef = { aggregateType: 'Run' as const, projectId: workspace.projectId, goalId: 'goal-a', runId: 'run-a' };
  const attemptRef = { aggregateType: 'TaskAttempt' as const, projectId: workspace.projectId, goalId: 'goal-a', taskId: 'task-a', attemptId: 'attempt-a' };
  const roleBinding = { schemaVersion: 1 as const, bindingId: 'role-a', templateId: 'developer', templateRevision: '1', bindingVersion: 1, policyRevision: 'p1' };
  const envelope = {
    schemaVersion: 1, envelopeId: 'envelope-a', projectId: workspace.projectId, workspaceId: workspace.workspaceId,
    goalId: 'goal-a', taskId: 'task-a', runRef, attemptRef, roleBinding,
    planRef: { aggregateType: 'PlanRevision', projectId: workspace.projectId, goalId: 'goal-a', planId: 'plan-a', revision: 1 },
    workspaceSnapshot: { workspaceId: workspace.workspaceId, revision: 1 },
    permissions: { policyRevision: 'p1', tools: ['read'], writeScope: [] },
    budget: { tokenBudget: 1000 }, sourceRefs: [], bundleRef: { kind: 'artifact', digest: 'f'.repeat(64), sizeBytes: 10, contentType: 'text/plain', source: { kind: 'workspace' } },
  } as unknown as TaskEnvelopeV1;
  const run = {
    ref: runRef, revision: 1, schemaVersion: 1, task: { projectId: workspace.projectId, goalId: 'goal-a', taskId: 'task-a' },
    attemptId: attemptRef.attemptId, planRef: envelope.planRef, roleBinding, budget: envelope.budget,
    workspaceSnapshot: envelope.workspaceSnapshot, status: 'running', outcome: null, exitCode: null,
    lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '', envelope, startedAt: at, endedAt: null,
  } as RunSnapshot;
  const state = facts([{ ref: workspace, revision: 1 }, run]);
  const hostStop = new AbortController();
  const mounts = new Map([[workspace.workspaceId, root]]);
  const deps = {
    authority: () => state.authority, hostSignal: hostStop.signal, now: () => at,
    sourcePolicyFor: async (_projectId: string, workspaceId: string) => {
      const mounted = mounts.get(workspaceId);
      return mounted ? { root: mounted, permissionRevision: 'mount-p1', allowsRead: (_path: string) => true } : null;
    },
  };
  const spec: SourceRunSpec = { projectId: workspace.projectId, workspaceId: workspace.workspaceId,
    goalId: 'goal-a', runId: 'run-a', taskId: 'task-a', root };
  return { root, run, envelope, spec, state, hostStop, mounts, deps };
}

it('binds one accepted Work Run to real source bytes and isolates caller mutations', async () => {
  const f = await workFixture();
  const factory = createRuntimeSourceCaptureFactory(f.deps, f.spec, f.envelope);
  f.spec.root = '/mutated';
  f.envelope.roleBinding.templateId = 'mutated';
  const access = await open(factory);
  expect(ready(await read(access)).content).toContain('boundSource');
  const ctx = access.context(signal());
  if (ctx.principal.kind !== 'work_run') throw Error('expected Work Run');
  ctx.principal.runRef.runId = 'mutated-return';
  access.workspace.workspaceId = 'mutated-return';
  expect(ready(await read(access)).content).toContain('boundSource');
});

it('refuses same-root workspace substitution and a changed registered root', async () => {
  const f = await workFixture();
  const access = await open(createRuntimeSourceCaptureFactory(f.deps, f.spec, f.envelope));
  const changed = access.context(signal());
  changed.workspaceId = 'other-workspace';
  f.mounts.set('other-workspace', f.root);
  f.state.set({ ref: { ...workspace, workspaceId: 'other-workspace' }, revision: 1 });
  expect(await access.port.readWorkspace(changed, { workspace: { ...workspace, workspaceId: 'other-workspace' }, path: 'src/main.ts', maxBytes: 4096, version: { kind: 'working_tree' } })).toMatchObject({ status: 'rejected', code: 'forbidden' });
  const other = await directory();
  f.mounts.set(workspace.workspaceId, other);
  expect(await read(access)).toMatchObject({ status: 'rejected', code: 'forbidden' });
});

// B-04 (R-3): the revoked-entry and changed-read-grant sub-cases rewrote an
// accepted Run in place; no public step makes those states. The one reachable
// sub-case (a Run that ended) is produced by the real Runtime: the access is
// opened while the Run is held in `running`, then the same access reads after
// the real end, so only the per-request qualification can refuse it.
it.each(['memory', 'sqlite'] as const)('refuses a source read after the real %s Run ended', async kind => {
  const fixture = await createTaskClaimFixture(kind, {
    records: [...EXECUTION_ENTRY_RECORD_SCHEMAS.records, ...MODEL_REQUEST_RECORD_SCHEMAS.records],
    events: [...EXECUTION_ENTRY_RECORD_SCHEMAS.events, ...MODEL_REQUEST_RECORD_SCHEMAS.events],
    lookups: [...EXECUTION_ENTRY_RECORD_SCHEMAS.lookups ?? [], ...MODEL_REQUEST_RECORD_SCHEMAS.lookups ?? []],
  });
  const bodies = new RawArtifactBodyStore();
  let sequence = 0;
  const steps = await createS2BRuntimeSteps({ base: fixture, bodies, ctx: fixture.ctx,
    directory: fixture.directory, scope: fixture.scope, now: () => at, setClock: () => undefined,
    eventId: () => `source-binding-ended-event-${++sequence}`,
    newId: () => `source-binding-ended-id-${++sequence}`,
    consumerId: 'source-binding-ended-consumer' });
  try {
    const claimed = await fixture.service.claimTask(fixture.ctx,
      await fixture.buildRequest({ requestId: 'source-binding-ended-claim' }));
    expect(claimed).toMatchObject({ status: 'committed' });
    if (claimed.status !== 'committed') throw Error('the real Run was not claimed');
    const claim = claimed.value;
    const handle = await steps.start(claim, { at,
      replies: [{ kind: 'text', text: 'source binding ended answer' }] });
    await handle.entered;
    const current = await createRunStateReader({ records: fixture.records })
      .readExecution(fixture.ctx, claim.runRef);
    expect(current).toMatchObject({ status: 'ready', value: { run: { status: 'running' } } });
    if (current.status !== 'ready' || current.value.run.envelope === null) {
      throw Error('the running Run has no accepted envelope');
    }
    const root = await directory();
    const authority = createSourceAuthorityReader({
      authority: createMaterialRecordReaders(fixture.records).authority, records: fixture.records });
    const factory = createRuntimeSourceCaptureFactory({
      authority: () => authority,
      sourcePolicyFor: async () => ({ root, permissionRevision: 'ended-policy', allowsRead: () => true }),
      hostSignal: new AbortController().signal, now: () => at,
    }, { projectId: fixture.scope.projectId, workspaceId: fixture.scope.workspaceId,
      goalId: claim.task.goalId, runId: claim.runRef.runId,
      taskId: claim.task.taskId, root }, current.value.run.envelope);
    // The access is opened (and proves readable) while the real Run is running.
    const access = await open(factory);
    const boundWorkspace = { aggregateType: 'Workspace' as const,
      projectId: fixture.scope.projectId, workspaceId: fixture.scope.workspaceId };
    expect(ready(await read(access, 'src/main.ts', signal(), boundWorkspace)).content).toContain('boundSource');
    // The real end happens after the grant was taken; the same access must
    // re-qualify every request and refuse the now-ended Run.
    await steps.finish(handle, at, 'completed');
    expect(await read(access, 'src/main.ts', signal(), boundWorkspace))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
  } finally {
    await steps.close();
    await fixture.close();
  }
});

it('closes the owned tools and honors Host and call cancellation', async () => {
  const f = await workFixture();
  const access = await open(createRuntimeSourceCaptureFactory(f.deps, f.spec, f.envelope));
  const cancelled = new AbortController();
  cancelled.abort();
  expect(await read(access, 'src/main.ts', cancelled.signal)).toMatchObject({ status: 'rejected', code: 'cancelled' });
  f.hostStop.abort();
  expect(await read(access)).toMatchObject({ status: 'rejected', code: 'cancelled' });
  await access.close();
  expect(await read(access)).toMatchObject({ status: 'rejected' });
});

it('limits a bound Reviewer to candidate source', async () => {
  const f = await workFixture();
  const reviewRef = { aggregateType: 'ReviewWork' as const, projectId: workspace.projectId,
    workspaceId: workspace.workspaceId, goalId: f.run.ref.goalId, reviewId: 'review-a' };
  const work = { kind: 'review' as const, reviewWorkRef: reviewRef };
  const input = { packetRef: f.envelope.bundleRef, packetDigest: 'packet', inputDigest: 'input', descriptorDigest: 'descriptor', grantRefs: [] };
  const profile = { schemaVersion: 1, profileId: 'reviewer', revision: 1, digest: 'profile', mode: 'review',
    roleBinding: f.run.roleBinding, permissions: { tools: ['read'], writeScope: [] },
    model: { configurationRevision: '1', provider: 'local', model: 'test', baseUrl: 'http://localhost' },
    budget: DEFAULT_RUNTIME_BUDGET, subjectScope: {} } as ReviewerProfileV1;
  const accepted = { ref: reviewRef, schemaVersion: 1, revision: 1, reviewerRunRef: f.run.ref,
    reviewerAttemptRef: f.envelope.attemptRef, roleBinding: f.run.roleBinding, reviewerProfile: profile,
    input, descriptor: { materialIdentity: { workspaceRoot: f.root } } } as unknown as ReviewWorkSnapshot;
  f.state.set(accepted);
  f.state.set({ ...f.run, work, envelope: { ...f.envelope, work, reviewInput: input } });
  const factory = createRuntimeSourceCaptureFactory(f.deps, { ...f.spec, mode: 'review', review: { workRef: reviewRef, profile } },
    { ...f.envelope, work, reviewInput: input });
  const access = await open(factory);
  expect(ready(await read(access)).content).toContain('boundSource');
  await mkdir(join(f.root, 'dist'), { recursive: true });
  await writeFile(join(f.root, 'dist/generated.ts'), 'export const excluded = true;\n');
  expect(await read(access, 'dist/generated.ts')).toMatchObject({ status: 'rejected', code: 'forbidden' });
  // B-04 (R-3): rewriting the accepted Reviewer digest in place is tamper-only
  // (`source-capture-access.ts` re-reads the accepted ReviewWork, but no public
  // step stores a second digest on the same accepted record).
});

/** The real Query path: public bootstrap, submit, Session, claim, prepare and a
 * started Query held at the model gate. The one source authority is the real
 * reader over the same records, with its exact submission read counted. */
async function queryPlatformFixture(kind: 'memory' | 'sqlite') {
  const root = await directory();
  await mkdir(join(root, 'skills'), { recursive: true });
  const human = { kind: 'human' as const, id: 'original-user' };
  const scope = { projectId: workspace.projectId, workspaceId: workspace.workspaceId };
  const projectRef = { aggregateType: 'Project' as const, projectId: workspace.projectId };
  const workspaceRef = { ...workspace };
  const goalRef = { aggregateType: 'Goal' as const, projectId: workspace.projectId, goalId: 'goal-a' };
  const jobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId: workspace.projectId,
    workspaceId: workspace.workspaceId, queryJobId: 'query-a' };
  const runRef: QueryRunRef = { aggregateType: 'QueryRun', projectId: workspace.projectId,
    workspaceId: workspace.workspaceId, queryJobId: 'query-a', runId: 'query-run-a' };
  const roleBinding = { schemaVersion: 1 as const, bindingId: 'query-reader', templateId: 'advisor',
    templateRevision: '1', bindingVersion: 1, policyRevision: 'p1' };
  const ctx: CoreCallContext = { projectId: workspace.projectId, workspaceId: workspace.workspaceId,
    principal: { kind: 'host', actor: human },
    materialReader: { kind: 'host', projectId: workspace.projectId, workspaceId: workspace.workspaceId, actor: human },
    signal: new AbortController().signal };
  let reachGate!: () => void;
  const reached = new Promise<void>(resolve => { reachGate = resolve; });
  let releaseGate!: () => void;
  const gate = new Promise<void>(resolve => { releaseGate = resolve; });
  const scripted = createScriptedModel([{ kind: 'text', text: 'query source authority answer' }]);
  // A3: hold the REAL model dependency at the gate, then return its events unchanged.
  const modelClient: ModelClientPort = {
    async *stream(request, options) {
      reachGate();
      await gate;
      yield* scripted.client.stream(request, options);
    },
  };
  const host: RuntimeHostBindings = {
    async resolveConfiguration() {
      return { status: 'rejected', code: 'unsupported', reason: 'this chain never runs Work execution' };
    },
    async resolveQueryConfiguration() {
      return { status: 'ready', value: {
        configurationRevision: 'source-binding-host@1',
        model: { configuration: { revision: 'source-binding-host@1', provider: 'deepseek', model: 'source-binding-scripted',
          baseUrl: 'http://127.0.0.1' }, client: modelClient,
          inputCounter: { count: () => ({ tokens: 256, method: 'model_tokenizer' as const, tokenizer: 'source-binding-counter' }) } },
        budget: DEFAULT_RUNTIME_BUDGET, tools: ['read'], writeScope: [],
        skills: { resourceRoot: join(root, 'skills'), enabledIds: [] },
        systemInstruction: 'source binding query guidance',
        hostTemplate: { templateId: 'advisor', revision: '1', digest: digestOf('source binding query guidance') },
        deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
      } };
    },
  };
  const state = { revision: null as number | null };
  const workspaceBindings: WorkspaceHostBindings = {
    async resolveRoot(requested) {
      if (requested.projectId !== scope.projectId || requested.workspaceId !== scope.workspaceId || state.revision === null) {
        return { status: 'rejected', code: 'not_found', reason: 'the workspace is not registered in this Host' };
      }
      return { status: 'ready', value: { root, workspaceRevision: state.revision } };
    },
    async authorize() {
      return { status: 'ready', value: { subjectKey: 'source-binding-host', permissionRevision: 'host-grant-1', allowsRead: () => true } };
    },
  };
  // A4: share the platform's ONE real backend (memory or SQLite) with the
  // reader, so the test composes the real authority over the committed facts.
  let backend: ReturnType<typeof inMemoryRecordStore.createInMemoryRecordBackend> | undefined;
  let restoreStorage!: () => void;
  if (kind === 'memory') {
    const createBackend = inMemoryRecordStore.createInMemoryRecordBackend;
    const spy = vi.spyOn(inMemoryRecordStore, 'createInMemoryRecordBackend').mockImplementation(options => {
      backend = createBackend(options);
      return backend;
    });
    restoreStorage = () => spy.mockRestore();
  } else {
    const createBackend = sqliteRecordStore.createSqliteRecordBackend;
    const spy = vi.spyOn(sqliteRecordStore, 'createSqliteRecordBackend').mockImplementation(options => {
      backend = createBackend(options);
      return backend;
    });
    restoreStorage = () => spy.mockRestore();
  }
  let platform: Awaited<ReturnType<typeof createTargetPlatform>>;
  try {
    platform = await createTargetPlatform({
      storage: kind === 'memory' ? { kind: 'memory' } : { kind: 'sqlite', directory: join(root, 'ledger') },
      workspace: workspaceBindings,
      sourcePolicyFor: async () => ({ root, permissionRevision: 'mount-p1', allowsRead: () => true }),
      runtime: host,
      kernelStores: { entries: [{ adapterId: 'source-binding-kernel', storeKey: 'source-binding-kernel-store',
        workspace: scope, databasePath: join(root, 'kernel.sqlite') }] },
      now: () => at,
    });
  } finally {
    restoreStorage();
  }
  if (backend === undefined) throw new Error(`the platform did not create its ${kind} record backend`);
  expect(await platform.projects.createProject(ctx, { meta: { requestId: 'source-binding-project-1',
    expected: [{ ref: projectRef, revision: 0 }] }, input: { projectId: projectRef.projectId } }))
    .toMatchObject({ status: 'committed' });
  const registered = await platform.projects.registerWorkspace(ctx, { meta: { requestId: 'source-binding-workspace-1',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: 0 }] }, input: { workspace: scope } });
  expect(registered).toMatchObject({ status: 'committed' });
  if (registered.status !== 'committed') throw new Error('Workspace registration failed');
  state.revision = registered.value.revision;
  expect(await platform.goals.createGoal(ctx, { meta: { requestId: 'source-binding-goal-1',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision }] },
    input: { goalId: goalRef.goalId, workspace: scope, objective: 'Answer one reading question from real sources' } }))
    .toMatchObject({ status: 'committed' });
  const intent: QueryJobIntentV1 = { schemaVersion: 1, intentId: jobRef.queryJobId, projectId: scope.projectId,
    workspaceId: scope.workspaceId, goalId: goalRef.goalId, question: 'Where is boundSource?', focusTaskRefs: [],
    budget: { maxTokens: 8192, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: 'query-a',
    execution: { kind: 'semantic_query', roleBinding, runtimeBudget: DEFAULT_RUNTIME_BUDGET } };
  const submitted = await platform.queries.submitQueryJob(ctx, { meta: { requestId: 'source-binding-submit-1',
    expected: [{ ref: projectRef, revision: 1 }, { ref: workspaceRef, revision: state.revision },
      { ref: goalRef, revision: 1 }, { ref: jobRef, revision: 0 }, { ref: runRef, revision: 0 }] },
    input: { queryJobId: jobRef.queryJobId, runId: runRef.runId, intent } });
  expect(submitted).toMatchObject({ status: 'committed' });
  if (submitted.status !== 'committed') throw new Error('Query submit did not commit');
  const created = await platform.runtime.createSession(ctx, { workspace: scope,
    role: { kind: 'legacy_template', templateId: 'advisor', templateRevision: '1' },
    recommendedRefs: [], initialLinks: [], meta: { requestId: 'source-binding-session-1', expected: [] } });
  expect(created).toMatchObject({ status: 'completed' });
  if (created.status !== 'completed') throw new Error('Session creation did not complete');
  const claimed = await platform.queries.claimQuery(ctx, { meta: { requestId: 'source-binding-claim-1',
    expected: [{ ref: jobRef, revision: 1 }, { ref: runRef, revision: 1 },
      { ref: created.value.ref, revision: created.value.revision }] }, input: { queryRunRef: runRef, sessionRef: created.value.ref } });
  expect(claimed).toMatchObject({ status: 'committed' });
  if (claimed.status !== 'committed') throw new Error('Query claim did not commit');
  const prepared = await platform.runtime.prepareQuery(ctx, { queryRunRef: runRef, requestId: 'source-binding-prepare-1' });
  expect(prepared).toMatchObject({ status: 'ready' });
  if (prepared.status !== 'ready') throw new Error('Query preparation did not become ready');
  const request: QueryExecutionRequest = { runRef, bundleRef: prepared.value.bundleRef, question: intent.question,
    budget: { maxTokens: intent.budget.maxTokens } };
  const realAuthority = createSourceAuthorityReader({ authority: createMaterialRecordReaders(backend.records).authority,
    records: backend.records });
  let submissionReads = 0;
  const authority = {
    load: (ref: Parameters<typeof realAuthority.load>[0]) => realAuthority.load(ref),
    readQuerySubmission: (ref: QueryJobRef) => {
      submissionReads += 1;
      return realAuthority.readQuerySubmission!(ref);
    },
  };
  const hostStop = new AbortController();
  const deps = { authority: () => authority,
    sourcePolicyFor: async () => ({ root, permissionRevision: 'mount-p1', allowsRead: () => true }),
    hostSignal: hostStop.signal, now: () => at };
  const starting = platform.runtime.startQuery(ctx, { prepared: prepared.value,
    consumerId: 'source-binding-consumer', requestId: 'source-binding-start-1' });
  return { platform, ctx, root, jobRef, request, deps, reached, releaseGate, starting, reads: () => submissionReads };
}

describe.each(['memory', 'sqlite'] as const)('real %s Query source authority', kind => {
it('resolves Query source authority from the original submission with one shared exact submission read', async () => {
  const f = await queryPlatformFixture(kind);
  try {
    await f.reached;
    // The A3 gate holds the REAL model call, so both records are still running.
    expect(await f.platform.queries.readQueryJob(f.ctx, f.jobRef)).toMatchObject({ status: 'ready',
      value: { job: { job: { status: 'running' } }, run: { run: { status: 'running' } } } });
    const factory = createQuerySourceCaptureFactory(f.deps, f.request, f.root);
    const [first, second] = await Promise.all([open(factory), open(factory)]);
    expect(f.reads()).toBe(1);
    for (const access of [first, second]) {
      expect(access.context(signal()).principal).toMatchObject({ kind: 'query_run', initiator: { kind: 'human', id: 'original-user' } });
      expect(ready(await read(access)).content).toContain('boundSource');
    }
  } finally {
    f.releaseGate();
    await f.starting.catch(() => undefined);
    await f.platform.close();
  }
});
});
