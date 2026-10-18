/**
 * K3 row K3-16 (L20, UCR-05/UCR-08, spec line 1437): the REAL proposal round.
 *
 * A real `needs_decision` card (RUN-25 -> review round -> `settle_review`) is
 * answered `safer_method` through the public `decisions/answer` route. The
 * Workflow then claims and prepares a proposal-phase round on the same
 * read-only-capable composition root (KE6 stand-in, no host process); its
 * scripted model calls `propose_safer_method` for the one `proposalTargets`
 * item and for an alias outside that set. Settlement reaches
 * `awaiting_approval` with the stored proposals, and the public decision queue
 * holds the approval card's source at the new revision.
 *
 * Second case: a proposal round that writes nothing settles `needs_decision`
 * with `proposal_missing` and the four-option card again.
 *
 * The card/approval answer (② `approval`) is the later C work and is not
 * asserted here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { answerCard, needsDecisionCard, queueOf, reviewOf } from './support/review-card-round.js';
import { preparedOf, redrivePolicy, toolOutputJson } from './support/common.js';
import { preparedManifestOf } from './support/brief.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, AG2B_WORK_TASK_ID } from '../helpers/AG2b-collaboration-fixture.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { DecisionAnnotationV1 } from '../../src/contracts/goal-decisions.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';

// The KE6 stand-in: `reviewCapability` and the read-only command both probe with
// the `read_only` workspace options; no host process runs.
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

// The blocking `shell` stand-in (K3 §5.1): keeps the call in flight until the crash.
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

const NOTE = '这是人写的附言：新命令要先跑测试再合并。';
const ANNOTATION_TEXT = '这条命令别再原样跑';

/** The card's aggregate object canonical key (the answer annotation's objectKey). */
function aggregateKeyOf(card: DecisionCardV1): string {
  const object = card.objects.find(entry => entry.kind === 'aggregate');
  if (object === undefined) throw new Error('the card has no aggregate object');
  return canonicalJson(object as never);
}

/** Answer `safer_method` on the real card, carrying the note and one annotation. */
async function answerSafer(h: HostScenario, card: DecisionCardV1, label: string): Promise<void> {
  const answered = await answerCard(h, card, 'safer_method', `${label}-answer`, NOTE,
    [{ objectKey: aggregateKeyOf(card), text: ANNOTATION_TEXT } as DecisionAnnotationV1]);
  expect(answered, JSON.stringify(answered)).toMatchObject({ status: 'ready', value: { state: 'applied' } });
}

function proposalCardOf(queue: DecisionQueueReadV1, record: UnknownCallReviewV1): DecisionCardV1 {
  const cards = queue.waitingAnswer.filter(card => card.source.kind === 'unknown_call_review');
  expect(cards).toHaveLength(1);
  const card = cards[0]!;
  expect(card.source.pins[0]).toMatchObject({ revision: record.revision });
  return card;
}

