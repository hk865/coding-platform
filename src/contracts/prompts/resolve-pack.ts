/**
 * Resolves and validates a prompt-pack chain (ruling 4). The chain is the read
 * files of the requested pack first and `platform` last. This is pure: it has
 * no IO, no clock and never throws; every problem it finds is returned in one
 * result, naming the pack (and the template or tool when it has one).
 */
import type {
    PromptPackChainEntryV1, PromptPackManifestV1, PromptPackProblemV1, PromptPackValidationV1,
    ResolvedPromptPackV1, ToolTextV1,
} from './prompt-pack.js';
import { parseTemplateV1 } from './render-template.js';
import { TEMPLATE_SLOTS } from './slot-tables.js';

const PACK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The omission markers the state guard relies on: structure, never prose (ruling 5). */
const FIXED_STRINGS: ReadonlySet<string> = new Set([
    'context.omissions.heading', 'context.omissions.prefix', 'context.omissions.suffix',
    'context.omissions.nameSeparator',
]);

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
    return typeof value === 'string';
}

/**
 * The problems of a manifest file path: it must be relative and must not carry a
 * `..` segment (`..name` is legal). Every independently decidable problem is
 * returned in this order; an empty path is the only one it can have.
 */
function fileProblems(file: string): string[] {
    const problems: string[] = [];
    if (file === '') return ['file must name a path'];
    if (file.startsWith('/') || file.startsWith('\\') || /^[a-z]:/i.test(file))
        problems.push(`file "${file}" must be relative`);
    if (file.split(/[\\/]/).includes('..')) problems.push(`file "${file}" must not contain a ".." segment`);
    return problems;
}

type ParsedJson = { status: 'ok'; value: JsonRecord } | { status: 'problem'; reason: string };

function jsonObject(text: string, what: string): ParsedJson {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return { status: 'problem', reason: `${what} is not valid JSON` };
    }
    if (!isRecord(value)) return { status: 'problem', reason: `${what} must be a JSON object` };
    return { status: 'ok', value };
}

type ChainState = {
    entry: PromptPackChainEntryV1;
    index: number;
    manifest: JsonRecord | null;
};

/**
 * The string keys the platform pack defines are the vocabulary a person's pack
 * may override. A broken platform table leaves the set unknown; the platform
 * problem is reported anyway, so the children check nothing extra.
 */
function knownStringKeys(states: readonly ChainState[]): ReadonlySet<string> | null {
    const platform = states.find(state => state.entry.packId === 'platform');
    if (platform === undefined || platform.manifest === null) return null;
    const file = platform.manifest['strings'];
    if (!isString(file) || file !== platform.entry.strings.file) return null;
    const parsed = jsonObject(platform.entry.strings.text, 'the string table');
    return parsed.status === 'ok' ? new Set(Object.keys(parsed.value)) : null;
}

