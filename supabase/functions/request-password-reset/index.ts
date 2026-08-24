// ===========================================================================
// Edge Function: request-password-reset
// ===========================================================================
// "Ho dimenticato la password", senza dipendere dal servizio di posta interno
// di Supabase.
//
// Il problema che risolve
// -----------------------
// `auth.resetPasswordForEmail()` chiede a Supabase di spedire l'email. Se il
// server SMTP configurato non risponde, quella chiamata resta appesa finche'
// il gateway non la interrompe: il browser riceve un 504 e chi ha premuto il
// pulsante non sa se l'email arrivera' o no.
//
// Qui la richiesta viene spezzata in due tempi:
//
//   1. la funzione risponde subito 202 - sempre lo stesso messaggio, per
//      chiunque e per qualunque indirizzo;
//   2. la generazione del link e l'invio proseguono in sottofondo
//      (`EdgeRuntime.waitUntil`), con un tetto di tempo esplicito.
//
// Cosi' il 504 sparisce per costruzione: nessuno aspetta piu' l'SMTP.
//
// Perche' la risposta e' sempre identica
// --------------------------------------
// Rispondere "indirizzo sconosciuto" trasformerebbe questo modulo in uno
// strumento per scoprire chi lavora in azienda. La risposta non cambia mai:
// chi ha un profilo attivo riceve l'email, gli altri no, e da fuori le due
// situazioni sono indistinguibili.
//
// Come si spedisce
// ----------------
// Due strade, scelte dai secret presenti (la prima che risulta configurata):
//
//   RESEND_API_KEY + MAIL_FROM        -> API HTTPS di Resend
//   SMTP_HOST, SMTP_PORT, SMTP_USER,  -> server SMTP aziendale
//   SMTP_PASS, MAIL_FROM
//
// Senza nessuno dei due la funzione genera comunque il link e lo scrive nei
// log (visibili solo a chi amministra il progetto), cosi' il recupero resta
// possibile a mano mentre si sistema la posta. In quel caso resta valida la
// strada gia' presente nell'applicazione: l'HR genera il link dalla scheda del
// dipendente e lo consegna di persona.
//
// Nota di configurazione: questa funzione va pubblicata SENZA verifica del
// token (`verify_jwt = false` in supabase/config.toml), perche' chi ha perso la
// password non ha nessuna sessione con cui presentarsi.
// ===========================================================================

import { adminClient, AuthError, readJson } from "../_shared/auth.ts";
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/cors.ts";

interface Payload {
  email?: string;
  /** Indirizzo a cui tornare dopo aver aperto il link. */
  redirect_to?: string;
}

/** Tentativi ammessi per indirizzo in un'ora. */
const MAX_ATTEMPTS_PER_HOUR = 3;

/** Tetto di tempo per la spedizione: oltre, si rinuncia e si scrive nei log. */
const SEND_TIMEOUT_MS = 15_000;

const GENERIC_ANSWER = {
  ok: true,
  message:
    "Se l'indirizzo corrisponde a un profilo attivo, riceverai a breve un'email con le istruzioni per reimpostare la password.",
};

function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    }),
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label}: nessuna risposta entro ${SEND_TIMEOUT_MS} ms`)),
        SEND_TIMEOUT_MS,
      );
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Testo del messaggio
// ---------------------------------------------------------------------------
function buildEmail(fullName: string, link: string) {
  const name = fullName.split(" ")[0] || "";
  const subject = "ChamaHub - reimposta la tua password";

  const text = [
    `Ciao ${name},`.trim(),
    "",
    "hai chiesto di reimpostare la password di ChamaHub.",
    "Apri questo indirizzo per sceglierne una nuova:",
    "",
    link,
    "",
    "Il link vale una volta sola e scade dopo un'ora.",
    "Se non hai chiesto tu il cambio, ignora questo messaggio: la password",
    "attuale resta valida.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="it"><body style="margin:0;padding:24px;background:#f4f6f8;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1c2530">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
    <h1 style="margin:0 0 16px;font-size:20px;color:#1f4e79">ChamaHub</h1>
    <p style="margin:0 0 12px">Ciao ${name || "!"},</p>
    <p style="margin:0 0 20px">hai chiesto di reimpostare la password. Premi il pulsante per sceglierne una nuova:</p>
    <p style="margin:0 0 24px">
      <a href="${link}" style="display:inline-block;background:#1f4e79;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Reimposta la password</a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#5a6672">Il link vale una volta sola e scade dopo un'ora.</p>
    <p style="margin:0;font-size:13px;color:#5a6672">Se non hai chiesto tu il cambio, ignora questo messaggio: la password attuale resta valida.</p>
  </div>
</body></html>`;

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// Spedizione
// ---------------------------------------------------------------------------
async function sendWithResend(
  to: string,
  message: { subject: string; text: string; html: string },
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
  );

  if (!response.ok) {
    throw new Error(`Resend ha risposto ${response.status}: ${await response.text()}`);
  }
  return "resend";
}

