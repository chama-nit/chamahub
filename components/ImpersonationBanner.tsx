"use client";

// ---------------------------------------------------------------------------
// Striscia di avviso durante un'impersonificazione
// ---------------------------------------------------------------------------
// Deve essere impossibile dimenticarsi di essere nei panni di un'altra
// persona: la striscia sta in cima a ogni pagina, non si chiude, e porta con
// se' il comando per tornare indietro.
// ---------------------------------------------------------------------------

import { useCallback, useState, useSyncExternalStore } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";

import {
  parseImpersonation,
  readImpersonationRaw,
  stopImpersonation,
  subscribeImpersonation,
} from "@/lib/auth/impersonation";

export default function ImpersonationBanner() {
  const raw = useSyncExternalStore(
    subscribeImpersonation,
    readImpersonationRaw,
    // In prerendering non c'e' localStorage: nessuna striscia.
    useCallback(() => "", []),
  );
  const [busy, setBusy] = useState(false);

  const state = parseImpersonation(raw);
  if (!state) return null;

  return (
    <Box sx={{ px: { xs: 2, md: 3 }, pt: 2 }}>
      <Alert
        severity="warning"
        variant="filled"
        action={
          <Button
            color="inherit"
            size="small"
            disabled={busy}
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}
            onClick={() => {
              setBusy(true);
              void stopImpersonation();
            }}
          >
            Torna nei miei panni
          </Button>
        }
      >
        Stai usando ChamaHub come <strong>{state.target.full_name}</strong>.
        Tutto quello che fai risulta fatto da questa persona.
      </Alert>
    </Box>
  );
}
