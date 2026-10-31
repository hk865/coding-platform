/**
 * The advance result's basis (LR7C-09). Pure data, never stored: the chooser returns it beside the Session it names
 * so the caller can explain "why this one / why none". `rank` has no `hint` (A-09).
 */
export type PickBasisV1 = {
  rank: 'responsible_task' | 'responsible_module' | 'same_goal_history' | 'duty'
    | 'latest_activity' | 'session_key' | 'none';
  incomplete: ('task_links' | 'module_links' | 'goal_history' | 'directory' | 'activity'
    | 'waits' | 'authorization')[];
  candidates: number;
};
