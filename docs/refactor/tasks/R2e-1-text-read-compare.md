# R2e.1：严格文本捕获、文件读取与同范围内容比较

状态：2026-09-23 主Agent已确定骨架，独立16项测试已落盘冻结（core14、真实模型闭环2）。未实现基线2文件16项均RED；本地dsh已正常返回，待主Agent独立验收；当前按用户要求先清理文档。C=`/home/hyh001/projects/coding-platform/coding-platform`，N=`/home/hyh001/projects/coding-platform/docs/refactor`。所有 `src/`、`tests/` 相对 C。本页是主Agent选定的串行任务书；R2d.3独立验收后才派发，不抢改dsh现行文件。

依据：N/reviews/workspace-remaining-capabilities.md、modules/core/workspace.md §3–5；实际 `ports.ts`、`capture.ts`、`source-query.ts`、`workspace-tools.ts`、`access.ts`、Kernel WorkspaceSandbox。实际 registry 在 **capture.ts**，没有 capture-registry.ts；本批不为名称重搬文件。

## 1. 已选定范围与真实入口

本批实现四项：

1. `readWorkspace(working_tree|capture)`：精确当前文件或现有捕获正文；不为读已知文件强制扫描全仓。
2. `captureSourceChanges(provider='text')`：严格文本范围的有界冻结；TS 捕获原算法保持。
3. `querySource(paths|text)`：在已冻结文本上查询；TS 捕获也可查其已捕获的 TS/JS/JSON 文本。
4. `compareWorkspace(capture,capture)`：同声明范围的完整内容比较，无 Git/模式/链接语义。

真实消费者选择 R2d 已接通的 `project_source`：给其 capture 加可选 provider、query 加 paths/text，并接两个薄的 read/compare 动作。复用实际 Work/Query 主体、完整请求绑定、Reviewer policy、owned close，**不新增 Host 身份**。原四动作/TS 默认及旧工具均保持兼容。这样新 core 行为有真实 Kernel/本地模型调用路径，且无需先改 GUI 身份规则。

`/api/files/preview`、文件引用预览、普通人类文件读取的迁移留后批：现行 GUI 的 token/mount/read 权限不能凭 `CorePrincipal.kind='host'` 变为新授权。不要为本批替 GUI 制造 Run，也不要把 R2c 架构 reader 的拒绝放开。

工具描述与能力矩阵必须明确以下范围，不能宣传“完整静态图”或“全仓搜索”：

| 能力 | 实际内容范围 | 不完整/不适用的行为 |
|---|---|---|
| text capture | 指定 prefix 内许可普通 UTF-8/no-NUL 文本；prefix 缺省表示根范围 | 根范围含图片等二进制时整次 unsupported，不自动跳过后说完整 |
| paths on text | text capture 实际已保存的文件 | 不包含二进制、无权限项、符号链接，不是工作树完整文件清单 |
| paths on typescript | 现有 TS capture 的真实输入 inventory，包括其已捕获 TS/JS/JSON | 不补扫 README/其他源文件，响应 scope 标记 typescript_project_inputs |
| text query | 所选 provider capture 已保存的文本 | 只在声明域内搜，禁止在某页偷偷退回 live/full-worktree 搜索 |

## 2. 现有实现可复用的部分

