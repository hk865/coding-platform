# DSH 长上下文对照：主审结论与候选原报告

2026-09-27；生产基线 `d0dc9d6cf4b914159a67578dd1de7265fa9bad9d`。任务假设与反证条件见 [任务书](../tasks/DSH-redundancy-review-2026-09-27.md)。本次只做审查，不执行生产删改。

**后续状态：** 用户随后授权“DSH 探索 → 主审复核 → DSH 执行”。[首批角色解析复用](../tasks/CLEANUP-role-admission-2026-09-27.md)已按两阶段完成并导入；本报告的代码行号和原始结论仍指上方基线，不代表清理后源码。其余候选仍按下方主审取舍处理，不因候选报告存在而视为已批准或已完成。

## 规模追问：实际删量与可清退对象

**后续归因核实：** [逐文件代码与逻辑清单](new-code-and-logic-2026-09-27.md)完整恢复B1原文后确认，下方450行候选全部在B1时已存在。它们是旧冗余候选，不是后来33,161行增长的来源；下文1.4%仅是体量比，不能解释为已定位了新增代码中1.4%的冗余。

2026-09-27 再次核对当前工作树。生产 TS **225 文件 / 63,625 物理行**，对比 B1/W1 的 30,464 行仍净增 **33,161 行**。首批角色复用的生产 diff 是删除 15 行、加入 15 行，**净减少 0 行**；测试净增 17 行，当前测试 TS 39,210 行。本节只有量化审查，没有继续删除源码，以下数字均不是完成量。

主审从 app/main、ui/main、composition 建静态可达图（包含普通 import/export、内联 import type、字面量动态 import），再用实际符号、tests/scripts/tools、当前行为核对孤岛；不能只凭未被入口遍历到就删除。三个子 Agent 分别复核领域、执行链与工具，DSH 在原长上下文 Session 继续找遗漏。

### 可清退的旧实现及局部重复：定位主体共 450 行

| 对象 | 主体物理行 | 复核结论与清理边界 |
| --- | ---: | --- |
| `src/contracts/validation/plan.ts` 全文件 | 202 | 旧 `ApplyPlanRevision` schema 1 validator，唯一导出无生产或测试调用；当前 Plan 校验在 `tasks/plan-validation.ts`，持久解码在 `plan-record-codecs.ts`。旧文件可退役，不删现行 Plan 契约。 |
| `source-workspace-reader.ts` 全文件及 `architecture-source.ts:53–64` 旧 helper | 59 | 仅旧兼容测试使用。正式架构捕获走 WorkspaceTools → CaptureRegistry → `mapArchitectureSource`，保留这条链及实际图映射覆盖；旧 wrapper/比对旧实现的测试依赖可清退。 |
| `query-workspace-source-reader.ts`、`readonly-read-witness-reader.ts`、`verification-source-applicability.ts` 全文件 | 79 | 分别 22/31/26 行，无生产和直接测试消费者，无包导出或 scripts/tools 动态绑定。可退役闲置适配，保留当前仍用的共享类型及底层 reader；不把未来 Query/Reviewer 行为需求一起撤销。 |
| `exploration-source.ts` 全文件 | 99 | 仅专用 `exploration-source-applicability.test.ts` 使用旧整树双摘要算法，正式材料来源 provider 不调用它。可以清退这套闲置实现及专属测试；不改变其它 source pin 算法。 |
| `source-capture-access.ts:192–199` 无 runtime 分支 | 8 | 两个生产 factory 均传 runtime；两个省略 runtime 的测试在 resolveRoot 已失败，未消费该分支。可收紧内部参数并迁移 fixture，保留实际 Run/Query 授权。 |
| `materials/applicability.ts:120–122` 第二次 issuer 判断 | 3 | 同一数组此前已按 issuer 过滤，后面仅筛选子集且已保证非空；正式 currentBasisValid 不修改 grant。局部重复可删，动态撤权/来源校验保留。 |

前四项旧实现主体合计 **439 行**，两项重复分支 **11 行**。这是源码定位范围，实际净删除还须以执行 diff 计数，连带类型/import/测试调整没有虚算进去。它只相当于此前净增长的约 **1.4%**，不足以称为已经解决平台膨胀。

### 不能混进“完全不需要”的部分

