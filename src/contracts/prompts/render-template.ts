import type { PromptTextsV1 } from './prompt-set.js';
import { TEMPLATE_SLOTS } from './slot-tables.js';

/** A rendered slot's UTF-8 byte span in `text`; `endByte` is exclusive. */
export type SlotRangeV1 = { startByte: number; endByte: number };

/** One parsed template construct. `tool` blocks render when the final tool list names the tool. */
export type TemplateNodeV1 =
    | { readonly kind: 'text'; readonly text: string }
    | { readonly kind: 'slot'; readonly name: string }
    | { readonly kind: 'block'; readonly name: string; readonly children: readonly TemplateNodeV1[] }
    | { readonly kind: 'tool'; readonly name: string; readonly children: readonly TemplateNodeV1[] };

type Closing = { readonly kind: 'slot' | 'tool'; readonly name: string };

/**
 * The one code-bug class of template parsing and rendering (ruling 4). A pack
 * problem is reported as data by the resolver; a render-time failure throws
 * this, and preparation maps it to `invalid`.
 */
export class PromptRenderError extends Error {
    readonly code: 'template_invalid' | 'required_slot_empty' | 'illegal_section_order';
    readonly templateId: string;
    readonly slot: string | null;

    constructor(
        code: 'template_invalid' | 'required_slot_empty' | 'illegal_section_order',
        templateId: string,
        slot: string | null,
        message: string,
    ) {
        super(message);
        this.name = 'PromptRenderError';
        this.code = code;
        this.templateId = templateId;
        this.slot = slot;
    }
}

const SECTION_NAMES: ReadonlySet<string> = new Set([
    'role', 'goal', 'task', 'footprint', 'notes', 'reminders', 'inputs', 'continuation', 'unknown_call_review',
]);

/**
 * The secretary's one task section is written as three adjacent slots. They
 * stay in this internal order and move as one block when a pack orders the
 * sections differently.
 */
const SECRETARY_TASK_SLOTS = ['task_round', 'task_batched', 'task_earlier'] as const;
const SECRETARY_TASK_SLOT_SET: ReadonlySet<string> = new Set(SECRETARY_TASK_SLOTS);

/** The section a template slot belongs to, or `null` for a non-section slot. */
export function contextSectionOfSlot(name: string): string | null {
    if (SECRETARY_TASK_SLOT_SET.has(name)) return 'task';
    // The intervention-planning template's `plan` slot IS its `task` section.
    if (name === 'plan') return 'task';
    return SECTION_NAMES.has(name) ? name : null;
}

/** The input templates whose text also fixes the section order (ruling 9). */
const INPUT_TEMPLATES: ReadonlySet<string> = new Set([
    'work-input', 'query-planning-input', 'query-copy-input', 'secretary-round', 'intervention-planning',
]);

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
    errors: PromptRenderError[],
): void {
    // A template may only use slots the code-owned table declares. The table is
    // the contract the pack editor validates against, so anything else is a bug.
    // Parsing continues: the remaining markers and required slots stay decidable.
    if (!Object.hasOwn(table, name)) {
        errors.push(new PromptRenderError('template_invalid', templateId, name,
            `slot "${name}" is not declared by template "${templateId}"`));
        return;
    }
    // One slot may appear once: two occurrences would make section ranges and
    // presence ambiguous, and no platform template needs it.
    const count = (counts.get(name) ?? 0) + 1;
    if (count > 1)
        errors.push(new PromptRenderError('template_invalid', templateId, name,
            `template "${templateId}" uses slot "${name}" more than once`));
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
    errors: PromptRenderError[],
): { nodes: TemplateNodeV1[]; next: number } {
    const nodes: TemplateNodeV1[] = [];
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
                const child = parseSequence(source, index, { kind: 'tool', name: toolName }, templateId, table, counts,
                    errors);
                nodes.push({ kind: 'tool', name: toolName, children: child.nodes });
                index = child.next;
            } else {
                registerSlot(table, templateId, name, counts, errors);
                const child = parseSequence(source, index, { kind: 'slot', name }, templateId, table, counts, errors);
                nodes.push({ kind: 'block', name, children: child.nodes });
                index = child.next;
            }
            textStart = index;
            continue;
        }
        registerSlot(table, templateId, marker, counts, errors);
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

type SectionUse = {
    readonly name: string; readonly slot: string; readonly topLevel: boolean; readonly block: boolean;
};

