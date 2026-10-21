// Byte-for-byte comparison of two probe logs. No sorting, no canonicalisation.
// Prints the first differing offset, both lengths and 16 bytes on each side.
import { readFileSync } from 'node:fs';

const [leftPath, rightPath] = process.argv.slice(2);
if (leftPath === undefined || rightPath === undefined) {
  console.error('usage: node compare.mjs <left-log> <right-log>');
  process.exit(2);
}

const left = readFileSync(leftPath);
const right = readFileSync(rightPath);

const hex = (buffer) => buffer.toString('hex').match(/../g)?.join(' ') ?? '';

if (left.equals(right)) {
  console.log(`IDENTICAL bytes=${String(left.length)}`);
  process.exit(0);
}

let offset = 0;
while (offset < Math.min(left.length, right.length) && left[offset] === right[offset]) offset += 1;

const leftAround = left.subarray(Math.max(0, offset - 16), offset + 16);
const rightAround = right.subarray(Math.max(0, offset - 16), offset + 16);
console.log(`DIFF offset=${String(offset)} leftLength=${String(left.length)} rightLength=${String(right.length)}`);
console.log(`left[${String(Math.max(0, offset - 16))}..${String(offset + 16)}] ${hex(leftAround)}`);
console.log(`right[${String(Math.max(0, offset - 16))}..${String(offset + 16)}] ${hex(rightAround)}`);
process.exit(1);
