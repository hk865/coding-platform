只读核对发现 4 项；未运行测试或构建。

| 编号 | 类别 | 位置 | 行 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| Q2-01 | 违规 | `tests/work-graph/R4c-execution-read.test.ts:246` | W2-08 | BLOCKED 理由不成立。仍调用 `retire()` 手填 `missing`（`tests/helpers/S1-archive-service-fixture.ts:289`）。A2 允许在指定位置制造依赖故障（`.lead-ref/books/test-rule-sheet-v1.md:28`）；真实 probe 在数据库文件缺失时返回 `missing`，也会把 StoreError 映射为 `missing/damaged`（`src/core/agent-runtime/session-operations.ts:1028`、`:1044`）。 | 在真实失败结束、重新领取之后，临时移走本测试的 Kernel 数据库，调用真实 probe，将返回结果交给 `healthOn().recordSessionHealth`，恢复数据库后归档。删除 `retire()` 调用和错误的 BLOCKED 说明，保留 Session、Lease 断言。 |
| Q2-02 | 违规 | `tests/work-graph/S3-prepared-context-admission.test.ts:664` | W2-10 | 真实未进入故障之后，仍由测试读取 Kernel store、自行判定并写入 `probe:'ready'`、`result:not_entered`、`basis:live_clean`（`:664`、`:670`）。这绕过了裁定要求的 Host 核对判定；真实分类器对该 `live_clean` 输入反而会直接返回 `left`（`src/core/agent-runtime/run-reconcile.ts:273`），W-05 判定在 `:318`、`:322`。属于 F1/F3/F7，而非完成转换。 | 保留现有故障注入和恢复；随后用公开 `readExecution`、真实 Kernel owner 的 `probe` 和 `reconcileRunAtStartup` 完成 W-05，经真实写入服务得到 revoked。删除测试自行读取 store 并提交核对结论的代码，保留拒绝和不变性断言。 |
| Q2-03 | 会出错 | `tests/scenarios/S2C-K-legacy-provenance.test.ts:77` | W2-16 | 未经授权删除默认 provenance 的断言。具体输入是 `sessions/create` **省略 provenance**：原来严格要求 `{schemaVersion:1,kind:'new'}`（`.lead-ref/base/tests/scenarios/S2C-K-legacy-provenance.test.ts:39`、`:45`）；现在 P 仍省略该字段，却只检查显式指定的 C 为 continuation（当前文件 `:77`、`:106`、`:110`）。默认创建行为失去这条检查，不能由 continuation 断言替代。W2-16 只要求恢复两段及三条断言，未授权此删除（`.lead-ref/t-w1r1-findings.md:50`）。 | 创建 P 后，通过公开 `readSession` 恢复严格的 `new` provenance 断言；保留 C 的 continuation 断言和全部两段执行断言。 |
| Q2-04 | 不整洁 | `tests/work-graph/S3-prepared-context-admission.test.ts:167` | W2-10 | `basePrepare` 接口注释仍称“仅供两个 BLOCKED 行使用”；本轮正文已改为 AD08 保留基线路径、AD06 只构造拒绝输入（`:503`、`:680`）。 | 将接口注释同步为“AD08 的 BLOCKED 基线路径；AD06 的唯一拒绝输入”。 |

逐行结果：

- W2-01: OK（`tests/runtime/source-binding-migration.test.ts:200`、`:206`）
- W2-02: OK（`tests/composition/platform.test.ts:117`、`:141`、`:149`）
- W2-03: OK（`tests/helpers/S2B-track-fixture.ts:28`）
- W2-04: OK（`tests/helpers/S2B-track-fixture.ts:23`）
- W2-05: OK（`tests/helpers/S5-decision-fixture.ts:271`）
- W2-06: OK（`tests/runtime/source-binding-migration.test.ts:227`）
- W2-07: OK（`tests/work-graph/R4c-execution-history-index.test.ts:654`）
- W2-08: Q2-01
- W2-09: OK（`tests/work-graph/S3-prepared-context-admission.test.ts:615`、`:622`）
- W2-10: Q2-02、Q2-04
- W2-11: OK，按裁定恢复并保留 BLOCKED（`tests/work-graph/S5-request-candidates.test.ts:277`、`:287`）
- W2-12: OK（`tests/work-graph/S5-request-candidates.test.ts:277`、`:284`）
- W2-13: OK（`.lead-ref/groups/Q2.diff:1958`）
- W2-14: OK，回复已纠正覆盖说明（`.lead-ref/replies/t-reply-W1R2.md:22`）
- W2-15: OK（`tests/work-graph/S3-prepared-context-admission.test.ts:249`、`:367`、`:394`）
- W2-16: Q2-03
- W2-17: OK；删除依据是全局 R-4，见下表（`.lead-ref/t-w1-findings.md:31`）
- W2-20: OK（`tests/app/S2B-r2-backfill-done-cursor.test.ts:88`、`:127`、`:160`、`:200`）
- W2-21: OK（`tests/helpers/S5-decision-fixture.ts:566`、`:621`、`:696`）
- W2-23: OK（`tests/work-graph/B2-execution-entry.test.ts:193`、`:229`、`:244`）
- W2-25: OK（`tests/runtime/R4c-graph-history.test.ts:590`、`:616`、`:622`）

