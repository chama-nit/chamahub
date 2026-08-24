-- ===========================================================================
-- ChamaHub - 11. L'HR non apre richieste
-- ===========================================================================
-- Le richieste hanno due soli destinatari: il responsabile della propria area
-- e il reparto HR. Per chi lavora in HR nessuno dei due ha senso - una
-- richiesta all'HR scritta dall'HR arriverebbe a se' stessa - quindi la
-- possibilita' viene tolta.
--
-- Il pulsante sparisce anche dall'interfaccia, ma quello e' un dettaglio di
-- comodita': la regola che conta e' qui, perche' vale anche per chi chiamasse
-- l'API direttamente.
--
-- Restano intatte:
--   * la lettura delle richieste indirizzate all'HR (e' il suo lavoro);
--   * la presa in carico, la risposta e la chiusura;
--   * le richieste storiche eventualmente gia' inviate da un profilo HR.
-- ===========================================================================

drop policy if exists "requests_insert_own" on public.requests;
create policy "requests_insert_own"
  on public.requests for insert
  to authenticated
  with check (
    requester_id = (select auth.uid())
    and public.is_active_user()
    and public.current_role_name() <> 'hr'
  );

comment on policy "requests_insert_own" on public.requests is
  'Ogni persona attiva apre richieste solo a proprio nome. Il ruolo HR e'' escluso: e'' il destinatario delle richieste, non un mittente.';
