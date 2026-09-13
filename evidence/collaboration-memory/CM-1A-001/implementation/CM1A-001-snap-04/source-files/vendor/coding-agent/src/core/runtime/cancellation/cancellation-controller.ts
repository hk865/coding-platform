/**
 * 模块职责：统一管理一次 Run 的取消信号、取消原因和幂等取消状态。
 *
 * 设计边界：它只传播协作式取消，不直接终止进程、模型连接或文件操作。
 * 关键流程：首次 cancel 保存原因并触发 AbortSignal；各边界使用同一信号及时停止。
 */
export type CancellationReason = "caller_requested" | "user_interrupt" | "process_signal";

export class CancellationController {
  readonly #controller = new AbortController();
  #reason: CancellationReason | null = null;

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  get reason(): CancellationReason | null {
    return this.#reason;
  }

  cancel(reason: CancellationReason): void {
    if (this.#reason !== null) return;
    this.#reason = reason;
    this.#controller.abort(reason);
  }

  link(
    signal: AbortSignal | undefined,
    reason: CancellationReason = "caller_requested",
  ): () => void {
    if (!signal) return () => undefined;
    const onAbort = () => this.cancel(reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    return () => signal.removeEventListener("abort", onAbort);
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
