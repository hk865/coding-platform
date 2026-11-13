/**
 * NB-02 (netb-start-rulings §2.1 `nextRunNetwork`, `runNetworkReviewCopy`; A5 pure table): one Run's host record
 * keeps each (host, port, verdict) once in first-seen order, stops listing at 200 and only counts the rest, and the
 * copy taken into an unknown-call review keeps the first 32 and counts the others. Snapshots are folded through the
 * rule itself, so their `ref` is the one the rule builds; ⑤ then sets `omitted` on that input.
 *
 * Red today: the imports of `src/core/work-graph/state/run-network.ts` and `src/contracts/run-network.ts` (neither
 * exists), every cell. Green after B1.
 * Named mutations: de-duplicate by host alone (③ red); no cap (④ red: 201 hosts, omitted 0); the copy does not add
 * the dropped entries to `omitted` (⑤ red: omitted 3).
 */
import { expect, it } from 'vitest';
import type { RunNetworkHostV1, RunNetworkSnapshotV1 } from '../../src/contracts/run-network.js';
import { nextRunNetwork, runNetworkReviewCopy } from '../../src/core/work-graph/state/run-network.js';

const AT = '2026-11-13T01:00:00.000Z';
const RUN = { aggregateType: 'Run' as const, projectId: 'netb-project', goalId: 'netb-goal', runId: 'netb-run' };
const entry = (port: number, verdict: RunNetworkHostV1['verdict'] = 'allowed'): RunNetworkHostV1 =>
  ({ host: 'pkg.example', port, address: '93.184.216.34', verdict, firstAt: AT });
const ports = (count: number): RunNetworkHostV1[] => Array.from({ length: count }, (_, index) => entry(index + 1));
const add = (current: RunNetworkSnapshotV1 | null, next: RunNetworkHostV1) =>
  nextRunNetwork(current, { subject: RUN, entry: next, at: AT });

const fold = (entries: readonly RunNetworkHostV1[]): RunNetworkSnapshotV1 | null => entries.reduce<RunNetworkSnapshotV1 | null>(
  (current, next) => { const step = add(current, next); return step.changed ? step.next : current; }, null);

it.each<[string, () => unknown, unknown]>([
  ['① the first entry starts the record at revision 1', () => add(null, entry(80)),
    { changed: true, next: { revision: 1, hosts: [entry(80)], omitted: 0, updatedAt: AT } }],
  ['② the same (host, port, verdict) again changes nothing', () => add(fold([entry(80)]), entry(80)), { changed: false }],
  ['③ the same host and port with the other verdict is one more entry', () => add(fold([entry(80)]), entry(80, 'refused')),
    { changed: true, next: { revision: 2, hosts: [entry(80), entry(80, 'refused')], omitted: 0 } }],
  ['④ past 200 entries only the count of the rest grows', () => add(fold(ports(200)), entry(201)),
    { changed: true, next: { hosts: ports(200), omitted: 1 } }],
  ['⑤ the review copy keeps the first 32 and counts the rest', () => runNetworkReviewCopy({ ...fold(ports(40))!, omitted: 3 }),
    { hosts: ports(32), omitted: 11 }],
])('NB-02 %s', (_, run, expected) => {
  expect(run()).toMatchObject(expected as object);
});
