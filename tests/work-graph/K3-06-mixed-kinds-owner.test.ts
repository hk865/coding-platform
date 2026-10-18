/**
 * K3 row K3-06 at the record-owner level (R4, ruling 2 of
 * `.dsh-ref/k3-g3-impl-4.md`; spec line 1413, L3 line 153, L4 line 172, L8 line
 * 266, L9 line 291, L25 line 652).
 *
 * The real Kernel runs a non-read-only batch one call at a time and only the
 * call it has STARTED is unresolved, so a real crash leaves exactly ONE process
 * item (RUN-20/RUN-22 read it from the Kernel Turn; see
 * `K3-48-3-extremes-pure.test.ts`). The three-kind / three-item combination the
 * row names therefore cannot be produced by any public path; it is the PURE
 * aggregate-machine test `tests/runtime/K3-06-mixed-kinds-pure.test.ts` (K3-06
 * case, constructed input, no store).
 *
 * HERE the owner row reaches its record through the shared public steps only:
 *  - the ONE real blocked Run of `createK3PendingReview` (real claim/prepare/
 *    Runtime start with §5.1's `shell` stand-in, the production Host RUN-20/
 *    RUN-22 read of that Kernel Turn, the Runtime's own end);
 *  - the public review claim `claimK3ReviewRound` (TASK-03r) and the write entry
 *    `createUnknownCallReviewService.recordConclusion` for the one process item;
 *  - the round Run ended by the scripted model's own completed reply
 *    (`endK3RunCompleted`), then `settleK3Review` (UCR-06/07).
 *
 * The record is read back only through the public `readReview` port.
 *
 * The second row is the L3 kind-vs-name validation. It too reaches its prior
 * state through the public steps and the SAME backend's world: a real claimed
 * and started blocked `shell` Run through `openRealRunHarness`, then the Host's
 * RUN-20 (`harness.reconcileUnknown`) over that real Kernel Turn, which books
 * the call the Run really started. Only then is the wrong-kind draft the INPUT
 * UNDER TEST (category (a)): the owner refuses it and nothing is written. The
 * old row committed a hand-built unknown classification first; that precondition
 * is gone, so the refusal now rests on a real ended `outcome_unknown` Run.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type {
  UnknownCallObservationV1, UnknownCallReviewDraftV1, UnknownCallReviewItemV1,
} from '../../src/contracts/unknown-call-review.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createRunReconcileService } from '../../src/core/work-graph/tasks/run-reconcile-service.js';
import { createUnknownCallReviewService } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { openRealRunHarness } from '../helpers/K3-35-continuation-fixture.js';
import {
  claimK3ReviewRound, createK3PendingReview, endK3RunCompleted, openK3ReviewCardWorld,
  readK3Review, recordK3Conclusion, settleK3Review, type K3ReviewCardWorld,
} from '../helpers/K3-proposal-round.js';
import { PLAN_B2 } from '../helpers/S5-decision-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';

// §5.1's stand-in `shell`, hoisted per test file (the real Run's one call uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const AT = '2026-10-20T00:00:00.000Z';

const UNAVAILABLE_WORKSPACE = {
  status: 'unavailable' as const, runBaselineKnown: false, reason: 'not_configured' as const, detail: 'k3-06-owner',
};

// The L4 creation verdict the trusted entry carried: `edit` compares in continuation.
const EDIT_OBSERVED: UnknownCallObservationV1 = { verdict: 'compare_in_continuation', by: 'platform' };

/** One L3/L7 item with a real SHA-256 digest and a summary inside its limits. */
function item(alias: number, callId: string, toolName: string, kind: UnknownCallReviewItemV1['kind'],
  observed: UnknownCallObservationV1, summary: UnknownCallReviewItemV1['summary'], args: unknown): UnknownCallReviewItemV1 {
  return {
    alias, callId, toolName, kind, contained: true,
    kernel: { adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 't',
      callId, declaredPosition: 1, startedPosition: alias },
    argumentsDigest: sha256Hex(canonicalJson(args as never)),
    summary, startedAt: null, observed,
  };
}

