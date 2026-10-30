/**
 * K-continuation (`book-7b.md:1196`, SR4 §4.3): the claim's three consumed-wait arms, the input check that names
 * them, and `previousRun` as the released holder on the TaskClaim and the Run. The reply claim is SR11 §11.5's
 * `K-claim` (the M/X green point); until `waitFactsOfRecord`'s body lands, that case is expected red and is kept as a
 * normal `it` (no stand-in).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS7BWorld, answerS7BWait, acceptS7BReply, runS7BWait } from '../helpers/S7B-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';

const worlds: Array<Awaited<ReturnType<typeof openS7BWorld>>['world']> = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

async function openWorld(): Promise<Awaited<ReturnType<typeof openS7BWorld>>['world']> {
  const opened = await openS7BWorld({ backend: 'memory' });
  worlds.push(opened.world);
  return opened.world;
}

describe('the real continuation claim', () => {
  it('C: the first claim writes previousRun: null on the TaskClaim and on the claimed Run', async () => {
    const world = await openWorld();
    const { claim, run } = await runS7BWait(world, { label: 'first-claim' });
    expect(claim.previousRun).toBeNull();
    const record = ready<TaskExecutionRecord>(
      await world.post('executions/read', plain(S6A_SCOPE, run)), 'the first claimed Run');
    expect(record.run.previousRun).toBeNull();
    expect(record.outbox.claim.previousRun).toBeNull();
  }, 120_000);

  it('D: the reply claim releases the yielded holder as previousRun, never a caller input', async () => {
    const world = await openWorld();
    const yielded = await runS7BWait(world, { label: 'reply-claim' });
    await answerS7BWait(world, { goal: yielded.goal, recipient: yielded.recipient, message: yielded.message,
      task: yielded.tasks[1]!, label: 'reply-claim' });
    const accepted = await acceptS7BReply(world, { goal: yielded.goal, sender: yielded.sender,
      task: yielded.tasks[0]!, run: yielded.run, message: yielded.message, label: 'reply-claim' });
    expect(accepted.run.runId).not.toBe(yielded.run.runId);
    const record = ready<TaskExecutionRecord>(
      await world.post('executions/read', plain(S6A_SCOPE, accepted.run)), 'the reply claim successor Run');
    expect(record.run.previousRun).toEqual(yielded.run);
    expect(record.outbox.claim.previousRun).toEqual(yielded.run);
  }, 120_000);
});
