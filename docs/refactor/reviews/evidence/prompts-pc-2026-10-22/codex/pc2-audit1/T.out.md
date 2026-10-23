本次只读，未运行测试、构建或网络操作。下文的失败结论来自代码、断言和字节手算，不是测试运行结果。

为缩短引用，`书` 指 `.lead-ref/books/pc2-book.md`，`规格` 指 `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md`。

**1. 问题表**

| 编号 | 类别 | 位置（file:line） | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| T-01 | 会出错 | `src/core/agent-runtime/context-rendering.ts:178`、`:229` | 书:322、:515；规格:85 | 提醒模板直接返回原文。个人模板为 `{{#tool:read}}R{{/tool:read}}`、`takesSessionHistory=true`、工具表为空时，应省去条件正文，实际把整串块标记发给模型；有 `read` 时也没有得到应有的 `R`。 | 提醒通过 `renderTemplate(texts, 'stale-files-reminder', {}, toolNames)` 渲染，使用同一冻结清单；允许条件渲染为空。 |
| T-02 | 会出错 | `src/contracts/continuation-brief.ts:519`；`src/contracts/core/prepared-execution.ts:115` | 书:333、:344 | 缺省工具表取 `Object.keys(platform.tools)`，只有平台工具，没有 `read/edit/shell`。例如合法个人 brief/review 模板含 `{{#tool:read}}R{{/tool:read}}`，调用时省略 `toolNames`，约定应保留 `R`，实际删除。 | 缺省时递归收集当前模板全部工具块名称，使所有块呈现；显式传入的清单仍原样使用。不能只硬补三个名字。 |
| T-03 | 会出错 | `src/core/agent-runtime/context-rendering.ts:340`；`src/core/agent-runtime/context-types.ts:63`；`src/core/agent-runtime/prompt-set-texts.ts:96` | 书:394、:473 | `as ResolvedPromptPackV1` 是类型断言，不是转换。生产传入的 `tracked.texts` 实际只有 `templates/strings`，没有接口承诺的 `manifest/tools/origins/toolOrigins`。例如后续按声明访问 `material.pack.tools`，应得到表，实际为 `undefined`。当前重渲染不需要这些字段，所以没有证明它已经丢字节。 | **需 lead 修订接口裁定**：把材料中的 `pack` 明确收窄为 `PromptTextsV1`，T 删除强制断言；保持 PC-1 assembler 输入位置不变。 |
| T-04 | 会出错 | `src/contracts/continuation-brief.ts:385`、`:589`、`:598`、`:652` | 书:322；规格:88；该文件:290、:502 | 简报的容量后备路径仍按原始模板首行、末段估算，最终还有绕过模板的数组拼接。合法模板 `H\n{{marker}}{{body}}{{blockedOmission}}{{bodyOmission}}{{anomalies}}{{review}}{{blocked}}\n` + **16,385 个 `X`** + `\n\nT`，配无异常、无 review、无 blocked 的普通 brief：应因固定正文超过 16,384 而拒绝，实际在 `:598` 返回超限文本。 | 所有容量候选都用冻结模板和清单实际渲染、量字节；最小候选仍超限就抛 `ContinuationBriefCapacityError`，删除原始首尾拼接后备路径。 |
| T-05 | 违规 | `tests/runtime/PC2-T-render.test.ts:51`、`:64` | 书:852；运行单 `run-pc2.md:67`、`:72` | Skill 只用 `read/edit/shell`，而其块是 `look_graph/find_graph/record_note`；helper 恒传 `[]` 仍过。brief 样例没有工具块，还绕过 `renderContinuationBriefZh`，不能检出新增参数漏传。 | 用独立手写、含工具块的小 Skill 和 brief，分别通过两个专用 helper 测同一清单下的存在／不存在，整文期望写字面。保留四个 base 整文样例。 |
| T-06 | 违规 | `tests/runtime/PC2-T-render.test.ts:125`、`:160`；`tests/runtime/PC2-joint-shrink-entry.test.ts:92` | 书:418、:861 | 重渲染未断言非零 `omitted`、整段省略的 null ranges，以及另一合法顺序。把 `omitted` 全改成 0、删除 `wholeOmitted` 分支、强制平台顺序，都有漏检。部分中间段的 range 也没有核。 | 扩展现有样例：重渲染后整数组比较全部 section 字面；对现有全省略样例重渲染；再让一个重渲染样例采用不同合法顺序。 |
| T-07 | 违规 | `tests/runtime/S4C2-assembly.test.ts:358`；helper `:213` | 书:58、:920 | notes 的截止标记改成 `''`，现在一直读到 EOF。把 general note 错放进末尾 reminders，`:359` 的“在 notes 中”断言仍能通过；这是放宽原断言。 | 本用例恢复 `sectionText(input, '## Note index', '## Reminders')`。该用例没有 selected-input 行，原截止边界仍适用。 |
| T-08 | 违规 | `tests/runtime/PC2-joint-tools.test.ts:57`；`tests/helpers/PC-platform-fixture.ts:448`；`tests/helpers/WP2-platform-support.ts:560` | 书:816、:852 | PC-20 明定的 read+edit+shell 准备到请求路径缺失，被纯 renderer 用例替代。现有夹具确实不能只靠 `tools` 承载：Role 固定只读，Host 也没有相应可写配置。 | **Codex 补夹具、lead 冻结**：增加显式可写配置，贯通 Role `writeScope:'workspace'`、Host `writeScope:['.']` 与 shell 授权，默认保持原状；用权限 `read/write/shell` 走公开准备和请求，断言最终 `read/edit/shell` 文案。 |
| T-09 | 违规 | `tests/runtime/PC2-review-shrink.test.ts:39`、`:47` | 书:861；运行单 `run-pc2.md:67` | 实际 K3 shrink 用生产 renderer、manifest 中的 review 和工具表生成期望；省略元数据只核非负，且没有调用夹具的 `start()`。它不能作为所要求的独立手算、提醒保留及入口通过的验收证据。 | **交 Q／联合步骤**重写该验收：固定输入，手写缩减后全文、提醒、所有区间和计费字节，并调用公开入口；不以生产渲染结果生成期望。 |
| T-10 | 违规 | `tests/contracts/PC-prompt-section-order.test.ts:12` | 书:58、:310、:913；reply:56 | 这是**施工书漏项**：测试更新被裁定 9 强制，但 §5.3 未授权该旧文件。即使保留旧常量，`:15` 的 Work 投影期望也必须更新，无法靠实现选择避免。 | lead 把该文件明确补入 §5.3、归 T，并批准现有 v2 字面期望；不要退回旧顺序。 |
| T-11 | 不整洁 | `src/core/agent-runtime/context-types.ts:45`、`:58`；`context-work-recipe.ts:269`、`:277`；`src/contracts/continuation-brief.ts:499`；`src/contracts/core/prepared-execution.ts:103`、`:233` | 书:64；用户审计规则 6 | 新注释含 `PC-2` 施工历史；相关旧注释仍称 brief/review 为最后一段或 suffix，与新顺序冲突。 | 删除施工批次／组别叙述，保留规则及原因；把“最后一段／尾缀”改成冻结顺序中的独立区间。 |