BLOCKED、部分完成和删除判定：

| 行 | 部分 | DSH 理由是否成立 | 公开步骤是否可达 |
|---|---|---|---|
| W2-08 | Host probe | **不成立**；遗漏 A2，并漏看 StoreError 分支（`session-operations.ts:1044`）。 | 可达：数据库临时缺失 → 真实 probe → health 写入；见 Q2-01。 |
| W2-10 | 未进入后撤销 | 故障位置成立：begin 后读取完成边界（`src/core/agent-runtime/execution-driver.ts:910`、`:927`）；但“已完成 Host reconcile”不成立。 | 可达：恢复数据库后走 `reconcileRunAtStartup` 的 W-05（`src/core/agent-runtime/run-reconcile.ts:221`、`:322`）。 |
| W2-11 | 无 request-slot claim 的公开证明 | 成立。公开 head 读取跳过 `requestRef=null`，接口不返回 claim（`src/core/work-graph/tasks/plan-readers.ts:598`；`src/core/work-graph/model/decision-contracts.ts:247`）。 | 当前无对应公开读；恢复的 store 断言符合该行回退裁定。 |
| W2-17 | later-Turn 零匹配子例 | 成立；W2-17 本行没有单独点名删除，但全局 R-4 已授权不可达子例删除（`.lead-ref/t-w1-findings.md:31`）。 | 该造态不可达：活动 Kernel Turn 拒绝另一 Run（`vendor/coding-agent/patches/app/composition/composition-root.ts:276`、`:286`）；真实终结同时确定观察上界和终点（`execution-observation.ts:741`）；终点不能随后扩大到后一个 Turn（`run-machine.ts:1261`）。 |
| W1-15 | track 的手写 entered/end | 成立，仍按裁定保留；本轮只改导入和说明（`.lead-ref/groups/Q2.diff:570`）。 | 所需“真实终结后再由回填替换当前 counted”不可达（`src/core/work-graph/tasks/run-activity-service.ts:159`）。 |
| B-04 | accepted ReviewWork 基础 | 成立；本轮仅改相关标题（`.lead-ref/groups/Q2.diff:1473`）。 | 真实 source reader 对 ReviewWork 返回 unsupported（`src/core/work-graph/source-authority-reader.ts:158`）。 |
| W1-26 | AD08 | 成立，保留 basePrepare 路径（`tests/work-graph/S3-prepared-context-admission.test.ts:503`）。 | 当前真实上下文来源没有该 Workspace source（`src/core/work-graph/views/graph-context-reader.ts:1010`），因此走不到该来源版本冲突分支（`execution-entry-service.ts:1073`）。 |

几个重点核对结论：

- **W2-20：** 总数为 `1+101+1=103`；中间结束时间为 −61 至 −161 分钟，落在 `[−161,−60)` 内。生产扫描每页 100 条，第一批后的探测越过 100 条 counted 后仍留续页，随后才能到最旧候选；计算依据已写在测试注释中（`tests/app/S2B-r2-backfill-done-cursor.test.ts:22`、`:43`、`:164`；`src/core/work-graph/tasks/run-activity-service.ts:516`、`:521`、`:565`）。包装只抛一次，随后原样委托，没有写事实；真实观察建立缓存后才启用故障（测试 `:88`、`:123`、`:127`）。原分页断言、真实 counted 断言及 60 秒超时均保留（`:200`、`:207`、`:211`、`:217`）。

