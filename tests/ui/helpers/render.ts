import type { EventBinding, VNode } from '../../../src/ui/render.js';
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
export function collectEventBindings(nodes: VNode[]): EventBinding[] {
  const events: EventBinding[] = [];
  walk(nodes, (node) => {
    for (const attr of node.attrs) if (typeof attr.value === 'object' && attr.value.kind === 'event') events.push(attr.value);
  });
  return events;
}
function walk(nodes: VNode[], visit: (node: (VNode & { kind: 'element' })) => void): void {
  for (const node of nodes) {
    if (node.kind === 'text') continue;
    visit(node);
    walk(node.children, visit);
  }
}
export function serializeTree(nodes: VNode[]): string {
  return nodes.map((node) => {
    if (node.kind === 'text') return escape(node.text);
    const attrs = node.attrs
      .filter((attr): attr is { name: string; value: string } => typeof attr.value === 'string')
      .map((attr) => ` ${attr.name}="${escape(attr.value)}"`)
      .join('');
    if (VOID_ELEMENTS.has(node.tag)) return `<${node.tag}${attrs}>`;
    return `<${node.tag}${attrs}>${serializeTree(node.children)}</${node.tag}>`;
  }).join('');
}
function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
