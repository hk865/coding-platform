# A1 幂等恢复必须覆盖整个当前状态判定

继续原 Session / 五文件 scope。你刚才的修复只在 already closed/archived/active 几个分支回查，是按反例补局部分支，尚不满足已冻结的原结果重放契约。

主审已在 `A1-session-independent.test.ts` 加入第5类（共10项）：初次 lookup 返回 not_found 后，对端已提交同一个 open，然后又真实归档该 Session；本次调用继续读取 archived，返回 busy，实际应恢复原 open 回执。两后端均实测复现。其他后来发生的领取、解除关联、计划更换也能形成同类窗口，不应逐条堆新的例外。

请将首次 lookup miss 之后的“当前状态读取/判定/编译/提交”作为一个内部 attempt，若其结果拒绝且不是调用取消，则统一精确回查一次 identity：已有同指纹→调用现有 replay恢复原结果；异指纹→idempotency_conflict；确无→原拒绝。语法、caller/scope 校验仍放在lookup之前；不要在正常成功路径增加查询。可以用内部 closure/小helper组织，无需新增Port、Manager或文件。撤掉先前各个拒绝分支的重复回查，使该不变量只有一处维护；archive/reactivate同用已有transition，link同样适用。

仍保持原 cursor绑定、guards与真实状态验证，没有原receipt时不能放行。输入在首次await前固定。运行当前全部10项独立反例、next-graph-agent、next-types。其他已修复排序、查读水位和3个目标复合索引保持。测试只读，结束报告交验。
