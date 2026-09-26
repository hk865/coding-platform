# R3c 第二阶段返修报告（本轮返修：3 项）

## 1. `readTaskInput` 身份/信号在 await 前同步固定

`plan-service.ts` 新增 `ownCallContext(ctx)`，在**任何 await 之前**同步固定：
- `projectId`、`workspaceId`（存在时）；
- `principal` 与 `materialReader` 深拷贝（`structuredClone`），调用方后续 `Object.assign`/字段改写不能再把不同身份接力进授权或材料层；
- **原 `AbortSignal` 按引用保留**，未 JSON 化、未 clone 成普通对象。

`authorizeReadContext`、`authorizeGoal` 与 `materials.openArtifact` 现在统一使用该快照 `bound`；并在 `readGoal`、`readPlan` 两个 await 之后检查 `bound.signal.aborted`，原取消不丢。已覆盖主审新增的三种场景：`preserve`（改写身份/输入/替换 signal 后仍用调用时快照 → ready）、`no-escalation`（把未受理 reader 换成已受理 → 用快照 identity → forbidden）、`cancel`（替换 signal 后仍看原 signal → cancelled）。

## 2. null/畸形 input 返回类型化 invalid，不 throw

`readTaskInput` 在 `ownJsonInput` 后先 `if (!isRecord(body)) return rejected('invalid', …)`，再访问 `body.goalRef`。主审新增的 `[null, undefined, [], 7]` 全部返回 `{status:'rejected', code:'invalid'}`（`undefined` 由 `ownJsonInput` 的 JSON 往返先拒），未扩成通用校验框架。

## 3. 新 `inputRequirements` 复用完整 `isArtifactRef`

`plan-record-codecs.ts` 改为从 `../../record-store/body-codec.js` 引入 `isArtifactRef`（与 `materials/record-readers` 同一复用），对 v2 `inputRequirements[].artifactRef` 校验包含 `source` 内部字段的完整形状；`source:{}` 现已 `invalid`。删除了我此前不完整的本地 helper；同时**恢复** `candidate_v2.reason.sources` 原本较宽松的内联检查，未收紧与新输入无关的旧 reason.sources 历史读取兼容性。

## 文件范围

本轮仅改动（均在冻结的 5 文件内）：
- `coding-platform/next/src/core/work-graph/tasks/plan-service.ts`
- `coding-platform/next/src/core/work-graph/tasks/plan-record-codecs.ts`

`eligibility.ts` / `plan-commit-compiler.ts` / `plan-validation.ts` 保持上一轮实现；测试、接口、Store 均只读未改。

## 实测（自检结果，非主审验收）

| 检查 | 结果 |
| --- | --- |
| `next-types` | exit 0 |
| `next-task-relations` | exit 0，6 files / 12 tests passed |
| `next-plan` | exit 0，4 files / 8 tests passed |
| `next-architecture` | exit 0，`next source boundaries: OK`（5/8 allowed observed edges） |
| `next-tests`（附加回归） | exit 0，57 files / 383 tests passed |

以上为本实现会话的自检；是否通过仍以 Astra 独立复现与审阅为准，不将自检称为主审已验收。