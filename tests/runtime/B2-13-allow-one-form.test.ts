/**
 * B2-13 (L19a K8-6): an allowance only lets the CARD's form through. After
 * `allow_rerun`, a different form whose parsed actions are the same is still
 * blocked; the matching `commandSha256` call runs once; the next one is blocked
 * again.
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

const shell = (command: string): ToolCall => ({ schemaVersion: 1, callId: nextCall(), name: 'shell',
  arguments: { command } });

async function allowedWorld(kind: 'memory' | 'sqlite'): Promise<B2BlockedWorld> {
  const w = await openB2BlockedWorld(kind, { files: {
    'app/package.json': JSON.stringify({ scripts: { 'db:migrate': 'prisma migrate deploy' } }),
    'package.json': JSON.stringify({ scripts: { 'db:migrate': 'prisma migrate deploy' } }),
  } });
  worlds.push(w);
  await runTool(w.tool, { command: 'npm run db:migrate', reason: '需要重新迁移' });
  const pending = (await w.listRequests(w.ctx))[0]!;
  expect(await w.answer('allow_rerun', pending.ref, pending.revision))
    .toMatchObject({ status: 'committed', value: { state: 'allowed' } });
  return w;
}

describe.each(['memory', 'sqlite'] as const)('B2-13 allowance is per card form (%s)', kind => {
  it('B2-13: another form with the same parsed actions is still blocked while the card form is allowed', async () => {
    const w = await allowedWorld(kind);
    // Same parsed action (`prisma migrate deploy`), different whole text.
    expect(await runHook(w.hook, shell('npx prisma migrate deploy')))
      .toMatchObject({ point: 'before_tool', kind: 'block' });
    // The allowance was not consumed by the blocked form.
    expect((await w.listRequests(w.ctx))[0]).toMatchObject({ state: 'allowed' });

    const exact = shell('npm run db:migrate');
    expect(await runHook(w.hook, exact)).toEqual({ point: 'before_tool', kind: 'continue' });
    expect((await w.listRequests(w.ctx))[0]).toMatchObject({ state: 'used',
      usedBy: { runId: w.runRef.runId, callId: exact.callId } });

    // The next identical form is blocked again.
    expect(await runHook(w.hook, shell('npm run db:migrate')))
      .toMatchObject({ point: 'before_tool', kind: 'block' });
  });
});
