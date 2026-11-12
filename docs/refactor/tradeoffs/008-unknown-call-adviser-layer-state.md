# 008 结果未知分两层：第一层是记录的新状态 `awaiting_advice`，不是 `needs_decision` 上的字段

状态：采用（7D2 K3L-1，2026-11-12）
日期：2026-11-12

## 背景和约束

- 用户 11-12 定：做了一半、判断不了、自查可能崩溃（第一次）这几种结果未知，先交参谋定；只在机械条件下问人（HANDOFF 121-109）。记录要能表达“参谋在看，人还不用管”。
- 今天出卡、能答、Workflow 的 UR6/UR7、重启第 3 种、`applyDisposition` 全按记录状态判：卡源只列 `needs_decision`/`awaiting_approval`（`src/core/work-graph/views/decision-read-model.ts` 的 `UNKNOWN_CALL_REVIEW_CARD_STATUSES`），门按状态分支（`src/business/workflow/task-gate.ts` 的 UR7），落实时按状态核阶段（`unknown-call-review-service.ts` 的 `applyDisposition`）。
- L17 的 12 种原因和顺序是已冻结的形状，很多测试整组断言它；升层原因不能塞进去。
- 人随时能“我来处理”；连续计数、返工上限、预算三道护栏不变。

## 选项

| 选项 | 怎么做 | 好处 | 坏处 |
|---|---|---|---|
| **A. 新状态 `awaiting_advice`（选）** | 第一层写 `awaiting_advice` 和 `advice{phase, answer}`；升到人时回到 `needs_decision`/`awaiting_approval`，写 `escalation{cause, suggestion}` | 按状态过滤的五处自动不出卡、不能答；`open` 照旧推导；“我来处理”和重启只各加一个状态 | 状态闭集多一个值，codec、列表、重启要认它 |
| B. `needs_decision` 加一个 layer 字段 | 状态不变，字段说明是参谋层还是人层 | 状态闭集不动 | 卡源列表、按键读、来源事实、门、落实至少五处要另加过滤；漏一处就会把参谋层的记录当成人的卡 |
| C. 定稿后再升一层 | 照旧写 `needs_decision`，Workflow 之后再改成参谋层 | 定稿代码不动 | 每份记录多一次写；大量测试的版本号会变；中间有一段时间卡会出现又消失 |

## 选了什么，为什么

选 A。分层是“谁在等”的事实，正是状态该表达的东西；按状态判断的地方都不用改就对。没有参谋时定稿直接写 `needs_decision` 加 `escalation{no_adviser}`，比今天不多一次写。去处只由一个纯函数 `unknownCallReviewRouteOf` 判，五个定稿出口、批准和参谋答复落实都调它。

## 代价，以及因此要守的规矩

- **去处只有一份规则：** `state/unknown-call-review.ts` 的 `unknownCallReviewRouteOf`；别处不另写“这个原因归哪层”。
- **升层原因只放 `escalation`，** 不进 `decisionReasons`。
- **第二层的卡由 `escalation` 是否存在决定，** 卡的投影只在 `unknown-call-review-card.ts` 一处。
- **`advice`、`escalation`、`streak.priorAdvised` 都是可选字段，** 旧记录照读；`priorAdvised` 只在为真时写，记录的字节不因它变。
- **参谋处置的重排不算人确认过的重排**（`requeueConfirmedByReview` 对来源 `adviser` 和参谋批的方案回 false）。

## 什么情况变了要重新考虑

- 出现第三层（例如参谋之上还有一层自动判断）：再加状态不合适时，改成“状态 + 层级”二元组，但卡源和门要一起改。
- 参谋层的记录需要出现在人的队列里（例如只读的“参谋在看”条目）：那是读模型新加一个只读来源，不是把状态改回 `needs_decision`。

## 来源

- 用户决定 11-12（HANDOFF 121-109、121-110）；lead 对包计划的裁定（`k3-layering-rulings-1112.md` 第 1–3 条）。
- 包计划 §5-1、§5-3、§5-4。
