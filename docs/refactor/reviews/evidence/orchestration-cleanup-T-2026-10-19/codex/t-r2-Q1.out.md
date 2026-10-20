Q1 的三行尚不能全部标为完成。以下仅依据静态代码、冻结表和差异；未运行测试、构建或联网。

| 编号 | 类别 | 位置 | 行 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| Q1-01 | 违规 | `tests/work-graph/S3-context-inputs.test.ts:778` | W2-18 | IN05 的 owner 从同一 Task 的 `runA2` 改成了 `runB`，第三个 Run 被省去；冻结表要求转换三个 Run，并未授权改这个拒绝输入（`.lead-ref/t-w1r1-findings.md:52`，基线 `.lead-ref/base/tests/work-graph/S3-context-inputs.test.ts:469`、`:689`）。`run-machine.ts:646` 只拒绝第二次 **first** claim，随后仍有 requeue claim 分支（`src/core/work-graph/state/run-machine.ts:649`）。当前 IN05 仍会触发完整引用检查，不能据此声称它是假通过（`src/core/work-graph/materials/applicability.ts:69`）；问题是删除理由不足且换输入未经授权。 | 恢复 IN05 的 `runA2 → runA` 输入。在该子例中用真实 completed Run、真实 FAIL 验收、公开 requeue、携返回 `requeueRef` 的第二次 claim 和真实 finish 产生 runA2；保留原 `forbidden` 断言。 |
| Q1-02 | 违规 | `tests/work-graph/S3-context-inputs.test.ts:286` | W2-18 | Project 和两个 Workspace 仍由 `commitRaw` 写入，Workspace@7 仍是手写检查点。TQ-114 已明确要求公开项目、Workspace 登记替换 raw 初始化（`.lead-ref/books/t-items-TQ.md:751`），此次只是换了写入 helper。 | 改为公开 `createProject`、两个 `registerWorkspace`；用真实 Session 和公开 `setLinePins` 推进所需 Workspace 版本，删除这三条 raw snapshot。 |
| Q1-03 | 违规 | `tests/work-graph/S3-context-inputs.test.ts:446`、`:450` | W2-18 | old-A/new-A 仍直接 `rawBodies.put`。这正是 TQ-114 点名要求删除的前置写法（`.lead-ref/books/t-items-TQ.md:752`），并非完成转换。 | 在真实 owner 存在后，通过真实 `materials.storeArtifact` 写入；执行材料使用对应 Run 上下文和 execution origin，平台材料使用 Host 上下文。缺正文子例继续不写 old-A。公开入口及来源检查见 `src/core/work-graph/materials/material-service.ts:119`、`:138`、`:151`。 |
| Q1-04 | 违规 | `tests/work-graph/S3-context-inputs.test.ts:480`、`:492`、`:673` | W2-18 | 消息确实公开发送了，但响应和读取使用的是测试预先重建的 `messageRef`，不是发送返回的引用。正确的手算字面量不解除 R-8 的“按返回值使用”要求（`.lead-ref/t-w1r1-findings.md:18`，`.lead-ref/books/test-rule-sheet-v2.md:32`）。 | 手算消息 ID 只用于冻结的 Plan 标签和独立断言；发送成功后，以 `sent.value.ref` 原值供响应、版本 pin 和公开读取使用。 |
| Q1-05 | 违规 | `tests/work-graph/S3-context-inputs.test.ts:628` | W2-19 | IN11 手写 `exitCode:0`、stdout、effects 和 sandbox 版本，再调用 `recordCheckResult`。实际只创建了 `src/a.ts`，没有创建登记命令所需的 `check-b.js`（同文件 `:580`、`:584`）。TQ-115 明确要求真实 runner 完成 begin 和结果记录（`.lead-ref/books/t-items-TQ.md:761`），不是直接提交成功观察。 | 创建真实登记脚本，调用 `createRegisteredCheckRunner(...).runRegisteredCheck`，使用真实 Kernel 沙箱，再 finalize；删除手写 observation 和直接 begin/result 调用。生产执行及观察来源见 `src/core/agent-runtime/check-execution.ts:172`、`:234`、`:241`。 |
| Q1-06 | 违规 | `tests/work-graph/S3-context-inputs.test.ts:854`、`:859` | W2-19 | revision 的推导已写，但报告类型没有独立期望或推导；整个报告引用取自 `recordCheckResult` 返回值（同文件 `:638`、`:646`）。W2-19 同时要求手算 revision **和报告类型**（`.lead-ref/t-w1r1-findings.md:53`）。 | 保留选择结果与真实报告引用的关联比较，另用字面量断言 `contentType` 为 `application/vnd.coding-platform.verification-check-report+json;version=1`，并注明报告由 registered-check-report 写入产生；不要导入生产常量充当期望。依据：`src/core/work-graph/evidence/evidence-service.ts:832`、`:847`，`src/contracts/no-progress.ts:25`。 |
| Q1-07 | 违规 | `tests/work-graph/S3-graph-context.test.ts:364`、`:510` | W2-24 | 所谓“手推 Session ID”实际是在测试运行时调用生产 `canonicalJson`、`sha256Hex` 重新计算，没有三个手算字面量及其展开过程。与本行及手算期望要求不符（`.lead-ref/t-w1r1-findings.md:66`，`.lead-ref/books/t-run-W1R2.md:33`）。 | 删除 `derivedSessionId`，写入下述三个独立复算的字面量及规范 JSON 输入；逐个校验公开创建返回的 ID，并保留不含 `b` 的检查。后续操作继续使用公开返回的引用。 |
| Q1-08 | 不整洁 | `.lead-ref/replies/t-reply-W1R2.md:89` | W2-24 | 台账误配判断成立，但回复写错文件及归属行：实际是 `S3-graph-context.test.ts:917`、W2-24，不是 `R4c-graph-history.test.ts`、W2-17。台账原文见 `.lead-ref/replies/ledger-W1R2.txt:9`；严格等值和排除断言同时保留于 `tests/work-graph/S3-graph-context.test.ts:916`、`:917`。 | 只修回复中的文件路径及映射为 W2-24；不改这两条断言。 |

