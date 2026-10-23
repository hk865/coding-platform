/**
 * PC-02, PC-03, PC-22 (load) and PC-25 (resolution) — ruling 4/19's resolver.
 * Every expected problem is a hand-written literal naming the pack, the
 * template (or null) and A's reason; every expected template or tool map is
 * written whole. Chains come from the frozen pack fixture only.
 */
import { describe, expect, it } from 'vitest';
import type {
    PromptPackChainEntryV1, PromptPackManifestV1, PromptPackProblemV1, PromptPackValidationV1,
} from '../../src/contracts/prompts/prompt-pack.js';
import { PromptRenderError, renderTemplate } from '../../src/contracts/prompts/render-template.js';
import { resolvePromptPackV1 } from '../../src/contracts/prompts/resolve-pack.js';
import { PC2_WORK_INPUT, pc2PackCases, pc2PackEntry } from '../helpers/PC2-pack-fixture.js';

const cases = pc2PackCases();

const packProblem = (packId: string, reason: string): PromptPackProblemV1 =>
    ({ packId, templateId: null, reason });
const templateProblem = (packId: string, templateId: string, reason: string): PromptPackProblemV1 =>
    ({ packId, templateId, reason });
const toolProblem = (packId: string, toolName: string, reason: string): PromptPackProblemV1 =>
    ({ packId, templateId: null, toolName, reason });

