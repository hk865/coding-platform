# 对象与行为模型

> **lead 的说明（2026-10-08，放进仓库时加）。** 这是 Codex 第 1 步的产出，除下面 8 处外原样保留（怎么来的见 [README](README.md)）。
> - 行号：`L…` 和 `DESIGN:…` 都指 ddce07be 上的 DESIGN.md（1481 行）。之后在 DESIGN §8.2 表前加了 1 行指针，所以在今天的文件里，第 1080 行起的行号要加 1。
> - 歧义编号：这里写到 AMB-40。合并以后是 74 项，编号和内容以 [AMBIGUITIES.md](AMBIGUITIES.md) 为准（AMB-1–40 改写过 27 项）。
> - `S01`–`S80`：Codex 第 1 步的场景。原文件没进仓库；每个场景的给定和动作，在 [readers/R6/R6.md](readers/R6/R6.md) 对应的块里重写了一遍，合并后在 [SCENARIOS.md](SCENARIOS.md) 里按“来源：Snn/R6-nn”找。
> - 文中提到的“任务书”，是给 DSH 写可执行模型的任务书。决定 41 修订以后不写可执行模型，那份任务书也没进仓库。
> - lead 改的 8 处，都标了“〔lead 改〕”：R05、R08、R16 是 lead 抽查时发现的；R19、R21、R58、R59 是 Codex 合并时指出的；“行为总约定”里一句话指向没进仓库的任务书。

此文件是分析模型，不是生产实现、接口冻结或提议批准。基线 HEAD：`facbb61fd791361c943caaddcd1c3cd559be5842`。来源行号按本次读取的 DESIGN（1481 行）。优先第 1、3、5 片，再第 6、7 片。

对象 54，规则 59，场景 80，歧义 40，选项值 80。对象数包括 3 个选项专用对象 O51–O53 和 1 个外部回执对象 O54。它们不是承诺新增四种生产记录。其余 50 个包括记录、外部快照、派生值和有名字的值类型。字段里的小元组不另计对象。

权威顺序：HANDOFF 决定 20–41（最新 37–40）→ 已定产品行为/冻结原型 → DESIGN 正文 → 历史 QUESTIONS、D-PLACEMENT。决定 41 授权做模型，不批准 §9.1 的提议。§9.2 的技术提议没有 §9.1 编号，保留原标签，不能编造编号。

“推断”表示本分析补的表示或技术顺序，仍需 lead 冻结。ids 与代码中的 ref 对齐只是表示约定。未确定的用户行为都用 AMB 参数，默认第一值只用于隔离测试，不是建议、批准或产品默认。

## 既有机器只作为外部事实

Run、Task、Round、GoalPhase 只给本模型读取快照，或接收本模型输出的正式 owner 请求。模型不实现它们的转移/完成算法。既有邮箱的 pending/read/responded 和 acceptedInputs 是外部事实；新 release、expiry、application 不覆盖原语。既有 Session 的 lifecycle/health/occupancy 维度保留。

源码抽查：`src/contracts/core/session.ts`、`src/core/work-graph/model/session-contracts.ts`、`model/communication-contracts.ts`、`src/contracts/core/session-message.ts`、`state/{session-availability,goal,plan,message}-machine.ts`。PLAN-06：候选 stale 是派生，采用拒 revision_conflict。SES-14 当前仅改归档，不验 Kernel；第1片按决定38新增守卫。MSG-01/02 当前禁止发送 pin；三版派工是新提议，不能说已经支持。

Goal 控制是薄外部调用。`pause/cancel/resume` 都须恰好 Goal 和 GoalPhase 两个 pin，Phase不存在填0。pause/cancel比较两版；resume只比较Goal但仍携带Phase（决定29；E3 5.5-1）。cancelled恢复拒invalid。这不是新增机器规则。

## 类型约定

```typescript
type Role = 'secretary'|'adviser'|'scribe'|'executor'|'reviewer'|'copy';
type Json = null|boolean|number|string|Json[]|{[key:string]:Json};
```

Role里的copy是只读副本的分析标签，不是新增产品职责。模块长期线仍用executor职责。所有时间是分析用UTC毫秒整数。version/sequence是非负整数，持久新记录version=1，缺记录pin=0。Scope内id唯一。正文内嵌只为内存模型方便，不取代生产 body store。固定版本引用、布尔观察结果与可信身份都由适配器给，不由agent自报。

## 对象

### O01 Scope

类型：value。片：1。依据：DESIGN §2.1 / L337–351。状态：已定（决定 20）。

标识：projectId/workspaceId。

```typescript
type Scope = { projectId: string; workspaceId: string };
```

写入者与时机：Host 登记后只读。

不变量：跨项目和工作区的引用不能成为动作授权。

### O02 Ref

类型：value。片：3。依据：DESIGN §3.1 / L529–534。状态：已定（决定 23）。

标识：scope/kind/id/version。

```typescript
type Ref = { scope: Scope; kind: 'session'|'task'|'goal'|'stage'|'module'|'interface'|'file'|'project'|'plan'|'round'|'run'|'query'|'message'|'note'|'catalog'|'history'; id: string; version: number };
```

写入者与时机：正式 owner 产生。引用者只复制。

不变量：version 指固定版本。0 只表示尚无记录，不表示任意版本。

### O03 Source

类型：value。片：3。依据：DESIGN §3.3 / L561–563；§5.1 / L892。状态：已定（决定 23）。

标识：ref/path/digest/range。

```typescript
type Source = { ref: Ref; path: string|null; digest: string|null; range: [number,number]|null; readable: boolean };
```

写入者与时机：Runtime 从可信事实补齐。

不变量：事实与理解分开。readable=false 时保留引用。

### O04 Actor

类型：value。片：5。依据：DESIGN §1.4 / L169–184；§2.11 / L504。状态：已定（决定 37 / Q14）。

标识：可信 principal + sessionId/runId/queryId。

```typescript
type Actor = { kind: 'user'|'workflow'|'runtime'|'host'|'secretary'|'adviser'|'scribe'|'executor'|'reviewer'|'copy'; sessionId: string|null; runId: string|null; queryId: string|null; trusted: boolean };
```

写入者与时机：Host/Runtime 根据保存的身份构造。

不变量：模型 JSON 不能自报可信 Session、Run 或秘书回合。

### O05 Provenance

类型：value。片：1。依据：DESIGN §4.2 / L670–675。状态：提议 §9.2（形状）；已定（Q3）。

标识：所属 Session id。

```typescript
type Provenance = { kind: 'new'|'continuation'|'handoff'|'copy'; from: string|null; reason: 'interrupted'|'archived'|'damaged'|'role_mismatch'|null; messageId: string|null };
```

写入者与时机：sessions 在创建时写一次。

不变量：continuation 同线；handoff 新线；copy 不成线。以后不改。

### O06 ProjectSettings

类型：record。片：7。依据：DESIGN §1.9 / L314–317；§9.3 / L1205–1218。状态：已定（Q20）；提议 §9.1 #15、#19。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type ProjectSettings = { id: string; scope: Scope; version: number; replyMs: number; longTokens: number; archiveMs: number; autoCap: number; pageSize: number; lineLimit: number; contextBytes: number; noteReadFiles: number; compactKeep: number; wakeLimit: number };
```

写入者与时机：Host 设置入口。

不变量：数字可配。分析默认值是 1800000、500000、86400000、3、100、32、4096、256、3、16。不是实测值。

### O07 WorkspaceSettings

类型：record。片：5。依据：DESIGN §1.4 / L189；附录 C / L1392–1396。状态：提议 §9.1 #10；已定（决定 25）。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type WorkspaceSettings = { id: string; scope: Scope; version: number; noticeCursor: number; pinnedHeads: string[] };
```

写入者与时机：用户查看通知、置顶时写。

不变量：游标不是消息已答复或已落实。置顶不是成员身份。

### O08 SessionOperation

类型：external。片：1。依据：DESIGN §4.1 / L651；E3 G4-2。状态：已定（决定 35 / Q22；既有事实）。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type SessionOperation = { id: string; scope: Scope; version: number; plannedSessionId: string; phase: 'accepted'|'running'|'completed'|'failed'|'unknown'; origin: Provenance; role: Role; kernelId: string|null };
```

写入者与时机：Runtime 既有两阶段创建入口。模型仅观察。

不变量：completed 前 plannedSessionId 不是可派工 Session。

### O09 Session

类型：record。片：1。依据：DESIGN §4.2；§4.5 / L664–679、732–758。状态：已定（决定 38）；提议 §9.2（新字段）。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type Session = { id: string; scope: Scope; version: number; role: Role; lifecycle: 'active'|'archived'; health: 'available'|'recoverable'|'unavailable'; healthReason: 'missing'|'damaged'|'kernel_turn_open'|null; occupancy: string|null; origin: Provenance|null; createdAt: number; archivedAt: number|null; lastActiveAt: number; historyEnd: number|null; kernelId: string|null };
```

写入者与时机：sessions 保存来历、健康、归档；Runtime 提交已观察事实。

不变量：归档和退役是两个维度。来历 null 是旧数据问题 AMB-1。退役不能重新启用。

### O10 Responsibility

类型：record。片：1。依据：DESIGN §1.8 / L301–303；§4.4 / L722。状态：已定（Q1；推出 2）；提议 §9.2。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type Responsibility = { id: string; scope: Scope; version: number; sessionId: string; target: Ref; since: number; until: number|null };
```

写入者与时机：sessions 按 Workflow 的处置提交。

不变量：同次转移关闭旧关系、打开新关系。任务终结后结束关系，不删除事实。

### O11 RunFact

类型：external。片：1。依据：DESIGN §4.2 / L671–672；规格 §6。状态：已定（决定 20；既有事实）。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type RunFact = { id: string; scope: Scope; version: number; taskId: string; goalId: string; sessionId: string; status: 'starting'|'running'|'ended'; outcome: 'success'|'failed'|'cancelled'|'interrupted'|'yielded'|'unknown'|null; waitingMessageId: string|null; waitConsumed: 'response'|'expiry'|null; desired: 'running'|'paused'|'cancelled'; stopPending: boolean; startedAt: number|null; endedAt: number|null; changedFiles: string[]; filesIncomplete: boolean; activity: Activity[]; usage: Usage[] };
```

