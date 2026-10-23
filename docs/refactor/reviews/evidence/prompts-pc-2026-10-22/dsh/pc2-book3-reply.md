# PC-2 任务书 v3 回复

只写了 `./.dsh-ref/pc2-book-v3.md`，未改代码、未提交。v3 共 **984 行**（`wc -l`）。标题下第一行已改为
“This book is v3, for Codex's quick check; it is frozen when that check passes.”

## 一、逐裁定

**L1** §3.3 裁定 10：两个渲染器签名的工具清单改为 `readonly string[]`（不是 `readonly string`）。

**L2** §3.5 裁定 16、19：`PromptSetV1` 增加 required `toolNames: string[]`，用裁定 16 的输出顺序、从不排序；
`decodePromptSetV1` 严格检查“互不相同的非空字符串数组”；它放进 manifest digest 和 PC-1 的 manifest 尺寸计量；
`PromptPartsV1` 与 `storePromptTexts` 同时携带 `toolNames` 和裁定 19 的 `tools`（Q 两者都写）；注明这是对 PC-1
冻结 `PromptSetV1` 的增补，合入时记录。

**L3** §3.6 裁定 20 步骤 2：统一为 reader 的 `tools` 作为 `texts` 传给 `runObservedModel`，再由它传给每个工厂。

**L4** §3.3 裁定 13 / §3.4 裁定 14：`AssembledContextV1.renderMaterial` 改为 required，两个 recipe 各渲染一次后
填入。

**C1** §3.3 裁定 10：冻结完整签名——`renderContinuationBriefZh(brief, digest, pack?: PromptTextsV1,
toolNames?: readonly string[])` 和 `renderUnknownCallReviewZh(input, pack?: PromptTextsV1, toolNames?: readonly
string[])`；参数全缺时用生成包和“所有工具在场”，旧直接测试不用改。写全生产调用点：`context-work-recipe.ts:244`
（brief）、`context-review-recipe.ts:117`（review）、`execution-preparation.ts:551`（shrink）、
`execution-entry-service.ts:975`/`:1201`（brief）和 `:1053`（review），各自传解析/冻结的包与冻结工具清单。

**C2** §3.1 裁定 4：`origins[templateId]` 改为 `{ packId, version, mentionsTools }`，三项都来自供应包的 manifest
条目；`PromptTemplateReadV1` 与 §3.5 裁定 18 的声明检查都读 `origins[templateId].mentionsTools`；T 生成平台值；
注明扩展 PC-1 的 `origins`。

**C3** §3.5 裁定 16：`FinalToolListInputV1` 增加独立的 `reviewSource`（`observed-model-run.ts:266`），与
`frozenSource`（`:200`）分开；`blockedCommands` 换成 `hasBlockedCommands`（`prepared-execution.ts:243`、
`execution-driver.ts:505`）。

**C4** §3.5 裁定 16：`finalToolNamesOf` 返回 `ToolGroupResult<string[]>`；先拒绝（未知名字/缺 owner 仍是
`unsupported`），再给数组。逐类条件与行号：协调工具按选择与必需 owner（`tool-group-assembly.ts:196–201`、
`:203–209`、`:211–224`）；review/rerun 按 Run purpose 与非空 blocked 绑定，不按 `selected`
（`execution-driver.ts:482`、`:485–487`、`:505–514`）；`applicationReceipt` 只是可选增强
（`tool-group-assembly.ts:236–244`）；`graph`/`notes` 表示所需端口组合在场（`:219–221`、`:222–224`）。start 只把
ready 结果与冻结数组逐项比较。

**C5** §3.3 裁定 13：`ContextRenderMaterialV1` 增加冻结段元数据 `sections: ContextSectionPlanV1[]`
（name、omitted、wholeOmitted）和实际计费的 `residentBytes`；`ContextTemplateId` 从 `context-types.ts` 导出、
`context-rendering.ts` 导入；`rerenderContextV1` 放在 `context-rendering.ts`，只替换 review 槽、重算区间和
`totalBytes`，保留预算选择和省略元数据；`AssembledContextV1.renderMaterial` 改为 required。

**C6** §3.4 裁定 14：增加 assembler 接缝的 TS——`ContextAssemblerTextInputV1`（pack/toolNames）、
`ContextWorkHistoryInputV1` / `ContextQueryHistoryInputV1`（Query basis 在装配前传入；Work 和无 basis 的 Query
传真实 completed boundary；有 basis 的 Query 不传）、`AssembledContextV1.historyDecision`。recipe 只调用一次
`sessionHistoryDecision`（Work 种子确定后；Query 用传入 basis；recipe 从不读边界）；Q 从
`historyDecision.takesSessionHistory` 原样冻结。§4 的 T 交接顺序加入这些类型。

