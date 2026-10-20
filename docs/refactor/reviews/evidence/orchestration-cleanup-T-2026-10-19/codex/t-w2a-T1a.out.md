只读静态审查完成；未修改文件、运行测试或构建，也未联网。

发现表：

| 编号 | 类别 | 位置（file:line） | 条目 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| T1a-01 | 违规 | `tests/work-graph/K3-16-second-unfinished-proposal.test.ts:108`、`:116` | T1-020 | 源首轮场景断言总轮数为 1、`round:1`（`.lead-ref/base/tests/work-graph/K3-16-proposal-round-fixture.test.ts:131`、`:132`）；目标改为筛选 proposal 后计数，并断言 `round:2`。条目明确要求迁入 `round:1`（`.lead-ref/books/t-items-T1.md:132`），回报也承认自行改值（`.lead-ref/replies/t-reply-T1.md:193`）。 | 将源首轮场景及原断言完整迁入目标，保留总轮数 1 和 `round:1`；目标已有的 review→proposal 场景另行保留，不能代替源场景。 |
| T1a-02 | 会出错 | `tests/work-graph/S4C2-D-rows.test.ts:280`、`:282` | T1-049 | 参数表只变化锚点（同文件 `:34`），没有保留源组合：用户注记 `goalId:null`、双方均为 `pitfall`（`.lead-ref/base/tests/work-graph/S4C-note-protection.test.ts:21`、`:259`、`:262`）。具体漏测输入是“文件锚点、无 Goal 的用户 pitfall，被 agent pitfall 同时列入 replaces/coexistWith”。若此组合错误地返回 `pending_review`，现有行仍会通过，因为用户均绑定 Goal、agent 均为 `decision`。书面改正要求保留两套完整组合（`.lead-ref/books/t-items-T1.md:349`）。 | 参数化完整组合，至少包含用户 `goalId` 和 agent `kind`；文件行恢复 `null/pitfall`，Goal 行保持原组合，两种后端都执行现有全部保留断言。 |
| T1a-03 | 违规 | `tests/work-graph/A2-disposition-change.test.ts:677`、`:689` | T3-106 | guard 9 竞争被错误判为只能篡改 ended Run，仍调用手写 `humanStop`。该草稿保留 B、只增加 B2（同文件 `:643`）；guard 9 不要求 B 已结束（`src/core/work-graph/state/plan-machine.ts:750`）。真实运行中的 B 可以产生相同的“读取后人工 stop 改变 Run pin”竞争。 | 用 `startHeld('B')` 建立真实 Run，在已有 `plan-apply:` 提交门处，通过公开读取取得的 revision 调用 `steps.controls.submitControl(cancel)`；不投递控制、不结束 Run，保持 Lease 不变，保留 revision_conflict、公开未变检查及重读 forbidden 的全部断言。 |
| T1a-04 | 违规 | `tests/work-graph/A2-disposition-change.test.ts:591`；`.lead-ref/replies/t-reply-T1.md:95` | T3-106 | “unknown 只能靠 A7 Kernel 损坏产生”的理由不实：missing Kernel 后重启已有真实路径（`tests/scenarios/S2C-K-unknown-outcome.test.ts:50`）。但原行还要求 released Lease（A2 文件 `:594`），真实 unknown 保留 Lease（`src/core/work-graph/state/run-machine.ts:2318`），所以完整组合仍应 BLOCKED。 | 保留原 BLOCKED 行；将注释及回报理由改为 **unreachable：unknown + released Lease 的隔离组合无公开路径**。不得直接换成 unknown + held 来绕过原输入。 |
| T1a-05 | 违规 | `tests/work-graph/A2-disposition-change.test.ts:635`、`:671`、`:705` | T3-106 | 已转换拒绝行未放入 `describe('rejects: …')`；guard 9 在拒绝后直接进行 operator 成功采用，没有先公开读取证明未变（同文件 `:671`、`:674`）。刷新明确要求拒绝行遵守 A6（`.lead-ref/books/t-items-T1.md:614`）；A6 同时规定分组、拒绝断言和公开未变检查（`.lead-ref/books/test-rule-sheet-v1.md:45`）。 | 将已转换拒绝分支置于 `rejects:` 分组，并在 guard 9 的拒绝与 operator 采用之间补公开未变断言；保留所有现有业务断言。 |
| T1a-06 | 违规 | `tests/scenarios/S3-query-graph.test.ts:168` | T2-051 | 冻结动作要求 history 断言改用 tA 的真实平台 `runId`（`.lead-ref/books/t-items-T1.md:553`），实际自行换成 Kernel `runId`，并仍报 done（`.lead-ref/replies/t-reply-T1.md:71`、`:195`）。公开读取 Kernel locator 本身合法；问题是未经书面改正替换了断言对象。书与接口不符时须 BLOCKED（`.lead-ref/books/t-book.md:31`）。 | 撤回此处未经批准的转换，连同维持原子段所需的前置恢复保留；将 history 子段列为 BLOCKED，提交接口证据，待 lead 书面更正冻结条目后再转换。 |
| T1a-07 | 违规 | `tests/scenarios/A7-control.test.ts:451` | T1-005 | 源测试名有 `RUN-14`（`.lead-ref/base/tests/work-graph/A2-control-service.test.ts:277`），目标只在注释保留它（A7 文件 `:496`），测试名缺失；不满足合并后规格号进入目标测试名的要求（`.lead-ref/books/t-book.md:62`）。 | 仅给目标测试名补入 `RUN-14`，保留正文。 |
| T1a-08 | 违规 | `tests/work-graph/S2C-lines-tiers.test.ts:155` | T1-037 | 源测试名的 `2C-12 (9)`（`.lead-ref/base/tests/work-graph/S2C-lines-attention.test.ts:216`）未迁入目标测试名；违反 `.lead-ref/books/t-book.md:62`。 | 给目标测试名补入 `2C-12 (9)`。 |
| T1a-09 | 违规 | `tests/work-graph/S5R2-queue-history.test.ts:127` | T1-056 | 被合并源测试的 `R2A08`（`.lead-ref/base/tests/work-graph/S5R2-queue-history.test.ts:141`）未保留在目标测试名；违反 `.lead-ref/books/t-book.md:62`。 | 给现有 201 Goals 用例名补入 `R2A08`；不恢复已取消的 200 上限断言。 |
| T1a-10 | 不整洁 | `tests/work-graph/S4C2-D-rows.test.ts:110` | T1-052 | 标题仍称 `and supersedes it`，正文现已在卡片选项断言后结束（同文件 `:122`、`:123`）。supersede 覆盖保留在 `tests/work-graph/S4C2-D17.test.ts:53`，不是漏测。 | 从 D-06 标题删去 `and supersedes it`。 |
| T1a-11 | 违规 | `tests/work-graph/A2-disposition-change.test.ts:171`、`:707`、`:787`、`:812` | T3-106 | 此次转换的 service 行仍硬编码 memory。规则要求 service 行覆盖 memory 和 SQLite（`.lead-ref/books/test-rule-sheet-v1.md:94`）；v2 保留此规则并约束整个 wave 2（`.lead-ref/books/test-rule-sheet-v2.md:4`、`:20`）。 | 仅对本条已转换的 service 行参数化 memory/sqlite，并贯穿 fixture；不扩大到未转换纯函数块或仍 BLOCKED 的种子行。 |

