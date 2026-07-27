import type { Allocation, DailyCapacity, Task, WorkspaceData } from './types';

const DAY_MS = 86400000;
export const DEFAULT_PLANNING_HORIZON_DAYS = 180;
export const DEFAULT_DAILY_CAPACITY_HOURS = 8;

export interface AllocationResult {
  allocations: Allocation[];
  start: string | null;
  end: string | null;
}

export interface ScheduleResult {
  task: Task;
  allocations: Allocation[];
}

export interface AllocationValidation {
  valid: boolean;
  message?: string;
}

export interface RecalculateOptions {
  fillPending?: boolean;
  horizonDays?: number;
  /**
   * Pre-built `capacityAvailableByDate` result. `recalculateWorkspace` builds this
   * once and threads it through every task's recalculation instead of each one
   * re-scanning the same `dailyCapacities` array per candidate date; callers that
   * don't pass one get it built for them.
   */
  capacityIndex?: Map<string, number>;
}

export function capacityAvailableHours(totalCapacityHours: number, unavailableHours: number) {
  return Math.max(0, totalCapacityHours - unavailableHours);
}

export function normalizeCapacity(capacity: DailyCapacity): DailyCapacity {
  return {
    ...capacity,
    availableHours: capacityAvailableHours(capacity.totalCapacityHours, capacity.unavailableHours),
  };
}

export function getProjectEstimatedHours(project: { tasks: Task[] }) {
  return project.tasks.reduce((sum, task) => sum + Math.max(0, task.estimatedHours), 0);
}

export function isTaskOverdue(task: Task) {
  return Boolean(task.deadline && task.end && task.end > task.deadline);
}

