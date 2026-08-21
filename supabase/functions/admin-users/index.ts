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
// ===========================================================================

import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.112.3";
import {
  adminClient,
  AuthError,
  readJson,
  requireCaller,
  requireRole,
  type UserRole,
} from "../_shared/auth.ts";
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/cors.ts";

interface Payload {
  action:
    | "create"
    | "update"
    | "set_role"
    | "deactivate"
    | "reactivate"
    | "delete"
    | "recovery_link";
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
}

const VALID_ROLES: UserRole[] = ["employee", "manager", "hr"];

/**
 * Client usato per gli invii che passano dagli endpoint pubblici di Auth.
 * Si preferisce la chiave anon, che e' quella prevista per queste rotte;
 * se non fosse disponibile si ricade sul client amministrativo.
 */
function mailClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!anon) return adminClient();
  return createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

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

/**
 * L'invio della mail passa dal server SMTP configurato nel progetto: se quello
 * non risponde, la chiamata resta appesa finche' non scatta il timeout della
 * piattaforma. Meglio arrendersi prima e dire perche'.
 */
async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  // Il tipo del gestore cambia fra Deno e i tipi DOM: si usa quello
  // dedotto da setTimeout invece di fissarlo a `number`.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new AuthError(
                `${label}: il server di posta non ha risposto entro ${
                  EMAIL_TIMEOUT_MS / 1000
                } secondi. Controlla le impostazioni SMTP del progetto Supabase (Authentication → Emails → SMTP Settings).`,
                504,
              ),
            ),
          EMAIL_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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

        if (body.send_invite) {
          try {
            const { error: mailError } = await withTimeout(
              mailClient().auth.resetPasswordForEmail(email, {
                redirectTo: body.redirect_to,
              }),
              "Email non inviata",
            );
            if (mailError) throw mailError;
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

        // L'eliminazione dell'utente propaga in cascata a profiles e a tutti i
        // dati collegati (calendario, richieste, valutazioni). Le compilazioni
        // di gradimento restano, perche' non sono in alcun modo collegate.
        const { error } = await admin.auth.admin.deleteUser(body.id!);
        if (error) throw fromSupabaseError(error);
        return jsonResponse({ deleted: true });
      }

      // ---------------------------------------------------------------------
      case "recovery_link": {
        assert(body.email, "Indirizzo email obbligatorio.");

        // NB: `generateLink` NON spedisce nulla, genera soltanto il link
        // (la documentazione Supabase lo definisce "to be sent via a custom
        // email provider"). Il link viene quindi restituito all'HR, che lo
        // consegna come preferisce: e' l'unica strada che funziona anche senza
        // SMTP configurato.
        const { data, error } = await admin.auth.admin.generateLink({
          type: "recovery",
          email: normaliseEmail(body.email!),
          options: { redirectTo: body.redirect_to },
        });
        if (error) throw fromSupabaseError(error);

        return jsonResponse({
          action_link: data.properties?.action_link ?? null,
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
