# B2 / C1 / M1：平台组合根接线实施

状态：2026-09-26，供主审定稿后派发 DSH 第二阶段。相关端口、组件骨架及下列五条组合红测已经中审；本任务只实现既有能力的组合根装配，不补写业务算法。主审须先将已验收的 Runtime 实现和所需依赖刷新到隔离快照。该前提不满足时报告具体缺失，不以修改组件或伪造结果使组合测试通过。

## 1. 范围与阅读

唯一生产写范围，相对 `coding-platform/next`：

- `src/composition/create-platform.ts`

测试、Runtime、WorkGraph、Workspace、RecordStore、共享契约、Kernel、依赖、配置与任务文档均只读。不要新增文件、修改测试断言、变更端口形状或绕开 harness。需要扩大范围时报告精确符号和原因，由主审处理后再施工。

先读 `docs/AGENTS.md`、`docs/refactor/IMPLEMENTED-CAPABILITIES.md`、`docs/refactor/DSH-WORKFLOW.md`，再沿真实源码核对：

- `src/composition/create-platform.ts` 当前 Store、Session、历史与 close 装配。
- `src/core/agent-runtime/{execution-contracts,runtime,execution-preparation,execution-driver,execution-observation,session-operations,kernel-store-locator}.ts`。
- `src/core/work-graph/tasks/{execution-entry-contracts,execution-entry-service,model-call-contracts,model-call-service,execution-history-service}.ts`。
- `src/core/work-graph/materials/{contracts,record-readers,applicability,material-service,grant-contracts,grant-service,grant-record-codecs,material-facts-service}.ts`。
- `src/core/workspace/{access,material-source-provider,source-applicability}.ts`。
- `src/core/work-graph/communication/{contracts,mailbox-service,message-record-codecs}.ts`。
- `src/core/work-graph/source-authority-reader.ts`、`src/core/agent-runtime/{source-capture-access,communication-tools,observed-model-run}.ts`。
- 下列两个冻结组合测试及其真实 fixture。fixture 的 Host double 仅供理解测试，不是生产权限算法模板。

`TargetPlatformOptions.runtime?: RuntimeHostBindings` 已在第一阶段声明，但当前组合根未消费该字段；声明存在不表示新增生产执行已装配。本批把经过主审的 Runtime 服务接入这个既有 Host 入口，不另加调用者可提供的 client、root、permission、hook 或数据库入口。

## 2. Store 注册必须单一

在现有 schemas 的 records / events / lookups 三个数组中追加对应组件注册：

- `EXECUTION_ENTRY_RECORD_SCHEMAS`，来自 `work-graph/persistence/execution-entry-codecs.ts`。
- `MODEL_REQUEST_RECORD_SCHEMAS`，来自 `work-graph/persistence/model-request-codecs.ts`。
- `SESSION_MESSAGE_RECORD_SCHEMAS`，来自 `work-graph/communication/message-record-codecs.ts`。
- `MATERIAL_GRANT_EVENT_SCHEMAS`，来自 `work-graph/materials/grant-record-codecs.ts`，仅追加 events。

保留原有 `EXECUTION_HISTORY_RECORD_SCHEMAS.events` 及所有原注册。当前 entry schemas 是 events-only；model schemas 以真实导出为准。不要重复注册 Run、TaskAttempt、Claim、WorkspaceLease：这些仍由原 owner codecs 负责。MaterialAccessGrant snapshot 与候选 lookup 已由 `materialRecordSchemas()` 注册，不再加第二份。`SESSION_MESSAGE_RECORD_SCHEMAS.lookups` 已包含 `SESSION_MESSAGE_LOOKUP_INDEXES`，不能同时再追加一次。

所有服务使用本平台的同一个 `backend.records`。不得新开逻辑账本、用内存 registry 代替 SQLite 正式状态，或通过未注册 decoder 绕过 schema。

## 3. 材料与来源：同一可信 provider

将 `createWorkspaceAccessFactory(options.workspace)` 的构造提前，使材料 reader/writer 可共享真正的 Workspace 来源能力。创建一个 `createMaterialSourceProvider({access, contextForScope})` 实例。

`contextForScope(scope, signal)` 由组合根构造可信 Host 上下文：

- projectId / workspaceId 精确取本次 scope；
- principal 使用组合根固定的 system actor，不能来自 model JSON 或材料请求的额外字段；
- materialReader 为同 scope、同 actor 的 host reader；
- signal 必须保持传入的原 AbortSignal，不能用新 controller 丢失取消。

