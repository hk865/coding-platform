# ERR-2026-09-10 延期项登记（理由、风险、后续验收条件）

状态：active。本页登记**本批明确不修**的项，避免"外审提过但没有下文"。逐项给出：为什么不在本批修、不修的实际风险、以及后续重新打开时必须满足的验收条件。已修项见[工作包 README](README.md) 与产品 `evidence/2026-09-10-external-review-repair/`。

范围约束：本批只做外部审查已确认的问题；**不启动**返工重验、记忆、接续、来源正式推进等后续核心功能。因此凡属"后续核心义务"的项一律只登记不实施。

## 一、明确不在本批展开

| ID | 项 | 不修理由 | 风险 | 后续验收条件 |
| --- | --- | --- | --- | --- |
| DEF-01 | 删除 `src/verification/code-graph-port.ts` 这个无消费者的 seam（外审 A-3 / ERR-03 §4） | seam 已改为"无注册表即 `unsupported`"，不再默认真实路径可被夹具冒充；删除要动 7 个文件并移除一个注释声明为 FROZEN 的 v1 接口，收益只是去掉 inert 代码 | 低：inert 代码仍占维护面，误接线时不会静默返回夹具（已由测试固定） | 若删除：`module-map`/边界检查 0 issues、`tests/verification/code-graph-port.test.ts` 与 `tests/control/architecture-*` 全通过、`source-graph-context` 真实路径不变、文档标注真实路径 |
| DEF-02 | 让证据脚本 `audit-dag.mjs` 同时比较 `scripts/module-map.mjs`（ERR-03 §3） | 该脚本是一次性审计产物（未跟踪、非产品发布物）；本批已用等价的三源集合比较独立复核 34 条边一致 | 中：未来的"DAG 文档漂移"只能靠人工或新脚本发现；本批 A-2 的教训（表少一条边而文档仍写 35）不会被自动拦住 | 把 `module-map.mjs` 纳入比较并断言 `archOnly`/`mapOnly` 为空；脚本进 `scripts/` 且可复跑；在全仓验证中登记为一条真实检查 |
| DEF-03 | 收窄宿主注入类型（A-1 剩余面：宿主仍把完整 `StateLedger` 交给约 20 个协作者） | A-1 的**接口**问题已修（`registerWorkspace` 已在 `ControlEngine` 上，宿主不再向业务写函数传裸 ledger）；剩余是类型面广度，属可读性/防误用，不是既成滥用（全仓 `.commit(` 仍只在 `src/control/**`） | 中：宿主理论上仍可对持有完整 `StateLedger` 的协作者调用 `commit`；缺少编译期约束 | 把宿主注入类型收窄为 `Pick<StateLedger,'load'|'events'|'pendingDispatchIntents'>` 后：类型检查通过、全仓测试数不减、`.commit(` 仍只在 control；并逐处确认没有协作者需要写能力 |
| DEF-04 | ReadModel 重复的后续单元（ERR-03 §8 的候选 #2/#3/#4 与 `isHandledEventType`） | 本批**已收敛** `baselineChangeView` 的纯推导（两侧 95 行规范化后逐字相同，实测证实后才抽取到 `src/read-model/baseline-change-projection.ts`，两后端改为调用同一实现）；其余候选 #2/#3/#4 未做，其中 #4 含 `this.`（需参数化仓储面），属模块内重构 | 中：`unifiedStatusView` 尾段（49 行）、类外 helper（37 行）与 `isHandledEventType`（67 行）仍是重复；新视图仍需两边写 | 每个单元单独一批：先证明该单元是纯函数（无 `this.`/无 I/O），再以双后端行为对照测试（同一场景过两套 harness，投影逐字节相等）保护；全仓测试数不减。本批 `baselineChangeView` 的收敛即为该流程的范例 |
| DEF-05 | 全量来源读取与轮询性能（外审 RD-1、ED-2） | 本批不含性能目标；外审也未提供测量数据 | 中：`/reviews/read` 轮询每次做两次完整 workspace 快照 + `git ls-tree`；大仓库代价未测。**任何优化都不得削弱授权、来源 pin 与接纳前复核** | 先出测量数据（大仓库下 capture 次数/耗时），再优化；优化后必须证明：授权与来源 pin 复核仍逐次执行、接纳前复核仍存在、`tests/app/independent-review.test.ts` 与 `tests/context/reviewer-context.test.ts` 全通过 |
| DEF-06 | Reader 的 `':'` 路径拒绝（RD-4） | Linux 上合法的含 `:` 文件名会被判不可读，但当前不是本批确认缺陷，且改动读取器的拒绝规则会影响安全边界 | 低-中：少数合法路径不可读（失败关闭，不会误读） | 只拒绝控制字符与 Windows 保留形态后：`tests/data/reviewer-source-reader*` 通过、越界/符号链接/UTF-8 边界拒绝仍全绿、新增含 `:` 合法名的正例 |
| DEF-07 | 坏格式报告的操作者再发起路径（RD-6） | 与"坏报告不伪装成功"一致；属产品层交互设计，涉及重新发起语义 = 后续核心功能 | 中：格式坏报告为终态，操作者只能新建目标 | 明确"格式坏报告如何重新发起"的产品语义，且不洗掉真实 FAIL、不重复模型执行、不重复接纳 |
| DEF-08 | `ReviewContextCompilerImpl` 去留（R-8） | 只被两个 harness 作默认构造，无生产消费者；删除或提升为正式端口都需要与当前 harness 缺省策略一起决定 | 低：inert 代码，不进入真实路径 | 二选一并记录：删除后 harness 缺省必须显式失败而非静默；或提升为正式端口并接入真实消费者 + 测试 |
| DEF-09 | `reviewReductionIsCurrent` 未启用路径（RD-2） | 当前 `planId`/`planRevision` 恒为 1 且 `PlanRevisionRef` 无 digest，该路径不可达 | 低：未启用代码不产生错误行为；但它声称的"归约当前性"保护实际未生效 | 补真实消费者（plan revision 真正推进）或在代码与文档中标注未启用；不得让它看起来像已生效的保护 |
| DEF-10 | 已接纳结果 + 未完成归约的语义（RD-3） | 结果接纳后、归约 checkpoint 前的来源变化会把请求终态化为 `work_rejected`，但 Result 已接纳；需要产品语义决定 | 中：该组合语义未定义，可能出现"结果已接纳但请求被拒" | 明确该组合的正式语义并补测试；不得把已接纳结果当作未接纳 |
| DEF-11 | 已接纳 Evidence 的一般来源失效与正式来源推进（外审 §2.3 / ED-4 / `architecture-repair.md:24`） | 明确属**后续核心义务**，本批不动工；外审已确认这是措辞不一致而非未披露缺口 | 中：接纳后修改被引用源码不会使已接纳 Evidence 失效，Task 仍可 satisfied | 来源摘要进入 effectivity anchor 后：接纳后来源变化能撤销/失效相应 Evidence，且不误伤未变来源；文档与验收措辞同步 |
| DEF-12 | 两套 ReadModel 的量化重复度口径 | 外审报告写"1517/3602 行逐字节相同（42.1%）"与"`baselineChangeView` 83 行"，ERR-03 独立实测为 1,253/3,602（34.8%，去空行 1,143/3,364）与 101 行连续相同 | 低（数字口径），但**报告数字不可复现**必须如实记录 | 后续引用重复度时使用可复现脚本与口径（含是否去空行、比较粒度），并保留脚本；不得引用不可复现数字 |
| DEF-13 | `terminal-sandbox.py` 的路径包含/Landlock 语义等价性（外审 §5-9） | 需要运行 Landlock，本批未执行；边界检查器已自我声明 `notASandboxVerification` | 中：legacy 终端/文件路径边界与 WorkspaceReader 边界是否语义等价**未验证** | 在真实 Landlock 环境验证路径包含与拒绝语义；在不通过前，文档不得声称两者等价 |
| DEF-14 | 两套 Ledger 的其余同类重复（R-1 剩余） | 本批按文档契约收敛了 `identityKeyFor`/`validateGoalCreate`/`validateBootstrap` 三对；其余校验已在共享模块中 | 低 | 新增 commitKind/对齐规则时只改 `contracts/ledger-validation.ts` 一处；发现新重复时按同一模式收敛 |
| DEF-15 | `gate-goal` 硬编码、`workspace-reader-adapter` 版本约定等结构审计残留项 | 来自已 superseded 的结构审计，未在本批确认 | 低-中 | 逐项确认是否仍成立；成立则进入模块状态接续表并各自验收 |
| DEF-16 | 全仓命名翻新、`src/app/service.ts` 路由 switch 重构、两套 ReadModel 大文件拆分 | 用户明确不在本批展开；`service.ts` 作为"第二套架构"是真实的扩展成本，但重构面过大 | 中：每次新增能力仍要改 `service.ts` 的注入块与路由 | 单独一批：先给出路由表驱动的接线形状与迁移顺序，保持 34 条边与既有契约不变，全仓/浏览器不减少 |

