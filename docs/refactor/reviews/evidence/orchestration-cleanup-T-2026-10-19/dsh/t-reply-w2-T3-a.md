# T 轮第二波 T3 组回复（lead / coordinator，2026-10-20）

- 基线：`w2-base` = `d4c4cea`；提交：`54380f7 T T3 wave 2`。
- 条目：99 条。**97 done，2 partial（T2-025 有 1 个子例 BLOCKED；T3-064 有一处书核对字面不可达），0 条整项 BLOCKED。**
- 文件：84 个（含 4 个新 helper、6 个删除文件）；`84 files changed, 1680 insertions(+), 3232 deletions(-)`。

## 1. 逐条结果

结果列：`done` / `partial` / `BLOCKED`；`done（046）` 表示 T3-045 按书核对由 T3-046 统一处理。

| 编号 | 结果 | 改了哪些文件 | 覆盖（删除/合并时） | 备注 |
|---|---|---|---|---|
| T2-001 | done | `tests/contracts/review-admission.test.ts` | contracts:80-82（同输入同断言，合并即删 169-171） | 重复例删除 |
| T2-002 | done | `tests/contracts/review-admission.test.ts`；删除 `tests/runtime/K3-19-review-admission-pure.test.ts` | contracts:80-177 + 迁入 3 个独有输入 | 与 T2-022 同做 |
| T2-005 | done | `tests/kernel/R4a-frozen-public.test.ts`、`tests/kernel/README.md` | 行为已不存在（HANDOFF 79-1）；现格式保留 :245、:575 | README 追加 T 轮后注，保留原历史原义 |
| T2-006 | done | `tests/kernel/R4a-frozen-public.test.ts` | :192-212 | 预算重复例删除 |
| T2-007 | done | `tests/kernel/R4a-frozen-public.test.ts` | :152（三 Turn 选中间）、:213（补 :414/:419 断言）、:192 | contract describe 整体删除 |
| T2-008 | done | `tests/kernel/R4a-frozen-public.test.ts` | :575-585（正常恢复保留）；AGENTS 第 4 条 | 篡改例删除 |
| T2-009 | done | `tests/kernel/R4a-legacy-fixtures.ts` | HANDOFF 79-1；`TempWorkspace` 留原文件 | 旧 writer 删除，无新 helper |
| T2-022 | done | 同 T2-002 | contracts:80-177 + 迁入 3 个独有输入 | runtime 纯测试文件删除 |
| T2-024 | done | `tests/runtime/R4b-session-input-boundaries.test.ts` | 转换；原用例保留 | `createProjectBootstrapServices` + `PROJECT_BOOTSTRAP_RECORD_SCHEMAS` |
| T2-025 | partial | `tests/helpers/R4-history-turn-support.ts`（新）、`tests/runtime/R4b-session-input-boundaries.test.ts`、`tests/runtime/R4b-session-recovery.test.ts`、`tests/runtime/R4c-execution-history.test.ts` | 转换；公开读历史取游标，拒绝例按 A6 | 8 行中 7 行走真实 claim/Runtime；observer-down 行 BLOCKED（见 §2） |
| T2-028 | done | `tests/runtime/R4b-session-recovery.test.ts` | R4c:330-332 真实文件缺失 | 改库例删除 |
| T2-029 | done | `tests/runtime/R4b-session-recovery.test.ts` | 转换；原 72-202 用例保留 | 公开 bootstrap，去掉假事件 |
| T2-030 | done | `tests/runtime/R4b-session-recovery.test.ts` | 转换；首张 limit:2 页与旧游标保留 | 同一 Session 真跑两次，删数字 6 |
| T2-031 | done | `tests/runtime/R4c-execution-history.test.ts` | 相邻 forbidden/not_found/not_ready 透传保留 | 篡改段删除 |
| T2-032 | done | `tests/runtime/R4c-execution-history.test.ts` | 转换；原执行历史用例保留 | 改用 `createTaskClaimFixture` 的公开 bootstrap |
| T2-033 | done | `tests/runtime/R4c-kernel-history-range.test.ts` | :385-418 bounded read；:247-288 lastPosition；隔离 :600-608 | 6 条改库防御 + 2 条页外损坏 + 隔离损坏段删除 |
| T3-001 | done | `tests/app/A2-host-instance-lease.test.ts` | 转换；独占/接管断言保留 | 两处手写锁改 `acquireHostInstanceLease` |
| T3-002 | done | `tests/app/A2-runtime-capabilities.test.ts` | 转换；off/on、held_by_other、句子关系保留 | Host 启动→`automation/save`→关闭→重开 |
| T3-003 | done | `tests/app/A2-runtime-capabilities.test.ts`、`tests/app/K-R-runtime-capabilities.test.ts`、`tests/helpers/runtime-capabilities-fixture.ts`（新） | 合并同一构造器 | 保留两调用方 scope/adapter/名称/时钟/清理 |
| T3-004 | done | `tests/app/A2-settings-automation.test.ts` | :125-149 | 0/false 启动读取与重开参数化保留 |
| T3-006 | done | `tests/app/R6-workbench.test.ts`、`tests/app/session-rendering.test.ts` | session-rendering:395-437 + 迁入 4 条独有断言 | 只删 R6 历史子块 |
| T3-007 | done | `tests/app/RL-34-wiring-resource-caps.test.ts` | :177-199（首读已覆盖） | 单调用例删除 |
| T3-008 | done | `tests/app/RL-34-wiring-resource-caps.test.ts`、`tests/app/RL-44-host-restart-resource-caps.test.ts` | RL-44:132-149 | 目标名同时含 RL-44、RL-34 与“工作台命令页” |
| T3-010 | done | `tests/app/S2B-35-activity-routes.test.ts` | 转换；held_by_other/busy 保留 | 手写锁改真实租约 |
| T3-011 | done | `tests/app/S2B-41-decision54-backfill-bound.test.ts` | 转换；aFinal 与 B 断言保留 | 真实 requeue 授权 + Runtime `closeOpenTurn` |
| T3-012 | done | `tests/app/S2B-41-decision54-backfill-bound.test.ts`、`tests/helpers/S2B-be2-reconcile-support.ts` | 共享 `withTool`/`controlsOn` | 删本地重复函数 |
| T3-013 | done | `tests/app/S2B-backfill-host.test.ts` | 转换；no-recording/no-backfill 保留 | 手写锁改真实租约 |
| T3-014 | done | `tests/app/S4C2-scribe-reminders.test.ts` | :471-509（D-03） | 单测例删除 |
| T3-016 | done | `tests/app/S8A-L8-auto-capture-gate.test.ts` | `S8A-L8-host-close-restart.test.ts:103-139` | 整个 close/restart describe 与无用选项删除 |
| T3-017 | done | `tests/app/S8A-L8-http-watermark.test.ts` | `S8A-L8-auto-capture-host.test.ts:167-186` | 正例删除，拒绝行保留 |
| T3-018 | done | `tests/app/S8A-L8-capture-start.test.ts`、`tests/work-graph/S8A-L8-observation-state.test.ts` | observation-state:671-715 | L8-7/L8-8 加无旧观测变体，再删来源 |
| T3-019 | done | 同上 | observation-state:717-796 | L8-9/10/11 加无旧观测变体与计数，再删来源 |
| T3-020 | done | `tests/app/S8A-L8-capture-start.test.ts` | 无消费者 | 删 `PlatformAdapters`/adapters/bodies |
| T3-021 | done | `tests/app/host-settings.test.ts` | 转换；冷启动断言保留 | 真 Host + `queries/start` + `workspaces/open` + `checks/approve` |
| T3-023 | done | `tests/app/orchestration-mechanism.test.ts` | `tests/app/S3-attention-context.test.ts:238-248` | 无变化例删除 |
| T3-024 | done | `tests/app/support/S8A-L8-host.ts` | 无外部消费者 | 只去 4 处 export |
| T3-025 | done | `tests/app/ui-live.test.ts`、`tests/app/ui-refresh.test.ts` | ui-live:331-389 | 先在 reset 前取计数并断言两路各 +1，再删来源 |
| T3-026 | done | `tests/app/ui-store.test.ts` | `tests/app/ui-actions.test.ts:71-75` | 删用例与无用 `state` 导入 |
| T3-027 | done | `tests/business/A2-workflow-auto-rework.test.ts`、`tests/scenarios/C8-human-stop-respected.test.ts` | C8:420-470 + 精确 request 字段 | 源用例删除 |
| T3-029 | done | `tests/business/K3-41-release-hold.test.ts` | :438-460；K3-29-extras:86-99 | 目标参数化为真实崩溃 + Goal 暂停后恢复 |
| T3-035 | done | `tests/composition/A1-graph-session-platform.test.ts` | 转换；Session 发现/归档/重开/历史保留 | 公开 createProject/registerWorkspace |
| T3-036 | done | `tests/composition/K-R-previous-turn-bounds.test.ts` | :93-98（四断言搬入 absent 例） | 保留 absent-seam 例 |
| T3-037 | done | `tests/composition/R3c-R4b-platform.test.ts` | 转换；原 Goal/Plan/Session 重开保留 | 公开治理链；digest 用独立字面量 |
| T3-038 | done | `tests/composition/R3d-R3g-platform.test.ts` | 转换；role pins/两版本/replay 保留 | 公开 createProject/registerWorkspace |
| T3-039 | done | `tests/composition/S8A-L8-adoption-capture.test.ts` | 转换；空模块层/文件层断言保留 | 改用公开 `current.persistedRef`，删 systemCtx |
| T3-040 | done | `tests/composition/S8A-L8-pass-capture.test.ts` | row 3:405-443 | row 2 并入，双后端保留 |
| T3-041 | done | `tests/composition/W1-future-plan-platform.test.ts` | 转换；scenario 6/W1 覆盖保留 | 公开治理链，与 042 同批清理 raw |
| T3-042 | done | `tests/composition/W1-future-plan-platform.test.ts` | 转换；later Plan/Goal/Run/重开断言保留 | 公开 propose/apply/createSession/claim |
| T3-043 | done | `tests/composition/W2-future-intent-platform.test.ts` | 转换；plan_only 采用/SQLite 重开保留 | 公开治理链 |
| T3-045 | done（046） | 不改 `tests/data/S8D-compact-snapshot.test.ts` | compact-snapshot:76-82 保留 | 书核对指定由 T3-046 统一处理 |
| T3-046 | done | `tests/data/S8D-observed-v2-codecs.test.ts` | compact-snapshot:44-67、70-96 | 删 codecs 的 compact 块 |
| T3-047 | done | `tests/data/S8D-cpp-import-graph-script.test.ts`、`tests/data/S8D-A22-cpp-imports.test.ts` | A22:174-190 | (h) 合并 |
| T3-048 | done | 同上 | A22:156-172 | (g) 合并 |
| T3-049 | done | 同上 | A22:247-265 | (j) 合并 |
| T3-050 | done | 同上 | A22:389-398 | 目标补 files 1/parsed 1 后删源 |
| T3-051 | done | 同上 + `tests/data/S8D-A23-cpp-config.test.ts` | A22 各字母行、A23:285-299 | 按书面核对保留 13 段脚本协议；其余合并 |
| T3-052 | done | cpp-script + A23 | A23:216-234 | -Xclang |
| T3-053 | done | cpp-script + A23 | A23:236-251 | -load |
| T3-054 | done | cpp-script + A23 | A23:253-267 | -march |
| T3-055 | done | cpp-script + A23 | A23:269-283 | 强制包含 |
| T3-056 | done | cpp-script + A23 | A23:301-316 | ccache |
| T3-057 | done | cpp-script + A23 | A23:318-331 | 命令拆分（与 058 同一 it 一次删） |
| T3-058 | done | cpp-script + A23 | A23:333-347 | 未闭合引号 |
| T3-059 | done | cpp-script + A23 | A23:349-364 | 多余位置参数 |
| T3-060 | done | cpp-script + A23 + language-providers | A23:81-381、language-providers:225-242 | 按书面核对保留 377-389、391-403、472-478、521-529 |
| T3-061 | done | 删除 `tests/data/S8D-formal-unresolved-reason.test.ts` | A22:59、114；A20:148-149；A06/AE1 | 整文件只剩该例 |
| T3-062 | done | `tests/helpers/workspace-tools-fixture.ts`（新）、language-providers、S8A-file-graph、S8E-A25 | 合并三份 tools 层夹具 | 保留 denied/fileGraph/limits/sourceAnalyzers |
| T3-063 | done | `tests/data/S8E-A07-git-inventory.test.ts`、`tests/data/S8D-observation-inventory.test.ts` | A07 补已删跟踪文件/跟踪符号链接/排除断言 | 目标增强后才删来源 |
| T3-064 | partial | `tests/data/S8E-A08-skip-list.test.ts`、`tests/data/S8D-observation-inventory.test.ts` | A08 补 .git/config、a/keep.ts、build/compile_commands.json | 书核对“language issues 合并为空”不可达（见 §2） |
| T3-065 | done | `tests/data/S8E-A23-ignored-databases.test.ts`、inventory | A23:45-64 + 跳过目录中的数据库输入 | notes 仍断言“合并了 2 个编译数据库” |
| T3-066 | done | `tests/data/S8D-observed-v2-codecs.test.ts` | S8E-old-format-rejection:58-61 | 只删指定 it |
| T3-067 | done | 删除 `tests/data/S8D-platform-fixture.test.ts` | S8E-A15:38-52；S8D-A20:142-146 | 夹具冒烟例删除 |
| T3-068 | done | python-script + `tests/data/S8D-A20-python-imports.test.ts` | A20:146-147 | 只并自边例，95-128 协议保留 |
| T3-069 | done | python-script + A21 | A21:191-205 | JSONC |
| T3-070 | done | python-script + A21 | A21:64-79 | pyproject pythonVersion |
| T3-071 | done | python-script + A21 | A21:191-205、64-79、110-126、157-170、172-189 | 并五例，保留 157-164 |
| T3-072 | done | python-script + A21 | A21:110-126 | 补 reason:null |
| T3-073 | done | python-script + A21 | A21:157-170 | extends |
| T3-074 | done | python-script + A21 | A21:172-189 | 根顺序 |
| T3-075 | done | python-script + `tests/data/S8D-exploration-regressions.test.ts` | exploration:89-122 | 缺 Jedi 消息已由公开测试覆盖 |
| T3-076 | done | `tests/helpers/observation-source-fixture.ts`（新）、S8E-A26、inventory | 合并读取层夹具 | 保留 scope/actor/revision/allowsRead/释放 |
| T3-081 | done | 删除 `tests/helpers/K3-35-required-review-block.ts`；两个 runtime 测试 | pure fixture:149 | 两 importer 改直接导入 |
| T3-082 | done | `tests/helpers/K3-continuation-pure-fixture.ts`、`tests/helpers/K3-35-continuation-fixture.ts`（编译用） | 无消费者 | 删 G/REQUIRED_REVIEW_BLOCK/NOT_LISTED/aliases，task 去 export |
| T3-083 | done | `tests/helpers/K3-padded-review-record.ts` | 同文件内部使用 | 12 处去 export |
| T3-085 | done | `tests/helpers/RL-query-fixture.ts` | 同文件内部使用 | 14 处去 export |
| T3-086 | done | `tests/helpers/RL-resource-caps-support.ts` | 无消费者 | 删四个死符号，保留 systemctlUserShow |
| T3-087 | done | `tests/helpers/S2B-be2-reconcile-support.ts` | 同文件内部使用 | 4 处去 export |
| T3-088 | done | `tests/helpers/S2B-r2-calendar-reverify-support.ts` | 无消费者 | 删类型/注释/CoreCallContext 导入 |
| T3-089 | done | 删除 `tests/helpers/S2B-r3-r4-support.ts`、`tests/work-graph/S2B-r4-session-workspace.test.ts` | 仅篡改可触发；AGENTS 第 4 条 | 生产守卫保留 |
| T3-091 | done | `tests/helpers/S2C-K2-scenario-support.ts` | 无消费者 | 删 sessionRefOfCard 与 SessionRef 导入 |
| T3-092 | done | `tests/helpers/S4C2-note-card-fixture.ts` | 无消费者 | 删 S4C2_FILE_A/B |
| T3-093 | done | `tests/helpers/S8A-L8-reminder-world.ts` | 同文件内部使用 | 13 处去 export |
| T3-094 | done | `tests/helpers/S8D-platform-fixture.ts` | 同文件内部使用 | 4 处去 export |
| T3-097 | done | `tests/helpers/WP1-entry-fixture.ts` | 无外部消费者 | 删死常量 t1，5 类型去 export |
| T3-098 | done | `tests/helpers/WP1-handover-fixture.ts` | 5 别名无引用 | 删 5 别名，3 处去 export |
| T3-099 | done | `tests/helpers/WP1-scenario-fixture.ts` | 同文件内部使用 | 7 类型去 export |
| T3-100 | done | `tests/helpers/WP1-units-fixture.ts` | 同文件内部使用 | 4 类型去 export |
| T3-101 | done | `tests/helpers/WP2-duties-fixture.ts` | 保留 WP2_DUTIES/wp2LegacyDuty/wp2RoleContent | 删 openWP2DutiesFixture 等 164 行 |
| T3-104 | done | `tests/helpers/orchestration-fixture.ts` | 无消费者 | 删 isYielded 与 RunState 导入 |

