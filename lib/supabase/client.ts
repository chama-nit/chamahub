"use client";

// ---------------------------------------------------------------------------
// Client Supabase per il browser
// ---------------------------------------------------------------------------
// L'applicazione e' interamente client-side: questo e' l'unico punto di
// contatto con il backend. La chiave usata e' la chiave "anon", pensata per
// essere pubblica; la sicurezza reale e' garantita dalle policy RLS e dalle
// Edge Function. La chiave service_role non compare mai nel bundle.
// ---------------------------------------------------------------------------

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

export function getSupabase(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Configurazione Supabase mancante: definisci NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local",
    );
  }

  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    });
  }

  return client;
}

// ---------------------------------------------------------------------------
// Invocazione delle Edge Function
// ---------------------------------------------------------------------------
// Il token viene preso e passato esplicitamente, invece di affidarsi a quello
// che `functions.invoke` ha in memoria.
//
// Il motivo e' un caso concreto: se la pagina resta aperta a lungo il token di
// accesso scade, e finche' nessuno interroga il database la libreria non se ne
// accorge. In quella finestra `invoke` spedisce la chiave anonima al posto del
// token della persona, la funzione non riconosce nessun utente e risponde 401
// - un "Non autorizzato" che dall'interfaccia sembra un problema di permessi
// mentre e' solo una sessione da rinnovare.
//
// `getSession()` rinnova il token se e' scaduto: chiamandolo prima di ogni
// invocazione la finestra si chiude. Se davvero non c'e' piu' una sessione,
// meglio dirlo con parole chiare che lasciar rispondere 401 al server.
export async function callFunction<T>(
  name: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const supabase = getSupabase();

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (!accessToken) {
    throw new Error(
      "La sessione e' scaduta: ricarica la pagina e accedi di nuovo.",
    );
  }

  const { data, error } = await supabase.functions.invoke(name, {
    body: payload,
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (error) {
    let message = error.message;
    const context = (error as { context?: Response }).context;

    if (context && typeof context.json === "function") {
      try {
        const body = await context.json();
        if (body?.error) {
          message = body.missing_questions?.length
            ? `${body.error} Mancano: ${body.missing_questions.join(", ")}.`
            : body.error;
        }
      } catch {
        // Il corpo non era JSON: si tiene il messaggio originale.
      }
    }

    throw new Error(message);
  }

  return data as T;
}

// ---------------------------------------------------------------------------
// Funzioni pubbliche
// ---------------------------------------------------------------------------
// Alcune funzioni servono a chi una sessione non ce l'ha ancora: il recupero
// della password, per esempio. Qui non si cerca nessun token - viaggia la sola
// chiave anonima, che e' pubblica per definizione - e la funzione corrispondente
// va pubblicata senza verifica del token (`verify_jwt = false`).
export async function callPublicFunction<T>(
  name: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const supabase = getSupabase();
  const { data, error } = await supabase.functions.invoke(name, {
    body: payload,
  });

  if (error) {
    let message = error.message;
    const context = (error as { context?: Response }).context;

    if (context && typeof context.json === "function") {
      try {
        const body = await context.json();
        if (body?.error) message = body.error;
      } catch {
        /* il corpo non era JSON: si tiene il messaggio originale */
      }
    }

    throw new Error(message);
  }

  return data as T;
}
