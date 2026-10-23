# PC-1a 回复（K 组、C 组）

## 1. 疑问

1. 任务书 §4 的冻结表写 `promptSelectionOf(model: BoundModel)`，但 `src/contracts/prompts/` 不能导入
   `src/core/agent-runtime/`（`check-boundaries.mjs:510` 禁止 Contracts→Core）。实际实现用与 `BoundModel`
   完全同形的结构类型，`BoundModel` 可直接赋入；建议任务书改写成结构类型。
2. C 组为保证“从真实 Host 读回解析后的 selection”新增了 `LocalWorkbenchHost.runtime` 访问器；任务书没有点名
   这个出口，属于 UNSPECIFIED，见 §8。
3. K 的实际规模约为估计的 1.85 倍（见 §7），原因主要是 PC-11/12/17 的测试行数；请确认估计是否按旧口径。

## 2. 摘要

完成 K 组（选择策略重写、runner 新输入与 P3/P4、组合根/public-api 新输入）和 C 组（`prompt-set.ts`、
`platform-skills.ts`、平台包源、`BoundModel.selection`、平台 Skill 根迁移、Host 选择接线）。新增 11 个 PC
测试文件，全部通过；K 的 `dist` 已用脚本 `--write` 再生，`--check` 通过。两条提交：`17cf798`（K）、
`afff716`（C）。PC-1b 的冻结接口见 §4。未跑完 `tests/kernel`、`tests/app` 两个目录的全量（见 HANDOFF）。

## 3. 逐裁定、逐行 RED → GREEN

- **裁定 2（K 输入，k3）**：`HostContextInputs`（composition-contracts）挂在 `RunAppInput`/`ResumeAppInput`
  上；提供 base+skills 时不读 Skill 文件、不用固定 `coding-agent-v5`，`onConfiguration` 报
  `"<templateId>@<version>"`、原样 skills、`"provided-by-host"`；同身份恢复同路转发。
  测试 `tests/kernel/PC-inputs-public.test.ts`：(a) provided base and Skills、(b) same-identity resume、
  (c) absence。RED：2 失败（旧 dist 读不存在的 Skill 根），GREEN：3/3。
- **裁定 3（冻结名字，k2/k3）**：`selectContext` 的名字与签名、七个类型按任务书原文导出；runner 的 run 输入
  新增 `previewRequest`/`onContextSelected`/`reasoningReplay`，`baseSystemPrompt` 仍为字符串。
- **PC-11** `PC-11-selection-seven-kinds`（2 项）：七类单元、手算字节前缀、逐步删除与二分同 k。RED→GREEN。
- **PC-12** `PC-12-tool-result-placeholder`（2 项）：占位文本逐字、空/短/error/cancelled 保留、两适配器 call/result
  对齐。
- **PC-13** `PC-13-instruction-skill-protected`（2 项）：超出预算即 `required_content_over_budget`，instruction
  Skill 不在任何删除步。
- **PC-14** `PC-14-task-input-current`（2 项）：历史被删，任务输入与注入输入按 id/text 保留。
- **PC-15（K）** `PC-15-kernel-async-preview`（1 项）：async fixed-count preview 被 await 并驱动选择。
- **PC-16** `PC-16-hook-recheck-preview`（2 项）：950 不 fit → provider 0 次；150 clamp 后发 150。
- **PC-17** `PC-17-thinking-replay`（4 项）：一个 Session 三次 run 的 `current_run`/`none`、公开历史仍保留
  思考、`selectContext` 小输入、两适配器 body。
- **裁定 12** `PC-platform-skills`（2 项）：五行 id/title/priority/templateId 字面量。
- **裁定 13（契约）** `PC-prompt-set-v1`（15 项）、`PC-prompt-pack-source`（2 项）：解码接受/拒绝、内容类型、
  摘要、默认源 `platform`→ready、其它 id→invalid 及原文 reason。
- **裁定 13（Host）** `PC-host-prompt-selection`（4 项）：直接配置 pack/replay 与 `runtime-<sha16>`、设置选择
  重建后恢复、缺省 platform/current_run、平台根同路径且同绑定重导出。

## 4. 冻结接口表（PC-1b 照此编码）

