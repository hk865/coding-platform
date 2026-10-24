/**
 * K3 (L8, L4, L5; Q3): the shared review-draft reader.
 *
 * The classifier's RUN-25 candidate and the Host attestation entry both need
 * the same untruncated `UnknownCallReviewDraftV1`: the inventory (L8), each
 * unresolved call's item with its kind (L3), its platform observation (L4) and
 * the workspace capture (L5). The creation-budget cut is NOT applied here; the
 * WorkGraph constructor truncates (`too_large`, L7/M3, Q3).
 *
 * The reader is given the Kernel facts the caller already read: the Run record,
 * whether the Turn was found, the RUN-20(ii) history, and the unresolved calls
 * with the arguments and positions the Kernel recorded. It only reads: the
 * platform lookups and the workspace capture are injected as optional
 * dependencies; a missing dependency is an `undetermined` platform item and a
 * `not_configured` workspace, never a throw.
 */
import { isRecord, utf8Bytes } from '../../contracts/validation/common.js';
import type { ArtifactRef } from '../../contracts/artifact.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../contracts/fingerprint.js';
import { containedByHostStop, unknownCallKindOf } from '../work-graph/state/unknown-call-kinds.js';
import type { KernelExecutionBinding } from '../work-graph/model/execution-entry-contracts.js';
import type { TaskExecutionRecord } from '../work-graph/model/execution-read-contracts.js';
import type {
  ToolCommitLookup, ToolCommitLookupInput, UnknownCallObservationV1, UnknownCallReviewDraftV1, UnknownCallReviewItemV1,
  WorkspaceCaptureV1,
} from '../../contracts/unknown-call-review.js';

/** One unresolved call exactly as the Kernel recorded it. */
export type UnresolvedCallFactV1 = {
  callId: string;
  toolName: string;
  arguments: unknown;
  /** The position of the assistant message declaring the call (L7 `KernelCallRefV1`). */
  declaredPosition: number;
  /** The `tool.started` position, or null when the call never started. */
  startedPosition: number | null;
  startedAt: string | null;
};

export type UnknownCallReviewDraftInput = {
  record: TaskExecutionRecord;
  kernel: KernelExecutionBinding;
  /** The fixed Turn was found in the read window. */
  turnFound: boolean;
  /** The Host entry could not read the Kernel now (`missing`/`damaged`, L8 `kernel_unreadable`). */
  kernelReadable: boolean;
  /** The Run went through RUN-20(ii): L8 `kernel_unreadable_at_stop`, no matter what is readable now. */
  kernelUnreadableAtStop: boolean;
  unresolved: readonly UnresolvedCallFactV1[];
  /**
   * K3 (L25/G11, G8): the capture the caller already made and checked, so the
   * reader reuses it instead of capturing again. Absent keeps the old path.
   */
  capturedWorkspace?: WorkspaceCaptureV1;
};

export type UnknownCallReviewDraftDeps = {
  /** K3 L4: the platform owners' committed-call lookups, dispatched by tool name. */
  lookupToolCommit?: ToolCommitLookup;
  /** K3 L5: the workspace capture, wired by `create-platform.ts`. */
  captureWorkspace?: (ctx: CoreCallContext, input: { workspaceId: string; bundleRef: ArtifactRef })
    => Promise<WorkspaceCaptureV1>;
};

const CALL_ID_MAX_BYTES = 512;
const COMMAND_MAX = 512;
const PATH_MAX = 512;
const MAX_PATHS = 8;

function bounded(text: string, max: number): { text: string; truncated: boolean } {
  return text.length <= max ? { text, truncated: false } : { text: text.slice(0, max), truncated: true };
}

function text(value: unknown): string | null { return typeof value === 'string' ? value : null; }

function pathsOf(args: Record<string, unknown>): { paths: string[]; pathsOmitted: number } {
  const raw = [args['path'], args['filePath'], args['file_path']]
    .filter((value): value is string => typeof value === 'string');
  const list = Array.isArray(args['paths']) ? args['paths'].filter((value): value is string => typeof value === 'string') : [];
  const all = [...raw, ...list];
  const paths = all.slice(0, MAX_PATHS).map(path => bounded(path, PATH_MAX).text);
  return { paths, pathsOmitted: Math.max(0, all.length - paths.length) };
}

