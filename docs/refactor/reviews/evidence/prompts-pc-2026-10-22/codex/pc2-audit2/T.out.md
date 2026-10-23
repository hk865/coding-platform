本次仅做静态只读审查，未运行测试、构建或联网。下列结论来自源码、基线差异和字节手算，不把 DSH 自报的 RED/GREEN 当作已验证结果。

**1. Findings table**

| 编号 | 类别 | 位置（file:line） | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| T2-01 | 会出错 | `src/contracts/continuation-brief.ts:651`、`:669`、`:673` | 冻结表 `.lead-ref/books/pc2-findings.md:96`；模板槽位规则 `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md:85` | 容量后备路径仍把 anomaly 与 review 合成一个数组，全部送进 `anomalies`，而 `review` 恒为空。个人模板分别处理这两个槽时，实际测量的已不是原候选，甚至会隐藏必需 review 后判定容量足够。反例见下文。 | 候选始终分别保存、传入 anomaly 和 review 两组内容，包括最终无正文后备；补下述字面反例，要求拒绝容量不足。 |
| T2-02 | 违规 | `tests/runtime/PC2-T-render.test.ts:362`、`:367` | 冻结表 `.lead-ref/books/pc2-findings.md:94`；审查一 `.lead-ref/audit1/T.out.md:9` 的递归收集要求 | 两个缺省工具表用例只有顶层 `read/edit`。删掉 `templateToolNames` 的子节点递归，或者直接返回 `['read','edit']`，这两例仍通过，不能约束“当前模板的全部工具块”。递归实现位置为 `src/contracts/continuation-brief.ts:473`。 | 将这两个用例改成含嵌套工具块和额外工具名的手写模板，整文断言缺省呈现及显式清单筛选，并用删除递归的变异验证。 |
| T2-03 | 违规 | `tests/runtime/PC2-T-render.test.ts:345`、`:355`、`:364` | 冻结表 `.lead-ref/books/pc2-findings.md:9`、`:97` | brief 整文期望中的 digest 来自生产函数 `continuationBriefDigest(SMALL_BRIEF)`，随后插回期望文本，不满足“期望不来自生产代码”的明确限制。 | 此处是 renderer 用例，直接传入固定的 64 位十六进制字面 digest，并把相同字面写入整文期望。 |
| T2-04 | 违规 | `tests/runtime/S3-context-assembler.test.ts:264`、`:855`；`tests/runtime/S4C2-assembly.test.ts:394`；`tests/work-graph/S3-role-profiles.test.ts:203` | F1 明定旧测试不改：`.lead-ref/books/pc2-findings.md:33`；范围规则 `.lead-ref/books/run-pc2-r1.md:48` | 三份旧测试共四处把 `completedBoundary` 改成 `hasCompletedCursor`。这是接口迁移，未放宽断言，但超出了 F1 的明文授权；在白名单内不等于获准修改。 | **需 lead 裁定。** 建议明确批准这四处必要的输入形状迁移，作为 F1 的窄例外；不恢复旧接口兼容路径，也不改断言。 |
| T2-05 | 违规 | `.lead-ref/replies/pc2-r1-reply.md:63`；`tests/runtime/S4C2-assembly.test.ts:358` | 生产变异要求 `.lead-ref/books/run-pc2-r1.md:42`；T-07 `.lead-ref/books/pc2-findings.md:99` | 所报变异“截止标记改回 `''`”修改的是测试，不是生产规则，而且只是把截取范围扩大到末尾。现有正向断言仍成立；排除的 norms／项目正文也没有因此进入该范围，不能支持所报“两红”。参见该测试 `:359`、`:361`、`:363` 和提醒构造 `src/core/agent-runtime/context-fact-text.ts:318`。 | 保留已恢复的截止标记；用生产变异“把 general note 错放到 reminders”重新取得并如实记录 RED/GREEN。 |
| T2-06 | 不整洁 | `tests/runtime/K3-15-blocked-omission.test.ts:10`；`tests/runtime/K3-35-T-by-hand.test.ts:37`；`tests/runtime/K3-35-approved-methods-brief.test.ts:169` | F3 手算要求 `.lead-ref/books/pc2-findings.md:53` | 最终数值正确，但分项注释错位：基础简报实际为 **30 行，1418＋29**，不是 31 行、1417＋30；K3-35 尾部正文实际 **301** 字节、外部连接换行 **43** 个，不是 300＋44；approved 文件还残留 `tail 357`。依据整文字面 `tests/runtime/K3-15-blocked-sentence-pure.test.ts:25` 和模板 `resources/prompts/platform/templates/continuation-brief.txt:4`。 | 同步修正三份测试的分项注释，并在回复中写出正确分解；保持现有最终期望值不变。 |

