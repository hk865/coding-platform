/**
 * A secretary with only a notify opens nothing; the next real request round carries the notify and marks it
 * delivered.
 *
 * Public reads only: the notify comes from a real `messages/send`, the round from `requests/submit` and the Host's
 * own driver, the acceptance from `messages/read`, the delivery from `messages/view` and the carry from the
 * scripted provider's recorded request. The barrier, never a sleep, is the completion signal.
 */
import { afterEach, expect, it } from 'vitest';
import type { SessionMessageReadV1 } from '../../src/core/work-graph/model/communication-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_AT, S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { requestUserText } from '../helpers/S7B2-secretary-rounds.js';
import { openR04World, type R04World } from '../helpers/S7B2-R04-secretary-round.js';

const worlds: R04World[] = [];
afterEach(async () => { await Promise.all(worlds.splice(0).map(opened => opened.world.close())); });

const NOTIFY_BODY = '请知悉：R04 的通知在下一轮请求里随信送达。';

it('L-R04: a notify alone opens nothing and the next real round carries it', async () => {
  const w = await openR04World({ at: S6A_AT });
  worlds.push(w);

  const ref = await w.notify(NOTIFY_BODY);

  // The Host's own consumption pass settles behind the barrier; the clock only clears the frozen throttle.
  const settled = w.world.consumeBarrier();
  w.world.clock.advance(25);
  await settled;

  // Before the request the notify opened no turn and was accepted nowhere.
  expect(w.world.model.calls()).toBe(0);
  // The public projection omits the optional field while nothing is accepted, so its absence is the empty state.
  expect((await w.readMessage(ref)).acceptedInputs).toBeUndefined();

  const submitted = await w.submitRound('s7b2-r04', 'real request');
  await w.world.waitForRequest(submitted.requestRoot,
    view => view.rounds.some(round => round.kind === 'request' && round.status === 'ended'),
    'the R04 request round to end on the Host');

  // After the round the same notify is carried and delivered, and the round was the one model turn.
  const accepted = (await w.readMessage(ref)).acceptedInputs;
  expect(accepted).toHaveLength(1);
  expect(accepted![0]).toEqual(expect.objectContaining({ part: 'message' }));
  const view = ready<SessionMessageReadV1>(await w.world.post('messages/view', plain(S6A_SCOPE, ref)),
    'the R04 message view');
  expect(view.delivery.delivery).toBe('delivered');
  expect(w.world.model.calls()).toBe(1);
  const request = w.world.model.lastRequest();
  expect(requestUserText(request!)).toContain(NOTIFY_BODY);
}, 120_000);
