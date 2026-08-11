import {
  TIMELINE_MOUSE_WHEEL_ZOOM_SENSITIVITY,
  TIMELINE_TRACKPAD_ZOOM_SENSITIVITY,
  timelineDateAtPosition,
  timelinePositionForDate,
  zoomTimelineByWheelDelta,
} from './timeline';
import type { TimelinePeriod, TimelineZoom, TimelineInputMode } from './timeline';

const PAN_ACTIVATION_DISTANCE = 4;

export type TimelineNavigationSnapshot = Readonly<{
  timelineZoom: TimelineZoom;
  periods: readonly TimelinePeriod[];
  scale: number;
}>;

export type TimelineNavigationEffect = Readonly<{
  nextZoom?: TimelineZoom;
  scrollLeft?: number;
  panning?: boolean;
  capturePointer?: boolean;
  releasePointer?: boolean;
  preventDefault?: boolean;
  stopPropagation?: boolean;
  suppressClick?: boolean;
}>;

export type TimelineWheelInput = Readonly<{
  inputMode: TimelineInputMode;
  ctrlKey: boolean;
  deltaY: number;
  deltaMode: number;
  clientX: number;
  boundsLeft: number;
  scrollLeft: number;
}>;

export type TimelineLayoutInput = Readonly<{
  key: string;
  periods: readonly TimelinePeriod[];
  scale: number;
  viewportWidth: number;
  scrollLeft: number;
  referenceDate: string;
}>;

export type TimelineScrollSyncInput = Readonly<{
  requestedScrollLeft: number;
  actualScrollLeft: number;
}>;

export type TimelinePanTarget = 'canvas' | 'allocation' | 'interactive';

export type TimelinePanStartInput = Readonly<{
  button: number;
  target: TimelinePanTarget;
  clientX: number;
  scrollLeft: number;
}>;

export type TimelinePanMoveInput = Readonly<{
  clientX: number;
}>;

export type TimelinePointerDateInput = Readonly<{
  clientX: number;
  boundsLeft: number;
  scrollLeft: number;
}>;

export type TimelineNavigation = Readonly<{
  update(snapshot: TimelineNavigationSnapshot): void;
  handleWheel(input: TimelineWheelInput): TimelineNavigationEffect;
  applyLayout(input: TimelineLayoutInput): TimelineNavigationEffect;
  syncExternalScroll(input: TimelineScrollSyncInput): TimelineNavigationEffect;
  beginPan(input: TimelinePanStartInput): TimelineNavigationEffect;
  movePan(input: TimelinePanMoveInput): TimelineNavigationEffect;
  endPan(): TimelineNavigationEffect;
  dateAtPointer(input: TimelinePointerDateInput): string;
}>;

type PanSession = {
  startX: number;
  startScrollLeft: number;
  candidate: boolean;
  active: boolean;
};

type LayoutSnapshot = Readonly<{
  key: string;
  periods: readonly TimelinePeriod[];
  scale: number;
}>;

/**
 * Owns Timeline's ordering-sensitive navigation lifecycle.
 *
 * The DOM adapter supplies measurements and applies returned effects. The
 * implementation keeps zoom anchors, layout continuity, external scroll
 * synchronization, and pan activation in one stateful seam so callers do not
 * have to coordinate those rules themselves.
 */
