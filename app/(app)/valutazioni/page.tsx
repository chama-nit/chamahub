"use client";

// ---------------------------------------------------------------------------
// Schede di valutazione
// ---------------------------------------------------------------------------
// Le due nature di scheda restano sempre separate in tabelle distinte, perche'
// rispondono a domande diverse: "come mi giudico" e "come mi giudica il
// responsabile" non vanno mescolate in un elenco unico.
//
//   Da compilare -> le mie autovalutazioni | le valutazioni dei collaboratori
//   Ricevute     -> valutazioni del responsabile | autovalutazioni consegnate
//
// La visibilita' e' comunque decisa dalle policy RLS: una valutazione altrui
// diventa leggibile solo dopo la consegna, qualunque cosa mostri l'interfaccia.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
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
import AssignmentIcon from "@mui/icons-material/Assignment";
import EditNoteIcon from "@mui/icons-material/EditNote";
import PersonIcon from "@mui/icons-material/Person";

import EventBusyIcon from "@mui/icons-material/EventBusy";

import PageHeader from "@/components/PageHeader";
import { AsyncBlock, EmptyState, SectionCard } from "@/components/ui";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useAsync } from "@/lib/hooks";
import { getSupabase } from "@/lib/supabase/client";
import {
  EVALUATION_STATUS_COLORS,
  EVALUATION_STATUS_LABELS,
} from "@/lib/labels";
import { formatDay, formatScore } from "@/lib/format";
import type { Evaluation } from "@/lib/types/models";

const SELECT = `
  *,
  subject:profiles!evaluations_subject_id_fkey (id, full_name, job_title),
  evaluator:profiles!evaluations_evaluator_id_fkey (id, full_name),
  corrector:profiles!evaluations_corrected_by_fkey (id, full_name),
  evaluation_campaigns:campaign_id (id, name, ends_on, status)
`;

interface Loaded {
  mine: Evaluation[];
  received: Evaluation[];
  areaSelf: Evaluation[];
}

