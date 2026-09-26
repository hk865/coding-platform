import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeSourceCaptureFactory, createQuerySourceCaptureFactory } from '../../src/core/agent-runtime/source-capture-access.js';
import type { SourceRunSpec } from '../../src/core/agent-runtime/source-binding-types.js';
import type { SourceAuthorityReads, SourceCanonicalSnapshot, SourceAuthorityEvent } from '../../src/core/work-graph/source-authority-ports.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import type { QueryJobSnapshot, QueryRunSnapshot, QueryJobSubmittedEvent } from '../../src/contracts/query-job.js';
import type { QueryExecutionRequest } from '../../src/contracts/query-execution-context.js';
import type { ReviewerProfileV1 } from '../../src/contracts/reviewer-context.js';
import type { ReviewWorkSnapshot } from '../../src/contracts/reviewer-work.js';
import type { RuntimeSourceCaptureAccess } from '../../src/core/agent-runtime/source-tool-ports.js';
import type { WorkspaceResult } from '../../src/core/workspace/ports.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';

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

async function read(access: RuntimeSourceCaptureAccess, path = 'src/main.ts', requestSignal = signal()) {
  return access.port.readWorkspace(access.context(requestSignal), {
    workspace, path, maxBytes: 4096, version: { kind: 'working_tree' },
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

it('rechecks Run termination, revoked entry and read grant on every request', async () => {
  const f = await workFixture();
  const access = await open(createRuntimeSourceCaptureFactory(f.deps, f.spec, f.envelope));
  for (const changed of [
    { ...f.run, status: 'ended' as const, outcome: 'completed' as const },
    { ...f.run, executionAuthorization: { generation: 1, consumerId: 'runtime', phase: 'revoked' as const } },
    { ...f.run, envelope: { ...f.run.envelope!, permissions: { ...f.run.envelope!.permissions, tools: [] } } },
  ]) {
    f.state.set(changed as RunSnapshot);
    expect(await read(access)).toMatchObject({ status: 'rejected', code: 'forbidden' });
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

it('limits a bound Reviewer to candidate source and rechecks the accepted ReviewWork', async () => {
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
  f.state.set({ ...accepted, reviewerProfile: { ...profile, digest: 'changed' } });
  expect(await read(access)).toMatchObject({ status: 'rejected', code: 'forbidden' });
});

async function queryFixture() {
  const root = await directory();
  const runRef = { aggregateType: 'QueryRun' as const, projectId: workspace.projectId, workspaceId: workspace.workspaceId, queryJobId: 'query-a', runId: 'query-run-a' };
  const jobRef = { aggregateType: 'QueryJob' as const, projectId: workspace.projectId, workspaceId: workspace.workspaceId, queryJobId: 'query-a' };
  const request = { runRef, question: 'Where is boundSource?', budget: { maxTokens: 128 }, bundleRef: {
    kind: 'artifact', digest: 'e'.repeat(64), sizeBytes: 8, contentType: 'text/plain', source: { kind: 'workspace' },
  } } as QueryExecutionRequest;
  const execution = { kind: 'semantic_query' as const, roleBinding: { schemaVersion: 1 as const, bindingId: 'query-reader', templateId: 'query', templateRevision: '1', bindingVersion: 1, policyRevision: 'p1' }, runtimeBudget: DEFAULT_RUNTIME_BUDGET };
  const intent = { schemaVersion: 1 as const, intentId: 'intent-a', projectId: workspace.projectId, workspaceId: workspace.workspaceId,
    goalId: 'goal-a', question: request.question, focusTaskRefs: [], budget: { maxTokens: 128, deadline: null },
    multiTurn: { maxRounds: 1 }, correlationId: 'query-a', execution };
  const job = { ref: jobRef, revision: 2, schemaVersion: 1, job: { schemaVersion: 1, queryJobId: jobRef.queryJobId,
    projectId: workspace.projectId, workspaceId: workspace.workspaceId, goalId: 'goal-a', runRef,
    submittedAt: at, updatedAt: at, intent, status: 'running', answerRefs: [], closeReason: null } } as QueryJobSnapshot;
  const run = { ref: runRef, revision: 2, schemaVersion: 1, run: { schemaVersion: 1, queryJobRef: jobRef,
    runId: runRef.runId, status: 'running', outcome: null, startedAt: at, endedAt: null,
    execution: { schemaVersion: 1, roundIndex: 0, request, selectedSources: [] } } } as QueryRunSnapshot;
  const state = facts([{ ref: workspace, revision: 1 }, job, run]);
  const originalJob = structuredClone(job.job);
  originalJob.status = 'pending';
  const event = { eventId: 'submitted-a', eventType: 'QueryJobSubmitted', schemaVersion: 1,
    projectId: workspace.projectId, workspaceId: workspace.workspaceId, aggregateType: 'QueryJob', aggregateId: jobRef.queryJobId,
    aggregateRevision: 1, causationId: 'submit', correlationId: 'query', idempotencyKey: 'submit',
    actor: { kind: 'human', id: 'original-user' }, occurredAt: at, payload: { job: originalJob } } as QueryJobSubmittedEvent;
  state.history.push({ cursor: makeCommitCursor(1), event: { eventType: 'unrelated' } }, { cursor: makeCommitCursor(2), event });
  const hostStop = new AbortController();
  const deps = { authority: () => state.authority, hostSignal: hostStop.signal, now: () => at,
    sourcePolicyFor: async () => ({ root, permissionRevision: 'mount-p1', allowsRead: (_path: string) => true }) };
  return { root, state, run, job, request, event, deps };
}

it('resolves Query source authority from the original submission with one shared history scan', async () => {
  const f = await queryFixture();
  const factory = createQuerySourceCaptureFactory(f.deps, f.request, f.root);
  const [first, second] = await Promise.all([open(factory), open(factory)]);
  expect(f.state.scans).toBe(1);
  for (const access of [first, second]) {
    expect(access.context(signal()).principal).toMatchObject({ kind: 'query_run', initiator: { kind: 'human', id: 'original-user' } });
    expect(ready(await read(access)).content).toContain('boundSource');
  }
});

it('rejects a conflicting original Query submission and changed current execution', async () => {
  const f = await queryFixture();
  f.state.history.push({ cursor: makeCommitCursor(3), event: { ...f.event, eventId: 'forged-second' } });
  await expect(createQuerySourceCaptureFactory(f.deps, f.request, f.root)(signal())).rejects.toThrow();
  f.state.history.pop();
  const access = await open(createQuerySourceCaptureFactory(f.deps, f.request, f.root));
  f.state.set({ ...f.run, run: { ...f.run.run, execution: { ...f.run.run.execution!, request: { ...f.request, question: 'changed after acceptance' } } } });
  expect(await read(access)).toMatchObject({ status: 'rejected', code: 'forbidden' });
});
