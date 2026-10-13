# 模型图

2026-10-13 按决定 42–49 及接线包 2 L10–L12 更新

> **lead 的原说明（2026-10-08，历史）。** 最初是 Codex 第 1 步画的 Mermaid 图，当时只核格式、未渲染；当时删除了 CandidatePlan 的“R59 放弃 → 未采用”，因为正文尚未定。决定 42 已定放弃记“未采用”，本次恢复该边。行号和编号的约定同 [MODEL.md](MODEL.md) 开头的说明。

这些图按 [DESIGN.md](../DESIGN.md)、MODEL 和 [HANDOFF 决定 42–49](../../../HANDOFF.md) 表示当前设计。`Rnn`、`Onn` 是 MODEL 编号；“决定 49 · 19”等是该决定的审查项号，不是 R19。已定的行为不再标成未批准提议；技术表示仍以各片冻结规格为准。已有 Run、Task、Round、GoalPhase 只画成外部事实，不重新画它们的机器。读时派生的状态也画迁移，箭头表示导致读取结果变化的事实，不代表写新状态表。

第 1、3、5 片和接线包 1 已做完（决定 43、47、48）；下图同时画出尚待施工的设计，并在相关段落标明。接线包 2 引用本次指定的外部草案 `D:/cxt/w2-spec/docs/refactor/design/orchestration-2026-10/slices/wiring-2-SPEC.md` §0.1、§0.2、§2.3（下称“接线包 2”，L10–L12 已定），不把草案当已实现。

## 对象关系：第 1、3、5 片优先

依据 O09、O24–35、O40；补异常锚点与装配器（决定 42、47），注记关系、全文及 views 读取边（决定 49 · Q8、Q9）。虚线标明待接的数据流；对象间的关系不单独证明消费链已经建成。

```mermaid
flowchart LR
  Scope[Scope / Ref / Actor] --> Session[Session + Provenance]
  Op[SessionOperation 外部] --> Session
  Session --> Link[Responsibility]
  Session --> Line[Line 派生]
  Session --> Copy[copy 派生 Session]
  Copy --> Line
  Run[RunFact 外部] --> Line
  Task[TaskFact 外部] --> Link
  Run -. 第2片执行文件 .-> Footprint[Footprint 派生]
  Plan[PlanFact 外部] --> Footprint
  Footprint --> Conflict[冲突 Card 派生]
  Goal[Goal + GoalSettings] --> Conflict
  Goal --> Query[QueryRound]
  Session --> Query
  Query -. 第6片 .-> Request[Request 派生]
  Request --> Candidate[Candidate / CandidateView]
  Candidate --> Card[Card 派生]
  Conflict --> Card
  Phase[GoalPhaseFact 外部] --> Card
  Note[Note 第4片] -. 待接 .-> Card
  Message[Message + Reply + Application] --> Card
  Session --> Undelivered[未送达回复 派生]
  Message --> Undelivered
  Undelivered -. I-5 待接 .-> Queue
  Card --> Queue[Queue]
  Card -. 第6片 .-> Main[MainSurface]
  Request -. 第6片 .-> Main
  Message --> Wait[WaitView 派生 / 第7片补处置]
  Run --> Wait
  Query --> Wait
  Goal -. 第7片 .-> Counter[DispatchCounter]
  Counter -. 派工核版本 .-> Message
  Pointer[CurrentPointer 第4片] -. 当前引用 .-> Note
  Pointer -. 第7片派工核版本 .-> Message
  Plan -. 第7片派工核版本 .-> Message
  Note -. 第4片 .-> Context[Assembly]
  Task --> Context
  Goal --> Context
  Input[InputRequirement / SelectedInput] --> Context
  Source[Source 固定版本] -. 第4片 .-> Note
  Source --> Input
  Session --> Anomaly[SessionAnomalyAnchor]
  Run --> Anomaly
  Task --> Anomaly
  Anomaly --> Context
  Anomaly --> Graph[任务 / 目标节点详情]
  Anchor[Anchor 主及附加] -. 第4片 .-> Note
  Note -. O34字段及按锚点反查 .-> Relations[关系视图 派生]
  Note -. 第15个索引 .-> FullText[全文查找]
  Note -. 第4片 .-> Views[views 读 notes]
  Views -. 第4片 .-> Graph
  Goal -. I-4 待接自治 .-> Context
  Card -. I-6 待接待答索引 .-> Context
```

没有 MainSurface → Session 的一对一边。Request、Line、Card 和注记关系视图不落新表。接续与换手的区别依赖 Session 来历，不能按相同职责或任务名称拼线。异常锚点是第 1 片已有的独立事实，不等第 4 片 Note；其提醒已由接线包 1 接入（决定 42、47）。`views → notes` 是原规划的依赖边，第 4 片首次落文件时声明；这里的数据流箭头画作 Note → views（决定 49）。

## 写入权威和提交边界

依据 §2.6、§7.2；决定 47、48 的补记和重放，接线包 2 L10–L12 的两个位置由原写者提交。

```mermaid
flowchart TD
  U[用户] --> APIs[Host 接口]
  Agent[agent 工具] --> Runtime[AgentRuntime 动作 / 输入]
  Runtime --> WG[WorkGraph 唯一写入口]
  APIs --> WG
  WF[Workflow 走一步] --> WG
  WG --> Pure[state 纯守卫和记录构造]
  Pure --> Store[事实 / CAS / 索引 / 原提交位置绑定]
  Store --> Host[提交观察]
  Host --> WF
  Store --> Views[只读 views]
  Views --> UI[主面 / 工作线 / 决定队列]
  Runtime --> K[Kernel 外部适配器]
  K --> Observed[可信执行事实]
  Observed --> WG
  Store --> Receipt[原回执重放]
  Store -. 接线包2待建 .-> Positions[unavailableSince / responseSince]
  Positions -. I-5 只读取较晚位置 .-> Views
```

