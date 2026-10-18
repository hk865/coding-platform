**本轮不能判为全部完成。** 分块格式的主体修复成立，但取消语义、部分测试路径、计数方法和覆盖保留仍有必须处理的缺口。实现者的 “A–G done；BLOCKED none” 与代码不符。

本次只读，未写文件、未运行测试、未等待 bubblewrap。该副本没有 `.git`，因此标签及提交身份未独立验证；以下依据提供的两轮 diff、两份 ledger 和当前文件。所有运行结果、RED/GREEN 和测试通过数量均视为实现者声明。下文 **STATIC** 表示静态追踪结论，没有运行验证。

为使逐项表可读，使用以下文件简称；后面的 `简称:行号` 均指当前文件，明确标为“旧”的行号除外。

| 简称 | 文件 |
|---|---|
| Svc | [architecture-service.ts](D:/cxt/s8l8-review3/src/core/work-graph/architecture/architecture-service.ts) |
| Codec | [architecture-record-codecs.ts](D:/cxt/s8l8-review3/src/core/work-graph/architecture/architecture-record-codecs.ts) |
| Driver | [auto-capture-driver.ts](D:/cxt/s8l8-review3/src/app/auto-capture-driver.ts) |
| Host | [host.ts](D:/cxt/s8l8-review3/src/app/host.ts) |
| Platform | [create-platform.ts](D:/cxt/s8l8-review3/src/composition/create-platform.ts) |
| Assembler | [context-assembler.ts](D:/cxt/s8l8-review3/src/core/agent-runtime/context-assembler.ts) |
| Prep | [execution-preparation.ts](D:/cxt/s8l8-review3/src/core/agent-runtime/execution-preparation.ts) |
| Facts | [architecture-reminder-facts.ts](D:/cxt/s8l8-review3/src/composition/architecture-reminder-facts.ts) |
| Gate | [S8A-L8-auto-capture-gate.test.ts](D:/cxt/s8l8-review3/tests/app/S8A-L8-auto-capture-gate.test.ts) |
| HostTest | [S8A-L8-host-close-restart.test.ts](D:/cxt/s8l8-review3/tests/app/S8A-L8-host-close-restart.test.ts) |
| Start | [S8A-L8-capture-start.test.ts](D:/cxt/s8l8-review3/tests/app/S8A-L8-capture-start.test.ts) |
| Obs | [S8A-L8-observation-state.test.ts](D:/cxt/s8l8-review3/tests/work-graph/S8A-L8-observation-state.test.ts) |
| Pub | [S8A-L8-reminders-public.test.ts](D:/cxt/s8l8-review3/tests/work-graph/S8A-L8-reminders-public.test.ts) |
| Pure | [S8A-L8-reminders-pure.test.ts](D:/cxt/s8l8-review3/tests/work-graph/S8A-L8-reminders-pure.test.ts) |
| Count | [S8A-L8-read-counts.test.ts](D:/cxt/s8l8-review3/tests/work-graph/S8A-L8-read-counts.test.ts) |
| Scope | [S8A-L8-chunk-scope.test.ts](D:/cxt/s8l8-review3/tests/work-graph/S8A-L8-chunk-scope.test.ts) |
| World | [S8A-L8-reminder-world.ts](D:/cxt/s8l8-review3/tests/helpers/S8A-L8-reminder-world.ts) |
| H4 | [S8A-L8-prepare.ts](D:/cxt/s8l8-review3/tests/helpers/S8A-L8-prepare.ts) |
| CodecTest | [S8D-observed-v2-codecs.test.ts](D:/cxt/s8l8-review3/tests/data/S8D-observed-v2-codecs.test.ts) |
| OldFmt | [S8E-old-format-rejection.test.ts](D:/cxt/s8l8-review3/tests/data/S8E-old-format-rejection.test.ts) |
| Mappings | [S8A-L8-capture-mappings.test.ts](D:/cxt/s8l8-review3/tests/composition/S8A-L8-capture-mappings.test.ts) |

**1. FFT §3，逐 ID 结论**

“fixed”表示该 ID 的静态修复成立，并不声称测试已运行。不同做法若未满足冻结路径，计入 partly。C 行的原始 11 个定位点已修，但它引用的 **B R2-4 扩展要求仍有一个生产缺陷**，单独列于第 4 节 C-1，不把它冒充原始 K3-03 的未修代码。

**A — Chunk scope**

| ID | 结论、修复位置、证明测试 |
|---|---|
| K1-01 | **fixed**。空块也使用带 scope 的 envelope，Svc:375、384；CodecTest:87、93，Scope:530、535。 |
| K1-02 | **fixed**。节点块带 scope，Svc:377、384；CodecTest:59，Scope:425、472。 |
| K1-03 | **fixed**。边块带 scope，Svc:379、385；CodecTest:59、117。 |
| K1-04 | **fixed**。unresolved 块带 scope，Svc:381、386；CodecTest:242。 |
| K1-05 | **fixed**。`ObservedFileGraphChunkV2` 增加 scope，[contracts.ts:50](D:/cxt/s8l8-review3/src/core/work-graph/architecture/contracts.ts:50)；CodecTest:93、218。 |
| K1-06 | **fixed**。精确键、scope 校验和解码统一到新形状，Codec:321、352；CodecTest:188、197、207，OldFmt:55、60、70。 |
| K1-07 | **fixed**。实际 UTF-8 envelope 计入分块与空块上限，Svc:300、320、1138、1146；CodecTest:220、225、233；[A12:44](D:/cxt/s8l8-review3/tests/data/S8E-A12-file-chunks.test.ts:44)、111、128。 |
| K1-08 | **fixed**。正文 scope 隔离跨工作区地址；保留 origin 校验及 store 返回 ref，Svc:702、1165；Scope:425、480、517、526。 |
| K1-09 | **fixed**。读块时以请求 scope 解码，Svc:710；CodecTest:197。既有 ref、origin、路径授权未删除。 |
| K1-10 | **fixed**。双后端相同内容双工作区，真实采用/修订后分别 prepare；Scope:407、425、472–477。另有双项目同 workspaceId、同域复用和空图行。 |

**B — Capture start / owner cancellation**

| ID | 结论、修复位置、证明测试 |
|---|---|
| K2-01 | **fixed**。开始 observation-state 非取消失败进入统一 failure 出口，Driver:190–196、252；Start:138、156，Obs:702。 |
| K2-02 | **fixed**。throw 保留原因，取消不写 failure，Driver:198–200；Start:178，Obs:726、776。 |
| K2-03 | **fixed**。补齐开始读失败、throw、取消期间失败/throw/ready；Obs:702、726、748、776、802；旧失败不覆盖新请求见 Obs:503、568。 |
| P05 | **partly**。正常 resolve 后和提交前有检查，Svc:1258、1261、1274、1285；Obs:881、905 有早期 replay 例。但缺取消同时 throw、提交失败后取消；晚到 commit replay 又把成功改成 cancelled，见 B-1～B-3。测试自身还有内部写入问题。 |
| P06 | **partly**。Svc:1330、1333、1344、1357；Obs:912、936、944、979。原 signal 和 revision guard 成立；仍有 B-1～B-3，且 replay 测试手调内部 failure write。 |
| P07 | **partly**。Svc:1379–1383 能处理读返回期间取消；Obs:990、1002。读抛错同时取消仍外抛，B-1。 |
| P08 | **partly**。Svc:1402、1408、1413、1419；Obs:1005、1015、1025。正常返回路径补齐；三个读取的 throw+abort 未归一为 cancelled，B-1。 |
| P09 | **partly**。capture 早期 lookup/restore 后检查已加，Svc:996、1002 附近；Obs:1034、1054、1057。throw+abort 仍绕过这些检查，B-1。 |
| S12 | **fixed**。Driver:252 传该轮 `controller.signal`，Svc:1357 提交前检查，旧 revision 在 :1347 拒绝；Start:207 和 Obs:912、936 证明 signal 接线与取消前不写。 |

**C — Reminder / preparation cancellation**

