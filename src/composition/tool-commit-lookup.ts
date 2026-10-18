/**
 * K3 (Q2/L4): the ONE `ToolCommitLookup` dispatch over the platform owners that
 * publish a read-only committed-call lookup.
 *
 * Each owner answers only its own L3 row-4 tool names and reports
 * `{ status: 'undetermined', reason: 'lookup_not_published' }` for every other
 * name (the shared `toolCommitLookupUnknownTool`). The dispatch uses a fixed
 * `tool name -> owner` table built from each owner's declared tool-name set, so
 * an owner that merely does not know a name (`unknown_tool: ...`) is never
 * asked; a name no owner declares is `lookup_not_published`. It never writes.
 *
 * The owner array is positional (`create-platform.ts` passes mailbox, decision,
 * plan, notes, CRR in that order); `ownerToolNames[index]` names owner `index`'s
 * tools. A caller with a different order passes its own sets.
 */
import type { ToolCommitLookup } from '../contracts/unknown-call-review.js';

/** L3 row-4 names the mailbox owner publishes the committed-send lookup for. */
export const MAILBOX_COMMIT_LOOKUP_TOOLS: readonly string[] = [
  'send_session_message', 'ack_session_message', 'respond_session_message', 'send_user_message',
];
/** L3 row-4 name the decision owner publishes the committed-application lookup for. */
export const DECISION_COMMIT_LOOKUP_TOOLS: readonly string[] = ['record_decision_application'];
/** L3 row-4 name the plan owner publishes the committed-proposal lookup for. */
export const PLAN_COMMIT_LOOKUP_TOOLS: readonly string[] = ['propose_future_plan'];
/** L3 row-4 name the notes owner publishes the committed-record_note lookup for. */
export const NOTE_COMMIT_LOOKUP_TOOLS: readonly string[] = ['record_note'];
/** L3 row-4 name the CRR owner publishes the committed-request lookup for. */
export const COMMAND_RERUN_COMMIT_LOOKUP_TOOLS: readonly string[] = ['request_command_rerun'];

/** The production owner order (`create-platform.ts`); the default for a plain array. */
const DEFAULT_OWNER_TOOL_NAMES: readonly (readonly string[])[] = [
  MAILBOX_COMMIT_LOOKUP_TOOLS, DECISION_COMMIT_LOOKUP_TOOLS, PLAN_COMMIT_LOOKUP_TOOLS, NOTE_COMMIT_LOOKUP_TOOLS,
  COMMAND_RERUN_COMMIT_LOOKUP_TOOLS,
];

export function createToolCommitLookup(
  owners: readonly (ToolCommitLookup | undefined)[],
  ownerToolNames: readonly (readonly string[])[] = DEFAULT_OWNER_TOOL_NAMES,
): ToolCommitLookup {
  const byToolName = new Map<string, ToolCommitLookup>();
  owners.forEach((owner, index) => {
    if (owner === undefined) return;
    for (const toolName of ownerToolNames[index] ?? []) byToolName.set(toolName, owner);
  });
  return async (ctx, input) => {
    const owner = byToolName.get(input.toolName);
    if (owner === undefined) return { status: 'undetermined', reason: 'lookup_not_published' };
    return owner(ctx, input);
  };
}
