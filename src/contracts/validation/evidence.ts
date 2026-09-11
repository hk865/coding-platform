/** evidence protocol schema validation. Structural checks do not grant authority. */
import { EVIDENCE_KINDS, EVIDENCE_OUTCOMES, EVIDENCE_SUMMARY_MAX_BYTES } from '../evidence.js';
import type { ValidationIssue, UnknownRecord } from './common.js';
import { isRecord, stringField } from './common.js';
import { validateActor, validateCommandIdentity } from './identity.js';
import { validatePin } from './governance.js';

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
