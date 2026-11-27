/**
 * GAPB-4 (7D2 DRUI2 B4): the task map's 同模块门 row and the person's 放开.
 *
 * Today the tree has the two routes and the gate owner (L1-routes) but no page
 * read, no detail row and no 放开 action (`grep -n "overlap-gates\|overlap-release"
 * src/ui` only names the route table). Every row is therefore red at its first
 * assertion; the RED lines are recorded per row below.
 *
 * After Astra's G2 lands, `readTaskMap`'s detail branch reads
 * `goals/overlap-gates` once (first page, 50), the adapter carries the one
 * matching gate, `d-rel` draws 同模块门 and the text built from the running
 * Task's title and the module's name, and `d-acts` opens the 16a reason field;
 * `goals/overlap-release` succeeds with the read gate's ref/revision and the
 * page rereads, so the row disappears. The failure table and the busy guard are
 * `gateWriteTextOf` and `gateBusy`.
 *
 * Every expected value comes from `goal-cards-B.md:303-313` and the world
 * fixture (the two Task titles, the `S6A core` catalog name); no production
 * constant is copied and no store is read.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { ModuleOverlapGateV1 } from '../../src/core/work-graph/persistence/module-overlap-gate-codecs.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS7C1World, type S7C1World } from '../helpers/S7C-member-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { findButton, findClass, findElement, type BootedPage } from './helpers/boot-page.js';
import { FakeElement } from './helpers/dom.js';
import { click } from './helpers/E3N-interact.js';
import { bootE3N, callsTo, countRoute, descendants, quietPage, textOf, waitFor, type PageLog } from './helpers/E3N-page.js';

let world: S7C1World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

const TASK_ONE = 'Independent work s7c-m1';
const TASK_TWO = 'Independent work s7c-m2';
const MODULE_ID = 's6a-core';
/** The fixture catalog's own name for `s6a-core` (`S6A-memory-fixture.ts:122`). */
const MODULE_NAME = 'S6A core';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type GateWorld = { w: S7C1World; gate: ModuleOverlapGateV1; page: BootedPage; log: PageLog };

function dagNode(root: FakeElement, title: string): FakeElement | undefined {
  return findElement(root, (element) => element.tagName.toLowerCase() === 'button'
    && (element.getAttribute('class') ?? '').split(/\s+/).includes('dg-node')
    && textOf(element).includes(title));
}

/**
 * Selects `title` and waits until the selection's reads settle. The board draws
 * the detail head from the map row at the click, before `readMore` sends the
 * detail reads, so the title alone does not mean the gates read has run.
 */
async function openTask(page: BootedPage, log: PageLog, title: string): Promise<void> {
  await waitFor(() => dagNode(page.root, title) !== undefined);
  click(dagNode(page.root, title)!);
  await waitFor(() => textOf(findClass(page.root, 'detail')).includes(title));
  await quietPage(log);
}

const detailOf = (page: BootedPage): FakeElement => findClass(page.root, 'detail')!;

/** The one relation line the gate draws: a `d-line` naming the running Task and the module. */
function gateLineOf(root: FakeElement | undefined): FakeElement | undefined {
  return root === undefined ? undefined : findElement(root, (element) =>
    (element.getAttribute('class') ?? '').split(/\s+/).includes('d-line')
    && textOf(element).includes(TASK_ONE) && textOf(element).includes(MODULE_NAME));
}

/**
 * The confirm 放开 inside the reason field: the first 放开 button after the
 * reused 16a field (`#tm-disp-note`) in document order. The action that opened
 * the field sits outside/before this card.
 */
function gateConfirm(page: BootedPage): FakeElement | undefined {
  /* The fake DOM has no parent pointer; `descendants` plus the root is document order. */
  const order = [page.root, ...descendants(page.root)];
  const noteAt = order.findIndex((element) => element.getAttribute('id') === 'tm-disp-note');
  if (noteAt < 0) return undefined;
  return order.slice(noteAt + 1).find((element) => element.tagName.toLowerCase() === 'button'
    && textOf(element) === '放开');
}

