/**
 * K3-42 (二) (L13/D6/L16, spec row 1437): an `unexpanded` review item through the
 * REAL R2 chain of K3-05, with all of the size coming from the PUBLIC routes.
 *
 * The work instruction is written through `plans/propose` + `plans/apply`
 * (`hostAdopt`): it enters the task context as-is (`context-assembler.ts`
 * `taskPayload`). Sized so the WORK prepare stores a manifest at or under
 * 262,144 bytes, but the REVIEW prepare's expanded single `shell` item pushes
 * the measured manifest over that literal, so the real
 * `fitUnknownCallReviewForManifest` trims the review input down to its floor:
 * the one item becomes `display: 'unexpanded'`. A single in-flight command is
 * cut to 4 KiB and paths are trimmed before items (Codex's warning), so a long
 * task instruction is the only public input that widens the window.
 *
 * Everything after that is the real chain: the review round is opened by the
 * Workflow (`openReviewWorkRoot` + `driveReviewUntil`), the scripted model
 * writes its conclusion through `record_unknown_call_review`, the round ends
 * `completed`, and `h.advance` drives the real `settle_review` step. The record
 * and the prepared manifest are read through the public routes
 * (`unknown-call-reviews/read`, `materials/open`) only.
 *
 * Scripted model only; no host process, no real model, no database/artifact
 * open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { preparedManifestOf } from './support/brief.js';
import { preparedOf, redrivePolicy } from './support/common.js';
import { hostAdopt } from './support/plan.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';
import { openShellWorkRoot, prepareOn } from './support/shell-work-root.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart, readExecution } from '../helpers/A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';

// The KE6 stand-in (the K3-05 shape): `reviewCapability` probes read-only
// sandboxes; no host process runs.
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

/** The fixed settlement evidence the record must carry (L16/D6). */
const D6_EVIDENCE = '核对说明里没有这条命令的全文，按判断不了处理';
const D6_SELF_CHECK_EVIDENCE = '命令没给全，自查同样没有依据。';
const MODEL_EVIDENCE = '模型写：这条跑完了，收尾正常';
const MODEL_CRASH_UNLIKELY = '模型写：没看到崩溃痕迹';

/**
 * The public instruction size. ASCII only, so one repetition is one manifest
 * byte. Tuned so the WORK manifest is under 262,144 while the REVIEW manifest
 * with the expanded item is over it and its floor is not.
 */
const INSTRUCTION_REPEAT = 243_885;
const LONG_INSTRUCTION = 'K3-42 (二) sized instruction: ' + 'x'.repeat(INSTRUCTION_REPEAT);

afterEach(async () => {
  shellSeam.release();
  sandbox.available = true;
  await cleanupScenarios();
  await cleanupRestart();
});

/** A command OVER 4 KiB (UTF-8) made of quotes, backslashes and control characters. */
function bigCommand(): string {
  return 'echo #1 ' + '"\\\u0001'.repeat(1400) + '\u0000tail';
}

function reviewOf(h: HostScenario, runRef: RunRef): Promise<ReadResult<UnknownCallReviewV1>> {
  return h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read', plain(AG2B_SCOPE, { runRef }));
}

/** L18 option labels, in the frozen order (the card source's literals). */
const FOUR_OPTIONS = [
  { id: 'rerun_as_is', label: '照原样重跑', effect: 'apply' },
  { id: 'safer_method', label: '换个稳妥的跑法再跑', effect: 'apply' },
  { id: 'skip_as_done', label: '跳过，当作已做', effect: 'apply' },
  { id: 'handle_myself', label: '我来处理', effect: 'apply' },
];

/**
 * The unexpanded record's card is in the queue; its aggregate object pins the
 * record, and the card's record carries the model's text in
 * `reviewerConclusion` plus the D6 reasons (`undetermined`/`crash_undetermined`).
 */