写入者与时机：既有 Run owner；Runtime 在结束时补采足迹、计数和用量。

不变量：只读既有机器。Run 结束不等于 Task 满足。等待到期不能释放未知占用。

### O12 TaskFact

类型：external。片：1。依据：DESIGN §2.4 / L372；§1.10 / L327；规格 §4。状态：已定（决定 11、26；既有事实）。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type TaskFact = { id: string; scope: Scope; version: number; goalId: string; planVersion: number; moduleId: string|null; stageId: string|null; disposition: 'active'|'deferred'|'cancelled'|'superseded'; phase: 'pending'|'ready'|'running'|'verifying'|'satisfied'|'failed'|'blocked'; cause: string|null; required: boolean; runIds: string[]; dependencies: InputRequirement[]; endedAt: number|null };
```

写入者与时机：既有 Task/Plan owner。模型不重新实现其迁移。

不变量：依赖不是领取条件。satisfied 定义不被直接干预重开。

### O13 RoundFact

类型：external。片：3。依据：DESIGN §2.8–2.9 / L455、478；规格 §9。状态：已定（既有事实）；提议 §9.2。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type RoundFact = { id: string; scope: Scope; version: number; taskId: string; runId: string; phase: 'incomplete'|'running'|'interrupted'|'completed'; outcome: 'PASS'|'FAIL'|'INCONCLUSIVE'|null; applicable: boolean; source: Source; checkIds: string[]; startedAt: number };
```

写入者与时机：既有 verification owner。

不变量：PASS 仅是对应版本的证据。模型不归约 Task/Goal 完成。

### O14 GoalPhaseFact

类型：external。片：5。依据：DESIGN E3 5.5-1；HANDOFF 决定 29；规格 §2。状态：已定（决定 29；既有事实）。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type GoalPhaseFact = { id: string; scope: Scope; version: number; goalId: string; planVersion: number; phase: 'RUNNING'|'NEEDS_DECISION'|'COMPLETED'; causes: string[] };
```

写入者与时机：既有 GoalPhase owner。

不变量：Goal 控制须带 Goal 与 GoalPhase 两个版本。没有记录用 0。恢复带但不比较 Phase 版本。

### O15 Goal

类型：record。片：5。依据：DESIGN §1.2–1.3；§1.6 / L124–159、276–282。状态：已定（决定 39）；提议 §9.1 #22。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type Goal = { id: string; scope: Scope; version: number; desired: 'active'|'paused'|'cancelled'; title: string; acceptance: string; range: string; activePlanVersion: number; settings: GoalSettings; copiedFrom: string|null; createdAt: number };
```

写入者与时机：目标 owner；用户确认、目标设置和新目标复制时写。

不变量：cancelled 终态。copiedFrom 指已取消旧目标。复制不改旧目标历史。

### O16 GoalSettings

类型：value。片：5。依据：DESIGN §1.2–1.3 / L129–154。状态：已定（决定 15 / Q13）；提议 §9.1 #11。

标识：所属 Goal id。

```typescript
type GoalSettings = { autonomy: 'step'|'auto'; order: number; waitFor: string|null; risks: RiskAcceptance[] };
```

写入者与时机：用户通过目标设置写入 Goal。

不变量：auto 默认。冲突提示本身不设置 waitFor。waitFor 只阻止新工作，不停正在做的。

### O17 RiskAcceptance

类型：value。片：5。依据：DESIGN §1.2 / L131。状态：提议 §9.1 #11。

标识：目标对与两计划版本。

```typescript
type RiskAcceptance = { otherGoalId: string; selfPlanVersion: number; otherPlanVersion: number };
```

写入者与时机：用户接受风险时写入后目标设置。

不变量：仅绑定该目标对和两版计划。任一换版且仍有交集，重新提示。

### O18 PlanFact

类型：external。片：5。依据：DESIGN §1.1 / L121；§2.3 / L357–358；规格 PLAN-06。状态：已定（既有事实）；提议 §9.2。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type PlanFact = { id: string; scope: Scope; version: number; goalId: string; moduleIds: string[]; taskIds: string[]; decisionMessageIds: string[]; adoptedAt: number };
```

写入者与时机：正式计划 owner。模型只接受 adoptionOk 的外部确认。

不变量：不把候选、消息、记忆当作活动计划。

### O19 QueryRound

类型：record。片：6。依据：DESIGN §1.1 / L82–94；§2.11 / L501–508。状态：提议 §9.1 #15、#24。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type QueryRound = { id: string; scope: Scope; version: number; rootId: string; goalId: string|null; sessionId: string; kind: 'request'|'followup'|'reply'|'expiry'|'explain'; status: 'queued'|'running'|'ended'|'unknown'; input: string; answer: string|null; ideas: string[]; selectedIdea: number|null; relatedMessageId: string|null; createdAt: number; usage: Usage[] };
```

写入者与时机：queries/Runtime 提交轮次和正式回答。

不变量：rootId 指第一轮。秘书不领取 Task。发请回答后结束这一轮，不让出 Work Run。

### O20 Request

类型：derived。片：6。依据：DESIGN §1.1 / L82–94。状态：提议 §9.1 #24。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type Request = { id: string; scope: Scope; goalId: string|null; roundIds: string[]; currentSecretaryId: string|null; processing: boolean; reasons: ('round'|'reply'|'release'|'candidate')[] };
```

写入者与时机：views 每次读时算。

不变量：id=第一轮 id。processing 恰好是四类未结事项的或。没有另存 Request 表。

### O21 Candidate

类型：record。片：5。依据：DESIGN §1.1 / L116–121；§6 / L1005。状态：提议 §9.1 #23。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type Candidate = { id: string; scope: Scope; version: number; goalId: string; requestId: string|null; basedOn: number; status: 'candidate'|'accepted'|'not_adopted'; draftText: string; diff: string; author: Actor; priorId: string|null; createdAt: number };
```

写入者与时机：计划 owner 保存；秘书提议迭代；用户/Workflow 正式采用。

不变量：只替换同 requestId 的上一版。别人换计划只派生 stale，不写 not_adopted。

### O22 CandidateView

类型：derived。片：5。依据：DESIGN §1.1 / L119–121；规格 PLAN-06。状态：提议 §9.1 #23；已定（既有 stale）。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type CandidateView = { id: string; stored: Candidate; status: 'candidate'|'stale'|'accepted'|'not_adopted'; staleReason: string|null; actions: ('adopt'|'regenerate'|'abandon')[] };
```

写入者与时机：views/计划读取按活动计划算。

不变量：stale 采用回 revision_conflict。每请求最多一张当前候选卡。

### O23 DispatchCounter

类型：record。片：7。依据：DESIGN §2.11 / L510–519。状态：提议 §9.1 #25。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type DispatchCounter = { id: string; scope: Scope; goalId: string; version: number; sequence: number; lastMessageId: string|null; lastActor: Actor|null };
```

写入者与时机：communication 在发出请动手的同一提交里加一。

不变量：只批准不发消息时不增加。请回答不核对三个版本。

### O24 Message

类型：record。片：5。依据：DESIGN §1.4；§2.7；§4.6 / L176–197、436、764–776。状态：已定（决定 37 / Q20）；提议 §9.1 #7、#13、#20、#25。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type Message = { id: string; scope: Scope; version: number; goalId: string|null; sender: Actor; recipient: 'user'|string; intent: 'action'|'answer'|'notice'|'decision'; taskId: string|null; body: string; needsReply: boolean; waitAfterSend: boolean; deadline: number|null; createdAt: number; release: 'released'|'awaiting'|'denied'; delivery: 'queued'|'delivered'|'undelivered'; response: Reply|null; expiredAt: number|null; transferredTo: string|null; withdrawnAt: number|null; appliedAt: number|null; rejectedAt: number|null; application: Application|null; requestId: string|null; originalId: string|null; followupOf: string|null; options: string[]; objects: Ref[]; pins: {plan:number;understanding:number;dispatch:number}|null; consumed: {executionId:string;kind:'response'|'expiry'}[] };
```

写入者与时机：communication。身份由存下的 Run/Query 核对。用户答复/放行。Runtime 以已观察输入确认送达。

不变量：pending/read/responded 是旧邮箱外部状态；新 release、delivery、expiry、落实彼此独立。读取不 ack。

### O25 Reply

类型：value。片：5。依据：DESIGN §1.4 / L185–187；§2.6 / L421–424。状态：已定（Q14；推出 8）；提议 §9.2。

标识：所属 Message id。

```typescript
type Reply = { actor: Actor; text: string; option: string|null; answeredAt: number; source: Source|null };
```

写入者与时机：通信回复入口。决定只有用户能答。

不变量：拒绝、延期也是答复；不用后续落实。

### O26 Application

类型：value。片：5。依据：DESIGN §2.6 / L423–426。状态：已定（推出 8）；提议 §9.1 #9。

标识：所属 Message id。

```typescript
type Application = { objects: Ref[]; actor: Actor; appliedAt: number; evidence: Source[] };
```

写入者与时机：实际改动者补记；用户接口顺带记。

不变量：对象已变拒绝落实。改对象与补记是两次提交，不能声称跨层原子。

### O27 WaitView

类型：derived。片：7。依据：DESIGN §4.2；§4.6 / L671、764–774。状态：已定（Q20）；提议 §9.1 #7、#24。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type WaitView = { id: string; messageId: string; runId: string|null; requestId: string|null; ownerSessionId: string|null; state: 'open'|'answered'|'expired'|'consumed'|'withdrawn'; undelivered: boolean; expiryCount: number };
```

写入者与时机：views 读消息、让出 Run 和当前请求归属。

不变量：没有等待表。秘书等待按请求算，不占其查询 Session。到期不释放占用。

### O28 Card

