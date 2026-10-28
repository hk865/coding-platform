# src/core/work-graph/communication：决定答复与 Session 邮箱的事实 owner

## 负责什么，不负责什么
- 负责：决定答复（`answerDecision`）、已答复决定的应用证明/记录/回放、`DecisionSourceV1` 的正式来源重建，以及 SessionMailbox 的发信（`sendMessage`）、回复（`respondMessage`）、撤回（`withdrawMessage`）、释放（`releaseMessage`，允许/拒绝两臂）、收件箱/发件箱与两个视图读、ack、consultation 派生、accepted input、wait 处置。
- 依赖只允许 `model, state, persistence, materials, sessions, queries, tasks` 和 `RecordStore` 端口；另只在 `decision-source-facts.ts` 和 `decision-source/types.ts` 以类型引用 `WorkspaceToolsPort`（可选的文件摘要 seam）。不得 import `notes`、`evidence`、`views`、`agent-runtime`、`app`、`business`、`composition`。
- 消息状态（status/readAt/response/acceptedInputs/derivation）只由 `state/message-machine.ts` 的纯迁移和记录构造器写；本层收集事实、guards、effects，再走一次 RecordStore 提交。
- 消息正文字节只存 MaterialPort，状态与事件走 RecordStore；不另建消息中间件、第二份历史或第二个写入路径。
- 不启动 Agent、不唤醒/抢占 Session、不改占用或归档生命周期；不判断 Task/Goal 完成。生命周期写仍只经 `src/core/work-graph/state/`。
- 读失败原样返回，不折成空收件箱、空来源或“没有读者”。

## 文件
- `decision-service.ts` — 决定答复 owner：`answerDecision`、`recordDecisionApplication`、`readDecisionAnswer`，加消息 pin 读、应用回放与工具提交查询；项目卡的答复消息存项目 `subject` 且 `goalRef: null`，答复的唯一占位按整个项目算（各工作区都列出同一张项目卡）。
- `decision-source-facts.ts` — 从正式记录重建决定来源的 Goal/对象/选项/pins/closed/允许读者，并接应用证明读法；`subject` 的形状先在这层检查（先于任何 Goal 读），Goal subject 读它的 Goal，项目 subject 不读 Goal、只接 `note_review` 分支（越界项目 `forbidden`）；canonical source 的 subject 按分支读到的事实重建（Goal subject 取分支实际读到的 Goal，项目 subject 取绑定的项目），不照抄调用方的。
- `decision-source/` — 每种来源一个 handler，每个返回完整分支事实；原文件保留工厂、共同前置检查、分派、最终 pin 复核与结果组装。`message-release.ts` 是 `message_release` 来源：消息记录、它的 Goal 与卡片事实（`tasks/message-release-card.ts`），派生块是读的 DTO，不在分支事实里。
- `decision-application.ts` — 只从正式 receipt/event 证明一次已记录的决定应用（事件白名单，拒绝调用方自报版本）；导出共用的正式回执检查 `readFormalReceiptEvent`，以及四个 effect 行共用的 `decodeProofEvent`/`EffectProofV1`（party、post-effect version、acknowledgement）。
- `message-apply.ts` — 应用一条消息的事实 owner：`createMessageApplyOwner` 返回 `MessageApplyPort`（`applyMessage`），读 `MessageApplyInput`（`messageRef` + `ApplicationProofV1`）的 `MessageApplyDependencies`（回执/消息读、唯一写入 `prepare`、本提交的时钟），先做形状检查，再复用 `readFormalReceiptEvent`/`decodeProofEvent` 比较回执与 effect，最后走唯一消息写入的 `prepare` 与 `messageWriteResult`；事件沿用写信人的 actor（D8-16 (c)），`appliedAt` 取 effect 的时间。
- `mailbox-service.ts` — 完整的 `SessionMessageCommandPort` 实现（窄的 `SessionMailboxPort` 加四个写命令与两个视图读）与唯一消息写入 facade（body → record → event → receipt 一次提交）；`createRecipientExecutions` 在 `sessions/recipient-executions.ts`，给撤回读收件方未结束执行；消息读带派生的释放块，发件箱按页项收集同序的 `releaseBlocks`（收件箱为 `null`），`releaseBlockOf` 是这两处唯一的派生（已批准、未撤回、未释放才派生；没有 dispatch basis 读时 `unsupported`）。
- `message-release.ts` — 放行 owner 与有界候选读：`createMessageReleaseOwner` 返回 `releaseApproved`（R2 命令 `message.releaseApproved`：机器判定、Goal 活动、`action_request` 的 pins 与依据、一次提交写释放伴随记录）和 `readReleaseCandidates`（一个工作区或一个 Goal 的候选页，按批准时间升序，每项带当前阻塞原因）；撤回的消息跳过，读失败原样返回。
- `copy-retraction.ts` — 复制取消的两个模型端口（`CopyInterventionReadPort`/`CopyInterventionRetractionPort`）的实现：按 Goal 的 `continuedFrom` 索引读副本、分页读来源干预，撤回走 mailbox 的 `withdrawMessage`；只读记录，失败是拒绝不是空页。

