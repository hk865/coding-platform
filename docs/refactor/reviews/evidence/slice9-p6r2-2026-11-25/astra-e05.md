**E05 能定位到检查窗口，不能定位到某一个 `await`。** `#172` 证明 `c-readme` 已领到执行票，`#174` 证明重启时这张票仍未结算。现场更支持检查调用已经返回或抛错、留下 `executing`，但材料没有保留任务看守的回执，具体原因说不清。  
**可以排除种子的四次只读命令把四个槽永久占满。** 同一 Host 在重启前完成了 E08、E09 的检查。代码另有一处可证的异常漏槽，发生在注册检查拿槽后读取时钟时，与那四次只读工具调用无关。以下是只读审查结果，未改文件、未跑测试。

## A. `VerificationCheckBegun` 之后停在哪里

现场最能缩小范围的是 **09:09 的驱动状态**。首版计划采用后，Host 自动启动 Goal 驱动，`run_check` 由 `t1` 的看守执行并等待返回。看守仍为 `running` 时，Goal 对外也应显示 `running`，Goal 重新选任务时还会跳过正在由看守推进的 `t1`。实际读到的是 `waiting_for_reply`，理由是重新读取轮次链头后得到的 “has an executing check; not advancing”。这支持一次检查调用已经退出、随后选择又碰到遗留窗口。它不能区分执行异常、结果写入被拒和放弃窗口未写成。下次现场最值得保留的是 `workflow/driver-read` **带 `taskId: "t1"`** 的 `current`、`last.value.receipt` 和 `reason`。这次提供的只有 Goal 摘要。[E05 驱动记录](D:/cxt/p6e05cx/.lead-ref/e05-notes.md:21) · [看守等待调用并保存回执](D:/cxt/p6e05cx/src/app/collaboration-driver.ts:1233) · [Goal 状态投影](D:/cxt/p6e05cx/src/app/collaboration-driver.ts:463) · [跳过活动看守](D:/cxt/p6e05cx/src/business/workflow/workflow.ts:2721) · [链头等待理由](D:/cxt/p6e05cx/src/business/workflow/workflow.ts:1685)

| `#172` 之后的步骤 | 超时和 30 秒的边界 | 卡住或失败时的痕迹 |
|---|---|---|
| 收到 begin 回执、验票、复核 root 和权限 | 票据校验同步。实际 Host 的 `resolveRoot` 查内存 Map，`authorize` 查配置并算权限摘要，两者都不等文件锁、数据库或远端。建工作区沙盒和第一次 `probe` 已在 `#172` **之前**完成。 | 重放 begin 只重读轮次。坏票应写 `VerificationCheckInterrupted(ticket_invalid)`。root、约束或权限变化应走 abandon。现场没有这些结算事件。把 root/permission 复核列为百分钟锁等待，代码不支持。[runner](D:/cxt/p6e05cx/src/core/agent-runtime/check-execution.ts:294) · [Host 绑定](D:/cxt/p6e05cx/src/app/host.ts:856) |
| 重读轮次，以及 abandon/interrupt 的读写 | `afterBegin` 读正式快照。放弃时用独立信号再读、按当前 revision 写。没有 runner 总时限。SQLite 单次遇锁的 `busy_timeout` 为 **5 秒**，读写事务同步，未持事务跨 `await`。30 秒不覆盖。 | abandon 成功才有 `VerificationCheckAbandoned`，单项回 `pending`。重读失败会直接返回，abandon 写被拒时 runner 仍返回原拒绝，二者都可只留下 begin。持续成功的 HTTP 轮询也与同一 Host 的 JS 线程被同步 SQLite 调用堵住 100 分钟不符。[放弃路径](D:/cxt/p6e05cx/src/core/agent-runtime/check-execution.ts:134) · [正式轮次读取](D:/cxt/p6e05cx/src/core/work-graph/evidence/evidence-service.ts:522) · [SQLite 锁时限](D:/cxt/p6e05cx/src/core/record-store/sqlite-record-store.ts:166) · [事务边界](D:/cxt/p6e05cx/src/core/record-store/sqlite-record-store.ts:278) |
| `commandSlots.acquire(ctx.signal)` | **无排队时限**。空槽立即授予，满槽按 FIFO 等待。排队时收到 abort 就移出队列并返回 `null`。此时还没调用 `sandbox.execute`，30 秒尚未开始。 | 入队、获槽、还槽都没有账本事件。取消后 runner 尝试以 `caller_cancelled` 放弃。09:09 的 Goal pause 本身不能证明这个 signal 已 abort。[槽队列](D:/cxt/p6e05cx/src/core/agent-runtime/command-slots.ts:19) · [检查取槽](D:/cxt/p6e05cx/src/core/agent-runtime/check-execution.ts:223) |
| Kernel 准备、运行子进程、收尾 | 获槽后还有资源能力探测、执行前快照、根目录句柄和挂载参数准备。子进程启动后才装 `timeoutMs` 计时器。到点触发终止，仍须等真实 `close` 或受限进程结算，之后还要关句柄、取后快照、接纳改动。部分步骤有自己的限时，整个 `execute()` 没有 30 秒硬截止。 | 注册检查没有独立的账本“进程已启动/已退出”事件。正常超时应产生 `timedOut:true` 观察，来源匹配且入账成功时为 `INCONCLUSIVE/process_timed_out`。`sandbox_unavailable`、`launch_failed` 可记 `not_started`。其余异常直接返回 `unavailable`，释放槽、留下 `executing`。不能凭 30 秒断言子进程从未启动，也不能凭 begin 断言它一直在跑。[执行异常分流](D:/cxt/p6e05cx/src/core/agent-runtime/check-execution.ts:241) · [受限进程计时与结算](D:/cxt/p6e05cx/vendor/coding-agent/dist/sandbox/process/process-sandbox.js:1410) · [普通进程终止与收尾](D:/cxt/p6e05cx/vendor/coding-agent/dist/sandbox/process/process-sandbox.js:1560) |
| `recordResult` 记录结果 | **到这里槽已释放。** 用独立 finishing signal 读回执、校验轮次、复查来源、先存报告正文，再提交结果事件。来源捕获里的单个 Git 命令限 **5 秒**，文件快照没有检查级截止。账本和正文库各有 SQLite 锁时限。仅 `revision_conflict`、`unavailable` 刷新 pin，以同一 requestId 重试，**首次加两次，共三次**，没有退避或总时限。 | 正文已存而提交失败，可能有孤立报告而无结果事件。正文存储失败、写前拒绝或重读失败，可以连报告都没有。非重试码立即返回；三次用尽返回最后的拒绝。重读发现别人已结算则返回已有事实。三次失败不会产生三条事件。[重试循环](D:/cxt/p6e05cx/src/core/agent-runtime/check-execution.ts:155) · [先存报告再提交](D:/cxt/p6e05cx/src/core/work-graph/evidence/evidence-service.ts:1605) · [来源捕获](D:/cxt/p6e05cx/src/core/workspace/verification-workspace-reader.ts:15) · [正文库锁时限](D:/cxt/p6e05cx/src/core/record-store/sqlite-body-store.ts:80) |

