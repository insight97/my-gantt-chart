import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { emptyTask } from './data';
import { CURRENT_WORKSPACE_VERSION } from './types';
import type { Allocation, Project, Task, WorkspaceData } from './types';
import './styles.css';
import './capacity-header.css';

const { loadWorkspaceMock, saveWorkspaceMock } = vi.hoisted(() => ({
  loadWorkspaceMock: vi.fn(),
  saveWorkspaceMock: vi.fn<(workspace: WorkspaceData) => Promise<void>>(async () => undefined),
}));

vi.mock('./db', () => ({
  createEmptyWorkspace: () => null,
  loadWorkspace: loadWorkspaceMock,
  saveWorkspace: saveWorkspaceMock,
  migrateWorkspace: (raw: WorkspaceData) => ({
    ...raw,
    projects: raw.projects.length
      ? [
          {
            ...raw.projects[0],
            id: 'workspace-root',
            name: '工作項目',
            tasks: raw.projects.flatMap(project => project.tasks),
          },
        ]
      : [],
  }),
}));

import App from './App';

const workItem = (id: string, name: string, overrides: Partial<Task> = {}): Task => ({
  ...emptyTask(),
  id,
  name,
  ...overrides,
});

const workspace = (
  tasks: Task[],
  extraProjects: Project[] = [],
  allocations: Allocation[] = [],
): WorkspaceData => ({
  version: CURRENT_WORKSPACE_VERSION,
  projects: [
    {
      id: 'project-a',
      name: '舊專案 A',
      description: '',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      tasks,
    },
    ...extraProjects,
  ],
  allocations,
});

