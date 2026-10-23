只读审查完成；未修改文件、运行测试或构建、联网。以下变异判断均为静态推演。

下文 `R/`＝`src/core/agent-runtime/`，`T/`＝`tests/runtime/`，`F`＝`.lead-ref/books/pc2-findings.md`。

**1. 问题表**

| 编号 | 类别 | 位置（file:line） | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| Q2-01 | **违规** | `R/context-history-facts.ts:155`、`:208`、`:254`；`R/context-continuation-recipe.ts:155` | F1，`F:15`、`:35`；本次要求检查所有准备调用路径 | 删除了新增的 completed-boundary 读取，但准备阶段仍经 continuation/review 读取 Kernel 历史，详见下方调用链。这些是既有路径，不是本轮新增回归；但“准备阶段不读 Kernel 历史”的全路径要求尚未成立。 | **需 lead 冻结接口和范围**：把简报、seed 边界、复核命令所需历史事实的读取移到准备之前的正式 owner 步骤，准备只消费已取得的事实；保持原有历史、简报和失败语义。不能直接删读后返回空 seed/空命令。 |
| Q2-02 | **违规** | `T/PC2-declaration-prepare.test.ts:177`、`:188` | Q-03；`F:9` 的全文比较门槛 | 两个 initial Query 用例只检查 `endsWith`。将 `R/query-preparation.ts:316` 改成重复拼接两遍“question＋已渲染 guide”，两例仍通过；不是完整正文验收。所报“直接拼原文”变异能失败，但这个同规则的简单变异能漏过。 | 为有 read／无 read 两例分别手写完整预期 `manifest.input`，直接全文 `toBe`，不从 manifest 或生产 renderer 生成期望。 |
| Q2-03 | **违规** | `T/PC2-joint-history.test.ts:179`、`:185` | Q-07→J-05；`.lead-ref/audit1/J.out.md:9` 要求验证历史前缀 | LA-1 已走公开准备和启动，但只验证简报里的历史声明、提醒数量，没有验证请求实际带入源 Session 历史。把 `R/execution-driver.ts:781` 的参数改成 `sessionBasis: undefined`，新 Session 会用 `current_turn`，这些断言仍通过。 | 在现有 LA-1 公开链中安排可辨认的源历史，启动新 Session 后，以独立手写字面量核对请求中的实际历史前缀，并保留提醒数量断言。 |
| Q2-04 | **违规** | `T/PC2-joint-tools.test.ts:75`、`:83`、`:90` | Q-09→J-13；`F:121`；`.lead-ref/audit1/J.out.md:17` | 仍未全文比较 `toolSpecsRef`：只完整比较 `list_files`、`record_note`，其他工具只排除三个标记字符串。把 `search` 的说明或参数规格改错仍能通过。两个固定 SHA 只验证测试常量，没有核对整份 specs 正文及其引用。 | Work、Query 各写完整规格 JSON 字面量，与读取的原始正文全文比较；用该完整字面量计算 SHA-256，与对应 `toolSpecsRef.digest` 比较。 |
| Q2-05 | **不整洁** | `R/context-history-facts.ts:41`、`:45` | Q-11；`F:123`；本次生产注释要求 | 新注释仍提 `pc1-final` 施工基线；同时声称 preparation 和 start 都调用 `sessionHistoryDecision`，与现在 recipes 调用 `takesSessionHistoryOf` 不符（`R/context-work-recipe.ts:288`、`R/context-query-recipe.ts:95`）。 | 将这段注释改为当前职责：启动时选择历史边界和来源，模式委托给共享纯规则；删除施工基线及错误调用关系。 |

Q2-01 的可达路径如下，不能仅搜索已删除的函数名：

- `R/execution-preparation.ts:566` → `R/context-assembler.ts:30` → `R/context-work-recipe.ts:252` → `R/context-continuation-recipe.ts:155`／`:164` → `R/continuation-brief-assembly.ts:564`／`:425`，读取 Turn 边界和历史窗口。
- 同一 continuation 路径在 `R/context-continuation-recipe.ts:179` 调用 `sessionBasisForContext`，最终在 `R/context-history-facts.ts:155` 读取源 Session 窗口。
- review 路径从 `R/context-work-recipe.ts:275` → `R/context-review-recipe.ts:88` → `R/context-history-facts.ts:208` → `:105`，读取 seed 边界。
- review 命令事实路径从 `R/context-review-recipe.ts:92` → `:34` → `R/context-history-facts.ts:254`，读取原始命令记录。

**2. 逐项结论**

