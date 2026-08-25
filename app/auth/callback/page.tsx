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
import { isPlaceholderName, readGraphProfile } from "@/lib/auth/graph";
import { getSupabase } from "@/lib/supabase/client";

function CallbackContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { session, loading } = useAuth();
  const [timedOut, setTimedOut] = useState(false);
  const [notRegistered, setNotRegistered] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);

  const providerError = params.get("error_description") ?? params.get("error");
  const tokenHash = params.get("token_hash");
  const otpType = params.get("type");

  useEffect(() => {
    if (providerError) return;
    const timer = setTimeout(() => setTimedOut(true), 12000);
    return () => clearTimeout(timer);
  }, [providerError]);

  // -------------------------------------------------------------------------
  // Link arrivato per email (invito, reimpostazione password)
  // -------------------------------------------------------------------------
  // Quei link non portano una sessione gia' pronta: portano un codice monouso
  // da scambiare. Lo scambio si fa qui, con `verifyOtp`.
  //
  // Prima il link puntava al verificatore di Supabase, che rimbalzava
  // sull'applicazione con la sessione appesa al frammento dell'URL - il vecchio
  // flusso "implicito". Il client di ChamaHub e' pero' configurato in PKCE, e
  // davanti a un frammento del genere la libreria si ferma con «Not a valid
  // PKCE flow url»: la pagina si caricava, girava, e non entrava mai. I due
  // flussi non si mescolano, e PKCE non e' applicabile a un link nato sul
  // server, che non puo' conoscere il verificatore custodito dal browser.
  //
  // Con `verifyOtp` non serve nessuno dei due: si presenta il codice e si
  // ottiene la sessione.
  useEffect(() => {
    if (!tokenHash || !otpType) return;
    let active = true;

    (async () => {
      const supabase = getSupabase();
      const { error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: otpType as "recovery" | "invite" | "magiclink" | "signup",
      });

      if (!active) return;

      if (error) {
        setOtpError(describeAuthError(error).message);
        return;
      }

      // Il codice e' speso: va tolto dalla barra degli indirizzi, altrimenti
      // resta nella cronologia e in ogni link condiviso per sbaglio.
      const pulito = new URL(window.location.href);
      pulito.searchParams.delete("token_hash");
      pulito.searchParams.delete("type");
      window.history.replaceState(window.history.state, "", pulito.toString());
    })();

    return () => {
      active = false;
    };
  }, [tokenHash, otpType]);

  useEffect(() => {
    if (loading || !session) return;
    let active = true;

    // Il profilo si legge qui e non dal contesto perche' serve la risposta
    // "riga assente" distinta da "sto ancora caricando".
    (async () => {
      const supabase = getSupabase();
      const { data } = await supabase
        .from("profiles")
        .select("full_name, is_active")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!active) return;

      // Nome e cognome veri al posto del ripiego "mario.rossi".
      //
      // Si fa qui, e non alla creazione del profilo, perche' il trigger sul
      // database vede solo i claim del token - che spesso non portano il nome.
      // Il token del provider invece vive nella sessione appena aperta, ed e'
      // l'unico momento in cui si puo' chiedere la scheda a Microsoft Graph.
      //
      // Vale anche per chi non e' ancora abilitato: anzi, soprattutto per lui.
      // L'HR lo trova nell'elenco delle attivazioni in attesa, e leggerci
      // "Mario Rossi" invece di "m.rossi" e' la differenza fra riconoscere una
      // persona e doverla cercare.
      if (data && isPlaceholderName(data.full_name, session.user.email)) {
        const graph = await readGraphProfile(session.provider_token);
        const name = graph?.displayName?.trim();
        if (name) {
          await supabase
            .from("profiles")
            .update({ full_name: name })
            .eq("id", session.user.id);
        }
      }

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

  if (otpError) {
    return (
      <Stack spacing={2} sx={{ alignItems: "center", maxWidth: 460, px: 3 }}>
        <Alert severity="warning" sx={{ width: "100%" }}>
          <strong>Questo collegamento non e&apos; piu&apos; valido.</strong>
          <Typography variant="body2" sx={{ mt: 0.75 }}>
            {otpError}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.75, opacity: 0.9 }}>
            I collegamenti valgono una volta sola e scadono dopo un&apos;ora.
            Puoi chiederne uno nuovo dalla pagina di accesso, con &laquo;Ho
            dimenticato la password&raquo;.
          </Typography>
        </Alert>
        <Button variant="contained" onClick={() => router.replace("/login")}>
          Torna al login
        </Button>
      </Stack>
    );
  }

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
