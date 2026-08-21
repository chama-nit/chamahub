-- ===========================================================================
-- ChamaHub - 06. Schede di gradimento (anonimato assoluto)
-- ===========================================================================
-- SCELTA DI PROGETTO: le risposte di gradimento non contengono, in nessuna
-- forma, un riferimento all'autore. Non esiste alcuna colonna, tabella o
-- indice che permetta di risalire a chi ha compilato, nemmeno al reparto HR
-- e nemmeno a chi ha accesso diretto al database.
--
-- Conseguenze accettate consapevolmente:
--   * non e' possibile calcolare il tasso di partecipazione;
--   * non e' possibile impedire una doppia compilazione (vedi
--     `satisfaction_throttle`, opzionale, piu' avanti in questo file).
--
-- L'unico riferimento conservato e' l'AREA, indispensabile per i KPI. Per
-- evitare che in un'area molto piccola l'aggregato coincida con la singola
-- risposta, ogni funzione di lettura applica una soglia minima di risposte.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Parametri applicativi
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

insert into public.app_settings (key, value, description) values
  ('satisfaction_min_responses', '3'::jsonb,
   'Numero minimo di risposte perche'' un aggregato di gradimento sia visibile. Protegge l''anonimato nelle aree piccole.');

alter table public.app_settings enable row level security;

create policy "app_settings_select"
  on public.app_settings for select
  to authenticated using (public.is_active_user());

create policy "app_settings_write_hr"
  on public.app_settings for all
  to authenticated using (public.is_hr()) with check (public.is_hr());

create or replace function public.satisfaction_min_responses()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (value #>> '{}')::int from public.app_settings where key = 'satisfaction_min_responses'),
    3
  )
$$;

-- ---------------------------------------------------------------------------
-- Questionari di gradimento
-- ---------------------------------------------------------------------------
create table public.satisfaction_surveys (
  id          uuid primary key default extensions.gen_random_uuid(),
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint satisfaction_surveys_name_not_blank check (length(btrim(name)) > 0)
);

create trigger satisfaction_surveys_set_updated_at
  before update on public.satisfaction_surveys
  for each row execute function public.set_updated_at();

create table public.satisfaction_questions (
  id          uuid primary key default extensions.gen_random_uuid(),
  survey_id   uuid not null references public.satisfaction_surveys (id) on delete cascade,
  position    integer not null,
  label       text not null,
  help_text   text,
  type        public.question_type not null default 'scale',
  scale_min   integer not null default 1,
  scale_max   integer not null default 5,
  weight      numeric(6, 2) not null default 1,
  is_required boolean not null default true,
  created_at  timestamptz not null default now(),

  constraint satisfaction_questions_label_not_blank check (length(btrim(label)) > 0),
  constraint satisfaction_questions_scale_valid check (scale_max > scale_min),
  constraint satisfaction_questions_weight_positive check (weight > 0)
);

create unique index satisfaction_questions_order_key
  on public.satisfaction_questions (survey_id, position);

-- ---------------------------------------------------------------------------
-- Compilazioni anonime
-- ---------------------------------------------------------------------------
create table public.satisfaction_submissions (
  id           uuid primary key default extensions.gen_random_uuid(),
  survey_id    uuid not null references public.satisfaction_surveys (id) on delete cascade,
  -- Unico dato di contesto conservato.
  area_id      uuid references public.areas (id) on delete set null,
  -- Mese di riferimento (primo giorno del mese) per i trend temporali.
  period_month date not null default date_trunc('month', current_date)::date,
  -- Volutamente troncato al giorno: un timestamp preciso, incrociato con i log
  -- di accesso, sarebbe un vettore di deanonimizzazione.
  submitted_on date not null default current_date
);

create index satisfaction_submissions_area_period_idx
  on public.satisfaction_submissions (area_id, period_month);
create index satisfaction_submissions_survey_idx
  on public.satisfaction_submissions (survey_id);

comment on table public.satisfaction_submissions is
  'Compilazione anonima di un questionario di gradimento. NON contiene alcun riferimento all''autore.';

