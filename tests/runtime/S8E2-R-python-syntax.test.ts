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
 *
 * DPYG (B06-N1, lead 11-13): the check round's arm. One real Run ends normally after
 * changing drive.py; `workflow/advance` runs open_checks/run_check/finalize_checks and
 * `verification/round` is read back. The package is not in this tree today.
 * - DPG-1 (red today at the round's outcome: PASS with gaps []) is green once finalize
 *   parses the subject Run's `RunActivity` definite Python files and pushes
 *   `pythonSyntaxGaps(problems)` into `contextGaps` (one broken file ⇒ INCONCLUSIVE).
 *   Named mutation: delete that push (or the `deps.pythonSyntax` call) ⇒ red at the gap.
 * - DPG-2 (green today) named mutation: push a fake gap for a parsed file (or treat
 *   `parsed` as a problem) ⇒ red at `gaps: []`.
 * - DPG-3 (green today) named mutation: read `round.sourceProof.changedFiles` or the
 *   whole workspace instead of the Run's `definite` list ⇒ legacy.py enters the gap.
 * None of the three named mutations is demonstrated today: the production lines do not
 * exist in this tree, and src/ is outside this package's whitelist.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { VerificationRoundRef } from '../../src/contracts/verification.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { OPERATOR, S6A_SCRIBE_ROLE, S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine, type S6BLine } from '../helpers/S6B1-fixture.js';
import { checkConfiguration, ready, receiptOf } from '../helpers/S7A-fixture.js';
import { openS8ESemanticWorld, S8E_SEMANTIC_WORLD_FILES, type S8ESemanticWorld } from '../helpers/S8E-semantic-world.js';
import { gitIn } from '../scenarios/support/git-workspace.js';

const fileText = (path: string): string => S8E_SEMANTIC_WORLD_FILES.find(candidate => candidate.path === path)!.content;
const DRIVE_TEXT = fileText('src/robot/drive.py');
const TELEOP_TEXT = fileText('src/robot/teleop.py');
/** The step-1 result: drive.py with line 1 broken and line 2 unchanged. */
const BAD_DRIVE_TEXT = DRIVE_TEXT.replace('def main(node):', 'def broken(:');

/** The Host the check round runs in: the world's own one static echo check covers `ag2b-static`. */
const CHECK_HOST = { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) };
const WRITE_GRANT = { binding: { id: 's6a-scribe-binding' } as WorkbenchRuntimeBinding,
  mergeTools: ['write'], mergeWriteScope: ['.'] };

/** A scribe line for the world's first Plan task (the world's own Goal and Plan). */
async function scribeLine(world: S8ESemanticWorld, label: string): Promise<S6BLine> {
  return await createS6BLine(s6aCardsWorkspace(world, world.scope),
    { label, role: S6A_SCRIBE_ROLE, tasks: [world.tasks[0]!] });
}

/** The `edit` call that replaces `oldText` in drive.py with `newText`. */
const editDrive = (callId: string, oldText: string, newText: string) => ({ callId, name: 'edit',
  args: { mode: 'replace', path: 'src/robot/drive.py', oldText, newText, expectedRevision: sha256Hex(DRIVE_TEXT) } });

type CheckRound = { status: string; outcome: string | null; gaps: readonly { code: string; message: string }[] };

/**
 * One real Run that ends normally (its `calls`, then a text answer), driven through
 * `open_checks`/`run_check`/`finalize_checks` and stopped before `complete_task`; the
 * subject Run's round read back through `verification/round`.
 */
async function checkedRound(world: S8ESemanticWorld, line: S6BLine, task: TaskTriple, label: string,
  calls: readonly { callId: string; name: string; args: Record<string, unknown> }[]): Promise<CheckRound> {
  world.clock.advance(1000);
  world.scriptReplies([{ kind: 'calls', calls }, { kind: 'text', text: `S8E ${label} done` }]);
  const claim = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: world.goalRef,
    flowId: `s8e-${label}`, sessionHint: line.ref, kind: 'select_work', taskId: task.taskId }, 'claim_task');
  const receipts: WorkflowStepReceipt[] = [];
  const steps = await driveWorkflow(world.ag2b, claim, { receipts, stopBefore: 'open_checks' });
  const open = steps.at(-1)?.next;
  if (open?.kind !== 'perform' || open.operation.kind !== 'open_checks') {
    throw new Error(`S8E ${label}: the Workflow did not reach open_checks: ${JSON.stringify(open)}`);
  }
  await driveWorkflow(world.ag2b, open, { receipts,
    stopBefore: () => receiptOf(receipts, 'finalize_checks') !== undefined });
  const tool = world.model.requests.flatMap(request => request.messages)
    .find(message => message.role === 'tool' && message.callId === calls[0]?.callId);
  if (tool?.role !== 'tool' || tool.result.status !== 'success') {
    throw new Error(`S8E ${label}: the scripted tool call did not land: ${JSON.stringify(tool)}`);
  }
  const opened = receiptOf(receipts, 'open_checks');
  if (opened?.result.status !== 'committed') throw new Error(`S8E ${label}: the round did not open`);
  const roundRef: VerificationRoundRef = opened.result.value.ref;
  return ready<CheckRound>(await world.post('verification/round', plain(S6A_SCOPE, { roundRef })),
    `the ${label} check round`);
}

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

describe('S8E-2 DPG: the check round records changed Python that does not parse', () => {
  it('DPG-1: a broken drive.py leaves one python_syntax_error gap and INCONCLUSIVE', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1, extraBindings: [WRITE_GRANT],
      hostOptions: CHECK_HOST });
    try {
      const round = await checkedRound(world, await scribeLine(world, 'dpg-1'), world.tasks[0]!, 'dpg-1',
        [editDrive('dpg-1', 'def main(node):', 'def broken(:')]);
      expect(round).toMatchObject({ status: 'finalized', outcome: 'INCONCLUSIVE' });
      expect(round.gaps).toEqual([{ code: 'python_syntax_error',
        message: expect.stringMatching(/^src\/robot\/drive\.py:1: /) }]);
    } finally { await world.close(); }
  });

  it('DPG-2: a Run that changes drive.py into valid Python finalizes PASS with no gap', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1, extraBindings: [WRITE_GRANT],
      hostOptions: CHECK_HOST });
    try {
      const round = await checkedRound(world, await scribeLine(world, 'dpg-2'), world.tasks[0]!, 'dpg-2',
        [editDrive('dpg-2', 'def main(node):', 'def main(node) -> None:')]);
      expect(round).toMatchObject({ status: 'finalized', outcome: 'PASS', gaps: [] });
    } finally { await world.close(); }
  });

  it('DPG-3: an uncommitted broken file this Run did not change is no gap', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1, extraBindings: [WRITE_GRANT],
      hostOptions: CHECK_HOST });
    try {
      gitIn(world.root, 'init', '-q', '-b', 'main');
      gitIn(world.root, 'add', '--', ...S8E_SEMANTIC_WORLD_FILES.map(file => file.path));
      gitIn(world.root, 'commit', '-q', '-m', 'S8E DPG baseline');
      await writeFile(join(world.root, 'src/robot/legacy.py'), 'def legacy(:\n    pass\n');
      const round = await checkedRound(world, await scribeLine(world, 'dpg-3'), world.tasks[0]!, 'dpg-3',
        [editDrive('dpg-3', 'def main(node):', 'def main(node) -> None:')]);
      expect(round).toMatchObject({ status: 'finalized', outcome: 'PASS', gaps: [] });
    } finally { await world.close(); }
  });
});
