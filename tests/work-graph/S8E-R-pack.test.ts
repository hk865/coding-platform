/**
 * S8E L3 R-pack.
 *
 * Reads the frozen link strings from the generated pack and the pack source,
 * compares the source `record_note.json` with the generated tool text, checks
 * the real `createNoteTools` schema's admitted kinds and its `link` object byte
 * for byte, and proves the old four-field `renderNoteHeader` call site still
 * passes exactly four fields.
 *
 * The full tool-spec bytes (description + whole input schema) stay guarded by
 * `tests/runtime/PC2-W-note-tool.test.ts`'s hand-written specification; this row
 * compares the source pack entry and the link sub-schema, the two parts R-pack
 * owns.
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { toolSchema as z, type ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { renderNoteHeader } from '../../src/contracts/note.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { createNoteTools } from '../../src/core/agent-runtime/note-tool.js';

const PACK_ROOT = new URL('../../resources/prompts/platform/', import.meta.url);
const NOTE_VIEWS = new URL('../../src/core/work-graph/views/note-views.ts', import.meta.url);

const LINK_RELATIONS = {
  'note.relation.calls': '调用',
  'note.relation.injects': '注入',
  'note.relation.callback': '回调',
  'note.relation.data': '数据',
  'note.relation.message': '消息',
  'note.relation.spawns': '起进程',
} as const;

/** The exact `link` property of the generated write branch (kind order and constraints included). */
const LINK_SCHEMA = "{\"type\":\"object\",\"properties\":{\"relation\":{\"type\":\"string\",\"enum\":[\"calls\",\"injects\",\"callback\",\"data\",\"message\",\"spawns\"]},\"key\":{\"anyOf\":[{\"anyOf\":[{\"type\":\"object\",\"properties\":{\"kind\":{\"type\":\"string\",\"const\":\"symbol\"},\"anchor\":{\"type\":\"object\",\"properties\":{\"kind\":{\"type\":\"string\",\"const\":\"file\"},\"path\":{\"type\":\"string\",\"minLength\":1},\"symbolRequest\":{\"type\":\"object\",\"properties\":{\"language\":{\"type\":\"string\",\"minLength\":1},\"name\":{\"type\":\"string\",\"minLength\":1},\"range\":{\"type\":\"object\",\"properties\":{\"startLine\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":9007199254740991},\"endLine\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":9007199254740991}},\"required\":[\"startLine\",\"endLine\"],\"additionalProperties\":false}},\"required\":[\"language\",\"name\"],\"additionalProperties\":false}},\"required\":[\"kind\",\"path\",\"symbolRequest\"],\"additionalProperties\":false}},\"required\":[\"kind\",\"anchor\"],\"additionalProperties\":false},{\"type\":\"object\",\"properties\":{\"kind\":{\"type\":\"string\",\"const\":\"literal\"},\"text\":{\"type\":\"string\",\"minLength\":1}},\"required\":[\"kind\",\"text\"],\"additionalProperties\":false}]},{\"type\":\"null\"}]},\"evidence\":{\"type\":\"array\",\"items\":{\"type\":\"object\",\"properties\":{\"role\":{\"type\":\"string\",\"enum\":[\"use\",\"wire\",\"register\",\"emit\",\"receive\",\"launch\",\"entry\"]},\"at\":{\"type\":\"object\",\"properties\":{\"path\":{\"type\":\"string\",\"minLength\":1},\"symbolRequest\":{\"type\":\"object\",\"properties\":{\"language\":{\"type\":\"string\",\"minLength\":1},\"name\":{\"type\":\"string\",\"minLength\":1},\"range\":{\"type\":\"object\",\"properties\":{\"startLine\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":9007199254740991},\"endLine\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":9007199254740991}},\"required\":[\"startLine\",\"endLine\"],\"additionalProperties\":false}},\"required\":[\"language\",\"name\"],\"additionalProperties\":false},\"range\":{\"type\":\"object\",\"properties\":{\"startLine\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":9007199254740991},\"endLine\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":9007199254740991}},\"required\":[\"startLine\",\"endLine\"],\"additionalProperties\":false}},\"required\":[\"path\"],\"additionalProperties\":false}},\"required\":[\"role\",\"at\"],\"additionalProperties\":false}}},\"required\":[\"relation\",\"evidence\"],\"additionalProperties\":false}";

