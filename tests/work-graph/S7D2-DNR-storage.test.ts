/**
 * nr (node-level review) storage rows (rule sheet S3: receipt replay, CAS pins, crash recovery, reopen): the same
 * table on memory and SQLite; NR-T11 reopens the Host, so it is SQLite only (RULES :208). Test spec
 * `nr-tests.frozen.md` with `dnr-errata.frozen.md` (E3 the recovery record, E7 NR-T15's one entry) and
 * `nr-repoint.md`. World: `tests/helpers/S7D2-DNR-node-world.ts` (`openDNRPendingNode`: an every_step node that
 * changed `src/module.ts` and is satisfied). The node row is nr's port read (`goals/delivery` is acc's).
 * NR-T16's store failure is the commit barrier (rule sheet A2) on the TaskNodeCommit commit (`node-commit:`
 * identity, NR-07); the "knowledge" commit in between is a real `git commit` by the person.
 *
 * Red today (7c862a02, nr absent): every row at its first `nodes/commit` post (404, no route) or
 * `platform.nodeCommits` read (no port). Green when nr lands: receipt replay (NR-13), the Goal and TaskReduction pins
 * (NR-09 step 6), the reviewed path/blob check (NR-09 step 7), the identity+fingerprint recovery over the reachable
 * history (NR-14 + E3), and the record read back after a reopen (NR-06/07).
 * Named mutations are nr's new code: none can be shown on today's tree.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { committed } from '../helpers/S7A-fixture.js';
import {
  createFile, dnrCommitBody, dnrLine, dnrRow, dnrRows, gitOut, goalRevision, headCount, openDNRPendingNode,
  openDNRWorld, postNodeCommit, runDNRNode, writeText, type DNRWorld,
} from '../helpers/S7D2-DNR-node-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const SLOW = 240_000;
const BACKENDS = ['memory', 'sqlite'] as const;
const worlds: DNRWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  for (const w of worlds.splice(0)) await w.close().catch(() => undefined);
  expect(left).toEqual([]);
});

async function pendingNode(label: string, backend: 'memory' | 'sqlite'): Promise<DNRWorld> {
  const w = await openDNRPendingNode(label, backend);
  worlds.push(w);
  return w;
}
type Committed = { status: 'committed'; replayed: boolean; value: { review: { sha?: string } } };
const shaOf = (answer: unknown): string | undefined => (answer as Committed).value.review.sha;

describe.each(BACKENDS)('nr storage (%s)', backend => {
  it('NR-T03 the same request id replays the first commit: no second git commit, one record', async () => {
    const w = await pendingNode(`nrt03${backend[0]}`, backend);
    const taskId = `nrt03${backend[0]}-a`;
    const body = await dnrCommitBody(w, { taskId, requestId: 'nrt03-commit' });
    const first = await postNodeCommit(w, body);
    expect(first).toMatchObject({ status: 'committed', replayed: false, value: { review: { kind: 'committed' } } });
    const count = headCount(w);
    expect(await postNodeCommit(w, body))
      .toMatchObject({ status: 'committed', replayed: true, value: { review: { sha: shaOf(first) } } });
    expect(headCount(w)).toBe(count);
    expect((await dnrRows(w)).rows.filter(row => row.task.taskId === taskId))
      .toMatchObject([{ pending: false, review: { review: { sha: shaOf(first) } } }]);
  }, SLOW);

  it('NR-T04 a Goal pin read before two settings writes is stale: no commit, still pending', async () => {
    const w = await pendingNode(`nrt04${backend[0]}`, backend);
    const taskId = `nrt04${backend[0]}-a`;
    const body = await dnrCommitBody(w, { taskId, requestId: 'nrt04-commit' });
    const pinned = await goalRevision(w.world, w.goal);
    for (const autonomy of ['after_plan_confirmation', 'every_step'] as const) {
      committed(await w.world.post('goals/settings/set', graphWrite(S6A_SCOPE, { goalRef: w.goal, autonomy,
        waitForGoalRef: null }, `nrt04-${autonomy}`, [{ ref: w.goal, revision: await goalRevision(w.world, w.goal) }])),
      `NR-T04 ${autonomy}`);
    }
    const count = headCount(w);
    expect(await postNodeCommit(w, body)).toMatchObject({ status: 'rejected', code: 'revision_conflict',
      current: expect.arrayContaining([{ ref: w.goal, revision: pinned + 2 }]) });
    expect(headCount(w)).toBe(count);
    expect(await dnrRow(w, taskId)).toMatchObject({ pending: true, review: null });
  }, SLOW);

  it('NR-T14 a TaskReduction pin read before the node completed is stale', async () => {
    const label = `nrt14${backend[0]}`;
    const w = await openDNRWorld({ label, autonomy: 'every_step', taskIds: [`${label}-a`], backend });
    worlds.push(w);
    expect((await dnrRow(w, `${label}-a`)).reduction).toBeNull();
    const stale = { ref: { aggregateType: 'TaskReduction', ...w.task(`${label}-a`) }, revision: 0 };
    await runDNRNode(w, await dnrLine(w, `${label}-line`, [`${label}-a`]), `${label}-a`,
      [createFile(`${label}-edit`, `src/${label}.ts`, 'export const nrt14 = 1;\n')]);
    const count = headCount(w);
    const body = await dnrCommitBody(w, { taskId: `${label}-a`, requestId: 'nrt14-commit',
      expected: [{ ref: w.goal, revision: await goalRevision(w.world, w.goal) }, stale] });
    expect(await postNodeCommit(w, body)).toMatchObject({ status: 'rejected', code: 'revision_conflict',
      current: expect.arrayContaining([{ ref: stale.ref, revision: 1 }]) });
    expect(headCount(w)).toBe(count);
    expect(await dnrRow(w, `${label}-a`)).toMatchObject({ pending: true, review: null });
  }, SLOW);

  it('NR-T15 the file changed after the review read: source_stale, no commit, still pending', async () => {
    const w = await pendingNode(`nrt15${backend[0]}`, backend);
    const taskId = `nrt15${backend[0]}-a`;
    const body = await dnrCommitBody(w, { taskId, requestId: 'nrt15-commit' });
    await writeText(w.world.root, 'src/module.ts', 'export const changedAfterTheReview = true;\n');
    const count = headCount(w);
    expect(await postNodeCommit(w, body)).toMatchObject({ status: 'rejected', code: 'source_stale' });
    expect(headCount(w)).toBe(count);
    expect(await dnrRow(w, taskId)).toMatchObject({ pending: true, review: null });
  }, SLOW);

  /** The node commit lands in git, its store commit fails (`unavailable`); returns the body and the node commit. */
  async function lostRecord(label: string): Promise<{ w: DNRWorld; taskId: string; body: unknown; nodeSha: string }> {
    const w = await pendingNode(label, backend);
    const taskId = `${label}-a`;
    const body = await dnrCommitBody(w, { taskId, requestId: `${label}-commit` });
    const count = headCount(w);
    commitBarrier.failCommitOnce(byIdentityPrefix('node-commit:'));
    expect(await postNodeCommit(w, body)).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(headCount(w)).toBe(count + 1);
    return { w, taskId, body, nodeSha: gitOut(w, 'rev-parse', 'HEAD') };
  }

  it('NR-T16 A: after a lost record and a later knowledge commit, the retry finds the node commit in history', async () => {
    const { w, taskId, body, nodeSha } = await lostRecord(`nrt16a${backend[0]}`);
    await writeText(w.world.root, '.workbench/knowledge.json', '{"modules":[]}\n');
    gitOut(w, 'add', '-f', '--', '.workbench/knowledge.json');
    gitOut(w, 'commit', '-q', '-m', 'the person commits the knowledge files');
    expect(await postNodeCommit(w, body)).toMatchObject({ status: 'committed', value: { review: { sha: nodeSha } } });
    expect(gitOut(w, 'log', '--format=%H', '--grep=^Node-Commit: ').split('\n')).toEqual([nodeSha]);
    expect(await dnrRow(w, taskId)).toMatchObject({ pending: false, review: { review: { sha: nodeSha } } });
  }, SLOW);

  it('NR-T16 B: the same identity with another fingerprint in history is a conflict; nothing is recorded', async () => {
    const { w, taskId, body, nodeSha } = await lostRecord(`nrt16b${backend[0]}`);
    const lines = gitOut(w, 'log', '-1', '--format=%B', nodeSha).split('\n');
    const identity = lines.find(line => line.startsWith('Node-Commit: '));
    const record = lines.find(line => line.startsWith('Node-Record: '));
    gitOut(w, 'reset', '-q', '--hard', 'HEAD~1');
    gitOut(w, 'commit', '-q', '--allow-empty', '-m',
      `another review\n\n${record}\n${identity}\nNode-Review: another-fingerprint`);
    const count = headCount(w);
    expect(await postNodeCommit(w, body)).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(headCount(w)).toBe(count);
    expect(await dnrRow(w, taskId)).toMatchObject({ pending: true, review: null });
  }, SLOW);
});

describe('nr storage (sqlite only: Host reopen)', () => {
  it('NR-T11 the record and its replay survive a Host reopen', async () => {
    const w = await pendingNode('nrt11', 'sqlite');
    const body = await dnrCommitBody(w, { taskId: 'nrt11-a', requestId: 'nrt11-commit' });
    const first = await postNodeCommit(w, body);
    expect(first).toMatchObject({ status: 'committed' });
    await w.world.reopen();
    expect(await dnrRow(w, 'nrt11-a')).toMatchObject({ pending: false, review: { review: { sha: shaOf(first) } } });
    expect(await postNodeCommit(w, body))
      .toMatchObject({ status: 'committed', replayed: true, value: { review: { sha: shaOf(first) } } });
  }, SLOW);
});
