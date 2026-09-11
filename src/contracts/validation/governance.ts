/** governance protocol schema validation. Structural checks do not grant authority. */
import { architectureSourceIssues } from '../architecture-source.js';
import type { ValidationIssue, UnknownRecord } from './common.js';
import { isRecord, stringField, safePositiveIntField, validateStringArray } from './common.js';
import { validateCommandIdentity } from './identity.js';

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
  if (value['sourceBinding'] !== undefined) for (const message of architectureSourceIssues(value['sourceBinding'])) issues.push({path: path + '.sourceBinding', code: 'bad_binding_ref', message});
  if (value['dependencyRules'] !== undefined) {
    const rules = value['dependencyRules'];
    if (!Array.isArray(rules) || rules.length > 128) issues.push({path:path+'.dependencyRules',code:'bad_type',message:'dependencyRules must be an array <= 128'});
    else {
      const ids = new Set<string>();
      const binding = value['sourceBinding'];
      const mappings = isRecord(binding) && Array.isArray(binding['mappings']) ? binding['mappings'] : [];
      const modules = new Set(mappings.filter(isRecord).filter(m=>m['kind']==='module').map(m=>m['id']));
      for (const rule of rules) {
        if (!isRecord(rule) || rule['kind'] !== 'forbid_dependency' || typeof rule['ruleId'] !== 'string' || !rule['ruleId'] || ids.has(rule['ruleId']) || !modules.has(rule['fromModule']) || !modules.has(rule['toModule'])) issues.push({path:path+'.dependencyRules',code:'bad_binding_ref',message:'rule must uniquely identify explicit source-mapped modules'});
        else ids.add(rule['ruleId']);
      }
    }
  }
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

export function validatePin(value: unknown, path: string, issues: ValidationIssue[], kind: "policy" | "baseline" | "evolution"): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: path + " must be an object" });
    return;
  }
  const ref = value["ref"];
  if (!isRecord(ref)) {
    issues.push({ path: path + ".ref", code: "bad_type", message: path + ".ref must be an object" });
    return;
  }
  const expectedAgg = kind === "policy" ? "CompletionPolicyRevision" : kind === "baseline" ? "ArchitectureBaselineRevision" : "ArchitectureEvolutionPolicyRevision";
  if (ref["aggregateType"] !== expectedAgg) {
    issues.push({ path: path + ".ref.aggregateType", code: "bad_type", message: "unexpected target aggregateType" });
  }
  stringField(ref, "projectId", issues, path + ".ref.projectId");
  stringField(ref, kind === "baseline" ? "baselineId" : "policyId", issues, path + ".ref." + (kind === "baseline" ? "baselineId" : "policyId"));
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

export function validateArchitectureEvolutionPolicyFixture(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "VersionedArchitectureEvolutionPolicyFixture must be an object" });
    return issues;
  }
  if (value["schemaVersion"] !== 1) {
    issues.push({ path: "schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  }
  if (value["contentType"] !== "ArchitectureEvolutionPolicy") {
    issues.push({ path: "contentType", code: "bad_type", message: "contentType must be ArchitectureEvolutionPolicy" });
  }
  const identity = value["identity"];
  if (isRecord(identity)) {
    if (identity["kind"] !== "local") issues.push({ path: "identity.kind", code: "bad_type", message: "identity.kind must be local" });
    stringField(identity, "fixtureId", issues, "identity.fixtureId");
    stringField(identity, "source", issues, "identity.source");
  } else {
    issues.push({ path: "identity", code: "bad_type", message: "identity must be an object" });
  }
  safePositiveIntField(value["revision"], "revision", issues);
  const content = value["content"];
  if (isRecord(content)) {
    validateArchitectureEvolutionPolicyContent(content, issues);
  } else {
    issues.push({ path: "content", code: "bad_type", message: "content must be an object" });
  }
  return issues;
}

function validateArchitectureEvolutionPolicyContent(value: UnknownRecord, issues: ValidationIssue[]): void {
  if (value["schemaVersion"] !== 1) issues.push({ path: "content.schemaVersion", code: "unknown_schema_version", message: "only schemaVersion 1 is supported" });
  const allowlist = value["allowlist"];
  if (!Array.isArray(allowlist) || allowlist.length === 0 || allowlist.length > 64) {
    issues.push({ path: "content.allowlist", code: "empty_collection", message: "allowlist must be 1..64 entries" });
  } else {
    const categories = new Set(["structure", "interface", "dependency", "performance", "permission", "runtime", "governance"]);
    const scopes = new Set(["module", "interface", "runtime", "governance"]);
    const risks = new Set(["high", "medium", "low"]);
    const revers = new Set(["reversible", "manual_only"]);
    allowlist.forEach((entry, i) => {
      if (!isRecord(entry)) {
        issues.push({ path: "content.allowlist[" + i + "]", code: "bad_type", message: "entry must be an object" });
        return;
      }
      if (!categories.has(String(entry["findingCategory"]))) issues.push({ path: "content.allowlist[" + i + "].findingCategory", code: "bad_type", message: "unexpected findingCategory" });
      if (!scopes.has(String(entry["scope"]))) issues.push({ path: "content.allowlist[" + i + "].scope", code: "bad_type", message: "unexpected scope" });
      if (!risks.has(String(entry["maxRisk"]))) issues.push({ path: "content.allowlist[" + i + "].maxRisk", code: "bad_type", message: "unexpected maxRisk" });
      if (!revers.has(String(entry["reversibility"]))) issues.push({ path: "content.allowlist[" + i + "].reversibility", code: "bad_type", message: "unexpected reversibility" });
      stringField(entry, "note", issues, "content.allowlist[" + i + "].note");
    });
  }
  const drift = value["driftBudget"];
  if (!isRecord(drift)) {
    issues.push({ path: "content.driftBudget", code: "bad_type", message: "driftBudget must be an object" });
  } else {
    const n = Number(drift["maxRemediationsPerCycle"]);
    if (!Number.isSafeInteger(n) || n < 1 || n > 12) issues.push({ path: "content.driftBudget.maxRemediationsPerCycle", code: "bad_type", message: "must be 1..12" });
  }
  const upgrade = value["upgrade"];
  if (isRecord(upgrade)) {
    if (upgrade["path"] !== "manual-decision" && upgrade["path"] !== "proposal") issues.push({ path: "content.upgrade.path", code: "bad_type", message: "unexpected upgrade path" });
    stringField(upgrade, "note", issues, "content.upgrade.note");
  } else {
    issues.push({ path: "content.upgrade", code: "bad_type", message: "upgrade must be an object" });
  }
}

export function validateInstallArchitectureEvolutionPolicyRevisionCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "command must be an object" });
    return issues;
  }
  validateGovernanceInstallCommon(value, "InstallArchitectureEvolutionPolicyRevision", issues);
  const payload = value["payload"];
  if (isRecord(payload)) {
    issues.push(...validateArchitectureEvolutionPolicyFixture(payload["fixture"]));
    validateContentDigest(payload, "payload", issues);
  } else {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
  }
  return issues;
}

export function validateActivateProjectArchitectureEvolutionPolicyCommand(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    issues.push({ path: "$", code: "bad_type", message: "command must be an object" });
    return issues;
  }
  validateActivateCommon(value, "ActivateProjectArchitectureEvolutionPolicy", issues);
  const payload = value["payload"];
  if (isRecord(payload)) {
    validatePin(payload["target"], "payload.target", issues, "evolution");
  } else {
    issues.push({ path: "payload", code: "bad_type", message: "payload must be an object" });
  }
  return issues;
}
