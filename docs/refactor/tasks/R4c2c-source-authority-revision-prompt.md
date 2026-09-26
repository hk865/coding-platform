延续当前 R4c.2c 实现。同一 scope 仅两个生产文件可写，测试/契约/脚本/Kernel/原工程只读；先前设计与复用要求仍有效。Astra 已独立发现并冻结两项真实反例（guards 新20项，总51项；当前候选49绿2红）。

1. source-capture-access authorizeSubject 只排除 host/query_run 而非正向要求 work_run，未知 principal.kind 配有效runRef/roleBinding会创建sandbox。先正向验证允许的身份种类，未知拒绝forbidden，不做任何来源文件I/O，不改变既有Query受理语义。
2. 真实SQLite Run可保留对象envelope但缺runRef/attemptRef/roleBinding；当前 canonicalJson(undefined)抛异常。消费端窄校验实际使用的身份叶字段，损坏返回unavailable；合法但与binding不一致仍forbidden。不要复制完整TaskEnvelope codec或增加新schema层，不全仓catch吞错，不跳过readOnly/reviewer/current状态检查。

读取新增 tests/runtime/R4c-source-authority-guards.test.ts，原地修复scope生产代码。跑 next-types、next-source-authority、next-session-continuity，报告真实结果与未完成边界。不要改测试，不恢复任何旧服务，不提交。