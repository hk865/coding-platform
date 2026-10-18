**本轮不能判为“A–K 全部完成，BLOCKED none”。** 读取计数、Host reader、双后端重启、完整 capture 的并发计数及多数断言迁移已修好；但 A 的测试路径、B 的真实回调、部分取消覆盖仍不符合冻结要求，另有 **1 条 ledger 弱化、17 个新增规则实例、3 类生产问题**。

本次未写文件、未运行测试、未等待 bubblewrap。副本没有 `.git`，标签身份无法独立验证；以下依据所给 diff、ledger 与当前源码。运行数量、RED/GREEN、bubblewrap 失败归因均属 **STATIC／未独立验证的声明**，不作为通过证据。

以下简称均指当前文件；“旧”行号指输入中的历史定位。

| 简称 | 文件 |
|---|---|
| Svc | [architecture-service.ts](D:/cxt/s8l8-review4/src/core/work-graph/architecture/architecture-service.ts) |
| Asm | [context-assembler.ts](D:/cxt/s8l8-review4/src/core/agent-runtime/context-assembler.ts) |
| Brief | [continuation-brief-assembly.ts](D:/cxt/s8l8-review4/src/core/agent-runtime/continuation-brief-assembly.ts) |
| Prep | [execution-preparation.ts](D:/cxt/s8l8-review4/src/core/agent-runtime/execution-preparation.ts) |
| Anomaly | [session-anomaly-facts.ts](D:/cxt/s8l8-review4/src/core/agent-runtime/session-anomaly-facts.ts) |
| Facts | [architecture-reminder-facts.ts](D:/cxt/s8l8-review4/src/composition/architecture-reminder-facts.ts) |
| Platform | [create-platform.ts](D:/cxt/s8l8-review4/src/composition/create-platform.ts) |
| Driver | [auto-capture-driver.ts](D:/cxt/s8l8-review4/src/app/auto-capture-driver.ts) |
| Start | [S8A-L8-capture-start.test.ts](D:/cxt/s8l8-review4/tests/app/S8A-L8-capture-start.test.ts) |
| Obs | [S8A-L8-observation-state.test.ts](D:/cxt/s8l8-review4/tests/work-graph/S8A-L8-observation-state.test.ts) |
| Pub | [S8A-L8-reminders-public.test.ts](D:/cxt/s8l8-review4/tests/work-graph/S8A-L8-reminders-public.test.ts) |
| Count | [S8A-L8-read-counts.test.ts](D:/cxt/s8l8-review4/tests/work-graph/S8A-L8-read-counts.test.ts) |
| World | [S8A-L8-reminder-world.ts](D:/cxt/s8l8-review4/tests/helpers/S8A-L8-reminder-world.ts) |
| H4 | [S8A-L8-prepare.ts](D:/cxt/s8l8-review4/tests/helpers/S8A-L8-prepare.ts) |
| Gate | [S8A-L8-auto-capture-gate.test.ts](D:/cxt/s8l8-review4/tests/app/S8A-L8-auto-capture-gate.test.ts) |
| HostTest | [S8A-L8-host-close-restart.test.ts](D:/cxt/s8l8-review4/tests/app/S8A-L8-host-close-restart.test.ts) |
| HostHelper | [S8A-L8-host.ts](D:/cxt/s8l8-review4/tests/app/support/S8A-L8-host.ts) |
| AutoHost | [S8A-L8-auto-capture-host.test.ts](D:/cxt/s8l8-review4/tests/app/S8A-L8-auto-capture-host.test.ts) |
| Restart | [S8A-L8-host-restart.test.ts](D:/cxt/s8l8-review4/tests/app/S8A-L8-host-restart.test.ts) |
| PASS | [S8A-L8-pass-capture.test.ts](D:/cxt/s8l8-review4/tests/composition/S8A-L8-pass-capture.test.ts) |
| HTTP | [S8A-L8-http-watermark.test.ts](D:/cxt/s8l8-review4/tests/app/S8A-L8-http-watermark.test.ts) |
| Scope | [S8A-L8-chunk-scope.test.ts](D:/cxt/s8l8-review4/tests/work-graph/S8A-L8-chunk-scope.test.ts) |
| CodecTest | [S8D-observed-v2-codecs.test.ts](D:/cxt/s8l8-review4/tests/data/S8D-observed-v2-codecs.test.ts) |
| OldFmt | [S8E-old-format-rejection.test.ts](D:/cxt/s8l8-review4/tests/data/S8E-old-format-rejection.test.ts) |

**1. §3 A–K：逐 ID／定位项**

`fixed` 表示静态实现和所要求的测试形状成立，不表示本次运行通过。裁定 5 明确免除公共路径不可达 replay 的测试要求，相关生产分支按静态核验判断。

**A — Production**

| ID | 结论、修复与证明 |
|---|---|
| B-1 | **partly**。五个 owner 已加 throw/reject＋abort 转 cancelled：Svc:1255、1340、1422、1445、1489。有效公开读证明为 Start:798、818；三个写 owner 的新增证明使用手造内部命令，不能算通过。capture 总 catch 另有清理时序问题，见 §4。 |
| B-2 | **partly**。非 committed＋abort 已优先 cancelled，request 不再冲突重试：Svc:1240、1335、1411。Start:458、584、738 的证明路径不合规。 |
| B-3 | **fixed／STATIC**。Svc:1246、1326、1417 取得 committed receipt 后，late restore 成功、失败、throw 均不再改 cancelled；恢复点为 :1248、1328、1419。request/fail replay 按裁定 5 留 T，不要求手造命令证明；新增的违规 replay 测试另列 §3。 |
| C-1 | **fixed**。Asm:1152 直接透传 upstream 的显式 cancelled。Pub:252、269 经真实公开 prepare，分别覆盖 signal 未置位的显式取消和在途取消，:262、285 检查 0 put。 |
| P05 | **partly**。Svc:1289、1296、1309、1321、1335、1341 的取消处理已修；Start:561–704 仍手造 request 命令。真实 Driver acceptance 的原 signal 又不会被 Host close 取消，必须报告入口限制，不能用这些行替代。 |
| P06 | **partly**。Svc:1374、1381、1392、1406、1414、1423 已修；Obs:849、873 保留真实 driver failure snapshot 的取消证明。新增 Start:708、738、772 手造 failure，不能补足本轮要求。 |
| P07 | **fixed**。Svc:1440 后检查、:1445 catch；Obs:881、891 覆盖返回期间取消，Start:798、814 覆盖 throw＋abort。 |
| P08 | **fixed**。Svc:1468、1475、1480 后检查，:1487 ready 前检查，:1489 catch。Obs:896、906、916 分别覆盖 basis/current/previous，Start:818、834 覆盖 basis throw＋abort。 |
| P09 | **partly**。Svc:1006、1009 和 :1255 修了 early lookup/restore 的取消；Obs:925、945、948 保留合法手动 replay 的取消及状态不变。新增 throw 证明 Start:416 使用内部 watermark，不能作为合格公共路径证据。 |

