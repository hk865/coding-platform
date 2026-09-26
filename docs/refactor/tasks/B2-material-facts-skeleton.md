# B2：外部材料准入接入 M2 局部事实

状态：2026-09-26，供主审定稿。严格两阶段：DSH 先交付接口骨架与真实行为红测，停止；主审审核、冻结后才派发实现。M2 已在 main 通过独审并合入，但当前 B2 仍显式拒绝外部材料；本任务不把组件已有等同于消费者已接通。

## 1. 问题与当前源码

四个 fresh 屏障都必须重新核验当前材料授权，并把同一次判定读到的正式记录版本加入本次 RecordStore CAS：authorizeRuntimeEntry、beginRuntimeEntry、authorizeModelRequest、recordModelRequestAttempt。只在准备或 authorize 时核一次，不能保护后续 fresh begin / 实际模型消费。

先读 docs/AGENTS.md、IMPLEMENTED-CAPABILITIES.md、M2-material-read-facts-skeleton.md §4–5，再沿下面真实实现核对：

- `tasks/execution-entry-service.ts`：`externalMaterialsProblem` 当前无条件拒绝非空 selected/additional；`admitEnteredRun` 供两个 model 方法共享；`readAdmissionFacts`、`readManifestFromEnvelope/readStoredManifest`、`recheckHostRoleAdmission`、`mergeGuards` 和现有 replay 顺序。
- `tasks/model-call-service.ts`：`claimChainGuards` 与两个 commit；两方法先 lookup 原回执，再执行 fresh admission。
- `materials/material-facts-service.ts`：已实现 per-call authority/index 跟踪，复用正式 Material resolver/service；只在 ready 交付局部 guards。
- `materials/{contracts,material-service,applicability,grant-service,record-readers}.ts`，`workspace/material-source-provider.ts`。
- `tasks/plan-service.ts` 的 `readTaskInput`：正式 Goal/Plan/Task requirement 选择与 current 材料读取。不得复制这一算法，也不新增 PlanTaskInputFactsPort。

重要源码纠正：当前 B2 的 manifestProblem 只校验 selectedTaskInputs 的 requirementId/ref 形状；由于随即 unsupported，尚未实现“该 selection 确属正式 Plan”的检查。本批必须补齐，不能引用 M2 任务的接线目标把它当成已实现事实。

## 2. 精确 scope

以下路径均相对 `coding-platform/next`。

第一阶段允许写，第二阶段生产仍仅前三个文件：

1. `src/core/work-graph/tasks/execution-entry-contracts.ts`：可选 facts 依赖。
2. `src/core/work-graph/tasks/execution-entry-service.ts`：窄共享材料 admission 骨架、返回 DTO 与四屏障的复用入口；实现阶段补实际算法。
3. `src/core/work-graph/tasks/model-call-service.ts`：消费共享 admission 返回的材料 guards，保留既有 mergeGuards 与 replay 顺序。
4. `tests/helpers/B2-execution-fixture.ts`：仅追加本任务所需可选材料依赖/Prepared 字段与 schema 注入能力，保持原调用默认兼容。
5. `tests/work-graph/B2-material-admission.test.ts`：本批独立目标测试，不另造大 fixture。

第二阶段测试与 helper 冻结只读。不得写 plan-service、M2 collector、材料 resolver/provider、Runtime、composition、共享 Prepared/dispatch schema、Kernel 或既有 B2 三组测试。composition 注入 materialFacts 由主审在下一受审接缝处理；本任务不得用类型断言绕过 deps。

## 3. 最小接口与第一阶段产物

在 `ExecutionEntryDependencies` 添加：

```ts
materialFacts?: MaterialReadFactsPort;
```

类型从 `../materials/contracts.js` 导入。`ModelCallServiceDependencies` 已是 `Omit<ExecutionEntryDependencies, 'newId'>`，自然继承，不复制新 DTO，不新增公开材料端口。

entry-service 内新增窄函数及返回值，可保持非导出；使用现有 Rejected 和 RecordGuard：

