// ===========================================================================
// Edge Function: submit-evaluation
// ===========================================================================
// Consegna definitiva di una scheda di valutazione (o di autovalutazione).
//
// Perche' passa da una Edge Function: un trigger sul database impedisce a
// qualunque client di portare una scheda in stato `submitted` e di scriverne il
// punteggio. Il calcolo del punteggio e la verifica di completezza avvengono
// quindi in un punto solo, non falsificabile dal browser.
// ===========================================================================

import {
  adminClient,
  AuthError,
  readJson,
  requireCaller,
} from "../_shared/auth.ts";
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/cors.ts";

interface Payload {
  evaluation_id: string;
  comment?: string | null;
}

interface QuestionRow {
  id: string;
  label: string;
  type: "scale" | "text";
  scale_min: number;
  scale_max: number;
  weight: number;
  is_required: boolean;
}

interface AnswerRow {
  question_id: string;
  numeric_value: number | null;
  text_value: string | null;
}

function assert(condition: unknown, message: string, status = 400): void {
  if (!condition) throw new AuthError(message, status);
}

/**
 * Punteggio complessivo normalizzato su scala 0-100, pesato sulle sole domande
 * numeriche. Identico alla formula usata dalle funzioni SQL dei KPI, cosi' che
 * i due valori siano sempre confrontabili.
 */
function computeScore(
  questions: QuestionRow[],
  answers: Map<string, AnswerRow>,
): number | null {
  let weighted = 0;
  let totalWeight = 0;

  for (const question of questions) {
    if (question.type !== "scale") continue;
    const answer = answers.get(question.id);
    if (!answer || answer.numeric_value === null) continue;

    const span = question.scale_max - question.scale_min;
    if (span <= 0) continue;

    weighted += ((answer.numeric_value - question.scale_min) / span) *
      question.weight;
    totalWeight += question.weight;
  }

  if (totalWeight === 0) return null;
  return Math.round((weighted / totalWeight) * 100 * 100) / 100;
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const admin = adminClient();
    const caller = await requireCaller(req, admin);

    const body = await readJson<Payload>(req);
    assert(body?.evaluation_id, "Scheda non indicata.");

    const { data: evaluation, error: evaluationError } = await admin
      .from("evaluations")
      .select("id, template_id, evaluator_id, subject_id, status, kind")
      .eq("id", body.evaluation_id)
      .single();

    if (evaluationError || !evaluation) {
      throw new AuthError("Scheda non trovata.", 404);
    }

    assert(
      evaluation.evaluator_id === caller.id,
      "Questa scheda non e' assegnata a te.",
      403,
    );
    assert(
      evaluation.status !== "submitted",
      "La scheda e' gia' stata consegnata.",
      409,
    );

    const { data: questions, error: questionsError } = await admin
      .from("evaluation_questions")
      .select("id, label, type, scale_min, scale_max, weight, is_required")
      .eq("template_id", evaluation.template_id)
      .order("position");

    if (questionsError || !questions) {
      throw new AuthError("Impossibile leggere le domande del modello.", 500);
    }

    const { data: answers, error: answersError } = await admin
      .from("evaluation_answers")
      .select("question_id, numeric_value, text_value")
      .eq("evaluation_id", evaluation.id);

    if (answersError) {
      throw new AuthError("Impossibile leggere le risposte.", 500);
    }

    const answerMap = new Map<string, AnswerRow>(
      (answers as AnswerRow[]).map((a) => [a.question_id, a]),
    );

    // -----------------------------------------------------------------------
    // Verifica di completezza
    // -----------------------------------------------------------------------
    const missing: string[] = [];
    for (const question of questions as QuestionRow[]) {
      if (!question.is_required) continue;
      const answer = answerMap.get(question.id);

      if (question.type === "scale") {
        const value = answer?.numeric_value;
        if (
          value === null || value === undefined ||
          value < question.scale_min || value > question.scale_max
        ) {
          missing.push(question.label);
        }
      } else if (!answer?.text_value || !answer.text_value.trim()) {
        missing.push(question.label);
      }
    }

    if (missing.length > 0) {
      return jsonResponse(
        {
          error: "La scheda non e' completa.",
          missing_questions: missing,
        },
        422,
      );
    }

    const score = computeScore(questions as QuestionRow[], answerMap);

    const { data: updated, error: updateError } = await admin
      .from("evaluations")
      .update({
        status: "submitted",
        submitted_at: new Date().toISOString(),
        overall_score: score,
        comment: body.comment?.trim() || null,
      })
      .eq("id", evaluation.id)
      // Doppia sicurezza contro una doppia consegna in parallelo.
      .neq("status", "submitted")
      .select("id, status, overall_score, submitted_at")
      .single();

    if (updateError || !updated) {
      throw new AuthError(
        updateError?.message ?? "Consegna non riuscita.",
        409,
      );
    }

    return jsonResponse({ evaluation: updated });
  } catch (err) {
    if (err instanceof AuthError) return errorResponse(err.message, err.status);
    console.error("submit-evaluation:", err);
    return errorResponse("Errore interno del server.", 500);
  }
});