类型：derived。片：5。依据：DESIGN §1.4 / L176–188；§2.6。状态：已定（决定 37 / Q14）；提议 §9.1 #9、#13。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type Card = { id: string; scope: Scope; goalId: string|null; source: 'message'|'goal_cause'|'candidate'|'note'|'planning'|'conflict'|'release'; sourceId: string; level: 'decision'|'notice'; state: 'open'|'answered'|'applied'|'stale'|'dismissed'; answered: boolean; applied: boolean; objects: Ref[]; senderLine: string|null; actions: string[] };
```

写入者与时机：views 拼七种来源。

不变量：主对话与队列是同 id。不是独立决定库。关卡和已落实不是同一个字段。

### O29 Queue

类型：derived。片：5。依据：DESIGN §1.4；§6 / L966、978–981。状态：提议 §9.1 #10、#13；已定（决定 15）。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type Queue = { id: string; scope: Scope; decision: Card[]; notice: Card[]; cursor: string|null; watermark: number; counts: {decision:number;notice:number} };
```

写入者与时机：views 按索引分页。

不变量：读队列不调用模型。不把通知当行动授权。

### O30 MainSurface

类型：derived。片：6。依据：DESIGN §1.1；§1.4 / L67–78、167–174。状态：已定（决定 37）；提议 §9.1 #15、#21。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type MainSurface = { id: string; scope: Scope; selectedGoalId: string|null; requests: Request[]; answers: {roundId:string;requestId:string;text:string}[]; cards: Card[]; groupedNotices: {goalId:string;messageIds:string[]}[] };
```

写入者与时机：views 按目标读。

不变量：面不是 Session，不占用一个秘书，不产生自己的线。

### O31 Line

类型：derived。片：1。依据：DESIGN §1.5；§4.9 / L201–210、797–804。状态：已定（决定 25 / Q3）；提议 §9.2。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type Line = { id: string; scope: Scope; headId: string; sessionIds: string[]; copyIds: string[]; handoffFrom: string|null; omitted: number; name: string; role: Role; status: LineStatus; taskIds: string[]; moduleIds: string[] };
```

写入者与时机：views 沿 continuation 算。

不变量：id 是线头 Session 引用，不存稳定成员编号。handoff 新线；copy 画在原线。

### O32 LineStatus

类型：derived。片：2。依据：DESIGN §1.5 / L213–246；§4.8。状态：已定（决定 38 / Q4；冻结原型）；提议 §9.2。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type LineStatus = { id: string; own: 'working'|'waiting'|'idle'|'paused'|'unknown'|'starting'|'done'|'retired'|'archived'; label: string; stopPending: boolean; archivedTag: 'done'|'retired'|null; bucket: 'working'|'standby'|'archived'; readOnly: boolean; undelivered: number; controls: string[] };
```

写入者与时机：views 读真实可用性、执行、任务和副本。

不变量：已做完可干预；已退役不可跑。副本回答会使原线计数 working，但不证明原 Session 工作中。

### O33 LineCounts

类型：derived。片：2。依据：DESIGN §1.5 / L242–246；§4.9 / L803。状态：已定（决定 30、38）。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type LineCounts = { id: string; working: number; standby: number; archived: number };
```

写入者与时机：存储计数/投影读取。

不变量：三桶互斥；standby 的计数含暂停、失败、等待、已做完。

### O34 Note

类型：record。片：4。依据：DESIGN §3.3–3.7 / L555–631。状态：已定（决定 20、23 / Q7）；提议 §9.2。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type Note = { id: string; scope: Scope; version: number; anchor: Anchor; extraAnchors: Anchor[]; kind: 'note'|'understanding'|'repair'; topic: string; conclusion: string; body: string; facts: Source[]; basis: {plan:number;catalog:number;files:{path:string;digest:string}[]}; source: Actor; goalId: string|null; runId: string|null; state: 'staged'|'accepted'|'reviewed'|'pending_review'|'rejected'|'superseded'|'withdrawn'; structural: boolean; contradicts: string[]; replaces: string[]; createdAt: number };
```

写入者与时机：notes 唯一写入口；agent 顺手写；书记审；用户编辑撤下。

不变量：记忆不改状态，不授权。已撤下保留历史。锚点不包括线或永久成员。

### O35 CurrentPointer

类型：record。片：4。依据：DESIGN §3.3 / L571；§3.6 / L618。状态：提议 §9.1 #25。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type CurrentPointer = { id: string; scope: Scope; version: number; anchor: Anchor; noteId: string|null };
```

写入者与时机：notes 在新理解写入的同次提交 CAS。

不变量：每锚点一个 current。先写胜；后写重读合并，不能静默覆盖。

### O36 NoteView

类型：derived。片：4。依据：DESIGN §3.3、3.5、3.7 / L566–570、591、628–631。状态：已定（决定 23；推出 7）；提议 §9.2。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type NoteView = { id: string; stored: Note; usable: boolean; reviewNeeded: boolean; sourceUnavailable: boolean; invalid: boolean; updateDue: boolean; changedFiles: string[]; uncheckedFiles: number; visibleInGoal: boolean; unconfirmed: boolean };
```

写入者与时机：notes 算过时/作废/该更新；views 算跨层来源可读性。

不变量：未核对不是有效。需复查不是撤下。来源不可用不删除正文。

### O37 Anchor

类型：value。片：4。依据：DESIGN §3.4 / L578–587。状态：已定（决定 23 / Q9）；提议 §9.2。

标识：kind/id。

```typescript
type Anchor = { kind: 'module'|'interface'|'file'|'goal'|'stage'|'task'|'project'; id: string };
```

写入者与时机：平台由节点位置补齐。

不变量：理解仅挂 goal/stage；一般注记可挂七类节点。

### O38 InputRequirement

类型：value。片：3。依据：DESIGN §2.8 / L450–461。状态：已定（决定 11）；提议 §9.2。

标识：消费 Task id + 依赖序号。

```typescript
type InputRequirement = { fromTaskId: string; kind: 'artifact'|'output'|'decision'|'environment'|'check'; label: string; legacyVersion: number|null };
```

写入者与时机：采用计划里的依赖声明；旧 inputRequirements 映射。

不变量：规划不预测产物版本；不作为领取门。

### O39 SelectedInput

类型：value。片：3。依据：DESIGN §2.8 / L454–465。状态：提议 §9.2。

标识：消费调用 id + 声明 + observedAt。

```typescript
type SelectedInput = { requirement: InputRequirement; state: 'selected'|'missing'|'ambiguous'; source: Source|null; candidates: Source[]; usage: 'historical'|'current'; observedAt: number };
```

写入者与时机：tasks 核对声明后，准备/看产出时记本次版本。

不变量：跨 Run 读取只能沿受信路径。没好仍允许启动并提醒。

### O40 Assembly

类型：derived。片：3。依据：DESIGN §5.1–5.2 / L882–906。状态：提议 §9.2；已定（决定 34）。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type Assembly = { id: string; scope: Scope; callKind: 'work'|'continuation'|'handoff'|'review'|'secretary'|'copy'|'planning'|'attention'; sections: {name:string;text:string}[]; text: string; sources: Source[]; selectedInputs: SelectedInput[]; noteVersions: Ref[]; bytes: number; bound: boolean };
```

写入者与时机：Runtime 一次装配并绑定。

不变量：同样事实得到同样字节。接续段最后。已绑定不重拼。

### O41 NodeCard

类型：derived。片：3。依据：DESIGN §5.3 / L932；§1.10 / L325–326。状态：已定（决定 22、26 / Q6）。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type NodeCard = { id: string; scope: Scope; node: Ref; name: string; path: string|null; summary: string; children: Ref[]; neighbours: Ref[]; sources: Source[]; notes: NoteView[]; historyRefs: Source[]; inputStatus: SelectedInput[] };
```

写入者与时机：views/Runtime 的看工具。

不变量：先注记和理解，再原历史，最后咨询。分页读取不启模型。

### O42 SearchPage

类型：derived。片：3。依据：DESIGN §5.3 / L933；推出 3。状态：已定（决定 22；推出 3）。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type SearchPage = { id: string; scope: Scope; needle: string; items: Ref[]; cursor: string|null };
```

写入者与时机：views 找名字、路径、一句话语义。

不变量：只做包含匹配，无检索排序，不搜注记全文。

### O43 Footprint

类型：derived。片：5。依据：DESIGN §1.2 / L132–135。状态：提议 §9.1 #11。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type Footprint = { id: string; goalId: string; planVersion: number; moduleIds: string[]; files: string[]; incomplete: boolean };
```

写入者与时机：Workflow 读计划模块与实际改过文件。

不变量：未开始只能按模块比。没有交集不证明安全。

### O44 WakeSet

类型：derived。片：7。依据：DESIGN §2.10 / L486–490；§4.6 / L773。状态：已定（推出 1）；提议 §9.2。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type WakeSet = { id: string; scope: Scope; waits: {goalId:string;recordKinds:string[]}[]; pendingGoalIds: string[]; limit: number };
```

写入者与时机：Host 内存登记；启动核对从事实重建。

不变量：不存第二调度库。通知不带内容。不新增常驻循环。

### O45 KernelFact

类型：external。片：K。依据：DESIGN §4.3 / L683–710；§5.3 / L923–924。状态：已定（决定 7）；提议 §9.1 #1、#18。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type KernelFact = { id: string; sessionId: string; adapterId: string; historyReadable: boolean; openTurn: boolean; platformRunEnded: boolean; halfTool: boolean; closeSupported: boolean; closeSucceeded: boolean; sandboxAvailable: boolean; workspaceUnchanged: boolean };
```

写入者与时机：Kernel/Runtime 已观察结果输入。模型不跑 Kernel 或命令。

不变量：K 关闭不是原 Turn 恢复。无沙箱不退宿主 shell。

### O46 Compaction

类型：external。片：K2。依据：DESIGN §4.11 / L835–862。状态：提议 §9.1 #19；边界已定（决定 39）。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type Compaction = { id: string; sessionId: string; version: number; fromPosition: number; keepRounds: number; stubs: {tool:string;argsSummary:string;size:number;source:Source}[]; summary: {goals:string;decisions:string;unresolved:string;attempts:string;sources:Source[];userQuotes:string[]}|null; originalReadable: boolean; committedAt: number };
```

写入者与时机：K2 Kernel 新压缩记录；平台仅读。

不变量：Session 不变。工具对成对保留。原历史不删。K2 不算 MVP 门槛。

### O47 Timeline

