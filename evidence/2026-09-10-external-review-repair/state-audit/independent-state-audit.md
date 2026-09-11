# 2026-09-10 最终状态独立核对（实施前基线）

本报告由未参与 ERR 或 DEF-17 实现的审查 Agent 完成。范围为用户当前委托的第一阶段：核对现有最终身份、既有测试与旧独立审查的关系，并按 REV-01…REV-10 定位最后变更。未重做无关全仓审查，未修改产品源码、既有文档或历史证据。主 Agent 根据本报告安排必要补测并归并当前状态；本报告不自行关闭 Ticket。

## 结论

**现有 739 文件清单和最终测试数量真实可核对，但不能把旧独立报告直接当成最终身份的全量差异审查。** 本次按最后修改范围补审，发现两个必要验证缺口（SA-01、SA-02）及一个证据措辞偏差（SA-03）。当前未发现需要重新实施原修复的生产缺陷。补足这些验证并统一状态后，原修复批次可以按原限定范围归并；DEF-17 另票验收，不扩大为完整产品完成。

机器结果为 [initial-state-audit.json](initial-state-audit.json)，可复算脚本为 [audit.mjs](audit.mjs)。该 JSON 固定本次开始时事实；后续实现造成源码不同，不应覆盖这一基线。四个重点审查文件另存 `audited-*` 字节。

## 身份与来源核对

- 最终清单 `final/final-source-sha256.json`：739 个路径，实际读取逐文件 SHA-256 **0 缺失、0 不符**。
- 摘要算法是 `SHA256(UTF8(JSON.stringify(manifest.files)))`，保留数组次序及字段次序。复算得到 `5a9e9eb1f7030860f54d16a2dff87a90f8a17c77f710ca70f212b788ac210364`。
- 相对冻结 candidate-04：新增 12、修改 57、删除 3。删除均为旧 workbench JavaScript bundle，三个新 hash 命名产物替代；清单差异已落盘。
- `src/app/public/workbench` 的全部 7 个文件与本次读取的 `dist/app/public/workbench` **逐字节相等**。主 bundle 中 `fixtureEnabled` 命中 3 处，未发现 `real-plan-` 或旧 executor fixture 路由。该目录是源码模式依赖，应继续保留。
- 旧独立报告明确复算的是 `11b6e71b75a221437a3b82dc79da76ce57a188b373804b1941ee6936898f00e6`。在产品 evidence 和权威 dev_docs 中，完整旧摘要只见交接引用，未找到旧完整清单；另外检查全部 5,189 个 Git 对象的元信息，对清单大小范围 70,000…180,000 字节的 189 个 blob 检索旧摘要，亦无命中。该范围搜索不能证明历史快照在任何位置都不存在，但本次没有取得它。
- 因此，**11b6 → 5a9e 的完整逐文件差异集合不可独立证明**。本次以旧报告 REV 列表、现有代码和冻结 candidate-04 差异定位最后修改，不能声称恢复了缺失快照或对一个不存在的完整 diff 审查无遗漏。

## 既有日志与最后修改的覆盖

| 范围 | 本次核对 | 覆盖判断 |
| --- | --- | --- |
| 最终全仓日志 | `253 passed (253)` / `1641 passed (1641)`，828.78s；Reviewer 租约文件明确 2 项、unknown 1 项、remediation 2 项、gui 4 项、code-graph 7 项 | 数量成立；日志没显示 skipped。日志本身没有独立命令回执/源码开始结束清单，exit 0 与运行身份的更强绑定仍来自原执行者记录，不能冒称本审查重新执行 |
| 最终浏览器日志 | `23 passed (3.7m)` | 数量成立；Playwright 从 fixture-server 启动并显式开启 fixture，不覆盖默认 server CLI 分支（SA-02） |
| REV-01 运行时启动错误分类 | 新 catch 在 release 后尝试 `rejectBeforeStart`；其前置断言仍要求 prepared、无 active/events/trace，无法证明时抛错保持歧义 | 生产改动有界，但现有第二测试没有走该新分支（SA-01） |
| REV-02 默认宿主样例执行 | `server.ts` 默认 CLI 分支明确 `{ fixtureExecution: true }`；服务仍用显式能力值 | 静态代码成立；现有 gui/browser 的显式 opt-in 路径不能证明默认 CLI，需最小实际烟测 |
| REV-03 workbench 重建 | 7/7 与 dist 相等；新 bundle 消费 fixtureEnabled | 现有浏览器覆盖构建产物，gui 亦有 `GET /`；本次补独立字节核对 |
| REV-04 R-3 断言 | 非 live 分支 `rejects.toThrow()` 不再钉住不成立错误文本；live 路径保留真正 evidence_mismatch 断言 | 非 live 分支仍不可达，应如实记录；现有最终日志 2 项通过不等于该分支执行 |
| REV-05 测试快照 | `COVERAGE-NOTE.md` 明说缺失的修复前字节未冻结，仅保存修后状态，旧审查者从 blob 比对 5 个 | 不能把这描述成缺失文件全部 before/after/diff 已补齐；独立恢复比对是旧审查者的历史结论 |
| REV-06 边界 | 最终 JSON 为 362 源文件 / 363 inventory / issues=[] | 成立；359/360 只应保留历史口径 |
| REV-07 R-4 注入证据 | 真实回归日志 FAIL，哨兵日志 1 passed / 1 skipped | FAIL 成立；“同次运行旧写法 SKIP”不成立（SA-03） |
| REV-08…10 与数字修正 | DEF-17 当时未实现产品入口；原 reviewer-work 修改前条件缺字节；独立报告已修正参数数和纯函数行数 | 这些边界需保留，不能因旧报告说已处理而推断当前所有入口文字已更新 |

