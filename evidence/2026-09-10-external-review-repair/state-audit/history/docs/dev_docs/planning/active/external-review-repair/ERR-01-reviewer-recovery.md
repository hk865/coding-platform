# ERR-01：Reviewer 启动前失败分类与受控恢复

状态：active；角色：实现。上游发现 F-01，范围仅限 Reviewer 恢复，不扩展返工/重验能力。

## 写入范围

`src/control/leased-worker-runtime.ts`、`src/control/reviewer-dispatch.ts`、必要的 Reviewer 恢复专属 Control 文件，以及新增/修改的 Reviewer 恢复专项测试。不得修改 `src/contracts/**`、`src/app/**`、`src/harness/**`、共享状态文档；若契约必须变化，向主 Agent 提交精确需求。

## 验收

1. 用真实 StateLedger/Control/ReviewerDispatch/LeasedWorkerRuntime 与真实租约实现构造重叠写租约和 Reviewer 读租约冲突，先保留修复前失败日志。
2. 只有可证明模型/工具尚未启动的失败才落为已知 failed；已启动或无法证明副作用的失败保持 `outcome_unknown`，绝不自动重跑。
3. canonical Run 与持久观察一致结束；同 workspace 后续合法验证不再被该已知失败阻塞。
4. 提供明确授权条件下的再次 drive 或重新受理路径；不删除/篡改 Ledger 历史，不绕过唯一性，不洗掉真实 FAIL，不重复模型执行或重复接纳。
5. 明确现有已 wedge 记录能否恢复、所需证据与不能自动恢复的边界。
6. 针对性测试覆盖双 Ledger（适用时）、进程重开/持久观察、已知未启动与不确定副作用对照，并报告命令、退出码和改动文件。
