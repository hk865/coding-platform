/**
 * DSEC2 P1 (A5 pure rule): the permission policy's secret-name check ignores case.
 *
 * Today the dist `#isSensitive` compares the basename exactly with `Set.has`, so P1-1's six
 * case variants come back allow/workspace_read; P1-2's five entries already pass. They turn
 * green once the managed `permission-policy.ts` patch lowercases the basename and
 * `build-kernel-patch --write` regenerates the dist.
 */
import { describe, expect, it } from "vitest";
import { DefaultPermissionPolicy } from "../../vendor/coding-agent/dist/public-api.js";

const policy = new DefaultPermissionPolicy({ policyVersion: "dsec2" });
const base = {
  runId: "r", callId: "c", tool: "read", effectClass: "read_only", arguments: {},
  cwd: null, commandPreview: null, capabilities: ["workspace_read"],
  workspaceIdentity: "w", workspaceRevision: "v", sandboxProfileVersion: "s",
} as const;

const rows: ReadonlyArray<readonly [string, string, string, string]> = [
  ["P1-1 .ENV -> deny/sensitive_path", ".ENV", "deny", "sensitive_path"],
  ["P1-1 .Env -> deny/sensitive_path", ".Env", "deny", "sensitive_path"],
  ["P1-1 .ENV.LOCAL -> deny/sensitive_path", ".ENV.LOCAL", "deny", "sensitive_path"],
  ["P1-1 Credentials -> deny/sensitive_path", "Credentials", "deny", "sensitive_path"],
  ["P1-1 CREDENTIALS -> deny/sensitive_path", "CREDENTIALS", "deny", "sensitive_path"],
  ["P1-1 CREDENTIALS.JSON -> deny/sensitive_path", "CREDENTIALS.JSON", "deny", "sensitive_path"],
  ["P1-2 .env -> deny/sensitive_path", ".env", "deny", "sensitive_path"],
  ["P1-2 .env.local -> deny/sensitive_path", ".env.local", "deny", "sensitive_path"],
  ["P1-2 credentials -> deny/sensitive_path", "credentials", "deny", "sensitive_path"],
  ["P1-2 credentials.json -> deny/sensitive_path", "credentials.json", "deny", "sensitive_path"],
  ["P1-2 README.md -> allow/workspace_read", "README.md", "allow", "workspace_read"],
];

describe("DSEC2 P1 secret-name case", () => {
  it.each(rows)("%s", (_name, p, decision, reasonCode) => {
    const result = policy.evaluate({ ...base, paths: [p] });
    expect(result.decision).toBe(decision);
    expect(result.reasonCode).toBe(reasonCode);
  });
});
