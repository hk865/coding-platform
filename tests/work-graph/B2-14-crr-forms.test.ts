/**
 * B2-14 (spec §5.2, L19a CRR-01/CRR-07): the per-alias declared forms.
 *
 * A declared, unrecognised rewrite either starts a request, is appended to the
 * alias's pending/denied record, or is refused by the 8-form capacity. The
 * `allowed` (unused) row returns the allowance without any write or append.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import { commandSha256 } from '../../src/core/work-graph/state/command-normalization.js';
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

let seq = 0;

function requestDeclared(world: CrrWorld, command: string, ctx: CoreCallContext = world.workCtx) {
  return world.crr.requestRerun(ctx, {
    input: {
      task: world.task, runRef: world.run.ref, command, reason: 'declared rewrite',
      rewriteOf: { review: world.record.runRef.runId, alias: 1 },
    },
    meta: { requestId: `b2-14-declared-${String(++seq)}`, expected: [] },
  });
}

function requestAny(world: CrrWorld, command: string, ctx: CoreCallContext = world.workCtx) {
  return world.crr.requestRerun(ctx, {
    input: { task: world.task, runRef: world.run.ref, command, reason: 'recognised request' },
    meta: { requestId: `b2-14-any-${String(++seq)}`, expected: [] },
  });
}

/**
 * The answer goes through the ONE `resolveDecision` coordinator: the answer is
 * SAVED before the CRR adapter applies the saved reference.
 */
async function answer(world: CrrWorld, _requestRef: unknown,
  selection: 'allow_rerun' | 'deny' | 'deny_final') {
  const card = await crrCardOf(world.blocked.world);
  const resolved = await world.blocked.decisionActions.resolveDecision(world.hostCtx, {
    input: { source: card.source, selection: { kind: 'option', optionId: selection }, text: '', annotations: [] },
    meta: { requestId: `b2-14-answer-${selection}-${String(++seq)}`, expected: card.source.pins },
  });
  if (resolved.status !== 'ready' || resolved.value.action === null
    || resolved.value.action.status !== 'committed' || resolved.value.state !== 'applied') {
    throw new Error(`B2-14: the answer did not apply: ${JSON.stringify(resolved)}`);
  }
  return resolved.value.action;
}

