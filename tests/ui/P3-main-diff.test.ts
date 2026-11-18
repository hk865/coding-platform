import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { findAllClass, findClass } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { auxTab, descendants, onMain, quietPage, textOf, waitFor } from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { openWGit, type E3NWorld } from './helpers/E3N-world.js';
import { callsOf, worldSlot } from './helpers/E3M-world.js';
import { gitIn } from '../scenarios/support/git-workspace.js';

/**
 * P3 T3–T5（冻结稿第五节）：Main 的 Diff 页签先在共享 WG 世界上把第一个改动文件
 * 逐行画出来，再画点中的那一行。今天红：逐行区还是“还没接通”，一次 `files/read`
 * 都不发。具名变异写在各自的行上。
 */

const N1 = '这个文件比较不了：读不到、不是普通文件或超过 1 MiB';
const N2 = '这个文件没有逐行内容：二进制或不是 UTF-8 文本、超过 1 MiB，或改动超过 1000 行';

const slot = worldSlot();
afterAll(async () => { await slot.close(); }, 180_000);
const wg = async (options: { oddFiles?: true } = {}): Promise<E3NWorld> =>
  slot.use(JSON.stringify(options), () => openWGit(options), (opened) => opened.world.close());

/* 一行自己的世界，行结束时关掉（照 E3U-main-aux-files:30-41 写，不共用）。 */
const owned: E3NWorld[] = [];
afterEach(async () => {
  for (const opened of owned.splice(0)) await opened.world.close();
});
async function own(open: () => Promise<E3NWorld>): Promise<E3NWorld> {
  const opened = await open();
  owned.push(opened);
  return opened;
}

const changedRows = (root: FakeElement): FakeElement[] => {
  const list = findClass(root, 'dfiles');
  return list === undefined ? [] : descendants(list).filter((element) => element.tagName.toLowerCase() === 'button');
};
const changedRow = (root: FakeElement, path: string): FakeElement | undefined =>
  changedRows(root).find((row) => row.getAttribute('title') === path);
const hunks = (root: FakeElement): string[] => findAllClass(root, 'dl-hunk').map((element) => textOf(element));
/* 画出的一行：旧号、新号、符号、正文。 */
const lineRows = (root: FakeElement): string[][] =>
  findAllClass(root, 'dl-row').map((row) => descendants(row).map((cell) => textOf(cell)));
const diffNote = (root: FakeElement): string => textOf(findClass(findClass(root, 'diff-body')!, 'pnote'));
const headText = (root: FakeElement): string => textOf(findClass(findClass(root, 'diff-head')!, 'ellipsis'));

