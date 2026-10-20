已按 134 行逐一审查；未写文件，未运行测试或构建。结论为 **D1 22、D2 29、F 36、G 33、待定 14，U/N 均为 0**。本清单全部属于 C，不能据此认定某项覆盖是 T 删除测试造成的（`lists/list-C3.tsv:2`；`lists/list-C3.tsv:135`；`ref/mapped-summary.txt:86`）。

下文 `src/`、`tests/` 相对 `D:/cxt/t-docs/tree/`，`evidence/` 相对 `D:/cxt/t-docs/`；`lists/`、`ref/` 相对当前目录。D1 的删除建议仅针对表中未使用的包装层，不扩及仍被生产路径调用的底层 owner。

为避免重复，表中故障方案引用以下既有测试接缝：

- **S：存储包装器。** 复用真实 RecordStore 的委托包装，按目标读注入一次拒绝；需要触发 `.catch` 时增加一次抛错，不能只返回 rejected。现有包装在 `tests/work-graph/S2B-activity-read-faults.test.ts:30`；真实 SQLite 读确实可能抛出，见 `src/core/record-store/sqlite-record-store.ts:291`、`:302`、`:818`。
- **L：真实锁文件。** 通过 owner 留下旧锁，再以既有 `pid/isAlive` 接缝并发接管；权限故障沿现有 chmod 场景扩展。见 `tests/app/A2-host-instance-lease.test.ts:61`、`:86`。需要固定竞争顺序时，应新增文件操作门闩，不能手写锁记录。
- **H：真实 HTTP socket。** 复用已有原始 socket 客户端，控制发送、暂停读取和断开时机，见 `tests/app/change-stream.test.ts:222`、`:228`。
- **P：真实分析器进程包装。** 复用解释器 wrapper，在真实子进程边界制造提前退出、关闭 stdin 等故障，见 `tests/data/analysis-runner.test.ts:60`、`:192`。
- **J：真实 Git 进程包装。** 复用委托真实 `spawn` 的门闩，扩展为超时、启动失败或管道关闭场景，见 `tests/data/R2e-git-operations.test.ts:47`、`:59`。
- **Q：真实读取后的取消门闩。** 先委托真实读，再阻塞返回并取消调用，见 `tests/runtime/S1-archive-cancelled-reader.test.ts:79`、`:84`。

表内“—”表示 A 专属的旧测试／T 项字段不适用。

