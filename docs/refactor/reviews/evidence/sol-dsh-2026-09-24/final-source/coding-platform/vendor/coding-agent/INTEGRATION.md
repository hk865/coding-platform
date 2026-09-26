# 平台内置 Coding Agent

用户于 2026-09-07 决定将 coding-agent 直接复制纳入平台目录。本目录保存执行内核源码，与平台一起由外层 Git 仓库管理。平台继续负责跨 Run 的规划、调度与事实归约；内核通过既有公共 API/CLI 处理单次 Run。

本地纳入依据是上述用户明确委托及 UPSTREAM 固定的本地工程来源，不是某个外部项目的开源许可证授权。导入清单没有内核整体的 LICENSE/NOTICE，当前也没有整体 license 声明；不据此推断所有权或补造 MIT 授权。本轮只验证已授权的本地集成，未进行外部分发。单独借鉴或移植的第三方单位保留各自精确来源和许可，例如平台记忆规则的 `src/contracts/notices/`；依赖包许可由各自锁定的包声明提供。

## 来源与更新

导入来源、commit、源工作区未提交改动、逐文件 SHA-256 和本地适配记录见 [UPSTREAM.json](UPSTREAM.json)。本次使用源工作区实际内容，包含三份未提交的开发文档；该清单描述导入时快照，后续修改通过平台 Git diff 追踪。

更新内核时先比较来源版本、当前平台内修改和待导入版本，再合并所需差异并更新来源记录。原 coding-agent 目录是来源仓库，平台内核源码和依赖均从本目录加载。

纳入范围包括源码、测试、场景和基准任务、资源、配置、依赖锁文件和工程文档。Git 历史、node_modules、dist、.tooling、日志及历史运行结果没有复制；已跟踪的 recovery-exactly-once 测试用 .env 夹具随任务保留，用户 API 密钥未读取或复制。

## 安装与构建

使用 package.json 指定范围内的 Node.js，并安装 npm 和 pnpm。在平台根目录执行：

```sh
pnpm kernel:install
pnpm kernel:build
```

这两个入口分别在本目录按 package-lock.json 安装依赖和构建 dist/app/cli/main.js。平台保留 pnpm 锁文件，内核保留自己的 npm 锁文件；导入时未合并两套依赖或改动内核业务代码。当前平台 `build` 已按根 package.json 顺序执行内核构建、平台 TypeScript、UI 资源复制和 UI 构建，最终验证必须使用这一完整产物链。

Node/npm、bubblewrap 等是运行环境工具，不作为源码副本复制。需要 Shell 隔离的实测须在环境阶段核对可用性并显式配置 CODING_AGENT_BWRAP_PATH（如未正常安装）；源码纳入和本地模型夹具通过不代表隔离或真实模型验收完成。

## 当前接入边界

平台 tests/integration/real-kernel/replay-server.ts 默认按自身位置解析本目录，AGENT_PLATFORM_KERNEL_ROOT 仅用于显式覆盖。P1-15/P1-16 的既有集成测试使用这个副本的真实 CLI 和本地模型响应夹具。

GUI 的真实运行与查询接线仍属于 RAT-02 后续工作；本次复制不改变 GUI 的测试适配器模式。逐阶段执行依用户要求，在当前阶段汇报后等待下一阶段确认。

后续实现或调试按 [AGENTS.md](AGENTS.md) 查阅本副本的当前工程文档；平台权威位置见 [项目位置说明](/mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform/dev_docs/agent/project-location.md)。

## RAT-02 宿主接入增量（2026-09-07）

本次只修改平台副本的 `src/app/composition/composition-root.ts` 与 `src/sandbox/process/process-sandbox.ts`，原来源仓库未改动；`UPSTREAM.json` 的导入摘要保留为历史来源，不改写成当前已修改源码的摘要。

`RunAppInput` 新增可选 `limits`、`workspaceOptions`、`processSandboxOptions`，由宿主显式传入；默认 CLI 行为保持不变。ProcessSandbox 新增可选 `readOnlyPaths`（工作区根下的真实目录名，拒绝路径穿越及符号链接）和 `executablePath`。平台仅用 `.platform-runtime` 预置受信 Node 并只读挂载；原默认凭据保护继续优先，无宿主路径自由挂载能力。

平台 `runtime.tokenBudget` 继续表示上下文容量；累计用量由独立 RuntimeBudget/ModelBudget 及内核 RunLimits 控制。原始导入核对与当前接入源码摘要需分别阅读；证据为平台 `evidence/rat-02/` 和权威 `dev_docs/verification/rat-02-evidence.md`。

