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

**已补齐（continuation-04）**：后继准备现在逐字节核对 admission 的 declaredPermissions、RoleBinding 和 admittedWorkRef。原发现为：`successor-run-preparation.ts` 对 admission 只交叉核对了 `roleBinding` 与 `admittedWorkRef`，**没有**核对 `declaredPermissions`；协议 1.2 要求「消费同一份绑定」，已要求补 fail-closed 核对。

### 4.7 `RoutePageProposalV1.subscriptionScope`（`src/contracts/coordination.ts`）

第 4 步「持续路由」的生产者字段：**本轮固定的订阅范围 = 整轮候选集合**，不是本页切片。

| 五问 | 约定 |
| --- | --- |
| 谁写 | Dispatch 的 `CoordinationDrive.buildPage`：回声源事件提交事务已固定的候选订阅范围（按 canonical ref key 升序） |
| 谁读 | Control 的 `buildRoutePage`（首次固定 / 逐字节复核 / 收敛掉已取消订阅）与 `buildRoutePageCommit`（落进 settled intent 的 domain）；账本 `validateCommunicationRoutePageCommit` 的第 12/18/19 条（本页不得引入范围外订阅 / 续页范围逐字节相同 / hasMore 与下一页 intent 一致） |
| 何时固定 | 源事件提交事务；翻页原样保留范围。已取消订阅仍占页位置，跳过投递并推进页位置，不重新扫描引入新订阅 |
| 重放如何比较 | 它是 `CommunicationSettleCommand` 载荷的一部分，因此进入 `communicationSettleFingerprint`：同一条命令重放要求逐字节相同，不同即 `idempotency_conflict`；账本侧按 canonical ref key 逐条比较 |
| 旧记录缺失 | 旧形状的页（没有该字段）在 `checkRoutePageProposal` 处**直接判非法**——**不**补猜成空数组（协议约束 2.4：不补猜值后继续）。历史 intent 上的 `subscriptionScope: []` 保持可读，驱动对它仍按「本轮尚未固定」处理 |

### 4.8 `RouteIntentPlanV1` 与 `routeIntentPlans`（`CommunicationCommitBase` / `CommunicationSuccessorClaimCommitV1`）

第 4 步「可路由事件与待路由 intent **同事务登记**」的载体。

| 五问 | 约定 |
| --- | --- |
| 谁写 | Control：`routeIntentPlanFor(...)` → `withRouteIntentPlan(batch, plan)`，在 `DirectedRequestSent` / `DirectedRequestResponded` / `WorkParticipationEnded` / `WaitConditionSatisfied` 四个可路由源事件的提交上写入；**账本**（`materializeRouteIntentPlans`，两个适配器共用一份）在同一个事务里展开成 `CommunicationIntentRecorded` 事件 + `CommunicationIntentSnapshot@1` + 对应 CAS@0 |
| 谁读 | 唯一消费者是**账本适配器**（展开）；展开后的意图由 Dispatch 通过 `CommunicationIntentRecorded` 读到，成为持久路由触发器 |
| 何时固定 | 与源事件**同一次提交**内固定。`sourceCursor` 由账本按 anchor 事件在本次追加序列中的落点算出（`makeCommitCursor(firstSeq + anchorIndex)`），intentId 由协议同一个算式 `routePageIntentIdFor` 派生 |
| 重放如何比较 | 该字段**不在**命令载荷里，因此不参与任何命令指纹；同一提交重放时账本返回原回执、不再展开。命令异载荷按命令指纹拒绝；计划是 Control 派生值，重放不按新扫描重新展开 |
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

### 4.11 调用前绑定与逐请求许可（continuation-04 当前口径）

本节取代 snap-03 的“每 Run 首次调用、结束后补 attempted、不 CAS Run、摘要允许篡改”口径。原文原样保存在产品证据 continuation-04/protocol-before-continuation.md；变更来自用户批准的 FOLLOWUP-PLAN 第 4 步。Control 不读取正文、不创建第二个 Context 选材器。

