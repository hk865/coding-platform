# 继续用的 prompt

请接手这个独立仓库：`/home/hyh001/projects/coding-platform/coding-platform-next`，从 `main` 当前提交继续。先读取根 `AGENTS.md`、`README.md`、`docs/refactor/HANDOFF.md`、`docs/MVP-BEHAVIOR.md`、`docs/refactor/IMPLEMENTED-CAPABILITIES.md`，再按需核对 `docs/refactor/skeleton/END-TO-END.md` 与已有验收证据。不要全量重读历史。

上次因额度将尽冻结施工并提交，**不是宣告整个 MVP 已完成**。首要任务只做一次有界 completion audit：将已确认 MVP 用户行为逐项对应到真实生产入口、当前实现、已有 E2E 证据和明确缺口。禁止新增需求、非阻塞测试或顺手重构；不要以“还有任务书”就判阻塞，也不要为了宣布完成把既定必需项自动移到 post-MVP。若无真正 blocker，更新现有文档并收口；若存在 blocker，先简要列出，再只完成阻塞当前 MVP 的最小必要工作。

已交付的限定路径：调查/初始规划→采用→两个 Work 复用同一 Session→checks→正式 Goal COMPLETED；Task 图→当前 Run→原 claim Session→本次执行窗口→完整原历史。完整保存记录可按需展开，辅助历史重复渲染已修复并做实际浏览器复验。模型是受控 provider，普通历史读取没有模型调用。最新独立提交验收看 `docs/refactor/reviews/evidence/standalone-2026-09-27/`，不要把旧的 124 文件/1,102 项快照自动当当前所有后续改动的证据。

冻结时：Work-control UI 草稿尚未派发；A1 ended-work-link 只在旧工作区 prepare，未启动 DSH、无产品候选；R3g policy writer 等草稿也没有因为保存而自动完成。恢复、Reviewer、协调/治理、完整 UI、旧消费者切换的剩余项以现有范围与审计为准，不要照旧聊天中“只剩最后签字”的估计下结论。

源码原 `coding-platform/next/` 现为本仓库根；文档原 `W/docs/` 现为 `docs/`。历史证据与任务书保留旧路径/哈希，先映射后使用；原旧产品、DSH lane、配置/凭据和临时数据库未提交，不要从旧lane盲目导入。需要继续生产施工时，保留两阶段 DSH 工作法，先适配现有 runner 与新 scope；先前没有完成的新骨架必须从此提交重新取基线。

验证使用本仓库 Node 24 和 npm 锁文件；相关检查通过就继续，不扩大局部测试循环。未经要求不推送、不发布、不删除旧工程、不修改三个候选真实测试工作区。
