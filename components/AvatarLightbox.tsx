'use client';
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

export default function AvatarLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fade-in"
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.95)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close"
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top, 0px) + 16px)',
          right: 16, zIndex: 2,
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
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', height: '100%' }}>
        <TransformWrapper
          minScale={1}
          maxScale={4}
          initialScale={1}
          centerOnInit
          doubleClick={{ mode: 'toggle', step: 2 }}
          wheel={{ step: 0.2 }}
          pinch={{ step: 5 }}
        >
          <TransformComponent
            wrapperStyle={{ width: '100%', height: '100%' }}
            contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <img
              src={src}
              alt=""
              style={{ maxWidth: '100vw', maxHeight: '100vh', objectFit: 'contain', userSelect: 'none' }}
              draggable={false}
            />
          </TransformComponent>
        </TransformWrapper>
      </div>
    </div>
  );
}
