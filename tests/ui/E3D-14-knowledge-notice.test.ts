/**
 * E3D-14 the knowledge notices' own detail and recovery (X9): a reverted note,
 * a reverted module file whose recovery is refused, and one place of a conflict
 * notice. Every row opens the real page against the real Host this test started
 * (the KLS2C world) and reads the DOM through the frozen board's own classes.
 *
 * ⑤a K13: “详情” shows one 被撤回 row and its 恢复 button; 标为已读 asks first
 * (still zero writes after 取消); the recovery is one `knowledge/recover`
 * `{noticeId, itemNo: 1}`, writes the note back, and after the reread the detail
 * has only “恢复：这条通知里的文件都已恢复”.
 * ⑤b K15: the person deleted the file after the notice, so the confirmation
 * keeps the step open with “这个文件在通知之后又被改过，没恢复。”.
 * ⑤c U1: the first place is 读不出 and offers “恢复（用 … 的快照）”; the second
 * (缺模块文件) has no button; recovering writes the snapshot bytes back and the
 * first row then ends “已恢复”, with no button.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readPageToken } from '../helpers/AG2b-collaboration-fixture.js';
import {
  kls2cAdopt, kls2cEditModule, kls2cModuleFile, kls2cReviseResponsibility, kls2cWrittenNote, openKLS2CHost,
  type KLS2CHost, type KLS2COpenOptions,
} from '../helpers/KLS2C-knowledge-host.js';
import { findClass } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { descendants, hasClass, textOf } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import {
  bootDecide, card, cardButton, callsOf, count, opened, quiet, sectionRows, settle, stepConfirm,
  type E3DCall, type E3DLog,
} from './helpers/E3D-page.js';

const worlds: KLS2CHost[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0).reverse()) await world.close();
});

async function hostWorld(opts: KLS2COpenOptions): Promise<KLS2CHost> {
  const world = await openKLS2CHost(opts);
  worlds.push(world);
  return world;
}

/** The one notice of `kind` within 20 idle heartbeats; its id and summary. */
async function oneNotice(world: KLS2CHost, kind: 'knowledge_reverted' | 'knowledge_conflict'): Promise<{ noticeId: string; summary: string }> {
  const found = await world.noticesWithin(kind);
  expect(found, kind).toHaveLength(1);
  return found[0]!;
}

/** Open Decide on the world's real Host; the token comes from the served page. */
async function openDecide(world: KLS2CHost): Promise<{ page: Awaited<ReturnType<typeof bootDecide>>['page']; log: E3DLog }> {
  const { url } = await world.host.listen();
  const token = await readPageToken(url);
  return await bootDecide({ base: () => url, token: () => token });
}

/** The queue row of 请知悉 whose whole text contains `summary` (the last one, so a newer notice wins). */
function noticeRow(root: FakeElement, summary: string): FakeElement | undefined {
  return sectionRows(root, '请知悉').filter((row) => textOf(row).includes(summary)).at(-1);
}

type NoticeFact = { key: string; value: string; files: string[]; button: FakeElement | undefined };

/**
 * The open notice's `详情` rows: the `dd`'s own text, each `d-file`'s title (the
 * path the backend gave), and the row-end `button.link` when one is drawn.
 */
function noticeFacts(root: FakeElement): NoticeFact[] {
  const open = card(root);
  const list = open === undefined ? undefined
    : descendants(open).find((element) => hasClass(element, 'dc-facts') && element.getAttribute('aria-label') === '详情');
  if (list === undefined) return [];
  const rows: NoticeFact[] = [];
  for (const child of descendants(list)) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'dt') rows.push({ key: textOf(child), value: '', files: [], button: undefined });
    else if (tag === 'dd' && rows.length > 0) {
      const row = rows[rows.length - 1]!;
      row.value = child.childNodes.filter((node) => node.nodeType === 3).map((node) => node.textContent).join('').trim();
      row.files = descendants(child).filter((element) => hasClass(element, 'd-file'))
        .map((file) => file.getAttribute('title') ?? '');
      row.button = descendants(child).find((element) => element.tagName.toLowerCase() === 'button'
        && hasClass(element, 'link'));
    }
  }
  return rows;
}

/** Open the selected notice's `详情` when it is folded, then wait for the rows. */
async function showFacts(root: FakeElement, log: E3DLog): Promise<NoticeFact[]> {
  const open = card(root);
  const more = open === undefined ? undefined : findClass(open, 'dc-more');
  if (more !== undefined && more.getAttribute('aria-expanded') !== 'true') {
    click(more);
    await quiet(log);
  }
  await settle(() => noticeFacts(root).length > 0, 2_000);
  return noticeFacts(root);
}

/** The reply of the last call of `route` (the Host's own answer body). */
function replyOf(log: E3DLog, route: string): Record<string, unknown> {
  const call: E3DCall | undefined = callsOf(log, route).at(-1);
  return (call?.reply ?? {}) as Record<string, unknown>;
}