| ID | 结论、修复位置、证明测试 |
|---|---|
| K3-01 | **fixed**。提醒正常返回后检查 signal，Assembler:1057；Pub:192、205、206。 |
| K3-02 | **fixed**。提醒 throw 的 catch 先处理取消，Assembler:1050；Pub:212、225、226。 |
| K3-03 | **fixed**。提醒明确返回 cancelled 或原 signal 已取消均终止，Assembler:1056–1057；实际 signal 取消见 Pub:192、212。旧“只返回 cancelled、signal 未取消”的独立例被删除，属于 ledger weakening，不能说覆盖完整保留。 |
| K3-04 | **fixed / STATIC**。assembly await 后检查 signal，Prep:292；现有 Pub:192、212 走整条准备链，但没有独立卡住“assembler 已 ready、外层恢复前”的测试。 |
| K3-05 | **fixed / STATIC**。外层 assembly catch 取消优先，Prep:288；现有 Pub:212 主要证明内层 catch，未单独命中这一外层 catch。 |
| K3-06 | **fixed / STATIC**。put 前、catch 和返回后检查，Prep:321、329、334；Pub:206、226 证明取消发生在写前时 0 次 put；没有独立的 put 在途取消例。 |
| K3-07 | **fixed**。Facts:25–37 对 catalog、两个 observed 分支均 await 后检查；Pub:192、212，Obs:1060、1071、1083 覆盖真实 facts 链上的取消。 |
| K3-08 | **fixed**。basis 后检查，Svc:1445；Obs:1060。 |
| K3-09 | **fixed**。latest 后检查，Svc:1453；Obs:1071。 |
| K3-10 | **fixed**。previous 后和最终 ready 前检查，Svc:1465、1477；Obs:1083。 |
| K3-11 | **fixed**。新增取消期间真实 ready、取消期间 throw 两个独立行，Pub:192、212；非取消失败仍成功且只一条不可用，Pub:168、180。 |

**D — Tests through public steps**

| ID | 结论、修复位置、证明测试 |
|---|---|
| K4-01 | **fixed**。真实采用及 composition 回调，Gate:184–190、278。 |
| K4-02 | **fixed**。第二次改为真实修订及回调，Gate:194–207、291；:294 精确断言 `catalog_revised`。 |
| K4-03 | **differently → partly**。Obs:424 已先真实采用，但仍手调 `driver.projectChanged`；未走 B§7 冻结的真实提交回调。 |
| K4-04 | **differently → partly**。Obs:473 同上，失败由真实根目录故障产生，但触发接线仍手动。 |
| K4-05 | **differently → partly**。Obs:489 真实修订后手动通知；不是 B§7 所要求路径。 |
| K4-06 | **differently → partly**。Obs:541 运行中真实采用后手动通知；真实原因补上，回调接线未补。 |
| K4-07 | **differently → partly**。Obs:624 真实修订后手动通知。 |
| K4-08 | **differently → partly**。Obs:635 重试同上。 |
| K4-09 | **differently → partly**。Obs:645 throw 场景同上。 |
| K4-10 | **fixed**。Pub:259 使用 World:389 的真实修订；通知来自 World:383 的 callback，断言在 Pub:269。 |
| K4-11 | **fixed**。Pub:273 再次真实修订，沿同一 callback。 |
| K4-12 | **fixed**。旧 Mappings:281 重复服务行删除；保留 [auto-capture-state:58](D:/cxt/s8l8-review3/tests/state/S8A-L8-auto-capture-state.test.ts:58) 的 requestedAt 纯状态检查。 |
| K4-13 | **fixed**。同一手造 failure 行随上项删除；并未要求保留该非法状态构造。 |
| K4-14 | **fixed**。raw pointer 检查移除，Obs:448–450 用公开 current、seq2、pending=false 观察。 |
| K4-15 | **fixed**。Obs:568–571 公开断言 seq2、pending=false、current/previous。 |
| K4-16 | **fixed**。删除冗余库 watermark 断言；Obs:690–695 保留 manual 最终 seq1、pending=false 及公开指针关系。 |
| K4-17 | **partly**。删掉 `chunkCountOf`，Count:123 用手算 7 body；但旧首次 facts/节点数检查丢失，且计数器单位错误。 |
| K4-18 | **partly**。Count:123 替代第一观测的库 oracle；不能以当前计数证明完整的 6 块读取合同，见第 5 节。 |
| K4-19 | **partly**。Count:142 替代第二观测的库 oracle；只断言两份合计 body 数，旧 latest 13 节点检查丢失。 |
| K4-20 | **partly**。Count:142–144 替代 latest chunks oracle；同一计数问题及覆盖丢失。 |
| K4-21 | **partly**。Count:142–144 替代 previous chunks oracle；旧 previous 12 节点检查丢失。 |
| K4-22 | **partly**。Count:116 确实调用一次公开 prepare，但 :72 数的是匹配 key 数，而非 record 读取调用次数。 |
| K4-23 | **partly**。Count:136 第二次公开 prepare 同样存在计数单位错误。 |
| K4-24 | **differently → partly**。H4:36、48 已改为真实 prepare/openArtifact；但 :40–45 改造为 `work_run` 身份，未使用 B§9 冻结的同 scope **Host context**，不是等价路径。 |

H4 的差异有实际意义：[materials/applicability.ts:29](D:/cxt/s8l8-review3/src/core/work-graph/materials/applicability.ts:29) 分开 Host 与 Run 分支；Host 在 :63–77 读取并核对 canonical owner，Run 在 :88–91 按自身 owner 放行。不能仅因都调用 `openArtifact` 就认定等价。应使用冻结的 Host 路径；若它拒绝，应按 FFT 报具体 BLOCKED，而不是换身份。

**E — Real Host close/restart**

| ID | 结论、修复位置、证明测试 |
|---|---|
| K5-01 | **partly**。真实 Host、真实 `captureObservation` A3 gate、A running/B queued、真实 close 均已建立，HostTest:128–153、164；但新增等待 helper 在 :60–76 用 sleep 轮询内部 gate/signal，重引 F9。 |
| K5-02 | **partly**。同一 SQLite DB 新 Host 自动重试 A/B，HostTest:180–192；seq2、startup_retry 和 current 检查存在。仍依赖上述 F9 helper。E 行 SQLite-only 本身符合明确裁定。 |

**F — Other test rows**

