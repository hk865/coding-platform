/** V-restart (book-7b.md §5 `:1224`; SR5 §5.4, §5.9): a crash at the Query submit, the proposal or the adoption
 * resumes at the first missing stage after a same-directory reopen; one QueryJob/QueryRun, one proposal and one
 * adoption remain, and the Query makes no second model call. SQLite only (`tests/RULES.md:193`-`:195` S3).
 * `commitBarrier.hold` pauses the stage's real commit; the stage lands, `crash` abandons the Host, and the same
 * message is re-offered. The reopened Host's pending GoalInterruption is cleared only by a person's Goal-level
 * `workflow/driver-start` (its Host `onStarted`), so the driver's own work commit is held while the intervention
 * replays; no owner write stands in for that start. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { GoalDisplayRead, PlanProposalRef } from '../../src/core/work-graph/model/plan-contracts.js';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import { planProposalIdFor } from '../../src/core/work-graph/tasks/plan-service.js';
import { sessionMessageRefKey } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { byIdentityPrefix, commitBarrier, type CommitHold } from '../helpers/S6A-commit-barrier.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { openS7BPlanningWorld, type S7BPlanningWorld } from '../helpers/S7B3-planning-world.js';
import { driveS7BIntervention, interveneS7B, refinementPlanFrom, s7bVWorkProfile }
  from '../helpers/S7B-V-fixture.js';
import { waitFor } from './harness.js';
import { readActivePlan } from './support/S5-decisions.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));
const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  expect(left).toEqual([]);
});

/** One settled handler call; a card or a rejection is the row's own failure. */
async function claimed(world: S6AHostWorld, messageRef: SessionMessageRef, profile: ReturnType<typeof s7bVWorkProfile>) {
  const result = await driveS7BIntervention(world, messageRef, profile,
    settled => settled.status === 'claimed' || settled.status === 'rejected'
      || settled.status === 'awaiting_decision');
  if (result.status !== 'claimed') throw new Error(`V-restart: the handler did not claim: ${JSON.stringify(result)}`);
  return result;
}
const proposalRefOf = (messageRef: SessionMessageRef, goalRef: S7BPlanningWorld['goalRef']): PlanProposalRef => ({
  aggregateType: 'PlanProposal', projectId: messageRef.projectId, workspaceId: messageRef.workspaceId,
  proposalId: planProposalIdFor({ projectId: messageRef.projectId, workspaceId: messageRef.workspaceId,
    goalId: goalRef.goalId, requestId: `intervention:${sessionMessageRefKey(messageRef)}:propose` }),
});
const gates = [
  { name: 'the Query submit', match: 'query-job-submit:' },
  { name: 'the proposal', match: 'plan-propose:' },
  { name: 'the adoption', match: 'plan-apply:' },
] as const;