工具不调用 Workflow。任务变更和消息落实分两次提交；补记失败留“已答复，落实未记”，同请求成功重试先重放原回执，不因后来换自治或读失败重做（决定 47、48）。派工消息与 sequence 加一同次提交（决定 49 · 16，第 7 片）。创建接任 Session 与责任转移不是跨 Kernel 原子事务。原机器完成归约继续由原 owner 执行。

接线包 2 L10–L12：state 在每次进入 unavailable 或原 work_run 发信消息首次保存回复时置提交前的 null 槽，原 Session/消息 owner 同事务绑定 commit cursor；恢复时由 state 移除 unavailableSince。RecordStore 只机械绑定，views 不写入；持久记录及对外回执不能残留 null。重放用原 receipt.cursor，读取不补旧数据的位置；L12 只补四处旧完整对象断言的新字段，不改 SES-13 的迁移与守卫。

## Session 与工作线

依据 §1.5、§4.2–4.9；决定 38、42、43、45、47、48、49，SES-13 及接线包 2 L10。归档与 health 是两维；已退役是当下不可用的显示，不能把 active + unavailable 画成永久终态。

```mermaid
stateDiagram-v2
  [*] --> Creating
  Creating --> Active: 外部 operation completed / R01
  Creating --> CreationUnknown: 外部 unknown
  CreationUnknown --> Active: 正式核对 completed / R01
  Active --> Working: 外部执行开始
  Working --> Waiting: Work yield；秘书按未回请回答派生
  Working --> Done: 任务全终结且无等待 / 执行者
  Active --> Retired: health unavailable 且无接续 / 进入写R
  Working --> Retired: 正式释放但Turn悬空 / 进入写R
  Waiting --> Retired: 正式健康观察 unavailable / 进入写R
  Done --> Retired: 正式健康观察 unavailable / 进入写R
  Retired --> Active: active且ready / SES-13恢复，清R
  Waiting --> Working: 回复或到期输入被接受
  Done --> Working: 新Task正式领取 / 完成Goal先确认新Goal
  Done --> ArchivedDone: 满一天且事件触发 / R06
  Retired --> Retired: outcome_unknown仍占用 / 决定45等人认定
  Retired --> ArchivePending: 无接续且可处置 / 下一次维护
  Active --> ArchivePending: 用户归档 / R05
  Working --> ArchivePending: 立即请求停止，安全点确认停下
  Waiting --> ArchivePending: 用户选取消或转走等待
  ArchivePending --> ArchivePending: 停止未证实或Query未结束 / 保留请求
  ArchivePending --> AnomalyRecorded: Work已停或用户认定 / 异常锚点
  AnomalyRecorded --> Archived: 任务交给或放下、等待处置、最终CAS
  AnomalyRecorded --> ArchivedRetired: 退役无接续 / 放下任务，保留等待
  ArchivePending --> Archived: 无中断Work / 处置完成后CAS
  ArchivePending --> ArchivedRetired: 退役且无未完任务 / 保留等待后CAS
  ArchivedDone --> Active: 能力核实 / R07
  Archived --> Active: 能力核实 / R07
  ArchivedRetired --> ArchivedRetired: SES-14拒unavailable / 不探测已归档线
  Retired --> SameLineNewHead: R03建continuation并转本任务责任
  ArchivedRetired --> SameLineNewHead: 用户继续旧任务 / 另Session
  Active --> NewHandoffLine: R57 / handoff，接任另起线
  note right of Retired
    R = unavailableSince，接线包2待建。
    每次进入写本次提交位置，持续不可用保持。
    SES-13要求active及ready；kernel_turn_open
    还须Kernel head.activeRunId为空。
    已归档退役不能靠SES-14恢复。
  end note
  note right of AnomalyRecorded
    平台在Task及Goal留下谁、做什么、被归档中断、
    已知或可能改动文件；取不到写改动未知。
    改动保留，结果未核对，不算PASS。
    等再派工；别的合适Session新领取带锚点。
    中断不占返工上限；要停任务须另取消。
  end note
  note right of Working
    own 与左栏Task attention分开。
    stopPending是叠加小标记。
    bucket还看副本/Query/正式检查。
    自己状态与最紧急关注原因一起返回。
  end note
  note right of ArchivedRetired
    历史可读。可问copy。
    不允许直接干预。
  end note
```

普通 continuation 的责任交接已由接线包 1 做完：旧线只有该任务时一并归档，退役前任由维护归档；技术失败时可暂有新旧两条负责关系，直到重新领取（决定 47、48）。未知结果的退役线自动维护只报 `busy / archive_unknown_confirmation_required:`，对该 Session 零写；人正式认定后才继续（决定 45）。归档中途失败保留已提交处置，并如实显示。

〔决定 51〕K 片之后：经人认定、Turn 还开着的线，维护关闭悬空 Turn，经 SES-13 回到可用，不归档；认定之前的未知占用仍零写入。

〔决定 54〕Host 重启时暂停着的线（RUN-24）不进“马上归档”：保持退役（`kernel_turn_open`）、不归档，左栏显示“已暂停 · 主机重启时已暂停，可继续”；人点“继续”后 K 片关闭悬空 Turn，回到可用并在原 Session 领取。

〔决定 52，K3 草稿〕之后：认定或重启自动收尾（RUN-25）以后，先按工具种类核对结果未知的调用；有跑程序的先跑只读核对轮。核对记录的状态是 `pending_review → resolved`，或 `pending_review → needs_decision →（你答复落实）→ resolved`；只有 `resolved` 以后才照 K 片接着做。状态图等 K3 冻结后补。