T-08、T-09 是 T 所依赖的联合验收缺口，分别需要夹具负责人、Q 接手，不应由 T 越过文件所有权直接修改。

**2. 逐裁定、逐行**

- **§2 规则 1：平台文案字节核对 OK。** 全工具情况下，base 恰为旧文删 `check` 行，五个 Skill 等于 v1；brief 只删旧文件句，review/proposal 不变；两份白板参数值等于旧 strings 值。依据：书:45、:599、:735；`resources/prompts/platform/templates/base.txt:10`、`continuation-brief.txt:1`；`src/contracts/prompts/platform-pack.generated.ts:137`；`resources/prompts/platform/tools/apply_future_plan.json:7`、`propose_future_plan.json:8`。
- **裁定 9：T-10。** 实际顺序正确。两 Query 模板只升版本、正文不变，以及 reviewer Skill 只升版本，均有明确授权，并非多余升版：书:310、:312、:642；`resources/prompts/platform/pack.json:53`、`:88`。
- **裁定 10：T-01、T-02、T-04。** 主上下文的预算／展示分离正确，`residentBytes` 取实际计费串：`context-rendering.ts:188`、`:221`、`:303`、`:331`。所列生产 brief/review 调用均传 pack 和清单：`context-work-recipe.ts:261`、`context-review-recipe.ts:120`、`execution-preparation.ts:688`、`execution-entry-service.ts:1055`、`:1139`、`:1297`。
- **裁定 11：OK。** Work/Query binding 使用相同模板投影；Query 只记录存在模板的调用类符合“该调用类逐元素相等”，没有要求凭空补不存在模板的顺序：书:356；`context-rendering.ts:94`、`:114`；`context-work-recipe.ts:336`；`context-query-recipe.ts:116`。
- **裁定 13：T-03、T-06、T-09。** 现有重渲染替换 review、渲染一次、重算区间和总字节、复制计费及省略状态，没有重跑预算：`context-rendering.ts:429`、`:435`、`:442`、`:459`、`:463`。
- **裁定 14，T 的类型：OK。** Work/Query history 输入必填，Query 的有 basis／无 basis 联合类型正确；输出两个字段必填，两个 manifest 有 `takesSessionHistory`：`context-types.ts:81`、`:101`、`:110`、`:123`、`:135`；`prepared-execution.ts:239`、`:309`。
- **裁定 15：T-01。** 对当前平台文字，提醒在 role 内添加一次，全省略后备路径仍保留；brief 删句且升版：`context-rendering.ts:228`、`:267`；`pack.json:26`；`continuation-brief.txt:1`。
- **裁定 17：OK。** 改行符合指定文本，其他 base 字节不变：书:599；`templates/base.txt:10`、`:31`。
- **裁定 18，T 的扫描与 Skill：扫描 OK；工具清单测试有 T-05。** 扫描走解析树、排除工具块子树、整名且大小写敏感：`PC2-platform-scan.test.ts:67`、`:90`、`:111`。名称来自 reserved 和各扩展集合，包含 builtin、`check`、`read_material`：该测试:16、:31；`tool-group-assembly.ts:76`、`:79`。这些是扫描输入，读取生产集合成立；九项豁免各有理由且检查全部被使用：该测试:54、`:133`，符合书:635。
- **裁定 21，pack 半边：OK。** 两工具各有自己的 `expected[].ref/revision`，旧 string keys 删除，发出文字不变：书:735；`apply_future_plan.json:7`；`propose_future_plan.json:8`。
- **PC-18，渲染半边：T-01。** 当前平台的 true／false、role range、全省略样例为字面断言：`PC2-T-render.test.ts:72`、`:85`、`:102`。
- **PC-19，扫描半边：OK。** `PC2-platform-scan.test.ts:104`。
- **PC-20：T-05、T-08。** 四个 base 清单及整文期望存在：`PC2-T-render.test.ts:39`、`:43`、`:47`、`:51`。
- **PC-21：T-06、T-09。**

