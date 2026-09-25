import { z } from "zod";
import type { PermissionDecision } from "../permissions/permission-policy.js";
export declare const approvalResponseSchema: z.ZodObject<{
    decision: z.ZodEnum<{
        deny: "deny";
        allow_once: "allow_once";
    }>;
    reason: z.ZodString;
}, z.core.$strict>;
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
    request(request: Readonly<ApprovalRequest>, options: Readonly<{
        signal: AbortSignal;
    }>): Promise<ApprovalResponse>;
}
export type ApprovalOutcome = {
    readonly kind: "allowed";
    readonly request: ApprovalRequest;
} | {
    readonly kind: "denied";
    readonly reason: string;
    readonly request: ApprovalRequest;
} | {
    readonly kind: "cancelled";
    readonly request: ApprovalRequest;
} | {
    readonly kind: "failed";
    readonly reason: string;
    readonly request: ApprovalRequest;
};
export declare function createOperationFingerprint(decision: PermissionDecision): string;
export declare class ApprovalCoordinator {
    private readonly requester;
    private readonly timeoutMs;
    private readonly idFactory;
    constructor(requester: ApprovalRequester, timeoutMs?: number, idFactory?: () => string);
    authorize(decision: PermissionDecision, signal: AbortSignal): Promise<ApprovalOutcome>;
}
export declare class StaticApprovalRequester implements ApprovalRequester {
    private readonly response;
    readonly requests: ApprovalRequest[];
    constructor(response: ApprovalResponse);
    request(request: Readonly<ApprovalRequest>): Promise<ApprovalResponse>;
}
//# sourceMappingURL=approval-coordinator.d.ts.map