| 实际符号/文件 | 直接复用 | 不应误称已具备 |
|---|---|---|
| `CaptureRegistry.track/withEntry/charge/close`，capture.ts | lifecycle signal、在途等待、fresh access、完整 ref、主体/权限/根、TTL/bytes/readers/tombstone | 当前只保存 TS snapshot/analyzer，不能给 text 造 TS analyzer |
| `querySource/completeHits/cursorFor`，source-query.ts | 规范查询摘要、完整结果缓存、字节计费、不可消耗游标、同 ref 续页 | paths/text 当前立即 unsupported；补真实算法后才开放 wire |
| `captureProjectSource`，project-source-snapshot.ts | TS 原捕获、输入 Map、摘要算法；其冻结文件 Map 的结构可复用 | 它只选择 TS/JS/JSON，不能重命名成通用 text capture 后继续漏 README/Python |
| `CaptureRegistry.diff` | path/digest 的集合比较机械逻辑，可提取为同范围比较内部 helper | 它目前只有 added/modified/deleted 路径，且不证明任意 provider/range 可比 |
| `WorkspaceReadAccess.read`→`WorkspaceSandbox.read` | 单文件有界读取、O_NOFOLLOW、实际授权、严格 UTF-8/NUL/类型/大小检测 | 没有 Git 历史字节、二进制正文、目录列举结果 DTO |
| `WorkspaceSandbox.listFiles` | 规范路径、排序、权限/链接过滤、截断标志 | 非原子文件系统快照；无权限文件/符号链接不在文本声明域中 |
| `SourceIndex`/旧 search/list_files | 路径、字面检索、范围限制的既有行为参考 | 不调用其 live query 做 frozen 分页；不复制 AST 服务 |
| `project-source-tool.ts` | strict schema、来源上下文绑定、元数据样本、输出限额、未交付 capture 回收 | 不能把正文也塞进 metadata sample 后称完整读取 |

## 3. 准确 Port 与 DTO

保留现有 `WorkspaceCapturePort` 六方法；新增完整端口扩展，现有窄消费者无需改名：

```ts
// src/core/workspace/ports.ts；沿用 CoreCallContext、WorkspaceRef、SourceCaptureRef。
export type WorkspaceVersion =
  | { kind: 'working_tree' }
  | { kind: 'git'; commit: string }
  | { kind: 'capture'; capture: SourceCaptureRef };
export type ReadWorkspaceRequest = {
  workspace: WorkspaceRef; path: string; maxBytes: number;
  version: WorkspaceVersion;
};
export type WorkspaceFile = {
  path: string; content: string; digest: string; sizeBytes: number;
  digestBasis: 'raw_bytes' | 'decoded_utf8';
  version: WorkspaceVersion; readAt: string;
};
export type CaptureContentScope =
  | { kind: 'typescript_project_inputs'; selectionVersion: 'ts-js-json-v1';
      prefix: null; digestBasis: 'decoded_utf8' }
  | { kind: 'text_files'; selectionVersion: 'readable-regular-utf8-no-nul-v1';
      prefix: string | null; digestBasis: 'raw_bytes' };
// SourceCoverage 增加必填 scope: CaptureContentScope；其余现有字段保留。
// complete 表示 scope 内完整处理，不表示完整工作树/完整语义图。
export type WorkspaceComparisonRequest = {
  workspace: WorkspaceRef;
  before: Exclude<WorkspaceVersion, { kind: 'working_tree' }>;
  after: Exclude<WorkspaceVersion, { kind: 'working_tree' }>;
};
export type WorkspaceChange =
  | { kind: 'added'; path: string; digest: string }
  | { kind: 'deleted'; path: string; digest: string }
  | { kind: 'modified'; path: string; beforeDigest: string; afterDigest: string }
  | { kind: 'renamed'; beforePath: string; afterPath: string;
      digest: string; evidence: 'identical_content' };
export type WorkspaceComparison = {
  before: SourceCaptureRef; after: SourceCaptureRef;
  scope: CaptureContentScope;
  comparison: 'captured_content_only'; complete: true;
  changes: WorkspaceChange[];
};
export interface WorkspaceToolsPort extends WorkspaceCapturePort {
  readWorkspace(ctx: CoreCallContext, input: ReadWorkspaceRequest):
    Promise<WorkspaceResult<WorkspaceFile>>;
  compareWorkspace(ctx: CoreCallContext, input: WorkspaceComparisonRequest):
    Promise<WorkspaceResult<WorkspaceComparison>>;
}
```

模块页原来计划返回裸 `WorkspaceChange[]`，主Agent明确选定在尚未实现时改为上述带范围的响应，防止 TS 子集或文本范围被说成整个工作树的增删。原 `WorkspaceResult` 错误联合不增加；Git 请求诚实返回 unsupported。

### 3.1 字节与摘要的真实来源

Kernel `WorkspaceSandbox.#readAt` 返回 `byteLength` 和 `revision=sha256(buffer)`，严格 TextDecoder 可能去 UTF-8 BOM。当前 `WorkspaceReadAccess.read` 类型只列 content/revision，但实际转发完整 Kernel 结果。应补成：

