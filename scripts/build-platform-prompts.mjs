#!/usr/bin/env node
// Builds src/contracts/prompts/platform-pack.generated.ts from the platform
// prompt pack under resources/prompts/platform/. The pack is source; the
// generated module is the static data the product imports, so the runtime never
// reads prompt files, awaits or looks at Host settings.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root is derived from this script's URL, never from the working directory. */
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PLATFORM_PACK_DIRECTORY = 'resources/prompts/platform';
export const PLATFORM_PACK_GENERATED_PATH = 'src/contracts/prompts/platform-pack.generated.ts';

const quote = value => JSON.stringify(value);
const pad = level => '  '.repeat(level);
const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value);

async function readText(path) {
    try {
        return await readFile(path, 'utf8');
    } catch (error) {
        throw new Error(`cannot read ${path} (${error?.code ?? error?.message ?? String(error)})`);
    }
}

async function readJson(path) {
    const text = await readText(path);
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`cannot parse ${path} as JSON (${error?.message ?? String(error)})`);
    }
}

/**
 * Reads the pack's own files in manifest order: templates and tools follow
 * pack.json, strings follow strings.json. Nothing is sorted, so the generated
 * literal keeps the authoring order and the diff stays stable.
 */
export async function readPlatformPack(projectDir) {
    const packRoot = resolve(projectDir, PLATFORM_PACK_DIRECTORY);
    const manifest = await readJson(resolve(packRoot, 'pack.json'));
    if (!isRecord(manifest)) throw new Error(`${PLATFORM_PACK_DIRECTORY}/pack.json must be a JSON object`);
    if (typeof manifest.strings !== 'string' || manifest.strings === '')
        throw new Error(`${PLATFORM_PACK_DIRECTORY}/pack.json needs a "strings" file name`);
    if (!isRecord(manifest.templates))
        throw new Error(`${PLATFORM_PACK_DIRECTORY}/pack.json needs a "templates" object`);
    if (!isRecord(manifest.tools))
        throw new Error(`${PLATFORM_PACK_DIRECTORY}/pack.json needs a "tools" object`);
    const strings = await readJson(resolve(packRoot, manifest.strings));
    if (!isRecord(strings)) throw new Error(`${manifest.strings} must be a JSON object`);
    for (const [key, value] of Object.entries(strings))
        if (typeof value !== 'string') throw new Error(`${manifest.strings} entry "${key}" must be a string`);
    const templates = {};
    for (const [id, entry] of Object.entries(manifest.templates)) {
        if (!isRecord(entry) || typeof entry.file !== 'string' || entry.file === '')
            throw new Error(`${PLATFORM_PACK_DIRECTORY}/pack.json template "${id}" needs a "file"`);
        if (!Number.isInteger(entry.version))
            throw new Error(`${PLATFORM_PACK_DIRECTORY}/pack.json template "${id}" needs an integer "version"`);
        if (!Array.isArray(entry.mentionsTools) || entry.mentionsTools.some(name => typeof name !== 'string'))
            throw new Error(`${PLATFORM_PACK_DIRECTORY}/pack.json template "${id}" needs a "mentionsTools" string array`);
        templates[id] = await readText(resolve(packRoot, entry.file));
    }
    const tools = {};
    for (const [name, file] of Object.entries(manifest.tools)) {
        if (typeof file !== 'string' || file === '')
            throw new Error(`${PLATFORM_PACK_DIRECTORY}/pack.json tool "${name}" needs a file name`);
        const text = await readJson(resolve(packRoot, file));
        if (!isRecord(text) || typeof text.description !== 'string' || !isRecord(text.parameters))
            throw new Error(`${file} needs a "description" string and a "parameters" object`);
        for (const [path, description] of Object.entries(text.parameters))
            if (typeof description !== 'string') throw new Error(`${file} parameter "${path}" must be a string`);
        tools[name] = { description: text.description, parameters: text.parameters };
    }
    return { manifest, templates, strings, tools };
}

function emitStringMap(record, level) {
    const entries = Object.entries(record);
    if (entries.length === 0) return '{}';
    const lines = ['{'];
    for (const [key, value] of entries) lines.push(`${pad(level + 1)}${quote(key)}: ${quote(value)},`);
    lines.push(`${pad(level)}}`);
    return lines.join('\n');
}

