仅做静态复核，未修改文件，未运行测试或构建。第 1–4、7 条已改；第 5、6 条部分完成，仍有两处必须改。

1. **已改。** 第二次未完成时，即使方案齐全，也进入 `needs_decision` 并保留 `review_incomplete`；只有真正缺方案才加 `proposal_missing`（`src/core/work-graph/state/unknown-call-review.ts:475`、`:478`）。新增用例覆盖内存、SQLite、缺方案和重新进入状态后计数归零（`tests/work-graph/K3-16-second-unfinished-proposal.test.ts:109`、`:127`、`:149`）。

2. **已按修订后的裁定修改。** 命令仍优先取 Kernel 全文，缺失时回退摘要；原预算和裁剪路径保留（`src/core/agent-runtime/context-assembler.ts:418`、`:422`、`:476`）。`unexpanded` 使用摘要加指定后缀（`src/contracts/core/prepared-execution.ts:139`）。`summaryCommand` 仅加在 proposal 阶段，null 渲染为空串加后缀，未发现违背本次裁定之处（`src/core/agent-runtime/context-assembler.ts:442`；`src/contracts/core/prepared-execution.ts:140`）。

3. **已改。** 共享函数同时缩进 cwd 和 command 的换行（`src/contracts/continuation-brief.ts:753`）；字面输出及 5,120／5,121 字节边界已有对应断言（`tests/runtime/K3-16-approved-method-lines.test.ts:20`、`:40`、`:48`）。

4. **已改。** 工具 schema 不再接受显式 null，缺省仍转成 owner 的 null（`src/core/agent-runtime/unknown-call-review-tools.ts:71`、`:269`）。旧成功用例已改为 `invalid_arguments` 且零次写入，缺省用例保留（`tests/runtime/K3-16-proposal-tool.test.ts:117`、`:124`）。

5. **部分完成；必须改：预期值仍是第二份实现。**  
   三份测试的 B2 前态已改走共享公共步骤，并覆盖内存和 SQLite（`tests/work-graph/K3-16-approval-application.test.ts:125`、`:199`；`tests/work-graph/K3-16-proposal-write.test.ts:35`、`:73`；`tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts:183`、`:261`）。

   helper 经公开 owner 创建核对记录、写方案，没有直接提交这些事实（`tests/helpers/K3-proposal-round.ts:296`、`:830`）。它**确实手写了** `run_crashed` 运行结果事件，但作为公开 `recordRunResult` 的输入，并非直接灌入存储（同文件 `:637`、`:642`）。K3-48 原 review 半段的旧注入仍在，按任务书保留（`tests/work-graph/K3-48-2-unknown-call-review-model-text-budget.test.ts:129`）。

   剩余问题是审批预期新增了本地 `sort/map/replace` 渲染副本，并从实际 `record.proposals` 计算 expected（`tests/work-graph/K3-16-approval-application.test.ts:46`、`:66`、`:228`）。额外错误方案也会同步进入预期，未满足“字面预期”。**修改思路：**固定完整审批文本、方案命令和目录，仅插入动态 Run 标识，删除该格式化副本。

6. **部分完成；必须改：数字正确，夹具事实仍不一致。**  
   手算成立：`110＋9090＋961＋5120＋357＋43＝15681`；T 从 512 增至 600，再加 `8×88＝704`，得到 **16385，超 1 字节**。相对原 15710／16414 少的 29 字节，分别来自记录略去数由十六位变一位、锚点略去数变两位（`tests/runtime/K3-35-approved-methods-brief.test.ts:147`、`:197`）。单方案块也确为 `25＋3＋3892＋1200＝5120`（`tests/helpers/K3-35-continuation-fixture.ts:107`）。

   但“18 个锚点”是三次复用同一组 runId/ref，实际只有 **8 个唯一引用**，前后任务 ID 又分别为 T 字节和 32 字节（`tests/helpers/K3-35-continuation-fixture.ts:130`、`:132`、`:159`）。正式读取按任务过滤并去重，不能返回这组“8 渲染＋10 省略”的事实（`src/core/work-graph/tasks/run-state-service.ts:429`、`:444`、`:452`）。

   prepare 用例仍把另一个任务生成的审批记录拼入合成 basis，再由替身读取器直接返回（`tests/helpers/K3-35-continuation-fixture.ts:216`；`tests/helpers/K3-35-prepare.ts:168`、`:177`、`:186`）。因此不能作为一致公共路径的容量证据。**修改思路：**核实并构造同一任务、唯一引用的可达锚点，使审批记录和接续 basis 同源；仅用于极限计数的合成数据留在纯函数测试。

   独立 `K3-35-renderer-boundary` 是直接调用纯渲染函数的契约测试，没有状态注入，这部分合格（`tests/runtime/K3-35-renderer-boundary.test.ts:37`、`:41`）。

7. **已改。** 卡事实不再返回 `b1Unavailable`，读模型直接设置可回答（`src/core/work-graph/tasks/unknown-call-review-card.ts:182`；`src/core/work-graph/views/decision-read-model.ts:505`）。

对其余 UNSPECIFIED：手建 manifest 和固定 `full` 可作为当前 owner 级测试替身，但不能证明真实 prepare／模型接线（`tests/helpers/K3-proposal-round.ts:424`、`:477`、`:683`）。**建议**修正“脚本模型”表述：这里实际直接调用工具 handler（同文件 `:823`）。本次未发现其他生产代码回归。

先改完列出的几处