PC-21 的预算重新手算如下，与实现相符。省略行是 `7+1+22=30` 字节；`k=0…4` 的账单分别为 **136、107、78、49、59**，所以预算 49 选择 `k=3`，保留 F/N/M，省略 I。显示仍为 F/N/I/M。原区间为 role `[5,8)`、F `[10,13)`、N `[15,18)`、I `[20,52)`、M `[54,57)`；加 `REVIEW` 后 review `[54,60)`、M `[62,65)`，`residentBytes=49`，`totalBytes=65`，I 的 `omitted` 必须仍为 1。依据：书:869；`context-rendering.ts:200`、`:221`；`PC2-T-render.test.ts:139`。

测试漏检变异中，PC-18 现有字面提醒样例看不出 T-01；PC-20 看不出 helper 恒传空表；PC-21 看不出省略元数据清零。扫描测试只负责块外声明关系，改坏块内文案不会由它发现；对应的全工具字节守恒由另一个测试负责。证据：`PC2-T-render.test.ts:33`、`:53`、`:160`；`PC2-platform-scan.test.ts:74`；`PC-platform-pack-v2.test.ts:62`。

平台的 50 个资源哈希与清单相符，源资源与生成模块相符，生成的 origins/toolOrigins 也匹配；未运行生成脚本。位置：`runtime-assets.json:15`；`scripts/build-platform-prompts.mjs:123`、`:159`；`platform-pack.generated.ts:753`、`:840`。

