'use client';
import { useEffect, useState } from 'react';

const PREFS_KEY = 'carp_log_bg_prefs_v1';

export type BgPrefs = { enabled: boolean };
const DEFAULTS: BgPrefs = { enabled: true };

export function loadBgPrefs(): BgPrefs {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    // Migrate old 4-toggle shape ({aurora, ripples, particles, ...}) to single toggle.
    if (typeof parsed?.enabled === 'boolean') return { enabled: parsed.enabled };
    return DEFAULTS;
  } catch { return DEFAULTS; }
}
export function saveBgPrefs(p: BgPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {}
  window.dispatchEvent(new CustomEvent('bg-prefs-changed', { detail: p }));
}

// Deterministic pseudo-random so particle positions are stable across renders
// without needing a client-only mount guard.
function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

export default function UnderwaterScene() {
  const [prefs, setPrefs] = useState<BgPrefs>(DEFAULTS);

  useEffect(() => {
    setPrefs(loadBgPrefs());
    const onChange = (e: any) => setPrefs(e.detail || loadBgPrefs());
    window.addEventListener('bg-prefs-changed', onChange);
    return () => window.removeEventListener('bg-prefs-changed', onChange);
  }, []);

  const playState = prefs.enabled ? 'running' : 'paused';

  // 5 god-ray beams: each gets a unique horizontal start, drift duration, and
  // pulse duration so they look organic (no synced motion).
  const beams = [
    { left: '8%',  width: 90,  drift: 72, pulse: 11, delay: -8 },
    { left: '24%', width: 70,  drift: 88, pulse: 9,  delay: -3 },
    { left: '46%', width: 110, drift: 64, pulse: 13, delay: -22 },
    { left: '64%', width: 80,  drift: 80, pulse: 10, delay: -14 },
    { left: '82%', width: 95,  drift: 70, pulse: 14, delay: -6 },
  ];

  // 25 particles drifting upward through the water column.
  const particles = Array.from({ length: 25 }).map((_, i) => {
    const left = rand(i + 1) * 100;                 // 0–100% across viewport
    const dur = 25 + rand(i + 7) * 20;              // 25–45s rise
    const delay = -rand(i + 13) * dur;              // staggered start (negative offsets)
    const sway = (rand(i + 19) - 0.5) * 40;         // -20px..20px
    const size = 1 + Math.floor(rand(i + 23) * 2);  // 1 or 2 px
    const op = 0.18 + rand(i + 31) * 0.22;          // 0.18..0.4
    return { left, dur, delay, sway, size, op };
  });

  return (
    <>
      {/* Base depth gradient — static, sits behind everything. */}
      <div className="bg-water-base" />

      {/* Caustics — SVG turbulence pattern that translates very slowly. */}
      <div className="bg-water-caustics" style={{ animationPlayState: playState }}>
        <svg width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <filter id="caustic-turb" x="0" y="0">
              <feTurbulence type="fractalNoise" baseFrequency="0.012 0.018" numOctaves="2" seed="3" />
              <feColorMatrix type="matrix" values="0 0 0 0 0.85   0 0 0 0 0.96   0 0 0 0 1   0 0 0 0.5 0" />
            </filter>
          </defs>
          <rect width="100%" height="100%" filter="url(#caustic-turb)" />
        </svg>
      </div>

      {/* God rays — vertical beams of light piercing the water. */}
      <div className="bg-water-beams" aria-hidden="true">
        {beams.map((b, i) => (
          <span key={i} style={{
            left: b.left, width: b.width,
            ['--drift' as any]: `${b.drift}s`,
            ['--pulse' as any]: `${b.pulse}s`,
            animationDelay: `${b.delay}s, ${b.delay - 4}s`,
            animationPlayState: playState,
          }} />
        ))}
      </div>

      {/* Drifting particles — small dust motes rising through the column. */}
      <div className="bg-water-particles" aria-hidden="true">
        {particles.map((p, i) => (
          <span key={i} style={{
            left: `${p.left}%`,
            width: p.size, height: p.size,
            opacity: p.op,
            ['--dur' as any]: `${p.dur}s`,
            ['--delay' as any]: `${p.delay}s`,
            ['--sway' as any]: `${p.sway}px`,
            animationDelay: `${p.delay}s`,
            animationPlayState: playState,
          }} />
        ))}
      </div>
    </>
  );
}
