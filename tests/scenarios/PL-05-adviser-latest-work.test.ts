/**
 * PL-05 (v4 §15-32, DR-P2-09): the adviser line has its own unfinished Work W when the `refine:` system round
 * arrives.
 *
 * The fixture makes the adviser really run W through `workflow/advance`; the Run yields on a waiting inquiry, so
 * this occupancy ends while W stays active, and `sessions/facts` names W as `latestWork`. The `refine:` is sent
 * through P1's real `sendSystemRound` path with no `taskRef`, exactly the ruling's world. The row then reads
 * `sessions/executions` before and after (no increment) and the planning Query on the system message's own
 * deterministic identity.
 *
 * Today `offerKindOf` does not quote a Host system `action_request`, so no planning Query is opened: the red is at
 * "the refine opened a planning Query". Restoring the `latestWork` claim block would also fail the claim-increment
 * half.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  heartbeatUntil, lineFacts, readPlanningQuery, sessionExecutions, settleHost,
} from '../helpers/IV-host-fixture.js';
import {
  openPLConsumptionWorld, seedPLAdviserWork, sendPLRefine,
} from '../helpers/PL-consumption-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

interface TaskRowRead { tasks: Array<{ ref: { taskId: string }; effectivePhase: string }> }

describe('PL-05: a refine round on an adviser line that still has unfinished Work', () => {
  it('PL-05 the adviser does not claim its unfinished W and the refine opens a planning Query', async () => {
    const world = await openPLConsumptionWorld({ label: 'pl05' });
    worlds.push(world);
    await settleHost(world);

    const goal = world.goals.first;
    const seeded = await seedPLAdviserWork(world, { goal, label: 'pl05', taskId: 'pl05-w' });

    // The precondition the ruling names: W is the adviser's latest Work and it is still unfinished.
    const facts = await lineFacts(world, seeded.adviser);
    expect(facts.latestWork?.task, 'the adviser\'s latest Work is W').toMatchObject({ taskId: 'pl05-w' });
    const graph = (await world.post('tasks/query', plain(S6A_SCOPE, { goalRef: goal }))).body as
      { status: 'ready'; value: TaskRowRead };
    expect(graph.status).toBe('ready');
    expect(graph.value.tasks.find(task => task.ref.taskId === 'pl05-w')?.effectivePhase,
      'W is still unfinished').not.toBe('satisfied');

    const before = await sessionExecutions(world, seeded.adviser);
    const refine = await sendPLRefine(world, { goal, line: seeded.adviser, taskId: 'pl05-w',
      planRevision: seeded.plan.planRevision });

    // The system round is consumed by the Host's own loop and opens the planning Query of its source message.
    const query = await heartbeatUntil(world, () => readPlanningQuery(world, refine.messageRef),
      value => value !== null, 16);
    const after = await sessionExecutions(world, seeded.adviser);

    expect(query, 'the refine opened a planning Query').not.toBeNull();
    expect(after.length - before.length, 'the adviser claims no new Work (W is not claimed)').toBe(0);
  }, 120_000);
});
