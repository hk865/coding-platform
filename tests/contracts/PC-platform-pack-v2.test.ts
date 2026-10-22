/**
 * PC-1a step c1 — ruling 11: `base` and the five platform Skills enter the
 * platform pack byte for byte, with version 1, no tool mentions and empty slot
 * tables; ruling 13's `origins` names each template's pack and version.
 *
 * The six digests are pinned literals: this test never reads the old
 * `resources/skills/platform-<role>/content.md`, which PC-1b deletes.
 */
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { ResolvedPromptPackV1 } from '../../src/contracts/prompts/prompt-pack.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { TEMPLATE_SLOTS } from '../../src/contracts/prompts/slot-tables.js';

/** The public export, read through the contract type so arbitrary template ids can be looked up. */
const PACK: ResolvedPromptPackV1 = PLATFORM_PROMPT_PACK_V1;

const NEW_TEMPLATES = {
    'base': '860d951d7f60787371922438b5935842c76ea90aa8a75fdf75d55297727f7cc2',
    'skill-platform-work': '5e1feacc1aed9901b3a5c0fb5870ccb8642b6cb43e3b1ac28f9cb02f2ed4f95f',
    'skill-platform-secretary': 'a8644c9adebb22df4e920fc823ede079fc7caee44d959f84394546b63dffc8ee',
    'skill-platform-adviser': '3e9bf8beaed4064e7c992fefba9729d57a5317a01227976926029915dad3dc85',
    'skill-platform-scribe': 'e2384821311341bfd440a50cd4b68bc818126d3b8d0792f23e9357c619bae043',
    'skill-platform-reviewer': 'a7e4ab9987ab8703399f3f9c7815e85b1b4bb7ced24ad9437d196c169ee63d6f',
} as const;

describe('platform prompt pack v2 (ruling 11)', () => {
    it('carries base and the five platform Skills byte for byte, version 1, no tool mentions, empty slot tables', () => {
        const { manifest, templates } = PACK;
        for (const [id, expectedDigest] of Object.entries(NEW_TEMPLATES)) {
            expect(manifest.templates[id], `manifest entry ${id}`).toEqual({
                file: `templates/${id}.txt`,
                version: 1,
                mentionsTools: [],
            });
            const text = templates[id];
            expect(text, `template text ${id}`).toBeTypeOf('string');
            if (text === undefined) throw new Error(`template ${id} is missing from the pack`);
            expect(text).not.toContain('{{');
            expect(TEMPLATE_SLOTS[id], `slot table ${id}`).toEqual({});
            expect(sha256Hex(text), `sha256 ${id}`).toBe(expectedDigest);
        }
    });

    it('origins gives every template its pack and version (ruling 13)', () => {
        // Every platform template id with its pack and version, hand-written:
        // no key or version is read from the manifest or the generated origins.
        expect(PACK.origins).toEqual({
            'initial-planning-answer': { packId: 'platform', version: 1 },
            'consultation-received-input': { packId: 'platform', version: 1 },
            'user-decision-response': { packId: 'platform', version: 1 },
            'scribe-reminder': { packId: 'platform', version: 1 },
            'continuation-brief': { packId: 'platform', version: 1 },
            'unknown-call-review': { packId: 'platform', version: 1 },
            'unknown-call-proposal': { packId: 'platform', version: 1 },
            'work-input': { packId: 'platform', version: 1 },
            'query-planning-input': { packId: 'platform', version: 1 },
            'query-copy-input': { packId: 'platform', version: 1 },
            base: { packId: 'platform', version: 1 },
            'skill-platform-work': { packId: 'platform', version: 1 },
            'skill-platform-secretary': { packId: 'platform', version: 1 },
            'skill-platform-adviser': { packId: 'platform', version: 1 },
            'skill-platform-scribe': { packId: 'platform', version: 1 },
            'skill-platform-reviewer': { packId: 'platform', version: 1 },
        });
    });
});
