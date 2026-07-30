import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyTask } from './data';
import type { Allocation, Project, Task, WorkspaceData } from './types';
import './styles.css';
import './capacity-header.css';

const { loadWorkspaceMock, saveWorkspaceMock } = vi.hoisted(() => ({
  loadWorkspaceMock: vi.fn(),
  saveWorkspaceMock: vi.fn(async () => undefined),
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
  version: 3,
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
  dailyCapacities: [],
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
    expect(screen.getByRole('button', { name: '收合 根工作' })).toBeInTheDocument();
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
      expect.stringContaining('不可修改'),
    );
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

  it('renders a larger, styled hierarchy toggle button', async () => {
    const parent = workItem('parent', '父工作', { status: 'scheduled' });
    const child = workItem('child', '子工作', {
      parentId: 'parent',
      status: 'scheduled',
    });
    loadWorkspaceMock.mockResolvedValue(workspace([parent, child]));
    render(<App />);

    const toggle = await screen.findByRole('button', { name: '收合 父工作' });
    expect(toggle).toHaveClass('task-card-toggle');
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

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '收合 新父節點' })).toBeInTheDocument(),
    );
  });

  it('does not indent a child task while it is shown in Backlog', async () => {
    const parent = workItem('parent', '父工作');
    const child = workItem('child', 'Backlog 子工作', { parentId: 'parent' });
    loadWorkspaceMock.mockResolvedValue(workspace([parent, child]));
    render(<App />);

    await waitFor(() => expect(screen.getByText('Backlog 子工作')).toBeInTheDocument());
    const card = document.querySelector('.backlog .task-card-backlog');
    expect(card).not.toBeNull();
    expect(getComputedStyle(card!).marginLeft).toMatch(/^0(?:px)?$/);
  });
});
