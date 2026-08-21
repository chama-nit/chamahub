"use client";

// ---------------------------------------------------------------------------
// Costruttore di domande, condiviso fra modelli di valutazione e questionari di
// gradimento: le due tabelle hanno la stessa struttura, cambia solo il nome.
// ---------------------------------------------------------------------------
// Tipi supportati: scala numerica (con estremi e peso) e testo libero.
// Il peso influisce solo sulle domande a scala e determina quanto la risposta
// incide sul punteggio complessivo.
// ---------------------------------------------------------------------------

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/Edit";

import { EmptyState } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { getSupabase } from "@/lib/supabase/client";
import type { Question, QuestionType } from "@/lib/types/models";

interface QuestionBuilderProps {
  /** Tabella delle domande: `evaluation_questions` o `satisfaction_questions`. */
  table: "evaluation_questions" | "satisfaction_questions";
  /** Colonna che punta al contenitore: `template_id` o `survey_id`. */
  parentColumn: "template_id" | "survey_id";
  parentId: string;
  questions: Question[];
  onChanged: () => void;
  disabled?: boolean;
}

interface DraftState {
  id?: string;
  label: string;
  helpText: string;
  type: QuestionType;
  scaleMin: number;
  scaleMax: number;
  weight: number;
  isRequired: boolean;
}

const EMPTY_DRAFT: DraftState = {
  label: "",
  helpText: "",
  type: "scale",
  scaleMin: 1,
  scaleMax: 5,
  weight: 1,
  isRequired: true,
};

