// ===========================================================================
// Il marchio, dal lato Deno
// ===========================================================================
// Legge brand.json e lo espone tipizzato. Il file JSON e' la fonte: qui non si
// aggiunge nessun valore, si aggiunge solo il tipo e qualche funzione di
// comodo.
// ===========================================================================

import brandData from "./brand.json" with { type: "json" };

export const brand = brandData;

export type BrandScheme = "light" | "dark";

/** Trasforma un percorso interno in indirizzo assoluto, per le email. */
export function absoluteUrl(origin: string, path: string): string {
  if (!origin) return "";
  return `${origin.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
