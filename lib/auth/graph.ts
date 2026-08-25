"use client";

// ---------------------------------------------------------------------------
// Lettura della scheda personale da Microsoft Graph
// ---------------------------------------------------------------------------
// Perche' esiste questo file
// --------------------------
// Il trigger `handle_new_user()` scrive il nome del profilo pescandolo dai
// metadati che Entra ID ha messo nel token. Quando quei metadati mancano - e
// mancano spesso, perche' il claim `name` non e' garantito e su parecchi tenant
// l'indirizzo arriva in `preferred_username` invece che in `email` - il
// ripiego e' la parte prima della chiocciola. Il risultato e' un elenco
// dipendenti pieno di "mario.rossi", che l'HR deve correggere a mano una riga
// alla volta.
//
// Con l'autorizzazione `User.Read` (delegata, predefinita in ogni registrazione
// Entra ID, nessun consenso dell'amministratore) si puo' chiedere la stessa
// informazione a Microsoft Graph, che la restituisce gia' divisa in nome,
// cognome e indirizzo.
//
// Cosa NON fa
// -----------
// Non sovrascrive un nome scritto da qualcuno. Se l'HR ha registrato "Maria
// Rossi Bianchi" e Graph risponde "Maria Rossi", vince l'HR: l'anagrafica
// aziendale e' la fonte, Graph solo un riempitivo per le caselle vuote.
// ---------------------------------------------------------------------------

export interface GraphProfile {
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
}

/**
 * Legge `/me` con il token rilasciato da Microsoft durante l'accesso.
 *
 * Restituisce `null` a ogni intoppo (token assente o scaduto, autorizzazione
 * non concessa, Graph irraggiungibile): questa e' una rifinitura, e non deve
 * mai essere il motivo per cui un accesso valido non va a buon fine.
 */
export async function readGraphProfile(
  providerToken: string | null | undefined,
): Promise<GraphProfile | null> {
  if (!providerToken) return null;

  try {
    const response = await fetch(
      "https://graph.microsoft.com/v1.0/me?$select=givenName,surname,displayName,mail,userPrincipalName",
      { headers: { Authorization: `Bearer ${providerToken}` } },
    );
    if (!response.ok) return null;

    const data = (await response.json()) as {
      givenName?: string | null;
      surname?: string | null;
      displayName?: string | null;
      mail?: string | null;
      userPrincipalName?: string | null;
    };

    // `mail` e' vuoto per gli account senza casella: l'UPN e' il ripiego
    // consueto, ed e' comunque un indirizzo.
    const email = (data.mail ?? data.userPrincipalName ?? "").trim();
    const firstName = (data.givenName ?? "").trim();
    const lastName = (data.surname ?? "").trim();
    const displayName = (data.displayName ?? "").trim() ||
      [firstName, lastName].filter(Boolean).join(" ");

    return { firstName, lastName, displayName, email };
  } catch {
    return null;
  }
}

/**
 * Dice se il nome registrato e' un ripiego generato dal sistema e non una
 * scelta di qualcuno: vuoto, oppure identico alla parte iniziale
 * dell'indirizzo, che e' esattamente cio' che scrive il trigger quando il token
 * non porta nulla di meglio.
 */
export function isPlaceholderName(
  fullName: string | null | undefined,
  email: string | null | undefined,
): boolean {
  const current = (fullName ?? "").trim();
  if (!current) return true;

  const localPart = (email ?? "").split("@")[0]?.trim() ?? "";
  return localPart.length > 0 && current.toLowerCase() === localPart.toLowerCase();
}