A 的**整个裁定 4 范围仍未完成**，不能因 C-1 单点已修就宣称整行完成。

| 裁定 4 的 await | 当前合格测试实际到达情况 |
|---|---|
| Facts:25 catalog | 没有逐位点的公开 `prepareExecution` 取消测试。 |
| Facts:28、33 observed | 没有逐位点的公开 prepare 取消测试。 |
| Svc:1514 observation basis | Obs:951 是直接 facts 读取，不是公开 prepare＋0 put 证明。 |
| Svc:1524 latest load | Obs:962 同上。 |
| Svc:1536 previous load | Obs:974 同上。 |
| Asm:1099 reminder | **有**：Pub:193 ready＋abort；:213 throw＋abort；:235 signal 未置位的显式 cancelled；均检查 0 put。 |
| Asm:1139 upstream facts | **有**：Pub:252 显式 cancelled；:269 ready＋abort；均检查 0 put。 |
| Asm:1169 input page | **有**：Pub:292 显式 cancelled；:309 ready＋abort；均检查 0 put。 |
| Asm:942 continuation basis | **缺本轮取消行**。 |
| Asm:967、976 previous Turn | **缺本轮取消行**。 |
| Brief:320 Turn bounds | **缺本轮 signal 取消行**；该 port 没有显式 cancelled 类型，不应伪造。 |
| Brief:181 每页 window；:224、255 包装层 | **缺本轮取消行**。 |
| Asm:809 workspace resolveRoot | **缺 signal／显式 cancelled 行**。 |
| Asm:820 captureDigest | **缺 signal 取消行**；无显式 cancelled 类型。 |
| Asm:827 workspace capture | **缺 signal 取消行**；不能伪造底层结果类型。 |
| Asm:981 workspace helper | **缺独立边界行**。 |
| Asm:880 session-basis window | **缺 signal／显式 cancelled 行**。 |
| Asm:991 session helper、:1207 brief assembly | **缺独立边界行**。 |
| Prep:286 assembler | **缺独立 assembler 返回／throw／显式取消边界行**；下层取消经过它不等于单独证明这一边界。 |
| Prep:326 material put | **有**：Pub:332，真实 put 完成后持有结果再 abort，:343、347 为 1 put，:346 要求 cancelled。 |

UNSPECIFIED 2 的准确说法只能是“**当前 reminder fixture 没建立 requeue 前置**”，不是“公共步骤到不了”。现存公开路径：

`tasks/requeue` → `claims.requeueTask` → Workflow claim/prepare → Asm:1203 的 `requeueRef` 分支。

具体证据在 [A2-requeue-platform.test.ts:501](D:/cxt/s8l8-review4/tests/composition/A2-requeue-platform.test.ts:501)：真实首轮、requeue、`advanceUntil(...,'prepare')`，随后 :509 调公开 prepare。跨 Session 的 :563 unlink、:569 archive、:574 requeue、:576 推进、:587 `other_session_seeded`，对应 Asm:991 → :880。这些取消例应建立；缺 bwrap 是运行限制，不是路径豁免。

另一个确实存在的入口限制是 **requestAutoCapture 原 signal**：Driver:109 每次新建 controller，只取 signal，不保留 controller；:262、265、274 三种触发均不接 caller signal；close:299 只 abort running capture。因此现成 Host close 不会取消 acceptance 的原 signal。这里应给 lead 报具体 BLOCKED／取消注入接缝选项，不能直接构造内部 request。

**B — 真实提交回调**

以下九处都改成了 fixture 的 `fireTrigger`，但没有经过生产 composition 回调：Obs:192／217 → :174 → :222。真正生产路径是 Platform:1200／1209 → :918。删除生产通知，这批测试仍可通过，因而 **differently，不等价，计 partly**。

| ID／旧定位 | 结论与当前证据 |
|---|---|
| K4-03 | **partly**。Obs:423 真 adopt，通知来自复制 wrapper。 |
| K4-04 | **partly**。Obs:454 真 adopt；:456 保留失败检查，通知仍是复制链。 |
| K4-05 | **partly**。Obs:469 真 revise，走测试自己的 :217。 |
| K4-06 | **partly**。Obs:520 运行中 adopt；:522 后检查保留，回调未接真实 composition。 |
| K4-07 | **partly**。Obs:594 的拒绝场景修订，仍走复制链。 |
| K4-08 | **partly**。Obs:604 的重试修订，仍走复制链。 |
| K4-09 | **partly**。Obs:613 的 throw 场景修订，仍走复制链。 |
| 旧 Obs:606 | **partly**。当前 Obs:584，同一复制回调问题。 |
| 旧 Obs:847 | **partly**。当前 Obs:814，T29 第二触发仍走复制回调。 |

**C — 读取调用次数和七条 facts**

