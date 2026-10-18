结论：**H 不能判通过。** 已按要求读完 16 个主体 helper；另外 7 个按指定范围核对全部改行及其开放的调用能力，其中 `K-boundary-facts-support.ts` 额外全文核对。未修改文件，未运行测试或构建。

本报告把“函数自身的违规”和“调用下游违规函数”分开：末尾的 **34** 是直接包含禁止路径、或直接开放禁止输入能力的公开函数出口数；同一出口有多项问题只计一次，纯转发、重复导出不重复计数。表中以 D01–D34 标识。A1 标记只评价该函数自己的步骤，不替它依赖的 F 项放行。A7 名单为空。

为减少重复，以下路径缩写均相对于仓库根，行号是当前文件行号：

| 缩写 | 完整目录 |
|---|---|
| `H/` | `tests/helpers/` |
| `R/` | `tests/runtime/` |
| `W/` | `tests/work-graph/` |
| `B/` | `tests/business/` |
| `S/` | `tests/scenarios/` |
| `A/` | `tests/app/` |

## 1. HELPER TABLE

“全文”指整个当前文件；“限定范围”指用户指定的七个少改 helper。调用集合 C01–C15 在表后完整展开；不存在省略的“等”。

### AG2b、B2、K-boundary

| helper:function（file:line） | 产生什么、如何产生 | 判定 | 每个调用方 | 读全？ |
|---|---|---|---|---|
| AG2b-collaboration-fixture:ag2bJson（旧 `H/AG2b-collaboration-fixture.ts:480`） | B3 删除 canonicalJson 包装和 import；当前没有这个出口 | 删除本身不是断言削弱 | 全 `tests/` 无残余调用 | 限定范围；当前尾部 `:475` |
| B2-09b-crash:listCommandRerunRequests（`H/B2-09b-crash.ts:37`） | 打开已有 SQLite，调用真实 CRR `listRequests` 逐页读取 `:47` | A1；不是直接查 store 作断言 | `S/B2-09b-allowance-crash.test.ts:213,222` | 全文 70 行 |
| B2-401-world:openB401World（`H/B2-401-world.ts:174`） | 真实 seed、answer、requeue、claim、start；夹入手建 workspace 文件结果 `:219`，等待入场时 sleep `:157` | **D01：F4、F9**；另继承 bindingOf 禁项 `:277` | `R/B2-401-world.test.ts:43` | 全文 425 行 |
| B2-401-world:startNext（`H/B2-401-world.ts:349`） | 真实 requeue/claim/start，随后进入 sleep 轮询 `:365` | **D02：F9** | `R/B2-401-world.test.ts:79` | 全文 |
| B2-401-world:resetCounters（`H/B2-401-world.ts:379`） | 清零观察计数 `:380`，不改业务事实 | A3 的计数支架 | `R/B2-401-world.test.ts:54,76` | 全文 |
| B2-401-world:startNext.release（`H/B2-401-world.ts:368`） | 释放脚本模型 gate，模型抛错后由 Runtime 记录终态 `:129` | A2 | `R/B2-401-world.test.ts:101`；本文件 `:370,395,413` | 全文 |
| B2-401-world:close（`H/B2-401-world.ts:390`） | 释放 gate、等待 Run、关闭实际 world `:394` | A1/A2 清理 | `R/B2-401-world.test.ts:47,103` | 全文 |
| B2-401-world:shellCall（`H/B2-401-world.ts:424`） | 构造 command/callId 输入，无写入 | 输入构造本身不造态；当前由禁用的 runHook 消费 | `R/B2-401-world.test.ts:56` | 全文 |
| B2-401-world:requestService / hook 出口（`H/B2-401-world.ts:254,275`） | 返回真实 CRR owner、真实 hook；依赖是假 workspace 和手建 binding | 继承 F4/F1；真实 owner 本身不重复计 helper | requestRerun：本文件 `:303`、`R/B2-401-world.test.ts:81`；hook：该测试 `:56` 经 `H/B2-blocked-runtime.ts:413` | 全文 |
| B2-blocked-runtime:bindingOf（`H/B2-blocked-runtime.ts:95`） | 复制、排序 record.blockedCommands，再重建 prepared binding `:96` | **D03：F1/F4；A1 明确排除 prepared 输入** | 本文件 `:325,355`；`H/B2-401-world.ts:277`；`R/B2-02-recognition-unified.test.ts:149` 两次 | 全文 425 行 |
| B2-blocked-runtime:nextCall（`H/B2-blocked-runtime.ts:113`） | 分配测试 callId `:114` | A1 输入支架 | C01 | 全文 |
| B2-blocked-runtime:openB2HookWorld（`H/B2-blocked-runtime.ts:192`） | 真实 requeue/claim/cancel；注入手建 WorkspaceFile `:260`、binding `:325`，暴露 commit event `:248` | **D04：F4、F1、F7**；commit 故障 `:238`、真实委托计数 `:255` 分别可属 A2/A3 | `R/B2-02-approved-method.test.ts:78`；`R/B2-02-recognition-unified.test.ts:83`；本文件 `:402` | 全文 |
| B2-blocked-runtime:openB2BlockedWorld（`H/B2-blocked-runtime.ts:373`） | seed、answer 后转交 openB2HookWorld `:402` | 继承 D04；commands/files 是公开输入，不额外报 F1 | C02 | 全文 |
| B2-blocked-runtime:answer（`H/B2-blocked-runtime.ts:340`） | 读真实 CRR 卡，再 resolveDecision `:342` | A1 | C03 | 全文 |
| B2-blocked-runtime:failNextCrrCommit（`H/B2-blocked-runtime.ts:358`） | 使真实 records wrapper 下一次 CRR commit 失败 `:238` | A2 | `R/B2-04-allowance.test.ts:78`；`R/B2-09-allowance-crash.test.ts:51` | 全文 |
| B2-blocked-runtime:readRecord（`H/B2-blocked-runtime.ts:359`） | 调真实 review 公开读 `:360` | A1 | 全树无调用 | 全文 |
| B2-blocked-runtime:listRequests（`H/B2-blocked-runtime.ts:364`） | 调真实 CRR 公开 list `:365` | A1 | C04 | 全文 |
| B2-blocked-runtime:close（`H/B2-blocked-runtime.ts:407`） | 委托真实 blocked world 清理 | A1 清理 | C05 | 全文 |
| B2-blocked-runtime:runHook（`H/B2-blocked-runtime.ts:411`） | 手建 call，直接执行 before_tool hook `:413`；可令未 entered、已取消的 Run 消费 allowance | **D05：F3** | C06 | 全文 |
| B2-blocked-runtime:runTool（`H/B2-blocked-runtime.ts:417`） | 手建 ToolCall `:422`，直接执行 handler `:424` | **D06：F3** | C07 | 全文 |
| B2-blocked-runtime:requests / hook / tool 出口（`H/B2-blocked-runtime.ts:293,323,330`） | 暴露真实生产对象，依赖仍含假 workspace/binding | 继承 D03/D04；手工驱动问题见 D05/D06 | requestRerun：`R/B2-05-06-denial.test.ts:49`；listTaskRequests/consumeAllowance：`R/B2-16-hook-closure.test.ts:112,118`；hook/tool：C06/C07；另组 hook：`R/B2-02-recognition-unified.test.ts:116`、`R/B2-16-hook-reads.test.ts:172` | 全文 |
| B2-crr-world:runIdGeneratorOf（`H/B2-crr-world.ts:50`） | 每 world 的 ID 流 `:51`；返回函数 `:56` 只递增 ID | A1 输入支架 | 本文件 `:116,181`；`H/B2-blocked-runtime.ts:143`；`S/K3-29-startup-reconcile-2b.test.ts:87` | 全文 266 行 |
| B2-crr-world:reviewCardOf（`H/B2-crr-world.ts:60`） | 用真实 record 的 ref/revision 定位公开卡读 `:61` | A1 | 本文件 `:149`；`B/K3-UR7-crr-failed-set.test.ts:103` | 全文 |
| B2-crr-world:blockedRecord（`H/B2-crr-world.ts:100`） | 转发 blockedRecordWithClaim `:104` | 继承 D07 和工具 seam F4 | C08 | 全文 |
| B2-crr-world:blockedRecordWithClaim（`H/B2-crr-world.ts:111`） | 真 claim/start/reconcile；dispose 路径手发 review_unavailable `:145`→`:193` | **D07：F6**；dispose=false 不走该失败路径，但仍继承工具 seam | 本文件 `:104`；`B/K3-review-workflow-rows.test.ts:208`；`W/B2-07-crr-card-closed.test.ts:111`；`W/K3-26-unknown-call-review-storage.test.ts:670` | 全文 |
| B2-crr-world:requeueBlockedRecord（`H/B2-crr-world.ts:178`） | 调真实 harness.requeue `:183` | A1 步骤，继承 harness 假消息依赖 | `W/B2-07-crr-card-closed.test.ts:114`；`W/K3-26-unknown-call-review-storage.test.ts:756` | 全文 |
| B2-crr-world:realKernelCommandReaderOf（`H/B2-crr-world.ts:206`） | 同一个真实 Kernel registry，原样调用生产 reader `:211` | A1 | `W/B2-07-crr-card-closed.test.ts:84,153` | 全文 |
| B2-crr-world:runSnapshotOf（`H/B2-crr-world.ts:215`） | records.readMany 后 decodeRun `:216` | **D08：F7**，被测试用作断言事实 | 本文件 `:227`；`W/B2-07-crr-card.test.ts:71,101,135,162` | 全文 |
| B2-crr-world:workRunCtx（`H/B2-crr-world.ts:226`） | 从 runSnapshotOf 的底层读结果组 context `:227` | 继承 D08；不是改写 Run | 本文件 `:238`；`B/K3-UR7-crr-failed-set.test.ts:130` | 全文 |
| B2-crr-world:requestRerunOf（`H/B2-crr-world.ts:233`） | 公开 requestRerun，context 来自 workRunCtx `:238` | 请求本身 A1；继承 D08 | C09 | 全文 |
| B2-crr-world:crrCardOf（`H/B2-crr-world.ts:253`） | 真实 CRR 卡 readPage `:254` | A1 | C10 | 全文 |
| B2-crr-world:crrSourceOf（`H/B2-crr-world.ts:262`） | 构造 source key、空 pins `:265` | 拒绝用法必须满足 A6；当前一个调用不满足，见 Findings；不把它误报为已接受的 F1 | `W/B2-08-crr-answer.test.ts:111`；`W/B2-07-crr-card-closed.test.ts:164,165` | 全文 |
| K-boundary-facts-support:injectAcceptedMessage（`H/K-boundary-facts-support.ts:53`） | 手建 resumed/input_accepted，append Kernel store `:79` | **D09：F3** | `S/K-R-attested-facts-source.test.ts:171` | 全文 126 行；B3 仅改尾部空行 |
| K-boundary-facts-support:injectRunningToolCall（`H/K-boundary-facts-support.ts:93`） | 手建 assistant.message_completed/tool.started，append Kernel store `:118` | **D10：F3** | `S/K-R-attested-facts-source.test.ts:309,377` | 全文 |

### K3-35 continuation、prepare、runtime、纯构造器

