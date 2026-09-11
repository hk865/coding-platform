/** Skill 资源注册表及显式选择 Provider。 */
import {
  SkillProviderError,
  skillSelectionRequestSchema,
  validateSkillSelection,
  type SkillProviderPort,
  type SkillSelectionRequest,
} from "../../core/ports/skill_provider/skill-provider-port.js";
import type { SkillContext } from "../../core/context/types/context-types.js";

export class SkillRegistry implements SkillProviderPort {
  readonly #skills = new Map<string, SkillContext>();
  #frozen = false;

  register(skill: SkillContext): this {
    if (this.#frozen) throw new SkillProviderError("invalid_request", "SkillRegistry 已冻结");
    const [parsed] = validateSkillSelection([skill]);
    if (!parsed) throw new SkillProviderError("resource_invalid", "Skill 资源非法");
    if (this.#skills.has(parsed.id)) {
      throw new SkillProviderError("resource_invalid", `Skill ${parsed.id} 重复`);
    }
    this.#skills.set(parsed.id, Object.freeze(parsed));
    return this;
  }

  freeze(): this {
    this.#frozen = true;
    return this;
  }

  list(): readonly SkillContext[] {
    return validateSkillSelection([...this.#skills.values()]);
  }

  async select(
    request: Readonly<SkillSelectionRequest>,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<readonly SkillContext[]> {
    if (options.signal.aborted) throw new SkillProviderError("cancelled", "Skill 选择已取消");
    const parsed = skillSelectionRequestSchema.parse(request);
    if (!this.#frozen) throw new SkillProviderError("invalid_request", "SkillRegistry 尚未冻结");
    const selected = parsed.requestedIds.map((id) => {
      const skill = this.#skills.get(id);
      if (!skill) throw new SkillProviderError("not_found", `Skill ${id} 不存在`);
      return skill;
    });
    if (options.signal.aborted) throw new SkillProviderError("cancelled", "Skill 选择已取消");
    return validateSkillSelection(selected);
  }
}
