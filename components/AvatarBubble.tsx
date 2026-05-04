'use client';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { prefetchProfile } from '@/lib/queries';

const COLORS = ['#C9A961', '#7BA888', '#D8826B', '#9A8FBF', '#7AA8C4', '#B07A3F'];

function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

export default function AvatarBubble({
  username, displayName, avatarUrl, size = 36, link = true, style, fontWeight,
}: {
  username?: string | null; displayName?: string | null; avatarUrl?: string | null;
  size?: number; link?: boolean; style?: CSSProperties; fontWeight?: number;
}) {
  const qc = useQueryClient();
  const seed = username || displayName || 'x';
  const color = colorFor(seed);
  const initial = (displayName || username || '?')[0]?.toUpperCase();
  const r = Math.round(size * 0.32);
  const inner = (
    <div style={{
      width: size, height: size, borderRadius: r,
      background: avatarUrl ? `center/cover no-repeat url("${avatarUrl}")` : color,
      color: '#1A1004', fontWeight: fontWeight ?? 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42, flexShrink: 0,
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25)',
      ...style,
    }}>
      {!avatarUrl && initial}
    </div>
  );
  if (link && username) {
    // Warm the profile cache on hover/touch so navigating in feels instant.
    const warm = () => {
      prefetchProfile(qc, username);
    };
    return (
      <Link href={`/profile/${username}`} onMouseEnter={warm} onTouchStart={warm} style={{ display: 'inline-block' }}>
        {inner}
      </Link>
    );
  }
  return inner;
}
