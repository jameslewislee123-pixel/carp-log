'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import * as db from '@/lib/db';
import type { Profile } from '@/lib/types';
import AvatarBubble from './AvatarBubble';

export default function InvitePicker({
  meId, excludeIds = [], selected, onChange,
}: {
  meId: string;
  excludeIds?: string[];
  selected: Profile[];
  onChange: (rows: Profile[]) => void;
}) {
  const [friends, setFriends] = useState<Profile[]>([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      const f = await db.listAcceptedFriends(meId);
      setFriends(f.filter(p => !excludeIds.includes(p.id)));
    })();
  }, [meId, excludeIds.join('|')]); // eslint-disable-line

  useEffect(() => {
    if (tRef.current) clearTimeout(tRef.current);
    if (!query.trim()) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    tRef.current = setTimeout(async () => {
      const res = await db.searchProfiles(query);
      const filtered = res.filter(p => p.id !== meId && !excludeIds.includes(p.id));
      setSearchResults(filtered);
      setSearching(false);
    }, 350);
    return () => { if (tRef.current) clearTimeout(tRef.current); };
  }, [query, meId, excludeIds.join('|')]); // eslint-disable-line

  const selectedById = useMemo(() => new Set(selected.map(p => p.id)), [selected]);
  const toggle = (p: Profile) => {
    if (selectedById.has(p.id)) onChange(selected.filter(x => x.id !== p.id));
    else onChange([...selected, p]);
  };

  const list = query.trim() ? searchResults : friends;

  return (
    <>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {selected.map(p => (
            <span key={p.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px 5px 5px',
              borderRadius: 999, border: '1px solid var(--gold)',
              background: 'rgba(212,182,115,0.16)', color: 'var(--gold-2)', fontSize: 12, fontWeight: 600,
            }}>
              <AvatarBubble username={p.username} displayName={p.display_name} avatarUrl={p.avatar_url} size={20} link={false} />
              {p.display_name}
              <button onClick={() => toggle(p)} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, marginLeft: 2, display: 'inline-flex' }}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search size={14} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
        <input className="input" placeholder="Search by username…" value={query} onChange={(e) => setQuery(e.target.value)}
          autoCapitalize="none" autoCorrect="off" spellCheck={false}
          style={{ paddingLeft: 38, fontSize: 14 }} />
      </div>

      {list.length === 0 && !searching && (
        <p style={{ color: 'var(--text-3)', fontSize: 12, textAlign: 'center', padding: '14px 0' }}>
          {query.trim() ? 'No anglers found' : 'You have no friends yet — search by username above.'}
        </p>
      )}

      {searching && <p style={{ color: 'var(--text-3)', fontSize: 12, textAlign: 'center' }}>Searching…</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
        {list.map(p => {
          const on = selectedById.has(p.id);
          return (
            <button key={p.id} onClick={() => toggle(p)} className="tap" style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12,
              background: on ? 'rgba(212,182,115,0.10)' : 'rgba(10,24,22,0.5)',
              border: `1px solid ${on ? 'var(--gold)' : 'rgba(234,201,136,0.14)'}`,
              color: 'var(--text)', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <AvatarBubble username={p.username} displayName={p.display_name} avatarUrl={p.avatar_url} size={32} link={false} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{p.display_name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>@{p.username}</div>
              </div>
              {on && <Check size={16} style={{ color: 'var(--gold)' }} />}
            </button>
          );
        })}
      </div>
    </>
  );
}
