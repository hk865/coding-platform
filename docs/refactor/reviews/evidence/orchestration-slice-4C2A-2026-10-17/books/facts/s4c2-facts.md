只读核对完成；未改文件、未跑测试或构建。此目录没有 `.git`，HEAD 按你给定的 `5b445650` 标识。下文文件名均指当前树；`notes/、views/、tasks/、state/、communication/、model/、persistence/` 位于 `src/core/work-graph/`。签名省略异步结果外壳。

1. **当前落点与旧行号**

- **L20**：`src/core/agent-runtime/context-assembler.ts:165` 的 `renderContext` 管必需段、预算段及省略计数；`:417` 的 `goalPayload(goal,workspaceRevision,extensions)` 把全部 `notes.rows` 当理解，`:535` 的 `optionalRowsFromExtensions(extensions)` 又把同一批放进预算段。这两处规格行号仍准确。`:173` 还会按 key 重排，L20 的来源优先级必须贯穿到这里；`:976` 的来源记录取整个 `facts.sources`，尚不能证明“只记录实际渲染注记”。
- `views/context-extensions.ts:179` 的 `createContextExtensionsReader(deps)` 返回 `(ctx,request)=>ReadResult<ContextExtensionsV1>`；`:312` 仍返回空注记桩。契约仍为单一 `rows`，note 来源仍用 `node/revision`，不是 `anchorKey/version`（`src/contracts/graph-context.ts:42、72`）。接线点在 `src/composition/create-platform.ts:870`；注记核对器、读模型在 `:1308、1311`。
- **§11.5 三步读取**尚无成品函数。可沿 `tasks/plan-readers.ts:490` 的 `readLookupKeys(records,index,values)`、`:1246` 的 `readGoalRunsForCount(records,goalRef)`：索引分页→一次批量读 Run；第三步另批读 Reduction、已结束 Run 的 Requeue、处分来源计划。`readReworkRecords(records,runs)` 在 `:1343`，但 `:1355` 把 unsupported 当空，不能照搬。`readPlan(records,ref)` 在 `:440`，`readGoalPlanWindow(records,goalRef)` 在 `:969`；无计划合法返回在 `:976`，首次取消/取代时间的 `setIn` 追溯在 `:1995`。
- **缓存及旧路**：`views/note-views.ts:143、163` 已有每次调用的计划、目录、头、派生值、Run 范围等缓存；`checkHeads` 在 `:1138`，接收已有 `anchorSets/planWindows`，但每次调用重新建缓存和预算（`:1140、1152`）。`currentPlan(ctx,goalId,caches)` 在 `:387`；`updateDue:null` 在 `:1099`。`notes/note-read-model.ts:1177` 的 `understandingOf(ctx,anchor)` 独立读指针，`:1740` 由 lookup 调用，是要替换的旧路。`stale` 不可达 invalid 分支已经删除（`:2221`），无需再删。
- **Host**：循环在 `src/app/host.ts:1152`；当前仅 attention/inputConsumers 非空才启动，不能直接保证“每个配置工作区一次检查”。真实时钟仍在 `:1167、1168、1204`；待处理消息核对在 `:1182`，发送及失败重试在 `:1233、1241`。已有注入钟 `now?:()=>string`（`:150`）。`attention-observer.ts:718` 的 `pendingInputs:0` 和 `sessions/session-lifecycle.ts:321` 的墙钟归档均仍存在。
- **旧引用对应**：§11.5 的 plan-readers `514→490`（函数入口）、`1316→1343`、`1324→1355`、`974→976`、`1964–1978→1995–2009`；host `1164→1167`、`1201→1204`、`1238→1241`。§11.7 的 note-views `727/733` 已不是文件预算位置，现看 `:169、266`；note-machine `219–223` 的旧原因守卫已改为 `:316` 的实时原因。

2. **复用与接入形状**

