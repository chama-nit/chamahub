"use client";

// ---------------------------------------------------------------------------
// Vista del responsabile sulle aree che guida
// ---------------------------------------------------------------------------
// Elenco delle persone e calendario aggregato delle presenze. Sola lettura: le
// comunicazioni restano di chi le inserisce (anche a livello di policy RLS).
//
// Da qui in avanti le aree possono essere piu' di una. Il selettore compare
// solo quando servono - chi ne guida una sola non deve scegliere fra un'unica
// opzione - e offre anche "tutte le aree", che e' la vista utile a chi vuole
// sapere chi c'e' oggi senza distinguere il reparto.
//
// Nota: si guardano le aree GUIDATE (`managedAreas`), non quella di
// appartenenza. Sono due cose diverse: un responsabile puo' lavorare in
// Sviluppo e guidare anche Amministrazione.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@mui/material/Avatar";
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
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import GroupsIcon from "@mui/icons-material/Groups";

import PageHeader from "@/components/PageHeader";
import MonthCalendar from "@/components/MonthCalendar";
import { AsyncBlock, EmptyState, SectionCard } from "@/components/ui";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAsync } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase/client";
import {
  ATTENDANCE_COLORS,
  ATTENDANCE_SOFT_COLORS,
  ATTENDANCE_LABELS,
  PERIOD_LABELS,
  ROLE_LABELS,
  attendanceLabel,
} from "@/lib/labels";
import {
  formatDay,
  initials,
  monthEnd,
  monthStart,
  todayString,
} from "@/lib/format";
import type { AttendanceType, CalendarEntry, Profile } from "@/lib/types/models";

interface AreaData {
  people: Profile[];
  entries: CalendarEntry[];
}

