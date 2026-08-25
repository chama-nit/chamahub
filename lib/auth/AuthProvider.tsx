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
  loading: boolean;
  configured: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Pagine raggiungibili senza sessione attiva. */
const PUBLIC_ROUTES = ["/login", "/auth/callback"];

interface ProfileSlot {
  userId: string | null;
  profile: Profile | null;
  managedAreas: ManagedArea[];
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
  // Reindirizzamenti
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!configured || loading) return;

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
  }, [configured, loading, session, profile, pathname, router]);

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
      loading,
      configured,
      refreshProfile,
      signOut,
    }),
    [session, profile, managedAreas, loading, configured, refreshProfile, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
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
