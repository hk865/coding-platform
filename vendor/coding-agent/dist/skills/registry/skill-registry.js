/** Skill 资源注册表及显式选择 Provider。 */
import { SkillProviderError, skillSelectionRequestSchema, validateSkillSelection, } from "../../core/ports/skill_provider/skill-provider-port.js";
export class SkillRegistry {
    #skills = new Map();
    #frozen = false;
    register(skill) {
        if (this.#frozen)
            throw new SkillProviderError("invalid_request", "SkillRegistry 已冻结");
        const [parsed] = validateSkillSelection([skill]);
        if (!parsed)
            throw new SkillProviderError("resource_invalid", "Skill 资源非法");
        if (this.#skills.has(parsed.id)) {
            throw new SkillProviderError("resource_invalid", `Skill ${parsed.id} 重复`);
        }
        this.#skills.set(parsed.id, Object.freeze(parsed));
        return this;
    }
    freeze() {
        this.#frozen = true;
        return this;
    }
    list() {
        return validateSkillSelection([...this.#skills.values()]);
    }
    async select(request, options) {
        if (options.signal.aborted)
            throw new SkillProviderError("cancelled", "Skill 选择已取消");
        const parsed = skillSelectionRequestSchema.parse(request);
        if (!this.#frozen)
            throw new SkillProviderError("invalid_request", "SkillRegistry 尚未冻结");
        const selected = parsed.requestedIds.map((id) => {
            const skill = this.#skills.get(id);
            if (!skill)
                throw new SkillProviderError("not_found", `Skill ${id} 不存在`);
            return skill;
        });
        if (options.signal.aborted)
            throw new SkillProviderError("cancelled", "Skill 选择已取消");
        return validateSkillSelection(selected);
    }
}
//# sourceMappingURL=skill-registry.js.map