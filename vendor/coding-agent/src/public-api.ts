/**
 * 模块职责：集中导出对使用者稳定的生产契约、运行时组件和默认适配器。
 *
 * 设计边界：内部辅助函数不会因可访问就自动成为公共 API；新增导出需要显式评审。
 * 关键流程：调用方从此入口组合端口和实现，内部模块仍通过职责化文件路径相互依赖。
 */
export {
  buildModelRequest,
  ContextBuildError,
  DeterministicContextBuilder,
} from "./core/context/builder/context-builder.js";
export {
  agentEventSchema,
  eventMetaSchema,
  validateTransition,
} from "./core/runtime/events/agent-events.js";
export {
  createInitialRunState,
  deriveRunPhase,
  runSchema,
  runStateSchema,
  validateRunStateInvariants,
} from "./core/runtime/state/run-state.js";
export {
  modelEventSchema,
  modelRequestSchema,
  validateModelEventSequence,
} from "./core/ports/model_client/model-client-port.js";
export {
  assertToolResultMatchesCall,
  toolCallSchema,
  toolResultSchema,
} from "./core/ports/tool_executor/tool-executor-port.js";
export {
  eventSinkDeliverySchema,
  isRequiredEventSink,
} from "./core/ports/event_sink/event-sink-port.js";
export {
  afterToolHookDecisionSchema,
  afterToolHookInvocationSchema,
  beforeModelHookDecisionSchema,
  beforeModelHookInvocationSchema,
  beforeToolHookDecisionSchema,
  beforeToolHookInvocationSchema,
  hookDecisionSchema,
  hookFailureSchema,
  hookInvocationSchema,
  hookPointSchema,
  hookRegistrationSchema,
  toolResultPresentationSchema,
  validateHookDecision,
} from "./core/hooks/protocol/hook-protocol.js";

export type {
  ContextBuilderInput,
  ContextBuilderPort,
} from "./core/context/builder/context-builder.js";
export type { AgentEvent, EventMeta } from "./core/runtime/events/agent-events.js";
export type { Run, RunState, Turn } from "./core/runtime/state/run-state.js";
export type {
  ModelClientPort,
  ModelEvent,
  ModelRequest,
} from "./core/ports/model_client/model-client-port.js";
export type {
  ToolCall,
  ToolExecutorPort,
  ToolResult,
} from "./core/ports/tool_executor/tool-executor-port.js";
export type {
  EventSinkDelivery,
  EventSinkPort,
  EventSinkPublishOptions,
} from "./core/ports/event_sink/event-sink-port.js";
export type {
  AfterToolHookDecision,
  AfterToolHookInvocation,
  AfterToolHookPort,
  BeforeModelHookDecision,
  BeforeModelHookInvocation,
  BeforeModelHookPort,
  BeforeToolHookDecision,
  BeforeToolHookInvocation,
  BeforeToolHookPort,
  HookDecision,
  HookExecutionOptions,
  HookFailure,
  HookInvocation,
  HookPoint,
  HookPort,
  HookRegistration,
  ToolResultPresentation,
} from "./core/hooks/protocol/hook-protocol.js";

/** M0～M5 已实现；当前执行 M6 外部基线与发布验收。 */
export const ENGINEERING_STATUS = Object.freeze({
  milestone: "M6",
  agentCapabilities: true,
  contractsAvailable: true,
});

export {
  CharacterTokenEstimator,
  ContextSelectionError,
  selectContext,
} from "./core/context/selection_policy/context-selection-policy.js";
export { HookExecutor, HookExecutionError } from "./core/hooks/executor/hook-executor.js";
export { HookRegistry } from "./core/hooks/registry/hook-registry.js";
export { CancellationController } from "./core/runtime/cancellation/cancellation-controller.js";
export { CheckpointingEventSink } from "./core/runtime/checkpointing/checkpointing-event-sink.js";
export {
  EventDeliveryCoordinator,
  RequiredSinkError,
} from "./core/runtime/event_delivery/event-delivery-coordinator.js";
export {
  LimitGuard,
  runLimitsSchema,
  UNLIMITED_RUN_LIMITS,
} from "./core/runtime/limits/limit-guard.js";
export { RuntimeRunner, RunnerBusyError } from "./core/runtime/loop/runtime-runner.js";
export { SerialToolBatchPolicy } from "./core/ports/tool_batch_policy/tool-batch-policy-port.js";
export { consumeModelStream } from "./core/runtime/loop/model-stream-consumer.js";
export { RecoveryCoordinator } from "./core/runtime/recovery/recovery-coordinator.js";
export { reduceRunState, ReducerError } from "./core/runtime/reducer/run-state-reducer.js";
export {
  checkpointDraft,
  checkpointSchema,
  createCheckpoint,
} from "./core/ports/checkpoint_store/checkpoint-store-port.js";
export { sessionRecordSchema, StoreError } from "./core/ports/session_store/session-store-port.js";
export { StructuredEventLogger } from "./observability/logging/structured-event-logger.js";
export {
  ApprovalCoordinator,
  StaticApprovalRequester,
} from "./policy/approval/approval-coordinator.js";
export {
  DefaultPermissionPolicy,
  normalizeWorkspacePath,
} from "./policy/permissions/permission-policy.js";
export { ProcessSandbox, ProcessSandboxError } from "./sandbox/process/process-sandbox.js";
export { WorkspaceSandbox, WorkspaceSandboxError } from "./sandbox/workspace/workspace-sandbox.js";
export { createEditToolDefinition, EditToolHandler } from "./tools/builtin/edit/edit-tool.js";
export { createReadToolDefinition, ReadToolHandler } from "./tools/builtin/read/read-tool.js";
export { createShellToolDefinition, ShellToolHandler } from "./tools/builtin/shell/shell-tool.js";
export { ToolDispatcher } from "./tools/dispatcher/tool-dispatcher.js";
export {
  RegistryToolBatchPolicy,
  ToolRegistry,
  ToolRegistrySnapshot,
} from "./tools/registry/tool-registry.js";
export { InMemoryStores } from "./storage/adapters/in_memory/in-memory-stores.js";
export { SqliteStores } from "./storage/adapters/sqlite/sqlite-stores.js";
export { SessionEventSink } from "./storage/session_event_sink/session-event-sink.js";

export type {
  ToolBatchPolicy,
  ToolExecutionGroup,
} from "./core/ports/tool_batch_policy/tool-batch-policy-port.js";
export type {
  Checkpoint,
  CheckpointCandidate,
  CheckpointStorePort,
} from "./core/ports/checkpoint_store/checkpoint-store-port.js";
export type {
  SessionRecord,
  SessionRecordDraft,
  SessionStorePort,
} from "./core/ports/session_store/session-store-port.js";
export type {
  RecoveryAction,
  RecoveryEnvironment,
  RecoveryResult,
} from "./core/runtime/recovery/recovery-coordinator.js";
export type { RunLimits } from "./core/runtime/limits/limit-guard.js";
export type { ToolDefinition, ToolEffectClass } from "./tools/schemas/tool-schemas.js";

export * from "./m5-public-api.js";

/** Tool schemas share the kernel registry schema version. */
export { z as toolSchema } from "zod";
