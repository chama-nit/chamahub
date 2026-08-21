"use client";

// ---------------------------------------------------------------------------
// Dettaglio di un modello di scheda: anagrafica e costruttore di domande.
// ---------------------------------------------------------------------------

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import SaveIcon from "@mui/icons-material/Save";

import PageHeader from "@/components/PageHeader";
import QuestionBuilder from "@/components/QuestionBuilder";
import { AsyncBlock, SectionCard } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { useAsync } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase/client";
import type {
  EvaluationTemplate,
  Question,
  TemplateTarget,
} from "@/lib/types/models";

interface Loaded {
  template: EvaluationTemplate;
  questions: Question[];
  usedInCampaigns: number;
}

export default function TemplateDetailPage(props: PageProps<"/hr/modelli/[id]">) {
  const { id } = use(props.params);
  const router = useRouter();
  const toast = useToast();

  // I campi del modulo partono dai dati caricati e passano allo stato locale
  // solo quando l'utente li tocca: nessun effetto di sincronizzazione, nessun
  // render a cascata, e dopo un salvataggio basta azzerare le modifiche.
  const [edits, setEdits] = useState<Partial<{
    name: string;
    description: string;
    target: TemplateTarget;
    isActive: boolean;
  }>>({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, loading, error, reload } = useAsync<Loaded>(async () => {
    const supabase = getSupabase();

    const { data: template, error: templateError } = await supabase
      .from("evaluation_templates")
      .select("*")
      .eq("id", id)
      .single();

    if (templateError) throw new Error(templateError.message);

    const { data: questions, error: questionsError } = await supabase
      .from("evaluation_questions")
      .select("*")
      .eq("template_id", id)
      .order("position");

    if (questionsError) throw new Error(questionsError.message);

    // Un modello gia' usato non va modificato a cuor leggero: le schede
    // esistenti punterebbero a domande diverse da quelle compilate.
    const { count, error: countError } = await supabase
      .from("evaluation_campaigns")
      .select("id", { count: "exact", head: true })
      .or(`template_id.eq.${id},self_template_id.eq.${id}`);

    if (countError) throw new Error(countError.message);

    return {
      template: template as EvaluationTemplate,
      questions: (questions ?? []) as Question[],
      usedInCampaigns: count ?? 0,
    };
  }, [id]);

  const name = edits.name ?? data?.template.name ?? "";
  const description = edits.description ?? data?.template.description ?? "";
  const target = edits.target ?? data?.template.target ?? "employee";
  const isActive = edits.isActive ?? data?.template.is_active ?? true;

  async function saveMeta() {
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { error: updateError } = await supabase
        .from("evaluation_templates")
        .update({
          name: name.trim(),
          description: description.trim() || null,
          target,
          is_active: isActive,
        })
        .eq("id", id);

      if (updateError) throw new Error(updateError.message);

      toast.success("Modello aggiornato.");
      setEdits({});
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { error: deleteError } = await supabase
        .from("evaluation_templates")
        .delete()
        .eq("id", id);

      if (deleteError) throw new Error(deleteError.message);

      toast.success("Modello eliminato.");
      router.push("/hr/modelli");
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <PageHeader
        title={data?.template.name ?? "Modello"}
        description="Le domande a scala numerica determinano il punteggio della scheda; quelle a testo libero raccolgono osservazioni qualitative."
        actions={
          <>
            <Button startIcon={<ArrowBackIcon />} onClick={() => router.push("/hr/modelli")}>
              Modelli
            </Button>
            <Button
              color="error"
              startIcon={<DeleteOutlinedIcon />}
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
            >
              Elimina
            </Button>
          </>
        }
      />

      <AsyncBlock loading={loading} error={error}>
        <Stack spacing={3}>
          {(data?.usedInCampaigns ?? 0) > 0 && (
            <Alert severity="warning">
              Questo modello e&apos; gia&apos; usato in{" "}
              {data?.usedInCampaigns === 1
                ? "una campagna"
                : `${data?.usedInCampaigns} campagne`}. Modificare o eliminare le
              domande influisce sulle schede gia&apos; compilate: se ti serve una
              versione diversa, conviene duplicare il modello.
            </Alert>
          )}

          <SectionCard title="Impostazioni">
            <Stack spacing={2} sx={{ maxWidth: 620 }}>
              <TextField
                label="Nome"
                fullWidth
                value={name}
                onChange={(event) => setEdits({ ...edits, name: event.target.value })}
              />
              <TextField
                label="Descrizione"
                fullWidth
                multiline
                minRows={2}
                value={description}
                onChange={(event) => setEdits({ ...edits, description: event.target.value })}
              />
              <FormControl fullWidth>
                <InputLabel id="detail-target">Destinatario</InputLabel>
                <Select
                  labelId="detail-target"
                  label="Destinatario"
                  value={target}
                  onChange={(event) =>
                    setEdits({
                      ...edits,
                      target: event.target.value as TemplateTarget,
                    })}
                >
                  <MenuItem value="employee">Valutazione del dipendente</MenuItem>
                  <MenuItem value="self">Autovalutazione</MenuItem>
                </Select>
              </FormControl>
              <FormControlLabel
                control={
                  <Switch
                    checked={isActive}
                    onChange={(event) =>
                      setEdits({ ...edits, isActive: event.target.checked })}
                  />
                }
                label="Modello attivo (selezionabile nelle nuove campagne)"
              />
              <Box>
                <Button
                  variant="contained"
                  startIcon={<SaveIcon />}
                  onClick={saveMeta}
                  disabled={busy || !name.trim()}
                >
                  Salva
                </Button>
              </Box>
            </Stack>
          </SectionCard>

          <SectionCard title="Domande">
            <QuestionBuilder
              table="evaluation_questions"
              parentColumn="template_id"
              parentId={id}
              questions={data?.questions ?? []}
              onChanged={reload}
              disabled={busy}
            />
          </SectionCard>
        </Stack>
      </AsyncBlock>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>Eliminare il modello?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Le domande verranno eliminate insieme al modello. Se il modello e&apos;
            gia&apos; collegato a una campagna, l&apos;eliminazione verra&apos;
            rifiutata dal database: in quel caso disattivalo invece di eliminarlo.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setConfirmDelete(false)} disabled={busy}>
            Annulla
          </Button>
          <Button color="error" variant="contained" onClick={remove} disabled={busy}>
            Elimina
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
