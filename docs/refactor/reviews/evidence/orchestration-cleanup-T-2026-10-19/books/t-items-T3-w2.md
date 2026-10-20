# T items, wave 2, group T3 (99 items; lead 2026-10-20)

编号 = 原组内序号 · 清点编号。动作是最终的；修正行的先后和优先级见任务书 §1。看不懂或和代码对不上的，标 BLOCKED 并报证据。

从别的组移进本组的条目（它们和本组条目改同一批文件）：T2-001, T2-002, T2-005, T2-006, T2-007, T2-008, T2-009, T2-022, T2-024, T2-025, T2-028, T2-029, T2-030, T2-031, T2-032, T2-033。

### T2-001 · D-23 · duplicate · tests/contracts/review-admission.test.ts:['169-171']
- **动作：** merge-into:tests/contracts/review-admission.test.ts::admits the exact set, empty write scope and Host layer 1
- **覆盖/依据：** tests/contracts/review-admission.test.ts:80-82::admits the exact set, empty write scope and Host layer 1（81 断言 null）
- **核实理由：** reviewPurpose 本来就是 phase:'review'（review-admission.test.ts:20-25），170 行再写一次 phase:'review' 输入与 81 行完全相同，断言也都是 toBeNull，合并等于删掉 169-171。测试名不带规格行号，规格里也查不到这一条，spec_row 记成 true 不准，但不影响处理。
- **涉及测试：** still admits a review-phase review purpose with the fixed set
- 来源：Codex；核实：confirmed；规格行：是；估计行数：3
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/contracts/review-admission.test.ts:169（重复例仍在，原动作适用。）

### T2-002 · D-24 · duplicate · tests/contracts/review-admission.test.ts:['80-118', '129-151', '173-177']
- **动作：** merge-into:tests/contracts/review-admission.test.ts::reviewRoundAdmissionProblem（把 tests/runtime/K3-19-review-admission-pure.test.ts 独有的 :57-63 普通 manifest、:83-87 proposal 缺写工具、:95-99 proposal 多一个工具 三条并入，删 runtime 文件其余重复例；同时删 contracts:169-171（Codex D-23，与 :81 同输入）
- **覆盖/依据：** tests/contracts/review-admission.test.ts:80-118,129-177
- **核实理由：** 两文件确实用同一输入测同一纯函数（如 contracts:90-94 对 runtime:77-81、contracts:137-143 对 runtime:71-75），但 contracts 文件是 src/contracts/review-admission.ts 的本模块测试，覆盖面是超集（常量字面量 :36-50、isReviewRoundPurpose、reviewHostLayerOneAccess、role_invalid、非 review Run、缺 read、proposal 也要 Host layer 1 :154-167），runtime 文件只有三条独有输入；按 Codex 方向搬约 15 行、删约 55 行，按 DSH 方向要搬 120 行且 DSH 列的独有项还漏了 :110-112、:154-167。
- **涉及测试：** admits the exact set, empty write scope and Host layer 1; rejects a missing tool; rejects an extra tool; rejects a non-empty write scope; rejects hostTools missing run_readonly_command; rejects a narrowed read-only command access; L20: a proposal-phase review purpose with its own fixed set, empty write scope and Host layer 1 passes; L20: a proposal-phase review purpose is refused the review phase's tool set; L20: a proposal-phase review purpose is refused a non-empty write scope; still refuses a review-phase review purpose with the proposal tool set
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：60
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/contracts/review-admission.test.ts:79; tests/runtime/K3-19-review-admission-pure.test.ts:57（三项独有输入仍需迁入，与001、022同做。）

### T2-005 · C01 · stale · tests/kernel/R4a-frozen-public.test.ts:['423-437', '627-649']
- **动作：** delete
- **覆盖/依据：** 行为已不存在（只为旧格式兼容）：docs/refactor/HANDOFF.md:565-570。当前 writer 总写 recoveryConstraints：vendor/coding-agent/dist/app/composition/composition-root.js:271（turn.started）、:282 与 resume-composition.js:261-263（checkpoint）；src 不写 checkpoint。当前格式恢复保留 tests/kernel/R4a-frozen-public.test.ts:245、:575。
- **核实理由：** buildRawTurn 写的旧 Turn 缺 recoveryConstraints（R4a-legacy-fixtures.ts:108-137），627-649 删掉 checkpoint 的 recoveryConstraints；当前 writer 总会写这个字段（composition-root.js:135,271,282），兼容分支只在冻结 Kernel 的 resume-composition.js:159-162 和 recovery-coordinator.js:213-226。没有 contextBasis 的 Turn 现在也会写（:813），所以判旧依据是缺 recoveryConstraints，这和 Codex 的说明一致。删除后 tests/kernel/README.md:16 要跟着改。
- **涉及测试：** reads a legacy schemaVersion=1 Turn without new constraint fields or rewriting its checksum; still accepts a legacy checkpoint without recovery constraints
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：38
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：已要求修改 tests/kernel/README.md，但该文件不在白名单，且相关历史说明不限于第16行。 改法：将 README 加入白名单，追加 T 轮后注说明 T2-005至009后的保留范围及旧 writer 删除情况，保留原历史迁入说明原义。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/kernel/R4a-frozen-public.test.ts:423; tests/kernel/R4a-frozen-public.test.ts:627（两个旧格式例仍在。）

### T2-006 · C05 · duplicate · tests/kernel/R4a-frozen-public.test.ts:['396-404']
- **动作：** delete
- **覆盖/依据：** tests/kernel/R4a-frozen-public.test.ts:192-212::rejects a paused recovery that raises the persisted model-request budget before any model call
- **核实理由：** 396-404 和 192-212 都是先暂停在 limits(1)，再用 limits(4) 恢复，都断言 conflict、模型零请求、记录不变（:401-403 对 :207-211）；192 还多查了恢复前的请求数（:205）。
- **涉及测试：** a paused Turn cannot resume with a larger model budget after restart
- 来源：Codex；核实：confirmed；规格行：否；估计行数：9
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/kernel/R4a-frozen-public.test.ts:396; tests/kernel/R4a-frozen-public.test.ts:192（重复预算拒绝例仍可删除。）

### T2-007 · C06 · duplicate · tests/kernel/R4a-frozen-public.test.ts:['213-244']
- **动作：** merge-into:tests/kernel/R4a-frozen-public.test.ts::independent R4a execution identity and paused recovery。（1）预算：删 :396-404，:192-212 已全有（两边一致）。（2）deniedPrefix：保留 :213-244，删 :406-422，删前把 :414 的成功分支 status==='completed' 和 :419 的拒绝分支记录不变断言并进 :230-243。（3）身份重放：不是纯重复，先把 :152-177 改成 A/B/C 三个 Turn、重放中间的 B（带上 :382-395 的选中间断言），再删 :382-395。C-02 也删掉以后，整个 'frozen public: R4a-recovery-contract.test.ts' describe（约 :320-443，含 setup/LocalModel/readRecords）都能去掉。
- **覆盖/依据：** tests/kernel/R4a-frozen-public.test.ts::rejects a paused recovery that raises the persisted model-request budget before any model call（:192）/ does not expose a previously denied path when paused recovery omits workspace options（:213，补断言后）/ replays the requested old identity after a newer completed Turn（:152，改成三个 Turn 后）
- **核实理由：** 预算一对 :396-404 与 :192-212 断言相同。deniedPrefix 两条各有对方没有的断言（:238 结果条数；:414 completed、:419 记录不变），两个合并方向都行；保留 independent 组更好，C-02 落地后整个 contract describe（:320-443）都能删。身份一对不是同断言：:152 重放的是两个里的第一个，:178 只有一个 Turn，‘总返回第一个已完成 Turn’的错误只有 :382 的三选中间能抓到，所以要先把它迁过去。
- **涉及测试：** does not expose a previously denied path when paused recovery omits workspace options
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：否；估计行数：41
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/kernel/R4a-frozen-public.test.ts:152; tests/kernel/R4a-frozen-public.test.ts:213; tests/kernel/R4a-frozen-public.test.ts:382（先迁中间Turn和独有断言，再删重复组。）

### T2-008 · C13 · tamper · tests/kernel/R4a-frozen-public.test.ts:['596-625']
- **动作：** delete
- **覆盖/依据：** 不再要求只为篡改的行为：AGENTS.md:33（规则 4）。正常恢复保留 tests/kernel/R4a-frozen-public.test.ts:575-585。
- **核实理由：** 609-616 把 recoveryConstraints.version 改成 2、重算 checksum，再直接 SQL UPDATE。当前 writer 只写 version: 1（composition-root.js:136），重启后的 checkpoint 也沿用 Turn 上的原约束（resume-composition.js:261-263）；src 不写 checkpoint，所以只有改库才能走到 recovery-coordinator.js:213-226 这条检查。
- **涉及测试：** ignores a checksum-valid checkpoint with unsupported recovery constraint version and replays Session events
- 来源：Codex；核实：confirmed；规格行：否；估计行数：30
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/kernel/R4a-frozen-public.test.ts:596（篡改checkpoint例仍在。）

### T2-009 · C38 · helper · tests/kernel/R4a-legacy-fixtures.ts:['18-29', '52-214']
- **动作：** delete（只删旧 writer）：删 R4a-legacy-fixtures.ts:8-29（DatabaseSync/createHash 等导入、canonicalJson、checksum、computeSessionRecordChecksum）和 :52-214（AT、FIXTURE_CONFIG、FIXTURE_WORKSPACE、makeSessionRecord、buildRawTurn、rawInsertRecords）；保留 :31-50 的 TempWorkspace/createTempWorkspace（或挪进一个中性 helper 再删文件）。前提：先删 R4a-frozen-public.test.ts:423-442（C-02）、:627-649（C-03）、:596-625（Codex C13，:616 也用 canonicalJson/checksum），并转换 R4b-session-input-boundaries.test.ts:119-121、R4b-session-recovery.test.ts:183-202。
- **覆盖/依据：** 行为已不存在：HANDOFF 79-1（docs/refactor/HANDOFF.md:565-570，旧格式夹具）；TempWorkspace 仍被 R4a-frozen-public.test.ts:25、87、322、348、444、489、656、721、739 使用
- **核实理由：** 旧 writer 只被 R4a-frozen-public.test.ts:17-19、R4b-session-input-boundaries.test.ts:6、R4b-session-recovery.test.ts:8 导入，可删；但 createTempWorkspace 被 R4a-frozen-public.test.ts:87、348、489、739 的当前格式用例使用，整文件删会打断它们，Codex 对。另外 DSH 的前提漏了 :596-625，它在 :616 也用 canonicalJson/checksum。
- **涉及测试：** canonicalJson/checksum/computeSessionRecordChecksum; FIXTURE_CONFIG/FIXTURE_WORKSPACE/makeSessionRecord/buildRawTurn/rawInsertRecords
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：否；估计行数：185
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：保留目录 helper 或迁移 helper 未冻结；删除 writer 必须晚于消费者转换，和 run 文件统一顺序冲突。 改法：TempWorkspace/createTempWorkspace 留在原文件；先完成 T2-005、007、008、025、030，再删除旧 writer 和专用导入。不新建中性目录 helper，前置项统一使用 T2 编号。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/kernel/R4a-legacy-fixtures.ts:18; tests/kernel/R4a-legacy-fixtures.ts:31; tests/kernel/R4a-legacy-fixtures.ts:54（保留临时目录工具，前置完成后删writer。）

### T2-022 · C11 · duplicate · tests/runtime/K3-19-review-admission-pure.test.ts:['1-122']
- **动作：** merge-into:tests/contracts/review-admission.test.ts::reviewRoundAdmissionProblem（迁入 K3-19-pure:57-63 普通 manifest、:83-87 proposal 缺写工具、:95-99 proposal 多一个工具三项，保持纯函数测试）
- **覆盖/依据：** tests/contracts/review-admission.test.ts:80-177::reviewRoundAdmissionProblem，加上迁入的三项独有输入
- **核实理由：** 逐条对过：K3-19-pure:47/:51/:65/:71/:77/:89/:101/:105/:111/:117 这十项，分别对应 contracts:80/:129/:173/:137/:90/:96/:102/:145/:106/:114，输入和期望的原因码都一样。:57（read+run_readonly_command+shell+edit）、:83、:95 三项 contracts 里没有，迁入后整份文件可以删。文件里的测试名不以规格行号开头。
- **涉及测试：** reviewRoundAdmissionProblem: real review/proposal facts (positive half); reviewRoundAdmissionProblem: combinations the real path cannot produce
- 来源：Codex；核实：confirmed；规格行：是；估计行数：122
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/runtime/K3-19-review-admission-pure.test.ts:57; tests/contracts/review-admission.test.ts:79（与002同一合并，保留三项独有输入。）

### T2-024 · C21 · handwritten · tests/runtime/R4b-session-input-boundaries.test.ts:['45-54']
- **动作：** convert:projects.createProject → projects.registerWorkspace
- **覆盖/依据：** 原测试保留；公开步骤 createProjectBootstrapServices（src/core/work-graph/configuration/project-bootstrap-service.ts:1125），事件 schema 换成 PROJECT_BOOTSTRAP_RECORD_SCHEMAS（project-bootstrap-record-codecs.ts:425）；直接用原始后端的例子 tests/helpers/S1-workflow-archive-fixture.ts:306，平台上的例子 tests/helpers/S4A-note-fixture.ts:178-181
- **核实理由：** R4b-session-input-boundaries.test.ts:45-54 手写 Project/Workspace 快照，加一个测试专用的 TrustedScopeSeeded 事件（:30），然后直接 backend.records.commit。公开的 ProjectRegistrationPort.createProject/registerWorkspace 存在（project-bootstrap-contracts.ts:37-45），只需要 records/now/eventId，S1-workflow-archive-fixture.ts:306 就在原始 backend.records 上这样用。
- **涉及测试：** open()：文件内两项输入及游标边界用例
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：12
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/helpers/S1-workflow-archive-fixture.ts, tests/helpers/S4A-note-fixture.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/runtime/R4b-session-input-boundaries.test.ts:45; tests/helpers/S4A-note-fixture.ts:178（手写scope仍在，公开注册示例适用。）

### T2-025 · C25 · handwritten · tests/runtime/R4b-session-input-boundaries.test.ts:['119-120']
- **动作：** convert:runObservedModel（把 R4c 的 runTurn 和 scriptedClient 抽进 tests/helpers 共用，或者在本文件里复制一份）
- **覆盖/依据：** 原 tests/runtime/R4b-session-input-boundaries.test.ts:106-133 用例保留；当前写法见 tests/runtime/R4c-execution-history.test.ts:80-91（scriptedClient）、:99-113（runTurn），这两个都是文件内函数，没有导出
- **核实理由：** 旧写入器属实：:119-120 用的 rawInsertRecords/buildRawTurn 按自己的注释是“旧二进制”写法，旧正文不带 contextBasis（tests/kernel/R4a-legacy-fixtures.ts:108、:179-183），属于 79-1 要去掉的东西。这条用例需要会话里至少有两条 Kernel 记录，limit 1 时才有 nextCursor（session-operations.ts:499-503），改成真跑一个 Turn 就够。行数估低了：runTurn 不能直接 import，要带上 scriptedClient、预算和 meter，大约 30 行。
- **涉及测试：** rejects history limit outside 1..200 and a continuation cursor from another principal
- 来源：Codex = DSH；核实：partly；规格行：否；估计行数：30
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：共享化和复制两种实现未冻结，共享文件也未命名授权。 改法：新建 tests/helpers/R4-history-turn-support.ts，迁入 scriptedClient、TurnInput、runTurn；R4c 和两份 R4b 共同导入，只接受公开执行输入，不接受手写记录。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/runtime/R4c-execution-history.test.ts
- **刷新（Codex 10-20，对照 w2-base，lead 采纳；以这里为准）：** 已命名的共享helper改封装R7的真实Session、claim、start/finish；不迁入接收自造identity的runTurn。公开读历史取得游标，拒绝例按A6保留。（位置：tests/runtime/R4b-session-input-boundaries.test.ts:119; tests/runtime/R4c-execution-history.test.ts:93; .lead-ref/books/t-w1r1-findings.md:18; tests/helpers/S2B-runtime-steps-fixture.ts:319；说明：原拟抽取的runTurn接受测试自造Kernel身份，不符合R-8。）

