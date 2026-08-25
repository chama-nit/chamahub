// ===========================================================================
// Le email: un solo impianto, un solo posto dove cambiarle
// ===========================================================================
// Prima ogni Edge Function si portava dietro il proprio HTML copiato e
// incollato: due intestazioni identiche, due pulsanti, due piedi di pagina, e
// due colori da ricordarsi di aggiornare insieme. Qui c'e' un `renderEmail()`
// che disegna la cornice, e sotto i messaggi veri e propri, che dicono solo
// cosa hanno da dire.
//
// Perche' l'HTML delle email e' scritto cosi' male
// ------------------------------------------------
// Perche' deve funzionare in Outlook, che disegna le pagine con il motore di
// Word. Da qui le scelte che altrove sarebbero indifendibili:
//
//   * tabelle per impaginare, non flexbox o grid;
//   * stili in linea su ogni elemento, perche' molti client buttano via il
//     blocco <style> (Gmail lo tiene, Outlook.com riscrive i selettori);
//   * misure in pixel, niente rem;
//   * il pulsante e' una tabella con un <a> dentro: un <button> non fa niente
//     e un <a> con padding viene ignorato da Outlook.
//
// Il tema scuro
// -------------
// Le email nascono chiare e portano una variante scura in `prefers-color-scheme`,
// dentro un <style> nell'intestazione. Il supporto e' disomogeneo per natura:
// Apple Mail la rispetta, Gmail e Outlook a volte impongono la loro. Per questo
// la versione chiara e' quella "vera" - se la media query non arriva a
// destinazione il messaggio resta perfettamente leggibile - e la scura e' un
// miglioramento per chi la riceve. `color-scheme` e `supported-color-schemes`
// servono a dire ai client di non invertire i colori per conto loro.
// ===========================================================================

import { absoluteUrl, brand } from "./brand.ts";

export interface EmailBlocks {
  /** Oggetto del messaggio. */
  subject: string;
  /** Titolo grande in cima al corpo. */
  heading: string;
  /** Nome di battesimo, per il saluto. Vuoto: si saluta senza nome. */
  firstName?: string;
  /** Paragrafi prima del pulsante. */
  paragraphs: string[];
  /** Il pulsante, se c'e' qualcosa da aprire. */
  action?: { label: string; url: string };
  /** Righe piccole sotto il pulsante: scadenze, avvertenze. */
  notes?: string[];
  /** Indirizzo pubblico dell'applicazione, per il logo. */
  origin: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// ---------------------------------------------------------------------------
export function renderEmail(blocks: EmailBlocks): RenderedEmail {
  const { light, dark } = brand.colors;
  const saluto = blocks.firstName?.trim()
    ? `Ciao ${blocks.firstName.trim()},`
    : "Ciao,";

  // -------------------------------------------------------------------------
  // Versione testuale
  // -------------------------------------------------------------------------
  // Non e' un adempimento: e' quello che leggono i lettori di schermo, i client
  // in modalita' solo testo, e i filtri antispam quando decidono se il
  // messaggio e' legittimo. Un'email con solo HTML parte gia' svantaggiata.
  const text = [
    saluto,
    "",
    ...blocks.paragraphs,
    ...(blocks.action ? ["", `${blocks.action.label}:`, blocks.action.url] : []),
    ...(blocks.notes?.length ? ["", ...blocks.notes] : []),
    "",
    "—",
    brand.name,
    brand.email.footer,
  ].join("\n");

  // -------------------------------------------------------------------------
  const logo = absoluteUrl(blocks.origin, brand.logo.png);
  const logo2x = absoluteUrl(blocks.origin, brand.logo.png2x);
  const w = brand.email.logoWidth;

  const paragrafi = blocks.paragraphs
    .map((p) =>
      `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${light.text}" class="testo">${
        escape(p)
      }</p>`
    )
    .join("\n      ");

  const pulsante = blocks.action
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0">
        <tr>
          <td align="center" bgcolor="${light.primary}" style="border-radius:8px" class="cta">
            <a href="${escape(blocks.action.url)}"
               style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:${brand.colors.white};text-decoration:none;border-radius:8px"
               class="cta-link">${escape(blocks.action.label)}</a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:${light.textMuted}" class="fioco">
        Se il pulsante non funziona, copia questo indirizzo nel browser:<br>
        <span style="word-break:break-all;color:${light.primary}" class="link">${
      escape(blocks.action.url)
    }</span>
      </p>`
    : "";

  const note = blocks.notes?.length
    ? blocks.notes
      .map((n) =>
        `<p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:${light.textMuted}" class="fioco">${
          escape(n)
        }</p>`
      )
      .join("\n      ")
    : "";

  const html = `<!doctype html>
<html lang="it" style="color-scheme:light dark;supported-color-schemes:light dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escape(blocks.subject)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .sfondo    { background:${dark.background} !important; }
    .foglio    { background:${dark.surface} !important; border-color:${dark.divider} !important; }
    .testo     { color:${dark.text} !important; }
    .titolo    { color:${dark.text} !important; }
    .fioco     { color:${dark.textMuted} !important; }
    .link      { color:${dark.primary} !important; }
    .riga      { border-color:${dark.divider} !important; }
    .cta       { background:${dark.primary} !important; }
    .cta-link  { color:${dark.background} !important; }
  }
  @media (max-width:600px) {
    .foglio { padding:24px 20px !important; }
  }
