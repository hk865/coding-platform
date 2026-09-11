export function effectsToReplay(pendingEffects, completedEffectIds) {
  const completed = new Set(completedEffectIds);
  return pendingEffects.filter((effect) => !completed.has(effect.id));
}
