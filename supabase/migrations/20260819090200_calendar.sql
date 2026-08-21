-- ===========================================================================
-- ChamaHub - 03. Calendario presenze / smart working / assenze
-- ===========================================================================
-- Modello scelto: pura comunicazione, nessun flusso di approvazione.
-- Il dipendente dichiara la propria giornata; responsabile e HR consultano.
-- ===========================================================================

create table public.calendar_entries (
  id           uuid primary key default extensions.gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  -- Snapshot dell'area al momento della comunicazione: rende le policy RLS
  -- indipendenti da eventuali spostamenti successivi del dipendente e
  -- mantiene coerente lo storico dei calendari.
  area_id      uuid references public.areas (id) on delete set null,
  entry_date   date not null,
  period       public.day_period not null default 'full_day',
  type         public.attendance_type not null,
  absence_kind public.absence_kind,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint calendar_entries_unique_slot unique (profile_id, entry_date, period),
  -- absence_kind ha senso solo per le assenze ed e' obbligatorio in quel caso.
  constraint calendar_entries_absence_kind_coherent check (
    (type = 'absence' and absence_kind is not null)
    or (type <> 'absence' and absence_kind is null)
  ),
  constraint calendar_entries_note_length check (note is null or length(note) <= 500)
);

create index calendar_entries_profile_date_idx
  on public.calendar_entries (profile_id, entry_date);
create index calendar_entries_area_date_idx
  on public.calendar_entries (area_id, entry_date);
create index calendar_entries_date_idx
  on public.calendar_entries (entry_date);

create trigger calendar_entries_set_updated_at
  before update on public.calendar_entries
  for each row execute function public.set_updated_at();

comment on table public.calendar_entries is
  'Comunicazioni di presenza in ufficio, smart working o assenza. Nessuna approvazione richiesta.';

-- ---------------------------------------------------------------------------
-- Coerenza dei periodi e valorizzazione automatica di area_id
-- ---------------------------------------------------------------------------
create or replace function public.calendar_entries_normalize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- L'area viene sempre ricalcolata dal profilo: il client non puo' falsarla.
  new.area_id := public.area_of(new.profile_id);

  if new.period = 'full_day' then
    -- Una giornata intera sostituisce eventuali mezze giornate gia' inserite.
    delete from public.calendar_entries
    where profile_id = new.profile_id
      and entry_date = new.entry_date
      and period <> 'full_day'
      and (tg_op = 'INSERT' or id <> new.id);
  else
    -- Una mezza giornata sostituisce l'eventuale giornata intera.
    delete from public.calendar_entries
    where profile_id = new.profile_id
      and entry_date = new.entry_date
      and period = 'full_day'
      and (tg_op = 'INSERT' or id <> new.id);
  end if;

  return new;
end;
$$;

create trigger calendar_entries_normalize
  before insert or update on public.calendar_entries
  for each row execute function public.calendar_entries_normalize();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.calendar_entries enable row level security;

-- Il dipendente gestisce esclusivamente le proprie giornate.
create policy "calendar_select_self"
  on public.calendar_entries for select
  to authenticated
  using (profile_id = (select auth.uid()));

create policy "calendar_insert_self"
  on public.calendar_entries for insert
  to authenticated
  with check (profile_id = (select auth.uid()) and public.is_active_user());

create policy "calendar_update_self"
  on public.calendar_entries for update
  to authenticated
  using (profile_id = (select auth.uid()) and public.is_active_user())
  with check (profile_id = (select auth.uid()));

create policy "calendar_delete_self"
  on public.calendar_entries for delete
  to authenticated
  using (profile_id = (select auth.uid()) and public.is_active_user());

-- Il responsabile vede (sola lettura) tutte le giornate della propria area.
create policy "calendar_select_area_manager"
  on public.calendar_entries for select
  to authenticated
  using (
    public.is_manager()
    and area_id is not null
    and area_id = public.current_area_id()
  );

-- L'HR vede e gestisce l'intero calendario aziendale.
create policy "calendar_select_hr"
  on public.calendar_entries for select
  to authenticated
  using (public.is_hr());

create policy "calendar_insert_hr"
  on public.calendar_entries for insert
  to authenticated
  with check (public.is_hr());

create policy "calendar_update_hr"
  on public.calendar_entries for update
  to authenticated
  using (public.is_hr())
  with check (public.is_hr());

create policy "calendar_delete_hr"
  on public.calendar_entries for delete
  to authenticated
  using (public.is_hr());
