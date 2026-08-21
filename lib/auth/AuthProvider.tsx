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
import type { Profile, UserRole } from "@/lib/types/models";

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  role: UserRole | null;
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
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("*, areas:area_id (id, name, color)")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Lettura del profilo non riuscita:", error.message);
    return null;
  }

  return (data as Profile) ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const configured = isSupabaseConfigured();

  const [session, setSession] = useState<Session | null>(null);
  // Se la configurazione manca non c'e' nulla da risolvere: si parte gia' pronti.
  const [sessionResolved, setSessionResolved] = useState(!configured);
  const [slot, setSlot] = useState<ProfileSlot>({ userId: null, profile: null });

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

    fetchProfile(userId).then((profile) => {
      if (active) setSlot({ userId, profile });
    });

    return () => {
      active = false;
    };
  }, [configured, userId]);

  // Il profilo vale solo se appartiene all'utente della sessione corrente.
  const profile = userId && slot.userId === userId ? slot.profile : null;
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
    setSlot({ userId, profile: next });
  }, [userId]);

  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    setSlot({ userId: null, profile: null });
    router.replace("/login");
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      role: profile?.is_active ? profile.role : null,
      loading,
      configured,
      refreshProfile,
      signOut,
    }),
    [session, profile, loading, configured, refreshProfile, signOut],
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
