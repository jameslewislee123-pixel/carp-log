'use client';
import { useEffect, type RefObject } from 'react';

// Mouse-drag-to-scroll for native horizontal scrollers.
//
// Native `overflow-x: auto` containers do not respond to mouse-drag on
// desktop — only to wheel + scrollbar. This hook layers click-and-drag
// scrolling on top, scoped to mouse only so touch gestures (which the
// browser handles natively, with momentum + scroll-snap) are untouched.
// Trackpad gestures fire as wheel events, also unaffected.
//
// Click suppression: a real drag (>5px) installs a one-shot capture-phase
// click listener that swallows the click that follows mouseup, so dragging
// across a child <button> doesn't accidentally invoke it. A bare click
// (no movement) passes through normally.
export function useDragToScroll<T extends HTMLElement>(
  ref: RefObject<T | null>,
  opts: { axis?: 'x' | 'y' } = {},
) {
  const axis = opts.axis ?? 'x';
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let active = false;
    let moved = false;
    let pointerId = -1;
    let startX = 0;
    let startY = 0;
    let startScrollX = 0;
    let startScrollY = 0;
    const prevCursor = el.style.cursor;
    const prevUserSelect = el.style.userSelect;

    function suppressNextClick() {
      const onClick = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      el!.addEventListener('click', onClick, { capture: true, once: true });
      // If mouseup happens without a following click (rare), clean up.
      window.setTimeout(() => {
        el!.removeEventListener('click', onClick, { capture: true } as AddEventListenerOptions);
      }, 50);
    }

    function onPointerDown(e: PointerEvent) {
      if (e.pointerType !== 'mouse') return;
      if (e.button !== 0) return;
      active = true;
      moved = false;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startScrollX = el!.scrollLeft;
      startScrollY = el!.scrollTop;
    }

    function onPointerMove(e: PointerEvent) {
      if (!active) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > 5) {
        moved = true;
        try { el!.setPointerCapture(pointerId); } catch {}
        el!.style.cursor = 'grabbing';
        el!.style.userSelect = 'none';
      }
      if (moved) {
        if (axis === 'x') el!.scrollLeft = startScrollX - dx;
        else el!.scrollTop = startScrollY - dy;
      }
    }

    function endDrag() {
      if (!active) return;
      const wasMoved = moved;
      active = false;
      moved = false;
      try { el!.releasePointerCapture(pointerId); } catch {}
      el!.style.cursor = prevCursor;
      el!.style.userSelect = prevUserSelect;
      if (wasMoved) suppressNextClick();
    }

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endDrag);
      el.removeEventListener('pointercancel', endDrag);
    };
  }, [ref, axis]);
}
