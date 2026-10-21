/**
 * Value comparison for the S3 byte proof (book §5.0 rule 4).
 *
 * Strings are compared as UTF-8 buffers and the first differing byte is
 * reported with both lengths and the 16 neighbouring bytes. Arrays keep count
 * and order; objects keep own-key order and distinguish missing vs `undefined`
 * vs `null` (the probe serializer marks `undefined`); numbers are exact
 * (`Object.is`). Nothing is sorted or canonicalised.
 */

/** Makes a copy-root-relative test path so base and result copies compare. */
export function relativeTestPath(root, testPath) {
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return typeof testPath === 'string' && testPath.startsWith(prefix) ? testPath.slice(prefix.length) : testPath;
}

function hexWindow(buffer, offset) {
  const from = Math.max(0, offset - 8);
  const to = Math.min(buffer.length, offset + 8);
  return [...buffer.subarray(from, to)].map(byte => byte.toString(16).padStart(2, '0')).join(' ');
}

function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Appends every structural difference below `left`/`right` to `differences`.
 * Returns the number of differences found below this pair.
 */
export function compareValues(left, right, path, differences, limit = 200) {
  if (differences.length >= limit) return 0;
  const before = differences.length;
  const leftType = typeName(left);
  const rightType = typeName(right);
  if (leftType !== rightType) {
    differences.push({ kind: 'type', path, left: leftType, right: rightType });
    return 1;
  }
  if (leftType === 'string') {
    const leftBytes = Buffer.from(left, 'utf8');
    const rightBytes = Buffer.from(right, 'utf8');
    if (leftBytes.equals(rightBytes)) return 0;
    let offset = 0;
    const common = Math.min(leftBytes.length, rightBytes.length);
    while (offset < common && leftBytes[offset] === rightBytes[offset]) offset += 1;
    differences.push({
      kind: 'string-bytes', path, byteOffset: offset,
      leftLength: leftBytes.length, rightLength: rightBytes.length,
      leftBytes: hexWindow(leftBytes, offset), rightBytes: hexWindow(rightBytes, offset),
    });
    return 1;
  }
  if (leftType === 'number') {
    if (Object.is(left, right)) return 0;
    differences.push({ kind: 'number', path, left, right });
    return 1;
  }
  if (leftType === 'boolean' || leftType === 'null' || leftType === 'undefined') {
    if (left === right) return 0;
    differences.push({ kind: leftType, path, left: String(left), right: String(right) });
    return 1;
  }
  if (leftType === 'array') {
    if (left.length !== right.length) {
      differences.push({ kind: 'array-count', path, leftCount: left.length, rightCount: right.length });
    }
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      compareValues(left[index], right[index], `${path}[${String(index)}]`, differences, limit);
      if (differences.length >= limit) return differences.length - before;
    }
    return differences.length - before;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) {
    differences.push({ kind: 'object-keys', path, leftKeys, rightKeys });
  }
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) continue;
    compareValues(left[key], right[key], `${path}.${key}`, differences, limit);
    if (differences.length >= limit) break;
  }
  return differences.length - before;
}

/** Groups records by the proof key and returns the first/last index lookup. */
export function indexByKey(records, root) {
  const map = new Map();
  for (const record of records) {
    const key = [relativeTestPath(root, record.testPath), record.testName, record.probe, record.index].join('\u0000');
    if (map.has(key)) throw new Error(`duplicate replay key ${JSON.stringify(key)}`);
    map.set(key, record);
  }
  return map;
}
