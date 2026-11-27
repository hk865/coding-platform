/**
 * NR-B 2-1 (甲: a pending node sent back under the same taskId) and 2-5 (every_step reviews only the nodes finished
 * after the switch): rows N-1a..N-1f and N-3a..N-3e of the frozen ruling `nrb-rulings.md` §7 (N-1g is the builder's
 * pure row; N-3d is deleted, round-1 ruling 13: it is BK-A NRQ-1's world and assertions). World: the NR-B section of the nr world `tests/helpers/S7D2-DNR-node-world.ts` (the ruling's
 * `NRB-world.ts`, extended in place); every prior state is a public step, every read a
 * public route (`goals/delivery`, `decisions/queue`, `goals/settings`, `workflow/advance`) or the workspace's own git.
 * Business rows run memory; N-1e/N-1f are a version pin and a receipt replay, so they run memory and SQLite (RULES S3);
 * N-3c/N-3e reopen the Host, so SQLite only.
 *
 * Read with the ruling, three places where the row table could not be taken literally (reply questions 1–3):
 * - N-1a reads the Goal's waiting reasons from one Goal-level `workflow/advance` select: `workflow/driver-read`
 *   answers `not_found` while no driver runs, and its reasons are the same select's `waitBasis.reasons`.
 * - N-3b's Goal is born every_step (a copy of a cancelled every_step Goal, `bornEveryStepGoal`): `openDNRWorld(every_step)`
 *   switches into every_step, which under §5 stores a cut-off, so it could not show the named mutation `?? now()`.
 * - N-3e's "old record" is that same born Goal: its record carries the five settings keys and no cut-off, which is what
 *   a Goal written before NR-B carries; no record is written by hand (RULES F3). Its settings write keeps the settings
 *   (a real wait would hold the Goal's next node; the written record and its shape check are the same).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowAdvanceInput, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { advancePLGoal } from '../helpers/PL-workflow-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { committed, ready, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import {
  bornEveryStepGoal, createFile, dnrCommit, dnrLine, dnrPins, fileNodeOn, goalRevision, headCount, NRB_TICK,
  nodeReviewQueue, nrbRework, nrbReworkBody, nrbRow, openDNRWorld, openNRBPendingNode, postRework, runDNRNode,
  startNRBNode, type DNRWorld, type NRBPending,
} from '../helpers/S7D2-DNR-node-world.js';

const SLOW = 240_000;
const BACKENDS = ['memory', 'sqlite'] as const;
const REASON = 'The export name is wrong; call it moduleMarker.';
const worlds: DNRWorld[] = [];
afterEach(async () => { for (const w of worlds.splice(0)) await w.close().catch(() => undefined); });

async function pendingNode(label: string, backend: 'memory' | 'sqlite' = 'memory'): Promise<NRBPending> {
  const w = await openNRBPendingNode(label, backend);
  worlds.push(w);
  return w;
}
async function dnrWorld(input: Parameters<typeof openDNRWorld>[0]): Promise<DNRWorld> {
  const w = await openDNRWorld(input);
  worlds.push(w);
  return w;
}
const note = (name: string): string => `export const ${name.replace(/-/g, '_')} = 1;\n`;
type Requeued = { status: 'committed'; replayed: boolean; value: { kind: 'requeued'; requeue: { ref: unknown } } };
/** N-1k: twelve distinct lines of 156 characters, 1,883 with the line feeds (the bound is 2,000), each with its mark. */
const LONG_REASON_LINES = Array.from({ length: 12 }, (_, index) =>
  `第${String(index + 1).padStart(2, '0')}条：${'把返回值改回原来的结构不要动接口'.repeat(9)}（第${String(index + 1).padStart(2, '0')}条完）`);
/** Every text part of one model request, joined: the continuation brief is one of its messages. */
function modelInputText(request: { messages: readonly unknown[] }): string {
  return request.messages.map(message => {
    const content = (message as { content?: unknown }).content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map(part => (part as { text?: unknown }).text).filter(text => typeof text === 'string').join('\n');
  }).join('\n');
}