## Context 与只读分析工具接入增量（2026-09-08）

当前平台 GUI 已使用真实内核；上方最初纳入边界是导入时历史，不代表当前接线状态。原来源仓库和 UPSTREAM.json 的导入指纹保留不动，本次平台副本差异由外层工作树及本轮证据指纹追踪。

公共组合入口和恢复组合入口新增可选 additionalTools 工厂，在注册表冻结前注册宿主工具；重复名称仍被拒绝，未显式启用的工具不进入当前请求。public-api 导出 toolSchema，供宿主使用相同 Zod schema 构造工具定义。DefaultPermissionPolicy 仅允许宿主已注册且同时满足 read_only、仅 workspace_read 能力的扩展；凭据、隐藏路径和未知操作限制继续优先，不能通过自报只读为未知写入或进程能力授权。

WorkspaceSandbox 新增 listFiles(maxEntries, {prefix, signal})，逐层通过目录句柄读取实际可见文件，拒绝符号链接、路径穿越和拒绝目录，限制条目/深度并报告截断；它不依赖只包含未提交变化的 Git 快照。单个目录的 readdir/sort 尚不是硬内存限制。平台在此能力上实现 list_files/search/symbols；普通 coding 模式维持 read/edit/shell。Python 符号分析只将源码通过 stdin 交给固定标准库 AST 程序，不执行被分析项目代码。

新 Run 的 ContextBundle 核验和选材在平台 runtime-context 中完成，内核继续只负责一次 Run 的实际消息和工具循环。不能据此声称完整跨 Run 记忆或自动审阅已接通。验证与文件指纹见 [本轮修复总记录](/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-08-product-wiring-repair/README.md)。

## 语义反馈Context容量适配（2026-09-11）

平台普通Run的完整角色材料和反馈协议可超过16 KiB。组合入口之前把完整模型输入直接作为EmptyMemoryProvider的辅助查询，触发memoryRecallRequestSchema字节上限，使合法模型Context在首次模型调用前失败。当前仅对辅助召回query按UTF-8完整字符限于既有MAX_MEMORY_QUERY_BYTES；传入模型的input.input保留完整，原模型容量及累计预算、权限守卫均不改变，也未启用长期记忆提供者。原来源仓库和UPSTREAM.json保持原导入身份。

真实HTTP/SQLite/内核的角色规格运行测试同时核对Context超过16 KiB且完整用户消息实际到达本地模型替身。该适配与失败诊断证据位于平台evidence/2026-09-11-semantic-loop，不将空记忆提供者计为长期记忆功能完成。

## 协调工具能力声明（2026-09-13）

平台第 3 步要求模型经宿主窄 Adapter 发起协调通信（请求 / 报告 / 订阅 / all-wait / 取消）。
这些工具会修改**平台状态**（登记请求、报告、订阅、等待），既不是 workspace 读操作，也不该
被自报成只读来换取放行——按上面 2026-09-08 的边界（DefaultPermissionPolicy 只允许
read_only 且仅 workspace_read 能力的宿主扩展），它们无法被诚实声明。

本次只改平台内副本，来源仓库未改动，`UPSTREAM.json` 的导入身份保持原样：

- `src/policy/permissions/permission-policy.ts`：`PermissionPolicyConfig` 新增
  `hostAuthorizedTools`，并在最终 `unknown_operation` 拒绝之前增加一条分支
  （`operation.effectClass !== "read_only" && this.#hostAuthorizedTools.has(operation.tool)`
  → `allow`，reasonCode `host_authorized_tool`）。
- `src/app/composition/composition-root.ts` 与 `resume-composition.ts`：`RunAppInput` /
  `ResumeAppInput` 新增可选 `hostAuthorizedTools`；组合根只采纳"本轮确实注册过、
  且 effectClass 不是 read_only"的扩展工具名（授权名单里写内置工具名或未注册的名字不产生权限）。

边界不变：凭据/隐藏路径检查、内置 read/check/edit/shell 的既有规则、未授权的未知操作默认拒绝
全部继续优先；协调能力**不等于**文件写入或 shell 权限。宿主侧的使用与声明见平台
`src/execution/worker-runtime/coordination-tools.ts`（effectClass `workspace_write`、
requiredCapabilities 为空、independentReadOnly false、平台自有标记 `platformEffect:
'coordination_state'`）与 `observed-model-run.ts`（注入 `hostAuthorizedTools`）；未授权即被拒的
反例见 `tests/integration/m3-tools.test.ts` 的"宿主扩展工具必须显式授权"用例。

