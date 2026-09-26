# R5b：真实模型初始规划输出契约补全

**已完成并停止：** 两阶段 DSH、中审、独立检查、精确导入及真实模型验收均完成；结果见[本轮证据](../reviews/evidence/standalone-2026-09-27/e01-live-deepseek/README.md)。下文保留本批执行契约，不是继续派发指令。

2026-09-27。独立 main@5bd93abc8cab 首次接真实 DeepSeek：Query 的源码工具正常，最终回答带导语且 tasks/stages/obligations/DAG 子项按猜测生成，正式入口拒绝非 JSON。现有 INITIAL_COORDINATION_RESPONSE_GUIDE 只列顶层字段，未给模型完整协议。这是本批唯一生产缺口；不修模型规划质量，不扩大 MVP，不继续 Work-control。

基线为本次独立工作树；根 AGENTS 的两阶段方法继续。先读 src/contracts/initial-planning.ts、plan.ts、core/work-graph/tasks/initial-plan.ts、plan-record-codecs.ts、plan-validation.ts，以及 core/agent-runtime/query-preparation.ts 的现有注入点和 tests/work-graph/R5b-initial-plan.test.ts 正常链。不得另造 parser/schema owner。

最终范围仅两个文件：src/core/agent-runtime/query-preparation.ts、tests/work-graph/R5b-initial-plan.test.ts。公共类型、解析/验证/采用、Workflow、UI、Kernel、权限与其他测试保持。

最终行为：沿现有 guide 补全准确的 stages、tasks、scope、assignments、obligations/verificationRequirements、parentOf、dependsOn/requires 字段和枚举；可选 taskRelations 与 inputRequirements 要么解释准确字段，要么明确未知时省略，不能让模型猜。最终回答必须是一个可 JSON.parse 的对象，无导语、结语、Markdown。普通 Query 不变；工具调查仍可正常发生。

用一个简短完整 JSON 示范准确格式，放在 BEGIN_INITIAL_PLAN_EXAMPLE 和 END_INITIAL_PLAN_EXAMPLE 之间，明确它仅说明协议形状、所有角色/任务/验收/依赖必须来自实际请求与事实、不能直接复制示例当授权。不把示例内容与当前测试任务硬编码成平台默认。示例含 work、goal gate、真实形状的义务和依赖，pending/active 只是规划初态；gate 不带 executionIntent、不指派执行 Agent，由正式验收链执行检查。plan_only 未来意图仍可缺 assignment/验收。kind 必须遵守实际 CompletionPolicy，role 来自已提供的可用配置；未知需问真正缺失的决定，不能擅自用示例默认补。

Stage1 只扩现有测试（当前生产guide不改）：从正常链实际 provider request 中取得注入的 guide 示范，解析该示范并交给现有 initial planning parser 和正式 Plan codec/validation 做一次形状契约检查。复用现有正常链，不另造完整模型/数据库 fixture；不只检查若干关键词，不用自制 TS 答案冒充给模型的说明。首红应精确落在缺少 guide 示例；旧流程行为断言保留。交付后 STOP，主审核对才进入 Stage2。

Stage2 仅补原 guide（可用原公开类型校验字面量，但不要新建通用 schema/manager）；冻结测试不得改弱。保持严格解析，不截取 JSON、不修补模型输出、不注入伪造的正式结果。

固定检查 next-initial-plan、next-query-execution、next-types。通过后构建并用同一小型临时项目重新跑真实模型 UI，验证规划采用→实际编辑→真实检查→正式完成；只修该链非语义错误。无需全量矩阵或额外异常/并发测试。
