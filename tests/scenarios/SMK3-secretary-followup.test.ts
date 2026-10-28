/**
 * SMK3-2 (§2; book 6A §4 item 2 `book-6a.md:531`, `:540-541`, `:544-545`; book 6B item 7 `book-6b.md:498-502`):
 * a secretary follow-up after `goals/confirm-draft` is prepared from the request's effective goal and answered.
 *
 * The S6A Host world drives every round; a no-goal request is answered with one goal card draft, the draft is
 * confirmed, and the scripted reply of the owner Session is queued before each `requests/ask`. Before §2 the
 * follow-up stays `claimed`: preparation read the round's own null `goal.goalId`, while the secretary recipe
 * requires the confirmed effective goal's facts. The public read is the request read; no store is read.
 */
import { afterEach, expect, it } from 'vitest';
import type { GoalConfirmDraftReceiptV1 } from '../../src/contracts/goal-card.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { answeredRound, initializeProject, secretaryAnswer, waitForRound } from '../helpers/S6A-history-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { post } from '../helpers/A2-restart-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

const DRAFT = { objective: 'SMK3 follow-up draft', completion: ['SMK3 follow-up criterion'],
  autonomy: 'after_plan_confirmation', screening: null } as const;

it('a follow-up after a confirmed draft is prepared and answered, then the Session answers another', async () => {
  const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'on' } });
  worlds.push(world);
  await initializeProject(world);
  const secretary = await world.createSecretary('smk3-followup');
  const root = await answeredRound(world, { session: secretary,
    answer: secretaryAnswer({ body: 'SMK3 root answer', goalCardDrafts: [DRAFT] }),
    submit: { commandId: 'smk3-root', goalId: null, text: 'SMK3 plan the work', continues: null, recipient: secretary } });
  const confirmed = await post<Record<string, unknown>>(world.ag2b, 'goals/confirm-draft',
    plain(S6A_SCOPE, { commandId: 'smk3-confirm', round: root.round, index: 0 }));
  expect(confirmed['status']).toBe('committed');
  const goalId = (confirmed['value'] as GoalConfirmDraftReceiptV1).goal.ref.goalId;
  expect((await world.readRequest(root.requestRoot)).effectiveGoalId).toBe(goalId);

  const ask = async (label: string): Promise<QueryJobRef> => {
    await world.scripted.script(secretary, [{ kind: 'text', text: secretaryAnswer({ body: `SMK3 ${label} follow-up` }) }]);
    const body = await post<Record<string, unknown>>(world.ag2b, 'requests/ask',
      plain(S6A_SCOPE, { commandId: `smk3-ask-${label}`, round: root.round,
        cardRefs: [{ ref: root.round, revision: 1 }], regenerate: false, text: `SMK3 ${label}: why this order?` }));
    expect(body['status'], label).toBe('queued');
    return body['followupRound'] as QueryJobRef;
  };

  const first = await ask('first');
  const firstView = await waitForRound(world, root.requestRoot, first, 'ended');
  expect(firstView.rounds).toContainEqual(expect.objectContaining({ ref: first, status: 'ended', answer: 'SMK3 first follow-up' }));
  expect((await world.readRequest(root.requestRoot)).effectiveGoalId).toBe(goalId);

  const second = await ask('second');
  const secondView = await waitForRound(world, root.requestRoot, second, 'ended');
  expect(secondView.rounds).toContainEqual(expect.objectContaining({ ref: second, status: 'ended', answer: 'SMK3 second follow-up' }));
});
