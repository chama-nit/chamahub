"use client";

// ---------------------------------------------------------------------------
// Gestione dell'anagrafica dipendenti (solo HR)
// ---------------------------------------------------------------------------
// Creazione, modifica, nomina a responsabile, disattivazione ed eliminazione
// passano tutte dalla Edge Function `admin-users`: scrivere in auth.users
// richiede la chiave service_role, che non deve mai raggiungere il browser.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import SearchIcon from "@mui/icons-material/Search";

import PageHeader from "@/components/PageHeader";
import { AsyncBlock, EmptyState } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAsync } from "@/lib/hooks";
import { callFunction, getSupabase } from "@/lib/supabase/client";
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "@/lib/labels";
import { formatDay, initials } from "@/lib/format";
import type { Area, Profile, UserRole } from "@/lib/types/models";

interface Loaded {
  people: Profile[];
  areas: Area[];
}

interface EditorState {
  mode: "create" | "edit";
  id?: string;
  email: string;
  fullName: string;
  role: UserRole;
  areaId: string;
  jobTitle: string;
  hiredOn: string;
  sendInvite: boolean;
}

const EMPTY_EDITOR: EditorState = {
  mode: "create",
  email: "",
  fullName: "",
  role: "employee",
  areaId: "",
  jobTitle: "",
  hiredOn: "",
  sendInvite: false,
};