T 的 36 个文件均匹配白名单；四份冻结夹具不在提供的变更清单内。由于快照没有这四份冻结前的文件，不能进一步声称做过逐字节冻结比较。依据：`.lead-ref/parts/T-files.txt:1`；`.lead-ref/books/pc2-whitelist.txt:1`；`.lead-ref/all-files.txt:1`。

**3. DSH 自报项**

- **reply §8.2，材料 pack 的“转换”：部分成立。** 当前重渲染只需要模板、字符串和单独保存的工具清单，确实不需要 tool texts 或 origins；但实际对象不是所声明的完整 resolved pack，见 T-03。证据：`prompt-set-texts.ts:96`；`context-rendering.ts:340`、`:435`。
- **reply §8.2，review recipe 不填 material：成立。** 它返回 review 片段、结构化值和 session basis，不返回 `AssembledContextV1`；外层 Work recipe 统一渲染并填 material，shrink 取得的是外层结果。证据：`context-review-recipe.ts:66`、`:120`；`context-work-recipe.ts:274`、`:293`、`:351`；`execution-preparation.ts:684`。
- **reply §8.2，九名常量及旧测试更新：成立，属于书漏项 T-10。** 常量也被生产代码用作 section 名集合，并非测试专用导出：`context-rendering.ts:60`、`:64`、`:85`。
- **reply §8.2，Query 仅记录存在模板：成立。** 见裁定 11 的核对；`context-rendering.ts:114`。

**reply §1.1 的五个旧测试文件：部分成立，不能统一归因为“只差 57”。**

删除句本身为 56 字节，连换行共 **57**；依据旧模板 `.lead-ref/base/resources/prompts/platform/templates/continuation-brief.txt:5`。这些文件没有本轮修改授权，DSH 留下并报告是正确处理；lead 应补 §5.3、白名单，并明确归 **T**。依据：书:58、:913；白名单:20、:25。

| 文件与断言 | 静态核对结果 | 应批准的准确修改 |
|---|---|---|
| `tests/runtime/K3-15-blocked-omission.test.ts:87`、`:106`、`:124`、`:143` | 输入不变时分别成为 **16,327、16,247、5,752、16,216**，确实各减 57。但首例原本验证恰好 16,384，不能只降期望。 | `:83` padding **3417→3474**，保留 16384；`:102` **3477→3534**，保留 16304；`:124` **5809→5752**；`:139` **2536→2593**，保留 16273。注释基数 **1504→1447**。第三例手算为 `1447+4×(41+1018)+69=5752`。 |
| `tests/runtime/K3-35-T-by-hand.test.ts:93`、`:139`、`:172` | 两个后端共四例。截到 EOF 又包含新移到末尾的 **70 字节** reminders，当前截法的结果应为 **12,689／12,777**，不是旧数减 57。 | 按完整 brief 段截取，再把期望 **12676→12619、12764→12707**；保留 brief 的 16 KiB 上限和其他断言。 |
| `tests/runtime/K3-35-approved-methods-brief.test.ts:152`、`:164` | 两个后端共两例，同样多截了 70 字节；当前 suffix 应为 **12,184**。 | 先限定 brief 区间，再把期望 **12171→12114**；其余断言保留。 |
| `tests/app/AG6-agent-assembly.test.ts:57`、`:210`、`:222` | `contentOf` 取未渲染模板，实际工具只有 `read`；work/secretary/scribe 的原文包含块标记，正断言因此不成立。 | 将期望改成独立完整字面：冻结 v1 全文删除对应工具句，其他字节和结尾换行不动。删除句位置：当前 work 模板 `:41/:50`，secretary `:16/:21/:37/:44`，scribe `:26/:35`。不得运行时读模板或调用 renderer 生成期望。 |
| `tests/runtime/C2-runtime-platform-tools.test.ts:65`、`:143`、`:177`、`:213` | 三个正断言同样拿原模板比较；显式空 Skill 的负断言也失去约束——错误加载渲染后的默认 Skill，仍可能不含 raw template。 | 同样换完整独立字面，覆盖正、负断言。secretary/scribe 删除句同上；adviser 删除当前模板 `:32/:39/:49/:58`。保留通信行为及 GAP-46 的其他断言。 |

