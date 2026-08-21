"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { useAuth } from "@/lib/auth/AuthProvider";

/**
 * Punto d'ingresso: smista verso il login o verso la dashboard in base allo
 * stato della sessione. Il grosso della logica sta in AuthProvider.
 */
export default function HomePage() {
  const router = useRouter();
  const { session, profile, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!session) router.replace("/login");
    else router.replace(profile?.is_active ? "/dashboard" : "/attivazione");
  }, [loading, session, profile, router]);

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
      }}
    >
      <CircularProgress />
    </Box>
  );
}
