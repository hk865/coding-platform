import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const before = readFileSync('evidence/collaboration-memory/batch/post-m-architecture/read-model-index-before.txt', 'utf8');
const method = before.slice(before.indexOf('private isHandledEventType'));
const eventTypes = [...new Set([...method.matchAll(/eventType === ["']([^"']+)["']/g)].map((match) => match[1]))];
const set = new Set(eventTypes);
const queries = Array.from({ length: 1_000_000 }, (_, index) => index % 5 === 0 ? 'UnknownEvent' : eventTypes[index % eventTypes.length]);
const measure = (name, predicate) => {
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  let accepted = 0;
  for (const query of queries) if (predicate(query)) accepted++;
  const elapsedMs = performance.now() - started;
  return { name, elapsedMs, accepted, operationsPerSecond: Math.round(queries.length / (elapsedMs / 1000)), heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore };
};
const report = {
  fixture: { handledEventTypes: eventTypes.length, lookups: queries.length, misses: queries.filter((query) => query === 'UnknownEvent').length },
  beforeEquivalent: measure('linear comparison chain / includes', (eventType) => eventTypes.includes(eventType)),
  afterEquivalent: measure('shared Set.has', (eventType) => set.has(eventType)),
  limitation: 'Isolates the handled-event membership rule. Adapter projection and query costs are measured separately by targeted suites and shared-projection.test.ts.',
};
writeFileSync('evidence/collaboration-memory/batch/post-m-architecture/handled-event-benchmark.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
