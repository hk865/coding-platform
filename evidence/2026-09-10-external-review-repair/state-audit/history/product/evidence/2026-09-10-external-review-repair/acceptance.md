# ERR-2026-09-10 外部审查修复批次验收

状态：**已收口**（独立审查完成，其发现已逐项处置）。本页记录本批的限定范围、最终身份、逐项结论与验证结果。入口：[外部审查报告](../../../dev_docs/verification/2026-09-10-external-review/report.md)、[工作包](../../../dev_docs/planning/active/external-review-repair/README.md)、[集成交接](../../../dev_docs/verification/2026-09-10-external-review-repair/integration-handoff.md)、[延期登记](../../../dev_docs/planning/active/external-review-repair/deferred-register.md)。

用户 2026-09-10 委托：接手外审后的修复与重新验收，只修已确认问题，**不启动**返工重验、记忆、接续、来源正式推进等后续核心功能。本批据此执行。

## 一、范围与边界

- 只修外审已确认的问题：F-01 与 §2.3、R-2/R-3/R-4/RD-5、E-1/EU-1、B-1/B-2、A-1…A-4/R-6、R-1/R-5、ReadModel 已证实重复的纯投影、D-1…D-8。
- 不新增实现去凑文档边数（A-2 改文档）；不为外观统一制造抽象层；不展开全仓命名翻新或全面性能重构。
- 未修项、理由、风险与后续验收条件见[延期登记](../../../dev_docs/planning/active/external-review-repair/deferred-register.md)。
- 全程未 `reset`/`clean`/`stash`/`commit`/`push`，未重跑架构一次性迁移脚本，未改 `vendor`，未新增用户未配置的累计预算。HEAD 仍为 `65d270d7`，430 项未提交修改全部保留。

## 二、最终源码身份

- 清单：`evidence/2026-09-10-external-review-repair/final/final-source-sha256.json`。
- **739 文件**，摘要 `5a9e9eb1f7030860f54d16a2dff87a90f8a17c77f710ca70f212b788ac210364`（独立审查后按 REV-01…REV-07 修复，身份已重算）。
- 相对外审所审 candidate-04（730 文件）：**新增 12 / 修改 57 / 删除 3**。删除的 3 项全部是 workbench 构建产物（`index-DhcqvPDb.js`、`task-graph-D6hPc9CI.js`、`terminal-ApsQBPsq.js`），由同名新产物 `index-BJI4SUZf.js`、`task-graph-BnQsuTHk.js`、`terminal-B65Zetzd.js` 逐位替代——因为源码模式提供的旧产物仍含修复前的 `planId.startsWith('real-plan-')` 路由（独立审查 REV-03），已重新构建使源码模式与 `dist` 产物逐字节相同。新增另含 `contracts/execution-capability.ts`、`read-model/baseline-change-projection.ts`、4 个新回归测试、2 个就绪探针文件、根 `AGENTS.md` 与 `pnpm-workspace.yaml`。
- 清单覆盖与本批所审候选同一批路径，**包含** `src/app/public/workbench`（源码模式运行的必需依赖，见 ENV-07）。

## 三、验证结果（最终身份）

| 验证 | 命令 | 结果 | 日志 |
| --- | --- | --- | --- |
| 后端类型 | `node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit` | exit 0 | — |
| UI 类型 | `pnpm --dir src/ui exec tsc -p tsconfig.json --noEmit` | exit 0 | — |
| 构建 | `npm run kernel:build && tsc -p tsconfig.app.json && node scripts/copy-ui.mjs && pnpm run ui:build` | exit 0 | — |
| 全仓 | `bash scripts/test-wsl.sh --maxWorkers=2` | **253 文件 / 1641 项全部通过，0 skipped，exit 0**，828.78s | `final/full-tests-final.log` |
| 浏览器 | `pnpm run ui:test`（需 `CHROME_PATH`） | **23/23 通过，exit 0**，3.7min | `final/browser-final.log` |
| 静态边界 | `node scripts/check-module-boundaries.mjs` | **362 源文件 / 363 inventory / 0 issues**（最终身份实测；此前记录的 359/360 是在 ENV-07 删除窗口内测的，见 REV-06），exit 0 | `final/module-boundaries-final.json` |
| 文档 | `node dev_docs/verification/validate-docs.mjs` | **13/13**，exit 0 | `final/validate-docs-final.log` |
| DAG 三源一致 | 独立三源集合比较 | 34 = 34 = 34，集合完全相同 | 见 §四 A-2 |