```ts
type MaterialAdmission = { guards: readonly RecordGuard[] };
async function admitExternalMaterials(
  deps: Pick<ExecutionEntryDependencies, 'plans' | 'materialFacts'>,
  ctx: CoreCallContext,
  facts: TaskExecutionRecord,
  manifest: PreparedTaskManifestV1,
): Promise<{ ok: true; value: MaterialAdmission } | Rejected>;
```

`EnteredAdmission` 追加 `materialGuards: readonly RecordGuard[]`。authorize / begin 直接调用该 helper；`admitEnteredRun` 调用并携带 materialGuards；model 的 `claimChainGuards` 合并该字段。四处最终继续通过同一个 `mergeGuards`，不新增 merge 算法。

第一阶段只完成以上声明、职责注释和机械接缝：无外部材料返回空 guards 保持旧路径；存在任意 selected/additional 材料，无论是否已传 facts，都明确 unsupported，不调用伪造 ready 或实现授权算法。原外部材料占位可由此 helper 替换，但不能提前完成第二阶段。骨架目标红测必须停在这一明确原因，不能坏在非法 Claim、过期 expected、缺 schema 或不合法 Role/Host。

可选依赖的最终兼容语义：无外部材料时缺 materialFacts 仍可用；有外部材料且缺依赖时明确 unsupported。不能退回普通 openArtifact 后无 guard 提交。

## 4. 实现阶段：可信 reader、选择与正文

helper 只消费已通过原身份、Claim、Run/Session/lease、manifest body/digest、Host/Role 校验的 facts/manifest。请求输入已由外层同步隔离，原 AbortSignal 必须保持，不再创建新的 signal。

B2 写入口原 ctx 是可信 Host；它不能直接成为材料准入 reader。根据正式 facts.run / claim 与已核 workspace 构造内部读取上下文：

- principal 为该正式 Run 的 `work_run`，roleBinding 取正式 Run；
- materialReader 为同 Run 的 `run` requester，currentBasis 取已保存且将由真实 resolver 核验的 manifest.materialBasis；
- projectId / workspaceId 从正式 Run/Claim/Session 的一致 scope 派生；signal 为原 signal。

保留 Host 原 actor 用于 B2 命令与回执，不改变业务写身份。内部 run reader 的构造是在已核正式执行上收窄能力，不是允许调用者通过 ctx 指定任意 Run。basis 为 null 或过期不能由 raw body/sourceDigest 补造授权；按现有 current 规则失败。不能沿 Host historical_explanation 路径绕过 grant。

逐项处理 selectedTaskInputs：

1. 使用已经读取、将被 CAS 的 `facts.plan`，核 requirementId 对应正式 `inputRequirements`，consumerTaskId 等于正式 Claim Task，requirement.kind 为 artifact，完整 artifactRef 与 selection.ref 相同。Plan schemaVersion 1 没有相应 requirement 时不能凭 manifest 自报选择。异常重复或歧义选择不得挑一个凑成功。
2. 调 `plans.readTaskInput(runCtx, {goalRef, planRef, taskId, requirementId})`，所有选择身份取正式 facts/Claim。必须 ready，完整 ref 等于选中 ref。
3. 使用同一 runCtx、同一完整 ref，调用 `materialFacts.openArtifactFacts(..., {ref, usage:'current'})`。必须 result=ready，完整 ref 与选择相同。依据原 immutable ArtifactRef/digest 与 MaterialPort 的正文完整性验证绑定同一正文；不得只比较 artifactId，不重建另一套 digest/authority。两次读取若暴露正文不一致应拒绝，不能用第二次正文无声替换准备材料。
4. 收集 facts 调用返回的实际 guards。不得把 manifest.materialAccessRefs 当成授权或自行再读 grant 最新版本冒充本次判定版本。

additionalMaterialRefs 不属于 Plan input selection；逐项直接走同一 run reader 的 facts/current，核完整 ref 并收集 guards。不能因其中一个 Artifact 由同 Run 所有便使用历史 owner bypass。选中与 additional 引用相同 ref 时可在一次 helper 调用内复用已完成的 exact current facts，但不得略过每个 selected requirement 的正式 Plan 校验，也不得跨屏障缓存。

