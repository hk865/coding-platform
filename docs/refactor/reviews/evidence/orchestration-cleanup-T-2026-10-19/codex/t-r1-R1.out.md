只读审查完成，未运行测试、构建或网络操作。发现 **6 项**；下文的 OK 仅指 R1 本次增量，保留 BLOCKED 不代表转换完成。

**1. 发现表**

| 编号 | 类别 | 位置 | 行 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| R1-01 | 会出错 | `tests/runtime/source-binding-migration.test.ts:179` | B-04 | 丢失“已有访问对象在 Run 结束后拒绝继续读取”的覆盖。基线先在 running 时打开 access，再结束 Run，以同一个 access 读取并断言 `forbidden`（`.lead-ref/base/tests/runtime/source-binding-migration.test.ts:150`、`:158`）；现在等待结束后才首次调用 factory，完全没有读取。若实现错误地缓存首次授权，旧测会失败，新测仍通过。首次打开检查和后续请求授权分别位于 `src/core/agent-runtime/source-capture-access.ts:324`、`:169`。 | 真实 start 用 A3 gate 停在 running，打开 access；释放 gate，等待真实结束，再用同一个 access 读取同一文件，恢复原 `forbidden` 断言，保留双后端。 |
| R1-02 | 违规 | `tests/composition/platform.test.ts:102` | W1-12 | A6 转换不完整：没有公开创建 Goal/Proposal，前后比较的是未创建 Goal 的读取；所谓 `valid.request` 也缺少 `GraphWrite` 的 `meta/input`，不止 kind 一个错误（`:103`、`:105`）。真实请求形状见 `src/business/workflow/workflow.ts:849`。 | 公开创建 Goal 和候选 Plan，构造完整合法的 `{meta,input}` 请求，仅改 kind；先确认公开读取为 `ready`，再比较拒绝前后的已有状态，保留 `unsupported` 和双后端。 |
| R1-03 | 不整洁 | `tests/helpers/S2B-track-fixture.ts:28` | W1-36 | 回退后八个死导入仍在：`JsonValue`、`continuationBriefDigest`、`renderContinuationBriefZh`、`assembleAnomalySection`、`assembleContinuationBrief`、`PreparedQueryManifestV1`、`PreparedTaskManifestV1`、`QUERY_MANIFEST_CONTENT_TYPE`，均只剩导入位置（`:28`、`:29`、`:30`、`:32`、`:33`）。这是原 G5-05 明确要求清理的部分（`.lead-ref/wave1-audit/t-aud-G5.out.md:13`）。 | 仅删除这八个导入名，保留 W1-15 的 BLOCKED 实现和断言。 |
| R1-04 | 不整洁 | `tests/helpers/S2B-track-fixture.ts:23` | W1-37 | 新注释称“不直接写业务事实”，但仍手造 entered/history（`:352`）和终态 observation（`:387`），与回退后的代码不符。 | 注释明确真实 prepare 已接入，entered/end 仍因 W1-15 BLOCKED 保留手写；只改文字。 |
| R1-05 | 不整洁 | `tests/helpers/S5-decision-fixture.ts:266` | W1-37 | 仍称默认使用 trusted baseline checkpoint；实际默认和 `modules` 都调用公开 `adoptInitialArchitecture`，区别只是空模块列表或 M/N（`:580`、`:582`）。原 G5-10 已点名此注释（`.lead-ref/wave1-audit/t-aud-G5.out.md:18`）。 | 改为“默认公开采用空模块目录，modules 公开采用 M/N 目录”。 |
| R1-06 | 不整洁 | `tests/runtime/source-binding-migration.test.ts:195` | B-04 | 删除 digest 改写子例后，标题仍称验证 `rechecks the accepted ReviewWork`。剩余内容只验证候选文件可读、dist 被拒绝（`:208`、`:213`、`:216`），没有验证打开后重新核对。 | 标题收窄为 `limits a bound Reviewer to candidate source`，不恢复已授权删除的 tamper 子例。 |

**2. 逐行结论**