describe('P3 Main Diff, line by line', () => {
  it('T3 the first changed file is README.md, then src/module.ts, each read at HEAD and in the working tree', async () => {
    const opened = await wg();
    const rev = gitIn(opened.world.root, 'rev-parse', 'HEAD').trim();
    await onMain(opened.world, async (page, log) => {
      const from = log.calls.length;
      click(auxTab(page.root, 'Diff')!);
      await waitFor(() => changedRow(page.root, 'README.md') !== undefined);
      await quietPage(log);
      /* HEAD 的提交号由测试自己在世界里读，不从页面的回答抄。 */
      const reads = callsOf(log, 'files/read', from);
      expect(reads.map((call) => call.input)).toEqual([
        { workspace: expect.objectContaining({ workspaceId: expect.any(String) }),
          path: 'README.md', maxBytes: 1_048_576, version: { kind: 'git', commit: rev } },
        { workspace: expect.objectContaining({ workspaceId: expect.any(String) }),
          path: 'README.md', maxBytes: 1_048_576, version: { kind: 'working_tree' } },
      ]);
      expect(hunks(page.root)).toEqual(['@@ -1 +1 @@']);
      expect(lineRows(page.root)).toEqual([['1', '', '−', '旧'], ['', '1', '+', '新']]);
      expect(diffNote(page.root)).toBe('');
      /* 具名改坏: 两次都读工作区（git 那侧不读）；第一条 `files/read` 的输入红。 */
      const before = log.calls.length;
      click(changedRow(page.root, 'src/module.ts')!);
      await quietPage(log);
      /* 具名改坏: `d:` 的读不发（还是 README.md）；这里 0 次，且 hunk 不变。 */
      expect(callsOf(log, 'files/read', before)).toHaveLength(2);
      expect(hunks(page.root)).toEqual(['@@ -1,2 +1,3 @@']);
      expect(lineRows(page.root)).toEqual([
        ['1', '1', '', '第一行'], ['2', '', '−', '旧的第二行'], ['', '2', '+', '第二行'], ['', '3', '+', '第三行'],
      ]);
      expect(headText(page.root)).toBe('Git（HEAD）↔ 工作区 · module.ts · +2 −1');
      /* 具名改坏: `auxRepo` 不接 `view.hunks`（它只画样例，数据模式清空）；hunks 红。 */
    });
  }, 180_000);

  /* 行上的具名变异：没有加减行也去读（次数那句翻）；`unknown` 写成 N2（第一格翻）。 */
  it.each([
    { path: 'src/big.txt', note: N1 },
    { path: 'src/blob.bin', note: N2 },
  ])('T4 $path shows its reason and sends no files/read', async ({ path, note }) => {
    const opened = await wg({ oddFiles: true });
    await onMain(opened.world, async (page, log) => {
      click(auxTab(page.root, 'Diff')!);
      await waitFor(() => changedRow(page.root, path) !== undefined);
      await quietPage(log);
      const from = log.calls.length;
      click(changedRow(page.root, path)!);
      await quietPage(log);
      expect(diffNote(page.root)).toBe(note);
      expect(callsOf(log, 'files/read', from)).toHaveLength(0);
      expect(changedRows(page.root)).toHaveLength(4);
    });
  }, 180_000);

  it('T5 a binary HEAD side is the only read and shows N2, with the rows still listed', async () => {
    const opened = await own(() => openWGit());
    const latin = join(opened.world.root, 'src/latin.txt');
    await writeFile(latin, Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
    gitIn(opened.world.root, 'add', '--', 'src/latin.txt');
    gitIn(opened.world.root, 'commit', '-q', '-m', 'P3 latin');
    await writeFile(latin, Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x21, 0x0a]));
    await onMain(opened.world, async (page, log) => {
      click(auxTab(page.root, 'Diff')!);
      await waitFor(() => changedRow(page.root, 'src/latin.txt') !== undefined);
      await quietPage(log);
      const from = log.calls.length;
      click(changedRow(page.root, 'src/latin.txt')!);
      await quietPage(log);
      expect(diffNote(page.root)).toBe(N2);
      /* 具名改坏: `unsupported` 照旧往外抛（页签整页报错、行没了）；这一句红。 */
      expect(changedRows(page.root)).toHaveLength(3);
      const reads = callsOf(log, 'files/read', from);
      /* 具名改坏: 读完 HEAD 一侧还去读工作区；这一句是 2。 */
      expect(reads).toHaveLength(1);
      expect((reads[0]!.input as { version?: { kind?: unknown } }).version?.kind).toBe('git');
      expect((reads[0]!.reply as { code?: unknown }).code).toBe('unsupported');
    });
  }, 180_000);

  /* 审查 B4：R4 的 not_found 那一支（新文件没有 HEAD 一侧）。这一行自己的世界里加一个未跟踪的新文件。 */
  it('T6 a new file has no HEAD side, so every line is drawn as added', async () => {
    const opened = await own(() => openWGit());
    await writeFile(join(opened.world.root, 'src/fresh.ts'), 'n1\nn2\n');
    await onMain(opened.world, async (page, log) => {
      click(auxTab(page.root, 'Diff')!);
      await waitFor(() => changedRow(page.root, 'src/fresh.ts') !== undefined);
      await quietPage(log);
      click(changedRow(page.root, 'src/fresh.ts')!);
      await quietPage(log);
      /* 具名改坏: HEAD 一侧的 not_found 也往外抛（整页签读失败，逐行区是空的）；hunk 这一句红。 */
      expect(hunks(page.root)).toEqual(['@@ -0,0 +1,2 @@']);
      expect(lineRows(page.root)).toEqual([['', '1', '+', 'n1'], ['', '2', '+', 'n2']]);
    });
  }, 180_000);
});
