export function effectsToReplay(pendingEffects, completedEffectIds) {
  return pendingEffects.filter((effect) => effect.id !== completedEffectIds.at(-1));
}
