/**
 * K3 row K3-16 (L18/L20, UCR-12/UCR-13, K3-46 (二)): the `awaiting_approval`
 * card and its application through B1's ONE decision path.
 *
 * Every setup step is public (rework item 5): the record is the ONE real blocked
 * record (`createK3PendingReview`: real claim/prepare/Runtime start with §5.1's
 * shell stand-in, the production RUN-20/RUN-22 read of that Kernel Turn and the
 * Runtime's own end), settled to `needs_decision` by the real
 * `settleReview{review_unavailable}`, the `safer_method` answer from
 * `resolveDecision`, the proposal round from the real review claim
 * (`claimK3ReviewRound`), its one proposal from the real `propose_safer_method`
 * tool driven by the scripted fixture model (`writeK3Proposals`), and the
 * `awaiting_approval` state from the Run's completed end plus the real
 * `settleReview`. No state transition, item or proposal is hand-injected. The
 * `awaiting_approval` card is then read from the real card source and answered
 * through `resolveDecision`: that answer is the code under test.
 *
 * The mixed two-process + one-platform display is a projection the real serial
 * path cannot produce with one Kernel Turn; it lives in the pure renderer test
 * (`tests/runtime/K3-16-review-extremes-pure.test.ts`).
 *
 * Every real-record row runs on memory and SQLite: the shared Host recognition
 * path reads the world's own backend (the SQLite ledger or its ONE in-memory
 * backend), so both reach the same real record.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreRejection, WriteResult } from '../../src/contracts/core/results.js';
import type { SaferMethodProposalV1, UnknownCallReviewItemV1, UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { unknownCallReviewChangedEventFromEvent } from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import {
  answerK3Disposition, claimK3ReviewRound, createK3PendingReview, endK3RunCompleted, endK3RunUnfinished,
  openK3ReviewCardWorld, readK3Review, readK3ReviewCard,
  recordK3Conclusion, settleK3Review, writeK3Proposals,
  type K3ReviewCardWorld,
} from '../helpers/K3-proposal-round.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';

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

/** One real record world of `kind`; the production Kernel reader serves the blocked command. */
async function openWorld(kind: 'memory' | 'sqlite'): Promise<K3ReviewCardWorld> {
  const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
  worlds.push(world);
  return world;
}

type ReviewCard = Awaited<ReturnType<typeof readK3ReviewCard>>['card'];

/** The real proposal for the record's one process item; the command is distinctive. */
function saferCommand(_item: UnknownCallReviewItemV1): string {
  return 'npm run build:safer\nnpm run test:safer';
}

async function resolveOption(
  world: K3ReviewCardWorld, card: ReviewCard, optionId: string, requestId: string, text = '',
) {
  return await world.decisionActions.resolveDecision(world.fixture.ctx, {
    input: { source: card.source, selection: { kind: 'option', optionId },
      text, annotations: [] },
    meta: { requestId, expected: card.source.pins },
  });
}

type CommittedReview = Extract<WriteResult<UnknownCallReviewV1>, { status: 'committed' }>;

async function committedAction(
  result: Awaited<ReturnType<typeof resolveOption>>,
): Promise<CommittedReview> {
  expect(result).toMatchObject({ status: 'ready', value: { state: 'applied' } });
  if (result.status !== 'ready') throw new Error(`the answer did not apply: ${JSON.stringify(result)}`);
  const action = result.value.action as WriteResult<UnknownCallReviewV1> | CoreRejection | null;
  if (action === null || action.status !== 'committed') {
    throw new Error(`the answer must commit: ${JSON.stringify(action)}`);
  }
  return action;
}

type ApprovalSetup = {
  world: K3ReviewCardWorld;
  /** The committed `awaiting_approval` record. */
  awaiting: UnknownCallReviewV1;
  /** The card read from the real source at the `awaiting_approval` revision. */
  card: ReviewCard;
  cardKey: string;
  availability: 'available' | 'not_available';
  proposals: SaferMethodProposalV1[];
  saferText: string;
  /** The FIRST (disposition) card, now stale; used for the identity test. */
  dispositionCard: ReviewCard;
};