| helper:function（file:line） | 产生什么、如何产生 | 判定 | 每个调用方 | 读全？ |
|---|---|---|---|---|
| K3-35-continuation-fixture:sha（`H/K3-35-continuation-fixture.ts:119`） | 重复字符 64 次，纯输入 | A5 构造形式；当前模块混入平台依赖，须隔离 | 本文件 `:148,176`；`R/K3-15-blocked-sentence.test.ts:40,60,64,72`；`R/K3-35-renderer-boundary.test.ts:43,62,88,94` | 全文 1,076 行 |
| K3-35-continuation-fixture:at（`H/K3-35-continuation-fixture.ts:120`） | 固定格式测试时间 | A1/A5 输入 | 本文件 `:138,159,176,472` | 全文 |
| K3-35-continuation-fixture:baseBrief（`H/K3-35-continuation-fixture.ts:181`） | 手组 Run/requeue/basis 后调用纯 assembler `:132,149,165,182` | 构造内容可 A5；当前模块导入 platform/Runtime/store，纯测试隔离不合格 | `R/K3-15-blocked-omission.test.ts:56`；`R/K3-15-blocked-sentence.test.ts:39,48,53,59,63,67,75,79,105,122,138,141`；`R/K3-35-renderer-boundary.test.ts:48,108` | 全文 |
| K3-35-continuation-fixture:approvedMethodBlockBytes（`H/K3-35-continuation-fixture.ts:198`） | 对手算字符串计 UTF-8 字节 `:199` | A5；不是从 src 常量取期望 | `R/K3-35-approved-methods-brief.test.ts:145` | 全文 |
| K3-35-continuation-fixture:openRealRunHarness（`H/K3-35-continuation-fixture.ts:443`） | 真 git、claim、Runtime、Host；共享同 records/body；requeue 注入固定 not_found 消息读 `:494` | **D11：F4**；backend/body factory `:636` 属 A4，不是禁项 | C11 | 全文 |
| K3-35-continuation-fixture:claimRun（`H/K3-35-continuation-fixture.ts:523`） | 公开 claimTask `:525`；Goal/Session 公共 pin；Workspace pin 来自底层读 `:515` | claim 是 A1；只用于 pin 的底层读列 OPEN，不冒充 F7 断言 | C12 | 全文 |
| K3-35-continuation-fixture:prepareAndStart（`H/K3-35-continuation-fixture.ts:536`） | 真 prepare `:555,566`、真 start `:576`；注入 fake mailbox `:545` | **D12：F4**；同时继承假授权、假工具 seam | C13 | 全文 |
| K3-35-continuation-fixture:reconcileUnknown（`H/K3-35-continuation-fixture.ts:700`） | 通常真 execution/probe/reconcile；允许传入成品 SessionMappingProbe，`:691` 直接替代真实 probe | **D13：F4 输入能力**；没有 override 的路径 A1 | `B/K3-review-workflow-rows.test.ts:403`；本文件 `:744`；`W/K3-06-mixed-kinds-owner.test.ts:206`；`W/K3-26-unknown-call-review-storage.test.ts:257,600` | 全文 |
| K3-35-continuation-fixture:reconcileUnknownTwice（`H/K3-35-continuation-fixture.ts:711`） | 同真实请求重放 `:722`；也开放 probe override `:712` | **D14：F4 输入能力**；当前无 override 的 replay 本身 A1，非 F5 | `W/K3-26-unknown-call-review-storage.test.ts:628` | 全文 |
| K3-35-continuation-fixture:createRecord（`H/K3-35-continuation-fixture.ts:766`） | RUN-20→真实 resolveUnknownRun→公开 review；仍开放 probe override `:767`→`:744` | **D15：F4 输入能力**；正常无 override 链 A1 | C14 | 全文 |
| K3-35-continuation-fixture:replayRecord（`H/K3-35-continuation-fixture.ts:771`） | 同 RUN-22 请求重放；仍开放 probe override `:772` | **D16：F4 输入能力**；正常重放非 F5 | `W/K3-26-unknown-call-review-storage.test.ts:290` | 全文 |
| K3-35-continuation-fixture:requeue（`H/K3-35-continuation-fixture.ts:780`） | 公开 requeue；source digest 来自真实工作树 capture `:491` | 步骤 A1；继承 D11 的假消息读 | `H/B2-401-world.ts:292,350`；`H/B2-blocked-runtime.ts:150`；`H/B2-crr-world.ts:183`；本文件 `:1033` | 全文 |
| K3-35-continuation-fixture:registerArchive（`H/K3-35-continuation-fixture.ts:792`） | 公共 Session read→公开 archive request `:796` | A1 | 本文件 `:927` | 全文 |
| K3-35-continuation-fixture:driveArchive（`H/K3-35-continuation-fixture.ts:801`） | 真 archive service `:805`；依赖 failingChangedFilesReader `:502` | A1 步骤；继承 D34、D11 | 本文件 `:942` | 全文 |
| K3-35-continuation-fixture:anchorOfRun（`H/K3-35-continuation-fixture.ts:810`） | 公共 anomaly list 后按 Run 查找 | A1 | 本文件 `:945` | 全文 |
| K3-35-continuation-fixture:anchorList（`H/K3-35-continuation-fixture.ts:818`） | 公共 anomaly list | A1 | 本文件 `:823,1075` | 全文 |
| K3-35-continuation-fixture:anchorCount（`H/K3-35-continuation-fixture.ts:823`） | 公共 list 的长度 | A1 | 本文件 `:803,946` | 全文 |
| K3-35-continuation-fixture:closeUnion（`H/K3-35-continuation-fixture.ts:829`） | 关闭缓存真实 platform `:833` | A1 清理 | C15 | 全文 |
| K3-35-continuation-fixture:endBoundaryOf（`H/K3-35-continuation-fixture.ts:839`） | 委托 readRunBoundary | A1 | 本文件 `:1055` | 全文 |
| K3-35-continuation-fixture:now（`H/K3-35-continuation-fixture.ts:472`） | 读取 fixture 时钟，不改已保存事实 | A1 输入 | 本文件作为依赖传入 `:475,481,482,484,495,498,544,567,608`；无外部直接调用 | 全文 |
| K3-35-continuation-fixture:eventId（`H/K3-35-continuation-fixture.ts:474`） | 递增测试 ID | A1 输入 | 本文件依赖注入 `:475,495,544`；无外部直接调用 | 全文 |
| K3-35-continuation-fixture:newId（`H/K3-35-continuation-fixture.ts:477`） | 递增 Run ID | A1 输入 | 本文件 `:478,481`；无外部直接调用 | 全文 |
| K3-35-continuation-fixture:setMinute（`H/K3-35-continuation-fixture.ts:841`） | 改测试时钟 | A1 输入 | 本文件 `:903` | 全文 |
| K3-35-continuation-fixture:readRunBoundary（`H/K3-35-continuation-fixture.ts:850`） | 公共 execution read、真实 history owner 的 boundary/window `:855,864,869` | A1；没有手造 cursor/position | 本文件 `:839`；`W/K3-16-proposal-round-fixture.test.ts:201,230` | 全文 |
| K3-35-continuation-fixture:openK3_35PublicRecord（`H/K3-35-continuation-fixture.ts:886`） | 八条 archive、真实 review/proposal/continuation；archive 后读 raw requeue JSON 核对成功 `:949`；拒绝 memory `:889` | **D17：F7、F12/双后端缺口**；其他依赖禁项仍在 | `R/K3-35-approved-methods-brief.test.ts:83`；`R/K3-35-T-by-hand.test.ts:102,155` | 全文 |
| K3-35-continuation-fixture:publicRecord.endBoundaryOf（`H/K3-35-continuation-fixture.ts:1055`） | 委托真实 boundary reader | A1 | `R/K3-35-approved-methods-brief.test.ts:128` | 全文 |
| K3-35-continuation-fixture:publicRecord.close（`H/K3-35-continuation-fixture.ts:1056`） | 关闭 union、world | A1 清理 | `R/K3-35-approved-methods-brief.test.ts:84`；`R/K3-35-T-by-hand.test.ts:103,156` | 全文 |
| K3-35-prepare:prepareContinuation（`H/K3-35-prepare.ts:58`） | 真 preparation `:92` 生成 manifest/prepared；真 Task closure reader `:84` | A1 步骤；继承 world 的禁依赖 | `H/K3-35-continuation-fixture.ts:566`；`H/K3-proposal-round.ts:434`；`W/K3-47-continuation-gate.test.ts:152,179` | 全文 124 行 |
| K3-35-prepare:prepareWorstCase（`H/K3-35-prepare.ts:107`） | 公共 execution read、rehydrate 已保存 binding `:109,111`，不重复 prepare 已 entered Run | A1 读法；比较的是实际已保存 binding | `R/K3-35-approved-methods-brief.test.ts:149`；`R/K3-35-T-by-hand.test.ts:135,167` | 全文 |
| K3-35-required-review-block:requiredReviewBlock（`H/K3-35-required-review-block.ts:33`） | 纯文本提取 | A5 算法；`:10` 反向导入混合 helper，纯依赖隔离失败 | `R/K3-35-approved-methods-brief.test.ts:167`；`R/K3-35-renderer-boundary.test.ts:155`；`R/K3-35-T-by-hand.test.ts:141,174` | 全文 39 行 |
| K3-35-runtime:k3_35Configuration（`H/K3-35-runtime.ts:75`） | 构造可信 Host 配置、脚本模型、grant `:80` | A1 配置输入；不是持久事实输出 | `H/K3-35-continuation-fixture.ts:625`；`H/K3-35-prepare.ts:75`；本文件 `:143` | 全文 196 行 |
| K3-35-runtime:k3_35AuthorizeConfiguration（`H/K3-35-runtime.ts:103`） | 弱检查后复制请求中的 permissions/template，返回授权成功 `:112` | **D18：F4** | 本文件 `:148` 取别名，`:149,151` 注入 entry/modelCall owners | 全文 |
| K3-35-runtime:createK3_35Runtime（`H/K3-35-runtime.ts:120`） | 装配真实 Runtime；注入上述假授权 `:148`，可接任意 messages ports `:186` | 继承 D18；外部传假 port 的实例另报 F4，不把“真实 Runtime”当免责 | `B/K3-15-ur3h.test.ts:115`；`B/K3-review-workflow-rows.test.ts:122`；`H/K3-35-continuation-fixture.ts:542`；`H/K3-proposal-round.ts:419`；`W/K3-47-continuation-gate.test.ts:147,173` | 全文 |
| K3-padded-review-record:k3PaddedCallIds（`H/K3-padded-review-record.ts:52`） | 构造纯 call ID 数组 | A5 | 本文件 `:91`；`R/K3-48-3-extremes-pure.test.ts:93` | 全文 115 行 |
| K3-padded-review-record:k3PaddedPath（`H/K3-padded-review-record.ts:58`） | 构造 512-byte 纯 path 输入 | A5 | 本文件 `:64` | 全文 |
| K3-padded-review-record:k3PaddedFullChanges（`H/K3-padded-review-record.ts:63`） | 构造 200 paths | A5 | 本文件 `:69,109` | 全文 |
| K3-padded-review-record:k3PaddedCaptureBody（`H/K3-padded-review-record.ts:68`） | 序列化纯 capture 输入 | A5 | 本文件 `:74` | 全文 |
| K3-padded-review-record:k3PaddedCaptureRef（`H/K3-padded-review-record.ts:73`） | 从纯 body 算元数据，无 store 写入 | A5 | 本文件 `:112` | 全文 |
| K3-padded-review-record:k3PaddedNotVisible（`H/K3-padded-review-record.ts:82`） | 构造 near-cap 数组 | A5 | 本文件 `:113` | 全文 |
| K3-padded-review-record:k3PaddedItems（`H/K3-padded-review-record.ts:90`） | 手组 items/kernel metadata，仅供纯 codec 输入 | A5；当前没有成功 owner 调用方 | `R/K3-48-3-extremes-pure.test.ts:93,202` | 全文 |
| K3-padded-review-record:k3PaddedWorkspace（`H/K3-padded-review-record.ts:108`） | 组合纯 workspace capture | A5 | `R/K3-48-3-extremes-pure.test.ts:94` | 全文 |

### blocked、CRR、prefix

