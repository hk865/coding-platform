/**
 * 8E-2 W 返工一 WA-R1-01、WA-R1-02、WA-R1-03：第二档没有命中时什么算 `undecided`（W6 8E-2 :274）。
 * 入口：W 的公开端口 `createReferenceAnalyzer(deps).verify(ctx, request)`（reference-analyzer.ts:55、:224）。
 * 世界：workspaceToolsFixture 的真实临时根，没有配置文件（默认选项、`noLib`，typescript-source-query.ts:121）；
 * deps 是这个根的真实 `readWorkspaceFiles`、`listWorkspaceInputs`。每行一个新根、一个新分析器、一组一题。
 * W6 :274：没有命中时，范围里 X 的名字有一处作属性出现、编译器在那一处取不到这个属性 → `unverifiable`（`undecided`），
 * 否则 → `not_found`；作属性出现含“解构里的属性名”“有上下文类型的对象字面量里的属性名”，那两种的“取不到”是
 * 被解构的值的类型、字面量的上下文类型里没有这个属性（含这个类型解析不出来）；范围里别的解析不出来的名字都不算。
 */
import { afterEach, expect, it } from 'vitest';
import type { ReferenceAnswerV1, ReferenceQuestionV1 } from '../../src/core/workspace/ports.js';
import { createReferenceAnalyzer } from '../../src/core/workspace/reference-analyzer.js';
import { ready, workspaceToolsFixture, type Entry } from '../helpers/workspace-tools-fixture.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const fixture = workspaceToolsFixture({
  projectId: 's8e2-w-reference', actorId: 's8e2-w-reference-reader', permissionRevision: 's8e2-w-reference-policy-v1',
  tempPrefix: 's8e2-w-reference-', cleanups,
});

const UNDECIDED: ReferenceAnswerV1 = { status: 'unverifiable', reason: 'undecided' };
const NOT_FOUND: ReferenceAnswerV1 = { status: 'not_found' };
const PERMIT: Entry = ['src/wg/permit.ts', 'export function onPicked(): void {}\n'];

/** 建根和分析器，问一题：X 是 `definition` 第 1 行的 `name`，证据是 `evidence` 的第 `line` 行。 */
async function answerOf(entries: Entry[], definition: string, name: string, evidence: string, line: number): Promise<ReferenceAnswerV1> {
  const c = await fixture(entries);
  const analyzer = createReferenceAnalyzer({ readWorkspaceFiles: c.handle.readWorkspaceFiles, listWorkspaceInputs: c.handle.listWorkspaceInputs });
  cleanups.push(() => analyzer.close());
  const question: ReferenceQuestionV1 = {
    definition: { path: definition, name, line: 1 }, evidence: { path: evidence, ranges: [{ startLine: line, endLine: line }] },
  };
  return ready(await analyzer.verify(c.context, { workspace: c.workspace, priority: 'write', groups: [[question]] })).answers[0]![0]!;
}

it('WA-R1-01 a destructured property the value type lacks as a whole is undecided', async () => {
  // `v` 的类型是联合，`{ y: 1 }` 没有 X：编译器在 `{ X }` 这一处取不到 X（按整个被解构的值的类型取），
  // `use.ts` 里也没有命中 → `undecided`（W6 :274）。
  const answer = await answerOf([
    ['src/def.ts', 'export interface Def { X: number }\n'],
    ['src/use.ts', "import type { Def } from './def.js';\ndeclare const v: Def | { y: 1 };\nconst { X } = v;\nexport const z = X;\n"],
  ], 'src/def.ts', 'X', 'src/use.ts', 3);
  // 改坏（8E-2 :274）：解构处按联合的成员判，有一个成员有 X 就算取得到 → `not_found`，这一条红。
  expect(answer).toEqual(UNDECIDED);
});

it('WA-R1-02 a literal computed key in a destructuring is the property name', async () => {
  // `['onPicked']` 是解构里的属性名；`box` 没有声明、类型解析不出来 → `undecided`（W6 :274）。
  const answer = await answerOf([PERMIT, ['src/wire5.ts', "const { ['onPicked']: h } = box;\nexport const z = h;\n"]],
    'src/wg/permit.ts', 'onPicked', 'src/wire5.ts', 1);
  // 改坏（8E-2 :274）：解构的计算属性名不认、退回本地名 `h` → `not_found`，这一条红。
  expect(answer).toEqual(UNDECIDED);
});

it('WA-R1-02 a literal computed key in a contextually typed object literal is the property name', async () => {
  // 上下文类型 `{ other: number }` 里没有 `onPicked` → `undecided`（W6 :274）。
  const answer = await answerOf([PERMIT, ['src/wire5.ts', "export const table: { other: number } = { ['onPicked']: 1 };\n"]],
    'src/wg/permit.ts', 'onPicked', 'src/wire5.ts', 1);
  // 改坏（8E-2 :274）：对象字面量的计算属性名不认 → `not_found`，这一条红。
  expect(answer).toEqual(UNDECIDED);
});

it('WA-R1-02 a computed key that is not a literal never falls back to the local name', async () => {
  // `[k]` 不是字面量；本地名 `onPicked` 是新绑定、不是属性，范围里别的解析不出来的名字都不算 → `not_found`（W6 :274）。
  const answer = await answerOf([PERMIT,
    ['src/wire5.ts', 'declare const k: string, box: { a: number };\nconst { [k]: onPicked } = box;\nexport const z = onPicked;\n']],
  'src/wg/permit.ts', 'onPicked', 'src/wire5.ts', 2);
  // 改坏（8E-2 :274）：有属性名时仍退回本地名，把 `onPicked` 当成 `box` 的类型里没有的属性 → `undecided`，这一条红。
  expect(answer).toEqual(NOT_FOUND);
});

it('WA-R1-03 an object rest binding is not a property', async () => {
  // `...rest` 是收下余下属性的新绑定，不是解构里的属性名；`b.ts` 不导入 `rest`、没有命中 → `not_found`（W6 :274）。
  const answer = await answerOf([
    ['src/a.ts', 'export function rest() {}\n'],
    ['src/b.ts', 'export function f(props: { id: number; name: string }) { const { id, ...rest } = props; return id; }\n'],
  ], 'src/a.ts', 'rest', 'src/b.ts', 1);
  // 改坏（8E-2 :274）：剩余绑定当成属性，`props` 的类型里没有 `rest` → `undecided`，这一条红。
  expect(answer).toEqual(NOT_FOUND);
});

it('W-R2-02 a literal computed key across lines is checked on the line of its name', async () => {
  // `[` 在第 2 行、`'onPicked'` 在第 3 行、`]: 1` 在第 4 行，证据只有第 3 行：名字那一处在范围里，
  // 上下文类型 `{ other: number }` 里没有 `onPicked` → `undecided`（W6 :274）。
  const answer = await answerOf([PERMIT, ['src/wire5.ts', "export const table: { other: number } = {\n  [\n    'onPicked'\n  ]: 1,\n};\n"]],
    'src/wg/permit.ts', 'onPicked', 'src/wire5.ts', 3);
  // 改坏（8E-2 :274）：范围按计算属性名 `[` 那一行（第 2 行）判 → 不在范围里、不算 → `not_found`，这一条红。
  expect(answer).toEqual(UNDECIDED);
});
