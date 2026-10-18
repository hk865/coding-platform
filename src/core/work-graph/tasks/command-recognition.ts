/**
 * L19a: the ONE recognizer shared by the `request_command_rerun` owner and the
 * `shell` hook (a thin wrapper over the parser and the expansion helper).
 *
 * It flattens EVERY blocked command of every record first, then picks the
 * first entry by (record `createdAt`, alias, record ref key); within one entry
 * it prefers exact, then action, then a stored `declaredForms` digest. An exact
 * hit in a LATER record therefore never wins over an earlier record's action
 * hit (K8-6), and records with equal `createdAt` no longer keep input order:
 * the lowest alias wins across all of them. Unparsable commands are compared
 * by (A) and the declared forms only.
 *
 * F-102: a caller that already resolved its `rewriteOf` passes `preferred`; the
 * SAME flatten + expansion returns that hit when the command hits it, otherwise
 * the first hit as above. The shell hook passes nothing.
 *
 * A workspace read failure loses ONLY the current `package.json` expansion: it
 * never rejects the whole recognition (a valid `rewriteOf` must still reach the
 * request path). `requests` is optional for old direct callers; the composition
 * always passes the Task's request set, so declared forms are recognised.
 */
import { posix } from 'node:path';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { ReadResult } from '../../../contracts/core/results.js';
import type { UnknownCallReviewV1 } from '../../../contracts/unknown-call-review.js';
import type { CommandRerunRequestV1 } from '../../../contracts/command-rerun-request.js';
import type {
  BlockedCommandMatchV1, CommandRecognizer,
} from '../model/command-recognition-contracts.js';
import type { WorkspaceFileReader } from '../model/kernel-command-read-contracts.js';
import { commandActionKey, commandSha256, parseShellActionsDetailed } from '../state/command-normalization.js';
import { unknownCallReviewRefKey } from './unknown-call-review-codecs.js';
import { BLOCKED_COMMAND_MAX_FILE_BYTES, expandShellScripts } from './command-expansion.js';
import { orderBlockedCommands } from './blocked-command-order.js';

type ViaScript = { scriptName: string; dir: string; actionText: string; actionSha: string };

