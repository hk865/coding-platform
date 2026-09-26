# 核心设计与首批实现证据

日期：2026-09-23。范围：[新目标架构](../ARCHITECTURE.md)、[核心操作](../CORE-DATA-OPERATIONS.md)、[状态机](../ORCHESTRATION-STATE-MACHINES.md)、[实施方案](../IMPLEMENTATION-PLAN.md)及首个实际代码改动。此记录不是旧 13 模块方案的历史评审。

本页数字、摘要和PASS只对应R1验收时的版本；链接按后续迁移指向现位置，最新源码状态见[逐批证据](implementation-batches.md)。

## 1. 基线与改动范围

代码仓 HEAD：`58c9ada73966711437c5fcd3d8f8fb92f3dca210`，工作区原有未提交修改。本次不提交、不覆盖原有 AGENTS、集成场景测试和工作目录辅助文件改动，不调整依赖和锁文件。

本次仅修改这两个源码／测试文件；另向已有 `AGENT-REFACTOR-LOG.md` 追加目标与现状的差异说明。

| 文件现位置 | R1生产／测试净行数 | R1验收时 SHA256 |
| --- | --- | --- |
| [project-source-index.ts](../../../coding-platform/src/core/workspace/project-source-index.ts) | +4（25 新增、21 删除），R1时 213 行 | `b113d320466066dd88bb704ce1e42bf36180ea3fa33d384ad83df0c39af60563` |
| [project-source-index.test.ts](../../../coding-platform/tests/data/project-source-index.test.ts) | +100（101 新增、1 删除），R1时 171 行 | `1c3b45f4de0cf3c980d8876eee7c2a501585de500fe69b163c6745bc34f43f6d` |

源码仍属于当前 WorkspaceReader。没有提前将实际模块归属表修改为尚未存在的新目录。

## 2. 行为变化与性能证据

真实消费者是 `ProjectArchitectureSourceReader → captureArchitectureSource → ProjectSourceIndex.architectureMaterials`。原实现反复调用展示用 `query` 读取 200 条一页的导入关系；每次 query 都重新捕获与验证文件，并重新提取关系。

新实现由内部 `inspect` 一次产生完整分析，`architectureMaterials` 直接消费；公开 `query` 只在返回时分页。同一分析所对应的来源列表在异步验证前固定，避免另一请求切换 TypeScript 配置后污染来源归属。

| 场景：401 条导入、404 个可读文件、402 个索引源码 | 改前 | 改后 |
| --- | --- | --- |
| 同次完整架构读取的展示页请求 | 3 页 | 0；直接消费完整分析 |
| 全量文件捕获（含最终验证） | 6 次：按旧循环和每次 query 两次 capture 推导 | 2 次：测试直接计数 |
| 导入关系提取 | 3 次：旧循环每页重复执行 | 1 次：源码调用链确认 |
| 全文读取 | 6 × 404：由旧循环推导 | 2 × 404：测试直接计数 |
| 最终来源核对 | 每页一次 | 同次完整分析一次，仍保留 |

未测旧版本端到端耗时、模型费用或全仓吞吐；不能据此声称运行提速三倍。原 Language Service 已复用未变脚本，不把减少重复遍历写成减少解析器重建。公开工具分开请求三页时仍各自捕获和核验；持久 capture/cursor、跨请求复用、完整生命周期和平台日志增量保存尚未实施。

## 3. 已执行检查

工作目录：`/home/hyh001/projects/coding-platform/coding-platform`。PATH 前置工作区已有 Node `24.21.0` 与 `.toolchain/bin`；未安装新运行时或依赖。

```bash
pnpm test tests/data/project-source-index.test.ts tests/control/source-architecture.test.ts tests/app/exploration-tools.test.ts
pnpm typecheck
pnpm check:architecture
git diff --check
```

- 相关测试：3 个文件、22 项通过。覆盖完整多页规模材料、公开分页、并发配置切换、内容／清单／权限／commit 变化、读取失败、取消、容量和分页边界，并验证既有架构来源与探索工具消费者。
- 类型检查：通过。
- 实际模块边界检查：通过，`issues: []`，解析 541 个源码文件、清单 542 个文件。验证的是当前真实源码图，不是目标已实现证明。
- 差异检查：通过。

未运行完整测试套件、真实模型调用或 UI 端到端测试；本批没有相应产品行为变更。新 Session 能力和目录迁移的验收不得引用上述 22 项作为其实现证据。

## 4. 文档验证口径

目标声明与当前源码分别检查：目标 5 个模块、8 条边、依赖无环，ARCHITECTURE 和 module-dag 中的 Mermaid 边与 JSON 一致，5 个模块页和 13 个旧模块去向均存在；实际源码保持现有归属。当前设计链 28 份文档、242 个本地链接检查通过。历史评审 164 处链接迁至归档，其中 160 处带行号引用均有效；manifest 中 17 份原稿的 SHA256 全部一致。

设计交付包含旧模块 M01–M13 的迁移、接口变化和删除条件。整体代码重构、完整 Session 生命周期与 UI 联动仍按实施方案标为待实施，不把新文档或目标目录名当作实现。
