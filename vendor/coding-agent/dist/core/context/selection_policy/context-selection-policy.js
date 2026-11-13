export class ContextSelectionError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "ContextSelectionError";
    }
}
export class CharacterTokenEstimator {
    estimate(input) {
        const serialized = JSON.stringify(input);
        return Math.max(1, Math.ceil(serialized.length / 3));
    }
}
/** 统一校验估算器结果，避免 SelectionPolicy 和 Hook 后复核出现语义分叉。 */
export function estimateTokens(input, estimator) {
    try {
        const value = estimator.estimate(input);
        if (!Number.isSafeInteger(value) || value <= 0)
            throw new Error("invalid token estimate");
        return value;
    }
    catch (error) {
        throw new ContextSelectionError("token_estimation_failed", error instanceof Error ? error.message : "token estimator 失败");
    }
}
const TOOL_RESULT_PLACEHOLDER = (toolName, callId) => `内容因长度省略（工具 ${toolName}，调用 ${callId}），需要时重新读`;
const TAIL_RESULT_TRUNCATED = (kept, total) => `结果过长，本次上下文只放得下前 ${kept} 字节（原 ${total} 字节）；需要其余部分请缩小范围或分页再读`;
function utf8Prefix(text, bytes) {
    if (bytes <= 0)
        return "";
    const buffer = Buffer.from(text, "utf8");
    let end = Math.min(bytes, buffer.length);
    while (end > 0 && ((buffer[end] ?? 0) & 0xc0) === 0x80)
        end -= 1;
    return buffer.subarray(0, end).toString("utf8");
}
function tailResultText(output) {
    return output.length === 1 && output[0]?.kind === "text"
        ? output[0].text
        : JSON.stringify(output);
}
function emptyRemoved() {
    return {
        memory: 0,
        skillReference: 0,
        additionalInstruction: 0,
        toolResultBody: 0,
        historyExchange: 0,
        historyConclusion: 0,
        currentExchange: 0,
    };
}
/**
 * 历史/当前标记只在过滤前计算一次；过滤只复制被改动的 entry 和 message，
 * 不在原对象上 delete。思考过滤后既无正文、又无思考、也无调用的 assistant 才从出站副本移除。
 */
function outgoingEntries(transcript, historyEntryCount, replay) {
    const result = [];
    transcript.forEach((entry, index) => {
        const history = index < historyEntryCount;
        if (replay === undefined) {
            result.push({ entry, history });
            return;
        }
        let outgoing = entry;
        if (entry.kind === "assistant_message" &&
            entry.message.reasoningContent !== undefined &&
            (replay === "none" || history)) {
            const { reasoningContent: _removed, ...message } = entry.message;
            outgoing = { ...entry, message };
        }
        if (outgoing.kind === "assistant_message") {
            const hasContent = outgoing.message.content.length > 0;
            const hasReasoning = (outgoing.message.reasoningContent?.length ?? 0) > 0;
            const hasCalls = outgoing.toolCalls.length > 0;
            if (!hasContent && !hasReasoning && !hasCalls)
                return;
        }
        result.push({ entry: outgoing, history });
    });
    return result;
}
/**
 * 完整交换 = assistant 声明的全部 callId 紧接着都有一条自己的结果。
 * 只按真实相邻位置收结果；缺失结果的组保持未闭合，整组受保护。
 */
