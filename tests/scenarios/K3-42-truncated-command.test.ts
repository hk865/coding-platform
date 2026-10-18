/**
 * K3-42 (一)/(三) (L13/D6, spec lines 358/363/406 and the row at 1437): a
 * `shell` command OVER 4 KiB is shown to the review round as
 * `display: 'truncated'` with the fixed D6 sentence; the review round has no
 * tool that reads Kernel history; the model still writes `done` / `unlikely`
 * (or `possible`), and settlement re-judges the conclusion AND the crash
 * self-check to `undetermined` with the fixed evidence while keeping the
 * model's text verbatim in `reviewerConclusion`.
 *
 * Cases (一) and (三) run the REAL R2 chain of K3-05: a work Run with a `shell`
 * call in flight is closed by RUN-25 (`takeover_unresolved`), the Workflow opens
 * the review round for real (`openReviewWorkRoot` + `driveReviewUntil`), the
 * scripted review model records its conclusion, the round ends `completed`, and
 * `h.advance` drives the real `settle_review` step.
 *
 * Lead ruling 6: no database or artifact-store open. The whole prepared manifest
 * is read through the public `materials/open` route (`preparedManifestOf`), and
 * what the MODEL received is asserted from the scripted model's observed request
 * (`modelReview.requests`). The granted L13 tool set stays on the prepared
 * envelope. Case (二) (`unexpanded`) lives in
 * `K3-42-unexpanded-r2.test.ts`: a single in-flight command contributes at most
 * 4 KiB, so the real chain cannot trim above the floor.
 *
 * Scripted model only; no host process, no real model.
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

/** The exact production renderer sentence beside a `truncated` item (L13). */
const D6_SENTENCE = '这条命令没有全文，两个结论（做没做完、会不会是崩溃的原因）一律按判断不了处理；你看到的痕迹照样写进依据。';
/** The fixed settlement evidence the record must carry (L16/D6). */
const D6_EVIDENCE = '核对说明里没有这条命令的全文，按判断不了处理';
const D6_SELF_CHECK_EVIDENCE = '命令没给全，自查同样没有依据。';
const MODEL_EVIDENCE = '模型写：这条跑完了，收尾正常';
const MODEL_CRASH_UNLIKELY = '模型写：没看到崩溃痕迹';
const MODEL_CRASH_POSSIBLE = '模型写：这条命令可能压垮了 Host';

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
 * The settled record's card is in the queue; its aggregate object is the record
 * at this revision, and the reviewer's own text plus the re-judged reasons are
 * what the card shows at that pin (L16 "显示在卡上").
 */
async function expectSettledReviewCard(h: HostScenario, record: UnknownCallReviewV1,
  reviewer: { crashVerdict: 'unlikely' | 'possible'; crashEvidence: string }): Promise<void> {
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

  // Read the record the card pins: the model's conclusion and the D6 re-judgment
  // are displayed from this exact revision.
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
      crashSuspicion: { verdict: reviewer.crashVerdict, evidence: reviewer.crashEvidence } },
  });
}

type ChainOutcome = {
  h: HostScenario;
  reviewRef: RunRef;
  roundRunRef: RunRef;
  display: string | undefined;
  tools: readonly string[];
  input: string;
  /** The tool names the scripted model's request really enabled. */
  observedTools: readonly string[];
  /** The scripted model's observed request, serialized once. */
  received: string;
  beforeSettle: UnknownCallReviewV1;
  afterSettle: UnknownCallReviewV1;
};

/**
 * The real R2 chain: RUN-25 over a >4 KiB `shell` call, the real review round
 * with the scripted `crashVerdict`, then the real `settle_review` step. The
 * manifest comes through the public `materials/open` route; the model's input
 * and tools come from the scripted model's observed request. The record comes
 * back through `unknown-call-reviews/read` only.
 */