function collectSectionUses(nodes: readonly TemplateNodeV1[], nested: boolean, out: SectionUse[]): void {
    for (const node of nodes) {
        if (node.kind === 'slot') {
            const name = contextSectionOfSlot(node.name);
            if (name !== null) out.push({ name, slot: node.name, topLevel: !nested, block: false });
        } else if (node.kind === 'block') {
            const name = contextSectionOfSlot(node.name);
            if (name !== null) out.push({ name, slot: node.name, topLevel: !nested, block: true });
            collectSectionUses(node.children, true, out);
        } else if (node.kind === 'tool') {
            collectSectionUses(node.children, true, out);
        }
    }
}

/** The top-level slots in document order; a block or tool is not a slot. */
function topLevelSlotNames(nodes: readonly TemplateNodeV1[]): string[] {
    return nodes.flatMap(node => node.kind === 'slot' ? [node.name] : []);
}

/**
 * The secretary task block is three top-level slots that must stay adjacent in
 * their internal order. A separated, reordered or wrapped block is a pack
 * problem; one structural problem is reported, not one per consequence.
 */
function secretaryTaskBlockProblem(
    templateId: string,
    nodes: readonly TemplateNodeV1[],
    uses: readonly SectionUse[],
    counts: ReadonlyMap<string, number>,
): PromptRenderError | null {
    const taskUses = uses.filter(use => use.name === 'task');
    const structural = taskUses.some(use => !use.topLevel || use.block);
    if (structural) return null;
    // A missing or duplicated slot already has its own problem; do not report
    // the block order on top of it.
    if (SECRETARY_TASK_SLOTS.some(name => (counts.get(name) ?? 0) !== 1)) return null;
    const order = topLevelSlotNames(nodes);
    const [first, second, third] = SECRETARY_TASK_SLOTS;
    const start = order.indexOf(first);
    if (order[start + 1] !== second || order[start + 2] !== third)
        return new PromptRenderError('illegal_section_order', templateId, first,
            `template "${templateId}" must keep ${SECRETARY_TASK_SLOTS.join(', ')} adjacent in that order`);
    return null;
}

function templateInvalid(
    code: 'template_invalid' | 'illegal_section_order',
    templateId: string,
    slot: string | null,
    message: string,
): TemplateParseV1 {
    const error = new PromptRenderError(code, templateId, slot, message);
    return { status: 'invalid', error, errors: [error] };
}

/**
 * The one parse result: the parsed nodes, or every independently decidable
 * problem. `error` is the first of `errors`, for the renderer, which must throw
 * one; the resolver reports all of them.
 */
export type TemplateParseV1 =
    | { status: 'parsed'; nodes: readonly TemplateNodeV1[] }
    | { status: 'invalid'; error: PromptRenderError; errors: readonly PromptRenderError[] };

/**
 * Parses one template and checks what is decidable from its text alone: the
 * three template constructs (`{{slot}}`, `{{#slot}}…{{/slot}}` and
 * `{{#tool:name}}…{{/tool:name}}`), the code-owned slots, required slots
 * appearing exactly once, the secretary task slots appearing at all (their
 * values are optional, the slots are not), and (for the three input templates)
 * the ruling 9 section order. Slot problems accumulate, so later markers and
 * required slots stay decidable; only a structural error that prevents further
 * parsing ends it. Never throws, so the resolver can collect the problems as
 * data; the renderer throws the first one.
 */
