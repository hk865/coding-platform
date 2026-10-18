# C1：lead 的验收（2026-10-19）

**结论：** 合入（2026-10-19，代码 `35b5f5b1`）。五组施工；Codex 每组一次只读审查（5 次），G2、G4 返工后各一次快速核对；lead 修小处后合入。没有未关闭的“会出错”行：G1、G3、G5 是 0；G2、G4 各 1 条，都在返工或 lead 的修复里关掉，G2 的快速核对又找出返工带进来的一条，lead 也修了。测试和断言一条没改，production-reach 允许清单只删了三条声明已不存在的条目（裁定 13）。没有调用真实模型。

- **全量：** 修好后的合并树（`c1-all-fix2`，5 个并行，单独跑）771 个测试文件全过，10,082 项过、5 项跳过，2,881 秒，内存峰值 5.30 GB；构建、类型检查、模块边界检查都过（`checks/final-full-suite.txt`）。第一次合并树的全量（`checks/final-full-suite-1.txt`）771 个文件里 769 个过，两个失败：production-reach（裁定 12、13）和 RL-15b 的计时（裁定 14）。
- **合并时的修复**（`checks/c1-merge-fixes.diff`）：f4b75b7 把 `TaskClaimOutbox` 改回 G5 交来的写法（裁定 12，只动类型）；7d60df9 删掉允许清单里三条声明已不存在的条目（裁定 13）。改后类型检查、模块边界检查、production-reach（4 项）、`tests/architecture`、`tests/state/attempt-machine.test.ts`（310 项）和 RL-12-15（11 项）都过。
- **合并：** 顺序 G1（`c1-g1`）→ G2（`c1-g2-rw1-lead`）→ G4（`c1-g4-rw1`）→ G5（`c1-g5-r1-lead`）→ G3（`c1-g3-r1-lead`）；没有冲突，合并提交 1370d99（tag `c1-all`）。每组自己的 diff 和合并树里同一批文件的 diff，sha256 前 12 位逐个相同：G2 `d6adb46385d7`、G4 `783fac3102ea`、G5 `eda381f6f9ab`、G3 `1e98c6e7881c`（`checks/merge-check.txt`）；G1 是基线，没有这一项。合并树对 `c1-base`（`5e83681b`）：152 个文件 +3,999/−5,833；加上合并时的两处修复，`src` 是 152 个文件 +3,991/−5,818，净减 1,827，另外允许清单删 18 行。
- **规模：** 净减 1,827 行，决定 70 估这一轮减 1,800–2,600 行，在估计的低端。改动行（新增＋删除）9,809，多是搬到共用模块和纯调用点改名，见 `README.md` 的“规模”。
- **生产可达：** G1 冻结时有九项共用声明的消费者在后面的组（`books/c1-g1-interfaces.md` 第 10 节）。G2、G4、G5 都从 G1 开始并行施工，各自回报接完后还剩的子集（`dsh/` 各回复）；合并树里九项都有生产消费者，以最终全量的 production-reach 为准。

## 逐组判断

### G1 公共基础

- **做完的：** XX-1 原语和引用（搬到 `src/contracts`，旧名保留）；XX-2／SE-1 事件外壳（G1 的 18 个编码器）；XX-5 可空规范 JSON；XX-6 可空对象解析；XX-7／TA-7 失败映射的定义；四种拒绝结果；PE-2／PE-3；TA-4／VW-4 的编号构造；VW-7 的代码规整；PE-1 注释。
- **部分：** 九项共用声明在 G1 没有生产消费者，这是分组决定的（G2–G5 接）；G1 不替别的组接消费者。
- **留着的：** 注记编解码继续用可空的 `parseObject`，不用 `parseTaggedObject`（Codex 核对后改正）；行为不同的近似实现不合并（裁定 7）；`common.ts:1`、`fingerprint.ts:1` 的 N0 来源行在 `src/contracts`，不在 `src/core/work-graph`，进 T（裁定 3）。
- **Codex 的 6 条：**
  - 恢复 execution-history 的“调用方检查 `sessionRef.projectId`”规则（lead 修）。
  - 恢复事件校验里“decoder 把正文直接作为事件值返回”的原因（lead 修）。
  - 过时的说明：evidence-service 的 `part-1 admission`、`Stage 1 declares the seam only` 改成现在的说法（没有政策时由 Goal 自己的自主设置决定；给了解析器时它优先于 `configuration`；lead 修）；N0 来源行进 T（裁定 3）。
  - 冻结的接口表补齐完整签名、返回形状、原实现位置（`books/c1-g1-interfaces.md`）。
  - 消费者表改正：注记接 `parseObject` 不接带字符串错误的解析器；`canonicalOf` 加 G4，事件外壳加 G3，`rejectedWithNonEmptyCurrent` 加 G3 的查询消费者。
  - 超过 1,200 行没有拆 G1a/G1b：记裁定 1，接受，之后不拆。

