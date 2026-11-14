import { afterAll, describe, expect, it } from 'vitest';
import { findClass, findElement } from './helpers/boot-page.js';
import { bootE3N, hasClass, textOf, waitFor } from './helpers/E3N-page.js';
import { hover } from './helpers/E3N-interact.js';
import { openW2 } from './helpers/E3N-world.js';
import {
  bootMemberAt, elementsOf, headFact, memberSearch, openMemberS7C, press, railRowOf, settle, workLineOf, worldSlot,
} from './helpers/E3M-world.js';
import { openS7C1World, jsonOf, startS7C1ToolLine } from '../helpers/S7C-member-fixture.js';
import { openUnknownWorld } from './helpers/E3D-world.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { asRecord, asText } from '../../src/ui/values.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { HostScenario } from '../scenarios/harness.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3M-12 (CLKD package 8, rows P12-3/P12-6/P13-2/P13-6): the archived row's
 * kept tag, the task card's own state word, the rail row's role · scope · word,
 * and the child line a real `create_member` call opens. Values are the click
 * table's and UI-WORKBENCH's; the page's code only supplies selectors.
 */

const slot = worldSlot();
const scenarios: HostScenario[] = [];
afterAll(async () => {
  for (const h of scenarios.splice(0)) await h.dispose();
  await slot.close();
}, 240_000);

const archiveToggle = (root: FakeElement): FakeElement | undefined =>
  elementsOf(findClass(root, 'rail'), 'button').find((element) => element.getAttribute('aria-expanded') !== null);
const archivedRows = (root: FakeElement): FakeElement[] =>
  elementsOf(findClass(root, 'rail'), 'button').filter((element) => hasClass(element, 'is-arch'));

describe('E3M-12 archived tags, task cards, rail roles and created lines', () => {
  it('P12-3 an archived row keeps its 已归档 tag (page error, to fix)', async () => {
    const opened = await openW2();
    try {
      const { page } = await bootE3N(opened.world, 'Member', { search: '?goal=ag2b-goal', mode: 'controlled', gate: true });
      try {
        press(archiveToggle(page.root), '已归档');
        await settle(() => archivedRows(page.root).length > 0);
        expect(archivedRows(page.root).length).toBeGreaterThan(0);
        const sub = textOf(findClass(archivedRows(page.root)[0]!, 'row-sub'));
        /* W2's archived line is `plain` (no terminal Task); the contract's word for
           an archived line is 已归档, and the click table keeps `已归档 · 已做完/已退役`
           for the done/retired cases. 具名改坏: `railRow` 给归档行传 `sub:''`；这一句红（页面错，待修）。 */
        expect.soft(sub).toBe('已归档');
      } finally {
        await page.restore();
      }
    } finally {
      await opened.world.close();
    }
  }, 180_000);

  it('P12-6 an outcome-unknown line keeps 待核对 and the task card names 执行结果待核对 (page error on the card)', async () => {
    const h = await openUnknownWorld();
    scenarios.push(h);
    const line = await workLineOf(h);
    const booted = await bootMemberAt(h.host, memberSearch('ag2b-goal', line));
    try {
      /* The line's own most urgent word is the unknown outcome. */
      expect(headFact(booted.page.root, '状态')).toBe('待核对');
      const task = findClass(booted.page.root, 'mh-task');
      expect(task).toBeDefined();
      hover(task!);
      await waitFor(() => findClass(booted.page.root, 'hcard') !== undefined, 2_000);
      const card = findClass(booted.page.root, 'hcard')!;
      /* 具名改坏: 任务卡仍用控制的 `tc`（暂停卡）；冻结的看什么要任务自己的“执行结果待核对”，这一句红（页面错，待修）。 */
      expect.soft(textOf(card)).toContain('执行结果待核对');
    } finally {
      await booted.page.restore();
    }
  }, 240_000);

  it('P13-2 a rail row names the role, the scope and the status word (page error, to fix)', async () => {
    const w = await openMemberS7C({ firstRun: 'held' });
    try {
      const booted = await bootMemberAt(w.s7c.world, memberSearch('s7c-goal', w.module));
      try {
        const current = findElement(booted.page.root, (element) => element.getAttribute('aria-current') === 'page');
        expect(current).toBeDefined();
        const text = textOf(current);
        expect.soft(text).toContain('执行者');
        expect(text).toContain('Independent work s7c-m1');
        expect(text).toContain('工作中');
        /* 具名改坏: 左栏行只画 name+word、不画负责范围（模块）；UI-WORKBENCH §5 要角色 · 负责范围 · 状态词，这一句红（页面错，待修）。 */
        expect.soft(text).toContain('s6a-core');
      } finally {
        await booted.page.restore();
      }
    } finally {
      await w.s7c.close();
    }
  }, 180_000);

  it('P13-6 a granted create_member Run opens a child line the Member rail shows', async () => {
    const w = await openS7C1World({ backend: 'memory' });
    try {
      const read = asRecord((await w.world.post('goals/read', plain(S6A_SCOPE, w.goal))).body);
      const value = asRecord(read['value']);
      const revision = asRecord(value['goal'])['revision'] as number;
      const written = asRecord((await w.world.post('goals/settings/set', graphWrite(S6A_SCOPE, {
        goalRef: w.goal, autonomy: 'after_plan_confirmation', waitForGoalRef: null,
      }, 'e3m-p13-autonomy', [{ ref: w.goal, revision }]))).body);
      expect(written['status']).toBe('committed');
      const caller = w.lines.adviser;
      if (caller === null) throw new Error('S7C: the world has no adviser caller');
      await startS7C1ToolLine(w);
      const result = asRecord(jsonOf(await w.world.scripted.requests(caller), 's7c-tool-call'));
      expect(result['status']).toBe('created');
      const session = asRecord(result['session']);
      const child: SessionRef = { projectId: asText(session['projectId']) as string,
        sessionId: asText(session['sessionId']) as string };
      const booted = await bootMemberAt(w.world, memberSearch('s7c-goal', w.lines.module.ref));
      try {
        const row = await railRowOf(booted.page.root, w.world, child);
        expect(row).toBeDefined();
        /* 具名改坏: 子线不进 `lines/list`（create_member 只写 operation）；本行的子线行红。 */
        expect(textOf(row)).toContain('S7C tool line');
      } finally {
        await booted.page.restore();
      }
    } finally {
      await w.close();
    }
  }, 240_000);
});
