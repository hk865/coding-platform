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
