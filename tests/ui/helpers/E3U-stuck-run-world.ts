import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { S6AReply } from '../../helpers/S6A-host-fixture.js';
import type { S6ASession } from '../../helpers/S6A-request-fixture.js';
import { openPLReadingsWorld, type PLReadingsWorld } from '../../helpers/PL-readings-fixture.js';

/**
 * E3U row ③'s world: the SHT-2 stuck-shell recipe on the PL readings fixture
 * (real Host, Work write/shell grant, one adopted Plan). The one Work Run's
 * first command never returns until `release()`, so its `executions/steps`
 * block stays live at a running step for the page's 5 s reread. With
 * `finishedFirst`, one completed shell runs before the stuck one (note 5b's
 * failed read must leave the finished command's own meta alone).
 *
 * The command writes its own start marker in the workspace root; the wait is
 * a bounded poll of that file, never `Date` (the world fakes `Date` alone).
 */
export type StuckRunWorld = {
  readonly fixture: PLReadingsWorld;
  readonly line: S6ASession;
  /** The page's own untouched line, only with `secondTask`; the stuck Run is on another line. */
  readonly own: S6ASession | null;
  /** Resolves once the stuck command's own marker exists in the workspace root. */
  started(): Promise<void>;
  /** Lets the stuck command return, then the Run's next scripted answer lands. */
  release(): Promise<void>;
  close(): Promise<void>;
};

/** The stuck shell's command; `started` is written by the shell itself before it blocks. */
function stuckShell(go: string, started: string): string {
  return `while [ ! -e ${go} ]; do : > ${started}; sleep 0.05; done; echo go`;
}

export async function openStuckRunWorld(label: string, options: { secondTask?: boolean; finishedFirst?: boolean } = {}): Promise<StuckRunWorld> {
  const go = `${label}-go`;
  const startedMarker = `${label}-started`;
  const second = options.secondTask === true;
  const fixture = await openPLReadingsWorld({ unlimitedRunLimits: true,
    ...(second ? { taskIds: [`${label}-own`, `${label}-work`] } : {}) });
  try {
    const own = second ? await fixture.line(`${label}-own`, [fixture.tasks[0]!]) : null;
    const task = fixture.tasks[second ? 1 : 0]!;
    const line = await fixture.line(label, [task]);
    const replies: S6AReply[] = [
      /* Note 5b: a finished command before the stuck one, so the failed
         running-commands read can be checked against its own meta. */
      ...(options.finishedFirst === true
        ? [{ kind: 'calls' as const, calls: [{ callId: `${label}-done`, name: 'shell',
          args: { command: `echo ${label}-done` } }] }]
        : []),
      { kind: 'calls', calls: [{ callId: `${label}-shell`, name: 'shell',
        args: { command: stuckShell(go, startedMarker) } }] },
      { kind: 'text', text: 'E3U row ③: the stuck command was released' },
    ];
    /* `runTask` drives the Workflow to completion, and the stuck command keeps
       that promise open: start it, never await it here. */
    const running = fixture.runTask({ line, taskId: task.taskId, flowId: label, replies });
    const world: StuckRunWorld = {
      fixture, line, own,
      async started(): Promise<void> {
        for (let attempt = 0; attempt < 500; attempt += 1) {
          if (existsSync(join(fixture.world.root, startedMarker))) return;
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
        }
        throw new Error(`E3U row ③: the stuck command never wrote ${startedMarker}`);
      },
      async release(): Promise<void> {
        await writeFile(join(fixture.world.root, go), 'go').catch(() => undefined);
      },
      async close(): Promise<void> {
        await world.release();
        await running.catch(() => undefined);
        await fixture.close().catch(() => undefined);
      },
    };
    return world;
  } catch (error) {
    await writeFile(join(fixture.world.root, go), 'go').catch(() => undefined);
    await fixture.close().catch(() => undefined);
    throw error;
  }
}
