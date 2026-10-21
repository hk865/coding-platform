/**
 * Q4-01: the replay log's only marker is `{"$probe":"undefined"}`. A JSON.parse
 * reviver cannot represent `undefined` (returning it deletes the key or leaves
 * an array hole), so parse normally and walk the value afterwards: the marker
 * becomes `undefined` in place, an object key stays with the value `undefined`,
 * an array index stays and holds `undefined`, and key order is untouched.
 */
export function reviveUndefined(value) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) value[index] = reviveUndefined(value[index]);
    return value;
  }
  if (value !== null && typeof value === 'object') {
    if (value.$probe === 'undefined') return undefined;
    for (const key of Object.keys(value)) value[key] = reviveUndefined(value[key]);
    return value;
  }
  return value;
}