DESIGN §1.5 与 MODEL O09、R03/R54 的“退役不能恢复”概括不能覆盖 active Session 的 SES-13；本图按 DESIGN §4.3 和接线包 2 L10 区分“健康恢复”与“已归档退役线重新启用”。MODEL R05/R06 的立即归档概括也须带上决定 45 的未知占用例外，不用旧概括覆盖现有守卫。

## Request 和秘书归属

依据 §1.1、§2.11；决定 42 · 第 3 条、决定 49。请求读法及秘书换手在第 6 片；processing 是四项或，不存状态。

```mermaid
stateDiagram-v2
  [*] --> Processing: 第一轮 queued
  Processing --> Processing: queued或running / 未答询问 / 待放行 / 候选含stale
  Processing --> Processed: 四项全无 / R19
  Processed --> Processing: 用户接着说 / R21
  Processing --> SuccessorOwned: 旧线停写、创建完成、全部未完请求显式转交 / R32
  SuccessorOwned --> Processing: 回复/到期/追问交接任秘书
  Processing --> Unowned: 手动归档放下 / R05
  Unowned --> Processing: 新输入或回复到达 / 挑秘书 R20
  Processing --> Processing: 只有stale候选也未完 / 重出后继续
  Processing --> Processed: 放弃候选且其余三项全无
  note right of SuccessorOwned
    消息sender仍是原秘书回合。
    归属按查询创建提交顺序，显式转交优先。
    旧轮迟到完成不抢回归属。
    同请求追问忙时排队，换手后找接任者。
  end note
  note right of Processed
    无未完请求、无占用、一天没接新请求才自动归档。
    每项目留最近一条可用秘书；超长交出即归档。
  end note
```

## CandidatePlan

依据 §1.1“候选计划按请求分开”、PLAN-06；决定 42 · 第 3 条、47、48，第 5 片已建。

```mermaid
stateDiagram-v2
  [*] --> Candidate: R24正式候选准入 / Host可写入即过期
  Candidate --> NotAdopted: 同请求新版原子替换
  Candidate --> Accepted: R26正式owner确认
  Candidate --> Stale: 别请求采用改变活动plan / 纯读
  Stale --> Stale: 采用拒 revision_conflict
  Stale --> NotAdopted: R24同请求重出替换
  Candidate --> NotAdopted: R59用户放弃 / reason=abandoned
  Stale --> NotAdopted: R59用户放弃 / reason=abandoned
  Stale --> NewCandidate: R59请求重出；R24写新id
  NewCandidate --> Accepted: 用户采用
  Candidate --> CancelledView: Goal取消 / 只读关闭
  Stale --> CancelledView: Goal取消 / 只读关闭
  note right of Stale
    存储仍candidate。
    不批量写别请求未采用。
    卡仍待答，请求仍未完，直到重出或放弃。
    同请求替换核旧id和版本，原子释放/换占位。
    不属于请求的候选各自独立。
  end note
```

MODEL R59 仍保留“放弃后存成什么未定”的旧说明，与 DESIGN §1.1（决定 42）及 `state/plan-machine.ts:onProposalAbandoned` 不同；本图按后两者画为 `not_adopted / abandoned`，不另造已放弃状态。首方案仍只由用户采用；后续采用走正式 owner 的权限和自治规则，不把成功答复当作已采用（决定 47、48）。

另有尚未对齐的权限表述：DESIGN §2.7、MODEL R26 写 agent 只提议、不采用；代码仍有受委托权限约束的 `apply_future_plan / applyPlanChangeAsAgent`，决定 47、48 的第 5 片收尾还补了其决定出处和重放。本页的自动采用时序沿 DESIGN/MODEL 画用户或 Workflow，不据此改权限或宣称代码已删除该入口。

## DecisionCard

依据 §1.4、§2.6；决定 42、47、48，第 5 片已建。状态名按已建的 `DecisionCardStateV1`；stale 是来源/候选的派生标记，不是独立持久卡状态。

```mermaid
stateDiagram-v2
  [*] --> WaitingAnswer: 七来源派生 / waiting_answer
  WaitingAnswer --> PendingApplication: 用户答复且需落实 / R27
  WaitingAnswer --> NoApplication: 拒绝、延期或无需落实 / answered_no_application
  WaitingAnswer --> WaitingAnswer: 候选stale / 留卡供重出或放弃
  PendingApplication --> PendingApplication: 对象变更成功但补记失败 / 落实未记
  PendingApplication --> PendingApplication: 落实版本冲突或Goal暂停 / 不推进工作
  PendingApplication --> Applied: 正式变更证明匹配 / R29补记
  WaitingAnswer --> Closed: 来源已解决 / source_resolved
  WaitingAnswer --> Closed: Goal取消 / goal_cancelled
  PendingApplication --> Closed: Goal取消 / 只读历史
  NoApplication --> Closed: Goal取消 / 只读历史
  Applied --> Closed: Goal取消 / 只读历史
  note right of PendingApplication
    answered_pending_application。
    不计待答，留待落实；发卡线归档也不丢。
    改正式对象与记落实是两次提交。
  end note
  note right of WaitingAnswer
    主面与Queue同cardKey；只有用户可答。
    选项、自由文字和对象批注一并保存。
    非消息来源答复也生成用户消息。
    Goal暂停仍能答，自动化确认卡不消失。
  end note
  note right of Closed
    已采用、放弃、替换候选保留历史及正式顺序。
    初始化答复后的source_resolved补记在第6片。
  end note
```

