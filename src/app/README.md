# src/app：Host 层——把受信任启动配置装成唯一本地 Host，并提供 HTTP、设置与运行期适配

## 负责什么，不负责什么
- 外层 Host：依赖方向只允许 `src/composition`、`src/contracts` 和 `src/core`/`src/business` 各模块；`scripts/check-boundaries.mjs` 只按模块 owner 判方向，不细化到端口文件。不能开 store，不能被 core/business 反向 import。
- 负责进程外壳：CLI、HTTP/SSE 传输、实例锁、启动 reconcile、Host 设置、提示词包、运行期配置，以及注意力、自动捕获、协作、Goal 扇出和请求驱动（唤醒循环加每 workspace 的两条请求队列）。
- 平台端口：`create-platform.ts` 的 `platform` 对象上的方法都经 `trackedCall`（`src/composition/create-platform.ts:1236`）发布，`close()` 等所有在途调用做完；`secretaryProfiles` 也在发布端口里（`forSession` 是同步查表，`forNewLine` 经 `trackedCall`）。
- 不写状态：任何状态迁移只经 `src/core/work-graph/state/`（AGENTS 第 9 条）；本层只调用平台公开端口。
- 请求体永远不提供 principal、root、token 或凭据；这些只来自受信任的 `options`。
- `src/core`、`src/business` 不得反向 import 本层。

## 文件

### Host 启动与选项
做 Host 装配、CLI、单实例锁和启动对账的去这组。
- `host.ts` — 唯一 Host 装配：配置进 `createTargetPlatform`、实例 token、幂等 `close()` drain、运行期设置扩展，以及请求驱动（持锁且 `requestDriver` 不是 `'off'` 时建 `createWakeLoop` 与 `createRequestRoundQueues`，在启动 reconcile 之后 `start`）。设置里打开并选了模型的目录发布两个运行期 profile：本地工作台在前，平台秘书在后（`local-secretary-query-*`，平台秘书 legacy 模板、只读工具、`platformDuty: 'secretary'`，不带写范围或命令）。已有启动 runtime binding 的 scope 跳过这一步、保持它自己声明的 profile，不会得到本地秘书：它的启动配置必须自己声明秘书 binding **和**对应的 query profile，否则 `requests/submit` 回答 `no_secretary_binding`。
- `main.ts` — CLI：读一份 JSON 配置，启动 loopback Host，只打印不含 token 的地址。
- `host-instance-lease.ts` — SQLite 旁的单实例锁：存活、陈旧、损坏的判定与 takeover。
- `startup-reconcile.ts` — 持锁 Host 启动时的一次 reconcile：分类未决 Run/Query/check/control，重驱 Goal 扇出。
- `core-call-context.ts` — 用启动 actor 加请求 scope 构造 `CoreCallContext`。

### HTTP 路由与服务器
做 loopback HTTP、路由表和 `changes` SSE 的去这组。
- `server.ts` — HTTP/静态外壳：token、同源、JSON/大小限制、SSE，再转发给 `core-routes.ts`。
- `core-routes.ts` — 固定路由表、请求解析、端口绑定和逐 suffix 显式 dispatch。
- `core-http-types.ts` — 从公开端口派生的 HTTP/JSON DTO 与传输常量。
- `change-feed.ts` — 进程内变更通知中心，供 `changes` SSE 与 `Last-Event-ID` 恢复。

### 驱动与观察
做注意力、自动捕获、持续协作和 Goal 扇出的去这组。
- `attention-observer.ts` — 机械注意力：文件行 diff 与图变化，分开维护 delivered/processed 基线。
- `auto-capture-driver.ts` — 自动捕获驱动：每 Host 一个，按 workspace 串行排队，捕获身份用 requestSeq。
- `collaboration-driver.ts` — 持续协作的 Host 活句柄：选 Task、并行 Work/outbox、等回复、stop/pause、read。
- `goal-fan-out-driver.ts` — Goal 级 pause/resume/cancel 对受影响 Run 的幂等扇出。
- `wake-loop.ts` — 请求队列的唤醒循环：按（workspace, queue）合并脏标记，一次一个 pass，`more` 让出事件循环后再跑，整圈无进展即停到下次唤醒，处理器失败 1 秒翻倍退避到 60 秒，commit notice 按项目唤醒两条队列，未武装的 workspace 只认 `request_command`，`close` 中止自己的 `AbortSignal` 并等运行中的 pass。