类型和构建在验收页中没有独立日志路径，本次不把空白日志栏解释成独立运行证据。最终 DEF-17 身份必须按用户要求重新执行适用类型、构建、全仓、浏览器与边界检查。

## 发现与必要补验

### SA-01：REV-01 新测试未到达所声称的新 catch

`tests/control/reviewer-lease-conflict-recovery.test.ts` 第二例把 envelope 改为 `tools: ['read','write']`、`writeScope: ['*']`。`LeasedWorkerRuntime.start` 据此计算 `readOnly=false`，在 Reviewer 材料阶段的 `!readOnly` 条件先抛出“审阅运行缺少独立只读材料入口”，被原材料 catch 处理。它尚未调用 `runtime.start`，所以新增加的 runtime.start catch 即使删除，该例仍能通过。

必要补验：保持真实有效只读材料，令真实 `CodingAgentRuntime.start` 的前置检查失败；断言新 catch 被调用，canonical Run known crashed、无模型/工具副作用，再提供无法证明未启动时保持 unknown 的对照。应做有判别性的单分支变异：撤销新 catch 时相应测试失败。主 Agent 已把此项交给独立实现 Agent 补测试，本审查者不参与实现。

### SA-02：默认 CLI 启动恢复未被已有 opt-in 测试覆盖

`tests/app/gui.test.ts` 与 `src/ui/tests/fixture-server.mjs` 都显式传 `{fixtureExecution:true}`。这绕过 `server.ts` 的直接启动分支，因此不能证明 `pnpm start` 默认捆绑宿主能继续运行样例。

必要补验：真实构建后启动默认 `dist/app/server.js`，通过 HTTP 创建 sample plan 并运行既有 fixture task；验证实际执行与结果。无需改变生产功能或扩展全仓功能面。

### SA-03：R-4 “同次运行旧分支 SKIP”与日志不符

注入文件顶层的 `POSTFIX_READY` 先抛真实回归，测试模块收集提前失败；对应日志明确 `Tests no tests`。后面的旧写法 `describe.skipIf` 尚未注册，所以同次运行并未记录旧组 SKIP。

现有证据足以证明修复后真实回归 FAIL，以及独立哨兵用例 SKIP。旧独立报告另声称做过双向注入，可保留为历史审查结论，但不能说本落盘 FAIL 日志本身证明旧写法 SKIP。修正说明，或补一个独立旧写法注入日志即可。

## E-1 与 EU-1 边界

恢复文件与 Git blob `e1eda07e1a8f6dbe22915d24e78ace91be8b993a`：均为 **19,161 字节**，SHA-256 均为 `00dfc41f9fe04e8156b2279dd1d213b416894d1ea7ea693dcc663fef655cd8fa`，逐字节相等。2026-09-09 closeout 清单对应条目也是这一大小和哈希。与当前 explorations 测试 diff 只有 sourcePin 类型补充与新增严格断言，未见旧断言削弱；本批 before/after 探索测试 diff 为空。

这证明**恢复字节与记录的历史哈希一致**。Git blob 不带创建时间，closeout 清单当前未跟踪，所以“确实于 2026-09-09 冻结的来源”仍缺独立时间追溯链，不能用“E-1 已闭合”抹去此边界；也不能伪造旧 reviewer-work 字节。

EU-1 正式变异日志为 2 failed / 6 passed，控制日志为 8 passed；失败载荷包含跨运行来源失效拒绝，未见“隔离环境不可用”。该结论与旧独立报告一致。本次未重跑 EU-1，旧不成立的环境失败日志继续保留。

## 状态文档需要同步的具体项

- ERR README、ERR-01/02/03 仍为 active；integration-handoff 首段仍“等待独立审查”，正文仍 11b6、9/56/0、1640、359/360、2.9min；均是旧时点。
- acceptance 顶部虽然已写 5a9e、1641、362/363，后文仍残留 buildHarness 27 个位置参数、baselineChangeView 95 行、359/360；旧独立报告正确区分 **26 个位置参数、27 个 options 字段、90 物理行/75 规范化行**。
- deferred REV-10 中 `1633 − 2 + 8 + 1 = 1640` 算式结果应为 **1640**，但最终新增的启动前拒绝用例还需 +1，才是 1641；应明确两时点，不直接把算式末尾改错。
- REV-05 “缺失文件 before/after/diff 已补”与 COVERAGE-NOTE 的真实边界不符；E-1 恢复字节和时间来源要分开说明。
- IMPLEMENTATION-HANDOFF 的“当前工作包/最新 Reviewer 集成交接”和 module-status 接续末段仍指向旧批次或“正由本工作包收敛”，需将本轮状态和 DEF-17 单独接入，历史全文保留。

本次仅执行只读哈希/文本/对象/文件比较并写新 evidence。一次 WSL 只读 `/tmp` 搜索尝试返回宿主 `Wsl/Service/CreateInstance/E_ACCESSDENIED`，未关闭沙箱，也未用此结果解释任何产品测试红灯。本报告没有执行全仓、浏览器或产品测试；上述补验由主 Agent 统一安排。
