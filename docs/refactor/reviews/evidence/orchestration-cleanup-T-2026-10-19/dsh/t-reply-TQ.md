# TQ 回复（wave 1，v2）

> 本回复写在 runner 的 360k handoff 暂停点。最后一次 typecheck 绿；测试按批次已跑（见 §4）。**尚未 commit、尚未生成 ledger**：暂停时工作区还有两处外部夹具未闭合（§2、§7），见 HANDOFF。
>
> **第二段补记（2026-10-19 19:50）：** 工作区已提交为 `5057649 T TQ`，ledger 已生成；见 §4 与 §6。两处外部夹具按 lead 裁定留给 TP 组，未改。

## 1. 逐项表

| 编号 | 结果 | 改了哪些文件 | 覆盖 / 备注 |
|---|---|---|---|
| TQ-001 | partial | src/app/attention-observer.ts、src/app/host.ts、tests/app/S0-attention-edge-label.test.ts、tests/app/S3-attention-context.test.ts、tests/scenarios/S3-query-graph.test.ts | 删除 668-715 直接读取回退与 plans/architecture 依赖；readAttentionGraph 必填；S0-01/02/03 走真实 runtime.readAttentionGraph、memory+SQLite、真实 architecture/P1；AT04/AT11 删假件、保留断言；SC02 绑 readAttentionGraph。**S0 的 Plan p1 仍由公开 plans.proposePlan 接收测试构造 draft（F1）**：A1 初始计划入口强制把 planId 改成 `initial-plan-<hash>`（src/core/work-graph/tasks/initial-plan.ts:105-107、144-147），无法产出 `plan:p1`，需 lead 裁定冻结入口或改 plan 身份。 |
| TQ-002～TQ-061（60 项） | done | tests/architecture/production-reach-allowlist.json | 每条 reason pre-batch→wire-format，note 按条目模板（`like the GoalsSettingsBody entry: the <route> route request/response DTO; ...`），路由名取自 CORE_ROUTE_SPECS；仅改 reason/note 两行/条。 |
| TQ-062 | done | src/app/host-settings-types.ts、tests/app/settings-ui.test.ts | automation/resourceCaps 必填，删“older snapshots”注释；补两处快照字面量。 |
| TQ-063、TQ-064 | done | production-reach-allowlist.json | main.ts 两条 reason→wire-format，note 改 workbench startup JSON shape / parseWorkbenchCliConfig / README.md:59。 |
| TQ-065～TQ-069、TQ-089 | done | 删 src/contracts/role-material-channels.ts、src/core/workspace/role-source-reader.ts；tests/data/workspace-path-boundary.test.ts；删白名单 6 条 | 保留拒绝前缀用例（逐字未动），删 3 个读取器用例与夹具；IMPLEMENTED-CAPABILITIES.md:298 属 docs/，留 lead。 |
| TQ-070、TQ-079 | done | body-codec.ts、body-ports.ts、materials/applicability.ts、R3b-materials-contract、R3b-body-boundaries、S3-context-inputs | origin 必填；缺 origin→corrupt；删 legacy 成员/镜像/一致性检查；删旧格式与 IN18 用例；保留当前格式用例。 |
| TQ-071 | done | src/core/record-store/sqlite-lookup-indexes.ts | 删 drop 分支与 DROP 循环，保留 expectedIndexes、缺索引 create、BEGIN IMMEDIATE 重规划。 |
| TQ-072、TQ-100、TQ-107 | done | sqlite-text-scan.ts、tests/record-store/SP-text-scan.test.ts、删 tests/helpers/SP-storage-migration-fixture.ts | 删 LEGACY_TABLES_SQL 与开库删表、SP-12、专用夹具；SP-05/09/10/11/11B 保留。 |
| TQ-073 | done | architecture-record-codecs.ts | 删 FILE_GRAPH_CHUNK_SCHEMA_ID，注释移到 CONTENT_TYPE。 |
| TQ-074 | done | catalog-record-codecs.ts | catalog 记录 since 键必填；删 decode 补 null 与内嵌记录的缺键分支；显式 null 保留。 |
| TQ-075～TQ-078 | done | production-reach-allowlist.json | 保留 kept-for；note 末句按改正改为 called by RoleConfigurationPort.*; no direct test caller。 |
| TQ-080 | done | note-contracts.ts | 删 NOTE_BODY_PAGE_MAX_BYTES。 |
| TQ-081 | done | tool-commit-arguments.ts、K3-39-tool-commit-lookup.test.ts | 删 toolCommitLookupNotPublished；测试删导入与第一句断言，保留 unknown_tool 与公开分派。 |
| TQ-082、TQ-083 | done | decision-record-codecs.ts | 删两个 SCHEMA_ID 与选择器注释。 |
| TQ-084 | done | note-record-codecs.ts | noticeClass/actor/proof 必填；删 withNoticeClass 及三处调用、undefined 守卫与 ?? null。 |
| TQ-085、TQ-086、TQ-108 | done | command-normalization.ts、tests/state/command-normalization.test.ts、白名单 2 条 | 删 ShellActionsResult/parseShellActions；测试改 detailed 投影、删重复第四层用例与两处投影断言；57/57。 |
| TQ-087 | done | model-call-contracts.ts、model-request-codecs.ts | 四个 pin 字段必填（51-54），删历史许可注释，校验去 undefined 守卫。 |
| TQ-088、TQ-113 | done | session-facts.ts、S1-session-facts.test.ts | 删指针补充定位/例外/pointerDone 游标；保留缺记录、损坏、作用域与 !sessionMatch 拒绝；删 SV53 与专用导入。 |
| TQ-090、TQ-093 | done | display-preference.ts、src/ui/main.ts、MVP-ui-entry.test.ts | 删 V1 键/readLegacy/两处迁移与导出；保留 v2 全局读与 per-scope 断言；删迁移段、改名。 |
| TQ-091 | partial | catalog-contracts.ts、catalog-service.ts、architecture-service.ts、architecture-reminder-facts.ts、note-anchors.ts、note-related-scope.ts、scribe-scope.ts、goal-conflicts.ts、graph-context-reader.ts、node-detail-reader.ts、note-views.ts、ui planning/architecture/node-link/panels、auto-capture-driver.ts；测试部分见 101/105/109/110/111 | 生产收窄完成（catalog 非空；当前读取缺目录行→unavailable、成功必含 catalog 与无条件 guard；删 predates-catalog 拒绝；1548/1716 保留）；typecheck、production-reach、S8A/A1/MVP 测试绿。**外部夹具未全闭合**：R4b-session-directory 与 S2B-34-executed-files 仍用“裸 baseline 无 catalog”，现返回 unavailable（§2/§7）。 |
| TQ-092 | done | tests/kernel/RL-12-15-conditions.test.ts | 仅两处下界 10_000→9_900；RL 套件在本机因缺 /usr/bin/bwrap 全红（基线同样）。 |
| TQ-094～TQ-099 | done | R3b-body-boundaries.test.ts、R3b-materials-contract.test.ts | 删 3 个篡改用例与 2 个旧格式用例；88-106 整条按 TQ-099 删、保留 107 外层括号；保留当前格式 45/110/132/144。 |
| TQ-101 | done | graph-session-fixture.ts、A1-architecture-catalog、A1-independent-review、A1-session-lifecycle | 两处借旧基线改 adopt/revise；删 seedLegacy、旧 catalog:null 用例、篡改用例与 helper。 |
| TQ-102 | done | tests/helpers/graph-session-fixture.ts | 原始 scopeSeed 改 createProject→registerWorkspace→installCompletionPolicy→activateCompletionPolicy；登记 PROJECT_BOOTSTRAP_RECORD_SCHEMAS；无 baseline。 |
| TQ-103 | BLOCKED | — | 改正要求先冻结真实 Workflow/脚本模型生产计划提议入口；手写 Plan 改 draft 仍 F1。 |
| TQ-104、TQ-112 | BLOCKED | — | 依赖 TQ-103 的合法已接受 Plan；否则 archive 场景前置仍是 F1（book §4 表）。 |
| TQ-105、TQ-110 | done | graph-session-fixture.ts、A1-architecture-catalog、A1-session-lifecycle | 统一删除清单：删篡改段/专用用例，保留缺指针与 healthy（healthy 改 adopt），删 seedTampered。 |
| TQ-106 | done | graph-session-fixture.ts | 去掉 4 个 export。 |
| TQ-109 | done | A1-architecture-catalog.test.ts | 删 catalog:null 历史用例。 |
| TQ-111 | partial | A1-independent-review.test.ts | 66-95 改真实 adopt→revise 竞争并断言当前 catalog；22-62 按改正保持 BLOCKED（未改）。 |
| TQ-114、TQ-115 | BLOCKED | — | 改正：执行事实须由真实 Host/Workflow/脚本模型写；IN04/IN14/IN11/IN12/Plan 前置未冻结，禁止手写 entered/observation/Message 或接受手写 draft。 |

