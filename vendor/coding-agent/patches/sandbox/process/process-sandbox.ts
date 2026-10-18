/**
 * 模块职责：在受控工作目录和环境中启动子进程，并限制时间、输出和取消行为。
 *
 * 设计边界：审批由上层完成；本模块只执行已获准请求并返回结构化结果与副作用摘要。
 * 关键流程：校验 profile 与路径，构造最小环境，启动进程，捕获输出，超时或取消时清理进程树。
 * 只读模式（`workspaceMode: 'read_only'`）：工作区根以只读方式挂载，受保护目录空挂载后再
 * 只读重挂；执行后仍比较快照，但只把变化记为外部写者的 `externalChangedPaths`，绝不推进
 * Kernel 认可的基线（L13、L15）。能力探测失败时绝不退回读写挂载或主机命令行。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, watch, type FSWatcher } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { access, lstat, mkdtemp, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Duplex } from "node:stream";

import type { ToolEffects } from "../../core/ports/tool_executor/tool-executor-port.js";
import { normalizeWorkspacePath } from "../../policy/permissions/permission-policy.js";
import { WorkspaceSandbox } from "../workspace/workspace-sandbox.js";

export interface ProcessSandboxProfile {
  readonly available: boolean;
  readonly version: string;
  readonly bwrapPath: string | null;
  readonly reason: string | null;
}

export interface ProcessExecutionRequest {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly outputLimitBytes: number;
  readonly signal: AbortSignal;
  /** 探针等已知零业务副作用的命令可跳过工作区前后快照。 */
  readonly captureWorkspaceEffects?: boolean;
}

export interface CapturedOutput {
  readonly text: string;
  readonly totalBytes: number;
  readonly truncated: boolean;
}

export type ProcessWorkspaceMode = "read_write" | "read_only";

/** L15：read_only 时记录的只读执行副作用；快照看到的变化来自并发的别的写者。 */
export interface ProcessExecutionEffects extends ToolEffects {
  readonly externalChangedPaths?: readonly string[];
  readonly externalChangedPathsOmitted?: number;
}

export interface ProcessExecutionResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly stdout: CapturedOutput;
  readonly stderr: CapturedOutput;
  readonly effects: ProcessExecutionEffects;
  readonly sandboxProfileVersion: string;
  readonly timings: {
    readonly snapshotBeforeMs: number;
    readonly executionMs: number;
    readonly snapshotAfterMs: number;
  };
  /** L10：原始报告总有。没接上设置的调用方写 `none`／`not_configured`。 */
  readonly resourceCaps: ResourceCapsReport;
}

export interface ProcessSandboxOptions {
  readonly protectedPaths?: readonly string[];
  /** Host-prepared runtime directories, mounted read-only; no permission to host paths. */
  readonly readOnlyPaths?: readonly string[];
  readonly executablePath?: string;
  /** L13：默认 read_write，现有调用行为不变。 */
  readonly workspaceMode?: ProcessWorkspaceMode;
  /**
   * D-IPC：socket/FIFO 遍历的总条目上限。默认 `IPC_WALK_MAX_ENTRIES`；
   * 测试可注入较小值来验证广度优先次序，生产不传。
   */
  readonly ipcWalkMaxEntries?: number;
  /**
   * L13：每次 `execute` 现读 `current()`；不进 `effectiveOptions`、授权、配置版本、
   * 准备好的执行、摘要和恢复约束。缺了照今天跑，结果写 `none`／`not_configured`。
   */
  readonly resourceCaps?: ResourceCapSource;
}

export interface ResourceCapRequest {
  readonly memoryMaxBytes: number;
  readonly tasksMax: number;
}

/** 每次 execute 读一次；Host 持有，设置改了就变（L13）。 */
export interface ResourceCapSource {
  current(): ResourceCapRequest;
}

export type ResourceCapUnavailableReason =
  | "not_linux"
  | "no_cgroup_v2"
  | "no_systemd_run"
  | "no_user_session"
  | "controllers_not_delegated"
  | "literal_arguments_not_preserved"
  | "sandbox_unavailable"
  | "probe_failed"
  | "not_configured";

export type ResourceCapCapability =
  | { readonly status: "available" }
  | {
      readonly status: "unavailable";
      readonly reason: ResourceCapUnavailableReason;
      readonly detail: string;
    };

export type ResourceCapsReport =
  | {
      readonly status: "applied";
      readonly memoryMaxBytes: number;
      readonly tasksMax: number;
      readonly memory: "cap_hit" | "none_observed" | "uncertain";
      readonly processes: "cap_hit" | "none_observed" | "unknown";
      readonly observationComplete: boolean;
    }
  | { readonly status: "none"; readonly reason: ResourceCapUnavailableReason; readonly text: string }
  | { readonly status: "not_started" };

/** L10 的固定表：没有资源上限时的原因文本。 */
export const RESOURCE_CAP_NONE_TEXT: Readonly<Record<ResourceCapUnavailableReason, string>> = {
  not_linux: "没有资源上限：本机不是 Linux 或 WSL",
  no_cgroup_v2: "没有资源上限：本机没有 cgroup v2",
  no_systemd_run: "没有资源上限：找不到 systemd-run",
  no_user_session: "没有资源上限：没有 systemd 的用户会话",
  controllers_not_delegated: "没有资源上限：内存和进程数的控制没有下放给当前用户",
  literal_arguments_not_preserved: "没有资源上限：本机的 systemd-run 会改写命令参数",
  sandbox_unavailable: "没有资源上限：进程沙箱不可用",
  probe_failed: "没有资源上限：探测失败",
  not_configured: "没有资源上限：这个调用方没有接上资源上限设置",
};

const RESOURCE_CAP_NOT_CONFIGURED: ResolvedResourceCaps = {
  kind: "uncapped",
  report: { status: "none", reason: "not_configured", text: RESOURCE_CAP_NONE_TEXT.not_configured },
};

function uncappedReport(reason: ResourceCapUnavailableReason): ResourceCapsReport {
  return { status: "none", reason, text: RESOURCE_CAP_NONE_TEXT[reason] };
}

/** L1：systemd-run 路径取 `CODING_AGENT_SYSTEMD_RUN_PATH`，没有就是 `/usr/bin/systemd-run`。 */
const SYSTEMD_RUN_DEFAULT = "/usr/bin/systemd-run";
/** L1：bwrap 路径与今天一致。 */
const BWRAP_DEFAULT = "/usr/bin/bwrap";
/** L5 第 6 步：探测金丝雀固定取 256 MiB、64 个。 */
const RESOURCE_CAP_PROBE_MEMORY_BYTES = 256 * 1_048_576;
const RESOURCE_CAP_PROBE_TASKS_MAX = 64;
/** MF2/L5：一次探测从开始到所有探测工作停下最多 10 秒；超了报 probe_failed。 */
const RESOURCE_CAP_PROBE_DEADLINE_MS = 10_000;
const RESOURCE_CAP_PROBE_DEADLINE_DETAIL = "探测超过 10 秒";
/** L1 的看门进程：后台 `read` fd 5，原地 exec bwrap 并关掉 fd 5。 */
const KEEPER_SCRIPT = "read -r _ <&5 >/dev/null 2>&1 3<&- 4<&- & exec \"$@\" 5>&-";
/** L4 的闸门：写 `r`、等 `g`，关掉 fd 4 后原地 exec 命令。 */
const GATE_SCRIPT =
  "printf r >&4 || exit 125; IFS= read -r -n 1 go <&4 || exit 125; [ \"$go\" = g ] || exit 125; "
  + "exec 4>&- 4<&- /bin/bash --noprofile --norc -lc \"$1\"";
/** L5 第 6 步：证明 `--expand-environment=no` 的金丝雀字面量（长度 24）。 */
const CAPABILITY_CANARY_LITERAL = "${XDG_RUNTIME_DIR}:$$:%h";
const CAPABILITY_CANARY_COMMAND = [
  "set -e",
  `cap_literal=${shellSingleQuote(CAPABILITY_CANARY_LITERAL)}`,
  "[ \"${#cap_literal}\" -eq 24 ] || exit 3",
  "[ -z \"${XDG_RUNTIME_DIR:-}\" ] || exit 4",
  "[ ! -e /proc/self/fd/3 ] && [ ! -e /proc/self/fd/4 ] && [ ! -e /proc/self/fd/5 ] || exit 4",
  "[ ! -e /run/user ] && [ ! -e /sys/fs/cgroup ] || exit 4",
  "true",
].join("; ");

export interface ResourceCapCounters {
  readonly memory: {
    readonly max: number;
    readonly oom: number;
    readonly oomKill: number;
    readonly oomGroupKill: number;
  };
  readonly pids: { readonly max: number };
}

export type SettlementPhase = "starting" | "released" | "settled";
export type StopReason = "timeout" | "cancel" | "host_oom_kill";
export type StartupFailure =
  | "launcher_exited"
  | "ready_timeout"
  | "deadline_before_start"
  | "identity_mismatch"
  | "keeper_not_identified"
  | "limits_not_effective"
  | "baseline_unreadable";
export type FinalizeStep = "none" | "waiting_quiescence" | "reading" | "rechecking" | "done";

export interface SettlementState {
  readonly phase: SettlementPhase;
  readonly hasPid: boolean;
  readonly keeperPid: number | null;
  readonly stopReason: StopReason | null;
  readonly startupFailure: StartupFailure | "spawn_failed" | null;
  readonly bwrapExited: boolean;
  readonly finalize: FinalizeStep;
  readonly observationComplete: boolean;
  readonly keeperClosed: boolean;
  readonly streamsClosed: boolean;
  readonly escalationPending: boolean;
}

export type SettlementEvent =
  | { readonly kind: "spawned" }
  | { readonly kind: "keeper_recorded"; readonly pid: number }
  | { readonly kind: "spawn_failed" }
  | { readonly kind: "startup_failed"; readonly reason: StartupFailure }
  | { readonly kind: "release" }
  | { readonly kind: "stop"; readonly reason: StopReason }
  | { readonly kind: "escalation_due" }
  | { readonly kind: "bwrap_exited" }
  | { readonly kind: "quiescent" }
  | {
      readonly kind: "quiescence_failed";
      readonly reason: "timeout" | "keeper_not_identified";
    }
  | { readonly kind: "final_read_done"; readonly ok: boolean }
  | { readonly kind: "recheck_done"; readonly unchanged: boolean }
  | { readonly kind: "streams_closed" };

export type SettlementAction =
  | { readonly kind: "kill_group" }
  | { readonly kind: "signal_bwrap"; readonly signal: "SIGTERM" | "SIGKILL" }
  | { readonly kind: "start_escalation" }
  | { readonly kind: "clear_escalation" }
  | { readonly kind: "wait_quiescence" }
  | { readonly kind: "read_final" }
  | { readonly kind: "recheck_procs" }
  | { readonly kind: "close_keeper" }
  | {
      readonly kind: "finish";
      readonly outcome:
        | { readonly kind: "result" }
        | { readonly kind: "not_started_cancelled" }
        | { readonly kind: "launch_failed"; readonly reason: StartupFailure | "spawn_failed" };
    };

/** 内部：`execute` 解析出的上限状态。`uncapped` 就是今天的路径。 */
type ResolvedResourceCaps =
  | { readonly kind: "uncapped"; readonly report: ResourceCapsReport }
  | {
      readonly kind: "capped";
      readonly request: ResourceCapRequest;
      readonly oomPolicy: boolean;
      readonly expandEnvironment: boolean;
      // SF3/L1：这条命令实际用的路径和缓存键，准备好一次，起跑时不再读环境。
      readonly systemdRunPath: string;
      readonly bwrapPath: string;
      readonly key: string;
    };

/** 内部：`settleExecution` 的 `finish` 结局。 */
type FinishOutcome = Extract<SettlementAction, { readonly kind: "finish" }>["outcome"];

/** 内部：把已核实的 scope 目录报给 L5 第 6 步的金丝雀（生产探测用）。 */
interface CappedRunContext {
  readonly onScopeReady?: (scopeDir: string) => void;
  /** MF1/R1：L5 第 6 步的探测金丝雀失败时，不作废它正在填的缓存键。 */
  readonly probeCanary?: boolean;
}

export class ProcessSandboxError extends Error {
  constructor(
    readonly code: "sandbox_unavailable" | "launch_failed" | "invalid_arguments",
    message: string,
  ) {
    super(message);
    this.name = "ProcessSandboxError";
  }
}

const DEFAULT_PROTECTED_PATHS = [
  ".git",
  ".env",
  ".env.local",
  "credentials",
  "credentials.json",
] as const;

