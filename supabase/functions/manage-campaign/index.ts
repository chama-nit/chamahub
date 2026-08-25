// ===========================================================================
// Edge Function: manage-campaign
// ===========================================================================
// Apertura, sincronizzazione e chiusura delle campagne di valutazione.
//
// Perche' passa da una Edge Function: l'apertura di una campagna genera in
// blocco decine di schede intestate a persone diverse. Farlo dal browser
// significherebbe concedere all'HR un permesso di scrittura molto ampio sulla
// tabella `evaluations`; qui invece la generazione segue una regola unica e
// verificabile, e il client si limita a chiedere l'azione.
//
// Azioni (POST):
//   open  -> porta la campagna in stato `open` e genera le schede mancanti
//   sync  -> rigenera solo le schede mancanti (nuovi assunti, nuove aree)
//   close -> chiude la campagna
//   reopen-> riporta la campagna in stato `open`
// ===========================================================================

import {
  adminClient,
  AuthError,
  readJson,
  requireCaller,
  requireRole,
} from "../_shared/auth.ts";
import { errorResponse, handlePreflight, jsonResponse } from "../_shared/cors.ts";

interface Payload {
  action: "open" | "sync" | "close" | "reopen";
  campaign_id: string;
}

interface ProfileRow {
  id: string;
  full_name: string;
  role: "employee" | "manager" | "hr" | "sysadmin";
  area_id: string | null;
  created_at: string;
}

