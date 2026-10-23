| v1 # | 状态 | v2 核对结果 |
|---|---|---|
| 1 | 已修复 | C 已拥有生成器，并负责 `origins`、六个资源及 manifest 摘要。 |
| 2 | 部分修复 | 已允许登记不可达声明；登记说明的格式和 PC-1b 清理的唯一 owner 仍缺，见下文 1。 |
| 3 | 已修复 | 私有映射保存选包字段，绑定重建恢复，并要求完整 Host 测试。 |
| 4 | 已修复 | 明确 Work 复制 `selection`，两路均在后续 await 前取值。 |
| 5 | 已修复 | proposal、初始化指南、角色字符串均纳入冻结。 |
| 6 | 部分修复 | 已补主要依赖和 loader 分工；新正文接口、Query 接缝及组合根仍有缺口，见 2–5。 |
| 7 | 已修复 | reservation 首写、admission 置位、后续 usage 合并及不可变字段已明确。 |
| 8 | 部分修复 | 补了能力和开跑前交付要求；当前树仍无两份 PC 夹具，PC-17 还有不可到达场景，见 7。 |
| 9 | 已修复 | 固定计数、首轮工具调用、输出用量及 clamp 数值均已补齐。 |
| 10 | 已修复 | 兼容承诺已收窄，默认预估沿用 runner 的 estimator。 |
| 11 | 已修复 | 删除条件包含 `reasoningContent`，当前 thinking-only 的保留规则明确。 |
| 12 | 部分修复 | 已加 `sequence` 和同时间戳案例，但现有 Run revision 检查不足以保护序号分配，见 8。 |
| 13 | 已修复 | 仅传平台根 selection 的夹具已移到无需修改名单。 |
| 14 | 部分修复 | 已列直接调用迁移、兼容 renderer 和独立读端口；新 Runtime 方法的旧替身兼容性未定，见 6。 |
| 15 | 已修复 | 永久测试改钉字面摘要，不再依赖随后删除的目录。 |
| 16 | 已修复 | 明确计入新增 manifest 字节，并限定相关边界断言的修改理由。 |

1. **应改｜裁定 13、§4：allowlist 说明不能只写 PC-1b，清理也不能分给多个组。**

   `kept-for` 的 `note` 必须匹配 `slice N of the orchestration design` 或 `MVP-BEHAVIOR.md`；仅写 PC-1b 会失败。见 [production-reach.test.ts:40](D:/cxt/pc/tests/architecture/production-reach.test.ts:40)、[校验处:83](D:/cxt/pc/tests/architecture/production-reach.test.ts:83)。此外，“各声明接线时删除条目”会使 P/S/R 修改同一个 allowlist，而 §4 没有给它 PC-1b owner。

   **建议改文：**给出合规示例：`PC-1b, slice 6 of the orchestration design: <消费者>`；PC-1b 由最后的联合组统一删除已接线条目，P/S/R 只报告清单。

2. **阻塞｜裁定 17、§4：WorkGraph 入口不能直接调用 Runtime 所有的正文 helper。**

   书中要求 `execution-entry-service.ts` 经 `src/core/agent-runtime/prompt-set-texts.ts` 回读正文。这产生禁止的 `WorkGraph → AgentRuntime` 依赖。WorkGraph 仅允许依赖 WorkspaceTools、RecordStore，见 [module-target.json:19](D:/cxt/pc/docs/refactor/module-target.json:19)；检查在 [check-boundaries.mjs:513](D:/cxt/pc/scripts/check-boundaries.mjs:513)。

   **建议改文：**Runtime 保留自己的 I/O helper；WorkGraph 入口使用已有 `deps.bodies` 读取，复用放在 contracts 的纯校验、解码逻辑。明确新增共享文件由 P 在 PC-1b 拥有，不放宽模块边界。

3. **阻塞｜§4 冻结接口、裁定 14/17：正文接口尚不能直接作为可编译合同使用。**

   当前没有 `BodyStorePort`、`BodyReadPort`、`BodyOriginV1`；实际类型是 `RawArtifactStorePort`、`MaterialOrigin`，见 [body-ports.ts:7](D:/cxt/pc/src/core/record-store/body-ports.ts:7)、[接口:23](D:/cxt/pc/src/core/record-store/body-ports.ts:23)。另外，`readPromptTexts` 返回的 `templates/strings` 不满足书中要求传给 renderer 的 `ResolvedPromptPackV1`：还缺 manifest、tools 和新增 origins，见 [prompt-pack.ts:22](D:/cxt/pc/src/contracts/prompts/prompt-pack.ts:22)、[render-template.ts:186](D:/cxt/pc/src/contracts/prompts/render-template.ts:186)。

   **建议改文：**读写参数明确使用 `Pick<RawArtifactStorePort, 'read'|'put'>` 的相应投影及 `MaterialOrigin`。另冻结仅含 `templates/strings` 的渲染输入类型，renderer 接受该窄类型；完整 resolved pack 自然兼容。把相关 renderer 文件的 PC-1b 所有权给 P，避免实现者各自拼假 manifest 或断言转换。

