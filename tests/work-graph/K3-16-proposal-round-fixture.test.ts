/**
 * K3 group 4 rework item 5 (L15/L16/L20, UCR-03/05/06/08): the smoke test of the
 * ONE shared `K3-proposal-round` fixture, on the real host-recognition path.
 *
 * It proves the fixture's public-step API, not a new production behaviour:
 *   (i) the real proposal claim opens `awaiting_proposal` + an active proposal
 *       round and the record's ONE real process target gets a scripted
 *       `propose_safer_method`;
 *   (ii) the Run's real completed end + `settleReview` reach `awaiting_approval`
 *       with the proposal stored;
 *   (iii) a first unfinished round keeps `awaiting_proposal` and clears
 *       `activeRound`;
 *   (iv) a second unfinished round settles to `needs_decision`
 *       (`review_incomplete`) even with the proposal present.
 *
 * The old multi-alias / platform-mixed / 12-item exact-size scenarios were
 * builder states the real serial path cannot produce; they moved to the PURE
 * renderer/codec test (`tests/runtime/K3-16-review-extremes-pure.test.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import {
  answerK3Disposition, claimK3ReviewRound, createK3PendingReview, endK3RunCompleted,
  endK3RunUnfinished, openK3ReviewCardWorld, reachK3AwaitingProposal, runK3ReviewRound,
  settleK3Review, writeK3Proposals,
  type K3ReviewCardWorld,
} from '../helpers/K3-proposal-round.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { readRunBoundary } from '../helpers/K3-35-continuation-fixture.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import type { RunRef } from '../../src/contracts/dispatch.js';

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

/** The public execution read of one Run (the Runtime's own stored result). */
async function readRun(world: K3ReviewCardWorld, ref: RunRef) {
  const read = await createRunStateReader({ records: world.records }).readExecution(world.fixture.ctx, ref);
  if (read.status !== 'ready') throw new Error(`the Run is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

/** The canonical Kernel cursor's payload (position `i`, read tail `u`). */
function cursorPayload(cursor: string): { i: number; u: number } {
  const payload = cursor.split('.')[1];
  if (payload === undefined) throw new Error(`not a canonical Kernel history cursor: ${cursor}`);
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { i: number; u: number };
}

/** A fresh world of `kind`; the shared Host recognition path reads either backend. */
async function world(kind: 'memory' | 'sqlite'): Promise<K3ReviewCardWorld> {
  const opened = await openK3ReviewCardWorld(kind);
  worlds.push(opened);
  return opened;
}

function proposalIds(record: { proposals: { callId: string }[] }): string[] {
  return record.proposals.map(proposal => proposal.callId).sort();
}

describe('K3 proposal-round fixture (K3-16, L20)', () => {
  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: claim -> scripted propose_safer_method -> completed end -> awaiting_approval', async kind => {
    const opened = await world(kind);
    const state = await reachK3AwaitingProposal(opened, {
      label: 'k3-16-normal', command: 'npm run build\nnpm run test', callId: 'k3-16-process-1',
    });

    // The ONE item is what the real Kernel Turn produced: process, shell, the
    // Kernel's own identity/positions and the draft's pending observation.
    expect(state.dispositionRecord.status).toBe('needs_decision');
    expect(state.dispositionRecord.disposition).toBeNull();
    expect(state.dispositionRecord.items).toHaveLength(1);
    const item = state.dispositionRecord.items[0]!;
    expect(item).toMatchObject({
      alias: 1, callId: 'k3-16-process-1', toolName: 'shell', kind: 'process', contained: true,
      summary: { command: 'npm run build\nnpm run test' },
      // The real settlement (`review_unavailable`, no review-round conclusion)
      // re-judges the process item `undetermined`, by settlement.
      observed: { verdict: 'undetermined', by: 'settlement' },
    });
    expect(item.kernel.kernelRunId).not.toBe('k3-proposal-kernel-run');
    expect(item.kernel.turnId).not.toBe('k3-proposal-turn');
    expect(item.kernel.declaredPosition).toBeGreaterThan(0);
    expect(item.kernel.startedPosition).toBeGreaterThan(0);
    expect(state.proposalRecord.disposition).toMatchObject({ choice: 'safer_method', source: 'card' });
    expect(state.proposalRecord).toMatchObject({
      status: 'awaiting_proposal',
      activeRound: { phase: 'proposal', round: 1, stateEntry: state.dispositionRecord.stateEntry + 1 },
    });
    expect(state.proposalRecord.activeRound?.runRef.runId).toBe(state.claim.runRef.runId);
    expect(state.run).toMatchObject({ purpose: { kind: 'unknown_call_review', phase: 'proposal' } });
    expect(state.proposalRecord.proposalTargets).toEqual([item.callId]);
    expect(proposalIds(state.proposalRecord)).toEqual([item.callId]);
    expect(state.toolResults).toHaveLength(1);
    expect(state.toolResults.every(result => result.status === 'success')).toBe(true);

    // The Run ends completed through the real settleRun, then the real settleReview.
    const completed = await endK3RunCompleted(opened, state.claim);
    expect(completed).toMatchObject({ status: 'ended', outcome: 'completed' });
    const final = await settleK3Review(opened, state.proposalRecord);
    expect(final).toMatchObject({
      status: 'awaiting_approval', activeRound: null, decisionReasons: [],
      rounds: [{ phase: 'proposal', round: 1, result: 'finished', stateEntry: final.stateEntry }],
    });
    expect(proposalIds(final)).toEqual([item.callId]);
  });

  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: a first unfinished round keeps awaiting_proposal and clears activeRound', async kind => {
    const opened = await world(kind);
    const state = await reachK3AwaitingProposal(opened, {
      label: 'k3-16-unfinished', command: 'pnpm db:migrate', callId: 'k3-16-process-unfinished',
    });
    const crashed = await endK3RunUnfinished(opened, state.claim);
    expect(crashed).toMatchObject({ status: 'ended', outcome: 'crashed' });
    const after = await settleK3Review(opened, state.proposalRecord);
    expect(after).toMatchObject({ status: 'awaiting_proposal', activeRound: null });
    expect(after.rounds).toHaveLength(1);
    expect(after.rounds[0]).toMatchObject({ phase: 'proposal', round: 1, result: 'unfinished' });
    // The proposal written in the unfinished round is kept for the next one.
    expect(proposalIds(after)).toEqual([after.items[0]!.callId]);
  });

  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: a second unfinished round settles to needs_decision with review_incomplete', async kind => {
    const opened = await world(kind);
    // One real item concluded `done` by a real review round, so the later
    // needs_decision reason is exactly `review_incomplete`.
    const created = await createK3PendingReview(opened, {
      label: 'k3-16-second', command: 'npm run build', callId: 'k3-16-process-second',
    });
    expect(created.items).toHaveLength(1);
    const review = await runK3ReviewRound(opened, created, {
      conclusions: [{ item: 1, verdict: 'done',
        evidence: 'the review round saw the command finish',
        crashSuspicion: { verdict: 'unlikely', evidence: 'the command leaves no crash trace' } }],
      end: 'unfinished',
    });
    const decision = await settleK3Review(opened, review.settled!, { cause: 'review_unavailable' });
    const proposed = await answerK3Disposition(opened, decision, 'safer_method');
    const first = await claimK3ReviewRound(opened, proposed, { phase: 'proposal' });
    const firstWritten = await writeK3Proposals(opened, first);
    await endK3RunUnfinished(opened, first.claim);
    const afterFirst = await settleK3Review(opened, firstWritten.record);
    expect(afterFirst).toMatchObject({ status: 'awaiting_proposal', activeRound: null });

    const second = await claimK3ReviewRound(opened, afterFirst, { phase: 'proposal' });
    const written = await writeK3Proposals(opened, second);
    await endK3RunUnfinished(opened, second.claim);
    const final = await settleK3Review(opened, written.record);
    expect(final.status).toBe('needs_decision');
    expect(final.decisionReasons).toEqual(['review_incomplete']);
  });
});

describe('K3 proposal-round fixture real Runtime entry (K3-35 review item)', () => {
  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: the round Run is entered by the real Runtime and ends on the real Kernel entry', async kind => {
    const opened = await world(kind);
    const state = await reachK3AwaitingProposal(opened, {
      label: 'k3-16-entry', command: 'echo entry', callId: 'k3-16-process-entry',
    });
    const authorization = state.run.executionAuthorization;
    expect(authorization).toMatchObject({ schemaVersion: 2, phase: 'entered' });
    if (authorization === undefined || !('schemaVersion' in authorization) || authorization.schemaVersion !== 2
      || authorization.kernel === null) {
      throw new Error(`the round Run is not entered by the Runtime: ${JSON.stringify(authorization)}`);
    }
    // The entered identity is the real Turn's, never the old fixture literals.
    expect(authorization.kernel.runId).not.toBe('k3-proposal-kernel-run');
    expect(authorization.kernel.turnId).not.toBe('k3-proposal-turn');

    // The entered history is the real Turn's: it starts at the real Turn start
    // and observes forward from there (the scripted reply is still held, so the
    // tail may already be past the entered snapshot).
    const entered = await readRun(opened, state.claim.runRef);
    expect(entered.run.executionAuthorization).toEqual(authorization);
    expect(state.run.executionHistory).toMatchObject({
      startPosition: entered.run.executionHistory!.startPosition, endPosition: null,
    });
    expect(entered.run.executionHistory?.startPosition).toBeGreaterThan(0);
    expect(entered.run.executionHistory!.observedThroughPosition)
      .toBeGreaterThanOrEqual(entered.run.executionHistory!.startPosition);

    // Completed end: the booked boundary is the LAST real Kernel entry, with
    // that entry's OWN cursor (a `+1` or a synthetic token cannot pass).
    const completed = await endK3RunCompleted(opened, state.claim);
    const ended = await readRunBoundary(opened, state.claim.runRef);
    expect(completed).toMatchObject({ status: 'ended', outcome: 'completed' });
    expect(completed.executionHistory).toMatchObject({
      startPosition: entered.run.executionHistory!.startPosition,
      observedThroughPosition: ended.position, endPosition: ended.position,
    });
    expect(ended.endPosition).toBe(ended.position);
    expect(ended.entryPosition).toBe(ended.position);
    const stored = cursorPayload(ended.cursor);
    const entry = cursorPayload(ended.entryCursor ?? '');
    expect(stored).toMatchObject({ i: ended.position, u: ended.position });
    expect(entry).toMatchObject({ i: ended.position, u: ended.position });
    const session = await opened.fixture.b2.base.sessionsPort.readSession(
      opened.fixture.ctx, state.claim.sessionRef);
    expect(session).toMatchObject({ status: 'ready' });
    if (session.status !== 'ready') return;
    expect(session.value.record.historyCursor).toBe(ended.cursor);
  });

  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: the unfinished end books the last real Kernel entry the Runtime saw', async kind => {
    const opened = await world(kind);
    const state = await reachK3AwaitingProposal(opened, {
      label: 'k3-16-entry-crash', command: 'echo crash', callId: 'k3-16-process-crash',
    });
    // The scripted model throws in `beforeReply`; the Runtime records
    // `run_crashed` itself and books that real Turn entry.
    const crashed = await endK3RunUnfinished(opened, state.claim);
    expect(crashed).toMatchObject({ status: 'ended', outcome: 'crashed' });
    const boundary = await readRunBoundary(opened, state.claim.runRef);
    expect(crashed.executionHistory).toMatchObject({
      startPosition: state.run.executionHistory!.startPosition,
      observedThroughPosition: boundary.position, endPosition: boundary.position,
    });
    expect(boundary.endPosition).toBe(boundary.position);
    expect(boundary.entryPosition).toBe(boundary.position);
    const stored = cursorPayload(boundary.cursor);
    const entry = cursorPayload(boundary.entryCursor ?? '');
    expect(stored).toMatchObject({ i: boundary.position, u: boundary.position });
    expect(entry).toMatchObject({ i: boundary.position, u: boundary.position });
    const session = await opened.fixture.b2.base.sessionsPort.readSession(
      opened.fixture.ctx, state.claim.sessionRef);
    expect(session).toMatchObject({ status: 'ready' });
    if (session.status !== 'ready') return;
    expect(session.value.record.historyCursor).toBe(boundary.cursor);
  });
});

describe('K3 proposal-round fixture review half (K3-45 setup)', () => {
  it.each(['memory', 'sqlite'] as const)(
    'K3-16 %s: a pending_review record enters a real review round, records a conclusion and settles resolved', async kind => {
    const opened = await world(kind);
    const record = await createK3PendingReview(opened, {
      label: 'k3-16-review', command: 'npm run build', callId: 'k3-16-process-review',
    });
    expect(record).toMatchObject({ status: 'pending_review', inventory: 'complete', revision: 1 });
    expect(record.items).toHaveLength(1);
    const round = await runK3ReviewRound(opened, record, {
      conclusions: [{ item: 1, verdict: 'done', evidence: 'the build finished',
        crashSuspicion: { verdict: 'unlikely', evidence: 'the process exited normally' } }],
    });
    expect(round.record).toMatchObject({ status: 'pending_review', activeRound: { phase: 'review' } });
    expect(round.record.items[0]).toMatchObject({
      observed: { verdict: 'done', by: 'review_round', roundRunRef: { runId: round.claim.runRef.runId } },
    });
    expect(round.settled).toMatchObject({
      status: 'resolved', activeRound: null, open: 'no', decisionReasons: [],
      rounds: [{ phase: 'review', round: 1, result: 'finished' }],
    });
  });
});