export function resolvePromptPackV1(chain: readonly PromptPackChainEntryV1[]): PromptPackValidationV1 {
    const problems: PromptPackProblemV1[] = [];
    const report = (packId: string, templateId: string | null, reason: string, toolName?: string): void => {
        problems.push(toolName === undefined
            ? { packId, templateId, reason }
            : { packId, templateId, toolName, reason });
    };

    if (chain.length === 0) {
        report('', null, 'the prompt pack chain is empty');
        return { status: 'rejected', problems };
    }

    // Chain structure: ids unique, the platform last and nowhere else.
    const seenIds = new Set<string>();
    for (const [index, entry] of chain.entries()) {
        if (seenIds.has(entry.packId)) report(entry.packId, null, `pack "${entry.packId}" appears more than once`);
        seenIds.add(entry.packId);
        if (entry.packId === 'platform' && index !== chain.length - 1)
            report(entry.packId, null, 'pack id "platform" is reserved for the last pack');
    }
    const last = chain[chain.length - 1]!;
    if (last.packId !== 'platform') report(last.packId, null, 'the pack chain must end at the platform pack');

    // Read every manifest before deciding anything: all problems are collected.
    const states: ChainState[] = chain.map((entry, index) => {
        const parsed = jsonObject(entry.manifest.text, 'the manifest');
        if (parsed.status === 'problem') {
            report(entry.packId, null, parsed.reason);
            return { entry, index, manifest: null };
        }
        return { entry, index, manifest: parsed.value };
    });
    const knownStrings = knownStringKeys(states);
    const platformState = states.find(state => state.entry.packId === 'platform');
    const platformManifest = platformState?.manifest ?? null;
    const platformToolsDeclared = platformManifest !== null && isRecord(platformManifest['tools'])
        ? platformManifest['tools'] : null;
    const platformToolNames = new Set(platformToolsDeclared === null ? [] : Object.keys(platformToolsDeclared));
    // A child compares its parameter key set with the platform text; parse the
    // platform entries first (the platform's own problems are reported below).
    const platformToolTexts = platformState === undefined
        ? new Map<string, JsonRecord>()
        : platformToolTextsOf(platformState);

    for (const { entry, index, manifest } of states) {
        const packId = entry.packId;
        if (manifest !== null) {
            if (manifest['schemaVersion'] !== 1) report(packId, null, 'manifest schemaVersion must be 1');
            validateIdentity(report, packId, manifest);
            validateExtends(report, chain, index, packId, manifest);
            validateStrings(report, entry, manifest, packId, knownStrings);
            validateTemplates(report, entry, manifest, packId);
            validateTools(report, entry, manifest, packId, platformToolNames, platformToolTexts);
        }
    }
    if (problems.length > 0) return { status: 'rejected', problems };

    // Every entry is valid: merge from the platform up so the nearest pack wins.
    const templates: Record<string, string> = {};
    const strings: Record<string, string> = {};
    const tools: Record<string, ToolTextV1> = {};
    const origins: Record<string, { packId: string; version: number; mentionsTools: string[] }> = {};
    const toolOrigins: Record<string, string> = {};
    for (let index = chain.length - 1; index >= 0; index -= 1) {
        const { entry, manifest } = states[index]!;
        const typed = manifest as unknown as PromptPackManifestV1;
        for (const [templateId, declared] of Object.entries(typed.templates)) {
            templates[templateId] = entry.templates[templateId]!.text;
            origins[templateId] = {
                packId: entry.packId,
                version: declared.version,
                mentionsTools: [...declared.mentionsTools],
            };
        }
        const table = JSON.parse(entry.strings.text) as Record<string, string>;
        for (const [key, value] of Object.entries(table)) strings[key] = value;
        for (const name of Object.keys(typed.tools)) {
            const parsed = JSON.parse(entry.tools[name]!.text) as ToolTextV1;
            tools[name] = { description: parsed.description, parameters: { ...parsed.parameters } };
            toolOrigins[name] = entry.packId;
        }
    }
    const requested = states[0]!.manifest as unknown as PromptPackManifestV1;
    return {
        status: 'ready',
        value: { manifest: requested, templates, strings, tools, origins, toolOrigins } satisfies ResolvedPromptPackV1,
    };
}

type Report = (packId: string, templateId: string | null, reason: string, toolName?: string) => void;

function validateIdentity(
    report: Report, packId: string, manifest: JsonRecord,
): void {
    const manifestId = manifest['packId'];
    if (!isString(manifestId)) {
        report(packId, null, 'manifest packId must be a string');
        return;
    }
    // Syntax and identity are independent: report both when both are wrong.
    if (!PACK_ID.test(manifestId)) report(packId, null, `pack id "${manifestId}" is not a legal pack id`);
    if (manifestId !== packId)
        report(packId, null, `manifest packId "${manifestId}" does not match pack "${packId}"`);
}

function validateExtends(
    report: Report, chain: readonly PromptPackChainEntryV1[], index: number, packId: string, manifest: JsonRecord,
): void {
    const parent = manifest['extends'];
    if (packId === 'platform') {
        if (parent !== null) report(packId, null, 'the platform pack must not extend another pack');
        return;
    }
    if (!isString(parent) || parent === '') {
        report(packId, null, `pack "${packId}" must extend one parent pack`);
        return;
    }
    if (index === chain.length - 1) return;
    if (!chain.some(entry => entry.packId === parent)) {
        report(packId, null, `pack "${packId}" extends missing pack "${parent}"`);
        return;
    }
    const next = chain[index + 1]!;
    if (next.packId !== parent)
        report(packId, null, `pack "${packId}" extends "${parent}" but the chain continues with "${next.packId}"`);
}

function validateStrings(
    report: Report, entry: PromptPackChainEntryV1, manifest: JsonRecord, packId: string,
    knownStrings: ReadonlySet<string> | null,
): void {
    const file = manifest['strings'];
    if (!isString(file)) {
        report(packId, null, 'manifest strings must name a file');
        return;
    }
    const bad = fileProblems(file);
    if (bad.length > 0) {
        for (const reason of bad) report(packId, null, reason);
        return;
    }
    if (file !== entry.strings.file) {
        report(packId, null, `strings file "${file}" is missing from the pack`);
        return;
    }
    const parsed = jsonObject(entry.strings.text, 'the string table');
    if (parsed.status === 'problem') {
        report(packId, null, parsed.reason);
        return;
    }
    for (const [key, value] of Object.entries(parsed.value)) {
        if (!isString(value)) report(packId, null, `string "${key}" must be a string`);
        if (packId === 'platform') continue;
        if (FIXED_STRINGS.has(key)) report(packId, null, `string "${key}" is fixed`);
        else if (knownStrings !== null && !knownStrings.has(key)) report(packId, null, `string "${key}" is unknown`);
    }
}

