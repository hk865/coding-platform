/**
 * P3 A2 (design `:396-399`, `:808`, `:827②`; lead ruling `p3-frozen.md:3-10`, P3-6): the adviser's planning round
 * names a message as the new basis of a rework or a recheck. Every basis starts from a real `send_session_message`
 * of a line's scripted model, and the recipient line's woken text round writes the formal reply (design `:808`;
 * review ruling `c3rv-rulings.md` P3 测试); A's tool round then calls the tool with that question's ref.
 * The three refusals are the owner's own sentences (`p3-frozen.md:111-114`): an own reply (S asks A, A answers),
 * no reply yet (A asks E while E's line is held at its model request: the `running` world's tB Run), and a message
 * the caller cannot read (S asks E2, E2 answers). Every read is public (`messages/read`, `tasks/query`,
 * `verification/round`); the tool receipts, the send receipts among them, are read off the model requests.
 *
 * Red before P3: `PL-consumption-fixture.ts` does not grant `request_rework`/`request_recheck` yet (lead ruling 5,
 * P3-7) and the old production does not mount them on any Query round, so the Kernel answers `unknown_tool`; the
 * first assertion to fail is the rework's committed result, the recheck's second chain round, or the owner's
 * `execution_failed` error.
 *
 * Named mutations (not run: no src change in this row). ① R2 drops the `basisMessage` mapping into the owner's
 * `newInputRefs` -> both `newInputRefs` assertions red; R3 does not mount the tools -> the tool result/chain
 * assertions red.
 * ② delete `repliedByCaller` -> the own-reply cell commits and its `execution_failed` assertion red; delete
 * `status !== responded` -> the no-reply cell commits, red; delete the mailbox read right -> the unreadable cell
 * commits, red. Three refusal cells: the no-reply cell uses `request_recheck`; the other two use `request_rework`
 * (P3-6 keeps ② at three cells; the cross-workspace cell was cut by the lead).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { VerificationRoundRef } from '../../src/contracts/verification.js';
import type { SendMessageResultV1 } from '../../src/core/work-graph/model/communication-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { waitForResponse } from '../helpers/IV-host-fixture.js';
import { toolResultOf } from '../helpers/P2-tool-result.js';
import type { P1World } from '../helpers/P1-round-fixture.js';
import { p1Worlds, reworkEntries, reworkPins, sentRef } from '../helpers/P1-reads.js';
import { S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';

const worlds = p1Worlds();
afterEach(async () => { await worlds.closeAll(); });

type RoundChain = { chain: { reverify: { newInputRefs: unknown } | null;
  rounds: Array<{ roundRef: VerificationRoundRef; revision: number }> } };
/** `from`'s real held round sends `to` one `needsReply` question through the tool; the ref off its send receipt. */
async function ask(p1: P1World, from: S6ASession, to: S6ASession, label: string): Promise<SessionMessageRef> {
  const callId = `p3-${label}-ask`;
  const round = await p1.hold(from, label, [
    { kind: 'calls', calls: [{ callId, name: 'send_session_message',
      args: { recipient: to.ref, text: `P3 ${label} question`, needsReply: true } }] },
    { kind: 'text', text: `P3 ${label} asked` },
  ]);
  await round.end();
  return sentRef(toolResultOf(await p1.world.scripted.requests(from), callId) as SendMessageResultV1);
}
/** `ask`, then `to`'s woken text round is its formal conclusion: the question is answered by `to`. */
async function answered(p1: P1World, from: S6ASession, to: S6ASession, label: string): Promise<SessionMessageRef> {
  await p1.world.scripted.script(to, [{ kind: 'text', text: `P3 ${label}: ${to.label} answers` }]);
  const asked = await ask(p1, from, to, label);
  expect((await waitForResponse(p1.world, asked)).response, `${to.label} answers through its woken text round`)
    .not.toBeNull();
  return asked;
}
/** A's real held round whose scripted model makes the one tool call, then answers text. */
async function toolRound(p1: P1World, label: string, callId: string, name: string, args: Record<string, unknown>) {
  const round = await p1.hold(p1.lines.A, label, [
    { kind: 'calls', calls: [{ callId, name, args }] },
    { kind: 'text', text: `P3 ${label} done` },
  ]);
  await round.end();
  return { round, receipt: toolResultOf(await p1.world.scripted.requests(p1.lines.A), callId) };
}
/** The tool input both rows share; the pins come from public reads, never from the entry's own values. */
async function toolInput(p1: P1World, tool: 'request_rework' | 'request_recheck', basis: SessionMessageRef,
  reason: string): Promise<Record<string, unknown>> {
  if (tool === 'request_rework') {
    return { taskRef: p1.task.tC, afterRunRef: p1.runC, reason, basisMessage: basis,
      expected: await reworkPins(p1, p1.runC) };
  }
  const chain = ready<RoundChain>(await p1.world.post('verification/round',
    plain(S6A_SCOPE, { subjectRunRef: p1.runC })), 'the check rounds').chain;
  const predecessor = chain.rounds.at(-1)!;
  return { predecessorRoundRef: predecessor.roundRef, reason, basisMessage: basis,
    expected: [{ ref: predecessor.roundRef, revision: predecessor.revision }] };
}