/** The public proposal round: real claim -> tool proposal -> completed end -> real settlement. */
async function completeProposalRound(
  world: K3ReviewCardWorld, proposed: UnknownCallReviewV1,
): Promise<{ record: UnknownCallReviewV1; proposals: SaferMethodProposalV1[] }> {
  const round = await claimK3ReviewRound(world, proposed, { phase: 'proposal' });
  const written = await writeK3Proposals(world, round, { mode: 'tool', commandFor: saferCommand });
  await endK3RunCompleted(world, round.claim);
  const settled = await settleK3Review(world, written.record);
  return { record: settled, proposals: settled.proposals };
}

/**
 * The shared setup: one real blocked `pending_review` record with ONE process
 * command, moved to `awaiting_approval` by the public chain above.
 */
async function approvalSetup(kind: 'memory' | 'sqlite'): Promise<ApprovalSetup> {
  const world = await openWorld(kind);
  const saferText = '换个稳妥的跑法，别跑原命令';
  const created = await createK3PendingReview(world, {
    label: 'k3-16-approval', command: 'npm run build\nnpm run test', callId: 'k3-16-process-1',
  });
  expect(created).toMatchObject({ status: 'pending_review' });
  expect(created.items).toHaveLength(1);
  // UCR-08c on the pending record (no active round): needs_decision, and the
  // one disposition/proposal target is fixed for this record.
  const dispositionRecord = await settleK3Review(world, created, { cause: 'review_unavailable' });
  expect(dispositionRecord).toMatchObject({ status: 'needs_decision' });
  expect(dispositionRecord.proposalTargets).toEqual([dispositionRecord.items[0]!.callId]);
  expect(dispositionRecord.dispositionTargets).toEqual([dispositionRecord.items[0]!.callId]);
  const dispositionRead = await readK3ReviewCard(world, dispositionRecord);
  const applied = await answerK3Disposition(world, dispositionRecord, 'safer_method', { text: saferText });
  expect(applied).toMatchObject({ status: 'awaiting_proposal' });

  const { record: awaiting, proposals } = await completeProposalRound(world, applied);
  expect(awaiting.status).toBe('awaiting_approval');
  const read = await readK3ReviewCard(world, awaiting);
  return { world, awaiting, card: read.card, cardKey: read.key, availability: read.availability,
    proposals, saferText, dispositionCard: dispositionRead.card };
}

/**
 * A clean (not mixed, not inventory-incomplete) record driven to
 * `awaiting_approval`. The one process item first gets a real review-round
 * conclusion (`done`/`unlikely`) through the public conclusion owner; its Run
 * ends unfinished and the record settles `review_unavailable`, so the item
 * stays concluded and the later declined card has exactly `proposal_declined`.
 * With `targetRounds = 7` the next card has one free slot and only three
 * options (L18); extra rounds come from real decline -> `safer_method` answers.
 */
