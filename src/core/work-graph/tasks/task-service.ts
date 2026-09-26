/**
 * WorkGraph Goal task service — the two trusted creation entry points over the
 * ONE `admitGoalCreation` pipeline.
 *
 * R3a §5 execution order (shared by both entries):
 *   1. clone, validate with the original command validator, check the bound
 *      identity/scope, normalize the objective, compute the REAL fingerprint
 *      and the goal-create identity key (a caller-supplied fingerprint is never
 *      trusted);
 *   2. legal idempotency lookup — a hit restores the ORIGINAL GoalCreated result
 *      from `receipt.cursor`/`eventIds` without reading the current Goal or the
 *      scope;
 *   3. ONE read snapshot of the canonical Project/Workspace/Goal keys; caller
 *      pins are structurally validated BEFORE the lookup and enforced against
 *      the versions read here;
 *   4. fold + compile exactly 3 guards;
 *   5. `records.commit(...)`: the store re-looks-up, CASes, writes, records the
 *      idempotency receipt and COMMITs.
 *
 * No SQL, no Map, no second copy of the normalisation/fingerprint rules.
 */
import type { CreateGoalCommand } from "../../../contracts/command-event.js";
import { normalizeObjective } from "../../../contracts/command-event.js";
import type { CoreCallContext } from "../../../contracts/core/call-context.js";
import type { VersionPin } from "../../../contracts/core/identity.js";
import type { CoreError, WriteResult } from "../../../contracts/core/results.js";
import { canonicalJson, type JsonValue } from "../../../contracts/fingerprint.js";
import type { AggregateRef, GoalSnapshot } from "../../../contracts/ledger.js";
import { validateCreateGoalCommand } from "../../../contracts/validation/goal.js";
import type { GoalRecordTransactionPort } from "../../record-store/ports.js";
import type { RecordLookupPort } from "../../record-store/lookup-ports.js";
import type { CompletionDependencies } from "./completion.js";
import { completeGoalFromHost, completeTaskFromHost } from "./completion.js";
import type { CreateGoalInput, GoalService, GoalServiceDependencies, GoalTaskPort, GraphWrite } from "./contracts.js";
import { compareCallerGoalPins, compileGoalCreate, goalCreateFingerprint, goalCreateIdentityKey, goalRefFor, normalizeCallerGoalPins, projectRefFor, workspaceRefFor } from "../persistence/commit-compiler.js";
import { createGoalGraphRepository, type CommittedStoreReceipt, type GoalCreateIdentity, type GoalGraphRepository } from "../persistence/graph-repository.js";
import { cloneActorRef, canonicalRefKey } from "../persistence/record-codecs.js";

// --------------------------------------------------------------------------
// Internal admission result
// --------------------------------------------------------------------------

export type GoalAdmissionDeps = {
  records: GoalRecordTransactionPort;
  now(): string;
  eventId(): string;
};

export type GoalAdmissionRejection = {
  status: "rejected";
  code: CoreError;
  reason: string;
  /** The legacy `currentRevision` meaning: an absent row is reported as 0. */
  currentRevision?: number;
  current?: VersionPin[];
};

export type GoalAdmission =
  | { status: "committed"; snapshot: GoalSnapshot; receipt: CommittedStoreReceipt }
  | GoalAdmissionRejection;

function reject(code: CoreError, reason: string): GoalAdmissionRejection {
  return { status: "rejected", code, reason };
}

/**
 * Ownership of a caller-supplied input. `structuredClone` is the one copy that
 * keeps a normal JSON command byte-compatible. When it refuses a value - a
 * function or another value that is not structured-cloneable, which the JSON
 * command wire never carries; cycles are cloneable and are not the reason here
 * - the caller's reference is NEVER kept and processed after an `await`: the
 * call is rejected as `invalid` before any lookup, read or write. This
 * ownership step adds no JSON validation rule of its own.
 */
type OwnedInput<T> = { status: "owned"; value: T } | { status: "invalid"; reason: string };

function ownInput<T>(value: T, what: string): OwnedInput<T> {
  try {
    return { status: "owned", value: structuredClone(value) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "invalid", reason: `${what} cannot be isolated from the caller: ${detail}` };
  }
}

