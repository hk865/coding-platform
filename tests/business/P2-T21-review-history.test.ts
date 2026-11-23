/**
 * P2 T21 (p2-frozen.md:335): the same reviewer line's previous round leaves a
 * recognizable passage; the next formal review round's full model request
 * contains none of that history.
 *
 * The first formal round is answered with `submit_exec_review` whose report is
 * the marker; a second formal round (a second Goal's subject Task, the same
 * reviewer line) is then opened through the real Host. The assertion is on the
 * request the scripted model actually receives (`scripted.requests`), not on a
 * `read_execution_history` refusal.
 *
 * RED today: the second round takes the line's session history
 * (`context-history-facts.ts:36-47`, `hasCompletedCursor`), so the marker is in it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { adoptPLPlanDraft } from '../helpers/PL-workflow-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import {
  answerS9Review, openS9ReviewWorld, s9ReviewDraft, type S9ReviewWorld,
} from '../helpers/S9-review-fixture.js';
import { S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { sessionOf } from '../helpers/S7A-fixture.js';

const MARKER = 'P2-T21-REVIEW-HISTORY-7f3a';

const worlds: S9ReviewWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

describe('P2 T21: a formal review round carries no previous-round history', () => {
  it('the second formal review round request contains none of the first round marker', async () => {
    const review = await openS9ReviewWorld({ reviewLine: 'open' });
    worlds.push(review);
    const line = review.reviewLine;
    if (line === null) throw new Error('P2 T21: the world opened no reviewer line');

    // The previous round on this very line: a real exec-review answer whose
    // report is the recognizable passage.
    await answerS9Review(review, [{ kind: 'calls', calls: [{ callId: 'p2-t21-first', name: 'submit_exec_review',
      args: { verdict: 'pass', basis: 'P2 T21 first basis', report: MARKER } }] }]);
    const firstRequests = await review.world.scripted.requests(line);
    expect(firstRequests).toHaveLength(1);

    // A second Goal and its subject Task, reviewed by the SAME reviewer line.
    const goal2 = (await review.main.createGoal('p2-t21-g2', 'P2 T21 second goal')).ref;
    await adoptPLPlanDraft(review.main, goal2, { ...s9ReviewDraft(goal2), planId: 'p2-t21-plan-2' }, 'p2-t21');
    const task2 = { projectId: goal2.projectId, goalId: goal2.goalId, taskId: 's9-work' };
    const work2 = await sessionOf(review.world, await createS6BLine(review.main, {
      label: 'p2-t21-work-2', role: S6A_WORK_ROLE, tasks: [task2],
    }));
    const second: S9ReviewWorld = { ...review, goal: goal2, task: task2, workLine: work2 };

    // The second formal round: a real subject Run, the real send, the real Host pass.
    await review.world.scripted.script(line, [{ kind: 'calls', calls: [{ callId: 'p2-t21-second',
      name: 'submit_exec_review', args: { verdict: 'pass', basis: 'P2 T21 second basis', report: 'second report' } }] }]);
    let secondRoundProblem: string | null = null;
    try {
      await answerS9Review(second, 'pass');
    } catch (reason) {
      secondRoundProblem = reason instanceof Error ? reason.message : String(reason);
    }
    // Never swallow: a second round that does not open is the blocked step, reported here as red.
    expect(secondRoundProblem, 'P2 T21: the second formal review round must open (blocked step)').toBeNull();

    const requests = await review.world.scripted.requests(line);
    expect(requests.length).toBeGreaterThanOrEqual(2);
    const last = requests.at(-1);
    expect(last).toBeDefined();
    expect(JSON.stringify(last)).not.toContain(MARKER);
  }, 300_000);
});
