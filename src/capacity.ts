import type { Allocation, Task } from './types';
import { buildTaskTree } from './task-tree';

const DAY_MS = 86400000;
export const DEFAULT_PLANNING_HORIZON_DAYS = 180;
export const DEFAULT_DAILY_CAPACITY_HOURS = 24;

export interface AllocationResult {
  allocations: Allocation[];
}

export interface ScheduleResult {
  task: Task;
  allocations: Allocation[];
}

export interface RecalculateOptions {
  horizonDays?: number;
}

export function getProjectEstimatedHours(project: { tasks: Task[] }) {
  const tree = buildTaskTree(project.tasks);
  return project.tasks
    .filter(task => !tree.hasChildren(task.id))
    .reduce((sum, task) => sum + Math.max(0, task.estimatedHours), 0);
}

export function getTaskScheduleDates(taskId: string, allocations: Allocation[]) {
  return allocations
    .filter(item => item.taskId === taskId && item.allocatedHours > 0)
    .map(item => item.date)
    .sort();
}

export function isTaskOverdue(task: Task, allocations: Allocation[]) {
  if (!task.deadline) return false;
  const latestAllocation = allocations
    .filter(item => item.allocatedHours > 0)
    .map(item => item.date)
    .sort()
    .at(-1);
  return Boolean(latestAllocation && latestAllocation > task.deadline);
}

export function getTaskAllocatedHours(taskId: string, allocations: Allocation[]) {
  return allocations
    .filter(allocation => allocation.taskId === taskId)
    .reduce((sum, allocation) => sum + allocation.allocatedHours, 0);
}

export function getTaskPendingHours(task: Task, allocations: Allocation[]) {
  return task.estimatedHours - getTaskAllocatedHours(task.id, allocations);
}

export function getDailyAllocatedHours(
  date: string,
  allocations: Allocation[],
  excludeTaskId?: string,
) {
  return allocations
    .filter(allocation => allocation.date === date && allocation.taskId !== excludeTaskId)
    .reduce((sum, allocation) => sum + allocation.allocatedHours, 0);
}

/** Date-keyed indexes so render paths avoid re-scanning the whole allocation set per day. */
export function allocationsByTask(allocations: Allocation[]) {
  const index = new Map<string, Allocation[]>();
  for (const allocation of allocations) {
    const existing = index.get(allocation.taskId);
    if (existing) existing.push(allocation);
    else index.set(allocation.taskId, [allocation]);
  }
  return index;
}

export function allocatedHoursByDate(allocations: Allocation[]) {
  const index = new Map<string, number>();
  for (const allocation of allocations)
    index.set(allocation.date, (index.get(allocation.date) || 0) + allocation.allocatedHours);
  return index;
}

export function getRemainingCapacity(
  date: string,
  allocations: Allocation[],
  excludeTaskId?: string,
) {
  return DEFAULT_DAILY_CAPACITY_HOURS - getDailyAllocatedHours(date, allocations, excludeTaskId);
}

export function datesBetween(start: string, end: string) {
  const first = new Date(`${start}T00:00:00Z`).getTime();
  const last = new Date(`${end}T00:00:00Z`).getTime();
  if (last < first) return [];
  return Array.from({ length: Math.floor((last - first) / DAY_MS) + 1 }, (_, index) =>
    addDays(start, index),
  );
}

export function daysBetween(start: string, end: string) {
  const first = new Date(`${start}T00:00:00Z`).getTime();
  const last = new Date(`${end}T00:00:00Z`).getTime();
  return Math.round((last - first) / DAY_MS);
}

export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

function forwardDates(start: string, count: number) {
  return Array.from({ length: Math.max(1, count) }, (_, index) => addDays(start, index));
}

function createAllocation(taskId: string, date: string, hours: number): Allocation {
  return { id: crypto.randomUUID(), taskId, date, allocatedHours: hours };
}

/**
 * Explicitly rebuilds one Task's Allocation from its start date. Existing records
 * for the Task are intentionally discarded; daily edits are the current result,
 * not a second source of scheduling policy.
 */
export function recalculateAutomaticAllocations(
  task: Task,
  allocations: Allocation[],
  startDate = today(),
  options: RecalculateOptions = {},
): AllocationResult {
  const horizonDays = options.horizonDays ?? DEFAULT_PLANNING_HORIZON_DAYS;
  const otherAllocations = allocations.filter(item => item.taskId !== task.id);
  const otherAllocatedByDate = allocatedHoursByDate(otherAllocations);
  const anchor = task.start || startDate;
  const searchDates = forwardDates(anchor, horizonDays);
  const result: Allocation[] = [];
  let remaining = Math.max(0, task.estimatedHours);

  for (const date of searchDates) {
    if (remaining <= 0) break;
    const available = DEFAULT_DAILY_CAPACITY_HOURS - (otherAllocatedByDate.get(date) || 0);
    if (available <= 0) continue;
    const hours = Math.min(remaining, available);
    result.push(createAllocation(task.id, date, hours));
    remaining -= hours;
  }

  return { allocations: result };
}

export function recalculateTaskSchedule(
  task: Task,
  allocations: Allocation[],
  startDate = today(),
  options: RecalculateOptions = {},
): ScheduleResult {
  const scheduledTask: Task = {
    ...task,
    start: task.start || startDate,
    status:
      task.status === 'completed' || task.status === 'in_progress' ? task.status : 'scheduled',
  };
  const result = recalculateAutomaticAllocations(scheduledTask, allocations, startDate, options);
  return { task: scheduledTask, allocations: result.allocations };
}

/** Places a Task at an explicit date and runs the shared fastest scheduling command. */
export function scheduleTaskAt(
  task: Task,
  allocations: Allocation[],
  date: string,
  options: RecalculateOptions = {},
): ScheduleResult {
  return recalculateTaskSchedule({ ...task, start: date }, allocations, date, options);
}

/** Clears a Task's current Allocation while preserving its card metadata. */
export function returnTaskToBacklog(task: Task): ScheduleResult {
  return {
    task: { ...task, status: 'backlog' },
    allocations: [],
  };
}

/** Directly changes one date; no other date is rebalanced. */
export function adjustAllocationDay(
  task: Task,
  allocations: Allocation[],
  date: string,
  delta: number,
): AllocationResult {
  if (!delta) return { allocations: allocations.map(item => ({ ...item })) };
  const next = allocations.map(item => ({ ...item }));
  const current = next.find(item => item.taskId === task.id && item.date === date);
  if (current) current.allocatedHours = Math.max(0, current.allocatedHours + delta);
  else if (delta > 0) next.push(createAllocation(task.id, date, delta));
  return { allocations: next };
}
