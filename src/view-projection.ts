import { allocatedHoursByDate, DEFAULT_DAILY_CAPACITY_HOURS, isTaskOverdue } from './capacity';
import { aggregateTaskEstimate } from './workspace-estimates';
import {
  buildTimelineContext,
  buildTimelinePeriods,
  capacityState,
  periodAvailableHours,
  periodHours,
  timelineRange,
} from './timeline';
import type { CapacityState, TimelineContextCell, TimelinePeriod } from './timeline';
import { buildTaskTree } from './task-tree';
import type { Allocation, Project, Task, ViewMode } from './types';

export type DailyDistributionAllocationOrder = 'ascending' | 'descending';
export type HierarchyDepth = 1 | 2 | 3;

export type ViewProjectionChoices = Readonly<{
  referenceDate: string;
  timelineLevel: ViewMode;
  showCompleted: boolean;
  expanded: Readonly<{
    backlog: ReadonlySet<string>;
    timeline: ReadonlySet<string>;
  }>;
  dailyDistribution: Readonly<{
    allocationOrder: DailyDistributionAllocationOrder;
    hierarchyDepth: HierarchyDepth;
  }>;
}>;

export type ProjectedWorkItem = Readonly<{
  workItem: Task;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}>;

export type BacklogProjection = Readonly<{
  rows: readonly ProjectedWorkItem[];
  leafCount: number;
}>;

export type AllocationWindowPosition = 'none' | 'only' | 'start' | 'middle' | 'end';
export type AllocationReadOnlyReason = 'completed' | 'parent' | null;

export type TimelineAllocationCell = Readonly<{
  allocatedHours: number;
  recurring: boolean;
  window: AllocationWindowPosition;
}>;

export type TimelineWorkItemProjection = ProjectedWorkItem &
  Readonly<{
    allocations: readonly Allocation[];
    estimatedHours: number;
    allocatedHours: number;
    pendingHours: number;
    overdue: boolean;
    allocationReadOnlyReason: AllocationReadOnlyReason;
    cells: readonly TimelineAllocationCell[];
  }>;

export type TimelineCapacityPeriod = Readonly<{
  period: TimelinePeriod;
  allocatedHours: number;
  availableHours: number;
  remainingHours: number;
  state: CapacityState;
}>;

export type TimelineProjection = Readonly<{
  range: Readonly<{ start: string; end: string }>;
  periods: readonly TimelinePeriod[];
  context: readonly TimelineContextCell[];
  capacity: readonly TimelineCapacityPeriod[];
  rows: readonly TimelineWorkItemProjection[];
}>;

export type DailyDistributionSegment = Readonly<{
  workItem: Task;
  hours: number;
  startHour: number;
  visibleHours: number;
}>;

export type DailyDistributionDay = Readonly<{
  date: string;
  allocatedHours: number;
  remainingHours: number;
  overloaded: boolean;
  segments: readonly DailyDistributionSegment[];
}>;

export type DailyDistributionProjection = Readonly<{
  days: readonly DailyDistributionDay[];
}>;

export type ViewProjection = Readonly<{
  backlog: BacklogProjection;
  timeline: TimelineProjection;
  dailyDistribution: DailyDistributionProjection;
}>;

type AllocationWindow = { start: string; end: string } | null;

function projectedTaskIds(
  tasks: readonly Task[],
  includesLeaf: (task: Task) => boolean,
  tree: ReturnType<typeof buildTaskTree>,
) {
  const result = new Set<string>();
  for (const task of tasks) {
    if (tree.hasChildren(task.id) || !includesLeaf(task)) continue;
    let current: Task | undefined = task;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      result.add(current.id);
      const parentId = tree.parentId(current.id);
      current = parentId ? tree.task(parentId) : undefined;
    }
  }
  return result;
}

