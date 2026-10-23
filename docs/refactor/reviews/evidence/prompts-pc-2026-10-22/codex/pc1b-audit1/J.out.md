本次只读审查，没有运行测试、构建或网络操作。确认 9 项问题；其中 J-09 是核对 DSH 回复时发现的关联 S 组问题。没有把测试覆盖不足判作已发生的产品行为错误。

**发现表**

| 编号 | 类别 | 位置 | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| J-01 | 违规 | `tests/runtime/PC-joint-prepare-freeze.test.ts:25`、`tests/runtime/PC-joint-prepare-freeze.test.ts:32`、`tests/runtime/PC-joint-prepare-freeze.test.ts:66` | `.lead-ref/books/pc1-book.md:678`；规格 `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md:427` | PC-06 只检查 system 前缀、input 包含 prelude、不含修改后的 Skill；没有证明原 Skill 仍在，也没有比较完整 system/input。改的是 prelude，不是规格指定的段标签。摘要只核对 base，未核对 Skill、模板和字符串表。把发送端 `skills` 改成空数组，此行仍可通过。 | 在 Work、Query 两例中修改真正的段标签；以手写文本构造完整 system/input 期望，正向断言原 Skill，并逐项核对冻结文本及其手算摘要。 |
| J-02 | 违规 | `tests/runtime/PC-joint-prepare-freeze.test.ts:19`、`tests/runtime/PC-joint-prepare-freeze.test.ts:53` | `.lead-ref/books/pc1-book.md:681`、`.lead-ref/books/pc1-book.md:390` | 联合 PC-06 没有进入 continuation/review。P 组虽有入口测试，但只换模板，没换参与入口重渲染的字符串表（`tests/work-graph/PC-entry-frozen-continuation.test.ts:42`、`tests/work-graph/PC-entry-frozen-review.test.ts:42`）。因此，把入口读回的 strings 换成平台默认表，仍可能通过现有这些测试。 | 用冻结夹具补齐 continuation、K3 review 两个联合场景：准备前注入不同的相关字符串，准备后再修改包和 Skill，验证入口成功且模型收到手写的冻结内容。 |
| J-03 | 违规 | `tests/runtime/PC-joint-freeze-and-pin.test.ts:28`、`tests/runtime/PC-joint-freeze-and-pin.test.ts:35` | `.lead-ref/books/pc1-book.md:684` | PC-07 未证明恢复后产生了新请求；`.at(-1)` 可以仍是第一次请求，比较变成自身相等。把恢复分支改成仅返回 observation，此行仍可通过；对应生产分支在 `src/core/agent-runtime/execution-driver.ts:421`。此外，暂停阶段异常被吞掉。 | 断言公开观察结果已经暂停，正常等待首次执行结束；恢复后断言请求数增加、请求身份不同，再比较两次 system 的字节。 |
| J-04 | 违规 | `tests/runtime/PC-joint-freeze-and-pin.test.ts:51`、`tests/runtime/PC-joint-freeze-and-pin.test.ts:59` | `.lead-ref/books/pc1-book.md:627`、`.lead-ref/books/pc1-book.md:689` | PC-08 的 system 期望来自 `preparedTexts()`，它调用生产 `readPromptTexts`（`tests/helpers/PC-platform-fixture.ts:416`）。驱动也用同一读取函数（`src/core/agent-runtime/execution-driver.ts:656`）。例如该函数给返回的 base 统一追加错误文本，准备读取和发送会一起错，此断言仍通过。 | 准备前注入字面 base/Skill、关闭额外 Host 指令，手写旧绑定的完整 system 期望；安装新绑定后直接与该字面期望比较，不从生产读取结果生成期望。 |
| J-05 | 违规 | `tests/runtime/PC-joint-record-and-failure.test.ts:67`、`tests/runtime/PC-joint-record-and-failure.test.ts:116` | `.lead-ref/books/pc1-book.md:693`、`.lead-ref/books/pc1-book.md:697` | Work 对 toolsDigest 只检查类型；Query 完全不检查 toolsDigest，也不检查第二条 systemDigest。遍历 `texts` 算哈希没有建立 toolsDigest 与工具正文的关系。把读口第二条 toolsDigest 改成任意 64 位十六进制串，两例仍通过；Query 第二条 systemDigest 同样可错。 | 对两种执行的每一条记录，都核对手工重建 system 的摘要，以及工具正文、toolsDigest、toolSpecsRef.digest 的一致性；明确断言所引用正文存在。 |
| J-06 | 违规 | `.lead-ref/replies/pc1b-reply.md:105` | `.lead-ref/books/pc1-book.md:655`、`.lead-ref/books/pc1-book.md:593` | PC-15 平台行及 base 对照均未完成。纯 ModelBudget 测试不经过 `runObservedModel` 的最终请求转换，不能替代这行；它直接构造 meter（`tests/runtime/PC-model-budget-preview.test.ts:45`）。阻塞如实上报符合施工规则，但验收项仍缺失。 | 由 lead 裁定并补冻夹具的 responseFormat 注入口，随后补完整平台用例和同输入的 base 对照。保留真实 preview、删除和 meter 链路；不要为测试新增生产 Host 配置分支。具体构造见下文。 |
| J-07 | 违规 | `tests/architecture/production-reach-allowlist.json:1277`、`tests/architecture/production-reach-allowlist.json:1301`、`tests/architecture/production-reach-allowlist.json:1319` | `tests/architecture/production-reach.test.ts:12`、`tests/architecture/production-reach.test.ts:19` | 八个常量节点被以 wire-format 保留，但生产渲染已不消费它们；七个导出只剩测试消费者，另一个是服务这些导出的私有常量。它们不是持久化或传输格式。 | lead 放行对应旧测试的等价迁移：把期望改为测试内字面量，删除七个无生产用途的导出、私有 DEFAULT_BRIEF_TEXTS 和八条豁免。不能添加虚假生产引用来满足 reach。 |
| J-08 | 违规 | `tests/architecture/production-reach-allowlist.json:1343`、`tests/architecture/production-reach-allowlist.json:1349`、`tests/architecture/production-reach-allowlist.json:1373` | `tests/architecture/production-reach.test.ts:12`、`tests/architecture/production-reach.test.ts:14` | 两个操作成员和五个实现 helper 被归为 wire-format。它们实际是等待读口消费者的操作链，不是序列化格式。说明中的“walker 不跟类型/可选成员”也不成立：walker 明确跟踪类型引用和被读取的成员（`tests/architecture/production-reach.ts:33`、`tests/architecture/production-reach.ts:50`）。 | 将这七项改为 kept-for，按检查接受的格式明确写出编排分片及 E3 读口消费者；三项 DTO 保留 wire-format，并修正各自 reader 说明。 |
| J-09 | 违规 | `src/core/agent-runtime/execution-driver.ts:121`、`src/core/agent-runtime/query-execution.ts:100` | `.lead-ref/books/pc1-book.md:299`、`.lead-ref/books/pc1-book.md:382` | **关联 S。** 缺少 selection 时直接返回 true，跳过全部五字段比较；DSH 明说这是为旧测试模型保留的例外（`.lead-ref/replies/pc1b-reply.md:51`）。任务书已规定缺 selection 的统一回退，未允许跳过核对。 | 删除两处早退，统一经 promptSelectionOf 比较五字段；旧夹具身份冲突交 lead 裁定测试输入修正，不在生产代码豁免测试模型。 |

