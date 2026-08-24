"use client";

// ---------------------------------------------------------------------------
// Profilo personale. Ruolo, area e stato di attivazione sono in sola lettura:
// un trigger sul database rifiuta ogni tentativo di modificarli da parte di chi
// non appartiene al reparto HR.
// ---------------------------------------------------------------------------

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import SaveIcon from "@mui/icons-material/Save";

import PageHeader from "@/components/PageHeader";
import { SectionCard } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { useAuth } from "@/lib/auth/AuthProvider";
import { getSupabase } from "@/lib/supabase/client";
import { ROLE_LABELS } from "@/lib/labels";
import { formatDay, initials } from "@/lib/format";

function ProfileContent() {
  const { profile, refreshProfile } = useAuth();
  const toast = useToast();
  // Arrivo dal link di recupero: la pagina si apre con l'avviso e la sezione
  // della password in evidenza.
  const resetting = useSearchParams().get("reimposta") !== null;

  // Stessa impostazione del resto dell'applicazione: i campi mostrano il dato
  // caricato finche' l'utente non li modifica, senza effetti di allineamento.
  const [edits, setEdits] = useState<Partial<{ fullName: string; phone: string }>>({});
  const [saving, setSaving] = useState(false);

  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const fullName = edits.fullName ?? profile?.full_name ?? "";
  const phone = edits.phone ?? profile?.phone ?? "";

  async function saveProfile() {
    if (!profile) return;
    setSaving(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: fullName.trim(),
          phone: phone.trim() || null,
        })
        .eq("id", profile.id);

      if (error) throw new Error(error.message);

      setEdits({});
      toast.success("Profilo aggiornato.");
      await refreshProfile();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function changePassword() {
    if (password.length < 8) {
      toast.notify("La password deve avere almeno 8 caratteri.", "warning");
      return;
    }
    if (password !== passwordConfirm) {
      toast.notify("Le due password non coincidono.", "warning");
      return;
    }

    setChangingPassword(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(error.message);

      setPassword("");
      setPasswordConfirm("");
      toast.success("Password aggiornata.");
    } catch (err) {
      toast.error(err);
    } finally {
      setChangingPassword(false);
    }
  }

  if (!profile) return null;

  return (
    <>
      <PageHeader title="Il mio profilo" />

      <Stack spacing={3} sx={{ maxWidth: 720 }}>
        <SectionCard>
          <Stack direction="row" spacing={2.5} sx={{ alignItems: "center" }}>
            <Avatar
              sx={{ width: 68, height: 68, fontSize: 24, bgcolor: "primary.main" }}
            >
              {initials(profile.full_name)}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h2">{profile.full_name}</Typography>
              <Typography color="text.secondary">{profile.email}</Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap", gap: 1 }}>
                <Chip size="small" label={ROLE_LABELS[profile.role]} color="primary" />
                <Chip
                  size="small"
                  variant="outlined"
                  label={profile.areas?.name ?? "Nessuna area"}
                />
                {profile.job_title && (
                  <Chip size="small" variant="outlined" label={profile.job_title} />
                )}
              </Stack>
            </Box>
          </Stack>

          <Divider sx={{ my: 2.5 }} />

          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={3}
            sx={{ flexWrap: "wrap" }}
          >
            <Box>
              <Typography variant="overline" color="text.secondary">
                In azienda dal
              </Typography>
              <Typography>
                {profile.hired_on ? formatDay(profile.hired_on) : "Non indicato"}
              </Typography>
            </Box>
            <Box>
              <Typography variant="overline" color="text.secondary">
                Profilo creato il
              </Typography>
              <Typography>
                {new Intl.DateTimeFormat("it-IT", { dateStyle: "long" })
                  .format(new Date(profile.created_at))}
              </Typography>
            </Box>
          </Stack>
        </SectionCard>

        {/* ----------------------------------------------------------------- */}
        <SectionCard
          title="Dati anagrafici"
          subtitle="Ruolo e area sono gestiti dal reparto HR e non sono modificabili da qui."
        >
          <Stack spacing={2}>
            <TextField
              label="Nome e cognome"
              fullWidth
              value={fullName}
              onChange={(event) => setEdits({ ...edits, fullName: event.target.value })}
            />
            <TextField
              label="Telefono"
              fullWidth
              value={phone}
              onChange={(event) => setEdits({ ...edits, phone: event.target.value })}
            />
            <TextField
              label="Email"
              fullWidth
              value={profile.email}
              disabled
              helperText="L'indirizzo coincide con quello di accesso e viene gestito dal reparto HR."
            />
            <Box>
              <Button
                variant="contained"
                startIcon={<SaveIcon />}
                onClick={saveProfile}
                disabled={saving || !fullName.trim()}
              >
                Salva modifiche
              </Button>
            </Box>
          </Stack>
        </SectionCard>

        {/* ----------------------------------------------------------------- */}
        <SectionCard
          title="Password"
          subtitle="Serve solo se accedi con email e password. Chi entra con l'account Microsoft continua a usare le credenziali aziendali."
        >
          <Stack spacing={2}>
            {resetting && (
              <Alert severity="info">
                Hai aperto il link di recupero: scegli qui la nuova password.
                Il collegamento vale una volta sola, quindi conviene farlo
                adesso.
              </Alert>
            )}
            <TextField
              label="Nuova password"
              type="password"
              fullWidth
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <TextField
              label="Conferma nuova password"
              type="password"
              fullWidth
              autoComplete="new-password"
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
            />
            {password.length > 0 && password.length < 8 && (
              <Alert severity="warning">
                La password deve avere almeno 8 caratteri.
              </Alert>
            )}
            <Box>
              <Button
                variant="outlined"
                onClick={changePassword}
                disabled={changingPassword || password.length < 8}
              >
                Aggiorna password
              </Button>
            </Box>
          </Stack>
        </SectionCard>
      </Stack>
    </>
  );
}

export default function ProfilePage() {
  // useSearchParams richiede un confine di Suspense in fase di build.
  return (
    <Suspense fallback={null}>
      <ProfileContent />
    </Suspense>
  );
}