### T2-028 · C15 · tamper · tests/runtime/R4b-session-recovery.test.ts:['204-220']
- **动作：** delete
- **覆盖/依据：** 不再要求此篡改专用行为：AGENTS.md:33。真实文件缺失保留 tests/runtime/R4c-execution-history.test.ts:330-332::passes the original boundary through and propagates owner rejections instead of an empty page
- **核实理由：** R4b-session-recovery.test.ts:213-215 直接删 Kernel 库里位置 1 的记录；Kernel 只在 create 时写 session.created，vendor 里唯一的 DELETE 是删 checkpoints（sqlite-stores.js:275,313），所以只有改库才能走到 session-operations.ts:457-460、373-383 的检查。真实文件缺失由 R4c-execution-history.test.ts:330-332 断言 not_found；删后第 7 行 DatabaseSync 导入也不再需要。
- **涉及测试：** rejects missing original Kernel history without returning an empty success page
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：17
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/runtime/R4c-execution-history.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/runtime/R4b-session-recovery.test.ts:204; tests/runtime/R4c-execution-history.test.ts:330（改库例仍在，真实文件缺失覆盖仍在。）

### T2-029 · C23 · handwritten · tests/runtime/R4b-session-recovery.test.ts:['51-61']
- **动作：** convert:projects.createProject → projects.registerWorkspace（用独立工厂 createProjectBootstrapServices({records: backend.records, now, eventId})，schemas 加 PROJECT_BOOTSTRAP_RECORD_SCHEMAS、去掉假事件 TrustedScopeSeeded）
- **覆盖/依据：** 原文件 72-202 用例保留；独立工厂用法实例 tests/work-graph/R5a-project-bootstrap.test.ts:74,87；公开步骤 src/core/work-graph/configuration/project-bootstrap-service.ts:1125-1130
- **核实理由：** 核心成立：R4b-session-recovery.test.ts:51-61 手写 Project/Workspace 快照和假事件直接 commit，公开 owner 存在且写的就是同样的快照（project-bootstrap-service.ts:49,1129-1130）。但这里没有 createTargetPlatform，要用独立工厂并改 35-40 的 schemas 和导入，行数约 16 而不是 11；S4A 例子走的是整个平台。
- **涉及测试：** open()：恢复和游标用例
- 来源：Codex；核实：partly；规格行：否；估计行数：16
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/runtime/R4b-session-recovery.test.ts:51; src/core/work-graph/configuration/project-bootstrap-service.ts:1125（独立bootstrap工厂转换仍成立。）

### T2-030 · C26 · handwritten · tests/runtime/R4b-session-recovery.test.ts:['184-185', '192-193', '197']
- **动作：** convert:runObservedModel → readSessionHistory → runObservedModel → readSessionHistory（上界从第一轮公开历史取得，替换写死的 6；同时去掉 R4a-legacy-fixtures 导入）
- **覆盖/依据：** 原 tests/runtime/R4b-session-recovery.test.ts:174-202 用例保留；写入实例 tests/runtime/R4c-execution-history.test.ts:80-113::scriptedClient/runTurn
- **核实理由：** 核心成立：184-185、192-193 用 buildRawTurn 直插，而 R4a-legacy-fixtures.ts:108 写明这是旧 Turn 形状（缺 contextBasis/recoveryConstraints），按 79-1 更该换；runObservedModel 是生产在用的步骤（execution-driver.ts 引用），R4c-execution-history.test.ts:157-158 已在同类夹具上跑两轮。但 R4b 文件没有 scriptedClient/runTurn，要补约 30 行辅助和导入，5 行的估计太少。
- **涉及测试：** binds raw history continuation to its original adapter, Session and upper record position
- 来源：Codex = DSH；核实：partly；规格行：否；估计行数：40
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：从第一轮输出提取数字上界作为期望违反书中期望值规则，首张限长页末位置也不是整轮上界。 改法：使用共享 runTurn，以预先给定且不同的两轮 runId/turnId 执行；保留第一张 limit:2 页和非空续页游标。第二轮后沿旧游标读到结束，断言续页非空、每条记录属于第一轮固定身份且没有第二轮身份；删除数字6断言，保留跨 Session 拒绝，不解码游标生成期望。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/runtime/R4c-execution-history.test.ts
- **刷新（Codex 10-20，对照 w2-base，lead 采纳；以这里为准）：** 同一Session真实执行两次，两次Kernel身份从readExecution取得。保留首张limit:2页，第二次后沿旧游标读完并验证非空且仅属第一次；取消固定身份和数字6，跨Session拒绝按A6保留。（位置：tests/runtime/R4b-session-recovery.test.ts:184; tests/runtime/R4b-session-recovery.test.ts:192; src/core/agent-runtime/execution-driver.ts:620; .lead-ref/books/t-w1r1-findings.md:18；说明：固定runId/turnId的书面改正须服从R-8。）

### T2-031 · C16 · tamper · tests/runtime/R4c-execution-history.test.ts:['322-328']
- **动作：** delete
- **覆盖/依据：** 不再要求此篡改专用行为：AGENTS.md:33。原测试 308-320（forbidden 透传）、330-341（not_found、not_ready 透传）保留
- **核实理由：** R4c-execution-history.test.ts:322-326 把 Kernel 库位置 1 的 record_json 改成 {}，只有改库才能走到 session-operations.ts:373-383 的 corrupt→unavailable；Kernel 不会改写已存记录。拒绝透传这件事仍由同一测试的 forbidden/not_found/not_ready 三段覆盖，后面 330 行的 unlink 不依赖这一段。
- **涉及测试：** passes the original boundary through and propagates owner rejections instead of an empty page
- 来源：Codex；核实：confirmed；规格行：否；估计行数：7
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/runtime/R4c-execution-history.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/runtime/R4c-execution-history.test.ts:322（改库段仍在，保留相邻拒绝透传。）

### T2-032 · C24 · handwritten · tests/runtime/R4c-execution-history.test.ts:['52-62']
- **动作：** convert:projects.createProject → projects.registerWorkspace（用独立工厂 createProjectBootstrapServices({records: backend.records, now, eventId})，schemas 加 PROJECT_BOOTSTRAP_RECORD_SCHEMAS、去掉假事件 TrustedScopeSeeded）
- **覆盖/依据：** 原执行历史测试保留；独立工厂用法实例 tests/work-graph/R5a-project-bootstrap.test.ts:74,87；公开步骤 src/core/work-graph/configuration/project-bootstrap-service.ts:1125-1130
- **核实理由：** 核心成立：R4c-execution-history.test.ts:52-62 与 C23 同样手写快照和假事件，公开 owner 存在（project-bootstrap-service.ts:1129-1130）。同样要改 37-42 的 schemas 和导入，行数约 16；S4A 例子走 createTargetPlatform，这里应照 R5a 用独立工厂。
- **涉及测试：** open()：执行历史读取用例
- 来源：Codex；核实：partly；规格行：否；估计行数：16
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/runtime/R4c-execution-history.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/runtime/R4c-execution-history.test.ts:52（手写scope仍未转换。）

### T2-033 · C18 · tamper · tests/runtime/R4c-kernel-history-range.test.ts:['420-586', '594-598']
- **动作：** delete：452-586 的六条改库防御用例（DSH 写的 456 应为 452，it.each 从 452 开始）＋ 420-434、436-450 两条页外损坏读取 ＋ 隔离用例里 594-598 的改库段（隔离用例其余部分保留）；顺带删掉没人再用的 mutateDatabase（:159-166），文件头 :17-19、:23-24 相应改写
- **覆盖/依据：** 452-586：不再要求只有改库才能触发的检查（AGENTS 第 4 条）。420-434：同一个 total-3,3 读取的有界取行由 :385-418 reads a small back page through a bounded primary-key range 断言（fetchedRows≤11，有 LIMIT 和主键范围）。436-450：lastPosition 是整个 Session 的尾由 :247-265 和 :267-288 断言，只多一个「尾记录正文坏了也能报尾」，这只在改库时才看得出。隔离：:600-608 去掉改库段后照样断言两个 Session 互不影响
- **核实理由：** 452-586 六条都是 seedSession 后用 mutateDatabase 改 position、改正文或删行（:462、:490-506、:525、:540-542、:561、:577），再断言 corrupt，两边一致。分歧在 420-450 和 594-598：它们测的确实不是防御检查，而是检查不发生，但前提同样是 SQL 改正文（:426、:442、:596），数据正常时看不出任何区别。它们要证明的范围读取性质已由 :385-418 的 SQL 计数和 :247-288 的 lastPosition 断言覆盖，所以 Codex 的范围对。
- **涉及测试：** reads a back page even when a front record payload is damaged outside the range; still reports the tail position when the tail payload is damaged outside the range; rejects a %s tail key as corrupt and cleans up the read snapshot; rejects damaged, schema-invalid and checksum-invalid records inside the requested page; rejects a gap in the middle of the requested range; rejects a database position that contradicts the record payload position; rejects a database Session key that contradicts the record payload Session; keeps append/replay full-history validation after a reopen even though read is ranged; isolates Sessions so damage and tails never leak across them（仅损坏注入段）
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：否；估计行数：180
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/runtime/R4c-kernel-history-range.test.ts:420; tests/runtime/R4c-kernel-history-range.test.ts:452; tests/runtime/R4c-kernel-history-range.test.ts:594（原删除范围仍适用。）

### T3-001 · E1-20 · handwritten · tests/app/A2-host-instance-lease.test.ts:['65', '113-115']
- **动作：** convert:acquireHostInstanceLease(pid 5000, isAlive 恒真) → 以 isAlive(pid≠5000) 竞争/接管；K3-34 期望改用返回的 hostInstanceId
- **覆盖/依据：** src/app/host-instance-lease.ts:113-170::acquireHostInstanceLease；同文件 49-58 已用此路径
- **核实理由：** 第 65、113 行手写的锁内容与 acquireHostInstanceLease 写出的完全相同（host-instance-lease.ts:122-123 写 {pid,hostInstanceId,startedAt}），先获取再让 pid 不存活即得同一陈旧锁；获取用的临时文件在 finally 删掉（:169），第 80 行“目录为空”的断言不受影响。价值不大但说法成立。
- **涉及测试：** HL-03 is exclusive: two Hosts starting together on one stale lock leave exactly one owner, whose lock stays in place; K3-34 labels the takeover proof: HL-01, HL-03 (old instance id and pid), memory, and null when held
- 来源：Codex；核实：confirmed；规格行：是；估计行数：6
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/A2-host-instance-lease.test.ts:65,113（两处手写锁仍需按原动作转换。）

### T3-002 · E1-25 · handwritten · tests/app/A2-runtime-capabilities.test.ts:['244', '262']
- **动作：** convert:启动 Host → POST SETTINGS_API_PREFIX automation/save → close → 重开
- **覆盖/依据：** src/app/host-settings.ts:59,831-850::automation/save（Host HTTP 已发布，见 tests/app/RL-44-host-restart-resource-caps.test.ts:92 的同类用法）；保留 A2-runtime-capabilities.test.ts:248-268 的断言
- **核实理由：** writeAutomationSettings（tests/helpers/A2-restart-fixture.ts:218-224）直接拼 host-settings.json；SQLite Host 默认把设置放在 database/host-settings（host.ts:327-328），automation/save 已是发布的设置路由，存盘后重开读到同一策略。注意 helper 另有约 40 处使用（scenarios 等），本条只改这一文件，helper 不能删。
- **涉及测试：** says in the recoverRun reason that this Host has the setting automation.resumeOnStartup off, with or without the instance lease (LA-6, L-10)
- 来源：Codex；核实：confirmed；规格行：是；估计行数：8
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/helpers/A2-restart-fixture.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/A2-runtime-capabilities.test.ts:244,262; src/app/host-settings.ts:831（公开保存设置后关闭、重开。）

### T3-003 · E1-27 · helper · tests/app/A2-runtime-capabilities.test.ts, tests/app/K-R-runtime-capabilities.test.ts:A2-runtime-capabilities:60-97; K-R-runtime-capabilities:39-74
- **动作：** merge-into:抽到 tests/helpers（directory/startHost/readCapabilities，参数 scope、adapterId、名称），A2 与 K-R 共用
- **覆盖/依据：** 同一构造器的另一份
- **核实理由：** A2-runtime-capabilities.test.ts:60-97 与 K-R-runtime-capabilities.test.ts:39-74 的 directory、startHost、readCapabilities 除 a2-*/ka17-* 的 id 和名称外完全相同；K-R:9-11 自述是为不改冻结文件而复制，T 轮可以合并。
- **涉及测试：** reports continuation, safe-point pause, cancel and start-up reconciliation…；KA-17 reports…
- 来源：DSH；核实：confirmed；规格行：否；估计行数：35
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：共享夹具没有固定文件名，且缺少白名单项。 改法：固定新文件为 tests/helpers/runtime-capabilities-fixture.ts；抽取 directory/startHost/readCapabilities，保留两调用方的 scope、adapter、名称、时钟和清理行为。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/A2-runtime-capabilities.test.ts:60; tests/app/K-R-runtime-capabilities.test.ts:39（按书面改正抽共享夹具。）

### T3-004 · E1-12 · duplicate · tests/app/A2-settings-automation.test.ts:['95-104']
- **动作：** merge-into:tests/app/A2-settings-automation.test.ts::stores the whole policy, pushes it to the Host and publishes it; a reopened Host reads it back
- **覆盖/依据：** tests/app/A2-settings-automation.test.ts:125-149
- **核实理由：** 95-104 的三条断言（启动读出、models/save 后仍存着、重开读回）在 135-143 逐条都有（:138-139 另一设置保存后保留，:141-142 重开读回）；唯一差别是值 0/false 在启动读取时的情形（:145-147 只测保存边界），合并时参数化保留，与 finding 一致。
- **涉及测试：** a stored policy is read as stored and survives the next save
- 来源：Codex；核实：confirmed；规格行：否；估计行数：12
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/A2-settings-automation.test.ts:95,125（合并时保留零值和false的重开断言。）

### T3-006 · E1-05 · duplicate · tests/app/R6-workbench.test.ts:302-368（历史子块）
- **动作：** merge-into:tests/app/session-rendering.test.ts::keeps every original record reachable in raw form and in original order（先把 R6 独有的四条断言搬过去：原始记录展开默认收起、cursor、position、artifact 正文未读取）
- **覆盖/依据：** tests/app/session-rendering.test.ts:395-437（只管用户/助手正文、原始顺序、未知记录、recordId）
- **核实理由：** 真正重复的只有用户/助手正文、原始顺序、未知记录、data-history（R6:353-354,362-363,366 对 session-rendering:404-405,412-437）。DSH 引的另外两处对照是错的：session-rendering:428-430 没断言原始记录展开默认收起，:434-435 是顺序，不是 cursor/position。全 tests/ 只有 R6 断言 'kernhist1.1'、'position 1'、data-history-body="artifact" 和 '正文未读取'（R6:357-360,364-368）。所以这四条要先搬过去，才能删 R6 的这段历史。
- **涉及测试：** projects real original history in order and keeps task hierarchy separate from execution dependencies and real work links
- 来源：DSH；核实：partly；规格行：否；估计行数：40
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/app/R6-workbench.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/R6-workbench.test.ts:314,358; tests/app/session-rendering.test.ts:407（来源历史块现至369行，独有断言仍须搬入。）

