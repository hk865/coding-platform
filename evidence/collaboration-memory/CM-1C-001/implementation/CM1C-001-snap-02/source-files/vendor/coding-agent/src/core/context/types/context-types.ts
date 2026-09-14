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

const finiteNumberSchema = z.number().finite();

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    finiteNumberSchema,
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema);

export const nonEmptyIdSchema = z.string().trim().min(1);
export const isoUtcDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => value.endsWith("Z"), "时间必须使用 UTC Z 后缀");

export const userMessageSchema = z
  .object({
    schemaVersion: z.literal(1),
    messageId: nonEmptyIdSchema,
    role: z.literal("user"),
    content: z.string().min(1),
  })
  .strict();

export const assistantMessageSchema = z
  .object({
    schemaVersion: z.literal(1),
    messageId: nonEmptyIdSchema,
    role: z.literal("assistant"),
    content: z.string(),
    /** Provider 可公开返回、且后续请求协议要求回传的推理内容。 */
    reasoningContent: z.string().min(1).optional(),
  })
  .strict();

export type UserMessage = z.infer<typeof userMessageSchema>;
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;

export const contextFragmentSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: nonEmptyIdSchema,
    content: z.string().min(1),
    priority: z.number().int(),
    source: z.string().trim().min(1),
  })
  .strict();

export const skillContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: nonEmptyIdSchema,
    title: z.string().trim().min(1),
    content: z.string().min(1),
    kind: z.enum(["instruction", "reference"]),
    priority: z.number().int(),
    source: z.string().trim().min(1),
  })
  .strict();

export const memoryItemSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: nonEmptyIdSchema,
    content: z.string().min(1),
    priority: z.number().int(),
    source: z.string().trim().min(1),
    createdAt: isoUtcDateTimeSchema,
  })
  .strict();

export type ContextFragment = z.infer<typeof contextFragmentSchema>;
export type SkillContext = z.infer<typeof skillContextSchema>;
export type MemoryItem = z.infer<typeof memoryItemSchema>;
