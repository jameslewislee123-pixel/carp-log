'use client';
import { type TripStatus, tripStatus } from '@/lib/types';

export default function TripStatusPill({ trip }: { trip: { start_date: string; end_date: string } }) {
  const s = tripStatus(trip);
  return <Inner status={s} />;
}

function Inner({ status }: { status: TripStatus }) {
  if (status === 'upcoming') {
    return <span className="pill" style={{ background: 'rgba(141,191,157,0.15)', color: 'var(--sage)', border: '1px solid rgba(141,191,157,0.4)' }}>Upcoming</span>;
  }
  if (status === 'active') {
    return (
      <span className="pill" style={{ background: 'rgba(212,182,115,0.18)', color: 'var(--gold-2)', border: '1px solid var(--gold)' }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--gold-2)', boxShadow: '0 0 8px var(--gold-2)', animation: 'pulse-gold 1.6s var(--spring) infinite' }} />
        Active now
      </span>
    );
  }
  return <span className="pill" style={{ background: 'rgba(120,140,132,0.15)', color: 'var(--text-3)', border: '1px solid rgba(120,140,132,0.3)' }}>Completed</span>;
}
