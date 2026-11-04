/**
 * 8E-2 W 组验收行 E2-01、E2-02、E2-03（8E-2 :825–827），纯表（规则表 A5，§4.1 :711）。
 * 入口：W 的第一档单文件函数（§2.0 :178–200；W4 :272，W10 :278）。
 * 只导入 single-file-syntax（D3）；文字是手写的字面量，期望来自 8E-2 的行和手算。
 */
import { expect, it } from 'vitest';
import { fileSyntaxOf, namesInRanges, navigationItemsOf, syntaxTreeOf } from '../../src/core/workspace/single-file-syntax.js';

// 改坏（8E-2 :825）：去掉“`.` 后不算”→ 第一格 `x.authorize;` 读成 `free`，这一格红。
// 每格只有一处 `authorize`、外面包的字里没有这个字，所以 `uses` 恰好一项（W4 :272：每找到一处算一处，textual = 至少一处）。
it.each([
  ['x.authorize;', 'other'],
  ['p?.authorize;', 'other'],
  ['const o = { authorize: 1 };', 'other'],
  ['let v: A.authorize;', 'other'],
  ["let v: import('./p.js').authorize;", 'other'],
  ["export { authorize } from './p.js';", 'other'],
  ['// authorize', 'other'],
  ['authorize(id);', 'free'],
] as const)('E2-01 namesInRanges over the whole file %j reads authorize as %s', (text, use) => {
  expect(namesInRanges(syntaxTreeOf('src/cell.ts', text), null, ['authorize']))
    .toEqual([{ name: 'authorize', textual: true, uses: [use] }]);
});

// W4 :272 的词边界：左边紧挨着一个 BMP 外的标识符字（U+10400 是 Deseret 字母，ID_Start，UTF-16 里是一对代理）。
// TS 把 `\u{10400}authorize` 读成一个标识符，所以这里没有按词边界出现的 `authorize`：`uses` 空，`textual` = false（手算）。
// 改坏（8E-2 :272）：左边只读 `at - 1` 那一个码元（低代理，不是标识符字）→ 读成一处 `other`、`textual: true`，这一条红。
it('E2-01 namesInRanges counts an astral identifier character on the left as part of the word', () => {
  expect(namesInRanges(syntaxTreeOf('src/cell.ts', '\u{10400}authorize();'), null, ['authorize']))
    .toEqual([{ name: 'authorize', textual: false, uses: [] }]);
});

// 改坏（8E-2 :826）：漏 `require(…)` 的解构 → 第二格 `importNames` 是 `[]`，这一格红。
// 只断言 :826 写出的字段：`importNames` 每格，`isModule` 第五格，`globalAugmented` 第六格。
it.each([
  ["import a, { b as c } from 'x';", { importNames: ['a', 'c'] }],
  ["const { d } = require('y');", { importNames: ['d'] }],
  ["const { e } = await import('z');", { importNames: ['e'] }],
  ["import * as ns from 'w';", { importNames: ['ns'] }],
  ['const f = 1;', { importNames: [], isModule: false }],
  ['declare global {}\nexport {};', { importNames: [], globalAugmented: true }],
])('E2-02 fileSyntaxOf %j', (text, expected) => {
  expect(fileSyntaxOf(syntaxTreeOf('src/cell.ts', text))).toMatchObject(expected);
});

// 改坏（8E-2 :827）：只取 `spans[0]` → `pick` 的 `declarationRanges` 只剩 [1–1]，第一条断言红。
// 文字逐字同 tests/helpers/S8E-semantic-world.ts:142–156（纯文件不导入世界，D3）；行从 1 起。
// 先父后子的顺序同 typescript-source-query.ts:206–222 的访问（W10 :278）。
it('E2-03 navigationItemsOf keeps every overload span and lists each class before its member', () => {
  const overload = [
    'export function pick(id: string): string;',
    'export function pick(id: number): string;',
    'export function pick(id: string | number): string {',
    "  return String(id) + 'overload-key';",
    '}',
  ].join('\n') + '\n';
  const dual = [
    'export class First {',
    '  authorize(): void {}',
    '}',
    'export class Second {',
    '  authorize(): void {}',
    '}',
  ].join('\n') + '\n';
  expect(navigationItemsOf('src/wg/overload.ts', overload)).toMatchObject([
    { name: 'pick', start: { line: 1 }, declarationRanges: [{ startLine: 1, endLine: 1 }, { startLine: 2, endLine: 2 }, { startLine: 3, endLine: 5 }] },
  ]);
  expect(navigationItemsOf('src/wg/dual.ts', dual)).toMatchObject([
    { name: 'First', declarationRanges: [{ startLine: 1, endLine: 3 }] },
    { name: 'authorize', start: { line: 2 }, parentKind: 'class' },
    { name: 'Second', declarationRanges: [{ startLine: 4, endLine: 6 }] },
    { name: 'authorize', start: { line: 5 } },
  ]);
});
