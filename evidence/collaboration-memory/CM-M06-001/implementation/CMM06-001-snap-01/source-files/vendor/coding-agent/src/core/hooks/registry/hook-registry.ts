/**
 * 模块职责：维护 Hook 注册项，并为执行器提供稳定、可冻结的按 Hook 点查询结果。
 *
 * 设计边界：注册表不调用 Hook，也不解释 Hook 返回的决策。
 * 关键流程：注册时校验身份与重复项，查询时稳定排序，运行前冻结以避免中途变更。
 */
import { hookRegistrationSchema } from "../protocol/hook-protocol.js";
import type { HookPoint, HookPort } from "../protocol/hook-protocol.js";

export class HookRegistryError extends Error {
  constructor(
    readonly code: "duplicate_hook" | "registry_frozen" | "invalid_hook",
    message: string,
  ) {
    super(message);
    this.name = "HookRegistryError";
  }
}

export class HookRegistry {
  readonly #hooks = new Map<string, HookPort>();
  #frozen = false;

  constructor(hooks: readonly HookPort[] = []) {
    for (const hook of hooks) this.register(hook);
  }

  register(hook: HookPort): void {
    if (this.#frozen) throw new HookRegistryError("registry_frozen", "HookRegistry 已冻结");
    const parsed = hookRegistrationSchema.safeParse({
      schemaVersion: 1,
      hookId: hook.hookId,
      point: hook.point,
      priority: hook.priority,
    });
    if (!parsed.success) {
      throw new HookRegistryError(
        "invalid_hook",
        parsed.error.issues[0]?.message ?? "Hook 注册非法",
      );
    }
    if (this.#hooks.has(hook.hookId)) {
      throw new HookRegistryError("duplicate_hook", `重复 hookId: ${hook.hookId}`);
    }
    this.#hooks.set(hook.hookId, hook);
  }

  freeze(): this {
    this.#frozen = true;
    return this;
  }

  list<TPoint extends HookPoint>(point: TPoint): readonly Extract<HookPort, { point: TPoint }>[] {
    return [...this.#hooks.values()]
      .filter((hook): hook is Extract<HookPort, { point: TPoint }> => hook.point === point)
      .sort(
        (left, right) => right.priority - left.priority || left.hookId.localeCompare(right.hookId),
      );
  }
}
