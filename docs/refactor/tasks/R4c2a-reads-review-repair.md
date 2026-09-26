# 主审返修：原scope不变

独立审阅发现：
1. verifyChain遗漏Run.workspaceSnapshot.workspaceId与claim/session的一致性，错链应unavailable；自洽跨workspace Host仍forbidden。
2. atLeastCursor未验证，laterCursor容错会将非法cursor当满足。复用现有seqOfCommitCursor严格校验后再比较，非法请求在Store前invalid；不复制cursorparser。
3. 中间定位只需要outbox却读了Attempt/Plan/Lease（不消费）。收窄为[outboxKey]，正常三次readMany键数1/1/6；不重复读大型Plan。
4. 最终outbox突然明确missing时，不应因为derived集合缺了Session就重试busy。只在实际引用变化时重试；Run相关引用未变而required outbox缺失立即incomplete。优先比较可证明的Run引用，再处理outbox存在/引用；不要新增层。
主审已补反例并重新冻结当前只读测试，仍仅写run-state-service.ts。运行next-execution-reads、next-types、next-architecture并报告。复用原Session，不改其它文件，不自行修改测试。
