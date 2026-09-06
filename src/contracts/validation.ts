/**
 * Deterministic runtime schema validation for P1-00 contracts.
 * Validators never throw on input data; they return structured issues.
 * ControlEngine maps issues to rejection codes (documented mapping):
 *  - digest_mismatch -> "digest_mismatch"
 *  - anything else structural -> "invalid"
 */
import type { CreateGoalCommand } from "./command-event.js";
import { normalizeObjective } from "./command-event.js";
import type { WorkspaceBootstrapEntry } from "./bootstrap.js";
import { bootstrapSourceDigest } from "./bootstrap.js";
import { isKnownEventType } from "./events.js";
import { canonicalJson } from "./fingerprint.js";
import { RUNTIME_EVENT_TYPES, TERMINAL_RUNTIME_EVENT_TYPES } from "./dispatch.js";
import { TASK_ENVELOPE_MAX_SIZE_BYTES } from "./task-envelope.js";
import { EVIDENCE_KINDS, EVIDENCE_OUTCOMES, EVIDENCE_SUMMARY_MAX_BYTES } from "./evidence.js";
import {
  HANDOFF_MAX_ARTIFACT_REFS,
  HANDOFF_MAX_COMPLETED,
  HANDOFF_MAX_CONSTRAINTS,
  HANDOFF_MAX_EVIDENCE_REFS,
  HANDOFF_MAX_UNRESOLVED,
  HANDOFF_PACKET_MAX_BYTES,
  HANDOFF_SUMMARY_MAX_BYTES,
  REPLACEMENT_REASONS,
} from "./handoff.js";
import { CONFLICT_SCOPE_KINDS } from "./workspace-lease.js";
import {
  INTEGRATION_MAX_CONFLICTS,
  INTEGRATION_MAX_EXPLANATION_BYTES,
  INTEGRATION_MAX_GAPS,
  INTEGRATION_MAX_INPUTS,
} from "./integration.js";
import {
  PATCH_MAX_CHANGED_PATHS,
  PATCH_MAX_CHECK_RESULTS,
  PATCH_MAX_CHECK_SUMMARY_BYTES,
  PATCH_MAX_USED_INPUT_EVIDENCE,
} from "./patch.js";
import {
  CONTINUATION_SUMMARY_MAX_BYTES,
  EXECUTION_NOTE_KINDS,
  EXECUTION_NOTE_MAX_ALTERNATIVES,
  EXECUTION_NOTE_MAX_BYTES,
  EXECUTION_NOTE_MAX_SOURCE_REFS,
  EXECUTION_NOTE_REASON_MAX_BYTES,
  EXECUTION_NOTE_SUMMARY_MAX_BYTES,
  WORK_CONTEXT_MAX_RUN_LINKS,
  WORK_KINDS,
} from "./context-continuity.js";

export type ValidationIssueCode =
  | "missing_field"
  | "bad_type"
  | "unknown_schema_version"
  | "invalid_command_type"
  | "empty_entries"
  | "incomplete_scope"
  | "duplicate_identity"
  | "digest_mismatch"
  | "empty_objective"
  | "bad_expected_revision"
  | "unknown_event_type"
  | "bad_revision"
  | "invalid_fixture"
  | "empty_collection"
  | "conflict_unresolved"
  | "invalid_escalate"
  | "unknown_task_ref"
  | "unknown_stage_ref"
  | "unknown_obligation_ref"
  | "bad_scope"
  | "bad_enum"
  | "bad_sequence"
  | "size_exceeded"
  | "bad_binding_ref"
  | "bad_ref"
  | "unknown_field";

export type ValidationIssue = {
  path: string;
  code: ValidationIssueCode;
  message: string;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  record: UnknownRecord,
  key: string,
  issues: ValidationIssue[],
  displayPath: string = key,
): string | null {
  const value = record[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (value === undefined) {
    issues.push({ path: displayPath, code: "missing_field", message: `${displayPath} is required` });
  } else if (typeof value === "string") {
    issues.push({ path: displayPath, code: "missing_field", message: `${displayPath} must be a non-empty string` });
  } else {
    issues.push({ path: displayPath, code: "bad_type", message: `${displayPath} must be a string` });
  }
  return null;
}

export function validateActor(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: `${path} must be an object` });
    return;
  }
  const kind = value["kind"];
  if (kind !== "human" && kind !== "system") {
    issues.push({ path: `${path}.kind`, code: "bad_type", message: "kind must be human|system" });
  }
  stringField(value, "id", issues, `${path}.id`);
}

export function validateCommandIdentity(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: `${path} must be an object` });
    return;
  }
  stringField(value, "projectId", issues, `${path}.projectId`);
  validateActor(value["actor"], `${path}.actor`, issues);
  stringField(value, "idempotencyKey", issues, `${path}.idempotencyKey`);
}

export function validateCreateGoalCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "CreateGoalCommand must be an object" });
    return issues;
  }
  if (value["commandType"] !== "CreateGoal") {
    issues.push({
      path: "commandType",
      code: "invalid_command_type",
      message: 'commandType must be "CreateGoal"',
    });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({
      path: "schemaVersion",
      code: "unknown_schema_version",
      message: "only schemaVersion 1 is supported",
    });
  }
  stringField(value, "commandId", issues);
  validateCommandIdentity(value["identity"], "identity", issues);
  stringField(value, "aggregateId", issues);
  if (value["expectedRevision"] !== 0) {
    issues.push({
      path: "expectedRevision",
      code: "bad_expected_revision",
      message: "CreateGoal expectedRevision must be 0",
    });
  }
  stringField(value, "correlationId", issues);
  stringField(value, "submittedAt", issues);
  const payload = value["payload"];
  if (!isRecord(payload)) {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    return issues;
  }
  stringField(payload, "workspaceId", issues);
  const objective = stringField(payload, "objective", issues);
  if (objective !== null && normalizeObjective(objective).length === 0) {
    issues.push({
      path: "payload.objective",
      code: "empty_objective",
      message: "objective must be non-empty after NFC normalization + whitespace trim",
    });
  }
  return issues;
}

export function validateBootstrapEntries(
  entries: unknown,
  path: string,
  issues: ValidationIssue[],
): WorkspaceBootstrapEntry[] | null {
  if (!Array.isArray(entries)) {
    issues.push({ path, code: "bad_type", message: "entries must be an array" });
    return null;
  }
  if (entries.length === 0) {
    issues.push({ path, code: "empty_entries", message: "entries must be non-empty" });
  }
  const seenProjects = new Set<string>();
  const seenWorkspaces = new Set<string>();
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i] as unknown;
    const entryPath = `${path}[${i}]`;
    if (!isRecord(entry)) {
      issues.push({ path: entryPath, code: "bad_type", message: "entry must be an object" });
      continue;
    }
    const projectId = stringField(entry, "projectId", issues, `${entryPath}.projectId`);
    const workspaceId = stringField(entry, "workspaceId", issues, `${entryPath}.workspaceId`);
    if (projectId === null || workspaceId === null) {
      issues.push({
        path: entryPath,
        code: "incomplete_scope",
        message: "entry must carry full (projectId, workspaceId) scope",
      });
      continue;
    }
    const scopeKey = projectId + "\u0000" + workspaceId;
    if (seenProjects.has(projectId) || seenWorkspaces.has(scopeKey)) {
      issues.push({
        path: entryPath,
        code: "duplicate_identity",
        message: `duplicate project/workspace identity: ${projectId}/${workspaceId}`,
      });
    }
    seenProjects.add(projectId);
    seenWorkspaces.add(scopeKey);
  }
  return entries as WorkspaceBootstrapEntry[];
}

export function validateWorkspaceBootstrapFixture(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "WorkspaceBootstrapFixture must be an object" });
    return issues;
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({
      path: "schemaVersion",
      code: "unknown_schema_version",
      message: "only schemaVersion 1 is supported",
    });
  }
  validateBootstrapEntries(value["entries"], "entries", issues);
  return issues;
}

export function validateWorkspaceBootstrapCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "WorkspaceBootstrapCommand must be an object" });
    return issues;
  }
  if (value["commandType"] !== "WorkspaceBootstrap") {
    issues.push({
      path: "commandType",
      code: "invalid_command_type",
      message: 'commandType must be "WorkspaceBootstrap"',
    });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({
      path: "schemaVersion",
      code: "unknown_schema_version",
      message: "only schemaVersion 1 is supported",
    });
  }
  stringField(value, "commandId", issues);
  const identity = value["identity"];
  if (isRecord(identity)) {
    validateActor(identity["actor"], "identity.actor", issues);
    stringField(identity, "idempotencyKey", issues);
  } else {
    issues.push({ path: "identity", code: "bad_type", message: "identity must be an object" });
  }
  stringField(value, "correlationId", issues);
  stringField(value, "submittedAt", issues);
  const payload = value["payload"];
  if (!isRecord(payload)) {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    return issues;
  }
  const digest = stringField(payload, "sourceDigest", issues);
  const entries = validateBootstrapEntries(payload["entries"], "payload.entries", issues);
  if (digest !== null && entries !== null && !issues.some((i) => i.code === "empty_entries")) {
    const computed = bootstrapSourceDigest({ schemaVersion: 1, entries });
    if (computed !== digest) {
      issues.push({
        path: "payload.sourceDigest",
        code: "digest_mismatch",
        message: "sourceDigest does not match canonical digest of entries",
      });
    }
  }
  return issues;
}