### G2 Session／通信／配置

- **做完的：** SE 补充（三个 Session 服务的可信上下文和写请求隔离）、SE-2、SE-3、SE-5、SE-7、G1 共用件的接线（XX-1 的原语在 18 个文件里）、SE-4 注释。三个新模块只在 G2 内用。
- **部分：** 没有。
- **留着的：** SE-9／11／12／13 是被撤下或别的组的行，不归 G2；纯调用点改名保留（裁定 2）。
- **Codex 的 1 会出错／3 不整洁（另有 1 条建议）：**
  - line 设置服务在校验后又读一次 `expected[0]`：返工 1 让共用校验返回首次捕获的 pin，line 和 decision 都改用这个 pin（decision 的包装返回 `{ pinProblem, pin }`）。
  - 快速核对发现返工把 decision 服务原来在比较处的第二次读也去掉了：lead 把 decision 的包装改回只返回问题或 `null`，恢复比较处的 `expected.length === 1 ? expected[0] : undefined` 和原来的比较（2 文件 +8/−11）。现在两个服务都和原版一样：line 只在校验时显式取一次 `expected[0]`，之后用取到的 pin；decision 在校验时取一次，读完 Workspace 后在比较处再取一次。
  - `session-directory` 的 Module canonical provider 说明过时：返工 1 改成“Task 对当前 Plan、Module 对当前目录、WorkContext 仍不支持”。
  - 施工标签（含这轮新增的 `G1's map`）和 lead 日期：返工 1 删掉，规则和理由保留；`session-directory.ts:338` 的长状态机注释按 `c1-g1` 逐字节恢复。
  - 接口表缺完整签名、`identityKeyOf` 写成裸 SHA：返工 1 补齐，写成 prefix + SHA。

### G4 task 服务和 Runtime 接线

- **做完的：** TA-1、TA-4（G4 侧）、TA-5、TA-10、VW-5 的终态候选选择、G4 的 B 接线、TA-2 注释。
- **部分：** B 接线第一版还留着 Codex 点名的同体副本；返工 1 把点名的都接上，并列出留下的七类（抛错的 canonical 包装、捕获异常后返回布尔值的 `sameRef`、带校验的解析、有上下界的整数等；第七类是为保留窄类型或名字留下的薄包装，已经调用共享实现）。
- **留着的：** TA-4 的视图侧归 G3；requeue 故意不接（它看 `reductionRevision === null`，helper 看 `applicableReduction === null`，两式不等价）；`waitPredecessorWalk` 没有写进接口表，记裁定 4，不返工；`atLeastCursor` 原样。
- **Codex 的 1 会出错／3 不整洁（另有 1 条建议）：**
  - run-state 的成功结果多了 `scope`（`ok,ctx,scope,actor`）：lead 删掉 `scope` 和无用导入，恢复 `ok,ctx,actor`（3 文件 +4/−5）。
  - `allowArraySignal` 把入口差异搬进公共函数：返工 1 改成每个入口传自己的 `isSignal`，位置仍在 scope 之后、身份克隆之前；claim 接受带属性的数组，另外三处拒绝数组。
  - B 接线剩下的同体副本：返工 1 接上。
  - `R10 (review item 10)` 标签：lead 删掉，保留 RUN-21 和时间的解释。
  - 接口表：返工 1 补齐，`waitPredecessorWalk` 仍漏（快速核对：0 会出错、1 不整洁只在回复里），记裁定 4。

