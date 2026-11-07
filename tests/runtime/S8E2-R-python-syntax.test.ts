/**
 * R row 6: one chain, five model requests, one Run, one world.
 * The Run breaks drive.py (request 2), reads the same file
 * (request 3: nothing new), breaks teleop.py (request 4: only teleop) and then
 * changes drive.py without changing its line-1 error (request 5: only drive,
 * again). Each request carries only the new `role: 'user'` input; per-file
 * `inputId`s keep an accepted problem from being sent twice.
 *
 * Named mutation: `src/core/agent-runtime/execution-driver.ts` per-file
 * `inputId` reverted to a batch-summary
 * `sha256Hex(canonicalJson(python.map(({ path, digest, line }) => ({ path, digest, line }))))`
 * with all problems folded into one input; red at the 4th request (drive and
 * teleop appear together in the message that should only carry teleop).
 */
import { describe, expect, it } from 'vitest';
import type { WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCRIBE_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { openS8ESemanticWorld, S8E_SEMANTIC_WORLD_FILES } from '../helpers/S8E-semantic-world.js';

const fileText = (path: string): string => S8E_SEMANTIC_WORLD_FILES.find(candidate => candidate.path === path)!.content;
const DRIVE_TEXT = fileText('src/robot/drive.py');
const TELEOP_TEXT = fileText('src/robot/teleop.py');
/** The step-1 result: drive.py with line 1 broken and line 2 unchanged. */
const BAD_DRIVE_TEXT = DRIVE_TEXT.replace('def main(node):', 'def broken(:');

describe('S8E-2 R: the Python syntax-error input of a Run', () => {
  it('row 6: five requests carry one per-file syntax-error input each', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1, extraBindings: [{
      binding: { id: 's6a-scribe-binding' } as WorkbenchRuntimeBinding,
      mergeTools: ['write'], mergeWriteScope: ['.'],
    }] });
    try {
      const task = world.tasks[0]!;
      const line = await createS6BLine(s6aCardsWorkspace(world, world.scope),
        { label: 's8e2-r-python-syntax', role: S6A_SCRIBE_ROLE, tasks: [task] });
      world.clock.advance(1000);
      const before = world.model.calls();
      world.scriptReplies([
        { kind: 'calls', calls: [{ callId: 'py-chain-1', name: 'edit', args: {
          mode: 'replace', path: 'src/robot/drive.py', oldText: 'def main(node):', newText: 'def broken(:',
          expectedRevision: sha256Hex(DRIVE_TEXT) } }] },
        { kind: 'calls', calls: [{ callId: 'py-chain-2', name: 'read',
          args: { path: 'src/robot/drive.py' } }] },
        { kind: 'calls', calls: [{ callId: 'py-chain-3', name: 'edit', args: {
          mode: 'replace', path: 'src/robot/teleop.py', oldText: 'def start(node):', newText: 'def start(:',
          expectedRevision: sha256Hex(TELEOP_TEXT) } }] },
        { kind: 'calls', calls: [{ callId: 'py-chain-4', name: 'edit', args: {
          mode: 'replace', path: 'src/robot/drive.py',
          oldText: "    node.create_subscription(Twist, '/cmd_vel', on_twist, 10)",
          newText: "    node.create_subscription(Twist, '/cmd_vel', on_twist, 10)  # touched",
          expectedRevision: sha256Hex(BAD_DRIVE_TEXT) } }] },
        { kind: 'error', code: 'python_chain_done' },
      ]);
      await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: world.goalRef,
        flowId: 's8e2-r-python-syntax', sessionHint: line.ref, kind: 'select_work', taskId: task.taskId },
      { stopBefore: 'requeue_task' });
      expect(world.model.calls()).toBe(before + 5);

      const usersOf = (index: number) => (world.model.requests[index]?.messages ?? [])
        .flatMap(message => message.role === 'user' ? [message] : []);
      /** The `role: 'user'` messages of request `index` that request `index - 1` did not already carry. */
      const fresh = (index: number) => {
        const earlier = new Set(usersOf(index - 1).map(message => message.messageId));
        return usersOf(index).filter(message => !earlier.has(message.messageId)).map(message => message.content);
      };
      /** One input, for `at`, saying to fix the syntax first, and nothing about the `absent` paths. */
      const expectSyntaxInput = (index: number, at: RegExp, ...absent: string[]): void => {
        const inputs = fresh(index);
        expect(inputs).toHaveLength(1);
        expect(inputs[0]).toMatch(at);
        expect(inputs[0]).toContain('先改语法错');
        for (const path of absent) expect(inputs[0]).not.toContain(path);
      };
      expectSyntaxInput(before + 1, /^Python 文件有语法错：src\/robot\/drive\.py:1: /);
      expect(fresh(before + 2)).toEqual([]);
      expectSyntaxInput(before + 3, /^Python 文件有语法错：src\/robot\/teleop\.py:1: /, 'src/robot/drive.py');
      expectSyntaxInput(before + 4, /^Python 文件有语法错：src\/robot\/drive\.py:1: /, 'src/robot/teleop.py');
    } finally { await world.close(); }
  }, 300_000);
});
