import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  emptyTask,
  now,
  partitionProjectTasks,
  uid,
  validateImport,
  validWorkspaceData,
} from './data';
import {
  adjustAllocationDay as adjustAllocationDayEngine,
  capacityAvailableHours,
  getDailyCapacity,
  getProjectEstimatedHours,
  getTaskAllocatedHours,
  getTaskPendingHours,
  returnTaskToBacklog,
  scheduleTaskAt,
  today,
} from './capacity';
import { createEmptyWorkspace, loadWorkspace, migrateWorkspace, saveWorkspace } from './db';
import CapacityGantt from './CapacityGantt';
import { hourValueLabel, hoursLabel, priorityLabels, weekdayDateLabel } from './formatters';
import TaskCard from './TaskCard';
import { pointerLeftElement } from './task-drag';
import type {
  TaskDragOrigin,
  TaskDragState,
  TaskDropTarget,
  TaskDropTargetHandler,
} from './task-drag';
import { timelineZoomPreset } from './timeline';
import { CURRENT_WORKSPACE_VERSION } from './types';
import type {
  Allocation,
  DailyCapacity,
  ExportFile,
  Project,
  Task,
  TaskPriority,
  TaskStatus,
  ViewMode,
  WorkspaceData,
} from './types';
import type { TimelineZoom } from './timeline';

const clone = <T,>(value: T): T => structuredClone(value);
const statusLabels: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  scheduled: '已排程',
  in_progress: '進行中',
  completed: '已完成',
};
type EditingTask = { projectId: string; task: Task };

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

function sameDropTarget(a: TaskDropTarget | null, b: TaskDropTarget | null) {
  if (!a || !b) return a === b;
  return (
    a.kind === b.kind && a.projectId === b.projectId && a.taskId === b.taskId && a.date === b.date
  );
}

