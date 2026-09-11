import { createHash } from 'node:crypto';

export type ContextConsumer = 'human' | 'secretary' | 'advisor' | 'recorder' | 'planner' | 'integrator' | 'executor' | 'reviewer';
export type ContextCandidate = {
  id: string;
  kind: 'obligation' | 'permission' | 'rule' | 'decision' | 'source' | 'predecessor' | 'evidence' | 'finding' | 'history' | 'progress';
  content: string | null;
  digest: string;
  source: { ref: string; version: string; authority: string };
  required: boolean;
  consumers: ContextConsumer[];
  topics: string[];
  /** Produced by deterministic permission/version checks, never by the model. */
  eligibility: 'current' | 'historical_explanation' | 'forbidden' | 'stale' | 'unknown';
  permissionBasis: string;
  /** Different current values for the same rule key require resolution. */
  ruleKey?: string;
};
export type MaterialSelectionEntry = { id: string; selected: boolean; reason: string; digest: string; source: ContextCandidate['source']; permissionBasis: string; bytes: number; tokens: number | null; score: number; applicability: ContextCandidate['eligibility'] };
export type MaterialSelectionRequest = {
  consumer: ContextConsumer;
  topics: string[];
  capacity: { maxBytes: number; inputTokens: number | null };
  /** Omit when a model tokenizer is unavailable. Bytes never stand in as token counts. */
  countTokens?: (content: string) => number;
};
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const emphasis: Record<ContextConsumer, ContextCandidate['kind'][]> = {
  human: ['progress', 'decision', 'finding'], secretary: ['decision', 'progress', 'obligation'],
  advisor: ['decision', 'finding', 'source'], recorder: ['decision', 'evidence', 'finding'],
  planner: ['obligation', 'predecessor', 'finding'], integrator: ['predecessor', 'finding', 'evidence'],
  executor: ['obligation', 'permission', 'rule', 'source'], reviewer: ['obligation', 'source', 'evidence', 'finding'],
};

/** Select already sourced materials. Authority checks stay in their owning modules.
 * Required material is never clipped; no transcript summarization is fabricated. */
export function selectContextMaterials(candidates: ContextCandidate[], request: MaterialSelectionRequest) {
  if (!Object.hasOwn(emphasis, request.consumer) || !Number.isSafeInteger(request.capacity.maxBytes) || request.capacity.maxBytes < 1 ||
      (request.capacity.inputTokens !== null && (!Number.isSafeInteger(request.capacity.inputTokens) || request.capacity.inputTokens < 1))) throw Error('invalid context selection request');
  const seen = new Set<string>(), conflicts = new Set<string>(), rules = new Map<string, string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) throw Error('duplicate context material identity');
    seen.add(candidate.id);
    if (candidate.ruleKey && candidate.eligibility === 'current') {
      if (rules.has(candidate.ruleKey) && rules.get(candidate.ruleKey) !== candidate.digest) conflicts.add(candidate.ruleKey);
      rules.set(candidate.ruleKey, candidate.digest);
    }
  }
  const ranked = candidates.map(candidate => {
    const matches = candidate.topics.filter(topic => request.topics.includes(topic)).length;
    const score = matches * 10 + (emphasis[request.consumer].includes(candidate.kind) ? 2 : 0);
    return { candidate, score };
  }).sort((a, b) => Number(b.candidate.required) - Number(a.candidate.required) || b.score - a.score || a.candidate.id.localeCompare(b.candidate.id));
  const entries: MaterialSelectionEntry[] = [], selected: ContextCandidate[] = [], gaps: Array<{ id: string; reason: string }> = [];
  let bytes = 0, tokens = 0;
  for (const { candidate, score } of ranked) {
    const content = candidate.content, size = content === null ? 0 : Buffer.byteLength(content);
    const count = content !== null && request.countTokens ? request.countTokens(content) : null;
    if (count !== null && (!Number.isSafeInteger(count) || count < 0)) throw Error('invalid tokenizer result');
    let reason: string | null = null;
    if (!candidate.permissionBasis || !candidate.source.ref || !candidate.source.version || !candidate.source.authority) reason = 'missing_source_or_permission_basis';
    else if (candidate.eligibility === 'forbidden') reason = 'forbidden';
    else if (candidate.eligibility === 'stale' || candidate.eligibility === 'unknown') reason = candidate.eligibility;
    else if (content === null || content.length === 0) reason = 'missing_body';
    else if (hash(content) !== candidate.digest) reason = 'digest_mismatch';
    else if (candidate.ruleKey && conflicts.has(candidate.ruleKey)) reason = 'conflicting_current_rules';
    else if (candidate.required && candidate.eligibility === 'historical_explanation') reason = 'history_cannot_satisfy_current_requirement';
    else if (!candidate.consumers.includes(request.consumer)) reason = 'different_consumer';
    else if (!candidate.required && score === 0) reason = 'unrelated';
    else if (request.capacity.inputTokens !== null && count === null) reason = 'tokenizer_unavailable';
    else if (bytes + size > request.capacity.maxBytes || (count !== null && request.capacity.inputTokens !== null && tokens + count > request.capacity.inputTokens)) reason = 'capacity';
    const accepted = reason === null;
    entries.push({ id: candidate.id, selected: accepted, reason: reason ?? (candidate.required ? 'required' : 'role_and_topic_relevance'), digest: candidate.digest, source: candidate.source,
      permissionBasis: candidate.permissionBasis, bytes: size, tokens: count, score, applicability: candidate.eligibility });
    if (accepted) { selected.push(candidate); bytes += size; tokens += count ?? 0; }
    else if (candidate.required || reason === 'conflicting_current_rules') gaps.push({ id: candidate.id, reason: reason! });
  }
  return { status: gaps.length ? 'needs_material' as const : 'ready' as const, selected, entries, gaps, bytes,
    tokens: request.countTokens ? tokens : null, summaryApplied: false as const };
}
