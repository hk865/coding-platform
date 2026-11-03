/**
 * The 7D2 orchestration RecordStore codecs: the four R1 records (adviser queue, autonomy rule, rule set, capacity
 * episode), their four `…Changed` events, and the one registration bundle. The field tables and the record/event
 * rules live in `contracts/role-lines.ts`; this file only adds the Store envelope and is registered by the
 * composition root (W).
 *
 * `roleLineSplitSavedCodec` is the one body codec of the split's `planned` step: the `{source,move,keep,reason}` body
 * is canonical JSON (also its identity key) and decodes back through the existing `isRoleScopeV1`, so no second scope
 * shape exists.
 */
import {
  AutonomyRuleFormat, AutonomyRuleSetChangedFormat, AutonomyRuleSetFormat, GoalAdviserQueueChangedFormat,
  GoalAdviserQueueFormat, RoleCapacityEpisodeChangedFormat, RoleCapacityEpisodeFormat, RoleLineOperationChangedFormat,
  isRoleScopeV1, type RoleLineSplitSavedV1, type RoleScopeV1,
} from '../../../contracts/role-lines.js';
import { canonicalKey, type JsonValue } from '../../../contracts/fingerprint.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import { hasOnlyKeys, isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import { createEventCodec, createRecordCodec, formatSchemas } from '../persistence/field-table-codec.js';
export type { RoleLineSplitSavedV1 };
export const goalAdviserQueueCodec = createRecordCodec(GoalAdviserQueueFormat);
export const autonomyRuleCodec = createRecordCodec(AutonomyRuleFormat);
export const autonomyRuleSetCodec = createRecordCodec(AutonomyRuleSetFormat);
export const roleCapacityEpisodeCodec = createRecordCodec(RoleCapacityEpisodeFormat);
export const goalAdviserQueueChangedCodec = createEventCodec(GoalAdviserQueueChangedFormat);
export const autonomyRuleSetChangedCodec = createEventCodec(AutonomyRuleSetChangedFormat);
export const roleCapacityEpisodeChangedCodec = createEventCodec(RoleCapacityEpisodeChangedFormat);
export const roleLineOperationChangedCodec = createEventCodec(RoleLineOperationChangedFormat);
export const roleLineSplitSavedCodec = {
  encode(value: RoleLineSplitSavedV1): string {
    return canonicalKey(value as unknown as JsonValue);
  },
  decode(text: string): RoleLineSplitSavedV1 | null {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return null; }
    if (!isRecord(parsed) || !hasOnlyKeys(parsed, ['source', 'move', 'keep', 'reason'])) return null;
    const source = parsed['source'];
    if (!isRecord(source) || !nonEmpty(source['projectId']) || !nonEmpty(source['sessionId'])) return null;
    const move = parsed['move'], keep = parsed['keep'];
    if (!Array.isArray(move) || !Array.isArray(keep) || !move.every(isRoleScopeV1) || !keep.every(isRoleScopeV1)) {
      return null;
    }
    const reason = parsed['reason'];
    if (reason !== 'too_long' && reason !== 'too_slow' && reason !== 'agent_proposal') return null;
    return { source: source as SessionRef, move: move as RoleScopeV1[], keep: keep as RoleScopeV1[], reason };
  },
};
export const ROLE_LINE_ORCHESTRATION_SCHEMAS = formatSchemas([
  goalAdviserQueueCodec, autonomyRuleCodec, autonomyRuleSetCodec, roleCapacityEpisodeCodec,
  goalAdviserQueueChangedCodec, autonomyRuleSetChangedCodec, roleCapacityEpisodeChangedCodec,
  roleLineOperationChangedCodec]);
