/** Q4-01: show that missing, `undefined` and `null` replay distinct. */
import { reviveUndefined } from './revive.mjs';

const lines = [
  '{"a":1}',
  '{"k":{"$probe":"undefined"},"a":2,"arr":[{"$probe":"undefined"},null]}',
  '{"k":null,"a":3}',
];
const parsed = lines.map(line => reviveUndefined(JSON.parse(line)));
for (const [index, o] of parsed.entries()) {
  const a = o.arr;
  console.log(JSON.stringify({
    line: index + 1,
    hasK: 'k' in o,
    kIsUndefined: o.k === undefined,
    kIsNull: o.k === null,
    keys: Object.keys(o),
    ...(a === undefined ? {} : { arrayLength: a.length, zeroInArray: 0 in a, oneInArray: 1 in a,
      zeroIsUndefined: a[0] === undefined, oneIsNull: a[1] === null }),
  }));
}
