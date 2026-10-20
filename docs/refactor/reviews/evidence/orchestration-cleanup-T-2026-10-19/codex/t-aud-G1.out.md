只读审计完成，未运行测试、构建或写入操作。发现两项违规。下列 `OK` 仅评价 G1 范围及其必要联动；BLOCKED 部分另列，不视为已经完成。

**1. 发现表**

| 编号 | 类别 | 位置 | 条目 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| G1-01 | 违规 | `src/app/startup-reconcile.ts:209`、`src/app/startup-reconcile.ts:336`；其余位置见下 | TP-011、TP-060 | 授权 V1 已退出，但明确要求同批删除的版本收窄及启动 `legacy` 分类仍在。TP-060 的书面改正确认“列明的全部收窄随 V1 退出同批清理”，不是可选清理（`.lead-ref/books/t-items-TP.md:438`）。 | 完成列明的收窄清理：用授权是否存在判断，保留当前 phase、kernel 等判断；删除 `startingEntryOf` 的 `legacy` 返回类型、说明、判定及上报分支。保留无授权的合法路径和当前 V2 行为。 |
| G1-02 | 违规 | `tests/helpers/WP1-units-fixture.ts:512`、`tests/helpers/WP1-units-fixture.ts:515`、`tests/helpers/WP1-units-fixture.ts:530` | TP-009、TP-054 | 必填 `contextAssembly` 的联动转换没有走真实 prepare，而是调用 assembler 后继续手拼 manifest、envelope 和 prepared。运行时替身仍将 `prepareExecution` 设为 `forbidden`（同文件 `:558`）。这正是书面改正排除的构造器替代方案；“Runtime double 不能 prepare”不能授权另造路径（`.lead-ref/books/t-items-TP.md:70`、`:394`；`.lead-ref/books/t-book.md:63`）。 | 用公开创建、领取及真实 `prepareExecution` 取得 prepared/manifest；在真实 Runtime 外使用 A2 失败包装注入 WF01/WF02 所需拒绝，保留原拒绝断言，删除这里手拼 manifest/prepared 的路径。 |

G1-01 在本组的其他漏项：

- `src/app/goal-fan-out-driver.ts:364`
- `src/business/workflow/workflow.ts:1132`
- `src/composition/create-platform.ts:2124`
- `src/core/agent-runtime/context-assembler.ts:1471`
- `src/core/agent-runtime/execution-driver.ts:614`、`:1038`、`:1056`、`:1303`
- `src/core/agent-runtime/run-reconcile.ts:102`、`:264`、`:699`
- `src/core/agent-runtime/runtime.ts:329`

G1-02 是必填字段组合的下游核对结果；该夹具虽不在 G1 生产文件清单内，却被 TP-009 明确列为必须迁移的构造方（`.lead-ref/books/t-items-TP.md:66`）。

**2. 逐项结论**

