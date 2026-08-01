import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { allocatedHoursByDate, isTaskOverdue, scheduleTaskAt, today } from './capacity';
import { hoursLabel } from './formatters';
import { aggregateTaskAllocations, aggregateTaskEstimate } from './data';
import TaskCard from './TaskCard';
import { pointerLeftElement, taskRowDropRelation } from './task-drag';
import type { TaskDragState, TaskDropTargetHandler } from './task-drag';
import type { Allocation, Task, ViewMode } from './types';
import type { TaskTreeIndex } from './task-tree';
import {
  buildTimelineContext,
  buildTimelinePeriods,
  capacityState,
  periodAvailableHours,
  periodCapacityLabel,
  periodDensity,
  periodDisplayLabel,
  periodHours,
  timelineDateAtPosition,
  timelinePositionForDate,
  timelineRange,
  timelineScale,
  dropPreviewGeometry,
  TIMELINE_CAPACITY_ROW_HEIGHT,
  TIMELINE_CONTEXT_ROW_HEIGHT,
  DROP_PREVIEW_TOP,
  TIMELINE_TASK_ROW_HEIGHT,
  TIMELINE_MOUSE_WHEEL_ZOOM_SENSITIVITY,
  TIMELINE_TRACKPAD_ZOOM_SENSITIVITY,
  weekendClass,
  zoomTimelineByWheelDelta,
} from './timeline';
import type {
  TimelineContextCell,
  TimelineInputMode,
  TimelinePeriod,
  TimelineZoom,
} from './timeline';

type PanState = { startX: number; startScrollLeft: number; candidate: boolean; active: boolean };

export type CapacityGanttProps = {
  projectId: string;
  tasks: Task[];
  allTasks: Task[];
  taskTree: TaskTreeIndex;
  expandedTaskIds: Set<string>;
  backlogTasks: Task[];
  allocations: Allocation[];
  allAllocations: Allocation[];
  timelineZoom: TimelineZoom;
  timelineInputMode: TimelineInputMode;
  autoScheduleEnabled: boolean;
  allocationStep: number;
  scrollLeft: number;
  taskDrag: TaskDragState | null;
  onZoomChange: (next: TimelineZoom) => void;
  onEdit: (task: Task) => void;
  onAddTask: () => void;
  onBeginTaskDrag: (
    task: Task,
    event: PointerEvent<HTMLElement>,
    allocatedHours: number,
    pendingHours: number,
    isGroup?: boolean,
  ) => void;
  onTaskDropTarget: TaskDropTargetHandler;
  onAdjustAllocation: (taskId: string, date: string, delta: number) => void;
  onDelete: (taskId: string) => void;
  onAddChild: (task: Task) => void;
  onToggleTask: (taskId: string) => void;
  onTimelineScroll: (left: number) => void;
};

type TimelineContextProps = { cells: TimelineContextCell[]; scale: number };

function TimelineContext({ cells, scale }: TimelineContextProps) {
  return (
    <div className="timeline-context-row" style={{ height: TIMELINE_CONTEXT_ROW_HEIGHT }}>
      {cells.map(cell => {
        const label = cell.yearStart
          ? `${cell.year} 年`
          : cell.monthStart
            ? `${cell.month} 月`
            : '';
        const className = [
          'timeline-context-cell',
          cell.yearStart ? 'year-start' : '',
          cell.monthStart ? 'month-start' : '',
          cell.weekStart ? 'week-start' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <span
            className={className}
            key={cell.key}
            style={{ left: cell.index * scale, width: scale }}
          >
            <b>{label}</b>
          </span>
        );
      })}
    </div>
  );
}

type CapacityPeriodsProps = {
  periods: TimelinePeriod[];
  allocatedByDate: Map<string, number>;
  view: ViewMode;
  scale: number;
};

