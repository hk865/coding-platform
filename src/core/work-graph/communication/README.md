# src/core/work-graph/communication：决定答复与 Session 邮箱的事实 owner（L6）

## 负责什么，不负责什么
- 负责：决定答复（`answerDecision`）、已答复决定的应用证明/记录/回放、`DecisionSourceV1` 的正式来源重建，以及 SessionMailbox 的发信、收件箱/发件箱分页、ack、回复、consultation 派生、accepted input、wait 处置。
- 依赖只允许 `model, state, persistence, materials, sessions, queries, tasks` 和 `RecordStore` 端口；另只在 `decision-source-facts.ts` 以类型引用 `WorkspaceToolsPort`（可选的文件摘要 seam）。不得 import `notes`、`evidence`、`views`、`agent-runtime`、`app`、`business`、`composition`。
- 消息状态（status/readAt/response/acceptedInputs/derivation）只由 `state/message-machine.ts` 的纯迁移和记录构造器写；本层收集事实、guards、effects，再走一次 RecordStore 提交。
- 消息正文字节只存 MaterialPort，状态与事件走 RecordStore；不另建消息中间件、第二份历史或第二个写入路径。
- 不启动 Agent、不唤醒/抢占 Session、不改占用或归档生命周期；不判断 Task/Goal 完成。生命周期写仍只经 `src/core/work-graph/state/`。
- 读失败原样返回，不折成空收件箱、空来源或“没有读者”。

## 文件
- `decision-service.ts` — 决定答复 owner：`answerDecision`、`recordDecisionApplication`、`readDecisionAnswer`，加消息 pin 读、应用回放与工具提交查询。
- `decision-source-facts.ts` — 从正式记录重建决定来源的 Goal/对象/选项/pins/closed/允许读者，并接应用证明读法。
- `decision-application.ts` — 只从正式 receipt/event 证明一次已记录的决定应用（事件白名单，拒绝调用方自报版本）。
- `mailbox-service.ts` — `SessionMailboxPort` 全实现与唯一消息写入 facade（body → record → event → receipt 一次提交）。

## 可以复用的能力
| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `createSessionMailbox` | `src/core/work-graph/communication/mailbox-service.ts:1045` | 发信、读消息/正文、收件箱/发件箱、ack、回复、consultation、input、wait 处置、未送达/已路由回复与工具回执查询 | 组合根装配 `platform.messages` 时；不要另写发信或分页 |
| `createMessageWriteOwner` | `src/core/work-graph/communication/mailbox-service.ts:3627` | `storeBody` + `persist`：唯一正文存储与消息提交路径（replay、CAS、event、claim 同一套） | 任何要写 SessionMessage 的 owner；不要绕过它直接 commit |
| `createDecisionMessageService` | `src/core/work-graph/communication/decision-service.ts:200` | 答复决定、记录决定应用、读回答复、读消息 pin、应用回放、工具提交查询 | 组合根装配 `platform.decisionMessages` 或工具适配时 |
| `createDecisionSourceFacts` | `src/core/work-graph/communication/decision-source-facts.ts:258` | 从正式记录重建 `DecisionSourceV1` 的 Goal、objects、options、pins、closed 与允许读者；读应用证明 | 答复/卡片前必须证明来源真实时；不要从 `views` 读一手事实 |

## 内部用

- `readApplicationReceiptFacts`、`readSavedAnswerReaderSessions`；类型 `DecisionMessageService`、`SessionMailboxWithUserSend`、`DecisionSourceFactsDependencies` 只描述上面的端口。`readApplicationReceiptFacts` 只供本层的来源事实工厂接线，`readSavedAnswerReaderSessions` 只供 `decision-service` 读回已保存答案的读者。
- `decision-source-facts.ts` 里的私有 `CONFLICT_OPTIONS`（`wait`/`order`/`parallel` 三个固定选项）与 `views` 的同名导出重复，正本待 lead 定。

## 不要做
- 不要信调用方给的 `source.pins`、`actualVersions` 或“已应用”断言；来源、pins 与证明都从正式记录重建。
- 不要把失败的读折成空来源/空收件箱，也不要给缺失的读者一个默认值（FP-05、MH-06）。
- 不要另写消息写入或重放路径：`createMessageWriteOwner` 是唯一 body+record+event+receipt 写入；重放读原始 event，不用今天快照重建（M1-25、M1-26）。
- 不要自己造状态记录或直接改 status/readAt/response；用 `state/message-machine.ts` 的迁移（AGENTS 第 9 条、M1-01）。
- 不要另写 Session/Message ref 校验或聚合 key；用 `sessions` 的 codec 与 `sessionAggregateRefKey`（M1-31）。
- 不要把发送当成唤醒/占用/任务义务，也不要在本层关闭 Session、Run 或 Task（M1-36）。
- `sameJson` 另有旧副本：`src/core/work-graph/communication/decision-source-facts.ts:125`（私有），正本在 `src/contracts/fingerprint.ts:50`，新代码一律用正本，旧副本由清理轮删除。
