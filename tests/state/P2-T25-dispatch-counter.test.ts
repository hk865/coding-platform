/**
 * P2 T25 (frozen `p2-frozen.md:339`; §2.5 counter): only a claim served by a dispatch request moves the
 * counter 0 -> 1; report, stop, ask and an ordinary claim leave it. `lastActionRef` has no public read on
 * this tree: the plan records that observation as UNSPECIFIED instead of reading the store.
 * The four non-claim rows really run their entry; the ask row sends a real `ask_copy` question and
 * checks the counter through the public `goals/dispatch-basis` read. The world currently reds in
 * setup at the G3 Host assembly (`core-routes.ts:1301`, `readRunningCommands`), before any row.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { performClaim, dispatchSequence, p1Worlds, requestOf, write } from '../helpers/P1-reads.js';
import { hostClaim } from '../helpers/P1-platform-entry.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { heartbeatUntil } from '../helpers/IV-host-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import type { P1World } from '../helpers/P1-round-fixture.js';

const worlds = p1Worlds();
afterEach(async () => { await worlds.closeAll(); });
const LONG = 600_000;

async function dispatchAndClaim(p1: P1World, label: string) {
  const a = await p1.hold(p1.lines.A, label);
  const sent = await p1.world.platform.actionRequests.requestDispatch(a.ctx,
    write({ taskRef: p1.task.tA, reason: `P2 T25 ${label} dispatch` }, `${label}-dispatch`));
  expect(sent).toMatchObject({ status: 'requested' });
  const ref = sent.status === 'requested' ? sent.actionRef : undefined;
  expect(ref).toBeDefined();
  if (ref === undefined) throw new Error(`T25 ${label}: no action ref`);
  const record = await requestOf(p1, ref);
  if (record === null) throw new Error(`T25 ${label}: the request is gone`);
  const claimed = await hostClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tA, `${label}-claim`),
    { servedRequest: { ref, revision: record.revision } });
  expect(claimed).toMatchObject({ status: 'committed' });
  return ref;
}

describe('T25 dispatch counter', () => {
  it('a claim served by the open dispatch request moves the counter 0 -> 1; the request is applied', async () => {
    const p1 = await worlds.open();
    const ref = await dispatchAndClaim(p1, 't25-a');
    expect(await dispatchSequence(p1)).toBe(1);
    expect(await requestOf(p1, ref)).toMatchObject({ state: 'applied' });
  }, LONG);

  it('an ordinary claim with no dispatch request leaves the counter at 0', async () => {
    const p1 = await worlds.open();
    const claimed = await performClaim(p1.world, await p1.claimStep(p1.lines.E, p1.task.tA, 't25-ord'));
    expect(claimed).toMatchObject({ status: 'committed' });
    expect(await dispatchSequence(p1)).toBe(0);
  }, LONG);

  it.each([
    { action: 'stop', why: 'a stop request is not a served claim' },
    { action: 'ask', why: 'an ask is not a served claim' },
  ])('$action: $why; the counter stays at 0', async ({ action }) => {
    const p1 = await worlds.open({ running: true });
    if (action === 'stop') {
      const held = await p1.hold(p1.lines.A, 't25-stop');
      expect(await p1.world.platform.actionRequests.requestStop(held.ctx,
        write({ taskRef: p1.task.tB, reason: 'P2 T25 stop' }, 't25-stop')))
        .toMatchObject({ status: expect.any(String) });
      await held.end();
    } else {
      // The frozen entry is `ask_copy`: the asking round really sends the question.
      // `hold` appends its own closing text after this reply, so the tool call is the
      // round's first model reply.
      await p1.world.scripted.script(p1.lines.A, [{ kind: 'calls', calls: [{
        callId: 't25-ask-copy', name: 'ask_copy',
        args: { line: p1.lines.E.ref, question: 'P2 T25 what does this line already know?' } }] }]);
      const held = await p1.hold(p1.lines.A, 't25-ask');
      await held.end();
      const outbox = await heartbeatUntil(p1.world, () => listed(p1.world, 'outbox', p1.lines.A),
        entries => entries.some(entry => entry.answeredBy === 'copy'), 24);
      expect(outbox.filter(entry => entry.answeredBy === 'copy'), 'the ask really stored one copy question')
        .toHaveLength(1);
      expect(await dispatchSequence(p1), 'an ask must not move the dispatch counter').toBe(0);
      return;
    }
    expect(await dispatchSequence(p1), `${action} must not move the dispatch counter`).toBe(0);
  }, LONG);
});
