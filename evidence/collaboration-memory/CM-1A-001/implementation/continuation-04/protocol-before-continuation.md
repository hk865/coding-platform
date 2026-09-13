# CM-1A-001 协议约束（字段语义、事务边界与兼容）

来源：用户在 5 步实施计划之后的直接补充。**本文件是实施必须遵守的协议边界，不是待办清单的替代。**
与 `CM-1A-001-FOLLOWUP-PLAN.md` 一起读；冲突时以本文件为准（它更具体）。

## 0. 命名与交付要求

- **字段名可以沿用现有命名**，但下节的语义必须先明确。
- **交付要求（硬性）**：每个新增字段都必须在本文档的表格里说明 **谁写 / 谁读 / 何时固定 / 重放时如何比较 / 旧记录缺失时怎么办**。
  **没有实际消费者的字段先不加。** 实现时若新增了本文档未列的字段，必须回来补齐这一行，否则不算交付完成。

## 1. 字段语义约定

### 1.1 Wait 的参与关系

| 问题 | 约定 |
| --- | --- |
| 语义 | 注册时的 participation 是**历史归因**，**不能永久充当后继执行者** |
| 谁写 | Control 在 `wait-register` 时写入 `ownerParticipationRef`；此后不再改写（保留原记录） |
| 谁读 | 接续资格判定读它**仅用于追溯**；执行者身份读的是当前有效参与关系 |
| 何时固定 | 注册时固定为历史事实；**执行者身份在接续时由 Control 选择并固定在 admission 中** |
| 重放如何比较 | 同一 wait 的 `ownerParticipationRef` 逐字节相等即 replay；不等即 `idempotency_conflict` |
| 旧记录缺失 | 旧 wait 若缺少参与关系：**不可恢复**，返回明确原因，不补猜值 |

### 1.2 Admission 的输入绑定

| 问题 | 约定 |
| --- | --- |
| 必须持久保存 | 本次实际采用的 **Work**、**participation**、**RoleBinding**、**前驱/后继 Run**、以及**必需 Delivery 的精确引用与版本** |
| 谁写 | Control 在 `communication-successor-claim` 同一事务写入 |
| 谁读 | **Dispatch 与 Context 消费同一份绑定**，各自**不得重新猜测** |
| 何时固定 | 受理时固定；后续只读 |
| 重放如何比较 | 同一 `(workRef, waitRef, satisfiedRevision)` 的 admission 逐字节相等即 replay；不等即冲突（唯一键已在契约中） |
| 旧记录缺失 | 缺少输入绑定的旧 admission：**不可恢复**（不启动后继），返回明确原因 |

### 1.3 后继运行准备

| 问题 | 约定 |
| --- | --- |
| 必须保存 | 重建 RunSpec 所需的**版本化来源**与**运行配置** |
| 重放判据 | **以 exact RunRef + 准备内容摘要**判断重放；**同 Run 不同内容必须拒绝，不能覆盖** |
| Workspace 路径 | 由**受信宿主**解析（不由模型或快照里的自由文本决定） |
| 谁写 | Dispatch 在准备提交时写；Control 是准入与落账的权威 |
| 谁读 | 后继启动读它组装 RunSpec；恢复扫描读它判断是否已准备 |
| 旧记录缺失 | 缺少准备来源的旧 Run：**不启动**，进入对账并给出明确原因 |

### 1.4 路由分页位置（**对第 1 步的修正，优先执行**）

| 问题 | 约定 |
| --- | --- |
| 两个位置 | 必须区分 **「源事件位置」** 与 **「该事件内的订阅分页位置」**，另**固定本轮订阅范围** |
| 关键规则 | **同一事件翻页时，事件位置允许不变，但订阅位置必须前进** |
| 因此 | **不能继续用「事件位置每页严格增加」去校验所有分页** —— 第 1 步的校验必须按此改写 |
| 谁写 | Dispatch 提议；Control 在同一个 `communication-route-page` 事务里落账 |
| 谁读 | 下一页 intent 的构造读两者；末页完成后才推进事件处理位置 |
| 重放如何比较 | 同一 intent 的 `(事件位置, 订阅位置, 订阅范围)` 逐字节相等即 replay；订阅位置回退或原地不动即拒绝 |

### 1.5 领取与提交

| 问题 | 约定 |
| --- | --- |
| 每次领取携带 | **consumer**、**generation**、**期望版本** |
| 后续核对 | **开始、结算、取消确认都要核对这些值** |
| 重放回执 | **重放回执不授予再次执行副作用的权利** |
| 谁写/谁读 | Dispatch 领取；Control 核对并落账 |
| 旧记录缺失 | 缺少 generation 的旧 intent：**不领取**，进入对账（不可默认 generation=0 后执行副作用） |

### 1.6 模型调用证据

| 问题 | 约定 |
| --- | --- |
| 必须区分四个东西 | **许可 ID**、**调用尝试 ID**、**实际请求摘要**、**Context 摘要** |
| 基数 | **一次许可只能对应一次调用尝试** |
| 层次 | **`authorized`、`attempted`、`acknowledged` 含义分开，不能相互替代** |
| ack 判据 | **provider 的可验证回执才记 ack；计量完成不直接等于 ack** |
| 谁写 | Control 签发许可；Runtime 经正式事实通道落账尝试与结果 |
| 重放如何比较 | 同一许可 ID 的第二条尝试必须被拒；同一尝试的重复事实按既有 run-fact 去重语义处理 |

## 2. 四条协议规则

### 2.1 原子事务具体包含什么

- **路由页**：Delivery、**订阅进度**、等待观察、**下一页 intent**、**当前页结算** 必须**一起提交**。
- **后继接续**：`wait satisfied`、**admission**、**Attempt**、**Run**、**唯一 outbox** 也必须**一起提交**。
- **换手**：涉及的**当前参与关系版本**要进入**同一事务的版本检查**（不能先查后写）。

### 2.2 换手不能自动继承旧授权

- 新参与者必须**按当前有效 RoleBinding 重新核验资格**。
- **没有合格参与者时保留等待并返回明确原因**；
- **不能退回旧关系，也不能临时扩大权限。**

### 2.3 协调工具需要独立能力声明

- 发消息、登记等待**会修改平台状态**，但**不等于**获得文件写入或 shell 权限。
- 宿主必须**明确授权这些协调能力**；
- **不能把它们伪装成只读工具来绕过现有检查**。

