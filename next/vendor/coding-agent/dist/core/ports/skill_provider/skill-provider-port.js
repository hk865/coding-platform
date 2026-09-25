/** Core 的 Skill 选择窄端口。 */
import { z } from "zod";
import { skillContextSchema } from "../../context/types/context-types.js";
export const skillSelectionRequestSchema = z
    .object({
    schemaVersion: z.literal(1),
    requestedIds: z.array(z.string().trim().min(1)).readonly(),
})
    .strict()
    .refine((value) => new Set(value.requestedIds).size === value.requestedIds.length, {
    message: "requestedIds 不能重复",
});
export class SkillProviderError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "SkillProviderError";
    }
}
export function validateSkillSelection(items) {
    const parsed = items.map((item) => skillContextSchema.parse(item));
    if (new Set(parsed.map((item) => item.id)).size !== parsed.length) {
        throw new SkillProviderError("resource_invalid", "Skill 结果包含重复 ID");
    }
    return Object.freeze([...parsed].sort((left, right) => left.id.localeCompare(right.id, "en")));
}
//# sourceMappingURL=skill-provider-port.js.map