## 2. BLOCKED 与 partial 证据

- **TQ-001 partial**：`src/core/work-graph/tasks/initial-plan.ts:105-107`（`initialPlanIdFor` 返回 `initial-plan-<sha256>`）、`:144-147`（覆盖 model planId）、`src/core/work-graph/tasks/plan-service.ts:1844-1845`。A1 初始计划链无法产出条目冻结的 `plan:p1`；当前 S0 用 `platform.plans.proposePlan` + 测试 draft（规则表 F1）。请 lead 裁定：冻结保留 model planId 的入口，或改条目计划身份。
- **TQ-091 partial**：`tests/work-graph/R4b-session-directory.test.ts:33-49` 与 `tests/helpers/task-claim-fixture.ts:198-217`（S2B-34 经 B2 夹具继承）仍 seed 裸 baseline、无 catalog 行；`readCurrentCatalogWindow` 现在正确返回 `unavailable`，测试期望 old `not_found`/`ready`。需给这两处夹具补 catalog 行（空 modules 即可）或改成无 baseline。
- **TQ-103/104/112/114/115**：见表格与 book §4 依赖表。
- **TQ-111**：22-62 子项按书面核对改正保持 BLOCKED，不计完成。

## 3. 白名单外文件

- `tests/helpers/S5-decision-fixture.ts`：TQ-091 的必然下游（book 检查漏列）。原夹具 seed 裸 baseline + active pointer；现补 `ArchitectureCatalog` 当前格式行（module M、since:null）。补后 `K3-26`（40 项）与 `S5-decision-queue`（18 项）全绿。仅此一个白名单外文件被改。
- 尚未改、需下一段处理：`tests/work-graph/R4b-session-directory.test.ts`、`tests/helpers/task-claim-fixture.ts`（见 §2）。

