# Accesso con account Microsoft (Entra ID)

L'SSO Microsoft e' **attivo di serie**: il pulsante compare nella pagina di
accesso. Se la registrazione su Azure non e' ancora pronta lo si nasconde
mettendo

```
NEXT_PUBLIC_MICROSOFT_LOGIN=off
```

in `.env.local` e ricostruendo l'applicazione: meglio nessun pulsante che un
pulsante che fallisce.

Cosa chiede ChamaHub a Microsoft
--------------------------------
Solo `openid profile email`, cioe' nome, cognome e indirizzo. Nient'altro:
niente calendario, niente rubrica, niente `offline_access` (il token di
aggiornamento e' quello emesso da Supabase, non serve chiederne un secondo a
Microsoft). L'indirizzo e' la chiave con cui si verifica se la persona e' gia'
registrata.

Chi non e' registrato non entra
-------------------------------
Un accesso Microsoft riuscito dice solo che la persona e' chi dice di essere.
Se a quell'indirizzo non corrisponde un profilo **attivo** di ChamaHub, la
sessione viene chiusa e compare l'invito a rivolgersi al reparto HR. Il
tentativo lascia comunque un profilo in attesa di attivazione, che l'HR trova
nella sua anagrafica e puo' completare in due clic.

La configurazione tocca due sistemi. Servono entrambi: registrare l'app su Azure
non basta se poi Supabase non sa che esiste, e viceversa.

In cinque passi
---------------

1. **Azure**: registri l'app e le dai come indirizzo di ritorno quello di
   *Supabase*, non quello di ChamaHub.
2. **Azure**: copi ID applicazione, ID tenant e crei un segreto client.
3. **Supabase**: attivi il provider Azure e ci incolli quei tre valori.
4. **Supabase**: aggiungi il dominio di ChamaHub fra le *Redirect URLs*.
5. **ChamaHub**: il pulsante e' gia' attivo; se l'avevi nascosto, togli
   `NEXT_PUBLIC_MICROSOFT_LOGIN=off` e ricostruisci.

Il giro completo, a configurazione finita, e': ChamaHub manda la persona a
Microsoft → Microsoft la rimanda a **Supabase** → Supabase crea la sessione e la
rimanda a ChamaHub. E' per questo che l'indirizzo di ritorno registrato su Azure
e' quello di Supabase: e' l'unico dei tre che Microsoft deve conoscere.

---

## Parte 1 — Azure Portal

### 1.1 Registra l'applicazione

