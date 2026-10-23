只读核对完成，未修改文件、运行测试、构建或联网。下述 mutation 均为静态推演。

为缩短路径：`R/` 指 `src/core/agent-runtime/`，`B/` 指 `.lead-ref/base/`；“书”指 `.lead-ref/books/pc2-book.md`，“运行书”指 `.lead-ref/books/run-pc2.md`。

1. 问题表

| 编号 | 类别 | 位置（file:line） | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| Q-01 | **会出错** | `R/query-preparation.ts:290`；`R/query-execution.ts:308` | 裁定16，书:544、572、579、581 | Query 准备把 `allowsReadWholeWorkspace` 固定为 true，启动又用冻结名单反向证明它。输入：只选 `run_readonly_command`、Host 开启能力、授权 ready 但 `allowsRead('.')=false`。旧实际注册 `[]`；现在冻结和比较得到 `['run_readonly_command']`，实际注册仍是 `[]`，模型照常运行。实际门控见 `R/readonly-command-tool.ts:422`，旧路径见 `B/src/core/agent-runtime/query-execution.ts:410`。 | 准备和启动均传真实授权的 `allowsRead('.')`；初始拒绝时冻结 `[]`，准备后名单变化时按现有比较返回 `forbidden`。 |
| Q-02 | **会出错** | `R/execution-preparation.ts:533`；`R/query-preparation.ts:279` | 裁定16，书:558、562、566、579 | 准备把所有 owner 写成 true。输入：Work 选择 `record_note`，未绑定 notes.write/check。旧行为是准备 ready、启动 unsupported；裁定16要求准备即 unsupported，现在仍 ready，并冻结不存在的工具。纯函数已有正确拒绝，但调用方隐去了事实，见 `R/tool-group-assembly.ts:541`。 | 传真实 owner 布尔值；扩充 Work preparation 所需依赖类型。Query 已持有完整 Runtime 依赖。`applicationReceipt` 仍仅作增强。 |
| Q-03 | **会出错** | `R/query-preparation.ts:255` | §2规则1、裁定18，书:51、626 | `initial-planning-answer` 无条件被读为 used，却只在 initial Query 中使用；使用时又直接拼原文。① semantic Query 的未使用 guide 声明 `check`，本应 ready，却被声明检查拒绝。② initial Query 的 guide 含工具块时，本应按冻结名单展开，实际把 `{{#tool:…}}` 原样发出。跟踪见 `R/prompt-set-texts.ts:87`；槽值不会再次解析，见 `src/contracts/prompts/render-template.ts:267`。 | 得到 `toolNames` 后，仅在 `initial_coordination` 分支读取并调用 `renderTemplate(...,'initial-planning-answer',{},toolNames)`，再拼 question。 |
| Q-04 | **会出错** | `R/prompt-set-texts.ts:257` | 裁定20，书:700 | 缓存命中发生在预期内容类型检查之前。反例：模板正文是 `{"description":"X","parameters":{}}`，工具条目误引用该模板的 prompt-text ref。模板先缓存；工具读命中缓存，跳过 tool-text 类型校验，reader 返回 ready，本应拒绝。decoder 没有拦截这种 ref 类型，见 `src/contracts/prompts/prompt-set.ts:147`、`:161`。正常 store 不会生成此引用，但明定的读取校验缺失。 | 在缓存查询前检查 `ref.contentType === contentType`，不符返回 `invalid`；保留后续完整正文校验。`R/runtime.ts:659` 已采用正确顺序。 |
| Q-05 | **违规** | `R/context-history-facts.ts:82` | 裁定14，书:456；禁止为测试改变生产行为 | 把 owner 的 `invalid` 改成伪造的零边界，掩盖 S1 夹具的人工游标。更关键的是，启动仍直接返回该 invalid，因此“Run 从 current_turn 开始”的答复不实，见 `R/execution-driver.ts:771`、`R/query-execution.ts:592`。 | 删除这段转换，原样传播拒绝。由 lead 扩大旧 S1 夹具修正范围，让需要真实历史的场景产生真实 Kernel 终止记录并取得规范游标；不修改 `session-operations.ts` 的严格读法。 |
| Q-06 | **违规** | `tests/runtime/PC2-review-shrink.test.ts:39` | PC-21，书:861；运行书:67、72 | 从实际 manifest 调生产 renderer 生成期望；其余检查主要是自洽和上限，没有手算范围、完整尾部提醒或真实 shrink 入场。删掉 review 后提醒并同步缩短 input 的 mutation 可以漏过。 | 用完整字面文本和手算范围、计费量、省略信息替换派生期望，并调用现有 `fixture.start()` 验证 shrink 后真实入场。 |
| Q-07 | **违规** | `tests/runtime/PC2-joint-history.test.ts:93`、`:111`、`:128` | PC-18，书:842 | 同 Session 用例没有启动 continuation；Query 只测空边界；K3 只测空 seed。非空 LA-1、Query history、带 basis 不读边界及启动接线未获得要求的公开链验收。纯函数表不能补位。 | lead 修复冻结 Query-history 夹具的拦截对象，并补齐公开准备→启动用例，核对非空历史、提醒、冻结值与边界读取次数。具体夹具修法见下文。 |
| Q-08 | **违规** | `tests/runtime/PC2-joint-tools.test.ts:145` | PC-26，书:904、908 | Query 准备后直接启动，没有改包；Q 的独立冻结测试只有 Work。Query 启动重新读取当前包的 mutation 可以漏过。 | 保留 Query 的 source，准备后替换工具正文，再启动并断言仍发送旧字面正文，同时读取 Query prompt record。 |
| Q-09 | **违规** | `tests/runtime/PC2-joint-tools.test.ts:127` | PC-26，书:910；运行书:72 | `toolSpecsRef` 正文只检查两个子串。其他工具、参数、顺序或额外内容改变仍可能通过。独立 tool-text body 的全文断言不是这份 specs body 的替代。 | 手写完整预期 specs JSON，全文比较 `toolSpecsRef` 正文。 |
| Q-10 | **违规** | `tests/runtime/PC2-declaration-prepare.test.ts:11`；`.lead-ref/replies/pc2-reply.md:7` | 裁定4、PE8，书:169、185 | 把 `openPC2ReviewFixture('empty')` 返回 required-slot-empty→invalid 当作“不可用”，漏掉明确要求的负例。夹具会正常返回 rejected preparation，见 `tests/helpers/PC2-pack-fixture.ts:357`。 | 直接增加 `'empty'` 用例，断言 `invalid`，原因包含包、`unknown-call-review`、`writtenLines`；无需修改夹具。 |
| Q-11 | **不整洁** | `R/context-history-facts.ts:21`、`:52`；`R/execution-preparation.ts:501`；`R/observed-model-run.ts:103`；`R/prompt-set-texts.ts:104`；`R/runtime.ts:686` | §2规则6，书:66；本次注释要求 | 新注释保留 `PC-2`、施工组 `Q` 等施工标记。另有“失败绝不变零边界”与实现矛盾，见 `R/context-history-facts.ts:54`、`:82`。 | 删除施工前缀，把组名换成实际职责，保留规则及原因；随 Q-05 修复矛盾说明。 |