function CapacityPeriods({ periods, allocatedByDate, view, scale }: CapacityPeriodsProps) {
  const density = periodDensity(scale);
  return (
    <>
      {periods.map((period, index) => {
        const allocated = periodHours(period, allocatedByDate);
        const available = periodAvailableHours(period);
        const remaining = Math.max(0, available - allocated);
        const weekend = weekendClass(period.start, view);
        const className = ['capacity-period', capacityState(allocated, available), density, weekend]
          .filter(Boolean)
          .join(' ');
        const weekendLabel = weekend ? ' · 週末' : '';
        const title = `${period.label}${weekendLabel} · ${period.dates.length} 天總容量 ${hoursLabel(available)} · 已分配 ${hoursLabel(allocated)} · 剩餘 ${hoursLabel(Math.max(0, available - allocated))}`;
        return (
          <span
            className={className}
            key={period.start}
            title={title}
            aria-label={`${period.label}${weekendLabel}，每日固定 24 小時，已分配 ${hoursLabel(allocated)}，剩餘 ${hoursLabel(Math.max(0, available - allocated))}`}
            style={{ left: index * scale, width: scale, top: TIMELINE_CONTEXT_ROW_HEIGHT }}
          >
            <b>{periodDisplayLabel(period, view, scale)}</b>
            <strong>
              {view === 'day'
                ? `剩餘 ${hoursLabel(remaining)}`
                : periodCapacityLabel(allocated, available, scale)}
            </strong>
            {view !== 'day' && scale >= 56 && <small>{period.dates.length} 天合計</small>}
          </span>
        );
      })}
    </>
  );
}

function TimelineHeader({
  periods,
  context,
  allocatedByDate,
  view,
  scale,
}: {
  periods: TimelinePeriod[];
  context: TimelineContextCell[];
  allocatedByDate: Map<string, number>;
  view: ViewMode;
  scale: number;
}) {
  return (
    <div
      className="dates capacity-dates"
      style={{
        width: periods.length * scale,
        height: TIMELINE_CONTEXT_ROW_HEIGHT + TIMELINE_CAPACITY_ROW_HEIGHT,
      }}
    >
      <TimelineContext cells={context} scale={scale} />
      <CapacityPeriods
        periods={periods}
        allocatedByDate={allocatedByDate}
        view={view}
        scale={scale}
      />
    </div>
  );
}

function TodayMarker({ periods, scale }: { periods: TimelinePeriod[]; scale: number }) {
  const date = today();
  const left = timelinePositionForDate(date, periods, scale);
  return (
    <span
      className="timeline-today-marker"
      style={{ left }}
      title={`今天 ${date}`}
      aria-label={`今天 ${date}`}
    >
      <i>今天</i>
    </span>
  );
}

function DeadlineMarker({
  task,
  allocations,
  periods,
  scale,
}: {
  task: Task;
  allocations: Allocation[];
  periods: TimelinePeriod[];
  scale: number;
}) {
  if (!task.deadline) return null;
  const left = timelinePositionForDate(task.deadline, periods, scale);
  const overdue = isTaskOverdue(task, allocations);
  return (
    <span
      className={`deadline-marker${overdue ? ' overdue' : ''}`}
      style={{ left }}
      title={`截止 ${task.deadline}${overdue ? ' · 已逾期' : ''}`}
    >
      <i>截止</i>
    </span>
  );
}

type AllocationWindow = { start: string; end: string } | null;

function allocationWindow(allocations: Allocation[]): AllocationWindow {
  const dates = allocations
    .filter(allocation => allocation.allocatedHours > 0)
    .map(allocation => allocation.date)
    .sort();
  return dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null;
}

function periodInAllocationWindow(period: TimelinePeriod, window: AllocationWindow) {
  if (!window) return { active: false, start: false, end: false };
  return {
    active: period.start <= window.end && period.end >= window.start,
    start: period.start <= window.start && period.end >= window.start,
    end: period.start <= window.end && period.end >= window.end,
  };
}

