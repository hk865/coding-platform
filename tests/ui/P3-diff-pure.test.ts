import { describe, expect, it } from 'vitest';
import { lineEditCounts, lineEditScript, LINE_DIFF_MAX_DISTANCE } from '../../src/contracts/line-delta.js';
import {
  auxDiffHunksOf, auxDiffViewOf,
  type AuxChangedRow, type AuxDiffHunk, type AuxDiffView,
} from '../../src/ui/adapters/aux-panel.js';

/**
 * P3 T1/T2（冻结稿第五节）：共用的行脚本画成 git hunk，以及 Diff 页的视图规则。
 * 纯表（A5）；每个字面量按第三节 R3 手算。今天红：`aux-panel.ts` 还没有
 * `auxDiffHunksOf`/`auxDiffViewOf`，导入的名字是 undefined。
 */

/* R3 的三句字面量，原样照抄。 */
const N1 = '这个文件比较不了：读不到、不是普通文件或超过 1 MiB';
const N2 = '这个文件没有逐行内容：二进制或不是 UTF-8 文本、超过 1 MiB，或改动超过 1000 行';
const N3 = '逐行看没有差别（可能只差文件开头的 BOM，或文件刚又改回去了）';

/* 一个 hunk 的期望行：符号在前，正文在后，和画板画的一样。 */
type Row = [' ' | '-' | '+', string];
const kept = (text: string): Row => [' ', text];
const del = (text: string): Row => ['-', text];
const add = (text: string): Row => ['+', text];
const hunk = (head: string, oldAt: number, newAt: number, rows: Row[]): AuxDiffHunk => ({ head, oldAt, newAt, rows });
/* 带换行的 l1…l13 这类行序列；要和成整段文本时再 join。 */
const numbered = (prefix: string, from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, n) => `${prefix}${from + n}\n`);
const rewriteRows = (from: string, to: string, count: number): Row[] =>
  [...Array.from({ length: count }, (_, n) => del(from + n)), ...Array.from({ length: count }, (_, n) => add(to + n))];

describe('P3 T1 auxDiffHunksOf（冻结稿第五节，R3）', () => {
  /* 行上的具名变异：并段界线写成 `<= 7` 或 `< 6`（e/f 翻）；后一段的 newAt 抄 oldAt（e 翻）；
     用 `split('\n')` 切行或不标末尾无换行（g 翻）；上限写成 `>=` 或不设（i/j 翻）；
     `n === 0` 的起点写成 `at`（c/d 翻）。 */
  it.each([
    {
      name: 'a 中间改了一行',
      before: '第一行\n旧的第二行\n', after: '第一行\n第二行\n第三行\n',
      hunks: [hunk('@@ -1,2 +1,3 @@', 1, 1, [kept('第一行'), del('旧的第二行'), add('第二行'), add('第三行')])],
    },
    {
      name: 'b 换掉一行',
      before: '旧\n', after: '新\n',
      hunks: [hunk('@@ -1 +1 @@', 1, 1, [del('旧'), add('新')])],
    },
    {
      name: 'c 新文件',
      before: null, after: 'n1\nn2\n',
      hunks: [hunk('@@ -0,0 +1,2 @@', 1, 1, [add('n1'), add('n2')])],
    },
    {
      name: 'd 删掉文件',
      before: 'x\ny\nz\n', after: null,
      hunks: [hunk('@@ -1,3 +0,0 @@', 1, 1, [del('x'), del('y'), del('z')])],
    },
    {
      name: 'e 两处改动中间留 7 行，分两段',
      before: numbered('l', 1, 13).join(''),
      after: ['l1\n', 'L2a\n', 'L2b\n', ...numbered('l', 3, 9), 'L10\n', ...numbered('l', 11, 13)].join(''),
      hunks: [
        hunk('@@ -1,5 +1,6 @@', 1, 1, [kept('l1'), del('l2'), add('L2a'), add('L2b'), kept('l3'), kept('l4'), kept('l5')]),
        hunk('@@ -7,7 +8,7 @@', 7, 8, [kept('l7'), kept('l8'), kept('l9'), del('l10'), add('L10'), kept('l11'), kept('l12'), kept('l13')]),
      ],
    },
    {
      name: 'f 两处改动中间留 6 行，并成一段',
      before: numbered('l', 1, 12).join(''),
      after: [...numbered('l', 1, 1), 'L2\n', ...numbered('l', 3, 8), 'L9\n', ...numbered('l', 10, 12)].join(''),
      hunks: [hunk('@@ -1,12 +1,12 @@', 1, 1, [
        kept('l1'), del('l2'), add('L2'), kept('l3'), kept('l4'), kept('l5'), kept('l6'), kept('l7'), kept('l8'),
        del('l9'), add('L9'), kept('l10'), kept('l11'), kept('l12'),
      ])],
    },
    {
      name: 'g 最后一行补上换行',
      before: 'a\nb', after: 'a\nb\n',
      hunks: [hunk('@@ -1,2 +1,2 @@', 1, 1, [kept('a'), del('b（文件末尾没有换行）'), add('b')])],
    },
    {
      name: 'i 编辑距离正好 1000，照画',
      before: numbered('o', 0, 499).join(''), after: numbered('n', 0, 499).join(''),
      hunks: [hunk('@@ -1,500 +1,500 @@', 1, 1, rewriteRows('o', 'n', 500))],
    },
    {
      name: 'j 编辑距离 1002，回 null',
      before: numbered('o', 0, 500).join(''), after: numbered('n', 0, 500).join(''),
      hunks: null,
    },
    {
      name: 'k 两份文本一样，没有 hunk',
      before: 'a\n', after: 'a\n', hunks: [],
    },
  ])('T1 $name', ({ before, after, hunks }) => {
    expect(auxDiffHunksOf(before, after)).toEqual(hunks);
  }, 120_000);
});