2. 逐裁定、逐行结论

- **裁定13，Q 的调用：OK。** 每个 manifest 候选调用整份重渲染，最终替换 input、sections、总量和 digest，没有 prefix cut；原两阶段收缩循环未改。`R/execution-preparation.ts:126`、`:657`、`:686`、`:697`。验收缺口为 **Q-06**。
- **裁定14：Q-05、Q-07。** 纯规则优先级正确；Work 和无 basis Query 各读一次，带 basis Query 不读；recipe 返回的决定直接冻结；启动对冻结 false 强制 current_turn。`R/context-history-facts.ts:26`；`R/execution-preparation.ts:548`、`:629`；`R/query-preparation.ts:303`、`:332`；`R/execution-driver.ts:779`；`R/query-execution.ts:583`。
- **裁定16：Q-01、Q-02。** 函数本体的字段、独立 source 条件、顺序、review/rerun 条件及严格数组比较正确；调用方事实不准确。`R/tool-group-assembly.ts:465`、`:494`、`:545`、`:566`；`R/execution-driver.ts:573`；`R/query-execution.ts:311`。
- **裁定18：Q-03。** 声明检查读 supplying origin，错误包含模板和工具；问题在 Query 错误标记 used。`R/prompt-set-texts.ts:118`。
- **裁定19：OK。** 仅收集冻结名单中有正文的工具，使用 `toolOrigins`，规范化存储、按名称排序，进入 manifest 和完整大小测量，put 失败 unavailable。`R/execution-preparation.ts:605`、`:648`；`R/query-preparation.ts:352`；`R/prompt-set-texts.ts:219`。
- **裁定20：Q-04。** 工厂传递链完整，未发现遗漏冻结文本的路由：Work `R/execution-driver.ts:518`、`:641`、`:666`、`:691`、`:999`、`:1077`；Query `R/query-execution.ts:235`、`:356`、`:459`、`:636`；探索 `R/observed-model-run.ts:434`；记录读取 `R/runtime.ts:687`。
- **裁定4，准备错误映射：实现 OK，PE8 为 Q-10。** Work、Query 的 assembly catch 把 `PromptRenderError` 映射 invalid，其他错误保留原处理。`R/prompt-set-texts.ts:107`；`R/execution-preparation.ts:568`；`R/query-preparation.ts:323`。
- **§4，Q 所有权及范围：Q-05、Q-11。** 其余提供的 Q 差异属于所列职责；Q 文件清单没有四个冻结夹具。`.lead-ref/parts/Q-files.txt:1`；书:766。
- **PC-18：Q-07。**
- **PC-19：Q-03；现有 Work/base 负例合格。** `tests/runtime/PC2-declaration-prepare.test.ts:21`。
- **PC-21，shrink：Q-06。**
- **PC-26：Q-08、Q-09。**
- **PE8：Q-10。**
- **§5.3，Q 已改旧测试：OK。** 所见修改为必填字段、v2 字面及尾部假设调整，没有发现额外放松。`.lead-ref/parts/Q.diff:1561`、`:1574`、`:1614`、`:1644`、`:1668`、`:1684`、`:1706`、`:1720`。

