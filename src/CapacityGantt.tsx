import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { DEFAULT_DAILY_CAPACITY_HOURS, today } from './capacity';
import { hoursLabel, weekdayDateLabel } from './formatters';
import TaskCard from './TaskCard';
import { pointerLeftElement, taskRowDropRelation } from './task-drag';
import type { TaskDragState, TaskDropTargetHandler } from './task-drag';
import { createTimelineNavigation } from './timeline-navigation';
import type { TimelineNavigation, TimelinePanTarget } from './timeline-navigation';
import type { Task, ViewMode } from './types';
import { DEFAULT_TASK_COLOR } from './task-colors';
import {
  periodDensity,
  periodDisplayLabel,
  timelinePositionForDate,
  timelineScale,
  dropPreviewGeometry,
  TIMELINE_CAPACITY_ROW_HEIGHT,
  TIMELINE_CONTEXT_ROW_HEIGHT,
  DROP_PREVIEW_TOP,
  TIMELINE_TASK_ROW_HEIGHT,
  weekendClass,
} from './timeline';
import type {
  TimelineContextCell,
  TimelineInputMode,
  TimelinePeriod,
  TimelineZoom,
} from './timeline';
import type {
  DailyDistributionOrder,
  DailyDistributionProjection,
  HierarchyDepth,
  TimelineCapacityPeriod,
  TimelineProjection,
  TimelineWorkItemProjection,
} from './view-projection';

export type CapacityGanttProps = {
  projectId: string;
  projection: TimelineProjection;
  dailyDistribution: DailyDistributionProjection;
  dailyDistributionOrder: DailyDistributionOrder;
  dailyDistributionDepth: HierarchyDepth;
  dropPreview: Task | null;
  timelineZoom: TimelineZoom;
  timelineInputMode: TimelineInputMode;
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
  onDailyDistributionOrderChange: (order: DailyDistributionOrder) => void;
  onDailyDistributionDepthChange: (depth: HierarchyDepth) => void;
};

type TimelineContextProps = { cells: readonly TimelineContextCell[]; scale: number };

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
  capacity: readonly TimelineCapacityPeriod[];
  view: ViewMode;
  scale: number;
};

function CapacityPeriods({ capacity, view, scale }: CapacityPeriodsProps) {
  const density = periodDensity(scale);
  return (
    <>
      {capacity.map(({ period, allocatedHours, remainingHours, state }, index) => {
        const remaining = Math.max(0, remainingHours);
        const weekend = weekendClass(period.start, view);
        const className = ['capacity-period', state, density, weekend].filter(Boolean).join(' ');
        const weekendLabel = weekend ? ' · 週末' : '';
        const title = `${period.label}${weekendLabel} · 已分配 ${hoursLabel(allocatedHours)} · 剩餘 ${hoursLabel(remaining)}`;
        return (
          <span
            className={className}
            key={period.start}
            title={title}
            aria-label={`${period.label}${weekendLabel}，已分配 ${hoursLabel(allocatedHours)}，剩餘 ${hoursLabel(remaining)}`}
            style={{ left: index * scale, width: scale, top: TIMELINE_CONTEXT_ROW_HEIGHT }}
          >
            <b>{periodDisplayLabel(period, view, scale)}</b>
            <strong>{hoursLabel(remaining)}</strong>
          </span>
        );
      })}
    </>
  );
}

function TimelineHeader({
  periods,
  context,
  capacity,
  view,
  scale,
}: {
  periods: readonly TimelinePeriod[];
  context: readonly TimelineContextCell[];
  capacity: readonly TimelineCapacityPeriod[];
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
      <CapacityPeriods capacity={capacity} view={view} scale={scale} />
    </div>
  );
}