/** Every broken fixture case, mapped to the complete problem list it must produce. */
const BROKEN: Readonly<Record<string, PromptPackProblemV1[]>> = {
    'schema-version': [packProblem('bad-schema-version', 'manifest schemaVersion must be 1')],
    identity: [packProblem('bad-identity', 'manifest packId "different-id" does not match pack "bad-identity"')],
    'id-syntax': [
        packProblem('bad-id-syntax', 'pack id "BAD_ID" is not a legal pack id'),
        packProblem('bad-id-syntax', 'manifest packId "BAD_ID" does not match pack "bad-id-syntax"'),
    ],
    'null-parent': [packProblem('bad-null-parent', 'pack "bad-null-parent" must extend one parent pack')],
    'missing-parent': [
        packProblem('bad-missing-parent', 'pack "bad-missing-parent" extends missing pack "absent-parent"'),
    ],
    'manifest-json': [packProblem('bad-manifest-json', 'the manifest is not valid JSON')],
    'manifest-object': [packProblem('bad-manifest-object', 'the manifest must be a JSON object')],
    'strings-json': [packProblem('bad-strings-json', 'the string table is not valid JSON')],
    'strings-object': [packProblem('bad-strings-object', 'the string table must be a JSON object')],
    'string-value': [packProblem('bad-string-value', 'string "context.role.label" must be a string')],
    'unknown-string': [packProblem('bad-unknown-string', 'string "pc2.unknown" is unknown')],
    'fixed-heading': [packProblem('bad-fixed-heading', 'string "context.omissions.heading" is fixed')],
    'fixed-prefix': [packProblem('bad-fixed-prefix', 'string "context.omissions.prefix" is fixed')],
    'fixed-suffix': [packProblem('bad-fixed-suffix', 'string "context.omissions.suffix" is fixed')],
    'fixed-nameseparator': [
        packProblem('bad-fixed-nameseparator', 'string "context.omissions.nameSeparator" is fixed'),
    ],
    'unknown-template': [
        templateProblem('bad-unknown-template', 'pc2-unknown', 'template "pc2-unknown" is not declared by the slot tables'),
    ],
    'version-0': [templateProblem('bad-version-0', 'base', 'template version must be a positive integer')],
    'version-minus1': [templateProblem('bad-version-minus1', 'base', 'template version must be a positive integer')],
    'version-1minus5': [
        templateProblem('bad-version-1minus5', 'base', 'template version must be a positive integer'),
    ],
    'mentions-array': [
        templateProblem('bad-mentions-array', 'base', 'template mentionsTools must be a string array'),
    ],
    'mentions-value': [
        templateProblem('bad-mentions-value', 'base', 'template mentionsTools must be a string array'),
    ],
    'template-file-missing': [
        templateProblem('bad-template-file-missing', 'base', 'template file "templates/base.txt" is missing from the pack'),
    ],
    'template-file-parent': [
        templateProblem('bad-template-file-parent', 'base', 'file "../outside.txt" must not contain a ".." segment'),
    ],
    'template-file-absolute': [
        templateProblem('bad-template-file-absolute', 'base', 'file "/outside.txt" must be relative'),
    ],
    'unknown-slot': [
        templateProblem('bad-unknown-slot', 'base', 'slot "pc2_unknown" is not declared by template "base"'),
    ],
    'duplicate-slot': [
        templateProblem('bad-duplicate-slot', 'continuation-brief',
            'template "continuation-brief" uses slot "marker" more than once'),
    ],
    'required-slot-missing': [
        templateProblem('bad-required-slot-missing', 'continuation-brief',
            'template "continuation-brief" is missing required slot "marker"'),
    ],
    'stray-open': [templateProblem('bad-stray-open', 'base', 'template "base" has an unclosed "{{"')],
    'unclosed-block': [
        templateProblem('bad-unclosed-block', 'base', 'template "base" is missing "{{/tool:edit}}"'),
    ],
    'mismatched-block': [
        templateProblem('bad-mismatched-block', 'base',
            'template "base" closes "tool:edit" with "{{/tool:read}}"'),
    ],
    'section-nested': [
        templateProblem('bad-section-nested', 'work-input',
            'section "role" must be a top-level slot in template "work-input"'),
    ],
    'section-missing': [
        templateProblem('bad-section-missing', 'work-input', 'template "work-input" is missing section "notes"'),
    ],
    // The frozen text puts `{{footprint}}` in `query-copy-input`, whose slot
    // table has no footprint: the parser rejects the undeclared slot first.
    'section-extra': [
        templateProblem('bad-section-extra', 'query-copy-input',
            'slot "footprint" is not declared by template "query-copy-input"'),
    ],
    'role-not-first': [
        templateProblem('bad-role-not-first', 'work-input',
            'template "work-input" must start with the role section'),
    ],
    'section-twice': [
        templateProblem('bad-section-twice', 'work-input',
            'template "work-input" uses slot "reminders" more than once'),
    ],
    'tool-shell': [toolProblem('bad-tool-shell', 'shell', 'tool shell has no platform text')],
    'tool-read': [toolProblem('bad-tool-read', 'read', 'tool read has no platform text')],
    'tool-pc2-unknown-tool': [
        toolProblem('bad-tool-pc2-unknown-tool', 'pc2_unknown_tool', 'tool pc2_unknown_tool has no platform text'),
    ],
    'tool-empty': [toolProblem('bad-tool-empty', 'record_note', 'tool record_note has an empty description')],
    'tool-parameters-object': [
        toolProblem('bad-tool-parameters-object', 'list_files', 'tool list_files parameters must be an object'),
    ],
    'tool-parameter-value': [
        toolProblem('bad-tool-parameter-value', 'list_files', 'tool list_files parameter "prefix" must be a string'),
    ],
    'tool-prefix-missing': [
        toolProblem('bad-tool-prefix-missing', 'list_files', 'tool list_files parameters differ'),
    ],
    'tool-prefix-extra': [toolProblem('bad-tool-prefix-extra', 'list_files', 'tool list_files parameters differ')],
    'tool-json': [toolProblem('bad-tool-json', 'record_note', 'tool "record_note" text is not valid JSON')],
    'tool-file-missing': [
        toolProblem('bad-tool-file-missing', 'record_note', 'tool file "tools/record_note.json" is missing from the pack'),
    ],
    'strings-file-missing': [
        packProblem('bad-strings-file-missing', 'strings file "absent.json" is missing from the pack'),
    ],
    'platform-parent': [packProblem('platform', 'the platform pack must not extend another pack')],
    'duplicate-id': [
        packProblem('pc2-parent', 'pack "pc2-parent" appears more than once'),
        packProblem('pc2-parent', 'pack "pc2-parent" extends "platform" but the chain continues with "pc2-parent"'),
    ],
    'no-platform': [packProblem('pc2-parent', 'the pack chain must end at the platform pack')],
    cycle: [packProblem('cycle-b', 'pack "cycle-b" extends "cycle-a" but the chain continues with "platform"')],
};