export default function MyAreaPage() {
  const router = useRouter();
  const { managedAreas } = useAuth();

  // "all" = tutte le aree guidate insieme.
  const [areaFilter, setAreaFilter] = useState<string>("all");
  const [tab, setTab] = useState<"calendar" | "people">("calendar");
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [personFilter, setPersonFilter] = useState<string>("all");

  const from = monthStart(month);
  const to = monthEnd(month);
  const today = todayString();

  // Le aree su cui interrogare il database: quella scelta, o tutte.
  const areaIds = useMemo(
    () =>
      areaFilter === "all"
        ? managedAreas.map((a) => a.id)
        : [areaFilter],
    [areaFilter, managedAreas],
  );
  const areaKey = areaIds.join(",");

  const { data, loading, error } = useAsync<AreaData>(async () => {
    const supabase = getSupabase();

    if (areaIds.length === 0) return { people: [], entries: [] };

    const { data: people, error: peopleError } = await supabase
      .from("profiles")
      .select("*, areas:area_id (id, name, color)")
      .in("area_id", areaIds)
      .eq("is_active", true)
      .order("full_name");

    if (peopleError) throw new Error(peopleError.message);

    const { data: entries, error: entriesError } = await supabase
      .from("calendar_entries")
      .select("*, profiles:profile_id (id, full_name)")
      .in("area_id", areaIds)
      .gte("entry_date", from)
      .lte("entry_date", to)
      .order("entry_date");

    if (entriesError) throw new Error(entriesError.message);

    return {
      people: (people ?? []) as Profile[],
      entries: (entries ?? []) as CalendarEntry[],
    };
  }, [areaKey, from, to]);

  const visibleEntries = useMemo(
    () =>
      (data?.entries ?? []).filter(
        (entry) => personFilter === "all" || entry.profile_id === personFilter,
      ),
    [data, personFilter],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of visibleEntries) {
      const list = map.get(entry.entry_date) ?? [];
      list.push(entry);
      map.set(entry.entry_date, list);
    }
    return map;
  }, [visibleEntries]);

  const todayByPerson = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of data?.entries ?? []) {
      if (entry.entry_date !== today) continue;
      const list = map.get(entry.profile_id) ?? [];
      list.push(entry);
      map.set(entry.profile_id, list);
    }
    return map;
  }, [data, today]);

  if (managedAreas.length === 0) {
    return (
      <>
        <PageHeader title="Le mie aree" />
        <Card>
          <CardContent>
            <EmptyState
              icon={<GroupsIcon sx={{ fontSize: 48 }} />}
              title="Nessuna area da guidare"
              description="Il reparto HR non ti ha ancora affidato nessuna area. Finche' non lo fa, questa pagina resta vuota: non c'e' nessun team da mostrare."
            />
          </CardContent>
        </Card>
      </>
    );
  }

  const titolo = managedAreas.length === 1
    ? `Area ${managedAreas[0].name}`
    : areaFilter === "all"
    ? `Le mie aree (${managedAreas.length})`
    : `Area ${managedAreas.find((a) => a.id === areaFilter)?.name ?? ""}`;

  return (
    <>
      <PageHeader
        title={titolo}
        description="Chi c'e' e chi manca, giorno per giorno. Le comunicazioni sono inserite dai diretti interessati e qui sono in sola lettura."
        actions={managedAreas.length > 1
          ? (
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel id="filtro-area">Area</InputLabel>
              <Select
                labelId="filtro-area"
                label="Area"
                value={areaFilter}
                onChange={(e) => {
                  setAreaFilter(e.target.value);
                  setPersonFilter("all");
                }}
              >
                <MenuItem value="all">Tutte le mie aree</MenuItem>
                {managedAreas.map((area) => (
                  <MenuItem key={area.id} value={area.id}>
                    {area.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )
          : undefined}
      />

      <Card>
        <Tabs
          value={tab}
          onChange={(_event, value) => setTab(value as "calendar" | "people")}
          sx={{ px: 2, borderBottom: "1px solid", borderColor: "divider" }}
        >
          <Tab value="calendar" label="Calendario dell'area" />
          <Tab
            value="people"
            label={`Persone (${data?.people.length ?? 0})`}
          />
        </Tabs>

        <AsyncBlock loading={loading} error={error}>
          {tab === "calendar"
            ? (
              <CardContent>
                <MonthCalendar
                  month={month}
                  onMonthChange={setMonth}
                  cellMinHeight={118}
                  toolbarExtra={
                    <FormControl sx={{ minWidth: 240 }}>
                      <InputLabel id="person-filter">Persona</InputLabel>
                      <Select
                        labelId="person-filter"
                        label="Persona"
                        value={personFilter}
                        onChange={(event) => setPersonFilter(event.target.value)}
                      >
                        <MenuItem value="all">
                          {managedAreas.length > 1 ? "Tutte le persone" : "Tutta l'area"}
                        </MenuItem>
                        {data?.people.map((person) => (
                          <MenuItem key={person.id} value={person.id}>
                            {person.full_name}
                            {managedAreas.length > 1 && person.areas && (
                              <Typography
                                component="span"
                                variant="caption"
                                sx={{ ml: 1, color: "text.secondary" }}
                              >
                                {person.areas.name}
                              </Typography>
                            )}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  }
                  renderDay={(day) => {
                    const entries = byDay.get(day) ?? [];
                    if (entries.length === 0) return null;

                    return (
                      <Stack spacing={0.35}>
                        {entries.slice(0, 4).map((entry) => (
                          <Tooltip
                            key={entry.id}
                            title={`${entry.profiles?.full_name ?? ""} · ${
                              attendanceLabel(entry.type, entry.absence_kind)
                            }${
                              entry.period === "full_day"
                                ? ""
                                : ` (${PERIOD_LABELS[entry.period].toLowerCase()})`
                            }`}
                          >
                            <Stack
                              direction="row"
                              spacing={0.5}
                              sx={{
                                alignItems: "center",
                                px: 0.5,
                                py: 0.1,
                                borderRadius: 1,
                                bgcolor: ATTENDANCE_SOFT_COLORS[entry.type],
                              }}
                            >
                              <Box
                                sx={{
                                  width: 7,
                                  height: 7,
                                  borderRadius: "50%",
                                  bgcolor: ATTENDANCE_COLORS[entry.type],
                                  flexShrink: 0,
                                }}
                              />
                              <Typography
                                variant="caption"
                                noWrap
                                sx={{ fontSize: "0.68rem", lineHeight: 1.5 }}
                              >
                                {entry.profiles?.full_name?.split(" ")[0] ?? "—"}
                              </Typography>
                            </Stack>
                          </Tooltip>
                        ))}
                        {entries.length > 4 && (
                          <Typography variant="caption" color="text.secondary">
                            +{entries.length - 4} altri
                          </Typography>
                        )}
                      </Stack>
                    );
                  }}
                />

                <Stack
                  direction="row"
                  spacing={2}
                  sx={{ mt: 2, flexWrap: "wrap", gap: 1 }}
                >
                  {(Object.keys(ATTENDANCE_LABELS) as AttendanceType[]).map((type) => (
                    <Stack
                      key={type}
                      direction="row"
                      spacing={0.75}
                      sx={{ alignItems: "center" }}
                    >
                      <Box
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          bgcolor: ATTENDANCE_COLORS[type],
                        }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {ATTENDANCE_LABELS[type]}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              </CardContent>
            )
            : (
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Persona</TableCell>
                      {/* Compare solo quando serve davvero a distinguere:
                          con una sola area guidata la colonna ripeterebbe lo
                          stesso valore su ogni riga. */}
                      {managedAreas.length > 1 && <TableCell>Area</TableCell>}
                      <TableCell>Ruolo</TableCell>
                      <TableCell>Mansione</TableCell>
                      <TableCell>Oggi</TableCell>
                      <TableCell>In azienda dal</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(data?.people ?? []).map((person) => {
                      const entries = todayByPerson.get(person.id) ?? [];
                      return (
                        <TableRow key={person.id} hover>
                          <TableCell>
                            <Stack
                              direction="row"
                              spacing={1.5}
                              sx={{ alignItems: "center" }}
                            >
                              <Avatar sx={{ width: 34, height: 34, fontSize: 13 }}>
                                {initials(person.full_name)}
                              </Avatar>
                              <Box>
                                <Typography sx={{ fontWeight: 600 }}>
                                  {person.full_name}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {person.email}
                                </Typography>
                              </Box>
                            </Stack>
                          </TableCell>
                          {managedAreas.length > 1 && (
                            <TableCell>
                              {person.areas
                                ? (
                                  <Chip
                                    size="small"
                                    label={person.areas.name}
                                    sx={{
                                      bgcolor: `${person.areas.color}22`,
                                      color: person.areas.color,
                                      fontWeight: 600,
                                    }}
                                  />
                                )
                                : "—"}
                            </TableCell>
                          )}
                          <TableCell>{ROLE_LABELS[person.role]}</TableCell>
                          <TableCell>{person.job_title ?? "—"}</TableCell>
                          <TableCell>
                            {entries.length === 0
                              ? (
                                <Typography variant="body2" color="text.disabled">
                                  Non comunicato
                                </Typography>
                              )
                              : (
                                <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
                                  {entries.map((entry) => (
                                    <Chip
                                      key={entry.id}
                                      size="small"
                                      label={attendanceLabel(entry.type, entry.absence_kind)}
                                      sx={{
                                        bgcolor: ATTENDANCE_SOFT_COLORS[entry.type],
                                        color: ATTENDANCE_COLORS[entry.type],
                                        fontWeight: 700,
                                      }}
                                    />
                                  ))}
                                </Stack>
                              )}
                          </TableCell>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>
                            {person.hired_on ? formatDay(person.hired_on) : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
        </AsyncBlock>
      </Card>

      <Box sx={{ mt: 3 }}>
        <SectionCard
          title="Richieste della tua area"
          subtitle="Le richieste indirizzate al responsabile sono raccolte nella sezione dedicata."
        >
          <Button variant="outlined" onClick={() => router.push("/richieste")}>
            Apri le richieste ricevute
          </Button>
        </SectionCard>
      </Box>
    </>
  );
}