| ID | 结论、修复位置、证明测试 |
|---|---|
| T15 | **partly**。旧手包 Role facts 已删，World:411、H4:36 使用真实 runtime；但 H4 的读取身份偏离冻结路径。 |
| T16 | **fixed**。Gate:278–294 以真实采用、完成态和真实修订区分 waiting/idle；:285–288 的完成检查使它不再只靠恒 true 谓词。 |
| T17 | **fixed**。Gate:338–344 await close 后直接公开读并断言；双后端保留。 |
| T18 | **differently → partly**。旧 sleep 随整个 unbound driver 行删除；SQLite Host 行承接部分行为，但 memory 覆盖未承接。 |
| T19 | **partly**。HostTest:202–230 建立真实 Host 重启、不绑定 B 的检查；删掉旧 memory 行，且旧“B 确曾进入”的前提变为 B 从未进入。F 行未获 E 行的 SQLite-only 豁免。 |
| T20 | **not**。[auto-capture-host:45–52](D:/cxt/s8l8-review3/tests/app/S8A-L8-auto-capture-host.test.ts:45) 只是删 sleep 后立即读公开状态；没有冻结要求的通知计数或完成边界，异步错误触发仍可能晚于读。 |
| T21 | **fixed**。[adoption-capture:237–246](D:/cxt/s8l8-review3/tests/app/S8A-L8-adoption-capture.test.ts:237) 删除 sleep，:241 同步通知计数及公开状态检查保留。 |
| T22 | **not**。[pass-capture:420–428](D:/cxt/s8l8-review3/tests/app/S8A-L8-pass-capture.test.ts:420) 仅删 sleep；:201、260 的通知转发没有新增完成握手或计数。与 bubblewrap 是否通过无关。 |
| T23 | **fixed**。原 Gate 内部轮询改为 entered Promise，Gate:57、68；使用点 :233、247、270、283、329。新 HostTest 又出现 F9，另计。 |
| T24 | **partly**。Gate:237–254 等 B 的公开 request 接受并断言 maxActive，但 :73–78 只计 `resolveRoot` gate 内活跃数；A 离门即减数，未等 B 的实际调度边界，不能排除后续 capture 重叠。 |
| T25 | **fixed**。Pure:180、186 分别只缺 catalog、只缺 task module。 |
| T26 | **fixed**。Pure:195、206、217 分别为 2/1、1/2、1/1。 |
| T27 | **fixed**。纯文件命名与 imports 合规，Pure:11–22；原不可达路径组合完整保留在 :298–316。旧文件所有行的去向见第 2 节。 |
| T28 | **partly**。World:255、H4:36 已使用实际 backend 的 prepare/body/material 链；H4 的 Host→Run 身份替换仍未满足冻结要求。 |
| T29 | **fixed**。Obs:829–874 双后端两轮真实触发及 gates；:858、866 第一轮成功后 seq2 仍 pending，:873 第二轮后 false。 |
| T30 | **fixed**。Pure:244–261，9 个字面例覆盖 59s、60s、119s、59m、60m、23h、24h、3d、3d23h。 |
| T31 | **fixed**。Pure:227–238，deleted/added/unchanged 同 digest，字面期望一个 move。 |
| T32 | **fixed**。Pure:266–278，rest 乱序 C/B 输入、B/C 完整字面输出。 |
| T70 | **fixed / STATIC**。[state-writes.test.ts:213](D:/cxt/s8l8-review3/tests/architecture/state-writes.test.ts:213) 附近移除 record encoder allowlist 项；未新增其他豁免替代。 |
| T71 | **fixed / STATIC**。同处移除 event encoder allowlist 项；decoder 的既有项保留。 |

**G — Production**

| ID | 结论、修复位置、证明测试 |
|---|---|
| P11 | **fixed**。Host:1599 在首个 await 前启动 auto-capture close；Driver:295–299 同步停队列、abort running，然后 drain。HostTest:149–153 有真实关闭接线证据，测试 F9 缺口另列。 |
| P12 | **fixed / STATIC**。Driver:72 使用 `canonicalJson([projectId, workspaceId])`；未见专门的含 NUL tuple 回归。Host:183 按裁定 7 保留。 |
| P13 | **fixed / STATIC**。[architecture-observation.ts:18–24](D:/cxt/s8l8-review3/src/contracts/architecture-observation.ts:18) 统一列表、类型、predicate；Svc:1239、Codec:659 使用。未见独立新增共享规则回归。 |
| P14 | **fixed**。同文件 :29 的共享生产上限供 [architecture-capture.ts:84](D:/cxt/s8l8-review3/src/core/work-graph/state/architecture-capture.ts:84)、Codec:673 使用；[auto-capture-state:43、68、102、114](D:/cxt/s8l8-review3/tests/state/S8A-L8-auto-capture-state.test.ts:43) 保留字面 2000/2001。 |
| P15 | **fixed / STATIC**。Codec:13 附近删除未使用的 `ArchitectureAutoCaptureFailureV1` import。无行为测试要求。 |
| P16 | **fixed**。[core-http-types.ts:309–316](D:/cxt/s8l8-review3/src/app/core-http-types.ts:309) 排除 `requestSeq`；[core-routes.ts:540](D:/cxt/s8l8-review3/src/app/core-routes.ts:540) 运行时明确拒绝；Driver:233 仍走内部 watermark 路径。证明：[http-watermark:38–55](D:/cxt/s8l8-review3/tests/app/S8A-L8-http-watermark.test.ts:38)，但测试缺 A6 分组。 |
| S01 | **fixed / STATIC**。Assembler:77–81 更新非取消降级说明。 |
| S02 | **fixed / STATIC**。[execution-contracts.ts:236–241](D:/cxt/s8l8-review3/src/core/agent-runtime/execution-contracts.ts:236) 同步说明。 |
| S03 | **fixed / STATIC**。Prep:37–42、143–156 显式声明、构造实际依赖，去掉旧 cast；缺材料仅在需要默认 assembler 时显式 throw。 |
| S04 | **fixed / STATIC**。[S8A-L8-host.ts:61](D:/cxt/s8l8-review3/tests/app/support/S8A-L8-host.ts:61) 附近删除“堆文件拖慢”指导。 |
| S05 | **fixed / STATIC**。Driver:50 收窄 system actor，Host:532 传固定 system actor。 |
| S06 | **fixed / STATIC**。Platform:1197 在 adopt await 前固定 projectId；Gate:278 等真实采用行经过该 wrapper，但无专门 ctx 并发变更例。 |
| S07 | **fixed / STATIC**。Platform:1206 在 revise await 前固定 projectId；Gate:291 经过真实修订 wrapper。 |
| S08 | **fixed / STATIC**。Platform:942 在 finalize await 前固定 projectId；PASS 接线存在，运行结果未验证。 |

**2. 两份 ledger，逐行核对**

分类含义：

- **FFT**：该删除/改写由列出的 FFT ID 明确要求；不代表替代测试的其他问题已通过。
- **等价**：同一被测对象和字面期望仍存在；明确标出的加强检查也列在这里。
- **削弱**：存在未获 FFT 授权的损失。
- 新位置均为当前文件；左列均为 ledger 的旧位置。

`d1-round.txt` 的 **77 条 assertion**：

