# AG2a 显式咨询接收与正式回复验收

2026-09-28。对应 [AG2任务](../../../../tasks/AG2-consultation-2026-09-28.md) 与 [MVP路线](../../../../AGENT-BEHAVIOR-PLAN.md#8-到达-mvp-的路线与证据导航)。用户本轮要求读取分享、形成到 MVP 的文档并完成下一步；本批只闭合显式咨询接收与回复，未宣告完整 MVP。

## 已实现的行为

原消息 → 同一工作台点击“处理咨询” → 原 idle 收件 Session → 既有 Query / Kernel 读取源码 → 正式 Answer → 原消息单 response 槽。Query 仍只读；Host 仅从正式 Answer/Run 派生回复身份和正文，不自填 Agent 答案。普通读取/发信不调用模型，busy 不抢占或创建替代 Session，历史 Answer 先补挂，后续 Session 状态不否认已发生结果。

没有自动唤醒、阈值/心跳后台调度、原发信 Work 自动续接或新的 Agent/事实数据库。待补的原发信 Agent 感知回复、恢复上下文并重新决策在路线中单列；AG3–5 和既定完整 MVP 门槛保持。

## 工程检查与独审

- DSH Stage1：仅 AG2 测试变化，3个场景实际抵达缺失 HTTP 路由；主审修正两处断言后冻结，见 [中审](stage1-review.md)、[RED](stage1-red.log) 与 [hash](stage1-frozen.json)。
- DSH Stage2：新快照、15个生产文件变化、无 scope 越界，精确导入前逐文件核原工作树hash；保留以前的 dirty 改动。未提交/推送。
- 一次集中返修：Query submit带原消息revision guard；Answer补挂保留原`bodyRef.source`；UI网络/403失败保留原请求，成功后按原scope/Session/message刷新。普通消息来源校验没有全局放宽。
- 主审最终独立检查：**12文件/115项**通过（[日志](tests.log)），[Node类型](next-types.log)、[UI类型](next-ui-types.log)、[模块边界](next-architecture.log)、[隔离构建](next-build.log)均exit0；本地运行产物[构建](local-build.log)通过。未扩大到全仓测试。
- 原消息guard与历史来源由独立审查确认；不声称增加了完整并发/失败矩阵。细节与精确版本见 [verification.json](verification.json)、[生产diff](production.diff)。

## 真实模型与实际浏览器

使用临时单文件工作区，不修改三个候选真实项目。DeepSeek flash、thinking disabled，实际 Host/SQLite/Kernel/源码工具；凭据只从已授权私有文件读入进程，不保存在证据。

| 路径 | 模型请求 | 成功工具 | 工具失败 | 结果 |
| --- | --- | --- | --- | --- |
| 正式HTTP显式咨询 | 4 | 3 | 2 | 两次参数schema错误后模型修正；读取随机常量并完成真实Answer/回复 |
| 同Session第二条，浏览器实际点击 | 3 | 2 | 0 | 页面显示原成员回复、正确随机常量、原来源，处理按钮因已回复禁用 |
| 原请求重复处理、同SQLite/Kernel重开后处理 | 0新增 | — | — | 保留原消息/Query/Answer，不再调模型 |

发信与普通读取无新增模型。总计7次模型调用、provider错误0，但**不能称本轮零工具错误**；两次`invalid_arguments`保留在 [实际历史事件](tool-events.json)。同Session第二条为3次模型/2次成功工具/0失败。限定链验收见 [live-result](live-result.json)、[浏览器步骤](browser.json)、[脚本结果](live-test.log)。临时Host已关闭并清理数据库；报告URL仅作当时证据。

答案准确读出随机值并区分注释边界与实现未知，但其中“捕获一致就说明期间未修改”的表述过强：仅能证明观测时内容一致。语义质量仍按来源与人判断，不以本次链路通过保证普遍可靠。第一条请求人为Host发信，接收方是真实模型；AG1已有真实Agent发送的独立证据，本批不冒称发送方Work已自动恢复。

复跑将 [live-script.ts](live-script.ts)、[live-config.mjs](live-config.mjs) 分别放回 `.toolchain/ag2-live.test.ts` / `.toolchain/ag2-live.config.mjs`，根 Node24构建后运行vitest并设置`DEEPSEEK_API_KEY_FILE`。`AG2_KEEP_HOST=1`供实际浏览器处理第二条后向该测试worker发送SIGINT收尾；未设置则只验第一条及重放/重开。保存的 [history-check](history-check.mjs)只导出模型计数与工具结果，不导出私有推理。

## 本批代码增量

相对本批开始时完整dirty基线，生产15路径**净增1,016行**；这是咨询能力接线，不能称为减量重构。不改Kernel，不新增工具权限或第三方依赖。逐文件哈希/增删见verification；本表不覆盖先前AG1/AG6。

| 生产文件 | 新增 / 删除 |
| --- | --- |
| `src/contracts/query-job.ts` | +57 / −1 |
| `src/core/work-graph/queries/contracts.ts` | +8 / −0 |
| `src/core/work-graph/queries/query-job-service.ts` | +68 / −2 |
| `src/core/work-graph/queries/query-execution.ts` | +14 / −0 |
| `src/core/work-graph/communication/contracts.ts` | +29 / −2 |
| `src/core/work-graph/communication/message-record-codecs.ts` | +69 / −8 |
| `src/core/work-graph/communication/mailbox-service.ts` | +249 / −14 |
| `src/business/workflow/contracts.ts` | +38 / −2 |
| `src/business/workflow/ports.ts` | +31 / −2 |
| `src/business/workflow/workflow.ts` | +19 / −5 |
| `src/business/workflow/consultation.ts` | +355 / −1 |
| `src/composition/create-platform.ts` | +22 / −9 |
| `src/app/core-http-types.ts` | +8 / −1 |
| `src/app/core-routes.ts` | +5 / −1 |
| `src/ui/main.ts` | +93 / −1 |
