# 第 5 片冻结规格：目标设置与决定

> **状态：** lead 冻结，2026-10-08。代码基线 9b94fc55（src 与 676a7a7b 相同；收尾的全量测试在 676a7a7b 上是 215 个测试文件、5234 项全部通过）。§0 是 lead 的冻结说明；§1–§8 是 Codex（推理强度 xhigh）按 585f1ac0 写的草稿正文，lead 按 §0 改过：改过的地方标【lead 改】，lead 定的技术选择标【lead 定】。**§0 与正文不一致时以 §0 为准。** 依据：[DESIGN §8.2](../DESIGN.md#82-分片表) 第 5 行、§1.1–1.4、§2.3–2.7、§6、§7.2、附录 C；HANDOFF 决定 37、39、42、43；[分片总说明](README.md)。

## 0. 冻结说明（lead）

### 0.1 OPEN：要用户定

无。草稿 §7.2 的四条 lead 核对过，设计原文都已定（DESIGN §1.4“目标暂停时卡照样能答、落实等继续”；§1.1“秘书不猜，等那个先采用，或者在一个方案里一起改”；§1.3 自动返工进“请知悉”是 lead 的做法、用户可改，本片照写；§1.4“和选项一起送达提问的一方”）。§3.2 的自治动作表逐行对过 DESIGN §1.3 的表，一致。

### 0.2 lead 定的技术选择（一行一项，理由在括号里）

草稿 §7.1 的 8 项：
- **T01** 每个请求当前候选的唯一性：用 RecordStore 已有的 unique claim（键是完整 Goal + 第一轮 QueryJob）。（同一次提交能证明唯一；不把无关写变成竞争。）选 A。
- **T02** 暂停后落实：答复记下“内容基础”（目标、活动计划、设置），继续以后只允许 Goal 的控制字段变了的版本重定位，提交仍按当前 pin 做 CAS。（用户不用重答；内容变了照样拒。）选 A。
- **T03** 模块依赖：只加 `configuration → state`（通知位置的状态机），`views` 按 B0 的声明；**不加** `communication → configuration`、`communication → architecture`。（这两条边只为“初始化采用的补记”服务，本片不做这项，见 L1。）选 A 的缩小版。
- **T04** 旧通知的位置：新记录在创建提交时用 RecordStore 的 `since` 绑定记下创建位置，公开 DTO 不变；旧记录没有 `since` 的按（时间、itemKey）排在前面。（Store 只能绑定顶层 `since/until`；不用最后一次更新的位置冒充创建位置。）选 A。
- **T05** “已看到哪儿”的显示页 token：Host 进程内随机密钥做 HMAC，不存表，重启后要重新读页。（`configuration` 在 L2，不能往上读消息、返工记录去核对位置；token 让它只核对“这一页真的发给过客户端”。）选 A。
- **T06** 不是消息的卡的答复：新建一条用户发的 `SessionMessage`，直接写成 responded@1，正文另存一个 part，加一个按来源的 unique claim。（一条记录一次提交一个目标版本；不伪造 agent 的提问。）选 A。
- **T07** 七种来源由一个 `views` 汇总读者合并，各来源有窄读者，共用首读的 cursor。（同一张卡在主对话和队列里身份一致。）选 A。
- **T08** 共用的纯类型放 contracts，端口留在 model。（state 只依赖 contracts。）选 A。

lead 另定的 4 项：
- **L1 “初始化采用”的补记推到第 6 片。** 草稿让本片能给“缺初始架构 / 缺完成标准”这类卡补记落实，为此要在架构目录的采用事件里加 `decisionReceipt`、改 `architecture/catalog-record-codecs.ts` 和 `catalog-service.ts`，并给 `communication` 加两条依赖。DESIGN 把“按答复授权的变更”放在第 6 片（§2.3、§8.2 第 6 行）。本片的做法：这类卡照样出现在队列里（来源 2，带“采用初始架构 / 采用完成标准”两个动作，走已有接口）；你在卡上写了答复的，`recordDecisionApplication` 对架构、政策这两种改动回 `unsupported`，卡留在“已答复、待落实”；采用发生以后，原因消失，卡按草稿的既有规则读作 `closed` / `source_resolved`。删去草稿的 F84、F85、AP10、AP11 和 §2.8 那一段。补记本片只支持 `GoalSettingsChanged` 和 `PlanRevisionAccepted`。
- **L2 文档和边界测试不在 DSH 写范围。** 草稿的 F77（`tests/architecture/boundaries.test.ts`：它用自己的临时目标文件测检查器，不需要为 `views` 改）、F79–F83（STATE-MACHINES-SPEC、`module-target.json`、`module-dag.md`、能力索引、HANDOFF）删出写范围：`module-target.json` 由 lead 在 B0 写好，其余文档由 lead 验收后同步。
- **L3 职责类型用共用文件。** 草稿的 `AgentDutyV1` 改为 `PlatformDutyV1`，从 `src/contracts/platform-duty.ts` import（取值相同）。本片按 [README](README.md)“共用文件”的原文逐字节新建这个文件（sha256 `6adfb57e8bcb7ec387257e19c3811abb61a5fd21d37a8889566bf34cc32a9e39`；第 1、3 片也建同一个文件，内容相同，合并时不冲突）。`configuration/message-duties-adapter.ts` 仍是过渡接缝（按 composition 注入的精确映射），第 3 片合入后由 README 的 I-2 换成读第 3 片的职责。
- **L4 `pureDirectories` 已退役。** 草稿 §7.1 末段说“不把 pureDirectories 删掉”：820817c3 已经让 `state` 用 `pure: true`，顶层 `pureDirectories` 再写就报错。照现状，不改 `module-target.json`。

### 0.3 对草稿的改动清单

| # | 位置 | 改动 |
| --- | --- | --- |
| 1 | §2.8“初始化source…”一段、§3.3 补记 proof 一段和末段、§5.3 AP10/AP11、§6.3 F84/F85 | 去掉初始化采用的补记（L1） |
| 2 | §6.3 F77、F79–F83 | 移出写范围（L2） |
| 3 | §2.6、§3.2 | `AgentDutyV1` → `PlatformDutyV1`（L3） |
| 4 | §7.1 末段 | `module-target.json` 由 B0 写；不加 communication 的两条边；`pureDirectories` 已退役（T03、L4） |
| 5 | §7.1 | 每行标【lead 定】 |
| 6 | §6.3 末段、§8.1 | 数量按 §0.6 |

### 0.4 和第 1、3 片的接缝

三片从同一个基线（第 0 片合入、B0 提交之后）各开一个副本并行施工，按 1 → 3 → 5 的顺序合入，本片最后合入（[README](README.md)）。本片要知道的：
- **和第 1 片同改的文件**（合入本片时由 lead 合并，两边的新增都保留）：`state/message-machine.ts`、`model/communication-contracts.ts`、`sessions/message-record-codecs.ts`、`communication/mailbox-service.ts`、`agent-runtime/execution-inputs.ts`、`tasks/claim-record-codecs.ts`、`tasks/claim-service.ts`、`tasks/requeue-service.ts`、`tasks/plan-readers.ts`、`tasks/execution-entry-service.ts`、`queries/query-record-codecs.ts`、`contracts/ledger.ts`、`business/workflow/` 下的 `workflow.ts`、`ports.ts`、`contracts.ts`、`consultation.ts`，`app/` 下的 `core-routes.ts`、`core-http-types.ts`、`collaboration-driver.ts`，`composition/create-platform.ts`，`tests/architecture/state-writes.test.ts`。第 1 片在消息上加 `replyHandler`、`archiveWaitDisposition` 两个可选字段和一个 `replyHandler` 索引，在 `TaskRequeueSnapshotV1` 上加 `archiveOrigin`；本片不碰这些字段。
- **和第 3 片同改的文件：** `app/core-routes.ts`、`app/core-http-types.ts`、`composition/create-platform.ts`、`agent-runtime/execution-contracts.ts`、`agent-runtime/execution-driver.ts`、`tasks/execution-entry-service.ts`、`tests/architecture/production-reach-allowlist.json`。
- **执行改过的文件**（冲突提示的一半）要第 2 片；本片按草稿用 `executed-files-stub.ts` 如实读作 `not_available`。
- **合入后的接线：** README 的 I-2（发信职责读第 3 片的职责）、I-4（第 3 片装配器的 goalSettings 接本片的自治级别）、I-5（本片“请知悉”的 `undelivered_reply` 类别接第 1 片的未送达回复）、I-6（第 3 片装配器的 decisions 接本片的决定队列）。【审查改】I-5、I-6 原来没有；本片这两处在接上之前如实读作 `not_available`。

### 0.5 lead 抽查的代码出处

在 9b94fc55 上用 `grep` 核对了草稿引用的约 25 个 `file:symbol`，都存在，例如 `persistence/record-codecs.ts:368 writtenGoalHasExactShape`、`:511 encodeWorkspaceSnapshot`、`:532 encodeGoalSnapshot`、`:562 decodeWorkspaceSnapshot`，`configuration/project-bootstrap-record-codecs.ts:workspaceSnapshotFromValue`，`state/goal-machine.ts:nextGoalDesiredState`，`contracts/ledger.ts:seqOfCommitCursor`，`record-store/ports.ts:UniqueClaimChange`，`tasks/initial-plan.ts:parseInitialPlanningResponseV2`，`state/verification-machine.ts:roundChainHead`，`agent-runtime/communication-tools.ts:createSessionMailboxTools`，`sessions/message-body-envelope.ts:decodeStoredMessageBody`，`tasks/plan-service.ts:commitHostPlanProposal`，`persistence/graph-repository.ts:readCreatedGoal`，`state/task-failure.ts:446 nextRequeueAutoCount`（agent 发起的已计数，草稿说“复用，不加第二个计数”属实）。§5.5 点名的已有测试文件全部存在。和当前代码不符的只有 L4（`pureDirectories`）。

### 0.6 精确数量（冻结）

- 新正式 aggregate 0；已有记录上的新字段：Goal 的 `settings`、Workspace 的 `decisionSettings`、消息的收信方“你”/`goalRef`/`decision`/`application`/新答复形状、候选计划的 `requestRef`/`notAdopted`；新事件类型 4 个（`GoalSettingsChanged`、`WorkspaceNoticeSeenChanged`、`SessionMessageDecisionAnswered`、`SessionMessageDecisionApplied`）；新索引 5 个（§2.5 的 4 个加 §4.2 的 `query-job-by-workspace-goal`）；状态行 23 行（S5-GS-01…06、S5-AU-01…04、S5-MSG-01…06、S5-PLAN-01…05、S5-NT-01/02，见 §3.1 表；其中 S5-MSG-01、S5-PLAN-03、S5-PLAN-05 是改造已有行，其余新增）；新路由 12 个（§4.5）；新工具 3 个（`send_user_message`、`read_user_decision`、`record_decision_application`）。
- 文件 82 个：新建 41、修改 41。其中源码 62（新建 23、修改 39；新建里含共用文件 `src/contracts/platform-duty.ts`，§6 F89），新测试文件 16 和测试支持文件 2，改动的已有测试文件和检查 2（`tests/architecture/state-writes.test.ts`、`tests/architecture/production-reach-allowlist.json`）。逐个文件见 §6（去掉 F77、F79–F85，加 F89、F90 之后的 82 行）。【审查改】加了 F90 `tests/business/S5-decision-workflow.test.ts`。
- 用例 153 个：单元 63（GS 15、PO 16、MD 14、PC 10、NS 8）、服务 71（SS 16、UM 13、RC 11、DQ 9、AP 14、NR 8）、路由 8、Runtime 7、Workflow 2（WF01、WF02）、场景 2。服务用例在 memory 和 SQLite 各跑一次，共 224 次。【审查改】加了 SS15、SS16、UM13、AP14–AP16、WF01、WF02（审查发现的测试缺口）。
- 估计行数（不是验收数字）：生产代码约 4,700–6,700 行，测试约 1,800–2,600 行。
- 任务书：[slice-5-book-part1.md](slice-5-book-part1.md)（骨架和测试，然后停）、[slice-5-book-part2.md](slice-5-book-part2.md)（实现）。

---

以下是草稿正文（Codex，基线 585f1ac0），已按 §0 改过。

## 1. 范围和依据

### 1.1 权威及追踪

HANDOFF 决定 42、43 → 已定产品行为 → DESIGN 当前正文 → 分析模型。MODEL 中的 `step/auto`、毫秒时间、字符串 ref 及旧 AMB 参数不能照搬；生产使用现有完整 ref、ISO 时间、GraphWrite 和结果类型。

| 阅读输入 | 本片对应内容 |
| --- | --- |
| DESIGN §8.2 第 5 行 | 完整范围、依赖 2/3、接口验收；来源 4 由片 4 加，来源 7 由片 7 加 |
| DESIGN §1.1–1.4 | 请求候选、目标设置、冲突、自治表、七来源、自由文字/批注、暂停取消 |
| DESIGN §2.3–2.7、§2.11、§6、§7.1–7.2、附录 C | 不新建决定/请求/卡记录；两次提交、纯判断、职责边界、接口和归属 |
| DESIGN §9.1 第 9–13、23 条、§9.2、附录 E“决定 42” | 已定答案及 lead 做法标签 |
| model/MODEL.md O04/07/15–29/43/50，R12–18/24–31 | 外部事实、原 owner、状态维度、同一卡身份；按决定 42 修正旧分析 |
| model/AMBIGUITIES.md、model/REVIEW-SLICES-1-3-5.md | 已定的第一行优先于保留的建议和选项 |
| E3-UI-ITEMS 5.5/5.8/5.9/5.10-4、G4-1、D42-1/3/4/5/6 | 自动重新检查也须出通知；缺初始化是目标原因；UI 后做 |
| HANDOFF 顶部决定 20–43 | 图/事实/角色边界；决定 36/43 的 DSH 两阶段；42 的答案；43 的归档中断豁免 |
| STATE-MACHINES-SPEC §1/3/10/14/15 | 稳定行 id、拒绝码、原回执、只由 state 写状态、实施顺序 |
| DSH-WORKFLOW §6；module-target.json；module-dag §6 | 精确任务书、窄写、13 子模块与禁止方向 |

实现决定：15/17（当前 DESIGN 引用的已定行为）、20/21/22/25/29/35（Q12/13/14/16/17、推出 8）、36/37/39/40、42 第 3–11 条及末尾技术项、43。42 第 1/2 条仅接通知和归档后待落实保留边界，不施工归档。

实现 AMB：7(a)、8(b)、9(b)、10(a)、11(a)、12（lead：非消息答复生成用户消息）、14(a)、15(b)、24(a)、28(a)、32（按请求；其他请求只派生 stale；放弃记未采用）、42(a)、54(a)、61（参谋/书记确认回复，独立审阅不授）、66(a)。AMB-43 接片 1 的未送达来源；其余片的未定 AMB 不在此裁定。

### 1.2 In / out

In：目标自治/顺序/固定等待对象/双计划版本风险设置及标签；足迹冲突建议；用户收件地址、职责发信限制和用户答复；七来源只读队列；已答复/已落实/补记；自由文字和对象批注；请求候选及目标+请求索引；逐类别请知悉位置；自动返工/自动重新检查通知；现有入口的自治/等待守卫。

接口结果：冲突卡三项并列；两目标风险标签；每请求一个当前候选，其他请求方案过期但卡保留；待答与已答待落实分栏；文字/批注读回；看某类别第一页不会吞掉其他类别或后页。读取不调用模型、不确认消息、不推进工作。新画面由 E3 实现。

| 后片 | 后续增加；本片提供的 seam |
| --- | --- |
| 1 | 归档/来历/异常锚点/转交；此片不改 Session，已答未落实不按 sender 是否归档过滤 |
| 2 | Run 改过的文件、节点详情；替换 executed-files stub，算法/DTO 不变 |
| 3 | 正式职责配置和 Runtime 装配；替换 duties stub，共用 policy 纯函数 |
| 4 | 注记与审查；补第 4 来源和 note_review 通知，不建空注记表 |
| 6 | 请求归属、挑秘书、问秘书/重出、主对话聚合、完整 decisionRefs 授权的目标/计划变更 |
| 7 | secretary_turn 发信、待放行/不发及计时、三版派工、到期、通知秘书/第二次通知参谋、唤醒、agent 返工工具 |
| 8/E3、K/K2、9 | 冻结界面、Kernel 接续/压缩、真实规模验收 |

默认 `after_plan_confirmation`；两档的第一个计划/目标卡都由用户确认。结构改动、目标/验收/范围变更、超预算、上报、长期职责换手都交用户。policy 覆盖这些动作，不新增尚不存在的写工具。

风险标签、通知折叠样式、第二次通知参谋按“决定 42 的 lead 做法”提出冻结建议，不写成用户逐项批准。没有已知本片产品 blocker；接缝不能替用户补的行为见 §7.2。

## 2. 数据、兼容与索引

### 2.1 通用规则及样板

shared source/settings/footprint/position 纯类型新增在 `src/contracts/goal-decisions.ts`；消息纯类型在 `src/contracts/core/session-message.ts`。ProposedPlanRequestV1 / CandidateRequestExtensionV1、服务 ports/依赖和视图 DTO 在 WorkGraph/model；原 PlanProposalRef 类型只在 model 使用，state 的镜像使用相同完整形状或 PlanProposalSnapshot["ref"]，不从 contracts import model。state 只依赖 contracts 和自身目录，不能依赖 model/RecordStore/时钟/id/crypto。

复用 `contracts/core/identity.ts:CommandMeta/VersionPin`、`model/task-contracts.ts:GraphWrite`。完整 ref 的 canonicalJson 是 key。注入 UTC ISO 时间；整数须 safe。record revision 从 1；输入 pin 0 翻译为 Store 的 expectedRevision:null。PlanSnapshot.revision 固定 1；计划版本识别用完整 PlanRevisionRef，展示用 planRevision，不能用 Goal.revision 代替。

正文存 ArtifactRef；复制 `sessions/message-body-envelope.ts:decodeStoredMessageBody`、`communication/mailbox-service.ts:storeMessageBody` 的 scope/message/part/sender envelope。正文 16 KiB UTF-8，上限回 capacity，空值回 invalid。body store 与 ledger 两库不是原子事务；失败可能留未引用正文，不能声称发信成功。

### 2.2 Goal / Workspace 设置：零个新 aggregate

```typescript
type GoalAutonomyV1 = 'every_step' | 'after_plan_confirmation';
type GoalParallelRiskV1 = {
  otherGoalRef: GoalRef;
  selfPlanRef: PlanRevisionRef | null;
  otherPlanRef: PlanRevisionRef | null;
};
type GoalSettingsV1 = {
  schemaVersion: 1;
  autonomy: GoalAutonomyV1;
  order: number;
  waitForGoalRef: GoalRef | null;
  parallelRisks: GoalParallelRiskV1[];
};
// GoalSnapshot.settings?: GoalSettingsV1
type NoticeCategoryV1 =
  | 'member_notice' | 'second_expiry' | 'handoff' | 'note_review'
  | 'undelivered_reply' | 'automatic_rework' | 'continuation';
type NoticePositionV1 =
  | { kind: 'legacy'; occurredAt: string; itemKey: string }
  | { kind: 'commit'; cursor: CommitCursor; itemKey: string };
type WorkspaceDecisionSettingsV1 = {
  schemaVersion: 1;
  noticeSeen: Partial<Record<NoticeCategoryV1, NoticePositionV1>>;
};
// WorkspaceSnapshot.decisionSettings?: WorkspaceDecisionSettingsV1
```

Goal 设置归 tasks；Workspace 设置归 configuration。缺 Goal.settings 用 `{schemaVersion:1,autonomy:'after_plan_confirmation',order:0,waitForGoalRef:null,parallelRisks:[]}`，缺 Workspace.decisionSettings 用 `{schemaVersion:1,noticeSeen:{}}`。不回写旧记录。仅缺字段可默认，坏 ref/枚举/浮点/负 order/损坏 JSON 回 unavailable。

旧 order=0 按完整 Goal key 升序打破平局；显式排序写该 Workspace 全部 Goal 连续 `0..n-1`。分页没读完不能写半张排序表。设置只增 Goal.revision，不动 desiredStateRevision/requestedBy、Plan、Run、Session 或积压待放行消息。

风险每个 otherGoal 最多一个保存项，新双版本替换该项；历史由事件/答复保留。保存于选择时该冲突对排序靠后的 Goal，重排不搬。读两个方向，双 Plan pointer 都匹配才有标签。null 是确切无计划，不是通配符。

样板：`persistence/record-codecs.ts:decodeGoalSnapshot/encodeGoalSnapshot/decodeWorkspaceSnapshot/encodeWorkspaceSnapshot`。保持 GoalSnapshot@1/WorkspaceSnapshot@1，扩允许字段和 default helper；`configuration/project-bootstrap-record-codecs.ts:workspaceSnapshotFromValue` 同步接受新设置。新增 GoalSettingsChanged@1、WorkspaceNoticeSeenChanged@1 保存完整原结果、actor、requestId；回执模式抄 `tasks/goal-control.ts`，不从当前记录猜重放。


兼容的精确边界：raw codec保留旧可选字段缺席的公开形状，不把默认值加进旧返回或原receipt。decodeGoalSnapshot/decodeWorkspaceSnapshot严格接受缺字段；新 `readGoalSettings` / `effectiveWorkspaceDecisionSettings` / `candidateRequestRef` helpers在消费点返回上文确定默认值。新ports对旧记录行为因此完整有默认，但旧Session/Plan/Goal ports和回执仍可通过原深等断言。已经存在的新字段必须在decode/encode/旧事件还原时原样保留，不能沿旧显式字段白名单删掉。默认不是存储迁移。

`state/goal-machine.ts:nextGoalDesiredState` 当前逐字段构造，必须增加仅在原goal.settings存在时复制其值；newGoalSnapshot仍可缺省（第6片建目标时再支持同事务设置）。nextGoalPointer原spread保留settings，勿重写。record-codecs.ts的writtenGoalHasExactShape、GoalDesiredStateChanged事件解码也接受新字段并保留；否则暂停/继续会清空设置。原created event/旧回执不补settings。

### 2.3 消息扩展（既有 SessionMessage aggregate）

```typescript
type UserMessageRecipientV1 = {
  kind: 'user'; projectId: string; workspaceId: string;
};
type MessageRecipient = SessionRef | UserMessageRecipientV1;
// SessionMessageIntentV1 增加 'decision_request'，旧 SessionRef 地址不改形状。
type DecisionObjectV1 =
  | { kind: 'aggregate'; pin: VersionPin; label: string }
  | { kind: 'file'; workspace: WorkspaceScope; path: string;
      digest: string | null; label: string };
type DecisionAnnotationV1 = { objectKey: string; text: string };
type DecisionOptionV1 = {
  id: string; label: string; effect: 'apply' | 'reject' | 'defer';
};
type DecisionSourceV1 = {
  kind: 'message' | 'goal_cause' | 'candidate' | 'note_review'
    | 'planning_question' | 'goal_conflict' | 'message_release';
  key: string; goalRef: GoalRef; pins: VersionPin[];
  goalBases?: GoalDecisionBasisV1[];
};
type DecisionSelectionV1 =
  | { kind: 'option'; optionId: string }
  | { kind: 'other' }
  | { kind: 'conflict_wait'; earlier: GoalRef; later: GoalRef }
  | { kind: 'conflict_order'; goalOrder: GoalRef[] }
  | { kind: 'conflict_parallel'; earlier: GoalRef; later: GoalRef };
type DecisionMessageMetadataV1 = {
  schemaVersion: 1; source: DecisionSourceV1;
  objects: DecisionObjectV1[]; options: DecisionOptionV1[];
  syntheticAnswer: boolean; forwardedFrom: SessionMessageRef | null;
};
type UserMessageResponseV1 = {
  sender: MessageHostSender;
  bodyRef: ArtifactRef; sourceRef: SourceRefV1; respondedAt: string;
  decision: {
    selection: DecisionSelectionV1; source: DecisionSourceV1; // 【审查改】答复时 owner 生成的 canonical 来源（含 pins、goalBases），§2.3、§2.8、§3.3 读的 response.decision.source
    annotations: DecisionAnnotationV1[];
    requiresApplication: boolean;
  };
};
type DecisionApplicationReceiptV1 = {
  identityKey: string; fingerprint: string; cursor: CommitCursor;
};
type DecisionApplicationV1 = {
  schemaVersion: 1; actor: ActorRef; appliedAt: string;
  receipt: DecisionApplicationReceiptV1;
  changes: { before: VersionPin; after: VersionPin }[]; basisRebases?: GoalControlRebaseV1[]; // 【审查改】§2.8 的控制重定位证明；缺省读作 []（AP09）
};
// SessionMessage.recipient: MessageRecipient
// SessionMessage.response: 旧 MessageResponse | UserMessageResponseV1 | null
// SessionMessage.goalRef?: GoalRef | null
// SessionMessage.decision?: DecisionMessageMetadataV1
// SessionMessage.application?: DecisionApplicationV1 | null
```

新消息语义归 communication；原 codec 在 sessions，保持任务 D 的路径。DecisionHostSenderV1放contracts；model原MessageHostSender改兼容type alias，body值不变。state/SessionMessageRecord 的镜像同时改，用类型等价测试钉住。缺 goalRef/decision/application = null/无决定元数据/null；旧 Session 消息公开返回仍保留旧可选形状。

decision_request 只给 User recipient，needsReply=true；work_run 可 waitAfterSend=true；2–4 个唯一选项 id。other 是额外输入途径，不算模型选项。用户 notify/decision 都带真实所属 Goal、发信 Session；source Goal 必须与可信 Run 相同。用户不是 Session。

界限：objects ≤32，annotations ≤32；每批注 ≤2048 UTF-8 bytes，总批注 ≤16 KiB；option id ≤64 bytes、label ≤512 bytes；source.key ≤8192 bytes；整消息元数据编码 ≤64 KiB。objectKey=canonicalJson(object)，批注 key 必须来自卡且不重复。选了选项可无文字；无选项必须非空文字或至少一条非空批注，记 other。原文不 trim 改写。文件 path 沿用 Workspace 相对路径边界，不自行 lower-case、展开 `..` 或打开文件。


提问和答复的基础分开：message.decision.source保存提问引用；response.decision.source保存本次答复看到的canonical source/pins/goalBases。应用/补记使用后者。readDecisionCard在当前窗口生成答复source，Goal控制变化更新显示pin和内容基础，不改提问历史；有关Plan/候选/文件引用仍按原正式对象版本，不靠新Goal pin授权旧Plan。caller传source必须等于本次正式reader生成的来源，不能自己加引用。source.pins不含消息自己的pin，消息卡只在meta.expected另带该message当前版本，避免read@2与提问@1成为重复pin。非消息卡的对象pin仍在source.pins。read/answer不改对象，用户答复后的真正变更仍需owner校验这些版本。

response 的 decision 与旧 status 分离。reject/defer requiresApplication=false；other=true，不从自然语言推“接受”。普通 Session 消息仍按旧规则回复，新用户入口不能回复它。

非消息卡：生成用户发的 SessionMessage，recipient=user、intent=notify、decision.syntheticAnswer=true、status=responded@1。原 part=message 和 response 各存绑定自己的 envelope，保存原文；不伪造 agent 的提问或正式 Query Answer。不再作为来源 1/member_notice 生成卡。消息卡写原单 response 槽，不生成第二条回复消息。

沿用 SessionMessageSent/Responded@1，新增 SessionMessageDecisionAnswered@1（合成答复）、SessionMessageDecisionApplied@1，事件保存完整当时结果。样板：`sessions/message-record-codecs.ts:checkSessionMessageBody/SESSION_MESSAGE_RECORD_SCHEMAS`；必须一并改回复 sender 与 body-envelope 验证，不能只扩顶层 union。

本片不开放 query_run 自由发信。片 7 的 secretary_turn 必须以保存 Query/claim/role/generation 校验，不把现有 MessageQueryAnswerSender（只用于正式 Answer 关联回复）变成一般发信人。


用户答复正文的精确保存约定（解决“只选项/只批注时原body不得为空”）：

```typescript
type UserDecisionBodyV1 = {
  schemaVersion: 1; kind: 'user_decision_response';
  selection: DecisionSelectionV1; text: string;
  annotations: DecisionAnnotationV1[];
};
```

response envelope的text存canonicalJson(UserDecisionBodyV1)，原16KiB wire正文边界仍有效；先校验自由文字/批注各自边界，再校验编码总量，不能承诺所有上限能同时填满。synthetic的message part也存同payload，两个part仍各自绑定。新的body读取根据正式message.decision/response识别并严格解码，返回原text；选择和批注还须与正式response metadata深等，损坏回unavailable。旧Session消息正文不尝试JSON解码。读取不能从自由文字解析“同意”。option且无文字时text=''，wire非空；只批注时亦然。原文的空格/换行保存原样，不沿旧normalizeText trim。自由文字容量包括UTF-8编码后的wire字节。

### 2.4 请求候选、唯一槽

```typescript
type CandidateRequestExtensionV1 = {
  requestRef?: QueryJobRef | null;
  notAdopted?: {
    reason: 'replaced' | 'not_selected' | 'abandoned';
    requestedBy: ActorRef; at: string; replacedBy: PlanProposalRef | null;
  };
};
// candidate_v2.status 加 'not_adopted'，保留旧 'rejected'；legacy_v1 只读。
type ProposedPlanRequestV1 = {
  goalRef: GoalRef; basedOn: PlanRevisionRef | null;
  draft: PlanRevisionDraft; reason: PlanChangeReason;
  requestRef?: QueryJobRef | null;
  replaces?: { proposalRef: PlanProposalRef; revision: number } | null;
};
```

归 tasks，codec 在 persistence。PlanProposal@2/Recorded@2 加可选字段；effective requestRef默认null、raw缺席仍缺席；无 requestRef = 独立候选，不把 null 候选挤进同一组。无 notAdopted 不推断放弃。保持 PLAN-01 允许 Host 写基于旧计划的草稿；不能通用加 basedOn 必须当前的 guard。采用照 PLAN-06 拒 stale。

requestRef 指第一轮 QueryJob，不是 meta.requestId/QueryRun。暂仅接受真实同 Goal、用户发起的第一轮；通过 §2.6 seam 证明 root。缺事实回 unsupported，不猜请求根，不新建 Request 表。

每个非 null 请求 unique claim：`s5-request-candidate:` + canonicalJson({goalRef,requestRef})，owner=完整 proposalRef key。首候选 expectedOwner=null；替换带真实 head ref/revision，同一 commit 旧记 not_adopted/replaced、新 rev1、槽 owner→新 owner。采用/放弃 owner→null。不同请求完全不碰。旧迭代历史可读；失败无记录/事件/槽变化。

采用成功只写该请求 head；其他请求记录/revision 逐字节不变，stale 由 basedOn 与活动 pointer 派生。重出只发动作描述给片 6，读取不调用秘书。放弃记 not_adopted、reason=abandoned，没有 abandoned 新状态。

取消 Goal 时候选卡立即 closed/read_only、closedReason=goal_cancelled，待答数归零；底层候选历史保留，采用/迭代/放弃回 invalid。不枚举改写整个历史来阻断取消；旧槽不再授权终态 Goal 的新写入。

### 2.5 索引、通知 origin 与游标

| 常量 / 名称 | aggregate 与精确 paths | 注册子模块 |
| --- | --- | --- |
| S5_USER_MESSAGE_BY_GOAL / s5-user-message-by-goal | SessionMessage: ref.projectId, ref.workspaceId, recipient.kind, goalRef.goalId | sessions/message-record-codecs.ts |
| S5_MESSAGE_BY_WORKSPACE_STATUS / s5-message-by-workspace-status | SessionMessage: ref.projectId, ref.workspaceId, status | 同上 |
| S5_DECISION_ANSWER_BY_SOURCE / s5-decision-answer-by-source | SessionMessage: ref.projectId, ref.workspaceId, decision.source.kind, decision.source.key | 同上 |
| S5_PLAN_PROPOSAL_BY_REQUEST / s5-plan-proposal-by-goal-request | PlanProposal: ref.projectId, ref.workspaceId, goalRef.goalId, requestRef.queryJobId | persistence/plan-record-codecs.ts |

沿用 plan-proposal-by-goal、GOAL_BY_WORKSPACE_INDEX、sender Session、Run/Task/round 精确索引。追加到原唯一 aggregate codec，不重注册。缺 path 值为 null；用户 query 使用 recipient.kind=user，不混 Session inbox。

非消息答复 unique claim：`s5-decision-answer:` + canonicalJson({projectId,workspaceId,kind,key})，owner=合成消息完整 key。不同 requestId 的双入口也只有一条答复；抢槽失败映射 revision_conflict，同身份换正文为 idempotency_conflict。indexGuards/indexChanges 仍 `[]`，不造 SQL/索引表。

通知必须按事实创建提交排序，不能用最后 ack cursor、当前 readThrough、wall clock 或 ref-key。新通知 wire 增 `NoticeOriginWireV1={since?:CommitCursor|null;noticeAutomationCap?:number}`，创建提交用 commitCursorBindings `{refKey,field:'since'}`。涉及原 SessionMessage、TaskRequeue、Round 的 codec 注册（注册commitCursorFields=["since"]，保留原字段/索引）；后片来源遵守同约定。新自动reverify的noticeAutomationCap由evidence owner使用本次正式policy.autoReworkLimit填0..MAX_AUTO_REWORK_LIMIT；它是wire通知元数据，不改RoundChain计数/旧public DTO，更新原Round时必须复制。原RoundReverifyFactV1没有cap字段，不能假称已有。

origin 与旧 public domain DTO 分离：新增 decodeNoticeOrigin(record)，旧 decoder 返回原 DTO，encoder 加可选 origin 参数。后续更新须复制原 since，不能重绑；旧事件回执 value/cursor 保持原样。旧记录缺 since 读 legacy(occurredAt,itemKey)，不迁移回写；null 仅 PreparedCommit 可有，已落盘的新 origin 仍 null 回 unavailable。

排序：legacy 先于 commit；legacy 按 ISO 时间/itemKey，commit 按 ledger cursor/itemKey。views/notice-position.ts 是新 ReadModelIndex 唯一比较点，只在此用 contracts/ledger.ts:seqOfCommitCursor 比较（当前源码没有 compareCommitCursor 导出），并在其消费者说明中加入该具名读模型。其他层不解析 cursor；state 接收服务算好的 movement=forward/same/backward。token/HMAC失效（含Host重启后旧页token）回invalid要求重读页；原markSeen回执先lookup，因此重启后同身份重放仍成功。

每类连续分页；seenThrough 只含该响应真正发给客户端的最后一条。合并后未展示的源项不能越过。UI 显示完成后提交 markSeen，读不自动标已看。token 绑定 Workspace/类别/过滤/调用者/读水位/完整 after key，不建逐条已读表。

### 2.6 先做本片的接缝

```typescript
interface GoalExecutedFilesPort {
  readGoalExecutedFiles(ctx: CoreCallContext, input: {
    goalRef: GoalRef; atLeastCursor?: CommitCursor;
  }): Promise<ReadResult<{
    availability: 'available' | 'not_available';
    files: { runRef: RunRef; path: string; certainty: 'definite' | 'possible' }[];
    possiblyIncomplete: boolean;
    guards: readonly RecordGuard[];
    sourceCursor: CommitCursor | null;
  }>>;
}
// 【lead 改：L3】不另定义 AgentDutyV1：用共用文件 src/contracts/platform-duty.ts（README“共用文件”）的 PlatformDutyV1
// （'executor' | 'secretary' | 'adviser' | 'scribe' | 'reviewer'）。
interface MessageDutiesFactsPort {
  readMessageDutiesFacts(ctx: CoreCallContext, input: {
    sessionRef: SessionRef; roleBinding: RoleBindingRefV1;
  }): Promise<ReadResult<{
    duties: PlatformDutyV1[]; readOnlyCopy: boolean; independentReview: boolean;
    guards: readonly RecordGuard[];
  }>>;
}
interface CandidateRequestFactsPort {
  readCandidateRequestFacts(ctx: CoreCallContext, input: {
    requestRef: QueryJobRef; goalRef: GoalRef;
  }): Promise<ReadResult<{
    root: boolean; initiatedByOperator: boolean;
    currentSecretary: SessionRef | null; guards: readonly RecordGuard[];
  }>>;
}
```

executed-files stub 在 tasks：not_available、files=[]、possiblyIncomplete=true；Plan 模块仍可比，completeness 明写缺执行文件。片 2 只替实现；possible 文件也保留为观察足迹证据，不宣称归属确定。

duties 临时适配在 configuration：先走现有 RoleBindingFactsPort.resolveRoleBindingFacts，再用 composition 注入的精确 RoleSpec pin / legacy template revision→duties 测试映射。不能按模板名称/Skill 文本/模型 JSON 猜。无映射的新用户发信回 unsupported，旧 Session→Session 行为不变。片 3 替换正式事实，guards 加入发送 commit；stub 不成为发布默认授权。

request 暂用真实 QueryJob goal/initiator，明确第一轮才支持；片 6 求正式 root 和 currentSecretary。本片不靠 currentSecretary 授权采用。

来源 4/7 和未来通知通过 views 的只读 SourcePage adapter 注入；默认 `{availability:"not_available",items:[],nextCursor:null,sourceCursor:null}`，capabilities 明写缺来源，不写“全部 0 件”。不建空注记/等待/待放行记录。

### 2.7 state 写入保护

新增保护 GoalSnapshot.settings、WorkspaceSnapshot.decisionSettings、SessionMessage.decision/response/application、CandidatePlanProposal.requestRef/status/notAdopted。只由 state 构造；allowlist 仅具名 decoder，不放行服务或整文件。since 是 RecordStore 创建 wire 的 origin，后续保持。

没有新增 AggregateRef 联合成员。普通拒绝无写入；既有 ReworkOutcome.kind=refused 仍是正式拒绝记录的 committed 回执，不能当作已返工。

### 2.8 完整辅助类型、暂停后的基础和事件 proof

```typescript
// contracts/goal-decisions.ts；不含 Goal 的控制字段，都是已保存内容的精确快照。
type GoalDecisionBasisV1 = {
  goalRef: GoalRef; workspaceRef: WorkspaceRef; objective: string;
  activePlanRef: PlanRevisionRef | null; settings: GoalSettingsV1;
};
type GoalControlRebaseV1 = {
  captured: VersionPin; actualBefore: VersionPin; basis: GoalDecisionBasisV1;
};
type DecisionChangeProofV1 = {
  acknowledgementRef: SessionMessageRef;
  capturedPins: VersionPin[];
  changes: { before: VersionPin; after: VersionPin }[];
  basisRebases: GoalControlRebaseV1[];
};
type GoalFootprintV1 = {
  goalRef: GoalRef; planRef: PlanRevisionRef | null;
  plannedModules: ModuleRef[];
  executedFiles: { path: string; moduleRef: ModuleRef | null;
    certainty: 'definite' | 'possible' }[];
  executedFilesAvailable: boolean; possiblyIncomplete: boolean;
};
type GoalConflictFactsV1 = {
  overlaps: boolean; moduleRefs: ModuleRef[]; filePaths: string[];
  possiblyIncomplete: boolean;
};
// model/decision-contracts.ts：正式 facts 的派生读结果，不是新 GoalPhase cause schema。
type GoalDecisionCauseReadV1 = {
  source: DecisionSourceV1;
  code: string; taskRef: TaskTriple | null; runRef: RunRef | null;
  action: DecisionActionV1 | null;
  objects: DecisionObjectV1[]; options: DecisionOptionV1[];
};
// token payload，wire = base64url(UTF8(canonicalJson(payload))) + '.' + lowercase HMAC-SHA256 hex。
// composition只生成一次32字节随机key并传token factory；不持久化/不读Host凭据，不作为用户设置。
type NoticeDisplayTokenPayloadV1 = {
  schemaVersion: 1; workspace: WorkspaceScope; operator: ActorRef;
  goalRef: GoalRef | null; categories: NoticeCategoryV1[];
  sourceCursor: CommitCursor; queryCursor: string | null;
  returnedKeys: string[];
  seenThrough: Partial<Record<NoticeCategoryV1, NoticePositionV1>>;
};
interface NoticeDisplayTokenPort {
  issue(payload: NoticeDisplayTokenPayloadV1): string;
  verify(token: string): NoticeDisplayTokenPayloadV1 | null;
}
interface NoticePositionComparatorPort {
  compare(a: NoticePositionV1, b: NoticePositionV1): -1 | 0 | 1;
}
```

每个用于答复的新source包含canonical goalBases；它由owner从正式Goal生成，不能信caller自报基础。旧消息/source缺goalBases默认[]，既有逻辑不改；这些旧答复若需要跨控制revision落实而缺基础，回incomplete并留待落实，不能从当前Goal补造过去基础。basis中的settings先用§2.2 default标准化；parallelRisks按otherGoal key确定排序后比较。message.response.decision.source是答复basis，不能拿提问时的message.decision.source代替。缺新application.basisRebases默认[]；异常形状仍unavailable。

暂停时答复捕获Goal@r；继续后Goal@r+k可能只改了desiredState、desiredStateRevision、desiredStateRequestedBy及revision。服务读当前Goal，state `goalDecisionBasisMatches(captured,current)` 比较ref/workspaceRef/objective/activePlanRevision/规范化settings逐字段深等；相同且当前active才可执行。实际提交用当前Goal pin CAS，正式修改事件保存capturedPins和basisRebases。【审查改】只比答复捕获的内容基础和当前 Goal 的内容（与下一段、§0.2 T02、任务书规则 4、GS14/GS15、SS11/SS12 一致）：暂停中内容改过又改回到与捕获完全相同，按相同处理，可以落实（SS15）；当前内容任一字段不同就回 revision_conflict。不读中间的 Goal 事件链（`GoalRecordTransactionPort` 没有按版本扫事件的接口）。

控制重定位只适用于Goal aggregate。T02-A按同内容基础和实际CAS证明：保留captured pin，当前owner核对ref/workspace/objective/Plan/settings深等，当前active且未取消，用当前Goal revision guard提交；事件明确记captured/actualBefore。比较的是当前内容，曾经改过又改回相同内容不产生新的内容授权差异；并发变化由当前pin拒绝。其他source对象（候选、注记、消息、Query Answer、架构/政策active pointer）仍按原pin。T02-B在内部显式重新核对后生成具名basis，不要求用户重答；若lead选它，须冻结重新核对输入/原答复引用的proof字段和case，不留给DSH自定。

新event body按现有 `configuration/project-bootstrap-record-codecs.ts:ProjectBootstrapEventBody` 风格，纯声明在model/decision-contracts，encoder/decoder在persistence/decision-record-codecs：

```typescript
type DecisionWriteEventBaseV1<T> = {
  eventId: string; schemaVersion: 1; occurredAt: string;
  identityKey: string; fingerprint: string;
  projectId: string; workspaceId: string; actor: ActorRef; requestId: string;
  payload: { value: T; proof: DecisionChangeProofV1 | null };
};
type GoalSettingsChangedEventV1 = DecisionWriteEventBaseV1<
  GoalSnapshot | {goals: GoalSnapshot[]}
> & { eventType: 'GoalSettingsChanged' };
type WorkspaceNoticeSeenChangedEventV1 = DecisionWriteEventBaseV1<WorkspaceSnapshot>
  & { eventType: 'WorkspaceNoticeSeenChanged' };
// 在 sessions/message-record-codecs.ts，用已有私有 SentEventBase，不发明另一套消息事件。
type SessionMessageDecisionAnsweredEventV1 = Omit<SentEventBase, 'actor'> & {
  eventType: 'SessionMessageDecisionAnswered'; actor: MessageHostSender;
};
type SessionMessageDecisionAppliedEventV1 = Omit<SentEventBase, 'actor'> & {
  eventType: 'SessionMessageDecisionApplied'; actor: ActorRef;
};
// contracts/plan.ts：PlanRevisionAcceptedEvent.payload 加可选
// acknowledgementRef?: SessionMessageRef; decisionApplication?: DecisionChangeProofV1;
```

GoalSettings事件value与对应WriteResult.value同shape；无变更新身份仍可提交仅回执event，不增加records版本，proof.changes=[]，防止no-op无法幂等重放。Workspace事件proof=null；notice同/倒退位置也保存no-op回执event，state.effects=[]。消息Answered/Applied仍带完整message，与SentEventBase原scope/requestId/occurredAt校验相同，receipt按消息原mode绑定其eventId/请求指纹；不是给旧消息event补identityKey。所有新event schema均1，无新event aggregate。既有Accepted缺ack/proof可读，不能假称可证明新答复落实。

【lead 改：L1】本段推到第 6 片，本片不实现：对架构目录、完成标准的改动，`recordDecisionApplication` 回 `unsupported`，卡留在“已答复、待落实”；采用发生以后原因消失，卡读作 `closed` / `source_resolved`。不改 `architecture/catalog-record-codecs.ts`、`architecture/catalog-service.ts`，`communication` 不加依赖。下面是草稿原文，只作记录：初始化source只有首次 active ArchitectureBaseline/CompletionPolicy absence pins（0）和Goal语义基础。补记白名单复用原 `architecture/catalog-record-codecs.ts:decodeArchitectureCatalogAdoptedEvent`、`configuration/project-bootstrap-record-codecs.ts:decodeProjectCompletionPolicyActivatedEvent`：receipt版本必须从0→1、scope一致、由同operator明确发起、正文答复selection是该卡合法采用选项；不支持把任意后续目录编辑补成“采用初始架构”。架构初次采用事件新增可选decisionReceipt?:{identityKey:string;fingerprint:string;actor:ActorRef;requestId:string}（旧事件缺省不回填；缺此proof的旧采用回incomplete）。catalog-service用本次正式commit的真实字段填入，codec严格验证；不是让调用者自报actor。政策Activated事件沿已有identity/fingerprint/actor/requestId。原事件没有ack ref时只允许该operator补记一次，并由实际active-pointer receipt版本+原卡absence pin证明对应关系；原架构/政策owner不因这个proof获得新权限。其他不在白名单的变更回unsupported，后片再加正式接口。

自动动作卡从现有原GoalDisplay.causes和真实Task/Run/round/拒绝事实派生；新增 `state/decision-policy.ts:automationDecisionCause` 接受保存事实ref/pins及action，仅every_step/超过cap需要确认时返回具名code=`automation_confirmation_required`、affected refs和合法动作，不写GoalPhase。当自治改为after_plan_confirmation，该待答原因若尚未被答且已不适用，派生closed/source_resolved；已答待落实的历史仍保留。source identity包含action+affected ref版本，不能把后来另一Run当同一决定。

## 3. 状态机行及 owner

### 3.1 纯状态机和固定迁移表

表列沿用 STATE-MACHINES-SPEC §1.4；以下 id 不占旧 PLAN/MSG/GOAL 编号，施工时在原规格相应节附上对应行。`现状` 是草案基线，不代表已交付。每个接受行用 Transition 的 next/effects，拒绝用 reason+CoreError；服务映射为 CoreRejection 并保留 CAS current。同一事件非法状态回 invalid，guard 不过按下表，旧 pin 回 revision_conflict。

新增 `state/goal-settings-machine.ts`：transitionGoalSettings、buildGoalSettingsRecord、goalStartPolicy、goalConflictFacts。新增 `state/decision-policy.ts`：decisionActionPolicy、canSendUserMessage。新增 `state/notice-settings-machine.ts`：transitionNoticeSettings、buildWorkspaceDecisionSettingsRecord。扩展原 message-machine/plan-machine；不要从服务直接 spread 覆盖受保护字段。

```typescript
type GoalSettingsEventV1 =
  | { type: 'settings_set'; settings: GoalSettingsV1 }
  | { type: 'order_set'; order: number }
  | { type: 'wait_selected'; predecessor: GoalRef }
  | { type: 'risk_accepted'; risk: GoalParallelRiskV1 };
type GoalSettingsGuardV1 = {
  operator: boolean; goalExists: boolean;
  desiredState: GoalDesiredState; pinMatches: boolean;
  sameWorkspace: boolean; predecessorExists: boolean;
  waitingCycle: boolean; pairPlanPointersMatch: boolean;
};
function transitionGoalSettings(
  state: GoalSnapshot, event: GoalSettingsEventV1, facts: GoalSettingsGuardV1,
): Transition<GoalSnapshot, GoalSettingsEventV1, GoalSettingsEffectV1>;
type GoalSettingsEffectV1 = { type: 'goal_settings_changed' };
type GoalStartActionV1 =
  | 'claim' | 'enter' | 'continue_work' | 'small_task' | 'dispatch_action'
  | 'readonly_query' | 'propose_plan' | 'continue_existing';
function goalDecisionBasisMatches(basis: GoalDecisionBasisV1, current: GoalSnapshot): boolean;
function goalConflictFacts(a: GoalFootprintV1, b: GoalFootprintV1): GoalConflictFactsV1;
function goalStartPolicy(input: {
  action: GoalStartActionV1; goal: GoalSnapshot;
  predecessor: null | { exists: boolean; cancelled: boolean;
    formallyCompletedForActivePlan: boolean };
}): { allowed: boolean; reason: 'goal_stopped' | 'waiting_predecessor' | null };
// 【审查改】§3.1、§2.8 点名、原来没给签名的纯函数，冻结如下（state 只 import contracts；Transition 来自同目录）。
function buildGoalSettingsRecord(goal: GoalSnapshot, settings: GoalSettingsV1): GoalSnapshot;
// 只写 settings 和 revision+1；desiredState、desiredStateRevision、desiredStateRequestedBy、activePlanRef 等其余字段逐字段原样。
function buildWorkspaceDecisionSettingsRecord(workspace: WorkspaceSnapshot,
  settings: WorkspaceDecisionSettingsV1): WorkspaceSnapshot; // 只写 decisionSettings 和 revision+1
type NoticeSeenUpdateV1 = { category: NoticeCategoryV1; position: NoticePositionV1;
  movement: 'forward' | 'same' | 'backward' }; // movement 由服务用 NoticePositionComparatorPort 算好
type NoticeSettingsEventV1 = { type: 'notices_seen'; updates: NoticeSeenUpdateV1[] };
type NoticeSettingsGuardV1 = { operator: boolean; tokenValid: boolean; tokenCoversUpdates: boolean;
  pinMatches: boolean }; // tokenValid 由服务验过 HMAC、Workspace、过滤后给出；state 不碰密钥
type NoticeSettingsEffectV1 = { type: 'workspace_notice_seen_changed' };
function transitionNoticeSettings(state: WorkspaceSnapshot, event: NoticeSettingsEventV1,
  facts: NoticeSettingsGuardV1): Transition<WorkspaceSnapshot, NoticeSettingsEventV1, NoticeSettingsEffectV1>;
// 拒绝的先后：operator=false→forbidden；tokenValid=false 或 tokenCoversUpdates=false→invalid；pinMatches=false→revision_conflict。
// 只有 movement='forward' 的类别改成新位置；一项 forward 都没有时 next 等于原值、effects=[]（NS03、NS04）；
// 否则 next 经 buildWorkspaceDecisionSettingsRecord，effects=[{type:'workspace_notice_seen_changed'}]。
function automationDecisionCause(input: {
  autonomy: GoalAutonomyV1; action: DecisionActionV1; actorClass: ReworkActorClass;
  countedNext: number | null; cap: number; affected: VersionPin[];
}): null | { code: 'automation_confirmation_required'; action: DecisionActionV1; affected: VersionPin[] };
// 同样输入下 decisionActionPolicy 返回 'needs_decision' 时非 null（affected 按 canonical ref 排序、去重），其余返回 null。
```

state 声明不能 import model/GraphWrite/RecordGuard；下述签名中的 contracts 类型需实际 import，Transition 来自同目录。source 读失败由服务先返回，不用 `exists=false` 吞 unavailable。【审查改】message-machine、plan-machine 的扩展沿各自现有写法加成员：S5-MSG-01 沿用 `message_sent`（改造 MSG-02）；`MessageEvent` 加 `{ type: 'user_decision_answered' }`、`{ type: 'synthetic_decision_answered' }`、`{ type: 'decision_application_recorded' }`（S5-MSG-05 是同一事件在 requiresApplication=false 时的拒绝）；`SessionMessageChange` 加 `decision_answered`、`decision_applied` 两种；plan-machine 的事件名照下表 event 列。每行 guard 列的事实写成守卫上下文的布尔或枚举字段，DSH 在第一段逐个列进 UNSPECIFIED，lead 审第一段时冻结（这是类型的写法，不是新行为；行为以下表为准）。

| # | from | event | guard（拒绝） | to | effects | 幂等/重复事件 | 原文编号 | 现状 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S5-GS-01 | active/paused Goal | settings_set | 已绑定 operator（forbidden）；Goal 存在（not_found）；pin（revision_conflict）；settings 形状/同 Workspace、无自等/等待环（invalid/cycle） | 同 desiredState，Goal rev+1 | 只写 settings、GoalSettingsChanged | 同身份恢复原 Goal；不停止 Run/放行消息 | 42-11、AMB-24 | 新增 |
| S5-GS-02 | 同 Workspace Goal 集合 | order_set | operator；列表无重复且恰好全集（invalid）；每 Goal pin（revision_conflict）；成员均未取消时才作为待处理冲突应用；历史 Goal 仍能出现在纯排序列表 | 每个 order=数组下标，变更 Goal rev+1 | 一个 tasks commit、一个包含全部返回 Goal 的事件 | 同身份原排序结果；同列表新身份允许 no-op，不造多次状态迁移 | Q13、42-4丙 | 新增 |
| S5-GS-03 | 冲突对后 Goal | wait_selected | 两 Goal scope/pins/Plan pointers 匹配；选时排序在前的对方存在；无等待环（cycle）；self 等 self（invalid） | waitForGoalRef 固定为所选前 Goal，rev+1 | GoalSettingsChanged；不取消已跑 Run | 同身份原结果；重排不改等待对象 | 42-5、AMB-7/8 | 新增 |
| S5-GS-04 | 冲突对后 Goal | risk_accepted | operator；两 pointer 匹配（revision_conflict）；完整另一 Goal；不得自对（invalid） | 同对风险替换，rev+1 | 写当时后 Goal；不写另一 Goal 或注记 | 同双版本新身份 no-op；同身份恢复原结果 | 42-4、AMB-9/10 | 新增 |
| S5-GS-05 | cancelled Goal | 任一设置写 | 取消终态（invalid） | 不变 | 无 | 查原回执后才看此拒绝 | 39、42-8乙 | 新增 |
| S5-GS-06 | 已答冲突，Goal因控制变版 | conflict_application | 当前active（paused回busy）；goalBases内容逐字段相同（不符revision_conflict）；当前Goal pin CAS；其他source pin仍匹配 | 正式settings迁移，同GS-03/04或排序 | 原ack ref/captured pins + basisRebases；不重新答 | 同原settings request身份恢复原事件；补记只认正式proof | 42-8甲、T02-A | 新增 |
| S5-AU-01 | 目标设置/事实 | 新修改工作检查 | active；wait 对方取消或正式 COMPLETED 且活动 Plan 匹配；缺前 Goal 回 incomplete，读失败 unavailable | 只读 allowed/不允许 | 拦 claim/entry/新接续/小任务/行动派工，allowed=false 的直接 owner 请求映射 busy，reason=waiting_predecessor:<goalId> | 不写事实；existing Run 不受追溯停止 | 42-5乙、I-9 | 新增 |
| S5-AU-02 | 同上 | 只读查询/出方案/既有执行接着跑 | 暂停允许只读；取消仅历史读，不允许新请求轮；既有执行的正式停止规则照原 Goal 控制 | 只读判定 | 不加冲突/依赖硬门槛 | 无写入 | §1.2/1.4、39 | 新增 |
| S5-AU-03 | 自治设置 | action_policy | §3.2 动作表；非用户自动动作遇 every_step 返回 needs_decision；旧授权与上限先有效 | 只读政策结果 | 工具/Workflow 使用同一份 | 不修改旧待放行消息 | Q12、37、42-9/11 | 新增 |
| S5-AU-04 | 可信职责事实 | user_message_send_policy | copy/独立 review 拒 forbidden；decision 仅 secretary/adviser/scribe；notify 可五职责；无正式映射 unsupported | 只读允许/拒绝 | 原 sender/Run/Role guards 仍必须通过 | 不凭请求中的 role 放行 | 37、AMB-61 | 新增 |
| S5-MSG-01 | absent | user_message_sent | 旧 work_run 准入、完整 User scope/Goal；S5-AU-04；decision 参数合法；用户消息发送不需要目标开始修改工作 | pending@1 | createSessionMessageRecord；存正文后写消息/原事件，guard Run/Session/Lease/Role/Goal | 原 send 身份/指纹/回执 | 37、§2.6 | 改造 message-machine:MSG-02 |
| S5-MSG-02 | pending/read 用户决定消息 | user_decision_answered | configured operator；原消息 pin；Goal 未取消；有效 option 或 other；批注来自对象；暂停可答 | responded，rev+1，application=null | 单槽 response、readAt??=answeredAt；不改计划 | 同身份原回执；不同身份后读已答回 invalid；并发 CAS 回 revision_conflict | Q14、42-6/7/8甲 | 新增 |
| S5-MSG-03 | 非消息来源未答 | synthetic_decision_answered | operator；source canonical facts/pins；Goal 未取消；来源不是仅 UI 自报；answer slot 空 | 合成用户消息 responded@1 | 创建 message/response 正文、答复 claim、DecisionAnswered 事件 | 同身份原回执；不同身份撞槽 revision_conflict | AMB-12、42-6 | 新增 |
| S5-MSG-04 | responded，requiresApplication=true，application=null | decision_application_recorded | 正式 receipt/event 可读；被改对象的source pins=receipt before（或§2.8仅控制重定位 proof），其余captured pins是读取guard而非必须被写对象；receipt after 匹配正式版本；有此答复的关联；实际修改者或 operator；无假 current/PASS（incomplete/forbidden/revision_conflict） | responded，application 非空，rev+1 | nextSessionMessageRecord；Applied 事件；只写消息 | 同身份原结果；同一 application 新身份 no-op；不同 application 再写 invalid | 推出8、42-7、AMB-11 | 新增 |
| S5-MSG-05 | responded，requiresApplication=false | application_recorded | 拒绝/延期不需落实（invalid） | 不变 | 无 | 历史答复仍可读 | 推出8 | 新增 |
| S5-MSG-06 | 取消 Goal 的任一卡 | 新答复/执行答复动作 | invalid，reason=goal_cancelled；原已答回执可重放；只读历史 | 不变 | 无；pending release 由片7标不发 | 无自动复活 | 39、42-8乙 | 新增 |
| S5-PLAN-01 | request slot absent | proposal_recorded | 原 PLAN-01–03；request root 同 Goal；replaces=null；slot expectedOwner=null | candidate@1 | 原候选记录+事件+slot 同事务 | 竞争输方 revision_conflict；原 receipt replay | 42-3、§1.1 | 新增 |
| S5-PLAN-02 | request head candidate/stale | proposal_replaced | head 正确、rev pin、request/Goal 相同；replaces 完整；不要求旧 head 非 stale | 旧 not_adopted/replaced；新 candidate@1 | 两记录/两 Recorded 事件+slot 转移同一次 commit | 任一 pin/claim 失败全部无效 | 42-3、AMB-32 | 新增 |
| S5-PLAN-03 | candidate head | proposal_adopted | 原 PLAN-04/05/06 + §3.2；首计划用户；slot owner；basedOn 必须活动 pointer | accepted，Goal pointer 正式移动 | 原 Plan/Goal/候选原子 commit + slot 释放；不写别请求 | 旧回执；其他请求仅 derive stale | 42-3、Q16 | 改造 plan-machine |
| S5-PLAN-04 | candidate/stale head | proposal_abandoned | operator、head pin、Goal 未取消 | not_adopted，reason=abandoned，rev+1 | 原 Recorded 事件 + slot 释放 | 同身份原结果；别请求不动 | 42-3丙 | 新增 |
| S5-PLAN-05 | candidate_v2 历史 | proposal_read | 存终态优先；否则 cancelled Goal closedReason；否则 basedOn 对比派生 stale | 只读 candidate/stale/closed | 无；stale 卡仍 waiting_answer，提供 regenerate/abandon | 不写 stale、不回写取消历史 | 42-3/8乙 | 改造 derivePlanProposalStatus |
| S5-NT-01 | Workspace 原位置 | notice_seen | operator；Workspace pin；有效显示页 token；只含该页返回类别/页尾；movement forward | 对应类位置更新，Workspace rev+1 | WorkspaceNoticeSeenChanged；消息 status/response/application 全不变 | 原 receipt；重复同位置 no-op | 42-10、AMB-15b | 新增 |
| S5-NT-02 | 同上 | backward/same/伪 token | backward/same 返回原位置 no-op；跨 scope/过滤/伪 token invalid，旧 pin revision_conflict | 不变 | no-op 无业务效果；不得倒退或跳未显示项 | 重放先查 receipt | 42-10 | 新增 |

缺目标/消息/请求回 not_found；损坏 codec/event/receipt 回 unavailable（核心没有 corrupt）。容量/超界回 capacity；普通无准入回 forbidden。所有拒绝保留 state、不 mint 新业务结果；唯一槽冲突只在新操作映射 revision_conflict，不改变旧 Store 映射规则。

### 3.2 自治与身份表（所有入口共用）

```typescript
type DecisionActionV1 =
  | 'confirm_goal' | 'adopt_first_plan' | 'remember_user_preference'
  | 'refine_future' | 'system_requeue' | 'agent_requeue' | 'auto_reverify'
  | 'minor_semantic_patch' | 'structural_patch' | 'change_goal'
  | 'exceed_budget' | 'escalate' | 'secretary_action' | 'secretary_inquiry'
  | 'short_handoff' | 'secretary_too_long' | 'long_handoff' | 'change_duty';
function decisionActionPolicy(input: {
  autonomy: GoalAutonomyV1; action: DecisionActionV1;
  actorClass: ReworkActorClass; countedNext: number | null; cap: number;
}): 'user_only' | 'needs_decision' | 'automatic' | 'automatic_notice';
function canSendUserMessage(input: {
  duties: readonly PlatformDutyV1[]; readOnlyCopy: boolean;
  independentReview: boolean; intent: 'notify' | 'decision_request';
}): boolean;
```

| 动作 | every_step | after_plan_confirmation |
| --- | --- | --- |
| confirm_goal/adopt_first_plan/remember_user_preference | user_only | user_only |
| refine_future/minor_semantic_patch | needs_decision | automatic |
| system_requeue/agent_requeue/auto_reverify | needs_decision | automatic_notice（仍检查既有 cap） |
| structural_patch/change_goal/exceed_budget/escalate | needs_decision | needs_decision |
| secretary_action/secretary_inquiry | needs_decision（片7待放行） | automatic |
| short_handoff | needs_decision | automatic_notice |
| secretary_too_long | automatic_notice | automatic_notice |
| long_handoff/change_duty | needs_decision | needs_decision |

countedNext>cap 时两档都是 needs_decision；这个 policy 不替代已有 reworkPermission/no-progress/budget/human-stop 围栏。人工明确操作按既有权限进行，不由 every_step 再重复问一次。当前 `state/task-failure.ts:nextRequeueAutoCount` 已令 automatic=system/agent、counted=非 interrupted，本片复用，不加第二个计数。系统+agent 重新入队共享现有 Run-chain 计数；自动重新检查沿既有 chain.autoCount/cap，不能把它和 requeueCount 相加重写旧 C8 规则。人重新入队的 reset、平台中断豁免照旧；归档中断豁免由片1/43机制提供。

operator 不是 actor.kind==='human' 的简写：依赖注入确切 configured operatorActor（human 或 system，当前 Host 可配置 system 操作者），ctx 必须 trusted host、actor 完全一致且不是 PLATFORM_AUTOMATION_ACTORS。work_run/query_run/自动化 Host 不可答卡。未配置 operatorActor 的独立 composition 新用户写入口回 unsupported；Host 从真实启动 actor 注入，不能从 HTTP JSON 提供。

发“请你决定”：至少有 secretary/adviser/scribe 职责且非 copy/独立 review。executor/reviewer 可 notify；需决定先咨询 adviser，由它转发并存 forwardedFrom。本片不自动转发、不新建协调者。模型传 duties/actor/session 不得覆盖可信上下文。

### 3.3 服务签名、读写顺序、回执

```typescript
interface GoalSettingsPort {
  readGoalSettings(ctx: CoreCallContext, input: { goalRef: GoalRef }):
    Promise<ReadResult<{ goal: GoalSnapshot; settings: GoalSettingsV1 }>>;
  setGoalSettings(ctx: CoreCallContext, request: GraphWrite<{
    goalRef: GoalRef; autonomy: GoalAutonomyV1; waitForGoalRef: GoalRef | null;
  }>): Promise<WriteResult<GoalSnapshot>>;
  reorderGoals(ctx: CoreCallContext, request: GraphWrite<{
    workspace: WorkspaceScope; goalOrder: GoalRef[];
    decisionMessageRef?: SessionMessageRef;
  }>): Promise<WriteResult<{ goals: GoalSnapshot[] }>>;
  resolveGoalConflict(ctx: CoreCallContext, request: GraphWrite<{
    source: DecisionSourceV1;
    selection: Extract<DecisionSelectionV1,
      {kind:'conflict_wait'|'conflict_order'|'conflict_parallel'}>;
    decisionMessageRef: SessionMessageRef;
  }>): Promise<WriteResult<{ goals: GoalSnapshot[] }>>;
}
interface DecisionMessagePort {
  sendUserMessage(ctx: CoreCallContext, request: GraphWrite<{
    goalRef: GoalRef; intent: 'notify' | 'decision_request'; text: string;
    needsReply: boolean; waitAfterSend: boolean;
    options: DecisionOptionV1[]; objects: DecisionObjectV1[];
    forwardedFrom?: SessionMessageRef;
  }>): Promise<WriteResult<SessionMessage>>;
  answerDecision(ctx: CoreCallContext, request: GraphWrite<{
    source: DecisionSourceV1; selection: DecisionSelectionV1;
    text: string; annotations: DecisionAnnotationV1[];
  }>): Promise<WriteResult<SessionMessage>>;
  readDecisionAnswer(ctx: CoreCallContext, input: {source: DecisionSourceV1}):
    Promise<ReadResult<{message: SessionMessage | null;
      body: UserDecisionBodyV1 | null}>>;
  recordDecisionApplication(ctx: CoreCallContext, request: GraphWrite<{
    messageRef: SessionMessageRef; receipt: DecisionApplicationReceiptV1;
  }>): Promise<WriteResult<SessionMessage>>;
}
interface RequestCandidatePort {
  readRequestCandidate(ctx: CoreCallContext, input: {
    goalRef: GoalRef; requestRef: QueryJobRef;
  }): Promise<ReadResult<{ head: PlanProposal | null;
    status: 'candidate' | 'stale' | 'closed' | null;
    closedReason: 'goal_cancelled' | null }>>;
  abandonPlanProposal(ctx: CoreCallContext, request: GraphWrite<{
    proposalRef: PlanProposalRef;
  }>): Promise<WriteResult<PlanProposal>>;
}
// PlanTaskPort.proposePlan 的 input 改为 ProposedPlanRequestV1。
// applyPlanChange 原签名不弱化，只加 acknowledgementRef?:SessionMessageRef；
// acknowledgementRef 仅为 event 归因，不提供新授权，不替代 decisionRefs。
```

| owner 文件 / 函数 | 检查及写入次序 |
| --- | --- |
| tasks/goal-settings-service.ts:createGoalSettingsService | 输入隔离/ctx/取消信号→operator→pin 形状→identity/fingerprint→lookup 原回执→单次 scope/Goal/settings 读→所需前目标/GoalPhase/排序全集读→state→commit（记录 guards；集合枚举用首读 ledgerHorizon）→竞争后回执再查 |
| communication/mailbox-service.ts:createSessionMailbox/sendUserMessage | 复用 ownContext/ownWrite/normalizeText/身份 key、旧 work-run 准入→原 send receipt→真实 Goal/职责/source 对象→state→事务外存 body→带原事实 guards 的一次 commit |
| communication/decision-service.ts:createDecisionMessageService/answerDecision | 入参/操作者→原回执→canonical source 读取（不依赖 views）→Goal/pins/单 response 或非消息槽→state→存正文→一次消息 commit；暂停不拒答，不在这里 apply Plan |
| communication/decision-application.ts:readApplicationReceiptFacts | records.lookupCommit identity+fingerprint→cursor/eventIds 一致→eventAt 原正式事件→具名白名单解码→与response.decision.source的被改对象before pins/acknowledgementRef 一致→实际 after 版本；不能接 caller 提供的 actualVersions/PASS |
| decision-service.ts:recordDecisionApplication | 原回执→消息 pin→requiresApplication→上述正式 proof→state→单消息 commit；改对象的 owner 已提交，不能再次改对象 |
| tasks/plan-service.ts:proposePlan/commitHostPlanProposal/applyPlanChange/abandonPlanProposal | 沿原 PLAN 检查顺序；receipt 在新 source/slot 检查之前；request seam/真实 head/claim guard 在原 draft admission 后编入同一次 plan commit；采用保留原 governance/有痕冻结/Goal guards |
| configuration/decision-settings-service.ts:markNoticesSeen | operator/入参和 pin 形状/identity→原回执→页 token 验证→Workspace 当前 settings→服务比较 movement→state→单 Workspace commit |

补记 proof 本片支持 GoalSettingsChanged、PlanRevisionAccepted 两种（【lead 改：L1】首次 ArchitectureCatalogAdopted / ProjectCompletionPolicyActivated 推到第 6 片，回 `unsupported`）；后片必须具名登记其他正式事件。Goal/Plan owner 的事件加可选 acknowledgementRef，并记录精确 before/after；tasks 不读取或写通信记录，因此绝不能把 acknowledgementRef 当授权。片6 才将已接受用户消息纳入 decisionRefs 的正式计划变更守卫。

补记核实的是确实发生过的那次变更：receipt中每个被改对象before必须对应答复捕获版本（不要求把所有读取guard也修改）；仅Goal控制状态变化允许§2.8具名basisRebases证明实际before，receipt.after 必须由原事件证明。当前对象又变了不否定历史落实；展示明确为“当时改到哪版”。没有原 receipt/event 时 incomplete/unavailable；不能仅看当前对象“看起来已改”猜落实。应用动作本身若对象已变，应由 owner 的 CAS 先拒 revision_conflict。

新 pin 集合：setGoalSettings=目标 Goal + 当前 wait 目标（如非空）的 Goal 与 GoalPhase（无 phase=0）；reorderGoals=全列表 Goal；resolveGoalConflict=两 Goal，wait 再含前 GoalPhase；answer 消息卡=原 message + captured source pins；非消息卡=source pins，合成目标消息 absence guard 由服务推导；application=恰好原 message pin；markSeen=Workspace；abandon=proposal + Goal。重复 pin、跨域、多余 pin、负/小数 pin 一律 invalid。

原回执样板：`mailbox-service.ts:replayMessage/recheckAfterMiss/writeMessage`，`plan-service.ts:commitHostPlanProposal` 的 early lookup / restoreProposal / mapCommitFailure，`persistence/graph-repository.ts:readCreatedGoal` 的 eventAt 完整一致校验。新事件保存原完整结果；重放即使 Goal 已取消、发信人已归档、对象已改版也恢复原结果。body/clock/id 不在命中 receipt 的路径再调用。

source.key 由 contracts/goal-decisions.ts:decisionSourceKey 生成：消息=完整 messageRef；候选=goalRef+requestRef（无请求用 proposalRef）；Goal cause=goalRef+cause code+affected refs/版本；planning=answerRef+question index；note=noteRef/revision；release=messageRef/revision；conflict=按 Goal key 升序的无序 pair+各活动 Plan pointer。source.pins 用于 CAS，不纳入 conflict key 的普通 Goal revision，重排不制造另一张同双计划卡。双入口共用 key，绝不存 UI cardId 做授权。


具名构造/辅助签名（依赖类型声明在model/decision-contracts.ts；现有owner依赖不重定义）：

```typescript
type S5RecordPort = GoalRecordTransactionPort & RecordLookupPort;
type DecisionOwnerBaseDependencies = {
  records: S5RecordPort; now: () => string; newId: () => string;
  operatorActor?: Extract<ActorRef, {kind:'human'|'system'}>;
};
type GoalSettingsServiceDependencies = DecisionOwnerBaseDependencies;
type WorkspaceDecisionSettingsDependencies = DecisionOwnerBaseDependencies & {
  displayTokens: NoticeDisplayTokenPort;
  positions: NoticePositionComparatorPort;
};
type DecisionMessageServiceDependencies = DecisionOwnerBaseDependencies & {
  messages: SessionMailboxPort;
  materials: Pick<MaterialPort, 'openArtifact'>;
  messageWrites: MessageWriteOwnerPort; // 原mailbox私有写/body helper的具名共享门面
  sources: DecisionSourceFactsPort;
};
interface MessageWriteOwnerPort {
  storeBody(ctx: CoreCallContext, input: {
    messageRef: SessionMessageRef; part: 'message'|'response';
    sender: MessageSender | MessageQueryAnswerSender | DecisionHostSenderV1;
    text: string;
  }): Promise<ReadResult<{bodyRef: ArtifactRef; sourceRef: SourceRefV1}>>;
  // persist复用原writeMessage/replay/recheck规则；state已造完整next，不能在这里改状态。
  persist(ctx: CoreCallContext, request: GraphWrite<{
    before: SessionMessage | null; next: SessionMessage;
    event: SessionMessageEventV1;
    guards: readonly RecordGuard[];
    claims: readonly UniqueClaimChange[];
  }> & { identityKey: string; fingerprint: string }): Promise<WriteResult<SessionMessage>>; // 【审查改】入口已算好的身份，persist 原样用于回执查找和 PreparedCommit（同现有 writeMessage 的 MessageWrite，mailbox-service.ts:1301–1304）
}
interface DecisionSourceFactsPort {
  readSource(ctx: CoreCallContext, source: DecisionSourceV1):
    Promise<ReadResult<{source: DecisionSourceV1; goal: GoalSnapshot;
      objects: DecisionObjectV1[]; options: DecisionOptionV1[];
      guards: readonly RecordGuard[]; closed: boolean;
      allowedReaderSessionRefs: SessionRef[]}>>;
  readApplication(ctx: CoreCallContext, input: {
    answer: SessionMessage; receipt: DecisionApplicationReceiptV1;
  }): Promise<ReadResult<DecisionApplicationV1>>;
}
function createGoalSettingsService(deps: GoalSettingsServiceDependencies): GoalSettingsPort;
function createDecisionSettingsService(deps: WorkspaceDecisionSettingsDependencies):
  WorkspaceDecisionSettingsPort;
function createDecisionMessageService(deps: DecisionMessageServiceDependencies):
  Pick<DecisionMessagePort,'answerDecision'|'recordDecisionApplication'|'readDecisionAnswer'>;
function goalDecisionBasisMatches(basis: GoalDecisionBasisV1, current: GoalSnapshot): boolean;
function goalConflictFacts(a: GoalFootprintV1, b: GoalFootprintV1): GoalConflictFactsV1;
```

UniqueClaimChange直接import `src/core/record-store/ports.ts:UniqueClaimChange`（{claimKey,expectedOwner,nextOwner}），不新建另一claim协议。新factory必须唯一使用composition的原records/materials/message实例。MessageWriteOwnerPort从mailbox导出 `createMessageWriteOwner`；原send/respond也转用同门面，旧公开port不加这些内部方法。persist接收完整纯state结果、原command meta、入口已算好的identityKey/fingerprint；不得将generated next/event/bodyRef/occurredAt当命令input重新指纹。身份仅原ctx+规范原input+expected pins；重放命中前不生成ID/时间/body。不改expected/read guards（§2.8具名控制重定位例外只用实际Goal guard）；新claim只在§2.4/synthetic两处使用。

readApplicationReceiptFacts实际签名为DecisionSourceFactsPort.readApplication；new message service不向上调readDecisionCard。【lead 改：L1】初始化 proof 推到第 6 片，本片不读架构目录、完成标准的事件。

## 4. 路由、读模型及 Workflow

### 4.1 只读数据类型及签名

```typescript
type DecisionCardStateV1 =
  | 'waiting_answer' | 'answered_pending_application' | 'applied'
  | 'answered_no_application' | 'closed';
type DecisionCardV1 = {
  cardKey: string; source: DecisionSourceV1;
  state: DecisionCardStateV1;
  goalRef: GoalRef; senderSessionRef: SessionRef | null;
  requestRef: QueryJobRef | null;
  objects: DecisionObjectV1[]; options: DecisionOptionV1[];
  answerMessageRef: SessionMessageRef | null;
  answer: UserMessageResponseV1 | null;
  application: DecisionApplicationV1 | null;
  candidateStatus: 'candidate' | 'stale' | null;
  staleReason: string | null;
  closedReason: 'goal_cancelled' | 'source_resolved' | null;
  readOnly: boolean;
  actions: ('answer' | 'ask_secretary' | 'apply' | 'record_application'
    | 'adopt' | 'regenerate' | 'abandon' | 'adopt_architecture'
    | 'adopt_completion_policy')[];
};
type NoticeItemV1 = {
  itemKey: string; category: NoticeCategoryV1; goalRef: GoalRef;
  position: NoticePositionV1; summary: string; objects: DecisionObjectV1[];
  rework: null | {
    operation: 'requeue' | 'reverify'; actorClass: 'system' | 'agent';
    taskRef: TaskTriple; count: number; cap: number | null; reason: string;
    sourceRef: TaskRequeueRef | VerificationRoundRef;
  };
};
type DecisionSourcePageV1<T> = {
  availability: 'available' | 'not_available'; items: T[];
  nextCursor: string | null; sourceCursor: CommitCursor | null;
};
type DecisionQueueReadV1 = {
  waitingAnswer: DecisionCardV1[];
  answeredPendingApplication: DecisionCardV1[];
  history: DecisionCardV1[];
  notices: NoticeItemV1[];
  counts: { waitingAnswer: number; answeredPendingApplication: number;
    notices: Partial<Record<NoticeCategoryV1, number>> };
  countsComplete: boolean;
  nextCursor: string | null; sourceCursor: CommitCursor;
  seenThrough: Partial<Record<NoticeCategoryV1, NoticePositionV1>>;
  displayToken: string | null;
  capabilities: { source: DecisionSourceV1['kind'] | NoticeCategoryV1;
    availability: 'available' | 'not_available' }[];
};
type GoalConflictReadV1 = {
  cards: DecisionCardV1[];
  labels: { goalRef: GoalRef; otherGoalRef: GoalRef;
    text: string; selfPlanRef: PlanRevisionRef | null;
    otherPlanRef: PlanRevisionRef | null }[];
  footprintCompleteness: { goalRef: GoalRef;
    executedFiles: 'available' | 'not_available';
    possiblyIncomplete: boolean; unmappedFiles: string[] }[];
  sourceCursor: CommitCursor;
};
interface DecisionReadPort {
  queryDecisionQueue(ctx: CoreCallContext, input: {
    workspace: WorkspaceScope; goalRef?: GoalRef;
    sections: ('waiting_answer' | 'answered_pending_application' | 'history' | 'notices')[];
    categories?: NoticeCategoryV1[];
    page: { limit: number; cursor?: string; atLeastCursor?: CommitCursor };
  }): Promise<ReadResult<DecisionQueueReadV1>>;
  readDecisionCard(ctx: CoreCallContext, input: {
    source: DecisionSourceV1;
  }): Promise<ReadResult<DecisionCardV1>>;
  queryGoalConflicts(ctx: CoreCallContext, input: {
    workspace: WorkspaceScope; atLeastCursor?: CommitCursor;
  }): Promise<ReadResult<GoalConflictReadV1>>;
}
interface WorkspaceDecisionSettingsPort {
  markNoticesSeen(ctx: CoreCallContext, request: GraphWrite<{
    workspace: WorkspaceScope; displayToken: string;
    seenThrough: Partial<Record<NoticeCategoryV1, NoticePositionV1>>;
  }>): Promise<WriteResult<WorkspaceSnapshot>>;
}
```

limit=1..100，默认 50；source lookup 每页≤200，单次窗口≤25页/5000项、Goal≤200，窗口一致性重试≤4。超界回 capacity，连续并发无法得到稳定窗口回 unavailable，不伪造完整计数或新水位。Workspace 内可过滤 Goal；“全局队列”由 Host 汇总其真实授权 Workspace，不把不同库 cursor 合并成一个全局游标；本片 core 不提供跨项目授权读。

卡 key 是 §3.3 的 source identity，两入口共用。根据原来源、单 response/答复 claim 和 application 派生状态；不存 Card 表。原来源即使不再在 open 查询里，也从答复消息 source 回读出 answered_pending_application；sender 归档不丢卡。requiresApplication=false 不进待落实，显示已答且无需落实，不谎称完成了对象变更。【审查改】非消息卡的 options：冲突卡见 §4.3；goal_cause、candidate、planning_question 三种 options=[]（规划问题本来只有文字问题，`tasks/initial-plan.ts:49`；候选和目标原因能做的事放在 `actions` 里，走已有接口）。这三种卡的答复只用自由文字和批注，记 selection=other、requiresApplication=true。

### 4.2 七来源的精确装配

| 来源 | 正式读取 / 条件 | 关闭及实现边界 |
| --- | --- | --- |
| 1 message | 用户 recipient、intent=decision_request、非 synthetic；by-workspace-status 候选，canonical 重读；by-goal 用主面 seam | responded 不算待答；应用为空进待落实；forwardedFrom 显示原成员来源 |
| 2 goal_cause | 原 GoalDisplay.causes 的具体需决定原因，不只看 NEEDS_DECISION 标题；required_task_deferred、cap 等保留 code/refs；规划缺架构/标准用正式 active pointer 缺失 guards | 缺初始化按此来源给采用入口，不伪造 Query 问题；同 cause 对应版本的用户答复可关闭待答，但不抹去仍未解决的 Goal 原因 |
| 3 candidate | tasks 的请求 head+独立 null 请求候选；查目标+请求，stale 也算活 head | 每请求一张；accepted/not_adopted 关闭；cancelled 只读；另一请求采用使其 stale，不写 not_adopted |
| 4 note_review | 片4的用户审查 adapter，仅结构改动/矛盾要用户，不把所有书记待办都升级 | 此片 not_available；片4替换 producer/adapter，答复机制已经可用 |
| 5 planning_question | 正式 QueryJob.status=answered，answerRefs 中的正式 Answer；读取 Job/Run/manifest/body 并复用 tasks/initial-plan.ts:parseInitialPlanningResponseV2 的 needs_decision/questions | 每个 answerRef+questionIndex 一项；未保存问题不凭 Workflow 一次响应重建；回答只记用户消息，重规划由片6 |
| 6 goal_conflict | §4.3 pure footprint、双当前 Plan pointers、设置和答复来源 join | 三选择都记用户消息；同接口再调 tasks 设置、另补记 application；other 只答复，不猜设置 |
| 7 message_release | 片7正式 awaiting_release 消息、原期限尚未开始 | 此片 not_available；自治改档不改变旧记录；暂停可答但发出等继续，取消变不发由片7 owner |

来源5需要提前声明唯一 QueryJob by-workspace-goal 索引：`S5_QUERY_JOB_BY_GOAL='query-job-by-workspace-goal'`，paths=`ref.projectId,ref.workspaceId,job.goalId`，注册于 queries/query-record-codecs.ts 原 QueryJob codec。片6必须复用这个名字/paths，不重复注册。第 5 个新索引只用于正式问题发现，不提前实现秘书请求归属。questions 读取导出 `tasks/planning-question-reader.ts:readPlanningQuestions(ctx,{goalRef,page})`，返回 DecisionSourcePageV1<DecisionCardV1>；复用原 readInitialPlanAnswerFacts/normalize 路径，不能为了读取调用 proposeInitialPlanFromAnswer（它可能写候选）。

answerDecision 不向上 import views：来源验证从下层 tasks/queries/原 records codec 求 canonical 源，sourceKey 构造来自 shared contracts。未来 note/release adapter 既验证所属对象又给 exact guards；不能接受 UI 直接传“这张卡存在”。


```typescript
interface DecisionCardSourcePort {
  kind: DecisionSourceV1['kind'];
  readPage(ctx: CoreCallContext, input: {
    workspace: WorkspaceScope; goalRef?: GoalRef;
    page: {limit: number; cursor?: string; atLeastCursor?: CommitCursor};
  }): Promise<ReadResult<DecisionSourcePageV1<DecisionCardV1>>>;
}
interface DecisionNoticeSourcePort {
  category: NoticeCategoryV1;
  readPage(ctx: CoreCallContext, input: {
    workspace: WorkspaceScope; goalRef?: GoalRef;
    after?: NoticePositionV1;
    page: {limit: number; cursor?: string; atLeastCursor?: CommitCursor};
  }): Promise<ReadResult<DecisionSourcePageV1<NoticeItemV1>>>;
}
function readGoalDecisionCauses(ctx: CoreCallContext, input: {
  goalRef: GoalRef; atLeastCursor?: CommitCursor;
}): Promise<ReadResult<GoalDecisionCauseReadV1[]>>;
function readPlanningQuestions(ctx: CoreCallContext, input: {
  goalRef: GoalRef;
  page: {limit: number; cursor?: string; atLeastCursor?: CommitCursor};
}): Promise<ReadResult<DecisionSourcePageV1<DecisionCardV1>>>;
// 在原PlanTaskPort增加只读seam，使用同PlanServiceDependencies读正式事实。
function readInitialPlanAnswerFacts(ctx: CoreCallContext,
  answerRef: QueryJobAnswerRef): Promise<ReadResult<InitialPlanAnswerFacts>>;
```

source ports声明在model/decision-contracts，views只调用reader；queryGoal/display/taskGraph/架构目录/已保存Answer都复用原owner。所有adapters收到同atLeastCursor；不对某个unavailable源返回available空数组。每源读结果只合并正式items，不在stub创建对象。planning reader拿原InitialPlanAnswerFacts（现有tasks/initial-plan.ts导出类型），原parser语义不改；原closure中的reader通过具名PlanTaskPort方法导出，不能复制Job/manifest/body校验。

### 4.3 足迹冲突与风险标签

足迹 = 当前活动 Plan 中 work Task 的 module scope（future/deferred 仍是意图，cancelled/superseded 不列）并集 + 同 Goal 已跑 Run 的文件。没有 module scope 的 Goal/stage Task 不扩成“全项目”，不猜模块。文件先用当前正式 architecture catalog 的 paths 归模块：项目相对路径、分段匹配、最长合法 path；同最长多 owner 时留 unmapped。模块标识用真实 ModuleRef，不按名字模糊匹配。

同模块交集或同完整文件路径交集给建议；“计划模块 M vs 已改 M/a.ts”必须提示（AMB-9b）。归属不明但与另一边模块的关系无法证明时不猜冲突，保留 unmapped/incomplete；同文件路径的已知重叠仍可提示。没有交集只表示本次未发现，不证明安全。读当前 catalog 的事实与水位，不能把被改名的历史 module id 强行等同当前模块。

卡和标签按无序 Goal pair + 双 Plan pointer 识别，普通 order/Goal revision 不影响身份。Goal paused 仍可出现可答卡；cancelled 或正式 COMPLETED 的 Goal 不生成新的冲突待答，原历史保留。接受风险保存在当时后 Goal；两边仍同计划时两个目标都有 `与 <另一个目标> 并行，已接受风险` 标签。换任一 pointer 标签消失；仍有交集且没有这一双版本答复才重出卡。

wait/order/parallel 选项并列，options 顺序固定 wait,order,parallel，**无 recommended/default**。【审查改】三项精确为 `{id:'wait',label:'等前一个目标',effect:'apply'}`、`{id:'order',label:'调整顺序',effect:'apply'}`、`{id:'parallel',label:'接受风险并行',effect:'apply'}`，措辞照 UI-WORKBENCH §0 的冲突提示；用户选了以后，答复的 selection 记 conflict_wait / conflict_order / conflict_parallel，不记 option。wait 取该冲突对在当时顺序靠前的 Goal（不是后来重排出的其他 Goal）；完成或取消解锁。调整顺序的 goalOrder 从卡内提交，写目标设置；正在运行的工作不被停止。

同版本已答的 wait/order 卡也由合成用户消息 join 关闭，不能因为两边仍重叠下一次读又变未处理。free-text other 的卡到已答待落实，留给提问方/片6处理；不得自行把它记成接受风险。

### 4.4 自动返工“请知悉”

1. requeue 读 TaskRow.rework.entries，按完整 TaskRequeueRef 去重，读真实记录 actor classification、reason/automation.cap/count。system 和 agent 都列；human 不列。cap=null/旧Round无noticeAutomationCap时，保留已知自动通知并明写上限未记录，不以当前Host值替代；旧记录无自动标记不凭 prose补成自动。
2. reverify 必须读同主体 **全 round chain**，不能只读 TaskRow.failure.round 链头。用原 VerificationRoundByTask/subject 索引和 `state/verification-machine.ts:roundChainHead`；每个自动后继 Round 一条，sourceRef=该 Round，actorClass=chain.reverify.actorClass，count=chain.autoCount，cap=创建时wire.noticeAutomationCap??null；不得从当前设置补上限。没有单独 round HTTP 路由也能在 views 服务端读取，不能因此漏掉。
3. startup interrupted 自动重入队也显示“恢复/自动返工”事实，保持既有 counted=false/count 不增加；归档异常锚点本身不冒充失败/计次。
4. summary 格式固定 `自动返工 · <任务> · 第 <count> 次（<count>/<cap>）`；cap=null时为`自动返工 · <任务> · 第 <count> 次（上限未记录）`，不能写当前cap。reverify的原ordinal通过sourceRef读取原chain，不新建推测ordinal字段。被豁免的恢复显示“自动恢复 · <任务>（不计次）”，不显示第0次返工。
5. member_notice 等另六类由其正式来源 adapter 提供，不从消息 prose 猜“受阻/做完”。只生成投影，不存 Notification。User notify 非synthetic、intent=notify 按member_notice原始来源进入，未接额外来源时capabilities明写不完整。
6. 片6用同 NoticeItem 合成主对话折叠行；片7按同源 itemKey 发秘书/参谋注意力，重复提交不得重发。不在本片单独唤醒秘书或偷偷创建 adviser Session。

### 4.5 路由和协调动作

前缀仍 `/api/real/core/`。新增 suffix 必须同时加 CoreRouteSuffix、CORE_ROUTE_SPECS、CoreRouteBindings、createPlatformCoreRouteBindings 的 named binding 和 dispatch switch；不使用动态 platform[group][method]。GraphWrite 元数据由现有 parser 处理，ctx/sender/operator 绝不来自 body。下表签名指 §3/4 的真实 port 方法，GET 式读取仍按现有 POST/plain 请求协议。

| suffix | kind | binding / owner / signature |
| --- | --- | --- |
| goals/settings | plain | readGoalSettings / platform.goalSettings.readGoalSettings |
| goals/settings/set | graph_write | setGoalSettings / 同名 owner |
| goals/reorder | graph_write | reorderGoals / 同名 owner |
| goals/conflicts | plain | queryGoalConflicts / platform.decisions.queryGoalConflicts |
| plans/request-candidate | plain | readRequestCandidate / platform.requestCandidates.readRequestCandidate |
| plans/abandon | graph_write | abandonPlanProposal / 同名 owner |
| decisions/queue | plain | queryDecisionQueue / platform.decisions.queryDecisionQueue |
| decisions/card | plain | readDecisionCard / 同名 owner |
| decisions/answer | graph_write | resolveDecision / Workflow 的有限组合，下述签名 |
| decisions/application | graph_write | recordDecisionApplication / platform.decisionMessages.recordDecisionApplication |
| decisions/notices/seen | graph_write | markNoticesSeen / platform.workspaceDecisionSettings.markNoticesSeen |
| messages/user-send | graph_write | sendUserMessage / platform.decisionMessages.sendUserMessage |

已有 plans/propose input 扩 requestRef/replaces；plans/apply input 仅扩 acknowledgementRef（不开放完整改目标）。原 messages/send 对 SessionRef 的旧签名/无 pins 行为不变，新增 User 地址通过具名 sendUserMessage 接口，避免旧 sender admission 降级。

```typescript
type ResolveDecisionInputV1 = {
  source: DecisionSourceV1; selection: DecisionSelectionV1;
  text: string; annotations: DecisionAnnotationV1[];
};
type ResolveDecisionReadV1 = {
  answer: WriteResult<SessionMessage>;
  action: WriteResult<{ goals: GoalSnapshot[] }> | CoreRejection | null;
  application: WriteResult<SessionMessage> | CoreRejection | null;
  state: 'answered' | 'applied' | 'awaiting_resume' | 'application_not_recorded';
};
// WorkflowPort 增加：
function resolveDecision(ctx: CoreCallContext,
  request: GraphWrite<ResolveDecisionInputV1>): Promise<ReadResult<ResolveDecisionReadV1>>;
function orderGoalAdvances(ctx: CoreCallContext, input: {
  advances: WorkflowAdvanceInput[];
}): Promise<ReadResult<{ advances: WorkflowAdvanceInput[] }>>;
```

Workflow/decision-actions.ts：①answerDecision（一个提交）②仅 conflict 结构化选择且 Goals active，调用 tasks.resolveGoalConflict（另一个提交）③recordDecisionApplication（第三个提交）。三者 requestId 用各自命令命名空间内的原 id + `:answer/:settings/:application`，规范指纹中保留原 source/pins；settings命令meta.expected及指纹保留原captured source pins；仅records.guards按§2.8采用已核对当前Goal版本，actualBefore/basisRebases来自owner实读，不参与新的可变输入指纹；重试先恢复原settings receipt。这是具名控制重定位例外，普通owner仍逐pin比较。同接口返回各真实回执。答复 committed 后的失败用 ready+进度返回，不能抛出貌似从未答过的总体 rejected。目标 paused：①成功，②/③待继续，state=awaiting_resume；其他卡①后即 answered，不自动修改工作。补记失败：state=application_not_recorded，卡仍在待落实。没有假跨子模块原子事务、自动补偿或后台自愈。

冲突重试/继续应用需恢复原答复（不能让用户重新答），保留原捕获 source pins 和 goalBases；仅控制状态变化按§2.8核对后使用当前Goal pin CAS，其他对象/计划/设置变化回 revision_conflict，不能拿新 pin 静默应用旧决定。reject/defer 无②③。free text other 不进入机械 settings 路径。采用候选仍调用原 plans/apply；UI/片6以同原答复 acknowledgementRef 关联后补记，完整决策授权属片6。

Workflow/workflow.ts 的 select_work 与 perform 共享 policy：自动 refine/requeue/reverify 前读当前 Goal 设置；每步确认返回 waiting/next=null 和正式事实派生的 GoalDecisionCauseReadV1（来源2；不伪写 GoalPhase 或改变其展示归约；【审查改】放在 `WorkflowAdvanceResult.value` 新加的可选字段 `decisionCause?: GoalDecisionCauseReadV1 | null`（`business/workflow/contracts.ts`，F48），`reason` 写 `automation_confirmation_required:<action>`），不直接进行；可继续已经开始的检查/Run 不按新的自治设置追溯停止。所有绕过 select_work 的直接 claim/entry owner 也必须读等待 Goal 与 predecessor GoalPhase，并把观察版本 guards 编入 commit，防止“看完能做再设等待”的竞态。

抢同一 Session 的默认顺序：Host 的现有 collaboration-driver 只在领取/创建选择这个安全点，将当前 pending advances 交给 orderGoalAdvances，按 Goal.settings.order、Goal key、flowId/taskId 稳定排序，再逐个调用原 Workflow。已占用成员不抢占；其他成员能并行；人工/agent 的明确改派仍走原权限/占用 CAS。有限排序不新增持久调度器、队列或 Host 类型。本规则作用于同一安全点已排队的竞争；后来的高顺位目标不能撤回已成功领取的低顺位任务。跨 Host 唯一执行实例仍由原 lease 保证。

composition 创建一个 settings/service、一个 decision-message service、一个 decision read model，注入原 backend/roles/materials/execution/plan instances；新增 public ports 的 tracked wrapper 沿现有 close/drain 约定。views 只读：不得在 readDecisionCard 内 answer/apply/标已读。configuration 增向下 state 依赖及 views 归属见 §7；任务/evidence 不向上依赖 communication/views。

### 4.6 用户工具和答复输入的窄接线

```typescript
// execution-contracts.ts / SessionMailboxToolsConfig 增可选（旧composition仍能启动旧工具）：
// decisionMessages?: Pick<DecisionMessagePort,
//   'sendUserMessage'|'recordDecisionApplication'|'readDecisionAnswer'>;
// createSessionMailboxTools(config) 原签名不变，原六个名字保持。
// 有真实decisionMessages时附加这三个，没依赖时不注册：
const USER_DECISION_TOOL_NAMES = [
  'send_user_message', 'read_user_decision', 'record_decision_application',
] as const;
// send_user_message严格args，与§3.3sendUserMessage.input相同；meta由callId+Run绑定。
// read_user_decision严格args={source:DecisionSourceV1}，调用readDecisionAnswer。
// record_decision_application严格args={messageRef,receipt}；expected仅该message的实读pin。
function formatDecisionResponseInput(body: UserDecisionBodyV1): string;
```

三个工具均使用原tool factory strict schema/synchronous snapshot/context/signal/noneEffects/committed-or-ready检查；model无actor/duties/operator/requestId字段。record工具需真实修改者原准入，不能把“能发决定”当“能写/补所有对象”。不注册answerDecision/markSeen等用户写工具。User send成功后，waitAfterSend按原onWaitRegistered登记真实message ref；原group barrier/yield/consumedWait/RUN-27机制复用，无轮询或新Turn协议，暂停Goal不因回答自动开始改动。

formatDecisionResponseInput的确定值=`'用户答复\n'+canonicalJson(body)`，保留text/annotations。createMailboxInputSupply对新用户response使用此formatter，旧response保持原body.text；inputId仍deriveSessionInputId(messageRef,'response')，acceptedInputs一次确认，读取本身不确认。Message body读回的body.text仅原文；formatter还带正式metadata，与§2.3保存payload核对，不能漏批注。read_session_message/read_session_message_body原发信Session可读自己的User消息及回答；User不经过readSession(recipient)或Session inbox/咨询消费者。

非消息卡答复的allowedReaderSessionRefs由canonical来源保存的正式proposer/work_run或Query当前秘书事实确定；无正式接收Session时为空，返回forbidden给agent，用户Host仍可读。片6/7补秘书请求事实后替换reader seam，不猜随机Session，不改synthetic sender为agent。readDecisionAnswer用source key找到原答复（未答message/body=null），scope和正式允许读者先检查；问的一方读到选项/原文/批注，即使sender归档/申请应用还没完成，事实也不删除。该读取不产生模型回合或自动执行。


纯 `isUserMessageRecipient(recipient: MessageRecipient): recipient is UserMessageRecipientV1` 放contracts/core/session-message.ts，用kind判别。原Workflow/consultation.ts对User消息明确返回rejected unsupported，不能将其转成Query或readSession；collaboration-driver.pump将它计入needsReply/wait状态，但从consultOne循环排除，回复后的接续仍走原awaitWake+Goal/Run停止规则。原UI执行辅助动作只增加Session收件方guard，防止widen union后构造sessionId=undefined；不实现新UI、不改变普通Session动作或冻结原型。不存在自动为用户创建Session。

## 5. 测试规格（冻结期望，不写镜像实现的测试）

### 5.1 固定夹具和断言口径

所有下面逻辑案例各有一个 `it`/参数化行，不把十个效果塞进一个“happy path”。service 用 describe.each(['memory','sqlite'])，每行跑两次；SQLite 至少一行关闭重开同文件。unit 无 IO；scenario 用原真实 composition/Host/SQLite/脚本模型，不用真实 provider。

统一夹具：Workspace=P/W；Goals A/B/C 的 key 升序，order=0/1/2；A Plan pointer=PA1、B=PB1，Plan snapshot 聚合 revision=1、展示 planRevision=1。默认 Goal.revision=7、message.revision=1、Workspace.revision=3。PA2/PB2 表示真正不同 PlanRef。Session S 是真实 claimed entered running Run RA 的 owner；duties 从可信 adapter 给。operator=human:operator；automation=WORKFLOW_AUTOMATION_ACTOR；信号未取消；时间 T=`2026-10-08T00:00:00.000Z`。plain/full ref 都用代码构造，不用裸字符串代替。

模块 M 映射 `src/m/`，N 映射 `src/n/`；文件 fm=`src/m/a.ts`。请求 Q1/Q2 为真实 user-initiated root QueryJob，same Goal=B。U1/U2 是各自 candidate；GP0 表示 GoalPhase pin0，GPC=COMPLETED 且 planRef 等活动 pointer。测试数据只可通过既有 fixture seed API 和真实 codec 建立，不篡改数据库制造生产不可能的状态。

断言“0写”=records/events/claims 的前后数量及版本相同（body orphan 单独可出现，不算发送）。“1提交”读 Store 事件/receipt，而非 mock 次数冒充原子。重放断言 cursor/value 等首次、replayed=true，newId/now/bodyPut/模型次数未增加。被拒或只读不增模型调用。

### 5.2 unit：逐状态行

`tests/state/S5-goal-settings.test.ts`（15 行）：

| case | 给定 / 输入 | 精确期望 |
| --- | --- | --- |
| GS01 | 旧 Goal 无 settings | 默认 after_plan_confirmation,order0,wait null,risks[] |
| GS02 | active B@7 设置 every_step | Goal@8，desiredStateRevision 和 activePlanRef 完全不变 |
| GS03 | paused B@7 设置自治 | Goal@8 仍 paused，effects=[goal_settings_changed] |
| GS04 | cancelled B 设置 | ok=false,code=invalid，无 next/effects |
| GS05 | actor=automation 设置 | forbidden |
| GS06 | B 等 A，之后 order B/A | waitForGoalRef=A；claim.allowed=false（【审查改】GoalStartActionV1 没有 new_work，用 claim） |
| GS07 | A cancelled，B 等 A | claim allowed=true |
| GS08 | A GPC 对 PA1，B 等 A | enter allowed=true；GPC 对 PA0 时 false |
| GS09 | A 等 B，再 B 等 A | cycle；B 原设置不变 |
| GS10 | waiting B readonly_query | allowed=true；dispatch_action=false,reason=waiting_predecessor |
| GS11 | A计划M，B仅已改fm且fm归M | overlaps=true,moduleRefs=[M],filePaths=[] |
| GS12 | 两方同文件fx且都无可归模块 | overlaps=true,moduleRefs=[],filePaths=[fx] |
| GS13 | A计划M，B仅文件fx未知模块 | overlaps=false,possiblyIncomplete=true |
| GS14 | captured B@7与active B@9仅控制字段变 | goalDecisionBasisMatches=true；settings迁移before B@9 |
| GS15 | B@9活动Plan换PB2 | matches=false，migration revision_conflict |

`tests/state/S5-decision-policy.test.ts`（16 行）：

| case | autonomy / action / facts | 精确期望 |
| --- | --- | --- |
| PO01 | every_step,adopt_first_plan | user_only |
| PO02 | after_plan_confirmation,adopt_first_plan | user_only |
| PO03 | every_step,refine_future | needs_decision |
| PO04 | after_plan_confirmation,refine_future | automatic |
| PO05 | every_step,system_requeue,next1,cap3 | needs_decision |
| PO06 | after_plan_confirmation,agent_requeue,next2,cap3 | automatic_notice |
| PO07 | after_plan_confirmation,auto_reverify,next4,cap3 | needs_decision |
| PO08 | after_plan_confirmation,structural_patch | needs_decision |
| PO09 | every_step,secretary_inquiry | needs_decision |
| PO10 | after_plan_confirmation,secretary_action | automatic |
| PO11 | every_step,secretary_too_long | automatic_notice |
| PO12 | after_plan_confirmation,long_handoff | needs_decision |
| PO13 | executor,decision_request | canSend=false |
| PO14 | adviser,decision_request | canSend=true |
| PO15 | scribe,notify,independentReview=true | canSend=false |
| PO16 | reviewer,notify,copy=false,independentReview=false | canSend=true |

`tests/state/S5-message-decision.test.ts`（14 行）：

| case | 给定 / 事件 | 精确期望 |
| --- | --- | --- |
| MD01 | absent，adviser 用户 decision send | pending@1,needsReply=true,response=null |
| MD02 | executor 用户 decision send | forbidden；0 effects |
| MD03 | pending@1，operator option=accept | responded@2，requiresApplication=true，application=null |
| MD04 | read@2，operator defer | responded@3，requiresApplication=false，原 readAt 保持 |
| MD05 | pending@1，only text='另一个办法' | selection.kind=other，原文不改 |
| MD06 | pending@1，only annotation fm='先处理这里' | other，annotations 精确一项 |
| MD07 | 无选项/空文/空批注 | invalid |
| MD08 | annotation objectKey 不在卡 | invalid |
| MD09 | work_run 回答用户卡 | forbidden |
| MD10 | paused Goal 下回答 | responded@2，0 Plan/Run effects |
| MD11 | synthetic 非消息答复 | responded@1,sender=operator,syntheticAnswer=true |
| MD12 | responded requiresApplication=false，记落实 | invalid，无 application |
| MD13 | responded@2=true、正式proof的原before/after，应用 | responded@3，application恰等proof，response原值保留 |
| MD14 | responded@2=true、proof与captured内容不符 | revision_conflict；next/effects不存在 |

`tests/state/S5-request-candidate.test.ts`（10 行）：

| case | 给定 / 事件 | 精确期望 |
| --- | --- | --- |
| PC01 | Q1 slot 空，新 U1 | U1 candidate@1，slot owner=U1 key |
| PC02 | Q1 U1@1→U3 | U1 not_adopted@2/replaced/U3；U3@1；slot=U3 |
| PC03 | Q1替换 pin0 | revision_conflict；不构造 U3 |
| PC04 | replaces 指 Q2 U2 | invalid |
| PC05 | Host draft basedOn=旧 PB0 | 可记录；读 status=stale |
| PC06 | adopt U1/PB1→PB2，Q2 U2 basedOnPB1 | U1 accepted；U2 stored candidate@1、derived stale |
| PC07 | stale U2 采用 | revision_conflict |
| PC08 | abandon stale U2 | not_adopted@2,reason=abandoned；无 abandoned 状态 |
| PC09 | 两个 null request 独立候选 | 都 candidate，0 request slot |
| PC10 | cancelled Goal 读 U2 | read closedReason=goal_cancelled；stored U2不变 |

`tests/state/S5-notice-settings.test.ts`（8 行）：

| case | 给定 / 事件 | 精确期望 |
| --- | --- | --- |
| NS01 | 旧 Workspace 无设置 | noticeSeen={} |
| NS02 | forward member_notice 到 pos10 | Workspace@4；仅该类=pos10 |
| NS03 | 再 same pos10 | next 与原值相等，effects=[] |
| NS04 | backward pos9 | 原 pos10 保留，effects=[] |
| NS05 | automation markSeen | forbidden |
| NS06 | token P/别 Workspace | invalid |
| NS07 | token只含member，报automatic_rework pos20 | invalid，0 effects |
| NS08 | source movement=forward 但 pin2 当前3 | revision_conflict |

### 5.3 owner service：每行 memory + SQLite

`tests/work-graph/S5-goal-settings.test.ts`（14×2）：

| case | 操作 | 精确期望 |
| --- | --- | --- |
| SS01 | setGoalSettings B@7→every_step | committed B@8；1 GoalSettingsChanged；Run RA 原值 |
| SS02 | 原 SS01 同身份重放，Goal 后来 cancelled | 原 B@8/cursor，replayed=true |
| SS03 | 同身份换 autonomy | idempotency_conflict，0写 |
| SS04 | order=[B,A,C] 且三 pins 当前 | orders B0/A1/C2；1提交；旧风险仍保存在B |
| SS05 | order 缺 C | invalid，0写 |
| SS06 | B接受 A 风险，然后 reorder | 两标签 self/other pointer 正确；卡0 |
| SS07 | 换 A pointer=PA2 | 标签0，冲突卡1，source key 与旧不同 |
| SS08 | B等A，领取读旧B→设置等待提交先赢→领取commit | claim revision_conflict；无新lease/Run |
| SS09 | B等A，A取消 | 新 claim 成功；B.waitFor仍A |
| SS10 | 关闭重开同 backend | 自治/order/wait/风险与首次保存深等；模型0 |
| SS11 | paused B@7冲突答复→继续B@8→当前pin应用风险 | settings B@9；proof captured B@7/actualBefore B@8；仅原答复1条 |
| SS12 | 同SS11但继续后自治变every_step/Goal@9 | revision_conflict，0写；原答复待落实保留 |
| SS13 | 领取commit先赢→设置等待提交 | 已领取Run保留；等待设置成功；后续新claim busy/waiting_predecessor |
| SS14 | 已设every_step/order2/waitA/risks，原Goal控制暂停→继续→读原回执 | settings每字段深等；当前Goal rev每步+1、desiredStateRevision照原epoch；原各回执保持当时完整settings |
| SS15 | 【审查改】paused B@7冲突答复（捕获B@7）→暂停中setGoalSettings改every_step（B@8）再改回after_plan_confirmation（B@9）→继续（B@10）→应用风险 | committed settings B@11；proof captured B@7/actualBefore B@10、basisRebases恰一项；不要求重答 |
| SS16 | 【审查改】Goal B 上一个已claim、未entered的Run RB；之后setGoalSettings让B等A（A active、未完成）；对RB调authorizeRuntimeEntry | rejected/busy，reason以`waiting_predecessor:`开头；RB仍Starting.Unbound；inputBinding/authorization写入0 |

`tests/work-graph/S5-user-messages.test.ts`（12×2）：

| case | 操作 | 精确期望 |
| --- | --- | --- |
| UM01 | 真实 adviser sendUserMessage decision | User recipient P/W，sender S/RA；by-goal 命中1；Session inbox命中0 |
| UM02 | executor sendUserMessage decision | forbidden，record/event/claim 0增量 |
| UM03 | 同 executor sendUserMessage notify | committed pending@1；模型0；不改任务 |
| UM04 | caller JSON 假称 scribe，可信 duties executor | forbidden |
| UM05 | duties mapping 缺失 | unsupported；旧 Session notify 仍成功 |
| UM06 | operator 答文字+fm批注 | 原文/annotation读回；responded@2；Task/Plan原值 |
| UM07 | 两入口同 requestId | 一个 response、一事件；第二 replay=true |
| UM08 | 不同 requestId，两入口都读pending@1后提交 | 首个committed；第二revision_conflict；原response不覆盖 |
| UM09 | 16385 UTF-8 bytes正文 | capacity，0 ledger写 |
| UM10 | 旧 Session addressed message 用用户 answer入口 | invalid；旧 work_run respondMessage 流程不变 |
| UM11 | 另一身份在第一次answer已提交后才读取并回答 | invalid，0写；原response不覆盖 |
| UM12 | 原Session消息无goalRef/decision/application/since，ack→重放 | 原公开DTO/receipt与旧expect完全深等；0用户源/新claim；无回填origin |
| UM13 | 【审查改】UM06前后各按S5_MESSAGE_BY_WORKSPACE_STATUS查pending、responded两桶；SQLite另关闭重开再查 | 答前pending桶含该消息、responded桶不含；答后pending桶不含、responded桶含；重开后相同 |

`tests/work-graph/S5-request-candidates.test.ts`（11×2）：

| case | 操作 | 精确期望 |
| --- | --- | --- |
| RC01 | Q1/Q2各出候选 | by-goal-request各1活head，queue两卡 |
| RC02 | 同Q1同时首写U1/U3 | 唯一head1；输方revision_conflict；无孤立第二 candidate记录 |
| RC03 | Q1替换U1，新commit故障 | U1仍candidate@1，slot仍U1，U3不存在 |
| RC04 | Q1替换成功 | 同receipt versions含U1@2/U3@1；Q2 U2 JSON逐字节不变 |
| RC05 | 采用Q1，读Q2 | U2 stale卡仍待答，actions含regenerate/abandon；U2@1不变 |
| RC06 | Q2放弃，再重放 | U2not_adopted/abandoned；原cursor/revision2；slot已释放 |
| RC07 | 真实requestRef同Workspace不同Goal | invalid；0写 |
| RC08 | 重开同SQLite/重建memory服务 | head与关闭历史相同；stale由当前pointer派生，模型0 |
| RC09 | 旧v2无requestRef/notAdopted | requestRef=null，无request claim；原存储对象不回写 |
| RC10 | requestRef属于别Workspace | forbidden；不读取别Workspace正文 |
| RC11 | 旧v1候选 | 仍解码为legacy_v1/candidate、只读；不增加request字段/claim |

`tests/work-graph/S5-decision-queue.test.ts`（9×2）：

| case | 操作 | 精确期望 |
| --- | --- | --- |
| DQ01 | 一条message、一cause、Q1/Q2候选、一planning question、一conflict；未来sources unavailable | waitingAnswer=6；countsComplete=false；capabilities note/release=not_available |
| DQ02 | 原Goaldisplay RUNNING且有需决定cause | cause卡1，不因标题RUNNING漏掉 |
| DQ03 | 缺initial architecture | source.kind=goal_cause；actions含adopt_architecture；planning_question0 |
| DQ04 | message accept 后 sender archive | waitingAnswer减1；answeredPendingApplication增1；卡仍有原sender |
| DQ05 | defer message | answered_no_application；待答/待落实都不含此卡 |
| DQ06 | paused下answer，然后读取 | answered_pending_application；Plan/Run/Goaldesired均不变 |
| DQ07 | cancelled Goal全来源读取 | 待答0；history readOnly=true/goal_cancelled；apply/answer actions不存在 |
| DQ08 | 主面readDecisionCard与queue找到同source | cardKey/answerMessageRef完全相同；一处答后两处answered |
| DQ09 | 读全部页/刷新 | message status、Workspace cursor、模型调用计数全不变 |

`tests/work-graph/S5-decision-application.test.ts`（14×2）：

| case | 操作 | 精确期望 |
| --- | --- | --- |
| AP01 | 非消息cause两个入口并发答 | 一个合成用户消息+一个source claim；输方revision_conflict |
| AP02 | answer accept，然后真实settings修改带ack ref | 分别两个不同cursor；答复时application=null；尚未补记仍待落实 |
| AP03 | 用真实修改receipt补记 | application.changes=原before/after；message rev+1；队列待落实减1 |
| AP04 | lookupCommit命中但没有所需正式事件 | incomplete；application仍null；0写 |
| AP05 | receipt before是旧错误对象版本 | revision_conflict；0写 |
| AP06 | 改对象成功，模拟第二消息commit失败，重开补记 | 卡显示已答复落实未记；补记成功；对象不再被修改 |
| AP07 | 应用后对象再变版，补同原receipt | 仍可证明历史应用；changes.after为原版本，不填当前版本 |
| AP08 | automation尝试answer | forbidden；0写 |
| AP09 | 当前pin不同但正式proof为同内容控制重定位 | application.basisRebases恰为原proof；changes.before真实版本；队列applied |
【lead 改：L1】AP10、AP11 删去（初始化采用的补记推到第 6 片），用例 ID 不重排；本文件共 14 个用例（含审查加的 AP14–AP16）。
| AP12 | 正式receipt声称eventId但eventAt损坏decoder | unavailable；application=null；0写 |
| AP13 | 提供cursor与lookupCommit原cursor不等 | revision_conflict；application=null；0写 |
| AP14 | 【审查改】修改由operator做；Session S的work_run（不是修改者，也不是operator）用同一receipt补记 | forbidden；application=null；0写 |
| AP15 | 【审查改】AP03补记成功后，新requestId、同一receipt再补记 | 返回的application与AP03深等；message revision不变 |
| AP16 | 【审查改】AP03补记成功后，新requestId、另一次真实修改的receipt再补记 | invalid；application仍为AP03的值；0写 |

`tests/work-graph/S5-notices.test.ts`（8×2）：

| case | 操作 | 精确期望 |
| --- | --- | --- |
| NR01 | 两system/agent requeue + 一auto reverify + 一human requeue | automatic_rework notices=3；source key三不同；human不列 |
| NR02 | 只读member类别limit1，其中pos10/11，reworkpos12 | seenThrough只有member pos10；标看后member pos11、rework pos12仍列 |
| NR03 | 合并limit1实际只返回member pos10 | 未发送的rework不能进入token/seenThrough；伪提交它回invalid |
| NR04 | 某message创建cursor10，后ack cursor20 | notice.position仍cursor10；已看后ack不再出一次 |
| NR05 | old since absent + 新since已绑定 | old legacy先列；新commit position真cursor；null持久origin回unavailable |
| NR06 | 两类位置分别保存，关闭重开 | 仅选定类被推进；单条消息status/response/application全保持原值 |
| NR07 | 同task自动后继round R2/R3/R4，任务只投影headR4 | reverify notices=3，refs=[R2,R3,R4]，counts=[1,2,3]；不是只有R4 |
| NR08 | 旧system自动reverify事实有count1但wire没有cap | notice1，cap=null，summary含上限未记录；当前cap变化不改此值 |

### 5.4 路由与场景

`tests/business/S5-decision-workflow.test.ts`（2 行；【审查改】新文件 F90。装配照 `tests/business/R5c-workflow.test.ts`：真实 WorkGraph memory 夹具和真实 Session 目录，只把执行、检查 owner 换成受控替身；不跑模型）：

| case | 给定 / 动作 | 精确期望 |
| --- | --- | --- |
| WF01 | B用真实setGoalSettings设every_step；B的tB上一个Run failed、可自动重新入队（prior=0、cap=3）；`Workflow.advance`一步 | value.state=waiting、next=null、reason=`automation_confirmation_required:system_requeue`；value.decisionCause：code=automation_confirmation_required、action=system_requeue、taskRef=tB；TaskRequeue 0、新Run 0、requeue owner调用0 |
| WF02 | 用真实reorderGoals设B order0、A order1；`orderGoalAdvances`收到[A的advance, B的advance]（同一个空闲Session能接两边） | 返回[B的, A的]；输入数组不变；records/events增量0 |

`tests/app/S5-decision-routes.test.ts`（8 行）：

| case | HTTP 请求 | 精确期望 |
| --- | --- | --- |
| RT01 | decisions/queue plain | named binding只调用queryDecisionQueue；status ready，无写 |
| RT02 | decisions/answer graph_write accept | ctx为Host绑定operator，JSON actor/duties字段无授权效果 |
| RT03 | plans/propose带requestRef/replaces | 完整字段传原owner，expected pins不丢 |
| RT04 | plans/abandon少proposal pin | invalid；不调用后续apply |
| RT05 | goals/settings/set带错误workspace | forbidden |
| RT06 | notices/seen token过滤不符 | invalid；Workspace未改 |
| RT07 | old messages/send普通SessionRef | 同旧binding/响应shape，未进sendUserMessage |
| RT08 | unsupported sources队列 | 返回capabilities，不伪装已完成；不调用模型 |


`tests/runtime/S5-user-message-tools.test.ts`（7 行）：

| case | 输入 / 实际接缝 | 精确期望 |
| --- | --- | --- |
| TU01 | adviser严格send_user_message、waitAfterSend=true，真实owner committed | 工具success；onWaitRegistered一次且原message ref；effects.sideEffect=none；模型未被工具额外调用 |
| TU02 | model加operatorActor字段 | invalid_arguments；owner调用0；不发信 |
| TU03 | executor决定发信，真实owner forbidden | execution_failed输出保留code=forbidden；没有wait注册 |
| TU04 | option=accept，text=''，annotations=[] | wire UserDecisionBody非空、body读原text=''；input.text恰为'用户答复\n'+canonicalJson(body) |
| TU05 | text含空格/换行、fm批注；两次同input supply | 首次一次完整selection/text/annotations输入；正式recordInputAccepted后第二次0项；inputId为原response id |
| TU06 | work_run试图工具answer_decision；用户读原卡答复 | names不含answer_decision；read_user_decision只读ready、正文/选择/批注与原answer一致，0提交 |
| TU07 | User decision等待进入原consultation consumer/pump | consumer unsupported；pump等待用户且consultOne调用0/Query模型0，普通Session咨询旧case保持 |

`tests/scenarios/S5-two-request-decisions.test.ts`（1 行）：

| case | 用原 openPlatformScenario/真实 SQLite 的行为组合 | 精确期望 |
| --- | --- | --- |
| SC01 | 两真实root查询Q1/Q2出候选→采用Q1→Q2过期仍留卡→用户自由文字/批注答Q2→暂停后待落实→继续后正式变更→漏一次补记→重启补记 | Q2原候选直至放弃/替换前为candidate@1；两入口同key；答复原文与批注一致；暂停期间模型/修改计数无增长；重启后同答复消息；正式修改只一次、补记只一次、待答0、待落实0；assertInvariants通过 |

`tests/scenarios/S5-goal-conflict-rework.test.ts`（1 行）：

| case | 用原 openHostScenario/脚本模型的行为组合 | 精确期望 |
| --- | --- | --- |
| SC02 | 【审查改】两Goal：A、B的活动计划都有scope为M的work Task（本片执行文件只来自executed-files stub，读作not_available；“计划模块对已改文件”只在GS11测）→冲突卡→接受风险→重排→一个系统和一个agent自动返工→一次自动重新检查→只看一类第一页→重启→换一方Plan | 1张并列三选项卡，footprintCompleteness两项executedFiles=not_available、possiblyIncomplete=true；接受后卡0/标签2，重排仍标签2；requeuecount按既有链1→2；reverify独立chain count1，notice恰好3；未展示条目重启仍在；换Plan标签0/卡1；已占用Run不被重排/等待追溯取消 |

场景支持扩 `tests/scenarios/support/S5-decisions.ts`，不改 harness.ts 的其他组默认 seed/actor/检查配置；不能预置假 MessageDecision/PASS 绕过入口。脚本只提供业务模型回答，provider调用预算由夹具固定，额外读/重放/补记调用增量=0。

### 5.5 必须保持的既有测试与检查

旧测试不改断言、不换 fixture 消掉失败。原 cases/id 保持：

- tests/state/message-machine.test.ts、plan-machine.test.ts、task-failure.test.ts、task-machine.test.ts、verification-machine.test.ts；原类型等价/原状态迁移保持，新字段另测。
- tests/work-graph/C1-session-mailbox.test.ts、C2-mailbox-admission.test.ts、R3a-goal-replay-boundaries.test.ts、R3c-plan-adoption.test.ts、W1-future-plan.test.ts、W2-agent-whiteboard.test.ts、R5b-initial-plan.test.ts、R5b-query-job.test.ts。
- tests/work-graph/A2-goal-control.test.ts、A2-requeue-service.test.ts、R3e-reverify.test.ts、R3c-canonical-task-state.test.ts；人工停止、原cap、原no-progress和拒绝回执不变。
- tests/scenarios/C8-auto-rework-cap.test.ts、C8-human-stop-respected.test.ts、A4-duplicate-receipts.test.ts；tests/architecture/state-writes.test.ts、boundaries.test.ts；tests/record-store/lookup.test.ts、transaction-extensions.test.ts。

旧 source stub absent 时旧命令不额外拒绝；只有新增用户消息/新读来源明确unsupported。旧无requestRef propose/apply 仍同事务/返回shape；origin wire 不泄漏到旧port返回或重放结果。边界测试只增加具名字段/decoder/新路径，不降低扫描范围。

骨架阶段运行本片点名的新增 tests（明确哪些应因unsupported而红）和 typecheck/check:architecture；lead冻骨架后实现阶段运行新增+上述相关旧文件。实际 taskbook需写每条命令的基线文件/用例数和期望增量；不写“跑整个目录”。这份草案未运行任何测试，不宣称旧基线通过。
## 6. 施工文件清单与共享负责人

以下是 **未来 slice 5 实现** 的推荐文件清单，不是本轮写权限；本轮只写本文件。N=创建，M=修改。路径从仓库根算；WorkGraph 行用 `WG/` 表示 `src/core/work-graph/`。每行一个文件，lead 冻结 scope 时须展开缩写为完整路径。共享列 `1/3` 是本轮最需协调的相邻片；`2/4/6/7/E3` 提醒后续消费者。`—` 表示未发现相邻片必要改动，并不授权顺手改其他文件。

### 6.1 类型、状态机、owner 和读模型

| id | 文件 | 动作 / 子模块 | 唯一改动用途 | 共享片 |
| --- | --- | --- | --- | --- |
| F01 | src/contracts/goal-decisions.ts | N / contracts | 纯设置/答复/source/游标/footprint DTO、canonical source key | 1、3、6、7 |
| F02 | src/contracts/ledger.ts | M / contracts | Goal/Workspace 可选设置；cursor消费者说明 | 1、6 |
| F03 | src/contracts/core/session-message.ts | M / contracts | User 收件方、decision_request 及纯消息类型 | 1、3、7 |
| F04 | src/contracts/plan.ts | M / contracts | Accepted 事件可选 application proof/ack 归因字段 | 3、6 |
| F05 | WG/model/decision-contracts.ts | N / model | §2.6/3.3/4.1 ports、依赖和能力 stub 契约 | 1、3、6、7 |
| F06 | WG/model/communication-contracts.ts | M / model | 消息扩展、response union；原 SessionMailbox shape 保持 | 1、3、7 |
| F07 | WG/model/plan-contracts.ts | M / model | 候选请求/未采用、窄 reader、propose/apply 扩展 | 3、6 |
| F08 | WG/state/goal-settings-machine.ts | N / state | GS/AU 的 Goal 构造、等待/冲突纯判定、语义基础比较 | 1、6 |
| F09 | WG/state/decision-policy.ts | N / state | 动作自治表、职责发送、自动动作需决定原因 | 1、3、7 |
| F10 | WG/state/notice-settings-machine.ts | N / state | Workspace 类别位置构造，不解析 cursor | 1、7 |
| F11 | WG/state/message-machine.ts | M / state | User/答复/落实构造，镜像类型等价，旧行不变 | 1、7 |
| F12 | WG/state/plan-machine.ts | M / state | request/替换/未采用/关闭读投影 | 3、6 |
| F13 | WG/persistence/decision-record-codecs.ts | N / persistence | GS/notice 事件 codec、纯 receipt fact 校验 | 6、7 |
| F14 | WG/persistence/record-codecs.ts | M / persistence | Goal/Workspace 设置 default/严格 codec | 1、6 |
| F15 | WG/persistence/plan-record-codecs.ts | M / persistence | 请求索引、未采用、Accepted 原事实扩展 | 3、6 |
| F16 | WG/persistence/rework-codecs.ts | M / persistence | since wire 严格结构和保持，原 public 值不变 | 1 |
| F17 | WG/persistence/evidence-record-codecs.ts | M / persistence | Round since/通知原事实读取，旧 round codec 不降级 | — |
| F18 | WG/configuration/project-bootstrap-record-codecs.ts | M / configuration | workspaceSnapshotFromValue 接受设置，不回写历史 | 6 |
| F19 | WG/configuration/decision-settings-service.ts | N / configuration | markNoticesSeen owner、回执；注入 token verifier/position comparator | 1、7 |
| F20 | WG/configuration/message-duties-adapter.ts | N / configuration | 精确 RoleBinding→duties 过渡 adapter，片3替换 | 3 |
| F21 | WG/sessions/message-record-codecs.ts | M / sessions | User/host response/新事件/3索引/origin | 1、7 |
| F22 | WG/sessions/message-body-envelope.ts | M / sessions | 用户回答 envelope，原角色正文兼容 | 1、7 |
| F23 | WG/queries/query-record-codecs.ts | M / queries | 正式问题发现 by-workspace-goal 索引 | 6 |
| F24 | WG/tasks/goal-settings-service.ts | N / tasks | settings/order/conflict owner，不读写消息 | 6 |
| F25 | WG/tasks/executed-files-stub.ts | N / tasks | 明确不具备 executed files，不假称为空且完整 | 2 |
| F26 | WG/tasks/request-facts-reader.ts | N / tasks | 已保存第一轮 QueryJob 事实的过渡 request seam | 6 |
| F27 | WG/tasks/goal-decision-reader.ts | N / tasks | Goal 原因 + every_step 自动动作原因，只读不改 GoalPhase | 1、6、7 |
| F28 | WG/tasks/planning-question-reader.ts | N / tasks | 正式已保存规划问题的只读 reader | 6 |
| F29 | WG/tasks/initial-plan.ts | M / tasks | 导出原 normalize/parser 辅助，语义不重写 | 6 |
| F30 | WG/tasks/plan-service.ts | M / tasks | request 原子 slot/head、adoption/abandon、导出原 Answer facts 读取 seam | 3、6 |
| F31 | WG/tasks/plan-readers.ts | M / tasks | 请求 head/全候选枚举、保持原 pendingPlan 兼容投影 | 3、6 |
| F32 | WG/tasks/plan-commit-compiler.ts | M / tasks | 既有 plan commit 加精确 slot/proof，不拆原子提交 | 3、6 |
| F33 | WG/tasks/claim-record-codecs.ts | M / tasks | TaskRequeue since/通知事实 wire | 1 |
| F34 | WG/tasks/claim-service.ts | M / tasks | 真实领取前等待/当前 Goal 设置 CAS guards | 1、3 |
| F35 | WG/tasks/execution-entry-service.ts | M / tasks | 修改工作的 entry/新 continuation 等待 guard | 1、3 |
| F36 | WG/tasks/requeue-service.ts | M / tasks | 自动自治 policy、创建 origin；不改已有计数 | 1、7 |
| F37 | WG/evidence/evidence-service.ts | M / evidence | 自动 reverify policy/origin，保持既有 round chain/cap | — |
| F38 | WG/communication/mailbox-service.ts | M / communication | 新 User send、原 sender 读取自己收到的回答、User 不冒充 Session、共享 helper | 1、3、7 |
| F39 | WG/communication/decision-service.ts | N / communication | answer/application owner，原消息或 synthetic 槽 | 1、7 |
| F40 | WG/communication/decision-application.ts | N / communication | lookupCommit/eventAt proof 白名单、补记，非业务修改者 | 6 |
| F41 | WG/communication/decision-source-facts.ts | N / communication | canonical 来源及角色/变更 proof 准入；不依赖 views | 1、4、6、7 |
| F42 | WG/views/decision-read-model.ts | N / views | 七源 join、同一卡、分页/计数/历史/capabilities | 1、4、6、7 |
| F43 | WG/views/goal-conflicts.ts | N / views | catalog/足迹读取并调用 state 纯算法、风险标签 | 2、6 |
| F44 | WG/views/automatic-rework-notices.ts | N / views | 两种返工正式历史、去重/source origin | 1、6、7 |
| F45 | WG/views/notice-position.ts | N / views | 唯一 Notice ReadModelIndex cursor 比较、merge/page | 1、7 |
| F46 | WG/views/notice-display-token.ts | N / views | 只读显示页 token；由 composition 注入给 Workspace owner | 1、7 |

### 6.2 装配、Workflow 和现有 Runtime 的窄接线

| id | 文件 | 动作 / 子模块 | 唯一改动用途 | 共享片 |
| --- | --- | --- | --- | --- |
| F47 | src/business/workflow/decision-actions.ts | N / Workflow | answer→settings→application 有限协调；暂缓/部分提交结果 | 1、6、7 |
| F48 | src/business/workflow/contracts.ts | M / Workflow | ResolveDecision input/progress DTO | 1、6、7 |
| F49 | src/business/workflow/ports.ts | M / Workflow | 新 port、settings/duties/source 依赖 | 1、3、6、7 |
| F50 | src/business/workflow/workflow.ts | M / Workflow | 自动动作 policy、orderGoalAdvances 安全点 | 1、3、6、7 |
| F51 | src/core/agent-runtime/communication-tools.ts | M / AgentRuntime | send_user_message/read_user_decision/record_decision_application 工具，不装 answer 工具 | 1、3、7 |
| F52 | src/core/agent-runtime/execution-contracts.ts | M / AgentRuntime | 可选 decisionMessages 依赖，原 wait/input seam 不变 | 1、3、7 |
| F53 | src/core/agent-runtime/execution-driver.ts | M / AgentRuntime | 同一工具 factory 注入真实 owner；旧工具注册保留 | 1、3、7 |
| F54 | src/core/agent-runtime/execution-inputs.ts | M / AgentRuntime | response input 带选择/批注的确定性供给；单 inputId/acceptedInputs | 1、3、7 |
| F55 | src/composition/create-platform.ts | M / composition | 单实例/schema唯一注册/operator/token/source stubs/tracked ports | 1、3、6、7 |
| F56 | src/app/core-http-types.ts | M / Host | 12 suffix/input/result union 与旧字段扩展 | 1、3、6、7/E3 |
| F57 | src/app/core-routes.ts | M / Host | specs/bindings/dispatch 完整同名路由 | 1、3、6、7/E3 |
| F58 | src/app/collaboration-driver.ts | M / Host | 仅把现有 pending advances 送 Workflow 安全点排序 | 1、6、7 |

Runtime 接线只为使 slice 5 的“按职责发给用户/收到用户话和批注/补记”可从真实 adapter 核对。不造 secretary_turn、自动转发、Query 写工具、新的 await loop 或 Kernel 协议；不修改 vendor/dist、Skill 内容或主对话 UI。片3/7在同一 seam 替换 duties/secretary 身份事实，不拆成第二套工具列表。

### 6.3 测试、检查、其余兼容接线与权威文档同步

| id | 文件 | 动作 / 归属 | 用途 | 共享片 |
| --- | --- | --- | --- | --- |
| F59 | tests/state/S5-goal-settings.test.ts | N / state tests | GS/AU 等待/版本纯反例 | 1 |
| F60 | tests/state/S5-decision-policy.test.ts | N / state tests | 自治/职责表 | 1、3 |
| F61 | tests/state/S5-message-decision.test.ts | N / state tests | User/答复/落实构造 | 1、7 |
| F62 | tests/state/S5-request-candidate.test.ts | N / state tests | 请求迭代/stale/关闭 | 6 |
| F63 | tests/state/S5-notice-settings.test.ts | N / state tests | 分类位置/no-op | 1 |
| F64 | tests/work-graph/S5-goal-settings.test.ts | N / tasks tests | memory/SQLite settings原子/重放 | 1 |
| F65 | tests/work-graph/S5-user-messages.test.ts | N / communication tests | memory/SQLite可信角色/正文 | 1、3、7 |
| F66 | tests/work-graph/S5-request-candidates.test.ts | N / tasks tests | memory/SQLite唯一槽/替换故障 | 6 |
| F67 | tests/work-graph/S5-decision-queue.test.ts | N / views tests | memory/SQLite七源/暂停取消 | 1、4、6、7 |
| F68 | tests/work-graph/S5-decision-application.test.ts | N / communication tests | memory/SQLite真receipt/补记 | 6 |
| F69 | tests/work-graph/S5-notices.test.ts | N / views/configuration tests | memory/SQLite创建origin/显示范围 | 1、7 |
| F70 | tests/app/S5-decision-routes.test.ts | N / Host tests | named binding/字段完整转交 | 1、3/E3 |
| F71 | tests/runtime/S5-user-message-tools.test.ts | N / AgentRuntime tests | 用户发送/落实工具、完整输入供给 | 3、7 |
| F72 | tests/scenarios/S5-two-request-decisions.test.ts | N / scenarios | SC01 | 1、6 |
| F73 | tests/scenarios/S5-goal-conflict-rework.test.ts | N / scenarios | SC02 | 2、3、7 |
| F74 | tests/scenarios/support/S5-decisions.ts | N / support | 两场景真实夹具，复用既有 harness | 1、3 |
| F75 | tests/helpers/S5-decision-fixture.ts | N / support | memory/SQLite共同数据，不mock领域结论 | 1、3 |
| F76 | tests/architecture/state-writes.test.ts | M / architecture tests | 新保护字段/具名 decoder 允许项 | 1、3、7 |
| F78 | tests/architecture/production-reach-allowlist.json | M / architecture checks | 只为后片未接消费写具体 kept-for，不屏蔽已接入口 | 1、3、4、6、7 |
| F86 | src/business/workflow/consultation.ts | M / Workflow | User recipient窄guard，禁止当Session咨询发Query | 1、7 |
| F89 | src/contracts/platform-duty.ts | N / contracts | 【lead 改：L3】共用的 `PlatformDutyV1`，原文见 README“共用文件”，逐字节相同 | 1、3 |
| F90 | tests/business/S5-decision-workflow.test.ts | N / Workflow tests | 【审查改】WF01、WF02：每步确认挡自动动作、按顺序排 advance | — |
| F87 | src/core/work-graph/state/goal-machine.ts | M / state | 原nextGoalDesiredState保留已有settings，旧缺省shape不动 | 1 |
| F88 | src/ui/views/execution/actions.ts | M / 既有UI边界 | 仅Session recipient类型guard，不施工新画面 | E3 |

【lead 改】草稿的 F77、F79–F83 移出 DSH 写范围（L2：`module-target.json` 由 B0 写，其余文档由 lead 验收后同步），F84、F85 删去（L1），ID 不重排。冻结的写范围是 82 个文件：41 N、41 M（源码 62、测试/支持/检查 20；含新加的 F89、审查加的 F90），见 §0.6。下面是草稿原文：未来推荐清单共 **88 文件：39 N、49 M**（源码63、测试/检查20、权威文档5）。不改旧测试来替换其已定期望；architecture 两个测试的规则登记是明确例外。将来产生验收日志时先在实际 taskbook 给一个具名证据目录/文件清单，它们不在这份源码清单里，也不自动获得写权限。

【lead 改】合入方法以 README 为准：三片从同一基线各自施工，各自验收后由 lead 按 1 → 3 → 5 合并共享文件，不先合骨架。草稿原文：共享文件单写者：lead 汇总 F01–07/F11–18/F21–23/F30–35/F48–58/F76–88，DSH只落冻结的slice5字段/行/注册项。另片重基于这些改变，不能覆盖同文件全体；若slice1/3同时施工，先由lead合并骨架再分别派实现。注册索引、route union、state保护清单的共同修改必须按具名片段合入。

## 7. Lead 冻结的技术选择与 needs the user

### 7.1 只改技术，不重开已定用户行为

以下每项恰好两个选项。前文按推荐草案写，lead须在派DSH前将选项、文件清单、测试hash一并冻结；未选不能让DSH自行定。

| id / 选择 | 选项 A | 选项 B | 推荐及理由 |
| --- | --- | --- | --- |
| T01 请求当前候选唯一性 | Store unique claim，完整Goal+QueryJob键；读取历史用注册lookup | 枚举同请求全部候选，加ledgerHorizon检测并发，无claim | 【lead 定：A】A。当前Store已有claim CAS；两个首候选和替换可在同事务证明唯一。B会把无关写变竞争，且不能省略窗口正确性 |
| T02 暂停后落实的版本 | 捕获内容基础，继续后只允许控制状态变化的Goal revision重定位；当前pin仍CAS | 把答复冻结为含原Goal pin；继续后另做显式“重新核对”内部步骤再生成application basis | 【lead 定：A】A。§2.8将基础字段/允许差异写死；不改用户“暂停可答，落实等继续”，无需再答一次。B仍必须保留原答复/可见待落实，不能以stale要求用户重新选择 |
| T03 模块依赖 | configuration 加 state；communication 加 configuration/architecture 仅读正式proof；声明views向下依赖 | 把通用pure codec/contracts上移persistence，由原owner导出窄facts，少加依赖边 | 【lead 定：A 的缩小版】只加 configuration→state；views 按 B0；communication 不加边（L1）。草稿原文：A 的局部边，配合§2.8白名单。层级均向下且无环。B可做，但不得借此搬全文件、复制parser或注入向上逻辑调用；若B被选须重冻结F13/F40/F41清单 |
| T04 旧origin兼容 | wire顶层since，public DTO不变；legacy时间/key前缀排序 | 所有来源事件遍历反查创建cursor，保持record完全不扩 | 【lead 定：A】A。Store只有注册顶层since/until可binding；精确读创建cursor，后续更新复制。B既没有当前逐事件定位索引又会扩大查询，不能拿最后更新cursor代替 |
| T05 显示页token | Host进程内密钥HMAC封装显示位置，无持久表；重启需重新读页 | 以完整read request/window重新查询校验token，无密钥 | 【lead 定：A】A。scope/操作者/过滤/page边界不可改写；key仅composition内存。B可选但重查询不能越过原实际返回集合，并需覆盖原读水位重建失败。两者都不证明人眼已看，UI仍须在实际呈现后提交 |
| T06 synthetic answer保存 | 用原SessionMessage responded@1 + 单独part envelope + unique answer claim | 同原消息先pending@1再responded@2，但两记录版本在一个commit里折叠 | 【lead 定：A】A，与原Store“一记录一目标revision”一致，明确state构造与新Answered事件。B不可真的让同commit对同ref写两次，容易把它误建成新提问；必须先freeze折叠语义 |
| T07 源装配/稳定窗口 | 一个views aggregator，逐来源窄reader，共享首读cursor、merge确定分页 | 各owner加独立queue API，Host合并 | 【lead 定：A】A。源canonical验证仍归communication/下层owners，views只读；统一同一卡和display token。B更易产生计数/水位/双入口身份分歧，不得把Host变业务规则库 |
| T08 新纯类型位置 | shared source/settings/response基础放contracts；ports留model | state局部镜像基础type，model单独声明，以类型等价测试约束 | 【lead 定：A】A；旧MessageSender可兼容type alias，不搬服务。B符合现有message-machine镜像风格，但所有新字段须双处同步，不能让state import model |

【lead 改】`module-target.json` 由 lead 在 B0 写好（README）：configuration.dependencies 追加 state；views 按下面的列表；communication **不**追加（L1）。`pureDirectories` 已在 820817c3 退役，state 用 `pure: true`（L4）。DSH 不改这个文件。草稿原文：推荐 module-target 精确增量：configuration.dependencies追加state；communication追加configuration、architecture；新增views.dependencies=[model,state,persistence,configuration,materials,architecture,sessions,queries,tasks,evidence,communication]。views不得作为configuration/communication/tasks的依赖；note/release只读adapter通过model窄port注入，生产owner不调用views。配置owner需要notice比较/token验证，通过contracts声明的纯/无写接口注入；它们只处理已给定token/位置，不读取views或业务源。原model→state例外保持；不把pureDirectories删掉。

### 7.2 needs the user

**本片没有新发现的用户可见行为缺口。** 已答的文字打架不重新提问：REVIEW第3甲采用另一请求→过期保留，42第6自由文字/批注，AMB-9(b)文件归模块比较，AMB-15(b)逐类别游标，都按settled答案。

以下是未施工的接缝，设计已有文字，归lead技术实现/后片；不能伪装已完成，也不需要用户重定：

| 设计原文 / 位置 | 本片处理 | 若以后出现相反需求时才需要用户 |
| --- | --- | --- |
| DESIGN §1.4：“目标暂停时卡照样能答、落实等继续” | 原答复保留；§2.8仅控制字段可重定位；内容变了仍待落实/显式拒绝 | 要自动接受新内容、自动继续目标或以答复复活目标 |
| DESIGN §1.1：“秘书不猜，等那个先采用，或者在一个方案里一起改” | 本片不强行联并未采用方案；片6重出时引用正式活动Plan | 要未采用草稿间执行依赖或多活动Plan |
| DESIGN §1.3：“每次自动返工…都进‘请知悉’”【lead的做法】 | 系统/agent/reverify均投影；发送秘书/第二次参谋由片7、主面折叠由片6 | 要改通知频率/对象，这是用户可改lead做法，不当既定批准 |
| DESIGN §1.4：“和选项一起送达提问的一方” | 原sender读原response/确定性输入供给；非消息答复可按source reader读；不加自动模型回合 | 要新的自动唤醒/读卡即执行行为 |

若骨架审查发现其他产品文字空白，DSH必须在UNSPECIFIED逐项引用原文及两种可见结果后STOP，不能以T01–08授权自己补产品行为。

## 8. 大小、实施顺序与 DSH 风险规则

### 8.1 估计与冻结数字

这是代码量估计，不是DSH任务书允许的“约几个文件”。推荐清单是88个精确路径；lead选项改变清单时先改规格并重新冻结。

| 类别 | 文件 | 估计新增/修改有效行（不含大段原文件格式重写） |
| --- | --- | --- |
| contracts/WorkGraph/Workflow/Runtime/Host/composition及原UI类型guard | 63（22 N、41 M） | 4,880–6,960 |
| 新行为测试+场景support | 17 N | 1,800–2,600 |
| architecture登记/production reach | 3 M | 70–130 |
| 权威文档同步 | 5 M | 220–400 |
| 合计 | 88（39 N、49 M） | 6,970–10,090 |

【lead 改】冻结数：**153 个逻辑 case、224 个运行 case、16 个 test 文件** = unit63 + service71×2 + routes8 + Runtime7 + Workflow2 + scenarios2（AP10、AP11 删去，L1；【审查改】加 SS15、SS16、UM13、AP14–AP16、WF01、WF02）。草稿原文：新增测试精确数：**147个逻辑case、214个运行case、15个test文件** = unit63 + service67×2 + routes8 + Runtime7 + scenarios2；另2个support文件不算test文件。测试表的运行数量按§5逐行而不是按“约”发给DSH。每个memory/SQLite行生成两个具名case；场景只SQLite，不再复制backend矩阵；旧测试不计新case总数。骨架阶段必须记录新增case逐项id/名字/hash；实现阶段不得改它们。

这片范围跨度大，风险主要是语义接缝，不能用行数拆成几个自由设计批。按STATE-MACHINES-SPEC §15约定顺序：①contracts/default codecs/index/保护清单 ②纯state行与unit tests ③owner/ports骨架和memory/SQLite测试 ④views/routes/Workflow/Runtime接线骨架与场景 ⑤lead中审冻结 ⑥DSH实现 ⑦限定检查、lead独审与既有文档同步。①–④是同一个第一阶段；完成骨架与tests即STOP，不先偷偷实现易写的状态机。

两阶段任务书都按DSH-WORKFLOW §6四段：FILES CHANGED（逐文件与N/M）、CHECKS（精确file/case/exit）、UNSPECIFIED（引用每一处缺口，不以“未发现”代替列举）、NOTES（正式入口/保留行为/未实现/用量）。明确模型deepseek-flash、同Session第二阶段、第一阶段STOP。冻结接口和tests sha；若接口/测试冲突，报告最小反例交lead，不改产品。派发前单独快照当前HEAD/共享文件hash，不能拿旧lane基线覆盖本仓库。

未来检查命令由lead按现有package.json填完整显式Vitest文件参数：§5所有新增test file、§5.5点名旧文件去重一次；`npm run typecheck`、`npm run check:architecture`、`npm run build`和原production reach扫描。每命令先记录基线精确文件/用例数，再记录新增增量；没有新失败或底层变更不扩大全仓复验。两场景使用原harness和scripted provider，HTTP/只读/补记预算=0；没有批准的真实模型或UI规模验收。

### 8.2 最易写错处必须逐句放进任务书

| 风险 / lead查什么 | 给DSH的明确规则 |
| --- | --- |
| scope/权限 | 先检查ctx project/workspace，再读正式对象；跨Workspace forbidden，同Workspace缺对象not_found。actor/duties/requestId不从模型JSON推导。operator是可信配置身份，自动化Host不能答 |
| request head并发 | 同请求首写/替换/采用/放弃的record/event/claim同commit；旧候选替换必须not_adopted；其他请求零写，stale只派生；不能沿findPendingProposal读到的一个候选当全集 |
| 答复/修改/补记三种事实 | answer提交不改Plan/Task；修改成功但应用未记仍在待落实；补记必须lookupCommit+eventAt，不能用当前值或caller传PASS。ack ref只是归因，不是授权 |
| 暂停/取消 | 暂停可答，不能因暂停卡消失；应用等人点继续，控制字段版本重定位必须有同内容基础；取消只读/不复活/候选关闭，不能由answer顺带恢复 |
| 固定等待/自治并发 | wait存完整前Goal，不按当前列表重新挑；完成或取消解锁；所有新修改入口检查并guard读取事实。提示冲突无硬门槛，已经开始的工作不被重排/设置停止 |
| 风险接受版本 | 双完整Plan ref+无序Goal对；存当时后Goal；排序变化不失效，任一Plan变化失效；null不是通配；不用普通Goal revision当冲突身份 |
| footprint缺资料 | planned module vs executed file须先映射模块；只有名字相同不算；未知/缺adapter显示不完整，不能当零冲突或扩全仓。possible改动带来源，不冒充确定归属 |
| 七源计数/历史 | 读具体原因，不只NEEDS_DECISION标题；已过期候选保留；answered_pending_application不算待答；sender归档不滤掉；未接source显式not_available |
| notice cursor | 创建commit origin，不用最后ack/current水位；逐类别且仅实际返回项；markSeen不修改消息status；不把itemKey排序当时间，不以wallclock吞并后页 |
| 自动返工 | system/agent共用现有requeue计数；reverify读全后继round链；人工不列自动通知；中断豁免不加次数；不改已有cap/no-progress/human-stop；请知悉投影不创建调度或模型回合 |
| 正文/批注输入 | 原文及annotations存在response并由可信envelope绑定；只读response仍用原inputId/acceptedInputs供给一次，不能用prose猜选择或产生新的授权 |
| state/边界 | 所有受保护字段仅state构造，state只contracts无IO；不放宽整个文件allowlist，不用注入port掩盖tasks→communication或configuration→views逻辑上行 |
| 原回执 | 重放早于新业务状态读，恢复原event结果/cursor；Goal改版、sender归档、消息已答不破坏同身份重放；同身份改正文回idempotency_conflict；新身份再答不覆盖单槽 |
| 数据兼容 | missing字段默认，bad字段unavailable；公开旧DTO/回执shape不混wire origin；唯一schema注册；encoder重写旧消息复制原origin；不迁移/回填旧记录 |
| 范围/流程 | 只写冻结清单，禁止add/rm/checkout/restore/stash/reset/commit/push；草稿只在副本指定目录、不用/tmp；不读凭据、不装依赖、不改vendor/dist/锁文件；两阶段STOP和hash必须真实 |

lead独审重点：读写真实链路并复核原事件decoder/receipt版本，不只看绿测试。CHECKS每个数字与工具输出相符；“没有越界/没有复制/没有额外调用”的报告须分别用文件diff、import/调用搜索和provider计数证明。出现反例只发file:line、要重读的规则和允许返修范围，限一轮必要返工，不用隐藏测试答案让DSH凑值。
