/**
 * S8E L3 R-context (sheet §6.3): the Work execution input's `notes` section on
 * the one S8E semantic world, with the real file key a task gets from its own
 * ended Run.
 *
 * E1: a real scribe Work Run's `record_note` writes K1 (`writeAgentLink`); the
 * Kernel-delivered `{write, check}` is the receipt, and the test asserts its
 * `noteId`/`version` before composing the frozen line.
 *
 * The g1 task first has a real execution that edits `src/runtime/run.ts` through
 * the Kernel's `edit` tool: the scribe binding is granted `write` and a write
 * scope over the world root (the fixture's optional pass-through), so the run's
 * edit is a real file mutation. The run then ends failed after the edit, so the
 * ended Run's `RunActivity` carries the changed file. The person requeues over
 * the public `tasks/requeue` route, the Workflow claims the requeue, and the
 * test stops before `prepare` so the third-slice preparation entry
 * `runtime.prepareExecution` assembles the run. `materials/openArtifact`
 * (`historical_explanation`) reads the manifest body.
 *
 * No context, Run, RunActivity, or note record is built by hand; no store is
 * read; no internal port is mocked.
 *
 * The `flow` kind is not written by L3 at all, so a flow row is unreachable
 * from this slice; the section's exact row set is the guard that no other kind
 * enters it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { ContextAssemblyBindingV1 } from '../../src/contracts/graph-context.js';
import type { WorkbenchRuntimeBinding } from '../../src/app/runtime-configuration.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { TaskRequeueOutcomeV1 } from '../../src/contracts/task-requeue.js';
import type { WriteNoteEnvelopeV1 } from '../../src/core/work-graph/model/note-contracts.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCRIBE_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import {
  openS8ESemanticWorld, S8E_LINKS, S8E_SCOPE, S8E_SEMANTIC_WORLD_FILES,
  type S8ESemanticWorld,
} from '../helpers/S8E-semantic-world.js';

type TaskGraphRow = { ref: { taskId: string }; execution: RunRef | null; effectivePhase?: string };

/** The exact lines of one rendered `##` section, without its header and trailing blank lines. */
function sectionLines(input: string, header: string): string[] {
  const lines = input.split('\n');
  const start = lines.indexOf(header);
  if (start < 0) throw new Error(`the prepared input has no ${header} section`);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    body.push(line);
  }
  while (body.length > 0 && body[body.length - 1] === '') body.pop();
  return body;
}

/** The row as the graph reads it (the public task read). */
async function taskRow(world: S8ESemanticWorld, taskId: string): Promise<TaskGraphRow> {
  const graph = await world.route('tasks/query', { goalRef: world.goalRef }) as
    ReadResult<{ tasks: TaskGraphRow[] }>;
  if (graph.status !== 'ready') throw new Error(`tasks/query was not ready: ${JSON.stringify(graph)}`);
  const row = graph.value.tasks.find(candidate => candidate.ref.taskId === taskId);
  if (row === undefined) throw new Error(`the task ${taskId} is not in the graph`);
  return row;
}

async function runRefOf(world: S8ESemanticWorld, taskId: string): Promise<RunRef> {
  const row = await taskRow(world, taskId);
  if (row.execution === null) throw new Error(`the task ${taskId} has no Run: ${JSON.stringify(row)}`);
  return row.execution;
}

