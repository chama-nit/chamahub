-- ===========================================================================
-- ChamaHub - creazione dell'utente di sistema (amministratore HR)
-- ===========================================================================
-- Da eseguire UNA VOLTA nel SQL Editor di Supabase, dopo aver applicato le
-- migrazioni. Crea un account con email e password gia' confermato e con ruolo
-- HR, cosi' da poter entrare subito nell'applicazione.
--
-- ISTRUZIONI
--   1. Cambia i tre valori nel blocco "PARAMETRI" qui sotto.
--   2. Incolla tutto nel SQL Editor di Supabase ed esegui.
--   3. Accedi all'applicazione con quell'email e quella password.
--   4. Cambia la password dalla pagina «Il mio profilo».
--
-- Lo script e' idempotente: se l'email esiste gia', non crea un doppione ma si
-- limita a promuovere quel profilo a HR attivo.
--
-- ALTERNATIVA SENZA SQL
--   Dashboard Supabase -> Authentication -> Users -> Add user, spuntando
--   «Auto Confirm User». Poi esegui lo script 02_promuovi_a_hr.sql.
-- ===========================================================================

do $$
declare
  -- ======================== PARAMETRI: modifica qui ========================
  v_email    text := 'admin@chamahub.local';
  v_password text := 'CambiaQuestaPassword!2026';
  v_name     text := 'Amministratore di sistema';
  -- =========================================================================

  v_user_id uuid;
  v_existing uuid;
begin
  v_email := lower(btrim(v_email));

  if length(v_password) < 8 then
    raise exception 'La password deve avere almeno 8 caratteri.';
  end if;

  select id into v_existing from auth.users where lower(email) = v_email;

  if v_existing is not null then
    -- L'utente esiste gia' (creato dal Dashboard o da un accesso precedente):
    -- ci si limita a completarne il profilo.
    update public.profiles
    set role = 'hr',
        is_active = true,
        full_name = case
          when btrim(coalesce(full_name, '')) = '' then v_name
          else full_name
        end
    where id = v_existing;

    raise notice 'Utente gia'' esistente: profilo promosso a HR attivo (%).', v_email;
    return;
  end if;

  v_user_id := extensions.gen_random_uuid();

  -- ------------------------------------------------------------------------
  -- Utente di autenticazione
  -- ------------------------------------------------------------------------
  -- `email_confirmed_at` valorizzato subito: l'account e' utilizzabile senza
  -- passare dalla mail di conferma.
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    v_email,
    extensions.crypt(v_password, extensions.gen_salt('bf')),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('full_name', v_name),
    now(),
    now()
  );

  -- ------------------------------------------------------------------------
  -- Identita' collegata (necessaria perche' l'accesso con password funzioni)
  -- ------------------------------------------------------------------------
  insert into auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  values (
    extensions.gen_random_uuid(),
    v_user_id,
    v_user_id::text,
    jsonb_build_object(
      'sub', v_user_id::text,
      'email', v_email,
      'email_verified', true,
      'phone_verified', false
    ),
    'email',
    now(),
    now(),
    now()
  );

  -- ------------------------------------------------------------------------
  -- Profilo applicativo
  -- ------------------------------------------------------------------------
  -- Il trigger `handle_new_user` ha gia' creato la riga; qui si forza in ogni
  -- caso il ruolo HR, anche se la finestra di primo avvio era gia' chiusa.
  update public.profiles
  set role = 'hr',
      is_active = true,
      full_name = v_name
  where id = v_user_id;

  -- La finestra di primo avvio non serve piu': un amministratore esiste.
  update public.app_settings
  set value = 'false'::jsonb
  where key = 'bootstrap_first_admin';

  raise notice 'Amministratore creato: % (ricordati di cambiare la password al primo accesso).', v_email;
end $$;

-- Verifica: deve comparire una riga con role = hr e is_active = true.
select email, full_name, role, is_active
from public.profiles
order by created_at;
