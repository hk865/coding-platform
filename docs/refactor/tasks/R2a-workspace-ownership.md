# R2a：WorkspaceTools 的真实所有权与消费者迁移

状态：2026-09-23 本地 dsh 实施、主 Agent 独立验收通过，见[验收记录](../reviews/implementation-batches.md)。架构、批次、独立验证由当前主 Agent 负责；dsh 仅实现本页限定的代码。上位依据：[WorkspaceTools 骨架](../modules/core/workspace.md)、[目标 DAG](../module-dag.md)、[用户意图](../intent/INTENT-AND-DECISIONS.md)。

## 本批结果

现有文件、源码索引、来源捕获及用途读取实现归入 `src/core/workspace/`，所有实际消费者使用新路径，旧 `src/data/workspace-reader/` 无剩余实现。保持现有运行行为、公开 Port/wire 类型及来源/权限规则。此批完成后再单独实现冻结捕获和新 Port，不把纯迁移声明为 R2 全部完成。

## 具体范围

代码路径相对 `coding-platform/`：

1. 将 `src/data/workspace-reader/` 的 18 个 TypeScript 实现及 README 迁入 `src/core/workspace/`。本批保留文件基名与相同相对层级，避免把行为重写混入所有权迁移；后续按用途拆分局部目录仍属内部组织选择。
2. 修改 `src/`、`tests/`、`scripts/` 中指向旧实现的实际 import、动态路径、构建输出路径与源码验证样本。只更新必要引用，不批量重写历史证据/文档中的旧路径。
3. `scripts/module-map.mjs` 将实际 WorkspaceReader 所有者替换为 WorkspaceTools，目录指向新位置；旧消费者到它的允许边随迁移换名。当前仍有 11 个旧模块，因此实际图并非已经收敛为最终 5 模块图。WorkspaceTools 无产品模块依赖。
4. 更新 `scripts/check-module-boundaries.mjs` 中 fake workspace adapter 的确切白名单路径，保留原白名单范围，不能放宽到整个目录。
5. 更新 `scripts/verify-source-index.mjs` 的真实 dist/import 和源码样本路径；构建入口、历史数据与源码索引结果语义不变。

## 必须保持

- R1 已实现的 `architectureMaterials → inspect` 单次分析和 await 前固定来源；不得退回展示分页重捕获。
- 路径逃逸/拒绝前缀、符号链接规则、容量、取消、来源变化、配置并发与 unresolved 行为。
- Python/Jedi 和 C++/libclang 的真实 helper/资源路径、能力差异；不伪造支持。
- 既有 schema、Run/Task 引用、调用权限和用途限制；不新增 Session 或 Kernel 能力。
- 用户已有 AGENTS、集成测试、工作目录辅助文件与 R1 的修改。对已有修改文件只能做本批所需的准确 import 调整，不能 restore/reset 覆盖。

## 允许和不允许的改动

允许：上述文件移动、必要的调用方引用、实际模块归属/白名单、迁入 README 的目录及责任说明。既有测试只允许相应 import/样本路径变化；测试行为由主 Agent 独立审核。

不允许：重写算法、改公开响应、改变测试断言以迎合结果、增加空门面/转发旧目录、全仓格式化、改锁文件/依赖/Kernel/UI、修改本页或上位设计、提交/push/reset/clean。发现职责冲突时报告具体文件和阻塞，不擅自扩张本批。

## 独立验收

1. 检查移动前后实现主体一致；必要 import/样本路径/README 之外的语义变更逐条解释。
2. 当前源码/测试/脚本不存在仍指向旧目录的有效引用；旧实现没有并行副本。
3. 运行 workspace/source 相关测试、真实架构来源与模型探索工具消费者测试；按实际迁移范围纳入 role/query/reviewer/verification 的相关用例。
4. `pnpm typecheck`、`pnpm check:architecture`、必要构建与 `verify-source-index` 通过；实际 map 覆盖新目录，白名单未被扩大。
5. 对用户原有修改做前后核对；本批不声称性能已提升或生产代码已精简。

运行环境：工作区 `.toolchain/node-v24.21.0-linux-x64/bin` 与 `.toolchain/bin` 前置 PATH；在代码仓运行 pnpm。依赖已有，不重新安装。
