/**
 * S8E-2 R run-end (E9, 8E-2 §4.1 :710): the platform input a real Work Run
 * gets at its next `before_model` safe point after it broke a link with a real
 * `edit` (R12 :394–419).
 *
 * Row and the spec lines its expectations come from:
 * - E2-13 (8E-2 :836; R5 :351, R12 :404, :407–417; the template's first draft
 *   :417, written by hand here): K1, K2, K4 all hang on src/wg/permit.ts (8E
 *   :705–708); g1's Run renames `authorize` to `authorise`; the second model
 *   request carries exactly one new `role: 'user'` message (the shape of
 *   S7B-L-host-gates.test.ts:156–160), the K1 break; K2 (doubtful, handed to
 *   the background second tier) and K4 (a literal key, still verified) are not
 *   in it. Then E3 reads K1 `broken [1]` and its "to" end retired. The
 *   background check K2 starts is not counted here (the brief).
 *
 * The links are person `notes/write` writes (E2), ids from the receipts; the
 * Run is the real Workflow `select_work` drive with the scribe binding granted
 * `write` (S8E-R-context.test.ts:89–96, :119–139).
 */
import { describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import type { SemanticLinkV1, SemanticPageV1 } from '../../src/contracts/semantic-layer.js';
import type { WriteNoteResult } from '../../src/core/work-graph/model/note-contracts.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCRIBE_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import {
  openS8ESemanticWorld, s8eLinkDraft, S8E_LINKS, S8E_SEMANTIC_WORLD_FILES, type S8ESemanticWorld,
} from '../helpers/S8E-semantic-world.js';

function idOf(write: WriteNoteResult): string {
  if (write.status !== 'accepted') throw new Error(`expected accepted, got ${JSON.stringify(write)}`);
  return write.noteId;
}

/** E3: the project page of `architecture/semantic-links`, the item by `noteId`. */
async function linkItem(world: S8ESemanticWorld, noteId: string): Promise<SemanticLinkV1> {
  const result = await world.route('architecture/semantic-links', { scope: { kind: 'project' }, cursor: null, limit: 100 });
  const read = result as ReadResult<SemanticPageV1<SemanticLinkV1>>;
  if (read.status !== 'ready') throw new Error(`the semantic read was not ready: ${JSON.stringify(result)}`);
  const item = read.value.items.find(candidate => candidate.noteId === noteId);
  if (item === undefined) throw new Error(`${noteId} is not on the semantic page`);
  return item;
}

describe('S8E-2 R run-end: the link-break input of a Run that edited a file', () => {
  it('E2-13 the next model request after renaming `authorize` carries one input, for K1 only', async () => {
    const world = await openS8ESemanticWorld({
      scribeTasks: 3,
      extraBindings: [{ binding: { id: 's6a-scribe-binding' } as WorkbenchRuntimeBinding,
        mergeTools: ['write'], mergeWriteScope: ['.'] }],
    });
    try {
      const k1 = idOf(await world.writePerson(s8eLinkDraft(S8E_LINKS.K1)));
      idOf(await world.writePerson(s8eLinkDraft(S8E_LINKS.K2)));
      idOf(await world.writePerson(s8eLinkDraft(S8E_LINKS.K4)));

      const task = world.tasks[0]!;
      const line = await createS6BLine(s6aCardsWorkspace(world, world.scope),
        { label: 's8e-r-run-end', role: S6A_SCRIBE_ROLE, tasks: [task] });
      const permit = S8E_SEMANTIC_WORLD_FILES.find(file => file.path === 'src/wg/permit.ts')!.content;
      const before = world.model.calls();
      world.clock.advance(1000);
      world.scriptReplies([
        { kind: 'calls', calls: [{ callId: 'e2-13-edit', name: 'edit', args: {
          mode: 'replace', path: 'src/wg/permit.ts',
          oldText: 'export async function authorize(id: string): Promise<void> {',
          newText: 'export async function authorise(id: string): Promise<void> {',
          expectedRevision: sha256Hex(permit),
        } }] },
        { kind: 'error', code: 'e2_13_after_edit' },
      ]);
      await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: world.goalRef, flowId: 'e2-13-run',
        sessionHint: line.ref, kind: 'select_work', taskId: task.taskId }, { stopBefore: 'requeue_task' });
      if (world.model.calls() !== before + 2) throw new Error('E2-13: the Run did not make its two model calls');

      // The second request's `role: 'user'` messages that the first one did not have.
      const usersOf = (index: number) => (world.model.requests[index]?.messages ?? [])
        .flatMap(message => message.role === 'user' ? [message] : []);
      const earlier = new Set(usersOf(before).map(message => message.messageId));
      expect(usersOf(before + 1).filter(message => !earlier.has(message.messageId)).map(message => message.content))
        .toEqual([`联系 ${k1}（版本 1）被这次改动改断了：证据对不上（下标 1）。交结果之前请重写或撤下它。`]);

      const read = await linkItem(world, k1);
      expect(read.verification).toEqual({ status: 'broken', missing: [1] });
      expect(read.to).toMatchObject({ anchorStatus: 'retired', anchorRetiredReasons: ['symbol_missing'] });
    } finally { await world.close(); }
  }, 300_000);
});
