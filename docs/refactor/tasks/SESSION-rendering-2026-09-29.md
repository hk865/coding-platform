# Session 正常会话渲染

用户指出原型布局恢复后，中央会话仍是事件与结构化文本，至少需要正常渲染。当前只读调查确认：Host 仅接入配置中的真实目录，界面新增目录尚无入口；该问题与本渲染范围分开记录，不用浏览器上传冒充真实目录绑定。

本批由既有 SessionHistoryEntry 投影消息，不改 Kernel、领域历史、存储或原型布局。正文使用本地打包的 marked，代码围栏/行内代码/段落/标题/列表/引用/表格正常渲染。HTML 作为文本、链接仅明确允许的协议、不自动加载远端图片。完整保存原文仍可按需展开，不能被 Markdown 替代或丢字段。

工具从 assistant.message_completed 的 toolCalls、tool.started.payload.call、tool.completed/failed/cancelled.payload.result 读取正式 name/arguments/callId/output/error/status。以 adapter + kernelSession + runId + callId 关联，不能相邻配对，不能跨 Run 错配。默认展示易读工具名称、主要路径/命令、状态及可展开参数/输出；相同调用不制造多个完整卡片。原始事件顺序和每条来源保留；分页缺少前后项时如实显示未知，不伪造完成/运行状态。run.input_accepted 来源不能一律假装人类输入。用户/助手正文不再任意截450字。

模型请求/用量/生命周期等技术记录降到折叠详情。默认时间用短格式，ISO与position保留在原始详情。当前仅有持久历史接口，不承诺逐字流式。中央历史首批50条，并在会话内给出继续加载入口，追加沿原游标，不切掉前文；刷新、切成员、辅助历史页保持各自原有归属与失败状态。不要全量自动拉全库、不要新建聊天状态owner。

构建：使用已固定安装的 marked@18.0.14、esbuild@0.28.2，构建脚本在原TypeScript检查后打包本地浏览器依赖；不依赖CDN，不扩Host静态目录访问范围。固定检查：新Session渲染风险测试、既有R6-workbench与MVP-ui-entry、typecheck和build，之后实际浏览器看现有保存历史，不为UI重跑真实模型。

两阶段 DSH：先在新lane写最小渲染骨架及必要风险测试，STOP；主审核对再实现。禁止更改测试迎合实现、重写主工作区已有未提交改动、动真实候选项目、增加业务manager或传输事件协议。

## 本批完成范围（2026-09-29）

两阶段 DSH 已 STOP，主审后导入并完成必要修正。既有 Session 的 Markdown、声明型与实际工具事件、输入来源、已知计划易读投影、未知 JSON 折叠及完整原文入口已接通；分页按 generation/cursor 追加，浏览器实际核对 50→85 条、前缀保留和身份唯一，以及 position 84 完整原记录。

Node 24 类型/构建与 3 文件 28 项检查通过；后续计划显示断言的 12 项检查及 UI 类型/构建通过。完整范围见[验收记录](../reviews/evidence/session-rendering-2026-09-29/README.md)。本批没有新产品模型调用、项目写入、逐 token 流式或语法高亮；未实现界面目录注册，不宣告整个 MVP 完成。
