# L8 findings by business consequence (lead workflow, 2026-10-18; Chinese)

Each finding of the L8 audit (`codex/audit.out.md`) and verification (`codex/verify2.out.md`) classified as behavior_bug (production does something wrong a person or agent can meet), protection_gap (no test guards a real business behavior), form_only (test form only; another real-path test guards the behavior) or hygiene (no visible consequence). A first analyst classified, a second checked against the code (copies at s8l8-r1 and s8l8-r2); `changes` are the second pass. The lead's decision from it is in books `l8-rework-3.md` and `l8-rework-4.md` and `user-decisions-1018.md`.


## l8 — counts {"behavior_bug": 7, "protection_gap": 2, "form_only": 19, "hygiene": 27}

| id | category | area | consequence | confidence |
| --- | --- | --- | --- | --- |
| K1 | behavior_bug | 跨工作区架构观测读取 | 同一仓库开两个内容相同的工作区（clone 或 worktree）时，后登记的那个工作区读不出自己的观测：准备时只显示「架构提醒不可用」，文件图页打不开，之后每次抓取读前图都失败，一直停在「失败」。 | high |
| K2 | behavior_bug | 自动抓取失败记录 | 抓取开始时读观测状态出错（存储故障或记录损坏）时，这一轮不出声就结束，请求一直挂着「待抓」却没有失败原因，人看不出架构图为什么不更新。 | medium |
| K3 | hygiene | 准备阶段的取消 | 无业务后果 | high |
| K4 | form_only | 测试取状态与断言方式（含旧 WP2 健康事实） | 无业务后果 | medium |
| K5 | form_only | Host 关闭接线测试 | 无业务后果 | medium |
| T01-T14 | form_only | 测试前置状态（计划草稿、Host 输入） | 无业务后果 | high |
| T15-T32 | protection_gap | 自动抓取串行、待抓水位与架构提醒规则 | 删掉对应生产检查后测试仍能通过：全 Host 串行（删掉后同一工作区两轮抓取会并发，后一轮被记成失败）、没目录或没任务模块时只报移动、移动按删除和新增各自唯一来判、运行中新来的请求在第一轮成功后仍算待抓；这些规则坏了，agent 会看到错的或漏掉的架构提醒，Host 重启后也可能不再补抓。 | high |
| T33-T50 | form_only | 旧 WP2 共用夹具 | 无业务后果 | medium |
| T51-T69 | form_only | 旧 WP2 上下文与回复测试 | 无业务后果 | medium |
| T70-T71 | form_only | 状态写入架构检查白名单 | 无业务后果 | medium |
| P01 | behavior_bug | 自动抓取请求写入 | 写请求时存储出错，这次触发就整个丢了：不留待抓记录，重启也不补，新工作区可能一直显示「还没有观测」，要等下次采用目录或检查通过才会再抓。 | medium |
| P02 | behavior_bug | 自动抓取失败记录 | 抓取开始时读请求记录出错，这一轮不出声就结束，请求仍挂「待抓」却没有原因，要等下次触发或重启才重试（lead 已记为已知限制）。 | low |
| P03 | behavior_bug | 自动抓取失败记录 | 抓取失败后连失败记录都写不进去时，错误被吞掉，请求显示「待抓」而不是「失败」，人看不到失败原因（两处同时出故障才会发生）。 | low |
| P04 | behavior_bug | 启动补抓 | Host 启动扫描时某个工作区读状态出错就被跳过，这次启动不补抓它，也没有任何提示。 | low |
| P05 | hygiene | 取消语义（请求写入） | 无业务后果 | high |
| P06 | hygiene | 取消语义（失败写入） | 无业务后果 | medium |
| P07 | hygiene | 取消语义（读取） | 无业务后果 | high |
| P08 | hygiene | 取消语义（读取） | 无业务后果 | high |
| P09 | hygiene | 取消语义（抓取重放） | 无业务后果 | medium |
| P10 | behavior_bug | 添加工作区触发抓取 | 在设置里添加工作区时，如果登记已提交、之后 Kernel 存储注册或对账出错，用户重试会看到工作区已绑定，但这次登记该触发的首次架构抓取再也不会发生。 | medium |
| P11 | hygiene | Host 关闭顺序 | 无业务后果 | medium |
| P12 | hygiene | 工作区 scope 键 | 无业务后果 | medium |
| P13 | hygiene | 触发类型规则重复 | 无业务后果 | high |
| P14 | hygiene | 失败原因长度上限重复 | 无业务后果 | high |
| P15 | hygiene | 无用 import | 无业务后果 | high |
| P16 | hygiene | 手动抓取 HTTP 接口字段隔离 | 无业务后果 | medium |
| S01 | hygiene | 过时注释 | 无业务后果 | high |
| S02 | hygiene | 过时注释 | 无业务后果 | high |
| S03 | hygiene | 依赖声明 | 无业务后果 | high |
| S04 | form_only | 测试注释 | 无业务后果 | high |
| S05 | hygiene | actor 类型声明 | 无业务后果 | high |
| S06 | hygiene | 触发 scope 固定时机 | 无业务后果 | high |
| S07 | hygiene | 触发 scope 固定时机 | 无业务后果 | high |
| S08 | hygiene | 触发 scope 固定时机 | 无业务后果 | high |
| S09 | hygiene | 后台诊断 | 无业务后果 | high |
| S10 | hygiene | 后台诊断 | 无业务后果 | medium |
| S11 | hygiene | 后台诊断 | 无业务后果 | medium |
| S12 | hygiene | 关闭时失败写入 | 无业务后果 | medium |
| B-1 | hygiene | 取消语义（抛错同时取消） | 无业务后果 | medium |
| B-2 | hygiene | 取消语义（提交失败后取消） | 无业务后果 | high |
| B-3 | hygiene | 取消语义（提交后改报取消） | 无业务后果 | high |
| C-1 | hygiene | 准备阶段的取消 | 无业务后果 | high |
| V3-1 | form_only | 测试前置状态 | 无业务后果 | high |
| V3-2 | form_only | 测试前置状态 | 无业务后果 | high |
| V3-3 | form_only | 测试 helper 参数 | 无业务后果 | high |
| V3-4 | form_only | 测试等待方式 | 无业务后果 | high |
| V3-5 | form_only | 测试等待方式 | 无业务后果 | high |
| V3-6 | form_only | 准备读取次数计量 | 无业务后果 | medium |
| V3-7 | protection_gap | 全 Host 抓取串行 | 把串行检查删掉，这一行照样能过；可那时一个工作区抓取还没跑完、又来触发，就会马上并发开第二轮，后一轮提交撞上指针版本冲突，被记成一次失败，还会同时跑多个分析器。 | medium |
| V3-8 | form_only | 拒绝行分组 | 无业务后果 | high |
| V3-9 | form_only | 拒绝行分组 | 无业务后果 | high |
| V3-10 | form_only | 断言削弱（前提） | 无业务后果 | medium |
| V3-11 | form_only | 断言削弱（memory 后端） | 无业务后果 | high |
| V3-12 | form_only | 断言削弱（计数场景） | 无业务后果 | medium |
| V3-13 | form_only | 断言削弱（显式取消） | 无业务后果 | medium |

