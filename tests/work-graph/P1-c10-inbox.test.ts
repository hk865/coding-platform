/**
 * P1 rework C10 (`cp1-review-rulings.md`; contract `p1-frozen.md` 2.2, Q2c "the line's workspace"): a planning round
 * whose QueryRun lives in another workspace than its line reads its own non-empty inbox page. XWS2A's two-workspace
 * world: B's Workflow sends a `refine:` round to the main workspace's adviser line (as XWR R1), so the round's Query
 * lives in B (the Goal's) and its message in A (the line's). The round's model request is held and its context is
 * the one the Runtime hands its answer tools (`captureAnswerContexts`); the view is the round's own `readInboxView`
 * (the page `readInbox` already reads the messages in the line's workspace and is ready today).
 *
 * Red until the review's fix (C10): a non-empty view read the recipient line with the round's own (B) context, where
 * the line does not live, so the whole view answered `not_found`.
 * Mutation (lead): `readInboxView` reads the recipient line in the caller's own workspace again, not the workspace
 * the page's messages live in.
 */
import { afterEach, expect, it } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { heartbeatUntilModel } from '../helpers/IV-host-fixture.js';
import { captureAnswerContexts } from '../helpers/query-context-capture.js';
import { openXWS2AWorld, refineRound, type XWS2AWorld } from '../helpers/XWS2A-world.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.allSettled(closers.splice(0).map(close => close())); });

it('C10: the main adviser\'s round of B\'s Goal (Query in B, line in A) reads its own non-empty inbox view: ready, with its round message', async () => {
  const world: XWS2AWorld = await openXWS2AWorld({ backend: 'memory', extraHostOptions: { scribeReminderPeriodMs: 25 } });
  closers.push(() => world.close());
  await world.waitCoarseAnswered();
  const host = world.base.world;
  const b = world.second.workspace;
  await host.scripted.script(world.adviser, [{ kind: 'text', text: 'P1 C10 answer' }]);
  const model = await host.gates.modelRequest(world.adviser);
  const capture = captureAnswerContexts();
  try {
    expect((await refineRound(b, world.second.goal, 'p1-c10'))?.sessionId).toBe(world.adviser.ref.sessionId);
    await heartbeatUntilModel(host, model, 24);
    const occupancy = (await host.readSession(world.adviser)).record.occupancy;
    const ctx = occupancy?.kind === 'execution' ? capture.ofRun(occupancy.executionRef.runId) : undefined;
    if (ctx === undefined) throw new Error('P1 C10: no held round context');
    // The premise: the round runs in B while its line (and its inbox) is A's.
    expect(ctx.workspaceId).toBe(b.scope.workspaceId);
    const roundMessage = await refineMessageOf(world);
    const view = await host.platform.messages.readInboxView(ctx, { recipient: world.adviser.ref, page: { limit: 50 } });
    expect(view, JSON.stringify(view)).toMatchObject({ status: 'ready' });
    if (view.status === 'ready') {
      expect(view.value.items.map(item => item.message.ref.messageId)).toContain(roundMessage.ref.messageId);
    }
  } finally {
    capture.restore();
    model.release();
  }
}, 240_000);

/** The `refine:` system round in the adviser line's public inbox (A's `messages/inbox`). */
async function refineMessageOf(world: XWS2AWorld): Promise<SessionMessage> {
  for (const message of await world.inbox(world.adviser)) {
    if (message.sender.kind === 'host' && message.sender.actor.kind === 'system'
      && (await world.messageText(message)).startsWith('refine:')) return message;
  }
  throw new Error('P1 C10: no refine round in the adviser inbox');
}