function AllocationSummaries({
  task,
  hoursByDate,
  periods,
  scale,
  view,
  allocationStep,
  allocationWindow,
  recurringDates,
  onAdjustAllocation,
  editable = true,
  readOnlyReason,
}: {
  task: Task;
  hoursByDate: Map<string, number>;
  periods: TimelinePeriod[];
  scale: number;
  view: ViewMode;
  allocationStep: number;
  allocationWindow: AllocationWindow;
  recurringDates: Set<string>;
  onAdjustAllocation: (taskId: string, date: string, delta: number) => void;
  editable?: boolean;
  readOnlyReason?: AllocationReadOnlyReason;
}) {
  const taskStyle = { '--task-color': task.color } as CSSProperties;
  const readOnlyLabel =
    readOnlyReason === 'completed' ? '已完成，不可修改' : '父任務工時由子任務彙總，不可直接修改';
  return (
    <div className={`allocation-summaries ${view === 'day' ? 'editable' : ''}`} style={taskStyle}>
      {periods.map((period, index) => {
        const hours = periodHours(period, hoursByDate);
        const windowState = periodInAllocationWindow(period, allocationWindow);
        const isRecurring = period.dates.some(date => recurringDates.has(date));
        const className = [
          view === 'day' ? 'allocation-cell' : 'allocation-summary',
          windowState.active ? 'in-allocation-window' : '',
          windowState.start ? 'window-start' : '',
          windowState.end ? 'window-end' : '',
          hours ? 'has-hours' : '',
          isRecurring ? 'recurring-allocation' : '',
        ]
          .filter(Boolean)
          .join(' ');
        if (view === 'day')
          return (
            <button
              key={period.start}
              className={className}
              disabled={!editable}
              style={{ left: index * scale, width: scale }}
              title={`${period.label} · ${hoursLabel(hours)}${isRecurring ? ' · 重複排程' : ''}${editable ? ` · 左鍵 +${hoursLabel(allocationStep)}，右鍵 -${hoursLabel(allocationStep)}` : ` · ${readOnlyLabel}`}`}
              aria-label={`${task.name} ${period.label} ${hoursLabel(hours)}${editable ? `，左鍵增加${hoursLabel(allocationStep)}，右鍵減少${hoursLabel(allocationStep)}` : `，${readOnlyLabel}`}`}
              onClick={event => {
                event.stopPropagation();
                onAdjustAllocation(task.id, period.start, allocationStep);
              }}
              onContextMenu={event => {
                event.preventDefault();
                event.stopPropagation();
                onAdjustAllocation(task.id, period.start, -allocationStep);
              }}
            >
              {hours ? hoursLabel(hours) : ''}
            </button>
          );
        return (
          <span
            key={period.start}
            className={className}
            style={{ left: index * scale, width: scale }}
            title={`${period.label} · ${hoursLabel(hours)}${isRecurring ? ' · 重複排程' : ''}`}
          >
            {hours ? hoursLabel(hours) : ''}
          </span>
        );
      })}
    </div>
  );
}

const EMPTY_HOURS_BY_DATE = new Map<string, number>();
type AllocationReadOnlyReason = 'completed' | 'parent';

function TimelineTaskRows({
  tasks,
  taskTree,
  hoursByTask,
  allocationsByTask,
  periods,
  scale,
  view,
  allocationStep,
  onAdjustAllocation,
}: {
  tasks: Task[];
  taskTree: TaskTreeIndex;
  hoursByTask: Map<string, Map<string, number>>;
  allocationsByTask: Map<string, Allocation[]>;
  periods: TimelinePeriod[];
  scale: number;
  view: ViewMode;
  allocationStep: number;
  onAdjustAllocation: (taskId: string, date: string, delta: number) => void;
}) {
  return (
    <>
      {tasks.map(task => {
        const taskAllocations = allocationsByTask.get(task.id) || [];
        const taskAllocationWindow = allocationWindow(taskAllocations);
        const recurringDates = new Set(
          taskAllocations
            .filter(allocation => allocation.recurrenceId)
            .map(allocation => allocation.date),
        );
        const hasChildren = taskTree.hasChildren(task.id);
        return (
          <div
            className={`timeline-row${isTaskOverdue(task, allocationsByTask.get(task.id) || []) ? ' deadline-overdue' : ''}`}
            key={task.id}
          >
            <DeadlineMarker
              task={task}
              allocations={allocationsByTask.get(task.id) || []}
              periods={periods}
              scale={scale}
            />
            <AllocationSummaries
              task={task}
              hoursByDate={hoursByTask.get(task.id) || EMPTY_HOURS_BY_DATE}
              periods={periods}
              scale={scale}
              view={view}
              allocationStep={allocationStep}
              allocationWindow={taskAllocationWindow}
              recurringDates={recurringDates}
              editable={task.status !== 'completed' && !hasChildren}
              readOnlyReason={
                task.status === 'completed' ? 'completed' : hasChildren ? 'parent' : undefined
              }
              onAdjustAllocation={onAdjustAllocation}
            />
          </div>
        );
      })}
    </>
  );
}

