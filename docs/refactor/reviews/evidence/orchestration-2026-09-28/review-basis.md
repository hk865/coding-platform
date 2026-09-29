# 统一机制候选的源码审阅依据

2026-09-28；当前源码阅读结果，不是候选验收或新增测试要求。

- Kernel的yielded需贯穿event schema、reducer、terminal判断、required sink、Session activeRun清理、history稳定边界和recovery。checkpoint已有terminal模式可复用，不为yield新增一套恢复机。
- 外部contextBasis在turn.started、checkpoint和恢复中保持源Session及原throughPosition；目标Session重启后不能误读自己的历史作为源前缀。
- 新输入先留事实、再由模型实际消费；重复恢复不重复插入。yield/steer只能在工具组排空后，pause/resume继续原预算/权限/沙箱边界。
- WorkGraph的结束记录、原lease释放、原Session占用释放沿原execution-entry事务；yield保存等待关联，不先释放后补账。
- plan-readers当前把无reduction的ended Run归blocked，eligibility只接受pending/ready。适配必须只放行有正式续接依据且等待已满足的工作，不全局放开失败或blocked。
- claim-service当前新建TaskLease@1；旧lease释放后记录仍存在。新Attempt须沿原revision更新已释放lease，并把等待消费和新Run/占用绑定同一幂等提交。
- control-service当前拒绝ended Run新控制。无活动Run的等待期间仍要保存工作暂停/取消依据，续接不能丢失让出并发的控制，也不能依靠Host内存布尔值。
- Task/Goal完成不能被yielded和旧PASS提前满足，后继正常完成后则可按正式证据收口。Workflow当前completed分流不自动支持yield，需与正式owner一起适配。

审阅覆盖实际生命周期可达状态，不以直接篡改持久层制造的反例扩大防御校验。Source map逐字恢复的2,190行已有Kernel源码与真正新增逻辑分开统计。

## 候选施工中的定向反馈（不代表最终验收）

- claim-service `c837bbcfa88bf081c5e3fb5cab4cdaa0d421a944a77a3750daafe663d04c6914` 已复用释放后的 lease revision，但 consumedWait 分支目前只核对原Run/消息引用/Session，没有读取正式回复或守护当前控制。公开claim入口可在消息仍pending时领取后继Run；必须在原提交中核实等待满足和暂停/取消，再保护相应读取版本。不能仅依赖Host先过滤。
- 新外部 contextBasis 的 sourceSession 必须进入 composition-root 的执行内容一致性比较和解析；同position不同源不能被当同一次重放。resume-composition 先从目标原Turn取得基线，再按保存的源Session和throughPosition读取源历史，不能把执行恢复自身切到源Session。
- 幂等执行输入复用原append对recordId同内容重放/异内容冲突；交付ID必须保存在事件及可恢复state中，不用随机eventId或只在内存去重。修改的受管Kernel源码必须加入构建列表并再生，当前已有源码范围足够。

继续候选的跟踪（以各自哈希为准，后续仍需最终代码复核）：

- composition-root `ec63bdbeeb7ae85fdfe74155c3f35dd21fa3ac60ae8cb3c35f7f0637f8b460e7`、session-history `36cad47434965d66eab31d3829d644ce900c3c07949aeaec5230989a1b65e78b`：目标身份/源前缀分开、来源解析保留已修复。
- claim-service `62d0532a8a975bba283ef3d1adef9a4cd2e10e5f399f85364e01e8492a0ab9db`：正式reply和bodyRef核对/版本guard已加入；但另一个合法Host actor仍可能在后继再yield后消费旧等待。需核等待实际已被哪个后继消费或原lease holder，不能依靠包含actor的幂等键代表单次等待消费。读新pins后的重复通知也不应被描述成总可重放原回执。
- attention-observer `4f499352…`：文本输入、多源通知、撤销buffer和反馈去重已改；processed尚未参与差量基线。大文件的multiset回退会把仅重排行判成零变化，不能漏掉这种实际文本版本变化。
- consultation `48b26e9d33b7c413624bb915f12d964c1fbeb2aaef9ccaf93d33abf9cb454d5d`：已允许源A忙碌并创建child，保留原recipient和实际sender；若child创建后后续提交失败，重试重新读取源最新boundary可能改写同一次派生基线。首次固定边界必须可重放。验收应使用非空完成前缀、忙碌的源A及child实际读取该前缀，空Session不能证明继承。

## A′ Query／Answer／邮箱源身份接缝

- 保留 consultation.messageRef 与 recipient=原 A；派生执行另绑定正式 child Session、来源 A、上下文边界及原请求。不能把消息 recipient 改成 A′。`contracts/query-job.ts` 的类型与内嵌 validator、`queries/query-job-service.ts` 的原消息/正文/版本检查需要共同适配。
- `queries/query-execution.ts` 的首次 claim 目前要求 Session=recipient。派生分支应核实际领取的 Session=正式派生 child，且其来源/请求/范围一致；旧非派生路径保留原检查。`business/workflow/consultation.ts` 消费幂等派生结果领取 A′，原 A busy 不阻塞合法隔离咨询，重放不再次派生。
- `communication/mailbox-service.ts:respondFromQueryAnswer` 必须由实际 settled QueryRun 构造 A′ sender 与 generation，并保留来源 A/边界引用，不能冒充 A。原 messageRef、确定性 Query 身份、Job 登记 Answer、Run answered/settled、Answer↔Run 配对及原 body source 检查继续成立，不放宽成任意 QueryAnswer 可挂消息。
- `communication/contracts.ts` 当前 sender 注释将其等同原 recipient，需要与实际执行身份同步；新增来源字段同步 message-record-codecs。仅调整 queries/communication contracts+codecs 不足，还须上述执行/关联消费者及正式派生事实的只读验证接缝；不另造 Answer 管理层。