**allowlist 逐项核对**

实际是 **3 个类型、2 个操作成员、5 个私有 helper、8 个常量**，不是回复所说的“9 个类型/可选成员”。三个 `PromptRecord*` 身份仍留在表里，只是从 kept-for 改成 wire-format；可对照 `.lead-ref/base/tests/architecture/production-reach-allowlist.json:1319` 与 `tests/architecture/production-reach-allowlist.json:1325`。

| 新条目及位置 | 真实使用与导出判断 | 分类结论 |
|---|---|---|
| DEFAULT_BRIEF_TEXTS，`tests/architecture/production-reach-allowlist.json:1278` | 私有；只供下述三个兼容导出使用，`src/contracts/continuation-brief.ts:463`、`src/contracts/continuation-brief.ts:470`、`src/contracts/continuation-brief.ts:479`。 | 删除，J-07。 |
| REWORK_FAILURE_CLASS_LABELS_ZH，`tests/architecture/production-reach-allowlist.json:1284` | 已导出；消费者是旧测试，`tests/contracts/A2-rework-contract-helpers.test.ts:491`。 | 删除生产导出，J-07。 |
| REWORK_ACTOR_CLASS_LABELS_ZH，`tests/architecture/production-reach-allowlist.json:1290` | 已导出；消费者是旧测试，`tests/contracts/A2-rework-contract-helpers.test.ts:493`。 | 删除生产导出，J-07。 |
| CONTINUATION_STANDING_INSTRUCTIONS_ZH_V1，`tests/architecture/production-reach-allowlist.json:1296` | 已导出；测试消费见 `tests/contracts/A2-rework-contract-helpers.test.ts:388`、`tests/scenarios/A1-rework-same-session.test.ts:208`。 | 删除生产导出，J-07。 |
| CONTEXT_SECTION_HEADERS，`tests/architecture/production-reach-allowlist.json:1302` | `src/core/agent-runtime/context-assembler.ts:16` 只是重导出；测试消费见 `tests/runtime/S3-context-assembler.test.ts:761`。 | 删除生产导出，J-07。 |
| WORK_CONTEXT_PRELUDE，`tests/architecture/production-reach-allowlist.json:1308` | 已导出；生产配方改用函数，旧常量用于测试期望，`src/core/agent-runtime/context-rendering.ts:45`、`tests/runtime/S3-context-assembler.test.ts:459`。 | 删除生产导出，J-07。 |
| QUERY_CONTEXT_PRELUDE，`tests/architecture/production-reach-allowlist.json:1314` | 已导出；对应动态函数及测试消费者见 `src/core/agent-runtime/context-rendering.ts:46`、`tests/runtime/S3-context-assembler.test.ts:853`。 | 删除生产导出，J-07。 |
| INITIAL_COORDINATION_RESPONSE_GUIDE，`tests/architecture/production-reach-allowlist.json:1320` | 导出在 `src/core/agent-runtime/query-preparation.ts:59`；生产改读 tracked template，见同文件 `:262`；旧导出由 `tests/work-graph/R5b-initial-plan.test.ts:271` 消费。 | 删除生产导出，J-07。 |
| PromptRecordRequestV1，`tests/architecture/production-reach-allowlist.json:1326` | 公共结果元素类型，生产实现使用于 `src/core/agent-runtime/runtime.ts:631`；定义在 `src/contracts/prompts/prompt-set.ts:56`。 | wire-format 合理，应导出。 |
| PromptRecordReadResultV1，`tests/architecture/production-reach-allowlist.json:1332` | 完整结果类型，不是注释所说的“request element”；定义在 `src/contracts/prompts/prompt-set.ts:60`。 | wire-format 合理，应导出；修说明。 |
| PromptRecordReadV1，`tests/architecture/production-reach-allowlist.json:1338` | ReadResult 包装类型，定义在 `src/contracts/prompts/prompt-set.ts:68`，公开端口使用于 `src/core/agent-runtime/ports.ts:89`。 | wire-format 合理，应导出；修说明。 |
| RuntimeExecutionPort.readPromptRecord，`tests/architecture/production-reach-allowlist.json:1344` | 按书必须发布，实际发布在 `src/core/agent-runtime/runtime.ts:885`；E3 才加路由，书 `:531`。 | 保留公共成员，改 kept-for，J-08。 |
| messageOf，`tests/architecture/production-reach-allowlist.json:1350` | 私有，定义及调用在 `src/core/agent-runtime/runtime.ts:60`、`src/core/agent-runtime/runtime.ts:90`。 | 保持私有，改 kept-for，J-08。 |
| rejected，`tests/architecture/production-reach-allowlist.json:1356` | 私有，定义及调用在 `src/core/agent-runtime/runtime.ts:61`、`src/core/agent-runtime/runtime.ts:86`。 | 保持私有，改 kept-for，J-08。 |
| sameQueryRunRef，`tests/architecture/production-reach-allowlist.json:1362` | 私有，定义及调用在 `src/core/agent-runtime/runtime.ts:65`、`src/core/agent-runtime/runtime.ts:101`。 | 保持私有，改 kept-for，J-08。 |
| readQueryPromptSet，`tests/architecture/production-reach-allowlist.json:1368` | 私有，定义及调用在 `src/core/agent-runtime/runtime.ts:79`、`src/core/agent-runtime/runtime.ts:713`。 | 保持私有，改 kept-for，J-08。 |
| ModelRequestReadPort.listRunModelRequests，`tests/architecture/production-reach-allowlist.json:1374` | 是必须的独立读端口，定义在 `src/core/work-graph/tasks/model-call-contracts.ts:48`，由读记录实现调用，`src/core/agent-runtime/runtime.ts:684`。 | 保留公共成员，改 kept-for，J-08。 |
| completeRunRef，`tests/architecture/production-reach-allowlist.json:1380` | 私有，定义及调用在 `src/core/work-graph/tasks/model-call-service.ts:93`、`src/core/work-graph/tasks/model-call-service.ts:379`。 | 保持私有，改 kept-for，J-08。 |

