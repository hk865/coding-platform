# fix-d.py <copy>: lead fixes after the Codex re-review of area D (exact replacements, each asserted).
import sys, pathlib
root = pathlib.Path(sys.argv[1])
def edit(rel, pairs):
    p = root / rel
    s = p.read_text(encoding='utf-8')
    for old, new, n in pairs:
        assert s.count(old) == n, (rel, s.count(old), old[:90])
        s = s.replace(old, new)
    p.write_text(s, encoding='utf-8', newline='\n')

# LD1 (D1, spec 4.5 line 884: settings command meta.expected and fingerprint keep the original captured source pins;
# only records.guards use the checked current Goal version and do not enter the new mutable-input fingerprint; a
# retry first restores the original settings receipt): the owner's resolveGoalConflict fingerprint keeps only the
# expected pins of objects the answer captured; the supplementary pins read current (the earlier GoalPhase of a
# wait, uncaptured Goals of an order) stay CAS guards of a first execution only. A retry of the same requestId
# therefore meets the same identity+fingerprint and replays the original receipt, durably.
edit('src/core/work-graph/tasks/goal-settings-service.ts', [(
"""    const receiptIdentity = identityKey(GOAL_CONFLICT_IDENTITY_PREFIX, actor, scope, owned.requestId);
    const fingerprint = fingerprintOf({ schemaVersion: 1, commandType: 'GoalConflictResolve', source: input.source,
      selection, decisionMessageRef: input.decisionMessageRef, expected: expectedCanonical(owned.expected) });""",
"""    const receiptIdentity = identityKey(GOAL_CONFLICT_IDENTITY_PREFIX, actor, scope, owned.requestId);
    // §4.5 line 884 (lead, D1): the fingerprint keeps the answer's captured source pins only. The supplementary
    // pins a first execution reads current (the earlier GoalPhase of a wait, the uncaptured Goals of an order)
    // are CAS guards of that execution and never part of the fingerprint, so a retry of the same requestId after
    // those objects moved replays the original receipt instead of answering idempotency_conflict.
    const capturedRefKeys = new Set((Array.isArray(input.source.pins) ? input.source.pins : [])
      .map((pin) => refKeyOf(pin.ref)));
    const fingerprintPins = owned.expected.filter((pin) => capturedRefKeys.has(refKeyOf(pin.ref)));
    const fingerprint = fingerprintOf({ schemaVersion: 1, commandType: 'GoalConflictResolve', source: input.source,
      selection, decisionMessageRef: input.decisionMessageRef, expected: expectedCanonical(fingerprintPins) });""", 1)])

