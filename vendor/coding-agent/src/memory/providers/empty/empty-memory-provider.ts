/** 显式关闭长期记忆的生产默认 Adapter。 */
import {
  memoryRecallRequestSchema,
  memoryWriteRequestSchema,
  MemoryProviderError,
  type MemoryProviderPort,
  type MemoryRecallRequest,
  type MemoryWriteRequest,
  type MemoryWriteResult,
} from "../../../core/ports/memory_provider/memory-provider-port.js";
import type { MemoryItem } from "../../../core/context/types/context-types.js";

const EMPTY_MEMORIES: readonly MemoryItem[] = Object.freeze([]);
const DISABLED_RESULT: MemoryWriteResult = Object.freeze({
  status: "ignored",
  reason: "provider_disabled",
});

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw new MemoryProviderError("cancelled", "Memory 操作已取消");
}

export class EmptyMemoryProvider implements MemoryProviderPort {
  async recall(
    request: Readonly<MemoryRecallRequest>,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<readonly MemoryItem[]> {
    assertActive(options.signal);
    memoryRecallRequestSchema.parse(request);
    assertActive(options.signal);
    return EMPTY_MEMORIES;
  }

  async write(
    request: Readonly<MemoryWriteRequest>,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<MemoryWriteResult> {
    assertActive(options.signal);
    memoryWriteRequestSchema.parse(request);
    assertActive(options.signal);
    return DISABLED_RESULT;
  }
}
