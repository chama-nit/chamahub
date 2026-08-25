"use client";

// ---------------------------------------------------------------------------
// Dettaglio di una richiesta, con conversazione e gestione dello stato.
// ---------------------------------------------------------------------------

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SendIcon from "@mui/icons-material/Send";
import LockIcon from "@mui/icons-material/Lock";
import PeopleAltIcon from "@mui/icons-material/PeopleAlt";
import CallSplitIcon from "@mui/icons-material/CallSplit";

import PageHeader from "@/components/PageHeader";
import { AsyncBlock, SectionCard } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAsync } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase/client";
import {
  REQUEST_CATEGORY_LABELS,
  REQUEST_RECIPIENT_LABELS,
  REQUEST_STATUS_COLORS,
  REQUEST_STATUS_LABELS,
} from "@/lib/labels";
import { formatDateTime, initials } from "@/lib/format";
import type {
  Area,
  HrRequest,
  MessageAudience,
  RequestArea,
  RequestMessage,
  RequestStatus,
} from "@/lib/types/models";

interface Loaded {
  request: HrRequest;
  messages: RequestMessage[];
  /** Aree coinvolte, in ordine di ingresso. */
  involved: RequestArea[];
  /** Aree attive, per il menu dell'inoltro. */
  allAreas: Pick<Area, "id" | "name" | "color">[];
}