export function parseTemplateV1(templateId: string, source: string): TemplateParseV1 {
    const table = Object.hasOwn(TEMPLATE_SLOTS, templateId) ? TEMPLATE_SLOTS[templateId] : undefined;
    if (table === undefined)
        return templateInvalid('template_invalid', templateId, null, `unknown prompt template "${templateId}"`);
    const counts = new Map<string, number>();
    const errors: PromptRenderError[] = [];
    let nodes: readonly TemplateNodeV1[];
    try {
        nodes = parseSequence(stripAloneBlockMarkerLines(source, templateId), 0, null, templateId, table, counts,
            errors).nodes;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A structural error ends parsing; problems already decided stay reported.
        errors.push(new PromptRenderError('template_invalid', templateId, null, message));
        return { status: 'invalid', error: errors[0]!, errors };
    }
    const invalid = (): TemplateParseV1 => ({ status: 'invalid', error: errors[0]!, errors });
    for (const [name, spec] of Object.entries(table)) {
        // A pack may leave a secretary task slot's value empty, but it may not
        // drop the slot: the three slots together are the one task section, and
        // a missing one makes that part of the round material disappear from
        // every rendered request. Their table entries stay optional for the
        // values they carry.
        const needsMarker = spec.required
            || (templateId === 'secretary-round' && SECRETARY_TASK_SLOT_SET.has(name));
        if (!needsMarker || (counts.get(name) ?? 0) > 0) continue;
        errors.push(new PromptRenderError('template_invalid', templateId, name,
            spec.required ? `template "${templateId}" is missing required slot "${name}"`
                : `template "${templateId}" must keep slot "${name}" of its task section`));
    }
    if (!INPUT_TEMPLATES.has(templateId)) return errors.length === 0 ? { status: 'parsed', nodes } : invalid();
    const uses: SectionUse[] = [];
    collectSectionUses(nodes, false, uses);
    // `secretary-round` has no plain `task` slot: its three task slots project
    // onto the one `task` section, so the expected names come from the layout
    // rather than from the table's keys.
    const expected = new Set(templateId === 'secretary-round'
        ? ['role', 'goal', 'notes', 'task']
        : Object.keys(table).filter(name => SECTION_NAMES.has(name)));
    const seen = new Set<string>();
    for (const use of uses) {
        if (!use.topLevel || use.block)
            errors.push(new PromptRenderError('template_invalid', templateId, use.slot,
                `section "${use.name}" must be a top-level slot in template "${templateId}"`));
        seen.add(use.name);
    }
    for (const name of expected) {
        if (!seen.has(name))
            errors.push(new PromptRenderError('template_invalid', templateId, name,
                `template "${templateId}" is missing section "${name}"`));
    }
    if (templateId === 'secretary-round') {
        const blockProblem = secretaryTaskBlockProblem(templateId, nodes, uses, counts);
        if (blockProblem !== null) errors.push(blockProblem);
    }
    if (uses[0]?.name !== 'role')
        errors.push(new PromptRenderError('illegal_section_order', templateId, 'role',
            `template "${templateId}" must start with the role section`));
    return errors.length === 0 ? { status: 'parsed', nodes } : invalid();
}

function renderNodes(
    nodes: readonly TemplateNodeV1[],
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
        // Tool blocks render only when the final Kernel tool list names the tool.
        if (finalToolNames.includes(node.name)) renderNodes(node.children, slots, finalToolNames, state);
    }
}

/**
 * Renders one platform template. Only the three template constructs
 * (`{{slot}}`, `{{#slot}}…{{/slot}}` and `{{#tool:name}}…{{/tool:name}}`) are
 * honoured; slot values are inserted verbatim. A bad template text or an empty
 * required slot is a code bug that preparation maps to `invalid`, so it throws
 * `PromptRenderError`; an unknown template id or an undeclared caller slot
 * throws a plain `Error`. `texts` is the narrow surface (ruling 14): a resolved
 * pack satisfies it structurally.
 */
export function renderTemplate(
    texts: PromptTextsV1,
    templateId: string,
    slots: Readonly<Record<string, string | undefined>>,
    finalToolNames: readonly string[],
): { text: string; sectionRanges: Readonly<Record<string, SlotRangeV1>> } {
    const table = Object.hasOwn(TEMPLATE_SLOTS, templateId) ? TEMPLATE_SLOTS[templateId] : undefined;
    const source = Object.hasOwn(texts.templates, templateId) ? texts.templates[templateId] : undefined;
    if (table === undefined || source === undefined) throw new Error(`unknown prompt template "${templateId}"`);
    // A caller may not smuggle in a slot the template's table does not declare.
    for (const name of Object.keys(slots))
        if (!Object.hasOwn(table, name)) throw new Error(`slot "${name}" is not declared by template "${templateId}"`);
    const parsed = parseTemplateV1(templateId, source);
    if (parsed.status === 'invalid') throw parsed.error;
    // Every required slot of the table must have a formatted value, whether or
    // not this template's text uses it: the table is the contract the pack
    // editor validates against, and a template is only one consumer of it.
    for (const name of Object.keys(table)) {
        const spec = table[name];
        // Required is about the formatted slot value: an empty string counts as
        // missing, never as a rendered section.
        if (spec?.required && (slots[name] === undefined || slots[name] === ''))
            throw new PromptRenderError('required_slot_empty', templateId, name,
                `required slot "${name}" is empty in template "${templateId}"`);
    }
    const state: RenderState = { parts: [], bytes: 0, ranges: {} };
    renderNodes(parsed.nodes, slots, finalToolNames, state);
    return { text: state.parts.join(''), sectionRanges: state.ranges };
}
