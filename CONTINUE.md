# 下次明确恢复时使用的 prompt

请接手独立仓库 `/home/hyh001/projects/coding-platform/coding-platform-next`，从当前提交继续。本地分支为 `main`，源码远程发布分支为 `hk865/coding-platform:next-main`；文档同步到 `hk865/my-coding-platform-docs:next-main` 的 `docs/`。不要误用两个远程的旧 main。

先读根 `AGENTS.md`、`README.md`、`docs/refactor/HANDOFF.md`、`docs/MVP-BEHAVIOR.md`、`docs/refactor/IMPLEMENTED-CAPABILITIES.md`；按需查 `docs/refactor/reviews/completion-audit-2026-09-27.md` 和 `docs/refactor/skeleton/END-TO-END.md`。有界 completion audit 已完成，不再全量重读历史或重新启动审计。

上轮用户明确要求“接入真实模型后消除非语义错误，验收后停止”，已按该范围完成并停工，**不是整个 MVP 完成**。真实 DeepSeek 验收见 `docs/refactor/reviews/evidence/standalone-2026-09-27/e01-live-deepseek/`：12 次真实模型调用，两个 Work 同 Session 真实改文件，3 次实际检查 PASS，正式 Goal COMPLETED，模型/工具错误为 0；历史读取不新增模型调用。只修初始规划输出 guide 的完整协议，未放宽 parser 或权限检查。初始失败和临时读取配置拒绝也保留，不能只看成功记录。完整示例 UI 仍是已确认设计目标，当前生产工作台不是其全部实现。

这次恢复请按我新给的具体目标推进；若没有给下一目标，先指出已有审计中最小真实阻塞供选择，不自动展开所有模块。不得新增需求、非阻塞测试或顺手重构，不因为有任务书就判阻塞，也不得把既定必需项自动移出 MVP。无验收条件的未来 Task 继续保留；不恢复不存在的 Role 热切换防御。

Work-control 新根 Stage1 已中审、仅存独立 lane，未导入、未 Stage2；若选它，先核当前基线与精确差异，不能盲导旧 lane。A1 旧 lane 未启动，R3g 草稿不等于完成。恢复/返工/并行/Reviewer/协调治理/完整 UI 与旧消费者切换依已有范围和审计判断。

生产变更保持两阶段 DSH：先接口及 Stage1 骨架/测试后 STOP，中审冻结，再实现和必要验收。已适配 runner 在 `tools/dsh-refactor/`；用本仓库 Node 24、npm 锁文件及依赖。相关检查通过就推进，不扩局部测试循环。凭据从本机私有配置读取，不输出或提交；临时数据库不提交。源码原 next 即本根，文档原 W/docs 即本根/docs，历史路径先映射。不要删除旧工程或修改三个候选真实测试工作区；推送沿用户明确指定目标，不强推或改旧 main。
