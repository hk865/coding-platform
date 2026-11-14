// The event-loop lag probe (S9-N10: "加事件循环延迟探针"; record only, no threshold, no verdict).
// Loaded into each Host process through `NODE_OPTIONS=--import=<this file>` with `G6_LAG_FILE` set by the driver;
// it samples with `perf_hooks.monitorEventLoopDelay` and rewrites one JSON summary every 15 s and at exit.
// The two variables are removed from the Host's own environment right away, so no process the Host starts
// (Kernel commands, `node --test` in a workspace) inherits the preload.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { readFileSync, writeFileSync } from 'node:fs';

const ms = nanoseconds => Math.round(nanoseconds / 1e4) / 100;

function summary(histogram, startedAt) {
  return {
    startedAt, writtenAt: new Date().toISOString(), samples: histogram.count,
    p50Ms: ms(histogram.percentile(50)), p95Ms: ms(histogram.percentile(95)), p99Ms: ms(histogram.percentile(99)),
    maxMs: ms(histogram.max), meanMs: ms(histogram.mean),
  };
}

const target = process.env.G6_LAG_FILE;
if (target !== undefined && target.length > 0) {
  delete process.env.G6_LAG_FILE;
  delete process.env.NODE_OPTIONS;
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  const startedAt = new Date().toISOString();
  const dump = () => writeFileSync(target, `${JSON.stringify(summary(histogram, startedAt))}\n`);
  setInterval(dump, 15_000).unref();
  process.on('exit', dump);
}

/** The driver side: the last summary a Host wrote, or null when it wrote none. */
export function readLag(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}
