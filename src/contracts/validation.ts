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
  | "unknown_event_type"
  | "bad_revision"
  | "invalid_fixture"
  | "empty_collection"
  | "unknown_task_ref"
  | "unknown_stage_ref"
  | "unknown_obligation_ref"
  | "bad_scope";

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
    eventType === "CompletionPolicyActivated" || eventType === "ArchitectureBaselineActivated";
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
  validateStringArray(value["requirementKinds"], path + ".requirementKinds", issues);
  safePositiveIntField(value["minimumRequiredRequirementsPerObligation"], path + ".minimumRequiredRequirementsPerObligation", issues);
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