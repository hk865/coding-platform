import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { findAllClass, findClass, findElement, type BootedPage } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import {
  auxTab, bootE3N, bootQuiet, callsTo, countRoute, descendants, hasClass, lineRowNamed, quietPage, settledN, textOf, waitFor,
  type PageLog,
} from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { E3U_MODULE_SHA, openW1, openWGit, openWWritable, unlockWGit, type E3NWorld } from './helpers/E3N-world.js';
import { bootMemberAt, callsOf, memberSearch, settle, worldSlot } from './helpers/E3M-world.js';
import { labelled, typeInto } from './helpers/E3D-page.js';

/**
 * E3U T-B12–T-B14, T-B16–T-B18 (test sheet e3main-b-tests §1.3; wiring
 * S22–S32, S36–S38): the right panel's 文件 and Diff pages on the world's own
 * workspace. WG is a git repository whose working tree changed `README.md`
 * (listed and changed first) and `src/module.ts` (+2 −1 by hand); WW grants
 * writes. `files/save`'s `expectedRevision` is the `files/read` digest, which
 * is the SHA-256 of the bytes (B-2/B-05): the literals below are the SHA-256
 * of the texts beside them.
 */

const slot = worldSlot();
afterAll(async () => { await slot.close(); }, 180_000);
const wg = () => slot.use('WG', () => openWGit(), (opened) => opened.world.close());

const writable: E3NWorld[] = [];
afterEach(async () => {
  for (const opened of writable.splice(0)) await opened.world.close();
});
async function ww(): Promise<E3NWorld> {
  const opened = await openWWritable();
  writable.push(opened);
  return opened;
}

const MODULE = 'src/module.ts';
const EDIT_ONE = '第一行\n第二行改了\n第三行\n';
const EDIT_TWO = '第一行\n第二行改了\n第三行改了\n';
const OUTSIDE = '第一行\n第二行\n第三行\n外面加的一行\n';
const SHA = {
  [EDIT_ONE]: '49c5e7dd280e909f2fffc8c6ef587f768270332ebb1bda6a1a756a5690e15f84',
  [EDIT_TWO]: '748dc00fb0fc34f54b08fd65a6c368134d5b87a4c8dfc56e3944d33236ef8b25',
  [OUTSIDE]: 'dc025a86cace8a8ea23ce252874126e8b14601fafe492e71025f09ac98621e5b',
} as const;

const GOAL = '?goal=ag2b-goal';

/** A file-tree row (`.ftree button` with `.fname`), the folders opened one by one (the tree names each level). */
async function fileRow(root: FakeElement, path: string): Promise<FakeElement | undefined> {
  const named = (name: string): FakeElement | undefined => {
    const tree = findClass(root, 'ftree');
    return tree === undefined ? undefined : descendants(tree).find((element) => element.tagName.toLowerCase() === 'button'
      && textOf(findClass(element, 'fname')) === name);
  };
  const parts = path.split('/');
  for (const folder of parts.slice(0, -1)) {
    const row = named(folder);
    if (row === undefined) return undefined;
    if (row.getAttribute('aria-expanded') !== 'true') click(row);
    await settle(() => named(parts.at(-1)!) !== undefined, 1_000);
  }
  return named(parts.at(-1)!);
}

/** The open file page's line texts (`.fcode .fl-t`, folded rows left out). */
function codeTexts(root: FakeElement): string[] {
  const code = findElement(root, (element) => hasClass(element, 'fcode') && !hasClass(element, 'is-edit'));
  return code === undefined ? [] : descendants(code).filter((element) => hasClass(element, 'fl') && !hasClass(element, 'is-fold'))
    .map((row) => textOf(findClass(row, 'fl-t')));
}

const pageButton = (root: FakeElement, holder: string, label: string): FakeElement | undefined => {
  const scope = findClass(root, holder);
  return scope === undefined ? undefined : descendants(scope).find((element) => element.tagName.toLowerCase() === 'button'
    && textOf(element) === label);
};
const conflictButtons = (root: FakeElement): string[] => {
  const note = findClass(root, 'fp-note');
  return note === undefined ? [] : descendants(note).filter((element) => element.tagName.toLowerCase() === 'button')
    .map((element) => textOf(element));
};
const diffRow = (root: FakeElement, path: string): FakeElement | undefined => {
  const list = findClass(root, 'dfiles');
  return list === undefined ? undefined : descendants(list).find((element) => element.getAttribute('title') === path);
};
/** The tab's own note: 文件's `.fnote`, Diff's line-area `.pnote`. */
const noteOf = (root: FakeElement, tab: '文件' | 'Diff'): string => (tab === 'Diff'
  ? textOf(findClass(findClass(root, 'diff-body')!, 'pnote')) : textOf(findClass(root, 'fnote')));
