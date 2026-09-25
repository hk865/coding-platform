/** 显式关闭长期记忆的生产默认 Adapter。 */
import { type MemoryProviderPort, type MemoryRecallRequest, type MemoryWriteRequest, type MemoryWriteResult } from "../../../core/ports/memory_provider/memory-provider-port.js";
import type { MemoryItem } from "../../../core/context/types/context-types.js";
export declare class EmptyMemoryProvider implements MemoryProviderPort {
    recall(request: Readonly<MemoryRecallRequest>, options: Readonly<{
        signal: AbortSignal;
    }>): Promise<readonly MemoryItem[]>;
    write(request: Readonly<MemoryWriteRequest>, options: Readonly<{
        signal: AbortSignal;
    }>): Promise<MemoryWriteResult>;
}
//# sourceMappingURL=empty-memory-provider.d.ts.map