| # | 旧位置 | 结论及当前去向 |
|---:|---|---|
| 1 | Gate:224 | **FFT K4-02**。真实第二次修订使 trigger 必须改为 `catalog_revised`，Gate:294；不能保留伪 adopted 的字面值。 |
| 2 | Gate:322 | **等价**。A 的 seq1、pending=true 在 HostTest:141；backend 缩减另见第 78 条。 |
| 3 | Gate:328 | **等价**。B 的 seq1/requested/pending=true 在 HostTest:207，另见 :174。 |
| 4 | Gate:329 | **等价**。B current=null 在 HostTest:208，另见 :175。 |
| 5 | Gate:331 | **削弱**。旧 `bEnteredBeforeRetry > 0` 消失；HostTest:209 反而证明 B 为 0。HostTest:191 检查 A，主体不同，不能承接。 |
| 6 | Gate:346 | **等价**。重启后 B 仍 seq1/requested/pending=true，HostTest:228。 |
| 7 | Gate:347 | **等价**。重启后 B current=null，HostTest:229。 |
| 8 | Gate:348 | **等价**。B entered 数不变，HostTest:230；但“此前大于 0”的前提已在第 5 条丢失。 |
| 9 | Mappings:290 | **FFT K4-12**。删除手工写 request 的重复服务行。 |
| 10 | Mappings:297 | **FFT K4-13**。删除手造 failure 的同一行。 |
| 11 | Mappings:300 | **FFT K4-12、K4-13**。该行整体删除；requestedAt 的纯状态检查保留于 auto-capture-state:58。 |
| 12 | CodecTest:87 | **FFT K1-01、K1-06**。新 :93 的空块精确值加入 scope。 |
| 13 | CodecTest:111 | **FFT K1-06**。新 :117，同一越界边，仍 `invalid`，仅补 scope 参数。 |
| 14 | CodecTest:112 | **FFT K1-06**。新 :118，同一单元素边，仍 `invalid`。 |
| 15 | CodecTest:113 | **FFT K1-06**。新 :119，同一小数索引，仍 `invalid`。 |
| 16 | CodecTest:114 | **FFT K1-06**。新 :120，同一负索引，仍 `invalid`。 |
| 17 | CodecTest:117 | **FFT K1-06**。新 :123，同一不传 nodeCount 的合法块，仍 `decoded`。 |
| 18 | CodecTest:122 | **FFT K1-06**。新 :128，同一坏 digest，仍 `invalid`。 |
| 19 | CodecTest:130 | **FFT K1-06**。新 :136，空 specifier，仍 `decoded`。 |
| 20 | CodecTest:132 | **FFT K1-06**。新 :138，4096 字符，仍 `decoded`。 |
| 21 | CodecTest:133 | **FFT K1-06**。新 :139，4097 字符，仍 `invalid`。 |
| 22 | CodecTest:134 | **FFT K1-06**。新 :140，JSON decode 的 4096 字符，仍 `decoded`。 |
| 23 | CodecTest:135 | **FFT K1-06**。新 :141，JSON decode 的 4097 字符，仍 `invalid`。 |
| 24 | CodecTest:140 | **FFT K1-06**。新 :146，同一重复节点，仍 `invalid`。 |
| 25 | OldFmt:54 | **FFT K1-06、裁定 8**。新带 scope 形状在 :55–57 decoded；旧无 scope 形状改在 :60–61 invalid，正是所要求的不兼容更新。 |
| 26 | OldFmt:64 | **FFT K1-06**。新 :70，schema1 仍 invalid。 |
| 27 | Obs:319 | **等价**。新 :432–433，同一第二轮 seq2/pending=false，并增加 trigger 检查。 |
| 28 | Obs:331 | **等价**。新 :450，同一 replay 后 seq2/pending=false，另检查 failure=null。 |
| 29 | Obs:335 | **FFT K4-14**。raw pointer 非空改为 :449 公开 current 非空。 |
| 30 | Obs:336 | **FFT K4-14**。raw watermark=2 改为 :450 公开 seq2/pending=false。 |
| 31 | Obs:443 | **FFT K4-15**。改为 :568–571 的公开状态及 current/previous 检查。 |
| 32 | Obs:496 | **等价**。新 :626–629，同一 seq3/failed/pending=true，并增加 trigger。 |
| 33 | Obs:510 | **等价**。新 :647–650，同一 seq5/failed/pending=true，并增加 trigger。 |
| 34 | Obs:557 | **FFT K4-16**。删除重复 raw pointer；:690–695 保留公开 manual 最终 seq1/pending=false。 |
| 35 | Obs:575 | **等价，改为失败即 throw 的守卫**。Count:111 → World:364–367 对首次 capture 要求 `committed`。 |
| 36 | Obs:578 | **FFT K4-17**。库中取出的 `>1` 改为 Count:123 手算 body=7；计数证明缺口另列。 |
| 37 | Obs:600 | **削弱**。首次 `firstFacts.status=ready` 无同主体替代；Count:117 的 input 非空、prepare ready 允许提醒降级后仍通过。 |
| 38 | Obs:602 | **削弱**。首次 facts 的 previous=null 未在新计数场景断言。 |
| 39 | Obs:603 | **削弱**。首次 latest.nodes.length=12 未在新计数场景断言。 |
| 40 | Obs:606 | **FFT K4-18**。移除从库推导 chunk oracle，改为 Count:123 手算；非宣告其计数方法合格。 |
| 41 | Obs:607 | **FFT K4-22、裁定 9**。旧内部 reader 公式改为 Count:123–125 的 5+7=12；当前计量单位仍不合格。 |
| 42 | Obs:613 | **等价，改为守卫**。Count:129 → World:364–367 对第二次 capture 要求 `committed`。 |
| 43 | Obs:616 | **FFT K4-19**。第二次库 chunk 数改为 Count:142 的手算 15 body。 |
| 44 | Obs:623 | **削弱**。第二次 `secondFacts.status=ready` 无同主体替代。 |
| 45 | Obs:625 | **削弱**。第二次 facts.previous 非空未在新场景检查。 |
| 46 | Obs:626 | **削弱**。第二次 latest.nodes.length=13 丢失。 |
| 47 | Obs:627 | **削弱**。第二次 previous.nodes.length=12 丢失。 |
| 48 | Obs:632 | **FFT K4-20**。移除 latest 的库 oracle，改手算 Count:142–144。 |
| 49 | Obs:633 | **FFT K4-21**。移除 previous 的库 oracle，改手算 Count:142–144。 |
| 50 | Obs:634 | **FFT K4-23、裁定 9**。改为 Count:142–144 的 6+15=21；计数器缺陷另列。 |
| 51 | Pub:333 | **等价，守卫**。新 Pub:39–40，经 :56 调用，要求同一公开 observationState ready。 |
| 52 | Pub:335 | **等价**。Pub:58，同一 current 非空。 |
| 53 | Pub:336 | **等价**。Pub:59，同一 previous 非空。 |
| 54 | Pub:337 | **等价**。Pub:60，同一 observedAt 的 `Number.isNaN(Date.parse(...))=false`。 |
| 55 | Pub:338 | **等价**。Pub:61，同一 current/previous captureId 不同。 |
| 56 | Pub:339 | **等价**。Pub:62，current captureId 等于第二次捕获 ID。 |
| 57 | Pub:340 | **等价**。Pub:63，previous captureId 等于第一次捕获 ID。 |
| 58 | Pub:343 | **等价并加强**。Pub:65 → H4:37 必须 ready，强于原“不是 rejected”。H4 身份问题另列。 |
| 59 | Pub:345 | **等价**。Pub:26–30、66，四条完整中文字符串、顺序和“3 小时前”保留。 |
| 60 | Pub:371 | **等价并加强**。Pub:86 → H4:37，必须 ready。 |
| 61 | Pub:395 | **等价并加强**。Pub:108 → H4:37，必须 ready。 |
| 62 | Pub:417 | **等价并加强**。Pub:128 → H4:37，必须 ready。 |
| 63 | Pub:432 | **等价，守卫**。Pub:141 → :39–40，同一 observationState ready。 |
| 64 | Pub:434 | **等价**。Pub:142，同一 current=null。 |
| 65 | Pub:436 | **等价并加强**。Pub:143 → H4:37，必须 ready。 |
| 66 | Pub:455 | **等价并加强**。Pub:160 → H4:37，必须 ready。 |
| 67 | Pub:472 | **等价，守卫**。Pub:172 → H4:37；:173–174 同时保留任务文本和恰一条不可用。 |
| 68 | Pub:488 | **等价，守卫**。Pub:184 → H4:37；:185–186 保留任务文本和恰一条不可用。 |
| 69 | Pub:504 | **削弱**。旧“reader 明确返回 cancelled、signal 未 abort”的场景被删；新 :205、225 都依赖实际 abort，条件不同。 |
| 70 | Pub:505 | **削弱**。同一旧显式 cancelled 场景的 input=null 随之丢失；新 0 puts 断言属于不同输入条件。 |
| 71 | Pub:527 | **等价**。Pub:251，保存的 captureId 仍不等于首次 ID。 |
| 72 | Pub:537 | **等价，守卫**。Pub:253 → H4:37，准备结果必须 ready。 |
| 73 | Pub:554 | **等价，守卫**。Pub:269 → H4:37，准备结果必须 ready。 |
| 74 | Pure:202 | **等价**。Pure:245、255–261，59 秒完整字面文本“刚才的观测”保留。 |
| 75 | Pure:203 | **等价**。Pure:248、255–261，59 分钟完整字面文本保留。 |
| 76 | Pure:204 | **等价**。Pure:250、255–261，23 小时完整字面文本保留。 |
| 77 | Pure:205 | **等价**。Pure:252、255–261，3 天完整字面文本保留。 |

同一文件的 **9 条 test/describe**：

