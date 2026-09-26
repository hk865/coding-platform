# R2e.2 Git 固定版本读取与比较：仅骨架和真实测试

2026-09-26，供主审冻结、建立隔离 lane 后派发；本文件本身不代表已经派发或通过验收。唯一任务依据为 [R2e-2-git-read-compare-skeleton.md](R2e-2-git-read-compare-skeleton.md) §1–7，唯一写范围为 [R2e-2-git-read-compare-skeleton-scope.json](R2e-2-git-read-compare-skeleton-scope.json)。本轮完成第一阶段即 STOP，主审中审、冻结测试后才另派实现。

## 1. 先读和实码依据

先读 `docs/AGENTS.md`、当前 `docs/refactor/HANDOFF.md`、`IMPLEMENTED-CAPABILITIES.md` 的 Workspace/Runtime 相关能力、`CODE-QUALITY-GUIDELINES.md` §2.1、`DSH-WORKFLOW.md`、`DSH-EXECUTION-HARNESS.md`，再读任务书及其产品/模块依据。遵守 next 目标工程边界；原 `coding-platform/src`、`tests` 和原 Kernel 仅作只读参考，不能成为 next 新依赖。

本次已沿当前 main 核实的链路（以下代码路径相对 `coding-platform/next`）：

- `src/core/workspace/workspace-tools.ts` 的 `createWorkspaceTools` 已将 `readWorkspace/compareWorkspace` 转给同一 `CaptureRegistry.read/compare`；无需修改这个文件或新增服务。
- `src/core/workspace/capture.ts` 当前仍提前拒绝 Git 分支。其 `track/withAccess/close` 已管理组合 signal、一次 fresh access、finally release 与在途排空，新分支沿此链进入。
- `src/core/workspace/access.ts` 的 `createWorkspaceAccessFactory` 已执行 Host `resolveRoot/authorize`、`WorkspaceSandbox.create` 并合并 `DefaultPermissionPolicy` 和 Host `allowsRead`；本批从这个对象派生可选 Git 能力。
- `src/core/agent-runtime/source-capture-access.ts` 的 `createSourceCaptureAccess` 实际调用上述 factory；`openOwnedSourceAccess` 使用同一个 `createWorkspaceTools`。现有 Work/Query/Reviewer 身份、root/source policy、first-use 与 close 保留，文件只读。
- `src/core/agent-runtime/project-source-tool.ts` 已从同一 `access.port` 调 `readWorkspace/compareWorkspace`，参数校验先于 deferred access，现有 `requireVisible/assertCurrent` 保留。本批只扩既有 read/compare 参数分支。
- 冻结 Kernel 已公开 `WorkspaceSandbox.acquireRootHandleForProcess(): Promise<FileHandle>`；其现实现以只读目录方式取得并校验原根身份。只由受信 access 内部持有该能力，调用方负责关闭；不需要 Kernel 补丁。
- `tests/helpers/B2-runtime-fixture.ts` 已公开 `createB2RuntimeFixture`、`rebuild({workspaceHost, sourcePolicyFor, ...})`、真实 `directory` 和关闭入口。测试复用它，不复制 Runtime/WorkGraph 夹具或修改该 helper。`tests/runtime/source-text-loop-migration.test.ts` 可复用为真实模型结果解码的只读范例，但它单独不证明 B2 prepare/start 准入。

当前范围与 R5a bootstrap 两个实现文件、R4.2 runner 受管源/产物无交集。派发前由主审以当时 main 刷新 lane；不从其它运行中的 lane 拷贝候选文件。

## 2. 第一阶段的具体产物

六个生产文件仅发布任务书 DTO、真实 capability 传递、校验和明确 unsupported 骨架：

