"use client";

// ---------------------------------------------------------------------------
// Accesso all'applicazione
// ---------------------------------------------------------------------------
// La pagina ha due volti:
//   * primo avvio  -> se il database non contiene ancora alcun profilo mostra
//     la creazione dell'amministratore, cosi' non serve passare dal SQL Editor
//     per entrare la prima volta;
//   * uso normale  -> accesso con account Microsoft e/o email e password.
//
// Lo stato di primo avvio arriva dalla funzione SQL `needs_bootstrap()`, che e'
// eseguibile anche senza autenticazione e restituisce true soltanto quando
// l'applicazione non e' ancora stata configurata.
// ---------------------------------------------------------------------------

import { useEffect, useState, type FormEvent } from "react";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";

import {
  callPublicFunction,
  getSupabase,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { describeAuthError, type FriendlyError } from "@/lib/auth/errors";
import Logo from "@/components/Logo";
import { BRAND_GRADIENT } from "@/lib/brand";
import MicrosoftIcon from "@/components/MicrosoftIcon";
import ThemeToggle from "@/components/ThemeToggle";

type Mode = "password" | "recovery";

// Accesso con account Microsoft (Entra ID).
//
// Il pulsante e' attivo per impostazione predefinita. Se la registrazione su
// Azure non e' ancora pronta si nasconde mettendo in `.env.local`
//
//   NEXT_PUBLIC_MICROSOFT_LOGIN=off
//
// e ricostruendo l'applicazione: meglio nessun pulsante che un pulsante che
// fallisce. Guida completa: docs/microsoft-entra-id.md
const MICROSOFT_ENABLED =
  process.env.NEXT_PUBLIC_MICROSOFT_LOGIN?.trim().toLowerCase() !== "off";

export default function LoginPage() {
  const configured = isSupabaseConfigured();

  // null = verifica in corso
  const [needsBootstrap, setNeedsBootstrap] = useState<boolean | null>(
    configured ? null : false,
  );

  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"microsoft" | "password" | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Verifica del primo avvio
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!configured) return;
    let active = true;

    getSupabase()
      .rpc("needs_bootstrap")
      .then(({ data, error: rpcError }) => {
        if (!active) return;
        // Se la funzione non esiste (migrazioni non ancora applicate) si
        // prosegue con il login normale: e' il comportamento meno sorprendente.
        setNeedsBootstrap(rpcError ? false : Boolean(data));
      });

    return () => {
      active = false;
    };
  }, [configured]);

  // -------------------------------------------------------------------------
  async function signInWithMicrosoft() {
    setError(null);
    setInfo(null);
    setBusy("microsoft");
    try {
      const supabase = getSupabase();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: {
          // Nome, cognome e indirizzo: niente di piu'.
          //
          //   openid          identifica l'account
          //   profile         porta il nome
          //   email           porta l'indirizzo, la chiave con cui si verifica
          //                   se la persona e' gia' registrata in ChamaHub
          //   User.Read       permette di leggere la scheda della persona da
          //                   Microsoft Graph. Serve perche' i claim del token
          //                   non sono affidabili quanto sembrano: su parecchi
          //                   tenant `email` manca del tutto e `name` arriva
          //                   come un'unica stringa da spezzare a indovinare.
          //                   Graph risponde con givenName, surname e mail
          //                   separati. E' l'autorizzazione predefinita di ogni
          //                   registrazione Entra ID: non richiede il consenso
          //                   dell'amministratore.
          //   offline_access  fa rilasciare anche un refresh token del
          //                   provider. La sessione di ChamaHub resta quella di
          //                   Supabase - questo serve solo perche' la lettura
          //                   da Graph non smetta di funzionare quando il token
          //                   Microsoft scade dopo un'ora.
          //
          // Nessuna autorizzazione di posta: il token che nasce qui vive nel
          // browser, e un permesso di spedire email che passa dal browser e'
          // un permesso regalato a chiunque apra gli strumenti di sviluppo.
          // Chi spedisce e' la Edge Function, con una registrazione separata.
          scopes: "openid email profile offline_access User.Read",
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (oauthError) throw oauthError;
      // Il browser viene reindirizzato a Microsoft: non serve altro.
    } catch (err) {
      setError(describeAuthError(err));
      setBusy(null);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setBusy("password");

    try {
      const supabase = getSupabase();

      if (mode === "recovery") {
        // Non si passa da `resetPasswordForEmail`: quella chiamata resta
        // appesa finche' Supabase non riesce a spedire, e con un SMTP che non
        // risponde il browser si prende un 504 senza sapere che fine abbia
        // fatto la richiesta. La Edge Function risponde subito e spedisce per
        // conto suo.
        const result = await callPublicFunction<{ message?: string }>(
          "request-password-reset",
          {
            email: email.trim().toLowerCase(),
            redirect_to: `${window.location.origin}/auth/callback?reimposta=1`,
          },
        );
        setInfo(
          result?.message ??
            "Se l'indirizzo corrisponde a un profilo attivo, riceverai a breve un'email con le istruzioni.",
        );
        setMode("password");
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInError) throw signInError;
      // Il reindirizzamento e' gestito da AuthProvider.
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setBusy(null);
    }
  }

  // -------------------------------------------------------------------------
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        p: 2,
        position: "relative",
        // La sfumatura del profilo aziendale: nero blu, blu, viola, con un
        // accenno di magenta nell'angolo. Funziona con entrambi i temi - la
        // scheda al centro e' l'unica superficie che cambia colore.
        background:
          BRAND_GRADIENT,
      }}
    >
      <Box sx={{ position: "absolute", top: 12, right: 12, color: "#fff" }}>
        <ThemeToggle />
      </Box>

      <Stack spacing={3} sx={{ width: "100%", maxWidth: 460 }}>
        <Logo size={64} tone="contrast" stacked />

        <Card sx={{ borderRadius: 3 }}>
          <CardContent sx={{ p: 3 }}>
            {!configured
              ? (
                <Alert severity="warning">
                  <AlertTitle>Configurazione mancante</AlertTitle>
                  Copia <code>.env.example</code> in <code>.env.local</code> e
                  inserisci URL e chiave anon del tuo progetto Supabase, poi
                  riavvia <code>npm run dev</code>.
                </Alert>
              )
              : needsBootstrap === null
              ? (
                <Stack spacing={2} sx={{ alignItems: "center", py: 3 }}>
                  <CircularProgress />
                  <Typography color="text.secondary">
                    Verifica della configurazione…
                  </Typography>
                </Stack>
              )
              : needsBootstrap
              ? (
                <BootstrapForm
                  onDone={(message) => {
                    setNeedsBootstrap(false);
                    setInfo(message);
                  }}
                />
              )
              : (
                <>
                  {error && (
                    <Alert
                      severity="error"
                      sx={{ mb: 2 }}
                      onClose={() => setError(null)}
                    >
                      {error.message}
                      {error.hint && (
                        <Typography
                          variant="body2"
                          sx={{ mt: 0.75, opacity: 0.9 }}
                        >
                          {error.hint}
                        </Typography>
                      )}
                    </Alert>
                  )}

                  {info && (
                    <Alert
                      severity="success"
                      sx={{ mb: 2 }}
                      onClose={() => setInfo(null)}
                    >
                      {info}
                    </Alert>
                  )}

                  {MICROSOFT_ENABLED && (
                    <>
                      <Button
                        fullWidth
                        size="large"
                        variant="outlined"
                        disabled={busy !== null}
                        onClick={signInWithMicrosoft}
                        startIcon={busy === "microsoft"
                          ? <CircularProgress size={18} />
                          : <MicrosoftIcon />}
                        sx={{ py: 1.2 }}
                      >
                        Accedi con account Microsoft
                      </Button>

                      <Divider sx={{ my: 2.5 }}>
                        <Typography variant="caption" color="text.secondary">
                          oppure
                        </Typography>
                      </Divider>
                    </>
                  )}

                  <form onSubmit={handleSubmit}>
                    <Stack spacing={2}>
                      <TextField
                        label="Email aziendale"
                        type="email"
                        size="medium"
                        autoComplete="username"
                        required
                        fullWidth
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={busy !== null}
                      />

                      {mode === "password" && (
                        <TextField
                          label="Password"
                          type="password"
                          size="medium"
                          autoComplete="current-password"
                          required
                          fullWidth
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          disabled={busy !== null}
                        />
                      )}

                      <Button
                        type="submit"
                        variant="contained"
                        size="large"
                        fullWidth
                        disabled={busy !== null}
                        startIcon={busy === "password"
                          ? <CircularProgress size={18} color="inherit" />
                          : undefined}
                      >
                        {mode === "password"
                          ? "Accedi"
                          : "Invia il link di recupero"}
                      </Button>

                      <Link
                        component="button"
                        type="button"
                        underline="hover"
                        variant="body2"
                        sx={{ alignSelf: "center" }}
                        onClick={() => {
                          setError(null);
                          setInfo(null);
                          setMode(mode === "password" ? "recovery" : "password");
                        }}
                      >
                        {mode === "password"
                          ? "Ho dimenticato la password"
                          : "Torna all'accesso con password"}
                      </Link>
                    </Stack>
                  </form>
                </>
              )}
          </CardContent>
        </Card>

        <Typography
          variant="caption"
          sx={{ color: "rgba(255,255,255,0.7)", textAlign: "center" }}
        >
          Se non hai ancora un accesso, contatta il reparto HR.
        </Typography>
      </Stack>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Primo avvio: creazione dell'amministratore
