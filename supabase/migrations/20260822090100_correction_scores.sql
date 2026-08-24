-- ===========================================================================
-- ChamaHub - 13. Punteggio prima e dopo la correzione
-- ===========================================================================
-- Quando il responsabile corregge l'autovalutazione di un collaboratore, il
-- punteggio cambia. Fino a ieri restava quello calcolato alla consegna: la
-- scheda mostrava risposte corrette e punteggio vecchio, cioe' due cose che non
-- si parlavano.
--
-- Da qui in avanti la scheda porta due numeri:
--
--   original_score -> il punteggio uscito dalle risposte della persona, fermo
--                     al momento della consegna;
--   overall_score  -> il punteggio attuale, ricalcolato a ogni correzione.
--
-- Finche' nessuno corregge nulla, `original_score` resta NULL e c'e' un solo
-- punteggio da mostrare.
--
-- Il ricalcolo avviene nel database e non nel browser: e' la stessa formula
-- della Edge Function `submit-evaluation` (media pesata delle sole domande a
-- scala, normalizzata su 0-100), riscritta in SQL perche' debba valere anche
-- per chi modificasse le risposte per altre strade.
-- ===========================================================================

alter table public.evaluations
  add column if not exists original_score numeric(6, 2);

comment on column public.evaluations.original_score is
  'Punteggio calcolato sulle risposte originali della persona valutata, conservato quando il responsabile corregge la scheda. NULL se la scheda non e'' mai stata corretta.';

-- ---------------------------------------------------------------------------
-- Formula del punteggio
-- ---------------------------------------------------------------------------
create or replace function public.evaluation_score(p_evaluation uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
           when coalesce(sum(q.weight), 0) = 0 then null
           else round(
             sum(
               ((a.numeric_value - q.scale_min)::numeric
                 / (q.scale_max - q.scale_min)) * q.weight
             ) / sum(q.weight) * 100,
             2)
         end
  from public.evaluation_answers a
  join public.evaluation_questions q on q.id = a.question_id
  where a.evaluation_id = p_evaluation
    and q.type = 'scale'
    and q.scale_max > q.scale_min
    and a.numeric_value is not null
$$;

comment on function public.evaluation_score(uuid) is
  'Media pesata delle risposte a scala, normalizzata su 0-100. Stessa formula di submit-evaluation e delle funzioni KPI.';

-- ---------------------------------------------------------------------------
-- Correzione: traccia + ricalcolo
-- ---------------------------------------------------------------------------
-- Sostituisce la versione della migrazione 10: oltre a marcare chi e quando,
-- salva il punteggio originale (una volta sola, alla prima correzione) e
-- aggiorna quello corrente.
create or replace function public.mark_evaluation_corrected()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_evaluation uuid := coalesce(new.evaluation_id, old.evaluation_id);
begin
  if v_uid is not null and public.can_correct_self_assessment(v_evaluation) then
    update public.evaluations e
    set corrected_by = v_uid,
        corrected_at = now(),
        -- Il primo intervento fotografa il punteggio della persona valutata;
        -- i successivi non lo toccano piu'.
        original_score = coalesce(e.original_score, e.overall_score),
        overall_score = case
          when e.status = 'submitted' then public.evaluation_score(v_evaluation)
          else e.overall_score
        end
    where e.id = v_evaluation
      and e.evaluator_id <> v_uid;
  end if;

  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- Il blocco delle schede consegnate deve lasciar passare il nuovo punteggio
-- ---------------------------------------------------------------------------
-- La versione precedente riportava sempre `overall_score` al valore vecchio,
-- per impedire a un client di scriverselo da solo. Ora l'eccezione e' una: la
-- riga aggiornata dal trigger di correzione, che gira con `auth.uid()` valido
-- ma calcola il punteggio con la formula del database, non con un valore
-- arrivato dal browser.
create or replace function public.protect_evaluation_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_correcting boolean;
begin
  if v_uid is null then
    return new;
  end if;

  v_correcting := public.can_correct_self_assessment(new.id);

  if old.status = 'submitted' and not public.is_hr() and not v_correcting then
    raise exception 'La scheda e'' gia'' stata consegnata e non e'' piu'' modificabile.';
  end if;

  if new.status = 'submitted' and old.status <> 'submitted' then
    raise exception 'La consegna della scheda deve avvenire tramite la funzione submit-evaluation.';
  end if;

  -- Campi non modificabili dal client.
  new.campaign_id := old.campaign_id;
  new.template_id := old.template_id;
  new.subject_id := old.subject_id;
  new.evaluator_id := old.evaluator_id;
  new.area_id := old.area_id;
  new.kind := old.kind;

  if v_correcting and v_uid <> old.evaluator_id then
    new.corrected_by := v_uid;
    new.corrected_at := now();
    -- Il punteggio non arriva mai dal client: viene ricalcolato qui.
    new.original_score := coalesce(old.original_score, old.overall_score);
    new.overall_score := case
      when old.status = 'submitted' then public.evaluation_score(new.id)
      else old.overall_score
    end;
  else
    new.overall_score := old.overall_score;
    new.original_score := old.original_score;
    new.corrected_by := old.corrected_by;
    new.corrected_at := old.corrected_at;
  end if;

  return new;
end;
$$;
