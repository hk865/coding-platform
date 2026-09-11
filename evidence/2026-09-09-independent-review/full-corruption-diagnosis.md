# 原始工具报告损坏的 HTTP 回归诊断

2026-09-09，VR-02 最终全仓 candidate-03。源码清单和第一轮全仓日志保持原样。

全仓 `full-tests-workers2.log` 与精确单例 `full-corruption-diagnostic-01.log` 均失败于 `tests/app/verification-rounds.test.ts:78`。单例进程 exit1，实际测试 5478ms，完整命令 52.54s（含 WSL 应用导入）。原测试超时为 60000ms，失败不是超时。

预期 issues 含连续片段“报告不可读取”，实际为“Error: 原始检查报告当前不可读取”。HTTP 400、原请求回放及 current=stale 已通过；历史 aggregate/FAIL/命令只执行一次的末尾断言尚未执行，不能提前声称这些断言通过。

按优先级核对的假设：共用读取改变旧接口提示；既有接口是否要求新提示；旧断言是否无意义依赖字面量。源码和 V 模块负责人只读核对表明，本次 originalReport 新增 typed ReportMaterialUnavailable 用于把临时缺料归为 incomplete/tool_report_unavailable；其错误类别应保留，但新增“当前”二字没有必要且破坏旧 HTTP 可读提示的连续片段。原后一条 guard 仍保留“原始报告不可读取或引用已变化”。

最小修复计划：当前全仓结束后仅把 `src/verification/verification-rounds.ts` 的异常消息恢复为“原始检查报告不可读取”。保留异常类型、catch、检查顺序、权限、原始报告完整性验证和所有原测试。已持久日志/journal 不改写。修后需原 HTTP 六项和 V 模块轮次/Reviewer分类回归，以及修复源码上的完整验证；不以单例通过替代全仓。

首轮完整结束：249文件中248通过、1失败；1633项中1632通过、1失败，exit1，1623.62s。最后UI渲染文件加载较慢、曾观察到WSL p9文件系统等待，最终正常完成4项；没有终止测试进程或归因成测试超时。`full-end-03`与原candidate03完全相同。

主线随后执行上述单行修复，测试未修改。`candidate-04`仍730文件，摘要`1234c2efa1bd3698a2836ed29f5dc8af6edf9e8202dee7755fe3b72a67bfcfd0`；清单比较仅`src/verification/verification-rounds.ts`变化，无新增或删除源码/测试。修复后的原反例、分类及整体验证结果待补。