function projectedRows(
  includedIds: Set<string>,
  expandedIds: ReadonlySet<string>,
  tree: ReturnType<typeof buildTaskTree>,
): ProjectedWorkItem[] {
  const expanded = new Set(expandedIds);
  return tree.flattenIncluded(includedIds, expanded).map(workItem => ({
    workItem,
    depth: tree.depth(workItem.id),
    hasChildren: tree.hasChildren(workItem.id),
    expanded: expanded.has(workItem.id),
  }));
}

function rollupAllocations(
  allocations: readonly Allocation[],
  tree: ReturnType<typeof buildTaskTree>,
) {
  const index = new Map<string, Allocation[]>();
  for (const allocation of allocations) {
    let currentId: string | null = allocation.taskId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const items = index.get(currentId);
      if (items) items.push(allocation);
      else index.set(currentId, [allocation]);
      currentId = tree.parentId(currentId);
    }
  }
  return index;
}

function allocationWindow(allocations: readonly Allocation[]): AllocationWindow {
  const dates = allocations
    .filter(allocation => allocation.allocatedHours > 0)
    .map(allocation => allocation.date)
    .sort();
  return dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null;
}

function windowPosition(
  period: TimelinePeriod,
  window: AllocationWindow,
): AllocationWindowPosition {
  if (!window || period.start > window.end || period.end < window.start) return 'none';
  const starts = period.start <= window.start && period.end >= window.start;
  const ends = period.start <= window.end && period.end >= window.end;
  if (starts && ends) return 'only';
  if (starts) return 'start';
  if (ends) return 'end';
  return 'middle';
}

function distributionSourceTasks(
  tasks: readonly Task[],
  showCompleted: boolean,
  tree: ReturnType<typeof buildTaskTree>,
) {
  const sourceIds = projectedTaskIds(
    tasks,
    task => task.status !== 'backlog' && (showCompleted || task.status !== 'completed'),
    tree,
  );
  return tasks.filter(task => sourceIds.has(task.id));
}

function distributionTasksAtDepth(
  tasks: readonly Task[],
  tree: ReturnType<typeof buildTaskTree>,
  maxDepth: HierarchyDepth,
) {
  const displayedIds = new Set(tasks.map(task => task.id));
  const visit = (task: Task): Task[] => {
    const children = tree.children(task.id).filter(child => displayedIds.has(child.id));
    if (tree.depth(task.id) >= maxDepth || !children.length) return [task];
    return children.flatMap(visit);
  };
  return tasks
    .filter(task => {
      const parentId = tree.parentId(task.id);
      return !parentId || !displayedIds.has(parentId);
    })
    .flatMap(visit);
}

function buildDailyDistribution(
  dates: readonly string[],
  tasks: readonly Task[],
  hoursByTask: ReadonlyMap<string, ReadonlyMap<string, number>>,
  allocationOrder: DailyDistributionAllocationOrder,
): DailyDistributionProjection {
  return {
    days: dates.map(date => {
      let allocatedHours = 0;
      const segments: DailyDistributionSegment[] = [];
      const taskHours = tasks
        .map((workItem, index) => ({
          workItem,
          index,
          hours: hoursByTask.get(workItem.id)?.get(date) || 0,
        }))
        .filter(item => item.hours > 0)
        .sort((left, right) => {
          const difference =
            allocationOrder === 'descending' ? right.hours - left.hours : left.hours - right.hours;
          return difference || left.index - right.index;
        });
      for (const { workItem, hours } of taskHours) {
        const startHour = allocatedHours;
        allocatedHours += hours;
        const visibleStart = Math.min(DEFAULT_DAILY_CAPACITY_HOURS, startHour);
        const visibleEnd = Math.min(DEFAULT_DAILY_CAPACITY_HOURS, allocatedHours);
        if (visibleEnd > visibleStart) {
          segments.push({
            workItem,
            hours,
            startHour,
            visibleHours: visibleEnd - visibleStart,
          });
        }
      }
      return {
        date,
        allocatedHours,
        remainingHours: DEFAULT_DAILY_CAPACITY_HOURS - allocatedHours,
        overloaded: allocatedHours > DEFAULT_DAILY_CAPACITY_HOURS,
        segments,
      };
    }),
  };
}

