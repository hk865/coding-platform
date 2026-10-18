/**
 * B2-09 / L19a: the same `decisions/answer` answered twice replays ① and ② and
 * records ③ once: the request moves pending -> allowed once, the second call
 * returns the SAME commit cursor, and no second `CommandRerunRequestChanged`
 * write appears.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { blockedRecord, CRR_COMMAND, crrCardOf, requestRerunOf } from '../helpers/B2-crr-world.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';

// §5.1's blocking `shell` stand-in, hoisted per test file: the record Run's
// real Kernel Turn holds the first call so RUN-20/RUN-22 see a real unresolved
// call. The stand-in is an injected dependency, not a fact.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

describe.each(['memory', 'sqlite'] as const)('B2-09: repeated decisions/answer (%s)', kind => {
  it('B2-09: the same answer replayed applies the request once and records the application once', async () => {
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    const record = await blockedRecord(world, 'k3-20-a', 'b2-09',
      [{ callId: 'k3-09-call', command: CRR_COMMAND }]);
    const request = await requestRerunOf(world, record, 'b2-09-request');
    const card = await crrCardOf(world);
    const ask = (requestId: string) => world.decisionActions.resolveDecision(world.fixture.ctx, {
      input: { source: card.source, selection: { kind: 'option', optionId: 'allow_rerun' },
        text: '', annotations: [] },
      meta: { requestId, expected: card.source.pins },
    });
    const first = await ask('b2-09-answer');
    expect(first).toMatchObject({ status: 'ready', value: { state: 'applied',
      action: { status: 'committed', value: { state: 'allowed', revision: request.revision + 1 } },
      application: { status: 'committed' } } });
    const second = await ask('b2-09-answer');
    expect(second).toMatchObject({ status: 'ready', value: { state: 'applied',
      action: { status: 'committed', replayed: true, value: { state: 'allowed' } },
      application: { status: 'committed' } } });
    if (first.status !== 'ready' || second.status !== 'ready') return;
    expect(second.value.action!.status === 'committed' && first.value.action!.status === 'committed').toBe(true);
    if (first.value.action?.status !== 'committed' || second.value.action?.status !== 'committed') return;
    const firstAction = first.value.action as unknown as { cursor: unknown; value: { revision: number } };
    const secondAction = second.value.action as unknown as { cursor: unknown; value: { revision: number } };
    expect(secondAction.cursor).toEqual(firstAction.cursor);
    expect(secondAction.value.revision).toBe(request.revision + 1);
    expect(await world.commandRerun.readRequest(world.fixture.ctx, { ref: request.ref })).toMatchObject({
      status: 'ready', value: { state: 'allowed', revision: request.revision + 1 } });
  }, 120_000);
});