export function validateDomainEvent(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "event must be an object" });
    return issues;
  }
  const eventType = value["eventType"];
  if (typeof eventType !== "string" || !isKnownEventType(eventType)) {
    issues.push({ path: "eventType", code: "unknown_event_type", message: "unknown eventType" });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({
      path: "schemaVersion",
      code: "unknown_schema_version",
      message: "only schemaVersion 1 is supported",
    });
  }
  stringField(value, "eventId", issues);
  stringField(value, "aggregateType", issues);
  stringField(value, "aggregateId", issues);
  const isActivationEvent =
    eventType === "CompletionPolicyActivated" ||
    eventType === "ArchitectureBaselineActivated" ||
    eventType === "RunEventRecorded" ||
    eventType === "RunOutcomeUnknown" ||
    eventType === "TaskReductionUpdated" ||
    eventType === "GoalPhaseUpdated" ||
    eventType === "WorkspaceReadLeaseReleased" ||
    eventType === "WorkspaceWriteLeaseReleased" ||
    eventType === "IntegrationJoined";
  // Creation events are always revision 1; activation aggregates advance (>= 1).
  if (!isActivationEvent && value["aggregateRevision"] !== 1) {
    issues.push({
      path: "aggregateRevision",
      code: "bad_type",
      message: "aggregateRevision must be 1 for v1 creation events",
    });
  }
  if (isActivationEvent && (!Number.isSafeInteger(value["aggregateRevision"]) || (value["aggregateRevision"] as number) < 1)) {
    issues.push({
      path: "aggregateRevision",
      code: "bad_type",
      message: "aggregateRevision must be a positive integer",
    });
  }
  stringField(value, "causationId", issues);
  stringField(value, "correlationId", issues);
  stringField(value, "idempotencyKey", issues);
  validateActor(value["actor"], "actor", issues);
  stringField(value, "occurredAt", issues);
  if (eventType === "GoalCreated") {
    stringField(value, "workspaceId", issues);
    const payload = value["payload"];
    if (isRecord(payload)) {
      const objective = stringField(payload, "objective", issues);
      if (objective !== null && normalizeObjective(objective).length === 0) {
        issues.push({
          path: "payload.objective",
          code: "empty_objective",
          message: "objective must be non-empty after normalization",
        });
      }
    } else {
      issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    }
  } else if (eventType === "WorkspaceBootstrapped" || eventType === "ProjectBootstrapped") {
    stringField(value, "projectId", issues);
    if (eventType === "WorkspaceBootstrapped") stringField(value, "workspaceId", issues);
  } else if (
    eventType === "CompletionPolicyInstalled" ||
    eventType === "ArchitectureBaselineInstalled" ||
    eventType === "CompletionPolicyActivated" ||
    eventType === "ArchitectureBaselineActivated" ||
    eventType === "PlanRevisionAccepted"
  ) {
    stringField(value, "projectId", issues);
    if (eventType === "PlanRevisionAccepted") stringField(value, "workspaceId", issues);
    const payload = value["payload"];
    if (!isRecord(payload)) {
      issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
      return issues;
    }
    if (eventType === "PlanRevisionAccepted") {
      stringField(payload, "goalId", issues, "payload.goalId");
      if (!Number.isSafeInteger(payload["goalAggregateRevision"]) || (payload["goalAggregateRevision"] as number) < 1) {
        issues.push({
          path: "payload.goalAggregateRevision",
          code: "bad_type",
          message: "goalAggregateRevision must be a positive integer",
        });
      }
      if (!isRecord(payload["planRevision"])) {
        issues.push({ path: "payload.planRevision", code: "bad_type", message: "planRevision must be an object" });
      }
    }
  } else if (eventType === "EvidenceAdmitted" || eventType === "TaskReductionUpdated" || eventType === "GoalPhaseUpdated") {
    stringField(value, "workspaceId", issues);
    const payload = value["payload"];
    if (!isRecord(payload)) {
      issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
      return issues;
    }
    stringField(payload, "goalId", issues, "payload.goalId");
    if (eventType === "EvidenceAdmitted") {
      stringField(payload, "taskId", issues, "payload.taskId");
      if (!isRecord(payload["evidence"])) {
        issues.push({ path: "payload.evidence", code: "bad_type", message: "evidence must be an object" });
      }
    } else if (eventType === "TaskReductionUpdated") {
      stringField(payload, "taskId", issues, "payload.taskId");
      if (!isRecord(payload["reduction"])) {
        issues.push({ path: "payload.reduction", code: "bad_type", message: "reduction must be an object" });
      }
    } else {
      if (!isRecord(payload["explanation"])) {
        issues.push({ path: "payload.explanation", code: "bad_type", message: "explanation must be an object" });
      }
      if (!isRecord(payload["sideEffectReconciliation"])) {
        issues.push({ path: "payload.sideEffectReconciliation", code: "bad_type", message: "sideEffectReconciliation must be an object" });
      }
    }
  } else if (eventType === "HandoffRecorded") {
    stringField(value, "workspaceId", issues);
    const payload = value["payload"];
    if (!isRecord(payload)) {
      issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
      return issues;
    }
    stringField(payload, "goalId", issues, "payload.goalId");
    stringField(payload, "taskId", issues, "payload.taskId");
    if (!isRecord(payload["packet"])) {
      issues.push({ path: "payload.packet", code: "bad_type", message: "packet must be an object" });
    }
    stringField(payload, "recordedAt", issues, "payload.recordedAt");
  } else if (eventType === "ReplacementClaimed") {
    stringField(value, "workspaceId", issues);
    const payload = value["payload"];
    if (!isRecord(payload)) {
      issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
      return issues;
    }
    stringField(payload, "goalId", issues, "payload.goalId");
    stringField(payload, "taskId", issues, "payload.taskId");
    if (!isRecord(payload["packetRef"])) {
      issues.push({ path: "payload.packetRef", code: "bad_type", message: "packetRef must be an object" });
    }
    if (!isRecord(payload["replacementRef"])) {
      issues.push({ path: "payload.replacementRef", code: "bad_type", message: "replacementRef must be an object" });
    }
    if (!isRecord(payload["priorAttemptRef"])) {
      issues.push({ path: "payload.priorAttemptRef", code: "bad_type", message: "priorAttemptRef must be an object" });
    }
    if (!isRecord(payload["priorRunRef"])) {
      issues.push({ path: "payload.priorRunRef", code: "bad_type", message: "priorRunRef must be an object" });
    }
    if (!isRecord(payload["attemptRef"])) {
      issues.push({ path: "payload.attemptRef", code: "bad_type", message: "attemptRef must be an object" });
    }
    if (!isRecord(payload["runRef"])) {
      issues.push({ path: "payload.runRef", code: "bad_type", message: "runRef must be an object" });
    }
    if (!isRecord(payload["outboxRef"])) {
      issues.push({ path: "payload.outboxRef", code: "bad_type", message: "outboxRef must be an object" });
    }
    validateEnum(payload["reason"], REPLACEMENT_REASONS, "payload.reason", issues);
    stringField(payload, "claimedAt", issues, "payload.claimedAt");
  } else if (
    eventType === "WorkspaceReadLeaseGranted" ||
    eventType === "WorkspaceReadLeaseReleased" ||
    eventType === "WorkspaceWriteLeaseGranted" ||
    eventType === "WorkspaceWriteLeaseReleased" ||
    eventType === "IntegrationJoined" ||
    eventType === "PatchRecorded"
  ) {
    stringField(value, "workspaceId", issues);
    const payload = value["payload"];
    if (!isRecord(payload)) {
      issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
      return issues;
    }
    if (eventType === "WorkspaceReadLeaseGranted" || eventType === "WorkspaceWriteLeaseGranted") {
      stringField(payload, "leaseId", issues, "payload.leaseId");
      if (!isRecord(payload["scope"])) {
        issues.push({ path: "payload.scope", code: "bad_type", message: "scope must be an object" });
      }
      if (!isRecord(payload["holder"])) {
        issues.push({ path: "payload.holder", code: "bad_type", message: "holder must be an object" });
      }
      if (payload["expiresAt"] !== null && typeof payload["expiresAt"] !== "string") {
        issues.push({ path: "payload.expiresAt", code: "bad_type", message: "expiresAt must be a string or null" });
      }
    } else if (eventType === "WorkspaceReadLeaseReleased" || eventType === "WorkspaceWriteLeaseReleased") {
      stringField(payload, "leaseId", issues, "payload.leaseId");
      stringField(payload, "releasedAt", issues, "payload.releasedAt");
      if (payload["releasedBy"] !== null && payload["releasedBy"] !== "holder") {
        issues.push({ path: "payload.releasedBy", code: "bad_type", message: "releasedBy must be holder or null" });
      }
      if (eventType === "WorkspaceWriteLeaseReleased") {
        validateEnum(payload["releasedVia"], ["explicit", "patch-record", "expiry-vacate"], "payload.releasedVia", issues);
        if (payload["postWriteWorkspaceRevision"] !== null && !Number.isSafeInteger(payload["postWriteWorkspaceRevision"])) {
          issues.push({ path: "payload.postWriteWorkspaceRevision", code: "bad_type", message: "postWriteWorkspaceRevision must be an integer or null" });
        }
      }
    } else if (eventType === "IntegrationJoined") {
      stringField(payload, "goalId", issues, "payload.goalId");
      stringField(payload, "taskId", issues, "payload.taskId");
      stringField(payload, "resultId", issues, "payload.resultId");
      if (!isRecord(payload["runRef"])) {
        issues.push({ path: "payload.runRef", code: "bad_type", message: "runRef must be an object" });
      }
      if (!Array.isArray(payload["conflicts"])) {
        issues.push({ path: "payload.conflicts", code: "bad_type", message: "conflicts must be an array" });
      }
      if (payload["explanation"] !== null && typeof payload["explanation"] !== "string") {
        issues.push({ path: "payload.explanation", code: "bad_type", message: "explanation must be a string or null" });
      }
      if (typeof payload["escalate"] !== "boolean") {
        issues.push({ path: "payload.escalate", code: "bad_type", message: "escalate must be a boolean" });
      }
    } else if (eventType === "PatchRecorded") {
      stringField(payload, "patchId", issues, "payload.patchId");
      stringField(payload, "goalId", issues, "payload.goalId");
      stringField(payload, "taskId", issues, "payload.taskId");
      stringField(payload, "title", issues, "payload.title");
      if (!Number.isSafeInteger(payload["beforeWorkspaceRevision"]) || !Number.isSafeInteger(payload["afterWorkspaceRevision"])) {
        issues.push({ path: "payload.workspaceRevisions", code: "bad_type", message: "workspace revisions must be integers" });
      }
      if (!Array.isArray(payload["changedPaths"])) {
        issues.push({ path: "payload.changedPaths", code: "bad_type", message: "changedPaths must be an array" });
      }
    }
  } else if (typeof eventType === "string" && isKnownEventType(eventType)) {
    // covered above by per-type field checks
    void 0;
  }
  return issues;
}

export function validateGoalViewQuery(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "GoalViewQuery must be an object" });
    return issues;
  }
  stringField(value, "projectId", issues);
  stringField(value, "workspaceId", issues);
  stringField(value, "goalId", issues);
  const atLeast = value["atLeastCursor"];
  if (atLeast !== undefined && typeof atLeast !== "string") {
    issues.push({
      path: "atLeastCursor",
      code: "bad_type",
      message: "atLeastCursor must be a CommitCursor string",
    });
  }
  return issues;
}

export function issuesToErrorMessage(issues: ValidationIssue[]): string {
  return issues.map((i) => `${i.path}: ${i.message} (${i.code})`).join("; ");
}

// ------------------------------------------------------------------------ //
// P1-02 validators: governance + plan commands / fixtures / drafts          //
// ------------------------------------------------------------------------ //

function safePositiveIntField(value: unknown, path: string, issues: ValidationIssue[]): number | null {
  if (Number.isSafeInteger(value) && (value as number) >= 1) return value as number;
  if (value === undefined) {
    issues.push({ path, code: "missing_field", message: path + " is required" });
  } else {
    issues.push({ path, code: "bad_revision", message: path + " must be a positive integer" });
  }
  return null;
}

function validateStringArray(value: unknown, path: string, issues: ValidationIssue[]): string[] | null {
  if (!Array.isArray(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be an array" });
    return null;
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) {
      issues.push({ path, code: "bad_type", message: path + " items must be non-empty strings" });
      return null;
    }
    out.push(item);
  }
  return out;
}

export function validateCompletionPolicyContent(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be an object" });
    return;
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: path + ".schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  const kinds = validateStringArray(value["requirementKinds"], path + ".requirementKinds", issues);
  if (kinds !== null && kinds.length === 0) {
    issues.push({
      path: path + ".requirementKinds",
      code: "empty_collection",
      message: "requirementKinds must be non-empty (a CompletionPolicy with no kinds cannot compile obligations)",
    });
  }
  safePositiveIntField(value["minimumRequiredRequirementsPerObligation"], path + ".minimumRequiredRequirementsPerObligation", issues);
  const fastPath = value["fastPathDiffClasses"];
  if (fastPath !== undefined) {
    validateStringArray(fastPath, path + ".fastPathDiffClasses", issues);
  }
}

export function validateArchitectureBaselineContent(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be an object" });
    return;
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: path + ".schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "description", issues, path + ".description");
  if (!Array.isArray(value["constraints"])) {
    issues.push({ path: path + ".constraints", code: "bad_type", message: "constraints must be an array" });
    return;
  }
  for (let i = 0; i < (value["constraints"] as unknown[]).length; i += 1) {
    const constraint = (value["constraints"] as unknown[])[i] as unknown;
    const cpath = path + ".constraints[" + i + "]";
    if (!isRecord(constraint)) {
      issues.push({ path: cpath, code: "bad_type", message: "constraint must be an object" });
      continue;
    }
    stringField(constraint, "name", issues, cpath + ".name");
    stringField(constraint, "scope", issues, cpath + ".scope");
  }
}

export function validateCompletionPolicyFixture(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "VersionedCompletionPolicyFixture must be an object" });
    return issues;
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  const identity = value["identity"];
  if (isRecord(identity)) {
    stringField(identity, "policyId", issues, "identity.policyId");
  } else {
    issues.push({ path: "identity", code: "bad_type", message: "identity must be an object" });
  }
  safePositiveIntField(value["revision"], "revision", issues);
  validateCompletionPolicyContent(value["content"], "content", issues);
  return issues;
}

export function validateArchitectureBaselineFixture(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "VersionedArchitectureBaselineFixture must be an object" });
    return issues;
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  const identity = value["identity"];
  if (isRecord(identity)) {
    stringField(identity, "baselineId", issues, "identity.baselineId");
  } else {
    issues.push({ path: "identity", code: "bad_type", message: "identity must be an object" });
  }
  safePositiveIntField(value["revision"], "revision", issues);
  validateArchitectureBaselineContent(value["content"], "content", issues);
  return issues;
}

function validateGovernanceInstallCommon(value: UnknownRecord, commandType: string, issues: ValidationIssue[]): void {
  if (value["commandType"] !== commandType) {
    issues.push({ path: "commandType", code: "invalid_command_type", message: "commandType must be " + JSON.stringify(commandType) });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "commandId", issues);
  validateCommandIdentity(value["identity"], "identity", issues);
  stringField(value, "correlationId", issues);
  stringField(value, "submittedAt", issues);
}

function validateContentDigest(value: UnknownRecord, path: string, issues: ValidationIssue[]): void {
  const digest = stringField(value, "contentDigest", issues, path + ".contentDigest");
  if (digest !== null && !/^[0-9a-f]{64}$/.test(digest)) {
    issues.push({ path: path + ".contentDigest", code: "bad_type", message: "contentDigest must be a lowercase sha256 hex string" });
  }
}

export function validateInstallCompletionPolicyRevisionCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "command must be an object" });
    return issues;
  }
  validateGovernanceInstallCommon(value, "InstallCompletionPolicyRevision", issues);
  const payload = value["payload"];
  if (isRecord(payload)) {
    validateCompletionPolicyFixture(payload["fixture"]);
    validateContentDigest(payload, "payload", issues);
  } else {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
  }
  return issues;
}

export function validateInstallArchitectureBaselineRevisionCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "command must be an object" });
    return issues;
  }
  validateGovernanceInstallCommon(value, "InstallArchitectureBaselineRevision", issues);
  const payload = value["payload"];
  if (isRecord(payload)) {
    validateArchitectureBaselineFixture(payload["fixture"]);
    validateContentDigest(payload, "payload", issues);
  } else {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
  }
  return issues;
}

function validatePin(value: unknown, path: string, issues: ValidationIssue[], kind: "policy" | "baseline"): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be an object" });
    return;
  }
  const ref = value["ref"];
  if (!isRecord(ref)) {
    issues.push({ path: path + ".ref", code: "bad_type", message: path + ".ref must be an object" });
    return;
  }
  if (ref["aggregateType"] !== (kind === "policy" ? "CompletionPolicyRevision" : "ArchitectureBaselineRevision")) {
    issues.push({ path: path + ".ref.aggregateType", code: "bad_type", message: "unexpected target aggregateType" });
  }
  stringField(ref, "projectId", issues, path + ".ref.projectId");
  stringField(ref, kind === "policy" ? "policyId" : "baselineId", issues, path + ".ref." + (kind === "policy" ? "policyId" : "baselineId"));
  safePositiveIntField(ref["revision"], path + ".ref.revision", issues);
  const digest = stringField(value, "digest", issues, path + ".digest");
  if (digest !== null && !/^[0-9a-f]{64}$/.test(digest)) {
    issues.push({ path: path + ".digest", code: "bad_type", message: "digest must be a lowercase sha256 hex string" });
  }
}

