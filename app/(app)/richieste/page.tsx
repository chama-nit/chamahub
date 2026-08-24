"use client";

// ---------------------------------------------------------------------------
// Richieste: elenco di quelle inviate e, per responsabili e HR, di quelle
// ricevute. Le policy RLS garantiscono che ognuno veda solo cio' che gli
// compete; qui i filtri servono unicamente alla leggibilita'.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import QuestionAnswerIcon from "@mui/icons-material/QuestionAnswer";

import PageHeader from "@/components/PageHeader";
import { AsyncBlock, EmptyState } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAsync } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase/client";
import {
  REQUEST_CATEGORY_LABELS,
  REQUEST_RECIPIENT_LABELS,
  SELECTABLE_REQUEST_CATEGORIES,
  REQUEST_STATUS_COLORS,
  REQUEST_STATUS_LABELS,
} from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import type {
  HrRequest,
  RequestCategory,
  RequestRecipient,
  RequestStatus,
} from "@/lib/types/models";

const SELECT =
  "*, requester:profiles!requests_requester_id_fkey (id, full_name, email), areas:area_id (id, name)";

export default function RequestsPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const canReceive = profile?.role === "manager" || profile?.role === "hr" ||
    profile?.role === "sysadmin";

  // L'HR e' il destinatario delle richieste, non un mittente: una richiesta
  // dell'HR all'HR non avrebbe nessuno a cui arrivare. Lo stesso divieto e'
  // scritto nelle policy RLS, cosi' non dipende dall'interfaccia.
  const canCompose = profile?.role !== "hr" && profile?.role !== "sysadmin";

  const [tab, setTab] = useState<"sent" | "received">(
    canCompose ? "sent" : "received",
  );
  const [statusFilter, setStatusFilter] = useState<RequestStatus | "all">("all");
  const [composerOpen, setComposerOpen] = useState(false);

  const { data, loading, error, reload } = useAsync<HrRequest[]>(async () => {
    const supabase = getSupabase();
    let query = supabase.from("requests").select(SELECT);

    if (tab === "sent") {
      query = query.eq("requester_id", profile!.id);
    } else {
      // Le richieste ricevute sono quelle indirizzate al proprio ruolo e non
      // inviate da se stessi.
      query = query
        .eq("recipient", profile!.role === "manager" ? "manager" : "hr")
        .neq("requester_id", profile!.id);
    }

    const { data: rows, error: queryError } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (queryError) throw new Error(queryError.message);
    return (rows ?? []) as HrRequest[];
  }, [profile?.id, profile?.role, tab]);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return data ?? [];
    return (data ?? []).filter((request) => request.status === statusFilter);
  }, [data, statusFilter]);

  return (
    <>
      <PageHeader
        title="Richieste"
        description={canCompose
          ? "Invia una richiesta al tuo responsabile o al reparto HR e segui la conversazione fino alla chiusura."
          : "Le richieste che i dipendenti hanno indirizzato al reparto HR, dalla presa in carico alla chiusura."}
        actions={canCompose
          ? (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setComposerOpen(true)}
            >
              Nuova richiesta
            </Button>
          )
          : undefined}
      />

      <Card>
        {canReceive && (
          <Tabs
            value={tab}
            onChange={(_event, value) => setTab(value as "sent" | "received")}
            sx={{ px: 2, borderBottom: "1px solid", borderColor: "divider" }}
          >
            {/* Chi non puo' inviare richieste non ha una scheda "le mie". */}
            {canCompose && <Tab value="sent" label="Le mie richieste" />}
            <Tab
              value="received"
              label={profile?.role === "manager"
                ? "Ricevute dalla mia area"
                : "Ricevute dall'HR"}
            />
          </Tabs>
        )}

        <Stack
          direction="row"
          spacing={2}
          sx={{ px: 2.5, py: 2, alignItems: "center" }}
        >
          <FormControl sx={{ minWidth: 200 }}>
            <InputLabel id="status-filter">Stato</InputLabel>
            <Select
              labelId="status-filter"
              label="Stato"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as RequestStatus | "all")}
            >
              <MenuItem value="all">Tutti gli stati</MenuItem>
              {(Object.keys(REQUEST_STATUS_LABELS) as RequestStatus[]).map((status) => (
                <MenuItem key={status} value={status}>
                  {REQUEST_STATUS_LABELS[status]}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography variant="body2" color="text.secondary">
            {filtered.length} richieste
          </Typography>
        </Stack>

        <AsyncBlock loading={loading} error={error}>
          {filtered.length === 0
            ? (
              <CardContent>
                <EmptyState
                  icon={<QuestionAnswerIcon sx={{ fontSize: 48 }} />}
                  title={tab === "sent"
                    ? "Non hai ancora inviato richieste"
                    : "Nessuna richiesta ricevuta"}
                  description={tab === "sent"
                    ? "Usa il pulsante in alto a destra per inviare la prima."
                    : "Quando qualcuno scrivera' al reparto, la richiesta comparira' qui."}
                />
              </CardContent>
            )
            : (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Oggetto</TableCell>
                      {tab === "received" && <TableCell>Richiedente</TableCell>}
                      <TableCell>Categoria</TableCell>
                      {tab === "sent" && <TableCell>Destinatario</TableCell>}
                      <TableCell>Stato</TableCell>
                      <TableCell>Inviata il</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filtered.map((request) => (
                      <TableRow
                        key={request.id}
                        hover
                        sx={{ cursor: "pointer" }}
                        onClick={() => router.push(`/richieste/${request.id}`)}
                      >
                        <TableCell sx={{ maxWidth: 320 }}>
                          <Typography sx={{ fontWeight: 600 }} noWrap>
                            {request.subject}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            {request.body}
                          </Typography>
                        </TableCell>

                        {tab === "received" && (
                          <TableCell>
                            {request.requester?.full_name ?? "—"}
                            {request.areas?.name && (
                              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                                {request.areas.name}
                              </Typography>
                            )}
                          </TableCell>
                        )}

                        <TableCell>
                          <Chip
                            size="small"
                            variant="outlined"
                            label={REQUEST_CATEGORY_LABELS[request.category]}
                          />
                        </TableCell>

                        {tab === "sent" && (
                          <TableCell>
                            {REQUEST_RECIPIENT_LABELS[request.recipient]}
                          </TableCell>
                        )}

                        <TableCell>
                          <Chip
                            size="small"
                            color={REQUEST_STATUS_COLORS[request.status]}
                            label={REQUEST_STATUS_LABELS[request.status]}
                          />
                        </TableCell>

                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          {formatDateTime(request.created_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
        </AsyncBlock>
      </Card>

      <ComposerDialog
        open={composerOpen && canCompose}
        onClose={() => setComposerOpen(false)}
        onCreated={() => {
          setTab("sent");
          reload();
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
function ComposerDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { profile } = useAuth();
  const toast = useToast();

  const [recipient, setRecipient] = useState<RequestRecipient>("manager");
  const [category, setCategory] = useState<RequestCategory>("equipment");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const noArea = !profile?.area_id;

  async function save() {
    if (!profile) return;
    setSaving(true);
    try {
      const supabase = getSupabase();
      const { error: insertError } = await supabase.from("requests").insert({
        requester_id: profile.id,
        recipient,
        category,
        subject: subject.trim(),
        body: body.trim(),
      });

      if (insertError) throw new Error(insertError.message);

      toast.success("Richiesta inviata.");
      setSubject("");
      setBody("");
      onClose();
      onCreated();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Nuova richiesta</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <FormControl fullWidth>
            <InputLabel id="recipient-label">Destinatario</InputLabel>
            <Select
              labelId="recipient-label"
              label="Destinatario"
              value={recipient}
              onChange={(event) =>
                setRecipient(event.target.value as RequestRecipient)}
            >
              <MenuItem value="manager" disabled={noArea}>
                {REQUEST_RECIPIENT_LABELS.manager}
                {noArea ? " (non disponibile: nessuna area assegnata)" : ""}
              </MenuItem>
              <MenuItem value="hr">{REQUEST_RECIPIENT_LABELS.hr}</MenuItem>
            </Select>
          </FormControl>

          <FormControl fullWidth>
            <InputLabel id="category-label">Categoria</InputLabel>
            <Select
              labelId="category-label"
              label="Categoria"
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as RequestCategory)}
            >
              {SELECTABLE_REQUEST_CATEGORIES.map((option) => (
                <MenuItem key={option} value={option}>
                  {REQUEST_CATEGORY_LABELS[option]}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="Oggetto"
            fullWidth
            required
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 160 } }}
          />

          <TextField
            label="Descrizione"
            fullWidth
            required
            multiline
            minRows={5}
            placeholder="Spiega con che tempi e per quale motivo, cosi' da ricevere una risposta rapida."
            value={body}
            onChange={(event) => setBody(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 4000 } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          Annulla
        </Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={saving || !subject.trim() || !body.trim()}
        >
          Invia
        </Button>
      </DialogActions>
    </Dialog>
  );
}
