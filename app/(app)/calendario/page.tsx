"use client";

// ---------------------------------------------------------------------------
// Calendario personale del dipendente
// ---------------------------------------------------------------------------
// Comunicazione (non richiesta di approvazione) di presenza in ufficio, smart
// working o assenza. E' possibile agire su un singolo giorno oppure su un
// intervallo, opzione utile per ferie e trasferte.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import DateRangeIcon from "@mui/icons-material/DateRange";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";

import PageHeader from "@/components/PageHeader";
import MonthCalendar from "@/components/MonthCalendar";
import { AsyncBlock, SectionCard } from "@/components/ui";
import { useToast } from "@/components/ToastProvider";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAsync } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase/client";
import {
  ABSENCE_LABELS,
  ATTENDANCE_COLORS,
  ATTENDANCE_LABELS,
  PERIOD_LABELS,
  PERIOD_SHORT,
  attendanceLabel,
} from "@/lib/labels";
import { formatDay, monthEnd, monthStart, parseDay, toDayString } from "@/lib/format";
import type {
  AbsenceKind,
  AttendanceType,
  CalendarEntry,
  DayPeriod,
} from "@/lib/types/models";

interface DayFormState {
  day: string;
  entryId: string | null;
  type: AttendanceType;
  absenceKind: AbsenceKind;
  period: DayPeriod;
  note: string;
}