## 2. partial / BLOCKED 证据

### T2-025（partial；1 个子例 BLOCKED）

- 已完成：新建 `tests/helpers/R4-history-turn-support.ts`，封装真实 `createTaskClaimFixture` Session + 真实 claim + 共享 `createS2BRuntimeSteps` 的 start/finish；Kernel 身份从 `readExecution(...).run.executionHistory.kernel` 取得，不接收测试自造身份。R4c 的 8 行中 7 行、R4b 两份文件全部改走该 helper；R4b-input 的历史游标用例和 R4b-recovery 的两次真实 Run 用例均通过（3 文件 / 14 测试）。
- BLOCKED 子例：`tests/runtime/R4c-execution-history.test.ts:408` 的 “still reads persisted Kernel evidence when the best-effort observer is down”。原因：**missing entry point**。`src/core/agent-runtime/execution-driver.ts:1253`（以及 `query-execution.ts:542`）把 `publish` 固定为 `async () => {}`，公开 Runtime 步骤无法暴露一个会失败的 best-effort observer sink。该行保留原 `runObservedModel` 直调与测试声明身份（不删测试、不改写成新名字），并在文件注释中写明 BLOCKED。其余 7 行经 helper 走真实 claim/Runtime。
- 影响：T2-009 删除旧 writer 不受该行影响（该行不使用 `buildRawTurn`/`rawInsertRecords`），已完成。