export default function HrEmployeesPage() {
  const toast = useToast();
  const { profile: me } = useAuth();

  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "pending">(
    "all",
  );

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [busy, setBusy] = useState(false);
  // Valore che l'HR deve consegnare di persona: password temporanea o link di
  // reimpostazione. Mostrato una volta sola, mai salvato in chiaro.
  const [handover, setHandover] = useState<
    { title: string; description: string; value: string; monospace?: boolean } | null
  >(null);
  const [menu, setMenu] = useState<{ el: HTMLElement; person: Profile } | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState<Profile | null>(null);

  const { data, loading, error, reload } = useAsync<Loaded>(async () => {
    const supabase = getSupabase();

    const [peopleResult, areasResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("*, areas:area_id (id, name, color)")
        .order("full_name")
        .order("id"),
      supabase.from("areas").select("*").order("name"),
    ]);

    if (peopleResult.error) throw new Error(peopleResult.error.message);
    if (areasResult.error) throw new Error(areasResult.error.message);

    return {
      people: (peopleResult.data ?? []) as Profile[],
      areas: (areasResult.data ?? []) as Area[],
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.people ?? []).filter((person) => {
      if (needle) {
        const haystack =
          `${person.full_name} ${person.email} ${person.job_title ?? ""}`
            .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (areaFilter !== "all") {
        if (areaFilter === "none" ? person.area_id !== null : person.area_id !== areaFilter) {
          return false;
        }
      }
      if (roleFilter !== "all" && person.role !== roleFilter) return false;
      if (statusFilter === "active" && !person.is_active) return false;
      if (statusFilter === "pending" && person.is_active) return false;
      return true;
    });
  }, [data, search, areaFilter, roleFilter, statusFilter]);

  const pendingCount = (data?.people ?? []).filter((p) => !p.is_active).length;

  // -------------------------------------------------------------------------
  async function saveEditor() {
    if (!editor) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        full_name: editor.fullName.trim(),
        role: editor.role,
        area_id: editor.areaId || null,
        job_title: editor.jobTitle.trim() || null,
        hired_on: editor.hiredOn || null,
      };

      if (editor.mode === "create") {
        const result = await callFunction<{
          temporary_password?: string;
          note?: string;
          warning?: string;
          email_sent?: boolean;
        }>("admin-users", {
          action: "create",
          email: editor.email.trim().toLowerCase(),
          send_invite: editor.sendInvite,
          redirect_to: `${window.location.origin}/auth/callback`,
          ...payload,
        });

        if (result.temporary_password) {
          // L'account c'e' sempre: quello che cambia e' se l'email di
          // benvenuto sia partita o meno.
          const emailNote = editor.sendInvite
            ? result.email_sent
              ? "E' stata inviata anche un'email per impostare la password; questa temporanea resta valida come riserva, se il messaggio non arrivasse."
              : "L'email NON e' partita, quindi la password qui sotto e' l'unico modo di accedere: comunicala tu."
            : "";

          setHandover({
            title: "Dipendente creato",
            description:
              `Comunica questa password temporanea alla persona interessata: non verra' mostrata di nuovo e non e' salvata in chiaro da nessuna parte. Al primo accesso potra' cambiarla dal proprio profilo, oppure entrare direttamente con l'account Microsoft. ${emailNote}`
                .trim(),
            value: result.temporary_password,
            monospace: true,
          });

          if (result.warning) toast.notify(result.warning, "warning");
        } else if (result.warning) {
          toast.notify(result.warning, "warning");
        } else {
          toast.success(result.note ?? "Dipendente creato.");
        }
      } else {
        await callFunction("admin-users", {
          action: "update",
          id: editor.id,
          ...payload,
        });
        toast.success("Dipendente aggiornato.");
      }

      setEditor(null);
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Genera un link di reimpostazione password e lo mostra all'HR.
   *
   * Non viene inviata alcuna email: `generateLink` di Supabase produce solo il
   * link ("to be sent via a custom email provider"). Consegnarlo a mano e'
   * quindi l'unica strada che funziona anche senza SMTP configurato.
   */
  async function generateRecoveryLink(person: Profile) {
    setBusy(true);
    setMenu(null);
    try {
      const result = await callFunction<{ action_link: string | null }>(
        "admin-users",
        {
          action: "recovery_link",
          email: person.email,
          redirect_to: `${window.location.origin}/auth/callback`,
        },
      );

      if (!result.action_link) {
        throw new Error("Supabase non ha restituito alcun link.");
      }

      setHandover({
        title: "Link di reimpostazione password",
        description:
          `Consegna questo link a ${person.full_name} attraverso un canale sicuro. Vale una sola volta e scade dopo circa un'ora. Non e' stata inviata alcuna email: il link va comunicato da te.`,
        value: result.action_link,
      });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action: string, person: Profile) {
    setBusy(true);
    setMenu(null);
    try {
      await callFunction("admin-users", {
        action,
        id: person.id,
        email: person.email,
        redirect_to: `${window.location.origin}/auth/callback`,
      });

      const messages: Record<string, string> = {
        deactivate: "Dipendente disattivato.",
        reactivate: "Dipendente riattivato.",
        delete: "Dipendente eliminato.",
      };
      toast.success(messages[action] ?? "Operazione completata.");
      setConfirmDelete(null);
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  return (
    <>
      <PageHeader
        title="Dipendenti"
        description="Crea i profili, assegnali a un'area e nomina i responsabili. Chi accede con Microsoft senza essere censito resta in attesa finche' non lo attivi qui."
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setEditor({ ...EMPTY_EDITOR })}
          >
            Nuovo dipendente
          </Button>
        }
      />

      {pendingCount > 0 && (
        <Alert
          severity="warning"
          sx={{ mb: 3 }}
          action={
            <Button
              size="small"
              color="inherit"
              onClick={() => setStatusFilter("pending")}
            >
              Mostra
            </Button>
          }
        >
          {pendingCount === 1
            ? "1 persona ha effettuato l'accesso ma non e' ancora stata attivata."
            : `${pendingCount} persone hanno effettuato l'accesso ma non sono ancora state attivate.`}
        </Alert>
      )}

      <Card>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          sx={{ p: 2.5, alignItems: { md: "center" } }}
        >
          <TextField
            placeholder="Cerca per nome, email o mansione"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            sx={{ flex: 1, minWidth: 220 }}
            slotProps={{
              input: { startAdornment: <SearchIcon sx={{ mr: 1, color: "text.disabled" }} /> },
            }}
          />

          <FormControl sx={{ minWidth: 180 }}>
            <InputLabel id="area-filter">Area</InputLabel>
            <Select
              labelId="area-filter"
              label="Area"
              value={areaFilter}
              onChange={(event) => setAreaFilter(event.target.value)}
            >
              <MenuItem value="all">Tutte le aree</MenuItem>
              <MenuItem value="none">Senza area</MenuItem>
              {data?.areas.map((area) => (
                <MenuItem key={area.id} value={area.id}>
                  {area.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl sx={{ minWidth: 160 }}>
            <InputLabel id="role-filter">Ruolo</InputLabel>
            <Select
              labelId="role-filter"
              label="Ruolo"
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value as UserRole | "all")}
            >
              <MenuItem value="all">Tutti i ruoli</MenuItem>
              {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
                <MenuItem key={role} value={role}>
                  {ROLE_LABELS[role]}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl sx={{ minWidth: 170 }}>
            <InputLabel id="status-filter">Stato</InputLabel>
            <Select
              labelId="status-filter"
              label="Stato"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as "all" | "active" | "pending")}
            >
              <MenuItem value="all">Tutti</MenuItem>
              <MenuItem value="active">Attivi</MenuItem>
              <MenuItem value="pending">In attesa</MenuItem>
            </Select>
          </FormControl>
        </Stack>

        <AsyncBlock loading={loading} error={error}>
          {filtered.length === 0
            ? (
              <CardContent>
                <EmptyState
                  title="Nessun dipendente trovato"
                  description="Modifica i filtri oppure crea il primo profilo."
                />
              </CardContent>
            )
            : (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Persona</TableCell>
                      <TableCell>Area</TableCell>
                      <TableCell>Ruolo</TableCell>
                      <TableCell>Mansione</TableCell>
                      <TableCell>Assunzione</TableCell>
                      <TableCell>Stato</TableCell>
                      <TableCell align="right" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filtered.map((person) => (
                      <TableRow key={person.id} hover>
                        <TableCell>
                          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                            <Avatar
                              sx={{
                                width: 34,
                                height: 34,
                                fontSize: 13,
                                bgcolor: person.is_active ? "primary.main" : "grey.400",
                              }}
                            >
                              {initials(person.full_name)}
                            </Avatar>
                            <Box sx={{ minWidth: 0 }}>
                              {/* Il Chip rende un <div>: va affiancato al
                                  Typography, non annidato dentro, altrimenti
                                  si ottiene un <div> dentro un <p> e React
                                  segnala un errore di idratazione. */}
                              <Stack
                                direction="row"
                                spacing={1}
                                sx={{ alignItems: "center" }}
                              >
                                <Typography sx={{ fontWeight: 600 }} noWrap>
                                  {person.full_name || "(senza nome)"}
                                </Typography>
                                {person.id === me?.id && (
                                  <Chip size="small" label="Tu" />
                                )}
                              </Stack>
                              <Typography variant="caption" color="text.secondary">
                                {person.email}
                              </Typography>
                            </Box>
                          </Stack>
                        </TableCell>

                        <TableCell>
                          {person.areas?.name
                            ? (
                              <Chip
                                size="small"
                                label={person.areas.name}
                                sx={{
                                  bgcolor: `${person.areas.color}1f`,
                                  color: person.areas.color,
                                  fontWeight: 600,
                                }}
                              />
                            )
                            : <Typography color="text.disabled">—</Typography>}
                        </TableCell>

                        <TableCell>
                          <Chip
                            size="small"
                            variant={person.role === "employee" ? "outlined" : "filled"}
                            color={person.role === "hr"
                              ? "primary"
                              : person.role === "manager"
                              ? "secondary"
                              : "default"}
                            label={ROLE_LABELS[person.role]}
                          />
                        </TableCell>

                        <TableCell>{person.job_title ?? "—"}</TableCell>

                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          {person.hired_on ? formatDay(person.hired_on) : "—"}
                        </TableCell>

                        <TableCell>
                          <Chip
                            size="small"
                            color={person.is_active ? "success" : "warning"}
                            label={person.is_active ? "Attivo" : "In attesa"}
                          />
                        </TableCell>

                        <TableCell align="right">
                          <IconButton
                            onClick={(event) =>
                              setMenu({ el: event.currentTarget, person })}
                          >
                            <MoreVertIcon />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
        </AsyncBlock>
      </Card>

      {/* ------------------------------------------------------------------ */}
      <Menu
        anchorEl={menu?.el}
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
      >
        <MenuItem
          onClick={() => {
            const person = menu!.person;
            setEditor({
              mode: "edit",
              id: person.id,
              email: person.email,
              fullName: person.full_name,
              role: person.role,
              areaId: person.area_id ?? "",
              jobTitle: person.job_title ?? "",
              hiredOn: person.hired_on ?? "",
              sendInvite: false,
            });
            setMenu(null);
          }}
        >
          Modifica
        </MenuItem>

        <MenuItem
          onClick={() => generateRecoveryLink(menu!.person)}
          disabled={busy}
        >
          Genera link di reimpostazione
        </MenuItem>

        {menu?.person.is_active
          ? (
            <MenuItem
              onClick={() => runAction("deactivate", menu.person)}
              disabled={busy || menu.person.id === me?.id}
            >
              Disattiva
            </MenuItem>
          )
          : (
            <MenuItem
              onClick={() => runAction("reactivate", menu!.person)}
              disabled={busy}
            >
              Attiva
            </MenuItem>
          )}

        <MenuItem
          onClick={() => {
            setConfirmDelete(menu!.person);
            setMenu(null);
          }}
          disabled={busy || menu?.person.id === me?.id}
          sx={{ color: "error.main" }}
        >
          Elimina definitivamente
        </MenuItem>
      </Menu>

      {/* ------------------------------------------------------------------ */}
      <Dialog
        open={editor !== null}
        onClose={() => setEditor(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {editor?.mode === "create" ? "Nuovo dipendente" : "Modifica dipendente"}
        </DialogTitle>
        <DialogContent dividers>
          {editor && (
            <Stack spacing={2} sx={{ pt: 0.5 }}>
              <TextField
                label="Email aziendale"
                type="email"
                fullWidth
                required
                value={editor.email}
                disabled={editor.mode === "edit"}
                onChange={(event) =>
                  setEditor({ ...editor, email: event.target.value })}
                helperText={editor.mode === "create"
                  ? "Se la persona ha gia' effettuato l'accesso con Microsoft, il profilo esistente verra' completato e attivato."
                  : "L'indirizzo di accesso non e' modificabile da qui."}
              />

              <TextField
                label="Nome e cognome"
                fullWidth
                required
                value={editor.fullName}
                onChange={(event) =>
                  setEditor({ ...editor, fullName: event.target.value })}
              />

              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <FormControl fullWidth>
                  <InputLabel id="editor-area">Area</InputLabel>
                  <Select
                    labelId="editor-area"
                    label="Area"
                    value={editor.areaId}
                    onChange={(event) =>
                      setEditor({ ...editor, areaId: event.target.value })}
                  >
                    <MenuItem value="">Nessuna area</MenuItem>
                    {data?.areas.map((area) => (
                      <MenuItem key={area.id} value={area.id}>
                        {area.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl fullWidth>
                  <InputLabel id="editor-role">Ruolo</InputLabel>
                  <Select
                    labelId="editor-role"
                    label="Ruolo"
                    value={editor.role}
                    onChange={(event) =>
                      setEditor({ ...editor, role: event.target.value as UserRole })}
                  >
                    {/* Nell'elenco delle assegnazioni non compare
                        SystemAdmin: non e' un ruolo che si da' da qui. */}
                    {ASSIGNABLE_ROLES.map((role) => (
                      <MenuItem key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>

              {editor.role === "manager" && !editor.areaId && (
                <Alert severity="warning">
                  Un responsabile senza area non puo&apos; valutare nessuno:
                  assegna l&apos;area di competenza.
                </Alert>
              )}

              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  label="Mansione"
                  fullWidth
                  value={editor.jobTitle}
                  onChange={(event) =>
                    setEditor({ ...editor, jobTitle: event.target.value })}
                />
                <TextField
                  label="Data di assunzione"
                  type="date"
                  fullWidth
                  value={editor.hiredOn}
                  onChange={(event) =>
                    setEditor({ ...editor, hiredOn: event.target.value })}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Stack>

              {editor.mode === "create" && (
                <Box>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={editor.sendInvite}
                        onChange={(event) =>
                          setEditor({ ...editor, sendInvite: event.target.checked })}
                      />
                    }
                    label="Invia anche un'email per impostare la password"
                  />
                  {editor.sendInvite && (
                    <Alert severity="info" sx={{ mt: 1, py: 0.5 }}>
                      L&apos;account viene creato comunque, con una password
                      temporanea che ti verra&apos; mostrata: l&apos;email e&apos;
                      un passaggio in piu&apos;, e se il server di posta non
                      risponde ricevi solo un avviso, non un errore.
                    </Alert>
                  )}
                </Box>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setEditor(null)} disabled={busy}>
            Annulla
          </Button>
          <Button
            variant="contained"
            onClick={saveEditor}
            disabled={busy || !editor?.fullName.trim() ||
              (editor?.mode === "create" && !editor.email.trim())}
          >
            {editor?.mode === "create" ? "Crea" : "Salva"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      {/* Consegna a mano: password temporanea o link di reimpostazione.     */}
      <Dialog
        open={handover !== null}
        onClose={() => setHandover(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{handover?.title}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            {handover?.description}
          </DialogContentText>
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: "center",
              p: 1.5,
              bgcolor: "action.hover",
              borderRadius: 2,
            }}
          >
            <Typography
              sx={{
                flex: 1,
                minWidth: 0,
                fontFamily: handover?.monospace ? "monospace" : undefined,
                fontSize: handover?.monospace ? "1.05rem" : "0.85rem",
                overflowWrap: "anywhere",
              }}
            >
              {handover?.value}
            </Typography>
            <Tooltip title="Copia">
              <IconButton
                onClick={() => {
                  void navigator.clipboard.writeText(handover?.value ?? "");
                  toast.success("Copiato negli appunti.");
                }}
              >
                <ContentCopyIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button variant="contained" onClick={() => setHandover(null)}>
            Fatto
          </Button>
        </DialogActions>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      <Dialog open={confirmDelete !== null} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Eliminare definitivamente?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Stai per eliminare <strong>{confirmDelete?.full_name}</strong>.
            Verranno rimossi anche il calendario, le richieste e le schede di
            valutazione collegate. Le compilazioni di gradimento restano, perche&apos;
            sono anonime e non collegate ad alcuna persona.
            <br />
            <br />
            Se ti serve solo impedire l&apos;accesso, usa <em>Disattiva</em>:
            i dati storici restano consultabili.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setConfirmDelete(null)} disabled={busy}>
            Annulla
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => runAction("delete", confirmDelete!)}
            disabled={busy}
          >
            Elimina
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