- `role-source-reader.ts` 132 行与 `role-material-channels.ts` 52 行，共 **184 行**没有生产消费者，但角色 code 材料通道尚无等价替代：`execution-preparation.ts:224–237` 对非 contract 必读材料仍返回 unsupported。可退役旧适配，但必须保留这一产品缺口；不能宣称该能力已被替代或不再需要。其旧 reader 专属测试可清退，共享拒绝路径测试仍需保留。
- 固定 Host currentness 与 builtin read hook 共圈定 **45 行**；持久架构捕获两次外层 verify 共 **6 行**。需要保留工具路径权限/取消和实际提交语义，不能把候选片段长度当净删量。
- 架构比较/反向影响约 199 行、架构修订主体 167 行尚缺产品消费者，但已有明确需求与 MVP 缺口，不因此归入死代码。

### 真正涉及千行规模的收敛面

| 当前审查面 | 范围物理行 | 需要判定的重复机制；不是可直接删除量 |
| --- | ---: | --- |
| Work/Query 各自的 prepare、driver、observe 六文件 | 3,122 | 共享已有 Kernel 驱动机制，收敛重复装配/观察；保留 Work 占用与 Query 独立身份、只读和 Answer 语义。 |
| Work 执行入口与 model-call service | 1,954 | 核对 authorize→begin、签发→消费是否需要独立阶段；其中约 297 行是入口双阶段与 replay 子段，保留副作用前受理、幂等及结果未知语义。 |
| Query owner/job/codecs/contracts | 3,332 | 收敛重复的执行协议表达，保留 QueryJob→QueryRun→Answer；不能用“与 Work 类似”删掉用户调查能力。 |

这些区域有真实消费者，但“被调用”只证明正在运行，不证明所有阶段必要。当前尚无可靠净减量，不承诺能删除其中多少千行。当前 WorkGraph 较 B1 增 18,529 行、Runtime 增 5,103 行，共占全部增长约 71.3%；后续架构减量应优先针对这里，不能停留在几十行 helper 抽取。

本轮 DSH 用原 Session 追加 13 次工具调用并正常退出（attempt `1790489711347649916`）；只改 lane 报告，outsideScope=[]。原工作树报告已被主审更新，runner 的 originalWorkspaceChanged 仅报告该文档过期，未导入整个 lane。其旧 reader 候选已独立核实；其“legacy_live 仅测试可达”的结论暂不采纳：两个生产 driver 都有 sourceFactory 缺省条件，必须先核对该条件与 Host 配置才能整删旧工具链。DSH 把 role reader 直接称可删也未说明 code 材料缺口，以上述主审限定为准。本轮未运行产品测试或模型 E2E。

## 执行与边界

- 单个新 DSH 会话 `session-faa3d883-c43e-4478-b1a6-2388abeb1289`，独立 lane `redundancy-review-20260927`，正常退出，用时约 148 秒。
- 直接提供 53 个完整文件及 UI 1140–1230 行片段，路径/行号随正文提供；请求约 1,341,245 字节、1,293,681 字符。没有取得实际 tokenizer 用量，不据此声称用了多少 token 或验证了模型上下文上限。提供材料不等于保证模型逐行有效理解。
- 上下文涵盖 Work/Query Runtime、平台执行准入、角色、捕获、Evidence、Workflow、Host、存储与必要设计；其余源码可定向补读。没有提交全量历史证据或凭据。
- 14 次工具调用，含报告写入与写入方式重试；源码/测试均为操作系统只读。runner audit：只改本报告，outsideScope=[]，originalWorkspaceChanged=[]。生产没有变化，未跑模型 E2E 或测试。
- 候选原报告保留在下方，主审意见优先；不能把 DSH 的“合理分层”或“真冗余”自动作为裁决。

## 主审复核

