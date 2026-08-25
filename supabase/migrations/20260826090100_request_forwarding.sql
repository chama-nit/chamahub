-- ===========================================================================
-- ChamaHub - 20. Inoltrare una richiesta a un'altra area
-- ===========================================================================
-- Il caso da rappresentare
-- ------------------------
-- Un dipendente IT chiede al proprio responsabile un computer nuovo. Il
-- responsabile IT e' d'accordo, ma la spesa non e' sua: serve
-- l'Amministrazione. Fino a qui l'unica strada era chiudere la richiesta e
-- aprirne un'altra, perdendo la conversazione e lasciando il dipendente senza
-- un filo da seguire.
--
-- Da qui in avanti la richiesta si allarga: resta una sola, con la sua storia,
-- e coinvolge piu' aree.
--
-- Le due conversazioni
-- --------------------
-- Allargare la platea non significa dare tutto a tutti. Quando IT e
-- Amministrazione discutono se quei 2000 euro ci stanno nel budget, stanno
-- parlando fra loro: e' un dibattito che riguarda l'organizzazione, non chi ha
-- chiesto il computer. Il dipendente ha diritto a sapere che la sua richiesta
-- e' passata all'Amministrazione e come e' andata a finire - non a leggere le
-- valutazioni di merito che ci sono state dietro.
--
-- Quindi ogni messaggio ha un pubblico:
--
--   'everyone'  -> lo legge chiunque veda la richiesta, richiedente compreso.
--                  E' il canale con cui si risponde a chi ha chiesto.
--   'managers'  -> lo leggono solo i responsabili delle aree coinvolte e l'HR.
--                  E' il canale fra aree.
--
-- E gli inoltri stessi vengono registrati come eventi visibili a tutti: il
-- richiedente vede "inoltrata all'area Amministrazione", con data e autore.
-- L'esito si', il dibattito no.
--
-- Perche' non due richieste collegate
-- -----------------------------------
-- Sarebbe stato piu' semplice da scrivere e peggio da usare: due schede da
-- aprire, due stati da tenere allineati, e la domanda "e' stata approvata?"
-- con due risposte possibili. Una richiesta ha un esito solo, e chi l'ha
-- aperta deve poterlo leggere in un posto solo.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Le aree coinvolte
-- ---------------------------------------------------------------------------
-- `requests.area_id` resta, e resta l'area di ORIGINE: quella del richiedente,
-- quella a cui la richiesta e' nata. Non viene mai riscritta - e' un dato
-- storico, e i conteggi per area continuano a poggiarci sopra.
create table if not exists public.request_areas (
  request_id uuid not null references public.requests (id) on delete cascade,
  area_id    uuid not null references public.areas (id) on delete cascade,
  -- Chi ha portato dentro quest'area. Null per l'area di origine, che non e'
  -- stata "portata" da nessuno: c'era.
  added_by   uuid references public.profiles (id) on delete set null,
  added_at   timestamptz not null default now(),
  is_origin  boolean not null default false,

  primary key (request_id, area_id)
);

comment on table public.request_areas is
  'Aree coinvolte in una richiesta. La riga con is_origin = true e'' l''area del richiedente; le altre sono arrivate per inoltro.';

create index if not exists request_areas_area_idx
  on public.request_areas (area_id);

-- Travaso: ogni richiesta esistente coinvolge la propria area di origine.
insert into public.request_areas (request_id, area_id, is_origin)
select r.id, r.area_id, true
from public.requests r
where r.area_id is not null
on conflict do nothing;

-- Le richieste nuove registrano l'area di origine da sole.
create or replace function public.requests_register_origin_area()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.area_id is not null then
    insert into public.request_areas (request_id, area_id, is_origin)
    values (new.id, new.area_id, true)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists requests_origin_area on public.requests;
create trigger requests_origin_area
  after insert on public.requests
  for each row execute function public.requests_register_origin_area();

-- ---------------------------------------------------------------------------
-- 2. Il pubblico dei messaggi
-- ---------------------------------------------------------------------------
create type public.message_audience as enum ('everyone', 'managers');

alter table public.request_messages
  add column if not exists audience public.message_audience not null default 'everyone';

comment on column public.request_messages.audience is
  '"everyone": visibile anche al richiedente. "managers": riservato ai responsabili delle aree coinvolte e all''HR.';

-- Gli inoltri, e in generale i fatti che cambiano la richiesta, si raccontano
-- come messaggi di sistema: cosi' compaiono nella conversazione in ordine
-- cronologico invece che in un registro a parte che nessuno guarda.
alter table public.request_messages
  add column if not exists is_system boolean not null default false;

comment on column public.request_messages.is_system is
  'Messaggio generato dall''applicazione (un inoltro, una chiusura), non scritto da una persona.';

-- ---------------------------------------------------------------------------
-- 3. Chi vede cosa
-- ---------------------------------------------------------------------------
-- La visibilita' della richiesta si allarga a tutte le aree coinvolte.
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
        or (
          r.recipient = 'manager'
          and exists (
            select 1
            from public.request_areas ra
            where ra.request_id = r.id
              and public.manages_area(ra.area_id)
          )
        )
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
        or (
          r.recipient = 'manager'
          and exists (
            select 1
            from public.request_areas ra
            where ra.request_id = r.id
              and public.manages_area(ra.area_id)
          )
        )
        -- L'HR ha comunque supervisione su tutte le richieste.
        or public.is_hr()
      )
  )
