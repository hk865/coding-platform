No supported correctness defects found in `e070284b`.

Checked:

- All Goal control request builders send both pins; production route and driver forward requests unchanged.
- Missing GoalPhase pins return `invalid` before receipt lookup, matching requeue/reverify.
- Valid retries replay the original receipt before current-state checks.
- Revision `0` correctly represents an unstored GoalPhase and produces an absence CAS guard.
- Pause/cancel pin comparison and CAS decisions remain in `state/`; resume retains GOAL-05’s specified behavior.
- Tests cover missing pins, stale pins, zero pins, replay ordering, and concurrent completion.

Code-only review; no tests run and no files modified.