逐条结果如下。这里的 OK 表示本分片未发现问题；合法保留的 partial 不因此算作完成。

- T1-001: OK（`.lead-ref/parts/T1a.diff:155`）
- T1-003: OK（`tests/helpers/task-claim-fixture.ts:362`）
- T1-004: OK（`tests/app/A2-continuation-projection.test.ts:111`）
- T1-005: T1a-07（`tests/scenarios/A7-control.test.ts:451`）
- T1-007: OK（`.lead-ref/parts/T1a.diff:3167`）
- T1-008: OK（`tests/work-graph/B2-17-disposition-reads.test.ts:34`）
- T1-009: OK（`tests/work-graph/B2-11-script-expansion.test.ts:272`）
- T1-010: OK（`tests/work-graph/B2-11-script-expansion.test.ts:132`、`:252`）
- T1-011: OK（`tests/work-graph/B2-11-script-expansion.test.ts:209`）
- T1-012: OK（`tests/work-graph/B2-12-recognition.test.ts:25`）
- T1-020: T1a-01（`tests/work-graph/K3-16-second-unfinished-proposal.test.ts:116`）
- T1-024: OK（`tests/work-graph/R3b-material-applicability.test.ts:39`）
- T1-025: OK（`tests/work-graph/R3d-fixture.ts:84`；保留部分见下表）
- T1-033: OK（`tests/state/S5-message-decision.test.ts:123`）
- T1-034: OK（`tests/work-graph/S1-codecs-indexes.test.ts:146`；`.lead-ref/parts/T1a.diff:4388`）
- T1-037: T1a-08（`tests/work-graph/S2C-lines-tiers.test.ts:155`）
- T1-038: OK（`tests/work-graph/S2C-lines-failure.test.ts:140`、`:212`）
- T1-039: OK（`.lead-ref/parts/T1a.diff:4692`）
- T1-041: OK（`tests/work-graph/S4C-node-notes.test.ts:106`、`:115`）
- T1-042: OK（`tests/work-graph/S4A-note-write.test.ts:481`）
- T1-043: OK（`tests/work-graph/S4A-note-write.test.ts:699`）
- T1-044: OK（`tests/work-graph/S4B-memory-not-found.test.ts:17`）
- T1-045: OK（`.lead-ref/parts/T1a.diff:4892`）
- T1-046: OK（`tests/work-graph/S8A-catalog-version-time.test.ts:21`）
- T1-048: OK（`tests/work-graph/S4B-note-budget-check.test.ts:127`）
- T1-049: T1a-02（`tests/work-graph/S4C2-D-rows.test.ts:280`）
- T1-051: OK（`tests/work-graph/S4C-project-understanding.test.ts:75`）
- T1-052: T1a-10（`tests/work-graph/S4C2-D-rows.test.ts:110`）
- T1-053: OK（`tests/helpers/S4A-note-scope-fixture.ts:242`）
- T1-056: T1a-09（`tests/work-graph/S5R2-queue-history.test.ts:127`）
- T1-057: OK（`tests/work-graph/S8A-L8-reminders-public.test.ts:52`、`:110`、`:129`、`:144`）
- T1-060: OK（`.lead-ref/parts/T1a.diff:5155`）
- T1-066: OK（`tests/helpers/W2-whiteboard-fixture.ts:183`、`:344`）
- T1-068: OK（`tests/work-graph/goal-independent.test.ts:75`；保留部分见下表）
- T2-021: OK（`tests/runtime/K3-review-preparation.test.ts:168`、`:177`）
- T2-045: OK（`tests/scenarios/K3-19-review-unavailable.test.ts:125`）
- T2-049: OK（`tests/scenarios/S2C-K-retired.test.ts:219`）
- T2-050: OK（`tests/scenarios/S2C-K-unknown-outcome.test.ts:36`、`:50`；`tests/helpers/S2C-K-scenario-support.ts:170`）
- T2-051: T1a-06（`tests/scenarios/S3-query-graph.test.ts:168`）
- T2-052: OK（`tests/scenarios/S3-context-and-inputs.test.ts:55`；`tests/scenarios/S3-query-graph.test.ts:96`）
- T3-095: OK（`.lead-ref/parts/T1a.diff:234`）
- T3-096: OK（`tests/work-graph/A2-disposition-change.test.ts:711`；`.lead-ref/parts/T1a.diff:347`）
- T3-106: T1a-03、T1a-04、T1a-05、T1a-11（`tests/work-graph/A2-disposition-change.test.ts:171`、`:591`、`:635`、`:677`）