1. `src/core/workspace/ports.ts`：提取原 `CapturedWorkspaceComparison`，追加 `GitWorkspaceVersion/GitFileIdentity/GitWorkspaceChange/GitWorkspaceComparison` 判别联合及 compare 可选 prefix。旧 capture 字段/语义原样保留；`WorkspaceFile` 继续使用 `sizeBytes`，不是新增 byteLength 字段。
2. `src/core/workspace/access.ts`：追加可选 `WorkspaceReadAccess.git` 与任务书 `WorkspaceGitReadAccess.readFile/readTree`；真实 factory 传递已绑定 root handle 的内部取得闭包、同一 allowed 谓词、signal/liveness。普通 read/capture 不探测 Git。
3. 新 `src/core/workspace/git-read.ts`：内聚上述绑定对象的创建及 readFile/readTree 未实现接缝；合法 Git 请求返回明确 `rejected/unsupported`。第一阶段不启动 Git 子进程、不解析对象/树、不实现比较算法，不为了骨架探测而提前取得句柄。
4. `src/core/workspace/capture.ts`：Git 请求结构校验后，沿同一 track/withAccess 调真实绑定 capability 的 unsupported 接缝；Git/Git 两侧属于同一次 access，不能保留最外层旧 unsupported 就声称真实传递已验收。
5. `src/core/workspace/workspace-read.ts`：原纯 capture 比较返回类型准确收窄为 `CapturedWorkspaceComparison`，保持既有 digest/rename 算法与 `MAX_COMPARISON_BYTES`。
6. `src/core/agent-runtime/project-source-tool.ts`：read 新 Git version、compare 内层互斥 pair 的 strict union/refine 与薄转发，更新现有工具描述；不创建第二工具名、同名 action discriminator 或任意命令入口。

两份新测试为 `tests/data/R2e-git-operations.test.ts` 与 `tests/runtime/R2e-git-source-loop.test.ts`，仅此两份测试有写权。其余 fixture、既有测试、`source-capture-access.ts`、`workspace-tools.ts`、组合根、Runtime driver、WG、Kernel 源/产物、依赖和构建文件均只读。原地写入获准文件；不预建范围外文件，不新增通用进程引擎/注册表/持久状态或辅助脚本。若类型联合要求范围外消费者补窄，先报告精确调用点，由主审处理 scope，不能用 any 或放宽旧断言消除错误。

## 3. 已冻结的后续实现约束

这些是测试目标和接缝含义，不能在骨架阶段提前实现：

- Git version 只接收 40/64 位小写完整 commit OID，并与真实仓库 object format 一致；不存在可变 ref 解析/peel。模型输入无 root、argv、env、主体、权限。路径/prefix 沿原规范与 requireVisible；普通历史查询不增加 Role/Plan 全链门禁。
- 根能力复用 `acquireRootHandleForProcess`，不另写 open/fstat 身份算法，不绕 Host authorize、allowed、allowRoot。Linux 子进程 cwd 使用仍打开的 `/proc/<parent-pid>/fd/<fd>`；仓库顶层须匹配该实际根，支持合法 linked worktree。所有子进程实际 close 后调用方 finally 关闭句柄，不能把发出 abort 当作退出。
- 固定 shell:false Git 命令限仓库定位/格式、单完整 OID 的 `cat-file --batch-check`、NUL `ls-tree`、原 blob 读取。batch-check stdin 只有一个 validated OID 和换行；只有成功退出且机器响应明确为同一 OID 的 missing 才是 not_found，其它查询异常 unavailable，不猜 stderr/exit 128。
- 隔离继承的 `GIT_*` 覆盖，禁止系统/全局配置、lazy fetch、replace、pager、prompt 与 optional locks；保留 Git 解析合法仓库/linked worktree 所需的本地配置。原 blob/tree 命令不运行过滤器、textconv 或外部 diff。固定进程时限、输出限额、取消和关闭约束沿任务书 §4。
- Git read 原 bytes SHA-256/sizeBytes，严格 UTF-8/no-NUL。Git compare 比较普通文件 blob OID+mode，保留二进制与 mode-only；新标签 git_tree_content_and_mode，只有 add/delete/modified。旧 capture 比较和 rename 不变；混合 Git/capture unsupported、working_tree compare invalid。
- 模型 read 8192 bytes、JSON 60 KiB、Kernel 64 KiB 保持；完整结果超限明确 capacity，不裁成 complete。Git 操作不产生 captureRef，原 capture 生命周期不变。

## 4. 真实测试和首红标准

按任务书 §7 组织约八项有区别的场景，不复制语言/数据库矩阵。真实临时 Git 仓库通过 fixture 自己 init/add/commit 构造版本；生产只读。正例包含历史正文、dirty/deleted 当前文件、精确 OID/mode 与 mode-only/binary 比较、授权路径/prefix、旧 capture 兼容、linked worktree、容量及环境哨兵。缺对象采用真实仓库中的不存在完整 OID，不以伪造进程输出替代机器协议。

