/**
 * 模块职责：实现通过 ProcessSandbox 运行命令的内置 shell 工具。
 *
 * 设计边界：命令必须先经过权限与审批；此处只处理已授权调用和资源上限。
 * 关键流程：校验命令、参数和 cwd，交给进程沙箱执行，再映射退出、取消和输出截断。
 */
import { z } from "zod";
import { ProcessSandboxError } from "../../../sandbox/process/process-sandbox.js";
export const shellToolInputSchema = z
    .object({
    command: z.string().min(1).describe("Non-interactive bash command to run"),
    cwd: z
        .string()
        .optional()
        .describe("Workspace-relative working directory; defaults to workspace root"),
    timeoutMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Expected duration in milliseconds. The platform never stops the command at this time; a command running past it, or past the project review line, is shown to the person. To bound a command yourself, prefix it with `timeout <seconds>`."),
})
    .strict();
const NONE = {
    sideEffect: "none",
    changedPaths: [],
    workspaceRevision: null,
    artifactRefs: [],
};
/** 121-112：命令不按时间停。Node 计时器能表示的最长时间（约 24.8 天），只为满足“正整数”的定义格式；平台的 `COMMAND_NO_STOP_MS` 是同一数值的另一份（Kernel 不能 import 平台代码）。 */
const SHELL_NO_STOP_MS = 2_147_483_647;
/** 定义上限：调度器按整个序列化结果的字节数拒收，处理器先自己收缩到这条线以内。 */
const SHELL_OUTPUT_LIMIT_BYTES = 128 * 1024;
/** L10：非 0 退出的消息末尾按上限事件加尾注；成功和取消不加。 */
function resourceCapTail(report) {
    if (report === undefined || report.status !== "applied")
        return "";
    return `${report.memory === "cap_hit" ? "（超出内存上限）" : ""}${report.processes === "cap_hit" ? "（有新进程或线程被任务数上限拒绝）" : ""}`;
}
/**
 * 121-112：定义上限按整个序列化结果的字节数算，处理器先自己收缩到这条线以内。
 * 只截 JSON 里的 stderr 文本和 text 部分的 stdout，别的字段不动；两处都按最长可放下的前缀截。
 */
