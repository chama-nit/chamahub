"use client";

// ---------------------------------------------------------------------------
// Contesto di autenticazione
// ---------------------------------------------------------------------------
// Tiene la sessione Supabase e il profilo applicativo (ruolo, area, stato di
// attivazione) a disposizione di tutta l'applicazione, e si occupa dei
// reindirizzamenti: chi non ha una sessione va al login, chi ha un account non
// ancora abilitato dall'HR va alla pagina di attesa.
//
// Nota sullo stato: `loading` non e' una variabile a se' ma si ricava
// confrontando l'utente della sessione con quello dell'ultimo profilo caricato.
// Questo evita di chiamare setState dentro un effetto (e i render a cascata che
// ne derivano) e rende impossibile mostrare il profilo dell'utente precedente
// dopo un cambio di account.
// ---------------------------------------------------------------------------

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import MaintenanceScreen from "@/components/MaintenanceScreen";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import type { Area, Profile, UserRole } from "@/lib/types/models";

/** Un'area guidata da chi sta usando l'applicazione. */
export type ManagedArea = Pick<Area, "id" | "name" | "color">;

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  role: UserRole | null;
  /**
   * Le aree che questa persona guida.
   *
   * Vuoto per chi non ne guida nessuna. NON coincide con `profile.area_id`,
   * che e' l'area di appartenenza: un responsabile puo' lavorare in Sviluppo e
   * guidare anche Amministrazione, e le due informazioni servono a cose
   * diverse - la prima per il proprio calendario, la seconda per decidere cosa
   * puo' vedere.
   */
  managedAreas: ManagedArea[];
  /**
   * Manutenzione in corso.
   *
   * `blocked` e' vero solo per chi ne subisce gli effetti: il SystemAdmin la
   * vede attiva (`enabled`) ma continua a lavorare, altrimenti non potrebbe
   * spegnerla.
   */
  maintenance: MaintenanceState & { blocked: boolean };
  loading: boolean;
  configured: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Pagine raggiungibili senza sessione attiva. */
const PUBLIC_ROUTES = ["/login", "/auth/callback"];

/** Ogni mezzo minuto: chi ha la pagina aperta se ne accorge in fretta. */
const MAINTENANCE_POLL_MS = 30_000;

interface ProfileSlot {
  userId: string | null;
  profile: Profile | null;
  managedAreas: ManagedArea[];
}

/** Stato della manutenzione, cosi' come lo racconta il database. */
export interface MaintenanceState {
  enabled: boolean;
  message: string | null;
}

async function fetchMaintenance(): Promise<MaintenanceState> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("maintenance_state");
    if (error) return { enabled: false, message: null };
    const stato = (data ?? {}) as { enabled?: boolean; message?: string | null };
    return {
      enabled: Boolean(stato.enabled),
      message: stato.message ?? null,
    };
  } catch {
    // Un errore qui non deve chiudere l'applicazione: nel dubbio si resta
    // aperti. Il blocco vero e' comunque nelle policy, che non dipendono da
    // questa lettura.
    return { enabled: false, message: null };
  }
}

