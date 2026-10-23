/**
 * The frozen prompt set and request-record facts (slice 6-7 spec §2, ruling
 * 13). A prepared execution stores the exact text it will send; manifests carry
 * the set, bodies carry the texts by digest. This module is contract code: no
 * IO, no clock, no Host import.
 */
import type { ArtifactRef } from '../artifact.js';
import type { ReadResult } from '../core/results.js';
import type { ContextCallKindV1, ContextSectionNameV1 } from '../graph-context.js';
import { sha256Hex } from '../fingerprint.js';
import type { ToolTextV1 } from './prompt-pack.js';

/** Content type of a prompt text body: a template, the merged string table, the merged base or a Skill content. */
export const PROMPT_TEXT_CONTENT_TYPE = 'application/vnd.coding-platform.prompt-text;version=1';
/** Content type of a body holding `JSON.stringify` of the request's tool specs. */
export const PROMPT_TOOL_SPECS_CONTENT_TYPE = 'application/vnd.coding-platform.prompt-tool-specs+json;version=1';
/** Content type of one tool text's canonical body (ruling 19). */
export const PROMPT_TOOL_TEXT_CONTENT_TYPE =
    'application/vnd.coding-platform.prompt-tool-text+json;version=1';

/**
 * The narrow text surface every renderer takes (ruling 14). A resolved pack
 * satisfies it structurally: a renderer only reads the template texts and the
 * string table, never the manifest, tools or origins.
 */
export type PromptTextsV1 = {
    templates: Readonly<Record<string, string>>;
    strings: Readonly<Record<string, string>>;
};

/**
 * What the prepared execution froze for one model request (spec §2). Digest
 * fields are lowercase hex; `toolSpecsRef` is the stored tool-spec text.
 */
export type ModelRequestPromptFactsV1 = {
    systemDigest: string;
    toolsDigest: string;
    toolSpecsRef: ArtifactRef;
    /** Only a Work record stores it; a Query request record has `reservedOutput`. */
    maxOutputTokens?: number;
    selection: {
        inputTokens: number;
        budget: number;
        removed: {
            memory: number;
            skillReference: number;
            additionalInstruction: number;
            toolResultBody: number;
            historyExchange: number;
            historyConclusion: number;
            currentExchange: number;
        };
    };
};

/** A Query request record's facts: the output cap is the existing `reservedOutput`. */
export type QueryRequestPromptFactsV1 = Omit<ModelRequestPromptFactsV1, 'maxOutputTokens'>;

/** One request as the read port returns it; the output cap is required per execution kind. */
export type PromptRecordRequestV1 = { requestId: string } & Omit<ModelRequestPromptFactsV1, 'maxOutputTokens'>
    & ({ kind: 'work'; maxOutputTokens: number } | { kind: 'query'; reservedOutput: number });

/** What `readPromptRecord` returns: the set, its requests and every text keyed by sha256 hex. */
export type PromptRecordReadResultV1 = {
    set: PromptSetV1;
    requests: PromptRecordRequestV1[];
    /** Keyed by each text's sha256 hex: the same digest the set and the records carry. */
    texts: Record<string, string>;
};

/** The value `readPromptRecord` returns, or a contract rejection. */
export type PromptRecordReadV1 = ReadResult<PromptRecordReadResultV1>;

/**
 * The prepared manifest's prompt set (spec §2). `skills[]` entries carry the
 * same `schemaVersion: 1` as a Kernel `SkillContext`; `sectionOrder` holds the
 * order the input template's own slot text declares (ruling 9), with only the
 * call kinds it covers.
 */
export type PromptSetV1 = {
    schemaVersion: 1;
    modelId: string;
    provider: string;
    model: string;
    packId: string;
    reasoningReplay: 'current_run' | 'none';
    sectionOrder: Partial<Record<ContextCallKindV1, ContextSectionNameV1[]>>;
    templates: { id: string; version: number; packId: string; digest: string; ref: ArtifactRef }[];
    /** The string table merged across inheritance. */
    strings: { digest: string; ref: ArtifactRef };
    /** The base text with the Host's additional instruction already merged in. */
    base: { templateId: string; version: number; digest: string; ref: ArtifactRef };
    skills: {
        schemaVersion: 1;
        id: string;
        title: string;
        kind: 'instruction' | 'reference';
        priority: number;
        source: string;
        digest: string;
        ref: ArtifactRef;
    }[];
    /** The final Kernel tool list in its frozen order (ruling 16), never sorted. */
    toolNames: string[];
    /** Each frozen tool text, sorted by name (ruling 19). */
    tools: { name: string; packId: string; digest: string; ref: ArtifactRef }[];
};

