-- ===========================================================================
-- ChamaHub - 12. Le campagne si modificano e si cancellano solo in bozza
-- ===========================================================================
-- Finche' una campagna e' in bozza non esiste ancora nessuna scheda: cambiarla
-- o buttarla via non fa danni. Dal momento in cui viene aperta, invece, alle
-- sue spalle ci sono valutazioni compilate da persone vere: cancellarla se le
-- porterebbe dietro (la chiave esterna e' `on delete cascade`), e cambiare
-- modello o date renderebbe incoerente quello che e' gia' stato scritto.
--
-- Da qui in avanti una campagna aperta si chiude, non si cancella: resta come
-- storico. Il divieto vale per chi opera dall'applicazione; le Edge Function,
-- che lavorano con `service_role` e hanno `auth.uid()` nullo, continuano a
-- poter cambiare lo stato (apertura, chiusura, riapertura).
-- ===========================================================================

create or replace function public.protect_campaign_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  -- service_role / job interni: nessun vincolo.
  if v_uid is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Una campagna gia'' aperta non si cancella: chiudila, resta come storico delle valutazioni.';
    end if;
    return old;
  end if;

  if old.status <> 'draft' then
    raise exception 'La campagna non e'' piu'' in bozza: non e'' modificabile.';
  end if;

  -- In bozza si cambia tutto tranne lo stato: aprire una campagna significa
  -- generare le schede, e quello lo fa la Edge Function `manage-campaign`.
  if new.status is distinct from old.status then
    raise exception 'Lo stato della campagna si cambia aprendola o chiudendola, non modificandola.';
  end if;

  return new;
end;
$$;

drop trigger if exists evaluation_campaigns_protect_draft on public.evaluation_campaigns;
create trigger evaluation_campaigns_protect_draft
  before update or delete on public.evaluation_campaigns
  for each row execute function public.protect_campaign_draft();

-- ---------------------------------------------------------------------------
-- Stesse regole per le aree coinvolte
-- ---------------------------------------------------------------------------
create or replace function public.protect_campaign_areas_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_campaign uuid := coalesce(new.campaign_id, old.campaign_id);
  v_status public.campaign_status;
begin
  if v_uid is null then
    return coalesce(new, old);
  end if;

  select c.status into v_status
  from public.evaluation_campaigns c
  where c.id = v_campaign;

  -- Campagna gia' rimossa (cancellazione a cascata): niente da proteggere.
  if v_status is null then
    return coalesce(new, old);
  end if;

  if v_status <> 'draft' then
    raise exception 'Le aree coinvolte si cambiano solo finche'' la campagna e'' in bozza.';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists evaluation_campaign_areas_protect_draft on public.evaluation_campaign_areas;
create trigger evaluation_campaign_areas_protect_draft
  before insert or update or delete on public.evaluation_campaign_areas
  for each row execute function public.protect_campaign_areas_draft();
