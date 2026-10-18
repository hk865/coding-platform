/**
 * K3 L14: the review-round tool `record_unknown_call_review`.
 *
 * The factory has the SAME `{ names, create }` shape as the frozen
 * `coordinationTools` seam and `whiteboard-tools.ts`, so the Host can assemble
 * it without changing any Kernel type. The review record ref is trusted config;
 * the round Run comes from the snapshotted `work_run` principal. The model
 * supplies only the alias, verdict, evidence and crash self-check.
 *
 * Domain outcomes are preserved verbatim in the JSON output: a committed
 * BOUNDED receipt (`status`, `item`, `revision`, `receipt`, `replayed`; never
 * the whole record, L14 "回执") and a typed rejection keep their full
 * `WriteResult`. The record itself is read through
 * `unknown-call-reviews/read`. The owner owns replay and
 * `idempotency_conflict`; this adapter never reinterprets them. It is a thin
 * adapter over the SAME `UnknownCallReviewPort` the routes publish; it must
 * never become a second review engine.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { UnknownCallReviewRef } from '../../contracts/unknown-call-review.js';
import type {
  UnknownCallReviewPort, UnknownCallReviewReadPort,
} from '../work-graph/model/unknown-call-review-contracts.js';
import { UNKNOWN_CALL_REVIEW_MAX_ITEMS } from '../work-graph/state/unknown-call-review.js';
import {
  toolSchema as z,
  type ToolCall,
  type ToolDefinition,
  type ToolResult,
  type WorkspaceSandbox,
} from '../../../vendor/coding-agent/dist/public-api.js';

export const RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME = 'record_unknown_call_review';
/** L20/section 2: the proposal round's one write tool, registered in place of the review tool. */
export const PROPOSE_SAFER_METHOD_TOOL_NAME = 'propose_safer_method';

/** L13/L14: the one tool this adapter registers (the review-round constant lives in
 * `contracts/review-admission.ts`). */
export const RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAMES = [RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME] as const;
/** L20: the proposal-phase registration. */
export const PROPOSE_SAFER_METHOD_TOOL_NAMES = [PROPOSE_SAFER_METHOD_TOOL_NAME] as const;

export const UNKNOWN_CALL_REVIEW_EVIDENCE_MAX_CHARS = 2000;
export const UNKNOWN_CALL_REVIEW_CRASH_EVIDENCE_MAX_CHARS = 1000;
/** L20/lead answer 7: the rationale is 1..2,000 UTF-16 code units. */
export const UNKNOWN_CALL_PROPOSAL_RATIONALE_MAX_CHARS = 2000;

const inputSchema = z
  .object({
    item: z.number().int().min(1).max(UNKNOWN_CALL_REVIEW_MAX_ITEMS)
      .describe('The alias #n of the process item being reviewed; never a Kernel callId'),
    verdict: z.enum(['done', 'not_done', 'partial', 'undetermined'])
      .describe('Whether the reviewed command finished'),
    evidence: z.string().min(1).max(UNKNOWN_CALL_REVIEW_EVIDENCE_MAX_CHARS)
      .describe('The evidence for the verdict, 1-2000 characters'),
    crashSuspicion: z.object({
      verdict: z.enum(['unlikely', 'possible', 'undetermined']),
      evidence: z.string().min(1).max(UNKNOWN_CALL_REVIEW_CRASH_EVIDENCE_MAX_CHARS),
    }).strict().describe('The crash self-check: verdict and its evidence, 1-1000 characters'),
  })
  .strict();
type RecordUnknownCallReviewArguments = z.infer<typeof inputSchema>;