async function runRealChain(crashVerdict: 'unlikely' | 'possible'): Promise<ChainOutcome> {
  const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
  const tag = crashVerdict;

  // --- A: the >4 KiB `shell` call in flight, closed by RUN-25. --------------
  shellSeam.arm();
  const modelA = createScriptedModel([{ kind: 'calls', calls: [
    { callId: `k3-42-a-${tag}`, name: 'shell', args: { command: bigCommand() } }] }]);
  const rootA = await openShellWorkRoot(h, modelA);
  let runningA: Promise<unknown> | null = null;
  let preparedA: ReturnType<typeof preparedOf>;
  try {
    const startA = await prepareOn(rootA, h.select('k3-42-a', AG2B_WORK_TASK_ID));
    preparedA = preparedOf(startA);
    runningA = rootA.runtime.startRun(hostCtx(), { prepared: preparedA, consumerId: AG2B_CONSUMER_ID,
      requestId: `k3-42-a-start-${tag}` });
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

  // --- The real review round: the model still writes done + crashVerdict. ---
  const modelReview = createScriptedModel([
    { kind: 'calls', calls: [{ callId: `k3-42-review-${tag}`, name: 'record_unknown_call_review',
      args: { item: 1, verdict: 'done', evidence: MODEL_EVIDENCE,
        crashSuspicion: { verdict: crashVerdict,
          evidence: crashVerdict === 'possible' ? MODEL_CRASH_POSSIBLE : MODEL_CRASH_UNLIKELY } } }] },
    { kind: 'text', text: 'the review round wrote its conclusion' },
  ]);
  const reviewRoot = await openReviewWorkRoot(h, modelReview);
  let manifest: Awaited<ReturnType<typeof preparedManifestOf>>;
  let tools: readonly string[] = [];
  let observedTools: readonly string[] = [];
  let received = '';
  let roundRunRef: RunRef | null = null;
  try {
    const startStop = await driveReviewUntil(reviewRoot, h.select('k3-42-review', AG2B_WORK_TASK_ID), performs('start'));
    const prepared = preparedOf(startStop.stopped);
    roundRunRef = prepared.claim.runRef;
    // The instruction half: the whole prepared manifest through the PUBLIC
    // `materials/open` route (ruling 6; never a direct SQLite/artifact open).
    manifest = await preparedManifestOf(h, prepared.envelope.bundleRef);
    // The grant stays the persisted L13 envelope.
    tools = prepared.envelope.permissions.tools;
    if (manifest.unknownCallReview === undefined) throw new Error('the review instruction is missing');

    await reviewRoot.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
      requestId: `k3-42-review-start-${tag}` });
    const ended = await readExecution(h.host, roundRunRef);
    expect(ended.run).toMatchObject({ status: 'ended', outcome: 'completed' });
    // (a) What the MODEL received, from the scripted model's observed request.
    observedTools = modelReview.requests[0]?.tools.map(tool => tool.name) ?? [];
    received = JSON.stringify(modelReview.requests);
  } finally {
    await reviewRoot.close();
  }
  expect(roundRunRef).not.toBeNull();
  if (roundRunRef === null) throw new Error('the review round Run is unknown');

  const concluded = await reviewOf(h, preparedA.claim.runRef);
  expect(concluded.status).toBe('ready');
  if (concluded.status !== 'ready') throw new Error('the concluded review did not read');
  expect(concluded.value.items[0]!.observed).toMatchObject({ verdict: 'done', by: 'review_round',
    crashSuspicion: { verdict: crashVerdict } });

  // --- The real settle_review step. ----------------------------------------
  const settled = await h.advance(h.select('k3-42-settle', AG2B_WORK_TASK_ID), { stopBefore: performs('requeue_task') });
  expect(settled.receipts.map(receipt => receipt.kind)).toContain('settle_review');
  expect(settled.receipts.map(receipt => receipt.kind)).not.toContain('open_checks');

  const afterSettle = await reviewOf(h, preparedA.claim.runRef);
  expect(afterSettle.status).toBe('ready');
  if (afterSettle.status !== 'ready') throw new Error('the settled review did not read');
  return { h, reviewRef: preparedA.claim.runRef, roundRunRef, display: manifest.unknownCallReview.items[0]?.display,
    tools, input: manifest.input, observedTools, received,
    beforeSettle: concluded.value, afterSettle: afterSettle.value };
}

