/**
 * NR-B 2-2 (the secretary drafts the node's note): rows N-2a and N-2c of the frozen ruling `nrb-rulings.md` §7,
 * memory only (business rows, RULES S3), the round-1 rows (lead ruling 11-27 22:4x): N-2d (ruling 15, SQLite only:
 * it reopens the Host), N-2e (fixes 6/7) and N-2f (fix 10), and the round-2 rows (11-27 23:3x): N-2g (fix 1, the
 * person's `queries/ask`) and N-2h (a heartbeat after a failed ask, rewritten by the round-3 ruling of 11-28 00:1x), and
 * N-2i (round 3: an ask the closing Host cancels, SQLite only). N-2b is not written (supplement 4): its named mutation (drop
 * "a draft exists, skip") is invisible through any public read, because the second ask replays the same Query by its
 * `commandId` (ruling §3.2 去重, 清单 B 7), and proving "no second ask" would need inner counting (F10) and a
 * wake-drain barrier the Host does not expose (F9).
 *
 * World: the nr world (`openDNRWorld`, every_step, one node) with the Goal driver on (`workflow/driver-start`), which is
 * how a Goal runs for the person: the driver claims and runs the node, it becomes pending, and the driver parks on
 * `node_review_pending:<task>` with `TaskReduction` among its wake kinds (probed on 46f45a15). The trigger of §3.2 is the
 * Host's wake queue after that wake (`goal-wait-wakes.ts:490`), so no step here asks the secretary. The secretary is a
 * line with the secretary duty (`createSecretary`); its read-only copy answers from the world's scripted replies, as
 * every `queries/ask` copy does. Reads: `goals/delivery` only; the bounded waits poll it for a positive state (F9).
 * N-2e's one fault is the commit barrier (RULES A2) failing the copy's Query submit once; the record-store modules are
 * wrapped for it as in `S7D2-DNR-storage.test.ts`, and pass through when nothing is armed.
 * The copy-page gate (第 3 轮补, RULES A3, the same file-top `vi.mock` shape as `tests/scenarios/XWR0-consume.test.ts`):
 * the Host's heartbeat reads the copy page on every tick of its own timer, whatever the fixture clock says
 * (`host.ts`: the copy page goes before the clock-gated consume pass), so once the question M is no longer withdrawn
 * (round-3 ruling 1) the heartbeat runs M right after a failed ask. `holdCopyPages` holds the page read (the real read
 * runs only after `release`, its answer unchanged); while it is held the heartbeat's copy page job stays in flight and
 * takes no question, so the row shows what the draft's own ask recorded. Nothing else is changed; unarmed it passes
 * straight through, and `afterEach` opens it before the worlds close (the close waits for the page job).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { startGoalDriver } from '../helpers/DRV-fixture.js';
import { adoptPLMixedPlan, createPLLine } from '../helpers/PL-consumption-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { inbox } from '../helpers/P1-reads.js';
import { byIdentityPrefix, commitBarrier, type CommitHold } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6ABackend, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { committed } from '../helpers/S7A-fixture.js';
import {
  createFile, dnrCommit, dnrLine, goalRevision, NRB_TICK, nrbRow, openDNRWorld, type DNRWorld,
} from '../helpers/S7D2-DNR-node-world.js';
import { waitFor } from '../scenarios/harness.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));
const copyPages = vi.hoisted(() => ({ gate: null as Promise<void> | null }));
vi.mock('../../src/core/work-graph/communication/mailbox-pages.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/core/work-graph/communication/mailbox-pages.js')>();
  return { ...actual, readPendingCopyQuestions: async (...args: Parameters<typeof actual.readPendingCopyQuestions>) => {
    if (copyPages.gate !== null) await copyPages.gate;
    return await actual.readPendingCopyQuestions(...args);
  } };
});
let releaseCopyPages: () => void = () => undefined;
/** Holds the Host's copy page reads from now on; the returned (and `afterEach`'s) release lets them run. */
function holdCopyPages(): () => void {
  let open: () => void = () => undefined;
  copyPages.gate = new Promise<void>(resolve => { open = resolve; });
  releaseCopyPages = () => { copyPages.gate = null; open(); };
  return releaseCopyPages;
}

