"use client";

// ---------------------------------------------------------------------------
// Dashboard KPI del gradimento (solo HR)
// ---------------------------------------------------------------------------
// Tutti i dati arrivano da funzioni SQL SECURITY DEFINER che applicano da sole
// la soglia minima di risposte: se un'area non l'ha raggiunta la funzione
// restituisce il conteggio ma non la media, quindi non esiste alcun percorso
// - nemmeno manipolando le chiamate dal browser - per dedurre la risposta di
// una singola persona.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import LockIcon from "@mui/icons-material/Lock";
import TableChartIcon from "@mui/icons-material/TableChart";
import WarningIcon from "@mui/icons-material/Warning";

import PageHeader from "@/components/PageHeader";
import { HorizontalBars, TrendLine } from "@/components/charts";
import { AsyncBlock, AutoGrid, StatCard } from "@/components/ui";
import SortableGrid, { type GridBlock } from "@/components/SortableGrid";
import { useAsync } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase/client";
import { formatScore } from "@/lib/format";
import type {
  Area,
  SatisfactionAreaKpi,
  SatisfactionComment,
  SatisfactionQuestionKpi,
  SatisfactionTrendPoint,
} from "@/lib/types/models";

interface Loaded {
  areas: Area[];
  byArea: SatisfactionAreaKpi[];
  byQuestion: SatisfactionQuestionKpi[];
  trend: SatisfactionTrendPoint[];
  comments: SatisfactionComment[];
  minResponses: number;
}

const MONTH_FORMATTER = new Intl.DateTimeFormat("it-IT", { month: "short" });

/** Periodo espresso in mesi indietro rispetto al mese corrente. */
const PERIODS = [
  { value: 3, label: "Ultimi 3 mesi" },
  { value: 6, label: "Ultimi 6 mesi" },
  { value: 12, label: "Ultimi 12 mesi" },
  { value: 24, label: "Ultimi 24 mesi" },
];

