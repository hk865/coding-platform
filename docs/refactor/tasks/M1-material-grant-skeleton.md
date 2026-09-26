# M1：正式材料授权与 current 来源接线（骨架阶段）

状态：2026-09-26，主 Agent 已审核本节方向，派发第一阶段。**Stage 1 只交付类型、职责注释、明确 unsupported 的生产骨架和独立行为测试；交付后停止，不能继续生产实现。** 本稿不表示材料链已经完成。本批源码根为 `coding-platform/next`；旧 `coding-platform/src` 只读参考。

## 1. 目标、依据与已核实缺口

先读 [PRODUCT](../../PRODUCT.md)、[原话 DLG-037](../intent/ORIGINAL-DIALOGUE.md#dlg-037-用户)、[WorkGraph 材料规则](../modules/core/work-graph.md)、[Runtime](../modules/core/agent-runtime.md)、[能力索引](../IMPLEMENTED-CAPABILITIES.md)、[B2 执行接线](B2-execution-state-skeleton.md)、[DSH 工作流](../DSH-WORKFLOW.md)。本批补 B2 后续的材料生产/授权接点，不重做 TaskInput、模型循环、Store 或 Workspace 来源算法。

目标：已正式持久的生产者 Run 保存正文，未来任务的已接受 Plan 精确引用该正文；消费者真实 starting Run 经 Host 正式 grant 后，由 Runtime 使用原 `plans.readTaskInput(current)` 读取原文；真实源码变化或 grant 撤销后继续拒绝过期读取。不能用测试 seed grant 或 fake source provider 冒充生产链。

| 原子能力 | 源码事实 | 本批只补什么 |
| --- | --- | --- |
| TaskInput | `tasks/plan-service.ts:readTaskInput` 固定 accepted Plan/task/requirement 的 ArtifactRef，再调用一次 MaterialPort current | 不改选择规则、不允许替换 ArtifactRef |
| 正文及 owner | `materials/material-service.ts:openArtifact` 返回实际 `ownerRunRef`、正文及来源；`applicability.ts:hostAdmission` 允许 scoped Host historical read | 用此能力核真实 owner，不直接读 body Store 绕授权 |
| grant 读 | `materials/record-readers.ts:materialRecordSchemas/createMaterialRecordReaders` 已有 `MaterialAccessGrantSnapshot@1` revision 1/2 与完整 reader 索引 | 新写侧 encoder/事件，复用原 snapshot schema/authority/index |
| 应用规则 | `materials/applicability.ts:createMaterialAccessResolver`、`grantIssuerOwnsMaterial`、`currentBasisValid` | 注入真实 SourceApplicabilityPort，不重写授权/撤销/来源判据 |
| 来源算法 | `workspace/source-applicability.ts:WorkspaceSourceApplicability/materialSourcePinIsCurrent` | 用已有 WorkspaceAccessFactory 管理真实 Host access 生命周期 |
| 真实访问 | `workspace/access.ts:createWorkspaceAccessFactory` 重新 resolveRoot/authorize，并使用 Kernel sandbox/path policy | 不接受模型 root/digest，不另建文件读取栈 |
| 正式写 | next 没有 grant/revoke writer；组合根 resolver 缺第三个 source provider 参数 | 本批补唯一 WorkGraph writer 和主 Agent 组合根装配 |

旧 `src/control/control-engine/material-access.ts`、`material-access-revocation.ts`、`records/material-access.ts`、`contracts/validation/material-access.ts` 可提取适用的 shape、fingerprint、CAS@0/1 和回执构造规则。旧 grant 不查正文 owner、入口不绑定可信 ctx，旧 revoke 不能证明 actor 权限；不得整体搬回旧服务或照搬这些缺口。

## 2. 窄共享接口

复用 next 的 `CoreCallContext/GraphWrite/GoalRef/RunRef/ArtifactRef/MaterialSourceSetV1/MaterialAccessGrantRef/MaterialAccessGrantSnapshot/WriteResult`，不在新文件重复定义它们。

```ts
export interface MaterialGrantPort {
  grantMaterialAccess(ctx: CoreCallContext, request: GraphWrite<{
    goalRef: GoalRef;
    reader: RunRef;
    materials: ArtifactRef[];
    sourceSet: Extract<MaterialSourceSetV1, {kind: 'workspace_paths'}>;
    purpose: string;
  }>): Promise<WriteResult<MaterialAccessGrantSnapshot>>;
  revokeMaterialAccess(ctx: CoreCallContext, request: GraphWrite<{
    grantRef: MaterialAccessGrantRef;
    reason: string;
  }>): Promise<WriteResult<MaterialAccessGrantSnapshot>>;
}
export type MaterialGrantDependencies = {
  records: GoalRecordTransactionPort;
  authority: MaterialAuthorityReads;
  materials: MaterialPort;
  source: SourceApplicabilityPort;
  now(): string;
  eventId(): string;
};
```

首批 **Host-only、current、同项目/工作区/Goal、Run reader 与 Run owner**。ctx.workspaceId 必填；query_run/work_run 调写入口 forbidden。payload 不接受 `issuedBy/actor/grantedAt/grantId/basis/sourcePin/sourceDigest/history/crossWorkspace`，不能忽略它们后悄悄放行。后续 owner Agent 授权、QueryRun、跨域历史仍在产品范围内，明确未实现；本批不缩减既有读侧兼容。

materials 为 1–64 个完整 ArtifactRef，按既有实际材料身份去重，重复返回 invalid；purpose/reason 非空且最多 1024 UTF-8 字节（已核旧 `MATERIAL_ACCESS_PURPOSE_MAX_BYTES`）。sourceSet 按 `validMaterialSourceSet` 验证，仅 workspace_paths，路径有序唯一且 1–64 个；verification_workspace 返回 unsupported，不冒用普通源码 provider。

grantId 由 operation、可信 actor、scope、requestId 稳定派生，不因重试生成另一个授权。`issuedBy` 由服务形成 `{aggregateType:'Control', projectId, goalId}`，表示 WorkGraph 的正式共享决定；不能因为调用者把 issuer 写成 Control 就授予任何权利。

## 3. grant 权限、owner 与来源含义

1. 首个 await 前同步快照输入、ctx principal/materialReader/范围；保留原 signal。Host actor 为真实 human/system 且与 materialReader.actor 完全一致；materialReader scope 与 ctx 完全一致。模型无 Host 写入口，业务 Agent 请求不能改成 system Host。
2. 校验完整 GoalRef、Workspace、reader Run 的正式存在及身份。Goal.workspaceRef、Run.workspaceSnapshot、Run.goalId 均在本次 scope；reader.planRef 指向同 Goal 的已接受且当前 active Plan。reader 可为正式 starting Run，不要求模型先 running/envelope。计划选择与 current 适用分开，不能反过来修改 `readTaskInput` 的历史精确选择语义。
3. 每个材料经既有 MaterialPort，以**原真实 Host ctx**和 `historical_explanation` 实际打开。验证实际返回完整 ref、正文完整性/来源与 ownerRunRef；再沿既有 authority 精确核 owner Run 及同 Goal/工作区。不能相信传入的 owner 或 ArtifactRef.source 自称出处。相同正文可能复用第一次保存的 owner，必须按实际返回 owner 判断，不能按本次 store 调用者推断。
4. owner 缺失、platform_operation、legacy 无正式 Run owner、QueryRun owner、跨 Goal/工作区本批不授权；给出 forbidden/unsupported 的准确原因。Host historical 能读 platform_operation 不代表 current Run grant 支持它。**保留原 `grantIssuerOwnsMaterial` 对 owner=null 的拒绝。**
5. 调真实 source.capture(scope, sourceSet, signal)，要求 sourced 完整合法 pin。provider 缺失/unavailable 拒绝 unavailable；采集中变化或 pin 不能核对拒绝 source_stale；权限/非法参数拒绝 forbidden/invalid。不得用旧 digest、时间戳、同形对象或测试 metadata 当实际来源。
6. basis 由服务构造：`planRef=reader.planRef`、`workspaceRevision=正式 Workspace.revision`、`sourcePin=真实 capture.pin`、`sourceDigest=capture.pin.manifestDigest`。后者明确定义为 M1 授权源集摘要，不冒充某种报告类型的 producer sourceDigest。grantedAt 取服务时钟，不是版本依据。
7. source 读取之后重新核相关正式事实，并把 Goal、Workspace、reader 与 owner 的实际版本加入同一 PreparedCommit guards；不可跨时刻拼接不同 scope。Role/预算/模型许可不由 grant 产生。来源文件与 ledger 不能原子锁定：本批不声称全文件与事务的原子快照，读取时原 resolver 必须继续重新捕获并校验。

**必须保持的含义：** M1 的 grant 是“这个 reader 在这个工作依据下可读取这些精确材料”的正式授权，不是“这些材料描述当前代码的内容为真”。Host historical 打开仅证明旧正文/owner/范围；实时 source pin 仅证明授权核验时的真实选定源集。两者不能合成报告重新验证或证据接受。

因此本批生产正例使用普通工作说明/参考材料作为 TaskInput，并且不产生 Evidence/Task 完成。类型化 verification/架构报告若需要 producer proof 匹配，继续由其生产/选择/验收规则检查；不得新增“写 grant 就给任意旧报告刷新 sourcePin”的业务入口，不改 artifact、Plan、owner、历史 sourceRefs 或完成状态。后续报告消费者不得只看 M1 的 current applicability 就宣布结论仍成立。

## 4. expected、schema、CAS、回执及撤销

- grant `meta.expected` 恰为本 Goal 和 Workspace 的各一个正整数 pin；无重复/无旁支/无跨域。grant 自身 CAS@0 由服务生成。reader/owner 精确版本 guards 来自内部读取，不让 Host/模型伪造。
- revoke expected 恰为 payload.grantRef revision 1。只核可信 Host 和 grant 所属 scope；正式 Goal/Workspace 作用域需成立，但**不得要求 source/Plan/basis 仍 current**，否则过期授权无法撤销。
- 新 grant 写原 `MaterialAccessGrantSnapshot@1` revision 1；revoke 保持 grant 正文不变，CAS@1→revision 2，并附真实 `reason/revokedAt/actor/commandId`。不建第二 grant 表、不改原 reader 索引、不自动 regrant。
- 新编码器复用原 `materialRecordSchemas()` 的 snapshot validator，不重复注册同 schemaId。新增 `MaterialAccessGranted@1`、`MaterialAccessRevoked@1` 事件 validator，保存恢复原回执需要的完整 snapshot、可信 actor 与命令身份；主 Agent 聚合事件注册。
- identityKey 包含操作、scope、可信 actor、requestId；fingerprint 为规范化业务输入及 expected。不同材料/basis 选择/sourceSet/purpose/pin 同 key 返回 idempotency_conflict。sourcePin/时钟为服务结果，不加入请求 fingerprint；相同请求重试不能因为实际来源后来变化而产生新 grant。
- 查原幂等提交并用 `eventAt` 恢复原 snapshot/cursor/replayed，必须早于新 source capture、fresh 状态拒绝和时钟生成。重试 revoke 已 revoked 仍恢复原 receipt；新 request revoke revision 2 则 revision_conflict。grant 后即使已撤销，旧 grant 请求重放返回原创建回执，不代表授权当前仍有效。
- 使用原 records.commit 唯一事务。保证不把 commit 未知当成功、不把已提交后晚取消当未写。提交竞争时只查同 identity 原回执，不能重跑成另一个当前结果。无关全账本水位变化不作为失败门槛。

## 5. 真实来源 provider 与资源生命周期

新增的 `workspace/material-source-provider.ts` 只适配现有算法和 access，不另写扫描/摘要/权限系统：

```ts
export function createMaterialSourceProvider(deps: {
  access: WorkspaceAccessFactory;
  // Trusted Host binding owned by composition, never a model callback.
  contextForScope(scope: MaterialSourceScope, signal: AbortSignal): CoreCallContext;
}): SourceApplicabilityPort;
```

contextForScope 构造配置好的服务 Host 身份，限定真实 project/workspace；返回值仍校验 scope/principal/materialReader/signal 对齐。因为原 `currentBasisValid` 的 SourceApplicabilityPort 不携带 Run ctx，此固定服务身份的读取范围必须由真实 Host bindings 授权，不默认为任意文件根开放。

每次 capture 重新 `access.open(ctx, WorkspaceRef)`，复用 resolveRoot/authorize 和 Kernel sandbox；把实际 access 的 listFiles/read/authorization.allowsRead/sourceIdentity 适配为 ProjectSourceAccess，交现有 WorkspaceSourceApplicability 做两次内容观察。sourceSet 和 scope 同步快照，显式绑定 signal；不缓存上一请求的 access、permissions 或 pin。

`WorkspaceSourceApplicability` 自身不负责 release；外层 try/finally 负责每个成功打开的 access 恰好释放一次，失败/取消/第二次检查失败也释放。读出内容必须保持实际 byteLength/边界，不把截断文本重新 hash 成完整内容。

完成内容观察后再次打开短生命周期 access 复核 root identity、Workspace revision、subjectKey/permissionRevision；不一致返回 stale/unavailable，不发布 sourced。这次检查复用 Host authorize，避免捕获期间权限或 root 换绑仍沿用旧对象；两份资源各自 finally release。该步骤不再次全量读文件，不宣称消除 filesystem TOCTOU；实际使用时原 resolver 再验证。

inventory 截断/不安全路径/超过容量、路径不可读、权限撤回、真实文件添加删除、采集中变化均保留明确失败。缺 provider 不降级为“仅比 metadata”；不从模型接受 root/path sandbox 配置或 pin。主 Agent 将**同一 provider 实例**同时注入 grant service 与 `createMaterialAccessResolver(authority,index,source)`。

## 6. Runtime 与生产消费者接线

Host grant 回执返回既有 snapshot，其中 basis 与 grant ref 可供可信装配消费。B2 后续的 prepare 只从 Host 已核绑定/正式授权事实取得同一 `MaterialReader.currentBasis`，不接受模型 currentBasis。是否将 grant ref 进一步 pin 到 inputBinding，沿 B2 原契约由主 Agent 冻结；不能为了本批另建 RuntimePort 或在模型 prompt 内夹带授权。

验收使用真实 starting consumer Run 调 `plans.readTaskInput(current)`。grant reader 必须与 ctx.runRef、materialReader.requester 相同；currentBasis 必须与正式 grant.basis 一致。继续复用原 reader 的 source/Plan/Workspace/revocation 校验，不以 grant receipt 或成功 capture 替代实际读取。

不改 Host current 分支：它当前明确 source_stale；不改成 historical_explanation 来让 Runtime 通过。Query/跨域/完整历史共享仍是后续任务，不以本批完成为其完成标记。

## 7. 精确拟议 scope 与主 Agent 保留项

DSH Stage 1 新生产骨架仅：

- `src/core/work-graph/materials/grant-contracts.ts`
- `src/core/work-graph/materials/grant-service.ts`
- `src/core/work-graph/materials/grant-record-codecs.ts`
- `src/core/workspace/material-source-provider.ts`

独立测试仅：`tests/work-graph/M1-material-grants.test.ts`、`tests/data/M1-material-source-provider.test.ts`。如需导出既有私有 validator/codec，必须报告具体符号，由主 Agent 开放最小变更；不能复制一整套 reader/validator。

**主 Agent 保留：** composition/create-platform.ts、平台公开导出、schema/event 聚合、关闭排空、check/测试注册、真实 SQLite/TaskInput/B2 集成测试及 currentBasis 装配。Stage 1 DSH 不改 package/scripts/config/Store/MaterialPort/applicability/readTaskInput/B2/Kernel，未授权不新增其他文件。

## 8. 骨架独立测试与后续隔离验收

领域组保留十项独有判据，可参数化；尽量复用已有正式 fixtures 与真实 MaterialPort/Store，不复制整套 B2：

1. 真实 Host+Goal/Workspace+生产/消费 Run，store 原文→grant CAS@0；snapshot/事件/index/实际 owner 对齐，starting reader 合法，无任务完成副作用。
2. actor/materialReader 不一致、模型伪 Host、跨 Goal/workspace、不存在/损坏 Run、伪 reader/issuer/sourcePin/basis 字段拒绝且零 grant 写。
3. 实际读取材料 owner：首作者去重不能冒认；platform_operation/ownerless/QueryRun/跨域按本批边界拒绝。ArtifactRef 正确但正文不存在/损坏不允许创建“可读”grant。
4. scope/sourceSet capture 构造真实 basis；输入 mutation、空/重复/超量 materials、错误 pin/sourceSet、无法核 source 均失败。
5. grant 同请求重放恢复原回执，不再次采集；同 key 改载荷冲突；撤销后原 grant 重放不恢复其有效性。
6. revoke CAS@1→2 保留 grant；精确重放、竞争单成功；已过期 source/Plan 仍可 revoke，不把时间当版本。
7. grant 过程中 Goal/Workspace/reader/owner 并发变化触发局部 guards；取消、提交未知、迟到取消和幂等竞争不谎报结果。
8. 真实 source provider 接 resolver 后，原 MaterialPort current/TaskInput 返回原正文；删除/新增/修改选定文件、basis 不同、撤销授权后 fail closed，非选定文件变化不因全仓 digest 误拒绝。
9. source capture 期间撤销 grant，原 currentBasisValid 最终 canonical 检查必须拒绝；grant 查询索引滞后不能绕过 revocation。
10. sourcePin 不刷新材料/报告的历史 owner/sourceRefs，不产生 Evidence 或验证 verdict；Host historical 成功不得使 Host current 或无 grant Run current 成功。

provider 组覆盖四类：真实临时 workspace 字节/增删/选定范围；Host 权限/root/revision 变化；截断/越界/容量/取消；每次 open 与 release 对账（正常和所有失败出口、连续调用重新授权）。来源正例不能使用返回固定 pin 的 mock。

主 Agent 集成验收另须完成：正式 producer Session/claim/Run 保存实际 body→W1 接未来 task input→consumer claim→Host grant→Runtime 精确 current TaskInput；真实 SQLite 重启保留 grant/revoke；真实文件变化与撤销后拒绝；原 B2/C1 回归和模块边界。Stage 1 不运行模型、不将测试 seed 的 grant/reader 当产品入口已经装配。

中审首先冻结：本批 Host-only Run scope；sourceDigest 的明确含义与报告非验证边界；Runtime currentBasis 正式来源；provider 最后重授权及释放；既有 schema validator 的最小导出方式。骨架与测试合格后由主 Agent 发第二阶段，DSH 才能实现。

## 9. 主审冻结补充

- 本批选定上述 Host-only 同 Goal Run 授权。Runtime currentBasis 继续使用 B2受信Host配置中的 materialBasis：Host从本服务原 grant snapshot取得basis，Runtime不接受模型basis；原resolver逐次重核正式grant/reader/basis/source，所以Host回执本身不替代授权。
- sourceDigest按本文授权源集定义；它不是报告重新验证。没有类型化producer proof的旧报告不能仅凭此成为验证结果。
- schema复用不需要扩大共享writer scope：新codec可从既有 materialRecordSchemas().records 中按固定schemaId取得原validator一次，用于事件内嵌snapshot校验；不复制validator，不将原snapshot重复注册。若真实类型无法表达再报告，不写record-readers.ts（由B2 lane持有）。
- 每次provider生命周期和末次重新authorize按§5执行，Workspace模块仅依赖contracts与本模块，不能倒依赖WorkGraph。ctx构造来自主组合根受信binding。
- 新测试若需共享fixture注入schema，可复用当前 task-claim-fixture，scope外缺口报告主审；不得复制两份账本后把它们当同一事务。所有授权文件已预建，只用Python/Node原地写入，不能新建probe/临时文件或原子rename。
- 骨架返回明确unsupported/unavailable，不能在阶段一提前完成tool adapter/provider等生产算法。测试的唯一正例不能只靠seed grant；正式writer必须是被测消费者。
