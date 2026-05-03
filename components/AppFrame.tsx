'use client';
import { useRouter, usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';

export function PageHeader({ title, kicker, right, back }: { title: string; kicker?: string; right?: ReactNode; back?: boolean }) {
  const router = useRouter();
  return (
    <div style={{ paddingTop: 'max(24px, env(safe-area-inset-top))', paddingLeft: 20, paddingRight: 20, paddingBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
        {back && (
          <button onClick={() => router.back()} className="tap" style={{
            background: 'rgba(10,24,22,0.5)', border: '1px solid rgba(234,201,136,0.14)',
            borderRadius: 12, width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-2)', cursor: 'pointer',
          }}>
            <ArrowLeft size={18} />
          </button>
        )}
        <div style={{ minWidth: 0 }}>
          {kicker && <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 600 }}>{kicker}</div>}
          <h1 className="display-font" style={{ fontSize: 30, margin: '2px 0 0', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{title}</h1>
        </div>
      </div>
      {right}
    </div>
  );
}