**测试数量不作为硬指标。** 本批 253 文件 / 1641 项（外审记录 249 文件 / 1633 项）。口径：1633 − 2（R-2 删除空组，覆盖由 `tests/integration/p1-16.real-kernel.continuity.test.ts` 的真实内核断言承担）+ 8（Reviewer 恢复含独立审查后补的前置拒绝用例、unknown 保持、就绪探针 5、替身 selection）+ 1（A-3 `code-graph-port.test.ts`）= **1641**。**skipped = 0**，没有通过跳过、放宽断言或隐藏失败过关。

### 并行负载口径（如实记录）

首次全仓运行 252/253 文件通过，唯一失败是 `tests/app/gui.test.ts`。定位后确认**不是**断言放宽问题：`createGuiServer` 的 `workbenchRoot` 解析到 `src/app/public/workbench/`，本批曾按 ERR-03 建议删除该目录，导致源码模式 `GET /` 直接 400。该目录是**必需依赖而非死构建产物**，已按 candidate-04 逐文件 SHA-256 校验（7/7 一致）原样恢复，`gui.test.ts` 恢复通过，并登记为 ENV-07。恢复后重跑全仓 253/253、1640/1640、exit 0。

另有 `tests/app/verification-imports.test.ts` 在并行满负荷下偶发 5s 默认超时（单文件复跑 10/10 通过）；未放宽超时，已在 ENV-04 登记口径。

## 四、逐项结论与证据

### Reviewer 恢复（F-01）

1. **租约被拒的分类**：`src/control/leased-worker-runtime.ts` 在租约未 committed 时改走 `CodingAgentRuntime.rejectBeforeStart`，保留"必须能证明尚未启动"的前置断言（`record.status === 'prepared'` 且无 active、无 events、无 trace）。
2. **本批新发现的阻断缺陷**：`src/control/reviewer-work.ts` 的 `replaceFailedWork` 曾要求 `oldRun.outcome !== 'failed'` 即拒；而 `runtimeEventTerminalOutcome`（`src/contracts/dispatch.ts`）把 `run_crashed` 折为 `crashed`，条件恒真——**受控重新受理在修复前不可达**。改为 `'crashed'` 后可达，且未放宽零副作用证明要求（仍要求 `runtimeStatus === 'failed'`、`modelStarted/toolStarted === false`、`traceCount/usageCount === 0`、`eventTypes === ['run_crashed']`、`exitCode === null`、终止事件与 observation 一致）。
3. **真实租约冲突集成反例**：`tests/control/reviewer-lease-conflict-recovery.test.ts` 用真实 Control/Ledger/Vault/ReviewerDispatch/CodingAgentRuntime 与真实租约，构造重叠写租约 + Reviewer 读租约冲突：Run 记为 `ended/crashed`（非 `outcome_unknown`）、运行时观察 `failed` 且 `trace/usage` 为空、两次 drive 均为 `review_execution_incomplete`、同工作区后续轮次仍 `completed` 且 canonical Reviewer 材料仍 `ready`（**不阻塞**）、`replaceFailedWork` 受控重新受理成功且旧 Work 不被改写、新 Work 获得新的 pending reviewer intent、自动（非 human）受理被拒 `replacement_not_authorized`。
4. **未知副作用必须保持未知**：`tests/control/reviewer-unknown-outcome-preservation.test.ts` 证明无法证明未启动时 Run 保持 `ended/outcome_unknown`（明确断言 `not.toBe('crashed')`）、公开观察一致、`events/trace/usage` 全空、模型调用 0 次、只有一个 session，且再次 drive 不重试。
5. **修复前证据**：`f01-prefix-reproduction/`（隔离副本，未改产品源码）复现修复前接触面并记录真实后果，含"同一 task+plan 的新请求 `review_already_exists` → 该 plan 永久不可再审"。修复过程中的三个失败日志按序保留（投影端口未推进、控制端口未绑定、`crashed` vs `failed`），未被改写。
6. **明确不自动恢复的边界**：真正无法证明未启动（已启动或观察不可判）的记录仍保持 `outcome_unknown`，无 Run 级自动对账入口，不自动重跑、不伪装成已知失败。

### 测试可信度（R-2/R-3/R-4/RD-5）

- R-2：`grep -rn "expect(true)\.toBe(true)" tests/ src/` 0 命中。两处改为真实读模型断言（`architecture.contract.suite.ts`、`completed-work.contract.suite.ts`）；第三处空组删除并在 P1-16 票注明覆盖去向。
- R-3：`tests/control/remediation-writer-chain.test.ts` 改为真实调用 + `rejects.toThrow`；该分支当前不可达（`live=true`），实质防护由同一用例 live 路径覆盖，已如实记录。
- R-4：新增 `tests/restart/readiness-probe.ts`，**只有**显式未实现哨兵转为 not-ready，其余错误一律抛出；16 个外审所列 fixture + **2 个外审未列的 P1-01 文件**（`persistent-restart.test.ts`、`evidence/p1-01-evidence.test.ts`）全部改造；全 `tests/restart` 已无裸 `catch {`；`tests/restart` 37 文件 / 45 项通过、**0 skipped**；独立故障注入证明真实回归 → FAIL（修复前同一注入 → SKIP）。
- RD-5：替身 `pendingDispatchIntents(limit, selection)` 与两套生产 Ledger 同为 filter(status)→filter(selection)→sort→limit；排序键统一为 `canonicalJson`（原 `JSON.stringify` 键序不同）；有判别性专项断言（修复前行为会返回 `[ordinary]` 而失败）。

