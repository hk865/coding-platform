# B2 Kernel 历史配对校验公开导出：骨架与测试

日期：2026-09-26。状态：**主审选定最小公开导出方向；第一阶段骨架/测试，未实现。** T=/home/hyh001/projects/coding-platform/coding-platform/next；W=/home/hyh001/projects/coding-platform。本切片不改变 Kernel 校验算法，只为平台提供已有纯函数的正式公共入口。第一阶段交付后停止，主审中审通过才进入第二阶段。

## 1. 依据、复用与边界

阅读 W/docs/AGENTS.md、refactor/IMPLEMENTED-CAPABILITIES.md 的 RT1/RT3/RT7/RT8、modules/core/work-graph.md §6.3、B2-runtime-skeleton.md、B2-execution-state-skeleton.md，以及 T/vendor/coding-agent/patches/README.md、scripts/build-kernel-patch.mjs。

真实既有实现是冻结 `dist/core/ports/session_store/session-history.js` 的 `assertTranscriptExchangeIntegrity`，类型见相邻 `.d.ts`。它校验每个 ToolCall 的唯一结果、孤儿结果、重复结算、跨消息未结算调用及跨批重复 callId。平台已经可以从 public-api 使用 createInitialRunState/reduceRunState/deriveRunPhase；缺的是这一既有完整性判据的公共导出，不是缺少归约算法。

当前 public-api 没有导出它；不得让平台 import Kernel 私有路径，不得复制 validator 或 reducer，不新增 Context/SessionHistory 管理器，不暴露新的扫描或恢复操作。Kernel 原工程源码和 dist 的所有算法文件只读。

**能力边界：** 工具交换配对完整不证明实际副作用已知。携带 `error.code='outcome_unknown'` 的合成 ToolResult 仍可能完成合法配对；本 validator 按原语义允许这种配对。平台观察还必须另行拒绝未知副作用/未决执行作为安全释放依据，并核真实事件身份、序号、位置和终态。不能给 validator 增加平台释放策略，也不能宣称本次导出已完成 B2 生命周期。

## 2. 受管源码来源与施工 scope

新受管源为 `T/vendor/coding-agent/patches/public-api.ts`，初始内容必须精确提取自当前冻结 `T/vendor/coding-agent/dist/public-api.js.map` 的 `sourcesContent[0]`。本次只读核对结果：

- map.sources：`["../src/public-api.ts"]`；sourcesContent 数量为 1。
- 提取源 UTF-8 SHA-256：`6fa6a3a57a9716054a97e3616d1d05a5876977d963acddffdc9ee0a196c470a6`。
- 保留源原本全部运行时导出、type 导出、版本常量与注释；仅增加本批明确入口。

DSH lane 精确写范围只有：

1. `vendor/coding-agent/patches/public-api.ts`（新增受管源；主审若已提取则从该完整源续作）。
2. `tests/kernel/B2-history-public-export.test.ts`（新增公开行为测试）。

不得修改 `patches/storage/adapters/sqlite/sqlite-stores.ts`、任何 Kernel 私有算法文件、原工程源码、既有测试、dist 产物、构建脚本或 README。脚本与补丁说明由主 Agent 独占维护。禁止 rename 替换文件级 bind、安装依赖、提交、联网模型或自行扩大 scope。

## 3. 第一阶段：明确 unsupported 骨架

第一阶段在完整提取源末尾增加同名、同参数/返回类型的显式 unsupported stub，**不能立即 re-export 真函数**，不能写配对实现。准确签名沿原 owner 类型确定，示意：

```ts
import type { TranscriptEntry } from './core/runtime/state/run-state.js';

/** B2 public seam; implementation follows independent middle review. */
export function assertTranscriptExchangeIntegrity(
  _transcript: readonly TranscriptEntry[],
  _label: string,
): void {
  throw new Error('unsupported: B2 transcript integrity public export is not implemented');
}
```

该 import 属于 Kernel 自己的公开入口源码，允许引用其原 owner 类型；平台/测试仍必须只从 dist/public-api.js 导入，不新增平台私有路径依赖。不要额外导出 TranscriptEntry；调用方可用公开 `RunState['transcript']` 表达测试数据类型。

主 Agent 扩展现有 build-kernel-patch.mjs，使其编译两个受管源；由主 Agent 生成第一阶段 dist 四件套，再运行骨架测试。DSH 不通过手改 .d.ts 使测试编译，不在缺导出时改成 any/跳过测试。若 lane 当前只读 dist 尚未刷新，报告精确前置缺口；主审发布 stub 产物后应正常编译，新增正例因 unsupported 红，而不是因 missing export 或类型失败红。

## 4. 第一阶段测试要求

新增一个 tests/kernel/B2-history-public-export.test.ts，只通过 `../../vendor/coding-agent/dist/public-api.js` 导入函数与所需公开类型/StoreError。使用小型纯 transcript fixture，无数据库、模型、Session 扫描或平台 mock；不要重复整个 Kernel 历史测试矩阵。

