# C1 独立审阅返修

你上一轮实现已scope审计通过。主审确认原lifecycle fixture漏schema真实，已补并刷新只读测试。又独立增3个真实反例且已跑复现：next-session-mailbox现61pass/3fail；证据主工作区 reviews/evidence/next-b2-2026-09-26/c1-independent-counterexamples.log。

保持同lane同3实现文件scope，全部测试/fixture只读（主审已刷新snapshot）。直接修复以下已验证问题，不能删约束使绿：
1. authorizeNewWorkRunAction仅比Lease holderRunId/attemptId，released Lease仍保留这些。新动作要拒绝release stamp，原精确回执仍能恢复。
2. canonical body先写成功但metadata失败，Workspace@1→2后同identity重试，RawArtifact正文去重返回原source@1。当前verifyStoredBody要求fresh source@2导致永久拒绝。消息不是源码证据；核stored.ref原provenance属于正确workspace/合法revision、body严格scope/messageId/part/sender/text、实际read body/ref/source吻合；message/response元数据应保存实际stored.ref.source，不可伪改source为fresh。不能放宽完整正文校验或改正文内容绕过去重。
3. readInbox前面读取page.cursor得到after，WG11 await后再读可变page.cursor判断callerKey；调用方删除cursor能跳过身份核验。开始时同步快照完整ctx/request/page并保signal，后面只使用同一快照/解析结果。核readMessage/readBody同类输入别名问题并修。

历史只读与原receipt不机械要求当前entered；新写维持当前entered/Role/Session/lease局部guards。principal原绑定身份需一致，撤权/终态本身不抹除已提交回执。

用Python/Node原地写，不rename/probe。跑next-types、next-session-mailbox、适当已有回归。只报告真实结果，交付后停止等待主审。
