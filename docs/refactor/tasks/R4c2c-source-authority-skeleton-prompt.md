# R4c.2c：SourceAuthority 精确事实读取与消费边界骨架

W=/home/hyh001/projects/coding-platform；T=W/coding-platform/next；N=W/docs/refactor。

本阶段只交骨架和行为测试，交主 Agent 中间审核后停止。不要实现业务以求绿，不启动后续 DSH，不安装依赖、不提交、不访问模型网络、不读取凭据。只在 scope 的三个文件原地写入；其余生产代码、公共契约、原工程与 Kernel 均只读。单文件挂载不能 rename。

## 目的与既有实现

任务图、架构图及其工具帮助定位已接受事实，避免各消费者重复扫描和解码。本批只补当前 SourceAuthority 的精确 load 能力，并为既有 Runtime 来源消费者的错误传播与安全访问准备测试。既有 TaskClaim 已产生真实 Run；不能把 provider 缺失当作正式事实不存在，也不能把读出 starting Run 当成已经获得执行或源码读取授权。

按需阅读：

1. W/docs/AGENTS.md、W/coding-platform/AGENTS.md；N/HANDOFF.md、N/IMPLEMENTED-CAPABILITIES.md 的 WG8、WG11、RT4。
2. W/docs/PRODUCT.md §3、§5.4；N/ARCHITECTURE.md 的 WorkGraph/AgentRuntime 边界；N/intent/ORIGINAL-DIALOGUE.md 相关两图、事实与工具原话。
3. T/src/core/work-graph/source-authority-ports.ts（本批冻结契约）。
4. T/src/core/work-graph/materials/{record-ports,record-readers}.ts；T/tests/work-graph/material-readers.test.ts；T/tests/helpers/task-claim-fixture.ts。
5. T/src/core/agent-runtime/source-capture-access.ts、source-binding-types.ts；T/tests/runtime/source-binding-migration.test.ts；T/src/core/workspace/access.ts。
6. N/DSH-WORKFLOW.md、N/DSH-EXECUTION-HARNESS.md 与 W/tools/dsh-refactor/{harness,check}.py。

先报告“需求 → 已有符号 → 最小接线 → 行为测试”，不要另建全局解释文档，不重新做源码总分析。

## 冻结的精确读取边界

在 source-authority-reader.ts 声明并导出：

```ts
createSourceAuthorityReader(deps: SourceSnapshotReadDependencies): SourceSnapshotReads
```

deps.authority 是已经装配的 createMaterialRecordReaders(records).authority。本 factory 不再次创建材料 reader，不接 SQL/文件系统，不建第二份 codec、缓存、Repository、事件索引或新事实库。

- Workspace、Run、QueryRun 复用现有 authority.load，每次最多一次委托、一次已有精确 readMany；不使用候选 lookup、events、全记录扫描或模型。
- ReviewWork、QueryJob 当前没有这个 provider，返回 unsupported，不能查出空值后报告 not_found。QueryRun 的精确读取不等于 Query 整体来源/原发起者链已完成。
- 支持种类的确切缺失保持 not_found；坏 JSON/schema、未交代请求键、存储失败和不可读取状态保持 unavailable。provider 抛出错误时显式 unavailable，不能当作不存在。非法/不可序列化的输入引用不得从宽匹配另一条事实。
- 首个 await 前固定调用方引用；found 必须与请求的完整 ref 对应，不能按局部 runId 取同名跨 scope 记录。返回数据为调用方独立副本，不能修改其他调用或事实源。复用 canonicalJson 和已有读取保证，不复制完整领域 decoder。
- SourceSnapshotReads 只有 load，不添加 events。SourceAuthorityReads 仍组合真实 events，现有 Query origin 兼容路径保留原语义；不得返回假空页使 Query 看似已接通。

**骨架行为：** factory 真实返回仅含 load 的对象，load 暂时返回 unsupported；保留必要的短职责注释和实现落点即可。不要提前实现分支、读取或转换。类型检查必须能通过，新正例因该 unsupported 失败，不允许用加载错误代替红测。

## Runtime 消费者的测试目标（本阶段实现只读）

