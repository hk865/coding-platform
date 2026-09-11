# ERR-2026-09-10 外部审查修复与重新验收：集成交接

状态：2026-09-10，本批实现与验证已完成，等待独立审查复核后收口。入口：[工作包 README](../../planning/active/external-review-repair/README.md)、[外部审查报告](../2026-09-10-external-review/report.md)、[延期登记](../../planning/active/external-review-repair/deferred-register.md)、[模块状态](../../../human/module-status.md)。

产品根 `D:/1.project/Software/agent_platform`；文档根 `D:/1.project/Software/agent_learn/agent_dev/agent_platform`。本批按用户委托只修外审已确认的问题，**未启动**返工重验、记忆、接续、来源正式推进或其他核心功能。

## 1. 逐项发现的状态

外审发现编号沿用报告：F-01（§2.2 的 Reviewer 启动前失败分类）与 §2.3、§3.1、§3.3、§1.2、§1.4、§1.6、§4。

| 发现 | 状态 | 关键证据 |
| --- | --- | --- |
| F-01 零副作用启动失败被记为 `outcome_unknown`，plan 永久不可再审且阻塞同工作区 | **已修** | `src/control/leased-worker-runtime.ts` 租约被拒改走 `rejectBeforeStart`；`tests/control/reviewer-lease-conflict-recovery.test.ts` 用真实 Control/Ledger/Vault/ReviewerDispatch/CodingAgentRuntime 构造重叠写租约与 Reviewer 读租约冲突 |
| F-01 下游：**受控重新受理在修复前不可达** | **已修（本批新发现）** | `src/control/reviewer-work.ts` 的 `replaceFailedWork` 曾要求 `oldRun.outcome === 'failed'`，而 `run_crashed` 按 `contracts/dispatch.ts` 的 `runtimeEventTerminalOutcome` 折为 `crashed`，条件永假。改为 `'crashed'` 后重新受理可达 |
| F-01 `consumeDispatchedRun` 的 `expectedRevision=2` | **核对为正确** | `startRun` 的 commit builder 显式写 `revision: 2`；实测修订号 1→2→3 符合预期。修复前该路径报 `Cannot read properties of undefined` 是因为测试端口未绑定实例，非产品缺陷 |
| §2.2 未验证项"真实租约冲突端到端复现" | **已补** | `reviewer-recovery-targeted` 系列日志（修复中失败）→ `err01-targeted-pass.log`（通过） |
| 已开始/无法证明副作用的失败必须保持 `outcome_unknown` | **已补对照回归** | `tests/control/reviewer-unknown-outcome-preservation.test.ts`：执行器不可达 → 第二次 drive 记 `outcome_unknown`、Run `ended/outcome_unknown`、公开观察一致、trace/usage/events 全空、模型调用 0 次、无第二个 session，再次 drive 不重跑 |
| §2.3 验收措辞超范围 | **已修** | `VR-02.md` 限定为"接纳前/执行中"来源变化；已接纳 Evidence 的一般来源失效明确留后续 |
| §3.1 E-1 修改前字节未保留 | **已闭合** | 原始 19161 字节从悬空 git blob 恢复并冻结在 `evidence/.../E-1-recovered-original/`，SHA-256 `00dfc41f…cd8fa` 与 `closeout-source-sha256.json` 精确一致；恢复出的 diff 证明 2026-09-09 的改动是**加强**测试 |
| §3.3 EU-1 变异验证 | **已成立（此前一次尝试无效）** | 变异体 2/8 失败、对照 8/8 通过；失败是机制级（`跨运行材料不可读或来源版本已失效`），沙箱可用（`隔离环境不可用` 出现 0 次） |
| R-2 三处 `expect(true).toBe(true)` | **已修** | `grep` 全仓 0 命中；两处改为真实读模型断言，第三处空组删除，覆盖由 `tests/integration/p1-16.real-kernel.continuity.test.ts` 承担（已在本票注明） |
| R-3 永真断言 | **已修** | 改为真实调用 + `rejects.toThrow`；该分支当前不可达（`live=true`），实质防护由同一用例的 live 路径覆盖 |
| R-4 16 个 restart 就绪探针把 FAIL 变 SKIP | **已修，含 2 个外审未列文件** | `tests/restart/readiness-probe.ts` 只把显式未实现哨兵转为 not-ready；全 `tests/restart` 已无裸 `catch {`；独立故障注入证明真实回归 → FAIL（修复前同一注入 → SKIP） |
| RD-5 替身 `pendingDispatchIntents` 忽略 `selection` | **已修** | 与两套生产 Ledger 同为 filter(status)→filter(selection)→sort→limit；排序统一为 `canonicalJson`（原为 `JSON.stringify`，键序不同）；有判别性专项断言 |
| B-1 planId 前缀承担能力路由 | **已修** | 删除 `service.ts` 的前缀正则与 `operator-plan-compiler.ts:102` 的前缀入口守卫；新增 `contracts/execution-capability.ts` 的显式 `ExecutionCapabilityV1`，服务只在组合根推导一次、`server.ts` 供该值、UI 读 `fixtureEnabled`；夹具执行必须显式 `fixtureExecution: true` |
| B-2 共享 owner 未进边界文档 | **已修** | `module-boundaries.md` 增 Storage / legacy UI / terminal-sandbox 三行，说明不属于 12 Module、不产生依赖边 |
| A-1 宿主持有可写 Ledger 写 canonical | **已修（接口层）** | `registerWorkspace` 已在 `ControlEngine`（`contracts/modules.ts`），宿主调用点唯一且不传 ledger；剩余类型面广度登记为 DEF-03 |
| A-2 文档声明 `PlanCompiler → ArtifactVault` 未落地 | **已修（改文档，不凑边）** | 三处一致删除该边：`ARCHITECTURE.md`、`human/module-status.md`、`plan-compiler` 模块页；实测三源集合均为 34 条且完全相同 |
| A-3 `CodeGraphPort` 缺省返回夹具图 | **已修** | 无注册表 → `unsupported`；`capabilityNote` 由 `fixture-registry` 改为 `configured-registry`；头部注明真实路径是 `context/source-graph-context.ts`。删除 inert seam 登记为 DEF-01 |
| A-4 无 owner 的 `.js`/`.py` 与"345 TS/TSX"口径 | **已修** | 检查器覆盖 `.ts/.tsx/.js`（解析）+ `.py`（仅归属），自报 `notASandboxVerification`；边界文档改写覆盖/排除范围，明确**不等于**沙箱验证 |
| R-1 两套 Ledger 三对重复校验 | **已修** | `identityKeyFor`/`validateGoalCreate`/`validateBootstrap` 移入 `contracts/ledger-validation.ts` 单一实现；两适配器委托 |
| R-5 `buildHarness` 27 个位置参数 | **已修（本批内）** | 现为 3 个非端口参数 + `options` 对象；唯一调用点 1 处 |
| ReadModel 已证实重复的纯投影 | **部分收敛** | `baselineChangeView` 的 95 行纯推导抽取到 `src/read-model/baseline-change-projection.ts`，两后端共用；双后端 197 项通过。其余单元登记 DEF-04 |
| D-1…D-8 文档精度 | **已逐项修正** | 见 §4 |