- **U8 记忆材料**：已有项目头选择 `selectProjectHeader(ctx,projectId)`（`notes/note-read-model.ts:1274`），以及合并去重后一次核对的 `buildFindPage(ctx,entries,currentGoalId,anchorSets,firstPage,planWindows?)`（`:1307`）。它们目前是内部函数，并非通用材料端口。按裁定抽成“项目＋可选目标/阶段/任务→项目理解、规范、局部理解、一般索引、提醒”；无目标分支实现归6A。
- **§11.7 清单**：同文件已有 `headsByAnchorKey(records,projectId,anchorKey)`（`:218`）、`headInScope(head,input,goalId)`（`:889`）、`sliceByCursor(all,after,limit)`（`:803`）、`fitToByteBound(result,maxBytes,afterOf,cursorFor)`（`:769`）、`rankMatches(heads,terms)`（`:902`）、`encodeMemoryCursor/parseMemoryCursor`（`:684、691`）、`anchorExistsNow(ctx,anchor)`（`:489`）、`conflictingOf(projectId,head,cache)`（`:291`）；多数为内部函数，不能写成“直接 import 已公开接口”。
- 前缀扫描已是 `headsOnKeyPrefix(records,projectId,prefix)`（`notes/note-related-scope.ts:212`）；归属用 `pathOwnershipOf(path,candidates)`（`notes/note-path-ownership.ts:22`），不再导出旧 `moduleOfAnchor`。Run 索引在 `tasks/plan-readers.ts:89、91`；`decodeRunActivitySnapshot(record)` 在 `persistence/run-activity-codecs.ts:363`。格式复用 `renderNoteHeader(note)`（`src/contracts/note.ts:108`）、`renderUnderstandingBody(sections)`（`notes/note-service.ts:301`）。
- 核对签名为 `checkHeads(ctx,{items,anchorSets?,planWindows?})`（`model/note-contracts.ts:127`）。书记范围复用 `newScribeScopeCall()`、`managingScopeOf(ctx,head,call)`、`manages(ctx,sessionRef,scope,call)`（`notes/scribe-scope.ts:57、64、67`）；U10 收件人回退与投递壳仍需新增。
- **U6**：真正协调器是 `src/business/workflow/decision-actions.ts:225` 的 `resolveDecision(ctx,GraphWrite<ResolveDecisionInputV1>)`。①`:245` 独立提交答复；②`:254` 非目标冲突直接返回 answered，冲突才先查原回执、再落实；③`:324` 查正式回执并 `recordDecisionApplication`。失败保留 `application_not_recorded`（`:316`）。应按裁定抽成按 source kind 登记的 apply/proof/replay，再统一推进；当前没有该适配器及 `listUnappliedAnswers` 成品。
- **U7/L17**：`DecisionCardSourcePort` 目前只有 `kind/readPage(ctx,{workspace,goalRef?,page:{limit,cursor?,atLeastCursor?,attempt?}})`（`model/decision-contracts.ts:320`）。队列每个窗口共用 attempt（`views/decision-read-model.ts:269`），逐源翻到底（`:391`）；单卡仍逐页找（`:798`），目标依赖仍硬编码 `sourceNeedsGoal`（`:1248`）。施工书应按裁定登记集合读、稳定键、投影、关闭判断、needsGoal，并增加按键直读。现成“装一次再分页”样本在 `tasks/planning-question-reader.ts:141、213`；三个旧源迁移归清理C1。
- 卡源接线在 `src/composition/create-platform.ts:757`；`readSource` 的 note_review 仍 unsupported（`communication/decision-source-facts.ts:620`）。键直接用 `decisionSourceKey(identity)`（`src/contracts/goal-decisions.ts:176`）。已有 `finalizeCard` 顺序是取消→目标冲突专属完成判断→答复/落实（`views/decision-read-model.ts:885`）；注记需自己的“取消→已答→实时原因消失→待答”关口。
- **U3 证明**：`readApplicationReceiptFacts(records)` 在 `communication/decision-application.ts:79`；`:59` 解码仍仅 GoalSettingsChanged、PlanRevisionAccepted 两支。注记事件解码已有 `noteDispositionChangedEventFromEvent(event)`（`persistence/note-record-codecs.ts:609`），处置主体事件已最后写入，但 acknowledgementRef 固定 null（`notes/note-service.ts:1386`）。复用 `dispose`、`transitionNote`、`userReasonsOf`（`:1226`；`state/note-machine.ts:254、126`），增加卡落实入口及证明表行。
- **通知/U9**：当前成员通知来自给用户的 notify 消息（`views/decision-read-model.ts:967`）；自动返工、未送达回复由 `automatic-rework-notices.ts:69`、`undelivered-reply-notices.ts:59` 读事实投影，接线在 composition `:758`。按类已读位置已是 `noticeSeen:Partial<Record<NoticeCategoryV1,NoticePositionV1>>`（`src/contracts/goal-decisions.ts:54`）；队列仅用展示项生成位置/token（`decision-read-model.ts:523、539`），`markNoticesSeen` 校验落盘（`configuration/decision-settings-service.ts:127`）。U9 应在此接纯分组投影，保留成员身份及实际展示位置。

