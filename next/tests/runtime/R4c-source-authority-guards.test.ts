/**
 * R4c.2c behavior acceptance for the Runtime source-consumer guards.
 *
 * Guard cases use controlled facts to reach each Run permission branch directly.
 * Integration cases below also use persisted SQLite claims, the actual material
 * and source readers, and WorkspaceTools for starting/running/revoked records.
 * Cases reach `resolveRoot` / the Run authorization. The `events` member is a
 * test-only trap: it counts calls and throws, because a Work source read must
 * not read Query-origin event pages. Rejections are observed through the real
 * `createSourceCaptureAccess` and the real Workspace tools, never by an OS file
 * error standing in for an authorization-first rejection.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RoleBindingRefV1, RunRef, RunSnapshot, TaskAttemptRef } from '../../src/contracts/dispatch.js';
import type { WorkspaceRef } from '../../src/contracts/ledger.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';
import { createSourceCaptureAccess, type SourcePolicy } from '../../src/core/agent-runtime/source-capture-access.js';
import { DEFAULT_WORKSPACE_LIMITS, createWorkspaceTools } from '../../src/core/workspace/workspace-tools.js';
import type { SourceAuthorityReads, SourceCanonicalRef, SourceCanonicalSnapshot } from '../../src/core/work-graph/source-authority-ports.js';
import { WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { createTaskClaimFixture } from '../helpers/task-claim-fixture.js';

const at = '2026-09-25T00:00:00.000Z';
const projectId = 'r4c-guard-project';
const workspaceId = 'r4c-guard-workspace';
const goalId = 'r4c-guard-goal';
const workspace: WorkspaceRef = { aggregateType: 'Workspace', projectId, workspaceId };
const workspaceSnapshot: SourceCanonicalSnapshot = { ref: workspace, revision: 1 };
const roleBinding: RoleBindingRefV1 = { schemaVersion: 1, bindingId: 'guard-binding', templateId: 'builder',
  templateRevision: '1', bindingVersion: 1, policyRevision: 'p1' };
const attemptRef: TaskAttemptRef = { aggregateType: 'TaskAttempt', projectId, goalId, taskId: 'guard-task', attemptId: 'guard-attempt' };
const runRef: RunRef = { aggregateType: 'Run', projectId, goalId, runId: 'guard-run' };

const signal = () => new AbortController().signal;
const canonical = (value: unknown): string => canonicalJson(value as JsonValue);
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.allSettled(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

/** Observe real sandbox entry points after fixture files have been written.
 * The spies call through; neither access success nor file contents are faked. */
function observeFileAccess() {
  const create = vi.spyOn(WorkspaceSandbox, 'create');
  const read = vi.spyOn(WorkspaceSandbox.prototype, 'read');
  const listFiles = vi.spyOn(WorkspaceSandbox.prototype, 'listFiles');
  return {
    create, read, listFiles,
    expectNone() {
      expect(create).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(listFiles).not.toHaveBeenCalled();
    },
    clear() { create.mockClear(); read.mockClear(); listFiles.mockClear(); },
  };
}

async function directory(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), 'next-r4c-guard-'));
  roots.push(base);
  const root = join(base, 'workspace');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src/main.ts'), 'export const guardedSource = 1;\n');
  return root;
}

type LoadBehavior = 'found' | 'not_found' | 'unavailable' | 'unsupported';
type FactEntry = { behavior: LoadBehavior; snapshot?: SourceCanonicalSnapshot };

/** Controlled read source: a per-ref behavior table plus the test-only events trap.
 * Trusted preparation, not a claim that a production provider exists. */
function fakeFacts(entries: [SourceCanonicalRef, FactEntry][]) {
  const table = new Map(entries.map(([ref, entry]) => [canonical(ref), entry]));
  let events = 0;
  const authority: SourceAuthorityReads = {
    async load(ref) {
      const entry = table.get(canonical(ref)) ?? { behavior: 'not_found' as const };
      switch (entry.behavior) {
        case 'found': return { status: 'found', snapshot: structuredClone(entry.snapshot!) };
        case 'not_found': return { status: 'not_found', ref };
        case 'unavailable': return { status: 'unavailable', reason: 'injected unavailable' };
        case 'unsupported': return { status: 'unsupported', reason: 'injected unsupported' };
      }
    },
    async events() { events += 1; throw Error('Work source reads must not read Query event pages'); },
  };
  return { authority, eventsCalls: () => events };
}

