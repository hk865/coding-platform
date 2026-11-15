/**
 * G6F F4 (decision 121-131, `g6f-rulings.md` F4, rows G1/G2): what the secretary is told about a completed Goal.
 * World: the S7B-V completed-Goal world (`openS7BPlanningWorld` + `completeS7BGoal`), the intervention's goal-less
 * request (`S7B-V-intervention.test.ts` "a completed Goal") and the published claim/prepare/start steps; the input is
 * the user text of the secretary's model request. Public steps and reads only; memory only (S3: no storage rule).
 * The new line's wording is the builder's: rows match its facts, not a sentence.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { secretaryAnswer } from '../helpers/S6A-history-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { requestUserText } from '../helpers/S7B2-secretary-rounds.js';
import { openS7BPlanningWorld } from '../helpers/S7B3-planning-world.js';
import { completeS7BGoal, interveneS7B, s7bVWorkProfile } from '../helpers/S7B-V-fixture.js';
import { claimWithSecretaryProfile, prepareAttempt, start } from '../helpers/request-claim-steps.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

/** Goal 1 completed; a person message on its line became the goal-less request; one secretary round ran on it. */
async function completedGoalRound() {
  const planning = await openS7BPlanningWorld();
  worlds.push(planning.world);
  const { world, goalRef, sessionRef } = planning;
  await completeS7BGoal(planning);
  const message = await sendS7A2PersonMessage(world, { label: 'g6f', recipient: sessionRef.ref, goal: goalRef });
  const asked = await interveneS7B(world, message.ref, s7bVWorkProfile());
  expect(asked).toMatchObject({ status: 'requested', branch: 'goal_completed' });
  const requestRef = (asked as { requestRef: QueryJobRef }).requestRef;
  const secretary = await world.createSecretary('g6f-secretary');
  expect(await world.route({ commandId: 'g6f-route', round: requestRef, to: secretary })).toMatchObject({ status: 'routed' });
  expect(await claimWithSecretaryProfile(world, requestRef, secretary, 'g6f-claim')).toMatchObject({ status: 'committed' });
  const prepared = await prepareAttempt(world, requestRef, 'g6f-prepare');
  await world.scripted.script(secretary, [{ kind: 'text', text: secretaryAnswer({ body: 'G6F answer',
    goalCardDrafts: [{ objective: 'G6F new Goal', completion: ['G6F done'], autonomy: 'after_plan_confirmation',
      screening: null }] }) }]);
  expect(await start(world, prepared, 'g6f-start')).toMatchObject({ status: 'ready' });
  const first = (await world.scripted.requests(secretary))[0];
  if (first === undefined) throw new Error('G6F: the secretary round sent no model request');
  return { world, goalRef, otherGoal: planning.noPlanGoalRef, requestRef, input: requestUserText(first) };
}

/** The lines under one `##` heading of the input, up to the next heading. */
function sectionLines(input: string, heading: string): string[] {
  const lines = input.split('\n');
  const at = lines.indexOf(heading);
  if (at < 0) throw new Error(`G6F: the secretary input has no "${heading}":\n${input}`);
  const rest = lines.slice(at + 1);
  const end = rest.findIndex(line => line.startsWith('#'));
  return end < 0 ? rest : rest.slice(0, end);
}

describe('G6F F4: the secretary input names a completed Goal\'s phase and the request\'s source', () => {
  it('G1: the Goals list marks the completed Goal with its COMPLETED phase beside desiredState', async () => {
    // Red today: the goal line is `[active]` only (context-secretary-recipe.ts:334-335). Mutation: write only
    // desiredState -> goal 1's line has no COMPLETED -> red; COMPLETED on every goal -> goal 2's line reds.
    const { goalRef, otherGoal, input } = await completedGoalRound();
    const goals = sectionLines(input, '## Goals').filter(line => line.startsWith('- '));
    const completed = goals.find(line => line.includes(goalRef.goalId));
    const open = goals.find(line => line.includes(otherGoal.goalId));
    expect(completed).toMatch(/\bactive\b/);
    expect(completed).toMatch(/COMPLETED/i);
    expect(open).toBeDefined();
    expect(open).not.toMatch(/COMPLETED/i);
  }, 120_000);

  it('G2: the round says it came from goal 1\'s line, goal 1 is completed and a goal card comes first; the request read keeps the source Goal', async () => {
    // Red today: request-service.ts:1053-1056 drops `goalRef`/`sourceMessageRef`, so no such line and no source in
    // `requests/read`. Mutation: drop the source again -> both checks red.
    const { world, goalRef, requestRef, input } = await completedGoalRound();
    const round = sectionLines(input, '## This round');
    const namesGoal = (line: string) => line.includes(goalRef.goalId) || /(目标|goal)\s*1(?!\d)/i.test(line);
    expect(round.some(line => namesGoal(line) && /completed|已完成/i.test(line) && /goal[ -]?card|目标卡/i.test(line)),
      round.join('\n')).toBe(true);
    const read = ready<Record<string, unknown>>(await world.post('requests/read',
      plain(S6A_SCOPE, { requestRoot: requestRef })), 'requests/read');
    expect(read).toMatchObject({ goalId: null, effectiveGoalId: null });
    expect(JSON.stringify(read)).toContain(JSON.stringify(goalRef.goalId));
  }, 120_000);
});
