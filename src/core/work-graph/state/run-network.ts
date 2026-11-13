/**
 * A Run's host record (`../../../contracts/run-network.ts`): the next value after one noted entry, and the copy an
 * unknown-call review carries.
 *
 * An entry is identified by (host, port, verdict): the same host and port refused once and allowed later are two
 * entries; the address and time of a later sighting do not change the first one. Past the cap a new entry only
 * counts in `omitted`; the owner's write identity is the same triple, so a repeat of a counted entry replays its
 * receipt instead of counting twice.
 *
 * Pure: imports only `src/contracts`.
 */
import type { QueryRunRef } from '../../../contracts/query-job.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import {
  RUN_NETWORK_HOSTS_CAP, RUN_NETWORK_REVIEW_HOSTS_CAP,
  type RunNetworkHostV1, type RunNetworkReviewCopyV1, type RunNetworkSnapshotV1,
} from '../../../contracts/run-network.js';

/** Add one entry: an entry already there leaves the record unchanged; at the cap only `omitted` grows. */
export function nextRunNetwork(
  current: RunNetworkSnapshotV1 | null,
  input: { subject: RunRef | QueryRunRef; entry: RunNetworkHostV1; at: string },
): { changed: false } | { changed: true; next: RunNetworkSnapshotV1 } {
  const hosts = current?.hosts ?? [];
  const { entry } = input;
  if (hosts.some(known => known.host === entry.host && known.port === entry.port && known.verdict === entry.verdict)) {
    return { changed: false };
  }
  const full = hosts.length >= RUN_NETWORK_HOSTS_CAP;
  return {
    changed: true,
    next: {
      ref: { aggregateType: 'RunNetwork', subject: input.subject },
      revision: (current?.revision ?? 0) + 1,
      hosts: full ? [...hosts] : [...hosts, { ...entry }],
      omitted: (current?.omitted ?? 0) + (full ? 1 : 0),
      updatedAt: input.at,
    },
  };
}

/** The review's copy: the first `RUN_NETWORK_REVIEW_HOSTS_CAP` entries, the rest added to `omitted`. No record is
 *  no host (a command that never asked the proxy). */
export function runNetworkReviewCopy(snapshot: RunNetworkSnapshotV1 | null): RunNetworkReviewCopyV1 {
  if (snapshot === null) return { hosts: [], omitted: 0 };
  return {
    hosts: snapshot.hosts.slice(0, RUN_NETWORK_REVIEW_HOSTS_CAP),
    omitted: snapshot.omitted + Math.max(0, snapshot.hosts.length - RUN_NETWORK_REVIEW_HOSTS_CAP),
  };
}