function validateActivateCommon(value: UnknownRecord, commandType: string, issues: ValidationIssue[]): void {
  if (value["commandType"] !== commandType) {
    issues.push({ path: "commandType", code: "invalid_command_type", message: "commandType must be " + JSON.stringify(commandType) });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "commandId", issues);
  validateCommandIdentity(value["identity"], "identity", issues);
  stringField(value, "aggregateId", issues);
  if (value["expectedRevision"] !== 0 && !Number.isSafeInteger(value["expectedRevision"])) {
    issues.push({ path: "expectedRevision", code: "bad_expected_revision", message: "expectedRevision must be a non-negative integer" });
  }
  stringField(value, "correlationId", issues);
  stringField(value, "submittedAt", issues);
}

export function validateActivateProjectCompletionPolicyCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "command must be an object" });
    return issues;
  }
  validateActivateCommon(value, "ActivateProjectCompletionPolicy", issues);
  const payload = value["payload"];
  if (isRecord(payload)) {
    validatePin(payload["target"], "payload.target", issues, "policy");
  } else {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
  }
  return issues;
}

export function validateActivateProjectArchitectureBaselineCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "command must be an object" });
    return issues;
  }
  validateActivateCommon(value, "ActivateProjectArchitectureBaseline", issues);
  const payload = value["payload"];
  if (isRecord(payload)) {
    validatePin(payload["target"], "payload.target", issues, "baseline");
  } else {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
  }
  return issues;
}

// ------------------------------------------------------------------------ //
// Plan draft / ApplyPlanRevision schema validation                          //
// ------------------------------------------------------------------------ //

function validateTaskScope(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be an object" });
    return;
  }
  const kind = value["kind"];
  if (kind === "goal") return;
  if (kind === "stage") {
    stringField(value, "stageId", issues, path + ".stageId");
    return;
  }
  if (kind === "module") {
    stringField(value, "stageId", issues, path + ".stageId");
    stringField(value, "moduleRef", issues, path + ".moduleRef");
    return;
  }
  issues.push({ path: path + ".kind", code: "bad_scope", message: "scope kind must be goal|stage|module" });
}

const REQUIREMENT_LEVELS = ["required", "optional"] as const;
const TASK_KINDS = ["work", "gate"] as const;
const DISPOSITIONS = ["active", "deferred", "cancelled", "superseded"] as const;
const PHASES = ["pending", "ready", "running", "verifying", "blocked", "satisfied", "failed"] as const;

function validateEnum(value: unknown, allowed: readonly string[], path: string, issues: ValidationIssue[]): void {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be one of " + allowed.join("|") });
  }
}

function validateRuntimeTask(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be an object" });
    return;
  }
  stringField(value, "taskId", issues, path + ".taskId");
  if (value["stageId"] !== undefined) stringField(value, "stageId", issues, path + ".stageId");
  stringField(value, "title", issues, path + ".title");
  validateEnum(value["requirementLevel"], REQUIREMENT_LEVELS, path + ".requirementLevel", issues);
  validateEnum(value["taskKind"], TASK_KINDS, path + ".taskKind", issues);
  validateEnum(value["disposition"], DISPOSITIONS, path + ".disposition", issues);
  validateEnum(value["phase"], PHASES, path + ".phase", issues);
  validateTaskScope(value["scope"], path + ".scope", issues);
}

function validateVerificationRequirement(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be an object" });
    return;
  }
  stringField(value, "requirementId", issues, path + ".requirementId");
  validateEnum(value["requirementLevel"], REQUIREMENT_LEVELS, path + ".requirementLevel", issues);
  stringField(value, "kind", issues, path + ".kind");
  stringField(value, "description", issues, path + ".description");
}

function validateAcceptanceObligation(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be an object" });
    return;
  }
  stringField(value, "obligationId", issues, path + ".obligationId");
  stringField(value, "title", issues, path + ".title");
  validateEnum(value["requirementLevel"], REQUIREMENT_LEVELS, path + ".requirementLevel", issues);
  if (!Array.isArray(value["taskIds"])) {
    issues.push({ path: path + ".taskIds", code: "bad_type", message: "taskIds must be an array" });
  } else {
    for (const taskId of value["taskIds"]) {
      if (typeof taskId !== "string" || taskId.length === 0) {
        issues.push({ path: path + ".taskIds", code: "bad_type", message: "taskIds items must be non-empty strings" });
        break;
      }
    }
  }
  if (!Array.isArray(value["verificationRequirements"])) {
    issues.push({ path: path + ".verificationRequirements", code: "bad_type", message: "verificationRequirements must be an array" });
  } else {
    for (let i = 0; i < (value["verificationRequirements"] as unknown[]).length; i += 1) {
      validateVerificationRequirement((value["verificationRequirements"] as unknown[])[i], path + ".verificationRequirements[" + i + "]", issues);
    }
  }
}

/** Validate the schema of a hand-authored plan draft (structural only). */
export function validatePlanRevisionDraft(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "PlanRevisionDraft must be an object" });
    return issues;
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "planId", issues);
  safePositiveIntField(value["planRevision"], "planRevision", issues);
  stringField(value, "goalId", issues);
  if (!Array.isArray(value["stages"]) || (value["stages"] as unknown[]).length === 0) {
    issues.push({ path: "stages", code: "empty_collection", message: "stages must be a non-empty array" });
  } else {
    for (let i = 0; i < (value["stages"] as unknown[]).length; i += 1) {
      const stage = (value["stages"] as unknown[])[i] as unknown;
      const spath = "stages[" + i + "]";
      if (!isRecord(stage)) {
        issues.push({ path: spath, code: "bad_type", message: "stage must be an object" });
        continue;
      }
      stringField(stage, "stageId", issues, spath + ".stageId");
      stringField(stage, "title", issues, spath + ".title");
    }
  }
  if (!Array.isArray(value["tasks"]) || (value["tasks"] as unknown[]).length === 0) {
    issues.push({ path: "tasks", code: "empty_collection", message: "tasks must be a non-empty array" });
  } else {
    for (let i = 0; i < (value["tasks"] as unknown[]).length; i += 1) {
      validateRuntimeTask((value["tasks"] as unknown[])[i], "tasks[" + i + "]", issues);
    }
  }
  if (!Array.isArray(value["obligations"]) || (value["obligations"] as unknown[]).length === 0) {
    issues.push({ path: "obligations", code: "empty_collection", message: "obligations must be a non-empty array" });
  } else {
    for (let i = 0; i < (value["obligations"] as unknown[]).length; i += 1) {
      validateAcceptanceObligation((value["obligations"] as unknown[])[i], "obligations[" + i + "]", issues);
    }
  }
  const hierarchy = value["taskHierarchy"];
  if (!isRecord(hierarchy)) {
    issues.push({ path: "taskHierarchy", code: "bad_type", message: "taskHierarchy must be an object" });
  } else if (!Array.isArray(hierarchy["parentOf"])) {
    issues.push({ path: "taskHierarchy.parentOf", code: "bad_type", message: "parentOf must be an array" });
  } else {
    for (let i = 0; i < (hierarchy["parentOf"] as unknown[]).length; i += 1) {
      const edge = (hierarchy["parentOf"] as unknown[])[i] as unknown;
      const epath = "taskHierarchy.parentOf[" + i + "]";
      if (!isRecord(edge)) {
        issues.push({ path: epath, code: "bad_type", message: "edge must be an object" });
        continue;
      }
      stringField(edge, "parentTaskId", issues, epath + ".parentTaskId");
      stringField(edge, "childTaskId", issues, epath + ".childTaskId");
    }
  }
  const dag = value["executionDag"];
  if (!isRecord(dag)) {
    issues.push({ path: "executionDag", code: "bad_type", message: "executionDag must be an object" });
  } else if (!Array.isArray(dag["dependsOn"])) {
    issues.push({ path: "executionDag.dependsOn", code: "bad_type", message: "dependsOn must be an array" });
  } else {
    for (let i = 0; i < (dag["dependsOn"] as unknown[]).length; i += 1) {
      const edge = (dag["dependsOn"] as unknown[])[i] as unknown;
      const epath = "executionDag.dependsOn[" + i + "]";
      if (!isRecord(edge)) {
        issues.push({ path: epath, code: "bad_type", message: "edge must be an object" });
        continue;
      }
      stringField(edge, "taskId", issues, epath + ".taskId");
      stringField(edge, "dependsOnId", issues, epath + ".dependsOnId");
      if (isRecord(edge["requires"])) {
        validateEnum(edge["requires"]!["kind"], ["output-contract", "artifact", "decision", "environment-revision", "gate-result"], epath + ".requires.kind", issues);
        stringField(edge["requires"] as UnknownRecord, "label", issues, epath + ".requires.label");
      } else {
        issues.push({ path: epath + ".requires", code: "bad_type", message: "requires must be an object" });
      }
    }
  }
  return issues;
}

export function validateApplyPlanRevisionCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "command must be an object" });
    return issues;
  }
  if (value["commandType"] !== "ApplyPlanRevision") {
    issues.push({ path: "commandType", code: "invalid_command_type", message: 'commandType must be "ApplyPlanRevision"' });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "commandId", issues);
  validateCommandIdentity(value["identity"], "identity", issues);
  stringField(value, "aggregateId", issues);
  if (value["expectedRevision"] !== 0 && !Number.isSafeInteger(value["expectedRevision"])) {
    issues.push({ path: "expectedRevision", code: "bad_expected_revision", message: "expectedRevision must be a non-negative integer" });
  }
  stringField(value, "correlationId", issues);
  stringField(value, "submittedAt", issues);
  const payload = value["payload"];
  if (isRecord(payload)) {
    issues.push(...validatePlanRevisionDraft(payload["plan"]).map((issue) => ({ ...issue, path: "payload.plan." + issue.path })));
  } else {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
  }
  return issues;
}
// ------------------------------------------------------------------------ //
// P1-03: dispatch / run command + envelope + runtime event validators        //
// ------------------------------------------------------------------------ //

function numberField(
  record: UnknownRecord,
  key: string,
  issues: ValidationIssue[],
  displayPath: string = key,
  min: number = 0,
): number | null {
  const value = record[key];
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= min) return value;
  issues.push({
    path: displayPath,
    code: "bad_sequence",
    message: displayPath + " must be a non-negative integer",
  });
  return null;
}

function stringArrayField(
  record: UnknownRecord,
  key: string,
  issues: ValidationIssue[],
  displayPath: string = key,
  allowEmpty: boolean = true,
): string[] | null {
  const value = record[key];
  if (Array.isArray(value) && value.every((v) => typeof v === "string" && v.length > 0)) {
    if (!allowEmpty && value.length === 0) {
      issues.push({
        path: displayPath,
        code: "bad_scope",
        message: displayPath + " must not be empty",
      });
      return null;
    }
    return [...value];
  }
  issues.push({
    path: displayPath,
    code: "bad_type",
    message: displayPath + " must be an array of non-empty strings",
  });
  return null;
}

export function validateRoleBindingRef(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be an object" });
    return;
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: path + ".schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "bindingId", issues, path + ".bindingId");
  stringField(value, "templateId", issues, path + ".templateId");
  stringField(value, "templateRevision", issues, path + ".templateRevision");
  numberField(value, "bindingVersion", issues, path + ".bindingVersion", 1);
  stringField(value, "policyRevision", issues, path + ".policyRevision");
}

export function validateTaskBudget(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be an object" });
    return;
  }
  numberField(value, "tokenBudget", issues, path + ".tokenBudget", 1);
  const deadline = value["deadline"];
  if (deadline !== null && typeof deadline !== "string") {
    issues.push({ path: path + ".deadline", code: "bad_type", message: "deadline must be a string or null" });
  }
}

function validateDeclaredPermissions(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be an object" });
    return;
  }
  stringArrayField(value, "tools", issues, path + ".tools");
  stringArrayField(value, "writeScope", issues, path + ".writeScope");
}

function validateRunRef(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be an object" });
    return;
  }
  stringField(value, "aggregateType", issues, path + ".aggregateType");
  stringField(value, "projectId", issues, path + ".projectId");
  stringField(value, "goalId", issues, path + ".goalId");
  stringField(value, "runId", issues, path + ".runId");
}

export function validateDispatchClaimCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "DispatchClaimCommand must be an object" });
    return issues;
  }
  if (value["commandType"] !== "DispatchClaimTask") {
    issues.push({ path: "commandType", code: "invalid_command_type", message: 'commandType must be "DispatchClaimTask"' });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "commandId", issues);
  validateCommandIdentity(value["identity"], "identity", issues);
  stringField(value, "aggregateId", issues);
  if (value["expectedRevision"] !== 0) {
    issues.push({ path: "expectedRevision", code: "bad_expected_revision", message: "P1-03 claim expectedRevision must be 0 (single lease)" });
  }
  stringField(value, "correlationId", issues);
  stringField(value, "submittedAt", issues);
  const payload = value["payload"];
  if (!isRecord(payload)) {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    return issues;
  }
  stringField(payload, "goalId", issues, "payload.goalId");
  stringField(payload, "attemptId", issues, "payload.attemptId");
  stringField(payload, "runId", issues, "payload.runId");
  validateRoleBindingRef(payload["roleBinding"], "payload.roleBinding", issues);
  validateDeclaredPermissions(payload["declaredPermissions"], "payload.declaredPermissions", issues);
  validateTaskBudget(payload["budget"], "payload.budget", issues);
  return issues;
}