没有发现“helper 为入表而导出”的情况；上述五个 helper 均为私有。也未发现本次增量中另外能证明的“未达且漏列”生产声明；例如新正文接口与校验函数已有生产调用，见 `src/core/agent-runtime/execution-preparation.ts:424`、`src/core/work-graph/tasks/execution-entry-service.ts:1024`、`src/core/work-graph/queries/query-execution.ts:1310`。这不是运行 reach 检查后的全仓通过结论。

**PC-15 应如何补**

“大历史必须来自大工具文件”这个前提不成立。脚本模型允许长 `text` 与 tool call 同时出现，也允许下一次 `beforeReply` 抛错（`tests/helpers/PC-kernel-fixture.ts:36`、`tests/helpers/PC-kernel-fixture.ts:56`、`tests/helpers/PC-kernel-fixture.ts:63`）。可以先生成长 assistant 文本和一次真实 read 的完整交换，再以受控错误结束，沿公开 continuation 进入下一 Run；P 组已经使用崩溃后 continuation 的路径（`tests/work-graph/PC-entry-frozen-continuation.test.ts:31`、`tests/work-graph/PC-entry-frozen-continuation.test.ts:41`）。这是静态可行的构造方向，本审查没有运行它。

真正缺的是 responseFormat 注入口：冻结 `PCBinding` 只有 model、selection、skills、systemInstruction、budget、counter（`tests/helpers/PC-platform-fixture.ts:55`），生产中的该参数只在 `ObservedModelRunOptions`（`src/core/agent-runtime/observed-model-run.ts:86`）。lead 应补冻测试输入边界，再以长 Host 指令、上述真实历史及手算紧窗口，验证删除后成功；不能手写历史记录或凭此增加仅服务测试的生产配置。

