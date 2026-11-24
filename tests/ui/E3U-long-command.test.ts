import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { QueryRunRef } from '../../src/contracts/query-job.js';
import type { RunStepsReadV1 } from '../../src/contracts/run-steps.js';
import { findClass, findElement, type BootedPage } from './helpers/boot-page.js';
import { click } from './helpers/E3N-interact.js';
import {
  callsTo, descendants, lineRows, onMain, sentWrite, textOf, waitFor, type PageLog,
} from './helpers/E3N-page.js';
import { lineOrder } from './helpers/E3N-world.js';
import { bootMemberAt, memberSearch, press, railRowOf } from './helpers/E3M-world.js';
import { openRun, runRows, stepMeta, stepOfVerb, stepRows } from './helpers/E3U-run-steps-page.js';
import { openStuckRunWorld, type StuckRunWorld } from './helpers/E3U-stuck-run-world.js';
import type { FakeElement } from './helpers/dom.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { claimWithSecretaryProfile, prepareAttempt, start } from '../helpers/request-claim-steps.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { waitFor as waitForRoute } from '../scenarios/harness.js';

/**
 * E3U 1A row ⑤ (ui-batches 158): the long-command line and its 停止 action.
 *
 * Work: the SHT-2 stuck-shell world (`E3U-stuck-run-world.ts`) with the fake
 * clock past ten minutes. Main's line view draws the command step's meta from
 * the Host's `executions/running-commands` answer (`正在跑，已 N 分钟` plus
 * `，超过预计`); 停止 opens the line view's existing cancel confirmation and
 * its 取消执行 sends exactly one `controls/submit` with `kind: 'cancel'`.
 *
 * Query: a real S6A secretary round whose `run_readonly_command` is still
 * running (its `executions/steps` step is `running`), clock past ten minutes.
 * Main's conversation block draws the same meta; 停止 sends exactly one
 * `queries/cancel` naming that round's `queryRunRef`, with no confirm card.
 *
 * The expected minute is the Host's own `elapsedMs` (floor minutes), never a
 * hand count of the test clock: the two are compared, not assumed.
 */

const WORK = 'e3u-row5-work';
const QUERY = 'e3u-row5-query';
let stuck: StuckRunWorld | undefined;
afterAll(async () => { await stuck?.close(); }, 180_000);

type RunningItem = {
  callId: string; elapsedMs: number; overLine: boolean;
  run: { kind: 'run'; runRef: { projectId: string; goalId: string; runId: string } }
    | { kind: 'query'; queryRunRef: QueryRunRef };
};
type RunningRead = { status: string; value?: { items: RunningItem[] } };

/** The one rail button of `lines/list` row `index` (after the synthetic 秘书 row). */
function railButton(root: FakeElement, index: number): FakeElement | undefined {
  const holder = lineRows(root)[index + 1];
  return holder === undefined ? undefined
    : descendants(holder).find((element) => element.tagName.toLowerCase() === 'button') ?? holder;
}

/** Selects 详细 before the line view replaces the main conversation's header. */
async function pickDetailed(page: BootedPage): Promise<void> {
  const toggle = (): FakeElement | undefined => findElement(page.root, (element) =>
    element.getAttribute('aria-haspopup') === 'menu'
    && (element.getAttribute('title') ?? '').includes('显示多少过程'));
  await waitFor(() => toggle() !== undefined);
  click(toggle()!);
  await waitFor(() => findElement(page.root, (element) =>
    element.getAttribute('role') === 'menuitemradio' && textOf(element) === '详细') !== undefined);
  click(findElement(page.root, (element) =>
    element.getAttribute('role') === 'menuitemradio' && textOf(element) === '详细')!);
  await waitFor(() => textOf(toggle()).includes('详细'));
}

/** The `停止` button of one step (styled `btn btn-sm btn-line`). */
function stopButton(step: FakeElement): FakeElement | undefined {
  return descendants(step).find((element) =>
    element.tagName.toLowerCase() === 'button' && textOf(element) === '停止');
}

