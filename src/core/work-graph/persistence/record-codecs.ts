/**
 * WorkGraph Goal record/event codecs — the ONE registration this batch owns.
 *
 * R3a §2.3: the RecordStore has no `schemaId` column in the legacy
 * `snapshot_json` table, so it selects a codec from the `aggregateType` of the
 * full aggregate ref and must not hard-code Goal or blindly try every schema.
 * This file publishes the closed Goal-family registration plus the pure
 * encode/decode helpers used by the compiler and the typed repository.
 *
 * Boundaries (deliberately enforced here):
 *   - no I/O, no permission, no admission, no fold and no transaction: these
 *     callbacks only check pure encoding, shape, identity and version;
 *   - the original snapshot/event JSON is NOT extended with `schemaId` and no
 *     database column is added — `schemaId` is the ENCODING version selector
 *     (`...@1`), never an aggregate revision;
 *   - a historical `objective` is never re-normalized on read.
 */
import type { ActorRef, GoalCreatedEvent } from "../../../contracts/command-event.js";
import type { GoalRef, GoalSnapshot, ProjectRef, ProjectSnapshot, WorkspaceRef, WorkspaceSnapshot } from "../../../contracts/ledger.js";
import type { PlanRevisionRef } from "../../../contracts/plan.js";
import { canonicalJson, type JsonValue } from "../../../contracts/fingerprint.js";
import type { DecodeResult, EncodedDomainEvent, EncodedRecord, EncodedRecordSchema, RecordBackendSchemas } from "../../record-store/ports.js";

// --------------------------------------------------------------------------
// Fixed registration identifiers
// --------------------------------------------------------------------------

export const PROJECT_SNAPSHOT_SCHEMA_ID = "ProjectSnapshot@1";
export const WORKSPACE_SNAPSHOT_SCHEMA_ID = "WorkspaceSnapshot@1";
export const GOAL_SNAPSHOT_SCHEMA_ID = "GoalSnapshot@1";
export const GOAL_CREATED_EVENT_TYPE = "GoalCreated";
export const GOAL_CREATED_EVENT_SCHEMA_VERSION = 1;

/**
 * Canonical key of a FULL aggregate ref. The RecordStore keys snapshots by this
 * exact string (`ref_key`), never by a bare local id.
 */
export function canonicalRefKey(ref: GoalRef | ProjectRef | WorkspaceRef): string {
  return canonicalJson(ref as unknown as JsonValue);
}

// --------------------------------------------------------------------------
// Pure shape helpers
// --------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Generic revision: a safe non-negative integer (never a float, never NaN). */
function isSafeRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function invalid(reason: string): { status: "invalid"; reason: string } {
  return { status: "invalid", reason };
}

function parseJsonObject(json: string, what: string): UnknownRecord | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return `${what} is not valid JSON`;
  }
  if (!isRecord(parsed)) return `${what} JSON must be an object`;
  return parsed;
}

/** Deep-copies an actor so a stored event never aliases caller input. */
export function cloneActorRef(actor: ActorRef): ActorRef {
  if (actor.kind === "agent") {
    return { kind: "agent", id: actor.id, runRef: { ...actor.runRef } };
  }
  return { kind: actor.kind, id: actor.id };
}

/** Mirrors `contracts/validation/identity.ts::validateActor` exactly. */
function actorFromValue(value: unknown): ActorRef | null {
  if (!isRecord(value)) return null;
  const kind = value["kind"];
  if (!nonEmptyString(value["id"])) return null;
  if (kind === "human" || kind === "system") return { kind, id: value["id"] };
  if (kind !== "agent") return null;
  const runRef = value["runRef"];
  if (!isRecord(runRef)) return null;
  if (!nonEmptyString(runRef["projectId"])) return null;
  if (!nonEmptyString(runRef["goalId"])) return null;
  if (!nonEmptyString(runRef["runId"])) return null;
  return {
    kind: "agent",
    id: value["id"],
    runRef: {
      aggregateType: "Run",
      projectId: runRef["projectId"],
      goalId: runRef["goalId"],
      runId: runRef["runId"],
    },
  };
}