describe('P3 T2 auxDiffViewOf（冻结稿第五节，R3）', () => {
  const row = (state: AuxChangedRow['state'], added: number | null = null): AuxChangedRow =>
    ({ path: 'p', added, deleted: added, state });
  type Read = { before: string | null; after: string | null } | 'not_text' | null;
  const cases: Array<{ name: string; row: AuxChangedRow; read: Read; view: AuxDiffView }> = [
    { name: 'a unknown 是 N1', row: row('unknown'), read: null, view: { path: 'p', hunks: null, note: N1 } },
    { name: 'b 没有加减行是 N2', row: row('uncommitted'), read: null, view: { path: 'p', hunks: null, note: N2 } },
    { name: 'c 不是文本是 N2', row: row('uncommitted', 1), read: 'not_text', view: { path: 'p', hunks: null, note: N2 } },
    {
      name: 'd 逐行没有差别是 N3，hunks 为 null',
      row: row('uncommitted', 1), read: { before: 'a\n', after: 'a\n' },
      view: { path: 'p', hunks: null, note: N3 },
    },
    {
      name: 'e 真有差别，照画',
      row: row('uncommitted', 1), read: { before: '旧\n', after: '新\n' },
      view: { path: 'p', note: '', hunks: [hunk('@@ -1 +1 @@', 1, 1, [del('旧'), add('新')])] },
    },
  ];
  /* 行上的具名变异：不按 state 分（a 写成 N2）；把 `[]` 当成有内容（d 不出 N3，或回 `hunks: []`）。 */
  it.each(cases)('T2 $name', ({ row: changed, read, view }) => {
    expect(auxDiffViewOf(changed, read)).toEqual(view);
  });
});

describe('P3 T3 lineEditScript 小文件走 LCS 回走（D121-148-5）', () => {
  /* 300 × 800 = 24 万格，不超过 25 万；整篇改写，手算 +800/−300。
     今天红：lineEditScript 总用 LINE_DIFF_MAX_DISTANCE，距离 1100 超过 1000 回 null。 */
  it('T3 300 行整篇改写成 800 行，仍给逐行脚本', () => {
    const before = numbered('old', 0, 299);
    const after = numbered('new', 0, 799);
    expect(lineEditCounts(before, after, LINE_DIFF_MAX_DISTANCE)).toEqual({ added: 800, deleted: 300 });
    expect(lineEditScript(before, after, LINE_DIFF_MAX_DISTANCE)).toEqual([
      ...Array.from({ length: 300 }, () => '-' as const),
      ...Array.from({ length: 800 }, () => '+' as const),
    ]);
  });
});