Runtime 正例必须走现有 `createB2RuntimeFixture` 的真实 prepare/start、冻结 Kernel、脚本模型实际调用 project_source，并在下一模型请求核对完整 typed 结果；使用已有 workspaceHost/sourcePolicyFor override 绑定 fixture 的真实根和合法授权。不能直接注入假的 WorkspaceTools 返回成功，也不能只用裸 runObservedModel 范例宣称公开 B2 消费完成。

取消/close 测试观察真实 child 的进入、实际退出与句柄关闭；若需要最小进程观察包装，必须转发真实 child，不能提供任意 production command 注入口。可控 gate 用 finally 放行并等待 outcome；错误提前越过边界的情况也要能立即断言并进入清理，不在测试自身等待顺序中挂死。若现有接口无法构造确定窗口，报告确切接缝供主审决定，不扩生产 DTO。

第一阶段类型检查应通过，旧行为维持通过；新增最终行为断言可因明确 unsupported 为红。报告每个红测实际进入到哪里、被首红遮挡的后半段，不能将未执行断言说成已验证。不要让所有红停在错误 Git fixture、未授权路径、无工具或失效 Prepared；也不要同时把 unsupported 和 ready 都设为验收成功。

## 5. 检查与停止

所有检查经主审建立的隔离 harness，在映射后的 `coding-platform/next` 下使用已有 Node 24 与已挂载依赖。主审持有 `check.py`、selector 登记、共享文档及源文件归属；DSH 不改它们。主审已注册`next-git-read`与`next-git-read-neighbors`，分别为本批两专项及上述8个既有邻接文件；实际文件均已核对。运行`python3 tools/dsh-refactor/check.py next-git-read next-git-read-neighbors next-runtime-execution`；`next-types`和`next-architecture`分别单跑。不借旧工程r2e1结果证明next，不触发旧Kernel全工程构建、安装或无关全矩阵。完成骨架与测试后STOP，提交精确文件/hash、检查结果、真实红点/后段未达和scope阻碍，等待主审中审，不自行实现。


## 6. 下一独立候选：固定 Git 与当前工作树的文本比较

2026-09-26，本节六路径骨架及[单文件第二阶段实现](R2e-mixed-comparison-implementation.md)均已独立验收并精确导入。最终 next-git-read 两文件 15 项通过、next-types 通过，audit 仅 git-read.ts 改动且无越界；真实 B2/Kernel 两方向正常链完整到达，证据见 reviews/evidence/next-b2-2026-09-26/r2e-mixed-comparison-implementation-import.json。首批只补 `git ↔ working_tree` 的授权普通文本内容及 executable mode 比较，直接交给现 `project_source` 消费；不把 Git 写入、二进制工作树读取或 Git/capture 混合塞进同批。现 Git/Git 二进制及 mode 比较、capture/capture 和 Git 读取原样保持。该候选无需等待 Query 或 R6，不写它们的 composition/runtime/app/UI 文件。

### 6.1 准确缺口与唯一接缝

- `ports.ts::WorkspaceComparisonRequest` 目前排除 working_tree；`CaptureRegistry.compare` 先在 working_tree 分支返回 invalid，Git/capture 仍 unsupported。
- `project-source-tool.ts::ModelCompareVersion/compareVersionSchema`、pair refine 和 dispatch 只接受 bare capture/capture 或 git/git；需要增加明确 `{kind:'working_tree'}` 的一侧，仍不得接收 root、argv、scope、权限或动态 ref。
- `git-read.ts::createWorkspaceGitReadAccess` 的 `readTree/readFile` 已提供同一授权 access 内的完整 OID、精确树模式、原 blob bytes、固定命令及根句柄生命周期；`readGitWorkspaceFile` 已给出严格 UTF-8/no-NUL 和原 bytes SHA-256。它们是历史一侧的真实读取者。
- `WorkspaceSandbox.read` 已公开原 bytes 的 `revision/byteLength` 及 `mode`，但 `access.ts` 的 `WorkspaceReadAccess.read` 当前只传前三个正文相关字段。只需在既有返回值追加兼容的 `mode?:number`，真实 factory 原样透传 `file.mode`；旧窄 fixture/嵌入 reader 可继续无该字段，mixed 比较遇缺 mode 明确 unsupported，不猜 100644。
- 当前 Kernel 没有公开二进制 raw-file 读取能力，不能重编码 content 冒充原 bytes，也不能为本批复制 Sandbox 路径遍历或改 Kernel。working_tree 二进制/非法编码整次 unsupported；该限制在结果 scope 与产品能力记录中明确保留。