### 2.4 旧数据与未知结果

- 新增字段要明确**版本及兼容策略**。
- 旧记录缺少**必需身份、输入绑定或调用证据**时，返回**明确的不可恢复原因或进入对账**；
  **不能补猜值后继续启动**。
- **已确认无副作用才允许重试**；**结果未知不能因为租约过期就重跑**。

## 3. 各步骤需要吸收的本文件条目

| 步骤 | 必须遵守 |
| --- | --- |
| 第 1 步（账本校验） | **1.4（分页位置，优先）**、1.5、2.1（路由页事务）、2.4 |
| 第 2 步（Work/参与/后继身份） | 1.1、1.2、2.1（后继接续事务 + 换手版本检查）、2.2、2.3 |
| 第 3 步（Host 工具 + 后继 Runtime） | 1.2、1.3、2.1、2.3 |
| 第 4 步（持续路由/调用证据/取消与 unknown） | 1.4、1.5、1.6、2.4 |
| 第 5 步（有界并发 + 收尾） | 1.5、2.4 |

**状态：已批准，实施中。** 本文档与实施同步更新：任何新增字段都必须回到第 1 节补一行。

## 4. 已新增字段的五问登记（第 0 节硬性要求的实际记录）

本节由实施者按第 0 节逐字段回填；**任何新增字段都必须在这里出现，否则不算交付完成**。

### 4.1 `WorkContextBindingV1.currentParticipationRef?: WorkParticipationRef | null`（`src/contracts/context-continuity.ts`）

| 五问 | 约定 |
| --- | --- |
| 谁写 | Control，在 `participation-start` 的**同一提交**里写入（与参与关系快照、`WorkRunLinked`、binding 自身 CAS 同批次）。`participation-end` **不**改它 |
| 谁读 | Control 的 `admitWaitSuccessor`（接续资格）；Dispatch 的 `CoordinationDrive.loadBinding`（构造提议）。只读投影目前不读 |
| 何时固定 | 随该 Work 每次受理参与关系固定一次；不因请求/订阅/等待/投递而变 |
| 重放比较 | 不是命令载荷，不参与幂等比较；随承载它的那次提交逐字节落账（`participation-start` 重放返回原回执，不再改写） |
| 旧记录缺失 | `undefined`/`null` = 该 Work 还没被受理过任何参与关系 → 后继受理 **fail-closed**（`no_active_participation`），**不回退**到等待登记时那一段，也不补猜 |

### 4.2 `CommunicationAdmissionV1.roleBinding` / `.deliveryRefs`（`src/contracts/coordination.ts`）

| 五问 | `roleBinding` | `deliveryRefs` |
| --- | --- | --- |
| 谁写 | Control，`communication-successor-claim` 同一事务；值 = 本次采用的**当前参与关系**上固定的 RoleBinding（受理前与 payload 逐字段核对） | 同一事务；值 = payload 里逐条核对过「存在 + `targetWorkContextRef` == 该 Work」的 Delivery 引用（重复去重） |
| 谁读 | 第 3 步重建后继 RunSpec（协议 1.3 的「授权来源」） | Context 侧只按该集合取材（第 3 步） |
| 何时固定 | 受理时固定，后续只读 | 同左 |
| 重放比较 | 同一 `(workRef, waitRef, satisfiedRevision)` 的 admission 逐字节相等即 replay（唯一键 + CAS@0） | 同左 |
| 旧记录缺失 | 旧 admission 无该字段 → 第 3 步按 1.2 判**不可恢复、不启动后继**；不补猜 | 旧 admission 无该字段 → 同上；**禁止**回退成「读该 Work 的邮箱」——那正是 1.2 要禁止的重新猜测 |

### 4.3 `DispatchIntentV1.admittedWorkRef?: WorkContextRef`（`src/contracts/dispatch.ts`）

| 五问 | 约定 |
| --- | --- |
| 谁写 | Control，`communication-successor-claim` 同一事务（唯一生产者 `buildSuccessorCommit`，值 = `admission.workContextRef`） |
| 谁读 | Dispatch 的 `ensureWorkIdentity` → `ensureAdmittedWorkIdentity`：**不解析、不推导**，只读+复核+link |
| 何时固定 | 受理时固定；随唯一调度记录一起持久化 |
| 重放比较 | 是 intent 值的一部分：账本校验要求 `DispatchOutboxEntry.intent` 与 `outboxIntents[0]` **逐字节相同** |
| 旧记录缺失 | 普通任务 intent 无该字段 → 语义不变（按 `(project, workspace, goal, 起源任务)` 解析既有身份） |

### 4.4 账本内部：参与身份槽（`WorkIdentityClaim.release?` + `participationIdentityClaim*`，`src/data/state-ledger/ledger-validation.ts`）

| 五问 | 约定 |
| --- | --- |
| 谁写 | 两个账本适配器在**同一次提交事务**里：`participation-start` 占用 `(project, workspace, agentInstanceId)` 槽，`participation-end` 按 owner **释放** |
| 谁读 | 同一次提交内部的槽判定（`identityClaimConflicts`）；不是快照、无事件、无 revision，只读投影不感知 |
| 何时固定 | 与承载它的提交原子生效（失败即整体回滚，零写入） |
| 重放比较 | 不参与幂等比较（幂等判定先于槽判定，重放直接返回原回执）；**释放型声明永不冲突**，只删自己占的那个槽 |
| 旧记录缺失 | 历史 DB 无槽记录 → 新的 `participation-start` 仍可占用空槽；历史遗留的「同一 AgentInstance 两条 active 参与」**保持可读、不合并、不改写** |

### 4.5 两个新 receipt code

| code | 谁产生 | 语义 |
| --- | --- | --- |
| `AdmitWaitSuccessorReceipt.rejected/no_active_participation` | Control（`admitWaitSuccessor`） | 该 Work 当前没有有效参与关系（从未受理过参与／指针缺失／指针指向的那段已 ended）：**零写入**、等待保持 `active`、不产生后继；换手完成后同一等待仍可接续 |
| `AdmitWaitSuccessorReceipt.rejected/forbidden` | Control（`checkSchedulerAttribution`） | 归因不合法：后继受理是**调度触发**命令，必须 `{kind:'system'}` + 来源关联（correlationId 由被触发的 wait 派生）；用某段参与的 agent principal（尤其把**新参与者**与**旧 Run** 拼成一个身份）零写拒绝 |

