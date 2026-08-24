"use client";

// ---------------------------------------------------------------------------
// Grafici disegnati a mano in SVG
// ---------------------------------------------------------------------------
// Nessuna libreria di charting: le forme necessarie sono due (barre orizzontali
// per confrontare grandezze fra aree, linea per l'andamento nel tempo) e
// scriverle direttamente evita 100 kB di dipendenze e mantiene il pieno
// controllo su accessibilita' e colori.
//
// Scelte cromatiche:
//   * nelle barre una sola tinta (blu): li' il colore codifica la grandezza,
//     non l'identita', quindi non serve una tavolozza categorica;
//   * nell'andamento nel tempo, invece, ogni area porta il proprio colore,
//     perche' li' il confronto e' fra soggetti diversi (vedi lib/chart-colors);
//   * i colori di stato (verde/giallo/rosso) compaiono solo nei badge e sono
//     sempre accompagnati da un'etichetta testuale, mai da soli;
//   * il testo non indossa mai il colore del dato.
// ---------------------------------------------------------------------------

import { useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useColorScheme } from "@mui/material/styles";

import { seriesColor, type ColorScheme } from "@/lib/chart-colors";

// Il blu delle barre viene dal marchio e ha due gradini, uno per tema: sono le
// variabili definite in app/globals.css, cosi' cambiano da sole insieme al
// tema senza che il componente debba accorgersene.
export const SERIES_COLOR = "var(--chart-series)";
export const SERIES_SOFT = "var(--chart-series-soft)";

// Griglia, testo degli assi e superficie arrivano invece dal tema, sotto forma
// di variabili CSS: cambiano da soli quando si passa da chiaro a scuro, senza
// che il componente debba ridisegnarsi.
const GRID_COLOR = "var(--mui-palette-divider)";
const AXIS_TEXT = "var(--mui-palette-text-secondary)";
const SURFACE = "var(--mui-palette-background-paper)";

const BAR_THICKNESS = 22; // mai piu' spesso: la banda deve conservare aria
const BAR_RADIUS = 4;

// ---------------------------------------------------------------------------
// Barre orizzontali
// ---------------------------------------------------------------------------
export interface BarDatum {
  key: string;
  label: string;
  value: number | null;
  /** Testo mostrato al posto del valore quando il dato non e' disponibile. */
  emptyLabel?: string;
  caption?: string;
}

export function HorizontalBars({
  data,
  max = 100,
  unit = "%",
  labelWidth = 160,
}: {
  data: BarDatum[];
  max?: number;
  unit?: string;
  labelWidth?: number;
}) {

  if (data.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Nessun dato da rappresentare.
      </Typography>
    );
  }

  return (
    <Box sx={{ width: "100%", overflowX: "auto" }}>
      {/* Le righe respirano: fra una barra e l'altra c'e' aria a sufficienza
          perche' l'etichetta di una riga non venga letta come didascalia di
          quella sopra. Con le barre incollate, "9 risposte" sembrava riferirsi
          alla riga sbagliata. */}
      <Stack spacing={2.5} sx={{ minWidth: 420, py: 0.5 }}>
        {data.map((datum) => {
          const ratio = datum.value === null
            ? 0
            : Math.max(0, Math.min(datum.value / max, 1));

          return (
            <Stack
              key={datum.key}
              direction="row"
              spacing={2}
              sx={{ alignItems: "center", minHeight: 40 }}
            >
              <Box sx={{ width: labelWidth, flexShrink: 0, minWidth: 0 }}>
                <Typography
                  variant="body2"
                  noWrap
                  title={datum.label}
                  sx={{ lineHeight: 1.35 }}
                >
                  {datum.label}
                </Typography>
                {datum.caption && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    sx={{ display: "block", lineHeight: 1.35 }}
                  >
                    {datum.caption}
                  </Typography>
                )}
              </Box>

              <Box sx={{ flex: 1, minWidth: 120, position: "relative" }}>
                <Box
                  sx={{
                    position: "relative",
                    height: BAR_THICKNESS,
                    bgcolor: GRID_COLOR,
                    borderRadius: `${BAR_RADIUS}px`,
                  }}
                >
                  {datum.value !== null && (
                    <Box
                      sx={{
                        position: "absolute",
                        inset: 0,
                        width: `${ratio * 100}%`,
                        bgcolor: SERIES_COLOR,
                        // Estremo del dato arrotondato, base squadrata.
                        borderRadius: `0 ${BAR_RADIUS}px ${BAR_RADIUS}px 0`,
                        transition: "width 240ms ease",
                      }}
                    />
                  )}
                </Box>
              </Box>

              <Box sx={{ width: 76, flexShrink: 0, textAlign: "right" }}>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    color: datum.value === null ? "text.disabled" : "text.primary",
                  }}
                >
                  {datum.value === null
                    ? datum.emptyLabel ?? "—"
                    : `${datum.value.toFixed(0)}${unit}`}
                </Typography>
              </Box>
            </Stack>
          );
        })}
      </Stack>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Andamento nel tempo, una linea per area
