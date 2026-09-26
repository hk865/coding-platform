/**
 * 模块职责：把宿主 `controlHooks` 适配进既有 HookRegistry/HookExecutor，暴露暂停控制与 before_tool 拒绝。
 *
 * 设计边界：本适配器不实现新的暂停机制，也不在模型/工具调用进行中伪造 pause。RuntimeRunner
 * 没有可直接调用的 pause 方法：pause 只能在 before_model / before_tool 边界由 Hook 决策产生，
 * 且只有 `run.paused` 经 required Session sink 真正落盘后 Runner 才会返回 paused 状态。
 * 调用进行中只能通过 AbortSignal 取消，本适配器不会把它 ack 成 pause。
 * 关键流程：校验 Hook 点 → 用受控包装器注册 → 冻结为 HookExecutor。
 * before_model 仍仅 continue/pause；before_tool 额外透传既有 `block`，由未改动的 RuntimeRunner
 * 转成 `hook_blocked` 工具错误交回模型。after_tool、modify/fail 继续显式 unsupported。
 */
import { HookExecutor } from "../../core/hooks/executor/hook-executor.js";
import type { HookPort } from "../../core/hooks/protocol/hook-protocol.js";
/** 组合根对宿主显式暴露的「未接通」信号；不猜测、不假装成功。 */
export declare class ControlHookUnsupportedError extends Error {
    readonly code = "unsupported";
    constructor(message: string);
}
/**
 * 构造控制用 HookExecutor；未提供 controlHooks 时返回 undefined，
 * 使默认 CLI 继续使用 RuntimeRunner 的内置空执行器（行为不变）。
 */
export declare function createControlHookExecutor(hooks: readonly HookPort[] | undefined): HookExecutor | undefined;
//# sourceMappingURL=control-hooks.d.ts.map