# R2d.1：冻结源码工具协议与工具资源归属

状态：2026-09-23 本子批已独立验收：23项新行为测试及相关回归合计14文件/102项通过，类型、模块边界和应用构建通过。整体约束见 [R2d](R2d-model-source-tools.md)。这是可独立验收的第一步，不代表正式 Work/Reviewer/Query 已迁移；后续 R2d.2/3 必须切换其 Host 工厂。

代码根 C=`/home/hyh001/projects/coding-platform/coding-platform`，设计根 N=`/home/hyh001/projects/coding-platform/docs/refactor`。主 Agent 管架构和独立测试，dsh 只实现本批生产代码，保持用户与前批修改。

补充审查（R2d.2派发后）：真实Kernel的模型失败会resolve为`state.status=failed`，不一定throw。现有finally仅靠catch标记主失败，会在同时close失败时丢掉原失败结果。主Agent已新增第24项组合测试并独立复现。需保留原非completed结果、仍尝试全部close；只有原completed且cleanup失败才抛清理错误。不改Kernel结果结构或新造事件。该窄修复已在R2d.2同一串行写批完成，主Agent24项独立复测通过，并包含在最终6文件/50项通过中；上面102项通过仍是补测前的限定证据。

## 1. 精确范围和文件

- `data/context-compiler/runtime-context.ts`：只增加下面的临时运行能力类型；不改上下文编译、材料授权或正文持久格式。它与既有 RuntimeContextAccess 相邻，沿当前 ContextCompiler→WorkspaceTools 依赖；R5 消费者迁移时一并移至目标 Runtime 端口，不新设模块。
- `execution/worker-runtime/project-source-tool.ts`：新增新工具 schema、模型 wire 转换与窄绑定调用；不得自行维护 capture/cursor/AST/授权缓存。
- `execution/worker-runtime/exploration-tools.ts`：返回有明确 close 的工具组，按可信模式只构造一种 TS 项目工具；旧其他工具行为保持。
- `execution/worker-runtime/observed-model-run.ts`：新增可信模式与工厂选项，精确 enabledNames，拥有并关闭该次实际模型循环资源。
- `tests/contracts/module-ownership.test.ts`：仅增加真实文件清单。既有直接工具 fixture 迁 `.tools` 和 `close`；不放宽 wire/状态断言。

不接生产 Run/Query 的来源身份、不改 Host 授权桥、不改 Kernel/Session/UI/WorkGraph/依赖或磁盘格式。不是再做一个独立源码索引。

## 2. 窄能力及模式

```ts
export type RuntimeSourceCaptureAccess = {
  port: WorkspaceCapturePort;
  workspace: WorkspaceRef;
  context(signal: AbortSignal): CoreCallContext;
  currentWorkspaceRevision(signal: AbortSignal): Promise<WorkspaceResult<number>>;
  close(): Promise<void>;
};
export type RuntimeSourceCaptureFactory =
  (runSignal: AbortSignal) => Promise<RuntimeSourceCaptureAccess>;
```

这些是可信 Host 能力，不进模型 schema/ContextBundle/日志。`currentWorkspaceRevision` 只在 capture 时读取真实 Workspace 登记；工具输入不提供 revision/root/principal/role。工厂绑定真正身份和授权的工作留 R2d.2/3，本批独立测试提供明确的可信授权夹具，不冒充生产已接。

`ObservedModelRunOptions` 新增：

```ts
projectSource?:
  | { mode: 'legacy_live' }
  | { mode: 'frozen'; open: RuntimeSourceCaptureFactory };
```

未指定是原调用方兼容语义，仍是 legacy_live；这不是 frozen 初始化失败时的回退。显式 frozen 必须有工厂，失败原样结束运行，不注册旧工具。后续生产装配显式设置 frozen，本页不会宣称缺新工厂也已迁移。

`SourceToolOptions` 的对应可信装配字段是：

```ts
projectSource?:
  | { mode: 'legacy_live' }
  | { mode: 'frozen'; access: RuntimeSourceCaptureAccess };
```

保留已有 sourceIdentity、allowedPath、assertCurrent、includeReadSource。frozen 不构造旧 ProjectSourceIndex，legacy 不注册 project_source。Python/Cpp/精确摘录/单文件索引照旧。

`createExplorationTools` 返回：

```ts
export type ExplorationToolsHandle = {
  tools: ToolDefinition[];
  close(): Promise<void>;
};
```

close 拒绝新handler，组合本工具组生命周期与当次signal，等待在途工具结束后关闭本组持有的旧 ProjectSourceIndex/PythonSourceIndex并清空轻量缓存；不要给无dispose的Cpp类虚构接口。SourceCaptureAccess由ObservedModel外层唯一关闭，工具组不能关闭它。单工具取消不能关闭整组。直接fixture明确关闭其自己创建的能力。

## 3. 新 project_source wire

使用 Kernel 已导出的 toolSchema，effectClass=read_only、workspace_read、60秒、64KiB输出上限，保留现有<=60KiB有效JSON输出检查。四分支均strict，未知字段拒绝：

```ts
type ProjectSourceToolInput =
  | { action: 'capture'; configPath?: string; prefix?: string; previous?: SourceCaptureRef }
  | { action: 'query'; capture: SourceCaptureRef; query: SourceQuerySupported;
      cursor: string | null; limit: number }
  | { action: 'verify'; capture: SourceCaptureRef }
  | { action: 'release'; capture: SourceCaptureRef };
```

