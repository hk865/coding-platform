本次仅作静态只读审查，未运行测试或构建。

保留 TP 版没有遗漏 TQ-091 所需的 catalog 行：夹具调用真实 `adoptInitialArchitecture`，该入口在同一次提交中写入 baseline、catalog 和活动指针。证据：`tests/helpers/S5-decision-fixture.ts:581`，`src/core/work-graph/architecture/catalog-service.ts:524`、`:547`。

1. 发现表

| 编号 | 类别 | 位置 | 条目 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| G5-01 | 违规 | `tests/helpers/S2B-track-fixture.ts:356`、`:398` | TP-096 | track 只复用了策略安装（`:81`、`:264`）；进入仍手造 position/history（`:359`），结束仍手造终止事件和 observation（`:368`、`:391`）。没有完成两份夹具共享真实 start、闸门、finish 的书面改正，仍有 F3/F6。依据：`.lead-ref/books/t-items-TP.md:706`，`.lead-ref/books/test-rule-sheet-v1.md:64`、`:73`。 | 将 track 的 enter/end 接入 `S2B-runtime-steps-fixture.ts:104`、`:106` 的 start/finish，保存对应 Run handle，删除这段手写进入、结束事实；保留调用方断言和期望值。 |
| G5-02 | 违规 | `tests/helpers/S5-decision-fixture.ts:829`、`:831`、`:839` | TP-100 | 新 helper 接收 `PlanRevisionDraft`，把 `futureDraft(...)` 的手造结果交给 owner 接受后继续场景，仍属 F1，也违反 A1 的 helper 输入限制。依据：`.lead-ref/books/test-rule-sheet-v1.md:24`、`:57`。条目点名 proposePlan 不构成豁免，施工簿明确要求这种冲突标 BLOCKED：`.lead-ref/books/t-book.md:65`。 | 撤回该转换并标 BLOCKED；待 lead 冻结脚本模型调用真实提案工具的流程后施工。不能通过内联 draft 或改 helper 名称消除问题。 |
| G5-03 | 违规 | `tests/helpers/S5-decision-fixture.ts:846`、`:857` | TP-101 | 新增 `builder/1 → decisionDuty` 特例，默认 adviser（`:849`）；书面改正要求与生产相同的 legacyDuty 匹配（`.lead-ref/books/t-items-TP.md:743`）。生产仍只匹配五种正式模板，且与基线相同：`src/composition/create-platform.ts:804`、`.lead-ref/base/src/composition/create-platform.ts:812`。另，发送所用 runRA（夹具`:882`）仍由手写 entered/history 建立（`:745`），不能把这条初始化链认作完整 A1。 | 撤回 fixture 专用映射及这段转换，将 TP-101 标 BLOCKED；由 lead 冻结真实角色、Session 和 Runtime 前置流程后再施工。生产匹配保持不变。 |
| G5-04 | 违规 | `tests/helpers/S5-queue-support.ts:300` | TP-104 | 新断言以 `installed.ref`——程序刚返回的值——作为期望值，命中 F8。依据：`.lead-ref/books/test-rule-sheet-v1.md:78`。 | 将期望值改为同文件`:288` 已手写确定的 `policyRef`。 |
| G5-05 | 不整洁 | `tests/helpers/S2B-track-fixture.ts:32`、`:33`、`:34`、`:36`、`:37` | TP-009、TP-054、TP-096 | 本轮删除使用点后，以下名字只剩 import：`JsonValue`、`continuationBriefDigest`、`renderContinuationBriefZh`、`assembleAnomalySection`、`assembleContinuationBrief`、`PreparedQueryManifestV1`、`PreparedTaskManifestV1`、`QUERY_MANIFEST_CONTENT_TYPE`。 | 仅删除这些失去使用点的导入名。 |
| G5-06 | 不整洁 | `tests/helpers/S2C-L-runs-support.ts:21`、`:22`、`:26`、`:44`、`:52`、`:53` | TP-009、TP-054 | 本轮转换后只剩 import：`PreparedTaskManifestV1`、`PreparedQueryManifestV1`、`TaskEnvelopeV1`、`MANIFEST_CONTENT_TYPE`、`QUERY_MANIFEST_CONTENT_TYPE`、`sha256Hex`。 | 仅删除这些失去使用点的导入名。 |
| G5-07 | 不整洁 | `tests/helpers/S2C-X-scale-fixture.ts:54`、`:55`、`:66`、`:77` | TP-009、TP-054 | 本轮转换后只剩 import：`PreparedTaskManifestV1`、`TaskEnvelopeV1`、`artifactBodyDigest`、`MANIFEST_CONTENT_TYPE`。 | 仅删除这些失去使用点的导入名。 |
| G5-08 | 不整洁 | `tests/helpers/S5-decision-fixture.ts:50`、`:81`、`:83`、`:122`、`:123`、`:124`、`:129` | TP-009、TP-054、TP-101 | 本轮转换后只剩 import：`ArtifactRef`、`SESSION_MESSAGE_CONTENT_TYPE`、`encodeSessionMessageRecord`、`encodeSessionMessageSentEvent`、`encodeSessionMessageRespondedEvent`、`RoleSpecResolutionV1`、`PreparedTaskManifestV1`、`TaskEnvelopeV1`、`MANIFEST_CONTENT_TYPE`。 | 仅删除这些失去使用点的导入名。 |
| G5-09 | 不整洁 | `tests/helpers/S5-queue-support.ts:9`、`:29`、`:30` | TP-009、TP-054 | 本轮转换后只剩 import：`PreparedQueryManifestV1`、`PreparedTaskManifestV1`、`MANIFEST_CONTENT_TYPE`、`QUERY_MANIFEST_CONTENT_TYPE`。 | 仅删除这些失去使用点的导入名。 |
| G5-10 | 不整洁 | `tests/helpers/S2B-track-fixture.ts:21`；`tests/helpers/S5-decision-fixture.ts:20`、`:42`、`:267`、`:269` | TP-097、TP-099、TP-101、TP-103、TP-154 | track 仍说明已删除的 strip-since/finalizedAt 写法（`:21`、`:26`）。S5 仍说明旧消息 pins、默认不调用 slice-5 owner、默认采用手写 baseline；实际已调用 catalog/mailbox/decision owner（`:581`、`:884`、`:898`），对象 pins 已改（`:879`）。新增 pausedB 注释说“首次 claim 前暂停”（`:269`），实际仍先 claim、再暂停（`:785`、`:789`）。 | 按实际保留的流程更新这些注释；pausedB 只改说明，不改变继承自原副本的执行顺序。 |