async function fetchProfile(
  userId: string,
): Promise<{ profile: Profile | null; managedAreas: ManagedArea[] }> {
  const supabase = getSupabase();

  // Le due letture sono indipendenti: si fanno insieme invece che in fila.
  const [profileRes, areasRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("*, areas:area_id (id, name, color)")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("area_managers")
      .select("areas:area_id (id, name, color)")
      .eq("profile_id", userId),
  ]);

  if (profileRes.error) {
    console.error("Lettura del profilo non riuscita:", profileRes.error.message);
    return { profile: null, managedAreas: [] };
  }

  if (areasRes.error) {
    // Non blocca l'accesso: senza questo elenco la persona vede l'applicazione
    // come un dipendente, che e' il fallimento meno dannoso.
    console.error("Lettura delle aree guidate non riuscita:", areasRes.error.message);
  }

  // I tipi generati descrivono la relazione come un array perche' non sanno
  // che `area_id` e' una chiave singola: a runtime arriva un oggetto solo.
  // Si normalizzano entrambe le forme invece di fidarsi dell'una o dell'altra.
  const managedAreas = ((areasRes.data ?? []) as unknown[])
    .flatMap((riga) => {
      const campo = (riga as { areas?: ManagedArea | ManagedArea[] | null }).areas;
      if (!campo) return [];
      return Array.isArray(campo) ? campo : [campo];
    })
    .sort((a, b) => a.name.localeCompare(b.name, "it"));

  return { profile: (profileRes.data as Profile) ?? null, managedAreas };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const configured = isSupabaseConfigured();

  const [session, setSession] = useState<Session | null>(null);
  // Se la configurazione manca non c'e' nulla da risolvere: si parte gia' pronti.
  const [sessionResolved, setSessionResolved] = useState(!configured);
  const [slot, setSlot] = useState<ProfileSlot>({
    userId: null,
    profile: null,
    managedAreas: [],
  });

  // La manutenzione si rilegge da sola: chi era gia' dentro quando viene
  // attivata deve trovarsi davanti la schermata senza dover ricaricare, ed e'
  // l'unico modo perche' "fa uscire tutti gli utenti" sia vero anche per chi
  // ha la pagina aperta e non la tocca.
  const [maintenance, setMaintenance] = useState<MaintenanceState>({
    enabled: false,
    message: null,
  });

  const userId = session?.user?.id ?? null;

  // -------------------------------------------------------------------------
  // Sessione
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!configured) return;

    const supabase = getSupabase();
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session ?? null);
      setSessionResolved(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!active) return;
        setSession(nextSession);
        setSessionResolved(true);
      },
    );

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [configured]);

  // -------------------------------------------------------------------------
  // Profilo
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!configured || !userId) return;
    let active = true;

    fetchProfile(userId).then(({ profile, managedAreas }) => {
      if (active) setSlot({ userId, profile, managedAreas });
    });

    return () => {
      active = false;
    };
  }, [configured, userId]);

  // Il profilo vale solo se appartiene all'utente della sessione corrente.
  const profile = userId && slot.userId === userId ? slot.profile : null;
  // Dentro useMemo, non fuori: un array letterale ricreato a ogni render
  // farebbe scattare tutte le dipendenze che lo osservano.
  const managedAreas = useMemo(
    () => (userId && slot.userId === userId ? slot.managedAreas : []),
    [userId, slot],
  );
  const profileLoading = Boolean(userId) && slot.userId !== userId;
  const loading = !sessionResolved || profileLoading;

  // -------------------------------------------------------------------------
  // Manutenzione
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!configured) return;
    let active = true;

    const leggi = () => {
      fetchMaintenance().then((stato) => {
        if (active) setMaintenance(stato);
      });
    };

    leggi();
    const timer = setInterval(leggi, MAINTENANCE_POLL_MS);
    const onFocus = () => leggi();
    window.addEventListener("focus", onFocus);

    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [configured]);

  const maintenanceBlocked = maintenance.enabled && profile?.role !== "sysadmin";

  // -------------------------------------------------------------------------
  // L'uscita vera
  // -------------------------------------------------------------------------
  // Accendendo la manutenzione il database chiude le sessioni di tutti tranne
  // i SystemAdmin. Chi ha la pagina gia' aperta pero' non se ne accorge da
  // solo: il suo token di accesso e' un JWT valido ancora per un'ora, e la
  // libreria non ha motivo di rinunciarci. Qui lo si butta via.
  //
  // Il controllo NON si fa sul profilo. Durante la manutenzione le policy non
  // restituiscono niente a chi e' bloccato, profilo compreso: `profile` sarebbe
  // null tanto per un dipendente quanto per un SystemAdmin la cui lettura sia
  // fallita per un intoppo di rete, e nel secondo caso lo si butterebbe fuori
  // dall'unica pagina da cui puo' riaprire. Lo si chiede al database, che ha
  // una risposta certa a prescindere dalle policy.
  useEffect(() => {
    if (!configured || loading || !session || !maintenance.enabled) return;
    let active = true;

    (async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase.rpc("is_sysadmin");

      // Nel dubbio non si fa uscire nessuno: la schermata copre comunque
      // l'applicazione, e le policy bloccano comunque i dati. Un errore di
      // rete non deve tradursi in un logout.
      if (!active || error || data === true) return;

      await supabase.auth.signOut();
    })();

    return () => {
      active = false;
    };
  }, [configured, loading, session, maintenance.enabled]);

  // -------------------------------------------------------------------------
  // Reindirizzamenti
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!configured || loading) return;

    // Durante la manutenzione non si reindirizza da nessuna parte: la
    // schermata prende il posto di tutto, e mandare qualcuno su /login mentre
    // il login e' chiuso sarebbe un giro a vuoto.
    if (maintenanceBlocked) return;

    const isPublic = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

    if (!session) {
      if (!isPublic) router.replace("/login");
      return;
    }

    if (isPublic) {
      router.replace(profile?.is_active ? "/dashboard" : "/attivazione");
      return;
    }

    if (profile && !profile.is_active && pathname !== "/attivazione") {
      router.replace("/attivazione");
      return;
    }

    if (profile?.is_active && pathname === "/attivazione") {
      router.replace("/dashboard");
    }
  }, [configured, loading, session, profile, pathname, router, maintenanceBlocked]);

  // -------------------------------------------------------------------------
  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    const next = await fetchProfile(userId);
    setSlot({ userId, profile: next.profile, managedAreas: next.managedAreas });
  }, [userId]);

  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    setSlot({ userId: null, profile: null, managedAreas: [] });
    router.replace("/login");
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      role: profile?.is_active ? profile.role : null,
      managedAreas: profile?.is_active ? managedAreas : [],
      maintenance: { ...maintenance, blocked: maintenanceBlocked },
      loading,
      configured,
      refreshProfile,
      signOut,
    }),
    [
      session,
      profile,
      managedAreas,
      maintenance,
      maintenanceBlocked,
      loading,
      configured,
      refreshProfile,
      signOut,
    ],
  );

  return (
    <AuthContext.Provider value={value}>
      {/* La schermata prende il posto dell'applicazione, non si aggiunge a
          essa: chi e' bloccato non deve poter tornare indietro con il tasto
          del browser e trovarsi davanti una pagina vuota da cui il database
          non restituisce niente.

          Resta visibile anche dopo il logout - a sessione chiusa `profile` e'
          null, quindi `blocked` continua a essere vero - e prende il posto
          della pagina di accesso: chi arriva durante la manutenzione legge
          perche' non entra, invece di sbattere contro un login che rifiuta le
          credenziali giuste. */}
      {value.maintenance.blocked
        ? <MaintenanceScreen message={maintenance.message} />
        : children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth deve essere usato dentro <AuthProvider>.");
  }
  return context;
}

/** Profilo garantito non nullo: da usare solo dentro l'area autenticata. */
export function useProfile(): Profile {
  const { profile } = useAuth();
  if (!profile) {
    throw new Error("Profilo non disponibile in questo contesto.");
  }
  return profile;
}