</style>
</head>
<body class="sfondo" style="margin:0;padding:0;background:${light.background}">
  <!-- Testo di anteprima: e' la riga che l'elenco dei messaggi mostra accanto
       all'oggetto. Senza, i client pescano la prima cosa che trovano - di
       solito "Se il pulsante non funziona". -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${
    escape(blocks.paragraphs[0] ?? blocks.heading)
  }</div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="sfondo" style="background:${light.background};padding:24px 12px">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px">

          <tr>
            <td align="center" style="padding:0 0 20px">
              <img src="${logo}" srcset="${logo} 1x, ${logo2x} 2x"
                   width="${w}" height="${w}" alt="${escape(brand.logo.alt)}"
                   style="display:block;width:${w}px;height:${w}px;border:0;outline:none">
              <div style="margin-top:10px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;letter-spacing:-0.2px;color:${light.primary}" class="link">${
    escape(brand.name)
  }</div>
            </td>
          </tr>

          <tr>
            <td class="foglio" style="background:${light.surface};border:1px solid ${light.divider};border-radius:14px;padding:32px 30px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
              <h1 style="margin:0 0 18px;font-size:20px;line-height:1.3;font-weight:700;color:${light.text}" class="titolo">${
    escape(blocks.heading)
  }</h1>
              <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${light.text}" class="testo">${
    escape(saluto)
  }</p>
      ${paragrafi}
      ${pulsante}
      ${note}
            </td>
          </tr>

          <tr>
            <td style="padding:20px 8px 0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
              <p style="margin:0;font-size:12px;line-height:1.55;color:${light.textMuted}" class="fioco">${
    escape(brand.email.footer)
  }</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject: blocks.subject, text, html };
}

// ---------------------------------------------------------------------------
// I messaggi
// ---------------------------------------------------------------------------
// Da qui in giu' non c'e' piu' una riga di HTML: solo il testo, che e' l'unica
// parte che si ha voglia di rileggere quando si vuole cambiare cosa dice
// l'email.

/** Benvenuto: il link porta a scegliere la password, mai la password stessa. */
export function inviteEmail(
  fullName: string,
  link: string,
  origin: string,
): RenderedEmail {
  return renderEmail({
    origin,
    subject: `${brand.name} - il tuo accesso e' pronto`,
    heading: "Il tuo accesso e' pronto",
    firstName: fullName.split(" ")[0] ?? "",
    paragraphs: [
      `Il reparto HR ha creato il tuo accesso a ${brand.name}, dove trovi il calendario delle presenze, le richieste al tuo responsabile e le schede di valutazione.`,
      "Per entrare la prima volta devi scegliere una password.",
    ],
    action: { label: "Scegli la password", url: link },
    notes: [
      "Il collegamento vale una volta sola e scade dopo un'ora.",
      "Se e' gia' scaduto, usa «Ho dimenticato la password» nella pagina di accesso: ne riceverai uno nuovo.",
    ],
  });
}

/** Recupero password. */
export function passwordResetEmail(
  fullName: string,
  link: string,
  origin: string,
): RenderedEmail {
  return renderEmail({
    origin,
    subject: `${brand.name} - reimposta la tua password`,
    heading: "Reimposta la password",
    firstName: fullName.split(" ")[0] ?? "",
    paragraphs: [
      `Hai chiesto di reimpostare la password di ${brand.name}.`,
    ],
    action: { label: "Reimposta la password", url: link },
    notes: [
      "Il collegamento vale una volta sola e scade dopo un'ora.",
      "Se non hai chiesto tu il cambio puoi ignorare questo messaggio: la password attuale resta valida e nessuno ha avuto accesso al tuo profilo.",
    ],
  });
}
