import type {
  Allocation,
  DailyCapacity,
  ExportFile,
  Project,
  Task,
  TaskPriority,
  WorkspaceData,
} from './types';
import { CURRENT_WORKSPACE_VERSION } from './types';
import { addDays, datesBetween, defaultDailyCapacity, today } from './capacity';

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

const offsetDate = (offset: number) => addDays(today(), offset);

export const emptyTask = (): Task => ({
  id: uid(),
  name: '新工作',
  start: null,
  end: null,
  deadline: null,
  estimatedHours: 8,
  priority: 'medium',
  status: 'backlog',
  notes: '',
  owner: '',
  color: '#2f75bb',
  createdAt: now(),
  updatedAt: now(),
  parentId: null,
  order: 0,
});

export const sampleProject = (): Project => {
  const createdAt = now();
  return {
    id: uid(),
    name: '網站改版計畫',
    description: 'Capacity Allocation 範例工作群組',
    createdAt,
    updatedAt: createdAt,
    tasks: [
      { ...emptyTask(), name: '整理需求與訪談', estimatedHours: 12 },
      {
        ...emptyTask(),
        name: '介面設計',
        start: offsetDate(1),
        end: offsetDate(4),
        estimatedHours: 20,
      },
      {
        ...emptyTask(),
        name: '第一版開發',
        start: offsetDate(5),
        end: offsetDate(10),
        estimatedHours: 32,
      },
    ],
  };
};

export function sampleWorkspace(): WorkspaceData {
  const start = offsetDate(-2);
  const project = sampleProject();
  return {
    version: CURRENT_WORKSPACE_VERSION,
    projects: [project],
    dailyCapacities: datesBetween(start, offsetDate(45)).map(date => defaultDailyCapacity(date)),
    allocations: [],
  };
}

const statuses = new Set(['backlog', 'scheduled', 'in_progress', 'completed']);
const priorities = new Set(['low', 'medium', 'high']);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (value: unknown): value is string =>
  typeof value === 'string' && datePattern.test(value);
const isNullableDate = (value: unknown): value is string | null => value === null || isDate(value);
const isPriority = (value: unknown): value is TaskPriority =>
  typeof value === 'string' && priorities.has(value);
// Assumes `value` has already gone through db.ts's migrateWorkspace, which is the
// only place that fills in fields added since the schema was first shaped — so every
// field here is required, not optionally undefined.
function validTask(value: unknown): value is Task {
  if (!value || typeof value !== 'object') return false;
  const task = value as Partial<Task>;
  return (
    typeof task.id === 'string' &&
    typeof task.name === 'string' &&
    isNullableDate(task.start) &&
    isNullableDate(task.end) &&
    isNullableDate(task.deadline) &&
    typeof task.estimatedHours === 'number' &&
    Number.isFinite(task.estimatedHours) &&
    task.estimatedHours >= 0 &&
    isPriority(task.priority) &&
    typeof task.status === 'string' &&
    statuses.has(task.status) &&
    typeof task.createdAt === 'string' &&
    typeof task.updatedAt === 'string'
  );
}

function validProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false;
  const project = value as Partial<Project>;
  return (
    typeof project.id === 'string' &&
    typeof project.name === 'string' &&
    typeof project.description === 'string' &&
    typeof project.createdAt === 'string' &&
    typeof project.updatedAt === 'string' &&
    Array.isArray(project.tasks) &&
    project.tasks.every(validTask)
  );
}

function validCapacity(value: unknown): value is DailyCapacity {
  if (!value || typeof value !== 'object') return false;
  const capacity = value as Record<string, unknown>;
  return (
    isDate(capacity.date) &&
    typeof capacity.totalCapacityHours === 'number' &&
    capacity.totalCapacityHours >= 0 &&
    typeof capacity.unavailableHours === 'number' &&
    capacity.unavailableHours >= 0 &&
    typeof capacity.availableHours === 'number'
  );
}