逐行结论：

- W2-18：Q1-01、Q1-02、Q1-03、Q1-04。
- W2-19：Q1-05、Q1-06。
- W2-24：Q1-07、Q1-08。

复算和保留项核对：

- **GR Session ID：算法和排序正确，写法不符合手算字面量要求。** 按 `src/core/work-graph/sessions/session-directory.ts:140` 和 `src/contracts/fingerprint.ts:45`，规范输入为 `{"actor":{"id":"u","kind":"human"},"projectId":"p","requestId":"…"}`；对三个指定 requestId（`tests/work-graph/S3-graph-context.test.ts:517`）独立复算如下，均不含 `b`，字典序为 A、B、Q。

  | Session | 完整 ID |
  |---|---|
  | A，`gr-session-88` | `session-2756a7606765207ade5e4a1939f9f49472a6af969cf7910d74a4719cd799ce73` |
  | B，`gr-session-92` | `session-51c986a1fca760447cad3a47f0786809fd73d20318d8c6c6c439e282d170d79a` |
  | Q，`gr-session-44` | `session-dcf115308e5f3d0062a8d7e00ce65a374476573c8356d8414c43f4d70a3cd3a9` |

- **IN14 消息字面量正确，推导输入有注释。** sender Session 独立复算为文件所写 `session-20b96b90…f2a97`；首次占用 generation 为 `1+1=2`（`src/core/work-graph/state/session-availability.ts:230`）。按 sender identity 和消息算法（`src/core/work-graph/communication/mailbox-service.ts:712`、`:750`）复算得到 `session-message-66ca4e44a5c1869536b0cbbee954fd534c8e82e6650e79b1628f69464acca4a4`，与字面量一致，工作过程记录于 `tests/work-graph/S3-context-inputs.test.ts:129`、`:145`。真实 send、reply、finish 已接入（同文件 `:482`、`:491`、`:497`）。
- **IN11 revision 4 正确，删除 `newRef` 期望有授权。** open@1、begin 加一、result 加一、finalize 加一，分别对应 `src/core/work-graph/state/verification-machine.ts:908`、`:971`、`:1019`；测试注释已写出这个过程（`tests/work-graph/S3-context-inputs.test.ts:854`）。B-13 允许修改原 revision 和报告类型（`.lead-ref/t-w1-findings.md:145`）；剩余问题是 Q1-05、Q1-06。
- **GR 的主要转换和指定断言保留成立。** `finish` 在 stage 外，映射到原 oB，tA/tB、vB、依赖边和指令保留（`tests/work-graph/S3-graph-context.test.ts:329`、`:333`、`:337`、`:341`、`:346`）；两 Run 真实结束后分别 openVerification（同文件 `:580`、`:587`、`:638`、`:643`）。GR06/07 顺序、GR17 完整 SB 搜索及 M2 排除符合裁定（同文件 `:939`、`:959`、`:1193`、`:948`）。GR01、GR02、GR10、GR19 的指定断言保留（同文件 `:875`、`:886`、`:1124`、`:1256`、`:1273`）。
- **Q1 使用的共享 Runtime 新选项均可选，默认分支未改变。** `beforeBegin` 缺省直接用原 owner，`kernelStores` 缺省创建原 registry，Workspace revision 缺省仍为 1（`tests/helpers/S2B-runtime-steps-fixture.ts:91`、`:97`、`:104`、`:210`、`:266`、`:284`）。