/** L15：外部变化路径最多报前 100 条。 */
const EXTERNAL_CHANGED_PATHS_LIMIT = 100;

/** L9：只从本模块导出；读取的原始文本 → 计数。缺的项按 0（RL-20 (14)）。 */
export function parseResourceCapCounters(memoryEvents: string, pidsEvents: string): ResourceCapCounters {
  const memory = new Map<string, number>();
  for (const line of memoryEvents.split("\n")) {
    const match = /^\s*([a-z_]+)\s+(\d+)\s*$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) memory.set(match[1], Number(match[2]));
  }
  const pids = new Map<string, number>();
  for (const line of pidsEvents.split("\n")) {
    const match = /^\s*([a-z_]+)\s+(\d+)\s*$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) pids.set(match[1], Number(match[2]));
  }
  return {
    memory: {
      max: memory.get("max") ?? 0,
      oom: memory.get("oom") ?? 0,
      oomKill: memory.get("oom_kill") ?? 0,
      oomGroupKill: memory.get("oom_group_kill") ?? 0,
    },
    pids: { max: pids.get("max") ?? 0 },
  };
}

/** L7：逐项取大；读成功才并入，旧读晚到也只会往上推（RL-20 (16)）。 */
export function mergeResourceCapCounters(
  seen: ResourceCapCounters,
  read: ResourceCapCounters,
): ResourceCapCounters {
  return {
    memory: {
      max: Math.max(seen.memory.max, read.memory.max),
      oom: Math.max(seen.memory.oom, read.memory.oom),
      oomKill: Math.max(seen.memory.oomKill, read.memory.oomKill),
      oomGroupKill: Math.max(seen.memory.oomGroupKill, read.memory.oomGroupKill),
    },
    pids: { max: Math.max(seen.pids.max, read.pids.max) },
  };
}

/** L9 的纯归因规则（RL-20）。只看 Δ 和读全了没有，不看退出码和信号。 */
export function attributeResourceCapEvents(input: {
  readonly baseline: ResourceCapCounters;
  readonly maxSeen: ResourceCapCounters;
  readonly observationComplete: boolean;
}): {
  memory: "cap_hit" | "none_observed" | "uncertain";
  processes: "cap_hit" | "none_observed" | "unknown";
} {
  const oomDelta = input.maxSeen.memory.oom - input.baseline.memory.oom;
  const oomKillDelta = input.maxSeen.memory.oomKill - input.baseline.memory.oomKill;
  const oomGroupKillDelta = input.maxSeen.memory.oomGroupKill - input.baseline.memory.oomGroupKill;
  let memory: "cap_hit" | "none_observed" | "uncertain";
  if (oomDelta > 0) memory = "cap_hit";
  else if (oomKillDelta > 0 || oomGroupKillDelta > 0) memory = "uncertain";
  else if (!input.observationComplete) memory = "uncertain";
  else memory = "none_observed";

  const pidsDelta = input.maxSeen.pids.max - input.baseline.pids.max;
  let processes: "cap_hit" | "none_observed" | "unknown";
  if (pidsDelta > 0) processes = "cap_hit";
  else if (!input.observationComplete) processes = "unknown";
  else processes = "none_observed";

  return { memory, processes };
}

function closeKeeper(state: SettlementState, actions: SettlementAction[]): void {
  if (!state.keeperClosed) {
    (state as { keeperClosed: boolean }).keeperClosed = true;
    actions.push({ kind: "close_keeper" });
  }
}

function settlementReadyToFinish(state: SettlementState): boolean {
  if (state.phase === "settled") return false;
  if (!state.streamsClosed || !state.bwrapExited) return false;
  if (state.phase === "starting") return true;
  return state.finalize === "done";
}

function settlementOutcome(state: SettlementState): Extract<SettlementAction, { kind: "finish" }>["outcome"] {
  if (state.startupFailure === "spawn_failed") return { kind: "launch_failed", reason: "spawn_failed" };
  if (state.startupFailure !== null) return { kind: "launch_failed", reason: state.startupFailure };
  // MF4：起跑阶段只有“取消”才结算成没开始的取消；其它起跑阶段的退出已在
  // bwrap_exited 里记成 launcher_exited，不会走到这里。
  if (state.phase === "starting" && state.stopReason === "cancel") {
    return { kind: "not_started_cancelled" };
  }
  return { kind: "result" };
}

/**
 * L4 的结算纯函数：一次执行一个状态，输入一件事，给出新状态和要做的动作。
 * `#run` 只照它给的动作去做；RE0 用各种先后测它（RL-22）。
 */
export function settleExecution(
  state: SettlementState,
  event: SettlementEvent,
): { readonly state: SettlementState; readonly actions: readonly SettlementAction[] } {
  if (state.phase === "settled") return { state, actions: [] };
  const next: SettlementState = { ...state };
  const mutable = next as {
    -readonly [K in keyof SettlementState]: SettlementState[K];
  };
  const actions: SettlementAction[] = [];

  switch (event.kind) {
    case "spawned":
      mutable.hasPid = true;
      break;
    case "keeper_recorded":
      mutable.keeperPid = event.pid;
      break;
    case "spawn_failed": {
      mutable.startupFailure = "spawn_failed";
      closeKeeper(mutable, actions);
      mutable.phase = "settled";
      actions.push({ kind: "finish", outcome: { kind: "launch_failed", reason: "spawn_failed" } });
      return { state: mutable, actions };
    }
    case "startup_failed": {
      mutable.startupFailure = event.reason;
      if (event.reason !== "launcher_exited" && mutable.hasPid) actions.push({ kind: "kill_group" });
      closeKeeper(mutable, actions);
      break;
    }
    case "release": {
      if (
        mutable.phase === "starting" &&
        mutable.stopReason === null &&
        mutable.startupFailure === null &&
        !mutable.bwrapExited
      ) {
        mutable.phase = "released";
      }
      break;
    }
    case "stop": {
      if (mutable.phase === "starting") {
        if (mutable.startupFailure !== null || mutable.stopReason !== null) break;
        // 5(c)-2/L8：接受 OOM 结束是放行以后的观察（bwrap 还没退出时读到 oom）；
        // 起跑中的 host_oom_kill 既不改状态也不给动作。
        if (event.reason === "host_oom_kill") break;
        if (event.reason === "cancel") {
          mutable.stopReason = "cancel";
        } else {
          // 放行之前的超时：命令一定没开始，抛 launch_failed。
          mutable.startupFailure = "deadline_before_start";
        }
        if (mutable.hasPid) actions.push({ kind: "kill_group" });
        closeKeeper(mutable, actions);
        break;
      }
      // phase released
      if (mutable.bwrapExited) {
        if (mutable.stopReason === null) mutable.stopReason = event.reason;
        break;
      }
      if (mutable.stopReason === null) {
        mutable.stopReason = event.reason;
        if (event.reason === "host_oom_kill") {
          actions.push({ kind: "signal_bwrap", signal: "SIGKILL" });
        } else {
          actions.push({ kind: "signal_bwrap", signal: "SIGTERM" });
          actions.push({ kind: "start_escalation" });
          mutable.escalationPending = true;
        }
      } else if (event.reason === "host_oom_kill" && mutable.escalationPending) {
        mutable.escalationPending = false;
        actions.push({ kind: "signal_bwrap", signal: "SIGKILL" });
      }
      break;
    }
    case "escalation_due": {
      if (mutable.escalationPending && !mutable.bwrapExited) {
        mutable.escalationPending = false;
        actions.push({ kind: "signal_bwrap", signal: "SIGKILL" });
      } else {
        mutable.escalationPending = false;
      }
      break;
    }
    case "bwrap_exited": {
      if (!mutable.bwrapExited) {
        mutable.bwrapExited = true;
        if (mutable.phase === "starting") {
          // MF4/L4：收到 r 之前、之后，只要在放行之前退出，都是 launcher_exited。
          // 已被取消或已记下起跑失败时保持原样（不覆盖先到的原因）。
          if (mutable.startupFailure === null && mutable.stopReason === null) {
            mutable.startupFailure = "launcher_exited";
            closeKeeper(mutable, actions);
          }
        } else if (mutable.phase === "released") {
          mutable.escalationPending = false;
          mutable.finalize = "waiting_quiescence";
          actions.push({ kind: "clear_escalation" });
          actions.push({ kind: "wait_quiescence" });
        }
      }
      break;
    }
    case "quiescent": {
      if (mutable.finalize === "waiting_quiescence") {
        mutable.finalize = "reading";
        actions.push({ kind: "read_final" });
      }
      break;
    }
    case "quiescence_failed": {
      if (mutable.finalize === "waiting_quiescence") {
        mutable.finalize = "done";
        mutable.observationComplete = false;
        closeKeeper(mutable, actions);
      }
      break;
    }
    case "final_read_done": {
      if (mutable.finalize === "reading") {
        if (event.ok) {
          mutable.finalize = "rechecking";
          actions.push({ kind: "recheck_procs" });
        } else {
          mutable.finalize = "done";
          mutable.observationComplete = false;
          closeKeeper(mutable, actions);
        }
      }
      break;
    }
    case "recheck_done": {
      if (mutable.finalize === "rechecking") {
        mutable.finalize = "done";
        mutable.observationComplete = event.unchanged;
        closeKeeper(mutable, actions);
      }
      break;
    }
    case "streams_closed": {
      mutable.streamsClosed = true;
      break;
    }
  }

  if (settlementReadyToFinish(mutable)) {
    const outcome = settlementOutcome(mutable);
    mutable.phase = "settled";
    actions.push({ kind: "finish", outcome });
  }
  return { state: mutable, actions };
}

/** D-IPC：工作区里既有的 Unix socket / FIFO 也要遮蔽；遍历有界。 */
const IPC_WALK_MAX_DEPTH = 64;
const IPC_WALK_MAX_ENTRIES = 20_000;
/**
 * D-PROBE：只读金丝雀必须真正执行一次 `--remount-ro`。没有受保护目录可重挂时，
 * 在一个私有 scratch tmpfs 上重挂，使探测仍能证明该选项可用。
 */
const READONLY_REMOUNT_SCRATCH = "/codex-readonly-canary";
/** D-CWD：沙箱内的 cwd 包含性守卫失败时写出的标记，父进程据此判 invalid_arguments。 */
const READONLY_CWD_GUARD_MARKER = "__codex_readonly_cwd_guard__";
const READONLY_CWD_GUARD =
  `case "$(pwd -P)" in /workspace|/workspace/*) ;; *) `
  + `printf '%s' '${READONLY_CWD_GUARD_MARKER}' >&2; exit 126 ;; esac`;

/**
 * MF2：跑一条只取输出的辅助命令。给了 `signal` 时 spawn 成独立进程组，
 * 中止就 SIGKILL 整组，并等到 `close`（子进程已收尸）才 reject；标准错误
 * 直接丢弃（不读的管道写满会卡死子进程），标准输出最多留 4 KiB。
 * 不给 `signal` 时行为与 K 片调用方原来一致。
 */
async function commandOutput(
  command: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: ["ignore", "pipe", "ignore"] });
    const output: Buffer[] = [];
    let retained = 0;
    let settled = false;
    let aborted = false;
    const cleanup = (): void => {
      if (signal !== undefined) signal.removeEventListener("abort", onAbort);
    };
    const settle = (run: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      run();
    };
    const onAbort = (): void => {
      aborted = true;
      const pid = child.pid;
      if (pid !== undefined) {
        try { process.kill(-pid, "SIGKILL"); } catch { /* 可能已退出 */ }
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      const remaining = 4_096 - retained;
      if (remaining > 0) {
        const selected = chunk.subarray(0, remaining);
        output.push(selected);
        retained += selected.byteLength;
      }
    });
    child.once("error", (error) => settle(() => reject(error)));
    child.once("close", (code) => {
      if (aborted) {
        settle(() => reject(new Error("aborted")));
      } else if (code === 0) {
        settle(() => resolve(Buffer.concat(output).toString("utf8").trim()));
      } else {
        settle(() => reject(new Error(`process exited ${String(code)}`)));
      }
    });
    if (signal !== undefined) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function appendBounded(
  chunks: Buffer[],
  chunk: Buffer,
  retained: { bytes: number },
  limit: number,
): void {
  const remaining = Math.max(0, limit - retained.bytes);
  if (remaining > 0) {
    const selected = chunk.subarray(0, remaining);
    chunks.push(selected);
    retained.bytes += selected.byteLength;
  }
}