### T3-064（partial；书核对字面不可达）

- 已完成：`tests/data/S8E-A08-skip-list.test.ts` entries 加入 `.git/config`、`a/keep.ts`、`build/compile_commands.json`，精确断言三个保留文件路径；`tests/data/S8D-observation-inventory.test.ts:151-167` 已删。
- 不可达字面：书核对要求“所有 language issues 合并后为空”。这在 A08 目标不可成立：保留节点 `dist/z.ts` 会被 TS 扫描合法地报为 skipped（`src/core/workspace/typescript-source-query.ts:112` 排除 `dist/`、`build/`、`node_modules/`；issue 在 `src/core/workspace/typescript-light-scan.ts:417-421`）。若坚持该字面，必须丢掉 `dist`，与测试名和行为冲突。
- 现断言：`.git/config`、`a/keep.ts`、`build/compile_commands.json` 三个保留路径不出现在任何 language issue 中；`page.nodes` 仍精确等于三个保留文件。语义等价于书核对想钉住的“跳过项不变成 language issue”。

## 3. 白名单外文件 / FORMAT

- `tests/helpers/K3-35-continuation-fixture.ts`：只删 `G`、`task` 两处转出口（T3-082 明确要求与 F-23 同批；否则转出口指向已删导出，编译失败）。无其它改动。
- 本 session 的两处编译胶水（均在白名单内，非行为改动）：
  - `tests/data/S8D-language-providers.test.ts`：补 `ProjectSourceAccess` 类型导入（T3-062 抽取后遗留）。
  - `tests/app/session-rendering.test.ts`：给新增 artifact 字面量补 `as const`（T3-006 迁移的 4 条断言，类型收窄）。
