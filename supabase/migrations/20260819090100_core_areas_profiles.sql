-- ===========================================================================
-- ChamaHub - 02. Aree aziendali e anagrafica dipendenti
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Aree
-- ---------------------------------------------------------------------------
create table public.areas (
  id          uuid primary key default extensions.gen_random_uuid(),
  name        text not null,
  description text,
  color       text not null default '#1976d2',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint areas_name_not_blank check (length(btrim(name)) > 0)
);

create unique index areas_name_key on public.areas (lower(btrim(name)));

create trigger areas_set_updated_at
  before update on public.areas
  for each row execute function public.set_updated_at();

comment on table public.areas is 'Aree / reparti aziendali. Ogni dipendente appartiene al massimo a una area.';

-- ---------------------------------------------------------------------------
-- Profili (anagrafica applicativa, 1:1 con auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text not null default '',
  role       public.user_role not null default 'employee',
  area_id    uuid references public.areas (id) on delete set null,
  job_title  text,
  phone      text,
  hired_on   date,
  -- Un profilo non attivo esiste ma non puo' operare: e' lo stato in cui
  -- finisce chi accede con Microsoft senza essere stato creato dall'HR.
  is_active  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_key on public.profiles (lower(email));
create index profiles_area_id_idx on public.profiles (area_id);
create index profiles_role_idx on public.profiles (role);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

comment on table public.profiles is 'Anagrafica applicativa dei dipendenti, in relazione 1:1 con auth.users.';
comment on column public.profiles.is_active is
  'false = account creato ma non ancora abilitato dall''HR. Le policy RLS negano ogni operazione.';

-- ---------------------------------------------------------------------------
-- Creazione automatica del profilo alla registrazione di un utente
-- ---------------------------------------------------------------------------
-- Viene eseguita sia quando l'HR crea un dipendente tramite Edge Function sia
-- quando un utente accede per la prima volta con Microsoft Entra ID. Nel primo
-- caso la Edge Function completa subito il profilo (ruolo, area, is_active);
-- nel secondo il profilo resta in attesa di attivazione da parte dell'HR.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, is_active)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    false
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Mantiene allineata l'email del profilo con quella di autenticazione.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- Helper per le policy RLS
-- ---------------------------------------------------------------------------
-- Tutte SECURITY DEFINER e STABLE: leggono public.profiles bypassando le sue
-- policy, evitando la ricorsione infinita che si otterrebbe interrogando
-- profiles dall'interno di una policy su profiles.

create or replace function public.current_role_name()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid()) and p.is_active
$$;

create or replace function public.current_area_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.area_id
  from public.profiles p
  where p.id = (select auth.uid()) and p.is_active
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  )
$$;

create or replace function public.is_hr()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active and p.role = 'hr'
  )
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active and p.role = 'manager'
  )
$$;

-- Area di appartenenza di un profilo qualsiasi (usata dalle policy che devono
-- risalire dall'oggetto al reparto del suo proprietario).
create or replace function public.area_of(p_profile uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.area_id from public.profiles p where p.id = p_profile
$$;

-- true se l'utente corrente e' responsabile dell'area a cui appartiene il
-- profilo indicato (oppure se e' il profilo stesso).
create or replace function public.manages_profile(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles me
    join public.profiles target on target.id = p_profile
    where me.id = (select auth.uid())
      and me.is_active
      and me.role = 'manager'
      and me.area_id is not null
      and me.area_id = target.area_id
  )
$$;

-- ---------------------------------------------------------------------------
-- RLS: areas
-- ---------------------------------------------------------------------------
alter table public.areas enable row level security;

-- Tutti gli utenti attivi devono poter leggere l'elenco delle aree (serve per
-- mostrare il reparto dei colleghi, filtrare i calendari, ecc.).
create policy "areas_select_active_users"
  on public.areas for select
  to authenticated
  using (public.is_active_user());

create policy "areas_insert_hr"
  on public.areas for insert
  to authenticated
  with check (public.is_hr());

create policy "areas_update_hr"
  on public.areas for update
  to authenticated
  using (public.is_hr())
  with check (public.is_hr());

create policy "areas_delete_hr"
  on public.areas for delete
  to authenticated
  using (public.is_hr());

-- ---------------------------------------------------------------------------
-- RLS: profiles
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

-- Il proprio profilo e' sempre leggibile, anche se non ancora attivato: serve
-- all'applicazione per mostrare la schermata "in attesa di attivazione".
create policy "profiles_select_self"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

-- Un utente attivo vede i colleghi della propria area.
create policy "profiles_select_same_area"
  on public.profiles for select
  to authenticated
  using (
    public.is_active_user()
    and area_id is not null
    and area_id = public.current_area_id()
  );

-- L'HR vede tutta l'anagrafica.
create policy "profiles_select_hr"
  on public.profiles for select
  to authenticated
  using (public.is_hr());

-- Ognuno puo' aggiornare solo i propri campi anagrafici "morbidi".
-- Ruolo, area e attivazione sono protetti dal trigger qui sotto.
create policy "profiles_update_self"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "profiles_update_hr"
  on public.profiles for update
  to authenticated
  using (public.is_hr())
  with check (public.is_hr());

-- Nessuna policy di INSERT/DELETE: i profili nascono dal trigger su auth.users
-- e vengono rimossi dalla Edge Function `admin-users` (service_role).

-- Impedisce a un utente non HR di auto-promuoversi modificando il proprio
-- ruolo, la propria area o il flag di attivazione.
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Il ruolo service_role (Edge Function) e i job interni non sono soggetti al
  -- controllo: auth.uid() e' NULL in quel contesto.
  if (select auth.uid()) is null then
    return new;
  end if;

  if public.is_hr() then
    -- Un HR non puo' comunque togliersi da solo il ruolo HR o disattivarsi,
    -- per evitare di restare senza amministratori.
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

create trigger profiles_protect_privileges
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();
