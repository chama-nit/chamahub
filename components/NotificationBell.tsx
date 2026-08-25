"use client";

// ---------------------------------------------------------------------------
// La campanella delle notifiche
// ---------------------------------------------------------------------------
// Le notifiche nascono dai trigger sul database - apertura e chiusura di una
// richiesta, messaggi in conversazione, schede da compilare, correzioni - e
// questo componente si limita a mostrarle.
//
// Perche' si aggiorna da sola
// ---------------------------
// Non con un abbonamento in tempo reale: quel canale richiede la replica
// abilitata sul progetto, e per una campanella e' sproporzionato. Si rilegge
// ogni minuto, e subito quando la finestra torna in primo piano - che e' il
// momento in cui una persona guarda davvero se ha novita'.
//
// Cosa succede alla lettura
// -------------------------
// Aprire il pannello NON segna tutto come letto: aprire per sbirciare e' un
// gesto diverso dal prendere in carico. Si segna letta la singola notifica su
// cui si clicca, e c'e' un comando esplicito per azzerare tutto.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import NotificationsIcon from "@mui/icons-material/Notifications";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import AssignmentIcon from "@mui/icons-material/Assignment";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import EditNoteIcon from "@mui/icons-material/EditNote";
import MarkEmailReadIcon from "@mui/icons-material/MarkEmailRead";

import { useAuth } from "@/lib/auth/AuthProvider";
import { useAsync } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/format";
import type { AppNotification, NotificationKind } from "@/lib/types/models";

/** Ogni minuto: abbastanza per non sembrare ferma, poco per non pesare. */
const REFRESH_MS = 60_000;

const ICONS: Record<NotificationKind, React.ReactNode> = {
  request_opened: <AssignmentIcon fontSize="small" />,
  request_closed: <CheckCircleOutlineIcon fontSize="small" />,
  request_message: <ChatBubbleOutlineIcon fontSize="small" />,
  request_forwarded: <CallSplitIcon fontSize="small" />,
  evaluation_assigned: <EditNoteIcon fontSize="small" />,
  evaluation_corrected: <EditNoteIcon fontSize="small" />,
};

export default function NotificationBell() {
  const router = useRouter();
  const { profile } = useAuth();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  // Il caricamento passa da `useAsync`, lo stesso di tutte le altre pagine:
  // gestisce da solo lo scarto delle risposte superate e non fa setState
  // sincroni dentro l'effetto.
  const { data: caricate, reload } = useAsync<AppNotification[]>(async () => {
    if (!profile?.is_active) return [];
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);

    // Un errore qui non merita un avviso a schermo: la campanella e' un
    // contorno, e romperla non deve rompere la pagina sotto.
    if (error) return [];
    return (data ?? []) as AppNotification[];
  }, [profile?.is_active]);

  // Copia locale, perche' segnare una notifica come letta deve avere effetto
  // subito senza aspettare il giro successivo.
  const [letteLocalmente, setLetteLocalmente] = useState<Set<string>>(new Set());

  const items: AppNotification[] = (caricate ?? []).map((n) =>
    n.read_at || !letteLocalmente.has(n.id)
      ? n
      : { ...n, read_at: new Date().toISOString() }
  );

  useEffect(() => {
    const timer = setInterval(reload, REFRESH_MS);
    // Quando la finestra torna in primo piano: e' il momento in cui una
    // persona guarda davvero se ha novita'.
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [reload]);

  const unread = items.filter((n) => !n.read_at).length;

  async function apri(notifica: AppNotification) {
    setAnchor(null);

    if (!notifica.read_at) {
      const supabase = getSupabase();
      await supabase.rpc("mark_notifications_read", { p_ids: [notifica.id] });
      setLetteLocalmente((precedenti) => new Set(precedenti).add(notifica.id));
    }

    if (notifica.link) router.push(notifica.link);
  }

  async function segnaTutte() {
    const supabase = getSupabase();
    await supabase.rpc("mark_notifications_read", { p_ids: null });
    setLetteLocalmente(new Set(items.map((n) => n.id)));
  }

  if (!profile?.is_active) return null;

  return (
    <>
      <Tooltip title={unread > 0 ? `${unread} notifiche da leggere` : "Notifiche"}>
        <IconButton
          color="inherit"
          onClick={(event) => setAnchor(event.currentTarget)}
          aria-label={unread > 0
            ? `Notifiche, ${unread} da leggere`
            : "Notifiche"}
        >
          <Badge badgeContent={unread} color="error" max={99}>
            {unread > 0 ? <NotificationsIcon /> : <NotificationsNoneIcon />}
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { width: 380, maxWidth: "95vw" } } }}
      >
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", px: 2, py: 1.25 }}
        >
          <Typography sx={{ fontWeight: 700, flex: 1 }}>Notifiche</Typography>
          {unread > 0 && (
            <Button
              size="small"
              startIcon={<MarkEmailReadIcon />}
              onClick={segnaTutte}
            >
              Segna tutte
            </Button>
          )}
        </Stack>

        <Divider />

        {items.length === 0
          ? (
            <Box sx={{ px: 2, py: 4, textAlign: "center" }}>
              <NotificationsNoneIcon
                sx={{ fontSize: 40, color: "text.disabled", mb: 1 }}
              />
              <Typography variant="body2" color="text.secondary">
                Nessuna notifica.
              </Typography>
            </Box>
          )
          : (
            <List dense sx={{ maxHeight: 440, overflowY: "auto", py: 0 }}>
              {items.map((notifica) => (
                <ListItemButton
                  key={notifica.id}
                  onClick={() => apri(notifica)}
                  sx={{
                    alignItems: "flex-start",
                    gap: 1.25,
                    py: 1.25,
                    // Le non lette hanno un fondo appena percettibile e una
                    // barretta a sinistra: due segnali invece di uno, perche'
                    // il solo grassetto si perde in un elenco lungo.
                    bgcolor: notifica.read_at ? undefined : "action.hover",
                    borderLeft: "3px solid",
                    borderColor: notifica.read_at ? "transparent" : "primary.main",
                  }}
                >
                  <Box sx={{ color: "text.secondary", mt: 0.25 }}>
                    {ICONS[notifica.kind]}
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: notifica.read_at ? 500 : 700 }}
                    >
                      {notifica.title}
                    </Typography>
                    {notifica.body && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block" }}
                      >
                        {notifica.body}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.disabled">
                      {formatDateTime(notifica.created_at)}
                    </Typography>
                  </Box>
                </ListItemButton>
              ))}
            </List>
          )}
      </Popover>
    </>
  );
}
