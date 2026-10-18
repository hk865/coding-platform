/**
 * K3 row K3-16 (L14/L20, UCR-05, §2 `propose_safer_method`): the owner's
 * `recordProposal` write, its identity/replay/guards and the 5,120-byte
 * approved-method budget.
 *
 * The record is reached through public steps only (no fact injection): the ONE
 * real blocked record (`createK3PendingReview`: real claim/prepare/Runtime
 * start with §5.1's shell stand-in, the production RUN-20/RUN-22 read of that
 * Kernel Turn and the Runtime's own end), the public
 * `settleK3Review{review_unavailable}` -> `needs_decision`, the real
 * `answerK3Disposition(..., 'safer_method')` -> `awaiting_proposal`, and the
 * real proposal claim `claimK3ReviewRound(..., {phase: 'proposal'})`, which is
 * the owner-level row with the `work_run` context. The record has exactly the
 * one process item the Kernel produced, so it has one proposal target.
 *
 * Every expected byte target is hand-computed from the literal L20 line format,
 * never by calling the renderer. The multi-alias ordering extreme lives in the
 * pure renderer test (`tests/runtime/K3-16-review-extremes-pure.test.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { UnknownCallReviewRef } from '../../src/contracts/unknown-call-review.js';
import {
  unknownCallReviewChangedEventFromEvent,
} from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import {
  answerK3Disposition, claimK3ReviewRound, createK3PendingReview, openK3ReviewCardWorld,
  readK3Review, settleK3Review,
  type K3ReviewCardWorld, type K3Round,
} from '../helpers/K3-proposal-round.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';

// §5.1's stand-in `shell`, hoisted per test file (the real Run's one call uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

const bytesOf = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;
const utf8BytesOf = (text: string): number => new TextEncoder().encode(text).length;

type Setup = { world: K3ReviewCardWorld; round: K3Round; ref: UnknownCallReviewRef };

/** Reach the owner-level `awaiting_proposal` row over public steps in a fresh world of `kind`. */
async function setup(kind: 'memory' | 'sqlite'): Promise<Setup> {
  const world = await openK3ReviewCardWorld(kind);
  worlds.push(world);
  const created = await createK3PendingReview(world, {
    label: 'k3-16-write', callId: 'k3-16-call-1', command: 'echo 1',
  });
  expect(created).toMatchObject({ status: 'pending_review', inventory: 'complete' });
  expect(created.items).toHaveLength(1);
  // UCR-08c: the public settlement is the real needs_decision card.
  const decision = await settleK3Review(world, created, { cause: 'review_unavailable' });
  expect(decision.status).toBe('needs_decision');
  // The person's safer-method answer through the real card action.
  const proposed = await answerK3Disposition(world, decision, 'safer_method');
  expect(proposed.status).toBe('awaiting_proposal');
  // UCR-03: the proposal round is a real claimed Run (the work_run context).
  const round = await claimK3ReviewRound(world, proposed, { phase: 'proposal' });
  expect(round.record).toMatchObject({ status: 'awaiting_proposal', activeRound: { phase: 'proposal' } });
  return { world, round, ref: proposed.ref };
}

function proposalRequest(
  reviewRef: UnknownCallReviewRef, requestId: string, item: number,
  command: string, cwd: string | null, rationale: string,
) {
  return {
    input: { reviewRef, item, command, cwd, rationale },
    meta: { requestId, expected: [] },
  };
}

