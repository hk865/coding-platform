D 区共盘点 **69 个文件、33,175 行**，得到 **25 项候选**，估计涉及 **311 行删除或改写**。未写文件，未运行测试或构建，未联网，也未调用其他模型。

以下是供 lead 裁定的静态报告。旧格式相关的 `delete` 依据是 `docs/refactor/HANDOFF.md:565-570` 的决定 79-1，**需要与对应实现同步清理，不表示当前代码已经取消这些分支**。冻结规格行只清理已被决定 79 替代的旧格式部分；其余重复项采用 `merge-into` 或 `keep-note`。

行数只估计表内明确指出的测试代码；未计连带 import、类型、空行及跨区辅助代码。`keep-note` 暂按 0 行计，不代表没有后续工作。

| 编号 | 类别 | 位置：路径、行号、测试名 | 证据 | 建议 | 被谁覆盖／取消依据 | 估计行数 | 规格行 | 把握 |
|---|---|---|---|---|---|---|---:|---|---|
| D-01 | 过时 | `tests/state/S1-session-archive.test.ts:192-216`；UT09、UT10，legacy provenance 回填及重复回填拒绝 | UT09 构造 `provenance:null`，断言回填、升版及 `SessionProvenanceBackfilled`；UT10 只检查同一旧数据修补入口的拒绝。原规格明确是旧数据回填：`docs/refactor/design/orchestration-2026-10/slices/slice-1-SPEC.md:473,899-900`。 | `delete`：仅 UT09、UT10 | 兼容要求已取消：`docs/refactor/HANDOFF.md:566`。正常归档恢复仍在 `tests/state/S1-session-archive.test.ts:163-190` 的 UT07、UT08。 | 25 | 是，S1-SES-02／UT09–10 | 高 |
| D-02 | 过时 | `tests/state/session-availability.test.ts:194,321-333,383`；`transitionSession: every (state, event) combination` 中的 `legacy_provenance_backfilled` | 事件样本、期望值分支和事件全集断言共同保留旧 provenance 回填维度。只移除这个事件维度，不能删除状态×事件矩阵。 | `delete`：旧事件样本及对应期望分支 | `docs/refactor/HANDOFF.md:566`；当前创建入口的规格行仍由 `tests/state/session-availability.test.ts:407` 的 `SES-01 session_created` 保留。 | 15 | 是 | 高 |
| D-03 | 过时 | `tests/state/S1-dispatch.test.ts:173-185`；UT52、UT53 | 两例都让记录缺少 provenance，再用 `legacyProvenance` 判断 `forbidden`／`incomplete`。原规格专门列出该旧数据来源回退：`docs/refactor/design/orchestration-2026-10/slices/slice-1-SPEC.md:942-943`。 | `delete`：旧来源回退两例 | `docs/refactor/HANDOFF.md:566`。当前 readonly-copy 的拒绝仍由 `tests/state/S1-dispatch.test.ts:103-107` UT26、`:166-170` UT47 覆盖。 | 13 | 是，UT52–53 | 高 |
| D-04 | 过时 | `tests/state/S2C-line-status.test.ts:148-157`；`2C-01 T1 before T2: a legacy null conclusion with an unknown occupancy is 已退役 and 待核对` | 唯一旧格式差异是 unavailable Session 的 `healthConclusion:null`，以及 `retired_unrecorded` 期望。当前“退役同时保留 unknown attention”的业务行为另有公开场景断言。 | `delete`：旧 null-conclusion 例 | 旧格式要求取消：`docs/refactor/HANDOFF.md:566`。当前 missing 场景由 `tests/scenarios/S2C-K-unknown-outcome.test.ts:83-96` 的 2C-22(1) 同时断言 `retired`、`retired_missing`、`attention:unknown`；damaged 场景在同文件 `:152-165` 的 2C-22(3)。 | 10 | 是，2C-01 | 高 |
| D-05 | 过时 | `tests/state/attempt-machine.test.ts:699-700`；`project the nodes of §5.1` 中的旧 ended 行 | 明确将缺少结束结果的旧 Attempt，即 `endOutcome:null`，投影为 `ended_known`。 | `delete`：仅这两行 | `docs/refactor/HANDOFF.md:566`。当前 known／unknown 结束投影保留在 `tests/state/attempt-machine.test.ts:696-698`。 | 2 | 是，§5.1 | 高 |
| D-06 | 过时 | `tests/state/run-machine.test.ts:444-455,818-824,1012-1020,1401,1411,1651-1654`；V1／pre-B2 history、无 V2 binding、reconcile 旧格式分支 | V1/pre-B2 被接受为 history；旧 history 更新保持槽位；旧授权形状固定返回特殊拒绝。混合测试里还夹着当前合法情况：`:451-452` 的进入前取消，以及 `:1015`、`:1655` 的尚未绑定 CLAIMED。 | `delete`：仅 V1/pre-B2 样本、断言与专属测试；保留上述当前情况和 reconcile 的 Host lease／probe 检查 | `docs/refactor/HANDOFF.md:566`。当前 V2 写入仍由 `tests/state/run-machine.test.ts:570` 的 `writes the V2 binding at gen 1 rev 1 in execution-entry-service.ts key order` 覆盖。 | 32 | 是，RUN 系列 | 高 |
| D-07 | 过时 | `tests/state/plan-machine.test.ts:112-117,335,379-388,588,829,1011`；`legacy_v1` 状态行及采用／重复创建／状态派生中的旧样本 | `LegacyPlanProposal` 专属夹具及矩阵把旧 patch proposal 作为当前可读状态；多处继续断言它的 `unsupported`／`stale` 行为。 | `delete`：仅 `legacy_v1` 夹具、状态维度和参数行 | `docs/refactor/HANDOFF.md:566`。保留当前候选、已采用、已拒绝等矩阵；**不删**同文件 `:498-501` 的 `accepts a schema 1 draft (initial plans may be schema 1 or 2)`，那是当前仍允许的初始计划输入。 | 21 | 是，PLAN 系列 | 高 |
| D-08 | 过时 | `tests/state/no-progress.test.ts:322-327,401-409`；`reads a legacy check without incompleteCause as cause null`；`a legacy check without incompleteCause keys as cause null` | 两例都显式删除 `incompleteCause`，分别断言读取回退和摘要等价于 null，专门固定旧字段缺失兼容。 | `delete`：两例 | `docs/refactor/HANDOFF.md:566`。当前失败事实及 cause 参与摘要分别保留在 `tests/state/no-progress.test.ts:305-319`、`:392-398`。 | 15 | 是，失败事实／摘要规则 | 高 |
| D-09 | 过时 | `tests/state/verification-machine.test.ts:131-147`；`OPEN_PENDING` 及其派生夹具，影响 Round／Check 状态矩阵 | 基础夹具注释明确是 A.2 之前的无 `chain`、无槽位根；多数派生夹具继续继承它。当前构造器却总是写根链：同文件 `:753-756`。这是共享夹具基线过时，不能据此删除整套矩阵。 | `keep-note`：统一换为当前带根链的基础夹具，并同步槽位期望；保留现有业务矩阵 | `docs/refactor/HANDOFF.md:566`；当前形状由同文件 `:753-760` 的 `buildOpenedRound writes the open@1 byte for byte with the chain root last (C5)` 固定。 | 0 | 是，VR／Check 矩阵 | 高 |
| D-10 | 过时 | `tests/state/verification-machine.test.ts:852-854,879-882,1094,1111-1114,1150,1153-1154,1170-1172,1207,1241-1242`；EvidenceIndex、fold、successor、reverify、signal、VR-09 中的 legacy 子例 | 固定四类旧容错：已存 `EvidenceIndex@0` 的修补；缺 cause 的中断／INCONCLUSIVE；PASS 带 gaps 被当作可重验失败；无链头的 null→null 槽位守卫。部分在混合测试中，只删对应样本或断言。 | `delete`：上述旧格式子例；配合 D-09 更新共享夹具 | `docs/refactor/HANDOFF.md:566`。当前索引 CAS 在同文件 `:845-851`；正常中断原因在 `:875-878`；PASS 必须无 gaps 在 `:901-905`；当前槽位 CAS 在 `:1233-1240`。 | 22 | 是，VR／VD／C5 | 高 |
| D-11 | 过时 | `tests/state/task-machine.test.ts:303-304,321-324`；P20 中的 legacy PASS 断言；`a legacy PASS with gaps is P8 round_inconclusive, never awaiting completion (VD-4)` | 为旧 PASS-with-gaps 信号分别固定 gate→inconclusive、work→P8 blocked。当前 INCONCLUSIVE 行本身不应删除。 | `delete`：仅旧 PASS-with-gaps 两处 | `docs/refactor/HANDOFF.md:566`。当前 P20 的 inconclusive／pass 分支仍在同文件 `:298-302`；当前生成规则在 `tests/state/verification-machine.test.ts:901-905`。 | 6 | 是，P20／P8／VD-4 | 高 |
| D-12 | 过时 | `tests/state/goal-machine.test.ts:1347-1369`；`a legacy PASS with gaps is not a clean PASS (VD-4): never gate_verifying; GV-5 or GV-10 as for a non-PASS head` | 专门构造 PASS 带缺口的旧 Round，固定 Goal 修复与重验显示。 | `delete`：该旧格式专例 | `docs/refactor/HANDOFF.md:566`。当前 PASS 无缺口／open 的 gate 显示保留在同文件 `:1371` 的 `gate_verifying: head open, or PASS without gaps awaiting completion`；当前 PASS 生成约束在 `tests/state/verification-machine.test.ts:901-905`。 | 23 | 是，GV／VD-4 | 高 |
| D-13 | 过时 | `tests/state/task-failure.test.ts:384-385`；参数行 `FC-16 legacy PASS with gaps` | 把旧 PASS 带 gaps 归为 `check_incomplete`。不是整条 FC-16 过时。 | `delete`：仅旧参数行 | `docs/refactor/HANDOFF.md:566`。同文件 `:382-383` 的 `FC-16 INCONCLUSIVE head` 保留同一当前失败分类。 | 2 | 是，FC-16 | 高 |
| D-14 | 过时 | `tests/state/invariants.test.ts:723-735,830-834,1098-1102,1555-1568,1571-1579`；I-5、I-7、I-13、I-22、`checkAllInvariants runs every checker; legacy findings are kept apart` | 旧 queued pointer、PASS 带 gaps、索引 @0、before-W1 basis 等被断言为“无 violation、只有 legacy finding”。这些是检查器的纯输入反例，不应当作生产数据库篡改测试整段删除。 | `keep-note`：与 D-15 同步取消旧格式豁免，保留检查器反例及当前不变量；由 lead 裁定严格结果 | 旧豁免依据被 `docs/refactor/HANDOFF.md:566` 替代；当前负例仍在同文件 `:718-722,824-829,1094-1097,1550-1554`。 | 0 | 是，I-5／7／13／22 | 高 |
| D-15 | 过时 | `tests/state/invariants.ts:123-139,953,1062-1067,1156,1185,1274-1276,1504,1889-1891,1949,2135,2143,2266-2273`；不变量辅助函数及 legacy 过滤 | 检查器主动豁免 V1/pre-B2、旧 completion audit、旧 pointer、PASS gaps、缺 cause、@0、无链根、before-W1 basis；`checkAllInvariants` 过滤 legacy。该辅助模块仍有消费者，不能作为死 helper 删除。 | `keep-note`：收紧旧格式分支并协调调用方；保留当前合法无授权状态及检查器主体 | `docs/refactor/HANDOFF.md:566`。实际消费者包括 `tests/scenarios/harness.ts:719`、`tests/scenarios/support/fuzz.ts:193`、`tests/helpers/S1-archive-service-fixture.ts:96`；前两者还合并读取 `legacyFindings`。 | 0 | 是，不变量规格 | 高 |
| D-16 | 过时 | `tests/record-store/SP-text-scan.test.ts:400-435`；`SP-12 sqlite: the 4B-era file upgrade-compatibility check (results through the ports)` | 建两个库，再向一个库添加旧 FTS 表／`next_fts_meta`，比较升级兼容后的查询结果。目标就是旧 4B 文件兼容。 | `delete`：SP-12 | 旧库升级兼容要求已取消：`docs/refactor/HANDOFF.md:566`。辅助函数在 `tests/helpers/SP-storage-migration-fixture.ts:15`，需交其所属区联动，不计入 D 区行数。 | 36 | 是，SP-12 | 高 |
| D-17 | 只为篡改 | `tests/record-store/R3a-transaction-boundaries.test.ts:103-132`；`SQLite rejects a same-revision scope identity change made after the Goal pre-read` | 暂停预读后，直接 SQL UPDATE 把 Workspace JSON 的 scope 换掉，却保留原 ref key 和 revision（`:123-124`），仅为触发 `unavailable`。 | `delete`：整个篡改专例 | 该构造不属于当前产品测试范围：`AGENTS.md:33`、`docs/MVP-BEHAVIOR.md:201`。同文件 `:76-101` 的实际写入失败与回滚窗口必须保留。 | 30 | 否 | 高 |
| D-18 | 只为篡改 | `tests/record-store/lookup.test.ts:194-201`；`SQLite adds an index to an existing database and refuses to return a matching damaged row` 的后半段 | SQL 将 key 属于 alpha 的行改成 JSON ref 属于 beta，再断言 `corrupt`（`:195-200`）。前半段是正常添加索引，不应一并删除。 | `delete`：仅 SQL 篡改及损坏读取后半段 | `AGENTS.md:33`、`docs/MVP-BEHAVIOR.md:201`。保留同文件 `:174-193` 的当前记录建索引与查询检查。 | 8 | 否 | 高 |
| D-19 | 手写事实 | `tests/record-store/R3a-transaction-boundaries.test.ts:17-29,50,81`；`scopeSeed`，供 beforeWrite／rollback 两组测试使用 | 手写 Project、Workspace、`TrustedScopeSeeded` 事件并直接 commit。当前已有公开注册步骤；这不是通用 Widget 的 RecordStore 底层夹具。 | `convert:createProjectBootstrapServices(...).projects.createProject → projects.registerWorkspace`；从回执取 pins，初始化后重置 beforeWrite 计数及故障注入基线 | 公开入口已存在：`src/core/work-graph/configuration/project-bootstrap-contracts.ts:37-45`；工厂导出在 `src/core/work-graph/configuration/project-bootstrap-service.ts:1125-1130`。保留原业务测试，不删除。 | 15 | 否 | 高 |
| D-20 | 重复 | `tests/state/command-rerun-request-pure.test.ts:102-108`；`refuses an answer whose card key does not match, writing nothing` | 与 `tests/state/command-rerun-request.test.ts:164-167` 的 `CRR-02 refuses an answer that does not name this card (invalid)` 相同：pending、allowed event、`cardMatches:false`，均断言 `guard_failed/invalid`。前者标题虽写 writing nothing，实际没有额外持久化断言。 | `merge-into:tests/state/command-rerun-request.test.ts::CRR-02 refuses an answer that does not name this card (invalid)` | 保留目标的 CRR-02 规格行及 `:166` 的同一拒绝断言。 | 7 | 是，CRR-02／F-027 | 高 |
| D-21 | 重复 | `tests/state/command-rerun-request-pure.test.ts:91-98`；`refuses forms_added on a full eight-form request with capacity` | 与 `tests/state/K3-B3-shared-rules-pure.test.ts:89-117` 的 `accepts forms 1..8 and refuses the ninth with capacity (hand literals)` 重复第九次追加被拒绝。目标还逐次追加并核对八项内容、capacity detail；源额外明确断言 reason。 | `merge-into:tests/state/K3-B3-shared-rules-pure.test.ts::accepts forms 1..8 and refuses the ninth with capacity (hand literals)`；把 `reason:guard_failed` 一并带过去 | 目标 `:108-116` 保留第九次拒绝断言。源 `:78-89` 的**构造时**八／九项边界不同，保留。 | 8 | 是，CRR-07／F-027 | 高 |
| D-22 | 重复 | `tests/state/command-normalization.test.ts:268-271`；`B2-10 returns unparsed at the fourth level` | 同文件 `:325-327` 的 `B2-10 returns unparsed beyond three nested shell -c levels` 使用完全相同的 `nestShell(4,'tool a')`；其 helper `:281-284` 除 `unparsed` 外还检查 reason 非空。 | `merge-into:tests/state/command-normalization.test.ts::B2-10 returns unparsed beyond three nested shell -c levels` | 同文件 `:325-327`，断言在 `:283-284`。 | 4 | 是，B2-10 | 高 |
| D-23 | 重复 | `tests/contracts/review-admission.test.ts:169-171`；`still admits a review-phase review purpose with the fixed set` | `admissible()` 的 purpose 本来就是 review phase（`:20-34`）；与 `:80-82` 的 `admits the exact set, empty write scope and Host layer 1` 相同输入、同样断言 null。 | `merge-into:tests/contracts/review-admission.test.ts::admits the exact set, empty write scope and Host layer 1` | 同文件 `:80-82`，特别是 `:81`。 | 3 | 是，R4／L13 | 高 |
| D-24 | 重复 | `tests/contracts/review-admission.test.ts:80-118,129-151,173-177`；review/proposal 准入及各拒绝测试；对照 `tests/runtime/K3-19-review-admission-pure.test.ts:47-121` | 两个文件直接调用同一纯函数。完全重叠的场景包括 review/proposal 正常准入、双向混用工具集、review 缺／多工具、两 phase 非空写域、Host 缺命令工具、只读范围收窄。配对行号见下方 JSON。 | `keep-note`：跨区合并；建议 contracts 保留共同规则，runtime 保留独有输入案例和 K3 对应关系。不能把纯反例归为数据库篡改 | 保留 `tests/contracts/review-admission.test.ts:80-118,129-151,173-177` 的相应规则；runtime 独有普通 manifest、proposal 缺／多工具分别在 `:57-63,83-87,95-99`。 | 0 | 是，R4／L13／L20／K3 U5 | 高 |
| D-25 | 重复 | `tests/record-store/S4B-text-search.test.ts:380-393`；`T-05 both: the memory and sqlite backends agree page by page` | 与同文件 `:361-378` 使用相同 `pagingRows`、相同 limit=2、相同 `pageThrough`。前者只比较两后端结果相等；后者已分别对两个后端断言固定三页内容及 `[false,false,true]`。 | `merge-into:tests/record-store/S4B-text-search.test.ts::T-05 %s: two-at-a-time paging walks the refKey order to the end` | 保留目标 `:368-373` 的人工期望。两个后端都保留，符合 `docs/refactor/HANDOFF.md:683` 的决定 85-4。 | 14 | 是，T-05 | 高 |