function replaceTaskAndAllocations(
  workspace: WorkspaceData,
  projectId: string,
  task: Task,
  taskAllocations?: Allocation[],
  moveTaskToEnd = false,
): WorkspaceData {
  const replacementAllocations = taskAllocations?.filter(item => item.taskId === task.id);
  return {
    ...workspace,
    projects: workspace.projects.map(project =>
      project.id === projectId
        ? {
            ...project,
            tasks: moveTaskToEnd
              ? [...project.tasks.filter(value => value.id !== task.id), task]
              : project.tasks.some(value => value.id === task.id)
                ? project.tasks.map(value => (value.id === task.id ? task : value))
                : [...project.tasks, task],
            updatedAt: now(),
          }
        : project,
    ),
    allocations: replacementAllocations
      ? [
          ...workspace.allocations.filter(item => item.taskId !== task.id),
          ...replacementAllocations,
        ]
      : workspace.allocations,
  };
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
  const [timelineZoom, setTimelineZoom] = useState<TimelineZoom>(initialTimelineZoom);
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0);
  const [ready, setReady] = useState(false);
  const [editingTask, setEditingTask] = useState<EditingTask | null>(null);
  const [capacityDate, setCapacityDate] = useState<string | null>(null);
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
        const next = value || createEmptyWorkspace();
        setWorkspace(next);
        setExpandedProjectIds(new Set(next.projects.slice(0, 1).map(item => item.id)));
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
  const beginTaskDrag = (
    projectId: string,
    task: Task,
    origin: TaskDragOrigin,
    event: ReactPointerEvent<HTMLElement>,
    allocatedHours = 0,
    pendingHours = 0,
  ) => {
    if (event.button !== 0 || task.status === 'completed') return;
    const next: TaskDragState = {
      projectId,
      task,
      origin,
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
  const patchProject = (projectId: string, fn: (value: Project) => Project) => {
    if (!workspace) return;
    commit({
      ...workspace,
      projects: workspace.projects.map(item =>
        item.id === projectId ? { ...fn(item), updatedAt: now() } : item,
      ),
    });
  };
  const reorderTasks = useCallback(
    (projectId: string, sourceTaskId: string, targetTaskId: string) => {
      if (!workspace || sourceTaskId === targetTaskId) return;
      const project = workspace.projects.find(item => item.id === projectId);
      if (!project) return;
      const sourceIndex = project.tasks.findIndex(task => task.id === sourceTaskId);
      const targetIndex = project.tasks.findIndex(task => task.id === targetTaskId);
      if (sourceIndex < 0 || targetIndex < 0) return;
      const tasks = [...project.tasks];
      const [moved] = tasks.splice(sourceIndex, 1);
      const insertionIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      tasks.splice(insertionIndex, 0, moved);
      commit({
        ...workspace,
        projects: workspace.projects.map(item =>
          item.id === projectId ? { ...item, tasks, updatedAt: now() } : item,
        ),
      });
    },
    [workspace, commit],
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
    const timestamp = now();
    const next: Project = {
      id: uid(),
      name: '未命名專案',
      description: '',
      createdAt: timestamp,
      updatedAt: timestamp,
      tasks: [],
    };
    commit({ ...workspace, projects: [...workspace.projects, next] });
    setExpandedProjectIds(ids => new Set([...ids, next.id]));
  };

  const deleteProject = (projectId: string) => {
    if (!workspace) return;
    const project = workspace.projects.find(item => item.id === projectId);
    if (!project) return;
    if (workspace.projects.length === 1) return setNotice('至少需要保留一個專案。');
    if (!confirm(`確定刪除「${project.name}」及其所有 Task？`)) return;
    const taskIds = new Set(project.tasks.map(task => task.id));
    const nextProjects = workspace.projects.filter(item => item.id !== project.id);
    commit({
      ...workspace,
      projects: nextProjects,
      allocations: workspace.allocations.filter(allocation => !taskIds.has(allocation.taskId)),
    });
    setExpandedProjectIds(ids => {
      const next = new Set(ids);
      next.delete(projectId);
      return next;
    });
  };

  const addTask = (projectId: string, entryPoint: 'backlog' | 'timeline' = 'backlog') => {
    if (!workspace || !workspace.projects.some(project => project.id === projectId)) return;
    const task = emptyTask();
    if (entryPoint === 'timeline') task.status = 'scheduled';
    setEditingTask({ projectId, task });
  };

  const saveTask = (projectId: string, draft: Task): string | null => {
    if (!workspace) return '目前沒有可編輯的工作區。';
    const project = workspace.projects.find(item => item.id === projectId);
    if (!project) return '找不到 Project。';
    if (!draft.name.trim()) return '請輸入 Task 名稱。';
    if (!Number.isFinite(draft.estimatedHours) || draft.estimatedHours < 0)
      return '請輸入有效的預估工時。';
    const existingTask = project.tasks.find(value => value.id === draft.id);
    if (draft.start && draft.end && draft.start > draft.end) return '開始日期不可晚於結束日期。';
    let nextTask: Task = {
      ...draft,
      name: draft.name.trim(),
      updatedAt: now(),
    };
    let taskAllocations: Allocation[] | undefined;
    if (nextTask.status === 'backlog') {
      const result = returnTaskToBacklog(nextTask);
      nextTask = result.task;
      taskAllocations = result.allocations;
    }
    commit(
      replaceTaskAndAllocations(
        workspace,
        project.id,
        nextTask,
        taskAllocations,
        existingTask?.status === 'backlog' && nextTask.status !== 'backlog',
      ),
    );
    setEditingTask(null);
    return null;
  };

  const autoScheduleTask = (projectId: string, taskId: string, draft?: Task): boolean => {
    if (!workspace) return false;
    const project = workspace.projects.find(item => item.id === projectId);
    if (!project) return false;
    const task = draft
      ? { ...draft, name: draft.name.trim(), updatedAt: now() }
      : project.tasks.find(item => item.id === taskId);
    if (!task || task.status === 'completed') return false;
    if (!task.name.trim() || !Number.isFinite(task.estimatedHours) || task.estimatedHours < 0) {
      setNotice('請先輸入有效的 Task 名稱與預估工時。');
      return false;
    }
    if (task.start && task.end && task.start > task.end) {
      setNotice('開始日期不可晚於結束日期。');
      return false;
    }
    try {
      const result = scheduleTaskAt(
        task,
        workspace.allocations,
        workspace.dailyCapacities,
        task.start || today(),
      );
      const nextTask: Task = { ...result.task, updatedAt: now() };
      commit(
        replaceTaskAndAllocations(
          workspace,
          project.id,
          nextTask,
          result.allocations,
          !project.tasks.some(item => item.id === task.id) || task.status === 'backlog',
        ),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '自動分配失敗。');
      return false;
    }
    return true;
  };

  const adjustAllocationDay = (
    projectId: string,
    taskId: string,
    date: string,
    delta: number,
  ): string | null => {
    if (!workspace) return '目前沒有可編輯的工作區。';
    const project = workspace.projects.find(item => item.id === projectId);
    if (!project) return '找不到 Project。';
    const task = project.tasks.find(item => item.id === taskId);
    if (!task) return '找不到 Task。';
    if (task.status === 'completed') return '已完成 Task 不可修改。';
    try {
      const result = adjustAllocationDayEngine(task, workspace.allocations, date, delta);
      const savedTask: Task = {
        ...task,
        status: task.status === 'in_progress' ? 'in_progress' : 'scheduled',
        updatedAt: now(),
      };
      commit(replaceTaskAndAllocations(workspace, project.id, savedTask, result.allocations));
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Allocation 更新失敗。';
    }
  };

  const scheduleTaskAtDate = useCallback(
    (projectId: string, taskId: string, date: string) => {
      if (!workspace) return;
      const project = workspace.projects.find(item => item.id === projectId);
      const task = project?.tasks.find(item => item.id === taskId);
      const hasAllocations = workspace.allocations.some(item => item.taskId === taskId);
      if (
        !project ||
        !task ||
        task.status === 'completed' ||
        (task.status !== 'backlog' && hasAllocations)
      )
        return;
      try {
        const result = scheduleTaskAt(
          { ...task, status: 'scheduled' },
          workspace.allocations,
          workspace.dailyCapacities,
          date,
        );
        const nextTask: Task = { ...result.task, updatedAt: now() };
        commit(replaceTaskAndAllocations(workspace, projectId, nextTask, result.allocations, true));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '自動分配失敗。');
      }
    },
    [workspace, commit],
  );

  const moveTaskToBacklog = useCallback(
    (projectId: string, taskId: string) => {
      if (!workspace) return;
      const project = workspace.projects.find(item => item.id === projectId);
      const task = project?.tasks.find(item => item.id === taskId);
      if (!project || !task || task.status === 'completed') return;
      const result = returnTaskToBacklog(task);
      const nextTask: Task = { ...result.task, updatedAt: now() };
      commit(replaceTaskAndAllocations(workspace, projectId, nextTask, result.allocations));
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
      if (target?.projectId === current.projectId) {
        if (target.kind === 'backlog' && current.origin === 'gantt')
          moveTaskToBacklog(current.projectId, current.task.id);
        if (target.kind === 'gantt-row') {
          if (current.origin === 'gantt' && target.taskId)
            reorderTasks(current.projectId, current.task.id, target.taskId);
          if (current.origin === 'backlog')
            scheduleTaskAtDate(current.projectId, current.task.id, today());
        }
        if (target.kind === 'gantt-sidebar' && current.origin === 'backlog')
          scheduleTaskAtDate(current.projectId, current.task.id, today());
        if (target.kind === 'gantt-timeline' && target.date)
          scheduleTaskAtDate(current.projectId, current.task.id, target.date);
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
  }, [hasTaskDrag, moveTaskToBacklog, reorderTasks, scheduleTaskAtDate]);

  const saveCapacity = (date: string, total: number, unavailable: number): string | null => {
    if (
      !workspace ||
      !Number.isFinite(total) ||
      !Number.isFinite(unavailable) ||
      total < 0 ||
      unavailable < 0
    )
      return '請輸入有效的容量數值。';
    const nextCapacity: DailyCapacity = {
      date,
      totalCapacityHours: total,
      unavailableHours: unavailable,
      availableHours: capacityAvailableHours(total, unavailable),
    };
    const capacities = workspace.dailyCapacities.some(item => item.date === date)
      ? workspace.dailyCapacities.map(item => (item.date === date ? nextCapacity : item))
      : [...workspace.dailyCapacities, nextCapacity].sort((a, b) => a.date.localeCompare(b.date));
    commit({ ...workspace, dailyCapacities: capacities });
    setCapacityDate(null);
    return null;
  };

  const deleteTask = (projectId: string, taskId: string) => {
    if (!workspace || !confirm('確定刪除這個 Task 及其 Allocation？')) return;
    const project = workspace.projects.find(item => item.id === projectId);
    if (!project) return;
    commit({
      ...workspace,
      projects: workspace.projects.map(item =>
        item.id === project.id
          ? { ...item, tasks: item.tasks.filter(task => task.id !== taskId), updatedAt: now() }
          : item,
      ),
      allocations: workspace.allocations.filter(allocation => allocation.taskId !== taskId),
    });
  };

  const exportJson = () => {
    if (!workspace) return;
    const file: ExportFile = {
      schema: 'gantt-capacity-local',
      version: CURRENT_WORKSPACE_VERSION,
      exportedAt: now(),
      projects: workspace.projects,
      dailyCapacities: workspace.dailyCapacities,
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
      setNotice('匯入完成。');
    } catch (error) {
      setNotice(error instanceof Error ? `匯入失敗：${error.message}` : '匯入失敗。');
    }
  };

  if (!ready || !workspace) return <main className="loading">正在開啟本機工作區…</main>;

  const allExpanded =
    workspace.projects.length > 0 &&
    workspace.projects.every(project => expandedProjectIds.has(project.id));
  const toggleProject = (projectId: string) =>
    setExpandedProjectIds(ids => {
      const next = new Set(ids);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  const expandAll = () =>
    setExpandedProjectIds(new Set(workspace.projects.map(project => project.id)));
  const collapseAll = () => setExpandedProjectIds(new Set());
  const editingProject =
    editingTask && workspace.projects.find(project => project.id === editingTask.projectId);
  const editTask = (projectId: string, task: Task) => {
    if (task.status === 'completed') {
      setNotice('已完成 Task 不可修改。');
      return;
    }
    setEditingTask({ projectId, task });
  };
  return (
    <div
      className="app"
      onClickCapture={event => {
        if (suppressTaskClickRef.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressTaskClickRef.current = false;
        }
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
              <h1>Projects</h1>
              <p>{workspace.projects.length} 個 Project · 可在同一頁檢視、編輯與安排工作</p>
            </div>
            <div className="project-list-actions">
              <button
                onClick={allExpanded ? collapseAll : expandAll}
                disabled={!workspace.projects.length}
              >
                {allExpanded ? '全部收合' : '全部展開'}
              </button>
              <button className="primary" onClick={addProject}>
                ＋ 新增 Project
              </button>
            </div>
          </div>
          {workspace.projects.length === 0 ? (
            <div className="empty-projects">
              <p>目前還沒有 Project。</p>
              <button className="primary" onClick={addProject}>
                ＋ 建立第一個 Project
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
                  capacities={workspace.dailyCapacities}
                  view={view}
                  timelineZoom={timelineZoom}
                  timelineScrollLeft={timelineScrollLeft}
                  taskDrag={taskDrag}
                  expanded={expandedProjectIds.has(project.id)}
                  onToggle={() => toggleProject(project.id)}
                  onChange={fn => patchProject(project.id, fn)}
                  onDelete={() => deleteProject(project.id)}
                  onAddTask={() => addTask(project.id, 'backlog')}
                  onAddTimelineTask={() => addTask(project.id, 'timeline')}
                  onEditTask={task => editTask(project.id, task)}
                  onBeginTaskDrag={beginTaskDrag}
                  onTaskDropTarget={updateTaskDropTarget}
                  onAdjustAllocation={(taskId, date, delta) => {
                    const error = adjustAllocationDay(project.id, taskId, date, delta);
                    if (error) setNotice(error);
                  }}
                  onDeleteTask={taskId => deleteTask(project.id, taskId)}
                  onEditCapacity={setCapacityDate}
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
          allocations={workspace.allocations.filter(
            allocation => allocation.taskId === editingTask.task.id,
          )}
          onClose={() => setEditingTask(null)}
          onSave={task => saveTask(editingTask.projectId, task)}
          onAutoSchedule={draft => {
            if (autoScheduleTask(editingTask.projectId, editingTask.task.id, draft))
              setEditingTask(null);
          }}
        />
      )}
      {capacityDate && (
        <CapacityDialog
          date={capacityDate}
          capacity={getDailyCapacity(capacityDate, workspace.dailyCapacities)}
          onClose={() => setCapacityDate(null)}
          onSave={saveCapacity}
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
  capacities: DailyCapacity[];
  view: ViewMode;
  timelineZoom: TimelineZoom;
  timelineScrollLeft: number;
  taskDrag: TaskDragState | null;
  expanded: boolean;
  onToggle: () => void;
  onChange: (fn: (value: Project) => Project) => void;
  onDelete: () => void;
  onAddTask: () => void;
  onAddTimelineTask: () => void;
  onEditTask: (task: Task) => void;
  onBeginTaskDrag: (
    projectId: string,
    task: Task,
    origin: TaskDragOrigin,
    event: ReactPointerEvent<HTMLElement>,
    allocatedHours?: number,
    pendingHours?: number,
  ) => void;
  onTaskDropTarget: TaskDropTargetHandler;
  onAdjustAllocation: (taskId: string, date: string, delta: number) => void;
  onDeleteTask: (taskId: string) => void;
  onEditCapacity: (date: string) => void;
  onViewChange: (view: ViewMode) => void;
  onZoomChange: (next: TimelineZoom) => void;
  onTimelineScroll: (left: number) => void;
};

function ProjectPanel({
  project,
  allocations,
  allAllocations,
  capacities,
  view,
  timelineZoom,
  timelineScrollLeft,
  taskDrag,
  expanded,
  onToggle,
  onChange,
  onDelete,
  onAddTask,
  onAddTimelineTask,
  onEditTask,
  onBeginTaskDrag,
  onTaskDropTarget,
  onAdjustAllocation,
  onDeleteTask,
  onEditCapacity,
  onViewChange,
  onZoomChange,
  onTimelineScroll,
}: ProjectPanelProps) {
  const allocatedHours = allocations.reduce((sum, item) => sum + item.allocatedHours, 0);
  const {
    backlog: backlogTasks,
    scheduled: scheduledTasks,
    pending: pendingTasks,
  } = partitionProjectTasks(project, allocations);
  return (
    <article className={`project-card${expanded ? ' expanded' : ' collapsed'}`}>
      <div className="project-card-header">
        <button
          className="project-toggle"
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? '收合' : '展開'} ${project.name}`}
          onClick={onToggle}
        >
          <span aria-hidden="true">{expanded ? '⌄' : '›'}</span>
          <small>Project</small>
        </button>
        <div className="project-identity">
          <input
            aria-label={`${project.name} Project 名稱`}
            value={project.name}
            onChange={event => onChange(value => ({ ...value, name: event.target.value }))}
          />
          <input
            aria-label={`${project.name} Project 說明`}
            value={project.description}
            placeholder="Project 說明…"
            onChange={event => onChange(value => ({ ...value, description: event.target.value }))}
          />
        </div>
        <div className="project-summary">
          <span>{project.tasks.length} 個 Task</span>
          <span>Backlog {backlogTasks.length}</span>
          {pendingTasks.length > 0 && (
            <span className="pending-badge">待處理 {pendingTasks.length}</span>
          )}
          <span>
            已分配 {hoursLabel(allocatedHours)} / {hoursLabel(getProjectEstimatedHours(project))}
          </span>
        </div>
        <button className="danger project-delete" type="button" onClick={onDelete}>
          刪除
        </button>
      </div>
      {expanded && (
        <div className="project-card-content">
          <div className="workspace-title">
            <div>
              <h2>{project.name}</h2>
              <p>
                {project.tasks.length} 個 Task · 預估{' '}
                {hourValueLabel(getProjectEstimatedHours(project))} 小時
              </p>
            </div>
            <div className="view-switch" aria-label={`${project.name} 時間檢視`}>
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
              pendingTasks={pendingTasks}
              draggingTaskId={
                taskDrag?.projectId === project.id && taskDrag.active ? taskDrag.task.id : null
              }
              onEdit={onEditTask}
              onAddTask={onAddTask}
              onDelete={onDeleteTask}
              onTaskPointerDown={(task, event) =>
                onBeginTaskDrag(project.id, task, 'backlog', event)
              }
              onTaskDropTarget={onTaskDropTarget}
            />
            <CapacityGantt
              projectId={project.id}
              tasks={scheduledTasks}
              backlogTasks={[...backlogTasks, ...pendingTasks]}
              allocations={allocations}
              capacityAllocations={allAllocations}
              capacities={capacities}
              timelineZoom={timelineZoom}
              scrollLeft={timelineScrollLeft}
              taskDrag={taskDrag}
              onZoomChange={onZoomChange}
              onEdit={onEditTask}
              onAddTask={onAddTimelineTask}
              onBeginTaskDrag={(task, event, allocatedHours, pendingHours) =>
                onBeginTaskDrag(project.id, task, 'gantt', event, allocatedHours, pendingHours)
              }
              onTaskDropTarget={onTaskDropTarget}
              onAdjustAllocation={onAdjustAllocation}
              onDelete={onDeleteTask}
              onEditCapacity={onEditCapacity}
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
  pendingTasks,
  draggingTaskId,
  onEdit,
  onAddTask,
  onDelete,
  onTaskPointerDown,
  onTaskDropTarget,
}: {
  projectId: string;
  tasks: Task[];
  pendingTasks: Task[];
  draggingTaskId: string | null;
  onEdit: (task: Task) => void;
  onAddTask: () => void;
  onDelete: (taskId: string) => void;
  onTaskPointerDown: (task: Task, event: ReactPointerEvent<HTMLElement>) => void;
  onTaskDropTarget: TaskDropTargetHandler;
}) {
  const handleTaskPointerMove = (event: ReactPointerEvent<HTMLElement>) =>
    onTaskDropTarget({ kind: 'backlog', projectId }, event.currentTarget);
  const handleTaskPointerLeave = (event: ReactPointerEvent<HTMLElement>) => {
    if (pointerLeftElement(event)) onTaskDropTarget(null);
  };
  const renderTask = (task: Task) => (
    <TaskCard
      key={task.id}
      task={task}
      variant="backlog"
      isDragging={draggingTaskId === task.id}
      onEdit={onEdit}
      onDelete={onDelete}
      onPointerDown={event => onTaskPointerDown(task, event)}
    />
  );
  return (
    <aside
      className="backlog"
      onPointerMove={handleTaskPointerMove}
      onPointerLeave={handleTaskPointerLeave}
    >
      <div className="section-heading">
        <div>
          <h2>Backlog</h2>
          <small>{tasks.length} 個待排程 Task</small>
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
      {pendingTasks.length > 0 && (
        <div className="pending-tray">
          <div className="section-heading">
            <div>
              <h3>待處理</h3>
              <small>尚未安排工時的 Timeline Task</small>
            </div>
          </div>
          <div className="backlog-list">{pendingTasks.map(renderTask)}</div>
        </div>
      )}
    </aside>
  );
}

function TaskDialog({
  task,
  allocations,
  onClose,
  onSave,
  onAutoSchedule,
}: {
  task: Task;
  allocations: Allocation[];
  onClose: () => void;
  onSave: (task: Task) => string | null;
  onAutoSchedule: (task: Task) => void;
}) {
  const [draft, setDraft] = useState(task);
  const [error, setError] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    nameInputRef.current?.focus();
  }, []);
  const saveDraft = () => {
    const result = onSave({ ...draft, estimatedHours: Number(draft.estimatedHours) });
    if (result) setError(result);
    else setError('');
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    saveDraft();
  };
  return (
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
            onChange={event => setDraft({ ...draft, name: event.target.value })}
          />
        </label>
        <div className="form-grid">
          <label>
            開始日期
            <input
              type="date"
              value={draft.start || ''}
              onChange={event => setDraft({ ...draft, start: event.target.value || null })}
            />
          </label>
          <label>
            結束日期
            <input
              type="date"
              value={draft.end || ''}
              onChange={event => setDraft({ ...draft, end: event.target.value || null })}
            />
          </label>
          <label>
            優先順序
            <select
              value={draft.priority}
              onChange={event =>
                setDraft({ ...draft, priority: event.target.value as TaskPriority })
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
              value={draft.estimatedHours}
              onChange={event => setDraft({ ...draft, estimatedHours: Number(event.target.value) })}
            />
          </label>
          <label>
            截止日期
            <input
              type="date"
              value={draft.deadline || ''}
              onChange={event => setDraft({ ...draft, deadline: event.target.value || null })}
            />
          </label>
          <label>
            狀態
            <select
              value={draft.status}
              onChange={event => setDraft({ ...draft, status: event.target.value as TaskStatus })}
            >
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          備註
          <textarea
            rows={3}
            value={draft.notes}
            onChange={event => setDraft({ ...draft, notes: event.target.value })}
          />
        </label>
        <p className="form-hint">
          {allocations.length
            ? `目前已分配 ${hourValueLabel(getTaskAllocatedHours(task.id, allocations))} 小時，待處理 ${hourValueLabel(getTaskPendingHours(task, allocations))} 小時。儲存 metadata 不會改變 Allocation。`
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
          <button className="primary" type="submit">
            儲存
          </button>
        </div>
      </form>
    </div>
  );
}

function CapacityDialog({
  date,
  capacity,
  onClose,
  onSave,
}: {
  date: string;
  capacity: DailyCapacity;
  onClose: () => void;
  onSave: (date: string, total: number, unavailable: number) => string | null;
}) {
  const [total, setTotal] = useState(capacity.totalCapacityHours);
  const [unavailable, setUnavailable] = useState(capacity.unavailableHours);
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = onSave(date, total, unavailable);
    if (result) setError(result);
  };
  return (
    <div
      className="modal"
      role="presentation"
      onMouseDown={event => event.target === event.currentTarget && onClose()}
    >
      <form className="dialog small-dialog" role="dialog" aria-modal="true" onSubmit={submit}>
        <div className="dialog-head">
          <div>
            <small>Daily Capacity</small>
            <h2>{weekdayDateLabel(date)}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </div>
        <label>
          每日總容量（小時）
          <input
            type="number"
            min="0"
            step="0.5"
            value={total}
            onChange={event => setTotal(Number(event.target.value))}
          />
        </label>
        <label>
          不可用時間（小時）
          <input
            type="number"
            min="0"
            step="0.5"
            value={unavailable}
            onChange={event => setUnavailable(Number(event.target.value))}
          />
        </label>
        <p className="form-hint">
          可用容量會由總容量減去不可用時間計算。容量變更只會更新可用空間與警告，不會改變既有
          Allocation。
        </p>
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" type="submit">
            儲存
          </button>
        </div>
      </form>
    </div>
  );
}
