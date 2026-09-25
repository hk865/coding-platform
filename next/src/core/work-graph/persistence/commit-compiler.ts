/**
 * WorkGraph Goal commit compiler — the ONE goal-create pure validator/fold.
 *
 * This file owns every pure decision of the Goal creation slice:
 *   - the deterministic fold (`GoalCreated@1` event + revision-1 `GoalSnapshot`);
 *   - the complete guard set and the encoded write set for one `PreparedCommit`;
 *   - the legacy raw-batch envelope validator MOVED here from
 *     `data/state-ledger/validation/bootstrap.ts` (its semantics are preserved
 *     verbatim for the old entry point; see `validateGoalCreateCommit`);
 *   - the approved strict check for a NEW legacy batch identity;
 *   - the trusted caller version pins.
 *
 * It starts no transaction, writes no SQL, keeps no state and never talks to the
 * legacy ledger. The normalization/fingerprint/identity rules are reused from
 * `contracts/command-event.ts` — never copied.
 */
import type { CommandFingerprint, CommandIdentity, CreateGoalCommand, GoalCreatedEvent } from "../../../contracts/command-event.js";
import { commandFingerprint, commandIdentityKey, normalizeObjective } from "../../../contracts/command-event.js";
import type { VersionPin } from "../../../contracts/core/identity.js";


import type { GoalRef, GoalSnapshot, ProjectRef, WorkspaceRef } from "../../../contracts/ledger.js";
import type { PreparedCommit, RecordGuard } from "../../record-store/ports.js";
import { canonicalRefKey, cloneActorRef, encodeGoalCreatedEvent, encodeGoalSnapshot } from "./record-codecs.js";

/**
 * Storage-format prefix of the legacy identity key for this commit kind. It is
 * byte-identical to `ledgerIdentityKeyFor({commitKind:'goal-create',…})`
 * (`commitKind + ':' + commandIdentityKey(identity)`), which is what keeps the
 * legacy entry and the new Goal kernel sharing one idempotency row. Only the
 * identity KEY rule is restated here; the identity hashing itself is the
 * original `commandIdentityKey`.
 */
export const GOAL_CREATE_IDENTITY_PREFIX = "goal-create:";

export function goalCreateIdentityKey(identity: CommandIdentity): string {
  return GOAL_CREATE_IDENTITY_PREFIX + commandIdentityKey(identity);
}

/** The original real fingerprint: an explicitly supplied one is never trusted. */
export function goalCreateFingerprint(command: CreateGoalCommand): CommandFingerprint {
  return commandFingerprint(command);
}

export function projectRefFor(projectId: string): ProjectRef {
  return { aggregateType: "Project", projectId };
}

export function workspaceRefFor(projectId: string, workspaceId: string): WorkspaceRef {
  return { aggregateType: "Workspace", projectId, workspaceId };
}

export function goalRefFor(projectId: string, goalId: string): GoalRef {
  return { aggregateType: "Goal", projectId, goalId };
}

// --------------------------------------------------------------------------
// Deterministic fold
// --------------------------------------------------------------------------

export type GoalCreateCompileInput = {
  command: CreateGoalCommand;
  /** Already normalized by the caller; normalized again here so the event, the
   * snapshot and the fingerprint can never disagree. */
  objective: string;
  projectRevision: number;
  workspaceRevision: number;
  eventId: string;
  occurredAt: string;
};

export type CompiledGoalCreate = {
  prepared: PreparedCommit;
  event: GoalCreatedEvent;
  snapshot: GoalSnapshot;
  identityKey: string;
  fingerprint: CommandFingerprint;
};

/**
 * Compiles one Goal creation into the exact 3 guards / 1 record / 1 event write
 * set. Field order matches the original Control builders byte for byte so the
 * stored `snapshot_json` / `event_json` stay compatible with existing rows.
 */
export function compileGoalCreate(input: GoalCreateCompileInput): CompiledGoalCreate {
  const command = input.command;
  const objective = normalizeObjective(input.objective);
  const projectId = command.identity.projectId;
  const workspaceId = command.payload.workspaceId;
  const goalId = command.aggregateId;

  const event: GoalCreatedEvent = {
    eventId: input.eventId,
    eventType: "GoalCreated",
    schemaVersion: 1,
    projectId,
    workspaceId,
    aggregateType: "Goal",
    aggregateId: goalId,
    aggregateRevision: 1,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: cloneActorRef(command.identity.actor),
    occurredAt: input.occurredAt,
    payload: {
      objective,
      desiredState: "active",
      activePlanRevision: null,
    },
  };

  const snapshot: GoalSnapshot = {
    ref: goalRefFor(projectId, goalId),
    workspaceRef: workspaceRefFor(projectId, workspaceId),
    objective,
    desiredState: "active",
    activePlanRevision: null,
    revision: 1,
  };

  const guards: RecordGuard[] = [
    { refKey: canonicalRefKey(projectRefFor(projectId)), expectedRevision: input.projectRevision },
    { refKey: canonicalRefKey(workspaceRefFor(projectId, workspaceId)), expectedRevision: input.workspaceRevision },
    // Goal absence is guaranteed by the null guard — never by a pre-read.
    { refKey: canonicalRefKey(goalRefFor(projectId, goalId)), expectedRevision: null },
  ];

  const prepared: PreparedCommit = {
    identityKey: goalCreateIdentityKey(command.identity),
    fingerprint: goalCreateFingerprint(command),
    guards,
    records: [encodeGoalSnapshot(snapshot)],
    claims: [],
    indexGuards: [],
    indexChanges: [],
    events: [encodeGoalCreatedEvent(event)],
  };

  return {
    prepared,
    event,
    snapshot,
    identityKey: prepared.identityKey,
    fingerprint: prepared.fingerprint as CommandFingerprint,
  };
}

