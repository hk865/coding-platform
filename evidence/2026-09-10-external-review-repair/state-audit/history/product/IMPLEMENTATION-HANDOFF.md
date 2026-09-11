# Agent Platform 当前交接

更新：2026-09-10。产品根 `D:/1.project/Software/agent_platform`；权威文档根 `D:/1.project/Software/agent_learn/agent_dev/agent_platform`。

**用户2026-09-09已明确本轮仅继续实现独立Reviewer；完成后将架构与Reviewer交其他模型审查，其余核心功能待审查后动工。** 架构批次与VR-01工具轮次均已验收；VR-01最终全量日志、六份697文件清单/实际源码及10份日志摘要已独立确认。已验收[VR-02](../agent_learn/agent_dev/agent_platform/dev_docs/planning/active/core-verification/VR-02.md)，以该票唯一写入范围为准。上次退出记录见[暂停检查点](../agent_learn/agent_dev/agent_platform/dev_docs/planning/active/core-verification/PAUSED.md)。全部有效义务、未提交修改与历史资料保留，不设置用户未配置的累计Token/调用/时长预算。

## 当前进度与入口

（历史：架构重建批次，2026-09-09）架构重建批次已验收：12 Module 独立职责/DI 审计通过，10 项发现关闭；319 个 TS/TSX 静态边界检查无违规。全仓 235 文件/1519 项、浏览器 19 项、完整构建及两套类型检查通过。仍有模块内重复投影、大处理器和旧命名，完整自治产品未完成。

[VR-01 工具验证轮次](../agent_learn/agent_dev/agent_platform/dev_docs/planning/active/core-verification/VR-01.md) 已验收，接入真实Task/Context/命令沙箱/Vault/Control/HTTP/UI。固定697文件全仓239文件/1561项、浏览器21项、两套类型、原构建、325项静态边界和文档校验通过，最终日志及源码身份已独立确认。Reviewer共享契约与实施票已发布，Control/Dispatch、Verification、Context/WorkspaceReader由三个子Agent分工实现，主线负责Runtime/HTTP/UI和最终验证；本票Reviewer已完成全部运行验证和独立终审，准确证据见最新交接。

- [唯一模块状态](../agent_learn/agent_dev/agent_platform/human/module-status.md)：哪些能力可用、哪些缺失及验证边界。
- [架构与源码入口](../agent_learn/agent_dev/agent_platform/dev_docs/interfaces/module-boundaries.md)：12 Module 的实际接口、状态权威、依赖和恢复语义。
- [当前工作包](../agent_learn/agent_dev/agent_platform/dev_docs/planning/active/core-verification/README.md)：子票、写入范围和主线接续规则；[架构工作包](../agent_learn/agent_dev/agent_platform/dev_docs/planning/active/architecture-rebuild/README.md) 已按本批范围验收。
- [最新Reviewer集成交接](../agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-09-independent-review/integration-handoff.md)：实际接线、审计问题、证据和接续；[VR-01交接](../agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-09-core-verification/integration-handoff.md)与[架构交接](../agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-09-architecture-rebuild/integration-handoff.md)保留已验收批次。上下文压缩或环境变更后先读当前交接及票，再核对源码身份。

本批已收敛：Control policies/records 与正式命令、PlanCompiler/OperatorPlanning、Dispatch 恢复与 claim/launch、Verification 生命周期、History/ScopeCatalog、Context 取材及提示、WorkspaceReader 原生来源、Vault 授权政策及独立持久观察源。两项探索来源读取回归此前已修，本批再通过真实消费者确认。未配置的 Reviewer/控制/接续和迁移门禁必须返回 incomplete/unsupported/拒绝，不能默用模拟成功。

## 验证及运行约束

已验收VR-01证据位于 `evidence/2026-09-09-core-verification/`：`full-tests-workers2.log`退出0，239/1561全部通过，1116.70s；`browser-final.log`21/21，退出0。candidate、workers4-end、browser-end、full-end均为697文件、摘要`ddf3fa92797c7eb3ae46db809762cb6c25002fea10c41722ab8073d700741f6b`。首轮仅旧用例5秒超时的失败日志保留；未放宽超时/断言或更改待验源码。完整明细见[VR-01验收记录](../agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-09-core-verification/acceptance.md)。这是此前批次的结束状态，不能据此断言当前Reviewer没有运行中的测试或Agent。

当前Reviewer证据在 `evidence/2026-09-09-independent-review/`。candidate-04为730文件、摘要`1234c2efa1bd3698a2836ed29f5dc8af6edf9e8202dee7755fe3b72a67bfcfd0`；两套类型、原构建、345项边界及完整浏览器23项已通过。A01–A04（归约并发、三类派发隔离、页面轮询、旧HTTP提示兼容）已独立闭合，A04原HTTP与相关分类47项通过。修复后的最终全仓已exit0：249文件/1633项全部通过，1531.30s，日志`full-tests-final-workers2.log`；五份730文件清单、实际源码与18份日志摘要已独立确认相同。03的完整失败轮次及所有旧候选/日志保留，最新接续见Reviewer交接；本票现已按限定范围验收；所有测试/构建进程已结束。

架构证据位于产品 `evidence/2026-09-09-architecture-rebuild/`，汇总见 [验收](../agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-09-architecture-rebuild/acceptance.md)。`ar12-candidate` 与 `ar12-full-end` 为相同 685 文件快照；`full-tests-workers4.log` 退出 0，652.22s。最终仅浏览器 spec 的旧接口拦截修正；`browser-final-start/end` 相同，`browser-tests-final.log` 19/19、退出 0，2.2min。逐项身份与日志摘要见 `final-source-identity.json`。早期超时/环境/旧测试失败均保留。旧 221/1464 只覆盖前批。

已配置工具链为 WSL Ubuntu-24.04，目录 `/mnt/d/1.project/Software/agent_platform`。测试入口 `bash scripts/test-wsl.sh`；类型入口 `.local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit`。构建以 package.json 为准；内核本批未修改。真实内核配模型 stub、外部模型、浏览器、OS 强杀与 benchmark 证据必须分开报告。

VR-02独立Reviewer已验收，现交用户安排其他模型审查架构与Reviewer，不自动启动其余功能。授权返工、来源推进及完整重验、补料、工作Context、人的决定、真实控制/新Run接续、记忆、架构演进及总验收继续保留，待此次审查后动工；具体依赖见[核心接续](../agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-09-architecture-rebuild/core-continuation.md)。既有授权决定继续有效：同Project可由人显式精确授权跨Workspace材料，禁止自动共享。

## 历史追溯

[本次整理前交接](../agent_learn/agent_dev/agent_platform/dev_docs/archive/2026-09-09-before-architecture-rebuild/product/IMPLEMENTATION-HANDOFF.md)保留原日期增量；[前次有限收尾](../agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-09-module-closeout.md)保留两项回归的原始失败与义务。[架构批次暂停页](../agent_learn/agent_dev/agent_platform/dev_docs/planning/active/architecture-rebuild/PAUSED.md)是此前已恢复的历史暂停；本次以核心工作包PAUSED为准。旧localhost地址/数据目录不代表当前服务正在运行。

已执行的七个一次性迁移脚本保存在 `evidence/2026-09-09-architecture-rebuild/migration-scripts/`，不得重跑。长期检查保留在 `scripts/module-map.mjs` 和 `scripts/check-module-boundaries.mjs`。没有批量删除历史、提交、推送、reset 或 stash。
