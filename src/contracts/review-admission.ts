/**
 * R4 / L13 / L20: the one shared review-round (unknown-call review) admission
 * contract. Both phases are review-purpose Runs and share the same rules; only
 * the one write tool differs (`record_unknown_call_review` for review,
 * `propose_safer_method` for proposal).
 *
 * Two phase constants plus one pure helper keyed on the TRUSTED
 * `RunSnapshot['purpose']` (never on stored permissions or model input). The
 * admission points (`execution-driver.ts` start, `create-platform.ts`
 * authorize and `execution-entry-service.ts` `recheckHostRoleAdmission`) hold
 * all of these fields right after their Host read, so this helper decides the
 * whole review branch without reading Host configuration itself.
 *
 * For a review purpose the Role is still resolved and must be valid, but its
 * declared-permission ceiling is skipped (L13 "不受职责的工具上限限制"): the
 * callers resolve it with EMPTY declared permissions whenever
 * `isReviewRoundPurpose` is true. Host layer 1 still holds, and layer 3 stays
 * in the tool's own `authorizeCurrent`.
 *
 * Pure: imports only from `src/contracts`.
 */
import type { RunSnapshot } from './dispatch.js';

/**
 * L13: the review round's fixed tool set. The exploration tools are not listed
 * because every Work Run receives them together with `read`
 * (`observed-model-run.ts`); the formal granted set is exactly these names.
 */
export const UNKNOWN_CALL_REVIEW_ROUND_TOOL_NAMES = [
  'read', 'run_readonly_command', 'record_unknown_call_review',
] as const;

/**
 * L20: the proposal round's fixed tool set. The same read-only exploration and
 * Session rules as the review round, with `propose_safer_method` in place of
 * `record_unknown_call_review`. The formal granted set is exactly these names.
 */
export const UNKNOWN_CALL_PROPOSAL_ROUND_TOOL_NAMES = [
  'read', 'run_readonly_command', 'propose_safer_method',
] as const;

/** Stable short rejection reasons; callers log them and tests pin them literally. */
export type ReviewRoundAdmissionReason =
  | 'role_invalid'
  | 'tool_set_mismatch'
  | 'write_scope_not_empty'
  | 'host_tool_missing'
  | 'readonly_command_access_not_full';

/**
 * True for a review-purpose Run (`purpose.kind === 'unknown_call_review'`),
 * including the later `proposal` phase. The callers use it to (a) pass EMPTY
 * declared permissions to the Role resolver — skipping only the Role's tool
 * ceiling — and (b) take `reviewRoundAdmissionProblem` instead of the ordinary
 * Host/Role ceiling checks. An absent purpose is ordinary work.
 */
export function isReviewRoundPurpose(purpose: RunSnapshot['purpose'] | undefined): boolean {
  return purpose?.kind === 'unknown_call_review';
}

/** Every field the admission points already hold when they decide. */
export type ReviewRoundAdmissionInput = {
  /** The trusted Run purpose; absent means ordinary work. */
  purpose: RunSnapshot['purpose'];
  /** The accepted/prepared formal tool grant (envelope or manifest permissions). */
  tools: readonly string[];
  /** The accepted/prepared formal write scope. */
  writeScope: readonly string[];
  /** The current/narrowed Host tool list (`current.tools` / `hostConfig.tools`). */
  hostTools: readonly string[];
  /** The current/narrowed Host read-only command access; absent/null is not granted. */
  readonlyCommandAccess?: 'all_except_denied' | null;
  /** True when the Role resolution is valid (not inadmissible) and matches the prepared Role. */
  roleValid: boolean;
};

/** L13 Host layer 1: the two Host-granted names the review round needs. `record_unknown_call_review`
 * is exempt because it is delivered through the Kernel `hostAuthorizedTools` list. */
const HOST_LAYER_ONE_TOOLS = ['read', 'run_readonly_command'] as const;

/** The only two fields Host layer 1 decides from. */
export type ReviewHostLayerOneAccessInput = {
  /** The current/narrowed Host tool list (`current.tools` / `hostConfig.tools` / grant tools). */
  hostTools: readonly string[];
  /** The current/narrowed Host read-only command access; absent/null is not granted. */
  readonlyCommandAccess?: 'all_except_denied' | null | undefined;
};

/**
 * A1 (L13): the ONE Host-layer-1 predicate. `null` when the Host grants both
 * names and the full `all_except_denied` read-only access, otherwise the same
 * stable reason `reviewRoundAdmissionProblem` reports. Admission and the
 * read-only `reviewCapability` query both call it, so the query answers
 * `available` exactly when admission's layer 1 would pass.
 */
export function reviewHostLayerOneAccess(
  input: ReviewHostLayerOneAccessInput,
): 'host_tool_missing' | 'readonly_command_access_not_full' | null {
  for (const tool of HOST_LAYER_ONE_TOOLS) {
    if (!input.hostTools.includes(tool)) return 'host_tool_missing';
  }
  if (input.readonlyCommandAccess !== 'all_except_denied') return 'readonly_command_access_not_full';
  return null;
}

/** Order-insensitive set equality (a duplicate name never widens the set). */
function sameToolSet(tools: readonly string[], expectedNames: readonly string[]): boolean {
  const expected = new Set<string>(expectedNames);
  const actual = new Set(tools);
  if (actual.size !== expected.size) return false;
  for (const tool of expected) if (!actual.has(tool)) return false;
  return true;
}

/**
 * R4/L20: `null` when this Run's purpose is a review purpose (either phase) and
 * its accepted grant satisfies that phase's fixed-tool admission; otherwise a
 * stable reason. The two phases differ only in the one write tool: `review`
 * takes `UNKNOWN_CALL_REVIEW_ROUND_TOOL_NAMES`, `proposal` takes
 * `UNKNOWN_CALL_PROPOSAL_ROUND_TOOL_NAMES`. Both need an empty write scope, a
 * valid Role and Host layer 1.
 *
 * A non-review Run always returns `null`: this helper never decides ordinary
 * work, its callers keep their existing Host/Role checks. Pair each call with
 * `isReviewRoundPurpose` so a non-review `null` is never read as admission.
 */
export function reviewRoundAdmissionProblem(input: ReviewRoundAdmissionInput): ReviewRoundAdmissionReason | null {
  if (!isReviewRoundPurpose(input.purpose)) return null;
  const expected = input.purpose?.phase === 'proposal'
    ? UNKNOWN_CALL_PROPOSAL_ROUND_TOOL_NAMES : UNKNOWN_CALL_REVIEW_ROUND_TOOL_NAMES;
  if (!input.roleValid) return 'role_invalid';
  if (!sameToolSet(input.tools, expected)) return 'tool_set_mismatch';
  if (input.writeScope.length !== 0) return 'write_scope_not_empty';
  return reviewHostLayerOneAccess({ hostTools: input.hostTools, readonlyCommandAccess: input.readonlyCommandAccess });
}
