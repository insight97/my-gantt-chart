import { describe, expect, it } from 'vitest';
import { buildViewProjection } from './view-projection';
import type { Allocation, Project, Task } from './types';

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  name: id,
  start: null,
  end: null,
  deadline: null,
  estimatedHours: 0,
  estimatedHoursMode: 'manual',
  priority: 'medium',
  status: 'backlog',
  notes: '',
  owner: '',
  color: '#5eb1ef',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  parentId: null,
  order: 0,
  recurrence: null,
  ...overrides,
});

const allocation = (
  id: string,
  taskId: string,
  date: string,
  allocatedHours: number,
): Allocation => ({ id, taskId, date, allocatedHours });

const choices = (overrides: Partial<Parameters<typeof buildViewProjection>[2]> = {}) => ({
  referenceDate: '2026-08-10',
  timelineLevel: 'day' as const,
  showCompleted: false,
  expanded: { backlog: new Set<string>(), timeline: new Set<string>() },
  dailyDistribution: {
    order: { by: 'hours' as const, direction: 'desc' as const },
    hierarchyDepth: 3 as const,
  },
  ...overrides,
});

describe('View Projection', () => {
  it('projects canonical Work Items with complete ancestors and independent expansion', () => {
    const parent = task('parent');
    const backlog = task('backlog', { parentId: 'parent', order: 0 });
    const scheduled = task('scheduled', {
      parentId: 'parent',
      order: 1,
      status: 'scheduled',
    });
    const project = { tasks: [parent, backlog, scheduled] } as Project;

    const projection = buildViewProjection(
      project,
      [],
      choices({
        expanded: { backlog: new Set(), timeline: new Set(['parent']) },
      }),
    );

    expect(projection.backlog.rows.map(row => row.workItem.id)).toEqual(['parent']);
    expect(projection.timeline.rows.map(row => row.workItem.id)).toEqual(['parent', 'scheduled']);
    expect(projection.timeline.rows[0].workItem).toBe(parent);
    expect(projection.timeline.rows[1]).toMatchObject({ depth: 2, hasChildren: false });
  });

  it('projects inherited and overridden display colors without changing canonical Tasks', () => {
    const parent = task('parent', { color: '#5bb98b' });
    const inherited = task('inherited', { parentId: 'parent', color: null });
    const overridden = task('overridden', { parentId: 'parent', color: '#eb8e90' });
    const project = { tasks: [parent, inherited, overridden] } as Project;

    const projection = buildViewProjection(
      project,
      [],
      choices({ expanded: { backlog: new Set(['parent']), timeline: new Set() } }),
    );

    expect(
      projection.backlog.rows.map(row => [row.workItem.id, row.workItem.color, row.displayColor]),
    ).toEqual([
      ['parent', '#5bb98b', '#5bb98b'],
      ['inherited', null, '#5bb98b'],
      ['overridden', '#eb8e90', '#eb8e90'],
    ]);
  });

  it('keeps completed Daily Distribution independent from Timeline expansion', () => {
    const parent = task('parent');
    const completed = task('completed', {
      parentId: 'parent',
      status: 'completed',
    });
    const project = { tasks: [parent, completed] } as Project;
    const allocations = [allocation('a', 'completed', '2026-08-10', 4)];

    const hidden = buildViewProjection(project, allocations, choices());
    const shown = buildViewProjection(project, allocations, choices({ showCompleted: true }));

    expect(hidden.dailyDistribution.days.find(day => day.date === '2026-08-10')?.segments).toEqual(
      [],
    );
    expect(shown.timeline.rows.map(row => row.workItem.id)).toEqual(['parent']);
    expect(
      shown.dailyDistribution.days
        .find(day => day.date === '2026-08-10')
        ?.segments.map(segment => segment.workItem.id),
    ).toEqual(['completed']);
  });

  it('rolls Allocation to parents while keeping workspace-wide capacity', () => {
    const parent = task('parent', { estimatedHours: 6 });
    const child = task('child', {
      parentId: 'parent',
      status: 'scheduled',
      estimatedHours: 6,
    });
    const project = { tasks: [parent, child] } as Project;
    const allocations = [
      allocation('child-a', 'child', '2026-08-10', 6),
      allocation('other-project', 'other', '2026-08-10', 3),
    ];

    const projection = buildViewProjection(
      project,
      allocations,
      choices({ expanded: { backlog: new Set(), timeline: new Set(['parent']) } }),
    );

    expect(projection.timeline.rows.map(row => [row.workItem.id, row.allocatedHours])).toEqual([
      ['parent', 6],
      ['child', 6],
    ]);
    const date = projection.timeline.capacity.find(item => item.period.start === '2026-08-10');
    expect(date).toMatchObject({ allocatedHours: 9, availableHours: 24, remainingHours: 15 });
  });

  it('builds ordered, clipped Daily Distribution at the selected Hierarchy depth', () => {
    const parent = task('parent');
    const first = task('first', { parentId: 'parent', status: 'scheduled', order: 0 });
    const second = task('second', { parentId: 'parent', status: 'scheduled', order: 1 });
    const project = { tasks: [parent, first, second] } as Project;
    const allocations = [
      allocation('a', 'first', '2026-08-10', 20),
      allocation('b', 'second', '2026-08-10', 10),
    ];

    const descending = buildViewProjection(
      project,
      allocations,
      choices({
        dailyDistribution: {
          order: { by: 'hours', direction: 'desc' },
          hierarchyDepth: 2,
        },
      }),
    );
    const ascending = buildViewProjection(
      project,
      allocations,
      choices({
        dailyDistribution: {
          order: { by: 'hours', direction: 'asc' },
          hierarchyDepth: 2,
        },
      }),
    );
    const day = descending.dailyDistribution.days.find(item => item.date === '2026-08-10')!;

    expect(day).toMatchObject({ allocatedHours: 30, remainingHours: -6, overloaded: true });
    expect(
      day.segments.map(segment => [segment.workItem.id, segment.startHour, segment.visibleHours]),
    ).toEqual([
      ['first', 0, 20],
      ['second', 20, 4],
    ]);
    expect(
      ascending.dailyDistribution.days
        .find(item => item.date === '2026-08-10')
        ?.segments.map(segment => segment.workItem.id),
    ).toEqual(['second', 'first']);
  });

  it('groups Daily Distribution segments by parent and sibling task order', () => {
    const firstParent = task('first-parent', { order: 0 });
    const secondParent = task('second-parent', { order: 1 });
    const firstLater = task('first-later', {
      parentId: 'first-parent',
      status: 'scheduled',
      order: 1,
    });
    const firstEarlier = task('first-earlier', {
      parentId: 'first-parent',
      status: 'scheduled',
      order: 0,
    });
    const secondLater = task('second-later', {
      parentId: 'second-parent',
      status: 'scheduled',
      order: 1,
    });
    const secondEarlier = task('second-earlier', {
      parentId: 'second-parent',
      status: 'scheduled',
      order: 0,
    });
    const project = {
      tasks: [secondParent, secondLater, firstParent, firstLater, secondEarlier, firstEarlier],
    } as Project;
    const allocations = [
      allocation('a', 'first-later', '2026-08-10', 1),
      allocation('b', 'first-earlier', '2026-08-10', 4),
      allocation('c', 'second-later', '2026-08-10', 2),
      allocation('d', 'second-earlier', '2026-08-10', 3),
    ];

    const ascending = buildViewProjection(
      project,
      allocations,
      choices({
        dailyDistribution: {
          order: { by: 'task', direction: 'asc' },
          hierarchyDepth: 2,
        },
      }),
    );
    const descending = buildViewProjection(
      project,
      allocations,
      choices({
        dailyDistribution: {
          order: { by: 'task', direction: 'desc' },
          hierarchyDepth: 2,
        },
      }),
    );

    expect(
      ascending.dailyDistribution.days
        .find(item => item.date === '2026-08-10')
        ?.segments.map(segment => segment.workItem.id),
    ).toEqual(['first-earlier', 'first-later', 'second-earlier', 'second-later']);
    expect(
      descending.dailyDistribution.days
        .find(item => item.date === '2026-08-10')
        ?.segments.map(segment => segment.workItem.id),
    ).toEqual(['second-later', 'second-earlier', 'first-later', 'first-earlier']);
  });
});