function describeIssues(issues: readonly { path: string; message: string }[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}

function expectedIdentityOf(command: CreateGoalCommand): GoalCreateIdentity {
  // `command` is already owned by the admission call, so its identity belongs to
  // the same call-time snapshot and needs no second copy.
  return {
    identity: command.identity,
    goalId: command.aggregateId,
    workspaceId: command.payload.workspaceId,
  };
}

function refFromRefKey(refKey: string): AggregateRef | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(refKey);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return parsed as AggregateRef;
}

/**
 * Legacy Goal-first / pre-read / first-entry fallback, with the store's
 * `revision: null` ("the row genuinely did not exist") mapped to the legacy
 * `currentRevision: 0` meaning. The `current` conflict detail observed inside
 * the failed transaction is preserved, never replaced by a fresh read.
 */
function goalRevisionConflict(
  current: readonly { refKey: string; revision: number | null }[],
  preReadGoalRevision: number | undefined,
  goalRefKey: string,
  reason: string,
): GoalAdmissionRejection {
  const goalEntry = current.find((entry) => entry.refKey === goalRefKey);
  let currentRevision: number;
  if (goalEntry !== undefined) currentRevision = goalEntry.revision ?? 0;
  else if (preReadGoalRevision !== undefined) currentRevision = preReadGoalRevision;
  else currentRevision = current[0]?.revision ?? 0;

  const pins: VersionPin[] = [];
  const push = (entry: { refKey: string; revision: number | null }): void => {
    if (entry.revision === null) return;
    const ref = refFromRefKey(entry.refKey);
    if (ref === null) return;
    pins.push({ ref, revision: entry.revision });
  };
  if (goalEntry !== undefined) push(goalEntry);
  for (const entry of current) {
    if (entry !== goalEntry) push(entry);
  }

  return {
    status: "rejected",
    code: "revision_conflict",
    reason,
    currentRevision,
    ...(pins.length > 0 ? { current: pins } : {}),
  };
}

// --------------------------------------------------------------------------
// The one admission pipeline
// --------------------------------------------------------------------------

