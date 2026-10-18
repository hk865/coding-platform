/**
 * B2-08 / ruling 4: ending the Task derives `closed` on read. A pending request
 * disappears from the card source (history), an unused allowance is void (no
 * read returns it as `allowed`), and the persisted record still has its old
 * state until the next owner operation touches it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setK3TaskDisposition, openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { blockedRecord, CRR_COMMAND, crrCardOf, crrSourceOf, requestRerunOf } from '../helpers/B2-crr-world.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { GOAL_B, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';

// §5.1's blocking `shell` stand-in, hoisted per test file: the record Run's
// real Kernel Turn holds its first call so RUN-20/RUN-22 read a real
// unresolved call. The stand-in is an injected dependency, never a fact.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

describe.each(['memory', 'sqlite'] as const)('B2-08: task end closes the request (%s)', kind => {
  it('B2-08: cancelling the Task closes a pending request, moves the card to history and voids an unused allowance', async () => {
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    const record = await blockedRecord(world, 'k3-20-a', 'b2-08-cancel',
      [{ callId: 'k3-08-cancel', command: CRR_COMMAND }]);
    const request = await requestRerunOf(world, record, 'b2-08-cancel-request');
    const card = await crrCardOf(world);
    const answered = await world.decisionActions.resolveDecision(world.fixture.ctx, {
      input: { source: card.source, selection: { kind: 'option', optionId: 'allow_rerun' },
        text: '', annotations: [] },
      meta: { requestId: 'b2-08-cancel-answer', expected: card.source.pins },
    });
    expect(answered).toMatchObject({ status: 'ready', value: { action: { status: 'committed',
      value: { state: 'allowed' } } } });

    await setK3TaskDisposition(world, 'k3-20-a', 'cancelled');

    // Every read treats the unused allowance as void/closed.
    const read = await world.commandRerun.readRequest(world.fixture.ctx, { ref: request.ref });
    expect(read).toMatchObject({ status: 'ready', value: { state: 'closed' } });
    const page = await world.commandRerunCardSource.readPage(world.fixture.ctx, {
      workspace: WORKSPACE_SCOPE, goalRef: GOAL_B, page: { limit: 100 } });
    expect(page).toMatchObject({ status: 'ready', value: { items: [] } });
    if (world.commandRerunCardSource.readByKey === undefined) throw new Error('no direct read');
    // The answered card's key is stale; the current revision reads `closed`.
    const direct = await world.commandRerunCardSource.readByKey(world.fixture.ctx, {
      workspace: WORKSPACE_SCOPE, source: card.source });
    expect(direct).toMatchObject({ status: 'ready', value: null });
    const current = await world.commandRerun.readRequest(world.fixture.ctx, { ref: request.ref });
    if (current.status !== 'ready') throw new Error(JSON.stringify(current));
    // The current card's source is its actual revision, read through the public
    // request read; the old key above is the same actual source at revision 1.
    const fresh = crrSourceOf(request, current.value.revision);
    expect(await world.commandRerunCardSource.readByKey(world.fixture.ctx, {
      workspace: WORKSPACE_SCOPE, source: fresh })).toMatchObject({
      status: 'ready', value: { state: 'closed', closedReason: 'source_resolved' } });
  }, 120_000);
});