缺行确实留下其他测试没有覆盖的规则：把 `src/core/agent-runtime/observed-model-run.ts:390` 改为直接 `meter.preview(request)`，发送时仍在同文件 `:350` 补 responseFormat，便会重现“选择时能放下、meter 拒绝最终请求”。现有纯 meter 用例直接调用 preview/wrap（`tests/runtime/PC-model-budget-preview.test.ts:45`、`tests/runtime/PC-model-budget-preview.test.ts:63`），不会检验这条接线；已有联合用例也没有该参数。

**逐裁定、逐行**

以下裁定结论限于 J 的联合验收范围。

- 裁定 13（allowlist 收口）：J-07、J-08。
- 裁定 14、15（冻结内容）：J-01。
- 裁定 16（启动核对与 pin）：J-04、J-09。
- 裁定 17（入口重渲染）：J-02。
- 裁定 20：J-06。
- 裁定 21：J-06；纯账户的 956/900 算例已有字面断言，`tests/runtime/PC-model-budget-preview.test.ts:43`。
- 裁定 22（冻结输入送入 Kernel）：J-01、J-03。
- 裁定 24（逐请求事实）：J-05。
- 裁定 25（PC-10 所列失败行为）：OK，`tests/runtime/PC-joint-record-and-failure.test.ts:134`。
- 裁定 26（联合行的顺序、重放）：OK，`tests/runtime/PC-joint-record-and-failure.test.ts:65`、`tests/runtime/PC-joint-record-and-failure.test.ts:83`。
- 裁定 27（联合行的 cap、重放）：OK，`tests/runtime/PC-joint-record-and-failure.test.ts:112`、`tests/runtime/PC-joint-record-and-failure.test.ts:122`。
- 裁定 28（联合行的顺序读）：OK，`tests/runtime/PC-joint-record-and-failure.test.ts:65`。
- 裁定 29（联合行的正文与摘要）：J-05。
- PC-06：J-01、J-02。
- PC-07：J-03。
- PC-08：J-04。第二次 resolve 换 pack 的拒绝分支已由 S 组覆盖，不能报缺失：`tests/runtime/PC-send-start-check.test.ts:58`；J 的 registry 用例在 `tests/runtime/PC-joint-freeze-and-pin.test.ts:43`。
- PC-09：J-05。手写 section 的格式与排序正确，对应 `tests/runtime/PC-joint-record-and-failure.test.ts:21` 和 `vendor/coding-agent/dist/core/context/builder/context-builder.js:20`；两种重放都保留原命令身份，夹具见 `tests/helpers/PC-platform-fixture.ts:232`。
- PC-10：OK。失败包装确实只匹配指定 contentType，`tests/helpers/PC-platform-fixture.ts:183`；准备成功由夹具的 ready 检查保证，`tests/helpers/PC-platform-fixture.ts:428`、`tests/helpers/PC-platform-fixture.ts:529`。它会漏掉“先 reservation，再发现正文失败”的变异；行本身没有断言预约/授权次数，不能把它声称为裁定 25 全部副作用顺序的证明。
- PC-15 平台行：J-06。