| 路径 | 导出 | 精确签名 |
| --- | --- | --- |
| `vendor/coding-agent/dist/public-api`（源 `patches/.../context-selection-policy.ts`） | `ReasoningReplay` | `'current_run' \| 'none'` |
| 同上 | `BaseSystemPromptInput` | `{ templateId: string; version: number; text: string }` |
| 同上 | `ContextPreviewResult` | `{ outgoing: ModelRequest; inputTokens: number; outputReserve: number; fits: boolean }` |
| 同上 | `ContextPreview` | `(request: ModelRequest) => Promise<ContextPreviewResult>` |
| 同上 | `ContextSelectionRemoved` | `{ memory; skillReference; additionalInstruction; toolResultBody; historyExchange; historyConclusion; currentExchange }`（均 number） |
| 同上 | `ContextSelectionReport` | `{ requestId: string; inputTokens: number; budget: number; removed: ContextSelectionRemoved }` |
| 同上 | `ContextSelectionOptions` | `{ historyEntryCount: number; taskInputMessageId: string \| null; build: (input: ContextBuilderInput) => ModelRequest; previewRequest: ContextPreview; reasoningReplay?: ReasoningReplay }` |
| 同上 | `selectContext` | `(input: Readonly<ContextBuilderInput>, options: ContextSelectionOptions) => Promise<{ selected: ContextBuilderInput; request: ModelRequest; report: ContextSelectionReport }>` |
| 同上 | `RunAppInput`（另 `ResumeAppInput` 同形） | `baseSystemPrompt?: BaseSystemPromptInput; skills?: SkillContext[]; reasoningReplay?: ReasoningReplay; previewRequest?: ContextPreview; onContextSelected?: (report: ContextSelectionReport) => void` |
| 同上 | `RuntimeRunner['run']` 输入 | 另加 `previewRequest?`、`onContextSelected?`、`reasoningReplay?`；`baseSystemPrompt` 仍为 `string` |
| `src/contracts/prompts/prompt-set.ts` | `PromptSetV1` | `{ schemaVersion: 1; modelId; provider; model; packId; reasoningReplay; sectionOrder: Partial<Record<ContextCallKindV1, ContextSectionNameV1[]>>; templates: {id;version;packId;digest;ref}[]; strings: {digest;ref}; base: {templateId;version;digest;ref}; skills: {schemaVersion:1;id;title;kind;priority;source;digest;ref}[] }` |
| 同上 | `decodePromptSetV1` | `(value: unknown) => PromptSetV1 \| null` |
| 同上 | `ModelRequestPromptFactsV1` | `{ systemDigest; toolsDigest; toolSpecsRef: ArtifactRef; maxOutputTokens?: number; selection: { inputTokens; budget; removed } }` |
| 同上 | `QueryRequestPromptFactsV1` | `Omit<ModelRequestPromptFactsV1, 'maxOutputTokens'>` |
| 同上 | `PromptRecordRequestV1` | `{ requestId } & Omit<ModelRequestPromptFactsV1,'maxOutputTokens'> & ({kind:'work';maxOutputTokens} \| {kind:'query';reservedOutput})` |
| 同上 | `PromptRecordReadResultV1` / `PromptRecordReadV1` | `{ set; requests: PromptRecordRequestV1[]; texts: Record<string,string> }` / `ReadResult<...>` |
| 同上 | `promptSelectionOf` | `(model: { configuration: { revision: string }; selection?: {...} }) => { modelId; promptPack; reasoningReplay }`；无 selection 时 `{revision,'platform','current_run'}` |
| 同上 | 两个内容类型 | `PROMPT_TEXT_CONTENT_TYPE='application/vnd.coding-platform.prompt-text;version=1'`；`PROMPT_TOOL_SPECS_CONTENT_TYPE='application/vnd.coding-platform.prompt-tool-specs+json;version=1'` |
| `src/contracts/prompts/platform-skills.ts` | `PLATFORM_SKILLS` | `readonly { id; title; kind:'instruction'; priority; templateId }[]`（五行） |
| `src/contracts/prompts/prompt-pack.ts` | `ResolvedPromptPackV1` | 原字段 + `origins: Readonly<Record<string,{packId;version}>>` |
| 同上 | `PromptPackSourcePort.resolve` | `(packId: string, signal: AbortSignal) => Promise<{status:'ready';value:ResolvedPromptPackV1} \| {status:'rejected';code:'invalid'\|'unavailable';reason:string}>` |
| 同上 | `createPlatformPromptPackSource` | `() => PromptPackSourcePort`（仅 `"platform"`；其它 `invalid`，reason `prompt pack <id> is not available`） |
| `src/core/agent-runtime/source-tool-ports.ts` | `BoundModel.selection?` | `{ modelId: string; promptPack: string; reasoningReplay: 'current_run'\|'none' }` |
| `src/core/agent-runtime/platform-skill-root.ts` | `PLATFORM_SKILL_RESOURCE_ROOT` | `resolve(import.meta.dirname, '../../../resources/skills')`，值与旧导出一致；`runtime-configuration.ts` 同名重导出 |
| `src/app/runtime-configuration.ts` | `WorkbenchModelConfiguration` | 可选 `modelId`、`promptPack`、`reasoningReplay`；`runtimeModelId(provider, model, options)` 共享 id |
| `src/app/host.ts` | `settingsModelBinding` / 目录投影 | `selection` 恒填；设置模型 `modelId = item.id`；直接配置保留 pack/replay |