2. 逐条结论

以下结论仅覆盖 G5 的改动及其必要覆盖核对；OK 不代表该条目的组外部分已通过审查。

- TP-006: OK（`.lead-ref/groups/G5.diff:2156`、`:3022`）
- TP-009: G5-05、G5-06、G5-07、G5-08、G5-09
- TP-015: OK（`tests/helpers/S5-decision-fixture.ts:810`）
- TP-050: OK（`.lead-ref/groups/G5.diff:97`、`:253`、`:284`、`:526`、`:539`、`:548`、`:561`、`:574`、`:715`）
- TP-054: G5-05、G5-06、G5-07、G5-08、G5-09
- TP-063: OK（`.lead-ref/groups/G5.diff:2022`、`:2120`、`:2138`）
- TP-096: G5-01、G5-05
- TP-097: G5-10
- TP-098: OK（`.lead-ref/groups/G5.diff:288`、`:326`；保留的当前分页断言：`tests/work-graph/S2C-lines-page.test.ts:96`）
- TP-099: G5-10
- TP-100: G5-02
- TP-101: G5-03、G5-08、G5-10
- TP-102: OK（`tests/helpers/S5-decision-fixture.ts:185`；`.lead-ref/groups/G5.diff:637`、`:661`、`:685`、`:694`）
- TP-103: G5-10
- TP-104: G5-04
- TP-105: OK（`tests/helpers/S5-decision-fixture.ts:569`、`:603`；`tests/helpers/S5R2-c-support.ts:41`）
- TP-106: OK（`tests/helpers/S5-decision-fixture.ts:475`、`:676`；`tests/runtime/S5R2-agent-application.test.ts:67`）
- TP-154: G5-10
- TP-161: OK（`.lead-ref/groups/G5.diff:326`）
- TP-162: OK（`.lead-ref/groups/G5.diff:288`；`tests/work-graph/S2C-lines-page.test.ts:96`）
- TQ-091: OK（仅合并交叉点：`tests/helpers/S5-decision-fixture.ts:581`；`src/core/work-graph/architecture/catalog-service.ts:547`）

TP-107、TP-108 的条目主体是 `task-claim-fixture.ts`，不在 G5 文件清单中；不以本组结论替代其审查。依据：`.lead-ref/books/t-items-TP.md:784`、`.lead-ref/replies/t-reply-TP.md:197`。