- **W2-21：** Workspace 为注册 @1，再加、移 line pin 到 @3；Goal 重排后为 A@1、B@2、C@2，再分别设置 5/4/4 次到 @6，采用后 @7；pausedB 为 `2+3=5→采用6→暂停7`。计算注释齐全，生产设置操作每次实际提交均加一（`tests/helpers/S5-decision-fixture.ts:615`、`:665`、`:696`、`:896`；`src/core/work-graph/state/goal-settings-machine.ts:204`、`:234`）。`publicSeedSeq` 只供初始化服务，未替换被测操作使用的分配计数；读取前后计数断言仍保留（helper `:562`、`:672`；`tests/work-graph/S5-request-candidates.test.ts:277`、`:284`）。

- **共享选项：** `beforeBegin`、`workspaceRevision`、`kernelStores` 均可选；省略时分别直接使用原 entry owner、revision 1、原 registry（`tests/helpers/S2B-runtime-steps-fixture.ts:94`、`:100`、`:107`、`:210`、`:267`、`:284`）。活动 helper 的 `workTaskIds` 省略时仍使用原十二项（`tests/helpers/S2B-activity-fixture.ts:198`、`:568`）。

- **删除与账本：** `seedLegacyActivity` 删除有 W2-20 明确授权（`.lead-ref/t-w1r1-findings.md:62`）；RT06 仅删除空 `decisionSettings` 前置，revision、拒绝和不变性检查保留（`tests/app/S5-decision-routes.test.ts:246`、`:248`、`:255`）。W2-25 只改真实 cursor 的外层 `u`，严格要求 `source_stale`，不会被下层的 `invalid` 代替通过（`tests/runtime/R4c-graph-history.test.ts:616`、`:622`；`src/core/agent-runtime/graph-execution-history.ts:259`）。

- **LOOSENED 确属误配，但回复写错了文件。** 实际账本指向 `tests/work-graph/S3-graph-context.test.ts:917`（`.lead-ref/replies/ledger-W1R2.txt:9`）；严格 `toEqual` 仍在该文件 `:916`，`:917` 是另一个排除断言。并非 `tests/runtime/R4c-graph-history.test.ts:917`；回复该处路径及 W2-17 映射应改为实际文件和 W2-24（`.lead-ref/replies/t-reply-W1R2.md:89`）。

```json
[
  {
    "id": "Q2-01",
    "class": "违规",
    "file": "tests/work-graph/R4c-execution-read.test.ts",
    "line": 246,
    "row": "W2-08",
    "problem": "错误地将 Host probe 标为 BLOCKED，继续调用手填 missing 的 retire。A2 数据库缺失故障可使真实 probe 返回 missing；生产也处理 StoreError 的 missing/damaged。",
    "fix": "在重新领取后临时移走测试 Kernel 数据库，调用真实 probe，将返回结果交给 healthOn().recordSessionHealth，恢复数据库后归档；删除 retire 调用和错误 BLOCKED 说明，保留全部 Session、Lease 断言。"
  },
  {
    "id": "Q2-02",
    "class": "违规",
    "file": "tests/work-graph/S3-prepared-context-admission.test.ts",
    "line": 664,
    "row": "W2-10",
    "problem": "真实未进入故障之后仍读取 Kernel store，自行提交 live_clean、ready 和 not_entered，绕过真实 Host 分类；真实分类器对该 live_clean 场景会返回 left。",
    "fix": "保留故障注入和恢复，改用公开 readExecution、真实 Kernel owner.probe 和 reconcileRunAtStartup 的 W-05 完成撤销；删除手填核对结论和直接 store 断言，保留拒绝与不变性断言。"
  },
  {
    "id": "Q2-03",
    "class": "会出错",
    "file": "tests/scenarios/S2C-K-legacy-provenance.test.ts",
    "line": 77,
    "row": "W2-16",
    "problem": "省略 provenance 的创建输入原来严格断言 new；现在 P 仍省略该字段，却只检查显式指定的 C 为 continuation。W2-16 未授权删除默认创建行为的断言。",
    "fix": "创建 P 后通过公开 readSession 恢复严格的 new provenance 断言，同时保留 C 的 continuation 和全部两段执行断言。"
  },
  {
    "id": "Q2-04",
    "class": "不整洁",
    "file": "tests/work-graph/S3-prepared-context-admission.test.ts",
    "line": 167,
    "row": "W2-10",
    "problem": "basePrepare 接口注释仍称仅供两个 BLOCKED 行使用，与当前 AD08 基线路径、AD06 拒绝输入的用途不一致。",
    "fix": "将注释改为 AD08 的 BLOCKED 基线路径及 AD06 的唯一拒绝输入。"
  }
]
```

会出错 1，违规 2，不整洁 1，建议 0