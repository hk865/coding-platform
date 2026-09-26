# W2 领域委托骨架派发

严格第一阶段：只做签名/契约、明确 unsupported 的 Agent 分支和独立目标行为测试，然后停止等待 Astra 中审，不实现授权/提交算法。

主审冻结 W2-agent-whiteboard-skeleton.md §8 的 4 字段依赖、同一 Plan 服务、Actor/provenance、重放与局部 guards 方案；完整阅读全文及 2026-09-26 用户意图/校验补充。B2 两个共享 helper 已独审合入当前快照，可以只读复用；禁止绕回 admitEnteredRun 引入材料/预算准入。最新 §8 已修正 propose/apply 历史重放区别、五类完整 pins 指纹、同 Run 跨两版未来计划、并发回执补查、当前 Session health 和同 Goal 条件。

精确 scope 为原任务 §8 的 4 production + 2 tests，所有新文件已预建。PlanTaskPort 公开调用形状不变，Host 旧路径保持；增加可选 delegatedWrites、版本化 submittedBy codec 和纯 unsupported helper/Agent 分支。不能在骨架中提前实现完整 identify/authorize/CAS，不能给模型添加 Host 通道。生产测试不通过不能由假 admitted 回执掩盖。

测试复用真实 Store、Goal/Plan/Session/claim、Role 和 B2 entry/model 原语。领域测试若通过明确 fixture 建立 Kernel binding，应标注它只证明领域受理，不声称真实 Kernel 消费；至少一条真实 prepare→entered→工具→Plan 组合测试留组合根后续所有者。不要因为主工程 Runtime 仍 unsupported 而将全部前置做成坏夹具；可以在指定 W2-whiteboard-fixture.ts 复用既有 B2 WorkGraph 夹具与正式 entry writer。所有目标红测先证明前置成功，失败位置必须在新 W2 unsupported。

用户新要求的 future intent 节点已在 W2-future-intent-skeleton.md 单独设计。此 lane 不改 RuntimeTask/plan-validation/claim 语义，不硬编码完整规划约束；随后 intent lane 基于本批合入快照继续，避免 Plan 三文件并写。

阅读 DSH-WORKFLOW、DSH-EXECUTION-HARNESS、CODE-QUALITY-GUIDELINES；原地写 scope，不 rename/建临时同级文件/改工具或全局配置。检查 `python3 tools/dsh-refactor/check.py next-types`；主审已注册 `next-agent-whiteboard` 专项。报告复用映射、骨架形状与每类红因后停止。
