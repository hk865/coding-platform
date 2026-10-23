静态审查未发现 W 的生产行为偏差；发现 **2 项测试违规**。本次没有修改文件，也没有运行测试、构建或网络操作。

| 编号 | 类别 | 位置 | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| W-01 | 违规 | [PC2-W-command-rerun-tools.test.ts:29](D:/cxt/pc2/tests/runtime/PC2-W-command-rerun-tools.test.ts:29)，另九处见下表“默认互比”列 | [run-pc2.md:67](D:/cxt/pc2/.lead-ref/books/run-pc2.md:67) 要求独立字面期望；[裁定21:731](D:/cxt/pc2/.lead-ref/books/pc2-book.md:731) 要求原规格字节不变 | 十个默认用例都把**另一遍当前生产工厂的输出**作为期望。它们满足 PC-24 的相互深等子项，却不能证明两路均等于原规格。例如交换 `request_command_rerun` 的 `command`、`reason` 键顺序，两路一起变化，现有断言仍通过；删掉未被自定义用例选择的 `reason` 描述也会漏过。 | 人工核定并写死原规格的完整序列化 JSON 字面量，让无 `texts`、显式平台表两路分别匹配该基线；保留原有互比。不得在测试运行时调用生产工厂或读取生成包来生成期望。 |
| W-02 | 违规 | [communication:39](D:/cxt/pc2/tests/runtime/PC2-W-communication-tools.test.ts:39)、[exploration:59](D:/cxt/pc2/tests/runtime/PC2-W-exploration-tools.test.ts:59)、[graph:32](D:/cxt/pc2/tests/runtime/PC2-W-graph-tools.test.ts:32)、[session-discovery:31](D:/cxt/pc2/tests/runtime/PC2-W-session-discovery-tools.test.ts:31)、[unknown-call-review:43](D:/cxt/pc2/tests/runtime/PC2-W-unknown-call-review-tools.test.ts:43)、[whiteboard:68](D:/cxt/pc2/tests/runtime/PC2-W-whiteboard-tools.test.ts:68)；均为 `tests/runtime/PC2-W-*.test.ts` | [裁定20:714](D:/cxt/pc2/.lead-ref/books/pc2-book.md:714)、[检查裁定8:20](D:/cxt/pc2/.lead-ref/books/pc2-chk1-rulings.md:20)、[run-pc2.md:67](D:/cxt/pc2/.lead-ref/books/run-pc2.md:67) | 六个局部输入用例对缺项工具只断言 `expect.any(String)`；unknown-review 再排除一个兄弟文本，仍不确定回退内容。将“`texts` 存在但缺少当前工具”分支改成保留平台参数、描述返回空串，六组断言及完整输入、默认互比用例都不会发现。 | 将六组缺项工具的检查改为独立手写的完整规格字面断言，核对其平台描述及适用的参数描述。 |

十处回退与 PC-24 覆盖核对如下。生产文件位于 `src/core/agent-runtime/`，测试位于 `tests/runtime/`；每处均已采用逐工具回退，没有遗留整对象默认。