Q1 的未完成部分及可达性：

| 行 | 部分 | DSH 理由是否成立 | 公开步骤是否可达 |
|---|---|---|---|
| W2-18 | 删除 runA2 | **只证明了第二次 first-claim 被拒，未证明第二个 Run 不可达。** 拒绝仅在 first 分支，requeue 分支仍存在（`src/core/work-graph/state/run-machine.ts:643`、`:649`）。 | 可达：completed Run 的真实 FAIL 验收形成 `check_failed`，允许 requeue，再携 requeueRef claim（`src/core/work-graph/state/task-failure.ts:325`、`:439`；`tests/work-graph/R4c-task-claim-concurrency.test.ts:137`、`:146`）。 |
| W2-18 | scope、材料前置 | 回复标 done，没有给出这些步骤的 BLOCKED 理由（`.lead-ref/replies/t-reply-W1R2.md:26`）；raw 写入仍在（`tests/work-graph/S3-context-inputs.test.ts:286`、`:446`）。 | 可达：公开 bootstrap 和材料 owner 已存在（`tests/helpers/task-claim-fixture.ts:241`、`:245`；`src/core/work-graph/materials/material-service.ts:119`）。 |
| W2-19 | 真实检查链 | 回复标 done，但使用手写观察，不能算真实 runner 转换完成（`.lead-ref/replies/t-reply-W1R2.md:27`；`tests/work-graph/S3-context-inputs.test.ts:628`）。 | 可达：`runRegisteredCheck` 自行 begin、执行登记命令、记录真实结果（`src/core/agent-runtime/check-execution.ts:172`、`:234`、`:263`）。 |

