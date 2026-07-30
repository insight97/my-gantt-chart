import {
  adjustAllocationDay as adjustAllocationDayEngine,
  returnTaskToBacklog,
  scheduleTaskAt,
  today,
} from './capacity';
import {
  now,
  taskDeadlineConstraint,
  taskHasChildren,
  taskDescendantIds,
  uid,
  validateDeadlineHierarchy,
} from './data';
import type { Allocation, Project, Task, WorkspaceData } from './types';

export type WorkspaceOperationResult =
  | { ok: true; changed: true; workspace: WorkspaceData }
  | { ok: true; changed: false }
  | { ok: false; error: string };

function updated(workspace: WorkspaceData): WorkspaceOperationResult {
  return { ok: true, changed: true, workspace };
}

function unchanged(): WorkspaceOperationResult {
  return { ok: true, changed: false };
}

function invalid(error: string): WorkspaceOperationResult {
  return { ok: false, error };
}

function replaceTaskAndAllocations(
  workspace: WorkspaceData,
  projectId: string,
  task: Task,
  taskAllocations?: Allocation[],
  moveTaskToEnd = false,
): WorkspaceData {
  const replacementAllocations = taskAllocations?.filter(item => item.taskId === task.id);
  return {
    ...workspace,
    projects: workspace.projects.map(project =>
      project.id === projectId
        ? {
            ...project,
            tasks: moveTaskToEnd
              ? [...project.tasks.filter(value => value.id !== task.id), task]
              : project.tasks.some(value => value.id === task.id)
                ? project.tasks.map(value => (value.id === task.id ? task : value))
                : [...project.tasks, task],
            updatedAt: now(),
          }
        : project,
    ),
    allocations: replacementAllocations
      ? [
          ...workspace.allocations.filter(item => item.taskId !== task.id),
          ...replacementAllocations,
        ]
      : workspace.allocations,
  };
}

function findProject(workspace: WorkspaceData, projectId: string) {
  return workspace.projects.find(project => project.id === projectId);
}

function findTask(project: Project, taskId: string) {
  return project.tasks.find(task => task.id === taskId);
}

function parentHasDirectWork(workspace: WorkspaceData, parent: Task) {
  return (
    parent.estimatedHours > 0 ||
    workspace.allocations.some(
      allocation => allocation.taskId === parent.id && allocation.allocatedHours > 0,
    )
  );
}

/** Moves a leaf parent's existing work into a real child before adding a new child. */
function preserveParentWorkAsUnsplit(
  workspace: WorkspaceData,
  projectId: string,
  parent: Task,
): WorkspaceData {
  const project = findProject(workspace, projectId);
  if (
    !project ||
    taskHasChildren(project.tasks, parent.id) ||
    !parentHasDirectWork(workspace, parent)
  )
    return workspace;

  const unsplitTask: Task = {
    ...parent,
    id: uid(),
    name: '未拆分工作',
    parentId: parent.id,
    order: 0,
    updatedAt: now(),
  };
  return {
    ...workspace,
    projects: workspace.projects.map(item =>
      item.id === projectId
        ? { ...item, tasks: [...item.tasks, unsplitTask], updatedAt: now() }
        : item,
    ),
    allocations: workspace.allocations.map(allocation =>
      allocation.taskId === parent.id ? { ...allocation, taskId: unsplitTask.id } : allocation,
    ),
  };
}

function parentValidationError(project: Project, draft: Task): string | null {
  const parentId = draft.parentId ?? null;
  if (!parentId) return null;
  if (parentId === draft.id) return 'Task 不可成為自己的父節點。';
  if (!findTask(project, parentId)) return '找不到父節點。';

  const descendants = taskDescendantIds(project.tasks, draft.id);
  if (descendants.has(parentId)) return '不可把 Task 移到自己的子樹內。';

  const sourceDepth = taskDepth(project.tasks, draft.id);
  const subtreeDepth = Math.max(
    0,
    ...project.tasks
      .filter(task => task.id === draft.id || descendants.has(task.id))
      .map(task => taskDepth(project.tasks, task.id) - sourceDepth),
  );
  if (taskDepth(project.tasks, parentId) + 1 + subtreeDepth > 3)
    return '任務階層最多三層。請先調整父項目或排序位置。';
  return null;
}