七来源的接口已建，`note_review`、`message_release` 分别等第 4、7 片，缺来源明确 `not_available`，不称全部已接。预算耗尽在每步确认下仍给确认卡（决定 48）。队列分待答、待落实、历史和请知悉；历史保留已关闭请求候选，通知每类别只推进到实际展示过的位置（决定 42、47、48）。

第 2 片要把相关决定、未解决来源改成窄索引并完整分页，不按年龄丢待答/待落实（决定 49 · 28）。当前每源 25 页 × 200 条 = 5,000 的防护，及接线包 2 L6/L7 的 50 页 × 100 条/5,000 聚合防护都是临时的：正好满额且无续页可成功，有续页明确 `capacity`，不能假报完整；第 2 片落地须一起撤换。读取失败和部分来源不可用都不能变成完整空队列。

## MessageWait 和消息处置

依据 §2.7、§2.11、§4.6；决定 42、49 · 16、18、19、29，接线包 2 L10–L12。等待/放行消费仍在第 7 片；未送达读源已有，I-5 通知及两个位置待接。release、delivery、response、expiry、application 是不同维度。

```mermaid
stateDiagram-v2
  [*] --> AwaitingRelease: step秘书action/answer
  AwaitingRelease --> NotSent: 用户不放行
  AwaitingRelease --> Open: Goal可工作且放行 / action核三版，answer不核
  AwaitingRelease --> StaleRelease: action放行三版冲突
  AwaitingRelease --> AwaitingRelease: Goal暂停 / 不放行；切auto不放积压
  AwaitingRelease --> NotSent: Goal取消
  [*] --> Open: auto实际发出
  Open --> Open: 用户安全点输入优先 / 原等待默认保留，通知委托方
  Open --> Answered: 同一处理点已有正式reply / R35
  Open --> Expired: 处理点超deadline且无回复、未处理 / R34
  Open --> Withdrawn: 明确撤回
  Open --> CancelledWait: 用户取消等待 / 不冒充自然到期
  Open --> TransferredWait: 用户转等待 / 问题和期限不变
  Answered --> ConsumedReply: 真实inputAccepted / R36
  Expired --> ConsumedExpiry: 真实inputAccepted / R36
  Expired --> LatePreserved: 迟到reply保存
  ConsumedExpiry --> LatePreserved: 迟到reply普通输入
  LatePreserved --> LateInputAccepted: 下个安全点普通输入接受 / 原等待不重开
  Answered --> Undelivered: 原Session不可用且response未消费
  LatePreserved --> Undelivered: 原Session不可用且response未消费
  Undelivered --> Undelivered: 本段不可用重复读、归档或重放 / 位置不变
  Undelivered --> ReplyPending: SES-13恢复 / 移出未送达集合，清R
  ReplyPending --> ConsumedReply: 等待尚未消费且真实inputAccepted / R36
  ReplyPending --> LateInputAccepted: 到期已消费 / 普通输入接受，不再消费原等待
  ReplyPending --> Undelivered: 再次不可用且仍未消费 / 新R再提醒
  Undelivered --> Undelivered: 用户R37转交 / 新消息originalId，原位置不变
  note left of Undelivered
    新消息有新id，原回复与转交历史保留。
    原等待不自动重开/搬走。
    暂停目标先排队，取消目标拒新转交。
  end note
  note right of Expired
    不释放未知占用。
    不可用发信者只留到期事实及通知，不唤醒。
    同问题追问链第二次实际到期才提醒第二次。
  end note
  note right of Undelivered
    包含短暂不可用，不能等归档才提醒。
    R=unavailableSince，P=responseSince。
    位置为max(R,P)，按commit cursor及完整itemKey比较。
    已看不等于消费；恢复退出，再进入算一次新提醒。
  end note
```

确认通信断开后，把原消息、断开原因、时间和接管情况发回相关等待方、发送方及用户；运行中在安全点收，Host 停机则恢复后告知。普通工具失败不自动等于断开或退役（决定 49 · 18）。用户优先输入通知直接委托方、实际链上仍在等的上游及相关秘书、参谋；其他 agent 的行动排队、咨询走只读副本，不并开第二个改文件的 Run（决定 49 · 19）。


### Message.delivery 与直接干预

这是消息的另一维度。依据 §1.6、R39/R40，决定 49 · 19–21；第 7 片待建。等待结束、送达、落实不是同一件事。拒绝原因写在正式 Reply 里。

```mermaid
stateDiagram-v2
  [*] --> Queued: R39 用户或有权agent干预
  Queued --> Held: Goal暂停/取消、待决定、待放行或结果未知
  Held --> Queued: 用户正式继续或认定完成 / 重核版本
  Queued --> Delivered: 用户优先的安全点 / R40真实inputAccepted
  Delivered --> Applied: R29 实际对象版本+证据
  Delivered --> Rejected: R35 正式执行者reject+理由
  Held --> NewMessage: 已取消Goal复制 / R42 新id
  Queued --> NewGoalDraft: 原Goal已完成 / 先确认新Goal
  NewGoalDraft --> NewTask: 用户确认新Goal及首方案
  NewTask --> Delivered: 正常领取和安全点输入
  note right of Delivered
    delivery只证明输入被接受。
    Task satisfied保持原样。
    活跃Goal无未完Task，先采用正式小任务。
    已完成Goal先新建目标，不改旧完成事实。
    等回复时原等待保留，干预不假装成原回复。
  end note
  note right of Held
    取消Goal不能走恢复边；消息不能代替继续或认定。
    归档/退役Session不因收到消息重新启用。
  end note
```

## GoalSettings

依据 §1.2–1.3、§1.6；决定 42、47、48，第 5 片已建；复制及完成后新目标按决定 39、49，等第 6、7 片。这是设置的独立维度和外部状态投影，GoalPhase 仍由原机器拥有。