export function createTimelineNavigation(
  initialSnapshot: TimelineNavigationSnapshot,
): TimelineNavigation {
  let snapshot = initialSnapshot;
  let previousLayout: LayoutSnapshot | null = null;
  let zoomAnchor: { date: string; pointerOffset: number } | null = null;
  let pan: PanSession | null = null;
  let skipNextExternalScrollSync = false;

  function update(nextSnapshot: TimelineNavigationSnapshot) {
    snapshot = nextSnapshot;
  }

  function handleWheel(input: TimelineWheelInput): TimelineNavigationEffect {
    const isZoomGesture = input.inputMode === 'mouse' || input.ctrlKey;
    if (!isZoomGesture || !input.deltaY) return {};

    const deltaMultiplier = input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? 100 : 1;
    const sensitivity =
      input.inputMode === 'trackpad'
        ? TIMELINE_TRACKPAD_ZOOM_SENSITIVITY
        : TIMELINE_MOUSE_WHEEL_ZOOM_SENSITIVITY;
    const nextZoom = zoomTimelineByWheelDelta(
      snapshot.timelineZoom,
      input.deltaY * deltaMultiplier,
      sensitivity,
    );
    const effect: TimelineNavigationEffect = {
      preventDefault: true,
      stopPropagation: true,
    };

    if (nextZoom.pixelsPerDay === snapshot.timelineZoom.pixelsPerDay) return effect;

    const pointerOffset = input.clientX - input.boundsLeft;
    zoomAnchor = {
      date: timelineDateAtPosition(
        input.scrollLeft + pointerOffset,
        snapshot.periods,
        snapshot.scale,
      ),
      pointerOffset,
    };
    snapshot = { ...snapshot, timelineZoom: nextZoom };
    return { ...effect, nextZoom };
  }

  function applyLayout(input: TimelineLayoutInput): TimelineNavigationEffect {
    let nextScrollLeft: number | undefined;

    if (!previousLayout) {
      nextScrollLeft = Math.max(
        0,
        timelinePositionForDate(input.referenceDate, input.periods, input.scale) -
          input.viewportWidth / 2,
      );
      skipNextExternalScrollSync = true;
    } else if (previousLayout.key !== input.key) {
      if (zoomAnchor) {
        nextScrollLeft = Math.max(
          0,
          timelinePositionForDate(zoomAnchor.date, input.periods, input.scale) -
            zoomAnchor.pointerOffset,
        );
        zoomAnchor = null;
      } else {
        const focusX = input.scrollLeft + input.viewportWidth / 2;
        const focusDate = timelineDateAtPosition(
          focusX,
          previousLayout.periods,
          previousLayout.scale,
        );
        nextScrollLeft = Math.max(
          0,
          timelinePositionForDate(focusDate, input.periods, input.scale) - input.viewportWidth / 2,
        );
      }
    }

    previousLayout = {
      key: input.key,
      periods: input.periods,
      scale: input.scale,
    };
    return nextScrollLeft === undefined ? {} : { scrollLeft: nextScrollLeft };
  }

  function syncExternalScroll(input: TimelineScrollSyncInput): TimelineNavigationEffect {
    if (skipNextExternalScrollSync) {
      skipNextExternalScrollSync = false;
      return {};
    }
    return Math.abs(input.actualScrollLeft - input.requestedScrollLeft) > 1
      ? { scrollLeft: input.requestedScrollLeft }
      : {};
  }

  function beginPan(input: TimelinePanStartInput): TimelineNavigationEffect {
    if (input.button !== 0 || input.target === 'interactive') return {};

    const active = input.target === 'canvas';
    pan = {
      startX: input.clientX,
      startScrollLeft: input.scrollLeft,
      candidate: !active,
      active,
    };
    return active ? { preventDefault: true, capturePointer: true, panning: true } : {};
  }

  function movePan(input: TimelinePanMoveInput): TimelineNavigationEffect {
    if (!pan) return {};
    let activated = false;
    if (pan.candidate && !pan.active) {
      if (Math.abs(input.clientX - pan.startX) < PAN_ACTIVATION_DISTANCE) return {};
      pan.active = true;
      activated = true;
    }
    if (!pan.active) return {};

    return {
      preventDefault: true,
      scrollLeft: pan.startScrollLeft - (input.clientX - pan.startX),
      ...(activated ? { capturePointer: true } : {}),
      panning: true,
    };
  }

  function endPan(): TimelineNavigationEffect {
    if (!pan) return {};
    const current = pan;
    pan = null;
    return {
      ...(current.active ? { releasePointer: true, panning: false } : {}),
      ...(current.active && current.candidate ? { suppressClick: true } : {}),
    };
  }

  function dateAtPointer(input: TimelinePointerDateInput) {
    return timelineDateAtPosition(
      input.clientX - input.boundsLeft + input.scrollLeft,
      snapshot.periods,
      snapshot.scale,
    );
  }

  return {
    update,
    handleWheel,
    applyLayout,
    syncExternalScroll,
    beginPan,
    movePan,
    endPan,
    dateAtPointer,
  };
}
