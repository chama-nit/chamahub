"use client";

// ---------------------------------------------------------------------------
// Compilazione / consultazione di una scheda di valutazione
// ---------------------------------------------------------------------------
// Il salvataggio in bozza avviene direttamente sulla tabella (protetto da RLS:
// solo il valutatore, solo finche' la scheda non e' consegnata). La consegna
// definitiva passa invece dalla Edge Function `submit-evaluation`, che ricalcola
// il punteggio e blocca la scheda: un trigger sul database impedisce di
// impostare lo stato "consegnata" da qualunque altra strada.
// ---------------------------------------------------------------------------

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import LockIcon from "@mui/icons-material/Lock";
import SaveIcon from "@mui/icons-material/Save";
import SendIcon from "@mui/icons-material/Send";

import PageHeader from "@/components/PageHeader";
import QuestionField from "@/components/QuestionField";
import { AsyncBlock, SectionCard, StatCard } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAsync } from "@/lib/hooks";
import { callFunction, getSupabase } from "@/lib/supabase/client";
import {
  EVALUATION_KIND_LABELS,
  EVALUATION_STATUS_COLORS,
  EVALUATION_STATUS_LABELS,
} from "@/lib/labels";
import { formatDateTime, formatScore } from "@/lib/format";
import type {
  Evaluation,
  EvaluationAnswer,
  Question,
} from "@/lib/types/models";

interface Loaded {
  evaluation: Evaluation;
  questions: Question[];
  answers: EvaluationAnswer[];
}

interface AnswerState {
  numeric: number | null;
  text: string;
}