function monthsAgo(months: number): string {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-01`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

/** Badge di stato: colore SEMPRE accompagnato da icona ed etichetta. */
function ScoreBadge({ value }: { value: number | null }) {
  if (value === null) {
    return <Chip size="small" variant="outlined" label="Dato non disponibile" />;
  }

  const config = value >= 70
    ? { color: "#0ca30c", label: "Positivo", Icon: CheckCircleIcon }
    : value >= 50
    ? { color: "#fab219", label: "Da monitorare", Icon: WarningIcon }
    : { color: "#d03b3b", label: "Critico", Icon: ErrorIcon };

  return (
    <Chip
      size="small"
      icon={<config.Icon sx={{ color: `${config.color} !important` }} />}
      label={config.label}
      variant="outlined"
      sx={{ borderColor: config.color }}
    />
  );
}

export default function HrKpiPage() {
  const [months, setMonths] = useState(12);
  const [areaFilter, setAreaFilter] = useState<string>("all");
  const [showTable, setShowTable] = useState(false);

  const from = monthsAgo(months);
  const to = currentMonth();

  const { data, loading, error } = useAsync<Loaded>(async () => {
    const supabase = getSupabase();
    const areaParam = areaFilter === "all" ? null : areaFilter;

    const [areas, byArea, byQuestion, trend, comments, setting] = await Promise
      .all([
        supabase.from("areas").select("*").eq("is_active", true).order("name"),
        supabase.rpc("satisfaction_kpi_by_area", { p_from: from, p_to: to }),
        supabase.rpc("satisfaction_kpi_by_question", {
          p_area: areaParam,
          p_from: from,
          p_to: to,
        }),
        supabase.rpc("satisfaction_trend", {
          p_area: areaParam,
          p_months: months,
        }),
        supabase.rpc("satisfaction_comments", {
          p_area: areaParam,
          p_from: from,
          p_to: to,
          p_limit: 60,
        }),
        supabase
          .from("app_settings")
          .select("value")
          .eq("key", "satisfaction_min_responses")
          .maybeSingle(),
      ]);

    for (const result of [areas, byArea, byQuestion, trend, comments]) {
      if (result.error) throw new Error(result.error.message);
    }

    return {
      areas: (areas.data ?? []) as Area[],
      byArea: (byArea.data ?? []) as SatisfactionAreaKpi[],
      byQuestion: (byQuestion.data ?? []) as SatisfactionQuestionKpi[],
      trend: (trend.data ?? []) as SatisfactionTrendPoint[],
      comments: (comments.data ?? []) as SatisfactionComment[],
      minResponses: Number(setting.data?.value ?? 3),
    };
  }, [from, to, months, areaFilter]);

  // -------------------------------------------------------------------------
  const totals = useMemo(() => {
    const rows = data?.byArea ?? [];
    const scored = rows.filter((row) => row.avg_percentage !== null);
    const responses = rows.reduce((sum, row) => sum + Number(row.responses), 0);

    const average = scored.length === 0
      ? null
      : scored.reduce(
        (sum, row) => sum + (row.avg_percentage ?? 0) * Number(row.responses),
        0,
      ) / scored.reduce((sum, row) => sum + Number(row.responses), 0);

    const sorted = [...scored].sort(
      (a, b) => (b.avg_percentage ?? 0) - (a.avg_percentage ?? 0),
    );

    return {
      responses,
      average,
      best: sorted[0] ?? null,
      worst: sorted[sorted.length - 1] ?? null,
      hidden: rows.filter((row) => row.below_threshold && Number(row.responses) > 0)
        .length,
    };
  }, [data]);

  const areaBars = useMemo(
    () =>
      (data?.byArea ?? []).map((row) => ({
        key: row.area_id,
        label: row.area_name,
        value: row.avg_percentage,
        caption: `${row.responses} risposte`,
        emptyLabel: "n.d.",
      })),
    [data],
  );

  // Le serie mensili arrivano per (mese, area): si aggregano pesando sul
  // numero di risposte, cosi' un'area piccola non sposta la media generale.
  const trendPoints = useMemo(() => {
    const byMonth = new Map<string, { sum: number; weight: number }>();
    for (const point of data?.trend ?? []) {
      if (point.avg_percentage === null) continue;
      const current = byMonth.get(point.period_month) ?? { sum: 0, weight: 0 };
      current.sum += point.avg_percentage * Number(point.responses);
      current.weight += Number(point.responses);
      byMonth.set(point.period_month, current);
    }

    // Serie completa: i mesi senza dati restano nulli e interrompono la linea.
    const result: { label: string; value: number | null; hint?: string }[] = [];
    const now = new Date();
    for (let index = months - 1; index >= 0; index -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
      const key = `${date.getFullYear()}-${
        String(date.getMonth() + 1).padStart(2, "0")
      }-01`;
      const entry = byMonth.get(key);
      result.push({
        label: MONTH_FORMATTER.format(date),
        value: entry ? Math.round((entry.sum / entry.weight) * 10) / 10 : null,
        hint: entry ? `${entry.weight} risposte` : undefined,
      });
    }
    return result;
  }, [data, months]);

  const questionBars = useMemo(
    () =>
      (data?.byQuestion ?? [])
        .filter((row) => Number(row.responses) > 0)
        .map((row) => ({
          key: row.question_id,
          label: row.label,
          value: row.avg_score === null
            ? null
            : ((row.avg_score - row.scale_min) / (row.scale_max - row.scale_min)) *
              100,
          caption: `${row.responses} risposte · media ${formatScore(row.avg_score)}/${row.scale_max}`,
          emptyLabel: "sotto soglia",
        })),
    [data],
  );

  // I riquadri della dashboard, in un unico posto: SortableGrid si occupa di
  // ordine, larghezza e trascinamento.
  const dashboardBlocks = useMemo<GridBlock[]>(() => {
    const blocks: GridBlock[] = [
      {
        key: "per-area",
        title: "Gradimento per area",
        subtitle: "Percentuale sul massimo ottenibile, pesata per domanda.",
        span: "half",
        children: <HorizontalBars data={areaBars} labelWidth={170} />,
      },
      {
        key: "andamento",
        title: "Andamento nel tempo",
        subtitle: areaFilter === "all"
          ? "Media aziendale mese per mese."
          : "Media dell'area selezionata mese per mese.",
        span: "half",
        children: <TrendLine points={trendPoints} />,
      },
      {
        key: "per-domanda",
        title: "Dettaglio per domanda",
        subtitle: "Dove si concentrano punti di forza e criticita'.",
        span: "full",
        children: <HorizontalBars data={questionBars} labelWidth={260} />,
      },
      {
        key: "commenti",
        title: `Commenti anonimi (${data?.comments.length ?? 0})`,
        subtitle: "In ordine casuale e solo per le aree sopra la soglia minima.",
        span: "full",
        children: (data?.comments.length ?? 0) === 0
          ? (
            <Typography variant="body2" color="text.secondary">
              Nessun commento disponibile per il periodo selezionato.
            </Typography>
          )
          : (
            <Box
              sx={{
                display: "grid",
                gap: 1.5,
                gridTemplateColumns: {
                  xs: "1fr",
                  md: "repeat(2, minmax(0, 1fr))",
                },
              }}
            >
              {(data?.comments ?? []).map((comment, index) => (
                <Paper
                  key={`${comment.period_month}-${index}`}
                  variant="outlined"
                  sx={{ p: 2 }}
                >
                  <Typography variant="caption" color="text.secondary">
                    {comment.label}
                    {comment.area_name ? ` · ${comment.area_name}` : ""}
                  </Typography>
                  <Typography sx={{ mt: 0.5, whiteSpace: "pre-wrap" }}>
                    {comment.text_value}
                  </Typography>
                </Paper>
              ))}
            </Box>
          ),
      },
    ];

    if (showTable) {
      blocks.push({
        key: "tabella",
        title: "Vista tabellare",
        subtitle: "Gli stessi dati in forma leggibile da uno screen reader.",
        span: "full",
        children: (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Area</TableCell>
                  <TableCell align="right">Risposte</TableCell>
                  <TableCell align="right">Media (1–5)</TableCell>
                  <TableCell align="right">Gradimento</TableCell>
                  <TableCell>Valutazione</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(data?.byArea ?? []).map((row) => (
                  <TableRow key={row.area_id}>
                    <TableCell>{row.area_name}</TableCell>
                    <TableCell align="right">{row.responses}</TableCell>
                    <TableCell align="right">{formatScore(row.avg_score)}</TableCell>
                    <TableCell align="right">
                      {row.avg_percentage === null
                        ? "—"
                        : `${row.avg_percentage.toFixed(0)}%`}
                    </TableCell>
                    <TableCell>
                      <ScoreBadge value={row.avg_percentage} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ),
      });
    }

    return blocks;
  }, [areaBars, trendPoints, questionBars, data, areaFilter, showTable]);

  return (
    <>
      <PageHeader
        title="Dashboard KPI"
        description="Il polso delle aree, ricostruito dalle schede di gradimento compilate in forma anonima dai dipendenti."
        actions={
          <Button
            startIcon={<TableChartIcon />}
            onClick={() => setShowTable((value) => !value)}
          >
            {showTable ? "Nascondi tabella" : "Vista tabellare"}
          </Button>
        }
      />

      <Stack spacing={3}>
        {/* Filtri, in una riga sopra i grafici */}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <FormControl sx={{ minWidth: 200 }}>
            <InputLabel id="kpi-period">Periodo</InputLabel>
            <Select
              labelId="kpi-period"
              label="Periodo"
              value={months}
              onChange={(event) => setMonths(Number(event.target.value))}
            >
              {PERIODS.map((period) => (
                <MenuItem key={period.value} value={period.value}>
                  {period.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl sx={{ minWidth: 220 }}>
            <InputLabel id="kpi-area">Area</InputLabel>
            <Select
              labelId="kpi-area"
              label="Area"
              value={areaFilter}
              onChange={(event) => setAreaFilter(event.target.value)}
            >
              <MenuItem value="all">Tutte le aree</MenuItem>
              {data?.areas.map((area) => (
                <MenuItem key={area.id} value={area.id}>
                  {area.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>

        <AsyncBlock loading={loading} error={error}>
          <Stack spacing={3}>
            <AutoGrid min={240}>
              <StatCard
                label="Gradimento medio"
                value={totals.average === null
                  ? "—"
                  : `${totals.average.toFixed(0)}%`}
                hint="Media pesata sulle risposte del periodo"
              />
              <StatCard
                label="Risposte raccolte"
                value={totals.responses}
                hint={`Soglia di riservatezza: ${data?.minResponses ?? 3} risposte`}
              />
              <StatCard
                label="Area piu' soddisfatta"
                value={totals.best?.area_name ?? "—"}
                hint={totals.best
                  ? `${totals.best.avg_percentage?.toFixed(0)}% di gradimento`
                  : "Dati insufficienti"}
                color="#0ca30c"
              />
              <StatCard
                label="Area da attenzionare"
                value={totals.worst?.area_name ?? "—"}
                hint={totals.worst
                  ? `${totals.worst.avg_percentage?.toFixed(0)}% di gradimento`
                  : "Dati insufficienti"}
                color="#d03b3b"
              />
            </AutoGrid>

            {totals.hidden > 0 && (
              <Alert severity="info" icon={<LockIcon />}>
                {totals.hidden === 1
                  ? "Un'area ha raccolto risposte ma non abbastanza da mostrare la media"
                  : `${totals.hidden} aree hanno raccolto risposte ma non abbastanza da mostrare la media`}
                : sotto la soglia di {data?.minResponses ?? 3} risposte i dati
                restano nascosti per non rendere riconoscibile chi ha risposto.
              </Alert>
            )}

            {/* I riquadri sono riorganizzabili: ogni HR guarda per primo cio'
                che gli interessa di piu'. */}
            <SortableGrid storageKey="kpi-gradimento" blocks={dashboardBlocks} />

          </Stack>
        </AsyncBlock>
      </Stack>
    </>
  );
}
