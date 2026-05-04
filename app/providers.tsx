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

  // ============================================================
  // Global iOS keyboard fix. Two effects — both fire app-wide so any
  // input/textarea/select on any screen stays above the soft keyboard.
  //
  // 1) visualViewport → --app-vh CSS var. Modal sheets (and anything else
  //    that uses calc(var(--app-vh, 100dvh) - …)) shrink to fit when the
  //    keyboard opens, instead of being shoved off the top of the screen.
  //
  // 2) focusin (window-level, bubbles from any container) scrolls the
  //    focused field into view via scrollIntoView. 350ms delay lets iOS
  //    finish animating the keyboard in before we measure positions.
  // ============================================================
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onResize = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      document.documentElement.style.setProperty('--app-vh', `${vv.height}px`);
    };

    const onFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return;
      window.setTimeout(() => {
        try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {}
      }, 350);
    };

    onResize();
    window.visualViewport?.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('scroll', onResize);
    window.addEventListener('focusin', onFocus);
    return () => {
      window.visualViewport?.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('scroll', onResize);
      window.removeEventListener('focusin', onFocus);
      document.documentElement.style.removeProperty('--app-vh');
    };
  }, []);

  return (
    <QueryClientProvider client={client}>
      {children}
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
