import { describe, expect, it } from 'vitest';
import { daysBetween, today } from './capacity';
import {
  buildTimelinePeriods,
  taskRangeGeometry,
  timelineRange,
  timelinePositionForDate,
  timelineScale,
  timelineZoomPreset,
  zoomTimeline,
} from './timeline';
import type { Task } from './types';

const task: Task = {
  id: 'task',
  name: 'Task',
  start: '2026-07-08',
  end: '2026-07-18',
  deadline: null,
  estimatedHours: 8,
  allocationStrategy: 'fastest',
  priority: 'medium',
  status: 'scheduled',
  notes: '',
  owner: '',
  color: '#2f75bb',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

describe('語意時間軸', () => {
  it('uses one logical zoom scale for day, week, and month presets', () => {
    expect(timelineScale('day', timelineZoomPreset('day').pixelsPerDay)).toBe(96);
    expect(timelineScale('week', timelineZoomPreset('week').pixelsPerDay)).toBe(64);
    expect(timelineScale('month', timelineZoomPreset('month').pixelsPerDay)).toBe(40);
  });

  it('switches semantic levels with hysteresis', () => {
    expect(zoomTimeline({ view: 'day', pixelsPerDay: 16.1 }, 0.99).view).toBe('week');
    expect(zoomTimeline({ view: 'week', pixelsPerDay: 4.1 }, 0.97).view).toBe('month');
    expect(zoomTimeline({ view: 'month', pixelsPerDay: 5 }, 1).view).toBe('week');
    expect(zoomTimeline({ view: 'week', pixelsPerDay: 20 }, 1).view).toBe('day');
  });

  it('aligns week and month periods to calendar boundaries', () => {
    const weeks = buildTimelinePeriods('2026-07-08', '2026-07-20', 'week');
    const months = buildTimelinePeriods('2026-07-08', '2026-08-20', 'month');
    expect(weeks[0]).toMatchObject({ start: '2026-07-06', end: '2026-07-12' });
    expect(months[0]).toMatchObject({ start: '2026-07-01', end: '2026-07-31' });
  });

  it('keeps a six-month planning horizon even for short task ranges', () => {
    const range = timelineRange([task], 'day');
    expect(daysBetween(range.start, range.end)).toBeGreaterThanOrEqual(180);
  });

  it('keeps a useful history window before today', () => {
    const range = timelineRange([task], 'day');
    expect(daysBetween(range.start, today())).toBeGreaterThanOrEqual(89);
  });

  it('keeps task positions at actual dates inside aggregated periods', () => {
    const periods = buildTimelinePeriods('2026-07-08', '2026-07-20', 'week');
    const scale = timelineScale('week', timelineZoomPreset('week').pixelsPerDay);
    const geometry = taskRangeGeometry(task, periods, scale);
    expect(geometry?.left).toBeCloseTo((2 / 7) * scale);
    expect(geometry?.width).toBeCloseTo(
      timelinePositionForDate('2026-07-19', periods, scale) - geometry!.left,
    );
  });
});