### 配置与设置
做 Host 设置、模型/工作区配置和运行期热替换的去这组。
- `host-settings.ts` — 设置后端：目录、模型、检查、自动化、资源上限、提示词包；私有快照推送。模型保存走 `models/save` 的 `promptPack` 字段，选模型走 `models/select`。
- `host-settings-types.ts` — Host 本地设置 DTO（请求/响应形状），不构成 Agent 工具或领域写入。
- `runtime-configuration.ts` — 受信任运行期配置进 `RuntimeHostBindings`；懒绑定 provider/secret，按 Host 开关收窄工具。

### 秘书档案与工具
做秘书档案、磁盘提示词包和 Kernel 沙箱适配的去这组。
- `secretary-profiles.ts` — 基于实时 query profile 列表的 `SecretaryProfilePort`。
- `prompt-packs.ts` — 磁盘提示词包：读取/解析链、列表、创建与安全写入目标；按真实路径约束。
- `workbench-tools.ts` — Kernel `WorkspaceSandbox`/`ProcessSandbox` 的唯一 Host 适配器：文件读写、列目录、后台命令。

路由说明：没有独立的“选包”路由；选包是 `models/save` 的 `promptPack` 字段，`models/select` 只选模型。

## 可以复用的能力
| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `createLocalWorkbenchHost` | `src/app/host.ts:423` | 从受信任选项装出一个完整 Host，并持有实例 token 与关闭 drain | CLI 或测试要起真实 Host 时；不要另写一套装配 |
| `createWorkbenchServer` | `src/app/server.ts:187` | 绑 loopback、校验 token/同源、限制 JSON 与体积、结束 SSE，再交给路由层 | 要暴露 Host HTTP 时；传输规则只在这里 |
| `createPlatformCoreRouteBindings` | `src/app/core-routes.ts:657` | 把每个 route 名绑到设计指定的那一个公开端口方法 | 与 `dispatchCoreRoute` 配对；不要动态找方法 |
| `dispatchCoreRoute` | `src/app/core-routes.ts:1096` | 按 suffix 的显式 `switch` 调一个命名端口方法 | 路由已解析、ctx 已由 server 构造后 |
| `parseCoreRouteRequest` | `src/app/core-routes.ts:586` | 解析 `scope` 加 `{input}`/`{request}` 信封，拒绝 ctx/actor/root | 每个 POST 路由入口先解析，再 dispatch |
| `createWorkbenchTools` | `src/app/workbench-tools.ts:283` | 适配 Kernel 文件沙箱与进程沙箱：读写、列目录、后台命令 | 工作台的文件/命令路由；不要直接碰 Kernel sandbox |
| `createWorkbenchRuntimeHostBindings` | `src/app/runtime-configuration.ts:394` | 把受信任运行期配置变成 Kernel `RuntimeHostBindings`，首次解析才读 secret | 构造 Host runtime 时；不要复制 provider 或凭据存储 |
| `validateWorkbenchRuntimeConfiguration` | `src/app/runtime-configuration.ts:285` | 纯校验 binding/profile/grant/budget，重复或错配直接报错 | 装载或替换运行期配置前 |
| `narrowResolvedReadonlyCommands` | `src/app/runtime-configuration.ts:188` | 按 Host `allowReadonlyCommands:false` 收窄每个已解析 binding 的工具 | 通用 binding 解析边界；设置重建也要走 |
| `createSecretaryProfiles` | `src/app/secretary-profiles.ts:50` | Host 的 `SecretaryProfilePort`：`forSession` 只按实时 profile 列表匹配 workspace 与完整 `sessionRole`（`sameJson`），不做 duty 判定；`forNewLine` 调真正的 duty resolver | Host 在 `src/app/secretary-profiles.ts:50` 构造并作为 `secretaryProfiles` 选项注入（`src/app/secretary-profiles.ts:50`）；duty 正本是 `createSessionDutyResolver`（`src/composition/session-duty.ts:57`），不要另写判断 |
| `createSessionDutyResolver` | `src/composition/session-duty.ts:57` | **正本**：受信任 duty 解析；RoleSpec 的 `platformDuty` 与精确 legacy 模板任一侧可定，缺证据才回退 Work binding 的 `sessionRole`，否则 `unknown` | admission、secretary 判定都调它；本层 `forNewLine` 经它，不要另写 duty 判断 |
| `sameJson` | `src/contracts/fingerprint.ts:50` | **正本**：按规范 JSON 做与键序无关的相等比较；不能编码的值永不相等 | 比较完整 `sessionRole` 等结构时；不要另写比较 |
| `createWorkspaceAccessFactory` | `src/core/workspace/access.ts:83` | **正本**（路径校验这一层的入口）：经 Host 绑定的 root realpath 与当前授权开工作区读访问 | 判断工作区路径是否可读/在根内时；不要用本层 `isPathWithin` 当通用校验 |
| `createHostSettings` | `src/app/host-settings.ts:470` | 读写 Host 本地设置：目录、模型、检查、自动化、资源上限、提示词包，并推送私有快照 | Host 启动或设置路由；凭据只写不读 |
| `createHostRuntimeResolverRegistry` | `src/app/host-settings.ts:248` | 保存当前 `RuntimeHostBindings` 并安装新的不可变版本 | 设置变更要热替换运行期版本时 |
| `createAttentionObserver` | `src/app/attention-observer.ts:428` | 机械注意力观察器：真实文本 diff、合流、重复抑制与 processed 确认 | Host 注意力循环；不要按语义预筛或调模型 |
| `createAttentionScanner` | `src/app/attention-observer.ts:616` | 把工作区与图状态扫成一份 `AttentionSnapshot` | 注意力心跳读取当前事实时 |
| `createAutoCaptureDriver` | `src/app/auto-capture-driver.ts:81` | 每 Host 一个自动捕获驱动：一次一个 workspace，请求记录先写 | Host 启动自动捕获时；失败写 failAutoCapture，取消不写 |
| `createChangeFeed` | `src/app/change-feed.ts:87` | 汇总 commit 与 Host 句柄变更，保留窗口并回答 SSE 恢复 | `changes` 长连接；notice 只带粗粒度类型与 project |
| `createCollaborationDriver` | `src/app/collaboration-driver.ts:313` | 持续协作的活句柄：Task 选择、Work/outbox 并发、等回复、stop/pause、read | Host 的持续通信；不拥有 store，只组合既有 owner |
| `createGoalFanOutDriver` | `src/app/goal-fan-out-driver.ts:201` | Goal 控制提交后，对每个受影响 Run 提交幂等 fan-out 控制并观察未知结果 | Goal pause/resume/cancel 与启动重驱；不要重复提交 intent |
| `createWakeLoop` | `src/app/wake-loop.ts:131` | 两条请求队列的唤醒循环：合并脏标记、一次一个 pass、`more` 让出后重跑、失败退避、commit notice 配对、未武装与 `close` | Host 的请求队列驱动；`driving` 传租约是否持有，别在别处另写合并或退避 |
| `acquireHostInstanceLease` | `src/app/host-instance-lease.ts:113` | 取得/释放 SQLite 旁的单 Host 锁，处理陈旧锁与 takeover | 建平台之前；没持锁的 Host 只做读与 owner 写 |
| `runStartupReconcile` | `src/app/startup-reconcile.ts:262` | 持锁启动时把未决 Run/Query/check/control 分类、结清、重驱 | 每次 Host 启动、开新 workspace 时；不重跑 Kernel Turn |
| `createHostCoreCallContext` | `src/app/core-call-context.ts:17` | 只用启动 actor 与已解析 scope 构造 `CoreCallContext` | server 进入路由前；永远不接受请求体 principal |
| `readDiskPromptPack` | `src/app/prompt-packs.ts:260` | 从磁盘读一个包及其 extends 链并解析；`platform` 是虚拟包 | 设置/提示词路由读取包时 |
| `createDiskPromptPackSource` | `src/app/prompt-packs.ts:314` | 把磁盘目录暴露成 `PromptPackSourcePort` | 平台装配要注入提示词包来源时 |
| `preparePackWriteTarget` | `src/app/prompt-packs.ts:420` | 校验包内路径与真实路径包含关系，返回安全写入目标 | 保存模板/工具文本前；不覆盖不同内容 |
| `createDiskPromptPack` | `src/app/prompt-packs.ts:473` | 以 platform 包为父创建一个空子包 | 新建用户提示词包时；调用方先校验 id |
| `listDiskPromptPacks` | `src/app/prompt-packs.ts:335` | 生成 `prompts/packs/list`：platform 在前，其余按 id | 设置页列出提示词包时 |
| `parseWorkbenchCliConfig` | `src/app/main.ts:72` | 把可序列化 CLI 文件纯转换成本地 Host 选项 | CLI 与测试复用同一份配置转换 |
| `runWorkbenchCli` | `src/app/main.ts:196` | 读配置、启动 loopback Host、返回退出码 | `main` 入口；token 不落盘、不打印 |