describe('NR-B 2-1: nodes/rework sends a pending node back under the same taskId', () => {
  it('N-1a the node goes back to pending: its files stay, nothing is committed, the Goal no longer waits on it', async () => {
    // Red today at the rework answer: `nodes/rework` is unpublished (404 `not_found`, probed on 46f45a15). Green when
    // §2.1–§2.3 land: the route requeues the same Task (P4 `pending/requeued`), the old reduction leaves the current
    // projection, so the row is not pending and the every_step gate has no node to wait on.
    // Mutation (ruling): `commitTaskNodeChanges` inside `reworkNode` -> HEAD moves -> red.
    const w = await pendingNode('n1a');
    expect(await nrbRow(w, w.taskId)).toMatchObject({ pending: true });
    const file = join(w.world.root, 'src', 'module.ts');
    const before = await readFile(file, 'utf8');
    const count = headCount(w);
    expect(await nrbRework(w, { taskId: w.taskId, requestId: 'n1a-rework', reason: REASON })).toMatchObject({
      status: 'committed', value: { kind: 'requeued', requeue: { task: w.task(w.taskId), reason: REASON } } });
    expect(await nrbRow(w, w.taskId)).toMatchObject({ pending: false, review: null, task: { phase: 'pending' } });
    expect(await readFile(file, 'utf8')).toBe(before);
    expect(headCount(w)).toBe(count);
    const selected = await advancePLGoal(w.world, w.goal, 'n1a-goal') as WorkflowAdvanceResult;
    expect(selected).toMatchObject({ status: 'ready' });
    const reasons = selected.status === 'ready' ? selected.value.waitBasis?.reasons ?? [] : [];
    expect(reasons).not.toContain(`node_review_pending:${w.taskId}`);
  }, SLOW);

  it('N-1b the sent-back node finishes again and waits for review again, one reduction later', async () => {
    // Red today at the rework (404). Green when the requeued Task is claimed again through its `requeueRef` (§2.2.4)
    // and the new round writes TaskReduction revision 2, which has no review fact (§2.2.5).
    // Mutation (ruling): `taskNodePending` keeps reading the first reduction -> the row is not pending -> red.
    const w = await pendingNode('n1b');
    expect((await nrbRow(w, w.taskId)).reduction?.revision).toBe(1);
    committed(await nrbRework(w, { taskId: w.taskId, requestId: 'n1b-rework', reason: REASON }), 'N-1b: the rework');
    const again = await startNRBNode(w, w.line, w.taskId, [createFile('n1b-fix', 'src/n1b-fix.ts', note('n1b-fix'))],
      { flowId: 'n1b-again' });
    await again.finish();
    expect(await nrbRow(w, w.taskId)).toMatchObject({ pending: true, review: null, reduction: { revision: 2 } });
  }, SLOW);

  it('N-1h the round after the rework gets the person\'s reason verbatim in its model input', async () => {
    // Lead ruling 11-27 (supplement 7). Red today at the rework (404). Green when the requeued round is claimed with
    // its `requeueRef` and its continuation brief carries `TaskRequeue.reason` (the existing requeue lines,
    // `continuation-brief-render.ts:705-706`), or the builder adds it. The first round never saw the reason, so it can
    // reach this request only through the rework.
    // Mutation: the continuation round's input without the requeue reason -> red.
    const w = await pendingNode('n1h');
    committed(await nrbRework(w, { taskId: w.taskId, requestId: 'n1h-rework', reason: REASON }), 'N-1h: the rework');
    const served = (await w.world.scripted.requests(w.line)).length;
    await startNRBNode(w, w.line, w.taskId, [], { flowId: 'n1h-again' });
    const round = (await w.world.scripted.requests(w.line)).slice(served);
    expect(round.length).toBeGreaterThan(0);
    expect(JSON.stringify(round[0]!.messages)).toContain(REASON);
  }, SLOW);
});

