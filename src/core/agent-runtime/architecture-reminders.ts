/**
 * Slice 8 L8 (spec L8; book rulings 9–11): the PURE architecture reminder row
 * builder. It renders the stale-architecture section rows the context assembler
 * appends to `reminders`; it reads no store, no clock and no workspace.
 *
 * The findings are the existing `compareFormalObservedGraphs` output supplied in
 * `facts.findings` — this module never re-implements the comparison. Moves are
 * the separate ruling-9 rule over the two full node lists (deleted/added pairs
 * whose digest is carried by exactly one path on each side), never `diffContent`.
 *
 * Order: kind (dependency_missing, import_undeclared, ungrouped, move), then by
 * path, then by the rest of the row. At most 10 rows, then one omission line.
 * No successful observation -> `还没有观测`; no row -> `[]`.
 */
import type { AdoptedArchitecture, ModuleDefinition } from '../../contracts/architecture-catalog.js';
import type {
  ArchitectureReminderFactsV1, ArchitectureReminderObservationV1,
} from '../../contracts/architecture-observation.js';
import type { FormalObservedFindingV1 } from '../../contracts/architecture-inspection.js';
import type { ModuleRef } from '../../contracts/core/identity.js';
import { bestModuleDirectoryPrefixLength, pathOwnershipOf } from '../../contracts/path-ownership.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import type { PromptTextsV1 } from '../../contracts/prompts/prompt-set.js';

/** One rendered reminder row with the deterministic key ruling 11 asks for. */
export type ArchitectureReminderRow = { key: string; text: string };

const MAX_ROWS = 10;

/**
 * Ruling 14: preparation passes the resolved pack through the whole render
 * chain; only the no-argument pure call keeps the generated platform default.
 */
function kindLabels(texts: PromptTextsV1): readonly (string | undefined)[] {
  return [
    texts.strings['architecture.kind.dependencyMissing'],
    texts.strings['architecture.kind.importUndeclared'],
    texts.strings['architecture.kind.ungrouped'],
    texts.strings['architecture.kind.move'],
  ];
}

type RankedRow = { kindIndex: number; path: string; content: string; text: string };

function sameModule(left: ModuleRef, right: ModuleRef): boolean {
  return left.projectId === right.projectId && left.moduleId === right.moduleId;
}

function moduleOf(catalog: AdoptedArchitecture, ref: ModuleRef): ModuleDefinition | null {
  return catalog.modules.find(module => sameModule(module.ref, ref)) ?? null;
}

/**
 * The task module at either end of a `dependency_missing` finding: the finding
 * names the declaring module; the OTHER end is read from the catalog dependency
 * whose `detail` is the same `from→to` pair. A finding whose module is unknown
 * to the catalog is not the task's.
 */
function dependencyTouchesTask(
  finding: FormalObservedFindingV1,
  taskModuleRef: ModuleRef,
  catalog: AdoptedArchitecture,
): boolean {
  const from = finding.moduleRef;
  if (from === null) return false;
  if (sameModule(from, taskModuleRef)) return true;
  return catalog.dependencies.some(dependency =>
    sameModule(dependency.from, from) && sameModule(dependency.to, taskModuleRef)
    && finding.detail === `${dependency.from.moduleId}→${dependency.to.moduleId}`);
}

/** The task module at either end of an `import_undeclared` finding. */
function importTouchesTask(
  finding: FormalObservedFindingV1,
  taskModuleRef: ModuleRef,
  catalog: AdoptedArchitecture,
): boolean {
  if (finding.moduleRef !== null && sameModule(finding.moduleRef, taskModuleRef)) return true;
  const ownership = pathOwnershipOf(finding.detail,
    catalog.modules.map(module => ({ value: module, paths: module.paths })));
  return ownership.status === 'owner' && sameModule(ownership.owner.ref, taskModuleRef);
}

/**
 * Ruling 10: an ungrouped file belongs to the task module only when the task
 * module's best path score is at least 1 AND strictly longer than every other
 * catalog module's score. A tie is nobody's.
 */
function ungroupedBelongsToTask(
  path: string,
  taskModuleRef: ModuleRef,
  catalog: AdoptedArchitecture,
): boolean {
  const taskModule = moduleOf(catalog, taskModuleRef);
  if (taskModule === null) return false;
  const taskScore = bestModuleDirectoryPrefixLength(path, taskModule.paths);
  if (taskScore < 1) return false;
  return catalog.modules.every(module =>
    sameModule(module.ref, taskModuleRef)
    || bestModuleDirectoryPrefixLength(path, module.paths) < taskScore);
}

/** Ruling 9: exactly one deleted and exactly one added path carry the digest. */
function moveRows(previous: ArchitectureReminderObservationV1, latest: ArchitectureReminderObservationV1,
  now: string | undefined, texts: PromptTextsV1): RankedRow[] {
  const labels = kindLabels(texts);
  const previousPaths = new Set(previous.nodes.map(node => node.path));
  const latestPaths = new Set(latest.nodes.map(node => node.path));
  const deletedByDigest = new Map<string, string[]>();
  const addedByDigest = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, digest: string, path: string): void => {
    const paths = map.get(digest);
    if (paths === undefined) map.set(digest, [path]);
    else paths.push(path);
  };
  for (const node of previous.nodes) if (!latestPaths.has(node.path)) add(deletedByDigest, node.digest, node.path);
  for (const node of latest.nodes) if (!previousPaths.has(node.path)) add(addedByDigest, node.digest, node.path);

  const rows: RankedRow[] = [];
  for (const [digest, deleted] of deletedByDigest) {
    if (deleted.length !== 1) continue;
    const added = addedByDigest.get(digest);
    if (added === undefined || added.length !== 1) continue;
    const oldPath = deleted[0]!;
    const newPath = added[0]!;
    const content = `${oldPath} → ${newPath}`;
    rows.push({ kindIndex: 3, path: oldPath, content, text: `${labels[3]}：${content}（${now}${texts.strings['architecture.observationSuffix']}` });
  }
  return rows;
}