### 证据可审计性（E-1/EU-1）

- **E-1 已闭合（不是保留缺口）**：原始 19161 字节从悬空 git blob `e1eda07e1a8f6dbe22915d24e78ace91be8b993a` 恢复，冻结于 `E-1-recovered-original/tests-app-explorations.original-19161.test.ts`，SHA-256 `00dfc41f9fe04e8156b2279dd1d213b416894d1ea7ea693dcc663fef655cd8fa` 与 `evidence/2026-09-09-module-completion/closeout-source-sha256.json` 记录精确一致。恢复出的 diff 只有一处新增断言（把 `basis.sourcePin` 纳入 grant 断言），证明 2026-09-09 的改动是**加强**而非削弱该测试。**未伪造**任何"修复前"字节。
- **EU-1 已成立**：`EU-1-mutation-verification/`。变异体 2/8 失败、对照（同副本、恢复原字节）8/8 通过；失败为机制级——下游 Run 以 `run_crashed：执行前材料校验失败：跨运行材料不可读或来源版本已失效` 结束，且 `隔离环境不可用` 出现 0 次（沙箱可用）。**此前一次尝试的结论不可采信**并已标注原因：那次未设 `CODING_AGENT_BWRAP_PATH`，7 项失败全是超时、`AssertionError` 为 0，无法区分"变异被捕获"与"环境坏了"；原始日志保留不改写。
- 测试字节快照：`test-snapshots/{before,after,diff}` 覆盖本批改动的 6 个测试文件与 16 个 restart fixture；`tests/app/explorations.test.ts` 本批 **0 行差异**。

### 能力路由与接口边界

- **B-1**：删除 `src/app/service.ts` 的 planId 前缀正则与 `operator-plan-compiler.ts` 的前缀入口守卫（全仓再无标识符前缀承担路由）。新增 `src/contracts/execution-capability.ts` 的 `ExecutionCapabilityV1`；组合根只推导一次，`server.ts` 供该值（不再写字面量），UI 读 `executionCapability.fixtureEnabled`；**夹具执行必须显式开启**（`fixtureExecution: true`），不再由"不像真实"推出。守卫改为 canonical 内容判定：计划必须声明 required 的 `coding-task` 且其 required 义务含 required 的独立验证要求（新计划为 reviewer，旧工具专属计划为 dynamic——保持"旧已受理 Plan 保持原义务"）。测试与浏览器夹具显式开启，`gui.test.ts` 与浏览器 23/23 通过。
- **A-1**：`registerWorkspace` 已在 `ControlEngine` 接口（`contracts/modules.ts`），宿主调用点唯一且**不传 ledger**；`registerWorkspace(h.ledger, …)` 全仓 0 命中。剩余类型面广度登记 DEF-03。
- **A-2**：`PlanCompiler → ArtifactVault` 这条**未落地**的边从三处文档一致删除（`ARCHITECTURE.md`、`human/module-status.md`、`plan-compiler` 模块页），未新增实现去凑边数。独立三源集合比较：Mermaid(ARCHITECTURE) = Mermaid(module-status) = `module-map.mjs` 强制表 = **34 条，集合完全相同，双向差集为空**。
- **A-3/R-6**：`CodeGraphPort` 无注册表时返回 `unsupported`，不再默认构造夹具图；`capabilityNote` 改为 `configured-registry`；头部注明真实路径是 `context/source-graph-context.ts`。删除 inert seam 登记 DEF-01（低风险选择为保留现状）。R-6 的两处降级差异经核实是**契约驱动**（`CodeGraphReadResultV1.sourced` 可如实表达降级，`CodeGraphResultV1.supported` 无降级字段），**不应**把 `workspace-reader-adapter` 也改成 `unsupported`——那会毁掉真实降级读取路径。
- **A-4/B-2**：检查器覆盖 `.ts/.tsx/.js`（解析 import/export）+ `.py`（仅归属），自报 `coverage.notASandboxVerification: true` 与 `excluded`；边界文档补 Storage / legacy UI / terminal-sandbox 三行归属（明确不属于 12 Module、不产生依赖边），并把"345 TS/TSX"口径改写为按扩展名分列 + 明写**不等于**沙箱验证。当前 359 源文件 / 360 inventory / 0 issues。

