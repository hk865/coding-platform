# src/core/work-graph/knowledge：代码知识文件的唯一写入顺序

## 负责什么，不负责什么
- 代码知识落在每个工作区根的 `.workbench/` 里（`architecture.json`、`modules/<fileId>.json`、`notes/<workspaceId>/<noteId>.md`）；文件是知识。这里只有一件事：架构和注记的每个写点按同一个顺序写——取项目全部线，进写队列，拿每个检出的跨 Host 租约，服务在 `prepare` 里读当前知识、规划、校验、算出文件改动，连同每个改动一条写日志提交记录，提交成了才逐个原子落盘，落了盘的日志再补成完成，最后建索引、放租约。
- 回放的回执（`replayed`）不写新日志、不碰文件；记录提交了而文件没写成，照实回“记录已提交、知识文件没写成”，不当成功，没落盘的日志留 `pending`。
- 不读写磁盘：读写文件和租约目录的是组合根（`src/composition/line-knowledge.ts`）实现的 `LineKnowledge` 和 `KnowledgeWriteDeps.acquireLease`，端口在 `model/line-knowledge.ts`；文件格式在 `architecture/architecture-file.ts` 和 `notes/note-file.ts`。
- 依赖 `model`、`persistence`、`state`（`docs/refactor/module-target.json`）：写日志和完成事件的 codec 在 `persistence/knowledge-record-codecs.ts`。`architecture`、`notes` 依赖本层，放进这里的文件不得 import `architecture/`、`notes/`，否则成环；要用那两层的规则（携带事件、路径种类、模块号）经 `KnowledgeWriteDeps.files` 注入（`notes/knowledge-files.ts`）。