async function cleanAwaitingApproval(kind: 'memory' | 'sqlite', targetRounds = 2): Promise<ApprovalSetup> {
  const world = await openWorld(kind);
  const saferText = '稳妥跑法，不跑原命令';
  const created = await createK3PendingReview(world, {
    label: 'k3-16-clean', command: 'npm run build', callId: 'k3-16-process-clean',
  });
  expect(created.status).toBe('pending_review');
  const reviewRound = await claimK3ReviewRound(world, created, { phase: 'review' });
  await recordK3Conclusion(world, reviewRound, {
    item: 1, verdict: 'done', evidence: 'the command completed',
    crashSuspicion: { verdict: 'unlikely', evidence: 'no crash' },
  });
  await endK3RunUnfinished(world, reviewRound.claim);
  const unfinished = await settleK3Review(world, await readK3Review(world, created.ref));
  expect(unfinished).toMatchObject({ status: 'pending_review', activeRound: null });
  const dispositionRecord = await settleK3Review(world, unfinished, { cause: 'review_unavailable' });
  expect(dispositionRecord).toMatchObject({ status: 'needs_decision' });
  const dispositionRead = await readK3ReviewCard(world, dispositionRecord);
  const applied = await answerK3Disposition(world, dispositionRecord, 'safer_method', { text: saferText });
  expect(applied).toMatchObject({ status: 'awaiting_proposal' });

  let { record: awaiting, proposals } = await completeProposalRound(world, applied);
  while (awaiting.rounds.length < targetRounds) {
    const declined = await answerK3Disposition(world, awaiting, 'decline');
    expect(declined).toMatchObject({ status: 'needs_decision' });
    const reApplied = await answerK3Disposition(world, declined, 'safer_method', { text: saferText });
    ({ record: awaiting, proposals } = await completeProposalRound(world, reApplied));
  }
  expect(awaiting).toMatchObject({ status: 'awaiting_approval' });
  expect(awaiting.rounds).toHaveLength(targetRounds);
  const read = await readK3ReviewCard(world, awaiting);
  return { world, awaiting, card: read.card, cardKey: read.key, availability: read.availability,
    proposals, saferText, dispositionCard: dispositionRead.card };
}

describe('K3-16 approval card (L18/L20, K3-46 (二))', () => {
  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: awaiting_approval is available, offers approve/decline and lists the commands in full',
    async kind => {
    const setup = await approvalSetup(kind);
    const { world, awaiting, card } = setup;
    expect(awaiting.status).toBe('awaiting_approval');

    // The source and the read model both see a live, answerable card.
    expect(setup.availability).toBe('available');
    const queue = await world.readModel.queryDecisionQueue(world.fixture.ctx, {
      workspace: WORKSPACE_SCOPE, sections: ['waiting_answer'], page: { limit: 100 },
    });
    expect(queue).toMatchObject({ status: 'ready' });
    if (queue.status !== 'ready') return;
    const readCard = queue.value.waitingAnswer.find(entry => entry.source.key === setup.cardKey);
    expect(readCard, 'the awaiting_approval card is in the queue').toBeDefined();
    expect(readCard).toMatchObject({
      state: 'waiting_answer', readOnly: false, actions: ['answer'],
      options: [
        // F-026: the card's fixed option labels, written out.
        { id: 'approve', label: '同意', effect: 'apply' },
        { id: 'decline', label: '不同意', effect: 'apply' },
      ],
    });
    expect(queue.value.capabilities)
      .toContainEqual({ source: 'unknown_call_review', availability: 'available' });

    // K3-46 (二): the one free text lists the original command (alias order)
    // and the literal L20 approved-method block. Only the run id is dynamic.
    const summary = card.objects[0]?.label ?? '';
    const expectedSummary = [
      `核对记录 ${awaiting.runRef.runId.slice(0, 8)}：需要你决定`,
      '- 原命令 #1：npm run build',
      '  npm run test',
      '- 方案 #1，目录 .：',
      '  npm run build:safer',
      '  npm run test:safer',
    ].join('\n');
    expect(summary).toBe(expectedSummary);
    expect(summary.startsWith(`核对记录 ${awaiting.runRef.runId.slice(0, 8)}：需要你决定\n`)).toBe(true);
    expect(summary).toContain('- 原命令 #1：npm run build\n  npm run test');
    expect(summary).toContain('- 方案 #1，目录 .：\n  npm run build:safer\n  npm run test:safer');
    // The proposed command is listed in full, never clipped (only the
    // continuation's `\n` + two-space indentation is added).
    expect(summary).toContain('npm run build:safer\n  npm run test:safer');
    expect(card.objects[0]).toMatchObject({ kind: 'aggregate', label: summary });
  });
});

