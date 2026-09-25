import { SkillRegistry } from "../registry/skill-registry.js";
export interface FileSkillLoaderOptions {
    readonly maxFileBytes?: number;
    readonly maxTotalBytes?: number;
}
export declare class FileSkillLoader {
    #private;
    private constructor();
    static create(root: string, options?: FileSkillLoaderOptions): Promise<FileSkillLoader>;
    load(signal: AbortSignal): Promise<SkillRegistry>;
}
//# sourceMappingURL=file-skill-loader.d.ts.map