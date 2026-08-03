import { describe, expect, it } from 'vitest';
import { buildTaskTree, emptyTask } from './data';
import { migrateWorkspace } from './db';
import { CURRENT_WORKSPACE_VERSION } from './types';
import type { Task, WorkspaceData } from './types';
import { moveTask } from './workspace-operations';

const task = (id: string, order: number): Task => ({
  ...emptyTask(),
  id,
  name: id,
  order,
});

const workspace = (tasks: Task[]): WorkspaceData => ({
  version: CURRENT_WORKSPACE_VERSION,
  projects: [
    {
      id: 'project-a',
      name: 'Project A',
      description: '',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      tasks,
    },
  ],
  allocations: [],
});

describe('workspace persistence', () => {
  it('preserves manual sibling ordering after a persistence round trip', () => {
    const original = workspace([task('first', 0), task('second', 1), task('third', 2)]);
    const moved = moveTask(original, 'project-a', 'third', 'first', 'before');

    expect(moved).toMatchObject({ ok: true, changed: true });
    if (!moved.ok || !moved.changed) throw new Error('Expected a changed workspace');

    const reloaded = migrateWorkspace(moved.workspace);
    const roots = buildTaskTree(reloaded.projects[0].tasks).children(null);

    expect(roots.map(item => item.id)).toEqual(['third', 'first', 'second']);
  });

  it('migrates legacy estimates as manual and syncs explicit automatic estimates', () => {
    const migrated = migrateWorkspace({
      version: 5,
      projects: [
        {
          id: 'project-a',
          name: 'Project A',
          tasks: [
            { id: 'legacy', name: 'Legacy', estimatedHours: 8 },
            { id: 'automatic', name: 'Automatic', estimatedHours: 0, estimatedHoursMode: 'auto' },
          ],
        },
      ],
      allocations: [
        { id: 'automatic-allocation', taskId: 'automatic', date: '2026-01-01', allocatedHours: 3 },
      ],
    });

    expect(migrated.projects[0].tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'legacy', estimatedHours: 8, estimatedHoursMode: 'manual' }),
        expect.objectContaining({
          id: 'automatic',
          estimatedHours: 3,
          estimatedHoursMode: 'auto',
        }),
      ]),
    );
  });
});