对应 JSON 如下。`lines` 是需审阅的范围；混合测试只处理 `evidence` 指明的部分，不表示整段删除。

```json
[
  {
    "id": "D-01",
    "category": "stale",
    "file": "tests/state/S1-session-archive.test.ts",
    "lines": ["192-216"],
    "tests": [
      "UT09 a null legacy provenance is backfilled once with the continuation, revision 4",
      "UT10 backfilling an existing new provenance is a revision conflict and changes nothing"
    ],
    "evidence": "192-207 固定旧 provenance 回填、升版和事件；209-216 固定同一旧修补入口的拒绝。旧数据专属规格见 docs/refactor/design/orchestration-2026-10/slices/slice-1-SPEC.md:473,899-900。",
    "action": "delete",
    "covered_by": "兼容要求已取消：docs/refactor/HANDOFF.md:566。保留 tests/state/S1-session-archive.test.ts:163-190::UT07、UT08 的当前归档恢复行为。",
    "est_lines": 25,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-02",
    "category": "stale",
    "file": "tests/state/session-availability.test.ts",
    "lines": ["194", "321-333", "383"],
    "tests": ["transitionSession: every (state, event) combination"],
    "evidence": "194 是 legacy_provenance_backfilled 样本；321-333 是旧回填期望分支；383 将其计入事件全集。只移除旧事件维度，保留矩阵。",
    "action": "delete",
    "covered_by": "旧回填要求已取消：docs/refactor/HANDOFF.md:566。当前创建行为保留在 tests/state/session-availability.test.ts:407::SES-01 session_created。",
    "est_lines": 15,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-03",
    "category": "stale",
    "file": "tests/state/S1-dispatch.test.ts",
    "lines": ["173-185"],
    "tests": [
      "UT52 a null record provenance with a trusted readonly_copy legacy provenance is forbidden for Work",
      "UT53 a null record provenance with no legacy provenance is incomplete, never treated as new"
    ],
    "evidence": "记录 provenance 为 null，再从 legacyProvenance 回退判断。对应旧规格为 docs/refactor/design/orchestration-2026-10/slices/slice-1-SPEC.md:942-943。",
    "action": "delete",
    "covered_by": "旧来源回退要求已取消：docs/refactor/HANDOFF.md:566。当前 readonly_copy 拒绝仍由 tests/state/S1-dispatch.test.ts:103-107::UT26 和 :166-170::UT47 覆盖。",
    "est_lines": 13,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-04",
    "category": "stale",
    "file": "tests/state/S2C-line-status.test.ts",
    "lines": ["148-157"],
    "tests": [
      "2C-01 T1 before T2: a legacy null conclusion with an unknown occupancy is 已退役 and 待核对"
    ],
    "evidence": "151 使用 unavailable 加 healthConclusion:null；155 固定 retired_unrecorded。正常退役同时显示 unknown attention 有公开场景覆盖。",
    "action": "delete",
    "covered_by": "旧格式要求取消：docs/refactor/HANDOFF.md:566。当前行为由 tests/scenarios/S2C-K-unknown-outcome.test.ts:83-96::2C-22 (1) a Run left outcome_unknown by a missing Kernel reads retired (missing) with attention unknown, and maintenance leaves the unknown holder alone，以及 :152-165 的 2C-22 (3) damaged 场景覆盖。",
    "est_lines": 10,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-05",
    "category": "stale",
    "file": "tests/state/attempt-machine.test.ts",
    "lines": ["699-700"],
    "tests": ["project the nodes of §5.1"],
    "evidence": "仅旧 ended 行 endOutcome:null 被断言为 ended_known；不要删除整个投影测试。",
    "action": "delete",
    "covered_by": "旧结果缺失兼容要求已取消：docs/refactor/HANDOFF.md:566。当前 ended_known、ended_unknown 投影保留在 tests/state/attempt-machine.test.ts:696-698。",
    "est_lines": 2,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-06",
    "category": "stale",
    "file": "tests/state/run-machine.test.ts",
    "lines": ["444-455", "818-824", "1012-1020", "1401", "1411", "1651-1654"],
    "tests": [
      "reads V1 and pre-B2 authorizations as legacy history, not damage",
      "keeps the slot self → self for an existing locator without a held V2 begin binding (execution-history-binding.ts:152-154)",
      "refuses a V1 or pre-B2 Run with the one text of a Run without a V2 binding",
      "reconcile_*: legacy, Host lease, probe, then the row",
      "entryV2Binding 的 V1/pre-B2 子例"
    ],
    "evidence": "只清理 V1/pre-B2 兼容样本与断言。必须保留 451-452 的 D7 进入前取消、1015 的 EV.begin/CLAIMED、1655 的 CLAIMED，以及 1412 起的 Host lease/probe 守卫。",
    "action": "delete",
    "covered_by": "旧授权格式要求已取消：docs/refactor/HANDOFF.md:566。当前 V2 写入保留在 tests/state/run-machine.test.ts:570::writes the V2 binding at gen 1 rev 1 in execution-entry-service.ts key order。",
    "est_lines": 32,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-07",
    "category": "stale",
    "file": "tests/state/plan-machine.test.ts",
    "lines": ["112-117", "335", "379-388", "588", "829", "1011"],
    "tests": [
      "Every (state, event) pair 中的 legacy_v1",
      "other content keeps today's create CAS result: a legacy record",
      "reads the state after the Agent pre-checks: legacy, not pending and old revisions keep their codes",
      "legacy on an older plan"
    ],
    "evidence": "LegacyPlanProposal 专属夹具、legacy_v1 状态行及旧 proposal 的 unsupported/stale 参数。498-501 的 schema 1 初始 draft 是当前允许输入，不能因版本号一并删除。",
    "action": "delete",
    "covered_by": "旧 patch proposal 兼容要求取消：docs/refactor/HANDOFF.md:566。保留 tests/state/plan-machine.test.ts:336 起的当前状态矩阵及 :498-501::accepts a schema 1 draft (initial plans may be schema 1 or 2)。",
    "est_lines": 21,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-08",
    "category": "stale",
    "file": "tests/state/no-progress.test.ts",
    "lines": ["322-327", "401-409"],
    "tests": [
      "reads a legacy check without incompleteCause as cause null",
      "a legacy check without incompleteCause keys as cause null"
    ],
    "evidence": "324、403 显式删除 incompleteCause，分别断言读取回退和摘要等价于显式 null。",
    "action": "delete",
    "covered_by": "缺字段旧格式兼容要求取消：docs/refactor/HANDOFF.md:566。当前失败事实保留在 tests/state/no-progress.test.ts:305-319::gives every non-PASS check, interrupted and not-run included, sorted by checkId；摘要规则保留在 :392-398::a check phase and cause take part in the digest (C1)。",
    "est_lines": 15,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-09",
    "category": "stale",
    "file": "tests/state/verification-machine.test.ts",
    "lines": ["131-147"],
    "tests": ["Round/Check 状态矩阵共享的 OPEN_PENDING 及派生夹具"],
    "evidence": "131 明确说明基础夹具是 A.2 之前的无 chain、无槽位根；138-147 派生夹具继续继承。当前构造器在 753-756 固定写入 rootRoundChain。",
    "action": "keep-note",
    "covered_by": "docs/refactor/HANDOFF.md:566。统一替换当前基础夹具并更新槽位期望，保留矩阵；当前形状由 tests/state/verification-machine.test.ts:753-760::buildOpenedRound writes the open@1 byte for byte with the chain root last (C5) 固定。",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-10",
    "category": "stale",
    "file": "tests/state/verification-machine.test.ts",
    "lines": ["852-854", "879-882", "1094", "1111-1114", "1150", "1153-1154", "1170-1172", "1207", "1241-1242"],
    "tests": [
      "nextTaskEvidenceIndex: CAS by row existence (VR-10/11), nothing written for zero ids (VR-12)",
      "refuses an executing check; an interrupted check is the gap interrupted_check",
      "refuses a predecessor that is not a finalized non-PASS head",
      "a legacy PASS with gaps may have a successor",
      "reverifyFailureClass and isFinalizedNonPass",
      "reverifyExemption (§13.7 point 3)",
      "maps the chain head",
      "VR-09 claims a chained head slot with the same owner, so a successor committed after the read loses the race"
    ],
    "evidence": "仅清理已存 EvidenceIndex@0 修补、缺 cause 兼容、PASS-with-gaps 重验与投影、旧无槽位根守卫。1153-1154 只移除 FINAL_PASS_GAPS 元素及对应期望，保留其他分类。",
    "action": "delete",
    "covered_by": "旧格式兼容要求取消：docs/refactor/HANDOFF.md:566。当前索引 CAS 在 tests/state/verification-machine.test.ts:845-851；中断原因在 :875-878；PASS 无 gaps 在 :901-905::VD-4: a pending check whose requirement another PASS covers → INCONCLUSIVE, so PASS ⇒ no gaps；当前槽位守卫在 :1233-1240。",
    "est_lines": 22,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-11",
    "category": "stale",
    "file": "tests/state/task-machine.test.ts",
    "lines": ["303-304", "321-324"],
    "tests": [
      "P20 (C5, 5.9 part 2): a gate projects from its own chain head right after P1, with gate and ordinal",
      "a legacy PASS with gaps is P8 round_inconclusive, never awaiting completion (VD-4)"
    ],
    "evidence": "仅处理 legacy PASS-with-gaps 的 gate/work 投影；不删除 P20 或 P8 当前 INCONCLUSIVE 行。",
    "action": "delete",
    "covered_by": "旧 PASS 兼容要求取消：docs/refactor/HANDOFF.md:566。当前 P20 分支保留在 tests/state/task-machine.test.ts:298-302；当前生成规则在 tests/state/verification-machine.test.ts:901-905。",
    "est_lines": 6,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-12",
    "category": "stale",
    "file": "tests/state/goal-machine.test.ts",
    "lines": ["1347-1369"],
    "tests": [
      "a legacy PASS with gaps is not a clean PASS (VD-4): never gate_verifying; GV-5 or GV-10 as for a non-PASS head"
    ],
    "evidence": "1348 构造 PASS 加 evidence_missing 缺口，随后固定该旧 Round 在修复和重验阶段的 Goal 显示。",
    "action": "delete",
    "covered_by": "旧 PASS 兼容要求取消：docs/refactor/HANDOFF.md:566。当前 gate 显示保留在 tests/state/goal-machine.test.ts:1371::gate_verifying: head open, or PASS without gaps awaiting completion；PASS 生成约束在 tests/state/verification-machine.test.ts:901-905。",
    "est_lines": 23,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-13",
    "category": "stale",
    "file": "tests/state/task-failure.test.ts",
    "lines": ["384-385"],
    "tests": ["FC-16 legacy PASS with gaps"],
    "evidence": "旧 PASS-with-gaps 参数被分类为 check_incomplete；只移除该参数，不移除 FC-16。",
    "action": "delete",
    "covered_by": "旧 PASS 兼容要求取消：docs/refactor/HANDOFF.md:566。tests/state/task-failure.test.ts:382-383::FC-16 INCONCLUSIVE head 保留当前 check_incomplete 分类。",
    "est_lines": 2,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-14",
    "category": "stale",
    "file": "tests/state/invariants.test.ts",
    "lines": ["723-735", "830-834", "1098-1102", "1555-1568", "1571-1579"],
    "tests": [
      "I-5 checkI5SingleQueuedPointerIntent: the pointer names the one queued pointer intent (legacy only when it moved on)",
      "I-7 checkI7RoundConsistency: outcomes, check shapes and causes; finalized rounds and settled checks never change",
      "I-13 checkI13EvidenceIndex: revision = id count ≥ 1 (an @0 index is legacy)",
      "I-22 checkI22TracedBasisFrozen: a Task with a Run keeps its basis and execution definition (only §11.19 legacy)",
      "checkAllInvariants runs every checker; legacy findings are kept apart"
    ],
    "evidence": "旧 queued pointer、PASS gaps、索引 @0、before-W1 basis 被断言为不产生 violation，而只产生 legacy finding。它们是检查器纯输入反例，应保留检测目的并与 D-15 同步取消旧豁免。",
    "action": "keep-note",
    "covered_by": "旧豁免依据被 docs/refactor/HANDOFF.md:566 替代。当前负例保留在 tests/state/invariants.test.ts:718-722,824-829,1094-1097,1550-1554；最终严格结果由 lead 随检查器一起裁定。",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-15",
    "category": "stale",
    "file": "tests/state/invariants.ts",
    "lines": ["123-139", "953", "1062-1067", "1156", "1185", "1274-1276", "1504", "1889-1891", "1949", "2135", "2143", "2266-2273"],
    "tests": [
      "runCombinationProblem",
      "I-3/I-5/I-7/I-10/I-13/I-20/I-22 的旧格式豁免",
      "checkAllInvariants",
      "legacyFindings"
    ],
    "evidence": "旧格式被 legacy 标记或直接跳过，2268 又从 checkAllInvariants 过滤。不是无人使用的 helper；还需区分当前合法的未授权 claimed/进入前取消状态。",
    "action": "keep-note",
    "covered_by": "docs/refactor/HANDOFF.md:566。调用方包括 tests/scenarios/harness.ts:719、tests/scenarios/support/fuzz.ts:193、tests/helpers/S1-archive-service-fixture.ts:96；前两者还读取 legacyFindings，必须协调更新。",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-16",
    "category": "stale",
    "file": "tests/record-store/SP-text-scan.test.ts",
    "lines": ["400-435"],
    "tests": [
      "SP-12 sqlite: the 4B-era file upgrade-compatibility check (results through the ports)"
    ],
    "evidence": "415 添加旧 FTS 表及 next_fts_meta，425-429 比较旧文件兼容后的查询结果。辅助定义位于 tests/helpers/SP-storage-migration-fixture.ts:15。",
    "action": "delete",
    "covered_by": "旧库升级兼容要求取消：docs/refactor/HANDOFF.md:566。跨区辅助清理由其所属区负责，不计入本项行数。",
    "est_lines": 36,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-17",
    "category": "tamper",
    "file": "tests/record-store/R3a-transaction-boundaries.test.ts",
    "lines": ["103-132"],
    "tests": [
      "SQLite rejects a same-revision scope identity change made after the Goal pre-read"
    ],
    "evidence": "114 暂停预读；123-124 直接 UPDATE Workspace JSON 的 scope，但不改 ref key/revision；127-130 只验证因此触发的拒绝。",
    "action": "delete",
    "covered_by": "该内部记录篡改构造不属于当前测试要求：AGENTS.md:33；docs/MVP-BEHAVIOR.md:201。保留 tests/record-store/R3a-transaction-boundaries.test.ts:76-101::SQLite rolls back a Goal write when the %s insert fails after earlier writes。",
    "est_lines": 30,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "D-18",
    "category": "tamper",
    "file": "tests/record-store/lookup.test.ts",
    "lines": ["194-201"],
    "tests": [
      "SQLite adds an index to an existing database and refuses to return a matching damaged row"
    ],
    "evidence": "195-197 将 alpha key 下的 JSON ref 改成 beta，再在 200 断言 corrupt。仅删除后半段；174-193 的正常索引注册仍保留。",
    "action": "delete",
    "covered_by": "该内部记录篡改构造不属于当前测试要求：AGENTS.md:33；docs/MVP-BEHAVIOR.md:201。正常行为由 tests/record-store/lookup.test.ts:174-193 同一测试的前半段保留。",
    "est_lines": 8,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "D-19",
    "category": "handwritten",
    "file": "tests/record-store/R3a-transaction-boundaries.test.ts",
    "lines": ["17-29", "50", "81"],
    "tests": [
      "scopeSeed",
      "%s: beforeWrite belongs only to a real Goal write and receipts cannot mutate storage",
      "SQLite rolls back a Goal write when the %s insert fails after earlier writes"
    ],
    "evidence": "手写 Project/Workspace、TrustedScopeSeeded 事件并直接 commit。当前公开注册入口存在。转换后取回执 pins，初始化完成再重置计数、设置故障注入基线，保留业务断言。",
    "action": "convert:createProjectBootstrapServices(...).projects.createProject -> projects.registerWorkspace",
    "covered_by": "现有公开步骤：src/core/work-graph/configuration/project-bootstrap-contracts.ts:37-45；工厂导出：src/core/work-graph/configuration/project-bootstrap-service.ts:1125-1130。保留原 beforeWrite 和 rollback 测试。",
    "est_lines": 15,
    "spec_row": false,
    "confidence": "高"
  },
  {
    "id": "D-20",
    "category": "duplicate",
    "file": "tests/state/command-rerun-request-pure.test.ts",
    "lines": ["102-108"],
    "tests": ["refuses an answer whose card key does not match, writing nothing"],
    "evidence": "104-107 与 tests/state/command-rerun-request.test.ts:165-166 使用相同 pending/allowed/cardMatches:false 场景，并断言 guard_failed/invalid。源没有额外持久化断言。",
    "action": "merge-into:tests/state/command-rerun-request.test.ts::CRR-02 refuses an answer that does not name this card (invalid)",
    "covered_by": "tests/state/command-rerun-request.test.ts:164-167::CRR-02 refuses an answer that does not name this card (invalid)，同一拒绝断言在 166。",
    "est_lines": 7,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-21",
    "category": "duplicate",
    "file": "tests/state/command-rerun-request-pure.test.ts",
    "lines": ["91-98"],
    "tests": ["refuses forms_added on a full eight-form request with capacity"],
    "evidence": "第九次追加拒绝与 tests/state/K3-B3-shared-rules-pure.test.ts:108-116 重复。目标 93-107 还逐项追加并核对八项；合并时把源 97 的 reason:guard_failed 带过去。保留源 78-89 的构造器边界。",
    "action": "merge-into:tests/state/K3-B3-shared-rules-pure.test.ts::accepts forms 1..8 and refuses the ninth with capacity (hand literals)",
    "covered_by": "tests/state/K3-B3-shared-rules-pure.test.ts:89-117::accepts forms 1..8 and refuses the ninth with capacity (hand literals)，capacity/detail 断言在 113-116。",
    "est_lines": 8,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-22",
    "category": "duplicate",
    "file": "tests/state/command-normalization.test.ts",
    "lines": ["268-271"],
    "tests": ["B2-10 returns unparsed at the fourth level"],
    "evidence": "269 与 326 都解析 nestShell(4, 'tool a')。目标 helper 在 283-284 同时断言 unparsed 与非空 reason。",
    "action": "merge-into:tests/state/command-normalization.test.ts::B2-10 returns unparsed beyond three nested shell -c levels",
    "covered_by": "tests/state/command-normalization.test.ts:325-327::B2-10 returns unparsed beyond three nested shell -c levels；具体断言在 283-284。",
    "est_lines": 4,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-23",
    "category": "duplicate",
    "file": "tests/contracts/review-admission.test.ts",
    "lines": ["169-171"],
    "tests": ["still admits a review-phase review purpose with the fixed set"],
    "evidence": "20-34 的 admissible 已使用 review phase；170 再指定 review 不改变输入，与 81 同样断言 null。",
    "action": "merge-into:tests/contracts/review-admission.test.ts::admits the exact set, empty write scope and Host layer 1",
    "covered_by": "tests/contracts/review-admission.test.ts:80-82::admits the exact set, empty write scope and Host layer 1，断言在 81。",
    "est_lines": 3,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-24",
    "category": "duplicate",
    "file": "tests/contracts/review-admission.test.ts",
    "lines": ["80-118", "129-151", "173-177"],
    "tests": [
      "admits the exact set, empty write scope and Host layer 1",
      "rejects a missing tool",
      "rejects an extra tool",
      "rejects a non-empty write scope",
      "rejects hostTools missing run_readonly_command",
      "rejects a narrowed read-only command access",
      "L20: a proposal-phase review purpose with its own fixed set, empty write scope and Host layer 1 passes",
      "L20: a proposal-phase review purpose is refused the review phase's tool set",
      "L20: a proposal-phase review purpose is refused a non-empty write scope",
      "still refuses a review-phase review purpose with the proposal tool set"
    ],
    "evidence": "对照 tests/runtime/K3-19-review-admission-pure.test.ts，contracts/runtime 配对为 80-82/47-49（review 准入 null）、129-135/51-53（proposal 准入 null）、90-94/77-81（缺工具）、96-100/89-93（多工具）、102-104/101-103（review 写域）、106-108/111-115（Host 缺工具）、114-118/117-121（范围收窄）、137-143/71-75（proposal 混用 review 工具）、145-151/105-109（proposal 写域）、173-177/65-69（review 混用 proposal 工具）。各对调用同一纯函数并断言相同结果。",
    "action": "keep-note",
    "covered_by": "建议 tests/contracts/review-admission.test.ts:80-118,129-151,173-177 保留共同规则，由跨区 lead 合并对应 runtime 重复例。tests/runtime/K3-19-review-admission-pure.test.ts:57-63,83-87,95-99 的独有输入保留；不按数据库篡改删除纯反例。",
    "est_lines": 0,
    "spec_row": true,
    "confidence": "高"
  },
  {
    "id": "D-25",
    "category": "duplicate",
    "file": "tests/record-store/S4B-text-search.test.ts",
    "lines": ["380-393"],
    "tests": ["T-05 both: the memory and sqlite backends agree page by page"],
    "evidence": "两处都使用 333-339 的 pagingRows 和 341-358 的 pageThrough(limit=2)。388 仅比较两后端相等；361-378 已对两个后端分别断言固定分页内容和 completes。",
    "action": "merge-into:tests/record-store/S4B-text-search.test.ts::T-05 %s: two-at-a-time paging walks the refKey order to the end",
    "covered_by": "tests/record-store/S4B-text-search.test.ts:361-378::T-05 %s: two-at-a-time paging walks the refKey order to the end，固定期望在 368-373。保留两个后端，符合 docs/refactor/HANDOFF.md:683。",
    "est_lines": 14,
    "spec_row": true,
    "confidence": "高"
  }
]
```