### 4.6 待回填（实施者已裁决、正在落地）

| 字段 | 裁决 | 状态 |
| --- | --- | --- |
| `CommunicationAdmissionV1.bindingRevision` / `.participationRevision` | **要持久保存**（消费者 = 事后审计：换手竞态被拒后能复原「当时读的是哪一版」） | 第 2 步落地中 |
| `CommunicationAdmissionV1.declaredPermissions` | = 前驱信封 `declaredPermissions` ∩ 当前 RoleBinding 授权上界；**只许收窄**；空集 → 保留等待 + 明确原因 + 零写入；无矩阵时保持前驱原值并显式写出该分支 | 第 2 步落地中 |

**注意**：这两行落地后必须回到本节把五问补全（谁写/谁读/何时固定/重放比较/旧记录缺失）。


### 4.6.1 第 2 步补充裁决落地的字段（已回填五问）

| 字段 | 谁写 | 谁读 | 何时固定 | 重放比较 | 旧记录缺失 |
| --- | --- | --- | --- | --- | --- |
| `CommunicationAdmissionV1.bindingRevision` | Control，`communication-successor-claim` 同一事务 | ① 同一次提交内的 CAS（WorkContextBinding 期望版本）② 事后审计「当时读的是哪一版」 | 受理时固定，此后只读；本提交不写绑定快照 | admission 值的一部分：同一 `(workRef, waitRef, satisfiedRevision)` 逐字节相等即 replay | 旧 admission 无该字段 → 按 1.2「缺少输入绑定即不可恢复」处理，**不补猜** |
| `CommunicationAdmissionV1.participationRevision` | 同上（同一构造器） | ① 同一次提交内的 CAS（WorkParticipation 期望版本，读写之间被 end 即零写失败）② 事后审计 | 同上 | 同上 | 同上 |
| `CommunicationAdmissionV1.declaredPermissions` | Control，同事务；值 = 前驱信封 ∩ 当前 RoleBinding 规格上界（无矩阵时 = 前驱原值），**只许收窄** | ① 派发面 → 唯一 outbox 的 intent 与 `TaskClaimed` → Context 请求与后继 Run 信封 ② 审计 ③ 第 3 步 RunSpec 重建的对照源 | 受理时固定；后继 Run 信封权限由它派生 | 同上 | 旧 admission 无该字段 → 按 1.2 不可恢复；**禁止**回退成「用前驱信封权限原样启动」 |
| `CommunicationAdmissionV1.permissionBasis: 'narrowed' \| 'within_spec' \| 'no_matrix'` | 与 `declaredPermissions` **同一事务、同一次判定**写入，不可能错配 | **审计与验收**：只凭账本回答「这次接续有没有按上界收窄过」。`no_matrix` 与 `within_spec` 的权限集可能一模一样，但结论完全不同 | 受理时固定 | 同上 | 旧 admission 无该字段 → 按 1.2 不可恢复；**不**根据 `declaredPermissions` 反推 basis（那正是补猜） |

**空集（无可用授权）的判定**：交集后 `tools` 为空即视为无可用授权（**无论** `writeScope` 是否还留着）→ 按 2.2 零写入拒绝 + 保留等待 + 明确原因（原因里如实报出还留着的写范围，避免被读成「仍有写权限」）。

**判据只有一份**：策略只回答「是否越界」（布尔），交集算术在 Control，且**结果必须重新通过同一策略复核**才作数。

**新 receipt code**：`no_admissible_permissions` —— Control（`admitWaitSuccessor`）产生；当前参与关系的 RoleBinding 与继承权限无可用交集，或该绑定本身不合格 → 零写入、等待保持 `active`、不产生后继、不回退不放宽。

**已发现待补的一处**（属第 3 步文件，已下发）：`successor-run-preparation.ts` 对 admission 只交叉核对了 `roleBinding` 与 `admittedWorkRef`，**没有**核对 `declaredPermissions`；协议 1.2 要求「消费同一份绑定」，已要求补 fail-closed 核对。

### 4.7 `RoutePageProposalV1.subscriptionScope`（`src/contracts/coordination.ts`）

第 4 步「持续路由」的生产者字段：**本轮固定的订阅范围 = 整轮候选集合**，不是本页切片。

| 五问 | 约定 |
| --- | --- |
| 谁写 | Dispatch 的 `CoordinationDrive.buildPage`：**首页**写该事件位置上**全部**候选订阅（按 canonical ref key 升序）；**续页**写 intent 上已固定范围的逐字节回声 |
| 谁读 | Control 的 `buildRoutePage`（首次固定 / 逐字节复核 / 收敛掉已取消订阅）与 `buildRoutePageCommit`（落进 settled intent 的 domain）；账本 `validateCommunicationRoutePageCommit` 的第 12/18/19 条（本页不得引入范围外订阅 / 续页范围逐字节相同 / hasMore 与下一页 intent 一致） |
| 何时固定 | 该事件位置的**第一页**；此后翻页期间不得改变。唯一允许的变化是 Control 的**收敛**：把已经取消或已消失的订阅从范围里删掉（只减不增、不改版本、不改顺序） |
| 重放如何比较 | 它是 `CommunicationSettleCommand` 载荷的一部分，因此进入 `communicationSettleFingerprint`：同一条命令重放要求逐字节相同，不同即 `idempotency_conflict`；账本侧按 canonical ref key 逐条比较 |
| 旧记录缺失 | 旧形状的页（没有该字段）在 `checkRoutePageProposal` 处**直接判非法**——**不**补猜成空数组（协议约束 2.4：不补猜值后继续）。历史 intent 上的 `subscriptionScope: []` 保持可读，驱动对它仍按「本轮尚未固定」处理 |

### 4.8 `RouteIntentPlanV1` 与 `routeIntentPlans`（`CommunicationCommitBase` / `CommunicationSuccessorClaimCommitV1`）

第 4 步「可路由事件与待路由 intent **同事务登记**」的载体。

