-- ===========================================================================
-- ChamaHub - 23. La manutenzione fa uscire davvero
-- ===========================================================================
-- Cosa cambia rispetto alla 22
-- ----------------------------
-- Prima, attivando la manutenzione, chi era collegato si trovava davanti la
-- schermata e non poteva piu' fare niente - ma la sua sessione restava aperta.
-- Era un blocco effettivo, non un'uscita: a manutenzione finita si ritrovava
-- dentro senza rifare l'accesso.
--
-- Adesso le sessioni vengono chiuse davvero. Chi rientra deve autenticarsi di
-- nuovo, e nel frattempo trova la pagina di manutenzione al posto del login.
--
-- Cosa significa "chiudere una sessione"
-- --------------------------------------
-- In Supabase l'autenticazione poggia su due oggetti con vite diverse:
--
--   * il REFRESH TOKEN, che vive in `auth.sessions` e serve a ottenere nuovi
--     token di accesso. Cancellare quella riga lo rende inutilizzabile:
--     e' questa la parte che si puo' revocare, ed e' quella che conta;
--
--   * il TOKEN DI ACCESSO, un JWT firmato che vale un'ora. Nessuno puo'
--     revocarlo, per costruzione: e' un foglio con una firma sopra, e chi lo
--     ha in mano lo ha in mano. Sarebbe disonesto scrivere qui che viene
--     "invalidato".
--
-- Da qui la scelta di NON fondare la sicurezza sull'uscita. Il blocco vero
-- resta la policy `restrictive` della migrazione 22, che risponde "no" a
-- chiunque non sia SystemAdmin indipendentemente da quale token esibisca. Chi
-- avesse un token di accesso ancora fresco continuerebbe a farsi riconoscere,
-- e continuerebbe a non poter leggere ne' scrivere niente.
--
-- L'uscita e' quindi una conseguenza voluta, non la difesa: serve perche' la
-- prossima volta si passi dal login, e perche' nessuno resti con una finestra
-- aperta su un'applicazione che non e' piu' sua.
--
-- Perche' il SystemAdmin sopravvive
-- ---------------------------------
-- Perche' e' l'unico che puo' riaprire. Chiudergli la sessione insieme alle
-- altre significherebbe costringerlo a rientrare da una pagina di login che la
-- manutenzione ha appena sostituito con una schermata di cortesia.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Chiudere le sessioni
-- ---------------------------------------------------------------------------
-- La funzione tocca lo schema `auth`, che non e' nostro. Due precauzioni:
--
--   * si verifica che le tabelle esistano prima di usarle. Su Supabase ci
--     sono; sullo stub locale del collaudo no, e una migrazione che fallisce
--     li' sarebbe una migrazione che non si puo' collaudare;
--
--   * non si tocca `auth.users`. Cancellare una sessione e' reversibile con un
--     nuovo accesso; toccare gli utenti non lo e'.
create or replace function public.terminate_sessions_except_sysadmin()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
begin
  if to_regclass('auth.sessions') is null then
    -- Ambiente senza lo schema auth completo (il collaudo locale): non c'e'
    -- niente da chiudere, e non e' un errore.
    return 0;
  end if;

  -- I token di aggiornamento pendono dalla sessione: si tolgono prima, dove
  -- la tabella esiste, per non lasciare righe orfane.
  if to_regclass('auth.refresh_tokens') is not null then
    execute $q$
      delete from auth.refresh_tokens rt
      where rt.session_id in (
        select s.id from auth.sessions s
        where s.user_id not in (
          select p.id from public.profiles p where p.role = 'sysadmin'
        )
      )
    $q$;
  end if;

  execute $q$
    delete from auth.sessions s
    where s.user_id not in (
      select p.id from public.profiles p where p.role = 'sysadmin'
    )
  $q$;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.terminate_sessions_except_sysadmin() is
  'Chiude le sessioni di tutti tranne i SystemAdmin. Revoca i refresh token; i token di accesso gia'' emessi restano validi fino alla scadenza ma non superano le policy.';

revoke all on function public.terminate_sessions_except_sysadmin() from public;

-- ---------------------------------------------------------------------------
-- 2. L'accensione della manutenzione le chiude
-- ---------------------------------------------------------------------------
create or replace function public.set_maintenance(
  p_enabled boolean,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_stato  jsonb;
  v_chiuse integer := 0;
begin
  if not public.is_sysadmin() then
    raise exception 'Solo un SystemAdmin puo'' cambiare la modalita'' manutenzione.'
      using errcode = '42501';
  end if;

  v_stato := jsonb_build_object(
    'enabled', p_enabled,
    'message', nullif(btrim(coalesce(p_message, '')), ''),
    'since', case when p_enabled then to_jsonb(now()) else null end,
    'by', to_jsonb(v_uid)
  );

  update public.app_settings
  -- `updated_at` lo scrive il trigger app_settings_set_updated_at.
  set value = v_stato
  where key = 'maintenance';

  -- L'ordine conta: prima si scrive lo stato, poi si chiudono le sessioni.
  -- Al contrario, fra la chiusura e la scrittura ci sarebbe una finestra in
  -- cui qualcuno puo' riautenticarsi e rientrare in un'applicazione che
  -- risulta ancora aperta.
  if p_enabled then
    v_chiuse := public.terminate_sessions_except_sysadmin();
  end if;

  return v_stato || jsonb_build_object('sessions_closed', v_chiuse);
end;
$$;

comment on function public.set_maintenance(boolean, text) is
  'Accende o spegne la manutenzione. Accendendola chiude le sessioni di tutti tranne i SystemAdmin. Riservata al SystemAdmin.';

revoke all on function public.set_maintenance(boolean, text) from public;
grant execute on function public.set_maintenance(boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. E anche chi si autentica durante la manutenzione
-- ---------------------------------------------------------------------------
-- Chiudere le sessioni all'accensione non basta: fra l'accensione e lo
-- spegnimento qualcuno puo' comunque completare un accesso - il login di
-- GoTrue non passa dalle nostre policy - e ritrovarsi con una sessione nuova
-- di zecca su un'applicazione chiusa.
--
-- Non si puo' impedire a GoTrue di autenticare, ma si puo' fare in modo che
-- quella sessione non sopravviva: il trigger la cancella appena nasce.
-- L'interfaccia mostra comunque la schermata di manutenzione, quindi da fuori
-- si vede semplicemente che non si entra.
create or replace function public.reject_session_during_maintenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.maintenance_active()
     and not exists (
       select 1 from public.profiles p
       where p.id = new.user_id and p.role = 'sysadmin'
     )
  then
    return null;
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('auth.sessions') is not null then
    execute 'drop trigger if exists chamahub_maintenance_gate on auth.sessions';
    execute
      'create trigger chamahub_maintenance_gate '
      'before insert on auth.sessions '
      'for each row execute function public.reject_session_during_maintenance()';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Una nota per chi legge fra un anno
-- ---------------------------------------------------------------------------
-- Il trigger vive su una tabella dello schema `auth`, che appartiene a
-- Supabase: un aggiornamento della piattaforma potrebbe ricrearla e portarselo
-- via. Se un giorno la manutenzione lasciasse entrare qualcuno, e' il primo
-- posto da guardare - e la migrazione si rilancia senza effetti collaterali,
-- perche' e' scritta per essere rieseguibile.
--
-- In ogni caso il danno sarebbe limitato: entrerebbe in un'applicazione che
-- non gli restituisce niente, e vedrebbe la schermata di manutenzione.
