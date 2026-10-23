**PC-1 的主要接缝仍在，但不能照规格里的旧行号直接派发。** D3 已搬走文字、拆开装配器；D2 已集中工具名单。另有四处需要在任务书冻结前说清：最终请求预估的接口、Query 请求事实的保留、Work 请求记录的读口，以及 PC-06／PC-08 与 PC-2 选包能力的交叉。

本次只读文件、目录和源码映射，没有修改文件，没有运行测试、构建、Git 或网络操作。`dc462a95` 按你给的基线使用，没有另行查 Git。

下文路径缩写均相对于 `D:\cxt\pc`：

- `K/`＝`vendor/coding-agent/patches/`
- `D/`＝`vendor/coding-agent/dist/`
- `R/`＝`src/core/agent-runtime/`
- `W/`＝`src/core/work-graph/`
- `C/`＝`src/contracts/`
- `A/`＝`src/app/`

**1．Kernel 补丁机制，以及 P3、P4、P5 的准确落点**

当前脚本管理 **15 份源码、60 个产物**。清单如下，出处为 `scripts/build-kernel-patch.mjs:13`：

```text
storage/adapters/sqlite/sqlite-stores.ts
public-api.ts
app/composition/control-hooks.ts
app/composition/composition-contracts.ts
core/runtime/loop/runtime-runner.ts
app/composition/composition-root.ts
app/composition/resume-composition.ts
core/ports/session_store/session-history.ts
core/runtime/state/run-state.ts
core/runtime/events/agent-events.ts
core/runtime/reducer/run-state-reducer.ts
core/ports/session_store/session-store-port.ts
sandbox/workspace/workspace-sandbox.ts
sandbox/process/process-sandbox.ts
tools/builtin/shell/shell-tool.ts
```

每份对应 `.js`、`.js.map`、`.d.ts`、`.d.ts.map`。脚本默认 `--check`，接受 `--write`；**脚本本身不从 source map 恢复源码**，而是直接读取 `patches/` 下已恢复、已审查的源码。恢复是首次纳管时的独立步骤。见 `scripts/build-kernel-patch.mjs:29`、`:35`、`:39`。

再生过程是：

1. 检查实际 TypeScript 版本严格等于根 `package.json` 的固定版本；当前是 `6.0.3`。见 `scripts/build-kernel-patch.mjs:41`、`package.json:18`。
2. 将冻结 `dist` 复制到临时目录，以其中的声明文件提供未纳管模块的类型；覆盖受管 `.ts`，只编译清单里的源码，不重新编译旁边的冻结模块。见 `scripts/build-kernel-patch.mjs:48`、`:52`、`:69`。
3. 用严格的 NodeNext／ES2024 配置生成四种产物，编译失败不发出产物。见 `scripts/build-kernel-patch.mjs:58`、`:66`、`:71`。
4. 检查 map 只有一个、且路径符合预期的来源；把受管源码放回 `sourcesContent`，按冻结约定输出紧凑、非 ASCII 字符转义的 JSON。见 `scripts/build-kernel-patch.mjs:83`。
5. 逐字节比较现有产物；`--write` 只写不同的文件，`--check` 遇到不同则退出码为 1。见 `scripts/build-kernel-patch.mjs:97`、`:100`、`:108`。

加入选择策略所需动作很小：从冻结 map 取 `sourcesContent[0]`，保存为 `K/core/context/selection_policy/context-selection-policy.ts`，把相对路径加入清单，之后只经脚本再生。原来的四个目标产物已经存在，不需要另造输出目录或链接旧 Kernel 工程。脚本读取目标文件进行比较的位置是 `scripts/build-kernel-patch.mjs:96`。

我在内存中核了这份 map：

- JS map 的来源是 `../../../../src/core/context/selection_policy/context-selection-policy.ts`；
- JS map 与声明 map 的 `sourcesContent[0]` 完全相同；
- 是完整的 225 行源码，末尾有换行；
- 源码 UTF-8 SHA-256 为 `291c3188be525b0ece8730ef74304ea03e153fef8db4a54b0378e2ab6c4c527d`；
- 当前没有对应的受管 patch 文件。

出处是 `D/core/context/selection_policy/context-selection-policy.js.map:1`、同目录 `context-selection-policy.d.ts.map:1`。因此可以确认**源码文本可完整恢复**；本次没有编译，不能把它写成“已验证四产物逐字再生”。

构建检查要分开写：

| 入口 | 当前实际检查 |
|---|---|
| `build` | 平台提示词静态模块是否最新，然后编译平台；不执行 Kernel patch 再生检查。`package.json:11` |
| `check:architecture` | 模块边界、资源清单及哈希、平台包引用闭包、Kernel 冻结依赖闭包，以及平台包生成模块是否最新。`scripts/check-boundaries.mjs:203`、`:274`、`:356`、`:491`、`:582` |
| `verify:isolated` | 在物理副本里先执行 Kernel patch `--check`，再依次执行架构、类型、构建、测试及 smoke。`scripts/verify-isolated.mjs:13`、`:21`、`:24` |

PC-1 对规格 §4 所列 Kernel 文件的修改落点：

| 文件 | 当前接缝及要改的内容 |
|---|---|
| `K/core/runtime/loop/runtime-runner.ts` | 输入已有基础提示词、Skill、预算、历史：`:99`、`:102`、`:104`、`:111`；F8 分界：`:665` 当前 transcript、`:666` 历史；`:674` 构造选择输入；`:686` 同步选择、`:687` 拼请求；F10 hook 后旧估算：`:711`、`:714`；真正发模型前：`:723`、`:728`。P3、P4 必须在这一组一起改。 |
| `K/core/context/selection_policy/context-selection-policy.ts`，新增 | 原算法对应 `D/core/context/selection_policy/context-selection-policy.js:30`、`:92`。恢复后改成七级候选、保护标识、异步最终请求预估和统计；不能继续删除 instruction Skill。 |
| `K/app/composition/composition-root.ts` | 公共输入从 `:71` 开始，`onConfiguration` 在 `:117`；同身份恢复分支在 `:322`，其转发参数在 `:334`，也必须带新输入；旧 Skill 文件加载在 `:415`，配置回报在 `:423`；runner 的固定 base、Skill、历史注入在 `:493`、`:495`、`:499`。 |
| `K/app/composition/resume-composition.ts` | 恢复输入从 `:60` 开始，回调在 `:96`；重新加载 Skill 在 `:311`，回报在 `:318`；固定 base、Skill、预算注入在 `:406`、`:408`、`:410`，恢复执行在 `:416`。不能只改首次开始。 |
| `K/app/composition/composition-contracts.ts` | `AppRuntimeConfiguration` 在 `:15`；`systemPromptVersion`、`systemPrompt`、tools、skills、必填 `skillResourceRoot` 在 `:16`、`:17`、`:22`、`:23`、`:24`。传入冻结内容时按规格报 `id@version` 和 `provided-by-host`。 |
| `K/public-api.ts` | 现有 `ContextBuilderInput`／`ModelRequest` 类型出口在 `:54`、`:60`；`selectContext` 在 `:112`，`RuntimeRunner` 在 `:130`。新增的预估、选择报告及冻结输入类型应从这里公开，平台不能导入 Kernel 私有路径。 |
| `scripts/build-kernel-patch.mjs` | `:13` 清单加一项；变成 16 份受管源码、64 个受管产物。 |