/** Case (一): the model writes `done` / `unlikely` for a `truncated` command. */
describe('K3-42 (一) a truncated >4 KiB command is re-judged at settlement', () => {
  it('K3-42 (一): the review instruction shows display truncated with the D6 sentence and no Kernel-history tool; the model writes done/unlikely; settlement records undetermined/done kept and needs_decision', async () => {
    const chain = await runRealChain('unlikely');
    const { tools, input, display, observedTools, received, afterSettle, roundRunRef } = chain;

    // The instruction: display truncated + the exact D6 sentence + L13 tools.
    expect(display).toBe('truncated');
    expect(input).toContain(D6_SENTENCE);
    expect(tools).toEqual(['read', 'run_readonly_command', 'record_unknown_call_review']);
    expect(tools.some(tool => /kernel|history|graph|shell|edit/i.test(tool))).toBe(false);
    // What the MODEL received (ruling 6): the D6 sentence and the item line,
    // and the granted L13 tools with no Kernel-history tool.
    expect(received).toContain(D6_SENTENCE);
    expect(received).toContain('- #1 shell');
    expect(observedTools).toEqual(expect.arrayContaining(
      ['read', 'run_readonly_command', 'record_unknown_call_review']));
    expect(observedTools.some(tool => /kernel|history|graph|shell|edit/i.test(tool))).toBe(false);

    // The settlement re-judges both conclusions and keeps the model text.
    expect(afterSettle.status).toBe('needs_decision');
    expect(afterSettle.decisionReasons).toContain('undetermined');
    expect(afterSettle.decisionReasons).toContain('crash_undetermined');
    expect(afterSettle.decisionReasons).not.toContain('crash_possible');
    expect(afterSettle.items[0]!.observed).toMatchObject({
      verdict: 'undetermined', by: 'settlement', evidence: D6_EVIDENCE,
      crashSuspicion: { verdict: 'undetermined', evidence: D6_SELF_CHECK_EVIDENCE },
      reviewerConclusion: { verdict: 'done', evidence: MODEL_EVIDENCE,
        crashSuspicion: { verdict: 'unlikely', evidence: MODEL_CRASH_UNLIKELY } },
    });
    // The writing round is preserved on the re-judged observation.
    expect(afterSettle.items[0]!.observed).toMatchObject({ roundRunRef: { runId: roundRunRef.runId } });
    // (一) the re-judged record's card is in the queue and pins this record.
    await expectSettledReviewCard(chain.h, afterSettle, { crashVerdict: 'unlikely',
      crashEvidence: MODEL_CRASH_UNLIKELY });
  }, 240_000);
});

/** Case (三): the model writes `possible` instead of `unlikely`. */
describe('K3-42 (三) a truncated command self-check is re-judged even when the model writes possible', () => {
  it('K3-42 (三): the model writes possible for the truncated command; the crash self-check is still undetermined, reasons contain crash_undetermined not crash_possible, and the possible text stays in reviewerConclusion', async () => {
    const chain = await runRealChain('possible');
    const { afterSettle, display, input, observedTools, received } = chain;

    expect(display).toBe('truncated');
    expect(input).toContain(D6_SENTENCE);
    expect(received).toContain(D6_SENTENCE);
    expect(observedTools.some(tool => /kernel|history|graph|shell|edit/i.test(tool))).toBe(false);
    expect(afterSettle.status).toBe('needs_decision');
    expect(afterSettle.decisionReasons).toContain('undetermined');
    expect(afterSettle.decisionReasons).toContain('crash_undetermined');
    expect(afterSettle.decisionReasons).not.toContain('crash_possible');
    expect(afterSettle.items[0]!.observed).toMatchObject({
      verdict: 'undetermined', by: 'settlement', evidence: D6_EVIDENCE,
      crashSuspicion: { verdict: 'undetermined', evidence: D6_SELF_CHECK_EVIDENCE },
      reviewerConclusion: { verdict: 'done', evidence: MODEL_EVIDENCE,
        crashSuspicion: { verdict: 'possible', evidence: MODEL_CRASH_POSSIBLE } },
    });
    // (三) the card is in the queue; the model's "possible" text stays visible
    // at the card's pinned revision while the reasons are the re-judged ones.
    await expectSettledReviewCard(chain.h, afterSettle, { crashVerdict: 'possible',
      crashEvidence: MODEL_CRASH_POSSIBLE });
  }, 240_000);
});
