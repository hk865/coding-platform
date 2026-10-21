import type { TemplateSlotTableV1 } from './prompt-pack.js';

/**
 * The code-owned slot tables of the platform templates. A pack may change only
 * the text, never which slots exist or which of them are required.
 *
 * Required means the formatted slot value must be non-empty. A required slot
 * may therefore receive text whose business source was empty, as long as the
 * formatting supplies a heading or separator.
 *
 * The three main input templates (`work-input`, `query-planning-input`,
 * `query-copy-input`) are rendered by the context assembler later; their
 * tables are frozen here so the pack format and the renderer do not change
 * when those templates arrive.
 */
export const TEMPLATE_SLOTS: Readonly<Record<string, TemplateSlotTableV1>> = {
    'work-input': {
        role: { required: true },
        prelude: { required: false },
        goal: { required: false },
        task: { required: false },
        footprint: { required: false },
        notes: { required: false },
        reminders: { required: false },
        inputs: { required: false },
        continuation: { required: false },
        unknown_call_review: { required: false },
    },
    'query-planning-input': {
        role: { required: true },
        prelude: { required: false },
        goal: { required: false },
        task: { required: false },
        footprint: { required: false },
    },
    'query-copy-input': {
        role: { required: true },
        prelude: { required: false },
        goal: { required: false },
        task: { required: false },
    },
    'initial-planning-answer': {},
    'continuation-brief': {
        marker: { required: true },
        body: { required: false },
        bodyOmission: { required: false },
        anomalies: { required: false },
        review: { required: false },
        blocked: { required: false },
        blockedOmission: { required: false },
    },
    'unknown-call-review': {
        workspaceLines: { required: true },
        writtenLines: { required: true },
        items: { required: false },
    },
    'unknown-call-proposal': {
        workspaceLines: { required: true },
        writtenLines: { required: true },
        targets: { required: false },
        personNote: { required: false },
        annotations: { required: false },
        platformTargets: { required: false },
    },
    'consultation-received-input': {
        messageId: { required: true },
        sourceJson: { required: true },
    },
    'user-decision-response': {
        bodyJson: { required: true },
    },
    'scribe-reminder': {
        marker: { required: true },
        pendingCount: { required: true },
        updateDueCount: { required: true },
        anchors: { required: false },
    },
};
