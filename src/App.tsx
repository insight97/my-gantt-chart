import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  buildTaskTree,
  emptyTask,
  taskDeadlineConstraint,
  now,
  partitionProjectTasks,
  validateImport,
  validWorkspaceData,
} from './data';
import {
  getProjectEstimatedHours,
  getTaskAllocatedHours,
  getTaskPendingHours,
  addDays,
  today,
} from './capacity';
import { createEmptyWorkspace, loadWorkspace, migrateWorkspace, saveWorkspace } from './db';
import CapacityGantt from './CapacityGantt';
import { hourValueLabel, priorityLabels } from './formatters';
import TaskCard from './TaskCard';
import { backlogDropRelation, pointerLeftElement, resolveTaskDrop } from './task-drag';
import type {
  TaskDragOrigin,
  TaskDragState,
  TaskDropTarget,
  TaskDropTargetHandler,
} from './task-drag';
import { timelineZoomPreset } from './timeline';
import { CURRENT_WORKSPACE_VERSION } from './types';
import { recurrenceDates, recurrenceRuleError } from './recurrence';
import type {
  Allocation,
  ExportFile,
  Project,
  RecurrenceRule,
  Task,
  TaskPriority,
  TaskStatus,
  ViewMode,
  Weekday,
  WorkspaceData,
} from './types';
import type { TimelineInputMode, TimelineZoom } from './timeline';
import type { TaskTreeIndex } from './task-tree';
import {
  adjustAllocationDay as adjustAllocationDayOperation,
  autoScheduleTask as autoScheduleTaskOperation,
  moveTaskToBacklog as moveTaskToBacklogOperation,
  moveTaskGroupToBacklog as moveTaskGroupToBacklogOperation,
  moveTaskGroupToTimeline as moveTaskGroupToTimelineOperation,
  moveTaskToTimeline as moveTaskToTimelineOperation,
  saveTask as saveTaskOperation,
  scheduleTaskAtDate as scheduleTaskAtDateOperation,
  moveTask as moveTaskOperation,
  syncParentEstimatedHours,
} from './workspace-operations';
import type { WorkspaceOperationResult } from './workspace-operations';

const clone = <T,>(value: T): T => structuredClone(value);
const statusLabels: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  scheduled: '已排程',
  in_progress: '進行中',
  completed: '已完成',
};
const weekdayLabels = ['日', '一', '二', '三', '四', '五', '六'];
const AUTO_SCHEDULE_STORAGE_KEY = 'gantt-auto-schedule';
const ALLOCATION_STEP_STORAGE_KEY = 'gantt-allocation-step';
const ALLOCATION_STEP_OPTIONS = [1, 0.5] as const;
type AllocationStep = (typeof ALLOCATION_STEP_OPTIONS)[number];

function initialAllocationStep(): AllocationStep {
  return localStorage.getItem(ALLOCATION_STEP_STORAGE_KEY) === '0.5' ? 0.5 : 1;
}

function defaultRecurrence(task: Task): RecurrenceRule {
  const startDate = task.start || today();
  const endDate = task.end && task.end >= startDate ? task.end : addDays(startDate, 30);
  const weekday = new Date(`${startDate}T00:00:00.000Z`).getUTCDay() as Weekday;
  return {
    frequency: 'weekly',
    startDate,
    endDate,
    hoursPerOccurrence: 1,
    weekdays: [weekday],
    monthDays: [Number(startDate.slice(-2))],
  };
}

function recurrenceHours(rule: RecurrenceRule | null) {
  if (!rule || recurrenceRuleError(rule)) return null;
  try {
    return recurrenceDates(rule).length * rule.hoursPerOccurrence;
  } catch {
    return null;
  }
}
type TaskEntryPoint = 'backlog' | 'timeline';
type EditingTask = { projectId: string; task: Task; scheduleOnSave: boolean };

function initialTimelineZoom(): TimelineZoom {
  const savedView = localStorage.getItem('gantt-view');
  if (savedView === 'day' || savedView === 'week' || savedView === 'month') {
    const savedPixels = Number(localStorage.getItem('gantt-pixels-per-day'));
    return Number.isFinite(savedPixels) && savedPixels > 0
      ? { view: savedView, pixelsPerDay: savedPixels }
      : timelineZoomPreset(savedView);
  }
  return timelineZoomPreset('week');
}

function initialTimelineInputMode(): TimelineInputMode {
  return localStorage.getItem('gantt-input-mode') === 'mouse' ? 'mouse' : 'trackpad';
}

function initialAutoScheduleEnabled() {
  return localStorage.getItem(AUTO_SCHEDULE_STORAGE_KEY) !== 'false';
}

function sameDropTarget(a: TaskDropTarget | null, b: TaskDropTarget | null) {
  if (!a || !b) return a === b;
  return (
    a.kind === b.kind &&
    a.projectId === b.projectId &&
    a.taskId === b.taskId &&
    a.date === b.date &&
    a.relation === b.relation
  );
}

function workspaceGroupTaskIds(workspace: WorkspaceData) {
  return workspace.projects.flatMap(project => {
    const tree = buildTaskTree(project.tasks);
    return project.tasks.filter(task => tree.hasChildren(task.id)).map(task => task.id);
  });
}

