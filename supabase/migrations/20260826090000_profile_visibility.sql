-- ===========================================================================
-- ChamaHub - 19. Vedere il nome di chi ti scrive
-- ===========================================================================
-- Il sintomo
-- ----------
-- Nella conversazione di una richiesta, i messaggi in uscita mostravano il
-- nome di chi li aveva scritti; quelli in arrivo mostravano "Utente".
--
-- Non era un difetto dell'interfaccia. La pagina legge l'autore con una join
-- su `profiles`, e quella join tornava vuota: le policy non permettevano a chi
-- legge di vedere quel profilo. L'interfaccia faceva l'unica cosa sensata -
-- ripiegare su una parola generica - ma la parola generica nascondeva il
-- problema invece di segnalarlo.
--
-- La causa
-- --------
-- `profiles_select_same_area` concede la lettura dei profili della propria
-- area (e, dalla migrazione 18, di quelle guidate). Sono due categorie che non
-- coprono le persone con cui si parla davvero:
--
--   * l'HR non appartiene a nessuna area (`area_id` e' null), quindi NESSUN
--     dipendente ha mai potuto vedere il nome di chi gli risponde da li'. E'
--     un difetto che c'era dal primo giorno, ed e' rimasto invisibile finche'
--     nessuno ha guardato una conversazione con l'HR;
--
--   * dalla migrazione 18 un responsabile puo' guidare un'area senza
--     appartenerci: il suo collaboratore non lo vede piu'.
--
-- La forma della soluzione
-- ------------------------
-- Non si allarga `profiles_select_same_area` - "tutti vedono tutti" e' una
-- risposta che risolve il sintomo e apre l'anagrafica aziendale a chiunque.
-- Si aggiungono due permessi mirati, fondati su una relazione che esiste gia':
--
--   1. vedo chi guida la mia area. E' il mio responsabile: sapere come si
--      chiama non e' un privilegio, e' il presupposto per rivolgersi a lui;
--
--   2. vedo chi ha scritto in una richiesta che posso leggere. Se una persona
--      mi ha risposto, il suo nome fa parte della risposta.
--
-- Entrambi passano da funzioni `security definer`: una policy su `profiles`
-- che interroghi `requests` farebbe scattare le policy di quella tabella, che
-- a loro volta guardano `profiles`, e si finirebbe in ricorsione.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Chi guida la mia area
-- ---------------------------------------------------------------------------
create or replace function public.is_my_manager(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles me
    join public.area_managers am on am.area_id = me.area_id
    where me.id = (select auth.uid())
      and me.is_active
      and me.area_id is not null
      and am.profile_id = p_profile
  )
$$;

comment on function public.is_my_manager(uuid) is
  'Vero se il profilo indicato guida l''area a cui appartiene chi sta interrogando.';

-- ---------------------------------------------------------------------------
-- 2. Chi mi ha scritto in una richiesta che posso leggere
-- ---------------------------------------------------------------------------
-- Il criterio e' volutamente stretto: non "chiunque partecipi a una richiesta
-- che vedo", ma "chi ci ha effettivamente scritto dentro". Un'area coinvolta e
-- silenziosa non espone i nomi dei suoi responsabili; chi prende la parola
-- si presenta, ed e' giusto cosi'.
create or replace function public.wrote_in_my_requests(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.request_messages m
    where m.author_id = p_profile
      and public.can_view_request(m.request_id)
  )
$$;

comment on function public.wrote_in_my_requests(uuid) is
  'Vero se il profilo indicato ha scritto almeno un messaggio in una richiesta leggibile da chi sta interrogando.';

-- ---------------------------------------------------------------------------
-- 3. Le policy
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_select_my_managers" on public.profiles;
create policy "profiles_select_my_managers"
  on public.profiles for select
  to authenticated
  using (public.is_active_user() and public.is_my_manager(id));

drop policy if exists "profiles_select_request_authors" on public.profiles;
create policy "profiles_select_request_authors"
  on public.profiles for select
  to authenticated
  using (public.is_active_user() and public.wrote_in_my_requests(id));

-- ---------------------------------------------------------------------------
-- 4. Il destinatario di una richiesta, prima ancora che risponda
-- ---------------------------------------------------------------------------
-- Chi apre una richiesta la indirizza a un'area o all'HR. Vedere subito a chi
-- e' arrivata - non solo dopo che qualcuno ha risposto - evita la sensazione
-- di aver scritto nel vuoto. Per l'HR vale lo stesso: e' il destinatario di
-- una categoria intera di richieste, e il suo nome non e' un segreto.
create or replace function public.is_request_recipient(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.requests r
    where r.requester_id = (select auth.uid())
      and (
        (r.recipient = 'hr' and exists (
          select 1 from public.profiles p
          where p.id = p_profile and p.role in ('hr', 'sysadmin') and p.is_active
        ))
        or (r.recipient = 'manager' and exists (
          select 1 from public.area_managers am
          where am.area_id = r.area_id and am.profile_id = p_profile
        ))
      )
  )
$$;

drop policy if exists "profiles_select_my_recipients" on public.profiles;
create policy "profiles_select_my_recipients"
  on public.profiles for select
  to authenticated
  using (public.is_active_user() and public.is_request_recipient(id));
