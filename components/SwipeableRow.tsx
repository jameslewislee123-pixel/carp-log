'use client';
import { useEffect, useRef } from 'react';
import { motion, useMotionValue, type PanInfo } from 'framer-motion';
import { Trash2 } from 'lucide-react';

// iOS-style swipe-to-reveal action row.
//
// The card content is wrapped in a horizontally-draggable motion.div that
// reveals a colored action button (Delete / Leave / Remove) when swiped left
// past the threshold. Open state is owned by the parent so only one row in
// a list can be open at a time.

const BUTTON_WIDTH = 88;
const SWIPE_THRESHOLD = 70;
const VELOCITY_THRESHOLD = 500;

export interface SwipeableRowProps {
  children: React.ReactNode;
  // Fires when the user taps the revealed action button. Caller is
  // responsible for the confirm dialog and the actual mutation.
  onAction: () => void | Promise<void>;
  actionLabel?: string;        // default 'Delete'
  actionColor?: string;        // default red
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}

export default function SwipeableRow({
  children,
  onAction,
  actionLabel = 'Delete',
  actionColor = '#ff3b30',
  isOpen,
  onOpen,
  onClose,
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
        borderRadius: 22,
      }}
    >
      {/* Action button — sits at the right edge, behind the foreground row.
          Hidden at rest because the opaque motion.div on top covers it. */}
      <div
        aria-hidden={!isOpen}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: BUTTON_WIDTH,
          background: actionColor,
          zIndex: 0,
        }}
      >
        <button
          type="button"
          onClick={handleActionClick}
          tabIndex={isOpen ? 0 : -1}
          aria-label={actionLabel}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'white',
            fontFamily: 'inherit',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            padding: 0,
          }}
        >
          <Trash2 size={20} strokeWidth={2.2} />
          <span>{actionLabel}</span>
        </button>
      </div>

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
          background: '#0A1816',
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