export default function RequestDetailPage(
  props: PageProps<"/richieste/[id]">,
) {
  // In Next.js 16 i parametri di rotta sono una Promise anche nei componenti
  // client: `use` la risolve durante il render.
  const { id } = use(props.params);

  const router = useRouter();
  const toast = useToast();
  const { profile, managedAreas } = useAuth();

  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  // Il canale su cui si scrive. Vale solo per chi gestisce la richiesta: il
  // richiedente scrive sempre a tutti, perche' l'altro canale non lo vede.
  const [audience, setAudience] = useState<MessageAudience>("everyone");

  // Inoltro
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardArea, setForwardArea] = useState("");
  const [forwardNote, setForwardNote] = useState("");

  const { data, loading, error, reload } = useAsync<Loaded>(async () => {
    const supabase = getSupabase();

    const { data: request, error: requestError } = await supabase
      .from("requests")
      .select(
        "*, requester:profiles!requests_requester_id_fkey (id, full_name, email), areas:area_id (id, name, color)",
      )
      .eq("id", id)
      .single();

    if (requestError) throw new Error(requestError.message);

    const [messagesRes, involvedRes, areasRes] = await Promise.all([
      supabase
        .from("request_messages")
        .select("*, author:profiles!request_messages_author_id_fkey (id, full_name)")
        .eq("request_id", id)
        .order("created_at"),
      supabase
        .from("request_areas")
        .select("*, areas:area_id (id, name, color)")
        .eq("request_id", id)
        .order("added_at"),
      // Le aree disponibili per un inoltro. Chi non puo' inoltrare riceve
      // comunque l'elenco vuoto dalle policy, non un errore.
      supabase.from("areas").select("id, name, color").eq("is_active", true).order("name"),
    ]);

    const messagesError = messagesRes.error;
    if (messagesError) throw new Error(messagesError.message);

    return {
      request: request as HrRequest,
      involved: (involvedRes.data ?? []) as RequestArea[],
      allAreas: (areasRes.data ?? []) as Pick<Area, "id" | "name" | "color">[],
      messages: (messagesRes.data ?? []) as RequestMessage[],
    };
  }, [id]);

  const request = data?.request;
  const isRequester = request?.requester_id === profile?.id;
  // Chi puo' cambiare lo stato: l'HR sempre, e chi guida l'area della
  // richiesta. Le policy RLS applicano comunque la stessa regola - il
  // controllo qui serve solo a non mostrare comandi che il database
  // rifiuterebbe.
  //
  // Si confronta con le aree GUIDATE: una richiesta arriva all'area del
  // richiedente, che puo' non essere quella di appartenenza di chi la gestisce.
  const canHandle = profile?.role === "hr" ||
    (request?.recipient === "manager" &&
      managedAreas.some((a) => a.id === request?.area_id) &&
      !isRequester);

  async function forwardRequest() {
    if (!forwardArea) return;
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { error: rpcError } = await supabase.rpc("forward_request", {
        p_request: id,
        p_area: forwardArea,
        p_note: forwardNote.trim() || null,
      });
      if (rpcError) throw new Error(rpcError.message);

      toast.success("Richiesta inoltrata.");
      setForwardOpen(false);
      setForwardArea("");
      setForwardNote("");
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (!profile || !reply.trim()) return;
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { error: insertError } = await supabase
        .from("request_messages")
        .insert({
          request_id: id,
          author_id: profile.id,
          body: reply.trim(),
          audience: canHandle ? audience : "everyone",
        });

      if (insertError) throw new Error(insertError.message);

      setReply("");
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status: RequestStatus) {
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { error: updateError } = await supabase
        .from("requests")
        .update({ status, assignee_id: profile?.id ?? null })
        .eq("id", id);

      if (updateError) throw new Error(updateError.message);

      toast.success(`Richiesta impostata su "${REQUEST_STATUS_LABELS[status]}".`);
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
        title={request?.subject ?? "Richiesta"}
        description={request
          ? (
            <Stack
              direction="row"
              spacing={1}
              sx={{ flexWrap: "wrap", gap: 1, mt: 1 }}
            >
              <Chip
                size="small"
                color={REQUEST_STATUS_COLORS[request.status]}
                label={REQUEST_STATUS_LABELS[request.status]}
              />
              <Chip
                size="small"
                variant="outlined"
                label={REQUEST_CATEGORY_LABELS[request.category]}
              />
              <Chip
                size="small"
                variant="outlined"
                label={`A: ${REQUEST_RECIPIENT_LABELS[request.recipient]}`}
              />
            </Stack>
          )
          : undefined}
        actions={
          <Button startIcon={<ArrowBackIcon />} onClick={() => router.back()}>
            Indietro
          </Button>
        }
      />

      <AsyncBlock loading={loading} error={error}>
        {request && (
          <Stack spacing={3}>
            <SectionCard
              title="Richiesta"
              subtitle={`Inviata da ${request.requester?.full_name ?? "—"}${
                request.areas?.name ? ` · ${request.areas.name}` : ""
              } il ${formatDateTime(request.created_at)}`}
              actions={canHandle
                ? (
                  <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: "center" }}>
                    <Button
                      variant="outlined"
                      startIcon={<CallSplitIcon />}
                      onClick={() => setForwardOpen(true)}
                      disabled={busy}
                    >
                      Coinvolgi un&apos;area
                    </Button>
                  <FormControl sx={{ minWidth: 190 }}>
                    <InputLabel id="status-label">Stato</InputLabel>
                    <Select
                      labelId="status-label"
                      label="Stato"
                      value={request.status}
                      disabled={busy}
                      onChange={(event) =>
                        changeStatus(event.target.value as RequestStatus)}
                    >
                      {(Object.keys(REQUEST_STATUS_LABELS) as RequestStatus[]).map(
                        (status) => (
                          <MenuItem key={status} value={status}>
                            {REQUEST_STATUS_LABELS[status]}
                          </MenuItem>
                        ),
                      )}
                    </Select>
                  </FormControl>
                  </Stack>
                )
                : undefined}
            >
              {/* -----------------------------------------------------------
                  Le aree coinvolte.
                  -----------------------------------------------------------
                  Compare solo quando sono piu' d'una: su una richiesta
                  normale ripeterebbe un'informazione gia' scritta sotto il
                  nome del richiedente. Il richiedente lo vede come chiunque
                  altro - e' "l'esito" a cui ha diritto - mentre cosa si sono
                  detti i responsabili resta fra loro.
                  ----------------------------------------------------------- */}
              {data.involved.length > 1 && (
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{ alignItems: "center", flexWrap: "wrap", mb: 2 }}
                >
                  <Typography variant="caption" color="text.secondary">
                    Aree coinvolte:
                  </Typography>
                  {data.involved.map((ra) => (
                    <Chip
                      key={ra.area_id}
                      size="small"
                      label={ra.areas?.name ?? "?"}
                      variant={ra.is_origin ? "filled" : "outlined"}
                      sx={{
                        fontWeight: 600,
                        bgcolor: ra.is_origin
                          ? `${ra.areas?.color ?? "#888"}22`
                          : undefined,
                        color: ra.areas?.color ?? undefined,
                        borderColor: ra.areas?.color ?? undefined,
                      }}
                    />
                  ))}
                </Stack>
              )}

              <Typography sx={{ whiteSpace: "pre-wrap" }}>
                {request.body}
              </Typography>

              {request.closed_at && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  Chiusa il {formatDateTime(request.closed_at)}.
                </Typography>
              )}
            </SectionCard>

            {/* ----------------------------------------------------------- */}
            <SectionCard title={`Conversazione (${data.messages.length})`}>
              <Stack spacing={2}>
                {data.messages.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    Nessun messaggio. Scrivi qui sotto per rispondere.
                  </Typography>
                )}

                {data.messages.map((message) => {
                  const mine = message.author_id === profile?.id;

                  // I messaggi di sistema non sono di nessuno: niente
                  // nuvoletta, niente avatar, una riga al centro come le
                  // date in una chat. Metterli in bocca a chi ha premuto il
                  // pulsante li farebbe sembrare una sua opinione.
                  if (message.is_system) {
                    return (
                      <Stack
                        key={message.id}
                        direction="row"
                        spacing={1}
                        useFlexGap
                        sx={{ alignItems: "center", justifyContent: "center", py: 0.5 }}
                      >
                        <CallSplitIcon fontSize="small" sx={{ color: "text.disabled" }} />
                        <Typography variant="caption" color="text.secondary">
                          {message.body} · {formatDateTime(message.created_at)}
                        </Typography>
                      </Stack>
                    );
                  }

                  const riservato = message.audience === "managers";
                  return (
                    // `direction` e `useFlexGap` invece di rovesciare la
                    // direzione con `sx`: Stack, per distanziare, mette un
                    // margine sinistro sul secondo elemento del DOM. Con la
                    // riga rovesciata quel margine finisce dalla parte
                    // sbagliata - lo spazio si apre verso il bordo e la
                    // nuvoletta va a sbattere contro l'avatar. Con `gap` la
                    // distanza sta fra i due elementi, comunque siano
                    // ordinati.
                    <Stack
                      key={message.id}
                      direction={mine ? "row-reverse" : "row"}
                      spacing={1.5}
                      useFlexGap
                      sx={{ alignItems: "flex-start" }}
                    >
                      <Avatar
                        sx={{
                          width: 34,
                          height: 34,
                          fontSize: 13,
                          bgcolor: mine ? "primary.main" : "secondary.main",
                        }}
                      >
                        {initials(message.author?.full_name ?? "?")}
                      </Avatar>
                      <Box
                        sx={{
                          maxWidth: "78%",
                          bgcolor: mine ? "primary.main" : "action.hover",
                          color: mine ? "primary.contrastText" : "text.primary",
                          px: 1.75,
                          py: 1.25,
                          borderRadius: 2,
                          ...(riservato && {
                            border: "2px solid",
                            borderColor: "warning.main",
                          }),
                        }}
                      >
                        <Stack
                          direction="row"
                          spacing={0.5}
                          useFlexGap
                          sx={{ alignItems: "center" }}
                        >
                          <Typography variant="caption" sx={{ fontWeight: 700 }}>
                            {/* Il ripiego resta, ma ora e' davvero un caso
                                limite: le policy della migrazione 19 rendono
                                leggibile il profilo di chi scrive. */}
                            {message.author?.full_name ?? "Utente"}
                          </Typography>
                          {riservato && (
                            <Chip
                              size="small"
                              icon={<LockIcon sx={{ fontSize: 13 }} />}
                              label="Solo responsabili"
                              sx={{ height: 18, fontSize: "0.65rem", fontWeight: 700 }}
                            />
                          )}
                        </Stack>
                        <Typography sx={{ whiteSpace: "pre-wrap" }}>
                          {message.body}
                        </Typography>
                        <Typography variant="caption" sx={{ opacity: 0.75 }}>
                          {formatDateTime(message.created_at)}
                        </Typography>
                      </Box>
                    </Stack>
                  );
                })}
              </Stack>

              <Divider sx={{ my: 2.5 }} />

              {/* ---------------------------------------------------------
                  Il canale su cui si scrive.
                  ---------------------------------------------------------
                  Compare solo a chi gestisce la richiesta: il richiedente non
                  vede il canale riservato, quindi offrirgli una scelta fra due
                  cose di cui ne conosce una sola sarebbe solo confusione.

                  Nessuna preselezione furba: la scelta e' esplicita e lo stato
                  corrente si legge a colpo d'occhio, perche' i due errori
                  possibili non si equivalgono. Scrivere per sbaglio in chiaro
                  una valutazione di budget e' un danno; scrivere per sbaglio
                  in riservato una risposta al dipendente e' un fastidio.
                  --------------------------------------------------------- */}
              {canHandle && (
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={audience}
                  onChange={(_e, v) => v && setAudience(v as MessageAudience)}
                  sx={{ mb: 1.5 }}
                >
                  <ToggleButton value="everyone">
                    <PeopleAltIcon fontSize="small" sx={{ mr: 0.75 }} />
                    Visibile a tutti
                  </ToggleButton>
                  <ToggleButton value="managers">
                    <LockIcon fontSize="small" sx={{ mr: 0.75 }} />
                    Solo fra responsabili
                  </ToggleButton>
                </ToggleButtonGroup>
              )}

              <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-end" }}>
                <TextField
                  fullWidth
                  multiline
                  minRows={2}
                  placeholder={canHandle && audience === "managers"
                    ? "Nota riservata ai responsabili…"
                    : "Scrivi una risposta…"}
                  value={reply}
                  disabled={busy || request.status === "closed"}
                  onChange={(event) => setReply(event.target.value)}
                  slotProps={{ htmlInput: { maxLength: 4000 } }}
                  sx={canHandle && audience === "managers"
                    ? {
                      // Bordo colorato invece di uno sfondo: si vede che il
                      // campo e' "diverso" senza toccare il contrasto del
                      // testo, che deve restare leggibile in entrambi i temi.
                      "& .MuiOutlinedInput-notchedOutline": {
                        borderColor: "warning.main",
                        borderWidth: 2,
                      },
                    }
                    : undefined}
                />
                <Button
                  variant="contained"
                  startIcon={<SendIcon />}
                  onClick={sendReply}
                  disabled={busy || !reply.trim() || request.status === "closed"}
                >
                  Invia
                </Button>
              </Stack>

              {request.status === "closed" && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  La richiesta e&apos; chiusa: per riaprire la conversazione
                  chiedi al destinatario di rimetterla in lavorazione.
                </Typography>
              )}
            </SectionCard>
          </Stack>
        )}
      </AsyncBlock>

      {/* -------------------------------------------------------------------
          Inoltro a un'altra area
          -------------------------------------------------------------------
          Due campi e una spiegazione. La spiegazione conta quanto i campi:
          senza, nessuno saprebbe che la nota resta fra i responsabili mentre
          il passaggio di area lo vede anche chi ha aperto la richiesta.
          ------------------------------------------------------------------- */}
      <Dialog
        open={forwardOpen}
        onClose={() => !busy && setForwardOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Coinvolgi un&apos;altra area</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              La richiesta resta una sola e conserva tutta la sua storia:
              l&apos;area che coinvolgi la vedra&apos; dall&apos;inizio e potra&apos;
              rispondere. Chi ha aperto la richiesta vedra&apos; che e&apos;
              passata di mano, ma non quello che vi direte.
            </Typography>

            <FormControl fullWidth>
              <InputLabel id="forward-area">Area da coinvolgere</InputLabel>
              <Select
                labelId="forward-area"
                label="Area da coinvolgere"
                value={forwardArea}
                onChange={(event) => setForwardArea(event.target.value)}
              >
                {(data?.allAreas ?? [])
                  .filter((area) =>
                    !(data?.involved ?? []).some((ra) => ra.area_id === area.id)
                  )
                  .map((area) => (
                    <MenuItem key={area.id} value={area.id}>
                      {area.name}
                    </MenuItem>
                  ))}
              </Select>
              <FormHelperText>
                Le aree gia&apos; coinvolte non compaiono.
              </FormHelperText>
            </FormControl>

            <TextField
              label="Perche' la coinvolgi"
              fullWidth
              multiline
              minRows={3}
              value={forwardNote}
              onChange={(event) => setForwardNote(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 4000 } }}
              helperText="Facoltativo, e riservato ai responsabili: e' il posto giusto per numeri, priorita' e valutazioni che non riguardano chi ha aperto la richiesta."
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForwardOpen(false)} disabled={busy}>
            Annulla
          </Button>
          <Button
            variant="contained"
            onClick={forwardRequest}
            disabled={busy || !forwardArea}
            startIcon={<CallSplitIcon />}
          >
            Inoltra
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
