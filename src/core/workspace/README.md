# src/core/workspace：文件、Git、源码捕获与索引的只读观察层

## 负责什么，不负责什么
- 按路径读当前/冻结文件、Git 固定版本、源码捕获与查询、Python/C++/TS 索引；只观察 Host 已授权的工作区。
- module-target 声明本模块依赖为空：不获得 RecordStore，不写记录/事件，不提交，不运行或修改 Session。
- 根与权限由 Host 注入（`WorkspaceHostBindings`）；每次 `open` 重跑 `resolveRoot` + `authorize`，模型参数不能指定任意绝对根。
- 路径边界、捕获、分页游标与各语言索引规则只在本层实现一次；其他层引用，不另写一份。
- 可调用 Node、解析器与 Kernel 的只读 `WorkspaceSandbox` 库能力；这不等于依赖 AgentRuntime。
- 不决定架构职责、不改任务图、不判断完成；changed paths 只是失效提示，不能证明其他文件没变。

## 文件
- `access.ts` — 根绑定与每次读取资格：包装 `WorkspaceSandbox`，把 Host 授权与内核路径策略取交集。
- `path-validation.ts` — `isSafeSourceRelativePath`：唯一的词法源相对路径规则（非空、≤4096 UTF-16、无 `\`/`:`/NUL、每段非空且不是 `.`/`..`）。
- `ports.ts` — 本层请求/结果/端口 DTO，`deepFreeze` 与 `validateSourceQuery`。
- `workspace-tools.ts` — 装配唯一公开工具面 `WorkspaceToolsPort`、Host 限额校验与 continuation 读取。
- `capture.ts` — `CaptureRegistry`：捕获/观测、查询、导出、核验、释放、架构源、文件图、读/比较、关闭。
- `denied-prefixes.ts` — `WORKSPACE_DENIED_PREFIXES`：拒绝前缀的唯一来源。
- `git-read.ts` — 固定 argv/环境、只读的 Git 文件/树读取与 commit↔commit、git↔工作树比较。
- `workspace-read.ts` — 当前或冻结文件的精确读取与同范围内容比较。
- `duplicate-candidates.ts` — 比较后侧的重复候选：顶层声明与字符串字面量经 `readTopLevelDeclarations`/`readStringLiterals` 两读，按新位置、上限与字节预算出报告。
- `project-source-snapshot.ts` — TS/JS 与观测的 live 清单/正文/身份捕获、摘要、跳过与容量拒绝。
- `typescript-source-query.ts` — 冻结 TS/JS 分析（Language Service）与 tsconfig/jsconfig 配置选择。
- `typescript-light-scan.ts` — 观测用 TS/JS 纯语法轻扫（不建 Program/LanguageService）。
- `source-query.ts` — 从同一份冻结捕获切页的查询、游标和 wire 形状映射。
- `source-index.ts` — 显式文件集的只读 TS 语义查询（symbol/definition/reference）与 excerpt。
- `python-source-index.ts` — 经分析器 NDJSON 协议解析 Python 来源的索引。
- `cpp-source-index.ts` — 经 libclang 解析 C/C++ 来源的索引，不执行项目自带编译器。
- `analysis-runner.ts` — Python/C++ 共用的有界 NDJSON 子进程执行器（超时、重启、输出上限）。
- `architecture-language-provider.ts` — 语言 provider seam，以及 Python/C++ provider 与路径语言判定。
- `architecture-source.ts` — 只按显式 mapping 把冻结 imports 折叠成架构源图（纯函数）。
- `text-source-snapshot.ts` — 严格文本捕获：每个选中文件必须是可读 UTF-8、无 NUL。
- `continuation-diff-reads.ts` — continuation 单文件 diff 两侧的 1 MiB 有界只读字节。
- `workspace-baseline-artifact.ts` — 从 prepared manifest bundle / capture Artifact 读 baseline 与完整变更。
- `workspace-change-capture.ts` — run 起始 baseline 与结算 change capture 共用的只读遍历。
- `candidate-workspace-reader.ts` — candidate 范围快照、摘要与 git entry（含符号链接/特殊文件规则）。
- `verification-workspace-reader.ts` — 验证轮来源：当前源码、Git 基准比较与 requeue source digest。
- `reviewer-source-reader.ts` — reviewer 路径允许规则（复用 candidate 排除项）。
- `source-identity.ts` — 一次固定的 `git rev-parse --verify HEAD` 身份读取，非 Git 返回 `commit:null`。

## 可以复用的能力
| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `createWorkspaceAccessFactory` | `src/core/workspace/access.ts:83` | 用 Host 的 `resolveRoot`/`authorize` 打开一次绑定的读取资格 | 组合根给本模块注入真实根与权限时 |
| `createWorkspaceTools` | `src/core/workspace/workspace-tools.ts:74` | 组装唯一 `WorkspaceToolsPort`（捕获/查询/读/比较）与 continuation 读取 | 组合根装配 `platform.workspace` 时；消费方不要再建 registry |
| `WorkspaceToolsPort` | `src/core/workspace/ports.ts:213` | 本模块对外的窄端口与结果类型 | 消费方只注入端口，不拿 registry/sandbox |
| `WORKSPACE_DENIED_PREFIXES` | `src/core/workspace/denied-prefixes.ts:31` | 拒绝前缀的唯一清单（内核默认 + 平台追加） | 命令检查、取材、运行时读源码需要同一路径边界时 |
| `isProtectedWorkspacePath` | `src/core/workspace/continuation-diff-reads.ts:57` | 规范化 workspace 相对路径后判断是否落在 Host 拒绝前缀内 | AgentRuntime 过滤受保护路径；先 `normalizeWorkspaceRelativePath`，不要另写前缀匹配 |
| `CaptureRegistry` | `src/core/workspace/capture.ts:124` | 有界保留的捕获、游标、容量、失效与导出 | 只要实现捕获/查询语义时；不直接实例化第二份 |
| `createWorkspaceGitReadAccess` | `src/core/workspace/git-read.ts:399` | 绑定到已授权 root 的只读 Git 读取能力 | 已有 `WorkspaceReadAccess` 时要 commit/树读取 |
| `readGitWorkspaceFile` | `src/core/workspace/git-read.ts:510` | 读某个完整 commit 下的一个文本文件 | 读固定 Git 版本文件时 |
| `compareGitWorkspaceTrees` | `src/core/workspace/git-read.ts:537` | 比较两个完整 commit 的文本树 | Git↔Git 来源比较时 |
| `compareGitWorkingTree` | `src/core/workspace/git-read.ts:617` | 比较 Git commit 与工作树的普通文本和 mode | Git↔working tree 比较时 |
| `duplicateCandidates` | `src/core/workspace/duplicate-candidates.ts:66` | 在一次比较的 after 材料上列出新的重复定义与字面量候选，带两处位置与 coverage | 比较请求带 `duplicates: true` 时；由 capture/git 两臂调用，不要另建索引 |
| `readWorkspaceBaseline` | `src/core/workspace/workspace-change-capture.ts:230` | 一次只读遍历得到 run 起始 baseline | 执行前冻结工作区基线时 |
| `captureWorkspaceChange` | `src/core/workspace/workspace-change-capture.ts:276` | 同一次遍历得到结算变更、notVisible 与样本 | 执行结束后取变更时；不要另走目录遍历 |
| `readWorkspaceBaselineFromBundle` | `src/core/workspace/workspace-baseline-artifact.ts:34` | 读 prepared manifest 内的 baseline，坏/缺都降级为 null | 需要 run 起始快照且不能因坏 Artifact 失败时 |
| `readWorkspaceCaptureChanges` | `src/core/workspace/workspace-baseline-artifact.ts:60` | 读 `WorkspaceCaptureV1` 背后的完整变更记录 | 需要变更全量分类、而不是样本时 |
| `readContinuationBaselineBlob` | `src/core/workspace/continuation-diff-reads.ts:88` | 用 `git cat-file blob` 读 diff 旧侧，失败返回 typed unavailable | continuation 文件 diff 的旧侧 |
| `readContinuationCurrentFile` | `src/core/workspace/continuation-diff-reads.ts:118` | 读 diff 新侧，拒绝 protected prefix 与符号链接逃逸 | continuation 文件 diff 的新侧 |
| `VerificationWorkspaceReader` | `src/core/workspace/verification-workspace-reader.ts:12` | 验证轮的当前源码/基准比较/requeue digest 来源 | 装配 `VerificationRoundSourcePort` 时 |
| `CandidateWorkspaceReader` | `src/core/workspace/candidate-workspace-reader.ts:64` | candidate 范围的整树快照与 git entry | 需要 candidate 级摘要或验证基准时 |
| `SourceIndex` | `src/core/workspace/source-index.ts:29` | 显式文件集的只读 TS 语义查询与有界 excerpt | 探索工具要符号/定义/引用时；不是全仓索引 |
| `TypeScriptSourceAnalyzer` | `src/core/workspace/typescript-source-query.ts:135` | 对一份冻结快照做同步 TS 分析 | 捕获后重复分析且不能再有 I/O 时 |
| `readTopLevelDeclarations` | `src/core/workspace/typescript-source-query.ts:317` | 只列顶层声明，不走进嵌套节点 | 需要在比较材料里按顶层名字找重复时 |
| `readStringLiterals` | `src/core/workspace/typescript-source-query.ts:344` | 列出字符串字面量的位置、预览、长度与 digest | 需要在比较材料里找重复字面量时 |
| `CppSourceIndex` | `src/core/workspace/cpp-source-index.ts:16` | 权限过滤后的 C/C++ 来源查询 | 探索工具要 C/C++ 符号/import 时 |
| `PythonSourceIndex` | `src/core/workspace/python-source-index.ts:17` | 权限过滤后的 Python 来源查询 | 探索工具要 Python 符号/import 时 |
| `readSourceIdentity` | `src/core/workspace/source-identity.ts:4` | 读 workspace 的固定 HEAD 身份 | 需要来源 pin、又不想引入完整 Git 读取时 |

路径校验的共用词法规则是 `isSafeSourceRelativePath`（`src/core/workspace/path-validation.ts:3`）；真实路径包含判断在 app 的 `isPathWithin`，Query 范围规则是 `validateSourceQuery`（`src/core/workspace/ports.ts:243`）。

## 内部用
- 捕获/读取内部件：`captureProjectSource`、`captureObservationSource`、`projectSnapshotOf`、`observationSkipReason`、`normalizeCoverageNotes`、`captureTextSource`、`scanTypeScript`、`querySource`、`toSourceLocation`、`toSourceRelation`、`toCallRelation`、`toSourceDiagnostic`、`toSourceFileEntry`、`readCapturedFile`、`readWorkingTreeFile`、`diffContent`、`summaryChanges`、`comparisonChanges`、`compareCapturedFiles`、`scopeContains`、`manifestOf`、`readFailure`、`deepFreeze`、`validateSourceQuery`。
- 常量与纯规则：`SOURCE_ROOT`、`SOURCE_ENGINE`、`TEXT_ENGINE`、`sha256Text`、`textSourceKey`、`isSourcePath`、`isIgnoredSourcePath`、`isSafeSourcePath`、`isProjectInputPath`、`isObservationSkippedPath`、`OBSERVATION_SKIP_DIRECTORIES`、`OBSERVATION_INVENTORY_CAPACITY`、`CONFIG_DATABASE_FILE_BYTES`、`MAX_COMPARISON_BYTES`、`CONTINUATION_DIFF_MAX_BYTES`、`normalizeWorkspaceRelativePath`、`WORKSPACE_CAPTURE_MAX_CHANGES`、`WORKSPACE_CAPTURE_NOT_VISIBLE_MAX`、`WORKSPACE_CAPTURE_FIXED_IGNORED`、`DEFAULT_WORKSPACE_LIMITS`、`DUP_MIN_STRING_CHARS`、`DUP_LIMIT`、`DUP_LITERAL_PREVIEW_CHARS`、`DUP_REPORT_MAX_BYTES`、`DUPLICATE_LIMITS`、`isCompleteCommitOid`、`GIT_TREE_OUTPUT_LIMIT_BYTES`、`GIT_PROJECT_LISTING_MAX_RECORDS`、`GIT_PROJECT_LISTING_MAX_BYTES`、`formatProjectListingCapacity`、`languageOfPath`、`createCppLanguageProvider`、`createPythonLanguageProvider`、`mapArchitectureSource`、`runAnalysis`、`candidateWorkspaceIncludesPath`、`configureTypeScriptProject`、`ProjectSourceFailure`。

## 不要做
- 不要在别处复制拒绝前缀或另建根；`denied-prefixes.ts` 是唯一来源，真实根与 `allowsRead` 只由 Host 注入。
- 不要把读取失败折成空清单、空结果或 `not_found`；失败就是失败（FP-05、MH-06）。
- 不要用模型参数指定绝对根、放宽 `allowsRead`，或让 Git 接受 ref/短哈希与外部环境（`git-read.ts` 只收完整 OID）。
- 不要另写捕获、分页游标或各语言索引规则；用 `CaptureRegistry` 和同一 capture 的游标。
- 不要用 shell/hook/外部 diff 读仓库，也不要让项目自带的编译器执行；Git 与解析器调用已有固定入口。
- 不要承诺“完整工作树”：capture 的 scope/coverage 有明确上限，`complete` 不等于整个仓库或完整调用图。
- `isSafeSourcePath`（`src/core/workspace/project-source-snapshot.ts:102`）是源码捕获的路径规则，不做 4096 上限；它不是 `isSafeSourceRelativePath` 的副本。
- `isSafeWorkspaceRelativePath`（`src/core/workspace/continuation-diff-reads.ts:37`）先 `path.normalize` 再判定，用于 diff 路径，不是词法规则的副本。
- `reviewerSourcePathAllowed`（`src/core/workspace/reviewer-source-reader.ts:5`）在词法规则上再加 Candidate 排除项；它保留自己的规则。
- `validateSourceQuery`（`src/core/workspace/ports.ts:243`）是 Query 范围规则；`capture.ts`、`workspace-read.ts` 与 `ports.ts` 都只调 `isSafeSourceRelativePath`，不另写词法校验。