F22 的声明行号没有变：`D/public-api.d.ts:33`、`:40`。

本树保留的是冻结 Kernel 和迁入的公共接口测试，并没有完整 Kernel 开发源码／测试工程。维护说明对此已有明确限定：`vendor/coding-agent/README.md:3`、`:5`。目前可钉住这些接缝的是公共类型、`tests/kernel/B2-history-public-export.test.ts:94` 的出口检查，以及 `tests/kernel/R4a-frozen-public.test.ts:556` 的真实 `runCodingAgent` 装置；不存在可以直接拿来证明新七级删法的旧测试。

K 片可照搬的是补丁交付方法：

- K-A 加了关闭悬空 Turn、读取 Turn 边界，并修改 Runtime／Workflow 接续；其证据明确记录 dist 经脚本生成、`--check` 通过。见 `docs/refactor/reviews/evidence/orchestration-slice-K-2026-10-13/partA/README.md:3`、`:14`。
- K-B 加只读进程沙箱与只读命令；验收明确要求先导入源码补丁，再 `--write`、`--check`。见同目录 `partB/README.md:3`、`partB/lead-acceptance.md:6`。
- 更早的历史读取、公共导出和工具组安全点补丁，也沿同一机制扩展。见 `vendor/coding-agent/README.md:9`、`:15`、`:19`。

**2．P3：七步删除、五项保护和最终请求预估**

runner 已经具备区分历史与当前执行的原始数据，无须新增数据库事实。关键是**不能先拼成一列再丢掉分界**：`K/core/runtime/loop/runtime-runner.ts:665`、`:666`。

“本次任务输入”最好直接取 `state.turn.userMessage.messageId`，并核对它是当前 transcript 第一条 user；状态初始化和不变量已经钉住这一关系。见 `K/core/runtime/state/run-state.ts:119`、`:307`、`:348`。运行中来信另经 `run.input_accepted` 加入，消息 ID 是 `input-${inputId}`，不会替换这条原始任务输入。见 `K/core/runtime/loop/runtime-runner.ts:823`、`:856`。

建议传给选择策略的是稳定身份及历史归属，不用在删除后继续使用会漂移的数组下标。

| 删除步骤 | runner／输入已有的数据 | 当前最近的算法及 PC-1 差额 |
|---|---|---|
| 1 记忆 | `memories` 的 id、priority、source | 已有：`D/core/context/selection_policy/context-selection-policy.js:121`。可保留当前低 priority 先删、同值反向 id 的顺序，见 `:86`。 |
| 2 reference Skill | `skills[].kind === "reference"` | 已有：同文件 `:126`。 |
| 3 附加指令 | `additionalInstructions` | 已有：同文件 `:131`。Host 说明在 P5 后属于 base，不得混进这一类。 |
| 4 历史成功工具结果正文 | 历史分界；结果的 `status`、`callId`、`output`；前置 assistant 的 `toolCalls` 提供工具名 | 当前没有。结果形状见 `D/core/ports/tool_executor/tool-executor-port.js:57`、`:63`、`:69`、`:76`。只对成功结果替换 `output`，其余字段照原样。 |
| 5 历史整组工具交换及旧 user | assistant 的调用 ID 集合，以及后续 tool_result 的 ID；历史 user 的 messageId | 当前 `:30` 搜索整组，`:47` 建待闭合集合，`:56` 只收完整组；`:72` 按稳定 ID 删除。需要增加“仅历史”和任务／最新 user 保护条件。 |
| 6 历史无工具调用 assistant | `kind === assistant_message` 且 `toolCalls.length === 0` | 当前明确不进入整组候选，见同文件 `:45`、`:56`。这是新增删除行为，须单独计 `historyConclusion`。 |
| 7 当前执行未受保护的整组工具交换 | 当前 transcript 中完整的 assistant＋全部结果 | 可复用整组识别；候选必须限定当前执行，排在所有历史候选之后。当前 `:141` 没有这个分层。 |

第 4 步的比较单位应明确为两个完整 `output` 数组的 UTF-8 JSON 字节数：

```text
旧值：JSON.stringify(original.output)
新值：JSON.stringify([{ kind: "text", text: 占位正文 }])
```

占位正文按规格逐字使用：

```text
内容因长度省略（工具 <名字>，调用 <id>），需要时重新读
```

只有新数组严格更短才换；空数组、短正文、error、cancelled 都不换。工具名从配对的调用取，不能从结果摘要猜。两家适配器都序列化**整个结果**，因此保留 `schemaVersion/callId/status/effects` 确实影响发送内容。见 `D/model/providers/deepseek/deepseek-model-client.js:41`、`D/model/providers/openai/openai-model-client.js:39`。

五项保护的实现依据：

| 保护项 | 依据 |
|---|---|
| base＋Host 说明 | `ContextBuilderInput.baseSystemPrompt` 本来就不在删除候选中；当前拼接位置见 `D/core/context/builder/context-builder.js:23`。P5 把 Host 并入这个字段。 |
| instruction Skill | 依据 `skills[].kind`；必须删掉当前删除它的分支 `D/core/context/selection_policy/context-selection-policy.js:136`。 |
| 本次第一条 user | `state.turn.userMessage.messageId`；见 `K/core/runtime/state/run-state.ts:122`、`:348`。 |
| 最新 user | 当前算法已有 `findLastIndex`，见 `D/core/context/selection_policy/context-selection-policy.js:32`；应在原始候选集合上确定身份。 |
| 未闭合调用 | 调用 ID 集合减去实际结果 ID；当前只有集合为空才准许整组删除，见同文件 `:47`、`:56`。不得留下孤立结果。 |

还有两个删除单位需要 lead 明写：第 7 步没有授权删除当前执行里的旧来信或无工具调用 assistant；建议先保持它们，不把“当前交换”扩大解释成所有消息。部分闭合工具组中已经成功的兄弟结果能否在第 4 步缩正文，规格也未明确；建议整组保护，避免保护语义分叉。

目前两套预算确实不同：

- Kernel 用 `JSON.stringify(...).length / 3`，选择前估的是 `ContextBuilderInput`。见 `D/core/context/selection_policy/context-selection-policy.js:9`、`:105`。
- 平台 `ModelBudget` 支持异步 counter，按照最终请求估输入，并加输出预留。见 `R/model-budget.ts:6`、`:82`。
- Work 的 meter 在 `R/execution-driver.ts:842` 创建；Query 在 `R/query-execution.ts:363` 创建。
- `responseFormat` 和 Host 说明目前在选完上下文后才追加，见 `R/observed-model-run.ts:257`。
- 输出上限又在 meter 中调整，随后才做授权摘要，见 `R/model-budget.ts:82`、`R/observed-model-run.ts:245`。

建议冻结成这一条顺序：