```ts
// access.ts；底层已经真实支持，不改 vendor。
read(path: string, maxBytes: number):
  Promise<{ content: string; revision: string; byteLength: number }>;
```

新 working_tree/text 使用 revision 与 byteLength，digestBasis=raw_bytes。不能用 Buffer.byteLength(content) 或重新 hash(content) 冒充原文件字节。`content` 是已解码展示正文，不承诺还原原字节（例如 BOM）；本批不提供 raw binary/blob 存档。

TS 的既有捕获摘要来自解码后 content，保持算法不变：TS capture 读取返回 digestBasis=decoded_utf8，sizeBytes 沿其已存条目。scope 的 digestBasis 同时说明比较/sizeBytes 所采用的内容表示。**不在本批顺手变更 R2b/TS 摘要**。测试专用 WorkspaceReadAccess fixture 须补真实/合成正文的 byteLength；旧消费者只取 content/revision 不受影响。

`WorkspaceToolsHandle.tools` 改为 WorkspaceToolsPort。`RuntimeSourceCaptureAccess.port` 因新模型动作消费 read/compare，也改为 WorkspaceToolsPort；实际 Host 返回的同一个 `.tools` 自然满足。仅机械更新明确的测试 capability stub，不能通过断言强转隐藏缺方法。

## 4. 内部数据和文件骨架

| 文件 | 本批精确职责 |
|---|---|
| ports.ts | 上述类型与SourceCoverage.scope；保留旧 source hit/location 类型和现有validateSourceQuery，新增操作校验放具体实现，不为本批搬已有小函数 |
| access.ts | 暴露已存在的 byteLength；保持 root/authorize/Kernel 边界，必要时补返回后的 abort 检查 |
| **text-source-snapshot.ts（新）** | 许可完整 inventory→同范围严格文本→冻结 Map/原字节摘要/总量计费；无 analyzer、无查询缓存 |
| capture.ts | 将条目改为 TS/text 判别体，复用统一创建/最终核验/保存/失效；增加 read/compare 入口与一对 ref 的单次授权保护 |
| **workspace-read.ts（新）** | working_tree/capture 的具体文件结果映射；纯冻结清单比较/唯一相同内容配对；不持有第二 registry |
| source-query.ts | paths/text 的一次完整有界结果计算；沿原缓存/游标切页；保留五种 TS 语义分支 |
| workspace-tools.ts | 同 registry 组装八方法；新增方法必须纳入相同 track/close |
| execution/worker-runtime/project-source-tool.ts | 小型 additive wire 扩展和严限输出；不保存正文/游标副本 |
| data/context-compiler/runtime-context.ts | 仅 port 类型从窄 capture 面升级为已实现完整面 |
| tests/contracts/module-ownership.test.ts | 仅登记两个真实新增 core 文件；不扩依赖规则 |

不要创建 provider 注册中心/通用插件框架。CaptureEntry 共用的身份、冻结清单、queries、cursors、容量字段维持一份；provider 的差异只是：

```ts
type CaptureAnalysis =
  | { provider: 'typescript'; analyzer: TypeScriptSourceAnalyzer }
  | { provider: 'text'; analyzer: null };
// CaptureEntry = 既有共同元数据 + scope + 冻结正文 Map + CaptureAnalysis。
// text 文件额外携带原 byteLength；TS 的既有 ProjectSourceSnapshot 不改摘要。
```

`verify` 必须按 entry.provider 调对应一次 capture 算法；text verify 不实例化 TS。collect 仅 dispose 存在的 TS analyzer；text 只释放 registry 所有引用。architectureSource 对 text 明确 unsupported，不能以 relations=[] 产出“完整架构图”。

本批内部窄函数（只在 core 内使用第二个 signal，不改变公开 ctx.signal 唯一性）：

