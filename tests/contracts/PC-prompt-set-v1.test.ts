/**
 * PC-1a / PC-2 — ruling 13: the frozen `PromptSetV1` shape, its strict decoder
 * and the one selection reader. Rulings 16 and 19 add the required `toolNames`
 * (the Kernel's order, never sorted) and `tools` (sorted by name). Expected
 * values are hand-written literals from spec §2 and rulings 13, 16 and 19;
 * nothing here reaches a store or a Host.
 */
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import {
    PROMPT_TEXT_CONTENT_TYPE,
    PROMPT_TOOL_SPECS_CONTENT_TYPE,
    canonicalToolTextBody,
    decodePromptSetV1,
    promptSelectionOf,
    promptToolTextDigest,
} from '../../src/contracts/prompts/prompt-set.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);
/** sha256 of each canonical tool body, hand-computed with parameters sorted by `localeCompare(…, 'en')`:
 *  edit `{"description":"Edit a file.","parameters":{"offset":"First line.","path":"File path."}}`,
 *  read `{"description":"Read a file.","parameters":{}}` and shell
 *  `{"description":"Run a command.","parameters":{}}`. The decoder checks the digest's shape only. */
const TOOL_DIGEST_EDIT = '4616a93e2dc7479226a0275ccedde548a99e1caa8a618a2054eb55e343747136';
const TOOL_DIGEST_READ = 'b6d6a45b98d8d6ed51ec23c52a5981eca555fa33a5b5d1a35f999ce8175a95cc';
const TOOL_DIGEST_SHELL = 'ac7c29e1cbc3e69f6b211c69ab92dbb713d86087322764a2ec4c7ec5f700be8c';

/** The smallest valid artifact reference: the decoder checks its own fields only. */
const artifactRef = (digest: string) => ({
    kind: 'artifact' as const,
    contentType: PROMPT_TEXT_CONTENT_TYPE,
    digest,
    sizeBytes: 3,
    source: { kind: 'workspace' as const, refId: 'workspace-1', revision: 'revision-1' },
});

/** One fully populated set: every field is present and every nested shape is valid. */
const VALID = {
    schemaVersion: 1 as const,
    modelId: 'runtime-0123456789abcdef',
    provider: 'deepseek',
    model: 'deepseek-chat',
    packId: 'platform',
    reasoningReplay: 'current_run' as const,
    sectionOrder: {
        work: ['role', 'goal', 'task'] as const,
        review: ['role', 'goal', 'task', 'unknown_call_review'] as const,
    },
    templates: [{ id: 'base', version: 1, packId: 'platform', digest: DIGEST_A, ref: artifactRef(DIGEST_A) }],
    strings: { digest: DIGEST_B, ref: artifactRef(DIGEST_B) },
    base: { templateId: 'base', version: 1, digest: DIGEST_A, ref: artifactRef(DIGEST_A) },
    skills: [{
        schemaVersion: 1 as const,
        id: 'platform-work',
        title: 'Platform work',
        kind: 'instruction' as const,
        priority: 90,
        source: `skill:platform-work@sha256:${DIGEST_C}`,
        digest: DIGEST_C,
        ref: artifactRef(DIGEST_C),
    }],
    /** Ruling 16's final order is the Kernel's, never sorted; read, edit, shell is not sorted. */
    toolNames: ['read', 'edit', 'shell'],
    /** Ruling 19: sorted by name with `localeCompare(…, 'en')`; edit, read, shell. */
    tools: [
        { name: 'edit', packId: 'platform', digest: TOOL_DIGEST_EDIT, ref: artifactRef(TOOL_DIGEST_EDIT) },
        { name: 'read', packId: 'platform', digest: TOOL_DIGEST_READ, ref: artifactRef(TOOL_DIGEST_READ) },
        { name: 'shell', packId: 'platform', digest: TOOL_DIGEST_SHELL, ref: artifactRef(TOOL_DIGEST_SHELL) },
    ],
};