### 6.2 最小公开结果与模型输入

`ports.ts` 的 request 两侧放宽到既有 `WorkspaceVersion`，由 compare 的有限分支检查合法 pair；新增结果并加入原 `WorkspaceComparison` 联合，旧两个结果不改字段：

```ts
type WorkingTreeWorkspaceVersion = Extract<WorkspaceVersion, {kind:'working_tree'}>;
type GitWorkingTreePair =
  | {before: GitWorkspaceVersion; after: WorkingTreeWorkspaceVersion}
  | {before: WorkingTreeWorkspaceVersion; after: GitWorkspaceVersion};
type WorkspaceContentModeIdentity = {
  digest: string; digestBasis: 'raw_bytes'; sizeBytes: number;
  mode: '100644' | '100755';
};
type GitWorkingTreeChange =
  | {kind:'added'; path:string; after:WorkspaceContentModeIdentity}
  | {kind:'deleted'; path:string; before:WorkspaceContentModeIdentity}
  | {kind:'modified'; path:string;
      before:WorkspaceContentModeIdentity; after:WorkspaceContentModeIdentity};
type GitWorkingTreeComparison = GitWorkingTreePair & {
  scope: Extract<CaptureContentScope, {kind:'text_files'}>;
  comparison: 'git_worktree_raw_content_and_mode'; complete:true;
  observedAt:string; currentness:'not_rechecked';
  changes:GitWorkingTreeChange[];
};
```

scope 沿现 `text_files/readable-regular-utf8-no-nul-v1`、规范 prefix 与 `digestBasis:'raw_bytes'`；complete 只表示已选授权普通文本域的完整比较，不代表整个仓库、原子文件系统快照、未来无变化或 Run 前后证明。一次有界工作树观察完成后返回 `observedAt`，结果不会在交给消费者后自动重验；complete 仅指所选 inventory 及每个文件读取成功，不承诺原子全树快照。历史侧 digest 同样是原 blob bytes 的 SHA-256，绝不是 Git objectId。mode 的归一化沿已有 CandidateWorkspaceReader 的 owner-executable 位规则；不读取 Git clean filter 或 core.fileMode 来改变本次原文件模式含义。

模型沿原 compare action：两侧允许 bare capture refs、明确 git 或明确 working_tree。合法 pair 仅 capture/capture、git/git、git/working_tree、working_tree/git；working_tree/working_tree 和 capture/working_tree invalid，Git/capture 保持原拒绝，capture pair 带 prefix 仍在 deferred access 前拒绝。mixed prefix 与现 Git prefix 同为字面规范 path/目录域。dispatch 保留输入方向，不把当前工作树包装成 captureRef 或 Git commit；原 `requireVisible/assertCurrent`、绑定 ctx/source access 以及 60 KiB/64 KiB 输出边界继续生效。

### 6.3 有限算法与生命周期

在既有 `git-read.ts` 增加窄 `compareGitWorkingTree` 入口，由 `CaptureRegistry.compare` 在结构/OID/scope 校验后经原 `track/withAccess` 调用。整个 compare 只 fresh open 一次 access；沿原 signal 和 finally release，不新建池、缓存、版本 owner、capture ID 或 WorkspaceSandbox。