export function createCommandRecognizer(deps: { readWorkspace?: WorkspaceFileReader }): CommandRecognizer {
  return async (
    ctx: CoreCallContext,
    input: { records: readonly UnknownCallReviewV1[];
      requests: readonly CommandRerunRequestV1[]; command: string; cwd: string; maxPackageReads: number;
      preferred?: { reviewRunId: string; alias: number } },
  ): Promise<ReadResult<BlockedCommandMatchV1 | null>> => {
    // Flatten first: sorting each record's aliases in isolation would let an
    // earlier record's alias 2 beat a later record's alias 1 when createdAt ties.
    const entries = orderBlockedCommands(input.records.map(record => ({
      createdAt: record.createdAt,
      refKey: unknownCallReviewRefKey(record.ref),
      commands: record.blockedCommands.map(blocked => ({ alias: blocked.alias, value: blocked })),
    })));
    if (entries.length === 0) return { status: 'ready', value: null };
    const digest = commandSha256(input.command);
    const requests = input.requests;

    // The CURRENT command's comparison keys, with the script that introduced
    // each key (null = a top-level action of this very command).
    const current = new Map<string, ViaScript | null>();
    const actionShaByText = new Map<string, string>();
    const parsed = parseShellActionsDetailed(input.command);
    if (parsed.status === 'parsed') {
      const addAction = (sha: string, text: string): void => {
        if (!actionShaByText.has(text)) actionShaByText.set(text, sha);
      };
      for (const action of parsed.actions) {
        const sha = shaOfWords(action.words);
        if (!current.has(sha)) current.set(sha, null);
        addAction(sha, action.text);
      }
      const reader = deps.readWorkspace;
      const workspaceRef = { aggregateType: 'Workspace' as const, projectId: ctx.projectId,
        workspaceId: ctx.workspaceId ?? '' };
      const expansion = await expandShellScripts({
        actions: parsed.actions,
        cwd: input.cwd,
        maxFiles: input.maxPackageReads,
        readFile: async (path: string) => {
          if (reader === undefined) {
            return { status: 'unavailable', reason: 'the workspace reader is not wired for command recognition' };
          }
          try {
            const read = await reader.readWorkspace(ctx, { workspace: workspaceRef, path,
              maxBytes: BLOCKED_COMMAND_MAX_FILE_BYTES, version: { kind: 'working_tree' } });
            if (read.status === 'ready') return { content: read.value.content, digest: read.value.digest };
            return { status: 'unavailable', reason: read.reason };
          } catch (error) {
            return { status: 'unavailable', reason: error instanceof Error ? error.message : String(error) };
          }
        },
      });
      for (const script of expansion.expansions) {
        // The first-level action that produced this entry, for the card's text.
        const parentSha = actionShaByText.get(script.action) ?? script.actions[0]?.sha256 ?? '';
        const via: ViaScript = { scriptName: script.scriptName,
          dir: 'path' in script.basis ? posix.dirname(script.basis.path) : '.',
          actionText: script.action, actionSha: parentSha };
        for (const action of script.actions) {
          if (!current.has(action.sha256)) current.set(action.sha256, via);
          addAction(action.sha256, action.text);
        }
      }
    }

    const declaredFor = (entry: UnknownCallReviewV1['blockedCommands'][number]): boolean =>
      requests.some(request => request.reviewRef.runId === entry.reviewRunId
        && request.alias === entry.alias
        && request.declaredForms.some(form => form.sha256 === digest));

    const matchActionIn = (entry: UnknownCallReviewV1['blockedCommands'][number]):
    BlockedCommandMatchV1['match'] | null => {
      for (const [sha, via] of current) {
        const direct = entry.actions.find(candidate => candidate.sha256 === sha);
        if (direct !== undefined) {
          return { kind: 'action',
            action: via === null ? direct
              : { text: via.actionText, sha256: via.actionSha.length > 0 ? via.actionSha : direct.sha256 },
            ...(via === null ? {} : { viaScript: { scriptName: via.scriptName, dir: via.dir } }) };
        }
        for (const script of entry.expansions) {
          const expanded = script.actions.find(candidate => candidate.sha256 === sha);
          if (expanded === undefined) continue;
          return { kind: 'action',
            action: via === null ? expanded
              : { text: via.actionText, sha256: via.actionSha.length > 0 ? via.actionSha : expanded.sha256 },
            viaScript: via === null
              ? { scriptName: script.scriptName,
                dir: 'path' in script.basis ? posix.dirname(script.basis.path) : '.' }
              : { scriptName: via.scriptName, dir: via.dir } };
        }
      }
      return null;
    };

    // F-102: the caller may name the record its `rewriteOf` resolved. Every
    // entry is decided from the SAME parse and expansion above; the preferred
    // entry wins when the command hits it, otherwise the first hit is unchanged.
    const preferred = input.preferred;
    let firstHit: BlockedCommandMatchV1 | null = null;
    for (const entry of entries) {
      const base = { reviewRunId: entry.reviewRunId, alias: entry.alias, commandSha256: entry.commandSha256 };
      let hit: BlockedCommandMatchV1 | null = null;
      if (entry.commandSha256 === digest) {
        hit = { ...base, match: { kind: 'exact' } };
      } else {
        const actionMatch = matchActionIn(entry);
        if (actionMatch !== null) hit = { ...base, match: actionMatch };
        else if (declaredFor(entry)) hit = { ...base, match: { kind: 'declared' } };
      }
      if (hit === null) continue;
      if (preferred === undefined) return { status: 'ready', value: hit };
      if (entry.reviewRunId === preferred.reviewRunId && entry.alias === preferred.alias) {
        return { status: 'ready', value: hit };
      }
      if (firstHit === null) firstHit = hit;
    }
    return { status: 'ready', value: firstHit };
  };
}

/** F-088: the ONE action key (also used by `command-expansion.ts` and the ② fallback). */
function shaOfWords(words: readonly string[]): string {
  return commandActionKey(words);
}
