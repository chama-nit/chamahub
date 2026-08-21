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
// `functions.invoke` propaga automaticamente il token dell'utente. In caso di
// errore il corpo della risposta contiene il messaggio in italiano prodotto
// dalla funzione: viene estratto e rilanciato per poterlo mostrare a schermo.
export async function callFunction<T>(
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
