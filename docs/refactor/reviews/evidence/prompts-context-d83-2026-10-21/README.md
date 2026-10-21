# 第 6、7 片的“提示词和上下文”一节（决定 83，2026-10-18 至 10-21）

## 是什么

- 决定 83（10-18 晚）：第 6、7 片冻结后补一节“提示词和上下文”。用户先提醒：“第六篇、第七篇可能对于每一个模型的 prompts 工程的要求都很高，因此它需要配置化，不要硬编码”。K3、C1、T 之后由 lead 起草。
- 冻结的规格：[slice-6-7-PROMPTS-SPEC](../../../design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md)。结果和用户的五个决定见 [HANDOFF 决定 83-4](../../../HANDOFF.md)。
- 这是一份规格，不是施工。施工分两处：结构一轮里的 D3（把今天写死的文字原样搬进平台包第 1 版，字节不变）和 PC（PC-1、PC-2，6A 之前）。

## 经过

1. **Codex 只读调研**（10-18）：今天的提示词放在哪、怎么拼、超长时怎么删、思考怎么带、怎么记。提示和原文在 `codex/context-layout.prompt.md`、`codex/context-layout.out.md`。lead 对着代码核过删减顺序、`check` 工具、`LOCAL_WORKBENCH_GUIDANCE`、Skill 目录四处。
2. **第一稿**（lead，10-21）：`drafts/spec.v1.md`。
3. **第一轮完整审查**（Codex，只读）：23 条。`codex/review1.prompt.md`、`codex/review1.out.md`。
4. **第二稿**（lead）：`drafts/spec.v2.md`，照第一轮改，几处行为留给用户定。
5. **第二轮完整审查**（Codex，复核第一轮并找新问题）：第一轮 18 条已解决、5 条部分解决；新提 9 条（会出错 4、冲突 1、事实错 2、不清楚 2）。`codex/review2.prompt.md`、`codex/review2.out.md`。
6. **用户的五个答复**（10-21）：lead 用选择题问了秘书的上下文、换手、编辑、排法和秘书自己转交。秘书那一题，lead 原先提的“每轮从记录重建”和以前的讨论不符，用户指出后改成接完整历史。排法那一题，用户先要了解释再答。原话在 HANDOFF 决定 83-4 和规格 §0.1。
7. **第三稿**（lead）：`drafts/spec.v3.md`，照第二轮和用户的答复改。用户确认测试入口 PE1–PE10：“可以”。
8. **最后一次快速核对**（Codex）：7 条（会出错 4、冲突 1、事实错 1、不清楚 1）。`codex/quick3.prompt.md`、`codex/quick3.out.md`。lead 逐条对代码核过，都成立，全部照改。
9. **冻结**（lead，10-21）：照快速核对改完，按 `59cfed1c` 列全要改断言的旧测试（规格 §3.3），写明“平台自己的 Skill”怎么认。

两轮完整审查加一次快速核对，是决定 56 给一份规格的上限。Codex 都是只读，不跑测试、不写文件。

## 处理

逐条处理在 [handling.md](handling.md)：第一轮 23 条、第二轮新提的 9 条、快速核对 7 条，以及冻结时 lead 另补的两处。

## 文件

| 文件 | 是什么 |
| --- | --- |
| `codex/context-layout.*` | 10-18 的只读调研 |
| `codex/review1.*`、`codex/review2.*`、`codex/quick3.*` | 三次审查的提示和原文（提示里的路径是当时的只读副本） |
| `drafts/spec.v1.md`、`spec.v2.md`、`spec.v3.md` | 三稿；冻结稿就是仓库里的规格 |
| `handling.md` | 逐条处理（冻结前规格 §7 的原文，加上快速核对的处理） |
