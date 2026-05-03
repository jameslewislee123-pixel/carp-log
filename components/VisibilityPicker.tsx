'use client';
import { Globe, Lock, Users } from 'lucide-react';
import type { CatchVisibility } from '@/lib/types';

const OPTIONS: { id: CatchVisibility; label: string; icon: any; tone: string }[] = [
  { id: 'public',  label: 'Public',  icon: Globe, tone: 'var(--sage)' },
  { id: 'friends', label: 'Friends', icon: Users, tone: 'var(--gold)' },
  { id: 'private', label: 'Only me', icon: Lock,  tone: 'var(--text-2)' },
];

export default function VisibilityPicker({ value, onChange }: { value: CatchVisibility; onChange: (v: CatchVisibility) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {OPTIONS.map(o => {
        const Icon = o.icon;
        const active = value === o.id;
        return (
          <button key={o.id} onClick={() => onChange(o.id)} className="tap" style={{
            flex: 1, padding: '10px 6px', borderRadius: 12,
            border: `1px solid ${active ? o.tone : 'rgba(234,201,136,0.18)'}`,
            background: active ? `color-mix(in srgb, ${o.tone} 18%, transparent)` : 'rgba(10,24,22,0.5)',
            color: active ? o.tone : 'var(--text-2)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Icon size={13} /> {o.label}
          </button>
        );
      })}
    </div>
  );
}