| 字段 / 端口 | 谁写 | 谁读 | 何时固定 | 重放比较 | 旧记录缺失 |
| --- | --- | --- | --- | --- | --- |
| RunSnapshot.inputBinding / RuntimeInputBindingV1：schemaVersion、inputDigest、manifestDigest、materialAccessRefs、deliveryRefs | Runtime 组装真实输入并保存 manifest 后经 ModelCallAccess.bind → Control runtime_input_bound | Control 每次许可/attempt；账本复核；后继与审计 | 本 Run 首次实际调用之前，Run CAS 原子落账且仅一次 | 整体 canonical JSON 比较；异值拒绝，不重选 Delivery | 历史 Run 可读；新许可没有绑定即拒绝，不从日志猜补 |
| ModelCallAccess.bind / beforeCall；WorkerRuntimeAdapter.start 的 access 参数 | Dispatch 注入，LeasedWorkerRuntime 无条件转发，ObservedModelRun 调用 | 实际 ModelClient.stream 边界 | 输入组装后 bind；每个最终 outgoing 请求计算摘要，签发并消费许可成功后才调用 provider | 同 Run+requestId 派生确定性 permitId；attempt 只有 fresh committed 才进入 provider | 旧 Query/Reviewer/Handoff 等入口仍按各自旧协议；普通 Task/本票后继必经此入口，不自动宣称全路径迁移 |
| ModelRequestPermitV1：requestId、requestDigest、contextInputDigest、manifestDigest、deliveryRefs、permissions、consumedByAttemptId、consumedAt | Control authorizeModelRequest 写 @1；runFact 写 @2 | 调用前准入、账本/审计 | 签发时固定 exact Run、最终请求摘要、绑定、admission Delivery 及当前权限；消费仅增加 attempt 标识/时间 | @0→@1→@2；消费需要新提交，重放不执行外部动作；许可不能复用 | 历史缺字段可读但不能授权新调用；缺许可不补发 |
| ModelRequestEvidenceV1 requestDigest/contextInputDigest/deliveryRefs/permitId/attemptId/observedAt（requestId、manifestDigest 从同事件的 permit 读取） | Runtime 在实际调用边界计算，经 Control 在调用前登记 attempted | Ledger、投影、输入与调用证据核对 | 与 permit 消费同事务，Run/RolePolicy/Grant/Delivery 精确版本作 CAS 守卫 | 摘要或绑定异值拒绝；同许可第二次消费拒绝；已结束/取消/暂停不允许新 attempted | 无记录不等于无调用，旧观测不回填 |
| RuntimeContextMaterials 的 deliveryGrantRefs / assertCurrent | WorkMaterialDrive 从正式 grant 结果与固定选材产生 | Runtime bind / 每次 beforeCall 之前的来源与正文授权重读 | 精确 grant refs 固定；assertCurrent 是进程内回调，逐请求执行 | 不重新选材料；重核固定来源、正文、授权和当前适用版本 | 无协作材料可为空；有 Delivery 缺合法 grant 即失败 |

许可和 attempted 不推进 Run revision，但同事务 CAS 守卫读取到的 Run、当前角色策略、材料授权/Delivery 版本。运行生命周期消费者读取最新 revision 并有限重试，不能因并发旁路事实而丢终态。RuntimeInputBound 自身推进 Run revision。

摘要证明“宿主记录的输入与本次最终请求绑定一致”，不证明模型理解、正文业务结论或源码多文件原子快照。Host 重读来源/正文；Control 复核 exact references、权限、撤销和摘要绑定。provider 可验证回执尚不可得，不写 acknowledged；计量 reported、Runtime completed 均不冒充 provider ack。attempted 是调用前持久门禁，门禁后立即崩溃可能记录尝试而 provider 尚未收到；此窗口按未知隔离，不声称恰好一次远端执行。

RunHandle.pollModelRequestEvidence 与历史草稿读接口保留供旧观测/兼容调用者使用；本票 ordinary Dispatch 不再在 Run 结束后从计量补写首次 attempted。sideFactFailures 仍可读，模型调用前的准入失败走实际 Runtime 失败事实，不把已完成 Run 降级。

### 4.12 执行代际、取消与正式对账

