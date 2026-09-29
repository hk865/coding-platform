# 双图原型展示窄修（2026-09-29）

只改现有 renderer/CSS，不改 owner、main、DTO 或真实业务状态。使用 docs/UI-WORKBENCH.md 与既有原型 /home/hyh001/.codex/visualizations/2026/09/26/01a0dc16-38ca-7a71-ba7d-fc23e0d3cbed/agent-workbench.html 理解节点图，不复制示例数据。

1. renderArchitectureContainment 的 catalog 有 modules、没有 containment 时，仍复用现有 node/link renderer 显示真实并列根模块，不退化 renderModuleList、不虚构边；缺关系信息折叠显示。
2. 默认节点 caption 使用简短人读状态/模块职责标签，替代长技术 id；真实 id 保留于 title/data/details，完整标题可 hover/selected/pin 查看，不虚构状态。
3. Task 无时间区域压紧：先待执行/时间未知，再验收、未来；保留清楚分类标签，消除每区约150px空白。真实 Run 时间焦点和并行 lane 算法不改。

写范围：src/ui/views.ts、src/ui/styles.css、tests/app/MVP-ui-entry.test.ts。

Stage1：仅扩既有测试一项真实 renderer regression，catalog 有 modules 无 containment 仍有节点/click target，没有虚构 edges。不得实现生产或扩测试矩阵。跑必要该文件验证后 STOP，报告红因和改动计划。
Stage2：主审冻结后同 Session 实现，仅上述生产文件；冻结测试不可改。相关测试通过即停止，不模型/E2E，不触 live 服务或用户目录。