| DSH 结论 | 主审判断 |
| --- | --- |
| 同一次准入重复角色解析 | **确认。** execution-entry-service.ts:541 与组合根 create-platform.ts:153 最终调用同一 resolver。复用需保留对应 guards，不能因为两段之间自身没有写入就宣称并发变化不可能。 |
| 一次 Run 角色解析 10 次 | **只接受限定静态路径计数。** 全新 Work、prepare/start/authorize/begin 各一次、仅一个模型请求、无重试时可按 1+1+2+2+2+2 得到 10；不是所有 Run 的固定实测，也不是每工具 10 次。 |
| Work/Query observation 有重复纯函数 | **确认新增线索，但原文列表不精确。** decodeEntry、findTurnStart、applyEvents、turnIsComplete 相同或等价；query-observation.ts 没有 reduceFromStart。适合小范围复用，不证明两套业务状态机应整体合并。 |
| 无 runtime 的源码访问分支没有生产调用者 | **确认当前仓内调用情况。** createSourceCaptureAccess 的两个生产调用均传 runtime，无 runtime 用法在测试；可审查旧兼容分支及对应测试，尚未证明外部公共消费者不存在或可以立即删除。 |
| 固定 Host 反复校验没有可达变化，但仍因端口理论动态而不建议删 | **不接受这个保留理由。** 当前固定 Host 的校验应按真实消费者收窄；其它 Host 的动态语义有证据才保留，不能把接口理论可能性当产品行为。内存查询不代表零复杂度，但没有性能实测。 |
| Workflow 有职责，因此 UI 中继是必要分层 | **推论不成立。** Workflow 应保留，不代表每个 next 都必须经浏览器原样再发。将有界推进归入现有 Host/Workflow不必复制业务逻辑；仍应保留等待/未知停止、原回执和进度。 |
| 捕获和持久正文职责不同，因此两次额外 verify 不重复 | **部分采纳、部分待查。** export/map 确实复用结果；但主审独立核实完整持久捕获成功链是四次源码扫描、一次依赖分析。应审查 capture 内复核后、正文写入前后各 verify 的必要性，不能仅因检查位于不同位置就判都必要。 |
| Session.historyCursor 在终态前由 advanceLocator 推进 | **纠正。** execution-observation.ts:653 的 advanceLocator 写 Run.executionHistory 的水位，不是 Session.historyCursor。 |
| 阶段之间存在版本检查，所以 authorize/begin、签发/消费不能合并 | **证据不足。** 说明现有协议有检查，不证明两个阶段本身必要；需要核对独立消费者和故障语义等价性。 |

DSH 对 H6/H7/H8 的意见有助于避免把临时/持久数据、历史引用/投影和独立业务语义一概当重复；但未核文件已在原报告披露，不能据此宣告这些区域全部合理。特别是“缓存正文但每次仍必须防篡改校验”的建议没有给出当前合法变化依据，不直接采纳为新的缓存/验证机制。

## 清理候选的顺序

1. 已确认重复：同一次准入的角色解析，当前固定 Host 的重复新鲜度检查。
2. 新增小范围候选：Work/Query 的共同历史辅助函数；只剩测试使用的旧 source-access 分支。
3. 行为级简化候选：持久捕获的验证次数、浏览器中继、模型/Run 两阶段准入；先证明语义保留再改。

本次没有发现足以直接删除半个平台的证据。长上下文对照增加了线索和反证，但其推论与引用仍需逐项复核。

---

以下为 DSH 原始候选报告，保留原措辞以便对照，含上文已纠正的结论。

# DSH 长上下文对照审查（候选，2026-09-27）

基线：独立仓库工作树，生产 HEAD d0dc9d6cf4b914159a67578dd1de7265fa9bad9d。本报告只读对照，不施工。

## 1 阅读覆盖与上下文使用

已核：agent-runtime 给定全部文件（execution-driver/-observation/-preparation/-control、query-execution/-preparation/-observation、model-call-access、observed-model-run、session-operations、graph-execution-history、observation-recovery、source-capture-access、project-source-tool、exploration-tools、check-execution）；work-graph 的 execution-entry-service、model-call-service、claim-service、run-state-service、query-execution、role-memory-service、evidence-service、completion、coverage；composition/create-platform；app/host；business/workflow/workflow；workspace/access、capture、architecture-source；contracts/dispatch；PRODUCT/对齐文档。

补充只读取证：grep `resolveRoleBinding`/`authorizeConfiguration`/`assertCurrent`/`createSourceCaptureAccess`，读 `coverage.ts`、`views.ts:1280-1359`。未核（缺口）：completion-policy.ts、plan-task-basis.ts、control-service.ts、execution-history-service.ts、query-job-service.ts、mailbox-service.ts、plan-write-admission.ts、session-directory/lifecycle、Kernel vendor 实现；H3/H6/H8 的“整块复制”判断因此标注证据不足。行号与所给源码一致。