create table public.satisfaction_answers (
  id            uuid primary key default extensions.gen_random_uuid(),
  submission_id uuid not null references public.satisfaction_submissions (id) on delete cascade,
  question_id   uuid not null references public.satisfaction_questions (id) on delete cascade,
  numeric_value integer,
  text_value    text,

  constraint satisfaction_answers_unique unique (submission_id, question_id),
  constraint satisfaction_answers_text_length check (text_value is null or length(text_value) <= 2000)
);

create index satisfaction_answers_submission_idx on public.satisfaction_answers (submission_id);
create index satisfaction_answers_question_idx on public.satisfaction_answers (question_id);

-- ---------------------------------------------------------------------------
-- Throttle opzionale e anonimo (disattivato di default)
-- ---------------------------------------------------------------------------
-- Se la Edge Function `submit-satisfaction` trova il secret
-- SATISFACTION_THROTTLE_SECRET, registra qui un HMAC irreversibile di
-- (utente + questionario + mese) per limitare le compilazioni multiple.
-- Il segreto vive solo nell'ambiente della funzione: chi legge il database non
-- puo' risalire all'utente, e in ogni caso la tabella non e' collegabile alle
-- risposte. Senza il secret la tabella resta vuota e l'anonimato e' assoluto.
create table public.satisfaction_throttle (
  digest       text primary key,
  period_month date not null,
  created_at   timestamptz not null default now()
);

comment on table public.satisfaction_throttle is
  'Opzionale. Impronte HMAC irreversibili per limitare le compilazioni multiple. Non collegabile a satisfaction_answers.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.satisfaction_surveys enable row level security;
alter table public.satisfaction_questions enable row level security;
alter table public.satisfaction_submissions enable row level security;
alter table public.satisfaction_answers enable row level security;
alter table public.satisfaction_throttle enable row level security;

-- Questionari e domande: leggibili da tutti gli utenti attivi, scrivibili da HR.
create policy "satisfaction_surveys_select"
  on public.satisfaction_surveys for select
  to authenticated using (public.is_active_user());

create policy "satisfaction_surveys_write_hr"
  on public.satisfaction_surveys for all
  to authenticated using (public.is_hr()) with check (public.is_hr());

create policy "satisfaction_questions_select"
  on public.satisfaction_questions for select
  to authenticated using (public.is_active_user());

create policy "satisfaction_questions_write_hr"
  on public.satisfaction_questions for all
  to authenticated using (public.is_hr()) with check (public.is_hr());

-- Compilazioni, risposte e throttle: NESSUNA policy.
-- Con RLS attivo e zero policy, ogni SELECT/INSERT/UPDATE/DELETE effettuato con
-- la chiave anon o con un token utente restituisce zero righe o fallisce.
-- L'accesso avviene esclusivamente:
--   * in scrittura, dalla Edge Function `submit-satisfaction` (service_role);
--   * in lettura, dalle funzioni SECURITY DEFINER di aggregazione qui sotto.
revoke all on public.satisfaction_submissions from anon, authenticated;
revoke all on public.satisfaction_answers from anon, authenticated;
revoke all on public.satisfaction_throttle from anon, authenticated;

-- ===========================================================================
-- Funzioni di aggregazione KPI
-- ===========================================================================
-- Regole di accesso applicate all'interno delle funzioni:
--   * HR      -> tutte le aree
--   * Manager -> esclusivamente la propria area
--   * Altri   -> nessun dato
-- In ogni caso l'aggregato viene restituito solo se il numero di risposte
-- raggiunge la soglia minima configurata.

