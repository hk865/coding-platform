# ERR-2026-09-10：外部审查修复与重新验收

状态：active。入口为 2026-09-10 用户委托及[外部审查报告](../../../verification/2026-09-10-external-review/report.md)。范围仅限外审已确认的 Reviewer 恢复、测试可信度、能力路由、接口边界、有界可读性与 D-1…D-8 文档精度；不启动返工重验、记忆、接续、来源正式推进或其他核心功能。

产品根 `D:/1.project/Software/agent_platform`；文档根 `D:/1.project/Software/agent_learn/agent_dev/agent_platform`。两个仓库当前均有大量既有未提交修改，全部保留。本批不 reset/clean/stash/commit/push，不重跑架构一次性迁移脚本，不改 vendor。

## 冻结与恢复入口

修复前证据写入产品 `evidence/2026-09-10-external-review-repair/before/`。其中保留 candidate-04 清单副本、外审独立重算结果、两个仓库的 porcelain 状态、F-01 修复前运行日志，以及所有本批会改测试文件的原始字节。E-1 的 2026-09-09 原始测试字节若无法从可验证备份恢复，继续明确记为证据缺口；不得用本批副本冒充历史字节。

恢复时先读本页、三个 Ticket、外审报告、`human/module-status.md` 与产品 `IMPLEMENTATION-HANDOFF.md`，再核对 before 清单和当前工作树。历史 accepted 记录保留，但受本批影响的相关验收项在本批记录中重新打开，只有最终身份下的针对性、全仓、浏览器、类型、构建、边界与文档检查以及独立审查全部完成后才能重新收口。

## 分工与合并规则

- [ERR-01](ERR-01-reviewer-recovery.md)：Reviewer 启动前失败分类与受控恢复。实现 Agent 独占该票列出的运行时/派发源码和专项测试；不得修改共享状态文档。
- [ERR-02](ERR-02-test-trust.md)：R-2/R-3/R-4、测试替身 selection 与 EU-1 变异验证。实现 Agent 独占测试可信度所列文件；不得修改 Reviewer 生产实现。
- [ERR-03](ERR-03-boundaries-doc-audit.md)：只读核对能力路由、A-1…A-4/R-6、D-1…D-8 和 ReadModel 共享候选，提交契约建议与精确文件清单；第一阶段不修改源码或权威共享文档。

主 Agent 独占共享契约决策、`src/contracts/**`、`src/app/**`、`src/harness/**`、模块映射/检查器、两套 ReadModel、权威状态/架构/Interface/验收/交接、集成与最终验证。任何需要越过票内写入范围的修改先回报主 Agent，避免并发写同一文件。

最终另派未参与相关实现的独立审查 Agent，只读核对修复、反例、测试变化、源码身份和未修边界。