### T3-007 · E1-13 · duplicate · tests/app/RL-34-wiring-resource-caps.test.ts:['101-112']
- **动作：** merge-into:tests/app/RL-34-wiring-resource-caps.test.ts::RL-34 a Work reads the old value then the new value across two calls and its prepared execution carries no caps
- **覆盖/依据：** tests/app/RL-34-wiring-resource-caps.test.ts:177-199
- **核实理由：** 101-112 和 177-199 用同一个 workShellFixture、同样先存 300/100；f.run 就是 prepareExecution+startRun（tests/helpers/S2B-be1-platform-fixture.ts:300-311），177 的 :198 断言 currentReads 等于 [EXPECTED_SAVED, EXPECTED_SECOND]，第一项正是 101 的断言。RL-34 行（slice-RL-SPEC.md:770）的“Work 的 shell”一处仍被覆盖。
- **涉及测试：** RL-34 a saved setting reaches the Work shell and is read as bytes at execute
- 来源：Codex；核实：confirmed；规格行：是；估计行数：12
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/RL-34-wiring-resource-caps.test.ts:101,177（原合并成立。）

### T3-008 · E1-14 · duplicate · tests/app/RL-34-wiring-resource-caps.test.ts:['155-175']
- **动作：** merge-into:tests/app/RL-44-host-restart-resource-caps.test.ts::RL-44 a live save reaches the next command through the production holder without a restart（测试名或注释补上 RL-34“工作台命令页”一处）
- **覆盖/依据：** tests/app/RL-44-host-restart-resource-caps.test.ts:132-149
- **核实理由：** RL-44 :140-143 经真实 Host 的 resource-caps/save 和 commands/start 断言下一条命令读到换算成字节的保存值，比 RL-34 :155-175 手装 createWorkbenchTools 更完整（连 Host 接线也测了）。只差 RL-34 行写的 300/100 换成了 700/321，行为相同；合并时把 RL-34 行号带过去即可。
- **涉及测试：** RL-34 a saved setting reaches the workbench command page
- 来源：Codex；核实：confirmed；规格行：是；估计行数：21
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：允许只在注释保留 RL-34，与总书要求规格编号进入目标测试名冲突。 改法：目标测试名同时保留 RL-44 和 RL-34，并注明工作台命令页覆盖；删除“或注释”。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/RL-34-wiring-resource-caps.test.ts:155; tests/app/RL-44-host-restart-resource-caps.test.ts:132（目标名称保留RL-34和RL-44。）

### T3-010 · E1-22 · handwritten · tests/app/S2B-35-activity-routes.test.ts:['200-204']
- **动作：** convert:acquireHostInstanceLease
- **覆盖/依据：** src/app/host-instance-lease.ts:113::acquireHostInstanceLease；保留 tests/app/S2B-35-activity-routes.test.ts:291-299 的 held_by_other 与 busy 断言
- **核实理由：** tests/app/S2B-35-activity-routes.test.ts:200-204 手写 {pid: process.pid, hostInstanceId, startedAt} 锁文件；公开的 acquireHostInstanceLease（host-instance-lease.ts:113-122,154-156）用 process.pid 写出同样形状的锁，下一个 Host 读到活 pid 得 HL-02 held_by_other（:185），和 :294 的断言一致。
- **涉及测试：** startHost(lock)；2B-35 无租约路由用例
- 来源：Codex；核实：confirmed；规格行：是；估计行数：5
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/app/S2B-35-activity-routes.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/S2B-35-activity-routes.test.ts:196; src/app/host-instance-lease.ts:113（手写锁仍需换真实租约。）

### T3-011 · E1-21 · handwritten · tests/app/S2B-41-decision54-backfill-bound.test.ts:218-223
- **动作：** convert:RuntimeExecutionPort.closeOpenTurn（先用 TaskRequeueService 记一次人的继续，再给 createAgentRuntime 注入 turnClosure{lease:'owned', recordSessionHealth}；删掉 :218-232 的直调 Kernel closeOpenTurn 和手写健康写入）
- **覆盖/依据：** 转换后 aFinal 的 counted/recorded_late/countedThroughTurnEnd:true 与 B 不变的断言照旧
- **核实理由：** 测试在 S2B-41:218-223 绕过 Runtime 直接用 vendor closeOpenTurn 关 Turn，:224-232 再手写健康；公开步骤 runtime.ts:142-401 存在，规格 slice-2B-SPEC.md:792 写的就是“你点继续”后由 K 片 A 关。但 RUN-24 不是“可能”而是必须有被授权的 TaskRequeue（runtime.ts:303-306），还要注入 turnClosure（runtime.ts:266-268，夹具 S2B-runtime-store-fixture.ts:199-200 没有），健康由 settleHealth 自己写（runtime.ts:219-233），改动约 25 行而不是 6 行。
- **涉及测试：** 2B-41 (BE3): the automatic backfill bounds A by its own closed Turn, excludes B, and is not capacity
- 来源：DSH；核实：partly；规格行：是；估计行数：25
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/app/S2B-41-decision54-backfill-bound.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/S2B-41-decision54-backfill-bound.test.ts:214,226; src/core/agent-runtime/runtime.ts:266,303（先真实requeue授权，再由Runtime关闭并更新健康。）

### T3-012 · E1-29 · helper · tests/app/S2B-41-decision54-backfill-bound.test.ts:81-85,108-126
- **动作：** merge-into:tests/helpers/S2B-be2-reconcile-support.ts::withTool/controlsOn
- **覆盖/依据：** tests/helpers/S2B-be2-reconcile-support.ts:71-92
- **核实理由：** S2B-41:108-115 的 withTool 与 S2B-be2-reconcile-support.ts:83-92 逐字相同；controlsOn（:117-126）与共享版 :71-80 只差 eventId 前缀，文件里没有任何断言用到 s2b-41-control-event（只在 :124 出现），换用共享版后 :35、:36、:39 三个 import 也可删。lines 里的 81-85 是 deferred，属于 E1-30，不要重复计数。
- **涉及测试：** 2B-41 (BE3): the automatic backfill bounds A by its own closed Turn…
- 来源：DSH；核实：confirmed；规格行：否；估计行数：22
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/app/S2B-41-decision54-backfill-bound.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/S2B-41-decision54-backfill-bound.test.ts:104,113; tests/helpers/S2B-be2-reconcile-support.ts:71,83（重复函数仍可合并。）

### T3-013 · E1-21 · handwritten · tests/app/S2B-backfill-host.test.ts:['146-148']
- **动作：** convert:acquireHostInstanceLease
- **覆盖/依据：** src/app/host-instance-lease.ts:113::acquireHostInstanceLease；保留 tests/app/S2B-backfill-host.test.ts:159-172::2B-20 行为断言
- **核实理由：** tests/app/S2B-backfill-host.test.ts:146-148 手写活 pid 的锁 JSON，和 E1-22 同一模式；acquireHostInstanceLease({directory, now}) 能生成同样的前置状态（host-instance-lease.ts:113-156），:159 的 held_by_other 照样成立。
- **涉及测试：** 2B-20 a Host without the instance lease writes no recording and no backfill
- 来源：Codex；核实：confirmed；规格行：是；估计行数：5
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/app/S2B-backfill-host.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/S2B-backfill-host.test.ts:139; src/app/host-instance-lease.ts:113（手写锁仍需换真实租约。）

### T3-014 · E1-15 · trivial · tests/app/S4C2-scribe-reminders.test.ts:719-730
- **动作：** delete
- **覆盖/依据：** tests/app/S4C2-scribe-reminders.test.ts:471-509（D-03）
- **核实理由：** D-03 的 Host 没有覆盖收件人解析，走的是生产 platform.notes.resolveScribeRecipient（host.ts:1261,1401；hostOptionsFor:136-153 没传 resolveScribeRecipient）。两个 scribe 里较小的 id 是后建的 pair-b（S4C2:464-465），D-03 断言 requestId 带它、它的收件箱 1 条、另一个 0 条（:485-489）；解析规则一改，D-03 就会失败，和 :719-730 的单测一样能区分。
- **涉及测试：** S4C2 real recipient resolver: two scribes, the smallest session id wins
- 来源：DSH；核实：confirmed；规格行：否；估计行数：12
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/S4C2-scribe-reminders.test.ts:719,471（原删除及覆盖成立。）

### T3-016 · E1-15 · duplicate · tests/app/S8A-L8-auto-capture-gate.test.ts:['502-524']
- **动作：** merge-into:tests/app/S8A-L8-host-close-restart.test.ts::K5-01/K5-02: A running and B queued stay pending across close, and a new Host retries each once (sqlite)（删 S8A-L8-auto-capture-gate.test.ts:501-525 整个 describe，并去掉随之无人用的 openPlatform directory 选项和 CloseScenario.directory）
- **覆盖/依据：** tests/app/S8A-L8-host-close-restart.test.ts:103-139::K5-01/K5-02: A running and B queued stay pending across close, and a new Host retries each once (sqlite)
- **核实理由：** 门控文件 502-524 在重开的平台上直接调 driver.retryPending（:508），断言 A/B 的 seq=2、startup_retry、pending=false、current 非空、两门都进入；K5-01/K5-02（host-close-restart.test.ts:119-131）用真实 Host 启动（host.ts:1078 调的是同一个 retryPending）做了同样断言，而且多证明了 Host 接线。删后 openPlatform 的 directory 选项和 CloseScenario.directory（auto-capture-gate.test.ts:178-180、462、492）没人用，可一起去掉；closeWithQueuedSecondCapture 仍被 :384 使用。
- **涉及测试：** retries the pending requests of the bound workspaces (sqlite)
- 来源：Codex；核实：confirmed；规格行：是；估计行数：27
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/S8A-L8-auto-capture-gate.test.ts:502; tests/app/S8A-L8-host-close-restart.test.ts:103（原合并和参数清理成立。）

### T3-017 · E1-16 · duplicate · tests/app/S8A-L8-auto-capture-host.test.ts:['168-185']
- **动作：** merge-into:tests/app/S8A-L8-auto-capture-host.test.ts::the manual architecture/capture route still works（删 S8A-L8-http-watermark.test.ts:60-82，改文件头 :9-11 的说明）
- **覆盖/依据：** tests/app/S8A-L8-auto-capture-host.test.ts:167-186
- **核实理由：** 两处请求体、pins、断言相同（watermark:71-80 对 auto-capture:175-183）。auto-capture 那份属于冻结规格 A-04 行，行里写明“设置页按钮照旧能做手动抓取”（slice-8-SPEC.md:416），按规则应留规格行那份；watermark 正例多出的 baselineCapture、baselineSeq===1 已由同文件拒绝行断言（watermark:36-39），删掉不丢东西，所以留 auto-capture 那份。
- **涉及测试：** the manual architecture/capture route still works (${backend})
- 来源：冲突裁定（采用 dsh）；核实：confirmed；规格行：是；估计行数：23
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/S8A-L8-http-watermark.test.ts:60; tests/app/S8A-L8-auto-capture-host.test.ts:168（删除watermark正例，保留手动抓取规格行。）

### T3-018 · E1-09 · duplicate · tests/app/S8A-L8-capture-start.test.ts:215-231,255-269
- **动作：** merge-into:tests/work-graph/S8A-L8-observation-state.test.ts::L8-7/L8-8（L8-7 加一个 forbidden 透传变体）
- **覆盖/依据：** tests/work-graph/S8A-L8-observation-state.test.ts:671-715（L8-7/L8-8）
- **核实理由：** 抛错那条（capture-start:255-269）L8-8 全都覆盖了：同样是 unavailable、原因、requestSeq 1、failed、pending，L8-8 还多断言旧观测保留（:695-715）。被拒那条 L8-7 注入的是 unavailable（:385-386），所以 capture-start:218-228 的 forbidden 原样透传是它独有的，DSH 已经说明要作为变体并入。两边都不是冻结规格行。
- **涉及测试：** a rejected start state read goes to the failure exit with its code and reason；a start state read that throws maps to unavailable while the signal is not aborted
- 来源：DSH；核实：confirmed；规格行：否；估计行数：24
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：目标先有旧观测且只检查原因子串，未覆盖来源 current:null 和精确原因断言。 改法：L8-7/L8-8 均加入无旧观测来源变体，搬入完整 code、精确 reason、requestSeq、pending、failed、current:null；保留已有旧观测变体，再删除来源。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/S8A-L8-capture-start.test.ts:215,255; tests/work-graph/S8A-L8-observation-state.test.ts:671,695（按书面改正加入无旧观测变体和精确原因。）

### T3-019 · E1-10 · duplicate · tests/app/S8A-L8-capture-start.test.ts:310-361
- **动作：** merge-into:tests/work-graph/S8A-L8-observation-state.test.ts::L8-9/L8-10/L8-11（把 counts.capture/failure/state 计数一起搬过去）
- **覆盖/依据：** tests/work-graph/S8A-L8-observation-state.test.ts:717-796（L8-9/10/11）
- **核实理由：** capture-start:310-361 的三种取消（被拒、抛错、返回 ready），L8-9/10/11 用同一个 startStateRead 握住再 close 的做法都测了（:370-391），断言 requested、pending、failure null 和旧观测保留。capture-start 独有的只有调用计数（:352-354），并入时要带过去。
- **涉及测试：** L8 capture start cancellation [memory|sqlite]: writes nothing when the start state read is cancelled while it rejects/throws/ready
- 来源：DSH；核实：confirmed；规格行：否；估计行数：52
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：来源三种取消场景的 current:null 没有被目标旧观测场景覆盖。 改法：L8-9/L8-10/L8-11 各加入无旧观测变体，保留 current:null 及 failure=0、capture=0、state=1；保留目标原有旧观测断言。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/S8A-L8-capture-start.test.ts:310; tests/work-graph/S8A-L8-observation-state.test.ts:717,745,771（保留三种无旧观测变体及计数。）

### T3-020 · E1-31 · helper · tests/app/S8A-L8-capture-start.test.ts:114-117,120,150-154
- **动作：** delete
- **覆盖/依据：** 无（未被任何测试使用）
- **核实理由：** 全 tests/ 和 src/ 只有 S8A-L8-capture-start.test.ts:115 和 :120 两处出现 PlatformAdapters；openPlatform 的八处调用（:216、:235、:256、:272、:285、:313、:393、:413）最多传两个参数，所以 :150 的 adapters 条件和 :154 的 bodies 分支永远走不到。RawArtifactStorePort 只在 :28 导入、:116 使用；文件没有导出，也没有别的文件引用它。
- **涉及测试：** openPlatform / PlatformAdapters（测试支撑代码）
- 来源：DSH；核实：confirmed；规格行：否；估计行数：6
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/S8A-L8-capture-start.test.ts:114,150（原删除范围成立。）

