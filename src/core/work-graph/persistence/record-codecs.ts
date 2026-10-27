/**
 * WorkGraph Goal record/event codecs — the ONE Goal-family registration.
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
import type { ActorRef, CommitCursor, GoalCreatedEvent } from "../../../contracts/command-event.js";
import {
  seqOfCommitCursor,
  type GoalDesiredState, type GoalRef, type GoalSnapshot, type PendingGoalSnapshot, type ProjectRef, type ProjectSnapshot,
  type WorkspaceRef, type WorkspaceSnapshot,
} from "../../../contracts/ledger.js";
import {
  DEFAULT_WORKSPACE_DECISION_SETTINGS_V1,
  type GoalSettingsV1,
  type WorkspaceDecisionSettingsV1,
} from "../../../contracts/goal-decisions.js";
import type { PlanRevisionRef } from "../../../contracts/plan.js";
import { canonicalJson, canonicalKey, type JsonValue } from "../../../contracts/fingerprint.js";
import { defineShape, f, type InferShape } from "../../../contracts/data-format.js";
import { GoalRefShape, SessionMessageRefShape } from "../../../contracts/data-format-refs.js";
import { checkShape } from "../../../contracts/validation/data-format.js";
import {
  invalid, isNonNeg, isRecord, nonEmpty, parseTaggedObject,
} from "../../../contracts/validation/common.js";
import type { DecodeResult, EncodedDomainEvent, EncodedRecord, EncodedRecordSchema, RecordBackendSchemas } from "../../record-store/ports.js";
import { encodeEventEnvelope } from "./event-envelope.js";

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
export function canonicalRefKey(ref: object): string {
  return canonicalKey(ref);
}

// --------------------------------------------------------------------------
// Pure shape helpers
// --------------------------------------------------------------------------

type UnknownRecord = Record<string, unknown>;

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
  if (!nonEmpty(value["id"])) return null;
  if (kind === "human" || kind === "system") return { kind, id: value["id"] };
  if (kind !== "agent") return null;
  const runRef = value["runRef"];
  if (!isRecord(runRef)) return null;
  if (!nonEmpty(runRef["projectId"])) return null;
  if (!nonEmpty(runRef["goalId"])) return null;
  if (!nonEmpty(runRef["runId"])) return null;
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
  if (!nonEmpty(value["projectId"])) return null;
  return { aggregateType: "Project", projectId: value["projectId"] };
}

function workspaceRefFromValue(value: unknown): WorkspaceRef | null {
  if (!isRecord(value)) return null;
  if (value["aggregateType"] !== "Workspace") return null;
  if (!nonEmpty(value["projectId"])) return null;
  if (!nonEmpty(value["workspaceId"])) return null;
  return {
    aggregateType: "Workspace",
    projectId: value["projectId"],
    workspaceId: value["workspaceId"],
  };
}

function goalRefFromValue(value: unknown): GoalRef | null {
  if (!isRecord(value)) return null;
  if (value["aggregateType"] !== "Goal") return null;
  if (!nonEmpty(value["projectId"])) return null;
  if (!nonEmpty(value["goalId"])) return null;
  return { aggregateType: "Goal", projectId: value["projectId"], goalId: value["goalId"] };
}

function planRevisionRefFromValue(value: unknown, projectId: string): PlanRevisionRef | null {
  if (!isRecord(value)) return null;
  if (value["aggregateType"] !== "PlanRevision") return null;
  if (!nonEmpty(value["projectId"])) return null;
  if (!nonEmpty(value["planId"])) return null;
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
  const parsed = parseTaggedObject(record.json, "Project snapshot");
  if (typeof parsed === "string") return invalid(parsed);
  const ref = projectRefFromValue(parsed["ref"]);
  if (ref === null) return invalid("Project snapshot has no valid ProjectRef");
  const revision = parsed["revision"];
  if (!isNonNeg(revision)) return invalid("Project snapshot revision must be a safe non-negative integer");
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
  const parsed = parseTaggedObject(record.json, "Workspace snapshot");
  if (typeof parsed === "string") return invalid(parsed);
  const ref = workspaceRefFromValue(parsed["ref"]);
  if (ref === null) return invalid("Workspace snapshot has no valid WorkspaceRef");
  const revision = parsed["revision"];
  if (!isNonNeg(revision)) {
    return invalid("Workspace snapshot revision must be a safe non-negative integer");
  }
  if (revision !== record.revision) {
    return invalid("Workspace snapshot outer revision disagrees with the JSON revision");
  }
  if (canonicalRefKey(ref) !== record.refKey) {
    return invalid("Workspace snapshot ref is not the outer canonical ref_key");
  }
  if (parsed["decisionSettings"] !== undefined) {
    const settingsProblem = workspaceDecisionSettingsProblem(parsed["decisionSettings"]);
    if (settingsProblem !== null) return invalid(settingsProblem);
  }
  if (parsed["lineSettings"] !== undefined) {
    const lineProblem = workspaceLineSettingsProblem(parsed["lineSettings"]);
    if (lineProblem !== null) return invalid(lineProblem);
  }
  return { status: "decoded", value: copyRecord(record) };
}

const NOTICE_CATEGORIES: readonly string[] = [
  "member_notice", "second_expiry", "handoff", "note_review",
  "undelivered_reply", "automatic_rework", "continuation",
];

/**
 * Pure `NoticePositionV1` shape check. A commit position carries the ledger
 * cursor bound at creation. It is not a new aggregate and is never written back
 * to an old record.
 */
