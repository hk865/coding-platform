/** 显式关闭长期记忆的生产默认 Adapter。 */
import { memoryRecallRequestSchema, memoryWriteRequestSchema, MemoryProviderError, } from "../../../core/ports/memory_provider/memory-provider-port.js";
const EMPTY_MEMORIES = Object.freeze([]);
const DISABLED_RESULT = Object.freeze({
    status: "ignored",
    reason: "provider_disabled",
});
function assertActive(signal) {
    if (signal.aborted)
        throw new MemoryProviderError("cancelled", "Memory 操作已取消");
}
export class EmptyMemoryProvider {
    async recall(request, options) {
        assertActive(options.signal);
        memoryRecallRequestSchema.parse(request);
        assertActive(options.signal);
        return EMPTY_MEMORIES;
    }
    async write(request, options) {
        assertActive(options.signal);
        memoryWriteRequestSchema.parse(request);
        assertActive(options.signal);
        return DISABLED_RESULT;
    }
}
//# sourceMappingURL=empty-memory-provider.js.map