# src/core/work-graph/communication/decision-source：每种决定来源一个 handler

## 负责什么，不负责什么

- 负责：`DecisionSourceV1` 每种来源一个 handler，从正式记录重建该分支的完整事实（`goal`、`objects`、`options`、`pins`、`goalBases`、`closed`、`allowedReaderSessionRefs`）并返回。handler 不共同修改外层变量。message、planning question、goal conflict、note review、unknown call review、command rerun request 六种 handler 收外层已收窄好的 Goal（`goalRef` 参数；note review 也收 `null`，即项目 subject 的无 Goal 分支），自己不解析 `subject`；goal cause 与 candidate 从身份里的 `goalRef` 读自己的 Goal。
- 不负责：公开工厂 `createDecisionSourceFacts`、共同前置检查、按 kind 分派、`message_release` 拒绝与未知 kind 默认、最终 pin 复核、guards 与结果组装；这些仍在 `communication/decision-source-facts.ts`。本文件夹不 import 该文件。
- 分层：仍属 `communication`，依赖只用 `model`、`state`、`persistence`、`materials`、`sessions`、`queries`、`tasks` 和 `RecordStore` 端口；不得 import `notes`、`views`、`evidence`、`agent-runtime`、`app`、`business`、`composition`。注记审查只经注入的 `NoteDecisionSourcePort` 读。
- 读失败、缺依赖、认不出的值原样返回或拒绝，不折成空来源；handler 不做自己的写入，也不加共同读取之外的 store 读取。

## 文件

目录按来源种类拆分；下表列出每个文件的导出与职责。

| 文件 | 导出 | 职责 |
| --- | --- | --- |
| `types.ts` | `DecisionSourceBranchFacts`、`SourceReadResult`、`EncodedRecordOutcome`、`SourceReadSupport`、`SourceDependencies` | 分支结果、共享读支持与可选 owner 端口的形状；只有类型；`DecisionSourceBranchFacts.goal` 在项目 subject 为 `null`（不读 Goal 记录）。 |
| `read-support.ts` | `createSourceReadSupport`、`readStoredDecoded`、`SAVED_ANSWER_READ_TEMPLATES`、`ReadRecordTemplates`、`Scope`、`clonePins`、`samePinSet`、`goalBasis`、`isAbsencePin`、`isGoalPin`、`isUserRecipient`、`sameJson` | 唯一的记录读取/解码协议、两套错误模板、scope 检查、pin 克隆/比较/复核与 Goal basis；`sameJson` 从 `contracts/fingerprint.ts` 再导出（正本）。 |
| `message.ts` | `readMessageSource` | message 来源的完整分支事实。 |
| `goal-cause.ts` | `readGoalCauseSource` | goal cause 来源的完整分支事实，含原因白名单与正式原因核对。 |
| `candidate.ts` | `readCandidateSource` | candidate 来源的完整分支事实。 |
| `planning-question.ts` | `readPlanningQuestionSource` | planning question 来源的完整分支事实，含 QueryRun 读者读取。 |
| `goal-conflict.ts` | `readGoalConflictSource` | goal conflict 来源的完整分支事实，含 footprint、Goal 终态与固定冲突选项。 |
| `note-review.ts` | `readNoteReviewSource` | note review 来源的完整分支事实；Goal 为 `null` 时读无 Goal 的注记卡（`goalId: null`）；先按注记自己的 subject 比对（卡开着、关了都先比），别的 subject 的注记拒绝。 |
| `unknown-call-review.ts` | `readUnknownCallReviewSource` | unknown call review 来源的完整分支事实。 |
| `command-rerun-request.ts` | `readCommandRerunRequestSource` | command rerun request 来源的完整分支事实。 |

## 不要做

- 不要在 handler 里另写记录读取、解码、scope 检查或 pin 比较；用 `createSourceReadSupport` 和本文件夹的纯 helper。
- 不要把失败的读折成空来源或默认读者；拒绝原样返回。
- 不要自己解析 `subject` 或另写取 Goal 的 helper：Goal 只由 `communication/decision-source-facts.ts` 收窄一次再传进来（项目 subject 传 `null`）。
- 不要从 `views` 读一手事实，也不要 import `decision-source-facts.ts`。
