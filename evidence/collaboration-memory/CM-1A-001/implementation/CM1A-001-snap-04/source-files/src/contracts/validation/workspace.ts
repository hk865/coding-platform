/** workspace protocol schema validation. Structural checks do not grant authority. */
import { CONFLICT_SCOPE_KINDS } from '../workspace-lease.js';
import type { ValidationIssue } from './common.js';
import { isRecord, stringField, validateEnum } from './common.js';
import { validateCommandIdentity } from './identity.js';
import { validateRunRef } from './dispatch.js';

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