3. **施工书必须补定的最小问题**

- **端口归属**：`NoteUpdateDuePort`、`NoteDecisionSourcePort`、`applyNoteDecision` 尚未声明/实现；现有注记端口边界见 `model/note-contracts.ts:110、126`。最小选择是各自放入规格指定的 model 契约后注入，或先建内部接口再由相同契约导出；不能让 notes 导入 views。
- **被覆盖理解如何关卡**：`userReasonsOf` 对 structural understanding 无条件返回 structural（`state/note-machine.ts:130`），不能单靠“原因空”实现D-12。最小选项：卡源/提醒共享“被覆盖”判定，或把该事实纳入共同原因判断。
- **卡落实如何复用处置**：现 `dispose` 只在“有矛盾且无用户原因”时接受 resolution（`notes/note-service.ts:1320`），直接转调会拒绝用户卡；关系改写也只取 contradictedTargets（`:1315、1332`）。最小选项：共享内部处置核心增加可信卡模式，或卡入口构造同一状态迁移；必须覆盖 replaces 与 contradicts 的合并目标。
- **证明字段如何补齐**：注记事件只有 head/version/acknowledgementRef（`persistence/note-record-codecs.ts:73`），通用证明要求 actor、前后版本变化（`decision-application.ts:53、126`）。最小选项：事件增加标准 proof，或注记 decoder 从同提交记录及答复 pins 还原并校验。
- **通知历史从哪里分页**：版本已有 `change/by/at/since`（`src/contracts/note.ts:88`），现 NoticeItem 没有折叠成员字段（`model/decision-contracts.ts:258`）。最小选项：按不可变版本建读索引，或写独立通知事实；分组成员放内部投影或扩展返回契约。项目主体继续按裁定留给6B。
- **时钟/启动条件**：使用现有 ISO `now` 转毫秒，或增加毫秒钟；检查循环独立启动，或扩充当前启动条件。依据为 host `:150、1152、1167`，无需改 attention 算法。

4. **测试变动范围**

- 装配夹具形状要改：`tests/runtime/S3-context-assembler.test.ts:268、632`；新增C-01～04及G-01下一次准备断言。CA14“未注入扩展”断言（`:802`）及 `tests/work-graph/S3-graph-context.test.ts:1067` 应保留，不一律翻成 available。
- 真实接线的“note_review未接入”应消失：`tests/composition/WP2-wiring.test.ts:465、623`、`tests/scenarios/WP2-wiring-scenario.test.ts:80`。孤立缺源夹具 `tests/work-graph/S5-decision-queue.test.ts:142`、`WP2-context-extensions.test.ts:372` 只有接入新源时才改。
- §11.8交4C-2：PU-03、M-12a～h、D-01～03、D-18；D-04/05/06/08/09/11/12/13/17的卡部分，D-10计数及D-15提醒部分。已有写入断言继续保留，如 `S4C-note-protection.test.ts:128、175、237`。项目 updateDue=null 断言 `S4C-project-understanding.test.ts:91` 不改。
- §5.3心跳需增提醒、换收件人、失败重试覆盖；旧 attention 去重/处理位置行为保留（`tests/app/orchestration-mechanism.test.ts:51、83、331`）。§11.8所列4A/4B写入、过滤改动归4C-1，不重新承包；M-09空且complete仍有合法断言（`S4B-memory-paging.test.ts:108、123`）。

5. **生产行数估计**

L20/U8约400–550；触发读取、折叠及缓存约300–400；U10/Host提醒约300–450；注记卡、落实及证明约350–500；通知/U9约200–300；先建设U3/U6/U7另约200–350。合计约 **1,750–2,550行**；若K3先交共享部分，约1,550–2,200行。相比约1,400，主要增量是公共适配器、证明接入和通知历史分页；不含测试、文档或C1旧源迁移。