/** The platform's templates, except `base`, which the child supplies. Whole hand-written texts. */
const PLATFORM_TEMPLATES = {
    base: 'CHILD',
    'work-input': '{{prelude}}\n\n{{role}}{{goal}}{{task}}{{footprint}}{{notes}}{{inputs}}'
        + '{{continuation}}{{unknown_call_review}}{{reminders}}',
    'query-planning-input': '{{prelude}}\n\n{{role}}{{goal}}{{task}}{{footprint}}',
    'query-copy-input': '{{prelude}}\n\n{{role}}{{goal}}{{task}}',
    'initial-planning-answer': 'ANSWER',
    'continuation-brief': '{{marker}}{{body}}{{bodyOmission}}{{anomalies}}{{review}}{{blocked}}{{blockedOmission}}',
    'unknown-call-review': '{{workspaceLines}}\n{{writtenLines}}{{items}}',
    'unknown-call-proposal':
        '{{workspaceLines}}\n{{writtenLines}}{{targets}}{{personNote}}{{annotations}}{{platformTargets}}',
    'consultation-received-input': '{{messageId}}\n{{sourceJson}}',
    'user-decision-response': '{{bodyJson}}',
    'scribe-reminder': '{{marker}}\n{{pendingCount}}\n{{updateDueCount}}{{anchors}}',
    'stale-files-reminder': 'STALE',
    'skill-platform-work': 'WORK',
    'skill-platform-secretary': 'SECRETARY',
    'skill-platform-adviser': 'ADVISER',
    'skill-platform-scribe': 'SCRIBE',
    'skill-platform-reviewer': 'REVIEWER',
} as const;

/** One `origins` row, hand-written: the supplying pack, its version and its declarations. */
const origin = (packId: string, version: number): { packId: string; version: number; mentionsTools: [] } =>
    ({ packId, version, mentionsTools: [] });

/** Every template the platform supplies, with the version the fixture declares (1). */
const PLATFORM_ORIGINS = {
    base: origin('pc2-child', 8),
    'work-input': origin('platform', 1),
    'query-planning-input': origin('platform', 1),
    'query-copy-input': origin('platform', 1),
    'initial-planning-answer': origin('platform', 1),
    'continuation-brief': origin('platform', 1),
    'unknown-call-review': origin('platform', 1),
    'unknown-call-proposal': origin('platform', 1),
    'consultation-received-input': origin('platform', 1),
    'user-decision-response': origin('platform', 1),
    'scribe-reminder': origin('platform', 1),
    'stale-files-reminder': origin('platform', 1),
    'skill-platform-work': origin('platform', 1),
    'skill-platform-secretary': origin('platform', 1),
    'skill-platform-adviser': origin('platform', 1),
    'skill-platform-scribe': origin('platform', 1),
    'skill-platform-reviewer': origin('platform', 1),
} as const;

function rejected(result: PromptPackValidationV1): PromptPackProblemV1[] {
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('expected a rejected result');
    return result.problems;
}

/**
 * Mutates one built entry's manifest text. The frozen fixture's own
 * `editManifest` is private, so this row-local editor is the only copy.
 */
function editManifest(entry: PromptPackChainEntryV1, edit: (manifest: PromptPackManifestV1) => void): void {
    const manifest = JSON.parse(entry.manifest.text) as PromptPackManifestV1;
    edit(manifest);
    entry.manifest.text = JSON.stringify(manifest);
}

/** Runs one render and returns the `PromptRenderError` it must throw. */
function renderFailure(run: () => unknown): PromptRenderError {
    try {
        run();
    } catch (error) {
        expect(error).toBeInstanceOf(PromptRenderError);
        return error as PromptRenderError;
    }
    throw new Error('expected renderTemplate to throw');
}

