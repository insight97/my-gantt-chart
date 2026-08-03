import { describe, expect, it } from 'vitest';
import { daysBetween, today } from './capacity';
import {
  buildTimelinePeriods,
  dropPreviewGeometry,
  periodAvailableHours,
  periodDisplayLabel,
  timelineRange,
  timelinePositionForDate,
  timelineScale,
  timelineZoomPreset,
  zoomTimeline,
  zoomTimelineByWheelDelta,
} from './timeline';
import type { Task } from './types';

const task: Task = {
  id: 'task',
  name: 'Task',
  start: '2026-07-08',
  end: '2026-07-18',
  deadline: null,
  estimatedHours: 8,
  estimatedHoursMode: 'manual',
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

  it('uses wheel distance for proportional zoom instead of a fixed step per event', () => {
    const current = timelineZoomPreset('week');
    const smallDelta = zoomTimelineByWheelDelta(current, -10);
    const largeDelta = zoomTimelineByWheelDelta(current, -100);

    expect(smallDelta.pixelsPerDay).toBeGreaterThan(current.pixelsPerDay);
    expect(largeDelta.pixelsPerDay).toBeGreaterThan(smallDelta.pixelsPerDay);
    expect(largeDelta.pixelsPerDay).toBeCloseTo(current.pixelsPerDay * Math.exp(0.12), 3);
  });

  it('aligns week and month periods to calendar boundaries', () => {
    const weeks = buildTimelinePeriods('2026-07-08', '2026-07-20', 'week');
    const months = buildTimelinePeriods('2026-07-08', '2026-08-20', 'month');
    expect(weeks[0]).toMatchObject({ start: '2026-07-06', end: '2026-07-12' });
    expect(months[0]).toMatchObject({ start: '2026-07-01', end: '2026-07-31' });
  });

  it('uses a complete week range at regular header density', () => {
    const week = buildTimelinePeriods('2026-07-08', '2026-07-20', 'week')[0];

    expect(periodDisplayLabel(week, 'week', 64)).toBe('7/6–7/12');
    expect(periodDisplayLabel(week, 'week', 40)).toBe('7/6–12');
  });

  it('以期間天數乘以固定每日 24 小時計算容量', () => {
    const periods = buildTimelinePeriods('2026-07-08', '2026-07-20', 'week');
    expect(periodAvailableHours(periods[0])).toBe(7 * 24);
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
    const geometry = dropPreviewGeometry(task, periods, scale);
    expect(geometry?.left).toBeCloseTo((2 / 7) * scale);
    expect(geometry?.width).toBeCloseTo(
      timelinePositionForDate('2026-07-19', periods, scale) - geometry!.left,
    );
  });
});
