/**
 * B2-05 / B2-06 (L19a denial): `deny` refuses the same alias for the rest of
 * THAT Run (any form, no second card) while a new Run may ask again;
 * `deny_final` refuses the alias forever for this review record (any form, no
 * card). Requests are created through the real tool/owner, answers through the
 * real CRR owner `applyAnswer`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { nextCall, openB2BlockedWorld, runHook, runTool, type B2BlockedWorld } from '../helpers/B2-blocked-runtime.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
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

function laterRun(w: B2BlockedWorld, runId: string): { runRef: RunRef; ctx: CoreCallContext } {
  const runRef: RunRef = { aggregateType: 'Run', projectId: w.runRef.projectId,
    goalId: w.runRef.goalId, runId };
  const principal = w.ctx.principal;
  if (principal.kind !== 'work_run') throw new Error('the hook context is not a work_run');
  return { runRef, ctx: { ...w.ctx, principal: { ...principal, runRef } } };
}

async function ask(w: B2BlockedWorld, ctx: CoreCallContext, runRef: RunRef, command = 'npm run db:migrate') {
  return w.requests.requestRerun(ctx, {
    input: { task: w.record.task, runRef, command, reason: '再问一次' },
    meta: { requestId: `b2-05-request-${runRef.runId}`, expected: [] },
  });
}

describe.each(['memory', 'sqlite'] as const)('B2-05 deny is per Run (%s)', kind => {
  it('B2-05: same Run asks again -> denied_in_this_run, no card; a new Run may ask again', async () => {
    const w = await world(kind);
    await runTool(w.tool, { command: 'npm run db:migrate', reason: '需要重新迁移' });
    const pending = (await w.listRequests(w.ctx))[0]!;
    expect(await w.answer('deny', pending.ref, pending.revision))
      .toMatchObject({ status: 'committed', value: { state: 'denied' } });

    // Both forms stay blocked, no card.
    expect(await runHook(w.hook, shell('npm run db:migrate'))).toMatchObject({ kind: 'block' });
    expect(await runHook(w.hook, shell('npx prisma migrate deploy'))).toMatchObject({ kind: 'block' });
    const before = (await w.listRequests(w.ctx)).length;
    const sameRun = await runTool(w.tool, { command: 'npx prisma migrate deploy', reason: '换一种写法' });
    expect(sameRun.output[0]).toMatchObject({ kind: 'json', value: { status: 'refused', reason: 'denied_in_this_run' } });
    expect((await w.listRequests(w.ctx)).length).toBe(before);

    // A Run of the same Task in a later round may ask again.
    const later = laterRun(w, 'b2-05-later-run');
    const asked = await ask(w, later.ctx, later.runRef);
    expect(asked).toMatchObject({ status: 'committed', value: { outcome: { status: 'requested' } } });
    expect((await w.listRequests(w.ctx)).length).toBe(before + 1);
  });

  it('B2-06: deny_final refuses every later form and Run, no card', async () => {
    const w = await world(kind);
    await runTool(w.tool, { command: 'npm run db:migrate', reason: '需要重新迁移' });
    const pending = (await w.listRequests(w.ctx))[0]!;
    expect(await w.answer('deny_final', pending.ref, pending.revision))
      .toMatchObject({ status: 'committed', value: { state: 'denied_final' } });

    expect(await runHook(w.hook, shell('npm run db:migrate'))).toMatchObject({ kind: 'block' });
    expect(await runHook(w.hook, shell('npx prisma migrate deploy'))).toMatchObject({ kind: 'block' });
    const before = (await w.listRequests(w.ctx)).length;
    const sameRun = await runTool(w.tool, { command: 'npx prisma migrate deploy', reason: '换一种写法' });
    expect(sameRun.output[0]).toMatchObject({ kind: 'json', value: { status: 'refused', reason: 'denied_final' } });
    expect((await w.listRequests(w.ctx)).length).toBe(before);

    const later = laterRun(w, 'b2-06-later-run');
    expect(await ask(w, later.ctx, later.runRef))
      .toMatchObject({ status: 'not_written', outcome: { status: 'refused', reason: 'denied_final' } });
    expect((await w.listRequests(w.ctx)).length).toBe(before);
  });
});
