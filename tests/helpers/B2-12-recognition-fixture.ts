/**
 * Shared B2-12 recognition builders (T1-012): the identical `record()` /
 * `request()` constructors, with their `sha` / `keyOf` digest helpers and the
 * host `ctx`, extracted from `B2-12-recognition.test.ts` and
 * `B2-12-recognition-pure.test.ts`.
 *
 * Pure dependencies only: `node:crypto` and contract types. Nothing here reads
 * or writes a platform, store, Host, Runtime or test world.
 */
import { createHash } from 'node:crypto';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { CommandRerunRequestV1 } from '../../src/contracts/command-rerun-request.js';

export const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
export const keyOf = (words: string[]): string => sha(JSON.stringify(words));

export const ctx: CoreCallContext = {
  projectId: 'P', workspaceId: 'W',
  principal: { kind: 'host', actor: { kind: 'human', id: 'o' } },
  materialReader: { kind: 'none' }, signal: new AbortController().signal,
} as never;

export function record(input: {
  runId: string; createdAt: string;
  blocked: Array<{
    alias: number; commandSha256: string;
    actions?: Array<{ text: string; sha256: string }>;
    expansions?: Array<{ action: string; scriptName: string; scriptText: string;
      actions: Array<{ text: string; sha256: string }>;
      basis: { path: string; digest: string } | { status: 'unavailable'; reason: string } }>;
  }>;
}): UnknownCallReviewV1 {
  return {
    ref: { aggregateType: 'UnknownCallReview', projectId: 'P', goalId: 'B', runId: input.runId },
    createdAt: input.createdAt,
    blockedCommands: input.blocked.map(entry => ({
      reviewRunId: input.runId, alias: entry.alias, commandSha256: entry.commandSha256,
      kernelCallRef: {}, actions: entry.actions ?? [], expansions: entry.expansions ?? [],
      truncated: false,
    })),
  } as unknown as UnknownCallReviewV1;
}

export function request(input: {
  runId: string; alias: number; declaredForms: Array<{ sha256: string; text: string }>;
}): CommandRerunRequestV1 {
  return {
    reviewRef: { aggregateType: 'UnknownCallReview', projectId: 'P', goalId: 'B', runId: input.runId },
    alias: input.alias, declaredForms: input.declaredForms,
  } as unknown as CommandRerunRequestV1;
}
