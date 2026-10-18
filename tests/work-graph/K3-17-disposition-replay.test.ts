/**
 * K3-17 (L19) disposition application/replay through the real coordinator:
 * ② replays the original answer-derived commit receipt and ③ records only
 * once; a retry after a failed ③ keeps the same ② receipt; an answer to an
 * older card revision is `revision_conflict` and writes nothing.
 *
 * Faults are injected only at the store boundary of ③ (one receipt read or one
 * write), never by rewriting records.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecisionSelectionV1 } from '../../src/contracts/goal-decisions.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import {
  createK3NeedsDecisionRecord, openK3ReviewCardWorld, type K3ReviewCardWorld,
} from '../helpers/K3-review-card-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { GOAL_B, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';

// §5.1's stand-in `shell`: the real record's one blocked call is held until the
// recognition path has read the draft (the real shell needs bwrap, which DSH
// does not have). The mock is per test file, so this file owns it.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]) =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

async function cardOf(world: K3ReviewCardWorld, record: UnknownCallReviewV1) {
  const page = await world.cardSource.readPage(world.fixture.ctx, { workspace: WORKSPACE_SCOPE, goalRef: GOAL_B,
    page: { limit: 100 } });
  if (page.status !== 'ready') throw new Error(`the card page failed: ${JSON.stringify(page)}`);
  const key = decisionSourceKey({ kind: 'unknown_call_review', reviewRef: record.ref, revision: record.revision });
  const card = page.value.items.find(item => item.source.key === key);
  if (card === undefined) throw new Error(`the card ${key} is not on the source page`);
  return card;
}

function requestOf(card: Awaited<ReturnType<typeof cardOf>>, requestId: string, selection?: DecisionSelectionV1) {
  return {
    input: { source: card.source, selection: selection ?? { kind: 'option' as const, optionId: 'rerun_as_is' },
      text: 'retry me', annotations: [] },
    meta: { requestId, expected: card.source.pins },
  };
}

async function readyWorld(kind: 'memory' | 'sqlite', choice = 'rerun_as_is') {
  const world = await openK3ReviewCardWorld(kind);
  worlds.push(world);
  const record = await createK3NeedsDecisionRecord(world, 'k3-20-a');
  const card = await cardOf(world, record);
  const request = requestOf(card, `k3-17-${choice}`,
    { kind: 'option', optionId: choice as 'rerun_as_is' });
  return { world, record, card, request };
}

describe('K3-17 disposition replay', () => {
  it.each(['memory', 'sqlite'] as const)('K3-17 (%s): a second resolveDecision replays ② with the original receipt and never records ③ twice', async kind => {
    const { world, request } = await readyWorld(kind);
    const first = await world.decisionActions.resolveDecision(world.fixture.ctx, request);
    expect(first).toMatchObject({ status: 'ready', value: { state: 'applied' } });
    if (first.status !== 'ready') return;
    const firstAction = first.value.action;
    expect(firstAction).toMatchObject({ status: 'committed', replayed: false });
    if (firstAction === null || firstAction.status !== 'committed') return;
    const commitsAfterFirst = world.fixture.counts.commits;

    const second = await world.decisionActions.resolveDecision(world.fixture.ctx, request);
    expect(second).toMatchObject({ status: 'ready', value: { state: 'applied' } });
    if (second.status !== 'ready') return;
    // ② replays the SAME original receipt (cursor and replayed flag).
    expect(second.value.action).toEqual({ ...firstAction, replayed: true });
    // ③ replays too; the Store saw no new commit.
    expect(second.value.application).toMatchObject({ status: 'committed', replayed: true });
    expect(world.fixture.counts.commits).toBe(commitsAfterFirst);
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)('K3-17 (%s): a retry after an injected ③ write failure returns the same original ② receipt, then records ③ once', async kind => {
    const { world, request } = await readyWorld(kind);
    world.failNextApplicationCommit();
    const first = await world.decisionActions.resolveDecision(world.fixture.ctx, request);
    expect(first).toMatchObject({ status: 'ready', value: { state: 'application_not_recorded' } });
    if (first.status !== 'ready') return;
    const original = first.value.action;
    expect(original).toMatchObject({ status: 'committed', replayed: false });
    if (original === null || original.status !== 'committed') return;

    const retried = await world.decisionActions.resolveDecision(world.fixture.ctx, request);
    expect(retried).toMatchObject({ status: 'ready', value: { state: 'applied' } });
    if (retried.status !== 'ready') return;
    expect(retried.value.action).toEqual({ ...original, replayed: true });
    expect(retried.value.application).toMatchObject({ status: 'committed', replayed: false });

    // A third identical call replays both; ③ is recorded exactly once.
    const commits = world.fixture.counts.commits;
    const third = await world.decisionActions.resolveDecision(world.fixture.ctx, request);
    expect(third).toMatchObject({ status: 'ready', value: { state: 'applied' } });
    if (third.status !== 'ready') return;
    expect(third.value.action).toEqual({ ...original, replayed: true });
    expect(third.value.application).toMatchObject({ status: 'committed', replayed: true });
    expect(world.fixture.counts.commits).toBe(commits);
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)('K3-17 (%s): a retry after an injected ③ receipt read failure keeps the same original ② receipt', async kind => {
    const { world, request } = await readyWorld(kind);
    world.failNextApplicationRead();
    const first = await world.decisionActions.resolveDecision(world.fixture.ctx, request);
    expect(first).toMatchObject({ status: 'ready', value: { state: 'application_not_recorded' } });
    if (first.status !== 'ready') return;
    const original = first.value.action;
    expect(original).toMatchObject({ status: 'committed', replayed: false });
    if (original === null || original.status !== 'committed') return;

    const retried = await world.decisionActions.resolveDecision(world.fixture.ctx, request);
    expect(retried).toMatchObject({ status: 'ready', value: { state: 'applied' } });
    if (retried.status !== 'ready') return;
    expect(retried.value.action).toEqual({ ...original, replayed: true });
    expect(retried.value.application).toMatchObject({ status: 'committed', replayed: false });
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)('K3-17 (%s): an answer to an older card revision is revision_conflict and writes nothing', async kind => {
    const { world, record, card, request } = await readyWorld(kind);
    // ① is its own commit; the answer is captured against card revision 1.
    const answered = await world.decisions.answerDecision(world.fixture.ctx, {
      input: { source: card.source, selection: { kind: 'option', optionId: 'rerun_as_is' },
        text: 'answered before the hold', annotations: [] },
      meta: { requestId: 'k3-17-older-answer', expected: card.source.pins },
    });
    expect(answered).toMatchObject({ status: 'committed' });
    // A real human direct hold moves the record to the next revision.
    const held = await world.reviews.holdReview(world.fixture.ctx, {
      input: { reviewRef: record.ref, text: 'I handle it now' },
      meta: { requestId: 'k3-17-older-hold', expected: [{ ref: record.ref, revision: record.revision }] },
    });
    expect(held).toMatchObject({ status: 'committed', value: { revision: record.revision + 1, status: 'resolved' } });
    const commitsBefore = world.fixture.counts.commits;

    // The coordinator's ① re-derives the card and refuses the older revision
    // before writing; the UR7 path (no ①) reaches the SAME guard in ②.
    const result = await world.decisionActions.resolveDecision(world.fixture.ctx, request);
    expect(result).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(world.fixture.counts.commits).toBe(commitsBefore);
    expect(answered.status).toBe('committed');
    if (answered.status !== 'committed') return;
    const advanced = await world.decisionActions.advanceReviewDisposition(world.fixture.ctx, {
      input: { source: card.source, selection: { kind: 'option', optionId: 'rerun_as_is' },
        decisionMessageRef: answered.value.ref },
      meta: { requestId: 'k3-17-older-advance', expected: card.source.pins },
    });
    expect(advanced).toMatchObject({ status: 'ready', value: {
      state: 'application_not_recorded', application: null,
      action: { status: 'rejected', code: 'revision_conflict' } } });
    expect(world.fixture.counts.commits).toBe(commitsBefore);
    const after = await world.reviews.readReview(world.fixture.ctx, { ref: record.ref });
    expect(after).toMatchObject({ status: 'ready', value: { revision: record.revision + 1,
      status: 'resolved', disposition: { choice: 'handle_myself', source: 'direct' } } });
  }, 120_000);
});
