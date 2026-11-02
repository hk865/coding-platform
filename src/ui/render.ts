import { holePath, isEventAttribute, type TemplateNode } from './template.js';

export type EventBinding = {
  kind: 'event';
  event: string;
  path: string;
  handler: (event: unknown) => unknown;
};
export type RefBinding = {
  kind: 'ref';
  path: string;
  handler: (element: unknown) => unknown;
};
type VAttribute = string | EventBinding | RefBinding;
type VElement = {
  kind: 'element';
  key: string;
  tag: string;
  attrs: Array<{ name: string; value: VAttribute }>;
  children: VNode[];
};
type VText = { kind: 'text'; key: string; text: string };
export type VNode = VElement | VText;
export type Scope = Record<string, unknown>;

/** A dot path reads through the loop scopes; a missing segment renders ''. */
function readScopePath(scope: Scope, path: string): unknown {
  let value: unknown = scope;
  for (const segment of path.split('.')) {
    if (typeof value !== 'object' || value === null || !(segment in value)) return '';
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

export function renderBoardTemplate(nodes: TemplateNode[], root: Scope): VNode[] {
  return expandNodes(nodes, root, '');
}

/**
 * A node's key comes from its template position, never from the data: template
 * node i is `${prefix}${i}`, an `sc-if` child adds `${key}/`, an `sc-for` item
 * adds `${key}.${n}/`, and an element's children start a fresh prefix.
 */
function expandNodes(nodes: TemplateNode[], scope: Scope, prefix: string): VNode[] {
  const out: VNode[] = [];
  nodes.forEach((node, index) => {
    const key = `${prefix}${index}`;
    if (node.kind === 'text') {
      out.push({ kind: 'text', key, text: interpolate(node.text, scope) });
      return;
    }
    if (node.tag === 'sc-if') {
      const value = attribute(node, 'value');
      if (readScopePath(scope, holePath(value) ?? '')) out.push(...expandNodes(node.children, scope, `${key}/`));
      return;
    }
    if (node.tag === 'sc-for') {
      const list = readScopePath(scope, holePath(attribute(node, 'list')) ?? '') as unknown[];
      const loop = attribute(node, 'as');
      list.forEach((item, itemIndex) => {
        out.push(...expandNodes(node.children, { ...scope, [loop]: item }, `${key}.${itemIndex}/`));
      });
      return;
    }
    const attrs: VElement['attrs'] = [];
    for (const attr of node.attrs) {
      if (attr.name.startsWith('hint-placeholder-')) continue;
      if (isEventAttribute(attr.name)) {
        const path = bindingPath(attr.value, attr.name);
        const handler = readScopePath(scope, path);
        if (typeof handler !== 'function') throw new Error(`${attr.name}: ${path} is not a function`);
        attrs.push({ name: attr.name, value: { kind: 'event', event: attr.name, path, handler: handler as EventBinding['handler'] } });
      } else if (attr.name === 'ref') {
        const path = bindingPath(attr.value, attr.name);
        const handler = readScopePath(scope, path);
        // A board may pass `null` for an element it does not want to keep
        // (TaskMap's selected node/row refs); that is no reference, not an error.
        if (handler === null || handler === undefined) continue;
        if (typeof handler !== 'function') throw new Error(`ref: ${path} is not a function`);
        attrs.push({ name: attr.name, value: { kind: 'ref', path, handler: handler as RefBinding['handler'] } });
      } else {
        attrs.push({ name: attr.name, value: interpolate(attr.value, scope) });
      }
    }
    out.push({ kind: 'element', key, tag: node.tag, attrs, children: expandNodes(node.children, scope, '') });
  });
  return out;
}

function attribute(node: TemplateNode, name: string): string {
  if (node.kind !== 'element') throw new Error(`template: ${name} on a text node`);
  const attr = node.attrs.find((candidate) => candidate.name === name);
  if (!attr) throw new Error(`template: <${node.tag}> is missing ${name}`);
  return attr.value;
}

function bindingPath(value: string, name: string): string {
  const path = holePath(value);
  if (path === null) throw new Error(`${name} must be one {{path}} hole`);
  return path;
}

/** Replace every hole in a text/attribute value; a missing path renders ''. */
function interpolate(value: string, scope: Scope): string {
  return value.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (_hole, path: string) =>
    stringify(readScopePath(scope, path.trim())));
}

function stringify(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}