```text
历史／当前出站副本
→ P4 思考过滤
→ 固定删除前缀
→ 同一个 ContextBuilder
→ 平台最终请求转换＋同一个 ModelBudget.preview
→ hook
→ 若修改则再次 preview
→ onContextSelected
→ 真正预留、记录准入
→ provider
```

具体改法：

- 从 `R/model-budget.ts:82` 至 `:95` 提取无预留副作用的异步测量：计算输出 cap、完整请求字节、counter、`fits`。预估不得 push `entries`、调用 persist 或消耗额度；真正预留仍在 `:96`、`:97`。
- `responseFormat` 进入共享的最终请求转换函数；Host 说明在准备冻结 base 时已并入，删掉发送层的再次追加。当前追加点是 `R/observed-model-run.ts:257`。
- 选择策略和 runner 改为 await；每个候选都用同一个 builder，最后直接使用预估返回的 `outgoing`。hook 修改后替换 `K/core/runtime/loop/runtime-runner.ts:714` 的旧复核。
- 发送层保留预算兜底，但不能在最终预估之后另做改变请求字节的加工。实际用量仍由 `R/model-budget.ts:107` 更新，下一次 preview 读取同一账户的 `totals()`，见 `:52`。
- 二分对象是固定候选序列的删除前缀；字节估算下与线性最小前缀一致。分词器下只接受实际预估 `fits` 的候选，不承诺最少删除。调用次数应写成 `O(log(N+1))` 加端点检查，避免把规格“最多 log₂ 次”解释成精确次数。

当前还没有 `onContextSelected` 的平台接收者。建议在共用的 `R/observed-model-run.ts:288` Kernel 调用处接回调，按 `requestId` 保存最终报告；在同文件 `:245` 的 `beforeCall` 处取出并加入请求事实。不能用一个“最近报告”变量，重试和两次请求必须各自匹配。

另有恢复边界：Work 每次进入这段 driver 都新建 meter，当前累计量只在该实例内保存，见 `R/execution-driver.ts:842`。若 P3 的“同一次执行”包含暂停恢复，建议把 meter 留在同进程活句柄中复用；仅透传新 preview 回调还不够。

**3．P4：只过滤出站副本**

现有接缝正好在 runner 构造 builder 输入之前：

- 当前 transcript 来自 `withPresentations`，历史来自独立的 `historyTranscript`。见 `K/core/runtime/loop/runtime-runner.ts:665`。
- `withPresentations` 只在确有展示覆盖时复制工具结果，其他条目可能仍共享原对象。见同文件 `:246`。因此不能直接 `delete entry.message.reasoningContent`。
- assistant 的正文是 `message.content`，思考是可选 `message.reasoningContent`，调用在同级 `toolCalls`。builder 将它们映射为模型消息，见 `D/core/context/builder/context-builder.js:63`。
- 只有思考的 assistant 是合法原记录，见 `D/core/runtime/state/run-state.js:130`；新回复保存位置仍在 `K/core/runtime/loop/runtime-runner.ts:761`。

建议先分别映射历史和当前列表：需要去思考的 assistant 复制 entry 和 message，移除思考；正文长度为零且调用数为零时，从这份出站列表移除。`current_run` 只处理历史，`none` 处理两边。保留原 `RunState`、历史条目和持久事件。

适配器不改：

| 适配器 | 当前出站行为 |
|---|---|
| DeepSeek | assistant 的 `reasoningContent` 写成 `reasoning_content`；工具调用转为函数调用，结果整体 JSON 化。`D/model/providers/deepseek/deepseek-model-client.js:28`、`:31`、`:41` |
| OpenAI | 不回传 reasoning；正文和 function_call 分开形成 Responses 输入，工具结果为 function_call_output。`D/model/providers/openai/openai-model-client.js:22`、`:27`、`:39` |

这也说明过滤必须早于预算预估，否则算的是含思考的请求，发出的却是另一份。

**4．P5 冻结：准备、Skill、开始／恢复和入口复核**

两条准备路径的现状：

| 路径 | 当前步骤 |
|---|---|
| Work | 解析配置 `R/execution-preparation.ts:369` → 装配任务 `:481` → 输入及摘要 `:492` → `buildManifest` `:517` → JSON／大小核对 `:561` → `bodies.put` `:570` → `bundleRef` `:585` → `inputBinding.manifestDigest = bundleRef.digest` `:593`。 |
| Query | 解析配置 `R/query-preparation.ts:193` → 投影权限预算 `:204` → 初始规划指引 `:227` → 装配 `:235` → 输入摘要 `:248` → manifest `:255` → 大小核对 `:278` → `bodies.put` `:284` → 绑定 prepared `:305`。 |

`PromptSetV1` 应成为两类 manifest 的必填字段，类型位置是 `C/core/prepared-execution.ts:195`、`:262`。不能只改 TypeScript：Work 的 Runtime 加载器、WorkGraph 入口加载器，以及 Query 的两处加载器都要核这个字段，分别在 `R/execution-preparation.ts:643`、`W/tasks/execution-entry-service.ts:309`、`R/query-execution.ts:93`、`W/queries/query-execution.ts:427`。

建议准备顺序是：

1. 确定模型身份、解析后的包、思考策略和本次需要的模板。
2. 用同一份解析结果渲染任务输入、base、接续／复核说明。
3. 选定 Skill，读取自定义目录正文。
4. 先存模板正文、合并字符串表、已并 Host 说明的 base、各 Skill 正文。
5. 全部成功后，把引用、digest、元数据组成 `PromptSetV1`，再序列化并存 manifest。

manifest 仍受现有大小上限限制，正文不能直接嵌进去。Work 上限沿 `ARTIFACT_MAX_SIZE_BYTES`，见 `R/execution-preparation.ts:91`；Query 检查在 `R/query-preparation.ts:279`。

正文存储是内容寻址：key 为 `contentType|digest|sizeBytes`，第一次写入获胜，同内容复用已有 ref。见 `src/core/record-store/body-codec.ts:125`、`body-store.ts:39`。因此冻结子正文的读取不能照搬 manifest 的“origin 必须属于这次 Run”检查；共享正文可能由更早的执行首次存入。应先授权读取本执行 manifest，再沿它持有的 ref 校验正文完整性。

Skill 现状和迁移：

- 显式 `{resourceRoot, enabledIds}` 原样选；平台 bundle 默认加入 `platform-work` 并组合行为 ID。见 `A/runtime-configuration.ts:373`、`:375`。
- 平台根常量是 `resolve(import.meta.dirname, '../../resources/skills')`，见 `A/runtime-configuration.ts:82`。
- 自定义目录 loader 会 realpath、检查文件、读取完整正文、计算 UTF-8 SHA-256，生成 `source = skill:<id>@sha256:<digest>`。见 `D/skills/loader/file-skill-loader.js:28`、`:51`、`:74`、`:78`。
- 实际 `SkillContext` 还有必填 `schemaVersion: 1`，规格 F4 的简写没有列它。见 `D/core/context/types/context-types.js:50`。
- 显式空选择必须保持空；不要因 falsy 判断又加载默认 Skill。