### G5 状态／类型／task codecs／K3 owner

- **做完的：** ST-1 和两处补充、ST-4、ST-6、ST-7、ST-9、N8、N12、G1 共用件的接线、K3 的 `sessionRefProblem`、TA-2／VW-2／ST-5 注释。
- **部分：** XX-7 的 `pinsFromStoreCurrent` 在 G5 没有消费者（G2／G4 的），没有接。
- **留着的：** K3 的小字段比较不并进 ST-7（裁定 7）；`run-activity-codecs.ts` 是 11 行纯转出，没有可迁移的；长状态机规则注释不动。
- **Codex 的 0 会出错／3 不整洁（另有 3 条建议）：**
  - `TaskClaimOutbox` 还在重复声明六个字段：lead 先改成 `DispatchOutboxRecord` 的别名；合并树的全量查出这样 `TaskDispatchStateV1` 就没有生产用处了，合并时改回 G5 的写法，重复和只剩测试在用的别名进 T（裁定 12）。
  - `attempt-machine.ts:52` 的 decoder 说明过时、`communication-contracts.ts:252` 的 `(Stage 1 seam)`：lead 删掉。
  - UCR 头注释丢了“Each write”限定：lead 改成“每次写按 owner 顺序，读口另说”。
  - 建议：回复里说 anomaly 有 4 个 `sameRef` 调用点，实际 2 个（`session-anomaly.ts:64`、`:65`），availability 的 3 个对；只是回复里的数字，代码对，没有返工。
  - 建议：`run-machine.ts` 删标签时连正式守卫号 `G1` 一起删了，lead 恢复 `K3 RUN-25 guard G1 (U1)`。
  - 建议：两个不变量测试的“基线失败”归因不成立，留最终全量判定（裁定 10）。

### G3 视图／查询／注记／架构

- **做完的：** VW-1／XX-8、VW-3、VW-5 的视图调用方（按 G4 冻结的前提取 live heads、保留 live 分支和兜底）、VW-7、N1–N7、N9–N11、G3 的 B 接线、VW-2 注释。
- **部分：** 没有；N8／N12 归 G5，被撤下的行不做。
- **留着的：** 两个查询服务的纯改名保留（裁定 2）；接口表的 `CapacityError` 消费者和 1,007 行归因有错，记裁定 4；`track-read-model.ts:224` 的旧游标说明保留、只删施工标签，旧数据容忍本身进 T（裁定 8）。
- **Codex 的 0 会出错／2 不整洁（另有 1 条建议）：**
  - `Rework 3 ruling 2`、`group GD`、`before round 3` 标签：lead 删掉，规则和 why 保留（3 文件 +5/−5）。
  - 接口表：`CapacityError` 还被 timeline 和 track 捕获；两个查询服务实际是 443＋218＝661 行，不是 1,007（记裁定 4）。
  - 建议：626 行只是换调用名，用导入别名就能撤回；lead 定为保留（裁定 2）。

## 裁定（`books/c1-lead-rulings.md` §2）

