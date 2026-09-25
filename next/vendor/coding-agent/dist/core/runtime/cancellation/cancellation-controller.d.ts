/**
 * 模块职责：统一管理一次 Run 的取消信号、取消原因和幂等取消状态。
 *
 * 设计边界：它只传播协作式取消，不直接终止进程、模型连接或文件操作。
 * 关键流程：首次 cancel 保存原因并触发 AbortSignal；各边界使用同一信号及时停止。
 */
export type CancellationReason = "caller_requested" | "user_interrupt" | "process_signal";
export declare class CancellationController {
    #private;
    get signal(): AbortSignal;
    get reason(): CancellationReason | null;
    cancel(reason: CancellationReason): void;
    link(signal: AbortSignal | undefined, reason?: CancellationReason): () => void;
}
export declare function isAbortError(error: unknown): boolean;
//# sourceMappingURL=cancellation-controller.d.ts.map