// ---------------------------------------------------------------------------
function BootstrapForm({ onDone }: { onDone: (message: string) => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);

  const passwordTooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = fullName.trim().length > 1 &&
    email.trim().length > 3 &&
    password.length >= 8 &&
    password === confirm;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const supabase = getSupabase();
      const normalisedEmail = email.trim().toLowerCase();

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: normalisedEmail,
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (signUpError) throw signUpError;

      // Il trigger sul database ha gia' promosso questo profilo a HR attivo,
      // essendo il primo in assoluto.
      if (data.session) {
        // Conferma email disattivata: si e' gia' dentro, AuthProvider
        // reindirizza da solo.
        return;
      }

      // Conferma email attiva: l'account esiste ma serve il passaggio dalla
      // posta prima di poter entrare.
      onDone(
        "Amministratore creato. Conferma l'indirizzo dal link che hai ricevuto via email, poi accedi da questa pagina.",
      );
    } catch (err) {
      setError(describeAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <RocketLaunchIcon color="primary" />
        <Box>
          <Typography variant="h3">Primo avvio</Typography>
          <Typography variant="body2" color="text.secondary">
            Crea l&apos;amministratore del sistema
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Chip size="small" color="primary" label="HR" />
      </Stack>

      <Alert severity="info" sx={{ py: 0.5 }}>
        Il database non contiene ancora alcun profilo. Il primo account creato
        qui diventa automaticamente <strong>amministratore HR</strong>; subito
        dopo questa schermata sparisce e i nuovi accessi dovranno essere
        abilitati da te.
      </Alert>

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error.message}
          {error.hint && (
            <Typography variant="body2" sx={{ mt: 0.75, opacity: 0.9 }}>
              {error.hint}
            </Typography>
          )}
        </Alert>
      )}

      <form onSubmit={submit}>
        <Stack spacing={2}>
          <TextField
            label="Nome e cognome"
            fullWidth
            required
            size="medium"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={busy}
          />
          <TextField
            label="Email"
            type="email"
            fullWidth
            required
            size="medium"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
          <TextField
            label="Password"
            type="password"
            fullWidth
            required
            size="medium"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            error={passwordTooShort}
            helperText={passwordTooShort ? "Almeno 8 caratteri." : " "}
          />
          <TextField
            label="Conferma password"
            type="password"
            fullWidth
            required
            size="medium"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy}
            error={mismatch}
            helperText={mismatch ? "Le due password non coincidono." : " "}
          />

          <Button
            type="submit"
            variant="contained"
            size="large"
            fullWidth
            disabled={busy || !canSubmit}
            startIcon={busy
              ? <CircularProgress size={18} color="inherit" />
              : undefined}
          >
            Crea amministratore ed entra
          </Button>
        </Stack>
      </form>

      <Typography variant="caption" color="text.secondary">
        In alternativa puoi creare l&apos;amministratore dal SQL Editor di
        Supabase con lo script{" "}
        <code>supabase/scripts/01_crea_admin_di_sistema.sql</code>: e&apos; la
        strada da preferire se la registrazione autonoma e&apos; disabilitata
        oppure se le email di conferma non sono ancora configurate.
      </Typography>
    </Stack>
  );
}
