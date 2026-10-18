/**
 * K3 row K3-16 approval, end to end (L18/L20, UCR-12): the REAL proposal round
 * reaches `awaiting_approval`, the person approves its card through the public
 * `decisions/answer` route, and the next continuation's prepared brief carries
 * the approved-method block.
 *
 * The record comes from the shared real card round (`needsDecisionCard`: one
 * crashed `shell` call -> RUN-25 -> one review round writes `partial` ->
 * `settle_review` gives the four-option card). `safer_method` is answered with a
 * note and one annotation; the real proposal phase claims and starts a round on
 * the read-only composition root, whose scripted model calls
 * `propose_safer_method` for the one `proposalTargets` item; settlement reaches
 * `awaiting_approval`. The approval card is read from the public queue, answered
 * `approve`, and the continuation is prepared and rendered exactly as K3-17
 * reads it.
 *
 * One crash yields exactly one `process` item, so this record is not mixed: the
 * mixed-card summary and the platform line are covered by
 * `tests/work-graph/K3-16-approval-application.test.ts` (K3-46 (二)).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { cleanupScenarios, HostScenario, hostCtx, performs } from './harness.js';
import { answerCard, needsDecisionCard, queueOf, reviewOf } from './support/review-card-round.js';
import { preparedOf, redrivePolicy } from './support/common.js';
import { preparedBriefOf } from './support/brief.js';
import { driveReviewUntil, openReviewWorkRoot } from './support/review-work-root.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { cleanupRestart } from '../helpers/A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, AG2B_SCOPE, AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import {
  continuationBriefDigest, renderContinuationBriefZh,
} from '../../src/contracts/continuation-brief.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { DecisionAnnotationV1 } from '../../src/contracts/goal-decisions.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';

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

const NOTE = '这是人写的附言：按下面的命令跑，不要跑原命令。';
const ANNOTATION_TEXT = '这条命令原样跑过，别再跑';
const NEW_COMMAND = 'npm test -- --run --reporter=dot';
const APPROVE_TEXT = '同意这版方案';

/** The card's aggregate object canonical key (the answer annotation's objectKey). */
function aggregateKeyOf(card: DecisionCardV1): string {
  const object = card.objects.find(entry => entry.kind === 'aggregate');
  if (object === undefined) throw new Error('the card has no aggregate object');
  return canonicalJson(object as never);
}

function approvalCardOf(queue: DecisionQueueReadV1, revision: number): DecisionCardV1 {
  const cards = queue.waitingAnswer.filter(card => card.source.kind === 'unknown_call_review');
  expect(cards).toHaveLength(1);
  const card = cards[0]!;
  expect(card.source.pins[0]).toMatchObject({ revision });
  return card;
}