function captured(chunks: readonly Buffer[], totalBytes: number, limit: number): CapturedOutput {
  return {
    text: new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks)),
    totalBytes,
    truncated: totalBytes > limit,
  };
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * D-ONECHECK：一次执行开始时对 `.git` 和每条受保护路径各做一次 `lstat` 得到的分类。
 * 所有挂载决定与 IPC 跳过决定都只从这份快照推导；挂载循环不再重新 `lstat` 这些路径。
 */
export type ProtectedPathKind = "absent" | "directory" | "file" | "symlink" | "other";

export interface ProtectedPathState {
  readonly path: string;
  readonly kind: ProtectedPathKind;
}

export interface ProtectedPathSnapshot {
  readonly paths: readonly ProtectedPathState[];
}

/** D-ONECHECK：快照里一条受保护路径最终选定的挂载动作。 */
export type ReadonlyMountAction = "bind-readonly" | "mask-tmpfs" | "mask-devnull";

export interface ReadonlyMount {
  readonly path: string;
  readonly action: ReadonlyMountAction;
}

export interface ReadonlyMountPlan {
  /** 实际挂载动作，按路径深度升序（同层字节序）排列。 */
  readonly mounts: readonly ReadonlyMount[];
  /** 被遮蔽的受保护路径（空 tmpfs 或 `/dev/null`）；其整棵子树都不可见。 */
  readonly maskedSubtrees: readonly string[];
  /** 只读但内容仍可读的受保护路径（当前只有目录形态的 `.git`）；其下显式否认路径各自保留挂载。 */
  readonly readableSubtrees: readonly string[];
  /** 因最近的已选遮蔽祖先而丢弃、不再单独挂载的受保护路径。 */
  readonly dropped: readonly string[];
  /** 没有任何 `--remount-ro` 来源时为 true，D-PROBE 金丝雀需要私有 scratch tmpfs。 */
  readonly remountScratch: boolean;
}

/**
 * D-ONECHECK/D-GIT/D-GITFILE：纯函数，从一次 `lstat` 快照推导只读挂载计划。
 *
 * - 目录形态的 `.git` 是唯一的“只读但可读”绑定，其下显式否认路径各自保留挂载；
 * - 普通目录用空 tmpfs 遮蔽，普通文件用 `/dev/null` 遮蔽，两者都让整棵子树不可见；
 * - 只有当最近的上层**已选遮蔽挂载**存在时才丢弃后代（“never expose a directory
 *   after discarding its denials”）；读取型祖先不遮蔽；
 * - 不存在的路径（ENOENT/ENOTDIR）没有挂载，也不构成遮蔽祖先；
 * - symlink 或特殊类型不安全，fail closed。
 */
export function planReadonlyMounts(snapshot: ProtectedPathSnapshot): ReadonlyMountPlan {
  const ordered = [...snapshot.paths].sort((left, right) => {
    const depth = left.path.split("/").length - right.path.split("/").length;
    if (depth !== 0) return depth;
    return byteOrder(left.path, right.path);
  });
  const mounts: ReadonlyMount[] = [];
  const maskedSubtrees: string[] = [];
  const readableSubtrees: string[] = [];
  const dropped: string[] = [];
  for (const state of ordered) {
    const maskedByAncestor = mounts.some(
      (mount) =>
        mount.action !== "bind-readonly" &&
        (state.path === mount.path || state.path.startsWith(`${mount.path}/`)),
    );
    if (maskedByAncestor) {
      dropped.push(state.path);
      continue;
    }
    if (state.kind === "absent") continue;
    if (state.kind === "symlink") {
      throw new ProcessSandboxError("launch_failed", `受保护路径 ${state.path} 不能是 symlink`);
    }
    if (state.kind === "directory") {
      if (state.path === ".git") {
        mounts.push({ path: state.path, action: "bind-readonly" });
        readableSubtrees.push(state.path);
      } else {
        mounts.push({ path: state.path, action: "mask-tmpfs" });
        maskedSubtrees.push(state.path);
      }
      continue;
    }
    if (state.kind === "file") {
      mounts.push({ path: state.path, action: "mask-devnull" });
      maskedSubtrees.push(state.path);
      continue;
    }
    throw new ProcessSandboxError("launch_failed", `受保护路径 ${state.path} 类型不安全`);
  }
  return {
    mounts,
    maskedSubtrees,
    readableSubtrees,
    dropped,
    remountScratch: !mounts.some((mount) => mount.action === "mask-tmpfs"),
  };
}

/** D-ONECHECK：IPC 遍历只跳过计划真正遮蔽的子树（起点本身或其后代）。 */
export function readonlyIpcSkips(plan: ReadonlyMountPlan, relative: string): boolean {
  return plan.maskedSubtrees.some(
    (prefix) => relative === prefix || relative.startsWith(`${prefix}/`),
  );
}