| row | path:line_after | kind | class | reason（file:line） | proposal | A：旧测试／T项 |
|---|---|---|---|---|---|---|
| C3-001 | `src/app/auto-capture-driver.ts:99` | function | D2 | 当前 detached 工作的请求写、捕获、失败写和启动扫描均在内部收敛异常（同文件 `:115`、`:171`、`:240`、`:256`、`:286`）。 | 删 rejection 回调；保留跟踪、正常完成及 close 排空。 | — |
| C3-002 | `src/app/collaboration-driver.ts:165` | function | F | 真正的读／Workflow 异常会进入消息转换，成为 handle 的失败原因（同文件 `:694`、`:911`）。 | 创建真实 Goal/Task→`workflow/driver-start`→S 在推进读时抛错→读取 handle 原因；补入 `tests/app/AG2b-collaboration.test.ts:275`。 | — |
| C3-003 | `src/app/collaboration-driver.ts:210` | function | G | 同 Task 已有活动 handle 时调用，非数据库异常状态（同文件 `:1055`）。 | 同 Task 连续两次 `workflow/driver-start`，首个保持活动，第二个断言 busy；归入 `tests/app/AG2b-collaboration.test.ts:275`。 | — |
| C3-004 | `src/app/collaboration-driver.ts:556` | function | D2 | 排序 seam 的异常已捕获；剩余等待 promise 只有 resolve 路径（同文件 `:591`、`:607`、`:609`）。 | 删 `pass.catch`；保留 rendezvous 的 finally 释放（同文件 `:612`）。 | — |
| C3-005 | `src/app/collaboration-driver.ts:749` | function | D2 | 私有 `handle.abort` 没有生产 abort 写入；停止实际调用 `activePumpAbort.abort`（同文件 `:750`、`:1000`、`:1004`）。 | 删此监听及注册／注销；保留实际停止路径（同文件 `:767`、`:1004`）。 | — |
| C3-006 | `src/app/collaboration-driver.ts:766` | function | D2 | pump 在循环内捕获外部异常，tick 的等待正常完成（同文件 `:693`、`:697`、`:219`）。 | 改为直接 await pumpDone，保留 drain。 | — |
| C3-007 | `src/app/collaboration-driver.ts:884` | function | D2 | 与上一行同一 pump 的拒绝兜底；异常已转为 handle.reason（同文件 `:693`）。 | 删 catch，继续等待原 pump。 | — |
| C3-008 | `src/app/collaboration-driver.ts:1011` | function | D2 | runHandle 捕获推进异常并在 finally 收尾；changed 回调也有异常隔离（同文件 `:908`、`:913`、`:345`）。 | 直接 await handle.done；保留前后两次取消。 | — |
| C3-009 | `src/app/collaboration-driver.ts:1114` | function | D2 | stopHandle 的取消操作自行处理异常，done 又已收敛（同文件 `:953`、`:978`、`:1006`）。 | 删 map 内 catch，保留 `Promise.all` 排空。 | — |
| C3-010 | `src/app/core-routes.ts:529` | function | D1 | 无生产实例化；server 只留下对此异常类型的判别（`src/app/server.ts:251`）。 | 删类及对应 import／instanceof 分支；保留通用 route rejection。 | — |
| C3-011 | `src/app/core-routes.ts:636` | function | D2 | 唯一生产装配始终传入 collaborationDriver（`src/app/host.ts:1574`）；缺失分支仅来自可选签名（本文件 `:737`）。 | 将生产参数改为必需，删 unsupportedDriver 及三处缺失分支。 | — |
| C3-012 | `src/app/core-routes.ts:643` | function | D2 | 生产 Host 传完整 platform/tools/report；可选方法为旧窄 double 保留（`src/app/host.ts:1574`；本文件 `:786`；`src/composition/create-platform.ts:1298`、`:1854`）。 | 收紧生产 bindings 类型，删这些缺依赖 fallback；同步调整窄测试装配。 | — |
| C3-013 | `src/app/core-routes.ts:946` | function | F | release-hold 后的 Run 重读可直接透传存储抛错（`src/core/work-graph/tasks/plan-readers.ts:361`；`src/core/record-store/sqlite-record-store.ts:818`）。 | 真实 unknown review→hold→release-hold；在重读 Run 时 S 抛错，验证 hold 已成功、requeue 未误报成功；归入 `tests/business/K3-41-release-hold.test.ts:280`。 | — |
| C3-014 | `src/app/core-routes.ts:961` | function | D2 | readControl 已将存储抛错转成 unavailable（`src/core/work-graph/tasks/control-service.ts:781`、`:782`）。 | 删 catch-to-null；保留非 ready 结果处理。 | — |
| C3-015 | `src/app/goal-fan-out-driver.ts:179` | function | F | fan-out 的 Goal/Run 读取异常进入此原因转换（同文件 `:400`、`:407`、`:423`）。 | 真实运行→Goal pause/resume→S 在 fan-out 读取时抛错；归入 `tests/app/goal-fan-out-driver.test.ts:103`。 | — |
| C3-016 | `src/app/goal-fan-out-driver.ts:218` | function | D2 | 被跟踪的 runPass、恢复续跑和 reentry 已各自捕获外部失败（同文件 `:289`、`:400`、`:440`）。 | 删 finally 后 catch，保留 running 集合清理。 | — |
| C3-017 | `src/app/goal-fan-out-driver.ts:514` | function | D2 | fanOut 返回的 runPass 已处理读取及逐 Run 操作异常（同文件 `:400`、`:423`）。 | 删 fanOut 的重复 catch。 | — |
| C3-018 | `src/app/goal-fan-out-driver.ts:525` | function | D2 | checkWatches 捕获控制读失败，其 fanOut 又已收敛（同文件 `:504`、`:514`）。 | 删 checkWatches 的重复 catch。 | — |
| C3-019 | `src/app/host-instance-lease.ts:132` | function | F | 锁反复变化或接管时移动了另一实例的新锁，会调用 heldByCurrent（同文件 `:167`、`:195`、`:200`）。 | L：旧 owner 崩溃→多个真实接管者交错→验证最终持有者及 held 返回；补强现有 `tests/app/A2-host-instance-lease.test.ts:61`。 | — |
| C3-020 | `src/app/host-instance-lease.ts:146` | function | F | 临时锁写失败后，清理 rm 仍可能因权限／IO 失败（同文件 `:144`、`:146`）。 | L：制造写入失败并让清理也失败，确认返回 HL-04 且不遮蔽原故障；扩展 `tests/app/A2-host-instance-lease.test.ts:86`。 | — |
| C3-021 | `src/app/host-instance-lease.ts:169` | function | F | 获锁／拒绝后的临时文件清理仍是实际文件 IO（同文件 `:154`、`:169`）。 | L：真实 acquire 后在清理阶段拒绝 rm；验证返回结果不被清理失败覆盖。 | — |
| C3-022 | `src/app/host-instance-lease.ts:198` | function | F | 读旧锁与 rename 间可被另一 Host 接管；恢复 link 又可能遇到新的 EEXIST（同文件 `:179`、`:189`、`:195`）。 | L：固定“读旧锁→别人接管→移动新锁→另一写者占位”交错；验证不覆盖新 owner。必要时新增文件操作门闩。 | — |
| C3-023 | `src/app/host-instance-lease.ts:199` | function | F | 上述真实竞争路径的 aside 清理可发生 IO 失败（同文件 `:195`、`:199`）。 | L：沿 C3-022 交错注入 aside rm 失败；验证 held 结果及现任锁不被破坏。 | — |
| C3-024 | `src/app/host-settings.ts:234` | function | D1 | currentVersion 只有接口声明和 getter，没有消费方（同文件 `:223`、`:234`）。 | 删 getter 和接口成员；不要因此删除 install 仍使用的版本递增。 | — |
| C3-025 | `src/app/host-settings.ts:377` | function | G | directories 对不存在目录直接产生 notFound（同文件 `:591`、`:592`）。 | settings/directories 请求不存在路径；归入 `tests/app/host-settings.test.ts:283`。 | — |
| C3-026 | `src/app/host-settings.ts:529` | function | D2 | 当前 dispatch 的 IO、notify、proposal 读均在路由内收敛；Host openWorkspace 和状态探测也收敛（同文件 `:653`、`:728`、`:783`、`:484`；`src/app/host.ts:945`）。 | 删 queue 的 rejection 回调；保留串行队列及各路由错误结果。 | — |
| C3-027 | `src/app/host-settings.ts:699` | function | G | models 非空且 open 请求带 modelId 就执行该 some（同文件 `:650`、`:699`）。 | models/save→workspaces/open 携带已存 modelId，再测不存在 id；归入 `tests/app/host-settings.test.ts:578`、`:608`。 | — |
| C3-028 | `src/app/host.ts:366` | function | G | programmatic runtime 被此包装器窄化，属于明确支持的装配方式（同文件 `:357`、`:359`）。 | Host 传 options.runtime→真实 claim/prepare；检查只读工具开关后的配置；扩展 Host overrides 夹具 `tests/app/R6-host.test.ts:96`。 | — |
| C3-029 | `src/app/host.ts:376` | function | G | programmatic runtime 的 capability 回调同样被转发；Workflow 会查询 reviewCapability（本文件 `:375`；`src/business/workflow/workflow.ts:1478`）。 | 启动带此回调的 Host→真实 review 选择→capability 查询；补入 `tests/app/K3-19-review-capability-host.test.ts:108`。 | — |
| C3-030 | `src/app/host.ts:456` | function | G | capture 先 resolveRoot，后 authorize；未知 input.workspace 可到 not_found（`src/core/workspace/capture.ts:627`；`src/core/workspace/access.ts:87`；本文件 `:462`）。 | 合法外层 scope→source/capture 携带未知 workspace→断言拒绝；归入 `tests/app/R6-host.test.ts:241`。 | — |
| C3-031 | `src/app/host.ts:528` | function | F | platform 装配失败后释放实例锁；释放中的 rm 可失败（本文件 `:527`；`src/app/host-instance-lease.ts:127`）。 | 真实获锁→装配故障→L 权限故障阻止 release；验证仍报告原装配错误；归入 `tests/app/R6-host.test.ts:96`。 | — |
| C3-032 | `src/app/host.ts:965` | function | G | 保存的检查建议允许具体 taskIds 数组，此 every 校验其元素（同文件 `:959`、`:964`、`:983`）。 | 真实 planning Query Answer 含非空 taskIds→checks/approve；归入 `tests/app/host-settings.test.ts:881`。 | — |
| C3-033 | `src/app/host.ts:978` | function | D1 | assembly 的 listProjectIds 无消费方；接口只声明它（`src/app/host-settings.ts:174`）。 | 删该 assembly 成员和接口声明。 | — |
| C3-034 | `src/app/host.ts:978` | function | D1 | map 嵌在未调用的 listProjectIds 中（同文件 `:978`；`src/app/host-settings.ts:174`）。 | 随 C3-033 删除 map。 | — |
| C3-035 | `src/app/host.ts:1463` | function | F | consumeIdle 的读取／咨询链可能抛错，外层保留重试（同文件 `:1201`、`:1253`、`:1463`）。 | 配置真实 inputConsumer→发送普通输入→S 在消费读时抛错→下一轮恢复消费；归入 `tests/app/AG2-consultation.test.ts:274`。 | — |
| C3-036 | `src/app/host.ts:1603` | function | D1 | Host address getter 无生产消费者；CLI 使用 listen 返回值（`src/app/main.ts:217`）。 | 删 Host facade 的 getter／类型成员；保留 server.listen 地址返回。 | — |
| C3-037 | `src/app/host.ts:1621` | function | D2 | backfill 循环把批次异常捕获后正常完成（同文件 `:1113`、`:1122`）。 | 直接 await backfillDone。 | — |
| C3-038 | `src/app/host.ts:1622` | function | D2 | attention 的消费、扫描、发送和 scribe 操作均有局部捕获，等待支持正常取消（同文件 `:1463`、`:1489`、`:1495`、`:1535`、`:1542`、`:1544`）。 | 直接 await attentionDone；保留各操作的重试处理。 | — |
| C3-039 | `src/app/host.ts:1630` | function | F | 正常关机释放锁时仍可能发生文件删除失败（`src/app/host-instance-lease.ts:127`）。 | Host listen→L 改变目录权限→close；验证关机排空与锁释放失败行为；归入 `tests/app/A2-host-instance-lease.test.ts:86`。 | — |
| C3-040 | `src/app/main.ts:97` | function | G | 非空 writePrefixes 配置执行元素校验（同文件 `:97`）。 | 载入含非空 writePrefixes 的当前格式配置，分别验证合法／非法路径；归入 `tests/app/R6-host.test.ts:684`。 | — |
| C3-041 | `src/app/main.ts:137` | function | G | processSandboxOptions.readOnlyPaths 非空时执行路径转换（同文件 `:137`）。 | 当前配置设置相对 readOnlyPaths→加载→验证解析后的路径；归入 `tests/app/R6-host.test.ts:684`。 | — |
| C3-042 | `src/app/main.ts:196` | function | G | CLI 入口实际调用 runWorkbenchCli（同文件 `:228`）。 | 用真实子进程启动 CLI，覆盖缺参数及合法配置；扩展 `tests/app/R6-host.test.ts:684`，复用子进程方式 `tests/helpers/K3-07-support.ts:169`。 | — |
| C3-043 | `src/app/main.ts:210` | function | F | SIGINT/SIGTERM 会调用 shutdown（同文件 `:215`、`:216`）。 | 真实 CLI ready→发信号→等待 Host close 和进程退出；沿 `tests/helpers/K3-07-support.ts:169`、`:205` 改为相应信号。 | — |
| C3-044 | `src/app/main.ts:215` | function | F | 操作系统 SIGINT 进入该监听器（同文件 `:215`）。 | 真实 CLI→SIGINT；沿 C3-043 的子进程方案。 | — |
| C3-045 | `src/app/main.ts:215` | function | F | SIGINT 的 shutdown 完成后执行退出回调（同文件 `:210`、`:215`）。 | 同 C3-044，另断言关机完成后退出码为 0。 | — |
| C3-046 | `src/app/main.ts:216` | function | F | 操作系统 SIGTERM 进入该监听器（同文件 `:216`）。 | 真实 CLI→SIGTERM；沿 C3-043 的子进程方案。 | — |
| C3-047 | `src/app/main.ts:216` | function | F | SIGTERM 的 shutdown 完成后执行退出回调（同文件 `:210`、`:216`）。 | 同 C3-046，另断言排空后退出码为 0。 | — |
| C3-048 | `src/app/main.ts:222` | function | D2 | 冻结运行依赖的 probeResourceCaps 已把探测失败变为 capability 结果（`vendor/coding-agent/dist/sandbox/process/process-sandbox.js:2018`、`:2029`）。 | 删外层 catch，保留启动探测。 | — |
| C3-049 | `src/app/runtime-configuration.ts:361` | function | G | 未注入 secretSource 时真实 resolver 读取环境变量（同文件 `:398`）。 | 当前配置指定测试专用 secret 变量→不传 secretSource→resolveConfiguration；归入 `tests/app/R6-host.test.ts:684`。 | — |
| C3-050 | `src/app/server.ts:229` | function | F | 真实 HTTP 请求超时会 abort 控制器（同文件 `:229`、`:237`）。 | H：向 core 路由发送不完整 body 并停发，触发 timeout，再完成／关闭请求；归入 `tests/app/R6-host.test.ts:241`。可新增窄 timeout 参数避免等两分钟。 | — |
| C3-051 | `src/app/server.ts:300` | function | F | 慢 SSE 客户端使 end 后仍有积压，宽限期到期会 destroy（同文件 `:296`、`:306`）。 | H：暂停读取→填满 backlog→保持到宽限期→验证连接强制关闭；扩展 `tests/app/change-stream.test.ts:217`。 | — |
| C3-052 | `src/app/server.ts:336` | function | F | settings 请求具有同样的真实超时路径（同文件 `:336`、`:344`）。 | H：settings POST 半包停发→timeout；归入 `tests/app/host-settings.test.ts:283`，超时参数方案同 C3-050。 | — |
| C3-053 | `src/app/server.ts:414` | function | 待定 | `new URL(request.url, base)` 位于各路由 catch 外；但尚未证明固定 Node HTTP parser 会放行可令它抛错的 request-target（同文件 `:369`、`:414`；`package-lock.json:19`）。 | 保留。用 H 验证例如 `//[` 的原始请求是否进入 handle；进入并抛错则 G，否则继续追踪其他真实异常源。 | — |
| C3-054 | `src/app/server.ts:425` | function | F | listen 的真实 error 事件会 reject，例如端口已占用（同文件 `:426`、`:427`）。 | 第一个 server listen→第二个绑定同地址端口→断言启动失败及清理；归入 `tests/app/R6-host.test.ts:200`。 | — |
| C3-055 | `src/business/workflow/consultation.ts:50` | function | F | Query 创建、提交、claim/prepare 的失败需要转换成等待原因（同文件 `:198`、`:225`、`:400`、`:476`）。 | 真实消息→consumeConsultation→S 让 Query 提交／claim 返回 unavailable→断言消息仍可重试；归入 `tests/app/AG2-consultation.test.ts:288`。 | — |
| C3-056 | `src/business/workflow/consultation.ts:53` | function | G | 合法普通消息配不存在的 Goal，公开读取返回 not_found 后调用此转换（同文件 `:432`、`:433`）。 | 创建 Session→sendMessage 普通输入→consumeConsultation 指定不存在 Goal；归入 `tests/app/AG2-consultation.test.ts:274`、`:288`。 | — |
| C3-057 | `src/business/workflow/decision-actions.ts:142` | function | D2 | 生产装配始终提供 goalSettings、decisionMessages、goalPhasePin（`src/composition/create-platform.ts:1854`、`:1855`；`src/business/workflow/workflow.ts:2889`）。 | 收紧必需依赖，删 unsupported helper 和对应缺失分支。 | — |
| C3-058 | `src/business/workflow/decision-actions.ts:393` | function | D2 | 所有生产 application adapter 都返回 ready envelope，动作拒绝放在 value 内（同文件 `:289`、`:389`；`src/composition/create-platform.ts:1684`、`:1871`）。 | 收窄 adapter 返回类型，删 applicationRejection 及 `:490` 的非 ready 分支。 | — |
| C3-059 | `src/business/workflow/session-archive.ts:108` | function | F | 归档请求及续跑中的 Session/Run 读取失败会走 readFailure（同文件 `:183`、`:197`、`:795`）。 | 真实 Session→archiveLine／continueArchiveLine→S 在 facts/Run 读返回 unavailable；验证不误完成归档；归入 `tests/business/S1-archive-flow.test.ts:450`。 | — |
| C3-060 | `src/business/workflow/session-archive.ts:205` | function | F | 崩溃后 unknown Query，操作员确认已停，会检查原 Query 状态（同文件 `:399`、`:405`）。 | 真实 Query 进入→崩溃/重启形成 unknown→确认停止→archiveLine；衔接 `tests/scenarios/A8-host-restart-lease.test.ts:448`，归入 `tests/business/S1-archive-flow.test.ts:505`。 | — |
| C3-061 | `src/business/workflow/session-archive.ts:214` | function | F | 上一流程在非空 Query 历史页中 find 指定 QueryRun（同文件 `:210`、`:214`）。 | 同 C3-060，断言匹配原 QueryRun，不能把其他历史 Query 当作确认依据。 | — |
| C3-062 | `src/business/workflow/session-maintenance.ts:358` | function | 待定 | 咨询流程仅对 inquiry 建 readonly_copy；Session owner 又允许调用者提交合法 provenance，尚缺普通输入副本的完整可达证明（`src/business/workflow/consultation.ts:364`、`:394`；`src/core/work-graph/sessions/session-directory.ts:710`）。 | 保留；补齐“公开建副本→普通消息→确定性 Query claim→正式 Answer→acceptedInputs→maintenance”链，或找出必然拒绝它的上游校验。 | — |
| C3-063 | `src/business/workflow/session-maintenance.ts:359` | function | 待定 | 与上一行共享可达性问题；Query claim 还要求该副本对应同一 consultation message（`src/core/work-graph/queries/query-execution.ts:925`）。 | 同 C3-062；证据须同时证明 acceptedInputs.executionRef 对应副本的 answered Query。 | — |
| C3-064 | `src/business/workflow/workflow.ts:536` | function | G | select_work 对不存在 Goal 的公开读返回需要此转换（同文件 `:1725`）。 | advanceWork(select_work) 指定合法形状但不存在的 Goal；归入 `tests/business/R5c-workflow.test.ts:92`。 | — |
| C3-065 | `src/business/workflow/workflow.ts:974` | function | G | 已存在后继 Session 时，检查其 Task 关联；调用点在重用原 Session 的选择路径（同文件 `:968`、`:1308`）。 | 真实 requeue→create_session 建后继→再次选择前驱同 Task；归入 `tests/business/WP1-continuation-handover.test.ts:86`、`:272`。 | — |
| C3-066 | `src/business/workflow/workflow.ts:1116` | function | F | 判断未准入 starting Run 时，readExecution 可透传存储抛错（同文件 `:1109`；`src/core/work-graph/tasks/plan-readers.ts:361`）。 | 真实 claim→首次 prepare 拒绝→再次 advance→S 在该重读抛错，断言不猜测“未进入”而重启；归入 `tests/business/WP1-start-refusal.test.ts:14`，增加真实 owner 夹具。 | — |
| C3-067 | `src/business/workflow/workflow.ts:1392` | function | D2 | 生产 sourceAuthority.load 已捕获底层 authority 异常并返回 unavailable（`src/core/work-graph/source-authority-reader.ts:102`、`:105`；`src/composition/create-platform.ts:1022`）。 | 删 catch-to-null；保留 found/status 校验并简化 null 判断。 | — |
| C3-068 | `src/business/workflow/workflow.ts:2255` | function | F | 回答与应用间，另一合法 writer 移动 review revision，可得到带 current 的 revision_conflict（同文件 `:2249`、`:2255`）。 | 真实 review/card→保存回答→应用提交前并发 holdReview／结论写→advance；扩展真实提交拦截器 `tests/business/K3-46-review-advance-failures.test.ts:254`，不能只移动 Goal pin。 | — |
| C3-069 | `src/business/workflow/workflow.ts:2844` | function | D1 | maintenance 只取 archiveLineInternal；装配已直接提供它，故这个 archiveLine 转发无消费方（`src/business/workflow/session-maintenance.ts:175`；本文件 `:2851`）。 | 删该别名包装，收窄 maintenance 的 archive 依赖；保留真正内部归档入口。 | — |
| C3-070 | `src/business/workflow/workflow.ts:2924` | function | D2 | 生产 composition 始终注入同一 now（`src/composition/create-platform.ts:1814`）。 | 将 now 改为必需，删本地 Date fallback。 | — |
| C3-071 | `src/composition/architecture-reminder-facts.ts:23` | function | F | catalog/observed 读取期间取消，在 await 后返回 cancelled（同文件 `:25`、`:29`、`:37`）。 | 真实准备执行触发 reminder 读→Q 阻塞读返回→abort→放行；归入 `tests/work-graph/S8A-L8-read-counts.test.ts:18`，复用真实世界 `tests/helpers/S8A-L8-reminder-world.ts:36`。 | — |
| C3-072 | `src/composition/create-platform.ts:898` | function | D1 | 此 holder 的消费方读取 decision facts；实际应用直接调用另一个已绑定对象（同文件 `:903`、`:1631`、`:1665`）。 | 删 holder 的 applyNoteDecision 转发，收窄为只读接口；保留实际应用 owner。 | — |
| C3-073 | `src/composition/create-platform.ts:1148` | function | D2 | 当前唯一生产 trackDetached 消费者是 autoCapture；其工作已内部收敛（`src/app/host.ts:542`；`src/app/auto-capture-driver.ts:115`、`:256`、`:286`）。 | 删 tracker 的拒绝回调；保留完成移除及 shutdown 排空。 | — |
| C3-074 | `src/composition/create-platform.ts:1260` | function | D1 | finishSessionArchive 的公开包装无路由，Workflow 使用原始 lifecycle owner（`src/app/core-http-types.ts:589`；`src/business/workflow/session-archive.ts:717`）。 | 删 facade 外层转发及多余公开成员，保留原始 owner。 | — |
| C3-075 | `src/composition/create-platform.ts:1260` | function | D1 | 属于上一未使用包装的内部 trackedCall 回调（同文件 `:1260`）。 | 随 C3-074 删除。 | — |
| C3-076 | `src/composition/create-platform.ts:1261` | function | G | sessions/archive-release 绑定此真实包装（`src/app/core-routes.ts:795`、`:1124`）。 | 真实提出归档请求→按 request/pin 调 archive-release→公开读确认释放；归入 `tests/app/S1-session-routes.test.ts:87`。 | — |
| C3-077 | `src/composition/create-platform.ts:1261` | function | G | 上一路由的内部 owner 委托（同文件 `:1261`；`src/app/core-routes.ts:1124`）。 | 与 C3-076 共用真实集成用例。 | — |
| C3-078 | `src/composition/create-platform.ts:1278` | function | D1 | 该 readTaskRequeue facade 无消费方；Workflow 使用 raw requeue，路由使用按身份读取（同文件 `:1793`；`src/app/core-routes.ts:935`）。 | 删 facade 成员；保留 raw owner 和 readTaskRequeueByIdentity。 | — |
| C3-079 | `src/composition/create-platform.ts:1278` | function | D1 | 上一未使用 facade 的内部委托（同文件 `:1278`）。 | 随 C3-078 删除。 | — |
| C3-080 | `src/composition/create-platform.ts:1285` | function | G | 此匿名函数为 installRoleSpec 的关闭拒绝回调（同文件 `:1286`）；平台已有 close 后拒绝调用契约测试（`tests/composition/A1-graph-session-platform.test.ts:197`）。 | 创建 platform→close→installRoleSpec，断言 unavailable 和 commandId；扩展该关闭测试，不引入运行中 Role 热切换。 | — |
| C3-081 | `src/composition/create-platform.ts:1287` | function | G | activateRoleSpec 的同类关闭拒绝回调（同文件 `:1288`）。 | platform.close→activateRoleSpec；归入 `tests/composition/A1-graph-session-platform.test.ts:197`。 | — |
| C3-082 | `src/composition/create-platform.ts:1290` | function | D1 | 此 facade 无调用者；实际运行、claim 路径使用 resolveRoleBindingFacts（`src/core/agent-runtime/execution-driver.ts:807`；`src/core/work-graph/tasks/claim-service.ts:1162`）。 | 删 resolveRoleBinding facade；不删 facts resolver。 | — |
| C3-083 | `src/composition/create-platform.ts:1290` | function | D1 | 上一未使用 facade 的内部回调（同文件 `:1290`）。 | 随 C3-082 删除。 | — |
| C3-084 | `src/composition/create-platform.ts:1309` | function | G | completion-policies/read 真实绑定此方法（`src/app/core-routes.ts:376`、`:688`）。 | 创建项目→安装／激活 policy→HTTP read；归入 `tests/app/R6-host.test.ts:291`。 | — |
| C3-085 | `src/composition/create-platform.ts:1310` | function | G | 上一路由的实际 owner 调用（同文件 `:1310`）。 | 与 C3-084 共用用例，验证当前 policy。 | — |
| C3-086 | `src/composition/create-platform.ts:1331` | function | G | architecture/impact 绑定该 queryImpact 包装（`src/app/core-routes.ts:385`、`:699`）。 | 真实采用架构／捕获源码→architecture/impact；归入 `tests/app/S8A-architecture-routes.test.ts:94`，使用真实 composition。 | — |
| C3-087 | `src/composition/create-platform.ts:1331` | function | G | 同一 queryImpact 包装内的 owner 委托（同文件 `:1331`）。 | 与 C3-086 共用真实路由用例。 | — |
| C3-088 | `src/composition/create-platform.ts:1381` | function | D1 | ackMessage facade 无生产消费者；通信工具收到的是 raw mailbox（同文件 `:1188`；`src/core/agent-runtime/communication-tools.ts:457`）。 | 删 facade ackMessage；保留 raw mailbox 的确认操作。 | — |
| C3-089 | `src/composition/create-platform.ts:1381` | function | D1 | 上一未使用 facade 的内部委托（同文件 `:1381`）。 | 随 C3-088 删除。 | — |
| C3-090 | `src/composition/create-platform.ts:1396` | function | D1 | resolveGoalConflict 的 facade 无消费者；决策链使用 rawGoalSettings（同文件 `:1854`；`src/business/workflow/decision-actions.ts:376`）。 | 删重复 facade，保留实际冲突解决 owner。 | — |
| C3-091 | `src/composition/create-platform.ts:1396` | function | D1 | 上一未使用 facade 的内部委托（同文件 `:1396`）。 | 随 C3-090 删除。 | — |
| C3-092 | `src/composition/create-platform.ts:1414` | function | G | plans/abandon 绑定真实 requestCandidates owner（`src/app/core-routes.ts:477`、`:850`）。 | 提出真实 Plan proposal→读取 pin→plans/abandon；归入 `tests/app/S5-decision-routes.test.ts:144`。 | — |
| C3-093 | `src/composition/create-platform.ts:1414` | function | G | 上一路由的内部 owner 委托（同文件 `:1414`）。 | 与 C3-092 共用真实集成用例。 | — |
| C3-094 | `src/composition/create-platform.ts:1466` | function | D1 | 此 completed-boundary 包装未被消费；consultation 得到 rawRuntime 中 runtime.port 自带实现（同文件 `:1527`；`src/core/agent-runtime/runtime.ts:523`、`:726`）。 | 删重复包装；保留 Runtime 的实际 completedBoundary 实现。 | — |
| C3-095 | `src/composition/create-platform.ts:1530` | function | D1 | rawRuntime 注入 Workflow，但 Workflow 不读取 Session history；这里是多余覆盖成员（同文件 `:1524`、`:1795`）。 | 删 rawRuntime.readSessionHistory；保留真正公开历史读。 | — |
| C3-096 | `src/composition/create-platform.ts:1532` | function | D1 | 同一 rawRuntime 的 Task history 委托无 Workflow 调用（同文件 `:1524`、`:1795`）。 | 删该 raw adapter；保留公开 Task history owner。 | — |
| C3-097 | `src/composition/create-platform.ts:1534` | function | D1 | 同一 rawRuntime 的 execution history 委托无 Workflow 调用（同文件 `:1524`、`:1795`）。 | 删该 raw adapter；保留公开 execution history owner。 | — |
| C3-098 | `src/composition/create-platform.ts:1604` | function | D2 | 具体 workspace access.release 只设置布尔值，没有可失败 IO（`src/core/workspace/access.ts:147`）。 | 删 release 的 catch，保留 finally release。 | — |
| C3-099 | `src/composition/create-platform.ts:2028` | function | D2 | 这是启动 reconcile.probe 的关闭 fallback；启动 reconcile 在 Host 返回前完成，新增 scope 的请求又在 platform.close 前排空（`src/app/host.ts:1069`、`:1127`、`:1617`、`:1628`）。 | 收窄启动专用端口，删该不可达关闭回调；保留 probe 和通用 close gate。 | — |
| C3-100 | `src/composition/create-platform.ts:2045` | function | D2 | reconcileRun 的关闭 fallback 受同一启动顺序保证（`src/app/startup-reconcile.ts:339`；`src/app/host.ts:1069`、`:1628`）。 | 同 C3-099，删此专用 fallback，不删 reconcileRun。 | — |
| C3-101 | `src/composition/create-platform.ts:2055` | function | D2 | reconcileQuery 的关闭 fallback 受同一顺序保证（`src/app/startup-reconcile.ts:365`；`src/app/host.ts:1069`、`:1628`）。 | 同 C3-099，删此专用 fallback。 | — |
| C3-102 | `src/composition/create-platform.ts:2060` | function | D2 | reconcileControls 的关闭 fallback 受同一顺序保证（`src/app/startup-reconcile.ts:420`；`src/app/host.ts:1069`、`:1628`）。 | 同 C3-099，删 `:2061` 的专用 fallback。 | — |
| C3-103 | `src/core/workspace/analysis-runner.ts:133` | function | F | 分析器提前关闭 stdin 可产生管道 error；监听防止其成为未处理事件（同文件 `:133`、`:137`）。 | P：足量合法输入→分析器提前关闭 stdin／退出→验证 runner 的退出结果；扩展 `tests/data/analysis-runner.test.ts:192`。 | — |
| C3-104 | `src/core/workspace/analysis-runner.ts:340` | function | D2 | writeInput 的写入、等待和 end 均收敛管道错误；生产 config 由 JSON 数据组成（同文件 `:137`、`:139`、`:159`；`src/core/workspace/architecture-language-provider.ts:254`）。 | 删 writeInput 外层 catch；保留 stdin error 监听及退出判断。 | — |
| C3-105 | `src/core/workspace/capture.ts:341` | function | D1 | frozen sourceIdentity 仅为宽接口补齐；实际内置 import providers 读取 inventory/read，不读取身份（`src/core/workspace/architecture-language-provider.ts:222`、`:242`、`:287`）。 | 收窄 provider 所需 source 接口，删这个未消费回调；不删 capture 自身身份。 | — |
| C3-106 | `src/core/workspace/capture.ts:427` | function | F | light-scan 失败且 issues 已非空时，需要检查是否已有同配置问题（同文件 `:378`、`:390`、`:427`）。 | 真实 capture 配显式 config 和一个 skipped 文件→既有 language fault→验证配置 issue 不重复；扩展 `tests/data/S8E-A11-lightscan-fault.test.ts:34`。 | — |
| C3-107 | `src/core/workspace/capture.ts:590` | function | D2 | task 已在内部把 run 的异常转换成 WorkspaceResult；finally 只删除 Set 项（同文件 `:583`、`:584`、`:590`）。 | 删 finally 后 catch，保留 inFlight 清理。 | — |
| C3-108 | `src/core/workspace/capture.ts:616` | function | G | changedPaths 是公开 capture 请求字段，非空数组执行该校验（同文件 `:606`、`:616`）。 | 首次 capture→修改文件→再次 capture 携带 changedPaths；另测非法相对路径；归入 `tests/data/workspace-capture.test.ts:158`。 | — |
| C3-109 | `src/core/workspace/cpp-source-index.ts:65` | function | F | 外部解释器提前关闭输入会产生 stdin error（同文件 `:61`、`:65`）。 | cpp 查询使用 pythonPath wrapper→真实子进程早退／关 stdin→输入管道失败；采用 P，归入 `tests/data/cpp-source-index.test.ts:97`。 | — |
| C3-110 | `src/core/workspace/git-read.ts:134` | function | F | Git 子进程真实超时触发终止回调（同文件 `:134`）。 | 公开 Git 比较→J 挂起本次真实 cat-file→超时→验证取消及进程回收；归入 `tests/data/R2e-git-operations.test.ts:47`。 | — |
| C3-111 | `src/core/workspace/git-read.ts:162` | function | F | Git 启动的 error 事件可由 ENOENT/EACCES 触发（同文件 `:162`、`:192`）。 | 公开 Git 读取→J 令本次启动使用不存在／不可执行程序→验证 unavailable。 | — |
| C3-112 | `src/core/workspace/git-read.ts:162` | function | F | 上一 error 处理中的 finish/reject 回调，同一真实故障（同文件 `:162`）。 | 与 C3-111 共用故障用例，验证 promise 收敛及清理。 | — |
| C3-113 | `src/core/workspace/git-read.ts:170` | function | F | Git 批量输入期间子进程退出，可发生 stdin error（同文件 `:170`）。 | J：真实 batch-check 正在输入→关闭／终止子进程→继续放行写入，验证 EPIPE 被收敛；沿 `tests/data/R2e-git-operations.test.ts:59`。 | — |
| C3-114 | `src/core/workspace/git-read.ts:192` | function | F | probe Git 失败的 catch 调用此原因转换（同文件 `:219`、`:273`）。 | 公开 Git source/compare→J 注入启动失败→验证 unusable 原因；可与 C3-111 共用。 | — |
| C3-115 | `src/core/workspace/git-read.ts:681` | function | G | 混合 Git/工作树比较遇到不能表示为文本的正常文件，会映射 unsupported（同文件 `:636`、`:683`）。 | Git commit→工作树放 NUL 二进制文件→compareWorkspace(git, working_tree)；归入 `tests/data/R2e-text-boundaries.test.ts:18`，增加混合比较入口。 | — |
| C3-116 | `src/core/workspace/python-source-index.ts:83` | function | F | Python 分析子进程提前关闭管道的真实错误（同文件 `:83`）。 | P：合法较大查询输入→wrapper 关闭 stdin／早退；扩展既有解释器包装场景 `tests/data/python-source-index.test.ts:212`。 | — |
| C3-117 | `src/core/workspace/source-index.ts:76` | function | 待定 | host.readFile 是否被语言服务调用取决于固定 TS 版本；本地代码同时提供 getScriptSnapshot，不能据零覆盖断言 readFile 无用（同文件 `:75`、`:81`；`package-lock.json:10`）。 | 保留；查 TS 6.0.3 对该 host 的实际调用链，找出可达 query，或证明当前 options 下永不调用。 | — |
| C3-118 | `src/core/workspace/source-index.ts:78` | function | 待定 | readDirectory 交给 TS；noLib/types 限制不足以单独证明库不会调用它（同文件 `:69`、`:78`、`:81`）。 | 同 C3-117，核对固定版本的目录扫描触发条件后再定 D1/D2/G。 | — |
| C3-119 | `src/core/workspace/source-index.ts:79` | function | 待定 | 未执行的是 token 的 throwIfCancellationRequested 回调；库可能只轮询另一方法，需库源码证据（同文件 `:79`、`:82`）。 | 保留；核对 TS 6.0.3 token 包装与同步执行期间的取消检查，不用直接调用私有回调凑覆盖。 | — |
| C3-120 | `src/core/workspace/source-query.ts:21` | function | G | calls 查询结果在统一转换中进入 toCallRelation（同文件 `:38`）。 | 捕获含真实函数调用的 TS 文件→querySource(calls)→断言 relation；归入 `tests/data/workspace-capture.test.ts:384`。 | — |
| C3-121 | `src/core/workspace/typescript-light-scan.ts:70` | function | 待定 | 配置异常文本经该正则脱敏，但尚未证明 TS 6.0.3 的可达诊断会带匹配的 `/workspace/` 路径（同文件 `:205`、`:211`；`src/core/workspace/typescript-source-query.ts:127`）。 | 保留；核对固定版本 missing-extends 等诊断，确认含该路径后用真实 tsconfig 触发；不能人工替换错误文本当作生产证据。 | — |
| C3-122 | `src/core/workspace/typescript-source-query.ts:109` | function | G | 配置解析的 readDirectory 接收 include/exclude，非空 excludes 执行该谓词（同文件 `:106`、`:120`）。 | tsconfig 含 include 和实际命中的 exclude→capture/query→断言排除文件；扩展 `tests/data/typescript-source-query.test.ts:149`。 | — |
| C3-123 | `src/core/workspace/typescript-source-query.ts:282` | function | 待定 | 这是语言服务 host 的第二套 matches；配置解析使用的是 `:102`，不能拿 tsconfig 测试证明此函数可达（同文件 `:280`、`:305`）。 | 保留；查 TS 6.0.3 是否及何时调用该 host.readDirectory。 | — |
| C3-124 | `src/core/workspace/typescript-source-query.ts:286` | function | 待定 | 第二套 readDirectory 仅由 `:305` 委托，需证明语言服务调用（同文件 `:286`、`:305`）。 | 同 C3-123；若固定版本永不调用，连同辅助函数删除。 | — |
| C3-125 | `src/core/workspace/typescript-source-query.ts:286` | function | 待定 | 此 filter 嵌在上一未证实可达的 readDirectory 中（同文件 `:286`）。 | 同 C3-123；可达证明还需非空 installed 文件集。 | — |
| C3-126 | `src/core/workspace/typescript-source-query.ts:287` | function | 待定 | extensions.some 依赖语言服务进入第二套目录读并传非空扩展名（同文件 `:287`、`:305`）。 | 查固定版本调用参数；不能直接调用 callback 作为行为测试。 | — |
| C3-127 | `src/core/workspace/typescript-source-query.ts:289` | function | 待定 | includes.some 同样依赖第二套语言服务目录读（同文件 `:289`、`:305`）。 | 同 C3-123，证明真实 query 的调用及 includes 参数。 | — |
| C3-128 | `src/core/workspace/typescript-source-query.ts:289` | function | 待定 | excludes.some 还要求库传入非空 excludes；配置解析的 excludes 是另一套回调（同文件 `:109`、`:289`）。 | 核对库调用参数后定；不能把 C3-122 的场景直接套过来。 | — |
| C3-129 | `src/core/workspace/typescript-source-query.ts:305` | function | 待定 | host adapter 交给 createLanguageService，仓库内部没有直接调用（同文件 `:305`、`:307`）。 | 用 TS 6.0.3 源码确定调用链；有生产 query 则 G，无调用则删整套重复目录 helper。 | — |
| C3-130 | `src/core/workspace/workspace-change-capture.ts:71` | function | G | 正常工作区超过 capture 的变更上限会抛内部容量异常并调用 detailOf（同文件 `:29`、`:331`、`:338`）。 | 真实 Git baseline→修改超过 2000 个文件→captureWorkspaceChange→断言 too_many_changes；归入 `tests/runtime/K3-40-workspace-change-capture.test.ts:108`。 | — |
| C3-131 | `src/core/workspace/workspace-change-capture.ts:243` | function | G | 合法非空 deniedPrefixes 会执行规范化后的 filter（同文件 `:231`、`:243`）。 | 真实 Git 工作区→readWorkspaceBaseline 设置非空 deniedPrefixes→验证受保护路径不入 dirty；归入 `tests/runtime/K3-40-workspace-change-capture.test.ts:104`。 | — |
| C3-132 | `src/core/workspace/workspace-change-capture.ts:244` | function | G | 非空 protectedPrefixes 与实际 tree/current paths 触发 some（同文件 `:243`、`:247`、`:249`）。 | 与 C3-131 共用用例，包含受保护和可见两类真实文件。 | — |
| C3-133 | `src/core/workspace/workspace-read.ts:127` | function | G | 对比两次 capture，存在新增文件就执行 added.map（同文件 `:127`；`src/core/workspace/capture.ts:746`）。 | capture S1→新增文件→capture S2 指定 previous S1→读变化；扩展 `tests/data/workspace-capture.test.ts:158`。 | — |
| C3-134 | `src/core/workspace/workspace-read.ts:127` | function | G | 对比两次 capture，存在删除文件就执行 deleted.map（同文件 `:127`；`src/core/workspace/capture.ts:746`）。 | capture S1→删除文件→capture S2 指定 previous S1→读变化；扩展 `tests/data/workspace-capture.test.ts:158`。 | — |

