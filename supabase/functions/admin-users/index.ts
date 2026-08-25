// ===========================================================================
// Edge Function: admin-users
// ===========================================================================
// Gestione dell'anagrafica dipendenti riservata al reparto HR.
//
// Perche' passa da una Edge Function e non da RLS: creare un utente significa
// scrivere in `auth.users`, operazione possibile solo con la chiave
// service_role, che non puo' mai raggiungere il browser. La funzione verifica
// che il chiamante sia realmente un HR attivo prima di usare quella chiave.
//
// Azioni supportate (POST, corpo JSON con campo `action`):
//   create      -> crea l'utente e il profilo (mai dipendente dall'SMTP;
//                  l'eventuale email e' un passaggio accessorio)
//   update      -> aggiorna anagrafica, ruolo e area
//   set_role    -> scorciatoia per nominare/rimuovere un responsabile
//   deactivate  -> disattiva il profilo (l'account resta, non puo' operare)
//   reactivate  -> riattiva il profilo
//   delete      -> elimina definitivamente utente e dati collegati
//   recovery_link   -> genera un link di reimpostazione da consegnare a mano
//   set_managed_areas -> stabilisce di quali aree la persona e' responsabile
// ===========================================================================

import { type SupabaseClient } from "npm:@supabase/supabase-js@2.112.3";
import {
  adminClient,
  AuthError,
  readJson,
  requireCaller,
  requireRole,
  type UserRole,
} from "../_shared/auth.ts";
import { inviteEmail } from "../_shared/email.ts";
import {
  buildOtpLink,
  CALLBACK_PATH,
  logOriginDecision,
  resolveOrigin,
} from "../_shared/links.ts";
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { configuredTransport, sendMail } from "../_shared/mailer.ts";

interface Payload {
  action:
    | "create"
    | "update"
    | "set_role"
    | "deactivate"
    | "reactivate"
    | "delete"
    | "recovery_link"
    | "set_managed_areas";
  id?: string;
  email?: string;
  full_name?: string;
  role?: UserRole;
  area_id?: string | null;
  job_title?: string | null;
  phone?: string | null;
  hired_on?: string | null;
  password?: string;
  send_invite?: boolean;
  redirect_to?: string;
  /** Aree di cui la persona diventa responsabile. Elenco completo, non aggiunte. */
  managed_area_ids?: string[];
}

// `sysadmin` non compare di proposito: quel ruolo non si assegna
// dall'applicazione, nemmeno da parte di un sysadmin. Nasce solo dal database
// (supabase/scripts/03_crea_systemadmin.sql), cosi' non esiste una scala che si
// possa salire da dentro l'applicazione.
const VALID_ROLES: UserRole[] = ["employee", "manager", "hr"];

/** Oltre questa soglia si smette di aspettare l'invio della mail. */
const EMAIL_TIMEOUT_MS = 10_000;

function assert(condition: unknown, message: string, status = 400): void {
  if (!condition) throw new AuthError(message, status);
}

/**
 * Converte un errore di Supabase in AuthError CONSERVANDONE lo stato HTTP.
 *
 * Prima qui c'era un `400` fisso: un guasto dell'SMTP (che GoTrue segnala come
 * 500) arrivava al browser travestito da errore di validazione, e capire cosa
 * fosse successo diventava molto piu' difficile del necessario.
 */
