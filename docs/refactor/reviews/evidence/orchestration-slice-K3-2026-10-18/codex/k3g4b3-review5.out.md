仅静态核对，未修改文件、未运行测试或构建。以下用唯一文件名定位。

1. **必须改：任务书第1项未完成，共享夹具不符合§1。** 模型结束和真实摘要采集已有改进（`K3-proposal-round.ts:601`；`K3-35-continuation-fixture.ts:469`），但夹具仍自行开库（`:437`）、手造 unknown 分类结果并直接调用 Host 的 RUN-20/22（`:588、601`）。把 draft 改成内部读取，并未消除第二份识别流程。修改思路：注入已有基础设施，经过真实 Host 启动核对及公开认定入口，删除这段代办写入。

   UNSPECIFIED8 也不能接受为正常接线：`:566`只传 owner；缺 lookup 使 platform 项变成 `lookup_not_wired`，缺 capture 使工作区恒为 `not_configured`（`unknown-call-draft.ts:105、159、209`）。单 shell 的 observation 不受 lookup 缺失影响，但采集及平台提交识别没有得到证明。最小办法是复用现成 Host 装配和公开 `resolveUnknownRun`（`create-platform.ts:1980、2070`），无需再复制两套依赖。

2. **必须改：第2项部分完成；UNSPECIFIED5仍违规。** 追加 starts 已删除（`rework4.diff:836`）；14,567→12,676 是获准重算，精确总数及完整必需段仍有断言，纯渲染仍测 T=600 拒绝（`K3-35-T-by-hand.test.ts:133、166`；`K3-35-renderer-boundary.test.ts:155、165`），这一点可以接受。

   但32个 process 项仍被构造并写入场景（`K3-large-review-input.ts:190、257、265`），owner 测试仍手写终态、位置4和历史（`K3-35-owner-manifest-trim.test.ts:106`）。修改思路：真实 owner 场景用可达状态及 Runtime 结束；32项极值留纯函数测试。“旧 owner 行”不构成豁免。

3. **必须改：第3项恢复了竞态，却未恢复要求的拒绝。** 新测试接受 ready（`K3-review-preparation.test.ts:570`），实现仅清空绑定（`execution-preparation.ts:470`）。规格规定任务结束时 CRR 关闭、允许失效（`slice-K3-SPEC.md:537`），没有“prepare 必须 ready”的规定；任务书明确要求拒绝（`k3-g4b3-rework-4.md:49`）。最小修改是按任务书修 closed 分支及断言；若 lead 决定允许旧快照 ready，应先明确改任务书，不能从实现倒推预期。

4. **必须改：第4项及 UNSPECIFIED4未完成。** 串行路径至多一个未决非只读调用的判断成立：混合批次串行；跨 Run 不合并；纯只读并发虽可留下多项，却不产生方案目标（`tool-registry.js:135`；`kernel-turn-facts.ts:68、81`；`unknown-call-draft.ts:105`）。

   但这不能阻止迁移全部用例。“9行”没有准确名单；实际构造链消费者是以下8个文件，另一个相关文件已迁原记录：

   | 文件及行号 | 最小处理 |
   |---|---|
   | `K3-16-approval-application.test.ts:98` | 审批、拒绝、冲突等改真实单项；混合展示转纯渲染。 |
   | `K3-16-proposal-round-fixture.test.ts:64、97、135、245、268` | 正常及未完成轮改单项；process/platform 分别证明；序列化极值转纯 codec，删除只服务旧夹具的场景。 |
   | `K3-16-proposal-write.test.ts:39、186` | 写入、重放、替换、非法 alias、容量均保留真实路径；多 alias 排序转纯测。 |
   | `K3-16-second-unfinished-proposal.test.ts:58、110、128、150` | 改一个真实目标，保留原因和轮次断言。 |
   | `B2-01-task-read.test.ts:30、71` | 原本每记录单项，直接迁移，保留分页证明。 |
   | `B2-09-crr-owner.test.ts:53` | 原本单项，迁真实阻塞记录，保留 owner 行。 |
   | `B2-12-recognition.test.ts:184` | 最后一条 owner 行迁真实记录；前面的纯识别测试保留。 |
   | `B2-02-approved-method.test.ts:41` | 原本单项，完整走阻塞至审批路径。 |
   | `B2-01-blocked-commands.test.ts:149` | 已用真实原记录，不应算第九个造项遗留。 |

   容量无需降成纯测：换行渲染增加两个空格（`continuation-brief.ts:879`），单命令可手算 `28+4000+2×546=5120`、`28+3999+2×547=5121`。

   5,931行中仍有实质副本：proposal 造项、RUN-20/22、独立启动装配（`K3-proposal-round.ts:111、390、607`），普通卡造态（`K3-review-card-fixture.ts:364、389`），以及上面的 large-review 链。应迁移后删除，不能只增加共享 helper。

5. **第5项共享完成，结束方式偏离任务书；崩溃可接受为读数证明。** 两行共用世界并重置计数（`B2-401-world.test.ts:42、54、76`）。普通 completed、无验证轮时确实 verifying，直接 requeue 确实 busy（`task-machine.ts:210、1218`）；这不等于自然结束不可达。模型故障由 Runtime 写成 crash（`B2-401-world.ts:132`；`execution-observation.ts:137、787`），不削弱 B2-16/B2-18 的读取上界证明。但不能宣称已满足“自然结束”，也不能未经裁定写 `lead-approved`（`B2-401-world.ts:16`）。

6. **必须改：第6项异常清理未完成。** 构造循环在请求或答复失败时会跳过释放，catch 直接关库；在途 Run 未登记到 live（`B2-401-world.ts:291、318、345、381`）。后果是模型仍等闸门、Runtime 未退出。修改思路：每次 start 后立即登记，在 finally 中释放、等待，再关库；402次启动失败也同样覆盖。

7. **必须改：UNSPECIFIED7削弱了证明。** 一卡断言无法区分“每任务读一次”和“每卡读一次”（`B2-07-crr-card-closed.test.ts:105、129`）。不同 Run 可以留下不同核对记录，CRR按 reviewRunId＋alias 去重（`command-rerun-request-service.ts:750、818`）。修改思路：真实地产生并处置两份记录，再请求两条命令，恢复同任务两卡、一次 closure 读取。

8. **建议：A8另行归因。** 本轮差异未触及 A8 的直接或递归依赖，未发现改变该路径的代码证据（`rework4.diff:1`；`A8-host-restart-paused.test.ts:39、474`）。但不能据“文件未改”认定超时是基线；交 lead 在有 bwrap 环境核实。

上述必须改项不能转 T。T 可保留任务书明确排除的 K3-11、14、45、48-2原非 proposal 部分、K-R-close-open-turn、B2-execution-entry；不可达组合删除或转纯契约测试后，也不能继续冒充本组场景证据。

先改完列出的几处