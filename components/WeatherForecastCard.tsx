'use client';
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Cloud, Wind, Thermometer, Droplets, ArrowDown, ArrowUp } from 'lucide-react';
import { fetchExtendedForecast, weatherCodeEmoji, weatherCodeLabel, type ForecastBundle } from '@/lib/weather';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function WeatherForecastCard({ coords }: { coords: { lat: number; lng: number } | null }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ForecastBundle | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!coords) return;
    (async () => {
      const f = await fetchExtendedForecast(coords.lat, coords.lng);
      if (!cancelled) setData(f);
    })();
    return () => { cancelled = true; };
  }, [coords]);

  // Slice next-12 hourly starting from "now" hour.
  const next12 = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const startIdx = data.hourly.time.findIndex(t => t.getTime() >= now);
    const i = startIdx === -1 ? 0 : startIdx;
    return {
      time: data.hourly.time.slice(i, i + 12),
      temp: data.hourly.temp.slice(i, i + 12),
      pop:  data.hourly.pop.slice(i, i + 12),
      code: data.hourly.code.slice(i, i + 12),
    };
  }, [data]);

  // Pressure window: 24h past + 24h future (roughly the index range we asked the API for).
  const pressureSeries = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const allTimes = data.hourly.time;
    const allP = data.hourly.pressure;
    if (allTimes.length === 0 || allP.length === 0) return null;
    const fromIdx = allTimes.findIndex(t => t.getTime() >= now - 24 * 3600_000);
    const toIdx   = allTimes.findIndex(t => t.getTime() >  now + 24 * 3600_000);
    const start = fromIdx === -1 ? 0 : fromIdx;
    const end   = toIdx === -1 ? allTimes.length : toIdx;
    const times = allTimes.slice(start, end);
    const pres  = allP.slice(start, end);
    if (times.length < 2) return null;
    const min = Math.min(...pres);
    const max = Math.max(...pres);
    const span = Math.max(4, max - min);
    const nowIdx = times.findIndex(t => t.getTime() >= now);
    return { times, pres, min, max, span, nowIdx: nowIdx === -1 ? times.length - 1 : nowIdx };
  }, [data]);

  // Pressure trend over the next 6h (rising / falling / steady)
  const pressureTrend = useMemo(() => {
    if (!data || data.hourly.pressure.length < 8) return null;
    const now = Date.now();
    const i = data.hourly.time.findIndex(t => t.getTime() >= now);
    const start = i === -1 ? 0 : i;
    const a = data.hourly.pressure[start];
    const b = data.hourly.pressure[start + 6];
    if (a == null || b == null) return null;
    const delta = b - a;
    if (delta < -1.5) return { dir: 'falling' as const, delta };
    if (delta >  1.5) return { dir: 'rising' as const,  delta };
    return { dir: 'steady' as const, delta };
  }, [data]);

  if (!coords) return null;
  if (!data) {
    return (
      <div style={{
        padding: 14, borderRadius: 22, minHeight: 92,
        background: 'rgba(28,60,54,0.55)', border: '1px solid rgba(234,201,136,0.14)',
        backdropFilter: 'blur(28px) saturate(180%)', WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ color: 'var(--text-3)', fontSize: 12 }}>Loading weather…</span>
      </div>
    );
  }

  const c = data.current;
  const today = data.daily.time[0] || new Date();

  return (
    <div onClick={() => setOpen(o => !o)} className="fade-in card" style={{ padding: 14, cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 36, lineHeight: 1 }}>{c.code != null ? weatherCodeEmoji(c.code, c.isDay) : '☁️'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--gold-2)', fontWeight: 700 }}>Weather</div>
          <div className="display-font" style={{ fontSize: 18, color: 'var(--text)', fontWeight: 500, lineHeight: 1.1 }}>
            {c.temp != null ? `${c.temp}°C` : '—'} · {c.code != null ? weatherCodeLabel(c.code) : ''}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
            Feels like {c.apparent != null ? `${c.apparent}°C` : '—'}{c.windDir ? ` · Wind ${c.windDir}${c.windSpeed != null ? ` ${c.windSpeed}km/h` : ''}` : ''}
          </div>
        </div>
        <ChevronRight size={16} style={{ color: 'var(--text-3)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
      </div>

      {open && (
        <div className="fade-in" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(234,201,136,0.18)' }}>
          {/* Current detail row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 14 }}>
            <Stat icon={<Thermometer size={11} />} label="Feels" value={c.apparent != null ? `${c.apparent}°` : '—'} />
            <Stat icon={<Droplets size={11} />} label="Humidity" value={c.humidity != null ? `${c.humidity}%` : '—'} />
            <Stat icon={<Cloud size={11} />} label="Pressure" value={c.pressure != null ? `${c.pressure}` : '—'} sub={pressureTrend ? trendLabel(pressureTrend.dir) : undefined} />
            <Stat icon={<Wind size={11} />} label="Wind" value={c.windDir || '—'} sub={c.windSpeed != null ? `${c.windSpeed} km/h` : undefined} />
          </div>

          {/* 7-day strip */}
          <div className="label" style={{ marginBottom: 6 }}>7-day forecast</div>
          <div className="scrollbar-thin" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 14, paddingBottom: 4 }}>
            {data.daily.time.slice(0, 7).map((d, i) => (
              <div key={i} style={{
                flex: '0 0 56px', padding: 8, borderRadius: 12,
                background: i === 0 ? 'rgba(212,182,115,0.12)' : 'rgba(10,24,22,0.5)',
                border: `1px solid ${i === 0 ? 'var(--gold)' : 'rgba(234,201,136,0.14)'}`,
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  {i === 0 ? 'Today' : DAY_LABELS[d.getDay()]}
                </div>
                <div style={{ fontSize: 18, marginTop: 2 }}>{weatherCodeEmoji(data.daily.code[i] ?? 0, true)}</div>
                <div style={{ fontFamily: 'Fraunces, serif', fontSize: 14, color: 'var(--text)', marginTop: 2 }}>
                  {Math.round(data.daily.tMax[i] || 0)}°
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{Math.round(data.daily.tMin[i] || 0)}°</div>
                <div style={{ height: 3, marginTop: 4, borderRadius: 2, background: 'rgba(10,24,22,0.7)', overflow: 'hidden' }}>
                  <div style={{ width: `${data.daily.pop[i] || 0}%`, height: '100%', background: 'var(--sage)' }} />
                </div>
              </div>
            ))}
          </div>

          {/* Hourly today */}
          {next12 && (
            <>
              <div className="label" style={{ marginBottom: 6 }}>Next 12 hours</div>
              <div className="scrollbar-thin" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 14, paddingBottom: 4 }}>
                {next12.time.map((t, i) => (
                  <div key={i} style={{ flex: '0 0 50px', padding: 6, borderRadius: 10, background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.10)', textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600 }}>{t.getHours().toString().padStart(2, '0')}:00</div>
                    <div style={{ fontSize: 16, marginTop: 2 }}>{weatherCodeEmoji(next12.code[i] ?? 0, t.getHours() >= 6 && t.getHours() < 20)}</div>
                    <div style={{ fontFamily: 'Fraunces, serif', fontSize: 13, color: 'var(--text)' }}>{Math.round(next12.temp[i] || 0)}°</div>
                    <div style={{ fontSize: 9, color: 'var(--sage)' }}>{Math.round(next12.pop[i] || 0)}%</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Pressure trend chart */}
          {pressureSeries && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div className="label" style={{ marginBottom: 6 }}>Pressure trend (24h ± now)</div>
                {pressureTrend && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                    padding: '2px 8px', borderRadius: 999,
                    background: pressureTrend.dir === 'falling' ? 'rgba(141,191,157,0.15)' : pressureTrend.dir === 'rising' ? 'rgba(220,107,88,0.12)' : 'rgba(120,140,132,0.15)',
                    color: pressureTrend.dir === 'falling' ? 'var(--sage)' : pressureTrend.dir === 'rising' ? 'var(--danger)' : 'var(--text-3)',
                    border: `1px solid ${pressureTrend.dir === 'falling' ? 'rgba(141,191,157,0.4)' : pressureTrend.dir === 'rising' ? 'rgba(220,107,88,0.3)' : 'rgba(120,140,132,0.3)'}`,
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}>
                    {pressureTrend.dir === 'falling' ? <ArrowDown size={10} /> : pressureTrend.dir === 'rising' ? <ArrowUp size={10} /> : '·'}
                    {pressureTrend.dir === 'falling' ? `Falling — bites likely` : pressureTrend.dir === 'rising' ? `Rising — slow` : 'Steady'}
                  </span>
                )}
              </div>
              <PressureChart series={pressureSeries} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
                <span>-24h</span><span>now</span><span>+24h</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function trendLabel(d: 'rising' | 'falling' | 'steady') {
  return d === 'rising' ? 'rising' : d === 'falling' ? 'falling' : 'steady';
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.10)', borderRadius: 12, padding: 8, textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 4 }}>{icon}{label}</div>
      <div style={{ fontFamily: 'Fraunces, serif', fontSize: 16, color: 'var(--text)', marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{sub}</div>}
    </div>
  );
}

function PressureChart({ series }: { series: { times: Date[]; pres: number[]; min: number; max: number; span: number; nowIdx: number } }) {
  const W = 320; const H = 60;
  const n = series.times.length;
  const x = (i: number) => (i / Math.max(1, n - 1)) * W;
  const y = (p: number) => H - ((p - series.min) / series.span) * (H - 8) - 4;
  const path = series.pres.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(' ');
  const nowX = x(series.nowIdx);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 60, marginTop: 4 }}>
      <defs>
        <linearGradient id="pres" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(212,182,115,0.55)" />
          <stop offset="100%" stopColor="rgba(212,182,115,0)" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={nowX} height={H} fill="rgba(141,191,157,0.06)" />
      <path d={`${path} L ${W} ${H} L 0 ${H} Z`} fill="url(#pres)" />
      <path d={path} fill="none" stroke="var(--gold-2)" strokeWidth="1.6" strokeLinecap="round" />
      <line x1={nowX} y1="0" x2={nowX} y2={H} stroke="var(--gold)" strokeWidth="1" strokeDasharray="2 3" />
      <text x={nowX + 3} y="10" fontSize="9" fontFamily="Manrope" fill="var(--gold-2)">now</text>
    </svg>
  );
}