该固定内部 actor 也可供 mailbox 的内部正文操作使用，但不能代替业务命令的原 actor/sender。真正的 Host `options.workspace.authorize` 仍决定此服务身份是否有权读文件；不得内置 always-allow、吞掉拒绝或把完整 workspace 读权默认授予 system actor。

唯一 provider 同时传给：

1. `createMaterialAccessResolver(reads.authority, reads.index, source)`；普通 `createMaterialService` 继续使用这个 resolver、同一 bodies 与 authority。
2. `createMaterialGrantService({records:backend.records, authority:reads.authority, materials:rawMaterials, source, now, eventId})`。

公开 `materials` 保留原 `storeArtifact/openArtifact`，并增加真实 `grantMaterialAccess/revokeMaterialAccess`。不要把 grant 的 source pin 缓存成未来 current 的免检凭证；普通 read resolver 必须每次经同一个 provider 重新观察来源。source provider 自己管理每次 access 的释放；组合根不提前 release 它正在使用的 access。

M2 的预留装配位置是同一 `reads.authority/index`、bodies、source、now 上的 `createMaterialReadFactsService`。本批 B2 deps 尚未扩展，不把 facts 塞进类型断言或借裸 bodies 伪接；不将一个未被消费的实例当作材料事务准入已经完成。

## 4. C1 与 B2 构造

C1 使用 `createSessionMailbox`，注入同一 backend、raw sessionDirectory、executionReader、roleService、raw materials、固定 systemActor、now 和 newId。公开 `messages` 的 sendMessage、readMessage、readMessageBody、readInbox、ackMessage、respondMessage 六方法均转到这个真实实例。不得通过提前写 SessionMessage 种子实现收信，也不得把正文另存于平台内存。

B2 在 `options.runtime` 存在时：

- 用真实 `createExecutionEntryService` 与 `createModelCallService`，共用 backend、executionReader、roleService、planService、raw materials、bodies、可信 authorizeConfiguration、now 与 ID 生成器；保持各 factory 的现有参数约束。
- `createAgentRuntime(deps)` 使用 raw claimService、executionReader、entry、historyWriter、modelRequests、roleService、planService、sessionDirectory、raw materials、bodies、现有 executionHistory / graphHistory / sessionOperations / kernelStores，以及 `options.workspace`、`options.runtime`、现有 Kernel public-api、now / newId。
- `sourceAuthority` 复用 `createSourceAuthorityReader({authority:reads.authority})`，只提供已有的正式 snapshot 能力；不以假空 events 冒充 Query authority。
- 不改变原 Session 创建、历史读取和 graph history 的真实装配。没有 `options.runtime` 时使用既有无依赖 Runtime 的明确 unsupported 执行行为，原 createSession/readSessionHistory/readExecutionHistory/readTaskExecutionHistory 仍正常工作，只受既有 Kernel Store 配置要求约束。不能因为缺模型 Host 配置而令整个平台初始化失败。

### 可信 Host 投影

`authorizeConfiguration` 必须重新解析正式 Run roleBinding 的当前 Role，并以真实 RunRef、正式 Session role、Role resolution 调用同一个 `options.runtime.resolveConfiguration`。失败保持原语义。不得把 input 原样回显当作批准。

校验当前 Host configurationRevision 与待核的版本一致；Host template 必须由当前配置产生并与正式 Session / Role 状态相容，resolved Role 不伪造 legacy template，absent Role 需要明确版本化 Host template。不得复制 fixture 的固定 builder 名称、版本或摘要。

Runtime preparation 会把 Host tools 与 Role 许可求交集；Host 比 Role 更宽是合法的收窄。禁止用“Host 原始 tools 数组等于 Prepared tools 数组”作为准入前提。投影应核验待执行 permissions 确实受当前 Host grant 允许，再按既有 Role 约束和正式 Run policyRevision 返回经核实的值。返回值仍须满足 WorkGraph 的配置/permissions/template 精确一致检查。tools、writeScope 不能因为调用者提交了某值就成为权限；也不能省略 Host 当前撤权校验。复用现有语义，不在组合根复制 Role authority、预算累计、历史归约或模型许可算法。遇到缺少可复用 helper 的确切歧义向主审报告。

## 5. close 与资源所有权

复用现有 `trackedCall`，在进入异步流程前同步调用实际 service，保留服务自己的首 await 前输入快照。所有本批新增公开操作必须纳入 pending：Runtime prepareExecution/startRun/observeRun、messages 六方法、materials grant/revoke。materials 原有 store/open 也应覆盖，因为新公共材料链会跨 ledger / bodies / source I/O。