- **F1：Q2-01。** 纯模式规则、签名、recipes 的布尔输入及原样冻结已正确落实：`R/context-history-facts.ts:27`、`:50`，`R/context-types.ts:104`、`:113`、`:127`，`R/execution-preparation.ts:634`，`R/query-preparation.ts:353`。启动仍实读边界、保留 frozen false 覆盖；不可解码游标仍返回 invalid：`R/execution-driver.ts:767`、`:784`，`R/query-execution.ts:589`、`:597`，`R/session-operations.ts:917`。
- **F2：OK。** 同一导出集合用于两处准备过滤和 unknown 检查；准备保留 capability owners，启动传真 owners，拒绝先于名单比较：`R/tool-group-assembly.ts:92`、`:509`，`R/execution-preparation.ts:524`、`:535`，`R/query-preparation.ts:276`、`:286`，`R/execution-driver.ts:548`、`:555`、`:573`，`R/query-execution.ts:288`、`:295`、`:312`。注意这里是授权名集合：`write` 经既有映射注册为 `edit`，不是遗漏 `edit`；`check` 未进入 enabledNames。见 `src/core/work-graph/state/unknown-call-kinds.ts:45`、`R/tool-group-assembly.ts:76`、`:471`。
- **Q-01：OK。** 准备只在请求 `run_readonly_command` 时新增授权读取，启动使用真实授权：`R/query-preparation.ts:258`、`:264`、`:269`，`R/query-execution.ts:308`。旧测试的精确裁定见下一节。
- **Q-02：rejected，未改 owner 事实处理。** 两处仍传 capability owners，符合 F2：`R/execution-preparation.ts:535`，`R/query-preparation.ts:286`。
- **Q-03：Q2-02。** 生产修法正确，仅 initial 分支读取并渲染 guide：`R/query-preparation.ts:304`、`:310`。
- **Q-04：OK。** 类型检查已提前到缓存命中之前；删除该检查会使测试构造的同 ref 命中缓存并返回 ready，破坏完整拒绝断言：`R/prompt-set-texts.ts:260`，`T/PC2-tool-text-type-check.test.ts:42`、`:48`、`:61`。
- **Q-05：same as F1，Q2-01。** `af84802` 的转换已删除，剩余问题是间接读取路径：`.lead-ref/parts/Q.diff:87`，`R/context-history-facts.ts:155`。
- **Q-06：same as J-11，OK。** 新联合用例比较手写 review、提醒、范围、总字节及计费，并真实启动：`T/PC2-joint-shrink-entry.test.ts:137`、`:143`、`:152`、`:157`、`:160`。
- **Q-07：Q2-03。** same-Session 启动已补，见 `T/PC2-joint-history.test.ts:107`；Query/K3 非空历史部分仍 deferred，符合 `F:119`。现有空场景新增启动断言属于 J-07，见 `T/PC2-joint-history.test.ts:203`、`:224`。
- **Q-08：same as J-12，OK。** Query 准备后改包并读记录；Work 恢复包含 `record_note` 且检查旧文本：`T/PC2-joint-tools.test.ts:274`、`:288`、`:310`、`:353`。
- **Q-09：same as J-13，Q2-04。**
- **Q-10：OK。** 使用原冻结夹具的 empty 模式，完整断言 invalid 原因和空 manifest：`T/PC2-declaration-prepare.test.ts:127`、`:130`、`:135`。
- **Q-11：Q2-05。**

按提供的变更清单核对，未发现白名单外文件或四个冻结夹具改动；唯一列出的 helper 改动为 `WP1-units-fixture.ts`：`.lead-ref/all-files.txt:36`，白名单依据 `.lead-ref/books/pc2-r1-whitelist.txt:24`。Q 新增用例的时限均为 `60_000`，未见提高已有时限：`.lead-ref/parts/Q.diff:850`、`:871`、`:903`、`:1043`、`:1065`。

**3. DSH 自报事项**

- **回复 §1.1：成立。** 我会裁定仅将 `T/K-readonly-command.test.ts:734`、`:1069` 改成 `revisionFor: read => read <= 2 ? 'k-read-1' : 'k-read-2'`，并由 lead 为这两处补白名单，原断言全部保留。
  
  原计数来自 `T/K-readonly-command.test.ts:225`。现在准备第一次读取、启动第二次读取并冻结执行权限版本，工具调用第三次再核对版本：`R/query-preparation.ts:266`，`R/query-execution.ts:278`、`:455`、`:459`，`R/readonly-command-tool.ts:424`、`:277`。因此 `read <= 2` 恢复的是 **准备／启动为版本 1，执行时变为版本 2**，没有放宽证明。
  
  KB-08 的“nothing started”指命令未启动；Query 仍需得到工具拒绝并 answered，不能改成启动前拒绝或“没有 provider 调用”：`T/K-readonly-command.test.ts:741`、`:745`、`:746`。KB-10 继续证明同一提前拒绝结果受大小上限约束：`:1075`、`:1078`、`:1079`。

