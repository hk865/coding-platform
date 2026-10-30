/**
 * S row S-waits-read (SR6 §6.5; book `7b:1199`): a real wait, then a person's message on that line, then a legitimate
 * intervention Work, and the one public read of the old wait. The wait read is
 * `platform.sessionFacts.readWait` on the same service as `sessions/facts`; the intervention entry is
 * `platform.workflow.handleIntervention` (SR11 §11.5's `S-waits-read`, L's merge). The old wait stays `open` and keeps
 * its `originalRun`; `readWait` on a non-wait message is `not_found`.
 *
 * Memory only: a business row (`tests/RULES.md:193–:195` S3). Every fact comes from the frozen Part A chain: the
 * dual-backend Host world and the two Work Sessions' real runs (`S7B-fixture.ts` §3.1–3.2).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { openS7BInterventionWorld, openS7BWorld } from '../helpers/S7B-fixture.js';

describe('S7B S-waits-read (memory)', () => {
  const worlds: S6AHostWorld[] = [];
  afterEach(async () => {
    for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  });

  it('S-waits-read a person message opens an intervention Work and the public read still shows the old wait', async () => {
    const { world } = await openS7BWorld({ backend: 'memory' });
    worlds.push(world);
    const { wait, run } = await openS7BInterventionWorld(world, { label: 's-waits-read' });
    const inbox = ready<{ items: SessionMessage[] }>(await world.post('messages/inbox',
      plain(S6A_SCOPE, { recipient: wait.waitingSession, page: { limit: 20 } })), 'the intervention inbox');
    const sent = inbox.items.find(message => message.intent === 'action_request')!;
    const interventionRun = ready<TaskExecutionRecord>(await world.post('executions/read',
      plain(S6A_SCOPE, run)), 'the intervention execution');
    const consumedWait = interventionRun.run.consumedWait;
    expect(consumedWait).toMatchObject({ kind: 'intervention', messageRef: sent.ref });
    const messageRef = sent.ref;

    // The old wait is not hidden by the newer intervention claim and keeps its original Run.
    const facts = ready<SessionFactsV1>(await world.post('sessions/facts',
      plain(S6A_SCOPE, wait.waitingSession)), 'the waits of the waiting line');
    expect(wait).toMatchObject({ state: { state: 'open', reason: null } });
    expect(wait.originalRun).not.toBeNull();
    expect(facts.waits[0]).toMatchObject({ messageRef: wait.messageRef, originalRun: wait.originalRun,
      state: { state: 'open' } });
    expect(facts.wait).toMatchObject({ messageRef: wait.messageRef, runRef: wait.originalRun });

    // `readWait` is the wait read, not a message read: a non-wait message is `not_found`.
    const nonWait = await world.platform.sessionFacts.readWait(world.humanContext(), { messageRef });
    expect(nonWait).toMatchObject({ status: 'not_found' });

    // The same Session facts still say the line waits for its reply (2C T7's read).
    expect(facts).toMatchObject({ wait: { messageRef: wait.messageRef, runRef: wait.originalRun } });
  });
});