```ts
captureTextSource(access: WorkspaceReadAccess,
  input: { prefix: string | null }, signal: AbortSignal,
  limits: Pick<WorkspaceCaptureLimits, 'maxFileBytes' | 'maxCaptureBytes' | 'maxInventoryFiles'>):
  Promise<TextSourceSnapshot>;
readWorkingTreeFile(access: WorkspaceReadAccess,
  input: Pick<ReadWorkspaceRequest, 'path' | 'maxBytes'>,
  signal: AbortSignal, now: () => string): Promise<WorkspaceResult<WorkspaceFile>>;
readCapturedFile(entry: CaptureEntry,
  input: Pick<ReadWorkspaceRequest, 'path' | 'maxBytes'>,
  now: () => string): WorkspaceResult<WorkspaceFile>;
compareCapturedFiles(before: CaptureEntry, after: CaptureEntry,
  limits: Pick<WorkspaceCaptureLimits, 'maxQueryResults'>): WorkspaceResult<WorkspaceComparison>;
```

TextSourceSnapshot 为具名内部结构：`files:ReadonlyMap<string,{path,content,digest,byteLength}>`、`identity:{workspace,commit}`、`snapshot:string`、`scope:Extract<CaptureContentScope,{kind:'text_files'}>`。键统一规范相对路径；若为兼容既有 TS `/workspace/` key 保留，须通过单一 path→key helper处理，不能在多个入口猜前缀。

## 5. 核心行为与约束

### 5.1 working_tree 精确读取

校验完整 workspace、规范 path、maxBytes 安全正整数且不高于 limits.maxFileBytes；fresh access 后核对 allowsRead(path)，调用 **一次** access.read(path,maxBytes)，返回后检查 signal，finally.release。不得调用 inventory、sourceIdentity/Git HEAD、captureProjectSource 或 TS analyzer。

`WorkspaceFile.version=working_tree`，readAt 表示本次观测时点；不宣称未来仍当前。Kernel typed error 映射：not_found/parent_missing→not_found；invalid_path→invalid；permission_denied→forbidden；too_large→capacity；binary_file/invalid_encoding/not_file→unsupported；file_changed→source_stale；其他 I/O→unavailable。保留明确 reason，不靠中文字符串猜码。目录预览不在新 File DTO 中，旧 GUI 行为因此不迁。

### 5.2 严格 text capture

- configPath 不适用，若给出返回 invalid；changedPaths 仅提示，仍不能替代完整核验。
- prefix 是 text 的**实际内容选择范围**：路径本身或 `prefix + '/'` 后代；未提供即所有许可普通文件。TS 原 prefix 仍是查询/配置提示，不改变其完整项目输入集合；这一区别由 coverage.scope 明写。
- 复用 Sandbox 完整 inventory，排序、去重后按授权和 prefix 选择，再读严格 UTF-8 无 NUL 正文。当前 access.listFiles 只有根级枚举，prefix 能减少正文读取但不能保证免根级枚举；超 inventory 容量仍拒绝，不虚称已实现任意子目录独立快照。
- 不偷偷忽略 PNG、编码错误或大文件：选中范围出现非文本→unsupported，超单文件/总量→capacity，读取中消失/变化→source_stale 或明确失败；不发布半份 capture。调用者选择更小文本 prefix。若后续要混合仓库自动跳过 binary，需另定 exclusions/coverage，而非本批暗改完整性。
- 两次捕获采用同范围与新授权；必须比较范围、完整清单、原字节 digest、root、主体/权限、Workspace revision 与 source identity。当前算法不是 OS 原子快照。
- 文本 engine=`workspace-text`、engineVersion=`1`、indexVersion=`workspace-text@1`；projectConfiguration=null、relations=[]、diagnostics=[]、unresolved=[]、sourceCount=文件数、indexedSourceCount=0、complete=true、fullRuntimeCallGraph=false。没有语义分析。
- sourceDigest 使用规范 JSON 的 `{engine,scope,identity,sorted path/digest/byteLength}`；configDigest 使用 `{provider,indexVersion,scope}`。不得伪用 TS version，也不把权限作为模型可提交字段。
- previous 除原完整 ref/授权/根检查，还要求相同 scope/provider/indexVersion；不比较 configDigest 内的“实际配置内容相等”作为通用可比条件，因为文件变化本来就是比较对象。

### 5.3 冻结读取与 paths/text 查询