### T3-021 · E1-24 · handwritten · tests/app/host-settings.test.ts:833-894
- **动作：** convert:Host queries/start（scripted model 回带 setup.checks 的 plan JSON）+ settings workspaces/open + checks/approve
- **覆盖/依据：** 入口已存在：src/app/host.ts:979-1001、src/app/core-routes.ts:414、src/app/host-settings.ts:754-795
- **核实理由：** host-settings.test.ts:855-880 用测试自己的 Map 和替身 readCheckProposal 返回“已保存 Answer”；真实读法 host.ts:979-1001（readQueryAnswer + parseInitialPlanningResponseV2 解 setup.checks，initial-plan.ts:50-98）全 tests/ 没有测试，checks/approve 只在本测试调用（:882-889）。queries/start 路由和 settings 路由都在，能造出同样的已保存 Answer 与授权工作区；只会丢掉 :883 对替身调用记录的断言。
- **涉及测试：** HOST settings workspace check approval (R6 cold-start): uses authoritative saved proposal facts…
- 来源：DSH；核实：confirmed；规格行：否；估计行数：62
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** src/app/host.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/host-settings.test.ts:833; src/app/host.ts:979,993（真实Answer及setup.checks路径仍在。）

### T3-023 · E1-13 · trivial · tests/app/orchestration-mechanism.test.ts:28-34
- **动作：** delete
- **覆盖/依据：** tests/app/S3-attention-context.test.ts:238-248（AT01）
- **核实理由：** orchestration-mechanism:28-34 对未变化快照断言 observe 为 null、processed 为 null；AT01 在 Host 的 prime→observe 顺序下断言三次 null、send 0、processed null（S3:241-247），覆盖更多。唯一差别是 mechanism 不先 prime，但 Host 循环总会先 prime（S3:199-200），所以不 prime 不是真实路径。
- **涉及测试：** produces no delivery and no model work when nothing changed
- 来源：DSH；核实：confirmed；规格行：否；估计行数：7
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/app/S3-attention-context.test.ts, tests/app/orchestration-mechanism.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/orchestration-mechanism.test.ts:28; tests/app/S3-attention-context.test.ts:238（原删除及覆盖成立。）

### T3-024 · E1-26 · helper · tests/app/support/S8A-L8-host.ts:['32', '58', '177', '295']
- **动作：** delete（只去掉 Started、delay、StateReply、CaptureGateEntry 四个 export 修饰符）
- **覆盖/依据：** tests/app/support/S8A-L8-host.ts 模块内部仍使用（startHost 返回类型、waitState 用 delay、observationState 返回 StateReply、CaptureGate 引用 CaptureGateEntry）
- **核实理由：** 这个模块只被四个 S8A-L8 测试导入（auto-capture-host:13-17、host-close-restart:22-27、host-restart:18-21、http-watermark:15-18），它们都不导入这四个名字，src 里也没有导入方；tsconfig.json 没开 declaration，去掉 export 不影响编译。
- **涉及测试：** Started、delay、StateReply、CaptureGateEntry 的导出
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：4
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/support/S8A-L8-host.ts:32,58,177,295（只去四处export。）

### T3-025 · E1-18 · trivial · tests/app/ui-refresh.test.ts:['183-198']
- **动作：** delete tests/app/ui-refresh.test.ts:183-198，同时把 tests/app/ui-live.test.ts:370-375 改为发 reset 前先取 loop.counts() 快照，再断言两路各 +1
- **覆盖/依据：** tests/app/ui-live.test.ts:331-389::runs the loops on every ready, and the watches on reset or an unresumable reconnect only（需按 action 补强 :375）
- **核实理由：** catchUp(false) 跑两路各一次、不跑 watch（ui-live:341-342,363-364），以及 catchUp(true) 跑 watch（:352,374），都已用真实 hub 加 live 连接断言过（live.ts:177,186）。但 catchUp(true) 也把每路跑一次，只在 :375 断言了 driver 计数“变大”；fallback 计时器在 :367-369 本来就会让它变大，等于没测到，所以要先补这一处再删。
- **涉及测试：** catches up every loop once, and the watches only when asked
- 来源：Codex；核实：partly；规格行：否；估计行数：18
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/ui-refresh.test.ts:183; tests/app/ui-live.test.ts:370（先补reset前后计数断言，再删来源。）

### T3-026 · E1-19 · trivial · tests/app/ui-store.test.ts:['219-222']
- **动作：** delete（连同 ui-store.test.ts:28 不再使用的 state 导入）
- **覆盖/依据：** tests/app/ui-actions.test.ts:71-75::read the selected scope before the lookup, like the old switch
- **核实理由：** ui-actions.test.ts:72-74 在 selectedKey 为空时经 handleAction 断言同一句 'the workbench has no selected scope'；handleAction 第一步就调 workbench.ts:87-91 的同一个 state()（actions.ts:9,31-32）。
- **涉及测试：** throws from state() while no scope is selected
- 来源：Codex；核实：confirmed；规格行：否；估计行数：5
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/app/ui-store.test.ts:219; tests/app/ui-actions.test.ts:71（原删除成立。）

### T3-027 · E2-07 · duplicate · tests/business/A2-workflow-auto-rework.test.ts:242-260
- **动作：** merge-into:tests/scenarios/C8-human-stop-respected.test.ts::AV-4 (STEP5-FLIPS §14): a pause superseded by the natural completion fences rework only; the round opens, passes and completes the Task
- **覆盖/依据：** tests/scenarios/C8-human-stop-respected.test.ts:420-470
- **核实理由：** A2-workflow-auto-rework.test.ts:242-260 在 owner 替身上断言 task_paused 的 fenced Task 被选出 open_checks、PASS 头给 complete_task、没调 requeue；C8:453-468 用真实 Host 断言同一 verdict 行、open_checks→run_check→finalize_checks→complete_task、Task satisfied 且 rework/requeueRef 都没有。A2 独有的只是精确请求字段，合并时可带过去。
- **涉及测试：** AV-4 (STEP5-FLIPS §14): a fenced Task whose Run completed has its round opened by the selection, and its PASS head completed; AV-4 (STEP5-FLIPS §14): a pause superseded by the natural completion fences rework only; the round opens, passes and completes the Task
- 来源：DSH；核实：confirmed；规格行：是；估计行数：19
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/business/A2-workflow-auto-rework.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/business/A2-workflow-auto-rework.test.ts:243; tests/scenarios/C8-human-stop-respected.test.ts:420（原合并成立，来源起点已移动。）

### T3-029 · E2-01 · stale · tests/business/K3-41-release-hold.test.ts:306-362
- **动作：** merge-into:tests/business/K3-41-release-hold.test.ts::K3-41 (三) SQLite Host: a real crash after the releaseHold commit and before the requeue replays the same request and claims exactly one continuation（删 306-353 的 Goal pause 替身；355-362 的 F-044 注释属于下一条，保留；文件头 9-12 行的替身说明一起改）
- **覆盖/依据：** tests/business/K3-41-release-hold.test.ts:438-460（同一请求重放、一次接续）；tests/scenarios/K3-29-extras.test.ts:86-99（Goal 暂停时 requeue busy、记录 released）
- **核实理由：** 核心成立：K3-41-release-hold.test.ts:356-361 明说 Goal pause 不再替代崩溃，真实崩溃版在 364-467，busy+released 在 K3-29-extras.test.ts:86-99 同样断言。但先被 busy 拒绝、同一 requestId 再点后 requeue 才提交（322、336-338）这一路径别处没有，合并时要么带过去要么明确放弃；DSH 的 306-362 把下一条测试的注释也算进去了，实际是 48 行。
- **涉及测试：** K3-41 (三) memory/sqlite Host: a crash between the two steps leaves `released` and no requeue; the re-click replays and requeues exactly once
- 来源：DSH；核实：partly；规格行：是；估计行数：48
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：busy 后恢复 Goal、同一 requestId 再成功的行为仍是未决取舍。 改法：目标参数化为真实崩溃和 Goal 暂停后恢复两种前置；暂停分支保留 busy、恢复、同一请求 hold 重放、requeue 首次提交及仅一个 continuation 的断言。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/business/K3-41-release-hold.test.ts:306,364（按书面改正保留两种前置。）

### T3-035 · E2-07 · handwritten · tests/composition/A1-graph-session-platform.test.ts:[[41, 56], [61, 61]]
- **动作：** convert:projects.createProject → projects.registerWorkspace
- **覆盖/依据：** tests/composition/A1-graph-session-platform.test.ts:233-241（同文件第二个测试已用公开入口）；保留原测试的Session发现、归档、重开及历史断言。
- **核实理由：** A1-graph-session-platform.test.ts:41-56 手工编码Project/Workspace，还提交了一个自造的TrustedScopeSeeded事件；同文件:233-241用createProject、registerWorkspace得到同样的rev 1快照，之后:249照样以project/workspace rev 1采用。这两个入口今天已经存在（core-routes.ts:372-373、create-platform.ts:1314-1315）。
- **涉及测试：** creates before a baseline, discovers module-linked Sessions, and preserves identity/history through archive and reopen
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：17
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/composition/A1-graph-session-platform.test.ts:41,233（同文件公开登记路径仍适用。）

### T3-036 · E2-11 · duplicate · tests/composition/K-R-previous-turn-bounds.test.ts:93-98
- **动作：** merge-into:tests/composition/K-R-previous-turn-bounds.test.ts::KA-09 (Runtime, L9/D8): an absent readTurnBounds is never needed for a recorded end, and the continuation brief is still built（方向反过来：保留 seam.absent=true 那一次，把第 1 条的 86-89 四个断言搬进去，删掉计数那一次）
- **覆盖/依据：** tests/composition/K-R-previous-turn-bounds.test.ts:93-98（接缝不在时一旦被调用，session-operations.ts:1019-1021 回 unsupported，continuation-brief-assembly.ts:574-575 回 retry，说明建不出来，测试就失败）
- **核实理由：** 两条确实跑同一个流程、都能抓到“有结束位置还去调接缝”，但“接缝在不在不影响可观察结果”不对：接缝不在时被调用会让说明建不出来（session-operations.ts:1019-1021，continuation-brief-assembly.ts:574-575），第 2 条还能抓到把存在性检查提前的回归，按 DSH 的方向删第 2 条会丢这一点；应保留接缝不在的那次并补上第 1 条的断言。
- **涉及测试：** KA-09 (Runtime, L9/D8): an absent readTurnBounds is never needed for a recorded end, and the continuation brief is still built; KA-09 (Runtime, L9/D8): a live readTurnBounds that must not be consulted is never called for a recorded end, and the continuation brief is still built
- 来源：DSH；核实：partly；规格行：是；估计行数：8
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/composition/K-R-previous-turn-bounds.test.ts:93（保留缺少接缝的一例并搬入另一例断言。）

### T3-037 · E2-08 · handwritten · tests/composition/R3c-R4b-platform.test.ts:[[32, 54], [68, 85], [92, 94]]
- **动作：** convert:projects.createProject → projects.registerWorkspace → completionPolicies.installCompletionPolicy → completionPolicies.activateCompletionPolicy → architecture.adoptInitialArchitecture
- **覆盖/依据：** 公开入口和顺序见tests/composition/R5a-project-bootstrap-platform.test.ts:107-175；:144-145的effectiveCompletionPolicy/effectiveArchitectureBaseline期望改用install、adopt返回的ref和contentDigest；原Goal/Plan/Session重开测试保留。
- **核实理由：** R3c-R4b-platform.test.ts:41-54 手写政策、基线和两个active指针，:77-85、:92-94是raw commit；R5a:107-175用公开步骤从空库走到可采用，Goal任务都是goal范围。安装和采用不改Project/Workspace的revision（R5a:199、A1:273），所以:116和:240的rev 1期望不变。
- **涉及测试：** wires one durable Goal/Plan/Session graph and reopens the same Kernel Session
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：44
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：要求用 install/adopt 返回的 digest 替代独立期望。 改法：根据固定政策、基线输入和请求标识独立列出预期 ref/contentDigest；返回值只用于后续公开调用的引用传递，不作为这两条断言的期望。
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/composition/R3c-R4b-platform.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/composition/R3c-R4b-platform.test.ts:41,77,92; tests/composition/R5a-project-bootstrap-platform.test.ts:107（公开治理链及书面改正仍适用。）

### T3-038 · E2-09 · handwritten · tests/composition/R3d-R3g-platform.test.ts:[[82, 93]]
- **动作：** convert:projects.createProject → projects.registerWorkspace
- **覆盖/依据：** tests/composition/R5a-project-bootstrap-platform.test.ts:107-120；保留role pins、两个观测版本和replay不重抓的断言。
- **核实理由：** R3d-R3g-platform.test.ts:82-93 直接提交编码的Project/Workspace，还带自造的TrustedCompositionScopeSeeded事件。公开登记不会触发自动抓（只有host.ts:555会触发），所以:216的readThrough和:220-222的'无基线active'断言不受影响。
- **涉及测试：** keeps role pins and both observed architecture versions after restart without replay recapture
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：12
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/composition/R3d-R3g-platform.test.ts:83; tests/composition/R5a-project-bootstrap-platform.test.ts:107（改公开创建项目、登记工作区。）

### T3-039 · E2-02 · stale · tests/composition/S8A-L8-adoption-capture.test.ts:169-193
- **动作：** convert:用 first.current.persistedRef（src/contracts/architecture-observation.ts:54）代替 170-179 的自动抓取重放，保留 180-193 的空模块层和文件层断言，删掉只为重放用的 systemCtx
- **覆盖/依据：** slice-8-SPEC.md:1053（自动抓取 replay 的测试删掉）；读口 persistedRef 见 tests/composition/S8A-L8-capture-mappings.test.ts:211,232；空模块层+文件层另见 S8A-L8-capture-mappings.test.ts:163-190（手动抓取）
- **核实理由：** 174-179 用驱动的 auto-capture requestId 重放，确属 slice-8-SPEC.md:1053 要删的自动抓取 replay，读口已返回 current.persistedRef（architecture-observation.ts:54；capture-mappings:211 断言）。但 180-193 的空模块层与 listFiles 文件层断言不依赖重放（文件层用的是 firstCaptureRef），整段删掉会丢测试名里的 A-04 断言，只需换引用来源。
- **涉及测试：** captures registration, first adoption and revision once each, starts none on a replay, and compares the first empty module layer
- 来源：DSH；核实：partly；规格行：是；估计行数：12
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/composition/S8A-L8-adoption-capture.test.ts:174,180; src/contracts/architecture-observation.ts:54（改用公开persistedRef，保留双层断言。）

### T3-040 · E2-15 · duplicate · tests/composition/S8A-L8-pass-capture.test.ts:[[380, 403]]
- **动作：** merge-into:tests/composition/S8A-L8-pass-capture.test.ts::row 3: the same finalize request replays and changes no capture state
- **覆盖/依据：** tests/composition/S8A-L8-pass-capture.test.ts:405-443::row 3（合并后测试名标明覆盖规格第2、3行，双后端describe.each保留）
- **核实理由：** row 2（S8A-L8-pass-capture.test.ts:380-403）的前置步骤、公开finalizeChecks非重放PASS和assertPassCapture，在row 3的:411-428原样都有，row 3另外还检查通知次数和重放。这是规格行（slice-8-SPEC.md:1031“PASS三行”），所以合并，不删。
- **涉及测试：** row 2: the public finalizeChecks PASS starts one automatic capture
- 来源：Codex；核实：confirmed；规格行：是；估计行数：24
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/composition/S8A-L8-pass-capture.test.ts:380,405（合并规格第2、3行并保留双后端。）