1. **G1 不拆。** G1 第一次就到 +678/−896（1,574），DSH 一次做完（1,439 秒、峰值 160k），Codex 没找到会坏的行为。接受；之后不再拆。
2. **G2、G3 超过 600–1,200 的目标，不改回。** G2 3,077、G3 2,819；其中 G2 490 对（980 行）、G3 626 行是纯调用点改名。Codex 建议用导入别名保留旧名；裁定保留改名：它们用共享导出的真名，行为不变，规则 7 只禁止改公开名，撤回要花一轮返工；目标是一个运行的体量，不是上限，两组都一次做完。
3. **N0 来源行进 T。** 那一行在 31 个 `src` 文件里，没有一个在 `src/core/work-graph`，不在 C1 范围。见 `books/c1-lead-rulings.md` 裁定 3、Codex G1 审查第 3 条。
4. **DSH 回复里的说法错误记录，不返工。** G4 的 signal 写成“接受任意非 null 对象”，代码要求 `aborted`（布尔）和 `addEventListener`（函数），和以前一样（Codex 快速核对说代码对）；G4 接口表漏 `waitPredecessorWalk`（`tasks/goal-settings-service.ts:105`）；G3 说 `CapacityError` 只有活动视图用，实际 timeline 和 track 也捕获，两个查询服务是 661 行不是 1,007；G2 第一版接口表缺完整签名、`identityKeyOf` 写成裸 SHA（返工 1 已改）。代码对或已改好，返工文字白花一轮。
5. **G4 第一次被杀是内存。** 五个子 agent 同时跑 `tsc`（每个约 1.8 GB），00:07 越过运行 8 GB 的上限。部分改动保留（`checks/c1-g4-killed-partial.diff`），重置到 G1，00:08 重跑，run 文件加绑定的内存段：只有协调者跑一次类型检查，子 agent 只跑自己文件的 `vitest --maxWorkers=2`，这次最多三个子 agent。类型检查那条作为 lead 的做法写进 DSH-WORKFLOW §6.10，用于要跑类型检查的运行；三个子 agent 的上限只用于这次重跑，决定 76 不限子 agent 个数。
6. **“三个手写卡来源 → 通用卡来源”不在 C1。** 第 4 片规格 §14 第 10 项把它派给“清理 C1”，但清单比 4C-2 早、delta 没列，lead 写书时漏了。进决定 84 的结构审查（6B、7D2 还会加卡来源，可能是“那一片之前先做”的一项）。
7. **行为不同的近似实现故意不合并（书 §5）。** 内联的安全整数检查、复合的 `isRunRef`、会抛错的 `refKeyOf`、捕获异常后返回布尔值的 `sameRef`、允许额外字段的 execution-entry 引用检查、K3 的 `sameTask`／`sameReviewRef`／`sameRunRef`、各有自己协议的编解码解析器（G4、G5 回复）。它们行为不同；要不要合成一个共用件，交决定 84 的结构审查，不交 T。
8. **旧数据容忍进 T。** `views/track-read-model.ts:224` 把没有 `ca` 的游标读成 null（“written by earlier versions”）。决定 79 说发布前没有旧数据；和别的旧数据代码一起进 T。
9. **书里说不在 C1 的，不在 C1。** `atLeastCursor` 的小修（C1 之后单独一条小提交）、C2（少读）、被撤下的行；决定 70 第 3 项（决定事件和置顶设置事件的编解码试点）的时间由决定 84 的审查定。
10. **两个不变量测试。** G5 在没有 bubblewrap 的干净 G1 副本上跑 `tests/state/invariants.test.ts` 和 `invariants-fuzz.test.ts` 失败；有 bubblewrap 的 G1 全量、G1+G2+G5 全量和第一次合并树全量里都过。G5 的“基线就失败”不成立。
11. **决定 70 第 4 项（只留一个 RecordStore 后端，决定 49 Q9）放进决定 84 的结构审查。** 原定补审注记部分时一起拿出来；补审在 C1 的 refresh 和 delta 里做了（N 项），没有拿出来。lead 把它和别的结构问题一起交给结构审查分类。
12. **G5 的别名在合并时撤回。** lead 按 Codex G5 审查把 `TaskClaimOutbox` 改成 `DispatchOutboxRecord` 的别名；第一次合并树的全量查出 `model/claim-contracts.ts:92` 的 `TaskDispatchStateV1`（本身是 `DispatchStateV1` 的别名）没有生产用处了，它唯一的用处原来是 `TaskClaimOutbox` 的 `dispatchState` 字段。C1 不能删测试会导入的导出（`tests/state/attempt-machine.test.ts:37`），也不能加放行条目，所以 `TaskClaimOutbox` 改回 G5 r1 的写法（f4b75b7，只动类型）。重复的形状和只剩测试在用的别名进 T（生产代码里没人用的旧代码）。
13. **允许清单删三条。** 上一条修好后，同一个测试的下一条断言报出 `architecture/file-graph-index.ts` 的三条 `kept-for` 条目（`CursorV1`、`isRecord`、`encodeCursor`）对应的声明已被 C1 删掉（改用 G1 的共用 `isRecord` 和 N7 的共用 `encodeCursor`），测试要求删掉已不存在的条目。书规则 4 让清单不变，是为了不让哪一组靠加条目让检查通过；删掉已不存在的条目让检查更严，也是测试自己要求的。lead 删了这三条（7d60df9）。各组都没看到，因为这个测试在第一条断言（预期的交接清单）上就停了。
14. **RL-15b 的计时。** 第一次合并树全量里 `tests/kernel/RL-12-15-conditions.test.ts` 的 RL-15b 量到 9,999.91 毫秒，断言要求至少 10,000（10 秒的探测超时）。这个测试跑的是冻结的 Kernel 产物，C1 没碰；单独重跑和之前几次全量都过。下界没给计时误差，进 T。