- **FORMAT 适配：无。**

## 4. 检查

### 4.1 类型与架构

- `flock ./.typecheck.lock npm run typecheck`：**绿**（两次胶水修复后）。
- `npm run check:architecture`：**绿**（`next source boundaries: OK`，D3 hits 0）。

### 4.2 测试

命令：`timeout 900 npx vitest run --maxWorkers=2 <files>`，14 批，每批 ≤10 文件。范围 = `git diff w2-base` 中仍存在的全部 54 个改动测试文件 + 所有改动 helper 的 importer，共 138 个文件。

- 汇总：**1116 passed，50 failed**（14 个批次；具体每批见下）。
- 通过批次：1(65)、2(44)、3(122/123)、4(95/99)、5(85)、6(160)、7(33)、8(37/76)、9(42)、10(72/74)、11(36/40)、12(127)、13(57)、14(141)。
- **47 个环境失败（本机无 bwrap/systemd user session）**，规则 11，不作为代码失败：
  - `tests/kernel/RL-01-02-caps-effect.test.ts`、`RL-03-05-oom-pids.test.ts`、`RL-06-11-stop.test.ts`、`RL-12-15-conditions.test.ts`、`RL-15c-gate-stream-error.test.ts`、`tests/scenarios/K3-07-real-host-kill.test.ts`：39 个，错误文本 `RL RE1 environment unavailable (no bubblewrap / systemd user session): ENOENT ... access '/usr/bin/bwrap'`。
  - `tests/app/orchestration-mechanism.test.ts`：1 个，`run_check` → `unsupported`，reason 为 `ENOENT ... '/usr/bin/bwrap'`。
  - `tests/composition/S8A-L8-pass-capture.test.ts`：4 个，`runRegisteredCheck` → `ENOENT ... '/usr/bin/bwrap'`。
  - `tests/scenarios/C8-human-stop-respected.test.ts`：2 个，`run_check` 被无 bwrap 拒绝，steps 停在 `run_check`（AV-4 的 steps[0] request 断言已先通过）。