| ID／旧定位 | 结论与证明 |
|---|---|
| K4-17 | **fixed**。Count:55、68 按调用计数；:103–105 保留 7 body、5 record、12。 |
| K4-18 | **fixed**。Count:96 真实 prepare；:103 固定手算 7 body；:114 恢复 latest 12 nodes。 |
| K4-19 | **fixed**。Count:118 真正增加第 13 个文件并捕获；:140 latest 13 nodes。 |
| K4-20 | **fixed**。Count:125 第二次真实 prepare；:131–133 为 15 body、6 record、21。 |
| K4-21 | **fixed**。Count:139 previous 非空；:141 previous 12 nodes；不再读库取 oracle。 |
| K4-22 | **fixed**。Count:39–42 真 reminder 窗口；:96 一次公开 prepare；record 在 :55 调用时加 1。 |
| K4-23 | **fixed**。Count:125 第二次独立 prepare；:122 清零，:129 关闭窗口。 |
| 旧 Obs:600 | **fixed**。Count:111，第一份 facts `status='ready'`。 |
| 旧 Obs:602 | **fixed**。Count:113，第一份 `state.previous=null`。 |
| 旧 Obs:603 | **fixed**。Count:114，第一份 latest nodes 为 12。 |
| 旧 Obs:623 | **fixed**。Count:137，第二份 facts `status='ready'`。 |
| 旧 Obs:625 | **fixed**。Count:139，第二份 `state.previous` 非 null。 |
| 旧 Obs:626 | **fixed**。Count:140，第二份 latest nodes 为 13。 |
| 旧 Obs:627 | **fixed**。Count:141，第二份 previous nodes 为 12。 |

**D–K**

| 行／ID或旧定位 | 结论与证明 |
|---|---|
| D／T18 | **fixed**。HostTest:205 等 B 真正进入 capture，:220 检查 `>0`；真实 close 后再重启。 |
| D／T19 | **fixed**。HostTest:235 双后端；:251 第二 Host 只绑定 A；等待 A 启动重试完成后，:268–271 核对 B 未变且进入数未增。 |
| D／旧 Gate:309 | **fixed**。HostTest:235 恢复 memory＋SQLite；HostHelper:97–115 共享真实 backend，物理关闭由 world 最终负责。 |
| D／旧 Gate:331 | **fixed**。HostTest:220 恢复 B 进入次数 `>0`，:271 检查重启后不变。 |
| E／K4-24 | **fixed**。H4:40 真 prepare；:45–47 用原 Host ctx、`historical_explanation` 打开材料；Count:96、125 和 Pub 成功行经过它。 |
| E／T15 | **fixed**。World:531–536 走共同 H4／公开 prepare；未重引 Role facts 替身。 |
| E／T28 | **fixed**。H4:45 使用实际平台 material owner；Count:78 双后端覆盖实际链。 |
| F／K5-01 | **fixed**。HostTest:73 等 entered；:87 在 close 前建立 abort 等待；:88–92 close；:111–115 公开读。 |
| F／K5-02 | **fixed**。HostTest:119–133 同 SQLite 新 Host 自动重试 A/B，seq2、startup_retry、current 检查保留。 |
| F／T20 | **partly**。AutoHost:54–61 加了真实 adoption 完成边界；但把 replay 后原 `requestSeq:1` 检查换成 adoption 后的 `2`，不满足冻结 ledger 的保留要求。 |
| F／T22 | **fixed**。PASS:207 计真实唯一 sink；:427 控制触发加 1；:431–436 replay 不增；:437–442 公开状态检查保留。 |
| F／V§3 实例4 | **fixed**。HostHelper:200–202 的 entered Promise 替代内部 gate 定时轮询。 |
| F／V§3 实例5 | **fixed**。HostHelper:318–325 先查 aborted／监听 abort；HostTest:87 在 close 前挂好。 |
| G／T24 | **fixed**。Gate:87–99 覆盖整个真实 `captureObservation`；:299 等 B 进入；:300、307 检查整体 `maxActive=1`。 |
| G／V§3 实例7 | **fixed**。同上，计数已从 resolveRoot gate 移到完整 capture。 |
| H／V§3 实例1 | **partly**。Obs 内部 request replay 已删，但 Start:636、662、686 重新建立同类禁止路径。 |
| H／V§3 实例2 | **fixed（指定 replay 删除）**。Obs 内部 fail replay 已删；Start 新增手造非 replay failure 是另一个新增规则命中。 |
| H／V§3 实例3 | **partly**。Obs 自动 watermark replay 已删，但 Start:533–558 又引入。 |
| H／旧 Obs:415–417 | **fixed（删除动作）**。旧 first automatic replay 删除；普通首次状态保留在 Obs:410–416。 |
| H／旧 Obs:441–442 | **fixed（删除动作）**。旧第二次 automatic replay 删除；正常第二次 capture 关系保留于 Obs:425–433。 |
| H／旧 Obs:615–617 | **fixed（删除动作）**。旧 mappings＋内部 identity replay 删除；普通 adoption 后状态保留于 Obs:586–589。 |
| I／V§3 实例8 | **fixed**。HTTP:29 `rejects:`；:45–49 单一 requestSeq 拒绝；:54–55 公开状态未变；成功行另留在 :60。 |
| I／V§3 实例9 | **fixed**。Scope:515 `rejects:`；:526–527 单一跨项目错误；:530–533 双方公开 current 未变。 |
| J／旧 Pub:504 | **fixed**。Pub:239 包真实 reader；:242 signal 未置位；:244 rejected/cancelled；:245 为 0 put。 |
| J／旧 Pub:505 | **partly**。没有恢复明列的 `input=null` 检查。新行只检查公开 rejection 和 put 数；不能声称同主体、同字面检查已恢复，也不应给公开 rejection 凭空添加 input 字段。 |
| K／旧 Restart:55 | **fixed／STATIC**。Restart:57 await close，:58–62 同库公开读；原状态／capture 检查仍在。 |
| K／旧 Restart:116 | **fixed／STATIC**。Restart:107 已等 seq3 完成，:112 close，:117–121 同库公开核对未再变化。 |

手动 capture replay 的保留要求已满足：Obs:925–949；当前 helper :393–397 不带内部 `requestSeq`。

K 的 close 会停止队列，不能泛称“保证所有 capture 成功完成”。不过当前 startup 状态读取经过同步 SQLite transaction 包装的 async 调用，HostHelper:147–149 又在返回前 await listen/fetch/text；未找到当前实际路径漏完启动扫描的证据。本轮不据抽象调度假设另报 F11。

