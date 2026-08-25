// ---------------------------------------------------------------------------
// Traduzione degli errori di autenticazione
// ---------------------------------------------------------------------------
// Supabase restituisce messaggi tecnici in inglese. Qui vengono convertiti in
// spiegazioni comprensibili che dicono anche *cosa fare*: la maggior parte di
// questi errori non sono guasti ma configurazioni mancanti, e il messaggio
// giusto fa risparmiare mezz'ora di ricerche.
// ---------------------------------------------------------------------------

export interface FriendlyError {
  message: string;
  /** Suggerimento operativo, mostrato sotto al messaggio. */
  hint?: string;
}

const RULES: { match: RegExp; result: FriendlyError }[] = [
  {
    // Provider OAuth non attivato nel progetto Supabase.
    match: /provider is not enabled|unsupported provider/i,
    result: {
      message: "L'accesso con Microsoft non e' ancora configurato.",
      hint:
        "Serve registrare l'applicazione su Azure Portal e attivare il provider Azure in Supabase (Authentication → Providers). La procedura completa e' in docs/microsoft-entra-id.md. Nel frattempo puoi entrare con email e password.",
    },
  },
  {
    // Guasto o cattiva configurazione del servizio di posta.
    //
    // Il suggerimento NON rimanda piu' alle impostazioni SMTP di Supabase:
    // ChamaHub non le usa. Le email escono dalle Edge Function, che leggono i
    // propri secret - ed e' li' che va cercato il problema. Mandare l'HR nel
    // riquadro sbagliato gli fa perdere un pomeriggio a sistemare qualcosa che
    // non c'entra.
    match: /sending (invite|confirmation|recovery|magic link|email)|error sending|smtp|mail server|server di posta|servizio di posta/i,
    result: {
      message: "L'email non e' partita.",
      hint:
        "Il servizio di posta delle Edge Function non e' configurato o non risponde. Controlla i secret (Edge Functions → Secrets): per Microsoft Graph servono MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET e MS_MAIL_SENDER, e dopo averli impostati la funzione va ridistribuita. La procedura e' in docs/email-microsoft-smtp.md. Nel frattempo puoi creare i dipendenti senza invito - ricevi una password temporanea da comunicare - e usare «Genera link di reimpostazione» per l'accesso.",
    },
  },
  {
    match: /invalid login credentials/i,
    result: { message: "Email o password non corretti." },
  },
  {
    match: /email not confirmed/i,
    result: {
      message: "L'indirizzo email non e' ancora stato confermato.",
      hint:
        "Controlla la posta e apri il link di conferma. Se le email non sono configurate, un amministratore puo' confermare l'account dal Dashboard di Supabase (Authentication → Users).",
    },
  },
  {
    match: /user already registered|already been registered/i,
    result: {
      message: "Esiste gia' un account con questo indirizzo email.",
      hint: "Prova ad accedere, oppure usa il recupero password.",
    },
  },
  {
    match: /signups not allowed|signup is disabled/i,
    result: {
      message: "La registrazione autonoma e' disabilitata su questo progetto.",
      hint:
        "Attivala temporaneamente in Supabase (Authentication → Sign In / Providers → Allow new users to sign up) oppure crea l'amministratore con lo script supabase/scripts/01_crea_admin_di_sistema.sql.",
    },
  },
  {
    match: /password should be at least|password is too short/i,
    result: { message: "La password e' troppo corta: servono almeno 8 caratteri." },
  },
  {
    match: /redirect_to is not allowed|invalid redirect/i,
    result: {
      message: "L'indirizzo di ritorno non e' fra quelli autorizzati.",
      hint:
        "In Supabase, Authentication → URL Configuration, aggiungi questo dominio seguito da /auth/callback fra le Redirect URLs.",
    },
  },
  {
    match: /rate limit|too many requests/i,
    result: {
      message: "Troppi tentativi ravvicinati.",
      hint: "Attendi qualche minuto e riprova.",
    },
  },
  {
    match: /failed to fetch|network|load failed/i,
    result: {
      message: "Impossibile contattare Supabase.",
      hint:
        "Verifica la connessione e che NEXT_PUBLIC_SUPABASE_URL in .env.local sia corretto.",
    },
  },
  {
    match: /AADSTS50011/i,
    result: {
      message: "Azure ha rifiutato l'indirizzo di reindirizzamento.",
      hint:
        "Nella registrazione dell'app su Azure Portal, l'URI di reindirizzamento deve essere esattamente https://<REFERENCE_ID>.supabase.co/auth/v1/callback",
    },
  },
  {
    match: /AADSTS7000215|invalid client secret/i,
    result: {
      message: "Il segreto client di Azure non e' valido o e' scaduto.",
      hint:
        "Genera un nuovo segreto su Azure Portal e ricopia il *valore* (non l'ID) in Supabase.",
    },
  },
];

export function describeAuthError(error: unknown): FriendlyError {
  const raw = error instanceof Error
    ? error.message
    : typeof error === "string"
    ? error
    : "";

  for (const rule of RULES) {
    if (rule.match.test(raw)) return rule.result;
  }

  return {
    message: raw || "Operazione non riuscita.",
  };
}
