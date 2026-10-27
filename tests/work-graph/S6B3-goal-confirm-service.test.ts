import { describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { GoalConfirmDraftInputV1, GoalConfirmDraftReceiptV1 } from '../../src/contracts/goal-card.js';
import type { GoalAutonomyV1 } from '../../src/contracts/goal-decisions.js';
import type { InitializationBindingReadPort } from '../../src/core/work-graph/model/goal-card-contracts.js';
import type { GoalRef, GoalSnapshot } from '../../src/contracts/ledger.js';
import type { QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { QueryActivityViewV1 } from '../../src/core/work-graph/views/activity-read-model.js';
import type { RequestReadV1 } from '../../src/core/work-graph/views/main-surface-read-model.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { byIdentityPrefix, commitBarrier, type CommitHold } from '../helpers/S6A-commit-barrier.js';
import type { S6ABackend } from '../helpers/S6A-request-fixture.js';
import {
  callS6B3LateRoute, holdS6B3DraftAnswer, openS6B3World, releaseS6B3DraftAnswer, submitS6B3FollowUp, type S6B3World,
} from '../helpers/S6B3-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const DEFERRED_BINDINGS = 'S6B3: platform.bindings is not published yet (6b3-w3)';
const CONFIRM_IDENTITY = 'goal.confirmDraft:';

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

async function postValue<T>(world: S6B3World, suffix: string, body: unknown, what: string): Promise<T> {
  const answer = await world.host.post(suffix, body);
  const reply = asRecord(answer.body);
  if (answer.httpStatus !== 200 || reply['status'] !== 'ready')
    throw new Error(`S6B3: ${what} is not ready (${answer.httpStatus}): ${JSON.stringify(answer.body)}`);
  return reply['value'] as T;
}

async function confirmDraft(world: S6B3World, input: GoalConfirmDraftInputV1):
Promise<WriteResult<GoalConfirmDraftReceiptV1>> {
  return await callS6B3LateRoute(world, 'goals/confirm-draft', '6b3-w3',
    plain(world.mainScope, input)) as WriteResult<GoalConfirmDraftReceiptV1>;
}

function committedResult<T>(result: WriteResult<T>, what: string):
Exclude<WriteResult<T>, { status: 'rejected' }> {
  if (result.status !== 'committed') throw new Error(`S6B3: ${what} did not commit: ${JSON.stringify(result)}`);
  return result;
}

function bindingPort(world: S6B3World): InitializationBindingReadPort {
  const port = (world.host.platform as unknown as { bindings?: InitializationBindingReadPort }).bindings;
  if (port === undefined) throw new Error(DEFERRED_BINDINGS);
  return port;
}

async function requestView(world: S6B3World, requestRoot: QueryJobRef): Promise<RequestReadV1> {
  return await postValue<RequestReadV1>(world, 'requests/read', plain(world.mainScope, { requestRoot }),
    'the request view');
}

function roundOf(view: RequestReadV1, ref: QueryJobRef): RequestReadV1['rounds'][number] {
  const round = view.rounds.find(entry => entry.ref.queryJobId === ref.queryJobId
    && entry.ref.projectId === ref.projectId && entry.ref.workspaceId === ref.workspaceId);
  if (round === undefined) throw new Error(`S6B3: the request view does not list ${ref.queryJobId}`);
  return round;
}

function confirmLinks(view: RequestReadV1, ref: QueryJobRef): (GoalRef | null)[] {
  return roundOf(view, ref).goalCardDrafts.map(entry => entry.confirmedGoalRef);
}

type MainPage = { goalId: string | null; requests: { requestRoot: QueryJobRef }[]; next: unknown };

async function mainPage(world: S6B3World, goalId: string | null): Promise<MainPage> {
  return await postValue<MainPage>(world, 'main/read', plain(world.mainScope, { goalId, cursor: null }),
    `main/read of ${String(goalId)}`);
}

async function goalRead(world: S6B3World, ref: GoalRef): Promise<GoalSnapshot> {
  return (await postValue<{ goal: GoalSnapshot }>(world, 'goals/read', plain(world.mainScope, ref),
    'the Goal read')).goal;
}

async function queryActivity(world: S6B3World, runRef: QueryRunRef): Promise<QueryActivityViewV1> {
  const view = (await postValue<QueryActivityViewV1[]>(world, 'activity/queries',
    plain(world.mainScope, { refs: [runRef] }), 'the Query activity'))[0];
  if (view === undefined) throw new Error('S6B3: activity/queries returned no view');
  return view;
}

function readyRead<T>(result: ReadResult<T>, what: string): T {
  if (result.status !== 'ready') throw new Error(`S6B3: ${what} is not ready: ${JSON.stringify(result)}`);
  return result.value;
}

const settingsOf = (autonomy: GoalAutonomyV1, order: number) =>
  ({ schemaVersion: 1, autonomy, order, waitForGoalRef: null, parallelRisks: [] });

const objectiveText = (label: string, index: number): string =>
  `S6B3 ${label} draft ${index + 1}\n\n完成标准：\n- S6B3 ${label} criterion ${index + 1}`;

type DraftData = {
  ctx: CoreCallContext; round: QueryJobRef; requestRoot: QueryJobRef;
  answer: Awaited<ReturnType<typeof releaseS6B3DraftAnswer>>;
};

/** One answered two-draft request, prepared inside the row's own exercise; no draft is confirmed yet. */
async function draftBasis(world: S6B3World, label: string): Promise<DraftData> {
  const held = await holdS6B3DraftAnswer(world, { scope: world.mainScope, label, drafts: 2 });
  const answer = await releaseS6B3DraftAnswer(world, held);
  expect(answer.drafts.map(draft => draft.confirmedGoalRef)).toEqual([null, null]);
  return { ctx: world.host.humanContext(), round: held.round,
    requestRoot: held.request.requestRoot, answer };
}

/** Open the world; the barrier's own reset runs before the close, whatever the exercise did. */
async function withDraft(backend: S6ABackend, run: (world: S6B3World) => Promise<void>): Promise<void> {
  const world = await openS6B3World({ backend });
  try {
    await run(world);
  } finally {
    commitBarrier.reset();
    await world.close();
  }
}

async function awaitHeld(hold: { reached: Promise<unknown> }, pending: Promise<unknown>): Promise<void> {
  const outcome = pending.then(() => ({ kind: 'result' as const }),
    (error: unknown) => ({ kind: 'error' as const, error }));
  const first = await Promise.race([hold.reached.then(() => ({ kind: 'held' as const })), outcome]);
  if (first.kind === 'error') throw first.error;
  if (first.kind === 'result') throw new Error('S6B3: the confirm ended before its prepared commit was held');
}

function armConfirm(world: S6B3World, round: QueryJobRef, commandId: string) {
  const labels = [1, 2, 3, 4, 5].map(attempt => `${commandId} attempt ${attempt}`);
  const holds = labels.map(label => commitBarrier.hold(byIdentityPrefix(CONFIRM_IDENTITY), label));
  return { labels, holds, pending: confirmDraft(world, { commandId, round, index: 0 }) };
}

async function conflictThenMove(world: S6B3World, requestRoot: QueryJobRef, pending: Promise<unknown>,
  hold: CommitHold, commandId: string): Promise<void> {
  await awaitHeld(hold, pending);
  await submitS6B3FollowUp(world, { requestRoot, commandId, answer: false });
  hold.release();
}

describe.each(['memory', 'sqlite'] as const)('goals/confirm-draft service row 29 (%s)', (backend: S6ABackend) => {
  it('makes one Goal at revision 1 with its settings, one binding and one attribution round; a replay returns the original receipt', async () => {
    await withDraft(backend, async world => {
      const exercise = async () => {
        const { ctx, round, requestRoot, answer } = await draftBasis(world, `one-${backend}`);
        const before = await requestView(world, requestRoot);
        expect(before.effectiveGoalId).toBeNull();
        expect(before.rounds.some(entry => entry.kind === 'routing')).toBe(false);
        expect(confirmLinks(before, round)).toEqual([null, null]);
        expect(await bindingPort(world).readBindingByAnswerDraft(ctx,
          { answerRef: answer.answerRef, draftIndex: 0 })).toEqual({ status: 'not_found' });
        const input: GoalConfirmDraftInputV1 = { commandId: `s6b3-confirm-one-${backend}-0`, round, index: 0 };
        const committed = committedResult(await confirmDraft(world, input), 'the first confirmation');
        const receipt = committed.value;
        expect(committed.replayed).toBe(false);
        expect(receipt).toMatchObject({ round, index: 0, requestRef: requestRoot,
          goal: { revision: 1, objective: objectiveText(`one-${backend}`, 0),
            settings: settingsOf('every_step', 0), since: committed.cursor,
            continuedFrom: null, copiedInterventions: [] },
          binding: { revision: 1, answerRef: answer.answerRef, requestRef: requestRoot, draftIndex: 0,
            goalRef: receipt.goal.ref, goalRevision: 1, screening: null },
          attributionRound: { aggregateType: 'QueryJob', projectId: round.projectId,
            workspaceId: round.workspaceId } });
        expect(receipt.binding.answerDigest).toMatch(/^[0-9a-f]{64}$/);
        expect(receipt.attributionRound.queryJobId).not.toBe(round.queryJobId);
        expect(await goalRead(world, receipt.goal.ref)).toEqual(receipt.goal);

        const bindings = bindingPort(world);
        expect(readyRead(await bindings.readBindingByAnswerDraft(ctx,
          { answerRef: answer.answerRef, draftIndex: 0 }), 'the binding by answer and draft').ref)
          .toEqual(receipt.binding.ref);
        expect(readyRead(await bindings.readBindingByGoal(ctx, { goalRef: receipt.goal.ref }),
          'the binding by Goal')).toEqual([receipt.binding]);
        expect(await bindings.readBindingByAnswerDraft(ctx, { answerRef: answer.answerRef, draftIndex: 1 }))
          .toEqual({ status: 'not_found' });
        const after = await requestView(world, requestRoot);
        const routing = after.rounds.filter(entry => entry.kind === 'routing');
        expect(routing.map(entry => [entry.ref, entry.since]))
          .toEqual([[receipt.attributionRound, committed.cursor]]);
        expect(confirmLinks(after, round)).toEqual([receipt.goal.ref, null]);
        expect({ effectiveGoalId: after.effectiveGoalId, goalId: after.goalId })
          .toEqual({ effectiveGoalId: receipt.goal.ref.goalId, goalId: null });
        const replay = committedResult(await confirmDraft(world, input), 'the replayed confirmation');
        expect(replay).toMatchObject({ replayed: true, cursor: committed.cursor });
        expect(replay.value).toEqual(receipt);
        const afterReplay = await requestView(world, requestRoot);
        expect(afterReplay.rounds).toHaveLength(after.rounds.length);
        expect(confirmLinks(afterReplay, round)).toEqual([receipt.goal.ref, null]);
        expect(readyRead(await bindings.readBindingByGoal(ctx, { goalRef: receipt.goal.ref }),
          'the binding by Goal after the replay')).toHaveLength(1);
      };
      await exercise();
    });
  });

  describe('rejects: goals/confirm-draft', () => {
    it('another command on the same draft is a revision conflict and writes nothing', async () => {
      await withDraft(backend, async world => {
        const exercise = async () => {
          const { ctx, round, requestRoot, answer } = await draftBasis(world, `conflict-${backend}`);
          const input = { commandId: `s6b3-confirm-conflict-${backend}-0`, round, index: 0 };
          const first = committedResult(await confirmDraft(world, input), 'the first confirmation');
          const view = await requestView(world, requestRoot);
          const other = await confirmDraft(world, { ...input, commandId: `${input.commandId}-another` });
          expect(other).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
          expect(await requestView(world, requestRoot)).toEqual(view);
          expect(readyRead(await bindingPort(world).readBindingByAnswerDraft(ctx,
            { answerRef: answer.answerRef, draftIndex: 0 }), 'the binding after the conflict').ref)
            .toEqual(first.value.binding.ref);
        };
        await exercise();
      });
    });
    it('a newer answer committed first makes the older answer’s draft a revision conflict and creates no Goal or binding', async () => {
      await withDraft(backend, async world => {
        const exercise = async () => {
          const { ctx, round, requestRoot, answer } = await draftBasis(world, `newer-${backend}`);
          const newer = await submitS6B3FollowUp(world,
            { requestRoot, commandId: `s6b3-confirm-follow-newer-${backend}`, answer: true });
          const view = await requestView(world, requestRoot);
          expect(roundOf(view, newer).answer).not.toBeNull();
          expect(roundOf(view, newer).status).toBe('ended');

          const refused = await confirmDraft(world, { commandId: `s6b3-confirm-newer-${backend}-old`,
            round, index: 0 });
          expect(refused).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
          if (refused.status !== 'rejected') throw new Error('S6B3: the older draft was not refused');
          expect(refused.reason).toMatch(/latest answered round/);
          expect(await requestView(world, requestRoot)).toEqual(view);
          expect(await bindingPort(world).readBindingByAnswerDraft(ctx,
            { answerRef: answer.answerRef, draftIndex: 0 })).toEqual({ status: 'not_found' });
        };
        await exercise();
      });
    });
  });
  it('two drafts of one answer make two Goals, two bindings and two attribution rounds, the later attribution the effective Goal', async () => {
    await withDraft(backend, async world => {
      const exercise = async () => {
        const { ctx, round, requestRoot, answer } = await draftBasis(world, `two-${backend}`);
        const first = committedResult(await confirmDraft(world,
          { commandId: `s6b3-confirm-two-${backend}-0`, round, index: 0 }), 'the first draft');
        const second = committedResult(await confirmDraft(world,
          { commandId: `s6b3-confirm-two-${backend}-1`, round, index: 1 }), 'the second draft');
        expect(first.value.goal.ref.goalId).not.toBe(second.value.goal.ref.goalId);
        expect([first.value.goal.settings, second.value.goal.settings])
          .toEqual([settingsOf('every_step', 0), settingsOf('after_plan_confirmation', 1)]);
        expect([first.value.goal.since, second.value.goal.since]).toEqual([first.cursor, second.cursor]);
        expect(second.cursor).not.toEqual(first.cursor);
        expect(first.value.attributionRound.queryJobId).not.toBe(second.value.attributionRound.queryJobId);
        const bindings = bindingPort(world);
        for (const [index, receipt] of ([first.value, second.value] as const).entries()) {
          const byAnswer = readyRead(await bindings.readBindingByAnswerDraft(ctx,
            { answerRef: answer.answerRef, draftIndex: index }), 'the binding by answer and draft');
          expect([byAnswer.goalRef, byAnswer.draftIndex]).toEqual([receipt.goal.ref, index]);
          expect(readyRead(await bindings.readBindingByGoal(ctx, { goalRef: receipt.goal.ref }),
            'the binding by Goal')).toEqual([byAnswer]);
        }
        const view = await requestView(world, requestRoot);
        const routing = view.rounds.filter(entry => entry.kind === 'routing');
        expect(routing.map(entry => entry.ref)).toEqual([
          first.value.attributionRound, second.value.attributionRound,
        ]);
        expect(routing.map(entry => entry.since)).toEqual([first.cursor, second.cursor]);
        expect(confirmLinks(view, round)).toEqual([first.value.goal.ref, second.value.goal.ref]);
        expect({ effectiveGoalId: view.effectiveGoalId, goalId: view.goalId })
          .toEqual({ effectiveGoalId: second.value.goal.ref.goalId, goalId: null });
      };
      await exercise();
    });
  });

  it('a follow-up write landing while the confirm commit is held is re-read with the whole basis: one commit, one Goal, and the receipt replays', async () => {
    await withDraft(backend, async world => {
      const exercise = async () => {
        const { ctx, round, requestRoot } = await draftBasis(world, `held-${backend}`);
        commitBarrier.reset();
        const input: GoalConfirmDraftInputV1 = { commandId: `s6b3-confirm-held-${backend}-0`, round, index: 0 };
        const hold = commitBarrier.hold(byIdentityPrefix(CONFIRM_IDENTITY), 'held confirm');
        const pending = confirmDraft(world, input);
        await awaitHeld(hold, pending);
        const followUp = await submitS6B3FollowUp(world,
          { requestRoot, commandId: `s6b3-confirm-held-${backend}-follow`, answer: false });
        hold.release();
        const result = await pending;
        const view = await requestView(world, requestRoot);
        expect(roundOf(view, followUp).status).toBe('queued');
        const committed = committedResult(result, 'the held confirmation');
        expect(committed.replayed).toBe(false);
        expect(committed.value.goal.since).toEqual(committed.cursor);
        const routing = view.rounds.filter(entry => entry.kind === 'routing');
        expect(routing).toHaveLength(1);
        expect(routing[0]!.ref).toEqual(committed.value.attributionRound);
        expect(readyRead(await bindingPort(world).readBindingByGoal(ctx,
          { goalRef: committed.value.goal.ref }), 'the binding by Goal')).toHaveLength(1);
        const replay = committedResult(await confirmDraft(world, input), 'the held replay');
        expect([replay.replayed, replay.value]).toEqual([true, committed.value]);
        expect((await requestView(world, requestRoot)).rounds.filter(entry => entry.kind === 'routing'))
          .toHaveLength(1);
        expect((await goalRead(world, committed.value.goal.ref)).revision).toBe(1);
      };
      await exercise();
    });
  });

  it('retries a request-tail conflict three times, commits on the fourth attempt once, and makes no fifth submission', async () => {
    await withDraft(backend, async world => {
      const exercise = async () => {
        const { ctx, round, requestRoot, answer } = await draftBasis(world, `retry-${backend}`);
        commitBarrier.reset();
        const id = `s6b3-confirm-retry-${backend}`;
        const { labels, holds, pending } = armConfirm(world, round, id);
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await conflictThenMove(world, requestRoot, pending, holds[attempt]!, `${id}-${attempt}`);
        }
        await awaitHeld(holds[3]!, pending);
        holds[3]!.release();
        const committed = committedResult(await pending, 'the retried confirmation');
        expect(committed.replayed).toBe(false);
        const view = await requestView(world, requestRoot);
        const routing = view.rounds.filter(entry => entry.kind === 'routing');
        expect(routing).toHaveLength(1);
        expect([routing[0]!.ref, routing[0]!.since]).toEqual([committed.value.attributionRound, committed.cursor]);
        expect(confirmLinks(view, round)).toEqual([committed.value.goal.ref, null]);
        expect(view.effectiveGoalId).toBe(committed.value.goal.ref.goalId);
        const bindings = bindingPort(world);
        expect(readyRead(await bindings.readBindingByGoal(ctx, { goalRef: committed.value.goal.ref }),
          'the binding by Goal')).toHaveLength(1);
        expect(readyRead(await bindings.readBindingByAnswerDraft(ctx,
          { answerRef: answer.answerRef, draftIndex: 0 }), 'the binding by answer and draft').ref)
          .toEqual(committed.value.binding.ref);
        expect(commitBarrier.unreleased()).toEqual([labels[4]]);
      };
      await exercise();
    });
  });

  it('four conflicting attempts answer busy and stop before a fifth', async () => {
    await withDraft(backend, async world => {
      const exercise = async () => {
        const { ctx, round, requestRoot, answer } = await draftBasis(world, `busy-${backend}`);
        commitBarrier.reset();
        const id = `s6b3-confirm-busy-${backend}`;
        const { labels, holds, pending } = armConfirm(world, round, id);
        for (let attempt = 0; attempt < 4; attempt += 1) {
          await conflictThenMove(world, requestRoot, pending, holds[attempt]!, `${id}-${attempt}`);
        }
        expect(await pending).toMatchObject({ status: 'rejected', code: 'busy' });
        const view = await requestView(world, requestRoot);
        expect(view.effectiveGoalId).toBeNull();
        expect(view.rounds.some(entry => entry.kind === 'routing')).toBe(false);
        expect(confirmLinks(view, round)).toEqual([null, null]);
        expect(await bindingPort(world).readBindingByAnswerDraft(ctx,
          { answerRef: answer.answerRef, draftIndex: 0 })).toEqual({ status: 'not_found' });
        expect(commitBarrier.unreleased()).toEqual([labels[4]]);
      };
      await exercise();
    });
  });
});

describe('attribution and the first-Goal main read row 30 (memory)', () => {
  it('shows the pre-goal history only under the first Goal by creation, keeps the root and since, links both drafts, and leaves the earlier activity’s goalId null', async () => {
    await withDraft('memory', async world => {
      const exercise = async () => {
        const { round, requestRoot } = await draftBasis(world, 'first-goal');
        const before = await requestView(world, requestRoot);
        const since = roundOf(before, round).since;
        const runRef = (await readQuery(world.host.ag2b, round)).run.ref;
        expect(await queryActivity(world, runRef)).toMatchObject({ goalId: null });
        const first = committedResult(await confirmDraft(world,
          { commandId: 's6b3-confirm-first-goal-0', round, index: 0 }), 'the first draft');
        const second = committedResult(await confirmDraft(world,
          { commandId: 's6b3-confirm-first-goal-1', round, index: 1 }), 'the second draft');
        expect([first.value.goal.settings.order, second.value.goal.settings.order]).toEqual([0, 1]);
        const after = await requestView(world, requestRoot);
        expect(after.requestRoot).toEqual(before.requestRoot);
        expect({ goalId: after.goalId, since: roundOf(after, round).since,
          links: confirmLinks(after, round), effectiveGoalId: after.effectiveGoalId }).toEqual({
          goalId: null, since, links: [first.value.goal.ref, second.value.goal.ref],
          effectiveGoalId: second.value.goal.ref.goalId,
        });
        const firstPage = await mainPage(world, first.value.goal.ref.goalId);
        const secondPage = await mainPage(world, second.value.goal.ref.goalId);
        expect(firstPage.requests.map(entry => entry.requestRoot.queryJobId)).toContain(requestRoot.queryJobId);
        expect(secondPage.requests.map(entry => entry.requestRoot.queryJobId)).not.toContain(requestRoot.queryJobId);
        expect(await queryActivity(world, runRef)).toMatchObject({ status: 'counted', goalId: null });
      };
      await exercise();
    });
  });
});