平台侧另有**执行前准入**（协议约束 2.3 的"宿主必须明确授权"落地在平台，而不是靠 effectClass）：
`src/control/dispatch-engine/coordination-capability.ts` 从 canonical 事实（该 Run 发起的参与关系 /
接续受理记录）解析出**独立的协调能力** `capability: 'coordination'` 及其依据；只有 `granted` 才会
把访问面交给运行入口（类型上"只注入工具、不带授予"不可表达），并把授予写进该 Run 的运行记录供审计。
平台用例：`tests/coordination/coordination-capability.test.ts`（未授予 → 无工具、调用被拒、平台状态零改动；
授予 → 可用并记录依据）。

**已知的词表缺口与裁决（owner 2026-09-13）**：内核 `ToolEffectClass` 只有 read_only /
workspace_write / process，没有"平台状态写入"这一档；本工具以平台自有的 `platformEffect:
'coordination_state'` 如实标注。**内核的放行判据只有宿主 `hostAuthorizedTools` 一条**
（`permission-policy.ts` 的 `effectClass !== 'read_only' && hostAuthorizedTools.has(tool)`），
因此**不新增 effectClass**——新增一个取值既不改变准入强度，又需再动三个内核文件并重建 dist。
现状（`workspace_write` + `requiredCapabilities: []` + `independentReadOnly: false` +
`platformEffect`）为最终方案。

## 结构化最终报告的系统提示适配（2026-09-14）

真实独立 Reviewer 在显式32768容量下完成生成，但最终JSON前的说明文字导致正式report_json拒绝。版本化基础提示从coding-agent-v3升级v4：工具前中间进度保留，用户请求结构化最终格式时将总结、证据与限制放在该格式字段内，禁止在最终消息外附加散文。普通Coding默认表达方式不变；权限、报告校验和来源清单不变。原来源仓库未修改。失败及复验见平台evidence/collaboration-memory/batch/integration/coding-goal-real-05.log及后续记录。

同轮v4真实复验仍被工具后固定开场要求影响，v5进一步把该进度句限定为确有下一工具批次的消息；JSON最终报告不附加进度句。v4失败保留于coding-goal-real-06.log，不以v4构建通过替代真实报告通过。

## 独立 Reviewer 的显式 JSON 传输（2026-09-14）

v5真实报告仍有JSON外散文，CM-I01-REVIEWER-JSON-001在平台副本 ModelRequest 增加可选 responseFormat=json_object 请求，DeepSeek 映射 response_format，OpenAI Responses 映射 text.format。宿主只对独立 Reviewer 显式开启，在 ModelBudget 与 ModelCallPermit 的请求摘要之前加入实际字段；普通 Coding/Query、thinking、调用数和累计预算不变。报告原文不截取、不修复，空报告、截断与非法报告仍拒绝。来源仓库及 UPSTREAM.json 导入指纹不改，真实失败05/06/07保留；定向证据见平台 evidence/collaboration-memory/batch/integration/reviewer-json/，真实复验由根 Agent记录。

## R4a Kernel 公共扩展（2026-09-23）

本次只改平台内副本（原来源仓库与 UPSTREAM.json 导入身份不动），实现
`docs/refactor/modules/core/agent-runtime.md` §6 的冻结契约。

- 新增导出（`src/public-api.ts`）：`kernelSessionApiVersion = 2`、`SessionContextMode`、
  `ExecutionIdentity`；定义在新增的 `src/app/composition/composition-contracts.ts`
  （该文件只放共享类型，避免两个组合根互相 import 形成循环依赖）。`HookPort` 沿用既有导出。
- 新增可选字段：`RunAppInput.sessionContext / executionIdentity / controlHooks`；
  `ResumeAppInput.controlHooks / limits / workspaceOptions / processSandboxOptions`。
  缺省时 `sessionContext=current_turn`、身份仍随机生成、`limits/沙箱`仍按 config 派生，旧 CLI 语义不变。
