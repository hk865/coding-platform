/**
 * L32 capacity episodes, the pure half: the next episode number of one (project, duty), whether an open episode
 * closes, and the closed record. The record format and codec are the contracts' and the role-line codecs'
 * (`RoleCapacityEpisodeFormat`); the observation and close commands are the capacity service's. One open episode per
 * (project, duty); the card is the read projection of the open episode, so no card row is stored.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { RoleCapacityEpisodeV1, RoleLineDutyV1 } from '../../../contracts/role-lines.js';

export function nextCapacityEpisode(episodes: readonly RoleCapacityEpisodeV1[], duty: RoleLineDutyV1): number {
  return episodes.reduce((max, episode) => episode.duty === duty ? Math.max(max, episode.episode) : max, 0) + 1;
}

/** Closes when the duty is below its cap again, or when the cap the episode observed has moved. */
export function capacityEpisodeCloses(input: { episode: RoleCapacityEpisodeV1; open: number;
  holders: number; reservations: number }): boolean {
  return input.holders + input.reservations < input.open || input.episode.capValue !== input.open;
}

export function closeCapacityEpisode(episode: RoleCapacityEpisodeV1, closedAt: CommitCursor):
  RoleCapacityEpisodeV1 {
  return { ...structuredClone(episode), revision: episode.revision + 1, closedAt };
}