describe('K3-16 approval application (UCR-12)', () => {
  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: approve resolves with the approved method, keeps the safer-method text and replays',
    async kind => {
    const setup = await approvalSetup(kind);
    const { world, awaiting, card, proposals, saferText } = setup;
    const answerText = '同意，照方案原样跑';
    const result = await resolveOption(world, card, 'approve', 'k3-16-approval-approve', answerText);
    const action = await committedAction(result);
    expect(action.replayed).toBe(false);
    const committed = action.value;

    // L19a: approve writes one blockedCommands entry per proposalTarget, whose
    // command text, whole-normalised sha256 and parsed action sha256s are read
    // from the REAL Kernel Turn by the production reader (no test-written map).
    const fact = {
      commandSha256: 'c519390072249b58dbdd2be2b5d5b71ad0f5ff0fc58dab35a6a020faf2c004fd',
      actions: [
        { text: 'npm run build', sha256: '9adf315bbd4238afbdfe1554bc58cc5a41b1dcd01b14668a68ba9cde3b462993' },
        { text: 'npm run test', sha256: '7586947f694b0536a359c8db8dd76d5233e45c5cab46456f67c8204d7555069f' },
      ],
      // The real run-script expansion reads the fixture workspace, which has
      // no package.json: each action records the real `unavailable` basis.
      expansions: [
        { action: 'npm run build', scriptName: 'build', scriptText: '', actions: [],
          basis: { status: 'unavailable', reason: 'the K3 fixture has no package.json' } },
        { action: 'npm run test', scriptName: 'test', scriptText: '', actions: [],
          basis: { status: 'unavailable', reason: 'the K3 fixture has no package.json' } },
      ],
    };
    const item = awaiting.items[0]!;
    expect(committed).toMatchObject({
      status: 'resolved', revision: awaiting.revision + 1,
      blockedCommands: [{
        reviewRunId: awaiting.runRef.runId, alias: item.alias,
        commandSha256: fact.commandSha256,
        kernelCallRef: item.kernel,
        actions: fact.actions,
        expansions: fact.expansions, truncated: false,
      }],
      disposition: {
        choice: 'safer_method',
        // Lead answer 6: the approval answer does NOT replace the note text.
        text: saferText,
        annotations: [],
        approval: { decision: 'approve', answeredRevision: awaiting.revision },
      },
    });
    expect(committed.disposition?.answerMessageRef).not.toBeNull();
    expect(committed.disposition?.approval?.answerMessageRef).not.toEqual(committed.disposition?.answerMessageRef);
    // The approval answer's own text stays in its Session message (lead answer 6).
    const approvalAnswer = await world.decisions.readDecisionAnswer(world.fixture.ctx, { source: card.source });
    expect(approvalAnswer).toMatchObject({ status: 'ready', value: { body: { text: answerText } } });
    if (approvalAnswer.status === 'ready') {
      expect(approvalAnswer.value.message?.ref).toEqual(committed.disposition?.approval?.answerMessageRef);
    }
    expect(committed.disposition?.approvedMethods).toEqual(
      [...proposals].sort((left, right) => left.alias - right.alias).map(proposal => ({
        proposalId: proposal.proposalId, callId: proposal.callId, alias: proposal.alias,
        command: proposal.command, cwd: proposal.cwd,
      })),
    );

    // One `approval_applied` event carrying the SAME DecisionChangeProofV1 shape.
    const located = await world.records.eventAt(action.cursor);
    expect(located).toMatchObject({ status: 'ready' });
    if (located.status !== 'ready') return;
    const decoded = unknownCallReviewChangedEventFromEvent(located.value.event);
    expect(decoded).toMatchObject({ status: 'decoded' });
    if (decoded.status !== 'decoded') return;
    expect(decoded.value).toMatchObject({ change: 'approval_applied', review: {
      status: 'resolved', revision: awaiting.revision + 1 } });
    expect(decoded.value.proof).toBeDefined();
    expect(decoded.value.proof).toMatchObject({
      acknowledgementRef: committed.disposition?.approval?.answerMessageRef,
      capturedPins: card.source.pins,
      changes: [{ before: { ref: awaiting.ref, revision: awaiting.revision },
        after: { ref: awaiting.ref, revision: awaiting.revision + 1 } }],
      basisRebases: [],
    });

    // Replaying the same answer returns the ORIGINAL receipt and writes nothing.
    const commits = world.fixture.counts.commits;
    const replayed = await resolveOption(world, card, 'approve', 'k3-16-approval-approve', answerText);
    expect(replayed).toMatchObject({ status: 'ready', value: { state: 'applied' } });
    if (replayed.status !== 'ready') return;
    expect(replayed.value.action).toEqual({ ...action, replayed: true });
    expect(world.fixture.counts.commits).toBe(commits);
    const after = await world.reviews.readReview(world.fixture.ctx, { ref: awaiting.ref });
    expect(after).toMatchObject({ status: 'ready', value: { revision: awaiting.revision + 1,
      status: 'resolved', disposition: { choice: 'safer_method', text: saferText } } });
  });
});