export function saveTask(
  workspace: WorkspaceData,
  projectId: string,
  draft: Task,
): WorkspaceOperationResult {
  let project = findProject(workspace, projectId);
  if (!project) return invalid('找不到 Project。');
  if (!draft.name.trim()) return invalid('請輸入 Task 名稱。');
  if (!Number.isFinite(draft.estimatedHours) || draft.estimatedHours < 0)
    return invalid('請輸入有效的預估工時。');
  const parentError = parentValidationError(project, draft);
  if (parentError) return invalid(parentError);
  const initialProject = project;
  if (taskHasChildren(initialProject.tasks, draft.id)) {
    draft = {
      ...draft,
      estimatedHours: initialProject.tasks
        .filter(
          task =>
            taskDescendantIds(initialProject.tasks, draft.id).has(task.id) &&
            !taskHasChildren(initialProject.tasks, task.id),
        )
        .reduce((sum, task) => sum + task.estimatedHours, 0),
    };
  }

  const existingTask = findTask(project, draft.id);
  let nextWorkspace = workspace;
  if (!existingTask && draft.parentId) {
    const parent = findTask(project, draft.parentId)!;
    nextWorkspace = preserveParentWorkAsUnsplit(workspace, project.id, parent);
    project = findProject(nextWorkspace, project.id)!;
  }

  let nextTask: Task = {
    ...draft,
    name: draft.name.trim(),
    updatedAt: now(),
  };
  if (!existingTask && nextTask.parentId && !nextTask.deadline)
    nextTask.deadline = taskDeadlineConstraint(project.tasks, nextTask.parentId);

  const candidateTasks = project.tasks.some(task => task.id === nextTask.id)
    ? project.tasks.map(task => (task.id === nextTask.id ? nextTask : task))
    : [...project.tasks, nextTask];
  const deadlineError = validateDeadlineHierarchy(candidateTasks);
  if (deadlineError) return invalid(deadlineError);

  let taskAllocations: Allocation[] | undefined;
  if (nextTask.status === 'backlog') {
    const result = returnTaskToBacklog({
      ...nextTask,
      parentId: !existingTask || existingTask.status === 'backlog' ? nextTask.parentId : null,
    });
    nextTask = result.task;
    taskAllocations = result.allocations;
  }

  return updated(
    replaceTaskAndAllocations(
      nextWorkspace,
      project.id,
      nextTask,
      taskAllocations,
      existingTask?.status === 'backlog' && nextTask.status !== 'backlog',
    ),
  );
}

export function autoScheduleTask(
  workspace: WorkspaceData,
  projectId: string,
  taskId: string,
  draft?: Task,
): WorkspaceOperationResult {
  const project = findProject(workspace, projectId);
  if (!project) return invalid('找不到 Project。');
  const task = draft
    ? { ...draft, name: draft.name.trim(), updatedAt: now() }
    : findTask(project, taskId);
  if (!task || task.status === 'completed') return unchanged();
  const parentError = parentValidationError(project, task);
  if (parentError) return invalid(parentError);
  if (taskHasChildren(project.tasks, task.id)) return invalid('有子任務的工作項目不可直接排程。');
  if (!task.name.trim() || !Number.isFinite(task.estimatedHours) || task.estimatedHours < 0)
    return invalid('請先輸入有效的 Task 名稱與預估工時。');

  try {
    const result = scheduleTaskAt(
      task,
      workspace.allocations,
      workspace.dailyCapacities,
      task.start || today(),
    );
    const nextTask: Task = { ...result.task, updatedAt: now() };
    return updated(
      replaceTaskAndAllocations(
        workspace,
        project.id,
        nextTask,
        result.allocations,
        !project.tasks.some(item => item.id === task.id) || task.status === 'backlog',
      ),
    );
  } catch (error) {
    return invalid(error instanceof Error ? error.message : '自動分配失敗。');
  }
}

export function adjustAllocationDay(
  workspace: WorkspaceData,
  projectId: string,
  taskId: string,
  date: string,
  delta: number,
): WorkspaceOperationResult {
  const project = findProject(workspace, projectId);
  if (!project) return invalid('找不到 Project。');
  const task = findTask(project, taskId);
  if (!task) return invalid('找不到 Task。');
  if (taskHasChildren(project.tasks, task.id))
    return invalid('有子任務的工作項目只能檢視彙總工時。');
  if (task.status === 'completed') return invalid('已完成 Task 不可修改。');

  try {
    const result = adjustAllocationDayEngine(task, workspace.allocations, date, delta);
    const savedTask: Task = {
      ...task,
      status: task.status === 'in_progress' ? 'in_progress' : 'scheduled',
      updatedAt: now(),
    };
    return updated(replaceTaskAndAllocations(workspace, project.id, savedTask, result.allocations));
  } catch (error) {
    return invalid(error instanceof Error ? error.message : 'Allocation 更新失敗。');
  }
}

export function scheduleTaskAtDate(
  workspace: WorkspaceData,
  projectId: string,
  taskId: string,
  date: string,
): WorkspaceOperationResult {
  const project = findProject(workspace, projectId);
  const task = project && findTask(project, taskId);
  const hasAllocations = workspace.allocations.some(item => item.taskId === taskId);
  if (
    !project ||
    !task ||
    task.status === 'completed' ||
    (task.status !== 'backlog' && hasAllocations)
  )
    return unchanged();
  if (taskHasChildren(project.tasks, task.id)) return invalid('有子任務的工作項目不可直接排程。');

  try {
    const result = scheduleTaskAt(
      { ...task, status: 'scheduled' },
      workspace.allocations,
      workspace.dailyCapacities,
      date,
    );
    const nextTask: Task = { ...result.task, updatedAt: now() };
    return updated(
      replaceTaskAndAllocations(workspace, projectId, nextTask, result.allocations, true),
    );
  } catch (error) {
    return invalid(error instanceof Error ? error.message : '自動分配失敗。');
  }
}