```mermaid
stateDiagram-v2
  state Settings {
    [*] --> Auto: 默认after_plan_confirmation
    Auto --> Step: 用户CAS改every_step
    Step --> Auto: 用户CAS改自治 / 积压待放行不自动发
    --
    [*] --> Independent: waitForGoalRef为空
    Independent --> WaitPredecessor: 用户选定当时前一个Goal
    WaitPredecessor --> WaitSatisfied: 前目标COMPLETED或cancelled / 读时解锁
    WaitPredecessor --> Independent: 用户明确清等待
    WaitPredecessor --> WaitPredecessor: 重排不改等待对象
    --
    [*] --> NoConflictHint
    NoConflictHint --> ConflictHint: 足迹有交集 / 只作建议
    ConflictHint --> RiskAccepted: 接受风险 / 目标对及两边计划版本
    RiskAccepted --> RiskAccepted: 仅调顺序 / 风险仍有效
    RiskAccepted --> ConflictHint: 任一换plan且仍交集
    ConflictHint --> ConflictHint: 卡内重排 / 仅顺序不消除交集
    ConflictHint --> NoConflictHint: 交集消失或正式来源解决
  }
  Settings --> PausedView: 外部Goal paused
  PausedView --> Settings: 用户正式继续 / 既有设置保留，动作重核
  Settings --> CancelledView: 外部Goal cancelled
  PausedView --> CancelledView: 用户取消
  Settings --> CompletedView: 外部GoalPhase COMPLETED
  CancelledView --> NewGoalDraft: 重新入队 / R41 新id
  CompletedView --> NewGoalDraft: 新工作 / 决定49第21项
  NewGoalDraft --> NewGoalNoPlan: 用户确认目标卡
  NewGoalNoPlan --> NewGoalWithPlan: 用户采用首方案
  note right of WaitPredecessor
    等待只挡新修改工作：claim、enter、continue_work、
    小任务及dispatch_action；旧运行、只读、出方案不停。
    前目标结束只是读时解锁，不自动清存下的waitFor。
  end note
  note right of RiskAccepted
    风险保存在选择时排后的Goal，重排不搬走。
    标签从同目标对及两版计划派生。
    冲突卡可等前一个、卡内重排或接受风险。
  end note
```

改设置只由用户按 Goal 版本提交；取消目标拒改，等待不成环。顺序只影响以后争同一成员，冲突不是领取门槛。文件先归所属模块再和计划模块比较；第 5 片执行文件来源尚为 `not_available`，不能把“没查到”写成无冲突。自治 owner 已建，装配器展示自治等接线 I-4（决定 47、48；接线包 2）。

I-4 把当前自治显示进新准备的上下文，不改接线包 1 的 G 内容摘要，也不因自治变更重装已绑定输入；实际动作仍由第 5 片 owner 当场检查（接线包 2 §0.3）。

## Note 与 CurrentUnderstanding

依据 §3.3–3.7、O34–36；决定 49 · 04–06、Q8、Q9。第 4 片待建，语义修补的检查/目录生效在第 8 片；现有异常锚点不冒充 Note。

```mermaid
stateDiagram-v2
  [*] --> Validated: 校验格式、锚点、来源、关系和长度 / R43
  Validated --> LocalAccepted: 普通合法且额度足够
  Validated --> Staged: repair绑定Run
  Validated --> HumanPending: 结构/矛盾先用户审，超额度一并注明
  Validated --> ScribePending: 普通注记额度满 / 书记整理
  LocalAccepted --> ProjectReviewed: 书记审 / R44
  HumanPending --> ScribePending: 用户批准普通注记但额度满
  HumanPending --> LocalAccepted: 用户批准普通注记且额度足够
  HumanPending --> Staged: 用户批准修补 / 额度整理后仍等正式检查
  ScribePending --> LocalAccepted: 明确合并/取代，额度核实后写
  Staged --> LocalAccepted: 适用PASS及目录同次生效 / 所需审批齐全
  Staged --> InvalidView: Task取消/替代 / 读时算
  LocalAccepted --> ReviewNeededView: 文件/定义变化 / R46
  ProjectReviewed --> ReviewNeededView: 文件/定义变化
  LocalAccepted --> Superseded: 显式取代
  ProjectReviewed --> Superseded: 新项生效同次取代 / 不重新审为拒绝
  ProjectReviewed --> Withdrawn: R45
  HumanPending --> Rejected: 用户拒绝
  LocalAccepted --> Withdrawn: R45
  note right of Validated
    结论最多200 Unicode码点，无更窄字节限制。
    正文3072、理解6144 UTF-8字节；超限留草稿。
    主锚点1、附加最多4；事实16、依据文件32分别计。
    每锚点收下5条、目标/阶段各1理解、每目标活动200条：
    条数是待实测初值；超额度交书记，不静默删除。
  end note
  note right of ReviewNeededView
    存储状态不改。
    来源不可用另一个标志。
    未核对、未决矛盾、来源不可用不当有效。
    本目标用收下项；跨目标只参考书记已审项。
  end note
```

注记关系沿 O34 的 `anchor/extraAnchors`、`facts`、`replaces`、`contradicts` 严格定型；取代和矛盾只允许指向至少共用一个主或附加锚点的注记。反查先合并按锚点索引的候选、去重再核字段；“谁负责、谁参与”仍读任务图和 SessionWorkLink。A 可无损推出关系视图，B（独立关系记录）只作实测不足后的升级路径；必要时先加可重建反查索引，本次不另加关系记录或邻接索引（决定 49 · Q8）。

全文提前到第 4 片，作为附录 C 第 15 个索引：RecordStore 窄端口，内存子串扫描，SQLite FTS5、中文 2 字片段；不加标签、时间/版本、关系邻接这三类索引。agent 仍只用“看”“找”各自的记忆分支，工具确定性读取、不调用模型（决定 49 · Q1、Q2、Q9）。