export async function admitGoalCreation(
  deps: GoalAdmissionDeps,
  input: unknown,
  callerPins?: readonly VersionPin[],
  options?: { signal?: AbortSignal | undefined },
): Promise<GoalAdmission> {
  if (options?.signal?.aborted) return reject("cancelled", "goal creation was cancelled before admission");

  // (1) clone + the original structural validator. This always runs BEFORE the
  // idempotency lookup: a malformed command is invalid even when an earlier
  // commit with the same identity exists, and an input this call cannot own is
  // rejected instead of being processed from the caller's live reference.
  const owned = ownInput(input, "CreateGoalCommand");
  if (owned.status === "invalid") return reject("invalid", owned.reason);
  const cloned = owned.value;
  const issues = validateCreateGoalCommand(cloned);
  if (issues.length > 0) {
    return reject("invalid", `CreateGoalCommand is invalid: ${describeIssues(issues)}`);
  }
  const command = cloned as CreateGoalCommand;
  // The command body is the only trusted source of identity and scope; a
  // caller-supplied fingerprint does not exist on this path at all.
  const objective = normalizeObjective(command.payload.objective);
  const fingerprint = goalCreateFingerprint(command);
  const identityKey = goalCreateIdentityKey(command.identity);

  const pins = normalizeCallerGoalPins(command, callerPins);
  if (pins.status === "invalid") return reject("invalid", pins.reason);

  const expected = expectedIdentityOf(command);
  const repository: GoalGraphRepository = createGoalGraphRepository(deps.records);

  // (2) legal idempotency lookup before any current-version judgement.
  const lookup = await repository.lookupCommit({ identityKey, fingerprint, expected });
  if (lookup.status === "found") {
    return { status: "committed", snapshot: lookup.snapshot, receipt: lookup.receipt };
  }
  if (lookup.status === "idempotency_conflict") {
    return reject("idempotency_conflict", lookup.reason);
  }
  if (lookup.status === "invalid") return reject("invalid", lookup.reason);
  if (lookup.status !== "missing") return reject("unavailable", lookup.reason);

  // (3) ONE read snapshot for the canonical scope keys.
  const refs = {
    projectRef: projectRefFor(command.identity.projectId),
    workspaceRef: workspaceRefFor(command.identity.projectId, command.payload.workspaceId),
    goalRef: goalRefFor(command.identity.projectId, command.aggregateId),
  };
  const read = await repository.readGoalScope(refs);
  if (read.status === "not_found") return reject("not_found", read.reason);
  // A codec/schema anomaly is NEVER "the scope does not exist".
  if (read.status !== "ready") return reject("unavailable", read.reason);

  const observed = read.scope;
  const preReadGoalRevision = observed.goal?.revision;
  const goalRefKey = canonicalRefKey(refs.goalRef);
  const comparison = compareCallerGoalPins(command, pins.pins, {
    projectRevision: observed.project.revision,
    workspaceRevision: observed.workspace.revision,
    goalRevision: preReadGoalRevision ?? null,
  });
  if (comparison.status === "conflict") {
    return goalRevisionConflict(
      comparison.current,
      preReadGoalRevision,
      goalRefKey,
      "the supplied version pins do not match the versions read in this call",
    );
  }

  // (4) fold + compile exactly 3 guards. Goal absence is guaranteed by the
  // null guard; a pre-read Goal never short-circuits the in-transaction
  // idempotency opportunity.
  const compiled = compileGoalCreate({
    command,
    objective,
    projectRevision: observed.project.revision,
    workspaceRevision: observed.workspace.revision,
    eventId: deps.eventId(),
    occurredAt: deps.now(),
  });

  // (5) the store re-looks-up, CASes, writes and commits. Once inside this
  // call the transaction result wins: a successful commit is never flipped to
  // cancelled by an end-of-call signal.
  if (options?.signal?.aborted) return reject("cancelled", "goal creation was cancelled before commit");
  const committed = await repository.commit({
    prepared: compiled.prepared,
    folded: compiled.snapshot,
    expected,
  });
  if (committed.status === "committed") {
    return { status: "committed", snapshot: committed.snapshot, receipt: committed.receipt };
  }
  if (committed.status === "revision_conflict") {
    return goalRevisionConflict(committed.current, preReadGoalRevision, goalRefKey, committed.reason);
  }
  if (committed.status === "idempotency_conflict") {
    return reject("idempotency_conflict", committed.reason);
  }
  if (committed.status === "invalid") return reject("invalid", committed.reason);
  return reject("unavailable", committed.reason);
}

// --------------------------------------------------------------------------
// Entry point A: the trusted Host GoalTaskPort
// --------------------------------------------------------------------------

/**
 * A stable commandId/correlationId derived from the REAL identity. Neither
 * value participates in the original idempotency fingerprint; `eventId` still
 * comes from the injected generator.
 */