## 可以复用的能力
| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `createSessionMailbox` | `src/core/work-graph/communication/mailbox-service.ts:1525` | 完整的 `SessionMessageCommandPort`：发信、回复、撤回、释放（allow 两臂）、两个视图读，加读消息/正文、收件箱/发件箱、ack、consultation、input、wait 处置、未送达/已路由回复与工具回执查询；消息读/发件箱带一页同序的派生释放块（`releaseBlockOf`），收件箱为 `null` | 组合根装配 `platform.messages` 时；不要另写发信或分页 |
| `createMessageWriteOwner` | `src/core/work-graph/communication/mailbox-service.ts:4883` | `storeBody` + `persist` + `prepare`：唯一正文存储、消息提交与准备片段路径（replay、CAS、event、claim 同一套） | 任何要写 SessionMessage 的 owner；不要绕过它直接 commit |
| `createMessageReleaseOwner` | `src/core/work-graph/communication/message-release.ts:85` | 放行 owner：`releaseApproved` 走 R2 命令 `message.releaseApproved`（`action_request`/`inquiry` 两臂（后者承接 `decision_request`）、Goal 必须 active、`action_request` 的 pins 与依据、与 send 相同的释放伴随记录），加 `readReleaseCandidates` 的有界页（批准时间升序、撤回跳过、`readThrough` 是页自己的水位） | 7A-2 L 把它发布成 `messageRelease`；内部放行与候选读只用它，不要另写提交或分页 |
| `mapReadResult` | `src/core/work-graph/communication/mailbox-service.ts:180` | 读结果到 `CoreRejection` 的映射（`not_found` / `not_ready`；`ready`/`rejected` 原样）；`message-release.ts` 的放行与候选读复用 | 读记录后要把失败转成写拒绝时；不要另写私有副本 |
| `releaseCandidatePageInput`、`releaseCandidateBlockedReason` | `src/core/work-graph/communication/message-release.ts:299`、`:313` | 候选页输入的唯一检查（`limit` 1–100，光标按 `goalId` 解码，跨 Goal 是 `invalid`）与单项阻塞原因的纯投影（Goal 非 active 是 `goal_not_active`，`action_request` 的 pins 不符是 `stale_pins`，其余 `null`；从不是 `activity_conflict`） | 候选读内部，以及消息读/发件箱/卡片的同一份阻塞投影；不要另写页输入检查或阻塞判定 |
| `createRecipientExecutions` | `src/core/work-graph/sessions/recipient-executions.ts:66` | 读收件方的未结束执行与账本 horizon，供撤回的开放执行窗口判定；读失败原样返回 | 撤回 owner 判定能否撤回时；不要另读执行或自己拼 horizon |
| `createDecisionMessageService` | `src/core/work-graph/communication/decision-service.ts:198` | 答复决定、记录决定应用、读回答复、读消息 pin、应用回放、工具提交查询；项目卡答复的 `readSource.goal` 与消息 `goalRef` 都是 `null` | 组合根装配 `platform.decisionMessages` 或工具适配时 |
| `createDecisionSourceFacts` | `src/core/work-graph/communication/decision-source-facts.ts:103` | 从正式记录重建 `DecisionSourceV1` 的 Goal、objects、options、pins、closed 与允许读者；读应用证明；`subject` 形状先检查，Goal subject 读 Goal，项目 subject 不读 Goal、只服务 `note_review`（越界项目 `forbidden`），分支不再解 subject；canonical subject 按分支读到的 Goal 或绑定的项目重建 | 答复/卡片前必须证明来源真实时；不要从 `views` 读一手事实 |
| `messageReleaseChangeProof`、`decodeMessageReleaseProofEvent`、`MessageReleaseApplicationDependencies`、`createMessageReleaseApplication` | `src/core/work-graph/communication/decision-change-proof.ts:32`、`:48`、`:63`、`:72` | B-13 应用证明的构造、证明事件的解码（P 的证明表），以及可信内部入口 `createMessageReleaseApplication`（输入只有 `answerRef`，把证明写进释放决定） | L 发布 `applyMessageRelease`、G-late 的恢复、P 的证明表读它；不要另写释放证明 |
| `MESSAGE_RELEASE_OPTIONS`、`messageReleaseAllowOf`、`messageReleaseAnswerFacts`、`messageReleaseAnswerCommand`（**已移出**本文件夹） | `src/contracts/goal-decisions.ts:157`；`src/core/work-graph/tasks/message-release-answer.ts:19`、`:36`、`:60` | 放行卡的两个选项 id（正本在 C：`tasks/` 不许 import `communication/`）、allow 判定、答复事实与答复派生的 R2 命令字段；`decision-change-proof.ts` 的可信入口从 `../tasks/message-release-answer.js` 引用，不再留副本 | 可信入口、未应用答案读取与卡来源都从这里取；不要在本文件夹重建这些派生 |
| `createCopyInterventionPorts`、`CopyInterventionPortsDependencies` | `src/core/work-graph/communication/copy-retraction.ts:60`、`src/core/work-graph/communication/copy-retraction.ts:33` | 复制取消的两个模型端口实现：读来源干预按页（keyset 游标、副本集合取自 `continuedFrom` 索引）与撤回一条（走 mailbox 的 `withdrawMessage`/`readMessageView`）；只读记录，失败是拒绝不是空页 | 组合根或 C-b 的 copy owner 装配这两个端口时；不要另写适配器 |

