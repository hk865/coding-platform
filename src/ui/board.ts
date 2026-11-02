import { parseTemplate, type ParsedTemplate } from './template.js';

export type Board = {
  name: string;
  helmetHtml: string;
  templateHtml: string;
  logic: string;
  /** `data-props` defaults, excluding the editor-only `$preview` key. */
  defaults: Record<string, string>;
  template: ParsedTemplate;
  stats: ParsedTemplate['stats'];
};

/**
 * Parse the pieces of one board page. `data-props` is the editor schema; only
 * properties that carry a `default` become initial props (`$preview` is the
 * canvas frame size, not a prop).
 */
export function parseBoardParts(parts: {
  name: string;
  helmetHtml: string;
  templateHtml: string;
  logic: string;
  propsJson: string;
}): Board {
  const templateHtml = stripHelmet(parts.templateHtml);
  const template = parseTemplate(templateHtml);
  const schema = parseProps(parts.propsJson);
  const defaults: Record<string, string> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key.startsWith('$') || typeof value !== 'object' || value === null) continue;
    const entry = value as { default?: unknown };
    if (entry.default !== undefined) defaults[key] = String(entry.default);
  }
  return {
    name: parts.name,
    helmetHtml: parts.helmetHtml || extractHelmet(parts.templateHtml),
    templateHtml,
    logic: parts.logic,
    defaults,
    template,
    stats: template.stats,
  };
}

function parseProps(json: string): Record<string, unknown> {
  return JSON.parse(json) as Record<string, unknown>;
}

/** Parse a complete `.dc.html` file: `<x-dc>` template, `<helmet>`, logic script. */
export function parseBoard(name: string, source: string): Board {
  const rootStart = source.search(/<x-dc\b[^>]*>/);
  const rootEnd = source.indexOf('</x-dc>');
  if (rootStart < 0 || rootEnd < 0 || rootEnd <= rootStart) throw new Error(`${name}: missing <x-dc> template body`);
  const openEnd = source.indexOf('>', rootStart) + 1;
  const templateHtml = source.slice(openEnd, rootEnd);
  const scriptStart = source.indexOf('data-dc-script');
  if (scriptStart < 0) throw new Error(`${name}: missing the data-dc-script logic block`);
  const tagStart = source.lastIndexOf('<script', scriptStart);
  const tagEnd = source.indexOf('>', scriptStart);
  const logicStart = tagEnd + 1;
  const logicEnd = source.indexOf('</script>', logicStart);
  if (tagStart < 0 || tagEnd < 0 || logicEnd < 0) throw new Error(`${name}: unterminated logic block`);
  const openTag = source.slice(tagStart, tagEnd + 1);
  const propsMatch = /\bdata-props\s*=\s*(["'])([\s\S]*?)\1/.exec(openTag);
  if (!propsMatch) throw new Error(`${name}: logic block has no data-props`);
  return parseBoardParts({
    name,
    helmetHtml: '',
    templateHtml,
    logic: source.slice(logicStart, logicEnd),
    propsJson: propsMatch[2]!,
  });
}

function extractHelmet(html: string): string {
  return /<helmet\b[^>]*>([\s\S]*?)<\/helmet>/.exec(html)?.[1] ?? '';
}

function stripHelmet(html: string): string {
  return html.replace(/<helmet\b[^>]*>[\s\S]*?<\/helmet>/g, '');
}