export default function EvaluationsPage() {
  const { profile, managedAreas } = useAuth();
  const [tab, setTab] = useState<"todo" | "received" | "area">("todo");

  // Chi guida almeno un'area puo' rivedere le autovalutazioni dei suoi
  // collaboratori. La stessa condizione e' scritta nelle policy RLS: qui serve
  // solo a non interrogare una tabella che restituirebbe zero righe.
  //
  // Si guardano le aree GUIDATE, non quella di appartenenza: sono due cose
  // diverse dalla migrazione 18.
  const canReviewArea = managedAreas.length > 0;

  const { data, loading, error } = useAsync<Loaded>(async () => {
    const supabase = getSupabase();

    const [mine, received, areaSelf] = await Promise.all([
      supabase
        .from("evaluations")
        .select(SELECT)
        .eq("evaluator_id", profile!.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
      supabase
        .from("evaluations")
        .select(SELECT)
        .eq("subject_id", profile!.id)
        .eq("status", "submitted")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
      canReviewArea
        ? supabase
          .from("evaluations")
          .select(SELECT)
          .eq("kind", "self_assessment")
          // `in` sulle aree guidate, non `eq` sull'area di appartenenza.
          //
          // Era `profile.area_id`, e per un responsabile che non appartiene a
          // nessuna area quel valore e' null: PostgREST lo serializza come la
          // stringa "null" e il database rispondeva
          // `invalid input syntax for type uuid: "null"`. La condizione per
          // mostrare la scheda guardava gia' le aree guidate, la query no.
          .in("area_id", managedAreas.map((a) => a.id))
          .neq("subject_id", profile!.id)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (mine.error) throw new Error(mine.error.message);
    if (received.error) throw new Error(received.error.message);
    if (areaSelf.error) throw new Error(areaSelf.error.message);

    return {
      mine: (mine.data ?? []) as Evaluation[],
      received: (received.data ?? []) as Evaluation[],
      areaSelf: (areaSelf.data ?? []) as Evaluation[],
    };
  }, [profile?.id, managedAreas.map((a) => a.id).join(","), canReviewArea]);

  const groups = useMemo(() => {
    const mine = data?.mine ?? [];
    const received = data?.received ?? [];
    return {
      mySelf: mine.filter((e) => e.kind === "self_assessment"),
      teamReviews: mine.filter((e) => e.kind === "manager_review"),
      // Fra le ricevute, l'autovalutazione compare solo se e' stata
      // consegnata: e' la copia di quanto ha scritto la persona stessa,
      // eventualmente corretta dal responsabile.
      fromManager: received.filter((e) => e.kind === "manager_review"),
      mySelfDone: received.filter((e) => e.kind === "self_assessment"),
    };
  }, [data]);

  const pending = (data?.mine ?? []).filter((e) => e.status !== "submitted").length;

  // Nessuna scheda da nessuna parte significa quasi sempre una cosa sola: l'HR
  // non ha ancora aperto una campagna. Le schede non si creano da sole ne' si
  // possono chiedere - nascono tutte all'apertura di una campagna - quindi
  // mostrare tre tabelle vuote lascerebbe chi guarda a chiedersi se ha
  // sbagliato qualcosa. Meglio dire com'e'.
  const nessunaScheda = Boolean(data) &&
    data!.mine.length === 0 &&
    data!.received.length === 0 &&
    data!.areaSelf.length === 0;

  return (
    <>
      <PageHeader
        title="Valutazioni"
        description="Le schede che devi compilare e quelle che ti riguardano."
      />

      {nessunaScheda && !loading && !error && (
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ py: 4 }}>
            <EmptyState
              icon={<EventBusyIcon sx={{ fontSize: 48 }} />}
              title="Nessuna valutazione al momento"
              description="Le valutazioni saranno disponibili non appena il reparto HR le mettera' a disposizione. Non c'e' niente da fare da parte tua: quando una campagna verra' aperta, la scheda comparira' qui e riceverai una notifica."
            />
          </CardContent>
        </Card>
      )}

      <Card sx={{ mb: 3, display: nessunaScheda ? "none" : undefined }}>
        <Tabs
          value={tab}
          onChange={(_event, value) => setTab(value as typeof tab)}
          sx={{ px: 2 }}
        >
          <Tab
            value="todo"
            label={pending > 0 ? `Da compilare (${pending})` : "Da compilare"}
          />
          <Tab value="received" label="Ricevute" />
          {canReviewArea && (
            <Tab
              value="area"
              label={`Autovalutazioni dell'area${
                data?.areaSelf.length ? ` (${data.areaSelf.length})` : ""
              }`}
            />
          )}
        </Tabs>
      </Card>

      <AsyncBlock loading={loading} error={error}>
        {nessunaScheda ? null : tab === "todo"
          ? (
            <Stack spacing={3}>
              <SectionCard
                title="La mia autovalutazione"
                subtitle="Come valuti tu stesso il tuo lavoro. Il responsabile della tua area puo' rivederla e correggerla."
                dense
              >
                <EvaluationTable
                  rows={groups.mySelf}
                  personColumn={null}
                  emptyTitle="Nessuna autovalutazione da compilare"
                  emptyDescription="Comparira' qui quando il reparto HR aprira' una campagna che ti riguarda."
                  emptyIcon={<PersonIcon sx={{ fontSize: 44 }} />}
                />
              </SectionCard>

              {groups.teamReviews.length > 0 && (
                <SectionCard
                  title={`Valutazioni dei collaboratori (${groups.teamReviews.length})`}
                  subtitle="Le schede che devi compilare sulle persone della tua area."
                  dense
                >
                  <EvaluationTable
                    rows={groups.teamReviews}
                    personColumn="subject"
                    emptyTitle="Nessuna scheda da compilare"
                  />
                </SectionCard>
              )}
            </Stack>
          )
          : tab === "area"
          ? (
            <SectionCard
              title="Autovalutazioni dei collaboratori"
              subtitle="Puoi rivederle e correggerle: la correzione resta tracciata e il diretto interessato la vede."
              dense
            >
              <EvaluationTable
                rows={data?.areaSelf ?? []}
                personColumn="subject"
                actionLabel={() => "Rivedi"}
                emptyTitle="Nessuna autovalutazione nella tua area"
                emptyDescription="Compariranno qui quando il reparto HR aprira' una campagna che coinvolge la tua area."
                emptyIcon={<EditNoteIcon sx={{ fontSize: 44 }} />}
              />
            </SectionCard>
          )
          : (
            <Stack spacing={3}>
              <SectionCard
                title="Valutazioni ricevute dal responsabile"
                subtitle="Diventano visibili solo dopo che il responsabile le ha consegnate."
                dense
              >
                <EvaluationTable
                  rows={groups.fromManager}
                  personColumn="evaluator"
                  emptyTitle="Nessuna valutazione ricevuta"
                  emptyDescription="Le schede compilate sul tuo conto compaiono qui solo dopo la consegna."
                  emptyIcon={<AssignmentIcon sx={{ fontSize: 44 }} />}
                />
              </SectionCard>

              <SectionCard
                title="Le mie autovalutazioni consegnate"
                subtitle="La copia di quanto hai scritto, con l'indicazione di eventuali correzioni del responsabile."
                dense
              >
                <EvaluationTable
                  rows={groups.mySelfDone}
                  personColumn={null}
                  emptyTitle="Nessuna autovalutazione consegnata"
                  emptyIcon={<EditNoteIcon sx={{ fontSize: 44 }} />}
                />
              </SectionCard>
            </Stack>
          )}
      </AsyncBlock>
    </>
  );
}

// ---------------------------------------------------------------------------
function EvaluationTable({
  rows,
  personColumn,
  actionLabel,
  emptyTitle,
  emptyDescription,
  emptyIcon,
}: {
  rows: Evaluation[];
  /** Quale persona mostrare in colonna, o null per non mostrarla. */
  personColumn: "subject" | "evaluator" | null;
  /** Testo del pulsante, se diverso da "Compila"/"Consulta". */
  actionLabel?: (evaluation: Evaluation) => string;
  emptyTitle: string;
  emptyDescription?: string;
  emptyIcon?: React.ReactNode;
}) {
  const router = useRouter();

  if (rows.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        icon={emptyIcon}
      />
    );
  }

  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Campagna</TableCell>
            {personColumn && (
              <TableCell>
                {personColumn === "subject" ? "Persona valutata" : "Valutatore"}
              </TableCell>
            )}
            <TableCell>Stato</TableCell>
            <TableCell>Punteggio</TableCell>
            <TableCell>Scadenza</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((evaluation) => (
            <TableRow key={evaluation.id} hover>
              <TableCell>
                <Typography sx={{ fontWeight: 600 }}>
                  {evaluation.evaluation_campaigns?.name ?? "—"}
                </Typography>
              </TableCell>

              {personColumn && (
                <TableCell>
                  {evaluation[personColumn]?.full_name ?? "—"}
                  {personColumn === "subject" && evaluation.subject?.job_title && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block" }}
                    >
                      {evaluation.subject.job_title}
                    </Typography>
                  )}
                </TableCell>
              )}

              <TableCell>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                  <Chip
                    size="small"
                    color={EVALUATION_STATUS_COLORS[evaluation.status]}
                    label={EVALUATION_STATUS_LABELS[evaluation.status]}
                  />
                  {evaluation.corrected_by && (
                    <Tooltip
                      title={`Corretta da ${
                        evaluation.corrector?.full_name ?? "il responsabile"
                      }`}
                    >
                      <Chip
                        size="small"
                        variant="outlined"
                        color="warning"
                        label="Corretta"
                      />
                    </Tooltip>
                  )}
                </Stack>
              </TableCell>

              <TableCell sx={{ minWidth: 130 }}>
                {evaluation.overall_score === null
                  ? <Typography color="text.disabled">—</Typography>
                  : (
                    <Stack spacing={0.5}>
                      <Typography sx={{ fontWeight: 700 }}>
                        {formatScore(evaluation.overall_score)} / 100
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={Math.min(evaluation.overall_score, 100)}
                        sx={{ height: 5, borderRadius: 3 }}
                      />
                      {/* Se la scheda e' stata corretta, il punteggio di
                          partenza resta visibile accanto a quello attuale. */}
                      {evaluation.original_score !== null &&
                        evaluation.original_score !== undefined && (
                        <Typography variant="caption" color="text.secondary">
                          prima della correzione:{" "}
                          {formatScore(evaluation.original_score)}
                        </Typography>
                      )}
                    </Stack>
                  )}
              </TableCell>

              <TableCell sx={{ whiteSpace: "nowrap" }}>
                {evaluation.evaluation_campaigns?.ends_on
                  ? formatDay(evaluation.evaluation_campaigns.ends_on)
                  : "—"}
              </TableCell>

              <TableCell align="right">
                <Button
                  size="small"
                  variant={evaluation.status === "submitted" && !actionLabel
                    ? "text"
                    : "contained"}
                  onClick={() => router.push(`/valutazioni/${evaluation.id}`)}
                >
                  {actionLabel
                    ? actionLabel(evaluation)
                    : evaluation.status === "submitted"
                    ? "Consulta"
                    : "Compila"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
