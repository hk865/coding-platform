# R2e Git 与当前工作树文本比较：第二阶段单文件实现

验收状态：2026-09-26 已独立通过 next-git-read 15 项/2 文件、next-types，audit 仅授权 git-read.ts 变化且无越界，按 originalAllowedHashes 精确导入。最终 SHA `23330b718f43a2d8f1e9959b76c9aef9e65801ad290785bd3866edc419637815`；证据 reviews/evidence/next-b2-2026-09-26/r2e-mixed-comparison-implementation-import.json。真实两方向 B2/Kernel 正常链完整到达，测试未改；以下保留本次冻结任务，不再重新派发。

2026-09-26，六路径骨架已通过 Astra 有界中审并按 originalAllowedHashes 导入；证据为 reviews/evidence/next-b2-2026-09-26/r2e-mixed-comparison-skeleton-import.json。独立 next-git-read 为原 14 项通过、新 1 项在真实 B2/Kernel mixed 路由明确 unsupported 首红，next-types 通过，audit 无越界。新增正常链及所有测试现已冻结。本任务授权从导入后的 fresh main 创建第二阶段 lane，仅完成以下实现，然后 STOP。

唯一写范围由 R2e-mixed-comparison-implementation-scope.json 指定：

- coding-platform/next/src/core/workspace/git-read.ts

实现已经冻结的 compareGitWorkingTree；其余 ports/access/capture/project-source-tool、全部 tests/helper、原 Git 文件、Kernel、composition、Query/R6/UI 和文档均只读。不得改 frozen test 或以新增 caller 校验/DTO/helper/manager 绕过接口；若有真实不可施工缺口，准确报告给主审，不能扩大 scope。

## 已冻结实现语义

行为真源是 R2e-mixed-comparison-skeleton.md 与 R2e-2-git-read-compare-dispatch.md §6（最新为单次工作树观察）。不要执行旧 §1–5 的上一批任务，不能恢复双读全树或 HEAD 一致性门槛。

1. 比较只有固定完整 Git commit ↔ working_tree 两方向，scope 为已授权普通 UTF-8/no-NUL 文本，结果原 before/after、raw bytes SHA-256、sizeBytes、owner-executable 归一 mode、observedAt、currentness:not_rechecked。路径 add/delete/modified；内容或 mode 任一不同即 modified，不猜 rename，不自造 captureRef/objectId。
2. Git 一侧复用现 git.readTree 及 readGitWorkspaceFile，保留真正 Git OID/tree mode、当前授权和固定子进程/根句柄关闭协议；不重写既有 Git/Git 比较，不调用 diff/show/checkout/filter/任意命令。
3. 工作树只调用一次 captureTextSource 有界观察。局部 read 转发收集同一次 access.read 的真实 mode，原授权、inventory、signal、root 与其他方法仍来自同一 access；不将松散 allowsRead 或 root 变成第二 owner。原 Kernel read 的 raw digest 不得通过重编码 content 重算。mode 缺失、binary/非法编码整次 unsupported，不能默认为普通文本/100644。
4. 这是一份只读观察，complete 只说明所选授权 inventory 和文件读取完整成功；不发布 retained capture，不用于权限/完成提交，不承诺原子全树或未来不变。不得增加第二次全树读取、HEAD 匹配、重试循环、数据库或缓存。原单文件 file_changed、权限、取消和容量真实失败继续沿现 typed failure 语义返回，不能异常时构造空比较。
5. CaptureRegistry 已负责一次 fresh access、track/withAccess/signal/finally release；本函数只消费它。限额复用 maxFileBytes/maxCaptureBytes/maxInventoryFiles/maxQueryResults、GIT_TREE_OUTPUT_LIMIT_BYTES/MAX_COMPARISON_BYTES；结果超限 capacity，不截断后标 complete。模型原输出限额、普通读取、capture/capture 与 Git/Git 语义保持。

## 唯一验收与 STOP

只分别运行既有 next-git-read（2 文件共 15 项，唯一新增 normal it）与 next-types。真实正常链已经冻结：基线 commit → docs 当前内容修改/mode-only/增加/删除 → 原 project_source 两方向 → 后继模型请求携带完整 typed 结果 → 正常 Run 结束与占用释放。不能重写 fixture、删除旧断言、扩大权限/取消/数据库矩阵或重复全 B2/Kernel 检查。

完成提交唯一文件 SHA、这两个检查结果、实际正常链到达位置，立即 STOP；主审负责独立验收、audit 和精确导入，不自行 merge/派发。当前 mixed binary、Git/capture、Git 写入和 Host/UI compare 消费者仍属后续，不能宣称本批全部实现。
