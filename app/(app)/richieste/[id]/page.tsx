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
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SendIcon from "@mui/icons-material/Send";

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
import type { HrRequest, RequestMessage, RequestStatus } from "@/lib/types/models";

interface Loaded {
  request: HrRequest;
  messages: RequestMessage[];
}

export default function RequestDetailPage(
  props: PageProps<"/richieste/[id]">,
) {
  // In Next.js 16 i parametri di rotta sono una Promise anche nei componenti
  // client: `use` la risolve durante il render.
  const { id } = use(props.params);

  const router = useRouter();
  const toast = useToast();
  const { profile } = useAuth();

  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useAsync<Loaded>(async () => {
    const supabase = getSupabase();

    const { data: request, error: requestError } = await supabase
      .from("requests")
      .select(
        "*, requester:profiles!requests_requester_id_fkey (id, full_name, email), areas:area_id (id, name)",
      )
      .eq("id", id)
      .single();

    if (requestError) throw new Error(requestError.message);

    const { data: messages, error: messagesError } = await supabase
      .from("request_messages")
      .select("*, author:profiles!request_messages_author_id_fkey (id, full_name)")
      .eq("request_id", id)
      .order("created_at");

    if (messagesError) throw new Error(messagesError.message);

    return {
      request: request as HrRequest,
      messages: (messages ?? []) as RequestMessage[],
    };
  }, [id]);

  const request = data?.request;
  const isRequester = request?.requester_id === profile?.id;
  // Chi puo' cambiare lo stato: l'HR sempre, il responsabile per le richieste
  // indirizzate a lui. Le policy RLS applicano comunque la stessa regola.
  const canHandle = profile?.role === "hr" ||
    (profile?.role === "manager" && request?.recipient === "manager" &&
      !isRequester);

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
                )
                : undefined}
            >
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
                  return (
                    <Stack
                      key={message.id}
                      direction="row"
                      spacing={1.5}
                      sx={{
                        alignItems: "flex-start",
                        flexDirection: mine ? "row-reverse" : "row",
                      }}
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
                        }}
                      >
                        <Typography variant="caption" sx={{ fontWeight: 700 }}>
                          {message.author?.full_name ?? "Utente"}
                        </Typography>
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

              <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-end" }}>
                <TextField
                  fullWidth
                  multiline
                  minRows={2}
                  placeholder="Scrivi una risposta…"
                  value={reply}
                  disabled={busy || request.status === "closed"}
                  onChange={(event) => setReply(event.target.value)}
                  slotProps={{ htmlInput: { maxLength: 4000 } }}
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
    </>
  );
}
