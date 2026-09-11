# 语义反馈链独立复核

复核者：SC-VERIFY 子 Agent。范围是主 Agent 新增的执行反馈、Query 调查、定向补料、组合根接线及其来源展示。**不把本人实现的 Verification 返工重验/Reviewer 准备入口作为独立审查结论。** 本报告是本次独立复核的唯一报告；范围不扩展为全仓或 12 Module 重审。

## 已发现的问题及修复核对

| 问题 | 本次修复与独立核对 | 证据性质 |
| --- | --- | --- |
| 模型仅声明 `proven_empty` 和路径，即使未读取源码，也能被选为后继 Run 的补料 | WorkerRuntime 从成功公开 `read` 工具事件提取路径/版本见证；FeedbackMaterialCompiler 将每条 sourcePaths 匹配这些见证，不能只凭工作区摘要或模型自述放行 | 独立反例先真实 FAIL，再 PASS，见下方日志 |
| `read` 的 utf8Bytes 是所选片段长度，读到空行不能证明整个文件为空 | `workspace_read_empty` 还要求 startLine=1、totalLinesKnown=true、endLine=totalLines、truncated=false；普通成功片段只标 `workspace_read` | 对照内置 read-tool 元数据含义复读源码；未新增完整内核空行场景 |
| 仅在新 Run 执行 promise 的 then 里处理反馈/重验，RunEnded 后进程退出可能丢失后续触发 | 组合根从持久 runtime observations 恢复已结束普通 Run；相同后续入口被新执行与启动恢复共同调用 | 源码复核；不据此宣称完成任意强杀恢复实测 |
| 启动先 advancePlanning，可能让新的工作区写入抢在旧后续对账前面 | 启动恢复扫描结束并 project 后再 advancePlanning；明确跳过 prepared/running/outcome_unknown | 源码复核；多工作并发和恢复中间再次退出仍未独立覆盖 |
| 直接将完整 RunSpec 当 Verification scope，额外字段可能污染精确身份 | continueEndedRun 现在显式构造 projectId/workspaceId/goalId/runId/taskId；普通/返工判断通过模块结果，不解析任务 ID 前缀 | 仅复核主 Agent 的调用方；不独立评判本人服务实现 |

## 补料拒绝专项

独立文件：`tests/verification/feedback-investigation-authority.test.ts`。通过公开 `FeedbackMaterialCompiler.select` 注入只读依赖 seam，验证三条规则：

1. 没有真实读取见证的“可证明为空”不能送入后继模型材料。
2. 有读取见证但 action=needs_decision 的方案，仍不能作为已获决定的补料送入后继模型。
3. 曾经读过但工作区源码版本已经改变的补料，不能复用为当前材料。

实际命令（既有 WSL Node24/test-wsl/bwrap）：

```bash
bash scripts/test-wsl.sh tests/verification/feedback-investigation-authority.test.ts
```

- 首个反例真实失败保留在 [sc-verify-review-counterexample-1.log](sc-verify-review-counterexample-1.log)，当时该反例 1 FAIL；同批 Verification 测试不计入独立审查。
- 主 Agent 修复后首个反例 1 PASS：[sc-verify-review-counterexample-2.log](sc-verify-review-counterexample-2.log)。
- 扩充后的最终拒绝专项 **3 PASS，exit 0**：[sc-verify-independent-final.log](sc-verify-independent-final.log)。

这些用例证明拒绝选择，不证明已运行付费模型或完整端到端恢复。唯一报告不把本人 Verification 专项混作主实现的独立验收。

## Grant、投影与界面来源

已只读核对 `query-drive.ts`：独立 Query reader 使用精确原反馈 ArtifactRef 和当前 basis 申请正式授权，拒绝回执会走查询关闭/缺料路径，而不是继续读取。`persistent-harness.ts` 的 Query grant 注入在 committed 后等待 advanceProjection；`app/service.ts` 的 WorkMaterialDrive grant 注入走 h.grantMaterialAccess，该端口同样在 committed 后推进投影。这样 Vault 紧接着读取时能看到刚接受的授权；Context 自己不发授权，也不绕过 Vault。

已核对 `conversation.tsx`：执行反馈/协调调查标识取自实际 QueryJob 的 execution.kind；任务、Run 和报告摘要取自 feedback 字段；回答、关闭原因及路径/版本取自实际 Query view 和 currentAnswer.sources。stale 回答被标为历史。没有将页面固定文案或模型自报的路径伪装成工具见证。此处是源码与数据通路复核，浏览器显示由主 Agent 的独立浏览器/产品验收证据说明。

## 剩余边界与结论

在上述有限新增反馈链范围，三个独立拒绝反例通过，已报告的具体来源资格漏洞已修；**不由本报告宣布整项产品任务完成**，完整真实开发闭环仍以主 Agent 的最终 HTTP/SQLite/内核和 UI 证据为准。

仍需准确保留的边界：

