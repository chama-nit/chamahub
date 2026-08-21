-- ===========================================================================
-- ChamaHub - 05. Modelli, campagne e schede di valutazione
-- ===========================================================================
-- L'HR crea i modelli (domande a scala numerica e/o testo libero) e apre le
-- campagne. La Edge Function `manage-campaign` genera le schede per ogni
-- dipendente delle aree coinvolte; il responsabile le compila e la Edge
-- Function `submit-evaluation` le consolida calcolando il punteggio.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Modelli di scheda
-- ---------------------------------------------------------------------------
create table public.evaluation_templates (
  id          uuid primary key default extensions.gen_random_uuid(),
  name        text not null,
  description text,
  target      public.template_target not null default 'employee',
  is_active   boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint evaluation_templates_name_not_blank check (length(btrim(name)) > 0)
);

create trigger evaluation_templates_set_updated_at
  before update on public.evaluation_templates
  for each row execute function public.set_updated_at();

comment on column public.evaluation_templates.target is
  'employee = scheda compilata dal responsabile sul dipendente; self = scheda di autovalutazione.';

-- ---------------------------------------------------------------------------
-- Domande del modello
-- ---------------------------------------------------------------------------
create table public.evaluation_questions (
  id          uuid primary key default extensions.gen_random_uuid(),
  template_id uuid not null references public.evaluation_templates (id) on delete cascade,
  position    integer not null,
  label       text not null,
  help_text   text,
  type        public.question_type not null default 'scale',
  scale_min   integer not null default 1,
  scale_max   integer not null default 5,
  weight      numeric(6, 2) not null default 1,
  is_required boolean not null default true,
  created_at  timestamptz not null default now(),

  constraint evaluation_questions_label_not_blank check (length(btrim(label)) > 0),
  constraint evaluation_questions_scale_valid check (scale_max > scale_min),
  constraint evaluation_questions_weight_positive check (weight > 0)
);

create unique index evaluation_questions_order_key
  on public.evaluation_questions (template_id, position);
create index evaluation_questions_template_idx
  on public.evaluation_questions (template_id);

-- ---------------------------------------------------------------------------
-- Campagne
-- ---------------------------------------------------------------------------
create table public.evaluation_campaigns (
  id                      uuid primary key default extensions.gen_random_uuid(),
  name                    text not null,
  description             text,
  template_id             uuid not null references public.evaluation_templates (id) on delete restrict,
  self_template_id        uuid references public.evaluation_templates (id) on delete restrict,
  include_self_assessment boolean not null default true,
  starts_on               date not null default current_date,
  ends_on                 date not null,
  status                  public.campaign_status not null default 'draft',
  created_by              uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint evaluation_campaigns_name_not_blank check (length(btrim(name)) > 0),
  constraint evaluation_campaigns_dates_valid check (ends_on >= starts_on)
);

create trigger evaluation_campaigns_set_updated_at
  before update on public.evaluation_campaigns
  for each row execute function public.set_updated_at();

-- Aree coinvolte nella campagna (nessuna riga = tutte le aree attive).
create table public.evaluation_campaign_areas (
  campaign_id uuid not null references public.evaluation_campaigns (id) on delete cascade,
  area_id     uuid not null references public.areas (id) on delete cascade,
  primary key (campaign_id, area_id)
);

-- ---------------------------------------------------------------------------
-- Schede generate
-- ---------------------------------------------------------------------------
create table public.evaluations (
  id            uuid primary key default extensions.gen_random_uuid(),
  campaign_id   uuid not null references public.evaluation_campaigns (id) on delete cascade,
  template_id   uuid not null references public.evaluation_templates (id) on delete restrict,
  -- Persona valutata.
  subject_id    uuid not null references public.profiles (id) on delete cascade,
  -- Chi compila: il responsabile dell'area, oppure il soggetto stesso nel caso
  -- dell'autovalutazione.
  evaluator_id  uuid not null references public.profiles (id) on delete cascade,
  area_id       uuid references public.areas (id) on delete set null,
  kind          public.evaluation_kind not null,
  status        public.evaluation_status not null default 'pending',
  overall_score numeric(6, 2),
  comment       text,
  submitted_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint evaluations_unique_per_campaign unique (campaign_id, subject_id, kind),
  constraint evaluations_submitted_coherent check (
    (status = 'submitted' and submitted_at is not null)
    or (status <> 'submitted' and submitted_at is null)
  )
);

create index evaluations_evaluator_idx on public.evaluations (evaluator_id, status);
create index evaluations_subject_idx on public.evaluations (subject_id, status);
create index evaluations_campaign_idx on public.evaluations (campaign_id);
create index evaluations_area_idx on public.evaluations (area_id);

create trigger evaluations_set_updated_at
  before update on public.evaluations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Risposte
