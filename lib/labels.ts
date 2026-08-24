// ---------------------------------------------------------------------------
// Etichette in italiano e colori associati ai valori enumerati del database.
// ---------------------------------------------------------------------------

import type {
  AbsenceKind,
  AttendanceType,
  CampaignStatus,
  DayPeriod,
  EvaluationKind,
  EvaluationStatus,
  RequestCategory,
  RequestRecipient,
  RequestStatus,
  UserRole,
} from "@/lib/types/models";

export const ROLE_LABELS: Record<UserRole, string> = {
  employee: "Dipendente",
  manager: "Responsabile",
  hr: "HR",
  sysadmin: "SystemAdmin",
};

/**
 * I ruoli che l'HR puo' assegnare dall'interfaccia. `sysadmin` resta fuori: si
 * ottiene solo dal database (supabase/scripts/03_crea_systemadmin.sql), e la
 * Edge Function `admin-users` rifiuta comunque di assegnarlo.
 */
export const ASSIGNABLE_ROLES: UserRole[] = ["employee", "manager", "hr"];

export const ATTENDANCE_LABELS: Record<AttendanceType, string> = {
  office: "In ufficio",
  smart_working: "Smart working",
  absence: "Assenza",
};

// I valori veri stanno in app/globals.css, definiti due volte: una per il tema
// chiaro e una per quello scuro. Qui restano solo i riferimenti, cosi' lo
// stesso codice serve entrambi i temi senza sapere quale sia attivo.
export const ATTENDANCE_COLORS: Record<AttendanceType, string> = {
  office: "var(--att-office)",
  smart_working: "var(--att-smart)",
  absence: "var(--att-absence)",
};

/** Lo stesso colore quasi trasparente, per i fondi delle pastiglie. */
export const ATTENDANCE_SOFT_COLORS: Record<AttendanceType, string> = {
  office: "var(--att-office-soft)",
  smart_working: "var(--att-smart-soft)",
  absence: "var(--att-absence-soft)",
};

export const ABSENCE_LABELS: Record<AbsenceKind, string> = {
  vacation: "Ferie",
  leave: "Permesso",
  sick: "Malattia",
  other: "Altro",
};

export const PERIOD_LABELS: Record<DayPeriod, string> = {
  full_day: "Giornata intera",
  morning: "Mattina",
  afternoon: "Pomeriggio",
};

export const PERIOD_SHORT: Record<DayPeriod, string> = {
  full_day: "",
  morning: "AM",
  afternoon: "PM",
};

export const REQUEST_CATEGORY_LABELS: Record<RequestCategory, string> = {
  vacation: "Ferie",
  leave: "Permesso",
  equipment: "Attrezzatura e materiale",
  training: "Formazione",
  administrative: "Amministrativa",
  other: "Altro",
};

/**
 * Categorie proponibili in una NUOVA richiesta.
 *
 * Ferie e permessi si comunicano dal calendario, non con una richiesta: averli
 * anche qui creava due strade per la stessa cosa. I due valori restano
 * nell'enum del database perche' le richieste gia' registrate continuino a
 * mostrare la loro categoria corretta.
 */
export const SELECTABLE_REQUEST_CATEGORIES: RequestCategory[] = [
  "equipment",
  "training",
  "administrative",
  "other",
];

export const REQUEST_RECIPIENT_LABELS: Record<RequestRecipient, string> = {
  manager: "Responsabile di area",
  hr: "Reparto HR",
};

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  open: "Aperta",
  in_progress: "In lavorazione",
  closed: "Chiusa",
};

export const REQUEST_STATUS_COLORS: Record<
  RequestStatus,
  "warning" | "info" | "success"
> = {
  open: "warning",
  in_progress: "info",
  closed: "success",
};

export const EVALUATION_STATUS_LABELS: Record<EvaluationStatus, string> = {
  pending: "Da compilare",
  draft: "Bozza",
  submitted: "Consegnata",
};

export const EVALUATION_STATUS_COLORS: Record<
  EvaluationStatus,
  "default" | "warning" | "success"
> = {
  pending: "default",
  draft: "warning",
  submitted: "success",
};

export const EVALUATION_KIND_LABELS: Record<EvaluationKind, string> = {
  manager_review: "Valutazione del responsabile",
  self_assessment: "Autovalutazione",
};

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Bozza",
  open: "Aperta",
  closed: "Chiusa",
};

export const CAMPAIGN_STATUS_COLORS: Record<
  CampaignStatus,
  "default" | "success" | "error"
> = {
  draft: "default",
  open: "success",
  closed: "error",
};

/** Etichetta compatta per una giornata a calendario. */
export function attendanceLabel(
  type: AttendanceType,
  absenceKind?: AbsenceKind | null,
): string {
  if (type === "absence" && absenceKind) {
    return ABSENCE_LABELS[absenceKind];
  }
  return ATTENDANCE_LABELS[type];
}