export default function EvaluationDetailPage(
  props: PageProps<"/valutazioni/[id]">,
) {
  const { id } = use(props.params);

  const router = useRouter();
  const toast = useToast();
  const { profile, managedAreas } = useAuth();

  // `edits` contiene solo cio' che l'utente ha toccato in questa sessione; il
  // resto viene letto dai dati caricati. Nessun effetto di sincronizzazione, e
  // dopo un salvataggio basta azzerare le modifiche locali.
  const [edits, setEdits] = useState<Record<string, AnswerState>>({});
  const [commentEdit, setCommentEdit] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data, loading, error, reload } = useAsync<Loaded>(async () => {
    const supabase = getSupabase();

    const { data: evaluation, error: evaluationError } = await supabase
      .from("evaluations")
      .select(`
        *,
        subject:profiles!evaluations_subject_id_fkey (id, full_name, job_title),
        evaluator:profiles!evaluations_evaluator_id_fkey (id, full_name),
        corrector:profiles!evaluations_corrected_by_fkey (id, full_name),
        evaluation_campaigns:campaign_id (id, name, ends_on, status)
      `)
      .eq("id", id)
      .single();

    if (evaluationError) throw new Error(evaluationError.message);

    const { data: questions, error: questionsError } = await supabase
      .from("evaluation_questions")
      .select("*")
      .eq("template_id", (evaluation as Evaluation).template_id)
      .order("position");

    if (questionsError) throw new Error(questionsError.message);

    const { data: existingAnswers, error: answersError } = await supabase
      .from("evaluation_answers")
      .select("*")
      .eq("evaluation_id", id);

    if (answersError) throw new Error(answersError.message);

    return {
      evaluation: evaluation as Evaluation,
      questions: (questions ?? []) as Question[],
      answers: (existingAnswers ?? []) as EvaluationAnswer[],
    };
  }, [id]);

  const baseline = useMemo(() => {
    const initial: Record<string, AnswerState> = {};
    for (const answer of data?.answers ?? []) {
      initial[answer.question_id] = {
        numeric: answer.numeric_value,
        text: answer.text_value ?? "",
      };
    }
    return initial;
  }, [data]);

  const answers = useMemo(() => ({ ...baseline, ...edits }), [baseline, edits]);
  const comment = commentEdit ?? data?.evaluation.comment ?? "";

  const evaluation = data?.evaluation;
  const questions = useMemo(() => data?.questions ?? [], [data]);

  const isEvaluator = evaluation?.evaluator_id === profile?.id;
  const submitted = evaluation?.status === "submitted";

  // Il responsabile d'area puo' correggere l'autovalutazione di un proprio
  // collaboratore, anche dopo la consegna. Le stesse condizioni sono replicate
  // nella policy RLS: qui servono solo a mostrare i comandi giusti.
  const canCorrect = Boolean(
    evaluation?.kind === "self_assessment" &&
      evaluation?.area_id &&
      managedAreas.some((a) => a.id === evaluation.area_id) &&
      evaluation.subject_id !== profile?.id,
  );

  const readOnly = canCorrect ? false : !isEvaluator || submitted;

  const missingRequired = useMemo(
    () =>
      questions.filter((question) => {
        if (!question.is_required) return false;
        const state = answers[question.id];
        return question.type === "scale"
          ? state?.numeric === null || state?.numeric === undefined
          : !state?.text?.trim();
      }),
    [questions, answers],
  );

  // Quante domande risultano davvero compilate.
  // ---------------------------------------------------------------------
  // La versione precedente contava "tutte meno quelle obbligatorie che
  // mancano": le facoltative risultavano quindi complete anche se nessuno le
  // aveva toccate, e il conteggio diceva 5/5 con due caselle vuote a schermo.
  // Qui si guarda la risposta, non l'obbligatorieta'.
  const answered = useMemo(
    () =>
      questions.filter((question) => {
        const state = answers[question.id];
        return question.type === "scale"
          ? state?.numeric !== null && state?.numeric !== undefined
          : Boolean(state?.text?.trim());
      }).length,
    [questions, answers],
  );

  const optionalCount = useMemo(
    () => questions.filter((question) => !question.is_required).length,
    [questions],
  );

  /** Anteprima del punteggio, con la stessa formula usata dal server. */
  const previewScore = useMemo(() => {
    let weighted = 0;
    let totalWeight = 0;
    for (const question of questions) {
      if (question.type !== "scale") continue;
      const value = answers[question.id]?.numeric;
      if (value === null || value === undefined) continue;
      const span = question.scale_max - question.scale_min;
      if (span <= 0) continue;
      weighted += ((value - question.scale_min) / span) * question.weight;
      totalWeight += question.weight;
    }
    if (totalWeight === 0) return null;
    return Math.round((weighted / totalWeight) * 10000) / 100;
  }, [questions, answers]);

  function updateAnswer(questionId: string, patch: Partial<AnswerState>) {
    setEdits((previous) => ({
      ...previous,
      [questionId]: {
        numeric: previous[questionId]?.numeric ?? baseline[questionId]?.numeric ??
          null,
        text: previous[questionId]?.text ?? baseline[questionId]?.text ?? "",
        ...patch,
      },
    }));
  }

  async function saveDraft(silent = false) {
    if (!evaluation || readOnly) return;
    setBusy(true);
    try {
      const supabase = getSupabase();

      const rows = questions
        .map((question) => {
          const state = answers[question.id];
          const numeric = question.type === "scale" ? state?.numeric ?? null : null;
          const text = question.type === "text"
            ? state?.text?.trim() || null
            : null;
          if (numeric === null && text === null) return null;
          return {
            evaluation_id: evaluation.id,
            question_id: question.id,
            numeric_value: numeric,
            text_value: text,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      if (rows.length > 0) {
        const { error: upsertError } = await supabase
          .from("evaluation_answers")
          .upsert(rows, { onConflict: "evaluation_id,question_id" });
        if (upsertError) throw new Error(upsertError.message);
      }

      // Rimuove le risposte svuotate rispetto all'ultimo salvataggio.
      const keep = new Set(rows.map((row) => row.question_id));
      const toDelete = data!.answers
        .filter((answer) => !keep.has(answer.question_id))
        .map((answer) => answer.question_id);

      if (toDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from("evaluation_answers")
          .delete()
          .eq("evaluation_id", evaluation.id)
          .in("question_id", toDelete);
        if (deleteError) throw new Error(deleteError.message);
      }

      // Una correzione non deve far tornare indietro lo stato della scheda:
      // se era consegnata resta consegnata.
      const patch: Record<string, unknown> = {};
      if (comment !== (evaluation.comment ?? "")) {
        patch.comment = comment.trim() || null;
      }
      if (evaluation.status === "pending" && !submitted) {
        patch.status = "draft";
      }

      if (Object.keys(patch).length > 0) {
        const { error: statusError } = await supabase
          .from("evaluations")
          .update(patch)
          .eq("id", evaluation.id);
        if (statusError) throw new Error(statusError.message);
      }

      if (!silent) toast.success("Bozza salvata.");
      setEdits({});
      setCommentEdit(null);
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!evaluation) return;

    if (missingRequired.length > 0) {
      setShowValidation(true);
      setConfirmOpen(false);
      toast.notify(
        `Mancano ${missingRequired.length} risposte obbligatorie.`,
        "warning",
      );
      return;
    }

    setBusy(true);
    try {
      await saveDraft(true);
      await callFunction("submit-evaluation", {
        evaluation_id: evaluation.id,
        comment: comment.trim() || null,
      });
      toast.success("Scheda consegnata.");
      setConfirmOpen(false);
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const title = evaluation
    ? evaluation.kind === "self_assessment"
      ? "Autovalutazione"
      : `Valutazione di ${evaluation.subject?.full_name ?? ""}`
    : "Scheda di valutazione";

  return (
    <>
      <PageHeader
        title={title}
        description={evaluation
          ? (
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1, mt: 1 }}>
              <Chip
                size="small"
                color={EVALUATION_STATUS_COLORS[evaluation.status]}
                label={EVALUATION_STATUS_LABELS[evaluation.status]}
              />
              <Chip
                size="small"
                variant="outlined"
                label={EVALUATION_KIND_LABELS[evaluation.kind]}
              />
              <Chip
                size="small"
                variant="outlined"
                label={evaluation.evaluation_campaigns?.name ?? "—"}
              />
            </Stack>
          )
          : undefined}
        actions={
          <Button startIcon={<ArrowBackIcon />} onClick={() => router.back()}>
            Indietro
          </Button>
        }
      />

      <AsyncBlock loading={loading} error={error}>
        {evaluation && (
          <Stack spacing={3}>
            {submitted && (
              <Alert severity="success" icon={<LockIcon />}>
                Scheda consegnata il {evaluation.submitted_at
                  ? formatDateTime(evaluation.submitted_at)
                  : "—"}.{" "}
                {/* Per il responsabile che sta correggendo la scheda resta
                    modificabile: dirgli il contrario sarebbe falso. */}
                {canCorrect
                  ? "Resta modificabile solo da te, come responsabile dell'area."
                  : "Non e' piu' modificabile."}
              </Alert>
            )}

            {canCorrect && !isEvaluator && (
              <Alert severity="warning">
                Stai intervenendo sull&apos;autovalutazione di{" "}
                <strong>{evaluation.subject?.full_name}</strong> come
                responsabile dell&apos;area. Le modifiche vengono registrate a
                tuo nome e la persona interessata le vede.
              </Alert>
            )}

            {evaluation.corrected_by && (
              <Alert severity="info">
                Questa scheda e&apos; stata corretta da{" "}
                <strong>
                  {evaluation.corrector?.full_name ?? "il responsabile di area"}
                </strong>
                {evaluation.corrected_at
                  ? ` il ${formatDateTime(evaluation.corrected_at)}`
                  : ""}
                : quanto leggi puo&apos; differire da quanto era stato scritto
                in origine.
              </Alert>
            )}

            {!isEvaluator && !canCorrect && !submitted && (
              <Alert severity="info">
                Stai consultando una scheda che non e&apos; assegnata a te.
              </Alert>
            )}

            <Box
              sx={{
                display: "grid",
                gap: 2,
                gridTemplateColumns: {
                  xs: "1fr",
                  sm: "repeat(auto-fit, minmax(210px, 1fr))",
                },
              }}
            >
              <StatCard
                label="Domande compilate"
                value={`${answered} / ${questions.length}`}
                hint={optionalCount > 0
                  ? `${optionalCount} facoltative: contano solo se compilate`
                  : "Tutte obbligatorie"}
              />
              {/* Se la scheda e' stata corretta i punteggi sono due: quello
                  uscito dalle risposte della persona e quello dopo
                  l'intervento del responsabile. Mostrarne uno solo
                  nasconderebbe proprio l'informazione interessante. */}
              <StatCard
                label={submitted ? "Punteggio finale" : "Punteggio provvisorio"}
                value={submitted
                  ? `${formatScore(evaluation.overall_score)} / 100`
                  : `${formatScore(previewScore)} / 100`}
                hint={evaluation.original_score !== null &&
                    evaluation.original_score !== undefined
                  ? "Dopo la correzione del responsabile"
                  : "Media pesata delle domande a scala"}
                color="secondary.main"
              />

              {evaluation.original_score !== null &&
                evaluation.original_score !== undefined && (
                <StatCard
                  label="Prima della correzione"
                  value={`${formatScore(evaluation.original_score)} / 100`}
                  hint="Calcolato sulle risposte originali"
                />
              )}
              <StatCard
                label="Scadenza campagna"
                value={evaluation.evaluation_campaigns?.ends_on
                  ? new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" })
                    .format(new Date(evaluation.evaluation_campaigns.ends_on))
                  : "—"}
              />
            </Box>

            <SectionCard
              title="Domande"
              subtitle={readOnly
                ? "Sola lettura."
                : canCorrect && !isEvaluator
                ? "Puoi modificare le risposte: le correzioni restano tracciate."
                : "Le risposte vengono salvate solo quando premi «Salva bozza»."}
            >
              <Box sx={{ mb: 2.5 }}>
                <LinearProgress
                  variant="determinate"
                  value={questions.length === 0
                    ? 0
                    : (answered / questions.length) * 100}
                  sx={{ height: 6, borderRadius: 3 }}
                />
              </Box>

              <Stack spacing={2}>
                {questions.map((question) => (
                  <QuestionField
                    key={question.id}
                    question={question}
                    numericValue={answers[question.id]?.numeric ?? null}
                    textValue={answers[question.id]?.text ?? ""}
                    onNumericChange={(value) =>
                      updateAnswer(question.id, { numeric: value })}
                    onTextChange={(value) =>
                      updateAnswer(question.id, { text: value })}
                    disabled={readOnly || busy}
                    showValidation={showValidation}
                  />
                ))}
              </Stack>

              <TextField
                label="Commento generale (facoltativo)"
                multiline
                minRows={3}
                fullWidth
                sx={{ mt: 2 }}
                value={comment}
                disabled={readOnly || busy}
                onChange={(event) => setCommentEdit(event.target.value)}
                slotProps={{ htmlInput: { maxLength: 4000 } }}
              />

              {!readOnly && (
                <Stack
                  direction={{ xs: "column", sm: "row" }}
                  spacing={1.5}
                  sx={{ mt: 3, justifyContent: "flex-end" }}
                >
                  <Button
                    variant={isEvaluator && !submitted ? "outlined" : "contained"}
                    startIcon={<SaveIcon />}
                    onClick={() => saveDraft()}
                    disabled={busy}
                  >
                    {canCorrect && !isEvaluator ? "Salva correzione" : "Salva bozza"}
                  </Button>
                  {isEvaluator && !submitted && (
                    <Button
                      variant="contained"
                      startIcon={busy
                        ? <CircularProgress size={18} color="inherit" />
                        : <SendIcon />}
                      onClick={() => setConfirmOpen(true)}
                      disabled={busy}
                    >
                      Consegna definitiva
                    </Button>
                  )}
                </Stack>
              )}
            </SectionCard>
          </Stack>
        )}
      </AsyncBlock>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Consegnare la scheda?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Dopo la consegna la scheda non sara&apos; piu&apos; modificabile e
            diventera&apos; visibile alla persona valutata e al reparto HR.
            {previewScore !== null && (
              <>
                <br />
                <br />
                Punteggio calcolato:{" "}
                <strong>{formatScore(previewScore)} / 100</strong>.
              </>
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setConfirmOpen(false)} disabled={busy}>
            Annulla
          </Button>
          <Button variant="contained" onClick={submit} disabled={busy}>
            Consegna
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
