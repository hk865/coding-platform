# R5b.2 Query 单轮真实回答：八生产文件实现

2026-09-26。阶段一19路径已中审冻结；本任务从合入后main准备新实现lane，只开放implementation-scope.json中8生产文件。按用户授权立即完成单轮真实正常链，不重新做全仓调查。唯一协议真源为 R5b-query-planning-skeleton.md §10（含中审补充）；接口、两测试、其余13骨架路径、既有Kernel/Store/Role/Session/Work实现全部只读。完成后STOP独审，不自行扩范围。

## 已经冻结的接缝与中审修正

同QueryExecutionPort绑定QueryJob与Runtime，无Task/Attempt/Lease；同QueryRun executionState、同Session槽及原Kernel历史，不新建owner/loop。QueryRun schema仍在materials/record-readers，既有pending producer不得倒退。

QueryExecutionRecorded带原identityKey/fingerprint及payload.result，正常lookupCommit→eventAt返回当次原回执，不从当前Job/Run/Session重建历史值。raw body manifest属于QueryRun，使用同bodies/material owner；不以Host作为Query执行来源。TargetPlatformOptions.sourcePolicyFor已冻结并原样传入Runtime，直接复用原source factory，不能缺权限时退回live。当前createAuthorizeQueryConfiguration仍是阶段一接线，须实现同Host grant、claim稳定Role权限内容与readonly ceiling交集，不每模型调用重读Role。

原两测试只修正了已确认错误的正常前态，未加case：generation等于新占用generation；真实Skill文件；真实Host sha/counter/预算；合法精确project_source read；回答保留Goal/Workspace及真实工具来源；sourcePolicy同scope/root/grant。以main实际冻结文件为准，不把测试中的旧错误当产品规则。

## 实现正常公开链

无Plan/Policy/baseline的公开Goal→submit pending→正式Session→claim（一次绑定角色和原initiator）→prepare bounded manifest→fresh begin固定Kernel identity→awaited before_model记录entered并做ModelCallAccess准入→唯一runObservedModel readonly project_source工具往返→原历史完整终态→同事务正式Answer/Job/Run与匹配generation释放→read/replay/SQLite重开。

- 首await隔离真实输入及ctx，保留signal；事务使用实际消费的局部pins，不加全账本门禁。新动作核当前Host/占用/固定输入；已提交回执和已发生终态保留事实，不重审后来权限把历史抹掉。
- prepared纯输入来自原Goal/Workspace/focus/Job/稳定Role；精确submission reader复用原locator与lookupCommit/eventAt拿原actor，不能固定system或扫描全事件。body/ref/digest真实核对。start fresh才发送模型请求，replay只观察原execution，不新开Turn/Session，不重置累计预算。
- 复用ModelBudget及原请求计量，保存真实requestDigest、reserved/reported/unknown；先持久usage再beforeCall准入。工具往返仍同QueryRun/Turn，不把maxRounds=1当只有一次provider调用。
- readOnly/allowedTools实际限制保留，无shell/edit/通信/白板写。 source witness来自实际Kernel工具结果，模型自报sources不算；源码晚变化保留历史回答与stale标记，不回滚已经发生事实。
- observe复用原SessionHistoryCursorOwner、Kernel完整交换判据、历史范围与reader；entered/unknown/terminal明确分开。unknown保留原占用；只在真实可确认终态释放匹配owner/generation。失败或抛错不伪装确定未启动/安全重试。
- scope内8文件足够实现已冻结接缝；若发现接口真正缺失，报告确切符号和阻断，不自行改测试/Kernel/共享helper。不要提前实现Query外部材料grant、多轮、冷恢复、answer→Plan或Workflow/Host。

## 必要检查与交付

仅 next-query-execution + next-query-job 合并运行、next-types另跑；新两条链须真通过claim后全部步骤，包括原source工具成功正文、Answer body/source、释放、重放与重开。第一次真实失败定位到owner/fixture时给准确事实，不增加测试矩阵、重建Kernel或循环全仓。实现自检不是主审验收。

交付8文件hash、复用链、实际正常结果与仍unsupported范围，随后STOP。后续初始规划依赖本实现；优先完成这条链，不以更多局部测试代替产品接线。