| 五问 | 约定 |
| --- | --- |
| 谁写 | Control：`routeIntentPlanFor(...)` → `withRouteIntentPlan(batch, plan)`，在 `DirectedRequestSent` / `DirectedRequestResponded` / `WorkParticipationEnded` / `WaitConditionSatisfied` 四个可路由源事件的提交上写入；**账本**（`materializeRouteIntentPlans`，两个适配器共用一份）在同一个事务里展开成 `CommunicationIntentRecorded` 事件 + `CommunicationIntentSnapshot@1` + 对应 CAS@0 |
| 谁读 | 唯一消费者是**账本适配器**（展开）；展开后的意图由 Dispatch 通过 `CommunicationIntentRecorded` 读到，成为持久路由触发器 |
| 何时固定 | 与源事件**同一次提交**内固定。`sourceCursor` 由账本按 anchor 事件在本次追加序列中的落点算出（`makeCommitCursor(firstSeq + anchorIndex)`），intentId 由协议同一个算式 `routePageIntentIdFor` 派生 |
| 重放如何比较 | 该字段**不在**命令载荷里，因此不参与任何命令指纹；同一提交重放时账本返回原回执、不再展开。同一 (commitKind, identity) 的另一次提交若带不同计划，会被指纹/幂等规则挡住（`idempotency_conflict`） |
| 旧记录缺失 | 没有该字段的提交**逐字节保持**旧语义（不登记任何计划）；旧库里的 `CommunicationIntentRecorded` 照旧可读。计划里的 anchor 不在本批事件、scope 为空、作用域不一致、topic 与 anchor 不符 → 整个提交 `invalid_commit`（**不**静默丢弃计划） |

### 4.9 `CommunicationSettleCommand` 的两个**非终态** outcome

| 五问 | `no_effect_failure` | `side_effect_started` |
| --- | --- | --- |
| 谁写 | Dispatch 的协作驱动（只在 settle 被 `unavailable` 拒绝、且 `sideEffectStarted === false` 时） | 即将调用执行能力的消费者（本票的生产路径上没有外部副作用的 intent，因此由调用方在调用前显式声明） |
| 谁读 | 领取判定 `decideIntentClaim`（`retry_scheduled` + `availableAt`）；backlog 的 `retryScheduled` 计数 | `decideIntentClaim`（`requires_reconcile`）、`convergeCancelled`（只能收敛为 `outcome_unknown`）、`no_effect_failure` 的守卫 |
| 何时固定 | 每次 settle 固定一次：`availableAt = settledAt + backoffMs`（退避由确定性算式 `backoffDelayMs` 给出，抖动取 intentId 的稳定摘要，可复算） | 与这次领取的 generation 一起固定；此后不再改变（不发放新 generation） |
| 重放如何比较 | 是命令载荷的一部分 → 进入 `communicationSettleFingerprint`；重复的同一命令返回原回执，`availableAt` 不会因重放而漂移 | 同上 |
| 旧记录缺失 | 旧 intent 没有这两个状态，语义不变（旧记录里 `availableAt` 只有 deadline 语义）；`sideEffectStarted` 是**既有字段**，本步只是给它补上生产者，缺省 `false` 的旧记录继续按「未产生副作用」处理 | 同左 |

**硬约束**：`no_effect_failure` 在 Control 侧被判定为「已产生副作用一律零写入拒绝」。这一条正是协议约束 2.4「已确认无副作用才允许重试；结果未知不能因为租约过期就重跑」的可执行形式。

### 4.10 先持久化取消意图：`RequestIntentCancellationCommand` / `CommunicationIntentCancelRequestCommitV1` / `CommunicationIntentCancelRequestedEvent`

| 五问 | 约定 |
| --- | --- |
| 谁写 | Control 的 `requestCommunicationIntentCancellation`。**真实生产者**：`cancelCommunication(target: 'wait')` 在等待本身落成 `cancelled` 之后，对**该等待派生出来的机械 intent**（deadline / wait_admission，按确定性 id 完整枚举）逐个标记 |
| 谁读 | Dispatch 的 `convergeCancelled`（以**同一 generation** 收敛为 `cancelled` 或 `outcome_unknown`）；`decideIntentClaim`（`cancel_requested` 一律不发新 generation） |
| 何时固定 | 标记时固定；**不发放新 generation**，也不写 `settledAt`（它不是终态）。租约字段原样保留，因此「同一 generation 收口」这条不变式继续成立 |
| 重放如何比较 | 命令进入 `requestIntentCancellationFingerprint`；同一 (commitKind, identity) 重放返回原回执。已经处于 `cancel_requested` 的 intent 再收到一次不同身份的标记是**幂等命中**（零写入） |
| 旧记录缺失 | 旧 intent 没有这个状态，语义不变；终态与 `quarantined` 的 intent 不能被标记（`forbidden`，零写入） |

`ControlEngine.requestCommunicationIntentCancellation?` 声明为**可选**：它不是新的调度写入通道（Control 自己在 desired-state 取消里就会调用它），可选只是避免强迫既有测试替身实现一条它们用不到的写入口。

### 4.11 `ModelRequestPermitV1` + `ModelRequestPermitRef`（`src/contracts/dispatch.ts`）

第 4 步 B 部分（D06）：Control 复核「exact Run + 材料版本 + 授权」后签发的**一次性**模型调用许可。
`authorized` 与 `attempted` 是**两件不同的事实**，这条聚合就是 `authorized` 的载体。

| 五问 | 约定 |
| --- | --- |
| 谁写 | **Control**（`authorizeModelRequest`）在 `RunFactCommand` 的 `model_request_authorized` 变体上写入；终态由**消费方**（Runtime 侧的调用尝试）推进 |
| 谁读 | `runFact` 的 `model_request_evidence` 分支（消费判定）；账本 `validateRunFactCommit`（形状与「一次许可一次尝试」）；调用方（用它组 RunSpec / 证据）；事后审计（谁能证明这次调用被授权过） |
| 何时固定 | **签发时**固定：`runRef` / `deliveryRefs`（受理时固定的 Delivery 精确引用，Control 自己从 canonical 受理记录读出，**不采信调用方提交**）/ `permissions`（信封权限逐字节复制）/ `issuedAt`。消费时只再写 `consumedByAttemptId` + `consumedAt` |
| 重放如何比较 | 聚合只有 @1（已签发）与 @2（已尝试）两态，CAS 是唯一判定：同一 (run, permitId) 的重复签发 → `duplicate_event`（内容不同则 `conflict_event`）；**第二次尝试用同一许可 → `conflict_event` 零写入**（这就是「一次许可只能对应一次调用尝试」的账本保证） |
| 旧记录缺失 | 旧库没有这种聚合：`model_request_evidence` 找不到许可即 `not_found`（**不**补发、**不**跳过消费判定）。没有许可的 Run 只是「没有被记录过调用许可」，旧路径语义不变 |

