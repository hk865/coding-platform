仅静态核对，未修改文件、运行测试或构建。以下用唯一文件名定位。

1. **已修。** 展平全部命令后，按时间、别名、记录键排序（`command-recognition.ts:42`）。

2. **部分完成，必须改。** 分页已共用关闭结果，但一次 hook 消费允许仍读两次：`execution-driver.ts:469、497` 分别进入 `command-rerun-request-service.ts:485、1067`。违反“一次调用读一次”，也可能取得两个时点的事实。修改思路：在受信内部调用中传递本次关闭结果，补消费允许分支的计数断言。

3. **已修。** 无写入 pending/allowed 返回等待命令（`command-rerun-request-service.ts:823、832`）；工具直接使用返回值，点读已去（`command-rerun-tools.ts:194`）。符合 lead 裁定。

4. **未完成，必须改。** 事实检查仍有漏项，详见下文。

5. **已修。** 展开命中后的重放与改包断言成立（`B2-15-replay.test.ts:125、149、156`）；前缀测试复用真实运行链（`K3-prefix-claim.ts:72`）；platform-only 空列表和零读取断言恢复（`B2-01-blocked-commands.test.ts:134`）。

6. **指定去重已完成。** UCR 共用 pin 守卫（`unknown-call-review-service.ts:45`），字段检查集中到 `codec-shape-checks.ts:12、20、27`；单页处理及旧输入转换清理完成（`command-rerun-request-service.ts:525`、`workflow.ts:720`、`collaboration-driver.ts:818`）。

事实检查不能以“传给真实 owner”一概放行：生产认定入口自己读取草稿（`create-platform.ts:2070`），草稿中的调用、摘要、观察均由平台推导（`unknown-call-draft.ts:189`）。

- **B2-18：必须改。** 初始条目、续跑 Kernel 身份和位置均为手写事实（`B2-18-request-reads.test.ts:65、123、135`），不是依赖注入。它们绕过实际执行接线。修改思路：初始记录复用真实阻塞运行夹具；每次续跑经 runtime.startRun，再用真实上下文请求、答拒、结束及重排。保留 401，成本值得；**无需每轮重新制造未知调用、读取审查草稿**，所以不能据约三分钟就断言成本必然倍增。

- **K3-35：必须改。** 真实草稿读出的进程身份和位置允许使用（`K3-35-continuation-fixture.ts:238`）；手填观察、追加 31 个平台条目不允许（同文件 `:214、616、618`）。提案轮也仍经手造 manifest、prepared、Kernel 身份及位置进入（调用处 `:638`；`K3-proposal-round.ts:586、609、610、636`）。因此当前字节数不能证明完整公开路径。修改思路：让原 Run 真实声明这些工具调用，由草稿读取器产生条目；核对、提案轮走真实 prepare/startRun，让对应 owner 产生结论。无法公开产生的组合只留纯渲染测试，随后重算总数。31 条可放在原 Run 的工具批次，不必增加 31 个 Run。

- **漏报：必须改。** 本轮改动的 B2-16 仍编造 401 个 Run 身份（`B2-16-hook-reads.test.ts:219`）。复用上述真实运行夹具，否则分页证明仍依赖伪造前态。时钟、ID 生成器、阻塞工具本身属于允许的依赖注入；例如 ID 交给 claim owner（`K3-35-continuation-fixture.ts:358`），与直接填写已发生的 Kernel 身份不同。

UNSPECIFIED 逐项意见：**1、2 不接受**，按上述修改；**3 必须改**，`K3-review-preparation.test.ts:515` 返回的 closed=true 是手填派生状态，改经公开计划变更关闭任务，已有入口 `K3-review-card-fixture.ts:318`。**4 接受**，仅有阻拦绑定时读取符合成本边界（`execution-preparation.ts:456`）。**5 接受**，共享守卫明确处理畸形 pin（`revision-guard.ts:26`）。**6 不接受，必须改**：加一位置和自造 cursor（`K3-35-continuation-fixture.ts:456、464`）没有对应真实终态；生产取实际历史位置和规范游标（`execution-observation.ts:731、737`），读取器会拒绝非规范游标（`session-operations.ts:931`）。应注入实际停止／故障，让 Runtime 记录边界。

另有一处**必须改的断言退化**：原近界完整必需段断言被删除（`.lead-ref/rework2.diff:3712`），纯边界测试只检查固定句和上限（`K3-35-renderer-boundary.test.ts:147`），漏删锚点或方案也可能通过。修改思路：把完整必需段断言迁入纯边界用例。**建议**共用两个阻塞接缝的门闩逻辑，避免维护两份（`K3-tool-seams.ts:26、96`）。

上述必改项仍阻止 K3 第4组整体合入。

先改完列出的几处