/** The line view's existing cancel confirmation card. */
function confirmCard(root: FakeElement): FakeElement | undefined {
  return findElement(root, (element) => element.getAttribute('role') === 'alertdialog'
    && element.getAttribute('aria-label') === '确认取消这次执行');
}

/** The answered `executions/running-commands` read the page made (its own answer, not a fabricated one). */
function pageRunningItems(log: PageLog): RunningItem[] {
  const call = [...callsTo(log, 'executions/running-commands')]
    .reverse().find((entry) => entry.reply !== undefined);
  expect(call, 'the page read executions/running-commands').toBeDefined();
  const read = call!.reply as RunningRead;
  expect(read.status, 'the running-commands answer').toBe('ready');
  return read.value?.items ?? [];
}

const runningOf = async (world: S6AHostWorld): Promise<RunningRead> =>
  (await world.post('executions/running-commands', plain(S6A_SCOPE, {}))).body as RunningRead;

describe('E3U 1A row ⑤ the long command line and its 停止 action', () => {
  it('Work: the line view says 正在跑，已 N 分钟 and 停止 confirms one controls/submit cancel', async () => {
    stuck = await openStuckRunWorld(WORK);
    await stuck.started();
    stuck.fixture.world.clock.advance(11 * 60_000);
    const fixture = stuck.fixture;
    const posting = async (route: string, body: unknown): Promise<unknown> =>
      (await fixture.world.post(route, body)).body;
    await onMain(fixture.world, async (page: BootedPage, log: PageLog): Promise<void> => {
      await waitFor(() => lineRows(page.root).length > 0);
      const index = (await lineOrder(posting, S6A_SCOPE)).indexOf(stuck!.line.ref.sessionId);
      expect(index, 'the executor line in the rail').toBeGreaterThanOrEqual(0);
      await pickDetailed(page);
      await waitFor(() => railButton(page.root, index) !== undefined);
      click(railButton(page.root, index)!);
      await waitFor(() => findClass(page.root, 'lv-thread') !== undefined);
      const lineThread = (): FakeElement => findClass(page.root, 'lv-thread')!;
      await waitFor(() => runRows(lineThread()).length > 0);
      const run = await openRun(lineThread());
      expect(run.getAttribute('class') ?? '').toContain('is-live');
      await waitFor(() => stepOfVerb(lineThread(), '运行命令') !== undefined);

      /* One read on this refresh, and the step's minute is the Host's own. */
      await waitFor(() => callsTo(log, 'executions/running-commands').some((call) => call.reply !== undefined));
      expect(callsTo(log, 'executions/running-commands'), 'one running-commands read for this refresh').toHaveLength(1);
      const items = pageRunningItems(log);
      expect(items, 'the stuck command is listed').toHaveLength(1);
      const item = items[0]!;
      expect(item.run.kind, 'the Work run kind').toBe('run');
      expect(item.overLine, 'eleven minutes is past the ten-minute line').toBe(true);
      const minutes = Math.floor(item.elapsedMs / 60_000);
      expect(minutes).toBeGreaterThanOrEqual(11);
      const step = stepOfVerb(lineThread(), '运行命令')!;
      expect(stepMeta(step)).toBe('正在跑，已 ' + String(minutes) + ' 分钟，超过预计');

      const stop = stopButton(step);
      expect(stop, 'the 停止 button after the command meta').toBeDefined();
      click(stop!);
      await waitFor(() => confirmCard(page.root) !== undefined);
      const card = confirmCard(page.root)!;
      const confirm = descendants(card).find((element) =>
        element.tagName.toLowerCase() === 'button' && textOf(element) === '取消执行');
      expect(confirm, 'the existing cancel confirmation card').toBeDefined();
      const before = callsTo(log, 'controls/submit').length;
      click(confirm!);
      await waitFor(() => callsTo(log, 'controls/submit').length === before + 1
        && callsTo(log, 'controls/submit').every((call) => call.reply !== undefined));
      const writes = callsTo(log, 'controls/submit');
      expect(writes, 'exactly one controls/submit').toHaveLength(1);
      expect(sentWrite(writes[0]).input.kind, 'the cancel control').toBe('cancel');
      expect(sentWrite(writes[0]).input.runRef).toMatchObject({ runId: item.run.kind === 'run' ? item.run.runRef.runId : '' });
    }, { search: '?goal=' + fixture.goal.goalId });
  }, 180_000);

  it('Work: stopping another line’s live Run opens this view’s own cancel card, not the page’s', async () => {
    const w = await openStuckRunWorld(WORK + '-other', { secondTask: true });
    try {
      await w.started();
      w.fixture.world.clock.advance(11 * 60_000);
      const { page, log } = await bootMemberAt(w.fixture.world, memberSearch(w.fixture.goal.goalId, w.own!.ref));
      try {
        await waitFor(() => lineRows(page.root).length > 0);
        press(await railRowOf(page.root, w.fixture.world, w.line.ref), 'the stuck Run’s line row');
        await waitFor(() => findClass(page.root, 'lv-thread') !== undefined);
        const lv = findClass(page.root, 'lv-thread')!;
        await waitFor(() => runRows(lv).length > 0);
        const run = await openRun(lv);
        expect(run, 'the other line’s run block').toBeDefined();
        await waitFor(() => stepOfVerb(lv, '运行命令') !== undefined);
        const stop = stopButton(stepOfVerb(lv, '运行命令')!);
        expect(stop, 'the 停止 button of the other line’s live Run').toBeDefined();
        click(stop!);
        await waitFor(() => confirmCard(page.root) !== undefined);
        const card = confirmCard(page.root)!;
        /* The line view’s own card, not the page’s: its wording has no
           “it stops at the next safe point” prefix. */
        expect(textOf(findClass(card, 'dc-line')), 'the line view’s own card')
          .toBe('任务记为“已取消”，之后只有你能重新入队；改动和工作记录保留。');
        const items = pageRunningItems(log);
        const item = items.find((entry) => entry.run.kind === 'run');
        if (item === undefined || item.run.kind !== 'run') throw new Error('the other line’s running command is not listed');
        const workRun = item.run.runRef;
        const before = callsTo(log, 'controls/submit').length;
        click(descendants(card).find((element) =>
          element.tagName.toLowerCase() === 'button' && textOf(element) === '取消执行')!);
        await waitFor(() => callsTo(log, 'controls/submit').length === before + 1
          && callsTo(log, 'controls/submit').every((call) => call.reply !== undefined));
        const writes = callsTo(log, 'controls/submit');
        expect(writes, 'exactly one controls/submit').toHaveLength(1);
        expect(sentWrite(writes[0]).input.kind, 'the cancel control').toBe('cancel');
        expect(sentWrite(writes[0]).input.runRef).toMatchObject({ runId: workRun.runId });
        /* Back on the page’s own line, the hidden page card must not appear. */
        press(await railRowOf(page.root, w.fixture.world, w.own!.ref), 'the page’s own line row');
        await waitFor(() => findClass(page.root, 'lv-thread') === undefined);
        expect(confirmCard(page.root), 'no stray page cancel card').toBeUndefined();
      } finally {
        await page.restore();
      }
    } finally {
      await w.close();
    }
  }, 180_000);

  it('Work: a failed running-commands read leaves the long command line out, the rest normal', async () => {
    const w = await openStuckRunWorld(WORK + '-5b', { finishedFirst: true });
    try {
      await w.started();
      w.fixture.world.clock.advance(11 * 60_000);
      const posting = async (route: string, body: unknown): Promise<unknown> =>
        (await w.fixture.world.post(route, body)).body;
      await onMain(w.fixture.world, async (page: BootedPage): Promise<void> => {
        await waitFor(() => lineRows(page.root).length > 0);
        const index = (await lineOrder(posting, S6A_SCOPE)).indexOf(w.line.ref.sessionId);
        await pickDetailed(page);
        click(railButton(page.root, index)!);
        await waitFor(() => findClass(page.root, 'lv-thread') !== undefined);
        const lv = findClass(page.root, 'lv-thread')!;
        await waitFor(() => runRows(lv).length > 0);
        await openRun(lv);
        await waitFor(() => stepRows(lv).length === 2);
        const steps = stepRows(lv);
        /* Note 5b: the finished command's own meta is untouched. */
        expect(stepMeta(steps[0]!), 'the finished command keeps its meta').toMatch(/^通过，\d+ 秒$/);
        /* The live command loses its long-command line and 停止; A1's 进行中 stays. */
        const step = steps[1]!;
        expect(stepMeta(step), 'no long command meta; A1’s 进行中 stays').toBe('进行中');
        expect(stopButton(step), 'no 停止 without the running-commands read').toBeUndefined();
        expect(findClass(page.root, 'lv-headbar'), 'the rest of the line view').toBeDefined();
      }, { search: '?goal=' + w.fixture.goal.goalId, failOnce: 'executions/running-commands' });
    } finally {
      await w.close();
    }
  });

  it.each([
    { outcome: 'cancelled', fail: false, title: 'Query: the conversation block says the same and 停止 sends one queries/cancel, no card' },
    { outcome: 'rejected', fail: true, title: 'Query rejected: 停止 says 写入失败 and sends no queries/cancel, no card' },
  ])('$title', async ({ fail }) => {
    await queryStopCase(fail);
  }, 180_000);

  async function queryStopCase(fail: boolean): Promise<void> {
    const go = QUERY + '-go';
    const world = await openS6AHostWorld({ backend: 'memory', secretaryTools: ['read', 'run_readonly_command'] });
    let running: Promise<unknown> | undefined;
    try {
      await ensureProjectPointers(world);
      const a: S6ASession = await world.createSecretary('a');
      await world.scripted.script(a, [
        { kind: 'calls', calls: [{ callId: QUERY + '-call', name: 'run_readonly_command',
          args: { command: `while [ ! -e ${go} ]; do sleep 0.05; done; echo go` } }] },
        { kind: 'text', text: JSON.stringify({ schemaVersion: 1, body: 'E3U row ⑤ never sent', ideas: [], goalCardDrafts: [] }) },
      ]);
      const submitted = await world.submit({ commandId: QUERY + '-submit', goalId: S6A_GOAL_1.goalId,
        text: 'E3U row ⑤: run one long read-only command' });
      if (submitted.status !== 'queued') throw new Error(`E3U row ⑤: the request was not queued: ${JSON.stringify(submitted)}`);
      expect(await claimWithSecretaryProfile(world, submitted.round, a, QUERY + '-claim')).toMatchObject({ status: 'committed' });
      const prepared = await prepareAttempt(world, submitted.round, QUERY + '-prepare');
      running = start(world, prepared, QUERY + '-start').catch(() => undefined);
      /* The round's own run ref, read from the public Query record; then its
         command step must be running before the clock moves (the registration
         stamps `startedAt` at that moment). */
      const queryRunRef = await waitForRoute(async () => {
        const read = await readQuery(world.ag2b, submitted.round);
        return read.run.ref as QueryRunRef | null;
      }, (ref) => ref !== null, 'the Query round run ref');
      const steps = async (): Promise<RunStepsReadV1> => {
        const reply = await world.post('executions/steps', plain(S6A_SCOPE, { ref: queryRunRef, after: null, limit: 50 }));
        return (reply.body as { value: RunStepsReadV1 }).value;
      };
      await waitForRoute(steps, (read) => read.kind === 'steps'
        && read.steps.some((step) => step.kind === 'command' && step.status === 'running'), 'the running command step');
      world.clock.advance(11 * 60_000);
      const listed = await waitForRoute(() => runningOf(world),
        (read) => read.status === 'ready' && (read.value?.items.length ?? 0) === 1, 'the listed Query command');
      const queryItem = listed.value!.items[0]!;
      expect(queryItem.run.kind).toBe('query');
      const expectedRunRef = queryItem.run.kind === 'query' ? queryItem.run.queryRunRef : null;
      expect(expectedRunRef).toEqual(queryRunRef);
      const minutes = Math.floor(queryItem.elapsedMs / 60_000);

      await onMain(world, async (page: BootedPage, log: PageLog): Promise<void> => {
        const conversation = findClass(page.root, 'thread')!;
        await waitFor(() => runRows(conversation).length > 0);
        const run = await openRun(conversation);
        expect(run.getAttribute('class') ?? '').toContain('is-live');
        await waitFor(() => stepOfVerb(conversation, '运行命令') !== undefined);
        await waitFor(() => callsTo(log, 'executions/running-commands').some((call) => call.reply !== undefined));
        const reads = callsTo(log, 'executions/running-commands');
        expect(reads.length, 'the page read running-commands').toBeGreaterThanOrEqual(1);
        expect(reads.every((call) => call.reply !== undefined), 'every read answered').toBe(true);
        const pageItem = pageRunningItems(log).find((entry) => entry.run.kind === 'query');
        expect(pageItem, 'the Query command in the page read').toBeDefined();
        expect(Math.floor(pageItem!.elapsedMs / 60_000)).toBe(minutes);
        const step = stepOfVerb(conversation, '运行命令')!;
        expect(stepMeta(step)).toBe('正在跑，已 ' + String(minutes) + ' 分钟，超过预计');

        const stop = stopButton(step);
        expect(stop, 'the 停止 button after the Query command meta').toBeDefined();
        const confirmsBefore = callsTo(log, 'controls/submit').length;
        click(stop!);
        if (fail) {
          await waitFor(() => textOf(page.root).includes('写入失败。'));
          expect(confirmCard(page.root), 'no confirm card for a rejected Query stop').toBeUndefined();
          expect(callsTo(log, 'controls/submit'), 'no controls/submit for a rejected Query stop').toHaveLength(confirmsBefore);
          /* Item 1: one more page reread (the 5 s live chain) does not clear the
             word under this step's 停止; a second click retries the cancel. */
          const stepsBefore = callsTo(log, 'executions/steps').length;
          await new Promise((resolve) => setTimeout(resolve, 5_100));
          await waitFor(() => {
            const calls = callsTo(log, 'executions/steps');
            return calls.length > stepsBefore && calls[calls.length - 1]?.reply !== undefined;
          });
          const refreshed = stepOfVerb(findClass(page.root, 'thread')!, '运行命令')!;
          const again = stopButton(refreshed)!;
          expect(textOf(refreshed), 'the failed word stays after the reread').toContain('写入失败。');
          const failWord = findClass(refreshed, 'tx-failed')!;
          expect(refreshed.childNodes.indexOf(failWord), 'the word comes after 停止')
            .toBeGreaterThan(refreshed.childNodes.indexOf(again));
          const cancelsBefore = callsTo(log, 'queries/cancel').length;
          click(again);
          await waitFor(() => callsTo(log, 'queries/cancel').length === cancelsBefore + 1
            && callsTo(log, 'queries/cancel')[cancelsBefore]?.reply !== undefined);
          return;
        }
        await waitFor(() => callsTo(log, 'queries/cancel').length === 1
          && callsTo(log, 'queries/cancel')[0]?.reply !== undefined);
        expect(confirmCard(page.root), 'no confirm card for a Query stop').toBeUndefined();
        expect(callsTo(log, 'controls/submit'), 'no controls/submit for a Query stop').toHaveLength(confirmsBefore);
        const cancels = callsTo(log, 'queries/cancel');
        expect(cancels, 'exactly one queries/cancel').toHaveLength(1);
        expect((cancels[0]!.input as { queryRunRef?: QueryRunRef }).queryRunRef).toEqual(expectedRunRef);
      }, { search: '?goal=' + S6A_GOAL_1.goalId, ...(fail ? { failOnce: 'queries/cancel' } : {}) });
      if (!fail) {
        await world.waitForRequest(submitted.requestRoot, (view) => view.rounds[0]?.status === 'ended',
          'E3U row ⑤: the cancelled Query round ended');
      }
    } finally {
      await writeFile(join(world.root, go), 'go').catch(() => undefined);
      await running?.catch(() => undefined);
      await world.close().catch(() => undefined);
    }
  }
});