function assert(condition: unknown, message: string, status = 400): void {
  if (!condition) throw new AuthError(message, status);
}

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const admin = adminClient();
    const caller = await requireCaller(req, admin);
    requireRole(caller, "hr");

    const body = await readJson<Payload>(req);
    assert(body?.campaign_id, "Campagna non indicata.");
    assert(body?.action, "Azione non indicata.");

    const { data: campaign, error: campaignError } = await admin
      .from("evaluation_campaigns")
      .select(
        "id, name, status, template_id, self_template_id, include_self_assessment",
      )
      .eq("id", body.campaign_id)
      .single();

    if (campaignError || !campaign) {
      throw new AuthError("Campagna non trovata.", 404);
    }

    // -----------------------------------------------------------------------
    if (body.action === "close") {
      const { data, error } = await admin
        .from("evaluation_campaigns")
        .update({ status: "closed" })
        .eq("id", campaign.id)
        .select("id, status")
        .single();
      if (error) throw new AuthError(error.message, 400);
      return jsonResponse({ campaign: data });
    }

    // -----------------------------------------------------------------------
    // open / reopen / sync: generazione delle schede
    // -----------------------------------------------------------------------
    if (campaign.include_self_assessment) {
      assert(
        campaign.self_template_id,
        "La campagna prevede l'autovalutazione ma non ha un modello di autovalutazione associato.",
      );
    }

    // Aree coinvolte: se non ne e' indicata nessuna, tutte quelle attive.
    const { data: campaignAreas, error: campaignAreasError } = await admin
      .from("evaluation_campaign_areas")
      .select("area_id")
      .eq("campaign_id", campaign.id);

    if (campaignAreasError) {
      throw new AuthError(campaignAreasError.message, 500);
    }

    let areaIds = (campaignAreas ?? []).map((a) => a.area_id as string);

    if (areaIds.length === 0) {
      const { data: allAreas, error: allAreasError } = await admin
        .from("areas")
        .select("id")
        .eq("is_active", true);
      if (allAreasError) throw new AuthError(allAreasError.message, 500);
      areaIds = (allAreas ?? []).map((a) => a.id as string);
    }

    assert(areaIds.length > 0, "Nessuna area attiva da coinvolgere.");

    const { data: people, error: peopleError } = await admin
      .from("profiles")
      .select("id, full_name, role, area_id, created_at")
      .in("area_id", areaIds)
      .eq("is_active", true)
      .order("created_at");

    if (peopleError) throw new AuthError(peopleError.message, 500);

    const profiles = (people ?? []) as ProfileRow[];

    // Chi guida quale area. Dalla migrazione 18 non si ricava piu' da
    // `role` + `area_id` - quella coppia sapeva rappresentare un responsabile
    // di una sola area - ma si legge dall'elenco esplicito.
    const { data: nomine, error: nomineError } = await admin
      .from("area_managers")
      .select("area_id, profile_id, assigned_at")
      .in("area_id", areaIds)
      .order("assigned_at");

    if (nomineError) throw new AuthError(nomineError.message, 500);

    // A un'area possono corrispondere piu' responsabili. La scheda va pero'
    // intestata a UNO: si sceglie il primo nominato, perche' la scelta sia
    // sempre la stessa a parita' di dati e non dipenda dall'ordine con cui il
    // database restituisce le righe.
    //
    // L'intestazione non e' un'esclusiva: le policy aprono la scheda a tutti i
    // responsabili dell'area, e vale la prima consegna. Serve solo perche' la
    // scheda compaia nell'elenco "da compilare" di qualcuno invece che di
    // nessuno.
    const managerByArea = new Map<string, string>();
    for (const nomina of (nomine ?? []) as { area_id: string; profile_id: string }[]) {
      if (!managerByArea.has(nomina.area_id)) {
        managerByArea.set(nomina.area_id, nomina.profile_id);
      }
    }

    // Schede gia' esistenti, per non duplicare nulla.
    const { data: existing, error: existingError } = await admin
      .from("evaluations")
      .select("subject_id, kind")
      .eq("campaign_id", campaign.id);

    if (existingError) throw new AuthError(existingError.message, 500);

    const already = new Set(
      (existing ?? []).map((e) => `${e.subject_id}:${e.kind}`),
    );

    const toInsert: Record<string, unknown>[] = [];
    const warnings: string[] = [];

    for (const person of profiles) {
      if (!person.area_id) continue;

      // 1. Scheda del responsabile sul dipendente.
      if (person.role === "employee") {
        const managerId = managerByArea.get(person.area_id);
        if (!managerId) {
          warnings.push(
            `${person.full_name}: l'area non ha un responsabile, scheda non generata.`,
          );
        } else if (!already.has(`${person.id}:manager_review`)) {
          toInsert.push({
            campaign_id: campaign.id,
            template_id: campaign.template_id,
            subject_id: person.id,
            evaluator_id: managerId,
            area_id: person.area_id,
            kind: "manager_review",
            status: "pending",
          });
        }
      }

      // 2. Autovalutazione: la compilano tutti, non solo i responsabili.
      //    Quella di un dipendente e' poi correggibile dal responsabile della
      //    sua area (vedi migrazione 10).
      if (
        campaign.include_self_assessment &&
        campaign.self_template_id &&
        !already.has(`${person.id}:self_assessment`)
      ) {
        toInsert.push({
          campaign_id: campaign.id,
          template_id: campaign.self_template_id,
          subject_id: person.id,
          evaluator_id: person.id,
          area_id: person.area_id,
          kind: "self_assessment",
          status: "pending",
        });
      }
    }

    // Nessuna scheda generata e nessuna gia' esistente: succede quando le aree
    // coinvolte non hanno dipendenti da valutare e l'autovalutazione non e'
    // prevista. E' meglio dirlo che lasciare una campagna aperta e vuota, con
    // un "0 / 0" che sembra un guasto.
    if (toInsert.length === 0 && already.size === 0) {
      warnings.push(
        campaign.include_self_assessment
          ? "Nessuna scheda da generare: le aree coinvolte non hanno persone attive."
          : "Nessuna scheda da generare: le aree coinvolte non hanno dipendenti con un responsabile, e l'autovalutazione non e' prevista per questa campagna.",
      );
    }

    if (toInsert.length > 0) {
      const { error: insertError } = await admin
        .from("evaluations")
        .insert(toInsert);
      if (insertError) throw new AuthError(insertError.message, 400);
    }

    if (body.action === "open" || body.action === "reopen") {
      const { error: statusError } = await admin
        .from("evaluation_campaigns")
        .update({ status: "open" })
        .eq("id", campaign.id);
      if (statusError) throw new AuthError(statusError.message, 400);
    }

    return jsonResponse({
      campaign_id: campaign.id,
      status: body.action === "sync" ? campaign.status : "open",
      created: toInsert.length,
      warnings,
    });
  } catch (err) {
    if (err instanceof AuthError) return errorResponse(err.message, err.status);
    console.error("manage-campaign:", err);
    return errorResponse("Errore interno del server.", 500);
  }
});