## 2 假设逐项

**H1 重复解析 Role/manifest/身份链 —— 部分证实（含一处真冗余），非整体合理分层。**
最短链：prepare（execution-preparation.ts:174 角色、:195 Host）→ start（execution-driver.ts:317 再解析、:327 再取 Host）→ authorizeRuntimeEntry（execution-entry-service.ts:949→:528 recheckHostRoleAdmission）→ begin（:1088 再 recheck）→ 模型签发（model-call-service.ts:123 admitEnteredRun）→ 模型消费（:223 admitEnteredRun）。
一次 1 请求 Run 的角色矩阵解析次数 = prepare 1 + start 1 + authorize 2 + begin 2 + 签发 2 + 消费 2 = **10 次**。其中“2 次”是真冗余：recheck 自己先 :541 `resolveRoleBindingFacts`，随后 :572 调 `authorizeConfiguration`（组合根 create-platform.ts:148），其 :153 再次 `roles.resolveRoleBinding`，role-memory-service.ts:794 又转调 `resolveRoleBindingFacts`。两次之间无提交或可达变化；返回的 `roleFacts.guards` 来自第一次、Host 判定来自第二次。
其余跨边界重解析有合法可达变化：authorize→begin、签发→消费之间 Run revision 改变，begin 与消费分别受 `freshRunControlProblem`（execution-entry-service.ts:151-159）和 permit CAS（model-call-service.ts:243）约束。故不能删整段准入，只能消除 recheck 内部双解析。manifest 正文（execution-entry-service.ts:784→:361）按 digest+origin 不可变，每个边界重读并全量校验是次强候选，但只支持“可缓存”，不足以断言当前错误。

**H2 固定配置被当动态状态反复验证 —— 部分证实为对生产不可达状态，但属端口新鲜度分层。**
LocalWorkbenchHost 首 await 前快照（host.ts:92-100、137）；`permissionRevision` 是冻结配置的纯哈希（:123-130）；resolveRoot/authorize 只读内存 Map（:176-193）；`sourcePolicyFor` 为闭包（:165-171）。因此 execution-driver.ts:607-612 的 `assertCurrent` 与 observed-model-run.ts:215/220 的前后校验在当前产品恒相等、无法失败；authorize 只是 Map+sha256，不是磁盘瓶颈。
反证不足：`WorkspaceHostBindings` 是对外端口，但仓内生产实现只有 LocalWorkbenchHost；createSourceCaptureAccess 的动态性来自 ledger（source-capture-access.ts:163-168），不在 Host authorize。按“不能仅举接口理论可变”，H2 的重复验证确属防御不可达；删除只会损失非本仓 Host 的新鲜度保证，故不建议删。

**H3 Work/Query 重复执行状态机 —— 状态机合理分层；重复的是共享纯归约 helper。**
Query 无 control ack、无 pendingTerminals、无 advanceLocator、无 Session/Lease 释放，却多出答案抽取（query-observation.ts:136-199）与 entered 写入（:293-343）；Work 有 outcome_unknown 判定与终态缓存（execution-observation.ts:183-186、490-604）。合并只会引入分支。
真冗余：execution-observation.ts:106-150 与 query-observation.ts:76-113 的 `decodeEntry`/`findTurnStart`/`reduceFromStart`/`applyEvents`/`turnIsComplete` 近乎逐字相同且 correctness-critical。

**H4 Workflow/UI 中间步骤只是往返中继 —— 合理分层（证据推翻）。**
workflow.ts:496-580 `selectNext` 做排序、eligibility、Session 复用/创建、gate 生产者选择；:118-130 `nextAfterRound` 在 executing/interrupted 时返回 null，不许跳步；:582-699 每步只调一个 owner。UI `drainContinuation`（main.ts:1173-1220）保存 `resumeIntent`、等待态原请求、每页步数上限；views.ts:1293-1303 只转发 next 或 stop，不重算身份。这些是恢复/决策事实，内聚会把同样逻辑复制到其他消费者。