function emitManifestTemplates(templates, level) {
    const entries = Object.entries(templates);
    if (entries.length === 0) return '{}';
    const lines = ['{'];
    for (const [id, entry] of entries) {
        // `manifest.templates` keeps mutable `string[]` values (the frozen
        // manifest type). Asserting the literal tuple keeps every tool name's
        // literal type and is still assignable to that `string[]`, while the
        // enclosing `as const` must not freeze them into a readonly tuple.
        const names = entry.mentionsTools.map(quote).join(', ');
        const mentionsTools = `[${names}] as [${names}]`;
        lines.push(`${pad(level + 1)}${quote(id)}: {`);
        lines.push(`${pad(level + 2)}"file": ${quote(entry.file)},`);
        lines.push(`${pad(level + 2)}"version": ${JSON.stringify(entry.version)},`);
        lines.push(`${pad(level + 2)}"mentionsTools": ${mentionsTools},`);
        lines.push(`${pad(level + 1)}},`);
    }
    lines.push(`${pad(level)}}`);
    return lines.join('\n');
}

function emitTools(tools, level) {
    const entries = Object.entries(tools);
    if (entries.length === 0) return '{}';
    const lines = ['{'];
    for (const [name, tool] of entries) {
        lines.push(`${pad(level + 1)}${quote(name)}: {`);
        lines.push(`${pad(level + 2)}"description": ${quote(tool.description)},`);
        lines.push(`${pad(level + 2)}"parameters": ${emitStringMap(tool.parameters, level + 2)},`);
        lines.push(`${pad(level + 1)}},`);
    }
    lines.push(`${pad(level)}}`);
    return lines.join('\n');
}

/** Each template's origin (rulings 4, 11): the pack it came from, its version and its tool declarations. */
function emitOrigins(manifest, level) {
    const entries = Object.entries(manifest.templates);
    if (entries.length === 0) return '{}';
    const lines = ['{'];
    for (const [id, entry] of entries) {
        lines.push(`${pad(level + 1)}${quote(id)}: {`);
        const names = entry.mentionsTools.map(quote).join(', ');
        lines.push(`${pad(level + 2)}"packId": ${quote(manifest.packId)},`);
        lines.push(`${pad(level + 2)}"version": ${JSON.stringify(entry.version)},`);
        lines.push(`${pad(level + 2)}"mentionsTools": [${names}],`);
        lines.push(`${pad(level + 1)}},`);
    }
    lines.push(`${pad(level)}}`);
    return lines.join('\n');
}

/**
 * Renders the committed module from already-read pack data. Pure: the CLI and
 * the boundaries check both use it, and neither may regenerate by guessing.
 */
export function renderPlatformPackModule(pack) {
    const { manifest, templates, strings, tools } = pack;
    const lines = [
        '// Generated by scripts/build-platform-prompts.mjs from resources/prompts/platform/. Do not edit by hand.',
        "import type { ResolvedPromptPackV1 } from './prompt-pack.js';",
        '',
        'export const PLATFORM_PROMPT_PACK_V1 = {',
        '  manifest: {',
        `    "schemaVersion": ${JSON.stringify(manifest.schemaVersion)},`,
        `    "packId": ${quote(manifest.packId)},`,
        `    "extends": ${manifest.extends === null ? 'null' : quote(manifest.extends)},`,
        `    "templates": ${emitManifestTemplates(manifest.templates, 2)},`,
        `    "strings": ${quote(manifest.strings)},`,
        `    "tools": ${emitStringMap(manifest.tools, 2)},`,
        '  },',
        `  templates: ${emitStringMap(templates, 1)},`,
        `  strings: ${emitStringMap(strings, 1)},`,
        `  tools: ${emitTools(tools, 1)},`,
        `  origins: ${emitOrigins(manifest, 1)},`,
        `  toolOrigins: ${emitStringMap(Object.fromEntries(Object.keys(manifest.tools).map(name => [name, manifest.packId])), 1)},`,
        '} as const satisfies ResolvedPromptPackV1;',
    ];
    return `${lines.join('\n')}\n`;
}

async function main() {
    const checkOnly = process.argv.slice(2).includes('--check');
    try {
        const pack = await readPlatformPack(PROJECT_ROOT);
        const generated = renderPlatformPackModule(pack);
        const target = resolve(PROJECT_ROOT, PLATFORM_PACK_GENERATED_PATH);
        if (checkOnly) {
            let committed;
            try {
                committed = await readFile(target, 'utf8');
            } catch (error) {
                throw new Error(`generated prompt pack is missing: ${PLATFORM_PACK_GENERATED_PATH} `
                    + `(${error?.code ?? error?.message ?? String(error)})`);
            }
            if (committed !== generated) {
                process.stderr.write(`platform prompt pack generated module is stale: run node scripts/build-platform-prompts.mjs\n`);
                process.exitCode = 1;
                return;
            }
            process.stdout.write('platform prompt pack: OK\n');
            return;
        }
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, generated, 'utf8');
        process.stdout.write(`wrote ${PLATFORM_PACK_GENERATED_PATH}\n`);
    } catch (error) {
        process.stderr.write(`${error?.message ?? String(error)}\n`);
        process.exitCode = 1;
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