### T3-041 · E2-10 · handwritten · tests/composition/W1-future-plan-platform.test.ts:[[58, 95], [133, 136]]
- **动作：** convert:projects.createProject → projects.registerWorkspace → completionPolicies.installCompletionPolicy → completionPolicies.activateCompletionPolicy → architecture.adoptInitialArchitecture
- **覆盖/依据：** 公开入口见tests/composition/R5a-project-bootstrap-platform.test.ts:107-175；保留scenario 6及W1覆盖。只要E2-12的raw fixture还在，:77-87的fullSchemas（含TrustedScopeSeeded事件类型）和:133的ledgerPath就得留着。
- **核实理由：** 公开步骤确实存在，转换成立；但W1-future-plan-platform.test.ts:186-195的后续raw commit还在用fullSchemas（:77-87，事件类型在:83）和ledgerPath（:133），所以能删的只有:58-76、:88-95、:134-136，大约30行，不是42行；E2-12也转换时才是42行以上。
- **涉及测试：** scenario 6/restart + W1 success: real SQLite adopt -> replay -> later revision -> reopen replay [bootstrap]
- 来源：Codex = DSH；核实：partly；规格行：是；估计行数：30
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/composition/W1-future-plan-platform.test.ts:134; tests/composition/R5a-project-bootstrap-platform.test.ts:107（公开治理链仍适用，与042协调清理。）

### T3-042 · E2-12 · handwritten · tests/composition/W1-future-plan-platform.test.ts:[[173, 197]]
- **动作：** convert:plans.proposePlan + plans.applyPlanChange（plan2 和 Goal 指针）+ runtime.createSession + claims.claimTask（refine 的 Run，status 'starting'）；不需要 prepareExecution/startRun，也不需要补 Runtime Host
- **覆盖/依据：** 不适用（转换，不删）；同形公开构造见 tests/composition/R3c-R4b-platform.test.ts:183-191、237-267
- **核实理由：** Codex 说跨重开没有等价公开构造不对：R3c-R4b-platform.test.ts:103-105 用和 W1 一样的 createTargetPlatform 选项（SQLite + kernelStores，无 Host），183-191 runtime.createSession、237-262 claims.claimTask 后重开仍读得到 Run、queryReadyTasks 不再列该任务。claimTask 写的 Run 是 'starting'（run-machine.ts:852），投影和 'running' 一样是 P2 running（task-machine.ts:142），所以 DSH 说的 prepareExecution/startRun 和补 scripted Host 都不需要；Goal 修订号等断言可能要按真实写入微调。
- **涉及测试：** scenario 6/restart + W1 success: real SQLite adopt -> replay -> later revision -> reopen replay [later Plan and running Run]
- 来源：冲突裁定（采用 dsh）；核实：partly；规格行：是；估计行数：25
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/composition/R3c-R4b-platform.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/composition/W1-future-plan-platform.test.ts:173; src/core/work-graph/state/task-machine.ts:142（公开采用后claim即可，starting仍投影为running。）

### T3-043 · E2-11 · handwritten · tests/composition/W2-future-intent-platform.test.ts:[[54, 83], [116, 127]]
- **动作：** convert:projects.createProject → projects.registerWorkspace → completionPolicies.installCompletionPolicy → completionPolicies.activateCompletionPolicy → architecture.adoptInitialArchitecture
- **覆盖/依据：** tests/composition/R5a-project-bootstrap-platform.test.ts:107-175；保留plan_only采用和SQLite重开的覆盖。
- **核实理由：** W2-future-intent-platform.test.ts:54-83 手写治理记录和scope schema，:116-127是raw seed；fullSchemas只有这次seed用（第二个测试用的是createTaskClaimFixture），所以42行都能换掉。草稿没有obligation，公开安装的同一份政策内容也能放行。
- **涉及测试：** real composition: an initial plan_only Plan adopts and survives a SQLite reopen
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：42
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/composition/W2-future-intent-platform.test.ts:116; tests/composition/R5a-project-bootstrap-platform.test.ts:107（公开治理链仍适用。）

### T3-045 · E2-13 · duplicate · tests/data/S8D-compact-snapshot.test.ts:[[76, 82]]
- **动作：** merge-into:tests/data/S8D-observed-v2-codecs.test.ts::cuts at 500 lines and appends exactly one line with the removed count
- **覆盖/依据：** tests/data/S8D-observed-v2-codecs.test.ts:279-286::cuts at 500 lines and appends exactly one line with the removed count
- **核实理由：** 两处都是 502 条、保留前 500 条、摘要“另有 2 条”（S8D-compact-snapshot.test.ts:77-81 对 S8D-observed-v2-codecs.test.ts:280-285）；compactUnresolvedLines 只被映射器调用（src/core/workspace/architecture-source.ts:89），目标经公开映射器断言同样的值，不用迁入什么。
- **涉及测试：** keeps the first 500 sorted lines and reports the exact number of removed lines
- 来源：Codex；核实：confirmed；规格行：否；估计行数：7
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：合并目标属于 T3-046 要删除的整块，与其保留 compact-snapshot 的动作冲突。 改法：标为由 T3-046 统一处理、不单独施工；保留 compact-snapshot 的 76–82 行，统一删除 codecs 的 261–301 行。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-compact-snapshot.test.ts:76; tests/data/S8D-observed-v2-codecs.test.ts:261（交046统一处理，保留compact来源。）

### T3-046 · E2-14 · duplicate · tests/data/S8D-compact-snapshot.test.ts:[[84, 96]]
- **动作：** delete（tests/data/S8D-observed-v2-codecs.test.ts:261-301 整个 compact 块；S8D-compact-snapshot.test.ts 不动）
- **覆盖/依据：** tests/data/S8D-compact-snapshot.test.ts:44-67（经 mapper：无 indexedSources、240 KiB、500 行截断加摘要）与 :70-96（compactUnresolvedLines：不截时无摘要、500 行、64 KiB 且摘要不计入）
- **核实理由：** mapper 在观测模式直接调 compactUnresolvedLines（src/core/workspace/architecture-source.ts:89），所以 codecs 块经 mapper 的 64 KiB 例和 compact-snapshot:84-96 的 helper 例是同一段逻辑，后者还多 94 行“含摘要超上限”的断言；按 Codex 方向删 compact-snapshot:76-96 后，compact-snapshot:62-66 与 codecs:279-286 仍重复 500 行截断，DSH 方向更干净（只是 DSH 说 64 KiB 也经 mapper 覆盖不准确，实际是 helper 层）。
- **涉及测试：** cuts at 64 KiB of the kept lines and does not count the summary line against that cap
- 来源：冲突裁定（采用 dsh）；核实：confirmed；规格行：否；估计行数：41
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-observed-v2-codecs.test.ts:261; tests/data/S8D-compact-snapshot.test.ts:84（删除codecs重复块。）

### T3-047 · E2-23 · duplicate · tests/data/S8D-cpp-import-graph-script.test.ts:[[120, 128]]
- **动作：** merge-into:tests/data/S8D-A22-cpp-imports.test.ts::A-22 (h): a disabled conditional branch contributes no edge
- **覆盖/依据：** tests/data/S8D-A22-cpp-imports.test.ts:174-190::A-22 (h): a disabled conditional branch contributes no edge
- **核实理由：** 输入相同（#if 0 包住 include x.h，默认数据库）。脚本测试断言 files 只有 main.cpp、边和没解析都为空（S8D-cpp-import-graph-script.test.ts:125-127）；平台测试在两个后端上断言边/没解析为空，还断言 parsed 1、x.h skipped“没有编译单元包含它”（S8D-A22-cpp-imports.test.ts:182-189），这正是规格 A-22 (h) 的期望（slice-8-SPEC.md:775 起），覆盖完整。
- **涉及测试：** A-22 (h) records no edge for an include in an inactive branch
- 来源：Codex；核实：confirmed；规格行：是；估计行数：9
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-cpp-import-graph-script.test.ts:120; tests/data/S8D-A22-cpp-imports.test.ts:174（原合并成立。）

### T3-048 · E2-24 · duplicate · tests/data/S8D-cpp-import-graph-script.test.ts:[[307, 316]]
- **动作：** merge-into:tests/data/S8D-A22-cpp-imports.test.ts::A-22 (g): ignores an outside lookup directory and notes it
- **覆盖/依据：** tests/data/S8D-A22-cpp-imports.test.ts:156-172::A-22 (g): ignores an outside lookup directory and notes it
- **核实理由：** 脚本测试 S8D-cpp-import-graph-script.test.ts:307-316 和公开测试 S8D-A22-cpp-imports.test.ts:156-172 输入相同（-I/outside、#include "o.h"），公开测试精确断言 notes 里恰好一条“忽略了 1 个工作区外的查找目录”、parsed 1、边为空、unresolved {"o.h", null}，还多断言 detail；-I 放在 -c 前后只影响逐个参数扫描的顺序，scripts/cpp-source-query.py:687-743 结果相同。A-22 (g) 是规格行（slice-8-SPEC.md:782），公开那条留下。
- **涉及测试：** A-22 (g) drops an include directory outside the workspace and records it once
- 来源：Codex；核实：confirmed；规格行：是；估计行数：10
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-cpp-import-graph-script.test.ts:307; tests/data/S8D-A22-cpp-imports.test.ts:156（原合并成立。）

### T3-049 · E2-25 · duplicate · tests/data/S8D-cpp-import-graph-script.test.ts:[[368, 375]]
- **动作：** merge-into:tests/data/S8D-A22-cpp-imports.test.ts::A-22 (j): notes a unit whose main file is not observed
- **覆盖/依据：** tests/data/S8D-A22-cpp-imports.test.ts:247-265::A-22 (j): notes a unit whose main file is not observed
- **核实理由：** 两处都是数据库多一条工作区里没有的 gen/x.cpp；脚本 368-375 只断言 notes 恰好一条和 main.cpp parsed，公开 258-264 精确断言同一条 note（加近似说明）、files 2 parsed 2 和边，覆盖更多。规格行见 slice-8-SPEC.md:785。
- **涉及测试：** A-22 (j) counts a database entry whose main file is not observed
- 来源：Codex；核实：confirmed；规格行：是；估计行数：8
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-cpp-import-graph-script.test.ts:368; tests/data/S8D-A22-cpp-imports.test.ts:247（原合并成立。）

### T3-050 · E2-26 · duplicate · tests/data/S8D-cpp-import-graph-script.test.ts:[[233, 240]]
- **动作：** merge-into:tests/data/S8D-A22-cpp-imports.test.ts::A-22 (q): a block comment before a quoted include keeps the quotes（目标测试补一条 cpp 覆盖断言：files 1、parsed 1）
- **覆盖/依据：** tests/data/S8D-A22-cpp-imports.test.ts:389-398::A-22 (q): a block comment before a quoted include keeps the quotes
- **核实理由：** 输入相同（#include /*c*/ "missing.h"），公开 396-397 断言边为空和 unresolved {"missing.h"带引号, null}；但公开测试没断言 main.cpp parsed（脚本 238 行有），Codex 已说要把这一条迁进目标的覆盖断言，目标约加 3-4 行。
- **涉及测试：** A-22 block comment before an include specifier keeps the written delimiters
- 来源：Codex；核实：confirmed；规格行：是；估计行数：8
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-cpp-import-graph-script.test.ts:233; tests/data/S8D-A22-cpp-imports.test.ts:389（目标仍须补files、parsed断言。）

### T3-051 · E2-27 · duplicate · tests/data/S8D-cpp-import-graph-script.test.ts:[[204, 211]]
- **动作：** merge-into 公开行：(a)(b)(c)(d)(e)(f)(g)(h)(j)(k)(l)(m) 并入 tests/data/S8D-A22-cpp-imports.test.ts 同字母行，macro comment→A-22 (p)、block comment→A-22 (q)、400 字节→A-22 (r)、去重→A-22 (i)；“A-23 maps absolute in-workspace files...”（204-211）并入 tests/data/S8D-A23-cpp-config.test.ts::A-23 path: an outside directory with an absolute workspace main file still parses（Codex E2-27 对）；脚本 (i)（130-147）保留或至少保留 143 行“a.cpp 单元里 h.h 失败”的断言
- **覆盖/依据：** tests/data/S8D-A22-cpp-imports.test.ts:45-412 各字母行；tests/data/S8D-A23-cpp-config.test.ts:285-299
- **核实理由：** A-22 各例确实与公开行同夹具同结论，Codex 只标了 5 条是漏标；但 A-23 绝对路径那条的公开对应在 S8D-A23-cpp-config.test.ts:285-299，不在 A-22 文件，这点 Codex 对。另外公开 (i)（S8D-A22-cpp-imports.test.ts:233-244）只看合并后 parsed 4，-DA 没传进去时结果一样，只有脚本 143 行证明第一个单元真让 h.h 失败、合并分支真被走到，不能整条删；DSH 的行区间还漏了列出的 242-253。
- **涉及测试：** A-23 maps absolute in-workspace files while the database directory stays outside
- 来源：冲突裁定（采用 neither）；核实：partly；规格行：是；估计行数：200
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：公开二元图不能承接脚本三元说明符、ready units、start/done 编号和协议断言；脚本 i 的保留范围也有两种选择。 改法：保留脚本 (a)73–86、(b)88–100、(c)102–109、(f)111–118、(i)130–147、去重185–193、(d)213–221、macro comment223–231、长注释242–253、(e)296–305、(m)318–332、(k)334–354、(l)356–366；其余能由公开图完整表达的指定用例继续合并；删除“至少保留143行”的选择。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-cpp-import-graph-script.test.ts:73,130,204; .lead-ref/books/t-items-T3.md:382（按书面改正保留协议及三元说明符用例。）

### T3-052 · E2-28 · duplicate · tests/data/S8D-cpp-import-graph-script.test.ts:[[405, 415]]
- **动作：** merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 argument: -Xclang fails only its own unit while the other parses
- **覆盖/依据：** tests/data/S8D-A23-cpp-config.test.ts:216-234::A-23 argument: -Xclang fails only its own unit while the other parses
- **核实理由：** 数据库完全相同（main.cpp 带 -Xclang -load、另一条 b.cpp）；公开 227-232 断言 files 2 parsed 1、唯一 issue 是 main.cpp 的“不认识的编译参数：-Xclang”，即 b.cpp parsed，与脚本 413-414 相同。
- **涉及测试：** A-23 fails a unit on -Xclang and keeps the other unit parsed
- 来源：Codex；核实：confirmed；规格行：是；估计行数：11
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-cpp-import-graph-script.test.ts:405; tests/data/S8D-A23-cpp-config.test.ts:216（原合并成立。）

### T3-053 · E2-29 · duplicate · tests/data/S8D-cpp-import-graph-script.test.ts:[[417, 423]]
- **动作：** merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 argument: a bare -load names the parameter without its value
- **覆盖/依据：** tests/data/S8D-A23-cpp-config.test.ts:236-251::A-23 argument: a bare -load names the parameter without its value
- **核实理由：** 脚本 420 把 -load x 放在 -c main.cpp 前，公开 240 放在后；参数逐个扫描、第一个失败即为原因（scripts/cpp-source-query.py:687、735-739，-load 在 REJECT_TABLE 540 行），两种顺序都得“不认识的编译参数：-load”，公开测试精确断言这条原因且不含值。
- **涉及测试：** A-23 fails a unit on -load and reports the spelling without its value
- 来源：Codex；核实：confirmed；规格行：是；估计行数：7
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-cpp-import-graph-script.test.ts:417; tests/data/S8D-A23-cpp-config.test.ts:236（原合并成立。）

