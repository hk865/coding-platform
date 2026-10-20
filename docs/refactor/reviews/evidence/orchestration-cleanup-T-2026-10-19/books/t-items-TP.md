# T items, group TP (172 items; generated from the verified inventory, lead 2026-10-19)

编号 = 组内序号 · 清点编号（A1-07 = Codex 清点 A1 区第 7 条；D:… 的条目只在 DSH 清点里出现，编号前不带 C:）。 动作是最终的；看不懂或和代码对不上的，标 BLOCKED 并报证据（任务书 §1）。

### TP-001 · P1-188 · n0 · ['src/business/workflow/contracts.ts', 'src/business/workflow/index.ts', 'src/business/workflow/ports.ts', 'src/business/workflow/workflow.ts', 'tests/composition/platform.test.ts']:['1,3,18,60-68', '4', '42,221-226', '40,810,813,815-819', '79-83']
- **动作：** delete
- **覆盖/依据：** 旧 N0 行为从未实现；现行初始规划流程保留：tests/business/R5b-initial-planning-workflow.test.ts:247,292,311，tests/app/R6-host.test.ts:711,807,834；handleGoalInput 和 workflow.ts:815-819 的 kind 边界检查保留（reason 文字去掉 N0）
- **核实理由：** N0GoalInput 声明在 contracts.ts:60-68，它的导入在 :1（ArtifactRef 只给它用）、:3 的 CommandMeta、:18 的 CreateGoalInput，转出在 index.ts:4，用在 ports.ts:42、221-226 和 workflow.ts:40、810、813；workflow.ts:815-819 对非 planning_answer/adopt_initial_plan 一律回 unsupported。唯一传 N0 形状的测试是 platform.test.ts:79-83，类型收窄后要删。UI 在 scope-state.ts:87 用 Extract 取类型，不受影响。另外，删掉那 5 行以后，没有测试再覆盖“未知 kind 回 unsupported”这一支；它是 HTTP 边界（core-routes.ts:1097），按 AGENTS 第 3 条不补测试即可。
- **涉及测试：** tests/composition/platform.test.ts:50::%s: public composition wires Host material and real workspace reads with narrow unsupported gaps
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：5
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：删除 N0 测试会同时丢失仍存在的未知 kind unsupported 拒绝覆盖。 改法：删除 N0 专用代码，把现有拒绝测试输入改为非 N0 的未知 kind，保留 unsupported 断言；与 TP-005 合并执行一次。

### TP-002 · P1-183 · c1-transfer · ['src/contracts/architecture-inspection.ts', 'src/contracts/architecture-source.ts', 'src/contracts/artifact.ts', 'src/contracts/command-event.ts', 'src/contracts/context-continuity.ts', 'src/contracts/control-intent.ts', 'src/contracts/coordination.ts', 'src/contracts/core/call-context.ts', 'src/contracts/core/identity.ts', 'src/contracts/core/results.ts', 'src/contracts/core/source.ts', 'src/contracts/dispatch.ts', 'src/contracts/evidence.ts', 'src/contracts/fingerprint.ts', 'src/contracts/goal-change.ts', 'src/contracts/goal-phase.ts', 'src/contracts/governance.ts', 'src/contracts/human-role-collaboration.ts', 'src/contracts/initial-planning.ts', 'src/contracts/ledger.ts', 'src/contracts/material-access.ts', 'src/contracts/opaque.ts', 'src/contracts/plan.ts', 'src/contracts/query-job.ts', 'src/contracts/reduction.ts', 'src/contracts/reviewer-work.ts', 'src/contracts/role-spec.ts', 'src/contracts/task-envelope.ts', 'src/contracts/validation/common.ts', 'src/contracts/validation/goal.ts', 'src/contracts/validation/identity.ts']:所有文件均为1
- **动作：** delete
- **覆盖/依据：** 注释无行为；只删 31 个文件第 1 行这句注释，不动声明或文件；没有测试或脚本引用这句话
- **核实理由：** grep 在 src 里找到这句完全相同的注释恰好 31 处，都在第 1 行，文件清单和发现里列的一致（全在 src/contracts 下）；tests、scripts 里没有引用“Migrated contract”或“transfer manifest”的地方。C1 裁定 3（c1-lead-rulings.md:24）交 T。生产代码 31 行，测试 0 行。
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：0

### TP-003 · P1-186 · c1-transfer · ['src/core/work-graph/model/claim-contracts.ts', 'src/core/work-graph/persistence/execution-entry-codecs.ts', 'tests/state/attempt-machine.test.ts']:['92-94及相关导入', '9,39,45', '37,708-709,711-712']
- **动作：** delete：claim-contracts.ts:92 的 TaskDispatchStateV1 别名（:93-94 的 V2 转出也没人从这里导入，可以一起删）；同文件 :105 的 dispatchState 字段要改用 DispatchStateV1，或者先做 P1-185 让这一行消失；execution-entry-codecs.ts:39 的导入、:45 转出里的 TaskDispatchStateV1、:9 注释；tests/state/attempt-machine.test.ts:37 去掉 TaskDispatchStateV1，删 :708-709、711-712，:34 的 DispatchStateV1 导入随之不再使用，一起去掉
- **覆盖/依据：** 当前 DispatchStateV1（state/attempt-machine.ts:54-61）；只删 V1 别名的恒等断言，保留 outbox 断言和状态行为
- **核实理由：** 这个别名只有测试在用（attempt-machine.test.ts:37、708-709），execution-entry-codecs.ts:39、45 只是转出，没人导入；这些都成立。但删除清单漏了 claim-contracts.ts:105，TaskClaimOutbox 的 dispatchState 字段还在用这个别名，只删 :92 会编译不过；所以要和 P1-185 一起做，或者把这一行改成 DispatchStateV1。另外做了 P1-185 以后，:706-707、710 只是同一个别名的恒等转换，整条 it（705-713，9 行）也可以删，由 lead 定。
- **涉及测试：** tests/state/attempt-machine.test.ts:705::DispatchOutboxRecord is the TaskClaimOutbox record of claim-contracts.ts
- 来源：Codex；核实：partly；规格行：否；估计行数：6
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：保留 outbox 断言与整条 it 可删两种指令冲突。 改法：与 TP-040 同批，只删除 V1 别名相关导入及第 708、709、711、712 行，保留第 706、707、710 行。

### TP-004 · P2b-11 · legacy · src/business/workflow/contracts.ts:234-238,267-272
- **动作：** delete
- **覆盖/依据：** 删除 contracts.ts:234-238、266-272 两个死声明；tests/business/K3-UR7-crr-failed-set.test.ts:388、445 和 tests/business/K3-46-review-advance-failures.test.ts:736 已断言旧字段不出现；workflow.ts:725 和 K3-46:629 的公共入口拒绝保留
- **核实理由：** 全 src 里 failedReviewRefs 只剩这两处类型声明、workflow.ts:510 的说明和 :725 的公共输入拒绝；Host driver 只发 failedCardRefs（collaboration-driver.ts:818-819），readyValue 只产出 failedCardRefs（workflow.ts:512-521），failedCardRefsFromInternal 只解析 failedCardRefs（workflow.ts:693），两处声明里“仍发送/投影”的说法已不成立（K3 审计 F-077 也记为卫生项）。
- **涉及测试：** tests/business/K3-UR7-crr-failed-set.test.ts:388,444-445::旧字段不存在的断言; tests/business/K3-46-review-advance-failures.test.ts:629,736::公共输入拒绝与旧字段不存在
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：11
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：删除字段类型后，三处点访问断言需要同步改写，文件属于 T3。 改法：三处改用 not.toHaveProperty('failedReviewRefs')，保留公共拒绝断言并安排 T3 串行交接。