按类别汇总：

| 类别 | 项数 | 估计删除或改写行数 |
|---|---:|---:|
| 过时 `stale` | 16 | 222 |
| 重复 `duplicate` | 6 | 36 |
| 琐碎 `trivial` | 0 | 0 |
| 手写事实 `handwritten` | 1 | 15 |
| 只为篡改 `tamper` | 2 | 38 |
| 辅助 `helper` | 0 | 0 |
| **合计** | **25** | **311** |

按建议分布为：`delete` 15 项、约 260 行；`merge-into` 5 项、约 36 行；`convert` 1 项、约 15 行；`keep-note` 4 项、暂不计行数。这是工作量估计，**不是净减少 311 行的承诺**。

阅读覆盖如下。**全文阅读 15 个文件，共 1,285 行**：

| 目录 | 全文阅读文件 |
|---|---|
| `tests/state/` | `K3-B3-crr-codec-rejects.test.ts:1-77`；`K3-B3-shared-rules-pure.test.ts:1-130`；`command-normalization-pure.test.ts:1-23`；`command-rerun-request-pure.test.ts:1-109`；`command-rerun-request-used-by.test.ts:1-113` |
| `tests/architecture/` | `record-store-literal-type.test.ts:1-40` |
| `tests/context/` | `verification-workspace-reader.test.ts:1-100` |
| `tests/contracts/` | `RL-21-default-resource-cap-settings.test.ts:1-28`；`ledger-cursor.test.ts:1-19`；`review-admission.test.ts:1-185` |
| `tests/core/work-graph/` | `MVP-execution-list.test.ts:1-110` |
| `tests/record-store/` | `R3a-transaction-boundaries.test.ts:1-132`；`R3b-body-concurrency.test.ts:1-96`；`SP-text-scan-undo.test.ts:1-32`；`WP2-notice-cursors.test.ts:1-91` |

