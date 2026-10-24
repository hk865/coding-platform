# src/composition：唯一装配根——把受信任配置和各模块 owner 接成可关闭的 TargetPlatform

## 负责什么，不负责什么
- 装配层：可以接各模块并构造服务；只装配/接线，不复制领域规则，不把业务选择写进这里。
- 生产代码唯一构造 `createTargetPlatform` 的地方；Host 只经它拿公开端口，不能另建服务图。
- 不写状态：任何状态迁移只经 `src/core/work-graph/state/`（AGENTS 第 9 条）。
- 不被 `src/core`、`src/business` 反向 import；`src/app` 可以依赖本层。
- 默认值只作显式 seam：不发明 secretary profile、容量上限或 wake driver。

## 文件
- `architecture-reminder-facts.ts` — 当前正式 catalog 版本进观察提醒事实；读失败原样返回，abort 为 cancelled。
- `commit-observer.ts` — 包住共享 `records.commit`，上报真正追加事件的 commit；观察器失败被吞掉。
- `create-platform.ts` — 唯一平台装配：storage/body store、Kernel stores、Workspace、Runtime、WorkGraph owner、Workflow、秘书准备事实端口、提示词包与关闭 drain。
- `session-duty.ts` — 受信任 Session duty 解析：pinned RoleSpec、精确 legacy template、配置的执行者回退；失败为 unknown。
- `tool-commit-lookup.ts` — 按固定 tool 名表把已提交调用查询派给 mailbox/decision/plan/notes/CRR owner。
- `work-line-conversation.ts` — line conversation 分页：按 segment 顺序读原始 Session 历史，链变化为 source_stale。

## 可以复用的能力
| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `createTargetPlatform` | `src/composition/create-platform.ts:693` | 从受信任 `TargetPlatformOptions`（`src/composition/create-platform.ts:232`）构造唯一平台实例：storage、Kernel stores、Workspace、Runtime、WorkGraph owner 与 Workflow | Host、集成测试或直接平台要一组真实 owner 时；不要另建服务图 |
| `createSecretaryPreparationFacts` | `src/core/work-graph/views/secretary-preparation-facts.ts:434` | 秘书请求轮的准备事实端口（一次读齐轮材料、批、早先历史、workspace、架构、治理指针与 Goals）；无可信 Runtime 时不构造 | Runtime 组装请求轮输入；组合根按 `queryExecution` 是否存在决定是否注入 |
| `createSecretaryOpenCapCapacity` | `src/composition/create-platform.ts:655` | 按 `secretaryOpenCap` 统计活跃 secretary Session，到上限拒绝新线 | Host 配置了 cap 时；无 cap 用 business 的 `createAlwaysAdmitCapacity` |
| `createSessionDutyResolver` | `src/composition/session-duty.ts:57` | 从 Session 固定 role 事实解析 platform duty（role_spec 的 `platformDuty`、精确 legacy template、Host binding 回退），读失败返回 `unknown`；经 `sessionDutyResolver`（`src/composition/session-duty.ts:57`）注入；**正本** | Session 资格、profile 资格与容量计数；`src/app/secretary-profiles.ts` 现委托本正本，不要再写 duty/legacy 判断（FP-02、MH-01） |
| `observeRecordCommits` | `src/composition/commit-observer.ts:68` | 包住 `records.commit`，只上报真正追加事件的 commit 的粗粒度聚合 | 变更流或启动观察；观察器失败不得影响写入结果 |
| `createToolCommitLookup` | `src/composition/tool-commit-lookup.ts:37` | 按固定 tool 名表把已提交调用查询派给对应 owner | unknown-call review 的已提交调用查询；不要自己再写 name 到 owner 的分派 |
| `createArchitectureReminderFactsReader` | `src/composition/architecture-reminder-facts.ts:17` | 先读当前正式 catalog 版本，再读观察提醒事实；abort 返回 `cancelled` | 上下文装配器的提醒读取 |
| `createWorkLineConversation` | `src/composition/work-line-conversation.ts:104` | 按 segment 顺序读原始 Session 历史并分页，链变化返回 `source_stale` | `lines/page` 的 conversation 段 |

## 内部用
以下导出只供本层使用：`MAILBOX_COMMIT_LOOKUP_TOOLS`、`DECISION_COMMIT_LOOKUP_TOOLS`、`PLAN_COMMIT_LOOKUP_TOOLS`、`NOTE_COMMIT_LOOKUP_TOOLS`、`COMMAND_RERUN_COMMIT_LOOKUP_TOOLS`。

## 不要做
- `createSessionDutyResolver` 的旧 duty/legacy 判断已删除（`legacyTemplateIsSecretary` 不存在，`src/app/secretary-profiles.ts` 现委托正本）；新代码一律用正本，不要再写 duty/legacy 判断（FP-02、MH-01）。
- `sameJson` 另有旧副本：`src/composition/create-platform.ts:376`（私有），正本在 `src/contracts/fingerprint.ts:50`，新代码一律用正本，旧副本由清理轮删除（M1-32）。
- 不要复制领域规则或状态迁移：状态写入只经 `src/core/work-graph/state/`（AGENTS 第 9 条）。
- 不要另建第二个平台/服务图，也不要把某项业务选择（哪个 owner 做决定）写进装配层。
- 不要绕过 `trackedCall`（`src/composition/create-platform.ts:1232`）发布异步端口；关闭时用同一 drain，detached work 走 `trackDetached`（`src/composition/create-platform.ts:1243`）（MH-07）。
- 不要给未配置 `secretaryOpenCap` 的 Host 发明 secretary 或自造全放行 adapter：无 cap 时 `requestCapacity`（`src/composition/create-platform.ts:2319`）直接走 `createAlwaysAdmitCapacity`（`src/composition/create-platform.ts:2319`），默认 profile 端口是 `defaultSecretaryProfiles`（`src/business/workflow/line-creation.ts:60`）的显式 null（FP-15、MH-02、FP-12、MH-12）。
- 不要假设 wake driver 已存在：`createRequestIntake`（`src/business/workflow/request-intake.ts:177`）的 `wake` 来自平台选项 `requestWake`，没有它就什么都不接，提交的轮留在记录上等 Query 路由或下一个 Host；平台自己不推进任何轮。`requestRounds` 的 `open` 与 `unassigned` 一样经 `trackedCall` 发布，队列按页读、不写状态。
- 请求轮的授权预算只有一处：`createAuthorizeQueryConfiguration`（`src/composition/create-platform.ts:619`）的 `requested` 取 `queryExecutionBindingOf(input.job, input.run).runtimeBudget`（请求轮是认领时冻结的 profile 预算，普通 Query 与旧的 Job intent 相同）；不要在别处再读 Job intent 的执行预算。
- 新增 Host 选项必须声明、校验、转发、重开都走：`secretaryOpenCap`（`src/app/host.ts:164`）校验（`src/composition/create-platform.ts:694`）后进 `createTargetPlatform`（`src/composition/create-platform.ts:694`）到 `secretaryOpenCap`（`src/composition/create-platform.ts:2309`）；`secretaryProfiles` 在 `src/composition/create-platform.ts:694` 声明（FP-15、MH-02）。