describe('K3-16 owner proposal write', () => {
  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: one proposal_recorded write, its receipt replay and the changed-argument conflict',
    async kind => {
    const fx = await setup(kind);
    const before = await readK3Review(fx.world, fx.round.record.ref);
    expect(before).toMatchObject({ status: 'awaiting_proposal', activeRound: { phase: 'proposal' }, revision: 4 });
    // The one target is the real Kernel callId the record carries.
    expect(before.proposalTargets).toEqual([before.items[0]!.callId]);

    const request = proposalRequest(fx.ref, 'k3-16-proposal-1', 1,
      'npm test -- --run', '/workspace', 'the old command raced the test run');
    const written = await fx.world.reviews.recordProposal(fx.round.context, request as never);
    expect(written).toMatchObject({ status: 'committed', replayed: false });
    if (written.status !== 'committed') throw new Error(JSON.stringify(written));
    const after = written.value;
    expect(after.revision).toBe(before.revision + 1);
    expect(after.proposals).toHaveLength(1);
    expect(after.proposals[0]).toMatchObject({
      alias: 1, callId: before.items[0]!.callId, command: 'npm test -- --run', cwd: '/workspace',
      rationale: 'the old command raced the test run', roundRunRef: fx.round.claim.runRef,
    });
    // L14: the proposal id is the write identity of THIS tool call.
    expect(after.proposals[0]!.proposalId).toMatch(/^ucr-proposal:[0-9a-f]{64}$/);

    // The event is the ONE `proposal_recorded` write of the commit.
    const at = await fx.world.records.eventAt(written.cursor);
    if (at.status !== 'ready') throw new Error('the receipt event must be readable');
    const decodedEvent = unknownCallReviewChangedEventFromEvent(at.value.event);
    if (decodedEvent.status !== 'decoded') throw new Error(decodedEvent.reason);
    expect(decodedEvent.value.change).toBe('proposal_recorded');
    expect(decodedEvent.value.review.proposals).toEqual(after.proposals);

    // The same request replays the original receipt before reading the record.
    const replayed = await fx.world.reviews.recordProposal(fx.round.context, request as never);
    expect(replayed).toMatchObject({ status: 'committed', replayed: true, cursor: written.cursor });
    if (replayed.status !== 'committed') throw new Error(JSON.stringify(replayed));
    expect(replayed.value.revision).toBe(after.revision);
    const afterReplay = await readK3Review(fx.world, fx.round.record.ref);
    expect(bytesOf(afterReplay)).toBe(bytesOf(after));

    // Same identity, different content -> the store's idempotency conflict.
    const conflict = await fx.world.reviews.recordProposal(fx.round.context,
      proposalRequest(fx.ref, 'k3-16-proposal-1', 1, 'npm run build', '/workspace',
        'the old command raced the test run') as never);
    expect(conflict).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: a later call for the same item replaces the old proposal and gets a new id',
    async kind => {
    const fx = await setup(kind);
    const first = await fx.world.reviews.recordProposal(fx.round.context,
      proposalRequest(fx.ref, 'k3-16-replace-1', 1, 'npm test', null, 'first') as never);
    expect(first).toMatchObject({ status: 'committed' });
    if (first.status !== 'committed') throw new Error(JSON.stringify(first));
    const firstId = first.value.proposals[0]!.proposalId;

    const second = await fx.world.reviews.recordProposal(fx.round.context,
      proposalRequest(fx.ref, 'k3-16-replace-2', 1, 'npm test -- --run', '/w', 'second') as never);
    expect(second).toMatchObject({ status: 'committed' });
    if (second.status !== 'committed') throw new Error(JSON.stringify(second));
    expect(second.value.proposals).toHaveLength(1);
    expect(second.value.proposals[0]).toMatchObject({
      alias: 1, command: 'npm test -- --run', cwd: '/w', rationale: 'second',
    });
    expect(second.value.proposals[0]!.proposalId).not.toBe(firstId);
  });

  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: an item outside proposalTargets is invalid and writes nothing',
    async kind => {
    const fx = await setup(kind);
    const before = await readK3Review(fx.world, fx.round.record.ref);
    // The record has exactly one target (#1); #2 is outside the unit.
    const rejectedItem = await fx.world.reviews.recordProposal(fx.round.context,
      proposalRequest(fx.ref, 'k3-16-outside', 2, 'echo nope', null, 'not a process target') as never);
    expect(rejectedItem).toMatchObject({ status: 'rejected', code: 'invalid' });
    const after = await readK3Review(fx.world, fx.round.record.ref);
    expect(bytesOf(after)).toBe(bytesOf(before));
  });

  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: rejects the out-of-unit proposal fields as invalid',
    async kind => {
    const fx = await setup(kind);
    const cases: Array<{ name: string; command: string; cwd: string | null; rationale: string }> = [
      { name: 'command 4001 bytes', command: 'c'.repeat(4_001), cwd: null, rationale: 'r' },
      { name: 'empty command', command: '', cwd: null, rationale: 'r' },
      { name: 'cwd 513 bytes', command: 'echo ok', cwd: 'd'.repeat(513), rationale: 'r' },
      { name: 'empty cwd', command: 'echo ok', cwd: '', rationale: 'r' },
      { name: 'empty rationale', command: 'echo ok', cwd: null, rationale: '' },
      { name: 'rationale 2001 UTF-16 units', command: 'echo ok', cwd: null, rationale: '理'.repeat(2_001) },
    ];
    for (const [index, entry] of cases.entries()) {
      const before = await readK3Review(fx.world, fx.round.record.ref);
      const rejected = await fx.world.reviews.recordProposal(fx.round.context,
        proposalRequest(fx.ref, `k3-16-invalid-${String(index)}`, 1,
          entry.command, entry.cwd, entry.rationale) as never);
      expect({ name: entry.name, result: rejected }).toMatchObject({ name: entry.name,
        result: { status: 'rejected', code: 'invalid' } });
      expect(bytesOf(await readK3Review(fx.world, fx.round.record.ref))).toBe(bytesOf(before));
    }
  });

  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: accepts exactly 4,000 command bytes, a 512-byte cwd and a 2,000-character rationale',
    async kind => {
    const fx = await setup(kind);
    const written = await fx.world.reviews.recordProposal(fx.round.context,
      proposalRequest(fx.ref, 'k3-16-boundary', 1,
        'c'.repeat(4_000), 'd'.repeat(512), '理'.repeat(2_000)) as never);
    expect(written).toMatchObject({ status: 'committed' });
    if (written.status !== 'committed') throw new Error(JSON.stringify(written));
    expect(written.value.proposals[0]).toMatchObject({
      command: 'c'.repeat(4_000), cwd: 'd'.repeat(512), rationale: '理'.repeat(2_000),
    });
  });
});

