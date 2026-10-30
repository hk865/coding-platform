import type { TemplateSlotTableV1 } from './prompt-pack.js';

/**
 * The code-owned slot tables of the platform templates. A pack may change only
 * the text, never which slots exist or which of them are required.
 *
 * Required means the formatted slot value must be non-empty. A required slot
 * may therefore receive text whose business source was empty, as long as the
 * formatting supplies a heading or separator.
 *
 * The input templates (`work-input`, `query-planning-input`, `query-copy-input`,
 * `intervention-planning` and `secretary-round`) are rendered by a context
 * recipe; their own slot order is the section order, so their tables are frozen
 * here with the format and renderer. In `secretary-round` the three `task_*`
 * slots are one `task` section and stay adjacent in their declared order.
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
    // The intervention-planning Query carries the goal, the current plan (the
    // `task` binding section) and the person's message as its own slot.
    'intervention-planning': {
        role: { required: true },
        prelude: { required: false },
        goal: { required: true },
        plan: { required: false },
        message: { required: true },
    },
    // The secretary's task section is one section made of three adjacent slots
    // in this internal order; `task_round` is the required one.
    'secretary-round': {
        prelude: { required: false },
        role: { required: true },
        goal: { required: false },
        notes: { required: false },
        task_round: { required: true },
        task_batched: { required: false },
        task_earlier: { required: false },
    },
    'secretary-answer': {},
    // Each handoff template renders one task-round value: the five-part
    // instruction and the command's goal list, or a successor's whole brief.
    'handoff-write-understanding-secretary': {
        task_round: { required: true },
    },
    'handoff-brief-secretary': {
        task_round: { required: true },
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
    'action-request-delivery': {
        messageId: { required: true },
        sender: { required: true },
        body: { required: true },
    },
    'inquiry-delivery': {
        messageId: { required: true },
        sender: { required: true },
        body: { required: true },
        deadline: { required: true },
    },
    'notify-delivery': {
        messageId: { required: true },
        sender: { required: true },
        body: { required: true },
    },
    'wait-reply-delivery': {
        messageId: { required: true },
        question: { required: true },
        body: { required: true },
    },
    'wait-expiry-delivery': {
        messageId: { required: true },
        question: { required: true },
        deadline: { required: true },
        expiryCount: { required: true },
    },
    'intervention-delivery': {
        messageId: { required: true },
        body: { required: true },
    },
    'scribe-reminder': {
        marker: { required: true },
        pendingCount: { required: true },
        updateDueCount: { required: true },
        anchors: { required: false },
    },
    // The stale-files reminder is fixed text with no slots.
    'stale-files-reminder': {},
    // Ruling 11: `base` and the five platform Skills are fixed text with no slots.
    'base': {},
    'skill-platform-work': {},
    'skill-platform-secretary': {},
    'skill-platform-adviser': {},
    'skill-platform-scribe': {},
    'skill-platform-reviewer': {},
};