| 工厂文件及回退位置 | 实际改写并完整断言的描述 | 参数字面覆盖 | 默认互比 |
|---|---|---|---|
| [command-rerun-tools.ts:145](D:/cxt/pc2/src/core/agent-runtime/command-rerun-tools.ts:145) | `request_command_rerun`，[测试:23](D:/cxt/pc2/tests/runtime/PC2-W-command-rerun-tools.test.ts:23) | `command`，[测试:25](D:/cxt/pc2/tests/runtime/PC2-W-command-rerun-tools.test.ts:25) | [测试:29](D:/cxt/pc2/tests/runtime/PC2-W-command-rerun-tools.test.ts:29) |
| [communication-tools.ts:309](D:/cxt/pc2/src/core/agent-runtime/communication-tools.ts:309) | `send_session_message`、`read_session_inbox`、`read_session_message`、`read_session_message_body`、`ack_session_message`、`respond_session_message`、`send_user_message`、`read_user_decision`、`record_decision_application`，9 个，[测试:15](D:/cxt/pc2/tests/runtime/PC2-W-communication-tools.test.ts:15)、[断言:32](D:/cxt/pc2/tests/runtime/PC2-W-communication-tools.test.ts:32) | 表均为空 | [测试:44](D:/cxt/pc2/tests/runtime/PC2-W-communication-tools.test.ts:44) |
| [exploration-tools.ts:107](D:/cxt/pc2/src/core/agent-runtime/exploration-tools.ts:107) | 自建的 `read_source`、`cpp_index`、`python_index`、`code_index`、`source_excerpt`、`list_files`、`search`、`symbols`，另含转交的 `project_source`，[测试:17](D:/cxt/pc2/tests/runtime/PC2-W-exploration-tools.test.ts:17)、[断言:48](D:/cxt/pc2/tests/runtime/PC2-W-exploration-tools.test.ts:48) | 两工具各自的 `prefix`，[测试:50](D:/cxt/pc2/tests/runtime/PC2-W-exploration-tools.test.ts:50) | [测试:64](D:/cxt/pc2/tests/runtime/PC2-W-exploration-tools.test.ts:64) |
| [graph-tools.ts:338](D:/cxt/pc2/src/core/agent-runtime/graph-tools.ts:338) | `look_graph`、`find_graph`，[测试:15](D:/cxt/pc2/tests/runtime/PC2-W-graph-tools.test.ts:15)、[断言:26](D:/cxt/pc2/tests/runtime/PC2-W-graph-tools.test.ts:26) | 表均为空 | [测试:36](D:/cxt/pc2/tests/runtime/PC2-W-graph-tools.test.ts:36) |
| [note-tool.ts:195](D:/cxt/pc2/src/core/agent-runtime/note-tool.ts:195) | `record_note`，[测试:16](D:/cxt/pc2/tests/runtime/PC2-W-note-tool.test.ts:16) | 表为空 | [测试:21](D:/cxt/pc2/tests/runtime/PC2-W-note-tool.test.ts:21) |
| [project-source-tool.ts:242](D:/cxt/pc2/src/core/agent-runtime/project-source-tool.ts:242) | `project_source`，[测试:14](D:/cxt/pc2/tests/runtime/PC2-W-project-source-tool.test.ts:14) | 表为空 | [测试:19](D:/cxt/pc2/tests/runtime/PC2-W-project-source-tool.test.ts:19) |
| [readonly-command-tool.ts:253](D:/cxt/pc2/src/core/agent-runtime/readonly-command-tool.ts:253) | `run_readonly_command`，[测试:22](D:/cxt/pc2/tests/runtime/PC2-W-readonly-command-tool.test.ts:22) | `command`，[测试:23](D:/cxt/pc2/tests/runtime/PC2-W-readonly-command-tool.test.ts:23) | [测试:42](D:/cxt/pc2/tests/runtime/PC2-W-readonly-command-tool.test.ts:42) |
| [session-discovery-tools.ts:106](D:/cxt/pc2/src/core/agent-runtime/session-discovery-tools.ts:106) | `find_related_sessions`、`read_session_card`，[测试:14](D:/cxt/pc2/tests/runtime/PC2-W-session-discovery-tools.test.ts:14)、[断言:25](D:/cxt/pc2/tests/runtime/PC2-W-session-discovery-tools.test.ts:25) | 表均为空 | [测试:35](D:/cxt/pc2/tests/runtime/PC2-W-session-discovery-tools.test.ts:35) |
| [unknown-call-review-tools.ts:135](D:/cxt/pc2/src/core/agent-runtime/unknown-call-review-tools.ts:135) | `record_unknown_call_review`、`propose_safer_method`，[测试:35](D:/cxt/pc2/tests/runtime/PC2-W-unknown-call-review-tools.test.ts:35) | 分别为 `item`、`rationale`，[测试:37](D:/cxt/pc2/tests/runtime/PC2-W-unknown-call-review-tools.test.ts:37) | 两阶段均覆盖，[测试:49](D:/cxt/pc2/tests/runtime/PC2-W-unknown-call-review-tools.test.ts:49) |
| [whiteboard-tools.ts:365](D:/cxt/pc2/src/core/agent-runtime/whiteboard-tools.ts:365) | `query_task_graph`、`query_ready_tasks`、`propose_future_plan`、`apply_future_plan`，[测试:22](D:/cxt/pc2/tests/runtime/PC2-W-whiteboard-tools.test.ts:22)、[断言:53](D:/cxt/pc2/tests/runtime/PC2-W-whiteboard-tools.test.ts:53) | 分别为 `basedOn`、`proposalRef`，另分别覆盖两个 pin 字段，[测试:55](D:/cxt/pc2/tests/runtime/PC2-W-whiteboard-tools.test.ts:55) | [测试:85](D:/cxt/pc2/tests/runtime/PC2-W-whiteboard-tools.test.ts:85) |

