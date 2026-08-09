import { allocatedHoursByDate, DEFAULT_DAILY_CAPACITY_HOURS } from './capacity';
import type { TimelinePeriod } from './timeline';
import type { Allocation, Task } from './types';
import type { TaskTreeIndex } from './task-tree';

export type DailyDistributionAllocationOrder = 'ascending' | 'descending';

export type DailyDistributionSegment = {
  task: Task;
  hours: number;
  startHour: number;
  visibleHours: number;
};

export type DailyDistributionRow = {
  date: string;
  allocated: number;
  segments: DailyDistributionSegment[];
};

export type TimelineReadModel = {
  capacityAllocatedByDate: Map<string, number>;
  taskAllocations: Map<string, Allocation[]>;
  allocatedByTask: Map<string, number>;
  hoursByTask: Map<string, Map<string, number>>;
  dailyDistributionTasks: Task[];
  dailyDistributionHoursByTask: Map<string, Map<string, number>>;
  dailyDistributionDates: string[];
};

export type TimelineReadModelInput = {
  tasks: Task[];
  allTasks: Task[];
  taskTree: TaskTreeIndex;
  allocations: Allocation[];
  allAllocations: Allocation[];
  periods: TimelinePeriod[];
};

type DailyDistributionRowsInput = {
  dates: string[];
  tasks: Task[];
  taskTree: TaskTreeIndex;
  hoursByTask: Map<string, Map<string, number>>;
  allocationOrder: DailyDistributionAllocationOrder;
  hierarchyDepth: number;
};

function allocationRollup(allocations: Allocation[], taskTree: TaskTreeIndex) {
  const index = new Map<string, Allocation[]>();
  for (const allocation of allocations) {
    let currentId: string | null = allocation.taskId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const items = index.get(currentId);
      if (items) items.push(allocation);
      else index.set(currentId, [allocation]);
      currentId = taskTree.parentId(currentId);
    }
  }
  return index;
}

function distributionSourceTasks(tasks: Task[], allTasks: Task[], taskTree: TaskTreeIndex) {
  const completedVisible = tasks.some(task => task.status === 'completed');
  const sourceIds = new Set<string>();
  for (const task of allTasks) {
    if (
      taskTree.hasChildren(task.id) ||
      task.status === 'backlog' ||
      (task.status === 'completed' && !completedVisible)
    )
      continue;
    let current: Task | undefined = task;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      sourceIds.add(current.id);
      const parentId = taskTree.parentId(current.id);
      current = parentId ? taskTree.task(parentId) : undefined;
    }
  }
  return allTasks.filter(task => sourceIds.has(task.id));
}

function distributionTasksAtDepth(tasks: Task[], taskTree: TaskTreeIndex, maxDepth: number) {
  const displayedIds = new Set(tasks.map(task => task.id));
  const visit = (task: Task): Task[] => {
    const children = taskTree.children(task.id).filter(child => displayedIds.has(child.id));
    if (taskTree.depth(task.id) >= maxDepth || !children.length) return [task];
    return children.flatMap(visit);
  };
  return tasks
    .filter(task => {
      const parentId = taskTree.parentId(task.id);
      return !parentId || !displayedIds.has(parentId);
    })
    .flatMap(visit);
}

export function buildDailyDistributionRows({
  dates,
  tasks,
  taskTree,
  hoursByTask,
  allocationOrder,
  hierarchyDepth,
}: DailyDistributionRowsInput): DailyDistributionRow[] {
  const displayTasks = distributionTasksAtDepth(tasks, taskTree, hierarchyDepth);
  return dates.map(date => {
    let allocated = 0;
    const segments: DailyDistributionSegment[] = [];
    const taskHours = displayTasks
      .map((task, index) => ({ task, index, hours: hoursByTask.get(task.id)?.get(date) || 0 }))
      .filter(item => item.hours > 0)
      .sort((left, right) => {
        const difference =
          allocationOrder === 'descending' ? right.hours - left.hours : left.hours - right.hours;
        return difference || left.index - right.index;
      });
    for (const { task, hours } of taskHours) {
      const startHour = allocated;
      allocated += hours;
      const visibleStart = Math.min(DEFAULT_DAILY_CAPACITY_HOURS, startHour);
      const visibleEnd = Math.min(DEFAULT_DAILY_CAPACITY_HOURS, allocated);
      if (visibleEnd > visibleStart)
        segments.push({
          task,
          hours,
          startHour,
          visibleHours: visibleEnd - visibleStart,
        });
    }
    return { date, allocated, segments };
  });
}

export function buildTimelineReadModel({
  tasks,
  allTasks,
  taskTree,
  allocations,
  allAllocations,
  periods,
}: TimelineReadModelInput): TimelineReadModel {
  const capacityAllocatedByDate = allocatedHoursByDate(allAllocations);
  const rolledUpAllocations = allocationRollup(allocations, taskTree);
  const taskAllocations = new Map<string, Allocation[]>();
  for (const task of tasks)
    taskAllocations.set(task.id, [...(rolledUpAllocations.get(task.id) || [])]);

  const allocatedByTask = new Map<string, number>();
  const hoursByTask = new Map<string, Map<string, number>>();
  for (const [taskId, items] of taskAllocations) {
    allocatedByTask.set(
      taskId,
      items.reduce((sum, item) => sum + item.allocatedHours, 0),
    );
    hoursByTask.set(taskId, allocatedHoursByDate(items));
  }

  const dailyDistributionTasks = distributionSourceTasks(tasks, allTasks, taskTree);
  const dailyDistributionHoursByTask = new Map<string, Map<string, number>>();
  for (const task of dailyDistributionTasks)
    dailyDistributionHoursByTask.set(
      task.id,
      allocatedHoursByDate(rolledUpAllocations.get(task.id) || []),
    );

  return {
    capacityAllocatedByDate,
    taskAllocations,
    allocatedByTask,
    hoursByTask,
    dailyDistributionTasks,
    dailyDistributionHoursByTask,
    dailyDistributionDates: periods.flatMap(period => period.dates),
  };
}