**C7** §3.4 裁定 14：`sessionHistoryDecision` 的 `completedBoundary` 改为可选；有 `sessionBasis` 的 Query 不读
目标边界、也不伪造零边界；Work 和无 basis 的 Query 要求真实边界。Work/Query 的优先级文字未动。

**C8** §2 规则 3、§4 表：`tests/architecture/production-reach-allowlist.json` 归 Q，Q 在联合步骤只编辑一次；
其他组只报告增、删、留的条目。

**C9** §5.2 PC-20、§5.1：四种工具清单改为 renderer 字面测试（`renderTemplate` 和 T 的 Skill render helper）；
prepare-to-request 只用公开路径可达的三种清单（read；read + edit + shell；无 read）走平台夹具的权限 `tools`。
`read_source` 只在 renderer 测；不加夹具注入点，也不加产品权限。

**D8** §3.6 裁定 21：两个白板工具各读自己的 `expected[].ref` / `expected[].revision`，两个工具的文本可以不同。

## 二、`[DSH choice]` 与理由

1. **`PromptRenderError` 类名与 code 集**（§3.1 裁定 4）：沿用 v2。裁定只要求“可区分错误”，用一个类包住今天的
   空必填槽检查，只把包/模板问题和空必填映射 `invalid`。
2. **`PromptPackChainEntryV1` 的 `{file,text}` 形状与问题字段**（§3.1 裁定 4）：沿用 v2。输入是“读出的链文件”，
   保留文件名供问题定位；包级问题 `templateId: null`，工具问题加可选 `toolName`。
3. **六条路由 DTO 字段名、save 返回同 read**（§3.1 裁定 6）：沿用 v2。save 返回新版本的 read 形状，减少两套形状。
4. **`ContextRenderMaterialV1` / `ContextSectionPlanV1` / `rerenderContextV1` 的名字与形状**（§3.3 裁定 13）：
   按 C5 增段计划和 `residentBytes`；这样重渲染不必重新解析正文猜“本来没有行”还是“整段被省略”。
5. **`sessionHistoryDecision` / `HistoryDecisionV1` 等的名字与形状**（§3.4 裁定 14）：名字沿用 v2，另加
   `SessionHistoryDecisionInputV1` / `CompletedHistoryBoundaryV1`；按 C7 把边界改成可选，并按 C6 把“用的哪次判定”
   放进 `AssembledContextV1`，避免 T、Q 各算一次。
6. **`finalToolNamesOf` / `FinalToolListInputV1` 的名字**（§3.5 裁定 16）：名字沿用 v2；返回改成现有
   `ToolGroupResult` 风格，输入按 C3 拆出 `reviewSource`、换成 `hasBlockedCommands`。
7. **`readPromptTexts` 扩展后的返回形状**（§3.6 裁定 20）：沿用 v2。保留 PC-1 的参数与状态 union，只在 ready 值里
   加 `tools`。
8. **白板两串放在各自工具的 `expected[].ref` / `expected[].revision`**（§3.6 裁定 21）：按 D8，每个工具读自己的
   条目；`parameters` 按工具输入路径作键，两工具都带 `versionPinSchema`，所以两条都要有，文字可不同，发出字节
   仍与 v1 相同。
9. **新增 assembler 输入类型名**（§3.4 裁定 14）：`ContextAssemblerTextInputV1` /
   `ContextWorkHistoryInputV1` / `ContextQueryHistoryInputV1` / `SessionBasisV1`。裁定冻结的是跨接缝传什么，名字是
   DSH 选的；用两个 history 类型把“Work 必须有边界”和“有 basis 的 Query 不读边界”写进类型。

## 三、未能应用

十四条全部落地。只有一点沿袭 v2：PC-1 的 `PromptSetV1` / `readPromptTexts` 在当前 copy 里尚未落地，书中按
`pc1-book.md` §3.2/§4 的冻结接口写；PC-1 实际落地若改名，以 PC-1 的冻结表为准。v2 的 pinned digest 十六进制值
仍留施工时手算（本运行不改代码）。

## 四、行数

`wc -l .dsh-ref/pc2-book-v3.md` = **984**。
