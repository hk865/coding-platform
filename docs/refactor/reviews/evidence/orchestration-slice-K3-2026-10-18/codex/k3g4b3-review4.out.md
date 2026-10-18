仅作静态核对，未修改文件、运行测试或构建。以下用唯一文件名定位。

1. **返工书逐项结论：1、4、5 已修；2、3 未完。**  
   1：hook 将 closure 传给消费，缺省时仍真实读取（`execution-driver.ts:507`、`command-rerun-request-service.ts:1093`）；计数和实际消费均有断言（`B2-16-hook-closure.test.ts:82、85`）。4：整段必需文字比较已恢复（`K3-35-renderer-boundary.test.ts:153`）。5：两种 seam 共用一份 latch 实现（`K3-tool-seams.ts:30、67、115`）。2、3 的缺口如下。

2. **必须改：共享入口仍接受事实，并手工决定执行终态。**  
   构造选项确实只有依赖（`K3-35-continuation-fixture.ts:315`），但公开方法 `createRecordFromDraft` 接受包含 Kernel 身份、位置、review/observed items 的完整 draft（`:553`），随后自行拼核对结果（`:563`）。`recordRealRunEnd` 又手造完成/崩溃事件并提交（`real-run-end.ts:172、182`），并非故障触发 Runtime 记录终态；真实路径还检查终态与资源退出证明（`execution-observation.ts:739、772`）。因此真实位置、游标不能补足证明。修改思路：共享入口内部读 draft、调用真实 classifier；正常结束放开模型回复，异常结束注入实际失败/停止，再等待 Runtime 记账。源码摘要也须真实采集，不能哈希计数器（`K3-35-continuation-fixture.ts:432`）。

3. **必须改：31 个 starts 是手写 Kernel 事实，不是依赖注入。**  
   测试构造事件及 sequence，再直接 append（`K-boundary-facts-support.ts:172、180`）；“冻结接缝”的命名不改变性质。当前混合工具批逐个执行（`tool-registry.js:135、142`），所以同时悬着这32项不是默认公开路径。修改思路：真实场景保留可达的阻塞调用，32项极端按书留纯渲染；如需测试批调度依赖，应让 Kernel 自己产生 starts 并进入工具（`runtime-runner.js:627、638、644`），不能追加历史冒充执行。

4. **必须改：closed 分支可由真实竞态触发，不能删分支或删测。**  
   两个顺序拒绝判断正确：未结束 Run 阻止 Plan 关闭（`plan-machine.ts:656`），已关闭 Task 拒绝 requeue（`task-machine.ts:1222`）。但 prepare 在 `execution-preparation.ts:334、350` 检查旧快照，`:461` 才读 closure。此间可公开取消未入场 Run并释放占用（`run-machine.ts:1927、1959`），再公开关闭 Task（`K3-review-card-fixture.ts:342、350`）。修改思路：在真实 closure reader 前加 latch，执行上述操作再放开，恢复被删除的断言及纠正“不可达”注释（`K3-review-preparation.test.ts:514`）。

5. **必须改：共享迁移没有收掉同态旧入口，增长有具体重复原因。**  
   本轮应迁移：假后续 Run（`B2-blocked-runtime.ts:131`）、手造 process item（`B2-crr-world.ts:24`）、布尔 closure（`K3-crr-fixture.ts:141`）、proposal item 构造器及另一套启动装配（`K3-proposal-round.ts:112、127、594`）、自动结案 item 与缺命令时的常量回退（`K3-review-card-fixture.ts:366、137`）。它们仍给组4场景提供先态，会绕过真实生产者；统一调用修好的共享路径。K3调用链也应脱离 `B2-execution-fixture.ts:200` 的手造 prepared。`B2-runtime-fixture.ts:69、140` 的模型、Host依赖可以保留；旧治理种子（`:194`）交T。无人调用的 `setTaskActive` 应删除（`K3-crr-fixture.ts:208`）。

6. **UNSPECIFIED 3 不能全部延期，也不应扩大成全仓重审。**  
   旧 owner 造态可交T：`K3-11-review-reasons.test.ts:162`、`K3-14-unknown-call-review-tool.test.ts:125`、`K3-45-review-incomplete.test.ts:142`、`K3-48-2-unknown-call-review-model-text-budget.test.ts:132`；这叫待审，不叫合法。K旧关闭夹具（`K-R-close-open-turn.test.ts:68`）及旧 scope seed（`B2-execution-entry.test.ts:237`）同理；纯 recognizer 输入适用例外（`B2-12-command-recognizer.test.ts:85`）。但组4 proposal 半仍手造 items（`K3-48-2-unknown-call-review-model-text-budget.test.ts:167、184`），属于第5项必须随迁移修复的验收证据。

7. **成本建议优化；新增连接泄漏必须改。**  
   R=401 的跨页证明值得保留，但两套循环重复建世界（`B2-18-request-reads.test.ts:210`、`B2-16-hook-reads.test.ts:252`），约208秒和230秒不是必需成本。可共用一次401-Run环境，先测只读 hook，再测第402次请求，分别清计数；每轮放开模型自然结束，省掉手工崩溃和额外历史读取。新 harness 另开 SQLite（`K3-35-continuation-fixture.ts:404`），两处调用却只清理原 world（`B2-18-request-reads.test.ts:63、206`；`B2-16-hook-reads.test.ts:60、250`）。应统一用 `finally` 释放 gate、等待执行并关闭 union，避免遗留连接。

本轮仍留下伪造终态、重复造态、删测和资源清理缺口，尚不足以支持 K3 第4组整体合入。

先改完列出的几处