function download(data: string, name: string, type: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([data], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(() => new Set());
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(() => new Set());
  const [expandedBacklogTaskIds, setExpandedBacklogTaskIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [timelineZoom, setTimelineZoom] = useState<TimelineZoom>(initialTimelineZoom);
  const [timelineInputMode, setTimelineInputMode] =
    useState<TimelineInputMode>(initialTimelineInputMode);
  const [autoScheduleEnabled, setAutoScheduleEnabled] = useState(initialAutoScheduleEnabled);
  const [allocationStep, setAllocationStep] = useState<AllocationStep>(initialAllocationStep);
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0);
  const [ready, setReady] = useState(false);
  const [editingTask, setEditingTask] = useState<EditingTask | null>(null);
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<WorkspaceData[]>([]);
  const [future, setFuture] = useState<WorkspaceData[]>([]);
  const [taskDrag, setTaskDrag] = useState<TaskDragState | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const taskDragRef = useRef<TaskDragState | null>(null);
  const taskDropRef = useRef<{ target: TaskDropTarget; element: HTMLElement } | null>(null);
  const dragLayerRef = useRef<HTMLDivElement>(null);
  const suppressTaskClickRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    loadWorkspace()
      .then(value => {
        if (!mounted) return;
        const next = migrateWorkspace(value || createEmptyWorkspace());
        setWorkspace(next);
        setExpandedProjectIds(new Set(next.projects.slice(0, 1).map(item => item.id)));
        const groupTaskIds = new Set(workspaceGroupTaskIds(next));
        setExpandedTaskIds(new Set(groupTaskIds));
        setExpandedBacklogTaskIds(new Set(groupTaskIds));
        setReady(true);
      })
      .catch(() => setNotice('無法開啟瀏覽器本機資料庫。'));
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!workspace || !ready) return;
    const timer = setTimeout(
      () => saveWorkspace(workspace).catch(() => setNotice('自動儲存失敗，請先建立 JSON 備份。')),
      250,
    );
    return () => clearTimeout(timer);
  }, [workspace, ready]);

  const view = timelineZoom.view;
  useEffect(() => {
    localStorage.setItem('gantt-view', timelineZoom.view);
    localStorage.setItem('gantt-pixels-per-day', String(timelineZoom.pixelsPerDay));
  }, [timelineZoom]);
  useEffect(() => {
    localStorage.setItem('gantt-input-mode', timelineInputMode);
  }, [timelineInputMode]);
  useEffect(() => {
    localStorage.setItem(AUTO_SCHEDULE_STORAGE_KEY, String(autoScheduleEnabled));
  }, [autoScheduleEnabled]);
  useEffect(() => {
    localStorage.setItem(ALLOCATION_STEP_STORAGE_KEY, String(allocationStep));
  }, [allocationStep]);

  // One pass over allocations instead of a per-project scan with a nested task lookup.
  const allocationsByProject = useMemo(() => {
    const index = new Map<string, Allocation[]>();
    if (!workspace) return index;
    const projectIdByTask = new Map<string, string>();
    for (const project of workspace.projects) {
      index.set(project.id, []);
      for (const task of project.tasks) projectIdByTask.set(task.id, project.id);
    }
    for (const allocation of workspace.allocations) {
      const projectId = projectIdByTask.get(allocation.taskId);
      if (projectId) index.get(projectId)?.push(allocation);
    }
    return index;
  }, [workspace]);

  const commit = useCallback(
    (next: WorkspaceData) => {
      if (!workspace) return;
      setHistory(items => [...items.slice(-39), clone(workspace)]);
      setFuture([]);
      setWorkspace(next);
    },
    [workspace],
  );
  const commitOperation = useCallback(
    (result: WorkspaceOperationResult) => {
      if (!result.ok) return result.error;
      if (result.changed) commit(result.workspace);
      return null;
    },
    [commit],
  );
  const beginTaskDrag = (
    projectId: string,
    task: Task,
    origin: TaskDragOrigin,
    event: ReactPointerEvent<HTMLElement>,
    allocatedHours = 0,
    pendingHours = 0,
    isGroup = false,
  ) => {
    if (event.button !== 0 || task.status === 'completed') return;
    const next: TaskDragState = {
      projectId,
      task,
      origin,
      isGroup,
      allocatedHours,
      pendingHours,
      x: event.clientX,
      y: event.clientY,
      active: false,
      target: null,
    };
    taskDragRef.current = next;
    taskDropRef.current = null;
    setTaskDrag(next);
  };
  const updateTaskDropTarget: TaskDropTargetHandler = (target, element) => {
    const current = taskDragRef.current;
    if (!current?.active) return;
    const nextTarget = target && element && target.projectId === current.projectId ? target : null;
    taskDropRef.current = nextTarget && element ? { target: nextTarget, element } : null;
    if (sameDropTarget(current.target, nextTarget)) return;
    const next = { ...current, target: nextTarget };
    taskDragRef.current = next;
    setTaskDrag(next);
  };
  const moveTask = useCallback(
    (
      projectId: string,
      sourceTaskId: string,
      targetTaskId: string,
      relation: 'inside' | 'before' | 'after',
      scheduleFromBacklog = false,
    ) => {
      if (!workspace) return;
      const result = scheduleFromBacklog
        ? moveTaskToTimelineOperation(
            workspace,
            projectId,
            sourceTaskId,
            targetTaskId,
            relation,
            autoScheduleEnabled,
          )
        : moveTaskOperation(workspace, projectId, sourceTaskId, targetTaskId, relation);
      if (!result.ok) setNotice(result.error);
      else if (result.changed) {
        commit(result.workspace);
        if (relation === 'inside') {
          setExpandedTaskIds(ids => new Set([...ids, targetTaskId]));
          setExpandedBacklogTaskIds(ids => new Set([...ids, targetTaskId]));
        }
      }
    },
    [workspace, commit, autoScheduleEnabled],
  );
  const undo = () => {
    if (!workspace || !history.length) return;
    const previous = history.at(-1)!;
    setFuture(items => [clone(workspace), ...items]);
    setHistory(items => items.slice(0, -1));
    setWorkspace(previous);
  };
  const redo = () => {
    if (!workspace || !future.length) return;
    const next = future[0];
    setHistory(items => [...items, clone(workspace)]);
    setFuture(items => items.slice(1));
    setWorkspace(next);
  };

  const addProject = () => {
    if (!workspace) return;
    const project = workspace.projects[0] || {
      id: 'workspace-root',
      name: '工作項目',
      description: '',
      createdAt: now(),
      updatedAt: now(),
      tasks: [],
    };
    if (!workspace.projects.length) commit({ ...workspace, projects: [project] });
    const task = emptyTask();
    setEditingTask({ projectId: project.id, task, scheduleOnSave: false });
  };

  const addTask = (
    projectId: string,
    entryPoint: TaskEntryPoint = 'backlog',
    parentId: string | null = null,
  ) => {
    if (!workspace || !workspace.projects.some(project => project.id === projectId)) return;
    const project = workspace.projects.find(item => item.id === projectId)!;
    const task = emptyTask();
    task.parentId = parentId;
    task.order = project.tasks.filter(item => (item.parentId ?? null) === parentId).length;
    if (parentId) task.deadline = taskDeadlineConstraint(project.tasks, parentId);
    if (entryPoint === 'timeline') task.status = 'scheduled';
    setEditingTask({
      projectId,
      task,
      scheduleOnSave: entryPoint === 'timeline' && autoScheduleEnabled,
    });
  };

  const addChildTask = (
    projectId: string,
    parent: Task,
    entryPoint: TaskEntryPoint = 'backlog',
  ) => {
    if (!workspace) return;
    const project = workspace.projects.find(item => item.id === projectId);
    if (!project) return;
    if (parent.status === 'completed') {
      setNotice('已完成工作不可新增子任務。');
      return;
    }
    if (buildTaskTree(project.tasks).depth(parent.id) >= 3) {
      setNotice('任務階層最多三層。');
      return;
    }
    addTask(projectId, entryPoint, parent.id);
    setExpandedTaskIds(ids => new Set([...ids, parent.id]));
    setExpandedBacklogTaskIds(ids => new Set([...ids, parent.id]));
  };

  const saveTask = (
    projectId: string,
    draft: Task,
    scheduleOnSave = false,
    applyRecurrence = false,
  ): string | null => {
    if (!workspace) return '目前沒有可編輯的工作區。';
    if (scheduleOnSave) {
      const result = autoScheduleTaskOperation(workspace, projectId, draft.id, draft);
      if (!result.ok) return result.error;
      if (!result.changed) return 'Timeline Task 無法自動排程。';
      commit(result.workspace);
      if (draft.parentId) {
        setExpandedTaskIds(ids => new Set([...ids, draft.parentId!]));
        setExpandedBacklogTaskIds(ids => new Set([...ids, draft.parentId!]));
      }
      setEditingTask(null);
      return null;
    }
    const error = commitOperation(
      saveTaskOperation(workspace, projectId, draft, { applyRecurrence }),
    );
    if (error) return error;
    if (draft.parentId) {
      setExpandedTaskIds(ids => new Set([...ids, draft.parentId!]));
      setExpandedBacklogTaskIds(ids => new Set([...ids, draft.parentId!]));
    }
    setEditingTask(null);
    return null;
  };

  const autoScheduleTask = (projectId: string, taskId: string, draft?: Task): boolean => {
    if (!workspace) return false;
    const result = autoScheduleTaskOperation(workspace, projectId, taskId, draft);
    if (!result.ok) {
      setNotice(result.error);
      return false;
    }
    if (!result.changed) return false;
    commit(result.workspace);
    return true;
  };

  const adjustAllocationDay = (
    projectId: string,
    taskId: string,
    date: string,
    delta: number,
  ): string | null => {
    if (!workspace) return '目前沒有可編輯的工作區。';
    return commitOperation(adjustAllocationDayOperation(workspace, projectId, taskId, date, delta));
  };

  const scheduleTaskAtDate = useCallback(
    (projectId: string, taskId: string, date: string, autoSchedule = true) => {
      if (!workspace) return;
      const result = scheduleTaskAtDateOperation(
        workspace,
        projectId,
        taskId,
        date,
        true,
        autoSchedule,
      );
      if (!result.ok) setNotice(result.error);
      else if (result.changed) commit(result.workspace);
    },
    [workspace, commit],
  );

  const moveTaskToBacklog = useCallback(
    (projectId: string, taskId: string, targetTaskId?: string, relation?: 'before' | 'after') => {
      if (!workspace) return;
      const result = moveTaskToBacklogOperation(
        workspace,
        projectId,
        taskId,
        targetTaskId,
        relation,
      );
      if (!result.ok) setNotice(result.error);
      else if (result.changed) commit(result.workspace);
    },
    [workspace, commit],
  );
  const moveTaskGroupToTimeline = useCallback(
    (projectId: string, groupId: string, date: string) => {
      if (!workspace) return;
      const result = moveTaskGroupToTimelineOperation(
        workspace,
        projectId,
        groupId,
        date,
        autoScheduleEnabled,
      );
      if (!result.ok) setNotice(result.error);
      else if (result.changed) commit(result.workspace);
    },
    [workspace, commit, autoScheduleEnabled],
  );
  const moveTaskGroupToBacklog = useCallback(
    (projectId: string, groupId: string) => {
      if (!workspace) return;
      const result = moveTaskGroupToBacklogOperation(workspace, projectId, groupId);
      if (!result.ok) setNotice(result.error);
      else if (result.changed) commit(result.workspace);
    },
    [workspace, commit],
  );

  const hasTaskDrag = taskDrag !== null;
  useEffect(() => {
    if (!hasTaskDrag) return;
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const current = taskDragRef.current;
      if (!current) return;
      if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5)
        return;
      current.x = event.clientX;
      current.y = event.clientY;
      // Position the ghost straight from the ref; re-rendering every project per pointer event is far too costly.
      const layer = dragLayerRef.current;
      if (layer) {
        layer.style.left = `${current.x + 12}px`;
        layer.style.top = `${current.y + 12}px`;
      }
      if (current.active) return;
      current.active = true;
      setTaskDrag({ ...current });
    };
    const handlePointerUp = (event: globalThis.PointerEvent) => {
      const current = taskDragRef.current;
      if (!current) return;
      if (!current.active) {
        taskDragRef.current = null;
        taskDropRef.current = null;
        setTaskDrag(null);
        return;
      }
      const tracked = taskDropRef.current;
      const hit =
        typeof document.elementFromPoint === 'function'
          ? document.elementFromPoint(event.clientX, event.clientY)
          : null;
      const target = tracked && (!hit || tracked.element.contains(hit)) ? tracked.target : null;
      const command = resolveTaskDrop(current, target, today());
      if (command) {
        switch (command.type) {
          case 'move-group-to-backlog':
            moveTaskGroupToBacklog(command.projectId, command.groupId);
            break;
          case 'move-group-to-timeline':
            moveTaskGroupToTimeline(command.projectId, command.groupId, command.date);
            break;
          case 'move-task-to-backlog':
            moveTaskToBacklog(
              command.projectId,
              command.taskId,
              command.targetTaskId,
              command.relation,
            );
            break;
          case 'move-task':
            moveTask(
              command.projectId,
              command.sourceTaskId,
              command.targetTaskId,
              command.relation,
              command.scheduleFromBacklog,
            );
            break;
          case 'schedule-task':
            scheduleTaskAtDate(
              command.projectId,
              command.taskId,
              command.date,
              current.origin === 'gantt' || autoScheduleEnabled,
            );
            break;
        }
      }
      suppressTaskClickRef.current = true;
      setTimeout(() => {
        suppressTaskClickRef.current = false;
      }, 0);
      taskDragRef.current = null;
      taskDropRef.current = null;
      setTaskDrag(null);
    };
    const handlePointerCancel = () => {
      taskDragRef.current = null;
      taskDropRef.current = null;
      setTaskDrag(null);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [
    hasTaskDrag,
    moveTaskGroupToBacklog,
    moveTaskGroupToTimeline,
    moveTaskToBacklog,
    moveTask,
    scheduleTaskAtDate,
    autoScheduleEnabled,
  ]);

  const deleteTask = (projectId: string, taskId: string) => {
    if (!workspace || !confirm('確定刪除這個 Task 及其 Allocation？')) return;
    const project = workspace.projects.find(item => item.id === projectId);
    if (!project) return;
    const removedIds = buildTaskTree(project.tasks).descendants(taskId);
    removedIds.add(taskId);
    commit(
      syncParentEstimatedHours(
        {
          ...workspace,
          projects: workspace.projects.map(item => {
            if (item.id !== project.id) return item;
            const removedIds = buildTaskTree(item.tasks).descendants(taskId);
            removedIds.add(taskId);
            return {
              ...item,
              tasks: item.tasks.filter(task => !removedIds.has(task.id)),
              updatedAt: now(),
            };
          }),
          allocations: workspace.allocations.filter(
            allocation => !removedIds.has(allocation.taskId),
          ),
        },
        project.id,
      ),
    );
  };

  const exportJson = () => {
    if (!workspace) return;
    const file: ExportFile = {
      schema: 'gantt-capacity-local',
      version: CURRENT_WORKSPACE_VERSION,
      exportedAt: now(),
      projects: workspace.projects,
      allocations: workspace.allocations,
    };
    download(JSON.stringify(file, null, 2), 'capacity-gantt-backup.json', 'application/json');
    setNotice('JSON 備份已下載。');
  };

  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const raw: unknown = JSON.parse(await file.text());
      if (!validateImport(raw)) throw new Error('檔案格式或版本不正確。');
      const migrated = migrateWorkspace(raw);
      if (!validWorkspaceData(migrated)) throw new Error('檔案格式或版本不正確。');
      if (!confirm('匯入會取代目前工作區。請先確認已建立備份。')) return;
      commit(migrated);
      setExpandedProjectIds(new Set(migrated.projects.slice(0, 1).map(item => item.id)));
      const groupTaskIds = new Set(workspaceGroupTaskIds(migrated));
      setExpandedTaskIds(new Set(groupTaskIds));
      setExpandedBacklogTaskIds(new Set(groupTaskIds));
      setNotice('匯入完成。');
    } catch (error) {
      setNotice(error instanceof Error ? `匯入失敗：${error.message}` : '匯入失敗。');
    }
  };

  if (!ready || !workspace) return <main className="loading">正在開啟本機工作區…</main>;

  const expandableTaskIds = workspaceGroupTaskIds(workspace);
  const allExpanded =
    expandableTaskIds.length > 0 &&
    expandableTaskIds.every(
      taskId => expandedTaskIds.has(taskId) && expandedBacklogTaskIds.has(taskId),
    );
  const expandAll = () => {
    setExpandedTaskIds(new Set(expandableTaskIds));
    setExpandedBacklogTaskIds(new Set(expandableTaskIds));
  };
  const collapseAll = () => {
    setExpandedTaskIds(new Set());
    setExpandedBacklogTaskIds(new Set());
  };
  const editingProject =
    editingTask && workspace.projects.find(project => project.id === editingTask.projectId);
  const editingTaskTree = editingProject ? buildTaskTree(editingProject.tasks) : null;
  const editTask = (projectId: string, task: Task) => {
    if (task.status === 'completed') {
      setNotice('已完成 Task 不可修改。');
      return;
    }
    setEditingTask({ projectId, task, scheduleOnSave: false });
  };
  return (
    <div
      className="app"
      onClickCapture={event => {
        if (!suppressTaskClickRef.current) return;
        const target = event.target instanceof Element ? event.target : null;
        if (!target?.closest('.task-card')) return;
        event.preventDefault();
        event.stopPropagation();
        suppressTaskClickRef.current = false;
      }}
    >
      <header>
        <div className="brand">
          <span className="brandmark">容</span>
          <div>
            <b>Capacity Allocation</b>
            <small>本機容量工作台</small>
          </div>
        </div>
        <div className="header-actions">
          <button onClick={undo} disabled={!history.length}>
            復原
          </button>
          <button onClick={redo} disabled={!future.length}>
            重做
          </button>
          <button onClick={exportJson}>建立備份</button>
          <button onClick={() => fileRef.current?.click()}>匯入</button>
          <input ref={fileRef} hidden type="file" accept="application/json" onChange={importJson} />
        </div>
      </header>
      <div className="local-note">
        <b>資料只儲存在這台裝置</b>
        <span>請定期建立 JSON 備份。</span>
      </div>
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button aria-label="關閉通知" onClick={() => setNotice('')}>
            ×
          </button>
        </div>
      )}
      <main>
        <section className="project-list">
          <div className="project-list-toolbar">
            <div>
              <h1>工作項目</h1>
              <p>所有工作項目使用同一種階層物件；根項目沒有父項目，最多三層</p>
            </div>
            <div className="project-list-actions">
              <label className="auto-schedule-switch">
                <input
                  type="checkbox"
                  aria-label="拖入或新增時自動排程"
                  checked={autoScheduleEnabled}
                  onChange={event => setAutoScheduleEnabled(event.target.checked)}
                />
                <span>拖入或新增時自動排程</span>
              </label>
              <label className="allocation-step-switch">
                <span>每日調整</span>
                <select
                  aria-label="每日 Allocation 調整步進"
                  value={allocationStep}
                  onChange={event =>
                    setAllocationStep(Number(event.target.value) as AllocationStep)
                  }
                >
                  {ALLOCATION_STEP_OPTIONS.map(step => (
                    <option key={step} value={step}>
                      {hourValueLabel(step)} 小時
                    </option>
                  ))}
                </select>
              </label>
              <div className="input-mode-switch" role="group" aria-label="時間軸操作模式">
                <span>時間軸操作</span>
                <div className="mode-switch">
                  <button
                    className={timelineInputMode === 'trackpad' ? 'active' : ''}
                    aria-pressed={timelineInputMode === 'trackpad'}
                    onClick={() => setTimelineInputMode('trackpad')}
                  >
                    觸控板
                  </button>
                  <button
                    className={timelineInputMode === 'mouse' ? 'active' : ''}
                    aria-pressed={timelineInputMode === 'mouse'}
                    onClick={() => setTimelineInputMode('mouse')}
                  >
                    滑鼠
                  </button>
                </div>
              </div>
              <button
                onClick={allExpanded ? collapseAll : expandAll}
                disabled={!expandableTaskIds.length}
              >
                {allExpanded ? '全部收合' : '全部展開'}
              </button>
              <button className="primary" onClick={addProject}>
                ＋ 新增工作項目
              </button>
            </div>
          </div>
          {workspace.projects.length === 0 ? (
            <div className="empty-projects">
              <p>目前還沒有工作項目。</p>
              <button className="primary" onClick={addProject}>
                ＋ 建立第一個工作項目
              </button>
            </div>
          ) : (
            <div className="project-panels">
              {workspace.projects.map(project => (
                <ProjectPanel
                  key={project.id}
                  project={project}
                  allocations={allocationsByProject.get(project.id) || []}
                  allAllocations={workspace.allocations}
                  view={view}
                  timelineZoom={timelineZoom}
                  timelineInputMode={timelineInputMode}
                  autoScheduleEnabled={autoScheduleEnabled}
                  allocationStep={allocationStep}
                  timelineScrollLeft={timelineScrollLeft}
                  taskDrag={taskDrag}
                  expandedTaskIds={expandedTaskIds}
                  expandedBacklogTaskIds={expandedBacklogTaskIds}
                  expanded={expandedProjectIds.has(project.id)}
                  onAddTask={() => addTask(project.id, 'backlog')}
                  onAddTimelineTask={() => addTask(project.id, 'timeline')}
                  onAddChild={(task, entryPoint) => addChildTask(project.id, task, entryPoint)}
                  onEditTask={task => editTask(project.id, task)}
                  onBeginTaskDrag={beginTaskDrag}
                  onTaskDropTarget={updateTaskDropTarget}
                  onAdjustAllocation={(taskId, date, delta) => {
                    const error = adjustAllocationDay(project.id, taskId, date, delta);
                    if (error) setNotice(error);
                  }}
                  onDeleteTask={taskId => deleteTask(project.id, taskId)}
                  onToggleTask={taskId =>
                    setExpandedTaskIds(ids => {
                      const next = new Set(ids);
                      if (next.has(taskId)) next.delete(taskId);
                      else next.add(taskId);
                      return next;
                    })
                  }
                  onToggleBacklogTask={taskId =>
                    setExpandedBacklogTaskIds(ids => {
                      const next = new Set(ids);
                      if (next.has(taskId)) next.delete(taskId);
                      else next.add(taskId);
                      return next;
                    })
                  }
                  onViewChange={value => setTimelineZoom(timelineZoomPreset(value))}
                  onZoomChange={setTimelineZoom}
                  onTimelineScroll={setTimelineScrollLeft}
                />
              ))}
            </div>
          )}
        </section>
      </main>
      {taskDrag?.active && (
        <div
          className="task-drag-layer"
          ref={dragLayerRef}
          style={{ left: taskDrag.x + 12, top: taskDrag.y + 12 }}
        >
          <TaskCard
            task={taskDrag.task}
            variant={taskDrag.origin}
            allocatedHours={taskDrag.allocatedHours}
            pendingHours={taskDrag.pendingHours}
            isGhost
          />
        </div>
      )}
      {editingTask && editingProject && (
        <TaskDialog
          task={editingTask.task}
          tasks={editingProject.tasks}
          allocations={workspace.allocations.filter(
            allocation => allocation.taskId === editingTask.task.id,
          )}
          hasChildren={editingTaskTree?.hasChildren(editingTask.task.id) ?? false}
          scheduleOnSave={editingTask.scheduleOnSave}
          onClose={() => setEditingTask(null)}
          onSave={task => saveTask(editingTask.projectId, task, editingTask.scheduleOnSave)}
          onAutoSchedule={draft => {
            if (autoScheduleTask(editingTask.projectId, editingTask.task.id, draft))
              setEditingTask(null);
          }}
          onApplyRecurrence={draft =>
            saveTask(editingTask.projectId, draft, editingTask.scheduleOnSave, true)
          }
        />
      )}
      <footer>
        Capacity Allocation · 所有資料皆留在您的瀏覽器 ·{' '}
        <button onClick={exportJson}>立即備份</button>
      </footer>
    </div>
  );
}

