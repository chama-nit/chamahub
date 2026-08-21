-- ===========================================================================
-- ChamaHub - collaudo del primo avvio
-- ===========================================================================
-- Da eseguire su un database appena migrato e vuoto:
--
--   psql -d chamatest -f supabase/tests/bootstrap_checks.sql
--
-- Verifica che la finestra di primo avvio si apra una sola volta e che non
-- possa essere riaperta da chi non e' HR.
-- ===========================================================================

\set ON_ERROR_STOP on
\set QUIET on

grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to anon, authenticated;
revoke all on public.satisfaction_submissions from anon, authenticated;
revoke all on public.satisfaction_answers from anon, authenticated;
revoke all on public.satisfaction_throttle from anon, authenticated;

create or replace function pg_temp.assert(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_condition then
    raise notice 'PASS  %', p_label;
  else
    raise exception 'FAIL  %', p_label;
  end if;
end $$;

-- Stato di partenza: database vuoto, finestra aperta.
delete from auth.users;
update public.app_settings set value = 'true'::jsonb where key = 'bootstrap_first_admin';

\set QUIET off

select pg_temp.assert(
  public.needs_bootstrap(),
  'primo avvio: con database vuoto la finestra risulta aperta');

-- ---------------------------------------------------------------------------
-- Il primo account registrato diventa HR attivo
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data)
values ('aaaa0000-0000-0000-0000-000000000001', 'fondatore@example.com',
        '{"full_name":"Prima Persona"}');

select pg_temp.assert(
  (select role = 'hr' and is_active
   from public.profiles
   where email = 'fondatore@example.com'),
  'primo avvio: il primo account diventa HR attivo');

select pg_temp.assert(
  not public.needs_bootstrap(),
  'primo avvio: la finestra si richiude subito dopo');

-- ---------------------------------------------------------------------------
-- Il secondo account NON viene promosso
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data)
values ('aaaa0000-0000-0000-0000-000000000002', 'secondo@example.com',
        '{"full_name":"Seconda Persona"}');

select pg_temp.assert(
  (select role = 'employee' and not is_active
   from public.profiles
   where email = 'secondo@example.com'),
  'primo avvio: il secondo account resta dipendente in attesa di attivazione');

-- ---------------------------------------------------------------------------
-- La finestra non e' riapribile da un utente non HR
-- ---------------------------------------------------------------------------
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-000000000002';

  update public.app_settings
  set value = 'true'::jsonb
  where key = 'bootstrap_first_admin';

  select pg_temp.assert(
    not public.needs_bootstrap(),
    'primo avvio: un dipendente non puo'' riaprire la finestra');
commit;

-- Anche l'HR, riaprendola, non ottiene nulla finche' esistono profili.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = 'aaaa0000-0000-0000-0000-000000000001';

  update public.app_settings
  set value = 'true'::jsonb
  where key = 'bootstrap_first_admin';

  select pg_temp.assert(
    not public.needs_bootstrap(),
    'primo avvio: con profili gia'' presenti la finestra resta chiusa comunque');
rollback;

-- ---------------------------------------------------------------------------
-- Lo script dell'amministratore e' idempotente
-- ---------------------------------------------------------------------------
select pg_temp.assert(
  (select count(*) from public.profiles where role = 'hr') = 1,
  'primo avvio: esiste esattamente un HR dopo il bootstrap');

\echo ''
\echo '================================================='
\echo ' Controlli sul primo avvio superati.'
\echo '================================================='
