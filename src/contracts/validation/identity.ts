/** identity protocol schema validation. Structural checks do not grant authority. */
import type { ValidationIssue } from './common.js';
import { isRecord, stringField } from './common.js';

export function validateActor(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, code: "bad_type", message: `${path} must be an object` });
    return;
  }
  const kind = value["kind"];
  // 协作通信 Agent 归因与工具边界：agent 是第三种**归因**（不是授权）。
  if (kind !== "human" && kind !== "system" && kind !== "agent") {
    issues.push({ path: `${path}.kind`, code: "bad_type", message: "kind must be human|system|agent" });
  }
  stringField(value, "id", issues, `${path}.id`);
  if (kind === "agent") {
    const runRef = value["runRef"];
    if (!isRecord(runRef) || typeof runRef["runId"] !== "string" || runRef["runId"].length === 0 ||
        typeof runRef["goalId"] !== "string" || runRef["goalId"].length === 0 ||
        typeof runRef["projectId"] !== "string" || runRef["projectId"].length === 0) {
      issues.push({ path: `${path}.runRef`, code: "bad_type", message: "agent actor requires an exact runRef" });
    }
  }
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
