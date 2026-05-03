'use client';
import { useEffect, useState } from 'react';

const PREFS_KEY = 'carp_log_bg_prefs_v1';

export type BgPrefs = { aurora: boolean; ripples: boolean; particles: boolean };
const DEFAULTS: BgPrefs = { aurora: true, ripples: true, particles: true };

export function loadBgPrefs(): BgPrefs {
  if (typeof window === 'undefined') return DEFAULTS;
  try { const raw = localStorage.getItem(PREFS_KEY); if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }; } catch {}
  return DEFAULTS;
}
export function saveBgPrefs(p: BgPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {}
  window.dispatchEvent(new CustomEvent('bg-prefs-changed', { detail: p }));
}

export default function AnimatedBackground() {
  const [prefs, setPrefs] = useState<BgPrefs>(DEFAULTS);

  useEffect(() => {
    setPrefs(loadBgPrefs());
    const onChange = (e: any) => setPrefs(e.detail || loadBgPrefs());
    window.addEventListener('bg-prefs-changed', onChange);
    return () => window.removeEventListener('bg-prefs-changed', onChange);
  }, []);

  const ripples = Array.from({ length: 5 }).map((_, i) => ({
    rx: `${10 + (i * 23 + 7) % 80}%`,
    ry: `${15 + (i * 37 + 5) % 70}%`,
    dur: `${7 + (i % 3) * 2}s`,
    delay: `${(i % 4) * 1.6}s`,
  }));
  const particles = Array.from({ length: 28 }).map((_, i) => ({
    px: `${(i * 13 + 9) % 100}%`,
    pw: `${1 + (i % 3) * 0.5}px`,
    pc: i % 4 === 0 ? 'rgba(141,191,157,0.6)' : 'rgba(212,182,115,0.55)',
    pd: `${22 + (i % 5) * 5}s`,
    pdl: `${(i % 7) * 3}s`,
    ptx: `${((i % 5) - 2) * 2}vw`,
    po: 0.35 + (i % 5) * 0.1,
  }));

  return (
    <>
      {prefs.aurora && <div className="bg-aurora" />}
      {prefs.ripples && (
        <div className="bg-ripples">
          {ripples.map((r, i) => (
            <span key={i} style={{ ['--rx' as any]: r.rx, ['--ry' as any]: r.ry, ['--dur' as any]: r.dur, ['--delay' as any]: r.delay }} />
          ))}
        </div>
      )}
      {prefs.particles && (
        <div className="bg-particles">
          {particles.map((p, i) => (
            <span key={i} style={{
              ['--px' as any]: p.px, ['--pw' as any]: p.pw, ['--pc' as any]: p.pc,
              ['--pd' as any]: p.pd, ['--pdl' as any]: p.pdl, ['--ptx' as any]: p.ptx, ['--po' as any]: p.po,
            }} />
          ))}
        </div>
      )}
    </>
  );
}