function scanExchanges(entries) {
    const scans = [];
    for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index].entry;
        if (entry.kind !== "assistant_message" || entry.toolCalls.length === 0)
            continue;
        const expected = new Set(entry.toolCalls.map((call) => call.callId));
        const resultIndexes = [];
        let cursor = index + 1;
        while (cursor < entries.length) {
            const candidate = entries[cursor].entry;
            if (candidate.kind !== "tool_result" || !expected.has(candidate.callId))
                break;
            expected.delete(candidate.callId);
            resultIndexes.push(cursor);
            cursor += 1;
        }
        scans.push({
            assistantIndex: index,
            callIds: entry.toolCalls.map((call) => call.callId),
            resultIndexes,
            closed: expected.size === 0,
        });
    }
    return scans;
}
function removalOrder(left, right) {
    return left.priority - right.priority || right.id.localeCompare(left.id, "en");
}
function buildRemovalUnits(input, entries, taskInputMessageId) {
    const units = [];
    for (const memory of [...input.memories].sort(removalOrder)) {
        units.push({ kind: "memory", id: memory.id });
    }
    for (const skill of input.skills
        .filter((value) => value.kind === "reference")
        .sort(removalOrder)) {
        units.push({ kind: "skillReference", id: skill.id });
    }
    for (const instruction of [...input.additionalInstructions].sort(removalOrder)) {
        units.push({ kind: "additionalInstruction", id: instruction.id });
    }
    const callNames = new Map();
    for (const value of entries) {
        if (value.entry.kind !== "assistant_message")
            continue;
        for (const call of value.entry.toolCalls)
            callNames.set(call.callId, call.name);
    }
    const scans = scanExchanges(entries);
    const tailScan = scans.findLast((scan) => !entries[scan.assistantIndex].history && scan.closed &&
        scan.resultIndexes[scan.resultIndexes.length - 1] === entries.length - 1);
    const partlyClosedResults = new Set();
    for (const scan of scans) {
        if (scan.closed)
            continue;
        for (const resultIndex of scan.resultIndexes)
            partlyClosedResults.add(resultIndex);
    }
    // 第 4 步：只缩历史成功结果正文；新 output 的 UTF-8 JSON 必须严格更短。
    for (let index = 0; index < entries.length; index += 1) {
        const { entry, history } = entries[index];
        if (!history || entry.kind !== "tool_result")
            continue;
        if (entry.result.status !== "success" || partlyClosedResults.has(index))
            continue;
        const toolName = callNames.get(entry.callId);
        if (toolName === undefined)
            continue;
        const output = [
            { kind: "text", text: TOOL_RESULT_PLACEHOLDER(toolName, entry.callId) },
        ];
        if (Buffer.byteLength(JSON.stringify(output), "utf8") <
            Buffer.byteLength(JSON.stringify(entry.result.output), "utf8")) {
            units.push({ kind: "toolResultBody", callId: entry.callId, output });
        }
    }
    const latestUserIndex = entries.findLastIndex((value) => value.entry.kind === "user_message");
    const protectedIds = new Set();
    if (latestUserIndex >= 0) {
        const latest = entries[latestUserIndex].entry;
        if (latest.kind === "user_message")
            protectedIds.add(latest.message.messageId);
    }
    if (taskInputMessageId !== null)
        protectedIds.add(taskInputMessageId);
    // K2 L7: a compaction summary message stands for every Turn it replaced; dropping it
    // would silently lose that history again.
    for (const { entry, history } of entries) {
        if (history && entry.kind === "user_message" && entry.message.messageId.startsWith("context-summary:")) {
            protectedIds.add(entry.message.messageId);
        }
    }
    const scanByAssistant = new Map();
    for (const scan of scans)
        scanByAssistant.set(scan.assistantIndex, scan);
    // 第 5 步：历史消息按位置，完整交换与 user 消息各算一个单位。
    for (let index = 0; index < entries.length; index += 1) {
        const { entry, history } = entries[index];
        if (!history)
            continue;
        if (entry.kind === "user_message") {
            if (protectedIds.has(entry.message.messageId))
                continue;
            units.push({ kind: "historyExchange", id: entry.message.messageId });
            continue;
        }
        const scan = scanByAssistant.get(index);
        if (scan !== undefined && scan.closed) {
            if (entry.kind !== "assistant_message")
                continue;
            units.push({
                kind: "historyExchange",
                id: entry.message.messageId,
                callIds: scan.callIds,
            });
        }
    }
    // 第 6 步：历史中无工具调用的 assistant 结论。
    for (const { entry, history } of entries) {
        if (!history || entry.kind !== "assistant_message" || entry.toolCalls.length > 0)
            continue;
        units.push({ kind: "historyConclusion", id: entry.message.messageId });
    }
    // 第 7 步：当前执行的完整工具交换；当前 user 与无调用 assistant 不在此列。
    for (const scan of scans) {
        if (scan === tailScan)
            continue;
        if (entries[scan.assistantIndex].history || !scan.closed)
            continue;
        const assistant = entries[scan.assistantIndex].entry;
        if (assistant.kind !== "assistant_message")
            continue;
        units.push({
            kind: "currentExchange",
            id: assistant.message.messageId,
            callIds: scan.callIds,
        });
    }
    return { units, tail: tailScan?.callIds };
}
function applyPrefix(input, entries, units, count) {
    let memories = [...input.memories];
    let skills = [...input.skills];
    let additionalInstructions = [...input.additionalInstructions];
    let transcript = [...entries];
    const removed = emptyRemoved();
    for (let index = 0; index < count; index += 1) {
        const unit = units[index];
        removed[unit.kind] += 1;
        switch (unit.kind) {
            case "memory":
                memories = memories.filter((value) => value.id !== unit.id);
                break;
            case "skillReference":
                skills = skills.filter((value) => value.id !== unit.id);
                break;
            case "additionalInstruction":
                additionalInstructions = additionalInstructions.filter((value) => value.id !== unit.id);
                break;
            case "toolResultBody": {
                const output = unit.output;
                if (output === undefined)
                    throw new Error("toolResultBody 单位缺少替换正文");
                transcript = transcript.map((value) => value.entry.kind === "tool_result" && value.entry.callId === unit.callId
                    ? {
                        ...value,
                        entry: {
                            ...value.entry,
                            result: { ...value.entry.result, output },
                        },
                    }
                    : value);
                break;
            }
            case "historyConclusion":
                transcript = transcript.filter((value) => value.entry.kind !== "assistant_message" ||
                    value.entry.message.messageId !== unit.id);
                break;
            case "historyExchange":
            case "currentExchange": {
                if (unit.callIds === undefined) {
                    transcript = transcript.filter((value) => value.entry.kind !== "user_message" ||
                        value.entry.message.messageId !== unit.id);
                    break;
                }
                const callIds = new Set(unit.callIds);
                transcript = transcript.filter((value) => {
                    if (value.entry.kind === "assistant_message") {
                        return value.entry.message.messageId !== unit.id;
                    }
                    if (value.entry.kind === "tool_result")
                        return !callIds.has(value.entry.callId);
                    return true;
                });
                break;
            }
        }
    }
    return {
        selected: {
            ...input,
            memories,
            skills,
            additionalInstructions,
            transcript: transcript.map((value) => value.entry),
        },
        removed,
    };
}
/**
 * 先 k=0；再 k=N；否则在 (0, N] 二分最小的可行前缀。
 * 只使用自身预览返回 fits 的前缀；返回的是该次预览的 outgoing 请求。
 */
