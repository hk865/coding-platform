/**
 * K3 row K3-12 (L13): the review round's fixed tool list and empty write scope
 * at the preparation seam, and the read-only command's failure mapping when the
 * command tries to change a file.
 *
 * The first half (F-054) drives `createExecutionPreparation` over the REAL
 * blocked Run and review round on memory and SQLite (`openK3ReviewCardWorld`),
 * reading the Run, Role, review record and prepared manifest through the
 * platform's own owners and the world's ONE artifact-body store. Only the Host
 * configuration is the A8 input; it grants a whole-workspace write scope so a
 * review round that inherited the Role/Host list or scope would fail. The
 * second half drives the real `run_readonly_command` handler with the Kernel
 * `ProcessSandbox` capability stand-in (same stand-in as K's KB-10): the
 * simulated read-only mount refuses the write with a non-zero exit and the
 * handler maps it to `execution_failed` without reporting any workspace change.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { ResolvedRuntimeConfiguration } from '../../src/core/agent-runtime/execution-contracts.js';
import type { ExecutionPreparationDependencies } from '../../src/core/agent-runtime/execution-preparation.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createExecutionPreparation, loadPreparedManifest } from '../../src/core/agent-runtime/execution-preparation.js';
import { createReadonlyCommandTool } from '../../src/core/agent-runtime/readonly-command-tool.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { readTaskClosure } from '../../src/core/work-graph/tasks/plan-readers.js';
import { openK3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { createK3PendingReview, readK3Review } from '../helpers/K3-proposal-round.js';
import { GOAL_B, PLAN_B2, T } from '../helpers/S5-decision-fixture.js';

// §5.1's stand-in `shell`, hoisted per test file (the real blocked Run below
// enters through it; the review round's own preparation is the real owner).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

function hostConfiguration(): ResolvedRuntimeConfiguration {
  return {
    configurationRevision: 'host@1',
    model: { configuration: { revision: 'm@1', provider: 'scripted', model: 'm', baseUrl: 'http://127.0.0.1' },
      client: {} as unknown as ResolvedRuntimeConfiguration['model']['client'] },
    budget: { contextWindowTokens: 128000, inputTokens: null, outputTokens: null, maxRequests: 4,
      maxToolCalls: 8, timeoutMs: null, perResponseTokens: 512 },
    hostTemplate: null, tools: ['read'], writeScope: ['.'],
    skills: { resourceRoot: 'skills', enabledIds: [] },
    systemInstruction: 'executor', deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
  };
}

/**
 * R4/L13: the formal granted set is exactly `read`, `run_readonly_command` and
 * `record_unknown_call_review`; the exploration tools ride with `read` in the
 * Kernel, and `shell`/`edit`/collaboration tools are absent. Written as a
 * hand-computed literal, not read from production.
 */
const EXPECTED_REVIEW_TOOLS = [
  'read', 'run_readonly_command', 'record_unknown_call_review',
];

type ReviewWorld = Awaited<ReturnType<typeof openK3ReviewCardWorld>>;

/**
 * F-054: the real review-purpose Run for this row. The blocked Run (and its
 * `pending_review` record) is the shared `createK3PendingReview` path; the round
 * is the world's real review claim (TASK-03r writes `activeRound` and commits
 * the Run `starting`), left unprepared so the row drives the production
 * preparation itself.
 */
async function claimReviewRound(world: ReviewWorld, record: UnknownCallReviewV1): Promise<TaskClaim> {
  const session = await world.fixture.createS5Session(`k3-12-review-session-${record.ref.runId}`);
  const claim = await world.fixture.claimRun({
    requestId: `k3-12-review-claim-${record.ref.runId}`,
    goalRef: GOAL_B, planRef: PLAN_B2, taskId: record.task.taskId, sessionRef: session,
    review: { reviewRef: record.ref, expectedRevision: record.revision, phase: 'review' },
  });
  const current = await readK3Review(world, record.ref);
  if (current.activeRound === null || current.activeRound.runRef.runId !== claim.runRef.runId) {
    throw new Error('F-054: the real claim did not record this Run as the active review round');
  }
  return claim;
}

/**
 * The production preparation over the world's own owners: the real Run/Role
 * readers, the world's review owner, its ONE artifact-body store and the real
 * Kernel store registry. The Host configuration is the A8 input (a Work grant
 * with `read` and a whole-workspace write scope), so a role-capped list or an
 * inherited write scope would fail the assertions.
 */
async function prepareReviewRun(world: ReviewWorld, claim: TaskClaim) {
  const records = world.records;
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: 's5-kernel', storeKey: 's5-kernel-store', workspace: world.fixture.base.scope,
    databasePath: join(world.fixture.base.directory, 's5-kernel.sqlite'),
  }] });
  const deps: ExecutionPreparationDependencies = {
    executions: createRunStateReader({ records }),
    roles: createRoleConfigurationService({ records, now: () => T, eventId: () => 'k3-12-role' }),
    bodies: world.fixture.bodies,
    host: { resolveConfiguration: async () => ({ status: 'ready', value: {
      ...hostConfiguration(),
      hostTemplate: { templateId: 'builder', revision: '1', digest: 'k3-12-template' } } }) } as never,
    materials: createMaterialService({ bodies: world.fixture.bodies, authority: createMaterialRecordReaders(records).authority, now: () => T }),
    unknownCallReviews: world.reviews,
    kernelStores,
    now: () => T,
    newId: () => 'k3-12-id',
    readTaskClosure: async (_ctx, task) => readTaskClosure(records, GOAL_B, task.taskId),
  };
  const prepared = await createExecutionPreparation(deps).prepare(world.fixture.ctx,
    { runRef: claim.runRef, requestId: 'k3-12-prep' });
  if (prepared.status !== 'ready') throw new Error(`prepare: ${JSON.stringify(prepared)}`);
  const loaded = await loadPreparedManifest(world.fixture.bodies, prepared.value);
  if (loaded.status !== 'ready') throw new Error(`manifest: ${loaded.status}`);
  return { prepared: prepared.value, manifest: loaded.value.manifest };
}

