'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState } from 'react';

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

  // Note: we previously had a window-level visualViewport handler that
  // wrote --app-vh into the modal heights, plus a focusin → scrollIntoView
  // helper. Both have been removed. Modals now use 100dvh which already
  // tracks the visible viewport on iOS 16.4+, and vaul's repositionInputs
  // is re-enabled so the keyboard avoidance is back to the platform's
  // native behaviour. Keeping the JS handler caused the modal to be
  // shifted DOWN when typing because it doubled-counted the keyboard.

  return (
    <QueryClientProvider client={client}>
      {children}
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
