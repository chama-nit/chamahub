// ===========================================================================
// Spedizione della posta, in un punto solo
// ===========================================================================
// Perche' le funzioni non usano la posta di Supabase
// --------------------------------------------------
// Supabase spedisce le proprie email (invito, recupero password, conferma
// indirizzo) attraverso il server SMTP configurato nel progetto, in
// Authentication → Emails → SMTP Settings. Quel campo accetta host, porta,
// utente e password: autenticazione di base, e nient'altro.
//
// Verso Microsoft 365 quella strada e' in chiusura. La password di casella
// smette di funzionare per impostazione predefinita a fine 2026, e i tenant
// creati da gennaio 2027 non la avranno mai: l'unico SMTP che Microsoft
// continuera' ad accettare e' quello autenticato via OAuth (SASL XOAUTH2), che
// il campo "password" di Supabase non sa parlare. Non e' una questione di
// autorizzazioni da aggiungere alla registrazione Entra ID: e' proprio il
// riquadro di Supabase che non ha dove mettere un token.
//
// Quindi le Edge Function spediscono da sole. Il vantaggio immediato non e'
// solo la longevita': una chiamata che non risponde qui la si puo' interrompere
// e raccontare, mentre dentro GoTrue resta appesa fino al timeout della
// piattaforma - che e' il 504 e il "non ha risposto entro N secondi" con cui e'
// cominciata questa storia.
//
// Le tre strade, in ordine di precedenza
// --------------------------------------
//   MS_TENANT_ID, MS_CLIENT_ID,       -> Microsoft Graph (consigliata)
//   MS_CLIENT_SECRET, MS_MAIL_SENDER
//   RESEND_API_KEY + MAIL_FROM        -> API HTTPS di Resend
//   SMTP_HOST, SMTP_PORT, SMTP_USER,  -> SMTP con autenticazione di base
//   SMTP_PASS, MAIL_FROM                 (per server che non siano Microsoft)
//
// Su Graph l'autorizzazione e' `Mail.Send` di tipo APPLICAZIONE, con il flusso
// client credentials: qui non c'e' nessun utente collegato di cui spendere
// l'identita' - chi ha dimenticato la password non ha una sessione, e un
// invito parte prima ancora che l'account venga usato. La delegata `SMTP.Send`
// risolve un problema diverso (un programma che spedisce come la persona
// seduta davanti) e non si applica. Vedi docs/email-microsoft-smtp.md.
// ===========================================================================

export interface MailMessage {
  subject: string;
  text: string;
  html: string;
}

export type MailTransport = "graph" | "resend" | "smtp";

/** Tetto di tempo predefinito per una spedizione. */
export const MAIL_TIMEOUT_MS = 15_000;

const GRAPH_SECRETS = [
  "MS_TENANT_ID",
  "MS_CLIENT_ID",
  "MS_CLIENT_SECRET",
  "MS_MAIL_SENDER",
] as const;

/**
 * Quale canale risulta configurato, o `null` se non ce n'e' nessuno.
 *
 * Va chiamata PRIMA di creare un account o generare un link: sapere in anticipo
 * che non partira' nessuna email permette di dirlo subito a chi sta guardando,
 * invece di lasciarlo in attesa di un messaggio che non arrivera' mai.
 */
export function configuredTransport(): MailTransport | null {
  if (GRAPH_SECRETS.every((name) => Boolean(Deno.env.get(name)))) return "graph";
  if (Deno.env.get("RESEND_API_KEY")) return "resend";
  if (Deno.env.get("SMTP_HOST")) return "smtp";
  return null;
}