/**
 * Reads the selection-bearing part of a `BoundModel` (source-tool-ports.ts).
 * Contracts may not import core, so the shape is structural; a `BoundModel` is
 * assignable to it. This is the only reader of `selection`: absence means a
 * test-built model, which keeps today's revision, platform pack and replay.
 */
export function promptSelectionOf(model: {
    configuration: { revision: string };
    selection?: { modelId: string; promptPack: string; reasoningReplay: 'current_run' | 'none' };
}): { modelId: string; promptPack: string; reasoningReplay: 'current_run' | 'none' } {
    const { selection } = model;
    if (selection === undefined)
        return { modelId: model.configuration.revision, promptPack: 'platform', reasoningReplay: 'current_run' };
    return { modelId: selection.modelId, promptPack: selection.promptPack, reasoningReplay: selection.reasoningReplay };
}

/**
 * Strictly decodes one `PromptSetV1`: every field is required except
 * `sectionOrder`'s call kinds, `maxOutputTokens`-style optionals do not appear
 * here, and an unknown or missing field anywhere yields `null` (ruling 13). All
 * manifest loaders use it.
 */
export function decodePromptSetV1(value: unknown): PromptSetV1 | null {
    const CALL_KINDS: ReadonlySet<string> = new Set([
        'work', 'continuation', 'handoff', 'review', 'secretary', 'copy', 'planning', 'attention',
    ]);
    const SECTION_NAMES: ReadonlySet<string> = new Set([
        'role', 'goal', 'task', 'footprint', 'notes', 'reminders', 'inputs', 'continuation', 'unknown_call_review',
    ]);
    const SOURCE_KINDS: ReadonlySet<string> = new Set(['plan-revision', 'workspace', 'governance', 'artifact', 'memory']);
    const DIGEST = /^[0-9a-f]{64}$/;
    const isRecord = (input: unknown): input is Record<string, unknown> =>
        typeof input === 'object' && input !== null && !Array.isArray(input);
    const isString = (input: unknown): input is string => typeof input === 'string';
    const isNumber = (input: unknown): input is number => typeof input === 'number' && Number.isFinite(input);
    const hasExactKeys = (input: Record<string, unknown>, keys: readonly string[]): boolean => {
        const actual = Object.keys(input);
        return actual.length === keys.length && keys.every(key => Object.hasOwn(input, key));
    };
    const isRef = (input: unknown): boolean => {
        if (!isRecord(input) || !hasExactKeys(input, ['kind', 'contentType', 'digest', 'sizeBytes', 'source'])) return false;
        if (input['kind'] !== 'artifact' || !isString(input['contentType'])) return false;
        if (!isString(input['digest']) || !DIGEST.test(input['digest']) || !isNumber(input['sizeBytes'])) return false;
        const source = input['source'];
        if (!isRecord(source) || !isString(source['kind']) || !SOURCE_KINDS.has(source['kind'])) return false;
        if (!isString(source['refId']) || !isString(source['revision'])) return false;
        const sourceKeys = Object.keys(source);
        return sourceKeys.length === 3 || (sourceKeys.length === 4 && isString(source['digest']));
    };
    const isTemplate = (input: unknown): boolean => isRecord(input)
        && hasExactKeys(input, ['id', 'version', 'packId', 'digest', 'ref'])
        && isString(input['id']) && isNumber(input['version']) && isString(input['packId'])
        && isString(input['digest']) && DIGEST.test(input['digest']) && isRef(input['ref']);
    const isTool = (input: unknown): boolean => isRecord(input)
        && hasExactKeys(input, ['name', 'packId', 'digest', 'ref'])
        && isString(input['name']) && input['name'] !== ''
        && isString(input['packId']) && input['packId'] !== ''
        && isString(input['digest']) && DIGEST.test(input['digest'])
        && isRef(input['ref']);
    const isSkill = (input: unknown): boolean => isRecord(input)
        && hasExactKeys(input, ['schemaVersion', 'id', 'title', 'kind', 'priority', 'source', 'digest', 'ref'])
        && input['schemaVersion'] === 1
        && isString(input['id']) && isString(input['title'])
        && (input['kind'] === 'instruction' || input['kind'] === 'reference')
        && isNumber(input['priority']) && isString(input['source'])
        && isString(input['digest']) && DIGEST.test(input['digest']) && isRef(input['ref']);

    if (!isRecord(value)) return null;
    if (!hasExactKeys(value, [
        'schemaVersion', 'modelId', 'provider', 'model', 'packId', 'reasoningReplay',
        'sectionOrder', 'templates', 'strings', 'base', 'skills', 'toolNames', 'tools',
    ])) return null;
    if (value['schemaVersion'] !== 1) return null;
    for (const field of ['modelId', 'provider', 'model', 'packId'] as const)
        if (!isString(value[field])) return null;
    if (value['reasoningReplay'] !== 'current_run' && value['reasoningReplay'] !== 'none') return null;

    const sectionOrder = value['sectionOrder'];
    if (!isRecord(sectionOrder)) return null;
    for (const [kind, sections] of Object.entries(sectionOrder)) {
        if (!CALL_KINDS.has(kind) || !Array.isArray(sections)) return null;
        if (!sections.every(section => isString(section) && SECTION_NAMES.has(section))) return null;
    }

    const templates = value['templates'];
    if (!Array.isArray(templates) || !templates.every(isTemplate)) return null;

    const strings = value['strings'];
    if (!isRecord(strings) || !hasExactKeys(strings, ['digest', 'ref'])) return null;
    if (!isString(strings['digest']) || !DIGEST.test(strings['digest']) || !isRef(strings['ref'])) return null;

    const base = value['base'];
    if (!isRecord(base) || !hasExactKeys(base, ['templateId', 'version', 'digest', 'ref'])) return null;
    if (!isString(base['templateId']) || !isNumber(base['version'])) return null;
    if (!isString(base['digest']) || !DIGEST.test(base['digest']) || !isRef(base['ref'])) return null;

    const skills = value['skills'];
    if (!Array.isArray(skills) || !skills.every(isSkill)) return null;

    const toolNames = value['toolNames'];
    if (!Array.isArray(toolNames)
        || !toolNames.every(name => isString(name) && name !== '')
        || new Set(toolNames).size !== toolNames.length) return null;

    const tools = value['tools'];
    if (!Array.isArray(tools) || !tools.every(isTool)) return null;
    const toolEntries = tools as Record<string, unknown>[];
    const names = toolEntries.map(entry => entry['name'] as string);
    if (new Set(names).size !== names.length) return null;
    for (let index = 1; index < names.length; index += 1) {
        if (names[index - 1]!.localeCompare(names[index]!, 'en') >= 0) return null;
    }

    return value as unknown as PromptSetV1;
}

