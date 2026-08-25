"use client";

// ---------------------------------------------------------------------------
// Il marchio, dal lato applicazione
// ---------------------------------------------------------------------------
// Legge la stessa `brand.json` che leggono le Edge Function. Il file vive sotto
// supabase/functions/_shared/ per una ragione pratica: il bundle di Deno puo'
// importare solo file di quella cartella, mentre Next puo' importare da
// qualunque punto del progetto. E' quindi l'unico posto da cui lo vedono
// entrambi, e un colore cambiato li' cambia insieme il tema dell'interfaccia e
// l'intestazione delle email.
// ---------------------------------------------------------------------------

import brandData from "@/supabase/functions/_shared/brand.json";

export const brand = brandData;

/** Tinte del marchio, quelle "pure" del company profile. */
export const BRAND_COLORS = brand.colors;

/** Nome e sottotitolo, usati in intestazioni e schede. */
export const APP_NAME = brand.name;
export const APP_TAGLINE = brand.tagline;

/** Gradiente della pagina di accesso. */
export const BRAND_GRADIENT = brand.gradient;

export default brand;
