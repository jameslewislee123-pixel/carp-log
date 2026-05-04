'use client';
import { useEffect, useRef, useState } from 'react';

// Inline carousel for the catch detail page. One photo per "page", snap
// scrolling, simple page-dot indicator. Tapping a photo opens the parent's
// fullscreen lightbox at that index.
export default function CatchPhotoCarousel({ urls, onOpenLightbox, onError }: {
  urls: string[];
  onOpenLightbox: (i: number) => void;
  onError: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [current, setCurrent] = useState(0);

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

  if (urls.length === 1) {
    return (
      <div style={{ width: '100%', aspectRatio: '4/3', borderRadius: 18, overflow: 'hidden', background: 'rgba(10,24,22,0.5)', cursor: 'zoom-in' }}
        onClick={() => onOpenLightbox(0)}>
        <img src={urls[0]} alt="" onError={onError} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }

  return (
    <div>
      <div
        ref={scrollerRef}
        style={{
          width: '100%', aspectRatio: '4/3', borderRadius: 18, overflow: 'hidden',
          display: 'flex', overflowX: 'auto', overflowY: 'hidden',
          scrollSnapType: 'x mandatory',
          scrollbarWidth: 'none',
          background: 'rgba(10,24,22,0.5)',
          WebkitOverflowScrolling: 'touch' as any,
        }}
      >
        {urls.map((u, i) => (
          <div key={i}
            onClick={() => onOpenLightbox(i)}
            style={{
              flex: '0 0 100%', height: '100%',
              scrollSnapAlign: 'center', scrollSnapStop: 'always',
              cursor: 'zoom-in',
            }}>
            <img src={u} alt="" onError={onError}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
        ))}
      </div>
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
    </div>
  );
}