### Second-pass changes

- **K3**: behavior_bug → hygiene. r1 里任务的 prepare 只有两个生产调用方。一是协作驱动的 Workflow 循环：它的 handle.abort 从来没被 abort 过（collaboration-driver.ts:1043 创建后没有任何地方调用 abort），停止时先置 stopRequested，拿到结果后在 :819 直接 break，不会走到 start。二是 HTTP workflow/advance：只有客户端断开或 120 秒超时才取消，结果发给已经离开的客户端。prepare 不提交任何事实，只留下一份没人引用的 manifest 正文，下次推进会重新准备。另外，「降级成架构提醒不可用」要求取消那一刻读取正好独立抛错（底层存储读取不看 signal），而「取消后仍 ready」时生成的提醒内容是对的。没有 Run 会带着错误提醒启动，处理口径和 B-1～C-1 一致。
- **K4**: protection_gap → form_only. K4-01～16 是伪触发、重复服务行、读库断言，真实接线和公开读取都有别的行守着。K4-25～45 的 recordHealth 走的是真实 owner `reconcile.recordSessionHealth`（WP2-wiring.test.ts:131），只是 Kernel 探测结果由测试注入。真实 Kernel 丢失和恢复有 A8-host-restart、S2C-K-unknown-outcome 等用 moveKernelAside 的场景覆盖。原分析写的「真实 Kernel 故障下崩溃恢复坏了也测不出」夸大了。K4-46～53 是期望值来源的问题。剩下唯一没守住的规格行为是 K4-17～23「每次 prepare 每份观测只读一次」，它是读取次数（性能）上限，多读不会让人或 agent 看到错误结果。
- **K5**: protection_gap → form_only. 真实 Host 重启后补抓待抓请求，已由 S8A-L8-host-restart.test.ts:65（第三个 Host 用 startup_retry 恰好补抓一次）和 auto-capture-host:119 守住。关闭时排着队的请求在重启时也是 pending，走的是同一条路径。K5 真正漏掉的只有关闭顺序（P11），而 P11 没有业务后果，见下一条。
- **P11**: behavior_bug → hygiene. 抓取走 core/workspace 的文件读取和 platform.architecture，不经过已先关闭的 workbenchTools/Kernel。r1 的 autoCapture.close 仍在 platform.close 之前，会 abort 正在跑的那一轮并等它结束。关闭窗口里新开的那轮要么跑完（观测照常更新），要么被 abort（不写失败，保持 pending，重启后补抓，这条路径有真实 Host 测试守着）。不会因为组件已关而留下失败记录，唯一的影响是关机时多跑一次分析器。
- **P16**: behavior_bug → hygiene. 界面的 buildObservedCaptureRequest（ui/views/setup/requests.ts:200）从不发 requestSeq。agent 的工具 project-source-tool 调的是 workspace.captureSourceChanges，不是架构抓取。src 和 tools 里没有别的客户端调 architecture/capture，只有持 Host token、自己手写脚本的人才发得出这个字段。这和原分析把 P12 归为 hygiene 是同样的可达性。
- **T51-T69**: protection_gap → form_only. 逐条核对了原分析说的 5 处「可空过」：T56 的 not.toMatchObject ready 在陌生 Goal 被当成功返回时会失败，行为是守住的，只是没核错误码。T57 的 [] 兜底只在 readMessage 本身失败时生效，正常路径下迟到回复被收下会失败。T54 想证明的「Work 上下文带上待决来源」，F06 在 :462–464 用 toContain(cardRowText) 已经断言。T53 只在已绑定 Run 的 envelope 整个丢失这种别的缺陷下才空过。T58 只是队列和上下文用同一函数自洽（F8），用户看不到差别。T59–T69 只缺 memory 后端，而 main.ts:178 固定用 SQLite。
- **T15-T32**: protection_gap → protection_gap. 类别不变，后果改写。T28（memory 正文库）、T30（时间阈值文字）、T32（第三排序键）、T27（改名）和 T16–T23 的 sleep 大多是形式问题。真正有业务分量的是 T24、T25、T26、T29、T31。全 Host 串行这条控制（pump 里的 running!==null）同时也挡住了同一工作区两轮抓取并发，后一轮会撞指针 CAS 被记成失败；这一点原后果没写。
- **V3-7**: protection_gap → protection_gap. 类别不变，后果补充。删掉串行检查后，正在跑的工作区再来触发会被立刻重新入队并并发开跑（accept 时 queue 里已没有该 key），architecture-service.ts:1206 起的指针 CAS 会把后一轮变成 revision_conflict 失败记录。所以后果不只是负载变高。

