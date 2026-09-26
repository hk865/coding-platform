# R2b：冻结源码材料与 TypeScript 查询实现

状态：2026-09-23 dsh 实施并经两次返修后，主 Agent 独立验收通过，见[验收记录](../reviews/implementation-batches.md)。主 Agent 负责设计和独立测试；dsh 实现代码，不修改验收测试或上位设计。

## 1. 可观察结果与范围

将 `ProjectSourceIndex` 的 live 读取和冻结材料上的 TS 分析分离，让现有 `query()`、`architectureMaterials()` 两条真实调用路径共同使用新实现。一次捕获得到的材料可作多次无 I/O 分析；旧材料不因新捕获、外部文件变化或另一个配置的查询而改变。

本批仍保留旧工具 wire、公开分页和每个独立请求的捕获/核验。跨请求 capture 注册、游标、Host 授权重核由 R2c/d 交付，不将此次抽取宣称为公开分页性能优化。

代码根：`/home/hyh001/projects/coding-platform/coding-platform`。前置：[WorkspaceTools 骨架](../modules/core/workspace.md)、[批次计划](../refactor-plan.md)。源码已经位于 `src/core/workspace/`，不得重新创建旧 workspace-reader 目录。

## 2. 文件与内部接口

### project-source-snapshot.ts

唯一的 live 捕获实现，承接原读取、清单、身份、容量和原摘要算法：

```ts
export type CapturedProjectFile = Readonly<{ path: string; content: string; digest: string }>;
export type ProjectSourceSnapshot = Readonly<{
  files: ReadonlyMap<string, CapturedProjectFile>; // /workspace/<规范相对路径>
  identity: Readonly<{ workspace: string; commit: string | null }>;
  snapshot: string;
}>;
export function captureProjectSource(
  access: ProjectSourceAccess, signal: AbortSignal,
): Promise<ProjectSourceSnapshot>;
```

`ProjectSourceAccess` 在本文件定义、原 `project-source-index.ts` 兼容 re-export，避免新组件反向依赖旧门面。共享 ROOT/path 检查及窄错误类型可放此文件；不要仅为几个常量多造模块。每份捕获拥有独立 Map/记录；分析器不能修改传入材料。只读类型和实现所有权共同约束，不要求额外复制整个项目。

### typescript-source-query.ts

导出 `class TypeScriptSourceAnalyzer`，同步 `analyze(snapshot, query, signal)` 与 `dispose()`。查询仅含原 operation/configPath/prefix/path/line/column，不接 access、Host、磁盘、注册表、分页或 expectedSnapshot。

返回完整 `results/sources/indexedSources/changes/diagnostics/diagnosticsTruncated/coverage`，其中 `coverage.projectConfiguration` 是本次配置；原字段语义不变。结果应定义可读的精确 location/symbol/import/call 类型或联合，不引入 `any` 或不透明的新结果。旧 wire 消费者需要的兼容字段不得破坏。

移动现有 configure、LanguageService 和 AST 查询实现；保留按脚本 digest、配置和根列表复用服务的机制，不为每次查询无条件新建服务。所有 TS Host 读取只访问该次冻结 Map。查询分析为同步阶段，不能 await 后再读取可被其他请求换掉的 service/program/sources。

### project-source-index.ts

保留类与公开类型入口，负责当前权限/参数检查、capture → analyze → capture/verify、原 snapshot/provenance 与响应整形。删除迁出算法的旧副本。

- 操作/分页/明确路径资格在读取前拒绝；expectedSnapshot 不符时保留原早拒绝行为。
- `query()` 对同次完整结果分页，sources 展示仍最多 200 条。
- `architectureMaterials()` 调用同一内部完整分析，返回全部 indexed sources/imports；保留 10000 imports 上限及最终核验。
- 原 `changes` 相对最近安装的输入计算，在 verify 前安装；不悄悄改为“最近成功响应”。
- 参数拒绝、unsupported、stale、cancelled 的原语义保持。取消后不能发布成功。

### 真实图消费者与模块清单

`architecture-source.ts` 继续把同一份完整材料映射为图，来源摘要/排序/字段不变；无需强行新增纯映射文件。`source-workspace-reader.ts` 和模型 `project_index` 通过原类接入新的唯一实现。更新 `tests/contracts/module-ownership.test.ts` 的精确文件清单，只新增实际两个文件；不得放宽检查。

## 3. 不得回退的约束

- 原 ROOT、引擎版本、身份与 sources 摘要、requested config/prefix 的 snapshot 编码顺序保持，已有引用不迁移。
- capture 读取完整允许范围；prefix 只过滤输出，不能切断 prefix 外允许依赖。被撤权文件不得留在服务缓存可读范围。
- 默认/显式 tsconfig/jsconfig、paths/include、未知外部引用、projectReferences unsupported；不执行配置 plugin。
- 2 MiB 单文件、128 MiB 捕获、inventory.truncated、二进制和读取失败拒绝；公开 limit 1–200、offset 非负、diagnostics 30 条及截断标记保持。
- R1 401 imports 场景仍只捕获两次、分析一次，完整来源在 await verify 前固定；配置并发不能串源。
- 暂不改 SourceIndex/Python/C++/用途 readers、Kernel、业务状态、UI、公开 Port、依赖和锁文件；不新增第二份历史/持久库。
- 保留用户已有改动及 R1/R2a；不 reset/restore/clean/stash/commit/push。

## 4. 独立验收与 dsh 约束

主 Agent 提供 `tests/data/project-source-snapshot.test.ts`、`tests/data/typescript-source-query.test.ts`、`tests/data/typescript-source-reuse.test.ts`，覆盖无 I/O 多种查询、S1/S2/S1 隔离、配置与撤权缓存、prefix 外依赖、取消、捕获拒绝和摘要变化。dsh 不修改这三份测试，不删改已有 R1 行为断言；若认为测试与任务冲突，报告具体差异。

必须同时通过原 `project-source-index`、`source-architecture`、真实 `exploration-tools`、路径边界、归属测试，类型与模块边界检查。不为本批重跑全仓或无关 UI/Kernel 模型测试。主 Agent 另外核对实际调用路径、重复实现与兼容 wire。无新增外部依赖。

已安装运行方式：先将工作区 `.toolchain/node-v24.21.0-linux-x64/bin` 加入 PATH；可直接使用 `node node_modules/vitest/vitest.mjs run …`、`node node_modules/typescript/bin/tsc --noEmit`、`node scripts/check-module-boundaries.mjs`，避免 Corepack 临时下载。验收只记录实际执行的结果。
