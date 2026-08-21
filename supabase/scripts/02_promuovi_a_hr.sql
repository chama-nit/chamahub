-- ===========================================================================
-- ChamaHub - promozione di un utente esistente a HR
-- ===========================================================================
-- Da usare quando l'account esiste gia': creato dal Dashboard di Supabase
-- (Authentication -> Users -> Add user, con «Auto Confirm User» attivo),
-- oppure perche' la persona ha effettuato l'accesso con Microsoft ed e'
-- rimasta in attesa di attivazione.
--
-- Sostituisci l'indirizzo email e lancia nel SQL Editor.
-- ===========================================================================

update public.profiles
set role = 'hr',
    is_active = true
where lower(email) = lower('tua.email@azienda.it');

-- Da qui in poi la gestione avviene dall'interfaccia, nella sezione HR.
select email, full_name, role, is_active, area_id
from public.profiles
where lower(email) = lower('tua.email@azienda.it');
