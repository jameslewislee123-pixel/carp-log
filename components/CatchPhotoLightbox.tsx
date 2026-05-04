'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

// Fullscreen photo viewer for catches with multiple photos. Outer scroll-
// snap handles horizontal swipe between photos; each panel hosts its own
// TransformWrapper for pinch-zoom on that specific image. When a panel is
// not the active one, its zoom resets so swiping back lands at fit.
export default function CatchPhotoLightbox({ urls, startIndex, onClose }: {
  urls: string[]; startIndex: number; onClose: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [current, setCurrent] = useState(Math.max(0, Math.min(urls.length - 1, startIndex)));

  // Lock body scroll + close on Escape.
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Jump to the requested start index after mount.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: startIndex * el.clientWidth, behavior: 'auto' });
  }, [startIndex]);

  // Track the active page so the dot indicator + arrow buttons reflect it.
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

  function jumpTo(i: number) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  }

  return (
    <div
      onClick={onClose}
      className="fade-in"
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.95)',
      }}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close"
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top, 0px) + 16px)',
          right: 16, zIndex: 3,
          width: 40, height: 40, borderRadius: 999,
          background: 'rgba(20,20,20,0.7)',
          border: '1px solid rgba(255,255,255,0.18)',
          color: '#FFF',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', padding: 0,
        }}
      >
        <X size={18} />
      </button>

      {urls.length > 1 && current > 0 && (
        <button onClick={(e) => { e.stopPropagation(); jumpTo(current - 1); }}
          aria-label="Previous photo"
          style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', zIndex: 3,
            width: 40, height: 40, borderRadius: 999,
            background: 'rgba(20,20,20,0.7)', border: '1px solid rgba(255,255,255,0.18)', color: '#FFF',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
          }}>
          <ChevronLeft size={20} />
        </button>
      )}
      {urls.length > 1 && current < urls.length - 1 && (
        <button onClick={(e) => { e.stopPropagation(); jumpTo(current + 1); }}
          aria-label="Next photo"
          style={{
            position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', zIndex: 3,
            width: 40, height: 40, borderRadius: 999,
            background: 'rgba(20,20,20,0.7)', border: '1px solid rgba(255,255,255,0.18)', color: '#FFF',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
          }}>
          <ChevronRight size={20} />
        </button>
      )}

      <div
        ref={scrollerRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', height: '100%',
          display: 'flex', overflowX: 'auto', overflowY: 'hidden',
          scrollSnapType: 'x mandatory',
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch' as any,
        }}
      >
        {urls.map((u, i) => (
          <div key={i} style={{
            flex: '0 0 100%', width: '100vw', height: '100%',
            scrollSnapAlign: 'center', scrollSnapStop: 'always',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <TransformWrapper
              minScale={1} maxScale={4} initialScale={1} centerOnInit
              doubleClick={{ mode: 'toggle', step: 2 }}
              wheel={{ step: 0.2 }}
              pinch={{ step: 5 }}
              // While not the active page, panning inside the zoom wrapper
              // would block horizontal scroll-snap; disable it on inactive panes.
              panning={{ disabled: i !== current }}
            >
              <TransformComponent
                wrapperStyle={{ width: '100%', height: '100%' }}
                contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <img
                  src={u} alt=""
                  draggable={false}
                  style={{ maxWidth: '100vw', maxHeight: '100vh', objectFit: 'contain', userSelect: 'none' }}
                />
              </TransformComponent>
            </TransformWrapper>
          </div>
        ))}
      </div>

      {urls.length > 1 && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
          left: 0, right: 0,
          display: 'flex', justifyContent: 'center', gap: 6, zIndex: 3,
        }}>
          {urls.map((_, i) => (
            <span key={i} style={{
              width: i === current ? 18 : 6, height: 6, borderRadius: 999,
              background: i === current ? '#FFF' : 'rgba(255,255,255,0.4)',
              transition: 'width 0.2s ease, background 0.2s ease',
            }} />
          ))}
        </div>
      )}
    </div>
  );
}