| helper:function（file:line） | 产生什么、如何产生 | 判定 | 每个调用方 | 读全？ |
|---|---|---|---|---|
| K3-blocked-command-fixture:sha256Of（`H/K3-blocked-command-fixture.ts:114`） | 对输入文本计算真实 SHA-256 | A1 输入处理/A5 纯函数；摘要真实不使假文件读口合法 | `H/B2-401-world.ts:226`；`H/B2-blocked-runtime.ts:269`；本文件 `:417`；`R/B2-02-recognition-unified.test.ts:104`；`R/B2-16-hook-reads.test.ts:134`；`W/B2-01-blocked-commands.test.ts:49,85,130`；`W/B2-12-rewrite-prefix.test.ts:71,73` | 全文 561 行 |
| K3-blocked-command-fixture:openK3BlockedReviewServices（`H/K3-blocked-command-fixture.ts:395`） | 注入 files map 生成的 WorkspaceFile `:406`；Kernel facts 的计数包装则真委托 `:424` | **D19：F4**；Kernel 计数部分 A3 | `H/B2-401-world.ts:182`；本文件 `:535`；`H/K3-prefix-claim.ts:49`；`W/B2-18-request-reads.test.ts:70` | 全文 |
| K3-blocked-command-fixture:services.seed（`H/K3-blocked-command-fixture.ts:508`） | 真脚本 Run；私有 seed 路径覆写 Host 读结果 `:146`、假 mailbox `:165`、sleep `:350`、手选 unavailable cause `:367` | **D20：F2、F4、F9、F6** | `H/B2-401-world.ts:183`；本文件 `:536,542`；`H/K3-prefix-claim.ts:72`；`W/B2-18-request-reads.test.ts:71` | 全文 |
| K3-blocked-command-fixture:services.answer（`H/K3-blocked-command-fixture.ts:489`） | 读真实卡 `:491`，带卡 source/pins 调 resolveDecision `:492` | A1；继承装配禁依赖 | `H/B2-401-world.ts:186`；`H/B2-blocked-runtime.ts:398`；`H/K3-crr-fixture.ts:63`；`H/K3-prefix-claim.ts:77`；`W/B2-01-blocked-commands.test.ts:71,103,104,133,142,156,165`；`W/B2-17-disposition-reads.test.ts:31`；`W/B2-18-request-reads.test.ts:80` | 全文 |
| K3-blocked-command-fixture:openK3BlockedCommandWorld（`H/K3-blocked-command-fixture.ts:520`） | 打开 world、services，再 seed `:534` | 继承 D19/D20 | `H/B2-blocked-runtime.ts:391`；`H/K3-crr-fixture.ts:62`；`W/B2-01-blocked-commands.test.ts:52,94,98,120,149`；`W/B2-17-disposition-reads.test.ts:37,52,63,67` | 全文 |
| K3-blocked-command-fixture:createNeedsDecision（`H/K3-blocked-command-fixture.ts:541`） | 转调 services.seed `:542` | 继承 D20 | `W/B2-03-crr-request.test.ts:164` | 全文 |
| K3-blocked-command-fixture:startPrepared（`H/K3-blocked-command-fixture.ts:549`） | 直接接收 prepared 值，传 Runtime.startRun `:551` | **D21：A1/默认拒绝**；当前调用确为真实 prepare 后被拒绝，不误报“伪 prepared 被接受” | `R/K3-review-preparation.test.ts:608` | 全文 |
| K3-crr-fixture:openCrrWorld（`H/K3-crr-fixture.ts:52`） | 真 blocked/answer 链；records 包装计数/故障真委托 `:82`；workspace 读却由 files map 构造 `:121` | **D22：F4**；真实 records 包装 A2/A3 | `R/K3-review-preparation.test.ts:466`；`W/B2-03-crr-request.test.ts:80,100,114,124,147,161`；`W/B2-14-crr-forms.test.ts:68,82,99,119,136,152` | 全文 212 行 |
| K3-crr-fixture:createContinuationRun（`H/K3-crr-fixture.ts:148`） | requeue 的 root 是假 `/tmp` 路径 `:154`，digest 固定 `:157`，messages 固定 not_found `:160` | **D23：F4** | `R/K3-review-preparation.test.ts:467`；`W/B2-03-crr-request.test.ts:136` | 全文 |
| K3-crr-fixture:failNextCrrCommit（`H/K3-crr-fixture.ts:208`） | 下一次真实 CRR commit 故障 | A2 | 未发现该返回对象的直接调用；B2 同名方法的调用不混入 | 全文 |
| K3-crr-fixture:close（`H/K3-crr-fixture.ts:210`） | 真实 blocked world 清理 | A1 清理 | 上述 openCrrWorld 各测试的清理路径 | 全文 |
| K3-prefix-claim:createBlockedRecord（`H/K3-prefix-claim.ts:59`） | services.seed→answer `:72,77` | 继承 D19/D20；没有自行造 review | `R/B2-02-recognition-unified.test.ts:78,129,134`；`W/B2-12-rewrite-prefix.test.ts:53,57,139` | 全文 127 行 |
| K3-prefix-claim:requeueAfterRun（`H/K3-prefix-claim.ts:85`） | 假 root/revision `:93`、固定 digest `:96`、假 materials/messages `:97,99` | **D24：F4** | `R/B2-02-recognition-unified.test.ts:133`；`W/B2-12-rewrite-prefix.test.ts:56` | 全文 |
| K3-prefix-claim:workRunContextOf（`H/K3-prefix-claim.ts:122`） | 从实际 Run 组调用 context，不写事实 | A1 输入适配 | `W/B2-12-rewrite-prefix.test.ts:83` | 全文 |

### proposal-round

| helper:function（file:line） | 产生什么、如何产生 | 判定 | 每个调用方 | 读全？ |
|---|---|---|---|---|
| K3-proposal-round:openK3ReviewCardWorld 重导出（`H/K3-proposal-round.ts:89`） | 重导出同一工厂 | 同 D29，不另计 | 见下文 world 调用集合 | 全文 921 行 |
| k3RequestId（`H/K3-proposal-round.ts:100`） | 分配请求 ID | A1 输入 | `B/K3-review-workflow-rows.test.ts:340,350,356,372,387`；本文件 `:388,389,421,438,481,596,662,718,875` | 全文 |
| k3TakeTaskId（`H/K3-proposal-round.ts:117`） | 选择/保留测试 Task ID | A1 输入 | 本文件 `:258` | 全文 |
| k3WorkRunContext（`H/K3-proposal-round.ts:130`） | 用实际 claim/Run 组 context | A1 输入适配 | 本文件 `:463` | 全文 |
| k3TaskIdOfBytes（`H/K3-proposal-round.ts:147`） | 构造指定字节长度的 ID | A1 输入 | `H/K3-35-continuation-fixture.ts:897` | 全文 |
| adoptK3PlanTask（`H/K3-proposal-round.ts:169`） | 手组 PlanRevisionDraft `:186`，公开 propose/apply `:203,211` | **OPEN-1**：原生 Plan 命令边界不自行裁定 | `H/K3-35-continuation-fixture.ts:898` | 全文 |
| k3SerializedBytes（`H/K3-proposal-round.ts:239`） | 测量当前 record 序列化字节数 | A1 观察；调用方削弱期望值是另一个 F12 | `W/K3-48-2-unknown-call-review-model-text-budget.test.ts:388` | 全文 |
| createK3PendingReview（`H/K3-proposal-round.ts:255`） | 调 blockedRecord，dispose=false `:261` | A1 形状；继承工具/授权等 F4 | `A/K3-15-review-routes.test.ts:137`；`B/K3-15-ur3h.test.ts:207,248,285,332`；本文件 `:866`；`H/K3-review-card-fixture.ts:385`；`R/B2-02-approved-method.test.ts:46`；`R/K3-19-review-admission.test.ts:63`；`S/K3-29-startup-reconcile-2b.test.ts:113`；`W/B2-01-task-read.test.ts:46,85`；`W/B2-09-crr-owner.test.ts:68`；`W/B2-12-recognition.test.ts:197`；`W/K3-06-mixed-kinds-owner.test.ts:121`；`W/K3-13-two-items-owner.test.ts:54`；`W/K3-15-hold-release.test.ts:98`；`W/K3-16-approval-application.test.ts:128,162`；`W/K3-16-proposal-round-fixture.test.ts:142,253`；`W/K3-16-proposal-write.test.ts:57`；`W/K3-16-second-unfinished-proposal.test.ts:67`；`W/K3-26-unknown-call-review-storage.test.ts:877`；`W/K3-35-owner-manifest-trim.test.ts:46`；`W/K3-43-review-claim-vs-hold.test.ts:53`；`W/K3-47-claim-gate.test.ts:85`；`W/K3-47-reader-facts.test.ts:129,149,161,171,199`；`W/K3-48-3-required-writes.test.ts:58` | 全文 |
| readK3Review（`H/K3-proposal-round.ts:277`） | 从 ref 定位真实公开 readReview `:281` | A1 | `A/K3-15-review-routes.test.ts:143,167`；`B/K3-15-ur3h.test.ts:152`；`B/K3-review-workflow-rows.test.ts:353,385,412,517,622,646,672,693`；`H/K3-35-continuation-fixture.ts:1027`；本文件 `:392,459,771,814`；`W/K3-06-mixed-kinds-owner.test.ts:163,172`；`W/K3-13-two-items-owner.test.ts:73,82`；`W/K3-16-approval-application.test.ts:172`；`W/K3-16-proposal-write.test.ts:89,122,157,162,179,185,234,238`；`W/K3-26-unknown-call-review-storage.test.ts:903`；`W/K3-48-3-required-writes.test.ts:103` | 全文 |
| claimK3ReviewRound（`H/K3-proposal-round.ts:383`） | 真 claim/prepare/start；覆写 Host read `:428`；sleep 轮询 entered `:356` | **D25：F2、F9**；另继承假授权 | `B/K3-review-workflow-rows.test.ts:351,400,449,461`；`H/K3-35-continuation-fixture.ts:994,1013`；本文件 `:810,885`；`R/B2-02-approved-method.test.ts:60`；`R/K3-19-review-admission.test.ts:64`；`S/K3-29-startup-reconcile-2b.test.ts:267`；`W/B2-01-blocked-commands.test.ts:158`；`W/K3-06-mixed-kinds-owner.test.ts:145`；`W/K3-13-two-items-owner.test.ts:66`；`W/K3-16-approval-application.test.ts:114,166`；`W/K3-16-proposal-round-fixture.test.ts:154,160`；`W/K3-16-proposal-write.test.ts:69`；`W/K3-16-second-unfinished-proposal.test.ts:92,113,151,173,182`；`W/K3-26-unknown-call-review-storage.test.ts:886`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:305,321` | 全文 |
| recordK3Conclusion（`H/K3-proposal-round.ts:475`） | 以 alias/verdict/evidence 这些产品输入调用公开 conclusion owner `:478` | A1 产品命令；不同于手建 Runtime event/Host review draft；不为下游假依赖背书 | `H/K3-35-continuation-fixture.ts:995`；本文件 `:812`；`W/K3-06-mixed-kinds-owner.test.ts:150`；`W/K3-16-approval-application.test.ts:167`；`W/K3-26-unknown-call-review-storage.test.ts:897`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:306` | 全文 |
| endK3RunCompleted（`H/K3-proposal-round.ts:526`） | 释放模型 gate，等待 Runtime 自己结束，再公共读取 `:496,502,506` | A1/A3 | `B/K3-review-workflow-rows.test.ts:354,411,455`；`H/K3-35-continuation-fixture.ts:999,1018`；本文件 `:816,914`；`R/B2-02-approved-method.test.ts:62`；`R/K3-19-review-admission.test.ts:72,87`；`W/B2-01-blocked-commands.test.ts:162`；`W/K3-06-mixed-kinds-owner.test.ts:161`；`W/K3-13-two-items-owner.test.ts:71`；`W/K3-16-approval-application.test.ts:116`；`W/K3-16-proposal-round-fixture.test.ts:111,200`；`W/K3-26-unknown-call-review-storage.test.ts:904`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:310` | 全文 |
| endK3RunUnfinished（`H/K3-proposal-round.ts:542`） | 令脚本模型在真实调用时抛错 `:550`→`:417`，Runtime 记录终态 | A2 | `B/K3-review-workflow-rows.test.ts:462`；本文件 `:817`；`S/K3-29-startup-reconcile-2b.test.ts:270`；`W/K3-16-approval-application.test.ts:171`；`W/K3-16-proposal-round-fixture.test.ts:127,156,162,228`；`W/K3-16-second-unfinished-proposal.test.ts:104,116,147,152,175,184` | 全文 |
| settleK3Review（`H/K3-proposal-round.ts:588`） | 测试选择 Host settle cause `:595`；有结论时装入手建 full display map `:571` | **D26：F3/F6、F4** | `B/K3-review-workflow-rows.test.ts:339,355`；`H/K3-35-continuation-fixture.ts:1000,1019`；`H/K3-blocked-command-fixture.ts:367`；本文件 `:818,874,915`；`H/K3-review-card-fixture.ts:389`；`R/B2-02-approved-method.test.ts:51,63`；`W/B2-01-blocked-commands.test.ts:163`；`W/B2-01-task-read.test.ts:50`；`W/B2-09-crr-owner.test.ts:68`；`W/B2-12-recognition.test.ts:197`；`W/B2-18-request-reads.test.ts:78`；`W/K3-06-mixed-kinds-owner.test.ts:164`；`W/K3-13-two-items-owner.test.ts:77`；`W/K3-16-approval-application.test.ts:117,135,172,174`；`W/K3-16-proposal-round-fixture.test.ts:113,129,152,157,163`；`W/K3-16-proposal-write.test.ts:63`；`W/K3-16-second-unfinished-proposal.test.ts:80,105,117,148,153,176,185`；`W/K3-26-unknown-call-review-storage.test.ts:906`；`W/K3-47-claim-gate.test.ts:94`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:311`；`W/K3-48-3-required-writes.test.ts:71` | 全文 |
| readK3ReviewCard（`H/K3-proposal-round.ts:620`） | 真实分页卡读 `:626`，record 仅提供 ref/revision | A1 | `B/K3-review-workflow-rows.test.ts:369`；`H/K3-blocked-command-fixture.ts:491`；本文件 `:658`；`W/B2-09-crr-owner.test.ts:71`；`W/B2-12-recognition.test.ts:201`；`W/K3-16-approval-application.test.ts:139,145,176,189,383,403` | 全文 |
| answerK3Disposition（`H/K3-proposal-round.ts:654`） | 真实卡 source/pins→resolveDecision `:658,659` | A1 | `B/K3-review-workflow-rows.test.ts:348`；`H/K3-35-continuation-fixture.ts:1007,1023`；本文件 `:879`；`R/B2-02-approved-method.test.ts:56,67`；`W/K3-16-approval-application.test.ts:140,177,182,184`；`W/K3-16-proposal-round-fixture.test.ts:153`；`W/K3-16-proposal-write.test.ts:66`；`W/K3-16-second-unfinished-proposal.test.ts:89,169`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:315` | 全文 |
| proposeK3SaferMethodWithTool（`H/K3-proposal-round.ts:689`） | 创建工具后手建 ToolCall `:705`，直接 handler.execute `:708` | **D27：F3/默认拒绝**；不是 scripted model 调真工具 | 本文件 `:760` | 全文 |
| writeK3Proposal（`H/K3-proposal-round.ts:712`） | command/cwd/rationale 走公开 proposal owner `:715` | A1 产品命令；不等于手建 Host prior fact | `H/K3-35-continuation-fixture.ts:1014`；本文件 `:768`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:392` | 全文 |
| writeK3Proposals（`H/K3-proposal-round.ts:744`） | 默认走直接 handler 路径 `:759,760`，另一分支公开 owner `:768` | 默认分支继承 D27；owner 分支按 A1 单独评价 | `B/K3-review-workflow-rows.test.ts:352`；本文件 `:889`；`R/B2-02-approved-method.test.ts:61`；`W/B2-01-blocked-commands.test.ts:159`；`W/K3-16-approval-application.test.ts:115`；`W/K3-16-proposal-round-fixture.test.ts:155,161`；`W/K3-16-second-unfinished-proposal.test.ts:102,114,174,183` | 全文 |
| runK3ReviewRound（`H/K3-proposal-round.ts:807`） | claim/conclusion/end/settle `:810,812,816,818` | 继承 D25/D26 | `W/K3-16-proposal-round-fixture.test.ts:146,258`；`W/K3-16-second-unfinished-proposal.test.ts:72`；`W/K3-35-owner-manifest-trim.test.ts:62` | 全文 |
| reachK3AwaitingProposal（`H/K3-proposal-round.ts:863`） | pending 后主动指定 review_unavailable `:874`，再 answer/claim/proposal | **D28：F6**；另继承 D25/D27 | 本文件 `:913`；`R/K3-19-review-admission.test.ts:80`；`W/K3-16-proposal-round-fixture.test.ts:77,124,173,223` | 全文 |
| reachK3AwaitingApproval（`H/K3-proposal-round.ts:910`） | 转调 awaitingProposal/end/settle `:913` | 继承 D28/D26；当前无调用 | 全树无调用 | 全文 |

