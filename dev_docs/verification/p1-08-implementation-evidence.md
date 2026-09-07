# P1-08 只读状态与依据控制台：实现证据

日期：2026-09-06。票据：[P1-08 只读状态与依据控制台](../planning/proposed/P1-foundation/tickets/08-status-evidence-console.md)（status 保持 `proposed` —— 开发流程依据证据更新状态）。产品根 commit：`7664d91`（上游基线 `404ab28`：88 files/722 tests；本票共享基线 `3f68b83`）。

## 1. 结果摘要

| 项 | 结果 |
| --- | --- |
| typecheck | 0 errors |
| 单测/契约套件 | 97 files / 768 tests PASS（含 P1-00..07 既有 722 测试零回归；P1-08 新增 46 测试全启用——isP108Ready 探针为真、零 skip） |
| P1-08 验收 | 12/12 |
| P1-08 验证组 | 7/7（portfolio-list-and-switch / multi-project-workspace-isolation / same-local-id-scope / no-model-status-query / read-only-adapter / cursor-freshness / restart-view-rebuild） |
| 集成（真实 SQLite 全路径） | 1/1（seal→reopen 逐字段一致） |
| 重启证据 | 1/1（六视图 + observedCursor 逐字段一致） |
| validate-docs | 13/13 |

## 2. 交付

- **7 个契约冻结（首个消费者 = 本票）**：PortfolioViewQuery / WorkspaceSummaryView / WorkspaceSelectionRoute / PlanMatrixViewQuery / ActiveAgentsViewQuery / TaskEvidenceViewQuery / TimelineViewQuery（wire schema 见 `src/contracts/console-views.ts`，全部 v1、双适配器、freshness 沿用 opaque CommitCursor）。
- **HumanCollaboration 版本化查询组**（consolePortfolio / consoleSummary / consolePlanMatrix / consoleActiveAgents / consoleTaskEvidence / consoleTimeline；createGoal/goalView 形状不变）；ReadModelIndex 同 6 个查询（版本化追加）。
- **只读面**：console 路径只经 ReadModelIndex（HumanCollaborationImpl 纯委托；无 runtime/control 写入面可达；无模型调用；不刷新 Worker lease；不写 canonical state；控制台自身无状态可持久化）。
- **0 个新 DomainEvent**：全部投影消费既有 v1 事件；KNOWN 与 isHandledEventType 与既有实现零差异（同 commit 核对）；P1-00…P1-07 冻结形状零改动（只版本化追加）。
- **双适配器**：InMemory + SQLite 同套件同夹具；SQLite 新增 6 表（console_portfolio/summary/matrix/agent/evidence/timeline，JSON 行 + full-scope key）。

## 3. 验收映射（12 项）

| # | 验收 | 验证 |
| --- | --- | --- |
| 1 | 正式状态与未验证报告分开标记；纯事实查询不调用模型；跨 scope 或过期解释不混入当前事实 | console.contract.suite status-and-sources-test + same-local-id-scope-test + no-model-status-query-test（claim 证据 marker=unverified_report；modelExplanation.status=unavailable；无 RunPort 调用） |
| 2 | 持续、转交与未知结果按来源展示，不把暂时等待显示为工作完成 | status-and-sources-test：ongoing（runStatus running + displayState ongoing + handoff 标记）/ outcome_unknown（displayState outcome_unknown） |
| 3 | Portfolio 列出两个彼此隔离 Project/Workspace 且可选择/切换 | portfolio-list-and-switch-test（proj-alpha/ws-shared + proj-beta/ws-shared 两行） |
| 4 | 复用相同本地 workspaceId/goalId 不串读 | same-local-id-scope-test + multi-project-workspace-isolation-test（summary/evidence/agents/timeline 各自隔离） |
| 5 | workspace → goal → plan/task/run/evidence/timeline 查看 | status-and-sources-test（matrix/agents/evidence/timeline 全路径） |
| 6 | 列出/切换只改展示查询范围，不写 canonical state、无隐式"当前 Workspace" | portfolio-list-and-switch-test（纯路由）+ read-only-adapter-test（ledger events 与 observedCursor 前后一致） |
| 7 | 每个 displayed phase 带 source revision/cursor；完成结论可追到 EffectiveEvidenceSet | status-and-sources-test（phaseSources.planned/live + sourceCursor；effectiveEvidenceIds 含 ev-p108-work） |
| 8 | 机械状态查询只访问 ReadModel，不启动模型、不刷新 lease | no-model-status-query-test（CountingRuntime starts/polls 不变）+ read-only-adapter-test（TrapControlEngine/TrapStateLedger） |
| 9 | console Adapter 不能读 SQLite 表、写 Todo 或修改 canonical state | read-only-adapter-test + p1-08.contract-suite.sqlite（ledger 文件无 console_* 表；events 前后一致；Trap 断言） |
| 10 | projection 落后显示 not_ready，不回显请求伪装成功 | cursor-freshness-test（atLeastCursor 未覆盖 → not_ready；覆盖且无行 → not_found；无 atLeastCursor 无行 → not_ready） |
| 11 | 重启后相同事件重建等价 View | tests/restart/p1-08-*（真实 SQLite seal→reopen 六视图+光标逐字段一致；isP108Ready 探针） |
| 12 | 无隐藏控制/QueryJob/Planner side effect | no-hidden-side-effect-test（console 查询零事件 + TrapControl 证明无隐藏命令路径） |

