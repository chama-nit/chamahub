// ===========================================================================
// I link monouso che finiscono nelle email
// ===========================================================================
// Un solo punto in cui si decide che forma ha il collegamento che arriva alla
// persona. Lo usano l'invito (admin-users), il recupero password
// (request-password-reset) e il link che l'HR consegna a mano: se cambia la
// pagina che li riceve, o i parametri che servono, si cambia qui e cambiano
// tutti e tre insieme.
//
// Chi li riceve e' app/auth/callback/page.tsx, che scambia il codice con
// `verifyOtp({ token_hash, type })`.
// ===========================================================================

/** Pagina dell'applicazione che scambia il codice con una sessione. */
export const CALLBACK_PATH = "/auth/callback";

// ---------------------------------------------------------------------------
// Da quale indirizzo esce il link
// ---------------------------------------------------------------------------
// La risposta breve: da dove viene usata l'applicazione. Il browser manda
// `redirect_to` costruito su `window.location.origin`, e il link nell'email
// eredita quell'origine. Chi apre ChamaHub su localhost genera email che
// puntano a localhost; chi la apre sul dominio aziendale genera email che
// puntano li'. Non c'e' niente da configurare perche' funzioni.
//
// C'e' pero' qualcosa da configurare perche' sia SICURO, ed e' il motivo per
// cui esiste questo blocco.
//
// Il problema
// -----------
// `request-password-reset` e' pubblica per necessita': chi ha perso la password
// non ha una sessione da esibire. Il suo corpo pero' contiene `redirect_to`, e
// un corpo pubblico e' un corpo che scrive chiunque:
//
//   POST /functions/v1/request-password-reset
//   { "email": "vittima@azienda.it",
//     "redirect_to": "https://sito-malevolo.example/auth/callback" }
//
// La vittima riceverebbe un'email autentica - spedita dalla casella aziendale
// vera, con SPF e DKIM in regola - il cui pulsante porta al sito
// dell'attaccante con un token_hash valido in mano. Un clic, e chi ha
// preparato quella pagina apre una sessione a nome della vittima.
//
// Finche' il link era `action_link` il problema non esisteva: era GoTrue a
// confrontare `redirect_to` con l'elenco Redirect URLs del progetto. Passando a
// costruire l'indirizzo qui, quel controllo e' sparito insieme al resto - e va
// rimesso, perche' non lo fa piu' nessun altro.
//
// La soluzione
// ------------
// Il link non si costruisce MAI concatenando la stringa del chiamante: si parte
// da un'origine presa da un elenco di indirizzi fidati, e sopra ci si rimette
// il percorso e i parametri decisi qui. `redirect_to` puo' al massimo SCEGLIERE
// fra quelli, non aggiungerne.
//
//   APP_URL            l'indirizzo pubblico dell'applicazione. Va impostato in
//                      produzione: e' quello che rende deterministica la cosa.
//   APP_URL_ALLOWLIST  altre origini ammesse, separate da virgola. Serve a chi
//                      sviluppa in locale o a un ambiente di collaudo:
//                      "http://localhost:3000,https://collaudo.azienda.it"
//
// Senza APP_URL si continua a usare l'origine ricevuta - l'applicazione
// funziona come prima, cosi' nessuno resta a piedi - ma ogni invio lascia un
// avviso nei log, perche' quella e' una configurazione da sviluppo.

/** Origini ammesse per i link, dalla configurazione. */
export function allowedOrigins(): string[] {
  const origini: string[] = [];

  const principale = Deno.env.get("APP_URL")?.trim();
  if (principale) origini.push(principale);

  const altre = Deno.env.get("APP_URL_ALLOWLIST")?.trim();
  if (altre) origini.push(...altre.split(",").map((v) => v.trim()).filter(Boolean));

  return origini
    .map((valore) => {
      try {
        return new URL(valore).origin;
      } catch {
        console.warn(`links: origine non valida in configurazione, ignorata: ${valore}`);
        return "";
      }
    })
    .filter(Boolean);
}

export interface OriginDecision {
  /** L'origine da usare per costruire il link. */
  origin: string;
  /** `false` quando quella richiesta e' stata scartata, o non verificata. */
  trusted: boolean;
  /** Cosa aveva chiesto il chiamante, per i log. */
  requested?: string;
}