`#172` 和重启的 `#174` 之间，唯一列出的事件 `#173` 是 Goal pause，没有同轮 revision 前进的证据。因此，**并发修改该轮导致连续三次旧 pin** 也缺乏支持。材料同样没有报告存储拒绝码，不能认定重试发生过。VD-10 明文接受的是**重试用尽或执行中出现未知错误**后留窗；LA-6 规定的是驱动如何唤醒。两条都不能反推出 E05 命中了哪个分支。10:18 的 `host_restart` 只说明启动对账发现了未结算的 invocation。[事件时间线](D:/cxt/p6e05cx/.lead-ref/e05-report.md:18) · [VD-10](D:/cxt/p6e05cx/docs/refactor/STATE-MACHINES-SPEC.md:2990) · [LA-6](D:/cxt/p6e05cx/docs/refactor/STATE-MACHINES-SPEC.md:6614) · [启动对账](D:/cxt/p6e05cx/src/app/startup-reconcile.ts:516)

## B. 命令槽会不会泄漏

生产代码只有**两处实际调用 `acquire`**。`execution-driver.ts`、`query-execution.ts` 和组合根负责传递同一个对象。Host 创建一次、上限为 4，所有项目共用。独立创建 platform 且未传入槽时，组合根才新建自己的池。[Host 创建](D:/cxt/p6e05cx/src/app/host.ts:784) · [逐项目注入](D:/cxt/p6e05cx/src/app/host.ts:1039) · [独立 platform 回退](D:/cxt/p6e05cx/src/composition/create-platform.ts:1255)