describe.each(['memory', 'sqlite'] as const)('B2-14 declared rewrite forms (%s)', kind => {
  it('an unrecognised rewrite declared with rewriteOf starts a pending request with its form', async () => {
    const world = await openCrrWorld(kind);
    worlds.push(world);
    const command = 'npm run db:migrate -- --force';
    const result = await requestDeclared(world, command);
    expect(result).toMatchObject({ status: 'committed', value: { outcome: { status: 'requested' } } });
    if (result.status !== 'committed' || result.value.outcome.status !== 'requested') throw new Error('not requested');
    expect(result.value.request).toMatchObject({
      state: 'pending', declared: true, match: { kind: 'declared' },
      // sha256 of the normalized "npm run db:migrate -- --force" (no whitespace change).
      declaredForms: [{ sha256: '6d73b3a58ebe2300f8450e1d9d9b6416f361e230ba046c41aa734455f3d49da2', text: command }],
    });
    expect(world.counts.crrCommits).toBe(1);
  }, 120_000);

  it('a second declared rewrite appends to the SAME pending request (CRR-07, no second card)', async () => {
    const world = await openCrrWorld(kind);
    worlds.push(world);
    const first = await requestDeclared(world, 'npm run db:migrate -- --force');
    if (first.status !== 'committed' || first.value.outcome.status !== 'requested') throw new Error('not requested');
    const secondCommand = 'bash -c "npm run db:migrate --force"';
    const second = await requestDeclared(world, secondCommand);
    expect(second).toMatchObject({ status: 'committed', replayed: false, value: { outcome: { status: 'pending' },
      request: { ref: first.value.request.ref, revision: 2, state: 'pending' } } });
    if (second.status !== 'committed' || second.value.outcome.status !== 'pending') throw new Error('not committed');
    expect(second.value.request.declaredForms).toEqual([
      { sha256: commandSha256('npm run db:migrate -- --force'), text: 'npm run db:migrate -- --force' },
      { sha256: commandSha256(secondCommand), text: secondCommand },
    ]);
    expect(world.counts.crrCommits).toBe(2);
  }, 120_000);

  it('the 9th declared form is capacity and writes nothing', async () => {
    const world = await openCrrWorld(kind);
    worlds.push(world);
    const first = await requestDeclared(world, 'rewrite-1');
    if (first.status !== 'committed' || first.value.outcome.status !== 'requested') throw new Error('not requested');
    for (let index = 2; index <= 8; index += 1) {
      const appended = await requestDeclared(world, `rewrite-${String(index)}`);
      expect(appended).toMatchObject({ status: 'committed', value: { outcome: { status: 'pending' } } });
      if (appended.status !== 'committed' || appended.value.outcome.status !== 'pending') throw new Error('not pending');
      expect(appended.value.request.declaredForms).toHaveLength(index);
    }
    const before = world.counts.crrCommits;
    const ninth = await requestDeclared(world, 'rewrite-9');
    expect(ninth).toMatchObject({ status: 'rejected', code: 'capacity' });
    expect(world.counts.crrCommits).toBe(before);
    const stored = await world.crr.readRequest(world.hostCtx, { ref: first.value.request.ref });
    expect(stored).toMatchObject({ status: 'ready', value: { revision: 8, state: 'pending' } });
    if (stored.status === 'ready') expect(stored.value.declaredForms).toHaveLength(8);
  }, 120_000);

  it('an unused allowance is returned as allowed with no write and no form append', async () => {
    const world = await openCrrWorld(kind);
    worlds.push(world);
    const first = await requestAny(world, 'npm run db:migrate');
    if (first.status !== 'committed' || first.value.outcome.status !== 'requested') throw new Error('not requested');
    expect(await answer(world, first.value.request.ref, 'allow_rerun')).toMatchObject({
      status: 'committed', value: { state: 'allowed' } });
    const before = world.counts.crrCommits;
    const declared = await requestDeclared(world, 'npm run db:migrate -- --force');
    // Item 8: the unused-allowance branch writes nothing, so it is `not_written`.
    expect(declared).toMatchObject({ status: 'not_written',
      outcome: { status: 'allowed', requestId: first.value.request.ref.requestId } });
    expect(world.counts.crrCommits).toBe(before);
    const stored = await world.crr.readRequest(world.hostCtx, { ref: first.value.request.ref });
    expect(stored).toMatchObject({ status: 'ready', value: { revision: 2, state: 'allowed', declaredForms: [] } });
  }, 120_000);

  it('a declared rewrite against denied_final appends the form then refuses (no card)', async () => {
    const world = await openCrrWorld(kind);
    worlds.push(world);
    const first = await requestAny(world, 'npm run db:migrate');
    if (first.status !== 'committed' || first.value.outcome.status !== 'requested') throw new Error('not requested');
    expect(await answer(world, first.value.request.ref, 'deny_final')).toMatchObject({
      status: 'committed', value: { state: 'denied_final' } });
    const before = world.counts.crrCommits;
    const declared = await requestDeclared(world, 'npm run db:migrate -- --force');
    expect(declared).toMatchObject({ status: 'committed', value: { outcome: { status: 'refused', reason: 'denied_final' },
      request: { ref: first.value.request.ref, revision: 3, state: 'denied_final' } } });
    if (declared.status !== 'committed' || declared.value.outcome.status !== 'refused') throw new Error('no');
    expect(declared.value.request.declaredForms).toHaveLength(1);
    expect(world.counts.crrCommits).toBe(before + 1);
  }, 120_000);

  it('a declared rewrite against a same-Run deny appends then refuses denied_in_this_run', async () => {
    const world = await openCrrWorld(kind);
    worlds.push(world);
    const first = await requestAny(world, 'npm run db:migrate');
    if (first.status !== 'committed' || first.value.outcome.status !== 'requested') throw new Error('not requested');
    expect(await answer(world, first.value.request.ref, 'deny')).toMatchObject({
      status: 'committed', value: { state: 'denied' } });
    const declared = await requestDeclared(world, 'npm run db:migrate -- --force');
    expect(declared).toMatchObject({ status: 'committed', value: { outcome: { status: 'refused',
      reason: 'denied_in_this_run' }, request: { ref: first.value.request.ref, revision: 3 } } });
    if (declared.status !== 'committed' || declared.value.outcome.status !== 'refused') throw new Error('no');
    expect(declared.value.request.declaredForms).toHaveLength(1);
  }, 120_000);
});
