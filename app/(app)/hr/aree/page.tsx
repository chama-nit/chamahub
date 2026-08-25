"use client";

// ---------------------------------------------------------------------------
// Gestione delle aree aziendali (solo HR)
// ---------------------------------------------------------------------------
// La nomina a responsabile non avviene qui ma sulla scheda del dipendente, nel
// campo "Aree da guidare". Un responsabile e' semplicemente una persona a cui
// e' stata affidata almeno un'area - e puo' essere piu' d'una, cosi' come
// un'area puo' avere piu' responsabili.
//
// (Testo storico, prima della migrazione 18: un responsabile era una persona
// con ruolo "manager" assegnata a
// quell'area. Il collegamento e' quindi sempre coerente e non esiste il caso di
// un'area che punta a un responsabile che nel frattempo si e' spostato.)
// ---------------------------------------------------------------------------

import { useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import BusinessIcon from "@mui/icons-material/Business";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/Edit";
import PeopleIcon from "@mui/icons-material/People";

import PageHeader from "@/components/PageHeader";
import { AsyncBlock, AutoGrid, EmptyState } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { useAsync } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase/client";
import { AREA_PALETTE } from "@/lib/chart-colors";
import type { AreaOverview } from "@/lib/types/models";

// La tavolozza vive in lib/chart-colors: gli stessi colori servono ai grafici,
// dove devono restare distinguibili l'uno dall'altro e leggibili su entrambi i
// temi. Averne una copia qui significherebbe vederle divergere alla prima
// modifica.
const PALETTE = AREA_PALETTE;

interface EditorState {
  id?: string;
  name: string;
  description: string;
  color: string;
  isActive: boolean;
}

export default function HrAreasPage() {
  const router = useRouter();
  const toast = useToast();

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AreaOverview | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useAsync<AreaOverview[]>(async () => {
    const supabase = getSupabase();
    const { data: areas, error: queryError } = await supabase
      .from("v_areas_overview")
      .select("*")
      .order("name")
      .order("id");

    if (queryError) throw new Error(queryError.message);
    return (areas ?? []) as AreaOverview[];
  }, []);

  async function save() {
    if (!editor) return;
    setBusy(true);
    try {
      const supabase = getSupabase();
      const payload = {
        name: editor.name.trim(),
        description: editor.description.trim() || null,
        color: editor.color,
        is_active: editor.isActive,
      };

      const { error: writeError } = editor.id
        ? await supabase.from("areas").update(payload).eq("id", editor.id)
        : await supabase.from("areas").insert(payload);

      if (writeError) throw new Error(writeError.message);

      toast.success(editor.id ? "Area aggiornata." : "Area creata.");
      setEditor(null);
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { error: deleteError } = await supabase
        .from("areas")
        .delete()
        .eq("id", confirmDelete.id);

      if (deleteError) throw new Error(deleteError.message);

      toast.success("Area eliminata.");
      setConfirmDelete(null);
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Aree"
        description="Le aree raggruppano i dipendenti e determinano chi vede cosa: chi guida un'area ne vede calendario, richieste e valutazioni. Una persona puo' guidarne piu' d'una, e un'area puo' avere piu' responsabili."
        actions={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() =>
              setEditor({
                name: "",
                description: "",
                color: PALETTE[0],
                isActive: true,
              })}
          >
            Nuova area
          </Button>
        }
      />

      <AsyncBlock loading={loading} error={error}>
        {(data ?? []).length === 0
          ? (
            <Card>
              <CardContent>
                <EmptyState
                  icon={<BusinessIcon sx={{ fontSize: 48 }} />}
                  title="Nessuna area creata"
                  description="Crea la prima area, poi assegna i dipendenti dalla sezione Dipendenti."
                />
              </CardContent>
            </Card>
          )
          : (
            <AutoGrid min={300}>
              {(data ?? []).map((area) => (
                <Card key={area.id} sx={{ opacity: area.is_active ? 1 : 0.6 }}>
                  <Box sx={{ height: 5, bgcolor: area.color }} />
                  <CardContent>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "flex-start", justifyContent: "space-between" }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="h3">{area.name}</Typography>
                        {!area.is_active && (
                          <Chip size="small" label="Non attiva" sx={{ mt: 0.5 }} />
                        )}
                      </Box>
                      <Stack direction="row" spacing={0.5}>
                        <IconButton
                          size="small"
                          onClick={() =>
                            setEditor({
                              id: area.id,
                              name: area.name,
                              description: area.description ?? "",
                              color: area.color,
                              isActive: area.is_active,
                            })}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => setConfirmDelete(area)}
                        >
                          <DeleteOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </Stack>

                    {area.description && (
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mt: 1 }}
                      >
                        {area.description}
                      </Typography>
                    )}

                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ mt: 2, alignItems: "center" }}
                    >
                      <PeopleIcon fontSize="small" sx={{ color: "text.disabled" }} />
                      <Typography variant="body2">
                        {area.headcount}{" "}
                        {area.headcount === 1 ? "persona" : "persone"}
                      </Typography>
                    </Stack>

                    <Box sx={{ mt: 1.5 }}>
                      <Typography variant="overline" color="text.secondary">
                        Responsabili
                      </Typography>
                      {area.manager_names.length === 0
                        ? (
                          <Alert severity="warning" sx={{ mt: 0.5, py: 0 }}>
                            Nessun responsabile: le campagne di valutazione non
                            genereranno schede per quest&apos;area. Si assegna
                            dalla scheda di un dipendente, in &laquo;Aree da
                            guidare&raquo;.
                          </Alert>
                        )
                        : (
                          <Stack
                            direction="row"
                            spacing={0.5}
                            sx={{ flexWrap: "wrap", gap: 0.5, mt: 0.5 }}
                          >
                            {area.manager_names.map((name) => (
                              <Chip key={name} size="small" label={name} />
                            ))}
                          </Stack>
                        )}
                    </Box>

                    <Button
                      size="small"
                      sx={{ mt: 2 }}
                      onClick={() => router.push("/hr/dipendenti")}
                    >
                      Gestisci le persone
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </AutoGrid>
          )}
      </AsyncBlock>

      {/* ------------------------------------------------------------------ */}
      <Dialog
        open={editor !== null}
        onClose={() => setEditor(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{editor?.id ? "Modifica area" : "Nuova area"}</DialogTitle>
        <DialogContent dividers>
          {editor && (
            <Stack spacing={2} sx={{ pt: 0.5 }}>
              <TextField
                label="Nome"
                fullWidth
                required
                value={editor.name}
                onChange={(event) =>
                  setEditor({ ...editor, name: event.target.value })}
              />
              <TextField
                label="Descrizione"
                fullWidth
                multiline
                minRows={2}
                value={editor.description}
                onChange={(event) =>
                  setEditor({ ...editor, description: event.target.value })}
              />

              <Box>
                <Typography variant="overline" color="text.secondary">
                  Colore
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: "wrap", gap: 1 }}>
                  {PALETTE.map((color) => (
                    <Box
                      key={color}
                      onClick={() => setEditor({ ...editor, color })}
                      sx={{
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        bgcolor: color,
                        cursor: "pointer",
                        border: "3px solid",
                        borderColor: editor.color === color
                          ? "text.primary"
                          : "transparent",
                      }}
                    />
                  ))}
                </Stack>
              </Box>

              <FormControlLabel
                control={
                  <Switch
                    checked={editor.isActive}
                    onChange={(event) =>
                      setEditor({ ...editor, isActive: event.target.checked })}
                  />
                }
                label="Area attiva"
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setEditor(null)} disabled={busy}>
            Annulla
          </Button>
          <Button
            variant="contained"
            onClick={save}
            disabled={busy || !editor?.name.trim()}
          >
            Salva
          </Button>
        </DialogActions>
      </Dialog>

      {/* ------------------------------------------------------------------ */}
      <Dialog open={confirmDelete !== null} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Eliminare l&apos;area?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            L&apos;area <strong>{confirmDelete?.name}</strong> verra&apos;
            eliminata. Le {confirmDelete?.headcount ?? 0} persone assegnate
            resteranno in anagrafica ma senza area, e fino a una nuova
            assegnazione non potranno inviare richieste al responsabile ne&apos;
            comparire nei calendari di area.
            <br />
            <br />
            In alternativa puoi semplicemente disattivarla.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setConfirmDelete(null)} disabled={busy}>
            Annulla
          </Button>
          <Button color="error" variant="contained" onClick={remove} disabled={busy}>
            Elimina
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