export function validateDispatchStartCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "DispatchStartCommand must be an object" });
    return issues;
  }
  if (value["commandType"] !== "DispatchStartRun") {
    issues.push({ path: "commandType", code: "invalid_command_type", message: 'commandType must be "DispatchStartRun"' });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "commandId", issues);
  validateCommandIdentity(value["identity"], "identity", issues);
  stringField(value, "aggregateId", issues);
  numberField(value, "expectedRevision", issues, "expectedRevision", 1);
  stringField(value, "correlationId", issues);
  stringField(value, "submittedAt", issues);
  const payload = value["payload"];
  if (!isRecord(payload)) {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    return issues;
  }
  issues.push(
    ...validateTaskEnvelope(payload["envelope"]).map((issue) => ({ ...issue, path: "payload.envelope." + issue.path })),
  );
  issues.push(
    ...validateContextManifest(payload["manifest"]).map((issue) => ({ ...issue, path: "payload.manifest." + issue.path })),
  );
  return issues;
}

export function validateRunFactCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "RunFactCommand must be an object" });
    return issues;
  }
  if (value["commandType"] !== "RunFact") {
    issues.push({ path: "commandType", code: "invalid_command_type", message: 'commandType must be "RunFact"' });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "commandId", issues);
  validateCommandIdentity(value["identity"], "identity", issues);
  stringField(value, "aggregateId", issues);
  numberField(value, "expectedRevision", issues, "expectedRevision", 1);
  stringField(value, "correlationId", issues);
  stringField(value, "submittedAt", issues);
  const payload = value["payload"];
  if (!isRecord(payload)) {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    return issues;
  }
  const fact = payload["fact"];
  if (!isRecord(fact)) {
    issues.push({ path: "payload.fact", code: "bad_type", message: "fact must be an object" });
    return issues;
  }
  if (fact["kind"] === "runtime_event") {
    issues.push(
      ...validateRuntimeEvent(fact["event"]).map((issue) => ({ ...issue, path: "payload.fact.event." + issue.path })),
    );
  } else if (fact["kind"] === "outcome_unknown") {
    validateRunRef(fact["runRef"], "payload.fact.runRef", issues);
    stringField(fact, "reason", issues, "payload.fact.reason");
  } else {
    issues.push({ path: "payload.fact.kind", code: "bad_enum", message: 'kind must be "runtime_event" | "outcome_unknown"' });
  }
  // P1-03 decision (integrator ruling on lane-B gap 1): the fact carries its
  // full run identity; alignment with the command's projectId/aggregateId is
  // checked here so NO event-log scan is ever needed to resolve the Run.
  const runRef = fact["runRef"];
  const identity = isRecord(value["identity"]) ? value["identity"] : null;
  if (isRecord(runRef) && identity !== null) {
    if (runRef["projectId"] !== identity["projectId"]) {
      issues.push({ path: "payload.fact.runRef.projectId", code: "bad_ref", message: "runRef.projectId must equal identity.projectId" });
    }
    if (runRef["runId"] !== value["aggregateId"]) {
      issues.push({ path: "payload.fact.runRef.runId", code: "bad_ref", message: "runRef.runId must equal aggregateId" });
    }
  }
  return issues;
}

export function validateTaskEnvelope(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "TaskEnvelope must be an object" });
    return issues;
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "envelopeId", issues);
  stringField(value, "projectId", issues);
  stringField(value, "workspaceId", issues);
  stringField(value, "goalId", issues);
  stringField(value, "taskId", issues);
  validateRunRef(value["runRef"], "runRef", issues);
  const attemptRef = value["attemptRef"];
  if (isRecord(attemptRef)) {
    stringField(attemptRef, "aggregateType", issues, "attemptRef.aggregateType");
    stringField(attemptRef, "attemptId", issues, "attemptRef.attemptId");
  } else {
    issues.push({ path: "attemptRef", code: "bad_type", message: "attemptRef must be an object" });
  }
  const planRef = value["planRef"];
  if (isRecord(planRef)) {
    stringField(planRef, "aggregateType", issues, "planRef.aggregateType");
    stringField(planRef, "planId", issues, "planRef.planId");
  } else {
    issues.push({ path: "planRef", code: "bad_type", message: "planRef must be an object" });
  }
  validateRoleBindingRef(value["roleBinding"], "roleBinding", issues);
  const ws = value["workspaceSnapshot"];
  if (isRecord(ws)) {
    stringField(ws, "workspaceId", issues, "workspaceSnapshot.workspaceId");
    numberField(ws, "revision", issues, "workspaceSnapshot.revision", 1);
  } else {
    issues.push({ path: "workspaceSnapshot", code: "bad_type", message: "workspaceSnapshot must be an object" });
  }
  const permissions = value["permissions"];
  if (isRecord(permissions)) {
    stringField(permissions, "policyRevision", issues, "permissions.policyRevision");
    stringArrayField(permissions, "tools", issues, "permissions.tools");
    stringArrayField(permissions, "writeScope", issues, "permissions.writeScope");
  } else {
    issues.push({ path: "permissions", code: "bad_type", message: "permissions must be an object" });
  }
  validateTaskBudget(value["budget"], "budget", issues);
  const sourceRefs = value["sourceRefs"];
  if (Array.isArray(sourceRefs)) {
    sourceRefs.forEach((source, index) => {
      if (!isRecord(source)) {
        issues.push({ path: "sourceRefs[" + index + "]", code: "bad_type", message: "source ref must be an object" });
        return;
      }
      stringField(source, "kind", issues, "sourceRefs[" + index + "].kind");
      stringField(source, "refId", issues, "sourceRefs[" + index + "].refId");
      stringField(source, "revision", issues, "sourceRefs[" + index + "].revision");
    });
  } else {
    issues.push({ path: "sourceRefs", code: "bad_type", message: "sourceRefs must be an array" });
  }
  const bundleRef = value["bundleRef"];
  if (isRecord(bundleRef)) {
    stringField(bundleRef, "kind", issues, "bundleRef.kind");
    stringField(bundleRef, "contentType", issues, "bundleRef.contentType");
    stringField(bundleRef, "digest", issues, "bundleRef.digest");
    numberField(bundleRef, "sizeBytes", issues, "bundleRef.sizeBytes", 1);
  } else {
    issues.push({ path: "bundleRef", code: "bad_type", message: "bundleRef must be an object" });
  }
  if (issues.length === 0) {
    const size = Buffer.byteLength(canonicalJson(value as never), "utf8");
    if (size > TASK_ENVELOPE_MAX_SIZE_BYTES) {
      issues.push({
        path: "$",
        code: "size_exceeded",
        message: "TaskEnvelope serialized size " + size + " exceeds " + TASK_ENVELOPE_MAX_SIZE_BYTES,
      });
    }
  }
  return issues;
}

export function validateContextManifest(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "ContextManifest must be an object" });
    return issues;
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  if (!Array.isArray(value["selectedRefs"])) {
    issues.push({ path: "selectedRefs", code: "bad_type", message: "selectedRefs must be an array" });
  }
  if (!Array.isArray(value["gaps"])) {
    issues.push({ path: "gaps", code: "bad_type", message: "gaps must be an array" });
  }
  return issues;
}

export function validateRuntimeEvent(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "RuntimeEvent must be an object" });
    return issues;
  }
  const eventType = value["eventType"];
  if (typeof eventType !== "string" || !(RUNTIME_EVENT_TYPES as readonly string[]).includes(eventType)) {
    issues.push({ path: "eventType", code: "bad_enum", message: "unknown runtime event type" });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "eventId", issues);
  validateRunRef(value["runRef"], "runRef", issues);
  numberField(value, "sequence", issues, "sequence", 1);
  stringField(value, "occurredAt", issues);
  const payload = value["payload"];
  if (isRecord(payload)) {
    const kind = payload["kind"];
    if (typeof kind !== "string" || !["started", "completed", "crashed", "cancelled", "budget_exhausted"].includes(kind)) {
      issues.push({ path: "payload.kind", code: "bad_enum", message: "unknown runtime event payload kind" });
    }
    if (kind === "completed" && typeof payload["exitCode"] !== "number") {
      issues.push({ path: "payload.exitCode", code: "bad_type", message: "exitCode must be a number" });
    }
  } else {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
  }
  return issues;
}

export function validateTaskContextRequest(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "TaskContextRequest must be an object" });
    return issues;
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "requestId", issues);
  stringField(value, "projectId", issues);
  stringField(value, "workspaceId", issues);
  stringField(value, "goalId", issues);
  stringField(value, "taskId", issues);
  stringField(value, "submittedAt", issues);
  const ws = value["workspaceSnapshot"];
  if (isRecord(ws)) {
    numberField(ws, "revision", issues, "workspaceSnapshot.revision", 1);
  } else {
    issues.push({ path: "workspaceSnapshot", code: "bad_type", message: "workspaceSnapshot must be an object" });
  }
  validateRoleBindingRef(value["roleBinding"], "roleBinding", issues);
  validateDeclaredPermissions(value["declaredPermissions"], "declaredPermissions", issues);
  const scope = value["scope"];
  if (isRecord(scope)) {
    stringArrayField(scope, "tools", issues, "scope.tools");
    stringArrayField(scope, "writeScope", issues, "scope.writeScope");
  } else {
    issues.push({ path: "scope", code: "bad_type", message: "scope must be an object" });
  }
  validateTaskBudget(value["budget"], "budget", issues);
  // P1-03 decision (integrator ruling on lane-C gap 1): the context request is
  // built from the durable dispatch intent, so its three refs and the scope
  // triple MUST be validated at the contract boundary (assembler guards too).
  const planRef = value["planRef"];
  if (isRecord(planRef)) {
    if (planRef["aggregateType"] !== "PlanRevision") {
      issues.push({ path: "planRef.aggregateType", code: "bad_ref", message: "planRef.aggregateType must be PlanRevision" });
    }
    stringField(planRef, "projectId", issues, "planRef.projectId");
    stringField(planRef, "planId", issues, "planRef.planId");
  } else {
    issues.push({ path: "planRef", code: "bad_type", message: "planRef must be an object" });
  }
  validateRunRef(value["runRef"], "runRef", issues);
  const attemptRef = value["attemptRef"];
  if (isRecord(attemptRef)) {
    if (attemptRef["aggregateType"] !== "TaskAttempt") {
      issues.push({ path: "attemptRef.aggregateType", code: "bad_ref", message: "attemptRef.aggregateType must be TaskAttempt" });
    }
    stringField(attemptRef, "projectId", issues, "attemptRef.projectId");
    stringField(attemptRef, "goalId", issues, "attemptRef.goalId");
    stringField(attemptRef, "taskId", issues, "attemptRef.taskId");
    stringField(attemptRef, "attemptId", issues, "attemptRef.attemptId");
  } else {
    issues.push({ path: "attemptRef", code: "bad_type", message: "attemptRef must be an object" });
  }
  // cross-field alignment (full-scope keys, never bare local ids)
  if (isRecord(value["runRef"]) && value["runRef"]["goalId"] !== value["goalId"]) {
    issues.push({ path: "runRef.goalId", code: "bad_ref", message: "runRef.goalId must equal request goalId" });
  }
  if (isRecord(attemptRef) && attemptRef["taskId"] !== value["taskId"]) {
    issues.push({ path: "attemptRef.taskId", code: "bad_ref", message: "attemptRef.taskId must equal request taskId" });
  }
  if (isRecord(planRef) && planRef["projectId"] !== value["projectId"]) {
    issues.push({ path: "planRef.projectId", code: "bad_ref", message: "planRef.projectId must equal request projectId" });
  }
  return issues;
}

// P1-04 validators appended by integrator (frozen baseline)

export function validateEvidenceSource(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be an object" });
    return;
  }
  validateActor(value["actor"], path + ".actor", issues);
  const runRef = value["runRef"];
  if (runRef !== null) {
    if (!isRecord(runRef) || runRef["aggregateType"] !== "Run" || runRef["projectId"] === undefined || runRef["runId"] === undefined) {
      issues.push({ path: path + ".runRef", code: "bad_ref", message: "runRef must be a RunRef or null" });
    } else {
      stringField(runRef as UnknownRecord, "runId", issues, path + ".runRef.runId");
    }
  } else if (runRef === undefined) {
    issues.push({ path: path + ".runRef", code: "missing_field", message: "runRef is required (null when system/mechanical)" });
  }
  const checkId = value["checkId"];
  if (checkId !== null && typeof checkId !== "string") {
    issues.push({ path: path + ".checkId", code: "bad_type", message: "checkId must be a string or null" });
  }
}

export function validateArtifactRefRef(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === null) return;
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be an object or null" });
    return;
  }
  if (value["kind"] !== "artifact") {
    issues.push({ path: path + ".kind", code: "bad_type", message: 'kind must be "artifact"' });
  }
  stringField(value, "contentType", issues, path + ".contentType");
  const digest = stringField(value, "digest", issues, path + ".digest");
  if (digest !== null && !/^[0-9a-f]{64}$/.test(digest)) {
    issues.push({ path: path + ".digest", code: "bad_type", message: "digest must be a lowercase sha256 hex string" });
  }
  if (!Number.isSafeInteger(value["sizeBytes"]) || (value["sizeBytes"] as number) < 1) {
    issues.push({ path: path + ".sizeBytes", code: "bad_type", message: "sizeBytes must be a positive integer" });
  }
}