SourceQuerySupported 仅 symbols/definitions/references/imports/calls，沿R2c精确字段，不发布paths/text空能力。limit=1..200，默认100；cursor显式null或非空token。ref字段完整验证，digest十六进制与版本/标识为合理有界字符串；坐标正整数、一基UTF-16；路径沿现有规范化相对路径约束（也拒绝`.`段）。旧offset/expectedSnapshot和身份覆盖字段不被接受。

- capture：绑定workspace、先currentWorkspaceRevision，再调用port.captureSourceChanges(provider=typescript)。显式previous仍由核心完整重核。
- query/verify/release：传完整ref给核心，同时绑定ctx来自本次执行signal；任何输入scope都不能替代本组绑定scope。核心仍每请求fresh authorize。
- 输出保存对应WorkspaceResult的ready/rejected分支与错误类别，保留完整ref、时点、captured_source/not_rechecked、complete/cursor。模型端只对元数据作以下显式有界映射，不翻译成旧ProjectSourcePage，也不改变核心端口：

```ts
type MetadataSample = { count: number; sample: string[]; truncated: boolean };
type ModelSourceCoverage = Omit<SourceCoverage, 'unresolved'> & { unresolved: MetadataSample };
type ModelCaptureSummary = Omit<CaptureSummary, 'coverage' | 'changes'> & {
  coverage: ModelSourceCoverage;
  changes: { added: MetadataSample; modified: MetadataSample; deleted: MetadataSample };
};
type ModelSourcePage = Omit<SourcePage, 'coverage'> & { coverage: ModelSourceCoverage };
```

每个MetadataSample保留精确总数，最多5个样本，每项最多160个Unicode码点；数量或单项被截取时truncated=true。sample只是预览，不充当可执行路径或完整证据。CaptureSummary/SourcePage的核心类型与内部全量数据不变；这几行wire转换属于工具层，不新建第二份数据索引。大仓不能因完整changes或unresolved数组撑爆模型摘要而完全无法使用capture。模型wire本批不提供全量变化清单分页；原始完整清单仍可由受信内部端口读取。
- 说明清楚：capture一次→原ref和同query续cursor→需要当前性时verify→stale重新capture→用完release。verify说明核验时点，不保证未来；capture不是验收通过。
- 即使元数据已经有界，capture成功但最终输出仍超限或后置assertCurrent失败，必须best-effort release尚未交付给模型的capture。cleanup使用相同身份/范围及独立清理signal，仍授权；失败最终由owned handle close回收。不能全局取消其他工具。
- 页输出过大保持原cursor可用，可较小limit重试；不得部分裁剪items却继续返回原complete/nextCursor。
- 既有allowedPath/assertCurrent守卫不绕开；query的嵌套path/prefix也核对。R2d.2还要在底层policy落实Reviewer间接依赖范围，外层path检查不代替它。

## 4. ObservedModel 的唯一资源所有者

读权限缺席时不打开source工厂，也不注册任何源码工具。只注册当前模式的TS项目工具，enabledNames与实际tools完全一致。

本函数需要`return await kernel.runCodingAgent(...)`，其await和工厂/config/provider/工具构造均被统一try/finally覆盖。先登记创建成功的ExplorationToolsHandle，再执行可能抛错的material/coordination工厂；Kernel并不替平台关闭扩展工具。运行replay/进入前拒绝的上层路径不因此提前创建registry。

finally尽力清理所有工具组与独占source能力并等待完成；一个close失败不能阻止其他close，不覆盖原运行错误。仅清理失败也不得返回业务成功，应给可诊断的失败。close幂等。正常、模型失败、初始化失败、超时、取消、Host调用runtime.close后的结束走同一路；没有脱离runtime等待的后台资源。

本批不删除Reviewer前后当前性守卫、模型准入、预算、JSON回应格式、协调工具授权或事件reasoning过滤，不给性能测试制造更宽权限。

## 5. 独立验收和退出

主Agent独立测试冻结后派发，dsh可运行不可改：

1. 真实工具调用capture→401关系三页→verify→release；冻结核心两次初始源码观察/一次imports，分页不再读/分析，verify单独计数。
2. 严格schema、来源改变仍能读旧页/verify stale、错误ref/scope/cursor拒绝；大元数据给精确count和显式样本truncated；其他输出超限/后置守卫失败不泄漏未交付capture。
3. 同调用旧legacy wire仍保持原expectedSnapshot/offset语义与旧回归；frozen工具清单无project_index、不构造其service。
4. 工具组close/运行finally资源测试：正常、模型抛错、工具注册后其他工厂抛错、初始化失败；清理其中一项失败仍关闭其余，原异常不被覆盖；无read不创建source。
5. 既有SourceToolOptions Reviewer守卫、JSON格式/modelCalls、Python/Cpp/摘录工具回归。当前Host生产尚未迁移要明确记录，不能把fixture成功当四类生产成功。

验证：新增独立测试、涉及的旧app/runtime工具测试、typecheck、模块边界、app构建。仅更新真实新增文件归属，不扩大允许依赖/忽略测试。无全仓/真实外部模型测试、无自动提交。只有本子批验收通过后才派发R2d.2。
