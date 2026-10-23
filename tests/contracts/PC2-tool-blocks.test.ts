/**
 * PC-01 — ruling 4's tool blocks: `renderTemplate` renders a `{{#tool:name}}`
 * block only when the final Kernel tool list names the tool, and a marker alone
 * on its line takes the indentation and the newline with it. Expected texts are
 * whole hand-written strings; the template text comes from the frozen pack
 * fixture, never from a renderer.
 */
import { describe, expect, it } from 'vitest';
import { renderTemplate } from '../../src/contracts/prompts/render-template.js';
import { pc2PackCases } from '../helpers/PC2-pack-fixture.js';

const { platform } = pc2PackCases();
/** The platform `base` in the frozen fixture: `BASE\n`, the edit block, `END\n`. */
const TEXTS = { templates: { base: platform.templates.base!.text }, strings: {} };

describe('renderTemplate tool blocks (PC-01)', () => {
    it('renders the edit block when the final tool list names edit', () => {
        expect(renderTemplate(TEXTS, 'base', {}, ['read', 'edit', 'shell'])).toEqual({
            text: 'BASE\nEDIT\nEND\n',
            sectionRanges: {},
        });
    });

    it('drops the edit block, its alone-line markers and their newlines when the list omits edit', () => {
        expect(renderTemplate(TEXTS, 'base', {}, ['read', 'shell'])).toEqual({
            text: 'BASE\nEND\n',
            sectionRanges: {},
        });
    });
});