function validAllocation(value: unknown): value is Allocation {
  if (!value || typeof value !== 'object') return false;
  const allocation = value as Record<string, unknown>;
  return (
    typeof allocation.id === 'string' &&
    typeof allocation.taskId === 'string' &&
    isDate(allocation.date) &&
    typeof allocation.allocatedHours === 'number' &&
    Number.isFinite(allocation.allocatedHours) &&
    allocation.allocatedHours >= 0
  );
}

/** Strict structural check of the current shape — call after db.ts's migrateWorkspace. */
export function validWorkspaceData(value: unknown): value is WorkspaceData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<WorkspaceData>;
  return (
    data.version === CURRENT_WORKSPACE_VERSION &&
    Array.isArray(data.projects) &&
    data.projects.every(validProject) &&
    Array.isArray(data.dailyCapacities) &&
    data.dailyCapacities.every(validCapacity) &&
    Array.isArray(data.allocations) &&
    data.allocations.every(validAllocation)
  );
}

/**
 * Gates whether a raw imported file is worth migrating at all: the export envelope
 * (schema tag, current version, timestamp) plus enough shape to migrate safely
 * without throwing. Field-level strictness is `validWorkspaceData`'s job, run after
 * migrateWorkspace has had a chance to fill in defaults for older exports.
 */
export function validateImport(value: unknown): value is ExportFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Record<string, unknown>;
  return (
    file.schema === 'gantt-capacity-local' &&
    typeof file.version === 'number' &&
    file.version >= 1 &&
    file.version <= CURRENT_WORKSPACE_VERSION &&
    typeof file.exportedAt === 'string' &&
    Array.isArray(file.projects) &&
    file.projects.every(
      project =>
        Boolean(project) &&
        typeof project === 'object' &&
        Array.isArray((project as Record<string, unknown>).tasks),
    ) &&
    Array.isArray(file.dailyCapacities) &&
    Array.isArray(file.allocations)
  );
}

export function normalizeWorkspaceData(value: WorkspaceData): WorkspaceData {
  return {
    ...value,
    projects: value.projects.map(project => ({
      ...project,
      tasks: project.tasks.map((task, index) => {
        const currentTask = { ...(task as Task & { allocationStrategy?: unknown }) };
        delete currentTask.allocationStrategy;
        return {
          ...currentTask,
          deadline: task.deadline ?? null,
          priority: task.priority ?? 'medium',
          parentId: task.parentId ?? null,
          order: Number.isFinite(task.order) ? task.order : index,
        };
      }),
    })),
    allocations: value.allocations.map(allocation => ({
      id: allocation.id,
      taskId: allocation.taskId,
      date: allocation.date,
      allocatedHours: allocation.allocatedHours,
    })),
  };
}

export const taskChildren = (tasks: Task[], parentId: string | null) =>
  tasks
    .filter(task => (task.parentId ?? null) === parentId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

export function taskDepth(tasks: Task[], taskId: string): number {
  let depth = 0;
  let current = tasks.find(task => task.id === taskId);
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    depth += 1;
    current = current.parentId ? tasks.find(task => task.id === current?.parentId) : undefined;
  }
  return depth;
}

export function taskDescendantIds(tasks: Task[], taskId: string): Set<string> {
  const result = new Set<string>();
  const pending = [taskId];
  while (pending.length) {
    const parentId = pending.shift()!;
    for (const child of tasks.filter(task => (task.parentId ?? null) === parentId)) {
      if (result.has(child.id)) continue;
      result.add(child.id);
      pending.push(child.id);
    }
  }
  return result;
}

/** Returns the strictest deadline inherited from the ancestors of a work item. */
export function taskDeadlineConstraint(tasks: Task[], parentId: string | null) {
  let currentId = parentId;
  let constraint: string | null = null;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const parent = tasks.find(task => task.id === currentId);
    if (!parent) break;
    if (parent.deadline && (!constraint || parent.deadline < constraint))
      constraint = parent.deadline;
    currentId = parent.parentId ?? null;
  }
  return constraint;
}

