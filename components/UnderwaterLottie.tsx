'use client';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import type { LottieRefCurrentProps } from 'lottie-react';

// SSR-disabled because lottie-react touches `window` on import.
const Lottie = dynamic(() => import('lottie-react'), { ssr: false });

// 0.4x of native 30fps → the 8s native loop plays over ~20s.
const PLAYBACK_SPEED = 0.4;

const STORAGE_KEY = 'bg_animation_enabled';
const TOGGLE_EVENT = 'bg-animation-toggle';

const STATIC_FALLBACK_BG = 'linear-gradient(180deg, #0F3530 0%, #050E0D 60%, #03080A 100%)';

export default function UnderwaterLottie() {
  const [animationData, setAnimationData] = useState<unknown>(null);
  const [enabled, setEnabled] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const lottieRef = useRef<LottieRefCurrentProps>(null);

  // Honour the OS-level reduced-motion preference.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // App-level toggle, stored in localStorage and broadcast via a window event
  // so Settings can flip the value live without a reload.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'false') setEnabled(false);
    } catch {}
    const handler = () => {
      try {
        const v = localStorage.getItem(STORAGE_KEY);
        setEnabled(v !== 'false');
      } catch {}
    };
    window.addEventListener(TOGGLE_EVENT, handler);
    return () => window.removeEventListener(TOGGLE_EVENT, handler);
  }, []);

  // Lazy-fetch the Lottie JSON only when we actually need to render it. Keeps
  // the JS bundle small and lets the service worker cache the file naturally.
  useEffect(() => {
    if (!enabled || reducedMotion) return;
    if (animationData) return;
    let cancelled = false;
    fetch('/backgrounds/underwater.json')
      .then(res => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json();
      })
      .then(data => { if (!cancelled) setAnimationData(data); })
      .catch(err => console.warn('Failed to load background animation:', err));
    return () => { cancelled = true; };
  }, [enabled, reducedMotion, animationData]);

  const showStatic = !enabled || reducedMotion || !animationData;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        overflow: 'hidden',
        background: STATIC_FALLBACK_BG,
      }}
    >
      {!showStatic && (
        <Lottie
          lottieRef={lottieRef}
          animationData={animationData}
          loop
          autoplay
          onDOMLoaded={() => lottieRef.current?.setSpeed(PLAYBACK_SPEED)}
          rendererSettings={{
            // 'slice' = behave like CSS background-size: cover.
            preserveAspectRatio: 'xMidYMid slice',
          }}
          style={{ width: '100%', height: '100%' }}
        />
      )}

      {/* Dark overlay so text on top of bright Lottie frames stays readable. */}
      <div
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background:
            'linear-gradient(180deg, rgba(5,14,13,0.35) 0%, rgba(5,14,13,0.55) 50%, rgba(3,8,10,0.65) 100%)',
        }}
      />
    </div>
  );
}

// Helpers for the Settings toggle so other code reads/writes through the same
// keys + event channel this component listens to.
export function readBgAnimationEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try { return localStorage.getItem(STORAGE_KEY) !== 'false'; } catch { return true; }
}
export function writeBgAnimationEnabled(enabled: boolean) {
  try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch {}
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(TOGGLE_EVENT));
}
