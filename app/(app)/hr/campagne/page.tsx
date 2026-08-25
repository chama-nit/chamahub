"use client";

// ---------------------------------------------------------------------------
// Campagne di valutazione (solo HR)
// ---------------------------------------------------------------------------
// Apertura, sincronizzazione e chiusura passano dalla Edge Function
// `manage-campaign`, che genera le schede secondo una regola unica:
//   * per ogni dipendente dell'area -> una scheda intestata al responsabile;
//   * per ogni persona coinvolta -> l'autovalutazione, se prevista.
//
// Finche' la campagna e' in bozza si puo' ancora cambiare tutto, o cancellarla:
// non esiste ancora nessuna scheda. Dopo l'apertura no, e non e' una scelta di
// interfaccia - un trigger sul database rifiuta modifica e cancellazione.
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import LinearProgress from "@mui/material/LinearProgress";
import ListItemText from "@mui/material/ListItemText";
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
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/Edit";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PollIcon from "@mui/icons-material/Poll";
import StopIcon from "@mui/icons-material/Stop";
import SyncIcon from "@mui/icons-material/Sync";

import PageHeader from "@/components/PageHeader";
import { AsyncBlock, AutoGrid, EmptyState, SectionCard } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAsync } from "@/lib/hooks";
import { callFunction, getSupabase } from "@/lib/supabase/client";
import { CAMPAIGN_STATUS_COLORS, CAMPAIGN_STATUS_LABELS } from "@/lib/labels";
import { formatDay, formatScore, todayString } from "@/lib/format";
import type {
  Area,
  Evaluation,
  EvaluationAreaKpi,
  EvaluationCampaign,
  EvaluationTemplate,
} from "@/lib/types/models";

interface Loaded {
  campaigns: EvaluationCampaign[];
  templates: EvaluationTemplate[];
  areas: Area[];
  evaluations: Pick<Evaluation, "id" | "campaign_id" | "status" | "kind">[];
  /** Aree associate a ciascuna campagna (nessuna riga = tutte le aree). */
  campaignAreas: { campaign_id: string; area_id: string }[];
  /** Persone attive con un'area: servono a stimare le schede di una bozza. */
  people: { id: string; role: string; area_id: string | null }[];
  /** Aree che hanno almeno un responsabile: senza, non nascono schede. */
  areasWithManager: Set<string>;
}

interface DraftState {
  /** Valorizzato quando si sta modificando una campagna gia' in bozza. */
  id?: string;
  name: string;
  description: string;
  templateId: string;
  selfTemplateId: string;
  includeSelf: boolean;
  startsOn: string;
  endsOn: string;
  areaIds: string[];
}