type Texts = Readonly<Record<string, { description: string; parameters: Readonly<Record<string, string>> }>>;
type ToolSpecification = { name: string; description: string; inputSchema: unknown };

const context = { projectId: 'p', workspaceId: 'w', principal: {}, materialReader: {},
  signal: new AbortController().signal } as never;
const kinds = ['convention', 'pitfall', 'tradeoff', 'open_question', 'preference', 'decision',
  'understanding', 'repair', 'link'] as const;

const definition = (texts?: Texts): ToolDefinition =>
  createNoteTools({ context, notes: {} as never, check: {} as never, requestIdForCall: () => 'r',
    kinds: [...kinds], withdraw: true, ...(texts === undefined ? {} : { texts }) }).create({} as never)[0]!;

const specification = (tool: ToolDefinition): ToolSpecification =>
  ({ name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.inputSchema) });

describe('R-pack: the frozen link strings and the record_note text', () => {
  it('the generated pack carries the five link strings and the broken-link warning', async () => {
    const strings = PLATFORM_PROMPT_PACK_V1.strings;
    expect(strings['note.kind.link']).toBe('联系');
    expect(strings['note.warning.link_broken']).toBe('证据对不上');
    for (const [key, value] of Object.entries(LINK_RELATIONS)) {
      expect(strings[key as keyof typeof strings]).toBe(value);
    }
    const source = JSON.parse(await readFile(new URL('strings.json', PACK_ROOT), 'utf8')) as Record<string, string>;
    expect(source['note.kind.link']).toBe('联系');
    expect(source['note.warning.link_broken']).toBe('证据对不上');
    for (const [key, value] of Object.entries(LINK_RELATIONS)) expect(source[key]).toBe(value);
  });

  it('record_note.json is the generated golden: description bytes and the empty parameters', async () => {
    const source = JSON.parse(await readFile(new URL('tools/record_note.json', PACK_ROOT), 'utf8')) as {
      description: string; parameters: Record<string, string>;
    };
    const generated = PLATFORM_PROMPT_PACK_V1.tools.record_note;
    expect(Buffer.from(generated.description, 'utf8').equals(Buffer.from(source.description, 'utf8'))).toBe(true);
    expect(generated.description).toBe(source.description);
    expect(generated.parameters).toEqual({});
    expect(JSON.stringify(generated)).toBe(JSON.stringify({ description: source.description, parameters: source.parameters }));
  });

  it('the real record_note schema admits the nine kinds and the frozen link object', async () => {
    const spec = specification(definition(PLATFORM_PROMPT_PACK_V1.tools));
    expect(spec.description).toBe(PLATFORM_PROMPT_PACK_V1.tools.record_note.description);
    const schema = spec.inputSchema as {
      oneOf: { properties: { kind: { enum: string[] }; link: unknown } }[];
    };
    const write = schema.oneOf[0]!;
    expect(write.properties.kind.enum).toEqual([...kinds]);
    expect(JSON.stringify(write.properties.link)).toBe(LINK_SCHEMA);
    expect(specification(definition())).toEqual(spec);
  });

  it('the old four-field renderNoteHeader call site keeps four fields and its bytes', async () => {
    const source = await readFile(NOTE_VIEWS, 'utf8');
    const at = source.lastIndexOf('renderNoteHeader({');
    expect(at).toBeGreaterThanOrEqual(0);
    const call = source.slice(at, source.indexOf('}),', at) + 3);
    expect(call).toContain('kind: head.kind, anchor: head.anchor, structural: head.structural,');
    expect(call).toContain('conclusion: head.conclusion');
    expect(call).not.toContain('relation');
    expect(call).not.toContain('to:');

    expect(renderNoteHeader({ kind: 'repair', anchor: { kind: 'module', moduleId: 'runtime' },
      structural: false, conclusion: '结论' })).toBe('修补(模块 runtime)：结论');
    expect(renderNoteHeader({ kind: 'convention', anchor: { kind: 'project' },
      structural: true, conclusion: '结论' })).toBe('约定(项目)!：结论');
  });
});
