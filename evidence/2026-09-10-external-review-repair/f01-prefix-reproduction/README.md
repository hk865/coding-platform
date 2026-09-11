# F-01 修复前反例（隔离副本，未修改产品源码）

本目录保存 Reviewer 启动前失败分类缺陷（外审 §2.2 / F-01）的**修复前**运行证据。
测试文件与日志均产自产品工作树的隔离副本 `/tmp/err01-prefix-repro-20260910`，
产品工作树本身未被改动，也没有为复现而临时改回旧实现。

## 本副本复现的是什么

修复前 `src/control/leased-worker-runtime.ts` 的 `start()` 在租约被拒时
`throw` 出去，没有走 `CodingAgentRuntime.rejectBeforeStart`。因此本反例
用真实 Control、真实 Ledger、真实 Vault、真实 `CodingAgentRuntime` 与真实
`ReviewerDispatch`，只把 `RunPort.start` 替换为“租约被拒即抛错”这一条
接触面（即修复前的行为），其余全部为产品实现。

## 复现命令

在隔离副本内：

```
cd /tmp/err01-prefix-repro-20260910
bash scripts/test-wsl.sh tests/control/zz-prefix-f01-reproduction.test.ts
```

副本由产品工作树构造：复制 `src/ tests/ scripts/` 与根配置，
`.local` 与 `vendor/coding-agent` 以符号链接接入，`node_modules` 符号链接。

## 结果（见 prefix-f01-wedge.log）

| 观察 | 修复前 |
| --- | --- |
| drive#1 | `incomplete/dispatch_interrupted`，issues 为“工作区读租约被拒绝：read_lease_conflict” |
| drive#2 | `incomplete/runtime_outcome_unknown` |
| canonical Run | `ended / outcome_unknown`，revision 3，lastEventSeq 0 |
| 持久公开观察 | `outcome_unknown`，events/trace/usage 均为 0 |
| 模型调用 | 0 次；从未重跑 |
| ReviewWork | `input` 已绑定，`output`/`resultRef` 恒为 null |
| 同 requestId 再次受理 | 幂等重放同一个已 wedge 的 Work（`awaiting_result`） |
| 同一 task+plan 的**新**请求 | `work_rejected` / `review_already_exists`，current 为 stale —— 该 plan 永久不可再审 |
| 同工作区后续工具轮次 | 轮次本身可完成，但归约持续 `reviewer_required`，无法满足 |

即：一次零副作用的启动失败被记成不可对账的 `outcome_unknown`，使该义务在
现版本内不可恢复；这正是 ERR-01 修复要消除的分类错误。

修复后的对照证据见同目录上一级的
`err01-targeted-pass.log`（真实租约冲突集成反例通过）与
`err01-reviewer-suite-pass.log`（Reviewer 专项 8 文件/67 项通过）。