**2. 两份 ledger，逐行结论**

**`d1-round.txt`：21 条**

| # | 旧位置 | 分类与当前去向 |
|---:|---|---|
| 1 | Gate:243 | **required G／T24**。内层 `maxActiveWhileBQueued=1` 改为完整 capture 高水位；Gate:299 等 B entered，:300 仍断言 1。 |
| 2 | Gate:254 | **required G／T24**。最终整体高水位检查仍在 Gate:307，字面 1 保留。 |
| 3 | AutoHost:51 | **weakening**。replayed registration 后 `{requestSeq:1,pending:false}` 消失；AutoHost:54–59 先进行新 adoption，再检查 seq2。主体和字面都改变，F 只要求替换等待方式。 |
| 4 | Restart:58 | **equivalent move**。Restart:58 调 HostHelper:254 的公开读取；:255 明确判断 `status !== 'ready'` 即 throw，:256 才取 value。 |
| 5 | Restart:60 | **equivalent move**。Restart:61，同一重启后状态仍为 `{requestSeq:1,pending:false}`。 |
| 6 | Restart:61 | **equivalent move**。Restart:62，同一 current captureId 仍等于原 captureId。 |
| 7 | Restart:114 | **equivalent move**。Restart:117–119 同样经过 HostHelper:254–256 的 ready 守卫。 |
| 8 | Restart:115 | **equivalent move，并加强**。Restart:120 保留 seq3，加 trigger/pending；:121 核 captureId 未变。 |
| 9 | Scope:498 | **required I**。移至 Scope:526–527，仍以 A 读 B 的 captureRef，`rejected` 保留并精确到 forbidden；:530–533 增状态未变。成功读取仍在 :493–496、509–512。 |
| 10 | Obs:417 | **required H／裁定5**。删除手造内部 first capture replay 的 committed/replayed 检查。 |
| 11 | Obs:443 | **required H／裁定5**。删除第二次内部 automatic replay 的 committed/replayed 检查。 |
| 12 | Obs:445 | **required H／裁定5**。该 `replay.value` 只属于被禁止的内部 replay。 |
| 13 | Obs:449 | **required H／裁定5**。主体是不可达内部 replay 后的 `afterReplay.current`；正常第二次 capture 的指针关系仍在 Obs:425–431。 |
| 14 | Obs:450 | **required H／裁定5**。主体是同一非法 replay 后的 `afterReplay.autoCapture`，随整段删除。不能把任意公开读到相同字段值当作原 replay 主体仍可达。 |
| 15 | Obs:617 | **required H／裁定5**。删除用 adoption mappings 拼内部 capture identity 的 replay。 |
| 16 | Obs:889 | **required H／裁定5**。旧 :883–889 明确被裁定删除：手造 request 的初始 committed 检查。 |
| 17 | Obs:909 | **required H／裁定5**。内部 request replay 后 `after=before`，随不可达场景删除。 |
| 18 | Obs:983 | **required H／裁定5**。失败记录本身来自真实 driver，但其后精确重发内部 failure command 不可达，replay 后不变检查随行删除。 |
| 19 | HTTP:26，test | **required I，成功分支保留**。拒绝在 HTTP:29–57；成功独立放在 :60–82，:74 committed、:78 新 capture、:80 原 seq/pending 检查仍在。 |
| 20 | Obs:881，P05 test | **required H／裁定5**。整行建立并重放内部 request command，删除获授权。 |
| 21 | Obs:944，P06 test | **required H／裁定5**。删除内部 failure replay；相邻真实 failure snapshot 取消行未删。 |

**旧 Obs:881–983 没有把应保留的公开 snapshot 行一起删除。** 旧 :912–941 当前在 Obs:849–879：真实 root 故障 → driver → failure snapshot gate → close/abort → 公开读仍为 seq1/requested/failure:null。它与旧 :944 的内部 failure replay 是两个不同场景。

本轮 ledger：**1 条 weakening**。`MOVED: 8` 是检测器汇总，不是另有八条待逐项裁定的删除行。

**`d1-cumulative.txt`：15 条**

| # | 旧位置 | 分类与当前去向 |
|---:|---|---|
| 1 | CodecTest:87 | **required rework-2 A／K1-01、K1-06**。当前 :93 精确空图比较加入 scope，schemaVersion 仍为 2。 |
| 2 | CodecTest:111 | **required rework-2 A／K1-06**。当前 :117，同一 `[0,1]`、nodeCount=1 仍 invalid，只补 scope。 |
| 3 | CodecTest:112 | **required rework-2 A／K1-06**。当前 :118，同一 `[0]` 边仍 invalid。 |
| 4 | CodecTest:113 | **required rework-2 A／K1-06**。当前 :119，同一 `[0,1.5]`、nodeCount=2 仍 invalid。 |
| 5 | CodecTest:114 | **required rework-2 A／K1-06**。当前 :120，同一 `[-1,0]` 仍 invalid。 |
| 6 | CodecTest:117 | **required rework-2 A／K1-06**。当前 :123，同一 `[0,1]` 不传 nodeCount 时仍 decoded。 |
| 7 | CodecTest:122 | **required rework-2 A／K1-06**。当前 :128，同一坏 digest 仍 invalid；输入仅补必需 scope。 |
| 8 | CodecTest:130 | **required rework-2 A／K1-06**。当前 :136，空 specifier 仍 decoded。 |
| 9 | CodecTest:132 | **required rework-2 A／K1-06**。当前 :138，validator 的 4096 字符仍 decoded。 |
| 10 | CodecTest:133 | **required rework-2 A／K1-06**。当前 :139，validator 的 4097 字符仍 invalid。 |
| 11 | CodecTest:134 | **required rework-2 A／K1-06**。当前 :140，JSON decoder 的 4096 字符仍 decoded。 |
| 12 | CodecTest:135 | **required rework-2 A／K1-06**。当前 :141，JSON decoder 的 4097 字符仍 invalid。 |
| 13 | CodecTest:140 | **required rework-2 A／K1-06**。当前 :146，同一重复节点、nodeCount=2 仍 invalid。 |
| 14 | OldFmt:54 | **required rework-2 A／K1-06、裁定8**。当前 :55–57 带 scope 新形状 decoded；:60–61 无 scope 旧形状 invalid。此处不能继续保留旧形状 decoded。 |
| 15 | OldFmt:64 | **required rework-2 A／K1-06**。当前 :70，同一 schemaVersion=1 仍 invalid，仅增加 expected scope 参数。 |