J 的四个文件均在白名单范围内，未修改旧测试或生产行为（`.lead-ref/parts/J-files.txt:1`、`.lead-ref/books/pc1b-whitelist.txt:11`）。联合测试没有直接读数据库；其状态入口见 `tests/helpers/PC-platform-fixture.ts:398`、`tests/helpers/PC-platform-fixture.ts:427`、`tests/helpers/PC-platform-fixture.ts:511`。未发现 J 注释中的施工历史问题。对于默认平台字节兼容，本部没有证明发生了变化，也不能用 J-01 所述弱断言宣告完整证明。

**DSH 自述核对**

- §1.1／§4.2 的处理：**不成立**。为旧测试跳过五字段核对违反明确回退规则；见 J-09，`.lead-ref/replies/pc1b-reply.md:5`、`.lead-ref/replies/pc1b-reply.md:51`。
- §1.4／§8／§9.4 的 responseFormat 缺口：**成立**，冻结夹具没有该入口；但“大历史造不出、continuation 必然 busy”的解释**不成立**，已有公开构造路径，见上文及 `.lead-ref/replies/pc1b-reply.md:105`。
- §4.1 的独立读工厂：**成立**。书冻结的是独立端口，没有要求把读方法塞进写服务；实际接线在 `src/composition/create-platform.ts:1187`，依据 `.lead-ref/books/pc1-book.md:506`。
- §4.7 的最小 Query manifest reader：**成立**。它仍为私有函数，且确实用于读口，`src/core/agent-runtime/runtime.ts:79`、`src/core/agent-runtime/runtime.ts:713`；不能因此归作 wire-format。
- §4.9 的夹具修正：**成立**。基线与当前唯一差异是 `captured as StartArgs`，`.lead-ref/base/tests/helpers/PC-platform-fixture.ts:529`、`tests/helpers/PC-platform-fixture.ts:529`，符合运行表的类型修正规定，`.lead-ref/books/run-pc1b.md:67`。
- §7 的 allowlist 说明：**不成立**。新增项的数量分类错误，且三项原身份仍在表中；见上面的逐项核对及 `.lead-ref/replies/pc1b-reply.md:101`。
- §8 的 base 行为：**成立的是“未实测”声明**；推理不能当验收证据，`.lead-ref/replies/pc1b-reply.md:105`。
- §9.5 的独立工厂选择：**成立**；称其为必须补充的任务书缺口则**不成立**，该选择没有改变冻结端口，`.lead-ref/books/pc1-book.md:510`。
- §9.6 的类型名区别：**成立，但不是新阻塞**；运行表已明确解释，`.lead-ref/books/run-pc1b.md:71`。