describe('V-restart (SQLite only: the Host restart)', () => {
  it.each(gates)('a crash at $name resumes at the first missing stage with no duplicate', async ({ name, match }) => {
    const planning = await openS7BPlanningWorld({ backend: 'sqlite' });
    worlds.push(planning.world);
    const { world, goalRef, messageRef, sessionRef } = planning;
    const profile = s7bVWorkProfile();
    const before = await readActivePlan(world.platform, world.humanContext(), goalRef);
    const taskId = `s7b3-v-restart-${match.replace(/:$/u, '')}`;
    const answerText = refinementPlanFrom(before, goalRef, { label: taskId, taskId,
      role: S6A_WORK_ROLE.templateId, planId: 's7b3-v-restart-plan', summary: 'S7B3 V-restart' });
    await world.scripted.script(sessionRef, [{ kind: 'text', text: answerText }]);

    // One drive to the claim; the hold pauses the one commit of the stage under test. The adoption stage also
    // holds the task-claim commit that follows its adoption commit, so the crash leaves the adoption landed and
    // the claim missing; the reopened Host's own call is the result the row reads.
    const hold: CommitHold = commitBarrier.hold(byIdentityPrefix(match), `the ${name} commit`);
    let released = false;
    const drive = (async () => {
      for (let step = 0; step < 16; step += 1) {
        const result = await interveneS7B(world, messageRef, profile);
        if (result.status === 'rejected' || result.status === 'awaiting_decision') {
          throw new Error(`V-restart: ${JSON.stringify(result)}`);
        }
        if (result.status === 'claimed' || released) return result;
      }
      throw new Error('V-restart: the handler did not settle');
    })();
    await hold.reached;
    const adoptionClaim: CommitHold | undefined = match === 'plan-apply:'
      ? commitBarrier.hold(byIdentityPrefix('task-claim:'), 'the post-adoption claim') : undefined;
    released = true;
    hold.release();
    if (adoptionClaim === undefined) {
      await drive;
    } else {
      await adoptionClaim.reached;
      expect(ready(await world.platform.plans.readPlanProposal(world.humanContext(), proposalRefOf(messageRef, goalRef)),
        'the accepted proposal')).toMatchObject({ status: 'accepted', sourceMessageRef: messageRef });
    }
    await world.crash();
    // The Query gate's Run starts only after the reopen, so its answer is queued for the reopened model.
    if (match === 'query-job-submit:') await world.scripted.script(sessionRef, [{ kind: 'text', text: answerText }]);
    // The pending GoalInterruption is resolved only by a person's Goal-level driver start; the driver's own work
    // commit is held so it cannot claim ahead of the replayed intervention. No owner write stands in for the start.
    const goalDisplay = async (): Promise<GoalDisplayRead['display']> => ready<GoalDisplayRead>(
      await world.post('goals/display', plain(S6A_SCOPE, { goalRef })), 'the Goal display').display;
    expect((await goalDisplay()).causes)
      .toContainEqual(expect.objectContaining({ code: 'interrupted_pending_resume' }));
    const driverClaim: CommitHold = commitBarrier.hold(byIdentityPrefix('task-claim:'), 'the driver work commit');
    expect((await world.post('workflow/driver-start', plain(S6A_SCOPE, {
      advance: { schemaVersion: 1, goalRef, flowId: 's7b3-v-restart-driver', sessionHint: null, kind: 'select_work' },
      queryProfileIds: [] }))).body).toMatchObject({ status: 'ready' });
    await driverClaim.reached;
    await waitFor(goalDisplay, value => value.causes.every(cause => cause.code !== 'interrupted_pending_resume'),
      'the pending Goal interruption to be cleared');
    const result = await claimed(world, messageRef, profile);

    // The reopened Host finds the landed fact and the next call resumes from there.
    expect(result).toMatchObject({ status: 'claimed', branch: 'no_task' });
    const queries = ready<{ items: unknown[] }>(await world.post('sessions/queries',
      plain(S6A_SCOPE, { sessionRef: sessionRef.ref, page: { limit: 20 } })), 'the line Queries').items;
    expect(queries).toHaveLength(1);
    const query = await readQuery(world.ag2b, interventionPlanningQueryRefs(messageRef).queryJobRef);
    expect(query.job.job.intent.execution).toMatchObject({ kind: 'intervention_planning',
      sourceMessageRef: messageRef });
    expect(ready(await world.platform.plans.readPlanProposal(world.humanContext(), proposalRefOf(messageRef, goalRef)),
      'the proposal')).toMatchObject({ status: 'accepted', sourceMessageRef: messageRef });
    expect((await readActivePlan(world.platform, world.humanContext(), goalRef)).planRevision)
      .toBe(before.planRevision + 1);
    expect(ready<{ items: unknown[] }>(await world.post('sessions/executions',
      plain(S6A_SCOPE, { sessionRef: sessionRef.ref, page: { limit: 20 } })), 'the line executions').items)
      .toHaveLength(1);
    expect(await world.scripted.requests(sessionRef), 'the Query made one model call').toHaveLength(1);

    // Same message, same command ids: a re-offer reaches the landed facts and writes nothing new (the occupied
    // line refuses a second execution; the one Query, proposal, adoption and claim stay).
    expect(await interveneS7B(world, messageRef, profile)).toMatchObject({ status: 'rejected', code: 'busy' });
    expect((await readActivePlan(world.platform, world.humanContext(), goalRef)).planRevision)
      .toBe(before.planRevision + 1);
    expect(ready<{ items: unknown[] }>(await world.post('sessions/queries',
      plain(S6A_SCOPE, { sessionRef: sessionRef.ref, page: { limit: 20 } })), 'the line Queries').items)
      .toHaveLength(1);

    // The new Host's assertions hold; only now do the old adoption call's held claim and the driver's held work
    // commit run, and the driver is stopped.
    adoptionClaim?.release();
    await drive.catch(() => undefined);
    driverClaim.release();
    await world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef }));
  }, 120_000);
});