T2-01 的具体反例：取 `tests/runtime/K3-35-renderer-boundary-pure.test.ts:48` 的基础简报，加上该文件 `:121` 的 review 构造；不带 anomalies，工具清单为空，digest 为固定 64 位十六进制串。使用下列合法模板，其槽位均在 `src/contracts/prompts/slot-tables.ts:43` 声明：

```text
H\n{{marker}}{{#tool:read}}{{body}}{{blockedOmission}}{{bodyOmission}}{{anomalies}}{{/tool:read}}{{review}}{{blocked}}\n
```

随后接 16,000 个 `X` 和 `\n\nT`。固定部分为 `2＋95＋1＋16000＋3＝16101` 字节；review 的必需方案块单独就有 5120 字节，应拒绝容量不足。四档正常候选确实保留 review；进入后备后，`:651` 将它搬进被隐藏的 anomalies 槽，最终返回 **16101 字节、没有 review** 的文本。方案块必须完整保留的规则在 `src/contracts/continuation-brief.ts:1054`，5120 字节构造在 `tests/helpers/K3-continuation-pure-fixture.ts:94`。这是 T-04 尚未清除的合槽问题，并非平台包字节回归。

平台包的循环核对结果：旧前缀累加与新反向枚举选出的前缀相同。平台省略行的数字每减一项至多减少一个字节，而新增正文元素连同换行至少增加一个字节，因此候选长度不下降；平台模板相邻的 anomalies/review 槽也使两种拼法字节相同。依据 `.lead-ref/base/src/contracts/continuation-brief.ts:589`、`:641`，当前 `src/contracts/continuation-brief.ts:609`、`:665`，以及 `resources/prompts/platform/templates/continuation-brief.txt:2`。

F3 手算复核：

- 删句为 `2＋18×3＋1＝57` 字节；末尾提醒为 `2＋12＋1＋24＋1＋30＝70` 字节。句子见 `.lead-ref/base/tests/scenarios/A1-rework-same-session.test.ts:208`；提醒文字见 `resources/prompts/platform/strings.json:62`、`:132`、`:133`。
- 基础简报为 `1418＋29＝1447`。三个 padding 分别为 `3417＋57＝3474`、`3477＋57＝3534`、`2536＋57＝2593`。四个结果为：
  - `1447＋123＋4000＋4000＋3474＋3340＝16384`
  - `1447＋123＋4000＋4000＋3534＋3132＋68＝16304`
  - `1447＋4×(41＋1018)＋69＝5752`
  - `1447＋164＋3×4000＋2593＋69＝16273`
  
  对应 `tests/runtime/K3-15-blocked-omission.test.ts:77`、`:97`、`:114`、`:132`；基础整文见 `tests/runtime/K3-15-blocked-sentence-pure.test.ts:25`。
