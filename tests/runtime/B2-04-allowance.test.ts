/**
 * B2-04 (L19a "允许 → 一次性允许"): a real CRR request through the request tool,
 * answered `allow_rerun` through the real CRR owner, lets the SAME
 * `commandSha256` shell call run exactly once. The `used` event carries
 * `usedBy { runId, callId }`; the next identical call is blocked again, and a
 * different form with the same parsed actions is still blocked.
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
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

async function world(kind: 'memory' | 'sqlite'): Promise<B2BlockedWorld> {
  const opened = await openB2BlockedWorld(kind, { files: {
    'app/package.json': JSON.stringify({ scripts: { 'db:migrate': 'prisma migrate deploy' } }),
    'package.json': JSON.stringify({ scripts: { 'db:migrate': 'prisma migrate deploy' } }),
  } });
  worlds.push(opened);
  return opened;
}
const shell = (command: string): ToolCall => ({ schemaVersion: 1, callId: nextCall(), name: 'shell',
  arguments: { command } });

describe.each(['memory', 'sqlite'] as const)('B2-04 one-time allowance (%s)', kind => {
  it('B2-04/B2-09b (owner part): allow_rerun lets exactly the card form run once, records usedBy, then blocks again', async () => {
    const w = await world(kind);
    const requested = await runTool(w.tool, { command: 'npm run db:migrate', reason: '需要重新迁移' });
    expect(requested.output[0]).toMatchObject({ kind: 'json', value: { status: 'requested' } });
    const pending = (await w.listRequests(w.ctx))[0]!;
    expect(pending).toMatchObject({ state: 'pending', command: 'npm run db:migrate' });

    const allowed = await w.answer('allow_rerun', pending.ref, pending.revision);
    expect(allowed).toMatchObject({ status: 'committed', value: { state: 'allowed', revision: 2 } });

    // The one allowed form is consumed before it is let through.
    const call = shell('npm run db:migrate');
    expect(await runHook(w.hook, call)).toEqual({ point: 'before_tool', kind: 'continue' });
    const used = (await w.listRequests(w.ctx))[0]!;
    expect(used).toMatchObject({ state: 'used', revision: 3,
      usedBy: { runId: w.runRef.runId, callId: call.callId } });

    // The consume stamped the request used (usedAt is present) and wrote no
    // second request row.
    expect(used.usedAt).not.toBeNull();
    expect(await w.listRequests(w.ctx)).toHaveLength(1);

    // The `used` event itself carries `usedBy` (no hand-encoded event).
    const usedEvent = w.crrEvents.find(event => event['change'] === 'used');
    expect(usedEvent).toMatchObject({ change: 'used',
      request: { state: 'used', usedBy: { runId: w.runRef.runId, callId: call.callId } } });

    // The NEXT identical call is blocked again (the allowance is gone), with
    // the fixed L19a reason, and the request stays at its `used` revision.
    const again = await runHook(w.hook, shell('npm run db:migrate'));
    expect(again).toMatchObject({ point: 'before_tool', kind: 'block' });
    if (again.kind === 'block') expect(again.reason).toContain('request_command_rerun');
    expect((await w.listRequests(w.ctx))[0]).toMatchObject({ state: 'used', revision: 3 });

    // A different form whose parsed actions are the same is still blocked.
    expect(await runHook(w.hook, shell('npx prisma migrate deploy')))
      .toMatchObject({ point: 'before_tool', kind: 'block' });
  });
});