/** L20/section 2 `propose_safer_method`: the model supplies only the replacement command and why. */
const proposalInputSchema = z
  .object({
    item: z.number().int().min(1).max(UNKNOWN_CALL_REVIEW_MAX_ITEMS)
      .describe('The alias #n of a proposalTargets (process) item; never a Kernel callId'),
    command: z.string().min(1)
      .describe('The replacement command, run exactly as written; 1-4000 UTF-8 bytes'),
    cwd: z.string().optional()
      .describe('Optional working directory, at most 512 UTF-8 bytes; absent renders as .'),
    rationale: z.string().min(1).max(UNKNOWN_CALL_PROPOSAL_RATIONALE_MAX_CHARS)
      .describe('Why this replacement is safer; 1-2000 characters'),
  })
  .strict();
type ProposeSaferMethodArguments = z.infer<typeof proposalInputSchema>;

export type UnknownCallReviewToolsConfig = {
  /** The SAME owner the routes publish; the adapter adds no review rules. */
  reviews: UnknownCallReviewPort & Pick<UnknownCallReviewReadPort, 'readReview'>;
  /** Trusted, already-bound context (a `work_run` principal). Never model JSON. */
  context: CoreCallContext;
  /** The record this round belongs to, from the Run's trusted `purpose`. */
  reviewRef: UnknownCallReviewRef;
  /** Trusted command identity: Kernel `ToolCall.callId` + the bound round. */
  requestIdForCall: (call: Readonly<ToolCall>) => string;
  /** Which round this factory registers: the review tool (default) or the proposal tool. */
  phase?: 'review' | 'proposal';
};

export type UnknownCallReviewToolsHandle = {
  names: readonly string[];
  create: (workspace: WorkspaceSandbox) => ToolDefinition[];
};

function noneEffects(): ToolResult['effects'] {
  return { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] };
}

function outputValue(value: unknown): ToolResult['output'] {
  return [{ kind: 'json', value: value as never }];
}

function success(callId: string, value: unknown): ToolResult {
  return { schemaVersion: 1, callId, status: 'success', output: outputValue(value), effects: noneEffects() };
}

/** A real domain rejection: keep `code`/`reason`/`current` in the JSON output. */
function rejectedResult(callId: string, code: 'invalid_arguments' | 'execution_failed', result: unknown, message: string): ToolResult {
  return {
    schemaVersion: 1, callId, status: 'error',
    error: { code, message, retryable: false }, output: outputValue(result), effects: noneEffects(),
  };
}

function cancelledResult(callId: string, reason: string, result: unknown): ToolResult {
  return { schemaVersion: 1, callId, status: 'cancelled', reason, output: outputValue(result), effects: noneEffects() };
}

/** A local adapter failure that never reached the owner; no fabricated success. */
function localFailure(callId: string, code: 'invalid_arguments' | 'execution_failed', message: string): ToolResult {
  return { schemaVersion: 1, callId, status: 'error', error: { code, message, retryable: false },
    output: [], effects: noneEffects() };
}