/**
 * Field-by-field rejection rows for the strict decoder: every required field
 * missing and wrong-typed, unknown keys at each level, illegal enum and digest
 * values, and each of the four `ArtifactRef` sites with every field and its
 * `source` mutated. Every row's expected result is the hand-written `null`;
 * nothing here is derived from the decoder.
 */
function rejectionTable(): Array<{ name: string; value: unknown }> {
    const rows: Array<{ name: string; value: unknown }> = [];
    const add = (name: string, value: unknown): void => { rows.push({ name, value }); };
    const clone = (): Record<string, unknown> => structuredClone(VALID) as unknown as Record<string, unknown>;
    const record = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;
    const element = (value: unknown, index: number): Record<string, unknown> => record((value as unknown[])[index]);
    const mutate = (name: string, edit: (copy: Record<string, unknown>) => void): void => {
        const copy = clone();
        edit(copy);
        add(name, copy);
    };
    const template = (copy: Record<string, unknown>): Record<string, unknown> => element(copy['templates'], 0);
    const strings = (copy: Record<string, unknown>): Record<string, unknown> => record(copy['strings']);
    const base = (copy: Record<string, unknown>): Record<string, unknown> => record(copy['base']);
    const skill = (copy: Record<string, unknown>): Record<string, unknown> => element(copy['skills'], 0);
    const tool = (copy: Record<string, unknown>, index = 0): Record<string, unknown> =>
        element(copy['tools'], index);

    // Top level: every field missing and wrong-typed, plus an unknown key.
    const TOP_LEVEL_WRONG: Array<[string, unknown]> = [
        ['schemaVersion', 2], ['modelId', 42], ['provider', 42], ['model', 42], ['packId', 42],
        ['reasoningReplay', 'all'], ['sectionOrder', []], ['templates', {}], ['strings', []],
        ['base', []], ['skills', {}], ['toolNames', {}], ['tools', {}],
    ];
    for (const [field, wrong] of TOP_LEVEL_WRONG) {
        mutate(`top level: ${field} missing`, copy => { delete copy[field]; });
        mutate(`top level: ${field} wrong type`, copy => { copy[field] = wrong; });
    }
    mutate('top level: unknown key', copy => { copy['unknown'] = true; });

    // templates[]: every field missing and wrong-typed, plus an unknown key.
    const TEMPLATE_WRONG: Array<[string, unknown]> = [
        ['id', 42], ['version', '1'], ['packId', 42], ['digest', 42], ['ref', 'not-a-ref'],
    ];
    for (const [field, wrong] of TEMPLATE_WRONG) {
        mutate(`templates[]: ${field} missing`, copy => { delete template(copy)[field]; });
        mutate(`templates[]: ${field} wrong type`, copy => { template(copy)[field] = wrong; });
    }
    mutate('templates[]: unknown key', copy => { template(copy)['unknown'] = 1; });
    mutate('templates: non-object entry', copy => { copy['templates'] = [42]; });

    // strings: both fields missing and wrong-typed, plus an unknown key.
    const STRINGS_WRONG: Array<[string, unknown]> = [['digest', 42], ['ref', 'not-a-ref']];
    for (const [field, wrong] of STRINGS_WRONG) {
        mutate(`strings: ${field} missing`, copy => { delete strings(copy)[field]; });
        mutate(`strings: ${field} wrong type`, copy => { strings(copy)[field] = wrong; });
    }
    mutate('strings: unknown key', copy => { strings(copy)['unknown'] = 1; });

    // base: every field missing and wrong-typed, plus an unknown key.
    const BASE_WRONG: Array<[string, unknown]> = [
        ['templateId', 42], ['version', '1'], ['digest', 42], ['ref', 'not-a-ref'],
    ];
    for (const [field, wrong] of BASE_WRONG) {
        mutate(`base: ${field} missing`, copy => { delete base(copy)[field]; });
        mutate(`base: ${field} wrong type`, copy => { base(copy)[field] = wrong; });
    }
    mutate('base: unknown key', copy => { base(copy)['unknown'] = 1; });

    // skills[]: every field missing and wrong-typed, illegal enums, unknown key.
    const SKILL_WRONG: Array<[string, unknown]> = [
        ['schemaVersion', 2], ['id', 42], ['title', 42], ['kind', 'other'], ['priority', '90'],
        ['source', 42], ['digest', 42], ['ref', 'not-a-ref'],
    ];
    for (const [field, wrong] of SKILL_WRONG) {
        mutate(`skills[]: ${field} missing`, copy => { delete skill(copy)[field]; });
        mutate(`skills[]: ${field} wrong type`, copy => { skill(copy)[field] = wrong; });
    }
    mutate('skills[]: unknown key', copy => { skill(copy)['unknown'] = 1; });
    mutate('skills: non-object entry', copy => { copy['skills'] = [42]; });

    // toolNames: ruling 16's order is the Kernel's, never sorted; unique non-empty strings.
    mutate('toolNames: empty element', copy => { copy['toolNames'] = ['read', '', 'edit']; });
    mutate('toolNames: duplicate element', copy => { copy['toolNames'] = ['read', 'read']; });
    mutate('toolNames: non-string element', copy => { copy['toolNames'] = ['read', 42]; });
    mutate('toolNames: string instead of list', copy => { copy['toolNames'] = 'read'; });

    // tools[]: ruling 19's strictly sorted whole entries with a digest and a ref.
    const TOOL_WRONG: Array<[string, unknown]> = [
        ['name', 42], ['packId', 42], ['digest', 42], ['ref', 'not-a-ref'],
    ];
    for (const [field, wrong] of TOOL_WRONG) {
        mutate(`tools[]: ${field} missing`, copy => { delete tool(copy)[field]; });
        mutate(`tools[]: ${field} wrong type`, copy => { tool(copy)[field] = wrong; });
    }
    mutate('tools[]: unknown key', copy => { tool(copy)['unknown'] = 1; });
    mutate('tools[]: empty name', copy => { tool(copy)['name'] = ''; });
    mutate('tools[]: empty packId', copy => { tool(copy)['packId'] = ''; });
    mutate('tools: non-object entry', copy => { copy['tools'] = [42]; });
    mutate('tools: duplicate name', copy => { tool(copy, 1)['name'] = 'edit'; });
    mutate('tools: unsorted names', copy => {
        const list = copy['tools'] as Record<string, unknown>[];
        [list[0]!['name'], list[1]!['name']] = [list[1]!['name'], list[0]!['name']];
    });
    // `localeCompare(…, 'en')` puts 'apple' before 'Zebra' (case first); a
    // code-unit comparison puts 'Zebra' first, so this order must be rejected.
    mutate('tools: sorted by code unit, not localeCompare', copy => {
        copy['tools'] = [
            { name: 'Zebra', packId: 'platform', digest: DIGEST_A, ref: artifactRef(DIGEST_A) },
            { name: 'apple', packId: 'platform', digest: DIGEST_B, ref: artifactRef(DIGEST_B) },
        ];
    });

    // sectionOrder: illegal call kind, section name and element shapes.
    mutate('sectionOrder: unknown call kind', copy => { record(copy['sectionOrder'])['not-a-call'] = ['role']; });
    mutate('sectionOrder: unknown section name', copy => { record(copy['sectionOrder'])['work'] = ['not-a-section']; });
    mutate('sectionOrder: sections not an array', copy => { record(copy['sectionOrder'])['work'] = 'role'; });
    mutate('sectionOrder: non-string section', copy => { record(copy['sectionOrder'])['work'] = [42]; });

    // Every ArtifactRef site: every field and its source missing, wrong-typed
    // or carrying an unknown key, plus illegal digest variants.
    const REF_SITES: Array<[string, (copy: Record<string, unknown>) => Record<string, unknown>]> = [
        ['templates[].ref', copy => record(template(copy)['ref'])],
        ['strings.ref', copy => record(strings(copy)['ref'])],
        ['base.ref', copy => record(base(copy)['ref'])],
        ['skills[].ref', copy => record(skill(copy)['ref'])],
        ['tools[].ref', copy => record(tool(copy)['ref'])],
    ];
    const REF_WRONG: Array<[string, unknown]> = [
        ['kind', 'blob'], ['contentType', 42], ['digest', 42], ['sizeBytes', '3'], ['source', 'workspace'],
    ];
    const SOURCE_WRONG: Array<[string, unknown]> = [['kind', 'not-a-source'], ['refId', 42], ['revision', 42]];
    const BAD_DIGESTS: Array<[string, string]> = [
        ['uppercase hex', 'A'.repeat(64)],
        ['63 characters', 'a'.repeat(63)],
        ['non-hex character', `${'a'.repeat(63)}g`],
    ];
    for (const [label, refAt] of REF_SITES) {
        for (const [field, wrong] of REF_WRONG) {
            mutate(`${label}: ${field} missing`, copy => { delete refAt(copy)[field]; });
            mutate(`${label}: ${field} wrong type`, copy => { refAt(copy)[field] = wrong; });
        }
        mutate(`${label}: unknown key`, copy => { refAt(copy)['unknown'] = 1; });
        for (const [field, wrong] of SOURCE_WRONG) {
            mutate(`${label}: source.${field} missing`, copy => { delete record(refAt(copy)['source'])[field]; });
            mutate(`${label}: source.${field} wrong type`, copy => { record(refAt(copy)['source'])[field] = wrong; });
        }
        mutate(`${label}: source unknown key`, copy => { record(refAt(copy)['source'])['unknown'] = 1; });
        mutate(`${label}: source.digest wrong type`, copy => { record(refAt(copy)['source'])['digest'] = 42; });
        for (const [why, digest] of BAD_DIGESTS)
            mutate(`${label}: digest ${why}`, copy => { refAt(copy)['digest'] = digest; });
    }

    // The set-level digest fields accept only lowercase 64-character hex.
    const DIGEST_SITES: Array<[string, (copy: Record<string, unknown>) => Record<string, unknown>]> = [
        ['templates[].digest', template],
        ['strings.digest', strings],
        ['base.digest', base],
        ['skills[].digest', skill],
        ['tools[].digest', copy => tool(copy)],
    ];
    for (const [label, digestAt] of DIGEST_SITES)
        for (const [why, digest] of BAD_DIGESTS)
            mutate(`${label}: ${why}`, copy => { digestAt(copy)['digest'] = digest; });

    return rows;
}

