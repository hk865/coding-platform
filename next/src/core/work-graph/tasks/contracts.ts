/**
 * WorkGraph task contracts — the Goal creation slice only.
 *
 * This batch publishes exactly one real operation (`createGoal`) plus the two
 * trusted legacy adapters that let the existing GUI → HumanCollaboration →
 * target GoalTaskPort chain (the old Control/StateLedger delegates are absent)
 * run through the SAME WorkGraph kernel. No other TaskPort operation is
 * declared: an empty shell method would let a consumer depend on behaviour that
 * does not exist. Later batches extend this file.
 *
 * The legacy command/event/ledger types are imported verbatim from the original
 * contracts; this file must not restate them.
 */

import type { CoreCallContext } from "../../../contracts/core/call-context.js";
import type { CommandMeta, WorkspaceScope } from "../../../contracts/core/identity.js";
import type { WriteResult } from "../../../contracts/core/results.js";
import type { GoalSnapshot } from "../../../contracts/ledger.js";
import type { GoalRecordTransactionPort } from "../../record-store/ports.js";

/** A graph write: the domain input plus the trusted caller's request metadata. */
export type GraphWrite<T> = { input: T; meta: CommandMeta };

/**
 * `goalId` is the target aggregate id and is INDEPENDENT of `meta.requestId`
 * (the idempotency key, which maps onto the legacy `idempotencyKey`). Deriving
 * one from the other would silently change the identity of existing commands.
 */
export type CreateGoalInput = {
  goalId: string;
  workspace: WorkspaceScope;
  objective: string;
};

/**
 * The trusted Host-facing creation capability.
 *
 * `ctx` must match `request.input.workspace` and must be constructed by a real
 * Host authorization entry point. `principal.kind === 'host'` is a record of
 * who called, never an authorization: this port must not turn model input into
 * a grant, and a `query_run` context does not obtain goal-creation authority.
 */
export interface GoalTaskPort {
  createGoal(
    ctx: CoreCallContext,
    request: GraphWrite<CreateGoalInput>,
  ): Promise<WriteResult<GoalSnapshot>>;
}

/**
 * Dependencies of the Goal service. Time and event ids are injected because the
 * service — not the store — compiles the event identity.
 */
export type GoalServiceDependencies = {
  records: GoalRecordTransactionPort;
  now(): string;
  eventId(): string;
};

/** The service surface published by `tasks/task-service.ts`. */
export type GoalService = {
  tasks: GoalTaskPort;
};