**略读 54 个文件，共 31,890 行**：检查了各文件测试标题／分组、旧格式与直接写入等关键词命中，并阅读候选及覆盖证据的上下文；不宣称逐行全文审完。

| 目录 | 略读文件 |
|---|---|
| `tests/state/`，40 个 | `S1-anomaly.test.ts`；`S1-archive-rework.test.ts`；`S1-dispatch.test.ts`；`S1-message-routing.test.ts`；`S1-responsibility.test.ts`；`S1-session-archive.test.ts`；`S2C-line-status.test.ts`；`S5-decision-policy.test.ts`；`S5-goal-settings.test.ts`；`S5-message-decision.test.ts`；`S5-notice-settings.test.ts`；`S5-request-candidate.test.ts`；`S8A-L8-auto-capture-state.test.ts`；`WP1-goal-content.test.ts`；`WP2-positions.test.ts`；`attempt-machine.test.ts`；`command-normalization.test.ts`；`command-rerun-request.test.ts`；`context-input.test.ts`；`control-intent-machine.test.ts`；`goal-machine.test.ts`；`invariants-fuzz.test.ts`；`invariants.test.ts`；`invariants.ts`；`k3-failure-classification.test.ts`；`k3-review-claim.test.ts`；`k3-run-reconcile.test.ts`；`message-machine.test.ts`；`no-progress.test.ts`；`plan-machine.test.ts`；`query-run-recovery.test.ts`；`review-lease.test.ts`；`run-machine.test.ts`；`session-availability.test.ts`；`task-failure.test.ts`；`task-machine.test.ts`；`unknown-call-kinds.test.ts`；`unknown-call-review-streak.test.ts`；`unknown-call-review.test.ts`；`verification-machine.test.ts` |
| `tests/architecture/`，4 个 | `boundaries.test.ts`；`production-reach.test.ts`；`production-reach.ts`；`state-writes.test.ts` |
| `tests/contracts/`，1 个 | `A2-rework-contract-helpers.test.ts` |
| `tests/record-store/`，9 个 | `S2A-ordered-lookup.test.ts`；`S2C-count-lookup.test.ts`；`S4B-text-search.test.ts`；`SP-literal-type.test.ts`；`SP-lookup-index-migration.test.ts`；`SP-record-store-limits.test.ts`；`SP-text-scan.test.ts`；`lookup.test.ts`；`transaction-extensions.test.ts` |

