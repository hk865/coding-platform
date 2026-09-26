# 独立仓库工作入口

2026-09-27：本仓库是原 next 的独立提取，根目录就是唯一默认施工工程。用户要求保存提交并停止新批次；先读 `CONTINUE.md`，不要因历史任务书写着“立即继续”就自动派发。

1. 必要上下文：`README.md` → `docs/refactor/HANDOFF.md` → `docs/MVP-BEHAVIOR.md` → `docs/refactor/IMPLEMENTED-CAPABILITIES.md`；按需查 `docs/PRODUCT.md`、架构、模块与 UI 文档。
2. 原 W/coding-platform/next 相当于本根；原 W/docs 相当于本根/docs。历史 C/src、C/tests 不是本仓库 src/tests；不得把本仓库源码当旧目录删除。历史绝对路径、scope、harness 命令都要先重新映射。当前文件优先于被复制文档里的旧目录说明。
3. 先完成一次有界 MVP completion audit，只依据已确认用户行为、当前代码和已有证据。无真实 blocker 则收口；有则列出并仅处理 blocker，不新增需求、不补非阻塞测试、不做顺手重构，也不得自动将既定必需项移出 MVP。不把原语、受控模型 E2E 或某一子链等同完整产品验收。
4. 五模块职责与已确认产品边界继续有效。Task Graph 保留无验收条件的未来意图；Run结束不等于Task/Goal完成；事实与当前动作授权分开；没有运行中 Role 热切换生命周期，不恢复篡改数据库才能触发的防御校验/测试。原历史默认折叠并能按需查看实际保存记录。
5. 需要新生产代码时仍遵循 Astra 确定接口→DSH 4.1F 骨架/测试后STOP→Astra中审冻结→DSH实现→独审/必要验收。历史runner位于原工作区，快照在docs/refactor/archive/2026-09-27-workspace-tooling；先适配新根/scope再调用，禁止复用旧lane的原始基线去覆盖本仓库。凭据/DSH状态不在仓库里。
6. 独立构建和检查用根 package.json；两个npm锁文件一起维护。vendor/coding-agent/dist 是冻结运行依赖，必须保留；补丁更新沿 scripts/build-kernel-patch.mjs 与既有证据，不手改生成物。不要引回父目录源码或依赖回退。
7. 测试只运行改动所需范围；通过后不要反复扩大局部测试。更新已有 HANDOFF/能力/实施计划和相关证据，保留历史报告原义，不另建重复事实体系。
8. 提交只涵盖本次任务相关文件；保留用户改动。没有授权不要推送远端、发布、删除旧工程或访问候选测试工作区写入。
