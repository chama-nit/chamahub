# Accesso con account Microsoft (Entra ID)

L'SSO Microsoft e' **facoltativo**: ChamaHub funziona anche solo con email e
password. Per questo il pulsante «Accedi con account Microsoft» e' **nascosto
per impostazione predefinita**: finche' la registrazione su Azure non e'
completa, mostrarlo significherebbe lasciare a schermo un comando che fallisce.

Il codice dell'accesso Microsoft non e' stato rimosso: sta in
`app/login/page.tsx` (funzione `signInWithMicrosoft`) e in `app/auth/callback`.
Quando hai finito questa procedura, metti

```
NEXT_PUBLIC_MICROSOFT_LOGIN=on
```

in `.env.local` e riavvia `npm run dev` (o rilancia `npm run build`): il
pulsante ricompare. Senza quella riga, o con qualsiasi altro valore, resta
nascosto.

La configurazione tocca due sistemi. Servono entrambi: registrare l'app su Azure
non basta se poi Supabase non sa che esiste, e viceversa.

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

**Autorizzazioni API** → devono essere presenti, come autorizzazioni delegate di
Microsoft Graph:

* `openid`
* `email`
* `profile`
* `offline_access`

Di norma ci sono gia'. Se il vostro tenant richiede il consenso
dell'amministratore, premi **Concedi consenso amministratore**,
altrimenti ogni utente se lo vedra' chiedere al primo accesso.

---

## Parte 2 — Supabase

Dashboard → **Authentication** → **Providers** → **Azure**. Attiva
l'interruttore e compila:

| Campo | Valore |
|---|---|
| **Client ID** | l'ID applicazione (client) del punto 1.2 |
| **Secret** | il *valore* del segreto del punto 1.3 |
| **Azure Tenant URL** | `https://login.microsoftonline.com/<TENANT_ID>/v2.0` |

Per `<TENANT_ID>` usa l'ID directory (tenant). Usa `common` al posto dell'ID
solo se hai scelto il multi-tenant al punto 1.3.

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
* **Persona non censita.** Un trigger crea comunque il profilo, ma con
  `is_active = false`: quella persona vede solo «Account in attesa di
  attivazione» e le policy RLS le negano ogni dato. L'HR la trova segnalata in
  cima alla pagina Dipendenti e la attiva assegnandole un'area.

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
| L'utente entra ma vede «in attesa di attivazione» | non e' stato censito dall'HR | e' il comportamento previsto: attivalo dalla pagina Dipendenti |