function DailyDistributionTable({
  projection,
  order,
  hierarchyDepth,
  onOrderChange,
  onHierarchyDepthChange,
}: {
  projection: DailyDistributionProjection;
  order: DailyDistributionOrder;
  hierarchyDepth: HierarchyDepth;
  onOrderChange: (order: DailyDistributionOrder) => void;
  onHierarchyDepthChange: (depth: HierarchyDepth) => void;
}) {
  const changeOrder = (by: DailyDistributionOrder['by']) => {
    const direction =
      order.by === by
        ? order.direction === 'desc'
          ? 'asc'
          : 'desc'
        : by === 'hours'
          ? 'desc'
          : 'asc';
    onOrderChange({ by, direction });
  };
  const todayDate = today();
  const todayRowRef = useRef<HTMLTableRowElement>(null);
  const distributionScrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = distributionScrollRef.current;
    const row = todayRowRef.current;
    if (!container || !row) return;
    const containerBounds = container.getBoundingClientRect();
    const rowBounds = row.getBoundingClientRect();
    const rowCenter = rowBounds.top + rowBounds.height / 2;
    const containerCenter = containerBounds.top + container.clientHeight / 2;
    if (rowCenter < containerBounds.top || rowCenter > containerBounds.bottom)
      container.scrollTop += rowCenter - containerCenter;
  }, [projection.days]);

  return (
    <section className="daily-distribution" aria-label="每日時間分佈">
      <div className="daily-distribution-heading">
        <h3>每日時間分佈</h3>
        <div className="daily-distribution-controls">
          <span>排序</span>
          <div
            className="daily-distribution-control-group"
            role="group"
            aria-label="每日時間分佈排序"
          >
            <button
              className={order.by === 'hours' ? 'active' : ''}
              type="button"
              aria-pressed={order.by === 'hours'}
              onClick={() => changeOrder('hours')}
            >
              時數{order.by === 'hours' ? ` ${order.direction.toUpperCase()}` : ''}
            </button>
            <button
              className={order.by === 'task' ? 'active' : ''}
              type="button"
              aria-pressed={order.by === 'task'}
              title="依父任務群組，並沿用任務順序"
              onClick={() => changeOrder('task')}
            >
              任務{order.by === 'task' ? ` ${order.direction.toUpperCase()}` : ''}
            </button>
          </div>
          <span>層級</span>
          <div className="daily-distribution-control-group" role="group" aria-label="顯示任務層級">
            {[1, 2, 3].map(depth => (
              <button
                className={hierarchyDepth === depth ? 'active' : ''}
                key={depth}
                type="button"
                aria-pressed={hierarchyDepth === depth}
                aria-label={`顯示第 ${depth} 層`}
                onClick={() => onHierarchyDepthChange(depth as HierarchyDepth)}
              >
                第{depth}層
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="daily-distribution-scroll" ref={distributionScrollRef}>
        <table className="daily-distribution-table">
          <colgroup>
            <col className="daily-distribution-date-column" />
            <col className="daily-distribution-timeline-column" />
            <col className="daily-distribution-remaining-column" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">日期</th>
              <th scope="col">
                <div className="daily-distribution-axis" aria-hidden="true">
                  {[0, 6, 12, 18, 24].map(hour => (
                    <span key={hour} style={{ left: `${(hour / 24) * 100}%` }}>
                      {hour}h
                    </span>
                  ))}
                </div>
              </th>
              <th scope="col">剩餘</th>
            </tr>
          </thead>
          <tbody>
            {projection.days.map(({ date, remainingHours, overloaded, segments }) => {
              const description = segments.length
                ? segments
                    .map(segment => `${segment.workItem.name} ${hoursLabel(segment.hours)}`)
                    .join('、')
                : '尚未安排工時';
              return (
                <tr
                  className={date === todayDate ? 'daily-distribution-today' : ''}
                  key={date}
                  ref={date === todayDate ? todayRowRef : undefined}
                >
                  <th scope="row">
                    <span>{weekdayDateLabel(date)}</span>
                    {date === todayDate ? (
                      <span className="daily-distribution-today-label">今天</span>
                    ) : null}
                  </th>
                  <td>
                    <div
                      className={`daily-distribution-track${overloaded ? ' overloaded' : ''}${segments.length ? '' : ' empty'}`}
                      aria-label={`${weekdayDateLabel(date)}：${description}${overloaded ? '，超過每日容量' : ''}`}
                    >
                      {segments.map(segment => (
                        <span
                          className="daily-distribution-segment"
                          key={segment.workItem.id}
                          role="img"
                          aria-label={`${segment.workItem.name} ${hoursLabel(segment.hours)}`}
                          title={`${segment.workItem.name} · ${hoursLabel(segment.hours)}`}
                          style={
                            {
                              left: `${(segment.startHour / DEFAULT_DAILY_CAPACITY_HOURS) * 100}%`,
                              width: `${(segment.visibleHours / DEFAULT_DAILY_CAPACITY_HOURS) * 100}%`,
                              '--task-color': segment.displayColor,
                            } as CSSProperties
                          }
                        >
                          <span className="daily-distribution-segment-label">
                            {segment.workItem.name}
                          </span>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className={overloaded ? 'daily-distribution-overloaded' : ''}>
                    {hoursLabel(remainingHours)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TodayMarker({ periods, scale }: { periods: readonly TimelinePeriod[]; scale: number }) {
  const date = today();
  const left = Math.round(timelinePositionForDate(date, periods, scale));
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
  overdue,
  periods,
  scale,
}: {
  task: Task;
  overdue: boolean;
  periods: readonly TimelinePeriod[];
  scale: number;
}) {
  if (!task.deadline) return null;
  const left = timelinePositionForDate(task.deadline, periods, scale);
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

function AllocationSummaries({
  row,
  periods,
  scale,
  view,
  allocationStep,
  onAdjustAllocation,
}: {
  row: TimelineWorkItemProjection;
  periods: readonly TimelinePeriod[];
  scale: number;
  view: ViewMode;
  allocationStep: number;
  onAdjustAllocation: (taskId: string, date: string, delta: number) => void;
}) {
  const task = row.workItem;
  const editable = row.allocationReadOnlyReason === null;
  const taskStyle = { '--task-color': row.displayColor } as CSSProperties;
  const readOnlyLabel =
    row.allocationReadOnlyReason === 'completed'
      ? '已完成，不可修改'
      : '父任務工時由子任務彙總，不可直接修改';
  const density = periodDensity(scale);
  return (
    <div
      className={`allocation-summaries ${density}${view === 'day' ? ' editable' : ''}`}
      style={taskStyle}
    >
      {periods.map((period, index) => {
        const cell = row.cells[index];
        const hours = cell.allocatedHours;
        const isRecurring = cell.recurring;
        const className = [
          'allocation-period',
          view === 'day' ? 'allocation-cell' : 'allocation-summary',
          !editable ? 'allocation-read-only' : '',
          cell.window !== 'none' ? 'in-allocation-window' : '',
          cell.window === 'start' || cell.window === 'only' ? 'window-start' : '',
          cell.window === 'end' || cell.window === 'only' ? 'window-end' : '',
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
              {hours ? <span className="allocation-hours-label">{hoursLabel(hours)}</span> : null}
            </button>
          );
        return (
          <span
            key={period.start}
            className={className}
            style={{ left: index * scale, width: scale }}
            title={`${period.label} · ${hoursLabel(hours)}${isRecurring ? ' · 重複排程' : ''}`}
          >
            {hours ? <span className="allocation-hours-label">{hoursLabel(hours)}</span> : null}
          </span>
        );
      })}
    </div>
  );
}

function TimelineTaskRows({
  rows,
  periods,
  scale,
  view,
  allocationStep,
  onAdjustAllocation,
}: {
  rows: readonly TimelineWorkItemProjection[];
  periods: readonly TimelinePeriod[];
  scale: number;
  view: ViewMode;
  allocationStep: number;
  onAdjustAllocation: (taskId: string, date: string, delta: number) => void;
}) {
  return (
    <>
      {rows.map(row => {
        const task = row.workItem;
        return (
          <div className={`timeline-row${row.overdue ? ' deadline-overdue' : ''}`} key={task.id}>
            <DeadlineMarker task={task} overdue={row.overdue} periods={periods} scale={scale} />
            <AllocationSummaries
              row={row}
              periods={periods}
              scale={scale}
              view={view}
              allocationStep={allocationStep}
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
  periods: readonly TimelinePeriod[];
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
        backgroundColor: task.color ?? DEFAULT_TASK_COLOR,
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
  rows,
  dropPreview,
  allocationStep,
  onAdjustAllocation,
}: {
  periods: readonly TimelinePeriod[];
  view: ViewMode;
  scale: number;
  rows: readonly TimelineWorkItemProjection[];
  dropPreview: Task | null;
  allocationStep: number;
  onAdjustAllocation: (taskId: string, date: string, delta: number) => void;
}) {
  const style = {
    width: periods.length * scale,
    minHeight: Math.max(TIMELINE_TASK_ROW_HEIGHT, rows.length * TIMELINE_TASK_ROW_HEIGHT),
    '--scale': `${scale}px`,
  } as CSSProperties;
  return (
    <div className="timeline-grid" style={style}>
      <TimelineTaskRows
        rows={rows}
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
          rowIndex={Math.max(0, rows.length - 1)}
        />
      )}
      <div className="timeline-row-separators" aria-hidden="true" />
    </div>
  );
}

function GanttSidebar({
  projectId,
  rows,
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
  rows: readonly TimelineWorkItemProjection[];
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
        style={{
          height: headerHeight,
          paddingTop: TIMELINE_CONTEXT_ROW_HEIGHT,
          position: 'sticky',
          top: '66px',
          zIndex: 10,
        }}
      >
        <span>Timeline Task</span>
        <small>工時摘要／操作</small>
      </div>
      {rows.map(row => {
        const task = row.workItem;
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
                task.id === rows.at(-1)?.workItem.id,
              ),
            },
            event.currentTarget,
          );
        };
        return (
          <div
            className={`gantt-side-row${row.pendingHours !== 0 ? ' has-pending' : ''}${row.overdue ? ' has-deadline-warning' : ''}${dropRelation ? ` drop-target-${dropRelation}` : ''}`}
            key={task.id}
            onPointerMove={handleRowPointerMove}
            onPointerLeave={handleLeave}
          >
            <TaskCard
              task={task}
              displayColor={row.displayColor}
              variant="gantt"
              allocatedHours={row.allocatedHours}
              pendingHours={row.pendingHours}
              hasChildren={row.hasChildren}
              isGroup={row.hasChildren}
              depth={row.depth}
              expanded={row.expanded}
              onToggle={row.hasChildren ? item => onToggleTask(item.id) : undefined}
              onAddChild={onAddChild}
              isDragging={
                taskDrag?.projectId === projectId && taskDrag.active && taskDrag.task.id === task.id
              }
              onEdit={onEdit}
              onDelete={task.status !== 'completed' ? onDelete : undefined}
              onPointerDown={
                task.status !== 'completed'
                  ? event =>
                      onBeginTaskDrag(
                        task,
                        event,
                        row.allocatedHours,
                        row.pendingHours,
                        row.hasChildren,
                      )
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
          const lastTask = rows.at(-1)?.workItem;
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
  projection,
  dailyDistribution,
  dailyDistributionOrder,
  dailyDistributionDepth,
  dropPreview,
  timelineZoom,
  timelineInputMode,
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
  onDailyDistributionOrderChange,
  onDailyDistributionDepthChange,
}: CapacityGanttProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const headerCanvasRef = useRef<HTMLDivElement>(null);
  const panningRef = useRef(false);
  const view = timelineZoom.view;
  const scale = timelineScale(view, timelineZoom.pixelsPerDay);
  const { range, periods, context, capacity, rows } = projection;
  const headerHeight = TIMELINE_CONTEXT_ROW_HEIGHT + TIMELINE_CAPACITY_ROW_HEIGHT;
  const layoutKey = `${view}:${timelineZoom.pixelsPerDay}:${range.start}:${range.end}`;
  const [navigation] = useState<TimelineNavigation>(() =>
    createTimelineNavigation({ timelineZoom, periods, scale }),
  );
  const [panning, setPanning] = useState(false);
  const suppressClickRef = useRef(false);

  const isTimelineGroupDrag =
    taskDrag?.projectId === projectId &&
    taskDrag.active &&
    taskDrag.isGroup &&
    taskDrag.origin === 'gantt';

  useEffect(() => {
    navigation.update({ timelineZoom, periods, scale });
  }, [navigation, periods, scale, timelineZoom]);
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const effect = navigation.syncExternalScroll({
      requestedScrollLeft: scrollLeft,
      actualScrollLeft: timeline.scrollLeft,
    });
    if (effect.scrollLeft !== undefined) timeline.scrollLeft = effect.scrollLeft;
    if (headerCanvasRef.current)
      headerCanvasRef.current.style.transform = `translateX(-${timeline.scrollLeft}px)`;
  }, [navigation, scrollLeft]);
  useLayoutEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const effect = navigation.applyLayout({
      key: layoutKey,
      periods,
      scale,
      viewportWidth: timeline.clientWidth,
      scrollLeft: timeline.scrollLeft,
      referenceDate: today(),
    });
    if (effect.scrollLeft !== undefined) {
      timeline.scrollLeft = effect.scrollLeft;
      if (headerCanvasRef.current)
        headerCanvasRef.current.style.transform = `translateX(-${timeline.scrollLeft}px)`;
      onTimelineScroll(effect.scrollLeft);
    }
  }, [layoutKey, navigation, onTimelineScroll, periods, scale]);
  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const handleWheel = (event: globalThis.WheelEvent) => {
      const effect = navigation.handleWheel({
        inputMode: timelineInputMode,
        ctrlKey: event.ctrlKey,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        clientX: event.clientX,
        boundsLeft: timeline.getBoundingClientRect().left,
        scrollLeft: timeline.scrollLeft,
      });
      if (effect.preventDefault) event.preventDefault();
      if (effect.stopPropagation) event.stopPropagation();
      if (effect.nextZoom) onZoomChange(effect.nextZoom);
    };
    timeline.addEventListener('wheel', handleWheel, { passive: false });
    return () => timeline.removeEventListener('wheel', handleWheel);
  }, [navigation, onZoomChange, timelineInputMode]);
  const beginPan = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target;
    const targetElement = target instanceof Element ? target : null;
    const targetKind: TimelinePanTarget = targetElement?.closest('.allocation-cell')
      ? 'allocation'
      : targetElement?.closest('button,[role="button"]')
        ? 'interactive'
        : 'canvas';
    const effect = navigation.beginPan({
      button: event.button,
      target: targetKind,
      clientX: event.clientX,
      scrollLeft: event.currentTarget.scrollLeft,
    });
    if (effect.preventDefault) event.preventDefault();
    if (effect.capturePointer && typeof event.currentTarget.setPointerCapture === 'function')
      event.currentTarget.setPointerCapture(event.pointerId);
    if (effect.panning !== undefined) {
      panningRef.current = effect.panning;
      setPanning(effect.panning);
    }
  };
  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    const effect = navigation.movePan({ clientX: event.clientX });
    if (effect.preventDefault) event.preventDefault();
    if (effect.capturePointer && typeof event.currentTarget.setPointerCapture === 'function')
      event.currentTarget.setPointerCapture(event.pointerId);
    if (effect.scrollLeft !== undefined) {
      event.currentTarget.scrollLeft = effect.scrollLeft;
      if (headerCanvasRef.current)
        headerCanvasRef.current.style.transform = `translateX(-${event.currentTarget.scrollLeft}px)`;
    }
    if (effect.panning !== undefined) {
      panningRef.current = effect.panning;
      setPanning(effect.panning);
    }
  };
  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    const wasPanning = panningRef.current;
    const effect = navigation.endPan();
    if (effect.suppressClick) {
      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    if (
      effect.releasePointer &&
      typeof event.currentTarget.hasPointerCapture === 'function' &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    )
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (effect.panning !== undefined) {
      panningRef.current = effect.panning;
      setPanning(effect.panning);
    }
    if (wasPanning) onTimelineScroll(event.currentTarget.scrollLeft);
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
    const date = navigation.dateAtPointer({
      clientX: event.clientX,
      boundsLeft: bounds.left,
      scrollLeft: timeline.scrollLeft,
    });
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
  const canvasHeight = Math.max(TIMELINE_TASK_ROW_HEIGHT, rows.length * TIMELINE_TASK_ROW_HEIGHT);
  const timelineWidth = periods.length * scale;
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
          rows={rows}
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
        <div className="timeline-shell">
          <div className="timeline-header-sticky" style={{ position: 'sticky', top: '66px' }}>
            <div className="timeline-header-viewport">
              <div
                className="timeline-header-canvas"
                ref={headerCanvasRef}
                style={{
                  width: timelineWidth,
                  transform: `translateX(-${scrollLeft}px)`,
                }}
              >
                <TimelineHeader
                  periods={periods}
                  context={context}
                  capacity={capacity}
                  view={view}
                  scale={scale}
                />
              </div>
            </div>
          </div>
          <div
            className={`timeline${panning ? ' panning' : ''}`}
            data-view={view}
            data-pixels-per-day={timelineZoom.pixelsPerDay}
            ref={timelineRef}
            onScroll={event => {
              const left = event.currentTarget.scrollLeft;
              if (headerCanvasRef.current)
                headerCanvasRef.current.style.transform = `translateX(-${left}px)`;
              if (!panningRef.current) onTimelineScroll(left);
            }}
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
              style={{ width: timelineWidth, minHeight: canvasHeight }}
            >
              <TimelineGrid
                periods={periods}
                view={view}
                scale={scale}
                rows={rows}
                dropPreview={dropPreview}
                allocationStep={allocationStep}
                onAdjustAllocation={onAdjustAllocation}
              />
              <TodayMarker periods={periods} scale={scale} />
            </div>
          </div>
        </div>
      </div>
      <DailyDistributionTable
        projection={dailyDistribution}
        order={dailyDistributionOrder}
        hierarchyDepth={dailyDistributionDepth}
        onOrderChange={onDailyDistributionOrderChange}
        onHierarchyDepthChange={onDailyDistributionDepthChange}
      />
    </section>
  );
}
