/**
 * B2-16 (L19a K8-6 / decision 69) item 2: the Task closure is read EXACTLY
 * ONCE per `shell` hook call, including the branch that CONSUMES a one-time
 * allowance. Before item 2 the hook read it twice on that branch (the
 * one-closure pager, then `consumeAllowance`'s own read), so a single call
 * could act on two points in time.
 *
 * The world is the real public `openB2BlockedWorld` path: the record comes from
 * a real blocked Run, the request is written by the real `request_command_rerun`
 * tool, the answer is applied by the real decision coordinator -> CRR owner,
 * and the hook is the production `before_tool` hook. Only the workspace file
 * CONTENT is injected. The `readTaskClosure` seam is the production reader over
 * the SAME records, wrapped with a counter (the optional helper seam); no
 * closure value is written by the test.
 *
 * The closed-Task coverage runs the real Plan change (`setK3TaskDisposition`)
 * before the call, so `closed` is the platform's own derivation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { nextCall, openB2BlockedWorld, runHook, runTool, type B2BlockedWorld } from '../helpers/B2-blocked-runtime.js';
import { setK3TaskDisposition } from '../helpers/K3-review-card-fixture.js';
import type { CommandRerunRequestRef } from '../../src/contracts/command-rerun-request.js';
import type { ToolCall } from '../../vendor/coding-agent/dist/public-api.js';

// §5.1's stand-in `shell`, hoisted per test file (the fixture's real Run uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const FILES: Record<string, string> = {
  'app/package.json': JSON.stringify({ scripts: { 'db-migrate': 'prisma migrate deploy' } }),
  'package.json': JSON.stringify({ scripts: { 'db-migrate': 'prisma migrate deploy' } }),
};

const worlds: B2BlockedWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

const shell = (command: string): ToolCall => ({ schemaVersion: 1, callId: nextCall(), name: 'shell',
  arguments: { command } });

/** The real world with the production closure reader wrapped by a counter. */
async function countedWorld(kind: 'memory' | 'sqlite'): Promise<{ world: B2BlockedWorld; reads: string[] }> {
  const reads: string[] = [];
  const world = await openB2BlockedWorld(kind, {
    files: FILES,
    readTaskClosure: inner => async (ctx, task) => {
      reads.push(task.taskId);
      return inner(ctx, task);
    },
  });
  worlds.push(world);
  return { world, reads };
}

/** Request -> allow through the real tool/answer owners; returns the allowed ref. */
async function allowedRequest(w: B2BlockedWorld): Promise<{ ref: CommandRerunRequestRef; revision: number }> {
  const requested = await runTool(w.tool, { command: 'npm run db:migrate', reason: '需要重新迁移' });
  expect(requested.output[0]).toMatchObject({ kind: 'json', value: { status: 'requested' } });
  const pending = (await w.listRequests(w.ctx))[0]!;
  expect(pending).toMatchObject({ state: 'pending' });
  expect(await w.answer('allow_rerun', pending.ref, pending.revision))
    .toMatchObject({ status: 'committed', value: { state: 'allowed' } });
  return { ref: pending.ref, revision: pending.revision + 1 };
}

describe.each(['memory', 'sqlite'] as const)('B2-16 hook closure read per call (%s)', kind => {
  it('B2-16 (v): the allowance-consumption hook call reads the Task closure EXACTLY ONCE', async () => {
    const { world: w, reads } = await countedWorld(kind);
    await allowedRequest(w);

    // The setup paid its own closure reads; count only the hook call.
    reads.length = 0;
    const call = shell('npm run db:migrate');
    expect(await runHook(w.hook, call)).toEqual({ point: 'before_tool', kind: 'continue' });
    // One read: the list read is handed to the consume instead of being repeated.
    expect(reads).toEqual([w.record.task.taskId]);

    // The allowance was really consumed by that one call.
    expect((await w.listRequests(w.ctx))[0]).toMatchObject({ state: 'used',
      usedBy: { runId: w.runRef.runId, callId: call.callId } });
  });

  it('B2-16 (vi): on a Task the real Plan change closed, one hook call reads the closure once and blocks', async () => {
    const { world: w, reads } = await countedWorld(kind);
    await allowedRequest(w);
    await setK3TaskDisposition(w.blocked.world, w.record.task.taskId, 'cancelled');

    reads.length = 0;
    const blocked = await runHook(w.hook, shell('npm run db:migrate'));
    expect(reads).toEqual([w.record.task.taskId]);
    if (blocked.kind !== 'block') throw new Error(`the closed Task must block: ${JSON.stringify(blocked)}`);
    // `listTaskRequests` already derives the closed request, so the recognizer
    // names the blocked command; the allowance is never consumed.
    expect(blocked.reason).toContain('平台拦下了这条命令');
  });

  it('B2-16 (vii): a closed Task still voids the delivery allowance (busy) after ONE closure read', async () => {
    const { world: w, reads } = await countedWorld(kind);
    const allowed = await allowedRequest(w);
    await setK3TaskDisposition(w.blocked.world, w.record.task.taskId, 'cancelled');

    // The delivery step itself reads the closure ONCE through the real owner;
    // that read's `closure` is handed straight to the consume, which must reuse
    // it (no second read) and still reject `busy`.
    reads.length = 0; // drop the setup's reads
    const listed = await w.requests.listTaskRequests(w.ctx, { workspace: w.workspace,
      filter: { goalId: w.record.task.goalId, taskId: w.record.task.taskId } });
    if (listed.status !== 'ready') throw new Error(JSON.stringify(listed));
    expect(listed.value.closure).toEqual({ task: w.record.task, closed: true });
    expect(reads).toEqual([w.record.task.taskId]);
    reads.length = 0;
    const consumed = await w.requests.consumeAllowance(w.ctx, {
      input: { requestRef: allowed.ref, usedBy: { runId: w.runRef.runId, callId: nextCall() } },
      meta: { requestId: 'b2-16-closed-consume',
        expected: [{ ref: allowed.ref as never, revision: allowed.revision }] },
    }, listed.value.closure);
    expect(consumed).toMatchObject({ status: 'rejected', code: 'busy' });
    expect(reads).toEqual([]);
  });
});
