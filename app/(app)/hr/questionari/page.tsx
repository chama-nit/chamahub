"use client";

// ---------------------------------------------------------------------------
// Questionari di gradimento (solo HR)
// ---------------------------------------------------------------------------
// A differenza delle valutazioni, il gradimento non ha campagne: i questionari
// attivi restano sempre compilabili e i risultati vengono aggregati per mese.
// Qui si definiscono le domande; i risultati stanno nella dashboard KPI.
// ---------------------------------------------------------------------------

import { useState } from "react";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import LockIcon from "@mui/icons-material/Lock";
import SaveIcon from "@mui/icons-material/Save";

import PageHeader from "@/components/PageHeader";
import QuestionBuilder from "@/components/QuestionBuilder";
import { AsyncBlock, EmptyState } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAsync } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase/client";
import type { Question, SatisfactionSurvey } from "@/lib/types/models";

export default function HrSurveysPage() {
  const toast = useToast();
  const { profile } = useAuth();

  const [expanded, setExpanded] = useState<string | false>(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [threshold, setThreshold] = useState<number | null>(null);

  const { data, loading, error, reload } = useAsync<
    { surveys: SatisfactionSurvey[]; minResponses: number }
  >(async () => {
    const supabase = getSupabase();

    const [surveysResult, settingResult] = await Promise.all([
      supabase
        .from("satisfaction_surveys")
        .select("*, satisfaction_questions (*)")
        .order("created_at")
        .order("id"),
      supabase
        .from("app_settings")
        .select("value")
        .eq("key", "satisfaction_min_responses")
        .maybeSingle(),
    ]);

    if (surveysResult.error) throw new Error(surveysResult.error.message);

    return {
      surveys: (surveysResult.data ?? []) as SatisfactionSurvey[],
      minResponses: Number(settingResult.data?.value ?? 3),
    };
  }, []);

  async function create() {
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { data: created, error: insertError } = await supabase
        .from("satisfaction_surveys")
        .insert({
          name: name.trim(),
          description: description.trim() || null,
          created_by: profile?.id ?? null,
        })
        .select("id")
        .single();

      if (insertError) throw new Error(insertError.message);

      toast.success("Questionario creato.");
      setCreating(false);
      setName("");
      setDescription("");
      setExpanded(created.id);
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(survey: SatisfactionSurvey, active: boolean) {
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { error: updateError } = await supabase
        .from("satisfaction_surveys")
        .update({ is_active: active })
        .eq("id", survey.id);

      if (updateError) throw new Error(updateError.message);
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove(survey: SatisfactionSurvey) {
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { error: deleteError } = await supabase
        .from("satisfaction_surveys")
        .delete()
        .eq("id", survey.id);

      if (deleteError) throw new Error(deleteError.message);
      toast.success("Questionario eliminato.");
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function saveThreshold() {
    if (threshold === null) return;
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { error: updateError } = await supabase
        .from("app_settings")
        .update({ value: threshold })
        .eq("key", "satisfaction_min_responses");

      if (updateError) throw new Error(updateError.message);
      toast.success("Soglia aggiornata.");
      setThreshold(null);
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const currentThreshold = threshold ?? data?.minResponses ?? 3;

  return (
    <>
      <PageHeader
        title="Questionari di gradimento"
        description="Le domande che i dipendenti trovano nella loro area personale. I questionari attivi restano sempre compilabili."
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreating(true)}
          >
            Nuovo questionario
          </Button>
        }
      />

      <Stack spacing={3}>
        <Alert severity="info" icon={<LockIcon />}>
          <AlertTitle>Anonimato assoluto</AlertTitle>
          Le risposte non contengono alcun riferimento a chi le ha inviate: non
          esiste, nemmeno nel database, un modo per collegarle a una persona.
          L&apos;unico dato conservato e&apos; l&apos;area. Di conseguenza non e&apos;
          possibile sapere chi ha risposto ne&apos; calcolare il tasso di
          partecipazione, e la stessa persona puo&apos; compilare piu&apos; volte.
        </Alert>

        <Card>
          <CardContent>
            <Typography variant="h3" sx={{ mb: 0.5 }}>
              Soglia di riservatezza
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Numero minimo di risposte perche&apos; i risultati di un&apos;area
              vengano mostrati. Serve a evitare che in un reparto molto piccolo la
              media coincida con la singola opinione.
            </Typography>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <TextField
                type="number"
                label="Risposte minime"
                value={currentThreshold}
                onChange={(event) => setThreshold(Number(event.target.value))}
                sx={{ width: 170 }}
                slotProps={{ htmlInput: { min: 1, max: 50 } }}
              />
              <Button
                variant="outlined"
                startIcon={<SaveIcon />}
                onClick={saveThreshold}
                disabled={busy || threshold === null ||
                  threshold === data?.minResponses}
              >
                Salva
              </Button>
            </Stack>
          </CardContent>
        </Card>

        <AsyncBlock loading={loading} error={error}>
          {(data?.surveys ?? []).length === 0
            ? (
              <Card>
                <CardContent>
                  <EmptyState
                    title="Nessun questionario"
                    description="Crea il primo questionario di gradimento per iniziare a raccogliere il polso delle aree."
                  />
                </CardContent>
              </Card>
            )
            : (
              <Box>
                {(data?.surveys ?? []).map((survey) => {
                  const questions = (survey.satisfaction_questions ??
                    []) as Question[];

                  return (
                    <Accordion
                      key={survey.id}
                      expanded={expanded === survey.id}
                      onChange={(_event, isExpanded) =>
                        setExpanded(isExpanded ? survey.id : false)}
                    >
                      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Stack
                          direction="row"
                          spacing={1.5}
                          sx={{ alignItems: "center", flex: 1, pr: 2 }}
                        >
                          <Typography sx={{ fontWeight: 600, flex: 1 }}>
                            {survey.name}
                          </Typography>
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`${questions.length} domande`}
                          />
                          <Chip
                            size="small"
                            color={survey.is_active ? "success" : "default"}
                            label={survey.is_active ? "Attivo" : "Non attivo"}
                          />
                        </Stack>
                      </AccordionSummary>

                      <AccordionDetails>
                        {survey.description && (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ mb: 2 }}
                          >
                            {survey.description}
                          </Typography>
                        )}

                        <Stack
                          direction="row"
                          spacing={2}
                          sx={{ mb: 2, alignItems: "center" }}
                        >
                          <FormControlLabel
                            control={
                              <Switch
                                checked={survey.is_active}
                                disabled={busy}
                                onChange={(event) =>
                                  toggleActive(survey, event.target.checked)}
                              />
                            }
                            label="Attivo e compilabile"
                          />
                          <Button
                            size="small"
                            color="error"
                            startIcon={<DeleteOutlinedIcon />}
                            onClick={() => remove(survey)}
                            disabled={busy}
                          >
                            Elimina questionario
                          </Button>
                        </Stack>

                        <QuestionBuilder
                          table="satisfaction_questions"
                          parentColumn="survey_id"
                          parentId={survey.id}
                          questions={questions}
                          onChanged={reload}
                          disabled={busy}
                        />
                      </AccordionDetails>
                    </Accordion>
                  );
                })}
              </Box>
            )}
        </AsyncBlock>
      </Stack>

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Nuovo questionario</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <TextField
              label="Nome"
              fullWidth
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <TextField
              label="Descrizione"
              fullWidth
              multiline
              minRows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              helperText="Viene mostrata ai dipendenti sopra le domande: e' il posto giusto per spiegare come verranno usate le risposte."
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setCreating(false)} disabled={busy}>
            Annulla
          </Button>
          <Button
            variant="contained"
            onClick={create}
            disabled={busy || !name.trim()}
          >
            Crea
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