function byteOrder(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/**
 * bubblewrap 进程隔离适配器。workspace 通过已打开的 fd 绑定，敏感路径
 * 再以只读或空挂载覆盖；能力探测失败时绝不退化成宿主 shell。
 */
export class ProcessSandbox {
  static readonly PROFILE_VERSION = "bwrap-m3-v4";
  /** L13：只读金丝雀结果按（沙箱配置、受保护路径集合）在 Host 进程里缓存。 */
  static readonly #readOnlyCanaries = new Map<
    string,
    { readonly available: boolean; readonly reason: string | null }
  >();
  readonly #protectedPaths: readonly string[];
  readonly #readOnlyPaths: readonly string[];
  readonly #executablePath: string;
  readonly #workspaceMode: ProcessWorkspaceMode;
  readonly #ipcWalkMaxEntries: number;
  readonly #resourceCaps: ResourceCapSource | undefined;

  constructor(
    readonly profile: ProcessSandboxProfile,
    private readonly workspaceRoot: string,
    private readonly workspace: WorkspaceSandbox,
    options: ProcessSandboxOptions = {},
  ) {
    if (!path.isAbsolute(this.workspaceRoot)) {
      throw new RangeError("ProcessSandbox workspace root 必须是绝对路径");
    }
    this.#workspaceMode = options.workspaceMode ?? "read_write";
    const ipcWalkMaxEntries = options.ipcWalkMaxEntries ?? IPC_WALK_MAX_ENTRIES;
    if (!Number.isSafeInteger(ipcWalkMaxEntries) || ipcWalkMaxEntries < 1) {
      throw new RangeError("ipcWalkMaxEntries 必须是正整数");
    }
    this.#ipcWalkMaxEntries = ipcWalkMaxEntries;
    this.#resourceCaps = options.resourceCaps;
    this.#readOnlyPaths = options.readOnlyPaths ?? [];
    for (const relative of this.#readOnlyPaths) {
      if (!/^[A-Za-z0-9._-]+$/.test(relative) || !relative || relative.startsWith("/") || relative.split("/").some(p => p === ".." || p === "." || !p) || relative.includes("\\")) throw new Error("Invalid read-only runtime path");
    }
    this.#executablePath = options.executablePath ?? "/usr/bin:/bin";
    this.#protectedPaths = [
      ...new Set([
        ...this.workspace.deniedPrefixes,
        ...DEFAULT_PROTECTED_PATHS,
        ...(options.protectedPaths ?? []),
      ]),
    ]
      .map((value) => normalizeWorkspacePath(value))
      .filter(value => !this.#readOnlyPaths.includes(value) || (DEFAULT_PROTECTED_PATHS as readonly string[]).includes(value))
      .sort();
  }

  /** 恢复约束快照使用构造后已规范化、过滤的实际选项。模式按每次调用定，不进恢复约束（L14）。 */
  get effectiveOptions(): Required<Omit<ProcessSandboxOptions, "workspaceMode" | "ipcWalkMaxEntries" | "resourceCaps">> {
    return {
      protectedPaths: [...this.#protectedPaths],
      readOnlyPaths: [...this.#readOnlyPaths],
      executablePath: this.#executablePath,
    };
  }

  static async probe(
    workspaceRoot: string,
    workspace: WorkspaceSandbox,
    options: Readonly<{
      bwrapPath?: string;
      workspaceMode?: ProcessWorkspaceMode;
      /** D-PROBE：探测必须使用将运行的沙箱的实际受保护路径、只读运行时路径和可执行路径。 */
      protectedPaths?: readonly string[];
      readOnlyPaths?: readonly string[];
      executablePath?: string;
    }> = {},
  ): Promise<ProcessSandboxProfile> {
    // MF2/L14/F7：公开 `probe` 的签名和行为不变；L5 的 10 秒 deadline 走下面的私有 helper。
    return ProcessSandbox.#probeInternal(workspaceRoot, workspace, options);
  }

  /**
   * MF2：`probe` 的实际实现。给了 `signal`（L5 探测的 10 秒 deadline）时把它
   * 传给 `bwrap --version` 和内部金丝雀；公开入口不传，行为照旧。
   */
  static async #probeInternal(
    workspaceRoot: string,
    workspace: WorkspaceSandbox,
    options: Readonly<{
      bwrapPath?: string;
      workspaceMode?: ProcessWorkspaceMode;
      protectedPaths?: readonly string[];
      readOnlyPaths?: readonly string[];
      executablePath?: string;
    }>,
    signal?: AbortSignal,
    canaryTimeoutMs = 5_000,
  ): Promise<ProcessSandboxProfile> {
    try {
      const bwrapPath =
        options.bwrapPath ?? process.env["CODING_AGENT_BWRAP_PATH"] ?? "/usr/bin/bwrap";
      if (!path.isAbsolute(bwrapPath)) {
        throw new Error("bubblewrap 路径必须是绝对路径");
      }
      await access(bwrapPath);
      const versionText = await commandOutput(bwrapPath, ["--version"], signal);
      const workspaceMode = options.workspaceMode ?? "read_write";
      const sandbox = new ProcessSandbox(
        {
          available: true,
          version: `${ProcessSandbox.PROFILE_VERSION}:${versionText}`,
          bwrapPath,
          reason: null,
        },
        workspaceRoot,
        workspace,
        {
          workspaceMode,
          ...(options.protectedPaths === undefined
            ? {}
            : { protectedPaths: options.protectedPaths }),
          ...(options.readOnlyPaths === undefined
            ? {}
            : { readOnlyPaths: options.readOnlyPaths }),
          ...(options.executablePath === undefined
            ? {}
            : { executablePath: options.executablePath }),
        },
      );
      if (workspaceMode === "read_only") {
        // L13：只读金丝雀确认 --ro-bind-fd 与 --remount-ro 可用，且写工作区、
        // 写受保护目录都失败。结果经实例缓存，不每次调用都探测。
        await sandbox.#ensureReadOnlyReady();
        return sandbox.profile;
      }
      const canary = await sandbox.execute({
        command:
          'test "$HOME" = /home/agent && ' +
          "test ! -e /etc/shadow && " +
          "test ! -e /proc/self/fd/3 && " +
          'test -z "$(awk -F: \'NR > 2 { gsub(/ /, "", $1); if ($1 != "lo") print $1 }\' /proc/net/dev)" && ' +
          "for item in .evaluator .oracle hidden-tests; do " +
          'test ! -e "/workspace/$item" || test -z "$(ls -A "/workspace/$item" 2>/dev/null)"; ' +
          "done && " +
          "if test -d /workspace/.git; then ! touch /workspace/.git/.codex-write-canary; fi",
        cwd: ".",
        timeoutMs: canaryTimeoutMs,
        outputLimitBytes: 1_024,
        signal: signal ?? new AbortController().signal,
        captureWorkspaceEffects: false,
      });
      if (canary.exitCode !== 0 || canary.timedOut) {
        const detail = canary.stderr.text.trim().slice(0, 256);
        throw new Error(
          `sandbox canary failed (exit=${String(canary.exitCode)}, signal=${String(canary.signal)}, timedOut=${String(canary.timedOut)})${detail ? `: ${detail}` : ""}`,
        );
      }
      return sandbox.profile;
    } catch (error) {
      return {
        available: false,
        version: ProcessSandbox.PROFILE_VERSION,
        bwrapPath: null,
        reason: error instanceof Error ? error.message : "bubblewrap probe failed",
      };
    }
  }

  /**
   * L5 第 6 步的金丝雀：在 Host 私有的空临时目录上用同一段起跑代码跑一条命令。
   * 只由 `probeResourceCaps` 调用，不属于公开接口。
   */
  static async probeResourceCapsCanary(
    systemdRunPath: string,
    bwrapPath: string,
    options: { readonly oomPolicy: boolean; readonly expandEnvironment: boolean },
    signal?: AbortSignal,
    remaining: () => number = () => RESOURCE_CAP_PROBE_DEADLINE_MS,
  ): Promise<ResourceCapCapability> {
    let root: string;
    try {
      root = await mkdtemp(path.join(tmpdir(), "agent-next-cap-"));
    } catch (error) {
      return { status: "unavailable", reason: "probe_failed", detail: messageOf(error) };
    }
    try {
      const workspace = await WorkspaceSandbox.create(root);
      // L5 第 5 步：`ProcessSandbox.probe` 说 bwrap 可用（同一个 bwrap 路径）。
      // MF2：用私有 helper，把 deadline 的 signal 和剩余预算传下去。
      const profile = await ProcessSandbox.#probeInternal(
        root,
        workspace,
        { bwrapPath },
        signal,
        Math.max(0, Math.min(5_000, remaining())),
      );
      if (!profile.available || profile.bwrapPath === null) {
        return {
          status: "unavailable",
          reason: "sandbox_unavailable",
          detail: profile.reason ?? "bubblewrap 不可用",
        };
      }
      let scopeDir: string | null = null;
      const sandbox = new ProcessSandbox(profile, root, workspace, {
        resourceCaps: {
          current: () => ({
            memoryMaxBytes: RESOURCE_CAP_PROBE_MEMORY_BYTES,
            tasksMax: RESOURCE_CAP_PROBE_TASKS_MAX,
          }),
        },
      });
      let result: ProcessExecutionResult;
      try {
        result = await sandbox.#run(
          {
            command: CAPABILITY_CANARY_COMMAND,
            cwd: ".",
            // MF2 第 4 条：用 deadline 的 signal 和剩余预算，不再开新的 controller。
            timeoutMs: Math.max(0, remaining()),
            outputLimitBytes: 1_024,
            signal: signal ?? new AbortController().signal,
            captureWorkspaceEffects: false,
          },
          ".",
          {
            kind: "capped",
            request: {
              memoryMaxBytes: RESOURCE_CAP_PROBE_MEMORY_BYTES,
              tasksMax: RESOURCE_CAP_PROBE_TASKS_MAX,
            },
            oomPolicy: options.oomPolicy,
            expandEnvironment: options.expandEnvironment,
            systemdRunPath,
            bwrapPath,
            key: resourceCapCacheKey(systemdRunPath, bwrapPath),
          },
          { onScopeReady: (dir) => { scopeDir = dir; }, probeCanary: true },
        );
      } catch (error) {
        const detail = messageOf(error);
        if (
          detail.includes("Failed to connect to bus") ||
          detail.includes("Failed to create bus connection")
        ) {
          return { status: "unavailable", reason: "no_user_session", detail };
        }
        if (detail.startsWith("limits_not_effective")) {
          return { status: "unavailable", reason: "controllers_not_delegated", detail };
        }
        return { status: "unavailable", reason: "probe_failed", detail };
      }
      if (result.exitCode === 3) {
        return {
          status: "unavailable",
          reason: "literal_arguments_not_preserved",
          detail: result.stderr.text.trim().slice(0, 256),
        };
      }
      if (result.exitCode === 4) {
        return {
          status: "unavailable",
          reason: "probe_failed",
          detail: "套上限的路径漏了 Host 的东西",
        };
      }
      if (result.exitCode !== 0 || result.stdout.totalBytes > 0 || result.stderr.totalBytes > 0) {
        return {
          status: "unavailable",
          reason: "probe_failed",
          detail: `canary exit=${String(result.exitCode)} stdout=${String(result.stdout.totalBytes)} stderr=${String(result.stderr.totalBytes)}`,
        };
      }
      if (result.resourceCaps.status !== "applied" || !result.resourceCaps.observationComplete) {
        return { status: "unavailable", reason: "probe_failed", detail: "看门进程没通过" };
      }
      // L5 第 6 步最后：Host 关掉 fd 5 以后，scope 目录 2 秒内消失。
      if (scopeDir === null) {
        return { status: "unavailable", reason: "probe_failed", detail: "看门进程没通过：没有记下 scope" };
      }
      // MF2 第 5 条：循环最多 2 秒，也不超过探测的 deadline。
      const deadline = performance.now() + Math.min(2_000, Math.max(0, remaining()));
      while (performance.now() < deadline) {
        try {
          await stat(scopeDir);
        } catch (error) {
          // MF5c/L5 第 6 步：只有 ENOENT 证明 scope 目录真的消失了。
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") return { status: "available" };
          return {
            status: "unavailable",
            reason: "probe_failed",
            detail: `看门进程没通过：scope 目录读不了 ${String(code)}`,
          };
        }
        await delay(50);
      }
      return { status: "unavailable", reason: "probe_failed", detail: "看门进程没通过：scope 目录没有消失" };
    } catch (error) {
      return { status: "unavailable", reason: "probe_failed", detail: messageOf(error) };
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async execute(request: ProcessExecutionRequest): Promise<ProcessExecutionResult> {
    if (!this.profile.available || !this.profile.bwrapPath) {
      throw new ProcessSandboxError("sandbox_unavailable", "隔离进程能力不可用");
    }
    // SF1/L10：启动前已取消，命令一定没开始，报告一律 not_started，也不跑探测（省掉最长 10 秒）。
    if (request.signal.aborted) {
      return this.#notStartedResult(true, false, request.outputLimitBytes, { status: "not_started" });
    }
    const caps = await this.#resolveResourceCaps();
    let cwd: string;
    if (this.#workspaceMode === "read_only") {
      cwd = await this.#resolveReadOnlyCwd(request.cwd);
      await this.#ensureReadOnlyReady();
    } else {
      cwd = normalizeWorkspacePath(request.cwd, true);
    }
    return this.#run(request, cwd, caps);
  }

  /** RL1：每次 `execute` 现读 `current()`；有缓存用缓存，没有就探测（L5）。 */
  async #resolveResourceCaps(): Promise<ResolvedResourceCaps> {
    if (this.#resourceCaps === undefined) return RESOURCE_CAP_NOT_CONFIGURED;
    const request = this.#resourceCaps.current();
    validateResourceCapRequest(request);
    // SF3/L5：探测按这条命令将用的两个路径做键；#runCapped 之后不再重读环境。
    const systemdRunPath = resolveSystemdRunPath();
    const bwrapPath = this.profile.bwrapPath ?? BWRAP_DEFAULT;
    const probed = await probeResourceCapsInternal(systemdRunPath, bwrapPath);
    if (probed.capability.status !== "available") {
      return { kind: "uncapped", report: uncappedReport(probed.capability.reason) };
    }
    return {
      kind: "capped",
      request,
      oomPolicy: probed.options.oomPolicy,
      expandEnvironment: probed.options.expandEnvironment,
      systemdRunPath,
      bwrapPath,
      key: resourceCapCacheKey(systemdRunPath, bwrapPath),
    };
  }

  async #run(
    request: ProcessExecutionRequest,
    cwd: string,
    caps: ResolvedResourceCaps = RESOURCE_CAP_NOT_CONFIGURED,
    context?: CappedRunContext,
  ): Promise<ProcessExecutionResult> {
    return caps.kind === "capped"
      ? this.#runCapped(request, cwd, caps, context)
      : this.#runUncapped(request, cwd, caps.report);
  }

  /**
   * L13/D-CWD：只读模式下 cwd 先做字面检查，再在主机侧解析真实路径。
   * 解析一次后要求它是目录，并把已验证的相对路径交给 bwrap；沙箱内再用
   * `pwd -P` 守卫确认进程确实落在 /workspace 下，避免 check/use 竞态。
   */
  async #resolveReadOnlyCwd(value: string): Promise<string> {
    let cwd: string;
    try {
      cwd = normalizeWorkspacePath(value, true);
    } catch {
      throw new ProcessSandboxError("invalid_arguments", "cwd 不是工作区内的相对目录");
    }
    let rootReal: string;
    try {
      rootReal = await realpath(this.workspaceRoot);
    } catch {
      throw new ProcessSandboxError("invalid_arguments", "工作区根无法解析");
    }
    const target = cwd === "." ? rootReal : path.resolve(rootReal, cwd);
    let resolved: string;
    try {
      resolved = await realpath(target);
    } catch {
      throw new ProcessSandboxError("invalid_arguments", `cwd 不存在: ${cwd}`);
    }
    if (resolved !== rootReal && !resolved.startsWith(`${rootReal}${path.sep}`)) {
      throw new ProcessSandboxError("invalid_arguments", `cwd 不在工作区内: ${cwd}`);
    }
    let metadata;
    try {
      metadata = await stat(resolved);
    } catch {
      throw new ProcessSandboxError("invalid_arguments", `cwd 不存在: ${cwd}`);
    }
    if (!metadata.isDirectory()) {
      throw new ProcessSandboxError("invalid_arguments", `cwd 不是目录: ${cwd}`);
    }
    const relative = resolved === rootReal ? "." : path.relative(rootReal, resolved);
    if (
      relative !== "." &&
      this.#protectedPaths.some(
        (prefix) => relative === prefix || relative.startsWith(`${prefix}/`),
      )
    ) {
      throw new ProcessSandboxError("invalid_arguments", `cwd 落在受保护路径内: ${cwd}`);
    }
    return relative;
  }

  #readOnlyCanaryKey(): string {
    return JSON.stringify([
      this.profile.bwrapPath,
      this.profile.version,
      this.#executablePath,
      this.#readOnlyPaths,
      this.#protectedPaths,
    ]);
  }

  #readOnlyCanaryCommand(): string {
    const checks = [
      "set -e",
      "test ! -e /proc/self/fd/3",
      "if touch /workspace/.codex-readonly-canary 2>/dev/null; then rm -f /workspace/.codex-readonly-canary 2>/dev/null; exit 1; fi",
      // D-PROBE：受保护目录为空时，`--remount-ro` 用私有 scratch 挂载来证明。
      `if touch ${READONLY_REMOUNT_SCRATCH}/.codex-readonly-canary 2>/dev/null; then rm -f ${READONLY_REMOUNT_SCRATCH}/.codex-readonly-canary 2>/dev/null; exit 1; fi`,
    ];
    for (const relative of this.#protectedPaths) {
      const path = shellSingleQuote(`/workspace/${relative}`);
      checks.push(
        `if [ -d ${path} ]; then if touch ${path}/.codex-readonly-canary 2>/dev/null; then rm -f ${path}/.codex-readonly-canary 2>/dev/null; exit 1; fi; fi`,
      );
    }
    return checks.join("; ");
  }

  async #ensureReadOnlyReady(): Promise<void> {
    const key = this.#readOnlyCanaryKey();
    const cached = ProcessSandbox.#readOnlyCanaries.get(key);
    if (cached !== undefined) {
      if (!cached.available) {
        throw new ProcessSandboxError(
          "sandbox_unavailable",
          cached.reason ?? "只读沙箱不可用",
        );
      }
      return;
    }
    let outcome: { available: boolean; reason: string | null };
    try {
      const canary = await this.#run(
        {
          command: this.#readOnlyCanaryCommand(),
          cwd: ".",
          timeoutMs: 5_000,
          outputLimitBytes: 1_024,
          signal: new AbortController().signal,
          captureWorkspaceEffects: false,
        },
        ".",
      );
      if (canary.exitCode === 0 && !canary.timedOut && !canary.cancelled) {
        outcome = { available: true, reason: null };
      } else {
        const detail = canary.stderr.text.trim().slice(0, 256);
        outcome = {
          available: false,
          reason: `read-only canary failed (exit=${String(canary.exitCode)}, signal=${String(canary.signal)}, timedOut=${String(canary.timedOut)})${detail ? `: ${detail}` : ""}`,
        };
      }
    } catch (error) {
      outcome = {
        available: false,
        reason: error instanceof Error ? error.message : "read-only canary failed",
      };
    }
    ProcessSandbox.#readOnlyCanaries.set(key, outcome);
    if (!outcome.available) {
      throw new ProcessSandboxError("sandbox_unavailable", outcome.reason ?? "只读沙箱不可用");
    }
  }

  /**
   * L1–L10：有上限的起跑。systemd-run 建 scope，`sh` 留看门进程后原地 exec bwrap，
   * 闸门放行前 Host 核身份、核上限、读基线、开始观察；结算由 `settleExecution` 给动作。
   */
  async #runCapped(
    request: ProcessExecutionRequest,
    cwd: string,
    caps: Extract<ResolvedResourceCaps, { kind: "capped" }>,
    context?: CappedRunContext,
  ): Promise<ProcessExecutionResult> {
    const captureWorkspaceEffects = request.captureWorkspaceEffects ?? true;
    const mountSnapshot =
      this.#workspaceMode === "read_only" ? await this.#classifyProtectedPaths() : null;
    const beforeStartedAt = performance.now();
    const before = captureWorkspaceEffects ? await this.workspace.snapshot() : null;
    const snapshotBeforeMs = Math.max(0, performance.now() - beforeStartedAt);
    const rootCapability = await this.workspace.acquireRootHandleForProcess();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdoutRetained = { bytes: 0 };
    const stderrRetained = { bytes: 0 };
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const executionStartedAt = performance.now();
    const unitName = `agent-next-cmd-${randomUUID()}.scope`;
    const capRequest = caps.request;
    // SF3：两个路径在 #resolveResourceCaps 里定好并进了缓存键，这里不再读环境。
    const systemdRunPath = caps.systemdRunPath;
    const bwrapPath = caps.bwrapPath;

    let settlement: SettlementState = initialSettlementState();
    let finishOutcome: FinishOutcome | null = null;
    let finishResolver: ((outcome: FinishOutcome) => void) | null = null;
    const finished = new Promise<FinishOutcome>((resolve) => { finishResolver = resolve; });
    let child: ChildProcess | null = null;
    let childExit: { exitCode: number | null; signal: NodeJS.Signals | null } = { exitCode: null, signal: null };
    let gateStream: Duplex | null = null;
    let keeperStream: Duplex | null = null;
    let scopeDir: string | null = null;
    let keeperPid: number | null = null;
    let keeperArgvFull: readonly string[] = [];
    let baseline: ResourceCapCounters = zeroCounters();
    let maxSeen: ResourceCapCounters = zeroCounters();
    let launchDetail = "";
    let ready = false;
    const watchers: FSWatcher[] = [];
    let pollTimer: NodeJS.Timeout | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let readyTimer: NodeJS.Timeout | null = null;
    let escalationTimer: NodeJS.Timeout | null = null;

    const clearTimers = (): void => {
      if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
      if (timeoutTimer !== null) { clearTimeout(timeoutTimer); timeoutTimer = null; }
      if (readyTimer !== null) { clearTimeout(readyTimer); readyTimer = null; }
      if (escalationTimer !== null) { clearTimeout(escalationTimer); escalationTimer = null; }
      for (const watcher of watchers.splice(0)) { try { watcher.close(); } catch { /* ignore */ } }
    };

    const readCgroupProcs = async (dir: string): Promise<number[]> => {
      const text = await readFile(`${dir}/cgroup.procs`, "utf8");
      return text.split(/\s+/).filter(Boolean).map(Number).filter(value => Number.isSafeInteger(value));
    };
    const cmdlineMatches = async (pid: number, argv: readonly string[]): Promise<boolean> => {
      try {
        const raw = await readFile(`/proc/${String(pid)}/cmdline`, "utf8");
        const parts = raw.split("\u0000");
        if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
        return parts.length === argv.length && parts.every((part, index) => part === argv[index]);
      } catch {
        return false;
      }
    };
    const waitQuiescence = async (): Promise<void> => {
      if (scopeDir === null || keeperPid === null) {
        apply({ kind: "quiescence_failed", reason: "keeper_not_identified" });
        return;
      }
      const deadline = performance.now() + 1_000;
      let lastProcs: number[] = [];
      while (performance.now() < deadline) {
        try {
          lastProcs = await readCgroupProcs(scopeDir);
        } catch {
          lastProcs = [];
        }
        if (lastProcs.length === 1) {
          if (lastProcs[0] !== keeperPid || !(await cmdlineMatches(keeperPid, keeperArgvFull))) {
            apply({ kind: "quiescence_failed", reason: "keeper_not_identified" });
            return;
          }
          apply({ kind: "quiescent" });
          return;
        }
        await delay(10);
      }
      // L7：记下的 pid 不见了（或剩下的不含它）是 keeper_not_identified；否则只是没静止下来。
      const keeperGone = lastProcs.length === 0 || !lastProcs.includes(keeperPid);
      apply({ kind: "quiescence_failed", reason: keeperGone ? "keeper_not_identified" : "timeout" });
    };
    // MF5a/L7：两个计数文件各自读；一个失败不丢另一个的成功读数。
    const readCounterFiles = async (
      dir: string,
    ): Promise<{ readonly memoryText: string | null; readonly pidsText: string | null }> => {
      let memoryText: string | null = null;
      let pidsText: string | null = null;
      try {
        memoryText = await readFile(`${dir}/memory.events`, "utf8");
      } catch {
        // 保留 pids 的读数。
      }
      try {
        pidsText = await readFile(`${dir}/pids.events`, "utf8");
      } catch {
        // 保留 memory 的读数。
      }
      return { memoryText, pidsText };
    };
    const readFinal = async (): Promise<void> => {
      if (scopeDir === null) {
        apply({ kind: "final_read_done", ok: false });
        return;
      }
      // L7/L9：一个失败不丢另一个的成功读数，但完整性要两个都成。
      const { memoryText, pidsText } = await readCounterFiles(scopeDir);
      const memoryOk = memoryText !== null;
      const pidsOk = pidsText !== null;
      if (memoryOk || pidsOk) {
        maxSeen = mergeResourceCapCounters(
          maxSeen,
          parseResourceCapCounters(memoryText ?? "", pidsText ?? ""),
        );
      }
      apply({ kind: "final_read_done", ok: memoryOk && pidsOk });
    };
    const recheckProcs = async (): Promise<void> => {
      if (scopeDir === null || keeperPid === null) {
        apply({ kind: "recheck_done", unchanged: false });
        return;
      }
      try {
        const procs = await readCgroupProcs(scopeDir);
        const unchanged =
          procs.length === 1 && procs[0] === keeperPid && (await cmdlineMatches(keeperPid, keeperArgvFull));
        apply({ kind: "recheck_done", unchanged });
      } catch {
        apply({ kind: "recheck_done", unchanged: false });
      }
    };
    const observe = async (): Promise<void> => {
      if (scopeDir === null || settlement.bwrapExited) return;
      // MF5a：两个文件各自读；一个成功也要并入，绝不丢掉另一个的成功读数。
      const { memoryText, pidsText } = await readCounterFiles(scopeDir);
      if (memoryText === null && pidsText === null) return;
      maxSeen = mergeResourceCapCounters(
        maxSeen,
        parseResourceCapCounters(memoryText ?? "", pidsText ?? ""),
      );
      // MF5a/MF4：异步读回来以后可能已经退出或结算；L8 的 OOM 观察只认
      // bwrap 还没退出、且已放行的时候。
      if (settlement.phase !== "released" || settlement.bwrapExited) return;
      if (
        settlement.stopReason !== "host_oom_kill" &&
        (maxSeen.memory.oomKill > baseline.memory.oomKill ||
          maxSeen.memory.oomGroupKill > baseline.memory.oomGroupKill)
      ) {
        // L4：就算已经在 SIGTERM 的升级里，OOM 结束也马上接受（SIGKILL），原因不变。
        apply({ kind: "stop", reason: "host_oom_kill" });
      }
    };
    const startObservation = (): void => {
      // MF4：放行没生效或已结算时不装监听（L4：已结算以后来的事一概不理）。
      if (scopeDir === null || settlement.phase === "settled" || settlement.bwrapExited) return;
      for (const file of ["memory.events", "pids.events"]) {
        try {
          const watcher = watch(`${scopeDir}/${file}`, () => { void observe(); });
          watcher.on("error", () => { /* 监听坏了只用轮询（L7）。 */ });
          watchers.push(watcher);
        } catch {
          // 只用轮询。
        }
      }
      pollTimer = setInterval(() => { void observe(); }, 100);
      pollTimer.unref?.();
    };
    const runAction = (action: SettlementAction): void => {
      switch (action.kind) {
        case "kill_group": {
          const pid = child?.pid;
          if (pid !== undefined) { try { process.kill(-pid, "SIGKILL"); } catch { /* 可能已退出 */ } }
          break;
        }
        case "signal_bwrap": {
          const pid = child?.pid;
          if (pid !== undefined) { try { process.kill(pid, action.signal); } catch { /* 可能已退出 */ } }
          break;
        }
        case "start_escalation":
          escalationTimer = setTimeout(() => { escalationTimer = null; apply({ kind: "escalation_due" }); }, 250);
          escalationTimer.unref?.();
          break;
        case "clear_escalation":
          if (escalationTimer !== null) { clearTimeout(escalationTimer); escalationTimer = null; }
          break;
        case "wait_quiescence": void waitQuiescence(); break;
        case "read_final": void readFinal(); break;
        case "recheck_procs": void recheckProcs(); break;
        case "close_keeper":
          if (keeperStream !== null) { try { keeperStream.destroy(); } catch { /* 已关 */ } }
          break;
        case "finish":
          finishOutcome = action.outcome;
          finishResolver?.(action.outcome);
          break;
      }
    };
    const apply = (event: SettlementEvent): void => {
      const step = settleExecution(settlement, event);
      settlement = step.state;
      for (const action of step.actions) runAction(action);
    };
    /** L4：起跑失败只在不与已接受的停止/失败冲突时记一次。 */
    const failStartup = (reason: StartupFailure, detail = ""): void => {
      if (
        settlement.phase !== "starting" ||
        settlement.stopReason !== null ||
        settlement.startupFailure !== null
      ) {
        return;
      }
      if (detail !== "") launchDetail = detail;
      apply({ kind: "startup_failed", reason });
    };

    const readScopePath = async (pid: number): Promise<string | null> => {
      const text = await readFile(`/proc/${String(pid)}/cgroup`, "utf8");
      for (const line of text.split("\n")) {
        if (line.startsWith("0::")) return line.slice(3).trim();
      }
      return null;
    };
    const identifyKeeper = async (dir: string, hostPid: number): Promise<number | null> => {
      const candidates = (await readCgroupProcs(dir)).filter(pid => pid !== hostPid);
      const matches: number[] = [];
      for (const pid of candidates) {
        if (await cmdlineMatches(pid, keeperArgvFull)) matches.push(pid);
      }
      return matches.length === 1 ? matches[0]! : null;
    };
    const limitsEffective = async (dir: string): Promise<boolean> => {
      try {
        const memoryMax = (await readFile(`${dir}/memory.max`, "utf8")).trim();
        const pidsMax = (await readFile(`${dir}/pids.max`, "utf8")).trim();
        if (memoryMax !== String(capRequest.memoryMaxBytes) || pidsMax !== String(capRequest.tasksMax)) {
          return false;
        }
        try {
          const swapMax = (await readFile(`${dir}/memory.swap.max`, "utf8")).trim();
          if (swapMax !== "0") return false;
        } catch (error) {
          // MF5b/L6：只有真正的缺失（ENOENT）才算“有才读”；别的读失败说明
          // 上限没被证明，按 L4 的 limits_not_effective 处理。
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== "ENOENT") {
            launchDetail = `memory.swap.max read failed ${String(code)}`;
            return false;
          }
        }
        return true;
      } catch {
        return false;
      }
    };
    // MF4：放行前后异步等回来的续体只在仍处于“起跑中且无停止/失败”时才继续。
    const stillStarting = (): boolean =>
      settlement.phase === "starting" &&
      settlement.stopReason === null &&
      settlement.startupFailure === null &&
      !settlement.bwrapExited;
    const onReady = async (): Promise<void> => {
      if (ready) return;
      ready = true;
      if (readyTimer !== null) { clearTimeout(readyTimer); readyTimer = null; }
      if (!stillStarting()) return;
      const pid = child?.pid;
      if (pid === undefined) { failStartup("identity_mismatch"); return; }
      try {
        const scopePath = await readScopePath(pid);
        if (!stillStarting()) return;
        if (scopePath === null || scopePath.split("/").filter(Boolean).pop() !== unitName) {
          failStartup("identity_mismatch", scopePath ?? "no cgroup line");
          return;
        }
        scopeDir = `/sys/fs/cgroup${scopePath}`;
        context?.onScopeReady?.(scopeDir);
        keeperPid = await identifyKeeper(scopeDir, pid);
        if (!stillStarting()) return;
        if (keeperPid === null) {
          failStartup("keeper_not_identified", "keeper 不唯一或找不到");
          return;
        }
        apply({ kind: "keeper_recorded", pid: keeperPid });
        if (!(await limitsEffective(scopeDir))) {
          // MF5b：limitsEffective 可能已把具体的读错误写进 launchDetail。
          failStartup("limits_not_effective", launchDetail !== "" ? launchDetail : "上限没有按请求生效");
          return;
        }
        if (!stillStarting()) return;
        try {
          const [memoryText, pidsText] = await Promise.all([
            readFile(`${scopeDir}/memory.events`, "utf8"),
            readFile(`${scopeDir}/pids.events`, "utf8"),
          ]);
          baseline = parseResourceCapCounters(memoryText, pidsText);
          maxSeen = baseline;
        } catch (error) {
          if (!stillStarting()) return;
          failStartup("baseline_unreadable", error instanceof Error ? error.message : "");
          return;
        }
        if (!stillStarting()) return;
        // startObservation 和 release 在一次同步执行里完成（L4）。
        startObservation();
        apply({ kind: "release" });
        // 只有 release 真的生效（没被取消/超时抢先）才写 g；否则命令绝不能跑（L4）。
        // MF3：写失败（同步或异步）只销毁 Host 这一端的 fd 4，不碰结算。
        if (settlement.phase === "released" && gateStream !== null && !gateStream.destroyed) {
          try {
            gateStream.write("g", (error) => {
              if (error) gateStream?.destroy();
            });
          } catch {
            gateStream?.destroy();
          }
        }
      } catch (error) {
        if (!stillStarting()) return;
        failStartup("identity_mismatch", error instanceof Error ? error.message : "");
      }
    };

    let outcome: FinishOutcome;
    try {
      const mountPlan = mountSnapshot === null ? null : planReadonlyMounts(mountSnapshot);
      const bwrapArgs = await this.#arguments(request.command, cwd, rootCapability, mountPlan, GATE_SCRIPT);
      // SF1/F2：准备期间被取消（快照、分类、参数构造），绝不 spawn；capped 路径
      // 也照 L10 报 not_started，不留结算、不作废缓存。
      if (request.signal.aborted) {
        clearTimers();
        await rootCapability.close();
        return this.#notStartedResult(true, false, request.outputLimitBytes, { status: "not_started" });
      }
      keeperArgvFull = ["/bin/sh", "-c", KEEPER_SCRIPT, "agent-keeper", bwrapPath, ...bwrapArgs];
      const uid = process.getuid?.() ?? 0;
      const systemdArgs = [
        "--user",
        "--scope",
        "--quiet",
        "--collect",
        `--unit=${unitName}`,
        ...(caps.expandEnvironment ? ["--expand-environment=no"] : []),
        "-p", `MemoryMax=${String(capRequest.memoryMaxBytes)}`,
        "-p", "MemorySwapMax=0",
        "-p", `TasksMax=${String(capRequest.tasksMax)}`,
        ...(caps.oomPolicy ? ["-p", "OOMPolicy=continue"] : []),
        "--", "/bin/sh", "-c", KEEPER_SCRIPT, "agent-keeper", bwrapPath, ...bwrapArgs,
      ];
      child = spawn(systemdRunPath, systemdArgs, {
        detached: true,
        stdio: ["ignore", "pipe", "pipe", rootCapability.fd, "pipe", "pipe"],
        env: { PATH: "/usr/bin:/bin", XDG_RUNTIME_DIR: `/run/user/${String(uid)}` },
      });
      const standardIo = child.stdio as unknown as readonly unknown[];
      // L4：spawn 成功就有 pid；放行前的 kill_group 只在这个 pid 上生效（BLOCKER 1）。
      if (child.pid !== undefined) apply({ kind: "spawned" });
      const gate = standardIo[4] as Duplex;
      const keeper = standardIo[5] as Duplex;
      gateStream = gate;
      keeperStream = keeper;
      // MF3：Host 这一端的 fd 4/fd 5 读写失败是异步 'error'（socket destroy），
      // 没有监听就是未捕获异常、整个 Host 崩溃。只销毁自己这一端：不算结算事件、
      // 不加停止原因、不算起跑失败、不重试（L4/L11/§8）。
      gate.on("error", () => { gate.destroy(); });
      // Host 从不写 fd 5；这只是便宜的防御。
      keeper.on("error", () => { /* 忽略：Host 不写 fd 5。 */ });
      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;
        appendBounded(stdoutChunks, chunk, stdoutRetained, request.outputLimitBytes);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.byteLength;
        appendBounded(stderrChunks, chunk, stderrRetained, request.outputLimitBytes);
      });
      gate.on("data", (chunk: Buffer) => {
        if (!ready && settlement.phase === "starting" && chunk.toString("utf8").includes("r")) {
          void onReady();
        }
      });
      child.once("error", () => { apply({ kind: "spawn_failed" }); });
      child.once("exit", (exitCode, signal) => {
        childExit = { exitCode, signal };
        // MF4：放行之前（不再只是收到 r 之前）的任何退出都是 launcher_exited。
        if (settlement.phase === "starting") {
          const detail = launchDetail !== ""
            ? ""
            : Buffer.concat(stderrChunks).toString("utf8").trim().slice(0, 256);
          failStartup("launcher_exited", detail);
        }
        apply({ kind: "bwrap_exited" });
      });
      child.once("close", () => {
        clearTimers();
        apply({ kind: "streams_closed" });
      });
      timeoutTimer = setTimeout(() => { apply({ kind: "stop", reason: "timeout" }); }, request.timeoutMs);
      timeoutTimer.unref?.();
      readyTimer = setTimeout(
        () => {
          failStartup(
            "ready_timeout",
            Buffer.concat(stderrChunks).toString("utf8").trim().slice(0, 256),
          );
        },
        Math.max(0, Math.min(5_000, request.timeoutMs)),
      );
      readyTimer.unref?.();
      const onAbort = (): void => { apply({ kind: "stop", reason: "cancel" }); };
      request.signal.addEventListener("abort", onAbort, { once: true });
      if (request.signal.aborted) onAbort();
      outcome = await finished;
      request.signal.removeEventListener("abort", onAbort);
    } catch (error) {
      clearTimers();
      await rootCapability.close();
      throw new ProcessSandboxError(
        "launch_failed",
        error instanceof Error ? error.message : "隔离进程启动失败",
      );
    }
    clearTimers();
    if (keeperStream !== null) { try { keeperStream.destroy(); } catch { /* 已关 */ } }
    await rootCapability.close();

    const finishedOutcome: FinishOutcome = outcome;
    if (finishedOutcome.kind === "launch_failed") {
      // MF1/R1：探测自己的金丝雀失败不得作废它正在填的那个缓存键。
      if (finishedOutcome.reason !== "deadline_before_start" && context?.probeCanary !== true) {
        invalidateResourceCapCache(caps.key);
      }
      const detail = launchDetail !== ""
        ? launchDetail
        : Buffer.concat(stderrChunks).toString("utf8").trim().slice(0, 256);
      throw new ProcessSandboxError(
        "launch_failed",
        `${finishedOutcome.reason}: ${detail}`.trim(),
      );
    }
    if (finishedOutcome.kind === "not_started_cancelled") {
      // L31b/K3-49：取消发生在 systemd-run 已经起过之后（这里是唯一一个
      // spawn 之后的 not_started 返回；其它返回都在 spawn 之前、没建单元）。
      // 等停完再返回，调用方才能在返回后断言单元已经不在；最多 5 秒。
      await stopCancelledScope(unitName);
      return this.#notStartedResult(true, false, request.outputLimitBytes, { status: "not_started" });
    }
    if (
      this.#workspaceMode === "read_only" &&
      childExit.exitCode === 126 &&
      Buffer.concat(stderrChunks).toString("utf8").includes(READONLY_CWD_GUARD_MARKER)
    ) {
      throw new ProcessSandboxError("invalid_arguments", "cwd 在沙箱内不在 /workspace 下");
    }
    const executionMs = Math.max(0, performance.now() - executionStartedAt);
    const afterStartedAt = performance.now();
    const after = captureWorkspaceEffects ? await this.workspace.snapshot() : null;
    const snapshotAfterMs = Math.max(0, performance.now() - afterStartedAt);
    const changedPaths = before && after ? this.workspace.diff(before, after) : [];
    let effects: ProcessExecutionEffects;
    if (this.#workspaceMode === "read_only") {
      const ordered = [...changedPaths].sort(byteOrder);
      const externalChangedPaths = ordered.slice(0, EXTERNAL_CHANGED_PATHS_LIMIT);
      effects = {
        sideEffect: "none",
        changedPaths: [],
        workspaceRevision: null,
        artifactRefs: [],
        externalChangedPaths,
        externalChangedPathsOmitted: Math.max(0, ordered.length - externalChangedPaths.length),
      };
    } else {
      const accepted = after ? await this.workspace.acceptAgentChanges(after, changedPaths) : null;
      effects =
        changedPaths.length > 0
          ? {
              sideEffect: "confirmed",
              changedPaths,
              workspaceRevision: accepted?.revision ?? null,
              artifactRefs: [],
            }
          : {
              sideEffect: "possible",
              changedPaths: [],
              workspaceRevision: accepted?.revision ?? null,
              artifactRefs: [],
            };
    }
    const attribution = attributeResourceCapEvents({
      baseline,
      maxSeen,
      observationComplete: settlement.observationComplete,
    });
    return {
      ...childExit,
      timedOut: settlement.stopReason === "timeout",
      cancelled: settlement.stopReason === "cancel",
      stdout: captured(stdoutChunks, stdoutBytes, request.outputLimitBytes),
      stderr: captured(stderrChunks, stderrBytes, request.outputLimitBytes),
      effects,
      sandboxProfileVersion: this.profile.version,
      timings: { snapshotBeforeMs, executionMs, snapshotAfterMs },
      resourceCaps: {
        status: "applied",
        memoryMaxBytes: capRequest.memoryMaxBytes,
        tasksMax: capRequest.tasksMax,
        memory: attribution.memory,
        processes: attribution.processes,
        observationComplete: settlement.observationComplete,
      },
    };
  }

  async #runUncapped(
    request: ProcessExecutionRequest,
    cwd: string,
    report: ResourceCapsReport,
  ): Promise<ProcessExecutionResult> {
    const captureWorkspaceEffects = request.captureWorkspaceEffects ?? true;
    // D-ONECHECK：在任何其他工作区调用和参数构造之前，只做一次受保护路径分类；
    // 挂载计划与 IPC 跳过决定都只来自这份快照。
    const mountSnapshot =
      this.#workspaceMode === "read_only" ? await this.#classifyProtectedPaths() : null;
    const beforeStartedAt = performance.now();
    const before = captureWorkspaceEffects ? await this.workspace.snapshot() : null;
    const snapshotBeforeMs = Math.max(0, performance.now() - beforeStartedAt);
    const rootCapability = await this.workspace.acquireRootHandleForProcess();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const stdoutRetained = { bytes: 0 };
    const stderrRetained = { bytes: 0 };
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let cancelled = false;

    let result: { exitCode: number | null; signal: NodeJS.Signals | null };
    const executionStartedAt = performance.now();
    try {
      const mountPlan = mountSnapshot === null ? null : planReadonlyMounts(mountSnapshot);
      const args = await this.#arguments(request.command, cwd, rootCapability, mountPlan);
      // Preparation awaits may outlive an accepted stop. No child exists yet.
      if (request.signal.aborted) {
        // SF1/L10：启动前已取消的命令一律写 not_started，与上限是否可用无关。
        return this.#notStartedResult(true, false, request.outputLimitBytes, { status: "not_started" });
      }
      result = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          const child = spawn(this.profile.bwrapPath!, args, {
            detached: true,
            // fd 3 是只读继承的 workspace 根句柄；bwrap 完成挂载后必须在 exec 前关闭它。
            stdio: ["ignore", "pipe", "pipe", rootCapability.fd],
            env: { PATH: "/usr/bin:/bin" },
          });
          const terminate = (reason: "timeout" | "cancel") => {
            if (reason === "timeout") timedOut = true;
            else cancelled = true;
            if (child.pid) {
              try {
                process.kill(-child.pid, "SIGTERM");
              } catch {
                // 进程组可能已经退出。
              }
              const killTimer = setTimeout(() => {
                try {
                  process.kill(-child.pid!, "SIGKILL");
                } catch {
                  // 进程组可能已经退出。
                }
              }, 250);
              killTimer.unref?.();
            }
          };
          const timeout = setTimeout(() => terminate("timeout"), request.timeoutMs);
          timeout.unref?.();
          const onAbort = () => terminate("cancel");
          request.signal.addEventListener("abort", onAbort, { once: true });
          // AbortSignal does not replay an abort that preceded registration.
          // Once spawned, termination still settles from the real child close.
          if (request.signal.aborted) onAbort();
          child.stdout!.on("data", (chunk: Buffer) => {
            stdoutBytes += chunk.byteLength;
            appendBounded(stdoutChunks, chunk, stdoutRetained, request.outputLimitBytes);
          });
          child.stderr!.on("data", (chunk: Buffer) => {
            stderrBytes += chunk.byteLength;
            appendBounded(stderrChunks, chunk, stderrRetained, request.outputLimitBytes);
          });
          child.once("error", reject);
          child.once("close", (exitCode, signal) => {
            clearTimeout(timeout);
            request.signal.removeEventListener("abort", onAbort);
            resolve({ exitCode, signal });
          });
        },
      );
    } catch (error) {
      throw new ProcessSandboxError(
        "launch_failed",
        error instanceof Error ? error.message : "隔离进程启动失败",
      );
    } finally {
      await rootCapability.close();
    }
    if (
      this.#workspaceMode === "read_only" &&
      result.exitCode === 126 &&
      Buffer.concat(stderrChunks).toString("utf8").includes(READONLY_CWD_GUARD_MARKER)
    ) {
      // D-CWD：沙箱内的 `pwd -P` 守卫发现进程不在 /workspace 下，命令本身没有运行。
      throw new ProcessSandboxError("invalid_arguments", "cwd 在沙箱内不在 /workspace 下");
    }
    const executionMs = Math.max(0, performance.now() - executionStartedAt);

    const afterStartedAt = performance.now();
    const after = captureWorkspaceEffects ? await this.workspace.snapshot() : null;
    const snapshotAfterMs = Math.max(0, performance.now() - afterStartedAt);
    const changedPaths = before && after ? this.workspace.diff(before, after) : [];

    let effects: ProcessExecutionEffects;
    if (this.#workspaceMode === "read_only") {
      // L15：只读执行从不 acceptAgentChanges，绝不推进 Kernel 认可的基线。
      const ordered = [...changedPaths].sort(byteOrder);
      const externalChangedPaths = ordered.slice(0, EXTERNAL_CHANGED_PATHS_LIMIT);
      effects = {
        sideEffect: "none",
        changedPaths: [],
        workspaceRevision: null,
        artifactRefs: [],
        externalChangedPaths,
        externalChangedPathsOmitted: Math.max(0, ordered.length - externalChangedPaths.length),
      };
    } else {
      const accepted = after ? await this.workspace.acceptAgentChanges(after, changedPaths) : null;
      effects =
        changedPaths.length > 0
          ? {
              sideEffect: "confirmed",
              changedPaths,
              workspaceRevision: accepted?.revision ?? null,
              artifactRefs: [],
            }
          : {
              sideEffect: "possible",
              changedPaths: [],
              workspaceRevision: accepted?.revision ?? null,
              artifactRefs: [],
            };
    }
    return {
      ...result,
      timedOut,
      cancelled,
      stdout: captured(stdoutChunks, stdoutBytes, request.outputLimitBytes),
      stderr: captured(stderrChunks, stderrBytes, request.outputLimitBytes),
      effects,
      sandboxProfileVersion: this.profile.version,
      timings: { snapshotBeforeMs, executionMs, snapshotAfterMs },
      resourceCaps: report,
    };
  }

  /**
   * D-ONECHECK：对 `.git` 和每条受保护路径各做一次 `lstat`，形成唯一的分类快照。
   * 在 `#run` 顶部、任何工作区快照或根句柄获取之前调用；之后不再重新分类。
   */
  async #classifyProtectedPaths(): Promise<ProtectedPathSnapshot> {
    const paths = [...new Set([".git", ...this.#protectedPaths])].sort(byteOrder);
    const states: ProtectedPathState[] = [];
    for (const relative of paths) {
      let kind: ProtectedPathKind;
      try {
        const metadata = await lstat(path.join(this.workspaceRoot, relative));
        if (metadata.isSymbolicLink()) kind = "symlink";
        else if (metadata.isDirectory()) kind = "directory";
        else if (metadata.isFile()) kind = "file";
        else kind = "other";
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") {
          kind = "absent";
        } else {
          throw new ProcessSandboxError(
            "launch_failed",
            error instanceof Error ? error.message : `受保护路径 ${relative} 无法分类`,
          );
        }
      }
      states.push({ path: relative, kind });
    }
    return { paths: states };
  }

  /**
   * D-IPC：受保护挂载只挡住普通文件；工作区里既有的 Unix socket 和 FIFO 仍是可用的
   * 宿主 IPC 端点。启动前做一次有界的 **广度优先** lstat 遍历，把找到的 socket/FIFO
   * 用只读 `/dev/null` 盖住（和受保护文件同一种遮蔽）。广度优先保证浅层（尤其根目录）
   * 的端点一定先于巨大深层子树被看到，不会被遍历上限挤掉。
   *
   * D-ONECHECK：只跳过计划真正遮蔽的子树（`readonlyIpcSkips`，来自顶部那次快照）；
   * 读取型祖先（目录形态的 `.git`）仍然进入。遍历本身仍可 readdir/lstat 发现端点。
   * 命令运行期间新出现的端点不在本次覆盖内（与现有 `shell` 沙箱相同的残留）。
   */
  async #ipcPaths(plan: ReadonlyMountPlan): Promise<readonly string[]> {
    const found: string[] = [];
    let scanned = 0;
    let level: Array<{ readonly directory: string; readonly relative: string }> = [
      { directory: this.workspaceRoot, relative: "." },
    ];
    for (let depth = 0; level.length > 0 && depth <= IPC_WALK_MAX_DEPTH; depth += 1) {
      const nextLevel: Array<{ readonly directory: string; readonly relative: string }> = [];
      for (const current of level) {
        if (scanned >= this.#ipcWalkMaxEntries) break;
        const entries = await readdir(current.directory, { withFileTypes: true }).catch(() => null);
        if (entries === null) continue;
        entries.sort((left, right) =>
          left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
        );
        for (const entry of entries) {
          if (scanned >= this.#ipcWalkMaxEntries) break;
          scanned += 1;
          const relative =
            current.relative === "." ? entry.name : `${current.relative}/${entry.name}`;
          if (readonlyIpcSkips(plan, relative)) continue;
          const metadata = await lstat(path.join(current.directory, entry.name)).catch(() => null);
          if (metadata === null || metadata.isSymbolicLink()) continue;
          if (metadata.isDirectory()) {
            nextLevel.push({ directory: path.join(current.directory, entry.name), relative });
          } else if (metadata.isSocket() || metadata.isFIFO()) {
            found.push(relative);
          }
        }
      }
      if (scanned >= this.#ipcWalkMaxEntries) break;
      level = nextLevel;
    }
    return found.sort(byteOrder);
  }

  async #arguments(
    command: string,
    cwd: string,
    rootCapability: FileHandle,
    mountPlan: ReadonlyMountPlan | null,
    gate?: string,
  ): Promise<string[]> {
    const readOnly = this.#workspaceMode === "read_only";
    const args = [
      "--die-with-parent",
      "--new-session",
      "--unshare-user",
      "--unshare-pid",
      "--unshare-net",
      "--unshare-ipc",
      "--unshare-uts",
      "--clearenv",
      "--setenv",
      "PATH",
      this.#executablePath,
      "--setenv",
      "LANG",
      "C.UTF-8",
      "--setenv",
      "LC_ALL",
      "C.UTF-8",
      "--setenv",
      "HOME",
      "/home/agent",
      "--setenv",
      "PYTHONDONTWRITEBYTECODE",
      "1",
      "--tmpfs",
      "/",
      "--dir",
      "/workspace",
      "--dir",
      "/home",
      "--dir",
      "/home/agent",
      "--dir",
      "/tmp",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
    ];
    for (const runtimePath of ["/usr", "/bin", "/lib", "/lib64"]) {
      try {
        await access(runtimePath);
        args.push("--ro-bind", runtimePath, runtimePath);
      } catch {
        // 该可选运行时目录在当前发行版不存在。
      }
    }

    const parentRoot = `/proc/self/fd/${String(rootCapability.fd)}`;
    const childRoot = "/proc/self/fd/3";
    // 使用 bwrap 的 fd 专用参数，使受信根在挂载后、exec 前关闭；若把
    // /proc/self/fd/3 当普通路径 bind，命令可能通过继承 fd 绕过受保护覆盖。
    // L13：只读模式改用 --ro-bind-fd，工作区根从挂载起就是只读。
    args.push(readOnly ? "--ro-bind-fd" : "--bind-fd", "3", "/workspace");
    for (const relative of this.#readOnlyPaths) {
      const metadata = await lstat(`${parentRoot}/${relative}`);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new ProcessSandboxError("launch_failed", "Runtime directory must be a real directory");
      args.push("--ro-bind", `${childRoot}/${relative}`, `/workspace/${relative}`);
    }
    if (readOnly) {
      // D-ONECHECK：只读挂载动作全部来自顶部快照推导的 plan，这里不再 lstat
      // 受保护路径；`.git` 是文件还是目录、哪些后代被丢弃，都已在 plan 里定死。
      if (mountPlan === null) {
        throw new ProcessSandboxError("launch_failed", "只读模式缺少受保护路径挂载计划");
      }
      for (const mount of mountPlan.mounts) {
        const destination = `/workspace/${mount.path}`;
        if (mount.action === "bind-readonly") {
          args.push("--ro-bind", `${childRoot}/${mount.path}`, destination);
        } else if (mount.action === "mask-tmpfs") {
          // 隐藏目录以空的临时文件系统覆盖，宿主内容不会进入 sandbox，
          // 再重挂为只读（L13）。
          args.push("--tmpfs", destination, "--remount-ro", destination);
        } else {
          // 隐藏文件以只读空设备覆盖，既不泄露内容也不允许修改宿主文件。
          args.push("--ro-bind", "/dev/null", destination);
        }
      }
      if (mountPlan.remountScratch) {
        // D-PROBE：没有任何受保护目录可重挂时，金丝雀仍要用私有 scratch tmpfs
        // 真正走一次 `--remount-ro`，否则缺该选项的 bwrap 会被误判为可用。
        args.push("--tmpfs", READONLY_REMOUNT_SCRATCH, "--remount-ro", READONLY_REMOUNT_SCRATCH);
      }
      // D-IPC：只读挂载挡不住既有的 Unix socket / FIFO，用只读 /dev/null 逐个盖住；
      // 跳过哪些子树完全由同一个 plan 决定。
      for (const relative of await this.#ipcPaths(mountPlan)) {
        args.push("--ro-bind", "/dev/null", `/workspace/${relative}`);
      }
    } else {
      // read_write 行为保持不变：逐路径 lstat，目录用空 tmpfs，文件用 /dev/null，
      // 目录形态的 `.git` 仍只读可读。
      for (const relative of this.#protectedPaths) {
        const parentSource = `${parentRoot}/${relative}`;
        const childSource = `${childRoot}/${relative}`;
        const destination = `/workspace/${relative}`;
        try {
          const metadata = await lstat(parentSource);
          if (metadata.isSymbolicLink()) {
            throw new ProcessSandboxError("launch_failed", `受保护路径 ${relative} 不能是 symlink`);
          }
          if (relative === ".git" && metadata.isDirectory()) {
            args.push("--ro-bind", childSource, destination);
          } else if (metadata.isDirectory()) {
            args.push("--tmpfs", destination);
          } else if (metadata.isFile()) {
            args.push("--ro-bind", "/dev/null", destination);
          } else {
            throw new ProcessSandboxError("launch_failed", `受保护路径 ${relative} 类型不安全`);
          }
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT" || code === "ENOTDIR") continue;
          throw error;
        }
      }
    }

    args.push(
      "--chdir",
      cwd === "." ? "/workspace" : `/workspace/${cwd}`,
      "--",
      "/bin/bash",
      "--noprofile",
      "--norc",
    );
    // D-CWD：主机侧解析过的目录仍可能在 --chdir 前被换掉；进入沙箱后先用
    // `pwd -P` 确认进程落在 /workspace 下，再运行用户命令。
    const finalCommand = readOnly ? `${READONLY_CWD_GUARD}; ${command}` : command;
    if (gate === undefined) {
      args.push("-lc", finalCommand);
    } else {
      // L1/L4：有上限时闸门作为 `-c`，命令作为 `$1`，闸门原地 exec `bash -lc "$1"`。
      args.push("-c", gate, "agent-gate", finalCommand);
    }
    return args;
  }

  #noneEffects(): ProcessExecutionEffects {
    const base: ProcessExecutionEffects = {
      sideEffect: "none",
      changedPaths: [],
      workspaceRevision: null,
      artifactRefs: [],
    };
    return this.#workspaceMode === "read_only"
      ? { ...base, externalChangedPaths: [], externalChangedPathsOmitted: 0 }
      : base;
  }

  #notStartedResult(
    cancelled: boolean,
    timedOut: boolean,
    limit: number,
    report: ResourceCapsReport,
  ): ProcessExecutionResult {
    return {
      exitCode: null,
      signal: null,
      timedOut,
      cancelled,
      stdout: captured([], 0, limit),
      stderr: captured([], 0, limit),
      effects: this.#noneEffects(),
      sandboxProfileVersion: this.profile.version,
      timings: { snapshotBeforeMs: 0, executionMs: 0, snapshotAfterMs: 0 },
      resourceCaps: report,
    };
  }
}

