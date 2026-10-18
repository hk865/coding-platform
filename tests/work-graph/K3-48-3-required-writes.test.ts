/**
 * K3 row K3-48 (三) at the owner level (M3, L7/L8/L14/L16/L20): the real
 * `settle_review`, `holdReview` and `releaseHold` required writes commit on a
 * reachable record, and every written record stays at or under the absolute
 * 512 KiB (524,288-byte) ceiling.
 *
 * The record is reached through the shared public steps only (coordinator-mode
 * "no hand-written facts"): `openK3ReviewCardWorld(kind)` (both backends) +
 * `createK3PendingReview` (real claim/prepare/Runtime start with §5.1's shell
 * stand-in, the production RUN-20/RUN-22 read of that Kernel Turn, the Runtime's
 * own end) gives the real `pending_review` record with the ONE process item the
 * Kernel produced; the public `settleK3Review{review_unavailable}` gives the real
 * `needs_decision` record; `world.reviews` then performs the real hold/release
 * owner writes. No item, draft, event, position or cursor is an input.
 *
 * SPLIT WITH THE PURE TEST: a reachable Run holds one process call, so a truly
 * reachable record is far below the creation budget B, and the B-boundary bytes
 * arithmetic (`bytes === B = 158,720`, `bytes(settled) > B`, and admission of the
 * required writes past B) lives in the pure codec/state-machine test
 * `tests/runtime/K3-48-3-extremes-pure.test.ts` over the 32-item constructed
 * input. The 513-character draft-path refusal (category (a) validation input) is
 * there too. This owner row keeps what the real path can prove: the real
 * settle/hold/release commits, their revision/status/disposition results, the L7
 * 2,000-character hold text, and `bytes <= 512 KiB` on every read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import {
  createK3PendingReview, openK3ReviewCardWorld, readK3Review, settleK3Review,
  type K3ReviewCardWorld,
} from '../helpers/K3-proposal-round.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';

// §5.1's stand-in `shell`, hoisted per test file (the real Run's one call uses
// it). The mock must be declared here; the helper module owns the seam state.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const RECORD_MAX_BYTES = 524_288;

const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

describe('K3-48 (三) required writes on the real reachable record', () => {
  it.each(['memory', 'sqlite'] as const)('K3-48 (三) %s (UCR-07): settle, hold and release commit and every record stays at or under 512 KiB', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    const record = await createK3PendingReview(world, {
      label: 'k3-48-3', callId: 'k3-48-3-call-1', command: 'echo k3-48-3',
    });
    // The real pending_review record has exactly the one process item the
    // Kernel produced; no constructed item or draft is involved.
    expect(record).toMatchObject({
      revision: 1, status: 'pending_review', activeRound: null, inventory: 'complete', itemsOmitted: 0,
    });
    expect(record.items).toHaveLength(1);
    expect(record.items[0]).toMatchObject({ kind: 'process', alias: 1 });
    expect(bytes(record)).toBeLessThanOrEqual(RECORD_MAX_BYTES);

    // UCR-07 (SPEC:1259): a `pending_review` record with no active round settles
    // through the real public `review_unavailable` settlement to `needs_decision`.
    const decision = await settleK3Review(world, record, { cause: 'review_unavailable' });
    expect(decision, JSON.stringify(decision)).toMatchObject({
      revision: 2, status: 'needs_decision', activeRound: null,
      decisionReasons: ['review_unavailable', 'undetermined', 'crash_undetermined'],
    });
    expect(bytes(decision)).toBeLessThanOrEqual(RECORD_MAX_BYTES);

    // holdReview (UCR-15) with the L7 2,000-character text (three-byte characters).
    const text = '核'.repeat(2_000);
    const held = await world.reviews.holdReview(world.fixture.ctx, {
      input: { reviewRef: record.ref, text },
      meta: { requestId: 'k3-48-3-hold', expected: [{ ref: record.ref, revision: decision.revision }] },
    });
    expect(held, JSON.stringify(held)).toMatchObject({ status: 'committed', replayed: false, value: {
      revision: 3, status: 'resolved',
      disposition: { choice: 'handle_myself', source: 'direct', hold: 'held', text },
    } });
    if (held.status !== 'committed') return;
    expect(bytes(held.value)).toBeLessThanOrEqual(RECORD_MAX_BYTES);

    // releaseHold (UCR-14).
    const released = await world.reviews.releaseHold(world.fixture.ctx, {
      input: { reviewRef: record.ref },
      meta: { requestId: 'k3-48-3-release', expected: [{ ref: record.ref, revision: held.value.revision }] },
    });
    expect(released, JSON.stringify(released)).toMatchObject({ status: 'committed', replayed: false, value: {
      revision: 4, status: 'resolved', disposition: { choice: 'handle_myself', hold: 'released' },
    } });
    if (released.status !== 'committed') return;
    expect(bytes(released.value)).toBeLessThanOrEqual(RECORD_MAX_BYTES);

    // The committed record read back through the owner read port.
    const reread = await readK3Review(world, record.ref);
    expect(reread).toMatchObject({
      revision: 4, status: 'resolved',
      disposition: { choice: 'handle_myself', hold: 'released', text },
    });
    expect(bytes(reread)).toBeLessThanOrEqual(RECORD_MAX_BYTES);
  });
});
