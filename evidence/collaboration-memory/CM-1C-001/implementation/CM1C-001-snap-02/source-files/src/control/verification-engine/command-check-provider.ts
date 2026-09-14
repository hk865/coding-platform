import { randomUUID } from 'node:crypto';
import { WorkspaceSandbox, ProcessSandbox } from '../../../vendor/coding-agent/dist/public-api.js';
import type { ArtifactPort } from '../../contracts/artifact.js';
import type { RunRef } from '../../contracts/dispatch.js';
import type { CheckPort, CheckContextV1, CheckOutcomeV1, CheckCapabilityV1 } from '../../contracts/verification.js';
import { canonicalJson } from '../../contracts/fingerprint.js';

export type CommandCheckDefinition = {
  checkId: string;
  kind: 'static' | 'dynamic';
  /** Trusted application configuration, never a command invented from diffClass. */
  command: string;
  cwd: string;
  timeoutMs: number;
};
export type CommandCheckTarget = {
  root: string;
  workspaceId: string;
  owner: RunRef;
  /** Exact host-accepted context: includes numeric workspace and plan identities. */
  context: CheckContextV1;
  sourceDigest: string;
  currentDigest(): Promise<string>;
};
export type { CommandCheckProgress } from '../../contracts/verification-service.js';
import type { CommandCheckProgress } from '../../contracts/verification-service.js';
export class CommandCheckProvider implements CheckPort {
  constructor(private readonly definitions: readonly CommandCheckDefinition[],
    private readonly resolveTarget: (ctx: CheckContextV1) => Promise<CommandCheckTarget>,
    private readonly vault: Pick<ArtifactPort, 'put'>,
    private readonly progress?: (progress: CommandCheckProgress) => Promise<void>) {
    if (new Set(definitions.map(d => d.checkId)).size !== definitions.length || definitions.some(d => !d.checkId || !d.command.trim() || d.command.length > 4096 || d.command.includes('\0') || !Number.isSafeInteger(d.timeoutMs) || d.timeoutMs < 1 || d.timeoutMs > 600000)) throw Error('invalid or duplicate command check definitions');
  }
  async capabilities(): Promise<CheckCapabilityV1[]> {
    return this.definitions.map(d => ({ checkId: d.checkId, kind: d.kind, coversKinds: [d.kind], replayable: false }));
  }
  async runCheck(ctx: CheckContextV1, checkId: string): Promise<CheckOutcomeV1> {
    const definition = this.definitions.find(d => d.checkId === checkId);
    if (!definition) throw Error('unregistered command check');
    const observationId = 'check-' + randomUUID(), startedAt = new Date().toISOString();
    const target = await this.resolveTarget(ctx);
    if (canonicalJson(target.context) !== canonicalJson(ctx) || target.owner.projectId !== ctx.projectId ||
        target.owner.goalId !== ctx.goalId || !/^[a-f0-9]{64}$/.test(target.sourceDigest)) throw Error('check target scope or version mismatch');
    // A durable consumer can register intent before the command has effects.
    // Failure to record this checkpoint must prevent execution.
    await this.progress?.({ phase: 'executing', observationId, context: ctx, sourceDigest: target.sourceDigest, startedAt });
    let result: CheckOutcomeV1['result'] = 'INCONCLUSIVE';
    let category = 'environment_error';
    let execution: unknown = null;
    let effects: 'not_started' | 'known' | 'unknown' = 'not_started';
    const sourceIsCurrent = async () => {
      try { return await target.currentDigest() === target.sourceDigest; }
      catch { return false; }
    };
    if (!await sourceIsCurrent()) category = 'stale_source';
    else {
      try {
        const ws = await WorkspaceSandbox.create(target.root, { deniedPrefixes: ['.git', '.env', '.env.local', '.evaluator', '.oracle', 'hidden-tests', '.platform-runtime'] });
        const profile = await ProcessSandbox.probe(target.root, ws);
        if (profile.available) {
          const sandbox = new ProcessSandbox(profile, target.root, ws);
          effects = 'unknown';
          const outcome = await sandbox.execute({ command: definition.command, cwd: definition.cwd,
            timeoutMs: definition.timeoutMs, outputLimitBytes: 32 * 1024, signal: new AbortController().signal });
          execution = outcome;
          effects = outcome.effects.workspaceRevision === null ? 'unknown' : 'known';
          if (outcome.cancelled) category = 'cancelled';
          else if (outcome.timedOut) category = 'timeout';
          else if (outcome.signal || outcome.exitCode === null) category = 'runtime_error';
          else if (outcome.effects.workspaceRevision === null) category = 'unknown_effects';
          else { category = 'tool_check'; result = outcome.exitCode === 0 ? 'PASS' : 'FAIL'; }
          if (!await sourceIsCurrent()) { category = 'stale_source'; result = 'INCONCLUSIVE'; }
        }
      } catch { category = 'runtime_error'; result = 'INCONCLUSIVE'; }
    }
    const summary = `${definition.kind} ${checkId}: ${category} (${result}); command result only, not overall acceptance`;
    const body = canonicalJson(JSON.parse(JSON.stringify({ schemaVersion: 1, observationId, owner: target.owner, context: ctx,
      sourceDigest: target.sourceDigest, definition, startedAt, endedAt: new Date().toISOString(), category, result, effects, execution })));
    const stored = await this.vault.put({ contentType: 'application/json', body, ownerRef: target.owner,
      sourceRefs: [{ kind: 'workspace', refId: target.workspaceId, revision: String(ctx.workspaceRevision), digest: target.sourceDigest }], requestedAt: startedAt });
    if (stored.status !== 'stored') return { result: 'INCONCLUSIVE', observationId, summary: 'check report persistence rejected; no accepted check result', artifactRef: null };
    await this.progress?.({ phase: 'report_stored', observationId, context: ctx, sourceDigest: target.sourceDigest, artifactRef: stored.ref, result, category, effects });
    return { result, observationId, summary, artifactRef: stored.ref };
  }
}