-- ---------------------------------------------------------------------------
create table public.evaluation_answers (
  id            uuid primary key default extensions.gen_random_uuid(),
  evaluation_id uuid not null references public.evaluations (id) on delete cascade,
  question_id   uuid not null references public.evaluation_questions (id) on delete cascade,
  numeric_value integer,
  text_value    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint evaluation_answers_unique unique (evaluation_id, question_id),
  constraint evaluation_answers_text_length check (text_value is null or length(text_value) <= 4000)
);

create index evaluation_answers_evaluation_idx on public.evaluation_answers (evaluation_id);

create trigger evaluation_answers_set_updated_at
  before update on public.evaluation_answers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Blocco delle schede consegnate
-- ---------------------------------------------------------------------------
-- La transizione a 'submitted' e il calcolo del punteggio avvengono solo nella
-- Edge Function `submit-evaluation` (service_role, auth.uid() nullo).
create or replace function public.protect_evaluation_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if old.status = 'submitted' and not public.is_hr() then
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

  return new;
end;
$$;

create trigger evaluations_protect_submission
  before update on public.evaluations
  for each row execute function public.protect_evaluation_submission();

-- ---------------------------------------------------------------------------
-- RLS: modelli e domande (lettura a tutti gli utenti attivi, scrittura HR)
-- ---------------------------------------------------------------------------
alter table public.evaluation_templates enable row level security;
alter table public.evaluation_questions enable row level security;
alter table public.evaluation_campaigns enable row level security;
alter table public.evaluation_campaign_areas enable row level security;
alter table public.evaluations enable row level security;
alter table public.evaluation_answers enable row level security;

create policy "evaluation_templates_select"
  on public.evaluation_templates for select
  to authenticated using (public.is_active_user());

create policy "evaluation_templates_write_hr"
  on public.evaluation_templates for all
  to authenticated using (public.is_hr()) with check (public.is_hr());

create policy "evaluation_questions_select"
  on public.evaluation_questions for select
  to authenticated using (public.is_active_user());

create policy "evaluation_questions_write_hr"
  on public.evaluation_questions for all
  to authenticated using (public.is_hr()) with check (public.is_hr());

create policy "evaluation_campaigns_select"
  on public.evaluation_campaigns for select
  to authenticated using (public.is_active_user());

create policy "evaluation_campaigns_write_hr"
  on public.evaluation_campaigns for all
  to authenticated using (public.is_hr()) with check (public.is_hr());

create policy "evaluation_campaign_areas_select"
  on public.evaluation_campaign_areas for select
  to authenticated using (public.is_active_user());

create policy "evaluation_campaign_areas_write_hr"
  on public.evaluation_campaign_areas for all
  to authenticated using (public.is_hr()) with check (public.is_hr());

-- ---------------------------------------------------------------------------
-- RLS: schede
-- ---------------------------------------------------------------------------
-- Il valutatore vede e compila le schede a lui assegnate.
create policy "evaluations_select_evaluator"
  on public.evaluations for select
  to authenticated
  using (evaluator_id = (select auth.uid()));

-- Il valutato vede la propria scheda solo dopo la consegna.
create policy "evaluations_select_subject_submitted"
  on public.evaluations for select
  to authenticated
  using (subject_id = (select auth.uid()) and status = 'submitted');

create policy "evaluations_select_hr"
  on public.evaluations for select
  to authenticated
  using (public.is_hr());

create policy "evaluations_update_evaluator"
  on public.evaluations for update
  to authenticated
  using (evaluator_id = (select auth.uid()) and status <> 'submitted' and public.is_active_user())
  with check (evaluator_id = (select auth.uid()));

create policy "evaluations_write_hr"
  on public.evaluations for all
  to authenticated
  using (public.is_hr()) with check (public.is_hr());

-- ---------------------------------------------------------------------------
-- RLS: risposte
-- ---------------------------------------------------------------------------
create or replace function public.can_edit_evaluation(p_evaluation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.evaluations e
    where e.id = p_evaluation
      and e.evaluator_id = (select auth.uid())
      and e.status <> 'submitted'
  )
$$;

create or replace function public.can_read_evaluation(p_evaluation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.evaluations e
    where e.id = p_evaluation
      and (
        e.evaluator_id = (select auth.uid())
        or (e.subject_id = (select auth.uid()) and e.status = 'submitted')
        or public.is_hr()
      )
  )
$$;

create policy "evaluation_answers_select"
  on public.evaluation_answers for select
  to authenticated
  using (public.can_read_evaluation(evaluation_id));

create policy "evaluation_answers_insert"
  on public.evaluation_answers for insert
  to authenticated
  with check (public.can_edit_evaluation(evaluation_id));

create policy "evaluation_answers_update"
  on public.evaluation_answers for update
  to authenticated
  using (public.can_edit_evaluation(evaluation_id))
  with check (public.can_edit_evaluation(evaluation_id));

create policy "evaluation_answers_delete"
  on public.evaluation_answers for delete
  to authenticated
  using (public.can_edit_evaluation(evaluation_id));