- 语义：`session_history.throughPosition` 只接受「已终止轮次的稳定边界」，由
  `src/core/ports/session_store/session-history.ts` 校验位置属于该 Session、逐 Turn 用既有
  reducer 还原 transcript（保留 tool-call/result 配对），缺失结果/损坏记录/当前 Turn 混入一律显式拒绝。
  `turn.started` 与 checkpoint 持久化 `contextBasis{version:1,mode:'session_history',throughPosition}`，
  resume 只按该边界重建，不改成「最新历史」，也不创建新身份；前缀与当前 Turn 合并后只做一次
  `selectContext` 预算选择。同一 `executionIdentity` + 相同内容进入恢复/回放、不追加第二个
  `turn.started`；内容不同报 `idempotency_conflict`。旧 `schemaVersion=1`（无 `contextBasis`）记录
  按旧正文校验 checksum 后照常读取，未知版本报 `version_unsupported`（不改写旧记录）。
- 验证（全部本地替身，无付费模型）：`npm run build`、`npm run typecheck`、
  `npm run check:architecture`（67 files passed）、`npx vitest run`（43 files / 190 passed / 1 skipped，
  含默认 CLI 回归 `tests/e2e/m5-cli-child.test.ts`）。新增
  `tests/integration/kernel-session-api.test.ts`（11 例，真实 SQLite + 组合入口 + 脚本化模型替身：
  两轮历史进入真实请求、工具配对、重启边界不漂移、重复身份、越界/缺口拒绝、旧记录兼容、
  单次预算选择、pause 落盘后 ack 与 resume 保留沙箱/预算）与 `tests/unit/session-history.test.ts`（8 例）。
  `npm run lint` 仍报 5 个 `import()` 类型注解错误，逐行与 `git show HEAD:` 原文一致，属既有问题，
  本次未新增 lint 错误；仓库整体 `format:check` 的既有未格式化文件同样未由本次改动引入。
- 未接通（如实返回，不伪造）：`after_tool` 暂停不支持——`controlHooks` 传 `after_tool` 抛
  `ControlHookUnsupportedError`，`RuntimeRunner` 的 after_tool pause 仍落 `run.failed`
  (`after_tool_pause_unsupported`)；控制 Hook 只能 `continue`/`pause`（block/modify/fail 报 unsupported）；
  模型/工具调用进行中没有暂停入口，只能 AbortSignal 取消，不存在调用中的 pause ack；
  native compact 仍未实现，`selectContext` 仅是预算选材。paused Run 的 resume 原只沿用调用方传入的
  `limits`（原配置核对只覆盖继续执行的 Run）——该限制已由下一节的恢复有效约束核对取代。

## R4a 恢复身份与有效约束补全（2026-09-23 dsh 返修）

同一 R4a 批次内补齐 K1/K2：执行身份决定恢复目标，暂停恢复前核对原有效约束。仍只改平台内
副本，来源仓库与 `UPSTREAM.json` 导入身份不动。

- 精确 Turn 选择：唯一算法是 `RecoveryCoordinator` 的命名导出纯函数
  `selectRecoveryTurnRecords(records, target)`；`RecoveryCoordinator.recover(sessionId, options,
  environment?, target?)` 直接使用它，`app/composition/recovery-contract.ts` 的
  `selectRecoveryTurn` 薄委托同一函数（Core 不反向 import app）。`target=null` 保持旧 CLI 的
  「最新 Turn」；`{runId, turnId}` 必须同时匹配，返回范围止于下一条 `turn.started`，不读入
  后续 Turn 的事件、checkpoint 或返回值。`runCodingAgent` 命中已存在 `executionIdentity` 时经
  内部入口 `resumeCodingAgentInternal(input, target)` 传递该目标；公开 `resumeCodingAgent`
  签名不变、无目标仍是「最新 Turn」。terminal 重放零模型调用、零新记录。
- 暂停恢复的原环境核对：`recover` 收到 `environment`（生产恢复组合根总是传）时，paused 必须
  与 `willContinue` 一样在**任何对账写入与任何继续动作之前**核对原配置与完整 workspace 引用
  （identity / reference / revision 全部相等），不存在为旧用例放宽的 revision 例外；等值原环境
  照常恢复。暂停期间 workspace 普通文件被修改（包括与 SQLite 同目录的普通文件）会改变 revision
  并在恢复前 `StoreError('conflict')`，不会续跑模型。未传 `environment` 的既有直接调用只做投影、
  不执行 runner，保持原检查用法。
