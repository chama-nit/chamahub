-- ===========================================================================
-- ChamaHub - 01. Tipi enumerati, utility e funzioni helper
-- ===========================================================================
-- Questa migrazione introduce i tipi di dominio usati da tutto lo schema e le
-- funzioni "helper" richiamate dalle policy RLS. Le helper sono SECURITY
-- DEFINER perche' devono poter leggere `public.profiles` senza innescare
-- ricorsione infinita nelle policy della tabella stessa.
-- ===========================================================================

create extension if not exists "pgcrypto" with schema extensions;

-- ---------------------------------------------------------------------------
-- Tipi enumerati
-- ---------------------------------------------------------------------------

-- Ruoli applicativi. `hr` e' il ruolo amministrativo.
create type public.user_role as enum ('employee', 'manager', 'hr');

-- Tipo di giornata comunicata a calendario.
create type public.attendance_type as enum ('office', 'smart_working', 'absence');

-- Dettaglio dell'assenza (valorizzato solo quando attendance_type = 'absence').
create type public.absence_kind as enum ('vacation', 'leave', 'sick', 'other');

-- Granularita' della comunicazione a calendario.
create type public.day_period as enum ('full_day', 'morning', 'afternoon');

-- Categorie predefinite delle richieste.
create type public.request_category as enum (
  'vacation', 'leave', 'equipment', 'training', 'administrative', 'other'
);

-- Destinatario della richiesta.
create type public.request_recipient as enum ('manager', 'hr');

-- Ciclo di vita della richiesta.
create type public.request_status as enum ('open', 'in_progress', 'closed');

-- Tipi di domanda supportati dal costruttore di schede.
create type public.question_type as enum ('scale', 'text');

-- Natura della scheda di valutazione.
create type public.evaluation_kind as enum ('manager_review', 'self_assessment');

-- Stato di compilazione della singola scheda.
create type public.evaluation_status as enum ('pending', 'draft', 'submitted');

-- Stato della campagna di valutazione.
create type public.campaign_status as enum ('draft', 'open', 'closed');

-- Destinatario del modello di scheda.
create type public.template_target as enum ('employee', 'self');

-- ---------------------------------------------------------------------------
-- Utility generiche
-- ---------------------------------------------------------------------------

-- Mantiene aggiornata la colonna updated_at su ogni UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger BEFORE UPDATE: aggiorna automaticamente la colonna updated_at.';