function withTimeout<T>(promise: Promise<T>, label: string, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    }),
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label}: nessuna risposta entro ${ms} ms`)),
        ms,
      );
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Microsoft Graph
// ---------------------------------------------------------------------------
// Il token applicativo dura un'ora. L'isolate della funzione sopravvive a piu'
// chiamate ravvicinate, quindi tenerlo qui evita un giro a Entra ID per ogni
// email. Lo si scarta 60 secondi prima della scadenza dichiarata: il tempo di
// arrivare a Graph con un token ancora valido.
let graphToken: { value: string; expiresAt: number } | null = null;

async function graphAccessToken(timeoutMs: number, fresh = false): Promise<string> {
  if (!fresh && graphToken && graphToken.expiresAt > Date.now()) {
    return graphToken.value;
  }

  const tenant = Deno.env.get("MS_TENANT_ID")!;
  const body = new URLSearchParams({
    client_id: Deno.env.get("MS_CLIENT_ID")!,
    client_secret: Deno.env.get("MS_CLIENT_SECRET")!,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const response = await withTimeout(
    fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }),
    "Entra ID",
    timeoutMs,
  );

  const payload = await response.json().catch(() => null) as
    | { access_token?: string; expires_in?: number; error_description?: string }
    | null;

  if (!response.ok || !payload?.access_token) {
    // `error_description` di Entra ID e' insolitamente parlante - dice se manca
    // il consenso dell'amministratore, se il segreto e' scaduto, se il tenant
    // e' sbagliato. Vale la pena riportarlo invece di un generico "401".
    throw new Error(
      `Entra ID ha risposto ${response.status}: ${
        payload?.error_description ?? "token non rilasciato"
      }`,
    );
  }

  graphToken = {
    value: payload.access_token,
    expiresAt: Date.now() + Math.max(0, (payload.expires_in ?? 3600) - 60) * 1000,
  };
  return graphToken.value;
}

/**
 * Legge i ruoli applicativi scritti dentro il token, senza verificarne la firma.
 *
 * Non e' un controllo di sicurezza - il token l'abbiamo appena ricevuto noi da
 * Entra ID su un canale TLS, e chi lo verifica e' Graph. Serve solo a
 * raccontare un errore: e' la differenza fra "403" e "il token non porta
 * nessun ruolo, quindi Mail.Send non e' stata concessa come autorizzazione di
 * tipo Applicazione", che sono la stessa informazione ma una si puo' agire.
 */
interface TokenClaims {
  /** Ruoli applicativi concessi. Assente se non ne e' stato concesso nessuno. */
  roles?: string[];
  /** Identificativo dell'applicazione a cui il token e' stato rilasciato. */
  appid?: string;
  /** Tenant che l'ha rilasciato. */
  tid?: string;
  /** Destinatario: deve essere Microsoft Graph. */
  aud?: string;
}

function claimsInToken(jwt: string): TokenClaims | null {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as TokenClaims;
  } catch {
    return null;
  }
}

function rolesInToken(jwt: string): string[] | null {
  const claims = claimsInToken(jwt);
  if (claims === null) return null;
  return Array.isArray(claims.roles) ? claims.roles : [];
}

/**
 * Trasforma la risposta di errore di Graph in una frase che dice cosa fare.
 *
 * Le due cause di un 403 su sendMail si distinguono, e il messaggio di
 * Microsoft e' l'indizio:
 *
 *   "Access is denied. Check credentials and try again."
 *       -> l'autorizzazione non c'e'. O non e' stata aggiunta come
 *          Applicazione (magari e' stata aggiunta come Delegata, che con il
 *          flusso client credentials non vale), o manca il consenso
 *          amministratore. Il token lo conferma: senza concessione non porta
 *          nessun ruolo.
 *
 *   "Access to OData is disabled."
 *       -> l'autorizzazione c'e' ma una policy di Exchange Online tiene fuori
 *          quella casella.
 */
function explainGraphFailure(status: number, body: string, token: string): string {
  const base = `Microsoft Graph ha risposto ${status}: ${body}`;
  if (status !== 403) return base;

  const roles = rolesInToken(token);

  if (roles !== null && roles.length === 0) {
    const claims = claimsInToken(token);
    // Stampare appid e tid non e' un vezzo: e' l'unico modo di sapere SU QUALE
    // registrazione va concesso il permesso. «L'app id e' corretto» e' una
    // convinzione; questo e' cio' che Entra ID ha effettivamente scritto nel
    // token, e va confrontato con la registrazione dove si e' premuto
    // «Concedi consenso». Quando i due non coincidono, il permesso e' stato
    // concesso alla registrazione sbagliata - di solito quella del login.
    const identita = claims
      ? `\n   Il token e' stato rilasciato all'applicazione ${claims.appid} ` +
        `nel tenant ${claims.tid}, per ${claims.aud}. Il permesso va concesso ` +
        "ESATTAMENTE su questa registrazione."
      : "";
    return `${base}\n   -> Il token non contiene NESSUN ruolo applicativo. ` +
      "Su Azure Portal → Registrazioni app → la registrazione della posta → " +
      "Autorizzazioni API, controlla tre cose su Mail.Send: che stia sotto " +
      "«Microsoft Graph» e non sotto «Office 365 Exchange Online» (esiste in " +
      "entrambe, ma il token e' per Graph); che il Tipo sia «Applicazione» e " +
      "non «Delegata» (con il flusso client credentials le delegate non " +
      "valgono); e che accanto ci sia il segno verde di «Concesso per " +
      "<organizzazione>». Se manca, premi Concedi consenso amministratore." +
      identita;
  }

  if (roles !== null && !roles.includes("Mail.Send")) {
    return `${base}\n   -> Il token porta i ruoli [${roles.join(", ")}], ` +
      "ma non Mail.Send. E' la registrazione sbagliata, oppure " +
      "l'autorizzazione aggiunta non e' quella giusta.";
  }

  if (body.includes("Access to OData is disabled")) {
    return `${base}\n   -> Mail.Send c'e', ma una policy di Exchange Online ` +
      "esclude questa casella. Controlla con " +
      "Test-ApplicationAccessPolicy che MS_MAIL_SENDER sia fra le caselle " +
      "consentite. Le modifiche alle policy possono metterci oltre un'ora a " +
      "diventare effettive su Graph, anche quando Test- risponde gia' bene.";
  }

  return `${base}\n   -> Mail.Send risulta concessa, quindi il problema e' ` +
    "sulla casella: verifica che MS_MAIL_SENDER esista, abbia una licenza, e " +
    "sia compresa nell'ambito della policy di accesso (App RBAC o " +
    "Test-ApplicationAccessPolicy).";
}

