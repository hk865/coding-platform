/**
 * 模块职责：把 ToolCall 串联到注册表、权限策略、审批器和具体 ToolHandler。
 *
 * 设计边界：Dispatcher 不实现文件或进程能力，也不会在 deny 或审批失败后继续执行。
 * 关键流程：解析操作摘要，评估权限，必要时等待审批，然后调用 handler 并校验关联结果。
 */
import {
  toolCallSchema,
  toolResultSchema,
  ToolProtocolError,
} from "../../core/ports/tool_executor/tool-executor-port.js";
import type {
  ToolCall,
  ToolEffects,
  ToolError,
  ToolExecutionOptions,
  ToolExecutorPort,
  ToolResult,
} from "../../core/ports/tool_executor/tool-executor-port.js";
import type { ApprovalCoordinator } from "../../policy/approval/approval-coordinator.js";
import type {
  DefaultPermissionPolicy,
  ToolOperation,
} from "../../policy/permissions/permission-policy.js";
import type { ToolRegistrySnapshot } from "../registry/tool-registry.js";
import type { SandboxCapability, ToolDefinition } from "../schemas/tool-schemas.js";

const NONE: ToolEffects = {
  sideEffect: "none",
  changedPaths: [],
  workspaceRevision: null,
  artifactRefs: [],
};

export interface ToolDispatcherDependencies {
  readonly registry: ToolRegistrySnapshot;
  readonly permissionPolicy: DefaultPermissionPolicy;
  readonly approval?: ApprovalCoordinator;
  readonly capabilities: ReadonlySet<SandboxCapability>;
  readonly runId: string;
  readonly workspaceIdentity: string;
  readonly workspaceRevision: () => Promise<string>;
  readonly reconcileBeforeApproval?: () => Promise<{ readonly changedPaths: readonly string[] }>;
  readonly sandboxProfileVersion: string;
}

/**
 * 真实工具的强制安全链。schema、Permission、Approval、revision 与 capability
 * 任一步失败都会在 handler 启动前返回，因此拒绝路径没有业务副作用。
 */
export class ToolDispatcher implements ToolExecutorPort {
  constructor(private readonly dependencies: ToolDispatcherDependencies) {}

  async execute(
    callInput: Readonly<ToolCall>,
    options: Readonly<ToolExecutionOptions>,
  ): Promise<ToolResult> {
    if (options.signal.aborted) return this.#cancelled(callInput.callId, NONE);
    const common = toolCallSchema.safeParse(callInput);
    if (!common.success) {
      return this.#error(
        typeof callInput.callId === "string" && callInput.callId.length > 0
          ? callInput.callId
          : "invalid-call",
        "invalid_arguments",
        "工具调用结构非法",
        NONE,
      );
    }
    const definition = this.dependencies.registry.resolve(common.data.name);
    if (!definition) return this.#error(common.data.callId, "unknown_tool", "工具不可用", NONE);
    const parsedArguments = definition.inputSchema.safeParse(common.data.arguments);
    if (!parsedArguments.success) {
      return this.#error(common.data.callId, "invalid_arguments", "工具参数不符合 schema", NONE);
    }
    const call: ToolCall = {
      ...common.data,
      arguments: parsedArguments.data as ToolCall["arguments"],
    };
    if (options.signal.aborted) return this.#cancelled(call.callId, NONE);

