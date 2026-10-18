1. **P1、P2：行号正确，规定的行为能闭合缺陷。** [architecture-service.ts:1087](D:/cxt/s8l8-review4/src/core/work-graph/architecture/architecture-service.ts:1087) 确在 `:1090` 的清理范围之外；`:1251–1253` 清理先于 `:1255–1257` catch。P1 应让 ready capture 的取消出口经过释放，非 ready 保持原优先级。P2 必须在清理前确定异常结果，且不得再被外层 catch 二次改判；保留 `hasCommittedReceipt`，包括 committed 后 late restore 的失败与 throw。

   两项测试均可达：用真实平台的 `captureSourceChanges`，传公开 `architecture/capture` body、不带 `requestSeq`。P1 在真实 `captureObservation` **返回 ready 后**门控；P2 在 `verifyCapture` 注入一次 throw，并在真实 `releaseCapture` 门控、计数，取消原调用 signal。cleanup 使用自己的新 signal（`:457`），释放仍能完成。原异常应在平台方法层断言；HTTP 会把它映射为 500。

   已有模式是 [S8A-L8-auto-capture-gate.test.ts:151](D:/cxt/s8l8-review4/tests/app/S8A-L8-auto-capture-gate.test.ts:151) 的 `openPlatform`，配合 `installCaptureActivity`（`:72`，`:83–102` 包装真实 workspace）。需把门移到真实结果返回后；现有入口计数不能直接证明 P1。

2. **P3：signal 可达，但须明确断言层级。** [session-anomaly-facts.ts](D:/cxt/s8l8-review4/src/core/agent-runtime/session-anomaly-facts.ts:123) 应补齐 `:123、136、168、174、191` 的 await 后检查；`:170` catch 先判取消，再保留原 unavailable。`:123` 使用已有 `retry/cancelled`；覆盖 `:149、156、179、186` 及末尾返回的 ready 出口，`:139` catch 已有取消检查。

   原 signal 是**本次归档调用**的 signal。HTTP 路径中，controller 建于 [server.ts:227](D:/cxt/s8l8-review4/src/app/server.ts:227)，断连在 `:228` abort，`:247` 传入 ctx；`session-archive.ts:131、326、487、244` 原样传到 reader。可在 execution read 返回被持有时取消请求；并非 Run 的停止 controller。`S1-archive-files-brief.test.ts:168` 只提供未进入 Run 的前置，不能本身证明请求取消。因此不能以“signal 不可达”报 BLOCKED。

3. **D：15 个 case 完整，起始行准确：** `416、437、458、482、514、533、561、584、615、636、662、686、708、738、772`；两后端展开为 30 项。`:798、818` 使用 `openPlatform / oneShot / hostContext`，其余保留项也不依赖三个 body helper。删除 helper 时须包含 `failureBody` 在 **`:404`** 的闭括号。

4. **R：当前两后端下有效且稳定。** [host.ts:1562](D:/cxt/s8l8-review4/src/app/host.ts:1562) 的登记包装在回包前触发；driver 虽 detached，但 request 写入前的 lookup/read/commit 在 memory、SQLite 都同步完成，仅经 Promise 微任务，没有真实 I/O 等待。错误触发产生的 request 会在下一次 HTTP 读取前可见，`requestSeq` 将为 2，即使 capture 已完成也不能冒充 1。因此即时 `{requestSeq:1,pending:false}` 能检错；继续保留 adoption 后 seq2 的完成边界。

5. **OPEN 1：P3 的 cancelled 究竟断言 reader，还是整个归档结果？** `session-archive.ts:244–248` 仍把 reader 的 cancelled 转成 unavailable facts，V3§7 已明确延后处理。最小封口句：**“P3 经公开 archiveLine 触发，以 A3 包装原样观测真实 readArchiveChangedFiles 的返回并断言 cancelled；归档组合层回退保持不变。”** 其余未发现需要实施者另作设计裁定之处。本次未写文件、未运行测试。

OPEN count: 1