/**
 * 8E2 S: the scribe reminder counts broken links (slice-8E2-SPEC §2.6 :469–:484,
 * §4.1 E10 :703–:714, §4.3 E2-19a–c :842–:844; 8e2s-rulings.md:8–:12, L8 at :12).
 * Four rows, one world each, memory only, `finally` closes it; expected values are
 * the spec/ruling literals, never generated from a production call:
 * - E2-19a (:842): five K2 links broken by a line inserted before `compose.ts` line
 *   1; one heartbeat sends once, "断了的联系 5 条".
 * - E2-19b (:843): one broken link: nothing at first, then "断了的联系 1 条" ten
 *   injected minutes later.
 * - E2-19c (:844): K1 breaks in a real Work Run held at its next model request;
 *   nothing is due while it runs, and after it ends the age starts at the end —
 *   the immediate heartbeat sends nothing, ten minutes later it does.
 * - S-L8 (8e2s-rulings.md:12): identity `broken:<noteId>@<version>`; the digest is
 *   a hand-computed literal for the pinned `s8e-note-01@1`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LocalWorkbenchHostOptions } from '../../src/app/host.js';
import type { WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import type { SessionMailboxPort } from '../../src/core/work-graph/model/communication-contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { heartbeat } from '../helpers/IV-host-fixture.js';
import { sessionOf } from '../helpers/S7A-fixture.js';
import {
  openS8ESemanticWorld, s8eLinkDraft, s8eLinkPage, s8eLinkVerification, S8E_LINKS, S8E_SEMANTIC_WORLD_FILES,
} from '../helpers/S8E-semantic-world.js';

/** `sha256Hex(canonicalJson(['broken:s8e-note-01@1']))`, hand-computed. */
const BROKEN_DIGEST = 'f5b9422a972777aa1fb402e7a2186a6155ef924adce7cfaf2804aa19767d762b';

/** One noteId sequence per world; every `it` builds its own (never shared). */
function noteIds(): () => string {
  let n = 0;
  return () => `s8e-note-${String(++n).padStart(2, '0')}`;
}