### review-card、tool-seams、S1

| helper:function（file:line） | 产生什么、如何产生 | 判定 | 每个调用方 | 读全？ |
|---|---|---|---|---|
| K3-review-card-fixture:openK3ReviewCardWorld（`H/K3-review-card-fixture.ts:127`） | 真 owners；混入假 Kernel facts `:139`、workspace `:162`、recognizer `:200`、duties `:245`、executedFiles `:305` | **D29：F4**；Plan draft 和 receipt adapter 分别列 OPEN | 下方完整 world 调用集合 | 全文 443 行 |
| K3-review-card-fixture:failNextApplicationCommit（`H/K3-review-card-fixture.ts:315`） | 在真实 commit wrapper 注入指定失败 `:226` | A2，裁定明示接受的形状 | `B/K3-review-workflow-rows.test.ts:1096,1169,1170`；`S/K3-29-startup-answers.test.ts:157`；`S/K3-44-crr-kind4.test.ts:39`；`W/B2-UR7-crr-answer.test.ts:36`；`W/K3-17-disposition-replay.test.ts:88` | 全文 |
| K3-review-card-fixture:failNextApplicationRead（`H/K3-review-card-fixture.ts:318`） | 在真实 lookup wrapper 注入失败 `:219` | A2 | `W/K3-17-disposition-replay.test.ts:114` | 全文 |
| K3-review-card-fixture:createRecord（`H/K3-review-card-fixture.ts:319`） | 转发 createK3NeedsDecisionRecord | 继承 D30；不与 harness 同名方法混算 | 对外 world.createRecord 调用的实际实现为此出口；其实现调用点 `:319` | 全文 |
| K3-review-card-fixture:setK3TaskDisposition（`H/K3-review-card-fixture.ts:329`） | PlanRevisionDraft 修改 disposition `:338`，propose/apply `:353,359` | OPEN-1 | `R/B2-16-hook-closure.test.ts:92,106`；`R/K3-review-preparation.test.ts:566`；`W/B2-07-crr-card-closed.test.ts:47`；`W/B2-08-crr-answer.test.ts:107`；`W/B2-08-crr-cancel.test.ts:45` | 全文 |
| K3-review-card-fixture:createK3NeedsDecisionRecord（`H/K3-review-card-fixture.ts:375`） | 默认 pending 后手选 review_unavailable `:389`；autoSettled 分支走真实 harness，但用假 read seam `:423` | **D30：F6**；autoSettled 分支继承 read seam F4 | `B/K3-17-goal-guard.test.ts:89`；`B/K3-46-review-advance-failures.test.ts:423,455,480,505,528,529,629,663,692,693,741,742`；`B/K3-UR7-crr-failed-set.test.ts:364,404,411,471`；本文件 `:319`；`W/K3-15-disposition-effects.test.ts:201,221,292,351`；`W/K3-15-list-by-task.test.ts:54,55,73`；`W/K3-17-disposition-replay.test.ts:58`；`W/K3-18-requeue-confirmed.test.ts:120,164`；`W/K3-41-disposition-proof.test.ts:49,99`；`W/K3-43-continuation-vs-hold.test.ts:88` | 全文 |
| K3-tool-seams:shellSeam.definition（`H/K3-tool-seams.ts:102`） | 未 arm 时才委托真 factory `:103`；arm 后替换定义，execute 等 gate 后返回手建成功 `:79,93` | **D31：F4**；不是 A3 | 下方完整 shell definition 调用集合；控制方法另见说明 | 全文 168 行 |
| K3-tool-seams:mailboxToolSeam.definition（`H/K3-tool-seams.ts:132`，对象 `:161`） | 自建 send_user_message tool，execute 返回手建成功 `:144,146` | **D32：F4** | 经本文件 handle `:156`；`W/B2-01-blocked-commands.test.ts:39` | 全文 |
| K3-tool-seams:readToolSeam.definition（`H/K3-tool-seams.ts:132`，对象 `:168`） | 自建 read tool，execute 返回手建成功 `:146` | **D33：F4** | `A/K3-15-review-routes.test.ts:54`；`W/K3-15-disposition-effects.test.ts:52`；`W/K3-15-hold-release.test.ts:51`；`W/K3-18-requeue-confirmed.test.ts:38`；`W/K3-43-continuation-vs-hold.test.ts:45`；`W/K3-47-continuation-gate.test.ts:46`；`W/K3-47-reader-facts.test.ts:46` | 全文 |
| K3-tool-seams:mailboxToolSeam.handle（`H/K3-tool-seams.ts:155`） | 包装上述 definition 为 tools handle `:156` | 继承 D32 | `W/B2-01-blocked-commands.test.ts:39` | 全文 |
| S1-public-anchor:failingChangedFilesReader（`H/S1-public-anchor.ts:42`） | executions.readExecution 永远返回手写 rejected `:45`，其他依赖为空对象 `:50` | **D34：F4/默认拒绝**；不是“包真实依赖使其失败”的 A2 | `H/K3-35-continuation-fixture.ts:502` | 全文 103 行 |
| S1-public-anchor:publicArchiveWrite（`H/S1-public-anchor.ts:64`） | 从 sessionRef/revision/reason/requestId 组公开 archive 请求 `:66` | A1 产品输入 | 本文件 `:81,98` | 全文 |
| S1-public-anchor:registerPublicArchive（`H/S1-public-anchor.ts:78`） | 真 requestSessionArchive `:81`，检查实际 receipt `:85` | A1 | `H/K3-35-continuation-fixture.ts:796` | 全文 |
| S1-public-anchor:drivePublicArchive（`H/S1-public-anchor.ts:95`） | 真 archiveLine `:98`，检查真实返回 | A1 步骤；依赖 D34 时仍不合规 | `H/K3-35-continuation-fixture.ts:805` | 全文 |

`K3-tool-seams.ts:45,52,58` 的 latch，以及 shell 的 `arm/release/waitForCall`（`:72,74,77`），只控制 gate；问题在 gate 后没有执行真实工具并返回其实际结果。不能用 gate 的存在替 `:93`、`:146` 的假成功结果辩护。helper 内控制调用还包括 `H/B2-crr-world.ts:132,168`、`H/K3-35-continuation-fixture.ts:930,937,984`、`H/K3-review-card-fixture.ts:423,433,436,440`；harness 的动态 seam 控制在 `H/K3-35-continuation-fixture.ts:574,575`。

### S5、WP1 少改范围

| helper:function（file:line） | 改动及开放能力 | 判定 | 每个调用方 | 读全？ |
|---|---|---|---|---|
| S5-decision-fixture:openS5DecisionFixture（`H/S5-decision-fixture.ts:459`） | 新增 CRR/anomaly/control schemas `:443`；bodyPath 改 artifacts.sqlite `:494` | 改动与 A4 同 backend/body 接线兼容；不为旧 seed 出口背书 | 下方 S5 调用集合 | 限定范围 |
| S5-decision-fixture:reopen（`H/S5-decision-fixture.ts:1031`） | 用同一新 bodyPath 重开 `:1039` | A4 兼容 | `W/S5-decision-application.test.ts:272`；`W/S5-decision-queue.test.ts:53`；`W/S5-notices.test.ts:249`；`W/S5-request-candidates.test.ts:262`；`W/S5-user-messages.test.ts:358` | 限定范围 |
| S5-decision-fixture:candidateSourceOf（旧 `H/S5-decision-fixture.ts:369`） | 删除包装函数 | 非测试/断言删除 | 全树无残余调用 | 限定范围 |
| S5-goal-settings-support:openS5GoalSettingsFixture（`H/S5-goal-settings-support.ts:169`） | bodyPath 改 artifacts.sqlite `:203` | A4 兼容；旧造态能力未获准入 | `B/S5R2-settings-replay.test.ts:28`；`W/S5-goal-settings.test.ts:89` | 限定范围 |
| S5-goal-settings-support:reopen（`H/S5-goal-settings-support.ts:762`） | 同路径重开 `:770` | A4 兼容 | `W/S5-goal-settings.test.ts:575` | 限定范围 |
| S5R2-c-support:openS5R2CompletionFixture（`H/S5R2-c-support.ts:206`） | bodyPath 改 artifacts.sqlite `:240` | A4 兼容；旧造态能力未获准入 | `B/S5R2-settings-replay.test.ts:28`；`W/S2B-r2-conflict-catalog.test.ts:40` | 限定范围 |
| S5R2-c-support:reopen（`H/S5R2-c-support.ts:799`） | 同路径重开 `:807` | A4 兼容 | 无该 fixture 的直接调用 | 限定范围 |
| S5R2-d-support:openS5RuntimeFixture（`H/S5R2-d-support.ts:236`） | bodyPath 改 artifacts.sqlite `:270` | A4 兼容；旧造态能力未获准入 | `R/S5R2-agent-application.test.ts:68` | 限定范围 |
| S5R2-d-support:reopen（`H/S5R2-d-support.ts:804`） | 同路径重开 `:812` | A4 兼容 | 无该 fixture 的直接调用 | 限定范围 |
| WP1-entry-fixture:openGoalContentEntry（`H/WP1-entry-fixture.ts:171`） | preparation 新接同 records 的真实 readTaskClosure `:207` | A1，返回生产 reader 的实际结果 | `W/WP1-goal-content-entry.test.ts:56,64,80,88,100,112,126` | 限定范围 |
| WP1-entry-fixture:readTaskClosure 闭包（`H/WP1-entry-fixture.ts:207`） | 原样调用生产 plan reader `:208` | A1 | 本文件 preparation.prepare `:210` 及返回 preparation 的后续调用 | 限定范围 |

旧 `seedCommit/seedGoalSnapshot/seedPlanRevisionSnapshot/seedCandidateProposal/enterClaim/settleRun/storeSnapshot/lookupRefs` 能力仍暴露于 `H/S5-decision-fixture.ts:1022`、`H/S5-goal-settings-support.ts:753`、`H/S5R2-c-support.ts:790`、`H/S5R2-d-support.ts:795`。本次中性的 schema/path 改动没有把这些旧能力变成 A1；也没有据此把所有 S5 测试判禁。WP1 本次新增真 closure reader，同样不为其未改的其他返回能力作全面背书。

### 完整调用集合

每行是一个函数的全部直接调用点；本地同名函数、注释、类型声明和 import 不计调用。