describe('rejects: nodes/rework (ruling §2.4)', () => {
  // Product rule (甲, 121-173): the next round is told why; an empty or unbounded reason is refused
  // (`TASK_REWORK_REASON_MAX_CHARS = 2000`, ruling §2.2.2).
  it.each([
    { name: 'an empty reason', label: 'n1ce', reason: '' },
    { name: 'a reason of 2001 characters', label: 'n1cl', reason: 'r'.repeat(2001) },
  ])('N-1c $name is invalid and the node stays pending', async ({ label, reason }) => {
    // Red today: 404 `not_found` instead of `invalid`. Green when §2.4 checks the reason before any write.
    // Mutation (ruling): drop `nonEmpty(reason)` (or the bound) -> committed -> red.
    const w = await pendingNode(label);
    const count = headCount(w);
    expect(await nrbRework(w, { taskId: w.taskId, requestId: `${label}-rework`, reason }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await nrbRow(w, w.taskId)).toMatchObject({ pending: true, review: null, reduction: { revision: 1 } });
    expect(headCount(w)).toBe(count);
  }, SLOW);

  it('N-1d a node already reviewed cannot be sent back', async () => {
    // Product rule (甲): only the node waiting for review goes back; a reviewed node's files are already committed.
    // Red today: 404 `not_found`. Green when `reworkNode` reads the row's review fact first (§2.2.2).
    // Mutation (ruling): skip the TaskNodeCommit read -> the reviewed node is requeued -> red.
    const w = await pendingNode('n1d');
    expect(await dnrCommit(w, { taskId: w.taskId, requestId: 'n1d-commit' })).toMatchObject({ status: 'committed' });
    const count = headCount(w);
    expect(await nrbRework(w, { taskId: w.taskId, requestId: 'n1d-rework', reason: REASON }))
      .toMatchObject({ status: 'rejected', code: 'invalid', reason: 'the node was already reviewed' });
    expect(await nrbRow(w, w.taskId))
      .toMatchObject({ pending: false, task: { phase: 'satisfied' }, review: { review: { kind: 'committed' } } });
    expect(headCount(w)).toBe(count);
  }, SLOW);
});

describe.each(BACKENDS)('NR-B 2-1 storage (%s)', backend => {
  it('N-1e a Goal pin read before a settings write is stale: revision_conflict naming the Goal, nothing written', async () => {
    // Coordination (versions): the person decided on the Goal they read.
    // Red today: 404 `not_found`. Green when the route checks both pins (`nodeCommitPins`, §2.1).
    // Mutation (ruling): drop `nodeCommitPins` -> the stale request requeues -> red.
    const w = await pendingNode(`n1e${backend[0]}`, backend);
    const expected = await dnrPins(w, w.taskId);
    const pinned = await goalRevision(w.world, w.goal);
    // The same every_step settings again: the Goal moves, its cut-off does not (§5: only a switch into every_step sets it).
    committed(await w.world.post('goals/settings/set', graphWrite(S6A_SCOPE, { goalRef: w.goal, autonomy: 'every_step',
      waitForGoalRef: null }, 'n1e-settings', [{ ref: w.goal, revision: pinned }])), 'N-1e: the settings write');
    const count = headCount(w);
    expect(await nrbRework(w, { taskId: w.taskId, requestId: 'n1e-rework', reason: REASON, expected })).toMatchObject({
      status: 'rejected', code: 'revision_conflict', current: expect.arrayContaining([{ ref: w.goal, revision: pinned + 1 }]) });
    expect(await nrbRow(w, w.taskId)).toMatchObject({ pending: true, review: null, reduction: { revision: 1 } });
    expect(headCount(w)).toBe(count);
  }, SLOW);

  it('N-1f the same requestId replays the one rework; the same requestId with another reason is refused', async () => {
    // Red today at the first post (404). Green when the write runs through `executeWriteCommand` with
    // `operation: 'node-rework'` and the fingerprint `{ goalRef, taskRef, reductionRevision, reason, expected }` (§2.5).
    // Mutations: a second write on replay -> `replayed: false` or a conflict -> red; the fingerprint without `reason`
    // (ruling) -> the third post replays -> red. Both bodies carry the same pins, so only the reason differs.
    const w = await pendingNode(`n1f${backend[0]}`, backend);
    const expected = await dnrPins(w, w.taskId);
    const body = await nrbReworkBody(w, { taskId: w.taskId, requestId: 'n1f-rework', reason: REASON, expected });
    const first = await postRework(w, body);
    expect(first).toMatchObject({ status: 'committed', replayed: false, value: { kind: 'requeued' } });
    const count = headCount(w);
    expect(await postRework(w, body)).toMatchObject({ status: 'committed', replayed: true,
      value: { requeue: { ref: (first as Requeued).value.requeue.ref } } });
    expect(await postRework(w, await nrbReworkBody(w, { taskId: w.taskId, requestId: 'n1f-rework',
      reason: `${REASON} Also rename the file.`, expected }))).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect(headCount(w)).toBe(count);
    expect(await nrbRow(w, w.taskId)).toMatchObject({ pending: false, task: { phase: 'pending' } });
  }, SLOW);
});

/** A finished under after_plan_confirmation, one tick, the switch, one tick, B finished: the N-3a/N-3c world. */
async function finishedAroundTheSwitch(label: string, backend: 'memory' | 'sqlite'): Promise<DNRWorld> {
  const w = await dnrWorld({ label, autonomy: 'after_plan_confirmation', taskIds: [`${label}-a`, `${label}-b`], backend });
  await runDNRNode(w, await dnrLine(w, `${label}-line-a`, [`${label}-a`]), `${label}-a`,
    [createFile(`${label}-a-edit`, `src/${label}-a.ts`, note(`${label}-a`))]);
  w.world.clock.advance(NRB_TICK);
  await setS7AAutonomy(w.world, w.goal, 'every_step');
  w.world.clock.advance(NRB_TICK);
  await runDNRNode(w, await dnrLine(w, `${label}-line-b`, [`${label}-b`]), `${label}-b`,
    [createFile(`${label}-b-edit`, `src/${label}-b.ts`, note(`${label}-b`))]);
  return w;
}

describe('NR-B 2-5: every_step reviews only the nodes finished after the switch', () => {
  it('N-3a a node finished before the switch is not reviewed; one finished after it is (one card)', async () => {
    // Red today at B's run: with no cut-off A is pending once the Goal switches, so B's named `select_work` waits on
    // A's review (GL-2) and B never completes. Green when §5 lands: the switch stores `nodeReviewSince` and A's
    // reduction is not after it.
    // Mutation (ruling): drop `reducedAt <= nodeReviewSince` -> A pending, B waits -> red.
    const w = await finishedAroundTheSwitch('n3a', 'memory');
    expect(await nrbRow(w, 'n3a-a')).toMatchObject({ pending: false, review: null });
    expect(await nrbRow(w, 'n3a-b')).toMatchObject({ pending: true, review: null });
    const queue = await nodeReviewQueue(w);
    expect(queue.cards).toHaveLength(1);
    expect(queue.waitingAnswer).toBe(1);
  }, SLOW);

  it('N-3b a Goal born every_step has no cut-off and reviews its node', async () => {
    // Green today (no cut-off anywhere). Guards §5 "出生不写" / "null = 全进卡": the clock moves one tick after the
    // node, so a missing cut-off read as "now" (the named mutation `nodeReviewSince ?? now()`) puts it before -> red.
    const w = await dnrWorld({ label: 'n3b', autonomy: 'after_plan_confirmation', taskIds: ['n3b-x'] });
    const born = await bornEveryStepGoal(w, 'n3b');
    await fileNodeOn(w, born, 'n3b-a');
    w.world.clock.advance(NRB_TICK);
    expect(await nrbRow(w, 'n3b-a', born)).toMatchObject({ pending: true, review: null });
  }, SLOW);
});

describe('NR-B 2-5 storage (sqlite only: Host reopen)', () => {
  it('N-3c the cut-off is the same after a Host reopen', async () => {
    // Red today at B's run (as N-3a). Green when the cut-off is a field of the Goal record (§5).
    // Mutation (ruling): keep `nodeReviewSince` in process memory -> after the reopen A is pending again -> red.
    const w = await finishedAroundTheSwitch('n3c', 'sqlite');
    await w.world.reopen();
    expect(await nrbRow(w, 'n3c-a')).toMatchObject({ pending: false });
    expect(await nrbRow(w, 'n3c-b')).toMatchObject({ pending: true });
  }, SLOW);

  it('N-3e a Goal record without nodeReviewSince reopens, takes a settings write, and reviews its node', async () => {
    // Green today (no Goal carries the field). Guards §5 "五项必需＋可选": the mutation "the optional field is required"
    // in `goalSettingsProblem` or `writtenGoalHasExactShape` refuses this record on the read or on the write -> red.
    const w = await dnrWorld({ label: 'n3e', autonomy: 'after_plan_confirmation', taskIds: ['n3e-x'], backend: 'sqlite' });
    const born = await bornEveryStepGoal(w, 'n3e');
    await w.world.reopen();
    const settings = ready<{ settings: Record<string, unknown> }>(await w.world.post('goals/settings',
      plain(S6A_SCOPE, { goalRef: born })), 'N-3e: the settings').settings;
    expect(settings).toMatchObject({ autonomy: 'every_step' });
    expect(settings).not.toHaveProperty('nodeReviewSince');
    committed(await w.world.post('goals/settings/set', graphWrite(S6A_SCOPE, { goalRef: born, autonomy: 'every_step',
      waitForGoalRef: null }, 'n3e-settings', [{ ref: born, revision: await goalRevision(w.world, born) }])),
    'N-3e: the settings write');
    await fileNodeOn(w, born, 'n3e-a');
    w.world.clock.advance(NRB_TICK);
    expect(await nrbRow(w, 'n3e-a', born)).toMatchObject({ pending: true });
  }, SLOW);
});

// Round 1 (Codex Astra `nrbcr.out.md`, lead ruling 11-27 22:4x "写测试方另补的格"): public counter-examples for the
// builder's fixes 1, 4 and 5. Fix 3 has no public counter-example (reply, round 1): the only public writer of a
// TaskReduction is the Workflow's completion step, which fix 1 stops from landing twice, and nothing public can step
// between the route's ledger read and the owner's window read.
describe('NR-B round 1: public counter-examples for the builder\'s fixes', () => {
  it('N-1i two flows that both reached complete_task add one reduction, not two (fix 1)', async () => {
    // Green today on 46f45a15 (probed): flow B's step pins `TaskReduction@0`, is refused `revision_conflict` and writes
    // nothing. Red with the builder's first build (Codex nrbcr 1: on the conflict it completes again at `current`).
    // Round-2 ruling 7 (Codex nrbcr2: that build put the second completion in B's `next`, which one advance never ran):
    // B's follow-up steps are run too, to where B stops; the fix re-selects (`select_work`), the base tree has none.
    // Mutation (fix 1): complete again at the conflict's `current` -> `@2` -> red.
    const w = await dnrWorld({ label: 'n1i', autonomy: 'every_step', taskIds: ['n1i-a'] });
    w.world.clock.advance(NRB_TICK);
    const line = await dnrLine(w, 'n1i-line', ['n1i-a']);
    await w.world.scripted.script(line, [{ kind: 'calls', calls: [createFile('n1i-edit', 'src/n1i.ts', note('n1i'))] },
      { kind: 'text', text: 'NRB n1i-a done' }]);
    const selectTask = (flowId: string): WorkflowAdvanceInput => ({ schemaVersion: 1, goalRef: w.goal, flowId,
      sessionHint: line.ref, kind: 'select_work', taskId: 'n1i-a' });
    const a = await driveWorkflow(w.world.ag2b, selectTask('n1i-flow-a'), { stopBefore: 'complete_task' });
    const b = await advanceUntil(w.world.ag2b, selectTask('n1i-flow-b'), 'complete_task');
    await driveWorkflow(w.world.ag2b, a[a.length - 1]!.next!);
    expect((await nrbRow(w, 'n1i-a')).reduction?.revision).toBe(1);
    const answer = (await w.world.post('workflow/advance', plain(S6A_SCOPE, b))).body as WorkflowAdvanceResult;
    expect(answer).toMatchObject({ status: 'ready' });
    const followUp = answer.status === 'ready' ? answer.value.next : null;
    if (followUp !== null) await driveWorkflow(w.world.ag2b, followUp);
    expect(await nrbRow(w, 'n1i-a')).toMatchObject({ pending: true, reduction: { revision: 1 } });
  }, SLOW);

  it('N-1j a second rework of the same version under a new requestId is revision_conflict naming the TaskRequeue (fix 4)', async () => {
    // Coordination (one decision per version). Red today at the first rework (404). Red with the builder's first build
    // (Codex nrbcr 4): P4 answers first, "not a completed node", `invalid`. Green when the owner finds the TaskRequeue
    // that covers this version before the state check.
    // Mutation (fix 4): let the state check answer first -> `invalid` -> red.
    const w = await pendingNode('n1j');
    const expected = await dnrPins(w, w.taskId);
    const first = committed<{ requeue: { ref: unknown } }>(await nrbRework(w, { taskId: w.taskId,
      requestId: 'n1j-rework', reason: REASON, expected }), 'N-1j: the first rework');
    expect(await nrbRework(w, { taskId: w.taskId, requestId: 'n1j-rework-again', reason: REASON, expected }))
      .toMatchObject({ status: 'rejected', code: 'revision_conflict',
        current: expect.arrayContaining([{ ref: first.requeue.ref, revision: 1 }]) });
    expect(await nrbRow(w, w.taskId)).toMatchObject({ pending: false, task: { phase: 'pending' } });
  }, SLOW);

  it('N-1k a long reason of many lines reaches the next round whole while the brief is crowded (fix 5)', async () => {
    // Red today at the rework (404). Red with the builder's first build (Codex nrbcr 5): the brief is over its
    // 16,384 bytes, so every text, the reason too, is cut at 1,000 characters (`RENDER_TEXT_CAPS`) and the last lines
    // are lost. The crowding: the first round's last answer is 4,000 CJK characters (the per-text bound, about 12 KB)
    // and the reason about 5.5 KB. Green when the reason has its room in the budget and optional body goes first
    // (fix 5); a continuation line may keep its indent, so each line is looked for on its own.
    // Mutation (fix 5): clip the reason like any other text -> lines 7–12 are missing -> red.
    const w = await dnrWorld({ label: 'n1k', autonomy: 'every_step', taskIds: ['n1k-a'] });
    w.world.clock.advance(NRB_TICK);
    const line = await dnrLine(w, 'n1k-line', ['n1k-a']);
    const done = await startNRBNode(w, line, 'n1k-a', [createFile('n1k-edit', 'src/n1k.ts', note('n1k'))],
      { text: '长'.repeat(4000) });
    await done.finish();
    committed(await nrbRework(w, { taskId: 'n1k-a', requestId: 'n1k-rework', reason: LONG_REASON_LINES.join('\n') }),
      'N-1k: the rework');
    const served = (await w.world.scripted.requests(line)).length;
    await startNRBNode(w, line, 'n1k-a', [], { flowId: 'n1k-again' });
    const next = (await w.world.scripted.requests(line))[served];
    expect(next).toBeDefined();
    const text = modelInputText(next!);
    for (const reasonLine of LONG_REASON_LINES) expect(text).toContain(reasonLine);
  }, SLOW);
});