### 可读性与文档

- **R-1**：`ledgerIdentityKeyFor`、`validateGoalCreateCommit`、`validateBootstrapCommit` 收敛为 `contracts/ledger-validation.ts` 的单一实现（该文档早已声明此处共享），两适配器委托；Ledger 专项 5 文件 / 45 项通过。
- **R-5**：`buildHarness` 由 HEAD 的 **27 个位置参数**改为 **3 个非端口参数 + `options` 对象**（27 个可选字段逐一对应），唯一调用点 1 处。
- **ReadModel**：`baselineChangeView` 的 95 行纯推导（经规范化比较证实两侧逐字相同）抽取到 `src/read-model/baseline-change-projection.ts`，两后端共用；该函数无 `this.`、无 I/O、不读 cursor，行抓取/排序/cursor 仍归各适配器。双后端 37 文件 / 197 项通过。其余候选登记 DEF-04。
- **D-1…D-8**：逐项修正，见[集成交接](../../../dev_docs/verification/2026-09-10-external-review-repair/integration-handoff.md) §4。历史副本正文与旧数字一律保留，只加标注；权威入口统一为文档根 `human/module-status.md`、产品 `IMPLEMENTATION-HANDOFF.md`、`dev_docs/verification/README.md`。

## 五、独立审查与处置

独立审查由**未参与本批实现**的 Agent 完成，结论：**作为限定范围修复可接受，但本批有三处过度声明**。它独立复算了最终清单摘要与全仓/浏览器结论、独立复现了 EU-1（变异体 2/8 机制级失败、对照 8/8）、独立做了 R-4 双向注入（修复后 FAIL、修复前 SKIP），并从悬空 git blob 恢复比对了本批未快照的测试文件，确认**无一处削弱**。逐项发现与处置：

| 审查发现 | 处置 |
| --- | --- |
| F-01 只修了租约拒绝，`CodingAgentRuntime.start` 其余启动前校验错误仍 wedge（未登记） | **已修**：先尝试 `rejectBeforeStart`，仅在无法证明未启动时回退为抛出（保留歧义）；补 `tests/control/reviewer-lease-conflict-recovery.test.ts` 第二个用例 |
| B-1 使默认入口的样例夹具路径 400，违反"既有样例入口行为不变" | **已修**：捆绑宿主默认入口显式开启样例夹具执行器 |
| "全仓再无标识符前缀承担路由"不成立（源码模式仍提供修复前 bundle） | **已修**：重建 workbench，源码模式与 `dist` 产物逐字节相同，均无前缀路由 |
| R-3 替换断言在不可达分支且期望错误文本不符 | **已修**：改为只断言桩无法驱动该守卫；分支仍不可达的事实如实保留 |
| 测试快照只覆盖 27 个受影响文件中的 22 个 | **已补** `test-snapshots/`；独立审查另行比对确认无削弱 |
| "359/360"边界行测于删除窗口而非最终身份 | **已修**：最终身份重跑，本页记 362/363 |
| R-4"独立故障注入"无证据产物 | **已补**：`r4-probe-fault-injection/`（修复后 FAIL、修复前 SKIP、哨兵仍 SKIP 三向证据） |
| D-6 声称未成立项已登记（实际未登记） | **已修**：改为"尚未登记"，并指向延期登记 DEF-15 |
| `replaceFailedWork` 无产品入口，操作者仍无法通过产品修复卡住审阅 | **登记为 DEF-17**（属新的操作者工作流，不在本批范围） |
| 修复前 `reviewer-work.ts` 字节不可得，"原条件 `!== 'failed'`"只有失败日志佐证 | **如实保留为不可证**，不重建、不声称 |
| R-5"HEAD 27 个位置参数"、ReadModel"95 行"等数字偏差 | **已修正**：HEAD 实为 **26** 个位置参数（27 是 options 字段数）；纯推导实为 90 物理行 / 75 规范化行 |

完整逐项状态、复现命令与"无法验证"清单见[独立审查结论](../../../dev_docs/verification/2026-09-10-external-review-repair/independent-review.md)；本批自身的残留处置同时登记在[延期登记](../../../dev_docs/planning/active/external-review-repair/deferred-register.md) §三（REV-01…REV-10、DEF-17）。

## 六、不能据本批声称

真实模型语义审查质量、任意 OS 强杀恢复、FeatureBench/SWE-bench 类真实任务、完整自治产品、Windows 原生行为、`terminal-sandbox.py` 与 WorkspaceReader 的沙箱语义等价性（未运行 Landlock）、已接纳 Evidence 的一般来源失效与正式来源推进。以上均未验证或明确留作后续核心义务。