| 集合 | 调用点 |
|---|---|
| C01 nextCall | `H/B2-blocked-runtime.ts:420`；`R/B2-01-shell-hook.test.ts:38`；`R/B2-02-approved-method.test.ts:35`；`R/B2-02-recognition-unified.test.ts:56`；`R/B2-04-allowance.test.ts:36`；`R/B2-05-06-denial.test.ts:37`；`R/B2-09-allowance-crash.test.ts:36`；`R/B2-13-allow-one-form.test.ts:26`；`R/B2-16-hook-closure.test.ts:44,119`；`R/B2-16-hook-reads.test.ts:52` |
| C02 openB2BlockedWorld | `R/B2-01-shell-hook.test.ts:34`；`R/B2-03-request-tool.test.ts:26`；`R/B2-04-allowance.test.ts:29`；`R/B2-05-06-denial.test.ts:30`；`R/B2-09-allowance-crash.test.ts:41,65`；`R/B2-13-allow-one-form.test.ts:30`；`R/B2-15-replay.test.ts:121,165`；`R/B2-16-hook-closure.test.ts:50`；`R/B2-16-hook-reads.test.ts:63` |
| C03 B2 answer | `R/B2-03-request-tool.test.ts:96`；`R/B2-04-allowance.test.ts:47,75`；`R/B2-05-06-denial.test.ts:60,82`；`R/B2-09-allowance-crash.test.ts:48,73`；`R/B2-13-allow-one-form.test.ts:37`；`R/B2-16-hook-closure.test.ts:67` |
| C04 B2 listRequests | `R/B2-02-recognition-unified.test.ts:170`；`R/B2-03-request-tool.test.ts:65,78,94,106,111,125`；`R/B2-04-allowance.test.ts:44,53,74,82`；`R/B2-05-06-denial.test.ts:59,66,69,75,81,87,90,95`；`R/B2-09-allowance-crash.test.ts:47,55,61,72,79,83,90`；`R/B2-13-allow-one-form.test.ts:36,49,53`；`R/B2-15-replay.test.ts:182,193`；`R/B2-16-hook-closure.test.ts:65,85` |
| C05 B2 close | `R/B2-01-shell-hook.test.ts:26`；`R/B2-03-request-tool.test.ts:24`；`R/B2-04-allowance.test.ts:26`；`R/B2-05-06-denial.test.ts:27`；`R/B2-09-allowance-crash.test.ts:33`；`R/B2-13-allow-one-form.test.ts:24`；`R/B2-15-replay.test.ts:56`；`R/B2-16-hook-closure.test.ts:42`；`R/B2-16-hook-reads.test.ts:50` |
| C06 runHook | `R/B2-01-shell-hook.test.ts:55,64,69,76,82`；`R/B2-02-approved-method.test.ts:84,87,90`；`R/B2-02-recognition-unified.test.ts:156,174,185,196,202,218,228`；`R/B2-04-allowance.test.ts:52,63,67,79`；`R/B2-05-06-denial.test.ts:64,65,85,86`；`R/B2-09-allowance-crash.test.ts:52,59,77,87`；`R/B2-13-allow-one-form.test.ts:46,52,57`；`R/B2-16-hook-closure.test.ts:80,95`；`R/B2-16-hook-reads.test.ts:182,209,217`；`R/B2-401-world.test.ts:56` |
| C07 runTool | `R/B2-02-recognition-unified.test.ts:165`；`R/B2-03-request-tool.test.ts:60,74,75,84,89,98,107,118,120`；`R/B2-04-allowance.test.ts:42,73`；`R/B2-05-06-denial.test.ts:58,67,80,88`；`R/B2-09-allowance-crash.test.ts:46,71`；`R/B2-13-allow-one-form.test.ts:35`；`R/B2-16-hook-closure.test.ts:63` |
| C08 blockedRecord | `H/K3-proposal-round.ts:261`；`B/K3-UR7-crr-failed-set.test.ts:358,405,449,468`；`S/K3-44-crr-kind4.test.ts:35`；`W/B2-07-crr-card-closed.test.ts:43,66,126`；`W/B2-07-crr-card.test.ts:40,81,120,174`；`W/B2-08-crr-answer.test.ts:60,90,104`；`W/B2-08-crr-cancel.test.ts:33`；`W/B2-09-answer-replay.test.ts:31`；`W/B2-UR7-crr-answer.test.ts:32` |
| C09 requestRerunOf | `S/K3-44-crr-kind4.test.ts:37`；`W/B2-07-crr-card-closed.test.ts:45,68,116,133,134`；`W/B2-07-crr-card.test.ts:42,84,122,176`；`W/B2-08-crr-answer.test.ts:62,92,106`；`W/B2-08-crr-cancel.test.ts:35`；`W/B2-09-answer-replay.test.ts:33`；`W/B2-UR7-crr-answer.test.ts:34` |
| C10 crrCardOf | `H/B2-401-world.ts:313`；`H/B2-blocked-runtime.ts:342`；`B/K3-UR7-crr-failed-set.test.ts:115`；`S/K3-44-crr-kind4.test.ts:38`；`W/B2-03-crr-request.test.ts:66`；`W/B2-07-crr-card-closed.test.ts:48,119`；`W/B2-07-crr-card.test.ts:43,89,177`；`W/B2-08-crr-answer.test.ts:34`；`W/B2-08-crr-cancel.test.ts:36`；`W/B2-09-answer-replay.test.ts:34`；`W/B2-14-crr-forms.test.ts:54`；`W/B2-18-request-reads.test.ts:182`；`W/B2-UR7-crr-answer.test.ts:35` |
| C11 openRealRunHarness | `B/K3-41-release-hold.test.ts:383`；`B/K3-review-workflow-rows.test.ts:119,401`；`H/B2-401-world.ts:189`；`H/B2-blocked-runtime.ts:143`；`H/B2-crr-world.ts:116,181`；`H/K3-35-continuation-fixture.ts:896`；`H/K3-blocked-command-fixture.ts:435`；`H/K3-review-card-fixture.ts:417`；`S/K3-29-startup-reconcile-2b.test.ts:87`；`W/K3-06-mixed-kinds-owner.test.ts:185`；`W/K3-15-disposition-effects.test.ts:166`；`W/K3-18-autonomy-facts.test.ts:79`；`W/K3-18-review-card-queue.test.ts:427`；`W/K3-26-unknown-call-review-storage.test.ts:218,555`；`W/K3-47-claim-gate.test.ts:182`；`W/K3-47-continuation-gate.test.ts:130`；`W/K3-47-reader-facts.test.ts:104`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:279` |
| C12 harness.claimRun | `B/K3-41-release-hold.test.ts:385`；`H/B2-401-world.ts:295,353`；`H/B2-blocked-runtime.ts:153`；`H/B2-crr-world.ts:120`；`H/K3-35-continuation-fixture.ts:905,960,1035`；`H/K3-review-card-fixture.ts:420`；`S/K3-29-startup-reconcile-2b.test.ts:90`；`W/K3-06-mixed-kinds-owner.test.ts:194`；`W/K3-15-disposition-effects.test.ts:169`；`W/K3-18-autonomy-facts.test.ts:83`；`W/K3-18-review-card-queue.test.ts:430`；`W/K3-26-unknown-call-review-storage.test.ts:245,281,573`；`W/K3-47-claim-gate.test.ts:186`；`W/K3-47-continuation-gate.test.ts:139,165`；`W/K3-47-reader-facts.test.ts:108`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:281` |
| C13 harness.prepareAndStart | `B/K3-41-release-hold.test.ts:387`；`H/B2-401-world.ts:298,356`；`H/B2-crr-world.ts:125`；`H/K3-35-continuation-fixture.ts:911,967,1040`；`H/K3-review-card-fixture.ts:424`；`S/K3-29-startup-reconcile-2b.test.ts:92`；`W/K3-06-mixed-kinds-owner.test.ts:196`；`W/K3-15-disposition-effects.test.ts:172`；`W/K3-18-autonomy-facts.test.ts:86`；`W/K3-18-review-card-queue.test.ts:433`；`W/K3-26-unknown-call-review-storage.test.ts:247,283,575`；`W/K3-47-claim-gate.test.ts:187`；`W/K3-47-reader-facts.test.ts:109`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:286` |
| C14 harness.createRecord | `B/K3-41-release-hold.test.ts:400`；`H/B2-crr-world.ts:128`；`H/K3-35-continuation-fixture.ts:982`；`H/K3-blocked-command-fixture.ts:357`；`H/K3-review-card-fixture.ts:434`；`S/K3-29-startup-reconcile-2b.test.ts:97`；`W/K3-15-disposition-effects.test.ts:185`；`W/K3-18-autonomy-facts.test.ts:98`；`W/K3-18-review-card-queue.test.ts:448`；`W/K3-26-unknown-call-review-storage.test.ts:293`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:294` |
| C15 harness.closeUnion | `B/K3-41-release-hold.test.ts:418`；`B/K3-review-workflow-rows.test.ts:121,407`；`H/B2-401-world.ts:402,417`；`H/B2-blocked-runtime.ts:183`；`H/B2-crr-world.ts:170,185`；`H/K3-35-continuation-fixture.ts:1056,1059`；`H/K3-blocked-command-fixture.ts:441`；`H/K3-review-card-fixture.ts:441`；`S/K3-29-startup-reconcile-2b.test.ts:107`；`W/K3-06-mixed-kinds-owner.test.ts:225`；`W/K3-15-disposition-effects.test.ts:193`；`W/K3-18-autonomy-facts.test.ts:105`；`W/K3-18-review-card-queue.test.ts:492`；`W/K3-26-unknown-call-review-storage.test.ts:224,565`；`W/K3-47-claim-gate.test.ts:196`；`W/K3-47-continuation-gate.test.ts:218`；`W/K3-47-reader-facts.test.ts:122` |

**openK3ReviewCardWorld 的全部调用方：**

