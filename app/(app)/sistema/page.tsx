"use client";

// ---------------------------------------------------------------------------
// Pannello di sistema (solo SystemAdmin)
// ---------------------------------------------------------------------------
// Due cose sole, ed entrambe servono a capire cosa vedono gli altri:
//
//   * l'elenco delle persone, con il comando per entrare nei loro panni;
//   * il registro di chi e' entrato nei panni di chi, e quando.
//
// La pagina si limita a chiedere: chi puo' fare cosa e' deciso dalla Edge
// Function `impersonate` e dalle policy RLS. Un dipendente che aprisse questo
// indirizzo a mano troverebbe un avviso e nessun dato.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import LoginIcon from "@mui/icons-material/Login";
import BuildIcon from "@mui/icons-material/Build";
import LockOpenIcon from "@mui/icons-material/LockOpen";

import PageHeader from "@/components/PageHeader";
import { AsyncBlock, EmptyState, SectionCard, StatCard, AutoGrid } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAsync } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase/client";
import { startImpersonation } from "@/lib/auth/impersonation";
import { ROLE_LABELS } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import type { Profile } from "@/lib/types/models";

interface LogRow {
  id: string;
  created_at: string;
  actor: Pick<Profile, "id" | "full_name"> | null;
  target: Pick<Profile, "id" | "full_name"> | null;
}

interface Loaded {
  people: Profile[];
  log: LogRow[];
}

