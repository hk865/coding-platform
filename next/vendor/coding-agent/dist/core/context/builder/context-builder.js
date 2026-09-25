import { contextFragmentSchema, memoryItemSchema, skillContextSchema, } from "../types/context-types.js";
import { modelRequestSchema, modelToolSpecSchema, } from "../../ports/model_client/model-client-port.js";
import { transcriptEntrySchema } from "../../runtime/state/run-state.js";
export class ContextBuildError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "ContextBuildError";
    }
}
function byPriorityThenId(left, right) {
    return right.priority - left.priority || left.id.localeCompare(right.id, "en");
}
function assertUnique(values, label) {
    if (new Set(values).size !== values.length) {
        throw new ContextBuildError("duplicate_id", `${label} 中存在重复 id`);
    }
}
function section(kind, id, source, content) {
    return `[${kind} id=${JSON.stringify(id)} source=${JSON.stringify(source)}]\n${content}`;
}
function buildSystemPrompt(input) {
    const parts = [input.baseSystemPrompt];
    const instructions = [...input.additionalInstructions].sort(byPriorityThenId);
    const skillInstructions = input.skills
        .filter((skill) => skill.kind === "instruction")
        .sort(byPriorityThenId);
    const references = input.skills
        .filter((skill) => skill.kind === "reference")
        .sort(byPriorityThenId);
    const memories = [...input.memories].sort(byPriorityThenId);
    for (const item of instructions) {
        parts.push(section("additional_instruction", item.id, item.source, item.content));
    }
    for (const item of skillInstructions) {
        parts.push(section("skill_instruction", item.id, item.source, item.content));
    }
    for (const item of references) {
        parts.push(section("reference_data", item.id, item.source, item.content));
    }
    for (const item of memories) {
        parts.push(section("memory_data", item.id, item.source, item.content));
    }
    return parts.join("\n\n");
}
function toModelMessages(transcript) {
    const pendingCallIds = new Set();
    const settledCallIds = new Set();
    return transcript.map((entry, index) => {
        const parsed = transcriptEntrySchema.safeParse(entry);
        if (!parsed.success) {
            throw new ContextBuildError("invalid_transcript", `transcript[${index}] 非法：${parsed.error.issues[0]?.message ?? "unknown"}`);
        }
        const item = parsed.data;
        if (item.kind === "user_message") {
            return {
                role: "user",
                messageId: item.message.messageId,
                content: item.message.content,
            };
        }
        if (item.kind === "assistant_message") {
            for (const call of item.toolCalls) {
                if (pendingCallIds.has(call.callId) || settledCallIds.has(call.callId)) {
                    throw new ContextBuildError("invalid_transcript", `重复 ToolCall ${call.callId}`);
                }
                pendingCallIds.add(call.callId);
            }
            return {
                role: "assistant",
                messageId: item.message.messageId,
                content: item.message.content,
                ...(item.message.reasoningContent
                    ? { reasoningContent: item.message.reasoningContent }
                    : {}),
                toolCalls: item.toolCalls,
            };
        }
        if (!pendingCallIds.has(item.callId) || settledCallIds.has(item.callId)) {
            throw new ContextBuildError("invalid_transcript", `ToolResult ${item.callId} 没有唯一且未结算的 ToolCall`);
        }
        pendingCallIds.delete(item.callId);
        settledCallIds.add(item.callId);
        return { role: "tool", callId: item.callId, result: item.result };
    });
}
function validateInput(input) {
    if (input.requestId.trim().length === 0 ||
        input.runId.trim().length === 0 ||
        input.baseSystemPrompt.length === 0 ||
        !Number.isSafeInteger(input.tokenBudget) ||
        input.tokenBudget <= 0 ||
        (input.maxOutputTokens !== null &&
            (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens <= 0))) {
        throw new ContextBuildError("invalid_input", "ContextBuilder 的标识、提示或预算非法");
    }
    for (const item of input.additionalInstructions)
        contextFragmentSchema.parse(item);
    for (const item of input.skills)
        skillContextSchema.parse(item);
    for (const item of input.memories)
        memoryItemSchema.parse(item);
    for (const item of input.tools)
        modelToolSpecSchema.parse(item);
    assertUnique(input.additionalInstructions.map((item) => item.id), "additionalInstructions");
    assertUnique(input.skills.map((item) => item.id), "skills");
    assertUnique(input.memories.map((item) => item.id), "memories");
}
export function buildModelRequest(input) {
    validateInput(input);
    const tools = [...input.tools].sort((left, right) => left.name.localeCompare(right.name, "en"));
    if (new Set(tools.map((tool) => tool.name)).size !== tools.length) {
        throw new ContextBuildError("duplicate_tool", "工具名必须唯一");
    }
    return modelRequestSchema.parse({
        schemaVersion: 1,
        requestId: input.requestId,
        runId: input.runId,
        systemPrompt: buildSystemPrompt(input),
        messages: toModelMessages(input.transcript),
        tools,
        maxOutputTokens: input.maxOutputTokens,
    });
}
export class DeterministicContextBuilder {
    build(input) {
        return buildModelRequest(input);
    }
}
//# sourceMappingURL=context-builder.js.map