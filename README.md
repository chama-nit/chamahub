# ChamaHub

Applicazione per la gestione del reparto HR: calendario di presenze e smart
working, richieste al responsabile e all'HR, schede di valutazione e questionari
di gradimento anonimi con dashboard KPI.

L'applicazione gira **interamente sul frontend**: non esiste un backend
applicativo e nessuna logica di calcolo vive sul server Next.js. Tutto il
comportamento sensibile e' delegato a Supabase, in due modi complementari:

* **Row Level Security** su ogni tabella: chi interroga il database dal browser
  riceve soltanto le righe che gli competono, anche se manipola le chiamate;
* **Edge Function** per le operazioni che richiedono privilegi elevati (creare
  utenti, consegnare una scheda, registrare una risposta anonima). La chiave
  `service_role` vive solo li' dentro e non compare mai nel bundle.

---

## Indice

1. [Stack tecnologico](#stack-tecnologico)
2. [Ruoli e funzionalita'](#ruoli-e-funzionalita)
3. [Avvio rapido](#avvio-rapido)
4. [Configurazione di Supabase](#configurazione-di-supabase)
5. [Accesso con Microsoft Entra ID](#accesso-con-microsoft-entra-id)
6. [Creare il primo utente HR](#creare-il-primo-utente-hr)
7. [Nominare un SystemAdmin](#nominare-un-systemadmin)
8. [Struttura del progetto](#struttura-del-progetto)
9. [Tema chiaro e scuro](#tema-chiaro-e-scuro)
10. [Marchio, colori e email](#marchio-colori-e-email)
11. [Modello di sicurezza](#modello-di-sicurezza)
12. [Anonimato del gradimento](#anonimato-del-gradimento)
13. [Collaudo delle policy](#collaudo-delle-policy)
14. [Scelte progettuali e limiti noti](#scelte-progettuali-e-limiti-noti)

---

## Stack tecnologico

| Componente | Scelta |
|---|---|
| Framework | Next.js 16 (App Router, tutte le pagine `"use client"`) |
| UI | React 19 + MUI 9 |
| Linguaggio | TypeScript in modalita' `strict` |
| Backend | Supabase (PostgreSQL + Auth + Edge Function su Deno) |
| Grafici | SVG scritto a mano, nessuna libreria di charting |
| Temi | chiaro e scuro (predefinito lo scuro), su variabili CSS |

Non ci sono API route, Server Action o componenti server con logica: il server
Next.js si limita a servire l'applicazione.

---

## Ruoli e funzionalita'

### Dipendente

* Calendario personale: presenza in ufficio, smart working, assenza (ferie,
  permesso, malattia, altro), su giornata intera o mezza giornata, anche su un
  intervallo di date in un colpo solo.
* Scheda di gradimento anonima, sempre compilabile.
* Richieste al proprio responsabile o al reparto HR, con categoria
  (attrezzatura, formazione, amministrativa, altro) e thread di conversazione.
  Ferie e permessi non sono categorie di richiesta: si comunicano dal
  calendario.
* Compilazione della propria autovalutazione, che il responsabile dell'area
  puo' rivedere e correggere lasciando traccia di chi e quando.
* Consultazione delle valutazioni scritte dal responsabile, ma solo dopo la
  consegna, in una tabella separata dalle proprie autovalutazioni.

### Responsabile di area

Tutto quanto sopra, piu':

* Calendario dell'intera area, filtrabile per persona, in sola lettura.
* Elenco delle persone dell'area con lo stato della giornata corrente.
* Compilazione delle schede di valutazione dei propri collaboratori e della
  propria autovalutazione, in due tabelle distinte.
* Revisione e correzione delle autovalutazioni dei collaboratori dell'area,
  anche dopo la consegna: ogni intervento viene marcato e mostrato al diretto
  interessato.
* Gestione delle richieste ricevute (presa in carico e chiusura).

### HR

* Anagrafica dipendenti: creazione, modifica, assegnazione all'area, nomina a
  responsabile, disattivazione, eliminazione, generazione di un link di
  reimpostazione password da consegnare a mano.
* Gestione delle aree aziendali.
* Calendario dell'intera azienda, filtrabile per area e per dipendente.
* Lettura e gestione di tutte le richieste, comprese quelle indirizzate ai
  responsabili. L'HR non ne apre: e' il destinatario, non un mittente, e una
  richiesta dell'HR all'HR non avrebbe nessuno a cui arrivare (il divieto e'
  scritto nelle policy, non solo nell'interfaccia).
* Costruttore di modelli di scheda (domande a scala numerica e a testo libero,
  con peso e obbligatorieta').
* Campagne di valutazione: creazione, modifica ed eliminazione **finche' sono
  in bozza**, poi apertura, sincronizzazione, chiusura e avanzamento per area.
  Una campagna in bozza mostra quante schede genererebbe all'apertura, cosi' si
  vede subito se le aree scelte producono qualcosa. All'apertura viene generata
  un'autovalutazione per ogni persona coinvolta, non solo per i responsabili.
* Elenco di tutte le valutazioni dell'azienda (pagina "Tutte le valutazioni"),
  raggruppabili per area o per persona e filtrabili per campagna, tipo di
  scheda e stato.
* Questionari di gradimento e dashboard KPI con medie per area, andamento
  mensile **con una linea per area** (nel colore dell'area, piu' la media
  aziendale tratteggiata come riferimento), dettaglio per domanda, commenti
  anonimi e tabella riepilogativa
  (sempre presente: e' la versione leggibile da uno screen reader). I riquadri
  si riordinano per trascinamento o con le frecce e si allargano a mezza o
  intera larghezza; la disposizione resta salvata sul browser.

### SystemAdmin

Il ruolo sopra l'HR. Serve a chi tiene in piedi l'applicazione, non a chi ci
lavora dentro:

* tutto quello che puo' fare l'HR;
* **impersonificazione**: entra nei panni di una persona e vede l'applicazione
  con i suoi occhi - menu, permessi e dati, perche' da quel momento le policy
  RLS valutano il suo identificativo. Una striscia gialla sempre visibile
  ricorda nei panni di chi si sta lavorando, e ogni ingresso resta scritto in
  un registro consultabile solo dai SystemAdmin;
* non apre richieste, come l'HR.

**Il ruolo non si assegna dall'applicazione**, nemmeno da un altro SystemAdmin:
si ottiene solo dal database, con `supabase/scripts/03_crea_systemadmin.sql`.
E' voluto: un ruolo che sta sopra a tutti non deve essere raggiungibile da
dentro, altrimenti basta un account HR compromesso per prendersi le chiavi di
casa. Per la stessa ragione l'HR non puo' modificare ne' disattivare un profilo
SystemAdmin.

---

## Avvio rapido

```bash
npm install
cp .env.example .env.local     # e compila i due valori
npm run dev
```

L'applicazione parte anche senza configurazione Supabase: la pagina di login
mostra un avviso e i comandi restano disabilitati finche' le variabili non sono
valorizzate.

Script disponibili:

| Comando | Cosa fa |
|---|---|
| `npm run dev` | server di sviluppo |
| `npm run build` | build di produzione |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:push` | applica le migrazioni al progetto Supabase collegato |
| `npm run db:types` | rigenera i tipi TypeScript dal database |
| `npm run functions:deploy` | pubblica le sei Edge Function |

---

## Configurazione di Supabase

### 1. Creare il progetto

Su [supabase.com](https://supabase.com) crea un nuovo progetto e annota:

* **Project URL** (Settings → API)
* **anon / publishable key** (Settings → API)
* **Reference ID** (Settings → General)

Metti i primi due in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

> La chiave `service_role` **non** va in questo file e non va mai messa in una
> variabile `NEXT_PUBLIC_*`: finirebbe nel bundle JavaScript scaricato da
> chiunque apra l'applicazione.

### 2. Collegare la CLI e applicare le migrazioni

```bash
npm install -g supabase          # oppure: brew install supabase/tap/supabase
supabase login
supabase link --project-ref <REFERENCE_ID>
supabase db push
```

`db push` applica in ordine i diciassette file in `supabase/migrations/`, che creano
tabelle, tipi, funzioni, policy RLS e i contenuti predefiniti (un modello di
valutazione, un modello di autovalutazione e un questionario di gradimento gia'
pronti).

### 3. Pubblicare le Edge Function

```bash
supabase functions deploy admin-users
supabase functions deploy submit-satisfaction
supabase functions deploy submit-evaluation
supabase functions deploy manage-campaign
supabase functions deploy impersonate
supabase functions deploy request-password-reset
```

oppure, in un colpo solo, `npm run functions:deploy`.

Durante il deploy la CLI stampa due avvisi che si possono ignorare:

| Avviso | Perche' compare |
|---|---|
| `config section [inbucket] is deprecated` | vecchio nome di una sezione di `config.toml` che riguarda solo la cattura delle email in locale. Nel progetto e' gia' rinominata in `[local_smtp]`: se lo vedi ancora, hai una copia vecchia del file. |
| `WARNING: Docker is not running` | Docker serve solo a far girare Supabase in locale (`supabase start`). La pubblicazione avviene sui server di Supabase, quindi non serve. |

Alla fine devono comparire **cinque** righe `Deployed Functions on project ...`,
una per funzione. Se `impersonate` non c'e', il Pannello di sistema risponde
"Errore interno del server" quando prova a impersonare qualcuno.

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` vengono iniettate automaticamente
da Supabase nell'ambiente delle funzioni: non serve configurarle. Sono
disponibili due secret facoltativi:

```bash
# Limita le origini ammesse dal CORS (consigliato in produzione)
supabase secrets set ALLOWED_ORIGIN=https://chamahub.tuodominio.it

# Attiva il limite anonimo di una compilazione di gradimento al mese
supabase secrets set SATISFACTION_THROTTLE_SECRET=<stringa lunga e casuale>
```

### 4. URL di reindirizzamento

In **Authentication → URL Configuration** imposta:

* Site URL: `http://localhost:3000` in sviluppo, il dominio reale in produzione
* Redirect URLs: aggiungi `<dominio>/auth/callback`

### 5. Email: cosa ne dipende davvero

Quasi tutta l'applicazione funziona **senza** un server di posta. Vale la pena
sapere quali sono le poche azioni che invece lo richiedono, perche' quando
l'SMTP e' rotto falliscono solo quelle:

| Azione | Serve l'SMTP? |
|---|---|
| Creare un dipendente | **no, mai** |
| Spedire l'email «imposta la password» alla creazione | si', ma e' facoltativa e il suo fallimento non blocca nulla |
| «Genera link di reimpostazione» dalla pagina Dipendenti | no |
| «Ho dimenticato la password» dalla pagina di login | si', ma non blocca piu' nulla: vedi qui sotto |
| Conferma dell'indirizzo alla registrazione | si', se le conferme sono attive (ma ChamaHub non le usa) |
| Tutto il resto (calendario, richieste, valutazioni, gradimento) | no |

La creazione di un dipendente e' deliberatamente separata dall'invio dell'email:
prima si crea l'account con una password temporanea - operazione che non tocca la
posta e non puo' fallire per colpa sua - e solo dopo, se richiesto, si tenta la
spedizione. Se il servizio di posta non risponde entro 10 secondi l'operazione si
chiude comunque con successo, mostrando la password temporanea e un avviso che
l'email non e' partita.

**Le email non passano dal servizio di posta di Supabase.** Le Edge Function
generano il link con `generateLink()` - che non spedisce niente, e' un'operazione
locale al database di autenticazione - e poi spediscono da sole tramite
`supabase/functions/_shared/mailer.ts`, che sceglie fra Microsoft Graph, un
servizio HTTPS e SMTP secondo i secret presenti. Il riquadro *Authentication →
Emails → SMTP Settings* puo' restare vuoto.

Il motivo e' che quel riquadro accetta host, utente e password, e nient'altro.
Verso Microsoft 365 quella strada e' in chiusura: la password di casella smette
di funzionare per impostazione predefinita a fine 2026, e l'unico SMTP che
Microsoft continuera' ad accettare e' quello autenticato via OAuth, che il campo
"password" non sa parlare. Aggiungere autorizzazioni alla registrazione Entra ID
non cambia niente - e' proprio Supabase che non ha dove mettere un token. Graph
ottiene lo stesso risultato con una POST HTTPS.

Il secondo motivo e' piu' immediato: una chiamata che non risponde la si puo'
interrompere e raccontare, mentre dentro il servizio di Supabase resta appesa
fino al timeout della piattaforma. E' da li' che nasceva il `504` e il messaggio
«il server di posta non ha risposto entro N secondi».

Per spedire dalla casella aziendale Microsoft 365 c'e' una guida dedicata:
[`docs/email-microsoft-smtp.md`](docs/email-microsoft-smtp.md).

Se un'email non parte, il posto dove guardare e' **Logs → Edge Functions** nel
Dashboard di Supabase. Il log dice sempre da quale canale e' uscita
(`invito inviato via microsoft graph (...)`) o perche' non e' uscita, e in caso
di guasto riporta comunque il link generato, che l'HR puo' consegnare a mano.

### 6. «Ho dimenticato la password»

Questo modulo non passa piu' dal servizio di posta di Supabase, ma dalla Edge
Function `request-password-reset`. Il motivo e' concreto: la chiamata standard
resta appesa finche' Supabase non riesce a spedire, e con un SMTP che non
risponde il browser si prende un **504** senza sapere che fine abbia fatto la
richiesta.

La funzione risponde **subito** - sempre lo stesso messaggio, per qualunque
indirizzo - e genera il link e lo spedisce in sottofondo. Il 504 sparisce per
costruzione: nessuno aspetta piu' la posta.

Come spedisce, in ordine di precedenza:

```bash
# 1. Microsoft Graph - consigliata se l'azienda e' su Microsoft 365.
#    L'autorizzazione e' Mail.Send DI TIPO APPLICAZIONE su una registrazione
#    Entra ID dedicata, diversa da quella del login: vedi docs/.
supabase secrets set MS_TENANT_ID=<id-directory>
supabase secrets set MS_CLIENT_ID=<id-applicazione>
supabase secrets set MS_CLIENT_SECRET='<segreto>'
supabase secrets set MS_MAIL_SENDER=no-reply@tuodominio.it

# 2. oppure Resend (o qualunque servizio con API HTTPS analoga)
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set MAIL_FROM="ChamaHub <no-reply@tuodominio.it>"

# 3. oppure un server SMTP che non sia Microsoft 365
supabase secrets set SMTP_HOST=smtp.tuodominio.it
supabase secrets set SMTP_PORT=587          # 465 per TLS diretto
supabase secrets set SMTP_USER=no-reply@tuodominio.it
supabase secrets set SMTP_PASS=********
supabase secrets set MAIL_FROM="ChamaHub <no-reply@tuodominio.it>"
```

I secret si leggono all'avvio della funzione: dopo averli impostati **va
ridistribuita**, altrimenti continua a non vederli. Vale per entrambe le
funzioni che spediscono, `admin-users` e `request-password-reset`.

**Senza nessuno dei tre** la funzione genera comunque il link e lo scrive nei
log della funzione, dove lo vede solo chi amministra il progetto: il recupero
resta possibile a mano mentre si sistema la posta. Resta valida anche la strada
gia' presente in applicazione, che non ha mai avuto bisogno di email: l'HR apre
la scheda del dipendente e usa **«Genera link di reimpostazione»**.

Tre dettagli di sicurezza, tutti voluti:

* la risposta e' **identica** per un indirizzo registrato e per uno inventato,
  altrimenti il modulo diventerebbe un modo per scoprire chi lavora in azienda;
* massimo **tre richieste all'ora per indirizzo**: il modulo e' raggiungibile
  senza autenticazione, e senza limite chiunque potrebbe sommergere di email la
  casella di un collega;
* la funzione e' l'unica pubblicata **senza verifica del token**
  (`verify_jwt = false` in `supabase/config.toml`), perche' chi ha perso la
  password non ha nessuna sessione con cui presentarsi.

Chi apre il link atterra direttamente sulla pagina del profilo, con la sezione
della password in evidenza: il collegamento vale una volta sola, quindi non ha
senso farlo passare dalla dashboard e lasciargli cercare dove si cambia.

Se le email non arrivano, i log della funzione dicono esattamente a che punto
si e' fermata: `email inviata via ...`, `invio fallito (...)` con il link
comunque stampato, oppure `nessun servizio di posta configurato`.

---

## Accesso con Microsoft Entra ID

L'SSO Microsoft e' **attivo**: il pulsante «Accedi con account Microsoft»
compare nella pagina di accesso. Se la registrazione su Azure non e' ancora
pronta si nasconde mettendo

```
NEXT_PUBLIC_MICROSOFT_LOGIN=off
```

in `.env.local` e ricostruendo l'applicazione.

All'accesso vengono chiesti tre soli dati - nome, cognome e indirizzo email
(`openid profile email`) - e servono a una cosa sola: riconoscere la persona.
**Un accesso Microsoft riuscito non basta per entrare**: se l'indirizzo non
corrisponde a un profilo attivo di ChamaHub la sessione viene chiusa subito e
compare l'invito a rivolgersi al reparto HR. La richiesta resta comunque
visibile all'HR fra i profili in attesa di attivazione, quindi basta
completarla senza ricreare nulla.

**Due guide dedicate:** [`docs/supabase-auth.md`](docs/supabase-auth.md) per la
configurazione lato Supabase (provider, URL di ritorno, sessioni) e
[`docs/microsoft-entra-id.md`](docs/microsoft-entra-id.md) per la registrazione
su Azure. Qui il riassunto:

### Lato Azure

1. **Azure Portal → Microsoft Entra ID → Registrazioni app → Nuova
   registrazione**. Nome: `ChamaHub`.
2. Tipo di account supportato: *Solo account in questa directory
   organizzativa* (se serve solo al personale interno).
3. **URI di reindirizzamento** → tipo *Web* →
   `https://<REFERENCE_ID>.supabase.co/auth/v1/callback`
   (in sviluppo locale con la CLI: `http://localhost:54321/auth/v1/callback`).
4. Annota **Application (client) ID** e **Directory (tenant) ID**.
5. **Certificati e segreti → Nuovo segreto client**: copia subito il *valore*
   (non l'ID), non sara' piu' visibile.
6. **Autorizzazioni API**: verifica che siano presenti `openid`, `email`,
   `profile`, `offline_access` di Microsoft Graph.

### Lato Supabase

**Authentication → Providers → Azure**, attiva e compila:

| Campo | Valore |
|---|---|
| Client ID | Application (client) ID |
| Secret | il valore del segreto client |
| Azure Tenant URL | `https://login.microsoftonline.com/<TENANT_ID>/v2.0` |

### Collegamento con i profili creati dall'HR

Se l'HR ha gia' creato il dipendente con la stessa email verificata, al primo
accesso Microsoft l'identita' viene collegata all'utente esistente e la persona
entra direttamente con il proprio ruolo e la propria area.

Se invece qualcuno accede con Microsoft **senza** essere stato censito, un
trigger crea comunque il profilo ma con `is_active = false`: quella persona vede
solo la schermata «Account in attesa di attivazione» e ogni policy RLS le nega
l'accesso ai dati. L'HR la trova in cima alla pagina Dipendenti con un avviso e
la attiva assegnandole un'area.

---

## Creare il primo utente HR

L'anagrafica si gestisce dalla sezione HR, ma per entrarci serve gia' un utente
HR. Ci sono due modi per rompere il cerchio; puoi usare quello che preferisci,
si escludono a vicenda.

### Modo 1 — dalla pagina di login (primo avvio)

Se il database non contiene ancora **alcun** profilo, la pagina di login mostra
al posto dell'accesso il modulo **«Primo avvio»**: nome, email, password. Il
primo account creato li' diventa automaticamente amministratore HR attivo.

Subito dopo la finestra si richiude da sola (il flag `bootstrap_first_admin` in
`app_settings` passa a `false`) e non si riapre: da quel momento chi si registra
o accede con Microsoft senza essere censito resta in attesa di attivazione.

> Perche' funzioni serve che la registrazione autonoma sia abilitata su Supabase
> (Authentication → Sign In / Providers → *Allow new users to sign up*). Se sono
> attive anche le conferme via email, dovrai aprire il link ricevuto prima di
> poter entrare. In caso di dubbio usa il Modo 2, che salta entrambi i passaggi.

### Modo 2 — script SQL (consigliato in produzione)

Apri il **SQL Editor** di Supabase e incolla
`supabase/scripts/01_crea_admin_di_sistema.sql`, dopo aver cambiato i tre
parametri in cima:

```sql
v_email    text := 'admin@chamahub.local';
v_password text := 'CambiaQuestaPassword!2026';
v_name     text := 'Amministratore di sistema';
```

Lo script crea l'utente con l'email gia' confermata, gli assegna il ruolo HR e
chiude la finestra di primo avvio. Accedi con quelle credenziali e cambia subito
la password da **Il mio profilo**.

E' idempotente: se l'email esiste gia' (per esempio creata dal Dashboard o da un
accesso Microsoft) non duplica nulla, si limita a promuovere quel profilo.

### Promuovere un utente esistente

Se l'account esiste gia' e ti serve solo dargli il ruolo HR, usa
`supabase/scripts/02_promuovi_a_hr.sql`.

> Un utente HR non puo' togliersi da solo il ruolo ne' disattivarsi: un trigger
> lo impedisce, per evitare di restare senza amministratori.

---

## Nominare un SystemAdmin

Il SystemAdmin non si crea dall'applicazione. Serve un account gia' esistente -
creato dall'HR oppure registrato al primo accesso - e poi una riga di SQL:

```sql
update public.profiles
set role = 'sysadmin', is_active = true
where lower(email) = lower('tua.email@azienda.it');
```

Lo script pronto, con le verifiche e il comando di revoca, sta in
`supabase/scripts/03_crea_systemadmin.sql`.

Da quel momento la persona vede tutte le sezioni piu' il **Pannello di
sistema**, da cui puo' entrare nei panni di chiunque non sia a sua volta
SystemAdmin. L'uscita avviene dalla striscia gialla in cima alla pagina; se il
browser viene chiuso a meta', alla riapertura la striscia e' ancora li'.

> Il ritorno nei propri panni si appoggia alla sessione salvata nel browser. Se
> quella sessione scade nel frattempo, l'applicazione riporta alla pagina di
> accesso: nessun blocco, solo un accesso da rifare.

---

## Struttura del progetto

```
app/
  layout.tsx              radice: provider MUI, tema, autenticazione
  login/                  accesso Microsoft + email/password + recupero
  auth/callback/          ritorno dal provider OAuth
  attivazione/            account creato ma non ancora abilitato
  (app)/                  area autenticata, con menu laterale per ruolo
    dashboard/            riepilogo per ruolo
    calendario/           calendario personale
    gradimento/           questionario anonimo
    richieste/            elenco + dettaglio con thread
    valutazioni/          schede da compilare e ricevute
    area/                 vista del responsabile sulla propria area
    profilo/              dati personali e cambio password
    hr/                   dipendenti, aree, calendario, modelli,
                          campagne, questionari, KPI
  icon.svg                IL LOGO. File del committente: non si rigenera
components/
  Logo.tsx                il marchio a schermo, usato ovunque compaia
  AppShell, calendario, costruttore domande, grafici
lib/
  brand.ts                nome, colori e logo (legge brand.json)
  theme.ts                tema MUI costruito su quei colori
  supabase/client.ts      unico punto di contatto con il backend
  auth/AuthProvider.tsx   sessione, profilo, reindirizzamenti
  types/models.ts         modelli di dominio
  labels.ts               etichette italiane degli enum
  format.ts               date e numeri
public/
  logo-email.png          conversione del logo per le email (Outlook non
  logo-email@2x.png       disegna gli SVG)
docs/
  microsoft-entra-id.md   guida completa all'SSO Microsoft
supabase/
  migrations/             17 file, da applicare in ordine
  functions/              6 Edge Function + codice condiviso:
    _shared/brand.json      FONTE UNICA di nome, colori e logo
    _shared/email.ts        impianto e testi delle email
    _shared/links.ts        i link monouso che finiscono nelle email
    _shared/mailer.ts       spedizione (Graph, Resend, SMTP)
    _shared/auth.ts         identita' del chiamante e ruoli
    _shared/cors.ts         intestazioni condivise
  scripts/                creazione dell'admin, promozione a HR
  tests/                  collaudo delle policy RLS e del primo avvio
```

### Le migrazioni

| File | Contenuto |
|---|---|
| `..._enums_and_helpers.sql` | tipi enumerati e utility |
| `..._core_areas_profiles.sql` | aree, profili, trigger su `auth.users`, helper RLS |
| `..._calendar.sql` | comunicazioni di presenza |
| `..._requests.sql` | richieste e conversazioni |
| `..._evaluations.sql` | modelli, campagne, schede, risposte |
| `..._satisfaction.sql` | gradimento anonimo e funzioni KPI |
| `..._views_and_kpi.sql` | viste di supporto e riepiloghi |
| `..._default_content.sql` | modelli e questionario predefiniti |
| `..._bootstrap_first_admin.sql` | finestra di primo avvio e promozione del primo account |
| `..._self_assessment_for_all.sql` | autovalutazione per tutti e correzione tracciata da parte del responsabile d'area |
| `..._hr_cannot_open_requests.sql` | il ruolo HR non puo' aprire richieste |
| `..._campaign_draft_guard.sql` | campagne modificabili e cancellabili solo in bozza |
| `..._correction_scores.sql` | punteggio prima e dopo la correzione, ricalcolato dal database |
| `..._sysadmin_role_value.sql` | il valore `sysadmin` nell'enumerazione dei ruoli |
| `..._sysadmin_permissions.sql` | permessi del SystemAdmin e registro delle impersonificazioni |
| `..._password_reset_requests.sql` | conteggio dei tentativi di recupero password |
| `..._area_default_color.sql` | colore predefinito delle nuove aree allineato alla tavolozza Chamanit |

### Le Edge Function

| Funzione | Perche' non basta RLS |
|---|---|
| `admin-users` | creare un utente significa scrivere in `auth.users`: serve la chiave `service_role`, che non puo' raggiungere il browser |
| `submit-satisfaction` | le tabelle del gradimento non sono scrivibili da nessun utente; la funzione verifica il token e scrive senza registrare l'autore |
| `submit-evaluation` | il punteggio va calcolato in un punto solo e non falsificabile; un trigger impedisce a chiunque altro di marcare una scheda come consegnata |
| `manage-campaign` | generare decine di schede intestate a persone diverse richiederebbe permessi di scrittura molto ampi sul client |
| `impersonate` | aprire una sessione a nome di un'altra persona richiede la chiave `service_role`; la funzione verifica che a chiederlo sia un SystemAdmin e scrive il registro degli accessi |
| `request-password-reset` | genera il link di recupero con `service_role` e lo spedisce per conto proprio, senza dipendere dal servizio di posta interno; e' l'unica funzione pubblica |

La spedizione vera e' in `_shared/mailer.ts`, condivisa fra `admin-users` e `request-password-reset`: sceglie fra Microsoft Graph (`Mail.Send` applicativo, consigliata), un servizio HTTPS come Resend, e SMTP con autenticazione di base, secondo i secret presenti.

---

## Tema chiaro e scuro

### La tavolozza

I colori sono quelli del company profile Chamanit:

| | | |
|---|---|---|
| `#0A0D16` nero blu | `#1B3B8C` blu | `#4A1B7A` viola |
| `#C238C4` magenta | `#E8865A` arancio | `#F4B594` pesca |
| `#FFFFFF` bianco | | |

Blu e viola fanno il lavoro pesante - sono il colore primario e quello
secondario, quindi la voce di menu attiva, i pulsanti, le intestazioni, le
pastiglie di ruolo. Magenta e arancio restano agli accenti e ai grafici, il nero
blu e' il fondo del tema scuro, e la pagina di accesso attraversa tutta la
sequenza in un gradiente.

Due scelte meritano una riga di spiegazione. La prima: i colori che dicono
"attenzione" o "errore" non sono stati sostituiti da blu e viola. Un pulsante di
eliminazione viola sarebbe elegante e pericoloso - chi lo guarda di fretta non
riconosce il segnale. Sono stati pero' riportati verso la famiglia della
tavolozza (l'arancio di avviso e' quello del marchio, il verde e' virato verso
il verde-azzurro dei grafici), cosi' convivono senza stonare. La seconda: ogni
tinta ha due gradini, uno per il fondo chiaro e uno per quello scuro. Il blu
`#1B3B8C` su `#0A0D16` e' praticamente invisibile; la sua versione schiarita
resta riconoscibilmente lo stesso blu del marchio.

Le aree gia' create nel database **non** cambiano colore: la tinta di un'area e'
una scelta di chi la gestisce, e riscriverla d'ufficio cambierebbe sotto gli
occhi dell'HR pastiglie e grafici a cui e' abituato. La migrazione
`..._area_default_color.sql` sposta solo il valore predefinito, cioe' il colore
che riceve un'area creata senza sceglierne uno. Per allineare le aree esistenti
si riaprono e si ripesca il colore dalla tavolozza proposta.

### Il passaggio fra i due temi

L'applicazione nasce **scura**. Nella barra in alto, e anche nella pagina di
accesso, un pulsante propone tre possibilita': chiaro, scuro e "come il
sistema" (segue l'impostazione del computer, comoda per chi la sera passa
automaticamente allo scuro). La scelta viene ricordata dal browser di chi l'ha
fatta: e' una preferenza personale di visualizzazione, non un dato aziendale,
quindi non viaggia fino al database.

Due dettagli tecnici che vale la pena conoscere prima di mettere le mani sui
colori:

* i colori sono **variabili CSS** generate da MUI (`cssVariables` in
  `lib/theme.ts`), non valori calcolati in JavaScript: cambiare tema significa
  cambiare un attributo su `<html>`, senza ridisegnare l'albero React;
* uno script inserito in `app/layout.tsx` applica il tema salvato **prima** del
  primo disegno della pagina. Senza, chi ha scelto il tema chiaro vedrebbe un
  lampo scuro a ogni caricamento. Il suo `attribute` deve restare allineato al
  `colorSchemeSelector` del tema, altrimenti scrive un attributo che nessuna
  regola CSS guarda e il lampo torna.

I colori delle comunicazioni di calendario (blu per l'ufficio, viola per lo
smart working, arancio per le assenze) hanno due versioni, definite in
`app/globals.css`: le tinte sature per il fondo chiaro sparirebbero sul nero
blu, quindi nel tema scuro si usano le varianti piu' chiare delle stesse tinte.

Stesso problema, stessa soluzione, per i colori delle aree nei grafici. Il
colore di un'area e' la sua identita' e non cambia con i filtri, ma su fondo
scuro alcune tinte sparirebbero: `lib/chart-colors.ts` tiene per ognuna il
gradino chiaro e quello scuro, e per i colori personalizzati calcola il gradino
che raggiunge un contrasto di almeno 3:1 con la superficie, mantenendo la
tinta. La tavolozza proposta all'HR e' una sequenza categorica verificata:
colori adiacenti restano distinguibili anche con una percezione ridotta dei
colori. Il colore non e' comunque mai l'unico portatore di identita' - la
legenda porta nome e ultimo valore di ogni area, e la vista tabellare e' sempre
presente.

---

## Marchio, colori e email

Tutto quello che rende ChamaHub riconoscibile sta in **un file solo**:
`supabase/functions/_shared/brand.json`. Nome, sottotitolo, tavolozza nei due
gradini (chiaro e scuro), gradiente della pagina di accesso, percorsi del logo,
piede delle email. Cambiare una tinta li' la cambia insieme nell'interfaccia e
nei messaggi, invece di lasciarne una indietro.

Vive sotto `supabase/functions/` per una ragione pratica, non estetica: deve
raggiungere due mondi che non condividono niente - il bundle di Next e quello
di Deno delle Edge Function. Il secondo puo' importare solo file di quella
cartella; il primo puo' importare da qualunque punto del progetto. E' l'unico
posto da cui li vedono entrambi.

Chi lo legge:

| | Da dove | Cosa ne fa |
|---|---|---|
| `lib/brand.ts` | applicazione | espone colori, nome e gradiente |
| `lib/theme.ts` | applicazione | costruisce le due palette MUI |
| `components/Logo.tsx` | applicazione | il marchio a schermo |
| `_shared/brand.ts` | Edge Function | colori e indirizzo pubblico |
| `_shared/email.ts` | Edge Function | intestazione e stili dei messaggi |

### Il logo

`app/icon.svg` e' **il file del committente**: non viene rigenerato, sostituito
o "migliorato" da nessuna parte. Chi vuole cambiarlo sostituisce quel file.

I due PNG in `public/` ne sono una conversione, e servono solo alle email:
Outlook non disegna gli SVG, e un logo che non si vede e' peggio di nessun logo.
Vanno rigenerati solo quando cambia l'originale.

### Le email

`_shared/email.ts` contiene un `renderEmail()` che disegna la cornice - logo,
titolo, paragrafi, pulsante, note, piede - e sotto i messaggi veri e propri,
che dicono soltanto cosa hanno da dire. Aggiungerne uno nuovo significa
scrivere il testo, non un'altra tabella HTML.

L'HTML e' volutamente arcaico (tabelle, stili in linea, misure in pixel) perche'
deve funzionare in Outlook, che impagina con il motore di Word. Ogni messaggio
esce in due versioni: HTML e testo semplice - quest'ultimo non e' un
adempimento, e' cio' che leggono i lettori di schermo e cio' che i filtri
antispam guardano per decidere se il messaggio e' legittimo.

Il tema scuro arriva da una `prefers-color-scheme` nell'intestazione. Il
supporto e' disomogeneo per natura - Apple Mail la rispetta, Gmail e Outlook a
volte impongono la propria - quindi la versione chiara e' quella "vera": se la
media query non arriva a destinazione il messaggio resta perfettamente
leggibile.

### I link, e da dove prendono l'indirizzo

`_shared/links.ts` e' l'unico punto in cui si decide che forma ha il
collegamento monouso che arriva alla persona. Lo usano l'invito, il recupero
password e il link che l'HR consegna a mano: se cambia la pagina che li riceve,
cambiano tutti e tre insieme. Chi li riceve e' `app/auth/callback/page.tsx`.

**L'indirizzo nel link viene da dove viene usata l'applicazione.** Il browser
manda `redirect_to` costruito su `window.location.origin`: chi apre ChamaHub su
`localhost:3000` genera email che puntano a localhost, chi la apre sul dominio
aziendale genera email che puntano li'. Non c'e' niente da configurare perche'
funzioni.

C'e' pero' qualcosa da configurare perche' sia **sicuro**, e in produzione non
e' facoltativo:

```bash
supabase secrets set APP_URL=https://chamahub.tuodominio.it

# facoltativo: altre origini ammesse, per sviluppo e collaudo
supabase secrets set APP_URL_ALLOWLIST="http://localhost:3000,https://collaudo.tuodominio.it"

supabase functions deploy admin-users
supabase functions deploy request-password-reset
```

Il motivo: `request-password-reset` e' pubblica per necessita' - chi ha perso la
password non ha una sessione da esibire - e il suo corpo contiene
`redirect_to`. Un corpo pubblico e' un corpo che scrive chiunque:

```
POST /functions/v1/request-password-reset
{ "email": "vittima@azienda.it",
  "redirect_to": "https://sito-malevolo.example/auth/callback" }
```

Senza `APP_URL`, la vittima riceverebbe un'email **autentica** - spedita dalla
casella aziendale vera, con SPF e DKIM in regola - il cui pulsante porta al sito
di chi ha scritto quella richiesta, con un token valido in mano. Un clic, e
quella pagina apre una sessione a nome della vittima.

Con `APP_URL` impostato, il link non si costruisce piu' concatenando la stringa
ricevuta: si parte da un'origine dell'elenco e sopra si rimettono percorso e
parametri decisi dal codice. `redirect_to` puo' al massimo *scegliere* fra le
origini ammesse, non aggiungerne, e non puo' iniettare ne' percorsi ne'
parametri. Le richieste fuori elenco continuano a funzionare - l'email parte
verso l'indirizzo ufficiale - e lasciano un avviso nei log.

Finche' il link era `action_link` il controllo lo faceva GoTrue, confrontando
`redirect_to` con l'elenco *Redirect URLs* del progetto. Passando a costruire
l'indirizzo nelle Edge Function quel controllo e' uscito di scena insieme al
resto, e andava rimesso: non lo fa piu' nessun altro.

---

## Modello di sicurezza

Ogni tabella ha RLS attivo. In sintesi:

Il SystemAdmin non compare nella tabella perche' ha ovunque i permessi
dell'HR: `is_hr()` risponde "si'" anche a lui.

| Dato | Dipendente | Responsabile | HR |
|---|---|---|---|
| Profili | il proprio + i colleghi della sua area | la propria area | tutti, in scrittura |
| Calendario | scrive e legge il proprio | legge quello della sua area | legge e scrive tutto |
| Richieste | le proprie | le proprie + quelle indirizzate al responsabile della sua area | tutte, in lettura e gestione; non puo' aprirne |
| Schede di valutazione | le proprie, solo dopo la consegna | quelle che deve compilare + le autovalutazioni della sua area | tutte |
| Gradimento (righe grezze) | nessun accesso | nessun accesso | **nessun accesso** |
| KPI di gradimento | nessun accesso | solo la propria area, sopra soglia | tutte le aree, sopra soglia |

Alcuni punti degni di nota:

* **Nessuno puo' auto-promuoversi.** Un trigger rifiuta qualunque modifica di
  `role`, `area_id` o `is_active` che non provenga da un HR. La policy di UPDATE
  da sola non basterebbe: permette di aggiornare la propria riga, e senza il
  trigger si potrebbe cambiare il proprio ruolo.
* **Le funzioni helper sono `SECURITY DEFINER`.** Interrogare `profiles`
  dall'interno di una policy su `profiles` porterebbe a ricorsione infinita.
* **Le schede consegnate sono immutabili**, con una sola eccezione: il
  responsabile dell'area puo' correggere l'autovalutazione di un collaboratore
  anche dopo la consegna. In quel caso un trigger scrive `corrected_by` e
  `corrected_at`, cosi' la correzione non e' mai silenziosa e il diretto
  interessato la vede. Il passaggio a `submitted` resta possibile solo con
  `service_role`, cioe' dalla Edge Function.
* **L'area viene sempre ricalcolata dal server.** Nelle comunicazioni a
  calendario e nelle richieste il campo `area_id` e' scritto da un trigger a
  partire dal profilo: il client non puo' dichiarare un'area diversa dalla
  propria.

---

## Anonimato del gradimento

Questa e' la scelta piu' vincolante dell'intero progetto, quindi vale la pena
essere espliciti su cosa comporta.

**Cosa e' garantito.** Le tabelle `satisfaction_submissions` e
`satisfaction_answers` non hanno alcuna colonna, indice o vincolo che rimandi
all'autore. Non c'e' un `profile_id` nascosto e non c'e' un timestamp preciso
(solo la data, per non permettere l'incrocio con i log di accesso). Le due
tabelle hanno RLS attivo e **zero policy**, con i permessi revocati per `anon` e
`authenticated`: nessun utente, HR compreso, puo' leggerle o scriverle. I dati
escono solo attraverso funzioni di aggregazione che applicano una soglia minima
di risposte per area, configurabile dall'interfaccia (predefinita: 3).

**Cosa non e' possibile, di conseguenza.** Non si puo' sapere chi ha compilato
ne' calcolare il tasso di partecipazione, e la stessa persona puo' rispondere
piu' volte. E' il prezzo dell'anonimato assoluto, ed e' stato scelto
consapevolmente.

**La via di mezzo, se serve.** Impostando il secret
`SATISFACTION_THROTTLE_SECRET` la Edge Function registra in
`satisfaction_throttle` un HMAC irreversibile di (utente + questionario + mese) e
rifiuta la seconda compilazione dello stesso mese. Quella tabella non e'
collegabile alle risposte e il segreto vive solo nell'ambiente della funzione:
chi legge il database vede impronte, non persone. Senza il secret la tabella
resta vuota.

---

## Collaudo delle policy

Le policy RLS sono la parte piu' delicata e sono coperte da una suite di
controlli che verifica, ruolo per ruolo, cosa si vede e cosa si puo' modificare
(63 asserzioni sulle policy piu' 7 sul primo avvio: escalation di privilegi, visibilita' fra aree, immutabilita'
delle schede consegnate, inaccessibilita' dei dati di gradimento, soglia di
riservatezza, e la finestra di primo avvio che si apre e si chiude una volta
sola).

Con la Supabase CLI in locale:

```bash
supabase start
DB_URL="$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '"')"
psql "$DB_URL" -f supabase/tests/rls_checks.sql
psql "$DB_URL" -f supabase/tests/bootstrap_checks.sql
```

Su un PostgreSQL vuoto, senza Docker, applicando prima lo stub dell'ambiente
Supabase:

```bash
createdb chamatest
psql -d chamatest -f supabase/tests/_supabase_stub.sql
psql -d chamatest -c 'create extension if not exists pgcrypto with schema extensions;'
for f in supabase/migrations/*.sql; do psql -d chamatest -v ON_ERROR_STOP=1 -f "$f"; done
psql -d chamatest -f supabase/tests/rls_checks.sql
psql -d chamatest -f supabase/tests/bootstrap_checks.sql
```

Ogni controllo stampa `PASS`; il primo che fallisce interrompe l'esecuzione.

> Attenzione: nello script di collaudo si usa `delete from auth.users`, mai
> `truncate ... cascade`. Un TRUNCATE CASCADE si propagherebbe a tutte le tabelle
> che referenziano `profiles`, azzerando anche modelli e questionari.

---

## Scelte progettuali e limiti noti

* **Il calendario e' una comunicazione, non una richiesta.** Non c'e' alcun
  flusso di approvazione: il dipendente dichiara, responsabile e HR consultano.
  Se in futuro servisse un'approvazione, il posto giusto e' una colonna di stato
  su `calendar_entries` piu' una policy di UPDATE per il responsabile dell'area.
* **Il responsabile e' una persona con ruolo `manager` assegnata a un'area**, non
  un riferimento memorizzato sull'area. Cosi' non puo' esistere un'area che punta
  a un responsabile che nel frattempo si e' spostato altrove. Un'area puo' avere
  piu' responsabili; per generare le schede la campagna sceglie in modo
  deterministico il piu' anziano in nomina.
* **Un'area senza responsabile non genera schede.** La funzione `manage-campaign`
  lo segnala fra i propri `warnings` e la pagina Aree mostra un avviso.
* **Le valutazioni seguono campagne, il gradimento no.** Le prime hanno una
  finestra temporale e un modello; il secondo resta sempre aperto e viene
  aggregato per mese.
* **I punteggi sono medie pesate normalizzate su 0–100**, calcolate solo sulle
  domande a scala. La formula e' identica nella Edge Function e nelle funzioni
  SQL dei KPI, cosi' i due valori sono sempre confrontabili.
* **Eliminare un dipendente cancella a cascata** calendario, richieste e schede.
  Le compilazioni di gradimento restano, perche' non sono collegate ad alcuna
  persona. Per conservare lo storico conviene disattivare invece di eliminare.
* **Modificare un modello gia' usato in una campagna** cambia le domande sotto le
  schede gia' compilate: l'interfaccia avvisa e suggerisce di duplicare il
  modello.
* **Non ci sono notifiche via email** oltre a quelle di Supabase Auth (invito e
  recupero password). Sarebbero il naturale passo successivo, tramite un webhook
  del database o una funzione pianificata.
