# PC-2 任务书 v2 回复

只改了 `./.dsh-ref/pc2-book-v2.md`，没有改代码、没有提交。v2 共 **831 行**（`wc -l`）。

## 逐裁定

1. **一次运行**：改标题、开头和 §4。删掉 PC-2a/PC-2b 与两晚表；写明 W 的 `87f16ba` 在基线里，W 作为小返工组；组序为 A（先冻结 resolver 接口）→ T（先冻结渲染材料与 role 提醒槽）→ H/W → G/Q → joint，树只在整轮结束保持绿。
2. **文件归属**：改 §4 表与 §5.3。`create-platform.ts`→H；`runtime.ts`（`readPromptRecord` 读冻结工具正文）→Q；`prepared-execution.ts`、`continuation-brief.ts`（`takesSessionHistory` 字段类型和渲染器工具清单参数）→T；`work-graph/queries/query-execution.ts`（Query manifest 新字段核对）→G。§5.3 老测试逐文件列唯一 owner；allowlist 只允许保留“回复点名后续消费者”的条目。
3. **冻结工具清单函数**：改 §3.5 裁定 16。冻结 `finalToolNamesOf` / `FinalToolListInputV1`，输入含 Work/Query、`selected`、`readOnly`、`reviewPhase`、`blockedCommands`、九个 owner 能力、`frozenSource`、`materialTools`、只读命令开关与 `allowsRead('.')` 结果；输出顺序照 `kernelEnabledToolNames`；start 用长度加逐项比较，顺序也算，不同即 `forbidden`。
4. **同一清单贯穿所有渲染**：改 §2 规则 1、§3.3 裁定 10、§3.5 裁定 18、§5.2 PC-20。`base`、Skills、brief、review/proposal、K3 收缩、入口重渲染都用冻结清单；补 `renderContinuationBriefZh` 和 `renderUnknownCallReviewZh` 的新参数及 T 的 owner；PC-20 加一个非 `base` 模板的工具块。
5. **扫描与 Skill**：改 §3.5 裁定 18、§5.2 PC-19/20、§5.3。Skills 走 renderer、带最终清单、无槽；v2 中每个 Skill 的工具句进对应工具块，`mentionsTools` 仍为 `[]`，版本升 2；全工具在场时逐字节等于 v1；扫描只匹配工具块外的完整工具名、大小写敏感，冻结豁免表覆盖 receipt 的 `check`、op 名 `write`/`withdraw`/`review`、planning 的 `checks` 和普通 “check”；PC-1 的 digest 测试改 v2 字面值。
6. **PC-24…26**：改 §5.2。PC-24 覆盖 31 个 description，仅八个非空参数表各改一个参数；PC-25 用 `list_files.prefix` 测缺键和多键；PC-26 Work 改 `record_note` description、Work 与 Query 都改 `list_files.prefix`，不加 Query 权限。
7. **目录边界**：改 §3.1 裁定 1–3、PC-23、§5.1 Host fixture。每个包及父包的真实目录在真实 `prompts/` 内，`pack.json` 和每个保存目标的真实父目录也在内；按 `..` **段**拒绝，`..name` 合法；补 inside、相等路径、symlink 三种场景。
8. **工具正文传递链**：改 §3.6 裁定 20–21、§4 W 组。写全 `PromptSetV1.tools`→`readPromptTexts`→driver/Query→`runObservedModel`→`createExplorationTools`→`createProjectSourceTool`，以及 `registerReadonlyCommandTool`→`createReadonlyCommandTool` 和十个工厂；fallback 改为逐工具 `texts[name] ?? PLATFORM_PROMPT_PACK_V1.tools[name]`；W 改十处 whole-object default，exploration/readonly 透传。
9. **读取链 DTO 与校验**：改 §3.1 裁定 4、PE8。冻结 `PromptPackChainEntryV1`、`ResolvedPromptPackV1`（含 `origins`/`toolOrigins`）、`PromptPackProblemV1`、`PromptPackValidationV1`；`parameters` 是对象且值为字符串；版本和声明来自最近供应包的 `origins` 与 manifest；optional 可缺、required 出现一次、unknown 拒绝、input 模板段槽不多不少；渲染时 required 空值用 `PromptRenderError` 映射 `invalid`。
10. **守卫与入口**：改 §3.3 裁定 12–13、§5.3。guard 接收重渲染正文，核区间相等和唯一出现；entry 读冻结正文后调用 guard；binding 顺序等于该 call kind 的冻结集顺序；I-19 不假设固定 marker 行；PE9 分列错区间、重复正文、非尾段成功。
11. **夹具与签名**：改 §5.1、§3.3 裁定 13、§3.4 裁定 14。fixture 加包文件字节快照、真实 K3 收缩且提醒在后、Query 历史派生、PE8 空值注入、PE9 公开入口负输入；冻结 `sessionHistoryDecision` 和 `ContextRenderMaterialV1`/`rerenderContextV1`；PC-23 方向改为 inside、相等路径、symlink。
12. **§5.3 漏项**：改 §5.3 与 §4。补 `S2B-backfill-host` ~78/~118/~142、`S2B-35-activity-routes` ~202、`S2B-r2-backfill-kernel-support` ~136、`context-input` ST08 ~162、PC-1 digest 测试、手写 manifest 的机械补字段；每文件一个 owner；无旧假设的 K3 测试不动。
13. **路由成功 DTO 与错误码**：改 §3.1 裁定 6。冻结六条路由的成功 DTO；unknown pack/template/tool → `not_found`（`host-settings-types.ts` 已有）；坏正文/坏 JSON → `invalid` 带 `problems`；`list` 保留坏包 problems；无 settings port 用 `unsupported`（`server.ts` ~343）；`save` 返回与 `read` 相同的描述；`SettingsResponse` 加 `revision_conflict` 和可选 `problems`。
14. **设置清除与启动优先级**：改 §3.2 裁定 7、PC-05。保存时省略 `promptPack`/`reasoningReplay` 即清除，resolve 取默认；启动 catalog 只初始化，不覆盖后续设置保存；PC-05 加重启后的公开步骤。
15. **预算手算**：改 §5.2 PC-21。F/N/M/I，输入行 40 个 `I`；全留 `3+3+3+42+8=59`，前三留、输入只留省略行 `3+3+3+32+8=49`；省略行 30 字节 = 7+1+22；预算 49 时 k=4 为 59>49、k=3 为 49≤49，保留 F/N/M、略 I，`residentBytes=49`。
16. **白板两个字符串**：改 §3.6 裁定 21。两串进 `propose_future_plan` 和 `apply_future_plan` 的 `parameters`，键为 `expected[].ref` / `expected[].revision`，删 `toolSchema.whiteboardPin.*` 字符串键；发出字节不变；W 从工具正文读。
17. **规模**：改 §6。预算 7,139：Codex 盘点 6,120 + 83-5 的 1,000 = 7,120；W 的 500 换成实测 519，得 7,139；分组和 `1,150+2,190+519+1,190+930+1,160=7,139`。回复要求每组报 added/deleted/total。

