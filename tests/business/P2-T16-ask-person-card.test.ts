/**
 * P2 T16 (p2-frozen.md:331): the person answers an adviser's `ask_person` card.
 *
 * The entry is the frozen row's own: an adviser planning round calls `ask_person`
 * by name through the scripted model (seams.md:63-74, the tool-argument boundary).
 * The person answers through the public card path (`decisions/card` +
 * `decisions/answer`). RED today: the tool is not in the round's tool list, so
 * the call can never be served ("入口还没有") — the first assertion below names it.
 *
 * Expected values are the frozen row's, not the current code's: an idle adviser
 * opens exactly one decision-answer planning round, writes only a candidate and
 * claims/adopts nothing; an option-only card puts the selected option into the
 * model request; a busy line takes the supply without a new round.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CollaborationSnapshot } from '../../src/app/collaboration-driver.js';
import { driverRead, startGoalDriver } from '../helpers/DRV-fixture.js';
import { heartbeatUntilModel } from '../helpers/IV-host-fixture.js';
import { openPlanOnlyWorld } from '../helpers/PL-forms-fixture.js';
import { P2_COORDINATION_TOOL_NAMES } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';

const worlds: Array<{ close(): Promise<void> }> = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

const IDLE_OPTION = '只读检查';
const SECOND_OPTION = '改这一版';

/** The scripted `ask_person` call the adviser planning round must be able to make. */
const askPerson = (callId: string, question: string) => ({ kind: 'calls' as const, calls: [{
  callId, name: 'ask_person',
  args: { question, options: [{ id: 'opt-read', label: IDLE_OPTION },
    { id: 'opt-change', label: SECOND_OPTION }], expected: [] },
}] });

describe('P2 T16: the person answers an adviser ask_person card', () => {
  it('an adviser planning round offers `ask_person` (the entry); the card path and the candidate-only round follow it', async () => {
    const opened = await openPlanOnlyWorld('p2-t16', { tools: P2_COORDINATION_TOOL_NAMES });
    worlds.push(opened);
    const { world, goal, adviser } = opened;
    // The Goal's refine gap opens one real adviser planning round (G-05's proven path).
    await startGoalDriver(world, goal, 'p2-t16');
    const snapshot = ready<CollaborationSnapshot>(await driverRead(world, goal), 'the T16 driver read');
    expect(snapshot.last).toMatchObject({
      status: 'ready',
      value: { state: 'waiting', reason: expect.stringContaining('plan_refine_pending') },
    });
    const gate = await world.gates.modelRequest(adviser);
    await world.scripted.script(adviser, [askPerson('p2-t16-ask', 'which of the two should this change take?')]);
    const held = await heartbeatUntilModel(world, gate);
    const request = await gate.reached;
    try {
      // The frozen row's entry. Today the round's tool list has no `ask_person`:
      // the call is an unknown tool and no card can exist ("入口还没有").
      expect(request.tools.map(tool => tool.name)).toContain('ask_person');
    } finally {
      gate.release();
      await held.settled;
    }
    // Unreachable until the entry lands; the frozen assertions are:
    //   the card read through `decisions/card`/`decisions/queue`, answered with
    //   `{kind:'option', optionId:'opt-read'}, text:''` and `card.source.pins`;
    //   an idle adviser then opens exactly ONE decision_answer planning round,
    //   writes only a candidate (`plans/request-candidate`), claims/adopts nothing
    //   (`sessions/executions` for the adviser stays empty, the adopted plan revision
    //   unchanged); the selected option label (not the free text) is in the next
    //   model request; a busy line takes the supply without a new round; two cards
    //   share one round; a scribe card opens a text round; a secretary request-round
    //   card only reaches the request queue; a platform card only applies; all
    //   planning-question answers only `planresume`.
  }, 120_000);
});
