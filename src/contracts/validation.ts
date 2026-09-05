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
  | "unknown_event_type";

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
  if (value["aggregateRevision"] !== 1) {
    issues.push({
      path: "aggregateRevision",
      code: "bad_type",
      message: "aggregateRevision must be 1 for v1 creation events",
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