export function getTaskAllocatedHours(
  taskId: string,
  allocations: Allocation[],
  source?: Allocation['source'],
) {
  return allocations
    .filter(allocation => allocation.taskId === taskId && (!source || allocation.source === source))
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

export function defaultDailyCapacity(
  date: string,
  fallbackHours = DEFAULT_DAILY_CAPACITY_HOURS,
): DailyCapacity {
  return {
    date,
    totalCapacityHours: fallbackHours,
    unavailableHours: 0,
    availableHours: fallbackHours,
  };
}

export function getDailyCapacity(
  date: string,
  capacities: DailyCapacity[],
  fallbackHours = DEFAULT_DAILY_CAPACITY_HOURS,
) {
  const existing = capacities.find(capacity => capacity.date === date);
  return existing ? normalizeCapacity(existing) : defaultDailyCapacity(date, fallbackHours);
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

export function capacityAvailableByDate(capacities: DailyCapacity[]) {
  const index = new Map<string, number>();
  for (const capacity of capacities)
    index.set(
      capacity.date,
      capacityAvailableHours(capacity.totalCapacityHours, capacity.unavailableHours),
    );
  return index;
}

export function getRemainingCapacity(
  date: string,
  capacities: DailyCapacity[],
  allocations: Allocation[],
  excludeTaskId?: string,
) {
  const capacity = getDailyCapacity(date, capacities);
  return capacity.availableHours - getDailyAllocatedHours(date, allocations, excludeTaskId);
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

function taskPositiveDates(taskId: string, allocations: Allocation[]) {
  return allocations
    .filter(item => item.taskId === taskId && item.allocatedHours > 0)
    .map(item => item.date)
    .sort();
}

function derivedRange(
  taskId: string,
  allocations: Allocation[],
): Pick<AllocationResult, 'start' | 'end'> {
  const dates = taskPositiveDates(taskId, allocations);
  return { start: dates[0] || null, end: dates.at(-1) || null };
}

function resultRange(
  task: Task,
  allocations: Allocation[],
): Pick<AllocationResult, 'start' | 'end'> {
  const derived = derivedRange(task.id, allocations);
  if (task.allocationStrategy !== 'balanced' || (!task.start && !task.end)) return derived;
  const dates = taskPositiveDates(task.id, allocations);
  const starts = [task.start, ...dates].filter((date): date is string => Boolean(date)).sort();
  const ends = [task.end, ...dates].filter((date): date is string => Boolean(date)).sort();
  return { start: starts[0] || null, end: ends.at(-1) || null };
}

export function validateTaskDateRange(task: Task, allocations: Allocation[]): AllocationValidation {
  const manual = allocations.filter(
    allocation => allocation.taskId === task.id && allocation.source === 'manual',
  );
  if (!manual.length) return { valid: true };
  const outside = manual.find(
    allocation =>
      (task.start && allocation.date < task.start) || (task.end && allocation.date > task.end),
  );
  return outside
    ? { valid: false, message: `日期範圍不可排除人工分配日期 ${outside.date}。` }
    : { valid: true };
}

function createAutomaticAllocation(taskId: string, date: string, hours: number): Allocation {
  return {
    id: crypto.randomUUID(),
    taskId,
    date,
    allocatedHours: hours,
    source: 'automatic',
    locked: false,
  };
}

function forwardDates(start: string, count: number) {
  return Array.from({ length: Math.max(1, count) }, (_, index) => addDays(start, index));
}

function mergeAutomaticHours(
  allocations: Allocation[],
  taskId: string,
  date: string,
  hours: number,
) {
  if (hours <= 0) return;
  const existing = allocations.find(
    item => item.taskId === taskId && item.date === date && item.source === 'automatic',
  );
  if (existing) {
    existing.allocatedHours += hours;
    return;
  }
  allocations.push(createAutomaticAllocation(taskId, date, hours));
}

function removeAutomaticHours(allocations: Allocation[], taskId: string, hours: number) {
  let remaining = hours;
  const automatic = allocations
    .filter(item => item.taskId === taskId && item.source === 'automatic')
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const allocation of automatic) {
    if (remaining <= 0) break;
    const removed = Math.min(remaining, allocation.allocatedHours);
    allocation.allocatedHours -= removed;
    remaining -= removed;
  }
  return allocations.filter(item => item.allocatedHours > 0 || item.source === 'manual');
}

function automaticBaseDate(taskId: string, allocations: Allocation[], startDate: string) {
  const automaticDates = allocations
    .filter(item => item.taskId === taskId && item.source === 'automatic')
    .map(item => item.date)
    .sort();
  return automaticDates.at(-1) || taskPositiveDates(taskId, allocations).at(-1) || startDate;
}

function automaticTailDate(
  taskId: string,
  allocations: Allocation[],
  capacities: DailyCapacity[],
  manualDates: Set<string>,
  startDate: string,
  horizonDays: number,
) {
  const base = automaticBaseDate(taskId, allocations, startDate);
  const search = forwardDates(base, horizonDays);
  return (
    search.find(
      date => !manualDates.has(date) && getRemainingCapacity(date, capacities, allocations) > 0,
    ) ||
    search.find(date => !manualDates.has(date)) ||
    base
  );
}

function appendAutomaticHours(
  taskId: string,
  allocations: Allocation[],
  capacities: DailyCapacity[],
  manualDates: Set<string>,
  startDate: string,
  hours: number,
  horizonDays: number,
) {
  let remaining = hours;
  const base = automaticBaseDate(taskId, allocations, startDate);
  for (const date of forwardDates(base, horizonDays)) {
    if (remaining <= 0) break;
    if (manualDates.has(date)) continue;
    // `allocations` is mutated by mergeAutomaticHours below, so read it live each day.
    const available = getRemainingCapacity(date, capacities, allocations);
    if (available <= 0) continue;
    const hoursForDate = Math.min(remaining, available);
    mergeAutomaticHours(allocations, taskId, date, hoursForDate);
    remaining -= hoursForDate;
  }
  if (remaining > 0) {
    const overflow = automaticTailDate(
      taskId,
      allocations,
      capacities,
      manualDates,
      startDate,
      horizonDays,
    );
    mergeAutomaticHours(allocations, taskId, overflow, remaining);
  }
}

function recalculateBalancedAllocations(
  task: Task,
  allocations: Allocation[],
  capacityIndex: Map<string, number>,
  automaticHours: number,
  manualDates: Set<string>,
  manualHoursByDate: Map<string, number>,
  horizonDays: number,
): Allocation[] {
  const otherAllocations = allocations.filter(item => item.taskId !== task.id);
  // `otherAllocations` never changes during this pass — mergeAutomaticHours below
  // only appends to `result`, the task's own emerging list — so a snapshot index
  // built once here stays accurate for every candidate date.
  const otherAllocatedIndex = allocatedHoursByDate(otherAllocations);
  const range =
    task.start && task.end
      ? datesBetween(task.start, task.end)
      : forwardDates(task.start || today(), horizonDays);
  const candidates = range
    .filter(date => !manualDates.has(date))
    .map(date => ({
      date,
      available: Math.max(
        0,
        (capacityIndex.get(date) ?? DEFAULT_DAILY_CAPACITY_HOURS) -
          (otherAllocatedIndex.get(date) || 0) -
          (manualHoursByDate.get(date) || 0),
      ),
    }));
  const result = allocations
    .filter(item => item.taskId === task.id && item.source === 'manual')
    .map(item => ({ ...item }));
  let remaining = automaticHours;
  let active = candidates.filter(item => item.available > 0);
  while (remaining > 0 && active.length) {
    const share = remaining / active.length;
    let allocatedThisRound = 0;
    const nextActive = [];
    for (const candidate of active) {
      const hours = Math.min(share, candidate.available);
      if (hours > 0) {
        mergeAutomaticHours(result, task.id, candidate.date, hours);
        candidate.available -= hours;
        remaining -= hours;
        allocatedThisRound += hours;
      }
      if (candidate.available > 0.000001) nextActive.push(candidate);
    }
    if (allocatedThisRound <= 0) break;
    active = nextActive;
  }
  if (remaining > 0) {
    const overflow = candidates.at(-1)?.date || task.end || task.start || today();
    mergeAutomaticHours(result, task.id, overflow, remaining);
  }
  return result;
}

export function recalculateAutomaticAllocations(
  task: Task,
  allocations: Allocation[],
  capacities: DailyCapacity[],
  startDate = today(),
  options: RecalculateOptions = {},
): AllocationResult {
  const fillPending = options.fillPending ?? true;
  const horizonDays = options.horizonDays ?? DEFAULT_PLANNING_HORIZON_DAYS;
  const capacityIndex = options.capacityIndex ?? capacityAvailableByDate(capacities);
  const taskAllocations = allocations.filter(allocation => allocation.taskId === task.id);
  const validation = validateTaskDateRange(task, allocations);
  if (!validation.valid) throw new Error(validation.message);
  const manual = taskAllocations.filter(allocation => allocation.source === 'manual');
  const manualDates = new Set(manual.map(item => item.date));
  const manualHours = getTaskAllocatedHours(task.id, manual);
  const existingAutomaticHours = taskAllocations
    .filter(item => item.source === 'automatic' && !manualDates.has(item.date))
    .reduce((sum, item) => sum + item.allocatedHours, 0);
  const automaticHours = fillPending
    ? Math.max(0, task.estimatedHours - manualHours)
    : existingAutomaticHours;
  const manualHoursByDate = new Map<string, number>();
  for (const allocation of manual)
    manualHoursByDate.set(
      allocation.date,
      (manualHoursByDate.get(allocation.date) || 0) + allocation.allocatedHours,
    );
  if (task.allocationStrategy === 'balanced' && (task.start || task.end)) {
    const balancedAllocations = recalculateBalancedAllocations(
      task,
      allocations,
      capacityIndex,
      automaticHours,
      manualDates,
      manualHoursByDate,
      horizonDays,
    );
    return { allocations: balancedAllocations, ...resultRange(task, balancedAllocations) };
  }
  const otherAllocations = allocations.filter(item => item.taskId !== task.id);
  // Snapshot once — see the identical note in recalculateBalancedAllocations.
  const otherAllocatedIndex = allocatedHoursByDate(otherAllocations);
  const anchor = [...manualDates].sort()[0] || task.start || startDate;
  const resultAllocations = [...manual];
  const searchEnd = Math.max(
    horizonDays,
    taskPositiveDates(task.id, allocations).length
      ? daysBetween(anchor, taskPositiveDates(task.id, allocations).at(-1)!) + 1
      : 0,
  );
  const searchDates = forwardDates(anchor, searchEnd);
  let remaining = automaticHours;
  for (const date of searchDates) {
    if (remaining <= 0) break;
    if (manualDates.has(date)) continue;
    const available =
      (capacityIndex.get(date) ?? DEFAULT_DAILY_CAPACITY_HOURS) -
      (otherAllocatedIndex.get(date) || 0);
    if (available <= 0) continue;
    const hours = Math.min(remaining, available);
    resultAllocations.push(createAutomaticAllocation(task.id, date, hours));
    remaining -= hours;
  }
  if (remaining > 0) {
    const overflowCandidates = searchDates.filter(date => !manualDates.has(date));
    const overflow = overflowCandidates.at(-1) || anchor;
    mergeAutomaticHours(resultAllocations, task.id, overflow, remaining);
  }
  return { allocations: resultAllocations, ...resultRange(task, resultAllocations) };
}

/**
 * Recalculates automatic allocations for `task` and folds the result back into the
 * Task shape (`start`/`end`), so callers stop hand-assembling that pair themselves.
 * Strategy and range are taken from `task` as given — this is the shared base that
 * `scheduleTaskAt` and `setTaskDateRange` build on.
 */
export function recalculateTaskSchedule(
  task: Task,
  allocations: Allocation[],
  capacities: DailyCapacity[],
  startDate = today(),
  options: RecalculateOptions = {},
): ScheduleResult {
  const result = recalculateAutomaticAllocations(task, allocations, capacities, startDate, options);
  return {
    task: { ...task, start: result.start, end: result.end },
    allocations: result.allocations,
  };
}

/** Anchors `task` at `date` and schedules it with the `fastest` strategy. */
export function scheduleTaskAt(
  task: Task,
  allocations: Allocation[],
  capacities: DailyCapacity[],
  date: string,
  options: RecalculateOptions = {},
): ScheduleResult {
  return recalculateTaskSchedule(
    { ...task, start: date, end: null, allocationStrategy: 'fastest' },
    allocations,
    capacities,
    date,
    options,
  );
}

/** Sets `task`'s explicit date range and schedules it with the `balanced` strategy. */
export function setTaskDateRange(
  task: Task,
  allocations: Allocation[],
  capacities: DailyCapacity[],
  start: string | null,
  end: string | null,
  options: RecalculateOptions = {},
): ScheduleResult {
  return recalculateTaskSchedule(
    { ...task, start, end, allocationStrategy: 'balanced' },
    allocations,
    capacities,
    start || task.start || today(),
    options,
  );
}

/** Clears `task`'s dates and all of its Allocations, per the Gantt-to-Backlog rule. */
export function returnTaskToBacklog(task: Task): ScheduleResult {
  return {
    task: { ...task, status: 'backlog', start: null, end: null, allocationStrategy: 'fastest' },
    allocations: [],
  };
}

export function adjustManualAllocationDay(
  task: Task,
  allocations: Allocation[],
  capacities: DailyCapacity[],
  date: string,
  delta: number,
  startDate = today(),
  options: RecalculateOptions = {},
): AllocationResult {
  if (!delta) return { allocations, ...resultRange(task, allocations) };
  const taskAllocations = allocations.filter(item => item.taskId === task.id);
  const currentDayHours = getDailyAllocatedHours(date, taskAllocations);
  const actualDelta = Math.max(0, currentDayHours + delta) - currentDayHours;
  const currentTotal = getTaskAllocatedHours(task.id, allocations);
  const pending = task.estimatedHours - currentTotal;
  const next = allocations.filter(item => !(item.taskId === task.id && item.date === date));
  const manualDates = new Set(
    taskAllocations.filter(item => item.source === 'manual').map(item => item.date),
  );
  manualDates.add(date);
  next.push({
    id:
      taskAllocations.find(
        item => item.taskId === task.id && item.date === date && item.source === 'manual',
      )?.id || crypto.randomUUID(),
    taskId: task.id,
    date,
    allocatedHours: Math.max(0, currentDayHours + delta),
    source: 'manual',
    locked: true,
  });

  if (!actualDelta) return { allocations: next, ...resultRange(task, next) };

  if (actualDelta > 0) {
    const borrow =
      pending > 0 ? Math.max(0, actualDelta - pending) : pending === 0 ? actualDelta : 0;
    const adjusted = removeAutomaticHours(next, task.id, borrow);
    return { allocations: adjusted, ...resultRange(task, adjusted) };
  }

  if (pending < 0) {
    return { allocations: next, ...resultRange(task, next) };
  }

  appendAutomaticHours(
    task.id,
    next,
    capacities,
    manualDates,
    task.start || startDate,
    -actualDelta,
    options.horizonDays ?? DEFAULT_PLANNING_HORIZON_DAYS,
  );
  return { allocations: next, ...resultRange(task, next) };
}

export function trimManualAllocationsToEstimate(
  taskId: string,
  allocations: Allocation[],
  estimatedHours: number,
) {
  const manualHours = getTaskAllocatedHours(taskId, allocations, 'manual');
  let excess = Math.max(0, manualHours - estimatedHours);
  if (!excess) return allocations;
  const next = allocations.map(item => ({ ...item }));
  const manual = next
    .filter(item => item.taskId === taskId && item.source === 'manual')
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const allocation of manual) {
    if (excess <= 0) break;
    const reduced = Math.min(excess, allocation.allocatedHours);
    allocation.allocatedHours -= reduced;
    excess -= reduced;
  }
  return next;
}

export function recalculateWorkspace(data: WorkspaceData): WorkspaceData {
  let allocations = [...data.allocations];
  const projects = data.projects.map(project => ({
    ...project,
    tasks: project.tasks.map(task => ({ ...task })),
  }));
  // dailyCapacities is the same for every task in this pass, so build the lookup once
  // instead of every task's recalculation re-scanning it per candidate date.
  const capacityIndex = capacityAvailableByDate(data.dailyCapacities);
  for (const project of projects) {
    for (const task of project.tasks) {
      if (
        !allocations.some(
          allocation => allocation.taskId === task.id && allocation.source === 'automatic',
        )
      )
        continue;
      const result = recalculateTaskSchedule(task, allocations, data.dailyCapacities, today(), {
        fillPending: false,
        capacityIndex,
      });
      allocations = [
        ...allocations.filter(allocation => allocation.taskId !== task.id),
        ...result.allocations,
      ];
      task.start = result.task.start;
      task.end = result.task.end;
      if (task.status === 'backlog') task.status = 'scheduled';
      task.updatedAt = new Date().toISOString();
    }
  }
  return { ...data, projects, allocations };
}