- SQLite 存储与 workspace revision：`resolveRecoveryWorkspaceOptions(workspaceRoot, databasePath,
  options?)`（`app/composition/recovery-contract.ts`）是 run/resume 共用的纯机械 helper，在创建
  `WorkspaceSandbox` 之前调用。它按 `path.resolve/relative` 计算配置的 `storage.databasePath`
  相对 `workspaceRoot` 的位置，**仅当数据库严格位于 root 内且不是 root 本身**时，把数据库文件及
  其 `-wal` / `-shm` / `-journal` 四个精确相对路径追加到 `snapshotIgnoredPrefixes`；root 之外不
  新增任何忽略项。缺省沿用 `WorkspaceSandbox` 导出的 `DEFAULT_WORKSPACE_SNAPSHOT_IGNORED_PREFIXES`，
  调用方显式传入的 `snapshotIgnoredPrefixes` 原样保留（+ 去重），不改变调用方覆盖默认值的语义；
  其余 options 与 `consistencyMode` 的 config 装配顺序不变。
  被排除的只是内核自身持续写入的存储文件，**不改变 read/write 权限**，也不忽略父目录或整个 `data`
  目录：同一目录下的普通文件仍进入快照并参与恢复前的 revision 核对。解析结果经
  `WorkspaceSandbox.snapshotIgnoredPrefixes` getter 进入新 turn/checkpoint 的
  `recoveryConstraints`，因此 run 与 resume 的实际生效 ignore 值一致；旧记录没有该字段时继续执行
  仍按「无原约束证据」拒绝，旧 terminal 日志与无字段旧 checkpoint 继续可读。
- 有效约束持久化：`turn.started.payload.recoveryConstraints` 与 checkpoint 正文新增可选字段
  （strict schema，`version=1`），保存解析后的实际生效值：`limits`、实际
  `deniedPrefixes` / `snapshotIgnoredPrefixes` / `consistencyMode` / `maxFileBytes`、
  `ProcessSandbox.effectiveOptions` 的规范化保护路径 / 只读路径 / 执行路径，以及经注册与
  effectClass 过滤后的 `hostAuthorizedTools`。组合层不复制沙箱默认常量，直接读
  `WorkspaceSandbox.maxFileBytes` 与 `ProcessSandbox.effectiveOptions` getter；不写入 secret/API key。
- 旧记录兼容：`schemaVersion=1` 无该字段的记录与 checkpoint 仍按原正文校验 checksum、照常读取
  与 terminal 回放，不改写历史正文；未知 `version` 显式 `version_unsupported`。旧记录在需要
  继续执行（`start_run` / `continue_before_model` / `continue_before_tools` / paused 恢复）时
  一律 `StoreError('conflict')`：没有可证明的原预算与沙箱证据不放行，也没有
  `legacyDefaultProven` 之类的布尔捷径。
- checkpoint 与原约束的一致性：`#selectCheckpoint` 只把 checkpoint 当作加速层，`turn.started`
  才是权威。新 checkpoint 带 `recoveryConstraints` 时用同一 `parseEffectiveRecoveryConstraints`
  解析并与 Turn 原约束逐值比较；不一致、未知 version 或 Turn 无对应证据时，按既有坏 checkpoint
  机制跳过该候选、继续尝试更早候选或从正式事件回放（不会用缓存状态覆盖 Turn 事实）。旧
  checkpoint 缺该字段保持兼容，不要求补写或重写正文。
- 核对时机与放宽判定：`requireEffectiveRecoveryConstraints({recorded, supplied})` 由恢复组合注入
  `RecoveryEnvironment.assertEffectiveConstraints`，Core 在**任何对账写入与任何继续动作之前**
  调用，paused 恢复同样覆盖。它只证明「不放宽」：提高预算、丢失 denied prefix、减少
  只读/保护路径、改变 executable path、新增宿主授权或降低 consistency mode 判为放宽并拒绝；
  等值必然通过，只会收紧的差异可由本函数返回 `supplied`。
  **但这不等于原配置兼容**：真正执行前还有独立的 `#assertCompatibleEnvironment` 原配置核对
  （`RunConfigSnapshot` 全量相等，含 `limits`；workspace identity/reference 相等），因此改变
  `limits` 或其他原 config（即使数值更小）仍可能被 `StoreError('conflict')` 拒绝。宿主恢复
  时应回传原 config 与原 limits，而不是只依赖「更紧就安全」的推断。
  已用计数与旧 deadline 由 `RunState`/limits 继续生效，不清零；checkpoint 只加速，不取代
  `turn.started` 证据。
- 未覆盖（如实返回）：本段不实现 `after_tool` 暂停、block/modify/fail 控制 Hook、native compact；
  直接调用 `RecoveryCoordinator.recover` 且不注入 `assertEffectiveConstraints` 的既有路径沿用旧
  行为，生产恢复组合始终注入。
