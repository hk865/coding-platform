/**
 * The hosts one Run's commands reached, or were refused, through the platform's command proxy (decision 121-112:
 * the public internet is open, and every Run keeps the list of hosts its commands connected to). A Work Run and a
 * QueryRun each have at most one record, keyed by its own tagged ref whose `subject` is the execution ref.
 *
 * The proxy writes an entry BEFORE it connects, so the list survives a Host crash: an unknown-call review, which
 * is only built after a restart, copies the first `RUN_NETWORK_REVIEW_HOSTS_CAP` entries into its `network` member
 * for the adviser and the person. Only host names, ports and addresses are kept: a path or query string may carry
 * a token.
 */
import { defineEvent, defineRecord, defineShape, f, type InferRecord, type InferShape } from './data-format.js';
import { ExecutionRefField, id } from './data-format-refs.js';

/** One record keeps at most this many distinct (host, port, verdict) entries; later distinct ones are only counted. */
export const RUN_NETWORK_HOSTS_CAP = 200;
/** The entries an unknown-call review copies (the review has a creation budget, `state/unknown-call-review.ts`). */
export const RUN_NETWORK_REVIEW_HOSTS_CAP = 32;

/** A DNS name is at most 253 bytes; an IP literal is shorter. */
const hostText = f.string({ min: 1, max: 253, unit: 'utf8Bytes' });
const HostFields = {
  /** What the command asked for: a lowercase name or IP literal (IPv6 without brackets). */
  host: hostText,
  port: f.integer({ min: 1, max: 65_535 }),
  /** The checked IP: for `allowed` the one the proxy connected to, for `refused` the first one resolved. */
  address: hostText,
  /** `allowed`: the platform let it through and started connecting (not a proof that the connection opened). */
  verdict: f.enumOf(['allowed', 'refused'] as const),
  /** Host clock of the first time this entry was seen. */
  firstAt: f.isoTime(),
};
export const RunNetworkHostShape = defineShape({ name: 'RunNetworkHost', fields: HostFields });
export type RunNetworkHostV1 = InferShape<typeof HostFields>;

export const RunNetworkRefShape = defineShape({
  name: 'RunNetworkRef', fields: { aggregateType: f.literal('RunNetwork'), subject: ExecutionRefField },
});
export const RunNetworkFormat = defineRecord({
  name: 'RunNetwork', schemaId: 'RunNetwork@1', aggregateType: 'RunNetwork',
  fields: {
    ref: f.ref(RunNetworkRefShape),
    revision: f.revision({ min: 1 }),
    // First-seen order; each (host, port, verdict) once.
    hosts: f.array(f.object(HostFields), { max: RUN_NETWORK_HOSTS_CAP }),
    // Distinct entries past the cap.
    omitted: f.integer({ min: 0 }),
    updatedAt: f.isoTime(),
  },
  // No lookups: the record is read by its ref (key = canonicalJson(ref)).
});
export type RunNetworkRef = InferShape<(typeof RunNetworkRefShape)['fields']>;
export type RunNetworkSnapshotV1 = InferRecord<(typeof RunNetworkFormat)['fields']>;

/** The copy an unknown-call review carries: the first entries, the rest counted in `omitted`. */
export const RunNetworkReviewCopyShape = defineShape({
  name: 'RunNetworkReviewCopy',
  fields: { hosts: f.array(f.object(HostFields), { max: RUN_NETWORK_REVIEW_HOSTS_CAP }), omitted: f.integer({ min: 0 }) },
});
export type RunNetworkReviewCopyV1 = InferShape<(typeof RunNetworkReviewCopyShape)['fields']>;

/** The replay event of one write: the entry that was noted and the revision it produced. */
export const RunNetworkHostNotedFormat = defineEvent({
  name: 'RunNetworkHostNoted', eventType: 'RunNetworkHostNoted', schemaVersion: 1,
  fields: { projectId: id, ref: f.ref(RunNetworkRefShape), revision: f.integer({ min: 1 }), entry: f.object(HostFields) },
});
