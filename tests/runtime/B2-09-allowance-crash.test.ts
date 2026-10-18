/**
 * B2-09 (L19a "已用先提交、成功才放行"; CRR-03):
 *
 * (a) a failed `consumeAllowance` commit blocks THIS call with the fixed text
 *     and leaves the allowance `allowed` (so the next call can still use it);
 * (b) the commit succeeds and the command never starts: the request is `used`
 *     with `usedBy`, and the SAME command is blocked again (the allowance was
 *     not returned).
 *
 * The full crash / `outcome_unknown` / K3-review half of (b) is the SQLite Host
 * E2E in `tests/scenarios/B2-09b-allowance-crash.test.ts` (a second crash needs
 * the real RUN-25/L29 Host path, which this owner-level world cannot restart).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { nextCall, openB2BlockedWorld, runHook, runTool, type B2BlockedWorld } from '../helpers/B2-blocked-runtime.js';
import type { ToolCall } from '../../vendor/coding-agent/dist/public-api.js';

// §5.1's stand-in `shell`, hoisted per test file (the fixture's real Run uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: B2BlockedWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

const shell = (command: string, callId = nextCall()): ToolCall => ({ schemaVersion: 1, callId, name: 'shell',
  arguments: { command } });

const ALLOWANCE_UNCONFIRMED = '暂时确认不了允许，稍后再试';

describe.each(['memory', 'sqlite'] as const)('B2-09 allowance crash before the command starts (%s)', kind => {
  it('B2-09a: a rejected consumeAllowance commit blocks the call, keeps allowed, then the retry runs', async () => {
    const w = await openB2BlockedWorld(kind, { files: {
      'app/package.json': JSON.stringify({ scripts: { 'db:migrate': 'prisma migrate deploy' } }),
      'package.json': JSON.stringify({ scripts: { 'db:migrate': 'prisma migrate deploy' } }),
    } });
    worlds.push(w);
    await runTool(w.tool, { command: 'npm run db:migrate', reason: '需要重新迁移' });
    const pending = (await w.listRequests(w.ctx))[0]!;
    expect(await w.answer('allow_rerun', pending.ref, pending.revision))
      .toMatchObject({ status: 'committed', value: { state: 'allowed', revision: 2 } });

    w.failNextCrrCommit();
    expect(await runHook(w.hook, shell('npm run db:migrate'))).toEqual({
      point: 'before_tool', kind: 'block', reason: ALLOWANCE_UNCONFIRMED });
    // The allowance is untouched (same revision, no usedAt/usedBy).
    expect((await w.listRequests(w.ctx))[0])
      .toMatchObject({ state: 'allowed', revision: 2, usedAt: null, usedBy: null });

    // Once the store accepts the write, the same allowance is still usable.
    expect(await runHook(w.hook, shell('npm run db:migrate')))
      .toEqual({ point: 'before_tool', kind: 'continue' });
    expect((await w.listRequests(w.ctx))[0]).toMatchObject({ state: 'used', revision: 3 });
  });

  it('B2-09b (owner part): the committed consume leaves the request used with usedBy, and the same command is blocked again', async () => {
    const w = await openB2BlockedWorld(kind, { files: {
      'app/package.json': JSON.stringify({ scripts: { 'db:migrate': 'prisma migrate deploy' } }),
      'package.json': JSON.stringify({ scripts: { 'db:migrate': 'prisma migrate deploy' } }),
    } });
    worlds.push(w);
    const command = 'npm run db:migrate';
    await runTool(w.tool, { command, reason: '需要重新迁移' });
    const pending = (await w.listRequests(w.ctx))[0]!;
    expect(await w.answer('allow_rerun', pending.ref, pending.revision))
      .toMatchObject({ status: 'committed', value: { state: 'allowed', revision: 2 } });

    const callId = 'b2-09b-used-call';
    expect(await runHook(w.hook, shell(command, callId)))
      .toEqual({ point: 'before_tool', kind: 'continue' });
    const used = (await w.listRequests(w.ctx))[0]!;
    expect(used).toMatchObject({ state: 'used', revision: 3, usedBy: { runId: w.runRef.runId, callId } });
    expect(used.usedAt).not.toBeNull();
    // No second request was written by the consume.
    expect(await w.listRequests(w.ctx)).toHaveLength(1);

    // The allowance is NOT returned: the same command is blocked again with
    // the fixed L19a text, and the request stays at its `used` revision.
    const blocked = await runHook(w.hook, shell(command));
    expect(blocked).toMatchObject({ point: 'before_tool', kind: 'block' });
    if (blocked.kind === 'block') expect(blocked.reason).toContain('request_command_rerun');
    expect((await w.listRequests(w.ctx))[0]).toMatchObject({ state: 'used', revision: 3 });
  });
});