describe('K3-16 approval decline (UCR-13)', () => {
  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: decline returns to needs_decision with proposal_declined and the four-option card',
    async kind => {
    const setup = await cleanAwaitingApproval(kind);
    const { world, awaiting, card, saferText } = setup;
    const result = await resolveOption(world, card, 'decline', 'k3-16-approval-decline', '不同意这版方案');
    const action = await committedAction(result);
    const committed = action.value;

    expect(committed).toMatchObject({
      status: 'needs_decision', revision: awaiting.revision + 1,
      // Exactly the one L17 reason this state adds; the concluded item adds none.
      decisionReasons: ['proposal_declined'],
      disposition: {
        choice: 'safer_method',
        // Lead answer 6: the approval answer never replaces the note text.
        text: saferText,
        approval: { decision: 'decline', answeredRevision: awaiting.revision },
        approvedMethods: null,
      },
    });
    expect(committed.disposition?.approval?.answerMessageRef).not.toBeNull();
    expect(committed.disposition?.answerMessageRef).not.toBeNull();
    expect(committed.disposition?.approval?.answerMessageRef)
      .not.toEqual(committed.disposition?.answerMessageRef);

    // The declined event still carries the same proof shape.
    const located = await world.records.eventAt(action.cursor);
    expect(located).toMatchObject({ status: 'ready' });
    if (located.status !== 'ready') return;
    const decoded = unknownCallReviewChangedEventFromEvent(located.value.event);
    expect(decoded).toMatchObject({ status: 'decoded' });
    if (decoded.status !== 'decoded') return;
    expect(decoded.value).toMatchObject({
      change: 'approval_applied',
      review: { status: 'needs_decision', decisionReasons: ['proposal_declined'],
        disposition: { approvedMethods: null } },
    });
    expect(decoded.value.proof).toMatchObject({
      acknowledgementRef: committed.disposition?.approval?.answerMessageRef,
      changes: [{ before: { ref: awaiting.ref, revision: awaiting.revision },
        after: { ref: awaiting.ref, revision: awaiting.revision + 1 } }],
    });

    // The next card is the ordinary four-option disposition card again.
    const next = await readK3ReviewCard(world, committed);
    expect(next.availability).toBe('available');
    expect(next.card.options.map(option => option.id))
      .toEqual(['rerun_as_is', 'safer_method', 'skip_as_done', 'handle_myself']);
  });

  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: when the round slots are used up, the declined card has only three options',
    async kind => {
    // Seven rounds leave exactly one free slot, so L18 drops `safer_method`
    // from the next card. Extra rounds come from real decline -> safer_method
    // answers above (the first round is the real review round that concludes
    // the item).
    const setup = await cleanAwaitingApproval(kind, 7);
    const result = await resolveOption(setup.world, setup.card, 'decline',
      'k3-16-approval-decline-full', '不同意');
    const committed = (await committedAction(result)).value;
    expect(committed).toMatchObject({ status: 'needs_decision',
      decisionReasons: ['proposal_declined'], disposition: { approvedMethods: null } });
    expect(committed.rounds).toHaveLength(7);
    const next = await readK3ReviewCard(setup.world, committed);
    expect(next.card.options.map(option => option.id))
      .toEqual(['rerun_as_is', 'skip_as_done', 'handle_myself']);
    // An option the three-option card does not offer is `invalid`.
    const rejected = await resolveOption(setup.world, next.card, 'safer_method',
      'k3-16-approval-decline-full-safer');
    expect(rejected).toMatchObject({ status: 'rejected', code: 'invalid' });
  }, 120_000);
});