/** The tab's rows: the Diff file buttons or the 文件 tree buttons. */
const rowsOf = (root: FakeElement, tab: '文件' | 'Diff'): FakeElement[] => {
  const list = findClass(root, tab === 'Diff' ? 'dfiles' : 'ftree');
  return list === undefined ? [] : descendants(list).filter((element) => element.tagName.toLowerCase() === 'button');
};
const fpState = (root: FakeElement): string => textOf(findClass(root, 'fp-state'));

/** 文件 → the row of `src/module.ts` → its page; returns the log index before the row's click. */
async function openModule(page: BootedPage, log: PageLog): Promise<number> {
  click(auxTab(page.root, '文件')!);
  const row = await waitRow(page.root);
  await quietPage(log);
  const before = log.calls.length;
  click(row);
  await waitFor(() => codeTexts(page.root).length > 0);
  await quietPage(log);
  return before;
}

async function waitRow(root: FakeElement): Promise<FakeElement> {
  /* The tab's `files/list` lands after the click: wait for the tree's first row, not only its frame. */
  await waitFor(() => {
    const tree = findClass(root, 'ftree');
    return tree !== undefined && descendants(tree).some((element) => element.tagName.toLowerCase() === 'button');
  });
  const row = await fileRow(root, MODULE);
  expect(row, 'the file row of src/module.ts').toBeDefined();
  return row!;
}

/** 编辑, the whole text typed into `#ax-fedit`, then 保存. */
function editAndSave(root: FakeElement, text: string): void {
  if (findElement(root, (element) => element.getAttribute('id') === 'ax-fedit') === undefined) {
    click(pageButton(root, 'fpage', '编辑')!);
  }
  typeInto(root, 'ax-fedit', text);
  click(pageButton(root, 'fpage', '保存')!);
}

/** The work line's Member page: open 改动, wait for its uncommitted read, return the panel's text. */
async function memberChangesNote(opened: E3NWorld): Promise<string> {
  const { page, log } = await bootMemberAt(opened.world, memberSearch('ag2b-goal', opened.work.ref));
  try {
    const changes = () => findElement(page.root, (element) => element.getAttribute('role') === 'tab' && textOf(element) === '改动');
    await waitFor(() => changes() !== undefined);
    click(changes()!);
    await waitFor(() => callsTo(log, 'files/uncommitted').some((call) => call.reply !== undefined));
    await quietPage(log);
    return textOf(findClass(page.root, 'panel'));
  } finally {
    await page.restore();
  }
}

/** The file a `files/read` call asked for. */
const readPath = (call: PageLog['calls'][number] | undefined): unknown => (call?.input as { path?: unknown } | undefined)?.path;

/** Waits for the `files/read` that started at `from` to be answered, then for the page to settle. */
async function fileReadFrom(log: PageLog, from: number): Promise<PageLog['calls']> {
  await waitFor(() => callsOf(log, 'files/read', from).some((call) => call.reply !== undefined));
  await quietPage(log);
  return callsOf(log, 'files/read', from);
}