describe('resolvePromptPackV1 broken packs (PC-02)', () => {
    it('has one expected row for every broken fixture case', () => {
        expect(Object.keys(BROKEN).sort()).toEqual(Object.keys(cases.broken).sort());
    });

    for (const [name, expected] of Object.entries(BROKEN)) {
        it(`rejects ${name} with its literal problems and throws nothing`, () => {
            const chain = cases.broken[name];
            expect(chain, name).toBeDefined();
            expect(() => resolvePromptPackV1(chain!), name).not.toThrow();
            expect(rejected(resolvePromptPackV1(chain!))).toEqual(expected);
        });
    }
});

describe('resolvePromptPackV1 resolution (PC-03)', () => {
    it('keeps the platform templates except the child base and names every supplying pack', () => {
        const result = resolvePromptPackV1(cases.childChain);
        expect(result.status).toBe('ready');
        if (result.status !== 'ready') return;
        expect(result.value.templates).toEqual(PLATFORM_TEMPLATES);
        expect(result.value.origins).toEqual(PLATFORM_ORIGINS);
        expect(result.value.toolOrigins).toEqual({ record_note: 'platform', list_files: 'platform' });
    });
});

describe('resolvePromptPackV1 tool resolution (PC-25)', () => {
    it('takes only record_note from the child and names its origin', () => {
        const result = resolvePromptPackV1(cases.toolChain);
        expect(result.status).toBe('ready');
        if (result.status !== 'ready') return;
        expect(result.value.tools).toEqual({
            record_note: { description: 'Child note.', parameters: {} },
            list_files: { description: 'Platform list.', parameters: { prefix: 'Platform prefix.' } },
        });
        expect(result.value.toolOrigins).toEqual({ record_note: 'pc2-tool-child', list_files: 'platform' });
    });

    it('reports a shell entry, an empty description and a missing and an extra parameter key', () => {
        expect(rejected(resolvePromptPackV1(cases.broken['tool-shell']!))).toEqual([
            toolProblem('bad-tool-shell', 'shell', 'tool shell has no platform text'),
        ]);
        expect(rejected(resolvePromptPackV1(cases.broken['tool-empty']!))).toEqual([
            toolProblem('bad-tool-empty', 'record_note', 'tool record_note has an empty description'),
        ]);
        expect(rejected(resolvePromptPackV1(cases.broken['tool-prefix-missing']!))).toEqual([
            toolProblem('bad-tool-prefix-missing', 'list_files', 'tool list_files parameters differ'),
        ]);
        expect(rejected(resolvePromptPackV1(cases.broken['tool-prefix-extra']!))).toEqual([
            toolProblem('bad-tool-prefix-extra', 'list_files', 'tool list_files parameters differ'),
        ]);
    });
});

describe('resolvePromptPackV1 load checks (PC-22)', () => {
    it('rejects a role that is not first, an illegal section and a section used twice with literal reasons', () => {
        expect(rejected(resolvePromptPackV1(cases.broken['role-not-first']!))).toEqual([
            templateProblem('bad-role-not-first', 'work-input',
                'template "work-input" must start with the role section'),
        ]);
        expect(rejected(resolvePromptPackV1(cases.broken['section-extra']!))).toEqual([
            templateProblem('bad-section-extra', 'query-copy-input',
                'slot "footprint" is not declared by template "query-copy-input"'),
        ]);
        expect(rejected(resolvePromptPackV1(cases.broken['section-twice']!))).toEqual([
            templateProblem('bad-section-twice', 'work-input',
                'template "work-input" uses slot "reminders" more than once'),
        ]);
    });
});

/** Fresh chains over the frozen platform for checks the frozen broken list does not carry. */
const platform = () => structuredClone(cases.platform);

