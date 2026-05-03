'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';

const RULE = /^[a-z0-9_]{3,20}$/;

export default function UsernameInput({
  value, onChange, onAvailability,
}: {
  value: string;
  onChange: (s: string) => void;
  onAvailability: (status: 'idle' | 'checking' | 'available' | 'taken' | 'invalid') => void;
}) {
  const [status, setStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const u = value.trim().toLowerCase();
    if (!u) { setStatus('idle'); onAvailability('idle'); return; }
    if (!RULE.test(u)) { setStatus('invalid'); onAvailability('invalid'); return; }
    setStatus('checking'); onAvailability('checking');
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/username-check?u=${encodeURIComponent(u)}`);
        const j = await r.json();
        if (j.available) { setStatus('available'); onAvailability('available'); }
        else if (j.reason === 'invalid') { setStatus('invalid'); onAvailability('invalid'); }
        else { setStatus('taken'); onAvailability('taken'); }
      } catch { setStatus('idle'); onAvailability('idle'); }
    }, 400);
    return () => { if (tRef.current) clearTimeout(tRef.current); };
  }, [value, onAvailability]);

  return (
    <div style={{ position: 'relative', marginBottom: 4 }}>
      <input
        className="input"
        placeholder="e.g. carp_jim"
        value={value}
        onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
        maxLength={20}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        style={{ paddingRight: 40, fontFamily: 'monospace' }}
      />
      <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)' }}>
        {status === 'checking' && <Loader2 size={16} className="spin" style={{ color: 'var(--text-3)' }} />}
        {status === 'available' && <Check size={16} style={{ color: 'var(--sage)' }} />}
        {(status === 'taken' || status === 'invalid') && <X size={16} style={{ color: 'var(--danger)' }} />}
      </div>
      {status !== 'idle' && (
        <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600,
          color: status === 'available' ? 'var(--sage)'
               : status === 'checking' ? 'var(--text-3)'
               : 'var(--danger)' }}>
          {status === 'checking' && 'Checking…'}
          {status === 'available' && 'Available'}
          {status === 'taken' && 'Already taken'}
          {status === 'invalid' && '3-20 chars: lowercase a-z, 0-9, underscore'}
        </div>
      )}
    </div>
  );
}