累计 ledger：**0 条 weakening**。不能用它的零弱化掩盖本轮 ledger 发现的 1 条。

**3. 全部 ADDED 行的规则复扫**

核对了 **1,564 条 added 行：生产 199、测试及 helper 1,365**；本轮 diff 没有新建文件，19 个修改文件全部纳入。没有把旧文件未改的债务扩大为本轮必修。

新增规则实例按“一个参数化 case 算一个，两后端不重复计；共享违规 helper 不再额外计”计数：

| # | 新增位点 | 规则与问题 |
|---:|---|---|
| 1 | Start:416；调用 :428–429 | **F1/F3**。`captureBody` 自造内部 `requestSeq=1`。 |
| 2 | Start:437；调用 :449–450 | **F1/F3**，同一内部 watermark 构造。 |
| 3 | Start:458；调用 :473–474 | **F1/F3**，同上。 |
| 4 | Start:482；调用 :502–503 | **F1/F3**，同上。 |
| 5 | Start:514；调用 :524–525 | **F1/F3**，同上。 |
| 6 | Start:533；调用 :543–549 | **F1/F3，裁定5**。重放手造 automatic capture 命令。 |
| 7 | Start:561；调用 :573–574 | **F1/F3**。测试构造内部 request，而非真实 driver 产生。 |
| 8 | Start:584；调用 :601–602 | **F1/F3**，同上。 |
| 9 | Start:615；调用 :625–626 | **F1/F3**，同上。 |
| 10 | Start:636；调用 :652–656 | **F1/F3，裁定5**。重复内部 request，再用 lookup miss 强行到 late replay。 |
| 11 | Start:662；调用 :676–680 | **F1/F3，裁定5**，同上。 |
| 12 | Start:686；调用 :700–704 | **F1/F3，裁定5**，同上。 |
| 13 | Start:708；调用 :718、727 | **F1/F3/F6**。手造 request，并用 :400–403 构造 failure/revision/原因。 |
| 14 | Start:738；调用 :753、761 | **F1/F3/F6**，同上。 |
| 15 | Start:772；调用 :782、788 | **F1/F3/F6**，同上。 |
| 16 | Obs:170–175、192、217、222 | **default deny／F11**。复制 production trigger wrapper；没有经过待证明的生产通知链。 |
| 17 | AutoHost:54–61 | **F12**。以 adoption 后 seq2 替换登记 replay 后 seq1，见 ledger 第3条。 |

前十五个 case 在两后端展开为 **30 行测试**。Start:391–403 的 helper 名称和 :409–413 的“No … command is hand-built”注释不能改变实际路径。

A2/A3 wrapper 本体与违规公共路径需要分开判断：

| wrapper | 核验 |
|---|---|
| Start:79–111 records wrapper | 接到真实 records；正常调用透传，指定 read/lookup/commit/eventAt 可 gate、throw 或返回失败。**本体符合 A2/A3**，不能豁免上层手造命令。 |
| Start:486–497 body put | 包真实 body store；只在命名 put 点失败，其余透传。A2 形状成立。 |
| World:187–214 reminder | 真实 reader 先执行，再一次性失败／取消或 gate；符合 A2/A3。 |
| World:220–237 graph | 包真实 graph reader，只改 upstream missing-input 读；符合 A2/A3。 |
| World:241–258 input page | 包真实 input service，只改命名 page 调用；符合 A2/A3。 |
| World:341–354 prepared put | 先完成真实 put，再持有真实结果；结果原样返回，符合 A3。 |
| Gate:83–104 capture | 从真实 capture 进入到 finally 返回计数；符合 A3。 |
| HostHelper:97–115 memory factory | 共享一个真实 backend，Host 逻辑 close 照常、物理 close 延至 world 清理；符合 A4。 |

**lookup miss once** 在 Start:642、665、689 返回合法的 `StoreError/not_found`，真实 commit 产生 `replayed:true`，没有伪造 committed receipt。单看它可讨论为 A2 定点失败，不必机械另计 F2；但当前三个测试重复的是**裁定 5 明确禁止的内部 request 命令**，因此仍不接受，且已包含在上表第10–12条。

**复制 trigger wrapper** 有真实 commit 作为原因，因此不另外判“无真实原因”的 F5；问题是它复制了应由测试验证的生产行为，仍不满足 B，也不属于 A3 仅计数／门控／原样返回的授权。

**残留定时轮询**均为有界公开状态等待：

| 文件 | 位置 |
|---|---|
| Gate | :264–270 |
| Start | :194–200 |
| HostHelper | :188–194 |
| PASS | :280–288 |
| World | :559–564 |
| Scope | :302–309 |
| Obs | :350–355 |

未发现本轮新增的内部 gate/signal 定时轮询或以 sleep 证明非事件。未发现新增未授权的单后端服务行；Host restart 的 SQLite-only 有冻结依据，D 已恢复双后端。未发现新增 `skip/todo/only`、增 timeout、F7 store oracle、F8 生产常量期望值或 D3 import 命中。

**4. 本轮生产函数：调用方、await 结果和缺陷**

所有直接生产调用者如下；同名 workspace capture 工具不是本次 observed-architecture owner，已区分。

