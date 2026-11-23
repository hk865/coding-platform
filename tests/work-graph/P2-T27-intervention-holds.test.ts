/**
 * P2 T27 (frozen `p2-frozen.md:341`; P1 Q6a): the person's direct-intervention claim on tA
 * releases every hold reason, the secretary's and the scribe's, in its own commit. This row
 * is GREEN at the base tag; the named mutation is the release-all line inside the claim.
 * Service row: the hold owner, the platform's scribe stop and the marked claim are the P1
 * A7 stand-ins for `claimIntervention` (the Workflow step the Host performs).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { hostClaim, placeScribeStop } from '../helpers/P1-platform-entry.js';
import {
  holdOf, p1Worlds, personRequestsAction, reworkPins, write,
} from '../helpers/P1-reads.js';
import type { P1World } from '../helpers/P1-round-fixture.js';

const worlds = p1Worlds();
afterEach(async () => { await worlds.closeAll(); });
const LONG = 600_000;

async function interventionClaim(p1: P1World) {
  const runA = await p1.failWork(p1.lines.E, p1.task.tA, 'p2-t27');
  const s = await p1.hold(p1.lines.S, 'p2-t27');
  expect(await p1.world.platform.claimHolds.place(s.ctx,
    write({ taskRef: p1.task.tA, reason: 'P2 T27 secretary hold' }, 'p2-t27-hold-s')))
    .toMatchObject({ status: 'committed' });
  expect(await placeScribeStop(p1.world, { taskRef: p1.task.tA, reason: 'P2 T27 scribe stop',
    sourceMessage: s.source, run: runA, operationId: 'p2-t27-scribe' }, 'p2-t27-scribe'))
    .toMatchObject({ status: 'committed' });
  expect((await p1.world.post('tasks/requeue', graphWrite(S6A_SCOPE, {
    taskRef: p1.task.tA, afterRunRef: runA, reason: 'P2 T27 requeue',
  }, 'p2-t27-requeue', await reworkPins(p1, runA)))).body).toMatchObject({ status: 'committed' });
  const messageRef = await personRequestsAction(p1, p1.lines.E, p1.task.tA, 'P2 T27 do tA now',
    'p2-t27-intervene');
  const claimed = await hostClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tA, 'p2-t27'),
    { intervention: { messageRef } });
  expect(claimed).toMatchObject({ status: 'committed' });
  const hold = await holdOf(p1, p1.task.tA);
  expect(hold?.reasons).toHaveLength(2);
  for (const reason of hold?.reasons ?? []) {
    expect(reason).toMatchObject({ state: 'released', releasedBy: { kind: 'intervention', messageRef } });
  }
}

describe('T27 intervention claim releases every hold reason', () => {
  it('T27 tA has S and scribe holds; the marked claim releases both, releasedBy is the intervention', async () => {
    const p1 = await worlds.open();
    await interventionClaim(p1);
  }, LONG);
});