### Notes

结论：Codex 指出的问题大多数和业务无关。55 项里有业务后果的只有 9 项（behavior_bug 7 项，protection_gap 2 项），其余 46 项是规则合规、测试写法（form_only 19 项）或代码整洁（hygiene 27 项）。比原分析的 15 项又少了 6 项。

改判的 6 项：
- K3 改为 hygiene；
- K4、K5、T51–T69 改为 form_only；
- P11、P16 改为 hygiene。

T15–T32 和 V3-7 类别不变，后果改写了。核对方法：先在 D:\cxt\s8l8-audit 的 r1 代码上判断审计当时能否走到，再看 r2（s8l8-review3）。没有改文件，没有跑测试。

真正有业务后果的：
- **K1（最重，确认属实）。** 正文库按内容寻址，同样内容的正文只留第一次写入的来源（body-store.ts:39，key 只含 contentType|digest|size）；读分块时要求来源属于当前工作区（r1 architecture-service.ts:698）。同一仓库的两个 worktree，节点分块内容相同，后登记的那个读不出观测，提醒和文件图都坏；而且每次抓取都要先读前图（r1 :1044），所以之后的抓取永远失败。r2 已修。
- **K2、P01–P04、P10。** 都只在存储或 Kernel 注册出故障时才出现，后果是后台不出声、架构图不更新、看不到原因。其中 P01 最实在：整个触发丢掉，重启也不补。lead 已把 P01–P04、P10 记为已知限制。K2 和 P02 是同一种模式。
- **T15–T32 里 5 条真缺口。** T24 串行、T25/T26/T31 提醒规则、T29 第一轮成功后仍待抓。V3-7 是 r2 里 T24 的残留。

