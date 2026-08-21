-- ===========================================================================
-- ChamaHub - 04. Richieste al responsabile / all'HR
-- ===========================================================================

create table public.requests (
  id           uuid primary key default extensions.gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  -- Snapshot dell'area del richiedente: consente al responsabile di vedere le
  -- richieste della propria area senza join ricorsivi nelle policy.
  area_id      uuid references public.areas (id) on delete set null,
  recipient    public.request_recipient not null,
  category     public.request_category not null default 'other',
  subject      text not null,
  body         text not null,
  status       public.request_status not null default 'open',
  assignee_id  uuid references public.profiles (id) on delete set null,
  resolution   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  closed_at    timestamptz,

  constraint requests_subject_not_blank check (length(btrim(subject)) between 1 and 160),
  constraint requests_body_not_blank check (length(btrim(body)) between 1 and 4000),
  constraint requests_closed_at_coherent check (
    (status = 'closed' and closed_at is not null)
    or (status <> 'closed' and closed_at is null)
  )
);

create index requests_requester_idx on public.requests (requester_id, created_at desc);
create index requests_area_idx on public.requests (area_id, status);
create index requests_recipient_status_idx on public.requests (recipient, status);

create trigger requests_set_updated_at
  before update on public.requests
  for each row execute function public.set_updated_at();

comment on table public.requests is
  'Richieste inviate dal dipendente (o dal responsabile) al proprio responsabile oppure all''HR.';

-- ---------------------------------------------------------------------------
-- Messaggi di risposta (thread)
-- ---------------------------------------------------------------------------
create table public.request_messages (
  id         uuid primary key default extensions.gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),

  constraint request_messages_body_not_blank check (length(btrim(body)) between 1 and 4000)
);

create index request_messages_request_idx on public.request_messages (request_id, created_at);

comment on table public.request_messages is 'Thread di conversazione su una richiesta.';

-- ---------------------------------------------------------------------------
-- Normalizzazione: area e coerenza dello stato
-- ---------------------------------------------------------------------------
create or replace function public.requests_normalize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.area_id := public.area_of(new.requester_id);
    new.status := 'open';
    new.closed_at := null;
    new.assignee_id := null;
    new.resolution := null;
  else
    -- L'area e il richiedente non sono modificabili dopo la creazione.
    new.requester_id := old.requester_id;
    new.area_id := old.area_id;

    if new.status = 'closed' and old.status <> 'closed' then
      new.closed_at := now();
    elsif new.status <> 'closed' then
      new.closed_at := null;
    end if;
  end if;

  return new;
end;
$$;

create trigger requests_normalize
  before insert or update on public.requests
  for each row execute function public.requests_normalize();

-- ---------------------------------------------------------------------------
-- Visibilita' di una richiesta (usata sia da requests sia da request_messages)
-- ---------------------------------------------------------------------------
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
          and public.is_manager()
          and r.area_id is not null
          and r.area_id = public.current_area_id()
        )
      )
  )
$$;

-- true se l'utente corrente e' il gestore della richiesta (HR o responsabile
-- dell'area destinataria) e puo' quindi cambiarne lo stato.
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
          and public.is_manager()
          and r.area_id is not null
          and r.area_id = public.current_area_id()
        )
        -- L'HR ha comunque supervisione su tutte le richieste.
        or public.is_hr()
      )
  )
$$;

-- ---------------------------------------------------------------------------
-- RLS: requests
-- ---------------------------------------------------------------------------
alter table public.requests enable row level security;

create policy "requests_select_own"
  on public.requests for select
  to authenticated
  using (requester_id = (select auth.uid()));

create policy "requests_select_area_manager"
  on public.requests for select
  to authenticated
  using (
    recipient = 'manager'
    and public.is_manager()
    and area_id is not null
    and area_id = public.current_area_id()
  );

create policy "requests_select_hr"
  on public.requests for select
  to authenticated
  using (public.is_hr());

create policy "requests_insert_own"
  on public.requests for insert
  to authenticated
  with check (requester_id = (select auth.uid()) and public.is_active_user());

-- Solo chi gestisce la richiesta puo' aggiornarla (stato, assegnatario, esito).
create policy "requests_update_handler"
  on public.requests for update
  to authenticated
  using (public.can_handle_request(id))
  with check (public.can_handle_request(id));

-- Il richiedente puo' eliminare la propria richiesta finche' e' aperta.
create policy "requests_delete_own_open"
  on public.requests for delete
  to authenticated
  using (requester_id = (select auth.uid()) and status = 'open');

create policy "requests_delete_hr"
  on public.requests for delete
  to authenticated
  using (public.is_hr());

-- ---------------------------------------------------------------------------
-- RLS: request_messages
-- ---------------------------------------------------------------------------
alter table public.request_messages enable row level security;

create policy "request_messages_select"
  on public.request_messages for select
  to authenticated
  using (public.can_view_request(request_id));

create policy "request_messages_insert"
  on public.request_messages for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and public.is_active_user()
    and public.can_view_request(request_id)
  );

-- I messaggi non sono modificabili; l'autore puo' eliminare i propri.
create policy "request_messages_delete_own"
  on public.request_messages for delete
  to authenticated
  using (author_id = (select auth.uid()));