type ProjectPanelProps = {
  project: Project;
  allocations: Allocation[];
  allAllocations: Allocation[];
  view: ViewMode;
  timelineZoom: TimelineZoom;
  timelineInputMode: TimelineInputMode;
  autoScheduleEnabled: boolean;
  allocationStep: AllocationStep;
  timelineScrollLeft: number;
  taskDrag: TaskDragState | null;
  expandedTaskIds: Set<string>;
  expandedBacklogTaskIds: Set<string>;
  expanded: boolean;
  onAddTask: () => void;
  onAddTimelineTask: () => void;
  onAddChild: (task: Task, entryPoint: TaskEntryPoint) => void;
  onEditTask: (task: Task) => void;
  onBeginTaskDrag: (
    projectId: string,
    task: Task,
    origin: TaskDragOrigin,
    event: ReactPointerEvent<HTMLElement>,
    allocatedHours?: number,
    pendingHours?: number,
    isGroup?: boolean,
  ) => void;
  onTaskDropTarget: TaskDropTargetHandler;
  onAdjustAllocation: (taskId: string, date: string, delta: number) => void;
  onDeleteTask: (taskId: string) => void;
  onToggleTask: (taskId: string) => void;
  onToggleBacklogTask: (taskId: string) => void;
  onViewChange: (view: ViewMode) => void;
  onZoomChange: (next: TimelineZoom) => void;
  onTimelineScroll: (left: number) => void;
};