| 行 | R1 结论及证据 |
|---|---|
| W1-01 | OK。收窄清单由 TP-060 明确覆盖（`.lead-ref/books/t-items-TP.md:433`）；启动 legacy 分支已删，未授权/现行 phase 分支保留（`src/app/startup-reconcile.ts:204`、`:331`）。 |
| W1-02 | OK。公开 admission 默认和校验、accepted 写入、completed 原样展开分别见 `src/core/work-graph/sessions/session-directory.ts:707`、`:782`、`:968`。 |
| W1-03 | OK。`run-machine` 五处均为注释调整，依据就是本行；实际 RUN-16 同提交结算见 `src/core/work-graph/state/run-machine.ts:2219`。 |
| W1-04 | OK。只删除旧 `ProjectSourceIndex` 职责说明（`src/core/workspace/typescript-source-query.ts:8`）。 |
| W1-05 | OK。四组增量断言恢复（`tests/data/typescript-source-query.test.ts:172`）。 |
| W1-06 | OK。名称及四个注册值恢复为字面量（`tests/app/project-source-tool.test.ts:151`）。 |
| W1-07 | OK。记录 tA 后请求数，检查 tB 首请求的最后 user 消息（`tests/scenarios/S3-context-and-inputs.test.ts:358`、`:398`）。 |
| W1-10 | OK，仅指按 R-5 保留；WF01 仍 BLOCKED，见下表及 `.lead-ref/t-w1-findings.md:78`。 |
| W1-11 | OK。四处通过单次公开 `workflow/advance` 检查原结果（`tests/app/A2-continuation-projection.test.ts:57`、`:92`）。 |
| W1-12 | R1-02。`describe` 导入本身必要且正确（`tests/composition/platform.test.ts:1`）。 |
| W1-13 | OK。真实 start、A3 gate、公开 execution read 已接入（`tests/helpers/C1-mailbox-fixture.ts:141`、`:149`）。 |
| W1-14 | OK。删除旧 helper，后续现行 helper 仍在（`tests/helpers/S1-session-facts-fixture.ts:201`）。 |
| W1-15 | OK，仅指 BLOCKED 实现已回退；注释问题另归 W1-37（`tests/helpers/S2B-track-fixture.ts:338`、`:352`、`:394`）。 |
| W1-17 | OK。正式 sender template 与生产五模板匹配已替代 fixture duty 映射（`tests/helpers/S5-decision-fixture.ts:652`、`:869`）。 |
| W1-18 | OK。期望改为手写 `policyRef`（`tests/helpers/S5-queue-support.ts:298`、`:310`）。 |
| W1-19 | OK。经 materials owner 读取；`historical_explanation` 符合 lead 裁定（`tests/helpers/task-claim-fixture.ts:655`；`.lead-ref/books/t-run-W1R1b.md:21`）。 |
| W1-20 | OK。双后端使用同一真实 backend、同一 gate，initiator/read-count 断言保留（`tests/runtime/source-binding-migration.test.ts:248`、`:286`、`:376`、`:386`）。 |
| W1-22 | OK。手算总数 15，成员断言保留（`tests/runtime/K3-34-tool-name-constants.test.ts:59`）。 |
| W1-23 | OK。仅删除明确授权的 KA-07（`.lead-ref/t-w1-findings.md:91`；`.lead-ref/groups/R1.diff` 对应 `tests/scenarios/K-W-workflow-close.test.ts:230` hunk）。 |
| W1-24 | OK。恢复 never-bound CLAIMED→begin 的原 code/detail（`tests/state/run-machine.test.ts:969`）。 |
| W1-29 | OK。仅补 UT28 编号（`tests/state/S1-dispatch.test.ts:109`）。 |
| W1-30 | OK。清理及单次 advance 所需导入（`tests/app/A2-continuation-projection.test.ts:35`；`tests/app/A2-requeue-route.test.ts:26`；`tests/app/A2-reverify-route.test.ts:28`）。 |
| W1-31 | OK。仅清理 CLI 合并后的导入（`tests/app/AG2-consultation.test.ts:27`；`tests/app/R6-host.test.ts:24`）。 |
| W1-32 | OK。死导入及错位 token 注释清理（`tests/app/S2B-r2-backfill-identity.test.ts:18`；`tests/app/S2B-r2-backfill-real-kernel.test.ts:22`、`:61`；`tests/app/S2B-r2-backfill-revision-race.test.ts:16`）。 |
| W1-33 | OK。删除旧设施及空 cleanup，保留有效 mock cleanup（`tests/data/R3b-body-boundaries.test.ts:17`；`tests/data/R3b-materials-contract.test.ts:1`）。 |
| W1-34 | OK。只改 13 Sessions、两个 archived heads 的说明（`tests/app/S2C-line-routes.test.ts:293`、`:298`）。 |
| W1-35 | OK。相关死依赖清理；C1 新依赖已接执行链（`tests/helpers/S1-workflow-archive-fixture.ts:5`；`tests/helpers/C1-mailbox-fixture.ts:33`、`:141`；`tests/helpers/B2-execution-fixture.ts:38`；`tests/helpers/S2A-planning-fixture.ts:9`）。 |
| W1-36 | R1-03。其余两个 S2C helper 的导入清理符合本行（`tests/helpers/S2C-L-runs-support.ts:17`；`tests/helpers/S2C-X-scale-fixture.ts:49`）。 |
| W1-37 | R1-04、R1-05。`pausedB` 已只改措辞，未改变顺序（`tests/helpers/S5-decision-fixture.ts:268`）。 |
| W1-38 | OK。仅清理 WP2 死导入（`tests/helpers/WP2-duties-fixture.ts:6`；`tests/helpers/WP2-notices-fixture.ts:5`）。 |
| W1-39 | OK。删三个死导入，保留 `rm`（`tests/record-store/SP-text-scan.test.ts:12`）。 |
| W1-40 | OK。helper 注释及 Runtime 测试标题已对应实际路径（`tests/helpers/task-claim-fixture.ts:190`；`tests/runtime/R4c-source-authority-guards.test.ts:279`）。 |
| W1-42 | OK，R1 部分仅收窄标题（`tests/state/command-normalization.test.ts:399`）。 |
| W1-43 | OK，限 R1 共享入口：仍通过公开 architecture adoption；AD 测试世界归 R2（`tests/helpers/task-claim-fixture.ts:271`）。 |
| W1-44 | OK。第二份 brief、重写 body/binding 已删，`pendingAnomalies` 断言保留（`tests/helpers/S1-archive-service-fixture.ts:177`、`:182`）。 |
| B-03 | OK。删除属于原地改写，公开提交要求 job/run 不存在（`src/core/work-graph/queries/query-job-service.ts:752`）。 |
| B-04 | R1-01、R1-06；其余 tamper 删除及 ReviewWork BLOCKED 保留符合裁定（`tests/runtime/source-binding-migration.test.ts:149`、`:217`）。 |
| B-05 | OK，同 W1-13（`tests/helpers/C1-mailbox-fixture.ts:141`）。 |
| B-06 | OK，仅指同 W1-10 保留 BLOCKED（`.lead-ref/t-w1-findings.md:138`）。 |
| B-08(a) | OK，仅指已披露的部分完成，未发现新增断言放宽；prepare/start 仍未完成，理由评价见下表（`tests/runtime/R4c-graph-history.test.ts:144`、`:390`）。 |
| B-10 | OK，helper 已公开 adopt→createGoal→propose→read→apply（`tests/helpers/graph-session-fixture.ts:398`、`:406`、`:425`、`:431`、`:433`）。 |