/** Opens task 2's detail, expands 放开 and types the reason; returns the field's confirm button. */
async function openGateRelease(page: BootedPage, log: PageLog, reason: string): Promise<FakeElement> {
  await openTask(page, log, TASK_TWO);
  const action = findButton(page.root, '放开');
  expect(action, 'the gate row offers 放开').toBeDefined();
  click(action!);
  await waitFor(() => findElement(page.root, (element) => element.getAttribute('id') === 'tm-disp-note') !== undefined);
  const note = findElement(page.root, (element) => element.getAttribute('id') === 'tm-disp-note')!;
  note.value = reason;
  note.dispatch('input');
  const confirm = gateConfirm(page);
  expect(confirm, 'the reason field has its own 放开').toBeDefined();
  return confirm!;
}

/**
 * The one world each row builds: the S7C fixture with its first Task held at a
 * real model request (so it is `running` in the map), the second Task waiting,
 * and one real gate at that plan revision. The gate is opened through the
 * published owner L1-routes uses, never through a record write.
 */
async function openGatePage(options: NonNullable<Parameters<typeof bootE3N>[2]> = {}): Promise<GateWorld> {
  const w = await openS7C1World({ backend: 'memory', firstRun: 'held' });
  world = w;
  if (w.plan === null) throw new Error('GAPB-4: the world has no adopted Plan');
  const execution = ready<TaskExecutionRecord>(
    await w.world.post('executions/read', plain(S6A_SCOPE, w.run.runRef)), 'the running Run');
  const opened = await w.world.platform.overlapGates.openOverlapGate(w.world.systemContext(), {
    goalRef: w.goal, task: w.tasks[1]!, moduleId: MODULE_ID,
    running: [{ task: w.tasks[0]!, run: w.run.runRef, startCursor: execution.run.startedSince }],
    planRevision: w.plan.planRevision, waitingAttempt: 'none',
  });
  if (opened.status !== 'opened') throw new Error(`GAPB-4: the gate did not open: ${JSON.stringify(opened)}`);
  const { page, log } = await bootE3N(w.world, 'TaskMap',
    { search: `?goal=${w.goal.goalId}`, mode: 'controlled', ...options });
  /* The first read and the stream-open reread settle before a row selects: a
     selection during that reread joins its shared demand and reads the detail
     (and its gates) once more. */
  await quietPage(log);
  return { w, gate: opened.gate, page, log };
}

