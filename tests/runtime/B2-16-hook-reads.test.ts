/**
 * B2-16 (L19a K8-6 / decision 69) on the public store read ports, wrapped with
 * counters:
 *   (i) a task with blocked commands pays exactly one record-state read per
 *       distinct binding record, ceil(R/200) CRR pages, at most 2 current
 *       `package.json` reads per `shell` call, and rework 2 item 2 adds: the
 *       Task closure is read exactly ONCE per hook call (all pages reuse it);
 *   (ii) a task with NO blocked commands pays zero extra reads;
 *   (iv) a Task-closure read failure is the fixed unconfirmed block, never
 *       "continue" (item 2: a read failure stays `unavailable`).
 *
 * The R = 401 row moved to the ONE shared 401-Run world
 * (`B2-401-world.test.ts`, rework 4 item 5): it is built once there and both
 * B2-16 (iii) and B2-18's request row measure it with reset counters.
 *
 * The requests are created through the real CRR owner (request -> deny in run
 * N -> request in run N+1); no record or page is hand-encoded. The first Run is
 * the real blocked Run `openB2BlockedWorld` seeds (public claim -> production
 * `startRun` -> RUN-20/RUN-22). F-021: the recognizer's `package.json` reads go
 * through the production workspace reader over real files, and the Task-closure
 * reader is a counting wrapper around the production `readTaskClosure` over the
 * SAME records, the same seam the composition injects.
 */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HookPort, ToolCall, ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { nextCall, openB2BlockedWorld, runHook, type B2BlockedWorld } from '../helpers/B2-blocked-runtime.js';
import { createShellBlockedHook } from '../../src/core/agent-runtime/execution-driver.js';
import { createCommandRerunRequestService } from '../../src/core/work-graph/tasks/command-rerun-request-service.js';
import { createCommandRecognizer } from '../../src/core/work-graph/tasks/command-recognition.js';
import { readTaskClosure } from '../../src/core/work-graph/tasks/plan-readers.js';
import { K3_CRR_BY_TASK_LOOKUP } from '../../src/core/work-graph/tasks/command-rerun-request-codecs.js';
import { countWorkspaceReads, openRealWorkspace, type RealWorkspace } from '../helpers/K3-real-workspace.js';
import { T } from '../helpers/S5-decision-fixture.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort, RecordLookupRequest } from '../../src/core/record-store/lookup-ports.js';

// §5.1's stand-in `shell`, hoisted per test file (the fixture's real Run uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: B2BlockedWorld[] = [];
const workspaces: RealWorkspace[] = [];
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await workspace.close();
  for (const world of worlds.splice(0)) await world.close();
});

const shell = (command: string): ToolCall => ({ schemaVersion: 1, callId: nextCall(), name: 'shell',
  arguments: { command } });

const FILES: Record<string, string> = {
  'app/package.json': JSON.stringify({ scripts: { 'db:migrate': 'prisma migrate deploy',
    'migrate:prod': 'prisma migrate deploy' } }),
  'package.json': JSON.stringify({ scripts: { 'db:migrate': 'prisma migrate deploy' } }),
};

const BLOCKED_UNCONFIRMED = '平台暂时确认不了这条命令有没有被拦，这次先不跑；稍后再试。';

async function blockedWorld(kind: 'memory' | 'sqlite'): Promise<B2BlockedWorld> {
  // Both backends reach the same real Run harness; on memory the Host is
  // reopened only through the A4 backend seam, so the world's own store is used.
  const w = await openB2BlockedWorld(kind, { files: FILES });
  worlds.push(w);
  return w;
}

type CountingWorld = {
  base: B2BlockedWorld;
  requests: ReturnType<typeof createCommandRerunRequestService>;
  hook: HookPort;
  /** The real seeded Run's context (its own RunRef and role binding). */
  ctx: CoreCallContext;
  /** Every `readTaskClosure` call, in order. */
  closureReads: string[];
  /** Every physical `k3-crr-by-task` page request, in order. */
  pageCalls: Array<{ limit: number; cursor: string | undefined }>;
  /** Every current record read by the hook, in order. */
  recordReads: string[];
  /** Every workspace read through the recognizer, in order. */
  packageReads: string[];
  /** Make the NEXT closure read throw, once. */
  failClosure(): void;
};

