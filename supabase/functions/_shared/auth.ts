// ---------------------------------------------------------------------------
// Autenticazione e autorizzazione condivise fra le Edge Function.
// ---------------------------------------------------------------------------
// Ogni funzione riceve il JWT dell'utente nell'header Authorization. Il token
// viene verificato da Supabase Auth (mai decodificato "a mano"), poi il profilo
// applicativo viene letto con la chiave service_role per conoscere ruolo, area
// e stato di attivazione.
// ---------------------------------------------------------------------------

import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.112.3";

export type UserRole = "employee" | "manager" | "hr";

export interface CallerProfile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  area_id: string | null;
  is_active: boolean;
}

export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error(
      "Variabili SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY non disponibili.",
    );
  }

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

/**
 * Verifica il token della richiesta e restituisce il profilo del chiamante.
 * Solleva AuthError se il token manca, non e' valido o l'utente non e' attivo.
 */
export async function requireCaller(
  req: Request,
  admin: SupabaseClient,
): Promise<CallerProfile> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";

  if (!token) {
    throw new AuthError("Token di autenticazione mancante.", 401);
  }

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) {
    throw new AuthError("Token di autenticazione non valido.", 401);
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, email, full_name, role, area_id, is_active")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !profile) {
    throw new AuthError("Profilo applicativo non trovato.", 403);
  }

  if (!profile.is_active) {
    throw new AuthError(
      "Account non ancora attivato dal reparto HR.",
      403,
    );
  }

  return profile as CallerProfile;
}

export function requireRole(caller: CallerProfile, ...roles: UserRole[]): void {
  if (!roles.includes(caller.role)) {
    throw new AuthError(
      "Non hai i permessi necessari per questa operazione.",
      403,
    );
  }
}

export async function readJson<T>(req: Request): Promise<T> {
  if (req.method !== "POST") {
    throw new AuthError("Metodo non consentito.", 405);
  }
  try {
    return (await req.json()) as T;
  } catch {
    throw new AuthError("Corpo della richiesta non valido.", 400);
  }
}
