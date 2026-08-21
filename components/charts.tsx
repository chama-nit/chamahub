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
//   * una sola tinta (blu) per le serie: il colore codifica la grandezza, non
//     l'identita', quindi non serve una palette categorica;
//   * i colori di stato (verde/giallo/rosso) compaiono solo nei badge e sono
//     sempre accompagnati da un'etichetta testuale, mai da soli;
//   * il testo non indossa mai il colore del dato.
// ---------------------------------------------------------------------------

import { useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

export const SERIES_COLOR = "#2a78d6";
export const SERIES_SOFT = "rgba(42, 120, 214, 0.10)";
const GRID_COLOR = "#e3e3e0";
const SURFACE = "#ffffff";

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
  const rowHeight = 38;

  if (data.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Nessun dato da rappresentare.
      </Typography>
    );
  }

  return (
    <Box sx={{ width: "100%", overflowX: "auto" }}>
      <Box sx={{ minWidth: 420 }}>
        {data.map((datum) => {
          const ratio = datum.value === null
            ? 0
            : Math.max(0, Math.min(datum.value / max, 1));

          return (
            <Stack
              key={datum.key}
              direction="row"
              spacing={1.5}
              sx={{ alignItems: "center", height: rowHeight }}
            >
              <Box sx={{ width: labelWidth, flexShrink: 0, minWidth: 0 }}>
                <Typography variant="body2" noWrap title={datum.label}>
                  {datum.label}
                </Typography>
                {datum.caption && (
                  <Typography variant="caption" color="text.secondary" noWrap>
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
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Linea di andamento
// ---------------------------------------------------------------------------
export interface TrendPoint {
  label: string;
  value: number | null;
  hint?: string;
}

export function TrendLine({
  points,
  height = 220,
  unit = "%",
  max = 100,
}: {
  points: TrendPoint[];
  height?: number;
  unit?: string;
  max?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const width = 720;
  const padding = { top: 16, right: 20, bottom: 28, left: 38 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const valued = points.filter((point) => point.value !== null);

  if (valued.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Non ci sono ancora abbastanza dati per tracciare un andamento.
      </Typography>
    );
  }

  const x = (index: number) =>
    padding.left +
    (points.length === 1
      ? plotWidth / 2
      : (index / (points.length - 1)) * plotWidth);

  const y = (value: number) =>
    padding.top + plotHeight - (Math.max(0, Math.min(value, max)) / max) * plotHeight;

  // Segmenti continui: un mese senza dati interrompe la linea invece di
  // suggerire una interpolazione che non esiste.
  const segments: { index: number; value: number }[][] = [];
  let current: { index: number; value: number }[] = [];
  points.forEach((point, index) => {
    if (point.value === null) {
      if (current.length > 0) segments.push(current);
      current = [];
    } else {
      current.push({ index, value: point.value });
    }
  });
  if (current.length > 0) segments.push(current);

  const ticks = [0, 25, 50, 75, 100].filter((tick) => tick <= max);
  const hovered = hover !== null ? points[hover] : null;

  return (
    <Box sx={{ position: "relative", width: "100%" }}>
      <Box
        component="svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Andamento del gradimento nel tempo"
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
              fill="#5a6672"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {tick}
            </text>
          </g>
        ))}

        {/* Velatura sotto la linea */}
        {segments.map((segment, index) => {
          if (segment.length < 2) return null;
          const path = segment
            .map((point, i) =>
              `${i === 0 ? "M" : "L"} ${x(point.index)} ${y(point.value)}`
            )
            .join(" ");
          const area = `${path} L ${x(segment[segment.length - 1].index)} ${
            padding.top + plotHeight
          } L ${x(segment[0].index)} ${padding.top + plotHeight} Z`;

          return (
            <path key={`area-${index}`} d={area} fill={SERIES_COLOR} opacity={0.1} />
          );
        })}

        {/* Linea */}
        {segments.map((segment, index) => (
          <path
            key={`line-${index}`}
            d={segment
              .map((point, i) =>
                `${i === 0 ? "M" : "L"} ${x(point.index)} ${y(point.value)}`
              )
              .join(" ")}
            fill="none"
            stroke={SERIES_COLOR}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* Crosshair */}
        {hovered && hovered.value !== null && (
          <line
            x1={x(hover!)}
            x2={x(hover!)}
            y1={padding.top}
            y2={padding.top + plotHeight}
            stroke={SERIES_COLOR}
            strokeWidth={1}
            opacity={0.4}
          />
        )}

        {/* Punti: anello nel colore della superficie per restare leggibili */}
        {points.map((point, index) =>
          point.value === null ? null : (
            <circle
              key={point.label}
              cx={x(index)}
              cy={y(point.value)}
              r={hover === index ? 6 : 4.5}
              fill={SERIES_COLOR}
              stroke={SURFACE}
              strokeWidth={2}
            />
          )
        )}

        {/* Etichette dei mesi: solo alcune, per non affollare l'asse */}
        {points.map((point, index) => {
          const step = Math.ceil(points.length / 6);
          if (index % step !== 0 && index !== points.length - 1) return null;
          return (
            <text
              key={`label-${point.label}`}
              x={x(index)}
              y={height - 8}
              textAnchor="middle"
              fontSize={11}
              fill="#5a6672"
            >
              {point.label}
            </text>
          );
        })}

        {/* Aree di aggancio del puntatore, piu' larghe dei punti */}
        {points.map((point, index) => (
          <rect
            key={`hit-${point.label}`}
            x={x(index) - plotWidth / Math.max(points.length, 1) / 2}
            y={padding.top}
            width={plotWidth / Math.max(points.length, 1)}
            height={plotHeight}
            fill="transparent"
            onMouseEnter={() => setHover(index)}
          />
        ))}
      </Box>

      {hovered && (
        <Box
          sx={{
            position: "absolute",
            top: 8,
            right: 8,
            px: 1.5,
            py: 1,
            bgcolor: "background.paper",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 2,
            boxShadow: 2,
            pointerEvents: "none",
          }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {hovered.label}
          </Typography>
          <Typography sx={{ fontWeight: 700 }}>
            {hovered.value === null ? "Dato non disponibile" : `${hovered.value.toFixed(0)}${unit}`}
          </Typography>
          {hovered.hint && (
            <Typography variant="caption" color="text.secondary">
              {hovered.hint}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
