# next R4c 连续 Session 转发子集验收（2026-09-24）

**本页窄子集已独立验收：54 文件 / 376 项 PASS，类型、独立构建、构建入口加载和边界检查通过。完整 R4c / R4p 未完成。** 前序为 [R3d/R3g 的 372 项](next-r3d-r3g-2026-09-24.md)。

本轮先核对用户对任务白板和并行的纠正，见[意图审阅](task-graph-orchestration-intent-2026-09-24.md)。统一预测范围预占不再作为领取前置；拟议 Store 资源索引扩展暂停，未新增源码或红测。Task 查询的硬边/前驱整体完成语义仍需按具体输入和提醒关系修订。本页通过不关闭这些缺口。

## 实际变化与边界

唯一生产变更是 `next/src/core/agent-runtime/observed-model-run.ts`：公开可选参数复用冻结 Kernel 的 SessionContextMode / ExecutionIdentity，首个 await 前复制必要标量对象，再透传给 runCodingAgent。缺省仍为 current_turn 与随机执行身份。不在平台重建历史、推测历史边界、增加验证层或复制 Kernel 重放实现。

调用链：可信调用方给真实 completed history boundary / execution identity → runObservedModel → 冻结 Kernel → Kernel 自己读取 Session SQLite、组装实际模型输入和处理重放。测试使用本地脚本模型，实际运行 Kernel 与 SQLite，不产生外部模型费用。

**尚未接通：** 平台正式 Task/Query admission、执行驱动与持久观察回流、自动选择下一轮 historyCursor、控制/恢复/维护，以及运行时范围并行/隔离/合并。Runtime 的整体 continueHistory 能力没有因此改为已支持。此次是现有模型循环的真实桥接，不是完整产品连续工作链。

## Sol / DSH / 主审过程

- GPT-6 Sol 建立两项可选参数骨架和三个真实 Kernel 测试；显式未接线分支使新增测试先失败。
- 主审增加第四项固定早期边界及缺省 current_turn 正例，并验证实际 assistant 历史；冻结测试后红测为 4 失败 / 14 原有通过。
- 实际 DSH Session `session-2e53f638-e393-41d7-acf6-0858cb3898ef`，lane `next-r4c-continuity-20260924`，只允许修改上述一个生产文件。测试、类型、Kernel 和相邻模块只读。施工依据使用[现有路径提示](../tasks/R4c-next-continuity-dsh-prompt.md)与[精确 scope](../tasks/R4c-next-continuity-dsh-scope.json)。
- DSH 删除临时未接线分支并转发两个快照对象；主审核对完整差异，独立复测 18 项通过，scope 越界为零，主目录被偷偷修改为零后才导入。
- 在物理隔离的 next 副本完整运行类型、构建、测试和编译入口加载；没有旧平台源码，仅链接已有第三方依赖。

## 验证与规模

| 检查 | 实测 |
| --- | --- |
| 专项 + 已有工具生命周期 | 18 PASS；首轮 user/assistant 真正进入后轮；固定旧边界排除中间轮；不传参数仍 current_turn |
| 重放和失败 | 同身份重放无新模型调用/Turn/记录；改输入为 idempotency_conflict；不存在/未完成边界拒绝；await 后调用方修改不影响已复制输入 |
| 干净环境全套 | 54 文件 / 376 PASS，0 fail / skip |
| 类型、构建、编译入口与边界 | PASS；5 模块、5 实际 / 8 允许依赖 |
| 原 src/tests/Kernel src 保护 | 1313 文件，0 改动 |
| next 生产 TypeScript | 144 文件 / 23,029 物理行；比前序净增 10 行 |
| 其中共享 contracts | 56 文件 / 3,733 行，不变 |
| next 测试（含 fixture） | 56 文件 / 10,930 行；本批增加 149 行 |

没有测量端到端费用/延迟。真实可证明的是转发复用已有 Kernel 能力，同执行身份重放不新增模型调用；不能据此宣称整个项目复杂度或总成本已经下降。

证据：[红测](evidence/next-r4c-continuity-2026-09-24/red.log)、[主审专项](evidence/next-r4c-continuity-2026-09-24/candidate-accepted.log)、[最终物理隔离](evidence/next-r4c-continuity-2026-09-24/isolated-verification.log)、[scope](evidence/next-r4c-continuity-2026-09-24/scope-result.json)、[导入](evidence/next-r4c-continuity-2026-09-24/import-review.json)、[规模与保护](evidence/next-r4c-continuity-2026-09-24/metrics-and-protection.json)、[受验输入](evidence/next-r4c-continuity-2026-09-24/verified-target-files.json)。DSH 完成报告另存同目录，仅为施工自报。
