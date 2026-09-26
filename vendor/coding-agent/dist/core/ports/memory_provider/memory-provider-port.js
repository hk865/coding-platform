/** Core 的长期记忆召回/写入窄端口。 */
import { z } from "zod";
import { memoryItemSchema } from "../../context/types/context-types.js";
export const MAX_MEMORY_QUERY_BYTES = 16 * 1024;
export const MAX_MEMORY_RECALL_LIMIT = 100;
export const memoryRecallRequestSchema = z
    .object({
    schemaVersion: z.literal(1),
    query: z.string().trim().min(1),
    workspaceIdentity: z.string().trim().min(1),
    limit: z.number().int().positive().max(MAX_MEMORY_RECALL_LIMIT),
})
    .strict()
    .refine((value) => Buffer.byteLength(value.query, "utf8") <= MAX_MEMORY_QUERY_BYTES, {
    message: "memory query 超过字节上限",
});
export const memoryWriteRequestSchema = z
    .object({
    schemaVersion: z.literal(1),
    workspaceIdentity: z.string().trim().min(1),
    item: memoryItemSchema,
})
    .strict();
export const memoryWriteResultSchema = z.discriminatedUnion("status", [
    z.object({ status: z.literal("stored"), id: z.string().trim().min(1) }).strict(),
    z
        .object({
        status: z.literal("ignored"),
        reason: z.enum(["provider_disabled", "duplicate"]),
    })
        .strict(),
]);
export class MemoryProviderError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "MemoryProviderError";
    }
}
//# sourceMappingURL=memory-provider-port.js.map