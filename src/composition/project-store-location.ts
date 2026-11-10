/**
 * Where a project's store directory lives. Its name comes from the project id
 * only (the first 16 hex digits of sha256(projectId)); the root, path
 * separators and the id's own text never enter it. The main workspace root is
 * used only to find the candidate and its drive:
 *
 * - the root is in a git work tree: `<git common dir>/workbench/projects/<hash>`
 *   (`git-common`), shared by every work tree of the repository and never
 *   tracked by git;
 * - otherwise: `<root>/.workbench/local/projects/<hash>` (`workspace-local`);
 *   the platform never runs `git init` on its own.
 *
 * Only then is the candidate's drive checked. A network or mounted drive whose
 * file locks are unreliable, or a drive whose type cannot be determined, moves
 * the store to the local data directory, `<user data root>/projects/<hash>`
 * (`user-data`), with one sentence saying why. The check never reads localized
 * text (Linux: the filesystem type in `/proc/mounts`; Windows: the numeric
 * `Win32_LogicalDisk.DriveType`), never throws and never blocks a start.
 */
import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { rejected } from '../contracts/core/rejections.js';
import { sha256Hex } from '../contracts/fingerprint.js';
import type { StoreResult } from '../core/record-store/ports.js';
import { gitCommonDir } from '../core/workspace/workspace-change-capture.js';

const execute = promisify(execFile);

export type ProjectStorePlace = 'git-common' | 'workspace-local' | 'user-data';
export type ProjectStoreLocation = {
  place: ProjectStorePlace;
  /** Absolute. */
  directory: string;
  /** Non-null only for `user-data`: one sentence for the person. */
  reason: string | null;
};
export type MountReliability = 'reliable' | 'unreliable' | 'unknown';
export type ProjectStoreLocationDeps = {
  gitCommonDir(root: string): Promise<string | null>;
  mountReliability(directory: string): Promise<MountReliability>;
  userDataRoot(): string;
};

/** Filesystem types whose file locks SQLite cannot rely on: WSL's Windows drives and network shares. */
const UNRELIABLE_FILESYSTEMS: ReadonlySet<string> = new Set(['9p', 'drvfs', 'cifs', 'smb3', 'smbfs', 'nfs', 'nfs4']);

/** The local data directory's folder: the package name, kept even when a product display name is chosen later. */
const USER_DATA_FOLDER = 'coding-platform-next';

export async function projectStoreLocation(
  projectId: string, root: string, deps?: Partial<ProjectStoreLocationDeps>,
): Promise<StoreResult<ProjectStoreLocation>> {
  const hash = sha256Hex(projectId).slice(0, 16);
  const common = await (deps?.gitCommonDir ?? gitCommonDir)(root);
  const place: ProjectStorePlace = common !== null ? 'git-common' : 'workspace-local';
  const candidate = common !== null ? join(common, 'workbench', 'projects', hash)
    : join(root, '.workbench', 'local', 'projects', hash);
  const reliability = await (deps?.mountReliability ?? defaultMountReliability)(candidate);
  if (reliability === 'reliable') return { status: 'ready', value: { place, directory: candidate, reason: null } };
  let base: string;
  try {
    base = (deps?.userDataRoot ?? defaultUserDataRoot)();
  } catch {
    return rejected('unavailable', 'the local data directory is not set');
  }
  const reason = reliability === 'unreliable'
    ? `the project store is kept in the local data directory because ${candidate} is on a network or mounted drive whose file locks are unreliable`
    : `the project store is kept in the local data directory because the drive type of ${candidate} could not be determined`;
  return { status: 'ready', value: { place: 'user-data', directory: join(base, 'projects', hash), reason } };
}

/** The local data directory: `%LOCALAPPDATA%\coding-platform-next` on Windows, elsewhere
 * `$XDG_DATA_HOME/coding-platform-next` or `~/.local/share/coding-platform-next`. Throws when it is not set. */
export function defaultUserDataRoot(): string {
  const base = process.platform === 'win32' ? process.env['LOCALAPPDATA']
    : (process.env['XDG_DATA_HOME'] || join(homedir(), '.local', 'share'));
  if (!base) throw new Error('the local data directory is not set');
  return join(base, USER_DATA_FOLDER);
}

/**
 * The drive of the mount whose mount point is the longest prefix of the path
 * (`/proc/mounts`: device, mount point, type, ...; octal escapes such as `\040`
 * in the mount point). A later line for the same mount point shadows an earlier
 * one, as the kernel lists mounts in mount order. No match: `unknown`.
 */
export function reliabilityFromMounts(mountsText: string, absolutePath: string): MountReliability {
  let best: { point: string; type: string } | null = null;
  for (const line of mountsText.split('\n')) {
    const [, field, type] = line.split(' ');
    if (field === undefined || type === undefined || field === '' || type === '') continue;
    const point = decodeMountPoint(field);
    if (isWithinMountPoint(absolutePath, point) && (best === null || point.length >= best.point.length)) {
      best = { point, type };
    }
  }
  if (best === null) return 'unknown';
  return UNRELIABLE_FILESYSTEMS.has(best.type) ? 'unreliable' : 'reliable';
}

/** `Win32_LogicalDisk.DriveType` as printed: 4 (network) is unreliable; 2, 3, 6 (removable, local, RAM disk)
 * are reliable; any other number, an empty answer or anything else is `unknown`. */
export function reliabilityFromDriveType(output: string): MountReliability {
  const code = output.trim();
  if (code === '4') return 'unreliable';
  if (code === '2' || code === '3' || code === '6') return 'reliable';
  return 'unknown';
}

function decodeMountPoint(field: string): string {
  return field.replace(/\\([0-7]{3})/g, (_match, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)));
}

function isWithinMountPoint(path: string, point: string): boolean {
  if (point === '/') return path.startsWith('/');
  return path === point || path.startsWith(`${point}/`);
}

/** The candidate rarely exists yet: its nearest existing ancestor, with links resolved, names the drive. Only a
 * missing path moves up to its parent; any other failure (an unreadable network mount answers EIO or ESTALE) or a
 * root that cannot be resolved answers null: the drive is undetermined, never judged by an ancestor's drive. */
async function nearestExistingRealPath(path: string): Promise<string | null> {
  let current = resolve(path);
  for (;;) {
    try {
      return await realpath(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

async function defaultMountReliability(directory: string): Promise<MountReliability> {
  const existing = await nearestExistingRealPath(directory);
  if (existing === null) return 'unknown';
  if (process.platform === 'linux') {
    let mounts: string;
    try {
      mounts = await readFile('/proc/mounts', 'utf8');
    } catch {
      return 'unknown';
    }
    return reliabilityFromMounts(mounts, existing);
  }
  if (process.platform === 'win32') {
    if (existing.startsWith('\\\\') || existing.startsWith('//')) return 'unreliable';
    const drive = /^([A-Za-z]:)/.exec(existing)?.[1];
    if (drive === undefined) return 'unknown';
    try {
      const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'").DriveType`],
      { timeout: 15_000, windowsHide: true });
      return reliabilityFromDriveType(stdout);
    } catch {
      return 'unknown';
    }
  }
  return 'unknown';
}
