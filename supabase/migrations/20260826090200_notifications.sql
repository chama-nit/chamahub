-- ===========================================================================
-- ChamaHub - 21. Notifiche in applicazione
-- ===========================================================================
-- Cosa notifica, e a chi
-- ----------------------
--   * apertura e chiusura di una richiesta   -> ai responsabili delle aree
--     coinvolte (o all'HR), e alla chiusura anche a chi l'aveva aperta;
--   * ogni messaggio in una conversazione    -> a tutti gli altri
--     partecipanti che hanno il diritto di leggerlo;
--   * apertura di una campagna               -> a chi si ritrova una scheda o
--     un'autovalutazione da compilare;
--   * correzione di una valutazione          -> all'interessato.
--
-- Solo profili attivi
-- -------------------
-- E' scritto in un punto solo, `notify()`, e vale per tutti i casi. Notificare
-- chi e' stato disattivato significa accumulare righe che nessuno leggera'
-- mai, e dare a un account sospeso l'idea di essere ancora in servizio.
--
-- Perche' i trigger e non il codice applicativo
-- ---------------------------------------------
-- Perche' gli eventi da notificare nascono in posti diversi - una insert dal
-- browser, una Edge Function, in un caso perfino uno script SQL - e una regola
-- scritta nell'applicazione sarebbe una regola che vale solo per le strade che
-- passano di li'. Sul database vale per tutte, comprese quelle che verranno.
--
-- Non ci si notifica da soli
-- --------------------------
-- Ogni generatore esclude chi ha compiuto l'azione. Ricevere la notifica di un
-- messaggio che si e' appena scritto e' il modo piu' rapido di insegnare a
-- ignorare le notifiche.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. La tabella
-- ---------------------------------------------------------------------------
create type public.notification_kind as enum (
  'request_opened',
  'request_closed',
  'request_message',
  'request_forwarded',
  'evaluation_assigned',
  'evaluation_corrected'
);

create table if not exists public.notifications (
  id           uuid primary key default extensions.gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  kind         public.notification_kind not null,
  title        text not null,
  body         text,
  -- Dove porta il clic. Percorso interno, mai un indirizzo assoluto: cosi'
  -- funziona uguale in locale, in collaudo e in produzione.
  link         text,
  read_at      timestamptz,
  created_at   timestamptz not null default now(),

  constraint notifications_title_not_blank check (length(btrim(title)) > 0)
);

comment on table public.notifications is
  'Notifiche in applicazione. Generate da trigger, leggibili solo dal destinatario.';

-- L'indice serve alla query che l'interfaccia fa di continuo: le mie, le piu'
-- recenti prima.
create index if not exists notifications_profile_idx
  on public.notifications (profile_id, created_at desc);

create index if not exists notifications_unread_idx
  on public.notifications (profile_id)
  where read_at is null;

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;

-- Si leggono e si segnano come lette solo le proprie. Nemmeno l'HR vede quelle
-- altrui: sapere cosa e' stato notificato a una persona e quando l'ha aperto
-- e' un dato di sorveglianza che non serve a nessuna delle funzioni previste.
create policy "notifications_select_own"
  on public.notifications for select
  to authenticated
  using (profile_id = (select auth.uid()));

create policy "notifications_update_own"
  on public.notifications for update
  to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

create policy "notifications_delete_own"
  on public.notifications for delete
  to authenticated
  using (profile_id = (select auth.uid()));

-- Nessuna policy di INSERT: le notifiche nascono dai trigger, che girano con
-- `security definer`. Se il browser potesse scriverle, chiunque potrebbe
-- recapitare a un collega un avviso inventato.

-- ---------------------------------------------------------------------------
-- 3. Il punto unico di consegna
-- ---------------------------------------------------------------------------
create or replace function public.notify(
  p_profile uuid,
  p_kind    public.notification_kind,
  p_title   text,
  p_body    text default null,
  p_link    text default null,
  p_except  uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_profile is null then
    return;
  end if;

  -- Non si notifica chi ha compiuto l'azione.
  if p_except is not null and p_profile = p_except then
    return;
  end if;

  -- Solo profili attivi: e' la regola richiesta, ed e' scritta qui e basta.
  if not exists (
    select 1 from public.profiles
    where id = p_profile and is_active
  ) then
    return;
  end if;

  insert into public.notifications (profile_id, kind, title, body, link)
  values (p_profile, p_kind, p_title, p_body, p_link);
end;
$$;

-- Le persone da avvisare per una richiesta: i responsabili delle aree
-- coinvolte, oppure l'HR se e' li' che era diretta.
--
-- L'area di origine compare due volte di proposito - una dalla colonna
-- `requests.area_id`, una da `request_areas` - e l'union le fonde. Non e'
-- ridondanza inutile: al momento dell'INSERT i due trigger `requests_notify` e
-- `requests_origin_area` scattano sullo stesso evento, e PostgreSQL li esegue
-- in ordine alfabetico di nome. "notify" viene prima di "origin", quindi
-- quando si cercano i destinatari la tabella delle aree coinvolte e' ancora
-- vuota. Leggere anche la colonna rende la funzione indifferente all'ordine,
-- che e' meglio che dipendere da come si chiamano i trigger.
create or replace function public.request_watchers(p_request uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.requests r
  join public.area_managers am on am.area_id = r.area_id
  join public.profiles p on p.id = am.profile_id
  where r.id = p_request
    and r.recipient = 'manager'
    and p.is_active

  union

  select p.id
  from public.requests r
  join public.request_areas ra on ra.request_id = r.id
  join public.area_managers am on am.area_id = ra.area_id
  join public.profiles p on p.id = am.profile_id
  where r.id = p_request
    and r.recipient = 'manager'
    and p.is_active

  union

  select p.id
  from public.requests r
  cross join public.profiles p
  where r.id = p_request
    and r.recipient = 'hr'
    and p.role in ('hr', 'sysadmin')
    and p.is_active
$$;

-- ---------------------------------------------------------------------------
-- 4. Apertura e chiusura di una richiesta
-- ---------------------------------------------------------------------------
create or replace function public.notify_request_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_watcher  uuid;
  v_chi      text;
begin
  if tg_op = 'INSERT' then
    select full_name into v_chi from public.profiles where id = new.requester_id;

    for v_watcher in select * from public.request_watchers(new.id) loop
      perform public.notify(
        v_watcher,
        'request_opened'::public.notification_kind,
        format('Nuova richiesta da %s', coalesce(v_chi, 'un dipendente')),
        new.subject,
        format('/richieste/%s', new.id),
        new.requester_id
      );
    end loop;

    return new;
  end if;

  -- Chiusura: lo sapra' chi l'ha aperta, e gli altri responsabili coinvolti.
  if new.status = 'closed' and old.status <> 'closed' then
    perform public.notify(
      new.requester_id,
      'request_closed'::public.notification_kind,
      'La tua richiesta e'' stata chiusa',
      new.subject,
      format('/richieste/%s', new.id),
      v_uid
    );

    for v_watcher in select * from public.request_watchers(new.id) loop
      perform public.notify(
        v_watcher,
        'request_closed'::public.notification_kind,
        'Richiesta chiusa',
        new.subject,
        format('/richieste/%s', new.id),
        v_uid
      );
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists requests_notify on public.requests;
create trigger requests_notify
  after insert or update on public.requests
  for each row execute function public.notify_request_change();

-- ---------------------------------------------------------------------------
-- 5. Messaggi in conversazione
-- ---------------------------------------------------------------------------
-- Il pubblico del messaggio decide chi viene avvisato: una nota riservata non
-- puo' produrre una notifica al richiedente, che poi aprirebbe la richiesta e
-- non troverebbe niente di nuovo.
create or replace function public.notify_request_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req      public.requests%rowtype;
  v_watcher  uuid;
  v_chi      text;
  v_titolo   text;
  v_kind     public.notification_kind;
begin
  select * into v_req from public.requests where id = new.request_id;
  if not found then
    return new;
  end if;

  select full_name into v_chi from public.profiles where id = new.author_id;

  v_titolo := case
    when new.is_system then 'Aggiornamento su una richiesta'
    when new.audience = 'managers' then format('Nota riservata da %s', coalesce(v_chi, 'un responsabile'))
    else format('Nuovo messaggio da %s', coalesce(v_chi, 'un collega'))
  end;

  -- Il tipo e' lo stesso per tutti i destinatari: un inoltro e' un inoltro
  -- anche per chi ha aperto la richiesta, ed e' la notizia che gli interessa
  -- di piu' - e' il momento in cui la sua richiesta cambia mani.
  v_kind := case
    when new.is_system then 'request_forwarded'
    else 'request_message'
  end;

  -- Il richiedente: solo se il messaggio e' per tutti.
  if new.audience = 'everyone' then
    perform public.notify(
      v_req.requester_id,
      v_kind,
      v_titolo,
      v_req.subject,
      format('/richieste/%s', new.request_id),
      new.author_id
    );
  end if;

  for v_watcher in select * from public.request_watchers(new.request_id) loop
    perform public.notify(
      v_watcher,
      v_kind,
      v_titolo,
      v_req.subject,
      format('/richieste/%s', new.request_id),
      new.author_id
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists request_messages_notify on public.request_messages;
create trigger request_messages_notify
  after insert on public.request_messages
  for each row execute function public.notify_request_message();

-- ---------------------------------------------------------------------------
-- 6. Schede da compilare
-- ---------------------------------------------------------------------------
-- Scatta sull'inserimento della scheda, che avviene all'apertura della
-- campagna: e' quello il momento in cui una persona si ritrova qualcosa da
-- fare.
create or replace function public.notify_evaluation_assigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_soggetto text;
begin
  if new.kind = 'self_assessment' then
    perform public.notify(
      new.subject_id,
      'evaluation_assigned'::public.notification_kind,
      'Hai un''autovalutazione da compilare',
      'La campagna e'' aperta: trovi la scheda in Valutazioni.',
      format('/valutazioni/%s', new.id),
      null
    );
  else
    select full_name into v_soggetto from public.profiles where id = new.subject_id;
    perform public.notify(
      new.evaluator_id,
      'evaluation_assigned'::public.notification_kind,
      'Hai una scheda di valutazione da compilare',
      format('Scheda di %s.', coalesce(v_soggetto, 'un collaboratore')),
      format('/valutazioni/%s', new.id),
      null
    );
  end if;

  return new;
end;
$$;

drop trigger if exists evaluations_notify_assigned on public.evaluations;
create trigger evaluations_notify_assigned
  after insert on public.evaluations
  for each row execute function public.notify_evaluation_assigned();

-- ---------------------------------------------------------------------------
-- 7. Correzione di una valutazione
-- ---------------------------------------------------------------------------
create or replace function public.notify_evaluation_corrected()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chi text;
begin
  -- Solo quando la correzione e' nuova: un aggiornamento successivo della
  -- stessa scheda non deve ripetere l'avviso.
  if new.corrected_at is not null
     and (old.corrected_at is null or new.corrected_at <> old.corrected_at) then
    select full_name into v_chi from public.profiles where id = new.corrected_by;

    perform public.notify(
      new.subject_id,
      'evaluation_corrected'::public.notification_kind,
      'La tua autovalutazione e'' stata rivista',
      format('%s ha corretto la scheda.', coalesce(v_chi, 'Il responsabile')),
      format('/valutazioni/%s', new.id),
      new.corrected_by
    );
  end if;

  return new;
end;
$$;

drop trigger if exists evaluations_notify_corrected on public.evaluations;
create trigger evaluations_notify_corrected
  after update on public.evaluations
  for each row execute function public.notify_evaluation_corrected();

-- ---------------------------------------------------------------------------
-- 8. Comodita' per l'interfaccia
-- ---------------------------------------------------------------------------
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_n   integer;
begin
  if v_uid is null then
    return 0;
  end if;

  update public.notifications
  set read_at = now()
  where profile_id = v_uid
    and read_at is null
    and (p_ids is null or id = any(p_ids));

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.mark_notifications_read(uuid[]) is
  'Segna come lette le proprie notifiche: tutte, oppure quelle indicate.';

revoke all on function public.mark_notifications_read(uuid[]) from public;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