function fromSupabaseError(error: unknown, fallback = 400): AuthError {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as { status?: number })?.status;
  return new AuthError(message, typeof status === "number" ? status : fallback);
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function generatePassword(): string {
  // 18 byte casuali in base64url: robusta e leggibile per una comunicazione
  // temporanea all'interessato.
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Un profilo SystemAdmin e' intoccabile per chiunque non lo sia a sua volta.
 * Il controllo vive qui e non nel database perche' questa funzione lavora con
 * `service_role`, che per definizione scavalca le policy: se il divieto non e'
 * scritto in questo punto, non e' scritto da nessuna parte.
 */
async function assertMayTouch(
  admin: SupabaseClient,
  caller: { id: string; role: UserRole },
  targetId: string,
) {
  const { data: target, error } = await admin
    .from("profiles")
    .select("role")
    .eq("id", targetId)
    .maybeSingle();

  if (error) throw fromSupabaseError(error);

  if (target?.role === "sysadmin" && caller.role !== "sysadmin") {
    throw new AuthError(
      "Questo profilo e' un SystemAdmin: solo un altro SystemAdmin puo' modificarlo.",
      403,
    );
  }
}

/**
 * Il ruolo `manager` non si assegna piu' a mano.
 *
 * Dalla migrazione 18 "responsabile" non e' un attributo della persona ma la
 * conseguenza di un fatto: guidare almeno un'area. Il ruolo lo scrive un
 * trigger quando l'elenco cambia.
 *
 * Lasciar passare `role: "manager"` sarebbe peggio che vietarlo: scriverebbe
 * l'etichetta senza dare nessun potere - `is_manager()` guarda l'elenco, non il
 * ruolo - e l'HR si ritroverebbe un responsabile che non vede la propria area,
 * senza un solo messaggio d'errore da cui partire per capire.
 */
async function assertRoleChangeAllowed(
  admin: SupabaseClient,
  id: string,
  role: UserRole,
) {
  if (role === "manager") {
    throw new AuthError(
      "Il ruolo di responsabile non si assegna direttamente: assegna alla persona una o piu' aree da guidare e il ruolo si aggiorna da solo.",
      400,
    );
  }

  if (role === "employee") {
    const { count } = await admin
      .from("area_managers")
      .select("area_id", { count: "exact", head: true })
      .eq("profile_id", id);

    if ((count ?? 0) > 0) {
      throw new AuthError(
        "Questa persona guida ancora una o piu' aree: togli le aree e il ruolo tornera' a dipendente da solo.",
        400,
      );
    }
  }
}

async function applyProfile(
  admin: SupabaseClient,
  id: string,
  body: Payload,
  opts: { activate?: boolean } = {},
) {
  const patch: Record<string, unknown> = {};

  if (body.full_name !== undefined) patch.full_name = body.full_name.trim();
  if (body.role !== undefined) {
    assert(VALID_ROLES.includes(body.role), "Ruolo non valido.");
    await assertRoleChangeAllowed(admin, id, body.role);
    patch.role = body.role;
  }
  if (body.area_id !== undefined) patch.area_id = body.area_id || null;
  if (body.job_title !== undefined) patch.job_title = body.job_title || null;
  if (body.phone !== undefined) patch.phone = body.phone || null;
  if (body.hired_on !== undefined) patch.hired_on = body.hired_on || null;
  if (opts.activate !== undefined) patch.is_active = opts.activate;

  if (Object.keys(patch).length === 0) return null;

  const { data, error } = await admin
    .from("profiles")
    .update(patch)
    .eq("id", id)
    .select("id, email, full_name, role, area_id, job_title, phone, hired_on, is_active")
    .single();

  if (error) throw fromSupabaseError(error);
  return data;
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const admin = adminClient();
    const caller = await requireCaller(req, admin);
    requireRole(caller, "hr");

    const body = await readJson<Payload>(req);
    assert(body?.action, "Campo `action` mancante.");

    switch (body.action) {
      // ---------------------------------------------------------------------
      case "create": {
        assert(body.email, "Indirizzo email obbligatorio.");
        assert(body.full_name?.trim(), "Nome e cognome obbligatori.");
        const email = normaliseEmail(body.email!);

        // Se la persona ha gia' effettuato l'accesso con Microsoft, l'utente
        // esiste gia': in quel caso non si crea nulla, si completa il profilo.
        const { data: existing } = await admin
          .from("profiles")
          .select("id")
          .eq("email", email)
          .maybeSingle();

        if (existing) {
          const profile = await applyProfile(admin, existing.id, body, {
            activate: true,
          });
          return jsonResponse({
            profile,
            created: false,
            note:
              "L'utente aveva gia' un account (probabilmente tramite accesso Microsoft): il profilo e' stato completato e attivato.",
          });
        }

        // -------------------------------------------------------------------
        // La creazione NON dipende mai dal server di posta.
        // -------------------------------------------------------------------
        // Prima si crea l'account con una password temporanea: e' un'operazione
        // puramente locale al database di autenticazione e non puo' fallire per
        // colpa dell'SMTP. Solo dopo, e solo se richiesto, si tenta l'invio
        // dell'email - come passaggio accessorio che, se va storto, produce un
        // avviso invece di far fallire tutto.
        //
        // La versione precedente usava `inviteUserByEmail`, che crea e spedisce
        // in un colpo solo: con l'SMTP irraggiungibile restava appesa fino al
        // timeout e poteva lasciare un account a meta'.
        const password = body.password?.trim() || generatePassword();
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: body.full_name!.trim() },
        });
        if (error) throw fromSupabaseError(error);

        const profile = await applyProfile(admin, data.user.id, body, {
          activate: true,
        });

        // Invio facoltativo, e volutamente "best effort": qualunque cosa vada
        // storta qui, l'account esiste gia' e l'HR ha comunque la password.
        let emailSent = false;
        let emailError: string | null = null;

        if (body.send_invite && !configuredTransport()) {
          // Detto prima di provarci: e' una configurazione mancante, non un
          // guasto, e l'HR ha diritto a leggerlo in questi termini invece che
          // come l'ennesimo timeout.
          emailError =
            "nessun servizio di posta configurato per le Edge Function " +
            "(secret MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_MAIL_SENDER " +
            "per Microsoft Graph; in alternativa RESEND_API_KEY o SMTP_HOST)";
          console.warn(`admin-users: invito non spedito - ${emailError}`);
        } else if (body.send_invite) {
          try {
            // Il link si genera qui e si spedisce da qui.
            //
            // Prima questa riga era `resetPasswordForEmail()`, che delega tutto
            // a Supabase: generazione E spedizione attraverso il server SMTP del
            // progetto. Bastava che quel server non rispondesse - e verso
            // Microsoft 365 succede al primo dettaglio fuori posto - perche' la
            // chiamata restasse appesa fino al timeout, con l'HR davanti a una
            // rotellina e nessuna spiegazione. `generateLink` non spedisce
            // nulla: e' un'operazione locale al database di autenticazione, e
            // non puo' fallire per colpa della posta.
            const decisione = resolveOrigin(body.redirect_to);
            logOriginDecision("admin-users invito", decisione);

            const { data: link, error: linkError } = await admin.auth.admin
              .generateLink({
                type: "recovery",
                email,
                options: decisione.origin
                  ? { redirectTo: `${decisione.origin}${CALLBACK_PATH}` }
                  : undefined,
              });
            if (linkError) throw linkError;

            const hashedToken = link?.properties?.hashed_token;
            if (!hashedToken) throw new Error("link di accesso non generato");

            // `reimposta=1` porta chi arriva direttamente alla scelta della
            // password: e' l'unica cosa che deve fare al primo accesso, e la
            // password temporanea non gliel'abbiamo mai scritta.
            const actionLink = buildOtpLink(
              decisione.origin,
              hashedToken,
              "recovery",
              { reimposta: "1" },
            );

            const via = await sendMail(
              email,
              inviteEmail(
                body.full_name!.trim(),
                actionLink,
                decisione.origin,
              ),
              EMAIL_TIMEOUT_MS,
            );
            console.info(`admin-users: invito inviato via ${via}`);
            emailSent = true;
          } catch (err) {
            emailError = err instanceof Error ? err.message : String(err);
            console.error("admin-users: invio email fallito:", emailError);
          }
        }

        return jsonResponse({
          profile,
          created: true,
          email_sent: emailSent,
          // Restituita una sola volta, perche' l'HR possa comunicarla.
          // Non viene mai salvata in chiaro da nessuna parte.
          temporary_password: body.password ? undefined : password,
          warning: emailError
            ? `L'account e' stato creato correttamente, ma l'email non e' partita (${emailError}). Comunica tu la password temporanea qui sotto.`
            : undefined,
        });
      }

      // ---------------------------------------------------------------------
      case "update":
      case "set_role": {
        assert(body.id, "Identificativo del dipendente mancante.");
        await assertMayTouch(admin, caller, body.id!);
        assert(
          body.id !== caller.id || body.role === undefined ||
            body.role === "hr",
          "Non puoi modificare il tuo stesso ruolo HR.",
        );
        const profile = await applyProfile(admin, body.id!, body);
        return jsonResponse({ profile });
      }

      // ---------------------------------------------------------------------
      case "deactivate": {
        assert(body.id, "Identificativo del dipendente mancante.");
        assert(
          body.id !== caller.id,
          "Non puoi disattivare il tuo stesso account.",
        );
        await assertMayTouch(admin, caller, body.id!);

        // Blocca anche l'autenticazione, non solo l'accesso applicativo.
        const { error: banError } = await admin.auth.admin.updateUserById(
          body.id!,
          { ban_duration: "876000h" },
        );
        if (banError) throw fromSupabaseError(banError);

        const profile = await applyProfile(admin, body.id!, {} as Payload, {
          activate: false,
        });
        return jsonResponse({ profile });
      }

      // ---------------------------------------------------------------------
      case "reactivate": {
        assert(body.id, "Identificativo del dipendente mancante.");
        await assertMayTouch(admin, caller, body.id!);
        const { error: banError } = await admin.auth.admin.updateUserById(
          body.id!,
          { ban_duration: "none" },
        );
        if (banError) throw fromSupabaseError(banError);

        const profile = await applyProfile(admin, body.id!, body, {
          activate: true,
        });
        return jsonResponse({ profile });
      }

      // ---------------------------------------------------------------------
      case "delete": {
        assert(body.id, "Identificativo del dipendente mancante.");
        assert(
          body.id !== caller.id,
          "Non puoi eliminare il tuo stesso account.",
        );
        await assertMayTouch(admin, caller, body.id!);

        // L'eliminazione dell'utente propaga in cascata a profiles e a tutti i
        // dati collegati (calendario, richieste, valutazioni). Le compilazioni
        // di gradimento restano, perche' non sono in alcun modo collegate.
        const { error } = await admin.auth.admin.deleteUser(body.id!);
        if (error) throw fromSupabaseError(error);
        return jsonResponse({ deleted: true });
      }

      // ---------------------------------------------------------------------
      case "set_managed_areas": {
        assert(body.id, "Identificativo del dipendente mancante.");
        assert(
          Array.isArray(body.managed_area_ids),
          "Elenco delle aree mancante.",
        );
        await assertMayTouch(admin, caller, body.id!);

        // L'elenco arriva completo, non incrementale: si sostituisce quello
        // esistente. E' l'unico modo di rappresentare anche la revoca senza
        // aggiungere un'azione apposta, e rispecchia com'e' fatta
        // l'interfaccia - una serie di caselle che si spuntano.
        const richieste = [...new Set(body.managed_area_ids!)];

        if (richieste.length > 0) {
          const { data: esistenti, error: areaError } = await admin
            .from("areas")
            .select("id")
            .in("id", richieste);

          if (areaError) throw fromSupabaseError(areaError, 500);
          assert(
            (esistenti ?? []).length === richieste.length,
            "Una delle aree indicate non esiste.",
          );
        }

        const { error: deleteError } = await admin
          .from("area_managers")
          .delete()
          .eq("profile_id", body.id!);
        if (deleteError) throw fromSupabaseError(deleteError, 500);

        if (richieste.length > 0) {
          const { error: insertError } = await admin
            .from("area_managers")
            .insert(richieste.map((area_id) => ({ area_id, profile_id: body.id! })));
          if (insertError) throw fromSupabaseError(insertError, 500);
        }

        // Il ruolo lo allinea il trigger sul database: qui si rilegge il
        // profilo per restituirlo gia' aggiornato, invece di lasciare
        // all'interfaccia il compito di indovinare com'e' finita.
        const { data: profile, error: profileError } = await admin
          .from("profiles")
          .select("id, email, full_name, role, area_id, job_title, phone, hired_on, is_active")
          .eq("id", body.id!)
          .single();
        if (profileError) throw fromSupabaseError(profileError, 500);

        return jsonResponse({ profile, managed_area_ids: richieste });
      }

      // ---------------------------------------------------------------------
      case "recovery_link": {
        assert(body.email, "Indirizzo email obbligatorio.");

        // NB: `generateLink` NON spedisce nulla, genera soltanto il link
        // (la documentazione Supabase lo definisce "to be sent via a custom
        // email provider"). Il link viene quindi restituito all'HR, che lo
        // consegna come preferisce: e' l'unica strada che funziona anche senza
        // SMTP configurato.
        const scelta = resolveOrigin(body.redirect_to);
        logOriginDecision("admin-users link manuale", scelta);

        const { data, error } = await admin.auth.admin.generateLink({
          type: "recovery",
          email: normaliseEmail(body.email!),
          options: scelta.origin
            ? { redirectTo: `${scelta.origin}${CALLBACK_PATH}` }
            : undefined,
        });
        if (error) throw fromSupabaseError(error);

        const hashed = data.properties?.hashed_token;

        return jsonResponse({
          // Anche questo link passa da `token_hash`, non da `action_link`: e'
          // lo stesso link che finirebbe in un'email, solo consegnato a mano,
          // e soffrirebbe dello stesso incaglio fra flusso implicito e PKCE.
          action_link: hashed
            ? buildOtpLink(scelta.origin, hashed, "recovery", { reimposta: "1" })
            : null,
          expires_in_hours: 1,
        });
      }

      // ---------------------------------------------------------------------
      default:
        return errorResponse("Azione non riconosciuta.", 400);
    }
  } catch (err) {
    if (err instanceof AuthError) return errorResponse(err.message, err.status);
    console.error("admin-users:", err);
    return errorResponse("Errore interno del server.", 500);
  }
});
