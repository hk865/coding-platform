/**
 * The platform instruction Skills that ship with the product (slice 6-7 spec
 * ruling 12). Packs carry only text: ids, titles, kinds and priorities stay
 * here so a pack edit cannot change who a Skill is or when it is selected.
 */
export const PLATFORM_SKILLS: readonly {
    id: string;
    title: string;
    kind: 'instruction';
    priority: number;
    /** The pack template whose text is this Skill's content. */
    templateId: string;
}[] = [
    { id: 'platform-work', title: 'Platform work', kind: 'instruction', priority: 90, templateId: 'skill-platform-work' },
    { id: 'platform-secretary', title: 'Platform secretary', kind: 'instruction', priority: 70, templateId: 'skill-platform-secretary' },
    { id: 'platform-adviser', title: 'Platform adviser', kind: 'instruction', priority: 60, templateId: 'skill-platform-adviser' },
    { id: 'platform-scribe', title: 'Platform scribe', kind: 'instruction', priority: 50, templateId: 'skill-platform-scribe' },
    { id: 'platform-reviewer', title: 'Platform reviewer', kind: 'instruction', priority: 40, templateId: 'skill-platform-reviewer' },
];