const SLOW = 240_000;
const DRAFT = 'This step adds the export n2a_a to src/n2a-a.ts; its checks passed.';
/** The commit barrier's own words for an injected failure (`S6A-commit-barrier.ts:296`), not a product sentence. */
const INJECTED_FAULT = 'injected commit I/O failure';
const failQuerySubmitOnce = (): void => { commitBarrier.failCommitOnce(byIdentityPrefix('query-job-submit:')); };
/** In order: each row's driver stop first (`unshift`), then its world. */
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  releaseCopyPages();
  commitBarrier.reset();
  for (const close of closers.splice(0)) await close().catch(() => undefined);
});

/** The line's two scripted replies: one new file through the Kernel's `edit`, then the text answer. */
async function scriptFileNode(w: DNRWorld, line: S6ASession, taskId: string, path: string): Promise<void> {
  await w.world.scripted.script(line, [{ kind: 'calls', calls: [createFile(`${taskId}-edit`, path,
    `export const ${taskId.replace(/[-:]/g, '_')} = 1;\n`)] }, { kind: 'text', text: `NRB ${taskId} done` }]);
}
async function startDriver(w: DNRWorld, goal: GoalRef, flowId: string): Promise<void> {
  closers.unshift(async () => { await w.world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef: goal })); });
  await startGoalDriver(w.world, goal, flowId);
}

/** An every_step Goal whose driver runs `<label>-a` (one new file) until the node waits for review; `arm` runs just
 *  before the driver starts. */
async function drivenNode(label: string, secretary: boolean,
  options: { backend?: S6ABackend; arm?: () => void } = {}): Promise<DNRWorld> {
  const taskId = `${label}-a`;
  const w = await openDNRWorld({ label, autonomy: 'every_step', taskIds: [taskId], backend: options.backend ?? 'memory' });
  closers.push(w.close);
  w.world.clock.advance(NRB_TICK);
  if (secretary) {
    await w.world.createSecretary(`${label}-secretary`);
    w.world.scriptReplies([{ kind: 'text', text: DRAFT }]);
  }
  await scriptFileNode(w, await dnrLine(w, `${label}-line`, [taskId]), taskId, `src/${taskId}.ts`);
  options.arm?.();
  await startDriver(w, w.goal, label);
  return w;
}

describe('NR-B 2-2: the secretary drafts the note of a node waiting for review', () => {
  it('N-2a the platform asks the secretary once the node waits, and the answer hangs on the node row', async () => {
    // Red today: `goals/delivery` rows have no `draft`, so the wait for a ready draft times out. Green when §3.2 lands:
    // after the wake `ensureNodeReviewDrafts` asks the secretary (`askLine`) and records the Query; the row reads its
    // last answer as `ready`.
    // Mutation (ruling): drop the `ensureNodeReviewDrafts` call -> no draft -> red.
    const w = await drivenNode('n2a', true);
    const row = await waitFor(() => nrbRow(w, 'n2a-a'), current => current.draft?.status === 'ready',
      'N-2a: the secretary\'s draft on the node row');
    expect(row).toMatchObject({ pending: true, draft: { status: 'ready', text: DRAFT, failureReason: null } });
    expect(row.draft?.request).toMatchObject({ aggregateType: 'QueryJob', projectId: w.goal.projectId });
  }, SLOW);

  it('N-2c with no secretary the draft is failed with a reason, and the node can still be committed', async () => {
    // Red today: no `draft` ever appears, so the wait times out. Green when §3.2 writes `failed` with its reason once
    // the secretary read finds none (`goals/delivery.secretary` is null in this world) and §4 leaves `nodes/commit` alone.
    // Mutation (ruling): fold the failure into `draft: null` -> the wait times out -> red.
    const w = await drivenNode('n2c', false);
    const row = await waitFor(() => nrbRow(w, 'n2c-a'), current => current.draft !== undefined && current.draft !== null,
      'N-2c: the failed draft on the node row');
    expect(row).toMatchObject({ pending: true, draft: { status: 'failed', text: null, request: null } });
    expect(row.draft?.failureReason).toEqual(expect.stringMatching(/\S/));
    expect(await dnrCommit(w, { taskId: 'n2c-a', requestId: 'n2c-commit' })).toMatchObject({ status: 'committed' });
  }, SLOW);
});

