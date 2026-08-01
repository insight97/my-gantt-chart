import { describe, expect, it } from 'vitest';
import {
  isValidRecurrenceRule,
  normalizeRecurrenceRule,
  recurrenceDates,
  recurrenceRuleError,
} from './recurrence';
import { migrateWorkspace } from './db';
import { CURRENT_WORKSPACE_VERSION } from './types';

describe('recurrence domain', () => {
  it('generates daily, weekly, and monthly UTC date-only occurrences', () => {
    expect(
      recurrenceDates({
        frequency: 'daily',
        startDate: '2026-01-30',
        endDate: '2026-02-01',
        hoursPerOccurrence: 2,
        weekdays: [],
        monthDays: [],
      }),
    ).toEqual(['2026-01-30', '2026-01-31', '2026-02-01']);
    expect(
      recurrenceDates({
        frequency: 'weekly',
        startDate: '2026-01-04',
        endDate: '2026-01-12',
        hoursPerOccurrence: 1,
        weekdays: [0, 3],
        monthDays: [],
      }),
    ).toEqual(['2026-01-04', '2026-01-07', '2026-01-11']);
    expect(
      recurrenceDates({
        frequency: 'monthly',
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        hoursPerOccurrence: 1,
        weekdays: [],
        monthDays: [15, 31],
      }),
    ).toEqual(['2026-01-15', '2026-01-31', '2026-02-15', '2026-03-15', '2026-03-31']);
  });

  it('validates required frequency-specific selectors', () => {
    expect(
      recurrenceRuleError({
        frequency: 'weekly',
        startDate: '2026-01-02',
        endDate: '2026-01-01',
        hoursPerOccurrence: 1,
        weekdays: [],
        monthDays: [],
      }),
    ).toBe('重複排程的結束日期不可早於開始日期。');
    expect(
      isValidRecurrenceRule({
        frequency: 'monthly',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        hoursPerOccurrence: 1,
        weekdays: [],
        monthDays: [],
      }),
    ).toBe(false);
  });

  it('normalizes legacy arrays and rejects invalid rules', () => {
    expect(
      normalizeRecurrenceRule({
        frequency: 'weekly',
        startDate: '2026-01-01',
        endDate: '2026-01-31',
        hoursPerOccurrence: 2,
        weekdays: [4, 4, 9],
        monthDays: [1],
      }),
    ).toMatchObject({ weekdays: [4] });
    expect(normalizeRecurrenceRule({ frequency: 'daily' })).toBeNull();
  });

  it('migrates old workspaces without recurrence and preserves marked allocations', () => {
    const migrated = migrateWorkspace({
      version: 3,
      projects: [
        {
          id: 'project-a',
          name: 'Project A',
          description: '',
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
          tasks: [{ id: 'task-a', name: 'Task A' }],
        },
      ],
      dailyCapacities: [],
      allocations: [
        {
          id: 'allocation-a',
          taskId: 'task-a',
          date: '2026-01-01',
          allocatedHours: 2,
          recurrenceId: 'task-a',
        },
      ],
    });

    expect(migrated.version).toBe(CURRENT_WORKSPACE_VERSION);
    expect(migrated.projects[0].tasks[0].recurrence).toBeNull();
    expect(migrated.allocations[0]).toMatchObject({ recurrenceId: 'task-a' });
  });
});
