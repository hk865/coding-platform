import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import type { GoalConfirmDraftReceiptV1 } from '../../src/contracts/goal-card.js';
import type { InitializationBindingV1 } from '../../src/contracts/initialization-binding.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { GoalScreeningV1, QueryJobAnswerRef, QueryJobRef } from '../../src/contracts/query-job.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { InitializationBindingReadPort } from '../../src/core/work-graph/model/goal-card-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import type { S6ABackend } from '../helpers/S6A-request-fixture.js';
import {
  callS6B3LateRoute, holdS6B3DraftAnswer, openS6B3World, releaseS6B3DraftAnswer, reopenS6B3Host,
  type S6B3Held, type S6B3World,
} from '../helpers/S6B3-fixture.js';

const BACKENDS: readonly S6ABackend[] = ['memory', 'sqlite'];

async function withWorld(backend: S6ABackend, run: (world: S6B3World) => Promise<void>): Promise<void> {
  const world = await openS6B3World({ backend });
  try { await run(world); } finally { await world.close(); }
}

function bindingPort(world: S6B3World): InitializationBindingReadPort {
  const port = (world.host.platform as unknown as { bindings?: InitializationBindingReadPort }).bindings;
  if (port === undefined) throw new Error('S6B3: platform.bindings is not published yet (6b3-w3)');
  return port;
}

async function confirmDraft(world: S6B3World, commandId: string, round: QueryJobRef, index: number):
Promise<WriteResult<GoalConfirmDraftReceiptV1> & { status: 'committed' }> {
  const body: unknown = await callS6B3LateRoute(world, 'goals/confirm-draft', '6b3-w3',
    plain(world.mainScope, { commandId, round, index }));
  const reply = body as WriteResult<GoalConfirmDraftReceiptV1>;
  if (reply.status !== 'committed') throw new Error(`S6B3: the confirm ${commandId} did not commit: ${JSON.stringify(body)}`);
  return reply;
}

function expectedBinding(input: {
  answerRef: QueryJobAnswerRef; answerText: string; requestRef: QueryJobRef; draftIndex: number;
  goalRef: GoalRef; screening: GoalScreeningV1 | null;
}): InitializationBindingV1 {
  return {
    ref: {
      aggregateType: 'InitializationBinding', projectId: input.answerRef.projectId,
      answerRef: input.answerRef, draftIndex: input.draftIndex,
    },
    revision: 1, answerRef: input.answerRef,
    answerDigest: createHash('sha256').update(input.answerText, 'utf8').digest('hex'),
    requestRef: input.requestRef, draftIndex: input.draftIndex,
    goalRef: input.goalRef, goalRevision: 1, screening: input.screening,
  };
}

async function answeredDrafts(world: S6B3World, label: string): Promise<{
  held: S6B3Held;
  answerRef: QueryJobAnswerRef;
  answerText: string;
  drafts: Awaited<ReturnType<typeof releaseS6B3DraftAnswer>>['drafts'];
}> {
  const held = await holdS6B3DraftAnswer(world, { scope: world.mainScope, label, drafts: 2 });
  const released = await releaseS6B3DraftAnswer(world, held);
  expect(released.drafts).toHaveLength(2);
  expect(released.drafts[0]!.confirmedGoalRef).toBeNull();
  return { held, answerRef: released.answerRef, answerText: released.answerText, drafts: released.drafts };
}