const EDIT_ITEM = item(1, 'k3-06-edit', 'edit', 'file_edit', EDIT_OBSERVED,
  { command: null, cwd: null, mode: 'replace', paths: ['src/module.ts'], pathsOmitted: 0, truncated: false },
  { mode: 'replace', path: 'src/module.ts', oldText: 'a', newText: 'b' });

type OwnerServices = {
  reconcile: ReturnType<typeof createRunReconcileService>;
  reviews: ReturnType<typeof createUnknownCallReviewService>;
};

/** The owner services over the ONE world store: no second fixture backend. */
function ownerServices(records: K3ReviewCardWorld['records']): OwnerServices {
  const reads = createRunStateReader({ records });
  let seq = 0;
  const reconcile = createRunReconcileService({ records, reads,
    hostInstance: { hostInstanceId: 'k3-06-owner-host', lease: 'owned',
      takeover: { kind: 'hl03_stale_lock', previousInstanceId: 'previous-host', previousPid: 42 } },
    now: () => AT, eventId: () => `k3-06-event-${String(++seq)}` });
  const reviews = createUnknownCallReviewService({ records, lookups: records, reads,
    readReviewDisplays: async () => ({ status: 'ready', value: new Map([[1, 'full']]) }),
    now: () => AT, eventId: () => `k3-06-review-event-${String(++seq)}` });
  return { reconcile, reviews };
}

function draftOf(items: UnknownCallReviewItemV1[]): UnknownCallReviewDraftV1 {
  return { inventory: 'complete', inventoryProblem: null, items, itemsOmitted: 0, workspace: UNAVAILABLE_WORKSPACE };
}

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