## 内部用
以下导出只供本层（含 Host 内部与测试）使用，不应成为其他层的依赖：`lineDelta`、`validateAttentionConfig`、`withinAttentionScope`、`graphChangedElements`、`graphChanges`、`attentionSignalToJson`、`AUTO_CAPTURE_ACTOR`、`changeKindOf`、`CoreRouteRejectionError`、`CORE_ROUTE_SPECS`、`parseChangeStreamResume`、`SETTINGS_API_PREFIX`、`SETTINGS_ROUTE_SUFFIXES`、`isSettingsRoute`、`validateSettingsBaseUrl`、`HOST_INSTANCE_LOCK_FILE`、`localWorkbenchGrant`、`readonlyCommandsDisabledScopes`、`HOST_RECONCILE_ACTOR`、`emptyStartupReport`、`WORKBENCH_CLI_USAGE`、`loadWorkbenchCliConfig`、`isPromptPackId`、`isPathWithin`、`effectiveTemplateVersionOf`、`effectiveToolTextOf`、`settingsModelSecretVariable`、`runtimeModelId`、`sameRoleConfiguration`、`PLATFORM_TOKEN_HEADER`、`PLATFORM_TOKEN_PLACEHOLDER`、`WORKBENCH_PATH`、`CORE_API_PREFIX`、`BOOTSTRAP_SUFFIX`、`CHANGES_SUFFIX`、`LAST_EVENT_ID_HEADER`、`LOCAL_WORKBENCH_TEMPLATE_ID`、`LOCAL_WORKBENCH_TEMPLATE_REVISION`、`LOCAL_WORKBENCH_GUIDANCE`、`LOCAL_WORKBENCH_ROLE`、`LOCAL_WORKBENCH_ROLE_BINDING`、`LOCAL_WORKBENCH_HOST_TEMPLATE`、`LOCAL_WORKBENCH_BUDGET`。