describe('resolvePromptPackV1 missing input checks (PC-02)', () => {
    it('rejects a template file that is not a string', () => {
        const child = pc2PackEntry('bad-template-file-type', { templates: { base: 'BASE' } });
        editManifest(child, m => { Object.assign(m.templates.base!, { file: 3 }); });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            templateProblem('bad-template-file-type', 'base', 'template file must be a string'),
        ]);
    });

    it('rejects a template entry that is not an object', () => {
        const child = pc2PackEntry('bad-template-entry-type', { templates: { base: 'BASE' } });
        editManifest(child, m => { Object.assign(m.templates, { base: 3 }); });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            templateProblem('bad-template-entry-type', 'base', 'template entry must be an object'),
        ]);
    });

    it('rejects a section that is itself a top-level block, unlike a nested slot', () => {
        // The frozen `section-nested` row puts {{role}} inside a tool block. This
        // row makes role a block itself: the `use.block` check is the difference.
        const child = pc2PackEntry('bad-section-block', {
            templates: { 'work-input': PC2_WORK_INPUT.replace('{{role}}', '{{#role}}ROLE{{/role}}') },
        });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            templateProblem('bad-section-block', 'work-input',
                'section "role" must be a top-level slot in template "work-input"'),
        ]);
    });

    it('rejects a tools collection that is not an object', () => {
        const child = pc2PackEntry('bad-tools-collection');
        editManifest(child, m => { Object.assign(m, { tools: 3 }); });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            packProblem('bad-tools-collection', 'manifest tools must be an object'),
        ]);
    });

    it('rejects a tool file field that is not a string', () => {
        const child = pc2PackEntry('bad-tool-file-type', {
            tools: { list_files: { description: 'List.', parameters: { prefix: 'Prefix.' } } },
        });
        editManifest(child, m => { Object.assign(m.tools, { list_files: 3 }); });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            toolProblem('bad-tool-file-type', 'list_files', 'tool list_files file must be a string'),
        ]);
    });

    it('rejects a tool text that parses as a JSON array', () => {
        const child = pc2PackEntry('bad-tool-array', { tools: { list_files: [] } });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            toolProblem('bad-tool-array', 'list_files', 'tool "list_files" text must be a JSON object'),
        ]);
    });

    it('rejects the empty chain', () => {
        expect(rejected(resolvePromptPackV1([]))).toEqual([
            packProblem('', 'the prompt pack chain is empty'),
        ]);
    });

    it('rejects the platform pack in the middle of the chain', () => {
        expect(rejected(resolvePromptPackV1([platform(), structuredClone(cases.parent)]))).toEqual([
            packProblem('platform', 'pack id "platform" is reserved for the last pack'),
            packProblem('pc2-parent', 'the pack chain must end at the platform pack'),
        ]);
    });

    it('reports an illegal pack id and its identity mismatch together', () => {
        const child = pc2PackEntry('child');
        editManifest(child, m => { m.packId = 'BAD!'; });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            packProblem('child', 'pack id "BAD!" is not a legal pack id'),
            packProblem('child', 'manifest packId "BAD!" does not match pack "child"'),
        ]);
    });

    it('reports a path that is both absolute and carries a ".." segment', () => {
        const child = pc2PackEntry('bad-template-file-both', { templates: { base: 'BASE' } });
        editManifest(child, m => { m.templates.base!.file = '/a/../outside.txt'; });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            templateProblem('bad-template-file-both', 'base', 'file "/a/../outside.txt" must be relative'),
            templateProblem('bad-template-file-both', 'base',
                'file "/a/../outside.txt" must not contain a ".." segment'),
        ]);
    });

    it('rejects a manifest pack id that is not a string', () => {
        const child = pc2PackEntry('bad-pack-id-type');
        editManifest(child, m => { Object.assign(m, { packId: 3 }); });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            packProblem('bad-pack-id-type', 'manifest packId must be a string'),
        ]);
    });

    it('rejects an empty extends value', () => {
        const child = pc2PackEntry('bad-extends-empty');
        editManifest(child, m => { Object.assign(m, { extends: '' }); });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            packProblem('bad-extends-empty', 'pack "bad-extends-empty" must extend one parent pack'),
        ]);
    });

    it('rejects an extends value that is not a string', () => {
        const child = pc2PackEntry('bad-extends-type');
        editManifest(child, m => { Object.assign(m, { extends: 3 }); });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            packProblem('bad-extends-type', 'pack "bad-extends-type" must extend one parent pack'),
        ]);
    });

    it('rejects a templates collection that is not an object', () => {
        const child = pc2PackEntry('bad-templates-type');
        editManifest(child, m => { Object.assign(m, { templates: 3 }); });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            packProblem('bad-templates-type', 'manifest templates must be an object'),
        ]);
    });

    it('rejects a supplied template whose file name differs from the manifest', () => {
        const child = pc2PackEntry('bad-template-file-name', { templates: { base: 'BASE' } });
        editManifest(child, m => { m.templates.base!.file = 'templates/other.txt'; });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            templateProblem('bad-template-file-name', 'base',
                'template file "templates/other.txt" is missing from the pack'),
        ]);
    });

    it('rejects an empty template file path', () => {
        const child = pc2PackEntry('bad-template-file-empty', { templates: { base: 'BASE' } });
        editManifest(child, m => { m.templates.base!.file = ''; });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            templateProblem('bad-template-file-empty', 'base', 'file must name a path'),
        ]);
    });

    it('rejects a Windows absolute template file path', () => {
        const child = pc2PackEntry('bad-template-file-windows', { templates: { base: 'BASE' } });
        editManifest(child, m => { m.templates.base!.file = 'C:\\outside.txt'; });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            templateProblem('bad-template-file-windows', 'base', 'file "C:\\outside.txt" must be relative'),
        ]);
    });
});

