-- ===========================================================================
-- ChamaHub - Svuotamento dei dati operativi
-- ===========================================================================
-- Riporta il database allo stato "appena installato": nessun dipendente,
-- nessuna area, nessuna campagna, nessuna valutazione, nessuna risposta di
-- gradimento. Restano in piedi la struttura, i modelli di scheda e la
-- definizione del questionario.
--
-- QUESTO SCRIPT CANCELLA DEFINITIVAMENTE. Non c'e' cestino, non c'e' annulla.
-- Prima di eseguirlo su un database che contiene qualcosa di reale, fai un
-- backup: Supabase Dashboard → Database → Backups, oppure
--
--   pg_dump "$DB_URL" > backup-prima-della-pulizia.sql
--
-- ---------------------------------------------------------------------------
-- Cosa resta
-- ---------------------------------------------------------------------------
--   * i profili SystemAdmin e le loro utenze di accesso;
--   * i modelli di scheda (`evaluation_templates`) e le loro domande;
--   * la definizione dei questionari di gradimento
--     (`satisfaction_surveys`, `satisfaction_questions`);
--   * le impostazioni di sistema (`app_settings`).
--
-- Cosa sparisce
-- -------------
--   * tutti gli altri profili, HR compreso, insieme alle utenze in auth.users;
--   * le aree, e le nomine a responsabile che le riguardano;
--   * le comunicazioni di calendario;
--   * le richieste e le conversazioni;
--   * le campagne e tutte le schede di valutazione con le loro risposte;
--   * le risposte di gradimento, i commenti e i contatori antiabuso;
--   * il registro delle impersonificazioni e i tentativi di recupero password.
--
-- ---------------------------------------------------------------------------
-- Come si esegue
-- ---------------------------------------------------------------------------
-- Dal SQL Editor di Supabase (incollalo tutto e premi Run) oppure:
--
--   psql "$DB_URL" -f supabase/scripts/04_svuota_dati.sql
--
-- E' scritto in una transazione unica: se qualcosa va storto a meta' strada
-- non resta un database mezzo vuoto, torna tutto com'era.
--
-- ---------------------------------------------------------------------------
-- La rete di sicurezza
-- ---------------------------------------------------------------------------
-- Lo script si RIFIUTA di partire se non trova almeno un SystemAdmin attivo.
-- Non e' pignoleria: cancellando ogni profilo senza averne uno da tenere ci si
-- chiude fuori dalla propria applicazione, e l'unico modo di rientrare
-- sarebbe rifare l'utenza dal database. Meglio un errore adesso.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Verifica preliminare
-- ---------------------------------------------------------------------------
do $$
declare
  quanti integer;
begin
  select count(*) into quanti
  from public.profiles
  where role = 'sysadmin' and is_active;

  if quanti = 0 then
    raise exception
      'Nessun SystemAdmin attivo trovato: lo svuotamento e'' stato annullato. %',
      'Crea prima un SystemAdmin con supabase/scripts/03_crea_systemadmin.sql, poi riesegui questo script.';
  end if;

  raise notice 'SystemAdmin attivi che verranno conservati: %', quanti;
end;
$$;

-- Fotografia di partenza, per poter confrontare a fine corsa.
do $$
begin
  raise notice 'PRIMA  -> profili: %, aree: %, nomine: %, campagne: %, valutazioni: %, risposte gradimento: %',
    (select count(*) from public.profiles),
    (select count(*) from public.areas),
    (select count(*) from public.area_managers),
    (select count(*) from public.evaluation_campaigns),
    (select count(*) from public.evaluations),
    (select count(*) from public.satisfaction_submissions);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Gradimento: solo le risposte
-- ---------------------------------------------------------------------------
-- Le domande restano: la definizione di un questionario e' l'equivalente di un
-- modello di scheda, e i modelli si tengono.
--
-- `satisfaction_answers` sparisce da sola per cascata quando si cancellano le
-- consegne, ma la si nomina lo stesso: uno script di pulizia che si affida
-- solo alle cascate diventa illeggibile, e basta una chiave esterna cambiata
-- domani perche' lasci in giro delle righe senza che nessuno se ne accorga.
delete from public.satisfaction_answers;
delete from public.satisfaction_submissions;

-- Il contatore che impedisce risposte ripetute nello stesso mese. Va svuotato
-- insieme al resto, altrimenti chi aveva gia' risposto resterebbe bloccato per
-- un questionario di cui non esiste piu' nessuna traccia.
delete from public.satisfaction_throttle;

-- ---------------------------------------------------------------------------
-- 2. Valutazioni e campagne
-- ---------------------------------------------------------------------------
-- Dalle foglie verso la radice: risposte, schede, aree coinvolte, campagne.
delete from public.evaluation_answers;
delete from public.evaluations;
delete from public.evaluation_campaign_areas;
delete from public.evaluation_campaigns;

-- I modelli NON si toccano: `evaluation_templates` e `evaluation_questions`
-- restano esattamente come sono.

-- ---------------------------------------------------------------------------
-- 3. Richieste e calendario
-- ---------------------------------------------------------------------------
delete from public.request_messages;
delete from public.requests;
delete from public.calendar_entries;