- K3-35 正确分解是 `110＋2211＋9913＋41＋301＋43＝12619`；T=600 再加 88，得 **12707**；T=7 将正文换成 1706，得 **12114**。截到 EOF 才分别多出 70。正文和 review 分项见 `tests/runtime/K3-35-T-by-hand.test.ts:27`；简报截止处理见该文件 `:94` 和 `tests/runtime/K3-35-approved-methods-brief.test.ts:72`。
- AG6/C2 的 Skill 是独立完整字面，逐字与对应工具条件下的模板一致：work `4919−195−101＝4623`；secretary `4223−215−165−195−146＝3502`；scribe `4063−195−75＝3793`；adviser `5338−124−265−195−101＝4653`；reviewer **1342**。字面起点见 `tests/app/AG6-agent-assembly.test.ts:58`、`:103`、`:142`、`:182`、`:231`，以及 `tests/runtime/C2-runtime-platform-tools.test.ts:66`、`:105`、`:154`；对应条件正文见五个 `resources/prompts/platform/templates/skill-platform-*.txt` 中 work `:41`、secretary `:16`、scribe `:26`、adviser `:32`、reviewer `:1`。
- 工具条件匹配正确：AG6 授予 `read`；C2 正例授予三个邮箱工具；负例虽有 `query_task_graph`，但没有嵌套条件要求的 `query_ready_tasks`，所以 adviser 那句仍应删除。依据 `tests/app/AG6-agent-assembly.test.ts:396`，`tests/runtime/C2-runtime-platform-tools.test.ts:268`、`:316`，以及 `resources/prompts/platform/templates/skill-platform-adviser.txt:30`。

**2. Per row**

- T-01: OK。提醒经过 renderer，并测试有／无 read；`src/core/agent-runtime/context-rendering.ts:178`，`tests/runtime/PC2-T-render.test.ts:193`。
- T-02: T2-02、T2-03；递归实现及 review/proposal 模板选择本身正确，`src/contracts/continuation-brief.ts:464`，`src/contracts/core/prepared-execution.ts:116`。
- T-03: OK。材料类型为 `PromptTextsV1`，cast 已删除；`src/core/agent-runtime/context-types.ts:62`，`src/core/agent-runtime/context-rendering.ts:337`。
- T-04: T2-01；平台包前缀选择和字节保持，个人模板合槽问题仍在，`src/contracts/continuation-brief.ts:651`。
- T-05: T2-03。专用 Skill／brief helper 的存在、缺失整文断言已补；`tests/runtime/PC2-T-render.test.ts:347`、`:353`。
- T-06: OK。完整 ranges、非零 omitted、全省略及另一顺序均有字面断言；`tests/runtime/PC2-T-render.test.ts:237`、`:281`、`:298`、`:332`。
- T-07: T2-05。要求的截止标记已恢复；额外接口迁移另计 T2-04，`tests/runtime/S4C2-assembly.test.ts:358`、`:394`。
- T-08: deferred，原缺口未补；read/edit/shell 仍只走纯 renderer，`tests/runtime/PC2-joint-tools.test.ts:114`。
- T-09: OK，按 J-11 完成。真实 shrink 比较完整 review、提醒、全部区间和计费值，再调用 start；`tests/runtime/PC2-joint-shrink-entry.test.ts:137`、`:143`、`:157`、`:160`。
- T-10: rejected, untouched；冻结裁定见 `.lead-ref/books/pc2-findings.md:102`，提供的变更清单 `.lead-ref/all-files.txt:1` 未列该文件。
- T-11: OK。所指材料及独立段落注释已修正；`src/core/agent-runtime/context-types.ts:43`、`:56`，`src/core/agent-runtime/context-work-recipe.ts:269`、`:278`，`src/contracts/core/prepared-execution.ts:103`、`:235`。
- F3: T2-06；数值、Skill 字面、A1 删句正确。除此之外，旧测试还有 T2-04 的四处未授权迁移；差异见 `.lead-ref/parts/T.diff:1242`、`:1264`、`:1299`。

T 的路径均匹配白名单；提供的完整变更清单未含四个冻结夹具，T.diff 也没有 timeout 修改。依据 `.lead-ref/parts/T-files.txt:1`、`.lead-ref/books/pc2-r1-whitelist.txt:1`、`.lead-ref/all-files.txt:1`、`.lead-ref/parts/T.diff:1`。

**3. DSH 自报项**

