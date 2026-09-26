# C2：正式 Runtime 的通信、白板与职责资源消费者接线

状态：2026-09-26，Astra 只读审计后的待主审草案。本文只提出接口、失败语义、拟议 scope 和测试；未冻结、未实现。执行顺序：Astra 接口审阅 → DSH 骨架与测试停止 → Astra 中审冻结 → DSH 实现 → 独立验收。目标为 `coding-platform/next`。

当前校验与测试遵循[真实生命周期可达性](../CODE-QUALITY-GUIDELINES.md#21-校验须与操作后果匹配2026-09-26)，不新增 Session 运行中更换 Role 的反例或防御。

## 1. 产品范围与前置组件

依据：[PRODUCT](../../PRODUCT.md)、[AgentRuntime](../modules/core/agent-runtime.md)、[WorkGraph](../modules/core/work-graph.md)、[完整实施路径](../IMPLEMENTATION-PLAN.md)、[用户并行/白板纠偏](../intent/2026-09-23-PARALLEL-AND-PRODUCT.md)、[施工时序](../intent/2026-09-24-DSH-HARNESS.md)。本批接通已经授权的正式 Run → 真实 Kernel 工具轮次 → C1 邮箱/W2 白板 → WorkGraph 正式事实；同一执行配置装配已有秘书、参谋、书记 Skill。原授权内操作不重复请求人工批准。

秘书、参谋、书记仍是可组合 Role/Skill 职责，使用现有 Session、Run 和同一模型循环，不新增永久 Agent 身份、平台工具总管、ContextManager、SkillManager 或调度服务。通信不自动唤醒接收者、不创建等待/义务、不自动 ack；白板继续 W1/W2 的 future-only 规则，不借本批实现 Task completion、运行中取消、自动派发或新的规划成熟度系统。未来基础意图入口依赖[独立任务](W2-future-intent-skeleton.md)，不在此重复改 Task/Plan schema。

B2 Runtime、M1/M2、B2 材料消费和 B2/C1/M1 组合根已在 main；W2 委托领域以 `w2-agent-whiteboard-implementation-20260926` lane 接口审计，须经主审验收合入后再派发本批骨架。当前组合根尚未注入 `materialFacts`、`delegatedWrites`，这两处真实消费者缺口纳入本批同一个 `create-platform.ts` 写范围，不另开服务。lane 存在不等于已合入；骨架测试必须在这些真实前置可执行的快照上建立，不能把上游 unsupported 提前返回当作本批测试覆盖。

## 2. 已有生产者、消费者与实际缺口

下表路径相对 `next/src`，行号为本次审计定位，派发前按合入快照复核。

| 位置 | 已有行为 | 本批工作 |
| --- | --- | --- |
| `core/agent-runtime/execution-contracts.ts:139` | deps 的 plans 只有 `readTaskInput`，无 messages | 沿原依赖扩展，不造另一执行接口 |
| `core/agent-runtime/execution-driver.ts` | 正式 entered、模型准入和原历史；传 `allowedTools:manifest.permissions.tools`，未传 coordinationTools | 将已核许可分成内置工具与平台工具，在同一次 `runObservedModel` 注入现有 factory |
| `core/agent-runtime/observed-model-run.ts:185–227` | readOnly 限制内置工具；现有 coordinationTools.names/create → enabledNames/additionalTools/hostAuthorizedTools | 原样复用，不把平台写解释成文件写，也不另起 Kernel loop |
| `core/agent-runtime/communication-tools.ts:38,169` | 六个严格 schema、固定 Session、真实 callId 回调；目前只读定义 capabilities 为空 | 只读声明采用已工作的 W2 public seam；保留成功输出兼容，补结构化领域拒绝 |
| `core/agent-runtime/whiteboard-tools.ts:403` | 四工具，read_only 使用 `['workspace_read']`，固定 Goal、typed 结果；已有真实 Kernel 轮次测试 | 直接装配，不重写工具或 W1 编译器 |
| `core/work-graph/communication/mailbox-service.ts:385,433` | 稳定身份读取后先查 receipt；新写核 Run/Role/Session/Lease/V2 entered，带局部 guards | 新写补同一 fresh Host 配置复核；历史身份读取去掉无关 Plan/Attempt/Lease 依赖 |
| `core/work-graph/tasks/execution-entry-service.ts` | `readStoredManifest`、`recheckHostRoleAdmission` 复用正式正文、RoleFacts、可信 Host 授权 | C1 和 W2 同用，不在 Runtime hook 复制权限算法 |
| W2 `plan-write-admission.ts` 与 `plan-service.ts` | 委托身份、receipt-first、新写当前许可、W1 单事务编译/CAS | 作为本批前置复用，不抢其源码写权 |
| `composition/create-platform.ts`、`materials/material-facts-service.ts` | 同一 `reads/source/bodies` 已供普通材料 reader、M1 grant writer 使用；B2 deps 尚缺 M2 facts | 用原 `createMaterialReadFactsService` 装配 `materialFacts`，由同一 entry deps 供 entry/model 四个 fresh barrier 使用 |
| `composition/create-platform.ts`、W2 lane `tasks/plan-service.ts` | 唯一 Plan service 尚未获 `delegatedWrites`；W2 类型仅取四个既有依赖 | 前移 WG11 reader 与可选 Host 授权回调，构建唯一带委托许可的 Plan 实例；不造第二 Plan service |
| `next/resources/skills/platform-{secretary,adviser,scribe}` | 真实清单与正文，现有 FileSkillLoader 消费 | 可信 Host 配置把已有根和启用集合交给正式 Runtime |

### 2.1 Kernel 权限审计结论

本次已读 `vendor/coding-agent/dist/app/composition/composition-root.js:61–112`、`tools/registry/tool-registry.js`、`tools/dispatcher/tool-dispatcher.js:30–76` 和 `policy/permissions/permission-policy.js`，resume composition 也使用同一规则：

1. `ToolRegistry.freeze(enabledNames)` 产生实际可调用清单；模型 tool specs 来自该快照，未启用名字不能 resolve。
2. `registeredReadOnlyTools` 只从已启用定义选出 `effectClass=read_only` 且 capabilities 恰为 workspace_read 的工具。
3. Dispatcher 从实际注册定义取得 effectClass/capabilities，模型参数不能覆盖；内置 read/check/edit/shell 的规则先于扩展授权。
4. `hostAuthorizedTools` 只接受实际注册的非只读扩展名字，不授予内置文件/进程工具。

因此这里的 `workspace_read` 是既有只读扩展注册标签；为 C1 只读工具填写该标签不会自行把 builtin read 或探索工具加入 enabledNames。现有实现未显示由该标签造成权限扩大。C1 空 capabilities 反而让合法 query 在 Kernel permission 阶段被拒绝，无法到达真实领域 reader。采用 W2 相同声明即可；**本批默认没有 Kernel/vendor 写 scope**。只有真实未授权名字/路径被执行，或合法 query 无法到 handler 的可复现反例，才申请必要的 Kernel 修订，不能为了名称语义增建授权管理层。

## 3. 最小接口与固定调用身份

保留 `RuntimeExecutionPort`、`SessionMailboxPort`、`PlanTaskPort` 的公开操作。拟议依赖变更：

```ts
// RuntimeExecutionDependencies：替换原 plans 的窄 Pick，追加 messages。
plans: PlanTaskPort;
messages?: SessionMailboxPort;

// SessionMailboxDependencies：新增内部准入依赖，类型来自 WorkGraph。
runtimeAdmission?: Pick<ExecutionEntryDependencies,
  'bodies' | 'authorizeConfiguration'>;
```

`messages` 可选只为了维持未使用通信工具的 Runtime 调用者；若正式 grant 选择了任一通信工具而依赖缺失，fresh start 在 provider 调用和 authorize/begin 前返回 `unsupported`，不静默忽略、不假工具成功。已 begun/entered/settled 的 start 重放先沿已有观察恢复，不因当前缺 messages 或工具目录变化拒绝。plans 使用同一个现有服务实例；full port 是既有 W2 factory 的实际依赖类型，不是新增权限；当前 B2 fixture 已传完整服务，无需补假方法。Runtime 不直接 import Store 实现，WorkGraph 不 import Runtime。

`runtimeAdmission` 的**拟议失败契约须主审中审冻结**：缺少该依赖时，Host 操作、合法历史读取和原 receipt 恢复仍按原契约运行；新的 work_run 写明确 `unsupported`，不能落回仅凭 envelope 的较弱授权。生产组合根必须配置它。此变化要求旧 C1 领域夹具存入真正的 prepared manifest 和真实 Host binding，不能通过恒真 resolver 使旧伪 digest 继续通过。字段可选是源码兼容，不表示运行时默认授权。

driver 从已经核验的 `TaskExecutionRecord` 与持久 manifest 构造一个固定的工具上下文，不能直接把调用 startRun 的 Host ctx 传给 Agent 工具：

- project/workspace 来自实际 Run/Session 的已验证关联；`principal={kind:'work_run',runRef:record.run.ref,roleBinding:record.run.roleBinding}`。
- `materialReader={kind:'run',requester:record.run.ref}`，确有已验证 current basis 才沿现有字段传入，不生成替代 basis。
- mailbox 的 `sessionRef=record.session.ref`；whiteboard 的 `goalRef` 来自正式 Run.task；原 AbortSignal 与 Kernel 每次调用 signal 按现有 adapter 规则传递。
- 在首 await 前隔离可变上下文/配置。Session/Run/Role/Goal、requestId、权限、provenance 都不能成为模型参数；模型可按 C1 schema 指定目标收件 Session，但不能改 sender。
- `requestIdForCall` 使用真正 `ToolCall.callId` 和 `call.name`，在完整 RunRef、SessionRef 命名空间内 canonical hash：`c2-tool:` + `sha256Hex(canonicalJson({runRef,sessionRef,operation:call.name,callId:call.callId}))`。空 callId 拒绝；同 call 重试稳定；不同 Run 的相同 callId 不同身份。不能使用随机数、参数哈希或 startRun.requestId 代替 callId。

工厂仍用已有 `{names,create(workspace)}` 形状；两工厂的合并和过滤留在 driver 一个私有小函数即可，不增公开 ToolProvider/Registry/Manager。

### 3.1 组合根的共享实例与构建顺序（M2/W2）

按已合入 [`create-platform.ts`](../../../coding-platform/next/src/composition/create-platform.ts)、[`MaterialReadFactsDependencies`](../../../coding-platform/next/src/core/work-graph/materials/material-facts-service.ts)、[`ExecutionEntryDependencies`](../../../coding-platform/next/src/core/work-graph/tasks/execution-entry-contracts.ts) 和 W2 lane `PlanDelegatedWriteDependencies` 冻结以下内部接线；不增公开 platform 方法或配置 DTO。

```ts
// 已有同一个 backend / bodies / access / source / reads：继续复用。
const materialFacts = createMaterialReadFactsService({
  authority: reads.authority, index: reads.index, bodies,
  sourceApplicability: source, now,
});
// 将现有两项构建前移至唯一 planService 之前；各只构建一次。
const executionReader = createRunStateReader({ records: backend.records });
const authorizeConfiguration = options.runtime === undefined
  ? undefined : createAuthorizeConfiguration(options.runtime, roleService);
const planService = createPlanService({
  records: backend.records, materials: rawMaterials, now, eventId: randomUUID,
  ...(authorizeConfiguration === undefined ? {} : {
    delegatedWrites: {
      reads: executionReader, roles: roleService, bodies, authorizeConfiguration,
    },
  }),
});
// 既有 mailbox：C2 新字段也使用同一回调及正文库。
// runtimeAdmission: authorizeConfiguration === undefined
//   ? undefined : { bodies, authorizeConfiguration }
// 有 runtime 时同一 entryDependencies 加 materialFacts，分别创建 entry / modelRequests。
// 同一 Runtime deps 传 plans: planService、messages: mailbox。
```

实际顺序为：backend/bodies → 同一 access/source/reads → rawMaterials、M1 grantService 与 M2 facts → roleService、executionReader、可选 authorizeConfiguration → **唯一** planService → claim/session/history 等原实例及 mailbox → entry/modelRequests → Runtime → 原公开 tracked wrappers。只移动有依赖约束的声明，保留其余独立服务的现有顺序；不重建已产生的 Plan/Run、backend、MaterialPort、source provider 或 Role service。W2 四项依赖不含 Plan service/entry/modelRequests，所以不需要延迟 setter、可变 service holder 或循环引用。C1/W2/B2 共用该 `authorizeConfiguration` 函数，不在组合根各复制一套准入算法。

M2 的实例只观察当前调用实际读取的授权记录。它按既有实现在调用内部复用 resolver/material-service 并收集局部 guards，这不要求组合根再创建第二套持久材料服务；不把 guards/source pin 缓存在 Runtime 或跨 barrier 使用。`materialFacts` 只注入现有 B2 entry/model 依赖，不能给 Runtime 再加新 facts 接口或把白板 query/write 套进模型材料/预算准入。M1 grant、普通 `rawMaterials` 和 M2 必须持有**同一** `source`，M2 参数名是 `sourceApplicability`，不能漏传后让 current 读取只剩 metadata 判断。source 每次 capture/release 沿既有 provider 生命周期；M2 无独立 close，既有外层 Runtime/Plan/消息操作排空后再关 workspace、bodies、backend。

`options.runtime` 缺失时不创建默认 Host 回调，也不伪造 `delegatedWrites` 或 C1 runtimeAdmission：原 Host Plan/消息、材料 grant/read、普通查询和历史能力仍可用，新的 Agent 委托写沿组件既有缺依赖拒绝。对已有 Runtime 的配置，Plan、entry/model、C1 必须都得到同一真实 Host 绑定。公开 tracked `plans/materials/messages` 不回注内部；已经进入的外层调用仍使用 raw 实例直到结束。

材料输入仍由现有 `ResolvedRuntimeConfiguration.materialBasis` 提供。可信 Host 将正式 grant 的原 basis 绑定到完整 consumer RunRef，prepare 由真实 `plans.readTaskInput` 选择本 Task 的 requirement，随后 B2 四个 fresh barrier 从该 Run 构造自己的 current reader。组合根不自动选最新 grant、不改写原 basis、不以 Host 历史读取代替 Agent current；没有材料的 Run 保持原兼容路径。具体成员关系、正文及 grant CAS 规则复用 [B2 材料实施](B2-material-facts-implementation.md)，不在 C2 再实现。

## 4. 工具名过滤与职责资源

以正式 manifest 的有效 tools 为选择集合，它已由 Host/Role/Task 交集产生且 start fresh 复核。目录常量仅用于识别名字，不是 grant。

1. 内置组只含已允许的 `read/write/shell`，继续用 `allowedTools`；read 派生探索组仍遵循现有 Host 路径授权，未授 read 时不得因平台 query 顺带打开 source factory 或 builtin read。
2. C1 六名和 W2 四名分别按上述有效集合过滤。只注册过滤后的 definitions，coordinationTools.names 与实际 definitions 一一对应；校验重复名和内置/探索/material 名冲突。未知选中工具或选中但缺依赖在 start 早期明确 `unsupported`；工厂产物错配属于装配失败，provider 调用必须为零。
3. `readOnly` 继续表达文件 writeScope，保持 `writeScope.length===0` 的现有含义。拥有 send/apply 等平台写权限且无文件写权限的 Run 仍 readOnly=true，通过 coordinationTools 调用领域 writer；不得为了让工具运行设成 false。
4. 当有效工具只有平台工具时，不调用源码 read 的初始 authorization/assertCurrent，也不打开 source factory；Kernel 所需可信 root/Session mount 定位继续保留。只有真正启用文件/源码能力的分支才安装对应授权和路径检查，既有 builtin read/write/shell 限制不放宽。
5. 不对每个 query 装一个完整 `admitEnteredRun`/ModelCallAccess。下一模型调用仍走 B2 模型预算/材料/Role/Host 准入；工具操作的适用授权由实际领域 owner 负责。

Host 的 `ResolvedRuntimeConfiguration.skills` 与 `systemInstruction` 原字段足够：使用可信应用资源根 `next/resources/skills` 和显式 enabledIds，Role 职责选择由实际 Host 配置产生。模型不能选择根/路径/启用集合；roleId 文字本身不授予工具。空 enabledIds 保持为空，缺根/缺已启用资源明确失败，不能退回另一套默认 Skill。

现有 FileSkillLoader 只有一个 resourceRoot。沿 [W2 冻结方向](W2-agent-whiteboard-skeleton.md#83-工具签名资源与精确派发-scope)：应用根提供三个职责 Skill，可信静态 systemInstruction 复用既有 coding-safety 正文/规范；不复制改写 vendor 资源，不伪造多根 loader。具体读取/组合仍由既有 Host 配置装配处承担，Runtime 只透传并真实验证模型请求。Host 必须将可变资源配置变化反映到 configurationRevision；不能声称现有 manifest 已持久绑定 Skill 文件摘要或跨文件系统提供原子快照。部署资源按配置版本保持稳定，真实 loader 解析结果进入本次请求。准备后变更配置版本沿 B2 拒绝 stale prepared；不为本批添加全局资源租约。

## 5. 领域许可与回执边界

### 5.1 C1 新写补 fresh Host，复用既有守卫

send/ack/respond 保持顺序：隔离与结构校验 → 正式稳定身份 → lookup 原 identity/fingerprint receipt → 未命中才读取 fresh execution 并检查当前许可 → 单次正式 commit。当前已实现的 Run running/nonterminal、V2 entered、Session occupancy/generation、Lease holder/attempt/release、envelope operation tool、消息目标/正文/CAS 规则继续由 mailbox writer 承担。

新写从同一正式 Run 的 bundleRef 调 `readStoredManifest`，用 `recheckHostRoleAdmission` 核 manifest Role、Session Role、完整 permissions、hostTemplate、hostConfigurationRevision。使用已有 deps.roles 和新增 runtimeAdmission，不复制 parser/resolver、不只比 roleId、也不把 absent Role 当无条件放行。absence 仅在 B2 的精确 legacy Host template 兼容路径可用。`readStoredManifest` 仅负责正文完整性、类型、Run owner 和结构，`recheckHostRoleAdmission` 仅负责当前 Role/Host 许可；两者不会替调用方核对执行关联。C1 在领域层对同一 fresh WG11 快照核 manifest.claim 与 outbox.claim、manifest.inputDigest 与正式 Run.inputBinding/authorization.inputDigest、envelope 的 bundle/digest/Run/Attempt/Plan/role/permissions 关系，复用现有完整引用比较，不新增另一份正文 parser。稳定身份阶段和 fresh 阶段须比较同一完整 RunRef、SessionRef、roleBinding、claim generation 与 workspace；不得把旧 sender/identity 和另一份 fresh guards 混合提交。

fresh Host/Role helper 替换原有的单独 operation Role 解析，不叠加第二次相同解析。操作工具许可直接从这次经核实的有效权限中检查；使用同次返回的 RoleFacts guards。当前 RoleFacts guards 与 Run/Session/Lease 及实际依赖的 claim/outbox/Attempt 版本纳入同一 mailbox commit；同 key 不同期望版本拒绝 conflict，不取最大版本。fresh helper 读取后发生 Role、Session、Run 绑定或持有权变化必须与写事务竞争；不加全 ledgerHorizon、不因无关目标写入失败。W2 已有同一模式，直接复用其契约，不在 C2 修改 Plan 编译规则。

fresh 失败且同请求可能并发提交时，最后再查同 identity/fingerprint 原 receipt 恢复已发生结果。原 replay 不因当前 Host 撤权、Run 结束或 Lease 释放而被改判为新操作；不同请求或变更 payload 不复用该 receipt。**不得在 before_tool 先统一 current-grant 检查，从而遮住领域 receipt-first 语义。** Kernel 当前已取消、未分发的调用不能据此保证仍调用领域；这里保证的是进入领域后的幂等语义。

外部 Host callback 与 Store 无跨系统原子性。正式 Run 绑定撤销用持久 CAS 与新写竞争；外部配置变化后的新操作重新核对。Host 要中止既有运行权限的控制路径应先撤销持久绑定再改外部配置，这是 R4 接点，不要求 C2 先实现完整控制 writer 或新的全局配置租约。

### 5.2 普通读取及历史身份的最小精简

现 `readWorkRunFacts → WG11` 正常执行三次定向 `readMany`，最终读取 Run、outbox、Session、Plan、Attempt、Lease。消息读取/原 receipt 只需证明原 Run/roleBinding 与原 claim Session/workspace；无关 Plan/Attempt 缺失或故障会阻塞历史消息，即使发送/收件事实仍完整。不能因为 principal 自报可信就跳过正式身份，也不能把所有历史查询变成完整执行准入。

拟在 mailbox-service 内增加私有历史 identity loader：按精确 RunRef 定位原 Run，再定位其 outbox.claim Session；最终只重读并验证 Run/outbox/Session 的一致快照，核完整 RunRef、RoleBinding、claim/attempt 引用一致、Session/workspace、reader/requester。复用现有 outbox/session codecs 和现有 Run schema 校验；`run-state-service.ts` 的私有 `decodeRun` 可窄导出为内部共享 decoder，禁止另写宽松 Run parser或新增公开身份服务。派生引用在最终窗口变化才有限重试；损坏、不记账的缺读、身份关联不符明确拒绝。当前 Session 归档/占用变化与后续 RoleSpec 授权矩阵变化不是历史身份撤销，不读取当前 Role matrix 或 Host 配置。

这里只减少无关事实依赖和校验，不宣称三次定位读自动降成一次。fresh writer 仍调用完整 WG11 并按 §5.1 检查/CAS；不把精简历史 identity 当当前写许可。普通 C1 查询继续收件人/发送者、完整作用域、分页绑定与正文来源规则；W2 查询继续原图读取契约，不要求仍拥有 Lease、未结算或可再执行。

同文件允许删除 `verifyStoredBody` 中完整 `stored.ref` 相等之后再次比较 `stored.ref.source` 的纯重复项；保留完整 ref、正文、scope/provenance、sourceRefs 包含关系检查。正文落库不是消息发布，未提交 envelope 仍不可读。本批不复制已有正文存储矩阵。

### 5.3 模型可消费结果

W2 已输出正式 typed 结果。C1 保留现有成功格式（write 的 WriteResult，read 的 value），对领域失败在 error/cancelled ToolResult 的 JSON output 保留实际拒绝结果（code/reason/current 等）；not_found/not_ready 也保留真实 status。不得全部抹成无结构 execution_failed 导致模型不能区分重试冲突、权限拒绝和未就绪。未知错误不伪造 current/revision；catch 抛错只能表示结果尚未确认，不能宣称提交前失败或提示安全重复。成功提交后晚 signal 不改写为取消，也不额外自动读/ack。

## 6. 少量独有消费者测试

不复制 C1/W2/B2 Store 矩阵，测试聚焦接线后新增风险；真实 SQLite/正文库/Kernel + ScriptedProvider，同一个平台/服务图。只可种项目、工作区、治理/Role/可信 Host 配置；正式 Session、Plan、claim、prepare、authorize/begin、before_model entered、工具动作均由生产入口产生。原 C1 领域规则夹具可继续显式种运行事实，但应存真实 manifest，并明确不是正式 entered 生产者测试。

1. **通信真实轮次**：Host 预先向正式执行 Session 发信；模型经真实工具读 inbox/body、respond 或 send，下一模型请求实际看到结果；读真实账本消息/正文/原历史证明副作用与完整 sender/callId。至少一次关闭重开后使用原 identity 取原 receipt，不重新启动 provider。
2. **白板真实轮次（生产组合根）**：从 `createTargetPlatform` 返回的同一个 Runtime/Plan 进入，证明实际 `delegatedWrites` 接通；同一正式 Run query 图/ready → propose → 用真实 proposal/pins apply → query 新图。用未领取未来 Task，检查 W1 新版本、Agent actor/submittedBy 与原运行 Task 历史保持；不能 mock PlanTaskPort 或只直接调用 handler。
3. **最小 grant 和资源**：文件 read/write/shell 都未授权而通信/白板 query 可达 handler；模型可见清单只含选中名字。ScriptedProvider 仍发一个未授权平台名或 builtin read，真实 Kernel 返回 unknown_tool/permission_denied，领域调用/文件读取为零；不含 read 时 source factory 未打开。另将 WorkspaceHost.authorize 的源码读许可明确拒绝，平台工具仍能运行；已有 driver 的无条件源码 authorization 不得变成邮箱/白板前置。实际模型请求仅包含所选职责 Skill 和可信 safety system 内容，显式空集合不回退。
4. **新写与 replay 分界**：实际工具分发窗口通过 Host 撤回工具 grant 或正式 recordRunResult 结束 Run，fresh 写不提交；真实局部 CAS 竞争拒绝，无关目标提交不误拒绝。将已提交原 request 在撤权/结束后重放得到原 receipt，新 request 拒绝；Host callback 调用计数证明 replay 未做 fresh 核验。若下一模型调用因撤权被 B2 阻止，检查实际持久 tool result，不能声称模型已读到第二轮结果。
5. **历史身份依赖**：真实账本先产生消息，再对测试 reader 注入仅命中 Plan/Attempt/Lease 的故障。历史消息读取/原 receipt 仍成功且定向读取列表不含这些键；公开调用传入伪造 roleBinding/Run/Session 仍拒绝；原 decoder 的损坏记录矩阵直接复用，不在本批通过篡改内部记录扩增生命周期反例。fresh 新写必须继续受完整 WG11 事实约束。

6. **材料真正进入模型（生产组合根）**：新增 `tests/composition/C2-runtime-platform.test.ts`，复用 `C1-M1-platform.test.ts` 的正式 producer → `storeArtifact` → W1 采用 TaskInput → consumer claim → Host grant 流程，并组合既有 B2 ScriptedProvider/Host 绑定。可信 Host 对该完整 consumer RunRef 返回刚提交 grant 的原 `materialBasis`，使用 consumer 自己的真实 Kernel Session；经 `platform.runtime.prepareExecution/startRun` 到实际模型请求，断言包含选中 requirement 的原正文、provider 确实执行、正式 Run 终态与 Session 释放。既有 `C1-M1` 用例最后仍是 starting Run，不能把其 `readTaskInput` 成功当作这条执行闭环已通过。缺 M2 注入时 prepare 可能成功，但 start 必须在原 B2 material-facts 接点真实 unsupported，此处就是骨架预期红点。
7. **组合后的材料拒绝边界**：另一真实 consumer 完成 prepare 后，经公开 `revokeMaterialAccess` 撤回其已提交 grant，再 start，断言准入拒绝、provider 为零；不得通过 raw 改 grant、Session/Role 或直接造 permit。成功场景在已终态后撤回原 grant并重开平台，observe/原 start 恢复不再启动 provider、不要求旧材料仍 current。这里仅验证组合接线后的 fresh/replay 分界；source 改变、四 barrier CAS、跨域/history 与正文矩阵沿 M1/M2/B2 原专项，不在 C2 复制。

新增组合测试文件承载第 2、6、7 项；第 1、3 项仍放 Runtime consumer 测试。可共用新增 C2 helper 组织真实生产入口，但组合用例只能调用 `createTargetPlatform` 暴露的 ports，不手动把已正确注入的 entry/Plan service 塞给 Runtime 来绕过组合根。正常 Role 安装、激活与 Session 创建绑定可以作为前置，不引入运行中 Role 热切换/篡改生命周期。

第 1–3 项约 3 个工具消费者场景，第 4–5 项约 3 个领域场景，第 6–7 项约 2 个材料组合场景；另覆盖缺依赖/重复名字等少量装配反例。已有 W2 工具、角色资源、C1 正文/分页/CAS/晚取消和 B2 before_model/预算历史测试直接作为回归集。不可把测试 catch unsupported 后 return、跳过 provider=0 或直接 seed entered 的用例记作消费者通过。

## 7. 精确拟议 scope 与验收

以下以 `coding-platform/next/` 为根，仅为主审拟议清单，派发时按合入快照冻结哈希。

生产 **7 文件**：

- `src/core/agent-runtime/execution-contracts.ts`：full plans、可选 messages 的正式依赖类型。
- `src/core/agent-runtime/execution-driver.ts`：固定 work_run context、真实 callId、工厂过滤与同次 Kernel 注入。
- `src/core/agent-runtime/communication-tools.ts`：只读注册标签、保留领域失败。
- `src/core/work-graph/communication/contracts.ts`：fresh Host 准入依赖。
- `src/core/work-graph/communication/mailbox-service.ts`：receipt 后 fresh admission、历史 identity 私有 loader、重复正文 source 比较精简。
- `src/core/work-graph/tasks/run-state-service.ts`：仅导出现有 Run decoder 供内部复用，不改 WG11 读取行为/公开 port。
- `src/composition/create-platform.ts`：按 §3.1 前移唯一 executionReader/可选 AuthorizeConfiguration；唯一 Plan 注入 W2 delegatedWrites；用同一 reads/source/bodies 建 M2 facts 并注入共享 entryDependencies（entry/model 两消费者）；Runtime 注入同一 messages/plans；C1 注入同一 bodies/AuthorizeConfiguration。不得新建平行服务、Store 或默认授予工具/Skill。

测试 **5 文件**：新增 `tests/runtime/C2-runtime-platform-tools.test.ts`、`tests/work-graph/C2-mailbox-admission.test.ts`、`tests/composition/C2-runtime-platform.test.ts`、`tests/helpers/C2-runtime-platform-fixture.ts`；修订已有 `tests/helpers/C1-mailbox-fixture.ts`，以真实 prepared manifest/Host binding 替代固定伪 digest，维持既有领域测试调用方式。新 helper 组合既有 B2/claim fixtures，不复制 Store backend/schema/正文实现。若 full plans 类型使现有 B2 fixture 编译失败，应报告具体调用者，由主审作最小测试依赖修订后冻结，不能在 Runtime 偷添 fake 方法。

`observed-model-run.ts`、W2 工具/领域、Skill 正文、B2 核心 entry/model 准入、Kernel/vendor、Workflow、Task/Plan schema 默认只读。Skill trusted root/system 内容测试由 Host 绑定注入，不为“接线”新增默认角色策略。此前组合根 `platform.messages` 和 MaterialGrantPort 装配属于前置，C2 不同时重做；本批只补其实际消费者 M2 facts/W2 delegatedWrites 和 C1 runtimeAdmission，M2/B2/W2 各领域源码继续只读。原 `tests/composition/C1-M1-platform.test.ts` 与 `B2-runtime-platform.test.ts` 保留并作为回归，不因新增 C2 组合场景改写旧矩阵。

骨架阶段只对新增消费者分支明确 unsupported；既有无平台工具的 B2 和 Host C1 行为继续可用。接口必须可编译，真实 fixture 先建立成功，再在预期新接点红；先跑 next-types、现有 next-runtime-execution/next-session-mailbox/W2 检查，并由主审给新增测试登记窄 check selector。中审先逐项核测试确实达到目标分支，再冻结生产 scope 供 DSH 实现；不能依赖 DSH 自称全绿。

**主审需冻结：** messages/plans 的兼容依赖选择；C1 缺 fresh deps 的新写 unsupported 语义及旧 fixture 迁移；历史 identity 内部 decoder 复用；既有 Host safety 内容装配来源。冻结是工程中审，不向已授权用户重复索取权限。本批完成只证明真实 Runtime 消费这组平台能力，不能据此宣称自动协作、完整生命周期或产品全范围完成。

## 8. 主审派发前冻结（2026-09-26）

预审确认采用上文 full plans+可选 messages；缺 runtimeAdmission 只令新 work_run 写 unsupported，Host/历史读/原 receipt 兼容保留；既有 Run decoder 仅内部复用。fresh 工具依赖检查置于已进入 Run 的 observe/replay 分支之后；C1 同次 Role/Host 事实替代旧重复解析，完整关联由领域调用方核对，fresh拒绝和commit拒绝均补查同一原回执。可信 safety system 内容仍由 Host 使用现有正文，Runtime 不再造默认加载策略。前置实现合入后才能准备骨架快照；当前设计不表示已经派发或完成。

补充冻结项：§3.1 的 M2/W2/C1 同实例装配顺序，保持生产 7 文件；测试由 4 增至 5 文件，仅新增上述生产组合消费者。主审持有组合根最终审查和 check selector 注册；骨架阶段不实现组合根接线，真实材料与白板前置完成后应分别红在缺 facts/平台工具消费者接点，不能用旧上游骨架 unsupported 充数。

## 主审本次骨架派发

前置B2/C1/M1/M2/W2及组合根已合入并通过94文件/948项物理隔离验收。本次正式派发**第一阶段**，仅做新增签名/DTO、明确unsupported的新增行为接点与真实目标测试，交付后停止等待Astra中审，不实现业务算法/完整接线。严格按 `C2-runtime-platform-tools-skeleton-scope.json` 精确写范围，所有新文件已经预建；使用当前工作树快照。原有路径保持，禁止改其他批次测试、原工程或vendor。只原地写获准文件，不做会越scope的同级临时文件/rename；不读取或修改全局DSH配置、不输出凭据。

先读本文、CODE-QUALITY-GUIDELINES、DSH-WORKFLOW及DSH-EXECUTION-HARNESS。专项检查 `python3 tools/dsh-refactor/check.py next-runtime-platform-tools`，`next-types`单独跑；仅本批风险的既有检查作回归，不跑全仓通用矩阵。快照中并行批次尚空的测试文件属于其它owner，不能修改或据此判定本批失败。明确报告真实夹具前置、首次红点与未执行到的后续断言，不能catch失败后return冒充成功。只有公开输入/合法生命周期可达行为才作为新增门槛，不制造运行中角色切换或直接内部篡改反例。


## 9. Astra 首轮中审返修（仍为骨架/测试阶段）

首轮11文件差异没有越scope或覆盖main。DTO、明确unsupported、既有decoder窄导出可保留；通信只读capability/typed失败属于协议小改，中审逐项核验后保留。组合根仍不实现。本节修订测试后再次STOP，不直接进入实现。

1. **真正的通信往返。** 当前“read/respond round”只有readInbox。改同一case：Host先向真实Run的Session送正文；模型先read_session_inbox，再依据真实ref读read_session_message_body，再respond_session_message，最后模型请求含成功领域结果；公开readMessage验证原消息已回复且正文匹配，原发件/回复Session正确。复用mutable ScriptedReply args和beforeReply（createScriptedModel在hook后取reply）按实际tool结果填ref，不手造内部事实。不得把领域writer从测试侧直接调用当作模型调用成功。
2. **真实资源与拒绝源码授权。** helper的skillRoot改现有next/resources/skills，不再写仿制skill.json/content。合并进现有consumer case检查三个真实已启用正文/真实Host safety进入请求；最小工具case显式skillIds=[]并验证不会回落。不复制W2整套资源矩阵。allowSourceRead=false时workspaceHost.authorize返回真实forbidden，记录authorizeCalls；平台工具case实际成功且authorizeCalls===0，证明完全跳过初始源码权限。保持resolveRoot合法供Kernel定位。对未授权builtin调用验证真实Kernel错误及authorizeCalls===0、正文未出现，不宣称未观测的“零domain调用”。
3. **不用覆盖Session角色。** helper已可调用f.createSession(requestId,{kind:'role_spec',pin})，用此真实生命周期新建两个对应Role的Session，再显式buildRequest({input:{sessionRef}})领取；移除overwriteSession调用。fixture返回first/second对应新Session引用，material消费者也使用实际second。初始治理matrix允许可信seed，必须明确尚无正式writer；不掩饰成生产bootstrap。
4. **真正W2模型轮次。** 当前composition白板case仅直接Agent propose，Run尚未entered，phase2必被正式admission拒绝。替换同一case，经runtime.prepare/start实际entered，由模型query_task_graph→propose_future_plan→apply_future_plan→query_task_graph。使用query的真实Goal/Plan pins、proposalRef/revision及tool schema要求；target完整保留旧obligations/assignments/gate，仅细化未领取implement-b说明，不改当前执行Task。断言adopted pointer、新文本、work_run来源与终态，再次query来自相同production Plan实例。不要额外mock delegatedWrites或进入状态。
5. **真实receipt与事实保留。** C2-mailbox无依赖case目前只证明Host receipt。同一case先以有效work_run完成一笔send，再在缺runtimeAdmission服务中重放同笔request，验证原committed；新request仍unsupported。fresh撤权case合并：原committed receipt在撤权后仍返回，新request拒绝。材料成功case在Run终态后合法revoke原grant并重复start/observe，验证provider不增、终态不丢失；不用删改历史。
6. 保持生产骨架显式unsupported，测试仅断言目标，不将红状态写成期望。types必须通过，相关B2/C1/W2回归照常。逐条记录红点及尚未执行的后续断言，禁止将预期新接点之前的非法draft/identity/缺资源当作有效红因。别新增运行中Role热换、原始记录破坏、全部错误状态矩阵。

7. 新历史identity reader的caller反例必须先证明合法对照可读：当前case把Host邮件发idleSession，busy Run即使身份正确也不能读。改发busySession、先用h.ctxWork验证ready，再改变调用参数roleBinding验证forbidden；只改外部caller，绝不改持久Role。旧C1的send身份反例不重复新增。

8. C1既有领域夹具若显式seed entered事实，补入的真实manifest必须和Run.inputBinding、authorization.inputDigest完整一致；这是夹具必要自洽，不新增防篡改测试。真正production生命周期证明只由C2 Runtime消费者测试承担，交付报告明确两者边界。
