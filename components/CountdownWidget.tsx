'use client';
import { useEffect, useMemo, useState } from 'react';
import { Calendar, Plus } from 'lucide-react';
import type { Trip } from '@/lib/types';

// Compact countdown card sized to peer with BiteForecastCard /
// WeatherForecastCard inside ForecastCarousel. Re-renders once a minute
// — enough resolution for trip-planning, no jitter.
export default function CountdownWidget({ trips }: { trips: Trip[] }) {
  const nextTrip = useMemo(() => {
    const now = Date.now();
    const upcoming = trips
      .filter(t => +new Date(t.start_date) > now)
      .sort((a, b) => +new Date(a.start_date) - +new Date(b.start_date));
    return upcoming[0] || null;
  }, [trips]);

  const diff = useCountdown(nextTrip?.start_date);

  if (!nextTrip || !diff) {
    return (
      <div style={{
        minHeight: 92, padding: '14px 16px',
        background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)',
        borderRadius: 18,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: 12,
          background: 'rgba(212,182,115,0.12)', border: '1px solid rgba(234,201,136,0.18)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Calendar size={18} style={{ color: 'var(--gold-2)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
            Next trip
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 2 }}>
            No upcoming trips
          </div>
          <div style={{ fontSize: 12, color: 'var(--gold-2)', fontWeight: 600, marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={12} /> Create one
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: 92, padding: '14px 16px',
      background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)',
      borderRadius: 18,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 12,
        background: 'rgba(212,182,115,0.18)', border: '1px solid var(--gold)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Calendar size={18} style={{ color: 'var(--gold-2)' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
          Next trip
        </div>
        <div style={{
          fontSize: 14, color: 'var(--text)', fontWeight: 500, marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {nextTrip.name}
        </div>
        <div style={{ fontSize: 14, color: 'var(--gold-2)', fontWeight: 700, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
          {formatCountdown(diff)}
        </div>
      </div>
    </div>
  );
}

function formatCountdown(d: { days: number; hours: number; minutes: number }): string {
  if (d.days <= 0 && d.hours <= 0 && d.minutes <= 0) return 'Starting now';
  // Drop minutes once we're more than a day out — `12d 4h` is calmer than
  // `12d 4h 37m` for a number that ticks once per minute.
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