/**
 * The canonical body of one tool text (ruling 19): the description and the
 * parameters, whose keys are sorted the same way the frozen set sorts tool
 * names. The store and the editing routes both hash exactly this string.
 */
export function canonicalToolTextBody(entry: ToolTextV1): string {
    const parameters: Record<string, string> = {};
    for (const key of Object.keys(entry.parameters).sort((left, right) => left.localeCompare(right, 'en')))
        parameters[key] = entry.parameters[key]!;
    return JSON.stringify({ description: entry.description, parameters });
}

/** `sha256` of the canonical body: the frozen set's tool-text digest. */
export function promptToolTextDigest(entry: ToolTextV1): string {
    return sha256Hex(canonicalToolTextBody(entry));
}

/**
 * A stored body only when it is the text `ref` names (ruling 17): the expected
 * content type matches the ref, the record's ref agrees on content type, digest
 * and size, and the body's own SHA-256 and UTF-8 size match that ref. The
 * record is structural because contracts may not import record-store: a
 * `RawArtifactRecord` and the contracts' `ArtifactRecord` both satisfy it.
 */
export function checkPromptBody(
    ref: ArtifactRef,
    record: { ref: ArtifactRef; body: string },
    contentType: string,
): string | null {
    if (ref.contentType !== contentType) return null;
    if (record.ref.contentType !== ref.contentType) return null;
    if (record.ref.digest !== ref.digest) return null;
    if (record.ref.sizeBytes !== ref.sizeBytes) return null;
    if (sha256Hex(record.body) !== ref.digest) return null;
    if (Buffer.byteLength(record.body, 'utf8') !== ref.sizeBytes) return null;
    return record.body;
}
