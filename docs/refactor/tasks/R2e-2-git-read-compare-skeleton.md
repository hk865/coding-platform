# R2e.2：next Git 固定版本读取、比较与 project_source 消费者

状态：2026-09-26，只读实码核对后的待主审冻结骨架设计；尚未实现或运行 DSH。本批承接 [R2e.1 文本任务](R2e-1-text-read-compare.md)和 [R2e 剩余能力调查 §5](../reviews/workspace-remaining-capabilities.md)，不重写旧任务历史。任务目录目前只有 R2e.1 及其返修单，没有 active R2e.2，因此新增本相邻任务。生产/测试路径均相对 `coding-platform/next`。

依据：[Workspace 模块](../modules/core/workspace.md)、`docs/AGENTS.md`、真实 `ports.ts/access.ts/capture.ts/workspace-read.ts` 及 `agent-runtime/project-source-tool.ts`。本批只交只读 Git 对象消费；不交 Git 写入、任意 shell、log/branch 浏览器、mixed Git/capture、Git 工作树 diff 或新 capture provider。剩余 mixed/语言/GUI 范围仍保留，不以本批代替完整 R2e。

## 1. 实际接点与范围

- `WorkspaceVersion` 已有 `{kind:'git',commit:string}`，但 `CaptureRegistry.read/compare` 提前返回 unsupported；`WorkspaceComparison` 仍只有 capture refs。不能只删拒绝后将 Git OID 塞进 SourceCaptureRef。
- `WorkspaceReadAccess` 只有受信 root 派生的 list/read/sourceIdentity；既无 Git 对象能力，也不公开 root。新增能力必须由 `createWorkspaceAccessFactory.open` 在现有 `resolveRoot + authorize + WorkspaceSandbox.create` 后派生，不能从 workspaceIdentity 猜路径或让模型提供 root。
- `CaptureRegistry.track/withAccess/close` 已组合 caller/lifecycle signal，等待每次操作并 finally release。Git read/compare 进入同一 track/withAccess；不分配 captureId、不占 retained capture、无新池/游标/长期缓存。`createWorkspaceTools` 已转发这两个方法，无需新服务或修改组合根。
- `workspace-read.ts` 已有 `diffContent/comparisonChanges/MAX_COMPARISON_BYTES`，继续服务捕获内容。Git tree 的 objectId 与可执行 mode 另有明确含义；不把 objectId 命名为正文 SHA-256，不改变既有 capture 摘要/rename 证据。
- `VerificationWorkspaceReader` 现有固定 `rev-parse/ls-tree`、顶层 root 比较和拒绝 clean-filter 执行是可复用行为依据；其 current-head-to-worktree、mode/link、runBaselineKnown=false 业务不改。它不是这个新公开端口的旁路，也不把它的 changedFiles 当任意两版本结果。
- `project_source` 已是真实 Runtime/Kernel 工具消费者，B1 管 open-on-first-use/close；增加 read 的 Git 分支、compare 的 Git 参数分支即可，不新增 git 工具名或 shell grant。当前 frozen/legacy_live 选择、requireVisible/assertCurrent、真实 Host/Run 身份及来源根绑定均保持。

## 2. 最小公开 DTO：旧 capture 原形保持，新增判别分支

`WorkspaceVersion.git` 不新增字段；本批 `commit` 只接受 **40 或 64 位小写完整十六进制 commit OID**。HEAD、branch/tag、缩写、`~`/`^`、`oid:path`、范围表达式和 argv 均 invalid；不提供先解析可变 ref 的新端点。Git 原生 object format 不合的 OID invalid；OID 存在但不是 commit 也 invalid，不能默默 peel tag/tree/blob。

