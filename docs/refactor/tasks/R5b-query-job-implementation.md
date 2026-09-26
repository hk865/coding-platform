# R5b.1 Query pending 受理：第二阶段实现

状态：2026-09-26，骨架与两份测试已完成主审并导入 main；11 个目标首红均为待实现入口，types 通过。现在从最新 main 创建独立 implementation lane，正式授权下列两生产文件实现。

唯一行为依据为 [主任务 §4–5](R5b-query-planning-skeleton.md#4-r5b1-精确-dto-与依赖待主审冻结)及已中审接口/测试；按用户 MVP 调度优先公开无 Plan 正常受理链，不增加测试场景或完备矩阵。先读 docs/AGENTS.md、当前 IMPLEMENTED-CAPABILITIES 与实际复用源码。

## 两文件写范围

完整白名单见 [scope](R5b-query-job-implementation-scope.json)，路径相对 `coding-platform/next`：

1. `src/core/work-graph/queries/query-job-service.ts`：实现公开 pending submit/read、原 identity 回执恢复与单次局部事务。
2. `src/core/work-graph/queries/query-record-codecs.ts`：实现已冻结 QueryJobSnapshot@1、QueryJobSubmitted@1 codecs，继续复用已有 QueryRun validator/唯一 schema owner。

其余全部只读，包括 tests/fixtures、queries/contracts.ts、contracts/query-job.ts、materials/record-readers.ts、composition/create-platform.ts、Runtime、Session、Plan、M1/M2、Kernel 和原工程。`validateQueryRunSnapshot` / `QUERY_RUN_RECORD_SCHEMA` 的窄导出是已有功能复用，不再修改，不另注册 QueryRun。不增加文件、数据库、manager 或 engine；接口确有缺口时报告主审，不扩大 scope。

## 实现约束

- 沿主任务 §4–5 的既定算法：首 await 前隔离输入并保留 signal；可信 Host scope/结构校验后精确 identity/fingerprint lookup，原回执优先；miss 才读真实 Project/Workspace/Goal 和必要 focus Plan，局部 guards 一次提交 pending Job、pending Run 与 Submitted 事件。0 pin 编译为缺席 null，不使用全账本 horizon，不写 Goal/Plan/Task/Session。
- intentId 绑定实际 queryJobId；meta.requestId 仍独立用于提交幂等。原事件保留实际 human/system actor，submission 仅为 writer 产生的 locator；通过 lookup cursor→eventAt 恢复，不扫描事件、不以当前 Run 状态重造原回执。同 identity 改 input/有效 expected 必须冲突；真实提交失联只在 lookup found 后恢复 committed，未知诚实 unavailable，不重复提交。
- 无 Plan、无 baseline/CompletionPolicy、无 Runtime 配置仍可公开受理 initial_coordination；已有 Plan 可受理 semantic_query，包括 execution 缺省的历史兼容形状。initial_coordination 显式声明执行 kind，不能从问题文本猜测。非空 focus 核真实 Goal 当前 Plan 成员即可，W2 plan_only 节点可查询，不追加执行门禁。无 Plan 未知 focus 返回 invalid，跨 Goal 返回 forbidden，沿中审期望即可。
- readQueryJob 为窄 Host scope 历史读取；不重审无 Plan、材料/source 当前性或 Session 占用。已存在 Job 的应有 Run 缺失不能伪装正常空结果。旧无 submission snapshot 保持可读；codec 管持久形状，业务准入归 service。commit 前取消零写，真实提交后的晚取消保留 committed。

## 检查与交付

只运行固定 `next-query-job` 与 `next-types`，不追加邻接或 Kernel 矩阵，不改测试来迁就实现。中审修正仅为：intentId 随实际 Job、冲突测试复用真实首请求、删除缺省 execution 却要求 invalid 的错误断言；用例数量保持 11。

报告两文件 hash、真实检查结果和实际到达的空 SQLite→公开 bootstrap/Goal→pending submit/read→重开/原回执链；尚未到达的后段如实说明。完成后 STOP，交主审独立验收，不自行导入 main。本批不 claim Session、不准备 bundle、不捕获源码、不调用模型、不产 answer、不采用 Plan；R5b.2–4 另批沿同一 Session/Kernel 执行链接续，不强转 Work Run。