平台根判定应在调用文件 loader 之前做 `path.resolve` 比较，不能依赖已删除目录的 realpath。还需处理模块边界：Runtime 不能反向导入 `A/runtime-configuration.ts`，架构检查禁止 core 依赖 Host，见 `scripts/check-boundaries.mjs:498`。建议把根值和平台 Skill 识别放到 Runtime 可拥有的共享模块，再从原位置重导出同名常量，保持值不变。

开始／恢复的传递链：

```text
manifest.promptSet 的正文引用
→ 校验并读回冻结正文
→ execution-driver / query-execution
→ runObservedModel
→ runCodingAgent
→ composition-root 或同身份 resume-composition
→ RuntimeRunner
```

平台目前传 Skill 目录及 Host 说明的位置是 `R/execution-driver.ts:982`、`:983`，Query 是 `R/query-execution.ts:525`、`:526`；共用 Kernel 调用在 `R/observed-model-run.ts:288`。这里应改为传 `baseSystemPrompt {templateId,version,text}`、完整 `skills`、`reasoningReplay`、preview 和报告回调。

配置核对必须保留现有次序：

- Work 开始／有活句柄的恢复：当前核 `configurationRevision`、`hostTemplate`，位置在 `R/execution-driver.ts:572`；加模型 ID、provider、model、packId、reasoningReplay 比较。
- 恢复没有本进程证明，先回 `busy`，不能为了新配置检查改变这个结果。见同文件 `:384`、`:392`。
- Query 已进入后只观察，位置在 `R/query-execution.ts:176`；进入前的配置比较在 `:198`。
- Host registry 第一次解析成功后固定绑定提供者，新设置只供新执行使用。Work／Query 分别见 `A/host-settings.ts:226`、`:237`、`:255`。

当前模型设置类型还没有 `promptPack`、`reasoningReplay`，见 `A/host-settings-types.ts:10`。更关键的是，Runtime 的模型配置也没有独立 `modelId`，只有 revision/provider/model/baseUrl：`R/source-tool-ports.ts:19`、`A/runtime-configuration.ts:418`。设置模型的 ID 目前被编码进 revision 字符串，见 `A/host.ts:667`、`:677`。**不应再从 revision 解析 ID**；建议新增显式字段一路传递，直接 Host 配置的模型 ID 规则由 lead 一并冻结。

入口复核目前仍读“当前静态平台包”：

- 接续重渲染：`W/tasks/execution-entry-service.ts:973`。
- 复核重渲染：同文件 `:1053`。
- 另一处接续后缀检查：同文件 `:1201`。
- 两个 renderer 内部引用静态包：`C/continuation-brief.ts:35`、`:407`，`C/core/prepared-execution.ts:38`、`:188`。

PC-1 要把模板及字符串表作为显式渲染输入，入口先异步读取冻结正文，再交给纯校验。PC-2 再把“必须是全文后缀”改成按冻结段序和字节区间核对；不要在状态纯函数里读 body。

**5．P5 请求记录：字段、不可变性、工具正文及读口**

建议先冻结一个共享的“请求提示词事实”类型，但 Work 的最终许可类型必须要求 `maxOutputTokens`，不能因为共享类型写了可选就允许漏存；Query 沿用必填 `reservedOutput`。

Work 的完整链路如下：

| 层 | 新字段必须进入的位置 |
|---|---|
| Runtime 请求接口 | `C/dispatch.ts:347` 的 `ModelCallAccess.beforeCall`。 |
| 两次投影 | `R/model-call-access.ts:76` 授权投影，`:87` 消费投影；两处都加入 system/tools digest、toolSpecsRef、selection、maxOutputTokens。 |
| 领域输入和许可 | `W/tasks/model-call-contracts.ts:18` 的 `ActualModelRequest`，`:43` 的 `ModelRequestPermitV1`。 |
| 输入校验及授权存储 | `W/tasks/model-call-service.ts:61`、`:144`。 |
| 消费一致性 | 同文件 `:245`；必须逐项比较新不可变事实，随后 `:251` 只改消费信息。 |
| 严格编解码 | `W/tasks/model-request-codecs.ts:81` 的许可字段白名单和校验；snapshot 在 `:147`，事件解码在 `:174`。 |
| 事件和重放 | 授权事件 `W/tasks/model-call-service.ts:153`，消费事件 `:257`；重放从原事件恢复，见 `:285`、`:301`。 |
| 指纹 | 授权指纹 `:112`、消费指纹 `:210`；只要输入投影没有漏字段，新事实就会进入指纹。 |

“不可变”由**写入后只允许消费状态变化、消费时与实际请求比较、重放指纹拒绝不同事实**共同实现，并不是加一个 `readonly` 就完成。

现有同命令身份、不同指纹的路径已经返回 `idempotency_conflict`：内存后端 `src/core/record-store/in-memory-record-store.ts:440`，SQLite 后端 `sqlite-record-store.ts:526`。但这不覆盖所有“同模型 requestId”：

- Work 许可 ID 按 `(runRef, requestId)` 推导，见 `W/tasks/model-call-contracts.ts:69`。
- 若换了外层命令 requestId，却撞到同一模型请求许可，当前回 `revision_conflict`，见 `W/tasks/model-call-service.ts:134`。
- 因此 P5 若要求同模型 requestId 的不同提示词事实一律 `idempotency_conflict`，还要在这里读出已有事实作比较；消费端当前不一致则是 `forbidden`，见 `:245`。任务书应区分模型请求 ID 与写命令 ID。

Query 的链路不同：

- 当前请求类型是 `QueryModelUsageV1 & { admitted: boolean }`，见 `C/query-job.ts:356`、`:366`。
- meter 先写 reservation；Runtime 投影在 `R/query-execution.ts:119`、`:363`。
- 随后 `beforeCall` 再准入，投影在同文件 `:394`；公开领域接口在 `W/queries/contracts.ts:154`、`:158`。
- WorkGraph 要求已有 reservation，再核 requestDigest、manifest/input 绑定，见 `W/queries/query-execution.ts:1381`。
- 当前用量更新用整个 incoming 替换旧条目，只保留 `admitted`，见同文件 `:1302`、`:1310`。这正是新字段会丢失的位置。
- Query 事件的请求列表目前只检查“是数组”，没有逐条检查新请求事实，见 `W/queries/query-record-codecs.ts:343`、`:355`；PC-1 必须补相应解码约束。

建议 Query 把请求的初始事实与可变用量投影分清：首次 reservation 就携带完整提示词事实；后续仅更新 `inputTokens/outputTokens/cachedInputTokens/usageStatus`。`requestDigest`、预留值、提示词 digest、ref、selection 和 admitted 状态不能被一次普通 usage 写重新定义。若来的是不同不可变事实，应走幂等冲突，不应静默覆盖。

`toolSpecsRef` 的可用入口已经存在：

- Kernel 的配置回报带完整 `tools.modelToolSpecs()`，见 `K/app/composition/composition-root.ts:430`、`K/app/composition/resume-composition.ts:325`。
- 这些是转换过 schema 的最终工具说明，不是简单的工具名列表。见 `D/tools/registry/tool-registry.js:71`、`:92`。
- registry 与 builder 都排序，但前者使用默认 locale、后者指定 `"en"`，见上述文件 `:99` 和 `D/core/context/builder/context-builder.js:112`。存储时应使用与最终请求一致的顺序，并在发送前核对实际 toolsDigest。