partial 和 BLOCKED 核对：

| 条目 | 部分 | DSH 理由及类别是否成立 | 公开步骤是否可达 |
|---|---|---|---|
| T1-025 | 原始 Goal 事件 ID、payload 断言 | **成立，missing entry point。** 原断言仍在 `tests/work-graph/R3a-goal-replay-boundaries.test.ts:96`、`:99`；回报所述缺口见 `.lead-ref/replies/t-reply-T1.md:88`。 | Goal 创建可走 `goals/create`；等强度的原始事件读取不可达。`goals/read` 绑定 `queryGoal`（`src/app/core-routes.ts:377`、`:378`），其结果只有 Goal 和 pendingPlan（`src/core/work-graph/model/plan-contracts.ts:44`）。 |
| T1-068 | `GoalCreated` 的 eventType/eventId | **成立，missing entry point。** 原断言保留在 `tests/work-graph/goal-independent.test.ts:78`；公开 Goal/revision 检查已在同文件 `:75`。 | 等强度事件断言不可达；`queryGoal` 不返回事件（`src/core/work-graph/model/plan-contracts.ts:44`）。 |
| T3-106 | guard 2 | **所述理由不成立，完整组合仍应 BLOCKED。** “只能 Kernel damage”与现有 missing 路径冲突（`tests/scenarios/S2C-K-unknown-outcome.test.ts:50`）。实际应说明 unknown＋released Lease 不可达（A2 文件 `:593`、`:594`）。对应 T1a-04。 | unknown 可由真实 start → `moveKernelAside` → Host 重启产生（`tests/helpers/S2C-K-scenario-support.ts:170`；`tests/helpers/A2-restart-fixture.ts:213`）。完整原组合不可达：RUN-20 保留 Lease（`src/core/work-graph/state/run-machine.ts:2318`）；公开 attestation 释放时已将 outcome 改为 crashed（同文件 `:2542`、`:2550`）。直接换 held 会另含 guard 4 的拒绝条件（`src/core/work-graph/state/plan-machine.ts:680`），不符合 A6 单错误要求。 |
| T3-106 | guard 9 的读取—提交竞争 | **不成立。** ended Run 不能接收控制这一局部事实不能证明竞争不可达；本例并不修改 B 的执行定义（`tests/work-graph/A2-disposition-change.test.ts:643`），guard 9 只检查现有 carrier 的 fence（`src/core/work-graph/state/plan-machine.ts:766`）。对应 T1a-03。 | **可达：** `startHeld('B')`（A2 文件 `:266`）→ 在提交门 `submitControl(cancel)`。人工 control pointer 即可建立 fence（`src/core/work-graph/state/task-failure.ts:137`、`:143`）；无需结束 Run 或释放 Lease。 |
| T2-051 | history 断言，应补列 BLOCKED | **接口解释属实，done 不成立。** 回报承认改用 Kernel 身份（`.lead-ref/replies/t-reply-T1.md:195`），但冻结条目要求平台 runId（`.lead-ref/books/t-items-T1.md:553`）。对应 T1a-06。 | 公开 history 存在，其身份字段是 `KernelExecutionIdentity`（`src/core/agent-runtime/execution-history-contracts.ts:23`、`:24`）。本例不能据此满足冻结的平台 runId 断言；应按书与代码冲突交 lead 更正（`.lead-ref/books/t-book.md:31`）。 |