| 条目结论 | 核对位置 |
|---|---|
| TP-001: OK | `src/business/workflow/workflow.ts:813`；`tests/composition/platform.test.ts:81` |
| TP-002: OK | `.lead-ref/groups/G1.diff:868` |
| TP-003: OK | `src/core/work-graph/model/claim-contracts.ts:91`；`tests/state/attempt-machine.test.ts:702` |
| TP-004: OK | `tests/business/K3-UR7-crr-failed-set.test.ts:384`、`:441`；`tests/business/K3-46-review-advance-failures.test.ts:626`、`:733` |
| TP-005: OK | `src/business/workflow/workflow.ts:813`；`tests/composition/platform.test.ts:81` |
| TP-006: OK | `src/business/workflow/decision-actions.ts:381`；`.lead-ref/groups/G1.diff:856` |
| TP-007: OK | `src/core/work-graph/state/session-availability.ts:339`；`tests/scenarios/S2C-K-legacy-provenance.test.ts:100` |
| TP-008: OK | `.lead-ref/groups/G1.diff:868` |
| TP-009: G1-02 | `tests/helpers/WP1-units-fixture.ts:515` |
| TP-010: OK | `src/contracts/core/prepared-execution.ts:189`；BLOCKED 字段仍保留 |
| TP-011: G1-01 | `src/app/startup-reconcile.ts:209` |
| TP-012: OK | `.lead-ref/groups/G1.diff:1289` |
| TP-013: OK | `.lead-ref/groups/G1.diff:1327` |
| TP-014: OK | `src/core/work-graph/state/goal-machine.ts:96` |
| TP-015: OK | `src/core/work-graph/queries/query-job-service.ts:278`；`src/core/work-graph/queries/query-record-codecs.ts:237` |
| TP-016: OK | `tests/architecture/production-reach-allowlist.json:380` |
| TP-017: OK | `.lead-ref/groups/G1.diff:1587` |
| TP-018: OK | `tests/architecture/production-reach-allowlist.json:386` |
| TP-019: OK | `tests/architecture/production-reach-allowlist.json:392` |
| TP-020: OK | `tests/architecture/production-reach-allowlist.json:398` |
| TP-021: OK | `tests/architecture/production-reach-allowlist.json:404` |
| TP-022: OK | `tests/architecture/production-reach-allowlist.json:410` |
| TP-023: OK | `tests/architecture/production-reach-allowlist.json:416` |
| TP-024: OK | `tests/architecture/production-reach-allowlist.json:422` |
| TP-025: OK | `src/contracts/verification.ts:238`；`src/core/work-graph/state/verification-machine.ts:913` |
| TP-026: OK | `src/core/agent-runtime/exploration-tools.ts:108`；`tests/data/typescript-source-query.test.ts:149` |
| TP-027: OK | `.lead-ref/groups/G1.diff:274`、`:1868`、`:2295` |
| TP-028: OK | `.lead-ref/groups/G1.diff:1988`、`:2145` |
| TP-029: OK | `src/core/agent-runtime/session-operations.ts:178`、`:213` |
| TP-030: OK | `src/core/agent-runtime/source-capture-access.ts:615`；BLOCKED 子场景见下 |
| TP-031: OK | `src/app/host.ts:1224`；`resources/skills/platform-work/content.md:24`；`runtime-assets.json:48` |
| TP-040: OK | `src/core/work-graph/model/claim-contracts.ts:91`；`tests/state/attempt-machine.test.ts:702` |
| TP-041: OK | `src/core/work-graph/model/claim-contracts.ts:91`；`src/core/work-graph/state/attempt-machine.ts:54` |
| TP-045: OK | `src/core/work-graph/state/verification-machine.ts:629`、`:913` |
| TP-048: OK | `.lead-ref/groups/G1.diff:1084`、`:1096` |
| TP-049: OK | `.lead-ref/groups/G1.diff:1127`、`:1365` |
| TP-050: OK | `src/core/work-graph/tasks/plan-commit-compiler.ts:157`、`:409` |
| TP-051: OK | `src/core/work-graph/state/goal-machine.ts:96`；`src/core/work-graph/persistence/record-codecs.ts:839` |
| TP-052: OK | `src/core/work-graph/queries/query-job-service.ts:496`、`:729` |
| TP-053: OK | `src/core/work-graph/sessions/session-directory.ts:708`、`:722` |
| TP-054: G1-02 | `tests/helpers/WP1-units-fixture.ts:512` |
| TP-056: OK | `src/core/agent-runtime/observed-model-run.ts:13`、`:303` |
| TP-060: G1-01 | `src/app/startup-reconcile.ts:209`、`:336` |
| TP-061: OK | `src/core/agent-runtime/context-assembler.ts:775` |
| TP-062: OK | `src/core/work-graph/state/session-availability.ts:339`；`tests/scenarios/S2C-K-legacy-provenance.test.ts:102` |
| TP-063: OK | `.lead-ref/groups/G1.diff:1289` |
| TP-109: OK | `src/app/startup-reconcile.ts:410`；`src/core/agent-runtime/run-reconcile.ts:534` |
| TP-117: OK | `tests/runtime/source-binding-migration.test.ts:139`；BLOCKED 部分见下 |
| TP-118: OK | `tests/runtime/source-binding-migration.test.ts:372`、`:399`；BLOCKED 部分见下 |
| TP-119: OK | `tests/runtime/source-tool-lifecycle.test.ts:226`、`:244` |
| TQ-001: OK | `src/app/host.ts:1444`；`.lead-ref/books/t-run-TQ2.md:20` |
| TQ-062: OK | `src/app/host-settings.ts:564`、`:565` |
| TQ-063: OK | `tests/architecture/production-reach-allowlist.json:368` |
| TQ-064: OK | `tests/architecture/production-reach-allowlist.json:374` |
| TQ-065: OK | `.lead-ref/groups/G1.diff:1525` |
| TQ-066: OK | `.lead-ref/groups/G1.diff:1525` |
| TQ-067: OK | `.lead-ref/groups/G1.diff:1525` |
| TQ-068: OK | `.lead-ref/groups/G1.diff:1525` |
| TQ-069: OK | `.lead-ref/groups/G1.diff:1525` |
| TQ-070: OK | `src/core/record-store/body-codec.ts:188`、`:210`、`:218` |
| TQ-071: OK | `src/core/record-store/sqlite-lookup-indexes.ts:91`、`:106` |
| TQ-072: OK | `src/core/record-store/sqlite-text-scan.ts:122`；`tests/record-store/SP-text-scan.test.ts:315`、`:349` |
| TQ-089: OK | `.lead-ref/groups/G1.diff:1525` |
| TQ-091: OK | `src/core/work-graph/architecture/catalog-service.ts:551`、`:729` |

