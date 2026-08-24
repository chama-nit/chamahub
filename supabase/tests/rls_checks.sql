-- ===========================================================================
-- ChamaHub - collaudo delle policy RLS
-- ===========================================================================
-- Da eseguire su un database in cui siano gia' state applicate _supabase_stub
-- e tutte le migrazioni:
--
--   psql -d chamatest -f supabase/tests/rls_checks.sql
--
-- Ogni blocco stampa PASS o solleva un'eccezione. Verifica che ciascun ruolo
-- veda e possa modificare esclusivamente cio' che gli compete.
-- ===========================================================================

\set ON_ERROR_STOP on
\set QUIET on

-- Su Supabase questi grant sono applicati automaticamente dalle default
-- privileges del progetto; in locale vanno riprodotti a mano.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
revoke all on public.satisfaction_submissions from anon, authenticated;
revoke all on public.satisfaction_answers from anon, authenticated;
revoke all on public.satisfaction_throttle from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Dati di prova
-- ---------------------------------------------------------------------------
-- NB: mai TRUNCATE ... CASCADE su auth.users: si propagherebbe a tutte le
-- tabelle che referenziano profiles, azzerando anche modelli e questionari.
delete from auth.users;
delete from public.areas;

-- La finestra di primo avvio va chiusa esplicitamente, altrimenti il primo
-- utente inserito qui sotto verrebbe promosso a HR dal trigger e i controlli
-- non partirebbero dallo stato voluto. Il primo avvio ha una suite dedicata in
-- bootstrap_checks.sql.
update public.app_settings set value = 'false'::jsonb
where key = 'bootstrap_first_admin';

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'hr@example.com',   '{"full_name":"Hilary Rossi"}'),
  ('22222222-2222-2222-2222-222222222222', 'mgr@example.com',  '{"full_name":"Marco Gestori"}'),
  ('33333333-3333-3333-3333-333333333333', 'emp1@example.com', '{"full_name":"Elisa Uno"}'),
  ('44444444-4444-4444-4444-444444444444', 'emp2@example.com', '{"full_name":"Enrico Due"}'),
  ('55555555-5555-5555-5555-555555555555', 'new@example.com',  '{"full_name":"Nuovo Arrivato"}'),
  ('66666666-6666-6666-6666-666666666666', 'root@example.com', '{"full_name":"Sara Sistemi"}');

insert into public.areas (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Sviluppo'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Amministrazione');

update public.profiles set role = 'hr', is_active = true
  where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set role = 'manager', is_active = true,
  area_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set is_active = true,
  area_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  where id = '33333333-3333-3333-3333-333333333333';
update public.profiles set is_active = true,
  area_id = 'aaaaaaaa-0000-0000-0000-000000000002'
  where id = '44444444-4444-4444-4444-444444444444';
update public.profiles set role = 'sysadmin', is_active = true
  where id = '66666666-6666-6666-6666-666666666666';
-- '55555555' resta is_active = false: simula il primo accesso Microsoft di
-- una persona non ancora censita dall'HR.

