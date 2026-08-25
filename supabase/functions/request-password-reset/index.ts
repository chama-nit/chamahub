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
// Non tramite la posta di Supabase: la spedizione vive in _shared/mailer.ts,
// che sceglie fra Microsoft Graph, Resend e SMTP secondo i secret presenti.
// Il perche' di quella scelta - e perche' l'SMTP di Microsoft con la password
// di casella non e' una strada percorribile a lungo - e' spiegato li'.
//
// Senza nessun canale configurato la funzione genera comunque il link e lo
// scrive nei log (visibili solo a chi amministra il progetto), cosi' il
// recupero resta possibile a mano mentre si sistema la posta. In quel caso
// resta valida la strada gia' presente nell'applicazione: l'HR genera il link
// dalla scheda del dipendente e lo consegna di persona.
//
// Nota di configurazione: questa funzione va pubblicata SENZA verifica del
// token (`verify_jwt = false` in supabase/config.toml), perche' chi ha perso la
// password non ha nessuna sessione con cui presentarsi.
// ===========================================================================

import { adminClient, AuthError, readJson } from "../_shared/auth.ts";
import { passwordResetEmail } from "../_shared/email.ts";
import {
  buildOtpLink,
  CALLBACK_PATH,
  logOriginDecision,
  resolveOrigin,
} from "../_shared/links.ts";
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { configuredTransport, sendMail } from "../_shared/mailer.ts";

interface Payload {
  email?: string;
  /** Indirizzo a cui tornare dopo aver aperto il link. */
  redirect_to?: string;
}

/** Tentativi ammessi per indirizzo in un'ora. */
const MAX_ATTEMPTS_PER_HOUR = 3;

const GENERIC_ANSWER = {
  ok: true,
  message:
    "Se l'indirizzo corrisponde a un profilo attivo, riceverai a breve un'email con le istruzioni per reimpostare la password.",
};

function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
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

  // L'origine si sceglie PRIMA di generare qualunque cosa: questa funzione e'
  // pubblica, quindi `redirect_to` e' scritto da chiunque sappia l'indirizzo
  // della funzione. Vedi la spiegazione estesa in _shared/links.ts.
  const decisione = resolveOrigin(redirectTo);
  logOriginDecision("reset password", decisione);

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: decisione.origin
      ? { redirectTo: `${decisione.origin}${CALLBACK_PATH}` }
      : undefined,
  });

  if (linkError || !link?.properties?.hashed_token) {
    console.error("reset password: generazione del link fallita:", linkError?.message);
    return;
  }

  // Il link punta all'applicazione, non al verificatore di Supabase: il perche'
  // e' spiegato su buildOtpLink in _shared/links.ts.
  const actionLink = buildOtpLink(
    decisione.origin,
    link.properties.hashed_token,
    "recovery",
    { reimposta: "1" },
  );
  const message = passwordResetEmail(
    profile.full_name ?? "",
    actionLink,
    decisione.origin,
  );

  if (!configuredTransport()) {
    console.warn(
      "reset password: nessun servizio di posta configurato. " +
        `Link generato, da consegnare a mano: ${actionLink}`,
    );
    return;
  }

  try {
    const via = await sendMail(email, message);
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