function validEnvelope(): TaskEnvelopeV1 {
  return {
    schemaVersion: 1, envelopeId: 'guard-envelope', projectId, workspaceId, goalId, taskId: attemptRef.taskId,
    runRef: { ...runRef }, attemptRef: { ...attemptRef },
    planRef: { aggregateType: 'PlanRevision', projectId, planId: 'guard-plan' },
    roleBinding: { ...roleBinding }, workspaceSnapshot: { workspaceId, revision: 1 },
    permissions: { policyRevision: 'p1', tools: ['read'], writeScope: [] },
    budget: { tokenBudget: 1000, deadline: null }, sourceRefs: [],
    bundleRef: { kind: 'artifact', digest: 'f'.repeat(64), sizeBytes: 10, contentType: 'text/plain',
      source: { kind: 'workspace', refId: workspaceId, revision: '1' } },
  };
}

function runningRun(overrides: {
  envelope?: TaskEnvelopeV1 | null; roleBinding?: RoleBindingRefV1; workspaceId?: string;
  status?: RunSnapshot['status']; outcome?: RunSnapshot['outcome'];
} = {}): RunSnapshot {
  return {
    ref: { ...runRef }, revision: 1, schemaVersion: 1,
    task: { projectId, goalId, taskId: attemptRef.taskId }, attemptId: attemptRef.attemptId,
    planRef: { aggregateType: 'PlanRevision', projectId, planId: 'guard-plan' },
    roleBinding: overrides.roleBinding ?? { ...roleBinding }, budget: { tokenBudget: 1000, deadline: null },
    workspaceSnapshot: { workspaceId: overrides.workspaceId ?? workspaceId, revision: 1 },
    status: overrides.status ?? 'running', outcome: overrides.outcome ?? null, exitCode: null,
    lastEventSeq: 0, lastRuntimeEventId: '', lastFactEventId: '',
    envelope: overrides.envelope === undefined ? validEnvelope() : overrides.envelope,
    startedAt: at, endedAt: null,
  };
}

function workContext(binding: RoleBindingRefV1 = roleBinding): CoreCallContext {
  return { projectId, workspaceId,
    principal: { kind: 'work_run', runRef: { ...runRef }, roleBinding: { ...binding } },
    materialReader: { kind: 'run', requester: { ...runRef } }, signal: signal() };
}

function workBinding(root: string) {
  return { kind: 'work' as const, root, workspace: { ...workspace }, runRef: { ...runRef },
    attemptRef: { ...attemptRef }, roleBinding: { ...roleBinding } };
}

const policyFor = (root: string): SourcePolicy => ({ root, permissionRevision: 'mount-p1', allowsRead: () => true });
function accessFor(authority: SourceAuthorityReads, policy: SourcePolicy, runtime?: ReturnType<typeof workBinding>) {
  return createSourceCaptureAccess({ authority: () => authority, sourcePolicyFor: async () => policy, signal: signal(),
    ...(runtime ? { runtime } : {}) });
}
const factsWithRun = (run: RunSnapshot) => fakeFacts([
  [workspace, { behavior: 'found', snapshot: workspaceSnapshot }], [runRef, { behavior: 'found', snapshot: run }]]);

it.each(['unavailable', 'unsupported'] as const)('resolveRoot maps a %s workspace read to the same-named rejection', async behavior => {
  const root = await directory();
  const io = observeFileAccess();
  const facts = fakeFacts([[workspace, { behavior }]]);
  const result = await accessFor(facts.authority, policyFor(root)).open(workContext(), workspace);
  io.expectNone();
  expect(result).toMatchObject({ status: 'rejected', code: behavior });
  expect(facts.eventsCalls()).toBe(0);
});

it('resolveRoot keeps a genuinely missing workspace as not_found', async () => {
  const root = await directory();
  const facts = fakeFacts([]);
  await expect(accessFor(facts.authority, policyFor(root)).open(workContext(), workspace))
    .resolves.toMatchObject({ status: 'rejected', code: 'not_found' });
});

