export class PathPolicyError extends Error {
    code;
    constructor(code) {
        super("路径不在允许的 workspace 范围内");
        this.code = code;
        this.name = "PathPolicyError";
    }
}
export function normalizeWorkspacePath(value, allowRoot = false) {
    if (value.includes("\0"))
        throw new PathPolicyError("nul");
    if (value.includes("\\"))
        throw new PathPolicyError("ambiguous_separator");
    if (value.startsWith("/") || /^[A-Za-z]:/.test(value))
        throw new PathPolicyError("absolute");
    const segments = value.split("/");
    if (segments.some((segment) => segment === ".."))
        throw new PathPolicyError("parent_escape");
    const normalized = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
    if (!allowRoot && normalized.length === 0)
        throw new PathPolicyError("empty");
    return normalized || ".";
}
function isWithin(path, prefix) {
    return path === prefix || path.startsWith(`${prefix}/`);
}
export class DefaultPermissionPolicy {
    policyVersion;
    #registeredReadOnlyTools;
    #hostAuthorizedTools;
    #hiddenPrefixes;
    #secretNames;
    constructor(config = {}) {
        this.#registeredReadOnlyTools = new Set(config.registeredReadOnlyTools ?? []);
        this.#hostAuthorizedTools = new Set(config.hostAuthorizedTools ?? []);
        this.policyVersion = config.policyVersion ?? "m3-v1";
        this.#hiddenPrefixes = (config.hiddenPrefixes ?? [".evaluator", ".oracle", "hidden-tests"])
            .map((value) => normalizeWorkspacePath(value))
            .sort();
        this.#secretNames = new Set(config.secretNames ?? [".env", ".env.local", "credentials", "credentials.json"]);
    }
    evaluate(candidate) {
        let operation;
        try {
            operation = {
                ...candidate,
                paths: candidate.paths.map((path) => normalizeWorkspacePath(path)),
                cwd: candidate.cwd === null ? null : normalizeWorkspacePath(candidate.cwd, true),
            };
        }
        catch {
            return this.#decision("deny", "path_outside_workspace", "请求路径不在允许范围", null);
        }
        if (this.#isSensitive(operation.paths) ||
            (operation.cwd && this.#isSensitive([operation.cwd]))) {
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
            return this.#decision("ask", "workspace_write_requires_approval", "修改文件需要审批", operation);
        }
        if (operation.effectClass === "process" && operation.tool === "shell") {
            return this.#decision("ask", "process_requires_approval", "运行命令需要审批", operation);
        }
        if (operation.effectClass === "read_only" && this.#registeredReadOnlyTools.has(operation.tool) && operation.capabilities.includes("workspace_read") && operation.capabilities.every(c => c === "workspace_read")) {
            return this.#decision("allow", "registered_workspace_read", "允许已注册的 workspace 只读分析", operation);
        }
        // 宿主显式授权的非只读扩展工具：授权来自组合入口的显式列名（不是工具自报只读），
        // 且只对本轮确实注册过的扩展工具生效（见 composition-root）。上面所有规则——
        // 路径/敏感资源、内置 read/check/edit/shell——都已先行判定，因此这条分支无法用来
        // 绕过文件写入审批或进程审批。
        if (operation.effectClass !== "read_only" && this.#hostAuthorizedTools.has(operation.tool)) {
            return this.#decision("allow", "host_authorized_tool", "宿主显式授权的扩展工具能力", operation);
        }
        return this.#decision("deny", "unknown_operation", "未知操作默认拒绝", operation);
    }
    #isSensitive(paths) {
        return paths.some((path) => {
            const basename = path.split("/").at(-1) ?? path;
            return (this.#secretNames.has(basename) ||
                this.#hiddenPrefixes.some((prefix) => isWithin(path, prefix)));
        });
    }
    #decision(decision, reasonCode, summary, operation) {
        return { decision, reasonCode, summary, policyVersion: this.policyVersion, operation };
    }
}
//# sourceMappingURL=permission-policy.js.map