// ---------------------------------------------------------------------------
// Il confronto fra aree e' il motivo per cui questo grafico esiste: ogni area
// ha la sua linea, nel proprio colore, sugli stessi assi. Una linea sola non
// direbbe se un'area sta trascinando la media o se sta invece annegando in
// essa.
//
// Le regole rispettate qui:
//
//   * il colore segue l'area, non la sua posizione: se un filtro toglie
//     un'area, le altre non cambiano colore;
//   * l'identita' non e' mai affidata al solo colore - la legenda porta nome e
//     ultimo valore di ogni area, e sotto la dashboard c'e' sempre la vista
//     tabellare;
//   * i mesi senza dati interrompono la linea invece di far finta che il dato
//     esista;
//   * i punti si accendono solo sotto il puntatore: dodici mesi per sei aree
//     farebbero settantadue pallini fissi, cioe' rumore.
//
// La media aziendale, quando compare, e' una linea grigia tratteggiata: e' un
// riferimento, non una categoria, e si distingue anche senza guardare i colori.
// ---------------------------------------------------------------------------

export interface TrendSeries {
  key: string;
  label: string;
  /** Colore identitario dell'area, cosi' come scelto dall'HR. */
  color: string;
  /** Un valore per ogni etichetta, `null` dove il dato manca. */
  points: (number | null)[];
  /** Testo aggiuntivo per mese (di norma il numero di risposte). */
  hints?: (string | undefined)[];
  /** Linea di riferimento: tratteggiata e in grigio, fuori dal confronto. */
  reference?: boolean;
}