| # | 旧位置 | 结论及当前去向 |
|---:|---|---|
| 78 | Gate:309 | **削弱**。删除 `describe.each(['memory','sqlite'])`；HostTest:202 只有 SQLite。E 的例外没有授权删除 F/T19 的 memory 覆盖。 |
| 79 | Gate:310 | **FFT T19**。行为迁至真实 HostTest:202–230；backend 损失在第 78 条单计。 |
| 80 | Mappings:281 | **FFT K4-12、K4-13**。明确要求整行删除。 |
| 81 | Obs:564 | **FFT K4-17、K4-18、K4-19、K4-20、K4-21、K4-22、K4-23、裁定 9**。计数行迁至 Count:97–99；额外丢掉的事实检查已逐条列出，不由这个范围映射豁免。 |
| 82 | Pub:327 | **FFT K4-24、T15、T28**。新 Pub:52 改走公开 runtime；H4 路径尚未完全按冻结要求。 |
| 83 | Pure:175 | **FFT T25**。拆到 Pure:180、186，两条单变量输入。 |
| 84 | Pure:181 | **FFT T26**。拆到 Pure:195、206、217，保留正例。 |
| 85 | Pure:195 | **FFT T30**。扩展到 Pure:244–261；四条旧字面检查都保留。 |
| 86 | Pure:221 | **等价；T27 改名/迁移**。Pure:298–316 保留原不可达路径组合、完整文本和 key 顺序。 |

`MOVED: 2` 的汇总也核对了：旧 Gate:341 的 **A seq2/startup_retry/pending=false** 在 HostTest:219；旧 :342 的 **A current 非空** 在 :220。两条主体和字面条件保留；memory 损失仍计第 78 条。

其余元信息：77 assertion + 9 test/describe = 86 条；`DELETED test files: 0` 与所给 round ledger 一致。D3 报 1 个 pure 文件、0 hits，与当前 imports 的人工检查相符；我未重跑 detector。

`d1-cumulative.txt` 的 **15 条**，单独逐条列出，不以 round 范围映射代替：

| 旧位置 | 结论及当前去向 |
|---|---|
| CodecTest:87 | **FFT K1-01、K1-06** → 当前 :93，带 scope 的空块精确值。 |
| CodecTest:111 | **FFT K1-06** → :117，越界边仍 invalid。 |
| CodecTest:112 | **FFT K1-06** → :118，边长度错误仍 invalid。 |
| CodecTest:113 | **FFT K1-06** → :119，小数索引仍 invalid。 |
| CodecTest:114 | **FFT K1-06** → :120，负索引仍 invalid。 |
| CodecTest:117 | **FFT K1-06** → :123，不传 nodeCount 的合法块仍 decoded。 |
| CodecTest:122 | **FFT K1-06** → :128，坏 digest 仍 invalid。 |
| CodecTest:130 | **FFT K1-06** → :136，空 specifier 仍 decoded。 |
| CodecTest:132 | **FFT K1-06** → :138，4096 字符仍 decoded。 |
| CodecTest:133 | **FFT K1-06** → :139，4097 字符仍 invalid。 |
| CodecTest:134 | **FFT K1-06** → :140，JSON 4096 字符仍 decoded。 |
| CodecTest:135 | **FFT K1-06** → :141，JSON 4097 字符仍 invalid。 |
| CodecTest:140 | **FFT K1-06** → :146，重复节点仍 invalid。 |
| OldFmt:54 | **FFT K1-06、裁定 8** → :55–57 新形状 decoded，:60–61 旧无 scope 形状 invalid。 |
| OldFmt:64 | **FFT K1-06** → :70，schema1 仍 invalid。 |

累计 ledger 的 15 条没有额外削弱；它看不到的 round 内删除不能因此视为安全。其 `DELETED files: 0`、D3 1 文件/0 hits 同样只是该 detector 范围的结果。

**旧 `S8A-L8-reminders.test.ts` 是否完整迁回：是。** 按旧文件 14 条测试逐项对照：

| 旧测试起始行 | Pure 中去向 |
|---:|---:|
| 99 | 101 |
| 104 | 106 |
| 109 | 111 |
| 119 | 121 |
| 128 | 130 |
| 137 | 139 |
| 146 | 148 |
| 161 | 163 |
| 169 | 171 |
| 175 | 180、186，按 T25 拆分 |
| 181 | 195、206、217，按 T26 拆分 |
| 195 | 244–261，按 T30 扩展，原四条时间字面检查保留 |
| 208 | 281 |
| 221 | 298–316，原不可达组合保留 |

原 14 行、29 个 expect 的检查内容有对应去向；没有把旧纯文件的删除算作 coverage 消失。实现者用一句“T27”概括不足以证明迁移，但本次逐行核对后，该迁移本身成立。

**3. 所有 ADDED 行的 rule-sheet v2 复扫**

检查了本轮 **3,182 条 added 行**：`src/` 286 条、测试及 helper 2,896 条；新文件也全部纳入。未把旧 WP2 未改行拉入必须修复范围。

以下是新增或迁移后仍不合规的实例。计数采用 **9 个非 F12 位点 + 4 组 F12 损失 = 13 个实例**；F12 的 4 组对应 ledger 中 11 条削弱，不重复按每条断言再计规则实例。

| # | 位点 | 规则及问题 |
|---:|---|---|
| 1 | Obs:883–889、900 | **F1/F3**。测试自己构造内部 `requestAutoCapture` 命令作为前置事实，再直接 replay。该方法 exported 不等于 A1 公共入口；真实用法由 driver 产生 requestedAt/trigger 命令。 |
| 2 | Obs:971–974 | **F3**。失败虽由真实根故障产生，但 replay 仍由测试手调内部 `failAutoCapture`，构造 expectedRevision 和 driver requestId。公开读回 failure 不会把这次内部写入变成公共步骤。应通过 A3 保存/门控真实调用，或报告无法按路径完成。 |
| 3 | Obs:442 → :384–388 helper | **A1 参数限制/F3**。新增 replay 调用把内部 start watermark `2` 作为 helper 参数，再交给 capture；P16 已明确这是 driver 的非公共输入。FFT 要求沿用真实采用时 mappings，并没有豁免手造 watermark。 |
| 4 | HostTest:60–67 | **F9**。`waitForEntry` 用定时 sleep 轮询内部 gate entries；应由 gate 暴露 entered Promise。 |
| 5 | HostTest:71–76 | **F9**。用 sleep 轮询 AbortSignal；应等待原 signal 的 abort 事件/完成 Promise。 |
| 6 | Count:35–38、72 | **F10/计数合同错误**。在一次 public prepare 内设窗口是对的，但 record 计数实际为匹配 key 数，非裁定中的读取操作次数；遗漏 active-pointer-only read，也能用一次批量读计多个。 |
| 7 | Gate:73–78、237–254 | **F11**。`maxActive` 只覆盖 root gate，未覆盖整个 capture；B 的 request 已可读不等于 B 已过调度边界。删掉串行控制后仍可能 A 出门、B 入门，maxActive=1，而两次 capture 后段重叠。STATIC。 |
| 8 | [http-watermark:25–26、37–50](D:/cxt/s8l8-review3/tests/app/S8A-L8-http-watermark.test.ts:25) | **A6/default deny**。拒绝手造 requestSeq 的行没有放进 `describe('rejects: …')`；拒绝结果和公开状态不变已有，不必推翻其生产证明。 |
| 9 | Scope:498 | **A6/default deny**。跨 scope ref 的拒绝断言混在成功场景，缺 `rejects:` 分组及这次拒绝后的公开状态不变检查。 |
| 10 | 旧 Gate:331 | **F12，1 条 ledger 损失**。B 曾实际进入的前提丢失。 |
| 11 | 旧 Gate:309 | **F12，1 条 ledger 损失**。T19 memory backend 被删除。 |
| 12 | 旧 Obs:600、602、603、623、625、626、627 | **F12，7 条 ledger 损失**。两次 facts ready、previous 状态、12/13/12 节点数检查无同主体承接。 |
| 13 | 旧 Pub:504、505 | **F12，2 条 ledger 损失**。明确返回 cancelled、signal 未 abort 的场景及结果检查被替换掉。 |

其他专项结论：

