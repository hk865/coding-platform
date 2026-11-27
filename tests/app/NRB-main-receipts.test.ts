/**
 * NR-B 2-6 (the review receipt stays on the main conversation): rows N-4a..N-4c of the frozen ruling `nrb-rulings.md`
 * §7, N-4a/N-4b rewritten by the round-1 ruling 14 (11-27 22:4x). World: the NR-B section of
 * `tests/helpers/S7D2-DNR-node-world.ts`; the review goes through `nodes/commit`, the receipt is read through
 * `main/read` of the Goal's view (ruling §3.1). N-4a/N-4c are business rows (memory); N-4b reopens the Host (SQLite only).
 * Every expected value is independent of the write's answer (ruling 14): the Plan's own title `Independent work
 * <taskId>` (the fixture Plan, `adoptPLMixedPlan`), the person's message, the world's operator
 * `{ kind: 'human', id: 's6a-operator' }` (the Host's HTTP actor, `S6A-request-fixture.ts:177`), the review time read
 * from the world's fake clock before the commit, the sha read from the workspace's git after it, one reviewed file.
 *
 * Red today: `main/read` has no `nodeReceipts`, so each row fails at its first receipt assertion. Green when §3.1/§6
 * land: `readNodeReceipts` reads every `TaskNodeCommit@1` of the Goal and `readMainPage` joins them, ordered by
 * `reviewedAt`, then `taskId`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  createFile, dnrCommit, dnrLine, gitOut, NRB_TICK, nrbReceipts, openDNRWorld, openNRBPendingNode, runDNRNode,
  type DNRWorld, type NRBPending, type NRBReceipt,
} from '../helpers/S7D2-DNR-node-world.js';

const SLOW = 240_000;
const MESSAGE = 'Add the module marker export';
const OPERATOR = { kind: 'human', id: 's6a-operator' } as const;
const worlds: DNRWorld[] = [];
afterEach(async () => { for (const w of worlds.splice(0)) await w.close().catch(() => undefined); });

async function pendingNode(label: string): Promise<NRBPending> {
  const w = await openNRBPendingNode(label);
  worlds.push(w);
  return w;
}
const committedReceipt = (taskId: string, sha: string, message: string, reviewedAt: string): NRBReceipt => ({
  taskRef: { taskId, title: `Independent work ${taskId}` }, decision: 'committed', sha, message, reviewedAt,
  reviewedBy: OPERATOR, files: 1 });

describe('NR-B 2-6: the node review receipt on main/read', () => {
  it('N-4a a committed node leaves its receipt on the Goal\'s main page', async () => {
    // Mutation (ruling): drop the `nodeReceipts` join -> undefined -> red. Round-1 ruling 14: a receipt that copied a
    // wrong time or reviewer from the record would also be red here, since neither comes from the write's answer.
    const w = await pendingNode('n4a');
    const reviewedAt = w.world.clock.now();
    expect(await dnrCommit(w, { taskId: w.taskId, requestId: 'n4a-commit', message: MESSAGE }))
      .toMatchObject({ status: 'committed' });
    expect(await nrbReceipts(w)).toEqual([committedReceipt('n4a-a', gitOut(w, 'rev-parse', 'HEAD'), MESSAGE, reviewedAt)]);
  }, SLOW);

  it('N-4c an acknowledgement leaves a receipt with no commit and no message', async () => {
    // Mutation (ruling): receipts of `committed` reviews only -> no receipt -> red.
    const w = await pendingNode('n4c');
    gitOut(w, 'checkout', '--', 'src/module.ts');
    expect(await dnrCommit(w, { taskId: w.taskId, requestId: 'n4c-ack', decision: 'acknowledge', message: null }))
      .toMatchObject({ status: 'committed' });
    expect(await nrbReceipts(w)).toMatchObject([{ taskRef: { taskId: 'n4c-a' }, decision: 'acknowledged', sha: null,
      message: null, files: 1 }]);
  }, SLOW);
});

describe('NR-B 2-6 storage (sqlite only: Host reopen)', () => {
  it('N-4b every receipt of the Goal is read again after a reopen, by review time and then taskId: z@t0, then a, b @t1', async () => {
    // Round-1 ruling 14: z is reviewed at t0, then b and a at t1 (b first). Hand-computed order [z, a, b]: z is first by
    // time though its id sorts last, and a comes before b at the same time though b was reviewed first.
    // Mutations: keep only the last receipt, order newest first, or order equal times by review order -> red; keep the
    // receipts in a page cache (ruling) -> nothing after the reopen -> red.
    const w = await openDNRWorld({ label: 'n4b', autonomy: 'every_step', taskIds: ['n4b-z', 'n4b-b', 'n4b-a'],
      backend: 'sqlite' });
    worlds.push(w);
    w.world.clock.advance(NRB_TICK);
    const line = await dnrLine(w, 'n4b-line', ['n4b-z', 'n4b-b', 'n4b-a']);
    const review = async (taskId: string): Promise<{ sha: string; at: string; message: string }> => {
      await runDNRNode(w, line, taskId, [createFile(`${taskId}-edit`, `src/${taskId}.ts`,
        `export const ${taskId.replace(/-/g, '_')} = 1;\n`)]);
      const at = w.world.clock.now();
      const message = `${MESSAGE} ${taskId}`;
      expect(await dnrCommit(w, { taskId, requestId: `${taskId}-commit`, message })).toMatchObject({ status: 'committed' });
      return { sha: gitOut(w, 'rev-parse', 'HEAD'), at, message };
    };
    const z = await review('n4b-z');
    w.world.clock.advance(NRB_TICK);
    const b = await review('n4b-b');
    const a = await review('n4b-a');
    expect(b.at).toBe(a.at);
    await w.world.reopen();
    expect(await nrbReceipts(w)).toEqual([
      committedReceipt('n4b-z', z.sha, z.message, z.at),
      committedReceipt('n4b-a', a.sha, a.message, a.at),
      committedReceipt('n4b-b', b.sha, b.message, b.at),
    ]);
  }, SLOW);
});
