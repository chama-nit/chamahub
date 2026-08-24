// ---------------------------------------------------------------------------
// Modelli di dominio
// ---------------------------------------------------------------------------
// Rispecchiano le tabelle definite in supabase/migrations. Sono scritti a mano
// per restare leggibili; se si preferisce la generazione automatica basta
// eseguire `npm run db:types` e importare i tipi da lib/types/database.types.ts.
// ---------------------------------------------------------------------------

// `sysadmin` sta sopra a tutti: eredita i permessi dell'HR e in piu' puo'
// impersonare le altre persone. Non e' assegnabile dall'applicazione: nasce
// solo dal database (supabase/scripts/03_crea_systemadmin.sql).
export type UserRole = "employee" | "manager" | "hr" | "sysadmin";
export type AttendanceType = "office" | "smart_working" | "absence";
export type AbsenceKind = "vacation" | "leave" | "sick" | "other";
export type DayPeriod = "full_day" | "morning" | "afternoon";
export type RequestCategory =
  | "vacation"
  | "leave"
  | "equipment"
  | "training"
  | "administrative"
  | "other";
export type RequestRecipient = "manager" | "hr";
export type RequestStatus = "open" | "in_progress" | "closed";
export type QuestionType = "scale" | "text";
export type EvaluationKind = "manager_review" | "self_assessment";
export type EvaluationStatus = "pending" | "draft" | "submitted";
export type CampaignStatus = "draft" | "open" | "closed";
export type TemplateTarget = "employee" | "self";

export interface Area {
  id: string;
  name: string;
  description: string | null;
  color: string;
  is_active: boolean;
  created_at: string;
}

export interface AreaOverview extends Area {
  headcount: number;
  managers_count: number;
  manager_names: string[];
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  area_id: string | null;
  job_title: string | null;
  phone: string | null;
  hired_on: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  areas?: Pick<Area, "id" | "name" | "color"> | null;
}

export interface CalendarEntry {
  id: string;
  profile_id: string;
  area_id: string | null;
  entry_date: string;
  period: DayPeriod;
  type: AttendanceType;
  absence_kind: AbsenceKind | null;
  note: string | null;
  created_at: string;
  profiles?: Pick<Profile, "id" | "full_name"> | null;
}

export interface HrRequest {
  id: string;
  requester_id: string;
  area_id: string | null;
  recipient: RequestRecipient;
  category: RequestCategory;
  subject: string;
  body: string;
  status: RequestStatus;
  assignee_id: string | null;
  resolution: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  requester?: Pick<Profile, "id" | "full_name" | "email"> | null;
  areas?: Pick<Area, "id" | "name"> | null;
}

export interface RequestMessage {
  id: string;
  request_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author?: Pick<Profile, "id" | "full_name"> | null;
}

export interface Question {
  id: string;
  position: number;
  label: string;
  help_text: string | null;
  type: QuestionType;
  scale_min: number;
  scale_max: number;
  weight: number;
  is_required: boolean;
}

export interface EvaluationTemplate {
  id: string;
  name: string;
  description: string | null;
  target: TemplateTarget;
  is_active: boolean;
  created_at: string;
  evaluation_questions?: Question[];
}

export interface EvaluationCampaign {
  id: string;
  name: string;
  description: string | null;
  template_id: string;
  self_template_id: string | null;
  include_self_assessment: boolean;
  starts_on: string;
  ends_on: string;
  status: CampaignStatus;
  created_at: string;
}

export interface Evaluation {
  id: string;
  campaign_id: string;
  template_id: string;
  subject_id: string;
  evaluator_id: string;
  area_id: string | null;
  kind: EvaluationKind;
  status: EvaluationStatus;
  overall_score: number | null;
  /** Punteggio delle risposte originali, valorizzato solo se corretta. */
  original_score?: number | null;
  comment: string | null;
  submitted_at: string | null;
  created_at: string;
  /** Responsabile che ha corretto l'autovalutazione, se e' successo. */
  corrected_by: string | null;
  corrected_at: string | null;
  subject?: Pick<Profile, "id" | "full_name" | "job_title"> | null;
  evaluator?: Pick<Profile, "id" | "full_name"> | null;
  corrector?: Pick<Profile, "id" | "full_name"> | null;
  areas?: Pick<Area, "id" | "name" | "color"> | null;
  evaluation_campaigns?: Pick<
    EvaluationCampaign,
    "id" | "name" | "ends_on" | "status"
  > | null;
}

export interface EvaluationAnswer {
  id: string;
  evaluation_id: string;
  question_id: string;
  numeric_value: number | null;
  text_value: string | null;
}

export interface SatisfactionSurvey {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  satisfaction_questions?: Question[];
}

export interface SatisfactionAreaKpi {
  area_id: string;
  area_name: string;
  responses: number;
  avg_score: number | null;
  avg_percentage: number | null;
  below_threshold: boolean;
}

export interface SatisfactionQuestionKpi {
  question_id: string;
  survey_id: string;
  survey_name: string;
  label: string;
  ordinal: number;
  scale_min: number;
  scale_max: number;
  responses: number;
  avg_score: number | null;
}

export interface SatisfactionTrendPoint {
  period_month: string;
  area_id: string | null;
  responses: number;
  avg_percentage: number | null;
}

export interface SatisfactionComment {
  area_id: string | null;
  area_name: string | null;
  period_month: string;
  label: string;
  text_value: string;
}

export interface EvaluationAreaKpi {
  area_id: string;
  area_name: string;
  total: number;
  submitted: number;
  completion: number | null;
  avg_score: number | null;
}

export interface DashboardSummary {
  active: boolean;
  role?: UserRole;
  area_id?: string | null;
  upcoming_entries?: number;
  my_open_requests?: number;
  pending_evaluations?: number;
  received_evaluations?: number;
  team_size?: number;
  inbox_requests?: number;
  team_today?: Partial<Record<AttendanceType, number>>;
  employees?: number;
  pending_activation?: number;
  areas?: number;
  open_campaigns?: number;
  satisfaction_responses_30d?: number;
  company_today?: Partial<Record<AttendanceType, number>>;
}