describe('PromptSetV1 decode (ruling 13)', () => {
    it('accepts a complete set and returns the same value', () => {
        const input = structuredClone(VALID);
        const decoded = decodePromptSetV1(input);
        expect(decoded).toEqual(VALID);
        // Independent literals: a decoder that sorts the passed array in place
        // would change both the returned list and the caller's own object.
        expect(decoded!.toolNames).toEqual(['read', 'edit', 'shell']);
        expect(input.toolNames).toEqual(['read', 'edit', 'shell']);
    });

    it('accepts an empty section order but rejects a set without it', () => {
        expect(decodePromptSetV1({ ...VALID, sectionOrder: {} })).not.toBeNull();
        const { sectionOrder: _omitted, ...missing } = VALID;
        expect(decodePromptSetV1(missing)).toBeNull();
    });

    it('rejects an unknown top-level field', () => {
        expect(decodePromptSetV1({ ...VALID, unexpected: true })).toBeNull();
    });

    it('rejects a missing top-level field', () => {
        const { base: _base, ...missing } = VALID;
        expect(decodePromptSetV1(missing)).toBeNull();
    });

    it('rejects the wrong schemaVersion', () => {
        expect(decodePromptSetV1({ ...VALID, schemaVersion: 2 })).toBeNull();
    });

    it('rejects an unknown reasoningReplay value', () => {
        expect(decodePromptSetV1({ ...VALID, reasoningReplay: 'all' })).toBeNull();
    });

    it('rejects a Skill entry missing any required field', () => {
        for (const field of ['schemaVersion', 'id', 'title', 'kind', 'priority', 'source', 'digest', 'ref'] as const) {
            const skill = { ...VALID.skills[0] } as Record<string, unknown>;
            delete skill[field];
            expect(decodePromptSetV1({ ...VALID, skills: [skill] }), `missing ${field}`).toBeNull();
        }
    });

    it('rejects a Skill entry with the wrong schemaVersion or kind', () => {
        expect(decodePromptSetV1({
            ...VALID,
            skills: [{ ...VALID.skills[0], schemaVersion: 2 }],
        })).toBeNull();
        expect(decodePromptSetV1({
            ...VALID,
            skills: [{ ...VALID.skills[0], kind: 'other' }],
        })).toBeNull();
    });

    it('rejects an unknown template field and an unknown section name', () => {
        expect(decodePromptSetV1({
            ...VALID,
            templates: [{ ...VALID.templates[0], extra: 1 }],
        })).toBeNull();
        expect(decodePromptSetV1({ ...VALID, sectionOrder: { work: ['role', 'not-a-section'] } })).toBeNull();
    });

    it('rejects a malformed artifact reference', () => {
        expect(decodePromptSetV1({
            ...VALID,
            strings: { ...VALID.strings, ref: { ...artifactRef(DIGEST_B), digest: 'not-a-digest' } },
        })).toBeNull();
    });

    it('rejects every malformed field of the set, tools, toolNames, templates, strings, base, Skills and every ArtifactRef source', () => {
        for (const row of rejectionTable()) expect(decodePromptSetV1(row.value), row.name).toBeNull();
    });

    it('rejects a non-object value', () => {
        for (const value of [null, 1, 'set', [], undefined]) expect(decodePromptSetV1(value)).toBeNull();
    });
});