降级的理由：
- **K3。** 由 lead 列为 KNOWN 必修，但它是取消契约问题，没人能观察到后果。协作驱动的循环 signal（handle.abort）在 r1 和 r2 都从没被 abort 过；停止靠 stopRequested 加正式 cancel，拿到 prepare 结果后直接 break。HTTP 路径的结果发给已断开的客户端。prepare 只留下一份没人引用的 manifest 正文。这一点和原分析把 B-1～C-1 判为 hygiene 是同一口径。
- **K4。** 旧 WP2 的健康事实走的是真实 owner `recordSessionHealth`，真实 Kernel 丢失有 A8、S2C-K 场景守着。它守的那条规格「每次准备每份观测只读一次」是性能上限。如果 lead 认为性能上限也算业务，K4 和 V3-6 可以改回 protection_gap，那就是 11 项有业务后果。
- **K5 和 P11。** 重启补抓已有真实 Host 测试守着。关闭顺序晚了，只是关机时多跑一次分析器：抓取不依赖已先关闭的组件，autoCapture.close 仍在 platform.close 之前。
- **P16。** 只有手写 HTTP 脚本才发得出 requestSeq，界面和 agent 工具都不发，和 P12 同类。
- **T51–T69。** 原分析说的 5 处「可空过」里，3 处其实守住了（T54 由 F06 的 toContain 守着，T56、T57 在正常路径下会失败）。剩下 T53、T58 只在别的缺陷下空过，或者只是自洽检查。

维持原判、复核过的：
- B-1～B-3、C-1、P05–P09、S12。r2 里请求写入仍用新建的 signal（driver.ts:109），失败写入的结果驱动不看，上游读取只在 signal 已 abort 时才返回 cancelled（graph-context-reader.ts:1348）。
- T01–T14、T33–T50、T70–T71、V3 里的形式项。

顺带发现（不在 55 项内）：协作驱动的 handle.abort 注释写着「aborted only by close」，但 close 实际不 abort 它（collaboration-driver.ts:1089–1094）。所以经由驱动的 Work 准备不会被 signal 取消，靠的是 stopRequested。