## `[DSH choice]` 与理由

1. **`PromptRenderError` 类名与 code 集**（§3.1 裁定 4）：裁定只要求“可区分错误”，没给名字。选一个类包住今天 `render-template.ts` ~207 的空必填空值检查，只把包/模板问题和空必填映射 `invalid`。
2. **`PromptPackChainEntryV1` 的 file/text 形状与 problem 字段**（§3.1 裁定 4）：裁定说输入是“读出的链文件”，没给类型。用 `{file,text}` 保留文件名供问题定位；problem 加可选 `toolName`，包级问题 `templateId: null`。
3. **六条路由的 DTO 字段名，`save` 返回与 `read` 相同的描述**（§3.1 裁定 6）：裁定要求冻结成功 DTO，但没点名。让 save 返回新版本的 read 形状，减少两套形状。
4. **`ContextRenderMaterialV1` / `rerenderContextV1` 的名字与形状**（§3.3 裁定 13）：裁定要求“材料或纯函数”。选纯函数，字段就是今天 assembler 渲染后丢掉的东西（pack、template、slots、toolNames、budget）。
5. **`sessionHistoryDecision` / `HistoryDecisionV1` 的名字与形状**（§3.4 裁定 14）：裁定要求一个纯函数；模式与输入照今天 Work/Query 的 start 规则，只把结果收成一个 union。
6. **`finalToolNamesOf` / `FinalToolListInputV1` 的名字**（§3.5 裁定 16）：输入字段都是裁定点名的既成事实，函数名和类型名是新的。
7. **`readPromptTexts` 扩展后的返回形状**（§3.6 裁定 20）：保留 PC-1 的参数与状态 union，只在 ready 值里加 `tools`。
8. **白板两串放在两个工具的 `expected[].ref` / `expected[].revision`**（§3.6 裁定 21）：`parameters` 按工具输入路径作键；两串描述的是嵌套 pin，两个工具又共用 `versionPinSchema`；这样发出字节与 v1 相同，也不必凭空造一个 whiteboard 工具。

## 未能照做或需要说明

- **裁定 5e 的新 digest 十六进制值没有写进书里。** 书只能授权并规定“改成 v2 手算值”；真正算值要先写 platform pack v2，那是本轮代码工作，本运行不改代码。因此这里只冻结规则和测试文件，值留给施工时手算。
- **PC-1 的 `PromptSetV1` / `readPromptTexts` 在当前 copy 里还不存在**（只有 `pc1-book.md` §3.2 和 `pc1a-am-reply.md` §4 的冻结接口）。这两处签名按 PC-1 冻结接口写；其余 DTO、行号和调用链都从当前树抄。若 PC-1 落地时改了名字，按 PC-1 的冻结表为准。
- 其余 16 条均已落到书里；没有发现与裁定冲突、需要保留不改的条目。