export function buildViewProjection(
  project: Project,
  workspaceAllocations: readonly Allocation[],
  choices: ViewProjectionChoices,
): ViewProjection {
  const tree = buildTaskTree(project.tasks);
  const projectTaskIds = new Set(project.tasks.map(task => task.id));
  const projectAllocations = workspaceAllocations.filter(allocation =>
    projectTaskIds.has(allocation.taskId),
  );
  const rolledUpAllocations = rollupAllocations(projectAllocations, tree);

  const backlogIds = projectedTaskIds(project.tasks, task => task.status === 'backlog', tree);
  const timelineIds = projectedTaskIds(
    project.tasks,
    task => task.status !== 'backlog' && (choices.showCompleted || task.status !== 'completed'),
    tree,
  );
  const backlogRows = projectedRows(backlogIds, choices.expanded.backlog, tree);
  const timelineBaseRows = projectedRows(timelineIds, choices.expanded.timeline, tree);

  const range = timelineRange(
    timelineBaseRows.map(row => row.workItem),
    choices.timelineLevel,
    projectAllocations,
    choices.referenceDate,
  );
  const periods = buildTimelinePeriods(range.start, range.end, choices.timelineLevel);
  const context = buildTimelineContext(periods, choices.timelineLevel);
  const workspaceHoursByDate = allocatedHoursByDate([...workspaceAllocations]);
  const capacity = periods.map(period => {
    const allocatedHours = periodHours(period, workspaceHoursByDate);
    const availableHours = periodAvailableHours(period);
    return {
      period,
      allocatedHours,
      availableHours,
      remainingHours: availableHours - allocatedHours,
      state: capacityState(allocatedHours, availableHours),
    };
  });

  const timelineRows = timelineBaseRows.map(row => {
    const allocations = [...(rolledUpAllocations.get(row.workItem.id) || [])];
    const hoursByDate = allocatedHoursByDate(allocations);
    const recurringDates = new Set(
      allocations.filter(allocation => allocation.recurrenceId).map(allocation => allocation.date),
    );
    const window = allocationWindow(allocations);
    const estimatedHours = row.hasChildren
      ? aggregateTaskEstimate(row.workItem.id, project.tasks, tree)
      : row.workItem.estimatedHours;
    const allocatedHours = allocations.reduce((sum, item) => sum + item.allocatedHours, 0);
    return {
      ...row,
      allocations,
      estimatedHours,
      allocatedHours,
      pendingHours: estimatedHours - allocatedHours,
      overdue: isTaskOverdue(row.workItem, allocations),
      allocationReadOnlyReason:
        row.workItem.status === 'completed' ? 'completed' : row.hasChildren ? 'parent' : null,
      cells: periods.map(period => ({
        allocatedHours: periodHours(period, hoursByDate),
        recurring: period.dates.some(date => recurringDates.has(date)),
        window: windowPosition(period, window),
      })),
    } satisfies TimelineWorkItemProjection;
  });

  const distributionSource = distributionSourceTasks(project.tasks, choices.showCompleted, tree);
  const distributionTasks = distributionTasksAtDepth(
    distributionSource,
    tree,
    choices.dailyDistribution.hierarchyDepth,
  );
  const distributionHoursByTask = new Map<string, Map<string, number>>();
  for (const task of distributionTasks) {
    distributionHoursByTask.set(
      task.id,
      allocatedHoursByDate(rolledUpAllocations.get(task.id) || []),
    );
  }

  return {
    backlog: {
      rows: backlogRows,
      leafCount: project.tasks.filter(
        task => !tree.hasChildren(task.id) && task.status === 'backlog',
      ).length,
    },
    timeline: { range, periods, context, capacity, rows: timelineRows },
    dailyDistribution: buildDailyDistribution(
      periods.flatMap(period => period.dates),
      distributionTasks,
      distributionHoursByTask,
      choices.dailyDistribution.allocationOrder,
    ),
  };
}
