/**
 * The one renderer of a consultation's frozen platform facts (§3.15 items 3–5).
 * Preparation resolves each fact's body once (a `record`'s frozen text, an
 * opened `body`, a `task`'s definition from the frozen PlanRevision); this
 * module only turns that value into lines. It never reads a port and never
 * re-collects a fact.
 */
import type { PromptTextsV1 } from '../../contracts/prompts/prompt-set.js';
import { packString } from '../../contracts/prompts/pack-string.js';
import type { ConsultationFactRefV1, ConsultationFactsV1 } from '../work-graph/model/session-contracts.js';

/** One fact and the body it resolves to: the `record` text, the opened `body` text, or a `task`'s definition. */
export type ConsultationResolvedFactV1 = { fact: ConsultationFactRefV1; body: string | null };

/** The stable locator printed instead of a body that could not be resolved. */
function factLocator(fact: ConsultationFactRefV1): string {
  switch (fact.kind) {
    case 'task': return `task ${fact.taskId} of ${fact.planRevision.planId}`;
    case 'event': return `event ${fact.eventId}`;
    case 'body': return `body ${fact.ref.digest}`;
    case 'record': return `record ${fact.sourceRef.ref.aggregateType}`;
  }
}

/** A readable fact renders its resolved body; an unreadable one renders its locator, never a bare locator as content. */
export function consultationFactLine(resolved: ConsultationResolvedFactV1): string {
  return resolved.body === null ? `- unreadable: ${factLocator(resolved.fact)}` : `- ${resolved.body}`;
}

/** The disclaimer, the resolved facts, then the omission and unreadable lists, one per line. */
export function consultationFactsLines(
  facts: ConsultationFactsV1, resolved: readonly ConsultationResolvedFactV1[], texts: PromptTextsV1,
): string {
  return [packString(texts, 'context.consultation.platformFactsDisclaimer'), ...resolved.map(consultationFactLine),
    ...facts.omitted.map(o => `- omitted: ${String(o.count)} ${o.section}`),
    ...facts.unreadable.map(u => `- unreadable: ${u.fact === null ? 'unknown' : factLocator(u.fact)} (${u.reason})`),
  ].join('\n');
}