类型：derived。片：2。依据：DESIGN §1.10 / L328；§6 / L991。状态：已定（Q5 A）。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type Timeline = { id: string; taskId: string; points: {at:number;kind:'run_start'|'run_end'|'check_start'|'requeue'|'adopt';source:Ref}[]; approximate: true };
```

写入者与时机：views 从已有时点算。

不变量：不伪造等待/受阻精确时间。

### O48 Activity

类型：value。片：2。依据：DESIGN §1.10 / L329；附录 C #15。状态：已定（Q5 B）；提议 §9.2（旧数据）。

标识：Run id/hour。

```typescript
type Activity = { hour: number; steps: number; edits: number; checks: number; complete: boolean };
```

写入者与时机：Runtime 结束时采集，查询只聚合。

不变量：缺旧计数不能填零装作实际没有活动。

### O49 Usage

类型：value。片：2。依据：DESIGN §4.11 / L830、850；附录 C #17。状态：提议 §9.2。

标识：Run 或 Query id/模型请求序号。

```typescript
type Usage = { at: number; inputTokens: number; outputTokens: number; cachedTokens: number };
```

写入者与时机：Runtime 从实际模型响应取。

不变量：longTokens 用最近一次 inputTokens，不用累计历史字节。

### O50 ToolGrant

类型：derived。片：3。依据：DESIGN §2.7；§4.10；§5.3 / L431–437、808–814、928–950。状态：已定（决定 37）；提议 §9.2。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type ToolGrant = { id: string; role: Role; autonomy: 'step'|'auto'; tools: string[]; canWriteWorkspace: boolean; canClaimTask: boolean; canApplyPlan: boolean; readOnlyCommand: 'available'|'unsupported' };
```

写入者与时机：Host/Runtime 按职责和自治授予。writer 再核权。

不变量：副本不能记。秘书不能领取、改代码、改目标、采用。秘书记自己的理解是提议。

### O51 RequestRoute

类型：option-only。片：6。依据：DESIGN §1.1 L89–93；§4.4 L721。状态：推断（AMB-17 技术分支，未定）。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type RequestRoute = { id:string; requestId:string; from:string; to:string; at:number; kind:'routing_round'|'handoff_marker' };
```

写入者与时机：只有 AMB-17 对应分支写。

不变量：这是分析用路由表示，不宣称设计已决定新增记录。

### O52 AnswerReceipt

类型：option-only。片：5。依据：DESIGN §1.4 L182、186。状态：推断（AMB-12 技术分支，未定）。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type AnswerReceipt = { id:string; scope:Scope; sourceKind:string; sourceId:string; reply:Reply; answeredAt:number };
```

写入者与时机：源对象 owner 在 owner_receipt 分支写。

不变量：附在来源对象的正式回执上，不是另一决定库。

### O53 CloneChoice

类型：option-only。片：6。依据：DESIGN §1.6 L282。状态：推断（AMB-30 时序分支，未定）。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type CloneChoice = { id:string; sourceGoalId:string; newGoalId:string; selectedMessageIds:string[]; confirmedAt:number };
```

写入者与时机：模型模拟用户确认到首计划采用之间的选择。

不变量：只表达分阶段操作材料；生产持久载体未定，不自动转消息。

### O54 DispatchReceipt

类型：external。片：7。依据：DESIGN §2.11 L513；既有邮箱重放 MSG-01/02。状态：已定（既有回执）；推断（AMB-22 新规则先后）。

标识：id；派生值只在这次读取里确定，不额外持久化。

```typescript
type DispatchReceipt = { id:string; messageId:string; fingerprint:string };
```

写入者与时机：可信记录存储回执。

不变量：同内容重放是否先于新版本检查由 AMB-22 选。不能重复增序号。

## 行为总约定

触发只消费明确动作或正式事实变化。成功返回新状态与效果说明，不改输入对象。只读规则返回原状态。外部动作是请求，不假造 Kernel 或完成结果。所有写入口核可信身份、scope和相应版本。缺对象拒not_found；不合法输入拒invalid；越权拒forbidden；版本不同拒revision_conflict；占用未妥拒busy；无能力拒unsupported/unavailable；无证据拒incomplete。拒绝不留下新消息、候选或序号，归档staged partial例外见AMB-3。

这些错误名沿既有CoreError风格；新行为映射与具体detail文字是**推断**，不是已冻结HTTP协议。本文的case输出和任务书相同（〔lead 改〕这份任务书是给 DSH 写可执行模型的，没进仓库）。agent语义选择是显式输入，不让纯函数猜自然语言。

### R01 createSession

依据：DESIGN §4.1、4.2 L651、670。状态：提议 §9.2；已定（Q3）。片：1。

触发：收到 `createSession` 动作或该规则对应的正式观察。执行者：Runtime。

读取：O08、O09、O05。写入：O09。

输入：

```typescript
{operationId:string}
```

前置、效果与拒绝：completed 才创建 v1。accepted/running 仅返回创建处理中。failed/unknown 拒 unavailable。重复完成不再建第二个 Session。

拒绝码：`invalid, unavailable`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S04。

### R02 deriveLine

依据：DESIGN §4.9 L797–804。状态：提议 §9.2；已定（Q3）。片：1。

触发：收到 `deriveLine` 动作或该规则对应的正式观察。执行者：views。

读取：O09、O05。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{sessionId:string;legacyFrom?:string}
```

前置、效果与拒绝：查不到拒 not_found。遇来历环拒 invalid。continuation 追前任；handoff 停；copy 只附在原线。超 lineLimit 计 omitted。AMB-1、2决定旧来历与分支。

拒绝码：`invalid, not_found`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S41。

### R03 createContinuation

依据：DESIGN §4.3 L685–710。状态：已定（决定 7、8）；提议 §9.1 #1。片：1。

触发：收到 `createContinuation` 动作或该规则对应的正式观察。执行者：Workflow/Runtime。

读取：O09、O11、O45、O10。写入：O09、O10。

输入：

```typescript
{from:string;to:string;reason:'interrupted'|'archived'|'damaged'|'role_mismatch';taskId:string;kEnabled:boolean;creationCompleted:boolean}
```

前置、效果与拒绝：旧 Turn 有终态且原 Session 可用，发 continue_run。K 关成功也在原 Session 新 Run。K 无能力、读不到、跨适配器或失败，建 continuation 并转本任务责任。旧历史保留。不能恢复原 Run。退路creationCompleted是可信完成观察；false只提创建，不能登记Session或转责任。

拒绝码：`busy, invalid, unavailable`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S20、S42。

### R04 finishResponsibilities

依据：DESIGN §1.8 L301；§4.5 L735。状态：已定（推出 2）。片：1。

触发：收到 `finishResponsibilities` 动作或该规则对应的正式观察。执行者：Workflow。

读取：O10、O12。写入：O10。

输入：

```typescript
{sessionId:string}
```

前置、效果与拒绝：只结束 target 为 satisfied、cancelled、superseded Task 的开放关系，until=now，version+1。不把 Run success 当满足。

拒绝码：`not_found`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S05。

### R05 archiveLine

依据：DESIGN §4.5 L734–758。状态：已定（Q1、决定 38）；提议 §9.1 #3、#20、#24。片：1。

触发：收到 `archiveLine` 动作或该规则对应的正式观察。执行者：用户/Workflow。

读取：O09、O10、O11、O12、O19、O24、O35。写入：O09、O10、O19、O24、O51。

输入：

```typescript
{sessionId:string;disposal:'give'|'drop'|null;to:string|null;waitDisposal:'cancel'|'transfer'|null;interleavedVersion?:number;manual:boolean}
```

前置、效果与拒绝：终结责任先清。未完责任没有 give/drop 拒 invalid。普通等待没有 cancel/transfer 拒 busy。无接续退役直接放下并归档；秘书按请求处置（〔lead 改〕秘书这一支要第 6 片的请求读法，第 1 片只做执行者和退役线）。最终 Session CAS。部分完成、活执行、理解前后置按 AMB-3–6；等待转走按 AMB-27。

拒绝码：`busy, invalid, revision_conflict`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S02、S10、S43、S44、S45、S46、S57。

### R06 autoArchive

依据：DESIGN §4.5 L742–751。状态：已定（决定 38）；提议 §9.2。片：1。

触发：收到 `autoArchive` 动作或该规则对应的正式观察。执行者：Workflow。

读取：O09、O10、O12、O27。写入：O09、O10。

输入：

```typescript
{sessionId:string}
```

前置、效果与拒绝：退役且无接续，在下次 Workflow 事件立刻归档。执行者须无未完责任、无等待、无占用且最后任务结束满 archiveMs。否则 no_op。不创建定时器。

拒绝码：`busy`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S05。

### R07 reactivate

依据：DESIGN §1.8 L308–309；SES-14。状态：已定（决定 38）；提议 §9.2（新守卫）。片：1。

触发：收到 `reactivate` 动作或该规则对应的正式观察。执行者：用户。

读取：O09、O45。写入：O09。

输入：

```typescript
{sessionId:string;capable:boolean}
```

前置、效果与拒绝：active 不是重新启用对象，拒 invalid。已归档退役拒 unavailable。其他先核实际 capable；不可用只提另建接任，不假启用。

拒绝码：`forbidden, unavailable, invalid`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S02。

### R08 pickExecutor

依据：DESIGN §2.4 L372、376；J1。状态：已定（决定 11 / Q19）；提议 §9.2。片：1（排除和依赖软排序）；按含义排序是第 7 片（〔lead 改〕原文只写“片：1”，§2.4 L376 写“排除：1；排序：7”）。

触发：收到 `pickExecutor` 动作或该规则对应的正式观察。执行者：Workflow。