```ts
export type GitWorkspaceVersion = Extract<WorkspaceVersion, { kind: 'git' }>;
export type CapturedWorkspaceComparison = {
  before: SourceCaptureRef; after: SourceCaptureRef;
  scope: CaptureContentScope;
  comparison: 'captured_content_only'; complete: true;
  changes: WorkspaceChange[];
};
export type GitFileIdentity = {
  objectId: string; // Git blob OID，明确不是正文 SHA-256
  mode: '100644' | '100755';
};
export type GitWorkspaceChange =
  | { kind: 'added'; path: string; after: GitFileIdentity }
  | { kind: 'deleted'; path: string; before: GitFileIdentity }
  | { kind: 'modified'; path: string; before: GitFileIdentity; after: GitFileIdentity };
export type GitWorkspaceComparison = {
  before: GitWorkspaceVersion; after: GitWorkspaceVersion;
  scope: { kind: 'git_regular_files'; selectionVersion: 'authorized-regular-blob-v1';
    prefix: string | null };
  comparison: 'git_tree_content_and_mode'; complete: true;
  changes: GitWorkspaceChange[];
};
export type WorkspaceComparison = CapturedWorkspaceComparison | GitWorkspaceComparison;
```

`WorkspaceComparisonRequest` 保留 workspace/before/after 的现有 declared union，追加可选 `prefix?: string`，仅 Git/Git 接受；缺省是本次授权下的全部规范仓库文件路径。capture/capture 带 prefix invalid（范围由原两 capture 决定），Git/capture 或 capture/Git 明确 unsupported，working_tree 比较仍 invalid。不要为让请求类型好看而破坏已有调用签名。

`WorkspaceFile` 不变：Git read 返回实际原字节 SHA-256、`sizeBytes`（取实际 `bytes.byteLength`）、`digestBasis:'raw_bytes'`、原完整 Git version 和 readAt。正文仍严格 UTF-8/no-NUL；BOM 按现有解码展示语义，不以重编码正文冒充原字节摘要。Git read 只支持普通文件模式；symlink/gitlink/directory 明确 unsupported，不追随当前文件/链接。历史路径已从工作树删除或被替换不影响合法历史读取。

Git comparison 不读取正文、不要求 UTF-8 文本：二进制普通 blob 的 OID 可比较；同 path 的 OID 或 mode 任一变化即 modified，mode-only 不能漏报。不同 path 的相同内容仍 add/delete，本批不做 Git rename 猜测；原 capture 的 identical_content rename 规则不变。complete 仅指声明 prefix 与当前授权允许的普通文件域，不是全仓、不含无权路径，不是验证/Run 前后证明。域内遇 symlink/gitlink 等非普通项整次 unsupported，不静默跳过后声称该域完整。

## 3. 受信 bound Git I/O 与共享生命周期

在 `access.ts` 给 `WorkspaceReadAccess` 追加可选 `readonly git?: WorkspaceGitReadAccess`，保留既有手写窄 fixture/嵌入 reader；未提供则 Git 请求 unsupported。真实 `createWorkspaceAccessFactory` 提供这个 capability，但只在 Git 方法实际调用时探测仓库，普通 read/capture 不新增 Git 调用。

建议内部接口（不加入模型 JSON，也不从公共 Runtime 给模型注入）：

```ts
export interface WorkspaceGitReadAccess {
  readFile(input: { commit: string; path: string; maxBytes: number }):
    Promise<WorkspaceResult<{ commit: string; bytes: Uint8Array }>>;
  readTree(input: { commit: string; prefix: string | null;
    maxEntries: number; maxBytes: number }):
    Promise<WorkspaceResult<{ commit: string;
      files: readonly ({ path: string } & GitFileIdentity)[] }>>;
}
```

只在新 `git-read.ts` 内实现绑定对象；创建参数由 access factory 提供仅供内部使用的根句柄取得能力（绑定已创建 sandbox 的 `acquireRootHandleForProcess`）、**现有** authorization.allowsRead、当前 signal/liveness；不公开 sandbox/root/句柄，也不发布 `runGit(args)`。factory 继续使用 `WORKSPACE_DENIED_PREFIXES + DefaultPermissionPolicy + Host allowsRead` 得到同一 allowed 谓词，Git 对历史 tree path 使用这个谓词；不能把“当前文件不存在”解释为无权，也不能为了读取 `.git` 元数据而允许模型读 `.git/config`。

每次操作只有一次 fresh access。Git/Git 两树在同一次 open 下使用同一主体/权限/根，不嵌套两次 open，不为历史查询再加载 Role/material/Plan 全链。若调用来自 Runtime，其现有 Work/Query/Reviewer binding 和 assertCurrent 自行保持；Git reader 不额外强制当前 HEAD 等于所读 commit。权限撤销在下一次操作通过原 Host authorize 拒绝，不缓存上次授权。