分类计数如下；待定单列，未强塞入六类。统计范围为完整 C3 清单（`lists/list-C3.tsv:2`；`lists/list-C3.tsv:135`）。

| class | 数量 |
|---|---:|
| D1 走不到 | 22 |
| D2 不会发生 | 29 |
| U 只有篡改才会发生 | 0 |
| F 外部故障 | 36 |
| G 公开步骤能到、没测 | 33 |
| N 不适用 | 0 |
| 待定 | 14 |
| **合计** | **134** |

**针对 T 的发现：本组没有可列入该项的 A 行。** 这些函数在 T 前后都未覆盖；因此不能为它们编造“被 T 删除的最后一个测试”、T item 或恢复步骤，也不能据此宣称 T 的其他删除理由正确。覆盖映射把 lost-in-T 的六个函数单列在其他文件中（`lists/list-C3.tsv:2`；`lists/list-C3.tsv:135`；`ref/mapped-summary.txt:86`、`:87`）。

**L-2 与本组的行交集为空，故没有本组 row/class 可回填。** L-2 的具体位置属于 activity-read-helpers、plan-readers、plan-validation、review 结算守卫及 query-run-recovery，不是本表这些函数；依据分别为 `ref/t-end-list.md:22`、`evidence/books/t-w2b-findings.md:132`、`evidence/books/t-items-T1-w2.md:394`、`:452`、`evidence/books/t-items-T2-w2.md:75`、`evidence/books/t-w1r1-findings.md:40`、`evidence/books/t-w1-findings.md:135`。