当前理解读已提交版本及状态，不等写者；撤下或拒绝后当前可用值留空，保留历史引用，不回退旧理解。新理解、旧项取代及指针 CAS 同次提交（决定 49 · 05）。

```mermaid
stateDiagram-v2
  [*] --> NoCurrent
  NoCurrent --> CurrentV1: R43新理解及指针CAS@0同次提交
  CurrentV1 --> CurrentV2: R43 CAS@1 / 两写者竞写
  CurrentV1 --> CurrentV1: 别人仍在写 / 立即读已提交版及状态
  CurrentV2 --> CurrentV2: 旧CAS@1拒绝，留草稿、重读合并
  CurrentV2 --> UpdateDueView: 后来任务结束/返工/采用/归档/重组
  CurrentV2 --> CurrentUnavailable: 当前条撤下或被拒 / 留历史引用
  UpdateDueView --> CurrentUnavailable: 当前条撤下或被拒
  CurrentUnavailable --> CurrentUnavailable: 当前可用值为空 / 不回退旧条、不等写者
  CurrentUnavailable --> CurrentV3: 新理解及指针CAS成功 / 才有新当前
  UpdateDueView --> CurrentV3: 正式写入新版 / 不另存该更新标志
  note right of CurrentV3
    每轮装配记实际读到的版本与状态。
    已绑定输入不后台替换，后续读取可见新版。
  end note
```

## 十二个组合时序及接线包 2 I-5

### 1. 两个秘书读相同三版后派工（S06；决定 49 · 16、22，第 7 片）

```mermaid
sequenceDiagram
  participant S1 as 秘书1
  participant S2 as 秘书2
  participant A as 参谋
  participant C as communication
  participant R as RecordStore
  Note over S1,A: 优先并行文件、模块不重叠的任务；重叠先请参谋定contract
  Note over S1,R: 所有有权派工者都核版本；首次无理解可显式pin=null，不等理解
  S1->>C: action plan1/current1/seq0
  C->>R: 同次核三版、写消息、seq加一
  R-->>S1: 已发 seq1
  S2->>C: action plan1/current1/seq0
  C-->>S2: revision_conflict / 不发
  S2->>C: 重读后 action plan1/current1/seq1
  C->>R: 再核三版，同次写消息、seq2
  R-->>S2: 已发 seq2
  Note over C,R: 只查plan/current/seq，不作语义校验；真冲突靠正式检查和返工
  Note over S1,A: 缺成员时秘书、书记请参谋；参谋或有明确委托权的执行者可创建
  Note over A,R: 每步确认先批准；固定工人、秘书、书记、独立审阅轮无创建权
```

### 2. step待放行遇别人的派工（S06；R18；决定 42 · 第 11 条、49 · 16）

```mermaid
sequenceDiagram
  participant S as 秘书
  participant M as 消息owner
  participant U as 用户
  participant E as 收件成员
  S->>M: 请动手 pins1/1/0，存awaiting、不增seq
  M-->>U: 待放行卡
  Note over M,E: 收件者尚不可见
  Note over M: 别的派工已增seq到1
  Note over M: 改auto不自动放积压；Goal暂停也不放行
  U->>M: 放行
  M-->>U: 已过期 / 重出或不发
  Note over E: 无新消息、不动手
  Note over M,E: 真正发出才起算期限；请回答放行不核派工三版
```

### 3. 请回答未回时秘书换手（S07；决定 49 · 05、10、27，第 6 片）

```mermaid
sequenceDiagram
  participant S1 as 旧秘书
  participant N as notes
  participant RT as Runtime
  participant S3 as 接任秘书
  participant M as 邮箱
  S1->>N: 写全部相关目标/阶段理解 CAS
  S1->>RT: 太长，压缩不支持或失败 / 申请换手
  RT->>RT: 确认旧线停写；列全未完请求、候选、待放行及等待
  RT->>S3: 建handoff来历的新Session
  RT->>RT: 创建completed后在既有查询记录显式转交全部请求
  RT-->>S1: 归档；两档均发请知悉及接任链接
  M->>RT: SM回复到达，root=Q1
  RT->>RT: deriveRequest按显式转交找S3，原sender不改
  RT->>S3: 新QueryRound root=Q1 + reply
  S3-->>RT: 回答记在原请求下面
  Note over S1,S3: 旧轮迟到完成不抢归属；原消息答复/撤回由接任处理，落实仍实际执行方记
```

### 4. 退役线放下任务，迟到回复手动转交（S02、S11、S66；决定 42、43、45、49 · 18、29）

```mermaid
sequenceDiagram
  participant W as Workflow
  participant S as 退役Session
  participant G as WorkGraph
  participant U as 用户
  participant B as 用户指定的接收Session
  alt 结果未知仍占用
    W->>G: 自动维护只读核对
    G-->>W: busy / archive_unknown_confirmation_required，Session零写
    U->>G: 正式认定已停下
  end
  W->>G: 未完Work写Task/Goal异常锚点，改动保留且未核对
  W->>G: 结束终结关系；未完任务drop
  W->>G: archive S
  G-->>S: 已归档·已退役，等待留原处
  G-->>U: 断开原因、时间、原消息及接管情况；通知相关等待方
  G->>G: 迟到reply首次保存，同提交绑定P
  G-->>U: I-5按max(R,P)出未送达提醒
  U->>G: 转交到B
  G->>B: 新消息 originalId=旧消息
  Note over S,B: 不自动把原等待当已消费
  Note over W,B: 放下任务按正常派工由别的合适Session新领取，带锚点；不强制新建或continuation
```

