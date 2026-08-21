"use client";

// ---------------------------------------------------------------------------
// Modelli di scheda di valutazione (solo HR)
// ---------------------------------------------------------------------------
// Un modello con target "employee" viene compilato dal responsabile sul
// dipendente; uno con target "self" e' l'autovalutazione del responsabile.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DescriptionIcon from "@mui/icons-material/Description";

import PageHeader from "@/components/PageHeader";
import { AsyncBlock, AutoGrid, EmptyState } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAsync } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase/client";
import type { EvaluationTemplate, TemplateTarget } from "@/lib/types/models";

const TARGET_LABELS: Record<TemplateTarget, string> = {
  employee: "Valutazione del dipendente",
  self: "Autovalutazione",
};

export default function HrTemplatesPage() {
  const router = useRouter();
  const toast = useToast();
  const { profile } = useAuth();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState<TemplateTarget>("employee");
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useAsync<EvaluationTemplate[]>(
    async () => {
      const supabase = getSupabase();
      const { data: templates, error: queryError } = await supabase
        .from("evaluation_templates")
        .select("*, evaluation_questions (id, type)")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });

      if (queryError) throw new Error(queryError.message);
      return (templates ?? []) as EvaluationTemplate[];
    },
    [],
  );

  async function create() {
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { data: created, error: insertError } = await supabase
        .from("evaluation_templates")
        .insert({
          name: name.trim(),
          description: description.trim() || null,
          target,
          created_by: profile?.id ?? null,
        })
        .select("id")
        .single();

      if (insertError) throw new Error(insertError.message);

      setCreating(false);
      setName("");
      setDescription("");
      router.push(`/hr/modelli/${created.id}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  /** Duplica modello e domande: utile per ripartire da uno esistente. */
  async function duplicate(template: EvaluationTemplate) {
    setBusy(true);
    try {
      const supabase = getSupabase();

      const { data: created, error: insertError } = await supabase
        .from("evaluation_templates")
        .insert({
          name: `${template.name} (copia)`,
          description: template.description,
          target: template.target,
          created_by: profile?.id ?? null,
        })
        .select("id")
        .single();

      if (insertError) throw new Error(insertError.message);

      const { data: questions, error: questionsError } = await supabase
        .from("evaluation_questions")
        .select("*")
        .eq("template_id", template.id);

      if (questionsError) throw new Error(questionsError.message);

      if (questions && questions.length > 0) {
        const copies = questions.map((question) => ({
          template_id: created.id,
          position: question.position,
          label: question.label,
          help_text: question.help_text,
          type: question.type,
          scale_min: question.scale_min,
          scale_max: question.scale_max,
          weight: question.weight,
          is_required: question.is_required,
        }));

        const { error: copyError } = await supabase
          .from("evaluation_questions")
          .insert(copies);
        if (copyError) throw new Error(copyError.message);
      }

      toast.success("Modello duplicato.");
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Modelli di scheda"
        description="Definisci le domande che i responsabili troveranno nelle schede di valutazione. Un modello puo' essere riusato in piu' campagne."
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreating(true)}
          >
            Nuovo modello
          </Button>
        }
      />

      <AsyncBlock loading={loading} error={error}>
        {(data ?? []).length === 0
          ? (
            <Card>
              <CardContent>
                <EmptyState
                  icon={<DescriptionIcon sx={{ fontSize: 48 }} />}
                  title="Nessun modello"
                  description="Crea il primo modello di scheda, poi usalo per aprire una campagna di valutazione."
                />
              </CardContent>
            </Card>
          )
          : (
            <AutoGrid min={320}>
              {(data ?? []).map((template) => {
                const questions = template.evaluation_questions ?? [];
                const scale = questions.filter((q) => q.type === "scale").length;

                return (
                  <Card key={template.id} sx={{ opacity: template.is_active ? 1 : 0.6 }}>
                    <CardContent>
                      <Stack spacing={1.25}>
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: "flex-start", justifyContent: "space-between" }}
                        >
                          <Typography variant="h3" sx={{ minWidth: 0 }}>
                            {template.name}
                          </Typography>
                          <Chip
                            size="small"
                            color={template.target === "self" ? "secondary" : "primary"}
                            label={TARGET_LABELS[template.target]}
                          />
                        </Stack>

                        {template.description && (
                          <Typography variant="body2" color="text.secondary">
                            {template.description}
                          </Typography>
                        )}

                        <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", gap: 0.75 }}>
                          <Chip size="small" variant="outlined" label={`${questions.length} domande`} />
                          <Chip size="small" variant="outlined" label={`${scale} a scala`} />
                          {!template.is_active && <Chip size="small" label="Non attivo" />}
                        </Stack>

                        <Stack direction="row" spacing={1} sx={{ pt: 0.5 }}>
                          <Button
                            variant="outlined"
                            size="small"
                            onClick={() => router.push(`/hr/modelli/${template.id}`)}
                          >
                            Apri
                          </Button>
                          <Button
                            size="small"
                            startIcon={<ContentCopyIcon />}
                            onClick={() => duplicate(template)}
                            disabled={busy}
                          >
                            Duplica
                          </Button>
                        </Stack>
                      </Stack>
                    </CardContent>
                  </Card>
                );
              })}
            </AutoGrid>
          )}
      </AsyncBlock>

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Nuovo modello</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <TextField
              label="Nome"
              fullWidth
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Es. Valutazione annuale 2026"
            />
            <TextField
              label="Descrizione"
              fullWidth
              multiline
              minRows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
            <FormControl fullWidth>
              <InputLabel id="target-label">Destinatario</InputLabel>
              <Select
                labelId="target-label"
                label="Destinatario"
                value={target}
                onChange={(event) =>
                  setTarget(event.target.value as TemplateTarget)}
              >
                <MenuItem value="employee">{TARGET_LABELS.employee}</MenuItem>
                <MenuItem value="self">{TARGET_LABELS.self}</MenuItem>
              </Select>
            </FormControl>
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
            Crea e aggiungi domande
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
