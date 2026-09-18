import { toolSchema as z, type ToolDefinition } from '../../../vendor/coding-agent/dist/public-api.js';
import type { QueryFactRead } from '../../contracts/query-execution-context.js';
import { canonicalJson } from '../../contracts/fingerprint.js';
import { parseQueryAnswerPresentation, renderQueryFact } from '../../contracts/query-answer-presentation.js';
import { QUERY_FACT_ASSERTION_KINDS, queryFactAssertionMatches, queryFactNeedsAssertion, queryFactSupportedAssertions, type QueryFactAssertion } from '../../contracts/query-quality-facts.js';
import { queryReviewInput } from './query-answer-review.js';

const effects = { sideEffect: 'none' as const, changedPaths: [], workspaceRevision: null, artifactRefs: [] };
export class QueryFactPublicationError extends Error {
  constructor(readonly code: 'invalid_json' | 'invalid_structure' | 'facts_stale' | 'read_unavailable' | 'malformed_marker' | 'unknown_marker' | 'assertion_required' | 'assertion_changed' | 'citation_required', message: string, readonly marker?: string) {
    super(message); this.name = 'QueryFactPublicationError';
  }
}
/** The caller binds query identity and digest; model input selects a location only. */
export function createQueryFactTool(read: (pointer: string) => Promise<QueryFactRead>, policy: { requireAssertions?: boolean; requirePresentation?: boolean; requireCitationsForMaterialReads?: boolean } = {}) {
  const citations = new Map<string, Extract<QueryFactRead, { status: 'ready' }> & { marker: string; assertion?: QueryFactAssertion }>();
  const reads = new Map<string, Extract<QueryFactRead, { status: 'ready' }>>();
  let invalid = false;
  const inputSchema = z.object({ pointer: z.string().min(1).max(2048), assertion: z.object({ kind: z.enum(QUERY_FACT_ASSERTION_KINDS), expected: z.string().min(1).max(256) }).strict().optional() }).strict();
  const tool: ToolDefinition = {
    name: 'read_query_fact',
    description: 'Read an authorized captured fact or applicable memory using its RFC6901 pointer, e.g. /material/goalPhase. Cite only a returned [F1] marker. If assertionRequired is true, repeat this pointer with a supportedAssertions entry matching the state you intend to cite; no marker is assigned before that check. An empty list means select a complete specific child record. Assertions include observation_status, goal_phase, task_phase, run_status (starting/running/ended), run_outcome (completed/failed/cancelled/budget_exhausted/crashed/outcome_unknown), decision_outcome, selected_option, baseline_activation, pending_human_action, source_applicability verification_outcome, and task_dependencies (read the complete acceptedPlan; expected is the taskId whose exact dependency kinds are requested). Run ended/completed is not Task satisfaction or Goal completion. Assertions validate structured state only, not your prose, inferred dependencies, global absence, or live source acceptance. Unavailable is unknown; not_found is limited to the stated scope. Preserve object/time/scope/certainty. Oversized records need a narrower pointer.',
    inputSchema, effectClass: 'read_only', requiredCapabilities: ['workspace_read'],
    defaultTimeoutMs: 10000, outputLimitBytes: 20 * 1024, independentReadOnly: true,
    summarize: () => ({ paths: [], cwd: null, commandPreview: null }),
    handler: { execute: async (call, options) => {
      const cancelled = () => ({ schemaVersion: 1 as const, callId: call.callId, status: 'cancelled' as const, reason: 'Query cancelled', output: [], effects });
      if (options.signal.aborted) return cancelled();
      try {
        const { pointer, assertion } = inputSchema.parse(call.arguments);
        const fact = await read(pointer);
        if (options.signal.aborted) return cancelled();
        if (fact.status === 'stale' || fact.status === 'unavailable') invalid = true;
        let value: QueryFactRead & { marker?: string; assertion?: QueryFactAssertion; check?: string; assertionRequired?: boolean; supportedAssertions?: QueryFactAssertion[] } = fact;
        if (fact.status === 'ready') {
          if (!reads.has(pointer) && reads.size >= 24) throw Error('Fact record capacity reached');
          const priorRead = reads.get(pointer);
          if (priorRead && canonicalJson(priorRead) !== canonicalJson(fact)) { invalid = true; throw Error('Read fact changed'); }
          reads.set(pointer, structuredClone(fact));
          const presentable = (assertion: QueryFactAssertion) => {
            if (!policy.requirePresentation) return true;
            try { renderQueryFact({ ...fact, marker: 'F1', assertion }, 'en'); return true; } catch { return false; }
          };
          const supportedAssertions = queryFactSupportedAssertions(fact.value, fact.applicabilityAuthority).filter(presentable);
          if (assertion && (!queryFactAssertionMatches(fact.value, assertion, fact.applicabilityAuthority) || !presentable(assertion))) return {
            schemaVersion: 1, callId: call.callId, status: 'error',
            error: { code: 'execution_failed', message: 'Declared assertion is not supported at this authority location. Use a supported assertion or read the complete authority record with its scope and applicability; for Task acceptance use the parent collaborationWork item, not its bare reduction. No citation was established.', retryable: false },
            output: [{ kind: 'json', value: { ...fact, assertionRequired: true, supportedAssertions } }], effects,
          } as never;
          if (policy.requireAssertions && queryFactNeedsAssertion(pointer, fact.value) && !assertion) return {
            schemaVersion: 1, callId: call.callId, status: 'success',
            output: [{ kind: 'json', value: { ...fact, assertionRequired: true, supportedAssertions } }], effects,
          } as never;
          const key = assertion ? canonicalJson({ pointer, assertion }) : pointer;
          if (!citations.has(key) && citations.size >= 24) throw Error('Citation record capacity reached; reuse relevant citations.');
          const marker = citations.get(key)?.marker ?? `F${citations.size + 1}`;
          const previous = citations.get(key);
          if (previous && canonicalJson(previous.value) !== canonicalJson(fact.value)) { invalid = true; throw Error('Cited fact changed.'); }
          citations.set(key, { ...structuredClone(fact), marker, ...(assertion ? { assertion } : {}) });
          value = { ...fact, marker, ...(assertion ? { assertion, check: 'structured-state-only' } : { assertionRequired: !!policy.requireAssertions && queryFactNeedsAssertion(pointer, fact.value) }),
            ...(policy.requirePresentation ? { presentationUse: { fact: !!assertion, basis: true },
              presentationHint: assertion ? 'This checked assertion can be a fact block or a basis citation. Free prose still requires evidence supporting its meaning.'
                : 'Basis citation only. This marker has no renderable structured assertion: do not use it in a fact block. Use it only as basis for supported explanation, inference or suggestion; this does not authorize new formal-state claims.' } : {}) };
        }
        return { schemaVersion: 1, callId: call.callId, status: 'success', output: [{ kind: 'json', value }], effects } as never;
      } catch {
        return { schemaVersion: 1, callId: call.callId, status: 'error', error: { code: 'execution_failed', message: 'Query fact lookup failed; no citation was established.', retryable: false }, output: [], effects };
      }
    } },
  };
  const sources = async (answer: string) => {
    if (invalid) throw new QueryFactPublicationError('facts_stale', 'Query facts became unavailable or stale.');
    // A model omitting its marker must not bypass revocation of material it read.
    for (const fact of reads.values()) {
      const current = await read(fact.pointer);
      if (current.status !== 'ready' || canonicalJson(current) !== canonicalJson(fact)) throw new QueryFactPublicationError('read_unavailable', 'Read input is no longer available.');
    }
    if ([...answer.matchAll(/\[F[0-9]+[^\]\r\n]*\]/g)].some(match => !/^\[F[0-9]+\]$/.test(match[0])))
      throw new QueryFactPublicationError('malformed_marker', 'Malformed fact citation marker.');
    const markers = [...new Set([...answer.matchAll(/\[(F[0-9]+)\]/g)].map(m => m[1]!))];
    if (policy.requireCitationsForMaterialReads && !markers.length && [...reads.values()].some(f => f.pointer === '/material' || f.pointer.startsWith('/material/'))) throw new QueryFactPublicationError('citation_required', 'A summary using read material requires a traceable citation.');
    const sources = [];
    for (const marker of markers) {
      const fact = [...citations.values()].find(f => f.marker === marker);
      if (!fact) throw new QueryFactPublicationError('unknown_marker', 'Answer cites a fact that was not read as a checked citation.', marker);
      if (policy.requireAssertions && queryFactNeedsAssertion(fact.pointer, fact.value) && !fact.assertion) throw new QueryFactPublicationError('assertion_required', 'High-risk citation requires a checked assertion.', marker);
      if (fact.assertion && !queryFactAssertionMatches(fact.value, fact.assertion, fact.applicabilityAuthority)) throw new QueryFactPublicationError('assertion_changed', 'Cited assertion no longer matches.', marker);
      sources.push({ kind: 'query_fact', refKey: canonicalJson({ marker, pointer: fact.pointer, inputDigest: fact.inputDigest, observation: fact.observation, sourceBundle: fact.sourceBundle,
        ...(fact.applicabilityAuthority ? { applicabilityAuthority: fact.applicabilityAuthority } : {}),
        ...(fact.meaning ? { meaning: fact.meaning } : {}),
        ...(fact.assertion ? { assertion: fact.assertion, check: 'structured-state-only' } : {}) }), version: fact.inputDigest });
    }
    return sources;
  };
  return { tool, sources, reviewInput: (presentation: import('../../contracts/query-answer-presentation.js').QueryAnswerPresentation) => queryReviewInput(presentation, [...citations.values()]), async present(raw: string) {
    let presentation: ReturnType<typeof parseQueryAnswerPresentation>;
    try { presentation = parseQueryAnswerPresentation(raw); }
    catch (error) { throw new QueryFactPublicationError(error instanceof SyntaxError ? 'invalid_json' : 'invalid_structure', 'Query answer presentation could not be parsed or validated.'); }
    const labels = presentation.language === 'zh'
      ? { explanation: '解释', inference: '推断', suggestion: '建议', uncertainty: '不确定性' }
      : { explanation: 'Explanation', inference: 'Inference', suggestion: 'Suggestion', uncertainty: 'Uncertainty' };
    const answer = presentation.blocks.map(block => {
      if (block.kind === 'fact') {
        const fact = [...citations.values()].find(f => f.marker === block.citation);
        if (!fact) throw new QueryFactPublicationError('unknown_marker', 'No checked fact for sentence', block.citation);
        if (!fact.assertion) throw new QueryFactPublicationError('assertion_required', 'A fact sentence requires a checked structured assertion; this citation is basis-only.', block.citation);
        return renderQueryFact(fact, presentation.language);
      }
      return `${labels[block.kind]}：${block.text}${block.basis.map(m => ` [${m}]`).join('')}`;
    }).join('\n\n');
    return { answer, presentation, sources: await sources(answer) };
  } };
}
