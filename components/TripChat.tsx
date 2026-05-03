'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Loader2, Trash2 } from 'lucide-react';
import * as db from '@/lib/db';
import type { Profile, TripMessage } from '@/lib/types';
import { supabase } from '@/lib/supabase/client';
import AvatarBubble from './AvatarBubble';

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 30) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = new Date(iso);
  const today = new Date();
  const yest  = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `Yesterday ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderWithMentions(text: string) {
  const parts = text.split(/(@[a-z0-9_]{3,20})/gi);
  return parts.map((p, i) => p.startsWith('@')
    ? <span key={i} style={{ color: 'var(--gold-2)', fontWeight: 600 }}>{p}</span>
    : <span key={i}>{p}</span>);
}

export default function TripChat({ tripId, me, profilesById, ownerId }: {
  tripId: string;
  me: Profile;
  profilesById: Record<string, Profile>;
  ownerId: string;
}) {
  const [messages, setMessages] = useState<TripMessage[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>(profilesById);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    const ms = await db.listTripMessages(tripId);
    setMessages(ms);
    const need = Array.from(new Set(ms.map(m => m.angler_id))).filter(id => !profiles[id]);
    if (need.length > 0) {
      const ps = await db.listProfilesByIds(need);
      setProfiles(prev => { const out = { ...prev }; ps.forEach(p => out[p.id] = p); return out; });
    }
    setLoading(false);
    requestAnimationFrame(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); });
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tripId]);

  // Realtime subscription
  useEffect(() => {
    const ch = supabase()
      .channel(`trip-chat-${tripId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trip_messages', filter: `trip_id=eq.${tripId}` },
        async (payload) => {
          const msg = payload.new as TripMessage;
          setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg]);
          if (!profiles[msg.angler_id]) {
            const ps = await db.listProfilesByIds([msg.angler_id]);
            setProfiles(prev => { const out = { ...prev }; ps.forEach(p => out[p.id] = p); return out; });
          }
          requestAnimationFrame(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); });
        })
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'trip_messages', filter: `trip_id=eq.${tripId}` },
        (payload) => {
          const old = payload.old as Partial<TripMessage>;
          if (old.id) setMessages(prev => prev.filter(m => m.id !== old.id));
        })
      .subscribe();
    return () => { supabase().removeChannel(ch); };
  /* eslint-disable-next-line */
  }, [tripId]);

  async function send() {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try {
      await db.sendTripMessage(tripId, t);
      setText('');
    } catch (e: any) {
      alert(e?.message || 'Failed to send');
    } finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '60vh', minHeight: 360, border: '1px solid rgba(234,201,136,0.14)', borderRadius: 18, overflow: 'hidden', background: 'rgba(10,24,22,0.4)' }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 10, overscrollBehavior: 'contain' }}>
        {loading ? (
          <div style={{ margin: 'auto' }}><Loader2 size={20} className="spin" style={{ color: 'var(--text-3)' }} /></div>
        ) : messages.length === 0 ? (
          <p style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center', margin: 'auto' }}>No messages yet — say hi to the crew.</p>
        ) : messages.map((m, i) => {
          const author = profiles[m.angler_id];
          const mine = m.angler_id === me.id;
          const canDelete = mine || me.id === ownerId;
          const showAuthor = i === 0 || messages[i - 1].angler_id !== m.angler_id;
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: mine ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 8 }}>
              {!mine && (
                <div style={{ width: 26, opacity: showAuthor ? 1 : 0 }}>
                  {showAuthor && <AvatarBubble username={author?.username} displayName={author?.display_name} avatarUrl={author?.avatar_url} size={26} link={!!author?.username} />}
                </div>
              )}
              <div style={{ maxWidth: '78%' }}>
                {!mine && showAuthor && (
                  <div style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 700, marginBottom: 2, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{author?.display_name || 'Unknown'}</div>
                )}
                <div style={{
                  display: 'inline-block', padding: '8px 12px',
                  borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                  background: mine ? 'rgba(212,182,115,0.18)' : 'rgba(28,60,54,0.55)',
                  border: `1px solid ${mine ? 'var(--gold)' : 'rgba(234,201,136,0.14)'}`,
                  color: 'var(--text)', fontSize: 14, lineHeight: 1.4,
                  backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {renderWithMentions(m.text)}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2, textAlign: mine ? 'right' : 'left', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  {relTime(m.created_at)}
                  {canDelete && (
                    <button onClick={() => { if (confirm('Delete message?')) db.deleteTripMessage(m.id); }}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-3)', padding: 0, cursor: 'pointer', display: 'inline-flex' }}>
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid rgba(234,201,136,0.14)', background: 'rgba(5,14,13,0.4)' }}>
        <input className="input" placeholder="Message the crew… use @username to ping" value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          style={{ flex: 1, padding: '10px 14px', fontSize: 14 }} />
        <button onClick={send} disabled={!text.trim() || busy} className="tap" style={{
          width: 44, height: 44, borderRadius: 12,
          background: text.trim() ? 'var(--gold)' : 'rgba(20,42,38,0.7)',
          color: text.trim() ? '#1A1004' : 'var(--text-3)',
          border: 'none', cursor: text.trim() ? 'pointer' : 'not-allowed',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />}</button>
      </div>
    </div>
  );
}
