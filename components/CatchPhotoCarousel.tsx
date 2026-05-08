'use client';
import { useEffect, useRef, useState } from 'react';
import { useDragToScroll } from '@/lib/useDragToScroll';

// Inline carousel.
//   variant="detail" (default) — used inside CatchDetail. Tap opens the
//     fullscreen lightbox via onOpenLightbox(index). Page dots render below
//     the photo on the page background.
//   variant="card" — used inside the feed CatchCard. Tap fires onOpenLightbox(0)
//     so the parent can react (typically to open the catch detail). Page dots
//     overlay the bottom-center of the photo so the card stays compact.
export default function CatchPhotoCarousel({ urls, variant = 'detail', onOpenLightbox, onError }: {
  urls: string[];
  variant?: 'detail' | 'card';
  onOpenLightbox: (i: number) => void;
  onError: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [current, setCurrent] = useState(0);
  useDragToScroll(scrollerRef);

  // Track current page from scroll position (one-page-wide containers, so
  // index = round(scrollLeft / clientWidth)). Throttled with rAF.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const idx = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
        setCurrent(Math.min(urls.length - 1, Math.max(0, idx)));
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [urls.length]);

  // Card variant: no rounded inner corners (photo is the top of the card),
  // dots overlay the photo, no zoom-in cursor (tap navigates).
  const isCard = variant === 'card';
  const containerRadius = isCard ? '22px 22px 0 0' : 18;

  if (urls.length === 1) {
    return (
      <div style={{ width: '100%', aspectRatio: '4/3', borderRadius: containerRadius, overflow: 'hidden', background: 'rgba(10,24,22,0.5)', cursor: isCard ? 'pointer' : 'zoom-in' }}
        onClick={() => onOpenLightbox(0)}>
        <img src={urls[0]} alt="" onError={onError} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={scrollerRef}
        // Stop horizontal-swipe gestures from bubbling to the parent (e.g.
        // the feed card's onClick) so swipe doesn't open the catch detail.
        onClick={(e) => { if (isCard) e.stopPropagation(); }}
        style={{
          width: '100%', aspectRatio: '4/3', borderRadius: containerRadius, overflow: 'hidden',
          display: 'flex', overflowX: 'auto', overflowY: 'hidden',
          scrollSnapType: 'x mandatory',
          scrollbarWidth: 'none',
          background: 'rgba(10,24,22,0.5)',
          WebkitOverflowScrolling: 'touch' as any,
        }}
      >
        {urls.map((u, i) => (
          <div key={i}
            onClick={(e) => {
              // In the card variant, tapping the visible photo should still
              // open the catch detail. Stop propagation here only matters
              // for swipe (not tap), but we also forward tap by calling
              // onOpenLightbox which the parent maps to open-detail.
              if (isCard) { e.stopPropagation(); }
              onOpenLightbox(i);
            }}
            style={{
              flex: '0 0 100%', height: '100%',
              scrollSnapAlign: 'center', scrollSnapStop: 'always',
              cursor: isCard ? 'pointer' : 'zoom-in',
            }}>
            <img src={u} alt="" onError={onError}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
        ))}
      </div>

      {isCard ? (
        // Overlay dots on the photo, semi-transparent backdrop pill.
        <div style={{
          position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', gap: 5, padding: '4px 8px', borderRadius: 999,
          background: 'rgba(5,14,13,0.55)',
          backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
          pointerEvents: 'none',
        }} aria-label={`Photo ${current + 1} of ${urls.length}`}>
          {urls.map((_, i) => (
            <span key={i} style={{
              width: i === current ? 14 : 5, height: 5, borderRadius: 999,
              background: i === current ? '#FFF' : 'rgba(255,255,255,0.55)',
              transition: 'width 0.2s ease, background 0.2s ease',
            }} />
          ))}
        </div>
      ) : (
        <div style={{
          display: 'flex', justifyContent: 'center', gap: 6,
          marginTop: 10,
        }} aria-label={`Photo ${current + 1} of ${urls.length}`}>
          {urls.map((_, i) => (
            <span key={i} style={{
              width: i === current ? 18 : 6, height: 6, borderRadius: 999,
              background: i === current ? 'var(--gold-2)' : 'rgba(234,201,136,0.35)',
              transition: 'width 0.2s ease, background 0.2s ease',
            }} />
          ))}
        </div>
      )}
    </div>
  );
}