-- KPI per area su un intervallo di mesi.
create or replace function public.satisfaction_kpi_by_area(
  p_from date default (date_trunc('month', current_date) - interval '11 months')::date,
  p_to   date default date_trunc('month', current_date)::date
)
returns table (
  area_id        uuid,
  area_name      text,
  responses      bigint,
  avg_score      numeric,
  avg_percentage numeric,
  below_threshold boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_min int := public.satisfaction_min_responses();
  v_is_hr boolean := public.is_hr();
  v_is_manager boolean := public.is_manager();
  v_area uuid := public.current_area_id();
begin
  if not (v_is_hr or v_is_manager) then
    raise exception 'Accesso negato ai KPI di gradimento.' using errcode = '42501';
  end if;

  return query
  with scoped as (
    select s.id as submission_id, s.area_id
    from public.satisfaction_submissions s
    where s.period_month between p_from and p_to
      and (v_is_hr or s.area_id = v_area)
  ),
  scored as (
    select
      sc.area_id,
      sc.submission_id,
      -- Normalizzazione su scala 0-100 pesata sulle sole domande numeriche.
      sum(
        ((a.numeric_value - q.scale_min)::numeric
          / nullif(q.scale_max - q.scale_min, 0)) * q.weight
      ) / nullif(sum(q.weight), 0) * 100 as pct,
      avg(a.numeric_value::numeric) as raw_avg
    from scoped sc
    join public.satisfaction_answers a on a.submission_id = sc.submission_id
    join public.satisfaction_questions q on q.id = a.question_id
    where a.numeric_value is not null and q.type = 'scale'
    group by sc.area_id, sc.submission_id
  )
  select
    ar.id,
    ar.name,
    count(sd.submission_id) as responses,
    case when count(sd.submission_id) >= v_min
      then round(avg(sd.raw_avg), 2) end as avg_score,
    case when count(sd.submission_id) >= v_min
      then round(avg(sd.pct), 1) end as avg_percentage,
    count(sd.submission_id) < v_min as below_threshold
  from public.areas ar
  left join scored sd on sd.area_id = ar.id
  where ar.is_active
    and (v_is_hr or ar.id = v_area)
  group by ar.id, ar.name
  order by ar.name;
end;
$$;

-- Dettaglio per singola domanda (facoltativamente filtrato su un'area).
create or replace function public.satisfaction_kpi_by_question(
  p_area uuid default null,
  p_from date default (date_trunc('month', current_date) - interval '11 months')::date,
  p_to   date default date_trunc('month', current_date)::date
)
returns table (
  question_id   uuid,
  survey_id     uuid,
  survey_name   text,
  label         text,
  ordinal       integer,
  scale_min     integer,
  scale_max     integer,
  responses     bigint,
  avg_score     numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_min int := public.satisfaction_min_responses();
  v_is_hr boolean := public.is_hr();
  v_is_manager boolean := public.is_manager();
  v_area uuid := public.current_area_id();
  v_filter uuid;
begin
  if not (v_is_hr or v_is_manager) then
    raise exception 'Accesso negato ai KPI di gradimento.' using errcode = '42501';
  end if;

  -- Un responsabile puo' filtrare solo sulla propria area.
  v_filter := case when v_is_hr then p_area else v_area end;

  return query
  select
    q.id,
    q.survey_id,
    sv.name,
    q.label,
    q.position,
    q.scale_min,
    q.scale_max,
    count(a.id) as responses,
    case when count(a.id) >= v_min then round(avg(a.numeric_value::numeric), 2) end as avg_score
  from public.satisfaction_questions q
  join public.satisfaction_surveys sv on sv.id = q.survey_id
  left join public.satisfaction_answers a on a.question_id = q.id and a.numeric_value is not null
  left join public.satisfaction_submissions s on s.id = a.submission_id
    and s.period_month between p_from and p_to
    and (v_filter is null or s.area_id = v_filter)
  where q.type = 'scale'
    and (s.id is not null or a.id is null)
  group by q.id, q.survey_id, sv.name, q.label, q.position, q.scale_min, q.scale_max
  order by sv.name, q.position;
end;
$$;

-- Andamento mensile del gradimento.
create or replace function public.satisfaction_trend(
  p_area   uuid default null,
  p_months integer default 12
)
returns table (
  period_month   date,
  area_id        uuid,
  responses      bigint,
  avg_percentage numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_min int := public.satisfaction_min_responses();
  v_is_hr boolean := public.is_hr();
  v_is_manager boolean := public.is_manager();
  v_area uuid := public.current_area_id();
  v_filter uuid;
  v_from date := (date_trunc('month', current_date) - make_interval(months => greatest(p_months, 1) - 1))::date;
begin
  if not (v_is_hr or v_is_manager) then
    raise exception 'Accesso negato ai KPI di gradimento.' using errcode = '42501';
  end if;

  v_filter := case when v_is_hr then p_area else v_area end;

  return query
  with scored as (
    select
      s.period_month,
      s.area_id,
      s.id as submission_id,
      sum(
        ((a.numeric_value - q.scale_min)::numeric
          / nullif(q.scale_max - q.scale_min, 0)) * q.weight
      ) / nullif(sum(q.weight), 0) * 100 as pct
    from public.satisfaction_submissions s
    join public.satisfaction_answers a on a.submission_id = s.id
    join public.satisfaction_questions q on q.id = a.question_id
    where s.period_month >= v_from
      and a.numeric_value is not null
      and q.type = 'scale'
      and (v_filter is null or s.area_id = v_filter)
      and (v_is_hr or s.area_id = v_area)
    group by s.period_month, s.area_id, s.id
  )
  select
    sc.period_month,
    sc.area_id,
    count(*) as responses,
    case when count(*) >= v_min then round(avg(sc.pct), 1) end as avg_percentage
  from scored sc
  group by sc.period_month, sc.area_id
  order by sc.period_month;
end;
$$;

-- Commenti liberi, restituiti solo se l'area ha superato la soglia minima.
create or replace function public.satisfaction_comments(
  p_area  uuid default null,
  p_from  date default (date_trunc('month', current_date) - interval '11 months')::date,
  p_to    date default date_trunc('month', current_date)::date,
  p_limit integer default 200
)
returns table (
  area_id      uuid,
  area_name    text,
  period_month date,
  label        text,
  text_value   text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_min int := public.satisfaction_min_responses();
  v_is_hr boolean := public.is_hr();
  v_is_manager boolean := public.is_manager();
  v_area uuid := public.current_area_id();
  v_filter uuid;
begin
  if not (v_is_hr or v_is_manager) then
    raise exception 'Accesso negato ai commenti di gradimento.' using errcode = '42501';
  end if;

  v_filter := case when v_is_hr then p_area else v_area end;

  return query
  with eligible as (
    -- Solo le aree che hanno raccolto abbastanza risposte nel periodo.
    select s.area_id
    from public.satisfaction_submissions s
    where s.period_month between p_from and p_to
    group by s.area_id
    having count(*) >= v_min
  )
  select
    s.area_id,
    ar.name,
    s.period_month,
    q.label,
    a.text_value
  from public.satisfaction_submissions s
  join eligible e on e.area_id is not distinct from s.area_id
  join public.satisfaction_answers a on a.submission_id = s.id
  join public.satisfaction_questions q on q.id = a.question_id
  left join public.areas ar on ar.id = s.area_id
  where s.period_month between p_from and p_to
    and a.text_value is not null
    and length(btrim(a.text_value)) > 0
    and (v_filter is null or s.area_id = v_filter)
    and (v_is_hr or s.area_id = v_area)
  -- Ordinamento pseudo-casuale: evita che l'ordine di inserimento suggerisca
  -- una correlazione temporale fra commento e autore.
  order by md5(a.id::text)
  limit greatest(coalesce(p_limit, 200), 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- Permessi di esecuzione
-- ---------------------------------------------------------------------------
revoke all on function public.satisfaction_kpi_by_area(date, date) from public, anon;
revoke all on function public.satisfaction_kpi_by_question(uuid, date, date) from public, anon;
revoke all on function public.satisfaction_trend(uuid, integer) from public, anon;
revoke all on function public.satisfaction_comments(uuid, date, date, integer) from public, anon;

grant execute on function public.satisfaction_kpi_by_area(date, date) to authenticated;
grant execute on function public.satisfaction_kpi_by_question(uuid, date, date) to authenticated;
grant execute on function public.satisfaction_trend(uuid, integer) to authenticated;
grant execute on function public.satisfaction_comments(uuid, date, date, integer) to authenticated;