function summaryOf(args: unknown, kind: string): UnknownCallReviewItemV1['summary'] {
  const object = isRecord(args) ? args : {};
  const command = text(object['command']);
  const cwd = text(object['cwd']);
  const mode = object['mode'] === 'replace' || object['mode'] === 'create' ? object['mode'] : null;
  const { paths, pathsOmitted } = kind === 'file_edit' ? pathsOf(object) : { paths: [], pathsOmitted: 0 };
  const boundedCommand = command === null ? { text: null, truncated: false } : bounded(command, COMMAND_MAX);
  return { command: boundedCommand.text, cwd, mode, paths, pathsOmitted,
    truncated: boundedCommand.truncated || (command !== null && command.length > COMMAND_MAX) };
}

function observationOf(lookup: ToolCommitLookup | undefined, ctx: CoreCallContext, item:
  { toolName: string; arguments: unknown; callId: string }, origin: ToolCommitLookupInput['origin']): Promise<UnknownCallObservationV1> {
  const kind = unknownCallKindOf(item.toolName);
  if (kind === 'read_only') return Promise.resolve({ verdict: 'no_review_needed', by: 'platform' });
  if (kind === 'file_edit') return Promise.resolve({ verdict: 'compare_in_continuation', by: 'platform' });
  if (kind === 'process') return Promise.resolve({ verdict: 'pending', by: null });
  if (lookup === undefined) {
    return Promise.resolve({ verdict: 'undetermined', by: 'platform',
      evidence: { kind: 'lookup_failed', reason: 'lookup_not_wired' } });
  }
  return lookup(ctx, { toolName: item.toolName, arguments: item.arguments, kernelCallId: item.callId, origin })
    .then((result) => {
      switch (result.status) {
        case 'committed':
          return { verdict: 'done' as const, by: 'platform' as const,
            evidence: { kind: 'receipt' as const, cursor: result.cursor, eventIds: result.eventIds } };
        case 'not_committed':
          return { verdict: 'not_done' as const, by: 'platform' as const, evidence: { kind: 'not_committed' as const } };
        default:
          return { verdict: 'undetermined' as const, by: 'platform' as const,
            evidence: { kind: 'lookup_failed' as const, reason: result.reason } };
      }
    }, (error: unknown) => ({ verdict: 'undetermined' as const, by: 'platform' as const,
      evidence: { kind: 'lookup_failed' as const, reason: error instanceof Error ? error.message : 'lookup_failed' } }));
}

function decodable(call: UnresolvedCallFactV1): boolean {
  return call.toolName.length > 0 && call.callId.length > 0 && utf8Bytes(call.callId) <= CALL_ID_MAX_BYTES;
}

/**
 * L8 inventory: the first problem the facts prove, or `complete`. `too_large`
 * is deliberately absent: the WorkGraph constructor applies the creation budget
 * (L7/M3) and turns an over-budget complete draft into `incomplete/too_large`.
 */
function inventoryProblemOf(input: UnknownCallReviewDraftInput, listed: readonly UnresolvedCallFactV1[]):
'kernel_unreadable' | 'kernel_unreadable_at_stop' | 'turn_not_found' | 'too_many_calls' | 'undecodable_call' | null {
  if (!input.kernelReadable) return 'kernel_unreadable';
  if (input.kernelUnreadableAtStop) return 'kernel_unreadable_at_stop';
  if (!input.turnFound) return 'turn_not_found';
  if (input.unresolved.some(call => !decodable(call))) return 'undecodable_call';
  if (listed.length > 32) return 'too_many_calls';
  return null;
}

/**
 * K3 (L25/G11): the PURE inventory check the classifier runs before it captures
 * the workspace or asks any owner. `null` is L8 `complete` (including an
 * over-budget one: `too_large` is the WorkGraph constructor's truncation, never
 * a `blockedBy`); every other value is a G11 `inventory_incomplete` cause.
 */