function fitOutput(output, limitBytes) {
    const fits = () => Buffer.byteLength(JSON.stringify(output), "utf8") <= limitBytes;
    if (fits())
        return output;
    const textPart = output.find((part) => part.kind === "text");
    const jsonPart = output.find((part) => part.kind === "json");
    const value = jsonPart !== undefined && typeof jsonPart.value === "object" && jsonPart.value !== null
        ? jsonPart.value
        : undefined;
    const stderr = value !== undefined && typeof value["stderr"] === "object" && value["stderr"] !== null
        ? value["stderr"]
        : undefined;
    const stdout = value !== undefined && typeof value["stdout"] === "object" && value["stdout"] !== null
        ? value["stdout"]
        : undefined;
    const largestPrefix = (original, test) => {
        let low = 0;
        let high = original.length;
        while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (test(original.slice(0, middle)))
                low = middle;
            else
                high = middle - 1;
        }
        return original.slice(0, low);
    };
    if (stderr !== undefined && typeof stderr["text"] === "string" && stderr["text"].length > 0) {
        const original = stderr["text"];
        const kept = largestPrefix(original, (candidate) => {
            stderr["text"] = candidate;
            const ok = fits();
            stderr["text"] = original;
            return ok;
        });
        if (kept !== original) {
            stderr["text"] = kept;
            stderr["truncated"] = true;
        }
    }
    if (textPart !== undefined && textPart.text.length > 0 && !fits()) {
        const original = textPart.text;
        const kept = largestPrefix(original, (candidate) => {
            textPart.text = candidate;
            const ok = fits();
            textPart.text = original;
            return ok;
        });
        if (kept !== original) {
            textPart.text = kept;
            if (stdout !== undefined)
                stdout["truncated"] = true;
        }
    }
    return output;
}
export class ShellToolHandler {
    sandbox;
    #outputLimitBytes;
    constructor(sandbox, config = {}) {
        this.sandbox = sandbox;
        this.#outputLimitBytes = config.outputLimitBytes ?? 64 * 1024;
    }
    async execute(call, options) {
        if (options.signal.aborted)
            return this.#cancelled(call.callId, NONE);
        const parsed = shellToolInputSchema.safeParse(call.arguments);
        if (!parsed.success)
            return this.#error(call.callId, "invalid_arguments", "shell 参数非法", NONE);
        const input = parsed.data;
        try {
            const result = await this.sandbox.execute({
                command: input.command,
                cwd: input.cwd ?? ".",
                timeoutMs: SHELL_NO_STOP_MS,
                outputLimitBytes: this.#outputLimitBytes,
                signal: options.signal,
            });
            // 旧替身的结果没有这一项；原样抄进 JSON（L10）。
            const resourceCaps = result.resourceCaps;
            const tail = resourceCapTail(resourceCaps);
            const output = [
                { kind: "text", text: result.stdout.text },
                {
                    kind: "json",
                    value: {
                        exitCode: result.exitCode,
                        signal: result.signal,
                        stdout: {
                            totalBytes: result.stdout.totalBytes,
                            truncated: result.stdout.truncated,
                        },
                        stderr: {
                            text: result.stderr.text,
                            totalBytes: result.stderr.totalBytes,
                            truncated: result.stderr.truncated,
                        },
                        sandboxProfileVersion: result.sandboxProfileVersion,
                        timings: result.timings,
                        ...(resourceCaps === undefined ? {} : { resourceCaps }),
                    },
                },
            ];
            const fitted = fitOutput(output, SHELL_OUTPUT_LIMIT_BYTES);
            if (result.cancelled) {
                return {
                    schemaVersion: 1,
                    callId: call.callId,
                    status: "cancelled",
                    reason: "shell 已取消",
                    output: fitted,
                    effects: result.effects,
                };
            }
            if (result.exitCode !== 0) {
                return this.#error(call.callId, "execution_failed", `shell 退出码 ${String(result.exitCode)}${tail}`, result.effects, fitted);
            }
            return {
                schemaVersion: 1,
                callId: call.callId,
                status: "success",
                output: fitted,
                effects: result.effects,
            };
        }
        catch (error) {
            if (error instanceof ProcessSandboxError) {
                return this.#error(call.callId, error.code === "sandbox_unavailable" ? "sandbox_unavailable" : "execution_failed", error.message, NONE);
            }
            return this.#error(call.callId, "execution_failed", "shell 执行失败", {
                sideEffect: "possible",
                changedPaths: [],
                workspaceRevision: null,
                artifactRefs: [],
            });
        }
    }
    #error(callId, code, message, effects, output = [{ kind: "text", text: message }]) {
        return {
            schemaVersion: 1,
            callId,
            status: "error",
            error: { code, message, retryable: code === "execution_failed" },
            output,
            effects,
        };
    }
    #cancelled(callId, effects) {
        return {
            schemaVersion: 1,
            callId,
            status: "cancelled",
            reason: "shell 已取消",
            output: [],
            effects,
        };
    }
}
/** 沙箱没给联网时的说明。 */
const SHELL_DESCRIPTION = "Run a non-interactive bash command in a network-disabled bubblewrap sandbox. Commands are not stopped by time; memory and process limits still apply. Use for search, builds, and tests—not for file reading or editing when read/edit applies. The workspace is /workspace inside shell; cwd is workspace-relative. Group related checks to avoid many tiny calls. Requires user permission.";
/** SBX：沙箱给了联网（`ProcessSandbox.networkConfigured`）时的说明。 */
const SHELL_DESCRIPTION_NETWORK = "Run a non-interactive bash command in a bubblewrap sandbox. HTTP and HTTPS reach the public internet through the platform proxy (the proxy variables are set); the host machine, loopback and private networks are unreachable, and ssh, git@ URLs and other non-HTTP connections do not work. A server started inside the same command is reachable at 127.0.0.1. Commands are not stopped by time; memory and process limits still apply. Use for search, builds, installs, and tests—not for file reading or editing when read/edit applies. The workspace is /workspace inside shell; cwd is workspace-relative. Group related checks to avoid many tiny calls. Requires user permission.";
export function createShellToolDefinition(sandbox) {
    return {
        name: "shell",
        description: sandbox.networkConfigured ? SHELL_DESCRIPTION_NETWORK : SHELL_DESCRIPTION,
        inputSchema: shellToolInputSchema,
        handler: new ShellToolHandler(sandbox),
        effectClass: "process",
        requiredCapabilities: [
            "workspace_read",
            "workspace_write",
            "isolated_process",
            "network_isolated",
        ],
        defaultTimeoutMs: SHELL_NO_STOP_MS,
        outputLimitBytes: SHELL_OUTPUT_LIMIT_BYTES,
        independentReadOnly: false,
        summarize: (argumentsValue) => ({
            paths: [],
            cwd: String(argumentsValue["cwd"] ?? "."),
            commandPreview: String(argumentsValue["command"] ?? "").slice(0, 512),
        }),
    };
}
//# sourceMappingURL=shell-tool.js.map