那 70 字节是准确字面：

```text
\n\n## Reminders\n注记索引尚未接入\n异常锚点投影尚未接入
```

计算为 `2+12+1+24+1+30=70`。这两组夹具未接 graph port，确会生成两条提醒；证据：`tests/helpers/K3-35-prepare.ts:70`；`context-work-recipe.ts:97`、`:111`；`resources/prompts/platform/strings.json:62`、`:132`、`:133`。

已修改的 `K3-35-renderer-boundary-pure` 没有重复减错：当前 **15,635** 已减过 57；T=606 为 `15635+8×94=16387`，超限 3 字节。把旧 T=600 调到 606 是保持超限测试目的的必要随动，应在书中说清，不应再减一次。证据：该测试:44、:287、:295。

其他相关自报项：

- **Query-history 夹具 spy 失效：成立。** Workflow 在构造时复制了 `runtime.port`，夹具后来才 spy 原对象，捕获不到那份复制。最小修补是在 Runtime 工厂拦截阶段、复制发生前安装转发捕获，之后仍走公开咨询步骤；由 Codex 补夹具、lead 冻结。证据：`PC2-pack-fixture.ts:411`；`create-platform.ts:1511`、`:1774`。
- **`openPC2ReviewFixture('empty')` 不可用：不成立。** 它有意把 `k3.none` 置空，制造 required slot empty；得到 `invalid` 正是负例要求，不能因它拒绝准备而跳过。证据：`PC2-pack-fixture.ts:338`、`:348`；`prepared-execution.ts:135`；书:185。
- **read+edit+shell 只能测 renderer：夹具限制成立，验收替代不成立。** 见 T-08。
- **LA-1 非空 seed 在当前便捷入口不可直接选择：成立。** `continuation()` 固定用原 Session claim，现有用例证明的是同 Session 接续，不能代替非空 LA-1 seed。证据：`PC-platform-fixture.ts:466`、`:477`；`PC2-joint-history.test.ts:90`。这部分应由 Q／联合步骤补公开新 Session 接续路径，不归入“PC-18 已全覆盖”。

**4. 同一问题表的 JSON**

