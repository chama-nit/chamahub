// ===========================================================================
// Edge Function: impersonate
// ===========================================================================
// Permette a un SystemAdmin di aprire una sessione nei panni di un'altra
// persona, per vedere l'applicazione esattamente come la vede lei - non solo i
// menu, ma i dati, perche' da quel momento le policy RLS valutano il suo
// identificativo.
//
// Come funziona, e perche' cosi'
// ------------------------------
// Non esiste (per fortuna) un modo per "diventare" un altro utente lato
// client. Si passa da `generateLink`, che produce un token monouso senza
// spedire alcuna email - quindi funziona anche senza SMTP configurato - e il
// browser lo consuma con `verifyOtp`, ottenendo una sessione regolare.
//
// Le difese, in ordine:
//   1. solo un sysadmin attivo puo' chiamare la funzione;
//   2. non si impersona un altro sysadmin (nessuno "scala" verso l'alto) ne'
//      se stessi;
//   3. la persona bersaglio deve avere un profilo attivo;
//   4. ogni chiamata lascia una riga in `impersonation_log`, che solo un
//      sysadmin puo' leggere.
//
// Il token che esce di qui apre una sessione a tutti gli effetti: va trattato
// come una password. Per questo la risposta non viene mai registrata nei log e
// il client lo consuma immediatamente.
// ===========================================================================

import {
  adminClient,
  AuthError,
  readJson,
  requireCaller,
  requireRole,
} from "../_shared/auth.ts";
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/cors.ts";

interface Payload {
  target_id: string;
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const admin = adminClient();
    const caller = await requireCaller(req, admin);
    requireRole(caller, "sysadmin");

    const body = await readJson<Payload>(req);
    if (!body?.target_id) {
      throw new AuthError("Persona da impersonare non indicata.", 400);
    }

    if (body.target_id === caller.id) {
      throw new AuthError("Sei gia' nei tuoi panni.", 400);
    }

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id, email, full_name, role, is_active")
      .eq("id", body.target_id)
      .single();

    if (targetError || !target) {
      throw new AuthError("Persona non trovata.", 404);
    }

    if (target.role === "sysadmin") {
      throw new AuthError(
        "Un SystemAdmin non puo' impersonare un altro SystemAdmin.",
        403,
      );
    }

    if (!target.is_active) {
      throw new AuthError(
        "Il profilo non e' attivo: attivalo prima di impersonarlo.",
        409,
      );
    }

    if (!target.email) {
      throw new AuthError("Il profilo non ha un indirizzo email.", 409);
    }

    const { data: link, error: linkError } = await admin.auth.admin
      .generateLink({
        type: "magiclink",
        email: target.email,
      });

    if (linkError || !link?.properties?.hashed_token) {
      throw new AuthError(
        linkError?.message ?? "Impossibile generare la sessione.",
        500,
      );
    }

    // Registro: la riga si scrive prima di restituire il token, cosi' non
    // esiste una sessione impersonata senza la sua traccia.
    const { error: logError } = await admin.from("impersonation_log").insert({
      actor_id: caller.id,
      target_id: target.id,
    });
    if (logError) throw new AuthError(logError.message, 500);

    return jsonResponse({
      token_hash: link.properties.hashed_token,
      target: {
        id: target.id,
        full_name: target.full_name,
        email: target.email,
        role: target.role,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) return errorResponse(err.message, err.status);
    console.error("impersonate:", err);
    return errorResponse("Errore interno del server.", 500);
  }
});
