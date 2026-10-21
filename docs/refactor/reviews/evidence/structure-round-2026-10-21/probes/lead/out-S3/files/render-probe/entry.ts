import { renderTemplate } from '/home/han001/dsh-work/slices/s9s85-S3/src/contracts/prompts/render-template.ts';

const base: any = {
  manifest: { schemaVersion: 1, packId: 'platform', extends: null, templates: {}, strings: 'strings.json', tools: {} },
  templates: {}, strings: {}, tools: {},
};
const render = (source: string, slots: Record<string, string | undefined>, tools: string[] = []) => {
  const pack = { ...base, templates: { 'continuation-brief': source } };
  return renderTemplate(pack, 'continuation-brief', slots, tools);
};
const show = (label: string, value: unknown) => console.log(label, JSON.stringify(value));

show('plain', render('标题\n{{marker}}\n尾', { marker: '中😀' }));
show('block present', render('头\n\n{{#body}}\n正文\n{{/body}}\n尾', { marker: 'm', body: 'x' }));
show('block absent', render('头\n\n{{#body}}\n正文\n{{/body}}\n尾', { marker: 'm' }));
show('block inline present', render('A{{#body}}[inner]{{/body}}Z', { marker: 'm', body: 'v' }));
show('block inline absent', render('A{{#body}}[inner]{{/body}}Z', { marker: 'm' }));
show('optional plain absent', render('A{{body}}Z', { marker: 'm' }));
show('tool present', render('A{{#tool:read_source}}T{{/tool:read_source}}Z', { marker: 'm' }, ['read_source']));
show('tool absent', render('A{{#tool:read_source}}T{{/tool:read_source}}Z', { marker: 'm' }));
show('value not parsed', render('A{{body}}Z', { marker: 'm', body: '{{marker}}' }));
show('nested', render('A{{#body}}{{#blocked}}x{{/blocked}}{{/body}}Z', { marker: 'm', body: 'v', blocked: 'y' }));
show('crlf marker line', render('头\r\n{{#body}}\r\n正文\r\n{{/body}}\r\n尾', { marker: 'm', body: 'x' }));
show('eof marker', render('头\n{{#body}}\n正文\n{{/body}}', { marker: 'm', body: 'x' }));
for (const [label, source, slots] of [
  ['unknown template', 'x', {}],
  ['duplicate', '{{body}}{{body}}', { marker: 'm' }],
  ['unknown slot in template', '{{nope}}', { marker: 'm' }],
  ['extra slot', 'x', { marker: 'm', nope: 'v' }],
  ['required empty', '{{marker}}', { marker: '' }],
  ['required undefined', '{{marker}}', {}],
  ['unclosed', '{{#body}}x', { marker: 'm' }],
  ['bad close', '{{#body}}x{{/marker}}', { marker: 'm' }],
] as const) {
  try { render(source as string, slots as any); show(label, 'NO THROW'); }
  catch (error) { show(label, (error as Error).message); }
}
try { renderTemplate(base, 'nope', {}, []); } catch (error) { show('unknown id', (error as Error).message); }
