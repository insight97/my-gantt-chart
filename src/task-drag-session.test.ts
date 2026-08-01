import { describe, expect, it } from 'vitest';
import { createTaskDragSession, sameDropTarget } from './task-drag-session';
import type { Task } from './types';

const task = { id: 'task-1', name: 'Task 1' } as Task;

function start(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'project-1',
    task,
    origin: 'backlog' as const,
    x: 10,
    y: 20,
    ...overrides,
  };
}

describe('TaskDragSession', () => {
  it('does not activate before the pointer crosses the drag threshold', () => {
    const session = createTaskDragSession();
    session.begin(start());

    expect(session.move(13, 23)).toBeNull();
    expect(session.current()).toMatchObject({ active: false, x: 10, y: 20 });
  });

  it('activates once and then tracks pointer movement without reactivation', () => {
    const session = createTaskDragSession();
    session.begin(start());

    expect(session.move(14, 24)).toMatchObject({
      activated: true,
      state: { active: true, x: 14, y: 24 },
    });
    expect(session.move(15, 25)).toMatchObject({
      activated: false,
      state: { active: true, x: 15, y: 25 },
    });
  });

  it('tracks only targets from the same project', () => {
    const session = createTaskDragSession();
    session.begin(start());
    session.move(20, 30);
    const element = document.createElement('div');

    expect(session.updateTarget({ kind: 'backlog', projectId: 'project-2' }, element)).toBeNull();
    expect(session.current()).toMatchObject({ target: null });
    expect(
      session.updateTarget({ kind: 'backlog', projectId: 'project-1' }, element),
    ).toMatchObject({ target: { projectId: 'project-1' } });
  });

  it('rejects a release when the pointer leaves the tracked target', () => {
    const session = createTaskDragSession();
    session.begin(start());
    session.move(20, 30);
    const target = document.createElement('div');
    const outside = document.createElement('div');
    session.updateTarget(
      { kind: 'gantt-timeline', projectId: 'project-1', date: '2026-08-01' },
      target,
    );

    expect(session.release(30, 40, outside, '2026-08-01')).toMatchObject({ command: null });
    expect(session.current()).toBeNull();
  });

  it('resolves a valid release and clears the session', () => {
    const session = createTaskDragSession();
    session.begin(start());
    session.move(20, 30);
    const target = document.createElement('div');
    session.updateTarget(
      { kind: 'gantt-timeline', projectId: 'project-1', date: '2026-08-01' },
      target,
    );

    expect(session.release(30, 40, target, '2026-08-01')).toMatchObject({
      command: {
        type: 'schedule-task',
        projectId: 'project-1',
        taskId: 'task-1',
        date: '2026-08-01',
      },
    });
    expect(session.current()).toBeNull();
  });

  it('cancels an active or pending session without producing a command', () => {
    const session = createTaskDragSession();
    session.begin(start());

    expect(session.cancel()).toMatchObject({ active: false });
    expect(session.cancel()).toBeNull();
  });
});

describe('sameDropTarget', () => {
  it('compares all placement fields', () => {
    const target = { kind: 'backlog' as const, projectId: 'project-1', taskId: 'task-1' };
    expect(sameDropTarget(target, { ...target })).toBe(true);
    expect(sameDropTarget(target, { ...target, relation: 'before' })).toBe(false);
    expect(sameDropTarget(null, null)).toBe(true);
  });
});
