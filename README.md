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
7. [Struttura del progetto](#struttura-del-progetto)
8. [Modello di sicurezza](#modello-di-sicurezza)
9. [Anonimato del gradimento](#anonimato-del-gradimento)
10. [Collaudo delle policy](#collaudo-delle-policy)
11. [Scelte progettuali e limiti noti](#scelte-progettuali-e-limiti-noti)

---

## Stack tecnologico

| Componente | Scelta |
|---|---|
| Framework | Next.js 16 (App Router, tutte le pagine `"use client"`) |
| UI | React 19 + MUI 9 |
| Linguaggio | TypeScript in modalita' `strict` |
| Backend | Supabase (PostgreSQL + Auth + Edge Function su Deno) |
| Grafici | SVG scritto a mano, nessuna libreria di charting |

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
* Visione di tutte le richieste, comprese quelle indirizzate ai responsabili.
* Costruttore di modelli di scheda (domande a scala numerica e a testo libero,
  con peso e obbligatorieta').
* Campagne di valutazione: apertura, sincronizzazione, chiusura, avanzamento per
  area. All'apertura viene generata un'autovalutazione per ogni persona
  coinvolta, non solo per i responsabili.
* Elenco di tutte le valutazioni dell'azienda (pagina "Tutte le valutazioni"),
  raggruppabili per area o per persona e filtrabili per campagna, tipo di
  scheda e stato.
* Questionari di gradimento e dashboard KPI con medie per area, andamento
  mensile, dettaglio per domanda e commenti anonimi. I riquadri della
  dashboard si riordinano per trascinamento (o con le frecce) e si allargano a
  mezza o intera larghezza; la disposizione resta salvata sul browser.

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
| `npm run functions:deploy` | pubblica le quattro Edge Function |

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

`db push` applica in ordine i dieci file in `supabase/migrations/`, che creano
tabelle, tipi, funzioni, policy RLS e i contenuti predefiniti (un modello di
valutazione, un modello di autovalutazione e un questionario di gradimento gia'
pronti).

### 3. Pubblicare le Edge Function

```bash
supabase functions deploy admin-users
supabase functions deploy submit-satisfaction
supabase functions deploy submit-evaluation
supabase functions deploy manage-campaign
```

oppure, in un colpo solo, `npm run functions:deploy`.

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
| «Ho dimenticato la password» dalla pagina di login | **si'** |
| Conferma dell'indirizzo alla registrazione | si', se le conferme sono attive |
| Tutto il resto (calendario, richieste, valutazioni, gradimento) | no |

La creazione di un dipendente e' deliberatamente separata dall'invio dell'email:
prima si crea l'account con una password temporanea - operazione che non tocca la
posta e non puo' fallire per colpa sua - e solo dopo, se richiesto, si tenta la
spedizione. Se il server di posta non risponde entro 10 secondi l'operazione si
chiude comunque con successo, mostrando la password temporanea e un avviso che
l'email non e' partita.

Il servizio email integrato di Supabase non e' pensato per la produzione: manda
**2 messaggi all'ora** e soltanto agli indirizzi dei membri del progetto — verso
chiunque altro fallisce con *Email address not authorized*. Per un uso reale
serve un SMTP proprio (Resend, SES, SendGrid, il server aziendale) da impostare
in **Authentication → Emails → SMTP Settings**.

Se un'email non parte, il posto dove guardare e' **Logs → Edge Functions** nel
Dashboard di Supabase: un `execution_time_ms` di poco superiore ai 10 secondi
indica che il server di posta non ha risposto affatto (host o porta sbagliati,
oppure connessione bloccata), mentre un errore immediato indica di solito
credenziali o mittente non autorizzato.

---

## Accesso con Microsoft Entra ID

L'SSO Microsoft e' **facoltativo**: l'applicazione funziona anche solo con email
e password. Il pulsante «Accedi con account Microsoft» e' **nascosto per
impostazione predefinita**, perche' senza la configurazione su Azure fallirebbe.
Il codice resta comunque nel progetto.

Quando la procedura qui sotto e' completa, per farlo comparire metti

```
NEXT_PUBLIC_MICROSOFT_LOGIN=on
```

in `.env.local` e riavvia (o ricostruisci) l'applicazione. Con qualsiasi altro
valore, o senza la variabile, il pulsante non compare.

**La procedura completa, con schermate ed errori frequenti, sta in
[`docs/microsoft-entra-id.md`](docs/microsoft-entra-id.md).** Qui il riassunto:

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
components/               AppShell, calendario, costruttore domande, grafici
lib/
  supabase/client.ts      unico punto di contatto con il backend
  auth/AuthProvider.tsx   sessione, profilo, reindirizzamenti
  types/models.ts         modelli di dominio
  labels.ts               etichette italiane degli enum
  format.ts               date e numeri
docs/
  microsoft-entra-id.md   guida completa all'SSO Microsoft
supabase/
  migrations/             10 file, da applicare in ordine
  functions/              4 Edge Function + codice condiviso
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

### Le Edge Function

| Funzione | Perche' non basta RLS |
|---|---|
| `admin-users` | creare un utente significa scrivere in `auth.users`: serve la chiave `service_role`, che non puo' raggiungere il browser |
| `submit-satisfaction` | le tabelle del gradimento non sono scrivibili da nessun utente; la funzione verifica il token e scrive senza registrare l'autore |
| `submit-evaluation` | il punteggio va calcolato in un punto solo e non falsificabile; un trigger impedisce a chiunque altro di marcare una scheda come consegnata |
| `manage-campaign` | generare decine di schede intestate a persone diverse richiederebbe permessi di scrittura molto ampi sul client |

---

## Modello di sicurezza

Ogni tabella ha RLS attivo. In sintesi:

| Dato | Dipendente | Responsabile | HR |
|---|---|---|---|
| Profili | il proprio + i colleghi della sua area | la propria area | tutti, in scrittura |
| Calendario | scrive e legge il proprio | legge quello della sua area | legge e scrive tutto |
| Richieste | le proprie | le proprie + quelle indirizzate al responsabile della sua area | tutte |
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
(44 asserzioni sulle policy piu' 7 sul primo avvio: escalation di privilegi, visibilita' fra aree, immutabilita'
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
