/**
 * 模块职责：集中导出可控模型、工具执行器、事件收集器和同步门等测试替身。
 *
 * 设计边界：这里只提供测试装配入口，不进入生产构建，也不承载被测业务逻辑。
 * 关键流程：测试从本入口选取替身，配置脚本化行为，再断言运行时产生的请求、结果和事件。
 */
export { ControllableGate } from "./controllable-gate.js";
export { EventCollector } from "./event-collector.js";
export { FakeModelClient } from "./fake-model-client.js";
export { FakeToolExecutor } from "./fake-tool-executor.js";

export type { GateWaitResult } from "./controllable-gate.js";
export type { EventCollectorConfig } from "./event-collector.js";
export type { FakeModelAction, FakeModelScript } from "./fake-model-client.js";
export type {
  FakeToolAction,
  FakeToolExecutorConfig,
  FakeToolScript,
} from "./fake-tool-executor.js";
