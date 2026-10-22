/**
 * The frozen prompt-pack format (slice 6-7 spec §2). A pack is platform text
 * only: templates, a string table and tool texts. It never carries code,
 * routing, model bindings or section order overrides; those stay in code.
 */
import { PLATFORM_PROMPT_PACK_V1 } from './platform-pack.generated.js';

export type PromptPackManifestV1 = {
    schemaVersion: 1;
    packId: string;
    /** The pack this one inherits from; the platform pack extends nothing. */
    extends: string | null;
    templates: Record<string, { file: string; version: number; mentionsTools: string[] }>;
    /** File name of the string table, relative to the pack directory. */
    strings: string;
    /** Tool name → tool text file, relative to the pack directory. */
    tools: Record<string, string>;
};

/** One tool's model-facing text. `parameters` is keyed by the path from the tool's input object. */
export type ToolTextV1 = { description: string; parameters: Readonly<Record<string, string>> };

/** A pack whose referenced files have been read: the immutable data a renderer consumes. */
export type ResolvedPromptPackV1 = {
    manifest: PromptPackManifestV1;
    templates: Readonly<Record<string, string>>;
    strings: Readonly<Record<string, string>>;
    tools: Readonly<Record<string, ToolTextV1>>;
    /** Where each template came from; the generator fills it (ruling 11). */
    origins: Readonly<Record<string, { packId: string; version: number }>>;
};

/** The code-owned slot table of one template. Packs may not add or remove slots. */
export type TemplateSlotTableV1 = Readonly<Record<string, { required: boolean }>>;

/** Where a prepared execution gets its resolved pack (ruling 13). Runtime code
 * sees only this port; PC-2 swaps in the disk-backed source. */
export interface PromptPackSourcePort {
    resolve(packId: string, signal: AbortSignal): Promise<
        { status: 'ready'; value: ResolvedPromptPackV1 }
        | { status: 'rejected'; code: 'invalid' | 'unavailable'; reason: string }>;
}

/** The PC-1a default: `"platform"` is the generated pack, every other id is
 * invalid. The disk-backed source replaces this in PC-2. */
export function createPlatformPromptPackSource(): PromptPackSourcePort {
    return {
        async resolve(packId, _signal) {
            if (packId === 'platform') return { status: 'ready', value: PLATFORM_PROMPT_PACK_V1 };
            return { status: 'rejected', code: 'invalid', reason: `prompt pack ${packId} is not available` };
        },
    };
}
