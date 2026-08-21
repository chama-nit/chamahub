"use client";

// ---------------------------------------------------------------------------
// Griglia riorganizzabile per trascinamento
// ---------------------------------------------------------------------------
// Ogni riquadro puo' essere spostato con il mouse oppure, per chi non usa il
// mouse, con i due pulsanti a freccia della barra del riquadro. La larghezza
// (mezza o intera) e' anch'essa regolabile.
//
// L'ordine viene conservato nel browser di chi lo ha scelto: e' una preferenza
// personale di visualizzazione, non un dato aziendale, quindi non ha senso
// farla viaggiare fino al database.
//
// Nota sull'idratazione: la preferenza sta in localStorage, che sul server non
// esiste. Leggerla durante il render produrrebbe una pagina diversa fra server
// e browser; per questo si passa da `useSyncExternalStore`, che permette di
// dichiarare esplicitamente il valore da usare in fase di prerendering.
// ---------------------------------------------------------------------------

import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import KeyboardArrowLeftIcon from "@mui/icons-material/KeyboardArrowLeft";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import WidthFullIcon from "@mui/icons-material/WidthFull";
import WidthNormalIcon from "@mui/icons-material/WidthNormal";

export interface GridBlock {
  key: string;
  title: string;
  subtitle?: string;
  /** Larghezza predefinita: intera riga o meta'. */
  span?: "full" | "half";
  children: ReactNode;
}

interface StoredLayout {
  order: string[];
  spans: Record<string, "full" | "half">;
}

// ---------------------------------------------------------------------------
// Piccolo archivio su localStorage con notifica ai sottoscrittori
// ---------------------------------------------------------------------------
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function readRaw(storageKey: string): string {
  try {
    return window.localStorage.getItem(storageKey) ?? "";
  } catch {
    // Modalita' privata o permessi negati: si ricade sull'ordine predefinito.
    return "";
  }
}

function writeRaw(storageKey: string, value: string) {
  try {
    if (value) window.localStorage.setItem(storageKey, value);
    else window.localStorage.removeItem(storageKey);
  } catch {
    /* preferenza non salvata: pazienza, la disposizione vale per la sessione */
  }
  listeners.forEach((notify) => notify());
}