必填字段和记录的当前写入核对：

| 字段或记录 | 当前写入路径及结论 |
|---|---|
| 正文 `origin` | 内存和 SQLite 均经过 `RawArtifactBodyStore.put` 的同一编码器：`src/core/record-store/body-store.ts:30`、`src/core/record-store/sqlite-body-store.ts:48`。编码器先校验 origin，再无条件序列化该字段：`src/core/record-store/body-codec.ts:210`、`:218`。SQLite INSERT 接收该编码结果：`src/core/record-store/sqlite-body-store.ts:29`、`:40`。未发现绕过它的当前生产 writer。 |
| Task/Query `contextAssembly` | Task 写入 `assembled.value.binding`：`src/core/agent-runtime/execution-preparation.ts:498`、`:533`；Query 同样无条件写入：`src/core/agent-runtime/query-preparation.ts:329`、`:356`。生产路径没有遗漏；测试构造方的问题是 G1-02。 |
| Session `provenance` | 创建输入省略时先生成 `new`，写入 accepted operation，再创建 Session：`src/core/work-graph/sessions/session-directory.ts:708`、`:782`、`:961`。状态构造函数也保证非空：`src/core/work-graph/state/session-availability.ts:339`。 |
| Goal 两个控制字段 | 新 Goal 和创建事件重建两条路径都写 `desiredStateRevision: 1`、`desiredStateRequestedBy: null`：`src/core/work-graph/state/goal-machine.ts:96`、`src/core/work-graph/persistence/record-codecs.ts:839`；编码器不再剥离：`src/core/work-graph/persistence/record-codecs.ts:703`。 |
| Query intent 的 `execution` | 提交入口在写入前拒绝缺失字段：`src/core/work-graph/queries/query-job-service.ts:278`；记录解码执行相同形状要求：`src/core/work-graph/queries/query-record-codecs.ts:237`。 |
| Query snapshot 的 `submission` | 正常提交和事件重建两处均提供完整定位信息：`src/core/work-graph/queries/query-job-service.ts:729`、`:496`；状态构造函数无条件写入：`src/core/work-graph/state/query-run-recovery.ts:492`。后续状态更新保留它：同文件 `:562`。 |
| Round `chain` | 根轮次由 `buildOpenedRound` 写根链：`src/core/work-graph/state/verification-machine.ts:913`；后继由 `buildSuccessorRound` 构造完整链：同文件 `:629`、`:642`、`:678`。 |
| 授权 V2 | 初次授权及再次授权均显式写 V2：`src/core/work-graph/state/run-machine.ts:856`、`:952`；后续变化展开保留授权内容：同文件 `:867`、`:963`。 |
| Plan V2 | 初次采用和计划变更两处快照构造均写 V2：`src/core/work-graph/tasks/plan-commit-compiler.ts:157`、`:409`；分别在 `:245`、`:436` 提交。 |
| 历史游标 `l` | 唯一编码函数始终写 `l: cursor.lower`：`src/core/agent-runtime/session-operations.ts:178`；调用方提供 lower：同文件 `:361`、`:481`、`:501`、`:511`。 |
| Host 设置快照 | `snapshotOf` 始终填充 `automation` 和 `resourceCaps`：`src/app/host-settings.ts:548`、`:564`、`:565`；本次仅收紧快照类型：`.lead-ref/groups/G1.diff:222`。 |
| Architecture catalog 行 | 初次采用和修订均在同一 commit 写 baseline、catalog、active：`src/core/work-graph/architecture/catalog-service.ts:547`、`:550`、`:551`、`:552`，以及 `:725`、`:728`、`:729`、`:730`。修订位置也绑定在同一提交：`:736`。 |