- §1.4 A1：**成立，仅限静态删句部分**；当前只删除指定句子，`.lead-ref/parts/T.diff:1286`。没有 bwrap、停在 waiting 的运行原因仅有其自报，未独立确认，`.lead-ref/replies/pc2-r1-reply.md:12`。
- §1.5 T-08 deferred、T-10 rejected：**成立**；状态与冻结表一致，`.lead-ref/books/pc2-findings.md:100`、`:102`。提交信息中的“T-08 table”确为误称，`.lead-ref/commits.txt:4`。
- §2 F3 数值：**成立**，最终数值均对；分项注释不成立，见 T2-06，`.lead-ref/replies/pc2-r1-reply.md:20`。
- §3 T-07“改回空截止标记，两红”：**不成立**，所列不是生产变异，也不能由当前断言推出两例失败，见 T2-05，`.lead-ref/replies/pc2-r1-reply.md:63`。
- T 相关未见另列的 `UNSPECIFIED` 项；回复的疑问列表见 `.lead-ref/replies/pc2-r1-reply.md:3`。

**4. JSON**

```json
[
  {
    "id": "T2-01",
    "class": "会出错",
    "file": "src/contracts/continuation-brief.ts",
    "line": 651,
    "basis": "冻结表 T-04：.lead-ref/books/pc2-findings.md:96；PROMPTS-SPEC.md:85 的槽位语义",
    "problem": "容量后备将 anomaly 与 review 合并后全部传入 anomalies，review 恒为空。模板隐藏 anomalies、保留 review 时，会把必需 review 隐藏后错误判为容量足够；文中反例返回16101字节而应拒绝容量不足。",
    "fix": "候选和最终后备始终分别保存并传入 anomaly、review 两组内容；补文中手写模板反例并断言容量拒绝。"
  },
  {
    "id": "T2-02",
    "class": "违规",
    "file": "tests/runtime/PC2-T-render.test.ts",
    "line": 362,
    "basis": "冻结表 T-02：.lead-ref/books/pc2-findings.md:94；审查一 T-02 的递归收集要求",
    "problem": "缺省工具表测试只有顶层read/edit；删除子节点递归或直接返回这两个名字，两个用例仍通过。",
    "fix": "将brief和review缺省测试改成含嵌套工具块及额外工具名的手写模板，整文断言，并验证删除递归会失败。"
  },
  {
    "id": "T2-03",
    "class": "违规",
    "file": "tests/runtime/PC2-T-render.test.ts",
    "line": 345,
    "basis": ".lead-ref/books/pc2-findings.md:9、T-05",
    "problem": "整文期望中的digest来自生产函数continuationBriefDigest，再插入期望文本，违反期望不得来自生产代码的限制。",
    "fix": "renderer测试直接传入固定64位十六进制字面digest，并在整文期望中写同一字面。"
  },
  {
    "id": "T2-04",
    "class": "违规",
    "file": "tests/runtime/S3-context-assembler.test.ts",
    "line": 264,
    "basis": "F1：.lead-ref/books/pc2-findings.md:33；run-pc2-r1.md:48",
    "problem": "S3-context-assembler:264、855，S4C2-assembly:394，S3-role-profiles:203共四处旧测试输入从completedBoundary迁移到hasCompletedCursor，超出F1明确的旧测试不改授权。",
    "fix": "需lead明确裁定：建议仅批准这四处必要的输入形状迁移作为F1窄例外，保持断言不变，不恢复旧接口兼容路径。"
  },
  {
    "id": "T2-05",
    "class": "违规",
    "file": ".lead-ref/replies/pc2-r1-reply.md",
    "line": 63,
    "basis": ".lead-ref/books/run-pc2-r1.md:42；冻结表T-07",
    "problem": "自报的变异是把测试截止标记改回空串，并非生产变异；扩大截取范围不能支持当前两例会失败的结论。",
    "fix": "保留当前截止标记，用生产变异将general note错放到reminders，重新取得并如实记录RED/GREEN。"
  },
  {
    "id": "T2-06",
    "class": "不整洁",
    "file": "tests/runtime/K3-15-blocked-omission.test.ts",
    "line": 10,
    "basis": "F3手算要求：.lead-ref/books/pc2-findings.md:53",
    "problem": "最终数值正确，但基础简报分解应为30行、1418+29；K3-35尾部正文应为301字节、外部连接换行43个。K3-35-T仍写300+44，approved还残留tail 357。",
    "fix": "同步修正三份测试的分项注释，并在回复中写出正确分解；保持现有最终期望值不变。"
  }
]
```

会出错 1，违规 4，不整洁 1，建议 0