- **3 个预先存在的失败**：`tests/scenarios/WP1-wiring.test.ts`（SC01×2、SC02），`AssertionError: expected 'waiting' to be 'completed'`。子任务在干净 `w2-base` worktree 复现同样 3 个失败；该测试文件未改，改动的 helper 只去了 export 关键字，未影响行为。
- 删除文件不运行；ledger 单独映射。

### 4.3 ledger 映射（`./.dsh-ref/ledger-T3.txt`，`w2-base..HEAD`）

- `MOVED: 37`；`REMOVED assertion: 233`；`REMOVED test or describe: 69`；`DELETED test files: 6`；`LOOSENED: 0`；skip/todo/only、raised timeout、单后端、ALL_CAPS 期望：0；D3 pure-file hits: 0。
- 需要 justify 的行：302 + 6 个删除文件。**全部映射如下，无未映射行。** 行数为该文件在 ledger 中 REMOVED 行数（assertion + test/describe），括号内为编号。

| 文件 | REMOVED 行 | 编号 |
|---|---:|---|
| `tests/app/A2-host-instance-lease.test.ts` | 1 | T3-001 |
| `tests/app/A2-settings-automation.test.ts` | 6 | T3-004 |
| `tests/app/R6-workbench.test.ts` | 12 | T3-006 |
| `tests/app/RL-34-wiring-resource-caps.test.ts` | 4 | T3-007、T3-008 |
| `tests/app/RL-44-host-restart-resource-caps.test.ts` | 1 | T3-008 |
| `tests/app/S2B-41-decision54-backfill-bound.test.ts` | 2 | T3-011、T3-012 |
| `tests/app/S4C2-scribe-reminders.test.ts` | 3 | T3-014 |
| `tests/app/S8A-L8-auto-capture-gate.test.ts` | 8 | T3-016 |
| `tests/app/S8A-L8-capture-start.test.ts` | 11 | T3-018、T3-019、T3-020 |
| `tests/app/S8A-L8-http-watermark.test.ts` | 6 | T3-017 |
| `tests/app/host-settings.test.ts` | 8 | T3-021 |
| `tests/app/orchestration-mechanism.test.ts` | 4 | T3-023 |
| `tests/app/ui-live.test.ts` | 1 | T3-025 |
| `tests/app/ui-refresh.test.ts` | 3 | T3-025 |
| `tests/app/ui-store.test.ts` | 3 | T3-026 |
| `tests/business/A2-workflow-auto-rework.test.ts` | 4 | T3-027 |
| `tests/business/K3-41-release-hold.test.ts` | 5 | T3-029 |
| `tests/composition/A1-graph-session-platform.test.ts` | 1 | T3-035 |
| `tests/composition/K-R-previous-turn-bounds.test.ts` | 2 | T3-036 |
| `tests/composition/R3c-R4b-platform.test.ts` | 1 | T3-037 |
| `tests/composition/R3d-R3g-platform.test.ts` | 1 | T3-038 |
| `tests/composition/S8A-L8-adoption-capture.test.ts` | 1 | T3-039 |
| `tests/composition/S8A-L8-pass-capture.test.ts` | 4 | T3-040 |
| `tests/composition/W1-future-plan-platform.test.ts` | 2 | T3-041、T3-042 |
| `tests/composition/W2-future-intent-platform.test.ts` | 1 | T3-043 |
| `tests/contracts/review-admission.test.ts` | 2 | T2-001、T2-002、T2-022 |
| `tests/data/S8A-file-graph.test.ts` | 1 | T3-062 |
| `tests/data/S8D-A21-python-config.test.ts` | 1 | T3-072 |
| `tests/data/S8D-cpp-import-graph-script.test.ts` | 40 | T3-047～T3-060（含 051/060 总括） |
| `tests/data/S8D-language-providers.test.ts` | 1 | T3-062 |
| `tests/data/S8D-observation-inventory.test.ts` | 27 | T3-063、T3-064、T3-065、T3-076 |
| `tests/data/S8D-observed-v2-codecs.test.ts` | 16 | T3-046、T3-066 |
| `tests/data/S8D-python-import-graph-script.test.ts` | 26 | T3-068～T3-075 |
| `tests/data/S8E-A08-skip-list.test.ts` | 1 | T3-064 |
| `tests/data/S8E-A25-strict-capture.test.ts` | 1 | T3-062 |
| `tests/kernel/R4a-frozen-public.test.ts` | 37 | T2-005、T2-006、T2-007、T2-008 |
| `tests/runtime/R4b-session-input-boundaries.test.ts` | 3 | T2-024、T2-025 |
| `tests/runtime/R4b-session-recovery.test.ts` | 6 | T2-028、T2-029、T2-030 |
| `tests/runtime/R4c-execution-history.test.ts` | 19 | T2-025、T2-031、T2-032 |
| `tests/runtime/R4c-kernel-history-range.test.ts` | 25 | T2-033 |
| `tests/scenarios/C8-human-stop-respected.test.ts` | 1 | T3-027 |