describe('NR-B 2-2 round 1: public counter-examples for the builder\'s fixes', () => {
  it('N-2e an ask that never becomes a Query is a failed draft with its reason; the delivery page stays readable (fixes 6, 7)', async () => {
    // Red today: no draft (the wait times out). Red with the builder's first build (Codex nrbcr 6): `askLine` answers
    // `queued` with a Query ref computed from the message, the record keeps that ref, and `goals/delivery` reads
    // `unavailable` for a Query that does not exist (`nrbRow` throws). Green when a failed submit records `failed` with
    // its own reason and no request (fix 6).
    // Round-2 ruling 8: the reason carries the fixture's own fault mark, not the product's sentence (a wrong reason such
    // as "no secretary" is red too).
    // 第 3 轮补: the heartbeat's copy page is held for the whole row, so the question M stays untaken and the row shows
    // what the draft's own ask recorded (with M free, the round-3 build's heartbeat takes it at once and the row reads
    // the Query's `drafting`: N-2h's case).
    // Mutation (fix 6): record the computed ref -> the page is `unavailable` -> red.
    const w = await drivenNode('n2e', true, { arm: () => { failQuerySubmitOnce(); holdCopyPages(); } });
    const row = await waitFor(() => nrbRow(w, 'n2e-a'), current => current.draft !== undefined && current.draft !== null,
      'N-2e: the draft on the node row');
    expect(row).toMatchObject({ pending: true, draft: { status: 'failed', text: null, request: null } });
    expect(row.draft?.failureReason).toContain(INJECTED_FAULT);
  }, SLOW);

  it('N-2h after a failed ask a heartbeat runs the question: the row shows its Query, the failed record no longer blocks it', async () => {
    // Round-3 ruling (11-28 00:1x), replacing round-2 ruling 10: M is not withdrawn; the heartbeat's copy page may run it
    // and the delivery page reads the draft's deterministic Query before any failed record. Red today: no draft (the
    // wait for the failed draft times out). Red with the round-2 build: M was withdrawn, so no heartbeat runs it and the
    // row stays `failed`. Green when the page reads the Query first (round-3 rulings 1–2).
    // 第 3 轮补: the heartbeat's copy page is held until the failed draft is read, then let go; the heartbeat's next copy
    // page takes M, makes the Query and the secretary answers.
    // Mutation (round-3 ruling 2): read the failed record before the Query -> the row stays `failed` -> red.
    let release: () => void = () => undefined;
    const w = await drivenNode('n2h', true, { arm: () => { failQuerySubmitOnce(); release = holdCopyPages(); } });
    const failed = await waitFor(() => nrbRow(w, 'n2h-a'), current => current.draft !== undefined && current.draft !== null,
      'N-2h: the failed draft on the node row');
    expect(failed.draft).toMatchObject({ status: 'failed', request: null });
    release();
    const row = await waitFor(() => nrbRow(w, 'n2h-a'), current => current.draft?.status === 'ready',
      'N-2h: the Query the heartbeat ran');
    expect(row).toMatchObject({ pending: true, draft: { status: 'ready', text: DRAFT } });
    expect(row.draft?.request).toMatchObject({ aggregateType: 'QueryJob', projectId: w.goal.projectId });
  }, SLOW);

  it('N-2g the person\'s queries/ask with an extra `status: "draft"` field still sends its question (fix 1)', async () => {
    // Round-2 ruling 9. Green on this tree (46f45a15 and these tests): the person's entry ignores the extra field and
    // queues the round. Red on the stacked tree (Codex nrbcr2 6, the round-1 split of `askLine`): the expanded command
    // carries `status`, the caller reads it as a rejection and returns it, so no question is sent. Green again when
    // `lineAskCommandOf` answers `{ ok, command | rejection }` and the caller branches on `ok` (fix 1).
    // Mutation (fix 1): branch on a `status` key again -> the command comes back, nothing is queued -> red.
    const w = await openDNRWorld({ label: 'n2g', autonomy: 'after_plan_confirmation', taskIds: ['n2g-x'] });
    closers.push(w.close);
    const secretary = await w.world.createSecretary('n2g-secretary');
    w.world.scriptReplies([{ kind: 'text', text: 'N-2g: the work is on track.' }]);
    expect((await w.world.post('queries/ask', plain(S6A_SCOPE, { sessionRef: secretary.ref, question: '进度如何？',
      commandId: 'human-1', status: 'draft' }))).body).toMatchObject({ status: 'queued', round: { aggregateType: 'QueryJob' } });
    expect((await inbox(w.world, secretary)).filter(message => message.answeredBy === 'copy')).toHaveLength(1);
  }, SLOW);

  it('N-2f the nodes (g:a, b, 1) and (g, a:b, 1) are drafted each on its own (fix 10)', async () => {
    // Red today: no draft (the wait times out). Red with the builder's first build (Codex nrbcr 10): both the ask's
    // `commandId` and the record's identity join the tuple with ':' into `g:a:b:1`, so the second node replays the first
    // Query or is refused. Green when both use `prefix + encodeTuple([goalId, taskId, revision])`.
    // Mutation (fix 10): join with ':' again -> one Query for both, or a failed second draft -> red.
    // One node at a time (N-2f 不稳, 11-27): the two Goals share one workspace, so a second node's edit landing while the
    // first node's check round is open makes that round INCONCLUSIVE (`source_changed`, `pending_check`; the Evidence
    // service keeps a check whose source changed as history) and every_step then waits for the person to confirm the
    // automatic re-check (`automation_confirmation:auto_reverify`): the first node is never pending. Concurrent starts did
    // that in 2 of 5 and 2 of 8 runs; so the second Goal starts only once the first node's draft is ready.
    const w = await openDNRWorld({ label: 'n2f', autonomy: 'after_plan_confirmation', taskIds: ['n2f-x'] });
    closers.push(w.close);
    await w.world.createSecretary('n2f-secretary');
    const answers = ['N-2f note for the node b of g:a.', 'N-2f note for the node a:b of g.'];
    w.world.scriptReplies(answers.map(text => ({ kind: 'text' as const, text })));
    const main = s6aCardsWorkspace(w.world, S6A_SCOPE);
    const rows = [];
    for (const [index, node] of [{ goalId: 'g:a', taskId: 'b' }, { goalId: 'g', taskId: 'a:b' }].entries()) {
      const goal = (await main.createGoal(node.goalId, `NRB N-2f goal ${String(index)}`)).ref;
      await adoptPLMixedPlan(w.world, { goal, label: `n2f-${String(index)}`,
        tasks: [{ taskId: node.taskId, role: S6A_WORK_ROLE.templateId }] });
      committed(await w.world.post('goals/settings/set', graphWrite(S6A_SCOPE, { goalRef: goal, autonomy: 'every_step',
        waitForGoalRef: null }, `n2f-every-step-${String(index)}`, [{ ref: goal, revision: await goalRevision(w.world, goal) }])),
      `N-2f: every_step on ${node.goalId}`);
      w.world.clock.advance(NRB_TICK);
      const line = await createPLLine(w.world, { label: `n2f-line-${String(index)}`, role: S6A_WORK_ROLE,
        tasks: [{ projectId: goal.projectId, goalId: goal.goalId, taskId: node.taskId }] });
      await scriptFileNode(w, line, node.taskId, `src/n2f-${String(index)}.ts`);
      await startDriver(w, goal, `n2f-${String(index)}`);
      rows.push(await waitFor(() => nrbRow(w, node.taskId, goal), current => current.draft?.status === 'ready',
        `N-2f: the draft of ${node.goalId} / ${node.taskId}`));
    }
    expect(rows.map(row => row.draft?.text)).toEqual(answers);
    expect(rows[0]!.draft?.request).not.toEqual(rows[1]!.draft?.request);
  }, SLOW);
});