## 文件
- `knowledge-write.ts` — 一次知识写的顺序 `writeKnowledge`、检出租约 `withKnowledgeLeases`、写点交回的提交 `knowledgeCommit`、文件没写成时的原因 `knowledgeFilesNotWritten`，以及 `KnowledgePrepared`/`KnowledgeWriteOutcome`/`KnowledgeWritePlan` 等形状。读线之后整个 `prepare`、提交、落盘、补完成和索引都在 `write.queue.run(projectId, 排好序的 folder)` 和每个检出的租约里；测试缝 `write.hold` 不为 null 时在提交之后（`committed`）、全部落盘之后（`applied`）各停一次；全部落盘后一个索引事务交 `write.indexFile`，注记文件再记 `setNoteState`，这一步出错吞掉、不改写入结果。
- `write-log.ts` — 写日志：`writeLogExtras` 给每个文件改动出一条 `pending` 的 `KnowledgeWrite@1`（守卫“必须不存在”、`since` 绑到携带事件的下标），并进写点的同一次提交；`completeKnowledgeWrites` 一次提交把一组日志补成 `completed`（每条按读到的 revision 守卫，带一个 `KnowledgeWritesCompleted@1`，身份是排好序的 writeId）；`completeLandedWrites` 读回落了盘的日志再补完成；`markKnowledgeWritesUnconfirmed` 同样一次提交把对账交给人的 `pending` 日志改成 `unconfirmed`（带一个 `KnowledgeWritesUnconfirmed@1`）。补完成失败不改变调用者的结果。
- `reconcile.ts` — 一条线的知识对账 `reconcileKnowledgeLine(write, line, trigger)`（kls-design §2.2.5、R18、R22）：在写队列和这条线的检出租约里，读 `line.readKnowledgeFiles()` 的完整清单和 git 状态，和索引上一轮比；R18：这条线 `pending` 的写日志文件等于写后就补完成，否则（还没有恢复项时）出一个 `write_unconfirmed` 恢复项、日志改成 `unconfirmed`，`unconfirmed` 的日志文件后来等于写后也补完成；R22：变或删的路径回到旧内容（删了、等于 HEAD 或更早的快照）就是撤回，恢复内容取上一轮内容的快照、没有取最新一份；这一轮读到 `pending` 或 `unconfirmed` 写日志的路径照常分类、建索引，但不算撤回（不标待核实的仍只是 `pending` 的路径）；恢复项先写进快照库、再出一条项目通知（`knowledge_write_unconfirmed`、`knowledge_reverted`，summary 只带个数，身份是种类、线和按路径排好的项）；这个通知身份已经有恢复项，就不再加项、不再通知，结果里的 `reverted` 只数这一轮新加的；新、变、删的路径一个索引事务交 `write.indexFile`，不是平台刚写的注记标待核实（已提交 `merged`，否则 `external_edit`）；第 8 步 `write.conflictsOf` 判这条线模块文件之间的冲突，每轮都用第 1 步读到的同一份字节拼一次整图（`line.architectureOfDisk`，不再读盘，一轮只看一个磁盘状态；stk16：人在一轮中途改的文件曾多出一条通知），读不成的原因记在 `architecture.json` 名下（这条线从来没有 `architecture.json`，现在没有、上一轮索引里也没有，是没有图，不算问题）；读不成的文件和冲突合出一条 `knowledge_conflict` 项目通知（`conflictNoticeOf`：身份是按路径排好的问题和冲突，同样的问题不重复通知；summary 是“知识文件有 n 处问题：”加去重排好的路径，n 是路径数，截到 512 字节）；三种通知的身份同一个算法；最后给未提交的文件存快照、干净且和上一轮相同的清快照，记对账时间，删平台留下的 `*.tmp-*`。目录读不了整轮 `unavailable`、不动索引和文件。
- `ops.ts` — `createKnowledgeOps(lines, asks)`：`platform.knowledge` 的实现，`reconcile(ctx, workspaceId, trigger)` 取这个工作区当前检出的线交给 `reconcileKnowledgeLine`；结果有冲突时，按 `asks.regionAdvisersOf`（组合根接：记录里最后采用的那份 catalog 读一次，有效区域参谋也认）给每个冲突模块的区域参谋发一条系统 `action_request`（要回复，正文列路径和原因、点名 `propose_architecture_revision`），发信人固定是 `knowledge-conflict` 系统身份、工作区是被对账的那个，请求号由（参谋、模块、通知）算出，同样的问题每位参谋只收一次；没有参谋或读失败不发，只有通知。不管哪个触发调的都在这里发：`reconcile` 是 `createKnowledgeOps` 里的局部函数，恢复之后的 `'recovery'` 对账也调它（b2 F-9）。`recover(ctx, {noticeId, itemNo})`、`recoveryItems(ctx, {noticeId})` 是两条恢复路由的端口，路由把输入原样转来，在这里核（`noticeId` 非空字符串、`itemNo` 从 1 起的整数，不对回 `invalid`），再交给 `recover.ts`。
- `recover.ts` — 人点“恢复”（[2C1-19]、[2C1-20]）和读一条通知的恢复项（[2C1-23]）。`recoveryItemsOf` 按 noticeId 读本项目快照库的恢复项，只给 `{itemNo, kind, path}`，一项都没有回 `not_found`（别的项目的 noticeId 在这里也读不到）。`recoverKnowledgeItem` 先读恢复项（没有回 `not_found`），按恢复项的 `lineRef` 找工作区和它当前检出的线，在写队列和这条线的租约里：线的键对不上回 `revision_conflict`（“检出的分支已经变了”，勘误 2c1#15）；当前文件的 blob 不恰好等于 `expectedBlob`（都不在也算等）回 `revision_conflict`；`write_unconfirmed` 读写日志、按它的 `since` 调 `records.eventAt` 读那一个事件，经 `write.files.knowledgeFileOfEvent` 以当前文件为底重建，重建不出或 blob 不是 `afterBlob` 回 `unavailable`，不猜；`reverted` 取它选中的那份快照。原子写（`applyChange`）之后补完成日志、经 `indexLanded` 当平台自己的写建索引（勘误 2c1#6）、删这一行恢复项（通知照旧在）；放开队列和租约之后、返回之前，经调用方给的 `reconcileLine` 对这个工作区对账一次（`'recovery'`）。不重跑 service、不写业务事件，失败照原样回、不重试。回 `{path, blobSha}`（删除时 `blobSha` 为 null）；不写业务记录，`cursor` 取恢复之后记录库读到的位置。只有这里读事件（[2C1-21]：读路径永不 `eventAt`）。
- `write-queue.ts` — 进程内写队列 `createKnowledgeWriteQueue`：先项目键、再排好序的 folder 键，调用时同步登记全部键，先来先走、不会死锁；不替代 CAS。Host 只建一个，经 `knowledgeWriteQueue` 交给每个项目的平台。

