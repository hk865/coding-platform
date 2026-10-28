import type {
  GoalCopyConfirmInputV1, GoalCopyDecisionV1, GoalCopyDraftInputV1, GoalCopyFactsV1,
} from '../../../contracts/goal-card.js';
import { sameJson } from '../../../contracts/fingerprint.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { isLegalSettings } from './goal-settings-machine.js';

export type DecideGoalCopy =
  (facts: GoalCopyFactsV1, input: GoalCopyDraftInputV1 | GoalCopyConfirmInputV1) => GoalCopyDecisionV1;

/** The named plan re-anchor hook: it returns no receipt and changes no fact, and reports that plan re-anchoring is not implemented. */
export function planReanchorHook(): { status: 'not_implemented'; reason: 'planReanchor is 7D1' } {
  return { status: 'not_implemented', reason: 'planReanchor is 7D1' };
}

/**
 * The copy rules: only a cancelled source may be copied; a confirm also pins
 * the source revision it read. Every selected intervention must still be a
 * selectable candidate the owner read — with no
 * intervention reader the candidate set is empty, so a non-empty selection is
 * refused rather than trusted. The birth settings keep the source's autonomy
 * and order and drop its wait/risk settings, which the copy must re-confirm.
 */
export const decideGoalCopy: DecideGoalCopy = (facts, input) => {
  if (facts.source.desiredState !== 'cancelled') {
    return { outcome: 'refuse', code: 'invalid', reason: 'a Goal can be copied only from a cancelled source' };
  }
  if ('expectedSourceRevision' in input && input.expectedSourceRevision !== facts.source.revision) {
    return { outcome: 'refuse', code: 'revision_conflict', reason: 'the source Goal revision changed since it was read' };
  }
  const selection = 'selectedInterventions' in input ? input.selectedInterventions : [];
  const listedTwice = selection.some((entry, index) =>
    selection.slice(0, index).some((earlier) => sameJson(earlier, entry)));
  if (listedTwice) {
    return { outcome: 'refuse', code: 'invalid', reason: 'a selected intervention is listed twice' };
  }
  const chosen: SessionMessageRef[] = [];
  for (const listed of selection) {
    const candidate = facts.selected.find((entry) => sameJson(entry.messageRef, listed));
    if (candidate === undefined || !candidate.selectable) {
      return {
        outcome: 'refuse', code: 'invalid',
        reason: 'the owner cannot verify ownership or state of a selected intervention',
      };
    }
    chosen.push({ ...candidate.messageRef });
  }
  const retract = facts.selected
    .filter((candidate) => !chosen.some((entry) => sameJson(entry, candidate.messageRef)))
    .map((candidate) => ({ ...candidate.messageRef }));
  const settings = {
    schemaVersion: 1 as const,
    autonomy: facts.source.settings.autonomy,
    order: facts.source.settings.order,
    waitForGoalRef: null,
    parallelRisks: [],
  };
  if (!isLegalSettings(settings)) {
    return { outcome: 'refuse', code: 'invalid', reason: 'the copied Goal settings shape is invalid' };
  }
  return {
    outcome: 'create',
    objective: facts.source.objective,
    settings,
    continuedFrom: {
      goal: facts.source.ref,
      sourceRevision: facts.source.revision,
      understanding: facts.understanding.note === null ? null : {
        noteId: facts.understanding.note.noteId,
        version: facts.understanding.note.version,
      },
    },
    copiedInterventions: chosen,
    retract,
    selection: retract.length === 0 ? 'selection_only' : 'retraction_pending',
  };
};