| 修改函数 | 全部直接生产调用者／消费链 |
|---|---|
| Svc.captureSourceChanges | Platform:1178；其使用者 Driver:232，以及 `core-routes.ts:662` 绑定、:926 HTTP 派发。 |
| Svc.requestAutoCapture | Platform:1180 → Driver:109；只有 committed 记录进入队列。 |
| Svc.failAutoCapture | Platform:1181 → Driver:252；后台不消费返回值，后续公开读消费记录。 |
| Svc.readAutoCapture | Platform:1182 → Driver:166，读取开始 snapshot。 |
| Svc.observationState | Platform:1183 → Driver:186、281；另由 `core-routes.ts:931` 公开派发。 |
| Asm.assembleTask | Prep:286；runtime/Platform 公开转发，Workflow:1841 调 prepare，非 ready 停止。 |
| Asm.assembleBriefForContext | Asm:1207，仅 requeue 分支。 |
| Asm.sessionBasisForContext | Asm:991；archive-origin 在 :988–989 跳过。 |
| Asm.briefWorkspaceFactsFor | Asm:981；Prep:58。 |
| Prep.briefWorkspaceFacts | Anomaly:136。自身直接转发 Promise，没有另一个 await。 |
| Brief.readBoundedWindow | Brief:224、255。 |
| Brief.readPreviousTurn | Asm:967、976；Anomaly:123。 |
| Anomaly.kernelFacts | Anomaly:174。 |
| Anomaly.worktreeFacts | Anomaly:191。 |
| Anomaly.readArchiveChangedFiles | runtime:601 转发；`session-archive.ts:244` 消费，:487 用于归档 changed-file facts。 |

新增的两个 helper outcome 类型均有生产消费者，没有新增孤儿 helper。Anomaly 的 `rejected` 类型 helper 也确实被取消分支调用。

下面 `C` 表示 `rejected/cancelled`；“throw”同时包括同步抛错和 Promise reject。

**裁定 2–3：owner await 矩阵**

共同规则：

- 尚无本次 committed receipt：正常 resolve 保持原业务分流；业务失败保持原映射；throw 在 signal 清楚时保持；resolve／throw 时 signal 已置位则 C。
- commit 返回非 committed：已取消则 C，request 不再重试；未取消保持原映射／有界冲突重试。
- commit 返回 committed：保留 committed；late restore 成功保留 replayed committed，失败保留失败，throw 保留 throw，均不受之后的 signal 改写。

| await 位点 | 当前结果与裁定符合性 |
|---|---|
| Svc:1002 capture early lookup | resolve 后 :1006 查 signal；throw 由 :1255 catch 归一。符合。 |
| Svc:1008 early restore | :1009 查 signal；未持有本次 commit receipt，取消仍应 C。符合。 |
| Svc:1026 catalog | :1027 查 signal；未取消的 not_found 仍成为空 mappings。符合。 |
| Svc:1040 watermark | :1041 查 signal；未取消保持原 request/null 分流。符合。 |
| Svc:1046 canonical scope | :1047 查 signal；未取消保持 scope/pin 检查。符合。 |
| Svc:1058 current pointer | :1059 查 signal。符合。 |
| Svc:1063 自动 previous load | :1064 查 signal。符合。 |
| Svc:1074 调用者提供的 previous load | :1075 查 signal。符合。 |
| Svc:1086 captureObservation | :1087 取消优先，但 ready capture 的资源释放被跳过，见缺陷1。 |
| Svc:1092 verify | :1093 resolve 后检查；throw 经 finally 再到总 catch，存在缺陷2。 |
| Svc:1095 export | :1096 resolve 后检查；throw 同上。 |
| Svc:1101 fileGraph | :1102 resolve 后检查；throw 同上。 |
| Svc:1113 module mapping | :1116 resolve 后检查；throw 同上。 |
| Svc:1169 main body put | :1171 resolve 后检查，已写 body 不回滚；throw 同上。 |
| Svc:1180 每个 chunk put | :1182 resolve 后检查，已写 body 不回滚；throw 同上。 |
| Svc:1192 second verify | :1193 resolve 后检查；throw 同上。 |
| Svc:1203 current record | :1204 resolve 后检查；throw 同上。 |
| Svc:1237 capture commit | 非 committed＋abort 在 :1243 返回 C；committed 在 :1246 设置 receipt 并保留。 |
| Svc:1248 capture late restore | 成功／失败／throw 均保持；receipt 为 true，不再改 C。 |
| Svc:1253 cleanup → :458 release | cleanup 自身异常被吞；外置总 catch 仍能因清理期间新发生的 abort 改写早先 throw，见缺陷2。 |
| Svc:1289 request lookup | :1294 检查；throw 由 :1341 处理。符合。 |
| Svc:1296 request early restore | :1297 检查；throw 由 :1341 处理。符合。 |
| Svc:1309 request current read | :1310 检查，:1321 提交前再查。符合。 |
| Svc:1322 request commit | committed 保留；非 committed 先 :1335 查 signal，再决定 conflict retry。符合。 |
| Svc:1328 request late restore | 成功／失败／throw 保持。符合。 |
| Svc:1374 fail lookup | :1379 检查；throw 由 :1423 处理。符合。 |
| Svc:1381 fail early restore | :1382 检查。符合。 |
| Svc:1392 failure snapshot | :1393 检查；revision guard 保留，:1406 提交前检查。符合。 |
| Svc:1407 failure commit | 非 committed＋abort 在 :1414 返回 C；committed 保留。符合。 |
| Svc:1419 fail late restore | 成功／失败／throw 保持。符合。 |
| Svc:1440 readAutoCapture | resolve 后 :1443 查 signal；throw 在 :1446 转 C。符合。 |
| Svc:1468 observation basis | resolve 后 :1470 检查；throw 在 :1490 转 C。符合。 |
| Svc:1475 current observation | :1476 检查。符合。 |
| Svc:1480 previous observation | :1481 检查；:1487 ready 前再检查。符合。 |

内部依赖也已追踪：request/pointer/observation 的 record await 在 Svc:799、812、824；basis 组合在 :846、848；restore 的 eventAt 在 :771、891；loadObservation 为 :603、609、621、639、656，每块正文在 :698。最终取消优先级由上表 owner 或 preparation 外层承担。没有增加 commit throw 后 lookup 的 lost-reply recovery。

**裁定 4：准备和共享 helper**

