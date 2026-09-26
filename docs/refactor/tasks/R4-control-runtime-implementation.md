# R4.3a：持久控制接到实际执行（Stage2 已导入）

状态：2026-09-27，R4.3a已由root审阅、最后暂停守卫修正、独立原四目标4/4 + types与原基线audit后精确导入8个生产文件，冻结测试未变。后续R4.3b共享终态投影也已[导入](../reviews/evidence/next-b2-2026-09-26/r4-terminal-history-implementation-import.json)，取消后同Session下一正式Task已通过；fresh resume/冷恢复仍未完成。§5–9保留审阅与修正历史，R4.3a最终证据见§10。

前态：2026-09-26，骨架两份真实流程测试已中审冻结并按原基线精确导入，13 个生产骨架文件已独立放行。固定四目标均在 deliverControl unsupported 首红，types pass；三处局部测试 amendment 已完成，无新增 case。见 [中审返修](R4-control-runtime-middle-repair.md)与[导入证据](../reviews/evidence/next-b2-2026-09-26/r4-control-runtime-skeleton-import.json)。主审已授权按以下八文件 scope fresh prepare，并启动新的 DSH 4.1F 实现会话；不得在原骨架 lane 继续实现。

唯一领域契约为 [R4 §11.2–11.6](R4-control-recovery-skeleton.md#112-controlintentsnapshot1-的兼容扩展)，骨架发布的DTO/公开接口保持。实现仅写 [八生产文件](R4-control-runtime-implementation-scope.json)，全部测试、contracts、ports、composition、model-call service、Query、Kernel与其他路径只读。骨架导入并冻结最终测试hash后从fresh main新会话执行；不安装依赖，不另建Engine/状态表/扫描器。

## 1. 同一个控制owner与事实写入

control-service/codecs 扩原 queued snapshot 的 read validator、Observed事件/encoder/decoder/schema，并实现内部 recordControlObservation。Submit专用事件仍仅queued@1，submit同请求返回原queued回执，不拿当前applied拼回执。观察者是原Runtime，公开platform.controls仍只有submit/read。真实原entry、Session/Kernel/Run/Turn身份与原history区间来源由原authority/codecs核对；不要求已结束Run仍有占用，不读freshRole/material/activePlan。

expected恰为intent与Run的局部pin，独立identity前缀与完整规范fingerprint；先恢复原receipt，fresh提交同事务写intent snapshot＋原完整Observed事件，不修改Run/Session/Lease。当前Run控制指针已换则保留旧观察并标superseded，不能释放新cancel。错误提交结果未知时沿同key有界恢复，未找到不能声称未写或安全重新执行。

## 2. 一个私有live handle与两种完成证据

execution-control.ts 仅承接已有driver/observer的私有协调。内部handle必须保留完整RunRef、原TaskEntryPermit/claim代次、固定Kernel binding、独立AbortController和实际消费的intent。键必须完整身份，不把序列化失败降级为只用runId。私有类型可在本文件/原消费者内细化，不改公开契约、不造持久控制owner。

**Kernel调用已经退出＋全部owned resources确已关闭**与外层 `startRun`/事实收尾Promise分别处理，避免observer等待包含自身的同一done而死锁。前两证据在原runObservedModel调用返回及finally回调中实际记录；公开observe与driver收尾读取同一证明，不只在driver尾部等待。全程收尾挂在原被tracked的公开Promise内，不另发后台Promise；单独deliver的signal取消不取消执行收尾。

真实deliver先按受信Host完整scope读取原intent，再匹配固定live handle；无匹配仍返回原queued，不猜停止/不新启动执行。重复deliver不造第二Run/Turn；若正式已有观察读回该记录。pause在真实before_model或group barrier生效；cancel仅向自己的controller投递。控制后到安全点从原sourceAuthority精确Run读current controlState，无控制时continue；missing/unknown不能用缓存假放行。此处不重跑全Plan/Attempt/材料链，新模型/领域工具原fresh准入各自保留。

## 3. 进入事实与原observer

execution-entry-service 仅去掉 recordExecutionEntered 中后来fresh Host/Role读取和guard；保留原permit、claim、Run/Kernel/Session/Lease身份与history来源、replay/CAS。其他authorize/begin/model准入屏障不变。

driver记录真实turn.started/run.started后补entered，再做before_model控制。begin后真实control导致旧Run pin revision_conflict时，读同一entering binding并有界用新pin重试原事实；响应未知先用原请求找回执，不随意换fingerprint。收尾signal独立，enteredFailure也不能绕过已发生事实核对；没有真实来源则保留未确认，不伪造entered/terminal。

同原observer分页、reducer、locator供Run事实与control观察共享；不另扫Session历史。ack eventId/sequence来自原payload.event.meta，position来自该原SessionRecord，intent关联来自确实消费它的live handle，不把任意pause归给最新指针。

- pause：无active model/running/unknown，允许尚未开始的pending下一组；真实pause＋调用退出＋cleanup完成后applied；不写Run ended、不推进完成cursor、不释放。
- cancel：原terminal配对且无未知副作用，清理完成后沿原recordRunResult结束/同代释放，再记真实cancel观察。自然completed/failed/limit先结束标terminal_without_cancel/superseded，不改自然outcome。
- outcome_unknown：检查原toolBatch及正式transcript error.code，空toolBatch不等于已知；保留occupancy/locator并记录可证实unknown，绝不applied cancel。
- Run已ended后补ack：按原terminal locator恢复同一来源，不重写结果、不新调模型。清理失败/来源缺口保持unknown/queued，不能改成成功。

R4.3b abandoned多组取消的历史投影另批已准备；本批保留它的真实未闭合边界，不删除严格配对来临时放行。冷owner、resume预算和维护仍R4.4/5，不开完整capabilities。

## 4. 固定验收与STOP

冻结测试：`tests/runtime/R4-control-runtime.test.ts` SHA-256 `2c2e7de19376361c66e37c44fbc8c4c0e494f6013e70b438eb761524996a3ef5`；`tests/composition/R4-control-runtime-platform.test.ts` SHA-256 `bdd0ae471ed54ac873a3a3556bff39956a5dfff9f12a72cfad33af5f52d8ca84`。两文件与全部其他测试只读，不因实现困难弱化真实来源或最终行为。实现自检 `next-control-runtime`、`next-types`，涉及原未控制路径的必要邻接只用原 `next-control-intent next-runtime-execution next-b2-material-admission` 一次；若实现修改未触及其路径则复用已通过的骨架61项证据。主审独立有界review/audit/目标验证后精确导入，整合时再一次物理隔离。

先让已冻结四条实际流程走通，修实际权限/事实/副作用缺陷；不额外扩竞争/重启/Role热换矩阵。交付八文件hash、实际执行与原历史ack/占用结果及限制后STOP。不自行改测试或推进R4.3b，不把信号已发当停止证明。

## 5. 唯一窄修（本次实际任务）

首轮 session-dffe2cd1-c18b-4dd1-bb03-01ad7280e2f7 已 exit0 STOP；原四目标与 types 独立通过，但下列原 §11 要求仍缺失。继续同一隔离 lane、保留原 originalAllowedHashes，开 fresh DSH 4.1F 会话；只修以下具体实现问题。原八文件 scope 不扩；runtime.ts 与 execution-entry-service.ts 当前差异已审通过，尽量不再改。所有测试与公开 DTO/ports/composition/Kernel 完全冻结。不得通过扩大测试、弱化断言或放宽事实窗口处理。

1. **公开 observe 的真实收尾门槛遗漏。** execution-observation.ts 中 `cleanProof` 当前只挡控制 ack，`recordRunResult` 前没有门槛，故公开 observe 在 Kernel 已落 terminal 但 source/tool cleanup 仍在途或失败时可正式结束/释放。controls 已装配时，原 terminal writer 与 positive ack 必须共用同一 live proof：Kernel 调用已退出且 owned cleanup completed；缺席/failed 不能释放。不能等待包含自身的外层 done；原无 controls 的直接 Runtime 路径保留。observed-model-run.ts 当前仍只在 completed 传播 cleanup failure：对本控制接缝的 paused/cancelled 也须保留真实 cleanup 失败；无通知的旧消费者错误优先级保持。只修现有 finally/observer，不另建 owner。

2. **进入事实收尾仍用 caller signal 且被提前 return 跳过。** driver 的 readTurnTail 已换 internalSignal，但 `recordExecutionEntered` 及其 revision-conflict 同 binding 重读仍传 `owned`，而 `enteredFailure` 仍在 observation 前直接 return。给原进入事实写/回执恢复/重读用同一个 finishing context；无论 fresh 动作拒绝或 caller signal 取消，原已发生事实仍按原身份对账，然后保留实际错误。只补原 Run/Kernel/consumer/generation，不调用新模型、不换 Run、不伪造缺失 entered/terminal、不因 throw 释放。沿原 observer 收尾后再选择原具体 failure；不要用返回值掩盖提交未知。

3. **ack 原来源与持久窗口必须闭合。** 当前 paused 先写 ack 再 WG12；unknown 不推进；control-service 为此只验 start，放宽 source 上界。恢复原要求：先沿既有 historyWriter 推进该 Run 的 observedThrough（endPosition 仍 null、Session 完成 cursor 不动），确认原已持久窗口后再写 ack；内部 owner 依原 Run locator 核同 Run/Turn/Session 与 source 位于该窗口，不允许 observation 自报上界替代持久 locator。terminal 仍先原 result writer、原同代释放后 ack；已 ended 只使用其固定 terminal 窗口。

4. **同一次观察缓存不能丢掉待补 ack 的真实源。** 当前 cache 只保留 reducer state，controlSourceRecord 只找本次 decoded：公开 observe 若在 cleanup 前已读到 run.paused，后续 driver 读增量为空，即便 proof 已完成也永久找不到源。复用原缓存保留确实读到的原 control source（含 kernel event meta 和 SessionRecord position），后续同一 Run 可用它补 ack，不扫描另一套历史。source 选择须精确过滤本 locator 的 Kernel runId/turnId；已 ended 按固定 locator end/observedThrough，不能借后来同 Session 新 Turn 的事件或扩其完成边界。真实未确认 ack 请求若需要恢复，继续保留原 observation/time/pins/request，而非同 key 随意改指纹。

5. **Observed event 误绑原请求者。** control-record-codecs.ts 当前把 Observed.event.actor 强制等于 snapshot.requestedBy；前者是实际事实写者，后者是原 submit actor。两位合法 Host 可以不同，service 本身也保留二者。只去除 Observed 分支这条错误相等要求，保留 event.actor 自身合法性与原 identity/replay 检验；Submitted 的请求者等式保持。

6. **消费关联只能来自实际消费。** coordinator.deliver 现对任何匹配旧 handle 立即覆写 intentRef，包含已退出 handle，pause 投递也在真正 safe point 前标成 consumed。保留完整 RunRef/固定 entry/kernel 的原 handle；pause 只在实际 safe-point 决策消费，cancel 只在该 live 调用实际收信号时关联。已退出 handle 保留原 proof/待补 ack，不允许迟来的 deliver 借旧暂停/终态冒领新观察；无活跃匹配仍原 queued，不新启动恢复。禁止扩为冷 owner/resume 或未来热换角色。

按原四目标 `next-control-runtime` 和 `next-types` 自检，修复触及原未控制行为时只沿原允许邻接一次，不追加任何 case 或 selector。交付最终八 hashes、上述具体问题如何闭合、实际检查后 STOP。此为已授权唯一窄修，不自行开启下一轮。Astra 再独验和 audit，最终 diff 交 root 阅后才导入。

## 6. 唯一窄修后独立审阅（待 root 最终阅，未导入）

Fresh repair session `session-e3559b46-ef97-467b-bcef-ebf8fa99dff3` 已 exit0 STOP；Astra 独立 `next-control-runtime` 为 2 files / 4 pass，`next-types` exit0，audit `outsideScope=[]` / `originalWorkspaceChanged=[]`。两冻结测试 hash 未变，原八个 main baseline hash 均未变。完整差异、8 文件原/新 hash 与逐条证据已落 [repair review](../reviews/evidence/next-b2-2026-09-26/r4-control-runtime-implementation-repair-review.json)及 [diff](../reviews/evidence/next-b2-2026-09-26/r4-control-runtime-implementation.diff)。

已接受 actor/window、原 pause source 缓存、finishing context、不提前跳过 observer、cleanup gate 与 paused/cancelled 清理失败传播；仍有两处原任务缺口，不建议当前导入：

- observer 在缓存 terminal 后于 cleanProof 门槛返回，而 pending terminal boundary/cursor 在门槛后才建立。合法公开 observe 若在 cleanup 期间先读完 terminal，driver 后续空增量没有原 boundary/cursor/prior，返回 unavailable，无法沿原调用完成释放。须保留原终态来源/请求再等门槛，不能移除门槛。
- cancel 分支尚未区分 controller 已被 caller abort；且 kernelExited 在整个 runObservedModel finally 清理完才置真，真正 Kernel 已返回但 cleanup 在途仍被当 live。迟到 cancel 可能覆写原实际暂停/取消关联。须使用真实 Kernel return 与 cleanup 两份证明，既有 abort/已返回调用不让后来 intent 冒领。

没有增加或修改测试，没有进行第二轮修复，没有导入生产文件。root 最终审后决定原局部闭合方式；R4.3b 与冷恢复继续保持独立批次。

## 7. 两个原真实窗口的精准纠正（本次唯一执行节，root 已批准）

上一修复 session `session-e3559b46-ef97-467b-bcef-ebf8fa99dff3` 已 STOP。主审确认两个原接线问题必须修复，不能带缺陷导入。保持同一 lane、原八文件 scope、originalAllowedHashes 不变，用 fresh DSH 4.1F 会话。**实际仅可修改下面四文件，其余四个已审 scope 文件也保持原候选 hash；所有测试/contracts/ports/composition/Kernel 全部冻结。** 不添加测试/矩阵，不设计新 owner、公开能力或第二套历史读取。

### 7.1 execution-observation.ts：先保存原终态提交事实，再等待清理证明

现 494 行先缓存 reducedThrough/state，但 564 cleanProof 缺席 return，570 后才建立 pendingTerminal。正常公开 observe 可在 cleanup 期间读完 terminal，driver 稍后增量为空且 prior 未存，572 返回 unavailable，原运行无法结束。

修复只用现 `PendingTerminal`/`pendingTerminals` 与原分页/entries：在 cleanProof gate 前保存已读取原 terminal boundary、canonical cursor、原 Kernel source、原 Runtime event、requestId 与 observation 身份。正式 `recordRunResult` 仍在同一 cleanProof 门槛之后；没有 Kernel exit/cleanup completed 绝不提交或释放。稍后增量为空时使用原 pending submission，不重造 event/time/Run、不能读另一 Turn 或扩大 terminal window。建议把现 gate 移至已构造 pending submission 后、正式 writer 前；不要删除或放宽 gate。已提交/结果未知原回执逻辑保持。

### 7.2 observed-model-run.ts / execution-driver.ts / execution-control.ts：真实 Kernel return 与 cleanup 分离

`runObservedModel` 内为原 `o.kernel.runCodingAgent` 一次调用增加内部同步 `onKernelExited?: () => void` 通知，在首 await 前捕获引用。它只属于内部 Host options，不传给 Kernel/模型、不成为公开 DTO。**在原 Kernel 调用真实返回或抛出时立即通知，先于 outer finally 的 owned resource cleanup。** 用紧贴该调用的 try/finally 覆盖正常与异常返回，不在初始化尚未调用 Kernel 时凭空证明它执行过。原 `onResourcesClosed` 仍在所有实际 cleanup 尝试并 await 完成后通知，两份证明分开。

Driver 注入 callback，仅在这个回调中将原 handle.kernelExited 置真，删除现 666 在整个 runObservedModel finally 完成后才置标的方式。原 finishing signal、entered 补记、observer 收尾和错误优先级全部保持；callback 不启动任何后台 Promise。

Coordinator 的 deliver(cancel) 与 decide(cancel) 均只在同一个固定 handle **Kernel 未返回、未 settled、own controller 尚未 aborted** 时首次关联 intent 并实际 abort。controller 已被 caller 或先前控制 abort 时保留原关联；Kernel 已返回但 cleanup 在途也保留原 pause/cancel 停因，后到 cancel 不能冒领。pause 的实际消费仍只在真实 safe-point decide，迟到 deliver(old pause) 不覆写 cancel。保留原正式 RunRef/entry/kernel 绑定和 canonical current intent 读取，不新增冷 owner/resume/热重绑治理。

### 7.3 验证与交付

仅沿冻结的 `next-control-runtime`（原 4 流）与 `next-types` 自检，不添加或改测试、不加 selector/邻接矩阵。报告上述两个窗口的实际代码路径、4 文件 hash 与其余冻结 hash保持、检查结果后 STOP。Astra 做同一固定检查、只审这两个原窗口、audit 原基线，交 root 最终阅；不可自行导入。

## 8. 两窗口精准纠正独立结果（候选待 root 最终阅）

Fresh session `session-1e8f8993-91af-4e79-9d8d-0aa25cc41054` 已 exit0 STOP。独立 `next-control-runtime` 为 2 files / 4 pass，`next-types` exit0，audit 两越界数组为空；两冻结测试 hash 原样，实际仅四文件变更，另外四个已审候选 hash 保持。

- 原 pendingTerminal 已在 cleanProof gate 前保留；正式 result writer 仍位于 gate 后。清理期间读完 terminal 后的空增量可重用原 source/boundary/cursor/event/requestId。
- 原 Kernel 调用的紧邻 try/finally 发 onKernelExited，随后 outer finally 才清理并发 onResourcesClosed。Driver 不再清理后才置 Kernel 返回标。cancel 对 exited/settled/已 aborted 的 own controller 不再冒领。

[最终独审证据](../reviews/evidence/next-b2-2026-09-26/r4-control-runtime-implementation-correction-review.json)、[完整候选 diff](../reviews/evidence/next-b2-2026-09-26/r4-control-runtime-implementation-correction.diff)、[八文件 hashes](../reviews/evidence/next-b2-2026-09-26/r4-control-runtime-implementation-correction-candidate-hashes.json)已落盘。已向 root 明确指出一个最终阅选择：cancel 还要求 intentRef 未关联，因此已消费 pause 也保留其原停因；没有为此添加测试矩阵或自行扩大修复。原两个指定窗口已闭合，生产候选尚未导入。

## 9. 最后暂停消费守卫（当前唯一任务，同会话）

root 已最终读并接受 §7 四文件，确认 R4.3a 不含原暂停执行 resume，cancel 的 `intentRef===undefined` 可保留原 pause 停因。但 `execution-control.ts` 的 `decide` paused 分支仍直接 `handle.intentRef=intent.ref`，在 await 原 readControl(pause) 期间实际 cancel 已消费并 abort 时会覆写它。这与上一节首次消费规则同属一处遗漏。

**本次只可改 `coding-platform/next/src/core/agent-runtime/execution-control.ts` 这一处分支守卫及必要同处说明，其余七个生产文件、所有测试/公开契约/Kernel 都保持 hash。**

将 paused 分支登记条件精确改为：handle 存在且 `handleLive(handle) && !handle.controller.signal.aborted && handle.intentRef === undefined` 才将 intent.ref 记为消费。`return { kind: 'pause' }` 保持，Kernel 已有 signal 优先级处理实际 cancel；已经消费的任何旧 intent 不再覆盖。不要改别的算法，不新增 helper/模块/测试/矩阵。

沿原 lane，恢复 `session-1e8f8993-91af-4e79-9d8d-0aa25cc41054`。仅运行冻结 `next-control-runtime`（4 流）和 `next-types` 自检，报告该文件最终 SHA 与检查后 STOP。Astra 再作固定验证和 audit，主审已授权本次通过后按原 originalAllowedHashes 精确导入八文件；DSH 不自行导入。

## 10. R4.3a 实现最终精确导入

§9 同 session 最后尝试已 exit0 STOP，paused 登记条件精确与 cancel 首次 live 消费规则对称，返回 pause 保持。独立冻结 `next-control-runtime` 为 2 files / 4 pass（7.13s），`next-types` exit0。最后尝试仅 `execution-control.ts` hash 改变，其余七个候选保持，所有测试未改。

root 已接受两真实时序窗口修正和已消费 pause 保持原停因，并明确授权最后守卫通过后导入。Astra 在导入前核 scope audit `outsideScope=[]` / `originalWorkspaceChanged=[]`、逐项核原 originalAllowedHashes 与候选 SHA，随后只导入原八个生产文件，写后 SHA 全匹配；manifest 原基线未重置。

- [精确导入证据](../reviews/evidence/next-b2-2026-09-26/r4-control-runtime-implementation-import.json)，SHA-256 `4ff67ddaaa96596cb2ab3ac9e636d2eb7d1f3b231037a9fd42489d1c14045776`。
- [最终独立审阅](../reviews/evidence/next-b2-2026-09-26/r4-control-runtime-implementation-final-review.json)、[最终完整 diff](../reviews/evidence/next-b2-2026-09-26/r4-control-runtime-implementation-final.diff)、[最终八文件 hashes](../reviews/evidence/next-b2-2026-09-26/r4-control-runtime-implementation-final-candidate-hashes.json)。
- `execution-control.ts` 最终 SHA-256 `623d3e9ad78f457dca60bb0812260499bbbd3d6654334b398902d215563357cf`。

现批闭合的是活跃原执行的 pause/cancel 投递、原 Kernel history 观察、真实清理证明与同代结果/控制回执。R4.3b abandoned 多组取消投影及 R4.4/5 冷 owner/resume/维护继续独立推进，未在本批虚报开放全部恢复能力。主 HANDOFF/能力索引由 root 集中更新。