同一组发现的 JSON：

```json
[
  {
    "id": "T1a-01",
    "class": "违规",
    "file": "tests/work-graph/K3-16-second-unfinished-proposal.test.ts",
    "line": 116,
    "item": "T1-020",
    "problem": "源首轮场景的总轮数1和round:1被替换为筛选proposal计数及round:2；源断言见.lead-ref/base/tests/work-graph/K3-16-proposal-round-fixture.test.ts:131、:132，冻结迁移要求见.lead-ref/books/t-items-T1.md:132。",
    "fix": "将源首轮场景及原断言完整迁入目标，保留总轮数1和round:1；目标已有review后proposal场景另行保留，不能代替源场景。"
  },
  {
    "id": "T1a-02",
    "class": "会出错",
    "file": "tests/work-graph/S4C2-D-rows.test.ts",
    "line": 280,
    "item": "T1-049",
    "problem": "仅参数化锚点，遗漏源文件锚点、用户goalId:null、双方pitfall的组合；源见.lead-ref/base/tests/work-graph/S4C-note-protection.test.ts:21、:259、:262。若该组合的replaces/coexistWith错误返回pending_review，当前绑定Goal且agent固定decision的行仍会通过，违反.lead-ref/books/t-items-T1.md:349要求保留完整两组。",
    "fix": "参数化完整组合，至少携带用户goalId和agent kind；文件行恢复null/pitfall，Goal行保持原组合，两种后端执行全部保留断言。"
  },
  {
    "id": "T1a-03",
    "class": "违规",
    "file": "tests/work-graph/A2-disposition-change.test.ts",
    "line": 677,
    "item": "T3-106",
    "problem": "guard 9竞争被误判为只能篡改ended Run，仍在:689调用手写humanStop。草稿在:643保留B、只增加B2，src/core/work-graph/state/plan-machine.ts:750不要求carrier已结束，真实运行中的Run可到达该竞争。",
    "fix": "用startHeld('B')建立真实Run，在plan-apply提交门通过公开读取的revision调用steps.controls.submitControl(cancel)，不投递控制、不结束Run，保持Lease不变，保留原竞争及拒绝断言。"
  },
  {
    "id": "T1a-04",
    "class": "违规",
    "file": "tests/work-graph/A2-disposition-change.test.ts",
    "line": 591,
    "item": "T3-106",
    "problem": "unknown只能靠A7损坏Kernel产生的理由不实，tests/scenarios/S2C-K-unknown-outcome.test.ts:50已有missing Kernel重启路径；但原行:594还要求released Lease，而src/core/work-graph/state/run-machine.ts:2318规定unknown保留Lease。",
    "fix": "保留原BLOCKED行，将注释及回报改为unreachable：unknown加released Lease的隔离组合无公开路径；不得换成unknown加held绕过原输入。"
  },
  {
    "id": "T1a-05",
    "class": "违规",
    "file": "tests/work-graph/A2-disposition-change.test.ts",
    "line": 635,
    "item": "T3-106",
    "problem": "已转换拒绝行未放入rejects分组；:671拒绝后直接在:674进行operator采用，缺少中间公开未变检查。不符合.lead-ref/books/t-items-T1.md:614和.lead-ref/books/test-rule-sheet-v1.md:45规定的A6。",
    "fix": "将已转换拒绝分支放入rejects分组，在guard 9拒绝与operator采用之间补公开未变断言，保留全部现有业务断言。"
  },
  {
    "id": "T1a-06",
    "class": "违规",
    "file": "tests/scenarios/S3-query-graph.test.ts",
    "line": 168,
    "item": "T2-051",
    "problem": "将冻结要求的tA平台runId断言自行改成Kernel runId并报done；要求见.lead-ref/books/t-items-T1.md:553，改动说明见.lead-ref/replies/t-reply-T1.md:195。书与接口不符时应按.lead-ref/books/t-book.md:31列BLOCKED。",
    "fix": "撤回未经批准的history转换，连同维持原子段所需的前置恢复保留；将该子段列BLOCKED，提交接口证据，待lead书面更正冻结条目后再转换。"
  },
  {
    "id": "T1a-07",
    "class": "违规",
    "file": "tests/scenarios/A7-control.test.ts",
    "line": 451,
    "item": "T1-005",
    "problem": "目标测试名未保留源测试的RUN-14，仅:496注释保留；源见.lead-ref/base/tests/work-graph/A2-control-service.test.ts:277，违反.lead-ref/books/t-book.md:62。",
    "fix": "仅给目标测试名补入RUN-14，保留正文。"
  },
  {
    "id": "T1a-08",
    "class": "违规",
    "file": "tests/work-graph/S2C-lines-tiers.test.ts",
    "line": 155,
    "item": "T1-037",
    "problem": "目标测试名未保留源测试的2C-12 (9)；源见.lead-ref/base/tests/work-graph/S2C-lines-attention.test.ts:216，违反.lead-ref/books/t-book.md:62。",
    "fix": "给目标测试名补入2C-12 (9)。"
  },
  {
    "id": "T1a-09",
    "class": "违规",
    "file": "tests/work-graph/S5R2-queue-history.test.ts",
    "line": 127,
    "item": "T1-056",
    "problem": "目标测试名未保留被合并源测试的R2A08；源见.lead-ref/base/tests/work-graph/S5R2-queue-history.test.ts:141，违反.lead-ref/books/t-book.md:62。",
    "fix": "给现有201 Goals用例名补入R2A08，不恢复已取消的200上限断言。"
  },
  {
    "id": "T1a-10",
    "class": "不整洁",
    "file": "tests/work-graph/S4C2-D-rows.test.ts",
    "line": 110,
    "item": "T1-052",
    "problem": "标题仍称and supersedes it，正文已在:123结束；supersede覆盖保留于tests/work-graph/S4C2-D17.test.ts:53，属于标题残留。",
    "fix": "从D-06标题删去and supersedes it。"
  },
  {
    "id": "T1a-11",
    "class": "违规",
    "file": "tests/work-graph/A2-disposition-change.test.ts",
    "line": 171,
    "item": "T3-106",
    "problem": "已转换service行在:171、:707、:787、:812硬编码memory；不满足.lead-ref/books/test-rule-sheet-v1.md:94的双后端要求，该规则由.lead-ref/books/test-rule-sheet-v2.md:4、:20继续约束wave 2。",
    "fix": "仅对本条已转换service行参数化memory/sqlite并贯穿fixture；不扩大到未转换纯函数块或仍BLOCKED的种子行。"
  }
]
```

会出错 1，违规 9，不整洁 1，建议 0