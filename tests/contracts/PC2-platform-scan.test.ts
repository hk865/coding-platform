/**
 * PC-19 platform scan (PC-2 ruling 18): every platform template's literal text
 * outside `{{#tool:…}}` blocks names exactly the tools its manifest entry
 * declares. Whole tool names only, case-sensitive (`read_source` is not
 * `read`), against every builtin, reserved and extension tool name.
 *
 * The exemption list below is frozen with the pack: the words are not tool
 * references. One reason per line.
 */
import { describe, expect, it } from 'vitest';
import type { ResolvedPromptPackV1 } from '../../src/contracts/prompts/prompt-pack.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import {
    parseTemplateV1, type TemplateNodeV1,
} from '../../src/contracts/prompts/render-template.js';
import { SESSION_MAILBOX_TOOL_NAMES, USER_DECISION_TOOL_NAMES } from '../../src/core/agent-runtime/communication-tools.js';
import { REQUEST_COMMAND_RERUN_TOOL_NAMES } from '../../src/core/agent-runtime/command-rerun-tools.js';
import { GRAPH_TOOL_NAMES } from '../../src/core/agent-runtime/graph-tools.js';
import { NOTE_TOOL_NAMES } from '../../src/core/agent-runtime/note-tool.js';
import { READONLY_COMMAND_TOOL_NAME } from '../../src/core/agent-runtime/readonly-command-tool.js';
import { SESSION_DISCOVERY_TOOL_NAMES } from '../../src/core/agent-runtime/session-discovery-tools.js';
import { RESERVED_TOOL_NAMES } from '../../src/core/agent-runtime/tool-group-assembly.js';
import {
    PROPOSE_SAFER_METHOD_TOOL_NAMES, RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAMES,
} from '../../src/core/agent-runtime/unknown-call-review-tools.js';
import { WHITEBOARD_TOOL_NAMES } from '../../src/core/agent-runtime/whiteboard-tools.js';

const PACK: ResolvedPromptPackV1 = PLATFORM_PROMPT_PACK_V1;

/** Every builtin, reserved (check included) and extension tool name the platform can register. */
const EVERY_TOOL_NAME: ReadonlySet<string> = new Set<string>([
    ...RESERVED_TOOL_NAMES,
    ...SESSION_MAILBOX_TOOL_NAMES,
    ...USER_DECISION_TOOL_NAMES,
    ...WHITEBOARD_TOOL_NAMES,
    ...SESSION_DISCOVERY_TOOL_NAMES,
    ...GRAPH_TOOL_NAMES,
    ...NOTE_TOOL_NAMES,
    ...RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAMES,
    ...PROPOSE_SAFER_METHOD_TOOL_NAMES,
    ...REQUEST_COMMAND_RERUN_TOOL_NAMES,
    READONLY_COMMAND_TOOL_NAME,
]);

type ExemptionV1 = { templateId: string; word: string; line: number; reason: string };

/**
 * Frozen: a hit here is not a tool reference. One reason per line.
 *
 * The note operation names `write`/`withdraw`/`review` sit inside their
 * `record_note` sentence block, so they are not outside-block hits; `checks`
 * is not a whole-name match for `check`. The list holds the hits that remain.
 */
const EXEMPTIONS: readonly ExemptionV1[] = [
    { templateId: 'initial-planning-answer', word: 'check', line: 14, reason: "planning answer's checks field sentence" },
    { templateId: 'initial-planning-answer', word: 'check', line: 15, reason: "planning answer's plain 'check' (what to propose)" },
    { templateId: 'initial-planning-answer', word: 'check', line: 18, reason: "planning answer's plain 'check' (shape sample disclaimer)" },
    { templateId: 'initial-planning-answer', word: 'check', line: 49, reason: "planning answer's plain 'check' (sample verification text)" },
    { templateId: 'initial-planning-answer', word: 'check', line: 79, reason: "planning answer's checks sample field" },
    { templateId: 'skill-platform-work', word: 'check', line: 47, reason: 'record_note receipt field, not the reserved Kernel tool' },
    { templateId: 'skill-platform-secretary', word: 'check', line: 42, reason: 'record_note receipt field, not the reserved Kernel tool' },
    { templateId: 'skill-platform-adviser', word: 'check', line: 55, reason: 'record_note receipt field, not the reserved Kernel tool' },
    { templateId: 'skill-platform-scribe', word: 'check', line: 32, reason: 'record_note receipt field, not the reserved Kernel tool' },
];