async function sendWithSmtp(
  to: string,
  message: { subject: string; text: string; html: string },
): Promise<string> {
  // Import dinamico: chi usa Resend non ha motivo di scaricare un client SMTP.
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
      // STARTTLS, che denomailer gestisce da solo.
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
    );
  } finally {
    await client.close().catch(() => {});
  }

  return `smtp (${host}:${port})`;
}

// ---------------------------------------------------------------------------
// Lavoro in sottofondo
// ---------------------------------------------------------------------------
async function process(email: string, redirectTo: string | undefined) {
  const admin = adminClient();

  // Pulizia opportunistica: la tabella dei tentativi non deve crescere.
  await admin
    .from("password_reset_requests")
    .delete()
    .lt("requested_at", new Date(Date.now() - 24 * 3600_000).toISOString());

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin
    .from("password_reset_requests")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("requested_at", since);

  if ((count ?? 0) >= MAX_ATTEMPTS_PER_HOUR) {
    console.warn(`reset password: troppi tentativi per ${email}, richiesta ignorata`);
    return;
  }

  await admin.from("password_reset_requests").insert({ email });

  const { data: profile } = await admin
    .from("profiles")
    .select("id, full_name, is_active")
    .eq("email", email)
    .maybeSingle();

  if (!profile?.is_active) {
    // Nessun profilo attivo: nessuna email. Il chiamante ha gia' ricevuto la
    // stessa risposta di sempre e non se ne accorge.
    console.info("reset password: nessun profilo attivo per l'indirizzo indicato");
    return;
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: redirectTo ? { redirectTo } : undefined,
  });

  if (linkError || !link?.properties?.action_link) {
    console.error("reset password: generazione del link fallita:", linkError?.message);
    return;
  }

  const actionLink = link.properties.action_link;
  const message = buildEmail(profile.full_name ?? "", actionLink);

  const hasResend = Boolean(Deno.env.get("RESEND_API_KEY"));
  const hasSmtp = Boolean(Deno.env.get("SMTP_HOST"));

  if (!hasResend && !hasSmtp) {
    console.warn(
      "reset password: nessun servizio di posta configurato (RESEND_API_KEY o SMTP_HOST). " +
        `Link generato, da consegnare a mano: ${actionLink}`,
    );
    return;
  }

  try {
    const via = hasResend
      ? await sendWithResend(email, message)
      : await sendWithSmtp(email, message);
    console.info(`reset password: email inviata via ${via}`);
  } catch (err) {
    // Il link resta nei log: chi amministra puo' consegnarlo comunque, invece
    // di lasciare la persona senza strada.
    console.error(
      `reset password: invio fallito (${
        err instanceof Error ? err.message : err
      }). Link generato: ${actionLink}`,
    );
  }
}

// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const body = await readJson<Payload>(req);
    const email = normaliseEmail(body?.email ?? "");

    // Un controllo di forma, non di esistenza.
    if (!email || !email.includes("@") || email.length > 320) {
      throw new AuthError("Indirizzo email non valido.", 400);
    }

    // Il lavoro vero prosegue dopo la risposta: e' tutto il senso di questa
    // funzione. Se il runtime non offrisse `waitUntil`, si aspetta - meglio
    // lenti che senza email.
    const work = process(email, body?.redirect_to).catch((err) => {
      console.error("reset password: errore inatteso:", err);
    });

    const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } })
      .EdgeRuntime;

    if (runtime?.waitUntil) runtime.waitUntil(work);
    else await work;

    return jsonResponse(GENERIC_ANSWER, 202);
  } catch (err) {
    if (err instanceof AuthError) return errorResponse(err.message, err.status);
    console.error("request-password-reset:", err);
    return errorResponse("Errore interno del server.", 500);
  }
});
