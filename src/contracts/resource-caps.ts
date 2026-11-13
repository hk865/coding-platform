/**
 * 模块职责：资源上限设置（Host 设置 `resourceCaps`）的平台契约。
 *
 * 设计边界：平台契约不引 vendor 类型；这里的报告和原因类型是 Kernel
 * `sandbox/process/process-sandbox.ts` 同名类型的同形副本（spec §2）。
 * 关键流程：Host 保存整份设置（L13），按本机内存算默认值，把生效值推给
 * Host 私有快照；上限不进任何配置、授权、准备好的执行、摘要或恢复约束。
 */

export const MIB = 1_048_576;

export const RESOURCE_CAP_DEFAULT_TASKS_MAX = 512;
export const RESOURCE_CAP_DEFAULT_MEMORY_CEILING_MIB = 6144;
export const RESOURCE_CAP_MIN_MEMORY_MIB = 256;
export const RESOURCE_CAP_MIN_TASKS = 64;
export const RESOURCE_CAP_MAX_TASKS = 65_536;

/** 121-112：命令不按时间停；Kernel 的工具定义和沙箱请求要正整数，用 Node 计时器的最大值。Kernel 的 `SHELL_NO_STOP_MS` 另有一份（Kernel 不能 import 平台代码）。 */
export const COMMAND_NO_STOP_MS = 2_147_483_647;
/** 121-112（lead 读法）：agent 没填时长时的预计时长；也是“超过 10 分钟才显示”的那条线。 */
export const COMMAND_DEFAULT_EXPECTED_MS = 600_000;
export const COMMAND_VISIBLE_AFTER_MS = 600_000;
/** SHT-2：项目审查线的默认值（分钟）。人是产品决定改它，`command-review/save` 把它存进 Host 设置。 */
export const DEFAULT_COMMAND_REVIEW_LINE_MINUTES = 60;

/**
 * 121-112：到线 = min(agent 的预计时长, 审查线)；不到 10 分钟的预计按 10 分钟算（§9 Q3）。
 * 人设的审查线不受这个下限影响：审查线更短时它先到。
 */
export function commandLineMs(expectedMs: number, reviewLineMs: number): number {
  return Math.min(Math.max(expectedMs, COMMAND_VISIBLE_AFTER_MS), reviewLineMs);
}

export type ResourceCapSettingsV1 = {
  schemaVersion: 1;
  memoryMaxMiB: number | null;
  tasksMax: number | null;
};

/** L13：`min(floor(本机内存字节 / 2 MiB), 6144)`，`tasksMax` 默认 512。 */
export function defaultResourceCapSettings(totalMemoryBytes: number): {
  memoryMaxMiB: number;
  tasksMax: number;
} {
  return {
    memoryMaxMiB: Math.min(
      Math.floor(totalMemoryBytes / (2 * MIB)),
      RESOURCE_CAP_DEFAULT_MEMORY_CEILING_MIB,
    ),
    tasksMax: RESOURCE_CAP_DEFAULT_TASKS_MAX,
  };
}

export type ResourceCapUnavailableReasonV1 =
  | "not_linux"
  | "no_cgroup_v2"
  | "no_systemd_run"
  | "no_user_session"
  | "controllers_not_delegated"
  | "literal_arguments_not_preserved"
  | "sandbox_unavailable"
  | "probe_failed"
  | "not_configured";

export type ResourceCapsReportV1 =
  | {
      readonly status: "applied";
      readonly memoryMaxBytes: number;
      readonly tasksMax: number;
      readonly memory: "cap_hit" | "none_observed" | "uncertain";
      readonly processes: "cap_hit" | "none_observed" | "unknown";
      readonly observationComplete: boolean;
    }
  | { readonly status: "none"; readonly reason: ResourceCapUnavailableReasonV1; readonly text: string }
  | { readonly status: "not_started" };
