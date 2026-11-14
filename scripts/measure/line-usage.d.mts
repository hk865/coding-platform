import type {
  LineUsageSampleV1,
  LineUsageV1,
} from '../../src/core/work-graph/views/activity-read-model.js';
import type { QueryRunSnapshot } from '../../src/contracts/query-job.js';
import type { SessionPage } from '../../src/core/work-graph/model/session-contracts.js';

// Script-local type, not a public contract: samples carry endedAt so the report
// can align compaction records with rounds.
export type LineUsageRowSample = LineUsageSampleV1 & { endedAt: string | null };

export function queryLineUsageOf(pages: readonly SessionPage<QueryRunSnapshot>[]): {
  usage: LineUsageV1;
  samples: readonly LineUsageRowSample[];
};

export function p50p95Of(samples: readonly number[]): {
  p50: number | null;
  p95: number | null;
  n: number;
  verdict: 'ok' | 'insufficient';
};

export function overCompactionTriggerOf(compacted: number, turns: number): number | null;
