C1 的“`entered` 不可达”结论不成立。当前配置中的 `provider: 'test'` 会在进入 Kernel 前被拒绝；改用受支持的 provider 配置并绑定脚本模型，可通过真实 `startRun` 到达 entered 闸门。以下均为静态核对结论，未运行测试或构建。

**1．发现表**

| 编号 | 类别 | 位置（file:line） | 条目 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| G4-01 | 违规 | `tests/helpers/C1-mailbox-fixture.ts:166`、`:174` | TP-054、TP-081 | 真实 prepare 后仍拼造 running、entered 授权并 `commitRaw`。同时把原 `consumerId: 'c1-domain-driver'` 改为 `'c1-runtime'`，不是 BLOCKED 部分原样保留，而是“真实 manifest＋手写 entered”的替代路径。冻结改正要求删除手写入场事实（`.lead-ref/books/t-items-TP.md:595`）。 | 使用可运行的 Host 配置、脚本模型和真实 Runtime prepare/start；在模型请求处设置 A3 闸门，再通过公开执行读取取得 `currentRun/envelope`，删除该 seed。 |
| G4-02 | 违规 | `tests/helpers/S1-session-facts-fixture.ts:206`、`:220`、`:227` | TP-062 | 无消费者的 `createLegacySession` 仍手写缺 provenance 的旧 Operation；本轮还把原 `toBeNull()` 改为 `{schemaVersion:1,kind:'new'}`，改变了旧断言的含义。TP-062 要求删除旧来源场景、迁移当前构造方，没有授权重定义这个旧夹具（`.lead-ref/books/t-items-TP.md:454`）。 | 删除已失去全部调用的 `createLegacySession` 及专用依赖，不改期望来保留旧格式种子。 |
| G4-03 | 违规 | `tests/helpers/S2B-runtime-steps-fixture.ts:275`；`tests/helpers/S2B-track-fixture.ts:356`、`:398` | TP-096 | 新共享辅助已有真实 start/finish，但 track 只复用了策略安装，仍直接写 entered 和终态 observation。冻结改正明确要求 timeline、track 两边都迁移（`.lead-ref/books/t-items-TP.md:706`）。 | 把 track 的 enter/end 接到共享 Runtime 辅助，删除手写 entered/result，保留原断言和期望。 |
| G4-04 | 违规 | `tests/helpers/S2B-task-timeline-fixture.ts:610`；`tests/work-graph/S2B-32-task-timeline-fold.test.ts:228` | TP-095、TP-160 | 删除原始控制 seed 后，指定覆盖文件 `S2B-r2-s-preentry-control.test.ts` 被删除，公开流程版反向迁入 fold。五段时间断言仍完整保留（fold `:239`），没有漏测，但违反明确冻结的合并方向（`.lead-ref/books/t-items-TP.md:694`、`:1181`）。 | 将公开流程用例完整放回指定的 r2 文件，删除 fold 中对应重复用例；保留原始控制 seed 的删除。 |
| G4-05 | 不整洁 | `tests/helpers/S1-workflow-archive-fixture.ts:5`、`:75`、`:101`；`tests/helpers/C1-mailbox-fixture.ts:30`、`:127`；`tests/helpers/B2-execution-fixture.ts:38`；`tests/helpers/S2A-planning-fixture.ts:10`、`:14` | TP-054、TP-081、TP-083、TP-084 | 本轮合并、转换留下死依赖：S1 的旧底座/schema/claim/entry/manifest/bootstrap 导入及新增 `prepareTaskForReal`；C1 未接入执行链的 Runtime 导入和 `newId/executions/sessionDirectory/roles`；B2 的 `loadPreparedManifest`；planning 的 `PreparedQueryManifestV1/QUERY_MANIFEST_CONTENT_TYPE`。 | 删除本轮失去消费者或新增却未使用的依赖。C1 完成 G4-01 后，仅保留实际接入执行链的依赖。 |

**2．逐条结论**

以下 OK 仅指 G4 范围；对 BLOCKED 项表示按要求保留，不表示转换完成。