## 可以复用的能力
| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `writeKnowledge` | `src/core/work-graph/knowledge/knowledge-write.ts:79` | 取项目全部线 → 队列 → 租约（拿不到回 `unavailable`，`prepare` 不调）→ `prepare`（返回 `exit` 就原样交回，什么都没提交）→ 要改的线有 `pending` 写日志就回 `unavailable`“有未确认的知识写”（`unconfirmed` 不挡，2c-1d）→ 连同写日志提交 → 不是 `committed` 回 `rejected` → `replayed` 不碰文件 → 逐条线、逐个改动 `applyChange`，第一处失败就停 → 补完成 → 索引 → 放租约 | 新的架构或注记写点；不要自己先提交再写文件，也不要在别处另写这个顺序 |
| `withKnowledgeLeases` | `src/core/work-graph/knowledge/knowledge-write.ts:143` | 在写队列里按 folder 排序去重逐个拿检出租约；别的 Host 持着或租约目录建不了就放掉已拿的、回 `unavailable`（原因分开写），不等、不重试；`finally` 放租约 | 写入、对账、恢复都在队列里经它拿租约；不要另写 |
| `completeKnowledgeWrites` | `src/core/work-graph/knowledge/write-log.ts:93` | 一组写日志一次提交补成 `completed` | 写入落盘后、对账见文件等于写后时、恢复成功后；不要另写这次提交 |
| `pendingKnowledgeWrites`、`KNOWLEDGE_WRITE_UNCONFIRMED` | `src/core/work-graph/knowledge/write-log.ts:33`、`src/core/work-graph/knowledge/write-log.ts:24` | 给定的这些线上全部 `pending` 写日志（逐条线经 `[projectId, lineRef, state]` lookup 和 `lookupAll` 读完、解码）：在途的写，或文件可能没落盘的写；`unconfirmed` 不在里面（已交给人，文件为准）。在途时读和写给的原因“有未确认的知识写” | 当前架构的读（`readCurrentCatalogWindow`，它读的各工作区当前那条线，只算架构和模块文件）、注记读窗（`prepareNoteFiles`，同样的线，只算它读的那些注记的文件）、写入顺序拒写（改动的那条线，全部种类）（2c-1d，lead 合并后裁定：读和写都按线判，别的分支上的 `pending` 不挡当前检出）；不要另写这个查找 |
| `withSnapshots` | `src/core/work-graph/knowledge/reconcile.ts:53` | 本项目快照库用一次：SQLite 开文件、用完关，抛错回 `unavailable` | 对账、恢复、读恢复项都经它；不要另写开关 |
| `reconcileKnowledgeLine` | `src/core/work-graph/knowledge/reconcile.ts:40` | 一条线的一次对账（队列和租约里；R18、R22、索引、待核实、坏文件和冲突通知、快照） | 提交后、加入时的对账都调它；不要另写对账步骤 |
| `conflictNoticeOf` | `src/core/work-graph/knowledge/reconcile.ts:217` | 一轮问题和冲突的 `knowledge_conflict` 通知身份和 summary | 对账发通知、`ops.ts` 算参谋请求号都用它 |
| `createKnowledgeOps`、`KnowledgeConflictAsks` | `src/core/work-graph/knowledge/ops.ts:38`、`src/core/work-graph/knowledge/ops.ts:23` | `platform.knowledge` 的实现和冲突请求的两个依赖 | 组合根建一次，经 `trackedCall` 发布；冲突的 `action_request` 只在这里发 |
| `recoverKnowledgeItem`、`recoveryItemsOf` | `src/core/work-graph/knowledge/recover.ts:44`、`src/core/work-graph/knowledge/recover.ts:29` | 人点恢复一条恢复项；读一条通知的恢复项 | 只有 `ops.ts` 调；不要另写恢复的核对和写回 |
| `indexLanded` | `src/core/work-graph/knowledge/knowledge-write.ts:171` | 落了盘的文件一次索引事务建行、注记确认新 blob；抛错不改答复 | 写入落盘后和恢复写回后；不要另写索引这一步 |
| `knowledgeCommit` | `src/core/work-graph/knowledge/knowledge-write.ts:62` | 写点的 `ready.commit`：把最终顺序的事件交给 `extrasOf`、并进同一次提交；提交抛错（含找不到携带事件）记进 `thrown`，回 `unavailable` | 每个写点组好 `PreparedCommit` 后交回它；服务按 `thrown` 走自己原来的“按身份重查” |
| `knowledgeFilesNotWritten` | `src/core/work-graph/knowledge/knowledge-write.ts:75` | 记录已提交、文件没写成时给人的原因（带路径） | `files` 回 `rejected` 时；不要另写这句 |

## 内部用
`KnowledgeWritePlan`、`KnowledgeCommitExtras`、`KnowledgeExtrasOf`、`KnowledgePrepared`、`KnowledgeWriteOutcome`、`KnowledgeCommitThrow` 是本层的形状；`writeLogExtras`、`completeLandedWrites` 只有 `writeKnowledge` 调，`markKnowledgeWritesUnconfirmed` 只有对账调。

## 不要做
- 不要在 `prepare` 外读规划要用的当前知识，也不要在提交前写文件。
- 不要把文件写失败吞掉或当成功；不要重试。
- 不要拿写前 blob 和索引比，也不要另存读依据：读当前知识和规划都在租约里的 `prepare`。