### T3-054 · E2-30 · duplicate · tests/data/S8D-cpp-import-graph-script.test.ts:[[425, 432]]
- **动作：** merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 argument: -march=native is ignored with a note while -o and -c are not listed
- **覆盖/依据：** tests/data/S8D-A23-cpp-config.test.ts:253-267::A-23 argument: -march=native is ignored with a note while -o and -c are not listed
- **核实理由：** 参数列表完全相同（c++ -march=native -o x.o -c main.cpp）；公开 261-265 精确断言 notes 只有 march 那条加近似说明、parsed 1、complete，与脚本 430-431 相同（-o 的值没被当成多出的位置参数，否则会失败）。
- **涉及测试：** A-23 notes -march=native and ignores -o with its value
- 来源：Codex；核实：confirmed；规格行：是；估计行数：8
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-cpp-import-graph-script.test.ts:425; tests/data/S8D-A23-cpp-config.test.ts:253（原合并成立。）

### T3-055 · E2-31 · duplicate · tests/data/S8D-cpp-import-graph-script.test.ts:[[434, 441]]
- **动作：** merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 argument: an unreadable forced include is ignored with a count note
- **覆盖/依据：** tests/data/S8D-A23-cpp-config.test.ts:269-283::A-23 argument: an unreadable forced include is ignored with a count note
- **核实理由：** 同一 -include /nonexistent/pch.hxx（脚本放在 -c 后，公开放在前，逐个扫描结果相同，scripts/cpp-source-query.py:707-710）；公开 277-281 精确断言“忽略了 1 个读不到的强制包含文件”加近似说明、parsed 1，与脚本 439-440 相同。
- **涉及测试：** A-23 notes an unreadable forced include but still parses the unit
- 来源：Codex；核实：confirmed；规格行：是；估计行数：8
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-cpp-import-graph-script.test.ts:434; tests/data/S8D-A23-cpp-config.test.ts:269（原合并成立。）

### T3-056 · E2-32 · duplicate · tests/data/S8D-cpp-import-graph-script.test.ts:[[443, 449]]
- **动作：** merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 compiler: ccache is refused by file name
- **覆盖/依据：** tests/data/S8D-A23-cpp-config.test.ts:301-316::A-23 compiler: ccache is refused by file name
- **核实理由：** 脚本测试 S8D-cpp-import-graph-script.test.ts:443-449 与公开测试 S8D-A23-cpp-config.test.ts:301-316 用同一条 ['ccache','c++','-c','main.cpp']，同断言 '不认识的编译器：ccache'；公开路径经 architecture-language-provider.ts:242-263 原样把数据库交给脚本，拒绝只在 cpp-source-query.py:678-681，确实走到同一处，且公开测试另断言整条覆盖。
- **涉及测试：** A-23 rejects compiler wrappers by their file name
- 来源：Codex；核实：confirmed；规格行：是；估计行数：7
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-cpp-import-graph-script.test.ts:443; tests/data/S8D-A23-cpp-config.test.ts:301（原合并成立。）

### T3-057 · E2-33 · duplicate · tests/data/S8D-cpp-import-graph-script.test.ts:[[452, 456]]
- **动作：** merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 command: a POSIX-split command line parses
- **覆盖/依据：** tests/data/S8D-A23-cpp-config.test.ts:318-331::A-23 command: a POSIX-split command line parses
- **核实理由：** 脚本测试 :452-456 与公开测试 :318-331 是同一条 command 'c++ -DX=1 -c main.cpp'，都断言 main.cpp parsed（公开测试为 parsed:1、issues:[]），拆命令只在 cpp-source-query.py:996-1006，公开路径走到同一处。
- **涉及测试：** A-23 splits a command and fails one it cannot split [successful command]
- 来源：Codex；核实：confirmed；规格行：是；估计行数：5
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-cpp-import-graph-script.test.ts:452; tests/data/S8D-A23-cpp-config.test.ts:318（与058一起处理来源用例。）

### T3-058 · E2-34 · duplicate · tests/data/S8D-cpp-import-graph-script.test.ts:[[457, 461]]
- **动作：** merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 command: an unclosed quote fails the unit
- **覆盖/依据：** tests/data/S8D-A23-cpp-config.test.ts:333-347::A-23 command: an unclosed quote fails the unit
- **核实理由：** 覆盖成立：脚本 :457-461 与公开 :333-347 同为 "c++ 'unclosed -c main.cpp"、同断言 '编译命令拆不开'（cpp-source-query.py:1000-1001）。只改行数：E2-33 和本条一起删时整个 it 451-462 共 12 行，两条各计 5 漏了 451 和 462 两行，本条改计 7。
- **涉及测试：** A-23 splits a command and fails one it cannot split [unclosed quote]
- 来源：Codex；核实：partly；规格行：是；估计行数：7
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-cpp-import-graph-script.test.ts:457; tests/data/S8D-A23-cpp-config.test.ts:333（原合并成立。）

### T3-059 · E2-35 · duplicate · tests/data/S8D-cpp-import-graph-script.test.ts:[[464, 470]]
- **动作：** merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 argument: an extra positional is refused
- **覆盖/依据：** tests/data/S8D-A23-cpp-config.test.ts:349-364::A-23 argument: an extra positional is refused
- **核实理由：** 同一参数 ['c++','-c','main.cpp','other.cpp']、同一原因 '不认识的编译参数：多出的位置参数'（公开 :357-363）。证据里说合并时要保留 other.cpp 被观测的前态，其实不需要：cpp-source-query.py:733-735 只拿位置参数和 main_host 比，不看文件在不在，所以公开测试不用改。
- **涉及测试：** A-23 fails an extra positional argument
- 来源：Codex；核实：confirmed；规格行：是；估计行数：7
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-cpp-import-graph-script.test.ts:464; tests/data/S8D-A23-cpp-config.test.ts:349（原合并成立。）

### T3-060 · E2-36 · duplicate · tests/data/S8D-cpp-import-graph-script.test.ts:[[502, 508], [510, 519]]
- **动作：** merge-into:tests/data/S8D-A23-cpp-config.test.ts::A-23 各对应行——DSH 列的 12 例（合并说明→81-102、嵌套→104-125、-Xclang→216-234、-load→236-251、-march→253-267、强制包含→269-283、ccache→301-316、命令拆分→318-347、多余位置参数→349-364、固定 target→366-381、根数据库读不了→172-186、缺 libclang→S8D-language-providers.test.ts:225-242）再加 Codex 的二进制数据库例（502-508）→172-186；-idirafter、9 种数据库校验、无 hostRoot 三例保留
- **覆盖/依据：** tests/data/S8D-A23-cpp-config.test.ts:81-381 各 A-23 行；tests/data/S8D-language-providers.test.ts:225-242（PROV-04）
- **核实理由：** DSH 的 12 例逐条核过都有同输入同原因的公开行，Codex 漏了合并说明、嵌套、固定 target、缺 libclang；但 502-508 与 510-519 是同一个脚本分支（cpp-source-query.py:944-945），后者是前者的超集，DSH 删后者留前者自相矛盾。公开流程里二进制数据库在抓取时就记成跳过、由 architecture-language-provider.ts:238-240 先报失败，到不了脚本那段检查，所以两条脚本例应一起并入 172-186，这点 Codex 对。
- **涉及测试：** A-23 reports a binary database with the read failure; A-23 reports the unreadable root database instead of switching to another one
- 来源：冲突裁定（采用 neither）；核实：partly；规格行：是；估计行数：132
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：合并、嵌套、固定 target 和缺 libclang 的脚本协议断言没有公开覆盖；嵌套例输入也不相同。 改法：保留脚本 377–389、391–403、472–478、521–529 四例及协议断言，其余指定 A-23 用例继续合并；删除这四例可整例删除的描述。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-cpp-import-graph-script.test.ts:377,391,472,502,521; .lead-ref/books/t-items-T3.md:446（按书面改正保留四个协议用例。）

### T3-061 · E2-22 · trivial · tests/data/S8D-formal-unresolved-reason.test.ts:22-52
- **动作：** delete
- **覆盖/依据：** tests/data/S8D-A22-cpp-imports.test.ts:59（reason null → '<vector>'）、114（'NOPE（include 后面跟宏）'）；tests/data/S8D-A20-python-imports.test.ts:148-149；finding 整形（moduleRef、certainty:'unknown'）见 tests/composition/S8D-A06-multilingual.test.ts:119、tests/composition/S8A-AE1-formal-comparison.test.ts:156
- **核实理由：** 纯函数例只断言 detail 两种写法和 finding 整形；A-22 (a)(d) 经公开 compareFormalObserved 逐字断言两种写法（S8D-A22-cpp-imports.test.ts:59、114），A-20 断言整组 detail（S8D-A20-python-imports.test.ts:149），整形另有公开例（S8D-A06-multilingual.test.ts:119），删掉不丢断言。
- **涉及测试：** uses the bare specifier for reason null and <specifier>（<reason>） when a reason exists
- 来源：DSH；核实：confirmed；规格行：否；估计行数：31
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-formal-unresolved-reason.test.ts:22; tests/data/S8D-A22-cpp-imports.test.ts:59,114（原删除成立。）

### T3-062 · E2-44 · helper · tests/data/S8D-language-providers.test.ts:33-80
- **动作：** merge-into:新建 tests/helpers 下 workspace-tools 层共用夹具（如 tests/helpers/workspace-tools-fixture.ts）
- **覆盖/依据：** 不适用（重构）
- **核实理由：** 三份 fixture（S8D-language-providers:33-80、S8A-file-graph:33-86、S8E-A25-strict-capture:35-81）确是同一骨架（createWorkspaceAccessFactory 同一 resolveRoot/authorize + createWorkspaceTools），全仓只有这三份；但 S8D-platform-fixture.ts 是 createTargetPlatform 层的平台夹具（文件头 1-3 行），放进去层次不对，应另建 tools 层夹具，三份合并约改 100 行。
- **涉及测试：** fixture()
- 来源：DSH；核实：partly；规格行：否；估计行数：100
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：另外两个来源文件不在白名单，新 helper 名仍是示例。 改法：固定目标 tests/helpers/workspace-tools-fixture.ts；补入两个来源文件，保留 denied、fileGraph、capture limits、sourceAnalyzers 及包装方法差异。
- **第一批之后已不存在的文件：** tests/helpers/workspace-tools-fixture.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-language-providers.test.ts:33; tests/data/S8A-file-graph.test.ts:33; tests/data/S8E-A25-strict-capture.test.ts:35; .lead-ref/books/t-items-T3.md:461（三个来源仍在，目标本来待新建。）

### T3-063 · E2-12 · duplicate · tests/data/S8D-observation-inventory.test.ts:104-150
- **动作：** 删第 2 条（132-149，子目录，S8E-A07 的 parent 变体已覆盖）；第 1 条（104-130）合进 S8E-A07 时必须带上“跟踪后磁盘上删掉的文件”（f.remove）和“跟踪的符号链接”两种输入，否则保留第 1 条
- **覆盖/依据：** tests/data/S8E-A07-git-inventory.test.ts:28-33、40（忽略、未跟踪、子目录）；已删文件与符号链接只在 tests/data/S8D-observation-inventory.test.ts:108-118,122
- **核实理由：** S8E-A07 的夹具（S8E-A07-git-inventory.test.ts:14-19，夹具 git add -A 后提交，S8D-platform-fixture.ts:143-144）没有已删的跟踪文件和符号链接，而 slice-8-SPEC.md:523、831 明写这两种不进清单，只有 S8D 第 1 条（108-118、122）钉住；子目录那条确实重复。
- **涉及测试：** A-07 inventories git non-ignored files only: no ignored, deleted or symlink paths; A-07 keeps paths relative to a workspace root that is a subdirectory of the repository
- 来源：DSH；核实：partly；规格行：是；估计行数：47
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：需要增强的 A07 合并目标不在白名单。 改法：补入目标文件；先完成跟踪后删除文件、跟踪符号链接两种输入和排除断言，再删来源；未完成则 BLOCKED。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-observation-inventory.test.ts:104,132; tests/data/S8E-A07-git-inventory.test.ts:37,40（先补删除文件、符号链接及排除断言。）

### T3-064 · E2-13 · duplicate · tests/data/S8D-observation-inventory.test.ts:151-167
- **动作：** merge-into:tests/data/S8E-A08-skip-list.test.ts::A-08 skip list excludes node_modules and nested .venv, keeps dist（在 entries 里补一个 .git/config，断言 page.nodes 不变）
- **覆盖/依据：** tests/data/S8E-A08-skip-list.test.ts:26-27（node_modules、.venv、dist、inventory）；build/ 留在清单里由 tests/data/S8D-A23-cpp-config.test.ts:104-125（out/build 下的源文件进图）间接覆盖
- **核实理由：** S8E-A08 只有三条条目（S8E-A08-skip-list.test.ts:14-18），没有 S8D 158 行的 .git/config：跳过名单里第一个就是 .git（slice-8-SPEC.md:524，project-source-snapshot.ts:53-54），观测路径上只有这条测试钉住 .git 不进文件也不进 skipped；合并时要把这一条带过去。
- **涉及测试：** A-08 falls back to the fixed skip list outside git: node_modules and nested .venv are pruned, dist stays
- 来源：DSH；核实：partly；规格行：是；估计行数：17
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：只维持 nodes 不变未覆盖 .git 不进 skipped，也未保留 build/compile_commands.json 本身作为普通文件的断言。 改法：目标加入 .git/config、a/keep.ts 和来源相同的 build/compile_commands.json，精确断言三个保留文件路径，并断言所有 language issues 合并后为空；删除 page.nodes 不变及间接覆盖说明。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-observation-inventory.test.ts:151; tests/data/S8E-A08-skip-list.test.ts:21（按书面改正补路径和issues断言。）

### T3-065 · E2-14 · duplicate · tests/data/S8D-observation-inventory.test.ts:168-205
- **动作：** merge-into:tests/data/S8E-A23-ignored-databases.test.ts::A-23 merges ignored per-package databases and recaptures on their change（.gitignore 加 node_modules/，再放一份 node_modules/pkg/compile_commands.json，断言 cpp notes 仍是“合并了 2 个编译数据库”）；其余（configOnly 内部字节、README 改动）可删
- **覆盖/依据：** tests/data/S8E-A23-ignored-databases.test.ts:45-64（不进文件层、不进 issue、改数据库后摘要变）；跳过名单目录里的被忽略数据库不算，只在 tests/data/S8D-observation-inventory.test.ts:178,189
- **核实理由：** DSH 说 S8D 独有的只是内部 configOnly 精确值，但 178、189 行还钉住 slice-8-SPEC.md:835“路径在跳过名单目录里的不算”（project-source-snapshot.ts:285 的 observationConfigPaths），S8E 的条目里没有 node_modules（S8E-A23-ignored-databases.test.ts:22-35）；直接删会丢这条规则，误收时公开结果会变成“有多个编译数据库”，可以在 S8E 里公开断言。
- **涉及测试：** §11.4 freezes ignored compile databases as config only and keeps their bytes in the digest
- 来源：DSH；核实：partly；规格行：否；估计行数：38
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-observation-inventory.test.ts:168; tests/data/S8E-A23-ignored-databases.test.ts:40（仍须搬入跳过目录中的数据库输入。）

### T3-066 · E2-16 · duplicate · tests/data/S8D-observed-v2-codecs.test.ts:185-196
- **动作：** delete（只删 188-195 这一条 it，185-186 的 describe 和 emptyGraph 还被同组其它测试用）
- **覆盖/依据：** tests/data/S8E-old-format-rejection.test.ts:58-61
- **核实理由：** S8D-observed-v2-codecs.test.ts:192-194 与 S8E-old-format-rejection.test.ts:60-61 输入（无 projectId/workspaceId 的 v2 块）、作用域 SCOPE 和期望 invalid 完全相同；行数应按单条 it 计约 9 行。
- **涉及测试：** rejects an old unscoped chunk instead of filling its scope in
- 来源：DSH；核实：confirmed；规格行：否；估计行数：9
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-observed-v2-codecs.test.ts:188; tests/data/S8E-old-format-rejection.test.ts:60（只删指定it。）