| await／出口 | signal 清楚时 | signal 已置位／合法显式 cancelled |
|---|---|---|
| Asm:1042 初始 graphContext | 原 ready／失败分流；throw→unavailable。 | 内层 catch :1049 不查 signal；公开 prepare 在 Prep:294 兜底。此读在 reminder 之前，不作为本轮新增缺陷。 |
| Facts:25、28、33 | 原结果；throw 交 Asm。 | resolve 后查 signal；显式 cancelled 传出；throw＋abort 被 Asm:1105 接住。 |
| Svc:1514、1524、1536 | 原 facts／失败；throw 交上层。 | resolve 后查 signal；throw 经 Facts 到 Asm，最终 C。 |
| Asm:1099 reminder | 非取消失败／throw 加一条不可用提醒。 | signal 或显式 cancelled → C。 |
| Asm:1139 upstream | 非取消失败／throw 保持可选 enrichment 回退。 | :1146、1149、1152 → C，不再吞显式 cancelled。 |
| Asm:1169 input page | 非 ready 原样返回；throw→unavailable。 | signal→C；显式 cancelled 原样返回。 |
| Asm:942 continuation basis | `mapRead` 原分流；throw→unavailable。 | :944、947 查 signal；显式 cancelled 保持。 |
| Asm:967、976 previous Turn | retry／facts 原分流；throw 交 Prep。 | typed cancelled 在 :980 返回；signal 最终由 Asm:1208、Prep:294 阻止 put。 |
| Brief:320 bounds | 原 bounds 分流；未取消 throw 保持。 | :324、329 按 signal 返回 retry/cancelled。 |
| Brief:181 page | 原 window；非取消 throw→retry/unavailable。 | :184、190 查 signal；合法显式 cancelled 在 :193–194 保持。 |
| Brief:224、255 window helper | 转换正常 window facts，保持 retry。 | 下层 retry/cancelled 透传。 |
| Asm:809 resolveRoot | 非取消失败／throw→ready/unavailable facts。 | signal／合法显式 cancelled→helper cancelled。 |
| Asm:820 captureDigest | 非取消失败／throw保留 unavailable digest。 | :823 按 signal→helper cancelled。 |
| Asm:827 workspace capture | 非取消失败／throw保留 unavailable uncommitted facts。 | :828 按 signal→helper cancelled。 |
| Asm:981 workspace helper | ready 取 value。 | helper cancelled→Core cancelled；外层另有 signal 兜底。 |
| Asm:880 session window | 非取消失败／throw仍为 ready/null。 | :883、886、889 检查 signal／显式 cancelled，不再降为 null。 |
| Asm:991 session helper | ready 取 basis/null。 | helper cancelled→Core cancelled。 |
| Asm:1207 brief assembly | 保持 helper rejection；throw 交 Prep。 | :1208 查 signal。 |
| Prep:286 assembler | 非 ready 保持；throw→unavailable。 | :290、294 signal 优先；显式 cancelled 保持。 |
| Prep:326 put | 原 capacity/unavailable 映射。 | 写前 :323 阻止调用；写中 :331、336 返回 C；不回滚已写正文。 |
| Anomaly:123 previous Turn | 非取消 throw→retry/unavailable。 | throw＋abort 已转 cancelled；但 helper 的早期 not_entered/unavailable 出口不检查 signal，见缺陷3。 |
| Anomaly:136 workspace helper | 非取消异常→ready/unavailable。 | catch 查 signal、typed cancelled 也透传；正常 ready 返回后仍缺 signal 检查。 |
| Anomaly:168 execution read | 原结果；throw→unavailable。 | **没有取消检查**，可 unavailable 或继续至 ready，见缺陷3。 |
| Anomaly:174 kernelFacts | read/not_entered 可返回 ready。 | 只识别 typed cancelled，不检查原 signal，见缺陷3。 |
| Anomaly:191 worktreeFacts | 原样返回 helper Promise 结果。 | 无额外 signal 兜底。 |

没有发现本轮把 cancelled 加进不支持它的底层 port，或者在测试里强转出这种结果：

- `StoreError` 仍无 cancelled。
- `captureDigest` 仍只有 ready/unavailable。
- workspace source capture 保留自己的结果类型。
- `readTurnBounds` 仍是 Kernel bounds 结果。
- `BriefWorkspaceFactsOutcome`、`SessionBasisOutcome` 是内部 helper 的取消表达。
- Anomaly 原公开返回类型就是 `ReadResult`，扩充本地 `rejected()` helper 的参数不等于新造 port 合同。

**生产缺陷1：capture 返回边界取消，跳过释放**

[Svc:1087](D:/cxt/s8l8-review4/src/core/work-graph/architecture/architecture-service.ts:1087) 新增 return 位于 :1090 的 try/finally 之外。若 `captureObservation` 已返回 ready，原 signal 同时置位，就完全绕过 :1253 的 `releaseCaptureQuietly`。

这是实际资源窗口：[capture.ts:764](D:/cxt/s8l8-review4/src/core/workspace/capture.ts:764) 已把 entry 放入 registry，:765 标 published，随后 finally :774 还 await access release。捕获可已创建而 signal 在返回边界取消。未释放 entry 计入保留数量／字节上限，直到其他清理生效。旧代码进入 try 后取消，仍执行 finally。

应把 **ready capture 的取消出口放进既有清理范围**；非 ready 的取消优先级仍保留。

**生产缺陷2：清理期间新发生的取消，改写较早的非取消 throw**

[Svc:1251](D:/cxt/s8l8-review4/src/core/work-graph/architecture/architecture-service.ts:1251) 的 finally 在新增总 catch 外侧：

1. verify/export/put 等业务 await 在 signal 未置位时 throw。
2. finally 等待 `releaseCaptureQuietly`；该 helper 使用新的未取消 signal。
3. 原 signal 仅在 cleanup 期间才 abort。
4. cleanup 完成后，:1256 用此时的 signal 把原 throw 改为 cancelled。

违反裁定 2 的非取消 throw 保持及 cleanup 不覆盖主结果。普通业务 `return rejected` 在同一时序下反而不会被这样改写。应在业务异常边界确定主结果，不能在清理完成后重新判定它。

**生产缺陷3：archive 共享读者取消透传仍未闭合**