describe('resolvePromptPackV1 collects independent problems (ruling 4)', () => {
    it('reports both required slots missing from one template', () => {
        const child = pc2PackEntry('bad-required-many', {
            templates: { 'unknown-call-review': 'X' },
        });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            templateProblem('bad-required-many', 'unknown-call-review',
                'template "unknown-call-review" is missing required slot "workspaceLines"'),
            templateProblem('bad-required-many', 'unknown-call-review',
                'template "unknown-call-review" is missing required slot "writtenLines"'),
        ]);
    });

    it('reports a fixed string whose value is not a string as both problems', () => {
        const child = pc2PackEntry('bad-fixed-value', {
            strings: { 'context.omissions.heading': 3 },
        });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            packProblem('bad-fixed-value', 'string "context.omissions.heading" must be a string'),
            packProblem('bad-fixed-value', 'string "context.omissions.heading" is fixed'),
        ]);
    });

    it('reports a non-string parameter and the different key set together', () => {
        const child = pc2PackEntry('bad-parameter-both', {
            tools: { list_files: { description: 'List.', parameters: { other: 3 } } },
        });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            toolProblem('bad-parameter-both', 'list_files', 'tool list_files parameter "other" must be a string'),
            toolProblem('bad-parameter-both', 'list_files', 'tool list_files parameters differ'),
        ]);
    });

    it('reports a slot used twice and the required slots the text still lacks', () => {
        const child = pc2PackEntry('bad-duplicate-and-missing', {
            templates: { 'unknown-call-review': '{{items}}{{items}}' },
        });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            templateProblem('bad-duplicate-and-missing', 'unknown-call-review',
                'template "unknown-call-review" uses slot "items" more than once'),
            templateProblem('bad-duplicate-and-missing', 'unknown-call-review',
                'template "unknown-call-review" is missing required slot "workspaceLines"'),
            templateProblem('bad-duplicate-and-missing', 'unknown-call-review',
                'template "unknown-call-review" is missing required slot "writtenLines"'),
        ]);
    });

    it('reports every undeclared slot of one template', () => {
        const child = pc2PackEntry('bad-two-unknown-slots', { templates: { base: '{{one}}{{two}}' } });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            templateProblem('bad-two-unknown-slots', 'base', 'slot "one" is not declared by template "base"'),
            templateProblem('bad-two-unknown-slots', 'base', 'slot "two" is not declared by template "base"'),
        ]);
    });

    it('reports an unknown template plus its version, declarations and file type', () => {
        const child = pc2PackEntry('bad-unknown-template-fields', { templates: { base: 'BASE' } });
        editManifest(child, m => {
            Object.assign(m.templates, { bad: { file: 3, version: 0, mentionsTools: 3 } });
        });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            templateProblem('bad-unknown-template-fields', 'bad', 'template "bad" is not declared by the slot tables'),
            templateProblem('bad-unknown-template-fields', 'bad', 'template version must be a positive integer'),
            templateProblem('bad-unknown-template-fields', 'bad', 'template mentionsTools must be a string array'),
            templateProblem('bad-unknown-template-fields', 'bad', 'template file must be a string'),
        ]);
    });

    it('reports an unknown tool plus its empty description and non-string parameter', () => {
        const child = pc2PackEntry('bad-unknown-tool-fields', {
            tools: { mystery: { description: '', parameters: { x: 3 } } },
        });
        expect(rejected(resolvePromptPackV1([child, platform()]))).toEqual([
            toolProblem('bad-unknown-tool-fields', 'mystery', 'tool mystery has no platform text'),
            toolProblem('bad-unknown-tool-fields', 'mystery', 'tool mystery has an empty description'),
            toolProblem('bad-unknown-tool-fields', 'mystery', 'tool mystery parameter "x" must be a string'),
        ]);
    });

    it('keeps the platform key set when the platform description is not a string', () => {
        const brokenPlatform = platform();
        brokenPlatform.tools.list_files!.text =
            JSON.stringify({ description: 3, parameters: { prefix: 'P' } });
        const child = pc2PackEntry('bad-platform-description', {
            tools: { list_files: { description: 'C', parameters: { other: 'O' } } },
        });
        expect(rejected(resolvePromptPackV1([child, brokenPlatform]))).toEqual([
            toolProblem('bad-platform-description', 'list_files', 'tool list_files parameters differ'),
            toolProblem('platform', 'list_files', 'tool list_files has an empty description'),
        ]);
    });

    it('keeps the platform key set when a platform parameter value is not a string', () => {
        const brokenPlatform = platform();
        brokenPlatform.tools.list_files!.text =
            JSON.stringify({ description: 'P', parameters: { prefix: 3 } });
        const child = pc2PackEntry('bad-platform-parameter', {
            tools: { list_files: { description: 'C', parameters: { other: 'O' } } },
        });
        expect(rejected(resolvePromptPackV1([child, brokenPlatform]))).toEqual([
            toolProblem('bad-platform-parameter', 'list_files', 'tool list_files parameters differ'),
            toolProblem('platform', 'list_files', 'tool list_files parameter "prefix" must be a string'),
        ]);
    });
});