关闭后新公开调用返回明确 unavailable；已进入的调用继续完整结束，不能中途因为 close 而失去其内部依赖。为此 Runtime、mailbox、grant、plan 等内部依赖使用 raw service，不回指公开的 tracked wrapper。最外层操作 tracked 一次；不要让在途 grant 在 source gate 释放后又通过已关闭的 public materials 被拒。

close 保持幂等，并按以下顺序：设置 closing 门禁；等待已进入操作全部 settled；关闭 workspace tools；finally 关闭 bodies；finally 关闭 backend。不要关闭数据库后才等待 provider 或正式结果提交，不使用无依据的延时等待。失败操作同样必须从 pending 移除。

`KernelStoreRegistry.withStore/withLegacyReader` 已在每次调用 finally 关闭自己打开的 SqliteStores。没有 registry.close 方法，不发明长期 Kernel connection 或第二 close 管理器。现有初始化失败清理保持；新增 owned resource 如需额外生命周期须先核现有 API，不让清理错误覆盖初始化原错误。

capabilities 保持诚实：不要因一次 Run 可执行就把 continuation、完整 recovery、cancel、safe-point pause、native compaction 或 scoped workspace writes 标成支持。现有 flags 对应各自完整能力；如修改 reason，准确描述仍缺的能力，不能改测试强迫虚报。

## 6. 冻结的五条组合测试与验收深度

`tests/composition/B2-runtime-platform.test.ts`：

1. 正式 claim → prepare → start → 原 Kernel 模型调用 → 正式 ended，SQLite 重开后 observe 同一历史且不再次调用 provider。
2. 实际 provider 悬停期间 close 必须等待；释放 provider 后正式结果完成，数据库才关闭，重开可读原 Run。

`tests/composition/C1-M1-platform.test.ts`：

3. 平台创建真实 Kernel Session，Host 正式发信、读正文，重开恢复原 send receipt，消息操作不篡改 Session。
4. 正式 producer / W1 adoption / consumer：无 grant 拒绝、真实 source grant 后 current 成功、文件变化 source_stale、恢复文件可读、撤权拒绝、重开 revoke 原回执与历史正文保留。
5. grant 在真实 Workspace authorize 悬停时 close 排空；closing 后新 grant 拒绝；放行旧 grant 后完成提交；重开恢复原 receipt 且不重新 capture，再能读 current 正文。

第五条新增测试位于第 196 行，冻结时该文件 SHA-256：`8dd27348269aaa516043878b0383010d1eea077629136e8357237e9796624a43`。快照使用主审最终下发版本；不得自行改测试以匹配实现。

中审基线：next-types 通过，五条均红。B2 两条仅到 prepare unsupported；C1 到缺 messages 入口；M1 两条到缺 grant writer 入口。后段 source、close、冷启动断言当时尚未运行，不得将其描述为已验证。实施必须真正推进并通过完整断言。

按 harness 暴露入口执行 `python3 tools/dsh-refactor/check.py next-types` 与 `python3 tools/dsh-refactor/check.py next-b2-composition`。主审负责刷新快照和隔离验收，不创建依赖 symlink、不安装替代 Kernel。交付仅该生产文件的修改与实际检查结果；说明失败深度或未决项，然后停止等待主审。

## 7. 本批三个明确未接范围

1. **M1 → M2 → B2 外部材料事务准入**：当前 entry 的 `externalMaterialsProblem` 仍对非空 selectedTaskInputs/additionalMaterialRefs 返回 unsupported；B2 dependencies 尚无 materialFacts。后续需主审冻结 deps、准入与 guards 合并 scope，保留正式 Plan/Goal 校验、plans.readTaskInput 和 same exact ref 的 facts/current 读取。此批不删除占位或降级为无 grant CAS 的 openArtifact。
2. **Runtime frozen source policy**：当前平台无可信 `sourcePolicyFor` 配置入口，本批不新增。Runtime 首次请求相应 frozen source 工具时缺配置应保持明确 unsupported/既有失败，不从 M1 provider 推导 Runtime 权限，不默认源码全可读，不用模型路径构造可信 mount。Workspace 已有受 Host 控制的其他能力仍按原契约工作。
3. **正式 Runtime → C1 Agent 工具**：Runtime deps / driver 尚未接 mailbox 的 coordinationTools。此批只公开真实平台 mailbox；不声称模型已经能发信、读 inbox 或响应。后续需冻结可信 Run/Session context 与 ToolCall requestId 绑定，再复用 `createSessionMailboxTools` 接 `runObservedModel.coordinationTools`。现有 Host 收信测试不替代该链的验收。

上述限制必须在交付中保留，不能以五条组合测试通过推断全部消费者或产品生命周期完成。
