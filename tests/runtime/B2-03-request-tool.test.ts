/**
 * B2-03 / B2-14 / B2-18 at the public tool seam: the real
 * `request_command_rerun` tool over the real CRR owner/read port, real records
 * and the shared recognizer. The tool adapter adds no validation or
 * recognition of its own.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { createCommandRerunTools } from '../../src/core/agent-runtime/command-rerun-tools.js';
import { openB2BlockedWorld, runTool, type B2BlockedWorld } from '../helpers/B2-blocked-runtime.js';


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
const open = async (kind: 'memory' | 'sqlite'): Promise<B2BlockedWorld> => {
  const w = await openB2BlockedWorld(kind, { files: {
    'app/package.json': JSON.stringify({ scripts: { 'db:migrate': 'prisma migrate deploy' } }),
  } });
  worlds.push(w);
  return w;
};

/**
 * Item 3: the waiting form comes from the owner. The tool runs over the REAL
 * request owner, whose point read is replaced by one that throws, so a tool
 * that still reads the waiting request fails instead of printing the text.
 */
function toolWithoutPointRead(w: B2BlockedWorld): B2BlockedWorld['tool'] {
  const requests = {
    requestRerun: w.requests.requestRerun.bind(w.requests),
    applyAnswer: w.requests.applyAnswer.bind(w.requests),
    consumeAllowance: w.requests.consumeAllowance.bind(w.requests),
    async readRequest(): Promise<never> {
      throw new Error('request_command_rerun must not point-read the waiting request');
    },
  };
  return createCommandRerunTools({ requests, context: w.ctx, task: w.record.task,
    requestIdForCall: call => `b2-tool-no-point-read:${call.callId}` }).create({} as never)[0]!;
}

function textOf(result: Awaited<ReturnType<typeof runTool>>): string {
  const part = result.output.find(candidate => candidate.kind === 'text');
  if (part === undefined || part.kind !== 'text') throw new Error('the tool returned no text output');
  return part.text;
}

describe.each(['memory', 'sqlite'] as const)('B2-03 request tool (%s)', kind => {
  it('B2-03: a blocked command becomes requested and writes one CRR', async () => {
    const w = await open(kind);
    const result = await runTool(w.tool, { command: 'npm run db:migrate', reason: '需要重新迁移' });
    expect(result).toMatchObject({ status: 'success' });
    expect(result.output[0]).toMatchObject({ kind: 'json', value: { status: 'requested' } });
    expect(result.output[1]).toMatchObject({ kind: 'text', text:
      '已请求，等人答复。这一轮不能跑这条命令；可以先做别的，或者结束这一轮并写明在等允许。' });
    const requests = await w.listRequests(w.ctx);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ state: 'pending', command: 'npm run db:migrate' });
    // B2-18: exactly one task-review page (R = 1) and one CRR write.
    expect(w.taskReviewCalls).toHaveLength(1);
  });

  it('B2-03: a second request for the same alias returns pending, no second card/write', async () => {
    const w = await open(kind);
    await runTool(w.tool, { command: 'npm run db:migrate', reason: '再问一次' });
    const second = await runTool(w.tool, { command: 'npx prisma migrate deploy', reason: '换一种写法' });
    expect(second.output[0]).toMatchObject({ kind: 'json', value: { status: 'pending' } });
    expect(second.output[1]).toMatchObject({ kind: 'text', text: expect.stringContaining('npm run db:migrate') });
    expect(await w.listRequests(w.ctx)).toHaveLength(1);
  });

  it('B2-03: pending and allowed name the WAITING form A, never input B, with no point read', async () => {
    const w = await open(kind);
    const tool = toolWithoutPointRead(w);
    const first = await runTool(tool, { command: 'npm run db:migrate', reason: '重跑' });
    expect(first.output[0]).toMatchObject({ kind: 'json', value: { status: 'requested' } });

    // B differs from A but is still recognised as the same alias (the stored
    // expansion of `prisma migrate deploy`); the fixed text must name A.
    const pending = await runTool(tool, { command: 'npx prisma migrate deploy', reason: '换一种写法' });
    expect(pending.output[0]).toMatchObject({ kind: 'json', value: { status: 'pending' } });
    expect(textOf(pending)).toContain('npm run db:migrate');
    expect(textOf(pending)).not.toContain('npx prisma migrate deploy');

    const [request] = await w.listRequests(w.ctx);
    if (request === undefined) throw new Error('the pending request is missing');
    await w.answer('allow_rerun', request.ref, request.revision);

    const allowed = await runTool(tool, { command: 'npx prisma migrate deploy', reason: '再换一种写法' });
    expect(allowed.output[0]).toMatchObject({ kind: 'json', value: { status: 'allowed' } });
    expect(textOf(allowed)).toContain('npm run db:migrate');
    expect(textOf(allowed)).not.toContain('npx prisma migrate deploy');
  });

  it('B2-03: a command the platform does not recognise is not_blocked with no write', async () => {
    const w = await open(kind);
    const before = (await w.listRequests(w.ctx)).length;
    const result = await runTool(w.tool, { command: 'git status', reason: '看一眼' });
    expect(result.output[0]).toMatchObject({ kind: 'json', value: { status: 'not_blocked' } });
    expect(result.output[1]).toMatchObject({ kind: 'text', text:
      '平台没认出它和被拦的命令相同。如果它其实是被拦命令的改写，用 `rewriteOf` 注明再请求；否则可以直接跑。' });
    expect(await w.listRequests(w.ctx)).toHaveLength(before);
  });
});

describe.each(['memory', 'sqlite'] as const)('B2-14 declared forms (%s)', kind => {
  it('B2-14: a declared unrecognised rewrite is appended to the pending request, no second card', async () => {
    const w = await open(kind);
    const first = await runTool(w.tool, { command: 'npm run db:migrate', reason: '重跑' });
    expect(first.output[0]).toMatchObject({ kind: 'json', value: { status: 'requested' } });
    const declared = await runTool(w.tool, {
      command: 'npm run db:migrate -- --force', reason: '带参数重跑',
      rewriteOf: { review: w.record.ref.runId, alias: 1 },
    });
    expect(declared.output[0]).toMatchObject({ kind: 'json', value: { status: 'pending' } });
    const requests = await w.listRequests(w.ctx);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.declaredForms).toHaveLength(1);
    expect(requests[0]!.declaredForms[0]!.text).toBe('npm run db:migrate -- --force');
  });
});