[Anomaly:168](D:/cxt/s8l8-review4/src/core/agent-runtime/session-anomaly-facts.ts:168)：

`真实未进入 Run → readExecution 在真实结果返回边界取消 → ready → kernelFacts → Brief:301 直接 not_entered → Anomaly:179 ready/not_entered`。

不需要制造 Run；公开停止前置可见 [S1-archive-files-brief.test.ts:168](D:/cxt/s8l8-review4/tests/runtime/S1-archive-files-brief.test.ts:168)。A3 持有真实 execution read 的返回即可到达。该 read 若 throw＋abort，:170 又直接返回 unavailable。

另外，Asm:803–805 的缺配置出口先于 :806 signal 检查，能返回 ready/unavailable；Brief:301、303、306 的早期出口也不查 signal。准备链有外层兜底，archive 读者没有同等兜底。缺配置是否由完整真实平台公开场景达到，未证明，标 **STATIC**，不单独计第四个缺陷。

这一类包含旧有前置分支，但裁定 4 明确要求检查这些共享 helper 的另一读者，故属于本次交付未闭合；不是新增产品需求。

**未发现已取得 committed receipt 后仍被改成 cancelled 的残留分支。** 上述缺陷2改写的是提交前较早发生的 throw。

**5. Read calls 与七条事实检查**

计数实现符合裁定 6：

- Count:55：每次 `readMany` 调用加 1，批量三个 key 仍只算 1，不看返回内容。
- Count:68：每次 body `read` 调用加 1，不再只计成功且特定 content type。
- Count:39–42：窗口包住真实 composition reminder reader。
- Count:96、125 → World:533 → H4:40：各自一次公开 `runtime.prepareExecution`。
- H4:45 的材料读取发生在 reminder 窗口结束后，不计入。
- Count:78 明确 memory、SQLite 两后端。

手算调用表：

| 实际读取 | 无 previous | 有 previous |
|---|---:|---:|
| Catalog current pointer，catalog-service.ts:379 | 1 record | 1 record |
| pointer＋baseline＋catalog 批读，:388 | 1 record | 1 record |
| observation pointer，Svc:812 | 1 record | 1 record |
| auto-capture request，Svc:799 | 1 record | 1 record |
| latest observation record，Svc:609 | 1 record | 1 record |
| previous observation record，Svc:609 | 0 | 1 record |
| latest 主正文，Svc:621 | 1 body | 1 body |
| latest chunks，Svc:698 | 6 body | 7 body |
| previous 主正文，Svc:621 | 0 | 1 body |
| previous chunks，Svc:698 | 0 | 6 body |
| **总计** | **5＋7＝12** | **6＋15＝21** |

七条恢复检查在 Count:111、113、114、137、139、140、141，主体和字面值完整保留；公开额外 facts 读取在 :109、135，均位于计数关闭之后。

因此 **计数方法、窗口、双后端和七条事实检查均静态成立**。实测是否恰为 12/21，仍须以测试运行结果为准，本次没有运行。

**6. 回复中的 UNSPECIFIED 1–5 与 FOUND**

| 项 | 当前代码事实 | 建议裁定 |
|---|---|---|
| UNSPECIFIED 1 | Asm:787、844 用 ready/value 或 cancelled 的内部 union；Prep:55 转发；Anomaly:144、177 接 typed cancelled。 | **接受这种类型表达**；但同时修复 §4 的原 signal 漏口。无需为了形式改成 cancelled 字段。 |
| UNSPECIFIED 2 | 当前 World 只建立普通 claim，未建立 requeue；Asm:942、967、809、880 等取消未覆盖。仓库真实 requeue 链可到达。 | **不接受免测**。补公共 requeue 前置及逐 await 行；运行受 bwrap 阻挡时按书报告，而不是宣称 A 完成。 |
| UNSPECIFIED 3 | Start:642、665、689 让 lookup miss 一次；真实 store 返回 replayed receipt，但前置是重复手造内部 request。 | **拒绝当前三行**，按裁定 5 删除并留 T。即使接受 miss 为 A2，也不豁免内部命令路径。 |
| UNSPECIFIED 4 | Svc:1396 revision guard 通常在 fail late replay commit 前拒绝；:1419 保留 late restore 分支且不改 cancelled。 | **按既有裁定 5 留 T，静态核验即可**；不需要另造命令证明。 |
| UNSPECIFIED 5 | Obs:170–223 复制 composition trigger wrapper，未经过 Platform:1200、1209。 | **不接受等价**；改用真实 platform fixture／真实 callback。 |
| FOUND：A2-requeue 0/5、无 bwrap | 运行归因仅见回复；代码确有公开 requeue 路径。S1/S3/C3 成功回归没有本轮逐 await 取消注入。 | **运行声明标 STATIC**；不能替代尚未写出的必需测试。 |
| FOUND：Host:183 NUL key | 属 rework-2 裁定 7 明确留下的旧代码。 | **继续 DEFERRED**，不扩大本轮。 |
| FOUND：旧 key counter 恰好 12/21 | Count:55、68 已改成调用计数；逐调用手算支持原字面值。 | **接受修复**，不再作为未决项。 |

回复中的生产行数 **+199／−41** 与 diff 一致；“All rows complete”及“BLOCKED none”则与上述代码和测试路径不符。

**7. DEFERRED**

- `session-archive.ts:244–248` 把 runtime reader 的任何 rejected（含 cancelled）转成 unavailable facts，:487 后继续归档锚点流程；这是更下游旧业务 fallback，本轮不悄悄扩大修改范围。
- Host:183 的旧 NUL tuple key，按 rework-2 裁定 7 保留。
- Pub:332 标题声称保留已写 body，但 :343、347 只证明真实 put 调用数；未独立证明最终正文仍可读。未见生产 rollback，本轮不增列非阻塞测试要求。
- request/fail 的 early/late replay 及 automatic capture replay，按裁定 5 保留生产分支、列 T；不得用新增手造命令行恢复测试。

**ids fixed / partly / not：20 / 13 / 0（33 个正式 ID；含全部定位项为 41 / 18 / 0）；ledger weakenings：1；new rule-sheet instances：17；production defects：3。**