## 4. 检查

- `npm run typecheck`：**绿**（tsconfig.json + tsconfig.ui.json 均无输出）。
  - 任务书要求 `flock /home/han001/dsh-work/t-typecheck.lock ...`；该锁在会话工作区外，workspace-write 下报 `Permission denied`，提权无审批通道，故直接运行（本机无并行组在跑）。下一段如有权限请改回 flock。
- `npm run check:architecture`：**绿**（boundaries OK）。
- `tests/architecture/production-reach.test.ts`：4/4 绿（allowlist 与删除声明一致，169 条）。
- 测试批次（`npx vitest run --maxWorkers=2`）：
  - 批 1（S0/S3/SC02/R3b/SP/production-reach）：10 files / 95 tests 全绿。
  - 批 2（A1/S8A catalog/settings/MVP/B2 permit/command/S1/K3-39）：14 files / 192 tests 全绿。
  - 批 3（A2/RL-40/R6/S5 routes/S8A/A1 platform/R3b/S8D/S8E）：12 files 绿、2 files 红（8 项），原因均为 `ENOENT /usr/bin/bwrap`：`A2-automation-verdict`、`S8A-L8-pass-capture`；101/109 项通过。
  - 批 4（R3d/S8A/S4C/S5/S1 等 25 files）：337 通过、20 失败；失败为 `K3-26`（4）与 `S5-decision-queue`（16），根因是 S5 夹具裸 baseline。**补 S5 夹具后重跑：K3-26 40/40、S5-decision-queue 18/18 全绿。**
  - 批 5（K3-20/S5R2/S2B/WP2/R3c/R4b 等 14 files）：172 通过、6 失败：`R4b-session-directory` 2 项（期望 not_found 得 unavailable）、`S2B-34-executed-files` 4 项（期望 ready 得 unavailable），均为裸 baseline 夹具，尚未修（§2）。
  - `RL-12-15-conditions.test.ts`：11/11 因缺 bwrap 在 setup 失败（基线同样），非本组改动。
- **commit / ledger（第二段补做）**：已按书 §3 提交为 `5057649 T TQ`（`git add -A -- src tests scripts resources runtime-assets.json`）。ledger 已生成到 `.dsh-ref/ledger-TQ.txt`：71 条 REMOVED assertion、19 条 REMOVED test/describe、1 条 ADDED expected constant、1 个删除文件；全部映射到条目，无未映射行（见 §6）。`git diff --shortstat t-base HEAD` = `59 files changed, 600 insertions(+), 1339 deletions(-)`。
- **已知失败（lead 裁定保留，TP 组负责）**：`R4b-session-directory` 2 项、`S2B-34-executed-files` 4 项，均为裸 baseline 无 catalog 的夹具；第二段复核为 6 failed / 26 passed。本组未改这两个夹具。
- **环境失败（lead 跑 bwrap）**：`RL-12-15-conditions`、`A2-automation-verdict`、`S8A-L8-pass-capture` 仅因 `ENOENT /usr/bin/bwrap` 失败，本段未追。