function DropPreview({
  task,
  periods,
  scale,
  rowIndex,
}: {
  task: Task;
  periods: TimelinePeriod[];
  scale: number;
  rowIndex: number;
}) {
  const geometry = dropPreviewGeometry(task, periods, scale);
  if (!geometry) return null;
  return (
    <div
      className="drop-preview"
      style={{
        left: geometry.left,
        width: geometry.width,
        top: rowIndex * TIMELINE_TASK_ROW_HEIGHT + DROP_PREVIEW_TOP,
        backgroundColor: task.color,
      }}
      title={`${task.name} · 預覽排程`}
    >
      <span className="drop-preview-label">{task.name}</span>
    </div>
  );
}

function TimelineGrid({
  periods,
  view,
  scale,
  tasks,
  taskTree,
  hoursByTask,
  allocationsByTask,
  dropPreview,
  allocationStep,
  onAdjustAllocation,
}: {
  periods: TimelinePeriod[];
  view: ViewMode;
  scale: number;
  tasks: Task[];
  taskTree: TaskTreeIndex;
  hoursByTask: Map<string, Map<string, number>>;
  allocationsByTask: Map<string, Allocation[]>;
  dropPreview: Task | null;
  allocationStep: number;
  onAdjustAllocation: (taskId: string, date: string, delta: number) => void;
}) {
  const style = {
    width: periods.length * scale,
    minHeight: Math.max(TIMELINE_TASK_ROW_HEIGHT, tasks.length * TIMELINE_TASK_ROW_HEIGHT),
    '--scale': `${scale}px`,
  } as CSSProperties;
  return (
    <div className="timeline-grid" style={style}>
      <TimelineTaskRows
        tasks={tasks}
        taskTree={taskTree}
        hoursByTask={hoursByTask}
        allocationsByTask={allocationsByTask}
        periods={periods}
        scale={scale}
        view={view}
        allocationStep={allocationStep}
        onAdjustAllocation={onAdjustAllocation}
      />
      {dropPreview && (
        <DropPreview
          task={dropPreview}
          periods={periods}
          scale={scale}
          rowIndex={Math.max(0, tasks.length - 1)}
        />
      )}
      <div className="timeline-row-separators" aria-hidden="true" />
    </div>
  );
}