async function postSendMail(
  sender: string,
  to: string,
  message: MailMessage,
  token: string,
  timeoutMs: number,
): Promise<Response> {
  return await withTimeout(
    fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject: message.subject,
            body: { contentType: "HTML", content: message.html },
            toRecipients: [{ emailAddress: { address: to } }],
          },
          // La copia in "Posta inviata" della casella di servizio non serve a
          // nessuno e in un anno diventa un archivio di link di accesso.
          saveToSentItems: false,
        }),
      },
    ),
    "Microsoft Graph",
    timeoutMs,
  );
}

async function sendWithGraph(
  to: string,
  message: MailMessage,
  timeoutMs: number,
): Promise<string> {
  const sender = Deno.env.get("MS_MAIL_SENDER")!;
  let token = await graphAccessToken(timeoutMs);
  let response = await postSendMail(sender, to, message, token, timeoutMs);

  // Un 403 con un token che non porta ruoli merita un secondo tentativo con un
  // token nuovo, e una volta sola.
  //
  // Il motivo e' il momento in cui questo errore capita quasi sempre: subito
  // dopo aver concesso il consenso amministratore. Il token vive un'ora e resta
  // in cache qui dentro; se e' stato preso PRIMA della concessione, continua a
  // uscire senza ruoli fino alla scadenza, e il permesso appena dato sembra non
  // avere effetto. Chiedendone uno nuovo si distinguono le due cose: se anche
  // quello arriva senza ruoli, il consenso davvero non c'e' - e a quel punto il
  // messaggio che segue dice la verita' invece di far inseguire un fantasma.
  if (response.status === 403 && rolesInToken(token)?.length === 0) {
    console.info(
      "microsoft graph: 403 con un token privo di ruoli, riprovo con un token nuovo " +
        "(il consenso potrebbe essere stato concesso dopo che il token era stato preso)",
    );
    token = await graphAccessToken(timeoutMs, true);
    response = await postSendMail(sender, to, message, token, timeoutMs);
  }

  // sendMail risponde 202 senza corpo quando accetta il messaggio.
  if (!response.ok) {
    throw new Error(
      explainGraphFailure(response.status, await response.text(), token),
    );
  }
  return `microsoft graph (${sender})`;
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------
async function sendWithResend(
  to: string,
  message: MailMessage,
  timeoutMs: number,
): Promise<string> {
  const key = Deno.env.get("RESEND_API_KEY")!;
  const from = Deno.env.get("MAIL_FROM") ?? "ChamaHub <onboarding@resend.dev>";

  const response = await withTimeout(
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    }),
    "Resend",
    timeoutMs,
  );

  if (!response.ok) {
    throw new Error(`Resend ha risposto ${response.status}: ${await response.text()}`);
  }
  return "resend";
}

