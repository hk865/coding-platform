/**
 * K3 (spec §1 L3): the fixed tool-kind table, read top to bottom, first match
 * wins. Pure: imports only `src/contracts`.
 *
 * Names in the table are the Kernel's recorded tool names. The authorization
 * name `write` maps to the Kernel name `edit` (`observed-model-run.ts`), so the
 * table lists `edit` and never `write`.
 */
import type { HostTakeoverProofV1, UnknownCallKindV1 } from '../../../contracts/unknown-call-review.js';

export type UnknownCallKindEntry = {
  toolName: string;
  kind: UnknownCallKindV1;
  /** L2: true when the tool stops together with the Host process. */
  contained: boolean;
};

/** L3, exact order. Row 8 ("everything else") is implicit in the functions below. */
export const UNKNOWN_CALL_KIND_TABLE: readonly UnknownCallKindEntry[] = [
  // Row 1: Kernel read/check and exploration tools.
  ...['read', 'check', 'list_files', 'search', 'symbols', 'code_index', 'project_source', 'project_index',
    'python_index', 'cpp_index', 'source_excerpt', 'read_source', 'read_material']
    .map((toolName) => ({ toolName, kind: 'read_only' as const, contained: true })),
  // Row 2: platform read-only tools (these never look up a commit receipt).
  ...['read_session_inbox', 'read_session_message', 'read_session_message_body', 'read_user_decision',
    'query_task_graph', 'query_ready_tasks', 'find_related_sessions', 'read_session_card', 'look_graph', 'find_graph']
    .map((toolName) => ({ toolName, kind: 'read_only' as const, contained: true })),
  // Row 3: the read-only command.
  { toolName: 'run_readonly_command', kind: 'read_only', contained: true },
  // Row 4: platform record-changing tools.
  ...['send_session_message', 'ack_session_message', 'respond_session_message', 'send_user_message',
    'record_decision_application', 'propose_future_plan', 'request_command_rerun', 'record_note']
    .map((toolName) => ({ toolName, kind: 'platform' as const, contained: true })),
  // Row 5: the review tools (only present in a review round).
  ...['record_unknown_call_review', 'propose_safer_method']
    .map((toolName) => ({ toolName, kind: 'platform' as const, contained: true })),
  // Row 6.
  { toolName: 'edit', kind: 'file_edit', contained: true },
  // Row 7.
  { toolName: 'shell', kind: 'process', contained: true },
];

/** The one fixed authorization-to-Kernel tool-name mapping (L3, D11). */
export function kernelToolNameOf(authorizedName: string): string {
  return authorizedName === 'write' ? 'edit' : authorizedName;
}

/** L3 row 8: an unknown name is the most dangerous kind and blocks RUN-25. */
export function unknownCallKindOf(toolName: string): UnknownCallKindV1 {
  return UNKNOWN_CALL_KIND_TABLE.find((entry) => entry.toolName === toolName)?.kind ?? 'process';
}

/** L2/L3: only in-table tools that stop with the Host admit RUN-25 (G3). */
export function containedByHostStop(toolName: string): boolean {
  return UNKNOWN_CALL_KIND_TABLE.find((entry) => entry.toolName === toolName)?.contained ?? false;
}

/**
 * L2: `hl01_no_lock` and `hl03_stale_lock` prove the previous Host is gone;
 * `memory_store` does not (the previous instance could still be alive in this
 * process), and neither does a missing proof (G1 -> `no_takeover_proof`).
 */
export function admitsAutoCleanupTakeover(proof: HostTakeoverProofV1 | null | undefined): boolean {
  return proof !== null && proof !== undefined && proof.kind !== 'memory_store';
}
