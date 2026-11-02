/**
 * The one value guard the browser layer shares (E3-2 ruling item 3): boot and
 * the pure TaskMap adapter both read route replies whose bodies are `unknown`
 * at the JSON boundary. Keeping one copy here is the reuse rule; nothing here
 * touches the DOM, the network or an app module.
 */

export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord {
  return typeof value === 'object' && value !== null ? value as JsonRecord : {};
}

export function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