| 字段 / 端口 | 谁写 | 谁读 | 何时固定 | 重放比较 | 旧记录缺失 |
| --- | --- | --- | --- | --- | --- |
| DispatchStartCommand.payload.executionConsumerId；RunSnapshot.executionAuthorization { generation, consumerId, phase }；RunStarted.payload.executionAuthorization | ordinary Dispatch 每实例生成 consumerId；Control start 原子生成 authorized | Dispatch、Control execution_entered/retry、Ledger、Runtime 恢复 | start 时生成代际；调用任何 Runtime adapter 之前必须新提交 entered | authorized→entered 仅 exact owner/generation；旧领取者不能进入；start replay 不执行。只有 authorized 未消费可撤销到 revoked，随后下一代际 | 旧 start/Run 保持旧恢复语义；不能由旧记录推断无副作用或自动重跑 |
| RunFact execution_entered / ExecutionEntered | 当前 Dispatch consumer 经 Control | Ledger 守卫、Runtime 调用门禁、投影 | CAS 在 Runtime 入口前消耗授权 | 重放/旧代际零副作用；Run 取消/暂停拒绝 | 缺事实不授权已采用该协议的新 Run |
| RunFact execution_retry / ExecutionRetryScheduled {run,attempt,outbox,reason} | 可信 Runtime 恢复经 Control | 唯一 outbox drive、Ledger、两套投影 | 原子撤销未进入的代际、同一 Run/TaskAttempt 还原 pending 并退避 | 检查 authorized、没有 inputBinding/公开事件、尚未结束且未取消；不可重开 ended/entered Run | 旧记录不具备证明，不用 prepared+无日志猜测可重试 |
| DispatchOutboxEntrySnapshot.schedule {attemptCount,availableAt,lastFailure,quarantined} / DispatchDeferred | Control，消费 Dispatch 的已知入口前失败或已撤销执行代际 | pending 查询与 drive、诊断 | 每次可证明无副作用的失败；指数退避，最多五次后隔离 | 原记录 CAS，TaskAttempt 身份不变；重放不增加计数 | 无 schedule 按旧 pendingAt 就绪；没有因缺字段新增累计预算 |
| SubmitControl 同事务的 RunSnapshot.controlState；RuntimeReconciliationPort.cancel | Control 先持久 desiredState；恢复/操作入口再请求 Runtime | 模型每次准入、执行入口、Runtime 恢复 | 取消意图早于执行能力；未进入 prepared Run 可产生真实 run_cancelled | 重复取消不覆盖完成；异常只记录实际支持/未知结果 | 缺 cancel 能力显式 rejected，不伪造 cancelled |
| ReconcileRunCommand / ControlEngine.reconcileRun / ControlEngineDeps.runtimeObservation | system 只请求检查 exact Run；可信 Host journal 提供观察，调用方不提交证明 | Control、账本、RuntimeDispatch.recover、投影 | 仅 ended/outcome_unknown 的独立转换，不放宽 ordinary runFact after_terminal | exact terminal event/Run/sequence/digest；重复观察零写入，不能重开 Run | 缺可核实终态即 quarantine，不推测成功 |
| RunSnapshot.reconciliation { status, observation, recordedAt } / RunReconciled.payload.run | Control 正式对账，Run 与必要 TaskAttempt 同 CAS | 恢复结果、Run 读取、两套投影 | 可核实终态→done/cancelled；无证据→quarantined | 保持 Run ended；随后可追加真正获得的终态证据；旧普通事实仍不得覆盖终态 | 旧 unknown 无元数据仍可读；恢复首次检查并显式隔离 |
| ReconcileCommunicationIntentCommand / communication-intent-reconcile | 唯一 CoordinationDrive 请求，Control 读取当前 intent | Ledger、backlog | unknown 或 sideEffectStarted 且租约过期，无可验证外部回执→quarantined | 精确 prior + CAS；只改变隔离状态/原因/时间，保留 owner/generation/domain；ordinary settle 终态拒绝不放宽 | 旧 unknown 可正式隔离；没有“到期即已无副作用”的默认值 |
| RecoveryResult.scheduledRetries / quarantined | RuntimeDispatch.recover | Host 及故障恢复断言 | 每轮从已提交结果派生 | 派生输出，不是第二调度记录 | 省略为空；rejected 与隔离仍明确分开 |

不创建第二个执行队列。授权撤销证明的是“这一代际从未进入 Runtime”，不是“日志看起来为空”。entered 后即使尚未出现模型调用也不自动重试；外部动作后丢回执保持未知并对账或隔离。Run 对账中的 done 是运行结果已知，不是 Task/Goal 业务完成，也不等于 provider ack。

### 4.13 持续路由、并发及预算字段

| 字段 / 端口 | 谁写 | 谁读 | 何时固定 | 重放比较 | 旧记录缺失 |
| --- | --- | --- | --- | --- | --- |
| RouteIntentPlanV1.scopeMode='canonical_active' | Control 声明；Ledger 在源事件追加事务枚举当前 active Subscription | 路由 intent、Control/页校验 | sourceCursor 与全部订阅范围同事务固定，杜绝先读后写遗漏 | 重放使用原提交；scope 不随翻页重选 | 旧显式范围保持其历史边界，不补猜当时订阅 |
| SubscriptionV1.catchup {intentRef,horizonCursor}；subscription_catchup domain {subscriptionRef,startCursor,scanCursor,horizonCursor}；SubscriptionCatchupAdvanced | Ledger 在 SubscriptionCreated 同事务生成；Control 每页推进 | CoordinationDrive 与两套 Ledger 校验 | null start 固定到真实创建位置；指定历史 start 时固定唯一 horizon，单 intent 每页最多扫描 512 事件 | 单订阅跨 topic 顺序前进；每页原子 Delivery/checkpoint/intent/wait；live 路由等历史前缀完成 | 旧无 catchup 的记录不补历史；无进展/超界扫描报 incomplete，不当全量 |
| AdmitWaitSuccessorCommand.payload.intentClaim {intentRef,consumerId,leaseGeneration,revision} | 领取 wait_admission 的 Dispatch | Control 及 Ledger 事务守卫 | 领取回执时固定；受理时复核仍是当前未过期领取者 | 旧代际/owner 拒绝，不能借用新领取者；无 intent 的直接受理 CAS@0 防并发新建 | 旧命令只有确无 admission intent 时可直接受理；存在 intent 缺字段即拒绝 |
| DispatchEngineDeps.maxConcurrentRuns | 组合根/测试配置，默认 2，上限 32 | 唯一 ordinary drive 的并发池 | 每次 drive 配置，仍由既有 WorkspaceLease 排斥写者 | 无额外持久调度状态；start CAS 防跨进程重复 | 缺省 2；不是新增 token/时长/调用数累计预算 |
| CoordinationBacklog.oldestPendingIntent / blocked[{intentRef,status,reason,availableAt}] / incomplete | drive 从 canonical intent 重建，blocked 最多 32 项 | Host/运维/验证 | drive 之后读取；扫描不完整显式 incomplete | 最老项按创建时间诊断；可执行项按最近进展事件顺序公平轮转，固定时钟也前进 | 无持久迁移；旧输出调用者可忽略新增诊断 |
| DispatchFailure.effect='none' | Dispatch 对 Runtime 入口之前被拒绝的路径标记 | RuntimeDispatch 对账 | 本次明确失败边界 | 不将旧/其他未知失败推断为 none | 缺值按潜在已执行保守恢复 |