根边界直接复用公开 `WorkspaceSandbox.acquireRootHandleForProcess(): Promise<FileHandle>`：现有实现以只读目录方式打开已解析的根，并在返回前核对原根身份；失败时由 Kernel 关闭未返回句柄。这里由受信 access factory 的内部 Git 适配器取得该进程根能力，不交给模型或具体 ToolHandler；该能力只提供已绑定目录，不代替 Host authorize、路径 allowed/requireVisible 或既有 allowRoot 判定。删除平台另写 open/fstat/根身份算法的方案，不调用 Kernel 私有方法、不改 Kernel 产物。Git 子进程 cwd 固定到仍打开的根目录句柄（当前 Linux `/proc/<parent-pid>/fd/<fd>`），不在执行瞬间重新追随 root 字符串；仓库顶层核对以该句柄对应的实际根为准，合法 Host root alias 不因字符串不同误拒。返回的句柄所有权属于调用方；Git 适配器在本次 operation 的 finally 中、全部子进程实际 close 后负责 `handle.close()`，成功、失败、取消均归还关闭，不留给 Sandbox 隐式回收。

先用固定只读 metadata 命令确认仓库顶层就是此根；父仓库中的注册子目录、裸仓库和非 Git 返回 unsupported。普通仓库与合法 linked worktree 的 metadata 位置只由真实 Git 解析，模型不能指定 git-dir/common-dir；不得任意上溯。解析/定位失败明确拒绝，不将错误当成空树。历史对象被 GC/缺失可报 not_found；合法根在操作内换绑、无法保持身份则 source_stale/forbidden，无部分结果。

## 4. 固定进程协议与有界行为

仅 `execFile/spawn('git', fixedArgs, {shell:false,...})`，不执行 shell 文本。沿 VerificationWorkspaceReader 已有 `--no-optional-locks`、`core.fsmonitor=false`、`core.untrackedCache=false` 约束，额外禁止 replacement 和按需 fetch；不调用 diff/show/textconv/checkout/status/add/commit、hooks、工程脚本或任意外部 driver。

- 子进程环境剔除 caller 的 `GIT_*` 覆盖（尤其 GIT_DIR/WORK_TREE/OBJECT_DIRECTORY/ALTERNATE_OBJECT_DIRECTORIES/CONFIG_PARAMETERS/CONFIG_COUNT/EXEC_PATH），再仅设置本适配器批准的只读值。禁系统/全局配置、pager、terminal prompt、optional locks、replace objects、lazy fetch；使用确定 locale。不能因为固定 argv 就继承环境重定向到另一仓库。partial/promisor 仓库若当前 Git 无法保证离线缺对象直接失败，则 unsupported，不自动联网补对象。
- 内部允许的命令种类固定为仓库定位/对象格式、单对象 `cat-file --batch-check`、NUL 分隔 `ls-tree`、`cat-file blob <validatedBlobOID>`。每次 batch-check 的 stdin 仅写一个已验证且符合仓库 object format 的完整小写 OID 加换行，随后关闭 stdin；不接收模型表达式、路径或批量协议文本。严格解析唯一机器响应：成功退出且响应恰为该 OID 加 ` missing` 才分类 not_found；正常响应须为同一完整 OID、已知 object type 与合法十进制 size，commit 准入及 blob 类型/大小由此核定。非 commit 的正常对象响应仍 invalid；其它对象查询异常（非零退出、响应缺失/多余/畸形或 OID 不符等）均 unavailable，不用 exit 128 或 stderr 猜 missing。正文读取阶段的未知进程失败也不冒充 not_found。模型 path 不拼入 `commit:path` 或 revision 字符串；使用逐级 tree 精确名称匹配，或 `--literal-pathspecs` 与独立 `--` 后 path 参数，解析后必须仍核对返回 path 完全一致。
- 已核 commit 固定后所有后续动作只用其 OID/tree/blob；绝不重新读取 HEAD 决定正文。`readFile` 精确取目标项，不能为读一个已知历史文件捕获工作树、调用 TS analyzer 或扫描全仓正文。先确定 mode/blob-size 再读原 blob，超 maxBytes 直接 capacity。
- NUL 分隔按 bytes 严格解析，规范相对路径与字面 prefix 边界沿现有规则；Git 非 UTF-8/无法被现有路径协议准确表达的路径明确 unsupported，不能替换字符后改名。授权过滤先于向调用者返回任何 path/objectId；拒绝项名称/数量不进入响应样本或错误消息。
- 每个进程时间上限 5 秒，stdout/stderr 有界；tree 使用原 maxInventoryFiles（最多 60,000）和固定最多 8 MiB 的输出上限，在流式收集中越界即终止并等 close。不能只统计最终过滤后数量而无限读取仓库。read blob 以实际请求 maxBytes（不高于 maxFileBytes）为硬限；不先读大对象再截断。
- comparison 按规范 path 稳定排序，复用已有 diffContent 的路径集合思想/可复用纯集合差，不能再建 Git diff 引擎。OID 保持 objectId 的语义，不经 capture digest API 暗换算法。结果数 maxQueryResults、序列化字节 MAX_COMPARISON_BYTES，超限 capacity，不返回部分 changes+complete=true。两树均只短期存于当前操作，返回后无 retained capture/cursor。
- cancellation/timeout/close 必须终止本次子进程、等待实际 close、释放句柄，再结束 track；AbortSignal 不等于已退出。已有 registry.close 负责等待在途，不新增后台守护。取消 cancelled、输入 invalid、无权 forbidden、内容/模式 unsupported、容量 capacity、缺对象 not_found、未知进程/I/O unavailable；不依赖本地化 stderr 文本猜精细语义。