describe('8E-2 S: the scribe reminder counts broken links', () => {
  it('E2-19a (:842) five broken links reach the threshold and send once, "断了的联系 5 条"', async () => {
    // 具名改坏：host.ts 判门删掉 `|| bucket.brokenCount >= SCRIBE_BROKEN_LINK_THRESHOLD`（或 5 改 6）→ 红在 `expect(sent).toHaveLength(1)`。
    const sent: { requestId: string; text: string; recipient: string }[] = [];
    let forward: SessionMailboxPort['sendMessage'] | null = null;
    const send = (async (ctx: CoreCallContext, request: { input: { recipient: SessionRef; text: string }; meta: { requestId: string } }) => {
      sent.push({ requestId: request.meta.requestId, text: request.input.text,
        recipient: request.input.recipient.sessionId });
      if (forward === null) throw new Error('S: the world is not open yet');
      return await forward(ctx, request as never);
    }) as NonNullable<LocalWorkbenchHostOptions['sendScribeReminder']>;
    const world = await openS8ESemanticWorld({ scribeTasks: 3, noteNewId: noteIds(),
      hostOptions: { scribeReminderPeriodMs: 25, sendScribeReminder: send } });
    try {
      forward = world.platform.messages.sendMessage.bind(world.platform.messages);
      const ids: string[] = [];
      for (const topic of ['K2-s-a', 'K2-s-b', 'K2-s-c', 'K2-s-d', 'K2-s-e']) {
        const write = await world.writePerson(s8eLinkDraft(S8E_LINKS.K2, { topic }));
        expect(write.status).toBe('accepted');
        if (write.status !== 'accepted') throw new Error(`the ${topic} write was not accepted`);
        ids.push(write.noteId);
      }
      expect(ids).toEqual(['s8e-note-01', 's8e-note-02', 's8e-note-03', 's8e-note-04', 's8e-note-05']);
      await writeFile(join(world.root, 'src/compose.ts'), ['// touched', ...(await readFile(join(world.root, 'src/compose.ts'), 'utf8')).split('\n')].join('\n'), 'utf8');
      const verifications = new Map((await s8eLinkPage(world)).map(item => [item.noteId, item.verification]));
      for (const noteId of ids) expect(verifications.get(noteId)).toEqual({ status: 'broken', missing: [0] });

      for (let i = 0; i < 3; i++) await heartbeat(world, 25);   // one heartbeat
      const scribe = await sessionOf(world, world.scribeLine);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.text).toContain('断了的联系 5 条');
      expect(sent[0]!.recipient).toBe(scribe.ref.sessionId);
      expect(sent[0]!.requestId.startsWith(
        `scribe-reminder:${world.scope.workspaceId}:${scribe.ref.sessionId}:`)).toBe(true);
    } finally { await world.close(); }
  }, 300_000);

  it('E2-19b (:843) one broken link sends nothing at first, then "断了的联系 1 条" after ten minutes', async () => {
    // 具名改坏：host.ts 逐桶门把 `!cursorChanged && state.brokenKeys.get(key) === nextKey` 恒改成 true（只比 cursor）→ 第二次心跳不重算，红在最后的 `expect(sent).toHaveLength(1)`。
    const sent: { requestId: string; text: string; recipient: string }[] = [];
    let forward: SessionMailboxPort['sendMessage'] | null = null;
    const send = (async (ctx: CoreCallContext, request: { input: { recipient: SessionRef; text: string }; meta: { requestId: string } }) => {
      sent.push({ requestId: request.meta.requestId, text: request.input.text,
        recipient: request.input.recipient.sessionId });
      if (forward === null) throw new Error('S: the world is not open yet');
      return await forward(ctx, request as never);
    }) as NonNullable<LocalWorkbenchHostOptions['sendScribeReminder']>;
    const world = await openS8ESemanticWorld({ scribeTasks: 3, noteNewId: noteIds(),
      hostOptions: { scribeReminderPeriodMs: 25, sendScribeReminder: send } });
    try {
      forward = world.platform.messages.sendMessage.bind(world.platform.messages);
      const write = await world.writePerson(s8eLinkDraft(S8E_LINKS.K2, { topic: 'K2-s-b' }));
      expect(write.status).toBe('accepted');
      if (write.status !== 'accepted') throw new Error('the K2 write was not accepted');
      expect(write.noteId).toBe('s8e-note-01');
      await writeFile(join(world.root, 'src/compose.ts'), ['// touched', ...(await readFile(join(world.root, 'src/compose.ts'), 'utf8')).split('\n')].join('\n'), 'utf8');
      expect(await s8eLinkVerification(world, write.noteId, write.version))
        .toEqual({ status: 'broken', missing: [0] });

      for (let i = 0; i < 3; i++) await heartbeat(world, 25);   // one heartbeat: 1 < 5, age 0
      expect(sent).toHaveLength(0);
      world.clock.advance(600_000);                             // ten injected minutes
      for (let i = 0; i < 3; i++) await heartbeat(world, 25);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.text).toContain('断了的联系 1 条');
    } finally { await world.close(); }
  }, 300_000);

  it('E2-19c (:844) a Run in flight does not count; after it ends the age starts at its end', async () => {
    // 具名改坏：host.ts 计时把 heldByRun 非空且 has 为假的 `startedAtMs = max(firstSeenMs, Date.parse(ended))` 改成 `firstSeenMs` → 第 9 步（Run 刚结束）就发，红在 `expect(sent).toHaveLength(0)`。
    const sent: { requestId: string; text: string; recipient: string }[] = [];
    let forward: SessionMailboxPort['sendMessage'] | null = null;
    const send = (async (ctx: CoreCallContext, request: { input: { recipient: SessionRef; text: string }; meta: { requestId: string } }) => {
      sent.push({ requestId: request.meta.requestId, text: request.input.text,
        recipient: request.input.recipient.sessionId });
      if (forward === null) throw new Error('S: the world is not open yet');
      return await forward(ctx, request as never);
    }) as NonNullable<LocalWorkbenchHostOptions['sendScribeReminder']>;
    const world = await openS8ESemanticWorld({ scribeTasks: 3, noteNewId: noteIds(),
      extraBindings: [{ binding: { id: 's6a-scribe-binding' } as WorkbenchRuntimeBinding,
        mergeTools: ['write'], mergeWriteScope: ['.'] }],
      hostOptions: { scribeReminderPeriodMs: 25, sendScribeReminder: send } });
    try {
      forward = world.platform.messages.sendMessage.bind(world.platform.messages);
      const k1 = await world.writePerson(s8eLinkDraft(S8E_LINKS.K1));
      expect(k1.status).toBe('accepted');
      if (k1.status !== 'accepted') throw new Error('the K1 write was not accepted');
      const task = world.nextScribeTask();
      const session = await sessionOf(world, world.scribeLine);
      const permit = S8E_SEMANTIC_WORLD_FILES.find(file => file.path === 'src/wg/permit.ts')!.content;
      world.scriptReplies([
        { kind: 'calls', calls: [{ callId: 'e2-19c-edit', name: 'edit', args: {
          mode: 'replace', path: 'src/wg/permit.ts',
          oldText: 'export async function authorize(id: string): Promise<void> {',
          newText: 'export async function authorise(id: string): Promise<void> {',
          expectedRevision: sha256Hex(permit),
        } }] },
        { kind: 'text', text: 'after edit' },
      ]);
      // `edit` is a Kernel builtin, not an extension tool, so the fixture's tool hold cannot catch it (S6A-host-fixture.ts:38).
      // Hold the first model request, release it so the `edit` runs, then hold the next: the edit landed, the Run is in flight.
      const firstModel = await world.gates.modelRequest(session);
      const modelGate = await world.gates.modelRequest(session);
      const driving = driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: world.goalRef,
        flowId: 'e2-19c-run', sessionHint: world.scribeLine.ref, kind: 'select_work', taskId: task.taskId });
      await firstModel.reached;
      firstModel.release();                                     // the scripted `edit` call runs
      await modelGate.reached;                                  // K1 is broken [1] with this Run held
      for (let i = 0; i < 3; i++) await heartbeat(world, 25);
      expect(sent).toHaveLength(0);                             // the Run is in flight
      world.clock.advance(600_000);
      for (let i = 0; i < 3; i++) await heartbeat(world, 25);
      expect(sent).toHaveLength(0);                             // ten minutes after first seen, still in flight
      modelGate.release();
      await driving;                                            // the Run ends; its end time is now
      for (let i = 0; i < 3; i++) await heartbeat(world, 25);
      expect(sent).toHaveLength(0);                             // age 0 from the end, not from first seen
      world.clock.advance(600_000);
      for (let i = 0; i < 3; i++) await heartbeat(world, 25);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.text).toContain('断了的联系 1 条');
    } finally { await world.close(); }
  }, 300_000);

  it('S-L8 (8e2s-rulings.md:12) the request identity is broken:<noteId>@<version>', async () => {
    // 具名改坏：host.ts 请求号身份把 `'broken:' + noteId + '@' + version` 改成 `noteId + '@' + version` → 摘要变，红在 `toBe(...BROKEN_DIGEST)`。
    const sent: { requestId: string; text: string; recipient: string }[] = [];
    let forward: SessionMailboxPort['sendMessage'] | null = null;
    const send = (async (ctx: CoreCallContext, request: { input: { recipient: SessionRef; text: string }; meta: { requestId: string } }) => {
      sent.push({ requestId: request.meta.requestId, text: request.input.text,
        recipient: request.input.recipient.sessionId });
      if (forward === null) throw new Error('S: the world is not open yet');
      return await forward(ctx, request as never);
    }) as NonNullable<LocalWorkbenchHostOptions['sendScribeReminder']>;
    const world = await openS8ESemanticWorld({ scribeTasks: 3, noteNewId: noteIds(),
      hostOptions: { scribeReminderPeriodMs: 25, sendScribeReminder: send } });
    try {
      forward = world.platform.messages.sendMessage.bind(world.platform.messages);
      const write = await world.writePerson(s8eLinkDraft(S8E_LINKS.K2, { topic: 'K2-s-l8' }));
      expect(write.status).toBe('accepted');
      if (write.status !== 'accepted') throw new Error('the K2 write was not accepted');
      expect(write.noteId).toBe('s8e-note-01');
      expect(write.version).toBe(1);
      const scribeSessionId = (await sessionOf(world, world.scribeLine)).ref.sessionId;
      await writeFile(join(world.root, 'src/compose.ts'), ['// touched', ...(await readFile(join(world.root, 'src/compose.ts'), 'utf8')).split('\n')].join('\n'), 'utf8');
      expect(await s8eLinkVerification(world, write.noteId, write.version))
        .toEqual({ status: 'broken', missing: [0] });

      for (let i = 0; i < 3; i++) await heartbeat(world, 25);   // 1 < 5 and age 0: nothing
      expect(sent).toHaveLength(0);
      world.clock.advance(600_000);
      for (let i = 0; i < 3; i++) await heartbeat(world, 25);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.requestId).toBe(
        `scribe-reminder:${world.scope.workspaceId}:${scribeSessionId}:${BROKEN_DIGEST}`);
      // Consistency only; the identity above is the literal.
      expect(sha256Hex(canonicalJson(['broken:s8e-note-01@1']))).toBe(BROKEN_DIGEST);
      expect(BROKEN_DIGEST).not.toBe(sha256Hex(canonicalJson(['s8e-note-01@1'])));
    } finally { await world.close(); }
  }, 300_000);
});