/**
 * The SAME real world/owner/recognizer/hook the composition wires, with two
 * counters: the public store port (physical CRR pages) and an injected
 * `readTaskClosure` wrapper (the required production seam).
 */
async function countingWorld(kind: 'memory' | 'sqlite'): Promise<CountingWorld> {
  const base = await blockedWorld(kind);
  const closureReads: string[] = [];
  const pageCalls: CountingWorld['pageCalls'] = [];
  const recordReads: string[] = [];
  let closureFault = 0;
  let eventSeq = 0;
  const store = base.blocked.world.records;
  const records = {
    readMany: (keys: readonly string[]) => store.readMany(keys),
    lookupCommit: (input: Parameters<GoalRecordTransactionPort['lookupCommit']>[0]) => store.lookupCommit(input),
    eventAt: (cursor: Parameters<GoalRecordTransactionPort['eventAt']>[0]) => store.eventAt(cursor),
    commit: (input: Parameters<GoalRecordTransactionPort['commit']>[0]) => store.commit(input),
    lookup: (request: RecordLookupRequest) => {
      if (request.index === K3_CRR_BY_TASK_LOOKUP) pageCalls.push({ limit: request.limit, cursor: request.after });
      return store.lookup(request);
    },
  } as GoalRecordTransactionPort & RecordLookupPort;
  const workspaceScope = { projectId: base.workspace.projectId, workspaceId: base.workspace.workspaceId };
  const listTaskReviews = async (ctx: CoreCallContext, input: {
    goalRef: { aggregateType: 'Goal'; projectId: string; goalId: string }; taskId: string;
  }) => {
    const items = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await base.blocked.reviews.listReviews(ctx, { workspace: workspaceScope,
        filter: { goalRef: input.goalRef, taskId: input.taskId },
        page: { limit: 200, ...(cursor === undefined ? {} : { cursor }) } });
      if (page.status !== 'ready') return page;
      items.push(...page.value.items);
      if (page.value.nextCursor === null) return { status: 'ready' as const, value: items };
      cursor = page.value.nextCursor;
    }
  };
  // F-021: real files under the world's root, read through the production
  // workspace reader; the counter wraps that real reader.
  const realWorkspace = await openRealWorkspace({
    root: join(base.blocked.world.fixture.base.directory, 'hook-real-workspace'),
    workspace: { aggregateType: 'Workspace', projectId: base.workspace.projectId,
      workspaceId: base.workspace.workspaceId },
    files: FILES,
  });
  workspaces.push(realWorkspace);
  const counted = countWorkspaceReads(realWorkspace.readWorkspace);
  const packageReads = counted.paths;
  const recognizer = createCommandRecognizer({ readWorkspace: counted });
  const requests = createCommandRerunRequestService({
    records,
    listTaskReviews,
    readTaskClosure: async (_ctx, task) => {
      closureReads.push(task.taskId);
      if (closureFault > 0) {
        closureFault -= 1;
        throw new Error('injected Task-closure read failure');
      }
      return readTaskClosure(records, { aggregateType: 'Goal',
        projectId: task.projectId, goalId: task.goalId }, task.taskId);
    },
    recognize: recognizer,
    now: () => T,
    eventId: () => `b2-16-event-${String(++eventSeq)}`,
  });
  const reviews = {
    async readReview(ctx: CoreCallContext, input: { ref: { runId: string } }) {
      recordReads.push(input.ref.runId);
      return base.blocked.reviews.readReview(ctx, input as never);
    },
  };
  // The real seeded Run's own work_run context: no made-up identity here.
  const runRef = base.blocked.run.ref;
  const ctx: CoreCallContext = {
    projectId: base.workspace.projectId, workspaceId: base.workspace.workspaceId,
    principal: { kind: 'work_run', runRef, roleBinding: base.blocked.run.roleBinding },
    materialReader: { kind: 'run', requester: runRef },
    signal: new AbortController().signal,
  };
  const hook = createShellBlockedHook({
    ctx, runRef, taskId: base.record.task.taskId, workspace: base.workspace,
    binding: base.binding, reviews: reviews as never, requests, recognizer,
  });
  return { base, requests, hook, ctx, closureReads, pageCalls, recordReads, packageReads,
    failClosure: () => { closureFault += 1; } };
}