同步 `onConfiguration` 中应立即复制工具说明、生成存储 Promise，同时接住拒绝，避免等待前发生未处理的 Promise rejection。共享包装层等待它完成、检查 ref／正文 digest，然后才进入首次 `beforeCall`；建议也放在实际 reservation 之前，避免 body 存失败却留下不完整的 Query 请求条目。现有共用包装层是 `R/observed-model-run.ts:240`、`:253`。

这里有一处不能漏掉的错误传播：

- Runtime 已用 `RuntimeModelCallRejected('unavailable', …)` 表达许可读写不可用，见 `R/model-call-access.ts:51`、`:81`、`:92`。
- 但 Kernel 会把 stream／runner 异常转换成失败状态，见 `K/core/runtime/loop/runtime-runner.ts:784`、`:801`。
- `runObservedModel` 当前直接返回这个 result，见 `R/observed-model-run.ts:349`。
- driver／Query 只在捕获原类型异常时保留拒绝码，见 `R/execution-driver.ts:1003`、`R/query-execution.ts:534`。

所以工具正文存储失败应在共享包装层留下明确的拒绝事实，在 Kernel 返回后经现有清理／观察流程向外传播 `unavailable`；只往 async generator 里 throw 不足以满足 PC-10。

`readPromptRecord` 应属于 `createAgentRuntime` 发布的 `RuntimeExecutionPort`，最近的模板是 `R/runtime.ts:512` 的 `readContinuationBrief`：先校验引用、授权读取执行，再读 manifest 和正文。端口位置是 `R/ports.ts:36`、`:79`，本批不加 E3 路由。

读记录还有一个缺口：Work 的 `ModelRequestPort` 目前只有两个写方法，没有读取／列举方法，见 `W/tasks/model-call-contracts.ts:32`；许可 schema 也没有 lookup，见 `W/tasks/model-request-codecs.ts:222`。建议由 WorkGraph 增加按完整 RunRef 列举许可的窄读口及索引，Runtime 调它；不要让 Runtime 扫 RecordStore，也不要让提示词读口依赖 Kernel 历史尚可读取。现有依赖已经含 `RecordLookupPort`，见 `W/model/execution-entry-contracts.ts:153`。Query 则直接经现有 `readQueryExecution` 取得请求列表，见 `W/queries/contracts.ts:140`。

摘要字节口径建议冻结为：

```text
systemDigest = SHA256(UTF8(systemPrompt))
toolsDigest  = SHA256(UTF8(JSON.stringify(finalRequest.tools)))
```

工具 body 保存第二行里的原始 JSON 字符串；不要一边 canonical JSON、一边普通 JSON。读口返回的 `texts` 还应规定以 digest 或完整 ref key 为键，并校验重建 system／tools 的摘要。

**6．PC-1 所需包内容，以及与 PC-2 的边界**

D3 后的平台包已经存在，当前是 **10 个模板**：最初的 7 个，加 Work、planning、copy 三个主输入模板。见 `resources/prompts/platform/pack.json:5`、`:43`；结构轮记录也区分了 S3、S4，见 `docs/refactor/reviews/evidence/structure-round-2026-10-21/README.md:15`、`:16`。不能再次派发“建立包格式和渲染器”。

当前 `PromptPackManifestV1` 只有 templates、strings、tools，没有单独的 Skill 表；`ResolvedPromptPackV1` 也没有逐模板来源包映射。见 `C/prompts/prompt-pack.ts:6`、`:22`。

建议 PC-1：

- 加 `base` 模板，初版正文严格取当前 `coding-agent-v5`，不改 `check` 句、不加工具条件块。正文与版本常量位于 `D/app/prompts/coding-agent-system-prompt.js:2`、`:3`。
- 将五份平台 Skill 正文作为固定模板 ID 放进包；title、kind、priority 留在代码拥有的元数据表，避免擅自扩展已冻结的 pack JSON 格式。
- 给 base 和五份 Skill 增加对应的空槽位表。
- 平台包的 `packId` 继续为 `"platform"`；“第 2 版”是内容迭代，不是把 `schemaVersion` 改成 2。当前身份见 `resources/prompts/platform/pack.json:2`。
- PC-1 的 `PromptSetV1.sectionOrder` 如实记录当前顺序；PC-2 才从模板槽位推导并执行新顺序。

五份 Skill 的现有元数据都是 instruction：

| Skill | priority | 当前元数据／正文 |
|---|---:|---|
| platform-work | 90 | `resources/skills/platform-work/skill.json:3`；`content.md:1` |
| platform-secretary | 70 | `resources/skills/platform-secretary/skill.json:3`；`content.md:1` |
| platform-adviser | 60 | `resources/skills/platform-adviser/skill.json:3`；`content.md:1` |
| platform-scribe | 50 | `resources/skills/platform-scribe/skill.json:3`；`content.md:1` |
| platform-reviewer | 40 | `resources/skills/platform-reviewer/skill.json:3`；`content.md:1` |

迁移时保留正文全部字节，尤其末尾换行；保留 metadata 和按正文摘要生成的 source，才能保持 Kernel 的 Skill section 字节。section 包装含 id 和 source，见 `D/core/context/builder/context-builder.js:20`。

包生成器会按 manifest 读文本并写静态模块，不在运行时读平台包目录，见 `scripts/build-platform-prompts.mjs:41`、`:63`、`:127`。新增模板可沿现有路径生成；**生成器不会替你更新 `runtime-assets.json`**。旧五个 Skill 目录的十项资产在 `runtime-assets.json:15` 起，迁移时删除旧项、增加新模板项并更新 pack 哈希；vendor 的 `coding-safety` 保留。资源闭包检查入口是 `scripts/check-boundaries.mjs:228`。

“先逐字搬迁”可行，但有明确范围：

- base 字面内容、Skill 内容和 Skill section 可做到不变。
- P5 把 Host 说明并进 base 后，其位置会从所有 Skill 后移到 Skill 前。当前 system 顺序见 `D/core/context/builder/context-builder.js:23`，Host 末尾追加见 `R/observed-model-run.ts:259`。
- 因此含 Host 说明和 Skill 的请求不能宣称整体 system 字节不变；P3、P4 也本来就有意改变发送内容。

建议责任边界：

| 项目 | PC-1 | PC-2 |
|---|---|---|
| base | 新增、冻结、传入 Kernel；保留原文 | 删除 `check` 句，所有工具句加条件块，更新模板版本 |
| 平台 Skill | 原文搬迁、选择、冻结；删除旧目录 | 包继承／编辑后的模板解析 |
| packId／模型身份 | 冻结字段及配置比较；默认 platform | 设置选包、用户包加载与编辑 |
| sectionOrder | 类型和冻结记录，记录当前顺序 | 从模板计算、校验、按它渲染及核字节区间 |
| 接续／复核 renderer | 接受冻结模板和 strings | 去旧文件句、改位置、整体重装配复核收缩 |
| 工具 | 记录 Kernel 实际回报的完整 specs | 最终名单驱动工具块及声明校验 |
| 旧文件提醒 | 保留历史来源事实接缝 | 新模板及角色段注入 |

