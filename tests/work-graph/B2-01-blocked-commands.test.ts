/**
 * B2-01 (spec §5.2, L19a): ② writes the real `blockedCommands`.
 *
 * Every case reaches a real `needs_decision`/`awaiting_approval` record whose
 * `process` item and command facts come from a REAL Work Run (the `shell` call
 * went through §5.1's stand-in), and answers through the real `resolveDecision`
 * with the production Kernel-command reader over the same Kernel store.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { commandSha256 } from '../../src/core/work-graph/state/command-normalization.js';
import {
  claimK3ReviewRound, endK3RunCompleted, settleK3Review, writeK3Proposals,
} from '../helpers/K3-proposal-round.js';
import {
  openK3BlockedCommandWorld, sha256Of, type K3BlockedCommandWorld,
} from '../helpers/K3-blocked-command-fixture.js';
import { mailboxToolSeam, shellSeam } from '../helpers/K3-tool-seams.js';

// §5.1's stand-in `shell`, hoisted per test file (the fixture's real Run uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

// §5.1's stand-in for the ONE non-process, `platform`-kind tool (L3 row 4). The
// production SessionMailbox factory is replaced per test file; when the seam is
// armed its blocking definition is what the Kernel registers.
vi.mock('../../src/core/agent-runtime/communication-tools.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/agent-runtime/communication-tools.js')>();
  return { ...actual, createSessionMailboxTools: (config: Parameters<typeof actual.createSessionMailboxTools>[0]) =>
    mailboxToolSeam.enabled ? mailboxToolSeam.handle() : actual.createSessionMailboxTools(config) };
});

const worlds: K3BlockedCommandWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  mailboxToolSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

const keyOf = (words: string[]): string => sha256Of(JSON.stringify(words));

function migrateWorld(kind: 'memory' | 'sqlite'): Promise<K3BlockedCommandWorld> {
  return openK3BlockedCommandWorld(kind, {
    commands: { 'b2-c1': { command: 'cd app && npm run db:migrate', cwd: null } },
    files: { 'app/package.json': JSON.stringify({ scripts: { 'db:migrate': 'prisma migrate deploy' } }) },
  });
}

function byAlias(record: UnknownCallReviewV1, alias: number) {
  const item = record.items.find(entry => entry.alias === alias);
  if (item === undefined) throw new Error(`no item #${String(alias)}`);
  return item;
}

describe('B2-01 blockedCommands at the ② write', () => {
  it.each(['memory', 'sqlite'] as const)(
    '%s: skip_as_done writes the parsed action and its script expansion with its own basis', async kind => {
      const blocked = await migrateWorld(kind);
      worlds.push(blocked);
      const record = blocked.record;
      const item = blocked.items.get('b2-c1')!;
      const applied = await blocked.answer(record, 'skip_as_done');
      const pkg = JSON.stringify({ scripts: { 'db:migrate': 'prisma migrate deploy' } });

      expect(applied.blockedCommands).toEqual([{
        reviewRunId: record.runRef.runId,
        alias: 1,
        // sha256 of the normalized "cd app && npm run db:migrate" (normalization is a no-op here).
        commandSha256: 'd7fd40d9e03c28eea4613ba8064155307aa28b24f01ab0aa3f9bc9fe1cf706d7',
        kernelCallRef: item.kernel,
        actions: [{ text: 'npm run db:migrate', sha256: keyOf(['npm', 'run', 'db:migrate']) }],
        expansions: [{
          action: 'npm run db:migrate',
          scriptName: 'db:migrate',
          scriptText: 'prisma migrate deploy',
          actions: [{ text: 'prisma migrate deploy', sha256: keyOf(['prisma', 'migrate', 'deploy']) }],
          basis: { path: 'app/package.json', digest: sha256Of(pkg) },
        }],
        truncated: false,
      }]);
      expect(blocked.kernelCalls).toEqual([['b2-c1']]);
      expect(blocked.readPaths).toEqual(['app/package.json']);
    }, 120_000);

  it.each(['memory', 'sqlite'] as const)(
    'all-irrelevant (or unparsed) commands save the one whole-normalized-text action (%s)', async kind => {
    const normalized = await openK3BlockedCommandWorld(kind, {
      commands: { c1: { command: '  echo   hi  ' } },
      files: {},
    });
    const unparsed = await openK3BlockedCommandWorld(kind, {
      commands: { c2: { command: "tool 'unterminated" } },
      files: {},
    });
    worlds.push(normalized, unparsed);
    const first = await normalized.answer(normalized.record, 'skip_as_done');
    const second = await unparsed.answer(unparsed.record, 'skip_as_done');
    expect([...first.blockedCommands, ...second.blockedCommands].map(entry => entry.actions)).toEqual([
      [{ text: 'echo hi', sha256: keyOf(['echo', 'hi']) }],
      [{ text: "tool 'unterminated", sha256: keyOf(["tool", "'unterminated"]) }],
    ]);
    expect([...first.blockedCommands, ...second.blockedCommands].map(entry => entry.commandSha256)).toEqual([
      // sha256("echo hi") after the documented collapse of "  echo   hi  ",
      // and sha256("tool 'unterminated") (the unparsed text is normalized as is).
      '56a79f3b115448072387c2480044bfa2cf8f90e4f5fddd8c943b4e051b81f80b',
      'da6f0aab7afec16a8a63a264be3ef7fe7458c2bee4b0f613e8bcc3809de3ede5',
    ]);
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)(
    'a platform-only skip_as_done writes an empty list and reads no Kernel commands (%s)', async kind => {
    // A REAL Work Run whose only unresolved call is the injected blocking
    // non-process tool: the production classifier/draft classify it as a
    // `platform` item (lookup not wired -> undetermined), so `dispositionTargets`
    // names it while `proposalTargets` is null. `skip_as_done` therefore has no
    // process target and writes nothing — without a Kernel command read.
    const blocked = await openK3BlockedCommandWorld(kind, {
      commands: { p1: { name: 'send_user_message', args: {
        recipient: { projectId: 'P', sessionId: 'session-k3-platform-only' }, text: 'platform-only' } } },
      files: {},
    });
    worlds.push(blocked);
    expect(blocked.record.items.map(item => item.kind)).toEqual(['platform']);
    expect(blocked.record.items[0]?.toolName).toBe('send_user_message');
    // The item's arguments digest is the production digest of the REAL Kernel
    // call, so this `platform` item cannot be a hand-written review fact.
    // sha256 of the canonical JSON
    // {"recipient":{"projectId":"P","sessionId":"session-k3-platform-only"},"text":"platform-only"}
    // (JCS key order; no whitespace).
    expect(blocked.record.items[0]?.argumentsDigest)
      .toBe('cc5562be8a5bf53c94129ae55ddff507a8b6b59028d4d0f3159689a5642379e2');
    expect(blocked.record.status).toBe('needs_decision');
    const applied = await blocked.answer(blocked.record, 'skip_as_done');
    expect(applied.blockedCommands).toEqual([]);
    expect(blocked.kernelCalls).toEqual([]);
    expect(blocked.readPaths).toEqual([]);
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)(
    'rerun_as_is writes an empty list and reads no Kernel commands (%s)', async kind => {
    const blocked = await migrateWorld(kind);
    worlds.push(blocked);
    const applied = await blocked.answer(blocked.record, 'rerun_as_is');
    expect(applied.blockedCommands).toEqual([]);
    expect(blocked.kernelCalls).toEqual([]);
    expect(blocked.readPaths).toEqual([]);
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)(
    'approve writes the ORIGINAL commands of proposalTargets, never the proposals (%s)', async kind => {
    const blocked = await openK3BlockedCommandWorld(kind, {
      commands: { a1: { command: 'npm run build' } },
      files: {},
    });
    worlds.push(blocked);
    expect(blocked.record.status).toBe('needs_decision');
    // The real proposal round over the SAME real record (no second record).
    const proposed = await blocked.answer(blocked.record, 'safer_method', { text: 'use the safer commands' });
    expect(proposed.status).toBe('awaiting_proposal');
    const round = await claimK3ReviewRound(blocked.world, proposed, { phase: 'proposal' });
    const written = await writeK3Proposals(blocked.world, round, {
      commandFor: item => `proposal-command-${String(item.alias)}`,
    });
    await endK3RunCompleted(blocked.world, round.claim);
    const reached = await settleK3Review(blocked.world, written.record);
    expect(reached.status).toBe('awaiting_approval');
    const applied = await blocked.answer(reached, 'approve');
    expect(applied).toMatchObject({ status: 'resolved' });
    expect(applied.blockedCommands.map(entry => entry.alias)).toEqual([1]);
    expect(applied.blockedCommands.map(entry => entry.commandSha256))
      .toEqual([commandSha256('npm run build')]);
    const proposalHashes = reached.proposals.map(proposal => commandSha256(proposal.command));
    for (const entry of applied.blockedCommands) expect(proposalHashes).not.toContain(entry.commandSha256);
    expect(applied.blockedCommands.map(entry => entry.reviewRunId)).toEqual([reached.runRef.runId]);
    // No package.json exists in this world: the static expansion never blocks the write.
    expect(applied.blockedCommands[0]?.expansions).toEqual([{
      action: 'npm run build', scriptName: 'build', scriptText: '', actions: [],
      basis: { status: 'unavailable', reason: 'no such workspace file: package.json' },
    }]);
    expect(byAlias(applied, 1).alias).toBe(1);
  }, 180_000);
});