## 5. 疑似任务书/条目问题

1. **TQ-001 的 `plan:p1` 与 A1 冲突**（证据见 §2）：条目要求的固定 plan 身份无法由真实初始计划入口产生，建议 lead 明确优先级。
2. **TQ-091 书检漏列外部夹具**：book check §3 称旧夹具使用全在白名单，但 `S5-decision-fixture.ts`、`task-claim-fixture.ts` 及其 R4b/S2B 调用方仍 seed 裸 baseline。生产收窄必须连同这些夹具处理，建议补入 TQ-091 范围。
3. **TQ-092 的 RL 用例在本机不可执行**（缺 bwrap），只能静态核对 9_900 改动；基线同样全红。

## 6. 第二段

### 6.1 命令与结果

| 命令 | 结果 |
|---|---|
| `git status --short` / `git diff --stat` | 59 项：56 M + 3 D（两处已暂存、一处未暂存）；未暂存 `57 files changed, 600 insertions(+), 1156 deletions(-)`，与第一段 HANDOFF 一致 |
| `npm run typecheck` | **绿**（tsconfig.json + tsconfig.ui.json 均无输出；按 lead 裁定用普通命令，未加 flock） |
| `npm run check:architecture` | **绿**（`next source boundaries: OK`） |
| `git add -A -- src tests scripts resources runtime-assets.json` + `git -c user.name=dsh -c user.email=dsh@localhost commit -qm "T TQ"` | `5057649 T TQ` |
| `python3 -I ./.dsh-ref/d1-ledger.py . t-base HEAD > ./.dsh-ref/ledger-TQ.txt` | 退出 0；91 行待说明 + 1 个删除文件 |
| `npx vitest run --maxWorkers=2`（12 个改动测试文件） | **12 files / 189 tests 全绿** |
| `npx vitest run --maxWorkers=2`（其余 7 个改动测试文件） | **7 files / 83 tests 全绿** |
| `npx vitest run --maxWorkers=2`（已知失败复核 R4b + S2B-34） | 2 files：**6 failed / 26 passed**（与 lead 裁定一致，见 §4） |
| `git diff --shortstat t-base HEAD` | `59 files changed, 600 insertions(+), 1339 deletions(-)` |

第一段的 5 个测试批次结果仍然有效，本段未重跑全部；只复核了所有改动测试文件和已知失败。环境失败（RL-12-15、A2-automation-verdict、S8A-L8-pass-capture，缺 bwrap）未追。

### 6.2 Ledger 映射

ledger 分类合计：71 条 REMOVED assertion、19 条 REMOVED test/describe、1 条 ADDED expected value from a constant、1 个删除测试文件；**LOOSENED 0 条**。逐文件映射如下（括号内为旧文件行号）：

| 文件 | REMOVED/LOOSENED 行 | 条目 |
|---|---|---|
| tests/app/MVP-ui-entry.test.ts | 5（断言 4：269、270、272、273；test 1：239） | TQ-090、TQ-093 |
| tests/app/S0-attention-edge-label.test.ts | 2（断言 71；describe 67）；另有 ADDED 常量 216 | TQ-001 |
| tests/app/S3-attention-context.test.ts | 1（断言 473） | TQ-001 |
| tests/data/R3b-body-boundaries.test.ts | 13（断言 10：50、54、58、63、64、72、76、87、88、93；test 3：44、67、79） | TQ-094（44、50、54、58、63、64）、TQ-095（67、72、76）、TQ-096（79、87、88、93） |
| tests/data/R3b-materials-contract.test.ts | 10（断言 7：77、81、84、90、97、104、154；test 3：63、88、151） | TQ-097（63、77、81、84）、TQ-099（88、90、97、104）、TQ-098（151、154） |
| tests/data/workspace-path-boundary.test.ts | 20（断言 17：69、70、77、80、81、83、85、86、88、89、90、92、99、101、102、103、104；test 3：65、73、95） | TQ-089（同批 TQ-065～TQ-069） |
| tests/kernel/RL-12-15-conditions.test.ts | 2（断言 360、403） | TQ-092 |
| tests/record-store/SP-text-scan.test.ts | 3（断言 427、428；test 400） | TQ-107（同批 TQ-072、TQ-100） |
| tests/state/command-normalization.test.ts | 9（断言 7：62、116、222、270、331、401、436；test 2：268、435） | TQ-086（62、116、222、331、401、436、435）、TQ-108（268、270） |
| tests/work-graph/A1-architecture-catalog.test.ts | 6（断言 5：173、175、176、186、187；test 1：169） | TQ-109（169、173、175、176）、TQ-110（186、187） |
| tests/work-graph/A1-independent-review.test.ts | 2（断言 85、94） | TQ-111 |
| tests/work-graph/A1-session-lifecycle.test.ts | 3（断言 118、119；test 112） | TQ-110 |
| tests/work-graph/K3-39-tool-commit-lookup.test.ts | 2（断言 72；test 71） | TQ-081 |
| tests/work-graph/S1-session-facts.test.ts | 6（断言 5：183、184、186、187、188；test 172） | TQ-113（同批 TQ-088） |
| tests/work-graph/S3-context-inputs.test.ts | 6（断言 5：877、878、881、882、883；test 874） | TQ-070 |
| tests/helpers/SP-storage-migration-fixture.ts | 删除文件 1 | TQ-100（同批 TQ-072、TQ-107） |

