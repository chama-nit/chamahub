-- ===========================================================================
-- ChamaHub - 16. Richieste di reimpostazione password
-- ===========================================================================
-- Serve alla Edge Function `request-password-reset`, che manda il link di
-- recupero senza passare dal servizio di posta interno di Supabase.
--
-- La tabella esiste per un motivo solo: mettere un limite. Il modulo "ho
-- dimenticato la password" e' raggiungibile senza autenticazione, quindi
-- chiunque potrebbe usarlo per sommergere di email la casella di un collega.
-- Tre tentativi all'ora per indirizzo sono abbastanza per chi ha davvero
-- perso la password e pochi per chi vuole disturbare.
--
-- Cosa NON c'e' qui dentro: nessun collegamento al profilo, nessun esito.
-- Solo l'indirizzo e l'ora, cancellati dopo un giorno dalla funzione stessa.
-- Nessun ruolo applicativo puo' leggerla: ci lavora solo `service_role`.
-- ===========================================================================

create table if not exists public.password_reset_requests (
  id           uuid primary key default extensions.gen_random_uuid(),
  email        text not null,
  requested_at timestamptz not null default now()
);

create index if not exists password_reset_requests_email_idx
  on public.password_reset_requests (lower(email), requested_at desc);

alter table public.password_reset_requests enable row level security;

-- Nessuna policy: con RLS attivo e nessuna policy, per `anon` e
-- `authenticated` la tabella e' semplicemente vuota e non scrivibile.
-- `service_role` la vede lo stesso, perche' non e' soggetto a RLS.
revoke all on public.password_reset_requests from anon, authenticated;

comment on table public.password_reset_requests is
  'Solo conteggio dei tentativi di recupero password, per limitarne la frequenza. Ripulita dalla Edge Function request-password-reset.';
