# dsh 并行实现任务：R3a Goal 贯通与 R4a Kernel 扩展

> 执行状态（2026-09-24）：首轮实现与后续返修已完成，R3a / R4a 通过[独立验收](../reviews/R3a-R4a-sol-dsh-acceptance.md)。下文是首轮任务原文，不应重复派发；后续采用 [Sol 骨架 / 测试与受限 dsh](../DSH-EXECUTION-HARNESS.md) 流程。

更新：2026-09-23。性质：可交给 dsh Lead 的实现指令。当前设计已经过文档审阅；本文件**不表示公共类型已编译、代码已实现或独立验收已通过**。本次准备任务，没有启动 dsh。

## 1. 执行目标与责任

开始写代码，不重做 Prompt 2/3/5，不重新设计五模块。先将本批已定契约机械地落成可编译源码，然后使用 **Agent Teams 并行实施**：

- A：R3a RecordStore 的物理后端与事务。
- B：R3a WorkGraph 的 Goal 规则与兼容编译。
- K：R4a Kernel 最小公开扩展，可独立于 A/B 先启动。
- Lead：共同契约、旧消费者迁移、装配与最终集成；不让几个成员同时修改同一公共文件。

主 Agent（本次重构的架构和独立验收负责人）继续负责架构、骨架设计、独立测试与最终验收。dsh Lead 只把已经确定的签名、算法和文件责任落成源码，不自行变更数据权威、权限、状态机或模块依赖。文档内的边界样例是已定行为要求，不是要 dsh 自己重新决定验收标准。

交付两条真实结果：① 原 Goal 创建入口实际经过 WorkGraph + RecordStore；② Kernel 公共入口支持本任务规定的稳定执行身份、会话历史和控制扩展。R4a 完成不代表平台已经支持连续 Session 或范围并行；R4b/c/p 接线属于后续任务。不要自动扩张到完整 R3–R6。

## 2. 路径、依据与最小阅读包

```text
W = /home/hyh001/projects/coding-platform
C = /home/hyh001/projects/coding-platform/coding-platform
N = /home/hyh001/projects/coding-platform/docs/refactor
K = /home/hyh001/projects/coding-platform/coding-platform/vendor/coding-agent
```

W 是工作区；C 才是代码 Git 仓。N 是当前设计；`my-coding-platform-docs/`、`docs/history/`、`docs/refactor/archive/` 仅用于精确兼容或追溯，不作为旧架构重新覆盖当前设计的理由。

Lead 先读：

1. `C/AGENTS.md` 的当前重构入口；[HANDOFF](../HANDOFF.md)。
2. [当前 PRODUCT](../../PRODUCT.md)、[ARCHITECTURE](../ARCHITECTURE.md)、[模块 DAG](../module-dag.md)。
3. [用户意图与决定](../intent/INTENT-AND-DECISIONS.md)、[原始对话](../intent/ORIGINAL-DIALOGUE.md)中数据结构/原子工具/业务分层/实现职责相关发言，以及[最新并行补充原话](../intent/2026-09-23-PARALLEL-AND-PRODUCT.md)。原文无需全部装入每个成员上下文，但分派必须转述与其任务有关的约束并给出处。
4. [并行协作设计](../PARALLEL-COLLABORATION.md) §3、§6；[R3a 精确任务书](R3a-goal-record-store.md)；[AgentRuntime](../modules/core/agent-runtime.md) §5–6；[迁移计划](../refactor-plan.md) R3a/R4a。

A/B 分别补读 [RecordStore](../modules/core/record-store.md) / [WorkGraph](../modules/core/work-graph.md) 的相关章节。K 必须先读 `K/AGENTS.md`、`K/INTEGRATION.md` 和本地实际 public-api。新成员使用 fresh 时给完整任务、绝对路径、签名、禁止修改范围和完成条件，不能说“按前面的讨论做”。

