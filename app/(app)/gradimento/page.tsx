"use client";

// ---------------------------------------------------------------------------
// Scheda di gradimento del lavoro (anonima)
// ---------------------------------------------------------------------------
// L'invio non passa dal client ma dalla Edge Function `submit-satisfaction`:
// le tabelle di destinazione non sono scrivibili ne' leggibili da alcun utente
// e non contengono riferimenti all'autore. Il questionario e' sempre aperto e
// compilabile piu' volte nel tempo.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import LockIcon from "@mui/icons-material/Lock";
import SendIcon from "@mui/icons-material/Send";

import PageHeader from "@/components/PageHeader";
import QuestionField from "@/components/QuestionField";
import { AsyncBlock, EmptyState, SectionCard } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { useAsync } from "@/lib/hooks";
import { callFunction, getSupabase } from "@/lib/supabase/client";
import type { Question, SatisfactionSurvey } from "@/lib/types/models";

interface AnswerState {
  numeric: number | null;
  text: string;
}

export default function SatisfactionPage() {
  const toast = useToast();

  const [surveyId, setSurveyId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [showValidation, setShowValidation] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const { data, loading, error } = useAsync<SatisfactionSurvey[]>(async () => {
    const supabase = getSupabase();
    const { data: surveys, error: queryError } = await supabase
      .from("satisfaction_surveys")
      .select("*, satisfaction_questions (*)")
      .eq("is_active", true)
      .order("created_at");

    if (queryError) throw new Error(queryError.message);
    return (surveys ?? []) as SatisfactionSurvey[];
  }, []);

  const survey = useMemo(() => {
    if (!data || data.length === 0) return null;
    return data.find((item) => item.id === surveyId) ?? data[0];
  }, [data, surveyId]);

  const questions = useMemo<Question[]>(
    () =>
      [...(survey?.satisfaction_questions ?? [])].sort(
        (a, b) => a.position - b.position,
      ),
    [survey],
  );

  const answered = questions.filter((question) => {
    const state = answers[question.id];
    return question.type === "scale"
      ? state?.numeric !== null && state?.numeric !== undefined
      : Boolean(state?.text?.trim());
  }).length;

  const missingRequired = questions.filter((question) => {
    if (!question.is_required) return false;
    const state = answers[question.id];
    return question.type === "scale"
      ? state?.numeric === null || state?.numeric === undefined
      : !state?.text?.trim();
  });

  function updateAnswer(questionId: string, patch: Partial<AnswerState>) {
    setAnswers((previous) => ({
      ...previous,
      [questionId]: {
        numeric: previous[questionId]?.numeric ?? null,
        text: previous[questionId]?.text ?? "",
        ...patch,
      },
    }));
  }

  async function submit() {
    if (!survey) return;

    if (missingRequired.length > 0) {
      setShowValidation(true);
      toast.notify(
        `Mancano ${missingRequired.length} risposte obbligatorie.`,
        "warning",
      );
      return;
    }

    setSending(true);
    try {
      const payload = questions
        .map((question) => {
          const state = answers[question.id];
          if (question.type === "scale") {
            if (state?.numeric === null || state?.numeric === undefined) {
              return null;
            }
            return { question_id: question.id, numeric_value: state.numeric };
          }
          if (!state?.text?.trim()) return null;
          return { question_id: question.id, text_value: state.text.trim() };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      await callFunction("submit-satisfaction", {
        survey_id: survey.id,
        answers: payload,
      });

      setSent(true);
      setAnswers({});
      setShowValidation(false);
    } catch (err) {
      toast.error(err);
    } finally {
      setSending(false);
    }
  }

  // -------------------------------------------------------------------------
  if (sent) {
    return (
      <>
        <PageHeader title="Gradimento del lavoro" />
        <Card>
          <CardContent>
            <EmptyState
              icon={<CheckCircleIcon sx={{ fontSize: 56, color: "success.main" }} />}
              title="Grazie, la tua risposta e' stata registrata"
              description="La compilazione e' stata salvata senza alcun riferimento a te: nessuno, nemmeno il reparto HR, puo' risalire a chi ha risposto cosa. I risultati confluiscono nella media della tua area."
              action={
                <Button variant="outlined" onClick={() => setSent(false)}>
                  Compila di nuovo
                </Button>
              }
            />
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Gradimento del lavoro"
        description="Un questionario breve sul tuo benessere lavorativo. Le risposte vengono aggregate per area e servono all'azienda per capire cosa funziona e cosa no."
      />

      <AsyncBlock loading={loading} error={error}>
        {!survey
          ? (
            <Card>
              <CardContent>
                <EmptyState
                  title="Nessun questionario attivo"
                  description="Al momento il reparto HR non ha pubblicato questionari di gradimento."
                />
              </CardContent>
            </Card>
          )
          : (
            <Stack spacing={3}>
              <Alert severity="info" icon={<LockIcon />}>
                <AlertTitle>Le tue risposte sono anonime</AlertTitle>
                Il tuo nome, la tua email e il tuo identificativo non vengono
                salvati insieme alle risposte: tecnicamente non e&apos; possibile
                ricollegare una compilazione alla persona che l&apos;ha inviata.
                L&apos;unico dato conservato e&apos; l&apos;area di appartenenza,
                e i risultati vengono mostrati solo quando le risposte raccolte
                sono abbastanza numerose da non permettere deduzioni.
              </Alert>

              {(data?.length ?? 0) > 1 && (
                <FormControl sx={{ maxWidth: 420 }}>
                  <InputLabel id="survey-label">Questionario</InputLabel>
                  <Select
                    labelId="survey-label"
                    label="Questionario"
                    value={survey.id}
                    onChange={(event) => {
                      setSurveyId(event.target.value);
                      setAnswers({});
                      setShowValidation(false);
                    }}
                  >
                    {data?.map((item) => (
                      <MenuItem key={item.id} value={item.id}>
                        {item.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              <SectionCard
                title={survey.name}
                subtitle={survey.description}
                actions={
                  <Typography variant="body2" color="text.secondary">
                    {answered} / {questions.length} risposte
                  </Typography>
                }
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
                      disabled={sending}
                      showValidation={showValidation}
                    />
                  ))}
                </Stack>

                <Stack
                  direction="row"
                  spacing={2}
                  sx={{ mt: 3, alignItems: "center", justifyContent: "flex-end" }}
                >
                  {missingRequired.length > 0 && showValidation && (
                    <Typography variant="body2" color="error">
                      {missingRequired.length} risposte obbligatorie mancanti.
                    </Typography>
                  )}
                  <Button
                    variant="contained"
                    size="large"
                    onClick={submit}
                    disabled={sending || questions.length === 0}
                    startIcon={sending
                      ? <CircularProgress size={18} color="inherit" />
                      : <SendIcon />}
                  >
                    Invia in forma anonima
                  </Button>
                </Stack>
              </SectionCard>
            </Stack>
          )}
      </AsyncBlock>
    </>
  );
}
