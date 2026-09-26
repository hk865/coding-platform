/** Core 的长期记忆召回/写入窄端口。 */
import { z } from "zod";
import { type MemoryItem } from "../../context/types/context-types.js";
export declare const MAX_MEMORY_QUERY_BYTES: number;
export declare const MAX_MEMORY_RECALL_LIMIT = 100;
export declare const memoryRecallRequestSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    query: z.ZodString;
    workspaceIdentity: z.ZodString;
    limit: z.ZodNumber;
}, z.core.$strict>;
export declare const memoryWriteRequestSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    workspaceIdentity: z.ZodString;
    item: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        id: z.ZodString;
        content: z.ZodString;
        priority: z.ZodNumber;
        source: z.ZodString;
        createdAt: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const memoryWriteResultSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    status: z.ZodLiteral<"stored">;
    id: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    status: z.ZodLiteral<"ignored">;
    reason: z.ZodEnum<{
        provider_disabled: "provider_disabled";
        duplicate: "duplicate";
    }>;
}, z.core.$strict>], "status">;
export type MemoryRecallRequest = z.infer<typeof memoryRecallRequestSchema>;
export type MemoryWriteRequest = z.infer<typeof memoryWriteRequestSchema>;
export type MemoryWriteResult = z.infer<typeof memoryWriteResultSchema>;
export type MemoryProviderErrorCode = "invalid_request" | "unavailable" | "cancelled" | "internal";
export declare class MemoryProviderError extends Error {
    readonly code: MemoryProviderErrorCode;
    constructor(code: MemoryProviderErrorCode, message: string);
}
export interface MemoryProviderPort {
    recall(request: Readonly<MemoryRecallRequest>, options: Readonly<{
        signal: AbortSignal;
    }>): Promise<readonly MemoryItem[]>;
    write(request: Readonly<MemoryWriteRequest>, options: Readonly<{
        signal: AbortSignal;
    }>): Promise<MemoryWriteResult>;
}
//# sourceMappingURL=memory-provider-port.d.ts.map