function noticePositionProblem(value: unknown): string | null {
  if (!isRecord(value)) return "Workspace decisionSettings notice position must be an object";
  if (value["kind"] === "commit") {
    if (!hasExactKeys(value, ["kind", "cursor", "itemKey"])) {
      return "a commit notice position must carry exactly kind, cursor and itemKey";
    }
    const cursor = value["cursor"];
    if (!(typeof cursor === "string" && /^c\d{10}$/.test(cursor))) {
      return "a commit notice position cursor must be a CommitCursor";
    }
    return nonEmpty(value["itemKey"]) ? null : "a notice position itemKey must be a non-empty string";
  }
  return 'a notice position kind must be "commit"';
}

/** Pure `WorkspaceDecisionSettingsV1` shape check (missing field is handled by the caller). */
export function workspaceDecisionSettingsProblem(value: unknown): string | null {
  if (!hasExactKeys(value, ["schemaVersion", "noticeSeen"])) {
    return "Workspace decisionSettings must carry exactly schemaVersion and noticeSeen";
  }
  const parsed = value as UnknownRecord;
  if (parsed["schemaVersion"] !== 1) return "Workspace decisionSettings schemaVersion must be 1";
  const noticeSeen = parsed["noticeSeen"];
  if (!isRecord(noticeSeen)) return "Workspace decisionSettings noticeSeen must be an object";
  for (const key of Object.keys(noticeSeen)) {
    if (!NOTICE_CATEGORIES.includes(key)) {
      return "Workspace decisionSettings noticeSeen carries an unknown notice category";
    }
    const positionProblem = noticePositionProblem(noticeSeen[key]);
    if (positionProblem !== null) return positionProblem;
  }
  return null;
}

/**
 * Pure `WorkspaceLineSettingsV1` shape check (spec §2, L9). `schemaVersion` is
 * 1, each pin carries exactly a complete `sessionRef` and a non-empty
 * `pinnedAt`, a Session is pinned at most once, and the table holds at most 100
 * entries. A missing field is handled by the caller.
 */