删除文件（6）：

| 文件 | ledger 统计 | 编号 |
|---|---|---|
| `tests/data/S8D-formal-unresolved-reason.test.ts` | 1 test / 1 expect | T3-061 |
| `tests/data/S8D-platform-fixture.test.ts` | 1 test / 8 expects | T3-067 |
| `tests/helpers/K3-35-required-review-block.ts` | 0 test | T3-081 |
| `tests/helpers/S2B-r3-r4-support.ts` | 0 test | T3-089 |
| `tests/runtime/K3-19-review-admission-pure.test.ts` | 13 tests / 13 expects | T2-022 |
| `tests/work-graph/S2B-r4-session-workspace.test.ts` | 2 tests / 2 expects | T3-089 |

### 4.4 shortstat

```
84 files changed, 1680 insertions(+), 3232 deletions(-)
```

## 5. 疑似任务书 / 书核对问题

1. **T3-064**：书核对要求“所有 language issues 合并后为空”在 A08 目标不可成立，原因是保留的 `dist/z.ts` 会被 TS 扫描合法报 skipped（`typescript-source-query.ts:112`、`typescript-light-scan.ts:417-421`）。现按语义改为“三个保留路径不出现在任何 language issue”，见 §2。
2. **T2-025**：`R4c-execution-history` 的 observer-down 行没有公开入口：Runtime 把 `publish` 固定为 no-op（`execution-driver.ts:1253`、`query-execution.ts:542`）。建议 lead 决定是补一个公开的 observer 注入点，还是接受该行作为 BLOCKED 的遗留直调。
3. **T3-060**：书核对的“缺 libclang → language-providers:225-242”在保留脚本 521-529 后不再需要合并；本次保留脚本协议例，未改 language-providers 的 PROV-04（符合“先保留协议断言”的优先级）。
4. **T3-045**：按书核对由 T3-046 统一处理，未单独改 compact-snapshot；ledger 中 compact-snapshot 没有 REMOVED 行，符合“保留 76-82”。

