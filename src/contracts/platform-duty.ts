/**
 * The five platform duties (orchestration design, section 4.10; decision 37).
 * A Session's duty comes from its role configuration and is fixed when the
 * Session is created; it never changes while the Session runs.
 */
export type PlatformDutyV1 = 'executor' | 'secretary' | 'adviser' | 'scribe' | 'reviewer';