export function workspaceLineSettingsProblem(value: unknown): string | null {
  if (!hasExactKeys(value, ["schemaVersion", "pinned"])) {
    return "Workspace lineSettings must carry exactly schemaVersion and pinned";
  }
  const parsed = value as UnknownRecord;
  if (parsed["schemaVersion"] !== 1) return "Workspace lineSettings schemaVersion must be 1";
  const pinned = parsed["pinned"];
  if (!Array.isArray(pinned)) return "Workspace lineSettings pinned must be an array";
  if (pinned.length > 100) return "Workspace lineSettings pinned must hold at most 100 items";
  const seen = new Set<string>();
  for (const item of pinned) {
    if (!hasExactKeys(item, ["sessionRef", "pinnedAt"])) {
      return "a pinned line must carry exactly sessionRef and pinnedAt";
    }
    const entry = item as UnknownRecord;
    const sessionRef = entry["sessionRef"];
    if (!hasExactKeys(sessionRef, ["projectId", "sessionId"])) {
      return "a pinned line sessionRef must be a complete SessionRef";
    }
    const ref = sessionRef as UnknownRecord;
    if (!nonEmpty(ref["projectId"]) || !nonEmpty(ref["sessionId"])) {
      return "a pinned line sessionRef must be a complete SessionRef";
    }
    if (!nonEmpty(entry["pinnedAt"])) return "a pinned line pinnedAt must be a non-empty string";
    const canonical = canonicalJson(sessionRef as JsonValue);
    if (seen.has(canonical)) return "Workspace lineSettings pins a Session more than once";
    seen.add(canonical);
  }
  return null;
}

function isGoalDesiredState(value: unknown): value is GoalDesiredState {
  return value === "active" || value === "paused" || value === "cancelled";
}

/**
 * The two copy fields of a Goal (slice-6-SPEC L12) as one field table: a Goal
 * not born as a copy holds `continuedFrom: null` and `copiedInterventions: []`.
 * The table checks the stored fields only; which versions the copy read is the
 * copy owner's.
 */
export const GoalCopyFieldsShape = defineShape({ name: "GoalSnapshot", fields: {
  continuedFrom: f.nullable(f.object({
    goal: f.ref(GoalRefShape), sourceRevision: f.integer({ min: 1 }),
    understanding: f.nullable(f.object({ noteId: f.string({ min: 1, unit: "codePoints" }), version: f.integer({ min: 1 }) })),
  })),
  copiedInterventions: f.array(f.ref(SessionMessageRefShape)),
} });

/**
 * The copy fields of a Goal body or of the GoalCreated payload that births it.
 * Only the two keys are handed to the table, so a missing one reads `is missing`.
 */
function goalCopyFieldsProblem(value: UnknownRecord): string | null {
  // Compile-time check: the table's type and the Goal's two copy fields are each
  // assignable to the other (otherwise `false` does not satisfy `true`).
  type Table = InferShape<(typeof GoalCopyFieldsShape)["fields"]>;
  type OfGoal = Pick<GoalSnapshot, "continuedFrom" | "copiedInterventions">;
  type MustHold<T extends true> = T;
  type TableMatchesGoal = MustHold<[Table, OfGoal] extends [OfGoal, Table] ? true : false>;
  const fields: UnknownRecord = {};
  for (const key of Object.keys(GoalCopyFieldsShape.fields)) {
    if (Object.hasOwn(value, key)) fields[key] = value[key];
  }
  return checkShape(GoalCopyFieldsShape, fields, "stored");
}

/**
 * Pure shape check of one Goal snapshot body, shared by the record validator
 * and the `GoalDesiredStateChanged` replay event. D-9: `desiredState` is any of
 * the three stored values; `desiredStateRevision` and `desiredStateRequestedBy`
 * are required (1 / null at creation).
 */