describe.each(['memory', 'sqlite'] as const)('B2-16 hook read bound (%s)', kind => {
  it('B2-16 (i): one record read, one CRR page, ONE closure read, at most two package.json reads', async () => {
    const w = await countingWorld(kind);
    // A non-exact form so the recognizer (and its package reads) really runs.
    expect(await runHook(w.hook, shell('bash -c "cd app && npm run db:migrate"')))
      .toMatchObject({ point: 'before_tool', kind: 'block' });
    expect(w.recordReads).toHaveLength(1);
    expect(w.pageCalls).toEqual([{ limit: 200, cursor: undefined }]);
    expect(w.closureReads).toHaveLength(1);
    expect(w.packageReads.length).toBeLessThanOrEqual(2);
    expect(new Set(w.packageReads).size).toBe(w.packageReads.length);
  });

  it('B2-16 (ii): a task without blocked commands pays zero extra reads', async () => {
    const w = await countingWorld(kind);
    const reads: string[] = [];
    const hook = createShellBlockedHook({
      ctx: w.ctx, runRef: w.base.blocked.run.ref,
      taskId: w.base.record.task.taskId, workspace: w.base.workspace, binding: [],
      reviews: { async readReview() { reads.push('review'); throw new Error('must not read'); } },
      requests: {
        async listRequests() { reads.push('list'); throw new Error('must not read'); },
        async listTaskRequests() { reads.push('closure'); throw new Error('must not read'); },
        async readRequest() { reads.push('read'); throw new Error('must not read'); },
        async requestRerun() { reads.push('request'); throw new Error('must not write'); },
        async applyAnswer() { reads.push('answer'); throw new Error('must not write'); },
        async consumeAllowance() { reads.push('consume'); throw new Error('must not write'); },
        async lookupToolCommit() { reads.push('commit'); throw new Error('must not read'); },
      } as never,
      recognizer: async () => { reads.push('recognize'); throw new Error('must not read'); },
    });
    expect(await runHook(hook, shell('npm run db:migrate')))
      .toEqual({ point: 'before_tool', kind: 'continue' });
    expect(reads).toEqual([]);
  });

  it('B2-16 (v): a script form only the real package.json expansion recognises is blocked', async () => {
    const w = await countingWorld(kind);
    // `migrate:prod` is not the blocked record's action; only the expanded
    // `prisma migrate deploy` body matches it.
    expect(await runHook(w.hook, shell('bash -c "cd app && npm run migrate:prod"')))
      .toMatchObject({ point: 'before_tool', kind: 'block' });
    expect(w.packageReads).toEqual(['app/package.json']);
  });

  it('B2-16 (vi): moving the real package.json away loses only that expansion, never throws', async () => {
    const w = await countingWorld(kind);
    await rm(join(w.base.blocked.world.fixture.base.directory, 'hook-real-workspace/app/package.json'));
    expect(await runHook(w.hook, shell('bash -c "cd app && npm run migrate:prod"')))
      .toEqual({ point: 'before_tool', kind: 'continue' });
    expect(w.packageReads).toEqual(['app/package.json']);
  });

  it('B2-16 (iv): a closure read failure blocks with the fixed unconfirmed text, never continues', async () => {
    const w = await countingWorld(kind);
    w.failClosure();
    expect(await runHook(w.hook, shell('npm run db:migrate')))
      .toEqual({ point: 'before_tool', kind: 'block', reason: BLOCKED_UNCONFIRMED });
    expect(w.closureReads).toHaveLength(1);
  });
});