`readWorkspace(capture)` 检查 input.workspace 等于 ref 全 scope，复用 withEntry fresh 授权/TTL/reader pin；明确路径仍须 allowsRead。只从存储 Map 取正文，不触发 inventory/read/sourceIdentity/analyzer。已捕获匹配范围内缺文件→not_found（reason 明示该捕获中无此文件）；超出已声明域→unsupported，不声称工作树文件不存在。原文件之后修改/删除不影响仍授权的旧正文；撤权、过期、释放、关闭均拒绝。

paths 返回 `SourceHit.kind='file'`，只表示本 capture 的 files；TS 不凭此列出 README。排序使用稳定规范路径顺序，不用环境 locale 排序。路径前缀按边界匹配，不以 `startsWith('src')` 匹配 src-old。

text 请求必须 text 非空、≤512 Unicode 码点且≤2048 UTF-8字节、无 CR/LF，caseSensitive 为 boolean。第一版按行字面匹配、非重叠命中；非任意 regex。可用转义后的 literal RegExp `/gu` 或 `/giu`：Unicode simple case folding，不依赖 locale；match.index/match[0].length来自**原行**，不能 lowerCase 后把扩展字符索引直接当原坐标。CRLF 的末尾 CR 不计入行内容。

每个命中给原文件 digest、一基行号/UTF-16列、end 为排他位置；excerpt 取**完整命中文本**，不截断也不伪造行上下文。后续如需前后文再显式扩字段，不在本批返回无起点标志的截断行。

结果累计到 maxQueryResults 即提前检查，超过则 capacity，不无限扫描收集后丢尾部。query缓存、字节计费、cursor仍沿现机制；第一次查询完成后每页只slice，重放cursor不消费。text provider 对五类语义查询返回 unsupported，不以零条成功掩盖无解析器。

### 5.4 两份 capture 的内容比较

新增 registry 内部 `withPair(ctx,beforeRef,afterRef,signal,work)`：先校验完整两个ref、scope一致、材料存在/未释放；固定两个entry的reader计数（同一ref去重），**单次**fresh access匹配两者的主体/权限版本/根，再调用纯比较；finally释放access与reader。不要用嵌套withEntry形成两次相同ledger授权，不增加第二缓存。

只有相同 provider/indexVersion、CaptureContentScope、root和授权域才可比；不同workspace→forbidden，缺失→capture_expired，不同范围/provider→unsupported。Workspace.revision、HEAD、正文或TS配置内容可以不同，正是比较对象；两份均为已捕获材料，不在此暗扫磁盘“校正”。

按 path 有序归并得到 added/deleted/modified。可把相同 digest 且原、新**全部清单中分别只出现一次**的删除+新增配成 renamed/evidence=identical_content；其余同内容多路径保留 add/delete。证据只表示内容相同，不证明业务身份连续。现有路径内容互换是两个 modified，不猜重命名历史。

结果完整且有上限：changes数不超过 maxQueryResults；本批内部 `MAX_COMPARISON_BYTES=8*1024*1024`，按每条序列化字节增量累计，超出返回capacity，不部分返回complete=true。结果不进永久/共享缓存。这里只比较scope内内容，不检测mode/link/Git rename，不替代验证来源证明。

## 6. 最小模型消费者与兼容

现有project_source schema additive扩展：

```ts
// capture 的 provider 可选，默认仍 typescript；其余旧字段保持。
{ action:'capture'; provider?:'typescript'|'text';
  configPath?:string; prefix?:string; previous?:SourceCaptureRef }
{ action:'query'; capture:SourceCaptureRef; query:SourceQuery;
  cursor:string|null; limit:number }
{ action:'read'; path:string; maxBytes:number;
  version:{kind:'working_tree'}|{kind:'capture';capture:SourceCaptureRef} }
{ action:'compare'; before:SourceCaptureRef; after:SourceCaptureRef }
// verify/release 完全不变。模型不提供 workspace/root/principal/任意git表达式。
```

本批 read 模型上限取8192 bytes，完整读取而非截断，避免最坏JSON转义突破60KiB；大文件沿既有read/read_source范围工具，不暗改其wire。Core自身仍允许可信maxFileBytes。compare输出仍受既有60KiB模型界限，超限明确让调用者选较小text范围重新比较，不裁剪changes冒充完整。Core的完整比较响应不因此改变。