function GanttSidebar({
  projectId,
  tasks,
  allTasks,
  taskTree,
  expandedTaskIds,
  allocatedByTask,
  allocationsByTask,
  headerHeight,
  taskDrag,
  onEdit,
  onAddTask,
  onDelete,
  onAddChild,
  onToggleTask,
  onBeginTaskDrag,
  onTaskDropTarget,
}: {
  projectId: string;
  tasks: Task[];
  allTasks: Task[];
  taskTree: TaskTreeIndex;
  expandedTaskIds: Set<string>;
  allocatedByTask: Map<string, number>;
  allocationsByTask: Map<string, Allocation[]>;
  headerHeight: number;
  taskDrag: TaskDragState | null;
  onEdit: (task: Task) => void;
  onAddTask: () => void;
  onDelete: (taskId: string) => void;
  onAddChild: (task: Task) => void;
  onToggleTask: (taskId: string) => void;
  onBeginTaskDrag: (
    task: Task,
    event: PointerEvent<HTMLElement>,
    allocatedHours: number,
    pendingHours: number,
    isGroup?: boolean,
  ) => void;
  onTaskDropTarget: TaskDropTargetHandler;
}) {
  const handleSidebarPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      !(target instanceof Element) ||
      (!target.closest('.gantt-side-row') && !target.closest('.gantt-add-row'))
    )
      onTaskDropTarget({ kind: 'gantt-sidebar', projectId }, event.currentTarget);
  };
  const handleLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerLeftElement(event)) onTaskDropTarget(null);
  };
  return (
    <div
      className="gantt-sidebar"
      onPointerMove={handleSidebarPointerMove}
      onPointerLeave={handleLeave}
    >
      <div
        className="gantt-head capacity-gantt-head"
        style={{ height: headerHeight, paddingTop: TIMELINE_CONTEXT_ROW_HEIGHT }}
      >
        <span>Timeline Task</span>
        <small>工時摘要／操作</small>
      </div>
      {tasks.map(task => {
        const allocated = allocatedByTask.get(task.id) || 0;
        const hasChildren = taskTree.hasChildren(task.id);
        const estimated = hasChildren
          ? aggregateTaskEstimate(task.id, allTasks, taskTree)
          : task.estimatedHours;
        const pending = estimated - allocated;
        const dropRelation =
          taskDrag?.projectId === projectId && taskDrag.target?.taskId === task.id
            ? taskDrag.target.relation
            : undefined;
        const handleRowPointerMove = (event: PointerEvent<HTMLDivElement>) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          onTaskDropTarget(
            {
              kind: 'gantt-row',
              projectId,
              taskId: task.id,
              relation: taskRowDropRelation(
                event.clientY - bounds.top,
                bounds.height,
                task.id === tasks.at(-1)?.id,
              ),
            },
            event.currentTarget,
          );
        };
        return (
          <div
            className={`gantt-side-row${pending !== 0 ? ' has-pending' : ''}${isTaskOverdue(task, allocationsByTask.get(task.id) || []) ? ' has-deadline-warning' : ''}${dropRelation ? ` drop-target-${dropRelation}` : ''}`}
            key={task.id}
            onPointerMove={handleRowPointerMove}
            onPointerLeave={handleLeave}
          >
            <TaskCard
              task={task}
              variant="gantt"
              allocatedHours={allocated}
              pendingHours={pending}
              hasChildren={hasChildren}
              isGroup={hasChildren}
              depth={taskTree.depth(task.id)}
              expanded={expandedTaskIds.has(task.id)}
              onToggle={hasChildren ? item => onToggleTask(item.id) : undefined}
              onAddChild={onAddChild}
              isDragging={
                taskDrag?.projectId === projectId && taskDrag.active && taskDrag.task.id === task.id
              }
              onEdit={onEdit}
              onDelete={task.status !== 'completed' ? onDelete : undefined}
              onPointerDown={
                task.status !== 'completed'
                  ? event => onBeginTaskDrag(task, event, allocated, pending, hasChildren)
                  : undefined
              }
            />
          </div>
        );
      })}
      <button
        className="gantt-add-row"
        type="button"
        aria-label="Allocation Timeline 新增 Task"
        onClick={onAddTask}
        onPointerMove={event => {
          const lastTask = tasks.at(-1);
          onTaskDropTarget(
            lastTask
              ? { kind: 'gantt-row', projectId, taskId: lastTask.id, relation: 'after' }
              : { kind: 'gantt-sidebar', projectId },
            event.currentTarget,
          );
        }}
      >
        ＋ 新增 Task
      </button>
    </div>
  );
}

