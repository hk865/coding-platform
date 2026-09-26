实现完成。以下是真实改动与检查报告。

## 改动（仅 1 份生产文件）
`coding-platform/next/src/core/agent-runtime/observed-model-run.ts`（原地写，未 rename）

1. 删除专门为红测保留的 `not wired` 分支：
   - 移除 `if (sessionContext !== undefined || executionIdentity !== undefined) throw Error('Kernel Session context and execution identity are not wired in this Runtime slice')`。
2. 把首个 `await` 之前已快照的局部常量透传给真实 `o.kernel.runCodingAgent`：
   ```
   // 冻结的公共 Kernel 会话参数：缺省不传，保持 current_turn 与随机执行身份。
   ...(sessionContext !== undefined ? { sessionContext } : {}),
   ...(executionIdentity !== undefined ? { executionIdentity } : {}),
   ```
   - 用条件展开而非 `{ field: undefined }`，配合 `exactOptionalPropertyTypes: true`，参数缺省时字段缺席，Kernel 保持既有 `current_turn` 与随机执行身份。
   - 传的是 await 前的快照（第 65–66 行 `{...o.sessionContext}` / `{...o.executionIdentity}`），之后不再重读调用方可变对象；两类型字段均为原始值，浅拷贝即完全隔离。
   - 注释同步改为现在时，说明此处只透传、不拼历史。

未改：`ObservedModelRunOptions` 公开类型、权限/预算/工具开放、观察事件、资源关闭、fast/frozen 路径；未加新层/文件/依赖；未替用户选边界、未用 resume 当新轮次、未在平台做历史拼装或 Kernel 验证/重放复制。

## 实际检查（工具固定入口，均全绿）
- `next-session-continuity`：2 文件 18/18 PASS（R4c 4 项 + source-tool-lifecycle 14 项）。
- `next-types`：exit 0。
- `next-architecture`：`next source boundaries: OK`，observed 5/8 allowed，exit 0。

未 stage/commit/push/reset/restore/clean/stash；未装依赖、未读凭据或无关 Session；未改 tests（只是读取）。改动后确认 scope 目录无残留 tmpdir/额外文件。

## 仍未做的完整 R4c 链（本批明确不做）
- 无 Task 领取/Admission、资源索引或范围预证明；无 WG 受理与观察回流。
- 平台不选择/自动推导历史边界：`throughPosition` 仍由调用方（上层）给定真实完成边界。
- 未接未完成 Run 的 `resumeCodingAgent` 恢复路径，也未把完成后继续与 resume 在平台侧区分成正式流程。
- `continueHistory` 能力开关、Session 装配、控制/检查等仍未接通。
- 本 Session 只报告实际改动与受限检查，不声称独立验收通过，仍待主审按真实调用链独立验收。