其他重点核对：

- `host.ts` 两个 hunk 分别属于 TP-031 的 inquiry 读取清理和 TQ-001 的必需 `readAttentionGraph` 接线：`src/app/host.ts:1224`、`:1444`。`main.ts` 的代码 hunk 是 TP-027 删除 `legacyEntries`，没有额外启动行为改动：`.lead-ref/groups/G1.diff:274`。TQ-063/064 只改白名单说明：`tests/architecture/production-reach-allowlist.json:368`、`:374`。
- 资源文字和 SHA 更新由 TP-031 明确要求：`.lead-ref/books/t-items-TP.md:225`。`resources/skills/platform-work/content.md:24` 的变化仅删除旧 `replyMode` 说明；内容计算出的 SHA256 与 `runtime-assets.json:48` 一致。
- TQ-071 保留缺索引创建及事务内重规划；当前索引齐全时仍直接返回：`src/core/record-store/sqlite-lookup-indexes.ts:95`、`:110`、`:111`、`:113`。SP-40～43 仍在：`tests/record-store/SP-lookup-index-migration.test.ts:107`、`:154`、`:188`、`:223`。
- TQ-072 删除的是旧 `next_fts_` 清理路径；当前元数据初始化和当前索引处理路径保留：`src/core/record-store/sqlite-text-scan.ts:122`。当前注册表追赶、重建及注册表变化拒绝仍有断言：`tests/record-store/SP-text-scan.test.ts:315`、`:349`、`:373`。
- 正文首写归属及重开读取的覆盖仍在，重开断言明确检查 `origin.owner`：`tests/data/R3b-materials-contract.test.ts:45`；`tests/record-store/R3b-body-concurrency.test.ts:90`。
- 删除声明已回查整个 `src`，未发现生产调用遗留。C1 的真实 `DispatchStateV1` 保留，`TaskClaimOutbox` 已直接别名到 `DispatchOutboxRecord`，outbox 恒等断言也保留：`src/core/work-graph/state/attempt-machine.ts:54`、`src/core/work-graph/model/claim-contracts.ts:91`、`tests/state/attempt-machine.test.ts:702`。
- N0 删除后，未知 kind 的 `unsupported` 边界及替换后的测试仍在：`src/business/workflow/workflow.ts:813`、`tests/composition/platform.test.ts:81`。保留的 indexed execution 场景通过当前 Session、真实 Work claim 和公开提交的 pending Query 重建，并断言列表范围、数量及不含 Query：`tests/scenarios/S2C-K-legacy-provenance.test.ts:38`、`:82`、`:102`。

