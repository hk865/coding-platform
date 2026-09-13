/** architecture protocol schema validation. Structural checks do not grant authority. */
import { canonicalJson } from '../fingerprint.js';
import { INSPECTION_BRIEF_MAX_BYTES, INSPECTION_FINDING_MAX_BYTES, INSPECTION_FINDING_SUMMARY_MAX_BYTES, INSPECTION_MAX_OPTIONS, INSPECTION_MAX_REASONS, INSPECTION_MAX_SOURCES } from '../architecture-inspection.js';
import type { ValidationIssue } from './common.js';
import { isRecord, stringField, validateEnum, numberField, rejectUnknownFields } from './common.js';
import { validateCommandIdentity } from './identity.js';
import { validateArchitectureBaselineContent } from './governance.js';
import { validateRunRef } from './dispatch.js';
import { validateArtifactRefRef } from './evidence.js';

const INSPECTION_INTENT_KEYS = [
  "schemaVersion", "inspectionId", "projectId", "workspaceId", "workspaceRevision",
  "planRef", "baselinePin", "source", "requestedByRunRef", "reportInput", "budget",
] as const;

/** STRICT intent validator: known fields only; plan pin required; budget bounded. */
export function validateArchitectureInspectionIntent(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "ArchitectureInspectionIntent must be an object" });
    return issues;
  }
  rejectUnknownFields(value, INSPECTION_INTENT_KEYS, "$", issues);
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "inspectionId", issues);
  stringField(value, "projectId", issues);
  stringField(value, "workspaceId", issues);
  numberField(value, "workspaceRevision", issues, "workspaceRevision", 1);
  const planRef = value["planRef"];
  if (!isRecord(planRef)) {
    issues.push({ path: "planRef", code: "bad_type", message: "planRef must be an object" });
  } else {
    if (planRef["aggregateType"] !== "PlanRevision") {
      issues.push({ path: "planRef.aggregateType", code: "bad_ref", message: "aggregateType must be PlanRevision" });
    }
    stringField(planRef, "planId", issues, "planRef.planId");
  }
  validateArchitectureBaselinePin(value["baselinePin"], "baselinePin", issues);
  validateEnum(value["source"], ["mechanic", "report"], "source", issues);
  if (value["requestedByRunRef"] !== null) validateRunRef(value["requestedByRunRef"], "requestedByRunRef", issues);
  const reportInput = value["reportInput"];
  if (reportInput !== null && !isRecord(reportInput)) {
    issues.push({ path: "reportInput", code: "bad_type", message: "reportInput must be an object or null" });
  }
  const budget = value["budget"];
  if (!isRecord(budget)) {
    issues.push({ path: "budget", code: "bad_type", message: "budget must be an object" });
  } else {
    if (budget['maxTokens'] !== null) numberField(budget, "maxTokens", issues, "budget.maxTokens", 1);
    if (budget["deadline"] !== null && typeof budget["deadline"] !== "string") {
      issues.push({ path: "budget.deadline", code: "bad_type", message: "deadline must be a string or null" });
    }
  }
  return issues;
}

function validateArchitectureBaselinePin(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be an object" });
    return;
  }
  const ref = value["ref"];
  if (!isRecord(ref)) {
    issues.push({ path: path + ".ref", code: "bad_type", message: "ref must be an object" });
    return;
  }
  if (ref["aggregateType"] !== "ArchitectureBaselineRevision") {
    issues.push({ path: path + ".ref.aggregateType", code: "bad_ref", message: "aggregateType must be ArchitectureBaselineRevision" });
  }
  stringField(ref, "projectId", issues, path + ".ref.projectId");
  stringField(ref, "baselineId", issues, path + ".ref.baselineId");
  numberField(ref, "revision", issues, path + ".ref.revision", 1);
  if (typeof value["digest"] !== "string" || value["digest"].length === 0 || value["digest"].length > 128) {
    issues.push({ path: path + ".digest", code: "bad_type", message: "digest must be a non-empty string <= 128 chars" });
  }
}

const FINDING_KEYS = [
  "schemaVersion", "findingId", "projectId", "workspaceId", "workspaceRevision",
  "planRef", "baselinePin", "source", "deltaRef", "category", "risk", "confidence",
  "title", "summary", "sources", "recommendation", "affectedRefs", "material", "ambiguous", "generatedAt",
] as const;