按上表去重，描述覆盖 **31/31**，非空参数表覆盖 **8/8**；`project_source` 另被 exploration 用例覆盖一次。某个兄弟工具继续读取平台描述，会被完整输入用例抓住；八个被选参数仍在 import 时取平台描述，也会被相应参数字面断言抓住。未选参数及序列化顺序的保障缺口是 W-01。

默认字节的静态核对结果：31 个描述及原有参数值均保持不变；生成表的唯一工具文本结构变化，是两个白板条目各增加两个 pin 参数。见[基线生成表:585](D:/cxt/pc2/.lead-ref/base/src/contracts/prompts/platform-pack.generated.ts:585)、[当前生成表:589](D:/cxt/pc2/src/contracts/prompts/platform-pack.generated.ts:589)。迁入工厂的 schema 保持了以下字段顺序、构造链和约束：

| schema | 保持的字段顺序 | 基线 → 当前 |
|---|---|---|
| `request_command_rerun` | `command, reason, rewriteOf(review, alias)` | [基线:38](D:/cxt/pc2/.lead-ref/base/src/core/agent-runtime/command-rerun-tools.ts:38) → [当前:42](D:/cxt/pc2/src/core/agent-runtime/command-rerun-tools.ts:42) |
| `run_readonly_command` | `command, cwd, timeoutMs` | [基线:58](D:/cxt/pc2/.lead-ref/base/src/core/agent-runtime/readonly-command-tool.ts:58) → [当前:62](D:/cxt/pc2/src/core/agent-runtime/readonly-command-tool.ts:62) |
| review / proposal | `item, verdict, evidence, crashSuspicion(verdict, evidence)`；`item, command, cwd, rationale` | [基线:49](D:/cxt/pc2/.lead-ref/base/src/core/agent-runtime/unknown-call-review-tools.ts:49) → [当前:53](D:/cxt/pc2/src/core/agent-runtime/unknown-call-review-tools.ts:53)、[当前:70](D:/cxt/pc2/src/core/agent-runtime/unknown-call-review-tools.ts:70) |
| 白板四工具 | `planRef, atLeastCursor`；`roleIds, includeBlocked, page(limit, cursor, atLeastCursor)`；`basedOn, draft, reason, expected`；`proposalRef, expectedProposalRevision, expected, acknowledgementRef`。pin 内均为 `ref, revision` | [基线:196](D:/cxt/pc2/.lead-ref/base/src/core/agent-runtime/whiteboard-tools.ts:196) → [当前:202](D:/cxt/pc2/src/core/agent-runtime/whiteboard-tools.ts:202) |