跨文件重复检索覆盖整个 `tests/` 树。环境中 `rg` 不可用，使用了 PowerShell `Get-ChildItem`／`Select-String` 的只读替代。表中区外文件用于验证覆盖或调用关系，没有把其行数计入 D 区。

以下边界已核对，或仍需 lead 处理：

- **GS01、NS01 不列为过时。** `tests/state/S5-goal-settings.test.ts:137` 测缺省 settings，`tests/state/S5-notice-settings.test.ts:74` 虽然标题写 old Workspace，但当前 writer 仍会省略这些字段：`src/core/work-graph/state/goal-machine.ts:91-99`、`src/core/work-graph/configuration/project-bootstrap-service.ts:669`。仅凭“缺字段／old”不能删除。
- **ST01 暂未定性。** `tests/state/context-input.test.ts:99-103` 的无 binding／legacy input 场景，尚未证明当前公开调用已经不能产生；没有列入删除候选。
- **当前索引重建不等于旧库迁移。** `tests/record-store/SP-lookup-index-migration.test.ts:107-123` 的 SP-40 是两个当前 backend 对同一文件改变索引注册。此类检查保留；D-16 仅针对明确的 4B 旧 FTS 遗留物。
- **同一错误码不足以证明重复。** `tests/record-store/SP-text-scan.test.ts:333-348` 先加载查询缓存，再让另一 writer 使索引落后；`tests/record-store/S4B-text-search.test.ts:489-502` 没有这次预先查询。两者都断言 `index_not_ready`，但覆盖冷热缓存差异，未合并。
- **故障注入与篡改身份分开。** `tests/record-store/R3a-transaction-boundaries.test.ts:86-99` 用触发器模拟事务中途写失败并检查回滚，是可达失败窗口；D-17 的不升版 scope 改写是另一类构造。
- **D-09、D-14、D-15 需要协调修改，不能机械删除。** 特别是 `tests/scenarios/harness.ts:719` 和 `tests/scenarios/support/fuzz.ts:193` 已把普通与 legacy findings 合并检查，而部分 S1 helper 只调用普通检查器，例如 `tests/helpers/S1-archive-service-fixture.ts:96`。取消豁免时需要一起核对。
- **D-16 有一个跨区辅助清理线索。** 全树检索 `addLegacyFtsArtifacts`，测试消费者只有 `tests/record-store/SP-text-scan.test.ts:16,415`，定义在 `tests/helpers/SP-storage-migration-fixture.ts:15`。交辅助区确认连带移除，D 区没有重复计项。
- **未提出架构检查删除，也未把纯规格矩阵归为琐碎测试。** 本次没有建立足够证据证明 D 区架构检查过时；D-24 的准入纯反例也不应因为公开路径不产生其输入，就按数据库篡改测试处理。