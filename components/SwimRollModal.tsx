'use client';
import { useEffect, useMemo, useState } from 'react';
import { X, Sparkles, Crown, Trophy, RotateCcw } from 'lucide-react';
import type { Profile, SwimRollResult, TripSwimRoll } from '@/lib/types';
import AvatarBubble from './AvatarBubble';

const COLORS = ['#C9A961', '#7BA888', '#D8826B', '#9A8FBF', '#7AA8C4', '#B07A3F'];
function colorFor(seed: string) {
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}
const RANK_COLORS = ['#EAC988', '#C8C8B0', '#B07A3F'];

// Sequential animated reveal (mode='animate') OR final-only (mode='replay').
export default function SwimRollModal({ roll, profilesById, mode, onClose, onReroll, isOwner }: {
  roll: TripSwimRoll;
  profilesById: Record<string, Profile>;
  mode: 'animate' | 'replay';
  onClose: () => void;
  onReroll?: () => void;
  isOwner: boolean;
}) {
  const sorted = useMemo(() => [...roll.results].sort((a, b) => b.value - a.value), [roll.results]);
  const [revealedIdx, setRevealedIdx] = useState<number>(mode === 'replay' ? sorted.length : -1);
  const [phase, setPhase] = useState<'rolling' | 'final'>(mode === 'replay' ? 'final' : 'rolling');

  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);

  // Sequential animation driver. Each angler: 200ms warm-up + 1500ms tumble + 400ms settle + 250ms gap.
  useEffect(() => {
    if (mode !== 'animate') return;
    if (sorted.length === 0) { setPhase('final'); return; }
    const STEP_MS = 1700;
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setRevealedIdx(0), 250));
    for (let i = 1; i < sorted.length; i++) {
      timers.push(setTimeout(() => setRevealedIdx(i), 250 + STEP_MS * i));
    }
    timers.push(setTimeout(() => setPhase('final'), 250 + STEP_MS * sorted.length));
    return () => timers.forEach(clearTimeout);
  }, [mode, sorted.length]);

  // 18 confetti pieces
  const confetti = useMemo(() => Array.from({ length: 18 }).map((_, i) => ({
    left: `${(i * 5.5 + 4) % 100}%`,
    delay: `${(i % 6) * 0.12}s`,
    tx: `${((i % 5) - 2) * 14}vw`,
    color: i % 3 === 0 ? '#EAC988' : i % 3 === 1 ? '#8DBF9D' : '#DD8E76',
    size: 6 + (i % 4) * 2,
  })), []);

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'radial-gradient(circle at 50% 30%, rgba(20,42,38,0.92), rgba(3,10,9,0.98))',
      backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '24px', overflow: 'hidden',
    }}>
      <button onClick={onClose} aria-label="Close" style={{
        position: 'absolute', top: 'max(20px, env(safe-area-inset-top))', right: 18, zIndex: 4,
        width: 40, height: 40, borderRadius: 14,
        background: 'rgba(10,24,22,0.7)', border: '1px solid rgba(234,201,136,0.18)',
        color: 'var(--text-2)', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}><X size={18} /></button>

      {/* Confetti when revealed */}
      {phase === 'final' && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 1 }}>
          {confetti.map((c, i) => (
            <span key={i} style={{
              position: 'absolute', top: 0, left: c.left,
              width: c.size, height: c.size * 0.4, background: c.color, borderRadius: 1,
              animation: `confetti-fall 2.6s ease-out ${c.delay} forwards`,
              ['--tx' as any]: c.tx,
            }} />
          ))}
        </div>
      )}

      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', zIndex: 2, textAlign: 'center', maxWidth: 480, width: '100%' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '6px 14px', borderRadius: 999, background: 'rgba(212,182,115,0.18)', border: '1px solid rgba(234,201,136,0.45)', color: 'var(--gold-2)', fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 700 }}>
          <Sparkles size={12} /> Swim Roll
        </div>
        <h2 className="display-font" style={{ fontSize: 28, fontWeight: 500, margin: '0 0 6px', lineHeight: 1.05 }}>
          {phase === 'rolling' ? 'Rolling for swims…' : 'The pegs are picked'}
        </h2>
        <p style={{ color: 'var(--text-3)', fontSize: 13, margin: '0 0 26px' }}>
          {phase === 'rolling' ? 'Highest roll picks first.' : 'In order: highest roll picks first.'}
        </p>

        {/* Sequential rolling layout */}
        {phase === 'rolling' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
            {sorted.map((r, i) => {
              const profile = profilesById[r.angler_id];
              const isCurrent = i === revealedIdx;
              const hasRevealed = i <= revealedIdx;
              const dim = !hasRevealed && !isCurrent;
              return (
                <div key={r.angler_id} style={{
                  display: 'flex', alignItems: 'center', gap: 18,
                  padding: 14, borderRadius: 18,
                  background: isCurrent ? 'rgba(212,182,115,0.12)' : 'rgba(10,24,22,0.55)',
                  border: `1px solid ${isCurrent ? 'var(--gold)' : 'rgba(234,201,136,0.14)'}`,
                  width: '100%', maxWidth: 360,
                  transition: 'opacity 0.35s var(--spring), background 0.35s var(--spring), transform 0.35s var(--spring)',
                  opacity: dim ? 0.32 : 1,
                  transform: hasRevealed ? 'translateY(0)' : 'translateY(8px)',
                  ...(isCurrent ? { animation: 'avatar-spotlight 1.6s var(--spring) infinite' } : {}),
                }}>
                  <AvatarBubble username={profile?.username} displayName={profile?.display_name} avatarUrl={profile?.avatar_url} size={44} link={false} />
                  <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{profile?.display_name || 'Angler'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>1d20</div>
                  </div>
                  {/* Dice */}
                  <div style={{ width: 56, height: 56, position: 'relative' }}>
                    {!hasRevealed && (
                      <div style={{ width: '100%', height: '100%', borderRadius: 10, border: '1px dashed rgba(234,201,136,0.3)' }} />
                    )}
                    {(isCurrent || hasRevealed) && (
                      <div key={`dice-${i}`} style={{
                        width: 56, height: 56, borderRadius: 12,
                        background: 'linear-gradient(180deg, var(--gold-2), var(--gold))',
                        color: '#1A1004', fontFamily: 'Fraunces, serif', fontWeight: 700, fontSize: 26,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 6px 16px rgba(212,182,115,0.4), inset 0 1px 0 rgba(255,255,255,0.5)',
                        animation: isCurrent ? 'dice-tumble 1.5s ease-out forwards' : 'dice-settle 0.4s var(--spring)',
                      }}>{r.value}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Final reveal */}
        {phase === 'final' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
            {sorted.map((r, i) => {
              const profile = profilesById[r.angler_id];
              const rank = i + 1;
              const isPodium = rank <= 3;
              return (
                <div key={r.angler_id} className="fade-in" style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: 14, borderRadius: 18,
                  background: rank === 1 ? 'linear-gradient(135deg, rgba(234,201,136,0.22), rgba(212,182,115,0.06))' : 'rgba(10,24,22,0.55)',
                  border: `1px solid ${isPodium ? RANK_COLORS[rank - 1] : 'rgba(234,201,136,0.14)'}`,
                  width: '100%', maxWidth: 360,
                  position: 'relative',
                  animationDelay: `${i * 80}ms`,
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 12,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isPodium ? `${RANK_COLORS[rank - 1]}22` : 'rgba(20,42,38,0.7)',
                    border: isPodium ? `1px solid ${RANK_COLORS[rank - 1]}` : '1px solid rgba(234,201,136,0.18)',
                    color: isPodium ? RANK_COLORS[rank - 1] : 'var(--text-3)',
                    fontFamily: 'Fraunces, serif', fontWeight: 600, fontSize: 18,
                  }}>{rank}</div>
                  <AvatarBubble username={profile?.username} displayName={profile?.display_name} avatarUrl={profile?.avatar_url} size={40} link={false} />
                  <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {profile?.display_name || 'Angler'}
                      {rank === 1 && <Crown size={14} style={{ color: 'var(--gold)' }} />}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      {rank === 1 ? 'Picks first' : rank === sorted.length ? 'Picks last' : `Pick #${rank}`}
                    </div>
                  </div>
                  <div className="num-display" style={{ fontSize: 28, color: isPodium ? RANK_COLORS[rank - 1] : 'var(--text)' }}>{r.value}</div>
                </div>
              );
            })}
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button onClick={onClose} className="btn btn-primary" style={{ minWidth: 120, fontSize: 14 }}>Done</button>
              {isOwner && onReroll && (
                <button onClick={() => { if (confirm('All members will see a new roll. Continue?')) onReroll(); }}
                  className="btn btn-ghost tap" style={{ border: '1px solid rgba(234,201,136,0.18)', fontSize: 14 }}>
                  <RotateCcw size={14} /> Re-roll
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function SwimRollResultCard({ roll, profilesById, onReplay }: {
  roll: TripSwimRoll;
  profilesById: Record<string, Profile>;
  onReplay: () => void;
}) {
  const sorted = [...roll.results].sort((a, b) => b.value - a.value);
  const top = sorted[0];
  const winner = top ? profilesById[top.angler_id] : null;
  return (
    <button onClick={onReplay} className="tap fade-in" style={{
      width: '100%', textAlign: 'left',
      padding: 14, borderRadius: 18,
      background: 'linear-gradient(135deg, rgba(234,201,136,0.18), rgba(212,182,115,0.06))',
      border: '1px solid rgba(234,201,136,0.4)',
      color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
      display: 'flex', alignItems: 'center', gap: 14,
    }}>
      <div style={{ width: 38, height: 38, borderRadius: 12, background: 'rgba(212,182,115,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Trophy size={18} style={{ color: 'var(--gold-2)' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gold-2)', fontWeight: 700 }}>Swim Roll</div>
        <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600 }}>
          {winner ? <><strong>{winner.display_name}</strong> picks first ({top.value})</> : 'Roll complete'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Tap to replay</div>
      </div>
    </button>
  );
}