describe('P3 ①: a real inquiry is the new basis of a rework or a recheck', () => {
  /* Basis `:808`, `:398-399`; world: one `openP1World` per tool. A's first held round sends `needsReply:true` to
     E2 through the real tool; E2's woken text round is its conclusion; the response lands. A's second round calls
     the tool with `basisMessage` = the inquiry ref, pinned from public reads. Expectations: the rework receipt's
     `value.requeue.newInputRefs` and `tasks/query`'s automatic entry (`autoCount:1`, `requestedBy` this round);
     the recheck leaves a second chain round whose `chain.reverify.newInputRefs` is the same message. */
  it.each(['request_rework', 'request_recheck'] as const)('%s: the inquiry ref is the new basis', async (tool) => {
    const p1 = await worlds.open();
    const inquiry = await answered(p1, p1.lines.A, p1.lines.E2, 'basis');

    const callId = `p3-${tool}-call`;
    if (tool === 'request_recheck') {
      // Hand-counted world: P1's tC ends with one failed check round, so the chain is 1 before and 2 after.
      const before = ready<RoundChain>(await p1.world.post('verification/round',
        plain(S6A_SCOPE, { subjectRunRef: p1.runC })), 'the check rounds').chain;
      expect(before.rounds, 'the world starts with one failed check round').toHaveLength(1);
    }
    const { round, receipt } = await toolRound(p1, `${tool}-rework`, callId, tool,
      await toolInput(p1, tool, inquiry, `P3 ${tool} on the inquiry`));
    expect(receipt, 'the basis tool returned a result').toBeDefined();
    if (round.ctx.principal.kind !== 'query_run') throw new Error('P3: the tool round is not a QueryRun');
    const queryRunRef = round.ctx.principal.queryRunRef;
    if (tool === 'request_rework') {
      const value = receipt as { status?: string; value?: { kind?: string; requeue?: { newInputRefs?: unknown } } };
      expect(value).toMatchObject({ status: 'committed', value: { kind: 'requeued' } });
      expect(value.value?.requeue?.newInputRefs).toEqual([{ kind: 'session_message', ref: inquiry }]);
      expect(await reworkEntries(p1, p1.task.tC)).toMatchObject([{ automatic: true, autoCount: 1,
        requestedBy: { kind: 'agent', queryRunRef } }]);
    } else {
      const after = ready<RoundChain>(await p1.world.post('verification/round',
        plain(S6A_SCOPE, { subjectRunRef: p1.runC })), 'the check rounds').chain;
      // P1's tC has one failed check round; the successor is the second.
      expect(after.rounds).toHaveLength(2);
      const successor = ready<RoundChain>(await p1.world.post('verification/round',
        plain(S6A_SCOPE, { roundRef: after.rounds.at(-1)!.roundRef })), 'the successor round').chain;
      expect(successor.reverify?.newInputRefs).toEqual([{ kind: 'session_message', ref: inquiry }]);
    }
  });
});

describe('P3 ② rejects: a basis the owner does not accept; the tool errors and nothing is written', () => {
  type RejectCase = {
    name: string; tool: 'request_rework' | 'request_recheck'; reason: string; running?: true;
    basis(p1: P1World): Promise<SessionMessageRef>;
  };
  /* Basis `:827②`, `:399`; owners `no-progress.ts:75/78`, `mailbox-access.ts:101`. Each cell is its own world and
     expects the tool's `execution_failed` with its own sentence, then `tasks/query` 0 -> 0. Named mutations:
     own reply -> delete `repliedByCaller`; no reply -> delete `status !== responded`; unreadable -> delete the
     mailbox read right. */
  const cases: readonly RejectCase[] = [
    { name: 'own reply (rework)', tool: 'request_rework', reason: 'an own reply is not a new basis',
      basis: p1 => answered(p1, p1.lines.S, p1.lines.A, 'own') },
    // E's line is held at tB's model request (the `running` world), so the question stays unanswered.
    { name: 'no reply yet (recheck)', tool: 'request_recheck', reason: 'only a responded message is a new basis',
      running: true, basis: p1 => ask(p1, p1.lines.A, p1.lines.E, 'no-reply') },
    // S asks E2 and E2 answers: neither addressed to A nor sent by A.
    { name: 'unreadable (rework)', tool: 'request_rework', reason: 'not addressed to or sent by the caller Session',
      basis: p1 => answered(p1, p1.lines.S, p1.lines.E2, 'unreadable') },
  ];
  it.each(cases)('$name', async (row) => {
    const p1 = await worlds.open(row.running === undefined ? {} : { running: row.running });
    const basis = await row.basis(p1);
    expect(await reworkEntries(p1, p1.task.tC), 'no rework entry before the call').toEqual([]);
    const roundsBefore = row.tool === 'request_recheck'
      ? ready<RoundChain>(await p1.world.post('verification/round',
        plain(S6A_SCOPE, { subjectRunRef: p1.runC })), 'the check rounds').chain.rounds.length
      : null;
    const { receipt } = await toolRound(p1, `reject-${row.tool}`, `p3-${row.name}`, row.tool,
      await toolInput(p1, row.tool, basis, `P3 ${row.name}`));
    expect(receipt, 'the tool receipt exists').toBeDefined();
    const refused = receipt as { status?: string; error?: { code?: string; message?: string } };
    if (row.tool === 'request_recheck') {
      const after = ready<RoundChain>(await p1.world.post('verification/round',
        plain(S6A_SCOPE, { subjectRunRef: p1.runC })), 'the check rounds').chain;
      expect(after.rounds, 'the refusal opens no successor round').toHaveLength(roundsBefore!);
    }
    expect(refused.status, JSON.stringify(receipt)).toBe('error');
    expect(refused.error?.code, JSON.stringify(receipt)).toBe('execution_failed');
    expect(refused.error?.message).toContain(row.reason);
    expect(await reworkEntries(p1, p1.task.tC), 'the refusal writes no rework entry').toEqual([]);
  });
});