describe('S8E L3 R-context: the work input notes section', () => {
  let world: S8ESemanticWorld;
  let task: TaskTriple;
  let k1Id: string;
  let k1Version: number;
  let input: string;
  let binding: ContextAssemblyBindingV1;
  let run1Ref: RunRef;
  let run2Ref: RunRef;

  beforeAll(async () => {
    world = await openS8ESemanticWorld({
      scribeTasks: 3,
      // The fixture's optional pass-through: the scribe binding gets the Host
      // `write` capability (the Kernel's `edit`) and a scope covering the world
      // root, so g1's real run can change src/runtime/run.ts. Defaults unchanged.
      extraBindings: [{ binding: { id: 's6a-scribe-binding' } as WorkbenchRuntimeBinding,
        mergeTools: ['write'], mergeWriteScope: ['.'] }],
    });
    task = world.tasks[0]!;
    const k1Task = world.tasks[1]!;

    // E1: the real scribe Work Run writes K1, on its own Plan task.
    const written = await world.writeAgentLink(S8E_LINKS.K1, { taskId: k1Task.taskId, label: 'r-context-k1' });
    const receipt: WriteNoteEnvelopeV1 | null = written.envelope;
    if (receipt === null) throw new Error('E1: the record_note result carried no {write, check}');
    const k1 = receipt.write;
    if (k1.status !== 'accepted') throw new Error(`E1: K1 was not accepted: ${JSON.stringify(k1)}`);
    // The receipt's id/version are asserted before the frozen literal is built.
    expect(k1.version).toBe(1);
    expect(k1.noteId.length).toBeGreaterThan(0);
    k1Id = k1.noteId;
    k1Version = k1.version;
    expect(receipt.check).toMatchObject({ noteId: k1Id, linkVerification: { status: 'verified' } });

    // The g1 task's line; the run below claims it.
    const ws = s6aCardsWorkspace(world, world.scope);
    const line = await createS6BLine(ws, {
      label: 's8e-r-context', role: S6A_SCRIBE_ROLE, tasks: [task],
    });

    // The real execution: the Kernel `edit` changes run.ts; the next model reply
    // fails the Run so its Task can be requeued (the edit's RunActivity is the
    // changed-file fact the next preparation reads).
    const runTs = S8E_SEMANTIC_WORLD_FILES.find(file => file.path === 'src/runtime/run.ts')?.content;
    if (runTs === undefined) throw new Error('the §5.2 tree has no src/runtime/run.ts');
    const before = world.model.calls();
    world.clock.advance(1000);
    world.scriptReplies([
      { kind: 'calls', calls: [{ callId: 's8e-r-context-edit', name: 'edit', args: {
        mode: 'replace', path: 'src/runtime/run.ts',
        oldText: '  await access.beforeCall(id);',
        newText: '  await access.beforeCall(id);\n  // S8E R-context: the real edited run\n',
        // The revision of the file the fixture wrote (a read-before-edit value).
        expectedRevision: sha256Hex(runTs),
      } }] },
      { kind: 'error', code: 's8e_r_context_after_edit' },
    ]);
    const firstSteps = await driveWorkflow(world.ag2b, {
      schemaVersion: 1, goalRef: world.goalRef, flowId: 's8e-r-context-run-1',
      sessionHint: line.ref, kind: 'select_work', taskId: task.taskId,
    }, { stopBefore: 'requeue_task' });
    expect(world.model.calls()).toBe(before + 2);
    expect(firstSteps.at(-1)?.state).not.toBe('completed');
    const failedRow = await taskRow(world, task.taskId);
    expect(failedRow.effectivePhase).toBe('failed');
    run1Ref = await runRefOf(world, task.taskId);

    // The public operator requeue, pinned to the Goal and the afterRun as read.
    const goal = await world.route('goals/read', world.goalRef) as ReadResult<{ goal: GoalSnapshot }>;
    if (goal.status !== 'ready') throw new Error(`goals/read was not ready: ${JSON.stringify(goal)}`);
    const execution = await world.route('executions/read', run1Ref) as
      ReadResult<{ run: { revision: number } }>;
    if (execution.status !== 'ready') throw new Error(`executions/read was not ready: ${JSON.stringify(execution)}`);
    const requeued = (await world.post('tasks/requeue', graphWrite(S8E_SCOPE, {
      taskRef: task, afterRunRef: run1Ref, reason: 'S8E R-context: the edited run failed',
    }, 's8e-r-context-requeue', [
      { ref: world.goalRef, revision: goal.value.goal.revision },
      { ref: run1Ref, revision: execution.value.run.revision },
    ]))).body as WriteResult<TaskRequeueOutcomeV1>;
    if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') {
      throw new Error(`the public requeue was refused: ${JSON.stringify(requeued)}`);
    }

    // The Workflow claims the requeue; stop before `prepare` so the test itself
    // calls the preparation entry on the still-`starting` Run.
    const secondSteps = await driveWorkflow(world.ag2b, {
      schemaVersion: 1, goalRef: world.goalRef, flowId: 's8e-r-context-run-2',
      sessionHint: line.ref, kind: 'select_work', taskId: task.taskId,
    }, { stopBefore: 'prepare' });
    expect(secondSteps.at(-1)?.next).toMatchObject({ kind: 'perform', operation: { kind: 'prepare' } });
    run2Ref = await runRefOf(world, task.taskId);
    expect(run2Ref.runId).not.toBe(run1Ref.runId);

    // The ended Run's last safe point may have sent K1 to the background check; check it once so the
    // notes section below does not depend on whether that check has answered yet.
    const checked = await world.route('architecture/semantic-links/check',
      { items: [{ noteId: k1Id, version: k1Version }] });
    expect(checked).toMatchObject({ status: 'ready', value: { items: [{ verification: { status: 'verified' } }] } });
    const prepared = await world.platform.runtime.prepareExecution(world.humanContext(), {
      runRef: run2Ref, requestId: 's8e-r-context-prepare',
    });
    if (prepared.status !== 'ready') {
      throw new Error(`prepareExecution was not ready: ${JSON.stringify(prepared)}`);
    }
    expect(prepared.value.claim.task.taskId).toBe(task.taskId);

    const artifact = await world.platform.materials.openArtifact(world.humanContext(), {
      ref: prepared.value.envelope.bundleRef, usage: 'historical_explanation',
    });
    if (artifact.status !== 'ready') {
      throw new Error(`the prepared manifest was not readable: ${JSON.stringify(artifact)}`);
    }
    const manifest = JSON.parse(artifact.value.body) as {
      input?: unknown; contextAssembly?: ContextAssemblyBindingV1;
    };
    if (typeof manifest.input !== 'string') throw new Error('the prepared manifest has no string input');
    if (manifest.contextAssembly === undefined) {
      throw new Error('the prepared manifest has no contextAssembly binding');
    }
    input = manifest.input;
    binding = manifest.contextAssembly;
  }, 300_000);

  afterAll(async () => { await world?.close(); });

  it('the notes section carries the frozen K1 link row from the ended Run\'s changed file', () => {
    const rows = sectionLines(input, '## Note index');
    const expected = `联系·注入(src/runtime/run.ts#runModel→src/wg/permit.ts#authorize)：`
      + `runModel authorizes through beforeCall（${k1Id} v${String(k1Version)}）`;
    expect(rows).toEqual([expected]);
    // The exact row set above already excludes a flow row; keep the explicit guard.
    expect(rows.join('\n')).not.toContain('流程');
  }, 60_000);

  it('notes stays one of the four optional sections under the one shared resident budget', () => {
    const OPTIONAL = ['footprint', 'notes', 'reminders', 'inputs'];
    expect(binding.sectionOrder).toContain('notes');
    const optional = binding.sectionOrder.filter(name => OPTIONAL.includes(name));
    // `notes` is one of exactly the four optional sections; the template's own
    // order is the frozen `sectionOrder` (inputs before reminders), not a
    // second order derived from the budget.
    expect(optional).toHaveLength(4);
    expect(optional).toEqual(expect.arrayContaining(OPTIONAL));
    // Unconfigured `contextResidentBytes` keeps the one shared 4096 default;
    // there is no separate link/notes budget.
    expect(binding.residentBudgetBytes).toBe(4096);
    const notesSection = binding.sections.find(section => section.name === 'notes');
    expect(notesSection).toBeDefined();
    expect(notesSection?.omitted).toBe(0);
  }, 60_000);
});