用户已确定：多 Agent 必须支持同工作区按实际范围并行；数据工具检查，Agent/编排决策与修正。普通数据读取不要求 LLM/Run；不同 Session 可以并行，同一 Session 的可变执行仍互斥；正式事实只由对应完整原子操作维护。工具结果反向维护图与状态是原方案的一部分。

## 3. 团队能力与现有工作保护

本地 dsh 的团队入口需要显式启用 `@deepseek-ai/dsh-experimental-agent-team-profile`；普通 `--profile headless` 不保证有这些工具。启动后检查实际工具是否有 `spawn_teammate`、`send_message`、`wait_agent` 及 `team_task_*`。本任务明确授权使用 Agent Teams，不能只在回答里描述三个角色却串行扮演它们。

若缺少团队工具，明确报告当前 profile 缺少什么，不宣称已经并行。可继续 Lead 的本批契约落码和范围清单，但不要据此开始串行完成三个实现包，也不要自行安装包、修改 profile 或权限。主 Agent 可以启用现有团队层，或以不同 dsh Session 从外部并行派发这些文件互不冲突的任务。

团队成员共享同一目录，`write_scopes` 是冲突提示，不是文件锁。创建任务板，列出唯一文件负责人；共享文件变更由 Lead 实际集成。依赖声明不是物理隔离，不能让“不同任务 ID”成为覆盖别人文件的依据。

开工时读取 C 的改动状态，记录本批相关文件的既有差异/内容摘要及所有者。当前已有用户修改及未验收 R2e.1；至少排除 `src/core/workspace/**`、`src/execution/worker-runtime/project-source-tool.ts`、`src/data/context-compiler/runtime-context.ts` 及其现有测试改动，除非主 Agent 另行明确交接。不能把 dsh exit 0 当成 R2e.1 已通过，也不等待无关的全部 R2e 功能才做本批。

不 reset/restore/clean/stash，不自动 stage/commit/push；不打印凭据或无关会话日志，不安装依赖、不升级锁文件、不运行付费模型集成测试。团队模型调用属于本任务已授权的协作，区别于启动产品真实模型测试。

## 4. P0：只闭合当前切片的契约

P0 是编码的第一步，不是再做一轮全局设计，也不等待所有未来 API。K 可以在 Lead 闭合 P0-A 时并行读取/实现其独立的 P0-K。

### P0-A：Goal 的共同契约

Lead 按 R3a 任务书机械落码并公布准确文件/导出：

- `contracts/core/{identity,results}.ts` 的本链最小类型；复用已有 `call-context.ts` 及旧 Goal/命令/事件类型，不重命名身份。
- `core/record-store/ports.ts`：`GoalRecordTransactionPort`、窄 `PreparedCommit`、编码/schema/CAS/回执与错误协议。只有 `readMany/lookupCommit/commit/eventAt`，不得先发布尚不存在的完整 Store。
- `core/work-graph/tasks/contracts.ts`：`GoalTaskPort`、`GraphWrite<CreateGoalInput>`、两个 legacy Port、Goal 服务依赖。按任务书实际归属导出工厂和 backend 类型，不为方便复制另一组签名。
- 明确 A/B 共同使用的 backend 工厂、legacyAccess 和 codec registry 形状；B 拥有唯一 `GOAL_RECORD_SCHEMAS` 实现，A 只消费机械注册协议，不反向导入 WG。

用源码中的准确类型及提供者/消费者签名核对编译。只形成无实现的接口声明可以；不用空函数返回成功来换取编译通过。若既有无关 WIP 已使全仓检查失败，记录基线诊断，至少隔离验证本批契约；不能把跳过诊断或关闭严格选项写成“全仓通过”。

冻结范围仅为上述子集。`FullRecordStore`、未来 Session/资源索引、`commitCursorBindings`、邮箱排序绑定、完整 Role/Memory/UI Port 都不属于 P0-A。发现局部类型遗漏可由 Lead 同步补齐并通知双方；涉及新的业务决定，向主 Agent 报具体冲突并继续其他独立工作。

