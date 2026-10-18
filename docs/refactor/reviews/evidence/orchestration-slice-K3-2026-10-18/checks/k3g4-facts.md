只做了只读核对，未运行测试或构建。下面 A 指可先做且不依赖 U3/U6/U7；B 指接在 4C-2 B 合入之后。文件引用省略共同目录前缀。

**已确认旧缺口仍在。** `workflow.ts:1239` 让 `needs_decision`、`awaiting_approval` 返回 `pass`；普通领取不读核对记录，`reviewPending` 没有生产者（`claim-service.ts:987`、`claim-service.ts:1039`；消费处 `run-machine.ts:633`）；AV-2b 所需 reviews 没进 `workFailureInput`（`plan-service.ts:891`）。因此不能把当前“有记录但仍接续”当作已完成的行为。

1. 各行已有代码、剩余工作及分段

| 规格部分、行 | 已有；还缺什么 |
|---|---|
| **Workflow 门禁、selectNext：08 A** | 核对用途已只接控制输入，邮件留给普通接续（`execution-driver.ts:980`）；还需验证 wait 发送及混合批次两条完整流程。 |
| **18 A/B** | `requeueConfirmed` 纯规则已有（`task-failure.ts:1091`），Workflow 和决定原因读取尚未传入（`workflow.ts:1383`、`goal-decision-reader.ts:383`）。A：补门禁、确认事实传递，验（二）（三）（五）及（四）不出普通确认；B：验（一）答核对卡后不重复确认、（四）队列确有核对卡。 |
| **47（二）—（四）A** | TaskRow 已读核对记录，但 `invalid/unsupported` 读失败被跳过（`plan-readers.ts:1701`、`plan-readers.ts:1722`）；（二）还缺普通领取拒绝和 AV-2b。租约复用已有（`requeue-service.ts:860`），（三）（四）已有 owner 用例（`K3-26-unknown-call-review-storage.test.ts:693`、`:418`），接线后保留其行为。 |
| **hold/release、“我来处理”、D3：15、41、43** | hold/release 状态转换已有，公开 owner 仍拒绝 unsupported（`state/unknown-call-review.ts:558`、`unknown-call-review-service.ts:729`）。取消专用判断含 paused 已有（`review-lease.ts:41`），Workflow 尚无取消步骤（`business/workflow/contracts.ts:80`）。**A：15（四）—（七，含 M1）、43 全部、41（二）（三）**；补 owner、路由、UR3h/UR8、普通领取记录存在/不存在 CAS、hold 的租约与选定 Run CAS、release 后人的重排及两步重放。**15（三）**卡上进入 held 属 B，held 后拒绝重排、释放与接续属 A；**15（一）（二）、41（一）属 B**。现有领取仅对核对领取加记录守卫（`claim-service.ts:1315`）。 |
| **恢复 L29、启动 2b/6b：09、25—29、44** | **09 A**：UR3a/UR4/UR5、最近持有者已接（`workflow.ts:1185`、`:1226`），缺逐断点重启验收。**25 A**：Host 先查回执、owner 同提交建记录已具备（`create-platform.ts:1798`、`run-reconcile-service.ts:930`）。**26 A/B**：清单校验、记录创建已有；七—九已有 owner 断言（`K3-26-unknown-call-review-storage.test.ts:193`、`:372`）；A 补真实 Kernel 清单场景，B 补出卡。**27 A**：最近持有者及关闭/退路调用已有（`workflow.ts:1276`），缺成功、冲突、退路后历史及第二轮闭环。**28 A**：认定理由/身份已保存（`run-reconcile-service.ts:956`），补原 Run 重排一次、核对轮不计次。**29 A/B**：答复提交/落实/补记断点属 B，其余可 A；卡触发的提方案恢复也属 B。**44（二）A；（一）（三，M2）B**。启动报告无 reviews，6b 无历史答复载荷（`startup-reconcile.ts:118`、`:374`）；注意现有 6b 已扫描全部未进入 Run，并非只查选定 Run。 |
| **提方案轮：16 B；46（二）B** | 提方案状态转换及 5,120 字节判断已有（`state/unknown-call-review.ts:315`），但 owner 未实现，运行准入明确拒绝 proposal（`unknown-call-review-service.ts:723`、`review-admission.ts:122`）。缺工具、准备、准入、方案定稿、批准/否决及接续全文。纯函数、渲染器可先做 A 部分；合法进入 awaiting_proposal 必须经过答卡，整行不能无卡验收。 |
| **卡及文字：20 B；46（一）B；18 的卡断言 B** | 来源身份类型已有（`goal-decisions.ts:83`）；实际队列只注册 goal_cause、planning_question（`create-platform.ts:831`）。缺两阶段核对卡、选项/作用对象/原因/全文/旧版本验证，及 U7 分页、单卡读取、稳定窗。20 的三页读取全部留 B。组 3 遗留的 03、10、11、13、19、37、42、45 出卡断言亦在此补；不能因记录状态已有就算验收完成。 |
| **处置与答复应用：15（一）（二）及（三）卡入口、17、41（一）、44（一）（三）B** | 处置/批准状态转换已有（`state/unknown-call-review.ts:488`）；owner 和未补记答复读取均未实现（`unknown-call-review-service.ts:708`、`:726`）。事件 codec 要求处置 proof，但公共提交函数未传 proof（`unknown-call-review-codecs.ts:698`、`unknown-call-review-service.ts:250`）。接续装配还固定 `disposition:null`（`continuation-brief-assembly.ts:293`）。缺真实①②③、暂停延后、双向重试、历史答复补③及处置文字。 |
| **shell/request：B2-01—18** | **10 A，已有纯解析器**（`command-normalization.ts:429`）。其余有 CRR 纯状态机，但公开层目前只有接口（`state/command-rerun-request.ts:107`、`command-rerun-request-contracts.ts:42`），现有 before_tool 只处理 read（`execution-driver.ts:859`）。**01/02**缺持久拦截与批准方案例外；**03/05/06/12/14/18**缺请求 owner、去重、注明写法和读写上界；**04/09/13**缺答复、一次性消费及崩溃重放；**07/08**缺强制人工卡及任务结束关闭；**11/17**缺目录、脚本展开和读取预算；**15/16**缺保存结果重放、卡读保存 match、运行中重读与分页计数。上述整行均 B；解析/展开可独立做 A 组件，但没有合法卡处置产生 blockedCommands，不能把组件测试当整行验收。 |
| **大小：35（二）（三）B；48（三）A/B** | 接续渲染已有必需区保留框架（`continuation-brief.ts:346`），未填处置必需文字；方案计量函数仍是私有副本，cwd 换行未按规格处理（`state/unknown-call-review.ts:826`）。35 可先补 A 渲染组件，真实批准后 prepare 留 B。48 的 settle/hold/release 属 A，批准/处置属 B；还必须补最终 512 KiB 检查，当前 required 直接放行（`state/unknown-call-review.ts:222`）。48（二）的方案理由预算也留 B。 |

