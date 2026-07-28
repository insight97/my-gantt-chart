import {
  adjustAllocationDay as adjustAllocationDayEngine,
  returnTaskToBacklog,
  scheduleTaskAt,
  today,
} from './capacity';
import { now } from './data';
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

export function saveTask(
  workspace: WorkspaceData,
  projectId: string,
  draft: Task,
): WorkspaceOperationResult {
  const project = findProject(workspace, projectId);
  if (!project) return invalid('找不到 Project。');
  if (!draft.name.trim()) return invalid('請輸入 Task 名稱。');
  if (!Number.isFinite(draft.estimatedHours) || draft.estimatedHours < 0)
    return invalid('請輸入有效的預估工時。');
  if (draft.start && draft.end && draft.start > draft.end)
    return invalid('開始日期不可晚於結束日期。');

  const existingTask = findTask(project, draft.id);
  let nextTask: Task = {
    ...draft,
    name: draft.name.trim(),
    updatedAt: now(),
  };
  let taskAllocations: Allocation[] | undefined;
  if (nextTask.status === 'backlog') {
    const result = returnTaskToBacklog(nextTask);
    nextTask = result.task;
    taskAllocations = result.allocations;
  }

  return updated(
    replaceTaskAndAllocations(
      workspace,
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
  if (!task.name.trim() || !Number.isFinite(task.estimatedHours) || task.estimatedHours < 0)
    return invalid('請先輸入有效的 Task 名稱與預估工時。');
  if (task.start && task.end && task.start > task.end) return invalid('開始日期不可晚於結束日期。');

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

  const result = returnTaskToBacklog(task);
  const nextTask: Task = { ...result.task, updatedAt: now() };
  return updated(replaceTaskAndAllocations(workspace, projectId, nextTask, result.allocations));
}