# LD1 (coordinator side): the in-process command memory of the DSH round is removed (no longer needed; Codex D #2:
# it also shared a mutable source with the returned answer). LD2 (Codex D #3): a failed supplementary/source read
# after the committed answer is returned in `action` (the type allows a CoreRejection) instead of `null`.
edit('src/business/workflow/decision-actions.ts', [
("""/**
 * §4.5 line 884 + D1: the collision-safe key of one remembered settings
 * command. The settings owner derives its receipt identity from
 * `{actor, projectId, workspaceId, requestId}` (goal-settings-service.ts:159-163;
 * `bindTrustedContext` reads the actor from the trusted Host principal), so the
 * coordinator must key by exactly that full tuple: a bare `requestId` could let
 * one project/workspace/actor replay another scope's command.
 */
function settingsCommandKey(ctx: CoreCallContext, requestId: string): string {
  const principal: unknown = ctx?.principal;
  const actor: unknown = isRecord(principal) ? principal['actor'] : undefined;
  return canonicalJson({
    projectId: ctx?.projectId ?? null,
    workspaceId: ctx?.workspaceId ?? null,
    actor: isRecord(actor) ? { kind: actor['kind'] ?? null, id: actor['id'] ?? null } : null,
    requestId,
  } as unknown as JsonValue);
}

""", "", 1),
("""  /**
   * §4.5 line 884 + D1: the exact `resolveGoalConflict` command the first
   * execution of a `requestId` committed. The owner's settings receipt identity
   * is computed from `meta.requestId`, the command input and `meta.expected`
   * only, so re-sending THIS command makes the owner look up and restore the
   * original committed event before any new business read. Without it a retry
   * would re-read the earlier GoalPhase / the extra Goals of a `conflict_order`
   * list from current state, change the fingerprint under the same identity and
   * end in `idempotency_conflict` although the settings commit exists. The pins
   * a first execution reads are therefore kept here, so a retry reaches the
   * durable settings receipt through the owner instead of re-reading current
   * state. `settingsExpectedPins` is only ever called on a first execution.
   *
   * Kept in-process (the coordinator is a process-lifetime singleton). The key
   * is the full `{project, workspace, actor, requestId}` tuple the owner uses,
   * never a bare requestId, and the memory is a bounded FIFO (oldest insertion
   * evicted first): see the D1 UNSPECIFIED note for the exact policy and the
   * durable-lookup seam audit.
   */
  const SETTINGS_COMMAND_MEMORY_LIMIT = 256;
  const committedSettingsCommands = new Map<string, { source: DecisionSourceV1; expected: VersionPin[] }>();
  function rememberSettingsCommand(key: string, command: { source: DecisionSourceV1; expected: VersionPin[] }): void {
    committedSettingsCommands.set(key, command);
    if (committedSettingsCommands.size > SETTINGS_COMMAND_MEMORY_LIMIT) {
      const oldest = committedSettingsCommands.keys().next().value;
      if (oldest !== undefined) committedSettingsCommands.delete(oldest);
    }
  }

""", "", 1),
("""    // ② The structured conflict action. The exact command the first execution
    // committed is remembered (D1) and re-sent on a retry, so the owner's
    // identity+fingerprint still match and it restores the original settings
    // receipt BEFORE any current Goal/GoalPhase read. Only a first execution (no
    // remembered command) reaches the owner's current reads.
    const settingsKey = settingsCommandKey(ctx, requestId);
    let settingsCommand: { source: DecisionSourceV1; expected: VersionPin[] } | undefined =
      committedSettingsCommands.get(settingsKey);
    if (settingsCommand === undefined) {""",
"""    // ② The structured conflict action. The command carries the answer's captured
    // source pins; the supplementary pins (the earlier GoalPhase of a wait, the
    // uncaptured Goals of an order) are read current and guard a first execution
    // only: the owner's fingerprint keeps the captured pins alone (§4.5 line 884),
    // so a retry of the same requestId restores the original settings receipt.
    let settingsCommand: { source: DecisionSourceV1; expected: VersionPin[] };
    {""", 1),
("""        if ('status' in derived) {
          return ready({ answer, action: null, application: null, state: 'application_not_recorded' });
        }""",
"""        if ('status' in derived) {
          return ready({ answer, action: derived, application: null, state: 'application_not_recorded' });
        }""", 2),
("""        if (sourceRead.status !== 'ready') {
          return ready({ answer, action: null, application: null, state: 'application_not_recorded' });
        }""",
"""        if (sourceRead.status !== 'ready') {
          return ready({ answer, action: sourceRead, application: null, state: 'application_not_recorded' });
        }""", 1),
("""    // The settings command committed (first execution or replay); keep it so a
    // later retry of the same requestId restores this exact receipt.
    rememberSettingsCommand(settingsKey, settingsCommand);

""", "\n", 1),
])
print('ok')

# LD2b: the source read's non-rejection failures (not_found / not_ready) become a CoreRejection of the same meaning.
edit('src/business/workflow/decision-actions.ts', [(
"""          return ready({ answer, action: sourceRead, application: null, state: 'application_not_recorded' });""",
"""          const sourceFailure: CoreRejection = sourceRead.status === 'rejected' ? sourceRead
            : { status: 'rejected', code: sourceRead.status === 'not_found' ? 'not_found' : 'unavailable',
              reason: 'the decision source of the answer is not readable' };
          return ready({ answer, action: sourceFailure, application: null, state: 'application_not_recorded' });""", 1)])
print('ok2')
