import { findClass, type BootedPage } from './boot-page.js';
import { descendants, hasClass, openAuxFile, textOf, waitFor, type PageLog } from './E3N-page.js';
import { click } from './E3N-interact.js';
import { buttonText } from './E3M-world.js';
import { plain } from '../../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE, type S6ARequestWorld } from '../../helpers/S6A-request-fixture.js';

/**
 * The steps GAPB-8 and GAPB-9 share beyond `E3D-page`: the composer's `.to`
 * sentence, the conflict card's Goal, and taking `src/module.ts`'s line into the
 * draft. The file page's walk is `openAuxFile` (E3N-page), the one the E3U main
 * rows use as well.
 */
export function composerNote(page: BootedPage): string {
  const foot = findClass(page.root, 'composer-foot');
  return foot === undefined ? '' : textOf(findClass(foot, 'to'));
}

type QueueCard = { source: { kind: string }; subject: { goalRef?: { goalId: string } } };

/** The conflict card's Goal, read through `decisions/queue` before the page boots. */
export async function conflictGoal(world: S6ARequestWorld): Promise<string> {
  const read = (await world.post('decisions/queue', plain(S6A_SCOPE, { workspace: S6A_SCOPE,
    sections: ['waiting_answer'], page: { limit: 100 } }))).body as { value?: { waitingAnswer?: QueueCard[] } };
  const conflict = (read.value?.waitingAnswer ?? []).find((entry) => entry.source.kind === 'goal_conflict');
  if (conflict?.subject.goalRef === undefined) throw new Error('GAPB: W1 has no conflict card');
  return conflict.subject.goalRef.goalId;
}

/** 文件 -> src/module.ts -> one line -> 引用到草稿. */
export async function quoteModuleLine(page: BootedPage, log: PageLog, line = 1): Promise<void> {
  await openAuxFile(page, log, 'src/module.ts');
  const code = findClass(page.root, 'fcode')!;
  const number = descendants(code).find((element) => hasClass(element, 'fl-n') && textOf(element) === String(line));
  if (number === undefined) throw new Error(`GAPB: the file page has no line ${line}`);
  click(number);
  click(buttonText(findClass(page.root, 'fp-bar'), '引用到草稿')!);
  await waitFor(() => findClass(page.root, 'composer-quote') !== undefined);
}
