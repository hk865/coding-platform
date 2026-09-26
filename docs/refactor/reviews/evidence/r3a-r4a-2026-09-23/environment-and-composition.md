# 本轮 dsh 环境失败与 Goal 装配独立核对

审阅时间：2026-09-23。只读源码与既存记录；只运行三个窄测试命令，不 build、不改生产/既有测试、不读取实际模型配置或凭据。

## 结论

1. 报告的“14 失败”与“11 + 2 + 2”不能相互验证。若三类互斥，总数是 15；目前没有原始本轮日志或逐项名称，既不能擅自去重成 14，也不能宣称全部已归因为环境。
2. **两个外部目录场景确为既存前置材料缺失**。本机重新运行，均在 Host/Goal 链启动之前读取 `/mnt/d/1.project/Software/to_do_list_show/src/utils/grouping.mjs` 报 ENOENT，耗时 3–4ms。HEAD 中已硬编码该目录；`AGENT-REFACTOR-LOG.md` 的 2026-09-19 条目已有同样记录。当前新增 `resolveUserFlowWorkdir` 支持 `PLATFORM_USER_FLOW_WORKDIR`，但默认仍为旧路径。本轮未配置该变量；未设置任何真实模型 opt-in。
3. **HOME/.config 默认写入行为既存，但 11 项失败未证实**。`src/app/model-settings.ts` 相对 HEAD diff 为零；14 行从 `homedir()` 派生配置目录，36–40 行先 mkdir 后检查 0700/owner，`src/app/server.ts:12` 在创建 Host 前调用。`tests/app/gui.test.ts` 与 `tests/app/workspace-tools.test.ts` 的部分夹具未显式传 `modelSettings.directory`，因此测试环境禁止写 HOME 时会在初始化前失败。没有本轮错误栈，不能确定是 EACCES、目录权限、其他异常或数量确为 11。修测试时可使用已有的显式临时目录注入，不需要放宽生产目录保护。此次没有访问实际配置来验证。
4. **locale 分类未证实**。定点检查最明显的旧排序不一致：`tests/contract-suite/workspace.contract.suite.ts:204` 左侧 `.sort()`，右侧 `localeCompare`，HEAD 中相同。但对应 P1-07 A1/A2 的 SQLite/InMemory 两项当前均通过，不能把它们当作已复现的两个 locale 失败。报告未给失败名称，不能继续推断其具体来源。
5. **没有发现 Goal 的生产组合根漏接，真实 HTTP Host 窄验收通过**。`tests/app/multi-workspace.test.ts` 在显式临时 settings 目录、本地 ModelClient 下完整通过：HTTP 创建两个 workspace 的 Goal、实际运行、跨 workspace 授权与重启持久化。这个结果只支持装配有效，不替代根 Agent 正在进行的 R3a 领域守卫/事务验收。

## 真实生产路径与 fixture 范围

- `src/app/server.ts:22` → `createGuiService`，后者 `src/app/service.ts:255–258` 在真实 Runtime 下走 `createProductPlatform`；`src/composition/persistent-platform.ts:900` 复用真实 `createPersistentPlatform`。
- `src/app/service.ts:593` 创建 Goal → `HumanCollaborationImpl.createGoal` (`src/interaction/human-collaboration/human-collaboration.ts:48–72`) → `ControlEngineImpl.submit` (`src/control/control-engine/control-engine.ts:228–229`) → 注入的 `goals.legacyCommands`。
- `src/composition/persistent-platform.ts:546–560` 显式创建一个 `createSqliteRecordBackend`，把同一 backend 注入旧 `SqliteStateLedger`，并把其 `records` 注入 `createGoalService`。`src/harness/in-memory-harness.ts:414–426` 同样共享单个 Map backend。
- 源码全仓 `goalCommands` 装配仅上述两个；没有 `unexercisedGoalCommands` 生产引用。`tests/contract-support/testing/goal-command.double.ts` 是会抛错的测试端口，不会伪造 Goal 成功；真实创建 Goal 的夹具使用 `goal-chain.ts`。
- 当前 tracked 测试/辅助文件中，43 个已修改文件包含 `unexercisedGoalCommands`/真实 Goal chain/`goals.legacyCommands`，不是可机械验证的“恰好 40 个”。此数是当前工作树文本口径，不能等同于 dsh 本轮修改数（工作树含之前批次变化）。能确认迁移范围是必要依赖注入，并非只给 40 个测试补空 stub、生产未接。
- `SqliteStateLedger` 注入 backend 时直接绑定 `legacyAccess.connection` (`src/data/state-ledger/sqlite-ledger.ts:225–227`)，close 委托同一 backend (`330–333`)；Goal legacy commit 在旧 `BEGIN IMMEDIATE` 前分派 (`269–286`)。在这条组合根中未见隐式网络；模型网络只在执行面使用所注入 client。正常 Host 窄验收含关闭与重开且完成，不支持把本轮 scoped 超时直接归因于 close 挂死。
- 根 Agent 已另外复验高并发 scoped 超时文件，低并发 45 项通过；这是另一批独立结果，不应拿来替代 dsh 原 14 项明细。

## 可复现命令与结果

cwd：`/home/hyh001/projects/coding-platform/coding-platform`。下列 node 均为 `/home/hyh001/projects/coding-platform/.toolchain/node-v24.21.0-linux-x64/bin/node`。

```sh
node node_modules/vitest/vitest.mjs run tests/integration/coding-goal-scenario.test.ts tests/integration/coding-collaboration-scenario.test.ts --maxWorkers=1 -t 'same isolated real todo module|one isolated todo Goal'
```

结果：2 failed / 1 skipped，两个相同 grouping.mjs ENOENT。日志 `/tmp/dsh-external-path-repro.log`。这两项在创建任何模型配置/Host/实际 Goal 之前失败；不能用于评价新 Goal 逻辑是否正确。

```sh
node node_modules/vitest/vitest.mjs run tests/integration/p1-07.contract-suite.inmemory.test.ts tests/integration/p1-07.contract-suite.sqlite.test.ts --maxWorkers=1 -t 'A1/A2 two readers overlap'
```

结果：2 passed / 22 skipped。日志 `/tmp/dsh-locale-repro.log`。它只否定该具体疑似定位，不证明所有 locale 故障不存在。

```sh
node node_modules/vitest/vitest.mjs run tests/app/multi-workspace.test.ts --maxWorkers=1
```

结果：1 passed，实际测试 2.38s，总 4.64s。日志 `/tmp/dsh-real-host-goal-repro.log`。显式临时 settings 路径与本地模型，不访问真实凭据、不外网。

## 建议给 dsh 的报告更正要求

给出原测试命令、Node/locale、每个失败的 suite + test 名、错误栈、是否测试初始化失败，以及按唯一测试项去重后的统计；标明哪些已有 baseline 复现。应写“两个外部材料缺失已确认；HOME 与 locale 的原数量/个案仍未独立验证”，不能写“14 项全部无关”。Goal 装配可确认已进入真实生产链；是否满足领域约束及事务性能，继续以独立 R3a 验收为准。
