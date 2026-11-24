import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findClass } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { click } from './helpers/E3N-interact.js';
import { descendants, hasClass, lineRows, onMain, quietPage, textOf, thread, waitFor } from './helpers/E3N-page.js';
import { lineOrder } from './helpers/E3N-world.js';
import { bootMemberAt, memberSearch } from './helpers/E3M-world.js';
import {
  openRun, runRows, stepMeta, stepObject, stepOfVerb, stepPathButtons, stepRows, stepVerbs,
} from './helpers/E3U-run-steps-page.js';
import { openPLReadingsWorld, type PLReadingsWorld } from '../helpers/PL-readings-fixture.js';
import { ensureProjectPointers, openS6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';

/**
 * E3U 1A row ① (ui-batches 154): the executor's Run reads two files, edits one
 * and runs one command in the PL readings world (real Host, write/shell grant).
 * Member's Run block heads with the hand-counted summary and its `.steps` are,
 * in order, 读取、读取、编辑（+2 −0）、运行命令（通过，n 秒）; on Main's line
 * view the read step's path button opens the same file in the right panel.
 *
 * The head and time are the projection's (`src/ui/adapters/run-steps.ts`); the
 * fixture clock may move, so the minute and the two clock ends are shapes.
 */

let fixture: PLReadingsWorld | undefined;
let line!: S6ASession;
let goalId = '';
afterAll(async () => { await fixture?.close(); }, 180_000);

const READ_ONE = 'src/module.ts';
const READ_TWO = 'tsconfig.json';
const EDIT = 'e3u-run-notes.md';
const COMMAND = 'echo e3u-run';

const posting = async (route: string, body: unknown): Promise<unknown> => (await fixture!.world.post(route, body)).body;

/** The rail button of `lines/list` row `index` (after the synthetic 秘书（主对话） row). */
function railButton(root: FakeElement, index: number): FakeElement | undefined {
  const holder = lineRows(root)[index + 1];
  return holder === undefined ? undefined
    : descendants(holder).find((element) => element.tagName.toLowerCase() === 'button') ?? holder;
}

beforeAll(async () => {
  fixture = await openPLReadingsWorld();
  const task = fixture.tasks[0]!;
  line = await fixture.line('e3u-run-steps', [task]);
  await fixture.runTask({ line, taskId: task.taskId, flowId: 'e3u-run-steps', replies: [
    { kind: 'calls', calls: [{ callId: 'e3u-read-one', name: 'read', args: { path: READ_ONE } }] },
    { kind: 'calls', calls: [{ callId: 'e3u-read-two', name: 'read', args: { path: READ_TWO } }] },
    { kind: 'calls', calls: [{ callId: 'e3u-edit', name: 'edit', args: { mode: 'create', path: EDIT, newText: 'a\nb' } }] },
    { kind: 'calls', calls: [{ callId: 'e3u-command', name: 'shell', args: { command: COMMAND } }] },
    { kind: 'text', text: 'E3U row ①: the Run is done' },
  ] });
  goalId = fixture.goal.goalId;
}, 180_000);

describe('E3U 1A row ① Member Run steps and Main path', () => {
  it('the Member record Run block lists 读取、读取、编辑、运行命令', async () => {
    const member = await bootMemberAt(fixture!.world, memberSearch(goalId, line.ref));
    try {
      await waitFor(() => runRows(thread(member.page.root)!).length > 0);
      await quietPage(member.log);
      const records = thread(member.page.root)!;
      const runRow = runRows(records)[0]!;
      /* The hand count: two reads, one created file, one command. */
      expect(textOf(runRow)).toContain('已读取 2 个文件、编辑 1 个文件、运行命令 1 次');
      expect(textOf(runRow)).toMatch(/用时 \d+ 分，已读取 2 个文件、编辑 1 个文件、运行命令 1 次/);
      expect(textOf(findClass(runRow, 't'))).toMatch(/^\d\d:\d\d–\d\d:\d\d$/);

      await openRun(records);
      await waitFor(() => stepVerbs(records).length === 4);
      expect(stepVerbs(records)).toEqual(['读取', '读取', '编辑', '运行命令']);
      const steps = stepRows(records);
      expect(stepObject(steps[0]!)).toBe(READ_ONE);
      expect(stepObject(steps[1]!)).toBe(READ_TWO);
      expect(stepObject(steps[2]!)).toBe(EDIT);
      /* The fixture's create: two lines added, none deleted (hand count). */
      expect(stepMeta(steps[2]!)).toBe('+2 −0');
      expect(stepObject(steps[3]!)).toBe(COMMAND);
      /* `echo` exits 0: the prototype's 通过 and the command's own seconds. */
      expect(stepMeta(steps[3]!)).toMatch(/^通过，\d+ 秒$/);
    } finally {
      await member.page.restore();
    }
  }, 180_000);

  it('the Main line-view read step opens the read path', async () => {
    const index = (await lineOrder(posting, S6A_SCOPE)).indexOf(line.ref.sessionId);
    expect(index).toBeGreaterThanOrEqual(0);
    await onMain(fixture!.world, async (page, log): Promise<void> => {
      await waitFor(() => railButton(page.root, index) !== undefined);
      click(railButton(page.root, index)!);
      await waitFor(() => findClass(page.root, 'lv-headbar') !== undefined);
      await quietPage(log);
      const lineThread = findClass(page.root, 'lv-thread');
      expect(lineThread, 'the line view thread').toBeDefined();
      await waitFor(() => runRows(lineThread!).length > 0);
      await openRun(lineThread!);
      await waitFor(() => stepVerbs(lineThread!).length === 4);
      expect(stepVerbs(lineThread!)).toEqual(['读取', '读取', '编辑', '运行命令']);
      /* A1: an edit's path is a plain `span.step-obj.is-path`, never a link. */
      expect(stepPathButtons(lineThread!).some((button) => textOf(button) === EDIT)).toBe(false);
      const editObj = findClass(stepOfVerb(lineThread!, '编辑')!, 'step-obj')!;
      expect(editObj.tagName.toLowerCase()).toBe('span');
      expect(hasClass(editObj, 'is-path')).toBe(true);

      const path = stepPathButtons(lineThread!).find((button) => textOf(button) === READ_ONE);
      expect(path, 'the read step\'s path button').toBeDefined();
      click(path!);
      await waitFor(() => findClass(page.root, 'fp-path')?.getAttribute('title') === READ_ONE);
      await quietPage(log);
      /* The right panel opened the same path and drew the fixture's own line. */
      expect(findClass(page.root, 'fp-path')!.getAttribute('title')).toBe(READ_ONE);
      expect(textOf(findClass(page.root, 'fp-path'))).toBe(READ_ONE);
      expect(textOf(findClass(page.root, 'fcode'))).toContain('AG2B_ISOLATED_SOURCE');
    }, { search: '?goal=' + goalId });
  }, 180_000);

  it('note 5a: a failed executions/steps read draws that block’s failure sentence and the page', async () => {
    const index = (await lineOrder(posting, S6A_SCOPE)).indexOf(line.ref.sessionId);
    expect(index).toBeGreaterThanOrEqual(0);
    await onMain(fixture!.world, async (page): Promise<void> => {
      await waitFor(() => railButton(page.root, index) !== undefined);
      click(railButton(page.root, index)!);
      await waitFor(() => findClass(page.root, 'lv-headbar') !== undefined);
      const lv = findClass(page.root, 'lv-thread');
      expect(lv, 'the line view thread').toBeDefined();
      await waitFor(() => runRows(lv!).length > 0);
      const run = runRows(lv!)[0]!;
      expect(textOf(run)).toContain('读取失败。');
      expect(textOf(run)).not.toContain('unavailable');
      /* Note 2 on the line view: the ended Run's sentence is still the whole
         block (no chevron, no steps), and its terminal word stays in the head. */
      expect(findClass(run, 'chev'), 'no chevron on an ended one-sentence block').toBeUndefined();
      expect(run.getAttribute('aria-expanded')).toBe('false');
      expect(textOf(run), 'the terminal word stays').toContain('已结束');
      click(run);
      expect(findClass(run, 'steps'), 'no steps after the click').toBeUndefined();
      expect(findClass(lv!, 'steps'), 'no steps in the line view').toBeUndefined();
      expect(findClass(page.root, 'lv-headbar'), 'the rest of the line view').toBeDefined();
    }, { search: '?goal=' + goalId, failOnce: 'executions/steps' });
  }, 180_000);

  it('note 8: a failed read step is red but not a clickable path, the successful read still is', async () => {
    const world = await openPLReadingsWorld();
    try {
      const task = world.tasks[0]!;
      const missing = await world.line('e3u-note8', [task]);
      await world.runTask({ line: missing, taskId: task.taskId, flowId: 'e3u-note8', replies: [
        { kind: 'calls', calls: [
          { callId: 'e3u-note8-missing', name: 'read', args: { path: 'src/e3u-missing.ts' } },
          { callId: 'e3u-note8-ok', name: 'read', args: { path: READ_ONE } },
        ] },
        { kind: 'text', text: 'E3U note 8: the two reads are done' },
      ] });
      const postingHere = async (route: string, body: unknown): Promise<unknown> =>
        (await world.world.post(route, body)).body;
      const index = (await lineOrder(postingHere, S6A_SCOPE)).indexOf(missing.ref.sessionId);
      expect(index).toBeGreaterThanOrEqual(0);
      await onMain(world.world, async (page): Promise<void> => {
        await waitFor(() => railButton(page.root, index) !== undefined);
        click(railButton(page.root, index)!);
        await waitFor(() => findClass(page.root, 'lv-headbar') !== undefined);
        const lv = findClass(page.root, 'lv-thread')!;
        await waitFor(() => runRows(lv).length > 0);
        await openRun(lv);
        await waitFor(() => stepRows(lv).length === 2);
        const steps = stepRows(lv);
        const failed = steps.find((step) => hasClass(step, 'is-fail'));
        expect(failed, 'the failed read step').toBeDefined();
        const failedObj = findClass(failed!, 'step-obj')!;
        expect(failedObj.tagName.toLowerCase(), 'not a button').not.toBe('button');
        expect(hasClass(failedObj, 'is-link'), 'no is-link on a failed read').toBe(false);
        const success = steps.find((step) => !hasClass(step, 'is-fail'));
        expect(success, 'the successful read step').toBeDefined();
        const successObj = findClass(success!, 'step-obj')!;
        expect(successObj.tagName.toLowerCase(), 'the success read is still a button').toBe('button');
        expect(hasClass(successObj, 'is-link'), 'the success read is still a link').toBe(true);
      }, { search: '?goal=' + world.goal.goalId });
    } finally {
      await world.close();
    }
  }, 180_000);

  it('note 2: a not_started run block is one sentence with no chevron and no steps', async () => {
    const world = await openS6AHostWorld({ backend: 'memory', secretaryTools: ['read'] });
    try {
      await ensureProjectPointers(world);
      const submitted = await world.submit({ commandId: 'e3u-note2-submit', goalId: S6A_GOAL_1.goalId,
        text: 'E3U note 2: the round is not started' });
      if (submitted.status !== 'queued') throw new Error(`E3U note 2: the request was not queued: ${JSON.stringify(submitted)}`);
      await onMain(world, async (page, log): Promise<void> => {
        const conversation = thread(page.root);
        expect(conversation, 'Main’s conversation').toBeDefined();
        await waitFor(() => runRows(conversation!).length > 0);
        const run = runRows(conversation!)[0]!;
        expect(textOf(run)).toContain('这一次还没开始。');
        expect(findClass(run, 'chev'), 'no chevron on a one-sentence block').toBeUndefined();
        expect(run.getAttribute('aria-expanded')).toBe('false');
        click(run);
        await quietPage(log);
        expect(findClass(run, 'steps'), 'no steps after the click').toBeUndefined();
        expect(findClass(conversation!, 'steps')).toBeUndefined();
        expect(textOf(conversation!), 'the request bubble is still there').toContain('E3U note 2: the round is not started');
      }, { search: '?goal=' + S6A_GOAL_1.goalId });
    } finally {
      await world.close();
    }
  }, 180_000);
});