export function validateArchitectureFinding(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "ArchitectureFinding must be an object" });
    return issues;
  }
  rejectUnknownFields(value, FINDING_KEYS, "$", issues);
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "findingId", issues);
  stringField(value, "projectId", issues);
  stringField(value, "workspaceId", issues);
  numberField(value, "workspaceRevision", issues, "workspaceRevision", 1);
  validateEnum(value["source"], ["workspace_delta", "interface_report", "performance", "permission", "runtime_evidence"], "source", issues);
  if (value["deltaRef"] !== null) validateArtifactRefRef(value["deltaRef"], "deltaRef", issues);
  validateEnum(value["category"], ["structure", "interface", "dependency", "performance", "permission", "runtime", "governance"], "category", issues);
  validateEnum(value["risk"], ["high", "medium", "low"], "risk", issues);
  validateEnum(value["confidence"], ["high", "medium", "low"], "confidence", issues);
  stringField(value, "title", issues);
  const summary = stringField(value, "summary", issues);
  if (summary !== null && Buffer.byteLength(summary, "utf8") > INSPECTION_FINDING_SUMMARY_MAX_BYTES) {
    issues.push({ path: "summary", code: "size_exceeded", message: "summary exceeds " + INSPECTION_FINDING_SUMMARY_MAX_BYTES + " bytes" });
  }
  const sources = value["sources"];
  if (!Array.isArray(sources) || sources.length > INSPECTION_MAX_SOURCES) {
    issues.push({ path: "sources", code: "size_exceeded", message: "sources must be an array <= " + INSPECTION_MAX_SOURCES });
  }
  const affected = value["affectedRefs"];
  if (!isRecord(affected)) {
    issues.push({ path: "affectedRefs", code: "bad_type", message: "affectedRefs must be an object" });
  }
  if (typeof value["material"] !== "boolean" || typeof value["ambiguous"] !== "boolean") {
    issues.push({ path: "material/ambiguous", code: "bad_type", message: "material and ambiguous must be booleans" });
  }
  stringField(value, "generatedAt", issues);
  if (issues.length === 0) {
    const size = Buffer.byteLength(canonicalJson(value as never), "utf8");
    if (size > INSPECTION_FINDING_MAX_BYTES) {
      issues.push({ path: "$", code: "size_exceeded", message: "finding serialized size " + size + " exceeds " + INSPECTION_FINDING_MAX_BYTES });
    }
  }
  return issues;
}

const BRIEF_KEYS = [
  "schemaVersion", "briefId", "projectId", "workspaceId", "planRef", "baselinePin",
  "findingRefs", "originalReasons", "impact", "options", "risk", "deferralConsequence", "bodyRef", "generatedAt",
] as const;

export function validateArchitectureDecisionBrief(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "ArchitectureDecisionBrief must be an object" });
    return issues;
  }
  rejectUnknownFields(value, BRIEF_KEYS, "$", issues);
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "briefId", issues);
  stringField(value, "projectId", issues);
  stringField(value, "workspaceId", issues);
  const findingRefs = value["findingRefs"];
  if (!Array.isArray(findingRefs) || findingRefs.length < 1 || findingRefs.length > 16) {
    issues.push({ path: "findingRefs", code: "bad_type", message: "findingRefs must be a non-empty array <= 16" });
  }
  const reasons = value["originalReasons"];
  if (!Array.isArray(reasons) || reasons.length > INSPECTION_MAX_REASONS) {
    issues.push({ path: "originalReasons", code: "size_exceeded", message: "originalReasons must be an array <= " + INSPECTION_MAX_REASONS });
  }
  const options = value["options"];
  if (!Array.isArray(options) || options.length < 1 || options.length > INSPECTION_MAX_OPTIONS) {
    issues.push({ path: "options", code: "bad_type", message: "options must be a non-empty array <= " + INSPECTION_MAX_OPTIONS });
  }
  validateEnum(value["risk"], ["high", "medium", "low"], "risk", issues);
  stringField(value, "deferralConsequence", issues);
  validateArtifactRefRef(value["bodyRef"], "bodyRef", issues);
  stringField(value, "generatedAt", issues);
  if (issues.length === 0) {
    const size = Buffer.byteLength(canonicalJson(value as never), "utf8");
    if (size > INSPECTION_BRIEF_MAX_BYTES) {
      issues.push({ path: "$", code: "size_exceeded", message: "brief serialized size " + size + " exceeds " + INSPECTION_BRIEF_MAX_BYTES });
    }
  }
  return issues;
}

