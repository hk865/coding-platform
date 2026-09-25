/**
 * 模块职责：把宿主 `controlHooks` 适配进既有 HookRegistry/HookExecutor，仅暴露暂停控制。
 *
 * 设计边界：本适配器不实现新的暂停机制，也不在模型/工具调用进行中伪造 pause。RuntimeRunner
 * 没有可直接调用的 pause 方法：pause 只能在 before_model / before_tool 边界由 Hook 决策产生，
 * 且只有 `run.paused` 经 required Session sink 真正落盘后 Runner 才会返回 paused 状态。
 * 调用进行中只能通过 AbortSignal 取消，本适配器不会把它 ack 成 pause。
 * 关键流程：校验 Hook 点 → 用 PauseOnly 包装器注册 → 冻结为 HookExecutor。
 * 未接通能力（after_tool 暂停、控制 Hook 的 block/modify/fail）显式报 unsupported。
 */
import { HookExecutor } from "../../core/hooks/executor/hook-executor.js";
import { HookRegistry } from "../../core/hooks/registry/hook-registry.js";
/** 组合根对宿主显式暴露的「未接通」信号；不猜测、不假装成功。 */
export class ControlHookUnsupportedError extends Error {
    code = "unsupported";
    constructor(message) {
        super(message);
        this.name = "ControlHookUnsupportedError";
    }
}
class PauseOnlyBeforeModelHook {
    inner;
    hookId;
    point = "before_model";
    priority;
    constructor(inner) {
        this.inner = inner;
        this.hookId = inner.hookId;
        this.priority = inner.priority;
    }
    async execute(invocation, options) {
        const decision = await this.inner.execute(invocation, options);
        if (decision.kind === "continue" || decision.kind === "pause")
            return decision;
        throw new ControlHookUnsupportedError(`控制 Hook ${this.hookId} 在 before_model 只能 continue 或 pause，收到 ${decision.kind}`);
    }
}
class PauseOnlyBeforeToolHook {
    inner;
    hookId;
    point = "before_tool";
    priority;
    constructor(inner) {
        this.inner = inner;
        this.hookId = inner.hookId;
        this.priority = inner.priority;
    }
    async execute(invocation, options) {
        const decision = await this.inner.execute(invocation, options);
        if (decision.kind === "continue" || decision.kind === "pause")
            return decision;
        throw new ControlHookUnsupportedError(`控制 Hook ${this.hookId} 在 before_tool 只能 continue 或 pause，收到 ${decision.kind}`);
    }
}
/**
 * 构造控制用 HookExecutor；未提供 controlHooks 时返回 undefined，
 * 使默认 CLI 继续使用 RuntimeRunner 的内置空执行器（行为不变）。
 */
export function createControlHookExecutor(hooks) {
    if (!hooks || hooks.length === 0)
        return undefined;
    const registry = new HookRegistry();
    for (const hook of hooks) {
        if (hook.point === "after_tool") {
            throw new ControlHookUnsupportedError(`控制 Hook ${hook.hookId} 使用 after_tool：当前 RuntimeRunner 不支持 after_tool 暂停`);
        }
        registry.register(hook.point === "before_model"
            ? new PauseOnlyBeforeModelHook(hook)
            : new PauseOnlyBeforeToolHook(hook));
    }
    return new HookExecutor(registry);
}
//# sourceMappingURL=control-hooks.js.map