建议集中以下场景，可 parameterize 真正并列反例：

1. **正常配对及无工具文本合法：** 单个 user/assistant 文本、带两个 ToolCall 且各有一个匹配 ToolResult 的完整 transcript 均不抛。输出只验证校验成功与输入未修改，不要求生成新状态。此正例在第一阶段明确因 unsupported 失败。
2. **重复与孤儿拒绝：** 同一结果重复结算、无先行 ToolCall 的 ToolResult、跨 assistant 批次复用旧 callId 分别抛原 owner 的 StoreError，code 为 corrupt。错误携带测试 label，避免仅 `toThrow()` 导致 unsupported stub 被错误当作正确实现。
3. **遗漏与顺序拒绝：** ToolCall 缺结果、未闭合前出现下一 assistant 或 user message，均要求 StoreError/corrupt 和有区分度的原原因，不能接受任意异常。原函数不是全面输入 schema validator，fixture 本身应符合公开类型。
4. **未知副作用不等于配对失败：** 合法 ToolCall 配对一个类型正确的 outcome_unknown 合成 error ToolResult；该 validator 应不抛。此测试明确证明其能力仅限 transcript 配对。平台 B2-runtime-execution 测试另外覆盖“这种事实不能释放 Session/Lease”，本测试不得代替该验收，也不实现平台判据。
5. **旧公开面保留：** 在增加新导出前从冻结公共入口读取并由主审核定全部 runtime export 名列表，作为该测试内固定 baseline；发布后必须保留全部旧名字，只新增 assertTranscriptExchangeIntegrity。关键已用导出 runCodingAgent/resumeCodingAgent/SqliteStores/createInitialRunState/reduceRunState/kernelSessionApiVersion 仍存在且版本不降低。type export 的保持通过提取源最小 diff 和编译核对，不用运行时枚举假装已检查 erased types。

所有行为测试断言针对既有 validator 的真实规则，不能为了骨架全绿而期待 unsupported、skip/todo、放宽为任意错误或直接 import 私有真函数。第一阶段只允许公开面保留类断言通过；新行为应红且报告原因清楚。

## 5. 第二阶段：仅替换为原 owner 的纯 re-export

主审中审通过后，在唯一受管源删除 stub 及仅为 stub 引入的 type import，增加：

```ts
export { assertTranscriptExchangeIntegrity } from './core/ports/session_store/session-history.js';
```

这是完整生产变更；不得包装返回值、改异常语义、复制算法或调整原 history/reducer。不重导出 restoreSessionHistory/readAllSessionRecords/private projection，不扩大新的公共能力。保留所有原符号和 kernelSessionApiVersion；此纯能力导出不谎报已经新增恢复协议版本。

主 Agent 生成并审核 dist；测试应从公开入口获得真实原函数行为。纯 re-export 的源码审阅与生成 JS 检查证明入口委托，行为测试证明公开调用保留规则；无需测试导入私有模块比较对象身份。

## 6. 主 Agent 构建扩展与验收责任

此节是主 Agent 的集成约束，不给 DSH lane 额外写权限。

- 扩展现有 scripts/build-kernel-patch.mjs 的受管源列表为 SQLite 原补丁与 public-api.ts；沿原已安装 TypeScript/Zod/Node 类型临时编译流程，不新增 runner 或依赖。
- 编译每个受管源仅产生自身 `.js/.js.map/.d.ts/.d.ts.map`。两份 map 均嵌回该源 sourcesContent，继续紧凑 ASCII 转义序列化；public-api map 路径深度与 sqlite 源不同，不能复用旧写死 `../../../../src/` 的检查。
- 初始完整提取源先验证原 public-api 四份产物可再现；stage1/stage2 生成的变化均来自受管源。不要直接拼接 dist 文本。
- SQLite 原受管源及原四份产物应逐字不变；此次不能顺便重做 SQLite 优化。旧 public-api 全部导出及相邻依赖文件保持。
- 主审发布前执行明确 `--write`；默认/`--check` 只验证不修改。发布后 `--check` 对两个源八份产物全部通过。
- 源/产物哈希及命令写本批 evidence；更新 patches/README 与 vendor README 的当前补丁入口，历史 kernel-packaged-hashes.json 不覆盖。
- 运行本新增公开测试、既有 R4a frozen public 与 R4c kernel history range 适当回归，并在 B2 主批完整隔离验收中覆盖真实 Runtime consumer。构建字节一致不是生命周期验收。

专项在 T 目录使用已有 Node/Vitest：`node ../node_modules/vitest/vitest.mjs run tests/kernel/B2-history-public-export.test.ts --maxWorkers=1 --no-cache --configLoader=native`。构建脚本与 next-types 由主审在已生成相应阶段产物后检查；DSH 交付报告明确受管源基线、阶段、生产 diff、公开测试状态和待主审发布项。第一阶段完成后停止等待中审。
