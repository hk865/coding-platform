# 按工作区恢复已选显示身份（2026-09-29）

仅 src/ui/main.ts 与 tests/app/MVP-ui-entry.test.ts，当前根dirty基线新lane。

每scope独立保存goalId/sessionId/mainSessionId等显示ID，全局仅lastscope/theme；另一浏览器tab修改B不能抹掉A。不得存正文/token/业务事实，不造Goalstore、不自动选最新。旧v1只迁移其明确scopeKey。save必须固定origin ScopeState，异步完成不隐读selectedKey。切scope按正式goals/read、sessions/read/history恢复，Goal ready同步当前goal事实与目标字段；慢恢复不能覆盖随后用户选择，使用原有身份/代机制或最小scope显示代。缺失/不匹配正式读取不伪成功；只恢复显示，不submit/claim/createSession/模型调用。原在内存scope草稿和辅助tabs不丢。

Stage1：提出现有main内最小可测试接缝，最多两个必要行为case：不同scope独立保存/旧v1归属；正式读取原IDs恢复且慢响应不覆盖新选择。可扩现有MVP-ui-entry测试，禁止大型DTO/helper框架与生产完整实现。给真实红因/接口后STOP主审冻结。
Stage2：主审批准后实现并跑相关限定检查，不触后端/服务/真实工作区。
