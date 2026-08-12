import { recurrenceDates, recurrenceRuleError } from './recurrence';
import type { Allocation, Task } from './types';

export type RecurringAllocationMode = 'fill' | 'replace';

export type RecurringAllocationPlan =
  { task: Task; allocations: Allocation[] } | { error: string } | null;

function allocationHours(allocations: readonly Allocation[]) {
  return allocations.reduce((sum, allocation) => sum + allocation.allocatedHours, 0);
}

function createAllocation(taskId: string, date: string, allocatedHours: number): Allocation {
  return {
    id: crypto.randomUUID(),
    taskId,
    date,
    allocatedHours,
    recurrenceId: taskId,
  };
}

function currentRuleDates(task: Task): { dates: string[] } | { error: string } {
  if (!task.recurrence) return { error: 'Task 沒有重複排程規則。' };
  const error = recurrenceRuleError(task.recurrence);
  if (error) return { error };
  try {
    const dates = recurrenceDates(task.recurrence);
    return dates.length ? { dates } : { error: '重複排程範圍內沒有符合的日期。' };
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : '重複排程日期無效。' };
  }
}

/**
 * Computes the effective estimate for a recurring Task.
 *
 * Existing Allocation on a recurrence date counts once, even when it is a
 * manual override or only a partial amount. Missing recurrence dates still
 * contribute their rule hours until the user fills them. Manual allocations
 * outside the rule are counted as additional planned work.
 */
export function getRecurringEstimatedHours(task: Task, allocations: readonly Allocation[]) {
  if (!task.recurrence || recurrenceRuleError(task.recurrence)) return task.estimatedHours;
  const dates = recurrenceDates(task.recurrence);
  const taskAllocations = allocations.filter(allocation => allocation.taskId === task.id);
  const occupiedDates = new Set(taskAllocations.map(allocation => allocation.date));
  const missingRuleHours =
    dates.filter(date => !occupiedDates.has(date)).length * task.recurrence.hoursPerOccurrence;
  return allocationHours(taskAllocations) + missingRuleHours;
}

/**
 * Fills missing recurring dates without touching existing Allocation.
 * Generated records outside the current rule are removed, while manual
 * records outside the rule remain explicit user work.
 */
export function planRecurringAllocations(
  task: Task,
  allocations: Allocation[],
  mode: RecurringAllocationMode = 'fill',
): RecurringAllocationPlan {
  if (!task.recurrence) return null;
  const rule = currentRuleDates(task);
  if ('error' in rule) return rule;
  const ruleDates = new Set(rule.dates);
  const taskAllocations = allocations.filter(allocation => allocation.taskId === task.id);
  const preserved =
    mode === 'replace'
      ? []
      : taskAllocations.filter(
          allocation => allocation.recurrenceId !== task.id || ruleDates.has(allocation.date),
        );
  const occupiedDates = new Set(preserved.map(allocation => allocation.date));
  const generated = rule.dates
    .filter(date => !occupiedDates.has(date))
    .map(date => createAllocation(task.id, date, task.recurrence!.hoursPerOccurrence));
  const nextAllocations = [...preserved, ...generated];
  const nextTask: Task = {
    ...task,
    status: task.status === 'backlog' ? 'scheduled' : task.status,
    estimatedHours: getRecurringEstimatedHours(task, nextAllocations),
    start: rule.dates[0],
    end: rule.dates.at(-1)!,
    updatedAt: new Date().toISOString(),
  };
  return { task: nextTask, allocations: nextAllocations };
}