export function moveTaskToBacklog(
  workspace: WorkspaceData,
  projectId: string,
  taskId: string,
): WorkspaceOperationResult {
  const project = findProject(workspace, projectId);
  const task = project && findTask(project, taskId);
  if (!project || !task || task.status === 'completed') return unchanged();

  const result = returnTaskToBacklog({ ...task, parentId: null });
  const nextTask: Task = { ...result.task, updatedAt: now() };
  return updated(replaceTaskAndAllocations(workspace, projectId, nextTask, result.allocations));
}

export type TaskMoveRelation = 'inside' | 'before' | 'after';

function taskDepth(tasks: Task[], taskId: string, parentOverride?: Map<string, string | null>) {
  let depth = 0;
  let current: Task | undefined = tasks.find(task => task.id === taskId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    depth += 1;
    const parentId = parentOverride?.has(current.id)
      ? parentOverride.get(current.id)!
      : (current.parentId ?? null);
    current = parentId ? tasks.find(task => task.id === parentId) : undefined;
  }
  return depth;
}

/** Reparents or reorders a whole subtree without touching its allocations. */
export function moveTask(
  workspace: WorkspaceData,
  projectId: string,
  sourceId: string,
  targetId: string,
  relation: TaskMoveRelation,
): WorkspaceOperationResult {
  let project = findProject(workspace, projectId);
  if (!project) return invalid('找不到工作區。');
  if (sourceId === targetId) return unchanged();
  const source = findTask(project, sourceId);
  const target = findTask(project, targetId);
  if (!source || !target) return unchanged();
  const descendants = taskDescendantIds(project.tasks, sourceId);
  if (descendants.has(targetId)) return invalid('不可把工作項目移到自己的子樹內。');

  let nextWorkspace = workspace;
  if (relation === 'inside' && !taskHasChildren(project.tasks, target.id)) {
    nextWorkspace = preserveParentWorkAsUnsplit(workspace, project.id, target);
    project = findProject(nextWorkspace, project.id)!;
  }

  const nextParentId = relation === 'inside' ? target.id : (target.parentId ?? null);
  const override = new Map<string, string | null>([[source.id, nextParentId]]);
  const subtreeDepth = Math.max(
    ...project.tasks
      .filter(task => task.id === source.id || descendants.has(task.id))
      .map(
        task =>
          taskDepth(project.tasks, task.id, override) -
          taskDepth(project.tasks, source.id, override),
      ),
  );
  if (taskDepth(project.tasks, source.id, override) + subtreeDepth > 3)
    return invalid('任務階層最多三層。請先調整父項目或排序位置。');

  const sourceParent = source.parentId ?? null;
  const targetParent = nextParentId;
  const withoutSource = project.tasks.filter(task => task.id !== source.id);
  const siblings = withoutSource
    .filter(task => (task.parentId ?? null) === targetParent)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const targetIndex =
    relation === 'inside'
      ? siblings.length
      : Math.max(
          0,
          siblings.findIndex(task => task.id === target.id) + (relation === 'after' ? 1 : 0),
        );
  const reordered = [...siblings];
  reordered.splice(targetIndex, 0, { ...source, parentId: targetParent });
  const orderById = new Map(reordered.map((task, index) => [task.id, index]));
  const tasks = project.tasks.map(task => {
    if (task.id === source.id)
      return {
        ...task,
        parentId: targetParent,
        order: orderById.get(task.id) ?? 0,
        updatedAt: now(),
      };
    if ((task.parentId ?? null) === targetParent && orderById.has(task.id))
      return { ...task, order: orderById.get(task.id)! };
    return task;
  });
  // Keep the old siblings' order compact after a cross-parent move.
  const normalized = tasks.map(task =>
    (task.parentId ?? null) === sourceParent && !orderById.has(task.id)
      ? { ...task, order: task.order ?? 0 }
      : task,
  );
  const deadlineError = validateDeadlineHierarchy(normalized);
  if (deadlineError) return invalid(deadlineError);
  return updated({
    ...nextWorkspace,
    projects: nextWorkspace.projects.map(item =>
      item.id === projectId ? { ...item, tasks: normalized, updatedAt: now() } : item,
    ),
  });
}

/** Move a backlog leaf under a timeline item and schedule it as part of that drop. */
export function moveTaskToTimelineAsChild(
  workspace: WorkspaceData,
  projectId: string,
  sourceId: string,
  targetId: string,
): WorkspaceOperationResult {
  const moved = moveTask(workspace, projectId, sourceId, targetId, 'inside');
  if (!moved.ok || !moved.changed) return moved;
  return scheduleTaskAtDate(moved.workspace, projectId, sourceId, today());
}
