/**
 * The disk-backed prompt-pack source. A person's pack lives at
 * `<settings directory>/prompts/<packId>/`; the platform pack stays the
 * generated module. Nothing is cached: every preparation and every editing
 * route reads the files again, so a save is visible to the next read.
 *
 * Path safety is decided on real paths and by path segments. A pack directory,
 * every parent pack directory and every file the manifest names must stay
 * inside the real `prompts` directory; a symlink out of it is rejected, never
 * followed into a normal answer.
 */
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import {
    PLATFORM_PROMPT_PACK_V1,
} from '../contracts/prompts/platform-pack.generated.js';
import type {
    PromptPackChainEntryV1, PromptPackProblemV1, PromptPackSourcePort, ResolvedPromptPackV1, ToolTextV1,
} from '../contracts/prompts/prompt-pack.js';
import { resolvePromptPackV1 } from '../contracts/prompts/resolve-pack.js';
import type { PromptPackListV1 } from './host-settings-types.js';

/** The one pack-id syntax (ruling 1): `platform` is reserved but has this shape. */
const PROMPT_PACK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isPromptPackId(value: unknown): value is string {
    return typeof value === 'string' && PROMPT_PACK_ID.test(value);
}

/** True when `child` is `parent` itself or lies under it, compared by path segments. */
export function isPathWithin(parent: string, child: string): boolean {
    const remainder = relative(parent, child);
    return remainder === '' || (!isAbsolute(remainder) && remainder !== '..'
        && !remainder.startsWith(`..${sep}`));
}

type ReadEntry =
    | { status: 'read'; entry: PromptPackChainEntryV1; parent: string | null }
    | { status: 'missing' }
    | { status: 'broken'; entry: PromptPackChainEntryV1 | null; parent: string | null;
        problems: PromptPackProblemV1[] };

const problem = (packId: string, templateId: string | null, reason: string,
    toolName?: string): PromptPackProblemV1 => toolName === undefined
    ? { packId, templateId, reason }
    : { packId, templateId, toolName, reason };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A manifest path is relative, has no `..` segment (a name `..x` is legal) and no drive. */
function unsafeFileReason(file: string): string | null {
    if (file === '') return 'file must name a path';
    if (file.startsWith('/') || file.startsWith('\\') || /^[a-z]:/i.test(file))
        return `file "${file}" must be relative`;
    if (file.split(/[\\/]/).includes('..')) return `file "${file}" must not contain a ".." segment`;
    return null;
}

type FileRead = { status: 'read'; text: string } | { status: 'rejected'; reason: string };

async function readPackFile(
    packReal: string, promptsReal: string, file: string,
): Promise<FileRead> {
    const unsafe = unsafeFileReason(file);
    if (unsafe !== null) return { status: 'rejected', reason: unsafe };
    let target: string;
    try {
        target = await realpath(join(packReal, file));
    } catch {
        return { status: 'rejected', reason: `file "${file}" could not be read` };
    }
    if (!isPathWithin(packReal, target))
        return { status: 'rejected', reason: `file "${file}" resolves outside the pack directory` };
    const parent = await realpath(dirname(target));
    if (!isPathWithin(promptsReal, parent))
        return { status: 'rejected', reason: `file "${file}" resolves outside the prompt directory` };
    try {
        return { status: 'read', text: await readFile(target, 'utf8') };
    } catch {
        return { status: 'rejected', reason: `file "${file}" could not be read` };
    }
}

