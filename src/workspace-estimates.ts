import { buildTaskTree } from './task-tree';
import type { Task } from './types';

/** Returns the sum of leaf estimates below a Work Item, including itself when it is a leaf. */
export function aggregateTaskEstimate(
  taskId: string,
  tasks: readonly Task[],
  tree = buildTaskTree([...tasks]),
) {
  const ids = tree.descendants(taskId);
  ids.add(taskId);
  return tasks
    .filter(task => ids.has(task.id) && !tree.hasChildren(task.id))
    .reduce((sum, task) => sum + Math.max(0, task.estimatedHours), 0);
}
