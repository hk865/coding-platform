| 核对项 | 状态 |
|---|---|
| chk2 #1 | 已修复：allowlist 说明格式正确，PC-1b 清理由 J 独占。 |
| chk2 #2 | 部分修复：已消除 WorkGraph → Runtime，但新签名引入 Contracts → RecordStore，见新增 1。 |
| chk2 #3 | 部分修复：真实类型名、窄渲染输入和 P 所有权已补；共享校验接口仍需调整，见新增 1。 |
| chk2 #4 | 已修复：共用 facts 两路带 cap，Query 明确投影删除，admission 合同已补。 |
| chk2 #5 | 已修复：组合根归 R，缺少读依赖明确返回 unavailable。 |
| chk2 #6 | 已修复：`readPromptRecord?` 可选，真实 factory 始终提供。 |
| chk2 #7 | 部分修复：三个真实 Run 和 selector 分工成立；OpenAI 出站断言仍不成立，见新增 2。 |
| chk2 #8 | 序号原子保护已修复；冲突返回表述仍需明确，见新增 3。 |
| 原 v1 #2（部分修复行） | 已修复：登记格式与清理 owner 均已补齐。 |
| 原 v1 #6（部分修复行） | 部分修复：Query 接缝、组合根已补，正文共享接口尚有新增 1。 |
| 原 v1 #8（部分修复行） | 部分修复：给定 Kernel 夹具可连续调用 `run`；PC-17 尚有新增 2，夹具入基线仍是开跑前条件。 |
| 原 v1 #12（部分修复行） | 原子序号已修复；剩余冲突返回问题见新增 3。 |
| 原 v1 #14（部分修复行） | 已修复：可选 Runtime 方法解决旧替身兼容问题。 |

1. **阻塞｜裁定 17、§4：共享校验函数仍跨越禁止边界，调用参数也不一致。**

   `RawArtifactRecord` 定义在 [body-ports.ts:17](D:/cxt/pc/src/core/record-store/body-ports.ts:17)。让 contracts 中的 `checkPromptBody` 引用它，会触发 [check-boundaries.mjs:510](D:/cxt/pc/scripts/check-boundaries.mjs:510) 的 Contracts → RecordStore 禁令，类型导入也会检查。WorkGraph 自行读取 bodies 的拆分本身符合 [module-target.json:19](D:/cxt/pc/docs/refactor/module-target.json:19)。

   **改文：**把参数改为 contracts 内定义的结构类型，例如 `record: { ref: ArtifactRef; body: string }`；实际 `RawArtifactRecord` 可直接传入，无需反向导入。同时把裁定 17 的两参数调用改为 §4 要求的三参数调用：`checkPromptBody(ref, record, PROMPT_TEXT_CONTENT_TYPE)`。

2. **阻塞｜PC-17 第二部分：不能要求 thinking-only 保留在“两家适配器”的请求体中。**

   给定夹具确实使用真实适配器，见 [PC-kernel-fixture.ts:385](D:/cc-lead-notes/impl/pc/fixtures/PC-kernel-fixture.ts:385)。OpenAI 只投影正文和调用；两者都空就产生空列表，见 [openai-model-client.js:27](D:/cxt/pc/vendor/coding-agent/dist/model/providers/openai/openai-model-client.js:27)。冻结规格也明确 OpenAI 不带思考，见 [规格:156](D:/cxt/pc/docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md:156)。

   **改文：**`current_run` 下，当前 thinking-only 留在 selected copy，DeepSeek 请求体保留它；OpenAI 请求体没有对应项。`none` 下 selector 删除它。分别断言两家已有协议形状，适配器不改。三个真实 Run 可通过夹具暴露的 `run` 连续完成，不受 `twoRuns` 便利方法限制。

3. **应改｜裁定 26：“returned as the store's conflict”没有对应的领域返回码。**

   唯一槽的 `expectedOwner: null`、`nextOwner: permitId` 与 [ports.ts:85](D:/cxt/pc/src/core/record-store/ports.ts:85) 相容，能保护序号。但存储返回 `unique_conflict`，而 [CoreError:16](D:/cxt/pc/src/contracts/core/results.ts:16) 不包含它；现有映射会转成 `busy`，并附加“Kernel identity slot … another Run”，见 [read-result-failures.ts:98](D:/cxt/pc/src/core/work-graph/persistence/read-result-failures.ts:98)，不适用于这个序号槽。

   **改文：**明确“槽冲突时，本次授权不提交、不重试；R 在授权服务内将该 `unique_conflict` 映射为 `busy`，reason 明确说明请求序号槽已被占用”，不要透传存储错误或使用 Kernel 身份槽说明。

Owner 表按 S 的 send 与 J 的 joint 限定读取，未发现同一 run 的实际重复归属；C/P 跨夜编辑同一文件符合规则。

**PC-1a 单独判断：**在冻结夹具按要求入基线的前提下，未发现剩余指令必然破坏 typecheck、build、`check:architecture` 或旧测试；但 PC-17 的新增验收断言仍阻止整批全绿。本次仅静态核对，未修改文件，未运行测试、构建、git 或网络。

结论：改后再核