export function goalSnapshotProblem(parsed: UnknownRecord): string | null {
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
  if (!isNonNeg(revision) || revision < 1) {
    return "Goal snapshot revision must be a safe integer >= 1";
  }
  const desiredStateRevision = parsed["desiredStateRevision"];
  if (!isNonNeg(desiredStateRevision) || desiredStateRevision < 1 || desiredStateRevision > revision) {
    return "Goal snapshot desiredStateRevision must be a safe integer between 1 and the Goal revision";
  }
  const requestedBy = parsed["desiredStateRequestedBy"];
  if (requestedBy !== null) {
    const actor = actorFromValue(requestedBy);
    if (actor === null || actor.kind === "agent") {
      return "Goal snapshot desiredStateRequestedBy must be null or a Host (human/system) actor";
    }
  }
  // The §2.2 settings are written at birth: a record without them is refused,
  // never read as a default, and a corrupt ref/enum/float/negative order is
  // refused too.
  if (!Object.hasOwn(parsed, "settings")) return "Goal snapshot settings is missing";
  const settingsProblem = goalSettingsProblem(parsed["settings"], ref.projectId);
  if (settingsProblem !== null) return settingsProblem;
  const copyProblem = goalCopyFieldsProblem(parsed);
  if (copyProblem !== null) return copyProblem;
  // The creation cursor is bound by the creating commit; a record still holding
  // the null placeholder (or any other value) is not a readable Goal. The ledger's
  // own cursor rule decides the rest: ten digits and a sequence >= 1, so the zero
  // cursor no commit ever made is refused too. `seqOfCommitCursor` stringifies its
  // input, so the string boundary is checked first.
  const since = parsed["since"];
  if (typeof since !== "string") return "Goal snapshot since must be a CommitCursor";
  try {
    seqOfCommitCursor(since as CommitCursor);
  } catch {
    return "Goal snapshot since must be a CommitCursor";
  }
  return null;
}

const GOAL_SETTINGS_KEYS: readonly string[] = [
  "schemaVersion", "autonomy", "order", "waitForGoalRef", "parallelRisks",
];
const GOAL_AUTONOMIES: readonly string[] = ["every_step", "after_plan_confirmation"];

/** Pure `GoalParallelRiskV1` shape check; both plan refs may be an explicit null. */
function goalParallelRiskProblem(value: unknown, projectId: string): string | null {
  if (!hasExactKeys(value, ["otherGoalRef", "selfPlanRef", "otherPlanRef"])) {
    return "Goal settings parallelRisks entry must carry exactly otherGoalRef, selfPlanRef and otherPlanRef";
  }
  const risk = value as UnknownRecord;
  const other = goalRefFromValue(risk["otherGoalRef"]);
  if (other === null || other.projectId !== projectId) {
    return "Goal settings parallelRisks.otherGoalRef must be a GoalRef in this project";
  }
  for (const field of ["selfPlanRef", "otherPlanRef"]) {
    const planRef = risk[field];
    if (planRef !== null && planRevisionRefFromValue(planRef, projectId) === null) {
      return `Goal settings parallelRisks.${field} must be null or a PlanRevisionRef in this project`;
    }
  }
  return null;
}

