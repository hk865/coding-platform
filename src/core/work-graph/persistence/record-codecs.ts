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
import type {
  GoalDesiredState, GoalRef, GoalSnapshot, ProjectRef, ProjectSnapshot, WorkspaceRef, WorkspaceSnapshot,
} from "../../../contracts/ledger.js";
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
export const GOAL_DESIRED_STATE_CHANGED_EVENT_TYPE = "GoalDesiredStateChanged";
export const GOAL_DESIRED_STATE_CHANGED_EVENT_SCHEMA_VERSION = 1;

/** The three Goal-level controls (G7, GOAL-04…06). */
export type GoalControlKind = "pause" | "resume" | "cancel";

/**
 * GOAL-04…06 replay event. `desiredStateRevision` is the new Goal revision
 * (the fan-out epoch); `pausedEpoch` is the resumed pause's epoch on a resume
 * and null otherwise. `goal` is the exact snapshot written by the same commit.
 */
export type GoalDesiredStateChangedEvent = {
  eventId: string;
  eventType: typeof GOAL_DESIRED_STATE_CHANGED_EVENT_TYPE;
  schemaVersion: typeof GOAL_DESIRED_STATE_CHANGED_EVENT_SCHEMA_VERSION;
  occurredAt: string;
  identityKey: string;
  actor: Extract<ActorRef, { kind: "human" | "system" }>;
  fingerprint: string;
  control: GoalControlKind;
  from: GoalDesiredState;
  to: GoalDesiredState;
  desiredStateRevision: number;
  pausedEpoch: number | null;
  reason: string | null;
  goal: GoalSnapshot;
};

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

function isGoalDesiredState(value: unknown): value is GoalDesiredState {
  return value === "active" || value === "paused" || value === "cancelled";
}

/**
 * Pure shape check of one Goal snapshot body, shared by the record validator
 * and the `GoalDesiredStateChanged` replay event. D-9: `desiredState` is any of
 * the three stored values; `desiredStateRevision` and `desiredStateRequestedBy`
 * are absent on records written before A.2 (read as 1 / null).
 */