**H5 capture/材料正文/observed 架构重复分析或保存同一来源 —— 合理分层。**
capture.ts 产出内存临时快照（:83-587，含 release tombstone 与 expiry）；architecture-service.ts:505-585 复用 capture 的 relations，经 mapArchitectureSource（architecture-source.ts:25-51，“the one pure mapping used by both…”）再写持久 body+pointer，:588 释放临时 capture。解析复用、正文职责不同。:516 与 :546 对同一 capture verify 两次，但 `body.put` 位于两窗口之间，非重复。

**H6 Run/Attempt/outbox/authorization/operation 只是复制状态 —— 合理分层（部分证据不足）。**
recordRunResult（execution-entry-service.ts:1292-1442）一次提交写五类记录，字段与读者不同：Run 持 outcome/seq/eventId；Attempt 持 status/endOutcome 且可挂 review work（dispatch.ts:327-338）；Outbox 持 dispatchState；Lease 持 holder/release；Session 持 occupancy/historyCursor。readExecution（run-state-service.ts:314-471）与 model-call guards（model-call-service.ts:71-83）依赖这些区分。ExecutionAuthorizationV2 内嵌 Run（dispatch.ts:107-123 明确不建独立聚合）。operation 记录与 Kernel 侧未核，“整记录复制”证据不足；仅 Attempt.endOutcome 与 Run.outcome 字段可推导，但删字段会牵动 lease.attemptId/guards，不建议。

**H7 Task/Session/历史投影成为多个可独立修改的事实源 —— 合理分层。**
Run.executionHistory 是 Kernel 区间定位器（graph-execution-history.ts:220-264 只读定位、不解析正文）；Session.historyCursor 由同一终态提交写入（execution-entry-service.ts:1416-1419），终态前由 advanceLocator 单调推进（execution-observation.ts:653-670）；TaskReduction/GoalPhase 只嵌 evidence/round/reduction refs（completion.ts:404-431、568-578）。投影只读或以引用为准，未形成第二本 transcript。

**H8 Evidence/校验层建立第二套 owner 或防御不可达 —— 合理分层。**
finalize 与 complete 调用同一纯函数 coverage.ts:76-121 `selectEffectiveEvidenceSet` 与 :152-198 `evidenceApplicabilityWithBasis`，是共享实现而非第二 owner。校验面对真实可达变化：check-execution.ts:117-128 在 begin 后复核 root/permission，evidence-service.ts:858-873 复核 source 是否仍匹配，直接对应撤权/取消/版本变更。唯一薄弱点与 H2 同源（Host authorize 静态）。

## 3 清理建议

1. **消除 recheckHostRoleAdmission 内部双解析**：让组合根 `createAuthorizeConfiguration` 接收已解析的 `roleResolution`，或 recheck 只解析一次并复用结果。必须保留：每个 commit 边界前的 Host 权限/模板/预算复检与 guards 生成。删除会损失：跨 authorize/begin/模型边界的撤权与版本变化检测。影响消费者：authorizeRuntimeEntry、beginRuntimeEntry、admitEnteredRun（签发/消费）、mailbox-service.ts:663、plan-write-admission.ts:349——均在同一 helper 下。风险最低。
2. **抽出 observation 共享纯 helper**（decodeEntry/findTurnStart/reduceFromStart/applyEvents/turnIsComplete）。必须保留两侧各自的终态、答案、占用与控制 ack 语义；强行合并两侧 observation 会混淆 Query 无 control 的生命周期，禁止。
3. **manifest 正文解析可加 Run 级缓存**（Work/Query 各一处）。必须保留 digest+origin+inputDigest 校验；只缓存解析结果，不省校验，否则损失不可变正文的防篡改证据。

## 4 独立发现与最值得主审复核的三点

1. **recheckHostRoleAdmission 双解析**（execution-entry-service.ts:541→:572→create-platform.ts:153→role-memory-service.ts:794）。全报告最确定的“重复实现”，且两次结果被当作一对使用，建议优先核对是否应传参复用。
2. **两个 observation 文件的纯 Kernel helper 逐字重复**（execution-observation.ts:106-150 对 query-observation.ts:76-113）。建议核对能否安全提取，且不要顺手合并状态机。
3. **createSourceCaptureAccess 的无 runtime 分支在生产无调用者**：仅 source-capture-access.ts:232/296 两处，均传 `runtime: binding`；`if (!runtime)` 分支（:192-199）只服务兼容/测试。按“缺消费者不自动等于冗余”，仅登记为“正常路径可能缺失”，需主审确认是保留兼容还是标注未消费。

