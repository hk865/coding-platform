/**
 * 模块职责：集中导出确定性 ID、手动时钟、临时 workspace 和资源清理等测试辅助项。
 *
 * 设计边界：辅助项只消除时间、环境和清理的不确定性，不替代生产实现。
 * 关键流程：测试创建受控资源并交给 ResourceScope，结束时统一恢复环境与释放临时资源。
 */
export { createDeterministicIdGenerator } from "./deterministic-id.js";
export { withEnvironment } from "./environment.js";
export { ManualClock } from "./manual-clock.js";
export { ResourceScope } from "./resource-scope.js";
export { createTempWorkspace } from "./temp-workspace.js";

export type { IdGenerator } from "./deterministic-id.js";
export type { Cleanup } from "./resource-scope.js";
export type { TempWorkspace } from "./temp-workspace.js";
