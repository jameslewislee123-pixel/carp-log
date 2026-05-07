'use client';
import { useEffect, useRef } from 'react';
import { motion, useMotionValue, type PanInfo } from 'framer-motion';
import { Check, Trash2 } from 'lucide-react';

// iOS-style swipe-to-reveal action row.
//
// The card content is wrapped in a horizontally-draggable motion.div that
// reveals a colored action button (default: red trash) when swiped left
// past the threshold. Open state is owned by the parent so only one row in
// a list can be open at a time. Mail.app idiom: icon-only, narrow.
//
// Two-tap arming: callers that want a confirm step set `confirming`
// when their first-tap state is armed. The icon flips to a check, and
// the next tap commits via onAction. (See TripMap, GearChecklist.)
//
// Red-leak guard: the outer container's background is set to
// `actionColor`, so any subpixel gap between the foreground and the
// container's right edge reads as the same red as the action button —
// invisibly. The opaque foreground motion.div hides the button at rest.

const BUTTON_WIDTH = 60;
const SWIPE_THRESHOLD = 40;
const VELOCITY_THRESHOLD = 500;

export interface SwipeableRowProps {
  children: React.ReactNode;
  // Fires when the user taps the revealed action button. Caller is
  // responsible for the confirm dialog and the actual mutation.
  onAction: () => void | Promise<void>;
  actionLabel?: string;        // aria-label only — text is no longer rendered. Default 'Delete'.
  actionColor?: string;        // default iOS red
  // When true, the icon flips to a checkmark to indicate "tap again to
  // confirm". Caller owns the timer + state.
  confirming?: boolean;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  // Must equal the inner card's border-radius. If they disagree, the
  // foreground bg shows through the corner gap as a dark ring.
  // Default 22 = the global .card class.
  borderRadius?: number;
}

export default function SwipeableRow({
  children,
  onAction,
  actionLabel = 'Delete',
  actionColor = '#ff3b30',
  confirming = false,
  isOpen,
  onOpen,
  onClose,
  borderRadius = 22,
}: SwipeableRowProps) {
  const x = useMotionValue(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync motion value to controlled open state. Lets the parent close this
  // row when another row opens, when a list re-renders, etc.
  useEffect(() => {
    x.set(isOpen ? -BUTTON_WIDTH : 0);
  }, [isOpen, x]);

  // Tap-outside-to-close. While open, any pointerdown that lands outside
  // the row closes it. Doesn't run when closed so it has no effect on
  // page-level click handling.
  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(e: PointerEvent) {
      const el = containerRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      onClose();
    }
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen, onClose]);

  function handleDragEnd(_: unknown, info: PanInfo) {
    const left = info.offset.x < -SWIPE_THRESHOLD || info.velocity.x < -VELOCITY_THRESHOLD;
    const right = info.offset.x > SWIPE_THRESHOLD * 0.5 || info.velocity.x > VELOCITY_THRESHOLD;
    if (left) onOpen();
    else if (right) onClose();
    else if (isOpen) onOpen(); // small wiggle from open state — stay open
    else onClose();
  }

  async function handleActionClick(e: React.MouseEvent) {
    e.stopPropagation();
    await onAction();
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius,
        // Container bg = action color so any subpixel gap on the right
        // edge of the foreground reads as the red trash band, not as a
        // leak of a different color.
        background: actionColor,
      }}
    >
      {/* Action button — sits at the right edge, behind the foreground row.
          No own background — the container provides the red. */}
      <button
        type="button"
        onClick={handleActionClick}
        tabIndex={isOpen ? 0 : -1}
        aria-label={confirming ? `Confirm ${actionLabel.toLowerCase()}` : actionLabel}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: BUTTON_WIDTH,
          background: 'transparent',
          border: 'none',
          color: 'white',
          fontFamily: 'inherit',
          cursor: 'pointer',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 0,
        }}
      >
        {confirming
          ? <Check size={22} strokeWidth={2.6} />
          : <Trash2 size={20} strokeWidth={2.2} />}
      </button>

      {/* Foreground row — draggable. Solid background is critical: it
          obscures the action button when the row is at rest. Without it,
          the semi-transparent .card underneath would let the color bleed
          through.
          display:flex+stretch ensures inline-block children (e.g. <button>
          cards in LakesView) fill the full row width, matching the layout
          of unwrapped name-only rows above/below in the list. */}
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -BUTTON_WIDTH, right: 0 }}
        dragElastic={{ left: 0.15, right: 0 }}
        dragMomentum={false}
        onDragEnd={handleDragEnd}
        style={{
          x,
          position: 'relative',
          zIndex: 1,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          background: 'var(--bg-0)',
          // Match container so the corner curves align with the inner
          // card. Without this the foreground's square corners pull
          // inward from the inner card's rounded corners and the bg
          // shows as a dark ring at each corner.
          borderRadius,
          touchAction: 'pan-y',
        }}
        animate={{ x: isOpen ? -BUTTON_WIDTH : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 40 }}
      >
        {children}
      </motion.div>
    </div>
  );
}
