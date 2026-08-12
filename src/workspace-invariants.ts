import { buildTaskTree } from './task-tree';
import { getRecurringEstimatedHours } from './recurring-allocation';
import { aggregateTaskEstimate } from './workspace-estimates';
import { usesAutomaticEstimate } from './types';
import type { Allocation, Project, WorkspaceData } from './types';

export type WorkspaceInvariantOptions = Readonly<{
  /** Reconcile only this project; omit it during migration to reconcile all projects. */
  projectId?: string;
  /** Touch changed Task and Project timestamps for a live transition. */
  updatedAt?: string;
}>;

function allocatedHoursByTask(allocations: readonly Allocation[]) {
  const result = new Map<string, number>();
  for (const allocation of allocations)
    result.set(allocation.taskId, (result.get(allocation.taskId) || 0) + allocation.allocatedHours);
  return result;
}

function reconcileProject(
  project: Project,
  allocations: readonly Allocation[],
  updatedAt?: string,
): Project {
  const tree = buildTaskTree(project.tasks);
  const allocatedByTask = allocatedHoursByTask(allocations);
  let changed = false;

  const reconciledLeaves = project.tasks.map(task => {
    if (tree.hasChildren(task.id)) return task;

    const estimatedHours = task.recurrence
      ? getRecurringEstimatedHours(task, allocations)
      : usesAutomaticEstimate(task)
        ? allocatedByTask.get(task.id) || 0
        : task.estimatedHours;
    if (task.estimatedHours === estimatedHours) return task;
    changed = true;
    return {
      ...task,
      estimatedHours,
      ...(updatedAt ? { updatedAt } : {}),
    };
  });

  const reconciledTasks = reconciledLeaves.map(task => {
    if (!tree.hasChildren(task.id)) return task;
    const estimatedHours = aggregateTaskEstimate(task.id, reconciledLeaves, tree);
    if (task.estimatedHours === estimatedHours) return task;
    changed = true;
    return {
      ...task,
      estimatedHours,
      ...(updatedAt ? { updatedAt } : {}),
    };
  });

  if (!changed) return project;
  return {
    ...project,
    tasks: reconciledTasks,
    ...(updatedAt ? { updatedAt } : {}),
  };
}

/**
 * Reconciles the canonical estimate invariants for a workspace.
 *
 * Leaf automatic estimates follow their direct allocations, recurring leaf
 * estimates follow their rule plus occupied allocations, and every parent
 * estimate equals the sum of its descendant leaf estimates. The function is
 * immutable and can scope live work to one project while migration reconciles
 * every project. Timestamps are preserved unless `updatedAt` is supplied.
 */
export function reconcileWorkspaceInvariants(
  workspace: WorkspaceData,
  options: WorkspaceInvariantOptions = {},
): WorkspaceData {
  const projects = workspace.projects.map(project => {
    if (options.projectId && project.id !== options.projectId) return project;
    return reconcileProject(project, workspace.allocations, options.updatedAt);
  });
  return projects.some((project, index) => project !== workspace.projects[index])
    ? { ...workspace, projects }
    : workspace;
}
