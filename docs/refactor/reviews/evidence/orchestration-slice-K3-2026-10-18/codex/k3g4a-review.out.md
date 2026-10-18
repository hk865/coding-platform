只读审查完成，未修改文件，未运行测试或构建。以下均属于 A 段；未把 B 段缺席列为问题。

1. **必须改：把读取失败当成“没有记录”，生产门会放行。**

   `src/core/work-graph/tasks/plan-readers.ts:1741` 排除了 `unsupported`；`requeue-service.ts:472` 连 `invalid` 也放过；`claim-service.ts:1207` 的再次探测失败后还能不加记录守卫。SQLite 在查询记录之前检查 schema，因此 `unsupported` 根本不能证明数据库没有记录（`src/core/record-store/sqlite-record-store.ts:359`）。

   最小反例：R 有待核对记录，人的重排已提交；让该记录读取返回 `unsupported`，带 `requeueRef` 的普通领取便可能绕过门。违反 L7、L11。

   **修改思路：**统一保留“读到记录／权威不存在／读不出”三种结果；所有失败都转 `unreadable`，只有权威不存在才加 `expectedRevision: null`。给旧夹具注册 schema，不能为夹具降低生产规则。重排窗口已经调用统一事实读取（`requeue-service.ts:416`），应复用结果，删掉 `:468` 的第二次读取；这是本轮可具体消除的重复。

2. **必须改：等待回复的 continuation 漏拦读取失败。**

   这里的 continuation 是携带 `consumedWait` 的等待回复接续，不是失败后的重排（`src/core/work-graph/tasks/claim-service.ts:238`）。但 `src/core/work-graph/state/task-machine.ts:896` 只拦 `first/requeue`，`run-machine.ts:666` 的 continuation 分支也不检查 `reviewBlocker`。

   最小反例：经正常公开流程让 Run 等回复、收到回复；核对记录读取发生真实故障。owner 已产生 `unreadable`（`claim-service.ts:1213`），continuation 仍可领取。无需伪造 YieldedWait 上的待核对记录。

   **修改思路：**所有非 `review` 领取统一应用 blocker，保留各依据原有条件；增加正常等待回复加读失败的 owner 例子。现有名字带 continuation 的竞争测试实际填的是 `requeueRef`（`tests/work-graph/K3-43-continuation-vs-hold.test.ts:199`），没有覆盖这个入口。

3. **必须改：release-hold 把围栏读取失败伪装成“不需要重排”。**

   `src/app/core-routes.ts:909` 在 Run 读失败时返回 `null`；`:915` 在控制意图读失败时继续用空指针判断围栏，随后也可能返回 `null`。

   最小反例：原 Run 有人的暂停，release 已提交，下一次 Run 或指针读取暂时失败。响应却是成功且 `requeue:null`，任务仍停着，调用方看不到第二步失败。这不符合任务书 §8.4：`null` 仅表示围栏不是人的。

   **修改思路：**这些失败映射为 `requeue` 字段中的明确拒绝，保留成功的 `hold` 回执；只有完整读到事实并确认非人工围栏时返回 `null`。

4. **必须改：组合路由重放时重新生成版本钉，破坏第二步幂等。**

   路由派生的重排请求 ID 固定，但每次重新读取 Goal/Run revision（`src/app/core-routes.ts:934`、`:938`）；重排指纹包含这些钉（`src/core/work-graph/tasks/requeue-service.ts:832`）。

   最小反例：release-hold 和重排均成功，随后 Goal 改版，再重发原 release-hold 请求。hold 重放，重排却因同身份、不同指纹冲突；存储明确如此处理（`src/core/record-store/sqlite-record-store.ts:526`）。

   **修改思路：**派生重排必须能先按稳定身份恢复第一次的请求或回执，不能拿同一身份拼入新钉。新请求仍保留 CAS；不要通过删除版本检查或不断换请求 ID 掩盖问题。

5. **必须改：恢复依赖中的 RUN-24 核对轮例外没有接完。**

   `src/core/agent-runtime/runtime.ts:275` 仍要求暂停中断的 Run 有覆盖自身的 TaskRequeue；`:153` 要求 `afterRunId` 相同。维护入口也排除了带暂停指针的中断（`src/business/workflow/session-maintenance.ts:430`）。

   最小反例：核对轮运行中被人暂停，重启走 RUN-24，settle 后直接 hold/release，再接续。关闭对象是最近核对轮，重排覆盖的却是原 Run，因此关闭被拒、被迫换 Session。冻结规格 L27 明确要求已收尾核对轮免 TaskRequeue。

   **修改思路：**关闭入口读取对应核对记录，确认该轮结束方式已知且已不是 `activeRound` 后应用例外；维护复用同一判断。虽不在本轮差异中，仍是本批恢复目标缺失的依赖。

6. **必须改：恢复测试放宽了必需行为，且若干行没有做到规定终点。**

   `tests/scenarios/K3-29-recovery-round.test.ts:508`、`:634` 允许没有关闭时改验“Session 已归档”；未知调用例在 `:658` 只推进到第二轮准备。`K3-29-recovery-continuation.test.ts:119`、`:214`、`:319`、`:354` 对应行 6、11、8、9 缺最后重启零写；`K3-29-extras.test.ts:81` 用暂停 Goal 模拟行 13 的断点，没有真正重启。

   反例就是这些测试自身：关闭或重启恢复坏了，仍能通过。行 3 的“不发关闭因为先归档”不能作为规格验收；但也不能仅凭此断定生产必错误归档——真实关闭确定失败本来允许退路。

   **修改思路：**保留真正悬空的 Kernel Turn，严格验证 `afterRunRef=第一轮`、关闭成功及同 Session；推进到一次接续或规定停点，再重启验证零写。行 13 在两个 owner 调用之间真正断开并重开。这些不是获准延期的额外例子。

7. **必须改：K3-48（三）既没有最坏界证据，又注入了不可达事实。**

   `tests/work-graph/K3-48-3-required-writes.test.ts:102` 只造一条约 120KB 的条目，`:132` 仅要求超过 100,000 字节，`:145` 的附言为 null，不能证明规格要求的接近 158,720 字节、32 条条目及最坏必需增长。`:181` 又改写读取结果，把路径膨胀为 8×80,000 字符，这是事实注入，不是读失败故障。

   最小反例：容量预留不足以容纳最坏定稿，该小例仍过；篡改例则只验证正式准入不会留下的状态。

   **修改思路：**经公开入口构造 A 段可达的最坏记录，再执行 settle/hold/release，用字面 `524_288` 验证。删除 owner 层篡改实例；非法超限输入可留在纯准入函数测试中。

8. **必须改：启动测试绕过 owner，K3-47 缺指定 SQLite 覆盖。**

   `tests/scenarios/K3-29-startup-reconcile-2b.test.ts:38` 手造整份记录，`:71` 用假 `listReviews` 返回；即使正式 `open` 索引或分页接线坏了，这些例子仍过。`tests/work-graph/K3-47-claim-gate.test.ts:36` 的例子只走默认 memory，`K3-47-reader-facts.test.ts:95` 更直接固定 memory；规格指定的 SQLite 并未覆盖，延期名单也不含 K3-47。

   **修改思路：**启动状态通过公开认定、领取、hold/settle 创建，包装真实读取只注入故障；K3-47 参数化现有例子跑两后端，无需另起一套测试。

先改完列出的几处