重点证据与行外变更：

- **生产写入点完整性。** operation 只有 accepted 与 completed 两个写入点：省略公开 provenance 时产生 `{schemaVersion:1,kind:'new'}`；显式输入先验证，再写入 action；completed 展开已经解码的 operation，不改 action（`src/core/work-graph/sessions/session-directory.ts:707`、`:710`、`:782`、`:863`、`:968`）。codec 拒绝缺失/null，Session 构造直接复制（`src/core/work-graph/sessions/session-record-codecs.ts:660`；`src/core/work-graph/state/session-availability.ts:339`）。未发现能漏写 provenance 的现行 writer。
- **三个指定生产文件的归属。** `run-machine.ts` 的五处注释属于 W1-03；`session-availability.ts:318`、`:321`、`:339` 属于 W1-02；`src/contracts/run-activity.ts:99` 属于 W1-01/TP-060 的完整清单（`.lead-ref/books/t-items-TP.md:433`）。后者删去 null 分支不影响合法当前数据，因为当前 authorization codec 明确拒绝 null（`src/core/work-graph/persistence/execution-entry-codecs.ts:130`）。
- **W1-13 默认路径。** `host` 是新增选项，`withMailbox` 原已存在。默认 grant 仍取 B2，未传 host 时仍使用原 Runtime host；scripted client 使用支持的 deepseek provider，并在首次请求持住 gate（`tests/helpers/S2B-runtime-steps-fixture.ts:77`、`:172`、`:295`、`:306`、`:321`）。直接 importer 是 C1（`tests/helpers/C1-mailbox-fixture.ts:141`）、timeline（`tests/helpers/S2B-task-timeline-fixture.ts:192`）及只用策略安装函数的 track（`tests/helpers/S2B-track-fixture.ts:77`、`:260`）。timeline 四个 start 均未传 host，保持默认路径（`tests/helpers/S2B-task-timeline-fixture.ts:397`、`:513`、`:534`、`:552`）。
- **W1-17 grant 扩张。** RA 改为 adviser 后确实需要第二个模板；queue helper 仍比较 scope、configurationRevision、完整 permissions 和完整模板含 digest（`tests/helpers/S5-queue-support.ts:107`、`:112`）。现有调用链还检查 caller/envelope binding 和保存的 manifest（`src/core/work-graph/communication/mailbox-service.ts:1283`、`:1326`、`:1373`）。未发现现有 importer 因此放过错误输入；不能据此声称任意“Session/template 错配”都会被拒绝，因为 Host admission 没有通用模板名相等检查（`src/core/work-graph/tasks/execution-entry-service.ts:534`）。
- **上述 grant 影响的 importer。** 直接消费点为 `tests/helpers/S2A-notices-support.ts:186`、`tests/helpers/S2A-notices-overbound-fixture.ts:89`、`tests/work-graph/S2A-notices-counts.test.ts:65`、`tests/work-graph/S2A-notices-rework.test.ts:53`、`tests/work-graph/S2A-notices-since.test.ts:61`、`tests/work-graph/S5-decision-queue.test.ts:56`、`tests/work-graph/S5-notices.test.ts:123`、`tests/work-graph/WP2-context-extensions.test.ts:225`；`noticeWork` 内部也消费（`tests/helpers/S5-queue-support.ts:334`）。传递调用还覆盖 notices attempt、overbound、workspace 三个测试（`tests/work-graph/S2A-notices-attempt.test.ts:12`、`tests/work-graph/S2A-notices-overbound.test.ts:12`、`tests/work-graph/S2A-notices-workspace.test.ts:11`）。
- **四处行外 role 适配必要，未改断言。** planning、K3-46、K3-UR7 改取 RB 的 builder binding（`tests/helpers/S2A-planning-fixture.ts:42`；`tests/business/K3-46-review-advance-failures.test.ts:221`；`tests/business/K3-UR7-crr-failed-set.test.ts:260`）。user-message-tools 对既有 RB manifest/envelope 补齐 builder 配置（`tests/runtime/S5-user-message-tools.test.ts:254`、`:269`）；这仍是旧夹具的必要适配，不能算公开链转换。
- **其余 R1 行外变更。** `describe` 导入是 W1-12 所需；state seed 只补现行 provenance，断言未变，符合已接受 FORMAT；两个 S2C helper 只做 W1-36 死导入清理（`tests/composition/platform.test.ts:1`；`tests/state/session-availability.test.ts:1007`；`.lead-ref/books/t-run-W1R1b.md:30`；`tests/helpers/S2C-L-runs-support.ts:17`；`tests/helpers/S2C-X-scale-fixture.ts:49`）。
- **R-3 删除。** Query accepted request 在进入时固定，后续 entered/settled 保留它，不能公开原地换请求（`src/core/work-graph/state/query-run-recovery.ts:558`、`:568`、`:638`）。running→revoked 的旧输入也不是公开状态迁移：只有 Entering 可证明未进入；重新授权还必须保持原 binding（`src/core/work-graph/state/run-machine.ts:2174`、`:1454`）。Reviewer digest 的旧改写无现行 provider 支持（`src/core/work-graph/source-authority-reader.ts:156`）。这些删除合法；ended 子例的覆盖退化另见 R1-01。
- **W1-44 和 B-10 的跨组证据。** 真实 prepare 写 brief digest/anchors（`src/core/agent-runtime/execution-preparation.ts:596`）。B-10 测试侧须保留无 `openResponsibleLink` 的 claim→busy→cancel→公开读 occupancy=null→单独开责任链接→归档拒绝→关链接→归档成功；当前 R2 文件已显示此链（`tests/work-graph/A1-session-lifecycle.test.ts:133`、`:142`、`:154`、`:158`、`:161`、`:164`、`:168`、`:170`），单独开链接也是原书要求（`.lead-ref/books/t-items-TQ.md:672`）。

