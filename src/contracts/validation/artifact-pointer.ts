/** A location in the original immutable body, never a tool response wrapper.
 * Existence does not establish the truth or relevance of a review citation. */
export function artifactPointerExists(body: string, pointer: string): boolean {
  if (pointer === '') return true;
  if (!pointer.startsWith('/')) return false;
  let value: unknown;
  try { value = JSON.parse(body); } catch { return false; }
  for (const encoded of pointer.slice(1).split('/')) {
    if (/~(?![01])/.test(encoded)) return false;
    const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    // Array metadata such as JS length is not a location in serialized JSON.
    if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key)) return false;
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) return false;
    value = (value as Record<string, unknown>)[key];
  }
  return true;
}