-- ---------------------------------------------------------------------------
-- 4. Registri di servizio
-- ---------------------------------------------------------------------------
-- Il registro delle impersonificazioni riferisce persone che non esisteranno
-- piu': cancellarlo evita di conservare nomi di profili spariti.
delete from public.impersonation_log;
delete from public.password_reset_requests;

-- ---------------------------------------------------------------------------
-- 5. Chi guida cosa
-- ---------------------------------------------------------------------------
-- Le nomine a responsabile (`area_managers`) sparirebbero comunque da sole: la
-- tabella ha chiavi esterne in cascata sia verso `profiles` sia verso `areas`,
-- e qui sotto si cancellano entrambe. Le si nomina lo stesso, per le stesse
-- ragioni delle risposte di gradimento - uno script di pulizia che si affida
-- alle cascate e' uno script che nessuno riesce a rileggere.
--
-- C'e' pero' anche una ragione di ordine. Cancellarle QUI, mentre i profili
-- esistono ancora, fa lavorare il trigger `sync_manager_role` nelle condizioni
-- per cui e' stato scritto: trova il profilo, vede che non guida piu' niente,
-- riporta il ruolo a `employee`. Lasciandole sparire piu' tardi per cascata,
-- il trigger si troverebbe davanti profili gia' in via di cancellazione e non
-- farebbe nulla: stesso risultato finale, ma per caso invece che per scelta.
--
-- Un eventuale SystemAdmin che guidava un'area non viene toccato nel ruolo (il
-- trigger salta HR e SystemAdmin), ma perde la nomina insieme all'area.
delete from public.area_managers;

-- ---------------------------------------------------------------------------
-- 6. Le persone
-- ---------------------------------------------------------------------------
-- Si cancella da `auth.users`, non da `public.profiles`.
--
-- Il profilo ha `id uuid primary key references auth.users (id) on delete
-- cascade`: togliendo l'utenza se ne va anche il profilo. Al contrario no.
-- Cancellare il solo profilo lascerebbe in piedi un'utenza fantasma capace di
-- autenticarsi ma senza nessuna riga in `profiles` - e soprattutto capace di
-- occupare l'indirizzo email, impedendo all'HR di ricreare quella stessa
-- persona: `admin-users` risponderebbe "utente gia' esistente" indicando una
-- riga che nell'applicazione non si vede da nessuna parte.
delete from auth.users u
where not exists (
  select 1
  from public.profiles p
  where p.id = u.id
    and p.role = 'sysadmin'
);

-- ---------------------------------------------------------------------------
-- 7. Le aree
-- ---------------------------------------------------------------------------
-- Per ultime, quando piu' nessuno le riferisce.
delete from public.areas;

-- ---------------------------------------------------------------------------
-- 8. Esito
-- ---------------------------------------------------------------------------
do $$
declare
  profili_rimasti integer;
begin
  select count(*) into profili_rimasti from public.profiles;

  raise notice 'DOPO   -> profili: %, aree: %, nomine: %, campagne: %, valutazioni: %, risposte gradimento: %',
    profili_rimasti,
    (select count(*) from public.areas),
    (select count(*) from public.area_managers),
    (select count(*) from public.evaluation_campaigns),
    (select count(*) from public.evaluations),
    (select count(*) from public.satisfaction_submissions);

  raise notice 'CONSERVATI -> modelli di scheda: %, domande dei modelli: %, questionari: %, domande dei questionari: %',
    (select count(*) from public.evaluation_templates),
    (select count(*) from public.evaluation_questions),
    (select count(*) from public.satisfaction_surveys),
    (select count(*) from public.satisfaction_questions);

  -- Controllo finale: se e' rimasto qualcuno che non e' SystemAdmin, qualcosa
  -- non ha funzionato come previsto e la transazione non deve chiudersi.
  if exists (select 1 from public.profiles where role <> 'sysadmin') then
    raise exception 'Sono rimasti profili non SystemAdmin: annullo tutto.';
  end if;

  if profili_rimasti = 0 then
    raise exception 'Non e'' rimasto nessun profilo: annullo tutto.';
  end if;

  if exists (select 1 from public.area_managers) then
    raise exception 'Sono rimaste nomine a responsabile: annullo tutto.';
  end if;
end;
$$;

commit;

-- ===========================================================================
-- Dopo l'esecuzione
-- ===========================================================================
-- Entra con il SystemAdmin e ricostruisci nell'ordine:
--
--   1. le aree (Amministrazione HR → Aree);
--   2. il profilo HR (Dipendenti → Nuovo dipendente, ruolo HR);
--   3. gli altri dipendenti;
--   4. i responsabili: si aprono le loro schede e si compila «Aree da
--      guidare». Il ruolo NON si assegna dal menu a tendina - dalla migrazione
--      18 «Responsabile» e' la conseguenza di avere almeno un'area, e chi ci
--      prova riceve un messaggio che lo rimanda qui.
--
-- I modelli di scheda e il questionario di gradimento sono gia' al loro posto:
-- le campagne si possono aprire appena esistono aree e persone.
--
-- Nota sulla finestra di primo avvio: `bootstrap_first_admin` in `app_settings`
-- resta come l'hai lasciata. Se era gia' stata consumata rimane consumata -
-- questo script non riapre la porta del primo accesso, e non deve farlo: con un
-- SystemAdmin vivo non serve, e riaprirla significherebbe lasciare che il primo
-- che si registra diventi HR.
-- ===========================================================================
