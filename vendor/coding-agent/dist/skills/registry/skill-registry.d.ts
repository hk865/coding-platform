/** Skill 资源注册表及显式选择 Provider。 */
import { type SkillProviderPort, type SkillSelectionRequest } from "../../core/ports/skill_provider/skill-provider-port.js";
import type { SkillContext } from "../../core/context/types/context-types.js";
export declare class SkillRegistry implements SkillProviderPort {
    #private;
    register(skill: SkillContext): this;
    freeze(): this;
    list(): readonly SkillContext[];
    select(request: Readonly<SkillSelectionRequest>, options: Readonly<{
        signal: AbortSignal;
    }>): Promise<readonly SkillContext[]>;
}
//# sourceMappingURL=skill-registry.d.ts.map