export default function MyCalendarPage() {
  const { profile } = useAuth();
  const toast = useToast();

  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const [dayForm, setDayForm] = useState<DayFormState | null>(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const from = monthStart(month);
  const to = monthEnd(month);

  const { data, loading, error, reload } = useAsync<CalendarEntry[]>(async () => {
    const supabase = getSupabase();
    const { data: entries, error: queryError } = await supabase
      .from("calendar_entries")
      .select("*")
      .eq("profile_id", profile!.id)
      .gte("entry_date", from)
      .lte("entry_date", to)
      .order("entry_date");

    if (queryError) throw new Error(queryError.message);
    return (entries ?? []) as CalendarEntry[];
  }, [profile?.id, from, to]);

  // Indice giorno -> comunicazioni, per non scorrere l'array in ogni casella.
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of data ?? []) {
      const list = map.get(entry.entry_date) ?? [];
      list.push(entry);
      map.set(entry.entry_date, list);
    }
    return map;
  }, [data]);

  const monthStats = useMemo(() => {
    const counts: Record<AttendanceType, number> = {
      office: 0,
      smart_working: 0,
      absence: 0,
    };
    for (const entry of data ?? []) {
      // Le mezze giornate contano mezzo giorno.
      counts[entry.type] += entry.period === "full_day" ? 1 : 0.5;
    }
    return counts;
  }, [data]);

  function openDay(day: string) {
    const existing = byDay.get(day) ?? [];
    const full = existing.find((entry) => entry.period === "full_day");
    const source = full ?? existing[0];

    setDayForm({
      day,
      entryId: source?.id ?? null,
      type: source?.type ?? "office",
      absenceKind: source?.absence_kind ?? "vacation",
      period: source?.period ?? "full_day",
      note: source?.note ?? "",
    });
  }

  async function saveDay() {
    if (!dayForm || !profile) return;
    setSaving(true);
    try {
      const supabase = getSupabase();
      const payload = {
        profile_id: profile.id,
        entry_date: dayForm.day,
        period: dayForm.period,
        type: dayForm.type,
        absence_kind: dayForm.type === "absence" ? dayForm.absenceKind : null,
        note: dayForm.note.trim() || null,
      };

      // `onConflict` sulla chiave (dipendente, giorno, periodo): riscrivere lo
      // stesso slot aggiorna la comunicazione invece di duplicarla.
      const { error: upsertError } = await supabase
        .from("calendar_entries")
        .upsert(payload, { onConflict: "profile_id,entry_date,period" });

      if (upsertError) throw new Error(upsertError.message);

      toast.success("Giornata aggiornata.");
      setDayForm(null);
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function deleteDay() {
    if (!dayForm || !profile) return;
    setSaving(true);
    try {
      const supabase = getSupabase();
      const { error: deleteError } = await supabase
        .from("calendar_entries")
        .delete()
        .eq("profile_id", profile.id)
        .eq("entry_date", dayForm.day);

      if (deleteError) throw new Error(deleteError.message);

      toast.success("Comunicazione rimossa.");
      setDayForm(null);
      reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Il mio calendario"
        description="Comunica in anticipo se sarai in ufficio, in smart working o assente. Non serve alcuna approvazione: responsabile e HR vedono le tue comunicazioni in sola lettura."
        actions={
          <Button
            variant="contained"
            startIcon={<DateRangeIcon />}
            onClick={() => setRangeOpen(true)}
          >
            Inserimento su intervallo
          </Button>
        }
      />

      <Stack spacing={3}>
        <SectionCard>
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", gap: 1.5 }}>
            {(Object.keys(ATTENDANCE_LABELS) as AttendanceType[]).map((type) => (
              <Chip
                key={type}
                label={`${ATTENDANCE_LABELS[type]}: ${
                  monthStats[type].toString().replace(".", ",")
                } gg`}
                sx={{
                  bgcolor: `${ATTENDANCE_COLORS[type]}1a`,
                  color: ATTENDANCE_COLORS[type],
                  fontWeight: 700,
                }}
              />
            ))}
          </Stack>
        </SectionCard>

        <SectionCard>
          <AsyncBlock loading={loading} error={error}>
            <MonthCalendar
              month={month}
              onMonthChange={setMonth}
              onDayClick={openDay}
              renderDay={(day) => {
                const entries = byDay.get(day) ?? [];
                if (entries.length === 0) return null;

                return (
                  <Stack spacing={0.4}>
                    {entries.map((entry) => (
                      <Box
                        key={entry.id}
                        sx={{
                          px: 0.75,
                          py: 0.25,
                          borderRadius: 1,
                          bgcolor: `${ATTENDANCE_COLORS[entry.type]}1f`,
                          borderLeft: `3px solid ${ATTENDANCE_COLORS[entry.type]}`,
                        }}
                      >
                        <Typography
                          variant="caption"
                          sx={{
                            color: ATTENDANCE_COLORS[entry.type],
                            fontWeight: 700,
                            display: "block",
                            lineHeight: 1.3,
                          }}
                        >
                          {PERIOD_SHORT[entry.period]
                            ? `${PERIOD_SHORT[entry.period]} · `
                            : ""}
                          {attendanceLabel(entry.type, entry.absence_kind)}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                );
              }}
            />
          </AsyncBlock>
        </SectionCard>
      </Stack>

      {/* ------------------------------------------------------------------ */}
      <Dialog
        open={dayForm !== null}
        onClose={() => setDayForm(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle sx={{ textTransform: "capitalize" }}>
          {dayForm ? formatDay(dayForm.day, "EEEE d MMMM yyyy") : ""}
        </DialogTitle>
        <DialogContent dividers>
          {dayForm && (
            <Stack spacing={2} sx={{ pt: 0.5 }}>
              <FormControl fullWidth>
                <InputLabel id="type-label">Tipo di giornata</InputLabel>
                <Select
                  labelId="type-label"
                  label="Tipo di giornata"
                  value={dayForm.type}
                  onChange={(event) =>
                    setDayForm({
                      ...dayForm,
                      type: event.target.value as AttendanceType,
                    })}
                >
                  {(Object.keys(ATTENDANCE_LABELS) as AttendanceType[]).map((type) => (
                    <MenuItem key={type} value={type}>
                      {ATTENDANCE_LABELS[type]}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              {dayForm.type === "absence" && (
                <FormControl fullWidth>
                  <InputLabel id="absence-label">Motivo dell&apos;assenza</InputLabel>
                  <Select
                    labelId="absence-label"
                    label="Motivo dell'assenza"
                    value={dayForm.absenceKind}
                    onChange={(event) =>
                      setDayForm({
                        ...dayForm,
                        absenceKind: event.target.value as AbsenceKind,
                      })}
                  >
                    {(Object.keys(ABSENCE_LABELS) as AbsenceKind[]).map((kind) => (
                      <MenuItem key={kind} value={kind}>
                        {ABSENCE_LABELS[kind]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              <FormControl fullWidth>
                <InputLabel id="period-label">Durata</InputLabel>
                <Select
                  labelId="period-label"
                  label="Durata"
                  value={dayForm.period}
                  onChange={(event) =>
                    setDayForm({
                      ...dayForm,
                      period: event.target.value as DayPeriod,
                    })}
                >
                  {(Object.keys(PERIOD_LABELS) as DayPeriod[]).map((period) => (
                    <MenuItem key={period} value={period}>
                      {PERIOD_LABELS[period]}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                label="Nota (facoltativa)"
                multiline
                minRows={2}
                fullWidth
                value={dayForm.note}
                onChange={(event) =>
                  setDayForm({ ...dayForm, note: event.target.value })}
                slotProps={{ htmlInput: { maxLength: 500 } }}
              />

              <Alert severity="info" sx={{ py: 0.5 }}>
                Inserendo una giornata intera le eventuali mezze giornate dello
                stesso giorno vengono sostituite.
              </Alert>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          {dayForm && (byDay.get(dayForm.day)?.length ?? 0) > 0 && (
            <Button
              color="error"
              startIcon={<DeleteOutlineIcon />}
              onClick={deleteDay}
              disabled={saving}
              sx={{ mr: "auto" }}
            >
              Rimuovi
            </Button>
          )}
          <Button onClick={() => setDayForm(null)} disabled={saving}>
            Annulla
          </Button>
          <Button variant="contained" onClick={saveDay} disabled={saving}>
            Salva
          </Button>
        </DialogActions>
      </Dialog>

      <RangeDialog
        open={rangeOpen}
        onClose={() => setRangeOpen(false)}
        onSaved={reload}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Inserimento su intervallo di date
// ---------------------------------------------------------------------------
function RangeDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const toast = useToast();

  const [start, setStart] = useState(() => toDayString(new Date()));
  const [end, setEnd] = useState(() => toDayString(new Date()));
  const [type, setType] = useState<AttendanceType>("smart_working");
  const [absenceKind, setAbsenceKind] = useState<AbsenceKind>("vacation");
  const [skipWeekend, setSkipWeekend] = useState(true);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const days = useMemo(() => {
    if (!start || !end || end < start) return [];
    const result: string[] = [];
    const cursor = parseDay(start);
    const last = parseDay(end);

    while (cursor <= last) {
      const weekday = cursor.getDay();
      if (!skipWeekend || (weekday !== 0 && weekday !== 6)) {
        result.push(toDayString(cursor));
      }
      cursor.setDate(cursor.getDate() + 1);
      // Limite di sicurezza: un anno per volta.
      if (result.length > 400) break;
    }
    return result;
  }, [start, end, skipWeekend]);

  async function save() {
    if (!profile || days.length === 0) return;
    setSaving(true);
    try {
      const supabase = getSupabase();
      const rows = days.map((day) => ({
        profile_id: profile.id,
        entry_date: day,
        period: "full_day" as DayPeriod,
        type,
        absence_kind: type === "absence" ? absenceKind : null,
        note: note.trim() || null,
      }));

      const { error: upsertError } = await supabase
        .from("calendar_entries")
        .upsert(rows, { onConflict: "profile_id,entry_date,period" });

      if (upsertError) throw new Error(upsertError.message);

      toast.success(
        `${days.length} ${days.length === 1 ? "giornata comunicata" : "giornate comunicate"}.`,
      );
      onClose();
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Inserimento su intervallo</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <Stack direction="row" spacing={2}>
            <TextField
              label="Dal"
              type="date"
              fullWidth
              value={start}
              onChange={(event) => setStart(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Al"
              type="date"
              fullWidth
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>

          <FormControl fullWidth>
            <InputLabel id="range-type-label">Tipo di giornata</InputLabel>
            <Select
              labelId="range-type-label"
              label="Tipo di giornata"
              value={type}
              onChange={(event) => setType(event.target.value as AttendanceType)}
            >
              {(Object.keys(ATTENDANCE_LABELS) as AttendanceType[]).map((option) => (
                <MenuItem key={option} value={option}>
                  {ATTENDANCE_LABELS[option]}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {type === "absence" && (
            <FormControl fullWidth>
              <InputLabel id="range-absence-label">Motivo</InputLabel>
              <Select
                labelId="range-absence-label"
                label="Motivo"
                value={absenceKind}
                onChange={(event) =>
                  setAbsenceKind(event.target.value as AbsenceKind)}
              >
                {(Object.keys(ABSENCE_LABELS) as AbsenceKind[]).map((kind) => (
                  <MenuItem key={kind} value={kind}>
                    {ABSENCE_LABELS[kind]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <FormControlLabel
            control={
              <Checkbox
                checked={skipWeekend}
                onChange={(event) => setSkipWeekend(event.target.checked)}
              />
            }
            label="Escludi sabato e domenica"
          />

          <TextField
            label="Nota (facoltativa)"
            fullWidth
            value={note}
            onChange={(event) => setNote(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />

          <Typography variant="body2" color="text.secondary">
            {days.length === 0
              ? "Nessuna giornata selezionata: controlla l'intervallo."
              : `Verranno comunicate ${days.length} giornate intere.`}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          Annulla
        </Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={saving || days.length === 0}
        >
          Conferma
        </Button>
      </DialogActions>
    </Dialog>
  );
}