## 不要做
- 不要在 Host 里实现领域规则、直接读写 RecordStore 或另建服务图；只调用 composition 暴露的公开端口。
- 不要从 HTTP body 取 root、token、凭据或 store 路径；ctx 只由 `createHostCoreCallContext`（`src/app/core-call-context.ts:17`）构造。
- 不要发布绕过 `trackedCall`（`src/composition/create-platform.ts:1236`）的异步 Host 端口：平台端口（含 `secretaryProfiles`）都经它发布，`close()` 等在途调用做完；没 drain 的调用会落在已关闭的 store 上（MH-07）。
- 路径校验不要混用：`isPathWithin`（`src/app/prompt-packs.ts:31`）是真实路径包含判断（`preparePackWriteTarget` 也用它），不是词法副本；源相对路径的词法规则用 `isSafeSourceRelativePath`（`src/core/workspace/path-validation.ts:3`）。
- 不要另写 duty 判定：用 `createSessionDutyResolver`（`src/composition/session-duty.ts:57`）；`forSession` 只按 workspace 与完整 `sessionRole` 查 profile，不做 duty 判断（FP-02、MH-01）。
- 不要只改 Host 选项的类型或消费端：声明、校验、转发、adapter 构造与重开路径都要接上（FP-15、MH-02）。
- 不要假设未配置的 secretary/cap/wake 有默认实现：默认 profile 返回 null、无 cap 全放行、`wake` 为 no-op；真实行为必须显式配置（FP-12、MH-12）。
- 请求驱动只在持实例锁且 `requestDriver` 不是 `'off'` 时装配：`'off'` 时既不建唤醒循环也不建请求队列，提交的轮停在命令留下的地方，等 Query 路由或下一个开着驱动的 Host；测试用手工步骤推进轮时必须用它。请求命令的 wake（平台选项 `requestWake`）和 commit notice 都经晚绑定 sink 进循环，循环从不影响 commit；队列的 `context` 用 Host 的系统 reconcile actor，drain 的 `AbortSignal` 由循环传入。