PC-06、PC-07 可先经正常 Host 解析接口提供可变的小包快照来证明冻结；但 **PC-08 第一条明确要求“在设置里改包”**，以及 PC-06 对真实用户包的集成行为，都与 PC-2 的加载／选包有交叉。建议任务书标为共享验收：PC-1 验冻结、pin 和 mismatch；PC-2 补真实设置／用户包路径，整行最终才关闭。不要把替身绑定变化写成“设置选包已验收”。

**7．测试入口、缺的夹具、手算方式及 §3.3 复核**

现有入口可这样复用：

| 入口 | 可用装置 | 缺什么 |
|---|---|---|
| PE3 Work | `tests/helpers/B2-runtime-fixture.ts:171`；脚本模型在 `:71`，公开 prepare/start 例在 `tests/runtime/B2-runtime-execution.test.ts:70` | 可变包快照、可注入异步 counter、reasoning／usage 回复、按内容类型失败的 body store、公开 `readPromptRecord`。 |
| PE3 Query | `tests/helpers/RL-query-fixture.ts:66`；公开提交、认领、prepare/start 在 `:150`；另一完整双请求例在 `tests/runtime/R5b-query-session-loop.test.ts:118` | 拆开 prepare 与 start，暴露 QueryRunRef；配置／counter／body 失败控制，不能只用一个自动跑完的方法。 |
| PE4 selectContext | 公开出口检查 `tests/kernel/B2-history-public-export.test.ts:119` | 没有现成删除行为测试；新增小输入、独立字节计数、手列删除前缀夹具。 |
| PE5 runCodingAgent | `tests/kernel/R4a-frozen-public.test.ts:494` 脚本 provider，`:556` 配置装置 | 新增 reasoning、usage、inputSupply、两 Turn 历史与冻结输入支持。 |
| PE6 RuntimeRunner | `tests/helpers/orchestration-fixture.ts:43`、`:147`；真实 hook 用法在 `tests/kernel/R4-tool-group-barrier.test.ts:408` | preview 注入、记录每次候选和输出 reserve，hook 改 cap 的脚本。 |
| PE7 adapters | 两个公开 client 的 transport 参数：`D/model/providers/deepseek/deepseek-model-client.d.ts:3`、`D/model/providers/openai/openai-model-client.d.ts:3` | 本树未找到两家适配器各自的现存测试文件；新增只捕获 body、返回合法流片段的 transport 替身。无需网络。 |

旧 Kernel 装置里的 `readRecords` 直接打开 SqliteStores，见 `tests/kernel/R4a-frozen-public.test.ts:609`，不要把这个读库辅助函数复制进 PC 新测试。原历史不变应经公开 Runtime 历史读口验，已有例子在 `tests/runtime/R5b-query-session-loop.test.ts:231`。暂停控制可借 `tests/runtime/R4-control-runtime.test.ts:182`、`:190` 的正式提交／投递步骤。

逐行夹具与期望：

| 行 | 缺的最小场景 | 期望怎样独立计算 |
|---|---|---|
| PC-06 | Work／Query 准备后换包文本、strings 和自定义 Skill；Work 加真实接续入口 | 小包写字面 `BASE-A`、标签 A、Skill A；准备后换 B。手拼预期 system／任务输入，直接用标准 SHA-256 算字面字符串。读取冻结集比对。 |
| PC-07 | 同进程正式暂停、改包、正式 resume | 恢复请求的 system 与准备时字面 system 一致；同一冻结 ref／digest。不能重建一个伪 paused 状态。 |
| PC-08 | registry 换新绑定＋同执行 pin；另一个受控 Host 对旧执行返回不同 packId | 老执行 A、新执行 B；真实 mismatch 回 `forbidden`、模型零次。实际设置路由部分留作两片共同验收。 |
| PC-09 | Work、Query 各工具调用一次再最终回答；第二次结束后重新读 | 两条记录、两个字面请求对应的 system/tools 摘要、明确删除计数和 cap；两条 toolSpecsRef 相同；改变一个不可变事实重放得到冲突。 |
| PC-10 | body 替身只在工具说明 contentType 上拒绝 | Work／Query 都 `unavailable`，provider 调用数为 0；不能让准备 manifest 提前失败而冒充这条。 |
| PC-11 | 七类候选齐全，历史与当前分界明确 | 独立手列每个删除前缀的完整请求，算 UTF-8 字节＋4096＋输出预留；预算放在相邻两个值之间；期望计数写字面。线性参考只在测试中使用，不调用生产候选生成器。 |
| PC-12 | 历史 success 长／短／空，error、cancelled，以及配对调用 | 手写占位 output；只比较这一个数组被替换，其余字段深等；独立计算新旧 output JSON 字节；两家 transport body 的调用 ID／结果 ID 一一对应。 |
| PC-13 | 仅保护内容＋instruction Skill 已超预算 | 手算完整受保护请求成本，预算设为成本减 1；断言 `required_content_over_budget`，instruction 仍未被作为候选删除。 |
| PC-14 | 先产生旧 Turn，再在当前执行通过 inputSupply 注入来信 | 当前第一条任务 user 和新来信都在，旧内容被删；用明确的 messageId／正文断言，不能只检查消息数量。 |
| PC-15 | 长 Host、responseFormat、紧窗口；第二次调用改变累计输出；异步 counter | 例如窗口 1000、单次 cap 256、累计输出上限 400；首轮实际输出 200 后，第二轮 reserve 为 200。输入分别 700／800 时总额为 956／1000。另用完整字节公式验证 Host 和格式确实计入。 |
| PC-16 | RuntimeRunner hook 把 cap 从 100 改成 250 | 固定输入计数 700、窗口 900：原来 800 可放，修改后 950 不可放，provider 零次；也覆盖 Host cap 把修改值夹住的情形。 |
| PC-17 | 历史含 reasoning-only、正文＋reasoning、调用＋reasoning；当前工具循环也产 reasoning | `current_run` 只留当前 reasoning，`none` 全无；reasoning-only 历史消息出站消失；公开历史读口仍读到原 reasoning。适配器请求体按各自协议手写比较。 |

现有 B2 脚本只支持 text／calls，没有 reasoning／usage，见 `tests/helpers/B2-runtime-fixture.ts:58`、`:85`。建议新建 PC 专用 helper，避免为本片大改共享夹具。Codex 先交这些 helper 的只读补丁，由 lead 落地并冻结，再让 DSH 写每行测试。

§3.3 的搜索，我按规格的两个表达式对当前 `tests/` 文本做了等价只读匹配：

第一组 `s3-context-v1|CONTEXT_FORMAT_VERSION|kind: 'task_execution'` 命中 8 个文件：

