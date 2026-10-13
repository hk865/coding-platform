# 编排、记忆、生命周期设计（2026-10）

**先读 [STATUS](../../STATUS.md) 和 [HANDOFF 顶部](../../HANDOFF.md)的决定 1–51，再读 [DESIGN.md](DESIGN.md)。** DESIGN 是合并后的设计书，已按决定 49 修订：第 2、4、6、7、K、K2 片原来待用户选择的行为和记忆查找方式都定了。接口、测试入口和施工规模仍在各片冻结前核定，设计已定不等于代码已完成。

**当前状态（2026-10-13）。** 可靠性批次已完成；编排第 0、1、3、5 片和接线包 1 已合入，到 `6c63f069` 为止已推到 `feat/orchestration-slices`。接线包 2（I-2、I-4、I-5、I-6）在准备，接着起草第 2 片和 K 片规格。当前进度统一看 STATUS；整套文档由 lead 负责审核。

## 仍在用的

| 文件 | 用途 |
| --- | --- |
| [DESIGN.md](DESIGN.md) | 你看到和做的事、编排、记忆、生命周期、上下文与工具、放置和分片依赖 |
| [model/](model/README.md) | 对象、行为、图、场景与模糊点；读分析时以已定答复为准 |
| [MEMORY-LOOKUP.md](MEMORY-LOOKUP.md) | 决定 49 采用的双图记忆查找方案，第 4 片的输入；具体接口待冻结 |
| [slices/](slices/README.md) | 分片规格、任务书、接线包 2 草稿和 2026-10-13 起的 TDD 做法 |
| [E3-UI-ITEMS.md](E3-UI-ITEMS.md) | A.2 第 5 步与后续决定留下的界面项；随新界面交付 |

界面以[冻结原型](../../../ui-reference/workbench-2026-10/README.md)和 [UI-WORKBENCH §0](../../../UI-WORKBENCH.md#ui-decisions-2026-10)为基线，冻结之后的修改按 HANDOFF 决定与 E3 清单读取，不改回旧原型。

## 已答复的审查与历史

- [第 1、3、5 片审查页](model/REVIEW-SLICES-1-3-5.md)：决定 42 已答复，这三片已合入。
- [第 2、4、6、7、K、K2 片审查页](model/REVIEW-SLICES-2-4-6-7.md)、[用户回复](model/REVIEW-SLICES-2-4-6-7-USER-REPLIES.md)、[lead 答复](model/REVIEW-SLICES-2-4-6-7-LEAD-ANSWERS.md)：决定 49 已采用选定内容；[意见合并稿](model/REVIEW-SLICES-2-4-6-7-OPINIONS.md)已被该决定取代。
- 第一轮的 [STATE](STATE.md)、[STRUCTURE-DRAFT](STRUCTURE-DRAFT.md)、[QUESTIONS](QUESTIONS.md)、[LEAD-NOTES](LEAD-NOTES.md)：2026-10-06 至 10-07 的调查和草稿，代码出处按 HEAD `42604b3`。决定 35 采用的答案及后续修改已并入 DESIGN，不按旧问题重新派发。
- [D-PLACEMENT](D-PLACEMENT.md)：任务 D 重算时的放置输入；任务 D 已按重算方案完成（`0cd45508`），当前子模块声明看 [module-target.json](../../module-target.json)。

**由来。** 决定 34 开始设计；决定 35 定第一轮问题；第二轮把答案、简化结果和 Kernel 补丁安排合入 DESIGN。决定 37–42、45、49 随后修订行为；决定 36、43、44、46 及 2026-10-13 做法确定施工分工。旧轮次的“提议”和“下一步”保留其当时含义，当前顺序看 STATUS 和 slices。