4. **阻塞｜裁定 24/27、§4：Query facts 与共用 `beforeCall` 的必填 cap 冲突。**

   §4 要求共用 `ModelCallAccess.beforeCall.prompt` 必带 `maxOutputTokens`，裁定 24 却只为 Work 计算该字段。Query 使用的正是这个共用接口，见 [query-execution.ts:385](D:/cxt/pc/src/core/agent-runtime/query-execution.ts:385)。同时，Query admission 当前有独立输入合同，仍只有旧四项，见 [queries/contracts.ts:158](D:/cxt/pc/src/core/work-graph/queries/contracts.ts:158)；§4 只冻结了 reservation 类型。

   **建议改文：**共用内部 `beforeCall` 的 facts 两路均携带实际 cap；Query 在 reservation/admission/usage 投影时明确去掉 `maxOutputTokens`，仅持久化 `reservedOutput`。同时列出 admission 新增 `prompt: QueryRequestPromptFactsV1` 的准确签名及 R 所有权。

5. **阻塞｜裁定 30、§4：真实组合根的接线无人负责。**

   Runtime 和模型许可服务实际在 [create-platform.ts:1179](D:/cxt/pc/src/composition/create-platform.ts:1179) 创建，依赖对象在 [同文件:1183](D:/cxt/pc/src/composition/create-platform.ts:1183) 装配。裁定 30 要求真实 Host composition 注入两项依赖，但该文件不属于任何组。尤其 `modelRequestReads` 没有可替代的默认实现，漏接会让真实 Work 请求读取不可用。

   **建议改文：**将 `src/composition/create-platform.ts` 明确划给 PC-1b 的 R，接入真实许可读取服务和平台 pack source；说明 `modelRequestReads` 缺省时读取返回什么拒绝，不能返回空请求列表。

6. **阻塞｜裁定 29、§5.3：新增 Runtime 方法的可选性未定，会影响未授权修改的旧测试。**

   当前 `readContinuationBrief` 等增量方法刻意采用可选成员，以兼容旧端口字面量，见 [ports.ts:73](D:/cxt/pc/src/core/agent-runtime/ports.ts:73)。若按书中普通方法签名新增必填 `readPromptRecord`，例如 [R5c-workflow.test.ts:50](D:/cxt/pc/tests/business/R5c-workflow.test.ts:50) 的完整 `RuntimeExecutionPort` 替身立即缺成员；同类还有 K3、S5 和 A2 测试，均不在 §5.3。

   **建议改文：**明确采用 `readPromptRecord?`，真实 factory 始终发布实现，缺依赖时明确拒绝，沿用已有模式。若要求必填，则必须补齐这些替身的修改名单和 R 的所有权。

7. **阻塞｜PC-17、§5.1：当前轮 thinking-only 的出站场景无法经所列真实运行步骤产生。**

   无工具调用的 assistant 一完成，Kernel 就进入 `ready_to_complete`，不论是否只有 thinking，见 [run-state.js:407](D:/cxt/pc/vendor/coding-agent/dist/core/runtime/state/run-state.js:407)。runner 随即结束，也不再接收注入输入，见 [runtime-runner.ts:643](D:/cxt/pc/vendor/coding-agent/patches/core/runtime/loop/runtime-runner.ts:643)。因此它不会成为同一轮下一次请求里的当前 thinking-only 消息。

   此外，历史同时含 thinking-only 和 text-plus-thinking 两种无调用结尾，至少需要两个历史 Run，再加当前 Run；夹具写的“两次运行”不够。

   **建议改文：**PE5 用至少三个真实 Run 验历史过滤、当前 calls-plus-thinking 和原历史不变；当前 thinking-only 的保留／删除改经 PE4 的 selector 小输入与 PE7 捕获验证。夹具能力改为同 Session 多次运行，不新增继续执行 thinking-only 结尾的生产行为。

8. **应改｜裁定 26、PC-09：检查 Run revision 不等于串行分配许可序号。**

   当前授权提交只写许可记录，不更新 Run revision，见 [model-call-service.ts:151](D:/cxt/pc/src/core/work-graph/tasks/model-call-service.ts:151)、[提交处:158](D:/cxt/pc/src/core/work-graph/tasks/model-call-service.ts:158)。两个不同 requestId 的并发授权可以读到相同许可数、通过同一 Run guard，取得同一 `sequence`。

   **建议改文：**明确序号的原子保护方式，例如在授权提交中为完整 RunRef＋sequence 占用唯一槽，冲突后重新读取序号再重试；现有 [UniqueClaimChange](D:/cxt/pc/src/core/record-store/ports.ts:84) 可承载该约束。不能将现有 Run revision 检查描述为已经足够。

**PC-1a 单独判断：**未发现 K/C 的其余指定改动必然破坏 typecheck、build 或旧测试；保留旧 Skill 目录和仅新增类型导出的安排成立。但现稿的 allowlist 写法不能保证 production-reach 通过，PC-17 新测试也无法按规定入口完成，因此不能判定 PC-1a 可独立全绿。本次判断仅据静态核对，未修改文件，未运行测试、构建、git 或网络。

结论：改后再核