describe('E3D-14 the knowledge notice detail and recovery', () => {
  it('⑤a a reverted note: one 被撤回 row, 标为已读 asks first, 恢复 writes the note once and the row says all restored', async () => {
    const world = await hostWorld({ storage: 'memory', git: true });
    await kls2cAdopt(world, ['core']);
    const { path } = await kls2cWrittenNote(world, 'e3d14-a', 'e3d14a');
    await world.idle();
    world.remove(path);
    const notice = await oneNotice(world, 'knowledge_reverted');
    expect(notice.summary).toBe('架构图和注记被撤回了 1 处');

    const { page, log } = await openDecide(world);
    try {
      await opened(log);
      const row = noticeRow(page.root, notice.summary);
      expect(row).toBeDefined();
      click(row!);
      await settle(() => card(page.root) !== undefined, 3_000);
      const facts = await showFacts(page.root, log);
      /* 具名改坏: the notice branch draws no facts → 本行的 rows 为 []。 */
      expect(facts.map((fact) => fact.key)).toEqual(['被撤回']);
      /* 具名改坏: the item read is not keyed to this notice → 文件不是这条注记的路径。 */
      expect(facts[0]!.files).toEqual([path]);
      expect(textOf(facts[0]!.button)).toBe('恢复');

      /* 裁定 10：还有能点的恢复按钮时，标为已读先问一句，取消后 0 次写。 */
      click(cardButton(page.root, '标为已读')!);
      await settle(() => findClass(card(page.root)!, 'dc-step') !== undefined, 2_000);
      const ask = textOf(findClass(card(page.root)!, 'dc-step'));
      /* 具名改坏: 点标为已读直接写 → 下面 step 不存在、本句红。 */
      expect(ask).toContain('还有 1 个文件没恢复，标为已读后这里就看不到恢复入口了。');
      click(cardButton(page.root, '取消')!);
      await settle(() => findClass(card(page.root)!, 'dc-step') === undefined, 2_000);
      await quiet(log);
      expect(count(log, 'decisions/notices/seen')).toBe(0);

      /* 恢复：先开一步，确认后只发一次 knowledge/recover。 */
      const reopen = await showFacts(page.root, log);
      click(reopen[0]!.button!);
      await settle(() => findClass(card(page.root)!, 'dc-step') !== undefined, 2_000);
      const step = textOf(findClass(card(page.root)!, 'dc-step'));
      expect(step).toContain('恢复这个文件');
      expect(step).toContain(path);
      expect(textOf(stepConfirm(page.root))).toBe('恢复');
      /* F2: an enabled confirm carries no `is-off` (real browsers honour its pointer-events). */
      expect(hasClass(stepConfirm(page.root)!, 'is-off')).toBe(false);
      const readsBefore = count(log, 'decisions/queue');
      click(stepConfirm(page.root)!);
      await settle(() => callsOf(log, 'knowledge/recover').some((call) => call.reply !== undefined), 10_000);
      await quiet(log);
      expect(count(log, 'knowledge/recover')).toBe(1);
      expect(callsOf(log, 'knowledge/recover')[0]!.input)
        .toEqual({ noticeId: notice.noticeId, itemNo: 1 });
      const recovered = replyOf(log, 'knowledge/recover');
      expect(recovered['status']).toBe('committed');
      expect((recovered['value'] as { path?: string }).path).toBe(path);
      expect(world.read(path)).not.toBeNull();

      /* 重读后这一条只剩“都已恢复”（K13 的 recovery-items 是 not_found）。 */
      await settle(() => count(log, 'decisions/queue') > readsBefore, 10_000);
      await quiet(log);
      const after = await showFacts(page.root, log);
      /* 具名改坏: not_found 被当成读失败 → 这里写“暂时读不到”。 */
      expect(after).toHaveLength(1);
      expect(after[0]!.key).toBe('恢复');
      expect(after[0]!.value).toBe('这条通知里的文件都已恢复');
      expect(after[0]!.button).toBeUndefined();
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('⑤b K15: a file changed after the notice keeps the recovery step open with “这个文件在通知之后又被改过，没恢复。”', async () => {
    const world = await hostWorld({ storage: 'memory', git: true });
    /* K15's own steps: adopt, commit HEAD's v0, revise to v1, then the person checks out HEAD. */
    await kls2cAdopt(world, ['core']);
    world.git(['add', '--', '.workbench/architecture.json', '.workbench/modules']);
    world.git(['commit', '-q', '-m', 'e3d14 b v0']);
    const file = kls2cModuleFile(world, 'core');
    const v0 = world.read(file);
    await kls2cReviseResponsibility(world, 'core', 'E3D-14 b v1', 'e3d14-b');
    expect(world.read(file)).not.toEqual(v0);
    await world.idle();
    world.git(['checkout', '--', file]);
    const notice = await oneNotice(world, 'knowledge_reverted');
    world.remove(file);
    await world.idle();

    const { page, log } = await openDecide(world);
    try {
      await opened(log);
      const row = noticeRow(page.root, notice.summary);
      expect(row).toBeDefined();
      click(row!);
      await settle(() => card(page.root) !== undefined, 3_000);
      const facts = await showFacts(page.root, log);
      expect(facts.map((fact) => fact.key)).toEqual(['被撤回']);
      click(facts[0]!.button!);
      await settle(() => findClass(card(page.root)!, 'dc-step') !== undefined, 2_000);
      expect(hasClass(stepConfirm(page.root)!, 'is-off')).toBe(false);
      click(stepConfirm(page.root)!);
      await settle(() => callsOf(log, 'knowledge/recover').some((call) => call.reply !== undefined), 10_000);
      await quiet(log);
      const reply = replyOf(log, 'knowledge/recover');
      expect(reply['status']).toBe('rejected');
      expect(reply['code']).toBe('revision_conflict');
      /* 具名改坏: revision_conflict 也关卡 → 本行的 dc-step 红。 */
      expect(findClass(card(page.root)!, 'dc-step')).toBeDefined();
      /* 具名改坏: 失败原文不上屏 → 本句红。 */
      expect(textOf(findClass(card(page.root)!, 'dc-step'))).toContain('这个文件在通知之后又被改过，没恢复。');
      expect(world.read(file)).toBeNull();
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('⑤c U1: 读不出 offers its snapshot, 缺模块文件 has no button, and recovering writes the snapshot back', async () => {
    const world = await hostWorld({ storage: 'memory', git: true });
    await kls2cAdopt(world, ['core']);
    const file = kls2cModuleFile(world, 'core');
    const S = kls2cEditModule(world, file, { responsibility: 'kc2 人改过' });
    await world.idle();
    world.edit(file, '{"id":"core"}');
    await world.idle();
    const first = (await world.notices('knowledge_conflict'))[0]?.noticeId ?? '';
    world.edit(file, '{');
    await world.idle();
    const notices = await world.notices('knowledge_conflict');
    expect(notices).toHaveLength(2);
    const notice = notices.find((entry) => entry.noticeId !== first)!;

    const { page, log } = await openDecide(world);
    try {
      await opened(log);
      const row = noticeRow(page.root, notice.summary);
      expect(row).toBeDefined();
      click(row!);
      await settle(() => card(page.root) !== undefined, 3_000);
      const facts = await showFacts(page.root, log);
      /* 具名改坏: 冲突逐处画成一行“都已恢复” → 第一行的 key 红。 */
      expect(facts[0]!.key).toBe('读不出');
      expect(facts[0]!.value.startsWith('文件读不出：')).toBe(true);
      /* 具名改坏: 来源词不写快照和时间 → 本句红。 */
      expect(textOf(facts[0]!.button).startsWith('恢复（用 ')).toBe(true);
      expect(textOf(facts[0]!.button).endsWith('的快照）')).toBe(true);
      expect(facts[1]!.key).toBe('缺模块文件');
      expect(facts[1]!.button).toBeUndefined();

      click(facts[0]!.button!);
      await settle(() => findClass(card(page.root)!, 'dc-step') !== undefined, 2_000);
      /* F2: the snapshot recovery is valid, so its confirm must not carry `is-off`. */
      expect(hasClass(stepConfirm(page.root)!, 'is-off')).toBe(false);
      const readsBefore = count(log, 'decisions/queue');
      click(stepConfirm(page.root)!);
      await settle(() => callsOf(log, 'knowledge/recover').some((call) => call.reply !== undefined), 10_000);
      await quiet(log);
      expect(count(log, 'knowledge/recover')).toBe(1);
      expect(callsOf(log, 'knowledge/recover')[0]!.input)
        .toEqual({ noticeId: notice.noticeId, itemNo: 1 });
      expect(replyOf(log, 'knowledge/recover')['status']).toBe('committed');
      /* 具名改坏: 取错快照 → 写回的不是 S。 */
      expect(world.read(file)?.toString('utf8')).toBe(S);

      await settle(() => count(log, 'decisions/queue') > readsBefore, 10_000);
      await quiet(log);
      const after = await showFacts(page.root, log);
      /* 具名改坏: 恢复项已删仍给按钮 → 本行 button 红。 */
      expect(after[0]!.key).toBe('读不出');
      expect(after[0]!.button).toBeUndefined();
      /* 具名改坏: 恢复过的那一处不写“已恢复” → 本句红。 */
      expect(after[0]!.value.endsWith('已恢复')).toBe(true);
    } finally {
      await page.restore();
    }
  }, 180_000);
});
