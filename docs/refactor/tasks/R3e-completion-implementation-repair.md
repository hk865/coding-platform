# R3e.1 实现：主链窄返修

2026-09-26，沿原 lane `r3e-evidence-implementation-20260926`、Session `session-19b904b6-cd27-4afa-bddb-568be54cc538`，针对已 STOP 的 `attempt-1790403183072277513` 返修。真源仍为 [实施任务](R3e-completion-implementation.md)与[既有五生产 scope](R3e-completion-implementation-scope.json)。仅修以下已确认主链问题，不新增测试用例、矩阵、接口或文件，不扩大成完整安全/异常证明。

## 最小修正

1. **原回执先于 fresh 配置。** `evidence-service.ts:340–359` 的 open 在 receipt lookup 前检查 configuration 存在及当前 executor，导致重开时未配置 checks 或配置变化后无法恢复原 open 回执。保留结构/可信 scope 与实际 actor 身份隔离，先按原 identity/fingerprint 恢复原事件 result；仅 miss 后核 fresh configuration。沿原 begin/record/finalize 的 receipt-first，不用当前 Round 或配置改写原返回值。
2. **open 的真实局部读集进入事务。** 当前 `openVerification` 已读 Goal/current Plan、subject Run、固定政策与 baseline，但 `:470` guards 仅 Round 缺席与 baseline。复用现有 owner 的实际读取结果，读取正式 Workspace 并核 Host access 的领域 revision，将本次实际消费的 Goal/Plan/Workspace/Run/policy pins/guards 与 baseline/Round 合入同一 commit。特别保护 capture await 期间合法 W1 future apply 改变 Goal 当前指针的窗口；不增加全账本 horizon、全 DAG 或无关事实校验，不追踪最新 active policy 替代已采用 pin。
3. **fresh begin/finalize 消费真实适用性。** 当前 begin `:531–564` 仅检查 configurationRevision 与 Round，未核当前 source；finalize `:781` 硬编码所有 binding 为 APPLICABLE。receipt miss 后，begin 复用当前可信配置的 executor/workspace/source/process 与现有 Host/source 接缝，确切来源不匹配时不发布 fresh 执行票。finalize 复用当前来源与正式当前采用 Plan、原 evidence Plan 的既有 basis/frozen-definition 判断，将实际 applicability 传给唯一 `evidenceBindingFor` → fold；正常源码变化/当前来源不可判定不能贡献 PASS。无关 future-only 变化按真实 basis 复用，不能因为 PlanRef 不同一律抹掉证据。保留原 observation、outcome/anchor 的历史事实及原 receipt，当次不能判定则明示 gap/INCONCLUSIVE，不通过重写历史或重执行检查解决。仅定向消费本次结论所需来源，不增加普通读取全链验证。
4. **执行根与 fresh ticket 一致。** `check-execution.ts` 在 begin 前用 `root` 创建 WorkspaceSandbox/probe，begin 后虽核 `rootVerify === ticket.workspaceRoot`，实际 execute 仍使用旧 `root/workspace/profile`。保证这组实际执行能力与 fresh ticket 的 root/固定过程约束一致：复用已创建能力时明确核相等；不一致就保留未执行的 executing 缺口并返回真实失败，或按原过程接缝绑定同一 fresh ticket 再执行。不得在 root 改变时继续用旧根，也不借此重造 sandbox/第二执行器。probe 可保留在 begin 前，不能把 replayed ticket 当新执行许可。
5. **执行前核取消，已发生结果用原清理路径保存。** runner 实际 execute 前检查原 signal，已取消不新启动过程。取得真实 ProcessExecutionResult 后，当前末尾仍把原 `ctx` 传给 record；沿 B2 已有 cleanup signal 模式，以相同 Host actor/scope、原 ticket/invocation、原 observation 和稳定 requestId 提交事实，避免晚 abort 在事实记录或来源核对入口将已发生结果丢失/误判。过程仍使用原 signal；execute 抛出未知结果不得制造 observation/not_started。成功 commit 不因晚取消翻成 cancelled，不自动重跑。

上述修正主要落在 `evidence-service.ts` 与 `check-execution.ts`；原五文件仍是最大写边界，其他三文件无必要则保持字节不变。所有测试/fixtures、contracts、composition、Plan/Material/Workspace/Kernel 及检查脚本只读。不要追加材料二次 readback、理论 CAS、Reviewer、timeout 测试或其余异常矩阵目标。

## 检查与停止

仅运行既有固定 `next-evidence` 和 `next-types`，不新增 case、不改断言、不重复邻接/全量。报告五文件最终 hash、实际修改名单及检查结果，完成即 **STOP**，由主审核正常闭环后导入。不得自行派发新任务、扩大 scope 或提前实施 R3e 后续批次。