describe('K3-12 review round preparation', () => {
  it.each(['memory', 'sqlite'] as const)('(%s) K3-12 prepares a review-purpose Run with exactly the L13 tools and an empty write scope', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    try {
      const record = await createK3PendingReview(world);
      const claim = await claimReviewRound(world, record);
      const { prepared, manifest } = await prepareReviewRun(world, claim);
      expect(manifest.permissions.tools).toEqual(EXPECTED_REVIEW_TOOLS);
      expect(manifest.permissions.writeScope).toEqual([]);
      for (const forbidden of ['shell', 'edit', 'write', 'send_message', 'ask_user']) {
        expect(manifest.permissions.tools).not.toContain(forbidden);
      }
      // The written tools survive through the returned envelope too.
      expect(prepared.envelope.permissions.tools).toEqual(EXPECTED_REVIEW_TOOLS);
      expect(prepared.envelope.permissions.writeScope).toEqual([]);
      // The review section is still assembled (the tool list did not displace it).
      expect(manifest.unknownCallReview).toBeDefined();
      expect(manifest.input).toContain('run_readonly_command');
    } finally {
      await world.close();
    }
  });
});


// -------------------------------------------------------------------------- //
// run_readonly_command: a write attempt in the read-only sandbox              //
// -------------------------------------------------------------------------- //

const sandbox = vi.hoisted(() => ({
  available: true as boolean,
  commands: [] as string[],
  next: ((): unknown => ({
    exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text: '', totalBytes: 0, truncated: false },
    stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
    sandboxProfileVersion: 'stub-v1',
    timings: { snapshotBeforeMs: 0, executionMs: 0, snapshotAfterMs: 0 },
  })) as (command: string) => unknown,
}));

vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  class KProcessSandbox {
    constructor(_profile: unknown, _root: string, _workspace: unknown, _options?: Record<string, unknown>) {}
    get effectiveOptions(): { protectedPaths: string[]; readOnlyPaths: string[]; executablePath: string } {
      return { protectedPaths: [], readOnlyPaths: [], executablePath: '/usr/bin:/bin' };
    }
    static async probe(): Promise<unknown> {
      return sandbox.available
        ? { available: true, version: 'stub-v1', bwrapPath: '/usr/bin/bwrap', reason: null }
        : { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: bubblewrap unavailable' };
    }
    async execute(request: { command: string }): Promise<unknown> {
      // The stand-in never touches the host: it records the attempt and returns
      // the result the read-only mount would produce.
      sandbox.commands.push(request.command);
      return sandbox.next(request.command);
    }
  }
  return { ...actual, ProcessSandbox: KProcessSandbox };
});

afterEach(() => {
  sandbox.available = true;
  sandbox.commands = [];
  sandbox.next = () => ({
    exitCode: 0, signal: null, timedOut: false, cancelled: false,
    stdout: { text: '', totalBytes: 0, truncated: false },
    stderr: { text: '', totalBytes: 0, truncated: false },
    effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
    sandboxProfileVersion: 'stub-v1',
    timings: { snapshotBeforeMs: 0, executionMs: 0, snapshotAfterMs: 0 },
  });
});

function writeAttemptTool() {
  return createReadonlyCommandTool({
    workspace: {} as never,
    workspaceRoot: '/k3-12/workspace',
    authorization: {
      permissionRevision: 'k3-12-read@1',
      current: async () => ({ status: 'ready', permissionRevision: 'k3-12-read@1', wholeWorkspaceRead: true }),
    },
  });
}

describe('K3-12 read-only command write attempt', () => {
  it('K3-12 maps a file-changing command to execution_failed and reports no workspace change', async () => {
    const command = 'echo written > out.txt';
    // The read-only mount refuses the redirect: shell exit 1 with the
    // "Read-only file system" diagnostic (the KB-10 non-zero-exit mapping).
    sandbox.next = () => ({
      exitCode: 1, signal: null, timedOut: false, cancelled: false,
      stdout: { text: '', totalBytes: 0, truncated: false },
      stderr: { text: 'bash: line 1: out.txt: Read-only file system\n', totalBytes: 48, truncated: false },
      effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] },
      sandboxProfileVersion: 'stub-v1',
      timings: { snapshotBeforeMs: 0, executionMs: 1, snapshotAfterMs: 0 },
    });
    const tool = writeAttemptTool();
    const result = await tool.handler.execute(
      { schemaVersion: 1, callId: 'k3-12-write-call', name: 'run_readonly_command', arguments: { command } } as never,
      { signal: new AbortController().signal } as never);
    // The write attempt was attempted only inside the read-only sandbox.
    expect(sandbox.commands).toEqual([command]);
    expect(result.status).toBe('error');
    if (result.status !== 'error') throw new Error('the write attempt was not rejected');
    expect(result.error.code).toBe('execution_failed');
    expect(result.error.retryable).toBe(true);
    expect(result.error.message).toContain('命令退出码 1');
    const json = result.output.find(part => part.kind === 'json');
    if (json?.kind !== 'json') throw new Error('no json part');
    expect(json.value).toMatchObject({ stderr: { text: 'bash: line 1: out.txt: Read-only file system\n' } });
    // Nothing was written: no changed path and no side effect is reported.
    expect(result.effects.changedPaths).toEqual([]);
    expect(result.effects.sideEffect).toBe('none');
  });
});