/** L31b/K3-49：停 scope 用哪个 systemctl，以及最多等多久。 */
const SYSTEMCTL_DEFAULT = "/usr/bin/systemctl";
const SCOPE_STOP_DEADLINE_MS = 5_000;

/**
 * L31b/K3-49：命令在放行以前被取消时，Host 停掉自己建的那个 systemd scope。
 * 资源上限片的结算只关 Host 这一端的 fd；scope 里没有进程时 systemd 收不到
 * “已空”的通知，单元会一直留着（资源上限片 §9 的已知限制）。
 *
 * 只作为 RE1 的测试缝导出：DSH 沙箱没有 `/sys/fs/cgroup` 和 `/run/user`，
 * 走不到有上限的起跑，非零退出、spawn 失败和 5 秒无回答这三条失败分支只能
 * 直接测这个函数。生产只有 `#runCapped` 的 `not_started_cancelled` 返回前调它。
 *
 * 停不掉不影响结果：沙箱没有别的诊断接缝，只写一行 stderr，从不抛。
 * `timeoutMs` 也只为测试能缩短等待；生产用 5 秒。
 */
export async function stopCancelledScope(
  unitName: string,
  options: { readonly systemctlPath?: string; readonly timeoutMs?: number } = {},
): Promise<void> {
  const systemctlPath =
    options.systemctlPath ?? process.env["CODING_AGENT_SYSTEMCTL_PATH"] ?? SYSTEMCTL_DEFAULT;
  const deadlineMs = options.timeoutMs ?? SCOPE_STOP_DEADLINE_MS;
  let timer: NodeJS.Timeout | null = null;
  let settled = false;
  const finish = (reason: string | null): void => {
    if (settled) return;
    settled = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (reason !== null) {
      // systemctl 的 stderr 可能有多行；一行日志是约定，所以压成一行。
      process.stderr.write(
        `agent-next: scope stop failed: ${unitName}: ${reason.replace(/[\r\n]+/g, " ")}\n`,
      );
    }
  };
  // 同 `#resolveResourceCaps` 的路径规则：不是绝对路径的覆盖按“停不掉”处理，
  // 绝不静默换成另一个二进制。
  if (!path.isAbsolute(systemctlPath)) {
    finish("systemctl path is not absolute");
    return;
  }
  let child: ChildProcess;
  try {
    child = spawn(systemctlPath, ["--user", "stop", unitName], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    finish(messageOf(error));
    return;
  }
  await new Promise<void>((resolve) => {
    let stderrText = "";
    const done = (reason: string | null): void => {
      finish(reason);
      resolve();
    };
    timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // 可能已退出。
      }
      done(`no answer within ${String(deadlineMs)}ms`);
    }, deadlineMs);
    timer.unref?.();
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrText.length < 512) stderrText += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      done(messageOf(error));
    });
    child.once("close", (code, signal) => {
      // systemctl 退出 5 是“单元没加载”：启动器在建 scope 之前就被停了，或者
      // systemd 已经收走了它。没有东西可停，不算停不掉，不记日志。
      if (code === 0 || code === 5) {
        done(null);
        return;
      }
      const detail = stderrText.trim().slice(0, 256);
      const how = code === null ? `signal ${String(signal)}` : `exit ${String(code)}`;
      done(detail === "" ? how : `${how}: ${detail}`);
    });
  });
}