读取：O09、O10、O12、O27、O16。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{goalId:string;taskId:string;candidateIds:string[]}
```

前置、效果与拒绝：排除 archived、非available、occupied、copy 和 Work等待。按任务关联、模块关联、同目标历史、职责、最近活动、id排。依赖仅软排序，没有完成前置守卫。无成员只发创建建议。

拒绝码：`not_found`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S03。

### R09 askCopy

依据：DESIGN §1.6 L264–267；§4.7 L780–786。状态：已定（Q2、决定 38）；提议 §9.1 #20。片：1。

触发：收到 `askCopy` 动作或该规则对应的正式观察。执行者：用户。

读取：O09、O45、O24。写入：O09、O24。

输入：

```typescript
{sourceId:string;copyId:string;messageId:string;text:string;followupOf:string|null;creationCompleted:boolean}
```

前置、效果与拒绝：creationCompleted=false只提派生，不写Session/消息。true才一问新建一个copy。historyEnd 用最新已完成边界。追问必须有上一问答。读不到历史，historyEnd=null，披露 missing_history。原 Session 不变。

拒绝码：`invalid, not_found`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S01。

### R10 finishCopy

依据：DESIGN §4.7 L782–783。状态：已定（Q2）；提议 §9.2。片：1。

触发：收到 `finishCopy` 动作或该规则对应的正式观察。执行者：Workflow。

读取：O09、O19。写入：O09。

输入：

```typescript
{copyId:string}
```

前置、效果与拒绝：只允许 copy；有实际结束回答且无占用时归档。未答/仍占用拒 busy。不动原线。

拒绝码：`busy, invalid`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S01。

### R11 deriveLineStatus

依据：DESIGN §1.5 L213–246；§4.8。状态：已定（决定 38 / Q4；冻结原型）；提议 §9.2。片：2。

触发：收到 `deriveLineStatus` 动作或该规则对应的正式观察。执行者：views。

读取：O09、O11、O12、O19、O27。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{sessionId:string;attention:string|null}
```

前置、效果与拒绝：归档优先；再退役、未知、启动、运行、等待、暂停、做完、待命。stopPending 独立标记。非运行时 Task attention 是左栏词，own 仍给详情。计数看执行/检查/查询/副本活动。此顺序是标明的技术推断。

拒绝码：`not_found`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S13。

### R12 writeGoalSettings

依据：DESIGN §1.2–1.3 L129–158。状态：已定（Q13、决定 15）；提议 §9.1 #11。片：5。

触发：收到 `writeGoalSettings` 动作或该规则对应的正式观察。执行者：用户。

读取：O15、O16、O17。写入：O15。

输入：

```typescript
{goalId:string;autonomy:'step'|'auto';order:number;waitFor:string|null}
```

前置、效果与拒绝：仅用户，版本须匹配；取消目标拒 invalid。改设置不停止旧 Run。等待、重排、积压待放行按 AMB-7、10、24。

拒绝码：`forbidden, invalid, revision_conflict`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S64。

### R13 startAllowed

依据：DESIGN §1.2 L129–130；规格 I-9。状态：已定（Q13；既有 Goal 停止）。片：5。

触发：收到 `startAllowed` 动作或该规则对应的正式观察。执行者：Workflow。

读取：O15、O14、O16。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{goalId:string;action:'claim'|'dispatch'|'continuation'|'small_task'|'query';predecessorCompleted:boolean;predecessorTerminal:boolean}
```

前置、效果与拒绝：暂停/取消不允许工作动作，允许只读查询。waitFor 未解锁时，动作边界按 AMB-7、8。只返回 allowed，不写 Run。

拒绝码：`not_found`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S47、S48。

### R14 deriveConflict

依据：DESIGN §1.2 L131–135。状态：提议 §9.1 #11；已定（决定 17；冻结原型）。片：5。

触发：收到 `deriveConflict` 动作或该规则对应的正式观察。执行者：Workflow。

读取：O15、O18、O11、O43。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{first:string;second:string;fileModule:{[path:string]:string}}
```

前置、效果与拒绝：按当前 Plan 模块和全部已跑 Run changedFiles 并集。交集且没有对应 risk 才给平等三选项卡。无交集只写未发现，不证明安全。跨类型按 AMB-9，卡/风险身份按 AMB-10。

拒绝码：`not_found`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S49、S50。

### R15 acceptRisk

依据：DESIGN §1.2 L131；§1.4 L182。状态：提议 §9.1 #11；已定（冻结原型）。片：5。

触发：收到 `acceptRisk` 动作或该规则对应的正式观察。执行者：用户。

读取：O15、O18。写入：O15。

输入：

```typescript
{goalId:string;otherGoalId:string;selfPlan:number;otherPlan:number}
```

前置、效果与拒绝：仅用户；两活动计划版本都匹配才记 risk。冲突拒 revision_conflict。同目标对同两版重复无变化。

拒绝码：`forbidden, revision_conflict`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S08。

### R16 gateAction

依据：DESIGN §1.3 L141–154；§2.7。状态：已定（决定 37 / Q12、Q21）；提议 §9.1 #8、#12、#16。片：5。

触发：收到 `gateAction` 动作或该规则对应的正式观察。执行者：Workflow/工具。

读取：O15、O50。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{goalId:string;action:GateAction;attempt:number}
```

前置、效果与拒绝：按动作表返回 user_only、decision、auto、auto_notice。初方案/目标确认/用户话两档都用户。结构/目标范围/预算/长期换手两档都decision。〔lead 改〕秘书因为太长换手，两档都 auto_notice；短期线换手，step 下 decision、auto 下 auto_notice；细化、自动返工、重新检查、agent 返工、小修补、秘书的请动手和请回答、干预的小任务，step 下 decision、auto 下 auto（原文“短秘书超长换手两档auto_notice”把短期线换手也读成两档 auto_notice，和 DESIGN L152 不符）。达到autoCap仍decision。

拒绝码：`invalid`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S23、S24、S25、S26、S27、S28、S29、S30、S31、S32、S33、S34、S35、S36、S37、S38、S39、S40。

### R17 sendMessage

依据：DESIGN §1.4 L169–183；§2.11 L503–505。状态：已定（决定 37）；提议 §9.1 #13、#25。片：5。

触发：收到 `sendMessage` 动作或该规则对应的正式观察。执行者：受信发送者。

读取：O04、O09、O19、O15、O23、O35。写入：O24、O23、O54。

输入：

```typescript
{message:Message;dispatchObserved?:{plan:number;understanding:number;dispatch:number};isReplay?:boolean}
```

前置、效果与拒绝：先核可信 sender 与保存的Query/Run及scope。decision只给秘书/参谋/书记，user收件，2–4选项；copy不能发。秘书action/answer在step存awaiting，收件不可见。action发出原子核plan/current/dispatch并加sequence。answer不核三版。旧pin失败不写消息。重放AMB-22，其他派工AMB-23。

拒绝码：`forbidden, invalid, revision_conflict, idempotency_conflict`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S06、S62、S63。

### R18 releaseMessage

依据：DESIGN §2.7 L436；§2.11 L516。状态：已定（决定 37）；提议 §9.1 #25。片：7。

触发：收到 `releaseMessage` 动作或该规则对应的正式观察。执行者：用户。

读取：O24、O15、O23、O35。写入：O24、O23。

输入：

```typescript
{messageId:string;allow:boolean}
```

前置、效果与拒绝：只允许用户处理awaiting。allow=false写denied，不发。allow=true此时核action三版，失败卡stale，不增序号。answer不核三版。目标停下不送。期限AMB-24。

拒绝码：`forbidden, invalid, revision_conflict`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S06。

### R19 deriveRequest

依据：DESIGN §1.1 L82–94。状态：提议 §9.1 #24。片：6。

触发：收到 `deriveRequest` 动作或该规则对应的正式观察。执行者：views。

读取：O19、O09、O24、O21。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{requestId:string}
```

前置、效果与拒绝：按root查轮次。最近按createdAt、id（〔lead 改〕这个次序是技术推断，正文没定，见 AMB-19），沿handoff找接任。processing是round、reply、release、candidate四项或。已归档无接任返回重选需求。stale候选是否未结AMB-32。手动转已有Session按AMB-17。

拒绝码：`not_found`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S07、S72。

### R20 pickSecretary

依据：DESIGN §1.1 L73–90。状态：已定（决定 37）；提议 §9.1 #15、#24。片：6。

触发：收到 `pickSecretary` 动作或该规则对应的正式观察。执行者：Workflow。

读取：O09、O19、O49、O06。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{goalId:string|null;requestId:string|null}
```

前置、效果与拒绝：同请求优先当前owner，忙也排队。新请求先同目标空闲短、再其他目标空闲短、再建。归档/退役/副本/有排队运行轮排除，未回请回答本身不占用。并列/无用量AMB-16。

拒绝码：`not_found`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S56。

### R21 submitRequestRound

依据：DESIGN §1.1 L69、77–94；§2.11 L506。状态：提议 §9.1 #15、#21、#24。片：6。

触发：收到 `submitRequestRound` 动作或该规则对应的正式观察。执行者：用户/Host。

读取：O19、O09、O20。写入：O19。

输入：

```typescript
{round:QueryRound;eventIds:string[];sameSafePoint:boolean}
```

前置、效果与拒绝：root轮rootId=id；后续轮保原root和goal。回复/到期交当前owner。稳定eventId重放无变化（〔lead 改〕重放键是技术推断，不是 DESIGN L506 定下的规则），同点合并AMB-20。只排队，不伪造Kernel开始。

拒绝码：`invalid, not_found`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S60。

### R22 answerRound

依据：DESIGN §1.1 L111–114；§2.11 L506。状态：已定（Q16）；提议 §9.1 #15。片：6。

触发：收到 `answerRound` 动作或该规则对应的正式观察。执行者：Runtime。

读取：O19、O09。写入：O19。

输入：

```typescript
{roundId:string;answer:string;ideas:string[]}
```

前置、效果与拒绝：Runtime提交正式回答结束轮，ideas为空或2–3个。只释放匹配Query占用。不改Task完成。

拒绝码：`invalid, forbidden`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S07。

### R23 selectIdea

依据：DESIGN §1.1 L111–114。状态：已定（Q16）。片：6。

触发：收到 `selectIdea` 动作或该规则对应的正式观察。执行者：用户。

读取：O19。写入：O19。

输入：

```typescript
{roundId:string;index:number}
```

前置、效果与拒绝：只用户，index在ideas内。记选择并提同root计划轮。不直接采用。

拒绝码：`invalid, forbidden`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S07。

### R24 writeCandidate

依据：DESIGN §1.1 L118–120。状态：提议 §9.1 #23。片：5。

触发：收到 `writeCandidate` 动作或该规则对应的正式观察。执行者：秘书/规划器/agent。

读取：O21、O19、O15。写入：O21。

输入：

```typescript
{candidate:Candidate;previousId:string|null;previousVersion:number}
```

前置、效果与拒绝：原候选owner准入是外部前提，不重做PLAN-01–03。Host候选可写入即过期，不能通用加basedOn必须当前的守卫。秘书候选须指真实匹配root。已有同请求候选须带准确previousId/version，同次旧未采用、新v1。竞写第二个拒conflict。不属于请求的候选保持独立。

拒绝码：`invalid, revision_conflict`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S08。

### R25 deriveCandidate

依据：DESIGN §1.1 L121；PLAN-06。状态：提议 §9.1 #23；已定（既有 stale）。片：5。

触发：收到 `deriveCandidate` 动作或该规则对应的正式观察。执行者：views。

读取：O21、O15。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{candidateId:string}
```