export default function SystemPage() {
  const { profile, maintenance } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [workingOn, setWorkingOn] = useState<string | null>(null);

  // Manutenzione: lo stato arriva dal contesto, che lo rilegge da solo. Qui
  // serve solo la copia locale del messaggio in scrittura e un blocco durante
  // la chiamata.
  const [messaggio, setMessaggio] = useState(maintenance.message ?? "");
  const [busy, setBusy] = useState(false);

  const manutenzione = maintenance;

  async function cambiaManutenzione(attiva: boolean) {
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { error: rpcError } = await supabase.rpc("set_maintenance", {
        p_enabled: attiva,
        p_message: messaggio.trim() || null,
      });
      if (rpcError) throw new Error(rpcError.message);

      toast.success(
        attiva
          ? "Manutenzione attiva: l'applicazione e' chiusa a tutti tranne ai SystemAdmin."
          : "Manutenzione disattivata: l'applicazione e' di nuovo aperta.",
      );
      // Il contesto rilegge da solo entro mezzo minuto, ma aspettare mezzo
      // minuto per vedere l'effetto di un pulsante appena premuto e' il modo
      // migliore per premerlo due volte. Un ricaricamento e' brusco ma
      // inequivocabile, ed e' un'azione che si compie una volta ogni tanto.
      window.location.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  const isSysadmin = profile?.role === "sysadmin";

  const { data, loading, error } = useAsync<Loaded>(async () => {
    if (!isSysadmin) return { people: [], log: [] };

    const supabase = getSupabase();
    const [people, log] = await Promise.all([
      supabase
        .from("profiles")
        .select("*, areas:area_id (id, name, color)")
        .order("full_name"),
      supabase
        .from("impersonation_log")
        .select(`
          id, created_at,
          actor:profiles!impersonation_log_actor_id_fkey (id, full_name),
          target:profiles!impersonation_log_target_id_fkey (id, full_name)
        `)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(50),
    ]);

    if (people.error) throw new Error(people.error.message);
    if (log.error) throw new Error(log.error.message);

    return {
      people: (people.data ?? []) as Profile[],
      log: (log.data ?? []) as unknown as LogRow[],
    };
  }, [isSysadmin]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.people ?? []).filter((person) => {
      if (person.id === profile?.id) return false;
      if (!needle) return true;
      return `${person.full_name} ${person.email} ${person.areas?.name ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [data, search, profile?.id]);

  const counts = useMemo(() => {
    const people = data?.people ?? [];
    return {
      total: people.length,
      active: people.filter((p) => p.is_active).length,
      hr: people.filter((p) => p.role === "hr").length,
      managers: people.filter((p) => p.role === "manager").length,
    };
  }, [data]);

  async function impersonate(person: Profile) {
    if (!profile) return;
    setWorkingOn(person.id);
    try {
      await startImpersonation(
        { id: profile.id, full_name: profile.full_name },
        person.id,
      );
      // In caso di successo la pagina viene ricaricata: qui non si arriva.
    } catch (err) {
      toast.error(err);
      setWorkingOn(null);
    }
  }

  if (!isSysadmin) {
    return (
      <>
        <PageHeader title="Pannello di sistema" />
        <Alert severity="warning">
          Questa sezione e&apos; riservata al ruolo SystemAdmin.
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Pannello di sistema"
        description="Entra nei panni di una persona per vedere l'applicazione con i suoi occhi: menu, permessi e dati diventano i suoi."
      />

      <AsyncBlock loading={loading} error={error}>
        <Stack spacing={3}>
          <AutoGrid min={220}>
            <StatCard label="Persone registrate" value={counts.total} />
            <StatCard label="Attive" value={counts.active} />
            <StatCard label="Reparto HR" value={counts.hr} color="primary.main" />
            <StatCard
              label="Responsabili"
              value={counts.managers}
              color="secondary.main"
            />
          </AutoGrid>

          {/* -----------------------------------------------------------------
              Manutenzione
              -----------------------------------------------------------------
              Sta in cima perche' e' l'unico comando di questa pagina che
              cambia le cose per tutti gli altri: metterlo in fondo, sotto un
              elenco di persone, significherebbe farlo trovare per caso.
              ----------------------------------------------------------------- */}
          <SectionCard
            title="Modalita' manutenzione"
            subtitle="Sospende l'applicazione per tutti tranne che per i SystemAdmin."
          >
            <Stack spacing={2}>
              {manutenzione.enabled
                ? (
                  <Alert severity="warning" icon={<BuildIcon />}>
                    <strong>La manutenzione e&apos; attiva.</strong> Nessuno
                    puo&apos; usare l&apos;applicazione, tu compreso quando
                    uscirai da questo pannello: il blocco vale sulle policy del
                    database, non solo a schermo. Tu continui a lavorare
                    normalmente perche&apos; sei un SystemAdmin.
                  </Alert>
                )
                : (
                  <Typography variant="body2" color="text.secondary">
                    Attivandola, chi sta usando l&apos;applicazione si trova
                    davanti una schermata che spiega cosa sta succedendo, e
                    nessuno puo&apos; piu&apos; leggere o scrivere niente. Tu
                    resti dentro: e&apos; l&apos;unico modo di poterla
                    disattivare.
                  </Typography>
                )}

              <TextField
                label="Messaggio per chi trova l'applicazione chiusa"
                fullWidth
                multiline
                minRows={2}
                value={messaggio}
                onChange={(event) => setMessaggio(event.target.value)}
                disabled={busy}
                slotProps={{ htmlInput: { maxLength: 500 } }}
                helperText="Facoltativo. Se lo lasci vuoto viene mostrato un testo generico. E' l'unico posto in cui puoi dire quanto durera'."
              />

              <Box>
                <Button
                  variant="contained"
                  color={manutenzione.enabled ? "success" : "warning"}
                  startIcon={manutenzione.enabled ? <LockOpenIcon /> : <BuildIcon />}
                  disabled={busy}
                  onClick={() => cambiaManutenzione(!manutenzione.enabled)}
                >
                  {manutenzione.enabled
                    ? "Riapri l'applicazione"
                    : "Attiva la manutenzione"}
                </Button>
              </Box>
            </Stack>
          </SectionCard>

          <Alert severity="info">
            L&apos;impersonificazione apre una sessione a nome di un&apos;altra
            persona: quello che scrivi risulta scritto da lei. Ogni ingresso
            resta registrato qui sotto. Per uscire, usa il pulsante nella
            striscia gialla in cima alla pagina.
          </Alert>

          <SectionCard
            title="Persone"
            subtitle="Un SystemAdmin non puo' impersonare un altro SystemAdmin."
            actions={
              <TextField
                size="small"
                placeholder="Cerca per nome, email o area"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                sx={{ minWidth: 260 }}
              />
            }
            dense
          >
            {visible.length === 0
              ? <EmptyState title="Nessuna persona trovata" />
              : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Persona</TableCell>
                        <TableCell>Ruolo</TableCell>
                        <TableCell>Area</TableCell>
                        <TableCell>Stato</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {visible.map((person) => (
                        <TableRow key={person.id} hover>
                          <TableCell>
                            <Typography sx={{ fontWeight: 600 }}>
                              {person.full_name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {person.email}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={ROLE_LABELS[person.role]}
                              color={person.role === "sysadmin"
                                ? "error"
                                : person.role === "hr"
                                ? "primary"
                                : person.role === "manager"
                                ? "secondary"
                                : "default"}
                              variant={person.role === "employee"
                                ? "outlined"
                                : "filled"}
                            />
                          </TableCell>
                          <TableCell>{person.areas?.name ?? "—"}</TableCell>
                          <TableCell>
                            {person.is_active
                              ? <Chip size="small" color="success" label="Attivo" />
                              : (
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  label="Non attivo"
                                />
                              )}
                          </TableCell>
                          <TableCell align="right">
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={workingOn === person.id
                                ? <CircularProgress size={14} />
                                : <LoginIcon />}
                              disabled={!person.is_active ||
                                person.role === "sysadmin" ||
                                workingOn !== null}
                              onClick={() => impersonate(person)}
                            >
                              Entra come
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
          </SectionCard>

          <SectionCard
            title="Registro degli accessi"
            subtitle="Ultimi 50 ingressi nei panni di un'altra persona."
            dense
          >
            {(data?.log ?? []).length === 0
              ? (
                <EmptyState
                  title="Nessuna impersonificazione registrata"
                  description="Comparira' qui la prima volta che entri nei panni di qualcuno."
                />
              )
              : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Quando</TableCell>
                        <TableCell>SystemAdmin</TableCell>
                        <TableCell>Nei panni di</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(data?.log ?? []).map((row) => (
                        <TableRow key={row.id}>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>
                            {formatDateTime(row.created_at)}
                          </TableCell>
                          <TableCell>{row.actor?.full_name ?? "—"}</TableCell>
                          <TableCell>{row.target?.full_name ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
          </SectionCard>
        </Stack>
      </AsyncBlock>
    </>
  );
}