## 三、独立审查发现的本批残留（2026-09-10，已按项处理）

独立审查（`dev_docs/verification/2026-09-10-external-review-repair/independent-review.md`）发现本批自身的缺口。逐项处置如下，未修部分在此登记。

| ID | 项 | 处置 |
| --- | --- | --- |
| REV-01 | F-01 只修了租约拒绝；`CodingAgentRuntime.start` 的其余启动前校验错误仍 `throw`，属同一"可证明零副作用"类别，会重现同一 wedge | **已修**：`LeasedWorkerRuntime.start` 的 `runtime.start` 失败分支改为先尝试 `rejectBeforeStart`，仅在无法证明未启动时回退为抛出（保留歧义）。新增回归 `tests/control/reviewer-lease-conflict-recovery.test.ts` 第二个用例，断言 canonical Run 为 `ended/crashed`、恰好一条 `run_crashed` 终止事件、trace/usage 为空、模型 0 次调用 |
| REV-02 | B-1 使默认入口（`node dist/app/server.js`）的样例夹具路径 400，违反外审验收条件"既有样例入口行为不变" | **已修**：捆绑宿主在 `server.ts` 的默认入口**显式**开启样例夹具执行器（不再由"不像真实"推断），恢复历史默认行为；真实计划仍被 `isRealTaskPlan` 拒绝复用样例计划 |
| REV-03 | "全仓再无标识符前缀承担路由"不成立：源码模式下仍提供**修复前**的 Vite 产物，内含 `planId.startsWith('real-plan-')` 与 `executor === 'fixture'` | **已修**：把 workbench 重新构建到 `src/app/public/workbench`，源码模式与 `dist` 产物现在逐字节相同（sha 一致），二者均 0 处前缀路由、读 `fixtureEnabled` |
| REV-04 | R-3 替换断言所在分支不可达，且期望错误文本与桩实际抛出的 `TypeError` 不符（"等于不验"未实质解决） | **已修**：改为只断言桩无法驱动该守卫（不钉住桩从不产生的错误文本）。该分支仍不可达（`live=true`），实质防护由同一用例 live 路径承担 |
| REV-05 | 测试快照只覆盖 27 个受影响文件中的 22 个 | **已补**：新增 `test-snapshots/` 缺失文件的 before/after/diff；独立审查另行从悬空 git blob 恢复并比对了未快照文件，确认**无一处削弱** |
| REV-06 | "359/360 边界行"是在 ENV-07 删除窗口内测的，不是最终身份 | **已修**：最终身份下重跑并在验收页记录实际数字 |
| REV-07 | R-4 的"独立故障注入"在证据目录内**没有产物** | **已补**：本批补做注入并落盘 `evidence/.../r4-probe-fault-injection/`；独立审查另行独立复现（修复后 FAIL、修复前 SKIP） |
| REV-08 | `replaceFailedWork` 无任何产品调用点/HTTP 路由，操作者仍无法通过产品修复卡住的审阅 | **登记为后续**：本批只修分类与受控重新受理的**可达性**（端口层，有测试）；把它暴露为产品入口属于新的操作者工作流，涉及授权与 UI，登记 DEF-17 |
| REV-09 | 修复前的 `reviewer-work.ts` 字节不在任何交付物中，"原条件为 `!== 'failed'`"只有失败日志可佐证 | **如实保留为不可证**：本批不重建、不声称；仅以 `err01-postfix-failure-03` 日志作为佐证 |
| REV-10 | `tests/verification/code-graph-port.test.ts` 的 +1 项未计入测试数说明 | **已修**：测试数口径在验收页补齐（1633 − 2 + 8 + 1 = 1640） |
| DEF-17 | 把受控重新受理（`replaceFailedWork`）暴露为正式产品入口 | 属新的操作者工作流（授权、UI、HTTP 路由），不在本批范围；风险：操作者仍须写代码才能修复卡住的审阅。后续验收条件：有明确授权条件的入口 + 不洗掉真实 FAIL + 不重复模型执行/接纳 + 针对性 HTTP 与 UI 回归 |