function projectRefFromValue(value: unknown): ProjectRef | null {
  if (!isRecord(value)) return null;
  if (value["aggregateType"] !== "Project") return null;
  if (!nonEmptyString(value["projectId"])) return null;
  return { aggregateType: "Project", projectId: value["projectId"] };
}

function workspaceRefFromValue(value: unknown): WorkspaceRef | null {
  if (!isRecord(value)) return null;
  if (value["aggregateType"] !== "Workspace") return null;
  if (!nonEmptyString(value["projectId"])) return null;
  if (!nonEmptyString(value["workspaceId"])) return null;
  return {
    aggregateType: "Workspace",
    projectId: value["projectId"],
    workspaceId: value["workspaceId"],
  };
}

function goalRefFromValue(value: unknown): GoalRef | null {
  if (!isRecord(value)) return null;
  if (value["aggregateType"] !== "Goal") return null;
  if (!nonEmptyString(value["projectId"])) return null;
  if (!nonEmptyString(value["goalId"])) return null;
  return { aggregateType: "Goal", projectId: value["projectId"], goalId: value["goalId"] };
}

function planRevisionRefFromValue(value: unknown, projectId: string): PlanRevisionRef | null {
  if (!isRecord(value)) return null;
  if (value["aggregateType"] !== "PlanRevision") return null;
  if (!nonEmptyString(value["projectId"])) return null;
  if (!nonEmptyString(value["planId"])) return null;
  // A legal PlanRevisionRef of THIS goal's project — a cross-project ref is not
  // a legal later Goal, it is a corrupt record.
  if (value["projectId"] !== projectId) return null;
  return { aggregateType: "PlanRevision", projectId: value["projectId"], planId: value["planId"] };
}

function copyRecord(record: EncodedRecord): EncodedRecord {
  return {
    refKey: record.refKey,
    schemaId: record.schemaId,
    revision: record.revision,
    json: record.json,
  };
}

function copyEvent(event: EncodedDomainEvent): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: event.json,
  };
}

// --------------------------------------------------------------------------
// Record validators
// --------------------------------------------------------------------------

