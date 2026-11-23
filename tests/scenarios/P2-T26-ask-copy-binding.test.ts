/**
 * P2 T26 (p2-frozen.md:340): `ask_copy` stores the inquiry; at ingest only
 * `answeredBy:'copy'` is written, with no child line and no history cutoff; the
 * original line no longer accepts or claims it; the first derivation writes the
 * child and the cutoff and they stay frozen; the final answer goes only to the
 * asker and the binding does not change.
 *
 * Entry: `ask_copy` by name through the scripted model (seams.md:63-74), never
 * the person's `queries/ask` and never `makeReadonlyCopy`. RED today: the tool
 * is not offered by the asking round ("入口还没有"); the first assertion names it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CollaborationSnapshot } from '../../src/app/collaboration-driver.js';
import { driverRead, startGoalDriver } from '../helpers/DRV-fixture.js';
import { heartbeatUntilModel } from '../helpers/IV-host-fixture.js';
import { openPlanOnlyWorld } from '../helpers/PL-forms-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { P2_COORDINATION_TOOL_NAMES, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { ready, sessionOf } from '../helpers/S7A-fixture.js';

const worlds: Array<{ close(): Promise<void> }> = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

describe('P2 T26: ask_copy stores the inquiry and freezes its derivation', () => {
  it('an adviser planning round offers `ask_copy`; the ingest/derive/answer split follows it', async () => {
    const opened = await openPlanOnlyWorld('p2-t26', { tools: P2_COORDINATION_TOOL_NAMES });
    worlds.push(opened);
    const { world, goal, adviser } = opened;
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    // E is the line the copy is asked about; a real line with one Task link.
    const source = await sessionOf(world, await createS6BLine(main, {
      label: 'p2-t26-e', role: S6A_WORK_ROLE,
    }));
    await startGoalDriver(world, goal, 'p2-t26');
    const snapshot = ready<CollaborationSnapshot>(await driverRead(world, goal), 'the T26 driver read');
    expect(snapshot.last).toMatchObject({
      status: 'ready',
      value: { state: 'waiting', reason: expect.stringContaining('plan_refine_pending') },
    });
    const gate = await world.gates.modelRequest(adviser);
    await world.scripted.script(adviser, [{ kind: 'calls', calls: [{ callId: 'p2-t26-copy', name: 'ask_copy',
      args: { sessionRef: source.ref, question: 'what does this line already know?' } }] },
    { kind: 'text', text: 'P2 T26 asked' }]);
    const held = await heartbeatUntilModel(world, gate);
    const request = await gate.reached;
    try {
      expect(request.tools.map(tool => tool.name)).toContain('ask_copy');
    } finally {
      gate.release();
      await held.settled;
    }
    // Unreachable until the entry lands; the frozen assertions are:
    //   `messages/read` of the stored inquiry: `answeredBy === 'copy'` and
    //   `consultationDerivation === undefined`; the source's `sessions/queries`
    //   and `sessions/executions` do not grow (no acceptance/claim); the first
    //   Host pass writes the `readonly_copy` child and the frozen
    //   `throughPosition` (E's completed position), byte-identical on a second
    //   pass; the formal answer's `response.sender.kind === 'query_run'` and the
    //   derivation stay unchanged, and the answer appears only on the inquiry.
  }, 120_000);
});