## 二、证据与环境注意项（不是产品缺陷，但会影响复跑可信度）

| ID | 项 | 说明 |
| --- | --- | --- |
| ENV-01 | `scripts/test-wsl.sh` 之外的运行必须自行设置 `CODING_AGENT_BWRAP_PATH` | 任何绕过 `test-wsl.sh` 直接调 vitest／playwright 的运行都会因沙箱预检失败产生 `隔离环境不可用` 的 `run_crashed`，表现为大面积超时。**2026-09-10 的 EU-1 首次尝试正是因此得出错误结论**（7/8 超时被误当作变异被捕获）。复跑必须显式设置该变量。 |
| ENV-02 | 浏览器套件需要一个可用的 Chromium | 本机 Playwright 期望 `chromium_headless_shell-1243` 而缓存为 `-1234`；`src/ui/tests/playwright.config.ts` 已支持 `CHROME_PATH`，运行前设置即可（本批实测 23/23 通过）。 |
| ENV-03 | 本机 WSL shell 没有 `npm`，只有 `pnpm` | `package.json` 的 `build` 与 playwright `webServer.command` 都调用 `npm run kernel:build`。直接用 `pnpm build` 会以 `sh: 1: npm: not found` 失败，**这不是产品缺陷**。本批用一个 `npm → pnpm` 的 PATH shim 完成同一条命令；未修改仓库脚本。 |
| ENV-04 | 并行跑大队列时默认 5s 超时会偶发超时 | `tests/app/verification-imports.test.ts` 的两项在并行满负荷下超 5s 默认上限（报 timeout），单文件复跑 10/10 通过。**不得**靠放宽超时过关；报告时应如实区分"断言失败"与"并行负载超时"。 |
| ENV-05 | `evidence/2026-09-10-external-review-repair/eu1-mutation.log` 与 `eu1-mutation-workspace-copy.log` 是**不成立的** EU-1 证据 | 保留原样不改写；成立的那次在 `EU-1-mutation-verification/`。引用时必须用后者。 |
| ENV-07 | `src/app/public/workbench/` **不是**可删除的死构建产物 | ERR-03 曾建议删除它（连同 A-4 的 owner 问题）；实际删除后 `GET /` 立刻 500→400：`server.ts:27` 的 `workbenchRoot` 解析为 `src/app/public/workbench/`，**源码模式运行**（测试与 `node src/app/server.js`）需要它存在，`pnpm build` 才把 Vite 产物写进去。本批已按 candidate-04 逐文件 SHA-256 校验后原样恢复（7/7 一致），`tests/app/gui.test.ts` 恢复通过。**后续不要删除该目录**；若要改变工作台构建产物位置，必须同时改 `server.ts` 的 `workbenchRoot` 并重跑浏览器套件。 |
| ENV-06 | `.local/eu1-mutant-20260910/` 内仍留有变异副本 | `.local/` 已 gitignore，产品源码不含变异（`src/context/exploration-context-compiler.ts:78` 有 `sourcePin: source.pin`）；保留供追溯，不参与发布。 |