    let operation: ToolOperation;
    try {
      const summary = definition.summarize(call.arguments);
      operation = {
        runId: this.dependencies.runId,
        callId: call.callId,
        tool: call.name,
        effectClass: definition.effectClass,
        arguments: call.arguments,
        paths: summary.paths,
        cwd: summary.cwd,
        commandPreview: summary.commandPreview,
        capabilities: definition.requiredCapabilities,
        workspaceIdentity: this.dependencies.workspaceIdentity,
        // allow/deny 的判定与 revision 无关；只有需要审批的操作才生成昂贵的
        // workspace 指纹，并把该指纹写入审批 fingerprint。
        workspaceRevision: "not-captured",
        sandboxProfileVersion: this.dependencies.sandboxProfileVersion,
      };
    } catch {
      return this.#error(call.callId, "invalid_arguments", "工具资源参数非法", NONE);
    }
    const permission = this.dependencies.permissionPolicy.evaluate(operation);
    if (permission.decision === "deny") {
      return this.#error(call.callId, "permission_denied", permission.summary, NONE);
    }
    const missing = definition.requiredCapabilities.filter(
      (capability) => !this.dependencies.capabilities.has(capability),
    );
    if (missing.length > 0) {
      return this.#error(call.callId, "sandbox_unavailable", "所需隔离能力不可用", NONE);
    }
    if (permission.decision === "ask") {
      if (!this.dependencies.approval) {
        return this.#error(call.callId, "approval_denied", "操作需要审批", NONE);
      }
      let approvalBoundPermission;
      try {
        const reconciliation = await this.dependencies.reconcileBeforeApproval?.();
        if (reconciliation && reconciliation.changedPaths.length > 0) {
          return this.#error(
            call.callId,
            "approval_denied",
            "检测到非 Agent 工作区变动，请先 check 并重新读取相关文件",
            NONE,
          );
        }
        operation = {
          ...operation,
          workspaceRevision: await this.dependencies.workspaceRevision(),
        };
        approvalBoundPermission = this.dependencies.permissionPolicy.evaluate(operation);
        if (approvalBoundPermission.decision !== "ask") {
          return this.#error(call.callId, "permission_denied", "审批前策略状态异常", NONE);
        }
      } catch {
        return this.#error(call.callId, "approval_denied", "无法确认 workspace 状态", NONE);
      }
      const approval = await this.dependencies.approval.authorize(
        approvalBoundPermission,
        options.signal,
      );
      if (approval.kind === "cancelled") return this.#cancelled(call.callId, NONE);
      if (approval.kind !== "allowed") {
        return this.#error(call.callId, "approval_denied", approval.reason, NONE);
      }
      // AllowOnce 只授权请求中 fingerprint 对应的 workspace 快照；等待期间变化必须重新审批。
      try {
        const currentRevision = await this.dependencies.workspaceRevision();
        if (currentRevision !== operation.workspaceRevision) {
          return this.#error(
            call.callId,
            "approval_denied",
            "审批后 workspace 已变化，请重新确认操作",
            NONE,
          );
        }
      } catch {
        return this.#error(call.callId, "approval_denied", "审批后无法确认 workspace 状态", NONE);
      }
    }
    if (options.signal.aborted) return this.#cancelled(call.callId, NONE);
    return this.#executeHandler(definition, call, options.signal);
  }

  async #executeHandler(
    definition: ToolDefinition,
    call: ToolCall,
    parentSignal: AbortSignal,
  ): Promise<ToolResult> {
    const controller = new AbortController();
    const onAbort = () => controller.abort(parentSignal.reason);
    parentSignal.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("tool_timeout"));
    }, definition.defaultTimeoutMs);
    timer.unref?.();
    try {
      const raw = await definition.handler.execute(call, { signal: controller.signal });
      const parsed = toolResultSchema.safeParse(raw);
      if (!parsed.success) throw new ToolProtocolError("invalid_result", "工具返回了非法结果");
      if (parsed.data.callId !== call.callId) {
        throw new ToolProtocolError("call_id_mismatch", "工具结果 callId 不匹配");
      }
      if (
        Buffer.byteLength(JSON.stringify(parsed.data.output), "utf8") > definition.outputLimitBytes
      ) {
        throw new ToolProtocolError("invalid_result", "工具输出超过可信定义上限");
      }
      if (parentSignal.aborted) return this.#cancelled(call.callId, parsed.data.effects);
      if (timedOut && !(parsed.data.status === "error" && parsed.data.error.code === "timeout")) {
        return this.#error(call.callId, "timeout", "工具执行超时", parsed.data.effects);
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof ToolProtocolError) throw error;
      const effects = this.#startedEffects(definition, call);
      if (parentSignal.aborted) return this.#cancelled(call.callId, effects);
      return this.#error(
        call.callId,
        timedOut ? "timeout" : "execution_failed",
        timedOut ? "工具执行超时" : "工具执行失败",
        effects,
      );
    } finally {
      clearTimeout(timer);
      parentSignal.removeEventListener("abort", onAbort);
    }
  }

  #startedEffects(definition: ToolDefinition, call: ToolCall): ToolEffects {
    if (definition.effectClass === "read_only") return NONE;
    const summary = definition.summarize(call.arguments);
    return {
      sideEffect: "possible",
      changedPaths: definition.effectClass === "workspace_write" ? summary.paths : [],
      workspaceRevision: null,
      artifactRefs: [],
    };
  }

  #error(
    callId: string,
    code: ToolError["code"],
    message: string,
    effects: ToolEffects,
  ): ToolResult {
    return {
      schemaVersion: 1,
      callId,
      status: "error",
      error: { code, message, retryable: code === "timeout" || code === "execution_failed" },
      output: [{ kind: "text", text: message }],
      effects,
    };
  }

  #cancelled(callId: string, effects: ToolEffects): ToolResult {
    return {
      schemaVersion: 1,
      callId,
      status: "cancelled",
      reason: "工具调用已取消",
      output: [],
      effects,
    };
  }
}