describe('GAPB-4 the task map reads and draws the same-module gate', () => {
  it('G2-1 selecting the waiting Task reads the gates once and the detail names the running Task and module', async () => {
    /* 今天红在 `tests/ui/GAPB-4-overlap-gate.test.ts:129`（一次门读断言）：`readTaskMap` 的详情分支
       还没读 `goals/overlap-gates`，页面也不画门行；Astra 落地后详情读一次、行上出现任务名和模块名，转绿。 */
    /* Named mutation: drop the `goals/overlap-gates` read from readTaskMap's
       detail branch, or drop the `同模块门` group from the row builder; the
       one-read assertion and the d-line assertion each go red. Not run:
       production is not in this tree. */
    const opened = await openGatePage();
    try {
      await openTask(opened.page, opened.log, TASK_TWO);
      expect(countRoute(opened.log, 'goals/overlap-gates'), 'one gates read after the selection').toBe(1);
      const read = callsTo(opened.log, 'goals/overlap-gates')[0]!;
      expect(read.input).toMatchObject({ goalRef: opened.w.goal, page: { limit: 50 } });
      expect((read.input as { page: { cursor?: unknown } }).page.cursor ?? null, 'no cursor').toBeNull();
      const detail = detailOf(opened.page);
      expect(textOf(detail), 'the 同模块门 group').toContain('同模块门');
      const line = gateLineOf(detail);
      expect(line, 'the row names the running Task and the module').toBeDefined();
      expect(textOf(line)).toContain(TASK_ONE);
      expect(textOf(line)).toContain(MODULE_NAME);
    } finally {
      await opened.page.restore();
    }
  });

  it('G2-2 a reason and 放开 send one release with the read ref/revision and the row disappears', async () => {
    /* 今天红在 `tests/ui/GAPB-4-overlap-gate.test.ts:84`（`openGateRelease` 的“放开”按钮）：
       门读没接、行上没有“放开”；Astra 落地后行画出放开、释放带读到的 ref/revision、成功后重读，转绿。 */
    /* Named mutation: send revision 1 instead of the read gate's revision, or
       keep the row after `released`; the input assertion and the vanished-row
       assertion each go red. Not run: production is not in this tree. */
    const opened = await openGatePage();
    try {
      const confirm = await openGateRelease(opened.page, opened.log, '先放开这道门');
      click(confirm);
      await waitFor(() => callsTo(opened.log, 'goals/overlap-release').some((call) => call.reply !== undefined));
      expect(countRoute(opened.log, 'goals/overlap-release'), 'one release').toBe(1);
      const call = callsTo(opened.log, 'goals/overlap-release')[0]!;
      expect(call.input).toMatchObject({
        commandId: expect.stringMatching(UUID_V4),
        gate: opened.gate.ref,
        revision: opened.gate.revision,
        reason: '先放开这道门',
      });
      expect(call.reply).toMatchObject({ status: 'released' });
      await waitFor(() => gateLineOf(detailOf(opened.page)) === undefined);
      expect(textOf(detailOf(opened.page)), 'the row is gone after the reread').not.toContain('同模块门');
    } finally {
      await opened.page.restore();
    }
  });

  it('G2-3 an empty reason greys 放开 and a click sends nothing', async () => {
    /* 今天红在 `tests/ui/GAPB-4-overlap-gate.test.ts:181`（“放开”按钮不存在）：
       行没画出来；Astra 落地后空理由的确认键是 `is-off` + `disabled`，不发送，两句转绿。 */
    /* Named mutation: drop the empty-reason `off` on the confirm button; both
       the grey assertion and the zero-release assertion go red. Not run:
       production is not in this tree. */
    const opened = await openGatePage();
    try {
      await openTask(opened.page, opened.log, TASK_TWO);
      const action = findButton(opened.page.root, '放开');
      expect(action, 'the gate row offers 放开').toBeDefined();
      click(action!);
      await waitFor(() => findElement(opened.page.root, (element) => element.getAttribute('id') === 'tm-disp-note') !== undefined);
      const confirm = gateConfirm(opened.page);
      expect(confirm, 'the reason field has its own 放开').toBeDefined();
      expect((confirm!.getAttribute('class') ?? '').split(/\s+/), 'the empty-reason 放开 is grey')
        .toContain('is-off');
      expect(confirm!.getAttribute('disabled'), 'the empty-reason 放开 is not actionable').not.toBeNull();
      click(confirm!);
      await quietPage(opened.log);
      expect(countRoute(opened.log, 'goals/overlap-release'), 'no release from an empty reason').toBe(0);
    } finally {
      await opened.page.restore();
    }
  });

  it('G2-4 a held release and two clicks send one write', async () => {
    /* 今天红在 `tests/ui/GAPB-4-overlap-gate.test.ts:84`（`openGateRelease` 的“放开”按钮）：
       行没画出来；Astra 落地后 `gateBusy` 守住第二次点击，一次释放、传输计数保持 1，转绿。 */
    /* Named mutation: remove the `gateBusy` guard from the confirm handler;
       the second click reaches the held route and both the call count and the
       transport count become 2. Not run: production is not in this tree. */
    let releaseHeld!: () => void;
    const held = new Promise<void>((resolve) => { releaseHeld = resolve; });
    let entered = 0;
    const opened = await openGatePage({
      before: { 'goals/overlap-release': async () => { entered += 1; await held; } },
    });
    try {
      const confirm = await openGateRelease(opened.page, opened.log, '只放一次');
      click(confirm);
      await waitFor(() => entered === 1);
      click(confirm);
      releaseHeld();
      await waitFor(() => callsTo(opened.log, 'goals/overlap-release').some((call) => call.reply !== undefined));
      await quietPage(opened.log);
      expect(countRoute(opened.log, 'goals/overlap-release'), 'one release').toBe(1);
      expect(entered, 'the second click never reaches the transport').toBe(1);
      await waitFor(() => gateLineOf(detailOf(opened.page)) === undefined);
    } finally {
      releaseHeld();
      await opened.page.restore();
    }
  });

  it.each([
    /* 今天红在 `tests/ui/GAPB-4-overlap-gate.test.ts:84`（`openGateRelease` 的“放开”按钮）：
       这一 entry 的拒绝分支到不了；Astra 落地后 `revision_conflict` 显示这句，转绿。 */
    { code: 'revision_conflict', reason: 'GAPB-4: the gate moved', typed: '这道门刚变过',
      expected: '这道门刚变过，等页面刷新后再点一次。' },
    /* 今天红在 `tests/ui/GAPB-4-overlap-gate.test.ts:84`（`openGateRelease` 的“放开”按钮）：
       这一 entry 的拒绝分支到不了；Astra 落地后 `invalid` 显示这句，转绿。 */
    { code: 'invalid', reason: 'the overlap gate is already satisfied', typed: '参谋已经记了',
      expected: '参谋已经记了约定，这道门已经过了。' },
  ] as const)('G2-5/6 a $code release failure keeps its own words', async (entry) => {
    /* Named mutation, one per entry: let this entry's code fall back to
       writeTextOf; this entry's expected sentence goes red while the other
       entry stays green. Not run: production is not in this tree. */
    const opened = await openGatePage({ rejectOnce: { route: 'goals/overlap-release',
      code: entry.code, reason: entry.reason } });
    try {
      const confirm = await openGateRelease(opened.page, opened.log, entry.typed);
      click(confirm);
      await waitFor(() => textOf(detailOf(opened.page)).includes(entry.expected));
      expect(textOf(detailOf(opened.page))).toContain(entry.expected);
    } finally {
      await opened.page.restore();
    }
  });

  it('G2-7 selecting the running Task still reads gates but draws no row', async () => {
    /* 今天红在 `tests/ui/GAPB-4-overlap-gate.test.ts:260`（一次门读断言）：详情还没读门；
       Astra 落地后详情仍读一次但只画等待中的任务，running 任务没有门行，转绿。 */
    /* Named mutation: draw every gate of the Goal instead of only the one whose
       waiting Task is selected; the running Task's detail gains 同模块门. Not
       run: production is not in this tree. */
    const opened = await openGatePage();
    try {
      await openTask(opened.page, opened.log, TASK_ONE);
      expect(countRoute(opened.log, 'goals/overlap-gates'), 'the detail still asks for gates').toBe(1);
      expect(gateLineOf(detailOf(opened.page)), 'the running Task draws no gate row').toBeUndefined();
      expect(textOf(detailOf(opened.page))).not.toContain('同模块门');
    } finally {
      await opened.page.restore();
    }
  });

  it('G2-8 a failed gates read draws no row and the rest of the detail stays', async () => {
    /* 今天红在 `tests/ui/GAPB-4-overlap-gate.test.ts:278`（一次门读断言）：详情还没读门；
       Astra 落地后失败读被吞掉、行不画而详情其余部分仍在，三句转绿。 */
    /* Named mutation: drop the read-failure catch (or draw the row before the
       read answers); the failed reply leaves the row in the detail, or the
       failure removes the whole detail. Not run: production is not in this
       tree. */
    const opened = await openGatePage({ unavailableOnce: 'goals/overlap-gates' });
    try {
      await openTask(opened.page, opened.log, TASK_TWO);
      expect(countRoute(opened.log, 'goals/overlap-gates'), 'the detail asks for gates once').toBe(1);
      expect(callsTo(opened.log, 'goals/overlap-gates')[0]!.reply).toMatchObject({ status: 'rejected', code: 'unavailable' });
      const detail = detailOf(opened.page);
      expect(gateLineOf(detail), 'a failed read draws no gate row').toBeUndefined();
      expect(textOf(detail), 'the rest of the detail is still there').toContain(TASK_TWO);
      expect(textOf(detail), 'the relation section is still there').toContain('关系');
    } finally {
      await opened.page.restore();
    }
  });
});
