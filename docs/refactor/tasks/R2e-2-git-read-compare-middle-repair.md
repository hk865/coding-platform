# R2e.2 骨架中审返修（第一阶段，完成即 STOP）

2026-09-26。接续同一隔离 lane/session，原任务书与八文件 scope 保持。本次只修下列已证实的协议/夹具缺口，不启动生产 Git、不实现对象解析或比较算法。主审独立复验现候选：12 文件 107 项，7 红 100 绿，类型通过；红为 unsupported，但后段仍有错误，尚未冻结。

## 1. 三个生产文件的最小收敛

- `project-source-tool.ts`：在现有输入 refine 内拒绝 capture/capture 携带 prefix。旧 bare CaptureRef 形状不变；错误发生在 deferred access 前，不可静默丢 prefix。
- `git-read.ts` / `capture.ts`：比较 helper 的 limits 补入已有 `maxQueryResults`；读取 helper 接同一 `deps.now`，最终 readAt 不新造时钟。仅传参，保持 unsupported。
- 新 Git read/Git-pair compare 分支复用 working_tree 已有的本地 ctx.projectId/workspaceId 与 input.workspace 比较，不匹配 forbidden 且不 open。只比较本次已在内存的两个标识，不增加 Role/Material/Plan/整条 ownership 查询，不修改旧 capture 行为。可在既有结构拒绝 case 中用 fixture 当前 opens 计数断言，无需新夹具。

`ports.ts`、`access.ts`、`workspace-read.ts` 保持本次中审 hash 不变。不能为了接缝提前启动子进程。

## 2. 两测试修复既有真实场景

- 历史读取：最后一次 commit 后再制造 untracked/dirty/current deletion，核历史两个 OID 仍读原内容、working_tree 读实际当前内容。原字节 case 加含 UTF-8 BOM 内容并核原 bytes digest/sizeBytes（文本按严格 UTF-8 原约定处理）。只把这一个历史 case 参数化为真实 SHA-1 / SHA-256 repo，核实际 OID 长度与错格式拒绝；不复制全套矩阵。
- 比较 prefix：在既有树构造里加入 `docs-old` 的真实变化，prefix docs 不能含它。授权比较必须使用两个含 public/private 真实变化的不同 commit，确认只显示允许路径且结果不含私有路径或 OID。
- 含 symlink 的 docs 域按冻结规则整次 unsupported；binary ready 比较收窄到 `docs/binary.bin` 或纯普通文件域，不能同一个含 symlink 域同时期待 ready。不要读取符号链接指向的内容。
- env/filter/textconv/external-diff 哨兵：先完成两个真实 commit，再配置哨兵，调用真实 read 和 compare；fixture 不能在配置后 git add 触发自身 filter。只核原字节/对象比较和哨兵未产生。
- linked worktree 现有 case 中加入注册根是父仓库子目录的实际拒绝，保持合法 linked worktree 正例。
- 工具结构错误在现有 invalid case 最小加 capture/capture+prefix => invalid 且 deferred access 零打开；不能改 old capture ref 形状或增加工具。
- Runtime 保留真实 B2 prepare/start、冻结 Kernel 三轮调用，在原 case 补正常 terminal/Run ended 的已有公开观察结果断言，不种平台事实。

## 3. 替换虚假的取消/关闭证明

删除原只在 beforeOpen 门闩等候却称已验证 child/句柄关闭的逻辑。两条有区别场景（caller abort、registry.close）可以共用一个测试内观察 helper：

1. `vi.mock('node:child_process')` 只薄包装生产真正调用的 `spawn`；调用原 `spawn(file,args,options)`，原样返回真实 child/真实结果/真实参数。仅遇到本次 `cat-file --batch-check` 时，暂缓该真实 child 的 stdin.write/end（排队原调用），使真实 Git 等唯一 OID 输入；其它 metadata 子进程不拦。不得伪造 stdout/stderr、命令退出或重写 argv。
2. 使用现公开 `WorkspaceSandbox.prototype.acquireRootHandleForProcess` 的 forwarding spy 记录真实 FileHandle；原方法与真实 handle.close 均照常调用。记 child 实际 close 与 handle.close 顺序，最终 fd === -1。
3. `Promise.race([childEntered, operationResult])`：骨架先返回 unsupported 时必须立刻目标断言失败并 cleanup，不等待永不到达的 child。实际 child 进入后触发 abort 或 registry.close；公开结果/registry.close 完成之前 child 已真正 close，root handle 随后关闭。只发 kill/abort 不能算退出。
4. finally 释放/恢复 stdin wrapper、清理仍活 child 并等待真实 close、还原 spy；测试异常也不能悬挂。可绑定本次操作避免跨测试全局干扰；不新增 production 测试注入接口、通用 process runner 或脚本。

open-once/release-once 原 B1 生命周期已有验证，本轮不另复制矩阵。除这些已知未达或冲突的断言外，不继续加猜测风险。

## 4. 复验与停止

仅 `next-git-read next-git-read-neighbors next-runtime-execution`，`next-types`、`next-architecture` 分开；不跑全套 next-tests。明确报告每条新红是 unsupported 还是 fixture 错误、哪些后段仍未达。审查前保持第一阶段 STOP；不把红測后段叫已通过，不自行进入实现。

## 第二次中审：仅取消观察 helper 的收尾修正

第一轮返修其它协议/场景已审通过，生产六文件和 runtime 测试全部保持 hash；本次仅写 `tests/data/R2e-git-operations.test.ts` 的 `observeCancellation`/对应测试内 helper，不加 case。不实施生产。

1. 当前先 await registry.close、再 await operation、最后才读 childClosed，会掩盖 operation 提前返回。给原 operation 的实际 settle 回调记录当时真实 child close / 所有 acquired handle fd；closeRegistry 的实际 settle 也记录。后续断言必须核这份当时状态，不能用后来资源关闭后的状态替代。callback 仅观察，不改变真实返回或 Git 结果。
2. 原 finally 等 operation/child.closed 后才 abort、也没有 kill 存活 child，顺序错误。finally 先停 gate、恢复/释放排队 stdin，取消请求；对仍未实际 close 的真实 child 发终止并等待真实 close，然后排空原 operation、恢复所有 spy。不得把 kill 已发/exitCode 非空当实际 close。
3. gate 进入后的 trigger/operation 等候须有测试内有界失败路径进入 finally；registry.close 不应在 try 中永久 await、导致清理永远不能开始。用可清除的测试 watchdog 和原 outcome 竞争即可，不加生产超时接口/假 close/通用测试框架。清理即使面对被测路径回归，也须终止真实子进程并解除 gate；对错误的未完成 Promise 不无限等待。计时只防测试悬挂，不代替 child/handle 真实顺序断言。
4. 骨架先返回 unsupported 仍在 first=result 立即红并 cleanup。保持两条实际 abort/registry.close 目标测试，不删除或同时接受 ready/unsupported。

只跑 next-git-read 与 next-types；其它生产/邻接上轮未变不必再跑。交最终 data hash/首红/实际结果后 STOP；主审再冻结，勿自行实现。
