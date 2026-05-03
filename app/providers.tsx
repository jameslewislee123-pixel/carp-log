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
  return (
    <QueryClientProvider client={client}>
      {children}
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