- **回复 §1.3：不成立。** “可执行近似”不满足已冻结的整份 JSON 比较，见 Q2-04；自报位置 `.lead-ref/replies/pc2-r1-reply.md:11`。
- **回复 §1.5 中 Q-02 rejected、Query/K3 非空场景 deferred：成立。** 依据 `F:114`、`:119`；现有空场景的启动检查归 J-07，`F:130`。
- **回复 §2 的 F1 完成结论：不成立于“准备全路径不读历史”这一部分；其余列出的结构变化成立。** 见 Q2-01及上述 F1 核对；自报位置 `.lead-ref/replies/pc2-r1-reply.md:18`。
- **回复 §2 的 F2 接线结论：成立。** 静态证据见上述 F2；删除 Work 准备过滤会破坏 GAP-46 的 prepare-ready 断言，`T/C2-runtime-platform-tools.test.ts:371`、`:372`。未复验自报测试数量。
- **旧 UNSPECIFIED §8.4：不能继续作为例外，整体不成立。** capability owners 已由 F2 明确保留；冻结名单代替真实授权、invalid 转零边界的旧主张已被 Q-01/F1 撤销：`.lead-ref/replies/pc2-reply.md:58`，`F:30`、`:43`、`:113`。
- **旧 UNSPECIFIED §8.5 中“empty 夹具不可用、LA-1 非空 seed 不可达”：不成立。** 当前公开用例已分别到达对应步骤：`T/PC2-declaration-prepare.test.ts:127`，`T/PC2-joint-history.test.ts:138`、`:151`、`:161`；LA-1 的请求历史验收仍缺 Q2-03。旧主张位置 `.lead-ref/replies/pc2-reply.md:59`。

**4. 同一问题表的 JSON**

```json
[
  {
    "id": "Q2-01",
    "class": "违规",
    "file": "src/core/agent-runtime/context-history-facts.ts",
    "line": 155,
    "basis": "F1；.lead-ref/books/pc2-findings.md:15、35；本次要求检查全部准备调用路径",
    "problem": "新增 completed-boundary 读取已删除，但准备仍通过 continuation 的 readPreviousTurn、sessionBasisForContext，以及 review 的 reviewSessionBasis、readKernelCommandFacts 读取 Kernel 历史。相关读取见 context-continuation-recipe.ts:155、179，context-review-recipe.ts:88、92，context-history-facts.ts:105、155、254。这些是既有路径，并非本轮新增回归，但全路径禁读要求未完成。",
    "fix": "需 lead 冻结接口和范围：将简报、seed 边界及复核命令所需历史事实读取移到准备之前的正式 owner 步骤，准备仅消费已取得的事实，保留原历史、简报及失败语义；不得删读后返回空 seed 或空命令。"
  },
  {
    "id": "Q2-02",
    "class": "违规",
    "file": "tests/runtime/PC2-declaration-prepare.test.ts",
    "line": 177,
    "basis": "Q-03；.lead-ref/books/pc2-findings.md:9 的全文比较要求",
    "problem": "有 read 和无 read 的 initial Query 用例仅使用 endsWith。将 query-preparation.ts:316 改为重复拼接两遍 question 与已渲染 guide，两例仍通过。",
    "fix": "分别手写两例完整预期 manifest.input，直接全文 toBe；不从 manifest 或生产 renderer 生成期望。"
  },
  {
    "id": "Q2-03",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-history.test.ts",
    "line": 185,
    "basis": "Q-07→J-05；.lead-ref/audit1/J.out.md:9 要求验证实际历史前缀",
    "problem": "LA-1 用例只检查简报中的历史声明和请求提醒数量。将 execution-driver.ts:781 的 sessionBasis 参数改为 undefined，新 Session 会使用 current_turn、不带源历史，但现有断言仍通过。",
    "fix": "在现有公开 LA-1 链中安排可辨认的源历史，启动新 Session 后，以独立手写字面量核对请求中的实际历史前缀，并保留提醒数量断言。"
  },
  {
    "id": "Q2-04",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-tools.test.ts",
    "line": 75,
    "basis": "Q-09→J-13；.lead-ref/books/pc2-findings.md:121；.lead-ref/audit1/J.out.md:17",
    "problem": "toolSpecsRef 正文仅完整比较 list_files、record_note；其他工具只排除三个标记字符串，错误的 search 说明或参数规格仍能通过。两个 SHA 断言只验证测试常量，没有核对完整规格正文及其引用。",
    "fix": "Work、Query 各手写完整规格 JSON，与读取的原始正文全文比较；以该完整字面量计算 SHA-256，并与对应 toolSpecsRef.digest 比较。"
  },
  {
    "id": "Q2-05",
    "class": "不整洁",
    "file": "src/core/agent-runtime/context-history-facts.ts",
    "line": 41,
    "basis": "Q-11；.lead-ref/books/pc2-findings.md:123；生产注释不得保留施工历史",
    "problem": "注释仍引用 pc1-final，并错误声称 preparation 与 start 都调用 sessionHistoryDecision；当前 recipes 调用的是 takesSessionHistoryOf。",
    "fix": "将该注释改为当前职责：启动时选择历史边界及来源，模式委托共享纯规则；删除施工基线和错误调用关系。"
  }
]
```

会出错 0，违规 4，不整洁 1，建议 0