export async function selectContext(input, options) {
    const entries = outgoingEntries(input.transcript, options.historyEntryCount, options.reasoningReplay);
    const { units, tail } = buildRemovalUnits(input, entries, options.taskInputMessageId);
    const preview = async (count) => {
        const prefix = applyPrefix(input, entries, units, count);
        const request = options.build(prefix.selected);
        const result = await options.previewRequest(request);
        return { prefix, preview: result };
    };
    const report = (outcome) => ({
        requestId: input.requestId,
        inputTokens: outcome.preview.inputTokens,
        budget: input.tokenBudget - outcome.preview.outputReserve,
        removed: outcome.prefix.removed,
    });
    const finish = (outcome) => ({
        selected: outcome.prefix.selected,
        request: outcome.preview.outgoing,
        report: report(outcome),
    });
    const truncateTail = async (base) => {
        if (tail === undefined)
            return undefined;
        const targets = new Set(tail);
        const texts = new Map();
        for (const entry of base.selected.transcript) {
            if (entry.kind === "tool_result" && targets.has(entry.callId)) {
                texts.set(entry.callId, tailResultText(entry.result.output));
            }
        }
        let high = Math.max(0, ...[...texts.values()].map((text) => Buffer.byteLength(text, "utf8")));
        const previewAt = async (cap) => {
            const transcript = base.selected.transcript.map((entry) => {
                const text = entry.kind === "tool_result" ? texts.get(entry.callId) : undefined;
                if (text === undefined || entry.kind !== "tool_result")
                    return entry;
                const kept = utf8Prefix(text, cap);
                const output = [{
                        kind: "text",
                        text: `${kept}\n${TAIL_RESULT_TRUNCATED(Buffer.byteLength(kept, "utf8"), Buffer.byteLength(text, "utf8"))}`,
                    }];
                return { ...entry, result: { ...entry.result, output } };
            });
            const selected = { ...base.selected, transcript };
            const result = await options.previewRequest(options.build(selected));
            return {
                prefix: { selected, removed: { ...base.removed,
                        toolResultBody: base.removed.toolResultBody + texts.size } },
                preview: result,
            };
        };
        const zeroCap = await previewAt(0);
        if (!zeroCap.preview.fits)
            return undefined;
        let low = 0;
        while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if ((await previewAt(middle)).preview.fits)
                low = middle;
            else
                high = middle - 1;
        }
        return low === 0 ? zeroCap : previewAt(low);
    };
    const zero = await preview(0);
    if (zero.preview.fits)
        return finish(zero);
    const all = units.length === 0 ? zero : await preview(units.length);
    if (units.length > 0 && all.preview.fits) {
        const cache = new Map([
            [0, zero],
            [units.length, all],
        ]);
        let low = 1;
        let high = units.length;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            let candidate = cache.get(middle);
            if (candidate === undefined) {
                candidate = await preview(middle);
                cache.set(middle, candidate);
            }
            if (candidate.preview.fits)
                high = middle;
            else
                low = middle + 1;
        }
        const chosen = cache.get(high);
        if (!chosen.preview.fits) {
            throw new ContextSelectionError("required_content_over_budget", `不可裁剪 Context 需要 ${chosen.preview.inputTokens} tokens，输入预算为 ${input.tokenBudget - chosen.preview.outputReserve}`);
        }
        return finish(chosen);
    }
    const truncated = await truncateTail(all.prefix);
    if (truncated !== undefined)
        return finish(truncated);
    throw new ContextSelectionError("required_content_over_budget", `不可裁剪 Context 需要 ${all.preview.inputTokens} tokens，输入预算为 ${input.tokenBudget - all.preview.outputReserve}`);
}
//# sourceMappingURL=context-selection-policy.js.map