**3. BLOCKED 和部分完成项**

| 条目 | 部分 | DSH 理由是否属实 | 公开步骤是否可达 |
|---|---|---|---|
| TP-010 | 删除 manifest `selectedTaskInputs` | 属实：删除决定未冻结（`.lead-ref/books/t-items-TP.md:78`）；字段仍保留（`src/contracts/core/prepared-execution.ts:189`）。 | 这是待裁定的格式变更，不是可达性问题；真实 prepare 当前仍写该字段（`src/core/agent-runtime/execution-preparation.ts:531`）。 |
| TP-025／TP-045 | 无 chain、旧根及槽冲突子场景 | 缺 chain 的旧根确实仍在被冻结测试中（`tests/work-graph/A2-gate-chain-facts.test.ts:223`；`tests/work-graph/R3e-reverify.test.ts:475`）。但不能把所有失败都归为缺 chain：另一 subject 用例展开了完整 finalized，并没有删 chain（`tests/work-graph/A2-gate-chain-facts.test.ts:302`）。 | 无 chain 根不可由当前公开创建路径产生：根和后继均写 chain（`src/core/work-graph/state/verification-machine.ts:913`、`:642`）。这些保留断言待 lead 裁定，不据此新增发现。 |
| TP-030／TP-118 | `changed current execution` | 属实：该测试仍通过 `state.set` 改事实，整条第二测试被书面冻结（`tests/runtime/source-binding-migration.test.ts:399`、`:405`；`.lead-ref/books/t-items-TP.md:222`）。 | 当前 entering 步骤固定 request，后续状态转换保留它；没有公开“原地替换同一运行请求”的步骤（`src/core/work-graph/state/query-run-recovery.ts:558`）。 |
| TP-117 | 两个 `workFixture` 消费者 | 属实：仍包含直接改状态的前置；书面回复将逐断言迁移留给 lead（`tests/runtime/source-binding-migration.test.ts:139`、`:147`、`:164`；`.lead-ref/replies/t-reply-TP.md:198`）。 | 真实运行结束可通过 Runtime 到达；任意改写同一 Run 的身份或执行事实不能由该公开流程产生。entered 事实由 Runtime 自己记录（`src/core/agent-runtime/execution-driver.ts:1008`）。 |
| TP-054／TP-081 | C1 的 entered 前置 | 保存的代码能证明仍使用旧 entered seed（`tests/helpers/C1-mailbox-fixture.ts:166`、`:174`）；不能仅凭回复证明“尝试时只到 entering、零模型调用”。 | entered 本身可达：真实 `prepareExecution → startRun`，在模型提供方设置 A3 闸门；已有此模式（`tests/runtime/B2-runtime-execution.test.ts:342`、`:354`、`:356`）。Runtime 在模型前记录 entered（`src/core/agent-runtime/execution-driver.ts:981`、`:1008`）。 |
| TP-054 | WP1 Runtime double | “当前 double 无法 prepare”属实，它明确禁止该方法（`tests/helpers/WP1-units-fixture.ts:558`）；新加 assembler 补 binding 是绕过，计 G1-02。 | 真实准备入口存在（`tests/helpers/task-claim-fixture.ts:570`、`:593`）；拒绝通过 A2 包装注入，不需要手造 prepared。 |
| TP-054／TP-165 | AD06 | 书面要求先冻结未进入故障和 Host reconcile；手写 revoked 部分仍在（`.lead-ref/books/t-items-TP.md:1223`；`tests/work-graph/S3-prepared-context-admission.test.ts:567`）。 | 目标撤销状态有真实 reconcile 路径；本条缺的是已冻结的故障与观察步骤，不能将直接写 revoked 当作公开步骤（`.lead-ref/books/t-items-TP.md:1219`、`:1223`）。 |
| TP-054／TP-165 | AD08 | “真实 binding 没有 Workspace source”的理由成立：基础 sources 只加入 Goal、Plan、baseline、Run（`src/core/work-graph/views/graph-context-reader.ts:1010`）；相关拒绝只检查 binding 中的 Workspace source（`src/core/work-graph/tasks/execution-entry-service.ts:1073`）。 | 公开 `setLinePins` 可到 @7→@8，但不足以到达该 Workspace-source 拒绝分支；当前测试已使用真实变更，拒绝断言仍待裁定（`tests/work-graph/S3-prepared-context-admission.test.ts:601`、`:603`）。 |
| TP-054 | S2B requeue 的 `totalBytes` 阻塞 | 最终树已不再二次追加 continuation brief；早期阻塞描述不再对应当前代码（`tests/helpers/S2B-track-fixture.ts:340`、`:342`）。 | 当前真实 prepare 已携带 continuation brief；原先的重复追加已删除（同文件 `:340`）。 |
| TQ-001 | 固定 `plan:p1` | 初始规划不能产生这个字面 ID 的理由属实，ID 被规范化为确定性哈希（`src/core/work-graph/tasks/initial-plan.ts:105`）。lead 明确要求暂留（`.lead-ref/books/t-run-TQ2.md:20`），不列违规。 | “两世界同一 Plan 身份”可通过相同 project、goal、intent 输入得到；字面 `p1` 不可由此入口产生（`src/core/work-graph/tasks/initial-plan.ts:107`）。 |
| TQ-091 | 裸 baseline 夹具 | 对 TQ 独立分支成立；合并树已处理：task-claim 使用真实采用（`tests/helpers/task-claim-fixture.ts:270`），R4b 同提交补 catalog（`tests/work-graph/R4b-session-directory.test.ts:100`）。 | `adoptInitialArchitecture`、`reviseCatalog` 均能产生完整当前记录，且 baseline/catalog 同提交（`src/core/work-graph/architecture/catalog-service.ts:550`、`:551`、`:728`、`:729`）。 |