2. g4a 留给 g4b 的接口

需要在施工书中明确以下接缝，A 不另造 U3/U6/U7：

- UCR 的 `recordProposal/applyDisposition/listUnappliedAnswers`；共用提交、重放返回正式回执及 proof 的接缝。目前接口见 `unknown-call-review-contracts.ts:41`、`:75`、`:96`，回放只返回值和 cursor（`unknown-call-review-service.ts:228`）。
- Task 事实中的 `reviews/reviewUnreadable/requeueConfirmed`，以及普通领取、重排共用的核对记录守卫（`task-failure.ts:736`、`:1070`）。
- Workflow 的 `cancel_review_round` 与后续 `apply_review_disposition`；UR6 的来源 blocker、UR7/UR7b 的答复驱动入口（现有操作表 `business/workflow/contracts.ts:80`）。
- 启动 `reviews` 报告、开放记录恢复项，以及按答复自己的 reviewRef 驱动的历史补记载荷；不能只留下 taskIds（`startup-reconcile.ts:131`）。
- 接续说明的 disposition/批准方案字段及同一个 `approvedMethodLinesZh`；已有形状见 `continuation-brief.ts:114`。
- CRR 读写口、Runtime 注入及②与钩子共用的工作区读取口；已有声明见 `command-rerun-request-contracts.ts:18`、`:42`，工作区口见 `workspace/ports.ts:196`。
- B 合入后注册两类卡来源、两类应用适配和相应 proof decoder；按 `.lead-ref/s4c2b-impl.md:32`、`:42`、`:54` 增行。

上述 A 行可经公开认定、核对、直接 hold/release、控制、重排、领取和启动 owner 做闭环，不需要造卡状态。**16、35（二）（三）、46（二）及除 10 外的 B2 整行不能无卡完成。**

3. 仍需 lead 补定的最小问题