describe('K3-06 owner: the reachable one-process-item record, then the L3 kind refusal (R4)', () => {
  it.each(['memory', 'sqlite'] as const)(
    'K3-06 %s: the real blocked Run creates one process item, only it is reviewed, and one settlement resolves the record',
    async kind => {
      const world = await openK3ReviewCardWorld(kind);
      worlds.push(world);
      const created = await createK3PendingReview(world, {
        taskId: 'k3-20-a', label: 'k3-06-owner', callId: 'k3-06-shell', command: 'K3-06 runs a program',
      });

      // --- create: the production RUN-20/RUN-22 record of the real Kernel Turn ---
      expect(created).toMatchObject({ status: 'pending_review', inventory: 'complete', inventoryProblem: null,
        activeRound: null, rounds: [], decisionReasons: [] });
      const origin = await createRunStateReader({ records: world.records })
        .readExecution(world.fixture.ctx, created.runRef);
      expect(origin).toMatchObject({ status: 'ready',
        value: { run: { status: 'ended', outcome: 'crashed' } } });
      expect(created.items).toHaveLength(1);
      expect(created.items.map(entry => entry.alias)).toEqual([1]);
      expect(created.items.map(entry => entry.toolName)).toEqual(['shell']);
      expect(created.items.map(entry => entry.kind)).toEqual(['process']);
      expect(created.items.map(entry => entry.contained)).toEqual([true]);
      // L4 carried from the trusted entry: a started process call is `pending`.
      expect(created.items.map(entry => entry.observed)).toEqual([{ verdict: 'pending', by: null }]);
      // One batch: the one item is the Kernel Turn's real call.
      expect(new Set(created.items.map(entry => entry.kernel.turnId)).size).toBe(1);
      expect(new Set(created.items.map(entry => entry.kernel.kernelRunId)).size).toBe(1);
      expect(new Set(created.items.map(entry => entry.kernel.declaredPosition)).size).toBe(1);

      // --- the public review claim writes UCR-03 activeRound -------------------
      const round = await claimK3ReviewRound(world, created, { phase: 'review' });
      expect(round.record).toMatchObject({ status: 'pending_review', revision: 2,
        activeRound: { runRef: round.claim.runRef, phase: 'review', round: 1, stateEntry: 1, startedRevision: 1 } });

      // --- write: recordConclusion for the one process item --------------------
      const concluded = await recordK3Conclusion(world, round, {
        item: 1, verdict: 'done', evidence: 'the shell call was checked by hand',
        crashSuspicion: { verdict: 'unlikely', evidence: 'the command leaves no crash trace' },
      });
      expect(concluded).toMatchObject({ status: 'pending_review', items: [
        { alias: 1, observed: { verdict: 'done', by: 'review_round',
          roundRunRef: { runId: round.claim.runRef.runId },
          crashSuspicion: { verdict: 'unlikely' } } },
      ] });

      // --- end the round through the Runtime, then settleReview ----------------
      const ended = await endK3RunCompleted(world, round.claim);
      expect(ended).toMatchObject({ status: 'ended', outcome: 'completed' });
      const beforeSettle = await readK3Review(world, created.ref);
      const settled = await settleK3Review(world, beforeSettle);
      expect(settled, JSON.stringify(settled)).toMatchObject({ status: 'resolved', activeRound: null, decisionReasons: [],
        rounds: [{ runRef: round.claim.runRef, phase: 'review', round: 1, stateEntry: 1, result: 'finished' }],
        items: [
          { alias: 1, observed: { verdict: 'done', by: 'review_round', crashSuspicion: { verdict: 'unlikely' } } },
        ] });

      // Read back through the public port.
      const resolved = await readK3Review(world, created.ref);
      expect(resolved).toMatchObject({ status: 'resolved', open: 'no', activeRound: null, revision: 4,
        rounds: [{ phase: 'review', round: 1, result: 'finished' }],
        items: [{ alias: 1, kind: 'process', observed: { verdict: 'done', by: 'review_round' } }] });
    },
    120_000,
  );

  it.each(['memory', 'sqlite'] as const)(
    'K3-06 %s: the create entry refuses an item whose kind disagrees with the L3 mapping and writes nothing',
    async kind => {
      const world = await openK3ReviewCardWorld(kind);
      worlds.push(world);
      const harness = await openRealRunHarness(world);
      // The §5.1 `shell` stays held until the owner has refused the attestation:
      // the real RUN-22 path (`createRecord`) attests before it releases and ends
      // the Runtime, so the Run revision the `expected` pin names cannot move.
      let started: Promise<unknown> | undefined;
      try {
        // Prior state through the public steps: a real claimed and started
        // blocked `shell` Run; its one started call is the Kernel's fact.
        const sessionRef = await world.fixture.createS5Session(`k3-06-wrong-session-${kind}`);
        const claim = await harness.claimRun({ sessionRef, planRef: PLAN_B2, taskId: 'k3-20-a',
          requestId: `k3-06-wrong-claim-${kind}` });
        const run = await harness.prepareAndStart(claim, {
          model: createScriptedModel([{ kind: 'calls', calls: [{
            callId: 'k3-06-wrong', name: 'shell', args: { command: 'printf k3-06-wrong' },
          }] }]),
          tools: ['read', 'shell'], writeScope: ['.'], blockOnShell: true,
        });
        started = run.started;
        // RUN-20 over the REAL Kernel Turn books the started call and leaves the
        // ended `outcome_unknown` Run the attestation reads; the Run ends only
        // through the platform, never through a test-built event.
        const unknown = await harness.reconcileUnknown(claim);
        expect(unknown).toMatchObject({ status: 'ended', outcome: 'outcome_unknown' });

        // The owner services read the SAME world store, not a second backend.
        const services = ownerServices(world.records);
        // `edit` is L3 row 6 `file_edit`; claiming `platform` must be refused.
        const wrong: UnknownCallReviewItemV1 = { ...EDIT_ITEM, alias: 1, callId: 'k3-06-wrong',
          kernel: { ...EDIT_ITEM.kernel, callId: 'k3-06-wrong' }, kind: 'platform' };
        const result = await services.reconcile.resolveUnknownRun(world.fixture.ctx, { input: {
          runRef: claim.runRef, reason: 'wrong kind by hand', kernelTurnOpen: false, inputsConfirmed: true,
          review: draftOf([wrong]) },
          meta: { requestId: `k3-06-wrong-${kind}`, expected: [{ ref: claim.runRef, revision: unknown.revision }] } });
        expect(result).toMatchObject({ status: 'rejected', code: 'invalid',
          reason: 'review item #1 kind disagrees with L3' });
        expect(await services.reviews.readReview(world.fixture.ctx, { runRef: claim.runRef }))
          .toEqual({ status: 'not_found' });
      } finally {
        shellSeam.release();
        if (started !== undefined) await started.catch(() => undefined);
        await harness.closeUnion();
      }
    },
    120_000,
  );
});
