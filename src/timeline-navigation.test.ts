import { describe, expect, it } from 'vitest';
import {
  buildTimelinePeriods,
  timelineDateAtPosition,
  timelinePositionForDate,
  timelineScale,
  timelineZoomPreset,
} from './timeline';
import { createTimelineNavigation } from './timeline-navigation';

const periods = buildTimelinePeriods('2026-08-01', '2026-08-31', 'day');

function createNavigation() {
  return createTimelineNavigation({
    timelineZoom: timelineZoomPreset('day'),
    periods,
    scale: timelineScale('day', timelineZoomPreset('day').pixelsPerDay),
  });
}

describe('Timeline Navigation module', () => {
  it('centers the reference date on first layout and ignores its state echo', () => {
    const navigation = createNavigation();
    const scale = timelineScale('day', timelineZoomPreset('day').pixelsPerDay);
    const layout = navigation.applyLayout({
      key: 'day:96',
      periods,
      scale,
      viewportWidth: 240,
      scrollLeft: 0,
      referenceDate: '2026-08-10',
    });
    const expected = Math.max(0, timelinePositionForDate('2026-08-10', periods, scale) - 120);

    expect(layout).toEqual({ scrollLeft: expected });
    expect(
      navigation.syncExternalScroll({ requestedScrollLeft: expected, actualScrollLeft: 0 }),
    ).toEqual({});
    expect(
      navigation.syncExternalScroll({ requestedScrollLeft: expected, actualScrollLeft: 0 }),
    ).toEqual({ scrollLeft: expected });
  });

  it('keeps the zoom pointer date anchored across a layout change', () => {
    const navigation = createNavigation();
    const oldScale = timelineScale('day', timelineZoomPreset('day').pixelsPerDay);
    navigation.applyLayout({
      key: 'day:96',
      periods,
      scale: oldScale,
      viewportWidth: 240,
      scrollLeft: 400,
      referenceDate: '2026-08-10',
    });

    const wheel = navigation.handleWheel({
      inputMode: 'mouse',
      ctrlKey: false,
      deltaY: -100,
      deltaMode: 0,
      clientX: 180,
      boundsLeft: 20,
      scrollLeft: 400,
    });
    expect(wheel.nextZoom).toBeDefined();

    const nextZoom = wheel.nextZoom!;
    const nextScale = timelineScale(nextZoom.view, nextZoom.pixelsPerDay);
    navigation.update({ timelineZoom: nextZoom, periods, scale: nextScale });
    const layout = navigation.applyLayout({
      key: `day:${nextZoom.pixelsPerDay}`,
      periods,
      scale: nextScale,
      viewportWidth: 240,
      scrollLeft: 400,
      referenceDate: '2026-08-10',
    });
    const pointerOffset = 160;
    const anchoredDate = navigation.dateAtPointer({
      clientX: 180,
      boundsLeft: 20,
      scrollLeft: 400,
    });
    const expected = Math.max(
      0,
      timelinePositionForDate(anchoredDate, periods, nextScale) - pointerOffset,
    );

    expect(wheel).toMatchObject({ preventDefault: true, stopPropagation: true });
    expect(layout).toEqual({ scrollLeft: expected });
  });

  it('preserves the viewport center when a non-zoom layout changes', () => {
    const navigation = createNavigation();
    const oldScale = timelineScale('day', timelineZoomPreset('day').pixelsPerDay);
    navigation.applyLayout({
      key: 'day:96',
      periods,
      scale: oldScale,
      viewportWidth: 240,
      scrollLeft: 400,
      referenceDate: '2026-08-10',
    });

    const weekPeriods = buildTimelinePeriods('2026-08-01', '2026-09-30', 'week');
    const weekScale = timelineScale('week', timelineZoomPreset('week').pixelsPerDay);
    const layout = navigation.applyLayout({
      key: 'week:9.143',
      periods: weekPeriods,
      scale: weekScale,
      viewportWidth: 240,
      scrollLeft: 400,
      referenceDate: '2026-08-10',
    });
    const focusDate = timelineDateAtPosition(400 + 120, periods, oldScale);
    const expected = Math.max(0, timelinePositionForDate(focusDate, weekPeriods, weekScale) - 120);

    expect(layout.scrollLeft).toBeGreaterThanOrEqual(0);
    expect(layout.scrollLeft).toBe(expected);
  });

  it('only zooms for the configured input gesture', () => {
    const navigation = createNavigation();
    expect(
      navigation.handleWheel({
        inputMode: 'trackpad',
        ctrlKey: false,
        deltaY: -20,
        deltaMode: 0,
        clientX: 100,
        boundsLeft: 0,
        scrollLeft: 0,
      }),
    ).toEqual({});

    const zoom = navigation.handleWheel({
      inputMode: 'trackpad',
      ctrlKey: true,
      deltaY: -20,
      deltaMode: 0,
      clientX: 100,
      boundsLeft: 0,
      scrollLeft: 0,
    });
    expect(zoom.nextZoom).toBeDefined();
    expect(zoom.preventDefault).toBe(true);
  });

  it('pans immediately from the canvas and releases the pointer on end', () => {
    const navigation = createNavigation();
    expect(
      navigation.beginPan({ button: 0, target: 'canvas', clientX: 50, scrollLeft: 300 }),
    ).toEqual({ preventDefault: true, capturePointer: true, panning: true });
    expect(navigation.movePan({ clientX: 80 })).toEqual({
      preventDefault: true,
      scrollLeft: 270,
      panning: true,
    });
    expect(navigation.endPan()).toEqual({ releasePointer: true, panning: false });
  });

  it('does not let a stale external scroll echo reverse an active pan', () => {
    const navigation = createNavigation();
    navigation.beginPan({ button: 0, target: 'canvas', clientX: 50, scrollLeft: 300 });

    const moved = navigation.movePan({ clientX: 80 });
    expect(moved.scrollLeft).toBe(270);
    expect(
      navigation.syncExternalScroll({
        requestedScrollLeft: 300,
        actualScrollLeft: moved.scrollLeft!,
      }),
    ).toEqual({});

    navigation.endPan();
    expect(
      navigation.syncExternalScroll({
        requestedScrollLeft: 310,
        actualScrollLeft: moved.scrollLeft!,
      }),
    ).toEqual({ scrollLeft: 310 });
  });

  it('activates an allocation pan only after movement and suppresses its click', () => {
    const navigation = createNavigation();
    expect(
      navigation.beginPan({ button: 0, target: 'allocation', clientX: 50, scrollLeft: 300 }),
    ).toEqual({});
    expect(navigation.movePan({ clientX: 53 })).toEqual({});
    expect(navigation.movePan({ clientX: 55 })).toEqual({
      preventDefault: true,
      scrollLeft: 295,
      capturePointer: true,
      panning: true,
    });
    expect(navigation.endPan()).toEqual({
      releasePointer: true,
      panning: false,
      suppressClick: true,
    });
  });

  it('does not start a pan from interactive controls', () => {
    const navigation = createNavigation();
    expect(
      navigation.beginPan({ button: 0, target: 'interactive', clientX: 50, scrollLeft: 300 }),
    ).toEqual({});
    expect(navigation.movePan({ clientX: 80 })).toEqual({});
    expect(navigation.endPan()).toEqual({});
  });

  it('converts a pointer position into the current timeline date', () => {
    const navigation = createNavigation();
    expect(navigation.dateAtPointer({ clientX: 100, boundsLeft: 20, scrollLeft: 192 })).toBe(
      '2026-08-03',
    );
  });
});
