'use client';
import { useEffect, useMemo, useState } from 'react';
import { Calendar } from 'lucide-react';
import type { Trip } from '@/lib/types';

// Compact countdown card. Container styling matches BiteForecastCard /
// WeatherForecastCard exactly — `.card` glass surface + inline
// `height: '100%'` + `padding: 14` — so the three slides in the
// ForecastCarousel are visually indistinguishable in their chrome.
// Internal flex layout (icon · eyebrow + display value + subtitle)
// also mirrors the other two for left/right alignment with them.
export default function CountdownWidget({ trips }: { trips: Trip[] }) {
  const nextTrip = useMemo(() => {
    const now = Date.now();
    return [...trips]
      .filter(t => +new Date(t.start_date) > now)
      .sort((a, b) => +new Date(a.start_date) - +new Date(b.start_date))[0] || null;
  }, [trips]);

  const diff = useCountdown(nextTrip?.start_date);

  return (
    <div className="fade-in card" style={{ height: '100%', padding: 14, cursor: 'default' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          fontSize: 36, lineHeight: 1, width: 36, height: 36,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--gold-2)',
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))',
        }}>
          <Calendar size={30} strokeWidth={1.6} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--gold-2)', fontWeight: 700 }}>
            Next trip
          </div>
          {nextTrip && diff ? (
            <>
              <div className="display-font" style={{
                fontSize: 18, color: 'var(--text)', fontWeight: 500, lineHeight: 1.1,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {nextTrip.name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
                {formatCountdown(diff)}
              </div>
            </>
          ) : (
            <>
              <div className="display-font" style={{ fontSize: 18, color: 'var(--text)', fontWeight: 500, lineHeight: 1.1 }}>
                None planned
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                Tap to create one
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function formatCountdown(d: { days: number; hours: number; minutes: number }): string {
  if (d.days <= 0 && d.hours <= 0 && d.minutes <= 0) return 'Starting now';
  // Drop minutes once we're more than a day out — a number that ticks
  // every minute is calmer as `12d 4h` than `12d 4h 37m`.
  if (d.days > 0) return `${d.days}d ${d.hours}h`;
  return `${d.hours}h ${d.minutes}m`;
}

function useCountdown(startDate: string | undefined) {
  const [diff, setDiff] = useState<{ days: number; hours: number; minutes: number } | null>(null);
  useEffect(() => {
    if (!startDate) { setDiff(null); return; }
    function tick() {
      const ms = +new Date(startDate!) - Date.now();
      if (ms <= 0) { setDiff({ days: 0, hours: 0, minutes: 0 }); return; }
      const days = Math.floor(ms / 86_400_000);
      const hours = Math.floor((ms / 3_600_000) % 24);
      const minutes = Math.floor((ms / 60_000) % 60);
      setDiff({ days, hours, minutes });
    }
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [startDate]);
  return diff;
}
