"use client";

// ---------------------------------------------------------------------------
// Ritorno dal provider OAuth (Microsoft Entra ID)
// ---------------------------------------------------------------------------
// Il client Supabase e' configurato con `detectSessionInUrl: true` e flusso
// PKCE: intercetta da solo il parametro `code` e completa lo scambio. Qui si
// attende l'esito e si gestisce l'eventuale errore restituito dal provider.
//
// Un accesso Microsoft riuscito non basta per entrare: dice solo che la
// persona e' chi dice di essere. Serve anche che il reparto HR l'abbia
// registrata, cioe' che esista un profilo attivo con quell'indirizzo. Se non
// c'e', la sessione viene chiusa subito e si spiega a chi rivolgersi: entrare
// in un'applicazione HR "in attesa di qualcosa", senza sapere di cosa, e'
// l'esperienza peggiore possibile.
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
import { getSupabase } from "@/lib/supabase/client";

function CallbackContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { session, loading } = useAuth();
  const [timedOut, setTimedOut] = useState(false);
  const [notRegistered, setNotRegistered] = useState<string | null>(null);

  const providerError = params.get("error_description") ?? params.get("error");

  useEffect(() => {
    if (providerError) return;
    const timer = setTimeout(() => setTimedOut(true), 12000);
    return () => clearTimeout(timer);
  }, [providerError]);

  useEffect(() => {
    if (loading || !session) return;
    let active = true;

    // Il profilo si legge qui e non dal contesto perche' serve la risposta
    // "riga assente" distinta da "sto ancora caricando".
    (async () => {
      const supabase = getSupabase();
      const { data } = await supabase
        .from("profiles")
        .select("is_active")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!active) return;

      if (data?.is_active) {
        // Chi arriva dal link di recupero deve poter scegliere subito la nuova
        // password: mandarlo in dashboard significherebbe lasciarlo a cercare
        // da solo dove si cambia.
        router.replace(
          params.get("reimposta") ? "/profilo?reimposta=1" : "/dashboard",
        );
        return;
      }

      // Nessun profilo, oppure profilo non ancora abilitato: si esce e si dice
      // perche'. La riga in attesa resta visibile all'HR, che puo' completarla
      // senza dover ricreare l'utenza da zero.
      setNotRegistered(session.user.email ?? null);
      await supabase.auth.signOut();
    })();

    return () => {
      active = false;
    };
  }, [loading, session, router, params]);

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

  if (notRegistered !== null) {
    return (
      <Stack spacing={2} sx={{ alignItems: "center", maxWidth: 460, px: 3 }}>
        <Alert severity="warning" sx={{ width: "100%" }}>
          <strong>Accesso riconosciuto, ma non ancora abilitato.</strong>
          <Typography variant="body2" sx={{ mt: 0.75 }}>
            L&apos;account Microsoft{notRegistered ? ` ${notRegistered}` : ""} non
            risulta collegato a nessun profilo attivo di ChamaHub.
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.75, opacity: 0.9 }}>
            Rivolgiti al reparto HR: gli basta registrarti &mdash; o attivare
            la richiesta gia&apos; arrivata con questo accesso &mdash; e potrai
            entrare con lo stesso pulsante.
          </Typography>
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