## 内部用

- `mailbox-service.ts` 导出、只供本层其他文件复用（同一份代码不另写副本）：单条消息读 `readSessionMessageRecord`（邮箱的 `loadMessage` 也只调它）；send 与候选读共用的 `releasedMessageCompanions`、`basisConflictCurrent`、`readProgress`（空 `readThrough` 报最小水位）；以及 `MailboxPrincipal`、`messageVersionAgainstReceipt`、`releaseDecidedResult`、`releaseDecidedChange`、`messageWriteResult`、`Owned`、`OwnedContext`、`ownContext`、`judge`、`refusalOf`、`sameBasis`、`dispatchCurrentOf`、`basisPinsOf`、`eventIdOf`。
- `readApplicationReceiptFacts`、`readFormalReceiptEvent`、`decodeProofEvent`、`readSavedAnswerReaderSessions`；类型 `DecisionMessageService`、`SessionMailboxWithUserSend`（`SessionMessageCommandPort` 的交叉类型扩展）、`DecisionSourceFactsDependencies` 只描述上面的端口。`readApplicationReceiptFacts` 只供本层的来源事实工厂接线，`readSavedAnswerReaderSessions` 只供 `decision-service` 读回已保存答案的读者。
- `decision-source/goal-conflict.ts` 里的私有 `CONFLICT_OPTIONS`（`wait`/`order`/`parallel` 三个固定选项）与 `views` 的同名导出重复，正本待 lead 定。

## 不要做
- 不要信调用方给的 `source.pins`、`actualVersions` 或“已应用”断言；来源、pins 与证明都从正式记录重建。
- 不要把失败的读折成空来源/空收件箱，也不要给缺失的读者一个默认值（FP-05、MH-06）。
- 不要另写消息写入或重放路径：`createMessageWriteOwner` 是唯一 body+record+event+receipt 写入；重放读原始 event，不用今天快照重建（M1-25、M1-26）。
- 不要自己造状态记录或直接改 status/readAt/response；用 `state/message-machine.ts` 的迁移（AGENTS 第 9 条、M1-01）。
- 不要另写 Session/Message ref 校验或聚合 key；用 `sessions` 的 codec 与 `sessionAggregateRefKey`（M1-31）。
- 不要把发送当成唤醒/占用/任务义务，也不要在本层关闭 Session、Run 或 Task（M1-36）。