## 2. 修复前后反例与快照

- 修复前 F-01 wedge（隔离副本，未改产品源码）：`evidence/2026-09-10-external-review-repair/f01-prefix-reproduction/`。复现的是修复前接触面——租约被拒即 `throw`——并记录驱动两次后的真实后果：drive#1 `dispatch_interrupted`、drive#2 `runtime_outcome_unknown`、canonical Run `ended/outcome_unknown`(rev 3, lastEventSeq 0)、公开观察一致、模型 0 次调用、同 requestId 幂等重放同一 wedge、**同一 task+plan 的新请求 `review_already_exists` → 该 plan 永久不可再审**。
- 修复后对照：`err01-targeted-pass.log`、`err01-reviewer-suite-pass.log`（Reviewer 专项 8 文件/67 项）、`success` 的 workspace 解阻断言（同一 workspace 后续轮次仍 `completed` 且 canonical Reviewer 材料仍 `ready`）。
- 修复过程中的失败日志按序保留：`err01-postfix-failure-01-projection-port.log`（测试注入裸 Control 端口导致投影未推进）、`-02-unbound-control.log`（解构方法丢失 `this`）、`-03-outcome-crashed-vs-failed.log`（暴露 `replaceFailedWork` 的不可达条件）。**这些是测试/策略缺陷的真实修复前证据，未被改写。**
- EU-1 的**不成立**前例与成立结论分开放置：`eu1-mutation.log`、`eu1-mutation-workspace-copy.log` 保留原样并标注不可采信；成立证据在 `EU-1-mutation-verification/`。
- 测试字节快照与差异：`test-snapshots/before`（本批冻结，等同 `before/tests/`）、`test-snapshots/after`、`test-snapshots/diff`。本批改动的 6 个测试文件 + 16 个 restart fixture 均有 diff；`tests/app/explorations.test.ts` 本批 **0 行差异**（未被改动，也未被削弱）。

## 3. 最终源码身份与命令