```text
TP-006: OK（tests/helpers/K3-blocked-command-fixture.ts:475）
TP-009: G4-01, G4-05（由 TP-054 吸收）
TP-011: OK（tests/helpers/S2B-r2-activity-support.ts:43）
TP-027: OK（tests/helpers/K-legacy-reader-support.ts:42）
TP-050: OK（tests/helpers/B2-execution-fixture.ts:152）
TP-054: G4-01, G4-05
TP-062: G4-02
TP-063: OK（tests/helpers/S2A-notices-support.ts:118）
TP-069: OK（tests/helpers/A2-restart-fixture.ts:82）
TP-070: OK（tests/helpers/AG2b-collaboration-fixture.ts:218）
TP-071: OK（tests/helpers/S2B-activity-fixture.ts:119）
TP-072: OK（BLOCKED；tests/helpers/S2B-activity-fixture.ts:316）
TP-077: OK（覆盖：tests/scenarios/support/common.ts:487）
TP-078: OK（tests/helpers/AG2b-collaboration-fixture.ts:63）
TP-079: OK（tests/helpers/B2-execution-fixture.ts:47）
TP-080: OK（tests/helpers/B2-runtime-fixture.ts:209）
TP-081: G4-01, G4-05
TP-082: OK（tests/helpers/S1-runtime-scenario-fixture.ts:58）
TP-083: G4-05
TP-084: G4-05
TP-085: OK（覆盖：tests/work-graph/S2A-notices-counts.test.ts:24）
TP-086: OK（tests/helpers/S2A-notices-support.ts:145）
TP-087: OK（tests/helpers/S2A-notices-support.ts:31）
TP-088: OK（tests/helpers/S2A-notices-support.ts:136）
TP-089: OK（tests/helpers/S2A-notices-workspace2-fixture.ts:190）
TP-090: OK（覆盖：tests/work-graph/S2B-activity-calendar.test.ts:241）
TP-091: OK（BLOCKED；tests/helpers/S2B-activity-fixture.ts:316）
TP-092: OK（tests/helpers/S2B-runtime-store-fixture.ts:75、:96）
TP-093: OK（覆盖：tests/work-graph/S2B-31-task-timeline-main.test.ts:20）
TP-094: OK（tests/helpers/S2B-task-timeline-fixture.ts:501）
TP-095: G4-04
TP-096: G4-03
TP-142: OK（tests/helpers/K3-review-card-fixture.ts:379、:385）
TP-153: OK（覆盖：tests/work-graph/S2A-notices-rework.test.ts:28）
TP-155: OK（覆盖：tests/work-graph/S2B-31-task-timeline-main.test.ts:20）
TP-157: OK（覆盖：tests/work-graph/S2B-activity-calendar.test.ts:241）
TP-160: G4-04
```

转换后的公开步骤及残留需要明确区分：

| 夹具 | 已落实的公开步骤 | 仍存在的 F 形态 |
|---|---|---|
| B2 execution、S1 archive | Task/Query 真实 prepare：`tests/helpers/B2-execution-fixture.ts:217`；`tests/helpers/S1-workflow-archive-fixture.ts:504`。 | B2 `enter` 仍手写入场事实（`:310`）；S1 仍手写结果、Query observation（`:389`、`:530`、`:557`）。这些是原有保留路径，不能据此次 manifest 转换宣称整个夹具合规。 |
| B2 runtime | 创建时绑定 role_spec，经真实 Session operations 创建，再 claim：`tests/helpers/B2-runtime-fixture.ts:209`、`:214`。 | 原 coordination-policy `commitRaw` 仍在 `:204`；此次 TP-080 没有修改这段。 |
| C1 | 真实 prepare：`tests/helpers/C1-mailbox-fixture.ts:156`。 | entered seed 仍为 F2/F3，见 G4-01。 |
| S2A notices、W2 | Workspace 注册、策略安装和激活：`tests/helpers/S2A-notices-support.ts:136`、`:145`、`:152`；W2 真实 prepare：`tests/helpers/S2A-notices-workspace2-fixture.ts:139`。 | W2 保留的 Session/进入/结束栈仍直接写观察事实（`:111`、`:153`、`:173`）；TP-089 明确保留该栈，没有完成整栈转换。 |
| S2A planning | 真实 Query prepare：`tests/helpers/S2A-planning-fixture.ts:74`。 | 原 entered、terminal observation 仍手造（`:88`、`:98`），此次只替换 manifest。 |
| S2B runtime steps、timeline | 真实 prepare/start、模型闸门和结束：`tests/helpers/S2B-runtime-steps-fixture.ts:282`、`:304`、`:308`、`:327`；真实消息 yield、回复和续接：`tests/helpers/S2B-task-timeline-fixture.ts:501`。 | timeline 原有手写 reconcile、控制观察和异常文件事实仍在 `:416`、`:428`、`:600`、`:631`。普通 enter/end 已转换；这些独立路径未随之转换。track 的明确迁移缺项另列 G4-03。 |

**3．BLOCKED 和 partial 部分**

