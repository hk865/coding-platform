只做了静态审查，未修改文件，未运行测试或构建。发现以下问题：

1. **必须改：方案齐全会掩盖第二次未完成。**  
   `src/core/work-graph/state/unknown-call-review.ts:471` 在方案齐全时直接写 `awaiting_approval`、`decisionReasons: []`，绕过前面算出的 `second`。最小反例：同一次进入提方案状态，第一轮写齐方案后崩溃，第二轮再次未完成；收尾后丢失 `review_incomplete`。这违反规格 L15、UCR-08“第二次没做完，原因一定包含它”，也使审批记录隐去反复失败的事实。**修改思路：**在这个状态分支先处理第二次未完成，确保保留该原因；`proposal_missing` 只按实际缺项添加。补公开入口反例，并验证重新进入状态后重新计数。本条不另行裁定应显示哪种卡。

2. **必须改：提方案输入没有采用答复 3 指定的命令来源。**  
   `src/core/agent-runtime/context-assembler.ts:418` 优先使用 Kernel 全文，`:1229` 在 proposal 阶段也读取全文；`src/contracts/core/prepared-execution.ts:130` 随后直接渲染它。任务书 `.lead-ref/k3-g4b2-impl.md:156` 明确要求 `summary.command`。最小反例：原命令 600 个字符、记录摘要 512 个字符，提方案输入与规定内容及审批卡原命令不一致。更长的多条命令触发裁剪后，`:483–487` 清空 command，提方案输入却写成“原命令：（无）”，把省略误说成不存在。**修改思路：**proposal 分支直接使用记录摘要，跳过只为命令全文服务的 Kernel 读取；裁剪后的显示明确标为省略。保留 review 分支的字节一致性。

3. **必须改：共享方案函数漏处理 cwd 的换行。**  
   `src/contracts/continuation-brief.ts:753` 只给 command 的换行加缩进，cwd 原样插入；规格 L20 明确要求两者都处理。最小反例：`cwd: "a\nb"`、`command: "echo ok"`，审批卡和接续说明里的 `b` 顶格出现，按规定格式应有两个空格，预算也因此少计两字节。**修改思路：**在同一个 `approvedMethodLinesZh` 内对两个字段共用换行处理，补字面输出及临界预算用例；无需新增渲染函数。

4. **必须改：工具入口未经裁定接受显式 null。**  
   `src/core/agent-runtime/unknown-call-review-tools.ts:71` 使用 `.nullable().optional()`；`tests/runtime/K3-16-proposal-tool.test.ts:124` 还固定了这一行为。冻结规格 §2（`slice-K3-SPEC.md:1202`）只有 `cwd?: string`。最小反例就是显式传 `cwd: null`：当前成功进入 owner，超出了工具契约。答复 7 的内部 null 表示可以由缺省值转换得到。**修改思路：**删除 `.nullable()`，保留缺省转 null 的 `unknown-call-review-tools.ts:269`；显式 null 应测为 `invalid_arguments`，内部 owner 继续接受 null。

5. **必须改：关键测试通过注入事实绕过公开路径。**  
   `tests/work-graph/K3-16-approval-application.test.ts:91` 直接提交编码记录和事件，`:195–205` 把原 Run 当提方案 Run，手写领取、方案和完成事实；`tests/work-graph/K3-16-proposal-write.test.ts:136`、`tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts:211` 也直接灌入前态。最小反例：真实提方案领取或 Run 守卫失效，这组审批测试仍能制造审批卡，不能证明任务书要求的接线。**修改思路：**共享一个经过公开领取、`recordProposal`、Run 结束、`settleReview` 的夹具，继续覆盖内存和 SQLite。混合初始草稿已有 owner 层公开入口先例（`tests/work-graph/K3-06-mixed-kinds-owner.test.ts:8`），后续方案路径现在即可验证，无须推到 B3。另把审批预期在 `K3-16-approval-application.test.ts:137` 对生产渲染函数的调用换成字面值。

6. **必须改：K3-35 的数据不符合冻结边界，报告数字不能作为验收证据。**  
   `tests/helpers/K3-35-continuation-fixture.ts:220` 的略去数是五位 `65535`，`:234` 得到一位锚点略去数 `8`；`:222–223` 又给“一个进程项、31 个平台项”设置空 `proposalTargets` 和 32 个获批方案。测试还要求 32 个平台目标（`tests/runtime/K3-35-approved-methods-brief.test.ts:93`）。这是不一致的审批事实；`tests/helpers/K3-35-prepare.ts:182` 再由替身读取器直接送入 prepare。  
   `31×159+160+31=5120` 本身算对了，但 15,758／16,393 对应上述错误数据。按 L20 表、十六位略去数、一个进程项和31个平台项，去掉 B3 的句子及连接换行，必需部分应为 **15,710 字节（T=512）／16,414 字节（T=600，超30字节）**。**修改思路：**用公开 owner 生成一致的目标、方案和审批事实；极大计数放在独立渲染契约边界例中，重新手算并固定期望。单个合法多行命令经缩进膨胀即可把方案块凑到5,120字节，无须给平台项造方案。

7. **建议：删除已经失效的 B1 开关。**  
   `src/core/work-graph/tasks/unknown-call-review-card.ts:190` 恒写 `b1Unavailable: false`，`src/core/work-graph/views/decision-read-model.ts:505` 仍保留对应条件分支。所有卡都走同一支，却让代码继续表达“审批尚不可用”的旧状态。**修改思路：**删除字段及条件，直接设置当前可答属性；这是被 B2 取代路径的清理，符合决定 69，不需要扩大重构。

先改完列出的几处