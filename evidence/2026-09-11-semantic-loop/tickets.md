# 本次委托的有界实施分工

来源：用户本次“最小完整语义协作闭环”直接委托；基于当前 dirty 工作树。

## SC-VERIFY

- role: implementation
- workspace_root: D:/1.project/Software/agent_platform
- ticket_path: evidence/2026-09-11-semantic-loop/tickets.md
- upstream_artifact_refs: evidence/2026-09-11-semantic-loop/baseline.json；evidence/2026-09-11-architecture-convergence/verification.md
- write_scope: src/control/verification-engine/ 内的返工重验实现；tests/verification/semantic-reverification.test.ts（新增）；其他测试须先协调。不修改共享 contracts、app/service.ts、harness 或现有共享夹具。
- 任务：扩展现有 VerificationService，为正式返工 Run 提供恢复安全的当前版本工具重验入口。沿用持久 round/check journal；从已有失败轮次取得授权检查配置，必须核对正式返工来源与版本，不扩大 task 范围。未知工具副作用不重跑；重复触发不重复执行；返回既有结果供组合根继续 Reviewer/返工。必要 Context 接口变动先向主 Agent 请求。
- 验收：直接行为测试覆盖真实工具 FAIL→正式返工→当前重验、重复/恢复/旧版本拒绝，明确未覆盖限制。主 Agent 集成生产调用、最终共享接口和纵向 HTTP 用例。

主 Agent 负责协调反馈、共享接口、Control、Context、组合根和最终集成。最终独立复核另行明确范围。