export function TrendLine({
  labels,
  series,
  height = 240,
  unit = "%",
  max = 100,
}: {
  labels: string[];
  series: TrendSeries[];
  height?: number;
  unit?: string;
  max?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const { colorScheme } = useColorScheme();
  // In prerendering il tema non e' ancora noto: si parte dallo scuro, che e'
  // quello predefinito dell'applicazione.
  const scheme: ColorScheme = colorScheme === "light" ? "light" : "dark";

  const width = 720;
  const padding = { top: 16, right: 20, bottom: 28, left: 38 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const drawable = series.filter((line) =>
    line.points.some((value) => value !== null)
  );

  if (labels.length === 0 || drawable.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Non ci sono ancora abbastanza dati per tracciare un andamento.
      </Typography>
    );
  }

  const resolved = drawable.map((line) => ({
    ...line,
    paint: line.reference
      ? "var(--mui-palette-text-secondary)"
      : seriesColor(line.color, scheme),
  }));

  const x = (index: number) =>
    padding.left +
    (labels.length === 1
      ? plotWidth / 2
      : (index / (labels.length - 1)) * plotWidth);

  const y = (value: number) =>
    padding.top + plotHeight - (Math.max(0, Math.min(value, max)) / max) * plotHeight;

  /** Spezza la serie dove mancano i dati: niente interpolazioni inventate. */
  const segmentsOf = (points: (number | null)[]) => {
    const segments: { index: number; value: number }[][] = [];
    let current: { index: number; value: number }[] = [];
    points.forEach((value, index) => {
      if (value === null) {
        if (current.length > 0) segments.push(current);
        current = [];
      } else {
        current.push({ index, value });
      }
    });
    if (current.length > 0) segments.push(current);
    return segments;
  };

  const ticks = [0, 25, 50, 75, 100].filter((tick) => tick <= max);
  const single = resolved.filter((line) => !line.reference).length === 1;

  return (
    <Box sx={{ width: "100%" }}>
      <Box sx={{ position: "relative", width: "100%" }}>
        <Box
          component="svg"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Andamento del gradimento nel tempo, ${resolved.length} serie`}
          sx={{ width: "100%", height: "auto", display: "block" }}
          onMouseLeave={() => setHover(null)}
        >
          {/* Griglia orizzontale, sottile e recessiva */}
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke={GRID_COLOR}
                strokeWidth={1}
              />
              <text
                x={padding.left - 8}
                y={y(tick) + 4}
                textAnchor="end"
                fontSize={11}
                fill={AXIS_TEXT}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {tick}
              </text>
            </g>
          ))}

          {/* Velatura sotto la linea: solo quando la serie e' una sola,
              altrimenti le trasparenze si sommano e sporcano il confronto. */}
          {single &&
            resolved
              .filter((line) => !line.reference)
              .flatMap((line) =>
                segmentsOf(line.points)
                  .filter((segment) => segment.length >= 2)
                  .map((segment, index) => {
                    const path = segment
                      .map((point, i) =>
                        `${i === 0 ? "M" : "L"} ${x(point.index)} ${y(point.value)}`
                      )
                      .join(" ");
                    return (
                      <path
                        key={`area-${line.key}-${index}`}
                        d={`${path} L ${x(segment[segment.length - 1].index)} ${
                          padding.top + plotHeight
                        } L ${x(segment[0].index)} ${padding.top + plotHeight} Z`}
                        fill={line.paint}
                        opacity={0.1}
                      />
                    );
                  })
              )}

          {/* Crosshair sotto le linee, cosi' non le taglia */}
          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={padding.top}
              y2={padding.top + plotHeight}
              stroke={AXIS_TEXT}
              strokeWidth={1}
              opacity={0.35}
            />
          )}

          {/* Le linee */}
          {resolved.flatMap((line) =>
            segmentsOf(line.points).map((segment, index) => (
              <path
                key={`line-${line.key}-${index}`}
                d={segment
                  .map((point, i) =>
                    `${i === 0 ? "M" : "L"} ${x(point.index)} ${y(point.value)}`
                  )
                  .join(" ")}
                fill="none"
                stroke={line.paint}
                strokeWidth={line.reference ? 1.5 : 2}
                strokeDasharray={line.reference ? "5 4" : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={line.reference ? 0.85 : 1}
              />
            ))
          )}

          {/* Punti: l'ultimo di ogni serie e i mesi isolati sempre, gli altri
              solo sotto il puntatore. Un mese isolato - preceduto e seguito da
              un buco - non ha nessuna linea da disegnare: senza il pallino
              sparirebbe del tutto, che e' il modo peggiore di rappresentare un
              dato che invece esiste. */}
          {resolved.flatMap((line) => {
            const lastIndex = line.points.reduce(
              (found, value, index) => (value !== null ? index : found),
              -1,
            );
            return line.points.map((value, index) => {
              if (value === null) return null;
              const isHovered = hover === index;
              const isolated = (line.points[index - 1] ?? null) === null &&
                (line.points[index + 1] ?? null) === null;
              if (!isHovered && !isolated && index !== lastIndex) return null;
              return (
                <circle
                  key={`dot-${line.key}-${index}`}
                  cx={x(index)}
                  cy={y(value)}
                  r={isHovered ? 5.5 : 4}
                  fill={line.paint}
                  stroke={SURFACE}
                  strokeWidth={2}
                />
              );
            });
          })}

          {/* Etichette dei mesi: solo alcune, per non affollare l'asse */}
          {labels.map((label, index) => {
            const step = Math.ceil(labels.length / 6);
            if (index % step !== 0 && index !== labels.length - 1) return null;
            return (
              <text
                key={`label-${label}-${index}`}
                x={x(index)}
                y={height - 8}
                textAnchor="middle"
                fontSize={11}
                fill={AXIS_TEXT}
              >
                {label}
              </text>
            );
          })}

          {/* Aree di aggancio del puntatore, piu' larghe dei punti */}
          {labels.map((label, index) => (
            <rect
              key={`hit-${label}-${index}`}
              x={x(index) - plotWidth / Math.max(labels.length, 1) / 2}
              y={padding.top}
              width={plotWidth / Math.max(labels.length, 1)}
              height={plotHeight}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            />
          ))}
        </Box>

        {/* Riquadro del mese: tutte le serie insieme, che e' poi il motivo per
            cui si guarda un grafico di confronto. */}
        {hover !== null && (
          <Box
            sx={{
              position: "absolute",
              top: 8,
              // Il riquadro si sposta dalla parte opposta al puntatore: nella
              // meta' destra del grafico coprirebbe proprio i punti che si
              // stanno guardando.
              ...(hover > labels.length / 2 ? { left: 8 } : { right: 8 }),
              px: 1.5,
              py: 1,
              minWidth: 170,
              bgcolor: "background.paper",
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 2,
              boxShadow: 2,
              pointerEvents: "none",
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              {labels[hover]}
            </Typography>
            <Stack spacing={0.35}>
              {resolved.map((line) => (
                <Stack
                  key={`tip-${line.key}`}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center", justifyContent: "space-between" }}
                >
                  <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", minWidth: 0 }}>
                    <Box
                      sx={{
                        width: 10,
                        height: line.reference ? 2 : 10,
                        borderRadius: line.reference ? 0 : "50%",
                        bgcolor: line.paint,
                        flexShrink: 0,
                      }}
                    />
                    <Typography variant="caption" noWrap>{line.label}</Typography>
                  </Stack>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    {line.points[hover] === null
                      ? "n.d."
                      : `${line.points[hover]!.toFixed(0)}${unit}`}
                  </Typography>
                </Stack>
              ))}
            </Stack>
            {resolved[0]?.hints?.[hover] && (
              <Typography variant="caption" color="text.secondary">
                {resolved[0].hints[hover]}
              </Typography>
            )}
          </Box>
        )}
      </Box>

      {/* Legenda: nome dell'area e ultimo valore noto, sempre presenti. Il
          testo resta in inchiostro di testo; il colore lo porta la pastiglia. */}
      <Stack
        direction="row"
        spacing={2}
        useFlexGap
        sx={{ flexWrap: "wrap", mt: 1.5, rowGap: 1 }}
      >
        {resolved.map((line) => {
          const last = [...line.points].reverse().find((value) => value !== null);
          return (
            <Stack
              key={`legend-${line.key}`}
              direction="row"
              spacing={0.75}
              sx={{ alignItems: "center" }}
            >
              <Box
                sx={{
                  width: 14,
                  height: line.reference ? 0 : 3,
                  borderRadius: 2,
                  bgcolor: line.reference ? "transparent" : line.paint,
                  borderTop: line.reference ? "2px dashed" : "none",
                  borderColor: "text.secondary",
                  flexShrink: 0,
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {line.label}
                {last !== undefined && (
                  <Box component="span" sx={{ fontWeight: 700, color: "text.primary", ml: 0.5 }}>
                    {last!.toFixed(0)}{unit}
                  </Box>
                )}
              </Typography>
            </Stack>
          );
        })}
      </Stack>
    </Box>
  );
}
