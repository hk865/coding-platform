/**
 * Command/Event Interface — Goal create slice, frozen baseline for P1-00.
 * Authority: dev_docs/interfaces/command-event.md (slice types, v1).
 * P1-00 extensions (bootstrap) live in ./bootstrap.ts and ./events.ts.
 */
import type { Opaque } from "./opaque.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";

export type CommitCursor = Opaque<string, "CommitCursor">;
export type CommandFingerprint = Opaque<string, "CommandFingerprint">;

export type ActorRef = {
  kind: "human" | "system";
  id: string;
};

export type CommandIdentity = {
  projectId: string;
  actor: ActorRef;
  idempotencyKey: string;
};

export type CreateGoalCommand = {
  commandId: string;
  commandType: "CreateGoal";
  schemaVersion: 1;
  identity: CommandIdentity;
  /** local goalId, scoped to identity.projectId */
  aggregateId: string;
  expectedRevision: 0;
  correlationId: string;
  submittedAt: string;
  payload: {
    workspaceId: string;
    objective: string;
  };
};

export type CommandEnvelope = CreateGoalCommand;

export type CommandReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      aggregateRevision: 1;
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | {
      status: "rejected";
      commandId: string;
      code:
        | "invalid"
        | "not_found"
        | "revision_conflict"
        | "idempotency_conflict"
        | "unavailable";
      currentRevision?: number;
    };

export type GoalCreatedEvent = {
  eventId: string;
  eventType: "GoalCreated";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "Goal";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    objective: string;
    desiredState: "active";
    activePlanRevision: null;
  };
};

/**
 * Unicode NFC + trim of leading/trailing Unicode whitespace. Internal
 * characters are unchanged. Applied BEFORE fingerprinting; the normalized
 * objective is the value stored in Event payload and GoalSnapshot.
 */
export function normalizeObjective(raw: string): string {
  return raw.normalize("NFC").replace(/^\s+|\s+$/gu, "");
}

/** Command fingerprint shape per Command/Event Interface (JCS + SHA-256). */
export function commandFingerprint(
  command: Pick<
    CreateGoalCommand,
    | "commandType"
    | "schemaVersion"
    | "identity"
    | "aggregateId"
    | "expectedRevision"
    | "payload"
  >,
): CommandFingerprint {
  const shape = {
    schemaVersion: command.schemaVersion,
    commandType: command.commandType,
    projectId: command.identity.projectId,
    aggregateId: command.aggregateId,
    expectedRevision: command.expectedRevision,
    payload: {
      workspaceId: command.payload.workspaceId,
      objective: normalizeObjective(command.payload.objective),
    },
  };
  return sha256Hex(canonicalJson(shape)) as CommandFingerprint;
}

/**
 * Canonical key of a CommandIdentity. Equality is exactly
 * (projectId, actor.kind, actor.id, idempotencyKey).
 */
export function commandIdentityKey(identity: CommandIdentity): string {
  return canonicalJson({
    projectId: identity.projectId,
    actor: identity.actor,
    idempotencyKey: identity.idempotencyKey,
  });
}

export function commandIdentityEqual(a: CommandIdentity, b: CommandIdentity): boolean {
  return commandIdentityKey(a) === commandIdentityKey(b);
}