// ---------------------------------------------------------------------------
// RL resource-cap helpers (L5–L7). Pure or Host-local; no `systemctl` calls.
// ---------------------------------------------------------------------------

function zeroCounters(): ResourceCapCounters {
  return { memory: { max: 0, oom: 0, oomKill: 0, oomGroupKill: 0 }, pids: { max: 0 } };
}

function initialSettlementState(): SettlementState {
  return {
    phase: "starting",
    hasPid: false,
    keeperPid: null,
    stopReason: null,
    startupFailure: null,
    bwrapExited: false,
    finalize: "none",
    observationComplete: false,
    keeperClosed: false,
    streamsClosed: false,
    escalationPending: false,
  };
}

/**
 * 有界等待（静止等待最多 1 秒、探测等 scope 消失最多 2 秒）里的一步。计时器不 unref：
 * 关掉 fd 5 以后（探测等 scope 消失时）进程里可能没有别的活句柄，unref 的计时器会让
 * Node 在调用方还在 await 的时候直接退出（RL-08…RL-09b 的子 Node Host）。
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** L13：Kernel 再核一次请求；不对就 `launch_failed`（没开始）。 */
function validateResourceCapRequest(request: ResourceCapRequest): void {
  if (
    !Number.isSafeInteger(request.memoryMaxBytes) ||
    request.memoryMaxBytes < 16 * 1_048_576 ||
    request.memoryMaxBytes % 1_048_576 !== 0
  ) {
    throw new ProcessSandboxError(
      "launch_failed",
      "memoryMaxBytes 必须是 1 MiB 的整数倍且不小于 16 MiB",
    );
  }
  if (
    !Number.isSafeInteger(request.tasksMax) ||
    request.tasksMax < 8 ||
    request.tasksMax > 4_194_304
  ) {
    throw new ProcessSandboxError("launch_failed", "tasksMax 必须是 8 到 4194304 的整数");
  }
}

