// Byte-for-byte comparison of two probe logs. No sorting, no canonicalisation.
// Prints the first differing offset, both lengths and 16 bytes on each side.
// Also counts captured lines per probe key (test name + tag + kind) in each log
// and fails when a key required by the base-run1 log -- or one of the four
// loop-result tags -- captured nothing on either side.
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
let requiredFrom = null;
let requireLoopResults = false;
const paths = [];
for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] === '--required-from') {
    requiredFrom = argv[index + 1] ?? null;
    index += 1;
  } else if (argv[index] === '--require-loop-results') {
    requireLoopResults = true;
  } else {
    paths.push(argv[index]);
  }
}
const [leftPath, rightPath] = paths;
if (leftPath === undefined || rightPath === undefined) {
  console.error('usage: node compare.mjs [--required-from <base-run1-log>] <left-log> <right-log>');
  process.exit(2);
}

const left = readFileSync(leftPath);
const right = readFileSync(rightPath);
const hex = (buffer) => buffer.toString('hex').match(/../g)?.join(' ') ?? '';

const parseCounts = (buffer) => {
  const counts = new Map();
  for (const line of buffer.toString('utf8').split('\n')) {
    if (line === '') continue;
    const fields = line.split('\t');
    // A malformed short line is still counted under its literal text so it
    // cannot silently vanish; well-formed lines key on the first three fields.
    const key = fields.length >= 3 ? fields[0] + '\t' + fields[1] + '\t' + fields[2] : line;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

const leftCounts = parseCounts(left);
const rightCounts = parseCounts(right);
const requiredSource = requiredFrom === null ? left : readFileSync(requiredFrom);
const requiredCounts = requiredFrom === null ? leftCounts : parseCounts(requiredSource);

const total = (counts) => [...counts.values()].reduce((sum, value) => sum + value, 0);
const describe = (key) => {
  const fields = key.split('\t');
  if (fields.length !== 3) return `malformed=${JSON.stringify(key)}`;
  return `test=${JSON.stringify(fields[0])} tag=${JSON.stringify(fields[1])} kind=${JSON.stringify(fields[2])}`;
};

const identical = left.equals(right);
let failed = !identical;

if (identical) {
  console.log(`IDENTICAL bytes=${String(left.length)}`);
} else {
  let offset = 0;
  while (offset < Math.min(left.length, right.length) && left[offset] === right[offset]) offset += 1;
  const leftAround = left.subarray(Math.max(0, offset - 16), offset + 16);
  const rightAround = right.subarray(Math.max(0, offset - 16), offset + 16);
  console.log(`DIFF offset=${String(offset)} leftLength=${String(left.length)} rightLength=${String(right.length)}`);
  console.log(`left[${String(Math.max(0, offset - 16))}..${String(offset + 16)}] ${hex(leftAround)}`);
  console.log(`right[${String(Math.max(0, offset - 16))}..${String(offset + 16)}] ${hex(rightAround)}`);
}

const unionKeys = [...new Set([...leftCounts.keys(), ...rightCounts.keys()])].sort();
let countMismatches = 0;
for (const key of unionKeys) {
  if ((leftCounts.get(key) ?? 0) !== (rightCounts.get(key) ?? 0)) countMismatches += 1;
}
console.log(`COUNTS leftLines=${String(total(leftCounts))} rightLines=${String(total(rightCounts))}`
  + ` probes=${String(unionKeys.length)} required=${String(requiredCounts.size)} countMismatches=${String(countMismatches)}`);

for (const key of unionKeys) {
  console.log(`  left=${String(leftCounts.get(key) ?? 0)} right=${String(rightCounts.get(key) ?? 0)} ${describe(key)}`);
}

// Every probe key that base-run1 captured must have captured at least once on
// both sides of this comparison.
for (const key of requiredCounts.keys()) {
  const leftCount = leftCounts.get(key) ?? 0;
  const rightCount = rightCounts.get(key) ?? 0;
  if (leftCount === 0 || rightCount === 0) {
    console.log(`MISSING probe ${describe(key)} left=${String(leftCount)} right=${String(rightCount)}`);
    failed = true;
  }
}

// Explicitly require the four loop-result tags when asked (run.sh does this on
// the combined per-round logs). A single proof file need not exercise all four
// loops, so this is not a per-file rule; the per-file union rule above still
// requires every key that file's base-run1 log captured.
const LOOP_RESULT_TAGS = ['calendar-result', 'run-result', 'track-result', 'timeline-result'];
for (const tag of LOOP_RESULT_TAGS) {
  const tagCount = (counts) => {
    let sum = 0;
    for (const [key, count] of counts) {
      const fields = key.split('\t');
      if (fields.length === 3 && fields[1] === tag && fields[2] === 'result') sum += count;
    }
    return sum;
  };
  const leftCount = tagCount(leftCounts);
  const rightCount = tagCount(rightCounts);
  console.log(`LOOP-RESULT tag=${JSON.stringify(tag)} kind="result" left=${String(leftCount)} right=${String(rightCount)}`
    + (requireLoopResults ? '' : ' (not required in this comparison)'));
  if (requireLoopResults && (leftCount === 0 || rightCount === 0)) {
    console.log(`MISSING probe tag=${JSON.stringify(tag)} kind="result" left=${String(leftCount)} right=${String(rightCount)}`);
    failed = true;
  }
}

if (identical && countMismatches > 0) {
  console.log(`COUNT-MISMATCH identical bytes but ${String(countMismatches)} per-probe counts differ`);
  failed = true;
}

if (failed) {
  console.log('RESULT FAIL');
  process.exit(1);
}
console.log('RESULT PASS');
process.exit(0);
