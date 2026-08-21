"use client";

// ---------------------------------------------------------------------------
// Account creato ma non ancora abilitato dal reparto HR.
// ---------------------------------------------------------------------------
// E' la schermata che vede chi accede con Microsoft senza essere stato censito:
// il profilo esiste (creato dal trigger su auth.users) ma is_active resta false
// e ogni policy RLS gli nega l'accesso ai dati.
// ---------------------------------------------------------------------------

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import { useAuth } from "@/lib/auth/AuthProvider";

export default function ActivationPendingPage() {
  const { profile, loading, refreshProfile, signOut } = useAuth();

  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 2 }}>
      <Card sx={{ maxWidth: 520, borderRadius: 3 }}>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={2.5} sx={{ alignItems: "center", textAlign: "center" }}>
            <HourglassEmptyIcon sx={{ fontSize: 52, color: "warning.main" }} />

            <Typography variant="h2">Account in attesa di attivazione</Typography>

            <Typography color="text.secondary">
              Il tuo accesso e&apos; stato registrato correttamente
              {profile?.email ? ` con l'indirizzo ${profile.email}` : ""}, ma il
              reparto HR non ha ancora assegnato il tuo profilo a un&apos;area.
              Fino ad allora non e&apos; possibile consultare calendari,
              richieste o schede.
            </Typography>

            <Typography variant="body2" color="text.secondary">
              Contatta il reparto HR indicando il tuo nome e la tua area di
              appartenenza. Una volta abilitato, questa pagina si aggiornera&apos;
              automaticamente.
            </Typography>

            <Stack direction="row" spacing={1.5} sx={{ pt: 1 }}>
              <Button
                variant="contained"
                onClick={refreshProfile}
                disabled={loading}
                startIcon={loading ? <CircularProgress size={16} /> : undefined}
              >
                Verifica di nuovo
              </Button>
              <Button variant="outlined" color="inherit" onClick={signOut}>
                Esci
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