const PROPOSAL_KEYS = [
  "schemaVersion", "proposalId", "projectId", "workspaceId", "planRef",
  "sourceBaselinePin", "selectedDeltaRef", "selectedOptionId", "normalizedContent",
  "proposalDigest", "expectedCandidateDigest", "bodyRef", "generatedAt",
] as const;

export function validateArchitectureCandidateProposal(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "ArchitectureCandidateProposal must be an object" });
    return issues;
  }
  rejectUnknownFields(value, PROPOSAL_KEYS, "$", issues);
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  stringField(value, "proposalId", issues);
  stringField(value, "projectId", issues);
  stringField(value, "workspaceId", issues);
  validateArchitectureBaselinePin(value["sourceBaselinePin"], "sourceBaselinePin", issues);
  validateArtifactRefRef(value["selectedDeltaRef"], "selectedDeltaRef", issues);
  stringField(value, "selectedOptionId", issues);
  const content = value["normalizedContent"];
  if (!isRecord(content)) {
    issues.push({ path: "normalizedContent", code: "bad_type", message: "normalizedContent must be an object" });
  } else {
    validateArchitectureBaselineContent({ ...content, schemaVersion: 1 }, 'normalizedContent', issues);
  }
  stringField(value, "proposalDigest", issues);
  stringField(value, "expectedCandidateDigest", issues);
  validateArtifactRefRef(value["bodyRef"], "bodyRef", issues);
  stringField(value, "generatedAt", issues);
  return issues;
}

function validateP112CommandShape(value: unknown, commandType: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "command must be an object" });
    return;
  }
  if (value["commandType"] !== commandType) {
    issues.push({ path: "commandType", code: "invalid_command_type", message: "commandType must be " + commandType });
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
}

export function validateRecordArchitectureInspectionCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateP112CommandShape(value, "RecordArchitectureInspection", issues);
  const payload = isRecord(value) ? value["payload"] : undefined;
  if (!isRecord(payload)) {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    return issues;
  }
  const inspection = payload["inspection"];
  if (isRecord(inspection)) {
    if (inspection["intent"] === undefined) {
      issues.push({ path: "payload.inspection.intent", code: "missing_field", message: "intent is required" });
    } else {
      for (const issue of validateArchitectureInspectionIntent(inspection["intent"])) {
        issues.push({ path: "payload.inspection.intent." + issue.path, code: issue.code, message: issue.message });
      }
    }
    if (inspection["snapshotRef"] !== null) validateArtifactRefRef(inspection["snapshotRef"], "payload.inspection.snapshotRef", issues);
    if (inspection["deltaRef"] !== null) validateArtifactRefRef(inspection["deltaRef"], "payload.inspection.deltaRef", issues);
  } else {
    issues.push({ path: "payload.inspection", code: "bad_type", message: "inspection must be an object" });
  }
  return issues;
}

export function validateRecordArchitectureFindingCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateP112CommandShape(value, "RecordArchitectureFinding", issues);
  const payload = isRecord(value) ? value["payload"] : undefined;
  if (!isRecord(payload)) {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    return issues;
  }
  for (const issue of validateArchitectureFinding(payload["finding"])) {
    issues.push({ path: "payload.finding." + issue.path, code: issue.code, message: issue.message });
  }
  return issues;
}

export function validateRecordArchitectureDecisionBriefCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateP112CommandShape(value, "RecordArchitectureDecisionBrief", issues);
  const payload = isRecord(value) ? value["payload"] : undefined;
  if (!isRecord(payload)) {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    return issues;
  }
  for (const issue of validateArchitectureDecisionBrief(payload["brief"])) {
    issues.push({ path: "payload.brief." + issue.path, code: issue.code, message: issue.message });
  }
  return issues;
}

export function validateRecordCandidateBaselineProposalCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateP112CommandShape(value, "RecordCandidateBaselineProposal", issues);
  const payload = isRecord(value) ? value["payload"] : undefined;
  if (!isRecord(payload)) {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
    return issues;
  }
  for (const issue of validateArchitectureCandidateProposal(payload["proposal"])) {
    issues.push({ path: "payload.proposal." + issue.path, code: issue.code, message: issue.message });
  }
  return issues;
}