function validateProjectSnapshot(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== PROJECT_SNAPSHOT_SCHEMA_ID) {
    return invalid(`expected schemaId ${PROJECT_SNAPSHOT_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const parsed = parseJsonObject(record.json, "Project snapshot");
  if (typeof parsed === "string") return invalid(parsed);
  const ref = projectRefFromValue(parsed["ref"]);
  if (ref === null) return invalid("Project snapshot has no valid ProjectRef");
  const revision = parsed["revision"];
  if (!isSafeRevision(revision)) return invalid("Project snapshot revision must be a safe non-negative integer");
  if (revision !== record.revision) {
    return invalid("Project snapshot outer revision disagrees with the JSON revision");
  }
  if (canonicalRefKey(ref) !== record.refKey) {
    return invalid("Project snapshot ref is not the outer canonical ref_key");
  }
  return { status: "decoded", value: copyRecord(record) };
}

function validateWorkspaceSnapshot(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== WORKSPACE_SNAPSHOT_SCHEMA_ID) {
    return invalid(`expected schemaId ${WORKSPACE_SNAPSHOT_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const parsed = parseJsonObject(record.json, "Workspace snapshot");
  if (typeof parsed === "string") return invalid(parsed);
  const ref = workspaceRefFromValue(parsed["ref"]);
  if (ref === null) return invalid("Workspace snapshot has no valid WorkspaceRef");
  const revision = parsed["revision"];
  if (!isSafeRevision(revision)) {
    return invalid("Workspace snapshot revision must be a safe non-negative integer");
  }
  if (revision !== record.revision) {
    return invalid("Workspace snapshot outer revision disagrees with the JSON revision");
  }
  if (canonicalRefKey(ref) !== record.refKey) {
    return invalid("Workspace snapshot ref is not the outer canonical ref_key");
  }
  return { status: "decoded", value: copyRecord(record) };
}

/**
 * `GoalSnapshot@1`. Accepts ANY legal Goal, including revision 2+ with a real
 * `PlanRevisionRef`: creation (revision 1, `activePlanRevision: null`) is
 * guaranteed by the compiler, and a read codec that rejected later revisions
 * would break every goal that already has an accepted plan.
 */
function validateGoalSnapshot(record: EncodedRecord): DecodeResult<EncodedRecord> {
  if (record.schemaId !== GOAL_SNAPSHOT_SCHEMA_ID) {
    return invalid(`expected schemaId ${GOAL_SNAPSHOT_SCHEMA_ID}, got ${record.schemaId}`);
  }
  const parsed = parseJsonObject(record.json, "Goal snapshot");
  if (typeof parsed === "string") return invalid(parsed);
  const ref = goalRefFromValue(parsed["ref"]);
  if (ref === null) return invalid("Goal snapshot has no valid GoalRef");
  const workspaceRef = workspaceRefFromValue(parsed["workspaceRef"]);
  if (workspaceRef === null) return invalid("Goal snapshot has no valid workspaceRef");
  if (workspaceRef.projectId !== ref.projectId) {
    return invalid("Goal snapshot workspaceRef belongs to another project");
  }
  if (typeof parsed["objective"] !== "string") return invalid("Goal snapshot objective must be a string");
  if (parsed["desiredState"] !== "active") return invalid('Goal snapshot desiredState must be "active"');
  const active = parsed["activePlanRevision"];
  if (active !== null) {
    const planRef = planRevisionRefFromValue(active, ref.projectId);
    if (planRef === null) return invalid("Goal snapshot activePlanRevision is not a legal PlanRevisionRef");
  }
  const revision = parsed["revision"];
  // Goal's own encoding rule: revision >= 1 (0 never denotes an existing Goal).
  if (!isSafeRevision(revision) || revision < 1) {
    return invalid("Goal snapshot revision must be a safe integer >= 1");
  }
  if (revision !== record.revision) {
    return invalid("Goal snapshot outer revision disagrees with the JSON revision");
  }
  if (canonicalRefKey(ref) !== record.refKey) {
    return invalid("Goal snapshot ref is not the outer canonical ref_key");
  }
  return { status: "decoded", value: copyRecord(record) };
}

/**
 * `GoalCreated` schemaVersion 1. The legacy event JSON carries no `schemaId`:
 * only the outer eventId/type/version/occurredAt must agree with the JSON.
 */
function validateGoalCreatedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  if (event.eventType !== GOAL_CREATED_EVENT_TYPE) {
    return invalid(`expected eventType ${GOAL_CREATED_EVENT_TYPE}, got ${event.eventType}`);
  }
  if (event.schemaVersion !== GOAL_CREATED_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${GOAL_CREATED_EVENT_SCHEMA_VERSION}, got ${event.schemaVersion}`);
  }
  if (!nonEmptyString(event.eventId)) return invalid("eventId must be a non-empty string");
  if (!nonEmptyString(event.occurredAt)) return invalid("occurredAt must be a non-empty string");
  const parsed = parseJsonObject(event.json, "GoalCreated event");
  if (typeof parsed === "string") return invalid(parsed);
  if (parsed["eventId"] !== event.eventId) return invalid("outer eventId disagrees with the event JSON");
  if (parsed["eventType"] !== event.eventType) return invalid("outer eventType disagrees with the event JSON");
  if (parsed["schemaVersion"] !== event.schemaVersion) {
    return invalid("outer schemaVersion disagrees with the event JSON");
  }
  if (parsed["occurredAt"] !== event.occurredAt) {
    return invalid("outer occurredAt disagrees with the event JSON");
  }
  if (!nonEmptyString(parsed["projectId"])) return invalid("GoalCreated projectId must be a non-empty string");
  if (!nonEmptyString(parsed["workspaceId"])) return invalid("GoalCreated workspaceId must be a non-empty string");
  if (parsed["aggregateType"] !== "Goal") return invalid('GoalCreated aggregateType must be "Goal"');
  if (!nonEmptyString(parsed["aggregateId"])) return invalid("GoalCreated aggregateId must be a non-empty string");
  if (parsed["aggregateRevision"] !== 1) return invalid("GoalCreated aggregateRevision must be 1");
  if (!nonEmptyString(parsed["causationId"])) return invalid("GoalCreated causationId must be a non-empty string");
  if (!nonEmptyString(parsed["correlationId"])) return invalid("GoalCreated correlationId must be a non-empty string");
  if (!nonEmptyString(parsed["idempotencyKey"])) return invalid("GoalCreated idempotencyKey must be a non-empty string");
  if (actorFromValue(parsed["actor"]) === null) return invalid("GoalCreated actor is not a valid ActorRef");
  const payload = parsed["payload"];
  if (!isRecord(payload)) return invalid("GoalCreated payload must be an object");
  if (typeof payload["objective"] !== "string") return invalid("GoalCreated payload.objective must be a string");
  if (payload["desiredState"] !== "active") return invalid('GoalCreated payload.desiredState must be "active"');
  if (payload["activePlanRevision"] !== null) {
    return invalid("GoalCreated payload.activePlanRevision must be null");
  }
  return { status: "decoded", value: copyEvent(event) };
}

// --------------------------------------------------------------------------
// The single registration
// --------------------------------------------------------------------------

const PROJECT_RECORD_SCHEMA: EncodedRecordSchema = {
  schemaId: PROJECT_SNAPSHOT_SCHEMA_ID,
  aggregateType: "Project",
  validate: validateProjectSnapshot,
};

const WORKSPACE_RECORD_SCHEMA: EncodedRecordSchema = {
  schemaId: WORKSPACE_SNAPSHOT_SCHEMA_ID,
  aggregateType: "Workspace",
  validate: validateWorkspaceSnapshot,
};

const GOAL_RECORD_SCHEMA: EncodedRecordSchema = {
  schemaId: GOAL_SNAPSHOT_SCHEMA_ID,
  aggregateType: "Goal",
  validate: validateGoalSnapshot,
};

/**
 * The frozen registration injected into every backend and the legacy ledger
 * adapters. Nothing else in the tree registers these selectors.
 */
export const GOAL_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [PROJECT_RECORD_SCHEMA, WORKSPACE_RECORD_SCHEMA, GOAL_RECORD_SCHEMA],
  events: [
    {
      eventType: GOAL_CREATED_EVENT_TYPE,
      schemaVersion: GOAL_CREATED_EVENT_SCHEMA_VERSION,
      validate: validateGoalCreatedEvent,
    },
  ],
};

// --------------------------------------------------------------------------
// Encode / decode helpers (used by the compiler, the repository and tests)
// --------------------------------------------------------------------------

export function encodeProjectSnapshot(snapshot: ProjectSnapshot): EncodedRecord {
  return {
    refKey: canonicalRefKey(snapshot.ref),
    schemaId: PROJECT_SNAPSHOT_SCHEMA_ID,
    revision: snapshot.revision,
    json: JSON.stringify(snapshot),
  };
}

export function encodeWorkspaceSnapshot(snapshot: WorkspaceSnapshot): EncodedRecord {
  return {
    refKey: canonicalRefKey(snapshot.ref),
    schemaId: WORKSPACE_SNAPSHOT_SCHEMA_ID,
    revision: snapshot.revision,
    json: JSON.stringify(snapshot),
  };
}

/**
 * Encodes the ORIGINAL `GoalSnapshot` JSON. The object is stringified exactly
 * as given (no added `schemaId`, no re-normalization), so a value produced by
 * the compiler stays byte-compatible with the legacy writer.
 */
export function encodeGoalSnapshot(snapshot: GoalSnapshot): EncodedRecord {
  return {
    refKey: canonicalRefKey(snapshot.ref),
    schemaId: GOAL_SNAPSHOT_SCHEMA_ID,
    revision: snapshot.revision,
    json: JSON.stringify(snapshot),
  };
}

export function encodeGoalCreatedEvent(event: GoalCreatedEvent): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}

export function decodeProjectSnapshot(record: EncodedRecord): DecodeResult<ProjectSnapshot> {
  const checked = validateProjectSnapshot(record);
  if (checked.status !== "decoded") return checked;
  const parsed = JSON.parse(record.json) as ProjectSnapshot;
  const ref = projectRefFromValue(parsed.ref)!;
  return { status: "decoded", value: { ref, revision: record.revision } };
}

export function decodeWorkspaceSnapshot(record: EncodedRecord): DecodeResult<WorkspaceSnapshot> {
  const checked = validateWorkspaceSnapshot(record);
  if (checked.status !== "decoded") return checked;
  const parsed = JSON.parse(record.json) as WorkspaceSnapshot;
  const ref = workspaceRefFromValue(parsed.ref)!;
  return { status: "decoded", value: { ref, revision: record.revision } };
}

export function decodeGoalSnapshot(record: EncodedRecord): DecodeResult<GoalSnapshot> {
  const checked = validateGoalSnapshot(record);
  if (checked.status !== "decoded") return checked;
  const parsed = JSON.parse(record.json) as GoalSnapshot;
  const ref = goalRefFromValue(parsed.ref)!;
  const workspaceRef = workspaceRefFromValue(parsed.workspaceRef)!;
  const active = parsed.activePlanRevision;
  return {
    status: "decoded",
    value: {
      ref,
      workspaceRef,
      // Returned verbatim: a historical objective is never re-normalized here.
      objective: parsed.objective,
      desiredState: "active",
      activePlanRevision:
        active === null ? null : planRevisionRefFromValue(active, ref.projectId),
      revision: record.revision,
    },
  };
}

export function decodeGoalCreatedEvent(event: EncodedDomainEvent): DecodeResult<GoalCreatedEvent> {
  const checked = validateGoalCreatedEvent(event);
  if (checked.status !== "decoded") return checked;
  const parsed = JSON.parse(event.json) as GoalCreatedEvent;
  const actor = actorFromValue(parsed.actor)!;
  return {
    status: "decoded",
    value: {
      eventId: event.eventId,
      eventType: GOAL_CREATED_EVENT_TYPE,
      schemaVersion: GOAL_CREATED_EVENT_SCHEMA_VERSION,
      projectId: parsed.projectId,
      workspaceId: parsed.workspaceId,
      aggregateType: "Goal",
      aggregateId: parsed.aggregateId,
      aggregateRevision: 1,
      causationId: parsed.causationId,
      correlationId: parsed.correlationId,
      idempotencyKey: parsed.idempotencyKey,
      actor,
      occurredAt: event.occurredAt,
      payload: {
        objective: parsed.payload.objective,
        desiredState: "active",
        activePlanRevision: null,
      },
    },
  };
}

/**
 * Rebuilds the ORIGINAL creation snapshot from the recorded `GoalCreated`
 * event — never from a retry payload, the current snapshot or the current
 * clock (R3a §6). The event is the only historical record of the created Goal.
 */
export function goalSnapshotFromCreatedEvent(event: GoalCreatedEvent): GoalSnapshot {
  return {
    ref: { aggregateType: "Goal", projectId: event.projectId, goalId: event.aggregateId },
    workspaceRef: {
      aggregateType: "Workspace",
      projectId: event.projectId,
      workspaceId: event.workspaceId,
    },
    objective: event.payload.objective,
    desiredState: event.payload.desiredState,
    activePlanRevision: event.payload.activePlanRevision,
    revision: 1,
  };
}

/** Selects a registered record codec by the aggregateType of the full ref. */
export function recordSchemaForAggregateType(aggregateType: string): EncodedRecordSchema | undefined {
  return GOAL_RECORD_SCHEMAS.records.find((schema) => schema.aggregateType === aggregateType);
}
