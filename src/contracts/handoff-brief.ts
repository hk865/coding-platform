/**
 * The Work handoff brief's contract.
 * The record is H's `WorkHandoffBriefV1`; this file owns the ref it is keyed by, the
 * normalized material the renderer receives and the independent binding.
 */
import type { SessionRef } from './core/identity.js';
import type { OperationRef } from './core/operations.js';
import type { GoalRef } from './ledger.js';
import type { Phase } from './plan.js';
import type { DecisionSourceV1 } from './goal-decisions.js';
import type { QueryRunRef } from './query-job.js';
import type { RunRef, TaskTriple } from './dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from './fingerprint.js';

/** Record 5's address: the successor Session and the handoff operation. */
export type HandoffBriefRef = {
  aggregateType: 'HandoffBrief';
  projectId: string;
  sessionId: string;   // the successor
  operationId: string;
};

export type HandoffBriefTaskV1 = { task: TaskTriple; phase: Phase; lastResult: string | null };
export type HandoffBriefNoteIndexV1 = { moduleId: string; notes: { noteRef: string; version: number }[] }[];

export type HandoffBriefMaterialV1 =
  | { duty: 'executor';
      tasks: HandoffBriefTaskV1[];                        // the handed tasks, in plan order
      conclusion: { run: RunRef; finalMessageId: string; body: string }
        | { absent: 'no_formal_final_answer' };          // body only, never thinking
      noteIndex: HandoffBriefNoteIndexV1;                // the modules the handed tasks declare
      understanding: { noteId: string; version: number }[];   // >= 1, the versions §3.5 item 3 found
      oldLine: SessionRef }
  | { duty: 'adviser';
      goals: { goalRef: GoalRef; tasks: HandoffBriefTaskV1[]; noteIndex: HandoffBriefNoteIndexV1;
        openDecisions: { source: DecisionSourceV1['kind']; key: string }[] }[];   // per Goal, whole project
      queryAnswers: { run: QueryRunRef; body: string }[];   // the source Session's last 3 ended, each <= 2 KiB
      understanding: { noteId: string; version: number }[]; // >= 1, the versions §3.5 item 3 found
      oldLine: SessionRef };

/** Record 5's own binding; independent of ContinuationBriefV1. */
export type HandoffBriefBindingV1 = {
  operation: OperationRef;
  source: SessionRef;
  successor: SessionRef;
  duty: 'executor' | 'adviser';
  digest: string;   // handoffBriefDigest(material), also record 5's `digest`
};

/** sha256Hex(canonicalJson(material)); the one digest rule (B2-03). Pure. */
export function handoffBriefDigest(material: HandoffBriefMaterialV1): string {
  return sha256Hex(canonicalJson(material as unknown as JsonValue));
}
