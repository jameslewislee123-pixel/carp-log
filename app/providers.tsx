'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useEffect, useState } from 'react';

export default function Providers({ children }: { children: React.ReactNode }) {
  // useState ensures a single QueryClient lives across React's strict-mode double mounts.
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,         // 1 min — cached data is "fresh", no auto refetch
        gcTime: 10 * 60_000,       // keep cached data 10 min after last subscriber unmounts
        refetchOnWindowFocus: true,
        retry: 1,
      },
    },
  }));

  // Global focused-input scroll-into-view. Modals are sized with 100vh so
  // they DON'T resize when the iOS keyboard opens — the keyboard simply
  // overlays the bottom portion (Instagram / iMessage pattern). When a
  // user focuses an input that ends up under the keyboard, scrollIntoView
  // brings it into view inside the modal's own scrollable body. 350ms
  // delay lets iOS finish animating the keyboard in first.
  // (The previously-paired visualViewport → --app-vh handler is
  // intentionally NOT here — it was double-counting the keyboard and
  // pushing modals around.)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return;
      window.setTimeout(() => {
        try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {}
      }, 350);
    };
    window.addEventListener('focusin', onFocus);
    return () => window.removeEventListener('focusin', onFocus);
  }, []);

  return (
    <QueryClientProvider client={client}>
      {children}
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
