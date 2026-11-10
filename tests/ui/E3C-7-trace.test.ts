import { afterEach, describe, expect, it } from 'vitest';
import type { SessionHistoryEntry } from '../../src/core/agent-runtime/session-operations.js';
import { asRecord } from '../../src/ui/values.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS7C1World, type S7C1World } from '../helpers/S7C-member-fixture.js';
import { findClass, findElement } from './helpers/boot-page.js';
import { bootChain, byLabel, dlValue, groupHeads, type ChainPage } from './helpers/E3C-world.js';
import { buttonText, memberSearch, press, settle, worldSlot } from './helpers/E3M-world.js';
import { click, notConnected } from './helpers/E3N-interact.js';
import { descendants, hasClass, sleep, textOf } from './helpers/E3N-page.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * E3C-7 (test sheet §2.3, E3C-16..18; wiring C1, C4–C6, E2, DC2): the 轨迹
 * view shows the Run's raw `executions/history` records as they are (time,
 * raw kind, record id; the summary and the four kind filters are not
 * connected), its right column opens one record whole; on the 对话 view the
 * process group head (C1) and a Run row's expansion (E2) are drawn
 * unconnected (`is-off`, `title="还没接通"`, `aria-disabled`) and do nothing.
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);
const ended = (key: string) => slot.use(key, () => openS7C1World({ backend: 'memory', firstRun: 'ended' }), (world) => world.close());
const bootModule = (s7c: S7C1World): Promise<ChainPage> => bootChain(s7c.world, memberSearch('s7c-goal', s7c.lines.module.ref));

const tab = (root: FakeElement, name: string) => findElement(root, (element) => element.getAttribute('role') === 'tab' && textOf(element) === name);
const traceRows = (root: FakeElement): FakeElement[] => descendants(findClass(root, 'lg') ?? root)
  .filter((element) => element.tagName.toLowerCase() === 'button' && hasClass(element, 'lg-row'));
const lgCells = (row: FakeElement): FakeElement[] => descendants(row).filter((element) => hasClass(element, 'lg-c'));
/** The right column's block named `label` (`.insp-blk`: its `.insp-lb` and the text after it). */
const inspBlock = (root: FakeElement, label: string): string => {
  const block = descendants(findClass(root, 'insp') ?? root)
    .find((element) => hasClass(element, 'insp-blk') && textOf(findClass(element, 'insp-lb')) === label);
  return block === undefined ? '' : textOf(block).slice(label.length);
};

describe('E3C-7 the trace and the unconnected process rows', () => {
  it('E3C-16 the scripted answer’s agent_event row: raw time, kind and id, summary 还没接通, the whole record on the right (C5/C6)', async () => {
    const s7c = await ended('E3C-16');
    const history = asRecord((await s7c.world.post('executions/history', plain(S6A_SCOPE, {
      runRef: s7c.run.runRef, afterCursor: null, limit: 100 }))).body);
    const items = (asRecord(history['value'])['items'] ?? []) as SessionHistoryEntry[];
    /* The record the scripted model wrote (§1.2 `S7C first Work answer`), found by its own text, not by position. */
    const answer = items.find((entry) => entry.kind === 'agent_event' && JSON.stringify(entry.body).includes('S7C first Work answer'));
    expect(answer, 'the scripted answer record').toBeDefined();
    const { page } = await bootModule(s7c);
    try {
      press(tab(page.root, '轨迹'), '轨迹');
      await settle(() => traceRows(page.root).length > 0);
      const row = traceRows(page.root).find((candidate) => textOf(findClass(candidate, 'mono')) === answer!.recordId);
      expect(row, 'the agent_event row').toBeDefined();
      const cells = lgCells(row!).map((cell) => textOf(cell));
      /* Hand count (reply §1): S6A_AT 09:00:00 plus `createGoal`'s one second; the Run's records are at 09:00:01.
         具名改坏: 时间用完整 recordedAt；本行的 `09:00:01` 红。 */
      expect(cells[0]).toBe('09:00:01');
      expect(cells[1]).toBe('agent_event');
      /* 具名改坏: 把 body 的 JSON 解析成“思考”/“工具调用”摘要；本行的 `还没接通` 红。 */
      expect(textOf(findClass(row!, 'lg-sum'))).toBe('还没接通');
      click(row!);
      await settle(() => findClass(page.root, 'insp') !== undefined);
      const panel = findClass(page.root, 'insp');
      expect(textOf(findClass(panel ?? page.root, 'd-title'))).toBe('agent_event');
      expect(dlValue(panel, '编号')).toBe(answer!.recordId);
      expect(dlValue(panel, '记录时间')).toBe(answer!.recordedAt);
      expect(inspBlock(page.root, '原文')).toContain('S7C first Work answer');
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('E3C-17 the 推理 filter is unconnected: no request, the same rows, 全部 stays pressed (C4)', async () => {
    const s7c = await ended('E3C-17');
    const { page, log } = await bootModule(s7c);
    try {
      press(tab(page.root, '轨迹'), '轨迹');
      await settle(() => traceRows(page.root).length > 0);
      const before = log.calls.length;
      const rows = traceRows(page.root).length;
      const filters = byLabel(page.root, '只看一类记录');
      press(buttonText(filters, '推理'), '推理');
      await sleep(200);
      /* 具名改坏: 让 `推理` 改 tfilter 并发请求；本行的“不发请求/行数不变”红。 */
      expect(log.calls.length).toBe(before);
      expect(traceRows(page.root)).toHaveLength(rows);
      expect(buttonText(byLabel(page.root, '只看一类记录'), '全部')?.getAttribute('aria-pressed')).toBe('true');
      /* e3w-rulings B: `is-off`, `title="还没接通"`, `aria-disabled="true"` and a guarded click (the base's one check). */
      notConnected(buttonText(byLabel(page.root, '只看一类记录'), '推理')!);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it.each([
    { entry: '① C1 组头' },
    { entry: '② E2 运行行的展开' },
  ])('E3C-18 $entry is unconnected and does nothing on a click (C1/E2, DC2)', async ({ entry }) => {
    const s7c = await ended(entry);
    const { page, log } = await bootModule(s7c);
    try {
      const find = (): FakeElement | undefined => entry.startsWith('①')
        ? groupHeads(page.root).find((head) => !textOf(head).includes('正式检查'))
        : descendants(page.root).filter((element) => hasClass(element, 'lv-it')).map((holder) => descendants(holder)
          .find((element) => element.tagName.toLowerCase() === 'button' && element.getAttribute('aria-expanded') !== null))
          .find((button) => button !== undefined);
      const control = find();
      expect(control, entry).toBeDefined();
      const before = log.calls.length;
      /* The three attributes and the guarded click (e3w-rulings B, the base's `notConnected`).
         具名改坏: 去掉该项的守卫（让它展开）；对应条目红。 */
      notConnected(control!);
      await sleep(200);
      expect(log.calls.length).toBe(before);
      expect(find()?.getAttribute('aria-expanded')).not.toBe('true');
    } finally {
      await page.restore();
    }
  }, 120_000);
});