export default function QuestionBuilder({
  table,
  parentColumn,
  parentId,
  questions,
  onChanged,
  disabled,
}: QuestionBuilderProps) {
  const toast = useToast();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = [...questions].sort((a, b) => a.position - b.position);

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const supabase = getSupabase();
      const payload: Record<string, unknown> = {
        [parentColumn]: parentId,
        label: draft.label.trim(),
        help_text: draft.helpText.trim() || null,
        type: draft.type,
        scale_min: draft.type === "scale" ? draft.scaleMin : 1,
        scale_max: draft.type === "scale" ? draft.scaleMax : 5,
        weight: draft.weight,
        is_required: draft.isRequired,
      };

      if (draft.id) {
        const { error } = await supabase
          .from(table)
          .update(payload)
          .eq("id", draft.id);
        if (error) throw new Error(error.message);
      } else {
        payload.position = sorted.length === 0
          ? 1
          : Math.max(...sorted.map((q) => q.position)) + 1;
        const { error } = await supabase.from(table).insert(payload);
        if (error) throw new Error(error.message);
      }

      toast.success(draft.id ? "Domanda aggiornata." : "Domanda aggiunta.");
      setDraft(null);
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove(question: Question) {
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from(table).delete().eq("id", question.id);
      if (error) throw new Error(error.message);
      toast.success("Domanda eliminata.");
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Scambia due domande adiacenti. Le posizioni hanno un vincolo di unicita'
   * per contenitore, quindi si passa da un valore temporaneo negativo per non
   * violarlo a meta' operazione.
   */
  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;

    setBusy(true);
    try {
      const supabase = getSupabase();
      const a = sorted[index];
      const b = sorted[target];

      const steps = [
        supabase.from(table).update({ position: -1 }).eq("id", a.id),
        supabase.from(table).update({ position: a.position }).eq("id", b.id),
        supabase.from(table).update({ position: b.position }).eq("id", a.id),
      ];

      for (const step of steps) {
        const { error } = await step;
        if (error) throw new Error(error.message);
      }

      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const scaleCount = sorted.filter((q) => q.type === "scale").length;

  return (
    <>
      <Stack
        direction="row"
        spacing={2}
        sx={{ mb: 2, alignItems: "center", justifyContent: "space-between" }}
      >
        <Typography variant="body2" color="text.secondary">
          {sorted.length} domande · {scaleCount} a scala numerica ·{" "}
          {sorted.length - scaleCount} a testo libero
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<AddIcon />}
          onClick={() => setDraft({ ...EMPTY_DRAFT })}
          disabled={disabled || busy}
        >
          Aggiungi domanda
        </Button>
      </Stack>

      {scaleCount === 0 && sorted.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Senza domande a scala numerica non e&apos; possibile calcolare alcun
          punteggio ne&apos; alimentare i KPI.
        </Alert>
      )}

      {sorted.length === 0
        ? (
          <EmptyState
            title="Nessuna domanda"
            description="Aggiungi la prima domanda: le domande a scala alimentano il punteggio, quelle a testo libero raccolgono commenti."
          />
        )
        : (
          <Stack spacing={1.5}>
            {sorted.map((question, index) => (
              <Paper key={question.id} variant="outlined" sx={{ p: 2 }}>
                <Stack
                  direction="row"
                  spacing={2}
                  sx={{ alignItems: "flex-start", justifyContent: "space-between" }}
                >
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontWeight: 600 }}>
                      {question.position}. {question.label}
                    </Typography>
                    {question.help_text && (
                      <Typography variant="body2" color="text.secondary">
                        {question.help_text}
                      </Typography>
                    )}
                    <Stack
                      direction="row"
                      spacing={0.75}
                      sx={{ mt: 1, flexWrap: "wrap", gap: 0.75 }}
                    >
                      <Chip
                        size="small"
                        label={question.type === "scale"
                          ? `Scala ${question.scale_min}–${question.scale_max}`
                          : "Testo libero"}
                        color={question.type === "scale" ? "primary" : "default"}
                        variant="outlined"
                      />
                      {question.type === "scale" && (
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`Peso ${question.weight}`}
                        />
                      )}
                      <Chip
                        size="small"
                        variant="outlined"
                        label={question.is_required ? "Obbligatoria" : "Facoltativa"}
                      />
                    </Stack>
                  </Box>

                  <Stack direction="row" spacing={0.25}>
                    <Tooltip title="Sposta su">
                      <span>
                        <IconButton
                          size="small"
                          disabled={disabled || busy || index === 0}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUpwardIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Sposta giu'">
                      <span>
                        <IconButton
                          size="small"
                          disabled={disabled || busy || index === sorted.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDownwardIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <IconButton
                      size="small"
                      disabled={disabled || busy}
                      onClick={() =>
                        setDraft({
                          id: question.id,
                          label: question.label,
                          helpText: question.help_text ?? "",
                          type: question.type,
                          scaleMin: question.scale_min,
                          scaleMax: question.scale_max,
                          weight: question.weight,
                          isRequired: question.is_required,
                        })}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      color="error"
                      disabled={disabled || busy}
                      onClick={() => remove(question)}
                    >
                      <DeleteOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}

      {/* ------------------------------------------------------------------ */}
      <Dialog
        open={draft !== null}
        onClose={() => setDraft(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{draft?.id ? "Modifica domanda" : "Nuova domanda"}</DialogTitle>
        <DialogContent dividers>
          {draft && (
            <Stack spacing={2} sx={{ pt: 0.5 }}>
              <TextField
                label="Testo della domanda"
                fullWidth
                required
                multiline
                minRows={2}
                value={draft.label}
                onChange={(event) =>
                  setDraft({ ...draft, label: event.target.value })}
              />
              <TextField
                label="Testo di aiuto (facoltativo)"
                fullWidth
                value={draft.helpText}
                onChange={(event) =>
                  setDraft({ ...draft, helpText: event.target.value })}
                helperText="Una riga di spiegazione mostrata sotto la domanda."
              />

              <FormControl fullWidth>
                <InputLabel id="question-type">Tipo di risposta</InputLabel>
                <Select
                  labelId="question-type"
                  label="Tipo di risposta"
                  value={draft.type}
                  onChange={(event) =>
                    setDraft({ ...draft, type: event.target.value as QuestionType })}
                >
                  <MenuItem value="scale">Scala numerica</MenuItem>
                  <MenuItem value="text">Testo libero</MenuItem>
                </Select>
              </FormControl>

              {draft.type === "scale" && (
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <TextField
                    label="Minimo"
                    type="number"
                    fullWidth
                    value={draft.scaleMin}
                    onChange={(event) =>
                      setDraft({ ...draft, scaleMin: Number(event.target.value) })}
                  />
                  <TextField
                    label="Massimo"
                    type="number"
                    fullWidth
                    value={draft.scaleMax}
                    onChange={(event) =>
                      setDraft({ ...draft, scaleMax: Number(event.target.value) })}
                  />
                  <TextField
                    label="Peso"
                    type="number"
                    fullWidth
                    value={draft.weight}
                    onChange={(event) =>
                      setDraft({ ...draft, weight: Number(event.target.value) })}
                    helperText="1 = normale, 2 = conta il doppio"
                    slotProps={{ htmlInput: { step: 0.5, min: 0.5 } }}
                  />
                </Stack>
              )}

              {draft.type === "scale" && draft.scaleMax <= draft.scaleMin && (
                <Alert severity="error">
                  Il valore massimo deve essere maggiore del minimo.
                </Alert>
              )}

              <FormControlLabel
                control={
                  <Switch
                    checked={draft.isRequired}
                    onChange={(event) =>
                      setDraft({ ...draft, isRequired: event.target.checked })}
                  />
                }
                label="Risposta obbligatoria"
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setDraft(null)} disabled={busy}>
            Annulla
          </Button>
          <Button
            variant="contained"
            onClick={save}
            disabled={busy || !draft?.label.trim() ||
              (draft?.type === "scale" && draft.scaleMax <= draft.scaleMin)}
          >
            Salva
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
