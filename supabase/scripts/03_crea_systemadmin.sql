-- ===========================================================================
-- ChamaHub - nomina di un SystemAdmin
-- ===========================================================================
-- Il SystemAdmin e' il ruolo sopra l'HR: vede e gestisce tutto, puo' nominare
-- altri SystemAdmin e puo' impersonare una persona per vedere l'applicazione
-- con i suoi occhi.
--
-- Non esiste alcun comando nell'interfaccia per crearlo, e l'HR non puo'
-- assegnarlo: e' voluto. Un ruolo che sta sopra a tutti non deve essere
-- raggiungibile da dentro l'applicazione, altrimenti basta un account HR
-- compromesso per prendersi le chiavi di casa. Si passa da qui, cioe' dal
-- database, dove arriva solo chi ha le credenziali del progetto.
--
-- Prima di lanciarlo serve un account gia' esistente: creato dall'HR, oppure
-- registrato al primo accesso (email e password o account Microsoft).
--
-- Sostituisci l'indirizzo e lancia nel SQL Editor di Supabase.
-- ===========================================================================

update public.profiles
set role = 'sysadmin',
    is_active = true
where lower(email) = lower('tua.email@azienda.it');

-- Verifica: deve comparire esattamente la persona attesa, con role = sysadmin.
select email, full_name, role, is_active, area_id
from public.profiles
where lower(email) = lower('tua.email@azienda.it');

-- ---------------------------------------------------------------------------
-- Per revocare il ruolo (da un altro SystemAdmin o da qui):
--
--   update public.profiles set role = 'hr'
--   where lower(email) = lower('tua.email@azienda.it');
--
-- Un SystemAdmin non puo' revocare il ruolo a se stesso dall'applicazione:
-- resterebbe un impianto senza nessuno in grado di rimetterlo a posto.
-- ---------------------------------------------------------------------------

-- Chi ha oggi il ruolo, per non perderne il conto:
select email, full_name, is_active, created_at
from public.profiles
where role = 'sysadmin'
order by created_at;