function defaultDraft(): DraftState {
  const today = new Date();
  const end = new Date(today);
  end.setMonth(end.getMonth() + 1);

  return {
    name: "",
    description: "",
    templateId: "",
    selfTemplateId: "",
    includeSelf: true,
    startsOn: todayString(),
    endsOn: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${
      String(end.getDate()).padStart(2, "0")
    }`,
    areaIds: [],
  };
}

export default function HrCampaignsPage() {
  const toast = useToast();
  const { profile } = useAuth();

  const [draft, setDraft] = useState<DraftState | null>(null);
  const [toDelete, setToDelete] = useState<EvaluationCampaign | null>(null);
  const [busy, setBusy] = useState(false);
  // id della campagna su cui e' in corso un'azione (null = nessuna)
  const [workingOn, setWorkingOn] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync<Loaded>(async () => {
    const supabase = getSupabase();

    const [campaigns, templates, areas, evaluations, campaignAreas, people, nomine] =
      await Promise.all([
      supabase
        .from("evaluation_campaigns")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
      supabase
        .from("evaluation_templates")
        .select("*")
        .eq("is_active", true)
        .order("name"),
      supabase.from("areas").select("*").eq("is_active", true).order("name"),
      supabase.from("evaluations").select("id, campaign_id, status, kind"),
      supabase.from("evaluation_campaign_areas").select("campaign_id, area_id"),
      supabase
        .from("profiles")
        .select("id, role, area_id")
        .eq("is_active", true),
      supabase.from("area_managers").select("area_id"),
    ]);

    for (
      const result of [
        campaigns, templates, areas, evaluations, campaignAreas, people, nomine,
      ]
    ) {
      if (result.error) throw new Error(result.error.message);
    }

    return {
      campaigns: (campaigns.data ?? []) as EvaluationCampaign[],
      templates: (templates.data ?? []) as EvaluationTemplate[],
      areas: (areas.data ?? []) as Area[],
      evaluations: (evaluations.data ?? []) as Loaded["evaluations"],
      campaignAreas: (campaignAreas.data ?? []) as Loaded["campaignAreas"],
      people: (people.data ?? []) as Loaded["people"],
      // Un'area ha un responsabile se compare qui, non se qualcuno con ruolo
      // "manager" ci appartiene: dalla migrazione 18 le due cose non
      // coincidono piu'.
      areasWithManager: new Set(
        ((nomine.data ?? []) as { area_id: string }[]).map((n) => n.area_id),
      ),
    };
  }, []);

  // Quante schede genererebbe una campagna ancora in bozza.
  // -------------------------------------------------------------------------
  // Una bozza non ha schede: mostrare "0 / 0" e' vero ma inutile, perche' non
  // dice se all'apertura uscira' qualcosa o niente. La stima ripete la stessa
  // regola della Edge Function: una scheda del responsabile per ogni
  // dipendente di un'area che abbia un responsabile, piu' l'autovalutazione di
  // ognuno se prevista.
  const estimate = useCallback(
    (campaign: EvaluationCampaign) => {
      const people = data?.people ?? [];
      const selectedAreas = (data?.campaignAreas ?? [])
        .filter((row) => row.campaign_id === campaign.id)
        .map((row) => row.area_id);

      const areaIds = selectedAreas.length > 0
        ? selectedAreas
        : (data?.areas ?? []).map((area) => area.id);

      const involved = people.filter(
        (person) => person.area_id && areaIds.includes(person.area_id),
      );

      const areasWithManager = data?.areasWithManager ?? new Set<string>();

      const reviews = involved.filter(
        (p) => p.role === "employee" && areasWithManager.has(p.area_id ?? ""),
      ).length;

      const orphans = involved.filter(
        (p) => p.role === "employee" && !areasWithManager.has(p.area_id ?? ""),
      ).length;

      const selfs = campaign.include_self_assessment ? involved.length : 0;

      return { total: reviews + selfs, reviews, selfs, orphans };
    },
    [data],
  );

  // Avanzamento per campagna, calcolato dalle schede gia' generate.
  const progress = useMemo(() => {
    const map = new Map<string, { total: number; submitted: number }>();
    for (const evaluation of data?.evaluations ?? []) {
      const current = map.get(evaluation.campaign_id) ?? { total: 0, submitted: 0 };
      current.total += 1;
      if (evaluation.status === "submitted") current.submitted += 1;
      map.set(evaluation.campaign_id, current);
    }
    return map;
  }, [data]);

  /** Crea la campagna, oppure aggiorna quella in bozza che si sta modificando. */
  async function saveCampaign() {
    if (!draft) return;
    setBusy(true);
    try {
      const supabase = getSupabase();

      const values = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        template_id: draft.templateId,
        self_template_id: draft.includeSelf ? draft.selfTemplateId || null : null,
        include_self_assessment: draft.includeSelf,
        starts_on: draft.startsOn,
        ends_on: draft.endsOn,
      };

      let campaignId = draft.id;

      if (campaignId) {
        const { error: updateError } = await supabase
          .from("evaluation_campaigns")
          .update(values)
          .eq("id", campaignId);
        if (updateError) throw new Error(updateError.message);

        // Le aree si riscrivono per intero: sono poche e ragionare per
        // differenza, qui, costerebbe piu' codice di quanto valga.
        const { error: clearError } = await supabase
          .from("evaluation_campaign_areas")
          .delete()
          .eq("campaign_id", campaignId);
        if (clearError) throw new Error(clearError.message);
      } else {
        const { data: created, error: insertError } = await supabase
          .from("evaluation_campaigns")
          .insert({ ...values, created_by: profile?.id ?? null })
          .select("id")
          .single();
        if (insertError) throw new Error(insertError.message);
        campaignId = created.id as string;
      }

      if (draft.areaIds.length > 0) {
        const { error: areasError } = await supabase
          .from("evaluation_campaign_areas")
          .insert(
            draft.areaIds.map((areaId) => ({
              campaign_id: campaignId,
              area_id: areaId,
            })),
          );
        if (areasError) throw new Error(areasError.message);
      }

      toast.success(
        draft.id
          ? `«${values.name}» aggiornata.`
          : "Campagna creata in bozza. Aprila per generare le schede.",
      );
      setDraft(null);
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  /** Carica una bozza nel modulo di modifica, aree comprese. */
  function editCampaign(campaign: EvaluationCampaign) {
    setDraft({
      id: campaign.id,
      name: campaign.name,
      description: campaign.description ?? "",
      templateId: campaign.template_id,
      selfTemplateId: campaign.self_template_id ?? "",
      includeSelf: campaign.include_self_assessment,
      startsOn: campaign.starts_on,
      endsOn: campaign.ends_on,
      areaIds: (data?.campaignAreas ?? [])
        .filter((row) => row.campaign_id === campaign.id)
        .map((row) => row.area_id),
    });
  }

  async function deleteCampaign() {
    if (!toDelete) return;
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { error: deleteError } = await supabase
        .from("evaluation_campaigns")
        .delete()
        .eq("id", toDelete.id);
      if (deleteError) throw new Error(deleteError.message);

      toast.success(`«${toDelete.name}» eliminata.`);
      setToDelete(null);
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function runAction(
    action: "open" | "sync" | "close" | "reopen",
    campaign: EvaluationCampaign,
  ) {
    setWorkingOn(campaign.id);
    try {
      const result = await callFunction<{ created: number; warnings: string[] }>(
        "manage-campaign",
        { action, campaign_id: campaign.id },
      );

      // Il nome della campagna compare sempre nella conferma: con piu'
      // campagne a schermo e' l'unico modo per non avere dubbi su quale sia
      // stata toccata.
      if (action === "close") {
        toast.success(`«${campaign.name}» chiusa.`);
      } else {
        toast.success(
          result.created > 0
            ? `«${campaign.name}»: ${result.created} schede generate.`
            : `«${campaign.name}»: nessuna nuova scheda da generare.`,
        );
      }

      for (const warning of result.warnings ?? []) {
        toast.notify(warning, "warning");
      }

      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setWorkingOn(null);
    }
  }

  const employeeTemplates = (data?.templates ?? []).filter(
    (template) => template.target === "employee",
  );
  const selfTemplates = (data?.templates ?? []).filter(
    (template) => template.target === "self",
  );

  return (
    <>
      <PageHeader
        title="Campagne di valutazione"
        description="Una campagna definisce chi valuta chi, con quale modello e in quale finestra temporale. Aprendola vengono generate automaticamente le schede."
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setDraft(defaultDraft())}
            disabled={employeeTemplates.length === 0}
          >
            Nuova campagna
          </Button>
        }
      />

      <AsyncBlock loading={loading} error={error}>
        <Stack spacing={3}>
          {employeeTemplates.length === 0 && (
            <Alert severity="warning">
              Non esiste ancora un modello di scheda attivo per i dipendenti:
              creane uno nella sezione «Modelli di scheda» prima di aprire una
              campagna.
            </Alert>
          )}

          {(data?.campaigns ?? []).length === 0
            ? (
              <Card>
                <CardContent>
                  <EmptyState
                    icon={<PollIcon sx={{ fontSize: 48 }} />}
                    title="Nessuna campagna"
                    description="Crea la prima campagna per far partire il ciclo di valutazioni."
                  />
                </CardContent>
              </Card>
            )
            : (
              <AutoGrid min={340}>
                {(data?.campaigns ?? []).map((campaign) => {
                  const stats = progress.get(campaign.id) ??
                    { total: 0, submitted: 0 };
                  const working = workingOn === campaign.id;
                  const percentage = stats.total === 0
                    ? 0
                    : (stats.submitted / stats.total) * 100;
                  const isDraft = campaign.status === "draft";
                  const forecast = isDraft ? estimate(campaign) : null;

                  return (
                    <Card
                      key={campaign.id}
                      sx={{
                        outline: working ? "2px solid" : "none",
                        outlineColor: "primary.main",
                        transition: "outline-color 150ms",
                      }}
                    >
                      <CardContent>
                        <Stack spacing={1.25}>
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ alignItems: "flex-start", justifyContent: "space-between" }}
                          >
                            <Typography variant="h3" sx={{ minWidth: 0 }}>
                              {campaign.name}
                            </Typography>
                            <Chip
                              size="small"
                              color={CAMPAIGN_STATUS_COLORS[campaign.status]}
                              label={CAMPAIGN_STATUS_LABELS[campaign.status]}
                            />
                          </Stack>

                          <Typography variant="body2" color="text.secondary">
                            Dal {formatDay(campaign.starts_on)} al{" "}
                            {formatDay(campaign.ends_on)}
                          </Typography>

                          {campaign.description && (
                            <Typography variant="body2" color="text.secondary">
                              {campaign.description}
                            </Typography>
                          )}

                          {/* In bozza non esistono schede: al loro posto si
                              mostra quante ne nascerebbero all'apertura. */}
                          {forecast
                            ? (
                              <Box sx={{ pt: 0.5 }}>
                                <Typography variant="caption" color="text.secondary">
                                  Ancora in bozza: nessuna scheda generata.
                                </Typography>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                  {forecast.total === 0
                                    ? "All'apertura non verrebbe generata nessuna scheda."
                                    : forecast.total === 1
                                    ? "All'apertura: 1 scheda"
                                    : `All'apertura: ${forecast.total} schede`}
                                </Typography>
                                {forecast.total > 0 && (
                                  <Typography variant="caption" color="text.secondary">
                                    {forecast.reviews} dal responsabile
                                    {forecast.selfs > 0
                                      ? `, ${forecast.selfs} di autovalutazione`
                                      : ""}
                                  </Typography>
                                )}
                                {forecast.orphans > 0 && (
                                  <Typography variant="caption" color="warning.main" sx={{ display: "block" }}>
                                    {forecast.orphans === 1
                                      ? "1 persona e' in un'area senza responsabile"
                                      : `${forecast.orphans} persone sono in aree senza responsabile`}: per loro non nascera&apos; nessuna scheda.
                                  </Typography>
                                )}
                                {forecast.total === 0 && (
                                  <Typography variant="caption" color="warning.main" sx={{ display: "block" }}>
                                    Le aree scelte non hanno dipendenti da
                                    valutare e l&apos;autovalutazione e&apos;
                                    disattivata.
                                  </Typography>
                                )}
                              </Box>
                            )
                            : (
                              <Box sx={{ pt: 0.5 }}>
                                <Stack
                                  direction="row"
                                  spacing={1}
                                  sx={{ justifyContent: "space-between", mb: 0.5 }}
                                >
                                  <Typography variant="caption" color="text.secondary">
                                    Schede consegnate
                                  </Typography>
                                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                                    {stats.submitted} / {stats.total}
                                  </Typography>
                                </Stack>
                                <LinearProgress
                                  variant="determinate"
                                  value={percentage}
                                  sx={{ height: 6, borderRadius: 3 }}
                                />
                              </Box>
                            )}

                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ pt: 1, flexWrap: "wrap", gap: 1 }}
                          >
                            {campaign.status !== "open"
                              ? (
                                <Button
                                  size="small"
                                  variant="contained"
                                  startIcon={working
                                    ? <CircularProgress size={16} color="inherit" />
                                    : <PlayArrowIcon />}
                                  onClick={() =>
                                    runAction(
                                      campaign.status === "draft" ? "open" : "reopen",
                                      campaign,
                                    )}
                                  disabled={workingOn !== null}
                                >
                                  {campaign.status === "draft" ? "Apri" : "Riapri"}
                                </Button>
                              )
                              : (
                                <>
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={working
                                      ? <CircularProgress size={16} />
                                      : <SyncIcon />}
                                    onClick={() => runAction("sync", campaign)}
                                    disabled={workingOn !== null}
                                  >
                                    Sincronizza
                                  </Button>
                                  <Button
                                    size="small"
                                    color="error"
                                    startIcon={<StopIcon />}
                                    onClick={() => runAction("close", campaign)}
                                    disabled={workingOn !== null}
                                  >
                                    Chiudi
                                  </Button>
                                </>
                              )}
                            {/* Modifica ed eliminazione solo in bozza: dopo
                                l'apertura ci sono schede compilate dietro. */}
                            {isDraft && (
                              <>
                                <Button
                                  size="small"
                                  startIcon={<EditIcon />}
                                  onClick={() => editCampaign(campaign)}
                                  disabled={workingOn !== null}
                                >
                                  Modifica
                                </Button>
                                <Button
                                  size="small"
                                  color="error"
                                  startIcon={<DeleteOutlinedIcon />}
                                  onClick={() => setToDelete(campaign)}
                                  disabled={workingOn !== null}
                                >
                                  Elimina
                                </Button>
                              </>
                            )}
                            <Button
                              size="small"
                              onClick={() =>
                                setSelected(selected === campaign.id ? null : campaign.id)}
                            >
                              {selected === campaign.id ? "Nascondi KPI" : "KPI per area"}
                            </Button>
                          </Stack>
                        </Stack>
                      </CardContent>
                    </Card>
                  );
                })}
              </AutoGrid>
            )}

          {selected && <CampaignKpi campaignId={selected} />}
        </Stack>
      </AsyncBlock>

      {/* ------------------------------------------------------------------ */}
      <Dialog
        open={draft !== null}
        onClose={() => setDraft(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{draft?.id ? "Modifica campagna" : "Nuova campagna"}</DialogTitle>
        <DialogContent dividers>
          {draft && (
            <Stack spacing={2} sx={{ pt: 0.5 }}>
              <TextField
                label="Nome"
                fullWidth
                required
                placeholder="Es. Valutazione annuale 2026"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
              <TextField
                label="Descrizione"
                fullWidth
                multiline
                minRows={2}
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })}
              />

              <FormControl fullWidth required>
                <InputLabel id="campaign-template">
                  Modello per i dipendenti
                </InputLabel>
                <Select
                  labelId="campaign-template"
                  label="Modello per i dipendenti"
                  value={draft.templateId}
                  onChange={(event) =>
                    setDraft({ ...draft, templateId: event.target.value })}
                >
                  {employeeTemplates.map((template) => (
                    <MenuItem key={template.id} value={template.id}>
                      {template.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControlLabel
                control={
                  <Checkbox
                    checked={draft.includeSelf}
                    onChange={(event) =>
                      setDraft({ ...draft, includeSelf: event.target.checked })}
                  />
                }
                label="Includi l'autovalutazione (di tutte le persone coinvolte)"
              />

              {draft.includeSelf && (
                <FormControl fullWidth>
                  <InputLabel id="campaign-self-template">
                    Modello di autovalutazione
                  </InputLabel>
                  <Select
                    labelId="campaign-self-template"
                    label="Modello di autovalutazione"
                    value={draft.selfTemplateId}
                    onChange={(event) =>
                      setDraft({ ...draft, selfTemplateId: event.target.value })}
                  >
                    {selfTemplates.map((template) => (
                      <MenuItem key={template.id} value={template.id}>
                        {template.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              {draft.includeSelf && selfTemplates.length === 0 && (
                <Alert severity="warning">
                  Non esistono modelli di autovalutazione attivi: creane uno
                  oppure disattiva l&apos;autovalutazione per questa campagna.
                </Alert>
              )}

              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  label="Inizio"
                  type="date"
                  fullWidth
                  value={draft.startsOn}
                  onChange={(event) =>
                    setDraft({ ...draft, startsOn: event.target.value })}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  label="Scadenza"
                  type="date"
                  fullWidth
                  value={draft.endsOn}
                  onChange={(event) =>
                    setDraft({ ...draft, endsOn: event.target.value })}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Stack>

              <FormControl fullWidth>
                <InputLabel id="campaign-areas">Aree coinvolte</InputLabel>
                <Select
                  labelId="campaign-areas"
                  label="Aree coinvolte"
                  multiple
                  value={draft.areaIds}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      areaIds: typeof event.target.value === "string"
                        ? event.target.value.split(",")
                        : event.target.value,
                    })}
                  renderValue={(selectedIds) =>
                    selectedIds.length === 0
                      ? "Tutte le aree attive"
                      : (data?.areas ?? [])
                        .filter((area) => selectedIds.includes(area.id))
                        .map((area) => area.name)
                        .join(", ")}
                >
                  {(data?.areas ?? []).map((area) => (
                    <MenuItem key={area.id} value={area.id}>
                      <Checkbox checked={draft.areaIds.includes(area.id)} />
                      <ListItemText primary={area.name} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Typography variant="body2" color="text.secondary">
                Se non selezioni nessuna area la campagna coinvolge tutte quelle
                attive.
              </Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setDraft(null)} disabled={busy}>
            Annulla
          </Button>
          <Button
            variant="contained"
            onClick={saveCampaign}
            disabled={busy || !draft?.name.trim() || !draft?.templateId ||
              (draft.includeSelf && !draft.selfTemplateId)}
          >
            {draft?.id ? "Salva le modifiche" : "Crea in bozza"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      <Dialog open={toDelete !== null} onClose={() => setToDelete(null)}>
        <DialogTitle>Eliminare la campagna?</DialogTitle>
        <DialogContent dividers>
          <Typography>
            «{toDelete?.name}» verra&apos; eliminata definitivamente.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            E&apos; ancora in bozza, quindi non esiste nessuna scheda: non si
            perde nulla di compilato. Una campagna gia&apos; aperta, invece, non
            si puo&apos; eliminare - si chiude e resta come storico.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setToDelete(null)} disabled={busy}>
            Annulla
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={deleteCampaign}
            disabled={busy}
          >
            Elimina
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
function CampaignKpi({ campaignId }: { campaignId: string }) {
  const { data, loading, error } = useAsync<EvaluationAreaKpi[]>(async () => {
    const supabase = getSupabase();
    const { data: rows, error: rpcError } = await supabase.rpc(
      "evaluation_kpi_by_area",
      { p_campaign: campaignId },
    );
    if (rpcError) throw new Error(rpcError.message);
    return (rows ?? []) as EvaluationAreaKpi[];
  }, [campaignId]);

  return (
    <SectionCard title="Avanzamento per area" dense>
      <AsyncBlock loading={loading} error={error}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Area</TableCell>
                <TableCell align="right">Schede</TableCell>
                <TableCell align="right">Consegnate</TableCell>
                <TableCell sx={{ minWidth: 160 }}>Completamento</TableCell>
                <TableCell align="right">Punteggio medio</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data ?? []).map((row) => (
                <TableRow key={row.area_id}>
                  <TableCell>{row.area_name}</TableCell>
                  <TableCell align="right">{row.total}</TableCell>
                  <TableCell align="right">{row.submitted}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <LinearProgress
                        variant="determinate"
                        value={row.completion ?? 0}
                        sx={{ flex: 1, height: 6, borderRadius: 3 }}
                      />
                      <Typography variant="caption" sx={{ minWidth: 38 }}>
                        {row.completion === null ? "—" : `${row.completion}%`}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    {row.avg_score === null
                      ? "—"
                      : `${formatScore(row.avg_score)} / 100`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </AsyncBlock>
    </SectionCard>
  );
}