**4. 相同发现的 JSON**

```json
[
  {
    "id": "G1-01",
    "class": "违规",
    "file": "src/app/startup-reconcile.ts",
    "line": 209,
    "item": "TP-011, TP-060",
    "problem": "授权 V1 已退出，但明确要求同批清理的版本收窄及 legacy 启动分类仍保留。启动上报分支位于 src/app/startup-reconcile.ts:336；其他漏项位于 src/app/goal-fan-out-driver.ts:364、src/business/workflow/workflow.ts:1132、src/composition/create-platform.ts:2124、src/core/agent-runtime/context-assembler.ts:1471、src/core/agent-runtime/execution-driver.ts:614、1038、1056、1303、src/core/agent-runtime/run-reconcile.ts:102、264、699、src/core/agent-runtime/runtime.ts:329。书面改正要求全部同批清理，见 .lead-ref/books/t-items-TP.md:438。",
    "fix": "完成列明的收窄清理，以授权是否存在判断，保留当前 phase、kernel 等判断；删除 startingEntryOf 的 legacy 返回类型、说明、判定及上报分支，保留无授权合法路径和当前 V2 行为。"
  },
  {
    "id": "G1-02",
    "class": "违规",
    "file": "tests/helpers/WP1-units-fixture.ts",
    "line": 512,
    "item": "TP-009, TP-054",
    "problem": "startRefusalWorkflow 新增调用 assembler 后，仍在第515行手拼 manifest、第530行手拼 prepared/envelope，第558行仍禁止 prepareExecution；没有按书面改正统一真实 prepare。DSH 将 Runtime double 标为阻塞后采用了补 binding 的替代路径，违反 .lead-ref/books/t-items-TP.md:70、394 和 .lead-ref/books/t-book.md:63。",
    "fix": "用公开创建、领取及真实 prepareExecution 取得 prepared/manifest，在真实 Runtime 外使用 A2 失败包装注入 WF01/WF02 所需拒绝，保留原拒绝断言，删除这里手拼 manifest/prepared 的路径。"
  }
]
```

会出错 0，违规 2，不整洁 0，建议 0