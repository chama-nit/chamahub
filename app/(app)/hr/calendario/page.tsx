"use client";

// ---------------------------------------------------------------------------
// Calendario aziendale (solo HR): tutte le aree, con filtri per area e persona.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import PageHeader from "@/components/PageHeader";
import MonthCalendar from "@/components/MonthCalendar";
import { AsyncBlock, AutoGrid, SectionCard, StatCard } from "@/components/ui";
import { useAsync } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase/client";
import {
  ATTENDANCE_COLORS,
  ATTENDANCE_LABELS,
  PERIOD_LABELS,
  attendanceLabel,
} from "@/lib/labels";
import { formatDay, monthEnd, monthStart } from "@/lib/format";
import type {
  Area,
  AttendanceType,
  CalendarEntry,
  Profile,
} from "@/lib/types/models";

interface Loaded {
  entries: CalendarEntry[];
  areas: Area[];
  people: Profile[];
}

const ATTENDANCE_ORDER: AttendanceType[] = ["office", "smart_working", "absence"];

export default function HrCalendarPage() {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [areaFilter, setAreaFilter] = useState("all");
  const [personFilter, setPersonFilter] = useState("all");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const from = monthStart(month);
  const to = monthEnd(month);

  const { data, loading, error } = useAsync<Loaded>(async () => {
    const supabase = getSupabase();

    const [entriesResult, areasResult, peopleResult] = await Promise.all([
      supabase
        .from("calendar_entries")
        .select("*, profiles:profile_id (id, full_name)")
        .gte("entry_date", from)
        .lte("entry_date", to)
        .order("entry_date"),
      supabase.from("areas").select("*").order("name"),
      supabase
        .from("profiles")
        .select("*")
        .eq("is_active", true)
        .order("full_name"),
    ]);

    if (entriesResult.error) throw new Error(entriesResult.error.message);
    if (areasResult.error) throw new Error(areasResult.error.message);
    if (peopleResult.error) throw new Error(peopleResult.error.message);

    return {
      entries: (entriesResult.data ?? []) as CalendarEntry[],
      areas: (areasResult.data ?? []) as Area[],
      people: (peopleResult.data ?? []) as Profile[],
    };
  }, [from, to]);

  const peopleInArea = useMemo(
    () =>
      (data?.people ?? []).filter(
        (person) => areaFilter === "all" || person.area_id === areaFilter,
      ),
    [data, areaFilter],
  );

  const visible = useMemo(
    () =>
      (data?.entries ?? []).filter((entry) => {
        if (areaFilter !== "all" && entry.area_id !== areaFilter) return false;
        if (personFilter !== "all" && entry.profile_id !== personFilter) return false;
        return true;
      }),
    [data, areaFilter, personFilter],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of visible) {
      const list = map.get(entry.entry_date) ?? [];
      list.push(entry);
      map.set(entry.entry_date, list);
    }
    return map;
  }, [visible]);

  const totals = useMemo(() => {
    const counts: Record<AttendanceType, number> = {
      office: 0,
      smart_working: 0,
      absence: 0,
    };
    for (const entry of visible) {
      counts[entry.type] += entry.period === "full_day" ? 1 : 0.5;
    }
    return counts;
  }, [visible]);

  const dayDetail = selectedDay ? byDay.get(selectedDay) ?? [] : [];

  return (
    <>
      <PageHeader
        title="Calendario aziendale"
        description="Tutte le comunicazioni di presenza, smart working e assenza, filtrabili per area e per singolo dipendente."
      />

      <Stack spacing={3}>
        <AutoGrid min={220}>
          {ATTENDANCE_ORDER.map((type) => (
            <StatCard
              key={type}
              label={ATTENDANCE_LABELS[type]}
              value={totals[type].toString().replace(".", ",")}
              hint="Giornate nel mese selezionato"
              color={ATTENDANCE_COLORS[type]}
            />
          ))}
          <StatCard
            label="Persone coinvolte"
            value={new Set(visible.map((entry) => entry.profile_id)).size}
            hint={`su ${peopleInArea.length} attive`}
          />
        </AutoGrid>

        {/* Calendario a sinistra, dettaglio del giorno a destra. Sotto i 1200px
            la colonna del dettaglio passa sotto, dove c'e' spazio. */}
        <Box
          sx={{
            display: "grid",
            gap: 3,
            alignItems: "start",
            gridTemplateColumns: {
              xs: "minmax(0, 1fr)",
              lg: selectedDay ? "minmax(0, 1fr) 380px" : "minmax(0, 1fr)",
            },
          }}
        >
        <Card>
          <CardContent>
            <AsyncBlock loading={loading} error={error}>
              <MonthCalendar
                month={month}
                onMonthChange={(next) => {
                  setMonth(next);
                  setSelectedDay(null);
                }}
                onDayClick={setSelectedDay}
                cellMinHeight={118}
                toolbarExtra={
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1.5}
                    useFlexGap
                    sx={{ flexWrap: "wrap" }}
                  >
                    <FormControl sx={{ minWidth: 170, flex: "1 1 170px" }}>
                      <InputLabel id="hr-area-filter">Area</InputLabel>
                      <Select
                        labelId="hr-area-filter"
                        label="Area"
                        value={areaFilter}
                        onChange={(event) => {
                          setAreaFilter(event.target.value);
                          setPersonFilter("all");
                        }}
                      >
                        <MenuItem value="all">Tutte le aree</MenuItem>
                        {data?.areas.map((area) => (
                          <MenuItem key={area.id} value={area.id}>
                            {area.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>

                    <FormControl sx={{ minWidth: 190, flex: "1 1 190px" }}>
                      <InputLabel id="hr-person-filter">Dipendente</InputLabel>
                      <Select
                        labelId="hr-person-filter"
                        label="Dipendente"
                        value={personFilter}
                        onChange={(event) => setPersonFilter(event.target.value)}
                      >
                        <MenuItem value="all">Tutti</MenuItem>
                        {peopleInArea.map((person) => (
                          <MenuItem key={person.id} value={person.id}>
                            {person.full_name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Stack>
                }
                renderDay={(day) => {
                  const entries = byDay.get(day) ?? [];
                  if (entries.length === 0) return null;

                  const counts: Record<AttendanceType, number> = {
                    office: 0,
                    smart_working: 0,
                    absence: 0,
                  };
                  for (const entry of entries) counts[entry.type] += 1;

                  return (
                    <Stack spacing={0.35}>
                      {ATTENDANCE_ORDER.filter((type) => counts[type] > 0).map(
                        (type) => (
                          <Tooltip
                            key={type}
                            title={`${counts[type]} ${ATTENDANCE_LABELS[type].toLowerCase()}`}
                          >
                            <Stack
                              direction="row"
                              spacing={0.5}
                              sx={{
                                alignItems: "center",
                                px: 0.5,
                                py: 0.15,
                                borderRadius: 1,
                                bgcolor: `${ATTENDANCE_COLORS[type]}1f`,
                              }}
                            >
                              <Box
                                sx={{
                                  width: 7,
                                  height: 7,
                                  borderRadius: "50%",
                                  bgcolor: ATTENDANCE_COLORS[type],
                                }}
                              />
                              <Typography
                                variant="caption"
                                sx={{
                                  fontSize: "0.7rem",
                                  fontWeight: 700,
                                  color: ATTENDANCE_COLORS[type],
                                }}
                              >
                                {counts[type]}
                              </Typography>
                            </Stack>
                          </Tooltip>
                        ),
                      )}
                    </Stack>
                  );
                }}
              />
            </AsyncBlock>
          </CardContent>
        </Card>

        {selectedDay && (
          <Box sx={{ position: { lg: "sticky" }, top: { lg: 88 } }}>
          <SectionCard
            title={formatDay(selectedDay, "EEEE d MMMM yyyy")}
            subtitle={`${dayDetail.length} comunicazioni`}
            actions={
              <Button size="small" onClick={() => setSelectedDay(null)}>
                Chiudi
              </Button>
            }
            dense
          >
            {dayDetail.length === 0
              ? (
                <Typography color="text.secondary" sx={{ p: 2.5 }}>
                  Nessuna comunicazione per questo giorno.
                </Typography>
              )
              : (
                // In una colonna stretta un elenco si legge meglio di una
                // tabella a quattro colonne.
                <Stack sx={{ maxHeight: { lg: "62vh" }, overflowY: "auto" }}>
                  {dayDetail.map((entry) => (
                    <Box
                      key={entry.id}
                      sx={{
                        px: 2.5,
                        py: 1.5,
                        borderBottom: "1px solid",
                        borderColor: "divider",
                        borderLeft: "3px solid",
                        borderLeftColor: ATTENDANCE_COLORS[entry.type],
                      }}
                    >
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: "center", justifyContent: "space-between" }}
                      >
                        <Typography sx={{ fontWeight: 600, minWidth: 0 }} noWrap>
                          {entry.profiles?.full_name ?? "—"}
                        </Typography>
                        <Chip
                          size="small"
                          label={attendanceLabel(entry.type, entry.absence_kind)}
                          sx={{
                            bgcolor: `${ATTENDANCE_COLORS[entry.type]}1a`,
                            color: ATTENDANCE_COLORS[entry.type],
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        />
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {PERIOD_LABELS[entry.period]}
                        {entry.note ? ` · ${entry.note}` : ""}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              )}
          </SectionCard>
          </Box>
        )}
        </Box>
      </Stack>
    </>
  );
}