describe('resolvePromptPackV1 accepted inputs (ruling 4)', () => {
    it('keeps a pure-whitespace description', () => {
        const child = pc2PackEntry('pc2-whitespace', {
            tools: { record_note: { description: ' ', parameters: {} } },
        });
        const result = resolvePromptPackV1([child, platform()]);
        expect(result.status).toBe('ready');
        if (result.status !== 'ready') return;
        expect(result.value.tools['record_note']).toEqual({ description: ' ', parameters: {} });
        expect(result.value.toolOrigins['record_note']).toBe('pc2-whitespace');
    });

    it('returns the requested pack own manifest whole', () => {
        const result = resolvePromptPackV1(cases.childChain);
        expect(result.status).toBe('ready');
        if (result.status !== 'ready') return;
        expect(result.value.manifest).toEqual({
            schemaVersion: 1,
            packId: 'pc2-child',
            extends: 'pc2-parent',
            templates: { base: { file: 'templates/base.txt', version: 8, mentionsTools: [] } },
            strings: 'strings.json',
            tools: {},
        });
    });

    it('merges strings child over parent and keeps every uncovered key', () => {
        const parent = pc2PackEntry('pc2-string-parent', {
            strings: { 'context.role.label': 'PARENT ROLE', 'k3.none': 'PARENT NONE' },
        });
        const child = pc2PackEntry('pc2-string-child', {
            parent: 'pc2-string-parent', strings: { 'k3.none': 'CHILD NONE' },
        });
        const result = resolvePromptPackV1([child, parent, platform()]);
        expect(result.status).toBe('ready');
        if (result.status !== 'ready') return;
        expect(result.value.strings).toEqual({
            'context.role.label': 'PARENT ROLE',
            'k3.none': 'CHILD NONE',
            'context.omissions.heading': 'OMITTED',
            'context.omissions.prefix': 'PREFIX',
            'context.omissions.suffix': 'SUFFIX',
            'context.omissions.nameSeparator': ':',
        });
    });

    it('takes the whole list_files entry and its non-empty parameters from the child', () => {
        const child = pc2PackEntry('pc2-tool-whole', {
            tools: { list_files: { description: 'Child list.', parameters: { prefix: 'Child prefix.' } } },
        });
        const result = resolvePromptPackV1([child, platform()]);
        expect(result.status).toBe('ready');
        if (result.status !== 'ready') return;
        expect(result.value.tools).toEqual({
            record_note: { description: 'Platform note.', parameters: {} },
            list_files: { description: 'Child list.', parameters: { prefix: 'Child prefix.' } },
        });
        expect(result.value.toolOrigins).toEqual({ record_note: 'platform', list_files: 'pc2-tool-whole' });
    });

    it('names a parent-supplied template by its pack, version and declarations', () => {
        const parent = pc2PackEntry('pc2-origin-parent', {
            templates: {
                'initial-planning-answer': {
                    text: 'PARENT ANSWER', version: 7, mentionsTools: ['read', 'edit'],
                },
            },
        });
        const child = pc2PackEntry('pc2-origin-child', {
            parent: 'pc2-origin-parent', templates: { base: { text: 'CHILD', version: 8 } },
        });
        const result = resolvePromptPackV1([child, parent, platform()]);
        expect(result.status).toBe('ready');
        if (result.status !== 'ready') return;
        expect(result.value.origins['initial-planning-answer']).toEqual({
            packId: 'pc2-origin-parent', version: 7, mentionsTools: ['read', 'edit'],
        });
        expect(result.value.origins['base']).toEqual({
            packId: 'pc2-origin-child', version: 8, mentionsTools: [],
        });
    });
});

