"use client";

// ---------------------------------------------------------------------------
// Tutte le valutazioni (solo HR)
// ---------------------------------------------------------------------------
// Vista d'insieme su cio' che e' stato compilato in azienda: valutazioni dei
// responsabili e autovalutazioni, raggruppate per area oppure per persona.
//
// L'HR e' l'unico ruolo che vede le schede altrui anche prima della consegna
// (lo stabilisce la policy `evaluations_select_hr`), quindi questa pagina serve
// soprattutto a capire a che punto sono i cicli di valutazione.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AssignmentIcon from "@mui/icons-material/Assignment";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SearchIcon from "@mui/icons-material/Search";

import PageHeader from "@/components/PageHeader";
import { AsyncBlock, AutoGrid, EmptyState, StatCard } from "@/components/ui";
import { useAsync } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase/client";
import {
  EVALUATION_KIND_LABELS,
  EVALUATION_STATUS_COLORS,
  EVALUATION_STATUS_LABELS,
} from "@/lib/labels";
import { formatDateTime, formatScore } from "@/lib/format";
import type {
  Area,
  Evaluation,
  EvaluationCampaign,
  EvaluationKind,
  EvaluationStatus,
} from "@/lib/types/models";

const SELECT = `
  *,
  subject:profiles!evaluations_subject_id_fkey (id, full_name, job_title),
  evaluator:profiles!evaluations_evaluator_id_fkey (id, full_name),
  corrector:profiles!evaluations_corrected_by_fkey (id, full_name),
  areas:area_id (id, name, color),
  evaluation_campaigns:campaign_id (id, name, ends_on, status)
`;

interface Loaded {
  evaluations: Evaluation[];
  campaigns: EvaluationCampaign[];
  areas: Area[];
}

type GroupBy = "area" | "person";