/** L5 第 3 步：第一行第一个十进制整数。 */
function firstDecimalInteger(text: string): number | null {
  const match = /\d+/.exec(text);
  return match === null ? null : Number(match[0]);
}

function resolveSystemdRunPath(): string {
  return process.env["CODING_AGENT_SYSTEMD_RUN_PATH"] ?? SYSTEMD_RUN_DEFAULT;
}

function resolveBwrapPath(): string {
  return process.env["CODING_AGENT_BWRAP_PATH"] ?? BWRAP_DEFAULT;
}

interface ResourceCapProbeOptions {
  readonly oomPolicy: boolean;
  readonly expandEnvironment: boolean;
}
interface ResourceCapProbeResult {
  readonly capability: ResourceCapCapability;
  readonly options: ResourceCapProbeOptions;
}

interface ResourceCapCacheEntry {
  result: ResourceCapProbeResult | null;
  readonly promise: Promise<ResourceCapProbeResult>;
}

// SF3/L5：按（systemd-run 路径、bwrap 路径、uid）缓存；同时只跑一个。
const resourceCapCache = new Map<string, ResourceCapCacheEntry>();

function resourceCapCacheKey(systemdRunPath: string, bwrapPath: string): string {
  return `${systemdRunPath}\u0000${bwrapPath}\u0000${String(process.getuid?.() ?? -1)}`;
}

