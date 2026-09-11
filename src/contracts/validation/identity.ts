/** identity protocol schema validation. Structural checks do not grant authority. */
import type { ValidationIssue } from './common.js';
import { isRecord, stringField } from './common.js';

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