```json
[
  {
    "id": "Q1-01",
    "class": "违规",
    "file": "tests/work-graph/S3-context-inputs.test.ts",
    "line": 778,
    "row": "W2-18",
    "problem": "IN05 将基线的 runA2→runA 改成 runB→runA，并省去第三个 Run；冻结表 .lead-ref/t-w1r1-findings.md:52 未授权此改变。src/core/work-graph/state/run-machine.ts:646 只拒绝第二次 first-claim，:649 仍允许 requeue claim。当前用例仍触发 applicability.ts:69 的完整引用检查，不能据此判为假通过。",
    "fix": "恢复 IN05 的 runA2→runA 输入；该子例经真实 completed Run、真实 FAIL 验收、公开 requeue、携返回 requeueRef 的第二次 claim 和真实 finish 产生 runA2，保留 forbidden 断言。"
  },
  {
    "id": "Q1-02",
    "class": "违规",
    "file": "tests/work-graph/S3-context-inputs.test.ts",
    "line": 286,
    "row": "W2-18",
    "problem": "Project 和两个 Workspace 仍用 commitRaw 手写，Workspace@7 仍是手写检查点；未完成 .lead-ref/books/t-items-TQ.md:751 要求的公开初始化转换。",
    "fix": "公开 createProject 和 registerWorkspace；通过真实 Session 与 setLinePins 推进所需 Workspace 版本，删除三条 raw snapshot。"
  },
  {
    "id": "Q1-03",
    "class": "违规",
    "file": "tests/work-graph/S3-context-inputs.test.ts",
    "line": 446,
    "row": "W2-18",
    "problem": "446、450 行仍直接 rawBodies.put 写 old-A/new-A，违反 .lead-ref/books/t-items-TQ.md:752 的明确改法。",
    "fix": "真实 owner 存在后通过 materials.storeArtifact 写材料，使用匹配的 Run 或 Host 上下文及来源；缺正文子例继续不写 old-A。"
  },
  {
    "id": "Q1-04",
    "class": "违规",
    "file": "tests/work-graph/S3-context-inputs.test.ts",
    "line": 480,
    "row": "W2-18",
    "problem": "480 行重建的 messageRef 被用于492行响应和673行读取，没有按 .lead-ref/t-w1r1-findings.md:18 的 R-8 使用真实发送返回的引用。",
    "fix": "字面量只用于 Plan 标签和独立期望；响应、版本 pin、读取全部使用 sent.value.ref 原值。"
  },
  {
    "id": "Q1-05",
    "class": "违规",
    "file": "tests/work-graph/S3-context-inputs.test.ts",
    "line": 628,
    "row": "W2-19",
    "problem": "IN11 手写成功 CheckProcessObservation，再直接 recordCheckResult；未按 .lead-ref/books/t-items-TQ.md:761 使用真实 runRegisteredCheck。580行只创建 src/a.ts，584行登记的 check-b.js 没有创建。",
    "fix": "创建真实登记脚本，通过真实 Kernel 的 runRegisteredCheck 完成 begin、进程执行及结果记录，再 finalize；删除手写 observation 和直接 begin/result 调用。"
  },
  {
    "id": "Q1-06",
    "class": "违规",
    "file": "tests/work-graph/S3-context-inputs.test.ts",
    "line": 854,
    "row": "W2-19",
    "problem": "只写出了 revision 4 的推导，没有 .lead-ref/t-w1r1-findings.md:53 要求的独立报告类型期望及推导；859行的 reportRef 全部来自638、646行的程序返回值。",
    "fix": "保留真实报告引用的关联比较，另以字面量断言 contentType 为 application/vnd.coding-platform.verification-check-report+json;version=1，并注释 registered-check-report 的产生过程，不导入生产常量作期望。"
  },
  {
    "id": "Q1-07",
    "class": "违规",
    "file": "tests/work-graph/S3-graph-context.test.ts",
    "line": 364,
    "row": "W2-24",
    "problem": "derivedSessionId 在运行时调用生产 canonicalJson、sha256Hex 生成期望，510行再比较；没有 .lead-ref/t-w1r1-findings.md:66 要求的三个手算字面量和展开过程。",
    "fix": "删除 derivedSessionId，写入独立复算的三个 Session ID 字面量及规范 JSON 输入；逐个校验公开返回 ID，保留不含 b 的检查，后续操作仍使用公开返回引用。"
  },
  {
    "id": "Q1-08",
    "class": "不整洁",
    "file": ".lead-ref/replies/t-reply-W1R2.md",
    "line": 89,
    "row": "W2-24",
    "problem": "台账误配判断正确，但文件和行归属写错。ledger-W1R2.txt:9 实际指向 S3-graph-context.test.ts:917；严格等值及排除断言仍同时存在于该文件916、917行。",
    "fix": "将回复路径改为 tests/work-graph/S3-graph-context.test.ts，映射改为 W2-24，不修改断言。"
  }
]
```

会出错 0，违规 7，不整洁 1，建议 0