## 6. HANDOFF（给 18:00 后的新 Session）

- **状态：全部 99 条已处理完毕，无半完成单元。** 提交 `54380f7 T T3 wave 2`，工作树干净（只剩 `.dsh-ref/` 与本回复文件；`.typecheck.lock` 未提交）。
- 结果：97 done，2 partial：
  - T2-025：observer-down 子例 BLOCKED（`execution-driver.ts:1253` 无公开 publish 入口），其余 7 行已走真实 claim/Runtime。
  - T3-064：书核对“all language issues empty”不可达，已改为三个保留路径不进 language issue。
- 新 Session 需要做：
  1. 在**有 bwrap/systemd user session** 的环境重跑 47 个环境失败文件（§4.2 清单），确认通过；重点 `S8A-L8-pass-capture`、`C8-human-stop-respected`、`orchestration-mechanism`、RL 六件、`K3-07`。
  2. 确认 `WP1-wiring` 的 3 个 “waiting vs completed” 在 lead 机器上仍是基线已有失败（本机已在干净 w2-base 复现）。
  3. lead 裁定 T2-025 的 observer-down 与 T3-064 的字面差异；如裁定需补公开入口或改断言，再开小修。
  4. 合入前按 book §3 再跑 typecheck / check:architecture / 全量；本次 `flock ./.typecheck.lock npm run typecheck` 与 `npm run check:architecture` 均绿。
- 不要重复施工：所有 whitelist 文件已改完；helper 新增只有 `R4-history-turn-support.ts`、`observation-source-fixture.ts`、`runtime-capabilities-fixture.ts`、`workspace-tools-fixture.ts`。白名单外只有 `K3-35-continuation-fixture.ts` 一处编译用转出口删除。