- 旧调查 closed/gap/stale 后，当前同工作身份补料选择会保守拒绝。每个原 Run 的调查身份固定，尚无完整“替代旧调查并自动恢复所有后继”的实现证据；不能把安全拒绝写成此类恢复已完成。
- 启动可恢复后续工作不等于任意多进程/多 Run 并发恢复已经验证。未独立实测强杀在 RunEnded、Query answer/grant 或 Reviewer 结果等各落盘窗口之间发生的情形。
- 部分后续对账异常当前保留在日志，未形成统一持久的 UI 后续动作失败记录；已有 Query closeReason 会展示，但不应宣称全部组合根异常均已可视化。
- needs_decision 的拒绝专项证明它不能冒充已接受决定；不证明人的决定生成、精确受理和投递刷新全链已完成。
- “可证明为空”当前仅有成功读取的完整空文件见证；未将未找到文件、访问被拒、截断读取或调查未完成统一解释为空。

范围内未发现新的、尚未修复且会直接将这些三类无资格补料送入模型的确定性漏洞。上述恢复/决定/可见性限制保留为未覆盖事项，不以测试数量消除。

## 后续只读复核：样例证据与生产反馈协议

以下为后续两轮只读复核追加，不另建报告，也不将本人 Verification 实现计作独立自审。

发现并反馈的两项样例问题：

1. 原夹具只等工具 outcome=PASS 与 Task satisfied 就保存 `final`，此时轮次和 Goal 归约可能尚未结束；曾观察到保存的 Goal 仍引用旧 Plan。主 Agent 已将等待条件补为轮次 completed、全部聚合 Evidence admitted、Goal 归约回执存在，再保存快照，并保留 Goal 不为 COMPLETED 的断言。已只读确认等待条件；最新运行的 Goal 当前计划和实际阶段以最终新日志/Artifact 为准，不能从 Task satisfied 推导 Goal 完成。
2. 样例规则要求仅转换 ASCII 大写字母，原 `.lower()` 还会转换非 ASCII。主 Agent 已改为 ASCII 字母表的 `translate`，并增加 `ÄBC → Äbc` 行为断言。已只读确认代码和新增断言；规则符合性的最终实测以修复后的新日志为准，不沿用修复前只有英文及空串的 PASS。

另核对生产反馈协议投递：`EXECUTION_FEEDBACK_GUIDE` 由生产 `FeedbackMaterialCompiler.assemble` 加入普通 Run 的规则材料；正文包含 `execution_feedback_protocol`、version=1 和实际 RunRef，先存为该 Run 所有的 Artifact，再以精确摘要进入 rules/sourceRefs/manifest。保存失败会拒绝继续。此协议表达公开反馈格式，不授予读写权限、不替代验收，也不将模型报告提升为正式事实；后继补料仍经过原有精确授权、真实读取见证和当前来源检查。夹具已移除专门教授 JSON 格式的任务指令，并断言实际模型输入包含生产协议。

上述新增约束的只读复核未发现明显来源、权限或伪资格漏洞。交接与模块状态明确区分 Task 满足和 Goal 完成，并保留人的决定回流、调查刷新及恢复限制；完整端到端和浏览器结论必须引用最终新日志，不能将本段源码复核当作这些测试已经通过。

## 后续只读复核：辅助 memory query 的 16 KiB 边界

按主 Agent 的窄委托，读取内置内核 AGENTS/INTEGRATION、`composition-root.ts`、既有 memory-provider 契约，以及 `tests/app/role-material-run.test.ts` 的请求捕获和完整性断言。未修改内核或测试，也未将诊断日志当作修复后的 PASS。

当前改动仅将传给 `EmptyMemoryProvider.recall` 的辅助 query 限制为既有 `MAX_MEMORY_QUERY_BYTES`。函数先 trim，再按 JavaScript 字符迭代累计 UTF-8 字节数，并在添加下一字符将超限时停止；对正常 Unicode 文本不切断 UTF-8 字符或代理对。上限仍来自既有 16 KiB 契约，未放宽 memory schema。

模型输入使用的是先前构造的 `run.turn.userMessage.content = input.input`，没有被该辅助查询函数覆盖。模型上下文容量、输出容量、Run limits、工具政策和权限受理路径均未由这处改动扩大。当前调用方明确使用 EmptyMemoryProvider；该修复不能描述为长期记忆功能已实现，未来接入实际召回 provider 时仍需评估查询截取对召回的影响。

新增测试从真实本地 HTTP 模型请求的 user messages 捕获字符串，并将指定 Run 暴露的完整 `context.input` 与捕获集合做精确字符串成员比较；同时断言该输入的 UTF-8 字节数超过 16 KiB。因此断言设计能够发现本次“把模型材料也一并截短”的回归，而不只是检查模型被调用。它证明的是该样例完整上下文到达模型请求边界，不能推广为任意大小输入或完整 token 容量策略已经验证。

只读结论：未发现该窄修复截断模型必需材料或放大预算/权限的问题；上述测试完整性断言有效。修复后是否实际通过、构建产物是否对应最终源码，仍以主 Agent 的最终重跑日志和源码身份为准。