```json
[
  {
    "id": "J-01",
    "class": "违规",
    "file": "tests/runtime/PC-joint-prepare-freeze.test.ts",
    "line": 32,
    "basis": ".lead-ref/books/pc1-book.md:678；docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md:427",
    "problem": "Work、Query只检查system前缀和input中的prelude，未证明旧Skill仍在、完整输入不变；未修改实际段标签，摘要只覆盖base。发送端丢弃全部Skill仍可能通过本行。",
    "fix": "修改真正的段标签，用手写文本比较完整system/input，正向验证旧Skill，并逐项核对冻结模板、字符串表、base和Skill的手算摘要。"
  },
  {
    "id": "J-02",
    "class": "违规",
    "file": "tests/runtime/PC-joint-prepare-freeze.test.ts",
    "line": 19,
    "basis": ".lead-ref/books/pc1-book.md:681；.lead-ref/books/pc1-book.md:390",
    "problem": "联合PC-06没有continuation或review入口；P组入口用例只改变模板，未检验入口重渲染使用冻结字符串表。入口改用平台默认strings的变异未被这些用例排除。",
    "fix": "通过冻结夹具补齐continuation和K3 review联合场景，在准备前后改变相关字符串、包和Skill，并验证入口成功及模型收到手写的冻结内容。"
  },
  {
    "id": "J-03",
    "class": "违规",
    "file": "tests/runtime/PC-joint-freeze-and-pin.test.ts",
    "line": 35,
    "basis": ".lead-ref/books/pc1-book.md:684",
    "problem": "恢复后未断言产生新请求，at(-1)可能仍为首次请求，自身比较即可通过；首次运行的异常也被吞掉。恢复分支仅返回observation的变异会漏过。",
    "fix": "验证公开暂停状态并正常等待首次执行结束，恢复后断言请求数增加且身份不同，再比较两次system字节。"
  },
  {
    "id": "J-04",
    "class": "违规",
    "file": "tests/runtime/PC-joint-freeze-and-pin.test.ts",
    "line": 59,
    "basis": ".lead-ref/books/pc1-book.md:627；.lead-ref/books/pc1-book.md:689",
    "problem": "PC-08从preparedTexts的生产读取结果取得system期望，而驱动也使用同一readPromptTexts；两者共同产生错误文本时断言仍通过。",
    "fix": "准备前注入字面base和Skill、关闭额外Host指令，手写完整旧system；安装新绑定后直接比较该期望，不从生产读取结果生成期望。"
  },
  {
    "id": "J-05",
    "class": "违规",
    "file": "tests/runtime/PC-joint-record-and-failure.test.ts",
    "line": 116,
    "basis": ".lead-ref/books/pc1-book.md:693；.lead-ref/books/pc1-book.md:697",
    "problem": "Work只检查toolsDigest类型；Query不检查toolsDigest及第二条systemDigest。texts哈希循环没有建立工具摘要与引用正文的对应关系，第二条摘要被替换成任意合法摘要仍可通过。",
    "fix": "对Work和Query每条记录核对手工重建system的摘要，以及工具正文、toolsDigest、toolSpecsRef.digest的一致性，并确认引用正文存在。"
  },
  {
    "id": "J-06",
    "class": "违规",
    "file": ".lead-ref/replies/pc1b-reply.md",
    "line": 105,
    "basis": ".lead-ref/books/pc1-book.md:655；.lead-ref/books/pc1-book.md:593",
    "problem": "PC-15平台用例及base对照缺失，纯ModelBudget测试不能验证最终请求转换与Kernel删除、真实meter的接线。阻塞报告合规，但验收项未完成。",
    "fix": "由lead裁定并补冻夹具的responseFormat输入边界，利用脚本长文本和公开continuation构造历史，补长Host指令、responseFormat、紧窗口、删除后成功及base拒绝的对照；不新增仅为测试的生产Host配置。"
  },
  {
    "id": "J-07",
    "class": "违规",
    "file": "tests/architecture/production-reach-allowlist.json",
    "line": 1277,
    "basis": "tests/architecture/production-reach.test.ts:12；tests/architecture/production-reach.test.ts:19",
    "problem": "八个常量节点以wire-format保留，实际为七个仅供旧测试消费的导出和一个服务这些导出的私有常量，不属于持久化或传输格式。",
    "fix": "经lead放行关联旧测试的等价迁移，将期望改为测试字面量，删除七个无生产用途的导出、DEFAULT_BRIEF_TEXTS及八条allowlist项。"
  },
  {
    "id": "J-08",
    "class": "违规",
    "file": "tests/architecture/production-reach-allowlist.json",
    "line": 1343,
    "basis": "tests/architecture/production-reach.test.ts:12；tests/architecture/production-reach.test.ts:14；tests/architecture/production-reach.ts:33",
    "problem": "两个操作成员和五个实现helper被错误归为wire-format；实际等待E3消费者。walker不跟类型或可选成员的说明也不符合分析器规则。",
    "fix": "七项改为kept-for，按接受的格式注明编排分片和E3消费者；三个结果DTO保留wire-format并修正reader说明，helper保持私有。"
  },
  {
    "id": "J-09",
    "class": "违规",
    "file": "src/core/agent-runtime/execution-driver.ts",
    "line": 121,
    "basis": ".lead-ref/books/pc1-book.md:299；.lead-ref/books/pc1-book.md:382",
    "problem": "关联S：Work及src/core/agent-runtime/query-execution.ts:100在selection缺席时直接放行全部五字段比较；这是DSH为旧测试模型加入的生产豁免，违背统一回退与核对规则。",
    "fix": "删除两处早退，统一通过promptSelectionOf比较五字段；旧夹具身份冲突由lead裁定测试输入修正，不在生产代码豁免测试模型。"
  }
]
```

会出错 0，违规 9，不整洁 0，建议 0