| 条目 | 部分 | DSH 的理由成立吗？ | 公开步骤可达吗？ |
|---|---|---|---|
| TP-081 | C1 entered 闸门 | **“不可达”不成立。** 当前 C1 使用 `preparationHost`（`tests/helpers/C1-mailbox-fixture.ts:153`）；它写死 `provider:'test'`（`tests/helpers/task-claim-fixture.ts:520`）。Runtime 先查询内建 provider（`src/core/agent-runtime/observed-model-run.ts:243`），注册表会拒绝 `test`（`vendor/coding-agent/dist/model/providers/registry/provider-registry.js:3`、`:13`）。该异常可被启动驱动捕获后转为观察现状（`src/core/agent-runtime/execution-driver.ts:1256`、`:1269`），足以解释 entering、零模型调用；不能据此认定 Kernel 映射无法 entered。 | **可达：真实 `Runtime.startRun`＋受支持 provider 配置＋脚本模型 A3 闸门。** 生产 entered hook 在模型请求前写入事实（`src/core/agent-runtime/execution-driver.ts:980`、`:1008`、`:1053`）。同基座的共享辅助已有该装配方式（`tests/helpers/S2B-runtime-steps-fixture.ts:174`、`:282`、`:293`、`:308`）。仅替换 client、继续使用 `provider:'test'` 不够。 |
| TP-054 | C1 manifest 与 entered 的组合 | manifest 已走真实 prepare，但 entered 仍由 seed 写入（`tests/helpers/C1-mailbox-fixture.ts:156`、`:166`）；因此只能核销 prepare 部分。 | 同 TP-081，可通过真实 start 完成，不需要手写授权或位置。 |
| TP-072 | R9 完整替代流程 | **“先冻结完整流程”的阻塞成立。** TP-091 的书面改正明确保留该阻塞（`.lead-ref/books/t-items-TP.md:669`）；当前旧 seed 仍由 R9 使用（`tests/app/S2B-r2-backfill-done-cursor.test.ts:84`）。 | 原 seed 的“无 dispatch、却已结束并可计数”的旧形状不可由正常 claim 产生：seed 只写 Run（`tests/helpers/S2B-activity-fixture.ts:324`、`:333`），当前 claim 同批写 outbox（`src/core/work-graph/tasks/claim-service.ts:1272`）。等价的“101 条已计数＋2 条待回填”合规流程仍须冻结，不能用进入前取消替代。 |
| TP-091 | 保留供 R9 使用的旧活动 helper | **成立，且本段没有绕过。** helper 仍是原种子路径（`tests/helpers/S2B-activity-fixture.ts:316`）。日历旧 Run 已按另一条目删除，当前计数为 steps 5、runsCounted 2（`tests/work-graph/S2B-activity-calendar-tasks.test.ts:131`、`:132`）。 | 同 TP-072：旧形状不可达；等价公开测试流程尚未冻结。真实回填入口存在（`src/business/workflow/activity-backfill.ts:236`），但仅有入口不能证明 R9 的全部前置状态已合法构造。 |

**4．JSON**

```json
[
  {
    "id": "G4-01",
    "class": "违规",
    "file": "tests/helpers/C1-mailbox-fixture.ts",
    "line": 166,
    "item": "TP-054, TP-081",
    "problem": "真实 prepare 后仍手造 running/entered 授权并在174行 commitRaw，还将 consumerId 改为 c1-runtime；不是 BLOCKED 部分原样保留，而是真实 manifest 加手写 entered 的替代路径。",
    "fix": "使用可运行的 Host 配置、脚本模型和真实 Runtime prepare/start，在模型请求处设置 A3 闸门，通过公开执行读取取得 currentRun/envelope，删除 entered seed。"
  },
  {
    "id": "G4-02",
    "class": "违规",
    "file": "tests/helpers/S1-session-facts-fixture.ts",
    "line": 227,
    "item": "TP-062",
    "problem": "206行的 createLegacySession 已无消费者，仍在220行写缺 provenance 的旧 Operation；本轮把原 toBeNull 断言改为 kind:new，未经条目授权改变旧断言含义。",
    "fix": "删除失去全部调用的 createLegacySession 及其专用依赖，不通过改期望保留旧格式种子。"
  },
  {
    "id": "G4-03",
    "class": "违规",
    "file": "tests/helpers/S2B-runtime-steps-fixture.ts",
    "line": 275,
    "item": "TP-096",
    "problem": "共享真实 start/finish 只接入 timeline；tests/helpers/S2B-track-fixture.ts:356、:398 仍直接写 entered 和终态 observation，未完成冻结要求的两边迁移。",
    "fix": "将 track 的 enter/end 接入共享 Runtime 辅助，删除手写 entered/result，保留原断言和期望。"
  },
  {
    "id": "G4-04",
    "class": "违规",
    "file": "tests/work-graph/S2B-32-task-timeline-fold.test.ts",
    "line": 228,
    "item": "TP-095, TP-160",
    "problem": "指定保留的 S2B-r2-s-preentry-control.test.ts 被删除，公开流程版反向迁入 fold。239行起仍保留五段时间断言，未漏测，但违反冻结合并方向。",
    "fix": "将公开流程用例完整放回指定 r2 文件，删除 fold 中对应重复用例；保留原始控制 seed 的删除。"
  },
  {
    "id": "G4-05",
    "class": "不整洁",
    "file": "tests/helpers/S1-workflow-archive-fixture.ts",
    "line": 5,
    "item": "TP-054, TP-081, TP-083, TP-084",
    "problem": "合并、转换留下死依赖：S1-workflow-archive-fixture.ts:5、:75、:101 的旧构造依赖及未用 prepareTaskForReal；C1-mailbox-fixture.ts:30、:127 的未接入 Runtime 依赖和局部 owner；B2-execution-fixture.ts:38 的 loadPreparedManifest；S2A-planning-fixture.ts:10、:14 的旧 manifest 导入。",
    "fix": "删除本轮失去消费者或新增却未使用的导入和局部声明；C1 完成 G4-01 后仅保留实际接入执行链的依赖。"
  }
]
```

会出错 0，违规 4，不整洁 1，建议 0