function ProjectPanel({
  project,
  allocations,
  allAllocations,
  view,
  timelineZoom,
  timelineInputMode,
  autoScheduleEnabled,
  allocationStep,
  timelineScrollLeft,
  taskDrag,
  expandedTaskIds,
  expandedBacklogTaskIds,
  expanded,
  onAddTask,
  onAddTimelineTask,
  onAddChild,
  onEditTask,
  onBeginTaskDrag,
  onTaskDropTarget,
  onAdjustAllocation,
  onDeleteTask,
  onToggleTask,
  onToggleBacklogTask,
  onViewChange,
  onZoomChange,
  onTimelineScroll,
}: ProjectPanelProps) {
  const taskTree = useMemo(() => buildTaskTree(project.tasks), [project.tasks]);
  const { backlog: backlogTasks, scheduled: scheduledTasks } = partitionProjectTasks(
    project,
    expandedTaskIds,
    taskTree,
    expandedBacklogTaskIds,
  );
  return (
    <article className={`project-card workspace-card${expanded ? ' expanded' : ' collapsed'}`}>
      {expanded && (
        <div className="project-card-content">
          <div className="workspace-title">
            <div>
              <h2>工作項目</h2>
              <p>
                {project.tasks.length} 個項目 · 預估{' '}
                {hourValueLabel(getProjectEstimatedHours(project))} 小時
              </p>
            </div>
            <div className="view-switch" aria-label="工作項目時間檢視">
              {(['day', 'week', 'month'] as const).map(value => (
                <button
                  key={value}
                  className={view === value ? 'active' : ''}
                  onClick={() => onViewChange(value)}
                >
                  {value === 'day' ? '日' : value === 'week' ? '週' : '月'}
                </button>
              ))}
            </div>
          </div>
          <div className="planning-layout">
            <Backlog
              projectId={project.id}
              tasks={backlogTasks}
              allTasks={project.tasks}
              taskTree={taskTree}
              expandedTaskIds={expandedBacklogTaskIds}
              taskDrag={taskDrag}
              draggingTaskId={
                taskDrag?.projectId === project.id && taskDrag.active ? taskDrag.task.id : null
              }
              onEdit={onEditTask}
              onAddTask={onAddTask}
              onDelete={onDeleteTask}
              onAddChild={task => onAddChild(task, 'backlog')}
              onTaskPointerDown={(task, event, isGroup) =>
                onBeginTaskDrag(project.id, task, 'backlog', event, 0, 0, isGroup)
              }
              onTaskDropTarget={onTaskDropTarget}
              onToggleTask={onToggleBacklogTask}
            />
            <CapacityGantt
              projectId={project.id}
              tasks={scheduledTasks}
              allTasks={project.tasks}
              taskTree={taskTree}
              expandedTaskIds={expandedTaskIds}
              backlogTasks={backlogTasks}
              allocations={allocations}
              allAllocations={allAllocations}
              timelineZoom={timelineZoom}
              timelineInputMode={timelineInputMode}
              autoScheduleEnabled={autoScheduleEnabled}
              allocationStep={allocationStep}
              scrollLeft={timelineScrollLeft}
              taskDrag={taskDrag}
              onZoomChange={onZoomChange}
              onEdit={onEditTask}
              onAddTask={onAddTimelineTask}
              onBeginTaskDrag={(task, event, allocatedHours, pendingHours, isGroup) =>
                onBeginTaskDrag(
                  project.id,
                  task,
                  'gantt',
                  event,
                  allocatedHours,
                  pendingHours,
                  isGroup,
                )
              }
              onTaskDropTarget={onTaskDropTarget}
              onAdjustAllocation={onAdjustAllocation}
              onDelete={onDeleteTask}
              onAddChild={task => onAddChild(task, 'timeline')}
              onToggleTask={onToggleTask}
              onTimelineScroll={onTimelineScroll}
            />
          </div>
        </div>
      )}
    </article>
  );
}