-- ---------------------------------------------------------------------------
-- Helper di asserzione
-- ---------------------------------------------------------------------------
create or replace function pg_temp.assert(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_condition then
    raise notice 'PASS  %', p_label;
  else
    raise exception 'FAIL  %', p_label;
  end if;
end $$;

create or replace function pg_temp.expect_error(p_sql text, p_label text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'PASS  % (bloccato: %)', p_label, left(sqlerrm, 60);
    return;
  end;
  raise exception 'FAIL  % - l''operazione avrebbe dovuto essere rifiutata', p_label;
end $$;

\set QUIET off

-- ===========================================================================
-- 1. Calendario
-- ===========================================================================
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

  insert into public.calendar_entries (profile_id, entry_date, type)
  values ('33333333-3333-3333-3333-333333333333', current_date, 'smart_working');

  select pg_temp.assert(
    (select area_id from public.calendar_entries
      where profile_id = '33333333-3333-3333-3333-333333333333')
      = 'aaaaaaaa-0000-0000-0000-000000000001',
    'calendario: area_id valorizzata automaticamente dal trigger');

  select pg_temp.expect_error(
    $q$insert into public.calendar_entries (profile_id, entry_date, type)
       values ('44444444-4444-4444-4444-444444444444', current_date, 'office')$q$,
    'calendario: un dipendente non puo'' inserire giornate per un collega');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
  insert into public.calendar_entries (profile_id, entry_date, type, absence_kind)
  values ('44444444-4444-4444-4444-444444444444', current_date, 'absence', 'vacation');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
  select pg_temp.assert(
    (select count(*) from public.calendar_entries) = 1,
    'calendario: il responsabile vede solo la propria area');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  select pg_temp.assert(
    (select count(*) from public.calendar_entries) = 2,
    'calendario: l''HR vede tutta l''azienda');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
  select pg_temp.assert(
    (select count(*) from public.calendar_entries) = 0,
    'calendario: un account non ancora attivato non vede nulla');
  select pg_temp.expect_error(
    $q$insert into public.calendar_entries (profile_id, entry_date, type)
       values ('55555555-5555-5555-5555-555555555555', current_date, 'office')$q$,
    'calendario: un account non attivato non puo'' scrivere');
commit;

-- Sostituzione giornata intera / mezze giornate
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
  insert into public.calendar_entries (profile_id, entry_date, period, type)
  values ('33333333-3333-3333-3333-333333333333', current_date + 1, 'morning', 'office');
  insert into public.calendar_entries (profile_id, entry_date, period, type)
  values ('33333333-3333-3333-3333-333333333333', current_date + 1, 'afternoon', 'smart_working');
  select pg_temp.assert(
    (select count(*) from public.calendar_entries
      where entry_date = current_date + 1) = 2,
    'calendario: mattina e pomeriggio convivono');

  insert into public.calendar_entries (profile_id, entry_date, period, type)
  values ('33333333-3333-3333-3333-333333333333', current_date + 1, 'full_day', 'office');
  select pg_temp.assert(
    (select count(*) from public.calendar_entries
      where entry_date = current_date + 1) = 1,
    'calendario: la giornata intera sostituisce le mezze giornate');
commit;

-- ===========================================================================
-- 2. Escalation di privilegi
-- ===========================================================================
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
  select pg_temp.expect_error(
    $q$update public.profiles set role = 'hr'
       where id = '33333333-3333-3333-3333-333333333333'$q$,
    'profili: un dipendente non puo'' promuoversi a HR');
  select pg_temp.expect_error(
    $q$update public.profiles set area_id = 'aaaaaaaa-0000-0000-0000-000000000002'
       where id = '33333333-3333-3333-3333-333333333333'$q$,
    'profili: un dipendente non puo'' cambiarsi area');

  update public.profiles set phone = '+39 000 0000000'
  where id = '33333333-3333-3333-3333-333333333333';
  select pg_temp.assert(true, 'profili: il dipendente puo'' aggiornare i propri recapiti');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
  -- La policy di UPDATE consente solo il proprio profilo: l'istruzione non
  -- solleva un errore, semplicemente non trova righe su cui agire.
  update public.profiles set role = 'hr'
  where id = '33333333-3333-3333-3333-333333333333';
  select pg_temp.assert(
    (select role from public.profiles where id = '33333333-3333-3333-3333-333333333333')
      = 'employee',
    'profili: un responsabile non puo'' cambiare il ruolo dei collaboratori');
  select pg_temp.assert(
    (select count(*) from public.profiles) = 2,
    'profili: il responsabile vede se stesso e i collaboratori della sua area');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  update public.profiles set role = 'manager'
  where id = '33333333-3333-3333-3333-333333333333';
  select pg_temp.assert(
    (select role from public.profiles where id = '33333333-3333-3333-3333-333333333333')
      = 'manager',
    'profili: l''HR puo'' nominare un responsabile');
  update public.profiles set role = 'employee'
  where id = '33333333-3333-3333-3333-333333333333';

  select pg_temp.expect_error(
    $q$update public.profiles set role = 'employee'
       where id = '11111111-1111-1111-1111-111111111111'$q$,
    'profili: un HR non puo'' revocare il proprio stesso ruolo');
commit;

-- ===========================================================================
-- 3. Richieste
-- ===========================================================================
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
  insert into public.requests (requester_id, recipient, category, subject, body)
  values ('33333333-3333-3333-3333-333333333333', 'manager', 'vacation',
          'Ferie di agosto', 'Vorrei prendere due settimane.');
  insert into public.requests (requester_id, recipient, category, subject, body)
  values ('33333333-3333-3333-3333-333333333333', 'hr', 'administrative',
          'Certificato di servizio', 'Mi servirebbe per la banca.');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
  select pg_temp.assert(
    (select count(*) from public.requests) = 0,
    'richieste: un collega di un''altra area non vede nulla');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
  select pg_temp.assert(
    (select count(*) from public.requests) = 1,
    'richieste: il responsabile vede solo quelle indirizzate a lui');
  update public.requests set status = 'closed', resolution = 'Approvato'
  where recipient = 'manager';
  select pg_temp.assert(
    (select closed_at is not null from public.requests where recipient = 'manager'),
    'richieste: closed_at valorizzato automaticamente alla chiusura');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  select pg_temp.assert(
    (select count(*) from public.requests) = 2,
    'richieste: l''HR vede tutte le richieste');

  -- L'HR e' il destinatario delle richieste, non un mittente: una richiesta
  -- dell'HR all'HR arriverebbe a se' stessa.
  select pg_temp.expect_error(
    $q$insert into public.requests (requester_id, recipient, category, subject, body)
       values ('11111111-1111-1111-1111-111111111111', 'hr', 'other',
               'Prova', 'Non deve passare')$q$,
    'richieste: l''HR non puo'' aprire una richiesta all''HR');

  select pg_temp.expect_error(
    $q$insert into public.requests (requester_id, recipient, category, subject, body)
       values ('11111111-1111-1111-1111-111111111111', 'manager', 'other',
               'Prova', 'Non deve passare')$q$,
    'richieste: l''HR non puo'' aprire una richiesta al responsabile');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
  -- Il divieto riguarda solo l'HR: per gli altri nulla e' cambiato.
  insert into public.requests (requester_id, recipient, category, subject, body)
  values ('33333333-3333-3333-3333-333333333333', 'hr', 'training',
          'Corso di aggiornamento', 'Vorrei partecipare al corso di ottobre.');
  select pg_temp.assert(
    (select count(*) from public.requests
      where requester_id = '33333333-3333-3333-3333-333333333333') = 3,
    'richieste: un dipendente continua a poterne aprire');
commit;

-- ===========================================================================
-- 4. Valutazioni
-- ===========================================================================
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

  insert into public.evaluation_campaigns (id, name, template_id, ends_on, status)
  select 'cccccccc-0000-0000-0000-000000000001',
         'Valutazione 2026',
         id,
         current_date + 30,
         'open'
  from public.evaluation_templates where target = 'employee' limit 1;

  insert into public.evaluations (id, campaign_id, template_id, subject_id, evaluator_id, area_id, kind)
  select 'dddddddd-0000-0000-0000-000000000001',
         'cccccccc-0000-0000-0000-000000000001',
         c.template_id,
         '33333333-3333-3333-3333-333333333333',
         '22222222-2222-2222-2222-222222222222',
         'aaaaaaaa-0000-0000-0000-000000000001',
         'manager_review'
  from public.evaluation_campaigns c
  where c.id = 'cccccccc-0000-0000-0000-000000000001';
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
  select pg_temp.assert(
    (select count(*) from public.evaluations) = 0,
    'valutazioni: il valutato non vede la scheda finche'' non e'' consegnata');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
  select pg_temp.assert(
    (select count(*) from public.evaluations) = 1,
    'valutazioni: il responsabile vede la scheda da compilare');

  insert into public.evaluation_answers (evaluation_id, question_id, numeric_value)
  select 'dddddddd-0000-0000-0000-000000000001', q.id, 4
  from public.evaluation_questions q
  join public.evaluations e on e.id = 'dddddddd-0000-0000-0000-000000000001'
  where q.template_id = e.template_id and q.type = 'scale';

  select pg_temp.assert(
    (select count(*) from public.evaluation_answers) = 6,
    'valutazioni: il responsabile puo'' salvare le risposte in bozza');

  select pg_temp.expect_error(
    $q$update public.evaluations set status = 'submitted'
       where id = 'dddddddd-0000-0000-0000-000000000001'$q$,
    'valutazioni: la consegna non e'' possibile direttamente dal client');
commit;

-- Consegna eseguita come farebbe la Edge Function (service_role).
begin;
  update public.evaluations
  set status = 'submitted', submitted_at = now(), overall_score = 80
  where id = 'dddddddd-0000-0000-0000-000000000001';
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
  select pg_temp.assert(
    (select count(*) from public.evaluations) = 1,
    'valutazioni: dopo la consegna il valutato vede la propria scheda');
  select pg_temp.assert(
    (select count(*) from public.evaluation_answers) = 6,
    'valutazioni: il valutato vede anche le risposte della scheda consegnata');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
  -- La policy di UPDATE esclude le schede consegnate: l'istruzione non trova
  -- righe su cui agire e nulla viene modificato.
  update public.evaluations set comment = 'ripensamento'
  where id = 'dddddddd-0000-0000-0000-000000000001';
  select pg_temp.assert(
    (select comment is null from public.evaluations
      where id = 'dddddddd-0000-0000-0000-000000000001'),
    'valutazioni: una scheda consegnata non e'' piu'' modificabile');

  select pg_temp.expect_error(
    $q$insert into public.evaluation_answers (evaluation_id, question_id, text_value)
       select 'dddddddd-0000-0000-0000-000000000001', q.id, 'tardivo'
       from public.evaluation_questions q where q.type = 'text' limit 1$q$,
    'valutazioni: non si possono aggiungere risposte a una scheda consegnata');
commit;

-- ===========================================================================
-- 5. Gradimento: anonimato
-- ===========================================================================
-- Compilazioni inserite come farebbe la Edge Function (service_role).
begin;
  insert into public.satisfaction_submissions (id, survey_id, area_id)
  select ('eeeeeeee-0000-0000-0000-00000000000' || g)::uuid, s.id,
         'aaaaaaaa-0000-0000-0000-000000000001'
  from public.satisfaction_surveys s, generate_series(1, 4) g
  where s.name = 'Gradimento del lavoro';

  insert into public.satisfaction_answers (submission_id, question_id, numeric_value)
  select sub.id, q.id, 4
  from public.satisfaction_submissions sub
  join public.satisfaction_questions q on q.survey_id = sub.survey_id
  where q.type = 'scale';
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  select pg_temp.expect_error(
    'select count(*) from public.satisfaction_submissions',
    'gradimento: nemmeno l''HR puo'' leggere le compilazioni grezze');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
  select pg_temp.expect_error(
    'select count(*) from public.satisfaction_answers',
    'gradimento: un dipendente non puo'' leggere le risposte grezze');
  select pg_temp.expect_error(
    'select * from public.satisfaction_kpi_by_area()',
    'gradimento: un dipendente non puo'' accedere ai KPI');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  select pg_temp.assert(
    (select count(*) from public.satisfaction_kpi_by_area()) = 2,
    'gradimento: l''HR ottiene i KPI di tutte le aree');
  select pg_temp.assert(
    (select avg_score from public.satisfaction_kpi_by_area()
      where area_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 4.00,
    'gradimento: media calcolata correttamente sopra la soglia minima');
  select pg_temp.assert(
    (select below_threshold from public.satisfaction_kpi_by_area()
      where area_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
    'gradimento: area senza risposte marcata sotto soglia');
  select pg_temp.assert(
    (select avg_score is null from public.satisfaction_kpi_by_area()
      where area_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
    'gradimento: nessun dato esposto per le aree sotto soglia');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
  select pg_temp.assert(
    (select count(*) from public.satisfaction_kpi_by_area()) = 1,
    'gradimento: il responsabile vede i KPI della sola area di competenza');
commit;

-- ===========================================================================
-- 6. Riepilogo dashboard
-- ===========================================================================
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  select pg_temp.assert(
    (public.my_dashboard_summary() ->> 'role') = 'hr',
    'dashboard: il riepilogo HR viene generato');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
  select pg_temp.assert(
    (public.my_dashboard_summary() ->> 'active') = 'false',
    'dashboard: un account non attivato riceve active = false');
commit;


-- ===========================================================================
-- 7. Autovalutazione del dipendente, correggibile dal responsabile
-- ===========================================================================
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

  insert into public.evaluations
    (id, campaign_id, template_id, subject_id, evaluator_id, area_id, kind)
  select 'dddddddd-0000-0000-0000-000000000002',
         'cccccccc-0000-0000-0000-000000000001',
         t.id,
         '33333333-3333-3333-3333-333333333333',
         '33333333-3333-3333-3333-333333333333',
         'aaaaaaaa-0000-0000-0000-000000000001',
         'self_assessment'
  from public.evaluation_templates t where t.target = 'self' limit 1;
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
  select pg_temp.assert(
    (select count(*) from public.evaluations
      where id = 'dddddddd-0000-0000-0000-000000000002') = 1,
    'autovalutazione: il dipendente vede la propria scheda da compilare');

  insert into public.evaluation_answers (evaluation_id, question_id, numeric_value)
  select 'dddddddd-0000-0000-0000-000000000002', q.id, 3
  from public.evaluation_questions q
  join public.evaluations e on e.id = 'dddddddd-0000-0000-0000-000000000002'
  where q.template_id = e.template_id and q.type = 'scale';

  select pg_temp.assert(
    (select count(*) from public.evaluation_answers
      where evaluation_id = 'dddddddd-0000-0000-0000-000000000002') > 0,
    'autovalutazione: il dipendente puo'' compilarla');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
  select pg_temp.assert(
    (select count(*) from public.evaluations
      where id = 'dddddddd-0000-0000-0000-000000000002') = 1,
    'autovalutazione: il responsabile d''area la vede');

  update public.evaluation_answers
  set numeric_value = 5
  where evaluation_id = 'dddddddd-0000-0000-0000-000000000002'
    and numeric_value = 3;

  select pg_temp.assert(
    (select corrected_by from public.evaluations
      where id = 'dddddddd-0000-0000-0000-000000000002')
      = '22222222-2222-2222-2222-222222222222',
    'autovalutazione: la correzione del responsabile lascia traccia');
commit;

-- Un responsabile di un'ALTRA area non deve poterci mettere mano.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  update public.profiles set role = 'manager', area_id = 'aaaaaaaa-0000-0000-0000-000000000002'
  where id = '44444444-4444-4444-4444-444444444444';
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
  select pg_temp.assert(
    (select count(*) from public.evaluations
      where id = 'dddddddd-0000-0000-0000-000000000002') = 0,
    'autovalutazione: un responsabile di altra area non la vede');

  update public.evaluation_answers
  set numeric_value = 1
  where evaluation_id = 'dddddddd-0000-0000-0000-000000000002';

  select pg_temp.assert(
    (select count(*) from public.evaluation_answers
      where evaluation_id = 'dddddddd-0000-0000-0000-000000000002'
        and numeric_value = 1) = 0,
    'autovalutazione: un responsabile di altra area non puo'' correggerla');
commit;

-- Nemmeno un collega dipendente della stessa area.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  update public.profiles set role = 'employee', area_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  where id = '44444444-4444-4444-4444-444444444444';
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
  select pg_temp.assert(
    (select count(*) from public.evaluations
      where id = 'dddddddd-0000-0000-0000-000000000002') = 0,
    'autovalutazione: un collega della stessa area non la vede');
commit;

-- ===========================================================================
-- 7. Campagne: modifica e cancellazione solo in bozza
-- ===========================================================================
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

  insert into public.evaluation_campaigns (id, name, template_id, ends_on, status)
  select 'cccccccc-0000-0000-0000-000000000002',
         'Bozza da modificare',
         t.id,
         current_date + 30,
         'draft'
  from public.evaluation_templates t where t.target = 'employee' limit 1;

  update public.evaluation_campaigns
  set name = 'Bozza rinominata', ends_on = current_date + 45
  where id = 'cccccccc-0000-0000-0000-000000000002';

  select pg_temp.assert(
    (select name from public.evaluation_campaigns
      where id = 'cccccccc-0000-0000-0000-000000000002') = 'Bozza rinominata',
    'campagne: una bozza si modifica');

  select pg_temp.expect_error(
    $q$update public.evaluation_campaigns set status = 'open'
       where id = 'cccccccc-0000-0000-0000-000000000002'$q$,
    'campagne: lo stato non si cambia a mano dal client');

  delete from public.evaluation_campaigns
  where id = 'cccccccc-0000-0000-0000-000000000002';

  select pg_temp.assert(
    (select count(*) from public.evaluation_campaigns
      where id = 'cccccccc-0000-0000-0000-000000000002') = 0,
    'campagne: una bozza si cancella');
commit;

-- La campagna 'cccccccc-0000-0000-0000-000000000001' e' stata aperta dai
-- controlli precedenti: da qui in poi e' intoccabile.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

  select pg_temp.expect_error(
    $q$update public.evaluation_campaigns set name = 'Cambio proibito'
       where id = 'cccccccc-0000-0000-0000-000000000001'$q$,
    'campagne: una campagna aperta non si modifica');

  select pg_temp.expect_error(
    $q$delete from public.evaluation_campaigns
       where id = 'cccccccc-0000-0000-0000-000000000001'$q$,
    'campagne: una campagna aperta non si cancella');
commit;

-- ===========================================================================
-- 8. SystemAdmin
-- ===========================================================================
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';

  select pg_temp.assert(
    public.is_sysadmin() and public.is_hr(),
    'sysadmin: eredita i permessi dell''HR');

  select pg_temp.assert(
    (select count(*) from public.profiles) >= 6,
    'sysadmin: vede tutta l''anagrafica');

  select pg_temp.expect_error(
    $q$update public.profiles set role = 'employee'
       where id = '66666666-6666-6666-6666-666666666666'$q$,
    'sysadmin: non puo'' togliersi il ruolo da solo');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

  select pg_temp.expect_error(
    $q$update public.profiles set role = 'sysadmin'
       where id = '33333333-3333-3333-3333-333333333333'$q$,
    'sysadmin: l''HR non puo'' nominarne uno');

  select pg_temp.expect_error(
    $q$update public.profiles set is_active = false
       where id = '66666666-6666-6666-6666-666666666666'$q$,
    'sysadmin: l''HR non puo'' disattivarlo');
commit;

-- Il registro delle impersonificazioni e' riservato al sysadmin.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
  select pg_temp.assert(
    (select count(*) from public.impersonation_log) = 0,
    'sysadmin: il registro non e'' leggibile dall''HR');
commit;

-- Richieste: nemmeno il sysadmin ne apre.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
  select pg_temp.expect_error(
    $q$insert into public.requests (requester_id, recipient, category, subject, body)
       values ('66666666-6666-6666-6666-666666666666', 'hr', 'other',
               'Prova', 'Non deve passare')$q$,
    'richieste: il sysadmin non puo'' aprirne');
commit;

-- ===========================================================================
-- 9. Punteggio prima e dopo la correzione
-- ===========================================================================
-- La scheda viene consegnata con risposte basse, poi il responsabile le alza:
-- il punteggio attuale deve salire e quello originale restare fermo.
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

  insert into public.evaluations
    (id, campaign_id, template_id, subject_id, evaluator_id, area_id, kind)
  select 'dddddddd-0000-0000-0000-000000000003',
         'cccccccc-0000-0000-0000-000000000001',
         t.id,
         '44444444-4444-4444-4444-444444444444',
         '44444444-4444-4444-4444-444444444444',
         'aaaaaaaa-0000-0000-0000-000000000001',
         'self_assessment'
  from public.evaluation_templates t where t.target = 'self' limit 1;
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
  insert into public.evaluation_answers (evaluation_id, question_id, numeric_value)
  select 'dddddddd-0000-0000-0000-000000000003', q.id, q.scale_min
  from public.evaluation_questions q
  join public.evaluations e on e.id = 'dddddddd-0000-0000-0000-000000000003'
  where q.template_id = e.template_id and q.type = 'scale';
commit;

-- Consegna: la fa la Edge Function con service_role, qui si riproduce lo
-- stesso contesto (nessun auth.uid()).
begin;
  reset role;
  update public.evaluations
  set status = 'submitted',
      submitted_at = now(),
      overall_score = public.evaluation_score('dddddddd-0000-0000-0000-000000000003')
  where id = 'dddddddd-0000-0000-0000-000000000003';

  select pg_temp.assert(
    (select overall_score from public.evaluations
      where id = 'dddddddd-0000-0000-0000-000000000003') = 0,
    'punteggio: risposte al minimo della scala valgono zero');
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

  update public.evaluation_answers a
  set numeric_value = q.scale_max
  from public.evaluation_questions q
  where q.id = a.question_id
    and a.evaluation_id = 'dddddddd-0000-0000-0000-000000000003';

  select pg_temp.assert(
    (select original_score from public.evaluations
      where id = 'dddddddd-0000-0000-0000-000000000003') = 0,
    'punteggio: la correzione conserva quello originale');

  select pg_temp.assert(
    (select overall_score from public.evaluations
      where id = 'dddddddd-0000-0000-0000-000000000003') = 100,
    'punteggio: la correzione ricalcola quello attuale');

  select pg_temp.assert(
    (select corrected_by from public.evaluations
      where id = 'dddddddd-0000-0000-0000-000000000003')
      = '22222222-2222-2222-2222-222222222222',
    'punteggio: resta registrato chi ha corretto');
commit;

\echo ''
\echo '================================================='
\echo ' Tutti i controlli RLS sono stati superati.'
\echo '================================================='
