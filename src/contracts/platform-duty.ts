/**
 * The five platform duties (orchestration design, section 4.10; decision 37).
 * A Session's duty comes from its role configuration and is fixed when the
 * Session is created; it never changes while the Session runs.
 */
export type PlatformDutyV1 = 'executor' | 'secretary' | 'adviser' | 'scribe' | 'reviewer';

/** Keyed by `PlatformDutyV1`, so a duty added there must be added here (the list is the keys, in this order). */
const PLATFORM_DUTY_KEYS: Readonly<Record<PlatformDutyV1, true>> = {
  executor: true, secretary: true, adviser: true, scribe: true, reviewer: true,
};
/** The one runtime list of the platform duties, in the order of `PlatformDutyV1`. */
export const PLATFORM_DUTIES = Object.keys(PLATFORM_DUTY_KEYS) as [PlatformDutyV1, ...PlatformDutyV1[]];
