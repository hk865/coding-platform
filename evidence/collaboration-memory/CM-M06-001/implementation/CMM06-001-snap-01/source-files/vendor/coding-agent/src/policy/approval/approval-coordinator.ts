/**
 * 模块职责：把 ask 权限决策转成有时限、可审计且绑定具体操作的审批请求。
 *
 * 设计边界：审批不能扩大原权限决策；只允许一次或拒绝，并受取消与超时控制。
 * 关键流程：规范化操作生成指纹和预览，调用 requester，校验响应后映射为统一审批结果。
 */
import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import type { JsonValue } from "../../core/context/types/context-types.js";
import type { PermissionDecision } from "../permissions/permission-policy.js";

export const approvalResponseSchema = z
  .object({ decision: z.enum(["allow_once", "deny"]), reason: z.string().min(1) })
  .strict();
export type ApprovalResponse = z.infer<typeof approvalResponseSchema>;

export interface ApprovalRequest {
  readonly requestId: string;
  readonly runId: string;
  readonly callId: string;
  readonly tool: string;
  readonly effectClass: string;
  readonly argumentsPreview: string;
  readonly paths: readonly string[];
  readonly cwd: string | null;
  readonly commandPreview: string | null;
  readonly policyReasonCode: string;
  readonly policyVersion: string;
  readonly workspaceRevision: string;
  readonly operationFingerprint: string;
  readonly expiresAt: string;
}

export interface ApprovalRequester {
  request(
    request: Readonly<ApprovalRequest>,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<ApprovalResponse>;
}

export type ApprovalOutcome =
  | { readonly kind: "allowed"; readonly request: ApprovalRequest }
  | { readonly kind: "denied"; readonly reason: string; readonly request: ApprovalRequest }
  | { readonly kind: "cancelled"; readonly request: ApprovalRequest }
  | { readonly kind: "failed"; readonly reason: string; readonly request: ApprovalRequest };

function canonical(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Readonly<Record<string, JsonValue>>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key]!)}`)
    .join(",")}}`;
}

export function createOperationFingerprint(decision: PermissionDecision): string {
  if (!decision.operation) throw new Error("没有规范化 operation 时不能生成审批 fingerprint");
  const operation = decision.operation;
  return createHash("sha256")
    .update(
      canonical({
        callId: operation.callId,
        tool: operation.tool,
        effectClass: operation.effectClass,
        arguments: operation.arguments,
        paths: operation.paths,
        cwd: operation.cwd,
        capabilities: operation.capabilities,
        policyVersion: decision.policyVersion,
        workspaceIdentity: operation.workspaceIdentity,
        workspaceRevision: operation.workspaceRevision,
        sandboxProfileVersion: operation.sandboxProfileVersion,
      }),
    )
    .digest("hex");
}

function preview(value: JsonValue, limit = 512): string {
  const text = canonical(value);
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

export class ApprovalCoordinator {
  constructor(
    private readonly requester: ApprovalRequester,
    private readonly timeoutMs = 60_000,
    private readonly idFactory: () => string = randomUUID,
  ) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
      throw new RangeError("审批超时必须为正整数");
  }

  async authorize(decision: PermissionDecision, signal: AbortSignal): Promise<ApprovalOutcome> {
    if (decision.decision !== "ask" || !decision.operation) {
      throw new Error("ApprovalCoordinator 只接收带规范化 operation 的 Ask 决策");
    }
    const operation = decision.operation;
    const request: ApprovalRequest = {
      requestId: this.idFactory(),
      runId: operation.runId,
      callId: operation.callId,
      tool: operation.tool,
      effectClass: operation.effectClass,
      argumentsPreview: preview(operation.arguments),
      paths: operation.paths,
      cwd: operation.cwd,
      commandPreview: operation.commandPreview?.slice(0, 512) ?? null,
      policyReasonCode: decision.reasonCode,
      policyVersion: decision.policyVersion,
      workspaceRevision: operation.workspaceRevision,
      operationFingerprint: createOperationFingerprint(decision),
      expiresAt: new Date(Date.now() + this.timeoutMs).toISOString(),
    };
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("approval_timeout")), this.timeoutMs);
    timer.unref?.();
    try {
      const raw = await this.requester.request(request, { signal: controller.signal });
      if (signal.aborted) return { kind: "cancelled", request };
      if (controller.signal.aborted) return { kind: "denied", reason: "审批超时", request };
      const parsed = approvalResponseSchema.safeParse(raw);
      if (!parsed.success) return { kind: "failed", reason: "审批响应非法", request };
      return parsed.data.decision === "allow_once"
        ? { kind: "allowed", request }
        : { kind: "denied", reason: parsed.data.reason, request };
    } catch (error) {
      if (signal.aborted) return { kind: "cancelled", request };
      if (controller.signal.aborted) return { kind: "denied", reason: "审批超时", request };
      return {
        kind: "failed",
        reason: error instanceof Error ? error.message : "审批请求失败",
        request,
      };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }
}

export class StaticApprovalRequester implements ApprovalRequester {
  readonly requests: ApprovalRequest[] = [];

  constructor(private readonly response: ApprovalResponse) {}

  async request(request: Readonly<ApprovalRequest>): Promise<ApprovalResponse> {
    this.requests.push(structuredClone(request));
    return this.response;
  }
}
