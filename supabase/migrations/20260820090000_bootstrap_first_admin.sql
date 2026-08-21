-- ===========================================================================
-- ChamaHub - 09. Primo avvio: creazione dell'amministratore iniziale
-- ===========================================================================
-- Problema: l'anagrafica si gestisce dalla sezione HR, ma per accedere a quella
-- sezione serve gia' un utente HR. Senza un innesco si resta chiusi fuori.
--
-- Soluzione: finche' `public.profiles` e' completamente vuoto, il primo account
-- che si registra diventa automaticamente HR attivo. Appena succede, il flag
-- `bootstrap_first_admin` passa a false e il meccanismo non si riattiva piu':
-- non e' una scorciatoia permanente, e' l'equivalente della schermata di
-- installazione che si vede una volta sola.
--
-- Il flag e' modificabile solo dall'HR (policy di app_settings), quindi
-- nessuno puo' riaprire la finestra dall'esterno.
-- ===========================================================================

insert into public.app_settings (key, value, description)
values (
  'bootstrap_first_admin',
  'true'::jsonb,
  'Se true e non esiste ancora alcun profilo, il primo account registrato diventa HR attivo. Si disattiva da solo dopo il primo utilizzo.'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Stato del primo avvio, leggibile anche senza essere autenticati
-- ---------------------------------------------------------------------------
-- Serve alla pagina di login per capire se mostrare il modulo di creazione
-- dell'amministratore. Espone un solo booleano: l'unica informazione che
-- trapela e' "l'applicazione non e' ancora stata configurata", che e' anche
-- l'unico momento in cui la funzione restituisce true.
create or replace function public.needs_bootstrap()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(
      (select (value #>> '{}')::boolean
       from public.app_settings
       where key = 'bootstrap_first_admin'),
      false
    )
    and not exists (select 1 from public.profiles)
$$;

comment on function public.needs_bootstrap() is
  'true solo quando l''applicazione non ha ancora alcun profilo e la finestra di primo avvio e'' aperta.';

revoke all on function public.needs_bootstrap() from public;
grant execute on function public.needs_bootstrap() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Creazione del profilo alla registrazione, con innesco del primo HR
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_first  boolean;
  v_role      public.user_role := 'employee';
  v_active    boolean := false;
begin
  -- Il blocco della riga di configurazione serializza eventuali registrazioni
  -- simultanee: solo la prima puo' vedere la tabella dei profili vuota.
  perform 1
  from public.app_settings
  where key = 'bootstrap_first_admin'
    and (value #>> '{}')::boolean
  for update;

  v_is_first := found and not exists (select 1 from public.profiles);

  if v_is_first then
    v_role := 'hr';
    v_active := true;
  end if;

  insert into public.profiles (id, email, full_name, role, is_active)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    v_role,
    v_active
  )
  on conflict (id) do nothing;

  -- Finestra richiusa: da ora in poi ogni nuovo accesso non censito resta in
  -- attesa di attivazione da parte dell'HR.
  if v_is_first then
    update public.app_settings
    set value = 'false'::jsonb
    where key = 'bootstrap_first_admin';
  end if;

  return new;
end;
$$;

-- Il trigger su auth.users e' gia' in essere: CREATE OR REPLACE della funzione
-- e' sufficiente, non serve ricrearlo.