/** Reads one pack directory. The parent id is returned only from a readable manifest. */
async function readUserPack(
    promptsReal: string, packId: string,
): Promise<ReadEntry> {
    const directory = join(promptsReal, packId);
    let packReal: string;
    try {
        packReal = await realpath(directory);
    } catch {
        return { status: 'missing' };
    }
    if (!isPathWithin(promptsReal, packReal))
        return { status: 'broken', entry: null, parent: null, problems: [problem(packId, null,
            'the pack directory resolves outside the prompt directory')] };
    const manifestRead = await readPackFile(packReal, promptsReal, 'pack.json');
    if (manifestRead.status === 'rejected')
        return { status: 'broken', entry: null, parent: null, problems: [problem(packId, null, manifestRead.reason)] };
    let manifestValue: unknown;
    try { manifestValue = JSON.parse(manifestRead.text); }
    catch {
        return { status: 'broken', entry: null, parent: null,
            problems: [problem(packId, null, 'the manifest is not valid JSON')] };
    }
    if (!isRecord(manifestValue))
        return { status: 'broken', entry: null, parent: null,
            problems: [problem(packId, null, 'the manifest must be a JSON object')] };

    const problems: PromptPackProblemV1[] = [];
    let strings: PromptPackChainEntryV1['strings'] = { file: '', text: '' };
    const stringsFile = manifestValue['strings'];
    if (typeof stringsFile === 'string') {
        const read = await readPackFile(packReal, promptsReal, stringsFile);
        if (read.status === 'read') strings = { file: stringsFile, text: read.text };
        else problems.push(problem(packId, null, read.reason));
    }
    const templates: Record<string, { file: string; text: string }> = Object.create(null) as
        Record<string, { file: string; text: string }>;
    const declaredTemplates = manifestValue['templates'];
    if (isRecord(declaredTemplates)) {
        for (const [templateId, raw] of Object.entries(declaredTemplates)) {
            if (!isRecord(raw) || typeof raw['file'] !== 'string') continue;
            const file = raw['file'];
            const read = await readPackFile(packReal, promptsReal, file);
            if (read.status === 'rejected') {
                problems.push(problem(packId, templateId, read.reason));
                continue;
            }
            templates[templateId] = { file, text: read.text };
        }
    }
    const tools: Record<string, { file: string; text: string }> = Object.create(null) as
        Record<string, { file: string; text: string }>;
    const declaredTools = manifestValue['tools'];
    if (isRecord(declaredTools)) {
        for (const [toolName, raw] of Object.entries(declaredTools)) {
            if (typeof raw !== 'string') continue;
            const read = await readPackFile(packReal, promptsReal, raw);
            if (read.status === 'rejected') {
                problems.push(problem(packId, null, read.reason, toolName));
                continue;
            }
            tools[toolName] = { file: raw, text: read.text };
        }
    }
    const entry: PromptPackChainEntryV1 = {
        packId,
        manifest: { file: 'pack.json', text: manifestRead.text },
        strings, templates, tools,
    };
    const parent = typeof manifestValue['extends'] === 'string' ? manifestValue['extends'] : null;
    if (problems.length > 0) return { status: 'broken', entry, parent, problems };
    return { status: 'read', entry, parent };
}

/** The generated platform as a chain entry: its manifest and every text it names. */
function platformPackEntry(): PromptPackChainEntryV1 {
    const manifest = PLATFORM_PROMPT_PACK_V1.manifest;
    // The generated module is a narrow literal; these views keep the chain
    // generic over the manifest's own names.
    const templates: Readonly<Record<string, string>> = PLATFORM_PROMPT_PACK_V1.templates;
    const tools: Readonly<Record<string, ToolTextV1>> = PLATFORM_PROMPT_PACK_V1.tools;
    return {
        packId: 'platform',
        manifest: { file: 'pack.json', text: JSON.stringify(manifest) },
        strings: { file: manifest.strings, text: JSON.stringify(PLATFORM_PROMPT_PACK_V1.strings) },
        templates: Object.fromEntries(Object.entries(manifest.templates).map(([templateId, declared]) =>
            [templateId, { file: declared.file, text: templates[templateId]! }])),
        tools: Object.fromEntries(Object.entries(manifest.tools).map(([toolName, file]) =>
            [toolName, { file, text: JSON.stringify(tools[toolName]) }])),
    };
}

/** The manifest a chain entry carries, or null when it is not a JSON object. */
function manifestOf(entry: PromptPackChainEntryV1): Record<string, unknown> | null {
    try {
        const value: unknown = JSON.parse(entry.manifest.text);
        return isRecord(value) ? value : null;
    } catch { return null; }
}

/** The nearest declaration of a template in the chain. A broken pack still
 * declares its version, so a save can compare the effective version before the
 * candidate pack is validated. A declaration without an integer version is null. */
export function effectiveTemplateVersionOf(
    chain: readonly PromptPackChainEntryV1[], templateId: string,
): number | null {
    for (const entry of chain) {
        const manifest = manifestOf(entry);
        const templates = manifest?.['templates'];
        if (!isRecord(templates) || !Object.hasOwn(templates, templateId)) continue;
        const declared = templates[templateId];
        if (!isRecord(declared)) return null;
        const version = declared['version'];
        return typeof version === 'number' && Number.isSafeInteger(version) ? version : null;
    }
    return null;
}