第二阶段将只改新 reader 和现 source-capture-access.ts。Work 的消费面收窄为 SourceSnapshotReads（等价 Pick<SourceAuthorityReads,'load'>）；需要 Query 原发起者的路径仍要求 SourceAuthorityReads，不能去掉 events 义务。

当前 resolveRoot 将所有非 found 折叠为 not_found，部分资格路径折叠为 forbidden。测试要固定正确区分：unavailable/unsupported 必须映射为 WorkspaceResult 同名拒绝，而非不存在、权限拒绝或允许；实际 not_found 仍按原场景既有语义处理。WorkspaceError 已包含 unsupported，复用现有词表。

当前材料 Run codec 只验证 envelope 是 object|null，并未证明完整权限对象可用。消费点访问 envelope.permissions.tools、writeScope、policyRevision 等实际使用字段之前必须安全核对；损坏对象、错误数组或成员类型返回 unavailable，不能抛 TypeError，也不能扩大权限。这里只需要实际消费字段的窄校验，不复制完整 TaskEnvelope schema。

以下语义必须保持：

- 合法但仍 starting、envelope=null、运行已结束、身份/角色/工作区不匹配或无 read grant，不得获得当前 Runtime 工作源码能力。
- starting/envelope=null 仍可作为正式事实被精确 reader 读出；读取事实和允许工具访问分别验证。
- Host mount、路径策略、prepared root、Run/Reviewer 身份和调用方生命周期原有检查不放宽。此批不创建合法 entered 状态、不改变 Run 状态，不假装完整 prepare/entry 权限生命周期已实现。
- unavailable、unsupported、损坏权限的拒绝路径均不得进入底层文件读取、捕获或源码分析。用现有 Workspace 工具可观察的访问边界验证，不以文件不存在/OS权限失败冒充授权先拒绝。

本阶段 current Work 函数签名仍要求完整 SourceAuthorityReads。若测试需要适配该只读旧签名，可以使用**仅在测试中的 events trap**：被调用即计数并抛错。不能返回空页，不能把 trap 放入生产 reader，不能据此声明 Query 已装配。第二阶段正式收窄签名后清除不必要的测试适配；保留“Work 不读 events”的断言。

## 测试范围与要求

只写 scope 指定的两个新测试文件，既有测试只读：

1. tests/work-graph/R4c-source-authority-reader.test.ts：真实 Memory/SQLite + 既有 material reader。复用 TaskClaim fixture/材料测试的真实注册和精确读取机制，不复制整套 fixture、reader 或 codec。覆盖 Workspace/Run/QueryRun 完整引用隔离、not_found、unsupported 且零委托、损坏/未交代键/存储异常 unavailable、输入与返回副本隔离、无关记录增加不扩大读取数量。故障注入可以包真实 readMany；不能 mock 一个成功端到端结果。
2. tests/runtime/R4c-source-authority-guards.test.ts：使用既有来源工厂/Workspace consumer 验证上述错误分类、坏 permissions 不抛错与零文件 I/O。按真实边界控制故障，不新增测试专用生产钩子。测试准备的数据与注入点必须说明，避免新 reader 的 unsupported 骨架把每个用例都挡在 Workspace 读取之前，从而没有实际触达拟审的 Run 权限检查。

不要重复测试整个 Query 生命周期或全部文件工具。保留原 source-binding-migration.test.ts 的 Work/Reviewer/Query 行为；现有 Query events 仍走原能力。成功路径即使使用可信种子，也是局部读取/守卫证据，不能宣布 Runtime 自动准备授权已完成。

使用主 Agent 冻结的 next-types、next-source-authority 检查入口。若入口尚未登记，报告给主 Agent，不自行改 check.py 或跑任意 runner。报告类型结果、每个红测的实际原因、测试数量、是否有错误路径没有到达目标检查，随后停止等中审。

## 后续实施与集成边界

中审通过后主 Agent 冻结测试和契约，另给实现 scope：仅 source-authority-reader.ts 与 source-capture-access.ts。DSH 不能改测试求绿，也不能扩大到材料 decoder、Kernel 或组合根。实际 factory 装配、真实 consumer 集成、原迁移回归与最终隔离验收由主 Agent 负责；prepare/entry、Query 原发起者索引替换、ReviewWork/QueryJob provider 均不在本批顺带实现。
