# R4c.1 Astra 独立审阅返修（同一Session）

仍只写当前lane的4个生产文件，tests/types/config/composition只读。你上一轮专项68通过、全量仅公开keys断言2失败属实。主审已审定并更新该精确keys集合加入claims，保留测试，不移出全量。主审还补充并冻结了4个必要反例，已只读刷新到此lane。请读 `tests/work-graph/R4c-task-claim-concurrency.test.ts`。

必须修复以下具体问题，不新增模块/抽象层：

1. plan-readers.ts复制了约94行read/fold，不是“同一fold”。narrow先在所有Plan选Run再过滤，broad先过滤当前Plan再选Run，已有实际语义分歧：旧Plan active revision2、当前Plan active revision1时，narrow丢掉当前Run并返回blocked，broad running。**删除独立readDirectedTaskFacts的重复路径，仅参数化selectedTasks/索引/values，复用原readCanonicalTaskFacts的完整read+fold。** taskHasRun在Plan过滤前从同一次读累积，供claim拒绝首次领取；不得改变共享effectivePhase规则。不同调用的区别只在读取集合与taskHasRun辅助事实。新测试要求同Task narrow state和broad state相等。
2. role-memory-service.ts的guardOf把unaccounted编码成expectedRevision:null。PhaseA在policy missing/无matrix分支提前返回时，未交付的roleActive可能被假装确证不存在。在构造phaseA guards前拒绝任一unaccounted；其他phase同样只用found或confirmed missing生成guard。unknown != absent，不补默认事实。
3. claim-service.ts的validateExpected/fingerprint会对含非JSON额外字段（如bigint）的raw元数据抛异常穿出Port。同步隔离后验证/规范化可序列化输入，或捕获精确的canonicalization错误返回invalid；不要把Store/其他异常全部吞掉。原边界测试期望invalid、零commit。
4. readReplay没有核对eventAt返回的cursor等于receipt.cursor，虽然你的报告说已核对。补这个检查，返回unavailable；lookup命中和commit replay共用原函数。新测试返回正确event但错误cursor必须拒绝。

另外 readTaskClaim应在读取前/后检查绑定signal的取消（同其他读Port的约定），非法ref canonicalization也返回invalid，避免同类异常漏洞。代际bug你已按独立断言改成generation===sessionRevision，保持该正确实现。

运行 `python3 tools/dsh-refactor/check.py next-types`、`next-task-claim`、`next-tests`、`next-architecture`；最终主审再做物理隔离检查。不能改测试。报告删除的重复行数、4个修复及实测结果后停止。