不要从任意文本搜索推断 manifest.input 是否“真的包含”每段材料：input 与 inputDigest 保留已有 Prepared/Runtime 契约，本批只保证列明材料的正式选择、正文身份与当前授权。不得另造 Prepared version 或 manifestRef。

## 5. 事务窗口与已发生事实

每个 fresh 屏障必须实际调用 helper。即使 authorize 成功，begin 也要新读；即使 begin/entered 成功，model issue 和 consume 也要各自新读。事实不能保存在 entry permit 后永久复用。

把 helper guards 与既有 Run/Attempt/Outbox/Plan/Session/lease/Role guards 合并后，加入该屏障原来的同一个 PreparedCommit。M2 current 会读 Goal/Workspace/reader/grant；它交付的这些精确 guards 必须全部保留。authorize 已有 Goal/Workspace guard 与 M2 同 key 不同版本时拒绝 revision_conflict，不能 last-wins；begin/model 同样不能丢掉 M2 的 Goal/Workspace 版本。

Plan 选择由正式 PlanRevision ref/revision 保护，Goal activePlan 的变动由局部 Goal guard 保护。accepted PlanRevision 的选择不可变；改版产生新 ref。不得为此增加全局 horizon、整个候选集锁、额外公开 Plan port 或扫描全账本。

第二次 current/facts 成功后撤销 grant，原 commit 必须因 grant@旧版本 CAS 失败；不能在失败后丢弃 guards、仅刷新 grant 版本重试。跨读取发现两个版本由现有 mergeGuards/M2 窗口冲突拒绝。

以下不新增材料准入：

- lookup 已 found 的原 authorize/begin/model issue/consume 回执：保持先恢复原结果，不因随后撤权、source 变化或 Run 终态拒绝同一原请求；回执重放绝不是 fresh model call 许可。
- `recordExecutionEntered` 的已发生 entered 证据，以及 `recordRunResult` 的已观察结果/释放：不插入新的材料 current gate。不把已发生执行证据因后撤权丢弃。原 Host/Role、身份、代次、历史证据与事务条件保持，不借此放宽它们。

M2/source 的跨系统边界保持：真实文件采样及 source pin current 不等于直到 Kernel 使用前文件永不变化；四个屏障分别重新核验，不新增全源码锁或假摘要 provider。

## 6. 真实测试夹具复用与独有反例

优先复用 `createB2ExecutionFixture` 的正式 Goal/Plan/Session/claim、body、Kernel identity、authorize/start/enter、fresh pin 与 currentPermit helpers。其现有默认 MaterialPort 是显式 unsupported，不能把它当真实材料链。仅给 `ports` 追加可选材料依赖覆盖（plans/materials/materialFacts），给 buildPrepared 追加 selectedTaskInputs/materialBasis/additionalMaterialRefs/materialAccessRefs 可选字段，并保持保存 manifest 字节、bundleRef、inputBinding digest 同步正确。追加 M1 event schemas 时避免重复现有 material snapshot 注册。

在新测试文件内用小范围 setup 组合真实能力：同一个 base backend 和 bodies；已有第一个正式 claim 可充当 producer；材料用真实 MaterialPort 存储；通过真实 Plan propose/apply 新增一个从未领取的 consumer Task 并纳入 ref，再为该 Task 正式 claim consumer。现有 B2 fixture 的第一、第二 Task 已领取，不可把其中一个当未来任务改输入；复用已有允许角色给新 Task 分配。不可直接修改 accepted Plan 把输入塞进旧 claim。

provider 必须用 `createWorkspaceAccessFactory` + `createMaterialSourceProvider` 对 fixture 临时目录的真实文件捕获；M1 `createMaterialGrantService` 真正发出 grant；普通 resolver、M2 facts 与 writer 共用同一 provider/authority/index/bodies。冻结 Host workspace root/权限绑定可作为明确测试配置，不得用 capture 返回一个常量摘要代替真实 source。材料前提需在 B2 断言前通过普通 current 与 facts 读取校验。