async function expectSettledReviewCard(h: HostScenario, record: UnknownCallReviewV1): Promise<void> {
  const queue = await h.post<ReadResult<DecisionQueueReadV1>>('decisions/queue',
    plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, sections: ['waiting_answer', 'history'], page: { limit: 100 } }));
  if (queue.status !== 'ready') throw new Error(`the decision queue is not readable: ${JSON.stringify(queue)}`);
  const cards = queue.value.waitingAnswer.filter(card => card.source.kind === 'unknown_call_review');
  expect(cards).toHaveLength(1);
  const card: DecisionCardV1 = cards[0]!;
  const key = decisionSourceKey({ kind: 'unknown_call_review', reviewRef: record.ref, revision: record.revision });
  expect(card.source.key).toBe(key);
  expect(card.state).toBe('waiting_answer');
  // One process item -> proposalTargets present -> the four L18 options.
  expect(card.options).toEqual(FOUR_OPTIONS);
  const aggregate = card.objects.filter(object => object.kind === 'aggregate');
  expect(aggregate).toEqual([{ kind: 'aggregate', pin: { ref: record.ref, revision: record.revision },
    label: `核对记录 ${record.runRef.runId.slice(0, 8)}：需要你决定` }]);
  expect(card.closedReason).toBeNull();
  expect(card.readOnly).toBe(false);
  expect(card.actions).toEqual(['answer']);

  const pin = card.source.pins[0]!;
  expect(pin).toEqual({ ref: record.ref, revision: record.revision });
  const pinned = await h.post<ReadResult<UnknownCallReviewV1>>('unknown-call-reviews/read',
    plain(AG2B_SCOPE, { ref: pin.ref }));
  expect(pinned).toMatchObject({ status: 'ready', value: { revision: pin.revision, status: 'needs_decision' } });
  if (pinned.status !== 'ready') throw new Error('the card pin must read the review record');
  expect(pinned.value.decisionReasons).toEqual(expect.arrayContaining(['undetermined', 'crash_undetermined']));
  expect(pinned.value.decisionReasons).not.toContain('crash_possible');
  expect(pinned.value.items[0]!.observed).toMatchObject({
    verdict: 'undetermined', by: 'settlement',
    reviewerConclusion: { verdict: 'done', evidence: MODEL_EVIDENCE,
      crashSuspicion: { verdict: 'unlikely', evidence: MODEL_CRASH_UNLIKELY } },
  });
}

