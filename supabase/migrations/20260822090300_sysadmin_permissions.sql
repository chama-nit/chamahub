-- ===========================================================================
-- ChamaHub - 15. Il ruolo SystemAdmin
-- ===========================================================================
-- Sopra l'HR c'e' un solo ruolo: `sysadmin`. Serve a chi tiene in piedi
-- l'applicazione, non a chi ci lavora dentro.
--
-- Cosa puo' fare:
--   * tutto quello che puo' fare l'HR (le policy esistenti passano da
--     `is_hr()`, che d'ora in poi risponde "si'" anche al sysadmin);
--   * nominare e revocare altri sysadmin;
--   * impersonare una persona per vedere l'applicazione con i suoi occhi
--     (Edge Function `impersonate`, con registro degli accessi qui sotto).
--
-- Cosa NON puo' fare nessun altro:
--   * l'HR non puo' creare un sysadmin, ne' modificare o disattivare il
--     profilo di un sysadmin. Il primo sysadmin nasce da qui, cioe' da chi ha
--     accesso al database: e' l'unico modo per non trasformare il ruolo di
--     amministrazione in una scala che si sale da soli.
--
-- Il gradimento resta fuori portata anche per il sysadmin: le tabelle grezze
-- non sono leggibili da nessun ruolo applicativo, e questa migrazione non
-- cambia quella regola.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Helper
-- ---------------------------------------------------------------------------
create or replace function public.is_sysadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active and p.role = 'sysadmin'
  )
$$;

-- `is_hr()` diventa "ha i poteri dell'HR": cosi' tutte le policy gia' scritte
-- valgono anche per il sysadmin, senza doverle riscrivere una per una.
create or replace function public.is_hr()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active
      and p.role in ('hr', 'sysadmin')
  )
$$;

comment on function public.is_hr() is
  'Vero per il reparto HR e per il sysadmin, che ne eredita i permessi. Per distinguerli usare public.is_sysadmin().';

-- ---------------------------------------------------------------------------
-- Protezione dei privilegi
-- ---------------------------------------------------------------------------
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- service_role (Edge Function) e job interni: auth.uid() e' NULL.
  if (select auth.uid()) is null then
    return new;
  end if;

  if public.is_sysadmin() then
    -- Nemmeno il sysadmin puo' togliersi da solo il ruolo o disattivarsi:
    -- resterebbe un'applicazione senza nessuno che possa rimetterlo a posto,
    -- se non aprendo il database.
    if new.id = (select auth.uid())
       and (new.role <> old.role or new.is_active <> old.is_active) then
      raise exception 'Un SystemAdmin non puo'' modificare il proprio ruolo o disattivarsi.';
    end if;
    return new;
  end if;

  if public.is_hr() then
    if old.role = 'sysadmin' or new.role = 'sysadmin' then
      raise exception 'Il ruolo SystemAdmin puo'' essere assegnato o modificato solo da un altro SystemAdmin.';
    end if;

    if new.id = (select auth.uid())
       and (new.role <> old.role or new.is_active <> old.is_active) then
      raise exception 'Un utente HR non puo'' modificare il proprio ruolo o disattivarsi.';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role
     or new.area_id is distinct from old.area_id
     or new.is_active is distinct from old.is_active
     or new.id is distinct from old.id then
    raise exception 'Solo il reparto HR puo'' modificare ruolo, area o stato di un profilo.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Registro delle impersonificazioni
-- ---------------------------------------------------------------------------
-- Entrare nei panni di un'altra persona e' un potere forte: deve lasciare una
-- riga. La scrive la Edge Function con `service_role`; nessun ruolo
-- applicativo puo' inserirla o cancellarla, e solo il sysadmin la legge.
create table if not exists public.impersonation_log (
  id         uuid primary key default extensions.gen_random_uuid(),
  actor_id   uuid not null references public.profiles (id) on delete cascade,
  target_id  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists impersonation_log_actor_idx
  on public.impersonation_log (actor_id, created_at desc);

alter table public.impersonation_log enable row level security;

drop policy if exists "impersonation_log_select_sysadmin" on public.impersonation_log;
create policy "impersonation_log_select_sysadmin"
  on public.impersonation_log for select
  to authenticated
  using (public.is_sysadmin());

-- ---------------------------------------------------------------------------
-- Richieste: nemmeno il sysadmin ne apre
-- ---------------------------------------------------------------------------
-- Vale lo stesso ragionamento fatto per l'HR nella migrazione 11: chi legge le
-- richieste indirizzate al reparto non ha senso che se le scriva da solo.
drop policy if exists "requests_insert_own" on public.requests;
create policy "requests_insert_own"
  on public.requests for insert
  to authenticated
  with check (
    requester_id = (select auth.uid())
    and public.is_active_user()
    and public.current_role_name() not in ('hr', 'sysadmin')
  );

-- ---------------------------------------------------------------------------
-- Il primo sysadmin non nasce dall'applicazione
-- ---------------------------------------------------------------------------
-- Va promosso a mano, con l'utente gia' creato dall'HR o dalla pagina di
-- accesso. Lo script pronto sta in supabase/scripts/03_crea_systemadmin.sql:
--
--   update public.profiles set role = 'sysadmin', is_active = true
--   where email = 'nome.cognome@azienda.it';