/** Ensures every explicitly dated descendant completes by each dated ancestor. */
export function validateDeadlineHierarchy(tasks: Task[]) {
  for (const task of tasks) {
    if (!task.deadline) continue;
    let currentId = task.parentId ?? null;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const parent = tasks.find(value => value.id === currentId);
      if (!parent) break;
      if (parent.deadline && task.deadline > parent.deadline)
        return `「${task.name}」的截止日期不可晚於父任務「${parent.name}」。`;
      currentId = parent.parentId ?? null;
    }
  }
  return null;
}

export const taskHasChildren = (tasks: Task[], taskId: string) =>
  tasks.some(task => (task.parentId ?? null) === taskId);

export function aggregateTaskAllocations(taskId: string, tasks: Task[], allocations: Allocation[]) {
  const ids = taskDescendantIds(tasks, taskId);
  ids.add(taskId);
  return allocations.filter(allocation => ids.has(allocation.taskId));
}

export function aggregateTaskHours(taskId: string, tasks: Task[], allocations: Allocation[]) {
  const ids = taskDescendantIds(tasks, taskId);
  ids.add(taskId);
  return allocations
    .filter(allocation => ids.has(allocation.taskId))
    .reduce((sum, allocation) => sum + allocation.allocatedHours, 0);
}

export function aggregateTaskEstimate(taskId: string, tasks: Task[]) {
  const ids = taskDescendantIds(tasks, taskId);
  ids.add(taskId);
  return tasks
    .filter(task => ids.has(task.id) && !taskHasChildren(tasks, task.id))
    .reduce((sum, task) => sum + Math.max(0, task.estimatedHours), 0);
}

/** Pre-order tree used by both Backlog and Timeline. */
export function flattenTaskTree(tasks: Task[], expandedIds: Set<string>) {
  const result: Array<{ task: Task; depth: number }> = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const task of taskChildren(tasks, parentId)) {
      result.push({ task, depth });
      if (expandedIds.has(task.id)) visit(task.id, depth + 1);
    }
  };
  visit(null, 1);
  return result;
}

/**
 * Builds the context chain for leaf tasks selected by a view predicate.
 *
 * A parent is an aggregate, not a schedulable item. It is still projected beside each
 * matching leaf so a child is never shown without its hierarchy context. A parent may
 * therefore be present in both projections while remaining one persisted Task.
 */
function projectedTaskIds(tasks: Task[], includesLeaf: (task: Task) => boolean) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const result = new Set<string>();
  for (const task of tasks) {
    if (taskHasChildren(tasks, task.id) || !includesLeaf(task)) continue;
    let current: Task | undefined = task;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      result.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return result;
}

function flattenProjectedTaskTree(
  tasks: Task[],
  includedIds: Set<string>,
  expandedIds: Set<string>,
) {
  const result: Task[] = [];
  const visit = (parentId: string | null) => {
    for (const task of taskChildren(tasks, parentId)) {
      if (!includedIds.has(task.id)) continue;
      result.push(task);
      if (expandedIds.has(task.id)) visit(task.id);
    }
  };
  visit(null);
  return result;
}

/**
 * Projects the one task tree into Backlog and Allocation Timeline views.
 *
 * Leaf status decides the destination. Every selected leaf brings its full ancestor
 * chain with it; Backlog always exposes that chain, while Timeline respects its own
 * expand/collapse state. Parents cannot appear by themselves merely because they
 * have children.
 */
export function partitionProjectTasks(project: Project, timelineExpandedIds = new Set<string>()) {
  const backlogIds = projectedTaskIds(project.tasks, task => task.status === 'backlog');
  const scheduledIds = projectedTaskIds(project.tasks, task => task.status !== 'backlog');
  return {
    backlog: flattenProjectedTaskTree(project.tasks, backlogIds, backlogIds),
    scheduled: flattenProjectedTaskTree(project.tasks, scheduledIds, timelineExpandedIds),
  };
}