export type EffectiveToolTextV1 =
    | { status: 'found'; entry: ToolTextV1 }
    | { status: 'missing' }
    | { status: 'unreadable' };

/** The nearest declaration of a tool in the chain, with the text it supplies.
 * The nearest declaration is effective even when its file cannot be read; no
 * later pack substitutes for it (that would change the resolved chain). */
export function effectiveToolTextOf(
    chain: readonly PromptPackChainEntryV1[], toolName: string,
): EffectiveToolTextV1 {
    for (const entry of chain) {
        const manifest = manifestOf(entry);
        const tools = manifest?.['tools'];
        if (!isRecord(tools) || !Object.hasOwn(tools, toolName)) continue;
        const supplied = entry.tools[toolName];
        if (supplied === undefined) return { status: 'unreadable' };
        try {
            const parsed: unknown = JSON.parse(supplied.text);
            if (!isRecord(parsed)) return { status: 'unreadable' };
            const description = parsed['description'];
            const parameters = parsed['parameters'];
            if (typeof description !== 'string' || !isRecord(parameters)
                || !Object.values(parameters).every(value => typeof value === 'string'))
                return { status: 'unreadable' };
            return { status: 'found', entry: { description, parameters: parameters as Record<string, string> } };
        } catch { return { status: 'unreadable' }; }
    }
    return { status: 'missing' };
}

/** One problem list from the file reads and A's validation, without duplicates. */
function mergeProblems(
    readProblems: readonly PromptPackProblemV1[], validationProblems: readonly PromptPackProblemV1[],
): PromptPackProblemV1[] {
    const seen = new Set<string>();
    const merged: PromptPackProblemV1[] = [];
    for (const entry of [...readProblems, ...validationProblems]) {
        const key = JSON.stringify([entry.packId, entry.templateId, entry.toolName ?? null, entry.reason]);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(entry);
    }
    return merged;
}

export type DiskPromptPackReadV1 =
    | { status: 'ready'; chain: readonly PromptPackChainEntryV1[]; value: ResolvedPromptPackV1; directory: string | null }
    | { status: 'not_found' }
    | { status: 'rejected'; chain: readonly PromptPackChainEntryV1[]; problems: PromptPackProblemV1[] };

/**
 * Reads and resolves one pack from disk. `platform` is virtual; a user pack is
 * read together with its `extends` chain, requested pack first and the platform
 * pack last.
 */
export async function readDiskPromptPack(promptsRoot: string, packId: string): Promise<DiskPromptPackReadV1> {
    if (packId === 'platform') {
        const chain = [platformPackEntry()];
        const resolved = resolvePromptPackV1(chain);
        if (resolved.status === 'rejected') return { status: 'rejected', chain, problems: resolved.problems };
        return { status: 'ready', chain, value: resolved.value, directory: null };
    }
    if (!isPromptPackId(packId)) return { status: 'not_found' };
    let promptsReal: string;
    try { promptsReal = await realpath(promptsRoot); }
    catch { return { status: 'not_found' }; }
    const chain: PromptPackChainEntryV1[] = [];
    const problems: PromptPackProblemV1[] = [];
    const seen = new Set<string>();
    let cursor: string | null = packId;
    while (cursor !== null && cursor !== 'platform') {
        if (!isPromptPackId(cursor)) {
            problems.push(problem(packId, null, `pack "${cursor}" is not a legal pack id`));
            break;
        }
        if (seen.has(cursor)) {
            problems.push(problem(cursor, null, 'the pack extends chain contains a cycle'));
            break;
        }
        seen.add(cursor);
        const read = await readUserPack(promptsReal, cursor);
        if (read.status === 'missing') {
            if (cursor === packId) return { status: 'not_found' };
            problems.push(problem(packId, null, `pack "${packId}" extends missing pack "${cursor}"`));
            break;
        }
        if (read.status === 'broken') {
            problems.push(...read.problems);
            if (read.entry === null) break;
            chain.push(read.entry);
            cursor = read.parent;
            continue;
        }
        chain.push(read.entry);
        cursor = read.parent;
    }
    chain.push(platformPackEntry());
    // Every chain-termination error arrives here too: the read material is
    // still validated and both problem lists are merged and deduplicated, so
    // one rejection names the cycle (or bad parent) and every other fault.
    const resolved = resolvePromptPackV1(chain);
    const mergedProblems = mergeProblems(problems, resolved.status === 'rejected' ? resolved.problems : []);
    if (resolved.status === 'rejected' || mergedProblems.length > 0)
        return { status: 'rejected', chain, problems: mergedProblems };
    const directory = await realpath(join(promptsReal, packId)).catch(() => null);
    return { status: 'ready', chain, value: resolved.value, directory };
}

