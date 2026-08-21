"use client";

import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import AppShell from "@/components/AppShell";
import { useAuth } from "@/lib/auth/AuthProvider";

/**
 * Layout dell'area autenticata. Mostra un caricamento finche' AuthProvider non
 * ha risolto sessione e profilo; i reindirizzamenti sono gestiti li'.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  const { loading, profile } = useAuth();

  if (loading || !profile?.is_active) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  return <AppShell>{children}</AppShell>;
}