describe('NR-B 2-2 storage (sqlite only: Host reopen)', () => {
  it('N-2i an ask the closing Host cancels leaves no failed record: after the restart the row is null or its Query (round-3 ruling 4)', async () => {
    // Red today at `toHaveProperty('draft')`: the base rows carry no draft. Green when a cancellation by the close writes
    // nothing (round-3 ruling 4): after the restart the row has no draft yet (`null`), or the Query's state if the
    // question got one; never `failed`.
    // The step (RULES A3): the draft question's send commit (`session-message-send:`) is held until the close has begun;
    // the close sends its abort first (round-2 ruling 3), then the commit goes through and the ask meets the aborted
    // signal. What no public step can force: an ask that looks at its signal only after its Query exists takes the
    // Query path (also green); the close's abort order decides which (reply, round 3).
    // Mutation (round-3 ruling 4): record `failed` for a cancelled ask -> the restarted row is `failed` -> red.
    let held: CommitHold | undefined;
    const w = await drivenNode('n2i', true, { backend: 'sqlite',
      arm: () => { held = commitBarrier.hold(byIdentityPrefix('session-message-send:'), 'N-2i: the draft question'); } });
    expect(await waitFor(() => nrbRow(w, 'n2i-a'), current => current.pending, 'N-2i: the node waits for review'))
      .toHaveProperty('draft');
    await held!.reached;
    const restarting = w.world.reopen();
    held!.release();
    await restarting;
    const draft = (await nrbRow(w, 'n2i-a')).draft ?? null;
    expect([null, 'drafting', 'ready']).toContain(draft === null ? null : draft.status);
    expect(draft === null || draft.request !== null).toBe(true);
  }, SLOW);

  it('N-2d a failed draft is read back from the store after a reopen, unchanged, though a secretary now exists (ruling 15)', async () => {
    // Red today: no draft is ever written, so the wait for the failed draft times out. Green when §3.2's
    // `TaskNodeReviewDraft@1` is a store record and `goals/delivery` reads it.
    // Mutation (Codex nrbcr 15): keep the drafts in a process Map -> after the reopen the row has no draft, or a new
    // ask (the secretary now exists, the clock is at t1) -> red.
    const w = await drivenNode('n2d', false, { backend: 'sqlite' });
    const t0 = w.world.clock.now();
    const failed = await waitFor(() => nrbRow(w, 'n2d-a'), current => current.draft !== undefined && current.draft !== null,
      'N-2d: the failed draft on the node row');
    expect(failed.draft).toMatchObject({ status: 'failed', request: null, requestedAt: t0 });
    await w.world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef: w.goal }));
    await w.world.createSecretary('n2d-secretary');
    w.world.clock.advance(NRB_TICK);
    await w.world.reopen();
    const after = await nrbRow(w, 'n2d-a');
    expect(after.pending).toBe(true);
    expect(after.draft).toEqual(failed.draft);
    expect(await dnrCommit(w, { taskId: 'n2d-a', requestId: 'n2d-commit' })).toMatchObject({ status: 'committed' });
  }, SLOW);
});