### 5. 别请求采用使候选过期（S08；决定 42 · 第 3 条、47、48）

```mermaid
sequenceDiagram
  participant Q1 as 请求1
  participant Q2 as 请求2
  participant P as 计划owner
  participant U as 用户
  Q1->>P: C1 basedOn1
  Q2->>P: C2 basedOn1
  U->>P: 采用C1
  P-->>U: 正式plan2
  Q2->>P: 读C2
  P-->>Q2: 派生stale，存candidate
  U->>P: 采用C2
  P-->>U: revision_conflict / 重出或放弃
  Note over Q2,P: Q2仍在处理；不批量改它的candidate存储
  alt 用户放弃
    U->>P: 放弃C2，带当前版本
    P-->>U: not_adopted / abandoned，历史保留
  else 请求重出
    U->>Q2: 按plan2重出
    Q2->>P: 写C3，CAS替换C2
    Note over Q2,P: 可引用已采用任务；依赖未采用方案则等先采用或合成一个方案
  end
```

### 6. 已答复、变更成功、补记失败（S10；决定 42 · 第 7 条、47、48）

```mermaid
sequenceDiagram
  participant U as 用户
  participant M as 消息owner
  participant P as 对象owner
  U->>M: 接受D，附自由文字及对象批注
  M-->>U: 已答复、待落实，不计待答
  Note over U,P: 若Goal暂停，先存答复；用户正式继续后重核版本才改工作
  U->>P: 带D授权与对象pin变更
  P-->>U: 新正式版本2
  U->>M: 补记对象@2
  alt 第二次提交失败
    M-->>U: 待落实栏保留，显示落实未记
    U->>M: 重试补记同样出处
  end
  M-->>U: 已落实 对象@2
  U->>M: 同请求再试，期间自治或来源已变化
  M-->>U: 先重放原回执，不重做对象变更
  Note over M,P: 初始化缺架构/完成标准答复的来源已解决补记移第6片，当前仍待落实
  Note over M,P: 按答复改目标/验收的完整计划变更也在第6片，不把本时序当已全部接通
```

### 7. 到期后消费，迟到回复（S11；决定 49 · 17–19，第 7 片）

```mermaid
sequenceDiagram
  participant H as 现有驱动
  participant M as 消息owner
  participant RT as Runtime
  participant A as 原发信者
  participant U as 用户
  U->>RT: 等回复期间的新输入
  RT->>A: 安全点优先接用户输入，原等待默认保留
  RT-->>H: 通知直接委托方、仍在等的上游及相关秘书/参谋
  H->>M: 同根已排队输入合批去重，检查到期
  alt 同一处理点已有回复
    M-->>RT: 交回复，不按到期处理
  else 超期限且未答、未处理
    M-->>RT: 到期没答复
    RT->>A: 原Task/可用Session新Run输入
    A-->>RT: 真实inputAccepted
    RT->>M: consumed expiry
    M->>RT: 后来reply保存
    RT->>A: 下安全点普通输入
  end
  Note over RT,A: 不重开原等待、不再领取一次接续
  Note over H,M: 重扫不重复到期；同问题追问链第二次实际到期才发第二次通知
```

### 8. 取消目标复制，勾选干预（S12；决定 39、49 · 13、20，第 6、7 片）

```mermaid
sequenceDiagram
  participant U as 用户
  participant G as 目标owner
  participant S as 秘书
  participant M as 消息owner
  U->>G: cancelled G 重新入队
  G-->>U: 新目标卡，干预默认不带
  U->>G: 确认N，勾I不勾J
  G->>G: 新id，复制目标/验收/范围/自治，放原活跃顺序位置
  G->>M: 此时撤回未勾J，勾选I仍待首方案
  Note over G: waitFor和已接受风险不复制；放弃创建草稿不改旧消息
  G->>S: 原计划/已做事实 + 原理解链接
  S-->>U: 新首方案
  U->>G: 采用N首方案
  G-->>M: 发勾选I的新消息，旧I标已转交
  M-->>U: I已转交 / 新消息引用原id
  Note over G: G仍cancelled；N不同id
```

### 9. 当前理解竞写与复查（S09、S74；决定 49 · 05、06、Q8，第 4 片）

```mermaid
sequenceDiagram
  participant A as 写者A
  participant B as 写者B
  participant N as notes
  participant R as 读者/装配器
  R->>N: A仍在写，读取当前理解
  N-->>R: 已提交版及来源/新鲜度，不等待A
  A->>N: 理解N1 currentVersion1
  N-->>A: pointer2
  B->>N: 理解N2 currentVersion1
  N-->>B: revision_conflict / 留草稿、提示谁刚写过
  B->>N: 读N1，合并后currentVersion2
  N-->>B: pointer3
  Note over N: 计划/文件变后派生需复查，不改保存文字
  B->>N: 撤下自己写的当前条
  R->>N: 再读
  N-->>R: 当前不可用，保留历史引用，不回退旧已审条
  B->>N: 校验长度/额度/共享锚点关系，提交新理解及指针CAS
  R->>N: 后续再读
  N-->>R: 后续读见新已提交版；已绑定Run输入不后台替换
```

### 10. 已做完线接受干预（S13；决定 38、49 · 21，第 7 片）

```mermaid
sequenceDiagram
  participant U as 用户
  participant M as 邮箱
  participant WF as Workflow
  participant P as 目标/计划owner
  participant A as 已做完执行者
  U->>M: 直接干预A
  alt 原Goal已完成
    WF-->>U: 起草新目标，原完成事实不改
    U->>P: 确认新Goal
    WF->>P: 在新Goal建小任务及首方案
    P-->>U: 首方案两档都待用户采用
    U->>P: 采用新Goal首方案
  else 原Goal仍活跃且无未完任务
    WF->>P: 提正式小任务
    alt step
      P-->>U: 待确认
      U->>P: 确认采用
    else auto
      WF->>P: 范围内自动采用
    end
  end
  WF->>A: 正常新Task领取执行
  Note over P,A: 原satisfied Task不修改
```