### T3-067 · E2-23 · trivial · tests/data/S8D-platform-fixture.test.ts:9-38
- **动作：** delete
- **覆盖/依据：** tests/data/S8E-A15-previous-observation.test.ts:38-52；tests/data/S8D-A20-python-imports.test.ts:142-146
- **核实理由：** 夹具冒烟例的 Python 边和覆盖已由 A-20 断言（S8D-A20-python-imports.test.ts:142-146），抓完后写文件、下一次抓到由 A-15 双后端断言（S8E-A15-previous-observation.test.ts:38-52）；它独有的只是同一夹具连调两次 graph()，那是测试辅助自身的行为，不是生产行为，夹具被二十来个文件使用。
- **涉及测试：** observes e.py -> g.py and includes a file written after fixture creation
- 来源：DSH；核实：confirmed；规格行：否；估计行数：30
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-platform-fixture.test.ts:10; tests/data/S8E-A15-previous-observation.test.ts:24（原删除成立。）

### T3-068 · E2-16 · duplicate · tests/data/S8D-python-import-graph-script.test.ts:[[130, 134]]
- **动作：** merge-into:tests/data/S8D-A20-python-imports.test.ts::A-20 resolves Python imports against the configuration roots exactly（只并 130-134 的自边一例；95-128 留下）
- **覆盖/依据：** 自边缺席：同文件 95-128 的整组 edges/unresolved 等值（106-125）和 tests/data/S8D-A20-python-imports.test.ts:146-147
- **核实理由：** 自边一例（130-134）已被同文件 106-125 的整组等值和公开 146-147 覆盖，可并；但 95-128 断言了边的第三元说明符（106-112，§11.5 冻结的 edges:[[from,to,specifier]]）和 ready.units（98），公开侧 GraphShape 的边只有 from/to（S8D-platform-fixture.ts:69），执行器只拿说明符去掉自边（analysis-runner.ts:259-262），公开测试看不到，按 DSH 整段合并会丢这部分。
- **涉及测试：** A-20 does not record the pkg/__init__.py self edge or an unresolved for that pair
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：5
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-python-import-graph-script.test.ts:130,95（只并自边例，保留整组协议断言。）

### T3-069 · E2-17 · duplicate · tests/data/S8D-python-import-graph-script.test.ts:[[140, 147]]
- **动作：** merge-into:tests/data/S8D-A21-python-config.test.ts::A-21 accepts JSONC pyrightconfig.json with comments, a trailing comma and a trailing slash root
- **覆盖/依据：** tests/data/S8D-A21-python-config.test.ts:191-205::A-21 accepts JSONC pyrightconfig.json with comments, a trailing comma and a trailing slash root
- **核实理由：** 公开测试 :192 用同一份 JSONC 配置和同一组文件（BASE :53-59 与脚本 A21 :136-138 相同），:196-201 断言 notes:[]、reason:null（等于没有 failed）、bad.py 'SyntaxError: invalid syntax'、两条边，比脚本 :140-147 更全；provider 原样把配置交给脚本（architecture-language-provider.ts:293-307）。
- **涉及测试：** A-21 reads JSONC pyrightconfig.json and keeps lib as a root after trailing slashes
- 来源：Codex；核实：confirmed；规格行：是；估计行数：8
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-python-import-graph-script.test.ts:140; tests/data/S8D-A21-python-config.test.ts:191（原合并成立。）

### T3-070 · E2-18 · duplicate · tests/data/S8D-python-import-graph-script.test.ts:[[149, 155]]
- **动作：** merge-into:tests/data/S8D-A21-python-config.test.ts::A-21 notes the unused pyproject pythonVersion, fails bad.py and keeps the other edges
- **覆盖/依据：** tests/data/S8D-A21-python-config.test.ts:64-79::A-21 notes the unused pyproject pythonVersion, fails bad.py and keeps the other edges
- **核实理由：** 公开测试 :65 用同一份 pyproject.toml（pythonVersion 加 extraPaths lib）和同一组文件，:69-75 断言同一条注记 'pyproject.toml 里观测不用的字段：pythonVersion'、bad.py SyntaxError 和两条边，覆盖脚本 :149-155 的全部断言。
- **涉及测试：** A-21 records unused pyright fields in notes and the bad.py SyntaxError reason
- 来源：Codex；核实：confirmed；规格行：是；估计行数：7
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-python-import-graph-script.test.ts:149; tests/data/S8D-A21-python-config.test.ts:64（原合并成立。）

### T3-071 · E2-19 · duplicate · tests/data/S8D-python-import-graph-script.test.ts:[[157, 164]]
- **动作：** merge-into:tests/data/S8D-A21-python-config.test.ts::A-21（只并 140-147、149-155、166-172、174-180、182-189 五例；166-172 并入时把 reason:null 带进公开 vendor 例；157-164 留下）
- **覆盖/依据：** tests/data/S8D-A21-python-config.test.ts:191-205、64-79、110-126（须补 unresolved 的 reason:null）、157-170、172-189
- **核实理由：** 五例与公开 A-21 同夹具同字面量；但 extraPaths 字符串一例（157-164）断言 ConfigError 分支只出一行 failed、没有 ready 和 done（python-source-query.py:512-515），执行器收到 failed 就收尾、不管之前有没有 ready（analysis-runner.ts:438-441），公开例看不到；RecursionError 例走的是另一分支（python-source-query.py:588-589），不能替它。vendor 一例的 reason:null 公开例只比二元组（S8D-A21-python-config.test.ts:122），合并要带上。另：Codex E2-37 也对，219-233 的缺 Jedi 字面量已由 S8D-exploration-regressions.test.ts:89-111 用同样的空 ZIP 和自定义目录断言，DSH 说“应留”不准。
- **涉及测试：** A-21 fails on extraPaths as a string with the frozen configuration literal
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：是；估计行数：42
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-python-import-graph-script.test.ts:157; .lead-ref/books/t-items-T3.md:523（保留157行协议例，只并指定五例。）

### T3-072 · E2-20 · duplicate · tests/data/S8D-python-import-graph-script.test.ts:[[166, 172]]
- **动作：** merge-into:tests/data/S8D-A21-python-config.test.ts::A-21 notes an unusable vendor root and leaves its imports unresolved
- **覆盖/依据：** tests/data/S8D-A21-python-config.test.ts:110-126::A-21 notes an unusable vendor root and leaves its imports unresolved
- **核实理由：** 公开测试115-122行已断言同一note、边[a.py,b.py]和未解析对[d.py,c]，但只比二元组；规格slice-8-SPEC.md:770要求原因null，夹具S8D-platform-fixture.ts:275-281已暴露reason，把122行改成比较graph.unresolved含reason:null即可吸收脚本测试171行。
- **涉及测试：** A-21 notes a vendor root with no claimed Python files and leaves d.py c unresolved
- 来源：Codex；核实：confirmed；规格行：是；估计行数：7
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-python-import-graph-script.test.ts:166; tests/data/S8D-A21-python-config.test.ts:122（目标仍须补reason:null。）

### T3-073 · E2-21 · duplicate · tests/data/S8D-python-import-graph-script.test.ts:[[174, 180]]
- **动作：** merge-into:tests/data/S8D-A21-python-config.test.ts::A-21 fails the language when pyrightconfig.json extends another configuration
- **覆盖/依据：** tests/data/S8D-A21-python-config.test.ts:157-170::A-21 fails the language when pyrightconfig.json extends another configuration
- **核实理由：** 公开测试162-166行用同一输入断言同一原因字面量、edges:'failed'、parsed:0和无边，目标无需再加断言；failed消息包形状仍由脚本测试157-164行（E2-19保留）钉住，同一代码路径python-source-query.py:586-587。
- **涉及测试：** A-21 fails on extends with the frozen configuration literal
- 来源：Codex；核实：confirmed；规格行：是；估计行数：7
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-python-import-graph-script.test.ts:174; tests/data/S8D-A21-python-config.test.ts:157（原合并成立。）

### T3-074 · E2-22 · duplicate · tests/data/S8D-python-import-graph-script.test.ts:[[182, 189]]
- **动作：** merge-into:tests/data/S8D-A21-python-config.test.ts::A-21 uses the setuptools find.where root before the pyright extraPaths root
- **覆盖/依据：** tests/data/S8D-A21-python-config.test.ts:172-189::A-21 uses the setuptools find.where root before the pyright extraPaths root
- **核实理由：** 两处输入完全相同（脚本测试183-186行、公开测试173-178行），都只要求边恰好[x.py,a/m.py]（188行对185行），公开测试还多查覆盖；python_index的根顺序测试200-217行不受影响。
- **涉及测试：** A-21 keeps the configuration root order: packages.find where before pyright extraPaths
- 来源：Codex；核实：confirmed；规格行：是；估计行数：8
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-python-import-graph-script.test.ts:182; tests/data/S8D-A21-python-config.test.ts:172（原合并成立。）

### T3-075 · E2-37 · duplicate · tests/data/S8D-python-import-graph-script.test.ts:[[219, 233]]
- **动作：** merge-into:tests/data/S8D-exploration-regressions.test.ts::python_index returns success with the missing-Jedi message for an empty archive and stays sourced without a directory
- **覆盖/依据：** tests/data/S8D-exploration-regressions.test.ts:89-122::python_index returns success with the missing-Jedi message for an empty archive and stays sourced without a directory；实参传递另见tests/data/python-source-index.test.ts:221-235::passes -S and the analyzers directory as the first script argument。
- **核实理由：** 回归测试106-110行经公开工具用同样22字节空ZIP断言完全相同的unsupported消息（含自定义目录下analyzers.zip）；零退出码已隐含在内，因为python-source-index.ts:79-80遇非零退出会转成rejected，目标测试无需再加断言，脚本测试219-233行可直接去掉。
- **涉及测试：** python_index takes the analyzers directory from argv[1] and names <dir>/analyzers.zip when Jedi is missing
- 来源：Codex；核实：confirmed；规格行：否；估计行数：15
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8D-python-import-graph-script.test.ts:219; tests/data/S8D-exploration-regressions.test.ts:89（原合并成立。）

### T3-076 · E2-45 · helper · tests/data/S8E-A26-git-classification.test.ts:71-110
- **动作：** merge-into:新建 tests/helpers 下工作区读取层共用夹具（与 S8D-observation-inventory 共用 tempRoot/git/write/context/bindingsFor/projectAccessOf/observe）
- **覆盖/依据：** 不适用（重构）
- **核实理由：** S8E-A26-git-classification:71-110 与 S8D-observation-inventory:55-102 的 context/bindingsFor/projectAccessOf/observe 基本相同（不是逐行：S8D 版多 allowsRead 参数、workspaceRevision 7 和单独的 open），两文件 29-53 / 24-45 的 afterEach、tempRoot、git、write 也重复；它们走 createWorkspaceAccessFactory+captureObservationSource，不是 S8D-platform-fixture.ts 的 createTargetPlatform 层，合并目标要改。
- **涉及测试：** context(); bindingsFor(); projectAccessOf(); observe()
- 来源：DSH；核实：partly；规格行：否；估计行数：70
- **书面核对改正（Codex 10-19，lead 采纳；与上面的动作不一致时以这里为准）：** 问题：工作区读取层共享夹具没有固定文件名和白名单项。 改法：固定新文件 tests/helpers/observation-source-fixture.ts；统一 tempRoot/git/write/context/bindingsFor/projectAccessOf/observe，保留 scope、actor、workspaceRevision、allowsRead 参数及真实 access 释放。
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/data/S8E-A26-git-classification.test.ts:71; tests/data/S8D-observation-inventory.test.ts:55（按书面改正保留授权、版本和释放差异。）

### T3-081 · F-49 · helper · tests/helpers/K3-35-required-review-block.ts:1-11（整文件）
- **动作：** merge-into:tests/helpers/K3-continuation-pure-fixture.ts::requiredReviewBlock（K3-35-approved-methods-brief.test.ts:23 与 K3-35-T-by-hand.test.ts:53 改为从 pure fixture import，然后删整个 K3-35-required-review-block.ts）
- **覆盖/依据：** tests/helpers/K3-continuation-pure-fixture.ts:149 requiredReviewBlock（同一函数，转出口只是指向它）
- **核实理由：** K3-35-required-review-block.ts:9-11 只是从 pure fixture 转出 REQUIRED_REVIEW_BLOCK 和 requiredReviewBlock，两个 importer 只取 requiredReviewBlock；pure fixture 不依赖 Store/Host（其头注释 :6-7），非纯测试 K3-15-blocked-sentence.test.ts:14 已直接 import 它，tests/architecture 里也没有引用这个路径。
- **涉及测试：** tests/runtime/K3-35-approved-methods-brief.test.ts:23、tests/runtime/K3-35-T-by-hand.test.ts:53（只取 requiredReviewBlock）
- 来源：DSH；核实：confirmed；规格行：否；估计行数：11
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/K3-35-required-review-block.ts:9; tests/helpers/K3-continuation-pure-fixture.ts:149（改直接导入后删转出口文件。）

### T3-082 · F-48 · helper · tests/helpers/K3-continuation-pure-fixture.ts:23、33、136-146
- **动作：** delete:删 K3-continuation-pure-fixture.ts:23 的 G、:136-146 的 REQUIRED_REVIEW_BLOCK，并删随之变死的 :129 NOT_LISTED 与 :132-134 aliases()；:33 task 去掉 export。须与 F-23（K3-35-continuation-fixture.ts:121 去掉 G、task 转出口）和 F-49（删 K3-35-required-review-block.ts 转出口）同批，否则转出口指向不存在的导出
- **覆盖/依据：** 无消费者：G 只被 K3-35-continuation-fixture.ts:121 转出口引用、没有测试从那里取；REQUIRED_REVIEW_BLOCK 只被 K3-35-required-review-block.ts:10 转出口引用、两个 importer 只取 requiredReviewBlock；当前测试用 K3_35_REQUIRED_REVIEW_BLOCK_ONE
- **核实理由：** 核心属实：G（:23）和 32 条旧字面量 REQUIRED_REVIEW_BLOCK（:137）没有测试 import，task 只在 :34/:71/:87 内部用。但 :129 NOT_LISTED 与 :132 aliases() 只被这个字面量用，删字面量后也成死代码，应一并删；而且 :121 与 required-review-block.ts:10 的转出口要同批改，行数约 18 而非 13。
- **涉及测试：** 4 个测试只 import baseBrief、sha、APPROVED_COMMAND
- 来源：DSH；核实：partly；规格行：否；估计行数：18
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/K3-continuation-pure-fixture.ts:23,129,136（与080、081同批清理。）

### T3-083 · F-27 · helper · tests/helpers/K3-padded-review-record.ts:29-40、58-82
- **动作：** delete:去掉 tests/helpers/K3-padded-review-record.ts:29、31、33、35、37、39、40、58、63、68、73、82 共 12 处 export 关键字
- **覆盖/依据：** 同文件内部使用；无外部消费者
- **核实理由：** 唯一 importer tests/runtime/K3-48-3-extremes-pure.test.ts:42-44 只取 K3_PADDED_AT、k3PaddedCallIds、k3PaddedItems、k3PaddedWorkspace；:29-40 的 7 个常量与 :58-82 的 5 个函数在其它文件 0 命中，本文件内都有使用。
- **涉及测试：** 唯一 importer tests/runtime/K3-48-3-extremes-pure.test.ts
- 来源：DSH；核实：confirmed；规格行：否；估计行数：12
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/K3-padded-review-record.ts:29,58（原12处导出清理成立。）

