-- ===========================================================================
-- ChamaHub - 22. Modalita' manutenzione
-- ===========================================================================
-- Un interruttore che il SystemAdmin puo' abbassare quando deve lavorare sul
-- sistema senza che nessuno ci scriva dentro. Chi e' collegato viene fatto
-- uscire, chi prova a entrare trova una pagina che spiega cosa sta succedendo.
--
-- Perche' il SystemAdmin resta dentro
-- -----------------------------------
-- Perche' altrimenti l'interruttore sarebbe a senso unico: abbassandolo si
-- chiuderebbe fuori anche chi deve rialzarlo, e l'unico modo di rientrare
-- sarebbe una query sul database. Un comando che puo' rendersi irreversibile
-- non e' un comando, e' una trappola.
--
-- Dove vive lo stato
-- ------------------
-- In `app_settings`, la stessa tabella della finestra di primo avvio: e' gia'
-- il posto delle impostazioni di sistema, ed e' gia' leggibile senza
-- autenticazione per la parte che serve alla pagina di accesso.
--
-- Perche' la lettura e' pubblica
-- ------------------------------
-- La pagina di accesso deve poter dire "e' in corso la manutenzione" a chi non
-- ha ancora una sessione - anzi, soprattutto a lui. L'unica informazione che
-- trapela e' che il sistema e' fermo, che e' esattamente cio' che si vuole
-- comunicare.
--
-- Il blocco NON e' solo nell'interfaccia
-- --------------------------------------
-- Una schermata si aggira con un ricaricamento; le policy no. Durante la
-- manutenzione `is_active_user()` risponde "no" a chiunque non sia
-- SystemAdmin, e da li' cade tutto il resto: niente letture, niente scritture.
-- La pagina e' la spiegazione, la policy e' il blocco.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Lo stato
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value, description)
values (
  'maintenance',
  jsonb_build_object('enabled', false, 'message', null, 'since', null),
  'Modalita'' manutenzione: quando enabled e'' true solo i SystemAdmin possono operare.'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Leggere lo stato
-- ---------------------------------------------------------------------------
create or replace function public.maintenance_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select value from public.app_settings where key = 'maintenance'),
    jsonb_build_object('enabled', false, 'message', null, 'since', null)
  )
$$;

comment on function public.maintenance_state() is
  'Stato della manutenzione. Interrogabile anche senza sessione: la pagina di accesso deve poterlo dire a chi non e'' ancora entrato.';

-- Deve rispondere anche a chi non ha una sessione.
revoke all on function public.maintenance_state() from public;
grant execute on function public.maintenance_state() to anon, authenticated;

create or replace function public.maintenance_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((public.maintenance_state() ->> 'enabled')::boolean, false)
$$;

-- ---------------------------------------------------------------------------
-- 3. Il blocco vero
-- ---------------------------------------------------------------------------
-- `is_active_user()` e' il presupposto di quasi ogni policy dell'applicazione:
-- aggiungendo qui la condizione, la manutenzione si propaga ovunque senza
-- toccare una policy alla volta - e senza il rischio di dimenticarne una.
--
-- Il SystemAdmin non ci passa: per lui l'applicazione continua a funzionare,
-- ed e' cosi' che puo' verificare di persona che tutto sia a posto prima di
-- riaprire.
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active
      and (
        not public.maintenance_active()
        or p.role = 'sysadmin'
      )
  )
$$;

comment on function public.is_active_user() is
  'Profilo attivo e abilitato a operare. Durante la manutenzione risponde "no" a chiunque non sia SystemAdmin.';

-- ---------------------------------------------------------------------------
-- 4. Accendere e spegnere
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
  v_uid   uuid := (select auth.uid());
  v_stato jsonb;
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

  return v_stato;
end;
$$;

comment on function public.set_maintenance(boolean, text) is
  'Accende o spegne la manutenzione. Riservata al SystemAdmin.';

revoke all on function public.set_maintenance(boolean, text) from public;
grant execute on function public.set_maintenance(boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Una nota su `is_sysadmin()`
-- ---------------------------------------------------------------------------
-- Non passa da `is_active_user()`: guarda direttamente il profilo. Se ci
-- passasse, durante la manutenzione risponderebbe "no" anche al SystemAdmin e
-- l'interruttore si bloccherebbe da solo in posizione chiusa. E' il genere di
-- dipendenza circolare che si scopre solo quando serve rialzare la serranda.

-- ---------------------------------------------------------------------------
-- 6. Il blocco, davvero su tutto
-- ---------------------------------------------------------------------------
-- Mettere la condizione dentro `is_active_user()` copre la maggior parte delle
-- policy, ma non tutte: quelle che riguardano i propri dati sono spesso scritte
-- come `profile_id = auth.uid()` e basta - non hanno mai avuto bisogno di
-- chiedere altro. Durante la manutenzione un dipendente avrebbe continuato a
-- leggere e scrivere il proprio calendario.
--
-- La copertura completa si ottiene con policy RESTRICTIVE: a differenza di
-- quelle normali, che si sommano fra loro con un OR, queste si moltiplicano -
-- vengono messe in AND con tutte le altre. Una per tabella, e nessuna policy
-- esistente va toccata: e' l'unico modo di aggiungere una condizione globale
-- senza riscrivere trenta regole e sperare di non averne dimenticata una.
create or replace function public.can_operate()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not public.maintenance_active() or public.is_sysadmin()
$$;

comment on function public.can_operate() is
  'Falso per tutti tranne i SystemAdmin quando la manutenzione e'' attiva. Usata come policy restrittiva su ogni tabella.';

do $$
declare
  v_tab text;
begin
  foreach v_tab in array array[
    'app_settings', 'area_managers', 'areas', 'calendar_entries',
    'evaluation_answers', 'evaluation_campaign_areas', 'evaluation_campaigns',
    'evaluation_questions', 'evaluation_templates', 'evaluations',
    'impersonation_log', 'notifications', 'profiles', 'request_areas',
    'request_messages', 'requests', 'satisfaction_answers',
    'satisfaction_questions', 'satisfaction_submissions', 'satisfaction_surveys'
  ] loop
    execute format(
      'drop policy if exists "maintenance_block" on public.%I', v_tab);
    execute format(
      'create policy "maintenance_block" on public.%I as restrictive '
      'to authenticated using (public.can_operate()) '
      'with check (public.can_operate())', v_tab);
  end loop;
end;
$$;

-- Due tabelle restano fuori, di proposito:
--
--   `password_reset_requests` -> ci scrive la Edge Function pubblica del
--     recupero password, che non ha una sessione. Bloccarla durante la
--     manutenzione non aggiungerebbe sicurezza e romperebbe un percorso che
--     non tocca nessun dato aziendale.
--
--   `satisfaction_throttle`   -> stessa ragione, dal lato del gradimento
--     anonimo.