## 5. project_source 的兼容 wire 与真实消费者

保持 action 数量和旧 compare 参数，增加严格分支：

```ts
// 原 read 两个 version 分支不变，追加 git。
{ action: 'read'; path: string; maxBytes: number;
  version: { kind: 'git'; commit: string } }
// 原 capture compare JSON 原样接受。
{ action: 'compare'; before: SourceCaptureRef; after: SourceCaptureRef }
// 新 Git compare，before/after 的形状与旧 refs 明确互斥。
{ action: 'compare'; before: { kind: 'git'; commit: string };
  after: { kind: 'git'; commit: string }; prefix?: string }
```

工具 schema 保持严格未知字段拒绝；action=compare 的内层用 union/refine 校验 pair，不增加重名 discriminator 分支导致 Zod 装配失败。Commit OID 与 prefix/path 结构在取 deferred access 之前检查；read path 和 compare prefix 都走原 requireVisible。Root、project/workspace、principal、role、revision、permissions、argv/shell/env 不能出现在 JSON。

dispatch 仍调用同一个 `access.port`；旧 refs 包装为 capture versions，新 Git versions原样传递，scope始终来自可信 access。read 上限8192 bytes、整个模型 JSON 上限60KiB、Kernel输出上限64KiB保持；Git compare超模型上限明确失败，提示缩小prefix，不裁剪结果冒充完整。结果继续原 WorkspaceResult/typed JSON，完整 commit/objectId/mode/comparison label保留，不只放 metadata sample。

沿 B1 first_use 真实懒打开：无read grant、未调用、不合法参数都不打开Git能力；用后由原 runObservedModel 所有权 close。原capture/query/verify/release/working_tree、明确legacy_live、TS/Python/C++旧工具不变。正式 `createAgentRuntime` 的 B2 prepare/start 已可通过 `workspace/sourcePolicyFor` 同一根授权装配该工具，不需新增 production Host字段或第二服务；测试复用既有fixture的真实源码工厂和宿主 override。

## 6. 精确拟议 scope

生产仅六文件：

1. `src/core/workspace/ports.ts`：Comparison判别联合和Git结果DTO、Git compare prefix。
2. `src/core/workspace/access.ts`：可选bound Git读接口；真实factory派生能力与释放，不扩大 Host grant。
3. **新** `src/core/workspace/git-read.ts`：受限Git进程/根句柄/对象读取，以及公开read/compare所需的内部映射；没有第二registry。
4. `src/core/workspace/capture.ts`：真实Git分支校验/单次withAccess、复用track/close，原capture分支不改算法。
5. `src/core/workspace/workspace-read.ts`：原纯capture结果精确标为 CapturedWorkspaceComparison；复用MAX_COMPARISON_BYTES，若需要提取现有纯集合差仅在本文件内完成，不改变旧digest/rename行为。
6. `src/core/agent-runtime/project-source-tool.ts`：Git read/compare的strict schema、薄dispatch、描述；不改共享Runtime授权链。