### T3-085 · F-25 · helper · tests/helpers/RL-query-fixture.ts:19-33、54
- **动作：** delete:去掉 tests/helpers/RL-query-fixture.ts:19-28、30、31、33、54 共 14 处 export 关键字（实现保留）
- **覆盖/依据：** 同文件内部使用；无外部消费者
- **核实理由：** 唯一 3 个 importer（tests/app/RL-34-wiring-resource-caps.test.ts:23、tests/runtime/RL-31-readonly-resource-caps.test.ts:14、tests/runtime/RL-35-36-sandbox-and-retry.test.ts:20）只取 createRLQueryFixture、rlQueryHostCtx、RLQueryFixture；RL-query-fixture.ts:19-33 的 13 个常量和 :54 的 RLQueryFixtureOptions 在 tests/src 其它文件 0 命中，且每个在本文件内都有使用；tsconfig.json 是 noEmit、无 noUnusedLocals，去掉 export 不影响类型检查。
- **涉及测试：** 3 个测试只 import createRLQueryFixture、rlQueryHostCtx、RLQueryFixture
- 来源：DSH；核实：confirmed；规格行：否；估计行数：14
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/RL-query-fixture.ts:19,54（原导出清理成立。）

### T3-086 · F-04 · helper · tests/helpers/RL-resource-caps-support.ts:33-34,140-142,236-239
- **动作：** delete
- **覆盖/依据：** 无消费者；不删 RL 规格行，保留 :232 现在在用的 systemctlUserShow。
- **核实理由：** 全库 grep RL_PROBE_MEMORY_BYTES、RL_PROBE_TASKS_MAX、appendLine、unitLoadState，只在 RL-resource-caps-support.ts:33,34,140,236 有定义。RL_MIB 和 shellQuote 在 RL-01..15 的测试里仍在用，不受影响。
- **涉及测试：** RL_PROBE_MEMORY_BYTES; RL_PROBE_TASKS_MAX; appendLine; unitLoadState
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：9
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/RL-resource-caps-support.ts:33,140,236（原死代码删除成立。）

### T3-087 · F-42 · helper · tests/helpers/S2B-be2-reconcile-support.ts:68、188-191
- **动作：** delete:tests/helpers/S2B-be2-reconcile-support.ts:68、:188、:190、:191 去掉 export
- **覆盖/依据：** 同文件内部使用；无外部消费者
- **核实理由：** Be2Controls、Be2KernelGet、Be2KernelRead、Be2KernelFaultDecision 在 src/tests 其它文件 0 命中，只在本文件 :71/:111/:204/:216/:226 使用；8 个 importer 都不取这些名字。
- **涉及测试：** S2B 回填测试只 import withTool/prepare 等入口
- 来源：DSH；核实：confirmed；规格行：否；估计行数：4
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/S2B-be2-reconcile-support.ts:68,188（原四处导出清理成立。）

### T3-088 · F-06 · helper · tests/helpers/S2B-r2-calendar-reverify-support.ts:149
- **动作：** delete：删 tests/helpers/S2B-r2-calendar-reverify-support.ts:149 的类型，连同 :148 的注释和 :12 只为它存在的 CoreCallContext import
- **覆盖/依据：** 无消费者：全仓 Grep CalendarReverifyContext 只有定义 :149；不删测试用例或断言
- **核实理由：** 全仓 Grep 只有 S2B-r2-calendar-reverify-support.ts:149 的定义，没有使用者，结论成立；但 CoreCallContext 在本文件只被 :149 用（:12 import），删类型后 import 变成无用，要一起删，所以是 3 行不是 1 行。
- **涉及测试：** CalendarReverifyContext
- 来源：Codex；核实：partly；规格行：否；估计行数：3
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/S2B-r2-calendar-reverify-support.ts:149（连同专用导入及注释删除。）

### T3-089 · F-50 · tamper · tests/helpers/S2B-r3-r4-support.ts:21-46
- **动作：** delete：删 tests/helpers/S2B-r3-r4-support.ts 整个文件和 tests/work-graph/S2B-r4-session-workspace.test.ts 整个文件（两例都靠 commitRaw 篡改造外 workspace 的 Session）；读侧的 workspace 守卫要不要一起去由 lead 按 AGENTS 第 4 条定
- **覆盖/依据：** 行为只能靠篡改触发：claim-service.ts:1025 拒绝外 workspace 的 Session，run-machine.ts:1254-1263 历史定位只认领取 Session；AGENTS.md:33 第 4 条
- **核实理由：** 篡改性质成立：claim-service.ts:1025 拒绝外 workspace 的 Session，执行历史只认领取 Session（run-machine.ts:1254-1263），Session 的 workspaceId 只取调用方 scope（session-directory.ts:806 等），没有公开步骤能造出这种关系。但不存在“冻结 R4 行”：R4 是 2B 第三轮快速核对的修复编号（测试头注释 :1-6），slice-2B-SPEC.md 里 R4 只指 R4-control-runtime.test.ts，所以“暂不删规格覆盖”的理由不成立，按第 4 条应删（helper 47 行加测试 88 行）。
- **涉及测试：** cloneSessionInWorkspace; R4 foreign-session workspace cases
- 来源：Codex；核实：partly；规格行：是；估计行数：135
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/S2B-r3-r4-support.ts:37,39; tests/work-graph/S2B-r4-session-workspace.test.ts:46,66; .lead-ref/books/t-w1-findings.md:27（两文件仍应删除，按R-3保留生产守卫。）

### T3-091 · F-09 · helper · tests/helpers/S2C-K2-scenario-support.ts:35-37
- **动作：** delete
- **覆盖/依据：** 无消费者；不删测试用例或断言。
- **核实理由：** 全仓 Grep `sessionRefOfCard` 只有定义 tests/helpers/S2C-K2-scenario-support.ts:35；删掉后 :10 的 SessionRef 导入就没人用了，要一起删。
- **涉及测试：** sessionRefOfCard
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：4
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/S2C-K2-scenario-support.ts:35（原删除成立。）

### T3-092 · F-10 · helper · tests/helpers/S4C2-note-card-fixture.ts:42-43
- **动作：** delete
- **覆盖/依据：** 无消费者；不删注记卡规格行。
- **核实理由：** 全仓 Grep S4C2_FILE_A/B 只有定义 tests/helpers/S4C2-note-card-fixture.ts:42-43，九个导入这个夹具的测试都没用它们；NoteAnchorV1 在 :40、:41、:45 仍有用。
- **涉及测试：** S4C2_FILE_A; S4C2_FILE_B
- 来源：Codex；核实：confirmed；规格行：否；估计行数：2
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/S4C2-note-card-fixture.ts:42,43（原删除成立。）

### T3-093 · F-26 · helper · tests/helpers/S8A-L8-reminder-world.ts:47-162
- **动作：** delete:去掉 tests/helpers/S8A-L8-reminder-world.ts:47、50、51、57、59、80、88、93、97、107、121、154、162 共 13 处 export 关键字（occurrences 等被测试 import 的保留）
- **覆盖/依据：** 同文件内部使用；无外部消费者
- **核实理由：** 两个 importer（tests/work-graph/S8A-L8-read-counts.test.ts:19、tests/work-graph/S8A-L8-reminders-public.test.ts:23-24）只取 A03_STAGES、FIRST_AT、THREE_HOURS_FIVE、architectureRows、createReminderWorld、occurrences、waitObservationState；:47-162 的 13 个名字在其它文件 0 命中、本文件内都有使用。
- **涉及测试：** 两个 S8A 测试只 import A03_STAGES、FIRST_AT、THREE_HOURS_FIVE、createReminderWorld、architectureRows、waitObservationState
- 来源：DSH；核实：confirmed；规格行：否；估计行数：13
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/helpers/S8A-L8-reminder-world.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/S8A-L8-reminder-world.ts:47,154,162（原13处导出清理成立。）

### T3-094 · F-44 · helper · tests/helpers/S8D-platform-fixture.ts:46、53、79、81
- **动作：** delete:tests/helpers/S8D-platform-fixture.ts:46、:53、:79、:81 去掉 export
- **覆盖/依据：** 同文件内部使用；无外部消费者
- **核实理由：** LightScan/FixtureGit/CaptureOutcome/FixtureCapture 在 src/tests 其它文件 0 命中，约 26 个 importer 只取 BACKENDS/fixture/Entry/GraphShape/PlatformFixture/Backend/SourceAnalyzers；本文件内在 :95/:97/:126 使用。
- **涉及测试：** S8D 测试只 import createS8DPlatform 等入口
- 来源：DSH；核实：confirmed；规格行：否；估计行数：4
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/S8D-platform-fixture.ts:46,53,79,81（原四处导出清理成立。）

### T3-097 · F-36 · helper · tests/helpers/WP1-entry-fixture.ts:92、141、146-148、326
- **动作：** delete:删 tests/helpers/WP1-entry-fixture.ts:92 的 t1（并改 :18 注释里的 t0/t1）；:141、:146-148、:326 五个类型去掉 export
- **覆盖/依据：** 无外部消费者（两个 importer 只取 openAnomalyReaderFixture/t0/AnomalyReaderFixture 与 adoptUnrelatedPlan/makeUnboundGoalPrepared/openGoalContentEntry/revokeUnentered/GoalContentEntryFixture）
- **核实理由：** 外部无人 import 属实（WP1-context-anomalies.test.ts:30、WP1-goal-content-entry.test.ts:20-23）；但 t1 不是“同文件内部使用”，WP1-entry-fixture.ts 里只有 :92 定义和 :18 注释，是死常量，应删而不是只去 export；五个类型确实在 :149/:159/:163/:265/:334 内部用。
- **涉及测试：** 两个 importer 只 import open*Fixture、t0、AnomalyReaderFixture
- 来源：DSH；核实：partly；规格行：否；估计行数：6
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/WP1-entry-fixture.ts:92,141,326（原删除及导出清理成立。）

### T3-098 · F-12 · helper · tests/helpers/WP1-handover-fixture.ts:437,508,518,529,564
- **动作：** delete:整行删 tests/helpers/WP1-handover-fixture.ts:437、508、518、529、564 的 5 个 fixture 类型别名（Codex F-12）；另去掉 :113 HandoverWorkflowOptions、:124 createHandoverWorkflow、:352 HandoverBase 的 export 关键字（DSH 多出的 3 处，成立）
- **覆盖/依据：** 5 个类型别名全仓无任何引用；其余 3 个只在同文件内部使用
- **核实理由：** 5 个别名（:437/:508/:518/:529/:564）连本文件也只命中定义本身，DSH 说“只在同文件用”不对，只去 export 会留下死类型，按 Codex 整行删；:113 只被 :124 的签名用，:124 被 :218/:235/:431/:497 用，:352 被 :354/:371/:393/:439/:567 用，唯一 importer tests/business/WP1-continuation-handover.test.ts:26-39 不取这三个，所以 DSH 多出的 3 处去 export 成立。
- **涉及测试：** InterruptedHandoverFixture; RoleMismatchHandoverFixture; ReusablePredecessorFixture; ArchivedPredecessorFixture; RetiredContinuationFixture
- 来源：冲突裁定（采用 codex）；核实：partly；规格行：否；估计行数：8
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/helpers/WP1-handover-fixture.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/WP1-handover-fixture.ts:113,437,508,518,529,564（原清理范围成立。）

### T3-099 · F-35 · helper · tests/helpers/WP1-scenario-fixture.ts:76-131
- **动作：** delete:去掉 tests/helpers/WP1-scenario-fixture.ts:76、77、87、93、114、121、131 共 7 处 export 关键字
- **覆盖/依据：** 同文件内部使用；无外部消费者
- **核实理由：** 唯一 importer tests/scenarios/WP1-wiring.test.ts:28-30 只取 cleanupWP1Scenarios、openArchivedLineScenario、openPausedInterruptedScenario；:76-131 的 7 个类型在其它文件 0 命中，本文件内都有使用（PausedInterruptedScenario、ArchivedLineScenario 用作 :276/:301 的返回类型）。
- **涉及测试：** 唯一 importer tests/scenarios/WP1-wiring.test.ts 只取具体 open/drive 入口
- 来源：DSH；核实：confirmed；规格行：否；估计行数：7
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/helpers/WP1-scenario-fixture.ts, tests/scenarios/WP1-wiring.test.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/WP1-scenario-fixture.ts:76,122,132（七个类型去export，末两处行号移动。）

### T3-100 · F-46 · helper · tests/helpers/WP1-units-fixture.ts:83、336、342、487
- **动作：** delete:去掉 tests/helpers/WP1-units-fixture.ts:83、336、342、487 的 4 处 export 关键字（类型本身保留）
- **覆盖/依据：** 同文件内部使用（:115、:370、:432/:464/:476、:503/:533/:540/:555）；无外部消费者
- **核实理由：** WP1-units-fixture.ts:83/336/342/487 四个 export type 在 tests 和 src 其它文件 grep -w 0 命中，只在本文件 :115、:370、:432、:503 等处的签名和局部变量里用；docs 里只有历史证据文件提到名字。
- **涉及测试：** WP1 units 测试只取具体 fixture 函数
- 来源：DSH；核实：confirmed；规格行：否；估计行数：4
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/helpers/WP1-units-fixture.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/WP1-units-fixture.ts:83,336,342,491（四个类型去export，末项移到491行。）

### T3-101 · F-01 · helper · tests/helpers/WP2-duties-fixture.ts:34,44-49,64-220
- **动作：** delete
- **覆盖/依据：** 不删任何测试；保留 WP2-duties-fixture.ts:33（WP2_DUTIES）、:37-42（wp2LegacyDuty）、:51-62（wp2RoleContent）
- **核实理由：** 唯一的外部使用方 WP2-message-duties.test.ts:26 只导入 wp2LegacyDuty 和 wp2RoleContent；openWP2DutiesFixture（:98-218）、installWP2Role（:74-96）、WP2DutiesAdapterFactory（:45-49）、WP2_ROLE_ID（:34）、WP2DutiesFixture（:220）在 tests、src 里都没有别的引用。删掉以后 :6-31 大约 20 行 import 也用不上了，要一起清掉。
- **涉及测试：** openWP2DutiesFixture; installWP2Role
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：164
- **第一批改过的文件（行号以 d4c4cea 为准，先核对）：** tests/helpers/WP2-duties-fixture.ts
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/WP2-duties-fixture.ts:34,45,74,98,200（原删除成立，末尾类型现位于200行。）

### T3-104 · F-14 · helper · tests/helpers/orchestration-fixture.ts:146-148
- **动作：** delete
- **覆盖/依据：** 无消费者；同时删掉只为它保留的 type RunState 导入（orchestration-fixture.ts:21）
- **核实理由：** 全仓 Grep isYielded 只有 tests/helpers/orchestration-fixture.ts:146 的定义命中（src 里同名函数是 line-status.ts:848 的私有函数，无关），也没有 namespace 导入；删后 RunState 在该文件只剩导入行 21，需一并删除，行数约 4。
- **涉及测试：** isYielded
- 来源：Codex = DSH；核实：confirmed；规格行：否；估计行数：4
- **刷新（Codex 10-20，对照 w2-base）：** 仍按上面做；现在的位置：tests/helpers/orchestration-fixture.ts:146（原删除成立。）