- 清单：`evidence/2026-09-10-external-review-repair/final/final-source-sha256.json`。范围 `src/tests/scripts` + 根构建配置，排除依赖、`dist`、`.vite`、`.local`、产品 `evidence/`、`src/ui/test-results` 与 `src/ui/test-results`。**包含** `src/app/public/workbench`（`server.ts` 源码模式运行的必需依赖，已按候选哈希逐文件校验后原样恢复），因此与本批所审的 candidate-04 覆盖同一批路径。**739 文件**，摘要 `11b6e71b75a221437a3b82dc79da76ce57a188b373804b1941ee6936898f00e6`。
- 相对外审所审的 candidate-04（730 文件）：**新增 9、修改 56、删除 0**。（过程中曾误删 `src/app/public/workbench/**` 的 7 个文件，导致 `GET /` 立刻失败——该目录是源码模式运行的必需依赖，不是死构建产物；已按 candidate-04 逐文件 SHA-256 校验 7/7 一致后原样恢复，并登记为 ENV-07。）
- 命令与退出码见 §5。运行约束见[延期登记](../../planning/active/external-review-repair/deferred-register.md) §二（`CODING_AGENT_BWRAP_PATH`、`CHROME_PATH`、`npm` shim、并行超时）。

## 4. 文档修正（D-1…D-8）

| ID | 修正 |
| --- | --- |
| D-1 | `module-status.md` 架构批次数字段首改标"架构重建批次（历史数字，2026-09-09）" |
| D-2 | 产品 `IMPLEMENTATION-HANDOFF.md` 同段加历史标注 |
| D-3 | `VR-02.md` 加"接纳前/执行中"限定并交叉引用 Interface |
| D-4 | VR-02 验收页两套类型检查改为标出真实来源（`verification-results.json` 的 exitCode），并注明两个日志为 0 字节 |
| D-5 | `dev_docs/verification/README.md` 补 VR-01/VR-02/外部审查/本工作包四个入口 |
| D-6 | 结构审计页标 `superseded`，逐项写明去向与仍成立项的登记位置 |
| D-7 | 产品根 `ARCHITECTURE.md` 标 `historical_copy` 并指向文档根；说明根 `dev_docs/` 为不完整历史副本 |
| D-8 | `module-status.md` 接续入口改为"架构与 Reviewer 批次已验收；外审问题由本工作包收敛；其余待用户审查后动工" |

历史副本正文、旧数字与旧日志一律保留，只加标注；权威入口统一为文档根 `human/module-status.md`（人类状态）、产品 `IMPLEMENTATION-HANDOFF.md`（交接）、`dev_docs/verification/README.md`（验证索引）。

## 5. 验证结果（最终身份）

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 后端类型 | `node .local/linux-test-tools/node_modules/typescript/bin/tsc --noEmit` | exit 0 |
| UI 类型 | `pnpm --dir src/ui exec tsc -p tsconfig.json --noEmit` | exit 0 |
| 构建 | `npm run kernel:build && tsc -p tsconfig.app.json && node scripts/copy-ui.mjs && pnpm run ui:build` | exit 0（kernel/app/UI 实际构建） |
| 全仓 | `bash scripts/test-wsl.sh --maxWorkers=2` | 见 `final/full-tests-final.log` |
| 浏览器 | `pnpm run ui:test`（需 `CHROME_PATH`） | 23/23 通过，exit 0，2.9min |
| 静态边界 | `node scripts/check-module-boundaries.mjs` | 359 源文件 / 360 inventory / 0 issues，exit 0 |
| 文档 | `node dev_docs/verification/validate-docs.mjs` | 13/13，exit 0 |
| DAG 三源一致 | 独立三源集合比较 | 34 = 34 = 34，集合完全相同 |

**测试数量不作为硬指标。** 本批为 253 文件 / 1640 项（外审记录 249 文件 / 1633 项）。净增来自新增回归：Reviewer 恢复 1、unknown 保持 1、就绪探针 5、替身 selection 1，另有 R-2 空组删除（−2，覆盖由 p1-16 真实内核套件承担）与并行负载下的超时口径说明。skipped = 0。

## 6. 未修项与边界

全部未修项、不修理由、风险与后续验收条件见[延期登记](../../planning/active/external-review-repair/deferred-register.md)（DEF-01…DEF-16 与 ENV-01…ENV-07）。最需要在后续接续时注意的四项：

1. **DEF-11**：已接纳 Evidence 的一般来源失效与正式来源推进仍是后续核心义务，本批未动工；这是外审 §2.3 已披露的边界，不是新缺口。
2. **DEF-03**：A-1 的接口问题已修，但宿主仍把完整 `StateLedger` 交给约 20 个协作者，缺编译期约束。
3. **DEF-05**：来源全量读取与 `/reviews/read` 轮询性能只登记测量任务；任何优化都不得削弱授权、来源 pin 与接纳前复核。
4. **ENV-07**：`src/app/public/workbench/` 是源码模式运行的必需依赖，**不要删除**。

同时，本批**没有**证明：真实模型语义审查质量、任意 OS 强杀恢复、官方 benchmark、完整自治产品、Windows 原生行为、`terminal-sandbox.py` 与 WorkspaceReader 的沙箱语义等价性。
