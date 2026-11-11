# src/core/workspace：文件、Git、源码捕获与索引的只读观察层

## 负责什么，不负责什么
- 按路径读当前/冻结文件、Git 固定版本、源码捕获与查询、Python/C++/TS 索引；只观察 Host 已授权的工作区。
- module-target 声明本模块依赖为空：不获得 RecordStore，不写记录/事件，不提交，不运行或修改 Session。
- 根与权限由 Host 注入（`WorkspaceHostBindings`）；每次 `open` 重跑 `resolveRoot` + `authorize`，模型参数不能指定任意绝对根。
- 路径边界、捕获、分页游标与各语言索引规则只在本层实现一次；其他层引用，不另写一份。
- 可调用 Node、解析器与 Kernel 的只读 `WorkspaceSandbox` 库能力；这不等于依赖 AgentRuntime。
- 不决定架构职责、不改任务图、不判断完成；changed paths 只是失效提示，不能证明其他文件没变。

## 文件
- `access.ts` — 根绑定与每次读取资格：包装 `WorkspaceSandbox`，把 Host 授权与内核路径策略取交集；`readMany` 把一次访问的多个读交给 Kernel 的 `readMany`（slice-8E2-SPEC W12），逐路径先判授权。
- `path-validation.ts` — `isSafeSourceRelativePath`：唯一的词法源相对路径规则（非空、≤4096 UTF-16、无 `\`/`:`/NUL、每段非空且不是 `.`/`..`）；`isLiteralSourceFilePath`（只认一个确切文件：词法规则再加不含 `*`、`?`；计划文件用）。
- `ports.ts` — 本层请求/结果/端口 DTO，`deepFreeze` 与 `validateSourceQuery`；第二档引用核对的六个类型（`ReferencePriority`、`ReferenceQuestionV1`、`ReferenceAnswerV1`、`ReferenceCheckRequestV1`、`ReferenceCheckResultV1`、`ReferenceAnalyzerPort`，slice-8E2-SPEC §2.0）。未提交读的 `UncommittedFileV1`/`UncommittedFilesV1` 的正本在 `contracts/workspace-files.ts`，这里转出。
- `workspace-tools.ts` — 装配唯一公开工具面 `WorkspaceToolsPort`、Host 限额校验与 continuation 读取；句柄另有 `readWorkspaceFiles`（一次访问读多个工作树文件）和 `listWorkspaceInputs`（列当前项目输入路径），都不在 `WorkspaceToolsPort` 上。
- `capture.ts` — `CaptureRegistry`：捕获/观测、查询、导出、核验、释放、架构源、文件图、读/比较、一次访问读多个文件（`readFiles`）、列项目输入（`listInputs`）、关闭。文件图的边一对 `(from,to)` 一行，`count` 是这一对的引用处数：TS/JS 的每条 `scan.edges`（一条已解析引用）算 1，C/C++、Python 加 provider 给的 `count`；自环丢掉。
- `denied-prefixes.ts` — `WORKSPACE_DENIED_PREFIXES`：拒绝前缀的唯一来源；`PROJECT_STORE_PREFIX`/`withinProjectStore`：工作区里的项目库目录不是工作区内容的唯一规则。
- `git-read.ts` — 固定 argv/环境、只读的 Git 文件/树读取与 commit↔commit、git↔工作树比较。
- `workspace-read.ts` — 当前或冻结文件的精确读取与同范围内容比较；`readWorkingTreeFiles` 是多个工作树文件的同一套前置检查和错误码。
- `duplicate-candidates.ts` — 比较后侧的重复候选：顶层声明与字符串字面量经 `readTopLevelDeclarations`/`readStringLiterals` 两读，按新位置、上限与字节预算出报告。
- `project-source-snapshot.ts` — TS/JS 与观测的 live 清单/正文/身份捕获、摘要、跳过与容量拒绝。观测不收工作区根的 `.workbench/`（平台的代码知识文件；Agent 照样能读，它不是拒绝前缀）。
- `typescript-source-query.ts` — 冻结 TS/JS 分析（Language Service）与 tsconfig/jsconfig 配置选择；`symbols` 走 `navigationItemsOf`。
- `single-file-syntax.ts` — 单文件 TS/JS 语法事实（slice-8E2-SPEC W4、W10）：一份文字在只含这一个文件的 Syntactic 语言服务里解析一次，导航项、`fileSyntaxOf`、`namesInRanges` 都读这棵树；纯函数，主线程，不建程序。
- `reference-analyzer.ts` — 第二档的引用核对（slice-8E2-SPEC W1–W9）主线程一侧：先后队列、每次重列项目输入、预取、配置、找 X，经读口读线程要的文件。
- `reference-analyzer-worker.ts` — 第二档的分析线程：每次请求建一个程序、用完就丢，共用一份按内容摘要的解析缓存，`getDocumentHighlights` 搜整个程序；只导入 TypeScript 和 Node。
- `native-single-file.ts` — Python/C++ 单文件查（slice-8E2-SPEC W11）：一个端口一个常驻 Python `ast` 进程、一个常驻 libclang 进程，`lookup` 回一个文件里函数、类的名字和名字那一段；C++ 每次用调用方的上下文读工作区根的 `compile_commands.json` 和进程要的头文件，进程自己不读工作区。Python 的单文件解析失败是独立的 `syntax_error`（带一基行号和 `SyntaxError.msg`），`unavailable` 只留超时、崩溃和解释器/进程协议失败。
- `python-syntax.ts` — 121-34：这次 Run 改过的 Python 文件只解析、不运行的语法检查；一次 `readWorkspaceFiles` 读这批路径，再对每个读到的文件调一次 `lookup`，`syntax_error` 收成 `{ path, digest, line, message }`。
- `typescript-light-scan.ts` — 观测用 TS/JS 纯语法轻扫（不建 Program/LanguageService）。
- `source-query.ts` — 从同一份冻结捕获切页的查询、游标和 wire 形状映射。
- `source-index.ts` — 显式文件集的只读 TS 语义查询（symbol/definition/reference）与 excerpt。
- `python-source-index.ts` — 经分析器 NDJSON 协议解析 Python 来源的索引。
- `cpp-source-index.ts` — 经 libclang 解析 C/C++ 来源的索引，不执行项目自带编译器。
- `analysis-runner.ts` — Python/C++ 共用的有界 NDJSON 子进程执行器（超时、重启、输出上限）；`createResidentAnalyzer` 是它的常驻模式（一个进程、请求一次一个、崩了或超时下次重起）。合并结果时一条引用是一个 `(from,to,specifier)` 三元组，跨所有已完成单元（含分析器重启前后）去重，每个第一次出现的三元组给 `(from,to)` 的 `count` 加 1；脚本自己的进程内去重只少送重复，重启后不保证。
- `architecture-language-provider.ts` — 语言 provider seam，以及 Python/C++ provider 与路径语言判定；`ProjectFileGraphV1.edges` 和 provider 的 `edges` 都带 `count`。
- `architecture-source.ts` — 只按显式 mapping 把冻结 imports 折叠成架构源图（纯函数）：文件按 `ownershipRuleOf`（完整映射）先归模块、再归模块内接口；跨模块的引用累加 `module→module` 边，同模块不同接口组之间累加 `interface→interface` 边，同模块里任一端不在接口组的不建边；每条边的 `count` 是引用条数（一条引用的每个 target 各 1），不进边身份；没有冻结源文件的接口不生成节点，但映射照存进快照（它参与的平手仍是平手）。
- `text-source-snapshot.ts` — 严格文本捕获：每个选中文件必须是可读 UTF-8、无 NUL。
- `continuation-diff-reads.ts` — continuation 单文件 diff 两侧的 1 MiB 有界只读字节。
- `workspace-baseline-artifact.ts` — 从 prepared manifest bundle / capture Artifact 读 baseline 与完整变更。
- `workspace-change-capture.ts` — run 起始 baseline 与结算 change capture 共用的只读遍历（不进工作区根的 `.workbench/`，和 HEAD 比较时两边也都不比它：知识文件由平台写、单独提交，不算 Run 的源码改动）。其中只读 git 辅助（gitTopLevel、readHead、readTree、gitBlobId、pickObjectFormat）也给 uncommitted-files.ts 用；`gitCommonDir` 经同一个只读 git 执行口给组合层定项目库的位置。
- `knowledge-exclude.ts` — KLS-2“架构图和注记只留在本机，不进 git”：`applyKnowledgeExclude` 在仓库共用的 `<git-common-dir>/info/exclude` 里加上或删掉带标记的两行（标记行加 `.workbench/`），已是要的状态就不动文件，其余行逐字节保留（按字节读改、不解码，不是 UTF-8 的字节也不变）、用户自己写的 `.workbench/` 行不动；新内容整份写进同目录的临时文件再换名，写失败时原文件不动；`ensureKnowledgeDirectory` 建 `<root>/.workbench/`（已有就不动，根不在不建也不报），Host 启动和打开工作区、Work Run 启动、工作台命令起命令前都调这一个。这两样是本层仅有的写：一个是 git 自己的本地忽略文件，一个是平台自己的知识目录，都不是工作区内容；不碰 `.gitignore`、git 配置和索引。
- `uncommitted-files.ts` — 任务图的“未提交”读：给定路径此刻相对 HEAD 的状态和 git 口径的加减行，只读、不存。
- `candidate-workspace-reader.ts` — candidate 范围快照、摘要与 git entry（含符号链接/特殊文件规则）；不收工作区根的 `.workbench/`（平台的知识文件，和观测、Run 变更捕获用同一个 `withinKnowledgeDirectory`）。
- `verification-workspace-reader.ts` — 验证轮来源：当前源码、Git 基准比较与 requeue source digest。
- `reviewer-source-reader.ts` — reviewer 路径允许规则（复用 candidate 排除项）。
- `source-identity.ts` — 一次固定的 `git rev-parse --verify HEAD` 身份读取，非 Git 返回 `commit:null`。

## 可以复用的能力
| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `createWorkspaceAccessFactory` | `src/core/workspace/access.ts:95` | 用 Host 的 `resolveRoot`/`authorize` 打开一次绑定的读取资格 | 组合根给本模块注入真实根与权限时 |
| `createWorkspaceTools` | `src/core/workspace/workspace-tools.ts:85` | 组装唯一 `WorkspaceToolsPort`（捕获/查询/读/比较）与 continuation 读取；句柄上的 `readWorkspaceFiles`、`listWorkspaceInputs` 可单独传出去用（闭包，不靠 `this`） | 组合根装配 `platform.workspace` 时；消费方不要再建 registry |
| `WorkspaceToolsPort` | `src/core/workspace/ports.ts:226` | 本模块对外的窄端口与结果类型 | 消费方只注入端口，不拿 registry/sandbox |
| `WorkspaceToolsPort.readUncommittedFiles` | `src/core/workspace/ports.ts:232` | `files/uncommitted` 的 owner | Host 路由和界面 |
| `UNCOMMITTED_FILES_MAX_PATHS` | `src/core/workspace/ports.ts:182` | 一次未提交读最多几条路径（100） | 校验请求与界面截断路径时 |
| `WORKSPACE_DENIED_PREFIXES` | `src/core/workspace/denied-prefixes.ts:43` | 拒绝前缀的唯一清单（内核默认 + 平台追加；含放项目库的 `.workbench/local`） | 命令检查、取材、运行时读源码需要同一路径边界时 |
| `PROJECT_STORE_PREFIX` / `withinProjectStore` | `src/core/workspace/denied-prefixes.ts:6` / `:9` | 非 git 工作区里放项目库的 `.workbench/local`，和判断一条工作区相对路径在不在它里面（KLS-1b X1）；候选摘要（`candidateWorkspaceIncludesPath` 和遍历）和 Kernel 工作区快照（`observed-model-run.ts` 把它加进 Kernel 的拒绝前缀）都经它排除 | 任何枚举、摘要或快照工作区的地方；不要另写 `.workbench/local` 字面量 |
| `isProtectedWorkspacePath` | `src/core/workspace/continuation-diff-reads.ts:58` | 规范化 workspace 相对路径后判断是否落在 Host 拒绝前缀内 | AgentRuntime 过滤受保护路径；先 `normalizeWorkspaceRelativePath`，不要另写前缀匹配 |
| `CaptureRegistry` | `src/core/workspace/capture.ts:124` | 有界保留的捕获、游标、容量、失效与导出 | 只要实现捕获/查询语义时；不直接实例化第二份 |
| `createWorkspaceGitReadAccess` | `src/core/workspace/git-read.ts:399` | 绑定到已授权 root 的只读 Git 读取能力 | 已有 `WorkspaceReadAccess` 时要 commit/树读取 |
| `readGitWorkspaceFile` | `src/core/workspace/git-read.ts:510` | 读某个完整 commit 下的一个文本文件 | 读固定 Git 版本文件时 |
| `compareGitWorkspaceTrees` | `src/core/workspace/git-read.ts:537` | 比较两个完整 commit 的文本树 | Git↔Git 来源比较时 |
| `compareGitWorkingTree` | `src/core/workspace/git-read.ts:617` | 比较 Git commit 与工作树的普通文本和 mode | Git↔working tree 比较时 |
| `duplicateCandidates` | `src/core/workspace/duplicate-candidates.ts:66` | 在一次比较的 after 材料上列出新的重复定义与字面量候选，带两处位置与 coverage | 比较请求带 `duplicates: true` 时；由 capture/git 两臂调用，不要另建索引 |
| `readWorkspaceBaseline` | `src/core/workspace/workspace-change-capture.ts:292` | 一次只读遍历得到 run 起始 baseline | 执行前冻结工作区基线时 |
| `captureWorkspaceChange` | `src/core/workspace/workspace-change-capture.ts:339` | 同一次遍历得到结算变更、notVisible 与样本 | 执行结束后取变更时；不要另走目录遍历 |
| `gitCommonDir` | `src/core/workspace/workspace-change-capture.ts:104` | 仓库的 common git 目录（所有工作树共用）：`git rev-parse --git-common-dir` 经同一个只读 git 执行口，相对输出按根解析再 realpath；不在工作树里、没有 git 或命令失败为 null | 组合层定项目库位置（`projectStoreLocation`）时；不要另起 git 进程 |
| `ensureKnowledgeDirectory` | `src/core/workspace/knowledge-exclude.ts:89` | 建 `<root>/.workbench/`；已有就不动，根不在既不建也不报（交给调用方自己的打开去报） | 命令要把知识目录挂成只读之前（Work Run 启动、工作台命令）和 Host 登记工作区时；不要另写 mkdir |
| `applyKnowledgeExclude` | `src/core/workspace/knowledge-exclude.ts:56` | 打开或关闭一个检出的“只留在本机”：在 `<git-common-dir>/info/exclude` 按字节加上或删掉标记块（写临时文件再换名），回 `{ path, changed }`，读写失败回 `unavailable`、原文件不动 | Host 设置路由 `knowledge-local`；不要另写忽略文件的读写 |
| `uncommittedFilesOf` | `src/core/workspace/uncommitted-files.ts:36` | 给定路径相对当前 HEAD 的 clean/uncommitted/unknown 和加减行 | 要按文件看未提交改动时；不要另跑 git diff/status |
| `identifyCheckout`、`readCheckoutBranch` | `src/core/workspace/workspace-change-capture.ts:130`、`src/core/workspace/workspace-change-capture.ts:121` | 一个检出的身份：`folder` 是根的 realpath（根不在时抛错，组合层接住回 `unavailable`）；不在 git 里是 `not_git`；在 git 里给仓库身份（common git 目录）、分支（`symbolic-ref`，detached 或失败是 `HEAD`，刚 `git init` 的空仓库也拿得到分支名）和对象格式（`show-object-format`，失败按 sha1）；不读第一个提交；`readCheckoutBranch` 只读分支 | 组合根解析一条知识线（`src/composition/line-knowledge.ts`）；分支每次重读，人随时可能切 |
| `readWorkspaceBaselineFromBundle` | `src/core/workspace/workspace-baseline-artifact.ts:34` | 读 prepared manifest 内的 baseline，坏/缺都降级为 null | 需要 run 起始快照且不能因坏 Artifact 失败时 |
| `readWorkspaceCaptureChanges` | `src/core/workspace/workspace-baseline-artifact.ts:60` | 读 `WorkspaceCaptureV1` 背后的完整变更记录 | 需要变更全量分类、而不是样本时 |
| `readContinuationBaselineBlob` | `src/core/workspace/continuation-diff-reads.ts:89` | 用 `git cat-file blob` 读 diff 旧侧，失败返回 typed unavailable；给了 signal 时每次读后查取消，取消了就抛 | continuation 文件 diff 的旧侧 |
| `readContinuationCurrentFile` | `src/core/workspace/continuation-diff-reads.ts:130` | 读 diff 新侧，拒绝 protected prefix 与符号链接逃逸；文件不存在时原因是 missing；给了 `allowsRead` 时，看路径之前先核真实上层目录加文件名，读字节之前再核真实路径；signal 同上 | continuation 文件 diff 的新侧 |
| `VerificationWorkspaceReader` | `src/core/workspace/verification-workspace-reader.ts:12` | 验证轮的当前源码/基准比较/requeue digest 来源 | 装配 `VerificationRoundSourcePort` 时 |
| `CandidateWorkspaceReader` | `src/core/workspace/candidate-workspace-reader.ts:70` | candidate 范围的整树快照与 git entry | 需要 candidate 级摘要或验证基准时 |
| `SourceIndex` | `src/core/workspace/source-index.ts:29` | 显式文件集的只读 TS 语义查询与有界 excerpt | 探索工具要符号/定义/引用时；不是全仓索引 |
| `TypeScriptSourceAnalyzer` | `src/core/workspace/typescript-source-query.ts:145` | 对一份冻结快照做同步 TS 分析 | 捕获后重复分析且不能再有 I/O 时 |
| `readTopLevelDeclarations` | `src/core/workspace/typescript-source-query.ts:332` | 只列顶层声明，不走进嵌套节点 | 需要在比较材料里按顶层名字找重复时 |
| `readStringLiterals` | `src/core/workspace/typescript-source-query.ts:359` | 列出字符串字面量的位置、预览、长度与 digest | 需要在比较材料里找重复字面量时 |
| `syntaxTreeOf` | `src/core/workspace/single-file-syntax.ts:45` | 一份 TS/JS 文字解析一次，给出那棵树和它的导航项 | 同一份文字既要导航项又要 `fileSyntaxOf`/`namesInRanges` 时；不另调 `ts.createSourceFile` |
| `navigationItemsOf` | `src/core/workspace/single-file-syntax.ts:71` | 单文件导航项（名字、种类、外层种类、`nameSpan ?? spans[0]` 的起止、全部 span），和捕获的 `symbols` 同一次访问 | 不建程序按名字找函数（第一档读、写入闸门） |
| `fileSyntaxOf` | `src/core/workspace/single-file-syntax.ts:128` | 是不是模块、import 的本地名、全部声明名、有没有全局扩充 | 第一档判断“导入没了”“接线的字没了”时 |
| `namesInRanges` | `src/core/workspace/single-file-syntax.ts:183` | 范围原文里按词边界找名字，每一处标 `free`/`other` | 第一档判断名字还在不在、是不是自由标识符时 |
| `createReferenceAnalyzer` | `src/core/workspace/reference-analyzer.ts:55` | 建第二档的 `ReferenceAnalyzerPort`：`verify` 一次建一个程序，按 `priority` 排队；`close` 停分析线程 | 组合根建一个、接进注记的工作区；依赖传句柄的 `readWorkspaceFiles`、`listWorkspaceInputs` |
| `createNativeSingleFile` | `src/core/workspace/native-single-file.ts:105` | 建 `NativeSingleFilePort`：`lookup` 查一个 Python/C++ 文件的函数、类；`read` 只用留着的翻译单元、没有就退回单文件解析并后台预热，`write` 照真实编译参数解析；`close` 停两个常驻进程 | 第一档读 Python/C++ 定位、一般注记写 Python/C++ 符号；一个 Host 只建一个 |
| `changedPythonSyntaxProblems` | `src/core/workspace/python-syntax.ts:17` | 一批路径里只留 Python 的、去重排序，一次批量读，再逐文件 `lookup`；只收 `syntax_error`，按 `(path, line)` 排序 | 安全点检查这次 Run 改过的 Python 文件；不要另写解析或读取 |
| `createResidentAnalyzer` | `src/core/workspace/analysis-runner.ts:583` | 分析脚本的常驻模式：同一套起进程、行读取、输出上限、超时、杀进程；`exchange` 一次一个，`close` 先关输入、等它退出，超时再杀 | 要长住的分析进程时；不另写进程管理 |
| `CppSourceIndex` | `src/core/workspace/cpp-source-index.ts:16` | 权限过滤后的 C/C++ 来源查询 | 探索工具要 C/C++ 符号/import 时 |
| `PythonSourceIndex` | `src/core/workspace/python-source-index.ts:17` | 权限过滤后的 Python 来源查询 | 探索工具要 Python 符号/import 时 |
| `readSourceIdentity` | `src/core/workspace/source-identity.ts:4` | 读 workspace 的固定 HEAD 身份 | 需要来源 pin、又不想引入完整 Git 读取时 |

路径校验的共用词法规则是 `isSafeSourceRelativePath`（`src/core/workspace/path-validation.ts:3`）；真实路径包含判断在 app 的 `isPathWithin`，Query 范围规则是 `validateSourceQuery`（`src/core/workspace/ports.ts:293`）。

## 内部用
- 捕获/读取内部件：`captureProjectSource`、`captureObservationSource`、`projectSnapshotOf`、`observationSkipReason`、`normalizeCoverageNotes`、`captureTextSource`、`scanTypeScript`、`querySource`、`toSourceLocation`、`toSourceRelation`、`toCallRelation`、`toSourceDiagnostic`、`toSourceFileEntry`、`readCapturedFile`、`readWorkingTreeFile`、`readWorkingTreeFiles`、`diffContent`、`summaryChanges`、`comparisonChanges`、`compareCapturedFiles`、`scopeContains`、`manifestOf`、`readFailure`、`deepFreeze`、`validateSourceQuery`。
- 常量与纯规则：`SOURCE_ROOT`、`SOURCE_ENGINE`、`TEXT_ENGINE`、`sha256Text`、`textSourceKey`、`isSourcePath`、`isIgnoredSourcePath`、`isSafeSourcePath`、`isProjectInputPath`、`projectInputPaths`（捕获和第二档列项目输入共用的文件集）、`isObservationSkippedPath`、`OBSERVATION_SKIP_DIRECTORIES`、`OBSERVATION_INVENTORY_CAPACITY`、`CONFIG_DATABASE_FILE_BYTES`、`MAX_COMPARISON_BYTES`、`CONTINUATION_DIFF_MAX_BYTES`、`normalizeWorkspaceRelativePath`、`WORKSPACE_CAPTURE_MAX_CHANGES`、`WORKSPACE_CAPTURE_NOT_VISIBLE_MAX`、`WORKSPACE_CAPTURE_FIXED_IGNORED`、`DEFAULT_WORKSPACE_LIMITS`、`DUP_MIN_STRING_CHARS`、`DUP_LIMIT`、`DUP_LITERAL_PREVIEW_CHARS`、`DUP_REPORT_MAX_BYTES`、`DUPLICATE_LIMITS`、`isCompleteCommitOid`、`GIT_TREE_OUTPUT_LIMIT_BYTES`、`GIT_PROJECT_LISTING_MAX_RECORDS`、`GIT_PROJECT_LISTING_MAX_BYTES`、`formatProjectListingCapacity`、`languageOfPath`、`createCppLanguageProvider`、`createPythonLanguageProvider`、`mapArchitectureSource`、`runAnalysis`、`candidateWorkspaceIncludesPath`、`configureTypeScriptProject`、`ProjectSourceFailure`、`TYPESCRIPT_DEFAULT_LIB_FILE`（捕获和第二档程序共用的默认库文件名）、`TYPESCRIPT_CONFIG_FILES`（捕获、第二档和写入闸门共用的根配置文件名先后）、`REFERENCE_ANALYZER_WORKER_URL`、`REFERENCE_ANALYZER_ROLE`（分析线程模块的自身 URL 和起线程的标记，只给 `reference-analyzer.ts`）。

## 不要做
- 不要在别处复制拒绝前缀或另建根；`denied-prefixes.ts` 是唯一来源，真实根与 `allowsRead` 只由 Host 注入。
- 不要把读取失败折成空清单、空结果或 `not_found`；失败就是失败（FP-05、MH-06）。
- 不要用模型参数指定绝对根、放宽 `allowsRead`，或让 Git 接受 ref/短哈希与外部环境（`git-read.ts` 只收完整 OID）。
- 不要另写捕获、分页游标或各语言索引规则；用 `CaptureRegistry` 和同一 capture 的游标。
- 不要用 shell/hook/外部 diff 读仓库，也不要让项目自带的编译器执行；Git 与解析器调用已有固定入口。
- 不要另起 Python/C++ 分析进程或另写进程管理（经 `createNativeSingleFile` / `createResidentAnalyzer`）；C++ 单文件查的进程只直接读编译器自己的头文件目录（slice-8E2-SPEC W11 第 1 条），工作区文件只经 `readWorkspaceFiles` 由主线程读了交给它。
- 不要在分析线程模块里值导入本仓库的别的模块：测试里线程直接从 TS 源码起（Node 去类型），相对的 `.js` 导入解析不到；线程要的东西由主线程交过去。
- 不要承诺“完整工作树”：capture 的 scope/coverage 有明确上限，`complete` 不等于整个仓库或完整调用图。
- `isSafeSourcePath`（`src/core/workspace/project-source-snapshot.ts:103`）是源码捕获的路径规则，不做 4096 上限；它不是 `isSafeSourceRelativePath` 的副本。
- `isSafeWorkspaceRelativePath`（`src/core/workspace/continuation-diff-reads.ts:39`）先 `path.normalize` 再判定，用于 diff 路径，不是词法规则的副本。
- `reviewerSourcePathAllowed`（`src/core/workspace/reviewer-source-reader.ts:5`）在词法规则上再加 Candidate 排除项；它保留自己的规则。
- `validateSourceQuery`（`src/core/workspace/ports.ts:293`）是 Query 范围规则；`capture.ts`、`workspace-read.ts` 与 `ports.ts` 都只调 `isSafeSourceRelativePath`，不另写词法校验。