$$;

-- true se chi interroga puo' leggere anche il canale riservato: e' l'HR,
-- oppure guida una delle aree coinvolte. Il richiedente non ci rientra,
-- nemmeno quando e' lui stesso un responsabile di un'altra area.
create or replace function public.can_read_internal_notes(p_request uuid)
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
      and r.requester_id <> (select auth.uid())
      and (
        public.is_hr()
        or exists (
          select 1
          from public.request_areas ra
          where ra.request_id = r.id
            and public.manages_area(ra.area_id)
        )
      )
  )
$$;

comment on function public.can_read_internal_notes(uuid) is
  'Chi puo'' leggere i messaggi riservati (audience = managers). Mai il richiedente, nemmeno se guida un''altra area.';

-- La policy di lettura dei messaggi tiene conto del pubblico.
drop policy if exists "request_messages_select" on public.request_messages;
create policy "request_messages_select"
  on public.request_messages for select
  to authenticated
  using (
    public.can_view_request(request_id)
    and (
      audience = 'everyone'
      or public.can_read_internal_notes(request_id)
    )
  );

-- Scrivere nel canale riservato lo puo' fare solo chi lo puo' leggere.
drop policy if exists "request_messages_insert" on public.request_messages;
create policy "request_messages_insert"
  on public.request_messages for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and public.is_active_user()
    and public.can_view_request(request_id)
    and not is_system
    and (
      audience = 'everyone'
      or public.can_read_internal_notes(request_id)
    )
  );

-- I messaggi di sistema non si cancellano: sono la memoria di cosa e'
-- successo.
drop policy if exists "request_messages_delete_own" on public.request_messages;
create policy "request_messages_delete_own"
  on public.request_messages for delete
  to authenticated
  using (author_id = (select auth.uid()) and not is_system);

-- Le aree coinvolte sono leggibili da chi vede la richiesta.
alter table public.request_areas enable row level security;

create policy "request_areas_select"
  on public.request_areas for select
  to authenticated
  using (public.can_view_request(request_id));

-- Nessuna policy di scrittura: si passa dalla funzione qui sotto, che e'
-- l'unico modo di aggiungere un'area lasciando anche la traccia in
-- conversazione. Una insert diretta produrrebbe un inoltro muto.

-- Le richieste restano visibili anche alle aree aggiunte per inoltro.
drop policy if exists "requests_select_area_manager" on public.requests;
create policy "requests_select_area_manager"
  on public.requests for select
  to authenticated
  using (
    recipient = 'manager'
    and exists (
      select 1
      from public.request_areas ra
      where ra.request_id = id
        and public.manages_area(ra.area_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 4. L'inoltro
-- ---------------------------------------------------------------------------
-- Una funzione sola, che fa le tre cose insieme: aggiunge l'area, scrive
-- l'evento visibile a tutti, e riporta la richiesta in lavorazione se era
-- ferma. Separarle avrebbe voluto dire poter fare la prima e dimenticare le
-- altre due.
create or replace function public.forward_request(
  p_request uuid,
  p_area    uuid,
  p_note    text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_area_name text;
  v_actor     text;
begin
  if v_uid is null then
    raise exception 'Sessione non valida.' using errcode = '42501';
  end if;

  -- Puo' inoltrare chi gestisce la richiesta: un responsabile di un'area gia'
  -- coinvolta, oppure l'HR. L'area chiamata puo' a sua volta chiamarne
  -- un'altra: e' voluto, un parere puo' averne bisogno di un terzo.
  if not public.can_handle_request(p_request) then
    raise exception 'Non puoi inoltrare questa richiesta.' using errcode = '42501';
  end if;

  select name into v_area_name from public.areas where id = p_area and is_active;
  if v_area_name is null then
    raise exception 'Area non trovata o non attiva.' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.request_areas
    where request_id = p_request and area_id = p_area
  ) then
    raise exception 'Quest''area e'' gia'' coinvolta nella richiesta.'
      using errcode = '23505';
  end if;

  insert into public.request_areas (request_id, area_id, added_by)
  values (p_request, p_area, v_uid);

  select full_name into v_actor from public.profiles where id = v_uid;

  -- L'evento e' visibile a TUTTI, richiedente compreso: e' "l'esito" di cui
  -- ha diritto di sapere. La nota di accompagnamento invece resta fra i
  -- responsabili, perche' e' li' che si spiega il perche'.
  insert into public.request_messages (request_id, author_id, body, audience, is_system)
  values (
    p_request,
    v_uid,
    format('Richiesta inoltrata all''area %s da %s.', v_area_name, coalesce(v_actor, 'un responsabile')),
    'everyone',
    true
  );

  if p_note is not null and length(btrim(p_note)) > 0 then
    insert into public.request_messages (request_id, author_id, body, audience, is_system)
    values (p_request, v_uid, btrim(p_note), 'managers', false);
  end if;

  update public.requests
  set status = case when status = 'closed' then 'in_progress' else status end
  where id = p_request;
end;
$$;

comment on function public.forward_request(uuid, uuid, text) is
  'Coinvolge un''altra area in una richiesta, lasciando traccia visibile a tutti e una nota riservata facoltativa.';

revoke all on function public.forward_request(uuid, uuid, text) from public;
grant execute on function public.forward_request(uuid, uuid, text) to authenticated;