describe('renderTemplate PromptRenderError contract (ruling 4)', () => {
    it('throws template_invalid with the first collected problem', () => {
        const error = renderFailure(() => renderTemplate(
            { templates: { 'unknown-call-review': 'X' }, strings: {} }, 'unknown-call-review', {}, [],
        ));
        expect(error.code).toBe('template_invalid');
        expect(error.templateId).toBe('unknown-call-review');
        expect(error.slot).toBe('workspaceLines');
        expect(error.message)
            .toBe('template "unknown-call-review" is missing required slot "workspaceLines"');
    });

    it('throws required_slot_empty for a missing required value', () => {
        const error = renderFailure(() => renderTemplate(
            { templates: { 'continuation-brief': '{{marker}}' }, strings: {} }, 'continuation-brief', {}, [],
        ));
        expect(error.code).toBe('required_slot_empty');
        expect(error.templateId).toBe('continuation-brief');
        expect(error.slot).toBe('marker');
        expect(error.message).toBe('required slot "marker" is empty in template "continuation-brief"');
    });

    it('throws illegal_section_order with the role slot', () => {
        const error = renderFailure(() => renderTemplate(
            { templates: { 'work-input': PC2_WORK_INPUT.replace('{{role}}{{goal}}', '{{goal}}{{role}}') }, strings: {} },
            'work-input', { role: 'R', goal: 'G' }, [],
        ));
        expect(error.code).toBe('illegal_section_order');
        expect(error.templateId).toBe('work-input');
        expect(error.slot).toBe('role');
        expect(error.message).toBe('template "work-input" must start with the role section');
    });
});