### P0-K：Kernel 公开扩展

K 按 AgentRuntime §6 在原公开类型追加 `SessionContextMode`、`ExecutionIdentity`、run/resume 控制和恢复所需字段；保留旧缺省语义。Kernel 内部算法属于 K，实现平台适配时只能走公开导出。本次不修改平台 Runtime 生产装配。

## 5. 并行工作包与文件所有者

下表路径相对 C；必要文件可以在自己的范围内调整，先查是否存在其他写者。公共文件先交 Lead，不能直接越界修改。

| 负责人 | 可以修改 | 交付与边界 |
| --- | --- | --- |
| Lead | `src/contracts/core/` 本批新增类型、Store `ports.ts`、WG `tasks/contracts.ts`/公共 Port；R3a 指定旧 Control/StateLedger/validator 消费者、composition/harness/app 接线；`scripts/module-map.mjs`、必要公共 fixture | 一个共享物理 backend，两类旧 Goal 入口委托新 WG；只迁 Goal kind；公共 fixture 只迁装配，不放宽断言 |
| A | `src/core/record-store/{record-codec,sqlite-record-store,in-memory-record-store,migrations}.ts` 及仅本包内部 helper | 同一连接/同一组 Map 的事务、精确键读取、CAS、幂等与回滚；legacyAccess 按已定过渡协议；不接业务回调、不实现 Goal 准入 |
| B | `src/core/work-graph/tasks/task-service.ts`、`src/core/work-graph/persistence/{commit-compiler,graph-repository,record-codecs,legacy-adapter}.ts` | 复用原规范化/身份规则，完整读集与编译、旧回执映射、精确事件恢复；不写 SQL/Map、不调用旧 Ledger |
| K | `vendor/coding-agent/` 中公开类型/导出和扩展所需生产实现、必要集成说明 | 稳定 run/turn 身份、真正 session 历史、固定完成边界、完整工具配对、一次上下文选择、checkpoint 与 pause/resume 兼容；不另建平台 transcript 存储 |

先用真实团队工具启动 K；P0-A 准备好后同时派发 A/B。Lead 可与它们并行迁不冲突的旧入口装配。容量有限时优先同时推进独立项，不要求固定数量，也不让不相关项等待某个成员完成。各包可以用明确的本地测试替身开发，最终两模块贯通必须换真实 backend，Kernel 必须用真实 SQLite 和本地模型替身观察实际请求。

A/B 的真集成依赖双方交付，K 的独立功能不依赖 A/B。平台 Session/Runtime 与同工作区范围并行不能因为 K 或 Goal 完成就提前标为已支持。

每个成员收到：完整目的、最小阅读包、公共契约版本、允许文件、保留行为、不得实现项、验收场景和回报格式。Lead 按各路径的直接依赖分别审阅并接线：A/B 就绪即可贯通 Goal，不等待 K；最终同树总构建再等待相关写入稳定。正在进行有用工作时用消息协调，不反复重读所有日志。

## 6. 必须保持的关键行为

### R3a

- `goalId` 与幂等 requestId 独立；旧 `GoalCreated@1`、GoalRef、JSON 和回执语义保持。
- 同身份重放优先于当前版本检查；重放返回原 Goal@1 和原回执，不能读取最新 Goal 当原结果。`eventAt` 精确定位，不从起点扫描全部事件。
- 最终事务核对 Project/Workspace revision 和 Goal 不存在，读空也有 guard；竞争/失败不能留下部分事件、快照或回执。
- SQLite 新旧入口共用同一 connection；内存共用同一组物理状态。Store 不调用 StateLedger.commit 包一层，不导入 WG；业务规则只在 WG。
- 原同步构造、beforeWrite、close 及旧未迁 kind 保持兼容；Goal 旧 validator/复制 fold 在真实消费者切换后退出，未迁分支保留明确后续归属。
- R3a 任务书已批准的 raw batch 输入修复按原文实施，不借机改其他历史数据或 wire。