export function unknownCallInventoryProblem(input: UnknownCallReviewDraftInput):
'kernel_unreadable' | 'kernel_unreadable_at_stop' | 'turn_not_found' | 'too_many_calls' | 'undecodable_call' | null {
  return inventoryProblemOf(input, input.unresolved.filter(decodable));
}

/** The L8 default when the capture dependency is absent or has no bundle. */
function notConfiguredCapture(): WorkspaceCaptureV1 {
  return { status: 'unavailable', runBaselineKnown: false, reason: 'not_configured', detail: 'capture not wired' };
}

/**
 * K3 (L25/G8): the ONE capture the classifier reads once and then reuses for the
 * owner lookups. A missing dependency or bundle is the L8 `not_configured`
 * unavailable capture, never a throw.
 */
export async function captureUnknownCallWorkspace(
  deps: UnknownCallReviewDraftDeps, ctx: CoreCallContext, run: TaskExecutionRecord['run'],
): Promise<WorkspaceCaptureV1> {
  return await captureOf(deps, ctx, run) ?? notConfiguredCapture();
}

export async function readUnknownCallReviewDraft(
  deps: UnknownCallReviewDraftDeps, ctx: CoreCallContext, input: UnknownCallReviewDraftInput,
): Promise<UnknownCallReviewDraftV1> {
  const run = input.record.run;
  const listed = input.unresolved.filter(decodable);
  const problem = inventoryProblemOf(input, listed);
  const workspace = input.capturedWorkspace
    ?? (input.kernelReadable === false ? undefined : await captureOf(deps, ctx, run));
  const claim = input.record.outbox.claim;
  const origin = { runRef: run.ref,
    sessionRef: { projectId: claim.sessionRef.projectId, sessionId: claim.sessionRef.sessionId },
    generation: generationOf(input.record), workspaceId: run.workspaceSnapshot.workspaceId };
  const items: UnknownCallReviewItemV1[] = [];
  for (const call of listed.slice(0, 32)) {
    const kind = unknownCallKindOf(call.toolName);
    items.push({
      alias: items.length + 1,
      callId: call.callId,
      toolName: call.toolName,
      kind,
      contained: containedByHostStop(call.toolName),
      kernel: { adapterId: input.kernel.adapterId, kernelSessionId: input.kernel.kernelSessionId,
        kernelRunId: input.kernel.runId, turnId: input.kernel.turnId, callId: call.callId,
        declaredPosition: call.declaredPosition, startedPosition: call.startedPosition },
      argumentsDigest: sha256Hex(canonicalJson(call.arguments as JsonValue)),
      summary: summaryOf(call.arguments, kind),
      startedAt: call.startedAt,
      observed: await observationOf(deps.lookupToolCommit, ctx, call, origin),
    });
  }
  return {
    inventory: problem === null ? 'complete' : 'incomplete',
    inventoryProblem: problem,
    items,
    itemsOmitted: listed.length - items.length,
    workspace: workspace ?? notConfiguredCapture(),
  };
}

/**
 * K3 L4: the committed SessionMessage sender identity is bound to the CLAIM
 * generation (`mailbox-service.ts` `deriveWorkRunSender`: `generation:
 * claim.generation`), not the execution authorization's `generation` (which
 * counts re-entries). Read the same claim generation the original Run used, so
 * the rebuilt identity matches the committed receipt.
 */
function generationOf(record: TaskExecutionRecord): number {
  return record.outbox.claim.generation;
}

async function captureOf(deps: UnknownCallReviewDraftDeps, ctx: CoreCallContext, run: TaskExecutionRecord['run']):
Promise<WorkspaceCaptureV1 | undefined> {
  if (deps.captureWorkspace === undefined) return undefined;
  const bundleRef = run.envelope?.bundleRef;
  if (bundleRef === undefined) return undefined;
  return deps.captureWorkspace(ctx, { workspaceId: run.workspaceSnapshot.workspaceId, bundleRef });
}