/** The literal L20 line format: `- 方案 #<alias>，目录 <cwd ?? '.'>：\n  <command>`, with every embedded newline written as `\n` plus the two-space indent. */
function methodLine(alias: number, command: string, cwd = '.'): string {
  return `- 方案 #${String(alias)}，目录 ${cwd}：\n  ${command.replace(/\r\n|\n/g, '\n  ')}`;
}

/** A command of exactly `bytes` UTF-8 bytes carrying `newlines` embedded `\n`s. */
function commandOf(bytes: number, newlines: number): string {
  return `${'x'.repeat(bytes - newlines)}${'\n'.repeat(newlines)}`;
}

describe('K3-16 approved-method budget (L20: 5,120 UTF-8 bytes, one real item)', () => {
  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: one rendered command line is 28 bytes + command + 2 per newline; 5,121 is capacity and 5,120 is accepted',
    async kind => {
    // Hand-computed from the literal line format, never from the renderer: the
    // fixed prefix `- 方案 #1，目录 .：\n  ` is 28 UTF-8 bytes, and every embedded
    // newline renders as `\n` plus the two-space indent (+2 bytes).
    const exact = commandOf(4_000, 546);
    const over = commandOf(3_999, 547);
    expect(utf8BytesOf(exact)).toBe(4_000);
    expect(exact.split('\n')).toHaveLength(547);
    expect(utf8BytesOf(over)).toBe(3_999);
    expect(over.split('\n')).toHaveLength(548);
    expect(28 + utf8BytesOf(exact) + 2 * 546).toBe(5_120);
    expect(28 + utf8BytesOf(over) + 2 * 547).toBe(5_121);
    expect(utf8BytesOf(methodLine(1, exact))).toBe(5_120);
    expect(utf8BytesOf(methodLine(1, over))).toBe(5_121);

    // 5,121: refused by the real owner, with a byte-identical record.
    const overFixture = await setup(kind);
    const overBefore = await readK3Review(overFixture.world, overFixture.round.record.ref);
    const refused = await overFixture.world.reviews.recordProposal(overFixture.round.context,
      proposalRequest(overFixture.ref, 'k3-16-budget-over', 1, over, null, 'over') as never);
    expect(refused).toMatchObject({ status: 'rejected', code: 'capacity' });
    expect(bytesOf(await readK3Review(overFixture.world, overFixture.round.record.ref))).toBe(bytesOf(overBefore));

    // 5,120: accepted by the same real owner.
    const exactFixture = await setup(kind);
    const accepted = await exactFixture.world.reviews.recordProposal(exactFixture.round.context,
      proposalRequest(exactFixture.ref, 'k3-16-budget-exact', 1, exact, null, 'exact') as never);
    expect(accepted).toMatchObject({ status: 'committed' });
    if (accepted.status !== 'committed') throw new Error(JSON.stringify(accepted));
    expect(accepted.value.proposals).toHaveLength(1);
    expect(accepted.value.proposals[0]!.command).toBe(exact);
    expect(utf8BytesOf(methodLine(1, accepted.value.proposals[0]!.command))).toBe(5_120);
  }, 120_000);
});