/** The literal text the model would see if every tool were absent: text nodes outside any tool block. */
function literalTextOutsideToolBlocks(nodes: readonly TemplateNodeV1[], insideTool = false): string {
    let text = '';
    for (const node of nodes) {
        if (node.kind === 'text') {
            if (!insideTool) text += node.text;
        } else if (node.kind === 'slot') {
            continue;
        } else if (node.kind === 'tool') {
            text += literalTextOutsideToolBlocks(node.children, true);
        } else {
            text += literalTextOutsideToolBlocks(node.children, insideTool);
        }
    }
    return text;
}

/** The template file line holding `line`, or the literal line when the block layout split it. */
function sourceLineOf(template: string, line: string, literalLine: number): number {
    const at = template.indexOf(line);
    if (at === -1) return literalLine;
    return template.slice(0, at).split('\n').length;
}

function wholeNamePattern(name: string): RegExp {
    // Tool names are [a-z_]; a whole name is not bordered by another name character.
    return new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, 'g');
}

describe('PC-19 platform tool-name scan (ruling 18)', () => {
    it('scans every builtin, reserved and extension tool name the platform can register', () => {
        expect(EVERY_TOOL_NAME.size).toBe(RESERVED_TOOL_NAMES.size + SESSION_MAILBOX_TOOL_NAMES.length
            + USER_DECISION_TOOL_NAMES.length + WHITEBOARD_TOOL_NAMES.length + SESSION_DISCOVERY_TOOL_NAMES.length
            + GRAPH_TOOL_NAMES.length + NOTE_TOOL_NAMES.length + RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAMES.length
            + PROPOSE_SAFER_METHOD_TOOL_NAMES.length + REQUEST_COMMAND_RERUN_TOOL_NAMES.length + 1);
        for (const name of Object.keys(PACK.manifest.tools)) expect(EVERY_TOOL_NAME.has(name)).toBe(true);
    });

    it('declares every tool a template names outside its tool blocks, and no others', () => {
        const exemptionKeys = new Set(EXEMPTIONS.map(e => `${e.templateId}\u0000${e.word}\u0000${e.line}`));
        const usedExemptions = new Set<string>();
        const problems: string[] = [];
        for (const [templateId, entry] of Object.entries(PACK.manifest.templates)) {
            const text = PACK.templates[templateId];
            if (text === undefined) throw new Error(`template ${templateId} is missing`);
            const parsed = parseTemplateV1(templateId, text);
            if (parsed.status !== 'parsed') throw new Error(`template ${templateId}: ${parsed.error.message}`);
            const literal = literalTextOutsideToolBlocks(parsed.nodes).split('\n');
            const found = new Set<string>();
            for (const [index, line] of literal.entries()) {
                for (const name of EVERY_TOOL_NAME) {
                    if (!wholeNamePattern(name).test(line)) continue;
                    const key = `${templateId}\u0000${name}\u0000${sourceLineOf(text, line, index + 1)}`;
                    if (exemptionKeys.has(key)) {
                        usedExemptions.add(key);
                        continue;
                    }
                    found.add(name);
                }
            }
            const actual = [...found].sort();
            const declared = [...entry.mentionsTools].sort();
            if (JSON.stringify(actual) !== JSON.stringify(declared))
                problems.push(`${templateId}: outside [${actual.join(', ')}], declared [${declared.join(', ')}]`);
        }
        expect(problems).toEqual([]);
        // The exemption list is minimal: every entry silently covers a real hit.
        expect([...usedExemptions].sort()).toEqual([...exemptionKeys].sort());
    });
});
