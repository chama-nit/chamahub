"use client";

// ---------------------------------------------------------------------------
// La schermata di manutenzione
// ---------------------------------------------------------------------------
// Quello che vede chiunque non sia SystemAdmin mentre la manutenzione e'
// attiva: sia chi era gia' dentro, sia chi prova a entrare dalla pagina di
// accesso.
//
// Questa pagina NON e' il blocco. Il blocco sta nelle policy del database, che
// durante la manutenzione non restituiscono niente a nessuno tranne al
// SystemAdmin. Questa e' la spiegazione: senza, si vedrebbe un'applicazione
// vuota e si penserebbe a un guasto.
// ---------------------------------------------------------------------------

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import BuildIcon from "@mui/icons-material/Build";
import RefreshIcon from "@mui/icons-material/Refresh";

import Logo from "@/components/Logo";
import { BRAND_GRADIENT } from "@/lib/brand";

export default function MaintenanceScreen(
  { message, onRetry }: { message?: string | null; onRetry?: () => void },
) {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        p: 2,
        background: BRAND_GRADIENT,
      }}
    >
      <Stack spacing={3} sx={{ width: "100%", maxWidth: 460 }}>
        <Logo size={64} tone="contrast" stacked />

        <Card sx={{ borderRadius: 3 }}>
          <CardContent sx={{ p: 4 }}>
            <Stack spacing={2.5} sx={{ alignItems: "center", textAlign: "center" }}>
              <BuildIcon sx={{ fontSize: 52, color: "warning.main" }} />

              <Typography variant="h2">E&apos; in corso la manutenzione</Typography>

              <Typography color="text.secondary">
                {/* Il messaggio dell'amministratore, se lo ha scritto. E'
                    l'unico posto in cui puo' dire quanto durera' o perche':
                    senza, resta la frase generica, che e' comunque meglio di
                    una pagina bianca. */}
                {message?.trim() ||
                  "L'applicazione e' temporaneamente non disponibile. Riprova fra qualche minuto: non serve fare altro, e nessun dato e' andato perso."}
              </Typography>

              {onRetry && (
                <Button
                  variant="contained"
                  startIcon={<RefreshIcon />}
                  onClick={onRetry}
                >
                  Riprova
                </Button>
              )}
            </Stack>
          </CardContent>
        </Card>

        <Typography
          variant="caption"
          sx={{ color: "rgba(255,255,255,0.75)", textAlign: "center" }}
        >
          Se la cosa si protrae oltre il previsto, avvisa il reparto HR.
        </Typography>
      </Stack>
    </Box>
  );
}