- **M2 从哪个公开口按 Goal 找历史答复？** 规格要求 Goal 索引，但现口只收 reviewRef，启动只传 taskIds（`unknown-call-review-contracts.ts:41`、`startup-reconcile.ts:131`）。最小选项：扩现读口支持 Goal；或新增一个 Goal 扫描口，仍复用同一内部读取。
- **CRR 消费证据、结果和 proof 的契约是什么？** `consumeAllowance` 没有 callId，记录也只有 usedAt；request 返回值无法表达规定的无写成功分支（`command-rerun-request-contracts.ts:44`、`:64`；`contracts/command-rerun-request.ts:48`）。至少补结果联合、消费身份及持久字段；proof 可并入 CRR changed 事件，或另定应用事件。之后才能注册 U3。
- **无写分支怎样保证“同调用原结果”？** 规格 L19a:528 要求重放，B2-18:1500 又要求这些分支零写。最小选项：明确仅由 Kernel 保存结果承担；或允许独立回执写入并修正零写断言。
- **CRR 关闭和恢复由谁驱动？** CRR-06 只写“任务结束的处理”；纯转换已存在，但没有关闭端口（`state/command-rerun-request.ts:198`、`command-rerun-request-contracts.ts:42`）。选项：任务生命周期同提交关闭；或可恢复的后续关闭。CRR 暂停答复及①②③崩溃恢复也没有对应 Workflow 行：扩共享应用恢复枚举，或补专用恢复行。
- **脚本展开怎样取得静态 cd？** 当前公开解析结果只有动作，导航段被丢弃（`command-normalization.ts:7`、`:374`）。选项：同一解析器提供内部带目录轨迹结果；或扩公开结果，保留现有动作投影。
- **B2 接续附加段是否必需、怎么限长？** 规格:534 要逐条列被拦命令，但 L20 的预算未包含此段；现有说明字段也未容纳它（`continuation-brief.ts:124`）。最小选项：允许按现有正文规则略去并计数；或规定必需上限、纳入容量拒绝。

重基后另有**已裁定、无需新产品决定**的缺口：`record_note` builder 已抽出（`note-tool.ts:192`），但种类表和提交查找未接（`unknown-call-kinds.ts:31`、`create-platform.ts:1634`），按 U1 补。4C-2 A 的注记来源装配、8A 的根目录归属已有，未发现需改其语义的冲突（`context-assembler.ts:1534`、`path-ownership.ts:48`）。

4. 旧测试需要怎样变

- WP1 认定后直接重排，须补人的 hold/release（`WP1-handover-fixture.ts:370`、`:390`）；依赖它的交接用例只调整新增核对节、卡数量相关断言。
- KA-14 自动接续例须先处理不完整清单卡（`K-W-maintenance.test.ts:269`、`:310`）；KA-09 认定来源例同样不能越过门禁（`K-R-attested-facts-source.test.ts:154`、`:183`、`:252`、`:321`）。纯干净中断例不因此翻转。
- 暂时拒绝 proposal 的断言要换成真实方案工具准入规则；错误工具清单仍拒绝（`review-admission.test.ts:120`、`K3-19-review-admission.test.ts:73`）。
- I-23 尚未进入世界解码及检查器，S1 world 也未纳入 UCR（`invariants.ts:392`、`:2154`；`S1-workflow-archive-fixture.ts:115`）。生产可达性白名单按实际接线逐项移除（`production-reach-allowlist.json:1133`、`:1332`）；工具常量测试补 record_note/request 注册覆盖（`K3-34-tool-name-constants.test.ts:17`）。
- §5.3 多项已经落实，不重复翻转：A8 清单断言已有（`A8-host-restart.test.ts:658`、`:735`），owner 认定草稿已有（`A8-host-restart-attestation.test.ts:92`）。`unknown-call-review.test.ts:742` 的“无限制”标题应改准确；其 200,000 字节例本身未超过 512 KiB，不应改成拒绝。

5. 规格旧行号对照

以下“规”是 K3 SPEC 行号；同一文件的旧号与当前号顺序对应：

- 规171：`execution-driver.ts` 97→**107**；`observed-model-run.ts` 258→**286**。
- 规336/1243：`claim-service.ts` 1135→**1294**；规359：`execution-preparation.ts` 292→**435**；规406：`execution-entry-service.ts` 392→**397**。
- 规450/1301：`task-failure.ts` 136/384/779→**137/390/882**。
- 规502/781：`execution-driver.ts` 766/774/919→**857/864/1006**。
- 规556—586：`continuation-brief.ts` 179/195/235/255/274/284/287/337/496/514/643/689/1036→**251/267/307/327/346/361/364/434/593/611/873/919/1315**；`context-assembler.ts` 949→**1480**；`claim-service.ts` 1092→**1235**；`create-platform.ts` 752→**838**。
- 规597/1183/1246/1314/**1429**：`workflow.ts` 895/905/1865→**947/957/2083**；`run-machine.ts` 1712/1767→**1882/1937**；`business/workflow/ports.ts` 108→**111**。
- 规666：`run-reconcile.ts` 373→**411**；规734：`decision-read-model.ts` 1043→**1048**；规1062：`startup-reconcile.ts` 94→**96**。
- 规780：`workspace/ports.ts` 185→**196**；`workspace-tools.ts` 53→**71**；`capture.ts` 125→**146**；`create-platform.ts` 1260→**1911**；`core-routes.ts` 325→**371**；`execution-contracts.ts` 220→**247**。

6. 生产行数粗估

按上述划分，**g4a 约 1,100—1,700 行，g4b 约 2,800—4,200 行**。不计测试、文档、已完成纯状态/解析器，也不重复计算 4C-2 B 正在建设的 U3/U6/U7；CRR 持久化、展开、钩子和恢复是 B 的主要工作量。