export function validateEvidenceCoverage(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ path, code: "empty_collection", message: path + " must be a non-empty array" });
    return;
  }
  value.forEach((entry, index) => {
    const epath = path + "[" + index + "]";
    if (!isRecord(entry)) {
      issues.push({ path: epath, code: "bad_type", message: "coverage entry must be an object" });
      return;
    }
    stringField(entry, "obligationId", issues, epath + ".obligationId");
    stringField(entry, "requirementId", issues, epath + ".requirementId");
  });
}

export function validateSubmitEvidenceCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "command must be an object" });
    return issues;
  }
  if (value["commandType"] !== "SubmitEvidence") {
    issues.push({ path: "commandType", code: "invalid_command_type", message: 'commandType must be "SubmitEvidence"' });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "commandId", issues);
  validateCommandIdentity(value["identity"], "identity", issues);
  stringField(value, "aggregateId", issues);
  if (value["expectedRevision"] !== 0) {
    issues.push({ path: "expectedRevision", code: "bad_expected_revision", message: "expectedRevision must be 0 (evidence is created once)" });
  }
  stringField(value, "correlationId", issues);
  stringField(value, "submittedAt", issues);
  const payload = value["payload"];
  if (!isRecord(payload)) {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    return issues;
  }
  const evidence = payload["evidence"];
  if (!isRecord(evidence)) {
    issues.push({ path: "payload.evidence", code: "bad_type", message: "evidence must be an object" });
    return issues;
  }
  if (evidence["schemaVersion"] !== 1) {
    issues.push({ path: "payload.evidence.schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  const evidenceId = stringField(evidence, "evidenceId", issues, "payload.evidence.evidenceId");
  if (evidenceId !== null && evidenceId !== value["aggregateId"]) {
    issues.push({ path: "payload.evidence.evidenceId", code: "bad_type", message: "evidenceId must equal the command aggregateId" });
  }
  const kind = evidence["kind"];
  if (typeof kind !== "string" || !(EVIDENCE_KINDS as readonly string[]).includes(kind)) {
    issues.push({ path: "payload.evidence.kind", code: "bad_enum", message: "kind must be claim|observation|verdict" });
  }
  const outcome = evidence["outcome"];
  if (typeof outcome !== "string" || !(EVIDENCE_OUTCOMES as readonly string[]).includes(outcome)) {
    issues.push({ path: "payload.evidence.outcome", code: "bad_enum", message: "outcome must be PASS|FAIL|INCONCLUSIVE" });
  }
  if (kind === "claim" && outcome !== undefined && outcome !== "INCONCLUSIVE") {
    issues.push({ path: "payload.evidence.outcome", code: "bad_enum", message: "a claim is always INCONCLUSIVE (self-report is not evidence PASS)" });
  }
  validateEvidenceSource(evidence["source"], "payload.evidence.source", issues);
  if (kind === "claim" || kind === "verdict") {
    if (evidence["source"] === undefined || !isRecord((evidence["source"] as UnknownRecord)["runRef"])) {
      issues.push({ path: "payload.evidence.source.runRef", code: "missing_field", message: kind + " evidence must come from a formal dispatch run" });
    }
  }
  const subject = evidence["subject"];
  if (!isRecord(subject)) {
    issues.push({ path: "payload.evidence.subject", code: "bad_type", message: "subject must be an object" });
  } else {
    stringField(subject, "projectId", issues, "payload.evidence.subject.projectId");
    stringField(subject, "goalId", issues, "payload.evidence.subject.goalId");
    stringField(subject, "taskId", issues, "payload.evidence.subject.taskId");
  }
  validateEvidenceCoverage(evidence["coverage"], "payload.evidence.coverage", issues);
  const anchor = evidence["anchor"];
  if (!isRecord(anchor)) {
    issues.push({ path: "payload.evidence.anchor", code: "bad_type", message: "anchor must be an object" });
    return issues;
  }
  if (anchor["schemaVersion"] !== 1) {
    issues.push({ path: "payload.evidence.anchor.schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  const planRef = anchor["planRef"];
  if (!isRecord(planRef)) {
    issues.push({ path: "payload.evidence.anchor.planRef", code: "bad_type", message: "planRef must be an object" });
  } else {
    if (planRef["aggregateType"] !== "PlanRevision") {
      issues.push({ path: "payload.evidence.anchor.planRef.aggregateType", code: "bad_type", message: "unexpected plan aggregateType" });
    }
    stringField(planRef, "projectId", issues, "payload.evidence.anchor.planRef.projectId");
    stringField(planRef, "planId", issues, "payload.evidence.anchor.planRef.planId");
  }
  if (!Number.isSafeInteger(anchor["planRevision"]) || (anchor["planRevision"] as number) < 1) {
    issues.push({ path: "payload.evidence.anchor.planRevision", code: "bad_revision", message: "planRevision must be a positive integer" });
  }
  if (!Number.isSafeInteger(anchor["workspaceRevision"]) || (anchor["workspaceRevision"] as number) < 1) {
    issues.push({ path: "payload.evidence.anchor.workspaceRevision", code: "bad_revision", message: "workspaceRevision must be a positive integer" });
  }
  validatePin(anchor["pinnedCompletionPolicy"], "payload.evidence.anchor.pinnedCompletionPolicy", issues, "policy");
  validatePin(anchor["pinnedArchitectureBaseline"], "payload.evidence.anchor.pinnedArchitectureBaseline", issues, "baseline");
  const vplan = evidence["verificationPlanRef"];
  if (!isRecord(vplan)) {
    issues.push({ path: "payload.evidence.verificationPlanRef", code: "bad_type", message: "verificationPlanRef must be an object" });
  } else {
    stringField(vplan, "planId", issues, "payload.evidence.verificationPlanRef.planId");
    const digest = stringField(vplan, "planDigest", issues, "payload.evidence.verificationPlanRef.planDigest");
    if (digest !== null && !/^[0-9a-f]{64}$/.test(digest)) {
      issues.push({ path: "payload.evidence.verificationPlanRef.planDigest", code: "bad_type", message: "planDigest must be a lowercase sha256 hex string" });
    }
  }
  const summary = evidence["summary"];
  if (!isRecord(summary)) {
    issues.push({ path: "payload.evidence.summary", code: "bad_type", message: "summary must be an object" });
  } else {
    const text = stringField(summary, "text", issues, "payload.evidence.summary.text");
    if (text !== null && Buffer.byteLength(text, "utf8") > EVIDENCE_SUMMARY_MAX_BYTES) {
      issues.push({ path: "payload.evidence.summary.text", code: "size_exceeded", message: "summary exceeds EVIDENCE_SUMMARY_MAX_BYTES" });
    }
    validateArtifactRefRef(summary["artifactRef"], "payload.evidence.summary.artifactRef", issues);
  }
  return issues;
}

export function validateReduceTaskCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "command must be an object" });
    return issues;
  }
  if (value["commandType"] !== "ReduceTask") {
    issues.push({ path: "commandType", code: "invalid_command_type", message: 'commandType must be "ReduceTask"' });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "commandId", issues);
  validateCommandIdentity(value["identity"], "identity", issues);
  stringField(value, "aggregateId", issues);
  if (!Number.isSafeInteger(value["expectedRevision"]) || (value["expectedRevision"] as number) < 0) {
    issues.push({ path: "expectedRevision", code: "bad_expected_revision", message: "expectedRevision must be a non-negative integer" });
  }
  stringField(value, "correlationId", issues);
  stringField(value, "submittedAt", issues);
  const payload = value["payload"];
  if (!isRecord(payload)) {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    return issues;
  }
  stringField(payload, "goalId", issues, "payload.goalId");
  return issues;
}

export function validateReduceGoalCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "command must be an object" });
    return issues;
  }
  if (value["commandType"] !== "ReduceGoal") {
    issues.push({ path: "commandType", code: "invalid_command_type", message: 'commandType must be "ReduceGoal"' });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "commandId", issues);
  validateCommandIdentity(value["identity"], "identity", issues);
  stringField(value, "aggregateId", issues);
  if (!Number.isSafeInteger(value["expectedRevision"]) || (value["expectedRevision"] as number) < 0) {
    issues.push({ path: "expectedRevision", code: "bad_expected_revision", message: "expectedRevision must be a non-negative integer" });
  }
  stringField(value, "correlationId", issues);
  stringField(value, "submittedAt", issues);
  const payload = value["payload"];
  if (!isRecord(payload)) {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    return issues;
  }
  const goalId = stringField(payload, "goalId", issues, "payload.goalId");
  if (goalId !== null && goalId !== value["aggregateId"]) {
    issues.push({ path: "payload.goalId", code: "bad_type", message: "goalId must equal the command aggregateId" });
  }
  return issues;
}
// P1-06 handoff validators                                                   //
// ------------------------------------------------------------------------ //

const HANDOFF_PACKET_KEYS = [
  "schemaVersion",
  "packetId",
  "projectId",
  "workspaceId",
  "goalId",
  "taskId",
  "planRef",
  "taskRevision",
  "objective",
  "constraints",
  "completed",
  "unresolved",
  "evidenceRefs",
  "artifactRefs",
  "workspaceSnapshot",
  "source",
  "bodyRef",
  "noFullTranscript",
  "predecessorPacketRef",
  "generatedAt",
] as const;

function rejectUnknownFields(
  record: UnknownRecord,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      issues.push({ path: path + "." + key, code: "unknown_field", message: "unknown field '" + key + "'" });
    }
  }
}

function validateHandoffSource(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be an object" });
    return;
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: path + ".schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  validateRunRef(value["runRef"], path + ".runRef", issues);
  const attemptRef = value["attemptRef"];
  if (isRecord(attemptRef)) {
    stringField(attemptRef, "aggregateType", issues, path + ".attemptRef.aggregateType");
    stringField(attemptRef, "attemptId", issues, path + ".attemptRef.attemptId");
  } else {
    issues.push({ path: path + ".attemptRef", code: "bad_type", message: "attemptRef must be an object" });
  }
  validateRoleBindingRef(value["binding"], path + ".binding", issues);
  const context = value["context"];
  if (isRecord(context)) {
    const bundle = context["contextBundleRef"];
    if (bundle !== null) validateArtifactRefRef(bundle, path + ".context.contextBundleRef", issues);
    const manifest = context["contextManifestRef"];
    if (manifest !== null) validateArtifactRefRef(manifest, path + ".context.contextManifestRef", issues);
  } else {
    issues.push({ path: path + ".context", code: "bad_type", message: "context must be an object" });
  }
  const runtime = value["runtime"];
  if (!isRecord(runtime)) {
    issues.push({ path: path + ".runtime", code: "bad_type", message: "runtime must be an object" });
  } else {
    numberField(runtime, "lastEventSeq", issues, path + ".runtime.lastEventSeq", 0);
  }
}

function validateHandoffCompletedItem(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be an object" });
    return;
  }
  const summary = stringField(value, "summary", issues, path + ".summary");
  if (summary !== null && Buffer.byteLength(summary, "utf8") > HANDOFF_SUMMARY_MAX_BYTES) {
    issues.push({ path: path + ".summary", code: "size_exceeded", message: "summary exceeds " + HANDOFF_SUMMARY_MAX_BYTES + " bytes" });
  }
  const artifactRef = value["artifactRef"];
  if (artifactRef !== null) validateArtifactRefRef(artifactRef, path + ".artifactRef", issues);
  if (!Array.isArray(value["evidenceRefs"])) {
    issues.push({ path: path + ".evidenceRefs", code: "bad_type", message: "evidenceRefs must be an array" });
  }
}

const HANDOFF_UNRESOLVED_KINDS = ["missing_material", "outcome_unknown", "risk", "blocked", "cancelled", "other"];

function validateHandoffUnresolvedItem(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be an object" });
    return;
  }
  validateEnum(value["kind"], HANDOFF_UNRESOLVED_KINDS, path + ".kind", issues);
  const summary = stringField(value, "summary", issues, path + ".summary");
  if (summary !== null && Buffer.byteLength(summary, "utf8") > HANDOFF_SUMMARY_MAX_BYTES) {
    issues.push({ path: path + ".summary", code: "size_exceeded", message: "summary exceeds " + HANDOFF_SUMMARY_MAX_BYTES + " bytes" });
  }
  const artifactRef = value["artifactRef"];
  if (artifactRef !== null) validateArtifactRefRef(artifactRef, path + ".artifactRef", issues);
}

function validateHandoffPacketRef(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be an object" });
    return;
  }
  if (value["aggregateType"] !== "HandoffPacket") {
    issues.push({ path: path + ".aggregateType", code: "bad_ref", message: "aggregateType must be HandoffPacket" });
  }
  stringField(value, "projectId", issues, path + ".projectId");
  stringField(value, "goalId", issues, path + ".goalId");
  stringField(value, "taskId", issues, path + ".taskId");
  stringField(value, "packetId", issues, path + ".packetId");
}

/**
 * STRICT packet validator: known fields only (an unknown field — e.g. a hidden
 * "transcript" — is rejected), required bounded shape, explicit
 * noFullTranscript === true, and the HARD canonical-JSON size cap.
 */