describe('sha256Hex (ruling 13)', () => {
    it('is the lowercase hex SHA-256 of the UTF-8 bytes', () => {
        expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
        expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        expect(sha256Hex('The quick brown fox jumps over the lazy dog'))
            .toBe('d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');
        expect(sha256Hex('你好')).toBe('670d9743542cae3ea7ebe36af56bd53648b0a1126162e78d81a32934a711302e');
    });
});

describe('promptSelectionOf (ruling 13)', () => {
    it('reads the present selection: model id, pack and replay policy', () => {
        expect(promptSelectionOf({
            configuration: { revision: 'revision-fallback' },
            selection: { modelId: 'settings-item-1', promptPack: 'mine', reasoningReplay: 'none' },
        })).toEqual({ modelId: 'settings-item-1', promptPack: 'mine', reasoningReplay: 'none' });
    });

    it('falls back to the revision, the platform pack and the current run', () => {
        expect(promptSelectionOf({ configuration: { revision: 'revision-fallback' } }))
            .toEqual({ modelId: 'revision-fallback', promptPack: 'platform', reasoningReplay: 'current_run' });
    });
});

describe('canonicalToolTextBody (ruling 19)', () => {
    it('sorts parameter keys by the English order and digests the exact body', () => {
        // Inserted Zebra first. `localeCompare(…, 'en')` puts apple first; a
        // code-unit sort would put Zebra first, so both orders differ.
        const entry = {
            description: 'List files.',
            parameters: { Zebra: 'Animal.', apple: 'Fruit.' },
        };
        const body = '{"description":"List files.","parameters":{"apple":"Fruit.","Zebra":"Animal."}}';
        expect(canonicalToolTextBody(entry)).toBe(body);
        // sha256 of the literal body above, computed outside the production code.
        expect(promptToolTextDigest(entry)).toBe('4c6f8b40431a75c9581888fb0359022e42aacf3f7a5a3d8487cb5d234eeb14fa');
    });
});

describe('prompt content types (ruling 13)', () => {
    it('names the text and tool-spec media types exactly', () => {
        expect(PROMPT_TEXT_CONTENT_TYPE).toBe('application/vnd.coding-platform.prompt-text;version=1');
        expect(PROMPT_TOOL_SPECS_CONTENT_TYPE).toBe('application/vnd.coding-platform.prompt-tool-specs+json;version=1');
    });
});