/** Pure `GoalSettingsV1` shape check; the caller only invokes it for a present field. */
export function goalSettingsProblem(value: unknown, projectId: string): string | null {
  if (!hasExactKeys(value, GOAL_SETTINGS_KEYS)) {
    return "Goal snapshot settings must carry exactly the GoalSettingsV1 fields";
  }
  const settings = value as UnknownRecord;
  if (settings["schemaVersion"] !== 1) return "Goal settings schemaVersion must be 1";
  if (!GOAL_AUTONOMIES.includes(settings["autonomy"] as string)) {
    return "Goal settings autonomy is not a legal GoalAutonomyV1";
  }
  // order is a non-negative integer; a float or negative order is corrupt.
  if (!isNonNeg(settings["order"])) {
    return "Goal settings order must be a safe non-negative integer";
  }
  const wait = settings["waitForGoalRef"];
  if (wait !== null) {
    const waitRef = goalRefFromValue(wait);
    if (waitRef === null || waitRef.projectId !== projectId) {
      return "Goal settings waitForGoalRef must be null or a GoalRef in this project";
    }
  }
  const risks = settings["parallelRisks"];
  if (!Array.isArray(risks)) return "Goal settings parallelRisks must be an array";
  for (const risk of risks) {
    const riskProblem = goalParallelRiskProblem(risk, projectId);
    if (riskProblem !== null) return riskProblem;
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
  const parsed = parseTaggedObject(record.json, "Goal snapshot");
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
  if (!nonEmpty(event.eventId)) return invalid("eventId must be a non-empty string");
  if (!nonEmpty(event.occurredAt)) return invalid("occurredAt must be a non-empty string");
  const parsed = parseTaggedObject(event.json, "GoalCreated event");
  if (typeof parsed === "string") return invalid(parsed);
  if (parsed["eventId"] !== event.eventId) return invalid("outer eventId disagrees with the event JSON");
  if (parsed["eventType"] !== event.eventType) return invalid("outer eventType disagrees with the event JSON");
  if (parsed["schemaVersion"] !== event.schemaVersion) {
    return invalid("outer schemaVersion disagrees with the event JSON");
  }
  if (parsed["occurredAt"] !== event.occurredAt) {
    return invalid("outer occurredAt disagrees with the event JSON");
  }
  if (!nonEmpty(parsed["projectId"])) return invalid("GoalCreated projectId must be a non-empty string");
  if (!nonEmpty(parsed["workspaceId"])) return invalid("GoalCreated workspaceId must be a non-empty string");
  if (parsed["aggregateType"] !== "Goal") return invalid('GoalCreated aggregateType must be "Goal"');
  if (!nonEmpty(parsed["aggregateId"])) return invalid("GoalCreated aggregateId must be a non-empty string");
  if (parsed["aggregateRevision"] !== 1) return invalid("GoalCreated aggregateRevision must be 1");
  if (!nonEmpty(parsed["causationId"])) return invalid("GoalCreated causationId must be a non-empty string");
  if (!nonEmpty(parsed["correlationId"])) return invalid("GoalCreated correlationId must be a non-empty string");
  if (!nonEmpty(parsed["idempotencyKey"])) return invalid("GoalCreated idempotencyKey must be a non-empty string");
  if (actorFromValue(parsed["actor"]) === null) return invalid("GoalCreated actor is not a valid ActorRef");
  const payload = parsed["payload"];
  if (!isRecord(payload)) return invalid("GoalCreated payload must be an object");
  if (typeof payload["objective"] !== "string") return invalid("GoalCreated payload.objective must be a string");
  if (payload["desiredState"] !== "active") return invalid('GoalCreated payload.desiredState must be "active"');
  if (payload["activePlanRevision"] !== null) {
    return invalid("GoalCreated payload.activePlanRevision must be null");
  }
  // The birth fields: the event alone rebuilds the created Goal, so none of
  // them may be missing (no default stands in for an old event).
  if (!Object.hasOwn(payload, "settings")) return invalid("GoalCreated payload.settings is missing");
  const settingsProblem = goalSettingsProblem(payload["settings"], parsed["projectId"]);
  if (settingsProblem !== null) return invalid(`GoalCreated payload: ${settingsProblem}`);
  const copyProblem = goalCopyFieldsProblem(payload);
  if (copyProblem !== null) return invalid(`GoalCreated payload: ${copyProblem}`);
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
 * snapshot (shape-checked separately by `goalSnapshotProblem`, whose copy-field
 * table also refuses unknown keys inside the two copy fields).
 */
const WRITTEN_GOAL_KEYS: readonly string[] = [
  "ref", "workspaceRef", "objective", "desiredState", "desiredStateRevision", "desiredStateRequestedBy",
  "activePlanRevision", "revision", "settings", "continuedFrom", "copiedInterventions", "since",
];

function writtenGoalHasExactShape(goal: UnknownRecord): boolean {
  return hasExactKeys(goal, WRITTEN_GOAL_KEYS)
    && hasExactKeys(goal["ref"], ["aggregateType", "projectId", "goalId"])
    && hasExactKeys(goal["workspaceRef"], ["aggregateType", "projectId", "workspaceId"])
    && (goal["activePlanRevision"] === null || hasExactKeys(goal["activePlanRevision"], ["aggregateType", "projectId", "planId"]))
    && (goal["desiredStateRequestedBy"] === null || hasExactKeys(goal["desiredStateRequestedBy"], ["kind", "id"]))
    && hasExactKeys(goal["settings"], GOAL_SETTINGS_KEYS);
}

/**
 * Full `GoalSnapshot` value check for the write events: the record
 * validator's field rules plus the exact written field set.
 */
export function goalSnapshotValueProblem(value: unknown): string | null {
  if (!isRecord(value)) return "Goal value must be an object";
  const problem = goalSnapshotProblem(value);
  if (problem !== null) return problem;
  return writtenGoalHasExactShape(value) ? null : "Goal value must carry exactly the Goal snapshot fields";
}

/**
 * Full `WorkspaceSnapshot` value check for the write events: the exact
 * `ref`/`revision` plus an optional, validated `decisionSettings` and an
 * optional, validated `lineSettings`; a field that is absent stays absent (never
 * defaulted in).
 */
export function workspaceSnapshotValueProblem(value: unknown): string | null {
  if (!isRecord(value)) return "Workspace value must be an object";
  const hasSettings = Object.prototype.hasOwnProperty.call(value, "decisionSettings");
  const hasLineSettings = Object.prototype.hasOwnProperty.call(value, "lineSettings");
  const keys = ["ref", "revision"];
  if (hasSettings) keys.push("decisionSettings");
  if (hasLineSettings) keys.push("lineSettings");
  if (!hasExactKeys(value, keys)) {
    return "Workspace value must carry exactly its ref, revision and the optional decisionSettings/lineSettings";
  }
  const ref = workspaceRefFromValue(value["ref"]);
  if (ref === null) return "Workspace value has no valid WorkspaceRef";
  if (!isNonNeg(value["revision"])) return "Workspace value revision must be a safe non-negative integer";
  if (hasSettings) {
    const settingsProblem = workspaceDecisionSettingsProblem(value["decisionSettings"]);
    if (settingsProblem !== null) return settingsProblem;
  }
  if (hasLineSettings) {
    const lineProblem = workspaceLineSettingsProblem(value["lineSettings"]);
    if (lineProblem !== null) return lineProblem;
  }
  return null;
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
  if (!nonEmpty(event.eventId)) return invalid("eventId must be a non-empty string");
  if (!nonEmpty(event.occurredAt)) return invalid("occurredAt must be a non-empty string");
  const parsed = parseTaggedObject(event.json, "GoalDesiredStateChanged event");
  if (typeof parsed === "string") return invalid(parsed);
  if (parsed["eventId"] !== event.eventId || parsed["eventType"] !== event.eventType
    || parsed["schemaVersion"] !== event.schemaVersion || parsed["occurredAt"] !== event.occurredAt) {
    return invalid("GoalDesiredStateChanged envelope disagrees with the event JSON");
  }
  if (!Object.keys(parsed).every((key) => DESIRED_STATE_CHANGED_EVENT_KEYS.includes(key))) {
    return invalid("GoalDesiredStateChanged carries unknown fields");
  }
  if (!nonEmpty(parsed["identityKey"])) return invalid("GoalDesiredStateChanged identityKey must be a non-empty string");
  if (!nonEmpty(parsed["fingerprint"])) return invalid("GoalDesiredStateChanged fingerprint must be a non-empty string");
  const actor = actorFromValue(parsed["actor"]);
  if (actor === null || actor.kind === "agent") return invalid("GoalDesiredStateChanged actor must be a Host (human/system) actor");
  const changeProblem = desiredStateChangeProblem(parsed["control"], parsed["from"], parsed["to"]);
  if (changeProblem !== null) return invalid(changeProblem);
  const desiredStateRevision = parsed["desiredStateRevision"];
  if (!isNonNeg(desiredStateRevision) || desiredStateRevision < 2) {
    return invalid("GoalDesiredStateChanged desiredStateRevision must be a safe integer >= 2");
  }
  const pausedEpoch = parsed["pausedEpoch"];
  if (parsed["control"] === "resume") {
    if (!isNonNeg(pausedEpoch) || pausedEpoch < 2 || pausedEpoch >= desiredStateRevision) {
      return invalid("a resume pausedEpoch must be the earlier pause desiredStateRevision");
    }
  } else if (pausedEpoch !== null) {
    return invalid("only a resume carries a pausedEpoch");
  }
  const reason = parsed["reason"];
  if (!(reason === null || nonEmpty(reason))) return invalid("GoalDesiredStateChanged reason must be null or a non-empty string");
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
  // The creating commit binds the creation cursor; every later write carries it.
  commitCursorFields: ["since"],
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
 * as given (no added `schemaId`, no re-normalization), including both D-9
 * fields, so an unchanged Goal keeps its current written shape.
 */
export function encodeGoalSnapshot(snapshot: PendingGoalSnapshot): EncodedRecord {
  return {
    refKey: canonicalRefKey(snapshot.ref),
    schemaId: GOAL_SNAPSHOT_SCHEMA_ID,
    revision: snapshot.revision,
    json: JSON.stringify(snapshot),
  };
}

export function encodeGoalCreatedEvent(event: GoalCreatedEvent): EncodedDomainEvent {
  return encodeEventEnvelope(event);
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
  const decisionSettings = parsed.decisionSettings;
  const lineSettings = parsed.lineSettings;
  return {
    status: "decoded",
    value: {
      ref,
      revision: record.revision,
      // Present stays byte-identical; absent stays absent (no default is stored).
      ...(decisionSettings === undefined ? {} : { decisionSettings }),
      ...(lineSettings === undefined ? {} : { lineSettings }),
    },
  };
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
      desiredStateRevision: parsed.desiredStateRevision,
      desiredStateRequestedBy: requestedBy === null ? null : actorFromValue(requestedBy),
      activePlanRevision:
        active === null ? null : planRevisionRefFromValue(active, ref.projectId),
      revision: record.revision,
      // The validated settings and copy fields, as stored.
      settings: parsed.settings,
      continuedFrom: parsed.continuedFrom,
      copiedInterventions: parsed.copiedInterventions,
      // The validated creation cursor, not the envelope's revision.
      since: parsed.since,
    },
  };
}

/** The Goal's saved settings (spec §2.2), exactly as stored; every Goal carries them from birth. */
export function readGoalSettings(goal: GoalSnapshot): GoalSettingsV1 {
  return goal.settings;
}

/**
 * The default-applying read helper (spec §2.2): returns the saved Workspace
 * decision settings or the exact §2.2 defaults for an old Workspace record.
 */
export function effectiveWorkspaceDecisionSettings(workspace: WorkspaceSnapshot): WorkspaceDecisionSettingsV1 {
  return workspace.decisionSettings === undefined
    ? structuredClone(DEFAULT_WORKSPACE_DECISION_SETTINGS_V1)
    : workspace.decisionSettings;
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
        settings: parsed.payload.settings,
        continuedFrom: parsed.payload.continuedFrom,
        copiedInterventions: parsed.payload.copiedInterventions,
      },
    },
  };
}

/**
 * Rebuilds the ORIGINAL creation snapshot from the recorded `GoalCreated`
 * event — never from a retry payload, the current snapshot or the current
 * clock (R3a §6). The event is the only historical record of the created Goal.
 * The creation cursor comes from the receipt that points at that event, so the
 * event JSON keeps the shape it was written with.
 */
export function goalSnapshotFromCreatedEvent(event: GoalCreatedEvent): PendingGoalSnapshot {
  return {
    ref: { aggregateType: "Goal", projectId: event.projectId, goalId: event.aggregateId },
    workspaceRef: {
      aggregateType: "Workspace",
      projectId: event.projectId,
      workspaceId: event.workspaceId,
    },
    objective: event.payload.objective,
    desiredState: event.payload.desiredState,
    desiredStateRevision: 1,
    desiredStateRequestedBy: null,
    activePlanRevision: event.payload.activePlanRevision,
    revision: 1,
    settings: event.payload.settings,
    continuedFrom: event.payload.continuedFrom,
    copiedInterventions: event.payload.copiedInterventions,
    since: null,
  };
}

export function encodeGoalDesiredStateChangedEvent(event: GoalDesiredStateChangedEvent): EncodedDomainEvent {
  return encodeEventEnvelope(event);
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