/** Ruling 11 time text: floor of the elapsed time at each threshold. */
function elapsedText(now: string, observedAt: string, texts: PromptTextsV1): string | undefined {
  const elapsed = Math.max(0, Date.parse(now) - Date.parse(observedAt));
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed < minute) return texts.strings['architecture.time.justNow'];
  if (elapsed < hour) return `${String(Math.floor(elapsed / minute))}${texts.strings['architecture.time.minutesAgo']}`;
  if (elapsed < day) return `${String(Math.floor(elapsed / hour))}${texts.strings['architecture.time.hoursAgo']}`;
  return `${String(Math.floor(elapsed / day))}${texts.strings['architecture.time.daysAgo']}`;
}

function bodyRows(facts: ArchitectureReminderFactsV1, taskModuleRef: ModuleRef | null,
  now: string, texts: PromptTextsV1): RankedRow[] {
  const latest = facts.latest;
  if (latest === null) return [];
  const observedAt = facts.state.current?.observedAt ?? latest.observedAt;
  const time = elapsedText(now, observedAt, texts);
  const labels = kindLabels(texts);
  const catalog = facts.catalog;
  const rows: RankedRow[] = [];
  if (catalog === null || taskModuleRef === null) return moveRows(facts.previous ?? latest, latest, time, texts);
  for (const finding of facts.findings) {
    if (finding.kind === 'dependency_missing') {
      if (!dependencyTouchesTask(finding, taskModuleRef, catalog)) continue;
      const content = `${finding.detail}，${finding.path ?? ''}`;
      rows.push({ kindIndex: 0, path: finding.path ?? '', content,
        text: `${labels[0]}：${content}${finding.certainty === 'unknown' ? texts.strings['architecture.certaintyUnknown'] : ''}（${time}${texts.strings['architecture.observationSuffix']}` });
    } else if (finding.kind === 'import_undeclared') {
      if (!importTouchesTask(finding, taskModuleRef, catalog)) continue;
      const content = `${finding.path ?? ''} → ${finding.detail}`;
      rows.push({ kindIndex: 1, path: finding.path ?? '', content,
        text: `${labels[1]}：${content}（${time}${texts.strings['architecture.observationSuffix']}` });
    } else if (finding.kind === 'ungrouped') {
      const path = finding.path ?? '';
      if (!ungroupedBelongsToTask(path, taskModuleRef, catalog)) continue;
      rows.push({ kindIndex: 2, path, content: path, text: `${labels[2]}：${path}（${time}${texts.strings['architecture.observationSuffix']}` });
    }
  }
  rows.push(...moveRows(facts.previous ?? latest, latest, time, texts));
  return rows;
}

function compareRows(left: RankedRow, right: RankedRow): number {
  if (left.kindIndex !== right.kindIndex) return left.kindIndex - right.kindIndex;
  if (left.path !== right.path) return left.path < right.path ? -1 : 1;
  return left.content < right.content ? -1 : left.content > right.content ? 1 : 0;
}

/**
 * Ruling 11's order is decided first (`compareRows`, then the 10-row cap); the
 * key is only a transport for that order. A fixed-width sequence keeps it even
 * though the renderer sorts by key again and a path in the key would put
 * `src/a/inner` before `src/a` (`/` sorts before `:`).
 */
const SEQUENCE_WIDTH = 6;
function sequenceKey(index: number): string {
  return `architecture:${String(index).padStart(SEQUENCE_WIDTH, '0')}`;
}

/** The failed-read row (lead ruling): deterministic, after every numbered row. */
export const ARCHITECTURE_REMINDER_UNAVAILABLE_KEY = 'architecture:999999';

/**
 * The rows the assembler appends (interfaces §11): final texts with the keys
 * that keep ruling 11's order under the renderer's global key sort.
 */
export function architectureReminderRowEntries(input: {
  facts: ArchitectureReminderFactsV1; taskModuleRef: ModuleRef | null; now: string;
  /** Ruling 14: the resolved pack; absent keeps the generated platform default for direct pure calls. */
  texts?: PromptTextsV1;
}): ArchitectureReminderRow[] {
  const texts = input.texts ?? PLATFORM_PROMPT_PACK_V1;
  if (input.facts.state.current === null || input.facts.latest === null) {
    return [{ key: sequenceKey(0), text: texts.strings['architecture.noObservation'] }];
  }
  const rows = bodyRows(input.facts, input.taskModuleRef, input.now, texts).sort(compareRows);
  if (rows.length === 0) return [];
  const kept = rows.slice(0, MAX_ROWS);
  const entries = kept.map((row, index) => ({ key: sequenceKey(index), text: row.text }));
  const omitted = rows.length - kept.length;
  if (omitted > 0) {
    const text = `${texts.strings['architecture.omissionPrefix']}${String(omitted)}${texts.strings['architecture.omissionSuffix']}`;
    entries.push({ key: sequenceKey(kept.length), text });
  }
  return entries;
}