## 4. 关键裁决（详见产品根 IMPLEMENTATION-HANDOFF.md「P1-08 只读控制台契约与查询语义（冻结）」）

1. 范围与路由：控制台 = HumanCollaboration 版本化扩展（不新增 Module）；WorkspaceSelectionRoute 纯路由，只改查询参数，无持久化选择。
2. 全作用域键：列表/路由/结果/缓存键一律 `canonicalJson(完整 ref)`。
3. 七个契约全部 v1、有界（CONSOLE_TIMELINE_MAX_ENTRIES=200 / ACTIVE_AGENTS_MAX_ROWS=100 / MATRIX_MAX_TASKS=512 / EVIDENCE_SUMMARY_MAX_BYTES=4096 / PORTFOLIO_MAX_PROJECTS=64）。
4. 正式/report 分离：marker（unverified_report / observed_fact）；modelExplanation 四态（P1-08 无模型语义解释 → unavailable；确定性 reason codes 带 sourceCursor）。
5. 不新增 DomainEvent；无 Findings；隐藏 control/QueryJob/Planner side effect 零容忍。
6. 重启等价：全部新投影持久化 + 从持久 EventPage 重建逐字段一致。

## 5. 边界确认

- 未做 P1-09（QueryJob/非阻塞模型查询）、P1-10（pause/stop/安全点控制——只展示状态）、P1-11/14/15（目标修改、主动通知、议题/决定闭环——被动展示已存在事实）。
- P1-03/04/05/06/07 冻结形状零改动（代码 diff 核对）；Goal reducer 未触碰。
- 主动通知、待决与变更上报归 P1-14/15；G4 等待 P1-09 + P1-11；09/10 需 08 + P1-16 产物——本票 08 侧产物已齐。
- 本地 main 未推送 GitHub origin main（推送需用户授权）。

## 6. 命令记录

```text
# 基线复跑（实施前）
pnpm typecheck                                       # 0 errors
pnpm test                                            # 88 files / 722 tests PASS（基线）

# 共享基线后（lanes A/B 各自 worktree 验证）
pnpm vitest run tests/read-model/p1-08-portfolio-summary.test.ts            # 5 passed（lane A, InMemory）
pnpm vitest run tests/sqlite-read-model/p1-08-portfolio-summary.test.ts      # 5 passed（lane A, SQLite）
pnpm vitest run tests/read-model/p1-08-matrix-agents-evidence-timeline.test.ts       # 5 passed（lane B, InMemory）
pnpm vitest run tests/sqlite-read-model/p1-08-matrix-agents-evidence-timeline.test.ts # 5 passed（lane B, SQLite）

# 合并后（integrator 全量验证）
pnpm typecheck                                       # 0 errors
pnpm test                                            # 97 files / 768 tests PASS（P1-08 双套件 11/11 + 12/12、restart 1/1、集成 1/1、evidence 1/1、P1-00..07 零回归）
npx vitest run tests/restart/evidence/p1-08-evidence.test.ts   # P1-08-EVIDENCE 块（见 §1 摘要）

# 文档校验（docs 根）
node dev_docs/verification/validate-docs.mjs         # 13/13 checks passed
```
