"use client";

// ---------------------------------------------------------------------------
// Impersonificazione (solo SystemAdmin)
// ---------------------------------------------------------------------------
// Serve a vedere l'applicazione esattamente come la vede un'altra persona:
// non solo i menu, ma i dati, perche' da quel momento le policy RLS valutano
// il suo identificativo.
//
// Come funziona il giro:
//
//   1. la Edge Function `impersonate` verifica che a chiedere sia un sysadmin
//      e restituisce un token monouso per la persona scelta;
//   2. qui si mette da parte la sessione del sysadmin - PRIMA di sostituirla,
//      altrimenti non ci sarebbe piu' modo di tornare indietro;
//   3. `verifyOtp` consuma il token e apre la sessione della persona;
//   4. la pagina viene ricaricata per intero: cosi' ogni componente riparte
//      dai dati nuovi, senza residui di quelli vecchi in memoria.
//
// La sessione di partenza vive in localStorage: se il browser viene chiuso a
// meta' del giro, alla riapertura il pannello mostra ancora "stai impersonando
// X" e permette di rientrare nei propri panni.
// ---------------------------------------------------------------------------

import { callFunction, getSupabase } from "@/lib/supabase/client";

const KEY = "chamahub:impersonation";

export interface ImpersonationState {
  /** Chi ha avviato l'impersonificazione. */
  actor: { id: string; full_name: string };
  /** Di chi si stanno indossando i panni. */
  target: { id: string; full_name: string; email: string };
  /** Sessione del sysadmin, da ripristinare all'uscita. */
  origin: { access_token: string; refresh_token: string };
}

// ---------------------------------------------------------------------------
// Archivio con notifica: gli stessi meccanismi di SortableGrid, cosi' il
// pannello si aggiorna senza effetti collaterali dentro i componenti.
// ---------------------------------------------------------------------------
const listeners = new Set<() => void>();

export function subscribeImpersonation(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

export function readImpersonationRaw(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function parseImpersonation(raw: string): ImpersonationState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ImpersonationState;
    return parsed?.target?.id && parsed?.origin?.refresh_token ? parsed : null;
  } catch {
    return null;
  }
}

function write(value: ImpersonationState | null) {
  try {
    if (value) window.localStorage.setItem(KEY, JSON.stringify(value));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* modalita' privata: si perde solo la via del ritorno automatico */
  }
  listeners.forEach((notify) => notify());
}

// ---------------------------------------------------------------------------
export async function startImpersonation(
  actor: { id: string; full_name: string },
  targetId: string,
): Promise<void> {
  const supabase = getSupabase();

  const { data: current } = await supabase.auth.getSession();
  const origin = current.session;

  if (!origin?.refresh_token) {
    throw new Error(
      "Sessione non disponibile: ricarica la pagina prima di impersonare qualcuno.",
    );
  }

  const result = await callFunction<{
    token_hash: string;
    target: { id: string; full_name: string; email: string };
  }>("impersonate", { target_id: targetId });

  // Prima si mette al sicuro la via del ritorno, poi si cambia sessione.
  write({
    actor,
    target: result.target,
    origin: {
      access_token: origin.access_token,
      refresh_token: origin.refresh_token,
    },
  });

  const { error } = await supabase.auth.verifyOtp({
    token_hash: result.token_hash,
    type: "magiclink",
  });

  if (error) {
    write(null);
    throw new Error(error.message);
  }

  // Ricarica completa, non router.push: cambiando identita' va buttato via
  // tutto lo stato in memoria (profilo, elenchi gia' caricati, cache dei
  // componenti). Una navigazione interna lo conserverebbe, e si vedrebbero i
  // dati di prima con i permessi di adesso.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/dashboard");
}

export async function stopImpersonation(): Promise<void> {
  const state = parseImpersonation(readImpersonationRaw());
  if (!state) return;

  const supabase = getSupabase();
  const { error } = await supabase.auth.setSession(state.origin);

  // Anche se il ripristino fallisce (sessione originale ormai scaduta) si
  // esce dai panni altrui: meglio la pagina di accesso che restare bloccati
  // nell'identita' di un'altra persona.
  write(null);

  if (error) {
    await supabase.auth.signOut();
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
    return;
  }

  // Anche qui serve ripartire da zero: vedi la nota in startImpersonation.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/sistema");
}