function goalSnapshotProblem(parsed: UnknownRecord): string | null {
  const ref = goalRefFromValue(parsed["ref"]);
  if (ref === null) return "Goal snapshot has no valid GoalRef";
  const workspaceRef = workspaceRefFromValue(parsed["workspaceRef"]);
  if (workspaceRef === null) return "Goal snapshot has no valid workspaceRef";
  if (workspaceRef.projectId !== ref.projectId) {
    return "Goal snapshot workspaceRef belongs to another project";
  }
  if (typeof parsed["objective"] !== "string") return "Goal snapshot objective must be a string";
  if (!isGoalDesiredState(parsed["desiredState"])) {
    return 'Goal snapshot desiredState must be "active", "paused" or "cancelled"';
  }
  const active = parsed["activePlanRevision"];
  if (active !== null) {
    const planRef = planRevisionRefFromValue(active, ref.projectId);
    if (planRef === null) return "Goal snapshot activePlanRevision is not a legal PlanRevisionRef";
  }
  const revision = parsed["revision"];
  // Goal's own encoding rule: revision >= 1 (0 never denotes an existing Goal).
  if (!isSafeRevision(revision) || revision < 1) {
    return "Goal snapshot revision must be a safe integer >= 1";
  }
  const desiredStateRevision = parsed["desiredStateRevision"];
  if (desiredStateRevision !== undefined
    && (!isSafeRevision(desiredStateRevision) || desiredStateRevision < 1 || desiredStateRevision > revision)) {
    return "Goal snapshot desiredStateRevision must be a safe integer between 1 and the Goal revision";
  }
  const requestedBy = parsed["desiredStateRequestedBy"];
  if (requestedBy !== undefined && requestedBy !== null) {
    const actor = actorFromValue(requestedBy);
    if (actor === null || actor.kind === "agent") {
      return "Goal snapshot desiredStateRequestedBy must be null or a Host (human/system) actor";
    }
  }
  return null;
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
  const problem = goalSnapshotProblem(parsed);
  if (problem !== null) return invalid(problem);
  const ref = goalRefFromValue(parsed["ref"])!;
  const revision = parsed["revision"];
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

const DESIRED_STATE_CHANGED_EVENT_KEYS: readonly string[] = [
  "eventId", "eventType", "schemaVersion", "occurredAt", "identityKey", "actor", "fingerprint",
  "control", "from", "to", "desiredStateRevision", "pausedEpoch", "reason", "goal",
];

function hasExactKeys(value: unknown, keys: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

/**
 * The Goal a `GoalDesiredStateChanged` event carries has no unknown or missing
 * field at any level, so a receipt replay can return it as the written
 * snapshot (shape-checked separately by `goalSnapshotProblem`).
 */
function writtenGoalHasExactShape(goal: UnknownRecord): boolean {
  return hasExactKeys(goal, [
    "ref", "workspaceRef", "objective", "desiredState", "desiredStateRevision", "desiredStateRequestedBy",
    "activePlanRevision", "revision",
  ])
    && hasExactKeys(goal["ref"], ["aggregateType", "projectId", "goalId"])
    && hasExactKeys(goal["workspaceRef"], ["aggregateType", "projectId", "workspaceId"])
    && (goal["activePlanRevision"] === null || hasExactKeys(goal["activePlanRevision"], ["aggregateType", "projectId", "planId"]))
    && (goal["desiredStateRequestedBy"] === null || hasExactKeys(goal["desiredStateRequestedBy"], ["kind", "id"]));
}

/** The legal `(control, from, to)` triples of GOAL-04…06 (D-9). */
function desiredStateChangeProblem(control: unknown, from: unknown, to: unknown): string | null {
  if (!isGoalDesiredState(from) || !isGoalDesiredState(to)) return "GoalDesiredStateChanged from/to must be Goal desired states";
  switch (control) {
    case "pause":
      return from === "active" && to === "paused" ? null : "a pause changes active to paused";
    case "resume":
      return from === "paused" && to === "active" ? null : "a resume changes paused to active";
    case "cancel":
      return from !== "cancelled" && to === "cancelled" ? null : "a cancel changes active or paused to cancelled";
    default:
      return "GoalDesiredStateChanged control must be pause, resume or cancel";
  }
}

/**
 * `GoalDesiredStateChanged` schemaVersion 1 (GOAL-04…06). It carries the exact
 * Goal snapshot written by the same commit, so a receipt replay restores the
 * original snapshot (including `desiredStateRequestedBy`, LA-7) instead of the
 * current one.
 */
function validateGoalDesiredStateChangedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  if (event.eventType !== GOAL_DESIRED_STATE_CHANGED_EVENT_TYPE) {
    return invalid(`expected eventType ${GOAL_DESIRED_STATE_CHANGED_EVENT_TYPE}, got ${event.eventType}`);
  }
  if (event.schemaVersion !== GOAL_DESIRED_STATE_CHANGED_EVENT_SCHEMA_VERSION) {
    return invalid(`expected schemaVersion ${GOAL_DESIRED_STATE_CHANGED_EVENT_SCHEMA_VERSION}, got ${event.schemaVersion}`);
  }
  if (!nonEmptyString(event.eventId)) return invalid("eventId must be a non-empty string");
  if (!nonEmptyString(event.occurredAt)) return invalid("occurredAt must be a non-empty string");
  const parsed = parseJsonObject(event.json, "GoalDesiredStateChanged event");
  if (typeof parsed === "string") return invalid(parsed);
  if (parsed["eventId"] !== event.eventId || parsed["eventType"] !== event.eventType
    || parsed["schemaVersion"] !== event.schemaVersion || parsed["occurredAt"] !== event.occurredAt) {
    return invalid("GoalDesiredStateChanged envelope disagrees with the event JSON");
  }
  if (!Object.keys(parsed).every((key) => DESIRED_STATE_CHANGED_EVENT_KEYS.includes(key))) {
    return invalid("GoalDesiredStateChanged carries unknown fields");
  }
  if (!nonEmptyString(parsed["identityKey"])) return invalid("GoalDesiredStateChanged identityKey must be a non-empty string");
  if (!nonEmptyString(parsed["fingerprint"])) return invalid("GoalDesiredStateChanged fingerprint must be a non-empty string");
  const actor = actorFromValue(parsed["actor"]);
  if (actor === null || actor.kind === "agent") return invalid("GoalDesiredStateChanged actor must be a Host (human/system) actor");
  const changeProblem = desiredStateChangeProblem(parsed["control"], parsed["from"], parsed["to"]);
  if (changeProblem !== null) return invalid(changeProblem);
  const desiredStateRevision = parsed["desiredStateRevision"];
  if (!isSafeRevision(desiredStateRevision) || desiredStateRevision < 2) {
    return invalid("GoalDesiredStateChanged desiredStateRevision must be a safe integer >= 2");
  }
  const pausedEpoch = parsed["pausedEpoch"];
  if (parsed["control"] === "resume") {
    if (!isSafeRevision(pausedEpoch) || pausedEpoch < 2 || pausedEpoch >= desiredStateRevision) {
      return invalid("a resume pausedEpoch must be the earlier pause desiredStateRevision");
    }
  } else if (pausedEpoch !== null) {
    return invalid("only a resume carries a pausedEpoch");
  }
  const reason = parsed["reason"];
  if (!(reason === null || nonEmptyString(reason))) return invalid("GoalDesiredStateChanged reason must be null or a non-empty string");
  const goal = parsed["goal"];
  if (!isRecord(goal)) return invalid("GoalDesiredStateChanged goal must be the written Goal snapshot");
  const goalProblem = goalSnapshotProblem(goal);
  if (goalProblem !== null) return invalid(`GoalDesiredStateChanged goal: ${goalProblem}`);
  if (!writtenGoalHasExactShape(goal)) {
    return invalid("GoalDesiredStateChanged goal must carry exactly the Goal snapshot fields");
  }
  if (goal["desiredState"] !== parsed["to"]) return invalid("GoalDesiredStateChanged goal desiredState disagrees with to");
  if (goal["desiredStateRevision"] !== desiredStateRevision || goal["revision"] !== desiredStateRevision) {
    return invalid("GoalDesiredStateChanged goal revision and desiredStateRevision must equal the event desiredStateRevision");
  }
  const requestedBy = actorFromValue(goal["desiredStateRequestedBy"]);
  if (requestedBy === null || requestedBy.kind !== actor.kind || requestedBy.id !== actor.id) {
    return invalid("GoalDesiredStateChanged goal desiredStateRequestedBy must be the event actor");
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
    {
      eventType: GOAL_DESIRED_STATE_CHANGED_EVENT_TYPE,
      schemaVersion: GOAL_DESIRED_STATE_CHANGED_EVENT_SCHEMA_VERSION,
      validate: validateGoalDesiredStateChangedEvent,
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
/**
 * A Goal whose desired state never changed (`desiredStateRevision` 1 or absent,
 * no requester) is written in its pre-A.2 shape, without the two D-9 fields.
 * Decoding reads them back as 1 / null, so the value round-trips, and a plan
 * adoption over a decoded legacy Goal keeps writing legacy bytes until
 * GOAL-04…06 record a real change (§15 step 1: no new values written yet).
 */
export function encodeGoalSnapshot(snapshot: GoalSnapshot): EncodedRecord {
  const { desiredStateRevision, desiredStateRequestedBy, ...legacyShape } = snapshot;
  const neverChanged = (desiredStateRevision === undefined || desiredStateRevision === 1)
    && (desiredStateRequestedBy === undefined || desiredStateRequestedBy === null);
  return {
    refKey: canonicalRefKey(snapshot.ref),
    schemaId: GOAL_SNAPSHOT_SCHEMA_ID,
    revision: snapshot.revision,
    json: JSON.stringify(neverChanged ? legacyShape : snapshot),
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
  const requestedBy = parsed.desiredStateRequestedBy;
  return {
    status: "decoded",
    value: {
      ref,
      workspaceRef,
      // Returned verbatim: a historical objective is never re-normalized here.
      objective: parsed.objective,
      // D-9: the stored value; GoalCreated still writes only "active".
      desiredState: parsed.desiredState,
      // Absent before A.2: the Goal never changed its desired state (epoch 1,
      // no requester), so a legacy record reads as 1 / null (LA-7).
      desiredStateRevision: parsed.desiredStateRevision ?? 1,
      desiredStateRequestedBy:
        requestedBy === undefined || requestedBy === null ? null : actorFromValue(requestedBy),
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

export function encodeGoalDesiredStateChangedEvent(event: GoalDesiredStateChangedEvent): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}

export function decodeGoalDesiredStateChangedEvent(event: EncodedDomainEvent): DecodeResult<GoalDesiredStateChangedEvent> {
  const checked = validateGoalDesiredStateChangedEvent(event);
  if (checked.status !== "decoded") return checked;
  return { status: "decoded", value: JSON.parse(event.json) as GoalDesiredStateChangedEvent };
}

/**
 * The ORIGINAL snapshot written by a GOAL-04…06 commit, from its recorded
 * `GoalDesiredStateChanged` event (the receipt replay source, same role as
 * `goalSnapshotFromCreatedEvent`); never from the current Goal. The event
 * validator already holds `goal` to the exact snapshot shape and to the event's
 * `to`, revision and actor, so this returns a copy and sets no lifecycle field
 * itself (§14: those are written only through `state/`).
 */
export function goalSnapshotFromDesiredStateChangedEvent(event: GoalDesiredStateChangedEvent): GoalSnapshot {
  return structuredClone(event.goal);
}

/** Selects a registered record codec by the aggregateType of the full ref. */
export function recordSchemaForAggregateType(aggregateType: string): EncodedRecordSchema | undefined {
  return GOAL_RECORD_SCHEMAS.records.find((schema) => schema.aggregateType === aggregateType);
}