function deriveGoalCommandIdentity(input: {
  projectId: string;
  workspaceId: string;
  goalId: string;
  actorKind: string;
  actorId: string;
  idempotencyKey: string;
}): { commandId: string; correlationId: string } {
  const digest = canonicalJson(input as unknown as JsonValue);
  return {
    commandId: `goal-create-command:${digest}`,
    correlationId: `goal-create-request:${digest}`,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function createGoalFromHost(
  deps: GoalServiceDependencies,
  ctx: CoreCallContext,
  request: GraphWrite<CreateGoalInput>,
): Promise<WriteResult<GoalSnapshot>> {
  const owned = ownInput(request, "createGoal request");
  if (owned.status === "invalid") {
    return { status: "rejected", code: "invalid", reason: owned.reason };
  }
  const cloned = owned.value as { input?: unknown; meta?: unknown } | undefined;
  const rawInput = cloned?.input;
  const rawMeta = cloned?.meta;
  if (!isRecordValue(rawInput)) {
    return { status: "rejected", code: "invalid", reason: "createGoal requires an input object" };
  }
  const goalId = rawInput["goalId"];
  const objective = rawInput["objective"];
  const workspace = rawInput["workspace"];
  if (
    !isNonEmptyString(goalId) ||
    typeof objective !== "string" ||
    !isRecordValue(workspace) ||
    !isNonEmptyString(workspace["projectId"]) ||
    !isNonEmptyString(workspace["workspaceId"])
  ) {
    return {
      status: "rejected",
      code: "invalid",
      reason: "createGoal requires a goalId, a workspace scope and an objective",
    };
  }
  const projectId = workspace["projectId"];
  const workspaceId = workspace["workspaceId"];
  const requestId = isRecordValue(rawMeta) ? rawMeta["requestId"] : undefined;
  if (!isNonEmptyString(requestId)) {
    return { status: "rejected", code: "invalid", reason: "createGoal requires meta.requestId" };
  }
  const expectedPins = isRecordValue(rawMeta) ? rawMeta["expected"] : undefined;

  // The trusted Host entry binds the context; `principal.kind === 'host'` is a
  // record of who called, never an authorization invented by this port. A work
  // run or query run does not obtain goal-creation authority in this batch.
  const bound = ctx as unknown as
    | {
        projectId?: unknown;
        workspaceId?: unknown;
        principal?: { kind?: unknown; actor?: unknown };
        signal?: AbortSignal;
      }
    | null
    | undefined;
  if (bound === null || bound === undefined) {
    return { status: "rejected", code: "forbidden", reason: "goal creation requires a bound call context" };
  }
  if (bound.projectId !== projectId || bound.workspaceId !== workspaceId) {
    return {
      status: "rejected",
      code: "forbidden",
      reason: "the call context does not match the requested workspace scope",
    };
  }
  if (bound.principal?.kind !== "host") {
    return {
      status: "rejected",
      code: "forbidden",
      reason: "goal creation requires a trusted Host call context in this batch",
    };
  }

  const identity = {
    projectId,
    actor: cloneActorRef(bound.principal.actor as Parameters<typeof cloneActorRef>[0]),
    idempotencyKey: requestId,
  };
  const derived = deriveGoalCommandIdentity({
    projectId: identity.projectId,
    workspaceId,
    goalId,
    actorKind: identity.actor.kind,
    actorId: identity.actor.id,
    idempotencyKey: identity.idempotencyKey,
  });
  const command: CreateGoalCommand = {
    commandId: derived.commandId,
    commandType: "CreateGoal",
    schemaVersion: 1,
    identity,
    aggregateId: goalId,
    expectedRevision: 0,
    correlationId: derived.correlationId,
    submittedAt: deps.now(),
    payload: { workspaceId, objective },
  };

  const admission = await admitGoalCreation(deps, command, expectedPins as readonly VersionPin[] | undefined, {
    signal: bound.signal,
  });
  if (admission.status === "committed") {
    return {
      status: "committed",
      value: admission.snapshot,
      replayed: admission.receipt.replayed,
      cursor: admission.receipt.cursor,
    };
  }
  return {
    status: "rejected",
    code: admission.code,
    reason: admission.reason,
    ...(admission.current !== undefined ? { current: admission.current } : {}),
  };
}

/**
 * Creates the Goal service published to the Control/Host composition roots.
 * Every entry point shares the same physical record backend. `createGoal` never
 * reads `lookup`; the completion methods narrow it ONCE at construction time and
 * report an explicit `unsupported` when the real backend cannot supply it.
 */
export function createGoalService(deps: GoalServiceDependencies): GoalService {
  const completionDeps: CompletionDependencies | null = typeof deps.records.lookup === "function"
    ? { records: deps.records as GoalRecordTransactionPort & RecordLookupPort,
        now: deps.now, eventId: deps.eventId }
    : null;
  const tasks: GoalTaskPort = {
    createGoal: (ctx, request) => createGoalFromHost(deps, ctx, request),
    completeTask: (ctx, request) => completionDeps === null
      ? Promise.resolve({ status: "rejected", code: "unsupported",
          reason: "Task completion requires a RecordStore with the exact lookup capability" })
      : completeTaskFromHost(completionDeps, ctx, request),
    completeGoal: (ctx, request) => completionDeps === null
      ? Promise.resolve({ status: "rejected", code: "unsupported",
          reason: "Goal completion requires a RecordStore with the exact lookup capability" })
      : completeGoalFromHost(completionDeps, ctx, request),
  };
  return { tasks };
}
