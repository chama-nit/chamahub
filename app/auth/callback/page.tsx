"use client";

// ---------------------------------------------------------------------------
// Ritorno dal provider OAuth (Microsoft Entra ID)
// ---------------------------------------------------------------------------
// Il client Supabase e' configurato con `detectSessionInUrl: true` e flusso
// PKCE: intercetta da solo il parametro `code` e completa lo scambio. Qui si
// attende l'esito e si gestisce l'eventuale errore restituito dal provider.
// ---------------------------------------------------------------------------

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useAuth } from "@/lib/auth/AuthProvider";
import { describeAuthError } from "@/lib/auth/errors";

function CallbackContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { session, loading } = useAuth();
  const [timedOut, setTimedOut] = useState(false);

  const providerError = params.get("error_description") ?? params.get("error");

  useEffect(() => {
    if (providerError) return;
    const timer = setTimeout(() => setTimedOut(true), 12000);
    return () => clearTimeout(timer);
  }, [providerError]);

  useEffect(() => {
    if (!loading && session) router.replace("/dashboard");
  }, [loading, session, router]);

  if (providerError) {
    const friendly = describeAuthError(providerError);
    return (
      <Stack spacing={2} sx={{ alignItems: "center", maxWidth: 460, px: 3 }}>
        <Alert severity="error" sx={{ width: "100%" }}>
          <strong>Accesso Microsoft non riuscito.</strong>
          <Typography variant="body2" sx={{ mt: 0.75 }}>
            {friendly.message}
          </Typography>
          {friendly.hint && (
            <Typography variant="body2" sx={{ mt: 0.75, opacity: 0.9 }}>
              {friendly.hint}
            </Typography>
          )}
        </Alert>
        <Button variant="contained" onClick={() => router.replace("/login")}>
          Torna al login
        </Button>
      </Stack>
    );
  }

  if (timedOut) {
    return (
      <Stack spacing={2} sx={{ alignItems: "center", maxWidth: 460, px: 3 }}>
        <Alert severity="warning" sx={{ width: "100%" }}>
          L&apos;accesso sta impiegando piu&apos; del previsto. Riprova dalla pagina
          di login.
        </Alert>
        <Button variant="contained" onClick={() => router.replace("/login")}>
          Torna al login
        </Button>
      </Stack>
    );
  }

  return (
    <Stack spacing={2} sx={{ alignItems: "center" }}>
      <CircularProgress />
      <Typography color="text.secondary">Accesso in corso…</Typography>
    </Stack>
  );
}

export default function AuthCallbackPage() {
  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      {/* useSearchParams richiede un confine di Suspense in fase di build. */}
      <Suspense fallback={<CircularProgress />}>
        <CallbackContent />
      </Suspense>
    </Box>
  );
}
