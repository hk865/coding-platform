/** INT R1 rows (§4.1): an unaddressed person message stays in the mailbox when its line is an adviser
 *  (even one with Work history) or an executor that never did Work.
 *  Q1 is red on the base; mutation: drop R1's hold. Q2 is the executor line-that-did-Work guard.
 *  Q3 (optional) has no public path: `messages/send` refuses `taskRef` without `goalRef`. */
import { afterEach, expect, it } from 'vitest';
import { openPLConsumptionWorld, seedPLAdviserWork } from '../helpers/PL-consumption-fixture.js';
import { settleHost } from '../helpers/IV-host-fixture.js';
import { openS7BWorld, runS7BWait } from '../helpers/S7B-fixture.js';
import { intAwaitPlanning, intMessage, intOffer, intSendPerson } from '../helpers/INT-world.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.allSettled(closers.splice(0).map(close => close())); });

it('INT-Q1 a no-goal person message on the adviser line no longer holds a goal-named message behind it', async () => {
  const world = await openPLConsumptionWorld({ label: 'int-q1' });
  closers.push(world.close);
  const goal = world.goals.first;
  // PL-05's precondition: the adviser has its own Work history (`latestWork` is not null).
  const seeded = await seedPLAdviserWork(world, { goal, label: 'int-q1', taskId: 'int-q1-w' });
  await settleHost(world);

  const first = await intSendPerson(world, { id: 'q1-m0', recipient: seeded.adviser.ref,
    text: 'INT-Q1 words without a Goal' });
  const second = await intSendPerson(world, { id: 'q1-m1', recipient: seeded.adviser.ref,
    text: 'INT-Q1 plan this Goal', goal });
  const planning = await intAwaitPlanning(world, second.ref);

  expect(planning, 'M1 opens its planning Query').not.toBeNull();
  expect(planning?.job.job.goalId, 'M1 plans the Goal it names').toBe(goal.goalId);
  const held = await intMessage(world, first.ref);
  expect(held.status, 'M0 stays pending').toBe('pending');
  expect(held.acceptedInputs ?? [], 'M0 accepted no input').toEqual([]);
  // The row stops at the half R1 guards (M1's planning Query opens, M0 stays in the mailbox) and counts no model
  // turn: in this world the adviser's own Work (PL-05's seed) waits on a continuation reply to its inquiry, so the
  // planning round is refused `busy` (`archive_wait_disposal_required`) until that wait ends, with or without M0.
}, 120_000);

it('INT-Q2 a line that did Work still receives a person message without a Goal', async () => {
  const opened = await openS7BWorld({ backend: 'memory' });
  closers.push(opened.world.close);
  const { world } = opened;
  const wait = await runS7BWait(world, { label: 'int-q2' });
  await intSendPerson(world, { id: 'q2-m0', recipient: wait.sender.ref, text: 'INT-Q2 words' });
  expect((await intOffer(world, wait.sender))?.nextMessage?.kind).toBe('person_message');
}, 120_000);