- **未发现新增独立 F2/F4/F6/F7/F8 实例。** 特别是提醒成功正文不再直接读 body store，旧 Role facts 包装已删除。
- Obs 的七处真实采用/修订后手动通知，已有真实原因，**不再按“无真实原因”的 F5 算新实例**；但仍不符合 B§7 指定 callback 路径，所以 K4-03～09 为 partly。
- `preparePublic` 改名后不是只换壳：现在经过 `prepareAtObservedTime`/World.prepare → H4 → 真实 runtime/materials。其剩余问题是身份和冻结路径，不是旧 raw read 仍藏在 helper。
- `World` 的真实文件修改、capture/adopt/revise，A2 故障 wrapper，A3 puts 计数可追到真实依赖；未因使用 `vi.spyOn` 本身判违规。
- `runRef`、捕获 ref 等公开 owner 接受的引用，不因为“由平台生成过”就一概禁止；**内部 requestSeq、expectedRevision、内部 command identity** 必须另审，上表已指出。
- Pure:11–22 没有 store/platform/Host/Workflow/Runtime/stub port import。
- **P13/P14 未造成期望值自证。** 测试未从新共享 trigger/失败长度常量取得 expected；2000/2001 仍是字面值。Count 对 content-type 常量的使用只是识别计数对象，不是把 12/21 或业务期望从生产常量取出。
- 单后端新增 Host close/restart 的 E 行合法；T19 的 backend 删除未获同一豁免。其余相关服务行保留 memory/SQLite。
- 未发现本轮新增 `skip`、`todo`、`only` 或扩大 timeout 来规避这些要求。

**4. 生产函数、调用者和 await 结果**

先列必须处理的 **4 类生产缺陷**。按缺陷类别计数，不把同一模式在多个 owner 中重复累计。

| 编号 | 缺陷、位置、实际结果 |
|---|---|
| B-1 | **取消同时 throw，owner 不返回 cancelled。** Svc 的 capture 早期 lookup/restore :996、1002；request :1253、1260、1273；fail :1325、1332、1343；read :1379；state :1400、1407、1412，都只在 await 正常返回后检查。依赖 Promise reject/throw 时跳过检查而外抛。Platform:1008–1014 的 trackedCall 不替它改为 cancelled；HTTP 边界最终可变成 500/unavailable。与 FFT B 的统一取消不变量不符。**STATIC**。 |
| B-2 | **未提交成功也套用了“提交后不改结果”的效果。** Svc:1219、1296–1299、1362 在 commit 返回非 committed 且 signal 已取消时，返回 store failure、revision_conflict，或先重试，没有先返回 cancelled。裁定 5 的例外是完成的 committed 结果，不是所有 commit await。**STATIC**。 |
| B-3 | **已进入本次 commit 并得到 committed/replayed 后，又改成 cancelled。** request 在 Svc:1289–1294、fail 在 :1363–1367，restore 后仍检查 signal 并覆盖成功；capture 的对应 :1221–1223 反而保留结果。按裁定 5 的“本次调用开始并完成的 commit”与“只 lookup 的 early replay”划分，这三个 owner 不一致。应保留前者结果，仅 early lookup replay 取消。**STATIC**。 |
| C-1 | **提醒后的 upstream 明确 cancelled 被可选 fallback 吞掉。** Assembler:1084 等待上游缺失输入事实，:1094 只看 signal，:1098 只处理 ready；若依赖返回 `{status:'rejected',code:'cancelled'}` 而 signal 没置位，继续 fallback，最终可写材料并 ready。B§6:230、R2-4 明确要求 signal **或明确 cancelled** 都结束准备。**STATIC**。 |

这些不是建议新增需求：B-1～B-3 来自 FFT B 和裁定 4/5；C-1 来自 FFT C 引用的 B R2-4。

**调用链与无 await 函数**

以下列生产直接调用点；经公开 port 的入口同时列出。没有把测试调用当作生产可达证明。

| 本轮改变的函数/位置 | 生产调用者及结果 |
|---|---|
| `scopeKeyOf`，Driver:69–73 | Driver 的 accept/去重路径 :123 调用；无 await，canonical tuple 不再发生 NUL 拼接碰撞。 |
| `createAutoCaptureDriver` / `runCapture`，Driver:81、159 | Host:526 创建；pump :151 调用 runCapture。Host 注册 :933、1566，项目触发回调 :536，启动恢复 :1064 进入 driver。 |
| `parseCoreRouteRequest`，core-routes:522、540 | [server.ts:238](D:/cxt/s8l8-review3/src/app/server.ts:238) 调用，然后才 dispatch；同步拒绝自有 `requestSeq`，无 await。 |
| Host 返回对象的 `close`，Host:1593 | [main.ts:219](D:/cxt/s8l8-review3/src/app/main.ts:219) 及公开 Host 生命周期调用。 |
| `createArchitectureReminderFactsReader` 的 `read`，Facts:22 | Platform:747 装配；Assembler:1044 调用该真实 reader。 |
| Platform 的 `finalize` wrapper，:939 | 包装后的 evidence 供注册 check runner :950、Workflow :1903，以及公开 evidence :1290 使用。 |
| Platform 的 `adoptInitialCatalog` wrapper，:1195 | 暴露为 architecture 公共 owner，HTTP route 绑定 core-routes:660、dispatch :924；测试真实采用也走它。 |
| Platform 的 `reviseCatalog` wrapper，:1204 | 暴露的 architecture owner；未找到额外内部生产直接调用者，不把测试调用或不存在的 HTTP 修订路由算成生产 caller。 |
| `isAutoCaptureTrigger`，architecture-observation:23 | Svc:1239、Codec:659；同步 predicate，非法输入明确拒绝，无 silent fallback。 |
| `createContextAssembler` / `assembleTask`，Assembler:962 | runtime:371、query-preparation:224、Prep:156 创建；本轮改变的 task assembly 由 Prep:284 调用，query assembly 本轮未改。 |
| `defaultContextAssemblerDependencies`，Prep:143 | Prep:156 调用；同步。需要默认 assembler 却缺 materials 时明确 throw，没有静默默认。 |
| `createExecutionPreparation` / `prepare`，Prep:153 | runtime:372 创建、:602 调用；Platform:1335–1336 暴露 runtime prepare，Workflow:1841 使用。 |
| `validateObservedFileGraphChunkV2`，Codec:321 | Svc:1146 writer 自检、Codec:356 decoder 调用；同步，精确键/scope/内容无效返回 invalid。 |
| `decodeObservedFileGraphChunk`，Codec:352 | Svc:710；JSON parse/validate 失败返回 invalid，只读新形状。 |
| `architectureAutoCaptureProblem`，Codec:634 | 同文件 record validator :686 直接调用；record/event 编解码沿既有验证链使用。共享 trigger/长度规则，无 await。 |
| `packFileGraphChunks`，Svc:297 | serializer :384、385、386；同步按 UTF-8 计量，过限 throw，空块也计量。 |
| `serializeFileGraphChunks`，Svc:373 | capture :1138；同步构造 fixed envelope，无 JSON 子串定位。 |
| `readFileGraphChunks`，Svc:688 附近 | loadObservation :639、loadFileGraph :756；前者由 capture、reminder、query/compare/impact 使用，后者供文件页、neighbors、impact/formal 查询。 |
| `capture`，Svc:950 附近 | Platform:1178 暴露；HTTP capture core-routes:662、926；Driver:232 内部调用。 |
| `requestAutoCapture`，Svc:1230 | Platform:1180 → Driver:109；内部命令，不是任意 exported owner 都可作 A1 测试入口。 |
| `failAutoCapture`，Svc:1302 | Platform:1181 → Driver:252。 |
| `readAutoCapture`，Svc:1370 | Platform:1182 → Driver:166。 |
| `observationState`，Svc:1386 | Platform:1183 → Driver:186、启动扫描 :281；HTTP dispatch core-routes:931。 |
| `readReminderFacts`，Svc:1430 附近 | Platform:1184；Facts:28、33 进入，最终由 prepare 使用。 |
| `newArchitectureCaptureFailureRecord`，state/architecture-capture:71 | Svc:1350 唯一生产调用；同步，以共享上限截断原因，保留原 requestedAt。 |
| 删除的 `readAutoCaptureTrigger` | 调用已被共享 predicate 替换，未留生产孤儿 helper。 |