## 本次独审后的有界返修（2026-09-26，同一 Session 接续）

沿当前落盘实现继续，只修以下已确认正常生命周期/正式协议缺口。写范围仍原8生产；两测试、共享helper、Kernel、Store、Role、Session其它实现冻结，不增加用例或异常矩阵。此前新链通过不撤销，但不能以它代替下面正式契约。完成一次必要自检后STOP，主审独立复核与导入。

1. **落实原 GraphWrite 局部 expected 与完整指纹。** 首 await 前隔离整份 input/meta.expected/requestId；claim恰消费QueryJob/QueryRun/Session，bind消费QueryRun/Session，begin消费QueryJob/QueryRun/Session，usage/admit/observation消费QueryRun版本。按主协议§10.3.2集合验证并纳入原完整请求fingerprint，fresh事务guard使用实际匹配的请求版本及本操作已有内部guards，不用后来当前revision覆盖调用者expected。Runtime正常消费者据实际已读record构造这些pins；当前usage/admit的expected:[]必须修正，不放松writer来迁就。CAS冲突只有在未提交时才读当前版本重编同一事实；不能改已提交原request的expected后还当原命令重试。保持原meter/Store owner，不复制通用事务框架。
2. **原请求重放优先于fresh状态/准入。** 每种write从同一完整原请求计算相同identity/fingerprint，先lookupCommit→eventAt恢复payload.result，再检查fresh phase/Host/occupancy/expected。修正bind已prepared就拒绝、entered/terminal已推进就拒绝，以及begin replay fingerprint漏bundleRef/inputDigest的问题。usage/admit/observation也保留同一原请求；不同计量阶段是不同动作身份，不靠当前state/admitted值重建指纹。重放只返回原值，不重启provider或从当前snapshot拼旧回执。查询到明确idempotency_conflict如实返回；未确认提交不能宣称未发生。
3. **真实首次绑定与新动作资格。** 公共及内部Query入口都核完整project/workspace与Host ctx，初次claim将Job.execution.roleBinding.templateId/templateRevision与legacy Session role精确对齐（resolved Role继续原稳定pin）；这是首次选择，不是运行中Role热换。fresh bind/begin/model admit核同QueryRun持有原Session occupancy/generation及原固定input，model admit使用当前Host授权。所有后续Role检查仅消费claim保存的稳定内容，不重读RoleBinding。历史usage/entered/terminal记录及原replay不受后来fresh准入变化阻断；terminal仍只释放匹配holder/generation，保留真实已发生结果。
4. **执行真正使用已经收紧的预算。** ModelBudget与runObservedModel（及其Kernel limits）使用prepared manifest.runtimeBudget，不能回用更宽的hostConfig.budget。原Query intent累计tokenBudget/绝对deadline继续沿既有meter共同生效，不重置预算，不新建算法。
5. **回答来源是原轮事实。** Query观察从原prepared bundle读取已保存manifest的Goal/Workspace/可选Plan pins，不能在终态重新readPreparationFacts取后来当前版本当作原来源；源码witness继续只取本轮真实成功工具历史。当前来源已变化只在回答标stale/staleReason，不抹掉既成回答或拒绝terminal落盘；不额外做全系统currentness门禁。Plan业务版本用PlanRevisionSnapshot.planRevision，不能拿immutable row.revision当planRevision；PlanRevisionRef本身不含业务版本。原actor仍取正式submission locator；manifest/body真实owner与digest沿现有路径。

**撤回此前协议中的 turn.finished 要求。** 冻结Kernel没有该事件。终态沿既有真实run.completed/failed/cancelled/limit_exceeded、工具收束、Kernel reducer/invariants与transcript完整交换判据确认；禁止新增turn.finished事件、等待或校验，也不修改Kernel。该纠正只消除不存在的前置条件，不放松unknown/未配对工具仍保留occupancy的规则。

仅运行原next-query-execution + next-query-job一次联合检查及next-types另一次；失败只修本批实际阻断，不追加测试或扩大范围。最终交付8文件hash、上述修复映射、检查结果与scope audit后STOP。主审会独立检查、原基线核对和逐文件导入。
