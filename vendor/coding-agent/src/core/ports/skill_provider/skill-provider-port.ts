/** Core 的 Skill 选择窄端口。 */
import { z } from "zod";

import { skillContextSchema, type SkillContext } from "../../context/types/context-types.js";

export const skillSelectionRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestedIds: z.array(z.string().trim().min(1)).readonly(),
  })
  .strict()
  .refine((value) => new Set(value.requestedIds).size === value.requestedIds.length, {
    message: "requestedIds 不能重复",
  });

export type SkillSelectionRequest = z.infer<typeof skillSelectionRequestSchema>;
export type SkillProviderErrorCode =
  "invalid_request" | "not_found" | "resource_invalid" | "cancelled" | "internal";

export class SkillProviderError extends Error {
  constructor(
    readonly code: SkillProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SkillProviderError";
  }
}

export interface SkillProviderPort {
  select(
    request: Readonly<SkillSelectionRequest>,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<readonly SkillContext[]>;
}

export function validateSkillSelection(items: readonly unknown[]): readonly SkillContext[] {
  const parsed = items.map((item) => skillContextSchema.parse(item));
  if (new Set(parsed.map((item) => item.id)).size !== parsed.length) {
    throw new SkillProviderError("resource_invalid", "Skill 结果包含重复 ID");
  }
  return Object.freeze([...parsed].sort((left, right) => left.id.localeCompare(right.id, "en")));
}