**3. BLOCKED 核对**

| 行 | 部分 | DSH 理由是否成立 | 公开步骤是否可达 |
|---|---|---|---|
| W1-10 | WF01：`context_goal_changed` | **成立。** 内容摘要只含 goalId/objective/workspaceId（`src/contracts/graph-context.ts:181`）；创建写内容，control、settings 保留这些字段（`src/core/work-graph/tasks/task-service.ts:223`；`src/core/work-graph/state/goal-machine.ts:124`；`src/core/work-graph/state/goal-settings-machine.ts:233`）。 | **不可达：未发现创建后修改 objective/Workspace 的公开入口。** WF02 可通过公开采用新 Plan revision 触发另一 source 冲突，但本行允许任一不可达时保留原形态（`.lead-ref/t-w1-findings.md:78`）。 |
| W1-15 | track 真实 finish 后保持原 activity 前提 | **成立。** Runtime 终态附 activity，entry 同提交写 RunActivity，backfill 不覆盖 current-rule counted（`src/core/agent-runtime/execution-observation.ts:775`；`src/core/work-graph/tasks/execution-entry-service.ts:1920`；`src/core/work-graph/tasks/run-activity-service.ts:159`）。 | 原测试要求的“真实结束但没有 RunActivity”不能由当前正常 finish 产生（`tests/work-graph/S2B-34-executed-files.test.ts:97`、`:101`）。文件实现确实回退；只留下有问题的注释。 |
| B-04 | accepted ReviewWork + running 先态 | **成立。** 真实 source reader 明确返回 `unsupported`（`src/core/work-graph/source-authority-reader.ts:158`）。 | 该真实读取链目前**不可达**；保留的先态未新增绕过（`tests/runtime/source-binding-migration.test.ts:195`、`:208`）。 |
| B-08(a) | 第二 Run 的 prepare/start | **冲突存在，但不足以成立为阻塞理由。** Runtime 派生身份、禁止覆盖 locator 均属实（`src/core/agent-runtime/execution-driver.ts:620`；`src/core/work-graph/state/run-machine.ts:1250`）；测试身份却是自选值（`tests/runtime/R4c-graph-history.test.ts:376`、`:419`、`:536`、`:726`）。 | **可改走真实 start，并从公开 `readExecution` 取其身份/位置。** direct/evidence/mutation 断言使用变量，不要求旧身份字面量（同文件 `:400`、`:555`、`:733`）；冻结上界场景需 A3 gate 控制真实推进。本次只是公开 cancel→claim 的部分完成，原 bind/断言未变，因此不把理由不足单独算 finding（`:144`、`:390`、`:428`、`:546`、`:734`）。 |
| B-08(a) / B-14 | late-lower-end | 本轮已有明确保留裁定，不据正常 identity 冲突重新裁定该子例（`.lead-ref/t-w1-findings.md:146`）。 | 本次仍保留原 seed/bind 形式，未转换（`tests/runtime/R4c-graph-history.test.ts:619`、`:621`、`:633`）。 |
| B-14 | S5 Project@1、Workspace@3、Goal@6 检查点 | 属于已冻结的待裁定部分，未因本次修改另造初始化方案（`.lead-ref/books/t-items-TP.md:728`）。 | 本轮仍保留检查点，公开初始化和版本映射待 lead 冻结；不据此声称所有公开构造方案都不可行（`tests/helpers/S5-decision-fixture.ts:557`、`:559`、`:592`）。 |