// ---------------------------------------------------------------------------
// SMTP con autenticazione di base
// ---------------------------------------------------------------------------
async function sendWithSmtp(
  to: string,
  message: MailMessage,
  timeoutMs: number,
): Promise<string> {
  // Import dinamico: chi usa Graph o Resend non ha motivo di scaricare un
  // client SMTP a ogni avvio a freddo.
  const { SMTPClient } = await import(
    "https://deno.land/x/denomailer@1.6.0/mod.ts"
  );

  const host = Deno.env.get("SMTP_HOST")!;
  const port = Number(Deno.env.get("SMTP_PORT") ?? 587);
  const username = Deno.env.get("SMTP_USER") ?? "";
  const password = Deno.env.get("SMTP_PASS") ?? "";
  const from = Deno.env.get("MAIL_FROM") ?? username;

  const client = new SMTPClient({
    connection: {
      hostname: host,
      port,
      // 465 e' la porta con TLS diretto; 587 parte in chiaro e sale con
      // STARTTLS, che denomailer gestisce da solo. Microsoft 365 ascolta
      // SOLO sulla 587: puntarlo sulla 465 produce un'attesa senza risposta,
      // che e' poi il sintomo piu' comune di questa configurazione.
      tls: port === 465,
      auth: username ? { username, password } : undefined,
    },
  });

  try {
    await withTimeout(
      client.send({
        from,
        to,
        subject: message.subject,
        content: message.text,
        html: message.html,
      }),
      "SMTP",
      timeoutMs,
    );
  } finally {
    await client.close().catch(() => {});
  }

  return `smtp (${host}:${port})`;
}

// ---------------------------------------------------------------------------
/**
 * Spedisce un messaggio dal primo canale configurato.
 *
 * Restituisce un'etichetta leggibile del canale usato, buona per i log.
 * Solleva un errore se non c'e' nessun canale, o se la spedizione fallisce:
 * chi chiama decide se e' un guasto o solo un contrattempo.
 */
export async function sendMail(
  to: string,
  message: MailMessage,
  timeoutMs: number = MAIL_TIMEOUT_MS,
): Promise<string> {
  const transport = configuredTransport();

  switch (transport) {
    case "graph":
      return await sendWithGraph(to, message, timeoutMs);
    case "resend":
      return await sendWithResend(to, message, timeoutMs);
    case "smtp":
      return await sendWithSmtp(to, message, timeoutMs);
    default:
      throw new Error(
        "nessun servizio di posta configurato: servono i secret MS_TENANT_ID, " +
          "MS_CLIENT_ID, MS_CLIENT_SECRET e MS_MAIL_SENDER (Microsoft Graph), " +
          "oppure RESEND_API_KEY, oppure SMTP_HOST",
      );
  }
}