分页、deadline、admission、取消恢复、隔离均消耗有限 drive 预算；普通 outbox 仍独立得到推进机会。未知/隔离源事件阻塞本作用域后续 checkpoint，其他工作仍可推进。有限样例公平性不是无限负载下的吞吐保证。

### 4.14 协调能力模型（第 3 步）—— 字段与端口五问

| 字段 / 端口 | 谁写 | 谁读 | 何时固定 | 重放比较 | 旧记录缺失 |
| --- | --- | --- | --- | --- | --- |
| `COORDINATION_CAPABILITY_ID` / `CoordinationCapabilityGrantV1` / `CoordinationCapabilityDecisionV1` / `CoordinationRuntimeGrantV1`（`src/contracts/coordination-tools.ts`） | 不落账、不持久：宿主**执行前**解析（`resolveCoordinationCapability` / `coordinationRuntimeGrant`） | `LeasedWorkerRuntime.start`（决定是否注入工具）；`CodingAgentRuntime`（决定是否向内核声明能力并记录授予） | 本次 Run 启动**之前**一次；依据是账本事实，运行期不重解析 | 不参与账本幂等；同一 Run 重放由同一批 canonical 事实得出同一结论（确定性） | 缺参与关系/缺受理参与关系 → `not_granted` + 可读原因（fail-closed，不补猜身份） |
| `RuntimeRecord.coordinationCapability?`（`src/execution/worker-runtime/coding-agent-runtime.ts`） | 运行入口：**仅 granted 时**写入该 Run 的持久运行记录（journal） | 审计 / 恢复扫描（`RuntimePreparationPort.all()` 的消费者） | 运行开始时写入一次，之后只读 | 不参与命令幂等；同一 Run 重放会重建同一值（来源是 canonical 事实） | `undefined` = 没有这条授予记录；**不回填不推断**，可用性永远以执行前准入为准 |
| `ToolDefinition.platformEffect: 'coordination_state'`（平台自有工具定义附加字段，**非账本字段**） | 平台工具工厂随工具定义一起给出（内核 metadata schema 是 loose，附加字段被保留） | 用例断言声明与能力一致；后续宿主授权可据此筛选 | 工具定义创建时（编译期常量） | 不参与幂等 | 字段缺失 = 该工具不是平台状态写入工具；**不会因此获得任何能力**（授权仍只来自 `hostAuthorizedTools`） |

**决策记录（owner 裁决）**：
- **不新增 effectClass**（如 `platform_state_write`）。理由：内核的放行判据始终是 `hostAuthorizedTools.has(tool)`，新增取值只换标签、**不改变准入强度**，却要再动三个内核文件并重建 dist。现状以平台自有 `platformEffect` 补足语义，缺口如实写进 `coordination-tools.ts` 文件头与 `vendor/coding-agent/INTEGRATION.md`。
- **协调能力授予不落账**，保持「由账本事实可推导 + 随 `RuntimeRecord` 持久化」。理由：它由账本事实唯一确定，落账会是**同一批事实的第二份副本**（协议第 0 节「没有实际消费者的字段先不加」）。
- **真正的准入点在平台侧**：`coordination-tool-access.ts` 的 `capabilityDenial(operation)` 在每个写操作的**第一行**执行，**早于 `vault.put`、也早于任何 Control 命令**；校验授予与本次 Run/参与关系逐字段一致、依据在账本里读得到且仍 `active`、AgentInstance 一致；任一不成立 → 零写入拒绝，不降级成只读成功。用例 4 用**计数 Vault 包装**证明 `vault.put` 调用次数 = 0。
