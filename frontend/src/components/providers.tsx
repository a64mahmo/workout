'use client';

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { AuthProvider } from "@/contexts/auth-context";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Revisiting a tab within 30s shows cached data instantly with no
            // background refetch; mutations still invalidate what they change.
            staleTime: 30_000,
            gcTime: 30 * 60_000,
          },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem themes={['light', 'dark', 'oled', 'midnight', 'cobalt', 'forest', 'violet', 'rose', 'system']}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          {children}
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