收缩候选手算：采用 `PC2-joint-shrink-entry.test.ts:72` 的字面材料，保留 F/N/M，I 仅留省略行。加入 `REVIEW` 后，区间应为 role `[5,8)`、F `[10,13)`、N `[15,18)`、I `[20,52)`、review `[54,60)`、M `[62,65)`，总长 **65**，`residentBytes` 仍为 **49**。Q 的 measure 使用这一整份 input 和重算 sections 构造 manifest；没有重新选择预算。`R/execution-preparation.ts:689`；`tests/runtime/PC2-joint-shrink-entry.test.ts:94`。

四个新测试各自会漏过的 mutation：

| 文件 | 会漏过的 mutation |
|---|---|
| `PC2-history-decision-pure.test.ts:41` | 有 basis 的 Query preparation 仍读取 completed boundary。 |
| `PC2-declaration-prepare.test.ts:21` | 删除 Query preparation 的声明检查。 |
| `PC2-review-shrink.test.ts:39` | 截掉 review 后提醒，并同步更新 input 总长。 |
| `PC2-tool-texts-freeze.test.ts:30` | Query start 从当前包重新读取工具正文。 |

3. DSH 自述核对及需要 lead 裁定的旧测试

- **§1.2，“未知授权提前拒绝”：成立。** `requeue_task`、`reverify_round` 不在旧 Runtime 注册名单，旧 `selectWorkToolGroup` 已拒绝它们，见 `B/src/core/agent-runtime/tool-group-assembly.ts:196`。生产 Workflow 通过 system automation actor 直接调用 owner，见 `src/business/workflow/workflow.ts:2513`、`:2525`；不是靠这两个 Runtime 工具运行。**未发现旧版能成功注册并启动、现在被准备阶段阻断的生产路径。**
- **§1.2，把五类测试都说成“prepare ready、start rejected”：不成立。** 仅 C2 GAP-46 如此；其余测试包含 owner 成功、重放、竞态或通知断言，见下表。
- **§8.4，“准备冻结 capability owners，启动核实际 owners”：不成立，Q-02。** 裁定要求注册事实，没有授权把最终名单改成能力愿望表。书:526、558、579。
- **§8.4，“Query 只读门控按冻结 capability 判断”：不成立，Q-01。** 会产生冻结名单与实际注册不一致。
- **§8.4，`2f9a826` 的 Query graph 家族：成立。** 旧 Query 就只构造 graph coordination；旧 `query-execution.ts:277` 与当前 `R/query-execution.ts:322` 都按 `GRAPH_TOOL_NAMES` 过滤，顺序仍是 `look_graph`、`find_graph`，没有进一步收窄。
- **§8.4，`af84802` 的“不能解码即 current_turn 启动”：不成立，Q-05。** 输入 `historyCursor='fx3-completed-…'`，旧启动返回 invalid，当前启动仍返回 invalid；均未把它传给 Kernel。`B/src/core/agent-runtime/execution-driver.ts:715`、`:719`；`R/execution-driver.ts:767`、`:771`。人工值来自 `tests/helpers/S1-workflow-archive-fixture.ts:360`、`S1-session-facts-fixture.ts:262`；真实 observation 使用规范历史条目的 cursor，见 `R/execution-observation.ts:733`、`:753`。因此不能声称已证明真实 Session 丢失历史；能证明的是准备阶段伪造边界及答复不实。
- **§1.3／§8.5，Query-history 夹具捕不到 start：成立。** 夹具暴露原 port，composition 已浅拷贝给 Workflow，事后 spy 原对象无效。`tests/helpers/PC-platform-fixture.ts:460`；`src/composition/create-platform.ts:1511`、`:1774`；`tests/helpers/PC2-pack-fixture.ts:415`。
- **§1.3／§8.5，empty 夹具不可用：不成立，Q-10。** 空 `writtenLines` 正是要求的 required-slot-empty 负例。`src/contracts/prompts/slot-tables.ts:54`；`src/contracts/core/prepared-execution.ts:136`。
- **§8.5，LA-1 非空 seed 未覆盖：成立，Q-07。** 现有 continuation helper 固定复用原 Session，见 `tests/helpers/PC-platform-fixture.ts:478`。
- **§1.1，旧 Skill 测试仍取模板原文：成立。** `C2-runtime-platform-tools.test.ts:65`、`AG6-agent-assembly.test.ts:57` 仍取未渲染模板。它们需要按 v2 冻结工具表更新字面期望，不能撤销 Skill 渲染；书:640。
- **§5 的函数输入清单：类型声明成立，实际传值不成立，Q-01、Q-02。** `R/tool-group-assembly.ts:465`。
- **§3 的 Q 行全部已达到验收要求：不成立，Q-06～Q-10。** `.lead-ref/replies/pc2-reply.md:21`。