describe('K3-16 approval identity and revision (L19)', () => {
  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: answering the old disposition card is revision_conflict and writes nothing',
    async kind => {
    const setup = await approvalSetup(kind);
    const commits = setup.world.fixture.counts.commits;
    const stale = await resolveOption(setup.world, setup.dispositionCard, 'safer_method',
      'k3-16-approval-old-disposition', '再答一次旧卡');
    expect(stale).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(setup.world.fixture.counts.commits).toBe(commits);
    const after = await setup.world.reviews.readReview(setup.world.fixture.ctx, { ref: setup.awaiting.ref });
    expect(after).toMatchObject({ status: 'ready', value: { revision: setup.awaiting.revision,
      status: 'awaiting_approval' } });
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: an approval answer captured before the record moved is revision_conflict in ② and writes nothing',
    async kind => {
      const setup = await approvalSetup(kind);
      const answered = await setup.world.decisions.answerDecision(setup.world.fixture.ctx, {
        input: { source: setup.card.source, selection: { kind: 'option', optionId: 'approve' },
          text: '', annotations: [] },
        meta: { requestId: 'k3-16-approval-stale-answer', expected: setup.card.source.pins },
      });
      expect(answered).toMatchObject({ status: 'committed' });
      if (answered.status !== 'committed') return;
      // A real human "I'll handle it" moves the record before the answer lands.
      const held = await setup.world.reviews.holdReview(setup.world.fixture.ctx, {
        input: { reviewRef: setup.awaiting.ref, text: 'I handle it now' },
        meta: { requestId: 'k3-16-approval-stale-hold',
          expected: [{ ref: setup.awaiting.ref, revision: setup.awaiting.revision }] },
      });
      expect(held).toMatchObject({ status: 'committed', value: {
        revision: setup.awaiting.revision + 1, status: 'resolved' } });
      const commits = setup.world.fixture.counts.commits;
      // UR7's path reaches ② without ①; the captured source/revision checks stay.
      const advanced = await setup.world.decisionActions.advanceReviewDisposition(setup.world.fixture.ctx, {
        input: { source: setup.card.source, selection: { kind: 'option', optionId: 'approve' },
          decisionMessageRef: answered.value.ref },
        meta: { requestId: 'k3-16-approval-stale-advance', expected: setup.card.source.pins },
      });
      expect(advanced).toMatchObject({ status: 'ready', value: {
        state: 'application_not_recorded', application: null,
        action: { status: 'rejected', code: 'revision_conflict' } } });
      expect(setup.world.fixture.counts.commits).toBe(commits);
    }, 120_000);

  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: an option that is not on the approval card is invalid and writes nothing',
    async kind => {
    const setup = await approvalSetup(kind);
    const commits = setup.world.fixture.counts.commits;
    for (const optionId of ['safer_method', 'rerun_as_is']) {
      const result = await resolveOption(setup.world, setup.card, optionId,
        `k3-16-approval-not-on-card-${optionId}`);
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    }
    expect(setup.world.fixture.counts.commits).toBe(commits);
  }, 120_000);
});