## 移到 T 轮

- **N0 来源行：** 31 个 `src` 文件里的 `// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.`，没有一个在 `src/core/work-graph`。来源：裁定 3、Codex G1 审查第 3 条。
- **旧游标容忍：** `views/track-read-model.ts:224` 把没有 `ca` 的游标读成 null。来源：裁定 8、决定 79。
- **`TaskClaimOutbox` 的重复形状和别名 `TaskDispatchStateV1`：** `TaskClaimOutbox` 和 `state/attempt-machine.ts` 的 `DispatchOutboxRecord` 是同一个形状写了两遍；`TaskDispatchStateV1` 只剩测试在用。来源：裁定 12、Codex G5 审查。
- **RL-15b 的计时下界：** `tests/kernel/RL-12-15-conditions.test.ts:403` 要求至少 10,000 毫秒，没给计时误差。来源：裁定 14。

## 移到决定 84 的结构审查

- **三个手写卡来源 → 通用卡来源：** 第 4 片规格 §14 第 10 项派给 C1，C1 没做。来源：裁定 6。
- **行为不同的近似实现要不要合一：** 内联整数检查、复合 `isRunRef`、会抛错的 `refKeyOf`、捕获异常后返回布尔值的 `sameRef`、允许额外字段的 execution-entry 引用检查、K3 三个 `same*`、各有协议的编解码解析器。来源：裁定 7、书 §5。
- **只留一个 RecordStore 后端：** 决定 70 第 4 项。来源：裁定 11。

## 不在 C1（书里写明）

- **`atLeastCursor` 的小修：** `tasks/goal-decision-reader.ts` 收了 `atLeastCursor` 却从不用，来源永远不会回“还没读到”；C1 之后单独一条小提交。来源：裁定 9、delta §三。
- **C2（少读）：** 决定 70 的第二轮，减少同一次请求里的重复读取，合入前实测读次数。来源：决定 70、裁定 9。
- **被撤下的行：** refresh §三、delta §二 撤掉的行。来源：书规则 6。
- **决定 70 第 3 项的编解码试点：** 先拿决定事件和置顶设置事件试一组；时间由决定 84 的审查定（84-3）。来源：裁定 9、决定 84。

## 已知限制

- **没有调用真实模型。** 整个 MVP 仍未完成。
- **中间的全量。** G1 的全量（`checks/g1-full-suite.txt`）是 G1 第一次运行（`c1-g1-r1`，lead 的注释修改之前）的副本、有 bubblewrap、5 个并行：771 个文件里 2 个失败、769 个过；10,080 项过、2 项失败、5 项跳过；2,419 秒，内存峰值 5.27 GB。两个失败都在预期内：production-reach 只为交给后面几组接线的九项；K3-07 是在 build 产物存在前跑的，build 后过。G1+G2+G5 的全量（`checks/m25-full-suite.txt`）只有 production-reach 失败，剩的四项正是 G3、G4 要接的。
- **回复里的文字错误还在。** G4 的接口表仍漏 `waitPredecessorWalk`，G3 的表有裁定 4 记的错；G2 第一版表的错已在返工 1 改好。以代码和冻结的 `books/c1-g1-interfaces.md`、`books/c1-g4-interfaces.md` 为准。
- **G4 第一次运行被杀。** 没有 `run.json`，只有部分 diff；重跑从 G1 开始，不是接着被杀的那次。