### R4a

- 缺省行为仍 current_turn；resume 是未完 Turn 的恢复，不是接受新指令的 continue。
- session_history 从真实已完成边界恢复完整对话与工具交换，当前输入只加入一次；边界损坏/错误 Session/缺失工具结果如实拒绝。
- 同执行身份不能追加第二个 turn.started；重启固定原 contextBasis，不偷换成最新历史。重复进入遵守已有执行状态，不能重复产生副作用。
- 一次合并预算选择；真实 system/tools/skills 都计入。旧日志/checkpoint/checksum 保持可读，不批量改写历史。
- pause 只有真实持久化观察后才 ack；resume 保持沙箱、配置、剩余预算。native compact 仍 unsupported。

### 避免本批过度设计

不造全量 CRUD 框架、万能调度器、通用事件总线、未消费索引、全项目 provider 插件系统，或一批只转发一次的空壳。因不同模块确有消费者、事务/存储机制可复用而保留边界，不按文档每段文字机械拆一个文件/类。

后续范围并行切片：`assessParallelism` 是可选解释工具，明确候选可以直接 claim；两者共用解析/冲突逻辑。先交付初始范围、原子扩展、真实工具限制与终态释放；在线缩减在工具排空协议实现前明确 unsupported。不能删除 Session 独占、原子 claim、fresh begin、消费者代际或 unknown 保护来精简代码。这些未来约束用于避免当前接口封死扩展，不要求本批预建实现。

## 7. 验证、独立验收与完成报告

使用 W 的已有 Node24 和 pnpm。分别在 C/K 运行对应已有脚本，不重装依赖。局部检查可并行；共享构建输出只交一个负责人操作。K 的 `npm test` 会先 build，平台 `pnpm build` 也会构建 Kernel，不能让两者同时改同一个 dist。

1. R3a 按任务书 §8 场景验证真实创建链、原结果重放、并发创建、事务中故障回滚、旧库读取、共享 backend 以及 memory/SQLite 一致行为；运行相关既有 ledger/Control 套件。
2. K 按 AgentRuntime §6 八项要求验证真实请求中的历史、配对、固定边界、重复身份、重启、预算和 pause/resume；运行受影响现有套件及默认 CLI 回归，不调用真实付费模型。
3. 各包交付后，Lead 在写入稳定的同一状态运行 `pnpm typecheck`、`pnpm check:architecture`；K 的 typecheck/边界及必要 lint/check 按 K 的规则完成；最后由单一负责人运行平台 `pnpm build` 验证真实导出与集成。
4. 主 Agent 提供的独立测试不可修改或放宽。R3a 临时草稿 `/tmp/R3a-goal-record-store.test.ts` 不能当成已经安装/编译通过的验收包；由主 Agent核对并安放。若独立测试尚未交付，可以按已定场景实现并自检，报告“实现待独立验收”，不能自行标为已验收，也不让独立编码全部空等。新增自检与独立验收结果分开；不修改产品规范迎合自己的实现。

R3a 任务书与本任务使用相同的并行安排；其接口、算法及不可放宽验收要求保持有效。dsh 不负责自行宣告最终验收通过。

Lead 最终报告：各成员及实际并行范围；真实调用链；新增/修改/删除的生产文件与行数（相对本批基线）；共享契约的变动；剩余旧消费者与删除条件；实际运行的检查及结果；未实现/未验收能力和具体阻碍。可读性、重复实现减少和实际重复读写次数分别说明；没有测量不承诺延迟/费用收益。

完成本任务后交回主 Agent 独立验收，不自动继续实现 R4b/c/p 或 R5/R6；修复本任务的已知失败仍属于本任务范围，不因需要返修而重新设计一套接口。