export function validateHandoffPacket(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "HandoffPacket must be an object" });
    return issues;
  }
  rejectUnknownFields(value, HANDOFF_PACKET_KEYS, "$", issues);
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "packetId", issues);
  stringField(value, "projectId", issues);
  stringField(value, "workspaceId", issues);
  stringField(value, "goalId", issues);
  stringField(value, "taskId", issues);
  const planRef = value["planRef"];
  if (isRecord(planRef)) {
    stringField(planRef, "aggregateType", issues, "planRef.aggregateType");
    stringField(planRef, "planId", issues, "planRef.planId");
  } else {
    issues.push({ path: "planRef", code: "bad_type", message: "planRef must be an object" });
  }
  safePositiveIntField(value["taskRevision"], "taskRevision", issues);
  stringField(value, "objective", issues);
  const constraints = value["constraints"];
  if (!Array.isArray(constraints) || constraints.length > HANDOFF_MAX_CONSTRAINTS) {
    issues.push({ path: "constraints", code: "bad_type", message: "constraints must be an array with <= " + HANDOFF_MAX_CONSTRAINTS + " items" });
  } else {
    for (const c of constraints) {
      if (typeof c !== "string") issues.push({ path: "constraints", code: "bad_type", message: "constraint must be a string" });
    }
  }
  const completed = value["completed"];
  if (!Array.isArray(completed) || completed.length > HANDOFF_MAX_COMPLETED) {
    issues.push({ path: "completed", code: "bad_type", message: "completed must be an array with <= " + HANDOFF_MAX_COMPLETED + " items" });
  } else {
    completed.forEach((item, i) => validateHandoffCompletedItem(item, "completed[" + i + "]", issues));
  }
  const unresolved = value["unresolved"];
  if (!Array.isArray(unresolved) || unresolved.length > HANDOFF_MAX_UNRESOLVED) {
    issues.push({ path: "unresolved", code: "bad_type", message: "unresolved must be an array with <= " + HANDOFF_MAX_UNRESOLVED + " items" });
  } else {
    unresolved.forEach((item, i) => validateHandoffUnresolvedItem(item, "unresolved[" + i + "]", issues));
  }
  const evidenceRefs = value["evidenceRefs"];
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length > HANDOFF_MAX_EVIDENCE_REFS) {
    issues.push({ path: "evidenceRefs", code: "bad_type", message: "evidenceRefs must be an array with <= " + HANDOFF_MAX_EVIDENCE_REFS + " items" });
  }
  const artifactRefs = value["artifactRefs"];
  if (!Array.isArray(artifactRefs) || artifactRefs.length > HANDOFF_MAX_ARTIFACT_REFS) {
    issues.push({ path: "artifactRefs", code: "bad_type", message: "artifactRefs must be an array with <= " + HANDOFF_MAX_ARTIFACT_REFS + " items" });
  }
  const ws = value["workspaceSnapshot"];
  if (isRecord(ws)) {
    stringField(ws, "workspaceId", issues, "workspaceSnapshot.workspaceId");
    numberField(ws, "revision", issues, "workspaceSnapshot.revision", 1);
  } else {
    issues.push({ path: "workspaceSnapshot", code: "bad_type", message: "workspaceSnapshot must be an object" });
  }
  validateHandoffSource(value["source"], "source", issues);
  validateArtifactRefRef(value["bodyRef"], "bodyRef", issues);
  if (value["noFullTranscript"] !== true) {
    issues.push({ path: "noFullTranscript", code: "bad_type", message: "noFullTranscript must be true (no transcript in a packet, ever)" });
  }
  const predecessor = value["predecessorPacketRef"];
  if (predecessor !== null) validateHandoffPacketRef(predecessor, "predecessorPacketRef", issues);
  stringField(value, "generatedAt", issues);
  if (issues.length === 0) {
    const size = Buffer.byteLength(canonicalJson(value as never), "utf8");
    if (size > HANDOFF_PACKET_MAX_BYTES) {
      issues.push({
        path: "$",
        code: "size_exceeded",
        message: "HandoffPacket serialized size " + size + " exceeds " + HANDOFF_PACKET_MAX_BYTES,
      });
    }
  }
  return issues;
}

export function validateRecordHandoffCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "command must be an object" });
    return issues;
  }
  if (value["commandType"] !== "RecordHandoff") {
    issues.push({ path: "commandType", code: "invalid_command_type", message: 'commandType must be "RecordHandoff"' });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "commandId", issues);
  validateCommandIdentity(value["identity"], "identity", issues);
  stringField(value, "aggregateId", issues);
  if (value["expectedRevision"] !== 0) {
    issues.push({ path: "expectedRevision", code: "bad_expected_revision", message: "expectedRevision must be 0" });
  }
  stringField(value, "correlationId", issues);
  stringField(value, "submittedAt", issues);
  const payload = value["payload"];
  if (!isRecord(payload)) {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    return issues;
  }
  for (const issue of validateHandoffPacket(payload["packet"])) {
    issues.push({ path: "payload.packet." + issue.path, code: issue.code, message: issue.message });
  }
  return issues;
}

export function validateClaimReplacementCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "command must be an object" });
    return issues;
  }
  if (value["commandType"] !== "ClaimReplacement") {
    issues.push({ path: "commandType", code: "invalid_command_type", message: 'commandType must be "ClaimReplacement"' });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "commandId", issues);
  validateCommandIdentity(value["identity"], "identity", issues);
  stringField(value, "aggregateId", issues);
  if (!Number.isSafeInteger(value["expectedRevision"]) || (value["expectedRevision"] as number) < 1) {
    issues.push({ path: "expectedRevision", code: "bad_expected_revision", message: "expectedRevision must be a positive integer (existing lease)" });
  }
  stringField(value, "correlationId", issues);
  stringField(value, "submittedAt", issues);
  const payload = value["payload"];
  if (!isRecord(payload)) {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    return issues;
  }
  stringField(payload, "goalId", issues, "payload.goalId");
  stringField(payload, "attemptId", issues, "payload.attemptId");
  stringField(payload, "runId", issues, "payload.runId");
  validateRoleBindingRef(payload["roleBinding"], "payload.roleBinding", issues);
  validateDeclaredPermissions(payload["declaredPermissions"], "payload.declaredPermissions", issues);
  validateTaskBudget(payload["budget"], "payload.budget", issues);
  validateHandoffPacketRef(payload["handoffPacketRef"], "payload.handoffPacketRef", issues);
  validateEnum(payload["reason"], REPLACEMENT_REASONS, "payload.reason", issues);
  return issues;
}

export function validateHandoffContextRequest(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "request must be an object" });
    return issues;
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "requestId", issues);
  stringField(value, "projectId", issues);
  stringField(value, "workspaceId", issues);
  stringField(value, "goalId", issues);
  stringField(value, "taskId", issues);
  const planRef = value["planRef"];
  if (isRecord(planRef)) {
    stringField(planRef, "aggregateType", issues, "planRef.aggregateType");
    stringField(planRef, "planId", issues, "planRef.planId");
  } else {
    issues.push({ path: "planRef", code: "bad_type", message: "planRef must be an object" });
  }
  validateRunRef(value["runRef"], "runRef", issues);
  const attemptRef = value["attemptRef"];
  if (isRecord(attemptRef)) {
    stringField(attemptRef, "aggregateType", issues, "attemptRef.aggregateType");
    stringField(attemptRef, "attemptId", issues, "attemptRef.attemptId");
  } else {
    issues.push({ path: "attemptRef", code: "bad_type", message: "attemptRef must be an object" });
  }
  validateRoleBindingRef(value["roleBinding"], "roleBinding", issues);
  validateDeclaredPermissions(value["declaredPermissions"], "declaredPermissions", issues);
  validateDeclaredPermissions(value["scope"], "scope", issues);
  const ws = value["workspaceSnapshot"];
  if (isRecord(ws)) {
    stringField(ws, "workspaceId", issues, "workspaceSnapshot.workspaceId");
    numberField(ws, "revision", issues, "workspaceSnapshot.revision", 1);
  } else {
    issues.push({ path: "workspaceSnapshot", code: "bad_type", message: "workspaceSnapshot must be an object" });
  }
  validateHandoffPacketRef(value["handoffPacketRef"], "handoffPacketRef", issues);
  validateTaskBudget(value["budget"], "budget", issues);
  stringField(value, "submittedAt", issues);
  return issues;
}

const HANDOFF_CONTROL_KINDS = ["pause", "stop"];

export function validateHandoffControlCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "command must be an object" });
    return issues;
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  validateEnum(value["kind"], HANDOFF_CONTROL_KINDS, "kind", issues);
  stringField(value, "reason", issues);
  stringField(value, "correlationId", issues);
  stringField(value, "submittedAt", issues);
  return issues;
}

export function validateHandoffSnapshotQuery(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "query must be an object" });
    return issues;
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  validateRunRef(value["runRef"], "runRef", issues);
  return issues;
}

// ------------------------------------------------------------------------ //
// P1-07 validators: workspace lease / integration / patch commands          //
// ------------------------------------------------------------------------ //

function validateConflictScope(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: "ConflictScope must be an object" });
    return;
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: path + ".schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  if (typeof value["projectId"] !== "string" || value["projectId"].length === 0) {
    issues.push({ path: path + ".projectId", code: "bad_type", message: "projectId must be a non-empty string" });
  }
  if (typeof value["workspaceId"] !== "string" || value["workspaceId"].length === 0) {
    issues.push({ path: path + ".workspaceId", code: "bad_type", message: "workspaceId must be a non-empty string" });
  }
  validateEnum(value["kind"], CONFLICT_SCOPE_KINDS, path + ".kind", issues);
  if (typeof value["id"] !== "string" || value["id"].length === 0) {
    issues.push({ path: path + ".id", code: "bad_type", message: "id must be a non-empty string" });
  }
  if (value["revision"] !== null && !Number.isSafeInteger(value["revision"])) {
    issues.push({ path: path + ".revision", code: "bad_type", message: "revision must be an integer or null" });
  }
}

function validateWorkspaceLeaseHolder(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: "holder must be an object" });
    return;
  }
  validateRunRef(value["runRef"], path + ".runRef", issues);
  const attemptRef = value["attemptRef"];
  if (!isRecord(attemptRef)) {
    issues.push({ path: path + ".attemptRef", code: "bad_type", message: "attemptRef must be an object" });
  } else {
    if (attemptRef["aggregateType"] !== "TaskAttempt") {
      issues.push({ path: path + ".attemptRef.aggregateType", code: "bad_type", message: "aggregateType must be TaskAttempt" });
    }
    stringField(attemptRef, "projectId", issues, path + ".attemptRef.projectId");
    stringField(attemptRef, "goalId", issues, path + ".attemptRef.goalId");
    stringField(attemptRef, "taskId", issues, path + ".attemptRef.taskId");
    stringField(attemptRef, "attemptId", issues, path + ".attemptRef.attemptId");
  }
  const roleBinding = value["roleBinding"];
  if (!isRecord(roleBinding)) {
    issues.push({ path: path + ".roleBinding", code: "bad_type", message: "roleBinding must be an object" });
  } else {
    if (roleBinding["schemaVersion"] !== 1) {
      issues.push({ path: path + ".roleBinding.schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
    }
    stringField(roleBinding, "bindingId", issues, path + ".roleBinding.bindingId");
    stringField(roleBinding, "templateId", issues, path + ".roleBinding.templateId");
  }
}

function validateLeaseBase(command: unknown, commandType: string, issues: ValidationIssue[], expectedRevision: 0 | 1): boolean {
  if (!isRecord(command)) {
    issues.push({ path: "$", code: "bad_type", message: "command must be an object" });
    return false;
  }
  if (command["commandType"] !== commandType) {
    issues.push({ path: "commandType", code: "bad_type", message: "commandType must be " + commandType });
  }
  if (command["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  validateCommandIdentity(command["identity"], "identity", issues);
  stringField(command, "aggregateId", issues);
  if (command["expectedRevision"] !== expectedRevision) {
    issues.push({ path: "expectedRevision", code: "bad_type", message: "expectedRevision must be " + expectedRevision });
  }
  stringField(command, "correlationId", issues);
  stringField(command, "submittedAt", issues);
  return !isRecord(command["payload"]) || true;
}

export function validateAcquireWorkspaceReadLeaseCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (validateLeaseBase(value, "AcquireWorkspaceReadLease", issues, 0) && isRecord(value) && isRecord(value["payload"])) {
    const payload = value["payload"];
    stringField(payload, "projectId", issues, "payload.projectId");
    stringField(payload, "workspaceId", issues, "payload.workspaceId");
    validateConflictScope(payload["scope"], "payload.scope", issues);
    validateWorkspaceLeaseHolder(payload["holder"], "payload.holder", issues);
    if (payload["expiresAt"] !== null && typeof payload["expiresAt"] !== "string") {
      issues.push({ path: "payload.expiresAt", code: "bad_type", message: "expiresAt must be a string or null" });
    }
  }
  return issues;
}

export function validateAcquireWorkspaceWriteLeaseCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (validateLeaseBase(value, "AcquireWorkspaceWriteLease", issues, 0) && isRecord(value) && isRecord(value["payload"])) {
    const payload = value["payload"];
    stringField(payload, "projectId", issues, "payload.projectId");
    stringField(payload, "workspaceId", issues, "payload.workspaceId");
    validateConflictScope(payload["scope"], "payload.scope", issues);
    validateWorkspaceLeaseHolder(payload["holder"], "payload.holder", issues);
    if (payload["expiresAt"] !== null && typeof payload["expiresAt"] !== "string") {
      issues.push({ path: "payload.expiresAt", code: "bad_type", message: "expiresAt must be a string or null" });
    }
    if (!Array.isArray(payload["declaredWriteScope"]) || payload["declaredWriteScope"].some((e: unknown) => typeof e !== "string")) {
      issues.push({ path: "payload.declaredWriteScope", code: "bad_type", message: "declaredWriteScope must be an array of strings" });
    }
  }
  return issues;
}

export function validateReleaseWorkspaceLeaseCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (validateLeaseBase(value, "ReleaseWorkspaceLease", issues, 1) && isRecord(value) && isRecord(value["payload"])) {
    const payload = value["payload"];
    stringField(payload, "projectId", issues, "payload.projectId");
    stringField(payload, "workspaceId", issues, "payload.workspaceId");
    validateEnum(payload["kind"], ["read", "write"], "payload.kind", issues);
    stringField(payload, "leaseId", issues, "payload.leaseId");
    validateRunRef(payload["holderRunRef"], "payload.holderRunRef", issues);
  }
  return issues;
}

