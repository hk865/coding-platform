/**
 * 模块职责：规范化工具操作并根据路径、效果类型和敏感资源生成 allow、deny 或 ask 决策。
 *
 * 设计边界：策略不执行工具，也不弹出审批界面；未知操作采用默认拒绝。
 * 关键流程：先阻止绝对路径和目录逃逸，再检查敏感资源，最后按读、写、进程规则决策。
 */
import type { JsonObject } from "../../core/context/types/context-types.js";
import type { SandboxCapability, ToolEffectClass } from "../../tools/schemas/tool-schemas.js";

export type PermissionDecisionKind = "allow" | "deny" | "ask";

export interface ToolOperation {
  readonly runId: string;
  readonly callId: string;
  readonly tool: string;
  readonly effectClass: ToolEffectClass;
  readonly arguments: Readonly<JsonObject>;
  readonly paths: readonly string[];
  readonly cwd: string | null;
  readonly commandPreview: string | null;
  readonly capabilities: readonly SandboxCapability[];
  readonly workspaceIdentity: string;
  readonly workspaceRevision: string;
  readonly sandboxProfileVersion: string;
}

export interface NormalizedToolOperation extends Omit<ToolOperation, "paths" | "cwd"> {
  readonly paths: readonly string[];
  readonly cwd: string | null;
}

export interface PermissionDecision {
  readonly decision: PermissionDecisionKind;
  readonly reasonCode: string;
  readonly summary: string;
  readonly policyVersion: string;
  readonly operation: NormalizedToolOperation | null;
}

export interface PermissionPolicyConfig {
  /** Host-selected, enabled tools with read-only workspace capability. */
  readonly registeredReadOnlyTools?: readonly string[];
  readonly policyVersion?: string;
  readonly hiddenPrefixes?: readonly string[];
  readonly secretNames?: readonly string[];
}

export class PathPolicyError extends Error {
  constructor(readonly code: string) {
    super("路径不在允许的 workspace 范围内");
    this.name = "PathPolicyError";
  }
}

export function normalizeWorkspacePath(value: string, allowRoot = false): string {
  if (value.includes("\0")) throw new PathPolicyError("nul");
  if (value.includes("\\")) throw new PathPolicyError("ambiguous_separator");
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) throw new PathPolicyError("absolute");
  const segments = value.split("/");
  if (segments.some((segment) => segment === "..")) throw new PathPolicyError("parent_escape");
  const normalized = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
  if (!allowRoot && normalized.length === 0) throw new PathPolicyError("empty");
  return normalized || ".";
}

function isWithin(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export class DefaultPermissionPolicy {
  readonly policyVersion: string;
  readonly #registeredReadOnlyTools: ReadonlySet<string>;
  readonly #hiddenPrefixes: readonly string[];
  readonly #secretNames: ReadonlySet<string>;

  constructor(config: PermissionPolicyConfig = {}) {
    this.#registeredReadOnlyTools = new Set(config.registeredReadOnlyTools ?? []);
    this.policyVersion = config.policyVersion ?? "m3-v1";
    this.#hiddenPrefixes = (config.hiddenPrefixes ?? [".evaluator", ".oracle", "hidden-tests"])
      .map((value) => normalizeWorkspacePath(value))
      .sort();
    this.#secretNames = new Set(
      config.secretNames ?? [".env", ".env.local", "credentials", "credentials.json"],
    );
  }

  evaluate(candidate: ToolOperation): PermissionDecision {
    let operation: NormalizedToolOperation;
    try {
      operation = {
        ...candidate,
        paths: candidate.paths.map((path) => normalizeWorkspacePath(path)),
        cwd: candidate.cwd === null ? null : normalizeWorkspacePath(candidate.cwd, true),
      };
    } catch {
      return this.#decision("deny", "path_outside_workspace", "请求路径不在允许范围", null);
    }

    if (
      this.#isSensitive(operation.paths) ||
      (operation.cwd && this.#isSensitive([operation.cwd]))
    ) {
      return this.#decision("deny", "sensitive_path", "请求触及受保护资源", operation);
    }
    if (operation.effectClass === "read_only" && operation.tool === "read") {
      return this.#decision("allow", "workspace_read", "允许读取 workspace 文件", operation);
    }
    if (operation.effectClass === "read_only" && operation.tool === "check") {
      return this.#decision("allow", "workspace_check", "允许对账 workspace 状态", operation);
    }
    if (operation.effectClass === "workspace_write" && operation.tool === "edit") {
      if (operation.paths.some((path) => isWithin(path, ".git"))) {
        return this.#decision("deny", "git_write_denied", "不允许修改版本库内部数据", operation);
      }
      return this.#decision(
        "ask",
        "workspace_write_requires_approval",
        "修改文件需要审批",
        operation,
      );
    }
    if (operation.effectClass === "process" && operation.tool === "shell") {
      return this.#decision("ask", "process_requires_approval", "运行命令需要审批", operation);
    }
    if (operation.effectClass === "read_only" && this.#registeredReadOnlyTools.has(operation.tool) && operation.capabilities.includes("workspace_read") && operation.capabilities.every(c => c === "workspace_read")) {
      return this.#decision("allow", "registered_workspace_read", "允许已注册的 workspace 只读分析", operation);
    }
    return this.#decision("deny", "unknown_operation", "未知操作默认拒绝", operation);
  }

  #isSensitive(paths: readonly string[]): boolean {
    return paths.some((path) => {
      const basename = path.split("/").at(-1) ?? path;
      return (
        this.#secretNames.has(basename) ||
        this.#hiddenPrefixes.some((prefix) => isWithin(path, prefix))
      );
    });
  }

  #decision(
    decision: PermissionDecisionKind,
    reasonCode: string,
    summary: string,
    operation: NormalizedToolOperation | null,
  ): PermissionDecision {
    return { decision, reasonCode, summary, policyVersion: this.policyVersion, operation };
  }
}
