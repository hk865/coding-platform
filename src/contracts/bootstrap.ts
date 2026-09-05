/**
 * Workspace bootstrap contracts — created by P1-00.
 * These are versioned extensions of the Goal-create slice:
 *  - project/workspace-scoped, ledger-wide initialization command;
 *  - request identity is project-SCOPED for CreateGoal but bootstrap spans
 *    multiple projects, so bootstrap uses its own BootstrapCommandIdentity;
 *  - fingerprint per ticket rules; manifest is deterministic from the
 *    normalized source digest.
 */
import type { ActorRef, CommitCursor, CommandFingerprint } from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type { VersionedRef } from "./ledger.js";
import type { Opaque } from "./opaque.js";

export type BootstrapCommandIdentity = {
  actor: ActorRef;
  idempotencyKey: string;
};

export type WorkspaceBootstrapEntry = {
  projectId: string;
  workspaceId: string;
};

export type WorkspaceBootstrapFixtureV1 = {
  schemaVersion: 1;
  entries: WorkspaceBootstrapEntry[];
};

export type WorkspaceBootstrapCommand = {
  commandId: string;
  commandType: "WorkspaceBootstrap";
  schemaVersion: 1;
  identity: BootstrapCommandIdentity;
  correlationId: string;
  submittedAt: string;
  payload: {
    sourceDigest: string;
    entries: WorkspaceBootstrapEntry[];
  };
};

export type BootstrapManifestEntry = {
  projectId: string;
  workspaceId: string;
  projectRevision: 1;
  workspaceRevision: 1;
};

export type WorkspaceBootstrapManifest = {
  schemaVersion: 1;
  sourceDigest: string;
  bootstrapRevision: 1;
  entries: BootstrapManifestEntry[];
};

export type WorkspaceBootstrapReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      manifest: WorkspaceBootstrapManifest;
      aggregateRevisions: VersionedRef[];
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | {
      status: "rejected";
      commandId: string;
      code:
        | "invalid"
        | "digest_mismatch"
        | "not_empty"
        | "idempotency_conflict"
        | "unavailable";
    };

export type ProjectBootstrappedEventV1 = {
  eventId: string;
  eventType: "ProjectBootstrapped";
  schemaVersion: 1;
  projectId: string;
  aggregateType: "Project";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    sourceDigest: string;
  };
};

export type WorkspaceBootstrappedEventV1 = {
  eventId: string;
  eventType: "WorkspaceBootstrapped";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "Workspace";
  /** local workspaceId, scoped to projectId */
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    sourceDigest: string;
  };
};

export type BootstrapManifestRef = {
  aggregateType: "BootstrapManifest";
  /** derived from the canonical source digest; stable across replays */
  manifestId: string;
};

export type BootstrapManifestSnapshot = {
  ref: BootstrapManifestRef;
  revision: 1;
  schemaVersion: 1;
  sourceDigest: string;
  bootstrapRevision: 1;
  entries: BootstrapManifestEntry[];
};

export type BootstrapManifestId = Opaque<string, "BootstrapManifestId">;

/** Canonical source digest: SHA-256 of JCS({schemaVersion, entries}). */
export function bootstrapSourceDigest(fixture: WorkspaceBootstrapFixtureV1): string {
  return sha256Hex(
    canonicalJson({ schemaVersion: fixture.schemaVersion, entries: fixture.entries }),
  );
}

/** Bootstrap fingerprint shape (analogous to CreateGoal fingerprint). */
export function bootstrapFingerprint(command: WorkspaceBootstrapCommand): CommandFingerprint {
  const shape = {
    schemaVersion: command.schemaVersion,
    commandType: command.commandType,
    sourceDigest: command.payload.sourceDigest,
    entries: command.payload.entries,
  };
  return sha256Hex(canonicalJson(shape)) as CommandFingerprint;
}

export function bootstrapIdentityKey(identity: BootstrapCommandIdentity): string {
  return canonicalJson({ actor: identity.actor, idempotencyKey: identity.idempotencyKey });
}

export const DEFAULT_BOOTSTRAP_ACTOR: ActorRef = Object.freeze({
  kind: "system",
  id: "workspace-bootstrap",
});

export type BuildBootstrapCommandDeps = {
  commandId: string;
  correlationId: string;
  submittedAt: string;
  actor?: ActorRef;
  idempotencyKey?: string;
};

/** Build the bootstrap command from a validated fixture (digest computed). */
export function buildBootstrapCommand(
  fixture: WorkspaceBootstrapFixtureV1,
  deps: BuildBootstrapCommandDeps,
): WorkspaceBootstrapCommand {
  const sourceDigest = bootstrapSourceDigest(fixture);
  return {
    commandId: deps.commandId,
    commandType: "WorkspaceBootstrap",
    schemaVersion: 1,
    identity: {
      actor: deps.actor ?? DEFAULT_BOOTSTRAP_ACTOR,
      idempotencyKey: deps.idempotencyKey ?? `bootstrap:${sourceDigest}`,
    },
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: {
      sourceDigest,
      entries: [...fixture.entries],
    },
  };
}

/** Deterministic manifest projection from the committed manifest snapshot. */
export function manifestFromSnapshot(
  snapshot: BootstrapManifestSnapshot,
): WorkspaceBootstrapManifest {
  return {
    schemaVersion: snapshot.schemaVersion,
    sourceDigest: snapshot.sourceDigest,
    bootstrapRevision: snapshot.bootstrapRevision,
    entries: snapshot.entries.map((e) => ({ ...e })),
  };
}