必要测试行为（不做 Memory×SQLite 全矩阵；正常路径可用 memory，一个真实 SQLite CAS/重开按需要选择）：

1. 一个合法 Prepared 同时含 selected 和 additional，materialAccessRefs 留空；正式 authorize→fresh begin→entered→model issue→fresh consume 全部成功，检查实际原 Run 与 ModelRequestPermit 状态，且每个屏障发生新的材料读取。材料必须来自真实 grant，不以 empty materialAccessRefs 导致拒绝或误授。
2. selected requirement 错 Task/不存在、或 ref 与正式 requirement 不同，拒绝且不提交许可；即使该 Artifact 本身有真实 grant，也不能绕过 Plan 选择。缺 facts 依赖保留明确 unsupported；无外部材料保持旧兼容。
3. 参数化四个 fresh 屏障，在目标屏障实际完成 facts 读取、即将提交时，通过同一 backend 的真实 M1 revoke 修改 grant；原 commit 必须 revision_conflict，Run/entry slot/ModelRequestPermit 不发生目标操作的改变。注入仅拦截目标 commit，传递原 PreparedCommit，不伪造失败 receipt，也不能误拦截前置 authorize/entered/revoke。每个 case 使用新合法链和目标屏障的真实 fresh pin；这是四个独立漏 guard 风险，不是重复 Store 矩阵。
4. authorize 成功后改变真实 source 文件，fresh begin 失败；另一个正式链在 model issue 后撤权，fresh consume 失败且 permit 仍未消费。验证重新读当前许可，不能仅凭第一轮成功缓存。
5. facts 内部已合法 current，随后让另一材料/正式读取看到不同 Goal/Run 版本，现有 mergeGuards 拒绝矛盾版本。可用透明单次读后 hook 执行真实正式变更，不注入 fabricated guards；若可复用已有 M2混合窗口测试，则优先以“两个实际材料事实窗口之间发生变化”的 B2 合并反例验证本批新责任。
6. 四种原回执在后来撤权后仍恢复（原载荷、原 expected、原 requestId，保持 replayed）；fresh 请求继续失败。另验证 begin 已提交后的 entered 观察与已发生 result 记录不会因新材料 gate 被阻断，使用真实前置 entered/history 证据及正确代次，不能凭造 terminal seed 绕过原契约。
7. source/provider 暂不可用或原 signal 取消时没有新许可提交；保留具体错误语义，不把 source_stale/unavailable/cancelled 统一写成 forbidden。优先与上述真实 source 测试组合，避免重复 M2 已有通用矩阵。

对于任一测试，第一阶段应精确报告第一个红点以及后段尚未运行的断言。不能将 helper 前提校验失败计作骨架红测通过。测试的 grant/source 生产和 Plan 选择前提必须已完成，目标只因本批 unsupported 红。

## 7. 中审、实现与验收

阶段一交付后停止。主审检查接口只有可选依赖和局部 DTO、旧行为未退化、真实 fixture 能到目标 unsupported、commit hook 确在最后事实读之后，冻结五文件。

阶段二仅实现三个生产文件。复用现有 MaterialPort/M2、WG11/Plan、Role、mergeGuards、RecordStore事务与回执算法；不修改测试让其变绿，不复制 material authority，不新建授权数据库或全局缓存。

用已提供 `next-types`、`next-execution-state` 检查兼容；新专项由主审在只读 check.py 注册 `next-b2-material-admission`，执行新测试文件。若快照尚未提供该入口，报告主审补充，不自行改 harness/check。最终交付精确文件、实际类型/测试结果及未接边界，停止等待独审。

本批组件接线验收不等于平台已注入 materialFacts，不等于 Runtime 已提供所有 selected/additional 的生产入口，也不覆盖 source filesystem 原子快照或 C1 Agent 工具接线。主审后续分别验收真实消费者。
