/**
 * The frozen boards' template language: plain HTML plus the two directives the
 * canvas runtime provides (`sc-if`, `sc-for`), `{{dot.path}}` holes, DOM-style
 * event attributes and `ref` callbacks. Only the forms used by the ten boards
 * in `docs/ui-reference/workbench-2026-10/` are recognized; an unknown `sc-*`
 * tag is refused rather than rendered as a raw directive.
 */

/** HTML void elements: they never have children or a closing tag. */
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const PATH = '[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*';
const SINGLE_HOLE = new RegExp(`^\\s*\\{\\{\\s*(${PATH})\\s*\\}\\}\\s*$`);

type TemplateAttribute = { name: string; value: string };
type TemplateElement = {
  kind: 'element';
  tag: string;
  attrs: TemplateAttribute[];
  children: TemplateNode[];
  selfClosing: boolean;
};
type TemplateText = { kind: 'text'; text: string };
export type TemplateNode = TemplateElement | TemplateText;

export type TemplateStats = {
  scIf: number;
  scFor: number;
  interpolations: number;
  events: number;
};

export type ParsedTemplate = { nodes: TemplateNode[]; stats: TemplateStats };

const countHoles = (value: string): number => value.match(/\{\{/g)?.length ?? 0;
export const isEventAttribute = (name: string): boolean => /^on[A-Z]/.test(name);

/** A `{{path}}` hole that must resolve to a raw value (directive/event/ref). */
export function holePath(value: string): string | null {
  return SINGLE_HOLE.exec(value)?.[1] ?? null;
}

/**
 * Parse a template body. Comments are dropped; their text is editor prose, not
 * markup. The stats count every `{{` hole including `hint-placeholder-*` values,
 * matching the frozen §1.5 count.
 */
export function parseTemplate(html: string): ParsedTemplate {
  const stats: TemplateStats = { scIf: 0, scFor: 0, interpolations: 0, events: 0 };
  const { nodes } = parseNodes(html, 0, null, stats);
  return { nodes, stats };
}

function parseNodes(html: string, from: number, closing: string | null, stats: TemplateStats):
  { nodes: TemplateNode[]; index: number } {
  const nodes: TemplateNode[] = [];
  let index = from;
  while (index < html.length) {
    if (html.startsWith('</', index)) {
      const end = html.indexOf('>', index);
      if (end < 0) throw new Error('template: unterminated closing tag');
      const name = html.slice(index + 2, end).trim();
      if (closing === null) throw new Error(`template: unexpected closing tag </${name}>`);
      if (name !== closing) throw new Error(`template: expected </${closing}>, found </${name}>`);
      return { nodes, index: end + 1 };
    }
    if (html.startsWith('<!--', index)) {
      const end = html.indexOf('-->', index + 4);
      if (end < 0) throw new Error('template: unterminated comment');
      index = end + 3;
      continue;
    }
    if (html[index] === '<' && /[A-Za-z]/.test(html[index + 1] ?? '')) {
      const parsed = parseElement(html, index, stats);
      nodes.push(parsed.node);
      index = parsed.index;
      continue;
    }
    const next = html.indexOf('<', index + 1);
    const end = next < 0 ? html.length : next;
    const text = decodeCharacterReferences(html.slice(index, end));
    stats.interpolations += countHoles(text);
    nodes.push({ kind: 'text', text });
    index = end;
  }
  if (closing !== null) throw new Error(`template: missing </${closing}>`);
  return { nodes, index };
}

function parseElement(html: string, from: number, stats: TemplateStats): { node: TemplateElement; index: number } {
  let index = from + 1;
  const nameStart = index;
  while (index < html.length && /[\w-]/.test(html[index]!)) index += 1;
  const tag = html.slice(nameStart, index);
  if (!tag) throw new Error('template: empty tag name');
  if (tag.startsWith('sc-') && tag !== 'sc-if' && tag !== 'sc-for') {
    throw new Error(`template: unknown directive <${tag}>`);
  }

  const attrs: TemplateAttribute[] = [];
  let selfClosing = false;
  while (index < html.length) {
    while (/\s/.test(html[index] ?? '')) index += 1;
    if (html.startsWith('/>', index)) { selfClosing = true; index += 2; break; }
    if (html[index] === '>') { index += 1; break; }
    const attrStart = index;
    while (index < html.length && !/[\s=/>]/.test(html[index]!)) index += 1;
    const attrName = html.slice(attrStart, index);
    if (!attrName) throw new Error(`template: malformed attribute in <${tag}>`);
    while (/\s/.test(html[index] ?? '')) index += 1;
    let value = '';
    if (html[index] === '=') {
      index += 1;
      while (/\s/.test(html[index] ?? '')) index += 1;
      const quote = html[index];
      if (quote === '"' || quote === "'") {
        const valueStart = index + 1;
        const valueEnd = html.indexOf(quote, valueStart);
        if (valueEnd < 0) throw new Error(`template: unterminated attribute ${attrName} in <${tag}>`);
        value = decodeCharacterReferences(html.slice(valueStart, valueEnd));
        index = valueEnd + 1;
      } else {
        const valueStart = index;
        while (index < html.length && !/[\s>]/.test(html[index]!)) index += 1;
        value = decodeCharacterReferences(html.slice(valueStart, index));
      }
    }
    attrs.push({ name: attrName, value });
    stats.interpolations += countHoles(value);
    if (isEventAttribute(attrName)) stats.events += 1;
  }
  if (index > html.length) throw new Error(`template: unterminated tag <${tag}>`);

  if (tag === 'sc-if') {
    stats.scIf += 1;
    requireHole(attrs, 'value', tag);
    requireHole(attrs, 'hint-placeholder-val', tag, true);
  } else if (tag === 'sc-for') {
    stats.scFor += 1;
    requireHole(attrs, 'list', tag);
    const as = attrs.find((attr) => attr.name === 'as')?.value ?? '';
    if (!new RegExp(`^${PATH}$`).test(as)) throw new Error('template: sc-for needs an "as" loop variable');
  }

  const children: TemplateNode[] = [];
  if (!selfClosing && !VOID_ELEMENTS.has(tag)) {
    const parsed = parseNodes(html, index, tag, stats);
    children.push(...parsed.nodes);
    index = parsed.index;
  }
  return { node: { kind: 'element', tag, attrs, children, selfClosing }, index };
}

function requireHole(attrs: TemplateAttribute[], name: string, tag: string, optional = false): void {
  const attr = attrs.find((candidate) => candidate.name === name);
  if (!attr) {
    if (optional) return;
    throw new Error(`template: <${tag}> needs ${name}="{{path}}"`);
  }
  if (holePath(attr.value) === null) throw new Error(`template: <${tag}> ${name} must be one {{path}} hole`);
}

const NAMED_CHARACTER_REFERENCES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"' };

/** Decode one layer of HTML character references in frozen template text/attribute values. */
function decodeCharacterReferences(value: string): string {
  return value.replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|(amp|lt|gt|quot));/gi,
    (_reference, hex: string | undefined, decimal: string | undefined, named: string | undefined) => {
      if (named !== undefined) return NAMED_CHARACTER_REFERENCES[named.toLowerCase()]!;
      return String.fromCodePoint(parseInt(hex ?? decimal!, hex !== undefined ? 16 : 10));
    });
}