export default function SortableGrid({
  storageKey,
  blocks,
}: {
  /** Identificativo della dashboard, usato per ricordarne la disposizione. */
  storageKey: string;
  blocks: GridBlock[];
}) {
  const fullKey = `chamahub:layout:${storageKey}`;

  const raw = useSyncExternalStore(
    subscribe,
    useCallback(() => readRaw(fullKey), [fullKey]),
    // In prerendering non c'e' localStorage: si parte dalla disposizione
    // predefinita, e il browser applica subito la preferenza salvata.
    useCallback(() => "", []),
  );

  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  // Disposizione effettiva: quanto salvato, riconciliato con i riquadri che
  // esistono davvero (cosi' aggiungere o togliere un riquadro non rompe nulla).
  const layout = useMemo<StoredLayout>(() => {
    const defaults: StoredLayout = {
      order: blocks.map((b) => b.key),
      spans: Object.fromEntries(
        blocks.map((b) => [b.key, b.span ?? "full"]),
      ) as Record<string, "full" | "half">,
    };

    if (!raw) return defaults;

    try {
      const parsed = JSON.parse(raw) as Partial<StoredLayout>;
      const known = new Set(defaults.order);
      const saved = (parsed.order ?? []).filter((k) => known.has(k));
      const missing = defaults.order.filter((k) => !saved.includes(k));
      return {
        order: [...saved, ...missing],
        spans: { ...defaults.spans, ...(parsed.spans ?? {}) },
      };
    } catch {
      return defaults;
    }
  }, [raw, blocks]);

  const byKey = useMemo(
    () => new Map(blocks.map((block) => [block.key, block])),
    [blocks],
  );

  const persist = useCallback(
    (next: StoredLayout) => writeRaw(fullKey, JSON.stringify(next)),
    [fullKey],
  );

  const move = useCallback(
    (key: string, direction: -1 | 1) => {
      const order = [...layout.order];
      const index = order.indexOf(key);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= order.length) return;
      [order[index], order[target]] = [order[target], order[index]];
      persist({ ...layout, order });
    },
    [layout, persist],
  );

  const dropOn = useCallback(
    (targetKey: string) => {
      if (!dragging || dragging === targetKey) return;
      const order = layout.order.filter((k) => k !== dragging);
      const at = order.indexOf(targetKey);
      order.splice(at < 0 ? order.length : at, 0, dragging);
      persist({ ...layout, order });
    },
    [dragging, layout, persist],
  );

  const toggleSpan = useCallback(
    (key: string) => {
      persist({
        ...layout,
        spans: {
          ...layout.spans,
          [key]: layout.spans[key] === "half" ? "full" : "half",
        },
      });
    },
    [layout, persist],
  );

  const customised = raw.length > 0;

  return (
    <Box>
      <Stack
        direction="row"
        spacing={1}
        sx={{ mb: 1.5, alignItems: "center", justifyContent: "flex-end" }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ mr: "auto" }}>
          Trascina i riquadri per riordinarli, oppure usa le frecce. La
          disposizione resta salvata su questo browser.
        </Typography>
        {customised && (
          <Button
            size="small"
            startIcon={<RestartAltIcon />}
            onClick={() => writeRaw(fullKey, "")}
          >
            Ripristina disposizione
          </Button>
        )}
      </Stack>

      <Box
        sx={{
          display: "grid",
          gap: 3,
          alignItems: "start",
          gridTemplateColumns: {
            xs: "minmax(0, 1fr)",
            lg: "repeat(2, minmax(0, 1fr))",
          },
        }}
      >
        {layout.order.map((key, index) => {
          const block = byKey.get(key);
          if (!block) return null;

          const half = layout.spans[key] === "half";
          const isDragging = dragging === key;
          const isTarget = dragOver === key && dragging !== key;

          return (
            <Card
              key={key}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(key);
              }}
              onDragLeave={() => setDragOver((v) => (v === key ? null : v))}
              onDrop={(event) => {
                event.preventDefault();
                dropOn(key);
                setDragging(null);
                setDragOver(null);
              }}
              sx={{
                gridColumn: { xs: "span 1", lg: half ? "span 1" : "span 2" },
                opacity: isDragging ? 0.45 : 1,
                outline: isTarget ? "2px dashed" : "none",
                outlineColor: "primary.main",
                outlineOffset: 2,
                transition: "opacity 120ms",
              }}
            >
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  px: 2,
                  py: 1.25,
                  alignItems: "center",
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  bgcolor: "action.hover",
                }}
              >
                <Box
                  draggable
                  onDragStart={() => setDragging(key)}
                  onDragEnd={() => {
                    setDragging(null);
                    setDragOver(null);
                  }}
                  aria-label={`Trascina ${block.title}`}
                  sx={{
                    display: "flex",
                    cursor: "grab",
                    color: "text.disabled",
                    "&:active": { cursor: "grabbing" },
                  }}
                >
                  <DragIndicatorIcon />
                </Box>

                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600 }} noWrap>
                    {block.title}
                  </Typography>
                  {block.subtitle && (
                    <Typography variant="caption" color="text.secondary">
                      {block.subtitle}
                    </Typography>
                  )}
                </Box>

                {/* Il testo del Tooltip non arriva alle tecnologie assistive:
                    serve un'etichetta esplicita su ogni pulsante. */}
                <Tooltip title={half ? "Larghezza intera" : "Mezza larghezza"}>
                  <IconButton
                    size="small"
                    aria-label={`${
                      half ? "Larghezza intera" : "Mezza larghezza"
                    }: ${block.title}`}
                    onClick={() => toggleSpan(key)}
                  >
                    {half ? <WidthFullIcon fontSize="small" /> : <WidthNormalIcon fontSize="small" />}
                  </IconButton>
                </Tooltip>
                <Tooltip title="Sposta indietro">
                  <span>
                    <IconButton
                      size="small"
                      aria-label={`Sposta indietro: ${block.title}`}
                      disabled={index === 0}
                      onClick={() => move(key, -1)}
                    >
                      <KeyboardArrowLeftIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Sposta avanti">
                  <span>
                    <IconButton
                      size="small"
                      aria-label={`Sposta avanti: ${block.title}`}
                      disabled={index === layout.order.length - 1}
                      onClick={() => move(key, 1)}
                    >
                      <KeyboardArrowRightIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>

              <Box sx={{ p: 2.5 }}>{block.children}</Box>
            </Card>
          );
        })}
      </Box>
    </Box>
  );
}