1. Vai su [portal.azure.com](https://portal.azure.com) →
   **Microsoft Entra ID** → **Registrazioni app** → **Nuova registrazione**.
2. **Nome**: `ChamaHub` (o come preferisci: lo vedranno gli utenti nella
   schermata di consenso).
3. **Tipi di account supportati**:
   * *Solo account in questa directory organizzativa* — se l'applicazione serve
     esclusivamente al personale interno. **E' la scelta giusta nella quasi
     totalita' dei casi.**
   * *Account in qualsiasi directory organizzativa* — solo se devono entrare
     anche persone di altri tenant Microsoft.
4. **URI di reindirizzamento**: seleziona il tipo **Web** e inserisci

   ```
   https://<REFERENCE_ID>.supabase.co/auth/v1/callback
   ```

   Sostituisci `<REFERENCE_ID>` con il Reference ID del tuo progetto Supabase
   (Dashboard → Project Settings → General). **Non** e' l'indirizzo della tua
   applicazione: Microsoft parla con Supabase, non con Next.js.

   > Se sviluppi in locale con la Supabase CLI, l'URI e'
   > `http://localhost:54321/auth/v1/callback`. Puoi aggiungere entrambi.

5. Premi **Registra**.

### 1.2 Annota gli identificativi

Nella pagina **Panoramica** della registrazione appena creata, copia:

| Valore | Dove serve |
|---|---|
| **ID applicazione (client)** | campo *Client ID* in Supabase |
| **ID directory (tenant)** | serve a comporre l'*Azure Tenant URL* |

### 1.3 Crea il segreto client

1. **Certificati e segreti** → **Segreti client** → **Nuovo segreto client**.
2. Descrizione: `Supabase`. Scadenza: quella che prevede la vostra policy
   (segnati la data, quando scade l'accesso smette di funzionare).
3. Premi **Aggiungi** e copia **subito** la colonna **Valore**.

   > Attenzione: serve il **Valore**, non l'**ID segreto**. Il valore e'
   > visibile una sola volta: se cambi pagina non lo recuperi piu' e devi
   > generarne un altro.

### 1.4 Verifica le autorizzazioni

**Autorizzazioni API** → devono essere presenti, come autorizzazioni **delegate**
di Microsoft Graph:

| Autorizzazione | A cosa serve | Consenso admin |
|---|---|---|
| `openid` | identifica l'account | no |
| `email` | porta l'indirizzo, la chiave con cui ChamaHub riconosce la persona | no |
| `profile` | porta il nome | no |
| `User.Read` | legge la scheda della persona (nome, cognome, indirizzo) da Graph | no |
| `offline_access` | fa rilasciare anche un token di aggiornamento del provider | no |

Nessuna delle cinque richiede il consenso dell'amministratore: sono le
autorizzazioni che un utente puo' concedere per conto proprio, e Entra ID le
mostra tutte insieme nella schermata di consenso del primo accesso. Se il vostro
tenant e' configurato per non chiedere nulla agli utenti, premi **Concedi
consenso amministratore** e la schermata non comparira'.

**A cosa servono davvero le ultime due.** `openid`, `email` e `profile` bastano
a far entrare le persone, ma il nome che arriva nel token e' inaffidabile: il
claim `name` non e' garantito, su parecchi tenant l'indirizzo viaggia in
`preferred_username` invece che in `email`, e quando manca tutto il ripiego e'
la parte prima della chiocciola. Il risultato e' un elenco dipendenti pieno di
`mario.rossi`, che l'HR corregge a mano una riga alla volta. Con `User.Read`
ChamaHub chiede la stessa informazione a Graph, che risponde con `givenName`,
`surname` e `mail` gia' separati, e riempie il nome **solo se e' ancora quel
ripiego** — un nome scritto dall'HR non viene mai sovrascritto.
`offline_access` serve a quella lettura: senza, il token Microsoft scade dopo
un'ora e la chiamata a Graph smette di funzionare.

**Nessuna autorizzazione di posta, qui.** `SMTP.Send` e `Mail.Send` non vanno
aggiunte a questa registrazione, per due ragioni indipendenti. La prima e' che
sono delegate: comparirebbero nella schermata di consenso di ogni dipendente
come «Invia posta elettronica a tuo nome», e le email di ChamaHub uscirebbero a
nome di chi ha fatto l'accesso invece che dalla casella aziendale. La seconda e'
che il token nato qui vive nel browser, mentre chi spedisce e' una Edge
Function: un permesso di spedire che passa dal browser e' un permesso regalato a
chiunque apra gli strumenti di sviluppo. La posta ha una registrazione tutta
sua, con autorizzazioni **di tipo applicazione** — vedi
[email-microsoft-smtp.md](email-microsoft-smtp.md).

`email` e' **obbligatorio**: Supabase rifiuta l'accesso se Microsoft non
restituisce un indirizzo, e ChamaHub usa proprio quell'indirizzo per capire chi
sei. Se nel vostro tenant convivono domini non verificati, aggiungi nel
**manifesto** della registrazione il claim facoltativo `xms_edov`: e' il campo
con cui Microsoft dichiara se l'indirizzo e' verificato, e senza di esso
Supabase in certi casi non riesce a distinguerlo.

---

## Parte 2 — Supabase

Dashboard → **Authentication** → **Providers** → **Azure**. Attiva
l'interruttore e compila:

| Campo | Valore |
|---|---|
| **Client ID** | l'ID applicazione (client) del punto 1.2 |
| **Secret** | il *valore* del segreto del punto 1.3 |
| **Azure Tenant URL** | `https://login.microsoftonline.com/<TENANT_ID>` |

Per `<TENANT_ID>` usa l'ID directory (tenant). Usa `common` al posto dell'ID
solo se hai scelto il multi-tenant al punto 1.1.

> **Senza `/v2.0` finale.** La documentazione Supabase indica
> `https://login.microsoftonline.com/<TENANT_ID>`: e' Supabase ad aggiungere da
> solo il resto del percorso di scoperta OIDC. Se ce lo aggiungi tu, il
> percorso risulta doppio.

Salva.

### URL di ritorno verso l'applicazione

**Authentication** → **URL Configuration**:

* **Site URL**: `http://localhost:3000` in sviluppo, il dominio reale in
  produzione.
* **Redirect URLs**: aggiungi il tuo dominio seguito da `/auth/callback`, per
  ogni ambiente che usi. Esempi:

  ```
  http://localhost:3000/auth/callback
  https://chamahub.tuodominio.it/auth/callback
  ```

Senza questa voce Supabase rifiuta il ritorno con *redirect_to is not allowed*.

---

## Parte 3 — Attiva il pulsante

In `.env.local` scrivi `NEXT_PUBLIC_MICROSOFT_LOGIN=on` e riavvia il server di
sviluppo (in produzione serve una nuova `npm run build`, perche' le variabili
`NEXT_PUBLIC_*` vengono incorporate nel bundle in fase di compilazione). Il
pulsante ricompare.

Se dopo il riavvio non lo vedi ancora, il motivo quasi sempre e' uno di questi
due: il valore non e' esattamente `on` (sono accettati anche `true` e `1`),
oppure stai guardando una build vecchia.

---

## Come si incastra con i profili creati dall'HR

* **Persona gia' censita dall'HR con la stessa email.** Al primo accesso
  Microsoft l'identita' viene collegata all'utente esistente e la persona entra
  direttamente con il proprio ruolo e la propria area. Perche' funzioni, la mail
  su Azure e quella inserita dall'HR devono coincidere ed essere verificate.
* **Persona non censita.** L'accesso a Microsoft riesce, ma ChamaHub **non la
  fa entrare**: la sessione viene chiusa subito e compare l'avviso di
  rivolgersi al reparto HR. Il tentativo lascia comunque un profilo con
  `is_active = false`, che l'HR trova segnalato in cima alla pagina Dipendenti
  e attiva assegnandogli un'area: da quel momento la persona entra con lo
  stesso pulsante, senza dover ricreare nulla.

Se vuoi impedire del tutto che qualcuno del tenant si crei un accesso, disattiva
la registrazione autonoma in Supabase (**Authentication → Sign In / Providers →
Allow new users to sign up**) dopo aver creato l'amministratore: da quel momento
esistono solo gli account creati dall'HR.

---

## Errori frequenti

| Cosa vedi | Causa | Rimedio |
|---|---|---|
| «L'accesso con Microsoft non e' ancora configurato» | provider Azure non attivo su Supabase | Parte 2 |
| `AADSTS50011` (redirect URI mismatch) | l'URI su Azure non coincide | deve essere esattamente `https://<REFERENCE_ID>.supabase.co/auth/v1/callback` |
| `AADSTS7000215` (invalid client secret) | copiato l'ID del segreto invece del valore, o segreto scaduto | rigenera il segreto, copia il **Valore** |
| `AADSTS900023` (tenant non valido) | Tenant URL scritto male | `https://login.microsoftonline.com/<TENANT_ID>/v2.0`, con `/v2.0` finale |
| «L'indirizzo di ritorno non e' fra quelli autorizzati» | manca la Redirect URL | Parte 2, sezione URL di ritorno |
| Torni al login senza errori e senza sessione | Site URL diverso dal dominio da cui accedi | allinea Site URL e Redirect URLs |
| «Accesso riconosciuto, ma non ancora abilitato» | la persona non e' censita dall'HR | e' il comportamento previsto: attivala dalla pagina Dipendenti, poi rientra con lo stesso pulsante |
| `AADSTS65001` (consenso mancante) | il tenant richiede il consenso dell'amministratore | Parte 1.4, **Concedi consenso amministratore** |