| 获取路径 | 对异常、取消和结束的处理 |
|---|---|
| Work / Query 的 `run_readonly_command`，包括经 Query 执行的审阅轮 | 参数和权限先验，之后取槽。已取槽时，选项拒绝、probe 抛错、进程失败、取消、正常退出都经过 `finally { release(); }`。输出整理也在释放之后。尚未分派的模型工具调用没有取槽；已分派调用由 dispatcher 等待 handler。强制取消时 Kernel 可在排空期后记 `tool.outcome_unknown`，若底层 Promise 此时仍未返回，槽继续占用到 handler 真正退出。Run 结束或 Query 关闭本身不会提前把仍在用的槽发给别人。[Work](D:/cxt/p6e05cx/src/core/agent-runtime/execution-driver.ts:1092) · [Query](D:/cxt/p6e05cx/src/core/agent-runtime/query-execution.ts:939) · [获取与释放](D:/cxt/p6e05cx/src/core/agent-runtime/readonly-command-tool.ts:343) · [取消排空](D:/cxt/p6e05cx/vendor/coding-agent/dist/core/runtime/loop/runtime-runner.js:749) |
| 注册检查 `runRegisteredCheck` 和改动前基线 `runCheckBaseline` | 二者共用 `executeInSandbox`。队列取消不占槽，获槽后发现已取消、构造或执行沙盒抛错、正常返回，都有 `finally`。**有一个例外**：获槽后的第一句 `deps.now()` 位于 `try` 外，注入的时钟一旦抛错就漏一个槽。生产默认时钟是 `new Date().toISOString()`，本次没有时钟异常证据。只读工具也不经过这一行。[漏洞位置](D:/cxt/p6e05cx/src/core/agent-runtime/check-execution.ts:228) · [基线调用方](D:/cxt/p6e05cx/src/core/agent-runtime/check-execution.ts:379) · [默认时钟](D:/cxt/p6e05cx/src/composition/create-platform.ts:1237) |

**种子那四次的逐次退出码说不清。** 三份材料给了调用次数和种子 Run 的 `completed / exitCode=0`，没有四条逐调用结果。能确定的是，这个工具声明为 `effectClass:'process'`、`independentReadOnly:false`，同一工具批里的这类调用串行执行。正常完成的种子 Run 也已在 `08:37:34.761` 入账，早于检查 begin。即使其中一次工具返回了非零退出，它也已经过释放路径。[材料所载的四次调用](D:/cxt/p6e05cx/.lead-ref/e05-report.md:146) · [Run 结束时间](D:/cxt/p6e05cx/.lead-ref/e05-report.md:18) · [工具声明](D:/cxt/p6e05cx/src/core/agent-runtime/readonly-command-tool.ts:437) · [Kernel 分组规则](D:/cxt/p6e05cx/vendor/coding-agent/dist/tools/registry/tool-registry.js:134)

还有独立的反证。E08 在 **09:57:36、10:00:48** 两次写出了真实静态检查 PASS 和动态检查 FAIL；E09 的 gate 在 **10:14:02** 写出 PASS。三者均使用 `w-accept`，早于 **10:18** 重启。四槽若从 E05 起一直被占死，这些检查拿不到槽。FIFO 还意味着，持续排在队首且未取消的 E05 也不能被后来检查一直越过。后续成功无法证明每一时刻都空着四槽，足以排除 DSH 提出的永久满槽解释。[共同 Host 与运行顺序](D:/cxt/p6e05cx/scripts/acceptance/run.mjs:366) · [E08 检查结果](D:/cxt/p6e05cx/.lead-ref/p6-diagnosis-4.md:121) · [E09 gate 结果](D:/cxt/p6e05cx/.lead-ref/p6-diagnosis-4.md:323)

## C. 修法与测试行

**建议只修已证实的异常漏槽。** 依据是决定 121-112 裁定 3 对 Host 同时运行命令数的限制，以及 AGTP-5 对归还和 FIFO 交接的既有要求。取得槽后，让整个异步观察操作受 `finally` 保护，仍在获槽后采样 `startedAt`。这个补丁修正注册检查和基线的资源释放；不能据此宣告 E05 已修复。[裁定在实现中的落点](D:/cxt/p6e05cx/src/core/agent-runtime/command-slots.ts:1) · [AGTP-5 契约](D:/cxt/p6e05cx/tests/runtime/AGTP-command-slots.test.ts:1)

```diff
--- a/src/core/agent-runtime/check-execution.ts
+++ b/src/core/agent-runtime/check-execution.ts
@@ -223,13 +223,18 @@
     async function executeInSandbox(ctx: CoreCallContext, prepared: PreparedSandbox, root: string,
-        definition: { command: string; cwd: string; timeoutMs: number }): Promise<CheckProcessObservation | 'cancelled' | CoreRejection> {
+        definition: RegisteredCommandCheck): Promise<CheckProcessObservation | 'cancelled' | CoreRejection> {
         // 121-112 ruling 3: a registered check is a platform command and takes
         // one Host slot before launch. Waiting is not a failure; a cancel while
         // waiting is the same caller cancellation as a cancel before the start.
         const release = deps.commandSlots === undefined
             ? () => {}
             : await deps.commandSlots.acquire(ctx.signal);
         if (release === null) return 'cancelled';
+        return observeCommand(ctx, prepared, root, definition).finally(release);
+    }
+
+    async function observeCommand(ctx: CoreCallContext, prepared: PreparedSandbox, root: string,
+        definition: RegisteredCommandCheck): Promise<CheckProcessObservation | 'cancelled' | CoreRejection> {
         const startedAt = deps.now();
         try {
             // Never start a new process once the original caller signal was
             // already cancelled before execute.
@@ -259,7 +264,5 @@
                 return { kind: 'not_started', reason: error.code, startedAt, finishedAt: deps.now() };
             }
             return reject('unavailable', `the registered check execution window is unknown: ${messageOf(error)}`);
-        } finally {
-            release();
         }
     }
```