function validateEvidenceInputRef(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: "input must be an object" });
    return;
  }
  stringField(value, "sourceTaskId", issues, path + ".sourceTaskId");
  validateRunRef(value["sourceRunRef"], path + ".sourceRunRef", issues);
  validateEnum(value["kind"], ["evidence", "artifact", "handoff"], path + ".kind", issues);
}

export function validateRecordIntegrationResultCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "command must be an object" });
    return issues;
  }
  if (value["commandType"] !== "RecordIntegrationResult") {
    issues.push({ path: "commandType", code: "bad_type", message: "commandType must be RecordIntegrationResult" });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  validateCommandIdentity(value["identity"], "identity", issues);
  stringField(value, "aggregateId", issues);
  if (!Number.isSafeInteger(value["expectedRevision"]) || (value["expectedRevision"] as number) < 0) {
    issues.push({ path: "expectedRevision", code: "bad_type", message: "expectedRevision must be a non-negative integer" });
  }
  stringField(value, "correlationId", issues);
  stringField(value, "submittedAt", issues);
  const payload = value["payload"];
  if (!isRecord(payload)) {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    return issues;
  }
  const result = payload["result"];
  if (!isRecord(result)) {
    issues.push({ path: "payload.result", code: "bad_type", message: "result must be an object" });
    return issues;
  }
  if (result["schemaVersion"] !== 1) {
    issues.push({ path: "payload.result.schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(result, "resultId", issues, "payload.result.resultId");
  stringField(result, "projectId", issues, "payload.result.projectId");
  stringField(result, "workspaceId", issues, "payload.result.workspaceId");
  stringField(result, "goalId", issues, "payload.result.goalId");
  stringField(result, "taskId", issues, "payload.result.taskId");
  if (!Number.isSafeInteger(result["taskRevision"])) {
    issues.push({ path: "payload.result.taskRevision", code: "bad_type", message: "taskRevision must be an integer" });
  }
  validateRunRef(result["runRef"], "payload.result.runRef", issues);
  if (!Number.isSafeInteger(result["workspaceRevision"])) {
    issues.push({ path: "payload.result.workspaceRevision", code: "bad_type", message: "workspaceRevision must be an integer" });
  }
  const inputs = result["inputs"];
  if (!Array.isArray(inputs) || inputs.length > INTEGRATION_MAX_INPUTS) {
    issues.push({ path: "payload.result.inputs", code: "size_exceeded", message: "inputs must be an array <= " + INTEGRATION_MAX_INPUTS });
  } else {
    inputs.forEach((e: unknown, i: number) => validateEvidenceInputRef(e, "payload.result.inputs[" + i + "]", issues));
  }
  const conflicts = result["conflicts"];
  if (!Array.isArray(conflicts) || conflicts.length > INTEGRATION_MAX_CONFLICTS) {
    issues.push({ path: "payload.result.conflicts", code: "size_exceeded", message: "conflicts must be an array <= " + INTEGRATION_MAX_CONFLICTS });
  }
  const gaps = result["gaps"];
  if (!Array.isArray(gaps) || gaps.length > INTEGRATION_MAX_GAPS) {
    issues.push({ path: "payload.result.gaps", code: "size_exceeded", message: "gaps must be an array <= " + INTEGRATION_MAX_GAPS });
  }
  const explanation = result["explanation"];
  if (explanation === null || typeof explanation === "string") {
    if (typeof explanation === "string" && Buffer.byteLength(explanation, "utf8") > INTEGRATION_MAX_EXPLANATION_BYTES) {
      issues.push({ path: "payload.result.explanation", code: "size_exceeded", message: "explanation exceeds " + INTEGRATION_MAX_EXPLANATION_BYTES + " bytes" });
    }
  } else {
    issues.push({ path: "payload.result.explanation", code: "bad_type", message: "explanation must be a string or null" });
  }
  if (typeof result["escalate"] !== "boolean") {
    issues.push({ path: "payload.result.escalate", code: "bad_type", message: "escalate must be a boolean" });
  }
  const conflictCount = Array.isArray(conflicts) ? conflicts.length : 0;
  if (conflictCount > 0 && explanation === null && result["escalate"] !== true) {
    issues.push({ path: "payload.result.explanation", code: "conflict_unresolved", message: "conflicts require explanation or escalate" });
  }
  if (result["escalate"] === true && conflictCount === 0) {
    issues.push({ path: "payload.result.escalate", code: "invalid_escalate", message: "escalate requires at least one conflict" });
  }
  stringField(result, "generatedAt", issues, "payload.result.generatedAt");
  return issues;
}

export function validateRecordPatchCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "command must be an object" });
    return issues;
  }
  if (value["commandType"] !== "RecordPatch") {
    issues.push({ path: "commandType", code: "bad_type", message: "commandType must be RecordPatch" });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  validateCommandIdentity(value["identity"], "identity", issues);
  stringField(value, "aggregateId", issues);
  if (value["expectedRevision"] !== 0) {
    issues.push({ path: "expectedRevision", code: "bad_type", message: "expectedRevision must be 0 for a new patch" });
  }
  stringField(value, "correlationId", issues);
  stringField(value, "submittedAt", issues);
  const payload = value["payload"];
  if (!isRecord(payload)) {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    return issues;
  }
  const patch = payload["patch"];
  if (!isRecord(patch)) {
    issues.push({ path: "payload.patch", code: "bad_type", message: "patch must be an object" });
    return issues;
  }
  if (patch["schemaVersion"] !== 1) {
    issues.push({ path: "payload.patch.schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(patch, "patchId", issues, "payload.patch.patchId");
  stringField(patch, "projectId", issues, "payload.patch.projectId");
  stringField(patch, "workspaceId", issues, "payload.patch.workspaceId");
  stringField(patch, "goalId", issues, "payload.patch.goalId");
  stringField(patch, "taskId", issues, "payload.patch.taskId");
  if (!Number.isSafeInteger(patch["taskRevision"])) {
    issues.push({ path: "payload.patch.taskRevision", code: "bad_type", message: "taskRevision must be an integer" });
  }
  validateRunRef(patch["runRef"], "payload.patch.runRef", issues);
  validateEnum(patch["kind"], ["patch", "commit"], "payload.patch.kind", issues);
  stringField(patch, "title", issues, "payload.patch.title");
  const changedPaths = patch["changedPaths"];
  if (!Array.isArray(changedPaths) || changedPaths.length > PATCH_MAX_CHANGED_PATHS || changedPaths.some((e: unknown) => typeof e !== "string" || e.length === 0)) {
    issues.push({ path: "payload.patch.changedPaths", code: "size_exceeded", message: "changedPaths must be a non-empty-string array <= " + PATCH_MAX_CHANGED_PATHS });
  }
  if (!isRecord(patch["bodyRef"])) {
    issues.push({ path: "payload.patch.bodyRef", code: "bad_type", message: "bodyRef must be an object" });
  }
  if (!Number.isSafeInteger(patch["beforeWorkspaceRevision"]) || !Number.isSafeInteger(patch["afterWorkspaceRevision"])) {
    issues.push({ path: "payload.patch.workspaceRevisions", code: "bad_type", message: "workspace revisions must be integers" });
  }
  const checkResults = patch["checkResults"];
  if (!Array.isArray(checkResults) || checkResults.length > PATCH_MAX_CHECK_RESULTS) {
    issues.push({ path: "payload.patch.checkResults", code: "size_exceeded", message: "checkResults must be an array <= " + PATCH_MAX_CHECK_RESULTS });
  } else {
    checkResults.forEach((c: unknown, i: number) => {
      if (!isRecord(c)) {
        issues.push({ path: "payload.patch.checkResults[" + i + "]", code: "bad_type", message: "checkResult must be an object" });
        return;
      }
      stringField(c, "checkId", issues, "payload.patch.checkResults[" + i + "].checkId");
      validateEnum(c["outcome"], ["PASS", "FAIL", "INCONCLUSIVE"], "payload.patch.checkResults[" + i + "].outcome", issues);
      if (typeof c["summary"] !== "string" || Buffer.byteLength(c["summary"] as string, "utf8") > PATCH_MAX_CHECK_SUMMARY_BYTES) {
        issues.push({ path: "payload.patch.checkResults[" + i + "].summary", code: "size_exceeded", message: "summary exceeds " + PATCH_MAX_CHECK_SUMMARY_BYTES + " bytes" });
      }
    });
  }
  const usedInput = patch["usedInputEvidenceRefs"];
  if (!Array.isArray(usedInput) || usedInput.length > PATCH_MAX_USED_INPUT_EVIDENCE) {
    issues.push({ path: "payload.patch.usedInputEvidenceRefs", code: "size_exceeded", message: "usedInputEvidenceRefs must be an array <= " + PATCH_MAX_USED_INPUT_EVIDENCE });
  }
  stringField(patch, "generatedAt", issues, "payload.patch.generatedAt");
  return issues;
}

// ------------------------------------------------------------------------ //
// P1-16 context-continuity command/request validators                       //
// ------------------------------------------------------------------------ //

const WORK_CONTEXT_BIND_KEYS = [
  "schemaVersion", "workId", "projectId", "workspaceId", "workKind", "goalId", "taskId",
  "planRef", "planRevision", "roleBindingRef", "initialRunRef", "linkedRunRefs", "status", "createdAt",
] as const;

function validateWorkContextBindingValue(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be an object" });
    return;
  }
  rejectUnknownFields(value, WORK_CONTEXT_BIND_KEYS, path, issues);
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: path + ".schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "workId", issues, path + ".workId");
  stringField(value, "projectId", issues, path + ".projectId");
  stringField(value, "workspaceId", issues, path + ".workspaceId");
  validateEnum(value["workKind"], WORK_KINDS as unknown as string[], path + ".workKind", issues);
  if (value["goalId"] !== null) stringField(value, "goalId", issues, path + ".goalId");
  if (value["taskId"] !== null) stringField(value, "taskId", issues, path + ".taskId");
  const planRef = value["planRef"];
  if (planRef !== null) {
    if (!isRecord(planRef)) {
      issues.push({ path: path + ".planRef", code: "bad_type", message: "planRef must be an object or null" });
    } else {
      stringField(planRef, "aggregateType", issues, path + ".planRef.aggregateType");
      stringField(planRef, "planId", issues, path + ".planRef.planId");
      if (planRef["aggregateType"] !== "PlanRevision") {
        issues.push({ path: path + ".planRef.aggregateType", code: "bad_ref", message: "aggregateType must be PlanRevision" });
      }
    }
  }
  if (value["planRevision"] !== null) numberField(value, "planRevision", issues, path + ".planRevision", 1);
  validateRoleBindingRef(value["roleBindingRef"], path + ".roleBindingRef", issues);
  validateRunRef(value["initialRunRef"], path + ".initialRunRef", issues);
  const linked = value["linkedRunRefs"];
  if (!Array.isArray(linked) || linked.length < 1 || linked.length > WORK_CONTEXT_MAX_RUN_LINKS) {
    issues.push({ path: path + ".linkedRunRefs", code: "size_exceeded", message: "linkedRunRefs must be an array with 1.." + WORK_CONTEXT_MAX_RUN_LINKS + " items" });
  } else {
    linked.forEach((r, i) => validateRunRef(r, path + ".linkedRunRefs[" + i + "]", issues));
  }
  if (value["status"] !== "active") {
    issues.push({ path: path + ".status", code: "bad_type", message: "status must be active" });
  }
  stringField(value, "createdAt", issues, path + ".createdAt");
}

const EXECUTION_NOTE_KEYS = [
  "schemaVersion", "noteId", "workId", "projectId", "workspaceId", "runRef", "attemptRef",
  "roleBindingRef", "kind", "summary", "reason", "alternatives", "sourceRefs",
  "applicableVersions", "verification", "bodyRef", "noFullTranscript", "createdAt",
] as const;

/**
 * STRICT note validator: known fields only (a hidden transcript is rejected),
 * bounded shape, explicit noFullTranscript === true, HARD canonical-JSON cap.
 */
export function validateExecutionNote(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "ExecutionNote must be an object" });
    return issues;
  }
  rejectUnknownFields(value, EXECUTION_NOTE_KEYS, "$", issues);
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "noteId", issues);
  stringField(value, "workId", issues);
  stringField(value, "projectId", issues);
  stringField(value, "workspaceId", issues);
  validateRunRef(value["runRef"], "runRef", issues);
  const attemptRef = value["attemptRef"];
  if (attemptRef !== null && !isRecord(attemptRef)) {
    issues.push({ path: "attemptRef", code: "bad_type", message: "attemptRef must be an object or null" });
  }
  validateRoleBindingRef(value["roleBindingRef"], "roleBindingRef", issues);
  validateEnum(value["kind"], EXECUTION_NOTE_KINDS as unknown as string[], "kind", issues);
  const summary = stringField(value, "summary", issues);
  if (summary !== null && Buffer.byteLength(summary, "utf8") > EXECUTION_NOTE_SUMMARY_MAX_BYTES) {
    issues.push({ path: "summary", code: "size_exceeded", message: "summary exceeds " + EXECUTION_NOTE_SUMMARY_MAX_BYTES + " bytes" });
  }
  const reason = stringField(value, "reason", issues);
  if (reason !== null && Buffer.byteLength(reason, "utf8") > EXECUTION_NOTE_REASON_MAX_BYTES) {
    issues.push({ path: "reason", code: "size_exceeded", message: "reason exceeds " + EXECUTION_NOTE_REASON_MAX_BYTES + " bytes" });
  }
  const alternatives = value["alternatives"];
  if (!Array.isArray(alternatives) || alternatives.length > EXECUTION_NOTE_MAX_ALTERNATIVES) {
    issues.push({ path: "alternatives", code: "size_exceeded", message: "alternatives must be an array <= " + EXECUTION_NOTE_MAX_ALTERNATIVES });
  } else {
    alternatives.forEach((a, i) => {
      if (typeof a !== "string" || Buffer.byteLength(a, "utf8") > EXECUTION_NOTE_SUMMARY_MAX_BYTES) {
        issues.push({ path: "alternatives[" + i + "]", code: "size_exceeded", message: "alternative must be a string <= " + EXECUTION_NOTE_SUMMARY_MAX_BYTES + " bytes" });
      }
    });
  }
  const sourceRefs = value["sourceRefs"];
  if (!Array.isArray(sourceRefs) || sourceRefs.length > EXECUTION_NOTE_MAX_SOURCE_REFS) {
    issues.push({ path: "sourceRefs", code: "size_exceeded", message: "sourceRefs must be an array <= " + EXECUTION_NOTE_MAX_SOURCE_REFS });
  } else {
    sourceRefs.forEach((s, i) => {
      if (!isRecord(s)) {
        issues.push({ path: "sourceRefs[" + i + "]", code: "bad_type", message: "source must be an object" });
        return;
      }
      validateEnum(s["kind"], ["evidence", "artifact", "run", "handoff", "decision", "event"], "sourceRefs[" + i + "].kind", issues);
      stringField(s, "refKey", issues, "sourceRefs[" + i + "].refKey");
      if (s["version"] !== null) numberField(s, "version", issues, "sourceRefs[" + i + "].version", 1);
      if (s["label"] !== null) stringField(s, "label", issues, "sourceRefs[" + i + "].label");
    });
  }
  const versions = value["applicableVersions"];
  if (!isRecord(versions)) {
    issues.push({ path: "applicableVersions", code: "bad_type", message: "applicableVersions must be an object" });
  } else {
    const planRef = versions["planRef"];
    if (planRef !== null && !isRecord(planRef)) {
      issues.push({ path: "applicableVersions.planRef", code: "bad_type", message: "planRef must be an object or null" });
    }
    if (versions["planRevision"] !== null) numberField(versions, "planRevision", issues, "applicableVersions.planRevision", 1);
    numberField(versions, "workspaceRevision", issues, "applicableVersions.workspaceRevision", 1);
    if (versions["governanceRevision"] !== null) stringField(versions, "governanceRevision", issues, "applicableVersions.governanceRevision");
  }
  const verification = value["verification"];
  if (!isRecord(verification)) {
    issues.push({ path: "verification", code: "bad_type", message: "verification must be an object" });
  } else {
    validateEnum(verification["status"], ["unverified", "verified", "contradicted"], "verification.status", issues);
    const evidenceRefs = verification["evidenceRefs"];
    if (!Array.isArray(evidenceRefs)) {
      issues.push({ path: "verification.evidenceRefs", code: "bad_type", message: "evidenceRefs must be an array" });
    }
  }
  validateArtifactRefRef(value["bodyRef"], "bodyRef", issues);
  if (value["noFullTranscript"] !== true) {
    issues.push({ path: "noFullTranscript", code: "bad_type", message: "noFullTranscript must be true (no transcript in a note, ever)" });
  }
  stringField(value, "createdAt", issues);
  if (issues.length === 0) {
    const size = Buffer.byteLength(canonicalJson(value as never), "utf8");
    if (size > EXECUTION_NOTE_MAX_BYTES) {
      issues.push({ path: "$", code: "size_exceeded", message: "ExecutionNote serialized size " + size + " exceeds " + EXECUTION_NOTE_MAX_BYTES });
    }
  }
  return issues;
}