function Backlog({
  projectId,
  tasks,
  allTasks,
  taskTree,
  expandedTaskIds,
  taskDrag,
  draggingTaskId,
  onEdit,
  onAddTask,
  onDelete,
  onAddChild,
  onTaskPointerDown,
  onTaskDropTarget,
  onToggleTask,
}: {
  projectId: string;
  tasks: Task[];
  allTasks: Task[];
  taskTree: TaskTreeIndex;
  expandedTaskIds: Set<string>;
  taskDrag: TaskDragState | null;
  draggingTaskId: string | null;
  onEdit: (task: Task) => void;
  onAddTask: () => void;
  onDelete: (taskId: string) => void;
  onAddChild: (task: Task) => void;
  onTaskPointerDown: (task: Task, event: ReactPointerEvent<HTMLElement>, isGroup?: boolean) => void;
  onTaskDropTarget: TaskDropTargetHandler;
  onToggleTask: (taskId: string) => void;
}) {
  const handleTaskPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('.backlog-drop-row'))
      onTaskDropTarget({ kind: 'backlog', projectId }, event.currentTarget);
  };
  const handleTaskPointerLeave = (event: ReactPointerEvent<HTMLElement>) => {
    if (pointerLeftElement(event)) onTaskDropTarget(null);
  };
  const renderTask = (task: Task) => {
    const isGroup = taskTree.hasChildren(task.id);
    const dropRelation =
      taskDrag?.projectId === projectId &&
      taskDrag.target?.kind === 'backlog' &&
      taskDrag.target.taskId === task.id
        ? taskDrag.target.relation
        : undefined;
    const handleRowPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      onTaskDropTarget(
        {
          kind: 'backlog',
          projectId,
          taskId: task.id,
          relation: backlogDropRelation(event.clientY - bounds.top, bounds.height),
        },
        event.currentTarget,
      );
    };
    return (
      <div
        className={`backlog-drop-row${dropRelation ? ` drop-target-${dropRelation}` : ''}`}
        key={task.id}
        onPointerMove={handleRowPointerMove}
        onPointerLeave={handleTaskPointerLeave}
      >
        <TaskCard
          task={task}
          variant="backlog"
          isDragging={draggingTaskId === task.id}
          onEdit={onEdit}
          onDelete={onDelete}
          hasChildren={isGroup}
          isGroup={isGroup}
          depth={taskTree.depth(task.id)}
          expanded={expandedTaskIds.has(task.id)}
          onToggle={isGroup ? item => onToggleTask(item.id) : undefined}
          onAddChild={task => onAddChild(task)}
          onPointerDown={event => onTaskPointerDown(task, event, isGroup)}
        />
      </div>
    );
  };
  return (
    <aside
      className="backlog"
      onPointerMove={handleTaskPointerMove}
      onPointerLeave={handleTaskPointerLeave}
    >
      <div className="section-heading">
        <div>
          <h2>Backlog</h2>
          <small>
            {
              allTasks.filter(task => !taskTree.hasChildren(task.id) && task.status === 'backlog')
                .length
            }{' '}
            個待排程 Task
          </small>
        </div>
      </div>
      {tasks.length === 0 && (
        <div className="empty">把 Timeline Task 拖回這裡，或從下方新增 Task。</div>
      )}
      <div className="backlog-list">
        {tasks.map(renderTask)}
        <button
          className="add-task-row"
          type="button"
          aria-label="Backlog 新增 Task"
          onClick={onAddTask}
        >
          ＋ 新增 Task
        </button>
      </div>
    </aside>
  );
}

