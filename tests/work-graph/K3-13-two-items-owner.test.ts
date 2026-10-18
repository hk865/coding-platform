/**
 * K3 row K3-13 at the record-owner level (R4, ruling 2 of
 * `.dsh-ref/k3-g3-impl-4.md`; spec line 1427, L16 line 399, L13 line 351).
 *
 * The Kernel runs a non-read-only batch one call at a time and only the started
 * call is unresolved, so a real crash leaves ONE process item, never two. The
 * two-process-item / one-conclusion combination is therefore the PURE aggregate
 * machine test `tests/runtime/K3-06-mixed-kinds-pure.test.ts` (K3-13 case,
 * constructed input, no store).
 *
 * HERE the reachable real record is the "other item has no conclusion" case on
 * the one process item the Kernel produced:
 *  - `createK3PendingReview`: one real blocked Run through the shared Host
 *    RUN-20/RUN-22 chain and the Runtime's own end;
 *  - `claimK3ReviewRound` (TASK-03r) enters the real review round;
 *  - the round ends by the scripted model's own completed reply
 *    (`endK3RunCompleted`), with NO round conclusion;
 *  - `settleK3Review` closes the pending process item
 *    `undetermined`/`by: 'settlement'` with the fixed sentence
 *    `核对轮没有给出结论`, its self-check `undetermined`, and the fixed
 *    `['undetermined', 'crash_undetermined']` reasons;
 *  - the real read model's queue carries the resulting card (L18).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import {
  claimK3ReviewRound, createK3PendingReview, endK3RunCompleted, openK3ReviewCardWorld,
  readK3Review, settleK3Review, type K3ReviewCardWorld,
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

describe('K3-13 owner: one real process item without a round conclusion (R4)', () => {
  it.each(['memory', 'sqlite'] as const)(
    'K3-13 %s: settlement closes the pending process item undetermined/settlement with the fixed sentence and reasons, and the card is queued',
    async kind => {
      const world = await openK3ReviewCardWorld(kind);
      worlds.push(world);
      const created = await createK3PendingReview(world, {
        taskId: 'k3-20-a', label: 'k3-13-owner', callId: 'k3-13-call-1', command: 'echo first',
      });

      // --- create: the real one-process-item record ---------------------------
      expect(created).toMatchObject({ status: 'pending_review', inventory: 'complete', inventoryProblem: null,
        activeRound: null, rounds: [], decisionReasons: [] });
      expect(created.items.map(entry => entry.alias)).toEqual([1]);
      expect(created.items.map(entry => entry.kind)).toEqual(['process']);
      expect(created.items.map(entry => entry.observed)).toEqual([{ verdict: 'pending', by: null }]);

      // --- the public review claim writes UCR-03 activeRound -------------------
      const round = await claimK3ReviewRound(world, created, { phase: 'review' });
      expect(round.record).toMatchObject({ status: 'pending_review', revision: 2,
        activeRound: { runRef: round.claim.runRef, phase: 'review', round: 1, stateEntry: 1, startedRevision: 1 } });

      // --- end the round through the Runtime; the item gets NO conclusion ------
      const ended = await endK3RunCompleted(world, round.claim);
      expect(ended).toMatchObject({ status: 'ended', outcome: 'completed' });
      const beforeSettle = await readK3Review(world, created.ref);
      // Only after the round Run ends with a known `completed` result may
      // `settleReview` run (L16 trigger 1); the item is still pending.
      expect(beforeSettle.items[0]!.observed).toEqual({ verdict: 'pending', by: null });
      const settled = await settleK3Review(world, beforeSettle);
      expect(settled, JSON.stringify(settled)).toMatchObject({ status: 'needs_decision', activeRound: null });

      // Read back through the public port: the one pending process item is closed
      // by settlement with the fixed sentence.
      const final = await readK3Review(world, created.ref);
      expect(final.status).toBe('needs_decision');
      expect(final.activeRound).toBe(null);
      expect(final.items).toHaveLength(1);
      expect(final.items.map(item => item.alias)).toEqual([1]);
      expect(final.items.map(item => item.kind)).toEqual(['process']);
      expect(final.items[0]!.observed).toMatchObject({
        verdict: 'undetermined', by: 'settlement', evidence: '核对轮没有给出结论',
        crashSuspicion: { verdict: 'undetermined', evidence: '没有自查依据' },
      });
      expect(final.decisionReasons).toEqual(['undetermined', 'crash_undetermined']);

      // K3-13 card part (L18): the `undetermined` record is needs_decision and
      // its card is in the queue. The real read model reads the same record store
      // as the owner; nothing is re-encoded.
      const key = decisionSourceKey({ kind: 'unknown_call_review',
        reviewRef: final.ref, revision: final.revision });
      const queue = await world.readModel.queryDecisionQueue(world.fixture.ctx, {
        workspace: world.fixture.base.scope, sections: ['waiting_answer'], page: { limit: 100 } });
      expect(queue.status, JSON.stringify(queue)).toBe('ready');
      if (queue.status !== 'ready') return;
      const card = queue.value.waitingAnswer.find(entry => entry.source.key === key);
      expect(card, 'the needs_decision review record has its card').toBeDefined();
      expect(card).toMatchObject({ state: 'waiting_answer', readOnly: false, actions: ['answer'],
        source: { kind: 'unknown_call_review' },
        options: [{ id: 'rerun_as_is' }, { id: 'safer_method' }, { id: 'skip_as_done' },
          { id: 'handle_myself' }] });
      expect(queue.value.capabilities)
        .toContainEqual({ source: 'unknown_call_review', availability: 'available' });
    },
    180_000,
  );
});