/** The disk-backed port the Host wires in for the configured prompt directory. */
export function createDiskPromptPackSource(promptsRoot: string): PromptPackSourcePort {
    return {
        async resolve(packId, _signal) {
            const read = await readDiskPromptPack(promptsRoot, packId);
            if (read.status === 'ready') return { status: 'ready', value: read.value };
            if (read.status === 'not_found')
                return { status: 'rejected', code: 'invalid', reason: `prompt pack ${packId} is not available` };
            return { status: 'rejected', code: 'invalid', reason: summarizeProblems(read.problems) };
        },
    };
}

/** One line carrying pack, template and reason for a preparation rejection. */
function summarizeProblems(problems: readonly PromptPackProblemV1[]): string {
    return problems.map(entry => {
        const place = entry.templateId === null ? entry.packId : `${entry.packId}/${entry.templateId}`;
        return entry.toolName === undefined ? `${place}: ${entry.reason}` : `${place} (${entry.toolName}): ${entry.reason}`;
    }).join('; ');
}

/** The `prompts/packs/list` projection: platform first, then every pack by ids. */
export async function listDiskPromptPacks(promptsRoot: string): Promise<PromptPackListV1['packs']> {
    const ids = new Set<string>();
    try {
        for (const entry of await readdir(promptsRoot, { withFileTypes: true })) {
            // `platform` is the one reserved id and always comes from the generated
            // module; a same-named directory on disk must not list a second copy.
            if (entry.name !== 'platform' && (entry.isDirectory() || entry.isSymbolicLink())
                && isPromptPackId(entry.name)) ids.add(entry.name);
        }
    } catch { /* No directory means no person's pack yet. */ }
    const order = ['platform', ...[...ids].sort((left, right) => left.localeCompare(right, 'en'))];
    const packs: PromptPackListV1['packs'][number][] = [];
    for (const packId of order) {
        const read = await readDiskPromptPack(promptsRoot, packId);
        if (read.status === 'not_found') continue;
        if (read.status === 'ready') {
            packs.push({
                packId,
                extends: read.value.manifest.extends,
                problems: [],
                templates: Object.entries(read.value.origins)
                    .map(([templateId, origin]) => ({
                        templateId, version: origin.version, fromPack: origin.packId, problems: [],
                    }))
                    .sort((left, right) => left.templateId.localeCompare(right.templateId, 'en')),
            });
            continue;
        }
        packs.push({
            packId,
            extends: extendsOf(read.chain),
            problems: read.problems,
            templates: listedTemplates(read.chain, read.problems),
        });
    }
    return packs;
}

function extendsOf(chain: readonly PromptPackChainEntryV1[]): string | null {
    const first = chain[0];
    if (first === undefined) return null;
    try {
        const manifest = JSON.parse(first.manifest.text) as unknown;
        if (!isRecord(manifest)) return null;
        const parent = manifest['extends'];
        return typeof parent === 'string' ? parent : null;
    } catch { return null; }
}

/** What a broken pack still declares, nearest pack wins, with its own problems. */
function listedTemplates(
    chain: readonly PromptPackChainEntryV1[], problems: readonly PromptPackProblemV1[],
): PromptPackListV1['packs'][number]['templates'] {
    const templates = new Map<string, PromptPackListV1['packs'][number]['templates'][number]>();
    for (const entry of chain) {
        let manifest: unknown;
        try { manifest = JSON.parse(entry.manifest.text); }
        catch { continue; }
        if (!isRecord(manifest) || !isRecord(manifest['templates'])) continue;
        for (const [templateId, raw] of Object.entries(manifest['templates'])) {
            if (templates.has(templateId) || !isRecord(raw)) continue;
            const version = raw['version'];
            if (typeof version !== 'number' || !Number.isInteger(version)) continue;
            templates.set(templateId, {
                templateId, version, fromPack: entry.packId,
                problems: problems.filter(entryProblem => entryProblem.packId === entry.packId
                    && entryProblem.templateId === templateId),
            });
        }
    }
    return [...templates.values()].sort((left, right) => left.templateId.localeCompare(right.templateId, 'en'));
}

