# fix-c.py <copy>: lead fixes after the Codex re-review of area C (exact replacements, each asserted once).
import sys, pathlib
p = pathlib.Path(sys.argv[1]) / 'src/app/collaboration-driver.ts'
s = p.read_text(encoding='utf-8')
def rep(old, new):
    global s
    assert s.count(old) == 1, (s.count(old), old[:80])
    s = s.replace(old, new)
# LC1 (Codex C #2): the Goal-scope re-selection after a pinned yielded Task completed may claim/create other work,
# so it is ordered; the pinned select_work the Workflow returns after complete_task only observes that Task.
rep("""      // The Goal-scope `select_work` the driver builds after a pinned Task has
      // already completed only observes that completed step (the formal gates and
      // reduction); it never claims or creates work, so it never enters the
      // ordering safe point and never waits.
      let observingCompletedStep = false;""",
"""      // The `select_work` the Workflow returns after `complete_task`, pinned to
      // that same Task, only observes the satisfied Task; it never claims or
      // creates work, so it never enters the ordering safe point and never waits.
      let observingCompletedStep = false;""")
rep("""            handle.current = next;
            input = next;
            // This transition observes the completed Task; it must not join the
            // pending set of the next claim/create safe point.
            observingCompletedStep = true;
            continue;""",
"""            handle.current = next;
            input = next;
            // This Goal-scope selection may claim/create other work of the Goal,
            // so it takes part in the ordering safe point like any selection.
            continue;""")
rep("""        handle.current = value.next;
        input = value.next;
      }
    } catch (error) {""",
"""        handle.current = value.next;
        input = value.next;
        observingCompletedStep = value.receipt?.kind === 'complete_task'
          && value.next.kind === 'select_work' && value.next.taskId !== undefined;
      }
    } catch (error) {""")
# LC2 (Codex C #1, the part that is ours): a stop/close while a handle waits at the safe point releases that wait
# at once (the entry leaves the pending set; the pass skips it), instead of waiting for the earlier Workflow calls.
rep("""  const rendezvousPasses = new Map<string, Promise<void>>();
""",
"""  const rendezvousPasses = new Map<string, Promise<void>>();
  /** The safe-point wait of a handle, released at once by a stop. */
  const admissionWaits = new Map<Handle, () => void>();
""")
rep("""    let handedOff = false;
    try {
      await released;""",
"""    let handedOff = false;
    admissionWaits.set(handle, entry.release);
    try {
      await released;""")
rep("""    } finally {
      // A handle that never reaches its Workflow call (stop, close, read failure)
      // still releases the pass waiting on it.
      if (!handedOff) entry.proceed();""",
"""    } finally {
      admissionWaits.delete(handle);
      // A handle that never reaches its Workflow call (stop, close, read failure)
      // still releases the pass waiting on it.
      if (!handedOff) entry.proceed();""")
rep("""    handle.activePumpAbort?.abort('driver_stopped');
    handle.stopDrain = (async () => {""",
"""    handle.activePumpAbort?.abort('driver_stopped');
    admissionWaits.get(handle)?.();
    handle.stopDrain = (async () => {""")
p.write_text(s, encoding='utf-8', newline='\n')
print('ok')
