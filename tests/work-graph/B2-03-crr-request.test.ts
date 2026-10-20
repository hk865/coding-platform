/**
 * B2-03 (spec §5.2, L19a): `request_command_rerun`'s owner through the public
 * owner port. A real `skip_as_done` writes `blockedCommands`; the request tool
 * uses the real recognizer (exact/action/expansion) and the alias index.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { crrCardOf } from '../helpers/B2-crr-world.js';
import { openCrrWorld, type CrrWorld } from '../helpers/K3-crr-fixture.js';


// §5.1's stand-in `shell`, hoisted per test file (the fixture's real Run uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: CrrWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

let requestSeq = 0;

function request(world: CrrWorld, ctx: CoreCallContext, input: {
  task?: CrrWorld['task'];
  runRef?: CrrWorld['run']['ref'];
  command: string;
  reason?: string;
  rewriteOf?: { review: string; alias: number };
}) {
  return world.crr.requestRerun(ctx, {
    input: {
      task: input.task ?? world.task,
      runRef: input.runRef ?? world.run.ref,
      command: input.command,
      reason: input.reason ?? 'please let me run this',
      ...(input.rewriteOf === undefined ? {} : { rewriteOf: input.rewriteOf }),
    },
    meta: { requestId: `b2-03-request-${String(++requestSeq)}`, expected: [] },
  });
}

async function listAll(world: CrrWorld): Promise<unknown[]> {
  const page = await world.crr.listRequests(world.hostCtx, {
    workspace: { projectId: 'P', workspaceId: 'W' },
    filter: { goalId: world.task.goalId, taskId: world.task.taskId },
    page: { limit: 200 },
  });
  if (page.status !== 'ready') throw new Error(`the request list failed: ${JSON.stringify(page)}`);
  return page.value.items;
}

/**
 * The answer goes through the ONE `resolveDecision` coordinator: it SAVES the
 * answer (the service behind `decisions/answer`) before the CRR adapter
 * applies the saved answer; no hand-built answer reference is used.
 */
async function answer(world: CrrWorld, _requestRef: unknown,
  selection: 'allow_rerun' | 'deny' | 'deny_final') {
  const card = await crrCardOf(world.blocked.world);
  const resolved = await world.blocked.decisionActions.resolveDecision(world.hostCtx, {
    input: { source: card.source, selection: { kind: 'option', optionId: selection }, text: '', annotations: [] },
    meta: { requestId: `b2-03-answer-${selection}`, expected: card.source.pins },
  });
  if (resolved.status !== 'ready' || resolved.value.action === null
    || resolved.value.action.status !== 'committed' || resolved.value.state !== 'applied') {
    throw new Error(`B2-03: the answer did not apply: ${JSON.stringify(resolved)}`);
  }
  return resolved.value.action;
}