### 11. 上游未完成但产物已可用（S15；第 3 片已建，决定 47 接线包 1）

```mermaid
sequenceDiagram
  participant RT as Runtime准备
  participant T as tasks
  participant M as materials
  participant A as 下游agent
  RT->>T: 下游已采用requirement
  T->>T: 对已有产物事实定版本
  T->>M: 核声明后的历史说明读取
  M-->>T: 固定产物@2
  T-->>RT: selected input@2 + 来源
  RT->>RT: 准备任务/义务/输入与提醒，绑定实际来源
  RT->>T: 消费时检查精确输入及实际展示的Goal内容摘要
  alt Goal说明或精确输入变化
    T-->>RT: 拒绝旧装配，重新准备
  else 实际上下文仍适用，含仅不相关计划采纳
    T-->>RT: 不因Goal总版本变化拦住已准备任务
    RT->>A: 正式进入，交已核实的上下文
  end
  Note over T,A: 不等上游整个Task satisfied
  Note over RT,A: 异常锚点提醒已接；自治展示、待答卡索引分别等I-4、I-6，不新增提醒准入守卫
```

### 12. K中断关闭与K2轮间压缩（S20、S21；决定 39、49 · 25、27；接线包 2 L10）

```mermaid
sequenceDiagram
  participant WF as Workflow
  participant RT as Runtime
  participant K as Kernel补丁
  participant S as Session owner
  WF->>RT: active且kernel_turn_open，平台Run已结束，无实际活动执行
  RT->>K: K关闭悬空Turn
  alt 关闭成功
    K-->>RT: interrupted终态 / 活动Run清掉
    RT->>S: 正式健康ready观察，head.activeRunId为空
    S->>S: SES-13恢复available，清unavailableSince
    S-->>WF: 原Session可开新Run，非恢复旧Run
  else 无能力或关闭失败
    RT-->>WF: 另建continuation退路
  end
  Note over RT,K: 半截调用留原历史、未完成Turn不进模型输入；接续说明补足，不重跑副作用工具
  Note over WF,S: 不复活补丁前已归档退役线；未知执行先正式核对
  Note over WF,K: K与K2均待建；K2两阶段已定，仍不算MVP门槛
  WF->>RT: 空闲两轮间达到压缩条件 / 与换手条件分开配置
  RT->>K: 先压缩；运行中请求明确未执行
  K->>K: 旧工具结果换桩，保最近3轮
  Note over RT,K: 调用和结果成对，桩保执行/输出版本及原文入口
  alt 桩还太长
    RT->>K: 再写摘要，核必需内容、大小及来源
    Note over RT,K: 留目标验收、用户原话/决定、未完请求/等待/待放行、尝试和来源
    Note over RT,K: 摘要超限或缺必需段落失败；坏链接标来源不可用
  end
  alt 压缩成功
    K-->>WF: 原Session / 原历史保留 / 已压缩说明
    Note over RT,K: 记忆只留固定引用，不复活撤下项；计划及派工版本重读
  else 不支持或压缩失败
    RT-->>WF: 明确原因，按另配换手条件及原审批规则处理
  end
```

### 13. 回复后不可用、已看、恢复、再进入（接线 I-5；决定 49 · 29；L10–L12，待建）

```mermaid
sequenceDiagram
  participant M as 消息owner
  participant S as Session owner
  participant R as RecordStore
  participant V as 未送达读源/Queue
  participant U as 用户
  participant W as 工作区设置owner
  M->>R: 原work_run发信消息首次保存reply，同提交绑定responseSince=P
  Note over S,V: 原Session active且available，reply未消费，此时不在未送达集合
  S->>R: 正式观察或Work/Query释放进入unavailable，同提交绑定unavailableSince=R1
  U->>V: 读请知悉
  V->>R: 同窗分页，先核消息归属/Goal，再核R1及P
  R-->>V: health=unavailable，未消费reply，两个持久位置
  V-->>U: 一次新提醒，position=max(R1,P)，本例取R1
  Note over V,U: key由完整messageRef+responseRef构造；短暂不可用也提醒
  U->>W: 展示后用displayToken标已看至该类别位置
  W->>R: 保存类别已见位置，不消费reply、不转交
  U->>V: 同一段不可用再次读取
  V-->>U: 位置未变，已看项不再列出
  S->>R: active且ready按SES-13恢复；若曾Turn悬空须head无activeRun
  R-->>S: available，同次移除unavailableSince
  U->>V: 再读未送达
  V-->>U: 原health过滤使该项退出集合，原回复保留
  Note over M,S: 本例恢复期间reply仍未被inputAccepted；若已消费则不会再入集合
  S->>R: 再次进入unavailable，同提交写新的R2
  U->>V: 再读请知悉
  V-->>U: 同key，max(R2,P)晚于已看位置，一次新提醒
  Note over R,V: 先不可用后回复则取P；同段重复/归档/转交/重放保持位置
  Note over R,V: 范围内旧数据缺R或P明确incomplete；不拿时间、本次水位或revision凑位置
```

位置统一由 `compareNoticePositions` 按提交序及完整 itemKey 比较；恢复清除 R，再进入写新 R，不跨次去重。目录分页满足 `atLeastCursor`，`source_stale` 或水位变化丢弃半窗后重读，最多四次；读源零写，不自动转交、不把已看当已消费（接线包 2 L10/L11）。
