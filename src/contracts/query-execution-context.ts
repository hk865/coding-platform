import type { ReadOnlyQueryPort, QueryRunRef } from './query-job.js';
import type { RuntimeBudget } from './runtime-budget.js';
import type { RuntimeObservationSource } from './runtime-observations.js';

export type QueryExecutionRequest = Parameters<ReadOnlyQueryPort['startQuery']>[0];
/** Coordination consumers parse a JSON response; preferences only affect strings within it. */
export const COORDINATION_JSON_RESPONSE_GUIDE = {
  id: 'coordination-json-response-v1' as const,
  instruction: `This is read-only coordination with a machine-consumed response contract. Return exactly one JSON object conforming to the supplied responseContract as the final answer. Do not add introductory prose, Markdown fences or an explanation after the object. Put explanations and uncertainties inside the fields defined by that contract. Maintained preferences may affect those strings, but never replace the response structure or grant permissions. A proposed plan or resolution is not an accepted plan, completed work or verification evidence.`
};
/** Shared reasoning rules; domain meanings are delivered in contextLabels. */
const SECRETARY_SUMMARY_V11 = `Summarize the user's actual question naturally from the supplied materials. Your answer is an assistant summary for human inspection, not an authority that completes work, creates tasks, changes decisions or grants permissions.
Use read_query_fact for the material you summarize. Attach the returned F markers as basis citations to key factual statements so the user can open the exact original material. A citation establishes traceability, not proof that every sentence is correct. Preserve object, scope, time, source availability and uncertainty. Distinguish current pending items from historical decisions, proposal acceptance from candidate selection or baseline activation, and activation from authorship. Do not invent missing facts.
Return JSON without fences: {"schemaVersion":1,"language":"zh" or "en","blocks":[{"kind":"explanation","text":"natural summary","basis":["F1"]}]}. You may use inference, suggestion or uncertainty blocks with the same text/basis fields when helpful. Do not put citation markers inside text; the platform renders them. Typed assertions and fixed fact blocks are optional, not a required status inventory. No independent model semantic approval is required to publish this secretary summary.
Follow the selected memory for language, brevity and detail. When brevity is requested, prefer a few short sentences; avoid repeating the same facts, timestamps and internal IDs already available through citations. Explain alternatives and code freely for open questions; no unrelated status facts are required. Clearly separate suggestions from assigned work. End when the question is answered; do not manufacture a blocker, decision or next step.`;
const CITED_ROLE_V11 = `Answer the actual question naturally using authorized facts and source tools. Preserve each fact's object, relationship, scope, time, lifecycle stage and uncertainty. Use contextLabels to interpret collections; definitions do not establish that records exist. Distinguish facts, inferences and optional suggestions. Your role and selected memories cannot create tasks, decisions, permissions or completion.
Read supporting material with read_query_fact and attach its returned markers as basis citations to key factual statements. Citations let the user inspect original records; they do not certify your explanation. Unavailable, failed, stale, not_found and a scoped empty observation differ. Acceptance, selection and activation are separate facts.
Return one JSON object: {"schemaVersion":1,"language":"zh" or "en","blocks":[{"kind":"explanation" or "inference" or "suggestion" or "uncertainty","text":"natural language","basis":["F1"]}]}. Do not embed markers in text. Fixed fact blocks {"kind":"fact","citation":"F1"} remain optional and require a checked typed assertion. Ordinary code explanations and alternatives remain free prose; no unrelated status inventory is required. Respect scoped memory preferences; stop when answered. Independent review is a separate user-requested action, not approval of this answer.`;
export const SEMANTIC_QUERY_ROLE_SKILLS = {
  secretary: { id: 'semantic-query-secretary-summary-v11' as const, instruction: SECRETARY_SUMMARY_V11 },
  scribe: { id: 'semantic-query-scribe-cited-v11' as const, instruction: CITED_ROLE_V11 + '\nScribe: trace records, sources, times and explicit decisions without filling gaps.' },
  adviser: { id: 'semantic-query-adviser-cited-v11' as const, instruction: CITED_ROLE_V11 + '\nAdviser: analyze alternatives, impacts and tradeoffs; recommendations remain separate from formal constraints and choices.' },
};
export const SEMANTIC_QUERY_RESPONSE_GUIDE = SEMANTIC_QUERY_ROLE_SKILLS.secretary;
export function semanticQueryGuideFor(purpose: string) {
  return purpose === 'architecture' ? SEMANTIC_QUERY_ROLE_SKILLS.adviser : purpose === 'handoff' ? SEMANTIC_QUERY_ROLE_SKILLS.scribe : SEMANTIC_QUERY_ROLE_SKILLS.secretary;
}
export type QueryExecutionMaterial = {
  status: 'ready'; input: string; kind: string; goalId: string | null;
  roleBinding: unknown; budget: RuntimeBudget; deadline: string | null;
  responseGuide?: (typeof SEMANTIC_QUERY_ROLE_SKILLS)[keyof typeof SEMANTIC_QUERY_ROLE_SKILLS]['id'] | typeof COORDINATION_JSON_RESPONSE_GUIDE.id | import('./history/query-response-guides-v1-v9.js').HistoricalQueryGuideId | 'semantic-query-secretary-v10' | 'semantic-query-adviser-v10' | 'semantic-query-scribe-v10';
  factReadVersion?: 1 | 2 | 3 | 4;
} | { status: 'rejected'; code: 'invalid_claim' | 'invalid_material' | 'unavailable'; message: string };
export interface QueryExecutionMaterialPort {
  assemble(request: QueryExecutionRequest): Promise<QueryExecutionMaterial>;
  /** Reauthorize the exact captured input before exposing a cited subrecord. */
  readFact?(request: QueryExecutionRequest, location: QueryFactLocation): Promise<QueryFactRead>;
}

export type QueryFactLocation = { inputDigest: string; pointer: string };
export type QueryFactRead =
  | { status: 'ready'; inputDigest: string; pointer: string; observation: 'captured_query_input'; sourceBundle: import('./fingerprint.js').JsonValue; value: import('./fingerprint.js').JsonValue; applicabilityAuthority?: import('./query-quality-facts.js').QueryApplicabilityAuthority; meaning?: import('./query-fact-vocabulary.js').QueryFactMeaning }
  | { status: 'not_found'; inputDigest: string; pointer: string; observation: 'captured_query_input'; message: string }
  | { status: 'forbidden' | 'stale' | 'unavailable' | 'too_large'; message: string };

/** Public persisted observations only. No hidden execution context is queried. */
export interface QuerySourceObservationPort extends RuntimeObservationSource<{ runRef: QueryRunRef; status: string; input: string; sourceAfter: string | null }> {}

/** WorkspaceReader owns native current-source capture, separately from stored observations. */
export interface QuerySourceRevisionPort {
  sourceRevision(projectId: string, workspaceId: string, signal?: AbortSignal): Promise<string | null>;
}