3. BLOCKED 和部分完成项

| 条目 | 部分 | DSH 理由是否成立 | 公开步骤可达性 |
|---|---|---|---|
| TP-099 | Project@1；夹具`:560` 的 Project/Workspace 联合 seed | **按书等待冻结成立。** 回复准确列出保留位置（`.lead-ref/replies/t-reply-TP.md:196`），书面改正要求检查点暂不施工（`.lead-ref/books/t-items-TP.md:728`）。但不能解释为 Project@1 本身不可达。 | **可达：createProject。** 直接构造 Project@1 并提交：`src/core/work-graph/configuration/project-bootstrap-service.ts:574`、`:588`。 |
| TP-099 | Workspace@3，显式保存 `decisionSettings: {schemaVersion:1, noticeSeen:{}}`；夹具`:557`、`:559`、`:560` | **精确存储形状不可达的理由成立。** registerWorkspace 只建立不含 decisionSettings 的 Workspace@1：`src/core/work-graph/configuration/project-bootstrap-service.ts:669`。 | **该精确形状不可达。** markNoticesSeen 只有至少一次向前移动才写入；写入时 noticeSeen 已含类别位置，无移动则不写：`src/core/work-graph/state/notice-settings-machine.ts:53`、`:57`、`:60`、`:62`。提高 revision 不能补出这个显式空字段。 |
| TP-099 | 采用前 Goal@6；pausedB 分支为 B@5；夹具`:595`、`:599` | **“版本映射尚未冻结”成立；“没有公开到达路径”不成立。** 保留 seed 符合书面 BLOCKED 指令（`.lead-ref/books/t-items-TP.md:728`），不另报违规。 | **可达：createGoal → reorderGoals → setGoalSettings。** 创建从@1开始；reorder 仅改需要调整的 Goal；合法 settings_set 会提交并增加 revision，保留其他字段。证据：`src/core/work-graph/state/goal-machine.ts:90`，`src/core/work-graph/tasks/goal-settings-service.ts:506`，`src/core/work-graph/state/goal-settings-machine.ts:196`、`:233`。使用新 requestId 和当前 pins 可逐步到@5/@6，具体映射仍应由 lead 冻结。 |
| TP-009、TP-054 | ctx 回复曾列 S2B-track requeue 为 BLOCKED | **不再是当前保留阻塞。** 早期报错见 `.lead-ref/replies/t-reply-TP-ctx.md:34`；同回复`:43` 已说明撤去重复 continuation brief。当前代码确实直接使用真实 prepare，不再追加第二份：`tests/helpers/S2B-track-fixture.ts:340`。 | **真实 prepare 可达：** `b2.buildPrepared`（`tests/helpers/S2B-track-fixture.ts:342`）。这不证明真实进入/结束转换完成；后者仍是 G5-01。 |

上述 TP-099 检查点仍保留在 `tests/helpers/S5-decision-fixture.ts:560`、`:599`，没有用新名称绕过 BLOCKED。

4. 同一发现表的 JSON