类型、常量和注释文件没有可枚举的 await；本轮其余 source 改动属于这些声明，不是遗漏的异步函数。

**await × resolve/reject/throw/abort**

这里区分两种“reject”：返回业务 `rejected/not_ready/...` 与 Promise reject/throw。

| 函数/await 位点 | 正常 resolve / 业务失败 | throw / Promise reject | 原 signal 取消时 |
|---|---|---|---|
| Driver `runCapture`，:166 start snapshot | ready+record 才继续；非 ready/null 直接结束，pending 留待重试 | :172 直接结束 | :174 结束，不写 failure；这是裁定 3 保留的无 revision 例外 |
| Driver :186 observationState | ready 取 previous；rejected 保留 code/reason；其他失败变 unavailable | :198–200 保留原因进入 failure | 正常返回后 :189、catch :199 均先退出；明确 cancelled :193 也退出 |
| Driver :211 catalog | ready 使用真实 catalog；not_found 合法空目录；其他失败进入 failure；not_ready 直接结束 | :220 先检查取消，再转 failure | :224 检查；明确 cancelled 也退出 |
| Driver :232 capture | committed 结束；cancelled 结束；其他失败进入 failure | :240 先检查取消，再记录原因 | :245 最终退出，不进入 failure write |
| Driver :252 failAutoCapture | 结果不再向外报告，符合该后台接口既有行为 | :256 吞掉 | 传原 signal；owner 的提交前检查已在 :1357，剩余 owner 缺陷见 B-1～B-3 |
| Facts :25 catalog | not_found 进入合法无目录分支；其余结果保持既有语义 | 向 Assembler 提醒 catch 传播 | :26 检查 |
| Facts :28、33 observed reader | 返回真实结果 | 向 Assembler 传播 | :29、37 检查，返回 cancelled |
| Svc early capture :996 lookup、:1002 restore | 正常结果后检查 signal；early replay 不改旧 commit | 外抛 | fulfilled-await 取消正确；throw+abort 为 B-1 |
| Svc capture :1020 catalog、:1033 watermark、:1038 canonical、:1049 pointer、:1053/1063 previous observation | 正常值推进；业务失败沿原 rejection 返回 | 外抛到 driver/HTTP；没有统一 owner catch | 既有检查阻止后续捕获/提交；不把所有深层 throw 伪称已转换 cancelled |
| Svc capture :1074 captureObservation、:1079 verify、:1081 export、:1086 fileGraph、:1097 module map | 真实工具结果；非成功按相应失败出口结束 | 外抛，finally 清理 | 后续检查及 :1196 阻止尚未开始的 commit；driver catch 能停止后台 failure write |
| Svc capture :1152 主正文 put、:1162 每块 put、:1173 verify、:1183 pointer | store/验证失败返回；成功准备 commit | 外抛，finally 清理 | commit 前 :1196 检查；已经写出的正文不回滚 |
| Svc capture :1216 commit | committed 非 replay 直接保留；非 committed :1219 映射失败 | 外抛 | 成功结果保留正确；非 committed+abort 为 B-2 |
| Svc capture :1221 restore late replay | restored 后返回 committed/replayed | 外抛 | 不用取消改写已经返回 committed 的本次 commit，符合裁定 5 |
| Svc capture finally :1226 release | 释放临时 capture | quiet cleanup 不覆盖主结果 | 清理不承担回滚已持久正文/commit 的语义 |
| Svc request :1253 lookup、:1260 early restore、:1273 current read | 检查后继续或原业务失败；early replay 返回旧 committed | 外抛 | 正常返回后的取消正确；throw+abort 为 B-1 |
| Svc request :1286 commit | 非 replay committed 保留；revision_conflict 有界重试；其他失败映射 | 外抛 | 提交前 :1285 正确；未成功 commit 的取消漏判 B-2 |
| Svc request :1291 late restore | restored 后 committed/replayed | 外抛 | :1292 把已完成 commit 改 cancelled，B-3 |
| Svc fail :1325 lookup、:1332 early restore、:1343 snapshot | 正常后检查；旧 revision :1347 冲突，绝不覆盖新请求 | 外抛 | fulfilled-await 正确；throw+abort 为 B-1 |
| Svc fail :1358 commit | 非 replay committed 保留；非 committed :1362 映射 | 外抛 | :1357 提交前正确；失败后取消 B-2 |
| Svc fail :1364 late restore | restored 后 committed/replayed | 外抛 | :1365 改写成功结果，B-3 |
| Svc readAutoCapture :1379 | 正常后 :1382 检查，再返回原结果 | 外抛 | ready 不会在正常返回后的 abort 下漏出；throw+abort 为 B-1 |
| Svc observationState :1400 basis、:1407 current、:1412 previous | 每次后检查，业务失败原样返回，最终 :1419 再检查 | 外抛 | 正常结果正确；throw+abort 为 B-1 |
| Svc reminder :1442 basis、:1452 latest、:1464 previous | 每次后检查，最终 :1477 再检查；业务失败传给提醒降级层 | 向 Facts/Assembler 传播 | 正常返回 cancelled；throw 由 Assembler:1050 按原 signal 归一，不会生成取消后的正常提醒 |
| Svc readFileGraphChunks :698 每块 body read | 校验完整 ref/origin、body scope、digest/size、路径；错误返回 failure | 向 load/owner 传播 | helper 自身不是取消终点；reminder 的外层取消保证在上述链，其他 owner 不据此宣称新增保障 |
| Assembler :987 初始 graph | 原有前置事实逻辑 | 原有 catch 转 unavailable | 属于提醒前旧路径；不扩成本轮必须修复项 |
| Assembler :1044 reminder | ready 渲染；明确 cancelled 终止；非取消失败只生成一条不可用 | :1050 signal 优先，否则一条不可用 | :1057 检查；不继续材料写入 |
| Assembler :1084 upstream missing-input facts | ready 使用；其余继续可选 fallback | :1091 signal 优先，否则 unavailable fallback | :1094 只看 signal；显式 cancelled 且 signal 未置位被吞，C-1 |
| Assembler :1111 输入第一页 | ready 继续；非 ready 原样返回 | :1116 signal 优先，否则 unavailable | :1119 检查 |
| Assembler :1149 continuation brief | ready 使用；非 ready 返回 | 向 Prep catch 传播 | :1150 检查，阻止 helper 吞掉原 signal 后冒充 ready |
| Prep :174 execution、:203 role、:224 host config | 原有前置逻辑；成功继续，非 ready 返回 | 既有 catch 转 unavailable | 旧前缀的取消优先级问题列 DEFERRED；不混入新增缺陷数 |
| Prep :284 assemble | :292 检查后，非 ready 原样返回 | :288 signal 优先，否则 unavailable | 不构造成功结果、不进入 put |
| Prep :324 material put | put 失败映射 capacity/unavailable；成功后 :334 检查才 ready | :329 signal 优先，否则 unavailable | :321 写前检查；写中取消不 ready，已产生的未引用正文不回滚 |

续接 brief 内部也追到了：Assembler:902 basis、923 previous Turn、932 fallback、937 workspace、941 session；workspace 内 :796 resolveRoot、800 captureDigest、805 capture；session :847 page；continuation-brief-assembly 的 :314 bounds、:181 page 以及 :220/:251 窗口 helper。它们部分仍将非取消失败表示为 unavailable/null；**原 signal 已取消**时，外层 Assembler:1150 或 Prep:288/292 会终止准备。这不能替 C-1 中“依赖明确 cancelled、原 signal 未置位”提供保障。

**Host close 和三个触发 wrapper 的 await**