describe('K3-16 the real proposal round', () => {
  it('K3-16: an answered needs_decision card runs a proposal round whose tool writes the proposal, the round settles awaiting_approval and the queue holds the approval card source', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const { originalRunRef, record, card } = await needsDecisionCard(h, 'k3-16-case1');
    expect(record.proposalTargets).toEqual([record.items[0]!.callId]);

    await answerSafer(h, card, 'k3-16-case1');
    const awaiting = await reviewOf(h, originalRunRef);
    expect(awaiting).toMatchObject({ status: 'ready', value: { status: 'awaiting_proposal', activeRound: null,
      proposalTargets: [record.items[0]!.callId], proposals: [],
      disposition: { choice: 'safer_method', text: NOTE, annotations: [{ path: null, text: ANNOTATION_TEXT }] } } });

    const NEW_COMMAND = 'npm test -- --run\n  --reporter=dot';
    const model = createScriptedModel([
      { kind: 'calls', calls: [{ callId: 'k3-16-case1-write', name: 'propose_safer_method',
        args: { item: 1, command: NEW_COMMAND, cwd: '.', rationale: 'run the tests serially instead' } }] },
      // K3-46 (二) partial: an alias outside proposalTargets (here alias 2) is
      // invalid_arguments and writes nothing; the one real proposal is enough.
      { kind: 'calls', calls: [{ callId: 'k3-16-case1-outside', name: 'propose_safer_method',
        args: { item: 2, command: 'echo nope', cwd: null, rationale: 'not a proposal target' } }] },
      { kind: 'text', text: 'k3-16 the proposal round finished' },
    ]);
    const root = await openReviewWorkRoot(h, model);
    try {
      const stop = await driveReviewUntil(root, h.select('k3-16-case1-proposal', AG2B_WORK_TASK_ID), performs('start'));
      const prepared = preparedOf(stop.stopped);
      expect(prepared.envelope.permissions.tools)
        .toEqual(['read', 'run_readonly_command', 'propose_safer_method']);
      expect(prepared.envelope.permissions.writeScope).toEqual([]);

      const manifest = await preparedManifestOf(h, prepared.envelope.bundleRef);
      expect(manifest.unknownCallReview).toMatchObject({
        phase: 'proposal', targets: [1], personText: NOTE,
        annotations: [{ path: null, text: ANNOTATION_TEXT }], platformTargets: [],
      });
      expect(manifest.input).toContain('### 提方案');
      expect(manifest.input).toContain('- #1（shell）原命令：k3-16-case1 runs a program');
      expect(manifest.input).toContain(`- 附言：${NOTE}`);
      expect(manifest.input).toContain(`- 批注（记录）：${ANNOTATION_TEXT}`);
      expect(manifest.input).not.toContain('### 要核对的调用');

      const started = await root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-16-case1-proposal-start' });
      expect(started).toMatchObject({ status: 'ready' });

      // The tool result receives the write (receipt), and the outside alias is a
      // mapped invalid_arguments.
      expect(toolOutputJson(model.requests[1], 'k3-16-case1-write')).toMatchObject({
        status: 'committed', item: 1,
      });
      const outsideMessage = model.requests[2]?.messages.find(message =>
        message.role === 'tool' && message.callId === 'k3-16-case1-outside');
      expect(outsideMessage?.role === 'tool' && outsideMessage.result.status === 'error'
        ? outsideMessage.result.error.code : undefined).toBe('invalid_arguments');

      const written = await reviewOf(h, originalRunRef);
      expect(written).toMatchObject({ status: 'ready', value: { status: 'awaiting_proposal',
        proposals: [{ alias: 1, command: NEW_COMMAND, cwd: '.', rationale: 'run the tests serially instead' }] } });
    } finally {
      await root.close();
    }

    const settled = await h.advance(h.select('k3-16-case1-settle', AG2B_WORK_TASK_ID),
      { stopBefore: performs('requeue_task') });
    expect(settled.receipts.map(receipt => receipt.kind)).toContain('settle_review');

    const approved = await reviewOf(h, originalRunRef);
    expect(approved.status).toBe('ready');
    if (approved.status !== 'ready') throw new Error(JSON.stringify(approved));
    expect(approved.value).toMatchObject({
      status: 'awaiting_approval', open: 'yes', activeRound: null, decisionReasons: [],
      proposals: [{ alias: 1, command: NEW_COMMAND, cwd: '.', rationale: 'run the tests serially instead' }],
    });
    expect(approved.value.rounds.at(-1)).toMatchObject({ phase: 'proposal', result: 'finished' });

    // The next card is the approval card's SOURCE at this new revision. The
    // approve/decline labels are the later C work and are not asserted.
    const queue = await queueOf(h);
    const approvalCard = proposalCardOf(queue, approved.value);
    expect(approvalCard).toMatchObject({ state: 'waiting_answer', source: { kind: 'unknown_call_review' } });
    expect(approvalCard.source.pins[0]).toMatchObject({ revision: approved.value.revision });
  }, 300_000);

  it('K3-16: a proposal round that writes no proposal settles needs_decision with proposal_missing and the four-option card', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const { originalRunRef, record, card } = await needsDecisionCard(h, 'k3-16-case2');
    await answerSafer(h, card, 'k3-16-case2');

    const model = createScriptedModel([{ kind: 'text', text: 'k3-16 no proposal this round' }]);
    const root = await openReviewWorkRoot(h, model);
    try {
      const stop = await driveReviewUntil(root, h.select('k3-16-case2-proposal', AG2B_WORK_TASK_ID), performs('start'));
      const prepared = preparedOf(stop.stopped);
      expect(prepared.envelope.permissions.tools)
        .toEqual(['read', 'run_readonly_command', 'propose_safer_method']);
      await root.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-16-case2-proposal-start' });
    } finally {
      await root.close();
    }

    const settled = await h.advance(h.select('k3-16-case2-settle', AG2B_WORK_TASK_ID),
      { stopBefore: performs('requeue_task') });
    expect(settled.receipts.map(receipt => receipt.kind)).toContain('settle_review');

    const missing = await reviewOf(h, originalRunRef);
    expect(missing.status).toBe('ready');
    if (missing.status !== 'ready') throw new Error(JSON.stringify(missing));
    expect(missing.value).toMatchObject({ status: 'needs_decision', activeRound: null, proposals: [],
      decisionReasons: expect.arrayContaining(['proposal_missing']) });
    expect(missing.value.rounds.at(-1)).toMatchObject({ phase: 'proposal', result: 'finished' });

    const cardNow = proposalCardOf(await queueOf(h), missing.value);
    expect(cardNow.options.map(option => option.id))
      .toEqual(['rerun_as_is', 'safer_method', 'skip_as_done', 'handle_myself']);
  }, 300_000);
});
