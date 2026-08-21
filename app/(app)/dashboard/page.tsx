"use client";

import NextLink from "next/link";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import AssignmentIcon from "@mui/icons-material/Assignment";
import BusinessIcon from "@mui/icons-material/Business";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import GroupsIcon from "@mui/icons-material/Groups";
import InboxIcon from "@mui/icons-material/Inbox";
import PeopleIcon from "@mui/icons-material/People";
import PollIcon from "@mui/icons-material/Poll";
import QuestionAnswerIcon from "@mui/icons-material/QuestionAnswer";
import SentimentSatisfiedAltIcon from "@mui/icons-material/SentimentSatisfiedAlt";
import TaskAltIcon from "@mui/icons-material/TaskAlt";

import PageHeader from "@/components/PageHeader";
import { AsyncBlock, AutoGrid, SectionCard, StatCard } from "@/components/ui";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAsync } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase/client";
import { ATTENDANCE_COLORS, ATTENDANCE_LABELS, ROLE_LABELS } from "@/lib/labels";
import type { AttendanceType, DashboardSummary } from "@/lib/types/models";

const ATTENDANCE_ORDER: AttendanceType[] = ["office", "smart_working", "absence"];

/** Riepilogo delle presenze odierne, mostrato a responsabili e HR. */
function TodayBreakdown({
  counts,
  emptyLabel,
}: {
  counts: Partial<Record<AttendanceType, number>>;
  emptyLabel: string;
}) {
  const total = ATTENDANCE_ORDER.reduce(
    (sum, type) => sum + (counts[type] ?? 0),
    0,
  );

  if (total === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyLabel}
      </Typography>
    );
  }

  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
      {ATTENDANCE_ORDER.map((type) => (
        <Chip
          key={type}
          label={`${ATTENDANCE_LABELS[type]}: ${counts[type] ?? 0}`}
          sx={{
            bgcolor: `${ATTENDANCE_COLORS[type]}1a`,
            color: ATTENDANCE_COLORS[type],
            fontWeight: 700,
          }}
        />
      ))}
    </Stack>
  );
}

export default function DashboardPage() {
  const { profile } = useAuth();

  const { data, loading, error } = useAsync<DashboardSummary>(async () => {
    const supabase = getSupabase();
    const { data: summary, error: rpcError } = await supabase.rpc(
      "my_dashboard_summary",
    );
    if (rpcError) throw new Error(rpcError.message);
    return (summary ?? { active: false }) as DashboardSummary;
  }, []);

  const firstName = profile?.full_name?.split(" ")[0] ?? "";
  const role = profile?.role ?? "employee";

  return (
    <>
      <PageHeader
        title={`Ciao ${firstName}`}
        description={
          <>
            Accedi come <strong>{ROLE_LABELS[role]}</strong>
            {profile?.areas?.name ? ` dell'area ${profile.areas.name}` : ""}.
          </>
        }
      />

      <AsyncBlock loading={loading} error={error}>
        <Stack spacing={3}>
          {/* ------------------------------------------------------------- */}
          <AutoGrid min={230}>
            <StatCard
              label="Giornate comunicate"
              value={data?.upcoming_entries ?? 0}
              hint="Nei prossimi 30 giorni"
              icon={<CalendarMonthIcon />}
            />
            <StatCard
              label="Richieste aperte"
              value={data?.my_open_requests ?? 0}
              hint="Inviate da te"
              icon={<QuestionAnswerIcon />}
              color="warning.main"
            />
            <StatCard
              label="Schede da compilare"
              value={data?.pending_evaluations ?? 0}
              hint="Assegnate a te"
              icon={<AssignmentIcon />}
              color="secondary.main"
            />
            <StatCard
              label="Valutazioni ricevute"
              value={data?.received_evaluations ?? 0}
              hint="Gia' consegnate dal responsabile"
              icon={<TaskAltIcon />}
              color="success.main"
            />
          </AutoGrid>

          {/* ------------------------------------------------------------- */}
          {role === "manager" && (
            <>
              <AutoGrid min={230}>
                <StatCard
                  label="Persone nell'area"
                  value={data?.team_size ?? 0}
                  icon={<GroupsIcon />}
                />
                <StatCard
                  label="Richieste ricevute"
                  value={data?.inbox_requests ?? 0}
                  hint="Ancora da chiudere"
                  icon={<InboxIcon />}
                  color="warning.main"
                />
              </AutoGrid>

              <SectionCard
                title="La tua area oggi"
                actions={
                  <Button component={NextLink} href="/area" size="small">
                    Apri il calendario dell&apos;area
                  </Button>
                }
              >
                <TodayBreakdown
                  counts={data?.team_today ?? {}}
                  emptyLabel="Nessuno ha ancora comunicato la giornata di oggi."
                />
              </SectionCard>
            </>
          )}

          {/* ------------------------------------------------------------- */}
          {role === "hr" && (
            <>
              <AutoGrid min={230}>
                <StatCard
                  label="Dipendenti attivi"
                  value={data?.employees ?? 0}
                  hint={data?.pending_activation
                    ? `${data.pending_activation} in attesa di attivazione`
                    : "Nessuno in attesa"}
                  icon={<PeopleIcon />}
                />
                <StatCard
                  label="Aree"
                  value={data?.areas ?? 0}
                  icon={<BusinessIcon />}
                />
                <StatCard
                  label="Richieste all'HR"
                  value={data?.inbox_requests ?? 0}
                  hint="Ancora da chiudere"
                  icon={<InboxIcon />}
                  color="warning.main"
                />
                <StatCard
                  label="Campagne aperte"
                  value={data?.open_campaigns ?? 0}
                  icon={<PollIcon />}
                  color="secondary.main"
                />
                <StatCard
                  label="Gradimento (30 gg)"
                  value={data?.satisfaction_responses_30d ?? 0}
                  hint="Compilazioni anonime ricevute"
                  icon={<SentimentSatisfiedAltIcon />}
                  color="success.main"
                />
              </AutoGrid>

              <SectionCard
                title="L'azienda oggi"
                actions={
                  <Button component={NextLink} href="/hr/calendario" size="small">
                    Calendario aziendale
                  </Button>
                }
              >
                <TodayBreakdown
                  counts={data?.company_today ?? {}}
                  emptyLabel="Nessuna comunicazione registrata per oggi."
                />
              </SectionCard>
            </>
          )}

          {/* ------------------------------------------------------------- */}
          <SectionCard title="Cosa puoi fare">
            <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", gap: 1.5 }}>
              <Button
                component={NextLink}
                href="/calendario"
                variant="contained"
                startIcon={<CalendarMonthIcon />}
              >
                Comunica le tue giornate
              </Button>
              <Button
                component={NextLink}
                href="/richieste"
                variant="outlined"
                startIcon={<QuestionAnswerIcon />}
              >
                Invia una richiesta
              </Button>
              {role !== "hr" && (
                <Button
                  component={NextLink}
                  href="/gradimento"
                  variant="outlined"
                  startIcon={<SentimentSatisfiedAltIcon />}
                >
                  Compila il gradimento
                </Button>
              )}
              {(data?.pending_evaluations ?? 0) > 0 && (
                <Button
                  component={NextLink}
                  href="/valutazioni"
                  variant="outlined"
                  color="secondary"
                  startIcon={<AssignmentIcon />}
                >
                  Compila le schede in sospeso
                </Button>
              )}
            </Stack>
          </SectionCard>
        </Stack>
      </AsyncBlock>
    </>
  );
}
