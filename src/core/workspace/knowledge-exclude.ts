/**
 * "Architecture and notes stay local, not in git" (KLS-2) is the person's choice for one checkout.
 * It lives in git's own local exclude file, `<git-common-dir>/info/exclude`, as one marked block: the marker line and
 * the knowledge directory line right after it. The user's `.gitignore`, the git configuration and the index are never
 * touched, and nothing is added or committed.
 *
 * Turning it on appends the block once; turning it off removes only those two lines, so a knowledge directory line the
 * user wrote stays. When the file already is in the asked state (the block there, or not there) it is left as it is.
 * The file is read and changed as bytes, never decoded, so every other line keeps its bytes, line endings and bytes
 * that are not UTF-8 included. The new file is written whole beside the old one and then renamed over it, so a write
 * that fails leaves the old file as it was.
 *
 * The knowledge directory itself is made here too, by the one function the Host, the Work Run start and the workbench
 * commands all call.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { messageOf } from '../../contracts/error-message.js';
import { KNOWLEDGE_DIRECTORY } from '../../contracts/knowledge.js';
import type { WorkspaceResult } from './ports.js';

const LF = 0x0a;
const CR = 0x0d;
const MARKER = '# dsh: architecture and notes stay local';
const EXCLUDED = `${KNOWLEDGE_DIRECTORY}/`;
const MARKER_BYTES = Buffer.from(MARKER);
const EXCLUDED_BYTES = Buffer.from(EXCLUDED);
const BLOCK_BYTES = Buffer.from(`${MARKER}\n${EXCLUDED}\n`);

/** Each line as `[start, end)` byte offsets, `end` just past its own LF (or the file's end for a last line without). */
function lineRanges(bytes: Buffer): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (let start = 0; start < bytes.length;) {
    const lf = bytes.indexOf(LF, start);
    const end = lf < 0 ? bytes.length : lf + 1;
    ranges.push([start, end]);
    start = end;
  }
  return ranges;
}

/** Whether one line, without its own LF or CRLF ending, is exactly `text`. */
function lineIs(bytes: Buffer, range: [number, number] | undefined, text: Buffer): boolean {
  if (range === undefined) return false;
  const [start, end] = range;
  let stop = end;
  if (bytes[stop - 1] === LF) {
    stop -= 1;
    if (stop > start && bytes[stop - 1] === CR) stop -= 1;
  }
  return bytes.subarray(start, stop).equals(text);
}

export async function applyKnowledgeExclude(commonDir: string, localOnly: boolean):
  Promise<WorkspaceResult<{ path: string; changed: boolean }>> {
  const path = join(commonDir, 'info', 'exclude');
  try {
    let current = Buffer.alloc(0);
    try { current = await readFile(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const lines = lineRanges(current);
    const at = lines.findIndex((line, index) =>
      lineIs(current, line, MARKER_BYTES) && lineIs(current, lines[index + 1], EXCLUDED_BYTES));
    if (localOnly === (at >= 0)) return { status: 'ready', value: { path, changed: false } };
    const separator = current.length === 0 || current[current.length - 1] === LF ? '' : '\n';
    const next = localOnly
      ? Buffer.concat([current, Buffer.from(separator), BLOCK_BYTES])
      : Buffer.concat([current.subarray(0, lines[at]![0]), current.subarray(lines[at + 1]![1])]);
    await mkdir(dirname(path), { recursive: true });
    const temporary = join(dirname(path), `.exclude.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, next);
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    return { status: 'ready', value: { path, changed: true } };
  } catch (error) {
    return { status: 'rejected', code: 'unavailable', reason: `${path} could not be updated: ${messageOf(error)}` };
  }
}

/** Makes `<root>/.workbench/`; an existing one (a workspace-local project store's `.gitignore` included) is left as
 *  it is. Commands mount it read-only and fail to start without it, so a directory deleted, or removed by a branch
 *  switch, comes back before the next command. A missing root is never made: its own open reports it. */
export function ensureKnowledgeDirectory(root: string): void {
  try { mkdirSync(join(root, KNOWLEDGE_DIRECTORY)); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'ENOENT') throw error;
  }
}