```json
[
  {
    "id": "T-01",
    "class": "会出错",
    "file": "src/core/agent-runtime/context-rendering.ts",
    "line": 178,
    "basis": "pc2-book.md:322、515；PROMPTS-SPEC.md:85",
    "problem": "stale-files-reminder直接返回原文；合法read工具块在空工具表下仍以块标记原样进入输入，有read时也没有渲染成R。",
    "fix": "用renderTemplate和同一冻结toolNames渲染提醒，允许条件渲染结果为空。"
  },
  {
    "id": "T-02",
    "class": "会出错",
    "file": "src/contracts/continuation-brief.ts",
    "line": 519,
    "basis": "pc2-book.md:333、344",
    "problem": "brief和review渲染器的默认工具表仅含平台工具；个人模板中的read/edit/shell块在省略toolNames时被错误删除，违反所有工具存在的默认约定。",
    "fix": "缺省时递归收集当前模板全部工具块名称；显式工具表原样使用。同步prepared-execution.ts:115。"
  },
  {
    "id": "T-03",
    "class": "会出错",
    "file": "src/core/agent-runtime/context-rendering.ts",
    "line": 340,
    "basis": "pc2-book.md:394、473",
    "problem": "生产tracked.texts只有templates和strings，却被断言为ResolvedPromptPackV1；material.pack承诺的manifest、tools、origins、toolOrigins实际不存在。当前重渲染够用，但公开类型契约不真实。",
    "fix": "由lead把材料pack类型裁定收窄为PromptTextsV1，T删除强制类型断言，保持现有assembler输入位置。"
  },
  {
    "id": "T-04",
    "class": "会出错",
    "file": "src/contracts/continuation-brief.ts",
    "line": 589,
    "basis": "pc2-book.md:322；PROMPTS-SPEC.md:88；continuation-brief.ts:290、502",
    "problem": "容量后备路径按原始首尾估算，并有绕过模板的拼接。合法模板固定正文含16385个X时，无异常等附加部分的brief会从598返回超过16384字节的文本，应拒绝capacity。",
    "fix": "每个容量候选均以冻结模板和工具表实际渲染并计量；最小候选仍超限则抛ContinuationBriefCapacityError，删除原始首尾拼接后备路径。"
  },
  {
    "id": "T-05",
    "class": "违规",
    "file": "tests/runtime/PC2-T-render.test.ts",
    "line": 51,
    "basis": "pc2-book.md:852；run-pc2.md:67、72",
    "problem": "Skill清单与其实际工具块无交集，恒传空表仍过；brief样例无工具块且绕过renderContinuationBriefZh，漏传工具表也能通过。",
    "fix": "用独立手写含工具块的小Skill和brief，经两个专用helper测试同一清单下工具存在与不存在，整文比较字面期望。"
  },
  {
    "id": "T-06",
    "class": "违规",
    "file": "tests/runtime/PC2-T-render.test.ts",
    "line": 160,
    "basis": "pc2-book.md:418、861",
    "problem": "重渲染没有覆盖非零omitted、wholeOmitted/null ranges、另一合法顺序及全部中间段range；清零omitted、删除整段省略行或强制平台顺序会漏检。",
    "fix": "扩展现有样例，重渲染后整数组比较全部section字面；重渲染全省略样例，并让一个样例采用不同合法顺序。"
  },
  {
    "id": "T-07",
    "class": "违规",
    "file": "tests/runtime/S4C2-assembly.test.ts",
    "line": 358,
    "basis": "pc2-book.md:58、920",
    "problem": "notes截止标记改为空字符串后一直读取到EOF，general note错误放入reminders仍能通过原来验证notes归属的断言。",
    "fix": "恢复本用例的截止标记## Reminders。"
  },
  {
    "id": "T-08",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-tools.test.ts",
    "line": 57,
    "basis": "pc2-book.md:816、852",
    "problem": "必需的read+edit+shell准备到请求路径被纯renderer测试替代；冻结夹具Role与Host缺少可写配置，不能仅靠tools参数承载。",
    "fix": "Codex补显式可写夹具配置并由lead冻结，贯通Role workspace权限、Host writeScope和shell授权；保留默认行为，随后以read/write/shell权限走公开准备及请求并断言最终文案。"
  },
  {
    "id": "T-09",
    "class": "违规",
    "file": "tests/runtime/PC2-review-shrink.test.ts",
    "line": 39,
    "basis": "pc2-book.md:861；run-pc2.md:67",
    "problem": "实际K3 shrink用生产renderer和manifest生成期望，只弱检省略元数据，且未调用start，不能证明独立手算区间、提醒保留与入口通过。",
    "fix": "交Q及联合步骤以固定输入重写验收，手写缩减后全文、提醒、所有区间和计费字节，并调用公开入口。"
  },
  {
    "id": "T-10",
    "class": "违规",
    "file": "tests/contracts/PC-prompt-section-order.test.ts",
    "line": 12,
    "basis": "pc2-book.md:58、310、913",
    "problem": "裁定9强制更新Work投影期望，但施工书§5.3漏列该旧测试；实现变化合理，旧测试修改授权缺失。",
    "fix": "lead将该文件补入§5.3并明确归T，批准现有v2字面期望，不恢复旧顺序。"
  },
  {
    "id": "T-11",
    "class": "不整洁",
    "file": "src/core/agent-runtime/context-types.ts",
    "line": 45,
    "basis": "pc2-book.md:64；用户审计规则6",
    "problem": "新增生产注释含PC-2施工历史；相关brief/review注释仍称最后一段或尾缀，已与新顺序冲突。",
    "fix": "删除施工批次和组别叙述，保留规则与原因；同步context-work-recipe.ts:269、277、continuation-brief.ts:499及prepared-execution.ts:103、233，说明冻结顺序中的独立区间。"
  }
]
```

会出错 4，违规 6，不整洁 1，建议 0