it.each([
  { behavior: 'unavailable' as const, expected: 'unavailable' as const },
  { behavior: 'unsupported' as const, expected: 'unsupported' as const },
  { behavior: 'not_found' as const, expected: 'forbidden' as const },
])('a $behavior reader Run read maps to $expected', async ({ behavior, expected }) => {
  const root = await directory();
  const io = observeFileAccess();
  const facts = fakeFacts([[workspace, { behavior: 'found', snapshot: workspaceSnapshot }], [runRef, { behavior }]]);
  const result = await accessFor(facts.authority, policyFor(root), workBinding(root)).open(workContext(), workspace);
  io.expectNone();
  expect(result).toMatchObject({ status: 'rejected', code: expected });
  expect(facts.eventsCalls()).toBe(0);
});

const corruptPermissions: { label: string; permissions: unknown }[] = [
  { label: 'missing permissions object', permissions: undefined },
  { label: 'tools is not an array', permissions: { policyRevision: 'p1', tools: 'read', writeScope: [] } },
  { label: 'tools has a non-string member', permissions: { policyRevision: 'p1', tools: [7], writeScope: [] } },
  { label: 'tools mixes a read grant with a non-string member', permissions: { policyRevision: 'p1', tools: ['read', 7], writeScope: [] } },
  { label: 'writeScope is not an array', permissions: { policyRevision: 'p1', tools: ['read'], writeScope: 'all' } },
  { label: 'writeScope has a non-string member', permissions: { policyRevision: 'p1', tools: ['read'], writeScope: [7] } },
  { label: 'policyRevision is not a string', permissions: { policyRevision: 7, tools: ['read'], writeScope: [] } },
];

it.each(corruptPermissions)('corrupt envelope permissions ($label) reject as unavailable without throwing', async ({ permissions }) => {
  const root = await directory();
  const io = observeFileAccess();
  const envelope = { ...validEnvelope(), permissions } as unknown as TaskEnvelopeV1;
  const facts = factsWithRun(runningRun({ envelope }));
  const result = await accessFor(facts.authority, policyFor(root), workBinding(root)).open(workContext(), workspace)
    .catch(error => ({ status: 'threw' as const, error }));
  io.expectNone();
  expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
  expect(facts.eventsCalls()).toBe(0);
});

it('a corrupt-permission rejection never reaches file read or capture', async () => {
  const root = await directory();
  const io = observeFileAccess();
  const envelope = { ...validEnvelope(), permissions: { policyRevision: 'p1', tools: 'read', writeScope: [] } } as unknown as TaskEnvelopeV1;
  const facts = factsWithRun(runningRun({ envelope }));
  const handle = createWorkspaceTools({ access: accessFor(facts.authority, policyFor(root), workBinding(root)),
    now: () => at, limits: DEFAULT_WORKSPACE_LIMITS });
  try {
    const read = await handle.tools.readWorkspace(workContext(),
      { workspace, path: 'src/main.ts', maxBytes: 4096, version: { kind: 'working_tree' } })
      .catch(error => ({ status: 'threw' as const, error }));
    const capture = await handle.tools.captureSourceChanges(workContext(),
      { workspace, workspaceRevision: 1, provider: 'text' })
      .catch(error => ({ status: 'threw' as const, error }));
    io.expectNone();
    expect(read).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(capture).toMatchObject({ status: 'rejected', code: 'unavailable' });
  } finally {
    await handle.close();
  }
});

it('a fully eligible Work Run opens real source without reading Query event pages', async () => {
  const root = await directory();
  const facts = factsWithRun(runningRun());
  const opened = await accessFor(facts.authority, policyFor(root), workBinding(root)).open(workContext(), workspace);
  expect(opened).toMatchObject({ status: 'ready', value: { workspaceRevision: 1 } });
  if (opened.status === 'ready') await opened.value.release();
  expect(facts.eventsCalls()).toBe(0);
});

it('keeps the existing Run eligibility, identity, scope and read-grant checks', async () => {
  const root = await directory();
  const cases: RunSnapshot[] = [
    runningRun({ status: 'starting' }),
    runningRun({ status: 'ended', outcome: 'completed' }),
    runningRun({ envelope: null }),
    runningRun({ workspaceId: 'other-workspace' }),
    runningRun({ roleBinding: { ...roleBinding, bindingVersion: 2 } }),
    runningRun({ envelope: { ...validEnvelope(), permissions: { policyRevision: 'p1', tools: [], writeScope: [] } } as unknown as TaskEnvelopeV1 }),
  ];
  for (const run of cases) {
    const facts = factsWithRun(run);
    await expect(accessFor(facts.authority, policyFor(root), workBinding(root)).open(workContext(), workspace))
      .resolves.toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(facts.eventsCalls()).toBe(0);
  }
});