export function createUnknownCallReviewTools(config: UnknownCallReviewToolsConfig): UnknownCallReviewToolsHandle {
  // Freeze the trusted identity before returning the factory: the model cannot
  // rebind the record, the principal or the request identity.
  const fixedReviewRef: UnknownCallReviewRef = {
    aggregateType: 'UnknownCallReview',
    projectId: config.reviewRef.projectId,
    goalId: config.reviewRef.goalId,
    runId: config.reviewRef.runId,
  };
  const fixedProjectId = config.context.projectId;
  const fixedWorkspaceId = config.context.workspaceId;
  const fixedPrincipal = structuredClone(config.context.principal);
  const fixedMaterialReader = structuredClone(config.context.materialReader);

  function snapshotContext(signal: AbortSignal): CoreCallContext {
    return {
      projectId: fixedProjectId,
      ...(fixedWorkspaceId === undefined ? {} : { workspaceId: fixedWorkspaceId }),
      principal: structuredClone(fixedPrincipal),
      materialReader: structuredClone(fixedMaterialReader),
      signal,
    };
  }

  async function executeReview(call: Readonly<ToolCall>, signal: AbortSignal): Promise<ToolResult> {
    const callId = call.callId;
    if (typeof callId !== 'string' || callId.length === 0) {
      return localFailure('', 'invalid_arguments', 'the Kernel tool call has no callId');
    }
    const parsed = inputSchema.safeParse(call.arguments);
    if (!parsed.success) {
      return localFailure(callId, 'invalid_arguments', 'record_unknown_call_review 参数非法');
    }
    let args: RecordUnknownCallReviewArguments;
    try { args = structuredClone(parsed.data); }
    catch { return localFailure(callId, 'invalid_arguments', 'the tool arguments cannot be isolated'); }
    if (fixedPrincipal.kind !== 'work_run') {
      return localFailure(callId, 'execution_failed', 'record_unknown_call_review requires a work_run principal');
    }
    let requestId: string;
    try { requestId = config.requestIdForCall(call); }
    catch { return localFailure(callId, 'execution_failed', 'no trusted command identity is bound for this call'); }
    if (typeof requestId !== 'string' || requestId.length === 0) {
      return localFailure(callId, 'execution_failed', 'the trusted command identity is empty');
    }
    const context = snapshotContext(signal);
    if (context.signal.aborted) return cancelledResult(callId, 'the review call was cancelled before the write', []);
    // L14: the adapter never pre-reads the record. The owner checks the request
    // receipt and the request identity FIRST, then reads the current record and
    // guards the revision it read; a real revision conflict is retried once by
    // the owner. Sending `expected: []` is the production review-round shape.
    let written;
    try {
      written = await config.reviews.recordConclusion(context, {
        input: { reviewRef: fixedReviewRef, item: args.item, verdict: args.verdict, evidence: args.evidence,
          crashSuspicion: args.crashSuspicion },
        meta: { requestId, expected: [] },
      });
    } catch {
      // The domain call never returned: a write may already be committed. Never
      // claim it was not committed; the same request identity can recover it.
      return localFailure(callId, 'execution_failed',
        'the review write did not return a result; its outcome is unconfirmed and it may already be committed. '
        + 'Do not report it as not written and do not retry under a new callId.');
    }
    if (written.status === 'committed') {
      // L14 "回执": a bounded receipt, never the record. At the M3 threshold the
      // record is far larger than the tool's 64 KiB `outputLimitBytes`; returning
      // it made the Kernel reject the result and end the round `outcome_unknown`.
      return success(callId, {
        status: written.status,
        item: args.item,
        revision: written.value.revision,
        receipt: written.cursor,
        replayed: written.replayed,
      });
    }
    if (written.code === 'cancelled') return cancelledResult(callId, written.reason, written);
    return rejectedResult(callId, written.code === 'invalid' ? 'invalid_arguments' : 'execution_failed',
      written, written.reason);
  }

  function reviewDefinition(): ToolDefinition {
    return {
      name: RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME,
      description: 'Record one review-round conclusion for a process item, given by its alias #n. '
        + 'State whether the command finished (done / not_done / partial / undetermined) and whether it could have '
        + 'caused the Host crash (unlikely / possible / undetermined), each with its evidence. '
        + 'The reviewed record and this review round are bound by the platform; you cannot choose them. '
        + 'A new call may overwrite the same item conclusion until the round ends; the last commit wins.',
      inputSchema,
      // A platform-state write: the Kernel permission policy and the Host
      // authorization list apply, but no workspace write or process capability
      // is granted and no file change is reported.
      effectClass: 'workspace_write',
      requiredCapabilities: [],
      independentReadOnly: false,
      defaultTimeoutMs: 10_000,
      outputLimitBytes: 64 * 1024,
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
      handler: {
        async execute(call: Readonly<ToolCall>, options: Readonly<{ signal: AbortSignal }>): Promise<ToolResult> {
          return executeReview(call, options.signal);
        },
      },
    };
  }

  /**
   * L20/section 2 `propose_safer_method`: the same trusted snapshot and identity
   * rules as the review tool. Units are the owner's (command 1..4,000 UTF-8
   * bytes, cwd null/1..512, rationale 1..2,000); the tool schema only rejects the
   * obvious shape. `capacity` asks the model to shorten and carries the owner's
   * reason; nothing was written.
   */
  async function executeProposal(call: Readonly<ToolCall>, signal: AbortSignal): Promise<ToolResult> {
    const callId = call.callId;
    if (typeof callId !== 'string' || callId.length === 0) {
      return localFailure('', 'invalid_arguments', 'the Kernel tool call has no callId');
    }
    const parsed = proposalInputSchema.safeParse(call.arguments);
    if (!parsed.success) {
      return localFailure(callId, 'invalid_arguments', 'propose_safer_method 参数非法');
    }
    let args: ProposeSaferMethodArguments;
    try { args = structuredClone(parsed.data); }
    catch { return localFailure(callId, 'invalid_arguments', 'the tool arguments cannot be isolated'); }
    if (fixedPrincipal.kind !== 'work_run') {
      return localFailure(callId, 'execution_failed', 'propose_safer_method requires a work_run principal');
    }
    let requestId: string;
    try { requestId = config.requestIdForCall(call); }
    catch { return localFailure(callId, 'execution_failed', 'no trusted command identity is bound for this call'); }
    if (typeof requestId !== 'string' || requestId.length === 0) {
      return localFailure(callId, 'execution_failed', 'the trusted command identity is empty');
    }
    const context = snapshotContext(signal);
    if (context.signal.aborted) return cancelledResult(callId, 'the proposal call was cancelled before the write', []);
    let written;
    try {
      written = await config.reviews.recordProposal(context, {
        input: { reviewRef: fixedReviewRef, item: args.item, command: args.command,
          cwd: args.cwd ?? null, rationale: args.rationale },
        meta: { requestId, expected: [] },
      });
    } catch {
      return localFailure(callId, 'execution_failed',
        'the proposal write did not return a result; its outcome is unconfirmed and it may already be committed. '
        + 'Do not report it as not written and do not retry under a new callId.');
    }
    if (written.status === 'committed') {
      return success(callId, {
        status: written.status,
        item: args.item,
        revision: written.value.revision,
        receipt: written.cursor,
        replayed: written.replayed,
      });
    }
    if (written.code === 'cancelled') return cancelledResult(callId, written.reason, written);
    if (written.code === 'capacity') {
      return rejectedResult(callId, 'execution_failed', written,
        `方案超出上限，请缩短命令、目录或理由后再试：${written.reason}`);
    }
    return rejectedResult(callId, written.code === 'invalid' ? 'invalid_arguments' : 'execution_failed',
      written, written.reason);
  }

  function proposalDefinition(): ToolDefinition {
    return {
      name: PROPOSE_SAFER_METHOD_TOOL_NAME,
      description: 'Propose one safer replacement command for a proposalTargets (process) item, given by its '
        + 'alias #n. The command is run exactly as written, never the original; it is 1-4000 UTF-8 bytes, the '
        + 'optional cwd is at most 512 bytes and the rationale is 1-2000 characters. The reviewed record and this '
        + 'proposal round are bound by the platform; you cannot choose them. A later call for the same item '
        + 'replaces the earlier proposal until the round ends. If the result says capacity, shorten the command, '
        + 'the directory or the rationale.',
      inputSchema: proposalInputSchema,
      effectClass: 'workspace_write',
      requiredCapabilities: [],
      independentReadOnly: false,
      defaultTimeoutMs: 10_000,
      outputLimitBytes: 64 * 1024,
      summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
      handler: {
        async execute(call: Readonly<ToolCall>, options: Readonly<{ signal: AbortSignal }>): Promise<ToolResult> {
          return executeProposal(call, options.signal);
        },
      },
    };
  }

  const proposalPhase = config.phase === 'proposal';
  return {
    names: proposalPhase ? PROPOSE_SAFER_METHOD_TOOL_NAMES : RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAMES,
    create: () => [proposalPhase ? proposalDefinition() : reviewDefinition()],
  };
}
