# 主审与独立迁移审阅

2026-09-24。主审复现：36 files / 250 tests PASS，类型、边界、构建、编译产物装配通过。

独立只读子任务 `/root/r4a_candidate_review/schema_readonly` 核对原源码与目标：observed-model-run/exploration-tools 在移除导入与类型/注释后可执行主体相同；source-capture-access 在 ledger→authority 依赖名替换后主体相同。BoundModel/SourceCaptureAccess 形状保持，SourceRunSpec 仅裁去未消费字段；QueryExecutionRequest 复用同构的持久请求格式。

保留的行为：Work/Reviewer/Query 完整身份，Query 原始提交者和分页游标核验，取消/失败清空 origin，read 许可，finally 尝试全部释放以及原错误优先级。skills、Python/C++ helper/archive 均为 next 实体路径；宿主 Python/libclang 依赖与原实现一致。

边界：未宣称 SourceAuthorityReads 的生产 provider、平台 startRun/Session/Query/GUI 已实现。测试中的事实夹具与模型替身仅用于相应组件验收。未要求 DSH 重写已验收实现。