exploration 的内联 schema 仅替换文本来源，键序没有变化；其余五个文件的 schema 没有修改。对应差异见 [W.diff:207](D:/cxt/pc2/.lead-ref/parts/W.diff:207)、[W.diff:134](D:/cxt/pc2/.lead-ref/parts/W.diff:134)、[W.diff:254](D:/cxt/pc2/.lead-ref/parts/W.diff:254)、[W.diff:307](D:/cxt/pc2/.lead-ref/parts/W.diff:307)、[W.diff:350](D:/cxt/pc2/.lead-ref/parts/W.diff:350)、[W.diff:478](D:/cxt/pc2/.lead-ref/parts/W.diff:478)。

另外三点已核实：

- **透传完整。** exploration 在 [exploration-tools.ts:175](D:/cxt/pc2/src/core/agent-runtime/exploration-tools.ts:175) 传给 project-source；注册包装器在 [readonly-command-tool.ts:409](D:/cxt/pc2/src/core/agent-runtime/readonly-command-tool.ts:409) 接受 `texts?`，于 [同文件:437](D:/cxt/pc2/src/core/agent-runtime/readonly-command-tool.ts:437) 传入工厂。review/rerun 包装器直接传整个输入，见 [tool-group-assembly.ts:358](D:/cxt/pc2/src/core/agent-runtime/tool-group-assembly.ts:358)、[同文件:380](D:/cxt/pc2/src/core/agent-runtime/tool-group-assembly.ts:380)。
- **白板 D8 正确。** 两工具分别在 [whiteboard-tools.ts:237](D:/cxt/pc2/src/core/agent-runtime/whiteboard-tools.ts:237)、[同文件:247](D:/cxt/pc2/src/core/agent-runtime/whiteboard-tools.ts:247) 读取自己的两个参数。JSON 中均存在，见 [propose_future_plan.json:8](D:/cxt/pc2/resources/prompts/platform/tools/propose_future_plan.json:8)、[apply_future_plan.json:7](D:/cxt/pc2/resources/prompts/platform/tools/apply_future_plan.json:7)，值等于[基线 strings:145](D:/cxt/pc2/.lead-ref/base/src/contracts/prompts/platform-pack.generated.ts:145)；没有改变发送文本。
- **`!` 没有可证明的可达缺项问题。** 上表工厂只访问固定名称，全部存在于[生成表:589](D:/cxt/pc2/src/contracts/prompts/platform-pack.generated.ts:589)。`93fbeab` 所谓 typed fallback 是 `Readonly<Record<string, ToolTextV1>>` 类型视图，例如 [command-rerun-tools.ts:31](D:/cxt/pc2/src/core/agent-runtime/command-rerun-tools.ts:31)，不是运行时错误类型。若生成表真的缺项，随后读取 `.parameters`/`.description` 会产生普通 `TypeError`；当前合法输入不能让工厂选择这样的名称，因此不要求新增 typed error。

逐裁定、逐行结论：

- 裁定20（W 回退及透传）：**W-02**；生产实现 OK。[书:705](D:/cxt/pc2/.lead-ref/books/pc2-book.md:705)
- 裁定21：**W-01**；接口、schema 搬入工厂及默认字节的静态核对 OK。[书:722](D:/cxt/pc2/.lead-ref/books/pc2-book.md:722)
- 检查裁定8：**W-02**；十处生产回退及两处透传 OK。[裁定:20](D:/cxt/pc2/.lead-ref/books/pc2-chk1-rulings.md:20)
- 检查裁定16：**OK**。[裁定:28](D:/cxt/pc2/.lead-ref/books/pc2-chk1-rulings.md:28)
- 第二轮检查 D8：**OK**。[裁定:29](D:/cxt/pc2/.lead-ref/books/pc2-chk2-rulings.md:29)
- PC-24：**W-01、W-02**；31 描述、8 参数表及两路深等用例均齐全。[行定义:889](D:/cxt/pc2/.lead-ref/books/pc2-book.md:889)
- W 范围：**OK**。20 个文件均在所属范围及白名单内，W 差异没有旧测试、冻结夹具改动，也没有新增测试专用生产分支或施工历史注释。[W-files.txt:1](D:/cxt/pc2/.lead-ref/parts/W-files.txt:1)、[归属:763](D:/cxt/pc2/.lead-ref/books/pc2-book.md:763)、[白名单:6](D:/cxt/pc2/.lead-ref/books/pc2-whitelist.txt:6)