**4. 同一发现的 JSON**

```json
[
  {
    "id": "R1-01",
    "class": "会出错",
    "file": "tests/runtime/source-binding-migration.test.ts",
    "line": 179,
    "row": "B-04",
    "problem": "原测试在running时打开access，Run结束后用同一access读取并断言forbidden；新测试只在结束后首次打开factory并检查抛错。若实现仅检查首次打开、错误缓存后续读取授权，旧测失败而新测仍通过，丢失每请求复核终态的覆盖。",
    "fix": "真实start用A3 gate停在running并打开access；释放gate等待真实结束，再以同一access读取同一文件，保留原forbidden断言和双后端。"
  },
  {
    "id": "R1-02",
    "class": "违规",
    "file": "tests/composition/platform.test.ts",
    "line": 102,
    "row": "W1-12",
    "problem": "没有公开创建Goal和Proposal，前后比较未创建Goal的读取；所谓valid.request还缺少GraphWrite的meta/input，输入不止kind一个错误，不满足A6。",
    "fix": "公开创建Goal和候选Plan，构造完整合法的meta/input请求，仅修改kind；确认公开读取ready后比较拒绝前后状态，保留unsupported和双后端。"
  },
  {
    "id": "R1-03",
    "class": "不整洁",
    "file": "tests/helpers/S2B-track-fixture.ts",
    "line": 28,
    "row": "W1-36",
    "problem": "JsonValue、continuationBriefDigest、renderContinuationBriefZh、assembleAnomalySection、assembleContinuationBrief、PreparedQueryManifestV1、PreparedTaskManifestV1、QUERY_MANIFEST_CONTENT_TYPE八个名字仍仅出现在导入中，原G5-05的清理未完成。",
    "fix": "仅删除这八个未使用导入名，保留W1-15的BLOCKED实现和断言。"
  },
  {
    "id": "R1-04",
    "class": "不整洁",
    "file": "tests/helpers/S2B-track-fixture.ts",
    "line": 23,
    "row": "W1-37",
    "problem": "新注释声称不直接写业务事实，但第352行仍手造entered/history，第387行仍手造终态observation，与回退后的代码不符。",
    "fix": "注释明确真实prepare已接入，entered/end仍因W1-15 BLOCKED保留手写，只改文字。"
  },
  {
    "id": "R1-05",
    "class": "不整洁",
    "file": "tests/helpers/S5-decision-fixture.ts",
    "line": 266,
    "row": "W1-37",
    "problem": "仍称默认使用trusted baseline checkpoint，实际第580行无条件公开adoptInitialArchitecture，选项只控制空模块列表或M/N；原G5-10点名的注释未改。",
    "fix": "改为默认公开采用空模块目录，modules公开采用M/N目录。"
  },
  {
    "id": "R1-06",
    "class": "不整洁",
    "file": "tests/runtime/source-binding-migration.test.ts",
    "line": 195,
    "row": "B-04",
    "problem": "删除digest变化子例后，标题仍声称rechecks the accepted ReviewWork；第208至216行仅验证候选源可读及dist被拒绝，没有验证打开后重新核对。",
    "fix": "标题收窄为limits a bound Reviewer to candidate source，不恢复已授权删除的tamper子例。"
  }
]
```

会出错 1，违规 1，不整洁 4，建议 0