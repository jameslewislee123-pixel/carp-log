'use client';
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAnyModalOpen } from './CarpApp';

// Lightweight pull-to-refresh wrapper. Wraps full-page content (where the
// page scroll is the window). Detects touchstart at scrollY === 0, follows
// the finger up to MAX_PULL with a rubber-band feel, and on release past
// THRESHOLD calls onRefresh and shows a spinner until the promise resolves.
//
// Suspended whenever any VaulModalShell is mounted — vaul drawers manage
// their own swipe-to-close from scrollTop=0, and a window-level PTR would
// race that gesture and trigger a refresh on every drawer dismissal.
const THRESHOLD = 80;
const MAX_PULL = 120;

export default function PullToRefresh({ onRefresh, enabled = true, children }: {
  onRefresh: () => Promise<unknown> | void;
  // Suspend the gesture entirely. Use when the wrapped content has its own
  // vertical-drag-at-top gesture (e.g. a fullscreen map's pan-north) that
  // would otherwise race the PTR.
  enabled?: boolean;
  children: React.ReactNode;
}) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const tracking = useRef(false);
  const modalOpen = useAnyModalOpen();
  const modalOpenRef = useRef(modalOpen);
  modalOpenRef.current = modalOpen;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      if (refreshing) return;
      if (!enabledRef.current) return;
      if (modalOpenRef.current) return;
      // Only arm when at the very top of the page.
      if (window.scrollY > 2) return;
      startY.current = e.touches[0].clientY;
      tracking.current = true;
    }
    function onTouchMove(e: TouchEvent) {
      if (!tracking.current || startY.current == null) return;
      if (!enabledRef.current) { tracking.current = false; setPull(0); return; }
      if (modalOpenRef.current) { tracking.current = false; setPull(0); return; }
      // Bail if the page has scrolled away from the top during the gesture.
      if (window.scrollY > 2) { tracking.current = false; setPull(0); return; }
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) { setPull(0); return; }
      // Rubber-band: square-root falloff past MAX_PULL.
      const eased = dy < MAX_PULL ? dy : MAX_PULL + Math.sqrt(dy - MAX_PULL) * 4;
      setPull(eased);
      // Don't preventDefault — letting the browser bounce keeps scroll feel
      // natural. iOS already prevents body scroll up at scrollY 0.
    }
    async function onTouchEnd() {
      if (!tracking.current) return;
      tracking.current = false;
      const reached = pull >= THRESHOLD;
      if (reached) {
        setRefreshing(true);
        try { await onRefresh(); } catch {}
        setRefreshing(false);
      }
      setPull(0);
      startY.current = null;
    }
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [pull, refreshing, onRefresh]);

  // Visible state: either actively pulling or in the post-release spinner phase.
  const indicatorOffset = refreshing ? THRESHOLD * 0.6 : pull * 0.5;
  const armed = pull >= THRESHOLD;

  return (
    <>
      {(pull > 0 || refreshing) && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed', top: 0, left: 0, right: 0,
            display: 'flex', justifyContent: 'center',
            pointerEvents: 'none', zIndex: 30,
            transform: `translateY(${indicatorOffset}px)`,
            transition: refreshing ? 'transform 0.2s ease' : 'none',
          }}
        >
          <div style={{
            marginTop: 'env(safe-area-inset-top, 0px)',
            width: 36, height: 36, borderRadius: 999,
            background: 'rgba(10,24,22,0.85)',
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(234,201,136,0.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: armed || refreshing ? 'var(--gold-2)' : 'var(--text-3)',
            transition: 'color 0.15s ease',
          }}>
            <Loader2 size={16} className={refreshing ? 'spin' : ''} style={{
              transform: refreshing ? 'none' : `rotate(${pull * 3}deg)`,
              transition: 'transform 0.05s linear',
            }} />
          </div>
        </div>
      )}
      {children}
    </>
  );
}