describe('K3-42 (二) an unexpanded item is re-judged at settlement', () => {
  it('K3-42 (二): a long public task instruction makes the real review prepare trim the item to unexpanded; the model conclusion is written through the real tool, the round ends, the real settle_review re-judges it', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });

    // --- The long instruction through the PUBLIC plans/propose + plans/apply. -
    const adopted = await hostAdopt(h, 'ag2b-plan-k342-unexpanded', draft => ({
      ...draft,
      assignments: (draft.assignments ?? []).map(assignment => assignment.taskId === AG2B_WORK_TASK_ID
        ? { ...assignment, instruction: LONG_INSTRUCTION }
        : assignment),
    }), { text: 'K3-42 (二): size the work instruction', sources: [] }, 'k3-42-unexpanded-size');
    expect(adopted.assignments?.find(assignment => assignment.taskId === AG2B_WORK_TASK_ID)?.instruction)
      .toBe(LONG_INSTRUCTION);

    // --- A: the >4 KiB `shell` call in flight, closed by RUN-25. --------------
    shellSeam.arm();
    const modelA = createScriptedModel([{ kind: 'calls', calls: [
      { callId: 'k3-42-unexpanded-a', name: 'shell', args: { command: bigCommand() } }] }]);
    const rootA = await openShellWorkRoot(h, modelA);
    let runningA: Promise<unknown> | null = null;
    let preparedA: ReturnType<typeof preparedOf>;
    try {
      const startA = await prepareOn(rootA, h.select('k3-42-unexpanded-a', AG2B_WORK_TASK_ID));
      preparedA = preparedOf(startA);
      runningA = rootA.runtime.startRun(hostCtx(), { prepared: preparedA, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-42-unexpanded-a-start' });
      await shellSeam.waitForCall();
      await h.restart({ crash: true });
    } finally {
      shellSeam.release();
      await runningA?.catch(() => undefined);
      await rootA.close();
    }

    const created = await reviewOf(h, preparedA.claim.runRef);
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') throw new Error('the review record did not read');
    expect(created.value).toMatchObject({ status: 'pending_review', activeRound: null });
    expect(created.value.items).toHaveLength(1);
    expect(created.value.items[0]!.kind).toBe('process');

    // --- The real review round: the model records done + crash unlikely. ------
    const modelReview = createScriptedModel([
      { kind: 'calls', calls: [{ callId: 'k3-42-unexpanded-review', name: 'record_unknown_call_review',
        args: { item: 1, verdict: 'done', evidence: MODEL_EVIDENCE,
          crashSuspicion: { verdict: 'unlikely', evidence: MODEL_CRASH_UNLIKELY } } }] },
      { kind: 'text', text: 'the review round wrote its conclusion' },
    ]);
    const reviewRoot = await openReviewWorkRoot(h, modelReview);
    let roundRunRef: RunRef | null = null;
    try {
      const startStop = await driveReviewUntil(reviewRoot, h.select('k3-42-unexpanded-review', AG2B_WORK_TASK_ID),
        performs('start'));
      const prepared = preparedOf(startStop.stopped);
      roundRunRef = prepared.claim.runRef;
      // The review instruction half: the whole prepared manifest through the
      // PUBLIC `materials/open` route (never a direct SQLite/artifact open).
      const manifest = await preparedManifestOf(h, prepared.envelope.bundleRef);
      if (manifest.unknownCallReview === undefined) throw new Error('the review instruction is missing');
      expect(manifest.unknownCallReview.items).toHaveLength(1);
      expect(manifest.unknownCallReview.items[0]!.display).toBe('unexpanded');
      // The `unexpanded` item keeps the spec floor line AND carries the full
      // D6 sentence (spec L13: the sentence covers `truncated` and
      // `unexpanded` alike; K3-35-owner-manifest-trim.test.ts:191 still
      // asserts the floor line).
      expect(manifest.input).toContain('- #1 shell：没展开，按判断不了处理。');
      expect(manifest.input).toContain('这条命令没有全文，两个结论（做没做完、会不会是崩溃的原因）一律按判断不了处理；你看到的痕迹照样写进依据。');

      await reviewRoot.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-42-unexpanded-review-start' });
      const ended = await readExecution(h.host, roundRunRef);
      expect(ended.run).toMatchObject({ status: 'ended', outcome: 'completed' });
    } finally {
      await reviewRoot.close();
    }
    expect(roundRunRef).not.toBeNull();
    if (roundRunRef === null) throw new Error('the review round Run is unknown');

    // --- The real settle_review step. ----------------------------------------
    const settled = await h.advance(h.select('k3-42-unexpanded-settle', AG2B_WORK_TASK_ID),
      { stopBefore: performs('requeue_task') });
    expect(settled.receipts.map(receipt => receipt.kind)).toContain('settle_review');

    const afterSettle = await reviewOf(h, preparedA.claim.runRef);
    expect(afterSettle.status).toBe('ready');
    if (afterSettle.status !== 'ready') throw new Error('the settled review did not read');
    expect(afterSettle.value.status).toBe('needs_decision');
    expect(afterSettle.value.decisionReasons).toContain('undetermined');
    expect(afterSettle.value.decisionReasons).toContain('crash_undetermined');
    expect(afterSettle.value.decisionReasons).not.toContain('crash_possible');
    const observed = afterSettle.value.items.find(item => item.alias === 1)?.observed;
    expect(observed).toMatchObject({
      verdict: 'undetermined', by: 'settlement', evidence: D6_EVIDENCE,
      crashSuspicion: { verdict: 'undetermined', evidence: D6_SELF_CHECK_EVIDENCE },
      reviewerConclusion: { verdict: 'done', evidence: MODEL_EVIDENCE,
        crashSuspicion: { verdict: 'unlikely', evidence: MODEL_CRASH_UNLIKELY } },
      roundRunRef: { runId: roundRunRef.runId },
    });
    // (二) the unexpanded record's card is in the queue and pins this record.
    await expectSettledReviewCard(h, afterSettle.value);
  }, 240_000);
});