Query-history 的最小夹具修法：仅修改冻结的 `PC2-pack-fixture.ts`，构造 `openPCWorkFixture` 时包装 `createWorkflow` 工厂，保存实际传入的 `deps.runtime`，仍调用原工厂，构造后恢复包装；然后在该实际对象的 `startQuery` 上安装现有 capture/busy spy，`actualStart` 也从同一对象绑定。改 spy 原 port 的 `prepareQuery` 同样无效，因为它也已被浅拷贝。上述修改需由 lead 审核并重新冻结；无需改生产 composition。`src/composition/create-platform.ts:1497`、`:1511`、`:1774`。

| 旧测试文件 | 实际断言 | 应裁定的精确变化 |
|---|---|---|
| `tests/runtime/C2-runtime-platform-tools.test.ts:239` | prepare ready；start unsupported；reason 包含两个未知名；provider、source authorization 均为 0。 | 将 unsupported 和 reason 断言移到 prepare，删除随后的 start；保留两个零调用断言及“不含 inbox”断言。lead 将该迁移纳入允许清单。 |
| `tests/state/invariants-fuzz.test.ts:69`、`:93` | 指定 seeds 测 owner 成功、权限边界和竞态；明确绕 Runtime start，见 `tests/scenarios/support/fuzz.ts:2084`、`:2324`。 | **保留 seeds 和业务断言。** 只迁移 owner 测试的准备夹具，不改成准备拒绝。 |
| `tests/work-graph/A2-requeue-service.test.ts:195` | Agent running、预算拒绝、异 Goal/Host 拒绝、合法 requeue 和重放 committed。 | **保留全部断言。** 迁移 `:120` 使用的 owner 准备夹具。 |
| `tests/work-graph/R3e-reverify.test.ts:719` | 合法 successor committed、事件及重放、结束竞态 revision_conflict、结束后 forbidden。 | **保留全部断言。** 迁移 `:684` 使用的 owner 准备夹具。 |
| `tests/work-graph/S5-notices.test.ts:139` | NR01 验 system/agent requeue、reverify 的三条通知。 | **保留三通知断言。** 迁移 `tests/helpers/S5-queue-support.ts:339` 的 controller 准备设置。 |