/**
 * Sceglie l'origine del link fra quelle ammesse.
 *
 * Non solleva mai: un'origine sbagliata non deve impedire a chi ha davvero
 * dimenticato la password di ricevere l'email. Viene semplicemente sostituita
 * con quella ufficiale, e l'accaduto finisce nei log.
 */
export function resolveOrigin(requested: string | undefined): OriginDecision {
  const ammesse = allowedOrigins();

  let richiesta = "";
  if (requested) {
    try {
      richiesta = new URL(requested).origin;
    } catch {
      richiesta = "";
    }
  }

  // Nessun elenco configurato: si usa quella ricevuta, ed e' un avviso.
  if (ammesse.length === 0) {
    return { origin: richiesta, trusted: false, requested: richiesta || requested };
  }

  if (richiesta && ammesse.includes(richiesta)) {
    return { origin: richiesta, trusted: true, requested: richiesta };
  }

  // Fuori elenco: si ripiega sull'indirizzo ufficiale, che e' il primo.
  return { origin: ammesse[0], trusted: false, requested: richiesta || requested };
}

/** Registra nei log come e' andata la scelta dell'origine. */
export function logOriginDecision(etichetta: string, d: OriginDecision): void {
  if (d.trusted) return;

  if (allowedOrigins().length === 0) {
    console.warn(
      `${etichetta}: APP_URL non configurato, il link usa l'origine ricevuta dal ` +
        `chiamante (${d.origin || "assente"}). In produzione impostare il secret ` +
        "APP_URL: senza, chiunque puo' far recapitare un link che punta altrove.",
    );
    return;
  }

  console.warn(
    `${etichetta}: origine richiesta "${d.requested ?? "assente"}" non ammessa, ` +
      `sostituita con ${d.origin}. Se e' legittima, aggiungila a APP_URL_ALLOWLIST.`,
  );
}

/**
 * Costruisce il link da mettere nell'email a partire da `generateLink()`.
 *
 * Perche' non si usa `properties.action_link`
 * -------------------------------------------
 * `action_link` punta al verificatore di Supabase, che convalida il token e poi
 * rimbalza sull'applicazione con la sessione appesa al frammento dell'URL
 * (`#access_token=...`): il vecchio flusso "implicito". Il client di ChamaHub
 * pero' e' configurato in PKCE, e davanti a un frammento del genere la libreria
 * si rifiuta esplicitamente di procedere - «Not a valid PKCE flow url» - perche'
 * i due flussi non si mescolano. Risultato: la pagina si carica, gira, e la
 * sessione non nasce mai.
 *
 * PKCE non e' una strada percorribile per un link generato qui: il flusso PKCE
 * richiede che sia stato il browser di quella persona a iniziare la richiesta,
 * conservando un verificatore che noi, dal server, non possiamo conoscere.
 *
 * La terza via, che e' quella giusta, e' `hashed_token`: si porta il codice
 * fino a una pagina dell'applicazione, che lo scambia con
 * `verifyOtp({ token_hash, type })`. Nessun frammento, nessun flusso implicito,
 * e funziona a prescindere da come e' configurato il client.
 *
 * Un effetto collaterale prezioso: il codice viene consumato solo quando la
 * pagina esegue lo scambio, cioe' quando c'e' davvero un browser. Con
 * `action_link` bastava una GET perche' il token fosse speso - ed e'
 * esattamente cio' che fanno i controlli antiphishing della posta aziendale
 * (Defender for Office 365 e i suoi Safe Links visitano gli indirizzi prima del
 * destinatario). Il link arrivava gia' bruciato, e la persona leggeva
 * "collegamento non valido o scaduto" senza aver cliccato niente.
 */
export function buildOtpLink(
  origin: string,
  hashedToken: string,
  type: "recovery" | "invite" | "magiclink" | "signup",
  extra: Record<string, string> = {},
): string {
  // L'indirizzo si ricostruisce da zero: origine fidata + percorso noto +
  // parametri scelti qui. Nessun pezzo della stringa del chiamante arriva
  // intatto fin dentro il link.
  const url = new URL(CALLBACK_PATH, `${origin.replace(/\/+$/, "")}/`);
  url.searchParams.set("token_hash", hashedToken);
  url.searchParams.set("type", type);
  for (const [chiave, valore] of Object.entries(extra)) {
    url.searchParams.set(chiave, valore);
  }
  return url.toString();
}