### 4.12 `RunFactV1.model_request_authorized` / `model_request_evidence` 与 `ModelRequestEvidenceV1`

| 五问 | 约定 |
| --- | --- |
| 谁写 | `model_request_authorized`：Control（唯一）；`model_request_evidence`：**消费方**（Runtime 捕获、经 `control.runFact` 落账）。两条都走既有 `RunFactCommand` 与 `RunFactLedgerCommitV1`，**不新增写通道**，也不污染 `RuntimeEventType`（D06） |
| 谁读 | 账本校验（许可与 Run 的对应、材料引脚逐字节一致、许可只能被一个 attemptId 消费）；ReadModel 投影（登记以免 advance 停摆）；A06 的可证伪断言（`requestDigest` 对比捕获请求、`contextInputDigest` 对比 `RuntimeContextManifest.inputDigest`） |
| 何时固定 | `model_request_evidence` 在**实际 `ModelClient.stream(request)` 边界**算出 `requestDigest`（口径复用 `model-budget.ts` 的 `inputDigest`：对最终 outgoing 请求取 sha256），随调用尝试一次固定 |
| 重放如何比较 | 同一事实重放：同一 attemptId 再次提交 → `duplicate_event`；不同 attemptId 用同一许可 → `conflict_event`（零写入）。`RunFactCommand` 本就没有账本级幂等重放，去重由 per-run sequence 与许可 CAS 共同保证 |
| 旧记录缺失 | 旧 Run 没有任何一条这种事实：语义不变（没有调用证据 ≠ 调用没发生；报告里必须如实区分）。**例外与守卫**：证据允许在 Run **结束之后**落账（调用确实发生在结束之前），守卫在 **Control**：`runFact` 只对 `model_request_evidence` 放行 `after_terminal`，并要求 `permit.issuedAt <= run.endedAt`；许可本身**只能**在 Run 还活着、信封已登记时签发 |
| 为什么这两条事实**不**写 Run 快照 | Run 的 revision 是多消费者（ordinary / handoff / workspace / reviewer 驱动）共用的**单写者 CAS 计数器**。调用证据不是生命周期事实（D06 不污染 `RuntimeEventType`），因此只写**许可聚合自己的 CAS**（@0→@1→@2），不推进 Run revision——否则按既有序列（起始 2）读取的其他消费者会 `revision_conflict`，把该 Run 的终态事实整个丢掉（第 4 步实测到过这个真实交互，已修复并回归） |

**边界（如实，见交付报告）**：本票**不写 ack**。今天唯一可得的 provider 信号是计量里的
`MeterEntry.status = 'reported'`，它只说明「用量被报出来了」，**不等于** provider 对这次调用的
可验证回执。因此不存在任何把计量完成当成 ack 的路径——但也没有实现
`provider_call_acknowledged`（一个永远为 null 的字段不是证据，按 §0「没有实际消费者的字段先不加」不立）。

### 4.14 协调能力模型（第 3 步）—— 字段与端口五问

| 字段 / 端口 | 谁写 | 谁读 | 何时固定 | 重放比较 | 旧记录缺失 |
| --- | --- | --- | --- | --- | --- |
| `COORDINATION_CAPABILITY_ID` / `CoordinationCapabilityGrantV1` / `CoordinationCapabilityDecisionV1` / `CoordinationRuntimeGrantV1`（`src/contracts/coordination-tools.ts`） | 不落账、不持久：宿主**执行前**解析（`resolveCoordinationCapability` / `coordinationRuntimeGrant`） | `LeasedWorkerRuntime.start`（决定是否注入工具）；`CodingAgentRuntime`（决定是否向内核声明能力并记录授予） | 本次 Run 启动**之前**一次；依据是账本事实，运行期不重解析 | 不参与账本幂等；同一 Run 重放由同一批 canonical 事实得出同一结论（确定性） | 缺参与关系/缺受理参与关系 → `not_granted` + 可读原因（fail-closed，不补猜身份） |
| `RuntimeRecord.coordinationCapability?`（`src/execution/worker-runtime/coding-agent-runtime.ts`） | 运行入口：**仅 granted 时**写入该 Run 的持久运行记录（journal） | 审计 / 恢复扫描（`RuntimePreparationPort.all()` 的消费者） | 运行开始时写入一次，之后只读 | 不参与命令幂等；同一 Run 重放会重建同一值（来源是 canonical 事实） | `undefined` = 没有这条授予记录；**不回填不推断**，可用性永远以执行前准入为准 |
| `ToolDefinition.platformEffect: 'coordination_state'`（平台自有工具定义附加字段，**非账本字段**） | 平台工具工厂随工具定义一起给出（内核 metadata schema 是 loose，附加字段被保留） | 用例断言声明与能力一致；后续宿主授权可据此筛选 | 工具定义创建时（编译期常量） | 不参与幂等 | 字段缺失 = 该工具不是平台状态写入工具；**不会因此获得任何能力**（授权仍只来自 `hostAuthorizedTools`） |
| `RoutePageProposalV1.subscriptionScope`（生产者口径） | Dispatch 提案：**首页**写「本轮要固定的整轮候选集合」，**续页**写已固定范围的**逐字节回声** | Control 的 `buildRoutePage`（复核范围外订阅、存进下一页 intent）；续页提案自身也读 intent 上的范围 | 本轮第一个成功的页固定；此后只在下一页 intent 上原样携带 | 同一 intent 的 `(事件位置, 订阅位置, 订阅范围)` 逐字节相等即 replay；订阅位置回退/原地即拒绝 | intent 上没有范围而当前页自称续页 → 平台侧**可见失败**（不按当前扫描另选一份）；Control 侧按既有规则拒绝 |

**决策记录（owner 裁决）**：
- **不新增 effectClass**（如 `platform_state_write`）。理由：内核的放行判据始终是 `hostAuthorizedTools.has(tool)`，新增取值只换标签、**不改变准入强度**，却要再动三个内核文件并重建 dist。现状以平台自有 `platformEffect` 补足语义，缺口如实写进 `coordination-tools.ts` 文件头与 `vendor/coding-agent/INTEGRATION.md`。
- **协调能力授予不落账**，保持「由账本事实可推导 + 随 `RuntimeRecord` 持久化」。理由：它由账本事实唯一确定，落账会是**同一批事实的第二份副本**（协议第 0 节「没有实际消费者的字段先不加」）。
- **真正的准入点在平台侧**：`coordination-tool-access.ts` 的 `capabilityDenial(operation)` 在每个写操作的**第一行**执行，**早于 `vault.put`、也早于任何 Control 命令**；校验授予与本次 Run/参与关系逐字段一致、依据在账本里读得到且仍 `active`、AgentInstance 一致；任一不成立 → 零写入拒绝，不降级成只读成功。用例 4 用**计数 Vault 包装**证明 `vault.put` 调用次数 = 0。