后四项的共同断点是 `B2-execution-fixture.ts:229` → `task-claim-fixture.ts:596`，现在必经 Runtime 的未知名拒绝。不能简单删掉 grant，因为 owner admission 正要检查 manifest 的 `requeue_task` 授权，见 `src/core/work-graph/tasks/requeue-service.ts:839`。建议 lead 裁定一个**仅供既有 owner 测试使用的准备夹具例外**：直接为正式 entry 提供 owner 授权包，不调用 Runtime start；原业务断言原样保留。不要新增生产工具或放宽裁定16来修这些测试。

4. 同一问题表的 JSON

```json
[
  {
    "id": "Q-01",
    "class": "会出错",
    "file": "src/core/agent-runtime/query-preparation.ts",
    "line": 290,
    "basis": ".lead-ref/books/pc2-book.md:544,572,579,581；裁定16",
    "problem": "Query 将整个工作区可读固定为 true，启动又用冻结名单自证。Host 开启只读命令但 allowsRead('.') 为 false 时，冻结名单含 run_readonly_command，实际注册为空；旧注册也为空。",
    "fix": "准备和启动均传真实授权的 allowsRead('.')；初始拒绝时冻结空名单，准备后名单变化时返回 forbidden。"
  },
  {
    "id": "Q-02",
    "class": "会出错",
    "file": "src/core/agent-runtime/execution-preparation.ts",
    "line": 533,
    "basis": ".lead-ref/books/pc2-book.md:558,562,566,579；裁定16",
    "problem": "Work 和 Query 准备均将所有 owner 写成 true。选择 record_note 但缺少 notes.write/check 时，按裁定应准备 unsupported，实际仍 ready 并冻结该工具，直到启动才拒绝。",
    "fix": "准备阶段传真实 owner 布尔值，扩充 Work 所需依赖类型；applicationReceipt 保持可选增强。"
  },
  {
    "id": "Q-03",
    "class": "会出错",
    "file": "src/core/agent-runtime/query-preparation.ts",
    "line": 255,
    "basis": ".lead-ref/books/pc2-book.md:51,626；§2规则1、裁定18",
    "problem": "initial-planning-answer 被无条件记为 used，导致 semantic Query 被未使用模板的声明拒绝；initial Query 又直接拼模板原文，工具块不会按冻结名单展开。",
    "fix": "得到最终 toolNames 后，仅在 initial_coordination 分支读取并通过 renderTemplate 渲染 guide，再拼 question。"
  },
  {
    "id": "Q-04",
    "class": "会出错",
    "file": "src/core/agent-runtime/prompt-set-texts.ts",
    "line": 257,
    "basis": ".lead-ref/books/pc2-book.md:700；裁定20",
    "problem": "readPromptTexts 在预期内容类型校验前返回缓存。工具引用此前缓存的 prompt-text ref，且正文是合法 ToolText JSON 时，错误类型被接受为 ready；要求是拒绝。",
    "fix": "在缓存查询前校验 ref.contentType 与预期类型一致，不符返回 invalid，并保留后续正文校验。"
  },
  {
    "id": "Q-05",
    "class": "违规",
    "file": "src/core/agent-runtime/context-history-facts.ts",
    "line": 82,
    "basis": ".lead-ref/books/pc2-book.md:456；裁定14、禁止测试专用生产路径",
    "problem": "将无效历史游标转换成伪造零边界以容纳 S1 人工游标；启动仍返回 invalid，答复声称会 current_turn 启动不成立。未证明真实生产历史因此丢失。",
    "fix": "删除 invalid 到零边界的转换并传播原拒绝；由 lead 扩大 S1 夹具修正范围，以真实 Kernel 终止历史产生规范游标，不放宽 session-operations。"
  },
  {
    "id": "Q-06",
    "class": "违规",
    "file": "tests/runtime/PC2-review-shrink.test.ts",
    "line": 39,
    "basis": ".lead-ref/books/pc2-book.md:861；.lead-ref/books/run-pc2.md:67,72；PC-21",
    "problem": "从实际 manifest 调生产 renderer 生成期望，没有独立手算范围、完整尾部提醒或真实 shrink 入场；截掉尾部并同步缩短输入的 mutation 可漏过。",
    "fix": "改为完整字面文本和手算范围、计费量、省略信息，并调用 fixture.start 验证 shrink 后真实入场。"
  },
  {
    "id": "Q-07",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-history.test.ts",
    "line": 93,
    "basis": ".lead-ref/books/pc2-book.md:842；PC-18",
    "problem": "continuation 未启动，Query 仅空边界，K3 仅空 seed；非空 LA-1、Query history、basis 不读边界和启动接线缺少公开链验收。",
    "fix": "lead 修复冻结 Query-history 夹具，使其拦截 Workflow 实际持有的 runtime，再补公开准备和启动用例，验证非空历史、提醒、冻结值及边界读取次数。"
  },
  {
    "id": "Q-08",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-tools.test.ts",
    "line": 145,
    "basis": ".lead-ref/books/pc2-book.md:904,908；PC-26",
    "problem": "Query 准备后没有改包；Query start 重读当前包工具文本的 mutation 可以漏过。",
    "fix": "保留 Query source，在准备后替换工具正文，再启动并验证旧字面正文及 Query prompt record。"
  },
  {
    "id": "Q-09",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-tools.test.ts",
    "line": 127,
    "basis": ".lead-ref/books/pc2-book.md:910；.lead-ref/books/run-pc2.md:72；PC-26",
    "problem": "toolSpecsRef 正文仅检查两个子串，其他工具、参数、顺序或额外内容改变仍可能通过。",
    "fix": "手写完整预期 specs JSON，全文比较 toolSpecsRef 正文。"
  },
  {
    "id": "Q-10",
    "class": "违规",
    "file": "tests/runtime/PC2-declaration-prepare.test.ts",
    "line": 11,
    "basis": ".lead-ref/books/pc2-book.md:169,185；裁定4、PE8",
    "problem": "遗漏 required-slot-empty 的公开准备负例，并误将 empty 夹具返回 invalid 视为不可用；该夹具会正常返回 rejected preparation。",
    "fix": "使用现有 openPC2ReviewFixture('empty')，断言 invalid 及包、unknown-call-review、writtenLines，无需改夹具。"
  },
  {
    "id": "Q-11",
    "class": "不整洁",
    "file": "src/core/agent-runtime/context-history-facts.ts",
    "line": 21,
    "basis": ".lead-ref/books/pc2-book.md:66；本次生产注释要求",
    "problem": "新增生产注释保留 PC-2、施工组 Q 等施工标记；另有失败绝不变零边界的说明与实现矛盾。",
    "fix": "删除施工前缀，以实际职责替换组名，保留规则与原因，并随 Q-05 修复矛盾说明。"
  }
]
```

会出错 4，违规 6，不整洁 1，建议 0