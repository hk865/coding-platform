阅读顺序：docs/PRODUCT.md（图是协作白板、连续Session），docs/refactor/ARCHITECTURE.md（五模块边界、Kernel唯一历史实现），docs/refactor/modules/core/agent-runtime.md §6以及当前并发纠偏提示，docs/refactor/DSH-WORKFLOW.md §3。再看本批真实骨架 coding-platform/next/src/core/agent-runtime/observed-model-run.ts 与独立验收 tests/runtime/R4c-session-continuity.test.ts、source-tool-lifecycle.test.ts。冻结公共参数类型在 next/vendor/coding-agent/dist/public-api.d.ts 的导出，不允许改 Kernel。需要追溯意图读 docs/refactor/intent/ORIGINAL-DIALOGUE.md 及 2026-09-23-PARALLEL-AND-PRODUCT.md §4，不需要全量重复阅读。

你是本地DSH实现Session。只写scope的一份生产文件，其余源码/接口/tests/配置/Kernel只读。此次是R4c窄桥接，不是整个R4c完成。此前资源预占方案刚纠偏，不实施Task领取、资源索引或范围预证明，不加新层/文件/依赖。你负责填Sol已建的洞：将首个await之前复制好的可选sessionContext / executionIdentity透传给真实Kernel runCodingAgent，移除专门为红测保留的not wired分支。参数缺省时保留既有current_turn/随机执行身份；不要替用户自动选择最近边界，不把resume当完成后新轮次，不在平台拼历史或复制Kernel的验证/重放逻辑。

不改ObservedModelRunOptions公开类型、权限/预算/工具开放、观察事件及资源关闭行为。正确性来自真实Kernel固定历史边界、同身份重放、输入冲突和实际请求内容；不得用fake或返回缓存凑测试。输入对象快照保留，不在await后重读调用方可变对象。不扫描旧源码来迁入新的组件。

固定检查工具：python3 tools/dsh-refactor/check.py next-session-continuity、next-types、next-architecture。不装依赖、不stage/commit/push/reset/restore/clean/stash、不读凭据或无关Session。单文件bind写入需原地写，不可atomic rename。tests有疑问用具体反例回报主审，不修改断言。完成简洁报告真实改动、实际检查与仍未做的完整R4c链，不自行声称独立验收通过。开始实现。
