/** Core 的 Skill 选择窄端口。 */
import { z } from "zod";
import { type SkillContext } from "../../context/types/context-types.js";
export declare const skillSelectionRequestSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    requestedIds: z.ZodReadonly<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export type SkillSelectionRequest = z.infer<typeof skillSelectionRequestSchema>;
export type SkillProviderErrorCode = "invalid_request" | "not_found" | "resource_invalid" | "cancelled" | "internal";
export declare class SkillProviderError extends Error {
    readonly code: SkillProviderErrorCode;
    constructor(code: SkillProviderErrorCode, message: string);
}
export interface SkillProviderPort {
    select(request: Readonly<SkillSelectionRequest>, options: Readonly<{
        signal: AbortSignal;
    }>): Promise<readonly SkillContext[]>;
}
export declare function validateSkillSelection(items: readonly unknown[]): readonly SkillContext[];
//# sourceMappingURL=skill-provider-port.d.ts.map