it('rejects an unknown principal kind before creating a sandbox', async () => {
  const root = await directory();
  const facts = factsWithRun(runningRun());
  const ctx = workContext();
  // A complete known Run and role cannot turn an unrecognized identity kind
  // into a work_run principal by elimination of the other known variants.
  ctx.principal = { ...ctx.principal, kind: 'unrecognized_identity' } as unknown as CoreCallContext['principal'];
  const io = observeFileAccess();
  const result = await accessFor(facts.authority, policyFor(root), workBinding(root)).open(ctx, workspace);
  if (result.status === 'ready') await result.value.release();
  expect.soft(result).toMatchObject({ status: 'rejected', code: 'forbidden' });
  io.expectNone();
  expect(facts.eventsCalls()).toBe(0);
});

it('rejects unreadable consumed envelope identity from a real stored Run without throwing or file I/O', async () => {
  const fixture = await createTaskClaimFixture('sqlite');
  try {
    const claimed = await fixture.service.claimTask(fixture.ctx, await fixture.buildRequest());
    if (claimed.status !== 'committed') throw Error('real TaskClaim fixture did not commit');
    const material = createMaterialRecordReaders(fixture.records).authority;
    const original = await material.load(claimed.value.runRef);
    if (original.status !== 'found' || original.snapshot.ref.aggregateType !== 'Run') {
      throw Error('real claim Run could not be decoded by MaterialAuthority');
    }
    const run = original.snapshot as RunSnapshot;
    // The existing Run codec permits an object envelope. Its permissions are
    // valid here; only identities actually consumed by the runtime are absent.
    const envelope = { permissions: validEnvelope().permissions } as TaskEnvelopeV1;
    const damaged: RunSnapshot = { ...run, revision: run.revision + 1, status: 'running', startedAt: at, envelope };
    const refKey = canonical(run.ref);
    expect(await fixture.commitRaw([{ refKey, schemaId: 'RunSnapshot@1', revision: damaged.revision,
      json: JSON.stringify(damaged) }], [{ refKey, expectedRevision: run.revision }]))
      .toMatchObject({ status: 'committed' });
    // Prove the malformed identity reaches the consumer through the real codec,
    // instead of using a fake successful provider result or a failed fixture.
    expect(await material.load(run.ref)).toMatchObject({ status: 'found', snapshot: { envelope } });
    const snapshots = createSourceAuthorityReader({ authority: material });
    const events = vi.fn(async () => { throw Error('Work guard must not read Query event pages'); });
    const authority: SourceAuthorityReads = { ...snapshots, events };
    const root = await directory();
    const runtime = { kind: 'work' as const, root, workspace: fixture.workspaceRef,
      runRef: run.ref, attemptRef: claimed.value.attemptRef, roleBinding: run.roleBinding };
    const ctx: CoreCallContext = { ...fixture.ctx,
      principal: { kind: 'work_run', runRef: run.ref, roleBinding: run.roleBinding },
      materialReader: { kind: 'run', requester: run.ref } };
    const io = observeFileAccess();
    const result = await accessFor(authority, policyFor(root), runtime).open(ctx, fixture.workspaceRef)
      .catch(error => ({ status: 'threw' as const, error: String(error) }));
    io.expectNone();
    expect(result).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(events).not.toHaveBeenCalled();
  } finally {
    await fixture.close();
  }
});

it('keeps the prepared root, mount registration and host lifecycle checks', async () => {
  const root = await directory();
  const otherRoot = await directory();
  const facts = factsWithRun(runningRun());
  await expect(accessFor(facts.authority, policyFor(otherRoot), workBinding(root)).open(workContext(), workspace))
    .resolves.toMatchObject({ status: 'rejected', code: 'forbidden' });
  const unregistered = createSourceCaptureAccess({ authority: () => facts.authority,
    sourcePolicyFor: async () => null, signal: signal(), runtime: workBinding(root) });
  await expect(unregistered.open(workContext(), workspace)).resolves.toMatchObject({ status: 'rejected', code: 'not_found' });
  const stopped = new AbortController(); stopped.abort();
  const stopping = createSourceCaptureAccess({ authority: () => facts.authority,
    sourcePolicyFor: async () => policyFor(root), signal: stopped.signal, runtime: workBinding(root) });
  await expect(stopping.open(workContext(), workspace)).resolves.toMatchObject({ status: 'rejected', code: 'cancelled' });
});