### 4.13 模型调用证据的落地位置、轮询面与如实边界（第 4 步 B 部分）

> 字段层的五问已在 **4.11 / 4.12** 登记（许可聚合、两个事实变体）；本节只登记它们之外的部分（证据轮询面与回执）、实际落地位置清单，以及本步**没有做到**的边界。

**落地位置**（全部落在**既有 run-fact 写通道**上：同一 `RunFactCommand`、同一 `RunFactLedgerCommitV1`、同一每 Run 单写者 CAS，不新增第二条写通道，也不污染 `RuntimeEventType`）：

| 位置 | 内容 |
| --- | --- |
| `src/contracts/dispatch.ts` | `RunFactV1` 两个新变体、`ModelRequestMaterialPinV1`、许可 Ref/Snapshot/事件、证据 V1/事件、`AuthorizeModelRequestCommand`/回执、`modelRequestPermitRefFor`；`RunFactReceipt.applied` 两个新值 |
| `src/contracts/ports.ts` | `RunHandle.pollModelRequestEvidence()`（**必选**）、`ModelRequestEvidenceDraftV1`、`DispatchSideFactFailure` 与 `DispatchDriveResult.sideFactFailures` |
| `src/contracts/events.ts` / `ledger.ts` / `commands/dispatch.ts` | 两个事件类型进 `DomainEventV1` 与 `KNOWN_EVENT_TYPES`；许可聚合进 AggregateRef/Snapshot/commit union；两个命令构造器 |
| `src/data/state-ledger/ledger-validation.ts` | `validateRunFactCommit` 受理两条新事实（许可 @1 签发 → @2 已尝试）；两条都**只**写许可聚合，不推进 Run 的 revision |
| `src/control/control-engine/run-facts.ts`、`control-engine.ts`、`src/contracts/modules.ts` | `authorizeModelRequest`（Control 签发）与两种事实的准入 |
| `src/control/dispatch-engine/dispatch-engine.ts`、`leased-worker-runtime.ts`、`runtime-dispatch.ts`、`src/execution/worker-runtime/coding-agent-runtime.ts` | 签发时机、证据轮询与转发、摘要在实际 `stream(request)` 边界取值、旁路失败出口与 Run 终态守卫 |

#### 4.13.1 `RunHandle.pollModelRequestEvidence()` 与 `ModelRequestEvidenceDraftV1`（`requestId` / `requestDigest` / `contextInputDigest`）

| 五问 | 约定 |
| --- | --- |
| 谁写 | WorkerRuntime（`CodingAgentRuntime`）：从该 Run 的计量条目取边界摘要（`requestDigest` 直接用 `ModelBudget.wrap` 对最终 `outgoing` 请求算出的 `MeterEntry.inputDigest`，**同一份 outgoing，不另算一套**），取走即推进游标（同一份草稿不重复投递） |
| 谁读 | Dispatch 的 `consumeModelRequestEvidence`（在 `consumeDispatchedRun` 之后），经 `control.runFact` 落账。**每一层包装必须无条件转发**：`LeasedWorkerRuntime` 与 `tests/contract-suite/console.contract.suite.ts` 都已显式转发 |
| 何时固定 | 草稿在 `stream(request)` 边界生成后即固定，不再改写 |
| 重放如何比较 | 草稿不是命令载荷，不参与命令指纹；重复投递的去重语义仍在账本（一许可一尝试） |
| 旧记录缺失 | 方法**必选**（不是可选）：漏转发的包装在**编译期**暴露，而不是让证据在内层被静默吞掉。不产生调用证据的适配器返回**空数组**——空数组表示「这个适配器不产生调用证据」，与「这次调用没有证据」是两件事。旧 `RuntimeRecord`（历史 journal）没有计量摘要 → 返回空，不回填、不推断，也不因此重跑 |

**已按必选方法逐个更新的实现与替身（8 处 / 6 个文件）**：`src/execution/worker-runtime/coding-agent-runtime.ts`（`start` 句柄已实现；`rejectBeforeStart` 句柄显式返回空）、`src/execution/worker-runtime/fake-runtime-adapter.ts`（`FakeRunHandle` 显式返回空）、`src/control/dispatch-engine/leased-worker-runtime.ts`（无条件转发）、`tests/contract-suite/console.contract.suite.ts`（转发）、`tests/contract-suite/p1-07-harness.ts`（`ParallelProbeRuntime` 返回空）、`tests/control/dispatch-drive.test.ts`（2 处返回空）、`tests/control/workspace-drive.test.ts`（返回空）。`tests/contract-support/*` 与 `src/harness/*` 内没有实现 `RunHandle` 的对象（`npx tsc --noEmit` 的报错清单即完整清单）。

`RunFactReceipt.applied` 的两个新值 `{kind:'model_request_authorized', permitId}` 与 `{kind:'model_request_attempted', permitId, attemptId}` 同样用五问：Control 写、调用方（Dispatch）读；作用是把「签发」与「尝试」在**回执层也分开**，不能相互替代；旧回执没有这两个值，语义不变。

#### 4.13.2 `DispatchSideFactFailure` 与 `DispatchDriveResult.sideFactFailures`（旁路事实失败出口）

| 五问 | 约定 |
| --- | --- |
| 谁写 | Dispatch（`DispatchEngineImpl.drive`）。三种旁路事实失败写这里：调用许可未签发（`permit_not_issued`）、调用证据未落账（`evidence_not_recorded`）、启动前失败收口再被拒（`prestart_closure_rejected`，见 §4.13.7） |
| 谁读 | 调用方/运维：`RuntimeDispatch.drive` 的返回结果、以及任何渲染 drive 结果的宿主。它**不**参与 `RuntimeDispatch` 的 `failed` 判定（那是 “带本 Run `outboxRef` 的派发失败”通道） |
| 何时固定 | 每次 drive 末次固定；缺省（无旁路失败）时字段**不出现**，ordinary-only 的调用方看到的形状逐字节不变 |
| 重放如何比较 | 不是命令载荷、不参与任何命令指纹；重复 drive 会重新产生一条（它是**观测**，不是幂等事实） |
| 旧记录缺失 | 旧调用方不看这个字段，语义不变（它们看到的 `failures` 与之前逐字节相同）。它**不能**被当作“这次派发失败”：已结束的 Run 不会因它改变终态 |

