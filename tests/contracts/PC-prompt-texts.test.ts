/**
 * PC-1b P — rulings 14 and 17: the narrow `PromptTextsV1` surface every
 * renderer takes, and the structural body check the entry uses to read a frozen
 * text back. This is a pure contract test: no store, no Host. Every expected
 * value is a hand-written literal or the SHA-256 of one.
 */
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import {
    PROMPT_TEXT_CONTENT_TYPE,
    checkPromptBody,
    type PromptTextsV1,
} from '../../src/contracts/prompts/prompt-set.js';
import { renderTemplate } from '../../src/contracts/prompts/render-template.js';

/** The body under test: three characters, six UTF-8 bytes. */
const BODY = '你好';
/** SHA-256 of `BODY`, written out instead of computed. */
const BODY_DIGEST = '670d9743542cae3ea7ebe36af56bd53648b0a1126162e78d81a32934a711302e';

/** The smallest artifact reference the check accepts: digest and six bytes. */
const artifactRef = (overrides: Partial<ArtifactRef> = {}): ArtifactRef => ({
    kind: 'artifact',
    contentType: PROMPT_TEXT_CONTENT_TYPE,
    digest: BODY_DIGEST,
    sizeBytes: 6,
    source: { kind: 'workspace', refId: 'workspace-1', revision: 'revision-1' },
    ...overrides,
});

const recordRef = (overrides: Partial<ArtifactRef> = {}): { ref: ArtifactRef; body: string } => ({
    ref: artifactRef(overrides),
    body: BODY,
});

describe('checkPromptBody (ruling 17)', () => {
    it('returns the body when the ref, the record ref, the digest, the size and the content type match', () => {
        expect(checkPromptBody(artifactRef(), recordRef(), PROMPT_TEXT_CONTENT_TYPE)).toBe(BODY);
    });

    it('returns null when the body digest differs from the ref digest at the same UTF-8 byte length', () => {
        // `世界` is also three characters / six UTF-8 bytes, so only the digest
        // check can reject it.
        expect(Buffer.byteLength('世界', 'utf8')).toBe(6);
        expect(checkPromptBody(artifactRef(), { ref: artifactRef(), body: '世界' }, PROMPT_TEXT_CONTENT_TYPE))
            .toBeNull();
    });

    it('returns null when the body UTF-8 byte size differs from the ref size', () => {
        // Six bytes pass; the two-character count and five bytes do not.
        expect(checkPromptBody(artifactRef({ sizeBytes: 2 }), recordRef({ sizeBytes: 2 }), PROMPT_TEXT_CONTENT_TYPE))
            .toBeNull();
        expect(checkPromptBody(artifactRef({ sizeBytes: 5 }), recordRef({ sizeBytes: 5 }), PROMPT_TEXT_CONTENT_TYPE))
            .toBeNull();
        // The digest still matches the body: only the length check rejects it.
        expect(checkPromptBody(artifactRef({ sizeBytes: 7 }), recordRef({ sizeBytes: 7 }), PROMPT_TEXT_CONTENT_TYPE))
            .toBeNull();
    });

    it('returns null when the ref content type is not the expected one', () => {
        expect(checkPromptBody(artifactRef(), recordRef(), 'application/json')).toBeNull();
        expect(checkPromptBody(artifactRef({ contentType: 'text/plain' }), recordRef({ contentType: 'text/plain' }), PROMPT_TEXT_CONTENT_TYPE))
            .toBeNull();
    });

    it('returns null when record.ref disagrees on content type, digest or size', () => {
        const disagreeing = [
            recordRef({ contentType: 'text/plain' }),
            recordRef({ digest: 'b'.repeat(64) }),
            recordRef({ sizeBytes: 5 }),
        ];
        for (const record of disagreeing) expect(checkPromptBody(artifactRef(), record, PROMPT_TEXT_CONTENT_TYPE)).toBeNull();
    });

    it('compares only content type, digest and size, not the source', () => {
        const otherSource = recordRef({
            source: { kind: 'workspace', refId: 'workspace-2', revision: 'revision-2' },
        });
        expect(checkPromptBody(artifactRef(), otherSource, PROMPT_TEXT_CONTENT_TYPE)).toBe(BODY);
    });
});

describe('PromptTextsV1 (ruling 14)', () => {
    it('accepts a hand-made templates/strings value and renders a slotless base', () => {
        const texts: PromptTextsV1 = { templates: { base: 'You are a test.' }, strings: {} };
        expect(renderTemplate(texts, 'base', {}, []))
            .toEqual({ text: 'You are a test.', sectionRanges: {} });
    });

    it('renders a hand-made copy of a pack template exactly as the generated pack does', () => {
        // The frozen pack text of `user-decision-response`, copied as a literal.
        const texts: PromptTextsV1 = {
            templates: { 'user-decision-response': '用户答复\n{{bodyJson}}' },
            strings: { 'role.executor.label': 'Executor' },
        };
        const slots = { bodyJson: '{"kind":"yes"}' };
        const handmade = renderTemplate(texts, 'user-decision-response', slots, []);
        expect(handmade.text).toBe('用户答复\n{"kind":"yes"}');
        expect(handmade).toEqual(renderTemplate(PLATFORM_PROMPT_PACK_V1, 'user-decision-response', slots, []));
    });
});