### TP-005 · P2b-21 · n0 · src/business/workflow/contracts.ts:60-68
- **动作：** change:删 contracts.ts:60-68 的 N0GoalInput，以及只为它保留的导入（contracts.ts:1 ArtifactRef、:3 CommandMeta、:18 CreateGoalInput）；删 index.ts:4、workflow.ts:40、ports.ts:42 的导出/导入，workflow.ts:813 和 ports.ts:226 的联合成员；改 workflow.ts:810、ports.ts:221 的注释和 workflow.ts:818 的拒绝理由（code 仍用 unsupported，未知 kind 的边界拒绝 815-818 保留）；删 tests/composition/platform.test.ts:79-83 的 N0 调用断言
- **覆盖/依据：** 依据 HANDOFF.md:683（85-4）；当前规划入口由 R5b-initial-planning-workflow.test.ts:247 和 R6-host.test.ts:807、834 覆盖。和 P1 的 n0 项是同一项
- **核实理由：** 核心判断成立：N0GoalInput 只出现在 contracts.ts:62、index.ts:4、workflow.ts:40/813、ports.ts:42/226；UI 只发 InitialPlanningGoalInput（scope-state.ts:134）。但改法漏了两处。一是 tsconfig.json 的 include 含 tests/**，platform.test.ts:79-83 用 N0 形状调用，删掉类型后过不了类型检查，这几行必须删或改。二是 contracts.ts 里三个导入只给 N0GoalInput 用，删了类型后要一起清掉。
- **涉及测试：** tests/composition/platform.test.ts:50,79-83::public composition 中 N0 unsupported 断言; tests/business/R5b-initial-planning-workflow.test.ts:247::consumes the answer, adopts the candidate, then advances to a formal Goal completion
- 来源：Codex = DSH；核实：partly；规格行：否；估计行数：25
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：重复 TP-001，且同样会删除未知 kind 的当前拒绝覆盖。 改法：由修正后的 TP-001 吸收，不再次删除测试。

### TP-006 · P2b-10 · old-data · src/business/workflow/decision-actions.ts:190-205,363-411
- **动作：** change:删除缺 captured source 的兼容执行路径（decision-actions.ts:386-411 和 :196-197、:341-342 的说明），缺规范来源明确拒绝；同时删掉只喂这条路径的 Workflow 依赖 decisionSources（decision-actions.ts:85、business/workflow/ports.ts:173、workflow.ts:2882、create-platform.ts:1878，createDecisionSourceFacts 本身因 :947 的 decision-service 继续保留）和测试夹具里的传参
- **覆盖/依据：** 旧回答形状依 docs/refactor/HANDOFF.md:566 退役；tests/scenarios/S5-two-request-decisions.test.ts SC01 在 84、147-148 钉住当前来源、pins 和应用证明；夹具传参要去掉：tests/business/K3-46-review-advance-failures.test.ts:241、tests/business/K3-UR7-crr-failed-set.test.ts:281、tests/helpers/K3-blocked-command-fixture.ts:499、tests/helpers/K3-review-card-fixture.ts:315、tests/helpers/S5R2-b-support.ts:139、tests/helpers/S5R2-c-support.ts:936
- **核实理由：** 核心成立：两个回答写入点 decision-service.ts:784、841 都写 decision.source，消息解码在带 decision 时强制 source 和 pins（message-record-codecs.ts:684-690、531），resolveDecision 和 advanceReviewDisposition 拿到的回答都是这种形状（decision-actions.ts:538、585）；但 Workflow 的 decisionSources 依赖只在 :389、:392 被用到，清单漏了它和它的传参。
- **涉及测试：** tests/scenarios/S5-two-request-decisions.test.ts:37::SC01 two root requests
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：40
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：外部 Workflow 装配遗漏白名单；部分 sources 仍被 decision service 使用。 改法：删除 Workflow 的 decisionSources 参数及专用构造，保留 K3-review-card-fixture 中传给 decision service 的 sources。

### TP-007 · P2b-06 · old-data · src/business/workflow/session-maintenance.ts:365-398,604-618,695-702
- **动作：** change（随 P2a 把 Session.provenance 改必需）：删旧来历回填 session-maintenance.ts:365-398 的 backfillLegacyProvenance、:604-618 的页内回填、:695-702 的 legacyPending/无来历拒绝；删 ports.ts:137-141、contracts/core/session.ts 的旧回填类型、create-platform.ts:804-808,1834-1837 等接线、createLegacySessionProvenanceReader 和 session-directory.ts:518,1608 起的 backfillSessionProvenance；S2C-K-legacy-provenance.test.ts:482 的执行列表索引场景改造保留
- **覆盖/依据：** 行为已不存在：唯一 Session writer session-directory.ts:971-977 取已接受操作的 provenance，而 :716-717,792 对缺字段输入也写 {kind:'new'}
- **核实理由：** DSH 说当前路径不写 provenance 不对：workflow.ts:1883 不传 provenance 时 session-directory.ts:716-717 给默认 new 并在 :792 存进操作，:970-977 再写进 Session，:728-732 只是指纹里不放这个键；createSessionRecord 在 src 只有 :971 一处调用，所以缺来历只来自旧版本数据。
- **涉及测试：** tests/scenarios/S2C-K-legacy-provenance.test.ts:437::2C-26 before maintenance; tests/scenarios/S2C-K-legacy-provenance.test.ts:462::2C-26 after one maintenance pass
- 来源：冲突裁定（采用 codex）；核实：refuted；规格行：是；估计行数：100

### TP-008 · P2b-20 · c1-transfer · src/contracts/architecture-inspection.ts:1；同类共31文件第1行
- **动作：** delete
- **覆盖/依据：** 纯注释，没有运行时行为；lead-acceptance.md:77、92 已移交 T。和 P1 的 c1-transfer (a) 是同一项，合并时只计一次
- **核实理由：** Grep 核实：src 下正好 31 个文件第 1 行是这句来源注释，和 Codex 列的一致；tests、scripts 里没有任何地方引用这句。lead-acceptance.md:77、92 写明移交 T。这一项和 P1 区域的 (a) 重复。
- 来源：Codex；核实：confirmed；规格行：否；估计行数：31

### TP-009 · P2b-16 · old-data · src/contracts/core/prepared-execution.ts:201-205,270-271
- **动作：** change:PreparedTaskManifestV1/PreparedQueryManifestV1.contextAssembly 改为必需；删去 execution-preparation.ts:520-521,533、query-preparation.ts:359 的条件写入，context-input.ts:225、execution-entry-service.ts:1065、query-execution.ts:1079 的缺省放行；AD05 按 79-1 退役；约 22 处手写缺 contextAssembly 的 manifest 改走真实 prepare，或用一个共享的合法 binding 构造器补齐
- **覆盖/依据：** AD01/AD02（S3-prepared-context-admission.test.ts:438,451）保留；AD05（:499）行为已不存在：79-1（HANDOFF.md:566）；要改的手写 manifest：tests/helpers 下 B2-execution-fixture.ts:211、C1-mailbox-fixture.ts:142、S1-workflow-archive-fixture.ts:668,1097、S2A-planning-fixture.ts:74、S2A-notices-workspace2-fixture.ts:215、S2B-track-fixture.ts:660、S2C-L-runs-support.ts:136,420、S2C-X-scale-fixture.ts:152、S5-decision-fixture、S5-goal-settings-support、S5-queue-support（2 处）、S5R2-c/d-support、WP1-units-fixture、WP2-duties/notices-fixture，以及 S2C-K-legacy-provenance.test.ts、scenarios/support/S5-decisions.ts、S5-goal-settings.test.ts
- **核实理由：** 这条核心说法成立：AssembledContextV1.binding 是必需字段（context-assembler.ts:123），两个准备入口（execution-preparation.ts:498、query-preparation.ts:332）每次都带它，缺 contextAssembly 的 manifest 只会出现在旧数据和测试手写里。但估计行数太少：约 22 处测试夹具手写的 manifest 没有 contextAssembly（例如 B2-execution-fixture.ts:211-218），改成必需后会编译失败，admission 也会拒绝，每处都要补一个合法 binding。
- **涉及测试：** tests/work-graph/S3-prepared-context-admission.test.ts:499::AD05: an old manifest without contextAssembly authorizes as before and is not migrated; tests/work-graph/S3-prepared-context-admission.test.ts:438,451::AD01/AD02
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：130
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：合法 binding 构造器仍允许手造 accepted manifest/binding，不符合 F1、F3。 改法：删除构造器选项，统一真实 prepare；由 TP-054 吸收实施。

### TP-010 · P2a-13 · old-data · src/contracts/core/prepared-execution.ts:189; state/context-input.ts:213,334-355; tasks/execution-entry-service.ts:451-456,1057-1060; agent-runtime/context-assembler.ts:1908-1916,1949; execution-preparation.ts:478,497,531; queries/query-execution.ts:1070-1076
- **动作：** change: lead rules first (reverses slice-3-SPEC.md:124 T1 and the G-CTX clause at :271); if accepted, remove the manifest field, its codec check (execution-entry-service.ts:451-456), the cross-check (context-input.ts:213,223,329-355), the assembler projection (context-assembler.ts:126,1908-1914,1949,2026), execution-preparation.ts:478,497,531 and the Query [] argument (query-execution.ts:1070-1076); update ~15 helper manifest fixtures (tests/helpers/*: selectedTaskInputs: []), the contextAssemblyProblem call sites (tests/state/context-input.test.ts, tests/runtime/K3-unknown-call-review-section.test.ts, WP1-context-assembly.test.ts:65), K3-35-manifest-trim-pure.test.ts:257,390, K3-35-workspace-baseline-prepare.test.ts:124, S3-prepared-context-admission.test.ts:154,386,397,501 and the OLD_MANIFEST_JSON at tests/runtime/S1-archive-files-brief.test.ts:253; keep TaskInputPageV1.selectedTaskInputs
- **覆盖/依据：** tests/work-graph/S3-prepared-context-admission.test.ts:438 AD01; tests/work-graph/S3-context-inputs.test.ts:670 (page API)
- **核实理由：** 重复是真的：context-assembler.ts:1908-1914 从 inputSelections 重算，context-input.ts:329-355 再核对是否一致。但这是当前写入的格式（execution-preparation.ts:531），由 slice-3-SPEC.md:124 的技术取舍 T1 特意保留，不是旧数据；要删得先由 lead 推翻 T1，而且要改的测试远不止列出的两处。
- **涉及测试：** tests/work-graph/S3-prepared-context-admission.test.ts:386 (fixture, stale); tests/runtime/K3-35-manifest-trim-pure.test.ts:257 (fixture, stale)
- 来源：DSH；核实：partly；规格行：是；估计行数：75
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：lead rules first、if accepted 表明删除决定尚未冻结。 改法：标为 BLOCKED，待 lead 冻结 manifest selectedTaskInputs 删除范围及规格后注；不得连带删除 TaskInputPage 字段。

### TP-011 · P2b-09 · old-data · src/contracts/dispatch.ts:112-116,223
- **动作：** change:删除 ExecutionAuthorizationV1（dispatch.ts:112-116、223）和它的解码（execution-entry-codecs.ts:93、129-149，runExecutionAuthorizationProblem 只认 V2），以及专用分支：run-machine.ts:94、161-167 的 V1 一半、243 的 quarantined、1171-1177、1456-1457、2199-2200，startup-reconcile.ts:199-211、336-339，run-reconcile.ts:264，run-activity.ts:100-105；约 15 处 `'schemaVersion' in auth` 收窄（collaboration-driver、goal-fan-out-driver.ts:364、workflow.ts:1132、create-platform.ts:2146、context-assembler.ts:1471、continuation-brief-assembly.ts:592、execution-driver.ts:614/1038/1056/1303、execution-observation.ts:530、run-reconcile.ts:102/699、runtime.ts:329、mailbox-service.ts:1295、source-capture-access.ts:438）一并简化；无授权的 Claimed 和 D-7 Ended 保留；pre-B2 的“running 但无授权”（run-machine.ts:76-79、167）同属 79-1 旧数据，一起决定
- **覆盖/依据：** V1 历史行为依 docs/refactor/HANDOFF.md:566 退役；要改的测试除 tests/state/run-machine.test.ts:444、tests/work-graph/S2B-r2-r5-not-entered.test.ts:36 外，还有 tests/work-graph/S2B-r2-never-entered.test.ts:23（R5 V1 行）、tests/work-graph/B2-execution-entry.test.ts:205 的 legacy 一半（malformed V2 一半保留）、tests/state/task-failure.test.ts:404 的 authQuarantined、tests/runtime/source-binding-migration.test.ts:144 的 V1 revoked 变体，以及 tests/helpers/S2B-r2-activity-support.ts、S2B-r2-track-support.ts 的 V1 种子；2B-r2 R5 的 V2 未进入证明规则保留
- **核实理由：** 核心成立：唯一写授权的是 run-machine.ts:863-869、959-963 等处，全是 V2，测试注释也写明“no production flow emits them”（S2B-r2-r5-not-entered.test.ts:7-8）；但清单漏了解码器 execution-entry-codecs.ts:129-149、run-machine.ts 里 legacyV1 的 3 处拒绝和 :243 的 quarantined，以及另外 4 个钉住 V1 的测试，40 行偏少。
- **涉及测试：** tests/state/run-machine.test.ts:444::reads V1 and pre-B2 authorizations as legacy history, not damage; tests/work-graph/S2B-r2-r5-not-entered.test.ts:36::2B-r2 R5 a V1 authorization does not prove non-entry
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：90
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：版本收窄清单使用约数并误列 collaboration-driver，无授权 running 范围也未固定。 改法：采用 TP-048、055、060 的明确清单；删除 collaboration-driver 的本主题修改要求；保留 D7 无绑定 Ended。

### TP-012 · P2b-24 · old-data · src/contracts/goal-decisions.ts:50-52
- **动作：** change:随 P2a 删除缺 since 的通知路径，并删 goal-decisions.ts:51 的 legacy 成员（P2b 只计这一行）
- **覆盖/依据：** QA-11 的旧位置排序按 HANDOFF.md:566 退役；NR05 里“损坏的 null origin 读作 unavailable”这一半单独保留；W231 和 legacy 无关，不受影响
- **核实理由：** 当前所有创建记录的写入方都写 since:null 占位并绑定提交游标：mailbox-service.ts:297-299、requeue-service.ts:1110-1116、evidence-service.ts:352/358 和 1701-1702。legacy 位置只在缺 since 时产生，只有两处：automatic-rework-notices.ts:527、decision-read-model.ts:1566。测试里缺 since 的记录靠测试专用的 legacyNoticeWire（tests/helpers/S5-queue-support.ts:287-296）删字段造出来。work-graph 之外只有 goal-decisions.ts:51 这一行，src/ui 没有 legacy 位置。
- **涉及测试：** tests/work-graph/S2A-notices-rework.test.ts:37::QA-11 legacy requeues without since order by occurredAt before the commit-position requeues; tests/work-graph/S5-notices.test.ts:195::NR05; tests/record-store/WP2-notice-cursors.test.ts:61,78::W231
- 来源：Codex；核实：confirmed；规格行：是；估计行数：1

### TP-013 · P1-063 · allowlist-kept-for · src/contracts/human-role-collaboration.ts:73-76
- **动作：** delete
- **覆盖/依据：** 行为已不存在：注里点名的第 3 片已合入，规格里没用到它；第 6、7、8 片和 E3-UI-ITEMS 全文没有 CoordinationPolicy；类型在 src/tests 里零引用
- **核实理由：** CoordinationPolicyPin 只有定义（src/contracts/human-role-collaboration.ts:73-76），src 和 tests 里零引用，角色矩阵用的是 RoleSpecPinV1（同文件 :32）；没有找到计划中的使用方，删 4 行类型加允许清单 1 条（6 行），只删类型，行为不变。另：协调策略在 src 里只有读取（role-memory-service.ts:686），没有写入方，可另按 79-1 看。
- 来源：Codex = DSH；核实：refuted；规格行：是；估计行数：10

### TP-014 · P2b-17 · legacy · src/contracts/ledger.ts:72-86; work-graph/state/goal-machine.ts:82-104,116-131,196,199; app/goal-fan-out-driver.ts:193,354-355,411,475; app/startup-reconcile.ts:441
- **动作：** change: newGoalSnapshot（goal-machine.ts:93-102）写 desiredStateRevision:1、desiredStateRequestedBy:null；删 encodeGoalSnapshot 的旧形状剥离（record-codecs.ts:711-728）、decodeGoalSnapshot 的 ?? 1（:781）和 validateGoalSnapshot 的可缺（:348-351）；ledger.ts:79,85 改必需；删 goal-fan-out-driver.ts:193,354-355,411,475、startup-reconcile.ts:441、goal-machine.ts:196-199,651、plan-service.ts:2170、requeue-service.ts:951 的 ??；改 goal-machine.test.ts:176-185 和 A2-step1-codecs.test.ts:573-585 的旧字节断言
- **覆盖/依据：** —
- **核实理由：** 缺这两个字段确实是当前写法：newGoalSnapshot 故意不写，encodeGoalSnapshot（record-codecs.ts:718-727）还把没改过期望状态的 Goal 剥回 pre-A.2 形状，只为和旧 writer 字节一致，79-1 下可去；但 DSH 漏了编码器剥离、解码默认值、plan-service.ts:2170、requeue-service.ts:951、goal-machine.ts:651 三处读者和钉住旧字节的两个测试。
- **涉及测试：** tests/state/goal-machine.test.ts:176,179
- 来源：DSH；核实：partly；规格行：否；估计行数：40
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：Goal 必填字段修改遗漏当前 Goal 构造方。 改法：由 TP-051 合并实施，覆盖创建事件重建和所有列明构造方，保留当前 Goal 行为断言。

### TP-015 · P2b-14 · old-data · src/contracts/query-job.ts:147-177
- **动作：** change: QueryJobIntentV1.execution 改必需；query-job-service.ts:278-279 和 query-record-codecs.ts:237 缺 execution 即拒；删 agent-runtime/query-execution.ts:187、work-graph/queries/query-execution.ts:900,1213 的缺 execution 拒绝及各读者的 ?. 回退；同时给 6 处不带 execution 提交的测试夹具补 execution：tests/helpers/S5-decision-fixture.ts:789-793、S5-goal-settings-support.ts:513-516、S5R2-c-support.ts:550-553、S5R2-d-support.ts:562-565、tests/scenarios/support/S5-decisions.ts:232-235、tests/work-graph/A2-step1-codecs.test.ts:710-712
- **覆盖/依据：** 当前两个 writer（ui/views/execution/query-flow.ts:96-103、business/workflow/consultation.ts:440-459）都带 execution；缺 execution 的 Job 今天能提交但 claim/start 一律 unsupported
- **核实理由：** 两个 src writer 都写 execution 属实，缺 execution 的 Job 只能经 HTTP queries/submit 存下（query-job-service.ts:278 只在有时检查），之后在 query-execution.ts:187 等处被拒，是没用的兼容入口；但 DSH 写 tests 为空、16 行不全：6 处测试夹具经公开 submit 提交无 execution 的 Job，必须一起改。
- 来源：DSH；核实：partly；规格行：否；估计行数：45
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：execution 必填修改涉及四个白名单外生产读取文件。 改法：补齐范围，删除缺 execution 分支及对应可选读取，保留 consultation 自身的可选语义。

### TP-016 · P1-069 · allowlist-kept-for · src/contracts/role-spec.ts:46
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 不删；决定 6（HANDOFF.md:782）、决定 34（HANDOFF.md:110）；slice-3-SPEC.md:251；测试经 installRoleSpec 造 role_spec 状态（tests/work-graph/R3g-role-spec.test.ts、S3-role-profiles.test.ts、tests/composition/R3d-R3g-platform.test.ts）
- **核实理由：** ROLE_SPEC_REVISION 只在没接线的 installRoleSpec 里用（role-memory-service.ts:321），决定 6、34 没撤销，留得住；但注里写的使用方第 3 片已合入，按 slice-3-SPEC.md:251 只说显式 RoleSpec 走既有 install/activate、没有接线，6/7/8 片和 E3 也没人接（7C 按职责挑人走已接通的 readRoleSpec，slice-7-SPEC.md:166），所以 note 必须改。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：目标 note 没有可保留的测试清单。 改法：使用指定 decision 6/B01 前缀，结尾保留 only reached from RoleConfigurationPort.installRoleSpec。

### TP-017 · P1-070 · allowlist-kept-for · src/contracts/role-spec.ts:154-156
- **动作：** delete
- **覆盖/依据：** 行为已不存在：src 和 tests 里零引用；installRoleSpec 自己内联拼 ref（role-memory-service.ts:332）
- **核实理由：** roleSpecRevisionRefFor（src/contracts/role-spec.ts:154-156）在 src 和 tests 里没有任何调用，没接线的安装路径也是自己在 role-memory-service.ts:332 拼 ref，就算安装链保留也用不上它；删 3 行和允许清单 1 条，行为不变。
- 来源：Codex = DSH；核实：refuted；规格行：是；估计行数：9

### TP-018 · P1-071 · allowlist-kept-for · src/contracts/role-spec.ts:177-190
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 不删；决定 6、34；slice-3-SPEC.md:251；R3g-role-spec、S3-role-profiles、R3d-R3g-platform 经它装 RoleSpec
- **核实理由：** InstallRoleSpecRevisionCommand（role-spec.ts:177-190）是没接线的 installRoleSpec 的入参（model/configuration-contracts.ts、role-memory-service.ts），决定 6、34 支撑留；但注里的第 3 片已合入没接，6/7/8 片和 E3 都没有安装入口，note 要改，同 P1-069。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：目标 note 没有可保留的测试清单。 改法：使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.installRoleSpec。

### TP-019 · P1-072 · allowlist-kept-for · src/contracts/role-spec.ts:191-203
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 不删；决定 6、34；slice-3-SPEC.md:251；R3g-role-spec、R3d-R3g-platform 经它启用 RoleSpec
- **核实理由：** ActivateRoleSpecRevisionCommand（role-spec.ts:191-203）是没接线的 activateRoleSpec 的入参，留的依据是决定 6、34；注里的第 3 片已合入没接，后面各片也没有启用入口，note 要改，同 P1-069。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：目标 note 没有可保留的测试清单。 改法：使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.activateRoleSpec。

### TP-020 · P1-073 · allowlist-kept-for · src/contracts/role-spec.ts:204-216
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 不删；决定 6、34；slice-3-SPEC.md:251
- **核实理由：** InstallRoleSpecRevisionReceipt（role-spec.ts:204-216）只被 installRoleSpec 的接口和实现用（configuration-contracts.ts、role-memory-service.ts），随安装链留；注里的第 3 片已过，note 要改，同 P1-069。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：目标 note 没有可保留的测试清单。 改法：使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.installRoleSpec。

### TP-021 · P1-074 · allowlist-kept-for · src/contracts/role-spec.ts:217-229
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 不删；决定 6、34；slice-3-SPEC.md:251
- **核实理由：** ActivateRoleSpecRevisionReceipt（role-spec.ts:217-229）只被 activateRoleSpec 的接口和实现用，随启用链留；注里的第 3 片已过，note 要改，同 P1-069。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：目标 note 没有可保留的测试清单。 改法：使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.activateRoleSpec。

### TP-022 · P1-075 · allowlist-kept-for · src/contracts/role-spec.ts:230-238
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 不删；决定 6、34；slice-3-SPEC.md:251
- **核实理由：** installRoleSpecRevisionFingerprint（role-spec.ts:230-238）只被 role-memory-service.ts:52 导入、在 installRoleSpec 里用，随安装链留；注里的第 3 片已过，note 要改，同 P1-069。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：目标 note 没有可保留的测试清单。 改法：使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.installRoleSpec。

### TP-023 · P1-076 · allowlist-kept-for · src/contracts/role-spec.ts:239-247
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 不删；决定 6、34；slice-3-SPEC.md:251
- **核实理由：** activateRoleSpecRevisionFingerprint（role-spec.ts:239-247）只被 role-memory-service.ts:52 导入、在 activateRoleSpec 里用，随启用链留；注里的第 3 片已过，note 要改，同 P1-069。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：目标 note 没有可保留的测试清单。 改法：使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.activateRoleSpec。

### TP-024 · P1-077 · allowlist-kept-for · src/contracts/role-spec.ts:248-265
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 不删；决定 6、34；slice-3-SPEC.md:251
- **核实理由：** RoleSpecInstalledEvent（role-spec.ts:248-265）只被 installRoleSpec 和 role-record-codecs.ts 用，随安装链留；注里的第 3 片已过，note 要改，同 P1-069。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：RoleSpecInstalledEvent 的 note 没有可保留的测试清单。 改法：只修改该项 note，使用指定新前缀并保留 only reached from RoleConfigurationPort.installRoleSpec。

### TP-025 · P2b-17 · old-data · src/contracts/verification.ts:199-203,238-239
- **动作：** change:RoundSnapshot.chain 改为必需，codec 要求 chain（evidence-record-codecs.ts:324-325）；删去旧的无槽根解释：roundOrdinalOf 的缺省值（verification-machine.ts:99-102）、heldSlotClaim 的 null 槽主（:1394），以及 :479/:1223/:1370/:1390/:1508 等处的注释；约 15 处 chain?.…?? 默认值可以一并收掉；incompleteCause 继续可选；钉住“两个旧根”的测试由 lead 定删还是改
- **覆盖/依据：** 当前的链和坏链检查（A2-step1-codecs.test.ts:387,416,426）保留；无 chain 的旧行为已不存在：79-1（HANDOFF.md:566）。还要改的测试：A2-step1-codecs.test.ts:380（删）和 :395（legacyRound 换成 rootChain）；verification-machine.test.ts:131 的 OPEN_PENDING 底座要补 chain，:261,292,299,516(VD-1/VD-15),1066,1101,1241 的槽和序号期望跟着改；task-machine.test.ts:144,1350（P10 两个旧根）、task-failure.test.ts:198（GAP-52）、A2-verification-chain.test.ts:170、A2-gate-chain-facts.test.ts:218（P20/GOAL-30）、R3e-reverify.test.ts:467、tests/state/invariants.ts:1890,1949
- **核实理由：** 这条核心说法成立：当前根轮次写 rootRoundChain（verification-machine.ts:920，src 里只有这一处构造根轮次），后继轮次在 :646-665 构造 chain，incompleteCause 在 :1623 确实可以合法缺失。但删除清单很不完整：无 chain 的无槽根还影响 heldSlotClaim（:1394）和 codec（evidence-record-codecs.ts:324-325），verification-machine.test.ts:131 的底座夹具本身就没有 chain，“两个旧根”在多个测试里（其中有 VD-1/VD-15、GAP-52、P10/P20 这些规格行）被当作坏链的来源，所以 6 行和 spec_row:false 都不对。
- **涉及测试：** tests/work-graph/A2-step1-codecs.test.ts:380::a legacy round (no chain, no incompleteCause) still decodes unchanged; tests/work-graph/A2-step1-codecs.test.ts:387::a successor round (ordinal 2, Agent reverify) with incompleteCause and a chain root round-trip
- 来源：Codex = DSH；核实：partly；规格行：否；估计行数：200
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：两个旧根相关测试仍由施工者决定删改，涉及不同当前坏链与槽冲突断言。 改法：该子项标 BLOCKED，lead 逐项冻结 VD-1、VD-15、GAP-52、P10、P20 的当前输入和保留断言；其余明确转换按 TP-045 同批执行。

### TP-026 · P2b-12 · legacy · src/core/agent-runtime/exploration-tools.ts:68-77,113-120,174-177
- **动作：** delete: legacy_live 模式、project_index 工具和 ProjectSourceIndex 类（exploration-tools.ts:6,67-77,113-120,174-177；observed-model-run.ts:79-88,284,327；project-source-index.ts:14-103）及 tests/data/project-source-index.test.ts、project-source-tool.test.ts:144-150,266-285；但 ProjectSourceQuery 类型（project-source-index.ts:8-12）和 ProjectSourceAccess 再导出要移到 project-source-snapshot.ts，改 cpp-source-index.ts:4、python-source-index.ts:5 及 project-source-snapshot/typescript-source-reuse/typescript-source-query 三个测试的类型导入；source-tool-lifecycle.test.ts:226,246 改用 frozen 模式测 Python 索引释放，:308 只换模式不删；工具名表 observed-model-run.ts:177、execution-driver.ts:128、unknown-call-kinds.ts:21 去掉 project_index，并改 K3-34-tool-name-constants.test.ts:65、unknown-call-kinds.test.ts:19；删旧测试前确认其分析器断言（tsconfig include/别名）在 typescript-source-query.test.ts 有覆盖
- **覆盖/依据：** 行为已不存在：生产两处调用 execution-driver.ts:1243、query-execution.ts:542 有读权限必给 frozen；frozen 行为由 project-source-tool.test.ts:154,189,234 覆盖
- **核实理由：** ProjectSourceIndex 在 src 里只在 exploration-tools.ts:115-116 的非 frozen 分支构造，删 legacy_live 后它生产走不到，production-reach 会报错，所以只删模式、保留这个类（Codex 的做法）不成立；但整文件删会断 cpp-source-index.ts:4、python-source-index.ts:5 的 ProjectSourceQuery 类型导入，source-tool-lifecycle.test.ts:308 也只是借 legacy 模式测 search，要改不删。
- **涉及测试：** tests/app/project-source-tool.test.ts:266::publishes one TS project protocol per trusted mode while retaining the full old wire and live stale checks; tests/runtime/source-tool-lifecycle.test.ts:226,246,308::legacy_live 生命周期场景
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：否；估计行数：300
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：类型迁移重复目标已有 ProjectSourceAccess，遗漏动态类型导入、analyzer 覆盖、生命周期断言迁移和旧工具说明。 改法：保留已有 ProjectSourceAccess，仅迁移 ProjectSourceQuery；改两个动态导入；迁移 include、别名、72 文件及跨文件分析断言；用 Python dispose 迁移当前生命周期断言；删除 project_index 说明。

### TP-027 · P2b-05 · legacy · src/core/agent-runtime/kernel-store-locator.ts:14-31,59-72,90-98,106-136
- **动作：** delete（清单补全）：kernel-store-locator.ts 的 LegacyKernelStoreEntry/Location、legacy()、withLegacyReader、legacyEntries 输入和 registerLegacy，byAdapterId 只回当前位置；main.ts:153-158；session-operations.ts:788-795 和 814-816、912-917、1027-1028、1045-1048 和 1062-1064 的 legacy 分支；以下只剩死代码的守卫一起简化：session-operations.ts:635、execution-driver.ts:871 和 1334、runtime.ts:355 和 430、query-execution.ts:313 的 'expectedSessionId' in。测试：删 R4b-session-skeleton.test.ts:54-64、K-W-workflow-close.test.ts:487-522、K-R-close-open-turn.test.ts:142-148；R4c-graph-history.test.ts:281-291 的替身去掉 legacy/withLegacyReader；tests/helpers/K-legacy-reader-support.ts 改成只保留 'absent' 模式（K-W:524 还在用），不能删
- **覆盖/依据：** 旧 locator 依 docs/refactor/HANDOFF.md:566 退役；KA-12 其余三种原因：tests/scenarios/K-W-workflow-close.test.ts:397、:421、:456、:524，tests/composition/K-R-close-open-turn.test.ts:150 起；当前接续：K-W-workflow-close.test.ts:233、:259、:287。slice-K-SPEC.md:107、183、413、436 和 slice-K3-SPEC.md:128、680 里“只有 legacy 读取器”这一条由 lead 加后注
- **核实理由：** 核心成立：当前创建只用 forWorkspace 的当前注册（session-operations.ts:635 拒绝 legacy），legacy 条目只能来自启动文件的 legacyEntries（main.ts:153、create-platform.ts:1032），没有代码生成它。但 Codex 漏了 session-operations.ts:1027、1045-1064 两处分支，runtime.ts、execution-driver.ts、query-execution.ts 里的守卫，以及 K-R-close-open-turn.test.ts:142、R4c-graph-history.test.ts:281 和共用 helper；helper 还被 K-W:524 用，只能改不能删，所以 110 行偏少。
- **涉及测试：** tests/runtime/R4b-session-skeleton.test.ts:54::显式 trusted legacy locator 场景; tests/scenarios/K-W-workflow-close.test.ts:487::KA-12 only a read-only legacy reader is registered
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：170
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：已点名启动与 Query 守卫文件不在白名单，且 TP-074 仍要求合并待删除目标。 改法：补齐两个文件并与 TQ 串行交接；TP-074 由本条删除动作吸收。

### TP-028 · P2b-21 · legacy · src/core/agent-runtime/run-limits.ts:16,31-32,41-48; observed-model-run.ts:24
- **动作：** change: observed-model-run.ts:24 和 run-limits.ts:41 的 taskBudget 改必填，删 run-limits.ts:42,44 的 undefined 判断（保留 deadline===null）；测试里不带 taskBudget 的 runObservedModel 选项构造（AG6-agent-assembly、B1-kernel-assembly、R4c-execution-history、R4c-graph-history、R4c-session-continuity、source-text-loop-migration、source-tool-lifecycle、W2-role-skills、cpp-source-index）补 {tokenBudget:null, deadline:null}；B2-runtime-execution.test.ts:261-263 的缺省断言改成传同值
- **覆盖/依据：** tests/runtime/B2-runtime-execution.test.ts:252-260（有预算的映射）；tests/runtime/R5b-query-session-loop.test.ts:423（null token 加 deadline）
- **核实理由：** 核心属实：两个生产调用点 execution-driver.ts:1220（record.run.budget，dispatch.ts:249 必填）和 query-execution.ts:525（:374 构造）都传 taskBudget，undefined 只来自测试；但“没有测试”不对：B2-runtime-execution.test.ts:261 断言缺省映射，另有 9 个测试文件构造 ObservedModelRunOptions 时不带 taskBudget，改必填要动它们。{tokenBudget:null,deadline:null} 的映射结果和缺省一样（run-limits.ts:42-48），所以行为不变；这不是旧数据，只是给测试方便的可选参数，价值低。
- 来源：DSH；核实：partly；规格行：否；估计行数：16
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：七个需要补 taskBudget 的测试文件不在白名单。 改法：补齐文件，缺省调用显式传 tokenBudget:null、deadline:null，保留映射期望。

### TP-029 · P2b-07 · old-data · src/core/agent-runtime/session-operations.ts:95-97,171-182,214-221,430-432
- **动作：** change:要求当前游标具有合法 l，删除 nullable lower 和旧补值分支，保留 head/range/throughCursor 当前语义
- **覆盖/依据：** 缺下界旧游标依 docs/refactor/HANDOFF.md:566 退役；保留 tests/runtime/R4c-graph-history.test.ts:768、808 的当前范围读取和越界拒绝测试
- **核实理由：** encodeHistoryCursor 的全部调用点（session-operations.ts:362、482、502、512、1003）都传数字 lower，写入 Session.historyCursor 的边界也来自 toHistoryEntry 的游标（execution-observation.ts:757、run-reconcile.ts:400）；缺 l 只在 decode 的 :214、:221 和 :430 的 `?? 1` 里被容忍，测试里没有手造缺 l 的游标（R4c:799 只改 i）。
- **涉及测试：** tests/runtime/R4c-graph-history.test.ts:768::rejects a continuation position below the frozen range instead of reading from the Session head; tests/runtime/R4c-graph-history.test.ts:808::reads one bounded Kernel page from startPosition - 1 up to the frozen throughPosition
- 来源：Codex；核实：confirmed；规格行：否；估计行数：8

### TP-030 · P2b-08 · old-data · src/core/agent-runtime/source-capture-access.ts:257-265,631-726
- **动作：** change:只保留当前 submission 定点读取，移除历史扫描及旧 authority 分支；测试保留原 actor 和执行变化拒绝语义
- **覆盖/依据：** 旧扫描路径依 docs/refactor/HANDOFF.md:566 退役；当前 reader 为 src/core/work-graph/source-authority-reader.ts:98,164；tests/runtime/source-binding-migration.test.ts:221、232 改成带 job.submission 和 readQuerySubmission 的夹具（原 actor、执行变化拒绝保留，“第二条提交冲突”一半随扫描去掉）
- **核实理由：** QueryJob 只由 newPendingQueryRecords 生成，submission 是必填参数（query-run-recovery.ts:464；query-job-service.ts:498、731），后续状态变更用展开保留它（query-run-recovery.ts:562、624）；生产 reader 本来就没有 events 成员（source-authority-reader.ts:21），所以 source-capture-access.ts:667-725 的扫描在生产里只会在 :670 抛错，删掉后行为不变，只有 source-binding-migration.test.ts:190-218 手写缺 submission 的 Job 会走到它。
- **涉及测试：** tests/runtime/source-binding-migration.test.ts:221::resolves Query source authority from the original submission with one shared history scan; tests/runtime/source-binding-migration.test.ts:232::rejects a conflicting original Query submission and changed current execution
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：75
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：保留的 changed current execution 测试仍靠改写事实，真实 Query 准备不能替代该步骤。 改法：将该子场景标 BLOCKED，待 lead 给出触发同一再校验分支的合规公开步骤；不得保留 state.set 或自行删除断言。

### TP-031 · P2a-17 · legacy · src/core/work-graph/communication/mailbox-service.ts:2034;2049-2067;2095;2147
- **动作：** change:先让所有调用方显式发 intent:'inquiry'、needsReply、waitAfterSend，再删 replyMode：工具 schema 和分支（communication-tools.ts:319、:412、:417），mailbox-service.ts:2034、:2049-2067、:2095、:2147，存储字段（state/message-machine.ts:183、:309、:1120、:1202；sessions/message-record-codecs.ts:721、:780；model/tool-commit-arguments.ts:28、:98；model/communication-contracts.ts:150），还有把 `intent===undefined && replyMode==='wait'` 当问询的读取方（app/host.ts:1224、app/collaboration-driver.ts:665、:671、business/workflow/consultation.ts:142、:364、session-maintenance.ts:348、agent-runtime/execution-inputs.ts:128、queries/query-job-service.ts:682、ui/views/execution/panel.ts:36）；同步 resources/skills/platform-work/content.md:24 和它在 runtime-assets 里的 SHA256，约 25 个测试文件（64 处，含 K3-08 规格行 tests/scenarios/K3-08-wait-reply.test.ts），以及 slice-K3-SPEC.md:1417、STATE-MACHINES-SPEC.md:3293 的文字
- **覆盖/依据：** tests/app/orchestration-mechanism.test.ts:169::persists explicit intent/needsReply/waitAfterSend and registers exactly one real wait；tests/app/orchestration-mechanism.test.ts:208::persists and reads back intent/needsReply/waitAfterSend through the real service；tests/app/orchestration-mechanism.test.ts:189::never registers a wait for a plain fire-and-forget notice
- **核实理由：** 核心成立：replyMode=wait 仍是工具可调用的输入（communication-tools.ts:319），也写进记录（message-machine.ts:1202），不能只删读取方。但 mailbox-service.ts:2147 在只给 replyMode 时不写 intent，有 8 个读取方靠 `intent===undefined && replyMode==='wait'` 把这种消息算作问询，调用方改写时必须补 intent:'inquiry'，否则行为会变；技能文本、资源 SHA 和约 25 个测试文件都要跟着改，60 行不够。
- **涉及测试：** tests/app/orchestration-mechanism.test.ts:181::normalizes the legacy replyMode=wait into the same single wait path
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：150
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：replyMode 全链清理缺少可施工文件清单，遗漏多个组外生产文件、测试、技能及资源 hash。 改法：纳入全部列明文件；旧 wait 调用改为 inquiry/true/true；删除字段、codec 与回退，保留 fire-and-forget 行为，同步技能及 SHA256。

### TP-032 · P1-094 · allowlist-kept-for · src/core/work-graph/configuration/role-memory-service.ts:77
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 无冻结片点名：第 3 片已合入且有意不接（slice-3-SPEC.md:251），6/7/8/E3 规格都没有 install/activate；保留依据只剩决定 6（HANDOFF.md:782）、决定 34（HANDOFF.md:110）
- **核实理由：** role-memory-service.ts:77 的 CommittedStoreReceipt 只被 install/activate 的回执重建用（:229、:270），这一点属实；但条目写的使用方“第 3 片”已合入，slice-3-SPEC.md:251 写明沿用既有 install/activate、不加启动自动安装或 HTTP 写口，所以“kept-for 第 3 片”已失效，留不留要跟着 P1-091/092 由用户定。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：目标 note 没有可保留的测试清单。 改法：使用指定新前缀，结尾保留 installRoleSpec、activateRoleSpec 两个入口可达说明。

### TP-033 · P1-095 · allowlist-kept-for · src/core/work-graph/configuration/role-memory-service.ts:83
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 无冻结片点名：第 3 片已合入且有意不接（slice-3-SPEC.md:251），6/7/8/E3 规格都没有 install；保留依据只剩决定 6、34
- **核实理由：** role-memory-service.ts:83 只被 roleInstallIdentityKey（:133）用，最终只到 installRoleSpec（:306）；条目点名的第 3 片已合入、没接线（slice-3-SPEC.md:251），之后的冻结规格都没点名，所以“角色写链”这个理由要换成决定 6/34，并交用户确认。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：目标 note 没有可保留的测试清单。 改法：使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.installRoleSpec。

### TP-034 · P1-096 · allowlist-kept-for · src/core/work-graph/configuration/role-memory-service.ts:84
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 无冻结片点名：第 3 片已合入且有意不接（slice-3-SPEC.md:251），6/7/8/E3 规格都没有 activate；保留依据只剩决定 6、34
- **核实理由：** role-memory-service.ts:84 只被 roleActivateIdentityKey（:136）用，最终只到 activateRoleSpec（:403）；点名的第 3 片已合入、没接线，后面的冻结规格也都没点名，跟着 P1-092 走。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：目标 note 没有可保留的测试清单。 改法：使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.activateRoleSpec。

### TP-035 · P1-097 · allowlist-kept-for · src/core/work-graph/configuration/role-memory-service.ts:91-98
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 无冻结片点名：第 3 片已合入且有意不接（slice-3-SPEC.md:251）；保留依据只剩决定 6、34
- **核实理由：** actorRefEquals（role-memory-service.ts:91-98）只在 install/activate 的重放核对里用（:253、:289）；使用方第 3 片已结束，6/7/8/E3 都没点名 install/activate，和 P1-091/092 同命运。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：目标 note 没有可保留的测试清单。 改法：使用指定新前缀，结尾保留 installRoleSpec、activateRoleSpec 两个入口可达说明。

### TP-036 · P1-098 · allowlist-kept-for · src/core/work-graph/configuration/role-memory-service.ts:132-134
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 无冻结片点名：第 3 片已合入且有意不接（slice-3-SPEC.md:251）；保留依据只剩决定 6、34
- **核实理由：** roleInstallIdentityKey（role-memory-service.ts:132-134）只在 installRoleSpec 里用（:333）；条目写的第 3 片已合入，install 没有生产调用方，也没有后续冻结片点名，跟着 P1-091 定。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：目标 note 没有可保留的测试清单。 改法：使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.installRoleSpec。

### TP-037 · P1-099 · allowlist-kept-for · src/core/work-graph/configuration/role-memory-service.ts:135-137
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 无冻结片点名：第 3 片已合入且有意不接（slice-3-SPEC.md:251）；保留依据只剩决定 6、34
- **核实理由：** roleActivateIdentityKey（role-memory-service.ts:135-137）只在 activateRoleSpec 里用（:424）；使用方第 3 片已结束，后面的冻结规格没点名，跟着 P1-092 定。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：目标 note 没有可保留的测试清单。 改法：使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.activateRoleSpec。

### TP-038 · P1-100 · allowlist-kept-for · src/core/work-graph/configuration/role-memory-service.ts:176-188
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 无冻结片点名：第 3 片已合入且有意不接（slice-3-SPEC.md:251）；保留依据只剩决定 6、34
- **核实理由：** mapInstallStoreFailure（role-memory-service.ts:176-188）只被 installRoleSpec 用（:342、:384）；条目点名的第 3 片已合入且没接 install，理由要改写，跟着 P1-091 定。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：目标 note 没有可保留的测试清单。 改法：使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.installRoleSpec。

### TP-039 · P1-101 · allowlist-kept-for · src/core/work-graph/configuration/role-memory-service.ts:189-201
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 无冻结片点名：第 3 片已合入且有意不接（slice-3-SPEC.md:251）；保留依据只剩决定 6、34
- **核实理由：** mapActivateStoreFailure（role-memory-service.ts:189-201）只被 activateRoleSpec 用（:433、:438、:452、:509）；使用方第 3 片已结束，跟着 P1-092 定。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：目标 note 没有可保留的测试清单。 改法：使用指定新前缀，结尾保留 only reached from RoleConfigurationPort.activateRoleSpec。

### TP-040 · P1-185 · c1-transfer · src/core/work-graph/model/claim-contracts.ts:24,95-107
- **动作：** change:TaskClaimOutbox 改为 DispatchOutboxRecord 的别名（claim-contracts.ts:95-107 → 一行别名，:24 改为导入 DispatchOutboxRecord），必须和 P1-186 同一次提交
- **覆盖/依据：** state/attempt-machine.ts:64-71 中唯一的声明；TaskClaimOutbox 这个名字和 state-writes.test.ts:100-102 的两行保护都保留
- **核实理由：** claim-contracts.ts:95-107 和 attempt-machine.ts:64-71 是同一个形状，只是写了两遍：TaskClaim、DispatchOutboxRef 的来源相同，V1 状态本来就是别名；claim-contracts.ts:24 已经在从 state 导入，不新增依赖方向。state-writes.test.ts:620-631 对类型别名照样能找到声明和字段，保护也不变。C1 G5 做过同样的改动，合并全量只因为 TaskDispatchStateV1 失去生产用处才失败（c1-lead-rulings.md:33），所以必须和 P1-186 一起落地。只改类型，测试不改。
- **涉及测试：** tests/runtime/R4c-graph-history.test.ts:32; tests/runtime/S3-context-assembler.test.ts:49; tests/state/attempt-machine.test.ts:37,705-710; tests/state/invariants.test.ts:48; tests/state/invariants.ts:92; tests/work-graph/R4c-execution-history-index.test.ts:29; tests/architecture/state-writes.test.ts:100-102
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：0

### TP-041 · P2a-18 · c1-transfer · src/core/work-graph/model/claim-contracts.ts:92-107
- **动作：** change:TaskClaimOutbox 改成 DispatchOutboxRecord 的别名（model/claim-contracts.ts:95-107），删 TaskDispatchStateV1（claim-contracts.ts:92）和它的再导出（persistence/execution-entry-codecs.ts:9、:39、:45）；tests/state/attempt-machine.test.ts:37、:708-709、:711-712 去掉 TaskDispatchStateV1 那几行（别名之后整条测试也可删）；保留真实 DispatchStateV1
- **覆盖/依据：** tests/state/attempt-machine.test.ts:705::DispatchOutboxRecord is the TaskClaimOutbox record of claim-contracts.ts（改后）；src/core/work-graph/state/attempt-machine.ts:327-353 当前 V1/V2 dispatch 写入不变
- **核实理由：** claim-contracts.ts:95-107 和 attempt-machine.ts:63-70 是同一个形状写了两遍；TaskDispatchStateV1（:92）在生产代码里只用在 :105 和 execution-entry-codecs.ts:39/:45 的再导出，另外只有 tests/state/attempt-machine.test.ts:37、:708-709 在用。C1 lead-acceptance.md:86 裁定 12 和 :94 把它交给 T；claim-contracts.ts:24 本来就从 attempt-machine 导入，不会出现循环依赖。
- **涉及测试：** tests/state/attempt-machine.test.ts:705-711::DispatchOutboxRecord is the TaskClaimOutbox record of claim-contracts.ts
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：20
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：整条测试可删与 TP-003 的 outbox 断言保留要求冲突。 改法：删除整条测试可删的选项，由 TP-003、040 同批吸收。

### TP-042 · P1-091 · allowlist-kept-for · src/core/work-graph/model/configuration-contracts.ts:16
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 无冻结片点名：第 3 片已合入且有意不接（slice-3-SPEC.md:251），slice-6/7/8-SPEC 和 E3-UI-ITEMS 里没有 installRoleSpec；保留依据：决定 6（HANDOFF.md:782）、决定 34（HANDOFF.md:110）、MVP-BEHAVIOR.md:90
- **核实理由：** installRoleSpec 只在 create-platform.ts:1304 发布，没有路由或 Workflow 调用；条目写的使用方第 3 片已合入，slice-3-SPEC.md:251 写明不加启动自动安装或 HTTP 写口，后面的冻结规格也都没点名，所以 Codex 写的“决定34”这条理由不完整。不过决定 6、34 没有撤销，它又是 readRoleSpec（session-duty.ts:67、message-duties-adapter.ts:116）和 resolveRoleBindingFacts（claim-service.ts:1189 等）所读 RoleSpec 事实唯一的正式写入口，删掉它，测试就得改回手写种子，所以交用户定。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1

### TP-043 · P1-092 · allowlist-kept-for · src/core/work-graph/model/configuration-contracts.ts:19
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。
- **覆盖/依据：** 无冻结片点名：第 3 片已合入且有意不接（slice-3-SPEC.md:251），slice-6/7/8-SPEC 和 E3-UI-ITEMS 里没有 activateRoleSpec；保留依据：决定 6（HANDOFF.md:782）、决定 34（HANDOFF.md:110）、MVP-BEHAVIOR.md:90
- **核实理由：** activateRoleSpec 只在 create-platform.ts:1306 发布，没有生产调用方；点名的第 3 片已结束、没接它，后面的冻结规格也没有。它和 install 一起写出 resolveRoleBindingFacts 所读的 active 指针，是决定 6/34 保留的角色规格的一部分，删不删要和 P1-091 一起交用户。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1

### TP-044 · P1-093 · allowlist-kept-for · src/core/work-graph/model/configuration-contracts.ts:27-28
- **动作：** change（lead 裁定：保留）：代码不动；production-reach-allowlist.json 里这一条的 note 去掉“kept for slice 3”，改写为：role specs are kept unwired by decision 6 (HANDOFF: kept for picking members by meaning); MVP-BEHAVIOR.md B01 lists the formal Role writer; unwired today; used only by tests: <keep the entry's existing test list>。另外在这一条的测试清单里补上漏列的测试 tests/helpers/S1-runtime-scenario-fixture.ts:194、tests/helpers/S2B-runtime-store-fixture.ts:173。
- **覆盖/依据：** 无冻结片点名：第 3 片已合入（slice-3-SPEC.md:251），6/7/8/E3 里没有 resolveRoleBinding；实际在用的是内部的 resolveRoleBindingFacts（execution-preparation.ts:352、claim-service.ts:1189 等）
- **核实理由：** 公开的 resolveRoleBinding（role-memory-service.ts:783-788）只是把生产在用的 resolveRoleBindingFacts 包一层（:787），只有测试调；点名的第 3 片已结束，7C 的 L15 挑执行者（slice-7-SPEC.md:166）也没点名它，所以“决定34”这条理由不够。另外条目的测试清单漏了 S1、S2B 两个夹具，删它会改 5 个测试文件。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1

### TP-045 · P2a-09 · old-data · src/core/work-graph/persistence/evidence-record-codecs.ts:324-326
- **动作：** change:解码时 VerificationRound 必须带 chain（evidence-record-codecs.ts:324-326）；合同 RoundSnapshot.chain 改成必填（src/contracts/verification.ts:239）；删掉机器里把无 slot 的旧根当根的路径：heldSlotClaim 的 null owner（verification-machine.ts:1388-1396）和 roundOrdinalOf 的兜底（:100-102）；各处 chain?.x ?? 默认值的兜底按需收掉。保留合法的缺 incompleteCause。测试：删 A2-step1-codecs.test.ts:380-385 和 legacyRound 辅助；verification-machine.test.ts 的 OPEN_PENDING 基础夹具（:131-134）补上 rootRoundChain()，同步改 :263 的辅助、:436-444、:516-523、:1101-1108 里“旧根”的断言；手写的无 chain 轮次夹具补上 chain（S3-graph-context.test.ts:390-401、S2B-task-timeline-fixture.ts:662-668）
- **覆盖/依据：** tests/work-graph/A2-step1-codecs.test.ts::a successor round (ordinal 2, Agent reverify) with incompleteCause and a chain root round-trip；tests/state/verification-machine.test.ts::buildOpenedRound writes the open@1 byte for byte with the chain root last (C5)；tests/work-graph/S5-notices.test.ts::NR07；行为已不存在：HANDOFF 79-1
- **核实理由：** 核心属实：只有 buildOpenedRound 写根轮次，它总带 rootRoundChain()（verification-machine.ts:110-112,911-919）；后继轮次自己带 chain。但缺 chain 的旧根不只在 codec 里：合同 verification.ts:239 是可选的，verification-machine.ts:1394 还给它留了无 slot 的路径；verification-machine.test.ts:131 的 OPEN_PENDING 是一个整个文件都在用的无 chain 夹具，S3-graph-context.test.ts:390-401 也直接存了无 chain 的轮次。所以 60 行估少了，清单也不全。
- **涉及测试：** tests/work-graph/A2-step1-codecs.test.ts:380-384::a legacy round (no chain, no incompleteCause) still decodes unchanged; tests/state/verification-machine.test.ts:1101,1111::legacy root 部分
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：90
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：删除 legacyRound 会破坏保留的 lookup 场景，chain 迁移还遗漏组外文件。 改法：将 helper 改为当前 rootChain，保留缺 incompleteCause 和 lookup 断言；只删无 chain 兼容测试；补齐迁移范围。

### TP-046 · P2a-10 · old-data · src/core/work-graph/persistence/evidence-record-codecs.ts:436
- **动作：** change:存储的 TaskEvidenceIndex 要求 revision ≥ 1（evidence-record-codecs.ts:436 改成 isSafeInteger(revision, 1)）；删掉 A2-verification-chain.test.ts:284-296 修复 @0 那段并改测试名，删掉 tests/state/verification-machine.test.ts:852-854 的 @0 断言；verification-machine.ts:1036,1049-1053 的注释同步改。保留 exists、缺记录时的 CAS null 和零追加不写
- **覆盖/依据：** tests/work-graph/A2-verification-chain.test.ts::VR-10..12 的零证据不写那部分；tests/state/verification-machine.test.ts::nextTaskEvidenceIndex: CAS by row existence (VR-10/11), nothing written for zero ids (VR-12) 的 VR-10/@n+k/VR-12 部分；行为已不存在：HANDOFF 79-1
- **核实理由：** 核心属实：唯一的写入点 evidence-service.ts:371 只写 nextTaskEvidenceIndex 给出的记录，追加为零时不写（verification-machine.ts:1056），所以写出的 revision 不会是 0；codec 在 :436 仍接受 @0。漏了一条测试：纯函数测试 verification-machine.test.ts:852-854 也固定了旧 @0 的修复，5 行估少了。
- **涉及测试：** tests/work-graph/A2-verification-chain.test.ts:269::VR-10..12: no index row for zero evidence, a legacy @0 row repaired
- 来源：Codex；核实：partly；规格行：是；估计行数：20
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：删除 284–296 会丢失当前证据追加断言，与 TP-141 冲突。 改法：仅删 @0 seed，保留 gateIndexRef 和 288–296，从不存在的 index 开始验证追加。

### TP-047 · P2a-17 · old-data · src/core/work-graph/persistence/evidence-record-codecs.ts:55, 96, 117-125, 485, 782; state/verification-machine.ts:94-95
- **动作：** delete: EVIDENCE_ADMITTED_EVENT_TYPE (evidence-record-codecs.ts:55), its union member (:96), its VERIFICATION_ROUND_EVENT_TYPES entry (:122; the registry at :782 derives from it), the machine type member and comment (verification-machine.ts:94-95) and the header note (:4-5); keep EvidenceSnapshot (still written at evidence-service.ts:368)
- **覆盖/依据：** 行为已不存在：decision 34 删了 submitEvidence (VR-08)；没有测试固定它
- **核实理由：** src 和 tests 里 EvidenceAdmitted 只剩这几处声明和登记，没有编码或提交，注释自己也写着"只为旧记录还能解码"（verification-machine.ts:94）。但只有大约 6 行要改，不是 25 行；:485 和 :782 是通用解码和登记，不用动。
- 来源：DSH；核实：partly；规格行：是；估计行数：6

### TP-048 · P2a-03 · old-data · src/core/work-graph/persistence/execution-entry-codecs.ts:129-149
- **动作：** delete：codec 删 execution-entry-codecs.ts:93 的 V1_PHASES、129-139 的 V1 校验和 :149 的回落（undefined 读作 null 要保留，没有 schemaVersion 的对象改为拒绝），连同头注释 :5-8、:16-18；run-machine.ts 删 legacyV1 字段 :75-81、:157、:167，删 :1456-1458、:2199-2201 的专属拒绝，:1177 的原因固定为 'illegal'，删 :243 只有 V1 才有的 'quarantined' 判断；contracts/dispatch.ts:112-116 和 :223 的联合类型去掉 V1。测试除所列外还有：tests/state/run-machine.test.ts:594-595、638-640、721-722、755、801-802、818-822、979 和 1012-1016 里的 v1/preB2 用例、1401-1411、1651-1652、1714-1715；tests/state/task-failure.test.ts:404；tests/runtime/source-binding-migration.test.ts:144（改成 V2 revoked）；tests/work-graph/S2B-r2-never-entered.test.ts:22-36 和 S2B-r2-r5-not-entered.test.ts:36-50 两个 R5 的 V1 用例。保留 B2:214-219 的 malformed V2 和 run-machine.test.ts:451-452 的 D7 无绑定 Ended。
- **覆盖/依据：** tests/work-graph/B2-execution-entry.test.ts:156::fresh begin and replay are distinct…；:117::SQLite identical authorization race…；tests/state/run-machine.test.ts 的 V2 各行；旧格式由 HANDOFF 79-1 撤销
- **核实理由：** 核心属实：Run 授权只由 run-machine.ts:861-869 写 V2，running 只由 enteredRunRecord（:883-887）带着 V2 写入；V1 授权和没有授权的 running Run 只出现在手写夹具里（B2:207-210 用 commitRaw）。但清单漏了十多处直接构造 V1 授权的测试，也漏了只有 V1 才有的 quarantined 判断（run-machine.ts:243），60 行偏低。
- **涉及测试：** tests/work-graph/B2-execution-entry.test.ts:205-213::does not allow a legacy authorization to begin; malformed V2 is rejected by the real Run codec; tests/state/run-machine.test.ts:444-452,1012,1409::旧授权部分
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：150
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：遗漏外部 V1 类型使用，保留的 malformed V2 仍依赖 legacy 变量。 改法：清理两个外部 V1 类型路径；malformed V2 使用当前 V2 前置状态，保留拒绝断言和 D7 Ended。

### TP-049 · P2a-01 · old-data · src/core/work-graph/persistence/plan-record-codecs.ts:804-818;1005-1020
- **动作：** delete：除所列外，还要删 state/plan-machine.ts:1250-1251、1284-1293（legacyAdoptionDetail）、1623-1625、1709-1711 的 legacy_v1 分支，model/plan-contracts.ts:33 的 LegacyPlanProposal 导出，plan-record-codecs.ts:6-10 头注释；测试另删 tests/state/plan-machine.test.ts:113-115 的 LEGACY 夹具、:335 STATES 项和 :379-388 legacy_v1 表行，tests/architecture/state-writes.test.ts:146-147 的 LegacyPlanProposal 条目。contracts/goal-change.ts:141 的 PlanProposalSnapshot 仍被 contracts/ledger.ts:45 的 AggregateRef 引用其 ref，删前要把那里改成直接写 ref 类型。
- **覆盖/依据：** tests/work-graph/S5-request-candidates.test.ts:58::RC01；:146::RC04；:175::RC05；tests/state/plan-machine.test.ts 的 candidate_v2 各表行；旧格式由 HANDOFF 79-1（docs/refactor/HANDOFF.md:565-570）撤销
- **核实理由：** 属实：唯一写入口 encodePlanProposal（plan-record-codecs.ts:1072-1079）只序列化当前 PlanProposal，构造器 plan-machine.ts:132-135 只产 candidate_v2，src 里没有写 PlanProposal@1 的地方，只有 RC11 用 commitRaw 手写（S5-request-candidates.test.ts:308）。但删除清单漏了 plan-machine.ts 状态机里的三处 legacy_v1 分支、plan-machine.test 的 legacy_v1 表行和 state-writes 允许项，行数偏低。
- **涉及测试：** tests/work-graph/S5-request-candidates.test.ts:305-341::RC11
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：130
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：LegacyPlanProposal 转出文件遗漏白名单。 改法：将 model/plan-contracts.ts 纳入范围并随类型、codec、状态机分支同批清理。

### TP-050 · P2a-02 · legacy · src/core/work-graph/persistence/plan-record-codecs.ts:518-522;569-583
- **动作：** change：公开入口（plan-service proposePlan、ReviewPlan 的 draft（app/core-http-types.ts:730-735）、提案工具）只收 schemaVersion 2；contracts/plan.ts:222-227 和 PlanRevisionSnapshot 去掉 v1；删 plan-record-codecs.ts:522 的“1 或 2”和 569-582 的 v1 分支、plan-commit-compiler.ts:157-162 的 v1 回落、plan-machine.ts:1049-1050 与 1401-1404 的 v1 拒绝（连同 tests/state/plan-machine.test.ts:534、683、686 三行）；各处 `plan.schemaVersion === 2 ? … : []`（约 12 处，如 plan-validation.ts:307,310、context-input-service.ts:364）随之简化。测试侧：W2:140-164 全用 v2 草稿，不用改；要改的是约 25 个手写 schemaVersion: 1 草稿的夹具和测试（如 tests/helpers/task-claim-fixture.ts:280、S1-workflow-archive-fixture.ts:367,595、B2-execution-fixture.ts:138、S5-decision-fixture.ts:396、R3c-plan-adoption.test.ts:81、R3c-plan-entry.test.ts:63）改成 2，以及 W2:116-132 里以 v1 夹具为底的部分。
- **覆盖/依据：** tests/work-graph/W2-future-intent.test.ts:116-129 的 v2 部分；:198::initial required plan_only saves…；:350::future refinement preserves the real source…
- **核实理由：** 核心属实：编译器按草稿版本写 v1（plan-commit-compiler.ts:157-162），codec 接受 1 和 2（plan-record-codecs.ts:522）；但生产里没有产生 v1 草稿的地方：initial-plan.ts:61,77 只收 v2，Agent 提案必须是 v2（plan-machine.ts:1049），计划变更必须是 v2（:1401）。所引 W2:140-164 的 legacyFullDraft 返回 v2（W2:72-81），“只删 v1 采用部分”不成立；真正的波及是约 25 个夹具用 v1 草稿走公开 proposePlan，60 行明显偏低。
- **涉及测试：** tests/work-graph/W2-future-intent.test.ts:140-164::legacy full v1/v2 without executionIntent still adopts; empty/optional-only legacy shapes are rejected
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：150
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：V1 迁移遗漏快照与组外构造方，并与 TP-132 保留 V1 草稿冲突。 改法：当前草稿和快照统一迁至 V2；补当前快照字段，保留 V2 边界断言；吸收 TP-132 的版本部分，撤掉保留 V1 草稿指令。

### TP-051 · P2a-06 · old-data · src/core/work-graph/persistence/record-codecs.ts:718-727;779-783;850-862
- **动作：** change：newGoalSnapshot（state/goal-machine.ts:91-100）和 goalSnapshotFromCreatedEvent（record-codecs.ts:850-862）显式写 desiredStateRevision: 1、desiredStateRequestedBy: null，encodeGoalSnapshot（:718-727）原样序列化；goalSnapshotProblem（:348-358）和 contracts/ledger.ts:79-85 改成必填，解码器 :781-783 去掉默认值；app/goal-fan-out-driver.ts:193、354-355、411、475，app/startup-reconcile.ts:441，goal-machine.ts:199 的 `?? 1` 可以一起去掉；删 A2 的两条测试。
- **覆盖/依据：** tests/work-graph/A2-step1-codecs.test.ts:564-572::round-trips the three desired states with and without a requester；旧字节保持要求由 HANDOFF 79-1 撤销
- **核实理由：** 属实：创建写入端 goal-machine.ts:91-100 不带这两个字段，encodeGoalSnapshot（record-codecs.ts:718-727）对没改过的 Goal 主动剥掉，事件重建（:850-862）也不带，解码器（:781-783）补 1/null。所以这是当前写法，必须先改写入端再删默认值。改了只影响存储字节，读出的值不变，因为解码后本来就是 1/null。
- **涉及测试：** tests/work-graph/A2-step1-codecs.test.ts:557-561::decodes a record written before A.2 as desiredStateRevision 1 and desiredStateRequestedBy null; tests/work-graph/A2-step1-codecs.test.ts:573-579::writes a never-changed Goal in its legacy shape, so a plan adoption keeps the pre-A.2 bytes
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：45
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：Goal 必填字段迁移遗漏十个组外构造文件。 改法：吸收 TP-014；创建器、事件重建、codec 和构造方同批迁移；纯初始输入写 1/null，平台前置用真实 createGoal。

### TP-052 · P2a-13 · old-data · src/core/work-graph/queries/query-record-codecs.ts:447-450
- **动作：** change:QueryJobSnapshot.submission 改为必填（contracts/query-job.ts:344-345），codec query-record-codecs.ts:447-450 缺 submission 判 invalid，并改 :464、:522 的旧行注释；删 query-execution.ts:336、source-authority-reader.ts:200-202、views/graph-context-reader.ts:580-582、tasks/request-facts-reader.ts:65-67 的缺 locator 分支，去掉 agent-runtime/source-capture-access.ts:646 的 `job.submission !== undefined` 条件；tests/work-graph/A2-step1-codecs.test.ts:709 的 SD-4 夹具补 submission
- **覆盖/依据：** tests/work-graph/R5b-query-job.test.ts:137-170::records QueryJob@1 + QueryRun@1 pending, locates the original actor, and replays the same receipt；tests/work-graph/A2-step1-codecs.test.ts:703::reads not_entered on QueryRun outcome and QueryJob closeReason (SD-4)（补 submission 后）
- **核实理由：** 核心成立：两个写入点都经 state/query-run-recovery.ts:459-495 newPendingQueryRecords 写 submission（query-job-service.ts:729-731、:496-498），其他快照都是展开旧快照。但缺 locator 的分支不止 query-execution.ts:336，还有 source-authority-reader.ts:200、graph-context-reader.ts:580、request-facts-reader.ts:67、source-capture-access.ts:646；类型 contracts/query-job.ts:345 是可选；A2-step1-codecs.test.ts:709 的夹具没有 submission，改必填后要补。
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：20
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：三个已点名的 submission 读取文件不在白名单。 改法：补齐文件并与 TP-030 同批，删除缺 locator 回退，保留精确读取失败语义。

### TP-053 · P2a-23 · legacy · src/core/work-graph/sessions/session-directory.ts:706-735
- **动作：** change: always fingerprint the normalized createdProvenance (session-directory.ts:732); keep the missing key = 'new' default and the explicit-null refusal; rewrite the comments at session-directory.ts:704-713 and agent-runtime/session-operations.ts:600-601
- **覆盖/依据：** tests/work-graph/R4b-session-directory.test.ts:146 (current create/replay); tests/work-graph/S1-codecs-indexes.test.ts:485 SV05
- **核实理由：** 单独的兼容指纹（session-directory.ts:732）只是为旧的回执，按 79-1 可以去掉，改了也只影响指纹本身。但"已经没有这种调用方"不对：session-operations.ts:602、workflow.ts:201/1335 和 HTTP sessions/create 现在都会省略 provenance，省略仍然表示 new，所以只能改指纹，不能把 provenance 改成必填。
- 来源：DSH；核实：partly；规格行：是；估计行数：6

### TP-054 · P2a-16 · old-data · src/core/work-graph/state/context-input.ts:225;374;381-383
- **动作：** change:分两步。(1) 去掉 contextGoalContentProblem 的 null digest 容忍（state/context-input.ts:381-383），删 GE03（WP1-goal-content-entry.test.ts:79）和 CG04 中 null digest 那段（tests/state/WP1-goal-content.test.ts:111-113）；(2) contextAssembly 改必填（contracts/core/prepared-execution.ts:205、:271；context-input.ts:225、:374；tasks/execution-entry-service.ts:1064、:1129；queries/query-execution.ts:1079；agent-runtime/execution-preparation.ts:520-521；query-preparation.ts:359），删 AD05（S3-prepared-context-admission.test.ts:499）、ST01（tests/state/context-input.test.ts:99）、CG04 中缺 binding 那段，并把约 19 个手写 task/query manifest 的测试夹具（如 tests/helpers/B2-execution-fixture.ts:211、C1-mailbox-fixture.ts:143、S5-queue-support.ts:359、S2B-track-fixture.ts）改成走真实 prepare 或共用一个合法 binding 构造器；Query 不套 Work Goal 条件，rebinding 照旧
- **覆盖/依据：** 行为已不存在：docs/refactor/HANDOFF.md:565-566（79-1）；tests/work-graph/S3-prepared-context-admission.test.ts:438::AD01；tests/work-graph/S3-prepared-context-admission.test.ts:531::AD07；tests/work-graph/WP1-goal-content-entry.test.ts:55::GE01；tests/work-graph/WP1-goal-content-entry.test.ts:63::GE02；tests/work-graph/WP1-goal-content-entry.test.ts:99::GE05
- **核实理由：** 核心成立：assembler 的 binding 不可选（context-assembler.ts:123），Task/Query 的 prepare 都写 contextAssembly（execution-preparation.ts:497、query-preparation.ts:332），Work 的 Goal 源 digest 由 context-assembler.ts:1919-1923 换成字符串。但约 19 个测试夹具（B2-execution-fixture.ts:211-218 等）手写了不带 contextAssembly 的 manifest，再经 authorizeRuntimeEntry 授权，改必填后都会被拒；ST01 和两处类型也漏了，25 行远远不够。
- **涉及测试：** tests/work-graph/S3-prepared-context-admission.test.ts:499-508::AD05; tests/work-graph/WP1-goal-content-entry.test.ts:79-85::GE03; tests/state/WP1-goal-content.test.ts:107-117::CG04，仅缺 binding/null digest 部分
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：150
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：允许手造 binding，且遗漏七个 manifest 构造文件及 Query 执行文件。 改法：吸收 TP-009，统一真实 Task/Query prepare；共享 helper 不接收 prepared/binding；补齐全部构造方。

### TP-055 · P2a-09 · old-data · src/core/work-graph/state/run-machine.ts:242-244
- **动作：** change: delete the 'quarantined' alternative at run-machine.ts:243 in the same change as P2a-06 (once V1 leaves the union the comparison no longer type-checks); drop the V1 quarantined assertions at tests/state/run-machine.test.ts:1714-1715 and tests/state/task-failure.test.ts:404,414
- **覆盖/依据：** tests/state/run-machine.test.ts:1712 (V2 unknown); tests/state/task-failure.test.ts FC-2 authUnknown case
- **核实理由：** 'quarantined' 只在 ExecutionAuthorizationV1.phase（contracts/dispatch.ts:115）里有，V2 的 phase（dispatch.ts:131）没有；src 里没有任何代码写 V1 授权（executionAuthorization 只在 run-machine.ts:869-1003 写，都是 V2）。
- **涉及测试：** tests/state/run-machine.test.ts:1714 (stale); tests/state/task-failure.test.ts:404 (stale)
- 来源：DSH；核实：confirmed；规格行：是；估计行数：5
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：同批依赖指错 Goal 条目，删除行号 414 实为当前无 outcome 断言。 改法：依赖改 TP-011、048；删除 task-failure 第 404、412 行，保留第 413–414 行。

### TP-056 · P1-180 · allowlist-kept-for · src/core/work-graph/state/unknown-call-kinds.ts:44-46
- **动作：** change:src/core/agent-runtime/observed-model-run.ts:303 的 allowed.map(tool => tool === 'write' ? 'edit' : tool) 改为 allowed.map(kernelToolNameOf)（从 ../work-graph/state/unknown-call-kinds.js 导入），删白名单 1078-1083 这一条
- **覆盖/依据：** tests/runtime/K3-34-tool-name-constants.test.ts:50-52、61；tests/state/unknown-call-kinds.test.ts:68-72
- **核实理由：** observed-model-run.ts:303 内联了和 unknown-call-kinds.ts:44-46 相同的 write→edit 映射，K3 L3 要求只有一个固定映射（slice-K3-SPEC.md:173、1477）。agent-runtime 已经从同一文件导入（run-reconcile.ts:53、unknown-call-draft.ts:20），改调用不改行为。
- **涉及测试：** tests/runtime/K3-34-tool-name-constants.test.ts:22,50-52,61; tests/state/unknown-call-kinds.test.ts:14,68-72
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：0

### TP-057 · P1-181 · allowlist-kept-for · src/core/work-graph/state/unknown-call-review.ts:35-39
- **动作：** delete：删 src/core/work-graph/state/unknown-call-review.ts:36-37（注释和 UNKNOWN_CALL_REVIEW_RESERVED_BYTES），同时删 tests/architecture/production-reach-allowlist.json:1084-1089 那一条（否则 production-reach.test.ts:105 报“gone”）；UNKNOWN_CALL_REVIEW_CREATION_BUDGET_BYTES 仍写字面量 158_720
- **覆盖/依据：** K3-48 由 UNKNOWN_CALL_REVIEW_CREATION_BUDGET_BYTES 覆盖（state/unknown-call-review.ts:177/180/202/231；tests/runtime/K3-48-3-extremes-pure.test.ts:195 断言 158_720）；R 只是规格算式
- **核实理由：** 全仓 grep 只有声明 unknown-call-review.ts:37 和白名单 :1086 两处，白名单写的使用方“K3 group 3”已合入但没用它，slice-6/7/8 和 E3 里也没有后续使用方，按 kept-for 规则应删。Codex 改成 MAX−RESERVED−32 虽然数值不变（524,288−365,536−32=158,720），但 32 是规格算错的差额（slice-K3-SPEC.md:263 vs :1856 记作额外余量），硬写进算式只为让常量有人用，属顺手重构，不如照规格保留字面量 B。
- 来源：冲突裁定（采用 dsh）；核实：confirmed；规格行：是；估计行数：8

### TP-058 · P1-182 · allowlist-kept-for · src/core/work-graph/state/unknown-call-review.ts:129
- **动作：** delete
- **覆盖/依据：** 测试改用 UnknownCallReviewEventV1（tests/state/unknown-call-review.test.ts:30、157；tests/work-graph/K3-45-review-incomplete.test.ts:20、114），删白名单 1090-1095 这一条；状态机行为不变
- **核实理由：** unknown-call-review.ts:129 只是 UnknownCallReviewEventV1（:98）的同义别名，生产没有引用（:268 是字符串标签），规格里也没有这个名字；引用只有两个测试文件的四处。
- **涉及测试：** tests/state/unknown-call-review.test.ts:30,157; tests/work-graph/K3-45-review-incomplete.test.ts:20,114
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：4
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：两个已点名的外部别名使用文件不在 TP 白名单。 改法：四处改用 UnknownCallReviewEventV1，保留状态机断言，并与 T1 串行交接。

### TP-059 · P2a-20 · old-data · src/core/work-graph/tasks/claim-record-codecs.ts:241-251
- **动作：** change:claim-record-codecs.ts:250-251 改成 status 为 ended 时 endOutcome 必须是 RunOutcome（claimed/started 仍允许 null）；删掉 attempt-machine.ts:74-77 注释里的旧 null 说法（那里引的 :236-245 行号也已经过时）；删掉 tests/state/attempt-machine.test.ts:699-700 那条断言。attemptNodeOf 在 :88 的代码不用动。
- **覆盖/依据：** 旧格式支持由 docs/refactor/HANDOFF.md:565-570 撤销；tests/state/attempt-machine.test.ts:568-577::ends with every known outcome and records it on the Attempt；tests/state/attempt-machine.test.ts:697-698（当前已知/未知结束的投影）
- **核实理由：** 解码器 claim-record-codecs.ts:250 对任何状态都接受 endOutcome:null，缺字段反而被拒，所以说“缺 endOutcome”的注释（attempt-machine.ts:75-77）不准。写 ended 的只有 attempt-machine.ts:310-311、:318-321，参数类型都是非空的 RunOutcome，:699-700 也只写非空结果；src 里没有任何代码读 ended 加 null，tests 里也没有手写 ended 加 null 的记录（null 只出现在 claimed 的夹具里）。所以“ended 时 null 读成 ended_known”只有 attempt-machine.test.ts:700 这一条断言在用。
- **涉及测试：** tests/state/attempt-machine.test.ts:696-700::project the nodes of §5.1，仅 ended/null 断言
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：6

### TP-060 · P2a-10 · legacy · src/core/work-graph/tasks/execution-entry-service.ts:788-793; state/review-lease.ts:48-51; communication/mailbox-service.ts:1295-1297,1355-1357,2788-2790; state/run-machine.ts:94-95
- **动作：** change: in the same change as P2a-06, narrow on auth === undefined at the 6 in-area sites (execution-entry-service.ts:791, review-lease.ts:49, mailbox-service.ts:1295,1355,2790, run-machine.ts:95 — the last overlaps P2a-08) and the 16 out-of-area sites (app/goal-fan-out-driver.ts:364; app/startup-reconcile.ts:209 plus its dead 'legacy' row at :336-339; business/workflow/workflow.ts:1132; composition/create-platform.ts:2146; contracts/run-activity.ts:100; agent-runtime context-assembler.ts:1471, continuation-brief-assembly.ts:592, execution-driver.ts:614,1038,1056,1303, execution-observation.ts:530, run-reconcile.ts:102,264,699, runtime.ts:329)
- **覆盖/依据：** tests/state/review-lease.test.ts:72 (K3-36 V2 cases); tests/work-graph/C2-mailbox-admission.test.ts (V2 paths)
- **核实理由：** 这些收窄确实只是为了排除 V1，删掉 V1 后都多余；但区域内是 6 处不是 5 处，区域外是 16 处不是 13 处，而且 startup-reconcile.ts:209/336-339 是一整条 'legacy' 上报分支，不是一行收窄。删 V1 之后原写法仍能编译，所以这是顺带清理，不是必须。
- **涉及测试：** tests/state/review-lease.test.ts:72; tests/work-graph/C2-mailbox-admission.test.ts
- 来源：DSH；核实：partly；规格行：是；估计行数：28
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：同批依赖 P2a-06 指向 Goal 字段而非授权 V1。 改法：依赖改为 TP-011、048，列明的全部收窄随 V1 退出同批清理。

### TP-061 · P2a-02 · old-data · src/core/work-graph/tasks/plan-service.ts:770, 977; plan-readers.ts:1347,2277; plan-validation.ts:306-311; plan-task-basis.ts:106,244; evidence-coverage.ts:64; context-input-service.ts:364; execution-entry-service.ts:990; views/graph-context-reader.ts:914,1143; views/task-state-timeline.ts:270
- **动作：** change: only together with/after P2a-01 and P2a-03 drop the schemaVersion 1 member of PlanRevisionSnapshot (and PlanRevisionDraft); then read the v2 fields directly at the listed sites plus tasks/plan-commit-compiler.ts:314,387 and agent-runtime/context-assembler.ts:775 (outside the area); keep 'no taskStateBasis = self'
- **覆盖/依据：** tests/work-graph/R3c-task-relations.test.ts:81; A2-disposition-change.test.ts:296,352; R3e-evidence-coverage.test.ts:103; S3-context-inputs.test.ts:670; S2B-31-task-timeline-main.test.ts:20
- **核实理由：** v1 正文确实不带这些字段，但现在 Host 初始提案不查草稿版本，plan-commit-compiler.ts:157-162 仍会写 schemaVersion 1 快照，类型联合也要求先收窄，所以这些三元式不能单独删，必须跟 P2a-01/03 一起做；清单还漏了 plan-commit-compiler.ts:314、387 和 context-assembler.ts:775。
- **涉及测试：** tests/work-graph/A2-disposition-change.test.ts:296,352; tests/work-graph/R3c-task-relations.test.ts:81; tests/work-graph/R3e-evidence-coverage.test.ts:103; tests/work-graph/S3-context-inputs.test.ts:670; tests/work-graph/S2B-31-task-timeline-main.test.ts:20
- 来源：DSH；核实：partly；规格行：是；估计行数：25
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：前置条件误指授权 V1，且遗漏四个生产读取文件。 改法：前置改 TP-049、050；补齐读取文件，保留 taskStateBasis 缺省为自身。

### TP-062 · P2a-04 · old-data · src/core/work-graph/tasks/session-provenance-facts.ts:1-611
- **动作：** delete：除所列外还要删 business/workflow/session-maintenance.ts:365-397 的 backfillLegacyProvenance、:610-614 的调用和 legacyPending→incomplete 分支（约 :620）；sessions/lifecycle-record-codecs.ts:98-101、345 起、405-420 的 SessionProvenanceBackfilled 事件和 basis 校验；contracts/core/session.ts:36 的 LegacyProvenanceBasisV1；model/session-facts-contracts.ts:95-101 的端口、model/session-contracts.ts:63 的 backfillSessionProvenance、queries/contracts.ts:233；state/session-availability.ts:135、504、614 的事件分支和 backfillSessionProvenanceRecord；composition/create-platform.ts:137、806 的接线；SessionRecord.provenance 改为必填，解码器拒绝缺这个字段。测试除所列外：tests/scenarios/S2C-K-legacy-provenance.test.ts 整个文件（2C-26/LE4，514 行），tests/state/S1-dispatch.test.ts:173-185 的 UT52/UT53，tests/state/session-availability.test.ts:181、194、321、383 的 backfill 行，tests/work-graph/S1-dispatch-guards.test.ts:159 一段，S2C-lines-page.test.ts:405 附近，tests/architecture/state-writes.test.ts:75 的 backfillSessionProvenanceRecord，tests/helpers/S1-session-facts-fixture.ts:36、169-170 的接线。
- **覆盖/依据：** tests/work-graph/S1-codecs-indexes.test.ts:454::SV04；:485::SV05；tests/work-graph/S1-dispatch-guards.test.ts:45::SV39；旧来源补填由 HANDOFF 79-1 撤销
- **核实理由：** 核心属实：唯一的 Session 创建在 session-directory.ts:716-723 总会给出 provenance，并写进 accepted 操作（:785-792），createSessionRecord 只有 :971 一个调用者；tests/scenarios/S2C-K-retired.test.ts:308 也写明今天的写入端总写 provenance。但删除面比所列大得多：workflow 维护补填、生命周期事件编码、状态迁移、接线和 2C-26 整个场景文件都只为旧来源存在，约 1100 行生产代码加 800 行测试，不是 1000。
- **涉及测试：** tests/work-graph/S1-provenance.test.ts:293::SV12; tests/work-graph/S1-provenance.test.ts:338::SV13; tests/work-graph/S1-provenance.test.ts:364::SV14，仅旧来源部分; tests/work-graph/S1-provenance.test.ts:393::SV15; tests/work-graph/S1-provenance.test.ts:415::SV45; tests/work-graph/S1-provenance.test.ts:440::SV46; tests/work-graph/S1-codecs-indexes.test.ts:275::SV01，仅旧 provenance 部分; tests/state/S1-session-archive.test.ts:192::UT09; tests/state/S1-session-archive.test.ts:209::UT10
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：1900
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：整文件删除与 TP-007 冲突；漏 claim-service 调用链、Session codec、直接 backfill 测试及当前 Session 构造方；必填仍未排除 null。 改法：保留并转换 execution 列表场景；claim 直接读取当前 provenance 并保留 readonly_copy 拒绝；provenance 改为非空，codec 不补 null；保留创建输入省略时生成 new；逐项删除 legacy 测试并迁移当前构造方，TP-122 同步。

### TP-063 · P2a-07 · old-data · src/core/work-graph/views/automatic-rework-notices.ts:118-174;205-211;255-262;422-434;526-533
- **动作：** change:通知只用提交位置。删掉 automatic-rework-notices.ts 的 readEqualityToEnd/legacySince/两段 legacy 组读取和 noticePositionOf 的 legacy 分支；自动 reverify 缺 cap 改为 unavailable；一起删掉合同 NoticePositionV1 的 legacy 变体（src/contracts/goal-decisions.ts:51）、notice-position.ts:47-52、record-codecs.ts:238-245,257、decision-read-model.ts:1565-1567,1818、undelivered-reply-notices.ts:489、两个 legacy 索引登记（claim-record-codecs.ts:61,71-75；evidence-record-codecs.ts:724,732-736）。测试：删 QA-11 整条、NR05 的 legacy 一半、NR08 整条；删辅助 legacyRequeueRecords/legacyRequeueItemKeys（tests/helpers/S2A-notices-support.ts:95-131）、legacyNoticeWire 以及 noticeWork 的 legacyRounds/legacyRequeues 选项（tests/helpers/S5-queue-support.ts:284-298,304,384-400）；WP2-undelivered-notices.test.ts:446 的 legacy 一项改成普通的格式错误例子或删掉。保留：提交前的 null 占位读成 unavailable，以及根轮次不带 cap 的合法情况
- **覆盖/依据：** tests/work-graph/S5-notices.test.ts::NR01、NR04、NR06、NR05 的“损坏的 null 来源读成 unavailable”一半；tests/work-graph/S2A-notices-rework.test.ts::QA-18；行为已不存在：HANDOFF 79-1（docs/refactor/HANDOFF.md:565-570）
- **核实理由：** 核心属实：现在写通知的地方建记录时都写 since:null，由 Store 绑定（mailbox-service.ts:297-299、requeue-service.ts:1110-1116、evidence-service.ts:349-358,1698-1702）；唯一的 commitReverify 后继路径总会带上 noticeAutomationCap（evidence-service.ts:2030）。但删除清单不全：legacy 位置还在公开合同 goal-decisions.ts:51 和 undelivered-reply-notices.ts:489 里；只为旧数据存在的测试辅助 legacyNoticeWire（S5-queue-support.ts:287）和 legacyRequeueRecords（S2A-notices-support.ts:104）也没列进去。
- **涉及测试：** tests/work-graph/S2A-notices-rework.test.ts:37-76::QA-11; tests/work-graph/S5-notices.test.ts:195-212::NR05，仅 legacy 排序部分; tests/work-graph/S5-notices.test.ts:271-283::NR08
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：220
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：NR05 索引失效；NR08 删除丢失策略变化后的通知稳定性断言；错误 cursor 仍有删改两种指令。 改法：NR05 数量改 1 且两处 items[1] 改 items[0]；将 cap 3→7 后通知不变断言强制迁入 NR01；错误 cursor 改 kind:unknown 并保留拒绝断言。

### TP-064 · P1-184 · c1-transfer · src/core/work-graph/views/track-read-model.ts:195,200-202,224-226,908,920,976,988
- **动作：** change:track-read-model.ts:224-226 改为 ca 必须是 string 或 null（缺字段返回 null），删掉“earlier versions”的注释和 `ca ?? null`
- **覆盖/依据：** 当前编码器（:906-908、919-920、974-976、987-988 四处都写 ca）和分页测试（S2B-30-track-bars、S2B-r2-r3-track-pagination、S2B-r3-consultation-cap、S2B-35-activity-routes）保留；旧格式按 HANDOFF 79-1（:565-570）退出
- **核实理由：** QueryCursor 类型（:195）要求必须有 ca，文件里四处构造 QueryCursor 的地方都写了 ca；canonicalJson 会保留 null（fingerprint.ts:29-30），所以当前产生的游标总是带 ca。tests 里没有手写缺 ca 的 track 游标。只有 :224-226 的解码器容忍缺字段；C1 裁定 8 已交 T。src 约改 2–3 行，测试不改。
- **涉及测试：** tests/work-graph/S2B-30-track-bars.test.ts:137-143,365-380; tests/work-graph/S2B-r2-r3-track-pagination.test.ts:54-76::2B-r2 R3 a Run added before the boundary does not duplicate or skip; tests/app/S2B-35-activity-routes.test.ts:232; tests/work-graph/S2B-r3-consultation-cap.test.ts:51
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：0

### TP-065 · P2a-08 · old-data · src/core/work-graph/views/track-read-model.ts:642-650;702;750;769-780
- **动作：** change:删掉 rounds_unplaced 这一段（track-read-model.ts:149,768-781,1024-1025）、track-read-model.ts:702,750 的空 since/finalizedAt 跳过、activity-read-model.ts:480-487 的旧扫描、task-state-timeline.ts:399-410 的 legacyFinalized 和空 since 分支；S2B_ROUND_BY_GOAL_LEGACY_LOOKUP 和 S2B_ROUND_BY_GOAL_UNFINALIZED_LOOKUP 两个索引一起删（evidence-record-codecs.ts:746-770）；unplaced.rounds 和日历 coverage.checksUnplaced 没有来源了，由 lead 改 2B §2：删掉这两个字段或固定为 0。解码时 finalized 的轮次必须有 finalizedAt。测试：删 2B-30 旧轮次那条（S2B-30-track-bars.test.ts:188-207）、2B-24 里旧轮次那部分（S2B-activity-calendar.test.ts:240-260）、2B-33 定案于 2B 之前的那条（S2B-33-task-timeline-pagination.test.ts:98-116）；删辅助 stripRoundSince/stripRoundFinalizedAt（S2B-track-fixture.ts:149-151,880-881）、openLegacyRound（S2B-activity-fixture.ts:148,251 起）和 seedRoundRaw 不带 since 的那条路径（S2B-task-timeline-fixture.ts:825,649-679）
- **覆盖/依据：** tests/work-graph/S2B-30-track-bars.test.ts::2B-30 check bars carry start/end/result/ordinal/checksBegun and the attributed Session；::2B-30 a Goal-gate round with no responsible Session...；tests/work-graph/S2B-activity-calendar.test.ts::2B-24 的当前格式部分；行为已不存在：HANDOFF 79-1
- **核实理由：** 核心属实：轮次创建时都绑定 since（evidence-service.ts:347-358），定案总是写 finalizedAt（evidence-service.ts:1605）。但“保留 UNFINALIZED 索引供当前 open 轮次用”不对：这个索引只在 scanRoundsUnplaced 里用到（track-read-model.ts:774），用来数没有 finalizedAt 的旧定案轮次；open 轮次走的是 VERIFICATION_ROUND_BY_STATUS_LOOKUP（track-read-model.ts:735-737）。另外 task-state-timeline.ts:399 的旧分支、2B-24 和 2B-33 的旧数据测试也漏了。
- **涉及测试：** tests/work-graph/S2B-30-track-bars.test.ts:188-207::2B-30 legacy rounds without since and pre-2B finalized rounds without finalizedAt are only counted in unplaced.rounds
- 来源：Codex；核实：partly；规格行：是；估计行数：140
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：公开字段删或置零未冻结；finalizedAt 校验层次不明确；日历测试删除范围会包含当前断言。 改法：保留两个公开字段并固定 0；finalizedAt 只在存储 record 校验；删除旧 runC/legacy 准备及旧 unplaced 期望，保留两个当前时段和归属断言。

### TP-066 · P2a-14 · c1-transfer · src/core/work-graph/views/track-read-model.ts:224-226
- **动作：** change:ca 必须为 string 或 null，删除 undefined 到 null 的兼容读取
- **覆盖/依据：** tests/work-graph/S2B-30-track-bars.test.ts:354::2B-30 sessionRefs reads the secretary turn and the readonly consultation, excluding other-goal queries；tests/work-graph/S2B-r3-consultation-cap.test.ts:34::2B-r3 R3 limit 2 over many later readonly copies stays within the injected cap（覆盖缺口：没有测试把带 ca 的游标传回来续页）
- **核实理由：** track-read-model.ts:224-226 把缺 ca 的游标读成 null，当前所有写游标的地方 :908、:920、:976、:988 都写 ca，类型 :195 也要求 ca；C1 lead-acceptance.md:82 裁定 8 和 :93 把它交给 T。游标是不入库的页码令牌，删掉兼容只会让旧版本发出的令牌读不了，符合 79-1。
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：3

### TP-067 · P2a-19 · old-data · src/core/work-graph/views/undelivered-reply-notices.ts:343-348
- **动作：** P2a-28 其余已驳回项（healthConclusion、archiveRequest 在新建时就缺，属当前语义）照旧 keep；unavailableSince/responseSince 一项按 Codex P2a-19 改，具体为：(1) mailbox-service.ts:3299-3309 对已退役来源（health unavailable）缺 unavailableSince、或已回复的 work_run 消息缺 responseSince 时按损坏拒绝（reject 'unavailable'），两个位置总是带出；(2) communication-contracts.ts:71-73 的 UndeliveredReplyV1 两个字段改为必填；(3) 删除 undelivered-reply-notices.ts:343-349 的 position_missing/incomplete 分支，保留 :327-342 的 Goal 过滤和精确比较；(4) 删除 WP2-undelivered-notices.test.ts:226-272 的旧数据部分，保留 :274-285 的位置损坏部分并改测试名；(5) 改注释 contracts/core/session.ts:62、state/message-machine.ts:166-169 和 :1333、state/session-availability.ts:396 和 :463，以及规格 wiring-2-SPEC.md:41、:46、:303（M05 行）。不要在 Session/消息 codec 里强制这两个字段，否则手写的不可用 Session 夹具会坏（K3-R1-close-open-turn.test.ts:51、K-R-close-open-turn.test.ts:72、R4c-execution-read.test.ts:199、R4c-task-claim-boundaries.test.ts:92、R4c-task-claim.test.ts:245、A2-step1-codecs.test.ts:681）。SessionRecord.unavailableSince 保持可选，因为 available 时缺字段是当前语义。另外 contracts/work-line.ts:109 和 work-line-reader.ts:538 的“旧记录没有时为 null”也只对应旧数据，可以在同一批由 lead 决定要不要一起收紧。
- **覆盖/依据：** tests/work-graph/WP2-undelivered-notices.test.ts::F09 (113, 127), F10 (147), F12 (166)；tests/work-graph/S1-wait-disposal.test.ts:158-161 和 tests/scenarios/S1-wait-copy-retirement.test.ts:196（DTO 带出两个位置）；tests/state/WP2-positions.test.ts P01 各行（写入方）；旧格式支持由 HANDOFF.md:565-570（79-1）撤销
- **核实理由：** 当前写入方都会写位置：Session 由 available 进入 unavailable 时写 null 占位（session-availability.ts:397、:456-457），同一提交里绑定（session-health.ts:143-144、run-reconcile-service.ts:96、query-execution.ts:561）；work_run 消息首次回复也写占位（message-machine.ts:1252、:1313，在 mailbox-service.ts:306-307 绑定）。所以不可用 Session 缺 unavailableSince、已回复消息缺 responseSince 只会出现在旧库里，规格 wiring-2-SPEC.md:46（“旧库风险”）和 :303（M05“旧数据缺位置”）也写明这一点，因此 Codex 对，DSH 说它属于当前语义是错的；只有 available 时缺字段才是当前语义（:330-345、:445）。Codex 的动作需要补全：强制要求放在 mailbox，不放在 codec；行数 25 低估了，单是 M05 旧数据那一半测试就约 47 行。
- **涉及测试：** tests/work-graph/WP2-undelivered-notices.test.ts:221-273::M05 old data missing a position blocks only its Goal; a damaged position is refused，仅旧数据部分
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：65
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：末句允许临时扩大 work-line DTO 修改，另有两个注释文件不在白名单。 改法：删除可选扩展，仅收紧 mailbox 和 UndeliveredReplyV1；保留 SessionRecord 位置字段的当前可选语义。

### TP-068 · E1-06 · stale · tests/app/A2-continuation-projection.test.ts:['89']
- **动作：** convert:send_session_message(intent=inquiry,needsReply=true,waitAfterSend=true)
- **覆盖/依据：** tests/app/orchestration-mechanism.test.ts:169-178,208-230（显式字段）；TD-5 断言 tests/app/A2-continuation-projection.test.ts:82-138 原样保留
- **核实理由：** 第 89 行用 replyMode:'wait'，生产把它标为旧的等价输入（communication-tools.ts:318、mailbox-service.ts:2053-2069，技能 content.md:24 写“旧 replyMode 仍可兼容”）；所有读它的地方都有 intent===undefined&&replyMode==='wait' 的兜底（collaboration-driver.ts:665/671、host.ts:1224），换成显式三字段状态相同。另有第 7 行注释要改；这一改只在 P 区决定删掉 replyMode 时才有意义，且 K3-08 规格行（slice-K3-SPEC.md:1417）仍写 replyMode，届时一起改。
- **涉及测试：** TD-5: a paused yielded wait is blocked, a resumed one ready, a cancelled one failed; the Workflow claims neither stopped one
- 来源：Codex；核实：confirmed；规格行：是；估计行数：2

### TP-069 · E1-26 · helper · tests/app/A2-continuation-projection.test.ts, tests/app/A2-requeue-route.test.ts, tests/app/A2-reverify-route.test.ts:A2-continuation-projection:46-80; A2-requeue-route:45-82; A2-reverify-route:45-74
- **动作：** merge-into:tests/helpers/A2-restart-fixture.ts::post/workRow/readExecution/driveWorkflow（driveWorkflow 加“停在 requeue_task 前”和收集 receipts 的参数；publicDirectory/TASK 一起复用）
- **覆盖/依据：** tests/helpers/A2-restart-fixture.ts:55-130
- **核实理由：** A2-requeue-route:45-49 与 A2-reverify-route:45-49 的 post 和夹具 A2-restart-fixture.ts:64-68 逐字相同，requeue-route:67-74 的 workRow 同夹具 :111-118，readRun 等于 readExecution(...).run（:120-124）；A2-automation-verdict.test.ts:44-46 已从该夹具 import。driveWorkflow 在 requeue-route:57-66、reverify-route:52-64 停在 requeue_task 前，与夹具 :82-93 不同，需参数化，三段本地 helper 约 100 行。
- **涉及测试：** TD-5…；tasks/requeue and executions/brief…；verification/reverify…
- 来源：DSH；核实：confirmed；规格行：否；估计行数：80

### TP-070 · E1-28 · helper · tests/app/AG2-consultation.test.ts, tests/app/R6-host.test.ts:AG2-consultation:115-179; R6-host:621-708（另 R6-host:106-135）
- **动作：** merge-into:在 tests/helpers 抽一个带参数（scope、bindings/queryProfiles、checks、工作区文件、readPrefixes）的 CLI 启动 Host 构造器，AG2-consultation:115-179、R6-host:621-708 与 startAG2bHost 都改用它；两处 readPageToken（AG2-consultation:181-188、R6-host:137-144）改 import AG2b-collaboration-fixture.ts:275；R6-host:106-135 不在内
- **覆盖/依据：** tests/helpers/AG2b-collaboration-fixture.ts:186-282（同模式，需先抽参数）
- **核实理由：** AG2-consultation:115-179 和 R6-host:621-708 确是同一 CLI 启动构造器（临时目录、vendor skills、ProviderRegistry+脚本模型、写 workbench.json、loadWorkbenchCliConfig、读 token）。但 R6-host:106-135 直接 createLocalWorkbenchHost、没有 runtime/provider/CLI 文件，不是同一构造器；startAG2bHost 把 AG2B_SCOPE、两个 binding、工具表、readPrefixes ['.'] 和 checks 写死（AG2b-collaboration-fixture.ts:203-260），不能直接“并入”，要先抽出带参数的构造器。
- **涉及测试：** answers the original question…；loads a real startup JSON…
- 来源：DSH；核实：partly；规格行：否；估计行数：100

### TP-071 · E1-30 · helper · tests/app/S2B-41…, S2B-be2-late-evidence-activity, S2B-be2-run23-activity, S2B-be2-startup-reconcile-activity, S2B-r2-backfill-probe-first, S2B-r2-r6-probe-verdicts, S2B-backfill-workflow, S2B-r2-backfill-done-cursor, S2B-r2-backfill-identity, S2B-r2-backfill-revision-race, S2B-r2-backfill-real-kernel:deferred 6 处；viewOf 5 处；readPageToken 2 处；until 2 处（详见证据）
- **动作：** merge-into: deferred 六份改用 tests/helpers/A2-restart-fixture.ts:192::deferred；readPageToken 两份改用 tests/helpers/AG2b-collaboration-fixture.ts:275::readPageToken；viewOf（ReadResult 版）和 until 新增导出到 tests/helpers/S2B-activity-fixture.ts（这几份文件已经 import 它），until 的默认超时由调用方传入
- **覆盖/依据：** A2-restart-fixture.ts:192 deferred；AG2b-collaboration-fixture.ts:275 readPageToken（S4C-record-note-host.test.ts:32 已在用）；viewOf/until 目前没有现成导出，需新增到 S2B-activity-fixture.ts
- **核实理由：** 六份 deferred、四份 ReadResult 版 viewOf（done-cursor:34、identity:52、revision-race:31、real-kernel:67）、两份 readPageToken、两份 until 都核对属实，S2B-backfill-workflow:91-102 那份类型写法不同但用法兼容。但 S2B-r2-activity-support.ts 目前只有 tests/work-graph 下的文件在 import，这些 app 文件都没 import 它；S2B-activity-fixture.ts 已被其中五份 import（如 S2B-backfill-workflow:34、S2B-backfill-host:29），放那里更合适。另外 until 的默认超时不一样（S2B-backfill-host:58 是 20s，real-kernel:58 是 30s），合并时要让调用方传超时；按删掉的行数减去新增导出算，估计约 85 行。
- **涉及测试：** 2B 组本地 helper（无单独 test 名）
- 来源：DSH；核实：partly；规格行：否；估计行数：85
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：共享 until 违反 F9；白名单含简称、省略号并漏真实 helper 文件。 改法：不共享轮询，改用真实公共操作的 A3 完成闸门；其他 helper 合并照做；用完整路径替换简称并安排 T3 交接。

### TP-072 · E1-23 · handwritten · tests/app/S2B-r2-backfill-done-cursor.test.ts:['44-65', '80-88']
- **动作：** convert:公开 Plan 创建/采用（夹具加任务数参数）→ claim/enter/end → recordRunActivity；两个候选可直接用 claimThenCancel
- **覆盖/依据：** tests/helpers/S2B-activity-fixture.ts:355-388::adoptInitialPlan；:515-520::runAndEnd；:529-541::claimThenCancel；:543-549::writeActivity；保留 tests/app/S2B-r2-backfill-done-cursor.test.ts:98-114::R9
- **核实理由：** seedLegacyActivity 造的是有 startedAt 却没有授权的 Run（S2B-activity-fixture.ts:302-324），当前写入方不会产生这种 Run；两个候选（:45-65）是 RUN-09 形状，可用 claimThenCancel 替换。夹具只有 12 个任务，且每个任务每个测试只接一个 Run（:71-73），所以要扩展装配，和 finding 说的一致。
- **涉及测试：** R9 the batch-full probe keeps a non-null continuation instead of declaring done
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：35
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：runAndEnd 仍手写 Runtime 事实，固定 counter 违反 F4，claimThenCancel 不能产生 counted 期望。 改法：使用至少 103 个真实工作任务；真实执行和真实 backfill 先形成 101 条已记录活动，再创建两个真实结束未记录候选；被测 backfill 使用真实 countRunActivity，保留原分页和 counted 断言。

### TP-073 · E1-17 · duplicate · tests/app/S2C-line-routes.test.ts:['166-170']
- **动作：** merge-into:tests/app/S2C-line-routes.test.ts::2C-31 (h) the routes return exactly the LE3 results over the 14-Session D1 dataset
- **覆盖/依据：** tests/app/S2C-line-routes.test.ts:299-323::2C-31 (h)（:301-302 同样断言 routeList 等于 listWorkLines）
- **核实理由：** (d)（S2C-line-routes.test.ts:166-170）只在一个会话的夹具上断言 routeList 等于 listWorkLines；(h) 在同样的 memory/sqlite describe.each 里，用 D1 数据集做了同样的相等断言（:301-302），这正是规格行 2C-31 要的“读 2C-14 的数据”（slice-2C-SPEC.md:1329）。(e) 不依赖 :156 建的会话。
- **涉及测试：** 2C-31 (d) lines/list returns exactly the LE3 WorkLineReadPort value
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：5

### TP-074 · E2-09 · duplicate · tests/composition/K-R-close-open-turn.test.ts:142-148
- **动作：** merge-into:tests/scenarios/K-W-workflow-close.test.ts::KA-12 (KE4, L8): only a read-only legacy reader is registered for the mapped Kernel adapter; the Runtime answers unsupported and the Workflow falls back to a new Session, while the original history stays readable through the legacy reader
- **覆盖/依据：** tests/scenarios/K-W-workflow-close.test.ts:503-504
- **核实理由：** K-R-close-open-turn.test.ts:142-148 只用 legacyEntries 注册映射适配器，在手写 Run 上断言 closeOpenTurn 回 unsupported；K-W-workflow-close.test.ts:486-504 在真实 Host 上只把同一适配器登记为 legacy reader，断言 closeResult 同为 unsupported，并多断言回退新 Session、移交和原历史可读。
- **涉及测试：** KA-12 answers unsupported when only the legacy Kernel reader is registered; KA-12 (KE4, L8): only a read-only legacy reader is registered for the mapped Kernel adapter; the Runtime answers unsupported and the Workflow falls back to a new Session, while the original history stays readable through the legacy reader
- 来源：DSH；核实：confirmed；规格行：是；估计行数：7
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：源和合并目标均由 TP-027 删除。 改法：改为由 TP-027 吸收删除，不执行 merge，ledger 同时记录两项。

### TP-075 · E2-10 · duplicate · tests/composition/K-R-close-open-turn.test.ts:191-197
- **动作：** merge-into:tests/scenarios/K-W-workflow-close.test.ts::KA-12 (KE4, L8): an unreadable Kernel store is a definite failure; the Workflow falls back to a new Session, hands the responsibility over, and the original history honestly refuses the read while the store is gone
- **覆盖/依据：** tests/scenarios/K-W-workflow-close.test.ts:434
- **核实理由：** K-R-close-open-turn.test.ts:191-197 把映射路径指向不存在的 .absent 文件，断言 unreadable；K-W-workflow-close.test.ts:428-434 在真实 Host 上 moveKernelAside 让映射库消失，断言 closeResult 同为 unreadable，并多断言回退、移交、历史被拒和归档（435-455）。
- **涉及测试：** KA-12 answers unreadable when the mapped Kernel database file is missing; KA-12 (KE4, L8): an unreadable Kernel store is a definite failure; the Workflow falls back to a new Session, hands the responsibility over, and the original history honestly refuses the read while the store is gone
- 来源：DSH；核实：confirmed；规格行：是；估计行数：7

### TP-076 · E2-21 · trivial · tests/composition/K-R-close-open-turn.test.ts:219-226
- **动作：** merge-into:tests/scenarios/K-W-maintenance.test.ts::KA-10 (KE3, L7/KA1): the start-up maintenance closes a RUN-19 clean interruption's dangling Kernel Turn, returns the Session available, and does not archive it
- **覆盖/依据：** tests/scenarios/K-W-maintenance.test.ts:138-156（RUN-19 真崩溃、维护关 Turn、Session available）；tests/composition/K-R-close-open-turn.test.ts:267-277（真根上 close 结果 toEqual {closed, available}）；tests/scenarios/K-W-workflow-close.test.ts:247-249
- **核实理由：** 219-226 只断言 RUN-19 关闭后 {closed, available}，health 来自替身 recordSessionHealth，确实多余；但 DSH 指的 KA-07（K-W-workflow-close.test.ts:233-249）是 RUN-24 暂停续跑、带 requeueRef 的路径，RUN-19（requeueRef:null）由 K-W-maintenance.test.ts:138-156 覆盖（维护以 requeueRef:null 调 closeOpenTurn，session-maintenance.ts:523），结果形状由同文件 267-277 断言，被谁覆盖要改成这几处。
- **涉及测试：** KA-12 closes a RUN-19 Turn, re-probes and returns the health owner the result available
- 来源：DSH；核实：partly；规格行：是；估计行数：8
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：返回形状覆盖行号错误，merge 目标没有该返回值断言。 改法：改为删除重复测试；cover 分别引用 maintenance 的 RUN-19 状态和 composition 第 279–280 行真实返回形状，不执行所写 merge。

### TP-077 · F-04 · duplicate · tests/helpers/A2-restart-fixture.ts:262-324（pausedRunOnClosedHost，63 行）
- **动作：** delete:tests/helpers/A2-restart-fixture.ts:262-324；顺带删 :39 import 里只剩这段用的 seedAG2bWorkGraph、startAG2bHost，并改 tests/scenarios/support/common.ts:453-458 的注释
- **覆盖/依据：** tests/scenarios/support/common.ts::pausedRunOnClosedHostChecked（A7/A8/K-W/K3-29/K3-41/K-t1 共 26 处使用）
- **核实理由：** A2-restart-fixture.ts:262-324 全仓无调用（grep 只有定义和 common.ts:454 的注释）；common.ts:459-522 与它逐句相同，只把 driveWorkflow 换成 driveChecked 加不变量检查（:491 对 :293），类型 PausedOnClosedHost（:251-252）仍被 common.ts:66 引用，要保留。
- **涉及测试：** 外部 0 个 import（grep -rnw pausedRunOnClosedHost tests 只命中定义与本文件）
- 来源：DSH；核实：confirmed；规格行：否；估计行数：66

### TP-078 · F-28 · helper · tests/helpers/AG2b-collaboration-fixture.ts:63、65、284、286、302、366、405、441
- **动作：** delete:去掉 tests/helpers/AG2b-collaboration-fixture.ts:63、65、284、286、302、366、405、441 共 8 处 export 关键字；不附带“R6 改为 import”的建议
- **覆盖/依据：** 同文件内部使用；无外部消费者
- **核实理由：** 8 个名字在其它文件 0 命中（含 tests/app/orchestration-mechanism.test.ts:239/337/408 的动态 import，它只用 startAG2bHost、corePost 等），去 export 成立；但 R6 复用的附带建议不对：tests/app/R6-host.test.ts:148-153 的 coreGet 有可选 token 和 origin 参数（:241-244 在用），:154-160 的 corePost 还接受字符串 body，与 AG2b-collaboration-fixture.ts:286-288 不同，而且去 export 后也无法 import。
- **涉及测试：** AG2b 系测试不 import 这些名字（逐名 grep）
- 来源：DSH；核实：partly；规格行：否；估计行数：8

### TP-079 · F-40 · helper · tests/helpers/B2-execution-fixture.ts:46、53、55、62
- **动作：** delete:tests/helpers/B2-execution-fixture.ts:46、:53、:55、:62 去掉 export（实现保留）
- **覆盖/依据：** 同文件内部使用；无外部消费者
- **核实理由：** B2_INPUT/B2Ports/B2TerminalObservation/B2PreparedOptions 在全树的其它命中只有 S1-workflow-archive-fixture.ts:502/509/511/518 自己的重复声明，没有任何文件从 B2-execution-fixture 导入；本文件内在 :81/:90-99/:189/:200/:203/:238 使用。
- **涉及测试：** B2 系测试只 import createB2ExecutionFixture 与 B2ExecutionFixture 等
- 来源：DSH；核实：confirmed；规格行：否；估计行数：4

### TP-080 · F-34 · handwritten · tests/helpers/B2-runtime-fixture.ts:198
- **动作：** convert: B2-runtime-fixture.ts:198 改为 f.createSession('b2-runtime-session',{kind:'role_spec',pin})（task-claim-fixture.ts:318-331，走 admitSessionCreation+recordSessionCreated），:199 的 buildRequest 传这个 sessionRef；依赖 sessions.first 或默认 buildRequest 就是这个 Session 的调用方，一起改成 fx.claim.sessionRef：A2-reconcile-runtime.test.ts:1044,1055、B2-runtime-execution.test.ts:233,505
- **覆盖/依据：** 保留 runtime 场景；S2B-runtime-store-fixture.ts:137 的副本由 F-19 合并。创建时就带 role_spec，不是运行中热切换。
- **核实理由：** 公开步骤是有的：S2B-be1-platform-fixture.ts:219 和 C2-runtime-platform-fixture.ts:119 已经用 createSession 带 role_spec 建 Session。但改成新建 Session 以后，sessions.first 还是 legacy_template。B2-runtime-execution.test.ts:233,505 和 A2-reconcile-runtime.test.ts:1044,1055 都默认 sessions.first 就是被认领的 role_spec Session（:1044 的 buildRequest 默认取 firstSession，见 task-claim-fixture.ts:378），所以这些调用方要一起改，不是 1 行能完成的。
- **涉及测试：** createB2RuntimeFixture
- 来源：Codex；核实：partly；规格行：是；估计行数：6
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：f.createSession 内部仍代 Runtime 调用 recordSessionCreated，违反 F3。 改法：安装 role_spec 后通过真实 Runtime.createSession 创建，再认领任务；同步四处调用方。

### TP-081 · F-33 · handwritten · tests/helpers/C1-mailbox-fixture.ts:103-110,121-167
- **动作：** convert:准备manifest→authorizeRuntimeEntry→beginRuntimeEntry→recordExecutionEntered
- **覆盖/依据：** 保留 tests/work-graph/C1-session-mailbox.test.ts:128-170,336-352 的 mailbox 行为；任意改写的调用方另见 F-52。
- **核实理由：** C1-mailbox-fixture.ts:104-110 用 commitRaw 手写了 entered 授权，:154-167 又补了 bundleRef、inputBinding 和 inputDigest。B2-execution-fixture.ts:274-305 在同一个 task-claim 夹具、legacy_template Session 上走通了 authorizeRuntimeEntry→beginRuntimeEntry→recordExecutionEntered，所以公开步骤是有的。转换时要在 :91 补上 EXECUTION_ENTRY_RECORD_SCHEMAS。C1-session-mailbox、C2-mailbox-admission、A2-step1-manifest 这些调用方只读 currentRun、envelope、rawBodies 和 authorizeConfiguration。
- **涉及测试：** createC1Harness
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：55
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：转换明确使用规则表禁止的 recordExecutionEntered。 改法：真实 Runtime prepare/start，加脚本模型 A3 闸门；公开读取 currentRun/envelope 并复用真实 manifest，删除手写入场事实。

### TP-082 · F-05 · helper · tests/helpers/S1-runtime-scenario-fixture.ts:59
- **动作：** delete
- **覆盖/依据：** 无消费者；不删除测试用例或断言。
- **核实理由：** 全库 grep S1_T1，只在 S1-runtime-scenario-fixture.ts:59 有定义。
- **涉及测试：** S1_T1
- 来源：Codex；核实：confirmed；规格行：否；估计行数：1

### TP-083 · F-18 · helper · tests/helpers/S1-workflow-archive-fixture.ts:160-791
- **动作：** merge：createTaskClaimFixture 增加可选项（clock、审计钩子 opt-in、公开 bootstrap 模式），createB2ExecutionFixture 增加可选项（clock、底座工厂、非首个 claim 用独立 Kernel run/turn），默认值保持现状；然后删 S1-workflow-archive-fixture.ts 的 160-262、264-499、501-791 三段副本，S1 保留 observeFixtureStore 并带选项调用两份共享 fixture
- **覆盖/依据：** tests/helpers/task-claim-fixture.ts::createTaskClaimFixture + tests/helpers/B2-execution-fixture.ts::createB2ExecutionFixture（加选项后）；S1 的审计、时钟、公开初始化、逐 claim Kernel 身份作为选项保留
- **核实理由：** 两边都对：S1:264-499 是 task-claim-fixture.ts:160-453 的副本，S1:560-791 是 B2-execution-fixture.ts:104-331 的副本。但 DSH 的“上移”会改 55 个 importer：审计把 records.commit 换成每次提交后查不变量（S1:141-156），公开 bootstrap 会改记录和事件（DSH 自己的 F-10 也说要单独切片），时刻也不同（S1:100 是 10-08，task-claim:50 是 09-24，WP1-entry-fixture.ts:91 的 t0 依赖 10-08）；直接 import B2 版会丢掉 S1:744-746 的逐 claim Kernel 身份（WP1-handover-fixture.ts:359 对其它 claim 用它）和 S1:707/761 的 clock。DSH 的 importer 也写错：K3-review-workflow-rows 取的是 B2-execution-fixture（:35），实际是 2 个 S1 测试加 WP1-entry/handover/units 三个 helper。
- **涉及测试：** createTaskClaimFixture; createB2ExecutionFixture
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：560
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：公开 bootstrap 可选且默认保持旧方式，与 TP-107、108 冲突。 改法：先完成 TP-107、108，再合并；不保留旧 seed 开关，其余 clock、审计、工厂和逐 claim Kernel 身份继续参数化。

### TP-084 · F-24 · helper · tests/helpers/S1-workflow-archive-fixture.ts:160-161、180、187、501-502、509-518
- **动作：** delete：删 S1-workflow-archive-fixture.ts:160-161（CLAIM_FIXTURE_AT、CLAIM_FIXTURE_EXPIRED_DEADLINE）、:180-185（ClaimConnection）、:501（B2_AT）四个死声明；FixtureAudit(:102)、RecordSpy(:168)、MaterialSpy(:176)、Records(:178)、ClaimRequestOverrides(:187)、B2_INPUT(:502)、B2Ports(:509)、B2Admitted(:510)、B2TerminalObservation(:511)、B2PreparedOptions(:518) 十处去掉 export（若做 F-03 合并，本条一并吸收）
- **覆盖/依据：** 无外部消费者：本文件的 5 个 importer（S1-archive-flow、S1-session-maintenance 两个测试，WP1-entry/handover/units 三个 helper）都不 import 这 14 个名字
- **核实理由：** 在本文件里逐名核对：B2_AT 只在 :501 出现，CLAIM_FIXTURE_AT 只在 :160 和 :501 出现，CLAIM_FIXTURE_EXPIRED_DEADLINE 只在 :161，ClaimConnection 只在 :180，这四个是死声明；其余 10 个名字只在本文件内部用。DSH 说本文件只有 3 个 importer，实际是 5 个（还有 WP1 三个 helper），不过它们取的名字里都没有这 14 个，结论不变。
- **涉及测试：** 无测试 import 这些名字；本文件 3 个 importer 只用 beginConsultation/completeWork/retireSession 等与 createB2ExecutionFixture
- 来源：DSH；核实：confirmed；规格行：否；估计行数：14
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：吸收条目误写 F-03。 改法：改为由 TP-083 吸收，合并后只清理仍存在的声明和 export。

### TP-085 · F-25 · stale · tests/helpers/S2A-notices-support.ts:95-132
- **动作：** delete：tests/helpers/S2A-notices-support.ts:95-132 连同 QA-11 测试（tests/work-graph/S2A-notices-rework.test.ts:37-76）和两处头注释（support:5-7、rework:4-7）；和生产的 since 缺失组读取（automatic-rework-notices.ts:164-174、205-211，claim-record-codecs.ts:61、72 的 s2a-requeue-legacy 索引）同批删，规格行 QA-11 加后注
- **覆盖/依据：** 只剩旧格式：唯一写者 requeue-service.ts:1110-1116 总绑定 since，slice-2A-SPEC.md:390 写明今天的写者造不出没有 since 的记录；按 79-1。现行提交位置的翻页、计数和已看位置由 QA-10（tests/work-graph/S2A-notices-counts.test.ts:24）覆盖
- **核实理由：** 旧式 requeue 只由测试经存储边界写入（S2A-notices-support.ts:104-122），requeue-service.ts:1110-1116 总绑定 since，规格 slice-2A-SPEC.md:390 也承认造不出，属 79-1 旧格式，现行行为有 QA-10 覆盖；但删 helper 必须连 QA-11 的 37-76 一起删，行数约 80，并且要和生产的旧组读取同批删。
- **涉及测试：** legacyRequeueRecords; legacyRequeueItemKeys; QA-11 legacy requeues without since order by occurredAt before the commit-position requeues
- 来源：Codex；核实：partly；规格行：是；估计行数：80

### TP-086 · F-38 · handwritten · tests/helpers/S2A-notices-support.ts:146-164
- **动作：** convert：在 S5-decision-fixture.ts:440-446 注册 PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events→installCompletionPolicy→activateCompletionPolicy
- **覆盖/依据：** 保留 QA-10 等真实 requeue 场景。
- **核实理由：** S2A-notices-support.ts:146-151 的注释写明，只因 S5 夹具没注册 bootstrap 事件才手写策略；project-bootstrap-service.ts:699、812 有 install/activate，已有激活时也能再切换（:902-931）；S1-workflow-archive-fixture.ts:277、319-330 示范过只注册 bootstrap 事件就能走公开步骤。
- **涉及测试：** openManyTaskWorld; QA-10
- 来源：Codex；核实：confirmed；规格行：是；估计行数：20

### TP-087 · F-41 · helper · tests/helpers/S2A-notices-support.ts:40-41
- **动作：** delete:从 tests/helpers/S2A-notices-support.ts:40 的转出口移除 OPERATOR、WORKSPACE、noticeWork；:41 S5NoticeWork 只去掉 export，不删
- **覆盖/依据：** 无外部消费者
- **核实理由：** OPERATOR/WORKSPACE/noticeWork 确实没有测试从本文件导入（S2A-notices-counts:15-16、-rework:12-13、-workspace:10-11 只取 committed/pin/ready/WORKSPACE_SCOPE），本文件用的是 :35/:37 的源 import；但 S5NoticeWork 并非“只命中定义”，:44 openS2ANotices 的返回类型就用它，整行删 :41 会编译失败。
- **涉及测试：** S2A notices 测试只从 :40 取 WORKSPACE_SCOPE/committed/pin/ready
- 来源：DSH；核实：partly；规格行：否；估计行数：2

### TP-088 · F-39 · handwritten · tests/helpers/S2A-notices-workspace2-fixture.ts:88-112
- **动作：** convert：在 S5 夹具注册 PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events 之后，用 registerWorkspace→installCompletionPolicy→activateCompletionPolicy（w2Context）
- **覆盖/依据：** 保留跨 Workspace 通知隔离及原有预期。
- **核实理由：** S2A-notices-workspace2-fixture.ts:97-112 手写 W2 工作区和策略；registerWorkspace（project-bootstrap-service.ts:612-693）写出的正是 {ref, revision: 1}，和 :108 的写法相同；install/activate 也有，缺的只是 S5 夹具注册 bootstrap 事件（同 F-38）。
- **涉及测试：** W2 scope/static policy bootstrap
- 来源：Codex；核实：confirmed；规格行：是；估计行数：25

### TP-089 · F-08 · duplicate · tests/helpers/S2A-notices-workspace2-fixture.ts:81-321（openW2World）对 tests/helpers/S2A-notices-support.ts:141-225（openManyTaskWorld）
- **动作：** merge-into:tests/helpers/S2A-notices-support.ts::openManyTaskWorld（加 scope/ctx/额外 seed 记录/claim 栈选项），openW2World 只保留 W2 自己的 Session/claim/进入栈
- **覆盖/依据：** openManyTaskWorld（加选项后）
- **核实理由：** 字面匹配少是因为改了名字：openW2World 的策略 seed+Goal+Plan（S2A-notices-workspace2-fixture.ts:96-145）和 requeue 服务+requeueOnce（:279-319）就是 openManyTaskWorld（S2A-notices-support.ts:149-218）的改名副本，W2 只多写一条 Workspace 记录；它的 Session/claim/进入/结束栈（:146-278）又是 S5-decision-fixture.ts:624/666/731 那套按 W2_SCOPE 重写。“实测不成立”的结论不准确。
- **涉及测试：** S2A notices 两组测试
- 来源：DSH；核实：refuted；规格行：否；估计行数：70
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：额外 seed 记录参数保留了禁止的手写事实入口；见 t-items-TP.md:592、S2A-notices-workspace2-fixture.ts:107。 改法：先完成 TP-086/088；共享工厂只接公开输入，删除额外 seed 记录参数，W2 Workspace 和策略由公开 owner 建立。

### TP-090 · F-26 · stale · tests/helpers/S2B-activity-fixture.ts:250-266
- **动作：** delete：tests/helpers/S2B-activity-fixture.ts:250-266 及接口 :148、导出 :583；2B-24（tests/work-graph/S2B-activity-calendar.test.ts:235-241、257-260）只删旧轮次部分，保留 221-233、249-256、261；和生产 activity-read-model.ts:480-487 的旧组读取同批删，规格行 2B-24（slice-2B-SPEC.md:775）的旧轮次一句加后注
- **覆盖/依据：** 只剩旧格式：evidence-service.ts:352-358、1700-1702 新轮次总绑定 since，更新时沿用原 origin（:292-316）；按 79-1。同一测试的当前轮次聚合断言 249-256 保留
- **核实理由：** openLegacyRound 真实开轮后再删掉 since（S2B-activity-fixture.ts:261），现行轮次写者 evidence-service.ts:358、1702 总绑定 since，属旧格式；只在 2B-24（calendar.test.ts:240）用，保留现行断言可行；但还要改接口 :148、导出 :583 和测试 235-241、257-260，约 30 行。
- **涉及测试：** openLegacyRound
- 来源：Codex；核实：partly；规格行：是；估计行数：30

### TP-091 · F-44 · handwritten · tests/helpers/S2B-activity-fixture.ts:301-324
- **动作：** delete helper（tests/helpers/S2B-activity-fixture.ts:301-324 及 :157、:584）；2B-26（tests/work-graph/S2B-activity-calendar-tasks.test.ts:154-157、164、167-168）删掉旧 Run 和 runsSessionUnknown:1 的断言，不改造；R9（tests/app/S2B-r2-backfill-done-cursor.test.ts:81-88）改用现有的 f.runAndEnd+f.writeActivity，并把同文件的 commitLegacyRun（:45-65）也换成真实 Run，计划任务要扩到 103 个以上（现在 WORK_TASK_IDS 只有 12 个，fixture:72-73）
- **覆盖/依据：** R9 的扫描游标和 done 断言保留；sessionRef:null 只出现在没有 dispatch 记录的旧执行（run-activity-service.ts:281-302），claim 总写 outbox（claim-service.ts:467），按 79-1 退出
- **核实理由：** seedLegacyActivity 确是手写的旧 Run（:308-321），R9 也借用它；但改造后就等于已有的 runAndEnd+writeActivity（:515-549），不必留 helper；2B-26 那处（calendar-tasks:154-164）测的是 sessionRef 为 null 的旧执行，真实流程造不出，应删不应改；R9 用的 counted-N 任务不在计划里，改造要扩计划，R9 自己的 commitLegacyRun 也是同一种旧形。
- **涉及测试：** seedLegacyActivity
- 来源：Codex；核实：partly；规格行：是；估计行数：60
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：runAndEnd/writeActivity 和 countedCounter 仍手造事实；进入前取消不能保留 counted 断言；见 S2B-activity-fixture.ts:543、S2B-r2-backfill-done-cursor.test.ts:67、101。 改法：R9 转换标记 BLOCKED，先冻结真实 Runtime/Kernel 历史、允许故障形成待回填对象及真实 countRunActivity 的完整流程；禁止 writeActivity、countedCounter 和进入前取消替代 counted 对象。日历剩余断言统一按 TP-156 保留。

### TP-092 · F-19 · helper · tests/helpers/S2B-runtime-store-fixture.ts:1-25,106-251
- **动作：** merge-into:tests/helpers/B2-runtime-fixture.ts::createB2RuntimeFixture
- **覆盖/依据：** 保留 live store、SQLite reopen 后重绑、两个派生 reader 和 additionalSchemas；只抽共同的 runtime 构造
- **核实理由：** S2B-runtime-store-fixture.ts:15、:102-105 自己写明是复制，:109-213 和 B2-runtime-fixture.ts:175-291 逐段一样；独有的只有 additionalSchemas（:110-116）、导出 records、读模型绑定（:216-224）和 reopen 时重绑（:237-246）。副本缺 B2 :234-260 的 review-purpose 授权分支，合并后会带上，但 20 个使用文件里没有 review-purpose 的 Run，不影响。
- **涉及测试：** createS2BRuntimeStoreFixture
- 来源：Codex；核实：confirmed；规格行：是；估计行数：100

### TP-093 · F-28 · stale · tests/helpers/S2B-task-timeline-fixture.ts:648-679,824-825
- **动作：** delete：seedRoundRaw（tests/helpers/S2B-task-timeline-fixture.ts:648-679）、:824-825 分支，以及唯一的调用用例 tests/work-graph/S2B-33-task-timeline-pagination.test.ts:98-116；同时删生产的旧轮次读法 task-state-timeline.ts:399-407、406-407、415-416，并由 lead 划掉 slice-2B-SPEC.md:784（2B-33 行）里“没有 since 的轮次”“2B 以前定案的轮次”两句
- **覆盖/依据：** 行为已不存在（旧格式）：HANDOFF.md:565-566（79-1）；当前路径由 tests/work-graph/S2B-32-task-timeline-fold.test.ts:207-223 和 S2B-31-task-timeline-main.test.ts:29-34 覆盖
- **核实理由：** 现写入方一律写 since（evidence-service.ts:352、358 建轮时绑定，:1700-1702 reverify），定案一律写 finalizedAt（:354-355、:1605），encodeVerificationRoundSnapshot 在 src 里只有这两处调用，所以这是 79-1 的旧格式。但 2B-33 行（slice-2B-SPEC.md:784）明文要求这一条，S2B-33:98-116 也要一起删，生产分支 task-state-timeline.ts:399-407 要一起去，原估 32 行偏少。
- **涉及测试：** seedRoundRaw
- 来源：Codex；核实：partly；规格行：是；估计行数：53

### TP-094 · F-41 · handwritten · tests/helpers/S2B-task-timeline-fixture.ts:599-631,699-715
- **动作：** convert：Run 发一条要回复的消息（等回复）→recordRunResult(yielded, continuation)→对这条消息正式回复→claimTask 带 consumedWait 续接→enter/end；转完删 seedRunRaw（:599-631）和 seedRun 的两个原始分支（:701-715）
- **覆盖/依据：** 保留 tests/work-graph/S2B-32-task-timeline-fold.test.ts:54-71 的 yielded→waiting_reply→下一次 running 断言；参照 tests/work-graph/K3-47-continuation-gate.test.ts:137-170 的真实 yield、回复、续接
- **核实理由：** 公开步骤都有：recordRunResult 可以带 continuation（S2C-L-runs-support.ts:184-203），claimTask 支持 consumedWait 续接（claim-service.ts:213、343-353），K3-47-continuation-gate.test.ts:137-170 就是真实的 yield、回复、续接。但续接要 consumedWait.responseRef（K3-47:115），中间必须有一条真实回复，原 action 漏了这步；只有 S2B-32:54-71 一个用例走这条路，加上回复步骤估计约 50 行。
- **涉及测试：** seedRunRaw; yielded/successor timeline setup
- 来源：Codex；核实：partly；规格行：是；估计行数：50
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：直接 recordRunResult(yielded) 违反 F3；见 t-items-TP.md:627、test-rule-sheet-v1.md:64。 改法：用真实脚本工具发送等待消息，由 startRun 产生 yielded，再正式回复并携带真实 consumedWait 续接；不直接写运行结果。

### TP-095 · F-42 · handwritten · tests/helpers/S2B-task-timeline-fixture.ts:634-646,781-787
- **动作：** merge-into:tests/work-graph/S2B-r2-s-preentry-control.test.ts::2B-32 fold order (a): public claim + pause + resume + entry read paused/pending/running；删 tests/work-graph/S2B-32-task-timeline-fold.test.ts:226-242、seedControlRaw（tests/helpers/S2B-task-timeline-fixture.ts:633-646）和 seedControl 的进入前分支（:783-786）
- **覆盖/依据：** tests/work-graph/S2B-r2-s-preentry-control.test.ts::2B-32 fold order (a): public claim + pause + resume + entry read paused/pending/running
- **核实理由：** 不用再转换：S2B-r2-s-preentry-control.test.ts:26-49 已经用 claimRun→submitNotEnteredControl→enterClaim 走同样的 09:00、09:10、09:20、09:30，期望的段落和 S2B-32:226-242 一字不差，两边都跑 memory 和 sqlite（S2B-32:33、r2:25），它的头注释 :9-10 也说旧用例只是补充。seedControl 的原始分支只有 S2B-32:233-234 用到（:80-81 在进入后，走真实路径），所以应该删重复，不是转换。
- **涉及测试：** seedControlRaw; 2B-32 fold order (a): a pause before entry -> paused, a resume -> pending, entry -> running
- 来源：Codex；核实：partly；规格行：是；估计行数：35

### TP-096 · F-07 · duplicate · tests/helpers/S2B-task-timeline-fixture.ts:259-404、425-544（对应 tests/helpers/S2B-track-fixture.ts:243-349、350-471）
- **动作：** merge-into:新的共享 S2B 进入辅助（enter 含续接简报、end、installStaticCompletionPolicy(policyId)），两个 fixture 都改用它
- **覆盖/依据：** 合并后由两份 fixture 共用；S1-archive-service-fixture 里同一段续接简报拼装可一并收
- **核实理由：** 逐行匹配数没错（我用 diff 量得 211 行相同、最长连续 9 行），但结论错：enter（S2B-task-timeline-fixture.ts:446-501 对 S2B-track-fixture.ts:373-433）、end（:520-543 对 :445-471）、installStaticCompletionPolicy（:293-319 对 :267-302）是同一段逻辑重新折行，差别只有报错文字、consumerId、policyId、返回值和读 project revision 的写法，属于语义重复。
- **涉及测试：** S2B 时间线与 track 两组测试
- 来源：DSH；核实：refuted；规格行：否；估计行数：110
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：拟合并 enter/end 修改 manifest/prepared 并手写运行事实，且新 helper 未定路径；见 S2B-task-timeline-fixture.ts:469、476、494。 改法：新建 S2B-runtime-steps-fixture.ts，共享真实 prepare/start、闸门、结束和公开策略安装；只接公开输入，只迁移 timeline/track，删除可选 S1 合并范围。

### TP-097 · F-27 · stale · tests/helpers/S2B-track-fixture.ts:836-851,880-881
- **动作：** delete：stripRoundKey（tests/helpers/S2B-track-fixture.ts:835-850）、:880-881、接口声明 :148-151，以及用例 tests/work-graph/S2B-30-track-bars.test.ts:188-207；生产 track-read-model.ts:769-781 的旧轮次计数（S2B_ROUND_BY_GOAL_LEGACY_LOOKUP 和无 finalizedAt 的定案计数）一起去，并由 lead 划掉 slice-2B-SPEC.md:781（2B-30 行）里对应的两句
- **覆盖/依据：** 行为已不存在（旧格式）：HANDOFF.md:565-566（79-1）；S2B-30-track-bars.test.ts:209 起的当前 gate 无负责人情形保留
- **核实理由：** stripRoundSince/stripRoundFinalizedAt 只有 S2B-30-track-bars.test.ts:198、202 在用；现写入方总是写 since 和 finalizedAt（evidence-service.ts:352-358、1605、1700-1702），是 79-1 的旧格式，删除方向对。但 2B-30 行（slice-2B-SPEC.md:781）明文要求这一条，要连同接口 :148-151、整个用例 :188-207 和生产 track-read-model.ts:771-779 一起去，原估 16 行偏少。
- **涉及测试：** stripRoundKey; 2B-30 legacy rounds without since and pre-2B finalized rounds without finalizedAt are only counted in unplaced.rounds
- 来源：Codex；核实：partly；规格行：是；估计行数：42

### TP-098 · F-22 · stale · tests/helpers/S2C-L-line-support.ts:466-477,710-712
- **动作：** delete（和生产里来历为 null 的旧 Session 处理一起删，lead 先改 2C-14、2C-18 规格行）：删 createLegacySession（S2C-L-line-support.ts:110、:466-477、:526）、D1 里的 L（:710-713）、S2C-lines-page.test.ts:394-421 这条旧 Session 用例；同时改 2C-14 的字面期望（S2C-lines-d1.test.ts:36-39 待命 6→5、已归档 partial→exact、:52、:57 行数 9→8、:63-66 置顶换别的线）和 tests/app/S2C-line-routes.test.ts:309-311
- **覆盖/依据：** 行为已不存在：HANDOFF 79-1；slice-2C-SPEC.md:1279、:1405 写明今天的写者造不出来历为 null 的 Session（session-directory.ts:717-722、:792 总写 provenance）。scope:'indexed' 另有 S2C-lines-page.test.ts:105、S2C-K2-query-not-entered.test.ts:73 覆盖。
- **核实理由：** 旧格式这点成立：建 Session 不给来历就写 new，旧形状只有旧 operation 才会产生（session-directory.ts:967-977）。但 L 也是冻结的 2C-14 数据集的一员（slice-2C-SPEC.md:1312：14 个 Session、待命 6、U=1），删 helper 就会改 2C-14 (1)(2) 的字面期望和路由测试，不止 12 行；而且生产里的 createLegacySessionProvenanceReader（create-platform.ts:806）还在，测试要和它一起删。
- **涉及测试：** createLegacySession; 2C-18 executions list only the indexed Work claims and QueryRuns on a legacy Session
- 来源：Codex；核实：partly；规格行：是；估计行数：55

### TP-099 · F-35 · handwritten · tests/helpers/S5-decision-fixture.ts:539-574
- **动作：** convert:治理部分改用 installCompletionPolicy+activateCompletionPolicy（project-bootstrap-service.ts:1137-1139）和 adoptInitialArchitecture（S5-goal-settings-support.ts:271-280、S5R2-c-support.ts 已这样做）；Project/Workspace@3 和 Goal@6 这个检查点保留为点名的例外，除非 lead 改 slice-5 规格 5.1
- **覆盖/依据：** 保留 Goal@7、Workspace@3 等冻结前提（slice-5-SPEC.md:934）；四份副本一起改。
- **核实理由：** 手写和三份副本都属实。但没有公开步骤能直接到这个检查点：registerWorkspace 写的是没有 decisionSettings 的 Workspace@1（project-bootstrap-service.ts:669），decisionSettings 只有 markNoticesSeen 能写，还要显示令牌（decision-settings-service.ts:5、:113）；Goal 要先到 @6、带好设置，只能靠凑出来的写入。规格 5.1 也允许“既有 fixture seed API 和真实 codec”（slice-5-SPEC.md:936）。
- **涉及测试：** openS5DecisionFixture bootstrap
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：45
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：规则表 A7 为空，条目却保留手写例外；Project 实际为 @1；见 S5-decision-fixture.ts:541、test-rule-sheet-v1.md:52。 改法：纠正为 Project@1、Workspace@3、采用前 Goal@6；治理公开转换，其余检查点标记 BLOCKED，待符合 v1 的逐步初始化及版本映射冻结后再施工。

### TP-100 · F-36 · handwritten · tests/helpers/S5-decision-fixture.ts:810-826
- **动作：** convert:proposePlan(requestRef)（照 tests/scenarios/support/S5-decisions.ts:360-375 已有的做法），四份副本一起改；CANDIDATE_U1/U2（S5-decision-fixture.ts:161-162）改成按真实 proposalId 用代码构造，手算的字面键 S2A-queue-bounds.test.ts:19、S2A-queue-goal-runs.test.ts:28（含 "proposalId":"U1"）重新手算
- **覆盖/依据：** 保留每个请求只有一个 head、来源和采用的行为；Q1/Q2 已是真实 submitQueryJob（S5-decision-fixture.ts:794-808）。
- **核实理由：** 公开步骤存在：proposePlan 收 requestRef（plan-service.ts:1479-1528），会核实是同一 Goal 下用户发起的根请求（:1332-1340），占位键和夹具一样（:2777 对 fixture:429）；手写的记录还少了今天写者都会写的 since:null（:1425）。但真实的 proposalId 是由 requestId 推出来的（:1520），不是 'U1'，所以常量、两处字面键、可能还有 U1/U2 的先后都要跟着改，17 行太少。
- **涉及测试：** U1/U2 candidate bootstrap
- 来源：Codex；核实：partly；规格行：是；估计行数：75

### TP-101 · F-37 · handwritten · tests/helpers/S5-decision-fixture.ts:828-910
- **动作：** convert:mailbox.sendUserMessage(workContext(f.runRA), decision_request)→decisions.answerDecision(f.ctx, accept)；夹具需带 duties 适配器（同 S5-user-message-support.ts:46-61）
- **覆盖/依据：** 保留消息卡、答复和应用行为；来源 pins 改为 sendUserMessage 实际捕获的 Goal B@7 + 对象 PLAN_B1@1、goalBases 只剩 Goal B，messageId 改为由 requestId 派生；转换后逐个复核依赖 f.messages 的 S5-decision-application、S5-decision-queue、S4C2-U3、WP2-context-extensions、S5R2-queue-history、K3-review-workflow-rows。副本随 F-15 至 F-17 收拢。
- **核实理由：** 公开步骤确实存在：S5-user-message-support.ts:96-107 已经在本夹具的 runRA 上用 sendUserMessage 发出决定请求，S5-decision-application.test.ts:47-50 用 answerDecision 答复它。但发出来的来源和手写的不同：sendUserMessage 只钉 Goal B 加对象里的 pins，goalBases 只有 [Goal B]（mailbox-service.ts:3468-3477），messageId 由 requestId 派生（:3401-3403）；手写的版本钉 A/B/C@7、U1@1、PB1@1，带三个 Goal 基础（S5-decision-fixture.ts:834-838，文件头 :17-24）。所以 covered_by 里“来源 pins 保留”做不到，要改。
- **涉及测试：** pending/answered decision message bootstrap
- 来源：Codex；核实：partly；规格行：是；估计行数：83
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：引用的 duties 实现是固定事实桩，workContext 调用参数也不匹配；见 S5-user-message-support.ts:35、53。 改法：使用 workContext(f, f.runRA)，duties 接同一世界的 createMessageDutiesFactsAdapter、真实 roles/sessions 和生产相同的 legacyDuty 匹配。

### TP-102 · F-34 · helper · tests/helpers/S5-decision-fixture.ts:168、171-172、199、265、351
- **动作：** delete:去掉 tests/helpers/S5-decision-fixture.ts:199 S5AllocationCounts、:265 S5GoalSeed、:351 sourceOf 的 export；:168-172 的转出口块删掉 S5_USER_MESSAGE_BY_GOAL、S5_DECISION_ANSWER_BY_SOURCE 和 :171、:172 两行（本文件 :81/:86/:87 已自行 import 供 :1026-1030 使用），但保留 S5_MESSAGE_BY_WORKSPACE_STATUS 的转出口（或把 S5R2-queue-history 改为从 src message-record-codecs 直接 import 后再删）
- **覆盖/依据：** S5AllocationCounts/S5GoalSeed/sourceOf 只在同文件内部用；被删的 4 个转出口名字没有测试从本 fixture import
- **核实理由：** “S5 系测试不 import 这 7 个名字”不对：tests/work-graph/S5R2-queue-history.test.ts:7 从 S5-decision-fixture 取 S5_MESSAGE_BY_WORKSPACE_STATUS 并在 :208 使用，删 :169 的转出口会断这个测试；另外 :168-172 是 `export { … } from` 转出口，不是本文件的本地声明，不能“去掉 export 关键字”，只能删行或删名字。三个本地名字（:199/:265/:351）其它文件 0 命中（tests/business/S4C2-U6.test.ts:32 的 sourceOf 是它自己的本地函数）。
- **涉及测试：** S5 系测试不 import 这 7 个名字
- 来源：DSH；核实：partly；规格行：否；估计行数：6
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：转出口处理有两种实现并牵涉 T1 消费者；见 t-items-TP.md:683、S5R2-queue-history.test.ts:7。 改法：固定保留 S5_MESSAGE_BY_WORKSPACE_STATUS 转出口，删除修改外部消费者的替代方案。

### TP-103 · F-15 · helper · tests/helpers/S5-goal-settings-support.ts:1-10,169-789
- **动作：** merge-into:tests/helpers/S5-decision-fixture.ts::openS5DecisionFixture（加选项：真实 M/N catalog 采用、pausedB）
- **覆盖/依据：** 保留 SS11/SS12/SS15 的暂停检查点（B@5→采用@6→暂停@7）和真实 catalog 前提；消费者 S5-goal-settings.test.ts:89、S5R2-settings-replay.test.ts:28 改调共用工厂；不删测试。
- **核实理由：** 复制属实：文件头 S5-goal-settings-support.ts:1-10 写明是复制品；和 S5-decision-fixture.ts:459-1060 逐行比对，只差约 65 行，就是真实 catalog（:103-113）和 pausedB（:115-139、:328-341）。行数估少了：:89-168 的 goalSnapshot、planDraft、candidate 等也是 S5-decision-fixture.ts:375-458 的私有副本，这个文件唯一的导出是 :169 的工厂，合并后整份 791 行都能删。
- **涉及测试：** openS5GoalSettingsFixture; SS11; SS12; SS15
- 来源：Codex；核实：partly；规格行：是；估计行数：790
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：两个工厂消费者不在 TP 白名单；见 S5-goal-settings.test.ts:89、S5R2-settings-replay.test.ts:28。 改法：纳入两个消费者，迁移 pausedB 和原工厂选项，保留暂停版本检查点及真实 catalog 前提。

### TP-104 · F-40 · handwritten · tests/helpers/S5-queue-support.ts:274-275,304-314
- **动作：** convert:createProjectBootstrapServices().projects.createProject/registerWorkspace（openUninitializedQueue :273-274）和 completionPolicies.installCompletionPolicy/activateCompletionPolicy（noticeWork :305-313）；先在 openUninitializedQueue 的 bundles 和 S5 夹具里登记 PROJECT_BOOTSTRAP_RECORD_SCHEMAS
- **覆盖/依据：** 保留 DQ03 的未初始化队列和 noticeWork 场景；Workspace 从手写的 @3 变成 registerWorkspace 的 @1，createGoal 的 expected 跟着改；不额外采用架构或计划。
- **核实理由：** 这些公开步骤都存在（project-bootstrap-service.ts:528、:601、:699、:812），R3e-evidence-fixture.ts:170-185 已经在同类夹具上用 install+activate。卡住它们的只是 S5 夹具没登记启动事件的 schema（S2A-notices-support.ts:146-151 有写），这个 bundle 只含事件（project-bootstrap-record-codecs.ts:425-429），补一行就行。DQ03（S5-decision-queue.test.ts:158-168）不依赖 Workspace@3。
- **涉及测试：** openUninitializedQueue; noticeWork; DQ03
- 来源：Codex；核实：confirmed；规格行：是；估计行数：13

### TP-105 · F-16 · helper · tests/helpers/S5R2-c-support.ts:1-9,206-828
- **动作：** merge-into:tests/helpers/S5-decision-fixture.ts::openS5DecisionFixture（与 F-15 共用选项，另加 requirementKind: static）
- **覆盖/依据：** 与 F-15 共用初始化；保留 static 前提（策略 :295，以及 planDraft 的校验要求 kind:'static' :151）和 :831-1081 的 C 组流程；消费者 S5R2-settings-replay.test.ts:28 和 S2B-r2-conflict-catalog.test.ts:40 改调共用工厂。
- **核实理由：** S5R2-c-support.ts:206-830 和 S5-goal-settings-support.ts:169-791 比对，只差工厂名和 :295 的 requirementKinds 'static'；:126-205 的辅助函数也是复制品，唯一的差别在 planDraft :151 的 static。整段 1-830 去掉 assembleS5R2C 还要用的 import 都能删，估计约 780 行，不是 650。
- **涉及测试：** openS5R2CompletionFixture; R2C08
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：780
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：两个直接消费者缺白名单；见 S5R2-settings-replay.test.ts:28、S2B-r2-conflict-catalog.test.ts:40。 改法：与 TP-103 同批迁移 replay 文件，completion 分支固定传 requirementKind: static，保留 C 组 driver。

### TP-106 · F-17 · helper · tests/helpers/S5R2-d-support.ts:1-7,236-841
- **动作：** merge-into:tests/helpers/S5-decision-fixture.ts::openS5DecisionFixture（加进入前追加 Role 工具的选项）
- **覆盖/依据：** 保留进入前授予 propose_future_plan/apply_future_plan 的差异，和 :844-952 的 driver；不改成进入后覆写授权；消费者 S5R2-agent-application.test.ts:24、S5R2-driver-safe-point.test.ts:15。
- **核实理由：** S5R2-d-support.ts:236-839 和 S5-decision-fixture.ts:459-1060 比对，实质差别只有 :192 的工具表多了两个工具（另外少了 review 透传和 lookupOrdered）；:155-235 的辅助函数也是 S5-decision-fixture.ts:375-458 的副本。1-843 去掉 driver 要用的 import 都能删，约 800 行，不是 550。
- **涉及测试：** openS5RuntimeFixture
- 来源：Codex；核实：partly；规格行：是；估计行数：800
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：实际工厂消费者缺白名单，driver-safe-point 不是该工厂调用方；见 S5R2-agent-application.test.ts:68、S5R2-driver-safe-point.test.ts:12。 改法：迁移 agent-application 工厂调用，保留 adviser duties 及进入前工具授权，纠正消费者清单。

### TP-107 · F-29 · handwritten · tests/helpers/task-claim-fixture.ts:198-234
- **动作：** convert:createProject→registerWorkspace→installCompletionPolicy→activateCompletionPolicy→adoptInitialArchitecture
- **覆盖/依据：** 保留全部 claim 行为及其版本前提；采用当前 catalog baseline；schema 列表需补 PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events 与 ARCHITECTURE_CATALOG_SCHEMAS（照 S1-workflow-archive-fixture.ts:272、277）
- **核实理由：** 所列公开步骤都在：project-bootstrap-service.ts:528/601/699/812，catalog-service.ts:454；S1-workflow-archive-fixture.ts:304-337 用同一组 id 走这些步骤，Project/Workspace 版本仍为 1（:335、:363），createProject 写的 ProjectSnapshot 与手写一致（project-bootstrap-service.ts:574、591）。手写的无 catalog 基线是旧格式（catalog-service.ts:414-420 读成 catalog:null，当前写入方 552 行总写 catalog），转换符合 79-1；消费者对游标的断言都是相对值，未见依赖手写种子的地方。
- **涉及测试：** createTaskClaimFixture scope/governance bootstrap
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：37

### TP-108 · A1-51 · handwritten · tests/helpers/task-claim-fixture.ts:199-233,408-420
- **动作：** convert:夹具 :199-233 的 Project/Workspace/policy/baseline 种子改用 createProjectBootstrapServices（createProject/registerWorkspace/completionPolicies.installCompletionPolicy/activateCompletionPolicy）加 architecture.adoptInitialArchitecture；seedRun :408-420 保留（没有公开步骤）
- **覆盖/依据：** src/core/work-graph/configuration/project-bootstrap-service.ts；src/core/work-graph/architecture/catalog-service.ts（adoptInitialArchitecture，路由 core-routes.ts:379）；用法见 R3e-completion.test.ts:172-204
- **核实理由：** Project/Workspace/policy 手写种子确有公开步骤（R3e-completion.test.ts:172-204），但 DSH 说 baseline 没有公开写入者是错的：catalog-service.ts:1-10 的 adoptInitialArchitecture 一次写 baseline 和 ProjectArchitectureBaselineActive，路由在 core-routes.ts:379；另外 seedRun（:408-420）只被 R4c-graph-history.test.ts:147 用来造同一 Session 的第二个 Run，注释 :139-145 写明认领流程造不出，不能转换。消费者也远不止列出的 6 个文件（约 40 个）。
- **涉及测试：** consumed by R4c-task-claim.test.ts, R4c-task-claim-boundaries.test.ts, R4c-task-claim-concurrency.test.ts, R4c-execution-read.test.ts, R4c-source-authority-reader.test.ts, R4c-execution-history-index.test.ts
- 来源：DSH；核实：partly；规格行：否；估计行数：35
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：seedRun 并非单一消费者，且不可达不构成保留例外；见 task-claim-fixture.ts:408、R4c-execution-history-index.test.ts:268、R4c-task-claim-concurrency.test.ts:63。 改法：初始化并入 TP-107；seedRun 部分标记 BLOCKED，列出全部实际调用点逐条冻结处置，TP-151 只核销其覆盖的两条。

### TP-109 · C02 · stale · tests/runtime/A2-reconcile-runtime.test.ts:['521-602']
- **动作：** delete
- **覆盖/依据：** 只为 D-7 之前的旧账本兼容（docs/refactor/HANDOFF.md:565-570），当前 writer 不产生这种状态：src/core/work-graph/tasks/control-service.ts:268-277（未进入的 Run 收到 pause/cancel/resume 当次应用）、src/core/work-graph/state/control-intent-machine.ts:490-494；RUN-16 在同一提交里结算排队的 pause/cancel（run-machine.ts:2266-2273）。生产里的 R 来源分支还在（run-machine.ts:1968 起的 onNotEnteredReconcile，run-reconcile.ts:533 的 W-04），纯状态行 tests/state/run-machine.test.ts:171-175 仍固定 RUN-09..11 (R)；要交 P 区一并处理，并给规格 W-04、CI-01、CI-02（docs/refactor/STATE-MACHINES-SPEC.md:4056,4140-4141）加 79-1 后注。当前行为由 tests/scenarios/A7-control.test.ts:110::D-7 与 A2-reconcile-runtime.test.ts:232::W-05 覆盖。
- **核实理由：** 测试自己写明当前 writer 不会留下这种状态（A2-reconcile-runtime.test.ts:521-525），控制服务和 RUN-16 的代码也证明了这一点，按 79-1 可以删。但“行为已不存在”说得不准：行为还在生产代码里，只是走不到；run-machine.ts:1971 的注释还说“Entering 时提交、后被 RUN-16 撤销”也是一个来源，这句已经过时（:2266-2273 在同一提交里结算）。
- **涉及测试：** seedPreD7Intent; A8-1d (W-04, CI-01, CI-02, CTL-08(a), RUN-09..11 (R)): a Run that never entered still holds a pre-D-7 queued intent at the restart; a cancel ends it and releases the claim, a pause is applied in place, a resume waits while the Goal is paused
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：82
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：未编号的生产交接漏掉 service 事件构造及白名单；见 run-reconcile-service.ts:1050、run-reconcile.ts:533。 改法：把 R 来源未进入控制结算、service 构造、状态矩阵、Runtime 分类及启动报告清理并入本项，只保留当前 W-16/W-19 路径。

### TP-110 · C35 · handwritten · tests/runtime/K3-35-workspace-baseline-prepare.test.ts:['84-117', '165-166']
- **动作：** convert:openK3ReviewCardWorld 上走公开 Session/claim（或 openRealRunHarness gitWorkspace + claimRun）→ 真实 createRunStateReader 和 createRoleConfigurationService（Host 配置带 builder hostTemplate）→ prepareExecution；同时去掉手造的 roleResolution 和随之不用的常量
- **覆盖/依据：** 原 tests/runtime/K3-35-workspace-baseline-prepare.test.ts:189 用例保留（2001 个文件和 too_many_changes 断言不变）；接线可照 tests/helpers/K3-35-continuation-fixture.ts:356-364（git 工作区）、:444-455（claimRun）、:480-486（runtime.port.prepareExecution 带 workspaceHost 基线），或 tests/runtime/K3-review-preparation.test.ts:76-122
- **核实理由：** 手写事实属实：:84-117 手造 Run/Outbox/Session/Attempt，:165-166 由替身直接返回这些对象和 :53-65 的手造 roleResolution。公开步骤今天就有（K3-35-continuation-fixture.ts:444-455 公开 claim，K3-review-preparation.test.ts:103-105 真实 reader）。行数估低了：roles 也换成真的以后，:53-65 和 :29-38 的常量也要删，再加上新增的 claim 步骤，大约 60 行。
- **涉及测试：** executionRecord; (%s) K3-35 (四) prepare succeeds and records an unavailable too_many_changes baseline for a >2000-change workspace
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：60
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：替换 execution/role 后仍使用返回手造 binding 的 assemblerDouble；见 K3-35-workspace-baseline-prepare.test.ts:119、185。 改法：一并删除 assemblerDouble，以真实 claim、reader、context assembler 和 Runtime prepare 在真实脏工作区验证 baseline capacity。

### TP-111 · C03 · stale · tests/runtime/R4b-session-skeleton.test.ts:['54-64']
- **动作：** delete，但只能和生产旧定位一起删（kernel-store-locator 的 legacyEntries/legacy/withLegacyReader、session-operations 的 legacy 分支、main.ts:153-158），并同步 slice-K-SPEC.md:107,183 和其它用到 legacyEntries 的测试；由 lead 定
- **覆盖/依据：** 仅旧数据兼容（79-1，HANDOFF.md:565-566），不是行为已不存在：当前写者不产生 legacy 映射（session-operations.ts:634-637 创建只认当前库），legacyEntries 只来自 Host 配置；生产路径仍在 kernel-store-locator.ts:14-31,107-136、session-operations.ts:788-816,912-916,1027-1063。当前库隔离保留 tests/runtime/R4b-session-skeleton.test.ts:66-81
- **核实理由：** R4b-session-skeleton.test.ts:54-64 是 legacy()/withLegacyReader 匹配规则唯一的直接断言（tests 里其它 .legacy(/withLegacyReader 只是 R4c-graph-history.test.ts:281-284 的转发），生产代码今天还在跑这条路，K 规格 slice-K-SPEC.md:107,183 也写着 legacy 读取器分支。所以“行为已不存在”不对；单删测试会让仍在的生产路径没人测，应作为 79-1 的生产清理一起做。
- **涉及测试：** requires an explicit trusted legacy locator and matching original Kernel Session ID
- 来源：Codex = DSH；核实：partly；规格行：否；估计行数：11

### TP-112 · C17 · tamper · tests/runtime/R4c-graph-history.test.ts:['897-904', '907-938']
- **动作：** delete：第一条只删 897-904（DELETE 块和它后面的 unavailable 断言），保留 867-895，测试名去掉 while still detecting a truncated source；第二条 907-938 整条删除；删除后 :20 的 DatabaseSync 导入没人用，一起删
- **覆盖/依据：** 截断后的 unavailable 走 session-operations.ts:495-497 的检查，同一检查已由同文件 :849-853（真实请求 throughPosition = tail+5）断言；第二条的前半段（带 range、limit 1 → ready、nextCursor 不为 null）与 :786-793 rejects a continuation position below the frozen range 的前半段相同；空终页的 :471-473 只有改库才能走到（AGENTS 第 4 条）
- **核实理由：** 两条的篡改块都是用 DatabaseSync DELETE 真实尾记录（:899-900、:931-932），只有改库才能造成。第二条去掉篡改后只剩 :921-925 的 limit 1 分页，:786-792 已经逐项断言过，留着只是一条换了名字的重复，所以按 Codex 整条删。DSH 的行号漏了篡改后的断言 :903-904、:935-937，估的 12 行也偏少。
- **涉及测试：** preserves an empty terminal page at the real upper cursor while still detecting a truncated source; rejects continuation after the frozen Session tail is truncated instead of shrinking its range
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：否；估计行数：43

### TP-113 · C19 · tamper · tests/runtime/R4c-source-authority-guards.test.ts:['264-304']
- **动作：** delete
- **覆盖/依据：** 不再要求此篡改专用行为：AGENTS.md:33。正常 starting/running 授权链保留同文件 321-394（按 C28 转换前提）。
- **核实理由：** 277-282 用 commitRaw 把只有 permissions、缺 runRef/attemptRef/roleBinding 的 envelope 写进 running Run；当前唯一写入点 entry_authorized（src/core/work-graph/state/run-machine.ts:869）之前，authorizeRuntimeEntry 用 preparedEnvelopeProblem（src/core/work-graph/tasks/execution-entry-service.ts:2001-2018）拒掉缺身份的 envelope，所以只有改库能走到 source-capture-access.ts:442-446 的检查。
- **涉及测试：** rejects unreadable consumed envelope identity from a real stored Run without throwing or file I/O
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：41

### TP-114 · C20 · tamper · tests/runtime/R4c-source-authority-guards.test.ts:['383-388']
- **动作：** delete
- **覆盖/依据：** 不再要求此数据库改写行为：AGENTS.md:33（没有运行中 Role 热切换）。read 授权缺失的静态拒绝仍由同文件 239 行（tools: [] → forbidden）覆盖。
- **核实理由：** 383-388 用 seedRun 把已接受的 envelope.permissions.tools 原地改成空；Run 的 envelope 只在 entry_authorized 写一次（run-machine.ts:869），重进入还要求 envelope 完全相同（run-machine.ts:1525-1527），没有公开步骤会改 running Run 的 envelope。删后测试名里的“revocation is fresh”要一起改掉，389 行的 events 断言留下。
- **涉及测试：** uses real SQLite facts through both readers: a starting claim is denied, a trusted running seed can read, and revocation is fresh（仅改写 envelope 的段落）
- 来源：Codex；核实：confirmed；规格行：否；估计行数：6

### TP-115 · C28 · handwritten · tests/runtime/R4c-source-authority-guards.test.ts:['98-126', '144-145', '358-376']
- **动作：** convert:claimTask → prepareExecution → ExecutionEntryPort.authorizeRuntimeEntry → beginRuntimeEntry → recordExecutionEntered（同 tests/helpers/B2-execution-fixture.ts:275-305 的 enter()，留在 running），只替换 358-376 的 commitRaw 种子；98-126/144-145 是喂给 fakeFacts 分支用例的桩输入，不是存储记录，不在转换范围
- **覆盖/依据：** 原合法授权用例保留；公开走到 running 的实例见 tests/helpers/B2-execution-fixture.ts:296-305（enter() 断言 status running）。
- **核实理由：** 358-376 手写 running Run，374-375 自己承认没走 entry，这一点成立；但 Codex 写的 startRun 会把整轮跑完、Run 变成 ended（tests/runtime/B2-runtime-execution.test.ts:212-221），之后读不到“running 可读”，应改用 ExecutionEntryPort 三步（src/core/work-graph/model/execution-entry-contracts.ts:109-121）。98-126/144-145 给 222-319 的 fakeFacts 分支用例（含 injected unavailable/unsupported）用，不属于手写记录。
- **涉及测试：** validEnvelope/runningRun/factsWithRun 的合法 Work 前提; uses real SQLite facts through both readers: a starting claim is denied, a trusted running seed can read, and revocation is fresh（正常 starting/running 部分）
- 来源：Codex = DSH；核实：partly；规格行：否；估计行数：25
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：指定的 B2 enter 三步正是规则表 F3 反例；见 t-items-TP.md:774、test-rule-sheet-v1.md:66。 改法：真实 prepare/startRun 后在模型依赖闸门挂起，在 running/entered 状态断言，finally 放闸并等待结束。

### TP-116 · C04 · stale · tests/runtime/S1-archive-files-brief.test.ts:['204-228', '248-253']
- **动作：** delete
- **覆盖/依据：** 旧数据义务已不存在：docs/refactor/HANDOFF.md:565-567（79-1），切片 1 规格 slice-1-SPEC.md:1025 的 IT04 行要加后注。现行的“没有 anomalies 就不加段、字节和 digest 不变”还在（src/core/agent-runtime/continuation-brief-assembly.ts:104-109、951；src/contracts/continuation-brief.ts:714-723），由 tests/runtime/K3-continuation-review-note.test.ts:321-327（无 anomalies 的 brief 逐字节等于金样）和 tests/runtime/K3-35-approved-methods-brief.test.ts:171（真实路径无 ### 异常锚点）覆盖。
- **核实理由：** IT04 用冻结的 S1 之前 manifest（207、248-253）证明旧字节不变，79-1 之后不需要保护旧数据，可以删；但 Codex 说“行为已不存在”不准：当前写入方在没有锚点时照样不写 anomalies（continuation-brief-assembly.ts:951），IT03 有锚点，覆盖不到这一点，应改指 K3 的两处测试。
- **涉及测试：** IT04 loading a frozen old manifest keeps the exact marker, digest and text with no new section; OLD_DIGEST/OLD_MARKER/OLD_TEXT/OLD_INPUT/OLD_MANIFEST_JSON
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：31

### TP-117 · C32 · handwritten · tests/runtime/source-binding-migration.test.ts:['78-109']
- **动作：** convert:claimTask → prepareExecution → startRun（脚本模型在闸门处挂起，让 Run 保持 running/entered）→ 用同一 records 上的 createSourceAuthorityReader 和 prepared.envelope 调 createRuntimeSourceCaptureFactory；126 的第二个工作区用 projects.registerWorkspace 建
- **覆盖/依据：** 原文件 112、126、152 的业务用例保留；公开流程实例 tests/runtime/B2-runtime-execution.test.ts:225-246，闸门做法见 tests/helpers/B2-401-world.ts:139-142，真实 reader 装配见 tests/helpers/B2-runtime-fixture.ts:288。
- **核实理由：** 83-97 确实把手造 envelope/running Run 放进 Map 当权威。但读取时每次都要求 Run 为 running 且无 outcome、授权阶段为 entered（src/core/agent-runtime/source-capture-access.ts:435-439），普通 startRun 返回时 Run 已结束，按原写法转换会全部变成 forbidden；必须加闸门，测试体也要在 finally 里放闸、等 Run 结束，行数多于 32。
- **涉及测试：** workFixture; binds one accepted Work Run to real source bytes and isolates caller mutations; refuses same-root workspace substitution and a changed registered root; closes the owned tools and honors Host and call cancellation
- 来源：Codex = DSH；核实：partly；规格行：否；估计行数：50
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：遗漏两个依赖 state.set 的 workFixture 消费者；见 source-binding-migration.test.ts:139、147、164、177、186。 改法：补列两个消费者并标记 BLOCKED，先冻结真实结束、真实 Reviewer 前提及不可达原地改写的逐断言处置，不保留第二套假权威。

### TP-118 · C33 · handwritten · tests/runtime/source-binding-migration.test.ts:['190-218']
- **动作：** stale+convert:这条钉的是旧的事件扫描回退（src/core/agent-runtime/source-capture-access.ts:667-726），生产不会走到；交 P 区删扫描分支，同时把业务行为（从原始提交取发起者、两次 open 只解析一次）改到 locator 路径：submitQueryJob → createSession → claimQuery → prepareQuery/startQuery，用计数包装的 readQuerySubmission 代替 scans
- **覆盖/依据：** 公开 locator 路径 tests/runtime/R5b-query-session-loop.test.ts:170-198（真实来源读取，但不断言发起者和单次解析）；232-235 的冲突提交半段同样只在扫描路径成立。
- **核实理由：** queryFixture 的权威有 events、没有 readQuerySubmission，Job 也没有 submission（201-203），所以 221-230 走的是扫描回退。生产权威是 createSourceAuthorityReader（create-platform.ts:1039、1218），它没有 events（source-authority-reader.ts:21、152-250），正式提交总会写 submission（query-job-service.ts:731，状态推进用展开保留 query-run-recovery.ts:562），生产总走 646 的 locator 分支。真实 reader 不扫描，原建议「包装真实 reader 统计扫描次数」做不到。
- **涉及测试：** queryFixture; resolves Query source authority from the original submission with one shared history scan
- 来源：Codex；核实：partly；规格行：否；估计行数：40
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：完成后的 Query 不满足 running 条件，另一个消费者仍改历史和 execution；见 source-capture-access.ts:599、611、source-binding-migration.test.ts:232、238。 改法：真实 Query 在 A3 闸门保持 running，计数包装 readQuerySubmission；第二条测试标记 BLOCKED，先冻结两段篡改场景处置。

### TP-119 · C39 · stale · tests/runtime/source-tool-lifecycle.test.ts:['226-258', '304-322']
- **动作：** delete 226-258，但要和生产区删除 legacy_live 模式（exploration-tools.ts:77、:113-120、:177 的 project_index 和 ProjectSourceIndex 构造；observed-model-run.ts:79-88、:327）作为同一项来做，不能只删测试；删之前先在 frozen 模式补上 close 调两次只释放一次、PythonSourceIndex.dispose 抛错仍报错且 close 幂等这两点；304-322 的搜索前缀用例跟模式无关，改成 frozen 模式，不删
- **覆盖/依据：** 行为在 src 里还在，只是生产走不到：两个生产调用方只在 hasFileRead 时建 sourceFactory，授权不 ready 就提前返回（execution-driver.ts:1127-1153、:1243；query-execution.ts:320-357、:542），runObservedModel 只在 hasRead 时建探查工具（observed-model-run.ts:272-274、:304、:323-327），allowedTools 就是 builtinTools，所以生产始终是 frozen。:117 没有覆盖 close 幂等，也没有覆盖释放失败
- **核实理由：** Codex 说没有证明调用方都已迁出，这条不成立：runObservedModel 的生产调用只有 execution-driver.ts:1217 和 query-execution.ts:509，createExplorationTools 只有 observed-model-run.ts:323，只要有 read 就必然是 frozen，legacy_live 只有测试走得到（这也回应了 dsh-long-context-review-2026-09-27.md:46 当时要求先核的 sourceFactory 缺省条件）。但 DSH 写的被谁覆盖不对：行为在 src 里还在（exploration-tools.ts:113-120），:117 也没有调两次 close，没有测释放失败，所以要和生产删除一起做，并且先在 frozen 模式补上这两点。
- **涉及测试：** closes legacy language services once and refuses new handlers after the tool group closes; reports actual index disposal failure, attempts the other index and keeps close idempotent; classifies a file used as search prefix and still searches it through explicit paths
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：否；估计行数：33

### TP-120 · B-03 · duplicate · tests/scenarios/K-W-workflow-close.test.ts:259-285
- **动作：** merge-into:tests/scenarios/K-W-workflow-close.test.ts::KA-11 (c)（并入 KA-09 的 claim_task 断言；名字保留 KA-09 flow half 和 KA-11(c) 两个映射）
- **覆盖/依据：** tests/scenarios/K-W-workflow-close.test.ts:287-312::KA-11 (c)；简报一半在 tests/scenarios/K-R-interrupted-brief.test.ts:138-162
- **核实理由：** K-W-workflow-close.test.ts:259-285 和 287-312 步骤相同（继续、停在 claim_task 前、重启、停在 start 前，不再 close、不建 Session、原 Session 新 Run）；KA-09 多的只有 270 行 resumeOnStartup:false 和 277 行 claim_task 断言。这次是人点继续后的重排，不是待定的自动判定，startup-reconcile.ts:623-627 不会把它选进启动重推，所以这个开关在这里不改结果。规格 slice-K-SPEC.md:433 里 KA-09 的“重启一次，结果相同”说的是接续说明，已由 K-R-interrupted-brief.test.ts:138 覆盖。
- **涉及测试：** KA-09 flow half (KE3, L6/L7)
- 来源：Codex；核实：confirmed；规格行：是；估计行数：27

### TP-121 · B-04 · duplicate · tests/scenarios/K-W-workflow-close.test.ts:233-257
- **动作：** merge-into:tests/scenarios/WP1-wiring.test.ts::SC01 (closing supported; KA-07)（把 K-W-workflow-close.test.ts::KA-07 并入；须带上 K-W:238 继续前 kernel_turn_open 和 K-W:253 领取后被新 Run 占用，后者要在 WP1 加一个 start 前停点）
- **覆盖/依据：** tests/scenarios/WP1-wiring.test.ts::SC01 (closing supported; KA-07)
- **核实理由：** DSH 的并排对照不成立：A8-host-restart-paused.test.ts:791/819 只是 driveChecked 和 Session 断言，A8 LA-1 不断言 close_open_turn 回执、无 create_session/transfer/archive、Task satisfied、无异常锚和归档标签（WP1:58-60,65,77-78），且走的是 r2 取消、r3 接续、historySource 沿用的另一条流程（A8:797-831）。Codex 的配对属实：K-W:242-252 与 WP1:56-60,69-70 断言相同，K-W 多出的只有 :238 和 :253（规格 slice-K-SPEC.md:431“领取后被新 Run 占用”），合并时须保留。
- **涉及测试：** KA-07 (KE3, L4/L7)
- 来源：冲突裁定（采用 codex）；核实：refuted；规格行：是；估计行数：25
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：现有 advanceToEnd 没有 start 前停点，所需 helper 属于 T3；见 WP1-scenario-fixture.ts:119、297。 改法：新增领取后 start 前停点并继续汇总同一 trace，保留中间及最终断言；helper 统一划归 TP。

### TP-122 · B-01 · stale · tests/scenarios/S2C-K-legacy-provenance.test.ts:1-514
- **动作：** delete，但要和生产端的旧来历兼容代码同一批删（session-directory.ts 的 backfillSessionProvenance、work-line-reader.ts:284 的 readLegacyUnchecked、line-status.ts:444-447 的 provenance_unchecked 标记、维护里的补来历），交 P 区一起定；其他旧 Session 用例（S1-provenance、2C-14/16/18/21 的旧 Session 变体）同批处理
- **覆盖/依据：** 行为只是旧格式兼容：决定 79-1（HANDOFF.md:565-570）；今天的写者总写来历（session-directory.ts:716-723,792），规格自认造不出（slice-2C-SPEC.md:1279,1405）
- **核实理由：** 核实属实：session-directory.ts:792 建 Session 总写 provenance，来历为 null 和没有 executionState 的 QueryRun 只能经存储边界手写（本文件 131-168、484-490；规格 1279、1405），是 79-1 要去掉的旧格式。但 2C-26 是规格行，生产端的补来历和 legacyUnchecked 计数今天还在（work-line-reader.ts:284、line-status.ts:444-447），只删测试会让这段还在的代码失去端到端覆盖，应和生产代码一起删。
- **涉及测试：** 2C-26 before maintenance: seven unchecked; 2C-26 after one maintenance pass C joins P; 2C-26 the executions section stays indexed
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：514
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：整删与 TP-007 保留 indexed 场景冲突，pending 无 executionState Query 不是旧格式；见 t-items-TP.md:47、1105、S2C-K-legacy-provenance.test.ts:482。 改法：删除旧来历场景，保留 indexed 场景并用当前 Session、真实 Work claim、公开 submit 后未领取的 Query 重建；同步统一 TP-007/063 及 S1-provenance 的范围和文件所有权。

### TP-123 · B-09 · handwritten · tests/scenarios/S3-context-and-inputs.test.ts:197-213;309-316
- **动作：** convert:platform.workflow.advanceWork 先跑 tA 到 open_checks 前停（Run 结束为 completed）-> 用 tA 的真实 RunRef 调 materials.storeArtifact；计划仍是一次 revision：按内容地址事先算出 old-A 的 ArtifactRef 再 propose（plan-validation.ts:154-156 不查可用性），不要另建第二张图；同时给 tA 加一条脚本回复、把 history 调用的 runRef 改成运行后补上、按实际情况改 Session 数基线
- **覆盖/依据：** tests/scenarios/S3-context-and-inputs.test.ts:345-406::SC01（业务断言保留，只换前置事实的造法）
- **核实理由：** 手写属实：197-213 直接 INSERT 到 ledger.sqlite 的 snapshots 表造一个没有 claim/attempt 的 completed Run；公开步骤今天存在（advanceWork 内做 claim/prepare/start，material-service.ts:141-154 对 work_run 只查 Run 存在与工作区）。但 Codex 写的“先跑 tA 再建立消费 old-A 的图”顺序不通（跑 tA 需要计划先在），规格 §5.1 要求计划只有 revision 1（slice-3-SPEC.md 5.1 段）；另外脚本回复第 349 行写死 RUN_A、tA 要消耗回复、404 行 Session 数可能变，25 行偏少。
- **涉及测试：** SC01: the real claim, prepare and start assemble the declared legacy input, and a repeated prepare keeps the original manifest
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：40

### TP-124 · B-11 · handwritten · tests/scenarios/support/S5-decisions.ts:571-590
- **动作：** convert:runtime.prepareExecution（只替换 S5-decisions.ts:571-590 手拼的 manifest、bodies.put 和 PreparedTaskExecution：辅助 composition 要带授予 requeue_task 的 ag2bWorkRuntime，并让 551-560 的 authorizeConfiguration 对上准备出的 Host 配置；authorize/begin/entered/recordRunResult 的 owner 调用保留）
- **覆盖/依据：** tests/scenarios/S5-goal-conflict-rework.test.ts::SC02 two Goals conflicting on module M（:113-123 agent requeue 断言保留）
- **核实理由：** DSH 的转换没有公开步骤：Workflow 的 requeue_task perform 是自动化写入（workflow.ts:346 automaticGraphWrite，A4-duplicate-receipts.test.ts:229-231 requestedBy WORKFLOW_AUTOMATION_ACTOR），SC02 要的是 requestedBy agent（S5-goal-conflict-rework.test.ts:115,182），而 Agent 调 requeue_task 在 startRun 被拒（GAP-46，C2-runtime-platform-tools.test.ts:234-247）。Codex 的部分转换可行：同一测试 :240-241 证明授予这两个工具名时 prepareExecution 返回 ready；h.direct() 不带 Runtime（harness.ts:1159-1162），openComposition 未导出（harness.ts:840），所以行数比 20 多。
- **涉及测试：** s5AgentRequeue，服务 S5-goal-conflict-rework 的 SC02
- 来源：冲突裁定（采用 codex）；核实：refuted；规格行：否；估计行数：30
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：明确保留手写 entered/result owner 调用，违反 F3；见 t-items-TP.md:837。 改法：agentRequeue 转换标记 BLOCKED，先冻结真实 Runtime 脚本调用 requeue 工具的完整路径，不只替换 prepare。

### TP-125 · B-13 · helper · tests/scenarios/support/S5-decisions.ts:384-394
- **动作：** delete
- **覆盖/依据：** tests/work-graph/S5-request-candidates.test.ts:201::RC06 abandon replays the original result and releases Q2 for a new first candidate（只删没人用的包装函数）
- **核实理由：** 全仓库检索 abandonCandidate 只命中 S5-decisions.ts:385 的声明，无导入无调用；删掉后它用的 PlanProposal 与 s5GoalPin 在同文件 289-315、620 还有别的使用，不会留下未用导入。RC06 在 S5-request-candidates.test.ts:201 存在。
- **涉及测试：** abandonCandidate
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：11

### TP-126 · D-03 · stale · tests/state/S1-dispatch.test.ts:['173-185']
- **动作：** delete
- **覆盖/依据：** 行为已不存在：docs/refactor/HANDOFF.md:566（79-1）；当前 readonly_copy 拒绝由 tests/state/S1-dispatch.test.ts:103-107::UT26 和 :166-170::UT47 覆盖
- **核实理由：** UT52/UT53（slice-1-SPEC.md:942-943）测的是 provenance 为 null 时回退到 legacyProvenance（session-availability.ts:501-505）；null 只来自“slice 1 之前写的记录”（contracts/core/session.ts:53-54），当前创建路径总在操作里写 provenance（session-directory.ts:716-723、792），再复制进 Session（970-977），createSessionRecord 只有这一个调用者，所以只剩旧格式兼容。生产端 legacyProvenance 读取（session-provenance-facts.ts:95 起、claim-service.ts:731-775、query-execution.ts:933-946）应交 P 区一并清理。
- **涉及测试：** UT52 a null record provenance with a trusted readonly_copy legacy provenance is forbidden for Work; UT53 a null record provenance with no legacy provenance is incomplete, never treated as new
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：13

### TP-127 · D-13 · duplicate · tests/state/S1-dispatch.test.ts:115-119
- **动作：** merge-into:tests/state/S1-dispatch.test.ts::UT27 a Session waiting on m refuses ordinary Work as busy with no effects
- **覆盖/依据：** tests/state/S1-dispatch.test.ts::UT27（:109-113）
- **核实理由：** dispatchFacts 默认 consumedWait:null（S1-dispatch.test.ts:70-72），UT28（:115-119）显式再传 consumedWait:null，与 UT27 输入完全相同、同一个 busy 断言，UT27 还多查 occupancy；SessionDispatchGuardV1 没有“已回答未消费”的字段，spec 行 slice-1-SPEC.md:918 的区别在这一层不存在。
- **涉及测试：** UT28 a stored response on m that is not yet consumed is still a wait, not idle
- 来源：DSH；核实：confirmed；规格行：是；估计行数：5

### TP-128 · D-11 · stale · tests/state/WP1-goal-content.test.ts:107-119
- **动作：** 删 CG04 的 (a)(b) 两条断言（tests/state/WP1-goal-content.test.ts:108-113），(c) 先留，等生产收紧“缺少本 Goal 来源”时再定；同批看 tests/work-graph/WP1-goal-content-entry.test.ts:79-85 GE03（digest:null 也是旧 manifest）
- **覆盖/依据：** 行为已不存在：决定 79-1；wiring-1-SPEC.md:25 L2“digest 为 null、或没有这条来源、或没有绑定的旧 manifest，照旧通过（兼容已准备好的旧 manifest）”
- **核实理由：** binding:undefined 是旧格式成立（同 D-10），但 DSH 说 digest:null 是当前语义不对：context-input.ts:381-382 和 wiring-1-SPEC.md:25 都写明 null 摘要是旧 manifest，当前装配器总给本 Goal 的 record 来源填字符串摘要（context-assembler.ts:1919-1923，来源由 graph-context-reader.ts:1015 恒放入），所以 (b) 也只为旧格式；(c)“只有别的 Goal 来源”在 L2 里同属“没有这条来源”，但还带着 goalId 过滤，先不删。
- **涉及测试：** CG04 a missing binding, a null digest and another Goal all pass（仅 :108-110 的 binding:undefined 断言）
- 来源：DSH；核实：partly；规格行：是；估计行数：6

### TP-129 · D-05 · stale · tests/state/attempt-machine.test.ts:['699-700']
- **动作：** delete
- **覆盖/依据：** 行为已不存在（只为旧数据）：docs/refactor/HANDOFF.md:566；当前 ended_known/ended_unknown 投影仍由 tests/state/attempt-machine.test.ts:697-698 断言。
- **核实理由：** 现在把 Attempt 写成 ended 的只有 endedAttemptRecord/endedFromClaimedRecord（attempt-machine.ts:310-321），endOutcome 的类型是非空 RunOutcome（:162）；注释 :75-77 也说没有 endOutcome 的 ended 行是旧行。attempt-machine.test.ts:699-700 只固定这种旧行，删这两行就够了。
- **涉及测试：** project the nodes of §5.1
- 来源：Codex；核实：confirmed；规格行：是；估计行数：2

### TP-130 · D-10 · stale · tests/state/context-input.test.ts:98-102
- **动作：** delete（同批去掉生产里的无绑定放行：context-input.ts:225，及 execution-entry-service.ts:1065、query-execution.ts:1079 的 undefined 分支，prepared-execution.ts:205/271 的 contextAssembly 改必填）
- **覆盖/依据：** 行为已不存在：决定 79-1；prepared-execution.ts:202-204 自述“Absent means a legacy_unversioned input”；slice-3-SPEC.md:646
- **核实理由：** 当前两个 manifest 写入方都从装配器拿绑定（execution-preparation.ts:498/533、query-preparation.ts:332/359），而 AssembledContextV1.binding 是必填（context-assembler.ts:123），所以现在写出的 manifest 都带绑定；context-input.ts:225 的 binding===undefined 只服务旧 manifest，tests 里只有 context-input.test.ts:101 和 WP1-goal-content.test.ts:109 走到它。ST01 实占 :99-103 五行。
- **涉及测试：** ST01 no binding keeps the legacy input and reports no problem
- 来源：DSH；核实：confirmed；规格行：是；估计行数：5
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：必改的 Query 准入文件缺白名单；见 query-execution.ts:1072、1079。 改法：纳入 Query 准入文件，与 TP-009/054/164 同批收紧 contextAssembly。

### TP-131 · D-12 · stale · tests/state/goal-machine.test.ts:['1347-1369']
- **动作：** delete
- **覆盖/依据：** 行为已不存在（只为旧数据）：docs/refactor/HANDOFF.md:566；STATE-MACHINES-SPEC.md:2846、:3048、:5214 写明 PASS 带 gaps 是 VD-4 之前的遗留行。当前的 clean PASS 显示看 tests/state/goal-machine.test.ts:1371-1384，PASS⇒无缺口看 tests/state/verification-machine.test.ts:901-905。
- **核实理由：** 轮次只在 buildFinalizedRound 里定结论（verification-machine.ts:1594，结果取自折叠），折叠在 :882 保证有缺口时不会给 PASS，src 里也没有别处写 outcome:'PASS'。所以 goal-machine.test.ts:1347-1369 的“带缺口的 PASS”只能是旧数据。非 PASS 链头的 GV-5/GV-10 另有 :1312-1345 覆盖。
- **涉及测试：** a legacy PASS with gaps is not a clean PASS (VD-4): never gate_verifying; GV-5 or GV-10 as for a non-PASS head
- 来源：Codex；核实：confirmed；规格行：是；估计行数：23

### TP-132 · D-07 · stale · tests/state/plan-machine.test.ts:['112-117', '335', '379-388', '588', '829', '1011']
- **动作：** delete（和生产里的 legacy_v1 分支一起删：plan-record-codecs.ts:5-10、:803-816、:1003-1019，plan-machine.ts:105-112、:1250、:1623、:1709）
- **覆盖/依据：** 旧 patch proposal 兼容要求取消：docs/refactor/HANDOFF.md:566。保留 tests/state/plan-machine.test.ts:336 起的当前状态矩阵及 :498-501::accepts a schema 1 draft (initial plans may be schema 1 or 2)。
- **核实理由：** 当前写入方只有 encodePlanProposal 的几个调用方（plan-service.ts:1424-1425、:2461、:3355-3356，plan-commit-compiler.ts:248、:439），写的都是 candidate_v2；src 里没有任何地方构造 PlanProposalSnapshot@1 的正文，legacy_v1 只来自 plan-record-codecs.ts:1003 对旧正文的解码。LEGACY 在测试文件里只用在 :113、:335、:386、:588、:829、:1011，和这条发现列的一致；498-501 的 schema 1 草稿是另一回事，应当保留。
- **涉及测试：** Every (state, event) pair 中的 legacy_v1; other content keeps today's create CAS result: a legacy record; reads the state after the Agent pre-checks: legacy, not pending and old revisions keep their codes; legacy on an older plan
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：21
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：保留 schema 1 draft 与 TP-050 冲突，LegacyPlanProposal 转出口缺范围；见 plan-machine.test.ts:498、model/plan-contracts.ts:33。 改法：把 schema 1 draft 测试明确归 TP-050 删除，保留 schema 2 矩阵；同步删除 LegacyPlanProposal 转出口。

### TP-133 · D-06 · stale · tests/state/run-machine.test.ts:['444-455', '818-824', '1012-1020', '1401', '1411', '1651-1654']
- **动作：** delete（和生产里的 legacyV1 一起删：run-machine.ts:81、:167、:1177、:1456、:2199，以及 dispatch.ts:112-116 的 V1 类型）；范围补上 tests/state/run-machine.test.ts:594-595、:638-640、:721-722、:755、:801-802、:807、:944-947、:979（v1 helper）、:1714-1715；:433-436、:483 对 legacyV1 字段的断言随字段一起改。
- **覆盖/依据：** 旧授权格式要求已取消：docs/refactor/HANDOFF.md:566。当前 V2 写入保留在 tests/state/run-machine.test.ts:570::writes the V2 binding at gen 1 rev 1 in execution-entry-service.ts key order；451-452（D-7）、1015 的 [EV.begin, CLAIMED]、1655 的 CLAIMED 和 1412 起的 Host lease/probe 守卫保留。
- **核实理由：** 核心属实：当前只在 enteredRunRecord 里写 running，而且一定带 V2 授权（run-machine.ts:884-887），授权写入方也只写 schemaVersion 2（:862-869），V1 和 pre-B2 的 running Run 只会出现在旧数据里；'quarantined' 只是 V1 的阶段（dispatch.ts:115，V2 见 :131）。但同一文件里还有不少 V1/pre-B2 样本没列进去（:594、:638-640、:721、:755、:801-807、:944-947、:1714），行数要从 32 改成大约 50。
- **涉及测试：** reads V1 and pre-B2 authorizations as legacy history, not damage; keeps the slot self → self for an existing locator without a held V2 begin binding (execution-history-binding.ts:152-154); refuses a V1 or pre-B2 Run with the one text of a Run without a V2 binding; reconcile_*: legacy, Host lease, probe, then the row; entryV2Binding 的 V1/pre-B2 子例
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：50

### TP-134 · D-27 · tamper · tests/state/run-machine.test.ts:852-855, 1022-1031
- **动作：** delete（run-machine.test.ts:852-855 和整条 it 'reads a fresh entry by status, then the V2 phase, also outside the eight states' :1022-1036）
- **覆盖/依据：** 行为已不存在：AGENTS 第 4 条、决定 79-4；写入方 run-machine.ts:884-887、899-902、996-1003、943-947 每次都同时改 status 和 phase/outcome
- **核实理由：** :853 的 startPosition:0 过不了 Run 解码 record-readers.ts:202-204（isRunExecutionHistoryV1 要求正整数，execution-history-codecs.ts:91），run-machine.ts:1261 连改库都到不了；:1022-1030 的 starting+entered/unknown/settled 只能改库造出（解码 record-readers.ts:186-277 不交叉核对 status 与 phase，写入方 run-machine.ts:886、901、1002 总是同时把 status 改成 running/ended）。但同一个 it 后半 :1031-1035 的 starting+outcome:'crashed'、running+authorized 也是写入方造不出的组合，只删 :1022-1031 会留下没有标题的断言，应整条 it 一起删，合计约 19 行。
- **涉及测试：** refuses a moved identity, a backwards watermark, a changed end and a foreign mapping（malformed 段）；reads a fresh entry by status, then the V2 phase, also outside the eight states
- 来源：DSH；核实：partly；规格行：否；估计行数：19

### TP-135 · D-02 · stale · tests/state/session-availability.test.ts:['194', '321-333', '383']
- **动作：** delete（和生产里的 legacy_provenance_backfilled 一起删：session-availability.ts:135、:485-487、:614-615、:1003-1020，session-maintenance.ts:368-381，dispatch 判定里的 facts.legacyProvenance :501）；同时把矩阵基础状态 tests/state/session-availability.test.ts:80 的 `provenance: null` 改成当前的 {new}，去掉 :181 的 legacyProvenance 和 :176 的 provenanceBasisValid。
- **覆盖/依据：** 旧回填要求已取消：docs/refactor/HANDOFF.md:566。当前创建行为保留在 tests/state/session-availability.test.ts:407::SES-01 session_created。
- **核实理由：** 核心属实：当前创建 Session 的操作总会写入 provenance（session-directory.ts:716-722、:792），所以只有旧数据会出现 provenance 为空、要靠回填的 Session。但 :383 的 `Record<SessionEvent['kind'], true>` 要求列全事件种类，生产上的事件不删，测试就过不了类型检查；而且矩阵基础状态（:80）和派发判定的夹具（:181）本身也是旧的空 provenance 形状，要一起改。
- **涉及测试：** transitionSession: every (state, event) combination
- 来源：Codex；核实：partly；规格行：是；估计行数：18
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：删除 guard 字段未覆盖类型及生产构造方、跨组测试；见 session-availability.ts:120、126、session-lifecycle.ts:969、query-execution.ts:933。 改法：同步删除 provenanceBasisValid、legacyProvenance 的类型和全部构造/读取，与来历清理链及 T1-035/T2-057 统一归属后落地。

### TP-136 · D-13 · stale · tests/state/task-failure.test.ts:['384-385']
- **动作：** delete（和生产里 isFinalizedNonPass 的 `gaps.length > 0` 旧分支一起删，verification-machine.ts:104-106）；范围补上同一文件的 PASS_GAPS 夹具 :181、sweep 那一项 :450、AV-7d 那一行 :859、GV-10 那一行 :1030。
- **覆盖/依据：** 旧 PASS 兼容要求取消：docs/refactor/HANDOFF.md:566。tests/state/task-failure.test.ts:382-383::FC-16 INCONCLUSIVE head 保留当前 check_incomplete 分类；当前生成规则见 tests/state/verification-machine.test.ts:901-906::VD-4。
- **核实理由：** 核心属实：finalizeRoundOutcome 只有在 gaps 为空时才得出 PASS（verification-machine.ts:882），当前不会写出带 gaps 的 PASS。但 PASS_GAPS 在同一文件里还用在 :450、:859、:1030，只删 :384-385 清不干净，行数要从 2 改成大约 6。
- **涉及测试：** FC-16 legacy PASS with gaps
- 来源：Codex；核实：partly；规格行：是；估计行数：6

### TP-137 · D-10 · stale · tests/state/verification-machine.test.ts:['852-854', '879-882', '1094', '1111-1114', '1150', '1153-1154', '1170-1172', '1207', '1241-1242']
- **动作：** delete 所列各行；另外删掉 FINAL_PASS_GAPS 的定义（148-150）和全表的 final_pass_gaps 列（234；297、302 两格；round_opened、round_finalized 两行各少一格），finished 助手（1159-1160）去掉 null 分支。无槽位旧根要么另起一项，把基础夹具 OPEN_PENDING（131）改成带 chain 的 OPENED，同时去掉 516、1066、1101-1107 的旧根断言和表格 300-302 的 null→null；要么只删 1241-1242，并记下其余仍在测旧形状。同步 STATE-MACHINES-SPEC.md:3009-3011（VR-09/VR-11/VR-14 的“遗留”字样）和 :3727 I-13，和生产侧删旧分支（verification-machine.ts:99-106、:731、:828、:1394）一起做。
- **覆盖/依据：** 行为已不存在：docs/refactor/HANDOFF.md:566（79-1）。当前形状仍由 tests/state/verification-machine.test.ts:845-851（VR-10/11 索引 CAS）、:875-878（带原因的中断）、:901-905（VD-4，PASS ⇒ 无 gaps）、:1233-1240（带 chain 的槽位守卫）覆盖。
- **核实理由：** 核心成立：当前写入方不会写出这些形状。索引只经 nextTaskEvidenceIndex 写，k=0 不写、k≥1 时 revision≥1（verification-machine.ts:1055-1059，evidence-service.ts:371）；中断和 INCONCLUSIVE 都带原因（verification-machine.ts:420-425、942、1647）；折叠只在没有 gaps 时给 PASS（:882）；新开轮次都带 chain（:920）。但清理不全：FINAL_PASS_GAPS 还是全状态表的一列（test:234、297、302），定义在 148-150；无槽位旧根是全文件的基础夹具（test:131，FINAL_FAIL 等都由它派生），表格 300-302 仍断言 null→null，所以只删 1241-1242 并没有去掉对旧形状的覆盖。
- **涉及测试：** nextTaskEvidenceIndex: CAS by row existence (VR-10/11), nothing written for zero ids (VR-12); refuses an executing check; an interrupted check is the gap interrupted_check; refuses a predecessor that is not a finalized non-PASS head; a legacy PASS with gaps may have a successor; reverifyFailureClass and isFinalizedNonPass; reverifyExemption (§13.7 point 3); maps the chain head; VR-09 claims a chained head slot with the same owner, so a successor committed after the read loses the race
- 来源：Codex；核实：partly；规格行：是；估计行数：30
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：两套旧根处理互斥，整段删除会丢当前有效断言；见 verification-machine.test.ts:131、1101、1102、1104。 改法：固定补当前 root chain 并更新派生夹具及槽期望，保留空集合、链排序、当前根和当前分类断言，只删除旧数据项及旧格式断言。

### TP-138 · A1-02 · stale · tests/work-graph/A2-step1-codecs.test.ts:380-385
- **动作：** delete 380-385；同时把 legacyRound（359-361）改成带 rootChain 的当前根（检查照旧不带 incompleteCause），395-414 改名保留
- **覆盖/依据：** 无 chain 是旧格式（79-1；buildOpenedRound 总写 chain，verification-machine.ts:920）；当前根/后继往返在同文件 387-393；改造后的 395-414 继续覆盖“检查不带 incompleteCause”的当前形状
- **核实理由：** 缺 chain 确实只出现在旧记录里，但检查不带 incompleteCause 是当前写者的正常形状：pending 检查不写这个字段（verification-machine.ts:899-900），PASS/FAIL 时它为 null 也省略不写（:1623），所以“两者都是旧格式”这个判断只对一半。395-414 仍用无 chain 的 legacyRound（:360、397），生产去掉无 chain 的读法后会失败，必须一起改；改动行数要算进去。
- **涉及测试：** a legacy round (no chain, no incompleteCause) still decodes unchanged
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：9
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：与 TP-045 删除 legacyRound helper 的指令冲突；见 t-items-TP.md:289、935、A2-step1-codecs.test.ts:397。 改法：将 helper 改名并补 rootChain，保留缺可选 incompleteCause 的当前测试，同步改 TP-045 为引用本条。

### TP-139 · A1-30 · handwritten · tests/work-graph/A2-step1-codecs.test.ts:592-617
- **动作：** convert：在 tests/work-graph/A2-goal-control.test.ts:99-134 里用 createGoal（夹具）→ setGoalControl(pause) → 用 hostContext 换另一个操作者执行 setGoalControl(resume) → 重放 pause，断言返回的仍是原 requester；之后删掉源测试 592-617
- **覆盖/依据：** tests/work-graph/A2-goal-control.test.ts:99-134::commits the desired state, its epoch and requester; a replay restores the original snapshot（需补“resume 由另一个操作者执行”和原 requester 的断言）
- **核实理由：** 源测试 595、601-607 手写 Goal、快照和事件，再直接 commit。公开步骤今天都有：setGoalControl，加上能换操作者的 hostContext（A2-goal-control.test.ts:72，在 :209 用过），重放走的就是生产里的 goal-control.ts:94。现有 99-134 的暂停和恢复用的是同一个操作者，所以转换时要保留“请求者不同”这一条，否则会少一处覆盖；另外会失去内存后端那一份。
- **涉及测试：** a GoalDesiredStateChanged receipt replays the original requester after a later change
- 来源：Codex；核实：confirmed；规格行：是；估计行数：26
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：目标只跑 SQLite，且漏掉 resume replay；见 A2-step1-codecs.test.ts:592、615、A2-goal-control.test.ts:62、120。 改法：公共流程覆盖 memory/SQLite，SQLite 保留 reopen；两个操作者分别 pause/resume，并分别重放两个请求，保留原 snapshot、requester、receipt。

### TP-140 · A1-04 · stale · tests/work-graph/A2-verification-chain.test.ts:170-199
- **动作：** delete
- **覆盖/依据：** 行为已不存在（79-1）：当前开轮总占槽并写 chain，第二个根由同文件 156-168::VR-01 claims the subject slot 拒绝；P10 invalid 的状态行在 tests/state/task-machine.test.ts:205；TASK-14 的“blocked/failed 不能完成”是同一分支（task-machine.ts:1100-1102），failed 那一半由 tests/state/task-machine.test.ts:947、963 覆盖
- **核实理由：** A2-verification-chain.test.ts:177 删掉 chain、178 用 commitRaw 写入无槽的第二个根，这是旧格式加篡改。当前写入里第二个根会因占槽被拒（同文件 156-168）。被删的 blocked 拒绝和 failed 共用 task-machine.ts:1100-1102 这一个分支，failed 已有测试，不会少覆盖。
- **涉及测试：** a legacy slot-less second root
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：30

### TP-141 · A1-07 · stale · tests/work-graph/A2-verification-chain.test.ts:284-296
- **动作：** 删 284-287 手写旧 @0 行的前置，288-296 的 gate 追加检查改成从没有索引开始；保留 279-283 的 VR-12（零证据不建索引行），测试名 VR-10..12 不变；规格 STATE-MACHINES-SPEC.md:3010 的“遗留 @0”加后注
- **覆盖/依据：** 行为不再保留：决定 79-1。当前 nextTaskEvidenceIndex 零追加不写（verification-machine.ts:1055-1059），没有写者会产生 @0 行；VR-12 见 279-283，VR-10 见同文件 264-266
- **核实理由：** @0 行只有旧代码写得出来（STATE-MACHINES-SPEC.md:3011 说的“今天写 @0”已经改掉）；现在的 nextTaskEvidenceIndex 零追加时返回 write:false（verification-machine.ts:1056），所以 284-287 是 79-1 要删的旧数据夹具。VR-10 和 VR-12 的行为还在，改掉前置不等于删规格行测试；DSH 只留注记偏保守，Codex 对。
- **涉及测试：** VR-10..12: no index row for zero evidence, a legacy @0 row repaired
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：13
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：删除范围包含仍被引用的 gateIndexRef，且与 TP-046 整删冲突；见 A2-verification-chain.test.ts:285、293。 改法：只删旧注释及 @0 写入，保留 gateIndexRef 和从无索引开始的 gate 追加断言；同步修正 TP-046。

### TP-142 · A1-17 · handwritten · tests/work-graph/B2-09-crr-owner.test.ts:152-160,427-502
- **动作：** convert:readTaskClosure 照 create-platform.ts:799 接真的读取函数，加上 setK3TaskDisposition（用 cancelled 关闭）来造五条“关闭”用例；437-443 和 494-502 两条读失败用例属于允许的故障注入，改成包住真读取函数、只失败一次（照 B2-07-crr-card-closed.test.ts:69-81），不算手写事实
- **覆盖/依据：** 做法见 tests/work-graph/B2-07-crr-card-closed.test.ts:38-96
- **核实理由：** readTaskClosure 这个接缝返回的是测试自己的 active.closed 开关（B2-09-crr-owner.test.ts:152-160,185），五条关闭用例确实是手写关闭事实；真读取函数 plan-readers.ts:1939 和 setK3TaskDisposition（K3-review-card-fixture.ts:353）都在，B2-07 也已经这样造。不过两条读失败用例是让依赖失败，按规则允许，只要挪到真读取函数外面包一层。
- **涉及测试：** readRequest derives closed without persisting while the Task is closed; a closure read failure is unavailable, never still valid; the next applyAnswer persists closed and returns busy; the next requestRerun persists closed and returns busy; consumeAllowance on a closed Task rejects and voids the allowance; listRequests task form returns pending items as closed; a closure read failure makes the task list unavailable, never open
- 来源：DSH；核实：partly；规格行：否；估计行数：20
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：漏掉重新打开 Task 的前提，重复调用 helper 会复用 requestId；见 B2-09-crr-owner.test.ts:453、K3-review-card-fixture.ts:379、385。 改法：公开执行 cancelled→active，helper requestId 加 planRevision，保留重新打开后请求仍 closed@2 的断言；helper 统一划归 TP。

### TP-143 · A1-08 · stale · tests/work-graph/B2-execution-entry.test.ts:205-213
- **动作：** delete 205-213（旧 V1 授权这半段，和生产 execution-entry-codecs.ts:129-149、contracts/dispatch.ts:112-116 的 V1 分支同一批删）；保留 214-219 的“畸形 V2 被 Run codec 拒绝”，前置改成当前 Run（以 old.run 为底，expectedRevision 用 old.run.revision），或改成纯 codec 测试
- **覆盖/依据：** 行为不再保留：决定 79-1（当前写者只写 V2，见 run-machine.ts 里的 ExecutionAuthorizationV2 构造，约 863-1003）；214-219 在 tests/ 里没有别处覆盖
- **核实理由：** 前半段手写了没有 schemaVersion 的 V1 授权；当前所有写者都只写 V2，V1 只剩 execution-entry-codecs.ts:129-149 的兼容读法，按 79-1 删是对的。但 214-219 断言 entering 阶段 kernel 为 null 的 V2 会被 codec 拒绝（execution-entry-codecs.ts:115-117），tests/ 里没有别的测试管这一条，DSH 整条删会把它一起丢掉，所以 Codex 对。
- **涉及测试：** does not allow a legacy authorization to begin; malformed V2 rejected
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：否；估计行数：10
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：存储提交与纯 codec 两种实现未定；见 t-items-TP.md:970、B2-execution-entry.test.ts:218。 改法：固定迁到 execution-entry-codecs-pure.test.ts，通过 materialRecordSchemas 的 Run validate 验证唯一错误 entering/kernel:null，保留原拒绝原因，不建 backend。

### TP-144 · A1-32 · handwritten · tests/work-graph/B2-execution-entry.test.ts:93-100
- **动作：** 改为只为篡改（tamper）：delete B2-execution-entry.test.ts:86-115 和 B2-model-request.test.ts:26-50，不做 convert
- **覆盖/依据：** 真实并发写者先提交的形式已有：tests/work-graph/R4-control-intent.test.ts:244-257::control committed before the authorize batch makes the stale Run guard lose；:290-315::control committed before the model-consume batch makes the stale Run guard lose and keeps the permit at @1（permit 仍 @1、consumedByAttemptId 为 null）
- **核实理由：** 手写的“Lease 已释放、Run 不变”状态没有公开步骤能产生：Lease 只在 attempt_ended/attempt_resolved 时释放（attempt-machine.ts:713-807），且由同一提交里结束 Run 的 execution-entry-service.ts:899-905 写出；改成调 cancel/recordRunResult 会让 Run 修订号一起变，测的就成了 Run CAS，而这正是 R4-control-intent 244-257、290-315 已断言的内容。
- **涉及测试：** a Lease released after admission reads wins CAS and leaves no entry authorization; a Lease released after permit issuance prevents attempted consumption and preserves permit revision 1
- 来源：Codex；核实：partly；规格行：否；估计行数：55
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：model-request 删除范围没有到测试末尾；见 B2-model-request.test.ts:50、54。 改法：删除两个完整测试：B2-execution-entry.test.ts:86-115、B2-model-request.test.ts:27-54。

### TP-145 · A1-51 · tamper · tests/work-graph/B2-execution-entry.test.ts:59-70
- **动作：** delete
- **覆盖/依据：** 只有篡改能到达：AGENTS.md:33（第 4 条）；真实形式（Run 被取消后不能授权/不能发 permit）见 tests/work-graph/R4-control-intent.test.ts:155-166、188-196
- **核实理由：** Session occupancy 只由持有它的 Run 结束时清掉（session-availability.ts:370-395 releaseSessionRecord，776-822 各条持有者释放路径），归档又要求 occupancy 为空（session-availability.ts:827），所以“Run 仍 starting/running 而 occupancy 为 null”只能靠 overwriteSession 改库做出；测试注释自己也写着 persistence-boundary anomaly（B2-execution-entry.test.ts:61-62）。
- **涉及测试：** a real claim whose Session occupancy was lost cannot receive fresh entry authorization; an entered Run that lost its Session cannot issue another model-call permit
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：26
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：动作漏列第二条 Session 丢失测试；见 B2-model-request.test.ts:12。 改法：明确删除 B2-execution-entry.test.ts:59-70 和 B2-model-request.test.ts:12-25。

### TP-146 · A1-14 · handwritten · tests/work-graph/B2-execution-entry.test.ts:232-246
- **动作：** convert:让同一个 Session 里先有一个 Run 用这个 Kernel 身份 begin 并结束，再让新 claim 的 Run 用同一身份 begin（f.secondClaim 在另一个 Session，造不出这种冲突）；如果还是造不出，就改成合同测试
- **覆盖/依据：** 转换后由本测试自己覆盖；可参照同文件 :141-184 的真实 authorize/begin 写法
- **核实理由：** 测试直接 records.commit 写了 execution-history-kernel 槽，还附了一个 src 里不存在的 TrustedScopeSeeded 事件（B2-execution-entry.test.ts:236-241），算手写事实，属实。但 DSH 给的 f.secondClaim 用的是另一个 Session（B2-execution-fixture.ts:153-168），拿本 Run 的 kernel 去 begin 会先因映射不符被拒（测试注释 234-235 已说明）；槽一旦占用就不释放（execution-entry-service.ts:743-751），所以真实的路径是同一 Session 里前后两个 Run。
- **涉及测试：** a Kernel identity slot held by another Run blocks a correctly mapped begin, with zero partial state
- 来源：DSH；核实：partly；规格行：否；估计行数：15
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：仍指定内部事实写入，合同测试兜底没有目标和断言映射；见 t-items-TP.md:991。 改法：标记 BLOCKED，删除合同测试兜底；先冻结真实 Kernel 身份冲突触发点及零部分提交断言映射。

### TP-147 · A1-38 · handwritten · tests/work-graph/R3c-plan-adoption.test.ts:190-195;237-243
- **动作：** convert:在 createB2ExecutionFixture/createTaskClaimFixture 上另建含 design/implement 的 Goal+Plan，claimTask → authorize/enter（recordExecutionEntered）得到 running Run+Lease；竞态段在原 lookup 拦截点内走 claimTask → enter → recordRunResult 得到已结束、无 TaskReduction 的 Run
- **覆盖/依据：** 保留原 query/adoption 一致性及 245-256 的 effectivePhase、eligibility 和 ready 断言；竞态段的宽松断言（不可 eligible 或 not_ready/rejected）不变
- **核实理由：** 190-195、237-243 确实手写 Run/Lease，公开步骤存在（claim-service.ts:886 claimTask 要 Session 等三项 pin，execution-entry-service.ts:1780 recordRunResult 只写 Run/Attempt 不写 TaskReduction）。但本文件自建后端只注册 Goal/治理/Plan/Run（R3c-plan-adoption.test.ts:59-67），没有 Session、Attempt、Lease、Outbox，改走公开领取得换到 B2 夹具（tests/helpers/B2-execution-fixture.ts:104-168）并重建计划，14 行远远不够。
- **涉及测试：** ended Run read race; canonical task state
- 来源：Codex = DSH；核实：partly；规格行：否；估计行数：70
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：running 和竞态结束均由手写 entered/result 造出；见 t-items-TP.md:998。 改法：改真实 Runtime prepare/start，running 用模型闸门保持，竞态在 lookup 闸门中等待真实结束并停在 Workflow TaskReduction 前。

### TP-148 · A1-43 · handwritten · tests/work-graph/R4c-execution-read.test.ts:195-221
- **动作：** convert: claimTask → 结束 Run（先走执行入口三步 authorizeRuntimeEntry→beginRuntimeEntry→recordExecutionEntered 再 recordRunResult，或者在进入前用 submitControl 取消）→ requeueTask → 用另一个 Session 重新 claimTask；旧 Session 先调 recordSessionHealth（要持有 Host 实例租约），再关掉责任链接后调 archiveSession（或者走 requestSessionArchive 流程）；需要换成带这些 owner 的夹具（如 B2-execution-fixture）
- **覆盖/依据：** 保留 215-220 的断言：旧 Run 的执行读取返回当前的 Session 和 Lease。
- **核实理由：** 198-213 用 overwriteSession/commitRaw 手写了归档的 Session 和别人持有的 Lease，这些公开步骤今天都有（session-health.ts:93、session-lifecycle.ts:1361、requeue-service.ts:792）。但 recordRunResult 之前必须先走完执行入口（execution-entry-contracts.ts:109-121），archiveSession 要求没有还在生效的责任链接（session-lifecycle.ts:21），TaskClaimFixture 又没有这些 owner（task-claim-fixture.ts:113-121），所以原来写的链条不全。
- **涉及测试：** returns current Session and Lease facts even when ownership has moved on
- 来源：Codex；核实：partly；规格行：否；估计行数：27
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：结束和归档路线未定，直接健康写入不合规则，取消也不能产生 unavailable；见 R4c-execution-read.test.ts:218、t-items-TP.md:1005。 改法：标记 BLOCKED，先冻结真实 Host 探测 unavailable、公开结束重排领取和归档的完整链，保留 Session/Lease 语义断言。

### TP-149 · A1-55 · tamper · tests/work-graph/R4c-execution-read.test.ts:256-285
- **动作：** delete
- **覆盖/依据：** 只靠篡改才能触发（AGENTS.md:33）；正常的关联读取见同文件 149-179，真实读取失败见 487-501、515-531。
- **核实理由：** 265-279 都是在 readMany 返回时伪造坏 JSON，或者改不可变的 outbox/Run/Plan 修订/Session 的工作区，没有真实入口能写出这些数据，确实只为篡改。不过 covered_by 写的 102-133 是辅助函数，不是测试；另外删掉后 119-140 的 mutateRecord 和 corruptRecord 也没人用了，行数约 52。
- **涉及测试：** reports unavailable for damaged records and inconsistent cross-links
- 来源：Codex；核实：partly；规格行：否；估计行数：52

### TP-150 · A1-41 · handwritten · tests/work-graph/R4c-source-authority-reader.test.ts:60-96
- **动作：** convert: claimTask（要在两个 Goal 里得到同一个本地 runId，得自己用 createTaskClaimService 注入 newId，因为夹具的计数器 task-claim-fixture.ts:243 每次给的 id 都不同）；submitQueryJob（会一起写出 QueryJob 和 QueryRun）；跨 Workspace 的情形先公开注册 Workspace 并创建 Goal
- **覆盖/依据：** 保留 102-120 起的精确 ref、跨 scope 和读取故障测试。
- **核实理由：** 60-96 手写了 RunSnapshot/QueryRunSnapshot，再用 commitRaw 提交（94 行）；公开步骤 claimTask（claim-service.ts:1204）和 submitQueryJob（R5b-query-job.test.ts:141）今天都有。不过除了这三个辅助函数，100-259 里大约 26 行调用处也得跟着改，合计约 63 行。
- **涉及测试：** manualRun; manualQueryRun; seedSnapshot
- 来源：Codex = DSH；核实：partly；规格行：否；估计行数：63

### TP-151 · A1-42 · handwritten · tests/work-graph/R4c-task-claim.test.ts:270-277
- **动作：** convert: claimTask → 结束 Run（执行入口三步后调 recordRunResult，或者在进入前用 submitControl 取消）→（第二条再加 proposePlan/applyPlanChange 换 Plan 修订）→ 再次 claimTask；需要换成带执行入口 owner 的夹具；转换后第一条测的是“已结束的 Run 加已释放的 lease”，“没有 lease”这个状态没有公开步骤能造出来；spec_row 应为 false
- **覆盖/依据：** 保留两条测试里“Task 已有执行痕迹时拒绝新领取”和“不做第二次扫描”的断言（MVP-BEHAVIOR.md:128）。
- **核实理由：** R4c-task-claim.test.ts:272 和 R4c-task-claim-boundaries.test.ts:98-103 用 seedRun/commitRaw 手写了已结束的 Run 和虚构的旧 Plan，确实应该改走公开步骤。但 recordRunResult 之前要先走执行入口（execution-entry-contracts.ts:109-121），TaskClaimFixture 没有这些 owner；公开步骤结束 Run 后 lease 还在，只是带上 release（claim-service.ts:263-264、374），第二条期望的 busy 也得重新核对。两条测试名都不是规格行号。
- **涉及测试：** does not treat an ended Run without a lease as a fresh pending Task; a Run in an older Plan still prevents a fresh claim, without a second scan
- 来源：Codex；核实：partly；规格行：是；估计行数：20
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：转换路线未定且含 F3 写入，前置写入后计数没有重新开始；见 R4c-task-claim.test.ts:276、R4c-task-claim-boundaries.test.ts:106。 改法：固定公开 claim 后进入前 cancel；第二条再公开换 Plan；前置完成后清零委托计数，保留被拒领取的零提交、一次 lookup 和 busy。

### TP-152 · A1-12 · stale · tests/work-graph/S1-dispatch-guards.test.ts:151-165
- **动作：** delete（规格行 SV58，lead 要给 slice-1-SPEC.md:1011 加后注）
- **覆盖/依据：** 旧格式兼容按决定 79-1（HANDOFF.md:565-570）退出；当前只读副本的领取拒绝由同文件 45-56 的 SV39 覆盖。
- **核实理由：** createLegacySession（S1-session-facts-fixture.ts:208-229）先用 commitRaw 写一个不带 provenance 的旧 Operation 再登记 Session，而当前创建路径总会写 provenance（session-directory.ts:717-718、792）。所以 SV58 测的旧来历推导（claim-service.ts:762）只有旧数据才会走到，属于旧格式兼容。
- **涉及测试：** SV58
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：15

### TP-153 · A1-14 · stale · tests/work-graph/S2A-notices-rework.test.ts:37-76
- **动作：** delete：删 QA-11（37-76）和文件头 4-7 行的说明，连同只被它用的 tests/helpers/S2A-notices-support.ts:95-132（legacyRequeueRecords、legacyRequeueItemKeys）；生产 src/core/work-graph/views/automatic-rework-notices.ts:527 的 legacy 位置分支同批去掉
- **覆盖/依据：** 行为已不存在：HANDOFF 79-1（docs/refactor/HANDOFF.md:565-566）、slice-2A-SPEC.md:390；tests/work-graph/S2A-notices-counts.test.ts:24::QA-10 和本文件 78-130::QA-18 保留
- **核实理由：** 唯一的 TaskRequeue 写者 requeue-service.ts:1110-1116 总绑定 since（encodeTaskRequeueSnapshot 的生产调用只此一处），规格 slice-2A-SPEC.md:390 也写明造不出；QA-10 在 S2A-notices-counts.test.ts:24。但 S2A-notices-support.ts:95-132 两个辅助只被本测试用，应一起删，行数约 80 而非 40。
- **涉及测试：** QA-11
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：80

### TP-154 · A1-15 · stale · tests/work-graph/S2B-30-track-bars.test.ts:188-207
- **动作：** delete：删 188-207，连同只被它用的 tests/helpers/S2B-track-fixture.ts 的 stripRoundSince/stripRoundFinalizedAt（148-151、836-850、880-881）；生产 src/core/work-graph/views/track-read-model.ts:771-778 的 legacy 计数（unplaced.rounds 的唯一来源）同批去掉
- **覆盖/依据：** 行为已不存在：HANDOFF 79-1（docs/refactor/HANDOFF.md:565-566）；同文件 154-186 的当前检查横条和 249-268 的跨日轮次保留
- **核实理由：** 轮次写者新建时总绑 since（evidence-service.ts:351-358、1700-1702），定案只经 finalizeChecks 写 finalizedAt（:1603-1605；buildFinalizedRound 唯一调用在 verification-machine.ts:1594），旧形状只能靠 stripRoundKey 改库（S2B-track-fixture.ts:836-850）造出。删后这两个夹具方法成死代码，行数约 40 而非 20。
- **涉及测试：** 旧轮次缺 since/finalizedAt 计入 unplaced.rounds
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：40

### TP-155 · A1-16 · stale · tests/work-graph/S2B-33-task-timeline-pagination.test.ts:98-116
- **动作：** delete：删 98-116（实际测试名“2B-33 a pre-2B finalized round puts check_start and check_end in untimedPoints with no verifying segment”），连同只为无 sinceAt 存在的 tests/helpers/S2B-task-timeline-fixture.ts:648-679 seedRoundRaw 和 824-825 的分流；生产 src/core/work-graph/views/task-state-timeline.ts:396-418 的无 since/无 finalizedAt 分支同批去掉
- **覆盖/依据：** 行为已不存在：HANDOFF 79-1（docs/refactor/HANDOFF.md:565-566）；tests/work-graph/S2B-31-task-timeline-main.test.ts:20-58 保留；本文件 82-96 不删
- **核实理由：** seedRound 不传 sinceAt 时走 seedRoundRaw 手写无 since 的旧轮次（S2B-task-timeline-fixture.ts:649-679、825），今天的写者总写 since/finalizedAt（evidence-service.ts:351-358、1603-1605）；S2B-31-task-timeline-main.test.ts:20-58 存在并覆盖当前的 check_start/check_end。全仓只有本测试不传 sinceAt，删后 seedRoundRaw 成死代码，行数约 50 而非 19。
- **涉及测试：** pre-2B finalized rounds without since/finalizedAt
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：53

### TP-156 · A2-02 · stale · tests/work-graph/S2B-activity-calendar-tasks.test.ts:51-79,146-208；仅旧记录helper和子段
- **动作：** delete
- **覆盖/依据：** 行为已不存在：docs/refactor/HANDOFF.md:565-569；保留本文件152-153、162-163、178-181、193-194的真实Run过滤场景并重新手算计数（runsSessionUnknown变0、steps 12→5、runsCounted 3→2、9点uncountedRuns 2→1、去掉not_backfilled；not_backfilled另有S2B-run-activity-read等覆盖）；2B-26规格行（slice-2B-SPEC.md:777）的旧执行一句由lead后注
- **核实理由：** 现在只有 claim-service.ts:458-485 建 Run，同一次提交必写派工记录（:482-484），src 里也没有删记录的写法，所以“没有位置记录、没有派工记录”的 Run 只能经 commitRaw 造（本文件57-79），run-activity-service.ts:281-302 也注明这是旧执行；按79-1可删。fixture 的 seedLegacyActivity 还被 tests/app/S2B-r2-backfill-done-cursor.test.ts:84 用，这里不能一并删。
- **涉及测试：** 2B-26 filters a cell to one line with sessionRefs and counts Runs whose claiming Session is unknown; 2B-26 sessionRefs skips a foreign-line uncounted Run and counts an unresolvable claiming Session
- 来源：Codex = DSH；核实：confirmed；规格行：是；估计行数：51

### TP-157 · A2-01 · stale · tests/work-graph/S2B-activity-calendar.test.ts:215-262；删除子段235-241、257-260
- **动作：** delete：本测试235-241、257-260（260可改成checksUnplaced: 0），并删只供它用的 fixture openLegacyRound（tests/helpers/S2B-activity-fixture.ts:148、250-266、583）
- **覆盖/依据：** 行为已不存在：docs/refactor/HANDOFF.md:565-569；保留本测试221-233、249-256、261的当前归属断言；2B-24规格行（slice-2B-SPEC.md:775）的旧轮次一句由lead后注
- **核实理由：** evidence-service.ts:347-358 建轮次时必写 since 占位、由 Store 绑定提交游标，更新时 preservedRoundNoticeOrigin（:292-316）照抄，所以没有 since 的轮次只能由 fixture 改存储造（S2B-activity-fixture.ts:250-266），删子段成立。但 openLegacyRound 只有本测试在用（Grep 只有 S2B-activity-calendar.test.ts:240），应一起删，行数要加上。
- **涉及测试：** 2B-24 attributes begun checks to the round start hour and its task and counts legacy rounds as unplaced
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：30
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：checksUnplaced 删除或改零存在两种读法，并与 TP-090 重叠；见 t-items-TP.md:1068。 改法：固定保留 checksUnplaced:0，删除旧轮次前提及旧值断言，同步修正 TP-090 范围。

### TP-158 · A2-04 · stale · tests/work-graph/S2B-r2-never-entered.test.ts:23-37
- **动作：** delete
- **覆盖/依据：** 行为已不存在：docs/refactor/HANDOFF.md:565-569；本文件39-75保留V2及当前授权场景
- **核实理由：** run-machine.ts:861-1004 每处写授权的都是 V2，V1 只是 execution-entry-codecs.ts:7、17-18 注明保留的兼容形状，provenNotEnteredKernel（contracts/run-activity.ts:98-102）只认 V2；本测试26-30经 commitRaw 写 V1，按79-1可删。
- **涉及测试：** R5 a V1 authorization phase authorized does not prove non-entry
- 来源：Codex；核实：confirmed；规格行：是；估计行数：15

### TP-159 · A2-05 · stale · tests/work-graph/S2B-r2-r5-not-entered.test.ts:36-52
- **动作：** delete（S2B-r2-r5-not-entered.test.ts:36-52；与 Codex A2-04 的 S2B-r2-never-entered.test.ts:23-37 一起，并和 ExecutionAuthorizationV1 兼容形状 dispatch.ts:112、execution-entry-codecs.ts:6-7,17 同批删）
- **覆盖/依据：** 行为已不存在：HANDOFF 79-1；当前只写 V2（run-machine.ts:862-869）；同文件 :70-92 V2 带 Kernel 用例保留
- **核实理由：** run-machine.ts:862-869 新授权只写 schemaVersion 2，其余写点只在已有授权上展开，V1 只能靠 seedRawRunVariant 手塞（:41-44）；但 DSH 说 never-entered.test.ts:23-37 是“同用例重复”不准确：那条读 readRunActivities 断 not_recorded，这条读 readTrackBars 断 no_recording_epoch，只是都只测 V1，两条都该删。
- **涉及测试：** 2B-r2 R5 a V1 authorization does not prove non-entry
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：17

### TP-160 · A2-17 · duplicate · tests/work-graph/S2B-r2-s-preentry-control.test.ts:26-49
- **动作：** merge-into:tests/work-graph/S2B-r2-s-preentry-control.test.ts::2B-32 fold order (a): public claim + pause + resume + entry read paused/pending/running（对象是 S2B-32-task-timeline-fold.test.ts:226-243 的第 1 轮直写版；r2 公开流程版保留）
- **覆盖/依据：** tests/work-graph/S2B-r2-s-preentry-control.test.ts::2B-32 fold order (a): public claim + pause + resume + entry read paused/pending/running
- **核实理由：** 重复成立：两处五段时间完全相同（S2B-r2-s-preentry-control.test.ts:42-48 与 S2B-32-task-timeline-fold.test.ts:236-242）。但方向反了：第 1 轮那条靠 seedControlRaw 直写进入前的观测（S2B-task-timeline-fixture.ts:43-46、781-785），r2 走真实领取、控制和进入，应留 r2、合并掉第 1 轮那条。
- **涉及测试：** 2B-32 fold order (a): public claim + pause + resume + entry read paused/pending/running
- 来源：DSH；核实：partly；规格行：是；估计行数：18

### TP-161 · A2-07 · stale · tests/work-graph/S2C-lines-d1.test.ts:32-73；仅旧L相关部分
- **动作：** change（不是 delete）：从 buildD1 去掉 L（tests/helpers/S2C-L-line-support.ts:710-711），本文件重算字面数：待命 6→5（:37）、已归档 partial→exact 2（:38-39）、删 :52、行数 9→8（:57）、置顶改用真实 Session（:63-65）；同步改 tests/app/S2C-line-routes.test.ts:311 的 Session 列表；createLegacySession 还被 S2C-lines-page.test.ts:397 用，先留
- **覆盖/依据：** 行为已不存在：docs/refactor/HANDOFF.md:565-569；slice-2C-SPEC.md:1279（今天的写者造不出来历为 null 的 Session，session-directory.ts:716-718、792）；2C-14字面数（slice-2C-SPEC.md:312、1312）由lead后注
- **核实理由：** 旧 Session L 确实是旧格式（规格 slice-2C-SPEC.md:1279 自己写了“今天的写者造不出来”），这条核心成立；但 L 也算进了 :37 的“待命 6”和 :57 的“9 行”，Codex 给的范围漏了这两处，“保留42-56”又和它要删的 :52 重叠，而且 buildD1 共用于 tests/app/S2C-line-routes.test.ts:311，所以应该是改，不是删。
- **涉及测试：** 2C-14 (1) the literal D1 counts are working 3, standby 6 and the archived range; 2C-14 (2) a pinned line sorts first and the rest follow by attention then latest activity
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：12

### TP-162 · A2-06 · stale · tests/work-graph/S2C-lines-page.test.ts:394-421
- **动作：** delete（S2C-lines-page.test.ts:394-421，与 createLegacySession 夹具同批处理）
- **覆盖/依据：** 行为已不存在：HANDOFF 79-1；当前 scope:'indexed' 与分页由 S2C-lines-page.test.ts:97-129::2C-18 executions page by generation 断言（:105）
- **核实理由：** 旧格式的是来历为 null 的 Session：建 Session 不给来历就写 new（session-directory.ts:714-718、:792），规格 slice-2C-SPEC.md:1279 也说今天写者造不出；DSH 说手写 QueryRun 是旧形状不对，pending、没有 executionState 正是当前 submitQuery 写的形状（query-run-recovery.ts:482-490、query-job-service.ts:768），它不在任何 Session 的索引里本来就不会列出，删掉不丢当前行为。
- **涉及测试：** 2C-18 executions list only the indexed Work claims and QueryRuns on a legacy Session
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：28

### TP-163 · A2-26 · handwritten · tests/work-graph/S3-graph-context.test.ts:388-470,543-550,580-594,746-758
- **动作：** convert:createGoal→proposePlan→applyPlanChange（含 GR09 的 g2；GR10 换计划改走 proposePlan(basedOn p1)→applyPlanChange）；runA 结束走 authorizeRuntimeEntry→beginRuntimeEntry→recordExecutionEntered→recordRunResult；roundA 在 runA 结束后走 openVerification。rb/rB 这个开着的轮次和 Session sa/sb/sB/sq 继续手写，或者改写 GR06/GR07 的期望
- **覆盖/依据：** GR01-GR19 的断言多数保留；GR06/GR07 的字面结果（S3-graph-context.test.ts:881-888、899-906）会跟着 Session id 和轮次变，不能原样保留
- **核实理由：** roundB 是开在 runB 上的轮次，而 runB 必须一直在运行（它是 workCtx 的 work_run，S3-graph-context.test.ts:497-499）；openVerification 要求主体 Run 已经结束且 completed（evidence-service.ts:1070-1098；verification-machine.ts:1209-1212），这个状态造不出来。真实建出来的 Session id 是 session-<hash>（session-directory.ts:147-149），GR06/GR07 按 sa/sb/sq 的字面断言就不再成立，所以“原 GR 断言保留”说不通。
- **涉及测试：** GR系列共享事实; GR10计划切换
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：90
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：要求继续手写或改变期望，且 running Run 不能公开开验证轮；见 t-items-TP.md:1110、evidence-service.ts:1070。 改法：标记 BLOCKED，先冻结公开可达的 GR 世界及 GR06/GR07 逐断言映射，删除手写或改期望的选择。

### TP-164 · A2-08 · stale · tests/work-graph/S3-prepared-context-admission.test.ts:499-508
- **动作：** delete（S3-prepared-context-admission.test.ts:499-508；与 prepared-execution.ts:205,271 的可选 contextAssembly 和 execution-entry-service.ts:1065 的 binding===undefined 放行同批，规格 AD05 行 slice-3-SPEC.md:740 与 §2.4 第 1 条加后注）
- **覆盖/依据：** 行为已不存在：HANDOFF 79-1；当前绑定准入由同文件 :438-449::AD01 断言
- **核实理由：** 当前准备一定带 contextAssembly：AssembledContextV1.binding 是必填（context-assembler.ts:122-123），execution-preparation.ts:498 取它、:533 写进 manifest；没有它的 manifest 只有夹具 prepare({binding:null}) 手造（:379-399、:501），是旧格式兼容，应删而非只记。
- **涉及测试：** AD05: an old manifest without contextAssembly authorizes as before and is not migrated
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：10
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：Query 准入文件缺白名单；见 src/core/work-graph/queries/query-execution.ts:1072、1079。 改法：纳入 Query 准入文件，本条与 TP-009/054/130 同批，不单独删除 AD05。

### TP-165 · A2-27 · handwritten · tests/work-graph/S3-prepared-context-admission.test.ts:274-281,518-523,548-556
- **动作：** convert:真实 Run 流程（claim tA→authorizeRuntimeEntry→beginRuntimeEntry→recordExecutionEntered→recordRunResult）；AD06 走 beginRuntimeEntry→reconcileRun(not_entered)；AD08 走 setLinePins
- **覆盖/依据：** 原 AD06/AD08 断言保留；真实撤销链见 tests/helpers/WP1-entry-fixture.ts:334-353 和 tests/work-graph/WP1-goal-content-entry.test.ts:99-109::GE05
- **核实理由：** 三处确实是手写：runA 的 ended 快照（S3-prepared-context-admission.test.ts:274-282）、直接把授权改成 phase=revoked（518-523）、直接把 Workspace 改到 @8（548-556）。对应的公开步骤今天都有：reconcileRun not_entered 见 WP1-entry-fixture.ts:340-347，setLinePins 写的 Workspace 版本会加一（line-settings-service.ts:88、214；S2C-pins.test.ts:76-78）。runA 需要另开一个 Session，或者先在同一个 Session 上跑完 tA。
- **涉及测试：** 共享上游Run; AD06 revoked Run binding; AD08 Workspace revision conflict
- 来源：Codex；核实：confirmed；规格行：是；估计行数：24
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：Run/AD06 仍手写 Runtime/Host 事实，AD08 未建立真实 @7；见 S3-prepared-context-admission.test.ts:518、547、553。 改法：上游 Run 用真实 Runtime；AD06 标记 BLOCKED，先冻结未进入故障及 Host reconcile；AD08 公开推进 Workspace 到 @7 后真实 prepare，再公开变更至 @8。

### TP-166 · A2-11 · stale · tests/work-graph/S5-notices.test.ts:195-209；仅legacy排序子段
- **动作：** 改 NR05：删旧 requeue 那一半（:197、:199-200、:207-208，:206 改为 1 条），保留新 requeue 的 commit 位置（:198、:201-204、:209）和 corrupt null origin 子段 :210-212（见 Codex A2-43 keep-note）；与 automatic-rework-notices.ts:527 since 缺失回 legacy 的分支同批，规格 NR05 行（slice-5-SPEC.md:1129）加后注
- **覆盖/依据：** 行为已不存在：HANDOFF 79-1（requeue 建立时一定绑定 since，requeue-service.ts:1114-1116）；commit 位置另由 S5-notices.test.ts:238-243::NR06 断言
- **核实理由：** 旧 requeue 由 legacyNoticeWire 删 since 造出（S5-queue-support.ts:284-297），当前写者不写这种形状，所以 DSH 整条 keep-note 太保守；NR05 后两部分（新 since 是真 cursor、null 持久 origin 回 unavailable）仍是当前行为，不能整条删。DSH 引的 HANDOFF.md:574 是第 8 片 §11.6 旧记录，与此无关；QA-11（S2A-notices-rework.test.ts:37-76）同样只测旧形状，不能当覆盖。
- **涉及测试：** NR05 legacy precedes a bound creation position and corrupt null origin is unavailable
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：8
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：删旧通知后仍保留 items[1]；见 S5-notices.test.ts:206、209。 改法：把 209 行两处 items[1] 改为 items[0]，保留唯一 fresh 通知位置及 corrupt-origin 拒绝断言。

### TP-167 · A2-12 · stale · tests/work-graph/S5-notices.test.ts:271-284
- **动作：** delete（S5-notices.test.ts:271-284；与 automatic-rework-notices.ts:423-434 的 cap ?? null 和“上限未记录”文字同批，规格 NR08 行 slice-5-SPEC.md:1132 加后注）；可选：把 :279-283“改 policy 后通知不变”挪到当前轮次（cap:3 改成 7 后仍是 3），那是唯一改 policy 的用例
- **覆盖/依据：** 行为已不存在：HANDOFF 79-1；当前自动后继轮的 cap 由 S5-notices.test.ts:131-135::NR01（cap:3）断言，计数由 :258-269::NR07 断言
- **核实理由：** 当前后继轮一定写 noticeAutomationCap：reverifyRound 传 policy.autoReworkLimit（evidence-service.ts:2028-2030），只有拒绝路径不传且不写后继轮（:1961-1964、:1698-1701）；没 cap 的轮次只由 legacyNoticeWire 删字段造出（S5-queue-support.ts:294），应删而非只记。Codex 引的 NR07 不断言 cap，覆盖 cap 的是 NR01。
- **涉及测试：** NR08 legacy reverify retains an unknown cap after the current policy cap changes
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：14
- **书面核对改正（Codex，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：唯一的策略变化不改历史通知断言被设为可选；见 S5-notices.test.ts:279、283。 改法：强制迁移到当前 cap=3 的后继轮，公开把当前策略改为7，断言历史通知及 cap 仍为3，再删除旧 unknown-cap 场景。

### TP-168 · A2-09 · stale · tests/work-graph/S5-request-candidates.test.ts:305-341
- **动作：** delete（305-341；同批删 plan-record-codecs.ts:1005-1020 的 legacy_v1 解码分支和 plan-machine.ts:106、1250、1623、1709 的 legacy_v1 分支，规格 RC11 行加后注）
- **覆盖/依据：** 行为已不存在：HANDOFF 79-1（docs/refactor/HANDOFF.md:565-566）；当前候选行为在本文件 RC01 起各行
- **核实理由：** 过时成立：生产只有 encodePlanProposal（plan-record-codecs.ts:1072）写当前候选，src 里没有写 PlanProposalSnapshot@1 的写者，v1 只在解码分支 plan-record-codecs.ts:1005-1020 读。79-1 要求不留旧版本解码分支，所以应删而不是只留注，Codex 对。
- **涉及测试：** RC11 a legacy v1 proposal remains a read-only candidate without added request fields or claims
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：37

### TP-169 · A2-23 · handwritten · tests/work-graph/S5-request-candidates.test.ts:269-289；主要改271-275
- **动作：** convert:proposePlan（requestRef 省略，经 owners(f).plans.proposePlan 造无 request 的候选；断言保留，标题去掉 old）
- **覆盖/依据：** —
- **核实理由：** DSH 说当前写者总写 requestRef/notAdopted 不对：plan-machine.ts:1084-1085 无 request 时不加 requestRef，newCandidateProposal（plan-machine.ts:132-135）不写 notAdopted，notAdopted 只在关闭时写（plan-machine.ts:1644、1723）；ProposedPlanRequestV1.requestRef 可选（plan-contracts.ts:41）。RC09 的形状就是今天 PC09 独立候选的形状，行为仍在，应把 seedCandidateProposal 手写改成公开 proposePlan。
- **涉及测试：** RC09 an old v2 candidate gains neither optional fields nor a request claim on read
- 来源：冲突裁定（采用 codex）；核实：refuted；规格行：是；估计行数：8

### TP-170 · A2-10 · stale · tests/work-graph/S5-user-messages.test.ts:277-345
- **动作：** delete（277-345；同批去掉 mailbox-service.ts:179-199 对无 since 旧记录的不回填容忍，规格 UM12 行加后注）
- **覆盖/依据：** 行为已不存在：HANDOFF 79-1（docs/refactor/HANDOFF.md:565-566）；ack 的当前流程在 tests/work-graph/C1-session-mailbox.test.ts 等处
- **核实理由：** 过时成立：当前新建消息总经 commitPreparedSessionMessage 写 since 占位并绑定游标（mailbox-service.ts:297-299），UM12 手写的无 since 记录（S5-user-messages.test.ts:295-300）只有旧版本才有，测的是 mailbox-service.ts:180 的“旧记录不回填”。按 79-1 应删，Codex 的 delete 对。
- **涉及测试：** UM12 a genuinely old absent-field Session message keeps its frozen ack DTO/receipt and origin absence
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：69

### TP-171 · A2-15 · stale · tests/work-graph/WP1-goal-content-entry.test.ts:79-85
- **动作：** delete；同批删掉生产里null摘要放行的分支（state/context-input.ts:381-383和363行注释），并给wiring-1-SPEC.md L2（25行）和GE03行（293行）加79-1后注
- **覆盖/依据：** 只为兼容旧manifest（wiring-1-SPEC.md:25“兼容已准备好的旧 manifest”）：现在唯一的Work写入方context-assembler.ts:1919-1924总给本Goal来源填字符串摘要（facts只在有claim时非空，1696），按HANDOFF 79-1（566行）去掉；本文件55-61::GE01、63-77::GE02保留真实摘要的行为
- **核实理由：** GE03靠makeUnboundGoalPrepared把摘要设成null（82行），生产里只有旧manifest会出现这种情况，删测试的理由成立；但“行为已不存在”不对：context-input.ts:381-383今天仍放行null，只删测试会留下一条没人测的兼容分支。
- **涉及测试：** GE03 commits the same unbound manifest when the stored Goal digest is null
- 来源：Codex；核实：partly；规格行：是；估计行数：7

### TP-172 · A2-13 · stale · tests/work-graph/WP2-undelivered-notices.test.ts:221-272；仅旧数据位置缺失子段
- **动作：** delete 子段（226-272 旧数据缺位置部分，含 otherGoal/affected/unfiltered 三段）；保留 274-285 的位置损坏子段并把标题改成只说损坏位置被拒
- **覆盖/依据：** 行为已不存在：HANDOFF 79-1；当前位置流程在本文件 F09/F10（113-126、147-165）
- **核实理由：** 当前写者总写位置：进入 unavailable 置 unavailableSince 占位（session-availability.ts:397、457），work_run 回复置 responseSince 占位（message-machine.ts:1252、1313），测试注释自称“pre-package records”（WP2-undelivered-notices.test.ts:226），所以缺位置只来自旧数据；79-1 晚于 wiring-2 的 M05 行，不算冲突。274-285 是 DTO 与记录不一致（undelivered-reply-notices.ts:336-338）不是旧数据，应保留，Codex 的拆法对。
- **涉及测试：** M05 old data missing a position blocks only its Goal; a damaged position is refused
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：48

### TP-173 · D-11 · stale · tests/state/task-machine.test.ts:['303-304', '321-324']
- **动作：** delete；范围补上 tests/state/task-machine.test.ts:142-143（FINAL_PASS_GAPS）、:165（SIG.passGaps）、:898（'a PASS with gaps'，对应生产 task-machine.ts:1044 这条只有旧数据才走得到的拒绝）、:1003 列表里的 FINAL_PASS_GAPS，以及 :8 头注释；生产里的旧分支一起删。
- **覆盖/依据：** 旧 PASS 兼容要求取消：docs/refactor/HANDOFF.md:566。当前 P20 分支保留在 tests/state/task-machine.test.ts:298-302；当前生成规则在 tests/state/verification-machine.test.ts:901-906。
- **核实理由：** 所列的 :303-304、:321-324 确实只测旧的“带 gaps 的 PASS”（当前不会写出这种形状，见 verification-machine.ts:882）。但同一形状还用在 :142-143、:165、:898、:1003；删掉 :304、:322 以后 :165 就没人用了，:898 测的是 task-machine.ts:1044 这条只有旧数据才走得到的拒绝，所以行数要从 6 改成大约 11。
- **涉及测试：** P20 (C5, 5.9 part 2): a gate projects from its own chain head right after P1, with gate and ordinal; a legacy PASS with gaps is P8 round_inconclusive, never awaiting completion (VD-4)
- 来源：Codex；核实：partly；规格行：是；估计行数：11
- **书面核对改正（Codex 复核，lead 采纳）：** 原是第二批的 T2-064，因与 TP-137 删除 verification-machine.ts:729 的 PASS-with-gaps 投影分支必须同批落地，并入 TP，和 TP-137 同一依赖组合；第二批不再做。