#### 4.13.3 受 owner 裁定的偏差与证据层次（**显式记录**，避免被读成漏了字段）

| 偏差 | 它**不是**什么 | 为什么 | 由谁携带 / 如何对齐 |
| --- | --- | --- | --- |
| `ModelRequestPermitV1` **没有** `contextInputDigest` | 不是“忘了加”，也不是“已核对” | 许可在 `runtime.start` **之前**签发，而 Context 摘要在 Runtime 内部 `assembleRuntimeContext` 之后才存在；Control 没有可独立重算它的 canonical 来源。写进去只能是调用方自证的值 | 该摘要由**证据**（`ModelRequestEvidenceV1.contextInputDigest`）携带，并由 A06 端到端用例与 `RuntimeContextManifest.inputDigest` 逐字节对齐（`tests/coordination/delivery-into-input.test.ts`）。要满足字面要求必须改成 **per-call 许可**（Runtime 侧往返等待 Control 签发），超出本票范围 |
| `ModelRequestPermitV1` **没有** `attemptId` | 不是“无法判定第二次尝试” | 签发时还没有调用尝试。“一次许可只对应一次尝试”由**许可聚合的两态**判定：@1 未消费 → 允许恰好一次；@2 已消费 → 任何再次提交都被拒（`run-facts.ts` 的准入分支 + 账本 CAS 各自独立拒绝） | attempt 由**证据**（`attemptId`）携带，并由许可的 `consumedByAttemptId` **反向固定**；绑定关系可从账本复原 |
| 每个 Run 只覆盖**首次**模型调用 | 不是“账本里没有这次调用” | 一次许可一条尝试；per-call 许可与 Runtime↔Control 往返超出本票范围 | 事实集只表达“被记录的那一次”；**读者不得把“1 条证据”读成“只调用了 1 次模型”**（后续调用没有证据，不是没有发生） |
| 没有 `acknowledgedAt` | 不是“ack 不重要” | 今天唯一可得的 provider 信号是计量里的 `MeterEntry.status = 'reported'`，它只说明“用量被报出来了”，**不等于** provider 对这次调用的可验证回执 | **证据层次（可执行）**：`authorized`（Control 签发，可核对 exact Run + 受理固定的 Delivery 版本）与 `attempted`（Runtime 在 `stream(request)` 边界算出请求摘要）**今日可执行**；`acknowledged` **今日不可得**，因此不立一个永远为 null 的字段（第 0 节“没有实际消费者的字段先不加”）。未来若绑定到可验证回执，再按版本化字段加入 |

#### 4.13.4 本轮缺陷修复（第 4 步 B）

| 缺陷 | 修复 | 证据 |
| --- | --- | --- |
| **A**：许可/证据这类**旁路事实**的失败走了“带 `outboxRef` 的派发失败”通道，`RuntimeDispatch.drive` 据此把该 Run 标成 `outcome_unknown`——**模型侧已经 `run_completed` 的 Run 被写成未知**（运维可见的观测记录与它自己的 trace 矛盾） | ① 旁路失败改走 `sideFactFailures`（不携带 `outboxRef`）；② `RuntimeDispatch.drive` 在 `markUnknown` **之前**核对 canonical Run：已 `ended` 就既不改写观测记录、也不写 `outcome_unknown` 事实。未结束的 Run 仍按既有语义对账（既有反例未放宽） | `src/control/dispatch-engine/dispatch-engine.ts`、`src/control/dispatch-engine/runtime-dispatch.ts`；用例 `tests/coordination/model-request-evidence-bypass.test.ts`（真实持久 SQLite + 真实 Control/Dispatch + 真实内核；断言 Run 仍 `completed`、旁路失败可见、许可仍 @1）、`tests/control/runtime-dispatch.test.ts`（`ended` 不改写 / `running` 仍对账 两条） |
| **B**：安全复核路径上的**空守卫**（`if (...) { /* 注释 */ void 0; }`）看起来在核对、实际不核对 | 删掉该分支，改成纯注释：写清“本函数只有 Run 引用、账本没有 (runId→workId) 反向索引，任何在这里做出的目标判定都是第二个猜测点”，并指明目标 Work 的判定由持有 Work 事实的调用方（`DeliveryMaterialCompiler.select`）负责 | `src/control/control-engine/run-facts.ts` 的 `admittedDeliveryPins`（原 `void 0` 分支已删除；同函数的无用 `permitRefFor` 局部量一并删除） |

#### 4.13.5 已记录接受的三处边界（owner 裁定，不改代码）

1. **只落首次调用证据 ⇒ 事实集不表达“还有未记录的调用”**（G4 / G5.b）。协议层面的读法约束：**“1 条证据”不可读作“只调用过 1 次”**。一次许可只对应一次调用尝试，因此一个 Run 的多轮模型调用里只有第一次留下事实；后续调用**没有证据，不是没有发生**。`dispatch-engine.ts` 里那条如实说明保留（`consumeModelRequestEvidence` 的文件头注释，含“只取第一条证据：其余调用不落调用证据”）。
2. **许可/证据事实不 CAS Run（G7 前半）——显式时序假设**：两条事实的提交只 CAS 许可聚合（`run-facts.ts` 的 `expectedVersions`），Run 侧的“exact Run / 未结束”判定发生在**读取时**（`authorizeModelRequest` 与 `runFact` 的守卫）。因此存在一个**窄窗口**：Run 在“读取通过”与“提交”之间结束，这时许可仍可能落账。影响范围（不夸大也不掩盖）：它**不**改写 Run 的终态（`RunSnapshot` 不受这两条提交影响，`runtime-dispatch` 也已加已结束守卫），也**不**放宽“一次许可一次尝试”；它只影响“许可的 issuedAt 一定早于 Run 结束”这条**顺序**保证，而该顺序在证据落账时由 `permit.issuedAt <= run.endedAt` 的时间守卫（`run-facts.ts` 的 `after_terminal` 例外）重新检查。按 D06 接受。
3. **`authorizeModelRequest` 每次派发全量扫描事件流找 admission（G7 后半）**：`admittedDeliveryPins` 分页扫描 `CommunicationAdmissionRecorded`（页上限 `MAILBOX_MAX_SCAN_PAGES`，读不完整即 `unavailable`）。这是**性能收尾项**，登记给第 5 步（本步不改）。

