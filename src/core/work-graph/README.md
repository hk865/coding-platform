# src/core/work-graph：WorkGraph 子模块的根与窄 source-authority 端口

## 负责什么，不负责什么
- 这里是 WorkGraph 模块的根：根下只放两个 `source-authority-*` 文件，其余职责都在 13 个子模块里，按各自 README 导航。
- `source-authority-ports.ts` 只声明端口类型，依赖 `materials`；`source-authority-reader.ts` 依赖 `source-authority-ports`、`materials`、`queries`，不得反向依赖 `tasks`、`views` 等上层。
- 只读取已经接受的规范事实（Workspace/Run/QueryRun/QueryJob）；授权、当前生命周期、占用和权限仍由调用方判断。
- 不做状态迁移、不写记录、不打开第二个 Store、不扫描历史：状态迁移一律经 `src/core/work-graph/state/`（根 `AGENTS.md` 第 9 条）。
- 依赖方向以 `docs/refactor/module-target.json` 为准：上层可以依赖下层，反过来不行。

## 文件
- `source-authority-ports.ts` — 只读 source 端口的类型：规范快照联合、四态读取结果、快照读取依赖、Query 源事件页。
- `source-authority-reader.ts` — `createSourceAuthorityReader` 工厂，把已装配的 `MaterialAuthorityReads` 适配成快照读取端口。
- `model/` — 纯领域模型、命令与契约；见 [`model/README.md`](model/README.md)。
- `state/` — 纯状态机与状态构造器，所有受保护状态写入的唯一入口；见 [`state/README.md`](state/README.md)。
- `persistence/` — 记录/事件编解码、提交编译、索引完整读取与失败映射；见 [`persistence/README.md`](persistence/README.md)。
- `configuration/` — 项目/工作区配置的读写服务；见 [`configuration/README.md`](configuration/README.md)。
- `materials/` — 材料、工件与规范事实读取器；见 [`materials/README.md`](materials/README.md)。
- `architecture/` — 架构目录与采纳版本的管理；见 [`architecture/README.md`](architecture/README.md)。
- `sessions/` — Session 目录、生命周期、健康、消息与 Session codec；见 [`sessions/README.md`](sessions/README.md)。
- `queries/` — Query 提交、执行、结果与恢复；见 [`queries/README.md`](queries/README.md)。
- `tasks/` — Task/Run/Attempt 编排与请求入口；见 [`tasks/README.md`](tasks/README.md)。
- `notes/` — 注记的写入、查找与版本；见 [`notes/README.md`](notes/README.md)。
- `evidence/` — 验证轮、检查与证据；见 [`evidence/README.md`](evidence/README.md)。
- `communication/` — 会话消息收件箱与决定答复；见 [`communication/README.md`](communication/README.md)。
- `views/` — 只读的界面读模型；见 [`views/README.md`](views/README.md)。

## 可以复用的能力
| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `createSourceAuthorityReader` | `src/core/work-graph/source-authority-reader.ts:97` | 把注入的 `MaterialAuthorityReads` 适配成 `SourceSnapshotReads`：Workspace/Run/QueryRun 委托材料读取器，QueryJob 经同一 records 与 query codec 精确读，ReviewWork 明确 `unsupported` | Runtime 或 Query 的 source 消费者需要按完整 ref 读取已接受事实时 |
| `SourceSnapshotReads` | `src/core/work-graph/source-authority-ports.ts:25` | 快照读取端口：`load` 加精确的 `readQuerySubmission`；缺失、不可读、不支持分别表达 | 只消费规范快照的调用方 |
| `SourceAuthorityReads` | `src/core/work-graph/source-authority-ports.ts:62` | 在快照端口上增加 `events` 分页能力的 Query 源端口 | Query 源消费者需要原始提交事件时 |
| `SourceSnapshotReadDependencies` | `src/core/work-graph/source-authority-ports.ts:40` | 装配依赖：必填 `authority`，可选与 Query 组合共享的 `records` | 组合 `createSourceAuthorityReader` 时 |
| `SourceCanonicalSnapshot` | `src/core/work-graph/source-authority-ports.ts:10` | 可接受的规范快照联合类型（Workspace/Run/ReviewWork/QueryRun/QueryJob） | 标记允许的事实种类 |
| `SourceSnapshotResult` | `src/core/work-graph/source-authority-ports.ts:13` | `found` / `not_found` / `unavailable` / `unsupported` 四态结果 | 返回读取结果时 |
| `QuerySubmissionRead` | `src/core/work-graph/source-authority-ports.ts:20` | 去掉 `not_ready` 的提交事件读取，只表达已接受/缺失/失败 | 精确定位原始 Query 提交时 |
| `SourceAuthorityEvent` | `src/core/work-graph/source-authority-ports.ts:52` | 只解释原始 `QueryJobSubmitted`，其它历史保持 opaque | 遍历 Query 源事件页时 |
| `SourceAuthorityPage` | `src/core/work-graph/source-authority-ports.ts:53` | 带 `afterCursor`、`throughCursor`、`hasMore` 的事件页 | 实现 Query 源事件分页时 |

## 内部用
- 无：两个根文件导出的都是给其他模块实现或调用的端口类型与工厂。

## 不要做
- 不要在根新增业务判断、记录写入或状态迁移；状态写入只经 `state/`。
- 不要另开 Store 连接、另写记录解码器或索引扫描；复用 `materials` 的已装配读取器（M1-28）。
- 不要把手里的失败读成空事实、`not_found` 或“已完成”，要保留 `unavailable`（FP-05、M1-12、MH-06）。
- 不要伪造空事件页；快照端口没有 `events`，`unsupported` 不是空结果。
- 不要把一个 `found` 的 Run 当作执行授权或当前生命周期结论。