DSH 自述核对：

- 首轮回复“那五个文件参数表为空，所以只改描述”：**成立**；冻结后的 PC-24 已明确只要求八张非空表，不是夹具缺陷。[pc2w-reply.md:30](D:/cxt/pc2/.lead-ref/replies/pc2w-reply.md:30)、[书:891](D:/cxt/pc2/.lead-ref/books/pc2-book.md:891)
- 本轮“W 改十处逐工具回退”：**成立**，位置见上表。[pc2-reply.md:12](D:/cxt/pc2/.lead-ref/replies/pc2-reply.md:12)
- “typed platform tool-text fallback”：**成立于类型视图这一含义**，不代表新增了 typed error。[commits.txt:9](D:/cxt/pc2/.lead-ref/commits.txt:9)、[command-rerun-tools.ts:31](D:/cxt/pc2/src/core/agent-runtime/command-rerun-tools.ts:31)
- “10 文件、28 例”：**定义数量成立**；所列四类变异有对应断言，但不能替代 W-01、W-02 所缺的保障。“13 红”及通过结果本次未复跑。[pc2-reply.md:18](D:/cxt/pc2/.lead-ref/replies/pc2-reply.md:18)
- 回复 §1、§8 没有针对 W 的夹具缺陷或额外接缝选择，**成立**；W 无需补冻结夹具。[pc2-reply.md:5](D:/cxt/pc2/.lead-ref/replies/pc2-reply.md:5)、[同文件:55](D:/cxt/pc2/.lead-ref/replies/pc2-reply.md:55)

```json
[
  {
    "id": "W-01",
    "class": "违规",
    "file": "tests/runtime/PC2-W-command-rerun-tools.test.ts",
    "line": 29,
    "basis": ".lead-ref/books/run-pc2.md:67-69；.lead-ref/books/pc2-book.md:731-733、889-894",
    "problem": "十个默认用例以另一遍当前生产工厂输出作为期望，没有独立字节基线。相互深等符合PC-24该子项，但交换request_command_rerun的command/reason键顺序，或删除未选中的reason描述，两路同时变化仍通过。同类位置：communication:44、exploration:64、graph:36、note:21、project-source:19、readonly-command:42、session-discovery:35、unknown-call-review:49、whiteboard:85，均为tests/runtime/PC2-W-对应文件.test.ts。",
    "fix": "人工核定并写死原规格的完整序列化JSON字面量，让无texts和显式平台表两路分别匹配该基线，并保留原有互比；不得在测试运行时从生产工厂或生成包生成期望。"
  },
  {
    "id": "W-02",
    "class": "违规",
    "file": "tests/runtime/PC2-W-graph-tools.test.ts",
    "line": 32,
    "basis": ".lead-ref/books/pc2-book.md:714-721；.lead-ref/books/pc2-chk1-rulings.md:20；.lead-ref/books/run-pc2.md:67-72",
    "problem": "六个局部输入用例对缺项工具只检查expect.any(String)，unknown-review再排除一个兄弟文本，仍未确定平台回退全文。仅将texts存在且缺少当前工具时的回退描述改成空串、保留参数，现有W用例仍通过。另五处为communication:39、exploration:59、session-discovery:31、unknown-call-review:43-44、whiteboard:68，均为tests/runtime/PC2-W-对应文件.test.ts。",
    "fix": "将六组缺项工具的检查改为独立手写的完整规格字面断言，核对其平台描述及适用的参数描述。"
  }
]
```

会出错 0，违规 2，不整洁 0，建议 0