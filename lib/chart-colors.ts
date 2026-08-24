"use client";

// ---------------------------------------------------------------------------
// Colori delle serie: dall'identita' dell'area al pixel leggibile
// ---------------------------------------------------------------------------
// Ogni area ha un suo colore, scelto dall'HR e usato ovunque nell'applicazione
// (pastiglie, badge, calendario). Nei grafici quel colore deve restare
// riconoscibile: e' l'identita' dell'area, non la sua posizione in classifica.
//
// C'e' pero' un problema di leggibilita'. Il blu #1B3B8C e il viola #4A1B7A del
// profilo aziendale sono nati per la carta e per il fondo chiaro: sul nero blu
// del tema scuro spariscono. La soluzione non e' cambiare tinta - si perderebbe
// l'identita' - ma cambiare *gradino* della stessa tinta, esattamente come si
// fa con una scala di colore ben progettata.
//
// Per gli otto colori della tavolozza il gradino scuro e' scritto a mano, gia'
// verificato contro il fondo scuro. Per qualsiasi altro colore (aree create
// prima, o con un colore personalizzato) il gradino viene calcolato: si
// schiarisce o si scurisce mantenendo tinta e saturazione, finche' il contrasto
// con la superficie non arriva a 3:1, la soglia sotto la quale una linea sottile
// diventa indistinguibile dal fondo.
// ---------------------------------------------------------------------------

/** Superfici su cui vengono disegnati i grafici, dai due temi in lib/theme.ts. */
export const CHART_SURFACE = { light: "#ffffff", dark: "#141a2b" } as const;

export type ColorScheme = "light" | "dark";

/**
 * Tavolozza proposta all'HR quando sceglie il colore di un'area.
 *
 * L'ordine non e' casuale: e' una sequenza categorica verificata, in cui ogni
 * colore resta distinguibile dal precedente anche per chi ha una percezione
 * ridotta dei colori. Chi sceglie i colori scorrendo la lista dall'inizio
 * ottiene, senza saperlo, le combinazioni migliori.
 */
export const AREA_PALETTE = [
  "#3a5fc0", // blu del marchio, schiarito quel tanto che serve al grafico
  "#e8865a", // arancio del marchio
  "#8e4fd0", // viola del marchio, schiarito
  "#c9a227", // oro
  "#c238c4", // magenta del marchio
  "#2e9e8f", // verde-azzurro
  "#6b4a9e", // prugna
  "#b85c3e", // terracotta
] as const;

/** Gradino scuro corrispondente, per ciascun colore della tavolozza. */
const DARK_STEP: Record<string, string> = {
  "#3a5fc0": "#5b7fe0",
  "#e8865a": "#d9744c",
  "#8e4fd0": "#9968d6",
  "#c9a227": "#b58c2a",
  "#c238c4": "#c64fc8",
  "#2e9e8f": "#2fa795",
  "#6b4a9e": "#8a6fc0",
  "#b85c3e": "#bc6a4c",
};

// ---------------------------------------------------------------------------
// Conversioni e contrasto
// ---------------------------------------------------------------------------
function hexToRgb(hex: string): [number, number, number] | null {
  const value = hex.trim().replace("#", "");
  const full = value.length === 3
    ? value.split("").map((c) => c + c).join("")
    : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn
    ? ((gn - bn) / d + (gn < bn ? 6 : 0))
    : max === gn
    ? (bn - rn) / d + 2
    : (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Rapporto di contrasto WCAG fra due colori (1 = identici, 21 = massimo). */
export function contrastRatio(a: string, b: string): number {
  const rgbA = hexToRgb(a), rgbB = hexToRgb(b);
  if (!rgbA || !rgbB) return 21;
  const lumA = luminance(rgbA), lumB = luminance(rgbB);
  const light = Math.max(lumA, lumB), dark = Math.min(lumA, lumB);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Colore della serie per il tema richiesto: stessa tinta, gradino leggibile.
 *
 * @param color   colore dell'area, come scelto dall'HR
 * @param scheme  tema attivo
 */
export function seriesColor(color: string, scheme: ColorScheme): string {
  const normalised = color?.trim().toLowerCase() ?? "";
  const surface = CHART_SURFACE[scheme];

  // Colori della tavolozza: gradini gia' verificati, non si toccano.
  // In tema chiaro tre di essi restano sotto 3:1 di contrasto: e' una scelta
  // consapevole, ammessa perche' l'identita' non e' mai affidata al solo
  // colore - accanto a ogni linea c'e' la legenda con il nome dell'area, e la
  // dashboard porta sempre con se' la vista tabellare.
  if (DARK_STEP[normalised]) {
    return scheme === "dark" ? DARK_STEP[normalised] : normalised;
  }

  const rgb = hexToRgb(normalised);
  if (!rgb) return scheme === "dark" ? "#5b7fe0" : "#3a5fc0";

  if (contrastRatio(normalised, surface) >= 3) return normalised;

  // Si sposta la luminosita' di un passo alla volta, nella direzione che
  // allontana dal fondo, fermandosi appena il contrasto e' sufficiente.
  const [h, s, l] = rgbToHsl(rgb);
  const direction = scheme === "dark" ? 1 : -1;

  for (let step = 1; step <= 20; step += 1) {
    const nextL = Math.max(0.08, Math.min(0.92, l + direction * step * 0.04));
    const candidate = rgbToHex(hslToRgb([h, s, nextL]));
    if (contrastRatio(candidate, surface) >= 3) return candidate;
  }

  return scheme === "dark" ? "#e9ecf5" : "#0a0d16";
}