read动作对path继续requireVisible，compare无路径覆盖权限，仅传绑定ctx；底层pair重核整份材料。Reviewer后置assertCurrent、Query最终baseline全部保持；工具只是材料操作，不宣布验收。close仍由ObservedModel唯一持有，read/compare不可另建owned handle或使取消越过同组生命周期。

旧project_index/python_index/cpp_index/read/search/list_files/source_excerpt与GUIpreview保持原入口。不要在本批同时重写这些功能；只有新frozen消费者新增能力。显式legacy_live不注册project_source，旧TS四动作请求不变。

## 7. 删除点与验收

应替换/删除：captureOp中的“仅typescript”总拒绝（改明确provider分支）；source-query对paths/text的无条件unsupported；CaptureEntry的无条件TS analyzer/collect.dispose；独立私有diff的重复路径集合算法（由共同内容差异helper生成summary与comparison，两者格式仍各自保持）。不保留新老两个text cache、完整正文Map或字面查询分页器。

绝不删除：TS captureProjectSource与TypeScriptSourceAnalyzer、R2c两次来源核验、bytes/slots/cursors/TTL/撤权、R2d runtime/Query/Reviewer守卫、旧live兼容、VerificationWorkspaceReader的mode/link-aware证明。

主Agent在派发前独立冻结以下有意义场景：

1. working_tree 已知文本文件：实际Kernel Sandbox读一次，0 inventory/HEAD/AST，普通读取不创建Run；binary/目录/链接/越界/超限/取消如实失败。
2. text capture保留README/未知扩展名/UTF-8及BOM原摘要大小；binary/编码/容量/截断整份拒绝；前后变更不发布句柄。
3. 冻结read在磁盘改删后仍返回原正文；fresh授权/撤权/跨scope/释放/关闭仍生效，无新源读取。
4. paths/text至少三页，查询期间0磁盘/AST；Unicode代理对、İ/非ASCII case folding、CRLF、prefix边界、空/超长needle、重放cursor及cache容量。
5. 同scope比较增改删、唯一同内容与歧义重命名；TS vs text/不同text prefix拒绝；不把BOM或config变化误当权限变化；pair关闭/释放并发不读被回收材料。
6. 真实已受理Work或Query→Kernel本地ModelClient：read working_tree→text capture→paths/text分页→旧capture read→同范围compare→release；实际workspace/actor来自原R2d factory，不从模型补造。
7. 旧R2c/R2d TS wire、架构完整映射、旧Python/Cpp/摘录/Reviewer/Query相关回归与types/边界/appbuild。新测试范围限定，不全仓、不外部模型。

## 8. 明确留待后批

- Git bound I/O、历史blob/tree、mode/link/gitlink、两个commit或mixed比较：需要真实窄Git访问面与范围规则，不能从workspaceIdentity猜root。暂git分支unsupported。
- GUI/human/system的新Host读取授予、preview完整binary/directory/too_large旧wire迁移：需要对应真实入口绑定；本批不放开kind权限。
- Python/C++ file/point/range位置联合、helper/引擎缺失分类、配置变体与coverage迁移：继续旧真实工具，不“顺便”强塞现有TS位置结构。
- 混合文本/二进制成功捕获、完整排除清单、持久未提交源码快照、全文服务、自动安装解析器：均不是本小批交付。

本批完成只能写“严格text及已捕获内容读取/比较已接通；Git/统一PythonCpp/GUI普通Host读未迁”。不能据此宣称整个WorkspaceTools目标全部完成。


执行纪律：dsh仅实现本任务列出的生产文件；两份新core文件登记实际归属。主Agent冻结的新测试不得改；现有access/SourceCoverage/RuntimeSourceCaptureAccess测试夹具若需机械新增字段或方法，先列具体文件交主Agent修改，不放宽断言。Node24/已装依赖，相关检查不全仓、不外部模型、不安装、不自动提交。User WIP和前批实现保留，不reset/restore/clean/stash。


主Agent冻结测试补充：pair并发release之后已pin读仍完整结束，新读拒绝；close取消在途pair并等待真实access.release完成。旧3份测试仅补byteLength/full Port及替换已合法wire的invalid样本，新增8193字节model读取拒绝；拒绝前0core访问断言保留。dsh不能修改这些测试。