**规格建议保留排队语义；若要缩短停窗，只改“已有真实观察、写结果用尽重试”这一支。**

- **排队不计进 `timeoutMs`。** 现行 §9 明定超时是进程观察，轮次没有时间触发的迁移。等待名额的检查没有进程可供判定 `process_timed_out`。若产品另要排队期限，需要在 VD-6 和 VR-05 定义“到期、已证明未启动”的放弃原因、返回值和下次起检条件；本次证据没有要求新增该规则。[超时语义](D:/cxt/p6e05cx/docs/refactor/STATE-MACHINES-SPEC.md:3108) · [VD-6](D:/cxt/p6e05cx/docs/refactor/STATE-MACHINES-SPEC.md:2969) · [VR-05](D:/cxt/p6e05cx/docs/refactor/STATE-MACHINES-SPEC.md:3118)
- **若 lead 决定改变 VD-10**，建议把第 2993 行拆开：有真实观察、三次写入均被拒、末次重读仍是同一 `executing` invocation 时，原执行者用该 revision 尝试一次专用中断，例如新原因 `result_not_recorded`。提交成功才返回中断后的快照；已由别人结算则读回已有事实；账本仍不可写则保留原拒绝，重启对账兜底。执行中未知异常仍走原规则。同步修改 §9.3 的中断迁移行和 GAP-23。**现有 `interruptCheck` 只接受 `ticket_invalid`、`host_restart`**；`process_abnormal` 属于已取得进程观察后的判定，直接照抄启动对账调用会写错事实。E05 还有 `c-test: pending`，即便中断写成，下一步也是先跑 `c-test`，再 finalize。[VD-10](D:/cxt/p6e05cx/docs/refactor/STATE-MACHINES-SPEC.md:2993) · [中断迁移表](D:/cxt/p6e05cx/docs/refactor/STATE-MACHINES-SPEC.md:3117) · [GAP-23](D:/cxt/p6e05cx/docs/refactor/STATE-MACHINES-SPEC.md:5466) · [中断输入契约](D:/cxt/p6e05cx/src/core/work-graph/model/evidence-contracts.ts:113) · [后续检查选择](D:/cxt/p6e05cx/src/business/workflow/workflow.ts:429)

**测试行**（只列公开步骤、字面量期望和能抓住的改坏）：

| 公开步骤 | 字面量期望 | 能抓住的改坏 |
|---|---|---|
| 用 `createCommandSlots(1)` 建共享池；通过公开 runner 执行已授权的 `runCheckBaseline`，让注入时钟在采样 `startedAt` 时抛 `Error("clock failed")`；随后在同一池申请一个槽，再取消该申请 | 基线调用抛 `"clock failed"`；第二次申请已获释放函数，`release === null` 为 `false` | 获槽后、进入释放保护前读时钟，异常永久吃掉唯一名额 |
| 公开开轮；先占唯一槽，再调用 `runRegisteredCheck`；读到 `executing` 后取消该调用，再归还原槽并重读轮次 | 返回 `code="cancelled"`；单项 `phase="pending"`、`invocationId=null`；本次检查命令启动 `0` 次 | 排队取消后仍启动命令、留下 `executing`，或误记为进程超时 |
| 公开开轮并运行一条返回 0 的检查；让报告存储端口连续三次返回 `unavailable`，轮次读和账本保持可用；读轮，再用持租约的新 Host 启动对账 | **现行 VD-10**：记录尝试 `3` 次、不同结果 requestId `1` 个、检查命令执行 `1` 次；重启前 `phase="executing"`，重启后 `phase="interrupted"`、`incompleteCause="host_restart"` | 重试时又跑命令、无界重试、凭写入失败伪造 PASS，或重启时重跑原 invocation |
| **仅在新规则获准后替换上一行的结算期望**：公开开含 `c-readme`、`c-test` 的轮；只让前者的报告存储失败三次，执行者仍能提交中断，再按 Workflow 的 `next` 推进 | 重启前 `c-readme.phase="interrupted"`、`incompleteCause="result_not_recorded"`、`reportRef=null`；下一步 `run_check` 的 `checkId="c-test"`；最终 `outcome="INCONCLUSIVE"` | 偷用 `host_restart`、跳过剩余检查，或把没有入账的结果算成通过 |