-- ===========================================================================
-- ChamaHub - 10. Autovalutazione per tutti, correggibile dal responsabile
-- ===========================================================================
-- Due cambiamenti:
--
--   1. L'autovalutazione non e' piu' riservata ai responsabili: la compila
--      chiunque partecipi alla campagna (la generazione avviene nella Edge
--      Function `manage-campaign`).
--
--   2. Il responsabile di un'area puo' correggere l'autovalutazione dei propri
--      collaboratori, anche dopo che e' stata consegnata. La correzione lascia
--      una traccia esplicita - chi e quando - perche' un intervento del genere
--      non deve mai essere silenzioso: il diretto interessato lo vede.
-- ===========================================================================

alter table public.evaluations
  add column if not exists corrected_by uuid references public.profiles (id) on delete set null,
  add column if not exists corrected_at timestamptz;

comment on column public.evaluations.corrected_by is
  'Responsabile che ha corretto l''autovalutazione del collaboratore. NULL se la scheda contiene solo quanto scritto dal valutatore.';

-- ---------------------------------------------------------------------------
-- Chi puo' correggere un'autovalutazione altrui
-- ---------------------------------------------------------------------------
-- Solo il responsabile attivo dell'area a cui la scheda appartiene, e solo su
-- schede di tipo `self_assessment` che non siano le proprie.
create or replace function public.can_correct_self_assessment(p_evaluation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.evaluations e
    join public.profiles me on me.id = (select auth.uid())
    where e.id = p_evaluation
      and e.kind = 'self_assessment'
      and e.subject_id <> (select auth.uid())
      and me.is_active
      and me.role = 'manager'
      and me.area_id is not null
      and me.area_id = e.area_id
  )
$$;

-- ---------------------------------------------------------------------------
-- Lettura e scrittura delle risposte
-- ---------------------------------------------------------------------------
create or replace function public.can_edit_evaluation(p_evaluation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.evaluations e
      where e.id = p_evaluation
        and e.evaluator_id = (select auth.uid())
        and e.status <> 'submitted'
    )
    or public.can_correct_self_assessment(p_evaluation)
$$;

create or replace function public.can_read_evaluation(p_evaluation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.evaluations e
      where e.id = p_evaluation
        and (
          e.evaluator_id = (select auth.uid())
          or (e.subject_id = (select auth.uid()) and e.status = 'submitted')
          or public.is_hr()
        )
    )
    or public.can_correct_self_assessment(p_evaluation)
$$;

-- ---------------------------------------------------------------------------
-- Policy sulle schede
-- ---------------------------------------------------------------------------
-- Il responsabile vede le autovalutazioni della propria area anche prima della
-- consegna: e' il presupposto per poterle correggere.
drop policy if exists "evaluations_select_area_manager" on public.evaluations;
create policy "evaluations_select_area_manager"
  on public.evaluations for select
  to authenticated
  using (public.can_correct_self_assessment(id));

drop policy if exists "evaluations_update_area_manager" on public.evaluations;
create policy "evaluations_update_area_manager"
  on public.evaluations for update
  to authenticated
  using (public.can_correct_self_assessment(id))
  with check (public.can_correct_self_assessment(id));

-- ---------------------------------------------------------------------------
-- Blocco delle schede consegnate, aggiornato
-- ---------------------------------------------------------------------------
-- Rispetto alla versione precedente si aggiunge una sola eccezione: il
-- responsabile d'area puo' intervenire su un'autovalutazione gia' consegnata.
-- In quel caso la modifica viene marcata come correzione.
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
  new.overall_score := old.overall_score;

  -- Traccia della correzione: chi non e' il valutatore e mette mano alla scheda
  -- lascia il proprio nome. Il valutato lo vede quando riapre la propria
  -- autovalutazione.
  if v_correcting and v_uid <> old.evaluator_id then
    new.corrected_by := v_uid;
    new.corrected_at := now();
  else
    new.corrected_by := old.corrected_by;
    new.corrected_at := old.corrected_at;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Segna come corretta anche quando cambiano solo le risposte
-- ---------------------------------------------------------------------------
-- Il responsabile puo' limitarsi a modificare una risposta senza toccare la
-- riga della scheda: senza questo trigger la correzione resterebbe invisibile.
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
    update public.evaluations
    set corrected_by = v_uid, corrected_at = now()
    where id = v_evaluation
      and evaluator_id <> v_uid;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists evaluation_answers_mark_corrected on public.evaluation_answers;
create trigger evaluation_answers_mark_corrected
  after insert or update or delete on public.evaluation_answers
  for each row execute function public.mark_evaluation_corrected();