前置、效果与拒绝：terminal沿存储返回。存candidate且basedOn不同派生stale。给regenerate/abandon，不写记录。

拒绝码：`not_found`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S08。

### R26 adoptCandidate

依据：DESIGN §1.1 L113、119–121；§2.7 L435。状态：已定（Q16、决定 15）；提议 §9.1 #23。片：5。

触发：收到 `adoptCandidate` 动作或该规则对应的正式观察。执行者：用户/Workflow。

读取：O21、O15、O18。写入：O21、O15、O18。

输入：

```typescript
{candidateId:string;newPlanId:string;newPlanVersion:number;adoptionOk:boolean;first:boolean}
```

前置、效果与拒绝：先核候选/Goal版和basedOn。first只用户，agent不能采用；Workflow只auto范围内future-refine。adoptionOk是正式owner外部事实；false拒incomplete。成功导入新Plan/指针/候选状态，同request替换，其他只派生stale。无request的候选不批量互斥。

拒绝码：`forbidden, incomplete, invalid, revision_conflict`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S08。

### R27 answerDecision

依据：DESIGN §1.4 L184–188；§2.6 L421–426。状态：已定（Q14、决定 37）；提议 §9.1 #9、#13。片：5。

触发：收到 `answerDecision` 动作或该规则对应的正式观察。执行者：用户。

读取：O24、O28、O15。写入：O24、O52。

输入：

```typescript
{messageId:string|null;sourceKind:string;sourceId:string;option:string;replyId:string}
```

前置、效果与拒绝：只用户，有效选项与消息版。reject/defer关闭，不需落实；accept已答复。两个入口同cardId。不在本动作改计划。非消息答复AMB-12，答复可见AMB-11，取消卡AMB-28。

拒绝码：`forbidden, invalid, revision_conflict`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S10、S52。

### R28 applyDecision

依据：DESIGN §2.3 L357–359；§2.6 L423–426。状态：提议 §9.2；已定（MVP B09）。片：6。

触发：收到 `applyDecision` 动作或该规则对应的正式观察。执行者：用户/提问者。

读取：O24、O15、O18。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{messageId:string;objectVersions:{[id:string]:number};change:'future'|'traced';externalApplied:boolean}
```

前置、效果与拒绝：必须接受答复与对象版本匹配。拒绝/延期no_op。未来变更发正式计划变更请求，带decisionRef。有痕影响AMB-13。此步不写application。

拒绝码：`invalid, revision_conflict, unsupported`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S10、S53。

### R29 ackApplication

依据：DESIGN §2.6 L424–426；§6 L980。状态：提议 §9.1 #9；已定（推出 8）。片：5。

触发：收到 `ackApplication` 动作或该规则对应的正式观察。执行者：实际改动者/用户接口。

读取：O24、O26、O03。写入：O24。

输入：

```typescript
{messageId:string;application:Application;actualVersions:{[id:string]:number}}
```

前置、效果与拒绝：实际正式版本和来源证据匹配才补记application。同样重放no_op，不同已记拒idempotency_conflict。秘书是否能ack按AMB-21。不能拿答复文字冒充落实。

拒绝码：`forbidden, incomplete, revision_conflict, idempotency_conflict`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S10、S61。

### R30 deriveQueue

依据：DESIGN §1.4 L176–197；§6 L978–981。状态：提议 §9.1 #10、#13；已定（决定 37）。片：5。

触发：收到 `deriveQueue` 动作或该规则对应的正式观察。执行者：views。

读取：O24、O14、O21、O34、O43、O07。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{goalId:string|null;planningMissing:boolean;includeHistory:boolean}
```

前置、效果与拒绝：七来源分别按sourceKind:sourceId聚合，不建卡库。候选按request。主面共用id。通知按工作区水位。缺初始化AMB-14；取消AMB-28。注记书记待办不自动当用户审批。

拒绝码：`invalid`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S10、S51、S54、S68。

### R31 markNoticesSeen

依据：DESIGN §1.4 L189。状态：提议 §9.1 #10。片：5。

触发：收到 `markNoticesSeen` 动作或该规则对应的正式观察。执行者：用户。

读取：O07、O24。写入：O07。

输入：

```typescript
{seen:number[];hidden:number[]}
```

前置、效果与拒绝：仅更新noticeCursor。单调，不改消息已读/答复/落实。滤掉项水位AMB-15。

拒绝码：`forbidden`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S55。

### R32 secretaryHandoff

依据：DESIGN §1.1 L106–108；§4.4 L728。状态：已定（决定 37 / Q8）；提议 §9.1 #16、#17、#24。片：6。

触发：收到 `secretaryHandoff` 动作或该规则对应的正式观察。执行者：Workflow/秘书。

读取：O09、O19、O34、O35、O24。写入：O09、O19、O51。

输入：

```typescript
{from:string;to:string;understandingGoals:string[];targetExists:boolean;creationCompleted:boolean}
```

前置、效果与拒绝：无running Query，换前先有应写理解。多目标AMB-18；排队AMB-19；已有目标秘书AMB-17。新目标creationCompleted=false只提创建，不转归属/归档；完成观察true才新建handoff秘书另起线，旧归档；请求和请回答沿归属读到接任，消息原sender不改。两档发notice。

拒绝码：`busy, incomplete, revision_conflict`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S07、S58、S59。

### R33 secretaryAutoArchive

依据：DESIGN §1.1 L108；§4.5 L751。状态：提议 §9.1 #17、#24。片：6。

触发：收到 `secretaryAutoArchive` 动作或该规则对应的正式观察。执行者：Workflow。

读取：O09、O20。写入：O09。

输入：

```typescript
{sessionId:string}
```

前置、效果与拒绝：已归档返回archived=true且no_op。没有processing、无占用、最后新请求满一天才自动归档。每项目保留最近一条可用秘书。已交出的超长前任不等一天。

拒绝码：`busy`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S05、S07。

### R34 expireWait

依据：DESIGN §1.9 L314–319；§4.6 L766–773。状态：已定（Q20）；提议 §9.1 #7、#20、#24。片：7。

触发：收到 `expireWait` 动作或该规则对应的正式观察。执行者：Host/现有驱动。

读取：O24、O11、O09、O19。写入：O24。

输入：

```typescript
{messageId:string;replyAtSameTime:boolean;firstCommit:'reply'|'expiry';priorChainExpiries:number;priorRequestExpiries:number}
```

前置、效果与拒绝：过deadline且无答复、未用掉才写expiredAt。并发及第二次统计AMB-25。绝不释放未知占用。Work发原Task/Session接续效果，秘书新请求轮；退役发信者AMB-26。

拒绝码：`invalid`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S11、S18、S65、S66。

### R35 receiveReply

依据：DESIGN §1.9 L318–319；§4.6 L771–772。状态：已定（决定 7 / Q20）；提议 §9.1 #7、#20、#24。片：7。

触发：收到 `receiveReply` 动作或该规则对应的正式观察。执行者：受信收件者/用户。

读取：O24、O09、O19、O11。写入：O24。

输入：

```typescript
{messageId:string;reply:Reply}
```

前置、效果与拒绝：真实收件者与版本核对，保存response。action明确reject同时记rejectedAt，Reply.text留理由；不写appliedAt、不改Task。这是字段映射推断。同样重放无变化，不同回复冲突。秘书找当前请求owner。Work用原Session。expired/consumed后的回复是普通输入。退役sender标undelivered，用户才转交。

拒绝码：`forbidden, revision_conflict, idempotency_conflict`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S07、S11、S13。

### R36 consumeWait

依据：DESIGN §4.6 L769–773；附录 C #13。状态：提议 §9.2；已定（Q20）。片：7。

触发：收到 `consumeWait` 动作或该规则对应的正式观察。执行者：Runtime。

读取：O24、O11、O19。写入：O24。

输入：

```typescript
{messageId:string;executionId:string;kind:'response'|'expiry';inputAccepted:boolean}
```

前置、效果与拒绝：真实inputAccepted才记consumed。同等待最多一个response/expiry消费关系；重复同样no_op，另一个结果走普通输入。没有真实接受拒incomplete。

拒绝码：`incomplete, forbidden`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S11。

### R37 forwardUndelivered

依据：DESIGN §1.9 L319；§4.6 L772。状态：已定（决定 7 / Q20）；提议 §9.1 #20。片：7。

触发：收到 `forwardUndelivered` 动作或该规则对应的正式观察。执行者：用户。

读取：O24、O09。写入：O24。

输入：

```typescript
{messageId:string;newMessageId:string;to:string}
```

前置、效果与拒绝：只用户；原消息undelivered，目标active非退役同scope。新消息originalId=旧id，旧消息transferredTo=新id；原收件地址不改，不消费原等待。重复同id同目标不再发。

拒绝码：`forbidden, invalid, revision_conflict`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S11。

### R38 disposeWait

依据：DESIGN §4.5 L737；§4.6 L774。状态：提议 §9.1 #3、#20、#24。片：7。

触发：收到 `disposeWait` 动作或该规则对应的正式观察。执行者：用户/Workflow。

读取：O24、O11、O09。写入：O24。

输入：

```typescript
{messageId:string;mode:'cancel'|'transfer';to:string;newMessageId:string}
```

前置、效果与拒绝：cancel视作expiry输入，不释放占用。transfer按AMB-27改变等待处理方，或撤原等待新发询问。秘书等待随请求转，不逐项取消。

拒绝码：`invalid, busy`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S67。

### R39 directIntervention

依据：DESIGN §1.6 L268–282。状态：已定（决定 38 / Q18；冻结原型）；提议 §9.1 #22。片：7。

