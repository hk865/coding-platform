/**
 * WorkerRuntime.ContextContinuationPort — explicit continuation capability.
 *
 * Authority: dev_docs/interfaces/context-lifecycle.md (WorkerRuntime 必须显式
 * 报告继续／暂停恢复／安全点及 Context 管理的能力和结果；不支持原会话恢复时
 * 返回不可用或走已授权的新 Run 接续；不得假定 FakeRuntime 的能力等同真实内核)
 * and dev_docs/modules/execution/worker-runtime.md.
 *
 * Semantics:
 *   - capabilities(request) -> supported(capabilities) | unsupported |
 *     rejected. capabilities ∈ { sessionRestore, contextResume, takeoverRun,
 *     maxContextBytes, maxResumeBytes }. FakeRuntimeAdapter declares the
 *     FAKE capability set honestly; the real coding-agent adapter declares
 *     what the kernel actually supports. The platform never assumes Fake
 *     capability equals the real kernel.
 *   - checkContinuation(request) performs the observable continuation check:
 *     the adapter produces the observation; Control persists the observed
 *     path via RecordContinuation.
 *     The port NEVER fabricates a restore (a "restored" answer must come from
 *     a real runtime restore fact).
 */
import type { RunRef } from "./dispatch.js";
import type { WorkContextRef } from "./context-continuity.js";

type ContinuationCapabilitiesV1 = {
  schemaVersion: 1;
  /** True when the runtime can really restore the original session. */
  sessionRestore: boolean;
  /** True when the runtime can resume/continue using a bounded context. */
  contextResume: boolean;
  /** True when a NEW run may take over from durable facts. */
  takeoverRun: boolean;
  /** Honest max context bytes the runtime accepts. */
  maxContextBytes: number;
  /** Honest max restore bytes (0 when sessionRestore=false). */
  maxResumeBytes: number;
};

export type ContextContinuationCapabilityResult =
  | { status: "supported"; capabilities: ContinuationCapabilitiesV1 }
  | { status: "unsupported" }
  | { status: "rejected"; code: "run_not_found" | "scope_mismatch" | "stale_versions"; message: string };

export type ContextContinuationCheckV1 = {
  schemaVersion: 1;
  workContextRef: WorkContextRef;
  /** The run that would continue (null when only probing capability). */
  requestedByRunRef: RunRef | null;
  /** The run whose session would be restored (null for a takeover attempt). */
  originalRunRef: RunRef | null;
  /** The work's current workspace revision the continuation must be fresh to. */
  workspaceRevision: number;
  /** The plan revision the continuation runs under (null when unbounded). */
  planRevision: number | null;
};

export type ContextContinuationObservationV1 = {
  schemaVersion: 1;
  workContextRef: WorkContextRef;
  requestedByRunRef: RunRef | null;
  originalRunRef: RunRef | null;
  /** The observed result of asking the runtime. */
  observed: "restored_original" | "took_over" | "unsupported" | "rejected";
  unsupportedCapabilities: string[];
  rejectionCode: string | null;
  summary: string;
  observedAt: string;
};

/** Runtime continuation capabilities and observations; Handoff control remains separate. */
export interface ContextContinuationPort {
  capabilities(request: { workContextRef: WorkContextRef; runRef: RunRef | null }): Promise<ContextContinuationCapabilityResult>;
  checkContinuation(request: ContextContinuationCheckV1): Promise<ContextContinuationObservationV1>;
}
