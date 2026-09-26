# R2e.2 Git 读取与比较：第二阶段实现候选

2026-09-26。**八文件骨架已通过最终中审并逐一校验导入，执行本第二阶段。** 唯一行为依据为 [原任务](R2e-2-git-read-compare-skeleton.md)及 [中审返修](R2e-2-git-read-compare-middle-repair.md)。本文只收窄实现写范围，不重新定义长期协议。唯一写范围见 `R2e-2-git-read-compare-implementation-scope.json`；在主审新建的当前快照lane内运行，不能沿用返修前hash。

## 1. 候选写范围：仅一个生产文件

相对 `coding-platform/next`，第二阶段只写 `src/core/workspace/git-read.ts`，完成其中三个已有落点：`createWorkspaceGitReadAccess` 的真实 bound Git I/O、`readGitWorkspaceFile` 的原字节映射、`compareGitWorkspaceTrees` 的对象/mode 比较。

已只读核对返修中的接缝：`capture.ts` 已将 `deps.now` 传给 read helper、完整 limits 传给 compare helper，并在 Git 分支核本地 ctx/workspace；helper 已声明 `maxQueryResults`。因此本阶段无需把 `capture.ts` 列入写范围。冻结后若实际基线与此不符，先向主审报告精确缺口，不自行扩大 scope。

其余生产、两份目标测试及所有邻接测试只读，尤其 `ports.ts`、`access.ts`、`capture.ts`、`workspace-read.ts`、`project-source-tool.ts`、Runtime、组合根、Kernel/vendor、检查脚本及依赖/构建文件。不得改断言、引入测试注入接口、额外 Git 工具或新 capture provider。

## 2. 实现与复用约束

- 继续使用真实 access factory 已绑定的 `acquireRootHandle`、`allowsRead`、signal/live。根句柄来自公开 `WorkspaceSandbox.acquireRootHandleForProcess`；不从 workspaceIdentity 猜路径，不另写 root 身份算法。Git 进程 cwd 固定到仍打开的目录句柄；核仓库顶层与该根一致，合法 linked worktree 保留，注册为父仓库子目录、裸仓库或非仓库明确 unsupported。
- Git read/compare 已进入原 `track/withAccess/finally release/close`；同一 comparison 的两树共用一次 fresh access。Git helper 只拥有本次子进程和根句柄，全部 child 实际 close 后才关闭句柄、结束操作。caller abort、timeout、registry.close 均沿同一退出路径；只发送 kill 或观察 signal.aborted 不算完成。无后台守护、长期树缓存、第二 registry 或新 retained capture。
- 用 `spawn('git', fixedArgs, {shell:false,...})` 执行原任务 §4 的固定 metadata、单 OID batch-check、NUL tree 与 blob 命令。复用 `VerificationWorkspaceReader` 已有只读 flags/顶层核对行为，但不调用其 current-head-to-worktree 业务流程或私有 git 方法。禁止 diff/show/textconv、clean filters、hooks、工程脚本和任意 argv；路径不用 `commit:path` 拼接。
- 环境只按原任务批准值构造：清除外部 `GIT_*` 重定向，禁系统/全局配置、prompt/pager、optional locks、replace 与 lazy fetch，固定 locale。不能借固定 argv 忽略环境污染；不能自动联网获取缺失对象。
- OID 必须完整小写且与仓库 object format 一致；不解析 HEAD/ref、缩写或表达式，不 peel 非 commit 对象。batch-check stdin 仅一个验证后的 OID 加换行并结束。只由成功退出且唯一、完整、同 OID 的机器响应判定 missing；非 commit 为 invalid，异常/畸形/非零退出为 unavailable，不靠 stderr 或 exit 128 猜 not_found。
- 使用同一个 allowed 谓词过滤历史路径，先于返回路径/OID/错误样本；不因工作树文件已删除而拒绝历史读取。单文件精确读取，不捕获工作树或读全仓正文。先核普通 mode 与 blob size，再读 raw bytes；严格 UTF-8/no-NUL，BOM 展示沿原约定，SHA-256 与 sizeBytes 始终取原字节，readAt 用传入 now。
- tree 比较使用 path→objectId/mode 的短期集合，mode-only 也为 modified；二进制普通文件可比较，read 二进制仍 unsupported。域内 symlink/gitlink 等非普通项整次 unsupported。不同路径同内容仍 add/delete；不调用会产生 capture rename 语义的 `comparisonChanges`。可复用 `diffContent` 的路径集合思路，不能将 Git OID 假装成 capture 正文 digest。
- 直接复用 `workspace-read.ts` 已导出的 `MAX_COMPARISON_BYTES`，不复制常量或改旧 capture 算法。进程 5 秒上限、流式 stdout/stderr 界限、tree 的 maxInventoryFiles/8 MiB、blob maxBytes、结果 maxQueryResults/序列化字节上限均在对应边界生效；不能只限制授权过滤后的数量而无限读取。越界终止并等 child close，返回 capacity，无部分 changes+complete。
- 返回冻结 DTO 的完整 commit/objectId/mode/scope 标签，prefix 按字面路径边界。`complete` 只覆盖本次授权普通文件域。保留 mixed unsupported、working_tree compare invalid 和旧 capture 协议；不改模型输出上限，不裁剪结果冒充完整。过大时保留明确失败，由调用者缩小 prefix。

## 3. 验收、交付与停止

使用既有隔离 harness/check.py 登记的 `next-git-read next-git-read-neighbors next-runtime-execution`；`next-types` 与 `next-architecture` 分开执行。读取冻结的两份目标测试，特别是真实 child stdin 悬停/根句柄 forwarding 观察窗口；必须调用真实 child，不能为了过测虚构退出、跳过释放或替换对象结果。不要自行跑全量 next-tests 或改 selector。

交付报告只列实际变更文件/hash、目标及邻接检查结果、真实失败与未达后段、资源关闭证据和可复用点；任何范围外必要改动先报主审。完成即 STOP，等待独立审阅；本阶段不负责主工程导入，不宣称 Git 写入、mixed 比较、语言冻结或 UI 版本入口已经交付。

## 最终冻结证据

主审独立复验12文件111项：11个明确unsupported目标红、100项通过，types通过。正式data测试hash `50c6d79bdca429f09249a8ea5644177981c5a1cbfffa99207292f39e8f1337bf`；runtime测试hash `74e32017f65d1f3626b17a1414616525e92ef97ac46da70f26dfad561bcd7278`。原始八文件hash导入证据在主工程 `docs/refactor/reviews/evidence/next-b2-2026-09-26/git-read-skeleton-import.json`（lane不挂载evidence，只用本段和实际文件）。先读当前HANDOFF/能力索引Workspace和Runtime条目、质量规范§2.1、原任务§4/7、中审返修，明确退出/历史/权限边界，再实现。保持三个源码接缝之外全部冻结，只在git-read.ts内实现。
