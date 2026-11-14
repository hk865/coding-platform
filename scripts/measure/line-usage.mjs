// Line-usage aggregation for the S9 G7 report. Pure ESM: no src runtime import,
// no dist, no network, no file writes. Importing this module runs nothing; the
// guarded CLI below only reads the JSON document the report runner supplies.
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const OVER_THRESHOLD_INPUT_TOKENS = 500_000;

export function queryLineUsageOf(pages) {
  const items = pages.flatMap((page) => page.items);
  if (items.length === 0) {
    throw new Error('queryLineUsageOf needs at least one query page item');
  }
  const withState = items.filter((item) => item.run.executionState !== undefined);
  if (withState.length === 0) {
    throw new Error('queryLineUsageOf needs at least one QueryRun with executionState');
  }
  // The line's head is the Session of its newest QueryRun. A predecessor Session's
  // pages may arrive in the same input (the line read in src queries the head only);
  // they are not rounds of this line (draft §3 M1-①). The fixture clock fixes every
  // `endedAt`, so ties fall back to the newest generation.
  const headState = withState.reduce((newest, item) => {
    const at = item.run.endedAt ?? '';
    const newestAt = newest.run.endedAt ?? '';
    if (at !== newestAt) return at > newestAt ? item : newest;
    return item.run.executionState.sessionGeneration > newest.run.executionState.sessionGeneration
      ? item : newest;
  }).run.executionState;
  const rounds = [];
  for (const item of withState) {
    const state = item.run.executionState;
    if (state.sessionRef.sessionId !== headState.sessionRef.sessionId) continue;
    rounds.push({
      sessionGeneration: state.sessionGeneration,
      ref: item.ref,
      endedAt: item.run.endedAt,
      requests: state.requests.map((request) => ({
        requestId: request.requestId,
        inputTokens: request.inputTokens,
        cachedInputTokens: request.cachedInputTokens,
        usageStatus: request.usageStatus === 'reported' ? 'reported' : 'unknown',
      })),
    });
  }

  // Mirrors src/core/work-graph/views/activity-read-model.ts `latestSampledRoundOf`
  // (same rule, two runtimes): stable newest-generation-first; in the first round
  // with a non-null request, walk requests[] last-to-first and take the first
  // non-null input. src cannot import .mjs and tests do not build, so this small
  // selection loop is deliberately duplicated; the src comment points back here.
  const ordered = rounds
    .map((round, index) => ({ round, index }))
    .sort((a, b) => {
      if (b.round.sessionGeneration !== a.round.sessionGeneration) {
        return b.round.sessionGeneration - a.round.sessionGeneration;
      }
      return a.index - b.index;
    })
    .map(({ round }) => round);

  const samples = [];
  const sourceRefs = [];
  let prefixHasUnknown = false;
  let newerUnsampled = false;
  let selected = null;
  for (const round of ordered) {
    for (const request of round.requests) {
      if (request.usageStatus === 'unknown') prefixHasUnknown = true;
    }
    let chosen = null;
    for (let i = round.requests.length - 1; i >= 0; i -= 1) {
      if (round.requests[i].inputTokens !== null) {
        chosen = round.requests[i];
        break;
      }
    }
    if (chosen === null) {
      newerUnsampled = true;
      continue;
    }
    const sample = {
      sessionGeneration: round.sessionGeneration,
      requestId: chosen.requestId,
      inputTokens: chosen.inputTokens,
      cachedInputTokens: chosen.cachedInputTokens,
      usageStatus: chosen.usageStatus,
      complete: !prefixHasUnknown && !newerUnsampled,
      endedAt: round.endedAt,
    };
    samples.push(sample);
    sourceRefs.push({ runRef: round.ref, requestId: chosen.requestId });
    if (selected === null) selected = sample;
  }

  const observedRounds = samples.length;
  return {
    usage: {
      lineKey: headState.sessionRef,
      headSessionRef: headState.sessionRef,
      lastInputTokens: selected === null ? null : selected.inputTokens,
      lastCachedInputTokens: selected === null ? null : selected.cachedInputTokens,
      hitRate: selected === null || selected.cachedInputTokens === null
        ? null
        : selected.cachedInputTokens / selected.inputTokens,
      observedRounds,
      overThresholdRounds: samples.filter(
        (sample) => sample.inputTokens >= OVER_THRESHOLD_INPUT_TOKENS,
      ).length,
      usageStatus: selected === null ? 'unknown' : selected.usageStatus,
      complete: selected === null ? false : selected.complete,
      basis: selected === null ? 'run_total' : 'latest',
      sourceRefs,
    },
    samples,
  };
}

export function p50p95Of(samples) {
  const n = samples.length;
  // Fewer than ten observations is "insufficient to judge", never zero.
  if (n < 10) return { p50: null, p95: null, n, verdict: 'insufficient' };
  const sorted = [...samples].sort((a, b) => a - b);
  const nearestRank = (q) => sorted[Math.ceil(q * n) - 1];
  return { p50: nearestRank(0.5), p95: nearestRank(0.95), n, verdict: 'ok' };
}

export function overCompactionTriggerOf(compacted, turns) {
  if (turns === 0) return null;
  return compacted / turns;
}

/** One report row per line; the runner supplies the public pages and history entries. */
function reportRowOf(line) {
  const { usage, samples } = queryLineUsageOf(line.pages);
  const { p50, p95 } = p50p95Of(samples.map((sample) => sample.inputTokens));
  return {
    lineKey: usage.lineKey,
    headSessionRef: usage.headSessionRef,
    usage,
    samples,
    p50,
    p95,
    overCompactionTrigger: overCompactionTriggerOf(line.compacted ?? 0, line.turns ?? 0),
    failedCompactions: line.failedCompactions ?? 0,
    compactions: line.compactions ?? [],
  };
}

function tableOf(rows) {
  const cell = (value) => (value === null || value === undefined ? '' : String(value));
  return [
    '| line | lastInputTokens | lastCachedInputTokens | hitRate | over/observed | complete | basis | p50 | p95 | overCompactionTrigger | failedCompactions |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((row) => `| ${cell(row.headSessionRef?.sessionId)} | ${cell(row.usage.lastInputTokens)} | ${cell(row.usage.lastCachedInputTokens)} | ${cell(row.usage.hitRate)} | ${cell(`${row.usage.overThresholdRounds}/${row.usage.observedRounds}`)} | ${cell(row.usage.complete)} | ${cell(row.usage.basis === 'run_total' ? 'mixed basis: Run total' : row.usage.basis)} | ${cell(row.p50)} | ${cell(row.p95)} | ${cell(row.overCompactionTrigger)} | ${cell(row.failedCompactions)} |`),
  ].join('\n');
}

async function writeReport(outDir, rows) {
  await mkdir(join(outDir, 'raw'), { recursive: true });
  await writeFile(join(outDir, 'raw', 'lines.jsonl'),
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  await writeFile(join(outDir, 'result.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), lines: rows }, null, 2)}\n`);
  await writeFile(join(outDir, 'README.md'), `${tableOf(rows)}\n`);
}

// CLI: node scripts/measure/line-usage.mjs <input.json> [outDir]. Reads
// `{ lines: [{ pages, compacted?, turns?, failedCompactions?, compactions? }] }`
// (the public pages/history the G6 report runner already read) and either prints
// the K2 table or writes raw/lines.jsonl, result.json and README.md. The route
// transport itself belongs to that runner; this module opens no database.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const rows = input.lines.map(reportRowOf);
  if (process.argv[3] !== undefined) await writeReport(process.argv[3], rows);
  else console.log(tableOf(rows));
}
