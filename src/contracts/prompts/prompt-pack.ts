/**
 * The frozen prompt-pack format (slice 6-7 spec §2). A pack is platform text
 * only: templates, a string table and tool texts. It never carries code,
 * routing or model bindings; an input template's own slot order is the section
 * order.
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

/** One validation problem; `templateId` is `null` for a pack-level problem. */
export type PromptPackProblemV1 = {
    packId: string;
    templateId: string | null;
    toolName?: string;
    reason: string;
};

/** The read files of one pack in a chain: the requested pack first, `platform` last. */
export type PromptPackChainEntryV1 = {
    packId: string;
    manifest: { file: string; text: string };
    strings: { file: string; text: string };
    templates: Readonly<Record<string, { file: string; text: string }>>;
    tools: Readonly<Record<string, { file: string; text: string }>>;
};

/** A pack whose referenced files have been read: the immutable data a renderer consumes. */
export type ResolvedPromptPackV1 = {
    manifest: PromptPackManifestV1;
    templates: Readonly<Record<string, string>>;
    strings: Readonly<Record<string, string>>;
    tools: Readonly<Record<string, ToolTextV1>>;
    /** Where each template came from; the supplying manifest entry fills it (ruling 4). */
    origins: Readonly<Record<string, { packId: string; version: number; mentionsTools: readonly string[] }>>;
    /** The pack that supplied each tool's whole text (ruling 19). */
    toolOrigins: Readonly<Record<string, string>>;
};

/** The full result of resolving a chain; validation collects every problem and never throws. */
export type PromptPackValidationV1 =
    | { status: 'ready'; value: ResolvedPromptPackV1 }
    | { status: 'rejected'; problems: PromptPackProblemV1[] };

/** The code-owned slot table of one template. Packs may not add or remove slots. */
export type TemplateSlotTableV1 = Readonly<Record<string, { required: boolean }>>;

/** Where a prepared execution gets its resolved pack (ruling 13). Runtime code
 * sees only this port; the Host binds either the generated platform pack or the
 * disk-backed source. */
export interface PromptPackSourcePort {
    resolve(packId: string, signal: AbortSignal): Promise<
        { status: 'ready'; value: ResolvedPromptPackV1 }
        | { status: 'rejected'; code: 'invalid' | 'unavailable'; reason: string }>;
}

/** The generated-platform source: `"platform"` is the generated pack, every
 * other id is invalid. A Host with a settings directory binds the disk-backed
 * source instead. */
export function createPlatformPromptPackSource(): PromptPackSourcePort {
    return {
        async resolve(packId, _signal) {
            if (packId === 'platform') return { status: 'ready', value: PLATFORM_PROMPT_PACK_V1 };
            return { status: 'rejected', code: 'invalid', reason: `prompt pack ${packId} is not available` };
        },
    };
}