测试仅两文件：**新** `tests/data/R2e-git-operations.test.ts`、**新** `tests/runtime/R2e-git-source-loop.test.ts`。既有文本/data/source-loop/VerificationWorkspaceReader/B2来源测试只读回归。若TS真实调用点因判别union需要补窄，应先列出精确位置由主审调整；不要把旧测试强转any或批量放宽类型。

主审持有 selectors/文件归属登记、能力文档和派发scope；本任务书之外未获写授权。无 vendor patch、新依赖安装、Material/RecordStore修改或composition新增服务；`workspace-tools.ts`八方法已能消费实现，不为记录进度无效修改。

## 7. 少量公开端口与真实模型验收

两文件约8项有区分力的测试，不铺语言/数据库全矩阵：

1. **真实历史正文**：临时Git仓库两个commit+dirty/deleted当前文件；经真实Host bindings→createWorkspaceAccessFactory→createWorkspaceTools.readWorkspace读两个固定OID，核正文、原bytes SHA256/BOM 对应的公开 sizeBytes。工作树/HEAD改变不改变所选历史；普通working_tree/text捕获仍原行为。
2. **真实树比较**：同一仓库add/delete/content change/mode-only/二进制，一次Git compare核精确objectId/mode和标签，唯一同内容换名明确add/delete；prefix边界不含prefix-old。不是通过假的Git进程结果证明功能。
3. **授权/根边界**：真实Host grant允许公开路径并拒绝私有历史路径；直接read forbidden、compare不泄漏；下一操作撤权拒绝。非Git与父仓库子目录不借父历史；root绑定差异拒绝。普通linked worktree使用其真实注册根，不接受模型git-dir。
4. **输入/类型/容量**：短小表驱动覆盖表达式/恶意argv式OID、越界path、tree非commit、symlink/gitlink和大blob，明确分类；read二进制unsupported而同一文件tree比较允许。compare超数量/bytes无半份ready；Git/capture明确unsupported、旧capture/capture形状不变。
5. **无可配置执行**：仓库配置实际clean filter/textconv/external diff哨兵，固定Git读比较不触发；污染GIT_DIR等环境也不能改读另一个仓库。测试只在临时目录创建fixture；不执行用户仓库脚本，不以source-inspection断言代替公开结果。
6. **取消和close**：真实Git读管道可控悬停（最小进程层观察包装必须转发真实child，不替换对象结果），abort/close后等待child close，零后续输出/句柄泄漏；不要只在进入前已aborted导致此场景假绿。若夹具无法确定性控制该窗口，先向主审报精确接缝，不增加生产任意command注入口。
7. **真实模型消费**：复用 `createB2RuntimeFixture`，在其已授权真实workspace建临时Git仓库；公开prepare/start→真实Kernel/脚本ModelClient实际调用project_source Git read与Git compare→下一模型请求核完整typed结果→正常terminal。只替换外部模型，真实TaskClaim/Role/Host/root/WorkspaceTools均保留；没有shell/write grant也能只读Git，无读grant不能获得工具。Fixture若需路径scope可用现有 rebuild/workspace/sourcePolicyFor override，不复制B2服务。
8. **旧协议/生命周期**：同一真实模型回合再用已有capture/read/compare JSON验证兼容，或复用原source文本loop只读回归；git操作不创建captureRef，source access仍只开一次且owned close一次，非法Git参数在打开前拒绝。Query/Reviewer特殊资格不在此复制；其现有来源校验保持，不能为了历史read禁用assertCurrent。

骨架阶段只发布类型、真实capability传递和明确unsupported接缝；不能提前执行Git对象算法。真实fixture前置须到新unsupported而非权限/注册/错误OID；测试只断言最终行为，后段被首红遮挡应如实报告，不同时expect unsupported与ready。交付停止中审；主审冻结后DSH实现只读测试。最终通过专项、next types、边界检查和既有文本/Verification/来源消费者邻接回归才可声明Git read/compare已接通。普通GUI版本预览、mixed比较、Git log和Python/C++冻结仍各有后续范围，不能自动打勾。