const CONTINUATION_RESULT_KEYS = [
  "schemaVersion", "reportId", "workId", "projectId", "workspaceId", "requestedByRunRef",
  "capabilitySource", "status", "originalRunRef", "takeoverRunRef", "resumedFromRunRef",
  "unsupportedCapabilities", "rejectionCode", "summary", "recordedAt",
] as const;

export function validateContextContinuationResult(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "ContextContinuationResult must be an object" });
    return issues;
  }
  rejectUnknownFields(value, CONTINUATION_RESULT_KEYS, "$", issues);
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "reportId", issues);
  stringField(value, "workId", issues);
  stringField(value, "projectId", issues);
  stringField(value, "workspaceId", issues);
  if (value["requestedByRunRef"] !== null) validateRunRef(value["requestedByRunRef"], "requestedByRunRef", issues);
  validateEnum(value["capabilitySource"], ["runtime", "adapter"], "capabilitySource", issues);
  validateEnum(value["status"], ["restored_original", "took_over", "unsupported", "rejected"], "status", issues);
  if (value["originalRunRef"] !== null) validateRunRef(value["originalRunRef"], "originalRunRef", issues);
  if (value["takeoverRunRef"] !== null) validateRunRef(value["takeoverRunRef"], "takeoverRunRef", issues);
  if (value["resumedFromRunRef"] !== null) validateRunRef(value["resumedFromRunRef"], "resumedFromRunRef", issues);
  const unsupported = value["unsupportedCapabilities"];
  if (!Array.isArray(unsupported) || unsupported.length > 8) {
    issues.push({ path: "unsupportedCapabilities", code: "size_exceeded", message: "unsupportedCapabilities must be an array <= 8" });
  }
  if (value["rejectionCode"] !== null) stringField(value, "rejectionCode", issues, "rejectionCode");
  const summary = stringField(value, "summary", issues);
  if (summary !== null && Buffer.byteLength(summary, "utf8") > CONTINUATION_SUMMARY_MAX_BYTES) {
    issues.push({ path: "summary", code: "size_exceeded", message: "summary exceeds " + CONTINUATION_SUMMARY_MAX_BYTES + " bytes" });
  }
  stringField(value, "recordedAt", issues);
  return issues;
}

export function validateBindWorkContextCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "command must be an object" });
    return issues;
  }
  if (value["commandType"] !== "BindWorkContext") {
    issues.push({ path: "commandType", code: "invalid_command_type", message: 'commandType must be "BindWorkContext"' });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "commandId", issues);
  validateCommandIdentity(value["identity"], "identity", issues);
  stringField(value, "aggregateId", issues);
  if (value["expectedRevision"] !== 0) {
    issues.push({ path: "expectedRevision", code: "bad_expected_revision", message: "expectedRevision must be 0" });
  }
  stringField(value, "correlationId", issues);
  stringField(value, "submittedAt", issues);
  const payload = value["payload"];
  if (!isRecord(payload)) {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    return issues;
  }
  stringField(payload, "workspaceId", issues, "payload.workspaceId");
  validateEnum(payload["workKind"], WORK_KINDS as unknown as string[], "payload.workKind", issues);
  if (payload["goalId"] !== null) stringField(payload, "goalId", issues, "payload.goalId");
  if (payload["taskId"] !== null) stringField(payload, "taskId", issues, "payload.taskId");
  const planRef = payload["planRef"];
  if (planRef !== null && !isRecord(planRef)) {
    issues.push({ path: "payload.planRef", code: "bad_type", message: "planRef must be an object or null" });
  }
  if (payload["planRevision"] !== null) numberField(payload, "planRevision", issues, "payload.planRevision", 1);
  validateRoleBindingRef(payload["roleBinding"], "payload.roleBinding", issues);
  validateRunRef(payload["initialRunRef"], "payload.initialRunRef", issues);
  return issues;
}

export function validateLinkWorkRunCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "command must be an object" });
    return issues;
  }
  if (value["commandType"] !== "LinkWorkRun") {
    issues.push({ path: "commandType", code: "invalid_command_type", message: 'commandType must be "LinkWorkRun"' });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "commandId", issues);
  validateCommandIdentity(value["identity"], "identity", issues);
  stringField(value, "aggregateId", issues);
  if (!Number.isSafeInteger(value["expectedRevision"]) || (value["expectedRevision"] as number) < 1) {
    issues.push({ path: "expectedRevision", code: "bad_expected_revision", message: "expectedRevision must be a positive integer (existing binding)" });
  }
  stringField(value, "correlationId", issues);
  stringField(value, "submittedAt", issues);
  const payload = value["payload"];
  if (!isRecord(payload)) {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    return issues;
  }
  stringField(payload, "workspaceId", issues, "payload.workspaceId");
  validateRunRef(payload["runRef"], "payload.runRef", issues);
  return issues;
}

export function validateRecordExecutionNoteCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "command must be an object" });
    return issues;
  }
  if (value["commandType"] !== "RecordExecutionNote") {
    issues.push({ path: "commandType", code: "invalid_command_type", message: 'commandType must be "RecordExecutionNote"' });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "commandId", issues);
  validateCommandIdentity(value["identity"], "identity", issues);
  stringField(value, "aggregateId", issues);
  if (value["expectedRevision"] !== 0) {
    issues.push({ path: "expectedRevision", code: "bad_expected_revision", message: "expectedRevision must be 0" });
  }
  stringField(value, "correlationId", issues);
  stringField(value, "submittedAt", issues);
  const payload = value["payload"];
  if (!isRecord(payload)) {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    return issues;
  }
  for (const issue of validateExecutionNote(payload["note"])) {
    issues.push({ path: "payload.note." + issue.path, code: issue.code, message: issue.message });
  }
  return issues;
}

export function validateRecordContinuationCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "command must be an object" });
    return issues;
  }
  if (value["commandType"] !== "RecordContinuation") {
    issues.push({ path: "commandType", code: "invalid_command_type", message: 'commandType must be "RecordContinuation"' });
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "commandId", issues);
  validateCommandIdentity(value["identity"], "identity", issues);
  stringField(value, "aggregateId", issues);
  if (value["expectedRevision"] !== 0) {
    issues.push({ path: "expectedRevision", code: "bad_expected_revision", message: "expectedRevision must be 0" });
  }
  stringField(value, "correlationId", issues);
  stringField(value, "submittedAt", issues);
  const payload = value["payload"];
  if (!isRecord(payload)) {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    return issues;
  }
  for (const issue of validateContextContinuationResult(payload["result"])) {
    issues.push({ path: "payload.result." + issue.path, code: issue.code, message: issue.message });
  }
  return issues;
}

export function validateWorkContextRequest(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "request must be an object" });
    return issues;
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  const ref = value["workContextRef"];
  if (!isRecord(ref)) {
    issues.push({ path: "workContextRef", code: "bad_type", message: "workContextRef must be an object" });
  } else {
    if (ref["aggregateType"] !== "WorkContextBinding") {
      issues.push({ path: "workContextRef.aggregateType", code: "bad_ref", message: "aggregateType must be WorkContextBinding" });
    }
    stringField(ref, "projectId", issues, "workContextRef.projectId");
    stringField(ref, "workspaceId", issues, "workContextRef.workspaceId");
    stringField(ref, "workId", issues, "workContextRef.workId");
  }
  validateRunRef(value["requestedByRunRef"], "requestedByRunRef", issues);
  validateRoleBindingRef(value["roleBindingRef"], "roleBindingRef", issues);
  validateDeclaredPermissions(value["declaredPermissions"], "declaredPermissions", issues);
  const required = value["requiredMaterial"];
  if (!Array.isArray(required) || required.length === 0) {
    issues.push({ path: "requiredMaterial", code: "bad_type", message: "requiredMaterial must be a non-empty array" });
  }
  numberField(value, "maxBundleBytes", issues, "maxBundleBytes", 1);
  if (!Array.isArray(value["noteKinds"])) {
    issues.push({ path: "noteKinds", code: "bad_type", message: "noteKinds must be an array" });
  }
  if (!Number.isSafeInteger(value["maxNotes"]) || (value["maxNotes"] as number) < 1) {
    issues.push({ path: "maxNotes", code: "bad_type", message: "maxNotes must be a positive integer" });
  }
  return issues;
}

export function validateContinuationCheckRequest(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "request must be an object" });
    return issues;
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  const ref = value["workContextRef"];
  if (!isRecord(ref)) {
    issues.push({ path: "workContextRef", code: "bad_type", message: "workContextRef must be an object" });
  }
  if (value["requestedByRunRef"] !== null) validateRunRef(value["requestedByRunRef"], "requestedByRunRef", issues);
  if (value["originalRunRef"] !== null) validateRunRef(value["originalRunRef"], "originalRunRef", issues);
  numberField(value, "workspaceRevision", issues, "workspaceRevision", 1);
  if (value["planRevision"] !== null) numberField(value, "planRevision", issues, "planRevision", 1);
  return issues;
}


