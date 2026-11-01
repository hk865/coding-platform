/**
 * The handoff trigger and approval fragments.
 * The record shape is 6B's `HandoffActionShape`; this file is the one copy of
 * the trigger values and the approval shape the tool, the stage and the card share.
 */
import type { ActorRef } from './command-event.js';
import type { SessionRef, VersionPin } from './core/identity.js';
import type { RunRef } from './dispatch.js';

export const HANDOFF_TRIGGERS = ['too_long', 'manual', 'tool'] as const;
export type HandoffTriggerV1 = (typeof HANDOFF_TRIGGERS)[number];

/** The `input.tool` fragment of record 2; `null` unless `trigger === 'tool'`. */
export type HandoffToolFragmentV1 = {
  caller: { actor: Extract<ActorRef, { kind: 'agent' }>; session: SessionRef; run: RunRef;
    duty: 'executor' | 'adviser' };
  reason: string;
  understanding: { noteId: string; version: number }[];
};

/** The approval pin of record 2; `null` on the automatic branch. */
export type HandoffApprovalV1 = {
  required: 'short' | 'long';
  state: 'pending' | 'approved' | 'rejected';
  pin: VersionPin;
  cardKey: string;
  answer: { at: string; commandId: string } | null;
};

/** The tool's one name; the pack key and the tool JSON file use it too. */
export const HAND_OFF_TOOL_NAME = 'hand_off';
