import type { AlternativeReportCandidate, AlternativeReportObservationPort } from '../contracts/alternative-report.js';
import type { WaitConditionSnapshot } from '../contracts/coordination.js';
import type { RunSnapshot } from '../contracts/dispatch.js';
import { canonicalJson, sha256Hex } from '../contracts/fingerprint.js';
import { randomUUID } from 'node:crypto';

/** Host-owned, one-use observations. Control only reads a completed inspection;
 * it never calls Context/Vault, even indirectly through an injected callback. */
export class AlternativeReportObservation implements AlternativeReportObservationPort {
  private readonly observations = new Map<string, { key: string; value: Awaited<ReturnType<AlternativeReportObservationPort['observe']>> }>();
  private key(wait: WaitConditionSnapshot, predecessor: RunSnapshot, candidates: AlternativeReportCandidate[]) {
    return sha256Hex(canonicalJson({ wait, predecessor: { ref: predecessor.ref, revision: predecessor.revision }, candidates }));
  }
  record(wait: WaitConditionSnapshot, predecessor: RunSnapshot, candidates: AlternativeReportCandidate[], observation: Awaited<ReturnType<AlternativeReportObservationPort['observe']>>) {
    if (this.observations.size >= 64) this.observations.clear();
    const token = randomUUID();
    this.observations.set(token, { key: this.key(wait, predecessor, candidates), value: structuredClone(observation) });
    return { token, dispose: () => { this.observations.delete(token); } };
  }
  async observe(wait: WaitConditionSnapshot, predecessor: RunSnapshot, candidates: AlternativeReportCandidate[], token?: string): ReturnType<AlternativeReportObservationPort['observe']> {
    const observation = token ? this.observations.get(token) : undefined;
    if (token) this.observations.delete(token);
    return observation?.key === this.key(wait, predecessor, candidates) ? observation.value
      : { status: 'unavailable', reason: 'No fresh Host inspection for this attempt and these exact report versions; prepare again' };
  }
}