function TaskDialog({
  task,
  tasks,
  allocations,
  hasChildren,
  scheduleOnSave,
  onClose,
  onSave,
  onAutoSchedule,
  onApplyRecurrence,
}: {
  task: Task;
  tasks: Task[];
  allocations: Allocation[];
  hasChildren: boolean;
  scheduleOnSave: boolean;
  onClose: () => void;
  onSave: (task: Task) => string | null;
  onAutoSchedule: (task: Task) => void;
  onApplyRecurrence: (task: Task) => string | null;
}) {
  const [draft, setDraft] = useState(task);
  const [error, setError] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const taskTree = useMemo(() => buildTaskTree(tasks), [tasks]);
  const descendantIds = taskTree.descendants(task.id);
  const parentOptions = tasks.filter(
    candidate =>
      candidate.id !== task.id &&
      candidate.status !== 'completed' &&
      !descendantIds.has(candidate.id) &&
      taskTree.depth(candidate.id) < 3,
  );
  const recurrence = draft.recurrence ?? null;
  const recurrenceError = recurrence ? recurrenceRuleError(recurrence) : null;
  const recurrenceOccurrenceHours = recurrenceHours(recurrence);
  const hasRecurringAllocations = allocations.some(
    allocation => allocation.recurrenceId === task.id,
  );
  useLayoutEffect(() => {
    nameInputRef.current?.focus();
  }, []);
  const draftForSave = () => ({
    ...draft,
    estimatedHours: recurrenceOccurrenceHours ?? Number(draft.estimatedHours),
  });
  const saveDraft = () => {
    const result = onSave(draftForSave());
    if (result) setError(result);
    else setError('');
  };
  const updateRecurrence = (changes: Partial<RecurrenceRule>) => {
    setDraft(current => ({
      ...current,
      recurrence: {
        ...(current.recurrence ?? defaultRecurrence(current)),
        ...changes,
      },
    }));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    saveDraft();
  };
  return createPortal(
    <div
      className="modal"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) saveDraft();
      }}
    >
      <form className="dialog" role="dialog" aria-modal="true" onSubmit={submit}>
        <div className="dialog-head">
          <div>
            <small>Task 詳細資料</small>
            <h2>{task.name === '新工作' ? '新增 Task' : '編輯 Task'}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </div>
        <label>
          Task 名稱
          <input
            ref={nameInputRef}
            autoFocus
            required
            value={draft.name}
            onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
          />
        </label>
        <div className="form-grid">
          <label>
            父節點
            <select
              value={draft.parentId || ''}
              onChange={event =>
                setDraft(current => ({ ...current, parentId: event.target.value || null }))
              }
            >
              <option value="">無（根項目）</option>
              {parentOptions.map(parent => (
                <option key={parent.id} value={parent.id}>
                  {'　'.repeat(Math.max(0, taskTree.depth(parent.id) - 1))}
                  {parent.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            優先順序
            <select
              value={draft.priority}
              onChange={event =>
                setDraft(current => ({ ...current, priority: event.target.value as TaskPriority }))
              }
            >
              {Object.entries(priorityLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            預估工時
            <input
              type="number"
              min="0"
              step="0.5"
              readOnly={Boolean(recurrence)}
              value={recurrenceOccurrenceHours ?? draft.estimatedHours}
              onChange={event =>
                setDraft(current => ({ ...current, estimatedHours: Number(event.target.value) }))
              }
            />
          </label>
          <label>
            截止日期
            <input
              type="date"
              value={draft.deadline || ''}
              onChange={event =>
                setDraft(current => ({ ...current, deadline: event.target.value || null }))
              }
            />
          </label>
          <label>
            狀態
            <select
              value={draft.status}
              onChange={event =>
                setDraft(current => ({ ...current, status: event.target.value as TaskStatus }))
              }
            >
              {Object.entries(statusLabels)
                .filter(([value]) => !hasChildren || value !== 'completed')
                .map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {!hasChildren && (
          <fieldset className="recurrence-settings">
            <legend>重複排程</legend>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={Boolean(recurrence)}
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    recurrence: event.target.checked
                      ? (current.recurrence ?? defaultRecurrence(current))
                      : null,
                  }))
                }
              />
              啟用重複排程
            </label>
            {recurrence && (
              <div className="recurrence-fields">
                <label>
                  頻率
                  <select
                    value={recurrence.frequency}
                    onChange={event =>
                      updateRecurrence({
                        frequency: event.target.value as RecurrenceRule['frequency'],
                      })
                    }
                  >
                    <option value="daily">每天</option>
                    <option value="weekly">每週</option>
                    <option value="monthly">每月</option>
                  </select>
                </label>
                <label>
                  開始日期
                  <input
                    type="date"
                    value={recurrence.startDate}
                    onChange={event => updateRecurrence({ startDate: event.target.value })}
                  />
                </label>
                <label>
                  結束日期
                  <input
                    type="date"
                    value={recurrence.endDate}
                    onChange={event => updateRecurrence({ endDate: event.target.value })}
                  />
                </label>
                <label>
                  每次時數
                  <input
                    type="number"
                    min="0.25"
                    step="0.25"
                    value={recurrence.hoursPerOccurrence}
                    onChange={event =>
                      updateRecurrence({ hoursPerOccurrence: Number(event.target.value) })
                    }
                  />
                </label>
                {recurrence.frequency === 'weekly' && (
                  <div className="recurrence-choice-group">
                    <span>星期</span>
                    <div className="recurrence-weekdays">
                      {weekdayLabels.map((label, weekday) => (
                        <label key={label} className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={recurrence.weekdays.includes(weekday as Weekday)}
                            onChange={event => {
                              const value = weekday as Weekday;
                              const weekdays = event.target.checked
                                ? [...new Set([...recurrence.weekdays, value])].sort()
                                : recurrence.weekdays.filter(item => item !== value);
                              updateRecurrence({ weekdays });
                            }}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {recurrence.frequency === 'monthly' && (
                  <label>
                    每月日期
                    <select
                      multiple
                      size={4}
                      value={recurrence.monthDays.map(String)}
                      onChange={event =>
                        updateRecurrence({
                          monthDays: [...event.target.selectedOptions].map(option =>
                            Number(option.value),
                          ),
                        })
                      }
                    >
                      {Array.from({ length: 31 }, (_, index) => index + 1).map(day => (
                        <option key={day} value={day}>
                          {day} 日
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <p className="form-hint recurrence-hint">
                  {recurrenceError
                    ? recurrenceError
                    : recurrenceOccurrenceHours === null
                      ? '重複排程範圍過大，請縮短日期範圍。'
                      : `共 ${Math.round(recurrenceOccurrenceHours / recurrence.hoursPerOccurrence)} 次、${hourValueLabel(recurrenceOccurrenceHours)}。儲存只保存規則；按「套用重複排程」才會建立或更新 Allocation。`}
                </p>
              </div>
            )}
          </fieldset>
        )}
        <label>
          備註
          <textarea
            rows={3}
            value={draft.notes}
            onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))}
          />
        </label>
        <p className="form-hint">
          {hasChildren
            ? '此父任務的截止日期會限制整個子樹；預估工時與 Allocation 由子任務彙總。'
            : allocations.length
              ? `目前已分配 ${hourValueLabel(getTaskAllocatedHours(task.id, allocations))} 小時，待安排 ${hourValueLabel(getTaskPendingHours(task, allocations))} 小時。儲存 metadata 不會改變 Allocation。`
              : scheduleOnSave
                ? '儲存此 Timeline Task 時會自動建立 Allocation。'
                : '尚未產生 Allocation；按下自動排程或拖入 Allocation Timeline 後才會建立。'}
        </p>
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          {task.status !== 'completed' && (
            <button
              type="button"
              onClick={() =>
                onAutoSchedule({ ...draft, estimatedHours: Number(draft.estimatedHours) })
              }
            >
              自動排程
            </button>
          )}
          {!scheduleOnSave &&
            !hasChildren &&
            draft.status !== 'completed' &&
            (recurrence || hasRecurringAllocations) && (
              <button
                type="button"
                onClick={() => {
                  const result = onApplyRecurrence(draftForSave());
                  if (result) setError(result);
                  else setError('');
                }}
              >
                {recurrence ? '套用重複排程' : '清除重複排程'}
              </button>
            )}
          <button className="primary" type="submit">
            儲存
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