it.each(BACKENDS)('%s: a confirmed draft round-trips through both binding lookups', async backend => {
  await withWorld(backend, async world => {
    const exercise = async () => {
      const round = await answeredDrafts(world, 'binding-round-trip');
      const confirmed = await confirmDraft(world, `goal.confirmDraft:s6b3-binding-round-trip-${backend}`,
        round.held.round, 0);
      expect(confirmed.replayed).toBe(false);
      expect([confirmed.value.requestRef, confirmed.value.round, confirmed.value.index])
        .toEqual([round.held.request.requestRoot, round.held.round, 0]);
      const binding = expectedBinding({
        answerRef: round.answerRef, answerText: round.answerText, requestRef: round.held.request.requestRoot,
        draftIndex: 0, goalRef: confirmed.value.goal.ref, screening: round.drafts[0]!.screening,
      });
      expect(confirmed.value.binding).toEqual(binding);

      const ctx = world.host.humanContext();
      const bindings = bindingPort(world);
      expect(await bindings.readBindingByAnswerDraft(ctx, { answerRef: round.answerRef, draftIndex: 0 }))
        .toEqual({ status: 'ready', value: binding });
      expect(await bindings.readBindingByGoal(ctx, { goalRef: confirmed.value.goal.ref }))
        .toEqual({ status: 'ready', value: [binding] });
    };
    await exercise();
  });
});

it.each(BACKENDS)('%s: an ordinary Goal with no binding reads as an empty array', async backend => {
  await withWorld(backend, async world => {
    const exercise = async () => {
      const goal = await s6aCardsWorkspace(world.host, world.mainScope)
        .createGoal('s6b3-binding-empty-goal', 'S6B3 ordinary Goal with no binding');
      expect(await bindingPort(world).readBindingByGoal(world.host.humanContext(), { goalRef: goal.ref }))
        .toEqual({ status: 'ready', value: [] });
    };
    await exercise();
  });
});

it.each(BACKENDS)('%s: an unconfirmed draft is not_found, not an empty success', async backend => {
  await withWorld(backend, async world => {
    const exercise = async () => {
      const round = await answeredDrafts(world, 'binding-unconfirmed');
      await confirmDraft(world, `goal.confirmDraft:s6b3-binding-unconfirmed-${backend}`, round.held.round, 0);
      expect(await bindingPort(world).readBindingByAnswerDraft(world.host.humanContext(),
        { answerRef: round.answerRef, draftIndex: 1 })).toEqual({ status: 'not_found' });
    };
    await exercise();
  });
});

it.each(BACKENDS)('%s: the same command replays and adds no second binding', async backend => {
  await withWorld(backend, async world => {
    const exercise = async () => {
      const round = await answeredDrafts(world, 'binding-replay');
      const command = `goal.confirmDraft:s6b3-binding-replay-${backend}`;
      const first = await confirmDraft(world, command, round.held.round, 0);
      expect(first.replayed).toBe(false);
      const second = await confirmDraft(world, command, round.held.round, 0);
      expect([second.replayed, second.value, second.cursor]).toEqual([true, first.value, first.cursor]);

      const ctx = world.host.humanContext();
      const bindings = bindingPort(world);
      expect(await bindings.readBindingByGoal(ctx, { goalRef: first.value.goal.ref }))
        .toEqual({ status: 'ready', value: [first.value.binding] });
      expect(await bindings.readBindingByAnswerDraft(ctx, { answerRef: round.answerRef, draftIndex: 0 }))
        .toEqual({ status: 'ready', value: first.value.binding });
    };
    await exercise();
  });
});

it('sqlite: a normal reopen keeps the binding readable through both lookups', async () => {
  await withWorld('sqlite', async world => {
    const exercise = async () => {
      const round = await answeredDrafts(world, 'binding-reopen');
      const confirmed = await confirmDraft(world, 'goal.confirmDraft:s6b3-binding-reopen', round.held.round, 0);
      await reopenS6B3Host(world);
      const ctx = world.host.humanContext();
      const bindings = bindingPort(world);
      expect(await bindings.readBindingByAnswerDraft(ctx, { answerRef: round.answerRef, draftIndex: 0 }))
        .toEqual({ status: 'ready', value: confirmed.value.binding });
      expect(await bindings.readBindingByGoal(ctx, { goalRef: confirmed.value.goal.ref }))
        .toEqual({ status: 'ready', value: [confirmed.value.binding] });
    };
    await exercise();
  });
});