export default function CapacityGantt({
  projectId,
  tasks,
  allTasks,
  taskTree,
  expandedTaskIds,
  backlogTasks,
  allocations,
  allAllocations,
  timelineZoom,
  timelineInputMode,
  autoScheduleEnabled,
  allocationStep,
  scrollLeft,
  taskDrag,
  onZoomChange,
  onEdit,
  onAddTask,
  onBeginTaskDrag,
  onTaskDropTarget,
  onAdjustAllocation,
  onDelete,
  onAddChild,
  onToggleTask,
  onTimelineScroll,
}: CapacityGanttProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<PanState | null>(null);
  const zoomAnchorRef = useRef<{ date: string; pointerOffset: number } | null>(null);
  const layoutRef = useRef<{ key: string; periods: TimelinePeriod[]; scale: number } | null>(null);
  const skipScrollSyncRef = useRef(false);
  const [panning, setPanning] = useState(false);
  const suppressClickRef = useRef(false);
  const view = timelineZoom.view;
  const scale = timelineScale(view, timelineZoom.pixelsPerDay);
  const range = useMemo(() => timelineRange(tasks, view, allocations), [tasks, view, allocations]);
  const periods = useMemo(
    () => buildTimelinePeriods(range.start, range.end, view),
    [range.start, range.end, view],
  );
  const context = useMemo(() => buildTimelineContext(periods, view), [periods, view]);
  const headerHeight = TIMELINE_CONTEXT_ROW_HEIGHT + TIMELINE_CAPACITY_ROW_HEIGHT;
  const layoutKey = `${view}:${timelineZoom.pixelsPerDay}:${range.start}:${range.end}`;

  // Date/task keyed indexes, so the header and every row read O(1) instead of rescanning allocations per day.
  const capacityAllocatedByDate = useMemo(
    () => allocatedHoursByDate(allAllocations),
    [allAllocations],
  );
  const taskAllocations = useMemo(() => {
    const index = new Map<string, Allocation[]>();
    for (const task of tasks)
      index.set(task.id, aggregateTaskAllocations(task.id, allTasks, allocations, taskTree));
    return index;
  }, [tasks, allTasks, allocations, taskTree]);
  const allocatedByTask = useMemo(() => {
    const index = new Map<string, number>();
    for (const [taskId, items] of taskAllocations)
      index.set(
        taskId,
        items.reduce((sum, item) => sum + item.allocatedHours, 0),
      );
    return index;
  }, [taskAllocations]);
  const hoursByTask = useMemo(() => {
    const index = new Map<string, Map<string, number>>();
    for (const [taskId, items] of taskAllocations) index.set(taskId, allocatedHoursByDate(items));
    return index;
  }, [taskAllocations]);

  const latestRef = useRef({ timelineZoom, periods, scale, onZoomChange });
  const isTimelineGroupDrag =
    taskDrag?.projectId === projectId &&
    taskDrag.active &&
    taskDrag.isGroup &&
    taskDrag.origin === 'gantt';
  const dropTargetDate =
    !isTimelineGroupDrag &&
    taskDrag?.projectId === projectId &&
    taskDrag.target?.kind === 'gantt-timeline'
      ? taskDrag.target.date
      : undefined;
  const dropTargetTaskId = dropTargetDate ? taskDrag?.task.id : undefined;
  const dropPreview = useMemo(() => {
    if (!dropTargetTaskId || !dropTargetDate) return null;
    if (!autoScheduleEnabled && taskDrag?.origin === 'backlog') return null;
    const task =
      backlogTasks.find(item => item.id === dropTargetTaskId) ||
      tasks.find(item => item.id === dropTargetTaskId);
    if (!task) return null;
    try {
      const result = scheduleTaskAt(task, allAllocations, dropTargetDate);
      return {
        ...result.task,
        start: result.task.start || dropTargetDate,
        end: result.task.end || dropTargetDate,
        status: 'scheduled' as const,
      };
    } catch {
      return { ...task, start: dropTargetDate, end: dropTargetDate, status: 'scheduled' as const };
    }
  }, [
    dropTargetTaskId,
    dropTargetDate,
    backlogTasks,
    allAllocations,
    tasks,
    autoScheduleEnabled,
    taskDrag?.origin,
  ]);

  useEffect(() => {
    latestRef.current = { timelineZoom, periods, scale, onZoomChange };
  }, [timelineZoom, periods, scale, onZoomChange]);
  useEffect(() => {
    if (skipScrollSyncRef.current) {
      skipScrollSyncRef.current = false;
      return;
    }
    if (timelineRef.current && Math.abs(timelineRef.current.scrollLeft - scrollLeft) > 1)
      timelineRef.current.scrollLeft = scrollLeft;
  }, [scrollLeft]);
  useLayoutEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const previous = layoutRef.current;
    if (!previous) {
      const initialLeft = Math.max(
        0,
        timelinePositionForDate(today(), periods, scale) - timeline.clientWidth / 2,
      );
      timeline.scrollLeft = initialLeft;
      skipScrollSyncRef.current = true;
      onTimelineScroll(initialLeft);
    } else if (previous.key !== layoutKey) {
      const anchor = zoomAnchorRef.current;
      if (anchor) {
        timeline.scrollLeft = Math.max(
          0,
          timelinePositionForDate(anchor.date, periods, scale) - anchor.pointerOffset,
        );
        zoomAnchorRef.current = null;
      } else {
        const focusX = timeline.scrollLeft + timeline.clientWidth / 2;
        const focusDate = timelineDateAtPosition(focusX, previous.periods, previous.scale);
        timeline.scrollLeft = Math.max(
          0,
          timelinePositionForDate(focusDate, periods, scale) - timeline.clientWidth / 2,
        );
      }
      onTimelineScroll(timeline.scrollLeft);
    }
    layoutRef.current = { key: layoutKey, periods, scale };
  }, [layoutKey, periods, scale, onTimelineScroll]);
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const handleWheel = (event: globalThis.WheelEvent) => {
      const isZoomGesture = timelineInputMode === 'mouse' || event.ctrlKey;
      if (!isZoomGesture || !event.deltaY) return;
      event.preventDefault();
      event.stopPropagation();
      const latest = latestRef.current;
      const deltaMultiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      const sensitivity =
        timelineInputMode === 'trackpad'
          ? TIMELINE_TRACKPAD_ZOOM_SENSITIVITY
          : TIMELINE_MOUSE_WHEEL_ZOOM_SENSITIVITY;
      const nextZoom = zoomTimelineByWheelDelta(
        latest.timelineZoom,
        event.deltaY * deltaMultiplier,
        sensitivity,
      );
      if (nextZoom.pixelsPerDay === latest.timelineZoom.pixelsPerDay) return;
      const pointerOffset = event.clientX - timeline.getBoundingClientRect().left;
      zoomAnchorRef.current = {
        date: timelineDateAtPosition(
          timeline.scrollLeft + pointerOffset,
          latest.periods,
          latest.scale,
        ),
        pointerOffset,
      };
      latest.timelineZoom = nextZoom;
      latest.onZoomChange(nextZoom);
    };
    timeline.addEventListener('wheel', handleWheel, { passive: false });
    return () => timeline.removeEventListener('wheel', handleWheel);
  }, [timelineInputMode]);
  const beginPan = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target;
    const targetElement = target instanceof Element ? target : null;
    const canPanFromAllocationSurface = Boolean(targetElement?.closest('.allocation-cell'));
    if (
      targetElement?.closest('button,[role="button"],.allocation-cell') &&
      !canPanFromAllocationSurface
    )
      return;
    const timeline = event.currentTarget;
    const active = !canPanFromAllocationSurface;
    panRef.current = {
      startX: event.clientX,
      startScrollLeft: timeline.scrollLeft,
      candidate: !active,
      active,
    };
    if (active) {
      event.preventDefault();
      if (typeof timeline.setPointerCapture === 'function')
        timeline.setPointerCapture(event.pointerId);
      setPanning(true);
    }
  };
  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    const current = panRef.current;
    if (!current) return;
    if (current.candidate && !current.active) {
      if (Math.abs(event.clientX - current.startX) < 4) return;
      current.active = true;
      event.preventDefault();
      if (typeof event.currentTarget.setPointerCapture === 'function')
        event.currentTarget.setPointerCapture(event.pointerId);
      setPanning(true);
    }
    if (!current.active) return;
    event.preventDefault();
    event.currentTarget.scrollLeft = current.startScrollLeft - (event.clientX - current.startX);
  };
  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    const current = panRef.current;
    if (!current) return;
    if (current.active && current.candidate) {
      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    if (
      typeof event.currentTarget.hasPointerCapture === 'function' &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    )
      event.currentTarget.releasePointerCapture(event.pointerId);
    panRef.current = null;
    if (current.active) setPanning(false);
  };
  const handleTaskDropMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!taskDrag?.active) return;
    if (isTimelineGroupDrag) {
      onTaskDropTarget(null);
      return;
    }
    const timeline = timelineRef.current;
    if (!timeline) return;
    const bounds = timeline.getBoundingClientRect();
    const date = timelineDateAtPosition(
      event.clientX - bounds.left + timeline.scrollLeft,
      periods,
      scale,
    );
    onTaskDropTarget(
      date ? { kind: 'gantt-timeline', projectId, date } : null,
      date ? timeline : undefined,
    );
  };
  const handleTaskDropLeave = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerLeftElement(event)) onTaskDropTarget(null);
  };
  const handleTimelinePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    handleTaskDropMove(event);
    movePan(event);
  };
  const canvasHeight =
    headerHeight + Math.max(TIMELINE_TASK_ROW_HEIGHT, tasks.length * TIMELINE_TASK_ROW_HEIGHT);
  return (
    <section className="gantt-section">
      <div className="section-heading">
        <div>
          <h2>Capacity Allocation</h2>
          <small>
            每日固定 24 小時；日層級左鍵 +{hoursLabel(allocationStep)}、右鍵 -
            {hoursLabel(allocationStep)}；淺底＝Allocation 範圍、深底＝實際工時、標題標記＝週末。
            {timelineInputMode === 'trackpad'
              ? '兩指滑動捲動、兩指捏合縮放、拖曳平移時間軸'
              : '滑鼠滾輪縮放、拖曳平移時間軸'}
          </small>
        </div>
      </div>
      <div className="gantt">
        <GanttSidebar
          projectId={projectId}
          tasks={tasks}
          allTasks={allTasks}
          taskTree={taskTree}
          expandedTaskIds={expandedTaskIds}
          allocatedByTask={allocatedByTask}
          allocationsByTask={taskAllocations}
          headerHeight={headerHeight}
          taskDrag={taskDrag}
          onEdit={onEdit}
          onAddTask={onAddTask}
          onDelete={onDelete}
          onAddChild={onAddChild}
          onToggleTask={onToggleTask}
          onBeginTaskDrag={onBeginTaskDrag}
          onTaskDropTarget={onTaskDropTarget}
        />
        <div
          className={`timeline${panning ? ' panning' : ''}`}
          data-view={view}
          data-pixels-per-day={timelineZoom.pixelsPerDay}
          ref={timelineRef}
          onScroll={event => onTimelineScroll(event.currentTarget.scrollLeft)}
          onClickCapture={event => {
            if (suppressClickRef.current) {
              event.preventDefault();
              event.stopPropagation();
              suppressClickRef.current = false;
            }
          }}
          onPointerDown={beginPan}
          onPointerMove={handleTimelinePointerMove}
          onPointerLeave={handleTaskDropLeave}
          onPointerUp={endPan}
          onPointerCancel={endPan}
        >
          <div
            className="timeline-canvas"
            style={{ width: periods.length * scale, minHeight: canvasHeight }}
          >
            <TimelineHeader
              periods={periods}
              context={context}
              allocatedByDate={capacityAllocatedByDate}
              view={view}
              scale={scale}
            />
            <TimelineGrid
              periods={periods}
              view={view}
              scale={scale}
              tasks={tasks}
              taskTree={taskTree}
              hoursByTask={hoursByTask}
              allocationsByTask={taskAllocations}
              dropPreview={dropPreview}
              allocationStep={allocationStep}
              onAdjustAllocation={onAdjustAllocation}
            />
            <TodayMarker periods={periods} scale={scale} />
          </div>
        </div>
      </div>
    </section>
  );
}
