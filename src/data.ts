import type {
  Allocation,
  AllocationStrategy,
  DailyCapacity,
  ExportFile,
  Project,
  Task,
  TaskPriority,
  ViewMode,
  WorkspaceData,
} from './types';
import { CURRENT_WORKSPACE_VERSION } from './types';
import { addDays, datesBetween, defaultDailyCapacity, today } from './capacity';
import { priorityOrder } from './formatters';

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
  allocationStrategy: 'fastest',
  priority: 'medium',
  status: 'backlog',
  notes: '',
  owner: '',
  color: '#2f75bb',
  createdAt: now(),
  updatedAt: now(),
});

export const sampleProject = (): Project => {
  const createdAt = now();
  return {
    id: uid(),
    name: '網站改版計畫',
    description: 'Capacity Gantt 範例工作群組',
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
const allocationStrategies = new Set(['fastest', 'balanced']);
const sources = new Set(['automatic', 'manual']);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (value: unknown): value is string =>
  typeof value === 'string' && datePattern.test(value);
const isNullableDate = (value: unknown): value is string | null => value === null || isDate(value);
const isPriority = (value: unknown): value is TaskPriority =>
  typeof value === 'string' && priorities.has(value);
const isAllocationStrategy = (value: unknown): value is AllocationStrategy =>
  typeof value === 'string' && allocationStrategies.has(value);

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
    isAllocationStrategy(task.allocationStrategy) &&
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
    allocation.allocatedHours >= 0 &&
    typeof allocation.source === 'string' &&
    sources.has(allocation.source) &&
    typeof allocation.locked === 'boolean' &&
    (allocation.source !== 'automatic' || allocation.allocatedHours > 0)
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
    file.version === CURRENT_WORKSPACE_VERSION &&
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
      tasks: project.tasks.map(task => ({
        ...task,
        deadline: task.deadline ?? null,
        allocationStrategy: task.allocationStrategy ?? 'fastest',
        priority: task.priority ?? 'medium',
      })),
    })),
  };
}

/**
 * Splits a Project's Tasks into the three places the UI shows them.
 * A Scheduled Task stays on the Gantt while it has any Allocation record, a complete
 * date range, or a zero-hour estimate; otherwise it falls into the pending tray.
 */
export function partitionProjectTasks(project: Project, allocations: Allocation[]) {
  const allocatedTaskIds = new Set(allocations.map(allocation => allocation.taskId));
  const backlog: Task[] = [];
  const scheduled: Task[] = [];
  const pending: Task[] = [];
  for (const task of project.tasks) {
    if (task.status === 'backlog') backlog.push(task);
    else if (allocatedTaskIds.has(task.id) || (task.start && task.end) || task.estimatedHours === 0)
      scheduled.push(task);
    else pending.push(task);
  }
  backlog.sort(
    (a, b) =>
      priorityOrder[a.priority] - priorityOrder[b.priority] ||
      a.createdAt.localeCompare(b.createdAt),
  );
  return { backlog, scheduled, pending };
}

export type TaskDragMode = 'move' | 'start' | 'end';

function shiftTaskDate(date: string, delta: number, view: ViewMode) {
  if (view !== 'month') return addDays(date, delta * (view === 'week' ? 7 : 1));
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDate();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + delta);
  const lastDay = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0),
  ).getUTCDate();
  value.setUTCDate(Math.min(day, lastDay));
  return value.toISOString().slice(0, 10);
}

export function applyTaskDrag(
  task: Task,
  mode: TaskDragMode,
  delta: number,
  view: ViewMode = 'day',
) {
  if (!task.start || !task.end) return task;
  if (mode === 'move')
    return {
      ...task,
      start: shiftTaskDate(task.start, delta, view),
      end: shiftTaskDate(task.end, delta, view),
    };
  if (mode === 'start') {
    const start = shiftTaskDate(task.start, delta, view);
    return { ...task, start: start <= task.end ? start : task.end };
  }
  const end = shiftTaskDate(task.end, delta, view);
  return { ...task, end: end >= task.start ? end : task.start };
}