## 5. 测试

- 新 Kernel 8 文件：8 files / 18 tests 全过。
- 新 C + 既有 pack：4 files，加 Host 1 文件与 `tests/architecture` 全目录：9 files / 78 tests 全过。
- 未跑：`tests/kernel`、`tests/app` 两个目录的其余文件（见 HANDOFF）。无环境失败（未出现 bwrap/ENOENT 沙箱错误）。

## 6. 检查

`node scripts/build-kernel-patch.mjs --check`：0，16 源/64 产物全 matches；`node scripts/build-platform-prompts.mjs --check`：0；
`flock … npm run typecheck`：0（0 错误）；`npm run check:architecture`：OK；`flock … npm run build`：0。
`git diff --name-only pc1a-base HEAD | grep -vE -f whitelist`：无输出（exit 1）；`git status --porcelain`：空。

## 7. 行数与白名单

- **K**：+2,003 / −34（`patches/` 与 `tests/kernel`；不含 `dist`）。其中策略文件 490 行（原 225 行整段重写）、
  runner +38、测试 1,338 行。为估计 1,100 的 1.85 倍，原因：测试覆盖七类单元/逐步参照/适配器，且旧策略需整段替换。
- **C**：+901 / −16（不含生成模块 `platform-pack.generated.ts`，其 +102 不计）。
- 白名单新增：无（C 只改了已有条目文件本身，`production-reach-allowlist.json` +13 条 kept-for，均为
  `PC-1b, slice 6 of the orchestration design: <consumer>`，未删任何旧条）。
- 夹具 `tests/helpers/PC-kernel-fixture.ts` 未改。

## 8. 疑似任务书/清单问题

1. §4 的 `promptSelectionOf(model: BoundModel)` 与模块边界冲突（Contracts 不能导入 Core），实现改为同形结构类型；
   任务书应照此改写。
2. C 组新增 `LocalWorkbenchHost.runtime`（live bindings 读回），任务书未列；属于最小的实现选择。
3. 裁定 2 未规定“只给 base 不给 skills（或反之）”的混合输入；实现让两者各自独立回退，未写测试。
4. K 的 1,100 行估计偏低（测试口径）。

## 9. HANDOFF

已完成：K/C 全部代码与测试、`--write` 再生 dist、`--check`、typecheck、架构检查、build、两条提交（工作区干净）。

未完成：`tests/kernel` 与 `tests/app` 的全目录回归（只跑了新增的 `tests/kernel/PC-*` 与新 Host 测试）。
最短路径：`timeout 900 npx vitest run --maxWorkers=2 tests/kernel tests/app`（分两批，各 ≤10 文件不适用时按目录拆），
若出现失败，只可能是 K 改动触及的旧 Kernel 用例；按任务书 §5.3，`R4a-frozen-public` 等应保持通过，其余按回归报告。
无半改文件，无未提交改动。
