/**
 * 模块职责：定义 Core 共享的 JSON 值、上下文片段、技能和记忆的数据类型与校验规则。
 *
 * 设计边界：这里只表达可跨边界传递的值，不包含选择策略、存储方式或运行时行为。
 * 关键流程：调用方先用 schema 校验外部值，再使用由 schema 推导出的 TypeScript 类型。
 */
import { z } from "zod";
export type JsonPrimitive = null | boolean | number | string;
export interface JsonObject {
    readonly [key: string]: JsonValue;
}
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonArray = readonly JsonValue[];
export declare const jsonValueSchema: z.ZodType<JsonValue>;
export declare const jsonObjectSchema: z.ZodType<JsonObject>;
export declare const nonEmptyIdSchema: z.ZodString;
export declare const isoUtcDateTimeSchema: z.ZodString;
export declare const userMessageSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    messageId: z.ZodString;
    role: z.ZodLiteral<"user">;
    content: z.ZodString;
}, z.core.$strict>;
export declare const assistantMessageSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    messageId: z.ZodString;
    role: z.ZodLiteral<"assistant">;
    content: z.ZodString;
    reasoningContent: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type UserMessage = z.infer<typeof userMessageSchema>;
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;
export declare const contextFragmentSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodString;
    content: z.ZodString;
    priority: z.ZodNumber;
    source: z.ZodString;
}, z.core.$strict>;
export declare const skillContextSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodString;
    title: z.ZodString;
    content: z.ZodString;
    kind: z.ZodEnum<{
        instruction: "instruction";
        reference: "reference";
    }>;
    priority: z.ZodNumber;
    source: z.ZodString;
}, z.core.$strict>;
export declare const memoryItemSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodString;
    content: z.ZodString;
    priority: z.ZodNumber;
    source: z.ZodString;
    createdAt: z.ZodString;
}, z.core.$strict>;
export type ContextFragment = z.infer<typeof contextFragmentSchema>;
export type SkillContext = z.infer<typeof skillContextSchema>;
export type MemoryItem = z.infer<typeof memoryItemSchema>;
//# sourceMappingURL=context-types.d.ts.map