import type { ResolvedPromptPackV1 } from './prompt-pack.js';
import { TEMPLATE_SLOTS } from './slot-tables.js';

/** A rendered slot's UTF-8 byte span in `text`; `endByte` is exclusive. */
export type SlotRangeV1 = { startByte: number; endByte: number };

type TemplateNode =
    | { readonly kind: 'text'; readonly text: string }
    | { readonly kind: 'slot'; readonly name: string }
    | { readonly kind: 'block'; readonly name: string; readonly children: readonly TemplateNode[] }
    | { readonly kind: 'tool'; readonly name: string; readonly children: readonly TemplateNode[] };

type Closing = { readonly kind: 'slot' | 'tool'; readonly name: string };

type RenderState = {
    readonly parts: string[];
    bytes: number;
    readonly ranges: Record<string, SlotRangeV1>;
};

/**
 * Removes the layout around a block marker that is alone on its line.
 *
 * The marker itself stays so the parser can still see the block; only the
 * indentation before it and the horizontal whitespace plus the newline after
 * it are dropped. A marker shared with other text is not alone and removes
 * nothing. This keeps a present and an absent block from differing by a blank
 * line, at both `\n` and `\r\n` line endings and at end of file.
 */
function stripAloneBlockMarkerLines(source: string, templateId: string): string {
    const cuts: Array<[number, number]> = [];
    let index = 0;
    while (index < source.length) {
        const open = source.indexOf('{{', index);
        if (open === -1) break;
        const close = source.indexOf('}}', open + 2);
        if (close === -1) throw new Error(`template "${templateId}" has an unclosed "{{"`);
        const marker = source.slice(open + 2, close);
        index = close + 2;
        if (!marker.startsWith('#') && !marker.startsWith('/')) continue;
        const lineStart = source.lastIndexOf('\n', open - 1) + 1;
        const indent = source.slice(lineStart, open);
        if (!/^[ \t]*$/.test(indent)) continue;
        let trailing = index;
        while (trailing < source.length && (source[trailing] === ' ' || source[trailing] === '\t')) trailing += 1;
        let lineEnd: number;
        if (source.startsWith('\r\n', trailing)) lineEnd = trailing + 2;
        else if (source[trailing] === '\n') lineEnd = trailing + 1;
        else if (trailing === source.length) lineEnd = trailing;
        else continue;
        if (lineStart < open) cuts.push([lineStart, open]);
        if (index < lineEnd) cuts.push([index, lineEnd]);
    }
    if (cuts.length === 0) return source;
    let stripped = '';
    let cursor = 0;
    for (const [start, end] of cuts) {
        stripped += source.slice(cursor, start);
        cursor = end;
    }
    return stripped + source.slice(cursor);
}

function registerSlot(
    table: Readonly<Record<string, { required: boolean }>>,
    templateId: string,
    name: string,
    counts: Map<string, number>,
): void {
    // A template may only use slots the code-owned table declares. The table is
    // the contract the pack editor validates against, so anything else is a bug.
    if (!Object.hasOwn(table, name)) throw new Error(`slot "${name}" is not declared by template "${templateId}"`);
    // One slot may appear once: two occurrences would make section ranges and
    // presence ambiguous, and no platform template needs it.
    const count = (counts.get(name) ?? 0) + 1;
    if (count > 1) throw new Error(`template "${templateId}" uses slot "${name}" more than once`);
    counts.set(name, count);
}

/**
 * Parses the three P1 constructs only: `{{slot}}`, `{{#slot}}…{{/slot}}` and
 * `{{#tool:name}}…{{/tool:name}}`. There are no expressions, loops, escapes or
 * references to other templates, so any other `{{` is malformed. Blocks may
 * nest; nothing else is inferred from the text.
 */
