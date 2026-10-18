/**
 * K3-13 (L16, spec line 1427; R2): reworked under binding book
 * k3-g3-impl-4.md rulings 1–2.
 *
 * Ruling 1 forbids changing a tool's effect class to force parallel calls: the
 * old `read_only` + `independentReadOnly` `shell` stand-in is gone. The real
 * Kernel runs a batch with a `process` call one call at a time, so only the
 * first `shell` call is ever `running` and RUN-25 records ONE unresolved
 * `process` item. This R2 file therefore proves the reachable single-item
 * chain: a real `shell` call in flight (tests/helpers/K3-tool-seams.ts as-is,
 * `effectClass: 'process'`) → crash → RUN-25 → the review round →
 * `record_unknown_call_review` → Workflow `settle_review` → public read, and
 * the record settles `resolved` with no reasons (a complete conclusion).
 *
 * The unreachable two-item half ("the other item has no conclusion") is proven
 * at the owner level in ./K3-13-two-items-owner.test.ts (ruling 2).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupScenarios, HostScenario, hostCtx, performs, waitFor } from './harness.js';
import { preparedOf, redrivePolicy } from './support/common.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';
import { openShellWorkRoot, prepareOn } from './support/shell-work-root.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart, readExecution } from '../helpers/A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';

// The KE6 stand-in: `reviewCapability` reads `ProcessSandbox.probe` with the
// read-only options; no host process runs.
const sandbox = vi.hoisted(() => ({ available: true as boolean }));
vi.mock('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js')>();
  class KProcessSandbox {
    constructor(..._args: unknown[]) { void _args; }
    get effectiveOptions(): { protectedPaths: string[]; readOnlyPaths: string[]; executablePath: string } {
      return { protectedPaths: [], readOnlyPaths: [], executablePath: '/usr/bin:/bin' };
    }
    static async probe(_root: string, _workspace: unknown, options?: Record<string, unknown>): Promise<unknown> {
      if (options?.['workspaceMode'] !== 'read_only') {
        return { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: only read-only probing' };
      }
      return sandbox.available
        ? { available: true, version: 'stub-v1', bwrapPath: '/usr/bin/bwrap', reason: null }
        : { available: false, version: 'stub-v1', bwrapPath: null, reason: 'stub: bubblewrap unavailable' };
    }
  }
  return { ...actual, ProcessSandbox: KProcessSandbox };
});

// --- The shell seam, used as-is: name `shell`, `effectClass: 'process'`. ----
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return {
    ...actual,
    createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
      (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg),
  };
});
seams.shellSeam = shellSeam;

afterEach(async () => {
  shellSeam.release();
  sandbox.available = true;
  await cleanupScenarios();
  await cleanupRestart();
});

function reviewOf(h: HostScenario, runRef: RunRef): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}

/**
 * One work Run whose single call is a real `shell` (process) call; the call is
 * held in flight, the crash restart reconciles with RUN-25 and the review
 * record lists the one `process` item. Any sibling calls of the same Kernel
 * batch stay queued and are never `running`, so RUN-25 cannot see them.
 */
async function crashOneCommand(h: HostScenario, label: string): Promise<RunRef> {
  shellSeam.arm();
  const modelA = createScriptedModel([{ kind: 'calls', calls: [
    { callId: `${label}-a`, name: 'shell', args: { command: `${label} A runs a program` } },
  ] }]);
  const rootA = await openShellWorkRoot(h, modelA);
  let runningA: Promise<unknown> | null = null;
  let preparedA: ReturnType<typeof preparedOf>;
  try {
    const startA = await prepareOn(rootA, h.select(`${label}-a`, AG2B_WORK_TASK_ID));
    preparedA = preparedOf(startA);
    runningA = rootA.runtime.startRun(hostCtx(), { prepared: preparedA, consumerId: AG2B_CONSUMER_ID,
      requestId: `${label}-a-start` });
    await waitFor(async () => shellSeam.calls.length, count => count >= 1, `${label}: the shell call in flight`);
    await h.restart({ crash: true });
  } finally {
    shellSeam.release();
    await runningA?.catch(() => undefined);
    await rootA.close();
  }
  return preparedA.claim.runRef;
}

describe('K3-13 two commands, one conclusion', () => {
  it('K3-13: the reachable single process item is concluded by the round and settles resolved with no reasons', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const origin = await crashOneCommand(h, 'k3-13');

    const created = await reviewOf(h, origin);
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') return;
    expect(created.value.status).toBe('pending_review');
    expect(created.value.items).toHaveLength(1);
    expect(created.value.items.map(item => item.alias)).toEqual([1]);
    expect(created.value.items.map(item => item.kind)).toEqual(['process']);
    expect(created.value.items.map(item => item.observed)).toEqual([
      { verdict: 'pending', by: null },
    ]);

    const modelReview = createScriptedModel([
      { kind: 'calls', calls: [{ callId: 'k3-13-conclusion', name: 'record_unknown_call_review',
        args: { item: 1, verdict: 'done', evidence: 'the first command finished',
          crashSuspicion: { verdict: 'unlikely', evidence: 'no crash trace' } } }] },
      { kind: 'text', text: 'the review round wrote one conclusion' },
    ]);
    const reviewRoot = await openReviewWorkRoot(h, modelReview);
    try {
      const startStop = await driveReviewUntil(reviewRoot, h.select('k3-13-review', AG2B_WORK_TASK_ID),
        performs('start'));
      const prepared = preparedOf(startStop.stopped);
      const roundRunRef = prepared.claim.runRef;
      await reviewRoot.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-13-review-start' });

      // The round wrote #1 and ended with a known `completed` outcome.
      expect((await readExecution(h.host, roundRunRef)).run).toMatchObject({ status: 'ended', outcome: 'completed' });
      const concluded = await reviewOf(h, origin);
      expect(concluded.status).toBe('ready');
      if (concluded.status !== 'ready') return;
      expect(concluded.value.status).toBe('pending_review');
      expect(concluded.value.items[0]!.observed).toMatchObject({ verdict: 'done', by: 'review_round',
        roundRunRef: { runId: roundRunRef.runId } });

      // `settle_review` runs here (L16 trigger 1): the round ended and every
      // process item has a conclusion, so the record resolves. The Task then
      // requeues the original Run, so stop before that requeue.
      const toSettle = await h.advance(h.select('k3-13-settle', AG2B_WORK_TASK_ID),
        { stopBefore: performs('requeue_task') });
      expect(toSettle.receipts.map(receipt => receipt.kind)).toContain('settle_review');

      const settled = await reviewOf(h, origin);
      expect(settled.status).toBe('ready');
      if (settled.status !== 'ready') return;
      expect(settled.value.status).toBe('resolved');
      expect(settled.value.open).toBe('no');
      expect(settled.value.activeRound).toBe(null);
      expect(settled.value.decisionReasons).toEqual([]);
      expect(settled.value.items).toHaveLength(1);
      expect(settled.value.items[0]!.observed).toMatchObject({ verdict: 'done', by: 'review_round',
        evidence: 'the first command finished', crashSuspicion: { verdict: 'unlikely' } });
    } finally {
      await reviewRoot.close();
    }
  }, 240_000);
});
