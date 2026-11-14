/** P07-3/P08-3 (clk-current.md:210/:213): two independent lines each held at a real model request,
 * and the continuation brief a person's requeue leaves on the next Run of the W6 Task. */

import { isDeepStrictEqual } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { findClass } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { textOf, thread } from './helpers/E3N-page.js';
import {
  bootMemberAt, bootMemberOnHost, buttonText, callsOf, elementsOf, memberSearch, openMemberW6, press,
  receiptBody, worldSlot,
} from './helpers/E3M-world.js';
import { AG2B_WORK_TASK_ID, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { openDrvWorld, runsOf, startGoalDriver } from '../helpers/DRV-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { sessionOf } from '../helpers/S7A-fixture.js';

/**
 * E3M-9 (clk-current.md §2 P07-3 and P08-3): P07-3 opens two lines that each
 * hold a real Run at its model request at the same time and reads the selected
 * line only; P08-3 shows the 接续说明 block after a 重新入队 and the next Run's
 * bound brief. Both expectations come from the behaviour table and
 * `src/ui/adapters/member.ts:245-255`, never from the page code.
 */

const slot = worldSlot();
afterAll(async () => { await slot.close(); }, 240_000);

const w6 = () => slot.use('W6', () => openMemberW6(), (opened) => opened.h.dispose());

/** A Run row's head (the span that is not the time `span.t`). */
const runHeadOf = (row: FakeElement): FakeElement | undefined => elementsOf(row, 'span')
  .find((span) => !(span.getAttribute('class') ?? '').split(/\s+/).includes('t'));

describe('E3M-9 the running line and the continuation brief', () => {
  it('P07-3 two lines each hold their own Run at its model request and each page reads only that Run', async () => {
    const { world, main, goal, tasks } = await slot.use('P07-3',
      () => openDrvWorld('clkc-p073', ['clkc-p073-a', 'clkc-p073-b']),
      async (opened) => { await opened.world.close(); });
    const lineA = await createS6BLine(main, { label: 'clkc-p073-line-a', role: S6A_WORK_ROLE, tasks: [tasks[0]!] });
    const lineB = await createS6BLine(main, { label: 'clkc-p073-line-b', role: S6A_WORK_ROLE, tasks: [tasks[1]!] });
    const sessionA = await sessionOf(world, lineA);
    const sessionB = await sessionOf(world, lineB);
    await world.scripted.script(sessionA, [{ kind: 'text', text: 'P07-3 line A done' }]);
    await world.scripted.script(sessionB, [{ kind: 'text', text: 'P07-3 line B done' }]);
    /* Both holds are installed before the driver starts, so each Run is held at
       its own model request at the same time. */
    const gateA = await world.gates.modelRequest(sessionA);
    const gateB = await world.gates.modelRequest(sessionB);
    await startGoalDriver(world, goal, 'clkc-p073');
    await gateA.reached;
    await gateB.reached;
    const runA = (await runsOf(world, goal, tasks[0]!.taskId))[0]!.run.ref;
    const runB = (await runsOf(world, goal, tasks[1]!.taskId))[0]!.run.ref;

    const clkcBootHeldLine = async (line: SessionRef, runRef: RunRef): Promise<void> => {
      const { page, log } = await bootMemberAt(world, memberSearch(goal.goalId, line));
      try {
        const run = elementsOf(thread(page.root), 'button', 'run')[0];
        expect(run, 'the live Run row of the selected line').toBeDefined();
        expect(textOf(runHeadOf(run!))).toMatch(/^正在执行：/);
        /* 具名改坏: the second boot opens line A again; this row reds on run B's Run ref. */
        expect(callsOf(log, 'executions/read').filter((call) => isDeepStrictEqual(call.input, runRef)))
          .toHaveLength(1);
        /* The page reads the selected line only: never the other line's live Run. */
        expect(callsOf(log, 'executions/read')).toHaveLength(1);
      } finally {
        await page.restore();
      }
    };
    await clkcBootHeldLine(lineA.ref, runA);
    await clkcBootHeldLine(lineB.ref, runB);

    gateA.release();
    gateB.release();
    await world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef: goal }));
  }, 180_000);

  it('P08-3 the continuation brief after a requeue names 返工 / 检查未通过 and reads the new Run’s brief once', async () => {
    const w = await w6();
    const first = await bootMemberOnHost(w.h, memberSearch('ag2b-goal', w.line));
    try {
      press(buttonText(first.page.root, '重新入队'), '重新入队');
      await expect.poll(() => receiptBody(first, 'tasks/requeue') !== undefined,
        { timeout: 30_000, interval: 50 }).toBe(true);
      expect(receiptBody(first, 'tasks/requeue')?.['status']).toBe('committed');
    } finally {
      await first.page.restore();
    }

    /* This world's Host leaves the successor `pending`; the row drives it. The
       drive stops before that successor's automatic requeue, so the page still
       shows attempt 5 and the brief 5 bound at its prepare. */
    const started = async (): Promise<boolean> => {
      const row = await w.h.taskRow();
      return row.attemptOrdinal === 5 && row.execution !== null;
    };
    await w.h.advance(w.h.select('clkc-p083-requeue', AG2B_WORK_TASK_ID), {
      stopBefore: (input) => input.kind === 'perform' && input.operation.kind === 'requeue_task',
    });
    await expect.poll(started, { timeout: 30_000, interval: 100 }).toBe(true);
    const row = await w.h.taskRow();
    expect(row.attemptOrdinal).toBe(5);
    expect(row.execution).not.toBeNull();
    const nextRun = row.execution!;

    const booted = await bootMemberOnHost(w.h, memberSearch('ag2b-goal', w.line));
    try {
      const brief = findClass(booted.page.root, 'brief-blk');
      expect(brief, 'the .brief-blk after the requeue').toBeDefined();
      expect(textOf(findClass(brief!, 'sys-line'))).toBe('接续说明：只用已保存的事实组装');
      const keys = elementsOf(brief, 'dt').map(textOf);
      const values = elementsOf(brief, 'dd').map(textOf);
      expect(keys).toEqual(['接续方式', '停下原因', '上次停在']);
      /* 具名改坏: the expected 接续方式 literal becomes `交接`; this row reds here. */
      expect(values.slice(0, 2)).toEqual(['返工', '检查未通过']);
      expect(values.every((value) => value.length > 0)).toBe(true);
      expect(callsOf(booted.log, 'executions/brief')
        .filter((call) => isDeepStrictEqual(call.input, { runRef: nextRun }))).toHaveLength(1);
      expect(callsOf(booted.log, 'executions/read')
        .filter((call) => isDeepStrictEqual(call.input, nextRun))).toHaveLength(1);
    } finally {
      await booted.page.restore();
    }
  }, 240_000);
});