it('uses real SQLite facts through both readers: a starting claim is denied, a trusted running seed can read, and revocation is fresh', async () => {
  const fixture = await createTaskClaimFixture('sqlite');
  let handle: ReturnType<typeof createWorkspaceTools> | undefined;
  try {
    const claimed = await fixture.service.claimTask(fixture.ctx, await fixture.buildRequest());
    expect(claimed.status).toBe('committed');
    if (claimed.status !== 'committed') throw Error('real TaskClaim fixture did not commit');
    const materialAuthority = createMaterialRecordReaders(fixture.records).authority;
    const original = await materialAuthority.load(claimed.value.runRef);
    if (original.status !== 'found' || original.snapshot.ref.aggregateType !== 'Run') {
      throw Error('real claim Run could not be decoded by MaterialAuthority');
    }
    let current = original.snapshot as RunSnapshot;
    expect(current).toMatchObject({ status: 'starting', envelope: null });
    const root = await directory();
    const snapshots = createSourceAuthorityReader({ authority: materialAuthority });
    const events = vi.fn(async () => { throw Error('Work integration must not read Query event pages'); });
    // Only the old consumer signature needs this test-only events trap. The
    // production reader contributes load alone; Query is not assembled here.
    const authority: SourceAuthorityReads = { ...snapshots, events };
    const ctx: CoreCallContext = {
      ...fixture.ctx,
      principal: { kind: 'work_run', runRef: claimed.value.runRef, roleBinding: fixture.roleBinding },
      materialReader: { kind: 'run', requester: claimed.value.runRef },
    };
    const runtime = { kind: 'work' as const, root, workspace: fixture.workspaceRef,
      runRef: claimed.value.runRef, attemptRef: claimed.value.attemptRef, roleBinding: fixture.roleBinding };
    handle = createWorkspaceTools({ access: accessFor(authority, policyFor(root), runtime),
      now: () => at, limits: DEFAULT_WORKSPACE_LIMITS });
    const input = { workspace: fixture.workspaceRef, path: 'src/main.ts', maxBytes: 4096,
      version: { kind: 'working_tree' as const } };
    const io = observeFileAccess();

    const starting = await handle.tools.readWorkspace(ctx, input);
    io.expectNone();
    expect.soft(starting).toMatchObject({ status: 'rejected', code: 'forbidden' });

    const seedRun = async (next: RunSnapshot) => {
      const refKey = canonical(current.ref);
      const committed = await fixture.commitRaw([{ refKey, schemaId: 'RunSnapshot@1',
        revision: next.revision, json: JSON.stringify(next) }],
      [{ refKey, expectedRevision: current.revision }]);
      expect(committed).toMatchObject({ status: 'committed' });
      current = next;
    };
    const envelope: TaskEnvelopeV1 = {
      ...validEnvelope(), projectId: fixture.scope.projectId, workspaceId: fixture.scope.workspaceId,
      goalId: current.task.goalId, taskId: current.task.taskId,
      runRef: current.ref, attemptRef: claimed.value.attemptRef, planRef: current.planRef,
      roleBinding: current.roleBinding, workspaceSnapshot: current.workspaceSnapshot, budget: current.budget,
      bundleRef: { ...validEnvelope().bundleRef,
        source: { kind: 'workspace', refId: fixture.scope.workspaceId, revision: '1' } },
    };
    // Trusted persisted test seed for this consumer only. No entry service,
    // execution authorization or claim-to-running transition is claimed here.
    await seedRun({ ...current, revision: current.revision + 1, status: 'running', startedAt: at, envelope });
    io.clear();
    const readable = await handle.tools.readWorkspace(ctx, input);
    expect.soft(readable).toMatchObject({ status: 'ready', value: {
      path: 'src/main.ts', content: 'export const guardedSource = 1;\n' } });
    expect.soft(io.read).toHaveBeenCalledTimes(1);

    await seedRun({ ...current, revision: current.revision + 1,
      envelope: { ...envelope, permissions: { ...envelope.permissions, tools: [] } } });
    io.clear();
    const revoked = await handle.tools.readWorkspace(ctx, input);
    io.expectNone();
    expect(revoked).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(events).not.toHaveBeenCalled();
  } finally {
    await handle?.close();
    await fixture.close();
  }
});
