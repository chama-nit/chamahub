-- ===========================================================================
-- ChamaHub - 07. Viste di supporto e KPI delle valutazioni
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Panoramica delle aree: organico, responsabili, comunicazioni odierne
-- ---------------------------------------------------------------------------
-- `security_invoker = true`: la vista eredita le policy RLS dell'utente che la
-- interroga, quindi non costituisce una via di fuga rispetto ai permessi.
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
  count(p.id) filter (where p.is_active) as headcount,
  count(p.id) filter (where p.is_active and p.role = 'manager') as managers_count,
  coalesce(
    array_agg(p.full_name order by p.full_name)
      filter (where p.is_active and p.role = 'manager'),
    '{}'::text[]
  ) as manager_names
from public.areas a
left join public.profiles p on p.area_id = a.id
group by a.id, a.name, a.description, a.color, a.is_active, a.created_at;

comment on view public.v_areas_overview is
  'Aree con organico e responsabili. Eredita le policy RLS di areas e profiles.';

-- ---------------------------------------------------------------------------
-- KPI delle campagne di valutazione
-- ---------------------------------------------------------------------------
-- A differenza del gradimento, le valutazioni sono nominali: la funzione
-- restituisce medie per area a HR e al responsabile della propria area.
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
  v_area uuid := public.current_area_id();
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
    and (v_is_hr or ar.id = v_area)
  group by ar.id, ar.name
  order by ar.name;
end;
$$;

revoke all on function public.evaluation_kpi_by_area(uuid) from public, anon;
grant execute on function public.evaluation_kpi_by_area(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Riepilogo per la home page dell'utente corrente
-- ---------------------------------------------------------------------------
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
  v_area uuid := public.current_area_id();
  v_result jsonb;
begin
  if v_uid is null or v_role is null then
    return jsonb_build_object('active', false);
  end if;

  v_result := jsonb_build_object(
    'active', true,
    'role', v_role,
    'area_id', v_area,
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

  if v_role = 'manager' and v_area is not null then
    v_result := v_result || jsonb_build_object(
      'team_size', (
        select count(*) from public.profiles p
        where p.area_id = v_area and p.is_active and p.id <> v_uid
      ),
      'inbox_requests', (
        select count(*) from public.requests r
        where r.recipient = 'manager' and r.area_id = v_area and r.status <> 'closed'
      ),
      'team_today', (
        select coalesce(jsonb_object_agg(t.type, t.n), '{}'::jsonb)
        from (
          select c.type::text as type, count(*) as n
          from public.calendar_entries c
          where c.area_id = v_area and c.entry_date = current_date
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

revoke all on function public.my_dashboard_summary() from public, anon;
grant execute on function public.my_dashboard_summary() to authenticated;