反对主审之处：H3/H5/H6/H7/H8 我判为合理分层或证据不足，未发现可删整块实现；H2 的重复验证是内存纯函数，不应作为性能或磁盘问题上报。

STOP


## 后续定向复核与主审取舍

用户授权继续探索与窄范围执行。主审暂缓共同历史函数提取：预估仅净减约20行，先处理更明确的重复准入。旧source-access无runtime分支已核当前仓内无生产调用；缺省runtime的测试在resolveRoot提前返回，并未覆盖该分支。删除前还须处理该类型签名及测试调用，不仅凭grep直接删除。本轮先执行同次角色解析复用，不混入其它候选。

以下追加保留DSH定向意见，属于候选：



### 1 Work/Query observation 四个私有函数对比

真实相同逻辑（逐字一致）：`decodeEntry`（execution-observation.ts:106-116 对 query-observation.ts:76-86，均校验 encoding/text、`sessionRecordSchema`、position|recordId|sessionId 一致性）；`findTurnStart`（:117-126 对 :87-96，匹配 `turn.started` 的 runId/turnId）；`applyEvents`（:132-142 对 :97-107，过滤 `agent.event` 后 `reduceRunState`）；`turnIsComplete`（:143-150 对 :108-113，`activeModelRequest===null` 且 batch 全 settled）。两处 `settledStatus`（:86-88 对 :73-75）亦完全一致。

必要类型差异：仅 `kernel` 形参名义类型不同（Work `KernelExecutionBinding`，Query `QueryEntryIdentity['kernel']`），函数体只读 runId/turnId，两者结构同形；`reduceFromStart`（execution:127-131）只在 Work，Query 确无（主审已核）。共享函数可收窄为 `{runId;turnId}`，不丢类型检查。

现有测试覆盖：四函数均未导出，只能经 `observeRun`/`observeQuery` 间接覆盖。Work 较厚（tests/runtime/B2-runtime-execution.test.ts 多处、R4-control-runtime.test.ts:198、composition/B2-runtime-platform.test.ts:34、C2-runtime-platform.test.ts:200）；Query 仅 tests/runtime/R5b-query-session-loop.test.ts:225 一处，较薄，但函数体相同。

净行数估算：两文件删定义约 45+38=83 行；新共享模块需 import、`DecodedRecord`、`settledStatus`、四函数、`isRecord` 约 58-62 行；两文件各加 import 约 2 行。净减约 17-21 行。

结论：**不值得**。为约 20 行净减引入新文件与迁移，属“为几十行加通用框架”；Query 覆盖薄还需补证据。若将来同批已因他故触碰 observation，可顺带提取。

### 2 createSourceCaptureAccess 无 runtime 分支

生产调用：仅 source-capture-access.ts:232、:296 两处，均传 `runtime: binding`。导出入口：package.json 为 private、无 `main`/`exports`；`src/*.ts` 无 index/barrel；全仓 import 仅 tests/runtime/R4c-source-authority-guards.test.ts:22。无生产外部消费者。

测试使用：同测试 `accessFor`（:140-143）令 runtime 可选；无 runtime 调用仅 :151、:160，两者 `resolveRoot`（unavailable/unsupported/not_found）在建 sandbox 前即返回，**走不到 `authorize` 的无 runtime 分支（source-capture-access.ts:192-199）**；其余全部传 `workBinding(root)`。该分支在生产与测试中均无断言覆盖。

删除影响：只需给 :151/:160 补 `workBinding(root)`；因 `policyFor(root)` 与绑定 root 一致，`resolveRoot` 结果不变，`loadRejection` 覆盖完整保留，无有效业务覆盖损失，可迁到实际 runtime 调用。

结论：**可实施（低风险）**——`runtime` 收为必填，删 :192-199 与 :163/:180 的 null 守卫。**需要再证据**的一点：仓库外是否存在依赖该可选签名的 Host 组装；仓库内无导出入口，倾向可删。

STOP