function parseSequence(
    source: string,
    start: number,
    expectedClose: Closing | null,
    templateId: string,
    table: Readonly<Record<string, { required: boolean }>>,
    counts: Map<string, number>,
): { nodes: TemplateNode[]; next: number } {
    const nodes: TemplateNode[] = [];
    let index = start;
    let textStart = start;
    while (index < source.length) {
        const open = source.indexOf('{{', index);
        if (open === -1) break;
        if (open > textStart) nodes.push({ kind: 'text', text: source.slice(textStart, open) });
        const close = source.indexOf('}}', open + 2);
        if (close === -1) throw new Error(`template "${templateId}" has an unclosed "{{"`);
        const marker = source.slice(open + 2, close);
        index = close + 2;
        if (marker.startsWith('/')) {
            if (expectedClose === null) throw new Error(`template "${templateId}" has an unexpected "{{${marker}}}"`);
            const expected = expectedClose.kind === 'tool' ? `tool:${expectedClose.name}` : expectedClose.name;
            if (marker.slice(1) !== expected)
                throw new Error(`template "${templateId}" closes "${expected}" with "{{${marker}}}"`);
            return { nodes, next: index };
        }
        if (marker.startsWith('#')) {
            const name = marker.slice(1);
            if (name.startsWith('tool:')) {
                const toolName = name.slice('tool:'.length);
                if (toolName === '') throw new Error(`template "${templateId}" has a tool block without a tool name`);
                const child = parseSequence(source, index, { kind: 'tool', name: toolName }, templateId, table, counts);
                nodes.push({ kind: 'tool', name: toolName, children: child.nodes });
                index = child.next;
            } else {
                registerSlot(table, templateId, name, counts);
                const child = parseSequence(source, index, { kind: 'slot', name }, templateId, table, counts);
                nodes.push({ kind: 'block', name, children: child.nodes });
                index = child.next;
            }
            textStart = index;
            continue;
        }
        registerSlot(table, templateId, marker, counts);
        nodes.push({ kind: 'slot', name: marker });
        textStart = index;
    }
    if (expectedClose !== null) {
        const expected = expectedClose.kind === 'tool' ? `tool:${expectedClose.name}` : expectedClose.name;
        throw new Error(`template "${templateId}" is missing "{{/${expected}}}"`);
    }
    if (textStart < source.length) nodes.push({ kind: 'text', text: source.slice(textStart) });
    return { nodes, next: index };
}

function renderNodes(
    nodes: readonly TemplateNode[],
    slots: Readonly<Record<string, string | undefined>>,
    finalToolNames: readonly string[],
    state: RenderState,
): void {
    for (const node of nodes) {
        if (node.kind === 'text') {
            state.parts.push(node.text);
            state.bytes += Buffer.byteLength(node.text, 'utf8');
            continue;
        }
        if (node.kind === 'slot') {
            const value = slots[node.name];
            // An optional empty slot renders nothing; a required empty slot was
            // rejected before rendering, so this branch never hides a bug.
            if (value === undefined || value === '') continue;
            // Slot values are opaque data and are never parsed as template text.
            const startByte = state.bytes;
            state.parts.push(value);
            state.bytes += Buffer.byteLength(value, 'utf8');
            state.ranges[node.name] = { startByte, endByte: state.bytes };
            continue;
        }
        if (node.kind === 'block') {
            const value = slots[node.name];
            if (value === undefined || value === '') continue;
            // The range covers the block's inner rendered text, not its marker.
            const startByte = state.bytes;
            renderNodes(node.children, slots, finalToolNames, state);
            if (state.bytes > startByte) state.ranges[node.name] = { startByte, endByte: state.bytes };
            continue;
        }
        // Tool blocks render only when the final Kernel tool list names the tool;
        // no platform v1 template uses one.
        if (finalToolNames.includes(node.name)) renderNodes(node.children, slots, finalToolNames, state);
    }
}

/**
 * Renders one platform template. Only the three P1 constructs are honoured;
 * slot values are inserted verbatim. All failures below are code bugs that the
 * fixed pack cannot produce, so they throw a plain Error instead of returning a
 * result union.
 */
export function renderTemplate(
    resolved: ResolvedPromptPackV1,
    templateId: string,
    slots: Readonly<Record<string, string | undefined>>,
    finalToolNames: readonly string[],
): { text: string; sectionRanges: Readonly<Record<string, SlotRangeV1>> } {
    const table = Object.hasOwn(TEMPLATE_SLOTS, templateId) ? TEMPLATE_SLOTS[templateId] : undefined;
    const source = Object.hasOwn(resolved.templates, templateId) ? resolved.templates[templateId] : undefined;
    if (table === undefined || source === undefined) throw new Error(`unknown prompt template "${templateId}"`);
    // A caller may not smuggle in a slot the template's table does not declare.
    for (const name of Object.keys(slots))
        if (!Object.hasOwn(table, name)) throw new Error(`slot "${name}" is not declared by template "${templateId}"`);
    const counts = new Map<string, number>();
    const parsed = parseSequence(stripAloneBlockMarkerLines(source, templateId), 0, null, templateId, table, counts);
    // Every required slot of the table must have a formatted value, whether or
    // not this template's text uses it: the table is the contract the pack
    // editor validates against, and a template is only one consumer of it.
    for (const name of Object.keys(table)) {
        const spec = table[name];
        // Required is about the formatted slot value: an empty string counts as
        // missing, never as a rendered section.
        if (spec?.required && (slots[name] === undefined || slots[name] === ''))
            throw new Error(`required slot "${name}" is empty in template "${templateId}"`);
    }
    const state: RenderState = { parts: [], bytes: 0, ranges: {} };
    renderNodes(parsed.nodes, slots, finalToolNames, state);
    return { text: state.parts.join(''), sectionRanges: state.ranges };
}