describe('K3-16 the real approval round and its continuation', () => {
  it('K3-16: approve on the real awaiting_approval card resolves the record and the continuation carries the approved methods', async () => {
    const h = await HostScenario.open({ gitWorkspace: true, automation: redrivePolicy(false), check: 'pass' });
    const { originalRunRef, record, card } = await needsDecisionCard(h, 'k3-16-approval-e2e');
    expect(record.proposalTargets).toEqual([record.items[0]!.callId]);
    expect(record.dispositionTargets).toEqual([record.items[0]!.callId]);

    // ①/②/③: answer `safer_method` with a note and one annotation on the record object.
    const answered = await answerCard(h, card, 'safer_method', 'k3-16-approval-e2e-answer', NOTE,
      [{ objectKey: aggregateKeyOf(card), text: ANNOTATION_TEXT } as DecisionAnnotationV1]);
    expect(answered, JSON.stringify(answered)).toMatchObject({ status: 'ready', value: { state: 'applied' } });
    expect(await reviewOf(h, originalRunRef)).toMatchObject({
      status: 'ready', value: { status: 'awaiting_proposal', activeRound: null, proposals: [],
        disposition: { choice: 'safer_method', source: 'card', text: NOTE,
          annotations: [{ path: null, text: ANNOTATION_TEXT }] } },
    });

    // The real proposal phase writes the one proposal for the one target.
    const proposalModel = createScriptedModel([
      { kind: 'calls', calls: [{ callId: 'k3-16-approval-e2e-proposal', name: 'propose_safer_method',
        args: { item: 1, command: NEW_COMMAND, cwd: '.', rationale: 'run the tests serially instead' } }] },
      { kind: 'text', text: 'k3-16 approval proposal round finished' },
    ]);
    const proposalRoot = await openReviewWorkRoot(h, proposalModel);
    try {
      const stop = await driveReviewUntil(proposalRoot,
        h.select('k3-16-approval-e2e-proposal', AG2B_WORK_TASK_ID), performs('start'));
      const prepared = preparedOf(stop.stopped);
      expect(prepared.envelope.permissions.tools)
        .toEqual(['read', 'run_readonly_command', 'propose_safer_method']);
      const started = await proposalRoot.runtime.startRun(hostCtx(), { prepared, consumerId: AG2B_CONSUMER_ID,
        requestId: 'k3-16-approval-e2e-proposal-start' });
      expect(started).toMatchObject({ status: 'ready' });
    } finally {
      await proposalRoot.close();
    }

    const settled = await h.advance(h.select('k3-16-approval-e2e-settle', AG2B_WORK_TASK_ID),
      { stopBefore: performs('requeue_task') });
    expect(settled.receipts.map(receipt => receipt.kind)).toContain('settle_review');

    const awaiting = await reviewOf(h, originalRunRef);
    expect(awaiting.status).toBe('ready');
    if (awaiting.status !== 'ready') throw new Error(JSON.stringify(awaiting));
    expect(awaiting.value).toMatchObject({
      status: 'awaiting_approval', open: 'yes', activeRound: null, decisionReasons: [],
      dispositionTargets: [record.items[0]!.callId],
      proposals: [{ alias: 1, callId: record.items[0]!.callId, command: NEW_COMMAND, cwd: '.',
        rationale: 'run the tests serially instead' }],
    });
    const proposal = awaiting.value.proposals[0]!;

    // L18/L20: the public approval card offers exactly approve/decline.
    const approvalCard = approvalCardOf(await queueOf(h), awaiting.value.revision);
    expect(approvalCard).toMatchObject({ state: 'waiting_answer', readOnly: false, actions: ['answer'],
      options: [
        { id: 'approve', label: '同意', effect: 'apply' },
        { id: 'decline', label: '不同意', effect: 'apply' },
      ] });
    const summary = approvalCard.objects.find(object => object.kind === 'aggregate')?.label ?? '';
    expect(summary).toContain(`- 原命令 #1：${record.items[0]!.summary.command}`);
    // F-026: the approved-method line is the literal L20 layout, not the
    // production renderer's output.
    expect(summary).toContain(`- 方案 #1，目录 .：\n  ${NEW_COMMAND}`);
    expect(summary).toContain(`- 方案 #1，目录 .：\n  ${NEW_COMMAND}`);
    // One crash gives one process item and no platform item, so this card is
    // not mixed; the mixed sentence belongs to the owner-level K3-46 (二) test.
    expect(summary).not.toContain('查不清的平台条目在接续说明里写');

    // UCR-12: approve through the public route, in the same call.
    const approvedAnswer = await answerCard(h, approvalCard, 'approve', 'k3-16-approval-e2e-approve',
      APPROVE_TEXT);
    expect(approvedAnswer, JSON.stringify(approvedAnswer))
      .toMatchObject({ status: 'ready', value: { state: 'applied' } });

    const resolved = await reviewOf(h, originalRunRef);
    expect(resolved.status).toBe('ready');
    if (resolved.status !== 'ready') throw new Error(JSON.stringify(resolved));
    expect(resolved.value).toMatchObject({
      status: 'resolved', open: 'no', activeRound: null, decisionReasons: [],
      // L19a: approve writes the ORIGINAL crash command as one blocked entry.
      // The literal hashes are computed from the fixture's known command
      // (`<label> runs a program`); the identity fields are the production
      // record's own.
      blockedCommands: [{
        reviewRunId: originalRunRef.runId, alias: record.items[0]!.alias,
        commandSha256: '79dba946c60a8dcdaa6ae4a57de6d446516856dee2fe214b518b9dee3d6c6cc4',
        kernelCallRef: record.items[0]!.kernel,
        actions: [{ text: 'k3-16-approval-e2e runs a program',
          sha256: 'f0e89c8e28832e1f079024c20dbc7cf7600c035ac75deedaf9ead0d70cb19687' }],
        expansions: [], truncated: false,
      }],
      disposition: {
        choice: 'safer_method', source: 'card',
        text: NOTE,
        annotations: [{ path: null, text: ANNOTATION_TEXT }],
        approvedMethods: [{ proposalId: proposal.proposalId, callId: proposal.callId, alias: 1,
          command: NEW_COMMAND, cwd: '.' }],
        approval: { decision: 'approve', answeredRevision: awaiting.value.revision },
      },
    });
    const disposition = resolved.value.disposition!;
    expect(disposition.approval?.answerMessageRef).not.toBeNull();
    expect(disposition.approval?.answerMessageRef).not.toEqual(disposition.answerMessageRef);
    // The approval answer is a real Session message of its own (lead answer 6:
    // its text lives there, not in `disposition.text`).
    const approvalRef = disposition.approval!.answerMessageRef;
    const approvalMessage = await h.post<ReadResult<SessionMessage>>('messages/read',
      plain(AG2B_SCOPE, approvalRef));
    expect(approvalMessage).toMatchObject({ status: 'ready' });
    if (approvalMessage.status === 'ready') expect(approvalMessage.value.ref).toEqual(approvalRef);

    // The next selection requeues the Task and prepares the continuation; read
    // the prepared brief exactly as K3-17 does, before its start.
    const driven = await h.advance(h.select('k3-16-approval-e2e-next', AG2B_WORK_TASK_ID),
      { stopBefore: performs('start') });
    expect(driven.receipts.map(receipt => receipt.kind)).toContain('requeue_task');
    const next = driven.next;
    if (next === null) throw new Error('the continuation must stop before its start');
    const prepared = preparedOf(next);
    const brief = await preparedBriefOf(h, prepared.envelope.bundleRef);
    const rendered = renderContinuationBriefZh(brief, continuationBriefDigest(brief));

    // L20: the disposition line, the mandatory approved-method block between
    // the targets line and (absent here) the platform line.
    expect(rendered).toContain(
      '- 处置：换个稳妥的跑法：不要跑原命令，照下面的方案原样跑（卡上选的）；附言：' + NOTE + '。');
    expect(rendered).toContain('- 作用对象：#1。');
    expect(rendered).toContain(`- 方案 #1，目录 .：\n  ${NEW_COMMAND}`);
    expect(rendered.indexOf('- 作用对象：#1。')).toBeLessThan(rendered.indexOf('- 方案 #1，目录 .：'));
    expect(rendered).not.toContain('- 平台条目');
    expect(brief.unknownCallReview?.disposition?.approvedMethods)
      .toEqual([{ alias: 1, command: NEW_COMMAND, cwd: '.' }]);
  }, 300_000);
});