**未映射行：0。** 另 1 条 `ADDED expected value from a constant`（S0 `REVISION` 手算字面量）属 TQ-001 书面核对改正要求的“完整 revision 的手算字面量”，非未计划新增。没有 `skip`/`todo`/`only`，也没有新增单后端清单。

## HANDOFF

### done
- 115 项中：100 项 done；TQ-001、TQ-091、TQ-111 为 partial；TQ-103/104/112/114/115 为 BLOCKED。
- 全部白名单内生产/测试改动已完成；allowlist 从 182 条降到 169 条，reason 只剩 wire-format/kept-for；production-reach 绿。
- typecheck 绿、check:architecture 绿；批 1/2 全绿；S5 夹具修复后 K3-26/S5-decision-queue 全绿。

### half done
- **TQ-091 外部夹具闭合**：
  - `tests/work-graph/R4b-session-directory.test.ts`（约 33-49 行 governance/seed）：需加 `ArchitectureCatalog` 记录（可用 `encodeArchitectureCatalog`，空 modules；schemas 已含 `ARCHITECTURE_CATALOG_SCHEMAS.records`），使 module 目标仍得 `not_found`。
  - `tests/helpers/task-claim-fixture.ts`（约 198-217 行 governance）：同上补 catalog 行（建议空 modules，避免影响模块映射）；S2B-34 经 B2 夹具继承后可恢复 `ready`。改后跑 `tests/work-graph/R4b-session-directory.test.ts` 与 `tests/work-graph/S2B-34-executed-files.test.ts`。
  - 已修的 `tests/helpers/S5-decision-fixture.ts`（补 catalog，module M）是范例。
- **TQ-001**：S0 的 Plan 前置需 lead 裁定；测试当前可跑（3 files/19 tests 绿）。
- **TQ-111**：22-62 子项未动（BLOCKED）。

### not started
- `git add -A -- src tests scripts resources runtime-assets.json && git -c user.name=dsh -c user.email=dsh@localhost commit -qm "T TQ"`。
- `python3 -I ./.dsh-ref/d1-ledger.py . t-base HEAD > ./.dsh-ref/ledger-TQ.txt`（未提交，所以未生成；`.dsh-ref/ledger-TQ.txt` 尚不存在）。
- 全量/合入前测试（lead 负责）。

### next session must know
- 工作区未提交；`git status` 57 项，全部在 TQ 白名单内，唯一例外是 `tests/helpers/S5-decision-fixture.ts`（已报告）。
- `tests/helpers/graph-session-fixture.ts` 现已：public bootstrap 建 scope；无 `seedLegacyArchitectureBaseline`/`seedTamperedArchitectureBaseline`；`seedAcceptedTask`/`overwriteSession` 保留（TQ-103/104 仍 BLOCKED）。
- 关键新符号：fixture 里 `createProjectBootstrapServices`、`PROJECT_BOOTSTRAP_RECORD_SCHEMAS`；S0 里 `BASELINE_DIGEST`/`REVISION` 手算字面量；S5 夹具里 `encodeArchitectureCatalog` + `ArchitectureCatalogRecord`。
- 陷阱：catalog 记录 schemaId 是 `ArchitectureCatalog@1`，不能套用通用 `${aggregateType}Snapshot@1`；catalog 行必须与 baseline 同提交且 `since:null`（初始采用）。
- typecheck 锁文件在沙箱外不可写；如获权限改回任务书命令。

### 第二段结束状态（2026-10-19 19:50）

- 已提交 `5057649 T TQ`，工作区干净；ledger 已生成（见 §6）。上文 HANDOFF 的“未 commit / 未跑 ledger / not started”各条是第一段暂停时的状态，第二段已补做，仅两处外部夹具按 lead 裁定留给 TP 组。
