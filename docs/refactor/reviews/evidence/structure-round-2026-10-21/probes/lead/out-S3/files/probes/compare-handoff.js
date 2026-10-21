const fs = require('fs');
const path = require('path');
const defs = require('/tmp/s85-scratch/S3/probes/base-definitions.json');
const dir = '/tmp/s85-scratch/S3/handoff/tools-1/tools';
const strings = require('/tmp/s85-scratch/S3/handoff/tools-1/strings.json');

function lookup(schema, keyPath) {
  let node = schema;
  for (const seg of keyPath.split('.')) {
    const arr = seg.endsWith('[]');
    const name = arr ? seg.slice(0, -2) : seg;
    if (node.properties === undefined || node.properties[name] === undefined) throw new Error('no property ' + name + ' in ' + keyPath);
    node = node.properties[name];
    if (arr) node = node.items;
  }
  return node;
}
// collect every description path in a schema
function collect(schema, prefix, out) {
  if (schema === null || typeof schema !== 'object') return;
  if (typeof schema.description === 'string') out[(prefix || '<root>')] = schema.description;
  if (schema.properties) for (const [k, v] of Object.entries(schema.properties)) collect(v, prefix ? prefix + '.' + k : k, out);
  if (schema.items) collect(schema.items, prefix + '[]', out);
  // anyOf/oneOf branches: only recurse when the node itself has no description (avoid duplicate shape noise)
  for (const key of ['anyOf', 'oneOf']) if (Array.isArray(schema[key])) for (const branch of schema[key]) collect(branch, prefix, out);
}
let failures = 0;
const sharedPaths = { 'propose_future_plan': ['expected[].ref', 'expected[].revision'], 'apply_future_plan': ['expected[].ref', 'expected[].revision'] };
const seenShared = new Set();
for (const [name, def] of Object.entries(defs)) {
  const file = path.join(dir, name + '.json');
  if (!fs.existsSync(file)) { console.log('MISSING', name); failures++; continue; }
  const hand = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (hand.description !== def.description) { console.log('DESC MISMATCH', name); failures++; }
  const collected = {}; collect(def.schema, '', collected);
  for (const p of sharedPaths[name] || []) {
    const actual = lookup(def.schema, p).description;
    const key = 'toolSchema.whiteboardPin.' + p.split('.').pop();
    seenShared.add(key);
    if (strings[key] !== actual) { console.log('SHARED MISMATCH', name, p, JSON.stringify(strings[key]), '!=', JSON.stringify(actual)); failures++; }
    delete collected[p];
  }
  for (const [p, text] of Object.entries(hand.parameters)) {
    const actual = lookup(def.schema, p).description;
    if (actual !== text) { console.log('PARAM MISMATCH', name, p); failures++; }
    delete collected[p];
  }
  const extra = Object.keys(collected);
  // schema description at '<root>' may exist if the whole schema was described (none)
  if (extra.length) { console.log('UNHANDOFFED DESCRIPTIONS', name, extra); failures++; }
}
const unusedShared = Object.keys(strings).filter(k => !seenShared.has(k));
if (unusedShared.length) { console.log('UNUSED STRINGS', unusedShared); failures++; }
if (Object.keys(defs).length !== 16) { console.log('TOOL COUNT', Object.keys(defs).length); failures++; }
console.log(failures === 0 ? 'OK: 16 tools, all descriptions and parameter texts match the base definitions byte-for-byte' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