/** SF3/L5：作废这个键的缓存，别的键（例如默认键）不动；下一条命令重新探测。 */
function invalidateResourceCapCache(key: string): void {
  resourceCapCache.delete(key);
}

function probeResourceCapsInternal(
  systemdRunPath: string = resolveSystemdRunPath(),
  bwrapPath: string = resolveBwrapPath(),
): Promise<ResourceCapProbeResult> {
  const key = resourceCapCacheKey(systemdRunPath, bwrapPath);
  const cached = resourceCapCache.get(key);
  if (cached !== undefined) return cached.promise;
  // 探测本身永远不 reject：任何意外都落成 probe_failed，缓存里也不会留一个拒绝。
  const promise = runResourceCapProbe(systemdRunPath, bwrapPath).catch((error) => ({
    capability: { status: "unavailable" as const, reason: "probe_failed" as const, detail: messageOf(error) },
    options: { oomPolicy: false, expandEnvironment: false },
  }));
  const entry: ResourceCapCacheEntry = { result: null, promise };
  resourceCapCache.set(key, entry);
  void promise.then((result) => {
    if (resourceCapCache.get(key) === entry) entry.result = result;
  });
  return promise;
}

/** L5：按（systemd-run 路径、bwrap 路径、uid）缓存；同时只跑一个。 */
export function probeResourceCaps(): Promise<ResourceCapCapability> {
  return probeResourceCapsInternal().then(result => result.capability);
}

/** L5：只读缓存，不探测；没探测过是 `unknown`。 */
export function resourceCapStatus(): ResourceCapCapability | { readonly status: "unknown" } {
  const key = resourceCapCacheKey(resolveSystemdRunPath(), resolveBwrapPath());
  const result = resourceCapCache.get(key)?.result ?? null;
  return result === null ? { status: "unknown" } : result.capability;
}

async function runResourceCapProbe(
  systemdRunPath: string,
  bwrapPath: string,
): Promise<ResourceCapProbeResult> {
  const fail = (
    reason: ResourceCapUnavailableReason,
    detail: string,
  ): ResourceCapProbeResult => ({
    capability: { status: "unavailable", reason, detail },
    options: { oomPolicy: false, expandEnvironment: false },
  });
  // MF2/L5：一次探测最多 10 秒。到点先让所有探测工作停下，再有界清理
  //（SIGKILL 加等 close、结算的升级和静止），最后一律 probe_failed。
  const controller = new AbortController();
  const deadlineAt = performance.now() + RESOURCE_CAP_PROBE_DEADLINE_MS;
  const timer = setTimeout(() => { controller.abort(); }, RESOURCE_CAP_PROBE_DEADLINE_MS);
  timer.unref?.();
  const signal = controller.signal;
  const remaining = (): number => Math.max(0, deadlineAt - performance.now());
  const steps = async (): Promise<ResourceCapProbeResult> => {
    if (process.platform !== "linux") return fail("not_linux", `platform=${process.platform}`);
    try {
      await readFile("/sys/fs/cgroup/cgroup.controllers", "utf8");
    } catch (error) {
      return fail("no_cgroup_v2", messageOf(error));
    }
    let oomPolicy = false;
    let expandEnvironment = false;
    try {
      if (!path.isAbsolute(systemdRunPath)) throw new Error("systemd-run 路径不是绝对路径");
      await access(systemdRunPath, constants.X_OK);
      const line = (await commandOutput(systemdRunPath, ["--version"], signal)).split("\n")[0] ?? "";
      const version = firstDecimalInteger(line);
      oomPolicy = version !== null && version >= 253;
      expandEnvironment = version !== null && version >= 254;
    } catch (error) {
      return fail("no_systemd_run", messageOf(error));
    }
    const uid = process.getuid?.();
    if (uid === undefined) return fail("no_user_session", "process.getuid 不可用");
    try {
      const runtimeDir = await stat(`/run/user/${String(uid)}`);
      if (!runtimeDir.isDirectory() || runtimeDir.uid !== uid) {
        throw new Error("XDG_RUNTIME_DIR 不是本用户的目录");
      }
      // MF1/R1/L5 第 4 步：`/run/user/<uid>` 才要求是目录；`systemd/private`
      // 只要求存在，类型不限（真机上它是 socket，不是目录）。
      await stat(`/run/user/${String(uid)}/systemd/private`);
    } catch (error) {
      return fail("no_user_session", messageOf(error));
    }
    // L5 第 5 步（`ProcessSandbox.probe`）在第 6 步的金丝雀里一起证明。
    return {
      capability: await ProcessSandbox.probeResourceCapsCanary(
        systemdRunPath,
        bwrapPath,
        { oomPolicy, expandEnvironment },
        signal,
        remaining,
      ),
      options: { oomPolicy, expandEnvironment },
    };
  };
  try {
    const result = await steps();
    // MF2：到点后不论内层返回什么（包括 step 5 的失败），都是 probe_failed。
    if (signal.aborted) return fail("probe_failed", RESOURCE_CAP_PROBE_DEADLINE_DETAIL);
    return result;
  } catch (error) {
    if (signal.aborted) return fail("probe_failed", RESOURCE_CAP_PROBE_DEADLINE_DETAIL);
    return fail("probe_failed", messageOf(error));
  } finally {
    clearTimeout(timer);
  }
}