触发：收到 `directIntervention` 动作或该规则对应的正式观察。执行者：用户。

读取：O09、O15、O12、O24。写入：O24。

输入：

```typescript
{message:Message;decisionOpen:boolean;goalCompleted:boolean}
```

前置、效果与拒绝：目标Session归档/退役拒绝。保存直接干预queued。Goal暂停/取消或decisionOpen不叫醒。忙时等安全点；空闲有未完Task提接续，无Task且Goal未完成按Q18提独立小任务；原GoalPhase已完成才按AMB-31提新计划载体或新Goal，自治另核。satisfied Task不改。

拒绝码：`invalid, unavailable`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S13、S71。

### R40 deliverSafePoint

依据：DESIGN §1.6 L268、273–275；E3 输入已接受。状态：已定（冻结原型）；提议 §9.2。片：7。

触发：收到 `deliverSafePoint` 动作或该规则对应的正式观察。执行者：Runtime。

读取：O24、O15、O09。写入：O24。

输入：

```typescript
{messageId:string;decisionOpen:boolean;inputAccepted:boolean}
```

前置、效果与拒绝：release必须released，delivery必须queued。Goal active、没有阻挡决定、收件者可用、真实inputAccepted才delivery=delivered。否则仍queued。送达不写appliedAt。

拒绝码：`unavailable, incomplete`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S13。

### R41 copyCancelledGoal

依据：DESIGN §1.6 L276–282。状态：已定（决定 39）；提议 §9.1 #22。片：6。

触发：收到 `copyCancelledGoal` 动作或该规则对应的正式观察。执行者：用户。

读取：O15、O18、O24、O35。写入：O15、O24、O53。

输入：

```typescript
{sourceId:string;newId:string;confirmed:boolean;selectedMessageIds:string[]}
```

前置、效果与拒绝：只从cancelled复制。未确认仅草稿；确认新Goal v1、plan0、copiedFrom，旧Goal不写。初方案用户。理解链接旧目标，不搬旧记忆。顺序等待AMB-29；未选消息撤回时点AMB-30。

拒绝码：`invalid, forbidden`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S12、S69、S70。

### R42 transferCopiedInterventions

依据：DESIGN §1.6 L282；§4.6 L776。状态：提议 §9.1 #22。片：7。

触发：收到 `transferCopiedInterventions` 动作或该规则对应的正式观察。执行者：用户/Workflow。

读取：O15、O24、O09。写入：O24。

输入：

```typescript
{sourceGoalId:string;newGoalId:string;selected:string[];destinations:{[messageId:string]:string};firstPlanAdopted:boolean}
```

前置、效果与拒绝：新目标确从旧目标复制且初方案正式采用。已选新messageId=新Goal:旧消息，引用originalId；原消息标转交。退役/归档原线须指定新收件者。未选撤回。每消息对原子，重复不再发。

拒绝码：`invalid, unavailable`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S12。

### R43 writeNote

依据：DESIGN §3.1 L536；§3.3；§3.6 L610–619。状态：已定（决定 22 / Q7）；提议 §9.1 #16、#25。片：4。

触发：收到 `writeNote` 动作或该规则对应的正式观察。执行者：agent/用户。

读取：O34、O35、O37、O04、O12。写入：O34、O35。

输入：

```typescript
{note:Note;mode:'replace'|'coexist'|null;currentVersion:number;anchorExists:boolean;quotaUsed:number;goalQuotaFull:boolean}
```

前置、效果与拒绝：scope/锚点/可信source合法；copy拒，秘书限自己的note/理解。尺寸口径AMB-36，facts≤16、extra≤4、files≤32。同topic没mode拒。结构/矛盾用户待审；锚点quotaUsed≥5或受信goalQuotaFull为true时书记待审；repair暂存于Run。新理解写时current CAS成功即推进；Q7允许本目标先用。当前条撤下/被拒后的指针AMB-33，用户来源AMB-35。

拒绝码：`invalid, forbidden, revision_conflict`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S09、S76。

### R44 reviewNote

依据：DESIGN §1.7 L292–294；§3.6 L614–616。状态：已定（Q7、Q23）；提议 §9.1 #14。片：4。

触发：收到 `reviewNote` 动作或该规则对应的正式观察。执行者：书记/用户。

读取：O34、O35。写入：O34、O35。

输入：

```typescript
{noteId:string;verdict:'accept'|'reject'|'merge';humanDecision:boolean}
```

前置、效果与拒绝：书记普通accepted→reviewed全项目并notice。结构/矛盾须用户humanDecision。reject拒绝留史；merge只给合并建议，须下一次显式正文+replace写入。已审只改变跨目标可用范围；当前理解被拒后的指针按AMB-33，不复活已取代条。

拒绝码：`forbidden, invalid`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S16。

### R45 withdrawNote

依据：DESIGN §1.7 L289–291；§3.6 L616。状态：已定（Q23）；提议 §9.2。片：4。

触发：收到 `withdrawNote` 动作或该规则对应的正式观察。执行者：作者/书记/用户。

读取：O34、O35。写入：O34、O35。

输入：

```typescript
{noteId:string}
```

前置、效果与拒绝：用户、原作者、书记可撤，用户条目AMB-35。state=withdrawn保正文事实。若为current需清或回退非撤下已审前版，不让默认读取继续用撤下条。

拒绝码：`forbidden`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S16、S73、S75。

### R46 deriveNote

依据：DESIGN §3.3 L566–570；§3.5 L591；§3.7 L628–631。状态：已定（决定 23；推出 7）；提议 §9.2。片：4。

触发：收到 `deriveNote` 动作或该规则对应的正式观察。执行者：views/notes。

读取：O34、O12、O15、O09、O03。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{noteId:string;goalId:string|null;digests:{[path:string]:string};anchorChanged:boolean;eventsAfter:boolean;fileBudget:number}
```

前置、效果与拒绝：只有accepted/reviewed且scope可用的才可供当前输入。摘要变化/锚定义变化复查。未核对条目不可用，原source读不到保留并标记。staged任务取消/替代invalid。plan失效范围AMB-34。later相关事件updateDue。

拒绝码：`not_found`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S16、S74。

### R47 applySemanticRepair

依据：DESIGN §3.6 L617；§1.3 L148–149；决定 21。状态：已定（决定 21 / Q12）；提议 §9.2。片：8。

触发：收到 `applySemanticRepair` 动作或该规则对应的正式观察。执行者：evidence/架构 owner。

读取：O34、O13、O15。写入：O34。

输入：

```typescript
{noteId:string;roundId:string;humanApproved:boolean;catalogRevisionOk:boolean;withinFootprint:boolean}
```

前置、效果与拒绝：暂存repair、本次足迹、适用PASS、目录提交成功才激活。结构都需humanApproved，小改step也需。未过保持暂存；Task取消替代invalid。目录与注记生效关系同次，不伪造目录新版本。

拒绝码：`invalid, incomplete, forbidden, revision_conflict`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S16。

### R48 updateUnderstandingDue

依据：DESIGN §3.5 L591–602。状态：已定（Q8）；提议 §9.2。片：4。

触发：收到 `updateUnderstandingDue` 动作或该规则对应的正式观察。执行者：views/装配器。

读取：O35、O34、O12、O18、O09。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{anchor:Anchor;events:{at:number;kind:'task_end'|'rework'|'adopt'|'archive'|'regroup'}[]}
```

前置、效果与拒绝：current缺或其写后相关task_end/rework/adopt/archive/regroup则updateDue。工作agent顺手写，手动无人时书记。纯读不存标志、不额外调模型。

拒绝码：`invalid`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S16。

### R49 selectInputs

依据：DESIGN §2.8 L452–465。状态：已定（决定 11；推出 9）；提议 §9.2。片：3。

触发：收到 `selectInputs` 动作或该规则对应的正式观察。执行者：tasks/Runtime。

读取：O12、O13、O18、O24、O39。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{taskId:string;requirementIndex:number;available:Source[];trustedCurrent:boolean;currentDigest:string|null;atUse:boolean}
```

前置、效果与拒绝：先核declared requirement/scope。缺产物missing、多候选ambiguous都提醒，不挡Run。check选最近适用PASS，artifact不猜。历史说明/可信current AMB-37。selected记fixed Source和observedAt。

拒绝码：`forbidden, source_stale, invalid`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S03、S15、S77。

### R50 assembleContext

依据：DESIGN §5.1–5.2 L882–909。状态：已定（决定 34；推出 4）；提议 §9.2。片：3。

触发：收到 `assembleContext` 动作或该规则对应的正式观察。执行者：Runtime。

读取：O15、O12、O34、O39、O40、O50。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{assemblyId:string;callKind:Assembly['callKind'];sections:{name:string;text:string;required:boolean}[];sources:Source[];boundAssembly:Assembly|null;budget:number}
```

前置、效果与拒绝：bound原样返回。按§5.2的8种callKind段落表、稳定name/固定LF拼；unknown/重复name拒invalid；continuation最后。动态记忆放轮输入，不放system或Kernel记忆。返回sources与noteVersions。预算AMB-38。

拒绝码：`incomplete, invalid`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S22、S78。

### R51 lookFind

依据：DESIGN §5.3 L932–933；Q6。状态：已定（决定 22 / Q6；推出 3）。片：3。

触发：收到 `lookFind` 动作或该规则对应的正式观察。执行者：所有职责。

读取：O41、O42、O39。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{mode:'look'|'find';needle:string;nodes:{id:string;name:string;path:string;summary:string;noteBody:string}[];historyRequested:boolean;scope:Scope}
```

前置、效果与拒绝：look按明确路径/id查卡，再子邻居/执行/有范围历史。find只name/path/summary大小写敏感包含，保持索引顺序。noteBody不检索。读取不ack、不调模型。

拒绝码：`not_found, forbidden`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S14。

### R52 deriveTools

依据：DESIGN §2.7；§5.3 L928–950。状态：已定（决定 37）；提议 §9.2。片：3。

触发：收到 `deriveTools` 动作或该规则对应的正式观察。执行者：Host/Runtime。

读取：O09、O15、O45。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{sessionId:string;goalId:string;kCommandEnabled:boolean}
```

