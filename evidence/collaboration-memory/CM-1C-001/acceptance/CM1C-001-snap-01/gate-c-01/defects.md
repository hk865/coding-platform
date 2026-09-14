# Gate C 缺陷记录

## C-ACCEPT-01 — 探索专用 Run 获得协调写入口

状态：OPEN，阻断本快照 Gate C。严重度：高。条款：C02/C04及既有探索权限边界不退化。输入1288文件SHA d0dadb34031309df103d7e9ad293be4d8210850d93a2895d56d245cfe3b45f05。

位置：src/app/service.ts:185 全部真实harness开启首次分配；src/control/dispatch-engine/dispatch-engine.ts:171仅依布尔配置调用ensureInitialWorkAssignment，尚未区分已prepare的explore/review模式；src/execution/worker-runtime/coding-agent-runtime.ts:286加入协调工具时未拒绝这两个专用模式。

复现：在WSL产品根及既有Node24 PATH运行 bash scripts/test-wsl.sh tests/app/explorations.test.ts -t 'executes a real read-only dependency chain' --maxWorkers=2。使用该测试隔离数据库和真实服务；由root集中全量及定向独立于本验收进程复现，验收者读取真实源码/完整失败diff确认，不重复启动同一复现。

预期：explore模式仅原纯读工具 code_index/cpp_index/list_files/project_index/python_index/read/search/source_excerpt/symbols。实际：ModelRequest另有 coordination_cancel/mailbox/request/respond/subscribe/wait 与 report_architecture_conflict。日志 implementation/CM1C-001-snap-01/logs/exploration-repro.log（1失败/7跳过，tests/app/explorations.test.ts:71），集中全量同例失败。

影响：专用只读探索流程暴露可写协调领域入口；不是文件写权限提升，但违反专用模式语义且是产品回归。普通document-advisor只读文件运行可按明确角色授权协调，不能一概删除普通协调能力。

回交owner：/root。有限修复：Dispatch首次分配仅exact实际prepared且mode未设的普通Run；Runtime在explore/review拒绝协调入口，补真实探索/review负例和普通C首次分配正例。须新快照独立重验，不在本快照源码修补后沿用PASS。

此前独立5文件74例通过仅证明其覆盖范围，不能覆盖此缺陷。本快照最终Gate不得PASS。