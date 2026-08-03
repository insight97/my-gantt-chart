import {
  adjustAllocationDay as adjustAllocationDayEngine,
  fillAutomaticAllocations,
  returnTaskToBacklog,
  scheduleTaskAt,
  today,
} from './capacity';
import {
  aggregateTaskEstimate,
  buildTaskTree,
  now,
  taskDeadlineConstraint,
  uid,
  validateDeadlineHierarchy,
} from './data';
import { recurrenceRuleError } from './recurrence';
import { getRecurringEstimatedHours, planRecurringAllocations } from './recurring-allocation';
import { usesAutomaticEstimate } from './types';
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
  const nextWorkspace = {
    ...workspace,
    projects: workspace.projects.map(project =>
      project.id === projectId
        ? {
            ...project,
            tasks: moveTaskToEnd
              ? appendTaskToSiblingEnd(project.tasks, task)
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
  return syncParentEstimatedHours(nextWorkspace, projectId);
}

function appendTaskToSiblingEnd(tasks: Task[], task: Task): Task[] {
  const remaining = tasks.filter(value => value.id !== task.id);
  const siblings = remaining
    .filter(value => (value.parentId ?? null) === (task.parentId ?? null))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const orderById = new Map(siblings.map((value, index) => [value.id, index]));
  return [
    ...remaining.map(value =>
      orderById.has(value.id) ? { ...value, order: orderById.get(value.id)! } : value,
    ),
    { ...task, order: siblings.length },
  ];
}

function findProject(workspace: WorkspaceData, projectId: string) {
  return workspace.projects.find(project => project.id === projectId);
}

function findTask(project: Project, taskId: string) {
  return project.tasks.find(task => task.id === taskId);
}

/** Returns a group's leaf descendants in stable depth-first sibling order. */
function groupLeafTasks(
  project: Project,
  groupId: string,
  tree = buildTaskTree(project.tasks),
): Task[] {
  return tree.leafDescendants(groupId);
}

function replaceProjectTasksAndAllocations(
  workspace: WorkspaceData,
  projectId: string,
  tasks: Task[],
  allocations: Allocation[],
) {
  return syncParentEstimatedHours(
    {
      ...workspace,
      projects: workspace.projects.map(project =>
        project.id === projectId ? { ...project, tasks, updatedAt: now() } : project,
      ),
      allocations,
    },
    projectId,
  );
}

function syncAutomaticEstimatedHours(workspace: WorkspaceData, projectId: string) {
  const project = findProject(workspace, projectId);
  if (!project) return workspace;
  const tree = buildTaskTree(project.tasks);
  const allocatedByTask = new Map<string, number>();
  for (const allocation of workspace.allocations)
    allocatedByTask.set(
      allocation.taskId,
      (allocatedByTask.get(allocation.taskId) || 0) + allocation.allocatedHours,
    );
  let changed = false;
  const tasks = project.tasks.map(task => {
    if (!usesAutomaticEstimate(task) || tree.hasChildren(task.id)) return task;
    const estimatedHours = allocatedByTask.get(task.id) || 0;
    if (task.estimatedHours === estimatedHours) return task;
    changed = true;
    return { ...task, estimatedHours, updatedAt: now() };
  });
  if (!changed) return workspace;
  return {
    ...workspace,
    projects: workspace.projects.map(item =>
      item.id === projectId ? { ...item, tasks, updatedAt: now() } : item,
    ),
  };
}

/** Keep every persisted parent estimate equal to the sum of its leaf estimates. */
export function syncParentEstimatedHours(workspace: WorkspaceData, projectId: string) {
  const normalizedWorkspace = syncAutomaticEstimatedHours(workspace, projectId);
  const project = findProject(normalizedWorkspace, projectId);
  if (!project) return normalizedWorkspace;
  const tree = buildTaskTree(project.tasks);
  let changed = false;
  const tasks = project.tasks.map(task => {
    if (!tree.hasChildren(task.id)) return task;
    const estimatedHours = aggregateTaskEstimate(task.id, project.tasks, tree);
    if (task.estimatedHours === estimatedHours) return task;
    changed = true;
    return { ...task, estimatedHours, updatedAt: now() };
  });
  if (!changed) return normalizedWorkspace;
  return {
    ...normalizedWorkspace,
    projects: normalizedWorkspace.projects.map(item =>
      item.id === projectId ? { ...item, tasks, updatedAt: now() } : item,
    ),
  };
}

function parentHasDirectWork(workspace: WorkspaceData, parent: Task) {
  return workspace.allocations
    .filter(allocation => allocation.taskId === parent.id)
    .some(
      allocation => Number.isFinite(allocation.allocatedHours) && allocation.allocatedHours > 0,
    );
}

/** Moves a leaf parent's existing work into a real child before adding a new child. */
function preserveParentWorkAsUnsplit(
  workspace: WorkspaceData,
  projectId: string,
  parent: Task,
): WorkspaceData {
  const project = findProject(workspace, projectId);
  const tree = project ? buildTaskTree(project.tasks) : null;
  if (
    !project ||
    tree?.hasChildren(parent.id) ||
    (!parentHasDirectWork(workspace, parent) && !parent.recurrence)
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
        ? {
            ...item,
            tasks: item.tasks.flatMap(task =>
              task.id === parent.id
                ? [{ ...task, recurrence: null, updatedAt: now() }, unsplitTask]
                : [task],
            ),
            updatedAt: now(),
          }
        : item,
    ),
    allocations: workspace.allocations.map(allocation => {
      if (allocation.taskId !== parent.id) return allocation;
      const moved = { ...allocation, taskId: unsplitTask.id };
      if (allocation.recurrenceId) moved.recurrenceId = unsplitTask.id;
      return moved;
    }),
  };
}

function parentValidationError(
  project: Project,
  draft: Task,
  tree = buildTaskTree(project.tasks),
): string | null {
  const parentId = draft.parentId ?? null;
  if (!parentId) return null;
  if (parentId === draft.id) return 'Task 不可成為自己的父節點。';
  const parent = findTask(project, parentId);
  if (!parent) return '找不到父節點。';
  if (parent.status === 'completed') return '已完成工作不可作為父節點。';

  const descendants = tree.descendants(draft.id);
  if (descendants.has(parentId)) return '不可把 Task 移到自己的子樹內。';

  const sourceDepth = tree.depth(draft.id);
  const subtreeDepth = Math.max(
    0,
    ...project.tasks
      .filter(task => task.id === draft.id || descendants.has(task.id))
      .map(task => tree.depth(task.id) - sourceDepth),
  );
  if (tree.depth(parentId) + 1 + subtreeDepth > 3)
    return '任務階層最多三層。請先調整父項目或排序位置。';
  return null;
}

type PreparedTask = {
  workspace: WorkspaceData;
  project: Project;
  task: Task;
  existingTask: Task | undefined;
};

function prepareTaskForPersistence(
  workspace: WorkspaceData,
  projectId: string,
  draft: Task,
): PreparedTask | { error: string } {
  let project = findProject(workspace, projectId);
  if (!project) return { error: '找不到 Project。' };
  if (!draft.name.trim()) return { error: '請輸入 Task 名稱。' };
  if (!Number.isFinite(draft.estimatedHours) || draft.estimatedHours < 0)
    return { error: '請輸入有效的預估工時。' };
  if (draft.recurrence && recurrenceRuleError(draft.recurrence))
    return { error: recurrenceRuleError(draft.recurrence)! };
  const initialTree = buildTaskTree(project.tasks);
  const parentError = parentValidationError(project, draft, initialTree);
  if (parentError) return { error: parentError };

  const initialProject = project;
  const existingTask = findTask(initialProject, draft.id);
  if (initialTree.hasChildren(draft.id)) {
    if (draft.status === 'completed') return { error: '有子任務的工作項目不可標記為已完成。' };
    if (draft.recurrence) return { error: '父任務不可設定重複排程。' };
    draft = {
      ...draft,
      estimatedHours: initialProject.tasks
        .filter(
          task =>
            initialTree.descendants(draft.id).has(task.id) && !initialTree.hasChildren(task.id),
        )
        .reduce((sum, task) => sum + task.estimatedHours, 0),
    };
  }

  let nextWorkspace = workspace;
  const parentId = draft.parentId ?? null;
  const previousParentId = existingTask?.parentId ?? null;
  if (parentId && parentId !== previousParentId) {
    const parent = findTask(project, parentId)!;
    nextWorkspace = preserveParentWorkAsUnsplit(workspace, project.id, parent);
    project = findProject(nextWorkspace, project.id)!;
  }

  let task: Task = {
    ...draft,
    name: draft.name.trim(),
    recurrence: draft.recurrence ?? null,
    estimatedHoursMode:
      !draft.recurrence &&
      ((existingTask && draft.estimatedHours !== existingTask.estimatedHours) ||
        (!existingTask && draft.estimatedHours !== 0))
        ? 'manual'
        : (draft.estimatedHoursMode ?? 'manual'),
    updatedAt: now(),
  };
  if (!existingTask && task.parentId && !task.deadline)
    task = {
      ...task,
      deadline: taskDeadlineConstraint(project.tasks, task.parentId, buildTaskTree(project.tasks)),
    };

  const candidateTasks = project.tasks.some(item => item.id === task.id)
    ? project.tasks.map(item => (item.id === task.id ? task : item))
    : [...project.tasks, task];
  const deadlineError = validateDeadlineHierarchy(candidateTasks, buildTaskTree(candidateTasks));
  if (deadlineError) return { error: deadlineError };

  return { workspace: nextWorkspace, project, task, existingTask };
}

export function saveTask(
  workspace: WorkspaceData,
  projectId: string,
  draft: Task,
): WorkspaceOperationResult {
  const prepared = prepareTaskForPersistence(workspace, projectId, draft);
  if ('error' in prepared) return invalid(prepared.error);
  const { workspace: nextWorkspace, project, existingTask } = prepared;
  let nextTask = prepared.task;

  let taskAllocations: Allocation[] | undefined;
  if (nextTask.status === 'backlog') {
    const result = returnTaskToBacklog(nextTask);
    nextTask = result.task;
    taskAllocations = result.allocations;
  }

  if (nextTask.recurrence) {
    const effectiveAllocations = taskAllocations
      ? [
          ...nextWorkspace.allocations.filter(item => item.taskId !== nextTask.id),
          ...taskAllocations,
        ]
      : nextWorkspace.allocations;
    nextTask = {
      ...nextTask,
      estimatedHours: getRecurringEstimatedHours(nextTask, effectiveAllocations),
    };
  }

  const savedWorkspace = replaceTaskAndAllocations(
    nextWorkspace,
    project.id,
    nextTask,
    taskAllocations,
    existingTask?.status === 'backlog' && nextTask.status !== 'backlog',
  );
  return updated(savedWorkspace);
}

function withoutRecurrenceMarker(allocation: Allocation) {
  const manualAllocation = { ...allocation };
  delete manualAllocation.recurrenceId;
  return manualAllocation;
}

type TaskPlacementPlan = { task: Task; allocations?: Allocation[] };
type TaskPlacementPlanResult = TaskPlacementPlan | { error: string };

/** Plans a Timeline placement; preview and commit both cross this seam. */
function planTimelinePlacement(
  task: Task,
  allocations: Allocation[],
  date: string,
  autoSchedule: boolean,
): TaskPlacementPlanResult {
  if (!autoSchedule)
    return {
      task: { ...task, status: 'scheduled', start: date, end: date, updatedAt: now() },
    };

  if (task.recurrence) {
    const recurringPlan = planRecurringAllocations(task, allocations, 'replace');
    if (!recurringPlan) return { error: '重複排程沒有可套用的日期。' };
    if ('error' in recurringPlan) return recurringPlan;
    return recurringPlan;
  }

  try {
    const result = scheduleTaskAt(task, allocations, date);
    return { task: { ...result.task, updatedAt: now() }, allocations: result.allocations };
  } catch (error) {
    return { error: error instanceof Error ? error.message : '自動分配失敗。' };
  }
}

/** Returns the same Task shape that a Timeline drop will commit, without side effects. */
export function previewTimelinePlacement(
  task: Task,
  allocations: Allocation[],
  date: string,
  autoSchedule = true,
): Task | null {
  const planned = planTimelinePlacement(task, allocations, date, autoSchedule);
  return 'error' in planned ? null : planned.task;
}

/**
 * Fills only the missing schedule for a Task. Existing Allocation is always
 * retained; recurring generated records outside the current rule are cleaned
 * by the recurring allocation module.
 */
export function helpScheduleTask(
  workspace: WorkspaceData,
  projectId: string,
  taskId: string,
  draft?: Task,
): WorkspaceOperationResult {
  const project = findProject(workspace, projectId);
  if (!project) return invalid('找不到 Project。');
  const sourceTask = draft || findTask(project, taskId);
  if (!sourceTask || sourceTask.status === 'completed') return unchanged();
  if (buildTaskTree(project.tasks).hasChildren(sourceTask.id))
    return invalid('有子任務的工作項目不可直接排程。');
  const prepared = prepareTaskForPersistence(workspace, projectId, sourceTask);
  if ('error' in prepared) return invalid(prepared.error);
  const { workspace: nextWorkspace, project: nextProject, task } = prepared;

  if (task.recurrence) {
    const plan = planRecurringAllocations(task, nextWorkspace.allocations, 'fill');
    if (!plan) return unchanged();
    if ('error' in plan) return invalid(plan.error);
    return updated(
      replaceTaskAndAllocations(nextWorkspace, nextProject.id, plan.task, plan.allocations),
    );
  }

  const startDate = task.status === 'backlog' ? today() : task.start || today();
  const scheduledTask: Task = {
    ...task,
    status: task.status === 'backlog' ? 'scheduled' : task.status,
    start: task.start || startDate,
    updatedAt: now(),
  };
  const plan = fillAutomaticAllocations(scheduledTask, nextWorkspace.allocations, startDate);
  return updated(
    replaceTaskAndAllocations(nextWorkspace, nextProject.id, scheduledTask, plan.allocations),
  );
}

/** Clears all current Allocation while keeping the Task and recurring rule. */
export function clearTaskSchedule(
  workspace: WorkspaceData,
  projectId: string,
  taskId: string,
  draft?: Task,
): WorkspaceOperationResult {
  const project = findProject(workspace, projectId);
  if (!project) return invalid('找不到 Project。');
  const sourceTask = draft || findTask(project, taskId);
  if (!sourceTask || sourceTask.status === 'completed') return unchanged();
  if (buildTaskTree(project.tasks).hasChildren(sourceTask.id))
    return invalid('有子任務的工作項目不可直接清除排程。');
  const prepared = prepareTaskForPersistence(workspace, projectId, sourceTask);
  if ('error' in prepared) return invalid(prepared.error);
  const { workspace: nextWorkspace, project: nextProject, task } = prepared;
  const clearedTask = task.recurrence
    ? {
        ...task,
        estimatedHours: getRecurringEstimatedHours(task, []),
        updatedAt: now(),
      }
    : { ...task, updatedAt: now() };
  return updated(replaceTaskAndAllocations(nextWorkspace, nextProject.id, clearedTask, []));
}

function scheduleTaskTransition(
  workspace: WorkspaceData,
  project: Project,
  task: Task,
  date: string,
  moveToSiblingEnd: boolean,
): WorkspaceOperationResult {
  if (buildTaskTree(project.tasks).hasChildren(task.id))
    return invalid('有子任務的工作項目不可直接排程。');

  const plan = planTimelinePlacement(task, workspace.allocations, date, true);
  if ('error' in plan) return invalid(plan.error);
  return updated(
    replaceTaskAndAllocations(workspace, project.id, plan.task, plan.allocations, moveToSiblingEnd),
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
  const sourceTask = draft || findTask(project, taskId);
  if (!sourceTask || sourceTask.status === 'completed') return unchanged();
  const prepared = prepareTaskForPersistence(workspace, projectId, sourceTask);
  if ('error' in prepared) return invalid(prepared.error);
  const { workspace: nextWorkspace, project: nextProject, task, existingTask } = prepared;
  return scheduleTaskTransition(
    nextWorkspace,
    nextProject,
    task,
    task.status === 'backlog' ? today() : task.start || today(),
    !existingTask || task.status === 'backlog',
  );
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
  if (buildTaskTree(project.tasks).hasChildren(task.id))
    return invalid('有子任務的工作項目只能檢視彙總工時。');
  if (task.status === 'completed') return invalid('已完成 Task 不可修改。');
  if (
    delta < 0 &&
    !workspace.allocations.some(item => item.taskId === task.id && item.date === date)
  )
    return unchanged();

  try {
    const result = adjustAllocationDayEngine(task, workspace.allocations, date, delta);
    const allocations = result.allocations.map(allocation =>
      allocation.taskId === task.id && allocation.date === date && allocation.recurrenceId
        ? withoutRecurrenceMarker(allocation)
        : allocation,
    );
    const savedTask: Task = {
      ...task,
      status: task.status === 'in_progress' ? 'in_progress' : 'scheduled',
      updatedAt: now(),
    };
    return updated(replaceTaskAndAllocations(workspace, project.id, savedTask, allocations));
  } catch (error) {
    return invalid(error instanceof Error ? error.message : 'Allocation 更新失敗。');
  }
}

export function scheduleTaskAtDate(
  workspace: WorkspaceData,
  projectId: string,
  taskId: string,
  date: string,
  moveToSiblingEnd = true,
  autoSchedule = true,
): WorkspaceOperationResult {
  const project = findProject(workspace, projectId);
  const task = project && findTask(project, taskId);
  if (!project || !task || task.status === 'completed') return unchanged();
  if (!autoSchedule) return placeTaskOnTimeline(workspace, project, task, date, moveToSiblingEnd);
  return scheduleTaskTransition(workspace, project, task, date, moveToSiblingEnd);
}

function placeTaskOnTimeline(
  workspace: WorkspaceData,
  project: Project,
  task: Task,
  date: string,
  moveToSiblingEnd: boolean,
): WorkspaceOperationResult {
  if (buildTaskTree(project.tasks).hasChildren(task.id))
    return invalid('有子任務的工作項目不可直接放入 Timeline。');
  const plan = planTimelinePlacement(task, workspace.allocations, date, false);
  if ('error' in plan) return invalid(plan.error);
  return updated(
    replaceTaskAndAllocations(workspace, project.id, plan.task, plan.allocations, moveToSiblingEnd),
  );
}

export function moveTaskToBacklog(
  workspace: WorkspaceData,
  projectId: string,
  taskId: string,
  targetId?: string,
  relation?: Exclude<TaskMoveRelation, 'inside'>,
): WorkspaceOperationResult {
  const project = findProject(workspace, projectId);
  const task = project && findTask(project, taskId);
  if (!project || !task || task.status === 'completed') return unchanged();

  if (buildTaskTree(project.tasks).hasChildren(task.id))
    return invalid('有子任務的工作項目不可直接移回 Backlog。');

  let nextWorkspace = workspace;
  if (targetId && relation) {
    const target = findTask(project, targetId);
    if (target && (target.parentId ?? null) === (task.parentId ?? null)) {
      const moved = moveTask(workspace, projectId, taskId, targetId, relation);
      if (!moved.ok) return moved;
      if (moved.changed) nextWorkspace = moved.workspace;
    }
  }
  const nextProject = findProject(nextWorkspace, projectId)!;
  const nextTask = findTask(nextProject, taskId)!;
  const result = returnTaskToBacklog(nextTask);
  const returnedTask: Task = { ...result.task, updatedAt: now() };
  return updated(
    replaceTaskAndAllocations(nextWorkspace, projectId, returnedTask, result.allocations),
  );
}

/** Schedules every Backlog leaf in a group as one reversible workspace transition. */
export function moveTaskGroupToTimeline(
  workspace: WorkspaceData,
  projectId: string,
  groupId: string,
  date: string,
  autoSchedule = true,
): WorkspaceOperationResult {
  const project = findProject(workspace, projectId);
  const group = project && findTask(project, groupId);
  if (!project || !group) return unchanged();
  const tree = buildTaskTree(project.tasks);
  if (!tree.hasChildren(group.id)) return invalid('只有群組可批次移到 Allocation Timeline。');

  let nextWorkspace = workspace;
  let changed = false;
  try {
    for (const leaf of groupLeafTasks(project, group.id, tree)) {
      if (leaf.status !== 'backlog') continue;
      const currentProject = findProject(nextWorkspace, projectId)!;
      const current = findTask(currentProject, leaf.id)!;
      const result = autoSchedule
        ? scheduleTaskTransition(
            nextWorkspace,
            currentProject,
            { ...current, status: 'scheduled' },
            date,
            false,
          )
        : placeTaskOnTimeline(nextWorkspace, currentProject, current, date, false);
      if (!result.ok) return result;
      if (!result.changed) continue;
      nextWorkspace = result.workspace;
      changed = true;
    }
  } catch (error) {
    return invalid(error instanceof Error ? error.message : '群組自動分配失敗。');
  }
  if (!changed) return unchanged();
  return updated(nextWorkspace);
}

/** Returns every unfinished Timeline leaf in a group to Backlog as one reversible transition. */
export function moveTaskGroupToBacklog(
  workspace: WorkspaceData,
  projectId: string,
  groupId: string,
): WorkspaceOperationResult {
  const project = findProject(workspace, projectId);
  const group = project && findTask(project, groupId);
  if (!project || !group) return unchanged();
  const tree = buildTaskTree(project.tasks);
  if (!tree.hasChildren(group.id)) return invalid('只有群組可批次移回 Backlog。');

  const movedIds = new Set(
    groupLeafTasks(project, group.id, tree)
      .filter(task => task.status === 'scheduled' || task.status === 'in_progress')
      .map(task => task.id),
  );
  if (!movedIds.size) return unchanged();

  return updated(
    replaceProjectTasksAndAllocations(
      workspace,
      projectId,
      project.tasks.map(task =>
        movedIds.has(task.id) ? { ...task, status: 'backlog', updatedAt: now() } : task,
      ),
      workspace.allocations.filter(allocation => !movedIds.has(allocation.taskId)),
    ),
  );
}

export type TaskMoveRelation = 'inside' | 'before' | 'after';

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
  if (relation === 'inside' && target.status === 'completed')
    return invalid('已完成工作不可作為父節點。');
  const tree = buildTaskTree(project.tasks);
  const descendants = tree.descendants(sourceId);
  if (descendants.has(targetId)) return invalid('不可把工作項目移到自己的子樹內。');

  let nextWorkspace = workspace;
  if (relation === 'inside' && !tree.hasChildren(target.id)) {
    nextWorkspace = preserveParentWorkAsUnsplit(workspace, project.id, target);
    project = findProject(nextWorkspace, project.id)!;
  }

  const nextParentId = relation === 'inside' ? target.id : (target.parentId ?? null);
  const override = new Map<string, string | null>([[source.id, nextParentId]]);
  const movedTree = buildTaskTree(project.tasks, override);
  const subtreeDepth = Math.max(
    ...project.tasks
      .filter(task => task.id === source.id || descendants.has(task.id))
      .map(task => movedTree.depth(task.id) - movedTree.depth(source.id)),
  );
  if (movedTree.depth(source.id) + subtreeDepth > 3)
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
  const deadlineError = validateDeadlineHierarchy(normalized, buildTaskTree(normalized));
  if (deadlineError) return invalid(deadlineError);
  return updated(
    syncParentEstimatedHours(
      {
        ...nextWorkspace,
        projects: nextWorkspace.projects.map(item =>
          item.id === projectId ? { ...item, tasks: normalized, updatedAt: now() } : item,
        ),
      },
      projectId,
    ),
  );
}

/** Move a backlog leaf to a timeline relation and schedule it as part of that drop. */
export function moveTaskToTimeline(
  workspace: WorkspaceData,
  projectId: string,
  sourceId: string,
  targetId: string,
  relation: TaskMoveRelation,
  autoSchedule = true,
): WorkspaceOperationResult {
  const moved = moveTask(workspace, projectId, sourceId, targetId, relation);
  if (!moved.ok || !moved.changed) return moved;
  return scheduleTaskAtDate(moved.workspace, projectId, sourceId, today(), false, autoSchedule);
}

/** Move a backlog leaf under a timeline item and schedule it as a child. */
export function moveTaskToTimelineAsChild(
  workspace: WorkspaceData,
  projectId: string,
  sourceId: string,
  targetId: string,
  autoSchedule = true,
): WorkspaceOperationResult {
  return moveTaskToTimeline(workspace, projectId, sourceId, targetId, 'inside', autoSchedule);
}
