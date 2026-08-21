// ===========================================================================
// Edge Function: submit-satisfaction
// ===========================================================================
// Raccoglie una compilazione ANONIMA del questionario di gradimento.
//
// Perche' passa da una Edge Function: le tabelle satisfaction_submissions e
// satisfaction_answers non hanno alcuna policy RLS e i permessi sono revocati
// per anon e authenticated. Nessun client puo' scriverci ne' leggerle. La
// funzione verifica il token di chi invia (per accettare risposte solo da
// dipendenti reali e attribuire l'area corretta) e poi scrive con service_role
// SENZA registrare da nessuna parte l'identita' del mittente.
//
// L'unico dato di contesto conservato e' l'area. L'identificativo utente viene
// usato in memoria e mai persistito.
// ===========================================================================

import {
  adminClient,
  AuthError,
  readJson,
  requireCaller,
} from "../_shared/auth.ts";
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/cors.ts";

interface AnswerInput {
  question_id: string;
  numeric_value?: number | null;
  text_value?: string | null;
}

interface Payload {
  survey_id: string;
  answers: AnswerInput[];
}

interface QuestionRow {
  id: string;
  type: "scale" | "text";
  scale_min: number;
  scale_max: number;
  is_required: boolean;
  label: string;
}

function assert(condition: unknown, message: string, status = 400): void {
  if (!condition) throw new AuthError(message, status);
}

/**
 * Impronta anonima e irreversibile usata solo se e' configurato il secret
 * SATISFACTION_THROTTLE_SECRET. Senza il secret non viene prodotta alcuna
 * traccia e l'anonimato resta assoluto.
 */
async function throttleDigest(
  secret: string,
  userId: string,
  surveyId: string,
  period: string,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${userId}:${surveyId}:${period}`),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const admin = adminClient();
    const caller = await requireCaller(req, admin);

    assert(
      caller.area_id,
      "Non sei assegnato a nessuna area: chiedi al reparto HR di completare il tuo profilo.",
      403,
    );

    const body = await readJson<Payload>(req);
    assert(body?.survey_id, "Questionario non indicato.");
    assert(
      Array.isArray(body.answers) && body.answers.length > 0,
      "Nessuna risposta fornita.",
    );

    // -----------------------------------------------------------------------
    // Il questionario deve esistere ed essere attivo
    // -----------------------------------------------------------------------
    const { data: survey, error: surveyError } = await admin
      .from("satisfaction_surveys")
      .select("id, is_active")
      .eq("id", body.survey_id)
      .single();

    if (surveyError || !survey) {
      throw new AuthError("Questionario non trovato.", 404);
    }
    assert(survey.is_active, "Questionario non piu' attivo.", 409);

    // -----------------------------------------------------------------------
    // Validazione delle risposte lato server
    // -----------------------------------------------------------------------
    const { data: questions, error: questionsError } = await admin
      .from("satisfaction_questions")
      .select("id, type, scale_min, scale_max, is_required, label")
      .eq("survey_id", body.survey_id);

    if (questionsError || !questions) {
      throw new AuthError("Impossibile leggere le domande del questionario.", 500);
    }

    const byId = new Map<string, QuestionRow>(
      (questions as QuestionRow[]).map((q) => [q.id, q]),
    );

    const seen = new Set<string>();
    const validated: AnswerInput[] = [];

    for (const answer of body.answers) {
      const question = byId.get(answer.question_id);
      assert(question, "Risposta riferita a una domanda inesistente.");
      assert(
        !seen.has(answer.question_id),
        "Risposta duplicata per la stessa domanda.",
      );
      seen.add(answer.question_id);

      if (question!.type === "scale") {
        const value = answer.numeric_value;
        if (value === null || value === undefined) {
          assert(
            !question!.is_required,
            `La domanda "${question!.label}" e' obbligatoria.`,
          );
          continue;
        }
        assert(
          Number.isInteger(value) &&
            value >= question!.scale_min &&
            value <= question!.scale_max,
          `Valore fuori scala per la domanda "${question!.label}".`,
        );
        validated.push({ question_id: question!.id, numeric_value: value });
      } else {
        const text = (answer.text_value ?? "").trim();
        if (!text) {
          assert(
            !question!.is_required,
            `La domanda "${question!.label}" e' obbligatoria.`,
          );
          continue;
        }
        assert(text.length <= 2000, "Risposta testuale troppo lunga.");
        validated.push({ question_id: question!.id, text_value: text });
      }
    }

    // Tutte le domande obbligatorie devono essere state coperte.
    for (const question of questions as QuestionRow[]) {
      if (question.is_required) {
        assert(
          seen.has(question.id),
          `La domanda "${question.label}" e' obbligatoria.`,
        );
      }
    }

    assert(validated.length > 0, "Nessuna risposta valida da registrare.");

    // -----------------------------------------------------------------------
    // Throttle anonimo opzionale
    // -----------------------------------------------------------------------
    const now = new Date();
    const periodMonth = `${now.getUTCFullYear()}-${
      String(now.getUTCMonth() + 1).padStart(2, "0")
    }-01`;

    const secret = Deno.env.get("SATISFACTION_THROTTLE_SECRET");
    if (secret) {
      const digest = await throttleDigest(
        secret,
        caller.id,
        body.survey_id,
        periodMonth,
      );
      const { error: throttleError } = await admin
        .from("satisfaction_throttle")
        .insert({ digest, period_month: periodMonth });

      if (throttleError) {
        // Violazione di chiave primaria: gia' compilato in questo mese.
        if (throttleError.code === "23505") {
          throw new AuthError(
            "Hai gia' inviato questo questionario nel mese corrente.",
            409,
          );
        }
        throw new AuthError(throttleError.message, 500);
      }
    }

    // -----------------------------------------------------------------------
    // Scrittura (nessun riferimento all'autore)
    // -----------------------------------------------------------------------
    const { data: submission, error: submissionError } = await admin
      .from("satisfaction_submissions")
      .insert({
        survey_id: body.survey_id,
        area_id: caller.area_id,
        period_month: periodMonth,
      })
      .select("id")
      .single();

    if (submissionError || !submission) {
      throw new AuthError(
        submissionError?.message ?? "Impossibile registrare la compilazione.",
        500,
      );
    }

    const { error: answersError } = await admin
      .from("satisfaction_answers")
      .insert(
        validated.map((a) => ({
          submission_id: submission.id,
          question_id: a.question_id,
          numeric_value: a.numeric_value ?? null,
          text_value: a.text_value ?? null,
        })),
      );

    if (answersError) {
      // Rollback manuale: senza le risposte la compilazione non ha senso.
      await admin
        .from("satisfaction_submissions")
        .delete()
        .eq("id", submission.id);
      throw new AuthError(answersError.message, 500);
    }

    // Volutamente non viene restituito alcun identificativo: il client non deve
    // poter ricollegare l'invio alla persona che l'ha effettuato.
    return jsonResponse({ ok: true, answers: validated.length });
  } catch (err) {
    if (err instanceof AuthError) return errorResponse(err.message, err.status);
    console.error("submit-satisfaction:", err);
    return errorResponse("Errore interno del server.", 500);
  }
});