- Host:1599 先调用 `autoCapture.close()`；该调用在返回 drain Promise 前已同步停队列并 abort running。随后才 await server :1600、backfill :1604、attention :1605、input jobs :1606、collaboration :1607、fanout :1608、tools :1609、auto-capture drain :1610、platform :1611、lease :1613。backfill/attention/lease 的既有 catch 不改变 P11 的“先停自动捕获”。未新加会吞掉 capture 成功并返回 ready 的出口。
- Platform:943 finalize、:1198 adopt、:1207 revise：scope 在各自 await 前固定；只对 committed 且非 replay 的相应真实事件通知。业务拒绝返回原结果，throw 外抛；通知异常的既有限制仍按裁定 3 保留，没有趁此要求新诊断接口。
- Driver 的首读失败、catalog not_ready、failure write 无法记录等 silent return 确实仍在；这些属于裁定 3 明确接受的限制，**不计本轮新生产缺陷**。
- P16 的 HTTP DTO 和 parser 都拒绝 requestSeq；生产只有 driver 传内部 start watermark。测试 helper 接受该内部值，是测试规则问题，不说明 HTTP 隔离未修。

**5. Chunk 格式及 12/21 读数**

**R2-1/R2-2 和裁定 8：实现成立。**

实际正文是闭合的新 v2 结构：

```json
{"schemaVersion":2,"projectId":"…","workspaceId":"…","nodes":[],"edges":[],"unresolved":[]}
```

- Svc:375 用 `JSON.stringify(scope.projectId)`、`JSON.stringify(scope.workspaceId)` 构造 escaped head；:377–382 使用固定结构拼接各数组。没有搜索序列化 JSON 中数组位置。
- 节点、边、unresolved 及空块全部带 scope。空图通过 :384 的 always-flush 产生一块，:320–323 检查空 envelope 是否已超限。
- UTF-8 实际字节计数，不是 JS 字符数。CodecTest:218–225 使用含引号、非 ASCII、反斜杠的 scope，区分 98 bytes 与 97 UTF-16 长度。
- `s8a-l8-observation/main` 的空 envelope 为 **111 bytes**；没有 captureId/requestId/time/revision 等不稳定字段。
- 同 scope 相同 chunk 仍可跨 captures 复用；Svc:1165 保存 `chunkPut.value.ref`，未按本次请求重造 origin/ref。Scope:517、526 验证后续 capture 复用可读。
- Codec:321–356 只接受有 scope 的新形状；旧无 scope schema2 不兼容读取。scope mismatch 的纯 codec 行只有一个错误。
- 256 KiB/chunk、64 chunks 的上限保留；空块计入数量。A12 的 297/294 及 exact `needs 65 chunks; the limit is 64` 在 :44、111、128；A28:51 也随新格式更新。

**裁定 9：字面断言存在，但读取次数尚未被正确证明。**

| 要求 | 当前代码 |
|---|---|
| 一次公开 prepare，无 previous，6 chunks，5 record + 7 body = 12 | Count:98 双后端；:116 一次 World.prepare → H4:36 的 runtime.prepareExecution；:123–125 断言 7、5、12。 |
| 一次公开 prepare，有 previous，latest 7 + previous 6 chunks，6 record + 15 body = 21 | Count:136 第二次单独 prepare；:142–144 断言 15、6、21。 |
| 不计其他准备依赖和事后 material read | :54–64 的真实 reminder wrapper 标记窗口；material read 在 reminder 已返回后，不落该窗口。 |
| 计的是实际 record/body 读取操作 | **不满足**。record 在 :72 加 `architectureKeyCount(refKeys)`，不是每次 readMany 加 1；body 只计成功且特定 content type 的读取。 |
| 6/7 chunks 的观测和状态证据保留 | 手算说明存在，但相关 facts ready、previous 状态、12/13/12 节点检查丢失；当前只剩合计 body 数，不能完整替代这些主体检查。 |

生产真实调用链能解释冻结公式：catalog-service:379 和 :388 是两次 record read，basis 的 Svc:846/:848 是两次，单个 observation record 再一次，即 5；previous 增加一次即 6。body 是主正文加每块，分别 `1+6=7`、`(1+7)+(1+6)=15`。

新计数器却把 active-pointer-only 读取计成 0，把一次 catalog/baseline 批量读取计成 2，**数值恰好相等不代表单位相同**。因此不能接受实现者“已测得 12/21”的证明。应保留冻结字面值，修正计量单位；若修正后不符，应按裁定 9 报所见读取，不改期望。

**6. 实现者 UNSPECIFIED 1–4 与 FOUND**

| 项目 | 代码现在做什么 | 建议裁定 |
|---|---|---|
| UNSPECIFIED 1：开始读失败文案 | Driver:194 对 rejected 保留原 code/reason；:196 给其他非 ready 状态构造 unavailable 文案；:200 用 throw 的 message。Start:138、178 等检查 unavailable/原因。 | **接受当前选择。** 固定失败类别与真实原因即可，无需把英文前缀提升为新产品合同。 |
| UNSPECIFIED 2：T19 SQLite-only | HostTest:202 只重开 SQLite Host；旧 Gate:309 的双后端 unbound pending 行被移除。 | **不接受自动继承 E 的豁免。** 保留新的真实 SQLite Host 行，并恢复 memory/SQLite driver 层对应覆盖，使用 awaited close、通知计数或 gate。若要豁免，必须由 lead 明确新增裁定。 |
| UNSPECIFIED 3：close 后读 pending | HostTest:84–115，:100 创建同 DB 的真实 `createTargetPlatform`，:108 用公开 observationState；没有打开 store 手工核对/改写记录。 | **接受。** 这是关闭后通过真实 owner 的公开读取，符合 A1/A8；不要求向已关闭 Host 发请求。 |
| UNSPECIFIED 4：materials optional | Prep:37–42 保留可选；:143–150 只在构造默认 assembler、缺必需 materials 时明确 throw。正常 runtime 在 runtime:371–372 传已建 assembler。 | **接受当前接口。** 显式 assembler 分支不应被迫携带未使用依赖；无需本轮为类型美观另改接口。 |
| FOUND：旧 host-restart 定时非事件循环 | [S8A-L8-host-restart.test.ts:55、116](D:/cxt/s8l8-review3/tests/app/S8A-L8-host-restart.test.ts:55) 仍存在；未列入本轮 FFT 指定点。 | **DEFERRED。** 后续改计数/完成边界；不能据此允许新 HostTest 再引 F9。 |
| FOUND：Host NUL scope key | Host:183 保留旧拼接；Driver:72 已独立改 canonical tuple。 | **DEFERRED，遵照裁定 7。** 不把 driver 修复扩展到 Host 全链。 |
| FOUND：累计 D1 看不到新建文件内删除 | 两份所给 ledger 体现该盲点；round ledger 多揭示本次 86 条。 | **接受同时保留 round+cumulative 的检查方式。** 不接受以累计“只有 15 条”推论其余删除无问题。 |
| FOUND：catalog+baseline 等同“catalog twice” | Count:35–38、72 实际数 key；生产 catalog-service:379、388 实际是两次调用。 | **拒绝这种计量替换。** 按真实调用计数，冻结 12/21 不动；此项是必须修复，不是可自行解释的 UNSPECIFIED。 |

**7. DEFERRED**

- 裁定 1 排除的旧 WP2 K4-25～K4-53、T33～T69、Q6，不纳入本轮必须修复。
- 裁定 3 保留的 P01～P04、P10、S09～S11：后台失败无法记录及部分绑定失败，不新增诊断接口。
- Host:183 的旧 NUL scope key 按裁定 7 保留。
- 旧 `S8A-L8-host-restart.test.ts` 的定时非事件循环，后续单独处理。
- Prep:174 起的旧前置路径，尤其 :193–196 bound-run rehydrate 在 :198 signal 检查前返回 ready，以及原 execution/role/config catch 的取消优先级，未扩入本轮提醒后边界修复范围。
- 未独立验证 tag/HEAD、RED/GREEN、216 passed、typecheck/build/architecture 检查及 bubblewrap PASS；这些不是本次只读核查的运行证据。

**计数：FFT 90 IDs＝fixed 61 / partly 27 / not 2；ledger 削弱 11 条；新增规则表实例 13 处（含 4 组 F12）；生产缺陷 4 类。**