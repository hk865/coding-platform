# R4c.2a history 第二阶段：实现已审核骨架

第一阶段已交主审；只有主审完成本轮骨架/测试审核后才运行本prompt。沿同一Session继续，但物理环境为新冻结快照，允许写的仅 `src/core/agent-runtime/observation-recovery.ts`，测试与契约只读。

先复读 `docs/refactor/tasks/R4c2a-history-skeleton-prompt.md` 的功能语义和复用表；其中“本次只写骨架”由当前实现阶段替换，其他边界保持。核对 docs/refactor/IMPLEMENTED-CAPABILITIES.md 对应能力、模块文档及相邻源码，先报告复用入口，再填当前骨架，不扩建其他层。主审如增加测试/注释，以当前只读文件为准。

完成后运行 `python3 tools/dsh-refactor/check.py next-types`、`python3 tools/dsh-refactor/check.py next-execution-history`、`python3 tools/dsh-refactor/check.py next-architecture`。不能改测试来过关；发现契约矛盾给出具体出处，停止该相关改动，继续独立可做部分。不能用any绕过类型、不吞损坏/未知为成功、不额外重复扫描或注册schema。不得改其他文件、提交、装依赖或读取凭据。

最终说明实际复用了什么、最小新增逻辑、实测结果和限制；不把局部读能力说成完整R4c.2/真实执行/恢复已完成。主审独立验收不由本lane自行宣布。

中间审核已修正测试错误并补入原始页污染、partial identity、原actor游标、上下文隔离及固定扫描上界。底层SessionHistoryRequest不含executionIdentity，不得为错误旧断言额外传递；ArtifactRef body固定unsupported；scannedCount等于原page.items.length，并不等于物理IO。afterCursor封装底层page.nextCursor，与entry.cursor完全不同。请重新读当前冻结测试。