export default function HrEvaluationsPage() {
  const router = useRouter();

  const [groupBy, setGroupBy] = useState<GroupBy>("area");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState<EvaluationKind | "all">("all");
  const [statusFilter, setStatusFilter] = useState<EvaluationStatus | "all">("all");
  const [search, setSearch] = useState("");

  const { data, loading, error } = useAsync<Loaded>(async () => {
    const supabase = getSupabase();

    const [evaluations, campaigns, areas] = await Promise.all([
      supabase
        .from("evaluations")
        .select(SELECT)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
      supabase
        .from("evaluation_campaigns")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
      supabase.from("areas").select("*").order("name").order("id"),
    ]);

    for (const result of [evaluations, campaigns, areas]) {
      if (result.error) throw new Error(result.error.message);
    }

    return {
      evaluations: (evaluations.data ?? []) as Evaluation[],
      campaigns: (campaigns.data ?? []) as EvaluationCampaign[],
      areas: (areas.data ?? []) as Area[],
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.evaluations ?? []).filter((e) => {
      if (campaignFilter !== "all" && e.campaign_id !== campaignFilter) return false;
      if (kindFilter !== "all" && e.kind !== kindFilter) return false;
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (needle) {
        const haystack = `${e.subject?.full_name ?? ""} ${
          e.evaluator?.full_name ?? ""
        } ${e.areas?.name ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [data, campaignFilter, kindFilter, statusFilter, search]);

  const totals = useMemo(() => {
    const submitted = filtered.filter((e) => e.status === "submitted");
    const scores = submitted
      .map((e) => e.overall_score)
      .filter((v): v is number => v !== null);
    return {
      total: filtered.length,
      submitted: submitted.length,
      corrected: filtered.filter((e) => e.corrected_by).length,
      average: scores.length
        ? scores.reduce((sum, v) => sum + v, 0) / scores.length
        : null,
    };
  }, [filtered]);

  // Raggruppamento: la chiave cambia, la struttura no.
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; caption?: string; rows: Evaluation[] }>();

    for (const e of filtered) {
      const key = groupBy === "area"
        ? e.area_id ?? "senza-area"
        : e.subject_id;
      const label = groupBy === "area"
        ? e.areas?.name ?? "Senza area"
        : e.subject?.full_name ?? "—";
      const caption = groupBy === "person" ? e.areas?.name : undefined;

      const bucket = map.get(key) ?? { label, caption, rows: [] };
      bucket.rows.push(e);
      map.set(key, bucket);
    }

    return [...map.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => a.label.localeCompare(b.label, "it"));
  }, [filtered, groupBy]);

  return (
    <>
      <PageHeader
        title="Tutte le valutazioni"
        description="Valutazioni dei responsabili e autovalutazioni di tutta l'azienda, raggruppate per area o per persona."
      />

      <Stack spacing={3}>
        <AutoGrid min={220}>
          <StatCard label="Schede totali" value={totals.total} />
          <StatCard
            label="Consegnate"
            value={totals.submitted}
            hint={totals.total > 0
              ? `${Math.round((totals.submitted / totals.total) * 100)}% del totale`
              : undefined}
            color="success.main"
          />
          <StatCard
            label="Punteggio medio"
            value={totals.average === null
              ? "—"
              : `${formatScore(totals.average)} / 100`}
            hint="Solo schede consegnate"
            color="secondary.main"
          />
          <StatCard
            label="Corrette dal responsabile"
            value={totals.corrected}
            hint="Autovalutazioni modificate"
            color="warning.main"
          />
        </AutoGrid>

        <Card>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2}
            sx={{ p: 2.5, alignItems: { md: "center" }, flexWrap: "wrap" }}
          >
            <TextField
              placeholder="Cerca per persona o area"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              sx={{ flex: 1, minWidth: 200 }}
              slotProps={{
                input: {
                  startAdornment: (
                    <SearchIcon sx={{ mr: 1, color: "text.disabled" }} />
                  ),
                },
              }}
            />

            <FormControl sx={{ minWidth: 190 }}>
              <InputLabel id="group-by">Raggruppa per</InputLabel>
              <Select
                labelId="group-by"
                label="Raggruppa per"
                value={groupBy}
                onChange={(event) => setGroupBy(event.target.value as GroupBy)}
              >
                <MenuItem value="area">Area</MenuItem>
                <MenuItem value="person">Dipendente</MenuItem>
              </Select>
            </FormControl>

            <FormControl sx={{ minWidth: 200 }}>
              <InputLabel id="campaign-filter">Campagna</InputLabel>
              <Select
                labelId="campaign-filter"
                label="Campagna"
                value={campaignFilter}
                onChange={(event) => setCampaignFilter(event.target.value)}
              >
                <MenuItem value="all">Tutte</MenuItem>
                {data?.campaigns.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl sx={{ minWidth: 190 }}>
              <InputLabel id="kind-filter">Tipo</InputLabel>
              <Select
                labelId="kind-filter"
                label="Tipo"
                value={kindFilter}
                onChange={(event) =>
                  setKindFilter(event.target.value as EvaluationKind | "all")}
              >
                <MenuItem value="all">Tutti</MenuItem>
                <MenuItem value="manager_review">
                  {EVALUATION_KIND_LABELS.manager_review}
                </MenuItem>
                <MenuItem value="self_assessment">
                  {EVALUATION_KIND_LABELS.self_assessment}
                </MenuItem>
              </Select>
            </FormControl>

            <FormControl sx={{ minWidth: 170 }}>
              <InputLabel id="status-filter">Stato</InputLabel>
              <Select
                labelId="status-filter"
                label="Stato"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as EvaluationStatus | "all")}
              >
                <MenuItem value="all">Tutti</MenuItem>
                {(Object.keys(EVALUATION_STATUS_LABELS) as EvaluationStatus[]).map(
                  (s) => (
                    <MenuItem key={s} value={s}>
                      {EVALUATION_STATUS_LABELS[s]}
                    </MenuItem>
                  ),
                )}
              </Select>
            </FormControl>
          </Stack>
        </Card>

        <AsyncBlock loading={loading} error={error}>
          {groups.length === 0
            ? (
              <Card>
                <CardContent>
                  <EmptyState
                    icon={<AssignmentIcon sx={{ fontSize: 48 }} />}
                    title="Nessuna valutazione"
                    description="Non ci sono schede che corrispondono ai filtri selezionati. Le schede vengono generate aprendo una campagna."
                  />
                </CardContent>
              </Card>
            )
            : (
              <Box>
                {groups.map((group) => {
                  const submitted = group.rows.filter(
                    (e) => e.status === "submitted",
                  ).length;

                  return (
                    <Accordion key={group.key} defaultExpanded={groups.length <= 3}>
                      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Stack
                          direction="row"
                          spacing={1.5}
                          sx={{ alignItems: "center", flex: 1, pr: 2 }}
                        >
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={{ fontWeight: 600 }}>
                              {group.label}
                            </Typography>
                            {group.caption && (
                              <Typography variant="caption" color="text.secondary">
                                {group.caption}
                              </Typography>
                            )}
                          </Box>
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`${group.rows.length} schede`}
                          />
                          <Chip
                            size="small"
                            color={submitted === group.rows.length
                              ? "success"
                              : "default"}
                            label={`${submitted} consegnate`}
                          />
                        </Stack>
                      </AccordionSummary>

                      <AccordionDetails sx={{ p: 0 }}>
                        <TableContainer>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>
                                  {groupBy === "area" ? "Persona valutata" : "Area"}
                                </TableCell>
                                <TableCell>Tipo</TableCell>
                                <TableCell>Compilata da</TableCell>
                                <TableCell>Campagna</TableCell>
                                <TableCell>Stato</TableCell>
                                <TableCell>Punteggio</TableCell>
                                <TableCell>Consegnata il</TableCell>
                                <TableCell />
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {group.rows.map((e) => (
                                <TableRow key={e.id} hover>
                                  <TableCell>
                                    <Typography sx={{ fontWeight: 600 }}>
                                      {groupBy === "area"
                                        ? e.subject?.full_name ?? "—"
                                        : e.areas?.name ?? "Senza area"}
                                    </Typography>
                                    {groupBy === "area" && e.subject?.job_title && (
                                      <Typography
                                        variant="caption"
                                        color="text.secondary"
                                      >
                                        {e.subject.job_title}
                                      </Typography>
                                    )}
                                  </TableCell>

                                  <TableCell>
                                    <Chip
                                      size="small"
                                      variant="outlined"
                                      color={e.kind === "self_assessment"
                                        ? "secondary"
                                        : "primary"}
                                      label={EVALUATION_KIND_LABELS[e.kind]}
                                    />
                                  </TableCell>

                                  <TableCell>
                                    {e.evaluator?.full_name ?? "—"}
                                  </TableCell>

                                  <TableCell>
                                    {e.evaluation_campaigns?.name ?? "—"}
                                  </TableCell>

                                  <TableCell>
                                    <Stack
                                      direction="row"
                                      spacing={0.75}
                                      sx={{ alignItems: "center" }}
                                    >
                                      <Chip
                                        size="small"
                                        color={EVALUATION_STATUS_COLORS[e.status]}
                                        label={EVALUATION_STATUS_LABELS[e.status]}
                                      />
                                      {e.corrected_by && (
                                        <Tooltip
                                          title={`Corretta da ${
                                            e.corrector?.full_name ?? "responsabile"
                                          }${
                                            e.corrected_at
                                              ? ` il ${formatDateTime(e.corrected_at)}`
                                              : ""
                                          }`}
                                        >
                                          <Chip
                                            size="small"
                                            variant="outlined"
                                            color="warning"
                                            label="Corretta"
                                          />
                                        </Tooltip>
                                      )}
                                    </Stack>
                                  </TableCell>

                                  <TableCell sx={{ minWidth: 120 }}>
                                    {e.overall_score === null
                                      ? <Typography color="text.disabled">—</Typography>
                                      : (
                                        <Stack spacing={0.5}>
                                          <Typography sx={{ fontWeight: 700 }}>
                                            {formatScore(e.overall_score)}
                                          </Typography>
                                          <LinearProgress
                                            variant="determinate"
                                            value={Math.min(e.overall_score, 100)}
                                            sx={{ height: 4, borderRadius: 3 }}
                                          />
                                        </Stack>
                                      )}
                                  </TableCell>

                                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                                    {e.submitted_at
                                      ? formatDateTime(e.submitted_at)
                                      : "—"}
                                  </TableCell>

                                  <TableCell align="right">
                                    <Button
                                      size="small"
                                      onClick={() =>
                                        router.push(`/valutazioni/${e.id}`)}
                                    >
                                      Apri
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      </AccordionDetails>
                    </Accordion>
                  );
                })}
              </Box>
            )}
        </AsyncBlock>
      </Stack>
    </>
  );
}
