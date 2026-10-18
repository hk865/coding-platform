只读核对完成；未修改文件，未运行测试或构建。两处必须改。以下用文件短名定位，SPEC 指 slice-K3-SPEC.md。

裁定逐项结论：

1. **是。** edit 保持 `workspace_write`，shell 保持 `process`（K3-mixed-seams.ts:59；K3-tool-seams.ts:56）。未向真实 Kernel 库注入历史；32 项规模夹具使用读取替身（K3-large-review-input.ts:350）。
2. **部分。** K3-06 经公开创建、领取、写结论、清算，覆盖 memory/SQLite（K3-06-mixed-kinds-owner.test.ts:159、166、195、211、239）；K3-35 同样成立（K3-large-review-input.ts:213；K3-35-owner-manifest-trim.test.ts:52、73、109、133）。K3-13 的创建和领取仍绕过 owner，见下。单项 R2 已接真实链：K3-06 三类分别在 K3-06-mixed-batch.test.ts:174、241、265；K3-13 在 K3-13-two-commands.test.ts:109、134、149；K3-35 的长命令、512 字节 callId、200 条真实路径及清算在 K3-35-review-input-size.test.ts:130、147、166、227。
3. **是。** 158,720、262,144、65,536 都是字面值；裁剪后明确断言 32 项、别名顺序和尾部收缩（K3-35-owner-manifest-trim.test.ts:67、177、180、185、186、208）；清算断言在 :138。
4. **是。** 两轮均经工具写入、干净中断、Workflow 清算；三原因固定顺序及两轮 unfinished 已断言（K3-11-review-reasons-r2.test.ts:190、223、245、257；K3-45-review-incomplete-r2.test.ts:131、174、218、234）。连续第二次经真实接续和认定（前者 :309、330、370）；清单不完整经公开认定创建（K3-11-review-reasons.test.ts:302）。
5. **部分。** 真 prepare 已有，但模型执行、Workflow 清算和 HTTP 回读未贯通，见下。
6. **是，针对本次要求的验收材料。** 原直接开库读取已换成公开材料入口和模型请求观察（K3-35-review-input-size.test.ts:185、217；K3-42-truncated-command.test.ts:172、182；公开读取实现 brief.ts:115）。owner 夹具的 bodies 端口操作不等于另开数据库。
7. **是。** B1 经 Runtime 拒绝 proposal、零模型调用（K3-19-review-admission.test.ts:55、83）；A1 断言无领取、准备、启动且最终无轮次（K3-19-missing-read-no-round.test.ts:188、210）。

**必须改：K3-13 owner 用例仍是拼状态。**  
K3-13-two-items-owner.test.ts:81 指向未创建的原 Run，:83 直接调用状态构造器，:94 手动迁移领取，:102 直接提交记录；:58 的摘要是 `'d'.repeat(64)`，仅格式合法。后续虽经过真实写入和清算，公开创建或领取坏了仍可通过。

修改思路：照 K3-06 的 owner 用例，经 `reconcileRun → resolveUnknownRun → claimTask(review)` 建立两项记录和真实核对 Run，计算 SHA-256；保留现有“第二项无结论”的清算断言，两个后端都走。

**必须改：K3-42（二）的“无公开路径”不足以成立。**  
当前模型只收到假 request，流由测试手动拆解，再直接执行 handler（K3-42-unexpanded-r2.test.ts:66、69、150）；实际入场清单的 items 是空数组（:117），另把 prepare 的显示映射直接交给清算服务（:172、178）。因此生产清单读取接线断掉也能通过；真实接线在 create-platform.ts:659。

不需要把 32 项塞进 HostScenario。静态代码支持更小的合法路径：公开 `plans/propose/apply` 写入较长任务说明（AG2b-collaboration-fixture.ts:369、372）；instruction 只要求非空，且原样进入任务上下文（plan-record-codecs.ts:375；context-assembler.ts:655）。配合单条含控制字符的长命令，把清单调到“展开时超过 262,144，收成底线后可容纳”，真实 prepare 就能产生 `unexpanded`（execution-preparation.ts:98、425）。

修改思路：复用 K3-42（一）的真实链，只调整公开输入；断言真实清单为 `unexpanded`，随后 Runtime 执行、Workflow 清算、HTTP 回读。单纯增加命令或路径不保证奏效：命令先限 4 KiB，路径先于条目裁掉（context-assembler.ts:368、418、426）。

UNSPECIFIED 1–5：

- **1：已有规定。** 未提交发送应为 `not_done/not_committed`，SPEC:179 明确；阻塞器确实不调用真实写入（K3-mailbox-seam.ts:53）。
- **2：已有规定。** file_edit、已查明的平台项可在创建时 resolved，无须强造核对轮；符合 SPEC:290、297。
- **3：正确。** “建记录时”限定 streak 的取值；清算时生成原因，符合 SPEC:407、418；真实链已分别检查创建事实和清算原因（K3-11-review-reasons-r2.test.ts:338、370）。
- **4：建议。** 通用原因是现有实现：缺 read 返回空能力，Runtime 映射成“开关关闭”（runtime-configuration.ts:477；runtime.ts:430）。不阻塞本组；测试宜锁定 unavailable 和无领取行为，避免锁死含糊文案。
- **5：建议。** synthetic Run 是 prepare 层的依赖替身，未作为真实 Run 落库（K3-large-review-input.ts:444、473）；作为局部容量测试可接受，不能算真实轮次证据。建议改用公开 claim 得到的 Run，使其与 owner 的 activeRound 一致；K3-35 已有可复用的领取步骤（K3-35-owner-manifest-trim.test.ts:73）。

**A8：建议修正归因措辞。**  
未发现会话 4 的直接代码回归路径：差异限于列出的 K3 测试及专用辅助文件（g3d-stat.txt:1）。但“生产未改”不能排除并发负载、资源或时序影响，也不能证明是基线。A8-host-restart-paused.test.ts:474 只是等待 Goal 完成；超时来自公共轮询（harness.ts:703）。修改思路：先记“未归因”，由 lead 在相同条件下对照会话 3 的同一用例；相邻用例同类超时不足以定案。

先改完列出的几处