describe.each(['memory', 'sqlite'] as const)('B2-03 request_command_rerun owner (%s)', kind => {
  it('a blocked command creates one pending request with the stored match', async () => {
    const world = await openCrrWorld(kind);
    worlds.push(world);
    const before = world.counts.crrCommits;
    const result = await request(world, world.workCtx, { command: 'npm run db:migrate' });
    // Item 8: CRR-01 writes return the request plus its outcome.
    expect(result).toMatchObject({ status: 'committed', replayed: false, value: { outcome: { status: 'requested' } } });
    if (result.status !== 'committed' || result.value.outcome.status !== 'requested') throw new Error('not requested');
    expect(result.value.request).toMatchObject({
      schemaVersion: 1, revision: 1, state: 'pending', alias: 1, declared: false,
      // sha256 of the normalized "npm run db:migrate" (normalization is a no-op here).
      command: 'npm run db:migrate', commandSha256: 'b52f4e880f9bf2939458601307d64ba7447e6204717884ded304133a8409e74f',
      match: { kind: 'exact' }, declaredForms: [], answerMessageRef: null,
      allowedAt: null, usedAt: null, usedBy: null,
    });
    expect(result.value.request.reviewRef).toEqual(world.record.ref);
    expect(result.value.request.runRef).toEqual(world.run.ref);
    expect(world.counts.crrCommits).toBe(before + 1);
    expect(await listAll(world)).toHaveLength(1);
  }, 120_000);

  it('the same alias while pending returns the SAME request, never a second card', async () => {
    const world = await openCrrWorld(kind);
    worlds.push(world);
    const first = await request(world, world.workCtx, { command: 'npm run db:migrate' });
    if (first.status !== 'committed' || first.value.outcome.status !== 'requested') throw new Error('not requested');
    const before = world.counts.crrCommits;
    // A different wording of the same action is recognised through the stored expansion.
    const second = await request(world, world.workCtx, { command: 'prisma migrate deploy' });
    expect(second).toMatchObject({ status: 'not_written',
      outcome: { status: 'pending', requestId: first.value.request.ref.requestId } });
    expect(world.counts.crrCommits).toBe(before);
    expect(await listAll(world)).toHaveLength(1);
  }, 120_000);

  it('a command the recognizer does not match returns not_blocked and writes nothing', async () => {
    const world = await openCrrWorld(kind);
    worlds.push(world);
    const before = world.counts.crrCommits;
    const result = await request(world, world.workCtx, { command: 'git status' });
    expect(result).toMatchObject({ status: 'not_written', outcome: { status: 'not_blocked' } });
    expect(world.counts.crrCommits).toBe(before);
    expect(await listAll(world)).toHaveLength(0);
  }, 120_000);

  it('deny in this Run refuses a second request for the alias; another Run may ask again', async () => {
    const world = await openCrrWorld(kind);
    worlds.push(world);
    const first = await request(world, world.workCtx, { command: 'npm run db:migrate' });
    if (first.status !== 'committed' || first.value.outcome.status !== 'requested') throw new Error('not requested');
    expect(await answer(world, first.value.request.ref, 'deny')).toMatchObject({
      status: 'committed', value: { state: 'denied' } });
    const before = world.counts.crrCommits;
    const again = await request(world, world.workCtx, { command: 'prisma migrate deploy' });
    expect(again).toMatchObject({ status: 'not_written',
      outcome: { status: 'refused', reason: 'denied_in_this_run' } });
    expect(world.counts.crrCommits).toBe(before);

    const continuation = await world.createContinuationRun();
    const nextRound = await request(world, continuation.ctx, {
      runRef: continuation.runRef, command: 'npm run db:migrate', reason: 'next round',
    });
    expect(nextRound).toMatchObject({ status: 'committed', value: { outcome: { status: 'requested' } } });
    if (nextRound.status !== 'committed' || nextRound.value.outcome.status !== 'requested') throw new Error('no');
    expect(nextRound.value.request.ref.requestId).not.toBe(first.value.request.ref.requestId);
    expect(nextRound.value.request.runRef).toEqual(continuation.runRef);
  }, 120_000);

  it('deny_final refuses every later request of the alias and writes no card', async () => {
    const world = await openCrrWorld(kind);
    worlds.push(world);
    const first = await request(world, world.workCtx, { command: 'npm run db:migrate' });
    if (first.status !== 'committed' || first.value.outcome.status !== 'requested') throw new Error('not requested');
    expect(await answer(world, first.value.request.ref, 'deny_final')).toMatchObject({
      status: 'committed', value: { state: 'denied_final' } });
    const before = world.counts.crrCommits;
    const later = await request(world, world.workCtx, { command: 'prisma migrate deploy' });
    expect(later).toMatchObject({ status: 'not_written',
      outcome: { status: 'refused', reason: 'denied_final' } });
    expect(world.counts.crrCommits).toBe(before);
  }, 120_000);

  it('rewriteOf must name this task and a blocked alias, otherwise invalid', async () => {
    const world = await openCrrWorld(kind);
    worlds.push(world);
    const before = world.counts.crrCommits;
    const other = await world.blocked.createNeedsDecision('k3-20-b', {
      'other-c1': { command: 'npm run db:migrate' },
    });
    const foreign = await request(world, world.workCtx, {
      command: 'sh ./migrate.sh', rewriteOf: { review: other.runRef.runId, alias: 1 },
    });
    expect(foreign).toMatchObject({ status: 'rejected', code: 'invalid' });
    if (foreign.status === 'rejected') {
      expect(foreign.reason).toContain(world.record.runRef.runId);
      expect(foreign.reason).not.toContain(other.runRef.runId);
    }
    const notBlocked = await request(world, world.workCtx, {
      command: 'sh ./migrate.sh', rewriteOf: { review: world.record.runRef.runId, alias: 2 },
    });
    expect(notBlocked).toMatchObject({ status: 'rejected', code: 'invalid' });
    const noRecord = await request(world, world.workCtx, {
      command: 'sh ./migrate.sh', rewriteOf: { review: 'deadbeef', alias: 1 },
    });
    expect(noRecord).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(world.counts.crrCommits).toBe(before);
  }, 120_000);

  // UNSPECIFIED: a record with two `process` items needs two concurrently
  // in-flight process calls; the Kernel dispatches process calls serially
  // (RegistryToolBatchPolicy), so that record is not reachable. Reported.
});