```text
tests/helpers/WP1-units-fixture.ts:516
tests/runtime/K3-35-manifest-trim-pure.test.ts:232
tests/runtime/K3-unknown-call-review-section.test.ts:55
tests/runtime/S3-context-assembler.test.ts:58
tests/scenarios/S3-context-and-inputs.test.ts:105
tests/state/context-input.test.ts:88
tests/state/WP1-goal-content.test.ts:56
tests/work-graph/S3-prepared-context-admission.test.ts:188
```

列表与规格合并后相符，没有发现这组文件消失。PC-1 对真正手写 manifest 的地方补必填 PromptSet；`sectionOrder` 绑定及新顺序断言归 PC-2，不能现在把所有匹配都改成新顺序。

第二组“同时含 `inputDigest:` 和 `manifestDigest`”命中 10 个文件：

```text
tests/helpers/B2-execution-fixture.ts:243
tests/helpers/S2C-X-scale-fixture.ts:448
tests/helpers/WP1-units-fixture.ts:527
tests/scenarios/S3-context-and-inputs.test.ts:149
tests/state/context-input.test.ts:308
tests/state/k3-run-reconcile.test.ts:60
tests/state/run-machine.test.ts:88
tests/work-graph/A2-step1-codecs.test.ts:556
tests/work-graph/C2-mailbox-admission.test.ts:62
tests/work-graph/S3-prepared-context-admission.test.ts:704
```

**这个表达式过宽，不能据它给所有绑定加请求提示词字段。**

- `S2C-X-scale-fixture`、`k3-run-reconcile`、`run-machine`、`C2-mailbox-admission` 的上述匹配是 input binding／entry 事实，不是模型请求许可。
- `A2-step1-codecs` 当前匹配也是 binding／TaskEntryPermit；按规格可以在这里新增模型请求编解码例，但不能把它写成“已有模型许可断言翻转”。见 `tests/work-graph/A2-step1-codecs.test.ts:556`、`:824`。
- 真正补搜 `requestDigest:|reservedOutput:`，命中的是 `tests/helpers/B2-execution-fixture.ts:316` 和 `tests/work-graph/B2-model-request.test.ts:19`。后一个文件未在 §3.3 请求夹具名单中直接列名；它主要通过 helper 取得请求，是否需要改旧断言应逐项裁定，不能据搜索自动扩大白名单。

平台 Skill 的三处直接读文件仍在：

```text
tests/runtime/W2-role-skills.test.ts:33
tests/app/AG6-agent-assembly.test.ts:52
tests/app/AG6-agent-assembly.test.ts:178
tests/runtime/C2-runtime-platform-tools.test.ts:63
```

这三处应改成包内容及冻结集断言；显式子集、空选择、自定义目录保留。不能留下旧平台目录让测试继续通过。只把 resourceRoot 指向平台根的其他夹具，按根识别规则继续工作。

其余规格旧行号也重新核过：

- CA01／CA12 仍在 `tests/runtime/S3-context-assembler.test.ts:600`、`:813`，后缀断言在 `:830`。
- I-19 后缀检查仍在 `tests/state/invariants.ts:1864`；测试组在 `tests/state/invariants.test.ts:1357`。
- 三处旧文件句断言仍在 `tests/contracts/A2-rework-contract-helpers.test.ts:398`、`tests/runtime/K3-15-blocked-sentence-pure.test.ts:52`、`tests/runtime/K3-35-renderer-boundary-pure.test.ts:39`。
- 实际旧文件句已从 `continuation-brief.ts` 搬到 `resources/prompts/platform/templates/continuation-brief.txt:5`。这些属于 PC-2。

F1–F22 中，前文已给出 Kernel、冻结、记录、设置的新位置；其余受结构轮影响的定位如下：

| 事实 | 当前位置／变化 |
|---|---|
| F5 固定输入段序 | `R/context-rendering.ts:25`、`:37`；`context-assembler.ts` 现在只重导出和接线，见 `R/context-assembler.ts:15`、`:27`。 |
| F6 可选段预算 | `R/context-rendering.ts:41` 的保留次序，`:94` 的前缀渲染、`:115` 的预算选择；行为没变。 |
| F7 守卫及后缀 | `W/state/context-input.ts:44`、`:65`、`:197`、`:254`、`:282`、`:294`；入口见前文。 |
| F13 Query 历史选择 | `R/query-execution.ts:473`，派生历史分支 `:477`，目标 Session 边界分支 `:491`。 |
| F14 Work 历史／归档 | `R/execution-driver.ts:684`；来源事实移到 `R/context-history-facts.ts:57`，归档排除在 `:250`；图工具历史仍在 `R/graph-tools.ts:358`，Session 卡工具工厂在 `R/session-discovery-tools.ts:139`。 |
| F15 初始化、工具文字 | 已变为静态包读取：`R/query-preparation.ts:51`、`R/whiteboard-tools.ts:203`、`R/project-source-tool.ts:238`、`R/note-tool.ts:188`。 |
| F15 角色、标签、简报、复核 | `R/role-profiles.ts:23`、`R/context-fact-text.ts:24`、`C/continuation-brief.ts:407`、`C/core/prepared-execution.ts:161`、`:188`。 |
| F15 其余消费者 | `R/unknown-call-review-tools.ts:213`、`:295`；`R/command-rerun-tools.ts:207`；`src/business/workflow/consultation.ts:449`；`R/execution-inputs.ts:61`。 |
| F18 最终工具名单 | 已移到 `R/tool-group-assembly.ts:428`。精确条件是 `hasRead && reviewSource`；`read_material` 还要求 `hasMaterialTools`，见 `:443`。不能笼统写成所有 frozen source 模式都无 read。 |
| P1 目录约束旧行号 | 设置目录解析仍为 `A/main.ts:154`、`:163`；打开工作区入口现在是 `A/host.ts:869`。 |
| P10 复核收缩 | 仍在 `R/execution-preparation.ts:519`、`:548`、`:551`、`:557`；当前仍切前缀再拼后缀，PC-2 要整体重装配。 |

**8．规模、互不重叠的施工组和需要冻结的接口**

以下是任务书预算，**不是实测 diff**。计入新增受管源码的完整恢复文本、平台资源搬迁、生产代码、夹具和测试；不计脚本生成的 `vendor/coding-agent/dist/**` 和 `platform-pack.generated.ts`。生成物单列验收，不能用其机械行数决定 DSH 分组。

| 子项 | 加 | 删 | 加＋删 |
|---|---:|---:|---:|
| Kernel 公共输入、composition 接线、出口、纳管脚本 | 190 | 50 | 240 |
| 删除策略，含新增受管源码恢复 | 460 | 0 | 460 |
| 思考出站过滤 | 60 | 10 | 70 |
| 冻结、包原文搬迁、准备／入口、配置传递 | 1,700 | 430 | 2,130 |
| 请求记录、统一预算接线、工具正文、读取 | 1,050 | 120 | 1,170 |
| 夹具及测试 | 1,540 | 40 | 1,580 |
| **合计** | **5,000** | **650** | **5,650** |

其中约 350 行是 Codex 先交、lead 冻结的 PC 专用夹具，不作为 DSH 临场设计任务。余下建议分五组：

