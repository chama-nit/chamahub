-- ===========================================================================
-- ChamaHub - 18. Un responsabile puo' guidare piu' aree
-- ===========================================================================
-- Il problema
-- -----------
-- Fino a qui "responsabile dell'area X" non era un dato: era una deduzione.
-- Si guardava `profiles.role = 'manager'` insieme a `profiles.area_id`, e da
-- quella coppia si ricavava chi guidava cosa. Comodo, e sbagliato appena la
-- realta' smette di collaborare: una persona ha UNA area di appartenenza,
-- quindi poteva guidarne una sola. Chi in azienda ne segue due non era
-- rappresentabile - se non creandogli due account, che e' il genere di
-- soluzione che si paga per anni.
--
-- La forma nuova
-- --------------
-- Le due cose vengono separate, perche' sono due cose diverse:
--
--   * `profiles.area_id`  -> DOVE LAVORI. Resta una sola, e resta il criterio
--     con cui si contano le persone, si aggregano i KPI e si attribuiscono le
--     schede. Nessun conteggio raddoppia.
--
--   * `area_managers`     -> COSA GUIDI. Una riga per ogni area guidata: zero,
--     una, cinque. E' un elenco, non un campo.
--
-- Il ruolo `manager` resta visibile in anagrafica e continua a significare
-- "guida qualcosa", ma non e' piu' lui a dirlo: lo dice l'elenco, e un trigger
-- tiene il ruolo allineato. Due fonti di verita' che possono divergere sono un
-- guasto in attesa; qui la fonte e' una, il ruolo la riflette.
--
-- Cosa cambia per chi usa l'applicazione
-- --------------------------------------
-- Chi guida due aree le vede entrambe: calendario, richieste, KPI e schede di
-- valutazione coprono l'unione delle aree guidate. Chi ne guida una vede
-- esattamente quello che vedeva prima.
--
-- Piu' responsabili sulla stessa area
-- -----------------------------------
-- La tabella lo permette, ed e' voluto. Tutti i responsabili di un'area vedono
-- e possono compilare le schede dei suoi dipendenti; la consegna e' un atto
-- irreversibile e vale la prima che arriva (`protect_evaluation_submission`
-- chiude la scheda a chiunque altro). Chi ha consegnato resta scritto: da qui
-- in avanti in `submitted_by`, perche' con piu' mani sulla stessa scheda
-- "chi l'ha compilata" smette di essere una domanda retorica.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. La tabella
-- ---------------------------------------------------------------------------
create table if not exists public.area_managers (
  area_id     uuid not null references public.areas (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  assigned_at timestamptz not null default now(),

  primary key (area_id, profile_id)
);

comment on table public.area_managers is
  'Chi guida quale area. Un responsabile puo'' comparire su piu'' aree e un''area puo'' avere piu'' responsabili. L''appartenenza di una persona resta profiles.area_id.';

create index if not exists area_managers_profile_idx
  on public.area_managers (profile_id);

-- ---------------------------------------------------------------------------
-- 2. Travaso dei dati esistenti
-- ---------------------------------------------------------------------------
-- Ogni responsabile che oggi ha un'area diventa responsabile di quell'area:
-- nessuno perde niente, e chi apre l'applicazione dopo l'aggiornamento trova
-- esattamente la situazione di prima.
insert into public.area_managers (area_id, profile_id)
select p.area_id, p.id
from public.profiles p
where p.role = 'manager'
  and p.area_id is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Chi guida cosa: gli helper
-- ---------------------------------------------------------------------------
-- `current_area_id()` resta e continua a significare "l'area a cui appartengo".
-- Non e' piu' pero' la risposta alla domanda "quali aree guido", che da qui in
-- avanti ha una funzione sua.

create or replace function public.managed_areas(p_profile uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select am.area_id
  from public.area_managers am
  where am.profile_id = p_profile
$$;

comment on function public.managed_areas(uuid) is
  'Aree guidate dal profilo indicato. Insieme vuoto se non ne guida nessuna.';

create or replace function public.current_managed_areas()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select am.area_id
  from public.area_managers am
  join public.profiles p on p.id = am.profile_id
  where am.profile_id = (select auth.uid())
    and p.is_active
$$;

comment on function public.current_managed_areas() is
  'Aree guidate da chi sta usando l''applicazione. Un profilo disattivato non guida piu'' niente.';

-- true se l'utente corrente guida l'area indicata. E' la forma che compare
-- nelle policy: leggibile, e con un solo posto da cambiare.
create or replace function public.manages_area(p_area uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_area is not null
     and exists (
       select 1 from public.current_managed_areas() a where a = p_area
     )
$$;

-- Riscritta: il confronto non e' piu' con la propria area di appartenenza ma
-- con l'insieme delle aree guidate.
create or replace function public.manages_profile(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles target
    where target.id = p_profile
      and public.manages_area(target.area_id)
  )
$$;

-- `is_manager()` guardava il ruolo. Ora guarda i fatti: guidi un'area, sei un
-- responsabile. Il ruolo resta allineato dal trigger piu' sotto, ma se per
-- qualsiasi ragione i due divergessero, e' l'elenco a comandare - e' li' che
-- l'HR ha espresso una volonta'.
create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.current_managed_areas()
  )
$$;

-- ---------------------------------------------------------------------------
-- 4. Il ruolo resta allineato all'elenco
-- ---------------------------------------------------------------------------
-- Chi riceve la prima area diventa `manager`; chi perde l'ultima torna
-- `employee`. HR e SystemAdmin non vengono mai toccati: guidare un'area e' in
-- piu' rispetto al loro ruolo, non al posto suo.
create or replace function public.sync_manager_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid := coalesce(new.profile_id, old.profile_id);
  v_role    public.user_role;
  v_quante  integer;
begin
  select role into v_role from public.profiles where id = v_profile;

  if v_role in ('hr', 'sysadmin') then
    return coalesce(new, old);
  end if;

  select count(*) into v_quante
  from public.area_managers
  where profile_id = v_profile;

  if v_quante > 0 and v_role <> 'manager' then
    update public.profiles set role = 'manager' where id = v_profile;
  elsif v_quante = 0 and v_role = 'manager' then
    update public.profiles set role = 'employee' where id = v_profile;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists area_managers_sync_role on public.area_managers;
create trigger area_managers_sync_role
  after insert or delete on public.area_managers
  for each row execute function public.sync_manager_role();

-- ---------------------------------------------------------------------------
-- 5. RLS sulla nuova tabella
-- ---------------------------------------------------------------------------
alter table public.area_managers enable row level security;

-- Chiunque sia attivo puo' leggere chi guida cosa: e' l'informazione che
-- permette a un dipendente di sapere a chi si sta rivolgendo quando apre una
-- richiesta. Non c'e' niente di riservato in un organigramma.
create policy "area_managers_select_all"
  on public.area_managers for select
  to authenticated
  using (public.is_active_user());

-- Solo l'HR nomina e revoca.
create policy "area_managers_write_hr"
  on public.area_managers for all
  to authenticated
  using (public.is_hr())
  with check (public.is_hr());

-- ---------------------------------------------------------------------------
-- 6. Le policy che assumevano una sola area
-- ---------------------------------------------------------------------------

-- Profili: oltre ai colleghi della propria area, un responsabile vede le
-- persone di tutte le aree che guida.
drop policy if exists "profiles_select_same_area" on public.profiles;
create policy "profiles_select_same_area"
  on public.profiles for select
  to authenticated
  using (
    public.is_active_user()
    and area_id is not null
    and (
      area_id = public.current_area_id()
      or public.manages_area(area_id)
    )
  );

-- Calendario.
drop policy if exists "calendar_select_area_manager" on public.calendar_entries;
create policy "calendar_select_area_manager"
  on public.calendar_entries for select
  to authenticated
  using (public.manages_area(area_id));

-- Richieste: le tre funzioni che decidevano confrontando con l'area singola.
create or replace function public.can_view_request(p_request uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.requests r
    where r.id = p_request
      and (
        r.requester_id = (select auth.uid())
        or public.is_hr()
        or (r.recipient = 'manager' and public.manages_area(r.area_id))
      )
  )
$$;

create or replace function public.can_handle_request(p_request uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.requests r
    where r.id = p_request
      and (
        (r.recipient = 'hr' and public.is_hr())
        or (r.recipient = 'manager' and public.manages_area(r.area_id))
        -- L'HR ha comunque supervisione su tutte le richieste.
        or public.is_hr()
      )
  )
$$;

drop policy if exists "requests_select_area_manager" on public.requests;
create policy "requests_select_area_manager"
  on public.requests for select
  to authenticated
  using (recipient = 'manager' and public.manages_area(area_id));

-- ---------------------------------------------------------------------------
-- 7. Valutazioni: tutti i responsabili dell'area, vince la prima consegna
-- ---------------------------------------------------------------------------
-- `evaluator_id` resta e continua a indicare a chi la scheda e' stata
-- intestata all'apertura della campagna: dice di chi era il compito. Non e'
-- pero' piu' l'unico che puo' scriverci.
--
-- La colonna nuova dice chi ha effettivamente premuto "consegna": con due
-- responsabili sulla stessa area, senza quel dato "chi l'ha compilata" resta
-- una domanda senza risposta.
alter table public.evaluations
  add column if not exists submitted_by uuid references public.profiles (id) on delete set null;

comment on column public.evaluations.submitted_by is
  'Chi ha consegnato la scheda. Puo'' differire da evaluator_id quando l''area ha piu'' responsabili.';

-- Correzione delle autovalutazioni: prima il confronto era
-- `me.area_id = e.area_id`, cioe' la sola area di appartenenza. Ora vale per
-- tutte le aree guidate.
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
    where e.id = p_evaluation
      and e.kind = 'self_assessment'
      and e.subject_id <> (select auth.uid())
      and public.manages_area(e.area_id)
  )
$$;

-- true se l'utente corrente e' uno dei responsabili dell'area di una scheda di
-- valutazione (non autovalutazione). E' la condizione che apre la scheda a
-- tutti i responsabili invece che al solo intestatario.
create or replace function public.co_manages_evaluation(p_evaluation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.evaluations e
    where e.id = p_evaluation
      and e.kind = 'manager_review'
      and public.manages_area(e.area_id)
  )
$$;

comment on function public.co_manages_evaluation(uuid) is
  'Vero per ogni responsabile dell''area della scheda, non solo per l''intestatario.';

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
        and e.status <> 'submitted'
        and (
          e.evaluator_id = (select auth.uid())
          or public.co_manages_evaluation(p_evaluation)
        )
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
    or public.co_manages_evaluation(p_evaluation)
$$;

-- Le policy sulla tabella: accanto all'intestatario compaiono i colleghi che
-- guidano la stessa area.
drop policy if exists "evaluations_select_area_manager" on public.evaluations;
create policy "evaluations_select_area_manager"
  on public.evaluations for select
  to authenticated
  using (
    public.can_correct_self_assessment(id)
    or public.co_manages_evaluation(id)
  );

drop policy if exists "evaluations_update_area_manager" on public.evaluations;
create policy "evaluations_update_area_manager"
  on public.evaluations for update
  to authenticated
  using (
    public.is_active_user()
    and status <> 'submitted'
    and (
      public.can_correct_self_assessment(id)
      or public.co_manages_evaluation(id)
    )
  )
  with check (
    public.can_correct_self_assessment(id)
    or public.co_manages_evaluation(id)
  );

-- La consegna resta un atto solo, irreversibile e del primo che arriva:
-- `protect_evaluation_submission` gia' vieta qualunque scrittura su una scheda
-- consegnata, quindi il secondo responsabile che prova a consegnarla trova la
-- porta chiusa. Qui si aggiunge solo la memoria di chi e'' passato per primo.
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
  new.submitted_by := old.submitted_by;

  if v_correcting and v_uid <> old.evaluator_id then
    new.corrected_by := v_uid;
    new.corrected_at := now();
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


-- ---------------------------------------------------------------------------
-- 9. Gradimento, KPI e riepilogo
-- ---------------------------------------------------------------------------
-- Queste funzioni filtravano con `s.area_id = v_area`: una sola area, quella
-- di appartenenza. Il filtro diventa l'appartenenza all'insieme delle aree
-- guidate. Con una sola area guidata il comportamento e' identico a prima:
-- e' lo stesso confronto, scritto su un insieme di un elemento.
--
-- I corpi sono ripresi tali e quali dalle versioni precedenti - cambia la
-- dichiarazione in testa, il confronto, e nulla piu'. Riscriverli sarebbe
-- stata l'occasione per introdurre differenze che nessuno ha chiesto.
--
-- Una nota su chi puo' chiedere cosa: dove esisteva `p_area`, un responsabile
-- poteva gia' passarlo ma veniva ignorato a favore della sua area. Ora puo'
-- sceglierne una fra quelle che guida; se ne chiede una altrui il filtro cade
-- e resta comunque confinato alle proprie, che e' il comportamento sicuro.

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
  -- Non piu' una sola area: l'insieme di quelle guidate.
  v_areas uuid[] := array(select public.current_managed_areas());
begin
  if not (v_is_hr or v_is_manager) then
    raise exception 'Accesso negato ai KPI di gradimento.' using errcode = '42501';
  end if;

  return query
  with scoped as (
    select s.id as submission_id, s.area_id
    from public.satisfaction_submissions s
    where s.period_month between p_from and p_to
      and (v_is_hr or s.area_id = any(v_areas))
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
    and (v_is_hr or ar.id = any(v_areas))
  group by ar.id, ar.name
  order by ar.name;
end;
$$;

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
  -- Non piu' una sola area: l'insieme di quelle guidate.
  v_areas uuid[] := array(select public.current_managed_areas());
  v_filter uuid;
begin
  if not (v_is_hr or v_is_manager) then
    raise exception 'Accesso negato ai KPI di gradimento.' using errcode = '42501';
  end if;

  -- L'HR filtra su qualunque area. Un responsabile puo' chiedere una singola
  -- area solo se la guida; se chiede un'area altrui il filtro cade, ma la
  -- clausola sull'insieme piu' sotto continua a tenerlo dentro le sue.
  -- Senza filtro esplicito vede l'unione delle aree che guida.
  v_filter := case
    when v_is_hr then p_area
    when p_area is not null and p_area = any(v_areas) then p_area
    else null
  end;

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
    and (v_is_hr or s.area_id = any(v_areas))
  where q.type = 'scale'
    and (s.id is not null or a.id is null)
  group by q.id, q.survey_id, sv.name, q.label, q.position, q.scale_min, q.scale_max
  order by sv.name, q.position;
end;
$$;

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
  -- Non piu' una sola area: l'insieme di quelle guidate.
  v_areas uuid[] := array(select public.current_managed_areas());
  v_filter uuid;
  v_from date := (date_trunc('month', current_date) - make_interval(months => greatest(p_months, 1) - 1))::date;
begin
  if not (v_is_hr or v_is_manager) then
    raise exception 'Accesso negato ai KPI di gradimento.' using errcode = '42501';
  end if;

  -- L'HR filtra su qualunque area. Un responsabile puo' chiedere una singola
  -- area solo se la guida; se chiede un'area altrui il filtro cade, ma la
  -- clausola sull'insieme piu' sotto continua a tenerlo dentro le sue.
  -- Senza filtro esplicito vede l'unione delle aree che guida.
  v_filter := case
    when v_is_hr then p_area
    when p_area is not null and p_area = any(v_areas) then p_area
    else null
  end;

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
    and (v_is_hr or s.area_id = any(v_areas))
      and (v_is_hr or s.area_id = any(v_areas))
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
  -- Non piu' una sola area: l'insieme di quelle guidate.
  v_areas uuid[] := array(select public.current_managed_areas());
  v_filter uuid;
begin
  if not (v_is_hr or v_is_manager) then
    raise exception 'Accesso negato ai commenti di gradimento.' using errcode = '42501';
  end if;

  -- L'HR filtra su qualunque area. Un responsabile puo' chiedere una singola
  -- area solo se la guida; se chiede un'area altrui il filtro cade, ma la
  -- clausola sull'insieme piu' sotto continua a tenerlo dentro le sue.
  -- Senza filtro esplicito vede l'unione delle aree che guida.
  v_filter := case
    when v_is_hr then p_area
    when p_area is not null and p_area = any(v_areas) then p_area
    else null
  end;

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
    and (v_is_hr or s.area_id = any(v_areas))
    and (v_is_hr or s.area_id = any(v_areas))
  -- Ordinamento pseudo-casuale: evita che l'ordine di inserimento suggerisca
  -- una correlazione temporale fra commento e autore.
  order by md5(a.id::text)
  limit greatest(coalesce(p_limit, 200), 1);
end;
$$;

create or replace function public.evaluation_kpi_by_area(
  p_campaign uuid default null
)
returns table (
  area_id       uuid,
  area_name     text,
  total         bigint,
  submitted     bigint,
  completion    numeric,
  avg_score     numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_is_hr boolean := public.is_hr();
  v_is_manager boolean := public.is_manager();
  -- Non piu' una sola area: l'insieme di quelle guidate.
  v_areas uuid[] := array(select public.current_managed_areas());
begin
  if not (v_is_hr or v_is_manager) then
    raise exception 'Accesso negato ai KPI delle valutazioni.' using errcode = '42501';
  end if;

  return query
  select
    ar.id,
    ar.name,
    count(e.id) as total,
    count(e.id) filter (where e.status = 'submitted') as submitted,
    case when count(e.id) > 0
      then round(100.0 * count(e.id) filter (where e.status = 'submitted') / count(e.id), 1)
      else null end as completion,
    round(avg(e.overall_score) filter (where e.status = 'submitted'), 2) as avg_score
  from public.areas ar
  left join public.evaluations e
    on e.area_id = ar.id
   and (p_campaign is null or e.campaign_id = p_campaign)
   and e.kind = 'manager_review'
  where ar.is_active
    and (v_is_hr or ar.id = any(v_areas))
  group by ar.id, ar.name
  order by ar.name;
end;
$$;

create or replace function public.my_dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role public.user_role := public.current_role_name();
  -- Resta: e' l'area di APPARTENENZA, che il riquadro mostra.
  v_area uuid := public.current_area_id();
  -- Nuovo: le aree GUIDATE, su cui si contano squadra e richieste.
  v_areas uuid[] := array(select public.current_managed_areas());
  v_result jsonb;
begin
  if v_uid is null or v_role is null then
    return jsonb_build_object('active', false);
  end if;

  v_result := jsonb_build_object(
    'active', true,
    'role', v_role,
    'area_id', v_area,
    -- L'interfaccia ne ha bisogno per sapere se offrire il
    -- selettore fra piu' aree.
    'managed_area_ids', to_jsonb(v_areas),
    -- Comunicazioni a calendario nei prossimi 30 giorni
    'upcoming_entries', (
      select count(*) from public.calendar_entries c
      where c.profile_id = v_uid
        and c.entry_date between current_date and current_date + 30
    ),
    -- Richieste inviate ancora aperte
    'my_open_requests', (
      select count(*) from public.requests r
      where r.requester_id = v_uid and r.status <> 'closed'
    ),
    -- Schede da compilare
    'pending_evaluations', (
      select count(*) from public.evaluations e
      where e.evaluator_id = v_uid and e.status <> 'submitted'
    ),
    -- Schede ricevute e consegnate
    'received_evaluations', (
      select count(*) from public.evaluations e
      where e.subject_id = v_uid and e.status = 'submitted'
    )
  );

  -- La condizione non e' piu' il ruolo ma il fatto: guidi qualcosa.
  if array_length(v_areas, 1) > 0 then
    v_result := v_result || jsonb_build_object(
      'team_size', (
        select count(*) from public.profiles p
        where p.area_id = any(v_areas) and p.is_active and p.id <> v_uid
      ),
      'inbox_requests', (
        select count(*) from public.requests r
        where r.recipient = 'manager' and r.area_id = any(v_areas) and r.status <> 'closed'
      ),
      'team_today', (
        select coalesce(jsonb_object_agg(t.type, t.n), '{}'::jsonb)
        from (
          select c.type::text as type, count(*) as n
          from public.calendar_entries c
          where c.area_id = any(v_areas) and c.entry_date = current_date
          group by c.type
        ) t
      )
    );
  end if;

  if v_role = 'hr' then
    v_result := v_result || jsonb_build_object(
      'employees', (select count(*) from public.profiles p where p.is_active),
      'pending_activation', (select count(*) from public.profiles p where not p.is_active),
      'areas', (select count(*) from public.areas a where a.is_active),
      'inbox_requests', (
        select count(*) from public.requests r
        where r.recipient = 'hr' and r.status <> 'closed'
      ),
      'open_campaigns', (
        select count(*) from public.evaluation_campaigns ec where ec.status = 'open'
      ),
      'satisfaction_responses_30d', (
        select count(*) from public.satisfaction_submissions s
        where s.submitted_on >= current_date - 30
      ),
      'company_today', (
        select coalesce(jsonb_object_agg(t.type, t.n), '{}'::jsonb)
        from (
          select c.type::text as type, count(*) as n
          from public.calendar_entries c
          where c.entry_date = current_date
          group by c.type
        ) t
      )
    );
  end if;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. La vista di riepilogo delle aree
-- ---------------------------------------------------------------------------
-- Prendeva i responsabili da `profiles.area_id = a.id and role = 'manager'`,
-- cioe' dall'appartenenza. Con la separazione fra dove lavori e cosa guidi
-- quella colonna diceva due bugie insieme: ometteva chi guida un'area senza
-- lavorarci, e attribuiva all'area di appartenenza chi ci lavora ma guida
-- altro.
--
-- L'organico invece resta legato all'appartenenza, ed e' giusto cosi': una
-- persona lavora in un posto solo e va contata una volta sola.
drop view if exists public.v_areas_overview;

create view public.v_areas_overview
with (security_invoker = true)
as
select
  a.id,
  a.name,
  a.description,
  a.color,
  a.is_active,
  a.created_at,
  -- Organico: chi APPARTIENE all'area.
  (
    select count(*)
    from public.profiles p
    where p.area_id = a.id and p.is_active
  ) as headcount,
  -- Responsabili: chi GUIDA l'area, che e' un'altra domanda.
  (
    select count(*)
    from public.area_managers am
    join public.profiles p on p.id = am.profile_id
    where am.area_id = a.id and p.is_active
  ) as managers_count,
  coalesce(
    (
      select array_agg(p.full_name order by p.full_name)
      from public.area_managers am
      join public.profiles p on p.id = am.profile_id
      where am.area_id = a.id and p.is_active
    ),
    '{}'::text[]
  ) as manager_names
from public.areas a;

comment on view public.v_areas_overview is
  'Aree con organico (chi ci lavora) e responsabili (chi le guida). Eredita le policy RLS di areas, profiles e area_managers.';