1. 固定 Git 一侧用原 `git.readTree` 获得授权 prefix 内的 regular entries；沿原 `readGitWorkspaceFile` 逐个取得文本原 bytes digest/size，加树中 mode。历史 scope 遇 binary、symlink/gitlink、容量或读失败即按现结果返回，不静默丢项。
2. 当前一侧复用 `captureTextSource` 的真实 inventory、规范 path、相同 authorization、逐文件 Kernel read、原 digest/字节限额及 typed failure 映射。为保留已由同一次 read 返回的 mode，仅在该调用内使用转发到原 `access.read` 的局部只读包装收集 mode；其余方法和 authorization 均指回同一 access，不能接收松散 allowsRead/root 另建 owner，也不二次读取正文来伪造 mode 身份。
3. 当前工作树只调用一次 `captureTextSource` 做有界观察，mode 来自同次 Kernel read；保留原单文件 `file_changed`、路径/权限与容量等真实失败。结果是带 observedAt/currentness:not_rechecked 的只读比较，不发布 retained capture，也不用于授权提交，因此不增加第二次全树读取、HEAD 一致性或重试门槛。`TextSourceSnapshot.identity.commit` 只是捕获上下文，不是本批固定历史版本；complete 只说明所选 inventory 及各文件读取成功，不承诺原子全树快照或未来不变。
4. 对两边路径并集生成 add/delete/modified，digest 或 mode 任一不同就是 modified；按实际 before/after 定向，同内容不同路径仍 add/delete，不猜 rename。未授权路径从原 access/tree 选择域排除，当前一侧仅沿现 Sandbox ordinary-file inventory，绝不跟随链接。
5. 沿 `maxFileBytes/maxCaptureBytes/maxInventoryFiles/maxQueryResults`、`MAX_COMPARISON_BYTES` 有界读取/结果，超限直接 capacity。旧 capture 比较/冻结/游标/保留生命周期不变；新结果只是一份读观察，不作为可复用 retained capture。

### 6.4 六路径与一条真实正常链

骨架/实现候选 scope 为 **5 个现有生产文件 + 1 个现有测试文件**，不新增产品文件：

- `coding-platform/next/src/core/workspace/ports.ts`：上述 request/结果联合。
- `coding-platform/next/src/core/workspace/access.ts`：只透传真实 mode，保持原能力与授权 owner。
- `coding-platform/next/src/core/workspace/capture.ts`：有限 pair 校验及同一次 withAccess 转发。
- `coding-platform/next/src/core/workspace/git-read.ts`：声明/实现 mixed 文本比较接缝；原 Git fixed-process owner 不重写。
- `coding-platform/next/src/core/agent-runtime/project-source-tool.ts`：原 action 的 schema/DTO/描述与薄转发。
- `coding-platform/next/tests/runtime/R2e-git-source-loop.test.ts`：只新增一个 it，原 Git read/compare 用例不弱化。

唯一新增正常链复用本文件现 `createB2RuntimeFixture`、真实 Git fixture 命令、workspaceHost/sourcePolicyFor 绑定及 `toolResult` 解码：提交基线中的普通文本，然后在同一已授权 prefix 内产生一次当前内容修改、mode-only、增加与删除；脚本模型先调用 git→working_tree，再调用 working_tree→git，最后正文答复。真实 prepare/start、原 Kernel 与下一模型请求必须携带完整 typed 结果，核原 OID、raw-byte digest/mode、两方向 add/delete/modified 及正常结束。只是一条用户链，不增加异常/权限/取消/数据库矩阵，不构造假的 WorkspaceTools 成功。

**一处旧负断言必须由主审先迁移，而非保留矛盾门槛：** `tests/data/R2e-git-operations.test.ts` 现“before working_tree、after git → invalid、0 open”恰好是本批新增能力。建议主审在 prepare 前仅把该旧输入的 after 改成 working_tree，并同步该句注释；原 case 仍验证不支持的 working_tree/working_tree 在 open 前拒绝，其余断言不改。此兼容迁移不新增 it、不扩大 DSH 六路径；主审记录新 baseline/hash 后，该 data 文件继续只读。若主审选择让 DSH 改这一行，应明确另冻结七路径，不能默许越界。

第一阶段只给 mixed 接缝明确 unsupported 和这条最终成功行为测试，旧能力保持；新测试应真正走进 mixed 新分支，首红后未达步骤如实报告，然后 STOP。主审短审后第二阶段才实现；检查限该新增正常链、原 Git 两文件与 Node types/必要结构，不重新运行完整 B2/Kernel 矩阵。主审负责 selector 与导入；不改构建/依赖/helper/Kernel、source-capture-access、composition、Query、Workflow、R6 app/UI。

本批尚不提供 mixed binary、Git/capture 或 Git 写操作；这些继续保留原范围，不以本次文本正常链宣称 Git 版本能力全部完成。Host/UI 的 compare 路由与 Git 版本选择也仍是 R6 消费者任务，不能从模型入口已通推断页面已交付。
