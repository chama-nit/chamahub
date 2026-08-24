"use client";

import type { ReactNode } from "react";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { ToastProvider } from "@/components/ToastProvider";
import theme from "@/lib/theme";

/**
 * Radice dei provider client: cache Emotion compatibile con l'App Router,
 * tema MUI, notifiche e contesto di autenticazione.
 */
export default function Providers({ children }: { children: ReactNode }) {
  return (
    <AppRouterCacheProvider options={{ key: "mui", enableCssLayer: true }}>
      {/* defaultMode="dark": alla prima visita si parte dal tema scuro; da li'
          in poi vale la scelta della persona, ricordata da MUI in
          localStorage e riapplicata prima del primo disegno dallo script in
          app/layout.tsx. */}
      <ThemeProvider theme={theme} defaultMode="dark">
        <CssBaseline />
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