describe('E3U Main right panel: 文件 and Diff', () => {
  it('T-B12 文件 lists the workspace once and opens src/module.ts through files/read', async () => {
    const opened = await wg();
    const { page, log } = await bootQuiet(opened.world, GOAL);
    try {
      const from = log.calls.length;
      click(auxTab(page.root, '文件')!);
      const row = await waitRow(page.root);
      await quietPage(log);
      expect(callsOf(log, 'files/list', from)).toHaveLength(1);
      const before = log.calls.length;
      click(row);
      const reads = await fileReadFrom(log, before);
      expect(reads).toHaveLength(1);
      /* 具名改坏: `Main.dc.html` 的 `axDemand` 的 `f:` 分支把 `auxPath` 写成 `this.auxData().files.paths[0]`（= README.md）；这一句红。 */
      expect(readPath(reads[0])).toBe(MODULE);
      await waitFor(() => codeTexts(page.root).length > 0);
      expect(codeTexts(page.root).filter((text) => text !== '')).toEqual(['第一行', '第二行', '第三行']);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('T-B14 Diff shows the git counts of the one listed workspace and draws no line diff', async () => {
    const opened = await wg();
    const { page, log } = await bootQuiet(opened.world, GOAL);
    try {
      const from = log.calls.length;
      click(auxTab(page.root, 'Diff')!);
      await waitFor(() => diffRow(page.root, MODULE) !== undefined);
      await quietPage(log);
      expect(callsOf(log, 'files/uncommitted', from)).toHaveLength(1);
      expect(callsOf(log, 'files/list', from)).toHaveLength(1);
      expect(textOf(findClass(diffRow(page.root, MODULE)!, 'fmeta'))).toBe('+2 −1');
      /* Three listed files: nothing is cut at 100, so the note says no count. */
      expect(noteOf(page.root, 'Diff')).toBe('还没接通');
      /* 具名改坏: `src/ui/boot.ts` 的 `readAuxPanel` 调 `files/compare` 画样例 hunk；这一句红。 */
      expect(countRoute(log, 'files/compare')).toBe(0);
    } finally {
      await page.restore();
    }
  }, 120_000);

  /*
   * Lead 11-12 item 4: Main's Diff note (and 文件's, SPEC-23) says how many files
   * the uncommitted read really checked (`null`, no note, when all were);
   * Member's 改动 keeps its own "只列了部分", which is only `files/list`'s
   * `partial`. Partial: the listing is README.md, src/module.ts and
   * tsconfig.json (src/locked/ is unreadable), all three checked, two changed.
   * Over 100: the first 100 of 104 are those three and zz-many m000–m096;
   * README.md, src/module.ts and the 97 untracked zz-many files changed.
   */
  it.each([
    {
      name: 'a partial listing', shape: { lockedDir: true } as const, memberPartial: true,
      /* 具名改坏: `src/ui/boot.ts` 的 `readUncommittedPage` 在 `partial` 时给 `null`；diff 这一句红。 */
      diff: '还没接通 · 只核对了前 3 个文件', files: '工作区 · 改动 2 个文件 · 只核对了前 3 个文件',
    },
    {
      name: 'over 100 listed files', shape: { manyFiles: 101 } as const, memberPartial: false,
      /* 具名改坏: `Main.dc.html` 的 `auxFileNote` 不接 `auxCheckedNote()`；files 这一句红。
         具名改坏: `src/ui/boot.ts` 的 `readMember` 把 `filesPartial` 写成 `checkedFirst !== null`；Member 这一句红。 */
      diff: '还没接通 · 只核对了前 100 个文件', files: '工作区 · 改动 99 个文件 · 只核对了前 100 个文件',
    },
  ])('T-B14b $name: Diff and 文件 say the checked count, Member only the listing’s partial', async ({ shape, memberPartial, diff, files }) => {
    const opened = await openWGit(shape);
    try {
      const { page, log } = await bootQuiet(opened.world, GOAL);
      try {
        click(auxTab(page.root, 'Diff')!);
        await waitFor(() => diffRow(page.root, MODULE) !== undefined);
        await quietPage(log);
        expect(noteOf(page.root, 'Diff')).toBe(diff);
        const before = log.calls.length;
        click(auxTab(page.root, '文件')!);
        await waitFor(() => callsOf(log, 'files/uncommitted', before).some((call) => call.reply !== undefined));
        await quietPage(log);
        expect(noteOf(page.root, '文件')).toBe(files);
      } finally {
        await page.restore();
      }
      expect((await memberChangesNote(opened)).includes('只列了部分')).toBe(memberPartial);
    } finally {
      if ('lockedDir' in shape) await unlockWGit(opened);
      await opened.world.close();
    }
  }, 180_000);

  it('T-B17 打开文件 on the Diff head opens that file through files/read', async () => {
    const opened = await wg();
    const { page, log } = await bootQuiet(opened.world, GOAL);
    try {
      click(auxTab(page.root, 'Diff')!);
      await waitFor(() => diffRow(page.root, MODULE) !== undefined);
      click(diffRow(page.root, MODULE)!);
      await quietPage(log);
      const before = log.calls.length;
      click(pageButton(page.root, 'diff-head', '打开文件')!);
      const reads = await fileReadFrom(log, before);
      expect(reads).toHaveLength(1);
      /* 具名改坏: `Main.dc.html` 的 `dOpen` 打开 `repo.changed[0]`（= README.md，不是选中的 `dPath`）；这一句红。 */
      expect(readPath(reads[0])).toBe(MODULE);
      expect(findClass(page.root, 'fp-path')?.getAttribute('title')).toBe(MODULE);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('T-B18 引用到草稿 keeps lines 2–3 and the send carries them as one reference', async () => {
    const opened = await wg();
    const { page, log } = await bootQuiet(opened.world, GOAL);
    try {
      await openModule(page, log);
      const lineNo = (n: number): FakeElement | undefined => descendants(findClass(page.root, 'fcode')!)
        .find((element) => hasClass(element, 'fl-n') && textOf(element) === String(n));
      click(lineNo(2)!);
      await settle(() => findAllClass(findClass(page.root, 'fcode')!, 'is-sel').length > 0, 1_000);
      click(lineNo(3)!, { shiftKey: true });
      click(pageButton(page.root, 'fp-bar', '引用到草稿')!);
      await waitFor(() => findClass(page.root, 'composer-quote') !== undefined);
      const quote = findClass(page.root, 'composer-quote')!;
      expect(textOf(findClass(quote, 'cq-path'))).toBe(MODULE);
      /* 具名改坏: `Main.dc.html` 文件页那段（`ax.isFile`）的 `ax.fp.quote` 不看选区、只写 `path`；这一句红（“整个文件”）。 */
      expect(textOf(findClass(quote, 'cq-lines'))).toBe('第 2–3 行');
      typeInto(page.root, 'composer-input', '看这里');
      click(labelled(page.root, '发送')!);
      await waitFor(() => callsTo(log, 'requests/submit').some((call) => call.reply !== undefined));
      const input = callsTo(log, 'requests/submit')[0]!.input as Record<string, unknown>;
      expect(input['text']).toBe('看这里');
      /* 具名改坏: `Main.dc.html` 发送时引用的 `startLine`/`endLine` 写 `null`；这一句红。 */
      expect(input['references']).toEqual([{ path: MODULE, startLine: 2, endLine: 3, snapshot: null }]);
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('SPEC-18 a quote taken while a line is open does not ride on the line’s composer', async () => {
    const opened = await wg();
    const { page, log } = await bootQuiet(opened.world, GOAL);
    try {
      click(lineRowNamed(page.root, '执行者')!);
      await quietPage(log);
      await openModule(page, log);
      click(descendants(findClass(page.root, 'fcode')!).find((element) => hasClass(element, 'fl-n') && textOf(element) === '2')!);
      click(pageButton(page.root, 'fp-bar', '引用到草稿')!);
      const composer = findElement(page.root, (element) => hasClass(element, 'composer')
        && findElement(element, (child) => child.getAttribute('id') === 'lv-input') !== undefined)!;
      /* 具名改坏: `Main.dc.html` 把主对话的 `s` 原样交给 `lvView`；这一句红（引用条挂在线的输入区上）。 */
      expect(findClass(composer, 'composer-quote')).toBeUndefined();
      expect(textOf(findClass(composer, 'to'))).not.toBe('已引用到草稿，还没有发送');
      expect(findClass(composer, 'send')!.getAttribute('aria-disabled')).toBe('true');
    } finally {
      await page.restore();
    }
  }, 120_000);

  it('T-B13 保存 sends the read digest, then the saved revision', async () => {
    const opened = await ww();
    const { page, log } = await bootQuiet(opened.world, GOAL);
    try {
      await openModule(page, log);
      editAndSave(page.root, EDIT_ONE);
      await settledN(log, 'files/save', 1);
      const first = callsTo(log, 'files/save')[0]!;
      expect((first.input as { content?: unknown }).content).toBe(EDIT_ONE);
      /* 具名改坏: `src/ui/boot.ts` 的 `saveFile` 把 `expectedRevision` 写成 `null`；这一句红（Host 回 source_stale）。 */
      expect((first.input as { expectedRevision?: unknown }).expectedRevision).toBe(E3U_MODULE_SHA);
      expect((first.reply as { value?: { revision?: unknown } }).value?.revision).toBe(SHA[EDIT_ONE]);
      await quietPage(log);
      editAndSave(page.root, EDIT_TWO);
      await settledN(log, 'files/save', 2);
      const second = callsTo(log, 'files/save')[1]!;
      expect((second.input as { expectedRevision?: unknown }).expectedRevision).toBe(SHA[EDIT_ONE]);
      expect((second.reply as { value?: { revision?: unknown } }).value?.revision).toBe(SHA[EDIT_TWO]);
    } finally {
      await page.restore();
    }
  }, 120_000);

  /* The test changes the file on disk after the page read it (a write the page did not make). */
  it.each(['比较', '仍然保存', '先不保存'] as const)('T-B16 a stale save shows the four-button bar; %s', async (choice) => {
    const opened = await ww();
    const { page, log } = await bootQuiet(opened.world, GOAL);
    try {
      await openModule(page, log);
      await writeFile(join(opened.world.root, MODULE), OUTSIDE);
      editAndSave(page.root, EDIT_ONE);
      await settledN(log, 'files/save', 1);
      expect((callsTo(log, 'files/save')[0]!.reply as { code?: unknown }).code).toBe('source_stale');
      /* 具名改坏: `src/ui/boot.ts` 的 `saveFile` 把 `source_stale` 吞掉当成功；这一句红。 */
      await waitFor(() => conflictButtons(page.root).length > 0);
      expect(conflictButtons(page.root)).toEqual(['重新载入', '比较', '仍然保存', '先不保存']);
      await quietPage(log);
      const before = log.calls.length;
      click(pageButton(page.root, 'fp-note', choice)!);
      if (choice === '比较') {
        await waitFor(() => findAllClass(page.root, 'dl-row').some((row) => hasClass(row, 'is-add') || hasClass(row, 'is-del')));
        await quietPage(log);
        expect(callsOf(log, 'files/compare', before)).toHaveLength(0);
        /* READS-6/SPEC-11 (S37): 比较 left the read on the file page; 回到 Git ↔ 工作区 reads files/uncommitted again.
           具名改坏: `Main.dc.html` 的 `ax.backToGit` 只清 `axCmp`；这一句红。 */
        const back = log.calls.length;
        click(pageButton(page.root, 'diff-head', '回到 Git ↔ 工作区')!);
        await quietPage(log);
        expect(callsOf(log, 'files/uncommitted', back)).toHaveLength(1);
      } else if (choice === '仍然保存') {
        await settledN(log, 'files/save', 2);
        const again = callsTo(log, 'files/save')[1]!;
        expect((again.input as { expectedRevision?: unknown }).expectedRevision).toBe(SHA[OUTSIDE]);
        expect((again.reply as { status?: unknown }).status).toBe('ready');
      } else {
        await waitFor(() => findClass(page.root, 'fp-note') === undefined);
        await quietPage(log);
        expect(log.calls.length).toBe(before);
      }
    } finally {
      await page.restore();
    }
  }, 120_000);

  /*
   * B-09, READS-3/SPEC-16: a tab whose read failed writes the page text in its
   * own note and draws no sample row; when the whole page read fails
   * (`main/read`), 文件 has read nothing, so it says nothing (no "改动 0").
   * READS-12: the raw route and code go to the log.
   */
  it.each([
    ['Diff', 'files/uncommitted', '暂时读不到，可以重试。'],
    ['文件', 'main/read', ''],
  ] as const)('READS-3 %s with %s unavailable: the note is %j, no sample row, the route is logged', async (tab, route, note) => {
    const opened = await wg();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal', mode: 'controlled', unavailable: route });
    try {
      await quietPage(log);
      const before = log.calls.length;
      click(auxTab(page.root, tab)!);
      await waitFor(() => callsOf(log, route, before).some((call) => call.reply !== undefined));
      await quietPage(log);
      /* 具名改坏: `Main.dc.html` 的 Diff `dnote` 不看 `aux.error`、照写“还没接通”，Diff 行这一句红；
         `auxFileNote` 没读到清单时也写“改动 n 个文件”，文件 行这一句红。 */
      expect(noteOf(page.root, tab)).toBe(note);
      expect(rowsOf(page.root, tab)).toEqual([]);
      /* 具名改坏: `boot.ts` 的 `readAuxPanel` 吞错不调 `logReadError`；Diff 行这一句红。 */
      expect(logged.mock.calls.some((args) => args[0] === route && args[1] === 'unavailable')).toBe(true);
    } finally {
      logged.mockRestore();
      await page.restore();
    }
  }, 120_000);

  it('READS-2 a save the Host holds unavailable says the write text, not the route and code', async () => {
    const opened = await wg();
    const { page, log } = await bootE3N(opened.world, 'Main', { search: '?goal=ag2b-goal', mode: 'controlled', unavailable: 'files/save' });
    try {
      await quietPage(log);
      await openModule(page, log);
      editAndSave(page.root, EDIT_ONE);
      await settledN(log, 'files/save', 1);
      await quietPage(log);
      /* 具名改坏: `boot.ts` 的 `saveFile` 又把 `source_stale` 以外的错原样抛出；这一句红（“files/save failed: unavailable: …”）。 */
      expect(textOf(findClass(findClass(page.root, 'composer-foot')!, 'to'))).toBe('暂时写不了，可以重试。');
    } finally {
      await page.restore();
    }
  }, 120_000);

  /* READS-7: W1 without its two files lists nothing; an empty `paths` is the Host's `invalid`, so nothing is checked. */
  it('READS-7 an empty workspace sends no files/uncommitted and is not a read failure', async () => {
    const opened = await openW1();
    try {
      await rm(join(opened.world.root, 'src'), { recursive: true });
      await rm(join(opened.world.root, 'tsconfig.json'));
      const { page, log } = await bootQuiet(opened.world, GOAL);
      try {
        for (const tab of ['文件', 'Diff'] as const) {
          const before = log.calls.length;
          click(auxTab(page.root, tab)!);
          await waitFor(() => callsOf(log, 'files/list', before).some((call) => call.reply !== undefined));
          await quietPage(log);
          /* 具名改坏: `boot.ts` 的 `readUncommittedPage` 不判空、照发 `paths: []`；这一句红（“读取失败。”）。 */
          expect(noteOf(page.root, tab)).toBe(tab === '文件' ? '工作区 · 改动 0 个文件' : '还没接通');
        }
        expect(countRoute(log, 'files/uncommitted')).toBe(0);
      } finally {
        await page.restore();
      }
    } finally {
      await opened.world.close();
    }
  }, 120_000);

  /*
   * READS-8/SPEC-10 (build §2.5): every file that is not clean is a changed row,
   * in the listing's order; one without git's counts (src/big.txt is `unknown`,
   * src/blob.bin is a binary with `lines: null`) shows no numbers.
   */
  it('READS-8 an unknown and a binary file are changed rows without numbers', async () => {
    const opened = await openWGit({ oddFiles: true });
    try {
      const { page, log } = await bootQuiet(opened.world, GOAL);
      try {
        click(auxTab(page.root, 'Diff')!);
        await waitFor(() => diffRow(page.root, MODULE) !== undefined);
        await quietPage(log);
        /* 具名改坏: `aux-panel.ts` 的 `auxChangedRowsOf` 只留 `uncommitted`；这一句红（少了 src/big.txt）。 */
        expect(rowsOf(page.root, 'Diff').map((row) => [row.getAttribute('title'), textOf(findClass(row, 'fmeta'))]))
          .toEqual([['README.md', '+1 −1'], ['src/big.txt', ''], ['src/blob.bin', ''], [MODULE, '+2 −1']]);
        click(auxTab(page.root, '文件')!);
        await waitRow(page.root);
        await quietPage(log);
        expect(noteOf(page.root, '文件')).toBe('工作区 · 改动 4 个文件');
        /* 具名改坏: `Main.dc.html` 文件树那行不判 `ch.add` 为 null；这一句红（“+null −null”）。 */
        expect(textOf(findClass((await fileRow(page.root, 'src/blob.bin'))!, 'fmeta'))).toBe('');
      } finally {
        await page.restore();
      }
    } finally {
      await opened.world.close();
    }
  }, 120_000);

  /*
   * SPEC-15: 载入于 is the read's own time (MM-DD HH:mm), 已保存 has no sample
   * clock, and the editor's text without the last newline still saves the file
   * with it (the module ends in one).
   */
  it('SPEC-15 the file page shows its read time and a save keeps the last newline', async () => {
    const opened = await ww();
    const { page, log } = await bootQuiet(opened.world, GOAL);
    try {
      await openModule(page, log);
      /* 具名改坏: `aux-panel.ts` 的 `auxFilePageOf` 把 `readAtText` 写成“已读”；这一句红。 */
      expect(fpState(page.root)).toMatch(/^载入于 \d\d-\d\d \d\d:\d\d$/);
      editAndSave(page.root, EDIT_ONE.slice(0, -1));
      await settledN(log, 'files/save', 1);
      await quietPage(log);
      /* 具名改坏: `Main.dc.html` 的 `saveNow` 不补 `F.eol` 的换行；这一句红。 */
      expect((callsTo(log, 'files/save')[0]!.input as { content?: unknown }).content).toBe(EDIT_ONE);
      expect(fpState(page.root)).toBe('已保存');
    } finally {
      await page.restore();
    }
  }, 120_000);
});