| 组 | 预算 | 文件所有权及先冻结的接口 |
|---|---:|---|
| G1 Kernel | +1030／−70＝1100 | §4 的六份 Kernel 源、纳管脚本、新 Kernel 测试。一次完成 P3/P4/P5 Kernel 接缝；冻结异步 `selectContext`、preview、report、base／Skill 输入及 start／resume 转发。 |
| G2 冻结契约与包基础 | +850／−250＝1100 | 新 PromptSet／请求事实契约、`C/core/prepared-execution.ts`、`C/continuation-brief.ts` 的显式模板参数、Runtime 公共类型、模型身份／提示词配置类型、平台 base／Skill 资源、资产清单及生成。冻结正文存储／读回 helper、平台 Skill metadata、包解析结果接口。 |
| G3 记录持久化 | +900／−100＝1000 | `model-call-access.ts`、Work model-call contracts/service/codecs、Query contracts/codecs、**整个 `W/queries/query-execution.ts` 的本片改动**，包括其 manifest 校验；记录专项测试。冻结 Work 列举请求读口、Query 首次事实／后续 usage 规则和冲突语义。 |
| G4 准备与入口 | +930／−170＝1100 | 两条 preparation、`context-*` 配方／文字／渲染参数接线、Work `execution-entry-service.ts`、PC-06 和三个 Skill 旧测试。只用 G2 的冻结接口；本组不再修改 G3 拥有的 Query 领域执行文件。 |
| G5 实际发送与公开读取 | +940／−60＝1000 | `model-budget.ts`、`observed-model-run.ts`、`execution-driver.ts`、Runtime 的 `query-execution.ts`、`runtime.ts`、新读口实现、平台集成及适配器测试。完成同账户预估、requestId 汇合、工具正文等待／失败传播和 PC-07…10／15 的最终链路。 |

这五组加夹具包正好是上述 +5000／−650。任务书要按**完整文件**分配：尤其不能把 Query manifest 校验给 G4、Query 请求记录又给 G3；不能把 runtime-runner 的思考和删除拆给两组。G2 先冻结契约；G1、G3 在契约明确后交付；G4 接准备；G5 接最终执行和读口。组内仍按公开接口逐条先红后绿。

PC-2 会继续触碰的文件应提前标记：

- `resources/prompts/platform/pack.json`、base／Skill／输入／接续模板、strings、`runtime-assets.json` 及生成模块；
- `C/prompts/slot-tables.ts`、包解析结果／校验，`C/continuation-brief.ts`、`C/core/prepared-execution.ts`；
- `R/context-rendering.ts`、相关配方和 `context-types.ts`、两条 preparation；
- `W/state/context-input.ts`、`W/tasks/execution-entry-service.ts`；
- Host 模型设置／运行配置，以及最终工具名单与模板渲染之间的接线。

PC-2 应接着 PC-1 的冻结渲染接口做，不再另起一套从全局静态包读取的路径。

最后，需在任务书中裁定或修正规格的点如下：

1. **F5、F6、F14、F15 的旧装配器位置已失效。**按上面的 `context-*` 和静态包位置派发；D3 已完成的迁移不重做。
2. **F18 的描述过宽。**精确使用 `hasRead && reviewSource`，并保留 `hasMaterialTools` 条件。出处：`R/tool-group-assembly.ts:443`。
3. **source map 可恢复不等于已再生验证。**本次只证明文本完整；施工时由 lead 跑脚本检查。
4. **Kernel 新输入是否必填尚未定。**建议平台调用必传；独立 Kernel 旧调用可保留缺省路径，避免越过 §3.3 改大量旧夹具。决定 79 的旧记录不兼容与公共调用参数缺省是两件事。现有独立调用见 `tests/kernel/R4a-frozen-public.test.ts:556`。
5. **选择报告的 `budget` 含义未明确。**建议定义为输入可用额度 `contextWindowTokens - outputReserve`；窗口和输出 cap 的关系写进接口注释及手算测试。
6. **第 7 步的删除单位、部分闭合组的第 4 步行为未明确。**建议当前执行只删完整工具交换；部分闭合组整体保护。
7. **二分次数应写复杂度，非精确 log₂ 上限。**保留端点检查，任何接受点都必须有真实 `fits` 结果。
8. **modelId 没有现成 Runtime 字段。**新增显式模型 ID；直接 Host 配置的 ID 来源由 lead 定，不能解析 revision。出处：`R/source-tool-ports.ts:19`、`A/host.ts:677`。
9. **平台 Skill metadata 和模板 ID 尚未定义。**建议正文作为模板，metadata 留代码表；保持旧 id/title/kind/priority/source 字节语义。
10. **平台根常量存在层级依赖问题。**保留原导出和路径值，将实现放到 Runtime 可依赖的位置；core 不导入 Host。出处：`A/runtime-configuration.ts:82`、`scripts/check-boundaries.mjs:498`。
11. **PC-1“整次发送字节不变”不可成立。**原文迁移可不变，Host 并入 base 会改变 system 顺序，必须作为 P5 的有意变化验收。
12. **Work 同模型 requestId 的冲突路径尚不完全符合 P5。**现有重复许可返回 revision_conflict、消费不匹配返回 forbidden；需明确新不可变事实不同时统一返回 idempotency_conflict 的范围。出处：`W/tasks/model-call-service.ts:134`、`:245`。
13. **Query 不只缺字段，还缺保留和解码规则。**必须改整条覆盖及 requests 元素校验；否则第二次用量写后记录可能丢失。出处：`W/queries/query-execution.ts:1310`、`W/queries/query-record-codecs.ts:355`。
14. **Work 请求列举读口不存在。**建议 WorkGraph 增加窄读口和 RunRef lookup，Runtime 组合读取；不从 Kernel 历史反推许可清单。
15. **toolSpecsRef 的等待、排序、恢复复用及 unavailable 传播需要一并冻结。**尤其不能把 Kernel 归一后的失败状态误当作外层仍会捕获原异常。
16. **Work 暂停恢复会新建 ModelBudget。**若“同执行累计预算”覆盖恢复，PC-1 应复用活句柄内账户；不能只共享计算函数。出处：`R/execution-driver.ts:842`。
17. **正文去重保留首写来历。**冻结子正文授权应沿已授权 manifest 引用，不要求 body origin 等于当前执行。出处：`body-codec.ts:125`、`body-store.ts:39`。
18. **摘要算法和 `texts` 键尚未规定。**建议 system 原始 UTF-8、tools 原始有序 JSON，明确 ref 校验和读口键。
19. **PE7 没有可直接复用的适配器测试文件。**新增无网络 transport 夹具；不把这一项写成扩写现有测试。
20. **§3.3 的请求夹具 grep 有较多误报，且未直接列出 B2-model-request。**按实际类型逐项补字段，旧断言超名单的变化交 lead 裁定。
21. **PC-06／PC-08 与 PC-2 有共享验收。**PC-1 可证明冻结和配置 pin；真实用户包及设置选包路径必须在 PC-2 到位后关闭整行，不能提前宣称全部通过。
22. **原 §5 的 PC 总量 3000–4000 行偏低。**按当前缺口，PC-1 本身约 5650 行人工变更；生成物另计，PC-2 另估。

PC-1 估计：加 5000、删 650