```json
[
  {
    "id": "G5-01",
    "class": "违规",
    "file": "tests/helpers/S2B-track-fixture.ts",
    "line": 356,
    "item": "TP-096",
    "problem": "只复用了策略安装；:356仍手写entered的position/history，:368和:391构造终止事件及observation，:398调用recordRunResult，未完成t-items-TP.md:706要求的共享真实start/闸门/finish，仍有F3/F6。",
    "fix": "将track enter/end接入S2B-runtime-steps-fixture.ts:104、:106的start/finish，保存Run handle，删除该范围手写进入和结束事实，保留调用方断言及期望值。"
  },
  {
    "id": "G5-02",
    "class": "违规",
    "file": "tests/helpers/S5-decision-fixture.ts",
    "line": 829,
    "item": "TP-100",
    "problem": "新helper接收PlanRevisionDraft，:831把:839、:840的手造futureDraft交给owner接受后继续场景，违反规则表A1及F1。t-book.md:65规定条目点名owner也不豁免。",
    "fix": "撤回该转换并标BLOCKED，待lead冻结脚本模型调用真实提案工具的流程后施工；不得用内联draft或改名代替修复。"
  },
  {
    "id": "G5-03",
    "class": "违规",
    "file": "tests/helpers/S5-decision-fixture.ts",
    "line": 857,
    "item": "TP-101",
    "problem": "新增builder/1到decisionDuty的特例，:849默认adviser，违反t-items-TP.md:743要求的生产相同legacyDuty匹配。生产create-platform.ts:804与base版本:812仍仅匹配五种正式模板。发送所用runRA在夹具:745仍由手写entered/history建立，整条初始化也未满足A1。",
    "fix": "撤回fixture专用映射及这段转换，将TP-101标BLOCKED；由lead冻结真实角色、Session和Runtime前置流程后再施工，保持生产匹配不变。"
  },
  {
    "id": "G5-04",
    "class": "违规",
    "file": "tests/helpers/S5-queue-support.ts",
    "line": 300,
    "item": "TP-104",
    "problem": "新增断言把程序返回的installed.ref用作期望值，违反test-rule-sheet-v1.md:78的F8。",
    "fix": "把期望值改为同文件:288已手写确定的policyRef。"
  },
  {
    "id": "G5-05",
    "class": "不整洁",
    "file": "tests/helpers/S2B-track-fixture.ts",
    "line": 32,
    "item": "TP-009、TP-054、TP-096",
    "problem": ":32、:33、:34、:36、:37的JsonValue、continuationBriefDigest、renderContinuationBriefZh、assembleAnomalySection、assembleContinuationBrief、PreparedQueryManifestV1、PreparedTaskManifestV1、QUERY_MANIFEST_CONTENT_TYPE在本轮删除使用点后只剩import。",
    "fix": "仅删除这些失去使用点的导入名。"
  },
  {
    "id": "G5-06",
    "class": "不整洁",
    "file": "tests/helpers/S2C-L-runs-support.ts",
    "line": 21,
    "item": "TP-009、TP-054",
    "problem": ":21、:22、:26、:44、:52、:53的PreparedTaskManifestV1、PreparedQueryManifestV1、TaskEnvelopeV1、MANIFEST_CONTENT_TYPE、QUERY_MANIFEST_CONTENT_TYPE、sha256Hex在本轮转换后只剩import。",
    "fix": "仅删除这些失去使用点的导入名。"
  },
  {
    "id": "G5-07",
    "class": "不整洁",
    "file": "tests/helpers/S2C-X-scale-fixture.ts",
    "line": 54,
    "item": "TP-009、TP-054",
    "problem": ":54、:55、:66、:77的PreparedTaskManifestV1、TaskEnvelopeV1、artifactBodyDigest、MANIFEST_CONTENT_TYPE在本轮转换后只剩import。",
    "fix": "仅删除这些失去使用点的导入名。"
  },
  {
    "id": "G5-08",
    "class": "不整洁",
    "file": "tests/helpers/S5-decision-fixture.ts",
    "line": 50,
    "item": "TP-009、TP-054、TP-101",
    "problem": ":50、:81、:83、:122、:123、:124、:129的ArtifactRef、SESSION_MESSAGE_CONTENT_TYPE、encodeSessionMessageRecord、encodeSessionMessageSentEvent、encodeSessionMessageRespondedEvent、RoleSpecResolutionV1、PreparedTaskManifestV1、TaskEnvelopeV1、MANIFEST_CONTENT_TYPE在本轮转换后只剩import。",
    "fix": "仅删除这些失去使用点的导入名。"
  },
  {
    "id": "G5-09",
    "class": "不整洁",
    "file": "tests/helpers/S5-queue-support.ts",
    "line": 9,
    "item": "TP-009、TP-054",
    "problem": ":9、:29、:30的PreparedQueryManifestV1、PreparedTaskManifestV1、MANIFEST_CONTENT_TYPE、QUERY_MANIFEST_CONTENT_TYPE在本轮转换后只剩import。",
    "fix": "仅删除这些失去使用点的导入名。"
  },
  {
    "id": "G5-10",
    "class": "不整洁",
    "file": "tests/helpers/S5-decision-fixture.ts",
    "line": 20,
    "item": "TP-097、TP-099、TP-101、TP-103、TP-154",
    "problem": "S2B-track-fixture.ts:21、:26仍说明已删除的旧round篡改。S5-decision-fixture.ts:20、:42、:267仍说明旧消息pins、不调用slice-5 owner和手写baseline，但:581、:879、:884、:898已改变这些行为；:269说首次claim前暂停，实际:785先claim、:789后暂停。",
    "fix": "按实际保留流程更新注释；pausedB仅改说明，不改变原副本执行顺序。"
  }
]
```

会出错 0，违规 4，不整洁 6，建议 0