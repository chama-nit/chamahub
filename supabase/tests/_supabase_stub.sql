-- ===========================================================================
-- Stub locale dell'ambiente Supabase
-- ===========================================================================
-- Ricrea il minimo indispensabile (ruoli, schema auth, auth.uid()) per poter
-- applicare e collaudare le migrazioni su un PostgreSQL vuoto, senza Docker.
-- NON viene mai eseguito sul progetto reale: su Supabase questi oggetti
-- esistono gia'.
-- ===========================================================================

create schema if not exists extensions;
create schema if not exists auth;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

-- Sottoinsieme delle colonne reali di auth.users: quelle usate dai trigger e
-- dallo script di creazione dell'amministratore.
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  instance_id        uuid,
  aud                text,
  role               text,
  email              text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists auth.identities (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  provider_id     text not null,
  identity_data   jsonb not null,
  provider        text not null,
  last_sign_in_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Su Supabase auth.uid() legge il claim `sub` del JWT. In locale lo simuliamo
-- con una variabile di sessione impostabile da psql.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

-- ---------------------------------------------------------------------------
-- Sessioni
-- ---------------------------------------------------------------------------
-- Sottoinsieme delle colonne reali. Servono a collaudare la chiusura delle
-- sessioni della modalita' manutenzione: senza queste tabelle la funzione si
-- comporta correttamente (non trova niente da chiudere) ma non si potrebbe
-- verificare che chiude le cose giuste.
create table if not exists auth.sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists auth.refresh_tokens (
  id         bigserial primary key,
  session_id uuid references auth.sessions (id) on delete cascade,
  token      text,
  revoked    boolean not null default false
);