describe('Work Item hierarchy UI', () => {
  beforeEach(() => {
    localStorage.clear();
    loadWorkspaceMock.mockReset();
    saveWorkspaceMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('merges legacy Projects into one visible work-item workspace', async () => {
    loadWorkspaceMock.mockResolvedValue(
      workspace(
        [workItem('root-a', '根工作 A')],
        [
          {
            id: 'project-b',
            name: '舊專案 B',
            description: '',
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
            tasks: [workItem('root-b', '根工作 B')],
          },
        ],
      ),
    );
    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '工作項目', level: 1 })).toBeInTheDocument(),
    );
    expect(screen.getByText('根工作 A')).toBeInTheDocument();
    expect(screen.getByText('根工作 B')).toBeInTheDocument();
    expect(screen.queryByText('舊專案 A')).not.toBeInTheDocument();
    expect(screen.queryByText('舊專案 B')).not.toBeInTheDocument();
  });

  it('creates a child with the same Work Item object shape', async () => {
    loadWorkspaceMock.mockResolvedValue(workspace([workItem('root', '根工作')]));
    render(<App />);
    await waitFor(() => expect(screen.getByText('根工作')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '新增 根工作 的子任務' }));
    fireEvent.change(screen.getByLabelText('Task 名稱'), { target: { value: '子工作' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(screen.getByText('子工作')).toBeInTheDocument());
    expect(document.querySelector('.backlog .task-card-group')).toHaveTextContent('根工作');
  });

  it('configures and explicitly applies a recurring schedule from the task editor', async () => {
    loadWorkspaceMock.mockResolvedValue(workspace([workItem('task-a', '固定例會')]));
    render(<App />);
    await waitFor(() => expect(screen.getByText('固定例會')).toBeInTheDocument());

    fireEvent.click(screen.getByText('固定例會'));
    fireEvent.click(screen.getByLabelText('啟用重複排程'));
    fireEvent.change(screen.getByLabelText('頻率'), { target: { value: 'daily' } });
    fireEvent.change(screen.getByLabelText('開始日期'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('結束日期'), { target: { value: '2026-01-03' } });
    fireEvent.change(screen.getByLabelText('每次時數'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '套用重複排程' }));

    await waitFor(() => expect(saveWorkspaceMock).toHaveBeenCalled());
    const saved = saveWorkspaceMock.mock.calls.at(-1)?.[0];
    expect(saved?.projects[0].tasks[0]).toMatchObject({
      status: 'scheduled',
      estimatedHours: 6,
      recurrence: expect.objectContaining({ frequency: 'daily' }),
    });
    expect(saved?.allocations).toHaveLength(3);
    expect(saved?.allocations.every(allocation => allocation.recurrenceId === 'task-a')).toBe(true);
  });

  it('keeps other task editor changes available after enabling recurrence', async () => {
    loadWorkspaceMock.mockResolvedValue(workspace([workItem('task-a', '固定例會')]));
    render(<App />);
    await waitFor(() => expect(screen.getByText('固定例會')).toBeInTheDocument());

    fireEvent.click(screen.getByText('固定例會'));
    fireEvent.click(screen.getByLabelText('啟用重複排程'));
    fireEvent.change(screen.getByLabelText('Task 名稱'), { target: { value: '更新後例會' } });
    fireEvent.change(screen.getByLabelText('頻率'), { target: { value: 'daily' } });
    fireEvent.change(screen.getByLabelText('開始日期'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('結束日期'), { target: { value: '2026-01-03' } });
    fireEvent.change(screen.getByLabelText('每次時數'), { target: { value: '8' } });

    expect(screen.getByLabelText('頻率')).toBeEnabled();
    expect(screen.getByLabelText('開始日期')).toBeEnabled();
    expect(screen.getByLabelText('結束日期')).toBeEnabled();
    expect(screen.getByLabelText('每次時數')).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(saveWorkspaceMock).toHaveBeenCalled());
    const saved = saveWorkspaceMock.mock.calls.at(-1)?.[0];
    expect(saved?.projects[0].tasks[0]).toMatchObject({
      name: '更新後例會',
      recurrence: expect.objectContaining({
        frequency: 'daily',
        startDate: '2026-01-01',
        endDate: '2026-01-03',
        hoursPerOccurrence: 8,
      }),
    });
  });

  it('applies recurring hours when a new Timeline task is saved', async () => {
    loadWorkspaceMock.mockResolvedValue(workspace([]));
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Allocation Timeline 新增 Task' }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Allocation Timeline 新增 Task' }));
    fireEvent.change(screen.getByLabelText('Task 名稱'), { target: { value: '每日休息' } });
    fireEvent.click(screen.getByLabelText('啟用重複排程'));
    fireEvent.change(screen.getByLabelText('頻率'), { target: { value: 'daily' } });
    fireEvent.change(screen.getByLabelText('開始日期'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('結束日期'), { target: { value: '2026-01-03' } });
    fireEvent.change(screen.getByLabelText('每次時數'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(saveWorkspaceMock).toHaveBeenCalled());
    const saved = saveWorkspaceMock.mock.calls.at(-1)?.[0];
    expect(saved?.projects[0].tasks[0]).toMatchObject({
      name: '每日休息',
      status: 'scheduled',
      estimatedHours: 24,
    });
    expect(saved?.allocations.map(item => [item.date, item.allocatedHours])).toEqual([
      ['2026-01-01', 8],
      ['2026-01-02', 8],
      ['2026-01-03', 8],
    ]);
  });

  it('allows editing a new Timeline task immediately after a refreshed workspace loads', async () => {
    let resolveWorkspace!: (value: WorkspaceData) => void;
    loadWorkspaceMock.mockReturnValue(
      new Promise<WorkspaceData>(resolve => {
        resolveWorkspace = resolve;
      }),
    );
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    resolveWorkspace(workspace([]));
    const addButton = await screen.findByRole('button', {
      name: 'Allocation Timeline 新增 Task',
    });
    fireEvent.click(addButton);

    const nameInput = screen.getByLabelText('Task 名稱');
    expect(screen.getByRole('dialog').parentElement?.parentElement).toBe(document.body);
    fireEvent.click(nameInput);
    expect(document.activeElement).toBe(nameInput);
    fireEvent.change(nameInput, { target: { value: '重新整理後的新工作' } });
    expect(nameInput).toHaveValue('重新整理後的新工作');

    fireEvent.change(screen.getByLabelText('截止日期'), { target: { value: '2026-08-02' } });
    expect(screen.getByLabelText('截止日期')).toHaveValue('2026-08-02');
  });

  it('keeps the Timeline editor open after a task drag click is suppressed', async () => {
    loadWorkspaceMock.mockResolvedValue(
      workspace([workItem('scheduled', '已排程工作', { status: 'scheduled' })]),
    );
    render(<App />);
    await waitFor(() => expect(screen.getByText('已排程工作')).toBeInTheDocument());

    const source = screen.getByText('已排程工作').closest('.task-card')!;
    fireEvent.pointerDown(source, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 10 });

    fireEvent.click(screen.getByRole('button', { name: 'Allocation Timeline 新增 Task' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Task 名稱'), { target: { value: '拖曳後的新工作' } });
    expect(screen.getByLabelText('Task 名稱')).toHaveValue('拖曳後的新工作');
  });

  it('persists the automatic scheduling toggle', async () => {
    loadWorkspaceMock.mockResolvedValue(workspace([workItem('task-a', '待安排工作')]));
    render(<App />);
    const toggle = await screen.findByLabelText('拖入 Timeline 時自動排程');

    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(localStorage.getItem('gantt-auto-schedule')).toBe('false');

    cleanup();
    render(<App />);
    expect(await screen.findByLabelText('拖入 Timeline 時自動排程')).not.toBeChecked();
  });

  it('does not preview automatic allocation when dragging with the toggle off', async () => {
    loadWorkspaceMock.mockResolvedValue(workspace([workItem('task-a', '待安排工作')]));
    render(<App />);
    await waitFor(() => expect(screen.getByText('待安排工作')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('拖入 Timeline 時自動排程'));

    const source = screen.getByText('待安排工作').closest('.task-card')!;
    const timeline = document.querySelector('.timeline')!;
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 100,
      left: 0,
      right: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(source, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(timeline, { clientX: 50, clientY: 50 });

    expect(document.querySelector('.drop-preview')).not.toBeInTheDocument();
  });

  it('keeps Backlog and Timeline hierarchy toggles independent', async () => {
    const parent = workItem('parent', '父工作');
    const backlogChild = workItem('backlog-child', 'Backlog 子工作', { parentId: 'parent' });
    const timelineChild = workItem('timeline-child', 'Timeline 子工作', {
      parentId: 'parent',
      status: 'scheduled',
    });
    loadWorkspaceMock.mockResolvedValue(workspace([parent, backlogChild, timelineChild]));
    render(<App />);

    await waitFor(() => expect(screen.getByText('Backlog 子工作')).toBeInTheDocument());
    fireEvent.click(document.querySelector('.gantt-side-row .task-card-toggle')!);
    await waitFor(() => expect(screen.queryByText('Timeline 子工作')).not.toBeInTheDocument());
    expect(screen.getByText('Backlog 子工作')).toBeInTheDocument();

    fireEvent.click(document.querySelector('.backlog .task-card-toggle')!);
    await waitFor(() => expect(screen.queryByText('Backlog 子工作')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '全部展開' }));
    expect(await screen.findByText('Timeline 子工作')).toBeInTheDocument();
    expect(screen.getByText('Backlog 子工作')).toBeInTheDocument();
  });

  it('inherits the parent deadline when creating a child', async () => {
    loadWorkspaceMock.mockResolvedValue(
      workspace([workItem('root', '根工作', { deadline: '2026-02-01' })]),
    );
    render(<App />);
    await waitFor(() => expect(screen.getByText('根工作')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '新增 根工作 的子任務' }));
    expect(screen.getByLabelText('截止日期')).toHaveValue('2026-02-01');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
  });

  it('preserves scheduled parent work as an unsplit child when adding a child', async () => {
    const parent = workItem('parent', '父工作', { status: 'scheduled', estimatedHours: 12 });
    loadWorkspaceMock.mockResolvedValue(
      workspace(
        [parent],
        [],
        [{ id: 'parent-allocation', taskId: parent.id, date: '2026-02-03', allocatedHours: 4 }],
      ),
    );
    render(<App />);
    await waitFor(() => expect(screen.getByText('父工作')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '新增 父工作 的子任務' }));
    fireEvent.change(screen.getByLabelText('Task 名稱'), { target: { value: '新子工作' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(screen.getByText('未拆分工作')).toBeInTheDocument());
    expect(screen.getByText('新子工作')).toBeInTheDocument();
  });

  it('does not create an unsplit child when the parent has zero work', async () => {
    const parent = workItem('parent', '零工時父工作', { estimatedHours: 0 });
    loadWorkspaceMock.mockResolvedValue(workspace([parent]));
    render(<App />);
    await waitFor(() => expect(screen.getByText('零工時父工作')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '新增 零工時父工作 的子任務' }));
    fireEvent.change(screen.getByLabelText('Task 名稱'), { target: { value: '新子工作' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(screen.getByText('新子工作')).toBeInTheDocument());
    expect(screen.queryByText('未拆分工作')).not.toBeInTheDocument();
  });

  it('removes start and end inputs from the editor', async () => {
    loadWorkspaceMock.mockResolvedValue(
      workspace([
        workItem('scheduled', '已排程工作', { status: 'scheduled', deadline: '2026-02-01' }),
      ]),
    );
    render(<App />);
    await waitFor(() => expect(screen.getByText('已排程工作')).toBeInTheDocument());

    fireEvent.click(screen.getByText('已排程工作'));
    expect(screen.queryByLabelText('開始日期')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('結束日期')).not.toBeInTheDocument();
    expect(screen.getByLabelText('截止日期')).toHaveValue('2026-02-01');
  });

  it('renders a parent aggregate as a read-only timeline row', async () => {
    const parent = workItem('parent', '父工作');
    const child = workItem('child', '子工作', {
      parentId: 'parent',
      status: 'scheduled',
      estimatedHours: 8,
    });
    loadWorkspaceMock.mockResolvedValue(workspace([parent, child], []));
    render(<App />);
    await waitFor(() => expect(screen.getByText('父工作')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '日' }));

    const rows = document.querySelectorAll('.timeline-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.allocation-cell')).toBeDisabled();
    expect(rows[0].querySelector('.allocation-cell')).toHaveAttribute(
      'title',
      expect.stringContaining('父任務工時由子任務彙總，不可直接修改'),
    );
    expect(rows[0].querySelector('.allocation-cell')).not.toHaveAttribute(
      'title',
      expect.stringContaining('已完成'),
    );
  });

  it('makes projected parent groups draggable for immediate group transfer', async () => {
    const parent = workItem('parent', '父工作');
    const backlogChild = workItem('backlog-child', 'Backlog 子工作', { parentId: 'parent' });
    const scheduledChild = workItem('scheduled-child', 'Timeline 子工作', {
      parentId: 'parent',
      status: 'scheduled',
    });
    loadWorkspaceMock.mockResolvedValue(workspace([parent, backlogChild, scheduledChild]));
    render(<App />);

    await waitFor(() => expect(screen.getByText('Timeline 子工作')).toBeInTheDocument());
    expect(document.querySelectorAll('.task-card-group.task-card-draggable')).toHaveLength(2);
  });

  it('reorders a Backlog parent together with its subtree', async () => {
    const firstParent = workItem('first-parent', '第一個父項目', { order: 0 });
    const firstChild = workItem('first-child', '第一個子項目', {
      parentId: 'first-parent',
      order: 0,
    });
    const secondParent = workItem('second-parent', '第二個父項目', { order: 1 });
    const secondChild = workItem('second-child', '第二個子項目', {
      parentId: 'second-parent',
      order: 0,
    });
    loadWorkspaceMock.mockResolvedValue(
      workspace([firstParent, firstChild, secondParent, secondChild]),
    );
    render(<App />);

    await waitFor(() => expect(screen.getByText('第二個父項目')).toBeInTheDocument());
    saveWorkspaceMock.mockClear();
    const source = screen.getByText('第一個父項目').closest('.task-card')!;
    const targetRow = screen.getByText('第二個父項目').closest('.backlog-drop-row')!;
    vi.spyOn(targetRow, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 100,
      left: 0,
      right: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(source, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(targetRow, { clientX: 10, clientY: 80 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 80 });

    await waitFor(() => expect(saveWorkspaceMock).toHaveBeenCalledTimes(1));
    const saved = saveWorkspaceMock.mock.calls.at(-1)![0];
    const roots = saved.projects[0].tasks
      .filter(task => task.parentId === null)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    expect(roots.map(task => task.id)).toEqual(['second-parent', 'first-parent']);
    expect(saved.projects[0].tasks.find(task => task.id === 'first-child')).toMatchObject({
      parentId: 'first-parent',
    });
  });

  it('reorders a Timeline parent together with its subtree', async () => {
    const firstParent = workItem('first-parent', '第一個 Timeline 父項目', { order: 0 });
    const firstChild = workItem('first-child', '第一個 Timeline 子項目', {
      parentId: 'first-parent',
      order: 0,
      status: 'scheduled',
    });
    const secondParent = workItem('second-parent', '第二個 Timeline 父項目', { order: 1 });
    const secondChild = workItem('second-child', '第二個 Timeline 子項目', {
      parentId: 'second-parent',
      order: 0,
      status: 'scheduled',
    });
    loadWorkspaceMock.mockResolvedValue(
      workspace([firstParent, firstChild, secondParent, secondChild]),
    );
    render(<App />);

    await waitFor(() => expect(screen.getByText('第二個 Timeline 父項目')).toBeInTheDocument());
    saveWorkspaceMock.mockClear();
    const source = screen.getByText('第二個 Timeline 父項目').closest('.task-card')!;
    const targetRow = screen.getByText('第一個 Timeline 父項目').closest('.gantt-side-row')!;
    vi.spyOn(targetRow, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 100,
      left: 0,
      right: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(source, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(targetRow, { clientX: 10, clientY: 20 });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 20 });

    await waitFor(() => expect(saveWorkspaceMock).toHaveBeenCalledTimes(1));
    const saved = saveWorkspaceMock.mock.calls.at(-1)![0];
    const roots = saved.projects[0].tasks
      .filter(task => task.parentId === null)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    expect(roots.map(task => task.id)).toEqual(['second-parent', 'first-parent']);
    expect(saved.projects[0].tasks.find(task => task.id === 'first-child')).toMatchObject({
      parentId: 'first-parent',
    });
  });

  it('does not preview scheduling when a Timeline group is dragged over a date', async () => {
    const parent = workItem('parent', 'Timeline 父項目', { status: 'scheduled' });
    const child = workItem('child', 'Timeline 子項目', {
      parentId: 'parent',
      status: 'scheduled',
    });
    loadWorkspaceMock.mockResolvedValue(workspace([parent, child]));
    render(<App />);

    await waitFor(() => expect(screen.getByText('Timeline 父項目')).toBeInTheDocument());
    const source = screen.getByText('Timeline 父項目').closest('.task-card')!;
    const timeline = document.querySelector('.timeline')!;
    vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 100,
      left: 0,
      right: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(source, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(timeline, { clientX: 50, clientY: 50 });

    expect(document.querySelector('.drop-preview')).not.toBeInTheDocument();
  });

  it('explains why completed task allocation cells are read-only', async () => {
    const task = workItem('completed', '已完成工作', { status: 'completed' });
    loadWorkspaceMock.mockResolvedValue(workspace([task]));
    render(<App />);
    await waitFor(() => expect(screen.getByText('已完成工作')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '日' }));

    const cell = document.querySelector('.allocation-cell');
    expect(cell).toBeDisabled();
    expect(cell).toHaveAttribute('title', expect.stringContaining('已完成，不可修改'));
  });

  it('keeps Timeline controls in their columns while indenting only the task label', async () => {
    const parent = workItem('parent', '父工作', { status: 'scheduled' });
    const child = workItem('child', '子工作', {
      parentId: 'parent',
      status: 'scheduled',
    });
    loadWorkspaceMock.mockResolvedValue(workspace([parent, child]));
    render(<App />);

    await waitFor(() => expect(screen.getByText('子工作')).toBeInTheDocument());
    const rows = document.querySelectorAll('.gantt-side-row');
    const childCard = rows[1].querySelector('.task-card-gantt');
    expect(childCard).not.toBeNull();
    expect(getComputedStyle(childCard!).marginLeft).toMatch(/^0(?:px)?$/);
    expect(childCard).toHaveStyle('--task-depth: 2');
  });

  it('renders an accessible icon hierarchy toggle button', async () => {
    const parent = workItem('parent', '父工作', { status: 'scheduled' });
    const child = workItem('child', '子工作', {
      parentId: 'parent',
      status: 'scheduled',
    });
    loadWorkspaceMock.mockResolvedValue(workspace([parent, child]));
    render(<App />);

    const toggle = await screen.findByRole('button', { name: '收合 父工作' });
    expect(toggle).toHaveClass('task-card-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle.querySelector('svg')).toHaveClass('task-card-toggle-icon', 'is-expanded');
  });

  it('removes the secondary explanation from Timeline task cards', async () => {
    loadWorkspaceMock.mockResolvedValue(
      workspace([workItem('scheduled', '已排程工作', { status: 'scheduled' })]),
    );
    render(<App />);

    await waitFor(() => expect(screen.getByText('已排程工作')).toBeInTheDocument());
    expect(screen.queryByText('Allocation 由時間軸日期決定')).not.toBeInTheDocument();
    expect(screen.queryByText('尚未排程')).not.toBeInTheDocument();
  });

  it('allows editing a task parent from the detail editor', async () => {
    const parent = workItem('parent', '原父節點');
    const nextParent = workItem('next-parent', '新父節點');
    const child = workItem('child', '子工作', { parentId: 'parent' });
    loadWorkspaceMock.mockResolvedValue(workspace([parent, nextParent, child]));
    render(<App />);

    await waitFor(() => expect(screen.getByText('子工作')).toBeInTheDocument());
    fireEvent.click(screen.getByText('子工作'));

    const parentSelect = screen.getByLabelText('父節點');
    expect(parentSelect).toHaveValue('parent');
    fireEvent.change(parentSelect, { target: { value: 'next-parent' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));

    await waitFor(() => expect(screen.getByText('新父節點')).toBeInTheDocument());
  });

  it('does not offer a completed task as a parent option', async () => {
    const completedParent = workItem('completed-parent', '已完成父項目', { status: 'completed' });
    const child = workItem('child', '可編輯子項目');
    loadWorkspaceMock.mockResolvedValue(workspace([completedParent, child]));
    render(<App />);

    await waitFor(() => expect(screen.getByText('可編輯子項目')).toBeInTheDocument());
    fireEvent.click(screen.getByText('可編輯子項目'));

    expect(screen.queryByRole('option', { name: '已完成父項目' })).not.toBeInTheDocument();
  });

  it('does not offer completed status when editing a group', async () => {
    const parent = workItem('parent', '父工作');
    const child = workItem('child', '子工作', { parentId: 'parent', status: 'in_progress' });
    loadWorkspaceMock.mockResolvedValue(workspace([parent, child]));
    render(<App />);

    await waitFor(() => expect(screen.getByText('父工作')).toBeInTheDocument());
    fireEvent.click(screen.getByText('父工作'));

    const statusSelect = screen.getByLabelText('狀態');
    expect(statusSelect).not.toHaveTextContent('已完成');
  });

  it('indents a child task in Backlog to preserve its hierarchy context', async () => {
    const parent = workItem('parent', '父工作');
    const child = workItem('child', 'Backlog 子工作', { parentId: 'parent' });
    loadWorkspaceMock.mockResolvedValue(workspace([parent, child]));
    render(<App />);

    await waitFor(() => expect(screen.getByText('Backlog 子工作')).toBeInTheDocument());
    const card = screen.getByText('Backlog 子工作').closest('.task-card-backlog');
    expect(card).not.toBeNull();
    expect(card).toHaveStyle('--task-depth: 2');
  });
});