`A/K3-15-review-routes.test.ts:74`；`B/K3-15-ur3h.test.ts:96`；`B/K3-17-goal-guard.test.ts:87`；`B/K3-41-release-hold.test.ts:356`；`B/K3-46-review-advance-failures.test.ts:421,453,478,503,526,627,661,690,739`；`B/K3-review-workflow-rows.test.ts:206,872,1069,1089,1116`；`B/K3-UR7-crr-failed-set.test.ts:356,402,447,466,543`；`H/B2-401-world.ts:177`；`H/K3-35-continuation-fixture.ts:893`；`H/K3-blocked-command-fixture.ts:534`；`R/B2-02-approved-method.test.ts:43`；`R/B2-02-recognition-unified.test.ts:76,127`；`R/K3-19-review-admission.test.ts:48`；`S/K3-20-review-card-paging.test.ts:78`；`S/K3-29-startup-answers.test.ts:116,149`；`S/K3-29-startup-reconcile-2b.test.ts:202,232,261,282`；`S/K3-44-crr-kind4.test.ts:33`；`W/B2-01-task-read.test.ts:77`；`W/B2-07-crr-card-closed.test.ts:41,64,99`；`W/B2-07-crr-card.test.ts:35,79,118,172`；`W/B2-08-crr-answer.test.ts:58,88,102`；`W/B2-08-crr-cancel.test.ts:31`；`W/B2-09-answer-replay.test.ts:29`；`W/B2-09-crr-owner.test.ts:66`；`W/B2-12-recognition.test.ts:195`；`W/B2-12-rewrite-prefix.test.ts:105,135,157,173`；`W/B2-18-request-reads.test.ts:95,138`；`W/B2-UR7-crr-answer.test.ts:30`；`W/K3-06-mixed-kinds-owner.test.ts:119,183`；`W/K3-13-two-items-owner.test.ts:52`；`W/K3-15-disposition-effects.test.ts:151`；`W/K3-15-hold-release.test.ts:65`；`W/K3-15-list-by-task.test.ts:52,71`；`W/K3-16-approval-application.test.ts:60`；`W/K3-16-proposal-round-fixture.test.ts:64`；`W/K3-16-proposal-write.test.ts:55`；`W/K3-16-second-unfinished-proposal.test.ts:42`；`W/K3-17-disposition-replay.test.ts:56`；`W/K3-18-autonomy-facts.test.ts:64`；`W/K3-18-requeue-confirmed.test.ts:117,161`；`W/K3-18-review-card-queue.test.ts:424`；`W/K3-26-unknown-call-review-storage.test.ts:207,551,710,736,752,779,875`；`W/K3-35-owner-manifest-trim.test.ts:41`；`W/K3-41-disposition-proof.test.ts:47`；`W/K3-43-continuation-vs-hold.test.ts:70`；`W/K3-43-review-claim-vs-hold.test.ts:47`；`W/K3-47-claim-gate.test.ts:61`；`W/K3-47-continuation-gate.test.ts:60`；`W/K3-47-reader-facts.test.ts:63`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:277`；`W/K3-48-3-required-writes.test.ts:56`。

**shellSeam.definition 的全部调用方：**

`A/K3-15-review-routes.test.ts:48`；`B/K3-15-ur3h.test.ts:49`；`B/K3-17-goal-guard.test.ts:37`；`B/K3-41-release-hold.test.ts:64`；`B/K3-46-review-advance-failures.test.ts:58`；`B/K3-review-workflow-rows.test.ts:56`；`B/K3-UR7-crr-failed-set.test.ts:65`；`R/B2-01-shell-hook.test.ts:21`；`R/B2-02-approved-method.test.ts:28`；`R/B2-02-recognition-unified.test.ts:41`；`R/B2-03-request-tool.test.ts:19`；`R/B2-04-allowance.test.ts:21`；`R/B2-05-06-denial.test.ts:22`；`R/B2-09-allowance-crash.test.ts:26`；`R/B2-13-allow-one-form.test.ts:19`；`R/B2-15-replay.test.ts:42`；`R/B2-16-hook-closure.test.ts:32`；`R/B2-16-hook-reads.test.ts:45`；`R/B2-401-world.test.ts:31`；`R/K3-19-review-admission.test.ts:37`；`R/K3-35-approved-methods-brief.test.ts:53`；`R/K3-35-review-input-size.test.ts:66`；`R/K3-35-T-by-hand.test.ts:83`；`R/K3-review-preparation.test.ts:53`；`S/B2-09b-allowance-crash.test.ts:78`；`S/K3-05-review-round.test.ts:69`；`S/K3-06-mixed-batch.test.ts:82`；`S/K3-08-wait-reply.test.ts:67`；`S/K3-09-restart-between-calls.test.ts:66`；`S/K3-10-review-round-cells.test.ts:65`；`S/K3-11-review-reasons-r2.test.ts:77`；`S/K3-12-14-review-round.test.ts:87`；`S/K3-13-two-commands.test.ts:61`；`S/K3-15-card-hold.test.ts:58`；`S/K3-16-approval-round.test.ts:70`；`S/K3-16-proposal-round.test.ts:65`；`S/K3-17-review-answer-shape.test.ts:70`；`S/K3-18-one-card.test.ts:66`；`S/K3-19-missing-read-no-round.test.ts:84`；`S/K3-19-review-unavailable.test.ts:72`；`S/K3-20-review-card-paging.test.ts:45`；`S/K3-25-attestation-replay.test.ts:41`；`S/K3-26-inventory-scenarios.test.ts:150`；`S/K3-27-review-claim-close.test.ts:83`；`S/K3-28-attested-continuation.test.ts:56`；`S/K3-29-disposition-recovery.test.ts:59`；`S/K3-29-maintenance-review-run.test.ts:64`；`S/K3-29-recovery-continuation.test.ts:63`；`S/K3-29-recovery-round.test.ts:76`；`S/K3-29-startup-answers.test.ts:38`；`S/K3-29-startup-reconcile-2b.test.ts:58`；`S/K3-29-startup-variants.test.ts:71`；`S/K3-37-stopped-review-round.test.ts:66`；`S/K3-42-truncated-command.test.ts:71`；`S/K3-42-unexpanded-r2.test.ts:71`；`S/K3-44-crr-kind4.test.ts:24`；`S/K3-44-hold-restart.test.ts:63`；`S/K3-44-recovery-answers.test.ts:60`；`S/K3-45-review-incomplete-r2.test.ts:79`；`S/K3-r1-seams.test.ts:71`；`S/K3-R1-second-cleanup.test.ts:70`；`W/B2-01-blocked-commands.test.ts:29`；`W/B2-01-task-read.test.ts:36`；`W/B2-03-crr-request.test.ts:21`；`W/B2-07-crr-card-closed.test.ts:30`；`W/B2-07-crr-card.test.ts:26`；`W/B2-08-crr-answer.test.ts:24`；`W/B2-08-crr-cancel.test.ts:22`；`W/B2-09-answer-replay.test.ts:20`；`W/B2-09-crr-owner.test.ts:43`；`W/B2-12-recognition.test.ts:31`；`W/B2-12-rewrite-prefix.test.ts:34`；`W/B2-14-crr-forms.test.ts:22`；`W/B2-17-disposition-reads.test.ts:21`；`W/B2-18-request-reads.test.ts:48`；`W/B2-UR7-crr-answer.test.ts:21`；`W/K3-06-mixed-kinds-owner.test.ts:57`；`W/K3-13-two-items-owner.test.ts:38`；`W/K3-15-disposition-effects.test.ts:57`；`W/K3-15-hold-release.test.ts:45`；`W/K3-15-list-by-task.test.ts:23`；`W/K3-16-approval-application.test.ts:48`；`W/K3-16-proposal-round-fixture.test.ts:38`；`W/K3-16-proposal-write.test.ts:38`；`W/K3-16-second-unfinished-proposal.test.ts:34`；`W/K3-17-disposition-replay.test.ts:27`；`W/K3-18-autonomy-facts.test.ts:40`；`W/K3-18-requeue-confirmed.test.ts:43`；`W/K3-18-review-card-queue.test.ts:94`；`W/K3-26-unknown-call-review-storage.test.ts:81`；`W/K3-35-owner-manifest-trim.test.ts:32`；`W/K3-41-disposition-proof.test.ts:26`；`W/K3-43-continuation-vs-hold.test.ts:50`；`W/K3-43-review-claim-vs-hold.test.ts:32`；`W/K3-47-claim-gate.test.ts:46`；`W/K3-47-reader-facts.test.ts:40`；`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:71`；`W/K3-48-3-required-writes.test.ts:40`。

**openS5DecisionFixture 的全部调用方：**

`A/S2A-decision-routes.test.ts:52`；`A/S5-decision-routes.test.ts:168`；`A/S5R2-driver-safe-point.test.ts:28`；`B/S5-decision-workflow.test.ts:186,224`；`B/S5R2-automation-cards.test.ts:24`；`H/K3-review-card-fixture.ts:131`；`H/S2A-notices-support.ts:45`；`H/WP2-duties-fixture.ts:101`；`R/S5-user-message-tools.test.ts:34`；`W/K3-39-tool-commit-lookup.test.ts:286,326`；`W/S2A-notices-since.test.ts:59`；`W/S2A-queue-bounds.test.ts:26`；`W/S2A-queue-card-semantics.test.ts:23`；`W/S2A-queue-derived-cards.test.ts:20`；`W/S2A-queue-goal-runs.test.ts:35`；`W/S2A-queue-request-candidates.test.ts:31`；`W/S2A-queue-window.test.ts:15`；`W/S4C2-U3.test.ts:98`；`W/S5-decision-application.test.ts:27`；`W/S5-decision-queue.test.ts:52`；`W/S5-notices.test.ts:28`；`W/S5-request-candidates.test.ts:56`；`W/S5-user-messages.test.ts:29`；`W/S5R2-queue-history.test.ts:22,194`；`W/WP2-context-extensions.test.ts:223,269,329`；`W/WP2-message-duties.test.ts:49`。

## 2. FINDINGS by rule

下列每行只有一个处置。共享修复路径名称是待实现的 helper 要求，不冒充当前已有 API。

- **真实平台共享出口**：在 `H/K3-35-continuation-fixture.ts:659` 的既有缓存 `hostPlatform()` 上增加窄公共出口；复用 `:636` 的同 backend/body 工厂；当前返回对象 `:836` 尚无这个出口。它须连接生产 runtime、messages、workspace、claims、decisions。
- **真实工具 gate**：包装实际工具 factory/handler，保持真实 capabilities，计数或 gate 后调用真实 handler，并原样返回实际结果；具体 fault 行只在真实依赖处注入 A2 失败。
- **真实 unavailable 场景**：以公开配置缩窄 Host 只读命令授权；让真实 Workflow 读取 capability 并 advance；生产判断在 `src/business/workflow/workflow.ts:1477`，生产 settle 在 `:2542`，由 Workflow 自己选择 cause。

### F1、默认拒绝的 prepared 输入

| 规则 | 每个实例及原因 | 唯一处置 |
|---|---|---|
| F1/F4 | `H/B2-blocked-runtime.ts:95` 重建 binding，`:325` 交 hook；`H/B2-401-world.ts:277` 也消费它；`R/B2-02-recognition-unified.test.ts:149` 还合并两个此类 binding | 删除 bindingOf；通过 `H/K3-35-continuation-fixture.ts:536` 的真实 preparation/Runtime 链取得并消费生产 binding |
| A1 默认拒绝 | `H/K3-blocked-command-fixture.ts:549` 对外接收 prepared；当前 `R/K3-review-preparation.test.ts:608` 的值是真 prepare 产生且 start 被拒绝，故不能说 F1 已成功发生 | 缺 helper：只接 runRef、模型回复和公开配置，在内部完成 prepare→受控并发取消→start；不再接受 prepared 参数 |

### F2

| 规则 | 每个实例及原因 | 唯一处置 |
|---|---|---|
| F2 | `H/K3-blocked-command-fixture.ts:144` 读取配置后，`:146` spread 覆写 shellWorkspaceAccess | 删除读后覆写；在最初可信 Host 配置中设置该授权 |
| F2 | `H/K3-proposal-round.ts:429` 读取配置后，`:431` spread 覆写 readonlyCommandAccess；既有配置 `H/K3-35-runtime.ts:94` 已明确给出该字段 | 删除这层覆写 wrapper |

### F3

| 规则 | 每个实例及原因 | 唯一处置 |
|---|---|---|
| F3 | `H/B2-blocked-runtime.ts:413` 手动驱动 before_tool；该 helper 的 later Run 在 `:169` 已取消，并未经过真实 entered 链 | 改用 `H/K3-35-continuation-fixture.ts:536`，让 scripted model 发真实 shell，由 Kernel 调 hook |
| F3 | `H/B2-blocked-runtime.ts:422` 手建 ToolCall，`:424` 直接执行 request_command_rerun handler | 在同一真实 Run harness 内让 scripted model 调真实 request_command_rerun |
| F3 | `H/K3-proposal-round.ts:705` 手建 ToolCall，`:708` 直接执行 proposal handler | 缺 helper：在实际 proposal Run 的脚本回复中调用 propose_safer_method，经生产 dispatcher 执行；真实工具调用 owner 的位置为 `src/core/agent-runtime/unknown-call-review-tools.ts:180` |
| F3 | `H/K3-proposal-round.ts:594` 由测试替 Host 发 settleReview，即使选 round_ended 也绕过实际 Workflow 判断 | 改由共享真实平台 Workflow.advance 完成 settlement；生产步骤 `src/business/workflow/workflow.ts:2542` |
| F3 | `H/K-boundary-facts-support.ts:79` append 手建 resumed/input_accepted | 缺 helper：公开 mailbox send→真实 Runtime/Kernel 接收；在 Kernel 保存后、平台位置保存前，用真实依赖 gate/fault 制造滞后 |
| F3 | `H/K-boundary-facts-support.ts:118` append 手建 assistant.message_completed/tool.started | 缺 helper：scripted model 发真实 read→Kernel 保存 tool.started→真实 read handler gate 保持在途→平台位置保存处注入故障 |

### F4

| 规则 | 每个实例及原因 | 唯一处置 |
|---|---|---|
| F4 | `H/B2-401-world.ts:219` 从 FILES map 返回手建 WorkspaceFile `:226` | 缺真实 workspace helper：把文件内容写进 world 的实际工作树，调用同平台真实 workspace reader；生产接线 `src/composition/create-platform.ts:754` |
| F4 | `H/B2-blocked-runtime.ts:260` 从 files map 返回手建 WorkspaceFile `:269` | 使用上一行的同一个真实 workspace helper |
| F4 | `H/K3-blocked-command-fixture.ts:406` 从 files map 返回手建 WorkspaceFile `:417`；记录 readPaths 不使其成为 A3 | 使用同一个真实 workspace helper，计数 wrapper 包实际 reader |
| F4 | `H/K3-crr-fixture.ts:121` 从 files map 返回手建 WorkspaceFile `:129` | 使用同一个真实 workspace helper |
| F4 | `H/K3-review-card-fixture.ts:139` 用可变 map 回答 Kernel command facts，默认 `:144` 返回假 not_found；`:312` 暴露 map | 删除假分支和 map 出口，统一使用既有真 reader `H/B2-crr-world.ts:206` |
| F4 | `H/K3-review-card-fixture.ts:162` 的 workspace reader 固定 not_found `:164` | 改接真实平台 workspace reader，通过真实不存在的文件得到实际 not_found |
| F4 | `H/K3-review-card-fixture.ts:200` 手写 recognize，返回自行组装的 exact 识别结果 `:205` | 使用生产 recognizer 接线 `src/composition/create-platform.ts:760` |
| F4 | `H/K3-review-card-fixture.ts:245` 固定 duties/readOnlyCopy/independentReview/guards | 接生产 `createMessageDutiesFactsAdapter`，真实接线 `src/composition/create-platform.ts:804` |
| F4 | `H/K3-review-card-fixture.ts:305` 向 conflict assembler 注入 executedFilesStub | 接生产 executed-files reader，现成接线 `src/composition/create-platform.ts:939` |
| F4 | `H/K3-proposal-round.ts:571` 为 record 的每个 alias 手填 full display `:573` | 接真实 manifest display reader；现成生产步骤为 `src/composition/create-platform.ts:715` 读 Run envelope、`:722` load manifest、`:725` 提取 display |
| F4 | `H/K3-crr-fixture.ts:154` requeue workspace root/revision 是假值 | 改调用共享真实平台 claims.requeueTask；生产入口 `src/composition/create-platform.ts:1234` |
| F4 | `H/K3-crr-fixture.ts:157` captureDigest 返回 `'a'.repeat(64)`，裁定明确禁止 | 同上，使用生产 requeue 的真实 `VerificationWorkspaceReader.captureDigest`；实现 `src/core/workspace/verification-workspace-reader.ts:28` |
| F4 | `H/K3-crr-fixture.ts:158` materials 空壳、`:160` message 固定 not_found | 同上，复用真实平台 requeue 的完整依赖，不保留这些替身 |
| F4 | `H/K3-prefix-claim.ts:93` requeue root/revision 是假值 | 改调用同一个共享真实平台 claims.requeueTask |
| F4 | `H/K3-prefix-claim.ts:96` captureDigest 返回 `'a'.repeat(64)`，裁定明确禁止 | 改调用同一个共享真实平台 claims.requeueTask，由生产 source capture 生成摘要 |
| F4 | `H/K3-prefix-claim.ts:97` materials 空壳、`:99` message 固定 not_found | 改调用同一个共享真实平台 claims.requeueTask |
| F4 | `H/K3-35-continuation-fixture.ts:494` requeue message reader 永远 not_found | harness.requeue 改委托同平台公开 claims.requeueTask，不另组消息依赖 |
| F4 | `H/K3-35-continuation-fixture.ts:239` fake mailbox 的空页、伪 cursor、not_found，通过 `:545` 注入 Runtime | 删除 fake mailbox，实施第 5 节的 shared real-mailbox 选项 |
| F4 | `H/K3-blocked-command-fixture.ts:165` 第二份 fake mailbox，同样有伪 sourceCursor `:167` | 删除第二份 fake mailbox，调用同一 shared real-mailbox 路径 |
| F4 | `H/K3-35-runtime.ts:112` 把请求 permissions/template 复制成授权成功；未执行生产当前配置/角色上限检查 | 让共享 harness 使用生产 runtime 授权接线；现成实现 `src/composition/create-platform.ts:468`，工具/写范围检查 `:512`，template 检查 `:530` |
| F4 | `H/K3-tool-seams.ts:93` shell gate 后手建成功结果；`:85` 还替换真实 capabilities | 用真实工具 gate 包装实际 shell factory/handler，原样返回真实结果 |
| F4 | `H/K3-tool-seams.ts:146` mailbox 对象的 definition 返回手建成功 | 用真实工具 gate 包装生产 mailbox tool |
| F4 | `H/K3-tool-seams.ts:146` read 对象的 definition 返回手建成功 | 用真实工具 gate 包装生产 read tool |
| F4 | `H/K3-35-continuation-fixture.ts:691` 允许成品 probe 替代真实 probe；出口为 `:700,711,766,771`；实际手填调用包括 `B/K3-review-workflow-rows.test.ts:403`、`W/K3-26-unknown-call-review-storage.test.ts:302` | 删除 probe 结果参数；缺 fault helper：在真实 Kernel/probe 依赖处注入失败，让生产 probe 自己生成 missing/damaged |
| F4/默认拒绝 | `H/S1-public-anchor.ts:45` 固定 rejected，不包装真实 execution reader；`:50` 其他依赖为空对象 | 缺故障 wrapper：接真实 execution reader、Kernel registry、workspaceHost，仅在指定真实 readExecution 调用上返回故障，其余保持真实委托 |

### F6

| 规则 | 每个实例及原因 | 唯一处置 |
|---|---|---|
| F6 | `H/B2-crr-world.ts:193` 直接写 cause=review_unavailable，平台没有先实际观察 unavailable | 使用真实 unavailable 场景 helper |
| F6 | `H/K3-blocked-command-fixture.ts:367` seed 直接选择 review_unavailable | 使用同一个真实 unavailable 场景 helper |
| F6 | `H/K3-review-card-fixture.ts:389` 默认 needsDecision 路径直接选择 review_unavailable | 使用同一个真实 unavailable 场景 helper |
| F6 | `H/K3-proposal-round.ts:874` reachAwaitingProposal 直接选择 review_unavailable | 使用同一个真实 unavailable 场景 helper |
| F6 输入能力 | `H/K3-proposal-round.ts:553` 允许调用方选 cause，`:595` 直接交 owner | 删除外部 cause 输入，由真实 Workflow 根据当前事实选择 settlement |
| 继承禁项、无调用 | `H/K3-proposal-round.ts:910` reachAwaitingApproval 只包装上述路径，当前全树无调用 | 删除该未使用出口 |

### F7

| 规则 | 每个实例及原因 | 唯一处置 |
|---|---|---|
| F7 | `H/B2-blocked-runtime.ts:248` 从 commit event.json 提取原始事件；`R/B2-04-allowance.test.ts:58` 用它断言 | 删除 crrEvents 暴露及该原始事件断言；保留该测试 `:53` 已有公开 listRequests 的 used/usedBy 断言；将此删除写入冻结 finding 表 |
| F7 | `H/B2-crr-world.ts:216` readMany→decodeRun；`W/B2-07-crr-card.test.ts:71,101,135,162` 用作断言来源 | 缺共享公开 Run reader：抽取 `H/B2-blocked-runtime.ts:119` 的现有读法，只接 runRef，调用生产 readExecution 返回实际 Run |
| F7 | `H/K3-35-continuation-fixture.ts:949` 直接读 TaskRequeue JSON，并在 `:953` 断言 archive 留下了 requeue | 改用共享真实平台的公开 readTaskRequeue；生产入口 `src/composition/create-platform.ts:1234` |

### F9

| 规则 | 每个实例及原因 | 唯一处置 |
|---|---|---|
| F9 | `H/B2-401-world.ts:157` 5ms sleep 轮询；open 和 startNext 都进入它 | 缺共享 entered gate：包真实入场依赖，真实入场保存完成时发信号，随后只作一次公共 read |
| F9 | `H/K3-blocked-command-fixture.ts:350` sleep 等待进入 | 使用同一个真实 entered gate |
| F9 | `H/K3-proposal-round.ts:356` sleep 轮询 entered | 使用同一个真实 entered gate |

### A5、A6/F11、F12、后端要求

| 规则 | 每个实例及原因 | 唯一处置 |
|---|---|---|
| A5/默认拒绝 | `H/K3-35-continuation-fixture.ts:181` 的纯 baseBrief 与 `:58` 起的平台/Runtime/store imports 混在一个模块；消费者为 `R/K3-15-blocked-omission.test.ts:29`、`R/K3-15-blocked-sentence.test.ts:14`、`R/K3-35-renderer-boundary.test.ts:21` | 提取纯 helper，只保留纯 assembler、输入构造和常量；这些纯消费者改用该模块 |
| A5/默认拒绝 | `H/K3-35-required-review-block.ts:10` 为纯提取函数反向导入混合 helper | 改依赖上述纯常量模块 |
| A5 | `R/K3-35-renderer-boundary.test.ts:21` 承载移出的纯极值行，仍不是 `*-pure.test.ts` | 改为纯测试文件并使用纯 helper |
| A6/F11 风险 | `H/B2-crr-world.ts:262` 构造 source 被 `W/B2-08-crr-answer.test.ts:111` 拒绝，但用例 `:101` 不在 rejects block，`:114` 又用关闭前 revision；不能证明只守一个错误 | 保留拒绝意图，置于 rejects block，使用关闭后公共 revision、有效其余参数，只保留“关闭对象无此选项”，保留 `:118` 的公共不变读；冻结表授权改变拒绝输入 |
| F12/双后端 | `H/K3-35-continuation-fixture.ts:889` 新增 SQLite-only guard；旧入口直接接受 kind，见 `.lead-ref/b3-helpers.diff:1801`；新 guard 见该 diff `:2249` | 删除过时 guard，三个调用 `R/K3-35-approved-methods-brief.test.ts:83`、`R/K3-35-T-by-hand.test.ts:102,155` 参数化 memory/SQLite |
| 双后端要求 | `H/B2-401-world.ts:177` 硬编码 SQLite；`R/B2-401-world.test.ts:43` 是 service/hook 场景，非 Host restart | 为工厂加入 backend 参数，并将这组行跑 memory/SQLite；不把新文件缺覆盖误称历史删 backend |

本 H 报告没有把所有计数器判成 F10：例如真实 commit wrapper 的计数与假 readPaths 是两种不同实现，分别见 `H/B2-401-world.ts:195`、`H/K3-blocked-command-fixture.ts:411`。是否守住各测试对应的“单次公开操作”边界，由相应 G 组逐行断言审计负责。

## 3. CALLERS OUTSIDE B3

按本次请求，以下 **31 个不同测试文件**加入 helper 整改影响范围。它们的测试内容没有因此被 H 冒充为全文审过。旧 K3/T 属性保留标注，交 lead 与对应测试审计归并；不能漏掉调用关系。

| B3 清单外测试 | 禁止调用 |
|---|---|
| `R/K3-35-review-input-size.test.ts:66` | shellSeam.definition，D31 |
| `S/K3-05-review-round.test.ts:69` | shellSeam.definition，D31 |
| `S/K3-06-mixed-batch.test.ts:82` | shellSeam.definition，D31 |
| `S/K3-08-wait-reply.test.ts:67` | shellSeam.definition，D31 |
| `S/K3-09-restart-between-calls.test.ts:66` | shellSeam.definition，D31 |
| `S/K3-10-review-round-cells.test.ts:65` | shellSeam.definition，D31 |
| `S/K3-11-review-reasons-r2.test.ts:77` | shellSeam.definition，D31；明确 T |
| `S/K3-12-14-review-round.test.ts:87` | shellSeam.definition，D31；含明确 T 的 K3-14 部分 |
| `S/K3-13-two-commands.test.ts:61` | shellSeam.definition，D31 |
| `S/K3-15-card-hold.test.ts:58` | shellSeam.definition，D31 |
| `S/K3-16-proposal-round.test.ts:65` | shellSeam.definition，D31 |
| `S/K3-17-review-answer-shape.test.ts:70` | shellSeam.definition，D31 |
| `S/K3-18-one-card.test.ts:66` | shellSeam.definition，D31 |
| `S/K3-19-missing-read-no-round.test.ts:84` | shellSeam.definition，D31 |
| `S/K3-19-review-unavailable.test.ts:72` | shellSeam.definition，D31 |
| `S/K3-25-attestation-replay.test.ts:41` | shellSeam.definition，D31 |
| `S/K3-26-inventory-scenarios.test.ts:150` | shellSeam.definition，D31 |
| `S/K3-27-review-claim-close.test.ts:83` | shellSeam.definition，D31 |
| `S/K3-28-attested-continuation.test.ts:56` | shellSeam.definition，D31 |
| `S/K3-29-disposition-recovery.test.ts:59` | shellSeam.definition，D31 |
| `S/K3-29-maintenance-review-run.test.ts:64` | shellSeam.definition，D31 |
| `S/K3-29-recovery-continuation.test.ts:63` | shellSeam.definition，D31 |
| `S/K3-29-recovery-round.test.ts:76` | shellSeam.definition，D31 |
| `S/K3-37-stopped-review-round.test.ts:66` | shellSeam.definition，D31 |
| `S/K3-42-truncated-command.test.ts:71` | shellSeam.definition，D31 |
| `S/K3-42-unexpanded-r2.test.ts:71` | shellSeam.definition，D31 |
| `S/K3-44-hold-restart.test.ts:63` | shellSeam.definition，D31 |
| `S/K3-45-review-incomplete-r2.test.ts:79` | shellSeam.definition，D31；明确 T |
| `S/K3-r1-seams.test.ts:71` | shellSeam.definition，D31 |
| `S/K3-R1-second-cleanup.test.ts:70` | shellSeam.definition，D31 |
| `S/K-R-attested-facts-source.test.ts:171,309,377` | injectAcceptedMessage、injectRunningToolCall，D09/D10；不是 T 名单中的 K-R-close-open-turn |

其余未改 K3 旧组按 `.lead-ref/k3-b3-rulings-v1.md:9` 保留 T 标识；本表依本次明确要求列出全部禁 helper 调用方，不以 T 为理由隐去命中。

另单列一个已核实的 T 实例：`W/K3-48-2-unknown-call-review-model-text-budget.test.ts:235` 非 proposal 半部直接 seed commit，`:250` 提供假 display reader；该文件 `:279` 的 harness 调用属于 proposal 半部，不能一起豁免。S5 中性路径改动的旧调用方不计入上述 31 个禁 helper 调用文件。

## 4. RUN-25

**能通过共享 harness 跑 memory 和 SQLite。当前源码已有这条双后端路径。** 这是静态可达性结论，不是本轮执行结果，也不意味着路径上的假工具、假授权已合规。

| 顺序 | 公开调用链与证据 |
|---|---|
| 1 | `W/K3-26-unknown-call-review-storage.test.ts:593` 的 RUN-25 行和 `:623` 的 replay 行都已使用 memory/SQLite 参数化 |
| 2 | 该文件 `:550` 的 ownerFixture(kind) 打开 world，在 `:555` 调 `openRealRunHarness(world,{gitWorkspace:true,takeover:TAKEOVER})` |
| 3 | `H/K3-35-continuation-fixture.ts:450` 在 world 的实际临时根初始化 git；真实 git helper `S/support/git-workspace.ts:92` 执行 init/add/commit；harness `:456` 排除 ledger/body/Kernel SQLite 文件 |
| 4 | 测试 `:571` 的 startedUnknownRun 建真实 Session，`:573` 公开 claim，`:575` 用 scripted shell 调 prepareAndStart，并在 `:580` 选 prepareViaRuntime |
| 5 | `H/K3-35-continuation-fixture.ts:555` 调 Runtime.prepareExecution；生产 `src/core/agent-runtime/execution-preparation.ts:514` 触发 baseline，`:143` 解析真实 root，`:158` 保存真实 baseline Artifact |
| 6 | harness `:576` 真 start；生产 Runtime/Kernel 产生实际 Run、Turn、tool.started。当前受控 shell seam 须按 D31 修正，但不需要测试手造 entry |
| 7 | harness `:687` 公开读取 execution，`:691` 真 probe，`:694` 调真实 platform.reconcile.reconcileRun |
| 8 | SQLite 由 harness `:661` 重开同目录；memory 由 `:637` 共享同 records，`:646` 共享同 bodies，`:652` 构造真实 platform；这是 A4 |
| 9 | harness `:609` 将 Host takeover 放进 hostInstance，`:693` 向 classifier 传同一证明；SPEC `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:138` 明确允许服务层 memory 后端使用 hl03_stale_lock Host 证明 |
| 10 | 生产 `src/composition/create-platform.ts:1972` 调真实 startup reconcile；`src/core/agent-runtime/run-reconcile.ts:451` 检查用途、证明、containment、closure、capture/baseline，`:476` 由真实 reader 产生 candidate |
| 11 | `src/composition/create-platform.ts:1884` 从真实 prepared baseline 和实际 filesystem capture 产生 workspace capture，测试不传成品 draft |
| 12 | `src/core/work-graph/state/run-machine.ts:2430` 执行 guards，`:2469` 生成 review，`:2492` 生成结束 Run、释放 lease、创建 review 的 effects |
| 13 | `src/core/work-graph/tasks/run-reconcile-service.ts:729` 收集 review effects，`:772` 形成同一个 PreparedCommit，`:779` 一次 commit |
| 14 | 测试 `:600` 后用公开 review/execution reads 检查结果；`:628` replay 使用相同报告和公开读取的不变 revisions，符合裁定 §3.1 |

`memory backend` 与 `takeover.kind='memory_store'` 不是同一个条件；SPEC `:138` 已明确区分。`H/K3-35-continuation-fixture.ts:889` 的“memory world 对 Host 不可见”理由，已被同文件 `:636` 的 A4 接线推翻。

## 5. The real-mailbox option

应加在 **`H/K3-35-continuation-fixture.ts` 的共享 harness**，具体入口是 `prepareAndStart`（`:536`），使用既有私有 `hostPlatform()`（`:659`）。

当前 `:836` 返回对象没有 `platform()`，因此不能把它写成现成 API。需要增加窄公共读/调用出口，并让 helper 内部复用同一个缓存 platform。

必须同时完成以下接线：

| 步骤 | 精确要求 |
|---|---|
| 共享存储 | 复用 harness `:636` 的 A4 records/body 接线，不创建第二个独立 backend |
| 共享配置 | `H/K3-35-continuation-fixture.ts:623` 当前固定 `['read']`；必须按各 Run 的公开 tools/writeScope/model 输入保存可信配置，使 prepare/start 与 platform runtime authorization 读取同一配置 |
| 真实授权 | 使用生产 `src/composition/create-platform.ts:468` 的授权链；`:512` 会检查工具/写范围，不能继续用 `H/K3-35-runtime.ts:112` 的 echo |
| 真实 duties | 使用 `src/composition/create-platform.ts:804` 的 message duties adapter，读取真实 roles/Sessions |
| 真实 mailbox | 使用 `src/composition/create-platform.ts:816` 创建的 mailbox，`:820` 接真实 runtimeAdmission，`:1312` 是公开 wrappers |
| Runtime 注入 | `prepareAndStart` 的 realMailbox 选项在 `H/K3-35-continuation-fixture.ts:542` 接入同 platform.messages/decisionMessages，删除 `:239` 的 fake mailbox |
| 公开出口 | 生产 platform 在 `src/composition/create-platform.ts:2154` 暴露 messages，`:2166` 暴露 runtime/workflow/workspace，`:2171` 暴露 decisionMessages/decisions |
| requeue 同步修复 | harness.requeue 改用生产公开 claims.requeueTask `src/composition/create-platform.ts:1234`，消除 `H/K3-35-continuation-fixture.ts:494` 的假消息读 |

`W/K3-47-continuation-gate.test.ts` 应走这一条确定路径：

1. 用真实 Session helper 建 A、B Session，调用现有 harness.claimRun 领取 A；当前调用位置 `W/K3-47-continuation-gate.test.ts:139`。
2. 用共享 prepareAndStart，`realMailbox:true`，脚本调用真实 `send_session_message({recipient:B,text,replyMode:'wait'})`；真实 schema 在 `src/core/agent-runtime/communication-tools.ts:309`，真实 mailbox send 在 `:414`，wait 注册在 `:421`。
3. 等待 A 的真实 Runtime 结束；从公开 execution 的 `ended/yielded/wait_reply` continuation 取得实际 messageRef；当前测试已有真实结果读取位置 `W/K3-47-continuation-gate.test.ts:158`。
4. 调同平台公开 messages.readMessage，取得实际 message revision；公开 wrapper 在 `src/composition/create-platform.ts:1312`。
5. 领取 B 的真实 reply Run，用共享 prepareAndStart 的脚本直接调用真实 `respond_session_message({messageRef,expectedRevision,text})`；schema 在 `src/core/agent-runtime/communication-tools.ts:332`，执行在 `:462`。
6. 等待 B 完成，再公开 readMessage 取得真实 response.bodyRef。
7. 以实际 A.runRef、messageRef、response.bodyRef 组成公开 claimTask 的 consumedWait；不手填消息记录、cursor、prepared 值。
8. 只在目标 claim 的真实 records read 上开启既有 A2 fault wrapper；当前合规 wrapper 位于 `W/K3-47-continuation-gate.test.ts:69`。
9. 用公开 Task/Run 读证明没有新 continuation；删除该测试 `:96` 的 store 投影断言路径。
10. 删除测试自行组装的两套 Runtime/prepare（`W/K3-47-continuation-gate.test.ts:147,152,173,179`）和 readToolSeam 路径 `:46`；B 直接调用真实 respond 工具，不需要假 read 阻塞。

不能改用名字为 `realOwners` 的另一份工装：`H/S5-user-message-support.ts:55` 固定 duties，`:62` echo authorization，仍是 F4。

## 6. STATIC claims

| 声明 | 静态核对结果 |
|---|---|
| “closeout defects 0” | `.lead-ref/k3-g4b3-closeout-grep.txt:3` 的旧结论不能作为 v1 准入；当前仍有 `H/K3-tool-seams.ts:93` 的假成功、`H/K3-proposal-round.ts:571` 的假 display、`H/K3-crr-fixture.ts:157` 的固定 digest |
| “gate/seam 没有手建事实” | `H/K3-tool-seams.ts:16` 的说明不能覆盖 `:93`、`:146` 的手建结果；A3 要求返回真实结果 |
| “proposeK3SaferMethodWithTool 是 scripted model 路径” | 实际为 `H/K3-proposal-round.ts:705` 手建 ToolCall、`:708` 直接 handler.execute |
| “empty mailbox 没有发送，所以不是假事实” | `H/K3-35-continuation-fixture.ts:239`、`H/K3-blocked-command-fixture.ts:165` 仍通过读口返回手建空页、cursor、not_found；F4 不以是否发送为条件 |
| “Kernel facts map 是 port double，所以允许” | `H/K3-review-card-fixture.ts:134` 的注释不是 A7；实际替身在 `:139`；全树未发现调用方写入 world.kernelCommands，故不声称存在已发生的 map 注入写 |
| “padded record 还送 RUN-22” | `H/K3-padded-review-record.ts:11` 的说明过时；当前调用仅见纯测试 `R/K3-48-3-extremes-pure.test.ts:93,94,202`，不能凭旧注释误报当前成功 F1 |
| “S1 anomaly owner/A8 都调用此 shared helper” | `H/S1-public-anchor.ts:4` 的说明与当前调用图不符；实际入口调用方为 `H/K3-35-continuation-fixture.ts:502,796,805` |
| “D1 的 B401_R 命中就是 F8” | `.lead-ref/d1-k3g4b3-r8.txt:5` 对应测试 helper 常量 `H/B2-401-world.ts:60`，不是 src 常量，不能机械判 F8 |
| “删除 large helper 表明覆盖等价迁移” | `.lead-ref/d1-k3g4b3-r8.txt:486` 只证明删文件本身为 0 tests/0 expects；不能证明调用方断言等价；当前全树无该已删 helper 的残余调用 |
| “所有 helpers 的断言削弱已清完” | D1 的当前 H helper 条目没有直接 removed/loosened assertion 或 raised timeout；但本报告建议删除的原始事件断言、无调用出口仍须由 lead 纳入冻结 finding 表，不能由实现者自行批准 |
| “当前快照已验证测试通过” | 本轮未运行测试/构建；历史 rework 报告的通过数字没有被本轮重新验证；当前目录无 `.git`，没有据此独立验证 tag 指向 |

### OPEN QUESTIONS

以下三项保持未裁定；不借 OPEN 放行，未获准前按 default deny 管理。

| 编号 | 精确边界 | 最小选项 |
|---|---|---|
| OPEN-1 | `H/K3-review-card-fixture.ts:99,329`、`H/K3-proposal-round.ts:169` 内部构造原生 PlanRevisionDraft，再调公开 propose/apply；A1 禁 helper 接 draft，F1 又列 built draft，但当前 helper 接的是 taskId/disposition | lead 明确这是 A1 原生产品命令；或认定当前形状禁止并指定用户实际采用计划的公开入口。H 不把 PlanDraft 自动等同 Host review draft，也不自行豁免 |
| OPEN-2 | `H/K3-35-continuation-fixture.ts:515`、`H/K3-proposal-round.ts:330` 直接读 Workspace JSON，仅用于下一公开写的 revision pin，没有从该值断言业务结果 | 明确允许这种 pin 读取；或要求统一改成公开 workspace read。不能未加区分就报 F7 |
| OPEN-3 | `H/K3-review-card-fixture.ts:261` 的 applicationReceipt 从真实 eventAt/JSON 提取 receipt `:264,270`，交 coordinator `:291`；不是字面量成功，也不是测试断言，但属于测试自写读适配器 | 明确视为 A1 组合代码；或移除该测试适配器，统一使用真实 platform decision 接线。不能仅因使用真实 store 就自行归入 A3 |

### SEARCH LOG

| 搜索/阅读项 | 覆盖与处理 |
|---|---|
| H 文件清单 | 逐项对照 `.lead-ref/groups/H.txt` 的 23 个当前文件；16 个主体全文读，7 个按用户限定审全部改行及开放能力；K-boundary 额外全文读 |
| 变更 | 核对 `.lead-ref/b3-helpers.diff`；区分当前 23 个 helper 与已删除的 K3-large-review-input |
| 规则与裁定 | 全文读 `.lead-ref/test-rule-sheet.md`、`.lead-ref/k3-b3-rulings-v1.md`；以 default deny、A7 空名单及撤销的 multi-item ruling 为准 |
| D1 | 全文读 `.lead-ref/d1-k3g4b3-r8.txt` 共 491 行，按全部 H 文件名复查 |
| 历史 | 读 `k3-g4b3-impl.md`、rework 6/7/8、rework8-final、closeout-grep、review8；历史准入不覆盖新规则 |
| 规格 | 全文读 `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`，并沿 RUN-25、prepare、reconcile、capture、mailbox、Workflow settlement 的生产调用链核对 |
| 调用搜索范围 | 搜索整个 `tests/` 树的 827 个文件；辅助查 `.ts/.tsx/.js/.mjs`；不局限 B3 文件 |
| 搜索键 | 全部导出函数名、helper 模块路径、重导出、对象方法、seam.definition/handle、seed/startPrepared/createContinuationRun、probe override、commit/readMany/eventAt、fake digest、prepared/binding、sleep |
| 去误报 | 排除 import、类型、注释；排除其他文件的本地同名 baseBrief/workRunCtx/reviewCardOf/runTool/sha256Of；不将 `H/K3-crr-fixture.ts:129` 的本地 sha256Of 算成另一个 helper 的调用 |
| 外扩对照 | 将实际调用文件与 `.lead-ref/b3-files.txt` 比对；得出 31 个不同的 B3 外禁 helper 调用测试 |
| 工具限制 | `rg` 不可用，使用只读 PowerShell Select-String/Get-Content 和带行号的 findstr；UTF-8 文本通过原始输出复核；未使用测试或构建命令 |

H: helpers read 23/23; forbidden functions 34; callers outside B3 31; open questions 3