function validateTemplates(
    report: Report, entry: PromptPackChainEntryV1, manifest: JsonRecord, packId: string,
): void {
    const templates = manifest['templates'];
    if (!isRecord(templates)) {
        report(packId, null, 'manifest templates must be an object');
        return;
    }
    for (const [templateId, raw] of Object.entries(templates)) {
        // An unknown id skips only the checks that need its slot table: entry
        // shape, version, declarations and the file field stay decidable.
        const known = Object.hasOwn(TEMPLATE_SLOTS, templateId);
        if (!known) report(packId, templateId, `template "${templateId}" is not declared by the slot tables`);
        if (!isRecord(raw)) {
            report(packId, templateId, 'template entry must be an object');
            continue;
        }
        const version = raw['version'];
        if (typeof version !== 'number' || !Number.isInteger(version) || version <= 0)
            report(packId, templateId, 'template version must be a positive integer');
        const mentions = raw['mentionsTools'];
        if (!Array.isArray(mentions) || !mentions.every(isString))
            report(packId, templateId, 'template mentionsTools must be a string array');
        const file = raw['file'];
        if (!isString(file)) {
            report(packId, templateId, 'template file must be a string');
            continue;
        }
        const bad = fileProblems(file);
        if (bad.length > 0) {
            for (const reason of bad) report(packId, templateId, reason);
            continue;
        }
        const supplied = entry.templates[templateId];
        if (supplied === undefined || supplied.file !== file || typeof supplied.text !== 'string') {
            report(packId, templateId, `template file "${file}" is missing from the pack`);
            continue;
        }
        if (!known) continue;
        const parsed = parseTemplateV1(templateId, supplied.text);
        if (parsed.status === 'invalid')
            for (const error of parsed.errors) report(packId, templateId, error.message);
    }
}

function validateTools(
    report: Report, entry: PromptPackChainEntryV1, manifest: JsonRecord, packId: string,
    platformToolNames: ReadonlySet<string>, platformToolTexts: ReadonlyMap<string, JsonRecord>,
): void {
    const declarations = manifest['tools'];
    if (!isRecord(declarations)) {
        report(packId, null, 'manifest tools must be an object');
        return;
    }
    for (const [name, file] of Object.entries(declarations)) {
        // A tool without platform text still gets every check that does not
        // depend on the platform definition: file, JSON, description, parameters.
        if (packId !== 'platform' && !platformToolNames.has(name))
            report(packId, null, `tool ${name} has no platform text`, name);
        if (!isString(file)) {
            report(packId, null, `tool ${name} file must be a string`, name);
            continue;
        }
        const bad = fileProblems(file);
        if (bad.length > 0) {
            for (const reason of bad) report(packId, null, reason, name);
            continue;
        }
        const supplied = entry.tools[name];
        if (supplied === undefined || supplied.file !== file || typeof supplied.text !== 'string') {
            report(packId, null, `tool file "${file}" is missing from the pack`, name);
            continue;
        }
        const parsedTool = jsonObject(supplied.text, `tool "${name}" text`);
        if (parsedTool.status === 'problem') {
            report(packId, null, parsedTool.reason, name);
            continue;
        }
        const tool = parsedTool.value;
        const description = tool['description'];
        if (!isString(description) || description === '')
            report(packId, null, `tool ${name} has an empty description`, name);
        const parameters = tool['parameters'];
        if (!isRecord(parameters)) {
            report(packId, null, `tool ${name} parameters must be an object`, name);
            continue;
        }
        for (const [key, value] of Object.entries(parameters)) {
            if (isString(value)) continue;
            report(packId, null, `tool ${name} parameter "${key}" must be a string`, name);
        }
        if (packId === 'platform') continue;
        const platformParameters = platformToolTexts.get(name);
        if (platformParameters !== undefined && !sameKeys(parameters, platformParameters))
            report(packId, null, `tool ${name} parameters differ`, name);
    }
}

/**
 * The parameter keys of each tool the platform declares. Only `parameters` being
 * an object is required: a bad description or a non-string parameter value is
 * the platform's own problem, not a reason to lose the key set a child compares.
 */
function platformToolTextsOf(state: ChainState): Map<string, JsonRecord> {
    const texts = new Map<string, JsonRecord>();
    const declarations = state.manifest?.['tools'];
    if (!isRecord(declarations)) return texts;
    for (const [name, file] of Object.entries(declarations)) {
        if (!isString(file)) continue;
        const supplied = state.entry.tools[name];
        if (supplied === undefined || supplied.file !== file) continue;
        const parsed = jsonObject(supplied.text, `tool "${name}" text`);
        if (parsed.status !== 'ok') continue;
        const parameters = parsed.value['parameters'];
        if (!isRecord(parameters)) continue;
        texts.set(name, parameters);
    }
    return texts;
}

function sameKeys(left: JsonRecord, right: JsonRecord): boolean {
    const sort = (keys: readonly string[]): string[] => [...keys].sort((a, b) => a.localeCompare(b, 'en'));
    const leftKeys = sort(Object.keys(left));
    const rightKeys = sort(Object.keys(right));
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]);
}