// --------------------------------------------------------------------------
// Trusted caller version pins
// --------------------------------------------------------------------------

/**
 * `undefined` = the caller did not pin this aggregate (use the revision read in
 * this call). `null` for the Goal = the legacy revision-0 pin, explicitly
 * converted to "must not exist".
 */
export type CallerGoalPins = {
  project?: number;
  workspace?: number;
  goal?: number | null;
};

export type GoalPinNormalization =
  | { status: "ok"; pins: CallerGoalPins }
  | { status: "invalid"; reason: string };

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function classifyPinRef(value: unknown):
  | { kind: "project"; ref: ProjectRef }
  | { kind: "workspace"; ref: WorkspaceRef }
  | { kind: "goal"; ref: GoalRef }
  | { kind: "other" } {
  if (!isRecordValue(value)) return { kind: "other" };
  const aggregateType = value["aggregateType"];
  const projectId = value["projectId"];
  if (typeof projectId !== "string" || projectId.length === 0) return { kind: "other" };
  if (aggregateType === "Project") {
    return { kind: "project", ref: { aggregateType: "Project", projectId } };
  }
  const workspaceId = value["workspaceId"];
  if (aggregateType === "Workspace" && typeof workspaceId === "string" && workspaceId.length > 0) {
    return { kind: "workspace", ref: { aggregateType: "Workspace", projectId, workspaceId } };
  }
  const goalId = value["goalId"];
  if (aggregateType === "Goal" && typeof goalId === "string" && goalId.length > 0) {
    return { kind: "goal", ref: { aggregateType: "Goal", projectId, goalId } };
  }
  return { kind: "other" };
}

/**
 * Structural / identity / scope validity of the caller pins. This is INPUT
 * validity, so it runs BEFORE the idempotency lookup: a malformed,
 * duplicate, irrelevant or cross-scope pin is rejected no matter what an
 * earlier commit with the same identity stored.
 */
export function normalizeCallerGoalPins(
  command: CreateGoalCommand,
  pins: readonly VersionPin[] | undefined,
): GoalPinNormalization {
  if (pins === undefined) return { status: "ok", pins: {} };
  if (!Array.isArray(pins)) return { status: "invalid", reason: "meta.expected must be an array of version pins" };
  const normalized: CallerGoalPins = {};
  const seen = new Set<string>();
  for (const entry of pins as readonly unknown[]) {
    if (!isRecordValue(entry)) return { status: "invalid", reason: "version pin must be an object" };
    const revision = entry["revision"];
    if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
      return { status: "invalid", reason: "version pin revision must be a safe non-negative integer" };
    }
    const classified = classifyPinRef(entry["ref"]);
    if (classified.kind === "other") {
      return { status: "invalid", reason: "version pin ref must be this project's Project, Workspace or Goal ref" };
    }
    const { ref } = classified;
    if (ref.projectId !== command.identity.projectId) {
      return { status: "invalid", reason: "version pin belongs to another project" };
    }
    if (classified.kind === "workspace" && classified.ref.workspaceId !== command.payload.workspaceId) {
      return { status: "invalid", reason: "Workspace version pin belongs to another workspace" };
    }
    if (classified.kind === "goal" && classified.ref.goalId !== command.aggregateId) {
      return { status: "invalid", reason: "Goal version pin belongs to another goal" };
    }
    const key = canonicalRefKey(ref);
    if (seen.has(key)) return { status: "invalid", reason: "duplicate version pin" };
    seen.add(key);
    if (classified.kind === "project") normalized.project = revision;
    else if (classified.kind === "workspace") normalized.workspace = revision;
    // The legacy revision-0 Goal pin means "must not exist".
    else normalized.goal = revision === 0 ? null : revision;
  }
  return { status: "ok", pins: normalized };
}

export type ObservedGoalScopeVersions = {
  projectRevision: number;
  workspaceRevision: number;
  /** null = the Goal genuinely does not exist. */
  goalRevision: number | null;
};

export type GoalPinComparison =
  | { status: "ok" }
  | { status: "conflict"; current: { refKey: string; revision: number | null }[] };

/**
 * Compares the supplied pins against the versions read in THIS call. An omitted
 * pin uses the observed revision (never silently overwritten); a supplied pin is
 * enforced.
 */
export function compareCallerGoalPins(
  command: CreateGoalCommand,
  pins: CallerGoalPins,
  observed: ObservedGoalScopeVersions,
): GoalPinComparison {
  const current: { refKey: string; revision: number | null }[] = [];
  if (pins.project !== undefined && pins.project !== observed.projectRevision) {
    current.push({
      refKey: canonicalRefKey(projectRefFor(command.identity.projectId)),
      revision: observed.projectRevision,
    });
  }
  if (pins.workspace !== undefined && pins.workspace !== observed.workspaceRevision) {
    current.push({
      refKey: canonicalRefKey(workspaceRefFor(command.identity.projectId, command.payload.workspaceId)),
      revision: observed.workspaceRevision,
    });
  }
  if (pins.goal !== undefined) {
    const expected = pins.goal === null ? null : pins.goal;
    if (expected !== observed.goalRevision) {
      current.push({
        refKey: canonicalRefKey(goalRefFor(command.identity.projectId, command.aggregateId)),
        revision: observed.goalRevision,
      });
    }
  }
  return current.length === 0 ? { status: "ok" } : { status: "conflict", current };
}
