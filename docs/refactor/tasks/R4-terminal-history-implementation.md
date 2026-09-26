# R4.3b：取消后的历史消费者实现

2026-09-27（本地）。六生产实现与唯一空消息壳精修已由root最终审阅并[精确导入](../reviews/evidence/next-b2-2026-09-26/r4-terminal-history-implementation-import.json)，导入证据SHA256 `02079732057b23a818181fcacc4ed99fdec9d4e6b606ccca888af7365b584ad2`。独立固定15项、types、28产物再生通过，scope无越界，三冻结测试未变；取消后同Session第二正式Task经claim→prepare→start实际消费前缀已通过，原历史/已有推理/实际结果保留，unknown仍不释放。下文保留实施与精修时的STOP记录；不再是待派发/待导入状态，也不宣称fresh resume或完整生命周期已完成。

## 范围与落位

只实现原受管 `session-history.ts` 的纯 `projectTerminalTranscript`，让原 `restoreSessionHistory` 和平台 `execution-observation.ts` 共用。固定六生产路径见同名 scope。四个 Kernel 产物只通过原再生脚本写出；public-api、脚本源名单和骨架冻结测试均只读。原 Kernel 参考工程不变。

- 依据真实 terminal RunState 拒绝 activeModelRequest、pending/running/outcome_unknown，沿原字段识别正式 transcript 中的 outcome_unknown 工具结果；不增加持久层篡改、Role 热换等防御。
- 只在返回副本里移除由原 reducer 判为 abandoned 且实际没有结果的声明。其余正文、已保存 reasoning、真实工具结果及配对不变；不改调用者对象，不制造工具结果。
- 后继模型上下文走同一投影后仍执行原严格工具配对；没有 abandoned 的普通已知终态也使用该公共函数，避免绕过其真实 unknown 判据。Session 的原记录、position、Turn 边界和用户按需查看的完整原历史保持原事实。
- 平台观察端复用这个判据，并保留 R4.3a 的真实 Kernel 退出、资源清理、原 terminal pending、control source 和完成回执。投影不能消费则不释放占用、不伪造 applied。正常取消后通过既有 Task claim→prepare→start 在同 Session 的新 Turn 消费前缀。

DSH 沿原任务书及 DSH-WORKFLOW/DSH-EXECUTION-HARNESS 执行第二阶段后 STOP；正常 workspace-write、原地写允许路径，不扩大 profile/approval、不安装依赖、不提交 Git。当前没有新的测试文件授权。

## 验证

固定 `next-terminal-history`（同两文件正常链/真实 unknown）、`next-kernel-history-public`（唯一新增符号白名单）、`next-types`、`next-kernel-patch` 分别执行；只在原历史消费确有影响时补既有定向历史集合。对每条未到达的链如实说明，不以人工 kernel identity 代替正式后继任务。提交六文件差异/哈希、固定检查结果与 scope audit，主审独立相关验证后导入并继续后续接线。

冻结 Kernel 正常链测试 SHA256 `cdd75d64a937a295e4075629937ba7db0550bf275830bb9d200568b93a205985`；Runtime 测试 `cbd89f515cfb1df72a0784ea0d60b84f1398700a5618782e0ff2e35529aa0838`；公共导出测试 `42a8a77df76a869967bf26936ac8b481b48344e1850f94b98e6771683b0f397e`。实现阶段不修改这三文件。

## 精确修复：首工具开始前取消后的空消息壳（当前唯一执行节）

2026-09-27 主审接受实现主体与既有15固定目标/types/28产物结果，独立源码审发现一个正常可达消费者阻断并批准同session精修。原 lane `r4-terminal-history-implementation-20260927` / session `session-9dfe3c17-fcab-45b5-b05d-82fb5af90ca5`，沿原六文件scope与原manifest，不改变冻结测试/契约。

真实触发：模型合法只返回工具声明（content长度0、无reasoning），首个tool.started前取消使原reducer将全部pending标为abandoned。现projector过滤工具后保留全空assistant壳，原配对会通过，但真实ContextBuilder::toModelMessages会对每项调用transcriptEntrySchema，因三个部分全空而invalid_transcript，后继正式Turn仍不能消费。原schema准确判据为 `message.content.length > 0 || toolCalls.length > 0 || (message.reasoningContent?.length ?? 0) > 0`；不做trim/语义猜测。

只修 `patches/core/ports/session_store/session-history.ts`：在返回投影副本中，仅省略由于本次移除abandoned声明后才全空的assistant壳；有任何原正文、保存reasoning或剩余toolCall均完整保留。输入state/原SessionRecords不动，不制造ToolResult，不删改合法内容，不修改无变化entry，不更改terminal/unknown判据和restore边界。source当前SHA `ff23182b6091353a80ddb4aeea468a8d7e367ee624b8bcec129a38a811fb10d2`。

4个同源dist产物仍仅通过原build-kernel-patch脚本再生。原observer当前SHA `779044403c37bb53777529cbcf36ae89bfad533f20f91d50a1b940de7b4abfdb` 冻结不再修改；其余文件和三冻结测试不变。不添加case或测试矩阵，不运行权限/Role/恢复大集合。只复跑原固定next-terminal-history、next-kernel-history-public、next-types、next-kernel-patch后立即STOP，交修复差异与hash，不能自行导入。

## 最终 STOP 与独立导入建议（尚未导入）

Lane `r4-terminal-history-implementation-20260927`，fresh session `session-9dfe3c17-fcab-45b5-b05d-82fb5af90ca5`；同session精准修复最终 attempt `attempt-1790439007282675080` 已exit0 STOP。原六文件范围/manifest未变，三测试完全冻结；唯一精修只写受管source与四产物，observer保留初始实现哈希。

独立 `next-terminal-history` 5/5、`next-kernel-history-public` 10/10、`next-types` exit0、`next-kernel-patch` 7源28产物逐字匹配。正式第二Task经原claim→prepare→start在同Session新Turn实际进入provider，原取消prefix保持不变，未知结果仍不释放。审阅确认原R4.3a退出/清理proof、pending terminal、原source与ack完整保留。没有增加测试case/矩阵，也未宣称DSH额外自检为独立验收。

[最终审阅证据](../reviews/evidence/next-b2-2026-09-26/r4-terminal-history-implementation-final-review.json)、[最终六哈希](../reviews/evidence/next-b2-2026-09-26/r4-terminal-history-implementation-final-candidate-hashes.json)、[最终差异](../reviews/evidence/next-b2-2026-09-26/r4-terminal-history-implementation-final.diff)均已落盘。受管source `9026ec17dabc8348782aa910804b4dbd7f4cbebf0fa2828ad003ff18d71bd508`；observer `779044403c37bb53777529cbcf36ae89bfad533f20f91d50a1b940de7b4abfdb`。audit outsideScope/originalWorkspaceChanged均空，主工作区六路径仍精确匹配originalAllowedHashes，可供root最终审阅后逐文件导入；本子任务未自行导入。