export type PackWriteTargetV1 =
    | { status: 'create'; target: string }
    | { status: 'reuse'; target: string }
    | { status: 'collision'; reason: string }
    | { status: 'rejected'; reason: string };

/** Resolves one save target and proves its real parent directory and any
 * existing file stay inside the pack and the prompt tree. The parent's real
 * path decides the type and both containment checks, so a directory link that
 * stays inside the pack is allowed while one that leaves it is rejected. An
 * existing target is never overwritten: identical bytes are reused and any
 * other existing file is a collision. */
export async function preparePackWriteTarget(
    promptsRoot: string, packDirectory: string, file: string, text: string,
): Promise<PackWriteTargetV1> {
    const unsafe = unsafeFileReason(file);
    if (unsafe !== null) return { status: 'rejected', reason: unsafe };
    const target = join(packDirectory, file);
    const parentPath = dirname(target);
    let parentMissing = false;
    try {
        await lstat(parentPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') parentMissing = true;
        else return { status: 'rejected', reason: `the directory of "${file}" could not be read` };
    }
    if (parentMissing) await mkdir(parentPath, { recursive: true });
    let promptsReal: string;
    let packReal: string;
    try { promptsReal = await realpath(promptsRoot); }
    catch { return { status: 'rejected', reason: 'the prompt directory could not be read' }; }
    try { packReal = await realpath(packDirectory); }
    catch { return { status: 'rejected', reason: 'the prompt pack directory could not be read' }; }
    let parentReal: string;
    try { parentReal = await realpath(parentPath); }
    catch { return { status: 'rejected', reason: `the directory of "${file}" could not be read` }; }
    let parentInfo;
    try { parentInfo = await stat(parentReal); }
    catch { return { status: 'rejected', reason: `the directory of "${file}" could not be read` }; }
    if (!parentInfo.isDirectory())
        return { status: 'rejected', reason: `the directory of "${file}" is not a directory` };
    if (!isPathWithin(promptsReal, parentReal) || !isPathWithin(packReal, parentReal))
        return { status: 'rejected', reason: `the directory of "${file}" resolves outside the pack` };
    try {
        const info = await lstat(target);
        if (info.isSymbolicLink() || !info.isFile())
            return { status: 'collision', reason: `file "${file}" already exists and is not a regular file` };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'create', target };
        return { status: 'rejected', reason: `file "${file}" could not be read` };
    }
    let existing: Buffer;
    try { existing = await readFile(target); }
    catch { return { status: 'rejected', reason: `file "${file}" could not be read` }; }
    if (!existing.equals(Buffer.from(text, 'utf8')))
        return { status: 'collision', reason: `file "${file}" already exists with different contents` };
    return { status: 'reuse', target };
}

export type CreateDiskPromptPackResult =
    | { status: 'created' }
    | { status: 'exists' }
    | { status: 'unavailable'; reason: string };

/** Creates an empty child of the platform pack. The caller has checked the id. */
export async function createDiskPromptPack(
    promptsRoot: string, packId: string,
): Promise<CreateDiskPromptPackResult> {
    const directory = join(promptsRoot, packId);
    try { await lstat(directory); return { status: 'exists' }; }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            return { status: 'unavailable', reason: 'the prompt pack directory could not be read' };
    }
    const manifest = {
        schemaVersion: 1, packId, extends: 'platform',
        templates: {}, strings: 'strings.json', tools: {},
    };
    try {
        await mkdir(promptsRoot, { recursive: true });
        await mkdir(directory);
        await writeFile(join(directory, 'pack.json'), JSON.stringify(manifest), 'utf8');
        await writeFile(join(directory, 'strings.json'), '{}', 'utf8');
        return { status: 'created' };
    } catch {
        return { status: 'unavailable', reason: 'the prompt pack could not be created' };
    }
}
