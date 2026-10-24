/**
 * A card question reaches the secretary (slice-6 spec L6, "问秘书" on a card):
 * the follow-up round an `ask` queues runs on the request's owner through the
 * Host's own request driver, and the input the secretary's model receives lists
 * the card's refs under `## Cards` in that round's material, one line per ref
 * with its pinned revision; an object that moved after the card was read shows
 * ` (now @<current>)`, one that does not exist ` (not found)`.
 *
 * Steps, all public: the request on goal 1 answered on a secretary
 * (`requests/submit` with `@`, the Host driver, the scripted model), a
 * candidate tied to it (`plans/propose` with `requestRef`), its card read from
 * `decisions/queue`, goal 1's revision moved (`goals/settings/set`), then
 * `requests/ask` over HTTP with the card's `source.pins` and the ref of a goal
 * that was never created. Memory and SQLite.
 *
 * The expected round block is written by hand from the secretary strings
 * (`## This round`, `## Cards`), the round material's line format and the
 * answer format sample of tests/helpers/S6A-prompt-samples.ts, filled with the
 * values the public steps returned (the round's `since` from the request read,
 * the ids, the pinned and moved revisions).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VersionedRef } from '../../src/contracts/ledger.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { cardRefsOf, s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import {
  answeredRound, initializeProject, newRequest, secretaryAnswer, waitForRound,
} from '../helpers/S6A-history-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { SECRETARY_ANSWER_FORMAT_V1 } from '../helpers/S6A-prompt-samples.js';
import { S6A_GOAL_1, S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  const left = commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close();
  expect(left).toEqual([]);
});

/** The last user message of the last model request the Session's queue served: the round's whole input. */
async function lastInput(world: S6AHostWorld, session: S6ASession): Promise<string> {
  const last = (await world.scripted.requests(session)).at(-1);
  if (last === undefined) throw new Error(`${session.label} served no model request`);
  for (let index = last.messages.length - 1; index >= 0; index -= 1) {
    const message = last.messages[index] as { role?: string; content?: unknown } | undefined;
    if (message?.role === 'user' && typeof message.content === 'string') return message.content;
  }
  throw new Error(`the last model request of ${session.label} has no user input`);
}

describe.each(['memory', 'sqlite'] as const)('a card question in the secretary input (%s)', (backend) => {
  it('lists the card refs; a moved object shows its current revision, a missing one is not found', async () => {
    const world = await openS6AHostWorld({ backend, extraHostOptions: { requestDriver: 'on' } });
    worlds.push(world);
    await initializeProject(world);
    const secretary = await world.createSecretary('s6a-cards-context-secretary');
    const workspace = s6aCardsWorkspace(world, S6A_SCOPE);

    const root = await answeredRound(world, { session: secretary, answer: secretaryAnswer({ body: 'a first plan' }),
      submit: newRequest('s6a-cards-context-root', secretary, 'plan the module work') });
    const candidate = await workspace.proposeCandidate({ label: 's6a-cards-context-candidate', goal: world.goals.first,
      request: { label: 'root', goalId: S6A_GOAL_1.goalId, text: 'plan the module work', requestRoot: root.requestRoot,
        round: root.round, secretary: root.secretary, created: false } });
    const card = (await workspace.readCards(world.goals.first))
      .find(entry => entry.requestRef?.queryJobId === root.requestRoot.queryJobId);
    if (card === undefined) throw new Error('the queue shows no card of the request');
    // The card pins goal 1 and the candidate (goal 1 has no adopted Plan, so nothing else).
    const goalPin = card.source.pins[0]!;
    expect(card.source.pins).toEqual([
      { ref: world.goals.first, revision: goalPin.revision },
      { ref: candidate.proposal.ref, revision: candidate.proposal.revision },
    ]);
    const moved = await workspace.moveGoal(world.goals.first, 's6a-cards-context-move');
    expect(moved.before).toBe(goalPin.revision);

    const missing: VersionedRef = {
      ref: { aggregateType: 'Goal', projectId: S6A_SCOPE.projectId, goalId: 's6a-cards-context-no-such-goal' }, revision: 1,
    };
    await world.scripted.script(secretary, [{ kind: 'text', text: secretaryAnswer({ body: 'the card answer' }) }]);
    const asked = await workspace.route('requests/ask', { commandId: 's6a-cards-context-ask', round: root.round,
      cardRefs: [...cardRefsOf(card), missing], regenerate: false, text: 'why does the plan start here?' }) as
      { status: string; followupRound: QueryJobRef };
    expect(asked.status).toBe('queued');
    const view = await waitForRound(world, root.requestRoot, asked.followupRound, 'ended');
    const followup = view.rounds.find(round => round.ref.queryJobId === asked.followupRound.queryJobId)!;
    expect(followup.session).toEqual(secretary.ref);

    const P = S6A_SCOPE.projectId;
    const proposal = candidate.proposal.ref;
    expect(await lastInput(world, secretary)).toContain([
      '## This round',
      `- [${followup.since}] why does the plan start here?`,
      '## Cards',
      `- Goal {"goalId":"${S6A_GOAL_1.goalId}","projectId":"${P}"} @${moved.before} (now @${moved.after})`,
      `- PlanProposal {"projectId":"${P}","proposalId":"${proposal.proposalId}","workspaceId":"${proposal.workspaceId}"}`
        + ` @${candidate.proposal.revision}`,
      `- Goal {"goalId":"s6a-cards-context-no-such-goal","projectId":"${P}"} @1 (not found)`,
      '',
      SECRETARY_ANSWER_FORMAT_V1,
    ].join('\n'));
  });
});