#### 4.13.6 `contextInputDigest` 的**验证上限**（owner 裁定：采纳 R3，明确降级）

**结论（已接受的上限，不是待办）**：证据事实里的 `contextInputDigest` 是**运行时自证观测**，
**没有任何 canonical 复核点**，与 `requestDigest` 同级。它只用于与 Runtime 记录/端到端用例做相关性
对齐，**不得**被读作「Control 已核对过这次调用的 Context 输入」。契约里这条上限写在
`src/contracts/dispatch.ts` 的 `ModelRequestEvidenceV1.contextInputDigest` 与 `src/contracts/ports.ts` 的
`ModelRequestEvidenceDraftV1.contextInputDigest` 旁。

**为什么必须降级而不是"再核一下"**：owner 最初指定的接法（读 Run 的 canonical 信封 manifest 里已有的
`inputDigest`）在本代码树上不成立，逐条实测如下：

| 原前提 | 实测（文件:行） |
| --- | --- |
| `RunSnapshot.envelope` 附带 manifest 且有 `inputDigest` | `RunSnapshot.envelope` 的类型是 `TaskEnvelopeV1 | null`（`src/contracts/dispatch.ts`）；`TaskEnvelopeV1`（`src/contracts/task-envelope.ts:25-46`）**没有** manifest 字段，只有 `bundleRef: ArtifactRef`（派发期 ContextBundle）与 sourceRefs/permissions/budget。**Run 快照里没有任何"已组装输入"的摘要** |
| `RunStartedEvent.payload.manifest` 里已有 `inputDigest` | 那个 manifest 是 `ContextManifestV1`（`src/contracts/task-envelope.ts:48-54`），字段只有 `selectedRefs` / `gaps` / `freshness`——**没有 `inputDigest`** |
| 证据的 `contextInputDigest` 有 canonical 来源可比 | 它是 `RuntimeContextManifest.inputDigest` = `artifactBodyDigest(input)`（`src/data/context-compiler/runtime-context.ts:189`），只存在于 Runtime 记录/local journal（`src/execution/worker-runtime/coding-agent-runtime.ts:166` 读 `r.context?.manifest.inputDigest`），**从不落账本** |

在 Control 内部重算它需要重跑整条 Context 组装（bundle 正文 + `spec.instruction` + 全部 runtime materials，
含 ReadModelIndex 来的角色材料）⇒ 等于造**第二个 Context 选材器**，被架构明令禁止。

**被否掉的两个增强方案（保留记录，避免以后重复讨论）**：

| 方案 | 内容 | 否决理由（owner 裁定） |
| --- | --- | --- |
| R1（reviewer 同构） | 把本次实际组装的输入写成内容寻址的 canonical 材料 + 证据带 `ArtifactRef`，落账前用 `artifactBodyDigest(读回内容) === contextInputDigest` 复核 | **不采纳**：给 `ControlEngineDeps` 加 ArtifactPort 会把 Control 变成能读正文的组件，而本票反复确认 Control 的边界是「只登记 ArtifactRef、不读正文」；为了一个好听的字段去动这条边界不值得。可复用的先例仍在（Reviewer 的 `ReviewInputBinding.inputDigest` 可复算：`src/contracts/reviewer-work.ts:20`、`src/data/context-compiler/reviewer-context.ts:207`、`src/control/control-engine/start-run.ts:88`） |
| R2 | 在模型调用之前落一条"Context 绑定"旁路事实，要求证据与它逐字节相同 | **不采纳**：多落一条旁路事实只让"单条事实篡改"暴露，验证强度提升有限，却增加一条事实种类 |

**上限被用例钉住（不是"知道但不管"）**：`tests/coordination/model-request-evidence-bypass.test.ts` 的
**T-A7** 显式断言「篡改 `contextInputDigest` 的证据事实**会被接受**」，用例名与断言 message 写明这是
**已记录的验证上限**；谁将来实现 R1/R2，这条用例会**主动失败**并指向本节，必须改写而不是删除。
原 G3 #2（"篡改被拒"）因此**不再作为待办**——它与 T-A7 是同一事实的两个方向，二者不能同时成立。

#### 4.13.7 启动前失败（调用许可未签发）的**收口**

许可未签发时**模型从未被调用**（可证明未调用，由 `permit_not_issued` 旁路失败共同表达）：既不能声称成功，
也没有终态信号——这正是**既有** `outcome_unknown` 事实的语义。因此由 **Dispatch 经 `control.runFact`**
写一条既有 `outcome_unknown` 事实给这次 Run 收口：**不新增事实种类、不改 `RuntimeEventType`、不假装 cancelled**。

| 五问 | 约定 |
| --- | --- |
| 谁写 | Dispatch（`closePrestartFailureBeforeModelCall`，`src/control/dispatch-engine/dispatch-engine.ts`）经 Control 的既有 `runFact` 入口写；Control 仍是唯一落账方 |
| 谁读 | 常规 Run 终态读取方（ReadModel/对账/运维）：Run 不再无终态地停在 `starting`。运维另从 `DispatchDriveResult.sideFactFailures` 看到 `permit_not_issued` |
| 何时固定 | 许可签发被拒的**同一次 drive** 内固定；reason 固定为「调用许可未签发，未调用执行能力（<拒绝码>）」 |
| 重放如何比较 | 事实命令带 runId 派生的 idempotencyKey（`p1-03-prestart-<runId>`）；已 `ended` 的 Run **不**再写（不覆盖终态） |
| 旧记录缺失 | 旧 Run 没有这条事实，语义不变；**不**为历史 Run 补写，也**不**自动重试这次调用（不确定就不重复调用） |

**收口本身被拒时可见**：`prestart_closure_rejected` 旁路失败（`DispatchSideFactFailure.code` 的第三个取值）——
"Run 可能仍无终态"这件事必须可见，不能静默。**不用** `runtime.rejectBeforeStart`：那是 RunHandle 上的操作，
此刻可能连 RunHandle 都不存在，硬套会为了满足形状而伪造一次"运行期崩溃"。