前置、效果与拒绝：按固定role/autonomy授工具，writer仍核权。所有look/find。copy无记。秘书记自身、发四意图、只读文件；K且沙箱可用才只读命令。无apply_plan、无秘书claim/write。ack/respond AMB-21。

拒绝码：`not_found`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S19。

### R53 readOnlyCommand

依据：DESIGN §5.3 L917–926。状态：提议 §9.1 #18；已定（决定 37）。片：K。

触发：收到 `readOnlyCommand` 动作或该规则对应的正式观察。执行者：秘书。

读取：O45、O50。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{sessionId:string;kEnabled:boolean}
```

前置、效果与拒绝：K不支持或无sandbox拒unsupported，不跑宿主。支持时全workspace只读、temp可写、network=false。快照变了报完整性失败unavailable。

拒绝码：`unsupported, unavailable, forbidden`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S19。

### R54 closeKernelTurn

依据：DESIGN §4.3 L697–705；§9.4 风险 7。状态：提议 §9.1 #1。片：K。

触发：收到 `closeKernelTurn` 动作或该规则对应的正式观察。执行者：Runtime。

读取：O45、O09。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{sessionId:string;kEnabled:boolean}
```

前置、效果与拒绝：仅platformRunEnded且无实际活动执行可关；否则busy。无能力unsupported，失败unavailable并给接续退路。成功清活动Turn并标interrupted。重复已终态no_op。半截投影AMB-39，原记录保留。

拒绝码：`busy, unsupported, unavailable`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S79。

### R55 compact

依据：DESIGN §4.11 L835–864。状态：提议 §9.1 #19；边界已定（决定 39）。片：K2。

触发：收到 `compact` 动作或该规则对应的正式观察。执行者：Workflow/Runtime。

读取：O09、O45、O49、O46、O34。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{sessionId:string;supported:boolean;long:boolean;stubsEnough:boolean;sourcesValid:boolean;summaryValid:boolean}
```

前置、效果与拒绝：unsupported披露并提换手；占用busy，未超长no_op。空闲两轮间先旧工具桩，保最近compactKeep轮与调用结果对。不够按AMB-40摘要或incomplete。用户话原文、五段、来源/尺寸校验。只返回Kernel写效果，平台无新记录。

拒绝码：`busy, unsupported, incomplete`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S21、S80。

### R56 wakeOnCommit

依据：DESIGN §2.10 L486–490；§4.6 L773。状态：已定（推出 1）；提议 §9.2。片：7。

触发：收到 `wakeOnCommit` 动作或该规则对应的正式观察。执行者：Host。

读取：O44、O15、O24、O09。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{wake:WakeSet;recordKind:string;projectId:string;startup:boolean}
```

前置、效果与拒绝：只匹配project+recordKind登记且Goal active。合并、稳定排序、wakeLimit分页，余下下次。startup从已答复/到期等待和未处理released action重建。只叫Workflow一步，不调模型。

拒绝码：`invalid`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S18。

### R57 handoffWork

依据：DESIGN §4.4 L718–730；§1.3 L152–154。状态：已定（Q8、Q21）；提议 §9.1 #8。片：7。

触发：收到 `handoffWork` 动作或该规则对应的正式观察。执行者：agent/用户。

读取：O09、O10、O11、O35、O15。写入：O09、O10。

输入：

```typescript
{from:string;to:string;taskIds:string[];understandingWritten:boolean;humanApproved:boolean;longLine:boolean;existingTarget:boolean;creationCompleted:boolean}
```

前置、效果与拒绝：旧同任务写者running拒busy；本次理解没写拒incomplete。长期或step短线须批准。新目标creationCompleted是可信完成观察，false只提创建，不转责任/归档。建新Session和责任转移分两阶段，只有责任关闭/打开原子。部分交出旧线保留；全部无等才归档。已有接任者origin不改，以新责任关系展示接手。

拒绝码：`busy, incomplete, forbidden, revision_conflict`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S17。

### R58 readActivity

依据：DESIGN §1.10 L328–329；§6 L991–992。状态：已定（Q5 A、B）；提议 §9.2。片：2。

触发：收到 `readActivity` 动作或该规则对应的正式观察。执行者：views。

读取：O11、O13、O47、O48、O49。写入：无；只返回派生值或外部动作请求。

输入：

```typescript
{runIds:string[];from:number;to:number;backfill:boolean}
```

前置、效果与拒绝：按hour与检查id去重聚合，时间窗[from,to)。〔lead 改〕旧Run没有计数时补不补算、缺的时候怎么显示，正文没定（DESIGN L329：第 2 片动工前由 lead 定；合并后见 AMB-46）；原文写的“标unknown，不填零，不按总量平摊”超出正文。AMB-46 的三个选项都不填零。backfill只请求Runtime数原史；时间点只已有事实并approximate。

拒绝码：`invalid`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S22。

### R59 resolveCandidate

依据：DESIGN §1.1 L120–121。状态：提议 §9.1 #23。片：5。

触发：收到 `resolveCandidate` 动作或该规则对应的正式观察。执行者：用户。

读取：O21、O22、O20、O09。写入：O21。

输入：

```typescript
{candidateId:string;action:'regenerate'|'abandon'}
```

前置、效果与拒绝：只有用户。〔lead 改〕abandon 以后候选存成什么，正文没定（DESIGN L121 只说别的请求的候选读出来“已过期”、不标“未采用”；合并后见 AMB-32，也碰到 E3-UI-ITEMS 第 222 行的旧说法）；原文写的“标not_adopted并加版”超出正文。保留正文；重复放弃no_op，accepted拒绝。regenerate须stale，沿请求找当前秘书，给下一计划轮请求；旧候选等R24替换才标未采用，无请求则给planner_proposal。

拒绝码：`forbidden, invalid, revision_conflict`。所有未列拒绝均保留输入状态。例子和精确正反断言见 SCENARIOS 的 S08。

## 跨对象不变量

I01。每个正式引用含 projectId、workspaceId 和固定版本；跨 scope 动作拒绝。

I02。每个 Session 的来历创建后不修改；职责不能运行中切换。

I03。continuation 同线，handoff 新线，copy 只挂原线；不创建永久成员身份。

I04。copy 不能领取、改工作区、记注记或替原成员承诺。

I05。退役与归档分别表示事实和决定；退役不能重新启用。

I06。每 Session 只有一个实际修改型占用；到期不解除占用。

I07。本模型不从 Run 结束、消息、记忆或模型回答推导 Task satisfied 或 Goal COMPLETED。

I08。已取消 Goal 永远不恢复 active；重新入队创建不同 id 的 Goal。

I09。第一个方案只有用户采用；后续自动采用须在范围内并有正式采用确认。

I10。冲突提示不是领取门；没有交集不证明没有冲突。

I11。秘书 step 下的 action/answer 未放行前收件者看不到；notice/decision 不待放行。

I12。核三版并增派工序号与实际发出同次提交；拒发不增序号。

I13。请求的后续轮 rootId 和 goalId 保持；归属沿接任而非修改消息 sender。

I14。同一请求至多一个存储 candidate；别请求采用只派生 stale。

I15。答复与落实独立；拒绝/延期不自动推动计划。

I16。同一等待至多一个 consumed 结果；迟到回复保留但不重开已用等待。

I17。每锚点至多一个 current 指针；版本冲突不覆盖旧理解。

I18。记忆不授权、不改机器状态；撤下、取代、来源不可用都保留历史。

I19。所有只读规则返回不变状态；拒绝也不写，唯明确的 staged归档 partial 分支例外。

I20。K/K2不能声称恢复原Run；K2不删原历史、不换Session、不算MVP门槛。

## 技术推断与边界

Line用headId作这次读的key；置顶输入可用线内Session引用匹配后续线，不造稳定成员身份。旧Session恢复来历用AMB-1。R11同时状态的优先顺序、find大小写敏感、固定LF、CAS错误映射、id平局按字典序是分析用技术约定，待lead冻结。现有规格明确停机/未知/完成条件优先，不能用这个顺序改既有机器。

输入声明由Plan读取；旧inputRequirements只作为声明，无预先预测版本。selectedInputs每次使用产物都返回精确Source与observedAt，真实持久位置仍由第3片定。命令足迹不全如实标记。

当前理解的“版本”是CurrentPointer的CAS版；Note本身仍有固定版。派工pin的dispatch是sequence，不是记录version。每次发送返回新sequence；新记录absence=0。新本目标理解写入成功即推进current，不能等书记审才让本目标使用；撤下/拒绝当前条的清空或回退是AMB-33。此区分是技术推断。重放先后仍AMB-22。

空Goal、多个候选产物、旧数据断链、未知Kernel事实没有虚构成功。工具产生哪些文字、谁语义上该做哪个任务、谁认为该升级冲突，都由显式输入表示。单目标注记总额度的数字未定。用受信goalQuotaFull输入表示额度结果，不偷偷取5。模型不测实际模型质量、Kernel文件原子性、进程沙箱真实性、Token/缓存收益或真实大规模分页性能。

## 装配器的精确段落表

依据DESIGN §5.1–5.2 L882–909。段名、标题括号和固定LF是分析推断。每种调用只接收下列段名，顺序固定。重复或未知段名拒invalid。文本是可信适配器已经排好的行，纯函数不猜文字语义。sources按kind/id/version/path/digest排。

| callKind | 段顺序 |
| --- | --- |
| work | role, goal, task, footprint, notes, reminders, inputs |
| continuation | role, goal, task, footprint, notes, reminders, inputs, continuation |
| handoff | role, goal, task, footprint, notes, reminders, inputs, handoff |
| review | role, task, reminders |
| secretary | role, goal, task, notes, reminders |
| copy | role, task；目标事实可在简短role上下文里 |
| planning | role, goal, module_cards, plan_summary |
| attention | attention_nodes |

完整段写[name]、LF、原样text，各段用LF连。attention预算取min(budget,16384)，其他用明确budget；4096只是配置默认。已绑定直接返原文。预算超限按AMB-38，未装全文的每段计omitted。版本来源与Note引用一并返回，不能丢。

ModelState.scope是本次动作scope。项目级只读计数可带同项目其他工作区的Session/Query行。写目标和工具来源仍核本次scope。自动归档秘书要求可信适配器给完整项目清单；这里的单工作区fixture不证明真实存储清单完整。
